create table if not exists public.road_object_observations (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique
    check (char_length(source_id) between 8 and 120),
  kind text not null
    check (kind in ('traffic-light', 'traffic-sign')),
  lat double precision not null
    check (lat between 47.0 and 55.0),
  lng double precision not null
    check (lng between 65.0 and 77.0),
  accuracy_m real not null
    check (accuracy_m >= 0 and accuracy_m <= 35),
  confidence real not null
    check (confidence >= 0.50 and confidence <= 1.0),
  detected_label text not null
    check (detected_label in ('traffic light', 'stop sign')),
  model text not null
    check (char_length(model) <= 100),
  captured_at timestamptz not null,
  review_status text not null default 'needs-review'
    check (review_status in ('needs-review', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists road_object_observations_captured_at_idx
  on public.road_object_observations (captured_at desc);
create index if not exists road_object_observations_kind_idx
  on public.road_object_observations (kind, captured_at desc);

alter table public.road_object_observations enable row level security;

revoke all on table public.road_object_observations from anon, authenticated;
grant select, insert on table public.road_object_observations to anon, authenticated;

drop policy if exists road_object_observations_read on public.road_object_observations;
create policy road_object_observations_read
  on public.road_object_observations
  for select
  to anon, authenticated
  using (review_status in ('needs-review', 'approved'));

drop policy if exists road_object_observations_insert on public.road_object_observations;
create policy road_object_observations_insert
  on public.road_object_observations
  for insert
  to anon, authenticated
  with check (
    review_status = 'needs-review'
    and kind in ('traffic-light', 'traffic-sign')
    and detected_label in ('traffic light', 'stop sign')
    and confidence between 0.50 and 1.0
    and accuracy_m between 0 and 35
    and lat between 47.0 and 55.0
    and lng between 65.0 and 77.0
  );
