"use client";

const OVERPASS_URL = "https://overpass.private.coffee/api/interpreter";
const ASTANA_BBOX = "50.85,71.00,51.40,71.85";
const CACHE_TTL_MS = 30 * 60 * 1000;

function norm(value) {
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
  return String(value || "")
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/[{}]/g, "\\$&");
}

function ql(value) {
  return '"' + String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function streetNorm(value) {
  return norm(value)
    .replace(/^(улица|ул\.?|проспект|пр-т|пр\.?|переулок|пер\.?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildQuery(item, typedQuery) {
  const query = norm(typedQuery);
  const itemName = String(item?.name || "").trim();
  const displayName = String(item?.display_name || "").trim();
  const streetValue = String(item?.address?.road || item?.address?.pedestrian || item?.street || "").trim();
  const houseValue = String(item?.address?.house_number || item?.house_number || "").trim();
  const parsedQuery = query.match(/^(.+?)\s+(\d+[0-9а-яa-z]*(?:[/-]\d+[0-9а-яa-z]*)?)$/i);
  const parsedStreet = streetValue.match(/^(.+?)\s+(\d+[0-9а-яa-z]*(?:[/-]\d+[0-9а-яa-z]*)?)$/i);
  const street = parsedStreet?.[1] || parsedQuery?.[1] || streetValue;
  const house = houseValue || parsedStreet?.[2] || parsedQuery?.[2] || "";
  const refType = String(
    item?.address?.osm_ref_type || item?.osm_ref_type || item?.osm_type || ""
  ).toLowerCase();
  const refId = String(
    item?.address?.osm_ref_id || item?.osm_ref_id || item?.osm_id || ""
  ).trim();

  if (/^(node|way|relation)$/.test(refType) && /^\d+$/.test(refId)) {
    if (refType === "way" || refType === "relation") {
      return "[out:json][timeout:15];" + refType + "(" + refId + ")->.target;(" +
        ".target;node(around.target:35)[entrance];" +
        ")->.all;.all out geom tags;";
    }
    return "[out:json][timeout:10];node(" + refId + ");out geom tags;";
  }

  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  const stationSearch = /вокзал|железнодорожн|станци/.test(query) ||
    /railway|station/.test(norm(item?.category || item?.type || "")) ||
    String(item?.class || "").toLowerCase() === "railway";
  const radius = stationSearch ? 2500 : 1600;
  const latPad = Number.isFinite(lat) && lat >= 50 && lat <= 52 ? radius / 111320 : null;
  const lonPad = latPad !== null && Number.isFinite(lon) && lon >= 70 && lon <= 73
    ? radius / (111320 * Math.max(0.55, Math.cos(lat * Math.PI / 180)))
    : null;
  const localBox = latPad !== null && lonPad !== null
    ? [
        (lat - latPad).toFixed(5),
        (lon - lonPad).toFixed(5),
        (lat + latPad).toFixed(5),
        (lon + lonPad).toFixed(5),
      ].join(",")
    : ASTANA_BBOX;

  const selectors = [];
  if (stationSearch) {
    selectors.push(
      "nwr(" + localBox + ")[railway=station];",
      "nwr(" + localBox + ")[public_transport=station];",
      "nwr(" + localBox + ")[building=train_station];",
      "nwr(" + localBox + ")[railway=halt];",
      "nwr(" + localBox + ")[amenity=bus_station];"
    );
  } else if (street && house) {
    const streetPattern = escapeRegex(streetNorm(street));
    const housePattern = escapeRegex(house);
    selectors.push(
      'nwr(' + ASTANA_BBOX + ')["addr:street"~' + ql(streetPattern) + ',i]["addr:housenumber"~' + ql("^" + housePattern + "$") + ',i];',
      'nwr(' + ASTANA_BBOX + ')["addr:full"~' + ql(streetPattern + ".*" + housePattern) + ',i];'
    );
  } else {
    if (street) {
      const streetPattern = escapeRegex(streetNorm(street));
      selectors.push(
        'nwr(' + ASTANA_BBOX + ')["addr:street"~' + ql(streetPattern) + ',i];',
        "way(" + ASTANA_BBOX + ")[highway][name~" + ql(streetPattern) + ",i];"
      );
    }

    const names = [query, itemName, displayName]
      .map(value => String(value || "").trim())
      .filter(value => value.length >= 3);
    for (const value of Array.from(new Set(names)).slice(0, 2)) {
      const pattern = escapeRegex(value);
      selectors.push(
        "nwr(" + localBox + ")[name~" + ql(pattern) + ",i];",
        'nwr(' + localBox + ')["name:ru"~' + ql(pattern) + ',i];',
        'nwr(' + localBox + ')["name:kk"~' + ql(pattern) + ',i];',
        "nwr(" + localBox + ")[official_name~" + ql(pattern) + ",i];",
        "nwr(" + localBox + ")[alt_name~" + ql(pattern) + ",i];"
      );
    }
  }

  if (!selectors.length) {
    throw new Error("Для точного поиска в OpenStreetMap недостаточно названия или адреса.");
  }

  return "[out:json][timeout:20];(" + selectors.join("\n") + ")->.matches;(" +
    ".matches;node(around.matches:35)[entrance];" +
    ")->.all;.all out geom tags qt;";
}

function distanceMeters(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(a.lat - b.lat);
  const dLon = rad(a.lon - b.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
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

function pointInside(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const crossing = ((a.lat > point.lat) !== (b.lat > point.lat)) &&
      point.lon < (b.lon - a.lon) * (point.lat - a.lat) / ((b.lat - a.lat) || 1e-15) + a.lon;
    if (crossing) inside = !inside;
  }
  return inside;
}

function pointToSegmentMeters(point, a, b) {
  const cosLat = Math.max(0.2, Math.cos(point.lat * Math.PI / 180));
  const scaleX = 111320 * cosLat;
  const scaleY = 110540;
  const px = point.lon * scaleX;
  const py = point.lat * scaleY;
  const ax = a.lon * scaleX;
  const ay = a.lat * scaleY;
  const bx = b.lon * scaleX;
  const by = b.lat * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator > 0
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator))
    : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function polygonClearanceMeters(point, ring) {
  let nearest = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const distance = pointToSegmentMeters(point, ring[i], ring[(i + 1) % ring.length]);
    if (distance < nearest) nearest = distance;
  }
  return nearest;
}

function pointOnSurface(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const centroid = polygonCentroid(ring);
  if (centroid && pointInside(centroid, ring)) return centroid;

  const lats = ring.map(point => point.lat);
  const lons = ring.map(point => point.lon);
  const bounds = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
  };
  let stepLat = (bounds.maxLat - bounds.minLat) / 32;
  let stepLon = (bounds.maxLon - bounds.minLon) / 32;
  if (!(stepLat > 0) || !(stepLon > 0)) return centroid;

  let best = null;
  let bestClearance = -1;

  // Find a point that is actually inside the polygon and as far as possible
  // from its edges. Repeated refinement handles concave or L-shaped buildings.
  for (let pass = 0; pass < 5; pass += 1) {
    const minLat = best ? Math.max(bounds.minLat, best.lat - stepLat * 5) : bounds.minLat;
    const maxLat = best ? Math.min(bounds.maxLat, best.lat + stepLat * 5) : bounds.maxLat;
    const minLon = best ? Math.max(bounds.minLon, best.lon - stepLon * 5) : bounds.minLon;
    const maxLon = best ? Math.min(bounds.maxLon, best.lon + stepLon * 5) : bounds.maxLon;
    const rows = best ? 10 : 32;
    const cols = best ? 10 : 32;

    for (let row = 0; row <= rows; row += 1) {
      const lat = minLat + (maxLat - minLat) * row / rows;
      for (let col = 0; col <= cols; col += 1) {
        const lon = minLon + (maxLon - minLon) * col / cols;
        const candidate = { lat, lon };
        if (!pointInside(candidate, ring)) continue;
        const clearance = polygonClearanceMeters(candidate, ring);
        if (clearance > bestClearance) {
          best = candidate;
          bestClearance = clearance;
        }
      }
    }
    stepLat /= 4;
    stepLon /= 4;
  }
  return best || centroid;
}

function polygonRings(element) {
  const rings = [];
  const direct = Array.isArray(element?.geometry) ? element.geometry : null;
  if (direct?.length) {
    const points = direct.map(point => ({
      lat: Number(point?.lat),
      lon: Number(point?.lon),
    })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
    const closed = points.length >= 4 &&
      Math.abs(points[0].lat - points[points.length - 1].lat) < 1e-8 &&
      Math.abs(points[0].lon - points[points.length - 1].lon) < 1e-8;
    if (closed) rings.push(points.slice(0, -1));
  }

  if (!rings.length && Array.isArray(element?.members)) {
    for (const member of element.members) {
      if (member?.role && member.role !== "outer") continue;
      const geometry = Array.isArray(member?.geometry) ? member.geometry : [];
      const points = geometry.map(point => ({
        lat: Number(point?.lat),
        lon: Number(point?.lon),
      })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
      const closed = points.length >= 4 &&
        Math.abs(points[0].lat - points[points.length - 1].lat) < 1e-8 &&
        Math.abs(points[0].lon - points[points.length - 1].lon) < 1e-8;
      if (closed) rings.push(points.slice(0, -1));
    }
  }
  return rings.sort((a, b) => Math.abs(polygonCentroid(b)?.lat || 0) - Math.abs(polygonCentroid(a)?.lat || 0));
}

function elementPoint(element, entrances) {
  if (Number.isFinite(Number(element?.lat)) && Number.isFinite(Number(element?.lon))) {
    return { lat: Number(element.lat), lon: Number(element.lon), quality: "OSM node" };
  }

  const rings = polygonRings(element);
  if (rings.length) {
    const ring = rings[0];
    const center = pointOnSurface(ring);
    if (!center) return null;

    const entrance = entrances
      .map(node => {
        const point = { lat: Number(node.lat), lon: Number(node.lon) };
        return {
          node,
          distance: distanceMeters(center, point),
          isMain: String(node?.tags?.entrance || "").toLowerCase() === "main",
          isService: String(node?.tags?.entrance || "").toLowerCase() === "service",
        };
      })
      .filter(item =>
        Number.isFinite(item.distance) &&
        item.distance <= 120 &&
        item.node?.tags?.entrance
      )
      .sort((a, b) =>
        Number(b.isMain) - Number(a.isMain) ||
        Number(a.isService) - Number(b.isService) ||
        a.distance - b.distance
      )[0];

    if (entrance) {
      return {
        lat: Number(entrance.node.lat),
        lon: Number(entrance.node.lon),
        quality: entrance.isMain ? "OSM main entrance" : "OSM entrance node",
      };
    }
    return {
      lat: center.lat,
      lon: center.lon,
      quality: "OSM point inside building polygon",
    };
  }

  const geometry = Array.isArray(element?.geometry) ? element.geometry : [];
  const points = geometry.map(point => ({
    lat: Number(point?.lat),
    lon: Number(point?.lon),
  })).filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (!points.length) return null;

  const middle = points[Math.floor((points.length - 1) / 2)];
  return { lat: middle.lat, lon: middle.lon, quality: "OSM way geometry" };
}

function elementText(tags) {
  return norm([
    tags?.name,
    tags?.["name:ru"],
    tags?.["name:kk"],
    tags?.official_name,
    tags?.alt_name,
    tags?.brand,
    tags?.operator,
    tags?.["addr:street"],
    tags?.["addr:housenumber"],
    tags?.["addr:full"],
  ].filter(Boolean).join(" "));
}

function scoreElement(element, item, typedQuery, directRef) {
  const tags = element?.tags || {};
  const text = elementText(tags);
  const name = norm(item?.name);
  const query = norm(typedQuery);
  const street = streetNorm(item?.address?.road || item?.address?.pedestrian || item?.street);
  const house = norm(item?.address?.house_number || item?.house_number);
  const station = /вокзал|железнодорожн|станци/.test(query) ||
    /railway|station/.test(norm(item?.category || item?.type)) ||
    String(item?.class || "").toLowerCase() === "railway";

  let score = directRef ? 10000 : 0;
  if (street && house) {
    const osmStreet = streetNorm(tags["addr:street"]);
    const osmHouse = norm(tags["addr:housenumber"]);
    if (osmStreet === street) score += 20;
    else if (osmStreet && (osmStreet.includes(street) || street.includes(osmStreet))) score += 10;
    if (osmHouse === house) score += 25;
    else if (osmHouse && osmHouse.includes(house)) score += 12;
    if (norm(tags["addr:full"]).includes(street) && norm(tags["addr:full"]).includes(house)) score += 16;
  }

  if (name && text.includes(name)) score += 12;
  const tokens = query.split(/\s+/).filter(token =>
    token.length >= 3 &&
    !["улица", "проспект", "дом", "вокзал", "железнодорожный"].includes(token)
  );
  for (const token of tokens) if (text.includes(token)) score += 3;

  const category = norm([
    tags.railway,
    tags.public_transport,
    tags.building,
    tags.amenity,
  ].filter(Boolean).join(" "));
  if (station && /(station|train_station|halt|bus_station)/.test(category)) score += 20;
  if (element.type === "node") score += 1;
  return score;
}

function cacheKey(item, typedQuery) {
  return norm([
    typedQuery,
    item?.name,
    item?.display_name,
    item?.address?.road,
    item?.address?.house_number,
    item?.address?.osm_ref_type,
    item?.address?.osm_ref_id,
    item?.osm_type,
    item?.osm_id,
  ].join("|"));
}

export async function resolveOverpassCoordinate(item, typedQuery, cache) {
  const key = cacheKey(item, typedQuery);
  const cached = cache?.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.result;

  const query = buildQuery(item, typedQuery);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 22000);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
      credentials: "omit",
      referrerPolicy: "origin",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 429 || response.status === 406) {
      throw new Error("Бесплатный Overpass временно ограничил запросы. Попробуй снова немного позже.");
    }
    if (!response.ok) throw new Error("OpenStreetMap / Overpass ответил ошибкой HTTP " + response.status + ".");

    const payload = await response.json();
    if (!Array.isArray(payload?.elements)) throw new Error("Overpass вернул некорректные данные.");

    const elements = payload.elements;
    const entrances = elements.filter(element => element?.type === "node" && element?.tags?.entrance);
    const matches = elements.filter(element => element?.tags && !element?.tags?.entrance);
    const refType = String(item?.address?.osm_ref_type || item?.osm_ref_type || "").toLowerCase();
    const refId = String(item?.address?.osm_ref_id || item?.osm_ref_id || "");
    const candidates = matches.map(element => {
      const point = elementPoint(element, entrances);
      if (!point) return null;
      const directType = String(
        item?.address?.osm_ref_type || item?.osm_ref_type || item?.osm_type || ""
      ).toLowerCase();
      const directId = String(
        item?.address?.osm_ref_id || item?.osm_ref_id || item?.osm_id || ""
      );
      const directRef = directType && directId &&
        element.type === directType && String(element.id) === directId;
      const score = scoreElement(element, item, typedQuery, directRef);
      const refLat = Number(item?.lat);
      const refLon = Number(item?.lon);
      const distance = Number.isFinite(refLat) && Number.isFinite(refLon)
        ? distanceMeters(point, { lat: refLat, lon: refLon })
        : 0;
      return { element, point, score, distance };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.distance - b.distance);

    const best = candidates[0];
    const station = /вокзал|железнодорожн|станци/.test(norm(typedQuery)) ||
      /railway|station/.test(norm(item?.category || item?.type)) ||
      String(item?.class || "").toLowerCase() === "railway";
    if (!best || best.score < (station ? 15 : 12)) {
      throw new Error("В OpenStreetMap не найден подтверждённый адрес или объект. Приблизительная точка не установлена.");
    }

    const tags = best.element.tags || {};
    const name = tags["name:ru"] || tags["name:kk"] || tags.name || tags.official_name ||
      item?.name || "Место на карте";
    const street = tags["addr:street"] || "";
    const house = tags["addr:housenumber"] || "";
    const address = [street, house ? "д. " + house : ""].filter(Boolean).join(", ");
    const result = {
      lat: best.point.lat,
      lon: best.point.lon,
      quality: best.point.quality,
      osmType: best.element.type,
      osmId: best.element.id,
      displayName: item?.display_name || (address ? name + " — " + address : name),
    };

    if (cache) {
      cache.set(key, { savedAt: Date.now(), result });
      if (cache.size > 250) {
        for (const [cacheItemKey, cacheItem] of cache) {
          if (Date.now() - cacheItem.savedAt > CACHE_TTL_MS * 2) cache.delete(cacheItemKey);
          if (cache.size <= 180) break;
        }
      }
    }
    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Overpass отвечает слишком долго. Точная точка не подтверждена; приблизительная координата не использована.");
    }
    if (error instanceof TypeError) {
      throw new Error("Телефон не смог подключиться к Overpass. Проверь интернет и попробуй позже. Приблизительная точка не использована.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
