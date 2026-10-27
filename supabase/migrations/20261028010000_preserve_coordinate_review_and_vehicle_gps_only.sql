create schema if not exists astana_private;

create table if not exists astana_private.road_coordinate_review_pairs (
  id uuid primary key default gen_random_uuid(),
  object_a_id uuid not null references public.road_objects(id) on delete restrict,
  object_b_id uuid not null references public.road_objects(id) on delete restrict,
  reason text not null check (reason in ('same_coordinates_different_kind', 'same_kind_within_50m')),
  distance_m double precision not null default 0,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed_distinct', 'confirmed_duplicate', 'resolved')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (object_a_id, object_b_id, reason),
  check (object_a_id <> object_b_id)
);

alter table astana_private.road_coordinate_review_pairs enable row level security;
revoke all on astana_private.road_coordinate_review_pairs from anon, authenticated;
revoke all on schema astana_private from anon, authenticated;

-- Preserve suspicious pairs for a separate review queue. Nothing is deleted or merged.
insert into astana_private.road_coordinate_review_pairs
  (object_a_id, object_b_id, reason, distance_m, lat, lng, notes)
select
  a.id, b.id, 'same_coordinates_different_kind', 0,
  (a.lat+b.lat)/2.0, (a.lng+b.lng)/2.0,
  'Exact coordinate match across different object kinds; preserve both pending manual review.'
from public.road_objects a
join public.road_objects b
  on a.id < b.id
 and a.kind <> b.kind
 and round(a.lat::numeric, 6) = round(b.lat::numeric, 6)
 and round(a.lng::numeric, 6) = round(b.lng::numeric, 6)
where a.lat is not null and a.lng is not null and b.lat is not null and b.lng is not null
on conflict (object_a_id, object_b_id, reason) do nothing;

insert into astana_private.road_coordinate_review_pairs
  (object_a_id, object_b_id, reason, distance_m, lat, lng, notes)
select
  a.id, b.id, 'same_kind_within_50m',
  sqrt(
    power((b.lat-a.lat)*111320.0, 2) +
    power((b.lng-a.lng)*111320.0*cos(radians((a.lat+b.lat)/2.0)), 2)
  ),
  (a.lat+b.lat)/2.0, (a.lng+b.lng)/2.0,
  'Same-kind objects within 50 metres; candidate pair only, do not merge automatically.'
from public.road_objects a
join public.road_objects b on a.id < b.id and a.kind = b.kind
where a.lat is not null and a.lng is not null and b.lat is not null and b.lng is not null
  and sqrt(
    power((b.lat-a.lat)*111320.0, 2) +
    power((b.lng-a.lng)*111320.0*cos(radians((a.lat+b.lat)/2.0)), 2)
  ) > 0.5
  and sqrt(
    power((b.lat-a.lat)*111320.0, 2) +
    power((b.lng-a.lng)*111320.0*cos(radians((a.lat+b.lat)/2.0)), 2)
  ) < 50.0
on conflict (object_a_id, object_b_id, reason) do nothing;

-- New icon sightings without a distance/map-matching estimate remain only GPS observations.
-- Historical rows intentionally remain untouched for manual review.
create or replace function public.normalize_screen_icon_ingest()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_prefix text;
  v_pattern text;
  v_hits integer;
  v_heading integer;
  v_same_as_vehicle boolean := false;
begin
  v_prefix := substring(NEW.source_text from '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%');
  if v_prefix is null then
    return NEW;
  end if;

  if (v_prefix ilike 'speed camera icon%' and NEW.kind <> 'speed-camera')
     or (v_prefix ilike 'traffic light icon%' and NEW.kind <> 'traffic-light') then
    NEW.review_status := 'rejected';
    return NEW;
  end if;

  v_pattern := substring(NEW.source_text from 'pattern=([a-z0-9-]+)');
  if v_pattern is null or v_pattern not in (
    'compound-speed-sign-with-upper-right-camera-badge',
    'camera-badge-on-speed-sign',
    'three-colour-traffic-light-icon',
    'pixel-sampled-three-colour-traffic-light-on-route',
    'legacy-icon-pass-by-gps'
  ) then
    v_pattern := 'legacy-icon-pass-by-gps';
  end if;

  v_hits := nullif(substring(NEW.source_text from 'hits=([0-9]{1,3})'), '')::integer;
  v_hits := greatest(2, least(100, coalesce(v_hits, 2)));
  v_heading := nullif(substring(NEW.source_text from 'heading=([0-9]{1,3})deg'), '')::integer;
  if v_heading is not null and v_heading > 359 then v_heading := null; end if;

  NEW.detection_method := 'icon-heuristic';
  NEW.icon_pattern := v_pattern;
  NEW.frame_hits := v_hits;
  if NEW.travel_heading_degrees is null then NEW.travel_heading_degrees := v_heading; end if;

  v_same_as_vehicle := NEW.distance_ahead_m is null
    and NEW.estimated_lat is not null
    and NEW.estimated_lng is not null
    and NEW.observed_lat is not null
    and NEW.observed_lng is not null
    and abs(NEW.estimated_lat - NEW.observed_lat) < 0.0000001
    and abs(NEW.estimated_lng - NEW.observed_lng) < 0.0000001;

  if NEW.estimated_lat is null or NEW.estimated_lng is null or v_same_as_vehicle then
    NEW.estimated_lat := null;
    NEW.estimated_lng := null;
    NEW.coordinate_method := 'vehicle-gps-only';
  else
    if NEW.coordinate_method not in ('distance-and-heading', 'icon-pass-by-gps') then
      NEW.coordinate_method := 'icon-pass-by-gps';
    end if;
  end if;

  return NEW;
end;
$function$;
