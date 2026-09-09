'use strict';
// Trusted platform service; generated application code never executes in this process.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const exec=require('node:util').promisify(require('node:child_process').execFile);
function signature(value,secret){return crypto.createHmac('sha256',secret).update(value).digest('base64url');}
function equal(a,b){return typeof a==='string'&&typeof b==='string'&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));}
function issue(host,key,secret,now=Date.now()){const value=Buffer.from(JSON.stringify({host,key,exp:now+900000})).toString('base64url');return value+'.'+signature(value,secret);}
function verify(token,host,key,secret,now=Date.now()){
 try{if(typeof token!=='string'||token.length>1000)return false;const [value,mac,...extra]=token.split('.');if(extra.length||!equal(mac,signature(value,secret)))return false;const p=JSON.parse(Buffer.from(value,'base64url'));return p.host===host&&p.key===key&&Number.isSafeInteger(p.exp)&&p.exp>now&&p.exp<=now+900000;}catch{return false;}
}
async function main(){
 const secret=process.env.DEVKILLER_WORKER_TOKEN,domain=process.env.DK_PREVIEW_DOMAIN;
 if(!secret||secret.length<32||!domain||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain))throw Error('Preview gateway configuration missing');
 const root=path.resolve('.devkiller/preview-gateway');await fs.mkdir(root,{recursive:true,mode:0o700});
 const hostFor=key=>'dkp-'+key.slice(0,24)+'.'+domain;
 const read=async host=>{const prefix=host.split('.')[0];if(!/^dkp-[a-f0-9]{24}$/.test(prefix)||host!==prefix+'.'+domain)return null;try{const r=JSON.parse(await fs.readFile(path.join(root,prefix+'.json'),'utf8'));return r.host===host&&/^[a-f0-9]{64}$/.test(r.key)&&hostFor(r.key)===host?r:null;}catch{return null;}};
 const inspect=async key=>{
   const name='dk-v2-preview-'+key.slice(0,24);const {stdout}=await exec('docker',['inspect',name],{timeout:10000,maxBuffer:128000});const info=JSON.parse(stdout)[0],ports=info.NetworkSettings?.Ports?.['3000/tcp'];
   if(info.Config?.Labels?.['devkiller.v2.preview']!==key||!info.State?.Running||!info.HostConfig?.ReadonlyRootfs||info.Config?.User?.split(':')[0]==='0'||!Array.isArray(ports)||ports.length!==1||ports[0].HostIp!=='127.0.0.1')throw Error('Preview binding invalid');
   const port=Number(ports[0].HostPort);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');return {id:info.Id,port};
 };
 const send=(res,status,text)=>{res.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(text);};
 http.createServer(async(req,res)=>{try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(req.method==='GET'&&url.pathname==='/tls-check'){const r=await read(url.searchParams.get('domain')||'');return send(res,r?200:403,r?'Allowed':'Denied');}
   if(req.method!=='POST'||url.pathname!=='/register'||!equal(req.headers.authorization,'Bearer '+secret))return send(res,403,'Denied');
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return send(res,413,'Too large');}
   const {key}=JSON.parse(body);if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))return send(res,400,'Invalid key');
   const host=hostFor(key),binding=await inspect(key);const filename=path.join(root,'dkp-'+key.slice(0,24)+'.json');
   if((await fs.readdir(root)).length>=128&&!await read(host))return send(res,429,'Preview capacity reached');
   await fs.writeFile(filename,JSON.stringify({host,key,...binding}),{mode:0o600});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({url:'https://'+host+'/__dk_access?token='+issue(host,key,secret)}));
 }catch{send(res,503,'Preview registration unavailable');}}).listen(3011,'127.0.0.1');
 http.createServer(async(req,res)=>{try{
   const host=req.headers.host||'',r=await read(host);if(!r)return send(res,404,'Preview unavailable');
   const url=new URL(req.url,'https://'+host);
   if(req.method==='GET'&&url.pathname==='/__dk_access'){
     const token=url.searchParams.get('token');if(!verify(token,host,r.key,secret))return send(res,403,'Preview link expired. Reopen it from DK Create.');
     res.writeHead(303,{'Location':'/','Set-Cookie':'__Host-dk-preview='+token+'; Path=/; Secure; HttpOnly; SameSite=None; Partitioned; Max-Age=900','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
   }
   const cookie=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-dk-preview='))?.slice('__Host-dk-preview='.length);
   if(!verify(cookie,host,r.key,secret))return send(res,403,'Open this preview from DK Create to continue.');
   const binding=await inspect(r.key);if(binding.id!==r.id||binding.port!==r.port)return send(res,409,'Preview changed. Reopen it from DK Create.');
   if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method))return send(res,405,'Method unavailable');
   const headers={...req.headers,host:'127.0.0.1:'+r.port};delete headers.cookie;delete headers.connection;delete headers['x-forwarded-host'];delete headers['x-forwarded-for'];
   const upstream=http.request({hostname:'127.0.0.1',port:r.port,path:url.pathname+url.search,method:req.method,headers,timeout:30000},out=>{
     const h={...out.headers,'cache-control':'no-store','referrer-policy':'no-referrer'};delete h['set-cookie'];h['content-security-policy']=(h['content-security-policy']||"default-src 'none'")+"; frame-ancestors "+new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
     res.writeHead(out.statusCode||502,h);out.pipe(res);
   });let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>262144){upstream.destroy();req.destroy();}});
   upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)send(res,502,'Preview service unavailable');else res.end();});req.pipe(upstream);
 }catch{if(!res.headersSent)send(res,503,'Preview unavailable');else res.end();}}).listen(3010,'127.0.0.1');
 console.log('Isolated preview gateway ready.');
}
module.exports={issue,verify};if(require.main===module)main().catch(()=>{console.error('Preview gateway failed to initialize');process.exitCode=1;});
