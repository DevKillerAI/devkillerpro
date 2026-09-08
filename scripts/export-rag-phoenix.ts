import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { retrievalOtlp } from '../src/lib/server/rag/telemetry';
import { database, closeDatabase } from '../src/lib/server/database';
import { ragTable } from '../src/lib/server/rag/store';

async function main(){
  const root=path.join(process.cwd(),'.devkiller'),sql=database();
  const rows=await sql`SELECT event FROM ${sql(ragTable('retrieval_events'))} WHERE event->>'type' IS DISTINCT FROM 'embedding.batch' ORDER BY recorded_at DESC,trace_id DESC LIMIT 100`;
  const spans=[];let rejected=0;
  for(const row of [...rows].reverse()){try{spans.push(retrievalOtlp(row.event));}catch{rejected++;}}
  const payload={resourceSpans:[{resource:{attributes:[{key:'service.name',value:{stringValue:'devkiller-rag'}},{key:'openinference.project.name',value:{stringValue:'devkiller-rag'}}]},scopeSpans:[{scope:{name:'devkiller.postgres-retrieval-export',version:'2'},spans}]}]};
  await mkdir(path.join(root,'evaluations'),{recursive:true});
  const output=path.join(root,'evaluations','retrieval-otel.json');await writeFile(output,JSON.stringify(payload));
  const send=process.argv.includes('--send');
  if(send){
    const python=process.env.DEVKILLER_PHOENIX_PYTHON||path.join(root,'tooling','phoenix-venv','Scripts','python.exe');
    const result=await promisify(execFile)(python,[path.join(process.cwd(),'scripts','rag-tools','send_phoenix.py')],{windowsHide:true,timeout:20000,maxBuffer:1024*1024});
    process.stdout.write(result.stdout);
  }
  console.log(JSON.stringify({output,backend:'postgresql',spans:spans.length,rejected,sent:send,transport:'protobuf',mode:'manual snapshot; repeated sends may duplicate collector records'}));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Phoenix export failed');process.exitCode=1;}).finally(closeDatabase);
