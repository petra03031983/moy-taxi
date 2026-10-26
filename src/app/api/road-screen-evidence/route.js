import { callAstanaRpc, readAccessKey, privateApiError } from "../_lib/astanaAccess.js";

const MAX_BATCH_SIZE = 30;

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request) {
  const accessKey = readAccessKey(request);
  if (!accessKey) return jsonResponse({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  try {
    const [rows, manualRows] = await Promise.all([
      callAstanaRpc("astana_guide_get_road_objects", { p_access_key: accessKey }),
      callAstanaRpc("astana_guide_get_manual_objects", { p_access_key: accessKey }),
    ]);
    const canonical = (Array.isArray(rows) ? rows : []).map((row) => {
      const heading = row.travel_heading_degrees == null ? null : Number(row.travel_heading_degrees);
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      return {
        id: "road-object-" + row.id,
        source_id: row.id,
        kind: row.kind,
        sourceText: "Графическое наблюдение · повторных проездов: " + Number(row.observation_count || 1)
          + (row.icon_pattern ? " · шаблон: " + row.icon_pattern : ""),
        observedLat: lat,
        observedLng: lng,
        accuracy: Number(row.accuracy_m),
        gpsAt: new Date(row.last_seen_at).getTime(),
        distanceAheadM: null,
        estimatedLat: lat,
        estimatedLng: lng,
        confidence: Number(row.confidence),
        capturedAt: row.last_seen_at,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        directionDegrees: heading,
        travelHeadingDegrees: heading,
        observationCount: Number(row.observation_count || 1),
        detectionMethod: row.detection_method,
        coordinateMethod: row.coordinate_method,
        iconPattern: row.icon_pattern,
        reviewStatus: row.review_status,
        source: "screen-evidence",
        syncStatus: "synced",
      };
    });
    const manual = (Array.isArray(manualRows) ? manualRows : []).map((row) => ({
      id: "manual-road-object-" + row.id,
      source_id: row.id,
      kind: row.kind,
      sourceText: [row.label, row.notes].filter(Boolean).join(" · "),
      observedLat: Number(row.lat),
      observedLng: Number(row.lng),
      accuracy: Number(row.accuracy_m),
      gpsAt: new Date(row.updated_at || row.created_at).getTime(),
      distanceAheadM: null,
      estimatedLat: Number(row.lat),
      estimatedLng: Number(row.lng),
      confidence: 1,
      capturedAt: row.updated_at || row.created_at,
      firstSeenAt: row.created_at,
      lastSeenAt: row.updated_at || row.created_at,
      directionDegrees: null,
      travelHeadingDegrees: null,
      observationCount: 1,
      detectionMethod: "manual",
      coordinateMethod: "manual-gps",
      iconPattern: null,
      reviewStatus: row.review_status,
      source: "screen-evidence",
      syncStatus: "synced",
      manual: true,
      label: row.label,
    }));
    return jsonResponse({ ok: true, observations: [...canonical, ...manual] });
  } catch (error) {
    return privateApiError(error);
  }
}

function parseTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && /^\d{10,13}$/.test(value)) return new Date(Number(value));
  return new Date(String(value || ""));
}

function normalize(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const sourceId = String(candidate.source_id || candidate.sourceId || candidate.id || "").slice(0, 120);
  const kind = String(candidate.kind || "");
  const text = String(candidate.source_text || candidate.sourceText || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const lowerText = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const detectionMethod = String(candidate.detection_method ?? candidate.detectionMethod ?? "text-ocr");
  const coordinateMethod = String(candidate.coordinate_method ?? candidate.coordinateMethod ?? "unknown");
  const iconPattern = candidate.icon_pattern == null && candidate.iconPattern == null
    ? null : String(candidate.icon_pattern ?? candidate.iconPattern).slice(0, 100);
  const rawHeading = candidate.travel_heading_degrees ?? candidate.travelHeadingDegrees ?? candidate.directionDegrees;
  const travelHeading = rawHeading == null || rawHeading === "" ? null : Number(rawHeading);
  const rawHits = candidate.frame_hits ?? candidate.frameHits ?? 1;
  const frameHits = Number(rawHits);
  const observedLat = Number(candidate.observed_lat ?? candidate.observedLat);
  const observedLng = Number(candidate.observed_lng ?? candidate.observedLng);
  const accuracy = Number(candidate.accuracy_m ?? candidate.accuracy);
  const confidence = Number(candidate.confidence ?? 0);
  const gpsCapturedAt = parseTimestamp(candidate.gps_captured_at ?? candidate.gpsAt);
  const capturedAt = parseTimestamp(candidate.captured_at ?? candidate.capturedAt);
  const distance = candidate.distance_ahead_m ?? candidate.distanceAheadM;
  const distanceAheadM = distance == null || distance === "" ? null : Number(distance);
  const estimateLatValue = candidate.estimated_lat ?? candidate.estimatedLat;
  const estimateLngValue = candidate.estimated_lng ?? candidate.estimatedLng;
  const estimatedLat = estimateLatValue == null ? null : Number(estimateLatValue);
  const estimatedLng = estimateLngValue == null ? null : Number(estimateLngValue);
  const now = Date.now();

  if (!sourceId || sourceId.length < 8 || !ALLOWED_KINDS.has(kind)) return null;
  if (text.length < 3 || text.length > 160) return null;
  if (!Number.isFinite(observedLat) || observedLat < 47 || observedLat > 55) return null;
  if (!Number.isFinite(observedLng) || observedLng < 65 || observedLng > 77) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 150) return null;
  if (!Number.isFinite(confidence) || confidence < 0.08 || confidence > 0.6) return null;
  if (!Number.isFinite(gpsCapturedAt.getTime()) || gpsCapturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (now - capturedAt.getTime() > MAX_AGE_MS) return null;
  if (!Number.isFinite(frameHits) || frameHits < 1 || frameHits > 100) return null;
  if (travelHeading != null && (!Number.isInteger(travelHeading) || travelHeading < 0 || travelHeading > 359)) return null;
  if (distanceAheadM != null && (!Number.isFinite(distanceAheadM) || distanceAheadM < 15 || distanceAheadM > 2000)) return null;
  if ((estimatedLat == null) !== (estimatedLng == null)) return null;
  if (estimatedLat != null && (!Number.isFinite(estimatedLat) || estimatedLat < 47 || estimatedLat > 55)) return null;
  if (estimatedLng != null && (!Number.isFinite(estimatedLng) || estimatedLng < 65 || estimatedLng > 77)) return null;

  if (detectionMethod === "icon-heuristic") {
    const iconMatch = /^(speed camera icon|traffic light icon) near vehicle marker, screen x=\d{1,3}% y=\d{1,3}%/i.test(text);
    const cameraPatterns = new Set([
      "compound-speed-sign-with-upper-right-camera-badge",
      "camera-badge-on-speed-sign",
    ]);
    const trafficPatterns = new Set([
      "three-colour-traffic-light-icon",
      "pixel-sampled-three-colour-traffic-light-on-route",
    ]);
    const patternAllowed = kind === "speed-camera"
      ? cameraPatterns.has(iconPattern)
      : kind === "traffic-light" && trafficPatterns.has(iconPattern);
    if (!iconMatch || !patternAllowed) return null;
    if (coordinateMethod !== "icon-pass-by-gps" || frameHits < 2 || accuracy > 60) return null;
    if (estimatedLat == null || estimatedLng == null || distanceAheadM != null) return null;
  } else if (detectionMethod === "text-ocr") {
    const strictTextAlert =
      (kind === "speed-camera" && /(камера\s+(контроля скорости|скорости|фиксации скорости)|контроль скорости|фиксация скорости|speed\s*camera|speedcam|camera ahead)/i.test(lowerText)) ||
      (kind === "traffic-light" && /(светофор впереди|следующий светофор|traffic light ahead)/i.test(lowerText)) ||
      (kind === "speed-limit" && /(ограничение скорости|speed limit)\D{0,12}\d{2,3}/i.test(lowerText)) ||
      (kind === "roadwork" && /(дорожные работы|ремонт дороги|перекрытие дороги|road works)/i.test(lowerText)) ||
      (kind === "road-hazard" && /(дтп впереди|авария впереди|опасность впереди|происшествие впереди|accident ahead|hazard ahead)/i.test(lowerText));
    if (!strictTextAlert || coordinateMethod !== "distance-and-heading") return null;
    if (distanceAheadM == null || estimatedLat == null || estimatedLng == null || accuracy > 60) return null;
  } else {
    return null;
  }

  return {
    source_id: sourceId,
    kind,
    source_text: text,
    observed_lat: observedLat,
    observed_lng: observedLng,
    accuracy_m: accuracy,
    gps_captured_at: gpsCapturedAt.toISOString(),
    distance_ahead_m: distanceAheadM,
    estimated_lat: estimatedLat,
    estimated_lng: estimatedLng,
    confidence,
    captured_at: capturedAt.toISOString(),
    review_status: "needs-review",
    detection_method: detectionMethod,
    travel_heading_degrees: travelHeading,
    icon_pattern: iconPattern,
    frame_hits: frameHits,
    coordinate_method: coordinateMethod,
  };
}

function normalize(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const sourceId = String(candidate.source_id || candidate.sourceId || candidate.id || "").slice(0, 120);
  const kind = String(candidate.kind || "");
  const text = String(candidate.source_text || candidate.sourceText || "").replace(/\s+/g, " ").trim().slice(0, 160);
  const lowerText = text.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  const detectionMethod = String(candidate.detection_method ?? candidate.detectionMethod ?? "text-ocr");
  const coordinateMethod = String(candidate.coordinate_method ?? candidate.coordinateMethod ?? "unknown");
  const iconPattern = candidate.icon_pattern == null && candidate.iconPattern == null
    ? null : String(candidate.icon_pattern ?? candidate.iconPattern).slice(0, 100);
  const rawHeading = candidate.travel_heading_degrees ?? candidate.travelHeadingDegrees ?? candidate.directionDegrees;
  const travelHeading = rawHeading == null || rawHeading === "" ? null : Number(rawHeading);
  const rawHits = candidate.frame_hits ?? candidate.frameHits ?? 1;
  const frameHits = Number(rawHits);
  const observedLat = Number(candidate.observed_lat ?? candidate.observedLat);
  const observedLng = Number(candidate.observed_lng ?? candidate.observedLng);
  const accuracy = Number(candidate.accuracy_m ?? candidate.accuracy);
  const confidence = Number(candidate.confidence ?? 0);
  const gpsCapturedAt = parseTimestamp(candidate.gps_captured_at ?? candidate.gpsAt);
  const capturedAt = parseTimestamp(candidate.captured_at ?? candidate.capturedAt);
  const distance = candidate.distance_ahead_m ?? candidate.distanceAheadM;
  const distanceAheadM = distance == null || distance === "" ? null : Number(distance);
  const estimateLatValue = candidate.estimated_lat ?? candidate.estimatedLat;
  const estimateLngValue = candidate.estimated_lng ?? candidate.estimatedLng;
  const estimatedLat = estimateLatValue == null ? null : Number(estimateLatValue);
  const estimatedLng = estimateLngValue == null ? null : Number(estimateLngValue);
  const now = Date.now();

  if (!sourceId || sourceId.length < 8 || !ALLOWED_KINDS.has(kind)) return null;
  if (text.length < 3 || text.length > 160) return null;
  if (!Number.isFinite(observedLat) || observedLat < 47 || observedLat > 55) return null;
  if (!Number.isFinite(observedLng) || observedLng < 65 || observedLng > 77) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 150) return null;
  if (!Number.isFinite(confidence) || confidence < 0.08 || confidence > 0.6) return null;
  if (!Number.isFinite(gpsCapturedAt.getTime()) || gpsCapturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (now - capturedAt.getTime() > MAX_AGE_MS) return null;
  if (!Number.isFinite(frameHits) || frameHits < 1 || frameHits > 100) return null;
  if (travelHeading != null && (!Number.isInteger(travelHeading) || travelHeading < 0 || travelHeading > 359)) return null;
  if (distanceAheadM != null && (!Number.isFinite(distanceAheadM) || distanceAheadM < 15 || distanceAheadM > 2000)) return null;
  if ((estimatedLat == null) !== (estimatedLng == null)) return null;
  if (estimatedLat != null && (!Number.isFinite(estimatedLat) || estimatedLat < 47 || estimatedLat > 55)) return null;
  if (estimatedLng != null && (!Number.isFinite(estimatedLng) || estimatedLng < 65 || estimatedLng > 77)) return null;

  if (detectionMethod === "icon-heuristic") {
    const iconMatch = /^(speed camera icon|traffic light icon) near vehicle marker, screen x=\d{1,3}% y=\d{1,3}%/i.test(text);
    const cameraPatterns = new Set([
      "compound-speed-sign-with-upper-right-camera-badge",
      "camera-badge-on-speed-sign",
    ]);
    const trafficPatterns = new Set([
      "three-colour-traffic-light-icon",
      "pixel-sampled-three-colour-traffic-light-on-route",
    ]);
    const patternAllowed = kind === "speed-camera"
      ? cameraPatterns.has(iconPattern)
      : kind === "traffic-light" && trafficPatterns.has(iconPattern);
    if (!iconMatch || !patternAllowed) return null;
    if (coordinateMethod !== "icon-pass-by-gps" || frameHits < 2 || accuracy > 60) return null;
    if (estimatedLat == null || estimatedLng == null || distanceAheadM != null) return null;
  } else if (detectionMethod === "text-ocr") {
    const strictTextAlert =
      (kind === "speed-camera" && /(камера\s+(контроля скорости|скорости|фиксации скорости)|контроль скорости|фиксация скорости|speed\s*camera|speedcam|camera ahead)/i.test(lowerText)) ||
      (kind === "traffic-light" && /(светофор впереди|следующий светофор|traffic light ahead)/i.test(lowerText)) ||
      (kind === "speed-limit" && /(ограничение скорости|speed limit)\D{0,12}\d{2,3}/i.test(lowerText)) ||
      (kind === "roadwork" && /(дорожные работы|ремонт дороги|перекрытие дороги|road works)/i.test(lowerText)) ||
      (kind === "road-hazard" && /(дтп впереди|авария впереди|опасность впереди|происшествие впереди|accident ahead|hazard ahead)/i.test(lowerText));
    if (!strictTextAlert || coordinateMethod !== "distance-and-heading") return null;
    if (distanceAheadM == null || estimatedLat == null || estimatedLng == null || accuracy > 60) return null;
  } else {
    return null;
  }

  return {
    source_id: sourceId,
    kind,
    source_text: text,
    observed_lat: observedLat,
    observed_lng: observedLng,
    accuracy_m: accuracy,
    gps_captured_at: gpsCapturedAt.toISOString(),
    distance_ahead_m: distanceAheadM,
    estimated_lat: estimatedLat,
    estimated_lng: estimatedLng,
    confidence,
    captured_at: capturedAt.toISOString(),
    review_status: "needs-review",
    detection_method: detectionMethod,
    travel_heading_degrees: travelHeading,
    icon_pattern: iconPattern,
    frame_hits: frameHits,
    coordinate_method: coordinateMethod,
  };
}

export async function POST(request) {
  const accessKey = readAccessKey(request);
  if (!accessKey) return jsonResponse({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: "Request body must be JSON." }, 400); }

  const candidates = Array.isArray(body) ? body : (Array.isArray(body?.observations) ? body.observations : [body]);
  if (candidates.length === 0 || candidates.length > MAX_BATCH_SIZE) {
    return jsonResponse({ ok: false, error: "Send between 1 and " + MAX_BATCH_SIZE + " observations per request." }, 400);
  }
  const rows = [];
  const ids = new Set();
  for (const candidate of candidates) {
    const row = normalize(candidate);
    if (!row || ids.has(row.source_id)) continue;
    ids.add(row.source_id);
    rows.push(row);
  }
  if (rows.length === 0) return jsonResponse({ ok: false, error: "No valid road-related screen hints found." }, 400);

  try {
    const accepted = await callAstanaRpc("astana_guide_save_screen_evidence", {
      p_access_key: accessKey,
      p_rows: rows,
    });
    return jsonResponse({ ok: true, accepted: Number(accepted) || 0, sourceIds: rows.map((row) => row.source_id) });
  } catch (error) {
    return privateApiError(error);
  }
}
