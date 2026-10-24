const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

const CACHE_TTL_MS = 5 * 60 * 1000;
const CAMERA_CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3_500;
const EXTERNAL_TIMEOUT_MS = 3_000;
const MAX_POINTS = 4;
const MAX_OVERPASS_ATTEMPTS = 2;
const ASTANA_PARKING_ENDPOINT = "https://gis.esaulet.kz/server/rest/services/dop_sloi_geoportal_otkr/MapServer/7/query";
const PUBLIC_CAMERA_ENDPOINT = "https://qgeo.tech/api/v1/external-layers/public-cameras?lang=ru";

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, s-maxage=300, stale-while-revalidate=900"
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
  if (mode === "speed") {
    const lat = points[0][0].toFixed(6);
    const lng = points[0][1].toFixed(6);
    return "[out:json][timeout:4];(" +
      "way(around:220," + lat + "," + lng + ")[highway];" +
      "node(around:180," + lat + "," + lng + ")[maxspeed];" +
      "node(around:180," + lat + "," + lng + ")[traffic_sign];" +
      "node(around:180," + lat + "," + lng + ")[\"traffic_sign:maxspeed\"];" +
      "node(around:180," + lat + "," + lng + ")[\"traffic_sign:forward\"];" +
      "node(around:180," + lat + "," + lng + ")[\"traffic_sign:backward\"];" +
      ");out tags geom;";
  }

  const coordinates = points
    .map(([lat, lng]) => lat.toFixed(5) + "," + lng.toFixed(5))
    .join(",");
  const around = "around:" + radius + "," + coordinates;

  const selectors = [
    `node(${around})[highway~"^(traffic_signals|crossing|stop|give_way|speed_camera|red_light_camera)$"];`,
    `node(${around})[crossing];`,
    `node(${around})[traffic_sign];`,
    `node(${around})["traffic_sign:forward"];`,
    `node(${around})["traffic_sign:backward"];`,
    `node(${around})["traffic_sign:maxspeed"];`,
    `nwr(${around})[maxspeed];`,
    `node(${around})[man_made=surveillance]["surveillance:type"~"^(camera|traffic|speed|red_light|enforcement)$"];`,
    `node(${around})["camera:type"~"^(speed|traffic|red_light|enforcement)$"];`,
    `nwr(${around})[amenity=parking];`,
    `way(${around})[highway=construction];`,
    `nwr(${around})[roadworks=yes];`,
  ];
  return "[out:json][timeout:3];(" + selectors.join("") + ");out tags center;"
}

function makeFallbackQuery(mode, points, radius) {
  if (mode === "speed") {
    const lat = points[0][0].toFixed(6);
    const lng = points[0][1].toFixed(6);
    return "[out:json][timeout:3];(" +
      "way(around:180," + lat + "," + lng + ")[highway];" +
      "node(around:120," + lat + "," + lng + ")[maxspeed];" +
      "node(around:120," + lat + "," + lng + ")[traffic_sign];" +
      ");out tags center;";
  }
  const coordinates = points
    .slice(0, 4)
    .map(([lat, lng]) => lat.toFixed(3) + "," + lng.toFixed(3))
    .join(",");
  const around = "around:" + Math.min(radius, 450) + "," + coordinates;
  return "[out:json][timeout:3];(" +
    `node(${around})[highway=traffic_signals];` +
    `node(${around})[highway=crossing];` +
    `node(${around})[crossing];` +
    `node(${around})[highway=speed_camera];` +
    `node(${around})[highway=red_light_camera];` +
    `node(${around})[traffic_sign];` +
    `node(${around})["traffic_sign:maxspeed"];` +
    `nwr(${around})[maxspeed];` +
    ");out tags center;";
}


function getOverpassState() {
  if (!globalThis.__astanaOverpassState) {
    globalThis.__astanaOverpassState = {
      blockedUntilByHost: {},
      nextEndpointIndex: 0,
    };
  }
  const state = globalThis.__astanaOverpassState;
  if (!state.blockedUntilByHost) state.blockedUntilByHost = {};
  if (!Number.isFinite(state.nextEndpointIndex)) state.nextEndpointIndex = 0;
  return state;
}

function retryAfterMs(response) {
  const value = String(response.headers.get("Retry-After") || "").trim();
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(30_000, Math.min(10 * 60_000, seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(30_000, Math.min(10 * 60_000, date - Date.now()));
  return 60_000;
}

async function postOverpass(endpoint, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const host = new URL(endpoint).host;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
        "User-Agent": "AstanaGuide/1.0 (+https://astana-map-roads.vercel.app/)",
        "Referer": "https://astana-map-roads.vercel.app/",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });
    if (response.status === 429) {
      const waitMs = retryAfterMs(response);
      const state = getOverpassState();
      state.blockedUntilByHost[host] = Date.now() + waitMs;
      const error = new Error("HTTP 429; источник временно ограничил запросы, пауза " + Math.ceil(waitMs / 1000) + " с");
      error.status = 429;
      throw error;
    }
    if (!response.ok) {
      const error = new Error("HTTP " + response.status);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    if (!Array.isArray(payload && payload.elements)) throw new Error("Invalid JSON response");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

// Try one provider per request. If it fails, the API route makes at most one
// lighter retry on the next eligible provider; 429 cooldown is kept per host.
async function fetchFromAnyOverpass(query, endpoints) {
  const state = getOverpassState();
  const now = Date.now();
  let selectedIndex = -1;
  let earliestCooldown = Infinity;

  for (let offset = 0; offset < endpoints.length; offset += 1) {
    const index = (state.nextEndpointIndex + offset) % endpoints.length;
    const host = new URL(endpoints[index]).host;
    const blockedUntil = Number(state.blockedUntilByHost[host] || 0);
    if (blockedUntil <= now) {
      delete state.blockedUntilByHost[host];
      selectedIndex = index;
      break;
    }
    earliestCooldown = Math.min(earliestCooldown, blockedUntil);
  }

  if (selectedIndex < 0) {
    const waitSeconds = Number.isFinite(earliestCooldown) ? Math.ceil((earliestCooldown - now) / 1000) : 60;
    const error = new Error("Все публичные источники временно ограничили запросы; повтор через " + Math.max(1, waitSeconds) + " с");
    error.status = 429;
    throw error;
  }

  const endpoint = endpoints[selectedIndex];
  const host = new URL(endpoint).host;
  try {
    const payload = await postOverpass(endpoint, query);
    state.nextEndpointIndex = (selectedIndex + 1) % endpoints.length;
    return payload;
  } catch (error) {
    state.nextEndpointIndex = (selectedIndex + 1) % endpoints.length;
    const detail = error && error.name === "AbortError"
      ? "timeout"
      : String(error && error.message || "request failed");
    const wrapped = new Error(host + ": " + detail);
    if (error && Number.isFinite(error.status)) wrapped.status = error.status;
    throw wrapped;
  }
}

function summarizeRoadObjects(elements = []) {
  const counts = {
    trafficLights: 0,
    speedCameras: 0,
    surveillanceCameras: 0,
    speedLimits: 0,
    trafficSigns: 0,
    pedestrianCrossings: 0,
    parking: 0,
    roadEvents: 0,
  };

  for (const element of elements) {
    const tags = element && element.tags ? element.tags : {};
    const highway = String(tags.highway || "").toLowerCase();
    const amenity = String(tags.amenity || "").toLowerCase();
    const sign = String(tags.traffic_sign || tags["traffic_sign:forward"] || tags["traffic_sign:backward"] || "");
    const enforcement = String(tags.enforcement || tags["enforcement:type"] || "").toLowerCase();
    const cameraType = String(tags["camera:type"] || tags["surveillance:type"] || "").toLowerCase();

    if (highway === "traffic_signals") counts.trafficLights += 1;
    if (highway === "speed_camera" || highway === "red_light_camera" ||
        tags.man_made === "speed_camera" || /speed_camera|average_speed|maxspeed/.test(enforcement) ||
        /speed|red_light/.test(cameraType)) counts.speedCameras += 1;
    else if (tags.man_made === "surveillance" || tags["monitoring:traffic"] === "yes" ||
        /camera|traffic/.test(cameraType)) counts.surveillanceCameras += 1;

    if (tags.maxspeed || tags["traffic_sign:maxspeed"] ||
        tags["maxspeed:forward"] || tags["maxspeed:backward"]) counts.speedLimits += 1;

    if (sign || tags["traffic_sign:maxspeed"]) counts.trafficSigns += 1;
    if (highway === "crossing" || tags.crossing || tags["crossing:markings"] || tags.footway === "crossing") {
      counts.pedestrianCrossings += 1;
    }
    if (amenity === "parking" || tags.parking || tags.parking_space || tags["parking:lane"]) {
      counts.parking += 1;
    }
    if (highway === "construction" || tags.roadworks === "yes" || tags.hazard || tags["road:closed"] === "yes") {
      counts.roadEvents += 1;
    }
  }

  return counts;
}

async function fetchExternalJson(url, timeoutMs = EXTERNAL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, application/geo+json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("External road-data HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function polygonCentroid(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === "Point") {
    const coords = geometry.coordinates;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }

  let ring = null;
  if (geometry.type === "Polygon") ring = geometry.coordinates[0];
  if (geometry.type === "MultiPolygon") ring = geometry.coordinates[0] && geometry.coordinates[0][0];
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let lngTotal = 0;
  let latTotal = 0;
  let count = 0;
  for (const point of ring) {
    const lng = Number(point && point[0]);
    const lat = Number(point && point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    lngTotal += lng;
    latTotal += lat;
    count += 1;
  }
  return count ? [latTotal / count, lngTotal / count] : null;
}

function isNearAstana(points) {
  return points.some(([lat, lng]) =>
    lat >= 50.8 && lat <= 51.55 && lng >= 70.8 && lng <= 72.1
  );
}

async function fetchOfficialParking(points, radius) {
  if (!points.length || !isNearAstana(points)) return [];
  const lats = points.map(point => point[0]);
  const lngs = points.map(point => point[1]);
  const centerLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
  const latPadding = Math.max(0.0025, radius / 111320 * 1.5);
  const lngPadding = Math.max(
    0.003,
    radius / (111320 * Math.max(0.35, Math.cos(centerLat * Math.PI / 180))) * 1.5,
  );
  const minLat = Math.min(...lats) - latPadding;
  const maxLat = Math.max(...lats) + latPadding;
  const minLng = Math.min(...lngs) - lngPadding;
  const maxLng = Math.max(...lngs) + lngPadding;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: [minLng, minLat, maxLng, maxLat].join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,NAME,NOTE,REGION,OBLAST",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "1000",
    f: "geojson",
  });

  const collection = await fetchExternalJson(
    ASTANA_PARKING_ENDPOINT + "?" + params.toString(),
    EXTERNAL_TIMEOUT_MS,
  );
  const features = Array.isArray(collection && collection.features) ? collection.features : [];
  const elements = [];
  for (const feature of features) {
    const center = polygonCentroid(feature && feature.geometry);
    if (!center) continue;
    const [lat, lon] = center;
    if (lat < 50.8 || lat > 51.55 || lon < 70.8 || lon > 72.1) continue;
    const properties = feature.properties || {};
    const id = properties.OBJECTID ?? feature.id ?? (lat.toFixed(6) + "-" + lon.toFixed(6));
    elements.push({
      type: "node",
      id: "astana-gis-parking-" + String(id),
      lat,
      lon,
      tags: {
        amenity: "parking",
        name: String(properties.NAME || "Автомобильная парковка"),
        note: String(properties.NOTE || ""),
        source: "astana-gis",
        region: String(properties.REGION || ""),
      },
    });
  }
  return elements;
}

async function fetchOfficialUnderpasses(points, radius) {
  if (!points.length || !isNearAstana(points)) return [];
  const lats = points.map(point => point[0]);
  const lngs = points.map(point => point[1]);
  const centerLat = lats.reduce((sum, value) => sum + value, 0) / lats.length;
  const latPadding = Math.max(0.0025, radius / 111320 * 1.5);
  const lngPadding = Math.max(
    0.003,
    radius / (111320 * Math.max(0.35, Math.cos(centerLat * Math.PI / 180))) * 1.5,
  );
  const minLat = Math.min(...lats) - latPadding;
  const maxLat = Math.max(...lats) + latPadding;
  const minLng = Math.min(...lngs) - lngPadding;
  const maxLng = Math.max(...lngs) + lngPadding;
  const params = new URLSearchParams({
    where: "1=1",
    geometry: [minLng, minLat, maxLng, maxLat].join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,NAME,NOTE,REGION,OBLAST",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "500",
    f: "geojson",
  });
  const collection = await fetchExternalJson(
    "https://gis.esaulet.kz/server/rest/services/dop_sloi_geoportal_otkr/MapServer/3/query?" + params.toString(),
    EXTERNAL_TIMEOUT_MS,
  );
  const features = Array.isArray(collection && collection.features) ? collection.features : [];
  const elements = [];
  for (const feature of features) {
    const center = polygonCentroid(feature && feature.geometry);
    if (!center) continue;
    const [lat, lon] = center;
    if (lat < 50.8 || lat > 51.55 || lon < 70.8 || lon > 72.1) continue;
    const properties = feature.properties || {};
    const id = properties.OBJECTID ?? feature.id ?? (lat.toFixed(6) + "-" + lon.toFixed(6));
    elements.push({
      type: "node",
      id: "astana-gis-underpass-" + String(id),
      lat,
      lon,
      tags: {
        highway: "crossing",
        crossing: "underpass",
        location: "underground",
        name: String(properties.NAME || "Подземный пешеходный переход"),
        note: String(properties.NOTE || ""),
        source: "astana-gis",
        source_layer: "underpasses",
        region: String(properties.REGION || ""),
      },
    });
  }
  return elements;
}

async function fetchPublicCameraElements() {
  const collection = await fetchExternalJson(PUBLIC_CAMERA_ENDPOINT, EXTERNAL_TIMEOUT_MS);
  const features = Array.isArray(collection && collection.features) ? collection.features : [];
  return features.map((feature, index) => {
    const coordinates = feature && feature.geometry && feature.geometry.coordinates;
    const lon = Number(coordinates && coordinates[0]);
    const lat = Number(coordinates && coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 40 || lat > 56 || lon < 45 || lon > 90) return null;
    const properties = feature.properties || {};
    const rawUrl = String(properties.source_url || properties.url || "");
    const sourceUrl = /^https:\/\/[^\\s"'<>]+$/i.test(rawUrl) ? rawUrl : "";
    const cameraId = properties.camera_id || feature.id || (lat.toFixed(6) + "-" + lon.toFixed(6) + "-" + index);
    return {
      type: "node",
      id: "qazgeo-" + String(cameraId),
      lat,
      lon,
      tags: {
        name: String(properties.name || properties.name_ru || "Публичная камера"),
        source_url: sourceUrl,
        source: "qazgeo",
      },
    };
  }).filter(Boolean);
}

function mergeElements(primary, additional) {
  const unique = new Map();
  for (const element of [...(primary || []), ...(additional || [])]) {
    const id = String(element && element.type || "item") + ":" + String(element && element.id || "");
    if (!unique.has(id)) unique.set(id, element);
  }
  return Array.from(unique.values());
}

function getMemoryCache() {
  if (!globalThis.__moyTaxiRoadDataCache) globalThis.__moyTaxiRoadDataCache = new Map();
  return globalThis.__moyTaxiRoadDataCache;
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const requestedMode = params.get("mode");
  const mode = requestedMode === "speed" ? "speed" : requestedMode === "cameras" ? "cameras" : "objects";
  const memoryCache = getMemoryCache();

  if (mode === "cameras") {
    const cacheKey = "public-cameras:catalog";
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < CAMERA_CACHE_TTL_MS) {
      return jsonResponse({ ...cached.payload, cached: true });
    }
    try {
      const elements = await fetchPublicCameraElements();
      const result = {
        elements,
        source: "QazGeo public camera catalogue",
        fetchedAt: new Date().toISOString(),
        cached: false,
        count: elements.length,
      };
      memoryCache.set(cacheKey, { savedAt: Date.now(), payload: result });
      return jsonResponse(result);
    } catch (error) {
      return jsonResponse({
        error: "Public camera catalogue is temporarily unavailable.",
        details: error && error.name === "AbortError" ? "timeout" : "source_unavailable",
        source: "QazGeo public camera catalogue",
      }, 502);
    }
  }

  const points = readPoints(params);
  if (!points) return jsonResponse({ error: "Valid coordinates are required." }, 400);

  const requestedRadius = Number(params.get("radius") || 260);
  const radius = Math.max(100, Math.min(mode === "speed" ? 220 : 900,
    Number.isFinite(requestedRadius) ? requestedRadius : 260));
  const cacheKey = mode + ":" + radius + ":" + points
    .map(([lat, lng]) => lat.toFixed(3) + "," + lng.toFixed(3))
    .join(";");
  const cached = memoryCache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return jsonResponse({ ...cached.payload, cached: true });
  }

  const query = makeQuery(mode, points, radius);
  // Fetch the official Astana parking layer in parallel with OSM so a slow map-data
  // server does not prevent the driver from seeing available location records.
  const officialLayersPromise = mode === "objects"
    ? Promise.all([
        fetchOfficialParking(points, radius).catch(() => []),
        fetchOfficialUnderpasses(points, radius).catch(() => []),
      ]).then(([parking, underpasses]) => mergeElements(parking, underpasses))
    : Promise.resolve([]);
  let lastError = null;

  const endpoints = OVERPASS_ENDPOINTS;
  let payload = null;
  let fallbackUsed = false;
  try {
    payload = await fetchFromAnyOverpass(query, endpoints);
  } catch (error) {
    lastError = error;
    try {
      fallbackUsed = true;
      payload = await fetchFromAnyOverpass(makeFallbackQuery(mode, points, radius), endpoints);
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }

  if (payload) {
    const officialLayers = await officialLayersPromise;
    const elements = mergeElements(payload.elements, officialLayers);
    const result = {
      elements,
      source: (officialLayers.length
        ? "OpenStreetMap / Overpass + Astana city geoportal"
        : "OpenStreetMap / Overpass") + (fallbackUsed ? " (облегчённый запрос)" : ""),
      fetchedAt: new Date().toISOString(),
      cached: false,
      count: elements.length,
      diagnostics: summarizeRoadObjects(elements),
      sources: officialLayers.length ? ["OpenStreetMap / Overpass", "Astana city geoportal parking and underpasses"] : ["OpenStreetMap / Overpass"],
      fallbackUsed,
    };
    memoryCache.set(cacheKey, { savedAt: Date.now(), payload: result });
    if (memoryCache.size > 300) {
      for (const [key, value] of memoryCache) {
        if (Date.now() - value.savedAt > CACHE_TTL_MS * 4) memoryCache.delete(key);
        if (memoryCache.size <= 220) break;
      }
    }
    return jsonResponse(result);
  }

  const officialLayers = mode === "objects" ? await officialLayersPromise : [];
  if (officialLayers.length) {
    const result = {
      elements: officialLayers,
      source: "Astana city geoportal parking / underpasses (partial response)",
      fetchedAt: new Date().toISOString(),
      cached: false,
      count: officialLayers.length,
      diagnostics: summarizeRoadObjects(officialLayers),
      partial: true,
      sources: ["Astana city geoportal parking and underpasses"],
    };
    memoryCache.set(cacheKey, { savedAt: Date.now(), payload: result });
    return jsonResponse(result);
  }

  // If upstream providers are temporarily down, keep the last successful layer on screen.
  if (cached && Array.isArray(cached.payload?.elements) && cached.payload.elements.length) {
    return jsonResponse({
      ...cached.payload,
      cached: true,
      stale: true,
      partial: true,
      source: String(cached.payload.source || "OpenStreetMap / Overpass") + " — последние сохранённые данные",
    });
  }

  return jsonResponse({
    error: "Road data source is temporarily unavailable.",
    details: String(lastError && lastError.message || "source_unavailable").slice(0, 180),
    source: "OpenStreetMap / Overpass",
  }, 502);
}
