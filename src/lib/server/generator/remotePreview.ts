export async function remotePreviewAddress(key:string,localUrl:string):Promise<string>{
  if(!process.env.DK_PREVIEW_DOMAIN)return localUrl;
  if(!/^[a-f0-9]{64}$/.test(key)||!process.env.DEVKILLER_WORKER_TOKEN)throw new Error('Preview configuration unavailable.');
  const response=await fetch('http://127.0.0.1:3011/register',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.DEVKILLER_WORKER_TOKEN},body:JSON.stringify({key}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Isolated online preview unavailable.');
  const result=await response.json();const url=new URL(result.url);
  if(url.protocol!=='https:'||url.hostname!==`dkp-${key.slice(0,24)}.${process.env.DK_PREVIEW_DOMAIN}`||url.pathname!=='/__dk_access'||url.username||url.password||url.port)throw new Error('Invalid isolated online preview.');
  return url.href;
}
