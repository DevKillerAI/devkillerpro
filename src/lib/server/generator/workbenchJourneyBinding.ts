import ts from 'typescript';
import {workbenchJourneysSchema} from './workbenchContract';
import type {GeneratorSnapshot} from './versionedEdits';
import type {AcceptanceContract} from './acceptanceContract';

type Journey=ReturnType<typeof workbenchJourneysSchema.parse>[number];
type Target={description:string;matches:(id:string)=>boolean;tag:string;attributes:Map<string,string>;visible:string[];dynamicText:boolean};
export type JourneyBindingFinding={
  journey:string;
  step:number;
  testId:string;
  reason:'missing-target'|'wrong-control-kind'|'accessible-name-is-not-visible-text'|'invalid-requirement-binding';
  classification?: 'APPLICATION_DEFECT' | 'TEST_DEFECT' | 'UNKNOWN';
  isMandatory?: boolean;
};

const normalize=(value:string)=>value.replace(/\s+/g,' ').trim().toLocaleLowerCase();
const escapeRegex=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

function attributeValue(attribute:ts.JsxAttribute):string|undefined{
  const value=attribute.initializer;
  if(!value)return '';
  if(ts.isStringLiteral(value))return value.text;
  if(ts.isJsxExpression(value)&&value.expression&&(ts.isStringLiteral(value.expression)||ts.isNoSubstitutionTemplateLiteral(value.expression)))return value.expression.text;
}

function testIdMatchers(attribute:ts.JsxAttribute):Array<Pick<Target,'description'|'matches'>>{
  const value=attribute.initializer;
  if(!value)return [];
  if(ts.isStringLiteral(value))return [{description:value.text,matches:id=>id===value.text}];
  if(!ts.isJsxExpression(value)||!value.expression)return [];

  const extract=(expr:ts.Expression):Array<Pick<Target,'description'|'matches'>>=>{
    if(ts.isStringLiteral(expr)||ts.isNoSubstitutionTemplateLiteral(expr)){
      const exact=expr.text;return [{description:exact,matches:id=>id===exact}];
    }
    if(ts.isTemplateExpression(expr)){
      const parts=[expr.head.text,...expr.templateSpans.map(span=>span.literal.text)];
      const matcher=new RegExp('^'+parts.map(escapeRegex).join('.+')+'$');
      return [{description:parts.join('${…}'),matches:id=>matcher.test(id)}];
    }
    if(ts.isBinaryExpression(expr)){
      const extractString=(node:ts.Expression):string|null=>{
        if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
        return null;
      };
      const leftStr=extractString(expr.left);
      const rightStr=extractString(expr.right);
      if(leftStr!==null&&rightStr!==null){
        const exact=leftStr+rightStr;
        return [{description:exact,matches:id=>id===exact}];
      }
      if(leftStr!==null){
        const matcher=new RegExp('^'+escapeRegex(leftStr)+'.+$');
        return [{description:leftStr+'${…}',matches:id=>matcher.test(id)}];
      }
      if(rightStr!==null){
        const matcher=new RegExp('^.+'+escapeRegex(rightStr)+'$');
        return [{description:'${…}'+rightStr,matches:id=>matcher.test(id)}];
      }
      if(expr.operatorToken.kind===ts.SyntaxKind.BarBarToken||expr.operatorToken.kind===ts.SyntaxKind.QuestionQuestionToken){
        return [...extract(expr.left),...extract(expr.right)];
      }
    }
    if(ts.isConditionalExpression(expr)){
      return [...extract(expr.whenTrue),...extract(expr.whenFalse)];
    }
    if(ts.isParenthesizedExpression(expr)){
      return extract(expr.expression);
    }
    return [];
  };

  return extract(value.expression);
}

function collectVisible(children:ts.NodeArray<ts.JsxChild>,lucideIcons:Set<string>):{visible:string[];dynamicText:boolean}{
  const visible:string[]=[];let dynamicText=false;
  const visit=(child:ts.JsxChild)=>{
    if(ts.isJsxText(child)){if(child.text.trim())visible.push(child.text);return;}
    if(ts.isJsxExpression(child)){
      const expression=child.expression;if(!expression)return;
      if(ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression)||ts.isNumericLiteral(expression))visible.push(expression.text);
      else dynamicText=true;
      return;
    }
    if(ts.isJsxElement(child)){const nested=collectVisible(child.children,lucideIcons);visible.push(...nested.visible);dynamicText||=nested.dynamicText;return;}
    if(ts.isJsxSelfClosingElement(child)){
      const name=child.tagName.getText();
      if(!/^[a-z]/.test(name)&&!lucideIcons.has(name))dynamicText=true;
    }
  };
  children.forEach(visit);return {visible,dynamicText};
}

function manifest(snapshot:GeneratorSnapshot):Target[]{
  const targets:Target[]=[];
  const componentFiles=snapshot.files.filter(file=>file.path.endsWith('.tsx')||file.path.endsWith('.jsx'));
  for(const file of componentFiles){
    const source=file.content||'';
    const tree=ts.createSourceFile(file.path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const lucideIcons=new Set<string>();
    tree.forEachChild(node=>{
      if(!ts.isImportDeclaration(node)||!ts.isStringLiteral(node.moduleSpecifier)||node.moduleSpecifier.text!=='lucide-react')return;
      const bindings=node.importClause?.namedBindings;if(bindings&&ts.isNamedImports(bindings))bindings.elements.forEach(element=>lucideIcons.add(element.name.text));
    });
    const add=(node:ts.JsxOpeningLikeElement,children:ts.NodeArray<ts.JsxChild>)=>{
      const attrs=new Map<string,string>();
      for(const property of node.attributes.properties)if(ts.isJsxAttribute(property)){
        const name=property.name.getText(tree);
        const value=attributeValue(property);
        attrs.set(name,value??'');
      }
      const rawTag=node.tagName.getText(tree);
      const isCustomComponent=/^[A-Z]/.test(rawTag);
      const test=node.attributes.properties.find(property=>
        ts.isJsxAttribute(property)&&(
          property.name.getText(tree)==='data-testid'||
          property.name.getText(tree)==='testId'||
          (isCustomComponent&&property.name.getText(tree)==='id')
        )
      );
      if(!test||!ts.isJsxAttribute(test))return;
      const matchers=testIdMatchers(test);if(!matchers.length)return;
      const text=collectVisible(children,lucideIcons);
      if(attrs.has('label')&&attrs.get('label'))text.visible.push(attrs.get('label')!);
      let tag=rawTag.toLowerCase();
      if(isCustomComponent){
        if(/field|input|textarea/i.test(rawTag))tag='input';
        else if(/select/i.test(rawTag))tag='select';
        else if(/nav|button|btn|tab|item|link/i.test(rawTag)||attrs.has('onClick')||attrs.has('click'))tag='button';
      }
      for(const matcher of matchers){
        targets.push({...matcher,tag,attributes:attrs,visible:text.visible,dynamicText:text.dynamicText});
      }
    };
    const walk=(node:ts.Node)=>{
      if(ts.isJsxElement(node))add(node.openingElement,node.children);
      else if(ts.isJsxSelfClosingElement(node))add(node,ts.factory.createNodeArray());
      ts.forEachChild(node,walk);
    };
    walk(tree);
  }
  return targets;
}

function supports(target:Target,action:Journey['steps'][number]['action']):boolean{
  if(['text','count','disabled','enabled'].includes(action))return true;
  if(action==='fill')return ['input','textarea'].includes(target.tag)||target.attributes.get('contentEditable')==='true';
  if(action==='select')return target.tag==='select';
  if(action==='check'||action==='uncheck')return target.tag==='input'&&(!target.attributes.get('type')||target.attributes.get('type')==='checkbox');
  if(action==='click')return ['button','a','input','summary','tr'].includes(target.tag)||target.attributes.has('onClick')||target.attributes.has('click')||target.attributes.has('onMouseDown')||target.attributes.has('onPointerDown')||target.attributes.has('onMouseUp');
  return action==='reload';
}

/** Inspect the exact declared plan. Never guess navigation, change an assertion,
 * or drop a failed journey to make an application pass. */
export function bindWorkbenchJourneysToSource(input:unknown,snapshot:GeneratorSnapshot,options?:{acceptanceContract?:AcceptanceContract}){
  const journeys=workbenchJourneysSchema.parse(input),targets=manifest(snapshot),findings:JourneyBindingFinding[]=[];
  for(const journey of journeys){
    for(const id of journey.requirementIds){
      const requirement=options?.acceptanceContract?.requirements.find(item=>item.id===id);
      if(options?.acceptanceContract&&(!requirement||requirement.verificationType!=='browser')){
        findings.push({journey:journey.name,step:0,testId:id,reason:'invalid-requirement-binding',classification:'TEST_DEFECT',isMandatory:true});
      }
    }
    for(const [index,step] of journey.steps.entries()){
      if(step.action==='reload')continue;
      const matches=targets.filter(target=>target.matches(step.testId));
      const isMandatory=journey.requirementIds.some(id=>options?.acceptanceContract?.requirements.some(req=>req.id===id&&req.priority==='mandatory'));
      const finding=(reason:JourneyBindingFinding['reason'],classification:JourneyBindingFinding['classification'])=>findings.push({journey:journey.name,step:index+1,testId:step.testId,reason,classification,isMandatory});
      let target:Target|undefined;
      if(matches.length===1){
        target=matches[0];
      }else if(matches.length>1){
        const exact=matches.filter(m=>m.description===step.testId);
        if(exact.length===1)target=exact[0];
      }
      if(!target){finding('missing-target','APPLICATION_DEFECT');continue;}
      if(!supports(target,step.action)){finding('wrong-control-kind','APPLICATION_DEFECT');continue;}
      if(step.action==='text'){
        const expected=normalize(step.value),visible=normalize(target.visible.join(' ')),accessible=normalize(target.attributes.get('aria-label')||'');
        if((!target.dynamicText||target.visible.length===0)&&expected&&!visible.includes(expected)&&accessible.includes(expected)){
          finding('accessible-name-is-not-visible-text','TEST_DEFECT');
        }
      }
    }
  }
  return {journeys,findings};
}
