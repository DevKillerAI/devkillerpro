import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGeneratorSnapshot, type GeneratorSnapshot } from '../src/lib/server/generator/versionedEdits';
import { supabasePilotScopeHash, type SupabasePilotEnvironment } from '../src/lib/server/generator/supabasePilotEnvironment';
import {
  assertWorkbenchMigrationContinuity, prepareWorkbenchDatabase, validateWorkbenchDatabaseSource,
  workbenchEnvironmentIdentity, type WorkbenchDatabaseDependencies,
} from '../src/lib/server/generator/workbenchDatabase';

const scope = { ownerId:'owner-example', projectId:'project-example', missionId:'mission-example', environmentId:'environment-example' };
const schema = (table = 'orders') => [
  'CREATE TABLE app.'+table+' (',
  'id uuid primary key default gen_random_uuid(),',
  'owner_id uuid not null default auth.uid() references auth.users(id),',
  'request_id uuid not null,',
  'title text not null, amount numeric(12,2) not null default 0, UNIQUE(owner_id, request_id));',
  'ALTER TABLE app.'+table+' ENABLE ROW LEVEL SECURITY;',
  'ALTER TABLE app.'+table+' FORCE ROW LEVEL SECURITY;',
  'GRANT SELECT, INSERT, UPDATE, DELETE ON app.'+table+' TO authenticated;',
  'CREATE POLICY '+table+'_owner ON app.'+table+' FOR ALL TO authenticated',
  'USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());',
].join('\n')+'\n';
function snapshot(sql = schema(), extras: {path:string;content:string}[] = [], css = 'body{}'): GeneratorSnapshot {
  return createGeneratorSnapshot({ scope, revision:'build-1', files:[
    {path:'src/App.tsx',content:'export default function App(){return null;}'},
    {path:'src/styles.css',content:css}, {path:'supabase/migrations/001_init.sql',content:sql}, ...extras,
  ] });
}
function fakeEnvironment(identity = workbenchEnvironmentIdentity(snapshot())): SupabasePilotEnvironment {
  const hash=supabasePilotScopeHash(identity), suffix=hash.slice(0,32);
  return {identity,scopeHash:hash,stackId:'dk_v2_'+suffix,network:'dk-v2-'+suffix,previewNetwork:'dk-v2-'+suffix+'-preview',
    dbContainer:'supabase_db_dk_v2_'+suffix,apiUrl:'http://127.0.0.1:54330',internalApiUrl:'http://dk-v2-api-'+suffix+':8000',
    anonKey:'sb_publishable_'+'a'.repeat(43),schema:'app',storageKey:'dk-v2-auth-'+hash};
}
function adapterFor(candidate: GeneratorSnapshot) {
  const calls:string[] = [], plan=validateWorkbenchDatabaseSource(candidate);
  const environment=fakeEnvironment(workbenchEnvironmentIdentity(candidate));
  const migrations=plan.migrations.map(({path,hash})=>({path,hash}));
  const adapter:WorkbenchDatabaseDependencies = {
    ensure:async () => { calls.push('ensure'); return environment; },
    apply:async () => { calls.push('apply'); return {scopeHash:environment.scopeHash,
      fingerprint:createHash('sha256').update(JSON.stringify(migrations)).digest('hex'),
      files:migrations.map(file=>({...file,appliedAt:'2026-09-05T10:00:00Z',reused:false})),appliedAt:'2026-09-05T10:00:00Z'}; },
    inspectGuards:async () => { calls.push('inspect'); return plan.tableNames.map(name=>({table:'app.'+name,enabled:true,forced:true,ownerMigrator:true})); },
  };
  return {adapter,calls};
}

test('generic schemas support several declared tables with real UUID owner defaults and forced RLS', () => {
  const result=validateWorkbenchDatabaseSource(snapshot(schema('orders')+schema('customers')));
  assert.deepEqual(result.tableNames,['customers','orders']);
  assert.equal(result.migrations.length,1);
});

test('SQL literals and comments cannot impersonate identity columns or RLS declarations', () => {
  for (const sql of [
    schema().replace('owner_id uuid not null default auth.uid()', "owner_id text default 'uuid not null default auth.uid()'"),
    schema().replace('owner_id uuid not null default auth.uid()', 'owner_id uuid /* not null default auth.uid() */'),
    schema().replace('owner_id uuid not null default auth.uid()', 'owner_id uuid default auth.uid() check (owner_id IS NOT NULL OR true)'),
    schema().replace('id uuid primary key', "description text default 'id uuid primary key'"),
    schema().replace('ALTER TABLE app.orders FORCE ROW LEVEL SECURITY;', '-- ALTER TABLE app.orders FORCE ROW LEVEL SECURITY;'),
  ]) assert.throws(()=>validateWorkbenchDatabaseSource(snapshot(sql)));
});

test('strict app SQL rejects destructive ALTER, foreign schemas, anonymous grants and unbounded table declarations', () => {
  for (const extra of [
    'ALTER TABLE app.orders DROP COLUMN title;',
    'ALTER TABLE app.orders DISABLE ROW LEVEL SECURITY;',
    'ALTER TABLE app.orders OWNER TO postgres;',
    'ALTER TABLE app.orders ADD COLUMN extra text, DROP COLUMN owner_id;',
    'CREATE TABLE public.stolen(id uuid primary key,owner_id uuid not null default auth.uid());',
    'GRANT SELECT ON app.orders TO anon;',
    'GRANT ALL ON ALL TABLES IN SCHEMA app TO authenticated;',
    'CREATE POLICY bypass ON app.orders TO authenticated, anon USING (true);',
  ]) assert.throws(()=>validateWorkbenchDatabaseSource(snapshot(schema()+extra)));
  assert.throws(()=>validateWorkbenchDatabaseSource(snapshot(Array.from({length:17},(_,i)=>schema('table_'+i)).join(''))));
});

test('every CRUD table requires a client request identity and per-owner idempotency constraint', () => {
  for (const sql of [
    schema().replace('request_id uuid not null,','request_id uuid,'),
    schema().replace('request_id uuid not null,','request_id uuid check (request_id IS NOT NULL OR true),'),
    schema().replace('request_id uuid not null,','request_id uuid not null default gen_random_uuid(),'),
    schema().replace('UNIQUE(owner_id, request_id)','UNIQUE(id, request_id)'),
    schema().replace('UNIQUE(owner_id, request_id)','UNIQUE(id) /* UNIQUE(owner_id, request_id) */'),
    schema().replace('request_id uuid not null,','request_id text not null,'),
  ]) assert.throws(()=>validateWorkbenchDatabaseSource(snapshot(sql)),/request_id/);
});

test('environment identity preserves CSS but fences every SQL revision and owner', () => {
  const base=snapshot(), styled=snapshot(schema(),[],'body{color:red}'),
    upgraded=snapshot(schema(),[{path:'supabase/migrations/002_note.sql',content:'ALTER TABLE app.orders ADD COLUMN note text;'}]);
  assert.deepEqual(workbenchEnvironmentIdentity(base),workbenchEnvironmentIdentity(styled));
  assert.notDeepEqual(workbenchEnvironmentIdentity(base),workbenchEnvironmentIdentity(upgraded));
  assert.throws(()=>assertWorkbenchMigrationContinuity(base,upgraded),/schema is immutable/);
  assert.doesNotThrow(()=>assertWorkbenchMigrationContinuity(base,upgraded,{allowNewMigrations:true}));
  const repaired=snapshot(schema().replace('title text','title varchar(200)'));
  assert.notDeepEqual(workbenchEnvironmentIdentity(base),workbenchEnvironmentIdentity(repaired));
  assert.throws(()=>assertWorkbenchMigrationContinuity(base,repaired),/immutable/);
  assert.throws(()=>assertWorkbenchMigrationContinuity(upgraded,base),/immutable/);
  const upgradeRepair=snapshot(schema(),[{path:'supabase/migrations/002_note.sql',content:'ALTER TABLE app.orders ADD COLUMN note varchar(100);'}]);
  assert.notDeepEqual(workbenchEnvironmentIdentity(upgraded),workbenchEnvironmentIdentity(upgradeRepair));
  assert.notDeepEqual(workbenchEnvironmentIdentity(base),
    workbenchEnvironmentIdentity(createGeneratorSnapshot({scope:{...scope,ownerId:'other-owner'},revision:base.revision,files:base.files})));
});

test('preparation checks source and expected identity before provisioning; every guard is independently required', async () => {
  const candidate=snapshot(schema('orders')+schema('customers')), {adapter,calls}=adapterFor(candidate);
  await assert.rejects(prepareWorkbenchDatabase(candidate,undefined,adapter,{...workbenchEnvironmentIdentity(candidate),ownerId:'other-owner'}),/identity changed/);
  assert.deepEqual(calls,[]);
  adapter.inspectGuards=async()=>[{table:'app.orders',enabled:true,forced:true,ownerMigrator:true}];
  await assert.rejects(prepareWorkbenchDatabase(candidate,undefined,adapter),/actual RLS/);
  assert.deepEqual(calls,['ensure','apply']);
});

test('migration receipts must attest exact files, source hashes and isolated scope', async () => {
  const candidate=snapshot(), {adapter,calls}=adapterFor(candidate);
  const apply=adapter.apply;
  adapter.apply=async(...args)=>({...await apply(...args),scopeHash:'a'.repeat(64)});
  await assert.rejects(prepareWorkbenchDatabase(candidate,undefined,adapter),/receipts/);
  assert.deepEqual(calls,['ensure','apply']);
  const good=adapterFor(candidate);
  const result=await prepareWorkbenchDatabase(candidate,undefined,good.adapter);
  assert.deepEqual(result.tableNames,['orders']);
  assert.deepEqual(good.calls,['ensure','apply','inspect']);
});

test('tampered snapshots and cancelled operations never allocate an environment', async () => {
  const candidate=snapshot(), {adapter,calls}=adapterFor(candidate);
  const tampered={...candidate,files:candidate.files.map(file=>file.path.endsWith('.sql')?{...file,content:schema('other')}:file)};
  await assert.rejects(prepareWorkbenchDatabase(tampered,undefined,adapter),/recorded hashes/);
  const cancelled=new AbortController();cancelled.abort(new Error('Stop requested'));
  await assert.rejects(prepareWorkbenchDatabase(candidate,cancelled.signal,adapter),/Stop requested/);
  assert.deepEqual(calls,[]);
});
