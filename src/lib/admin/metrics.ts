export function ownerAdminAllowed(role:string,email:string|undefined,configured:string|undefined,internal=false) {
  return !internal && role==='admin' && Boolean(configured?.trim()) && email?.toLowerCase()===configured?.trim().toLowerCase();
}
export function cacheEstimate(input:number,reads:number|null,writes:number|null,readRate=0.1,writeRate=1.25) {
  if(input<=0 || reads===null || writes===null || reads<0 || writes<0 || reads+writes>input) return null;
  const baseline=input;
  const estimated=(input-reads-writes)+reads*readRate+writes*writeRate;
  return {percent:100*(baseline-estimated)/baseline,readPercent:100*reads/input};
}
export const ADMIN_CHECKS = [
  {id:'cache',title:'Measure net cache savings',detail:'Compare the same model and task mix. Include cache writes; compare cost per approved mission, not only cache hit rate.'},
  {id:'luna',title:'Benchmark Luna against Terra',detail:'Use fixed briefs and identical quality gates. Measure approval rate, retries, total tokens and duration before enabling routing.'},
  {id:'language',title:'Language and scope regression',detail:'Test English and Portuguese output requests, no-login apps and session-only data. Verify the selected foundation and visible copy.'},
  {id:'recovery',title:'Recovery and cancellation',detail:'Disconnect and reconnect during a build. Confirm no duplicate provider submission; abort and check that progress clears.'},
  {id:'quality',title:'End-to-end delivery',detail:'Create, edit, preview, export and reopen a real app. Test mobile layout and core behavior; source review alone is not browser evidence.'},
  {id:'security',title:'External tester access',detail:'Verify unauthenticated and non-owner access is denied, mission isolation, secrets protection and spending limits.'},
  {id:'sandbox',title:'Sandbox Agents pilot',detail:'Not enabled. Evaluate one isolated workload with narrow permissions, resource limits and a rollback path.'},
  {id:'rag',title:'RAG and optional image tools',detail:'Not an automatic rollout. Evaluate retrieval quality, tenant isolation, source freshness and per-mission tool budgets.'},
] as const;
