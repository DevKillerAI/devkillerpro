import {mkdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
/** Publish an exact source snapshot. Previous snapshots remain recoverable. */
export async function writeFileSnapshot(base:string,files:{path:string;content:string}[]){
 const resolved=path.resolve(base),parent=path.dirname(resolved),id=randomUUID();
 const stage=path.join(parent,`.${path.basename(base)}-staging-${id}`);
 const archive=path.join(parent,`.${path.basename(base)}-previous-${id}`);
 const seen=new Set<string>();
 const normalized=files.map(file=>{
  const relative=file.path.replaceAll('\\','/');
  if(!relative||relative.includes(':')||relative.includes('\0')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error(`Unsafe generated path: ${file.path}`);
  const target=path.resolve(stage,relative);
  if(!target.startsWith(stage+path.sep))throw new Error('Generated path escapes snapshot');
  const key=relative.toLowerCase();if(seen.has(key))throw new Error('Duplicate generated path');seen.add(key);
  return {...file,path:relative};
 });
 await mkdir(stage,{recursive:true});
 for(const file of normalized){const target=path.join(stage,file.path);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,file.content,{flag:'wx'});}
 let backedUp=false;
 try{await rename(resolved,archive);backedUp=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 try{await rename(stage,resolved);}catch(error){if(backedUp)await rename(archive,resolved);throw error;}
 return normalized.map(file=>path.relative(process.cwd(),path.join(resolved,file.path)).replaceAll('\\','/'));
}
