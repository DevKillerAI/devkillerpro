function firstForwarded(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

function normalizedOrigin(value: string) {
  try { return new URL(value).origin; }
  catch { return null; }
}

/** Preserve CSRF same-origin checks behind a trusted local HTTPS proxy. */
export function isSameOriginRequest(req: Request) {
  const supplied = req.headers.get("origin");
  if (!supplied) return true;
  const suppliedOrigin = normalizedOrigin(supplied);
  if (!suppliedOrigin) return false;

  const requestUrl = new URL(req.url);
  const candidates = new Set<string>([requestUrl.origin]);
  const host = firstForwarded(req.headers.get("x-forwarded-host")) || firstForwarded(req.headers.get("host"));
  const protocol = firstForwarded(req.headers.get("x-forwarded-proto")) || requestUrl.protocol.replace(":", "");
  if (host) {
    const forwarded = normalizedOrigin(`${protocol}://${host}`);
    if (forwarded) candidates.add(forwarded);
    // Local reverse proxies may retain http:// upstream while terminating HTTPS.
    const secureForwarded = normalizedOrigin(`https://${host}`);
    if (secureForwarded) candidates.add(secureForwarded);
  }
  for (const configured of (process.env.DEVKILLER_TRUSTED_ORIGINS || "").split(",")) {
    const origin = normalizedOrigin(configured.trim());
    if (origin) candidates.add(origin);
  }
  return candidates.has(suppliedOrigin);
}

export function assertSameOriginRequest(req: Request) {
  if (!isSameOriginRequest(req)) throw new Error("FORBIDDEN");
}
