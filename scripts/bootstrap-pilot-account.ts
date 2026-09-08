import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

async function main() {
  const email = process.env.DEVKILLER_PILOT_EMAIL;
  const password = process.env.DEVKILLER_PILOT_PASSWORD;
  const displayName = process.env.DEVKILLER_PILOT_NAME;
  if (!email || !password || !displayName) throw new Error("Pilot account environment variables are required.");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
  if (listed.error) throw listed.error;
  let user = listed.data.users.find((candidate) => candidate.email === email);
  if (!user) {
    const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
    if (created.error) throw created.error;
    user = created.data.user;
  }
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  await sql`update profiles set display_name=${displayName}, role='admin' where id=${user.id}`;
  await sql`update missions set owner_id=${user.id} where owner_id is null`;
  await sql.end();
  console.log("Pilot owner created and existing missions assigned.");
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
