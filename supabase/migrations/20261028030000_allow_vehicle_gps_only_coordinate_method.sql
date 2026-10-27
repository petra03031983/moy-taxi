alter table public.road_screen_evidence
  drop constraint if exists road_screen_evidence_coordinate_method_check;

alter table public.road_screen_evidence
  add constraint road_screen_evidence_coordinate_method_check
  check (coordinate_method = any (array[
    'unknown'::text,
    'gps-observed'::text,
    'distance-and-heading'::text,
    'icon-pass-by-gps'::text,
    'vehicle-gps-only'::text
  ]));
