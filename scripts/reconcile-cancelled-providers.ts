import { database, closeDatabase } from "../src/lib/server/database";

async function main() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not configured.");
  const sql = database();
  const rows = await sql`
    select p.request_key, p.response_id
    from provider_requests p
    join missions m on m.id=p.mission_id
    where m.status='cancelled'
      and p.status in ('queued','in_progress')
      and p.response_id is not null
  `;
  for (const row of rows) {
    const response = await fetch(`https://api.openai.com/v1/responses/${row.response_id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    let result = await response.json();
    if (!response.ok && ![400, 409].includes(response.status))
      throw new Error(`Provider cancellation failed with HTTP ${response.status}.`);
    if(!response.ok){
      const current=await fetch(`https://api.openai.com/v1/responses/${row.response_id}`,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15_000)});
      if(!current.ok)throw new Error('Provider cancellation could not be reconciled. Local state was not changed.');
      result=await current.json();
    }
    if(!['cancelled','completed','failed','incomplete'].includes(result.status))throw new Error('Provider has not confirmed a terminal state. Local state was not changed.');
    await sql`update provider_requests set status=${result.status},result=${sql.json(result)},updated_at=now() where request_key=${row.request_key}`;
    console.log(JSON.stringify({ responseId: row.response_id, status: result.status }));
  }
  await closeDatabase();
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : "Cancellation reconciliation failed.");
  await closeDatabase();
  process.exitCode = 1;
});
