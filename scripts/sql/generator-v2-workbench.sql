-- Additive platform-owned worker liveness, separate from application databases.
create table if not exists dk_generator_v2.workers (
  id text primary key check (id ~ '^v2-worker-[a-zA-Z0-9-]+$'),
  seen_at timestamptz not null default clock_timestamp()
);
revoke all on dk_generator_v2.workers from public, anon, authenticated;
