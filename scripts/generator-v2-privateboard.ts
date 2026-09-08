import { z } from 'zod';
import { database, closeDatabase } from '../src/lib/server/database';
import { createPrivateboardContract } from '../src/lib/server/generator/supabasePilotContract';
import { inspectPrivateboardRuntime } from '../src/lib/server/generator/supabasePilotRuntime';
import { inspectSupabasePilotPrerequisites } from '../src/lib/server/generator/supabasePilotEnvironment';
import { createPilotRun, getPilotRun } from '../src/lib/server/generator/pilotStore';
import { PILOT_CAMPAIGN } from '../src/lib/server/generator/pilotContract';

async function main(){
  const argument=process.argv.indexOf('--request-id');
  const requestId=z.string().uuid().parse(argument>=0?process.argv[argument+1]:undefined);
  const [runtime,infrastructure]=await Promise.all([inspectPrivateboardRuntime(),inspectSupabasePilotPrerequisites()]);
  if(!runtime.available||!infrastructure.available)throw new Error('Privateboard compiler/database prerequisites are not ready. No paid run was queued.');
  if(!process.env.DEVKILLER_PILOT_EMAIL||!process.env.OPENAI_API_KEY)throw new Error('Configured owner and server provider credentials are required.');
  const [owner]=await database()`select u.id from auth.users u join profiles p on p.id=u.id where lower(u.email)=lower(${process.env.DEVKILLER_PILOT_EMAIL}) and p.role='admin'`;
  if(!owner)throw new Error('Configured owner was not found.');
  const contract=createPrivateboardContract(owner.id,requestId);
  if(!process.argv.includes('--apply')){console.log(JSON.stringify({readOnly:true,runId:contract.identity.missionId,runtimeReady:true,infrastructureReady:true,existing:Boolean(await getPilotRun(contract.identity.missionId,owner.id))}));return;}
  const run=await createPilotRun(contract,PILOT_CAMPAIGN);
  console.log(JSON.stringify({runId:run.runId,status:run.status,benchmark:'privateboard',sharedCampaignCeilingUsd:run.campaignBudget.maxCostMicros/1_000_000,estimatedCampaignUsageUsd:run.campaignBudget.spentMicros/1_000_000}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Privateboard admission failed');process.exitCode=1;}).finally(closeDatabase);
