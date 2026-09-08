import { embedApprovedKnowledge } from '../src/lib/server/rag/retrieval';
import { closeDatabase } from '../src/lib/server/database';

function value(flag:string){const raw=process.argv.find(a=>a.startsWith(`${flag}=`))?.slice(flag.length+1);return Number(raw);}
async function main(){
  if(!process.argv.includes('--allow-paid'))throw new Error('Explicit --allow-paid plus --max-input-tokens=N --max-cost-micros=N --price-micros-per-million=N are required');
  const result=await embedApprovedKnowledge({tenantId:'devkiller',maxInputTokens:value('--max-input-tokens'),maxCostMicros:value('--max-cost-micros'),priceMicrosPerMillion:value('--price-micros-per-million')});
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Embedding failed');process.exitCode=1;}).finally(closeDatabase);
