alter table public.mission_jobs add column checkpoint jsonb not null default '{}'::jsonb;
