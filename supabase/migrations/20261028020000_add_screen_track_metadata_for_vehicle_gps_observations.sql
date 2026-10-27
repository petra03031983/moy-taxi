alter table public.road_screen_evidence
  add column if not exists track_id text,
  add column if not exists screen_x_ratio real,
  add column if not exists screen_y_ratio real,
  add column if not exists vehicle_anchor_x_ratio real,
  add column if not exists vehicle_anchor_y_ratio real,
  add column if not exists track_start_lat double precision,
  add column if not exists track_start_lng double precision,
  add column if not exists track_start_at timestamptz,
  add column if not exists vehicle_speed_mps real,
  add column if not exists vehicle_bearing_degrees smallint;

create index if not exists road_screen_evidence_track_id_idx
  on public.road_screen_evidence (track_id)
  where track_id is not null;

create or replace function public.astana_guide_save_screen_evidence(p_access_key text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'astana_private', 'extensions'
as $function$
declare
  v_item jsonb;
  v_count integer := 0;
  v_added integer;
  v_total integer;
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Rows must be an array' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 30 then
    raise exception 'Send between 1 and 30 rows' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.road_screen_evidence
      (source_id,kind,source_text,observed_lat,observed_lng,accuracy_m,gps_captured_at,
       distance_ahead_m,estimated_lat,estimated_lng,confidence,captured_at,review_status,
       detection_method,travel_heading_degrees,icon_pattern,frame_hits,coordinate_method,
       track_id,screen_x_ratio,screen_y_ratio,vehicle_anchor_x_ratio,vehicle_anchor_y_ratio,
       track_start_lat,track_start_lng,track_start_at,vehicle_speed_mps,vehicle_bearing_degrees)
    values
      (v_item->>'source_id',
       v_item->>'kind',
       v_item->>'source_text',
       (v_item->>'observed_lat')::double precision,
       (v_item->>'observed_lng')::double precision,
       (v_item->>'accuracy_m')::real,
       (v_item->>'gps_captured_at')::timestamptz,
       (v_item->>'distance_ahead_m')::real,
       (v_item->>'estimated_lat')::double precision,
       (v_item->>'estimated_lng')::double precision,
       (v_item->>'confidence')::real,
       (v_item->>'captured_at')::timestamptz,
       'needs-review',
       coalesce(v_item->>'detection_method','text-ocr'),
       (v_item->>'travel_heading_degrees')::smallint,
       v_item->>'icon_pattern',
       coalesce((v_item->>'frame_hits')::smallint,1),
       coalesce(v_item->>'coordinate_method','unknown'),
       nullif(left(v_item->>'track_id',120),''),
       (v_item->>'screen_x_ratio')::real,
       (v_item->>'screen_y_ratio')::real,
       (v_item->>'vehicle_anchor_x_ratio')::real,
       (v_item->>'vehicle_anchor_y_ratio')::real,
       (v_item->>'track_start_lat')::double precision,
       (v_item->>'track_start_lng')::double precision,
       (v_item->>'track_start_at')::timestamptz,
       (v_item->>'vehicle_speed_mps')::real,
       (v_item->>'vehicle_bearing_degrees')::smallint)
    on conflict (source_id) do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$function$;
