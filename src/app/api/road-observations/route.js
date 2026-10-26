const TABLE = "road_object_observations";
// The publishable key is intended for client use; table access is restricted by RLS.
// Environment variables, when configured, override these non-secret connection values.
const DEFAULT_SUPABASE_URL = "https://qyejqovxwniqlcsspmbc.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YjssgR_0Of2b5dhqsSfG_Q_EnYTkrOn";
const MAX_BATCH_SIZE = 40;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_KIND_LABELS = {
  "traffic-light": "traffic light",
  "traffic-sign": "stop sign",
};

function getConfig() {
  let base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return null;
  return { base, key };
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

function apiHeaders(key, extra = {}) {
  return {
    apikey: key,
    // Publishable API keys are not JWTs; Supabase resolves the anon role from apikey and RLS.
    Accept: "application/json",
    ...extra,
  };
}

async function callDatabase(config, path, options = {}) {
  return fetch(`${config.base}/rest/v1/${path}`, {
    ...options,
    headers: apiHeaders(config.key, options.headers || {}),
    cache: "no-store",
  });
}

export async function GET(request) {
  const config = getConfig();
  if (!config) return jsonResponse({ ok: false, error: "Road observation service is not configured." }, 503);

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit") || 1200);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1500, Math.floor(requestedLimit))) : 1200;
  const since = new Date(Date.now() - MAX_AGE_MS).toISOString();
  const params = new URLSearchParams({
    select: "source_id,kind,lat,lng,accuracy_m,confidence,detected_label,model,captured_at,review_status,created_at",
    review_status: "in.(needs-review,approved)",
    captured_at: `gte.${since}`,
    order: "captured_at.desc",
    limit: String(limit),
  });

  try {
    const response = await callDatabase(config, `${TABLE}?${params.toString()}`);
    if (!response.ok) return jsonResponse({ ok: false, error: "Could not load road observations." }, 502);
    const rows = await response.json();
    const observations = Array.isArray(rows) ? rows.map((row) => ({
      id: row.source_id,
      source_id: row.source_id,
      kind: row.kind,
      lat: Number(row.lat),
      lng: Number(row.lng),
      accuracy: Number(row.accuracy_m),
      confidence: Number(row.confidence),
      detectedLabel: row.detected_label,
      model: row.model,
      capturedAt: row.captured_at,
      reviewStatus: row.review_status,
      source: "android-ai-detection",
      syncStatus: "synced",
    })) : [];
    return jsonResponse({ ok: true, observations });
  } catch {
    return jsonResponse({ ok: false, error: "Road observation service is temporarily unavailable." }, 502);
  }
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const kind = String(candidate.kind || "");
  const expectedLabel = ALLOWED_KIND_LABELS[kind];
  if (!expectedLabel || String(candidate.detected_label || candidate.detectedLabel || "").toLowerCase() !== expectedLabel) {
    return null;
  }

  const lat = Number(candidate.lat);
  const lng = Number(candidate.lng);
  const accuracy = Number(candidate.accuracy_m ?? candidate.accuracy);
  const confidence = Number(candidate.confidence);
  const sourceId = String(candidate.source_id || candidate.sourceId || candidate.id || "").slice(0, 120);
  const capturedAt = new Date(String(candidate.captured_at || candidate.capturedAt || ""));
  const now = Date.now();

  if (!sourceId || sourceId.length < 8) return null;
  if (!Number.isFinite(lat) || lat < 47 || lat > 55) return null;
  if (!Number.isFinite(lng) || lng < 65 || lng > 77) return null;
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 35) return null;
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) return null;
  if (!Number.isFinite(capturedAt.getTime()) || capturedAt.getTime() > now + 5 * 60 * 1000) return null;
  if (now - capturedAt.getTime() > MAX_AGE_MS) return null;

  return {
    source_id: sourceId,
    kind,
    lat,
    lng,
    accuracy_m: accuracy,
    confidence,
    detected_label: expectedLabel,
    model: "EfficientDet-Lite0-COCO",
    captured_at: capturedAt.toISOString(),
    review_status: "needs-review",
  };
}

export async function POST(request) {
  const config = getConfig();
  if (!config) return jsonResponse({ ok: false, error: "Road observation service is not configured." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Request body must be JSON." }, 400);
  }

  const candidates = Array.isArray(body) ? body : (Array.isArray(body?.observations) ? body.observations : [body]);
  if (candidates.length === 0 || candidates.length > MAX_BATCH_SIZE) {
    return jsonResponse({ ok: false, error: `Send between 1 and ${MAX_BATCH_SIZE} observations per request.` }, 400);
  }

  const rows = [];
  const ids = new Set();
  for (const candidate of candidates) {
    const row = normalizeCandidate(candidate);
    if (!row || ids.has(row.source_id)) continue;
    ids.add(row.source_id);
    rows.push(row);
  }
  if (rows.length === 0) {
    return jsonResponse({ ok: false, error: "No valid traffic-light or STOP-sign observations in the request." }, 400);
  }

  const params = new URLSearchParams({ on_conflict: "source_id" });
  try {
    const response = await callDatabase(config, `${TABLE}?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!response.ok) return jsonResponse({ ok: false, error: "Could not save road observations." }, 502);
    return jsonResponse({ ok: true, accepted: rows.length, sourceIds: rows.map((row) => row.source_id) }, 200);
  } catch {
    return jsonResponse({ ok: false, error: "Road observation service is temporarily unavailable." }, 502);
  }
}
