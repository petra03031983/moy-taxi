-- Repair legacy Android screen-scan uploads, preserve provisional icon sightings,
-- and keep OCR/control-panel text out of the canonical road-object layer.

CREATE OR REPLACE FUNCTION public.normalize_screen_icon_ingest()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_pattern text;
  v_hits integer;
  v_heading integer;
BEGIN
  v_prefix := substring(NEW.source_text from '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%');
  IF v_prefix IS NULL THEN
    RETURN NEW;
  END IF;

  IF (v_prefix ILIKE 'speed camera icon%' AND NEW.kind <> 'speed-camera')
     OR (v_prefix ILIKE 'traffic light icon%' AND NEW.kind <> 'traffic-light') THEN
    NEW.review_status := 'rejected';
    RETURN NEW;
  END IF;

  v_pattern := substring(NEW.source_text from 'pattern=([a-z0-9-]+)');
  IF v_pattern IS NULL OR v_pattern NOT IN (
    'compound-speed-sign-with-upper-right-camera-badge',
    'camera-badge-on-speed-sign',
    'three-colour-traffic-light-icon',
    'pixel-sampled-three-colour-traffic-light-on-route',
    'legacy-icon-pass-by-gps'
  ) THEN
    v_pattern := 'legacy-icon-pass-by-gps';
  END IF;

  v_hits := NULLIF(substring(NEW.source_text from 'hits=([0-9]{1,3})'), '')::integer;
  v_hits := GREATEST(2, LEAST(100, COALESCE(v_hits, 2)));

  v_heading := NULLIF(substring(NEW.source_text from 'heading=([0-9]{1,3})deg'), '')::integer;
  IF v_heading IS NOT NULL AND v_heading > 359 THEN v_heading := NULL; END IF;

  NEW.detection_method := 'icon-heuristic';
  NEW.coordinate_method := 'icon-pass-by-gps';
  NEW.icon_pattern := v_pattern;
  NEW.frame_hits := v_hits;
  IF NEW.travel_heading_degrees IS NULL THEN
    NEW.travel_heading_degrees := v_heading;
  END IF;
  IF NEW.estimated_lat IS NULL THEN NEW.estimated_lat := NEW.observed_lat; END IF;
  IF NEW.estimated_lng IS NULL THEN NEW.estimated_lng := NEW.observed_lng; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_screen_icon_ingest ON public.road_screen_evidence;
CREATE TRIGGER normalize_screen_icon_ingest
BEFORE INSERT OR UPDATE OF source_text, kind, detection_method, coordinate_method, icon_pattern, frame_hits
ON public.road_screen_evidence
FOR EACH ROW
EXECUTE FUNCTION public.normalize_screen_icon_ingest();

DROP POLICY IF EXISTS road_screen_evidence_insert ON public.road_screen_evidence;
CREATE POLICY road_screen_evidence_insert ON public.road_screen_evidence
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    review_status = 'needs-review'
    AND observed_lat BETWEEN 47.0 AND 55.0
    AND observed_lng BETWEEN 65.0 AND 77.0
    AND confidence BETWEEN 0 AND 0.6
    AND (
      (
        detection_method = 'icon-heuristic'
        AND coordinate_method = 'icon-pass-by-gps'
        AND kind IN ('speed-camera', 'traffic-light')
        AND source_text ~* '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%'
        AND icon_pattern IN (
          'compound-speed-sign-with-upper-right-camera-badge',
          'camera-badge-on-speed-sign',
          'three-colour-traffic-light-icon',
          'pixel-sampled-three-colour-traffic-light-on-route',
          'legacy-icon-pass-by-gps'
        )
        AND frame_hits BETWEEN 2 AND 100
        AND accuracy_m BETWEEN 0 AND 150
        AND estimated_lat BETWEEN 47.0 AND 55.0
        AND estimated_lng BETWEEN 65.0 AND 77.0
        AND distance_ahead_m IS NULL
      )
      OR
      (
        detection_method = 'text-ocr'
        AND coordinate_method = 'distance-and-heading'
        AND distance_ahead_m BETWEEN 15 AND 2000
        AND estimated_lat BETWEEN 47.0 AND 55.0
        AND estimated_lng BETWEEN 65.0 AND 77.0
        AND accuracy_m BETWEEN 0 AND 60
        AND (
          (kind = 'speed-camera' AND source_text ~* '(камера[[:space:]]+(контроля скорости|скорости|фиксации скорости)|контроль скорости|фиксация скорости|speed camera|speedcam|camera ahead)')
          OR (kind = 'traffic-light' AND source_text ~* '(светофор впереди|следующий светофор|traffic light ahead)')
          OR (kind = 'speed-limit' AND source_text ~* '(ограничение скорости|speed limit)[^0-9]{0,12}[0-9]{2,3}')
          OR (kind = 'roadwork' AND source_text ~* '(дорожные работы|ремонт дороги|перекрытие дороги|road works)')
          OR (kind = 'road-hazard' AND source_text ~* '(дтп впереди|авария впереди|опасность впереди|происшествие впереди|accident ahead|hazard ahead)')
        )
      )
    )
  );

-- Historic OCR fragments from app controls, chat text, and unrelated app labels stay
-- in the raw audit trail but are not eligible for the road-object layer.
UPDATE public.road_screen_evidence
SET review_status = 'rejected'
WHERE detection_method = 'text-ocr'
  AND (
    source_text ~* '(астана гид|сканер|графических наблюдений|кадров экрана|координаты|направление|whatsapp|wa business|значки камеры|значки/светофора|облако|отметок на карте)'
    OR NOT (
      estimated_lat IS NOT NULL
      AND estimated_lng IS NOT NULL
      AND distance_ahead_m BETWEEN 15 AND 2000
      AND (
        (kind = 'speed-camera' AND source_text ~* '(камера[[:space:]]+(контроля скорости|скорости|фиксации скорости)|контроль скорости|speed camera|speedcam|camera ahead)')
        OR (kind = 'traffic-light' AND source_text ~* '(светофор впереди|следующий светофор|traffic light ahead)')
        OR (kind = 'speed-limit' AND source_text ~* '(ограничение скорости|speed limit)[^0-9]{0,12}[0-9]{2,3}')
        OR (kind = 'roadwork' AND source_text ~* '(дорожные работы впереди|ремонт дороги|road works ahead)')
        OR (kind = 'road-hazard' AND source_text ~* '(дтп впереди|авария впереди|accident ahead|hazard ahead)')
      )
    )
  );
