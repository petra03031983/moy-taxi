import { callAstanaRpc, readAccessKey, privateApiError } from "../_lib/astanaAccess.js";

const ALLOWED_KINDS = new Set(["speed-camera", "surveillance-camera", "traffic-light", "speed-limit", "traffic-sign", "stop-sign", "give-way-sign", "pedestrian-crossing", "no-stopping", "no-parking", "parking", "roadwork", "road-hazard"]);

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}

export async function GET(request) {
  const key = readAccessKey(request);
  if (!key) return json({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  try {
    const rows = await callAstanaRpc("astana_guide_get_manual_objects", { p_access_key: key });
    return json({ ok: true, objects: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    return privateApiError(error);
  }
}

export async function POST(request) {
  const key = readAccessKey(request);
  if (!key) return json({ ok: false, error: "Нужен личный ключ базы «Астана Гид»." }, 401);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Проверь данные объекта." }, 400); }
  const kind = String(body?.kind || "");
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const label = String(body?.label || "").trim().slice(0, 100);
  const notes = String(body?.notes || "").trim().slice(0, 500);
  const accuracy = Number(body?.accuracy_m ?? body?.accuracy ?? 20);
  if (!ALLOWED_KINDS.has(kind)) return json({ ok: false, error: "Выбери тип дорожного объекта." }, 400);
  if (!Number.isFinite(lat) || lat < 47 || lat > 55 || !Number.isFinite(lng) || lng < 65 || lng > 77) {
    return json({ ok: false, error: "Координаты вне зоны Астаны и ближайших районов." }, 400);
  }
  if (label.length < 2 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 150) {
    return json({ ok: false, error: "Укажи название объекта и корректную точность GPS." }, 400);
  }
  try {
    const result = await callAstanaRpc("astana_guide_add_manual_object", {
      p_access_key: key,
      p_kind: kind,
      p_lat: lat,
      p_lng: lng,
      p_label: label,
      p_notes: notes,
      p_accuracy_m: accuracy,
    });
    return json(result && typeof result === "object" ? result : { ok: false, error: "Не удалось сохранить объект." },
      result?.ok ? 200 : 500);
  } catch (error) {
    return privateApiError(error);
  }
}
