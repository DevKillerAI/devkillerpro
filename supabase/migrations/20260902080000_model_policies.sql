create table if not exists public.model_policy_history (
 id bigserial primary key,
 owner_id uuid not null references auth.users(id),
 policy jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists public.model_compatibility_checks (
 owner_id uuid not null references auth.users(id),
 model text not null,
 checked_at timestamptz not null default now(),
 primary key(owner_id,model)
);
alter table public.model_policy_history enable row level security;
alter table public.model_compatibility_checks enable row level security;
revoke all on public.model_policy_history,public.model_compatibility_checks from anon,authenticated;
revoke all on sequence public.model_policy_history_id_seq from anon,authenticated;
