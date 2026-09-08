-- Private execution checkpoints. Never expose prompts/results through public APIs.
create table if not exists public.provider_requests (
  request_key text primary key,
  mission_id text not null references public.missions(id) on delete cascade,
  operation_key text not null,
  model text not null,
  schema_name text not null,
  response_id text,
  status text not null default 'submitting',
  result jsonb,
  diagnostic jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists provider_requests_operation on public.provider_requests(operation_key);
alter table public.provider_requests enable row level security;
revoke all on public.provider_requests from anon, authenticated;

create table if not exists public.pipeline_results (
  operation_key text primary key,
  mission_id text not null references public.missions(id) on delete cascade,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.pipeline_results enable row level security;
revoke all on public.pipeline_results from anon, authenticated;
