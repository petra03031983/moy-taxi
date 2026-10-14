alter table public.drivers
  add column if not exists vehicle_class text not null default 'economy';

alter table public.orders
  add column if not exists vehicle_class text not null default 'economy',
  add column if not exists route_distance_km numeric,
  add column if not exists trip_type text not null default 'city';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drivers_vehicle_class_check') then
    alter table public.drivers add constraint drivers_vehicle_class_check
      check (vehicle_class in ('economy','comfort','comfort_plus','business','minivan','premium'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_vehicle_class_check') then
    alter table public.orders add constraint orders_vehicle_class_check
      check (vehicle_class in ('economy','comfort','comfort_plus','business','minivan','premium'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_trip_type_check') then
    alter table public.orders add constraint orders_trip_type_check
      check (trip_type in ('city','intercity'));
  end if;
end $$;

alter table public.platform_settings
  add column if not exists vehicle_rates jsonb not null default
  '{
    "economy":{"rate_per_km":40,"minimum_fare":500},
    "comfort":{"rate_per_km":50,"minimum_fare":700},
    "comfort_plus":{"rate_per_km":60,"minimum_fare":900},
    "business":{"rate_per_km":80,"minimum_fare":1500},
    "minivan":{"rate_per_km":70,"minimum_fare":1200},
    "premium":{"rate_per_km":100,"minimum_fare":2000}
  }'::jsonb,
  add column if not exists test_mode boolean not null default true;

update public.platform_settings
set test_mode = true,
    updated_at = now()
where id is true;
