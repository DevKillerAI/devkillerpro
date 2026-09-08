import {NextResponse} from 'next/server';
import {accessContext,accessError} from '@/lib/server/access';
import {getPilotRun,getPilotSnapshots} from '@/lib/server/generator/pilotStore';
import {pilotArtifactDirectory} from '@/lib/server/generator/pilotRuntime';
import {scopedId} from '@/lib/server/generator/contract';
import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 try{const access=await accessContext();const {id}=await params;if(!scopedId.safeParse(id).success)return new Response(null,{status:404,headers});const run=await getPilotRun(id,access.userId);
 if(!run?.accepted||(run.details&&typeof run.details==='object'&&'deletedAt' in run.details&&run.details.deletedAt))return new Response(null,{status:404,headers});
 const saved=(await getPilotSnapshots(id,access.userId)).find(s=>s.candidate.sourceHash===run.accepted?.sourceHash&&s.candidate.revision===run.accepted?.revision);if(!saved)return new Response(null,{status:404,headers});
 const root=await realpath(pilotArtifactDirectory(saved.snapshot));const entries=await readdir(root,{withFileTypes:true});const attempts=await Promise.all(entries.filter(e=>e.isDirectory()&&/^attempt-[\w-]+$/.test(e.name)).map(async e=>({name:e.name,time:(await stat(path.join(root,e.name))).mtimeMs})));attempts.sort((a,b)=>b.time-a.time);
 for(const candidate of [path.join(root,'layout-1440.png'),...attempts.slice(0,30).map(e=>path.join(root,e.name,'layout-1440.png'))]){try{const resolved=await realpath(candidate);if(!resolved.startsWith(root+path.sep))continue;const info=await stat(resolved);if(info.size>12*1024*1024)continue;const bytes=await readFile(resolved);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')continue;return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}});}catch{}}
 return new Response(null,{status:404,headers});
 }catch(error){const known=accessError(error);return NextResponse.json({error:'Preview unavailable'},{status:known?.status||404,headers});}
}
