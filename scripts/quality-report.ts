import { mkdir, writeFile } from "node:fs/promises";
import { database, closeDatabase } from "../src/lib/server/database";
async function main() {
  const sql=database();
  try {
    const provider=await sql`select model,schema_name,count(*)::int as calls,
      count(*) filter(where status='completed')::int as completed,
      coalesce(sum((result->'usage'->>'input_tokens')::bigint),0)::text as input_tokens,
      coalesce(sum((result->'usage'->>'output_tokens')::bigint),0)::text as output_tokens,
      sum((result->'usage'->'input_tokens_details'->>'cached_tokens')::bigint)::text as cached_input_tokens,
      sum((result->'usage'->'input_tokens_details'->>'cache_write_tokens')::bigint)::text as cache_write_tokens,
      count(*) filter(where result->'usage'->'input_tokens_details'->>'cached_tokens' is not null)::int as cache_read_reporting_calls,
      count(*) filter(where result->'usage'->'input_tokens_details'->>'cache_write_tokens' is not null)::int as cache_write_reporting_calls,
      round(avg(extract(epoch from updated_at-created_at)) filter(where status='completed'),2)::text as observed_seconds
      from provider_requests group by model,schema_name order by model,schema_name`;
    const response=await fetch('http://127.0.0.1:3000/api/knowledge/health?eval=true',{headers:{'x-devkiller-worker-token':process.env.DEVKILLER_WORKER_TOKEN!},signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`Knowledge evaluation HTTP ${response.status}`);
    const knowledge=await response.json();
    const report={at:new Date().toISOString(),provider,knowledge,note:'Observed duration includes polling and persistence; this is not model-only latency. Token counts are not currency costs. No model-routing change is authorized by this report alone.'};
    await mkdir('.devkiller/evaluations',{recursive:true});
    const file=`.devkiller/evaluations/quality-${Date.now()}.json`;
    await writeFile(file,JSON.stringify(report,null,2));
    console.log(JSON.stringify({file,provider,recallAt3:knowledge.evaluation?.recallAt3,securityGates:knowledge.evaluation?.securityGates,providerIsolation:knowledge.evaluation?.providerIsolation?.passed}));
  } finally {await closeDatabase();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
