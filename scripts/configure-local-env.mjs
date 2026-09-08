import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const command = process.execPath;
const cli = resolve(root, "node_modules/supabase/dist/supabase.js");
const output = execFileSync(command, [cli, "status", "-o", "env"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

const emitted = new Map();
for (const line of output.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) emitted.set(match[1], match[2].replace(/^"|"$/g, ""));
}

const desired = new Map([
  ["DATABASE_URL", emitted.get("DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres"],
  ["DATABASE_POOL_SIZE", "8"],
  ["DEVKILLER_BACKGROUND_JOBS", "true"],
  ["DEVKILLER_INTERNAL_URL", "http://127.0.0.1:3000"],
  ["DEVKILLER_WORKER_POLL_MS", "2000"],
  ["NEXT_PUBLIC_SUPABASE_URL", emitted.get("API_URL") || "http://127.0.0.1:54321"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", emitted.get("ANON_KEY")],
  ["SUPABASE_SERVICE_ROLE_KEY", emitted.get("SERVICE_ROLE_KEY")],
]);

const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existing.split(/\r?\n/).filter(Boolean);
const seen = new Set();
const updated = lines.map((line) => {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!match || !desired.has(match[1])) return line;
  seen.add(match[1]);
  const value = desired.get(match[1]);
  return value ? `${match[1]}=${value}` : line;
});
for (const [key, value] of desired) {
  if (value && !seen.has(key)) updated.push(`${key}=${value}`);
}
writeFileSync(envPath, `${updated.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log("Local database, worker, and Supabase settings were configured without printing secrets.");
