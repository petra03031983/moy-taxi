-- Allow conservative pass-by GPS points from graphically detected navigation icons.
-- Such points are still provisional and must be reviewed; they have no measured distance-ahead value.
drop policy if exists road_screen_evidence_insert on public.road_screen_evidence;

create policy road_screen_evidence_insert on public.road_screen_evidence
  for insert to anon, authenticated
  with check (
    review_status = 'needs-review'
    and kind in ('speed-camera', 'traffic-light', 'speed-limit', 'roadwork', 'road-hazard')
    and char_length(source_text) between 3 and 160
    and (
      lower(source_text) like '%камера%' or lower(source_text) like '%светофор%'
      or lower(source_text) like '%скорость%' or lower(source_text) like '%дтп%'
      or lower(source_text) like '%авария%' or lower(source_text) like '%дорожные работы%'
      or lower(source_text) like '%ремонт дороги%' or lower(source_text) like '%перекрытие%'
      or lower(source_text) like '%speed camera%' or lower(source_text) like '%speedcam%'
      or lower(source_text) like '%traffic light%' or lower(source_text) like '%road works%'
      or lower(source_text) like '%accident%' or lower(source_text) like '%hazard%'
    )
    and accuracy_m between 0 and 60
    and observed_lat between 47.0 and 55.0
    and observed_lng between 65.0 and 77.0
    and confidence between 0 and 0.6
    and (
      (estimated_lat is null and estimated_lng is null)
      or (
        estimated_lat is not null and estimated_lng is not null
        and (
          distance_ahead_m between 15 and 2000
          or lower(source_text) like '%near vehicle marker%'
        )
      )
    )
  );
