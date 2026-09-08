/** A reconnect must replay a terminal failure, not start another repair budget. */
export function terminalPipelineOutcome(status:number,payload:Record<string,unknown>|null){
  if(!payload)return false;
  if(status>=200&&status<300&&payload.success===true)return true;
  const error=String(payload.error||'');
  return /^(?:Recovery attempts exhausted|Recovery stopped|VERIFICATION_REQUIRED|PROVIDER_SUBMISSION_UNCERTAIN|PROVIDER_WAIT_LIMIT|PROVIDER_BUDGET_EXHAUSTED|OPENAI_SUBMISSION_REJECTED|OPENAI_RESPONSE_|OPENAI_REFUSAL)/i.test(error);
}
