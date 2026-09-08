import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { database } from "@/lib/server/database";

export type AccessContext = { userId: string; role: "owner" | "tester" | "admin"; internal: boolean };
export type GeneratorEntitlement = AccessContext & { generatorBudgetMicros: number | null; managedAiEnabled: boolean };

export async function accessContext(req?: Request): Promise<AccessContext> {
  const internalToken = req?.headers.get("x-devkiller-worker-token");
  if (internalToken && process.env.DEVKILLER_WORKER_TOKEN && internalToken === process.env.DEVKILLER_WORKER_TOKEN)
    return { userId: "internal-worker", role: "admin", internal: true };
  const store = await cookies();
  const client = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => store.getAll(), setAll: () => undefined } },
  );
  const bearer=req?.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const { data: { user } } = bearer ? await client.auth.getUser(bearer) : await client.auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  const [profile] = await database()`select role,access_enabled from profiles where id=${user.id}`;
  if (!profile || profile.access_enabled !== true) throw new Error("ACCESS_DISABLED");
  return { userId: user.id, role: profile.role as AccessContext["role"], internal: false };
}

export async function requireGeneratorAccess(req?: Request): Promise<GeneratorEntitlement> {
  const access = await accessContext(req);
  if (access.internal) throw new Error("FORBIDDEN");
  const [profile] = await database()`select generator_enabled,generation_budget_micros,managed_ai_enabled from profiles where id=${access.userId}`;
  if (!profile?.generator_enabled) throw new Error("FORBIDDEN");
  const budget = profile.generation_budget_micros === null ? null : Number(profile.generation_budget_micros);
  if (budget !== null && (!Number.isSafeInteger(budget) || budget < 1)) throw new Error("CREDIT_LIMIT");
  return { ...access, generatorBudgetMicros: budget, managedAiEnabled: Boolean(profile.managed_ai_enabled) };
}

export async function requireMissionOwner(missionId: string, access: AccessContext) {
  if (access.internal || access.role === "admin") return;
  const rows = await database()`select id from missions where id=${missionId} and owner_id=${access.userId}`;
  if (!rows.length) throw new Error("FORBIDDEN");
}

export async function enforceRateLimit(access: AccessContext, bucket: string, limit = 20, seconds = 60) {
  if (access.internal) return;
  const [row] = await database()`
    insert into api_rate_limits(owner_id,bucket,window_started_at,request_count)
    values(${access.userId},${bucket},now(),1)
    on conflict(owner_id,bucket) do update set
      window_started_at=case when api_rate_limits.window_started_at < now()-(${seconds}*interval '1 second') then now() else api_rate_limits.window_started_at end,
      request_count=case when api_rate_limits.window_started_at < now()-(${seconds}*interval '1 second') then 1 else api_rate_limits.request_count+1 end
    returning request_count`;
  if (Number(row.request_count) > limit) throw new Error("RATE_LIMIT");
}

export function accessError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHENTICATED") return { status: 401, error: "Authentication required." };
  if (message === "ACCESS_DISABLED") return { status: 403, error: "This account's access has been paused by the workspace owner." };
  if (message === "FORBIDDEN") return { status: 403, error: "You do not have access to this resource." };
  if (message === "CREDIT_LIMIT") return { status: 402, error: "Mission credit limit reached." };
  if (message === "RATE_LIMIT") return { status: 429, error: "Too many requests. Please wait a moment." };
  return null;
}
