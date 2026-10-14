alter table public.orders
  add column if not exists payment_method text not null default 'cash';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_check') then
    alter table public.orders add constraint orders_payment_method_check
      check (payment_method in ('cash','kaspi_gold'));
  end if;
end $$;

create table if not exists public.order_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  price numeric not null check (price >= 100 and price <= 1000000),
  status text not null default 'pending' check (status in ('pending','accepted','declined','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (order_id, driver_id)
);

create index if not exists order_offers_order_status_idx
  on public.order_offers (order_id, status, created_at);
create index if not exists order_offers_driver_status_idx
  on public.order_offers (driver_id, status, created_at);

alter table public.order_offers enable row level security;
drop policy if exists order_offers_service_role_all on public.order_offers;
create policy order_offers_service_role_all on public.order_offers
  for all to service_role using (true) with check (true);

comment on table public.order_offers is 'Driver price offers sent to a passenger for a single ride.';
comment on column public.orders.payment_method is 'Passenger preference: cash to driver or Kaspi Gold transfer; not a payment gateway transaction.';
