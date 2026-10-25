const TABLE = "road_screen_evidence";
const DEFAULT_SUPABASE_URL = "https://qyejqovxwniqlcsspmbc.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YjssgR_0Of2b5dhqsSfG_Q_EnYTkrOn";
const MAX_BATCH_SIZE = 30;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_KINDS = new Set([
  "speed-camera", "traffic-light", "speed-limit", "roadwork", "road-hazard",
]);
const TERMS = [
  "камера", "светофор", "ограничение скорости", "скорость",
  "дтп", "авария", "дорожные работы", "ремонт дороги",
  "перекрытие", "контроля скорости", "speed camera", "speedcam",
  "traffic light", "road works", "accident", "hazard",
];

function getConfig() {
  let base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return base && key ? { base, key } : null;
}

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function callDatabase(config, path, options = {}) {
  return fetch(config.base + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: config.key,
      Authorization: "Bearer " + config.key,
      Accept: "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
}

export async function GET(request) {
  const config = getConfig();
  if (!config) return jsonResponse({ ok: false, error: "Screen evidence service is not configured." }, 503);
  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 500);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(800, Math.floor(requestedLimit))) : 500;
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const params = new URLSearchParams({
    select: "source_id,kind,source_text,observed_lat,observed_lng,accuracy_m,gps_captured_at,distance_ahead_m,estimated_lat,estimated_lng,confidence,captured_at,review_status",
    review_status: "in.(needs-review,approved)",
    captured_at: "gte." + since,
    order: "captured_at.desc",
    limit: String(limit),
  });

  try {
    const response = await callDatabase(config, TABLE + "?" + params.toString());
    if (!response.ok) return jsonResponse({ ok: false, error: "Could not load screen evidence." }, 502);
    const rows = await response.json();
    const observations = Array.isArray(rows) ? rows.map((row) => ({
      id: row.source_id,
      source_id: row.source_id,
      kind: row.kind,
      sourceText: row.source_text,
      observedLat: Number(row.observed_lat),
      observedLng: Number(row.observed_lng),
      accuracy: Number(row.accuracy_m),
      gpsAt: new Date(row.gps_captured_at).getTime(),
      distanceAheadM: row.distance_ahead_m == null ? null : Number(row.distance_ahead_m),
      estimatedLat: row.estimated_lat == null ? null : Number(row.estimated_lat),
      estimatedLng: row.estimated_lng == null ? null : Number(row.estimated_lng),
      confidence: Number(row.confidence),
      capturedAt: row.captured_at,
      reviewStatus: row.review_status,
      source: "screen-evidence",
      syncStatus: "synced",
    })) : [];
    return jsonResponse({ ok: true, observations });
  } catch {
    return jsonResponse({ ok: false, error: "Screen evidence service is temporarily unavailable." }, 502);
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
  // Icon-only observations are located when the marker passes near the detected vehicle marker.
  const iconPassEstimate = lowerText.includes("near vehicle marker");
  const now = Date.now();

  if (!sourceId || sourceId.length < 8 || !ALLOWED_KINDS.has(kind)) return null;
  if (text.length < 3 || !TERMS.some((term) => lowerText.includes(term))) return null;
  if (!Number.isFinite(observedLat) || observedLat < 47 || observedLat > 55) return null;
  if (!Number.isFinite(observedLng) || observedLng < 65 || observedLng > 77) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > (iconPassEstimate ? 150 : 60)) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 0.6) return null;
  if (!Number.isFinite(gpsCapturedAt.getTime()) || gpsCapturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (now - capturedAt.getTime() > MAX_AGE_MS) return null;
  if (distanceAheadM != null && (!Number.isFinite(distanceAheadM) || distanceAheadM < 15 || distanceAheadM > 2000)) return null;
  if ((estimatedLat == null) !== (estimatedLng == null)) return null;
  if (estimatedLat != null && (!Number.isFinite(estimatedLat) || estimatedLat < 47 || estimatedLat > 55)) return null;
  if (estimatedLng != null && (!Number.isFinite(estimatedLng) || estimatedLng < 65 || estimatedLng > 77)) return null;
  if (distanceAheadM == null && (estimatedLat != null || estimatedLng != null) && !iconPassEstimate) return null;

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
  };
}

export async function POST(request) {
  const config = getConfig();
  if (!config) return jsonResponse({ ok: false, error: "Screen evidence service is not configured." }, 503);
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

  const params = new URLSearchParams({ on_conflict: "source_id" });
  try {
    const response = await callDatabase(config, TABLE + "?" + params.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) return jsonResponse({ ok: false, error: "Could not save screen evidence." }, 502);
    return jsonResponse({ ok: true, accepted: rows.length, sourceIds: rows.map((row) => row.source_id) });
  } catch {
    return jsonResponse({ ok: false, error: "Screen evidence service is temporarily unavailable." }, 502);
  }
}
