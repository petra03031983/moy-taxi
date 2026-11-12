-- Small, safe index cleanup from the sale-readiness audit.
-- The status index duplicated moy_taxi_orders_status_created_idx.
-- Add an index for the driver_ratings client foreign key.
create index if not exists driver_ratings_client_id_idx
  on public.driver_ratings(client_id);
drop index if exists public.orders_status_idx;
