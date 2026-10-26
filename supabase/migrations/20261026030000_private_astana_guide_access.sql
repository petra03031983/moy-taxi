-- Private key-gated access to the personal Astana Guide coordinate database.
-- The plaintext access key is intentionally not stored in this migration or repository.

create schema if not exists astana_private;
revoke all on schema astana_private from public, anon, authenticated;

create table if not exists astana_private.access_keys (
  key_id smallint primary key check (key_id = 1),
  key_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on table astana_private.access_keys from public, anon, authenticated;
insert into astana_private.access_keys (key_id, key_hash)
values (1, 'c3fee74ca67c10ec6ce4a704c2aaeb2694aa67ce92b530c98393ffa8373d9799')
on conflict (key_id) do update
set key_hash = excluded.key_hash, updated_at = now();

create table if not exists public.road_manual_objects (
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null,
  lat double precision not null check (lat between 47.0 and 55.0),
  lng double precision not null check (lng between 65.0 and 77.0),
  label text not null check (char_length(label) between 2 and 100),
  notes text not null default '' check (char_length(notes) <= 500),
  accuracy_m real not null default 20 check (accuracy_m between 0 and 150),
  review_status text not null default 'approved' check (review_status in ('needs-review','approved','rejected')),
  source text not null default 'manual-user' check (source in ('manual-user')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.road_manual_objects enable row level security;
revoke all on table public.road_manual_objects from public, anon, authenticated;
alter table public.road_manual_objects drop constraint if exists road_manual_objects_kind_check;
alter table public.road_manual_objects add constraint road_manual_objects_kind_check check (
  kind in (
    'speed-camera','surveillance-camera','traffic-light','speed-limit',
    'traffic-sign','stop-sign','give-way-sign','pedestrian-crossing',
    'no-stopping','no-parking','parking','roadwork','road-hazard'
  )
);

create or replace function public.astana_guide_check_key(p_access_key text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, astana_private, extensions
as $$
  select coalesce(
    length(p_access_key) >= 32
    and exists (
      select 1 from astana_private.access_keys k
      where k.key_id = 1
        and k.key_hash = encode(extensions.digest(p_access_key, 'sha256'), 'hex')
    ),
    false
  );
$$;

create or replace function public.astana_guide_get_road_objects(p_access_key text)
returns setof public.road_objects
language plpgsql
stable
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  return query
    select r.* from public.road_objects r
    where r.review_status in ('needs-review','approved')
    order by r.last_seen_at desc
    limit 20000;
end;
$$;

create or replace function public.astana_guide_get_manual_objects(p_access_key text)
returns setof public.road_manual_objects
language plpgsql
stable
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  return query
    select m.* from public.road_manual_objects m
    where m.review_status in ('needs-review','approved')
    order by m.updated_at desc
    limit 5000;
end;
$$;

create or replace function public.astana_guide_add_manual_object(
  p_access_key text,
  p_kind text,
  p_lat double precision,
  p_lng double precision,
  p_label text,
  p_notes text default '',
  p_accuracy_m real default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
declare
  v_existing public.road_manual_objects%rowtype;
  v_canonical public.road_objects%rowtype;
  v_saved public.road_manual_objects%rowtype;
  v_label text := left(btrim(coalesce(p_label,'')),100);
  v_notes text := left(btrim(coalesce(p_notes,'')),500);
  v_accuracy real := coalesce(p_accuracy_m,20);
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_kind not in (
    'speed-camera','surveillance-camera','traffic-light','speed-limit',
    'traffic-sign','stop-sign','give-way-sign','pedestrian-crossing',
    'no-stopping','no-parking','parking','roadwork','road-hazard'
  ) then
    raise exception 'Unsupported road object kind' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_lat not between 47.0 and 55.0 or p_lng not between 65.0 and 77.0 then
    raise exception 'Coordinates are outside the Astana region' using errcode = '22023';
  end if;
  if char_length(v_label) < 2 or v_accuracy < 0 or v_accuracy > 150 then
    raise exception 'Invalid label or GPS accuracy' using errcode = '22023';
  end if;

  -- Use the existing scanner object when a matching point is already in the shared canonical layer.
  if p_kind in ('speed-camera','traffic-light','speed-limit','roadwork','road-hazard') then
    select r.* into v_canonical
    from public.road_objects r
    where r.kind = p_kind and r.review_status <> 'rejected'
      and sqrt(power((p_lat - r.lat) * 111320.0, 2)
        + power((p_lng - r.lng) * 111320.0 * cos(radians((p_lat + r.lat) / 2.0)), 2)) <= 12.0
    order by sqrt(power((p_lat - r.lat) * 111320.0, 2)
        + power((p_lng - r.lng) * 111320.0 * cos(radians((p_lat + r.lat) / 2.0)), 2))
    limit 1;
    if v_canonical.id is not null then
      return jsonb_build_object(
        'ok',true,'duplicate',true,'object',to_jsonb(v_canonical),
        'message','A matching road object already exists in the scanner database.'
      );
    end if;
  end if;

  select m.* into v_existing
  from public.road_manual_objects m
  where m.kind = p_kind and m.review_status <> 'rejected'
    and sqrt(power((p_lat - m.lat) * 111320.0, 2)
      + power((p_lng - m.lng) * 111320.0 * cos(radians((p_lat + m.lat) / 2.0)), 2)) <= 12.0
  order by sqrt(power((p_lat - m.lat) * 111320.0, 2)
      + power((p_lng - m.lng) * 111320.0 * cos(radians((p_lat + m.lat) / 2.0)), 2))
  limit 1;

  if v_existing.id is not null then
    update public.road_manual_objects
    set label = v_label,
        notes = v_notes,
        lat = case when v_accuracy <= accuracy_m then p_lat else lat end,
        lng = case when v_accuracy <= accuracy_m then p_lng else lng end,
        accuracy_m = least(accuracy_m, v_accuracy),
        updated_at = now(),
        review_status = 'approved'
    where id = v_existing.id
    returning * into v_saved;
    return jsonb_build_object('ok',true,'duplicate',true,'object',to_jsonb(v_saved));
  end if;

  insert into public.road_manual_objects(kind,lat,lng,label,notes,accuracy_m,review_status,source)
  values (p_kind,p_lat,p_lng,v_label,v_notes,v_accuracy,'approved','manual-user')
  returning * into v_saved;
  return jsonb_build_object('ok',true,'duplicate',false,'object',to_jsonb(v_saved));
end;
$$;

create or replace function public.astana_guide_get_road_observations(p_access_key text)
returns setof public.road_object_observations
language plpgsql
stable
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  return query
    select o.* from public.road_object_observations o
    where o.review_status in ('needs-review','approved')
    order by o.captured_at desc
    limit 10000;
end;
$$;

create or replace function public.astana_guide_save_road_observations(p_access_key text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_added integer;
  v_total integer;
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be an array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 40 then raise exception 'Send between 1 and 40 rows' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.road_object_observations
      (source_id,kind,lat,lng,accuracy_m,confidence,detected_label,model,captured_at,review_status)
    values
      (v_item->>'source_id', v_item->>'kind',
       (v_item->>'lat')::double precision, (v_item->>'lng')::double precision,
       (v_item->>'accuracy_m')::double precision, (v_item->>'confidence')::double precision,
       v_item->>'detected_label', coalesce(v_item->>'model','EfficientDet-Lite0-COCO'),
       (v_item->>'captured_at')::timestamptz, 'needs-review')
    on conflict (source_id) do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;

create or replace function public.astana_guide_save_screen_evidence(p_access_key text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, astana_private, extensions
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_added integer;
  v_total integer;
begin
  if not public.astana_guide_check_key(p_access_key) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be an array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_rows);
  if v_total < 1 or v_total > 30 then raise exception 'Send between 1 and 30 rows' using errcode = '22023'; end if;
  for v_item in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.road_screen_evidence
      (source_id,kind,source_text,observed_lat,observed_lng,accuracy_m,gps_captured_at,
       distance_ahead_m,estimated_lat,estimated_lng,confidence,captured_at,review_status,
       detection_method,travel_heading_degrees,icon_pattern,frame_hits,coordinate_method)
    values
      (v_item->>'source_id', v_item->>'kind', v_item->>'source_text',
       (v_item->>'observed_lat')::double precision, (v_item->>'observed_lng')::double precision,
       (v_item->>'accuracy_m')::real, (v_item->>'gps_captured_at')::timestamptz,
       (v_item->>'distance_ahead_m')::real, (v_item->>'estimated_lat')::double precision,
       (v_item->>'estimated_lng')::double precision, (v_item->>'confidence')::real,
       (v_item->>'captured_at')::timestamptz, 'needs-review',
       coalesce(v_item->>'detection_method','text-ocr'),
       (v_item->>'travel_heading_degrees')::smallint, v_item->>'icon_pattern',
       coalesce((v_item->>'frame_hits')::smallint,1),
       coalesce(v_item->>'coordinate_method','unknown'))
    on conflict (source_id) do nothing;
    get diagnostics v_added = row_count;
    v_count := v_count + v_added;
  end loop;
  return v_count;
end;
$$;

-- Require the private access-key RPC for all reads/writes of coordinate tables.
alter table public.road_screen_evidence enable row level security;
alter table public.road_objects enable row level security;
alter table public.road_object_observations enable row level security;
revoke all on table public.road_screen_evidence from public, anon, authenticated;
revoke all on table public.road_objects from public, anon, authenticated;
revoke all on table public.road_object_observations from public, anon, authenticated;
revoke all on table public.road_manual_objects from public, anon, authenticated;

drop policy if exists road_screen_evidence_read on public.road_screen_evidence;
drop policy if exists road_screen_evidence_insert on public.road_screen_evidence;
drop policy if exists road_objects_read on public.road_objects;
drop policy if exists road_object_observations_read on public.road_object_observations;
drop policy if exists road_object_observations_insert on public.road_object_observations;
drop policy if exists road_manual_objects_read on public.road_manual_objects;
drop policy if exists road_manual_objects_insert on public.road_manual_objects;

revoke all on function public.astana_guide_check_key(text) from public;
revoke all on function public.astana_guide_get_road_objects(text) from public;
revoke all on function public.astana_guide_get_manual_objects(text) from public;
revoke all on function public.astana_guide_add_manual_object(text,text,double precision,double precision,text,text,real) from public;
revoke all on function public.astana_guide_get_road_observations(text) from public;
revoke all on function public.astana_guide_save_road_observations(text,jsonb) from public;
revoke all on function public.astana_guide_save_screen_evidence(text,jsonb) from public;
grant execute on function public.astana_guide_check_key(text) to anon, authenticated;
grant execute on function public.astana_guide_get_road_objects(text) to anon, authenticated;
grant execute on function public.astana_guide_get_manual_objects(text) to anon, authenticated;
grant execute on function public.astana_guide_add_manual_object(text,text,double precision,double precision,text,text,real) to anon, authenticated;
grant execute on function public.astana_guide_get_road_observations(text) to anon, authenticated;
grant execute on function public.astana_guide_save_road_observations(text,jsonb) to anon, authenticated;
grant execute on function public.astana_guide_save_screen_evidence(text,jsonb) to anon, authenticated;
