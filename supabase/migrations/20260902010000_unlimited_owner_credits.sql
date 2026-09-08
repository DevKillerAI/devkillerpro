alter table public.profiles alter column credit_limit drop not null;
comment on column public.profiles.credit_limit is 'NULL means explicitly unlimited; other accounts retain their configured cap.';
