alter table public.profiles
  add column if not exists access_enabled boolean not null default true,
  add column if not exists generator_enabled boolean not null default false,
  add column if not exists managed_ai_enabled boolean not null default false,
  add column if not exists generation_budget_micros bigint,
  add column if not exists access_revoked_at timestamptz;

alter table public.profiles drop constraint if exists profiles_generation_budget_micros_check;
alter table public.profiles add constraint profiles_generation_budget_micros_check
  check (generation_budget_micros is null or generation_budget_micros between 0 and 10000000);

comment on column public.profiles.access_enabled is
  'Central access switch. False blocks UI and API access even while an old auth token exists.';
comment on column public.profiles.generator_enabled is
  'Allows this account to use the isolated v2 application generator.';
comment on column public.profiles.generation_budget_micros is
  'Lifetime v2 pilot budget in USD millionths. NULL is reserved for the configured owner administrator.';

alter table public.pilot_invites
  add column if not exists generator_enabled boolean not null default false,
  add column if not exists generation_budget_micros bigint not null default 0;
alter table public.pilot_invites drop constraint if exists pilot_invites_generation_budget_micros_check;
alter table public.pilot_invites add constraint pilot_invites_generation_budget_micros_check
  check (generation_budget_micros between 0 and 10000000);

update public.profiles p
set generator_enabled = true,
    managed_ai_enabled = true,
    generation_budget_micros = null,
    access_enabled = true,
    access_revoked_at = null
from auth.users u
where u.id = p.id and p.role = 'admin';

create table if not exists public.workspace_access_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('access_enabled','access_disabled')),
  created_at timestamptz not null default now()
);
alter table public.workspace_access_events enable row level security;
revoke all on public.workspace_access_events from anon, authenticated;
create index if not exists workspace_access_events_target_idx
  on public.workspace_access_events(target_id, created_at desc);
