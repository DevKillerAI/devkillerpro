/** Local safety budgets, not provider latency guarantees. Age survives reconnects. */
export function providerWaitExpired(schema: string, status: string, createdAt: Date | string, now = Date.now()) {
  if (!['queued', 'in_progress'].includes(status)) return false;
  const age = now - new Date(createdAt).getTime();
  const council = schema === 'consultant_contribution' || schema === 'consultant_product';
  return age >= (status === 'queued' ? 1.5 : council ? 6 : 10) * 60_000;
}
