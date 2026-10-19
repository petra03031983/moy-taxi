alter table public.drivers
  add column if not exists tariff_modes jsonb not null default
  '{"economy":true,"noBargaining":true,"comfort":false,"seats6":false,"parcels":true}'::jsonb;

-- Seed sane initial preferences for drivers already registered before these settings existed.
update public.drivers
set tariff_modes = jsonb_build_object(
  'economy', true,
  'noBargaining', true,
  'comfort', vehicle_class in ('comfort','comfort_plus','business','premium'),
  'seats6', vehicle_class = 'minivan',
  'parcels', true
)
where tariff_modes is null
   or tariff_modes = '{"economy":true,"noBargaining":true,"comfort":false,"seats6":false,"parcels":true}'::jsonb;
