-- Reconstructed baseline for a clean, buyer-owned Мой Такси database.
-- This migration is idempotent for existing tables. Verify on an isolated empty
-- Supabase project before using it as a production transfer recipe.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz not null default now(),
  photo_url text
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  destination_address text not null,
  comment text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  client_token uuid not null default gen_random_uuid()
);

create index if not exists orders_created_at_idx
  on public.orders(created_at desc);
create index if not exists orders_status_idx
  on public.orders(status, created_at desc);
create index if not exists clients_created_at_idx
  on public.clients(created_at desc);

create table if not exists public.driver_settings (
  id integer primary key check (id = 1),
  is_online boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.driver_settings(id) values (1) on conflict (id) do nothing;

alter table public.clients enable row level security;
alter table public.orders enable row level security;
alter table public.driver_settings enable row level security;

revoke all privileges on table public.clients from public, anon, authenticated;
revoke all privileges on table public.orders from public, anon, authenticated;
revoke all privileges on table public.driver_settings from public, anon, authenticated;
grant all privileges on table public.clients to service_role;
grant all privileges on table public.orders to service_role;
grant all privileges on table public.driver_settings to service_role;

drop policy if exists service_role_manage_clients on public.clients;
create policy service_role_manage_clients on public.clients
  for all to service_role using (true) with check (true);
drop policy if exists service_role_manage_orders on public.orders;
create policy service_role_manage_orders on public.orders
  for all to service_role using (true) with check (true);
