-- Execute este script no Supabase > SQL Editor.
-- Armazena os preços das calculadoras em um registro compartilhado.
create table if not exists public.calculator_prices (
  id text primary key check (id = 'default'),
  prices jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.calculator_prices enable row level security;

-- Usuários autenticados e ativos podem consultar os preços.
drop policy if exists "Authenticated users can read calculator prices" on public.calculator_prices;
create policy "Authenticated users can read calculator prices"
on public.calculator_prices for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.active = true
));

-- Somente administrador ativo pode inserir ou atualizar preços.
drop policy if exists "Only active admins can insert calculator prices" on public.calculator_prices;
create policy "Only active admins can insert calculator prices"
on public.calculator_prices for insert to authenticated
with check (
  updated_by = auth.uid() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'ADMIN' and p.active = true
  )
);

drop policy if exists "Only active admins can update calculator prices" on public.calculator_prices;
create policy "Only active admins can update calculator prices"
on public.calculator_prices for update to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'ADMIN' and p.active = true
))
with check (
  updated_by = auth.uid() and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'ADMIN' and p.active = true
  )
);

-- Não permitir exclusão do registro por usuários autenticados.
revoke delete on public.calculator_prices from anon, authenticated;
grant select, insert, update on public.calculator_prices to authenticated;
revoke all on public.calculator_prices from anon;
