export function productBridgeResult(id:string,data:unknown){
  const payload=data&&typeof data==='object'?data:{success:false,error:'Invalid host response.'};
  return {...payload,type:'DEVKILLER_PRODUCT_IMPORT_RESULT' as const,id,data:payload};
}
