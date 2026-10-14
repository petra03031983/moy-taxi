create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  name text not null,
  phone text not null unique,
  password_salt text not null,
  password_hash text not null,
  is_online boolean not null default true,
  car_model text,
  car_plate text,
  session_token_hash text,
  session_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orders add column if not exists driver_id uuid references public.drivers(id) on delete set null;
create index if not exists orders_driver_created_at_idx on public.orders(driver_id, created_at desc);
create index if not exists orders_driver_status_idx on public.orders(driver_id, status);
create index if not exists drivers_public_code_idx on public.drivers(public_code);
alter table public.drivers enable row level security;
drop policy if exists drivers_service_role_all on public.drivers;
create policy drivers_service_role_all on public.drivers for all to service_role using (true) with check (true);
grant all privileges on table public.drivers to service_role;
