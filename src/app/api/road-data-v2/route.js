const ENDPOINTS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const CACHE_TTL = 120000;
const cache = globalThis.__astanaRoadDataV2Cache || (globalThis.__astanaRoadDataV2Cache = new Map());

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": status === 200 ? "public, max-age=20, s-maxage=60, stale-while-revalidate=300" : "no-store" },
  });
}

function pointsFrom(params) {
  const raw = params.get("points") || "";
  if (raw) {
    return raw.split(";").slice(0, 8).map(pair => pair.split(",").map(Number)).filter(p => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  return Number.isFinite(lat) && Number.isFinite(lng) ? [[lat, lng]] : [];
}

function boundsFor(points, radius) {
  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  const centerLat = lats.reduce((a,b) => a+b, 0) / lats.length;
  const latPad = Math.max(0.0015, radius / 111320 * 1.35);
  const lngPad = Math.max(0.002, radius / (111320 * Math.max(0.35, Math.cos(centerLat * Math.PI / 180))) * 1.35);
  return [Math.min(...lats)-latPad, Math.min(...lngs)-lngPad, Math.max(...lats)+latPad, Math.max(...lngs)+lngPad].map(n => n.toFixed(5)).join(",");
}

function queryFor(points, radius) {
  const b = boundsFor(points, radius);
  return `[out:json][timeout:8];(
    node(${b})[highway=traffic_signals];
    node(${b})[highway=speed_camera];
    node(${b})[highway=red_light_camera];
    node(${b})[man_made=surveillance];
    node(${b})["camera:type"];
    node(${b})["monitoring:traffic"];
    node(${b})[traffic_sign];
    node(${b})["traffic_sign:forward"];
    node(${b})["traffic_sign:backward"];
    node(${b})["traffic_sign:maxspeed"];
    way(${b})[maxspeed];
  );out tags center;`;
}

async function overpass(query) {
  let last;
  for (const endpoint of ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!r.ok) { last = new Error(`Overpass ${r.status}`); continue; }
      const data = await r.json();
      if (Array.isArray(data?.elements)) return data.elements;
      last = new Error("Некорректный ответ Overpass");
    } catch (e) { last = e; }
    finally { clearTimeout(timer); }
  }
  throw last || new Error("Источники дорожных данных недоступны");
}

function normalize(elements) {
  return elements.map((e) => {
    const tags = e.tags || {};
    const highway = String(tags.highway || "").toLowerCase();
    const surveillance = String(tags["surveillance:type"] || tags.surveillance || tags["camera:type"] || "").toLowerCase();
    const enforcement = String(tags.enforcement || tags["enforcement:type"] || "").toLowerCase();
    let kind = null;
    if (highway === "traffic_signals") kind = "traffic-light";
    else if (highway === "speed_camera" || highway === "red_light_camera" || /speed|red_light|enforcement|alpr|license_plate/.test(surveillance + " " + enforcement) || tags["monitoring:traffic"] === "yes") kind = "camera";
    else if (tags.maxspeed || tags["maxspeed:forward"] || tags["maxspeed:backward"] || tags["traffic_sign:maxspeed"]) kind = "speed-sign";
    else if (tags.traffic_sign || tags["traffic_sign:forward"] || tags["traffic_sign:backward"]) kind = "traffic-sign";
    if (!kind) return null;
    const lat = Number(e.lat ?? e.center?.lat);
    const lng = Number(e.lon ?? e.center?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const speedRaw = tags["traffic_sign:maxspeed"] || tags.maxspeed || tags["maxspeed:forward"] || tags["maxspeed:backward"] || "";
    const speedMatch = String(speedRaw).match(/(\d{1,3})/);
    return {
      type: e.type || "node",
      id: `osm-${e.type || "node"}-${e.id ?? `${lat.toFixed(6)}-${lng.toFixed(6)}`}`,
      lat, lng, kind,
      title: kind === "camera" ? "Камера дорожного наблюдения" : kind === "traffic-light" ? "Светофор" : kind === "speed-sign" ? "Знак ограничения скорости" : "Дорожный знак",
      shortLabel: kind === "camera" ? "К" : kind === "traffic-light" ? "С" : kind === "speed-sign" ? "" : "З",
      speedLimit: speedMatch ? Number(speedMatch[1]) : null,
      tags,
    };
  }).filter(Boolean);
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const points = pointsFrom(params);
  if (!points.length) return response({ error: "Valid coordinates are required.", elements: [] }, 400);
  const radius = Math.max(150, Math.min(1200, Number(params.get("radius") || 500)));
  const key = points.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(";") + `:${radius}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return response({ ...cached.payload, cached: true });
  try {
    const elements = normalize(await overpass(queryFor(points, radius)));
    const payload = { elements, source: "OpenStreetMap / Overpass (direct road-object query)", count: elements.length, diagnostics: { trafficLights: elements.filter(x=>x.kind==="traffic-light").length, cameras: elements.filter(x=>x.kind==="camera").length, speedLimits: elements.filter(x=>x.kind==="speed-sign").length }, partial: false, fetchedAt: new Date().toISOString() };
    cache.set(key, { at: Date.now(), payload });
    return response(payload);
  } catch (error) {
    if (cached) return response({ ...cached.payload, cached: true, stale: true, partial: true });
    return response({ error: "Road data source is temporarily unavailable.", details: String(error?.message || "source_unavailable"), elements: [], partial: true }, 502);
  }
}
