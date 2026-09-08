import http from 'node:http';
import {execFileSync} from 'node:child_process';
const names=['supabase_kong_dk_roomledger','supabase_db_dk_roomledger','supabase_kong_dk_queuepantry','supabase_db_dk_queuepantry'];
const endpoint=JSON.parse(execFileSync('docker',['context','inspect'],{encoding:'utf8'}))[0].Endpoints.docker.Host;
if(!endpoint.startsWith('npipe://'))throw new Error('Windows Docker pipe required');
const socketPath=endpoint.slice(8).replaceAll('/','\\');
function api(method,path,body,binary=false){return new Promise((resolve,reject)=>{
 const data=Buffer.isBuffer(body)?body:body?JSON.stringify(body):'';
 const req=http.request({socketPath,path,method,headers:{'Content-Type':Buffer.isBuffer(body)?'application/x-tar':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
 const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const raw=Buffer.concat(chunks);res.statusCode<300?resolve(binary?raw:raw.length?JSON.parse(raw.toString()):{}):reject(new Error(`Docker operation failed (${res.statusCode})`));});
 });req.on('error',reject);req.end(data);
});}
for(const name of names){
 const old=await api('GET',`/containers/${name}/json`);
 const copyGateway=async(source)=>{
   const config=old.Config.Env.find(v=>v.startsWith('KONG_DECLARATIVE_CONFIG='))?.split('=').slice(1).join('=');
   if(!config)return;
   // CLI injects its declarative config and local TLS certificates after creation.
   if(!config.startsWith('/home/kong/'))throw new Error('Unexpected gateway configuration directory');
   const archive=await api('GET',`/containers/${source}/archive?path=${encodeURIComponent('/home/kong/.')}`,undefined,true);
   await api('PUT',`/containers/${name}/archive?path=${encodeURIComponent('/home/kong')}`,archive);
 };
 if(Object.values(old.HostConfig.PortBindings||{}).flat().every(p=>p.HostIp==='127.0.0.1')){
   if(name.includes('_kong_')&&old.State.Restarting){
     const all=await api('GET','/containers/json?all=true');
     const backup=all.find(c=>c.Names.some(n=>n.startsWith('/'+name+'-pre-loopback-')));
     if(!backup)throw new Error('Gateway rollback copy missing');
     await api('POST',`/containers/${name}/stop?t=2`);
     await copyGateway(backup.Id);
     await api('POST',`/containers/${name}/start`);
   }
   continue;
 }
 const bindings=Object.fromEntries(Object.entries(old.HostConfig.PortBindings).map(([port,values])=>[port,values.map(v=>({...v,HostIp:'127.0.0.1'}))]));
 const backup=`${name}-pre-loopback-${Date.now()}`;
 await api('POST',`/containers/${name}/stop?t=10`);
 await api('POST',`/containers/${name}/rename?name=${backup}`);
 try{
   const network=old.HostConfig.NetworkMode;
   await api('POST',`/containers/create?name=${name}`,{...old.Config,HostConfig:{...old.HostConfig,PortBindings:bindings},NetworkingConfig:{EndpointsConfig:{[network]:{Aliases:[name]}}}});
   await copyGateway(backup);
   await api('POST',`/containers/${name}/start`);
   const current=await api('GET',`/containers/${name}/json`);
   if(!current.State.Running||Object.values(current.NetworkSettings.Ports).filter(Boolean).flat().some(p=>p.HostIp!=='127.0.0.1'))throw new Error('Loopback binding verification failed');
   // Keep the stopped original container for rollback. Named data volumes are unchanged.
   console.log(JSON.stringify({name,localOnly:true,rollbackContainer:backup}));
 }catch(error){
   await api('DELETE',`/containers/${name}?force=true`).catch(()=>{});
   await api('POST',`/containers/${backup}/rename?name=${name}`);
   // Leave it stopped instead of restoring an externally bound service.
   throw error;
 }
}
