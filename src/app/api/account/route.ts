import { NextResponse } from "next/server";
import { accessContext, accessError } from "@/lib/server/access";
import { database } from "@/lib/server/database";
import { ownerAdminAllowed } from "@/lib/admin/metrics";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    const access = await accessContext(req);
    const [profile] = await database()`select p.display_name,p.role,p.credit_limit,p.credits_used,p.generator_enabled,p.generation_budget_micros,u.email,
      coalesce(c.spent_micros,0) as generator_spent_micros,coalesce(c.reserved_micros,0) as generator_reserved_micros
      from profiles p join auth.users u on u.id=p.id
      left join dk_generator_v2.campaigns c on c.owner_id=p.id::text and c.campaign_id='pilot-20260903'
      where p.id=${access.userId}`;
    const unlimited = profile.credit_limit === null;
    const administration = ownerAdminAllowed(profile.role,profile.email,process.env.DEVKILLER_PILOT_EMAIL,access.internal);
    return NextResponse.json({ success: true, account: { administration, name: profile.display_name, email: profile.email, role: profile.role, unlimited, creditsRemaining: unlimited ? null : Math.max(0, Number(profile.credit_limit)-Number(profile.credits_used)), creditLimit: unlimited ? null : Number(profile.credit_limit), generatorEnabled:Boolean(profile.generator_enabled), generatorBudgetMicros:profile.generation_budget_micros===null?null:Number(profile.generation_budget_micros), generatorSpentMicros:Number(profile.generator_spent_micros), generatorReservedMicros:Number(profile.generator_reserved_micros) } }, {headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    const known=accessError(error); return NextResponse.json({success:false,error:known?.error||"Unable to load account."},{status:known?.status||500});
  }
}
