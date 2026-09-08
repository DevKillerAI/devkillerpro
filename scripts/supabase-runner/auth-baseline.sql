-- Test infrastructure: definitions inspected from the local Supabase Auth stack.
-- The bare Postgres image predates the GoTrue migrations that add JSON-claim fallback.
-- These are provider functions, not generated application code.
create or replace function auth.uid() returns uuid language sql stable as $function$
 select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
 (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub'))::uuid
$function$;
create or replace function auth.role() returns text language sql stable as $function$
 select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),
 (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'role'))::text
$function$;
create or replace function auth.email() returns text language sql stable as $function$
 select coalesce(nullif(current_setting('request.jwt.claim.email',true),''),
 (nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'email'))::text
$function$;
