import { database,closeDatabase } from '../src/lib/server/database';
async function main(){
 const sql=database();
 const rows=await sql`select request_key,response_id from provider_requests where mission_id='mission_build-an-application--pr_1788329154717' and status in ('queued','in_progress')`;
 for(const row of rows){
  if(!row.response_id) continue;
  const headers={Authorization:`Bearer ${process.env.OPENAI_API_KEY}`};
  let response=await fetch(`https://api.openai.com/v1/responses/${row.response_id}/cancel`,{method:'POST',headers,signal:AbortSignal.timeout(15000)});
  if(!response.ok) response=await fetch(`https://api.openai.com/v1/responses/${row.response_id}`,{headers,signal:AbortSignal.timeout(15000)});
  if(response.status===404){await sql`update provider_requests set status='unavailable',updated_at=now() where request_key=${row.request_key}`;console.log('Remote response no longer available.');continue;}
  const body=await response.json();
  if(!response.ok)throw new Error(`Provider cancellation returned HTTP ${response.status}`);
  await sql`update provider_requests set status=${body.status},updated_at=now() where request_key=${row.request_key}`;
  console.log(`Remote response: ${body.status}`);
 }
 await sql`update missions set status='cancelled',phase='cancelled',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('discarded',true) where id='mission_build-an-application--pr_1788329154717'`;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(closeDatabase);
