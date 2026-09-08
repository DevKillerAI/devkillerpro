import postgres, { type Sql } from "postgres";

let client: Sql | undefined;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error("DATABASE_URL is not configured on the server.");
  if (!client)
    client = postgres(connectionString, {
      max: Math.max(2, Math.min(20, Number(process.env.DATABASE_POOL_SIZE) || 8)),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  return client;
}

export async function closeDatabase() {
  if (!client) return;
  await client.end({ timeout: 5 });
  client = undefined;
}
