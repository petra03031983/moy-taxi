create table if not exists public.road_screen_evidence (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique
    check (char_length(source_id) between 8 and 120),
  kind text not null
    check (kind in ('speed-camera', 'traffic-light', 'speed-limit', 'roadwork', 'road-hazard')),
  source_text text not null
    check (char_length(source_text) between 3 and 160),
  observed_lat double precision not null
    check (observed_lat between 47.0 and 55.0),
  observed_lng double precision not null
    check (observed_lng between 65.0 and 77.0),
  accuracy_m real not null
    check (accuracy_m >= 0 and accuracy_m <= 60),
  gps_captured_at timestamptz not null,
  distance_ahead_m real
    check (distance_ahead_m is null or distance_ahead_m between 15 and 2000),
  estimated_lat double precision check (estimated_lat is null or estimated_lat between 47.0 and 55.0),
  estimated_lng double precision check (estimated_lng is null or estimated_lng between 65.0 and 77.0),
  confidence real not null default 0 check (confidence between 0 and 0.6),
  captured_at timestamptz not null,
  review_status text not null default 'needs-review'
    check (review_status in ('needs-review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  check ((estimated_lat is null and estimated_lng is null) or (estimated_lat is not null and estimated_lng is not null))
);

create index if not exists road_screen_evidence_captured_at_idx on public.road_screen_evidence (captured_at desc);
create index if not exists road_screen_evidence_kind_idx on public.road_screen_evidence (kind, captured_at desc);
alter table public.road_screen_evidence enable row level security;
revoke all on table public.road_screen_evidence from anon, authenticated;
grant select, insert on table public.road_screen_evidence to anon, authenticated;

drop policy if exists road_screen_evidence_read on public.road_screen_evidence;
create policy road_screen_evidence_read on public.road_screen_evidence
  for select to anon, authenticated using (review_status in ('needs-review', 'approved'));

drop policy if exists road_screen_evidence_insert on public.road_screen_evidence;
create policy road_screen_evidence_insert on public.road_screen_evidence
  for insert to anon, authenticated
  with check (
    review_status = 'needs-review'
    and kind in ('speed-camera', 'traffic-light', 'speed-limit', 'roadwork', 'road-hazard')
    and char_length(source_text) between 3 and 160
    and accuracy_m between 0 and 60
    and observed_lat between 47.0 and 55.0
    and observed_lng between 65.0 and 77.0
    and confidence between 0 and 0.6
  );
