ALTER TABLE public.road_screen_evidence
  DROP CONSTRAINT IF EXISTS road_screen_evidence_accuracy_m_check;

ALTER TABLE public.road_screen_evidence
  ADD CONSTRAINT road_screen_evidence_accuracy_m_check
  CHECK (accuracy_m >= 0 AND accuracy_m <= 150);

DROP POLICY IF EXISTS road_screen_evidence_insert ON public.road_screen_evidence;

CREATE POLICY road_screen_evidence_insert ON public.road_screen_evidence
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    review_status = 'needs-review'
    AND kind IN ('speed-camera', 'traffic-light', 'speed-limit', 'roadwork', 'road-hazard')
    AND char_length(source_text) BETWEEN 3 AND 160
    AND (
      lower(source_text) LIKE '%камера%' OR lower(source_text) LIKE '%светофор%'
      OR lower(source_text) LIKE '%скорость%' OR lower(source_text) LIKE '%дтп%'
      OR lower(source_text) LIKE '%авария%' OR lower(source_text) LIKE '%дорожные работы%'
      OR lower(source_text) LIKE '%ремонт дороги%' OR lower(source_text) LIKE '%перекрытие%'
      OR lower(source_text) LIKE '%speed camera%' OR lower(source_text) LIKE '%speedcam%'
      OR lower(source_text) LIKE '%traffic light%' OR lower(source_text) LIKE '%road works%'
      OR lower(source_text) LIKE '%accident%' OR lower(source_text) LIKE '%hazard%'
    )
    AND (
      (accuracy_m BETWEEN 0 AND 60)
      OR (lower(source_text) LIKE '%near vehicle marker%' AND accuracy_m BETWEEN 0 AND 150)
    )
    AND observed_lat BETWEEN 47.0 AND 55.0
    AND observed_lng BETWEEN 65.0 AND 77.0
    AND confidence BETWEEN 0 AND 0.6
    AND (
      (estimated_lat IS NULL AND estimated_lng IS NULL)
      OR (
        estimated_lat IS NOT NULL AND estimated_lng IS NOT NULL
        AND (
          distance_ahead_m BETWEEN 15 AND 2000
          OR lower(source_text) LIKE '%near vehicle marker%'
        )
      )
    )
  );
