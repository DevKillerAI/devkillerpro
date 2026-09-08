export type SourceEdit={path:string;search:string;replacement:string};
export function exactSourceEdits<T extends {path:string;content:string}>(files:T[],edits:SourceEdit[],replacedPaths:string[]=[]):T[]{
 const result=files.map(f=>({...f}));
 for(const edit of edits){
  const target=edit.path.replaceAll('\\','/');
  if(replacedPaths.map(p=>p.replaceAll('\\','/')).includes(target))throw new Error('Ambiguous patch: edit overlaps upsert/delete');
  const file=result.find(f=>f.path.replaceAll('\\','/')===target);
  if(!file||!edit.search||file.content.split(edit.search).length!==2)throw new Error(`Exact patch must match once: ${target}`);
  file.content=file.content.replace(edit.search,()=>edit.replacement);
 }
 return result;
}
