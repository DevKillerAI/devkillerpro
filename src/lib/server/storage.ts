import { createClient } from "@supabase/supabase-js";

function adminStorageClient() {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function archiveMissionDelivery(
  missionId: string,
  sourceFiles: unknown[],
) {
  const client = adminStorageClient();
  if (!client) return { archived: false, reason: "storage-not-configured" };
  const path = `${missionId}/delivery/source-files.json`;
  const body = JSON.stringify(
    { missionId, archivedAt: new Date().toISOString(), sourceFiles },
    null,
    2,
  );
  const { error } = await client.storage
    .from("mission-artifacts")
    .upload(path, new Blob([body], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`Artifact storage failed: ${error.message}`);
  return { archived: true, path };
}
