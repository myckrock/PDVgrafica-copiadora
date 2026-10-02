-- Execute no Supabase SQL Editor antes de publicar a função.
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_unique on public.profiles (lower(email)) where email is not null and email <> '';
