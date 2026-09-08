import {NextResponse} from 'next/server';
import {accessContext,accessError,requireMissionOwner} from '@/lib/server/access';
import {appVersions,currentVersion,compareVersions,versionSummary} from '@/lib/server/appVersions';
import {readMissionWorkspaceFiles} from '@/lib/server/missionRuntime';
export const runtime='nodejs';
export async function GET(req:Request){
 try{
  const access=await accessContext(req),params=new URL(req.url).searchParams,id=params.get('missionId')||'';
  if(!/^[a-zA-Z0-9_-]{8,180}$/.test(id))return NextResponse.json({error:'Invalid mission.'},{status:400});
  await requireMissionOwner(id,access);
  const versions=[currentVersion(await readMissionWorkspaceFiles(id)),...await appVersions(id)];
  const from=params.get('from'),to=params.get('to');
  if(from||to){
   const a=versions.find(v=>v.id===from),b=versions.find(v=>v.id===to);
   if(!a||!b)return NextResponse.json({error:'Version not found. Refresh the history.'},{status:404});
   return NextResponse.json({changes:compareVersions(a.files,b.files)},{headers:{'Cache-Control':'private, no-store'}});
  }
  return NextResponse.json({versions:versions.map(versionSummary)},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){const known=accessError(error);return NextResponse.json({error:known?.error||'Unable to load version history.'},{status:known?.status||500});}
}
