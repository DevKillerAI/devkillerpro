create table if not exists public.admin_review_notes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  check_id text not null,
  state text not null check (state in ('pending','in_progress','verified')),
  note text not null default '' check (length(note)<=2000),
  updated_at timestamptz not null default now(),
  primary key(owner_id,check_id)
);
alter table public.admin_review_notes enable row level security;
revoke all on public.admin_review_notes from anon, authenticated;
