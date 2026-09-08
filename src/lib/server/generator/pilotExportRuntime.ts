/** Reviewed optional export tooling. It never executes candidate source in Node. */
export function exportedBuildScript(title:string) {
  return `import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('dist/assets',{recursive:true});
await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import App from './src/App';import './src/styles.css';createRoot(document.getElementById('root')).render(<App/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'browser',format:'iife',target:'es2022',jsx:'automatic',minify:true,outfile:'dist/assets/app.js',define:{'process.env.NODE_ENV':'"production"'}});
const title=${JSON.stringify(title)};
const safe=title.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await writeFile('dist/index.html','<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safe+'</title><link rel="stylesheet" href="/assets/app.css"><script src="/assets/app.js" defer></script></head><body><div id="root"></div></body></html>');
`;
}
export function exportedServerScript(database:boolean,tableNames:string[]) {
  return `import http from 'node:http';
import {readFile} from 'node:fs/promises';
const database=${JSON.stringify(database)},tables=${JSON.stringify(tableNames)};
const port=Number(process.env.PORT||3000),key=process.env.SUPABASE_ANON_KEY||'',base=process.env.SUPABASE_URL||'';
if(database){const url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Configure SUPABASE_URL as the project API origin');
const anon=key.startsWith('sb_publishable_')||(key.split('.').length===3&&JSON.parse(Buffer.from(key.split('.')[1],'base64url')).role==='anon');if(!anon)throw new Error('Only the public anonymous/publishable key may be configured');}
const assets=new Map([['/','index.html'],['/index.html','index.html'],['/assets/app.js','assets/app.js'],['/assets/app.css','assets/app.css']]);
const csp="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;connect-src 'self';font-src 'self' data:;object-src 'none';base-uri 'none';frame-src 'none'";
http.createServer(async(req,res)=>{try{
const url=new URL(req.url,'http://127.0.0.1');
if(database&&url.pathname==='/runtime-config.js'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end('window.__DK_SUPABASE__='+JSON.stringify({anonKey:key,schema:'app',storageKey:'exported-app-auth'}).replace(/</g,'\\u003c')+';window.__DK_SUPABASE__.url=location.origin+"/supabase";');return;}
if(database&&url.pathname.startsWith('/supabase/')){
const route=url.pathname.slice(9),table=/^\\/rest\\/v1\\/([a-z][a-z0-9_]*)$/.exec(route)?.[1];
const allowed=table?tables.includes(table)&&['GET','HEAD','POST','PATCH','DELETE'].includes(req.method):(['/auth/v1/signup','/auth/v1/token','/auth/v1/logout'].includes(route)&&req.method==='POST')||(route==='/auth/v1/user'&&['GET','PUT'].includes(req.method));
if(!allowed||url.search.length>4096){res.writeHead(403);res.end();return;}
const parts=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){res.writeHead(413);res.end();return;}parts.push(chunk);}
const headers={apikey:key,Authorization:req.headers.authorization||'Bearer '+key,'Content-Type':'application/json','Accept-Profile':'app','Content-Profile':'app'};
for(const name of ['accept','prefer','x-supabase-api-version','x-client-info'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
const upstream=await fetch(base.replace(/\\/$/,'')+route+url.search,{method:req.method,headers,redirect:'error',signal:AbortSignal.timeout(15000),...(!['GET','HEAD'].includes(req.method)&&bytes?{body:Buffer.concat(parts)}:{})});
const output=[];let length=0;for await(const chunk of upstream.body||[]){length+=chunk.length;if(length>1048576)throw new Error('API response too large');output.push(chunk);}
res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('content-type')||'application/json','Cache-Control':'no-store',...(upstream.headers.get('content-range')?{'Content-Range':upstream.headers.get('content-range')}:{})});res.end(Buffer.concat(output));return;}
const file=assets.get(url.pathname);if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
let content=await readFile(new URL('./dist/'+file,import.meta.url),'utf8');if(database&&file==='index.html')content=content.replace('<head>','<head><script src="/runtime-config.js"></script>');
res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?'':content);
}catch{if(!res.headersSent)res.writeHead(502);res.end('Application service unavailable');}}).listen(port,'127.0.0.1',()=>console.log('App: http://127.0.0.1:'+port));
`;
}
