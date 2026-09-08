import { deflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { database, closeDatabase } from "../src/lib/server/database";

function png() {
  const crc=(bytes:Buffer)=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(name:string,data:Buffer)=>{const kind=Buffer.from(name);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const sum=Buffer.alloc(4);sum.writeUInt32BE(crc(Buffer.concat([kind,data])));return Buffer.concat([size,kind,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(128,0);header.writeUInt32BE(128,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc((128*3+1)*128);
  for(let y=0;y<128;y++) for(let x=0;x<128;x++) raw[y*385+1+x*3]=255;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(raw)),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
async function main() {
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
  const login=await client.auth.signInWithPassword({email:process.env.DEVKILLER_PILOT_EMAIL!,password:process.env.DEVKILLER_PILOT_PASSWORD!});
  if(login.error) throw login.error;
  const [mission]=await database()`select id from missions where owner_id=${login.data.user!.id} and not coalesce((metadata->>'discarded')::boolean,false) order by created_at desc limit 1`;
  if(!mission) throw new Error("An owned mission is required for this live check.");
  const response=await fetch((process.env.DEVKILLER_INTERNAL_URL||"http://127.0.0.1:3000")+"/api/apps/vision",{method:"POST",headers:{Authorization:`Bearer ${login.data.session!.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({missionId:mission.id,prompt:"Describe the dominant color visible in this image in English, then give three playful captions.",imageDataUrl:"data:image/png;base64,"+png()})});
  const result=await response.json();
  if(!response.ok||!result.success||!/red/i.test(result.context)) throw new Error("Live vision check failed: "+(result.error||"unexpected visual description"));
  console.log(JSON.stringify({liveVisionPassed:true,model:result.model,context:result.context,captions:result.captions.length}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>closeDatabase());
