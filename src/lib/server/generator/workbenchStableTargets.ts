import ts from 'typescript';
import {workbenchJourneysSchema} from './workbenchContract';
import {createGeneratorSnapshot,type GeneratorSnapshot} from './versionedEdits';

/** Replace an invented UUID placeholder with a stable collection test hook.
 * Only JSX test attributes change. Assertions, actions, values and database IDs
 * remain untouched. Ambiguous families and mixed explicit IDs are not rewritten.
 * Browser strictness still rejects multiple targets for a single-record action.
 */
export function stabilizeWorkbenchJourneyTargets(snapshot:GeneratorSnapshot,input:unknown) {
  const journeys=workbenchJourneysSchema.parse(input);
  const steps=journeys.flatMap(j=>j.steps);
  const requested=[...new Set(steps.map(s=>s.testId).filter(id=>/^[\w-]+-placeholder$/.test(id)))];
  const candidates:Array<{path:string;start:number;end:number;prefix:string;placeholder:string;stable:string}>=[];
  for(const file of snapshot.files.filter(f=>/\.[jt]sx$/.test(f.path))) {
    const tree=ts.createSourceFile(file.path,file.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const walk=(node:ts.Node)=>{
      if(ts.isJsxAttribute(node)&&node.name.getText(tree)==='data-testid'&&node.initializer&&ts.isJsxExpression(node.initializer)) {
        const expr=node.initializer.expression;
        // Only a single object.id suffix; never dynamic labels, indexes or arbitrary expressions.
        let prefix:string|undefined,identity:ts.Expression|undefined;
        if(expr&&ts.isTemplateExpression(expr)&&expr.templateSpans.length===1&&expr.templateSpans[0].literal.text==='') {
          prefix=expr.head.text;identity=expr.templateSpans[0].expression;
        } else if(expr&&ts.isBinaryExpression(expr)&&expr.operatorToken.kind===ts.SyntaxKind.PlusToken&&ts.isStringLiteral(expr.left)) {
          prefix=expr.left.text;identity=expr.right;
        }
        if(prefix&&/^[\w-]+-$/.test(prefix)&&identity&&ts.isPropertyAccessExpression(identity)&&identity.name.text==='id'&&ts.isIdentifier(identity.expression)) {
          const placeholder=prefix+'placeholder';
          if(requested.includes(placeholder))candidates.push({path:file.path,start:node.initializer.getStart(tree),end:node.initializer.end,prefix,placeholder,stable:prefix.slice(0,-1)});
        }
      }
      ts.forEachChild(node,walk);
    };walk(tree);
  }
  const changes=candidates.filter(c=>candidates.filter(other=>other.prefix===c.prefix).length===1
    &&!steps.some(s=>s.testId.startsWith(c.prefix)&&s.testId!==c.placeholder)
    &&!snapshot.files.some(f=>f.content.includes('"'+c.stable+'"')||f.content.includes("'"+c.stable+"'")));
  if(!changes.length)return null;
  const files=snapshot.files.map(file=>{
    let content=file.content;
    for(const c of changes.filter(c=>c.path===file.path).sort((a,b)=>b.start-a.start))content=content.slice(0,c.start)+JSON.stringify(c.stable)+content.slice(c.end);
    return {path:file.path,content};
  });
  return {
    snapshot:createGeneratorSnapshot({scope:snapshot.scope,revision:snapshot.revision+'-stable-targets',files}),
    journeys:journeys.map(j=>({...j,steps:j.steps.map(s=>({...s,testId:changes.find(c=>c.placeholder===s.testId)?.stable??s.testId}))})),
    changes:changes.map(({path,placeholder,stable})=>({path,from:placeholder,to:stable})),
  };
}
