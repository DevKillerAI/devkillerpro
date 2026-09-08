import { database } from "./database";

export async function canUseAppCapability(userId: string, missionId: string) {
  const sql=database();
  const [account]=await sql`select p.access_enabled,p.generator_enabled,u.email from profiles p join auth.users u on u.id=p.id where p.id=${userId}`;
  if(!account?.access_enabled)return false;
  const legacy=await sql`select id from missions where id=${missionId} and owner_id=${userId}
    and not coalesce((metadata->>'discarded')::boolean,false)`;
  if(legacy.length)return String(account.email||'').toLowerCase()===String(process.env.DEVKILLER_PILOT_EMAIL||'').toLowerCase();
  if(!account.generator_enabled)return false;
  const pilot=await sql`select id from dk_generator_v2.runs where id=${missionId} and owner_id=${userId}
    and status<>'cancelled'`;
  return pilot.length===1;
}

export async function canUseAppVision(userId:string,missionId:string){
  const [profile]=await database()`select p.managed_ai_enabled,u.email from profiles p join auth.users u on u.id=p.id where p.id=${userId}`;
  if(!profile?.managed_ai_enabled||String(profile.email||'').toLowerCase()!==String(process.env.DEVKILLER_PILOT_EMAIL||'').toLowerCase())return false;
  return canUseAppCapability(userId,missionId);
}

export async function missionVisionContract(missionId:string) {
  const [mission]=await database()`select owner_id from missions where id=${missionId}`;
  if(!mission?.owner_id || !await canUseAppCapability(mission.owner_id,missionId)) return "";
  return `OWNER-ONLY IMAGE GENERATION: If explicitly requested, the preview also accepts window.parent.postMessage({type:"DEVKILLER_IMAGE_REQUEST",id:crypto.randomUUID(),prompt:"image description"},"*"). Accept only parent messages with type DEVKILLER_IMAGE_RESULT and matching id. data is {success:true,imageDataUrl,model} or {success:false,error}. This uses gpt-image-2, one 1024-square low-quality PNG per request, maximum three requests per hour per owner. During the private test phase, the user's explicit Generate action is sufficient and the host does not show a second confirmation. Set a 135-second UI timeout; never retry automatically or generate on mount. Display the actual returned image and allow downloading it. This bridge is text-to-image only, not image editing. No provider credentials belong in app files. Outside the host explain integration is unavailable. OWNER-ONLY LIVE VISION BRIDGE: For image-understanding or meme requests, do not replace visual understanding with text-only local guesses. The DevKiller preview host exposes a live, authenticated OpenAI image-analysis service. Call it FROM THE GENERATED BROWSER UI (not the offline backend) by window.parent.postMessage({type:"DEVKILLER_VISION_REQUEST",id:crypto.randomUUID(),imageDataUrl:"data:image/png;base64,...",prompt:"user direction and tone"},"*"). Listen only to messages from window.parent with type DEVKILLER_VISION_RESULT and the same id. Result data is {success:true,context:string,captions:string[],model:string} or {success:false,error:string}. Add a 75-second timeout, remove listeners after completion, disable duplicate submissions, and show real failure states without fabricated captions. Resize uploads to a reasonable resolution, encode PNG/JPEG/WebP under 4 MB. Show disclosure that image and direction are sent to OpenAI; the host asks for consent. Render captions as text, compose selected text over the original image using canvas, and export the canvas as PNG. Local backend remains network-isolated and stores projects only. Never put API keys in generated files. Outside the DevKiller preview, explicitly report that a separately configured backend integration is needed. Tests must not claim a mocked AI response proves live image understanding. This bridge is available only to the configured pilot owner, including the New Tab preview.`;
}
