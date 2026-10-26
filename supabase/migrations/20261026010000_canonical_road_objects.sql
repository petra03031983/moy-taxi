-- Canonical, reviewable road objects derived from screen-icon observations.
-- Raw observations remain in road_screen_evidence; the public map consumes road_objects.

ALTER TABLE public.road_screen_evidence
  ADD COLUMN IF NOT EXISTS detection_method text NOT NULL DEFAULT 'text-ocr',
  ADD COLUMN IF NOT EXISTS travel_heading_degrees smallint,
  ADD COLUMN IF NOT EXISTS icon_pattern text,
  ADD COLUMN IF NOT EXISTS frame_hits smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS coordinate_method text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.road_screen_evidence
  DROP CONSTRAINT IF EXISTS road_screen_evidence_detection_method_check,
  DROP CONSTRAINT IF EXISTS road_screen_evidence_travel_heading_degrees_check,
  DROP CONSTRAINT IF EXISTS road_screen_evidence_icon_pattern_check,
  DROP CONSTRAINT IF EXISTS road_screen_evidence_frame_hits_check,
  DROP CONSTRAINT IF EXISTS road_screen_evidence_coordinate_method_check;

ALTER TABLE public.road_screen_evidence
  ADD CONSTRAINT road_screen_evidence_detection_method_check
    CHECK (detection_method IN ('text-ocr', 'icon-heuristic')),
  ADD CONSTRAINT road_screen_evidence_travel_heading_degrees_check
    CHECK (travel_heading_degrees IS NULL OR travel_heading_degrees BETWEEN 0 AND 359),
  ADD CONSTRAINT road_screen_evidence_icon_pattern_check
    CHECK (icon_pattern IS NULL OR char_length(icon_pattern) BETWEEN 1 AND 100),
  ADD CONSTRAINT road_screen_evidence_frame_hits_check
    CHECK (frame_hits BETWEEN 1 AND 100),
  ADD CONSTRAINT road_screen_evidence_coordinate_method_check
    CHECK (coordinate_method IN ('unknown', 'gps-observed', 'distance-and-heading', 'icon-pass-by-gps'));

-- Safely classify only strongly structured legacy graphic detections as icon evidence.
UPDATE public.road_screen_evidence
SET
  detection_method = 'icon-heuristic',
  coordinate_method = 'icon-pass-by-gps',
  travel_heading_degrees = CASE
    WHEN source_text ~* 'heading=[0-9]{1,3}deg'
      THEN LEAST(359, (substring(source_text from 'heading=([0-9]{1,3})deg'))::integer)::smallint
    ELSE NULL
  END,
  icon_pattern = COALESCE(
    substring(source_text from 'pattern=([a-z0-9-]+)'),
    'legacy-icon-pass-by-gps'
  ),
  frame_hits = COALESCE(
    LEAST(100, GREATEST(1, NULLIF(substring(source_text from 'hits=([0-9]{1,3})'), '')::integer)),
    1
  )
WHERE lower(source_text) ~ '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%'
  AND estimated_lat IS NOT NULL
  AND estimated_lng IS NOT NULL;

-- Text OCR without a strong actionable alert and a defensible distance-based point is not a map object.
-- Keep the raw row for audit but hide it from map reads.
UPDATE public.road_screen_evidence
SET review_status = 'rejected'
WHERE detection_method = 'text-ocr'
  AND NOT (
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
  );

DROP POLICY IF EXISTS road_screen_evidence_insert ON public.road_screen_evidence;
CREATE POLICY road_screen_evidence_insert ON public.road_screen_evidence
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    review_status = 'needs-review'
    AND observed_lat BETWEEN 47.0 AND 55.0
    AND observed_lng BETWEEN 65.0 AND 77.0
    AND confidence BETWEEN 0.08 AND 0.6
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
          'pixel-sampled-three-colour-traffic-light-on-route'
        )
        AND frame_hits BETWEEN 2 AND 100
        AND accuracy_m BETWEEN 0 AND 60
        AND estimated_lat IS NOT NULL AND estimated_lng IS NOT NULL
        AND distance_ahead_m IS NULL
      )
      OR
      (
        detection_method = 'text-ocr'
        AND coordinate_method = 'distance-and-heading'
        AND distance_ahead_m BETWEEN 15 AND 2000
        AND estimated_lat IS NOT NULL AND estimated_lng IS NOT NULL
        AND accuracy_m BETWEEN 0 AND 60
        AND (
          (kind = 'speed-camera' AND source_text ~* '(камера[[:space:]]+(контроля скорости|скорости|фиксации скорости)|контроль скорости|speed camera|speedcam|camera ahead)')
          OR (kind = 'traffic-light' AND source_text ~* '(светофор впереди|следующий светофор|traffic light ahead)')
          OR (kind = 'speed-limit' AND source_text ~* '(ограничение скорости|speed limit)[^0-9]{0,12}[0-9]{2,3}')
          OR (kind = 'roadwork' AND source_text ~* '(дорожные работы впереди|ремонт дороги|road works ahead)')
          OR (kind = 'road-hazard' AND source_text ~* '(дтп впереди|авария впереди|accident ahead|hazard ahead)')
        )
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.road_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('speed-camera', 'traffic-light', 'speed-limit', 'roadwork', 'road-hazard')),
  lat double precision NOT NULL CHECK (lat BETWEEN 47.0 AND 55.0),
  lng double precision NOT NULL CHECK (lng BETWEEN 65.0 AND 77.0),
  travel_heading_degrees smallint CHECK (travel_heading_degrees IS NULL OR travel_heading_degrees BETWEEN 0 AND 359),
  accuracy_m real NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m <= 150),
  confidence real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 0.6),
  detection_method text NOT NULL CHECK (detection_method IN ('text-ocr', 'icon-heuristic')),
  coordinate_method text NOT NULL CHECK (coordinate_method IN ('distance-and-heading', 'icon-pass-by-gps')),
  icon_pattern text,
  observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count BETWEEN 1 AND 100000),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  last_counted_at timestamptz NOT NULL,
  review_status text NOT NULL DEFAULT 'needs-review' CHECK (review_status IN ('needs-review', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS road_objects_kind_status_idx ON public.road_objects (kind, review_status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS road_objects_location_idx ON public.road_objects (lat, lng);

ALTER TABLE public.road_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.road_objects FROM anon, authenticated;
GRANT SELECT ON TABLE public.road_objects TO anon, authenticated;
DROP POLICY IF EXISTS road_objects_read ON public.road_objects;
CREATE POLICY road_objects_read ON public.road_objects
  FOR SELECT TO anon, authenticated
  USING (review_status IN ('needs-review', 'approved'));

CREATE OR REPLACE FUNCTION public.sync_screen_evidence_to_road_object()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lat double precision;
  v_lng double precision;
  v_heading smallint;
  v_existing_id uuid;
  v_existing_lat double precision;
  v_existing_lng double precision;
  v_existing_heading smallint;
  v_existing_count integer;
  v_existing_confidence real;
  v_existing_accuracy real;
  v_existing_last_counted timestamptz;
  v_distance double precision;
  v_new_sighting boolean;
  v_heading_avg smallint;
BEGIN
  IF NEW.review_status = 'rejected'
     OR NEW.detection_method <> 'icon-heuristic'
     OR NEW.coordinate_method <> 'icon-pass-by-gps'
     OR NEW.kind NOT IN ('speed-camera', 'traffic-light')
     OR NEW.estimated_lat IS NULL OR NEW.estimated_lng IS NULL
     OR NEW.accuracy_m > 60
     OR NEW.confidence < 0.08
     OR NEW.source_text !~* '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%'
  THEN
    RETURN NEW;
  END IF;

  IF NEW.icon_pattern IS NULL OR NEW.icon_pattern NOT IN (
    'compound-speed-sign-with-upper-right-camera-badge',
    'camera-badge-on-speed-sign',
    'three-colour-traffic-light-icon',
    'pixel-sampled-three-colour-traffic-light-on-route',
    'legacy-icon-pass-by-gps'
  ) THEN
    RETURN NEW;
  END IF;

  -- Course over ground is a travel heading, not proof of the camera's viewing direction.
  v_lat := NEW.estimated_lat;
  v_lng := NEW.estimated_lng;
  v_heading := NEW.travel_heading_degrees;

  SELECT
    r.id,
    r.lat,
    r.lng,
    r.travel_heading_degrees,
    r.observation_count,
    r.confidence,
    r.accuracy_m,
    r.last_counted_at,
    sqrt(
      power((v_lat - r.lat) * 111320.0, 2) +
      power((v_lng - r.lng) * 111320.0 * cos(radians((v_lat + r.lat) / 2.0)), 2)
    )
  INTO
    v_existing_id,
    v_existing_lat,
    v_existing_lng,
    v_existing_heading,
    v_existing_count,
    v_existing_confidence,
    v_existing_accuracy,
    v_existing_last_counted,
    v_distance
  FROM public.road_objects r
  WHERE r.kind = NEW.kind
    AND r.review_status <> 'rejected'
    AND sqrt(
      power((v_lat - r.lat) * 111320.0, 2) +
      power((v_lng - r.lng) * 111320.0 * cos(radians((v_lat + r.lat) / 2.0)), 2)
    ) <= 35.0
    AND (
      v_heading IS NULL OR r.travel_heading_degrees IS NULL OR
      abs(mod(v_heading::integer - r.travel_heading_degrees::integer + 540, 360) - 180) <= 55
    )
  ORDER BY v_distance
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.road_objects (
      kind, lat, lng, travel_heading_degrees, accuracy_m, confidence,
      detection_method, coordinate_method, icon_pattern, observation_count,
      first_seen_at, last_seen_at, last_counted_at, review_status
    ) VALUES (
      NEW.kind, v_lat, v_lng, v_heading, NEW.accuracy_m, NEW.confidence,
      NEW.detection_method, NEW.coordinate_method, NEW.icon_pattern, 1,
      NEW.captured_at, NEW.captured_at, NEW.captured_at, 'needs-review'
    );
    RETURN NEW;
  END IF;

  v_new_sighting := v_existing_last_counted IS NULL
    OR NEW.captured_at >= v_existing_last_counted + interval '10 minutes';

  IF v_new_sighting THEN
    IF v_heading IS NULL THEN
      v_heading_avg := v_existing_heading;
    ELSIF v_existing_heading IS NULL THEN
      v_heading_avg := v_heading;
    ELSE
      v_heading_avg := mod(
        round(degrees(atan2(
          v_existing_count * sin(radians(v_existing_heading)) + sin(radians(v_heading)),
          v_existing_count * cos(radians(v_existing_heading)) + cos(radians(v_heading))
        )) + 360)::integer,
        360
      )::smallint;
    END IF;

    UPDATE public.road_objects
    SET
      lat = ((v_existing_lat * v_existing_count) + v_lat) / (v_existing_count + 1),
      lng = ((v_existing_lng * v_existing_count) + v_lng) / (v_existing_count + 1),
      travel_heading_degrees = v_heading_avg,
      accuracy_m = LEAST(v_existing_accuracy, NEW.accuracy_m),
      confidence = LEAST(0.6, GREATEST(v_existing_confidence, NEW.confidence) + 0.03),
      observation_count = LEAST(100000, v_existing_count + 1),
      last_seen_at = GREATEST(NEW.captured_at, last_seen_at),
      last_counted_at = NEW.captured_at,
      icon_pattern = NEW.icon_pattern
    WHERE id = v_existing_id;
  ELSE
    UPDATE public.road_objects
    SET
      last_seen_at = GREATEST(NEW.captured_at, last_seen_at),
      accuracy_m = LEAST(v_existing_accuracy, NEW.accuracy_m)
    WHERE id = v_existing_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_screen_evidence_road_object ON public.road_screen_evidence;
CREATE TRIGGER sync_screen_evidence_road_object
AFTER INSERT OR UPDATE OF detection_method, coordinate_method, estimated_lat, estimated_lng, icon_pattern, frame_hits, review_status
ON public.road_screen_evidence
FOR EACH ROW
EXECUTE FUNCTION public.sync_screen_evidence_to_road_object();

-- Backfill canonical candidates from structured legacy graphic observations.
UPDATE public.road_screen_evidence
SET icon_pattern = COALESCE(icon_pattern, 'legacy-icon-pass-by-gps')
WHERE detection_method = 'icon-heuristic'
  AND coordinate_method = 'icon-pass-by-gps'
  AND estimated_lat IS NOT NULL
  AND estimated_lng IS NOT NULL
  AND accuracy_m <= 60
  AND confidence >= 0.08
  AND lower(source_text) ~ '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%';
