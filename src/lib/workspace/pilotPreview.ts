export type PilotAsset = { path: string; content: string };
export const PILOT_STORAGE_LIMIT = 64 * 1024;
// Let React receive local submit events. CSP still forbids form destinations;
// origin, top-level navigation and popup permissions remain unavailable.
export const PILOT_PREVIEW_SANDBOX = 'allow-scripts allow-forms';

export function validPilotStorage(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 128 && entries.every(([key, item]) => key.length <= 500 && typeof item === 'string') &&
    new TextEncoder().encode(JSON.stringify(value)).length <= PILOT_STORAGE_LIMIT;
}

/** The parent fixes identity; the generated app cannot choose another namespace or command. */
export function acceptsPilotStorageMessage(data: unknown, runId: string, nonce: string): data is { type: string; runId: string; nonce: string; values: Record<string, string> } {
  if (!data || typeof data !== 'object') return false;
  const item = data as Record<string, unknown>;
  return item.type === 'dk-v2-storage' && item.runId === runId && item.nonce === nonce && validPilotStorage(item.values);
}

const scriptSafe = (value: string) => value.replace(/<\/script/gi, '<\\/script').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const jsonSafe = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/** Must use PILOT_PREVIEW_SANDBOX, without allow-same-origin. */
export function pilotPreviewDocument(files: PilotAsset[], runId: string, nonce: string, storage: Record<string, string>) {
  if (!/^[a-zA-Z0-9_-]{8,180}$/.test(runId) || !/^[a-zA-Z0-9_-]{16,80}$/.test(nonce) || !validPilotStorage(storage)) throw new Error('Invalid preview context.');
  const javascript = files.find(file => file.path === 'assets/app.js')?.content;
  const css = files.find(file => file.path === 'assets/app.css')?.content || '';
  if (!javascript) throw new Error('Verified browser bundle is missing.');
  const bootstrap = `(function(){
const runId=${jsonSafe(runId)},nonce=${jsonSafe(nonce)};
let values=Object.assign(Object.create(null),${jsonSafe(storage)});
const commit=next=>{if(Object.keys(next).length>128||new TextEncoder().encode(JSON.stringify(next)).length>${PILOT_STORAGE_LIMIT})throw new DOMException('Preview storage limit reached','QuotaExceededError');values=next;parent.postMessage({type:'dk-v2-storage',runId,nonce,values},'*');};
const storage={get length(){return Object.keys(values).length},key:i=>Object.keys(values)[i]??null,getItem:key=>Object.prototype.hasOwnProperty.call(values,String(key))?values[String(key)]:null,setItem:(key,value)=>{key=String(key);if(key.length>500)throw new DOMException('Storage key too long','QuotaExceededError');const next=Object.assign(Object.create(null),values);next[key]=String(value);commit(next);},removeItem:key=>{const next=Object.assign(Object.create(null),values);delete next[String(key)];commit(next);},clear:()=>commit(Object.create(null))};
try{Object.defineProperty(window,'localStorage',{value:storage,writable:true,configurable:true});}catch(e){try{window.localStorage=storage;}catch(_){}}
const origFetch=window.fetch;
window.fetch=async function(input,init){
  const urlStr=typeof input==='string'?input:(input&&typeof input==='object'&&'url' in input?input.url:String(input||''));
  if(urlStr.includes('/rest/v1/')||urlStr.includes('54321')){
    let tableName='default';
    try{const u=new URL(urlStr,'http://127.0.0.1:54321');const rIdx=u.pathname.indexOf('/rest/v1/');tableName=rIdx!==-1?u.pathname.slice(rIdx+9).split('?')[0]:'default';}catch{}
    const storageKey='__dk_table_'+tableName;
    let tableData=[];
    try{tableData=JSON.parse(storage.getItem(storageKey)||'[]');}catch{}
    const method=(init?.method||'GET').toUpperCase();
    if(method==='GET')return new Response(JSON.stringify(tableData),{status:200,headers:{'Content-Type':'application/json'}});
    if(method==='POST'){
      let body={};
      try{body=typeof init?.body==='string'?JSON.parse(init.body):{};}catch{}
      const item=Object.assign({id:(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'row-'+Date.now()),created_at:new Date().toISOString()},Array.isArray(body)?body[0]:body);
      tableData.unshift(item);
      try{storage.setItem(storageKey,JSON.stringify(tableData));}catch{}
      return new Response(JSON.stringify(Array.isArray(body)?[item]:item),{status:201,headers:{'Content-Type':'application/json','preference-applied':'return=representation'}});
    }
    if(method==='PATCH'){
      let body={};
      try{body=typeof init?.body==='string'?JSON.parse(init.body):{};}catch{}
      const item=Object.assign({id:'row-'+Date.now(),created_at:new Date().toISOString()},body);
      return new Response(JSON.stringify(item),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(method==='DELETE')return new Response('',{status:204});
  }
  if(urlStr.includes('/auth/v1/'))return new Response(JSON.stringify({user:null,session:null}),{status:200,headers:{'Content-Type':'application/json'}});
  return origFetch?origFetch.apply(this,arguments):Promise.reject(new TypeError('Failed to fetch'));
};
})();`;
  // Inline generated code is intentionally executable in the opaque frame. Do NOT
  // grant script nonces in CSP: code could copy one onto an external script URL.
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; img-src data: blob: https:; font-src data: https://fonts.gstatic.com; connect-src 'none'; media-src data: blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
  const baseModernCss = `
    *, *::before, *::after { box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
    body { margin: 0; font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    button, input, select, textarea { font-family: inherit; }
  `;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>DevKiller · verified preview</title><style>${baseModernCss} ${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script nonce="${nonce}">${scriptSafe(bootstrap)}</script><script nonce="${nonce}">${scriptSafe(javascript)}</script></body></html>`;
}
