export function validPreviewAddress(value:unknown,domain=process.env.NEXT_PUBLIC_DK_PREVIEW_DOMAIN):value is string{
  if(typeof value!=='string')return false;
  if(/^http:\/\/dk-v2-[a-f0-9]{24}\.localhost:[0-9]{4,5}\/$/.test(value))return true;
  if(!domain||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain))return false;
  try{const u=new URL(value),prefix=u.hostname.slice(0,-domain.length-1);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.hostname===prefix+'.'+domain&&/^dkp-[a-f0-9]{24}$/.test(prefix)&&u.pathname==='/__dk_access'&&[...u.searchParams.keys()].join(',')==='token'&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(u.searchParams.get('token')||'');}catch{return false;}
}
