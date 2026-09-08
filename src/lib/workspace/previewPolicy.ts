/** Adapt bundled inline assets to the source CSP only inside the preview.
 * Exported source files and network restrictions are left unchanged.
 */
export function applyPreviewNonce(html: string, nonce: string) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) return html;
  const source = `'nonce-${nonce}'`;
  let result = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (!/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)) return tag;
    return tag.replace(/\bcontent\s*=\s*(["'])(.*?)\1/i, (_attribute, quote, content: string) => {
      const directives = new Map(content.split(';').map(part => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name.toLowerCase(), values] as const;
      }).filter(([name]) => name));
      for (const name of ['script-src', 'style-src', 'script-src-elem', 'style-src-elem']) {
        if (name.endsWith('-elem') && !directives.has(name)) continue;
        const values = directives.get(name) || directives.get('default-src') || [];
        directives.set(name, [...values.filter(value => value !== "'none'"), source]);
      }
      return `content=${quote}${[...directives].map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')}${quote}`;
    });
  });
  result = result.replace(/<(script|style)\b([^>]*)>/gi, (_tag, name, attributes: string) =>
    `<${name}${attributes.replace(/\snonce\s*=\s*(["']).*?\1/gi, '')} nonce="${nonce}">`,
  );
  return result;
}
