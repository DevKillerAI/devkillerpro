import {cp,mkdir,symlink,readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import http from 'node:http';
if(process.env.DEVKILLER_SERVE==='1'){
 const port=Number(process.env.DEVKILLER_SUPABASE_PORT),host=process.env.DEVKILLER_SUPABASE_BRIDGE;
 if(![55321,56321].includes(port)||!/^dk-supabase-app-[a-f0-9]+-gateway$/.test(host||''))throw new Error('Invalid isolated Supabase bridge');
 http.createServer((req,res)=>{
  const out=http.request({host,port:8000,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  out.on('error',()=>{res.writeHead(503);res.end('Supabase unavailable');});req.pipe(out);
 }).listen(port,'127.0.0.1');
}
await mkdir('/tmp/app',{recursive:true});
await cp('/candidate','/tmp/app',{recursive:true});
await symlink('/opt/runtime/node_modules','/tmp/app/node_modules');
const manifest=JSON.parse(await readFile('/tmp/app/package.json','utf8'));
const supported=JSON.parse(await readFile('/opt/runtime/package.json','utf8')).dependencies;
for(const dependency of Object.keys({...manifest.dependencies,...manifest.devDependencies})){
 if(!supported[dependency])throw new Error(`Unsupported dependency ${dependency}; isolated Next/Supabase runtime does not install generated packages.`);
 const requested=manifest.dependencies?.[dependency]??manifest.devDependencies?.[dependency];
 if(requested!==supported[dependency])throw new Error(`Pin ${dependency} to ${supported[dependency]} for this runtime (received ${requested}).`);
}
// Record actual build dependencies rather than silently claiming original pins were used.
await writeFile('/tmp/app/package.json',JSON.stringify({...manifest,dependencies:supported,devDependencies:{}}));
console.log(JSON.stringify({runtime:'next-supabase-v1',actualDependencies:supported}));
const run=(args)=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,args,{cwd:'/tmp/app',stdio:'inherit',env:process.env});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Next command exited ${code}`)));
});
await run(['/opt/runtime/node_modules/next/dist/bin/next','build']);
if(process.env.DEVKILLER_SERVE==='1')await run(['/opt/runtime/node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port','3000']);
