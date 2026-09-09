import ts from 'typescript';
import {applyVersionedEdits,type GeneratorSnapshot} from './versionedEdits';
import {WORKBENCH_SUPABASE_SETTINGS_TYPE} from './workbenchClientContract';

/** Fix only compiler-proved mismatches with the platform's injected client.
 * Changes erase at transpilation: no URLs, keys, authentication options, SQL,
 * runtime expressions, null checks or behavior are changed.
 */
export function repairWorkbenchClientTypes(base:GeneratorSnapshot,diagnostics:string,newRevision:string) {
  const globalMismatch=diagnostics.includes('TS2717:')&&diagnostics.includes('__DK_SUPABASE__');
  const clientMismatch=diagnostics.includes('TS2322:')&&diagnostics.includes('SupabaseClient')&&diagnostics.includes('"app"')&&diagnostics.includes('"public"');
  if(!globalMismatch&&!clientMismatch)return null;
  const operations:Array<{kind:'replace';path:string;expectedHash:string;search:string;replacement:string}>=[];
  for(const file of base.files.filter(f=>/\.tsx?$/.test(f.path))) {
    const tree=ts.createSourceFile(file.path,file.content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    const factories=new Set<string>(),clients=new Set<string>();
    for(const statement of tree.statements) {
      if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||statement.moduleSpecifier.text!=='@supabase/supabase-js')continue;
      const imports=statement.importClause?.namedBindings;
      if(imports&&ts.isNamedImports(imports))for(const spec of imports.elements){
        const exported=(spec.propertyName??spec.name).text;
        if(exported==='createClient')factories.add(spec.name.text);
        if(exported==='SupabaseClient')clients.add(spec.name.text);
      }
    }
    const edits:Array<{start:number;end:number;text:string}>=[];
    const hasDiagnostic=(node:ts.Node,code:number)=>{
      const line=tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1;
      return diagnostics.includes(`${file.path}:${line}:`)&&diagnostics.includes(`TS${code}:`);
    };
    const sdkFactory=(expr:ts.Expression):boolean=>{
      if(ts.isParenthesizedExpression(expr))return sdkFactory(expr.expression);
      if(ts.isConditionalExpression(expr))return (sdkFactory(expr.whenTrue)&&expr.whenFalse.kind===ts.SyntaxKind.NullKeyword)||(sdkFactory(expr.whenFalse)&&expr.whenTrue.kind===ts.SyntaxKind.NullKeyword);
      return ts.isCallExpression(expr)&&ts.isIdentifier(expr.expression)&&factories.has(expr.expression.text);
    };
    const nullableDefaultClient=(type:ts.TypeNode):boolean=>ts.isTypeReferenceNode(type)&&ts.isIdentifier(type.typeName)&&clients.has(type.typeName.text)&&!type.typeArguments
      ||ts.isUnionTypeNode(type)&&type.types.every(t=>nullableDefaultClient(t)||ts.isLiteralTypeNode(t)&&t.literal.kind===ts.SyntaxKind.NullKeyword)&&type.types.some(t=>ts.isTypeReferenceNode(t));
    const walk=(node:ts.Node)=>{
      if(globalMismatch&&ts.isPropertySignature(node)&&node.name.getText(tree)==='__DK_SUPABASE__'&&node.questionToken&&node.type
        &&ts.isInterfaceDeclaration(node.parent)&&node.parent.name.text==='Window'&&hasDiagnostic(node,2717)) {
        if(node.type.getText(tree)!==WORKBENCH_SUPABASE_SETTINGS_TYPE)edits.push({start:node.type.getStart(tree),end:node.type.end,text:WORKBENCH_SUPABASE_SETTINGS_TYPE});
      }
      if(clientMismatch&&ts.isVariableDeclaration(node)&&node.type&&node.initializer&&nullableDefaultClient(node.type)&&sdkFactory(node.initializer)&&hasDiagnostic(node,2322)) {
        // Inference retains the actual app schema rather than the SDK's public default.
        const colon=file.content.indexOf(':',node.name.end);
        if(colon>=node.name.end&&colon<node.type.getStart(tree))edits.push({start:colon,end:node.type.end,text:''});
      }
      ts.forEachChild(node,walk);
    };walk(tree);
    if(!edits.length)continue;
    let replacement=file.content;
    for(const edit of edits.sort((a,b)=>b.start-a.start))replacement=replacement.slice(0,edit.start)+edit.text+replacement.slice(edit.end);
    if(replacement!==file.content)operations.push({kind:'replace',path:file.path,expectedHash:file.hash,search:file.content,replacement});
  }
  if(!operations.length)return null;
  return {snapshot:applyVersionedEdits(base,{scope:base.scope,baseRevision:base.revision,baseHash:base.hash,newRevision,operations}),
    kind:'platform-supabase-types' as const,path:operations.map(o=>o.path).join(', '),line:1,column:1};
}
