/** Transport-only helpers: no prompts, headers, or secrets in diagnostics. */
export function connectionDiagnostic(error: unknown) {
  const item = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const clean = (value: unknown) => String(value || "").replace(/sk-[\w-]+/g, "[REDACTED]").slice(0, 600);
  return { name: clean(item?.name), message: clean(item?.message), code: clean(item?.cause?.code), cause: clean(item?.cause?.message) };
}
export function responseText(response: any): string {
  if (response.status !== "completed") throw new Error(`OPENAI_RESPONSE_${String(response.status).toUpperCase()}: ${response.error?.code || response.incomplete_details?.reason || "No completed result"}`);
  const content = (response.output || []).filter((item: any) => item.type === "message").flatMap((item: any) => item.content || []);
  if (content.some((item: any) => item.type === "refusal")) throw new Error("OPENAI_REFUSAL: The provider declined this request.");
  const text = content.filter((item: any) => item.type === "output_text").map((item: any) => item.text).join("");
  if (!text) throw new Error("OPENAI_EMPTY_OUTPUT: No structured result was returned.");
  return text;
}
export function retryDelay(attempt: number, retryAfter: string | null, random = Math.random()) {
  const seconds = Number(retryAfter);
  const explicit = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
  return Math.min(60_000, Math.max(0, explicit || 750 * 2 ** attempt) + random * 500);
}
export async function pause(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason || new Error("Aborted")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
