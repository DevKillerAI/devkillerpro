import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { database, closeDatabase } from '../src/lib/server/database';
import { evaluateRetrieval } from '../src/lib/server/rag/evaluation';
import { ragTable } from '../src/lib/server/rag/store';
import { randomUUID } from 'node:crypto';

async function main() {
  const report=await evaluateRetrieval();
  const passed=report.passed===report.benchmarkSize && Object.values(report.securityGates).every(Boolean)
    && report.foundationSelection.passed && report.foundationTemplates.passed && report.providerIsolation.passed;
  const id=`eval-${randomUUID()}`,sql=database();
  // Keep real hits, true per-query durations, k, and metric definitions in one immutable report.
  await sql`INSERT INTO ${sql(ragTable('evaluation_runs'))}(id,dataset,corpus_hash,report)
    VALUES (${id},${report.dataset},${report.corpusHash},${sql.json(report as any)})`;
  const directory=path.join(process.cwd(),'.devkiller','evaluations');await mkdir(directory,{recursive:true});
  const output=path.join(directory,`rag-postgres-${id}.json`);await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({id,passed,dataset:report.dataset,backend:report.backend,k:report.k,recallAt3:report.recallAt3,
    cases:report.benchmarkSize,passedCases:report.passed,output,paidCalls:0,limitation:report.limitation},null,2));
  if(!passed)process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof Error?error.message:'RAG evaluation failed');process.exitCode=1;}).finally(closeDatabase);
