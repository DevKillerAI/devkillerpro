import type { DataProvider } from "./registry";

export interface FoundationTemplateFile { path: string; purpose: string; content: string }

const SQLITE: FoundationTemplateFile[] = [
  { path: ".env.example", purpose: "Safe local configuration contract", content: "DATABASE_URL=file:./data/app.db\n" },
  { path: "drizzle.config.ts", purpose: "Versioned migration configuration", content: `import { defineConfig } from "drizzle-kit";
export default defineConfig({ schema: "./src/db/schema.ts", out: "./drizzle", dialect: "sqlite", dbCredentials: { url: process.env.DATABASE_URL || "file:./data/app.db" } });` },
  { path: "src/db/schema.ts", purpose: "Typed durable record schema", content: `import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
export const owners = sqliteTable("owners", { id: text("id").primaryKey(), createdAt: integer("created_at", { mode: "timestamp" }).notNull() });
export const records = sqliteTable("records", { id: text("id").primaryKey(), ownerId: text("owner_id").notNull().references(() => owners.id, { onDelete: "cascade" }), title: text("title").notNull(), idempotencyKey: text("idempotency_key").notNull(), createdAt: integer("created_at", { mode: "timestamp" }).notNull() }, table => ({ idempotency: uniqueIndex("records_idempotency_key").on(table.idempotencyKey) }));` },
  { path: "src/db/client.ts", purpose: "Server-only database connection", content: `import "server-only";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
const sqlite = new Database(process.env.DATABASE_URL?.replace(/^file:/, "") || "./data/app.db");
sqlite.pragma("foreign_keys = ON");
export const db = drizzle(sqlite);` },
  { path: "drizzle/0001_initial.sql", purpose: "Repeatable initial migration", content: `PRAGMA foreign_keys = ON;
CREATE TABLE owners (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE records (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200), idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE INDEX records_owner_created_idx ON records(owner_id, created_at);` },
  { path: "tests/database.test.ts", purpose: "Temporary-database integrity and transaction tests", content: `// Adapt to the selected test runner. The suite is blocking and must use a fresh temporary database.
// Assert: migrations apply twice safely; foreign_keys=1; duplicate idempotency_key fails;
// an invalid owner fails; transaction rollback leaves no partial records; valid CRUD survives reconnect.` },
];

const SUPABASE: FoundationTemplateFile[] = [
  { path: ".env.example", purpose: "Public Supabase configuration contract", content: "NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=\n" },
  { path: "supabase/config.toml", purpose: "Local Supabase and database-test configuration", content: `project_id = "replace-with-project-id"
[db]
major_version = 17
[auth]
enabled = true` },
  { path: "supabase/migrations/0001_records.sql", purpose: "Schema, grants, and RLS in one migration", content: `create table public.records (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, title text not null check (char_length(title) between 1 and 200), created_at timestamptz not null default now());
alter table public.records enable row level security;
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;
create policy "records_select_owner" on public.records for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "records_insert_owner" on public.records for insert to authenticated with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "records_update_owner" on public.records for update to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = owner_id) with check ((select auth.uid()) is not null and (select auth.uid()) = owner_id);
create policy "records_delete_owner" on public.records for delete to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = owner_id);` },
  { path: "supabase/tests/records_rls.test.sql", purpose: "Allow and deny authorization evidence", content: `begin;
select plan(7);
select has_table('public', 'records', 'records exists');
select ok((select relrowsecurity from pg_class where oid='public.records'::regclass), 'RLS enabled');
select policies_are('public', 'records', array['records_delete_owner','records_insert_owner','records_select_owner','records_update_owner']);
set local role anon;
select throws_ok($$ select * from public.records $$, '42501', null, 'anonymous read denied by grants');
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@example.test', '', now(), now()),
       ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stranger@example.test', '', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok($$ insert into public.records(owner_id,title) values ('11111111-1111-1111-1111-111111111111','Owner record') $$, 'owner insert allowed');
select results_eq($$ select count(*)::bigint from public.records $$, array[1::bigint], 'owner reads own row');
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select results_eq($$ select count(*)::bigint from public.records $$, array[0::bigint], 'stranger cannot read owner row');
select * from finish();
rollback;` },
  { path: "src/lib/supabase/client.ts", purpose: "Browser client with publishable credentials only", content: `import { createBrowserClient } from "@supabase/ssr";
export function createClient() { return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!); }` },
  { path: "src/lib/supabase/server.ts", purpose: "Cookie-backed server client", content: `import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
export async function createClient() { const store = await cookies(); return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => store.getAll(), setAll: values => { try { values.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} } } }); }` },
];

const FIREBASE: FoundationTemplateFile[] = [
  { path: ".env.example", purpose: "Public Firebase web configuration contract", content: "NEXT_PUBLIC_FIREBASE_API_KEY=\nNEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=\nNEXT_PUBLIC_FIREBASE_PROJECT_ID=\n" },
  { path: "firebase.json", purpose: "Deterministic emulator and deployment configuration", content: `{"firestore":{"rules":"firestore.rules","indexes":"firestore.indexes.json"},"emulators":{"auth":{"port":9099},"firestore":{"port":8080},"ui":{"enabled":true}}}` },
  { path: "firestore.indexes.json", purpose: "Versioned query indexes", content: `{"indexes":[],"fieldOverrides":[]}` },
  { path: "firestore.rules", purpose: "Deny-by-default owner authorization", content: `rules_version = '2';
service cloud.firestore { match /databases/{database}/documents {
  function signedIn() { return request.auth != null; }
  match /records/{recordId} {
    allow create: if signedIn() && request.resource.data.ownerId == request.auth.uid && request.resource.data.keys().hasOnly(['ownerId','title','createdAt']) && request.resource.data.title is string && request.resource.data.title.size() > 0 && request.resource.data.title.size() <= 200;
    allow read, delete: if signedIn() && resource.data.ownerId == request.auth.uid;
    allow update: if signedIn() && resource.data.ownerId == request.auth.uid && request.resource.data.ownerId == resource.data.ownerId && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['title']);
  }
  match /{document=**} { allow read, write: if false; }
} }` },
  { path: "src/lib/firebase/client.ts", purpose: "Singleton modular Firebase client", content: `import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
const config = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID };
export const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);` },
  { path: "tests/firestore.rules.test.ts", purpose: "Emulator allow/deny regression suite", content: `import { afterAll, beforeAll, describe, it } from "vitest";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
let env: RulesTestEnvironment;
beforeAll(async () => { env = await initializeTestEnvironment({ projectId: "demo-devkiller-rules-test", firestore: { rules: await readFile("firestore.rules", "utf8") } }); });
afterAll(async () => env.cleanup());
describe("records authorization", () => {
  it("denies unauthenticated reads", async () => assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "records/one"))));
  it("allows an owner and denies another user", async () => { const owner = env.authenticatedContext("owner").firestore(); const stranger = env.authenticatedContext("stranger").firestore(); await assertSucceeds(setDoc(doc(owner, "records/one"), { ownerId: "owner", title: "Verified", createdAt: new Date() })); await assertFails(getDoc(doc(stranger, "records/one"))); });
  it("prevents ownership transfer", async () => assertFails(updateDoc(doc(env.authenticatedContext("owner").firestore(), "records/one"), { ownerId: "stranger" })));
  it("rejects unknown fields and invalid shapes", async () => assertFails(setDoc(doc(env.authenticatedContext("owner").firestore(), "records/invalid"), { ownerId: "owner", title: "", createdAt: new Date(), admin: true })));
});` },
];

export function getFoundationTemplates(provider: DataProvider) {
  if (provider === "sqlite") return SQLITE;
  if (provider === "supabase") return SUPABASE;
  if (provider === "firebase") return FIREBASE;
  return [];
}

export function formatFoundationTemplates(provider: DataProvider) {
  const files = getFoundationTemplates(provider);
  if (!files.length) return "No reusable data-foundation files are required.";
  return `CERTIFIED REFERENCE FOUNDATION — adapt domain names but preserve security behavior:\n${files.map(file => `FILE ${file.path}\nPURPOSE ${file.purpose}\n${file.content}`).join("\n\n")}`;
}
