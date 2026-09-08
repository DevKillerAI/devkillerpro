/** Accept only paths on this application, never a login return to another origin. */
export function safeReturnPath(value: string | null | undefined, fallback = '/create'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://dk.invalid');
    if (url.origin !== 'https://dk.invalid' || /^\/(login|api\/auth)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}
