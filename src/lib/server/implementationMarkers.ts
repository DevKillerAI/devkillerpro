import ts from "typescript";
/** Inspect syntax, not natural-language copy. Comments and string literals alone are never stubs. */
export function unfinishedImplementationFailures(files: {path:string;content:string}[]) {
  const failures:string[]=[];
  for(const file of files){
    if(!/\.(?:[cm]?js|jsx|tsx?|html)$/i.test(file.path)) continue;
    const blocks = /\.html$/i.test(file.path)
      ? [...file.content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1])
      : [file.content];
    for(const content of blocks){
      const source=ts.createSourceFile(file.path,content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      const scan=(node:ts.Node)=>{
        if(ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)
          && ts.isIdentifier(node.expression.expression) && node.expression.expression.text==='Error'){
          const argument=node.expression.arguments?.[0];
          if(argument && (ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument)) && /^not implemented[.!]?$/i.test(argument.text.trim()))
            failures.push(`${file.path}: executable throw Error stub is not implemented.`);
        }
        ts.forEachChild(node,scan);
      };
      scan(source);
    }
  }
  return failures;
}
