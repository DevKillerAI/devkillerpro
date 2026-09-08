-- Versioned installation path for the V2 schema previously created by the local setup helper.
-- Additive and safe to replay on existing V2 databases: no rows, budgets, or app schemas are deleted.
create schema if not exists dk_generator_v2;
revoke all on schema dk_generator_v2 from public;

create table if not exists dk_generator_v2.campaigns (
  owner_id text not null,
  campaign_id text not null,
  max_cost_micros bigint not null default 3000000 check (max_cost_micros between 1 and 9007199254740991),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  call_count integer not null default 0 check (call_count >= 0),
  created_at timestamptz not null default now(),
  primary key (owner_id, campaign_id)
);

create table if not exists dk_generator_v2.runs (
  owner_id text not null,
  id text not null,
  campaign_id text not null,
  contract jsonb not null,
  contract_hash text not null check (contract_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued','planning','building','verifying','awaiting_input','ready','failed','cancelling','cancelled')),
  sequence bigint not null default 0 check (sequence >= 0),
  fence bigint not null default 0 check (fence >= 0),
  worker_id text,
  lease_until timestamptz,
  max_cost_micros bigint not null check (max_cost_micros > 0),
  max_provider_calls integer not null check (max_provider_calls between 1 and 100),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  call_count integer not null default 0 check (call_count >= 0),
  candidate jsonb,
  accepted jsonb,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id,id),
  foreign key (owner_id,campaign_id) references dk_generator_v2.campaigns(owner_id,campaign_id)
);
create unique index if not exists one_live_run_per_campaign
  on dk_generator_v2.runs(owner_id,campaign_id)
  where status not in ('ready','failed','cancelled');

create table if not exists dk_generator_v2.events (
  owner_id text not null,
  run_id text not null,
  sequence bigint not null,
  type text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(owner_id,run_id,sequence),
  foreign key(owner_id,run_id) references dk_generator_v2.runs(owner_id,id)
);

create table if not exists dk_generator_v2.calls (
  owner_id text not null,
  run_id text not null,
  operation_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  model text not null,
  reserved_micros bigint not null check (reserved_micros > 0),
  actual_micros bigint check (actual_micros >= 0),
  status text not null default 'reserved' check (status in ('reserved','submitted','uncertain','completed','failed')),
  response_id text,
  request jsonb,
  result jsonb,
  usage jsonb,
  last_response_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,run_id,operation_id),
  foreign key(owner_id,run_id) references dk_generator_v2.runs(owner_id,id),
  check ((status in ('completed','failed')) = (actual_micros is not null))
);
create unique index if not exists one_pilot_call_per_response
  on dk_generator_v2.calls(response_id) where response_id is not null;

create table if not exists dk_generator_v2.snapshots (
  owner_id text not null,
  run_id text not null,
  revision text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null,
  candidate jsonb not null,
  created_at timestamptz not null default now(),
  primary key(owner_id,run_id,revision),
  foreign key(owner_id,run_id) references dk_generator_v2.runs(owner_id,id)
);

-- Billable capabilities used by an accepted preview belong to the V2 run, not
-- to the legacy public.missions table. Keeping this append-only record in the
-- isolated schema prevents a successful image response from failing on a
-- legacy foreign key while preserving owner/run provenance.
create table if not exists dk_generator_v2.asset_usage (
  id bigint generated always as identity primary key,
  owner_id text not null,
  run_id text not null,
  stage text not null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now(),
  foreign key(owner_id,run_id) references dk_generator_v2.runs(owner_id,id)
);
create index if not exists asset_usage_run_timeline
  on dk_generator_v2.asset_usage(owner_id,run_id,created_at desc);

create or replace function dk_generator_v2.reject_snapshot_update() returns trigger
language plpgsql as $$ begin raise exception 'Pilot snapshots are immutable'; end $$;
drop trigger if exists immutable_snapshot on dk_generator_v2.snapshots;
create trigger immutable_snapshot before update on dk_generator_v2.snapshots
for each row execute function dk_generator_v2.reject_snapshot_update();

alter table dk_generator_v2.campaigns enable row level security;
alter table dk_generator_v2.runs enable row level security;
alter table dk_generator_v2.events enable row level security;
alter table dk_generator_v2.calls enable row level security;
alter table dk_generator_v2.snapshots enable row level security;
alter table dk_generator_v2.asset_usage enable row level security;
-- No browser policies: trusted server connection only, with owner predicates in every API query.
revoke all on all tables in schema dk_generator_v2 from public;
revoke all on all functions in schema dk_generator_v2 from public;
revoke all on all sequences in schema dk_generator_v2 from public;
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on schema dk_generator_v2 from %I',role_name);
      execute format('revoke all on all tables in schema dk_generator_v2 from %I',role_name);
      execute format('revoke all on all functions in schema dk_generator_v2 from %I',role_name);
      execute format('revoke all on all sequences in schema dk_generator_v2 from %I',role_name);
    end if;
  end loop;
end $$;

-- Additive platform-owned worker liveness, separate from application databases.
create table if not exists dk_generator_v2.workers (
  id text primary key check (id ~ '^v2-worker-[a-zA-Z0-9-]+$'),
  seen_at timestamptz not null default clock_timestamp()
);
revoke all on dk_generator_v2.workers from public, anon, authenticated;
alter table dk_generator_v2.workers enable row level security;

-- Pilot campaigns still default to USD 3. Workbench ceilings are explicit trusted
-- configuration; widen the representable bound without changing any account or run budget.
alter table dk_generator_v2.campaigns drop constraint if exists campaigns_max_cost_micros_check;
alter table dk_generator_v2.campaigns add constraint campaigns_max_cost_micros_check
  check (max_cost_micros between 1 and 9007199254740991);
