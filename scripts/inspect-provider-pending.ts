import { database, closeDatabase } from '../src/lib/server/database';
async function main() {
const missionId = process.argv[2];
if (!missionId) throw new Error('Mission ID required');
try {
  const rows = await database()`select response_id,status,created_at from provider_requests where mission_id=${missionId} and status in ('queued','in_progress')`;
  for (const row of rows) {
    const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(row.response_id)}`, {headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(30000)});
    const payload = await response.json();
    console.log({http:response.status,local:row.status,remote:payload.status,errorCode:payload.error?.code});
    if (process.argv.includes('--reconcile') && response.ok && ['cancelled','completed','failed','incomplete'].includes(payload.status)) {
      const sql=database();
      await sql`update provider_requests set status=${payload.status},result=${sql.json(payload)},updated_at=now() where mission_id=${missionId} and response_id=${row.response_id} and status in ('queued','in_progress')`;
    }
    if (process.argv.includes('--cancel-stale') && response.ok && payload.status==='queued' && Date.now()-new Date(row.created_at).getTime()>180000) {
      const cancelled=await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(row.response_id)}/cancel`,{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},signal:AbortSignal.timeout(30000)});
      const result=await cancelled.json();
      console.log({cancellationHttp:cancelled.status,status:result.status});
    }
  }
} finally { await closeDatabase(); }
}
void main().catch(error => { console.error(error.message); process.exitCode=1; });
