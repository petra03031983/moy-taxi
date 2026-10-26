import { callAstanaRpc, readAccessKey, privateApiError } from "../_lib/astanaAccess.js";

const MAX_BATCH_SIZE = 40;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ALLOWED_KIND_LABELS = {
  "traffic-light": "traffic light",
  "traffic-sign": "stop sign",
};

function jsonResponse(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request) {
  const accessKey = readAccessKey(request);
  if (!accessKey) return jsonResponse({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  try {
    const rows = await callAstanaRpc("astana_guide_get_road_observations", { p_access_key: accessKey });
    const observations = (Array.isArray(rows) ? rows : []).map((row) => ({
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
    }));
    return jsonResponse({ ok: true, observations });
  } catch (error) {
    return privateApiError(error);
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
  const accessKey = readAccessKey(request);
  if (!accessKey) return jsonResponse({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ ok: false, error: "Request body must be JSON." }, 400); }
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
  if (rows.length === 0) return jsonResponse({ ok: false, error: "No valid traffic-light or STOP-sign observations in the request." }, 400);
  try {
    const accepted = await callAstanaRpc("astana_guide_save_road_observations", {
      p_access_key: accessKey,
      p_rows: rows,
    });
    return jsonResponse({ ok: true, accepted: Number(accepted) || 0, sourceIds: rows.map((row) => row.source_id) });
  } catch (error) {
    return privateApiError(error);
  }
}
