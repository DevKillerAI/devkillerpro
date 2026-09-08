"use client";
import { useEffect, type RefObject } from "react";
import { imageBridgeResult, visionBridgeNeedsConfirmation } from './imageBridgeProtocol';
import {productBridgeResult} from './productBridgeProtocol';
import {publicImageBridgeResult} from './publicImageBridgeProtocol';

export function useVisionBridge(frame:RefObject<HTMLIFrameElement|null>,missionId?:string) {
  useEffect(()=>{
    let busy=false,publicRequests=0,publicQueued=0;
    const publicWaiters:Array<()=>void>=[];
    const controller=new AbortController();
    const acquirePublic=async()=>{
      if(publicRequests<4){publicRequests+=1;return true;}
      if(publicQueued>=2)return false;
      publicQueued+=1;await new Promise<void>(resolve=>publicWaiters.push(resolve));publicQueued-=1;
      if(controller.signal.aborted)return false;
      publicRequests+=1;return true;
    };
    const releasePublic=()=>{publicRequests=Math.max(0,publicRequests-1);publicWaiters.shift()?.();};
    const listener=async(event:MessageEvent)=>{
      if(!missionId || event.source!==frame.current?.contentWindow || !['DEVKILLER_VISION_REQUEST','DEVKILLER_IMAGE_REQUEST','DEVKILLER_PRODUCT_IMPORT_REQUEST','DEVKILLER_PUBLIC_IMAGE_REQUEST'].includes(event.data?.type)) return;
      const generating=event.data.type==='DEVKILLER_IMAGE_REQUEST';
      const importing=event.data.type==='DEVKILLER_PRODUCT_IMPORT_REQUEST';
      const publicImage=event.data.type==='DEVKILLER_PUBLIC_IMAGE_REQUEST';
      const target=frame.current.contentWindow;
      const {id,imageDataUrl,prompt,url,query}=event.data;
      if(typeof id!=="string"||id.length>100) return;
      const reply=(data:unknown)=>target?.postMessage(publicImage?publicImageBridgeResult(id,data):importing?productBridgeResult(id,data):imageBridgeResult(generating?'DEVKILLER_IMAGE_RESULT':"DEVKILLER_VISION_RESULT",id,data),"*");
      let publicSlot=false;
      if(publicImage){if(typeof query!=='string'||query.trim().length<3||query.length>160){reply({success:false,error:'Invalid public image query.'});return;}publicSlot=await acquirePublic();if(!publicSlot){reply({success:false,error:'Too many public image searches are queued.'});return;}}
      else {if(busy){reply({success:false,error:"An image operation is already active."});return;}if(importing?(typeof url!=="string"||url.length>2048):((!generating&&(typeof imageDataUrl!=="string"||imageDataUrl.length>5_600_000))||typeof prompt!=="string")){reply({success:false,error:importing?"Invalid product URL.":"Invalid image request."});return;}busy=true;}
      try {
        const question=importing?'Open this product page through DevKiller’s protected importer?':"Send this image and its instructions to OpenAI for analysis? This uses your API account.";
        if(!publicImage&&visionBridgeNeedsConfirmation(event.data.type)&&!window.confirm(question)){reply({success:false,error:importing?"Product import cancelled.":"Image request cancelled."});return;}
        const endpoint=publicImage?'/api/apps/public-image':importing?'/api/apps/product-import':generating?'/api/apps/image':"/api/apps/vision";
        const body=publicImage?{missionId,query}:importing?{missionId,url}:generating?{missionId,prompt}:{missionId,imageDataUrl,prompt};
        const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal});
        reply(await response.json());
      } catch {reply({success:false,error:publicImage?'Public image search failed.':importing?"Product import connection failed.":"Image analysis connection failed."});}
      finally{if(publicImage&&publicSlot)releasePublic();else if(!publicImage)busy=false;}
    };
    window.addEventListener("message",listener);
    return ()=>{controller.abort();publicWaiters.splice(0).forEach(resolve=>resolve());window.removeEventListener("message",listener);};
  },[frame,missionId]);
}
