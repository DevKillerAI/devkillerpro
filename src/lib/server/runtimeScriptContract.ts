export function runtimeScriptFailures(files:{path:string;content:string}[]){
 if(!files.some(f=>f.path==='devkiller.runtime.json'))return [];
 const affected=files.filter(f=>/\.html$/.test(f.path)&&/<[a-z][^>]*\son[a-z]+\s*=/i.test(f.content.replace(/<!--[\s\S]*?-->/g,''))).map(f=>f.path);
 return affected.length?[`Runtime CSP contract: inline event handlers are blocked by default-src 'self'. Move HTML onclick/oninput and JavaScript-generated inline handlers to external script addEventListener or event delegation; preserve every action. Affected HTML: ${affected.join(', ')}. Do not weaken the preview CSP.`]:[];
}
