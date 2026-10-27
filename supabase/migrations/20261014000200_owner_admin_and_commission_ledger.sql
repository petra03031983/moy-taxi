create table if not exists public.platform_settings (
  id boolean primary key default true check (id is true),
  owner_password_salt text not null,
  owner_password_hash text not null,
  admin_session_token_hash text,
  admin_session_expires_at timestamptz,
  commission_percent numeric not null default 5 check (commission_percent >= 0 and commission_percent <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
drop policy if exists platform_settings_service_role_all on public.platform_settings;
create policy platform_settings_service_role_all on public.platform_settings
  for all to service_role using (true) with check (true);
grant all privileges on table public.platform_settings to service_role;

create table if not exists public.platform_commissions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  fare numeric not null check (fare >= 0),
  commission_percent numeric not null check (commission_percent >= 0 and commission_percent <= 30),
  commission_amount numeric not null check (commission_amount >= 0),
  status text not null default 'due' check (status in ('due','paid')),
  paid_at timestamptz,
  paid_note text,
  created_at timestamptz not null default now()
);
create index if not exists platform_commissions_driver_status_idx
  on public.platform_commissions(driver_id, status, created_at desc);
create index if not exists platform_commissions_status_idx
  on public.platform_commissions(status, created_at desc);
alter table public.platform_commissions enable row level security;
drop policy if exists platform_commissions_service_role_all on public.platform_commissions;
create policy platform_commissions_service_role_all on public.platform_commissions
  for all to service_role using (true) with check (true);
grant all privileges on table public.platform_commissions to service_role;

-- First owner credential is provided to the owner privately after deployment.
-- If the row already exists, preserve the existing password and settings.
insert into public.platform_settings(id, owner_password_salt, owner_password_hash, commission_percent)
values (true, 'a2f49cdabc213ae3ecad7fa855616546', '78a2179cebdb1dfd2a13ee79dfbda60d5fe8aa4739cdab2b6e22bb25ebdee8c8', 5)
on conflict (id) do nothing;
