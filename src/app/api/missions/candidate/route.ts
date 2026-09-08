import { NextResponse } from 'next/server';
import { accessContext, requireMissionOwner, accessError } from '@/lib/server/access';
import { readArtifact } from '@/lib/server/missionRuntime';
export async function GET(req:Request) {
  try {
    const access=await accessContext(req);
    if(access.role!=='admin'||access.internal) return NextResponse.json({error:'Administrator access required.'},{status:403});
    const url=new URL(req.url), id=url.searchParams.get('mission')||'', attempt=url.searchParams.get('attempt')||'';
    if(!/^[a-zA-Z0-9_-]{8,180}$/.test(id)||!/^\d{1,2}$/.test(attempt)) return NextResponse.json({error:'Invalid candidate.'},{status:400});
    await requireMissionOwner(id,access);
    const candidate=await readArtifact<{sourceFiles:unknown}>(id,`build.candidate-${attempt}.json`);
    return NextResponse.json({sourceFiles:candidate.sourceFiles},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { const known=accessError(error); return NextResponse.json({error:known?.error||'Candidate unavailable.'},{status:known?.status||404}); }
}
