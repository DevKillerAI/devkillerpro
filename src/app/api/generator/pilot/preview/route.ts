import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOwnerAdmin } from '@/lib/server/adminAccess';
import { accessError, enforceRateLimit } from '@/lib/server/access';
import { getPilotRun, getPilotSnapshots } from '@/lib/server/generator/pilotStore';
import { readPilotDelivery } from '@/lib/server/generator/pilotDelivery';
import { startPrivateboardPreview } from '@/lib/server/generator/supabasePilotPreview';
import { digest, scopedId } from '@/lib/server/generator/contract';
import {isSameOriginRequest} from '@/lib/server/requestOrigin';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(req:Request) {
  try {
    if(!isSameOriginRequest(req))return NextResponse.json({error:'Forbidden'},{status:403,headers});
    const access=await requireOwnerAdmin(req);
    await enforceRateLimit(access,'generator:pilot:preview',8,60);
    const reader=req.body?.getReader();if(!reader)return NextResponse.json({error:'Request required.'},{status:400,headers});
    const pieces:Uint8Array[]=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024){await reader.cancel();return NextResponse.json({error:'Request too large.'},{status:413,headers});}pieces.push(part.value);}}finally{reader.releaseLock();}
    const body=z.object({runId:scopedId,sourceHash:digest}).strict().parse(JSON.parse(Buffer.concat(pieces).toString('utf8')));
    const run=await getPilotRun(body.runId,access.userId);
    if(!run||!run.accepted||run.accepted.sourceHash!==body.sourceHash||run.contract.runtime.id!=='react-supabase-pilot')return NextResponse.json({error:'No matching approved database delivery.'},{status:409,headers});
    const saved=(await getPilotSnapshots(body.runId,access.userId)).find(item=>item.candidate.sourceHash===body.sourceHash&&item.candidate.revision===run.accepted!.revision);
    const delivery=saved?await readPilotDelivery(saved.snapshot,run.accepted):null;
    if(!saved||!delivery)return NextResponse.json({error:'Approved source is unavailable.'},{status:409,headers});
    return NextResponse.json(await startPrivateboardPreview(saved.snapshot,run.contract,delivery),{headers});
  } catch(error) {
    const access=accessError(error);
    return NextResponse.json({error:access?.error||(error instanceof z.ZodError?'Invalid preview request.':'Unable to start the approved database preview. Existing source and data were preserved.')},{status:access?.status||(error instanceof z.ZodError?400:503),headers});
  }
}
