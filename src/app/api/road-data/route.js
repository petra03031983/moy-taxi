const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const CACHE_TTL_MS = 45_000;
const REQUEST_TIMEOUT_MS = 4_500;
const MAX_POINTS = 14;

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, s-maxage=45, stale-while-revalidate=180"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function readPoints(params) {
  const raw = params.get("points") || "";
  if (!raw) {
    const lat = finiteCoordinate(params.get("lat"), -90, 90);
    const lng = finiteCoordinate(params.get("lng"), -180, 180);
    if (lat === null || lng === null) return null;
    return [[lat, lng]];
  }

  const points = raw.split(";").slice(0, MAX_POINTS).map((pair) => {
    const parts = pair.split(",");
    const lat = finiteCoordinate(parts[0], -90, 90);
    const lng = finiteCoordinate(parts[1], -180, 180);
    return lat === null || lng === null ? null : [lat, lng];
  });

  if (!points.length || points.some((point) => !point)) return null;
  return points;
}

function makeQuery(mode, points, radius) {
  const coordinates = points
    .map(([lat, lng]) => lat.toFixed(5) + "," + lng.toFixed(5))
    .join(",");
  const around = "around:" + radius + "," + coordinates;

  if (mode === "speed") {
    const lat = points[0][0].toFixed(6);
    const lng = points[0][1].toFixed(6);
    return "[out:json][timeout:8];(" +
      "way(around:220," + lat + "," + lng + ")[highway];" +
      "node(around:100," + lat + "," + lng + ")[maxspeed];" +
      "node(around:100," + lat + "," + lng + ")[traffic_sign];" +
      "node(around:100," + lat + "," + lng + ")[\"traffic_sign:maxspeed\"];" +
      ");out tags geom;";
  }

  return "[out:json][timeout:10];(" +
    "nwr(" + around + ")[highway=traffic_signals];" +
    "nwr(" + around + ")[highway=speed_camera];" +
    "nwr(" + around + ")[highway=red_light_camera];" +
    "nwr(" + around + ")[man_made=speed_camera];" +
    "nwr(" + around + ")[traffic_sign];" +
    "nwr(" + around + ")[\"traffic_sign:maxspeed\"];" +
    "nwr(" + around + ")[maxspeed];" +
    "nwr(" + around + ")[enforcement~\"maxspeed|average_speed|red_light|speed_camera\"];" +
    "nwr(" + around + ")[man_made=surveillance][\"surveillance:type\"~\"camera|traffic|speed|red_light|enforcement|alpr|license_plate\"];" +
    "nwr(" + around + ")[man_made=surveillance][\"surveillance:zone\"~\"traffic|road|red_light\"];" +
    "nwr(" + around + ")[\"camera:type\"~\"speed|traffic|red_light|enforcement|alpr|license_plate\"];" +
    "nwr(" + around + ")[\"monitoring:traffic\"=yes];" +
    "nwr(" + around + ")[highway=construction];" +
    "nwr(" + around + ")[roadworks=yes];" +
    "nwr(" + around + ")[barrier=road_block];" +
    "nwr(" + around + ")[highway=road_closed];" +
    "nwr(" + around + ")[hazard];" +
    "nwr(" + around + ")[\"hazard:prone\"=yes];" +
    ");out tags center;";
}

async function postOverpass(endpoint, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Overpass HTTP " + response.status);
    const payload = await response.json();
    if (!Array.isArray(payload && payload.elements)) throw new Error("Invalid Overpass payload");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function getMemoryCache() {
  if (!globalThis.__moyTaxiRoadDataCache) globalThis.__moyTaxiRoadDataCache = new Map();
  return globalThis.__moyTaxiRoadDataCache;
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode") === "speed" ? "speed" : "objects";
  const points = readPoints(params);
  if (!points) return jsonResponse({ error: "Valid coordinates are required." }, 400);

  const requestedRadius = Number(params.get("radius") || 260);
  const radius = Math.max(100, Math.min(mode === "speed" ? 220 : 900,
    Number.isFinite(requestedRadius) ? requestedRadius : 260));
  const cacheKey = mode + ":" + radius + ":" + points
    .map(([lat, lng]) => lat.toFixed(3) + "," + lng.toFixed(3))
    .join(";");
  const memoryCache = getMemoryCache();
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return jsonResponse({ ...cached.payload, cached: true });
  }

  const query = makeQuery(mode, points, radius);
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const payload = await postOverpass(endpoint, query);
      const result = {
        elements: payload.elements,
        source: "OpenStreetMap / Overpass",
        fetchedAt: new Date().toISOString(),
        cached: false,
        count: payload.elements.length,
      };
      memoryCache.set(cacheKey, { savedAt: Date.now(), payload: result });
      if (memoryCache.size > 300) {
        for (const [key, value] of memoryCache) {
          if (Date.now() - value.savedAt > CACHE_TTL_MS * 4) memoryCache.delete(key);
          if (memoryCache.size <= 220) break;
        }
      }
      return jsonResponse(result);
    } catch (error) {
      lastError = error;
    }
  }

  return jsonResponse({
    error: "Road data source is temporarily unavailable.",
    details: lastError && lastError.name === "AbortError" ? "timeout" : "source_unavailable",
    source: "OpenStreetMap / Overpass",
  }, 502);
}
