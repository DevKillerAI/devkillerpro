import Projects from '@/components/tools/Projects';
import {accessContext} from '@/lib/server/access';
import {listPilotRuns} from '@/lib/server/generator/pilotStore';
import {WORKBENCH_RUNTIME} from '@/lib/server/generator/workbenchContract';
import {redirect} from 'next/navigation';
export const dynamic='force-dynamic';
export const metadata={title:'My projects | DevKiller',robots:{index:false,follow:false}};
export default async function Page(){
 const access=await accessContext().catch(()=>null);
 if(!access)redirect('/tools?signin=/projects');
 let createError=false;
 const runs=await listPilotRuns(access.userId).catch(()=>{createError=true;return [];});
 const projects=runs.filter(run=>run.status==='ready'&&run.contract.runtime.id===WORKBENCH_RUNTIME&&!(run.details&&typeof run.details==='object'&&'deletedAt' in run.details&&run.details.deletedAt)).map(run=>{
  const details=run.details&&typeof run.details==='object'?run.details as Record<string,unknown>:{};const meta=details.projectMetadata&&typeof details.projectMetadata==='object'?details.projectMetadata as Record<string,unknown>:{};const description=typeof meta.description==='string'?meta.description:'';let title='Untitled app';try{const brief=JSON.parse(run.contract.prompt);if(typeof brief.title==='string')title=brief.title;}catch{}
  return {id:run.runId,title,description,tags:['React',...(run.contract.capabilities.includes('database.postgres')?['Supabase']:[])],kind:'create' as const,status:run.status,updatedAt:run.updatedAt,href:'/create?run='+encodeURIComponent(run.runId)};
 });
 return <Projects ownerId={access.userId} createProjects={projects} createError={createError}/>;
}

