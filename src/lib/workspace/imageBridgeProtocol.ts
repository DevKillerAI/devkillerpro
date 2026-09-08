/** v1 supports both the original nested payload and flat result consumers. */
export function imageBridgeResult(type:'DEVKILLER_IMAGE_RESULT'|'DEVKILLER_VISION_RESULT',id:string,data:unknown){
  const payload=data&&typeof data==='object'?data:{success:false,error:'Invalid host response.'};
  return {...payload,type,id,data:payload};
}

/** An explicit Generate click is the owner test-phase authorization. Importing
 * a URL or sending an existing photo for analysis still crosses a separate
 * data boundary and keeps its browser confirmation. */
export function visionBridgeNeedsConfirmation(type:string){
  return type!=='DEVKILLER_IMAGE_REQUEST';
}
