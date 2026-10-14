alter table public.platform_settings
  add column if not exists dgis_api_key text;

comment on column public.platform_settings.dgis_api_key is
  'Private 2GIS Search/Geocoder/Routing API key. Never returned by public endpoints.';
