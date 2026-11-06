const OVERPASS_ENDPOINT = "https://overpass.kumi.systems/api/interpreter";
const ASTANA_BBOX = "50.85,71.00,51.40,71.85";
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 18_000;

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, max-age=60, s-maxage=300" : "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/ж\s*[./-]\s*д/g, "железнодорожный")
    .replace(/\bжд\b/g, "железнодорожный")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function qlString(value) {
  return '"' + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + '"';
}

function distanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(a.lat - b.lat);
  const dLon = radians(a.lon - b.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function polygonCentroid(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const cross = a.lon * b.lat - b.lon * a.lat;
    area2 += cross;
    cx += (a.lon + b.lon) * cross;
    cy += (a.lat + b.lat) * cross;
  }
  if (Math.abs(area2) < 1e-12) return null;
  return { lat: cy / (3 * area2), lon: cx / (3 * area2) };
}

function geometryPoint(element) {
  if (Number.isFinite(Number(element?.lat)) && Number.isFinite(Number(element?.lon))) {
    return { lat: Number(element.lat), lon: Number(element.lon), locationType: "OSM node" };
  }
  const geometry = element?.geometry;
  if (!Array.isArray(geometry) || !geometry.length) return null;
  const points = geometry.map(point => ({
    lat: Number(point?.lat),
    lon: Number(point?.lon),
  })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (!points.length) return null;

  const isClosed = points.length >= 4 &&
    Math.abs(points[0].lat - points[points.length - 1].lat) < 1e-8 &&
    Math.abs(points[0].lon - points[points.length - 1].lon) < 1e-8;
  if (isClosed) {
    const centroid = polygonCentroid(points.slice(0, -1));
    if (centroid) return { ...centroid, locationType: "OSM building geometry" };
  }

  // For open linear ways, use the middle vertex of the mapped geometry,
  // never the bounding-box center returned by Overpass "out center".
  const middle = points[Math.floor((points.length - 1) / 2)];
  return { ...middle, locationType: "OSM way geometry" };
}

function pointInsideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon, yi = ring[i].lat;
    const xj = ring[j].lon, yj = ring[j].lat;
    const intersects = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lon < (xj - xi) * (point.lat - yi) / ((yj - yi) || 1e-15) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointFromElement(element, entranceNodes) {
  const point = geometryPoint(element);
  if (!point) return null;
  const geometry = element?.geometry;
  const isClosed = Array.isArray(geometry) && geometry.length >= 4 &&
    Math.abs(geometry[0].lat - geometry[geometry.length - 1].lat) < 1e-8 &&
    Math.abs(geometry[0].lon - geometry[geometry.length - 1].lon) < 1e-8;

  if (isClosed) {
    const ring = geometry.map(p => ({ lat: Number(p.lat), lon: Number(p.lon) }));
    const nearbyEntrance = entranceNodes
      .map(node => ({
        node,
        distance: distanceMeters(point, { lat: Number(node.lat), lon: Number(node.lon) }),
      }))
      .filter(item => item.distance <= 35)
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearbyEntrance) {
      return {
        lat: Number(nearbyEntrance.node.lat),
        lon: Number(nearbyEntrance.node.lon),
        locationType: "OSM entrance node",
      };
    }
    if (!pointInsideRing(point, ring)) {
      const inner = ring.slice(0, -1);
      return {
        lat: inner.reduce((sum, p) => sum + p.lat, 0) / inner.length,
        lon: inner.reduce((sum, p) => sum + p.lon, 0) / inner.length,
        locationType: "OSM building geometry",
      };
    }
  }
  return point;
}

function buildQuery(payload) {
  const query = normalize(payload.query);
  const name = String(payload.name || "").trim();
  const displayName = String(payload.displayName || "").trim();
  const category = normalize(payload.category);
  const streetFromItem = String(payload.street || "").trim();
  const houseFromItem = String(payload.houseNumber || "").trim();
  const addressMatch = query.match(/^(.+?)\\s+(\\d+[0-9а-яa-z]*(?:[/-]\\d+[0-9а-яa-z]*)?)$/i);
  const itemStreetMatch = streetFromItem.match(/^(.+?)\\s+(\\d+[0-9а-яa-z]*(?:[/-]\\d+[0-9а-яa-z]*)?)$/i);
  const street = itemStreetMatch?.[1] || addressMatch?.[1] || streetFromItem;
  const houseNumber = houseFromItem || itemStreetMatch?.[2] || addressMatch?.[2] || "";
  const stationSearch = /вокзал|железнодорожн|\\bжд\\b|станци/.test(query) ||
    /railway_station|railway/.test(category) || payload.osmKey === "railway";

  const refType = String(payload.osmRefType || "").toLowerCase();
  const refId = String(payload.osmRefId || "").trim();
  if (/^(node|way|relation)$/.test(refType) && /^\\d+$/.test(refId)) {
    return `[out:json][timeout:10];${refType}(id:${refId});out geom tags;`;
  }

  const focusLat = Number(payload.lat);
  const focusLon = Number(payload.lon);
  const radius = stationSearch ? 1500 : 850;
  const latPadding = Number.isFinite(focusLat) && focusLat >= 50 && focusLat <= 52
    ? radius / 111320
    : null;
  const lonPadding = latPadding !== null
    ? radius / (111320 * Math.max(0.55, Math.cos(focusLat * Math.PI / 180)))
    : null;
  const bbox = latPadding !== null && Number.isFinite(focusLon) && focusLon >= 70 && focusLon <= 73
    ? [
        (focusLat - latPadding).toFixed(5),
        (focusLon - lonPadding).toFixed(5),
        (focusLat + latPadding).toFixed(5),
        (focusLon + lonPadding).toFixed(5),
      ].join(",")
    : ASTANA_BBOX;

  const selectors = [];
  if (stationSearch) {
    selectors.push(
      `nwr(${bbox})[railway=station];`,
      `nwr(${bbox})[public_transport=station];`,
      `nwr(${bbox})[building=train_station];`,
      `nwr(${bbox})[railway=halt];`,
      `nwr(${bbox})[amenity=bus_station];`,
    );
  } else {
    if (street && houseNumber) {
      const streetRegex = escapeRegex(street);
      const numberRegex = escapeRegex(houseNumber);
      selectors.push(
        `nwr(${bbox})["addr:street"~${qlString(streetRegex)},i]["addr:housenumber"~${qlString(numberRegex)},i];`,
        `nwr(${bbox})["addr:full"~${qlString(streetRegex + ".*" + numberRegex)},i];`,
        `nwr(${bbox})[name~${qlString(streetRegex + ".*" + numberRegex)},i];`,
      );
    } else if (street) {
      const streetRegex = escapeRegex(street);
      selectors.push(
        `nwr(${bbox})["addr:street"~${qlString(streetRegex)},i];`,
        `way(${bbox})[highway][name~${qlString(streetRegex)},i];`,
      );
    }

    const searchNames = [query, name, displayName]
      .map(value => String(value || "").trim())
      .filter(value => value.length >= 3);
    for (const value of [...new Set(searchNames)].slice(0, 2)) {
      const pattern = escapeRegex(value);
      selectors.push(
        `nwr(${bbox})[name~${qlString(pattern)},i];`,
        `nwr(${bbox})["name:ru"~${qlString(pattern)},i];`,
        `nwr(${bbox})["name:kk"~${qlString(pattern)},i];`,
        `nwr(${bbox})[official_name~${qlString(pattern)},i];`,
        `nwr(${bbox})[alt_name~${qlString(pattern)},i];`,
      );
    }
  }

  if (!selectors.length) throw new Error("Недостаточно данных для точного поиска в OpenStreetMap.");
  return `[out:json][timeout:16];(
${selectors.join("\\n")}
)->.matches;(
.matches;
node(around.matches:20)[entrance];
)->.all;
.all out geom tags qt;`;
}

function elementText(tags) {
  return normalize([
    tags?.name, tags?.["name:ru"], tags?.["name:kk"], tags?.official_name,
    tags?.alt_name, tags?.brand, tags?.operator,
    tags?.["addr:street"], tags?.["addr:housenumber"], tags?.["addr:full"],
  ].filter(Boolean).join(" "));
}

function matchScore(element, payload) {
  const tags = element?.tags || {};
  const query = normalize(payload.query);
  const name = normalize(payload.name);
  const display = normalize(payload.displayName);
  const street = normalize(payload.street);
  const house = normalize(payload.houseNumber);
  const text = elementText(tags);
  let score = 0;

  if (house && street) {
    if (normalize(tags["addr:street"]) === street) score += 10;
    else if (normalize(tags["addr:street"]).includes(street)) score += 7;
    if (normalize(tags["addr:housenumber"]) === house) score += 12;
    else if (normalize(tags["addr:housenumber"]).includes(house)) score += 6;
    if (normalize(tags["addr:full"]).includes(street) && normalize(tags["addr:full"]).includes(house)) score += 8;
  }

  if (name && text.includes(name)) score += 8;
  if (display && text.includes(display)) score += 7;
  const tokens = query.split(/\s+/).filter(token => token.length >= 3 && !["улица","проспект","дом","вокзал","железнодорожный"].includes(token));
  for (const token of tokens) if (text.includes(token)) score += 2;

  const tagsCategory = normalize([tags.railway, tags.public_transport, tags.building, tags.amenity].filter(Boolean).join(" "));
  if (/вокзал|железнодорожн|станци/.test(query) && /(station|train_station|halt|bus_station)/.test(tagsCategory)) score += 8;
  if (element.type === "node") score += 1;
  if (tags.entrance) score -= 4;
  return score;
}

function toFeature(element, point, payload) {
  const tags = element.tags || {};
  const name = tags["name:ru"] || tags["name:kk"] || tags.name ||
    tags.official_name || payload.name || tags["addr:street"] || "Место на карте";
  const street = tags["addr:street"] || "";
  const houseNumber = tags["addr:housenumber"] || "";
  const address = [
    street,
    houseNumber ? "д. " + houseNumber : "",
    tags["addr:suburb"] || "",
    "Астана",
  ].filter(Boolean).join(", ");
  return {
    lat: point.lat,
    lon: point.lon,
    locationType: point.locationType,
    osmType: element.type,
    osmId: element.id,
    displayName: address ? `${name} — ${address}` : name,
    tags,
  };
}

function cacheStore() {
  if (!globalThis.__astanaOverpassGeocodeCache) globalThis.__astanaOverpassGeocodeCache = new Map();
  return globalThis.__astanaOverpassGeocodeCache;
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Некорректный запрос координат." }, 400);

  const query = normalize(body.query);
  const name = String(body.name || "").trim();
  const street = String(body.street || "").trim();
  const houseNumber = String(body.houseNumber || "").trim();
  const displayName = String(body.displayName || "").trim();
  if (!query && !name && !street) return json({ error: "Не указан адрес или название места." }, 400);

  const cacheKey = normalize([query,name,street,houseNumber,displayName,body.category].join("|"));
  const cache = cacheStore();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) {
    return json({ ...cached.payload, cached: true });
  }

  let overpassQuery;
  try {
    overpassQuery = buildQuery(body);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json",
        "User-Agent": "AstanaGuide/1.0 (https://astana-map-roads.vercel.app/; address coordinate refinement)",
        Referer: "https://astana-map-roads.vercel.app/",
      },
      body: new URLSearchParams({ data: overpassQuery }).toString(),
      signal: controller.signal,
      cache: "no-store",
    });

    if (response.status === 429 || response.status === 406) {
      const retryAfter = response.headers.get("Retry-After") || "30";
      return json({
        error: "Overpass временно ограничил запросы. Точная точка не установлена; старые приблизительные координаты не использованы.",
        providerStatus: response.status,
        retryAfter,
      }, 503, { "Retry-After": retryAfter });
    }
    if (!response.ok) {
      return json({
        error: "Overpass не смог подтвердить точку. Старые приблизительные координаты не использованы.",
        providerStatus: response.status,
      }, 502);
    }

    const data = await response.json();
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const entrances = elements.filter(element => element?.type === "node" && element?.tags?.entrance);
    const matches = elements.filter(element => element?.tags && !element.tags.entrance);
    const ranked = matches
      .map(element => ({ element, score: matchScore(element, body) }))
      .filter(item => item.score > 0)
      .sort((a,b) => b.score - a.score);

    const reference = {
      lat: Number(body.lat),
      lon: Number(body.lon),
    };
    const candidates = ranked.map(({element,score}) => {
      const point = pointFromElement(element, entrances);
      if (!point) return null;
      const distance = Number.isFinite(reference.lat) && Number.isFinite(reference.lon)
        ? distanceMeters(point, reference)
        : 0;
      return { element, point, score, distance };
    }).filter(Boolean).sort((a,b) => b.score - a.score || a.distance - b.distance);

    if (!candidates.length) {
      return json({
        error: "В OpenStreetMap не найден объект с подтверждённым адресом или названием. Примерная точка не использована.",
        provider: "OpenStreetMap / Overpass",
      }, 404);
    }

    const best = candidates[0];
    if (best.score < 3) {
      return json({
        error: "Найден только похожий объект, но адрес не подтверждён. Примерная точка не использована.",
        provider: "OpenStreetMap / Overpass",
      }, 404);
    }

    const result = toFeature(best.element, best.point, body);
    const payload = {
      lat: result.lat,
      lon: result.lon,
      locationType: result.locationType,
      osmType: result.osmType,
      osmId: result.osmId,
      displayName: result.displayName,
      provider: "OpenStreetMap / Overpass",
    };
    cache.set(cacheKey, { savedAt: Date.now(), payload });
    if (cache.size > 250) {
      for (const [key, entry] of cache) {
        if (Date.now() - entry.savedAt > CACHE_TTL_MS * 2) cache.delete(key);
        if (cache.size <= 180) break;
      }
    }
    return json(payload);
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json({
      error: timedOut
        ? "Overpass отвечает слишком долго. Точная точка не установлена; старые приблизительные координаты не использованы."
        : "Не удалось получить точные координаты из OpenStreetMap / Overpass.",
    }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
