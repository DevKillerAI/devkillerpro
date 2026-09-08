create type public.app_role as enum ('owner', 'tester', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  role public.app_role not null default 'tester',
  credit_limit integer not null default 10 check (credit_limit between 0 and 10000),
  credits_used integer not null default 0 check (credits_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pilot_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  role public.app_role not null default 'tester',
  credit_limit integer not null default 5 check (credit_limit between 1 and 1000),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.api_rate_limits (
  owner_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  primary key (owner_id, bucket)
);

create table public.credit_ledger (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  mission_id text references public.missions(id) on delete set null,
  amount integer not null check (amount <> 0),
  reason text not null,
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_profile after insert on auth.users
for each row execute function public.create_profile_for_user();

alter table public.profiles enable row level security;
alter table public.pilot_invites enable row level security;
alter table public.api_rate_limits enable row level security;
alter table public.credit_ledger enable row level security;

create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
create policy "users update own display name" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "users read own credit ledger" on public.credit_ledger for select to authenticated using (owner_id = auth.uid());

revoke all on public.pilot_invites, public.api_rate_limits from anon, authenticated;
revoke insert, update, delete on public.credit_ledger from anon, authenticated;
grant select on public.profiles, public.credit_ledger to authenticated;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

create index credit_ledger_owner_idx on public.credit_ledger(owner_id, created_at desc);
create index pilot_invites_email_idx on public.pilot_invites(lower(email), expires_at desc);
