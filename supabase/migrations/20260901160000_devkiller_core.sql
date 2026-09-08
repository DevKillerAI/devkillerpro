create extension if not exists pgcrypto;

create type public.mission_status as enum (
  'queued', 'running', 'waiting', 'verified', 'failed', 'cancelled'
);

create type public.job_status as enum (
  'queued', 'running', 'retrying', 'completed', 'failed', 'cancelled'
);

create table public.missions (
  id text primary key,
  owner_id uuid references auth.users(id) on delete set null,
  prompt text not null,
  app_title text,
  status public.mission_status not null default 'queued',
  phase text not null default 'intake',
  progress smallint not null default 0 check (progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.mission_jobs (
  id uuid primary key default gen_random_uuid(),
  mission_id text not null references public.missions(id) on delete cascade,
  kind text not null default 'full_mission',
  status public.job_status not null default 'queued',
  priority smallint not null default 100,
  payload jsonb not null,
  attempts smallint not null default 0,
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  worker_id text,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index mission_jobs_active_mission_idx
  on public.mission_jobs (mission_id)
  where status in ('queued', 'running', 'retrying');
create index mission_jobs_claim_idx
  on public.mission_jobs (status, available_at, priority, created_at);

create table public.mission_events (
  id bigint generated always as identity primary key,
  mission_id text not null references public.missions(id) on delete cascade,
  job_id uuid references public.mission_jobs(id) on delete set null,
  event_type text not null,
  phase text not null,
  message text not null,
  progress smallint check (progress between 0 and 100),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index mission_events_timeline_idx
  on public.mission_events (mission_id, created_at desc);

create table public.mission_usage (
  id bigint generated always as identity primary key,
  mission_id text not null references public.missions(id) on delete cascade,
  stage text not null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  mission_id text references public.missions(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_owner_idx
  on public.notifications (owner_id, read_at, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger missions_touch_updated_at before update on public.missions
for each row execute function public.touch_updated_at();
create trigger mission_jobs_touch_updated_at before update on public.mission_jobs
for each row execute function public.touch_updated_at();

alter table public.missions enable row level security;
alter table public.mission_jobs enable row level security;
alter table public.mission_events enable row level security;
alter table public.mission_usage enable row level security;
alter table public.notifications enable row level security;

create policy "owners read missions" on public.missions for select
  to authenticated using (owner_id = auth.uid());
create policy "owners read mission events" on public.mission_events for select
  to authenticated using (
    exists (select 1 from public.missions m where m.id = mission_id and m.owner_id = auth.uid())
  );
create policy "owners read mission usage" on public.mission_usage for select
  to authenticated using (
    exists (select 1 from public.missions m where m.id = mission_id and m.owner_id = auth.uid())
  );
create policy "owners read notifications" on public.notifications for select
  to authenticated using (owner_id = auth.uid());
create policy "owners update notifications" on public.notifications for update
  to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke all on public.mission_jobs from anon, authenticated;
revoke all on public.mission_usage from anon, authenticated;
revoke insert, update, delete on public.missions from anon, authenticated;
revoke insert, update, delete on public.mission_events from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('mission-artifacts', 'mission-artifacts', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

create policy "owners read mission artifacts" on storage.objects for select
  to authenticated using (
    bucket_id = 'mission-artifacts'
    and exists (
      select 1 from public.missions m
      where m.id = (storage.foldername(name))[1] and m.owner_id = auth.uid()
    )
  );

comment on table public.mission_jobs is
  'Server-only durable job queue. Workers claim rows with SKIP LOCKED.';
