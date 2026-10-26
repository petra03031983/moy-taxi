-- A single road object can be seen over a wider part of the approach path.
-- Keep a stable anchor to avoid merging adjacent intersections (typically 300–350m apart),
-- and rebuild only the derived table. Raw observations are preserved unchanged.

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
    ) <= 90.0
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

-- The raw evidence is the source of truth, so rebuild derived clusters deterministically.
DELETE FROM public.road_objects;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT source_id
    FROM public.road_screen_evidence
    WHERE review_status = 'needs-review'
      AND detection_method = 'icon-heuristic'
      AND coordinate_method = 'icon-pass-by-gps'
      AND estimated_lat IS NOT NULL
      AND estimated_lng IS NOT NULL
      AND accuracy_m <= 60
      AND confidence >= 0.08
      AND icon_pattern IN (
        'compound-speed-sign-with-upper-right-camera-badge',
        'camera-badge-on-speed-sign',
        'three-colour-traffic-light-icon',
        'pixel-sampled-three-colour-traffic-light-on-route',
        'legacy-icon-pass-by-gps'
      )
      AND lower(source_text) ~ '^(speed camera icon|traffic light icon) near vehicle marker, screen x=[0-9]{1,3}% y=[0-9]{1,3}%'
    ORDER BY captured_at ASC
  LOOP
    UPDATE public.road_screen_evidence
    SET icon_pattern = icon_pattern
    WHERE source_id = item.source_id;
  END LOOP;
END;
$$;
