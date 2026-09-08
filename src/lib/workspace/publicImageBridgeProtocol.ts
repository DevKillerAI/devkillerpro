export function publicImageBridgeResult(id:string,data:unknown){
  const payload=data&&typeof data==='object'?data:{success:false,error:'Invalid host response.'};
  return {...payload,type:'DEVKILLER_PUBLIC_IMAGE_RESULT',id,data:payload};
}
