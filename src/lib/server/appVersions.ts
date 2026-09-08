import {mkdir,readFile,readdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
export type VersionFile={path:string;content:string};
type Version={id:string;at:string;label:string;request:string;files:VersionFile[]};
const safeFiles=(files:VersionFile[])=>files.filter(f=>typeof f.path==='string'&&typeof f.content==='string'&&!/(^|\/)\.env(?!\.example$)|\.(pem|key|pfx)$/i.test(f.path)).map(({path,content})=>({path,content}));
function root(id:string){if(!/^[a-zA-Z0-9_-]{8,180}$/.test(id))throw new Error('Invalid mission');return path.resolve('.devkiller/missions',id,'artifacts');}
export async function saveAppVersion(missionId:string,files:VersionFile[],request:string){
 const folder=path.join(root(missionId),'versions');await mkdir(folder,{recursive:true});
 const id=`v-${Date.now()}-${randomUUID()}`;
 await writeFile(path.join(folder,`${id}.json`),JSON.stringify({id,at:new Date().toISOString(),label:'Accepted source snapshot',request,files:safeFiles(files)}),{flag:'wx'});
}
export async function appVersions(missionId:string):Promise<Version[]>{
 const base=root(missionId),versions:Version[]=[];
 for(const folder of ['versions','revisions']){
  const entries=await readdir(path.join(base,folder)).catch(()=>[]);
  for(const name of entries.filter(n=>folder==='versions'?/^v-[\d-]+[a-f\d-]*\.json$/.test(n):/^before-\d+\.json$/.test(n)).sort().reverse().slice(0,40)){
   try{
    const file=path.join(base,folder,name);if((await stat(file)).size>5_000_000)continue;
    const data=JSON.parse(await readFile(file,'utf8'));
    versions.push({id:`${folder}:${name}`,at:data.at||data.savedAt||'',label:folder==='versions'?'Accepted source snapshot':'Before edit',request:data.request||data.requestedModification||'',files:safeFiles(data.files||data.sourceFiles||[])});
   }catch{/* Ignore incomplete legacy artifacts; never infer their contents. */}
  }
 }
 return versions.sort((a,b)=>b.at.localeCompare(a.at));
}
export function currentVersion(files:VersionFile[]):Version{
 const safe=safeFiles(files);return {id:'current',at:'',label:'Current saved source',request:'Current workspace; not a backup of database data.',files:safe};
}
export function compareVersions(before:VersionFile[],after:VersionFile[]){
 const a=new Map(before.map(f=>[f.path,f.content])),b=new Map(after.map(f=>[f.path,f.content]));
 return [...new Set([...a.keys(),...b.keys()])].sort().filter(p=>a.get(p)!==b.get(p)).map(p=>({path:p,status:!a.has(p)?'added':!b.has(p)?'removed':'modified',before:a.get(p)??'',after:b.get(p)??''}));
}
export function versionSummary(v:Version){return {id:v.id,at:v.at,label:v.label,request:v.request,fileCount:v.files.length,hash:createHash('sha256').update(JSON.stringify(v.files.slice().sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex')};}
