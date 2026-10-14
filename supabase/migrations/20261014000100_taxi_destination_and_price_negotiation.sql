alter table public.orders
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision,
  add column if not exists price_status text not null default 'pending',
  add column if not exists agreed_price numeric;

create index if not exists orders_price_status_idx
  on public.orders(driver_id, price_status, status);

comment on column public.orders.destination_lat is 'Client destination latitude for opening a direct 2GIS route.';
comment on column public.orders.destination_lng is 'Client destination longitude for opening a direct 2GIS route.';
comment on column public.orders.price_status is 'Price negotiation state: pending, driver_offered, accepted or declined.';
comment on column public.orders.agreed_price is 'Agreed fare after client accepts a price offer.';
