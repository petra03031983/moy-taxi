"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "./astana-map.css";

const ASTANA = [51.1694, 71.4491];
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const PHOTON = "https://photon.komoot.io/api/";
const ROUTERS = {
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
};
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function fetchOverpassJSON(query, parentSignal) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (parentSignal?.aborted) throw new Error("Road data request was cancelled");
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    const timeoutId = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`OpenStreetMap data unavailable (${response.status})`);
      const data = await response.json();
      if (!Array.isArray(data?.elements)) throw new Error("Invalid OpenStreetMap response");
      return data;
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      lastError = error;
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
  throw lastError || new Error("OpenStreetMap road data unavailable");
}

async function fetchRoadDataFromServer(mode, args = {}, signal) {
  const params = new URLSearchParams({ mode: String(mode || "objects") });
  // Bypass previously cached partial API responses after road-data logic updates.
  params.set("v", "2");
  if (Array.isArray(args.points) && args.points.length) {
    params.set("points", args.points
      .slice(0, 4)
      .map(point => Number(point[0]).toFixed(5) + "," + Number(point[1]).toFixed(5))
      .join(";"));
  } else {
    if (Number.isFinite(args.lat)) params.set("lat", String(args.lat));
    if (Number.isFinite(args.lng)) params.set("lng", String(args.lng));
  }
  if (Number.isFinite(args.radius)) params.set("radius", String(args.radius));

  const response = await fetch("/api/road-data?" + params.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.elements)) {
    const baseMessage = payload?.error || "Сервис дорожных данных временно недоступен";
    const detail = String(payload?.details || "").trim();
    throw new Error(detail ? `${baseMessage} — ${detail}` : baseMessage);
  }
  return payload;
}


function formatDistance(meters) {
  const n = Number(meters || 0);
  return n >= 1000 ? `${(n / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} км` : `${Math.round(n)} м`;
}
function formatDuration(seconds) {
  const min = Math.max(1, Math.round(Number(seconds || 0) / 60));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} ч ${m} мин`;
}

function formatArrivalTime(seconds, now = Date.now()) {
  const date = new Date(now + Math.max(0, Number(seconds || 0)) * 1000);
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function weatherSummary(code, isDay = 1) {
  const labels = {
    0: ["Ясно", isDay ? "☀️" : "🌙"],
    1: ["Преимущественно ясно", isDay ? "🌤️" : "🌙"],
    2: ["Переменная облачность", "⛅"],
    3: ["Пасмурно", "☁️"],
    45: ["Туман", "🌫️"],
    48: ["Изморозевый туман", "🌫️"],
    51: ["Небольшая морось", "🌦️"],
    53: ["Морось", "🌦️"],
    55: ["Сильная морось", "🌧️"],
    56: ["Ледяная морось", "🌧️"],
    57: ["Сильная ледяная морось", "🌧️"],
    61: ["Небольшой дождь", "🌧️"],
    63: ["Дождь", "🌧️"],
    65: ["Сильный дождь", "🌧️"],
    66: ["Ледяной дождь", "🌧️"],
    67: ["Сильный ледяной дождь", "🌧️"],
    71: ["Небольшой снег", "🌨️"],
    73: ["Снег", "🌨️"],
    75: ["Сильный снег", "❄️"],
    77: ["Снежная крупа", "🌨️"],
    80: ["Кратковременный дождь", "🌦️"],
    81: ["Ливень", "🌧️"],
    82: ["Сильный ливень", "⛈️"],
    85: ["Небольшой снегопад", "🌨️"],
    86: ["Сильный снегопад", "❄️"],
    95: ["Гроза", "⛈️"],
    96: ["Гроза с градом", "⛈️"],
    99: ["Сильная гроза с градом", "⛈️"],
  };
  return labels[Number(code)] || ["Погодные условия", "🌡️"];
}

function routeTurnCount(route) {
  return (route?.steps || []).filter(step => ["turn", "roundabout", "fork", "merge"].includes(step?.maneuver?.type)).length;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/([A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі])(?=\d)/g, "$1 ")
    .replace(/\bул\.?\s+/i, "улица ")
    .replace(/\bпр\.?\s+/i, "проспект ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function photonToAddress(feature) {
  const properties = feature?.properties || {};
  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const street = properties.street || properties.name || "";
  const city = properties.city || properties.locality || properties.district || properties.county || "";
  const address = {
    road: properties.street || "",
    pedestrian: properties.street || "",
    house_number: properties.housenumber || "",
    city: properties.city || "",
    town: properties.locality || "",
    village: properties.locality || "",
    municipality: properties.district || "",
    country: properties.country || "",
  };
  const display_name = [
    properties.name,
    properties.street && properties.name !== properties.street ? properties.street : "",
    properties.housenumber,
    city,
    properties.state,
    properties.country,
  ].filter(Boolean).filter((part, index, all) => all.indexOf(part) === index).join(", ");
  return {
    place_id: `photon-${properties.osm_type || "place"}-${properties.osm_id || `${lat},${lon}`}`,
    lat: String(lat),
    lon: String(lon),
    display_name: display_name || street || "Место на карте",
    address,
    type: properties.osm_value || properties.type || "place",
    class: properties.osm_key || "place",
    source: "photon",
  };
}

function cleanName(item) {
  const a = item?.address || {};
  const parts = [
    a.road || a.pedestrian || a.highway,
    a.house_number ? `д. ${a.house_number}` : "",
    a.city || a.town || a.village || a.municipality,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : item?.display_name || "Место";
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function selectedPlaceTitle(item) {
  if (!item) return "Выбранное место";
  return item.name || item.display_name?.split(",")[0] || cleanName(item) || "Выбранное место";
}

function selectedPlaceAddress(item) {
  return item?.display_name || cleanName(item) || "Адрес не указан";
}

function placeCategory(item) {
  const key = `${item?.class || ""} ${item?.type || ""} ${item?.address?.amenity || ""}`.toLowerCase();
  if (/apartments|residential|house|building|tower/.test(key)) return "Жилой дом";
  if (/hospital|clinic|doctors|pharmacy/.test(key)) return "Медицина";
  if (/restaurant|cafe|fast_food|food/.test(key)) return "Ресторан";
  if (/shop|supermarket|convenience|mall/.test(key)) return "Магазин";
  if (/school|university|college|kindergarten/.test(key)) return "Образование";
  if (/hotel|hostel|guest_house/.test(key)) return "Гостиница";
  if (/park|garden|nature_reserve/.test(key)) return "Парк";
  if (/road|street|highway|residential_road/.test(key)) return "Адрес";
  return "Место на карте";
}

function stepText(step) {
  const m = step?.maneuver || {};
  const road = step?.name || "дорога";
  const labels = {
    left: "налево",
    right: "направо",
    straight: "прямо",
    "slight left": "плавно налево",
    "slight right": "плавно направо",
    "sharp left": "резко налево",
    "sharp right": "резко направо",
    uturn: "развернитесь",
  };
  const modifier = labels[m.modifier] || "по направлению движения";
  if (m.type === "arrive") return "Вы прибыли";
  if (m.type === "depart") return `Начните движение по ${road}`;
  if (m.type === "roundabout") return m.exit ? `На круговом движении съезд №${m.exit}` : `На круговом движении: ${road}`;
  if (m.type === "merge") return `Перестройтесь на ${road}`;
  if (m.type === "fork") return `На развилке держитесь: ${modifier}`;
  if (m.type === "new name") return `Продолжайте по ${road}`;
  if (m.type === "turn") return `Поверните ${modifier}${road && road !== "дорога" ? ` на ${road}` : ""}`;
  return `Продолжайте по ${road}`;
}

function turnSymbol(step) {
  const m = step?.maneuver || {};
  if (m.type === "roundabout") return "↻";
  if (String(m.modifier || "").includes("uturn")) return "↶";
  if (String(m.modifier || "").includes("left")) return "↰";
  if (String(m.modifier || "").includes("right")) return "↱";
  if (m.modifier === "straight" || m.type === "depart") return "↑";
  return "➜";
}

function distanceBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function snapToRoute(position, points) {
  const cosLat = Math.max(0.2, Math.cos(position.lat * Math.PI / 180));
  let best = { distance: Infinity, progress: 0, point: points[0], heading: 0 };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const ax = (a[1] - position.lng) * 111320 * cosLat;
    const ay = (a[0] - position.lat) * 111320;
    const bx = (b[1] - position.lng) * 111320 * cosLat;
    const by = (b[0] - position.lat) * 111320;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + t * dx;
    const y = ay + t * dy;
    const distance = Math.hypot(x, y);
    if (distance < best.distance) {
      const lat = a[0] + (b[0] - a[0]) * t;
      const lng = a[1] + (b[1] - a[1]) * t;
      best = {
        distance,
        progress: i + t,
        point: [lat, lng],
        heading: Math.atan2((b[1] - a[1]) * Math.cos(lat * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI,
      };
    }
  }
  return best;
}

function parseSpeedLimitValue(value) {
  const choices = String(value ?? "").split(/[;|]/).map(part => part.trim()).filter(Boolean);
  for (const choice of choices) {
    // OpenStreetMap can use Kazakhstan's standard speed-zone tokens instead of a number.
    if (/^KZ:urban$/i.test(choice)) return 60;
    if (/^KZ:(living_street|yard|courtyard)$/i.test(choice)) return 20;
    const match = choice.match(/^(\d+(?:[.,]\d+)?)\s*(km\/?h|kmh|kph|mph|mi\/?h)?$/i);
    if (!match) continue;
    let speed = Number(match[1].replace(",", "."));
    const unit = String(match[2] || "").toLowerCase();
    if (unit === "mph" || unit === "mi/h") speed *= 1.609344;
    if (Number.isFinite(speed) && speed > 0 && speed <= 250) return Math.round(speed);
  }
  return null;
}

function fallbackSpeedLimitForWay(tags = {}) {
  const highway = String(tags.highway || "").toLowerCase();
  const service = String(tags.service || "").toLowerCase();
  const zone = String(tags["zone:traffic"] || "").toLowerCase();
  const name = String(tags.name || "").toLowerCase();

  // Use a numeric/sign-defined limit when the map source has one. A missing
  // maxspeed tag is not proof that the posted limit is 60 km/h.
  const taggedLimit =
    parseSpeedLimitValue(tags.maxspeed) ??
    parseSpeedLimitValue(tags["maxspeed:forward"]) ??
    parseSpeedLimitValue(tags["maxspeed:backward"]) ??
    parseSpeedLimitValue(String(tags["maxspeed:lanes:forward"] || tags["maxspeed:lanes"] || "").split("|")[0]) ??
    parseSpeedLimitValue(tags["traffic_sign:maxspeed"]) ??
    parseSpeedLimitValue(tags["maxspeed:type"]) ??
    parseSpeedLimitValue(tags["source:maxspeed"]);
  if (taggedLimit !== null) return taggedLimit;

  // Only use a conservative local-road fallback for clearly marked courtyard
  // and living-street segments. For other untagged roads, report unknown.
  if (
    highway === "living_street" ||
    /living.?street|yard|courtyard|жил(ая|ой) зона|дворов/.test(zone) ||
    service === "driveway" ||
    service === "parking_aisle" ||
    /двор|жил(ая|ой) зона/.test(name)
  ) return 20;
  return null;
}

function findSpeedLimitForRoute(position, routePoints, ways) {
  const routeSnap = routePoints?.length > 1 ? snapToRoute(position, routePoints) : null;
  const routeHeading = routeSnap && Number.isFinite(routeSnap.heading) ? routeSnap.heading : null;
  let best = null;

  for (const way of ways || []) {
    const tags = way?.tags || {};
    const rawGeometry = way?.geometry;
    if (!Array.isArray(rawGeometry) || rawGeometry.length < 2) continue;
    const points = rawGeometry
      .filter(node => Number.isFinite(Number(node?.lat)) && Number.isFinite(Number(node?.lon)))
      .map(node => [Number(node.lat), Number(node.lon)]);
    if (points.length < 2) continue;

    const snapped = snapToRoute(position, points);
    if (!Number.isFinite(snapped.distance) || snapped.distance > 45) continue;

    let value =
      parseSpeedLimitValue(tags.maxspeed) ??
      parseSpeedLimitValue(tags["traffic_sign:maxspeed"]) ??
      parseSpeedLimitValue(tags["maxspeed:forward"]) ??
      parseSpeedLimitValue(tags["maxspeed:backward"]) ??
      parseSpeedLimitValue(String(tags["maxspeed:lanes:forward"] || tags["maxspeed:lanes"] || "").split("|")[0]) ??
      parseSpeedLimitValue(tags["maxspeed:type"]) ??
      parseSpeedLimitValue(tags["source:maxspeed"]);
    let directionDifference = 0;
    let score = snapped.distance;
    if (routeHeading !== null) {
      const signedDifference = ((routeHeading - snapped.heading + 540) % 360) - 180;
      directionDifference = Math.abs(signedDifference);
      const orientationDifference = Math.min(directionDifference, 180 - directionDifference);
      // Ignore clearly crossing streets when deciding which road the driver is on.
      if (orientationDifference > 65) continue;
      const directionalTag = directionDifference <= 90 ? tags["maxspeed:forward"] : tags["maxspeed:backward"];
      value = parseSpeedLimitValue(directionalTag) ?? value;
      score += orientationDifference * 0.45;
    }
    if (!best || score < best.score) best = { score, value, tags };
  }

  // If the map has the road but no sign value, show the local default instead of a dash.
  // If no road geometry was returned at all, the map is in Astana's built-up area by design.
  return best?.value ?? fallbackSpeedLimitForWay(best?.tags || {});
}

function routeDistanceToIndex(points, startProgress, endIndex) {
  if (!points.length || endIndex <= startProgress) return 0;
  const clamped = Math.max(0, Math.min(points.length - 1, startProgress));
  const segment = Math.min(points.length - 2, Math.floor(clamped));
  const fraction = clamped - segment;
  const start = [
    points[segment][0] + (points[segment + 1][0] - points[segment][0]) * fraction,
    points[segment][1] + (points[segment + 1][1] - points[segment][1]) * fraction,
  ];
  let total = distanceBetween(start, points[segment + 1]);
  for (let i = segment + 1; i < Math.min(endIndex, points.length - 1); i += 1) {
    total += distanceBetween(points[i], points[i + 1]);
  }
  return Math.max(0, total);
}

function routeGeometryLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += distanceBetween(points[i], points[i + 1]);
  }
  return total;
}

function angleDifferenceDegrees(a, b) {
  return Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
}

function routePointAtProgress(points, progress) {
  if (!points?.length) return null;
  if (points.length === 1) return points[0];
  const clamped = Math.max(0, Math.min(points.length - 1, Number(progress) || 0));
  const segment = Math.min(points.length - 2, Math.floor(clamped));
  const fraction = clamped >= points.length - 1 ? 1 : clamped - segment;
  return [
    points[segment][0] + (points[segment + 1][0] - points[segment][0]) * fraction,
    points[segment][1] + (points[segment + 1][1] - points[segment][1]) * fraction,
  ];
}

function routeHeadingAtProgress(points, progress, lookAheadMeters = 24) {
  if (!points?.length || points.length < 2) return null;
  const start = routePointAtProgress(points, progress);
  if (!start) return null;

  let cursorProgress = Math.max(0, Math.min(points.length - 1, Number(progress) || 0));
  let remaining = lookAheadMeters;
  let target = start;

  while (cursorProgress < points.length - 1) {
    const nextIndex = Math.min(points.length - 1, Math.floor(cursorProgress) + 1);
    if (nextIndex <= cursorProgress) break;
    const next = routePointAtProgress(points, nextIndex);
    const segmentLength = distanceBetween(target, next);
    if (segmentLength >= remaining && segmentLength > 0.1) {
      const fraction = remaining / segmentLength;
      target = [
        target[0] + (next[0] - target[0]) * fraction,
        target[1] + (next[1] - target[1]) * fraction,
      ];
      break;
    }
    remaining -= segmentLength;
    target = next;
    cursorProgress = nextIndex;
  }

  if (distanceBetween(start, target) < 0.5) target = points[points.length - 1];
  if (!target || distanceBetween(start, target) < 0.5) return null;
  return (Math.atan2(
    (target[1] - start[1]) * Math.cos(start[0] * Math.PI / 180),
    target[0] - start[0]
  ) * 180 / Math.PI + 360) % 360;
}

function smoothHeading(previous, target, weight = 0.28) {
  if (!Number.isFinite(target)) return previous;
  if (!Number.isFinite(previous)) return ((target % 360) + 360) % 360;
  const delta = ((target - previous + 540) % 360) - 180;
  return ((previous + delta * weight) % 360 + 360) % 360;
}

function setMapHeadingUp(map, heading, options = {}) {
  if (!map || !Number.isFinite(heading)) return false;
  const normalizedHeading = ((heading % 360) + 360) % 360;
  if (typeof map.setHeading === "function") {
    map.setHeading(normalizedHeading, options);
    return true;
  }
  // leaflet-rotate's bearing is the inverse of a heading-up course.
  if (typeof map.setBearing === "function") {
    const targetBearing = ((360 - normalizedHeading) % 360 + 360) % 360;
    const currentBearing = typeof map.getBearing === "function" ? map.getBearing() : NaN;
    if (!Number.isFinite(currentBearing) || angleDifferenceDegrees(currentBearing, targetBearing) >= 1.5) {
      map.setBearing(targetBearing);
    }
    return true;
  }
  return false;
}

function routeDistanceBetweenProgress(points, startProgress, endProgress) {
  if (!points?.length || points.length < 2 || endProgress <= startProgress) return 0;
  const start = Math.max(0, Math.min(points.length - 1, startProgress));
  const end = Math.max(start, Math.min(points.length - 1, endProgress));
  if (end <= start) return 0;
  let total = 0;
  let cursor = routePointAtProgress(points, start);
  let index = Math.floor(start);
  while (index < points.length - 1 && index < end) {
    const nextIndex = Math.min(index + 1, end);
    const next = routePointAtProgress(points, nextIndex);
    total += distanceBetween(cursor, next);
    cursor = next;
    index = nextIndex;
  }
  return total;
}

function sampleRouteForRoadObjects(points, startProgress = 0, maxDistanceMeters = 7000, maxPoints = 12) {
  if (!points?.length) return [];
  if (points.length === 1) return [points[0]];
  const start = Math.max(0, Math.min(points.length - 1, Number(startProgress) >= 0 ? Number(startProgress) : 0));
  const startIndex = Math.min(points.length - 2, Math.floor(start));
  const startPoint = routePointAtProgress(points, start);
  const samples = [startPoint];
  const spacing = maxDistanceMeters / Math.max(1, maxPoints - 1);
  let nextSampleAt = spacing;
  let walked = 0;

  for (let i = startIndex; i < points.length - 1 && walked < maxDistanceMeters && samples.length < maxPoints; i += 1) {
    const a = i === startIndex ? startPoint : points[i];
    const b = points[i + 1];
    const segmentLength = distanceBetween(a, b);
    if (segmentLength < 0.1) continue;

    while (nextSampleAt <= walked + segmentLength && samples.length < maxPoints) {
      const fraction = Math.max(0, Math.min(1, (nextSampleAt - walked) / segmentLength));
      samples.push([
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ]);
      nextSampleAt += spacing;
    }
    walked += segmentLength;
  }
  const last = routePointAtProgress(points, Math.min(points.length - 1, start + 1));
  if (samples.length === 1 && last) samples.push(last);
  return samples;
}

function postedSpeedFromTags(tags = {}) {
  const signTags = [
    tags.traffic_sign,
    tags["traffic_sign:forward"],
    tags["traffic_sign:backward"],
    tags["traffic_sign:maxspeed"],
  ].filter(Boolean).join(" ");
  const inlineValue = signTags.match(/maxspeed[:=]\s*(\d+(?:[.,]\d+)?)/i)?.[1];
  return parseSpeedLimitValue(tags.maxspeed) ??
    parseSpeedLimitValue(tags["traffic_sign:maxspeed"]) ??
    parseSpeedLimitValue(tags["maxspeed:forward"]) ??
    parseSpeedLimitValue(tags["maxspeed:backward"]) ??
    parseSpeedLimitValue(inlineValue);
}

function roadObjectKind(element) {
  const tags = element?.tags || {};
  const enforcement = String(tags.enforcement || tags["enforcement:type"] || "").toLowerCase();
  const surveillanceType = String(tags["surveillance:type"] || "").toLowerCase();
  const surveillanceZone = String(tags["surveillance:zone"] || "").toLowerCase();
  const surveillance = String(tags.surveillance || "").toLowerCase();
  const cameraType = String(tags["camera:type"] || "").toLowerCase();
  const highway = String(tags.highway || "").toLowerCase();
  const amenity = String(tags.amenity || "").toLowerCase();
  const construction = String(tags.construction || tags["construction:highway"] || tags.roadworks || "").toLowerCase();
  const barrier = String(tags.barrier || "").toLowerCase();
  const hazard = String(tags.hazard || tags["hazard:type"] || "").toLowerCase();
  const closure = String(tags["road:closed"] || tags.closed || tags.access || "").toLowerCase();
  const signTags = [tags.traffic_sign, tags["traffic_sign:forward"], tags["traffic_sign:backward"], tags["traffic_sign:maxspeed"]].filter(Boolean).join(" ");
  const normalizedSignTags = signTags.toLowerCase();
  const postedSpeed = postedSpeedFromTags(tags);

  if (highway === "traffic_signals") return "traffic-light";

  if (
    highway === "speed_camera" ||
    highway === "red_light_camera" ||
    tags.man_made === "speed_camera" ||
    /maxspeed|average_speed|red_light|speed_camera|alpr|license_plate/.test(enforcement) ||
    /speed|traffic|red_light|enforcement|alpr|license_plate/.test(surveillanceType) ||
    /traffic|road|red_light|speed|enforcement/.test(surveillanceZone) ||
    /speed|traffic|red_light|enforcement|alpr|license_plate/.test(surveillance) ||
    /speed|traffic|red_light|enforcement|alpr|license_plate/.test(cameraType) ||
    tags["monitoring:traffic"] === "yes" ||
    (tags.man_made === "surveillance" && surveillance === "public")
  ) return "camera";

  if ((element?.type === "node" && postedSpeed !== null) ||
      (/maxspeed|speed_limit|KZ:3\.24|RU:3\.24|3\.24/i.test(signTags) && postedSpeed !== null)) return "speed-sign";

  if (
    highway === "crossing" ||
    Boolean(tags.crossing) ||
    Boolean(tags["crossing:markings"]) ||
    tags.footway === "crossing"
  ) return "pedestrian-crossing";

  if (highway === "stop" || /(^|[^a-z])(stop|KZ:2\.5|RU:2\.5)([^a-z]|$)/i.test(signTags)) return "stop-sign";
  if (highway === "give_way" || /give.?way|yield|KZ:2\.4|RU:2\.4/i.test(signTags)) return "give-way-sign";
  if (/(?:KZ|RU):?3\.(?:27)\b/i.test(signTags) || /no_stopping|no stopping/.test(normalizedSignTags)) return "no-stopping";
  if (/(?:KZ|RU):?3\.(?:28|29|30)\b/i.test(signTags) || /no_parking|no parking/.test(normalizedSignTags)) return "no-parking";

  if (
    amenity === "parking" ||
    Boolean(tags.parking) ||
    Boolean(tags.parking_space) ||
    Boolean(tags["parking:lane"])
  ) return "parking";

  if (signTags.trim()) return "traffic-sign";

  if (
    highway === "construction" ||
    construction !== "" ||
    tags.roadworks === "yes" ||
    tags["construction:temporary"] === "yes"
  ) return "roadwork";

  if (
    highway === "road_closed" ||
    barrier === "road_block" ||
    tags["road:closed"] === "yes" ||
    tags.closed === "yes" ||
    /^(closed|no)$/.test(closure) && tags.temporary === "yes"
  ) return "closure";

  if (hazard || tags["hazard:prone"] === "yes") return "hazard";
  return null;
}

function isSpeedEnforcementCamera(tags = {}) {
  const values = [
    tags.highway,
    tags.man_made,
    tags.enforcement,
    tags["enforcement:type"],
    tags["camera:type"],
    tags["surveillance:type"],
    tags["surveillance:zone"],
  ].map(value => String(value || "").toLowerCase()).join(" ");
  return /speed_camera|red_light_camera|average_speed|maxspeed|speed enforcement|speed|red_light|alpr|license_plate/.test(values);
}

function roadObjectTitle(kind) {
  if (kind === "camera") return "Камера дорожного наблюдения";
  if (kind === "speed-sign") return "Знак ограничения скорости";
  if (kind === "pedestrian-crossing") return "Пешеходный переход";
  if (kind === "parking") return "Автомобильная парковка";
  if (kind === "traffic-sign") return "Дорожный знак";
  if (kind === "stop-sign") return "Знак СТОП";
  if (kind === "give-way-sign") return "Знак «Уступите дорогу»";
  if (kind === "no-stopping") return "Остановка запрещена";
  if (kind === "no-parking") return "Стоянка запрещена";
  if (kind === "roadwork") return "Дорожные работы (отметка карты)";
  if (kind === "closure") return "Возможное перекрытие дороги (отметка карты)";
  if (kind === "hazard") return "Дорожная опасность (отметка карты)";
  return "Светофор";
}

function roadObjectShortLabel(kind) {
  if (kind === "camera") return "К";
  if (kind === "speed-sign") return "";
  if (kind === "pedestrian-crossing") return "П";
  if (kind === "parking") return "P";
  if (kind === "traffic-sign") return "З";
  if (kind === "stop-sign") return "S";
  if (kind === "give-way-sign") return "▽";
  if (kind === "no-stopping") return "×";
  if (kind === "no-parking") return "P̸";
  if (kind === "roadwork") return "Р";
  if (kind === "closure") return "З";
  if (kind === "hazard") return "!";
  return "С";
}

function roadObjectIconHtml(kind, speedLimit = null) {
  if (kind === "speed-sign") {
    const value = Number.isFinite(Number(speedLimit)) ? String(Math.round(Number(speedLimit))) : "!";
    return '<span class="moy-road-object-badge moy-road-object-speed-sign" aria-label="Ограничение скорости ' + escapeHtml(value) + ' километров в час">' + escapeHtml(value) + '</span>';
  }
  if (kind === "camera") {
    return '<span class="moy-road-object-badge moy-road-object-camera" aria-label="Дорожная камера"><svg viewBox="0 0 32 32" role="presentation"><path d="M5 11.5h15.2a2 2 0 0 1 2 2v10.2H5z" fill="#fff"/><path d="m22 15 6-3v13l-6-3z" fill="#fff"/><circle cx="13" cy="17.8" r="4.1" fill="#d92c37"/><circle cx="13" cy="17.8" r="2.5" fill="#fff"/><path d="M10 8h6l2.4 3.5H8z" fill="#fff"/><path d="M15.5 23.5v4M10 27.5h11" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></span>';
  }
  if (kind === "parking") return '<span class="moy-road-object-badge moy-road-object-parking" aria-label="Автомобильная парковка">P</span>';
  if (kind === "pedestrian-crossing") return '<span class="moy-road-object-badge moy-road-object-crossing" aria-label="Пешеходный переход">🚸</span>';
  if (kind === "stop-sign") return '<span class="moy-road-object-badge moy-road-object-stop" aria-label="Знак СТОП">STOP</span>';
  if (kind === "give-way-sign") return '<span class="moy-road-object-badge moy-road-object-giveway" aria-label="Уступите дорогу">▼</span>';
  if (kind === "no-stopping") return '<span class="moy-road-object-badge moy-road-object-prohibition" aria-label="Остановка запрещена">×</span>';
  if (kind === "no-parking") return '<span class="moy-road-object-badge moy-road-object-prohibition" aria-label="Стоянка запрещена">P̸</span>';
  if (kind === "traffic-sign") return '<span class="moy-road-object-badge moy-road-object-generic-sign" aria-label="Дорожный знак">З</span>';
  if (kind === "roadwork") return '<span class="moy-road-object-badge moy-road-object-event moy-road-object-roadwork" aria-label="Дорожные работы">Р</span>';
  if (kind === "closure") return '<span class="moy-road-object-badge moy-road-object-event moy-road-object-closure" aria-label="Перекрытие дороги">З</span>';
  if (kind === "hazard") return '<span class="moy-road-object-badge moy-road-object-event moy-road-object-hazard" aria-label="Дорожная опасность">!</span>';
  return '<span class="moy-road-object-badge moy-road-object-signal" aria-label="Светофор"><i></i><i></i><i></i></span>';
}

function isRoadObjectCoordinateUsable(item) {
  if (!item || !Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng))) return false;

  const reviewStatus = String(
    item.privateReviewStatus ?? item.reviewStatus ?? item.tags?.review_status ?? ""
  ).toLowerCase();
  const isManual = item.manualRoadObject === true || item.manual === true;
  if (item.privateRoadObject && !isManual &&
      !["confirmed", "approved", "verified", "accepted"].includes(reviewStatus)) {
    // Keep unverified scanner coordinates in the private review queue, but never
    // present vehicle GPS as the physical location of a camera or traffic light.
    return false;
  }
  if (reviewStatus === "rejected") return false;

  const detectionMethod = String(item.detectionMethod ?? item.detection_method ?? "");
  const coordinateMethod = String(item.coordinateMethod ?? item.coordinate_method ?? "");
  const observedLat = Number(item.observedLat ?? item.observed_lat);
  const observedLng = Number(item.observedLng ?? item.observed_lng);
  const estimatedLat = Number(item.estimatedLat ?? item.estimated_lat ?? item.lat);
  const estimatedLng = Number(item.estimatedLng ?? item.estimated_lng ?? item.lng);
  const distanceValue = item.distanceAheadM ?? item.distance_ahead_m;
  const hasDistance = distanceValue != null && distanceValue !== "" && Number.isFinite(Number(distanceValue));

  const estimateIsVehicleGps = !hasDistance &&
    Number.isFinite(observedLat) && Number.isFinite(observedLng) &&
    Number.isFinite(estimatedLat) && Number.isFinite(estimatedLng) &&
    Math.abs(estimatedLat - observedLat) < 0.0000001 &&
    Math.abs(estimatedLng - observedLng) < 0.0000001;

  if (detectionMethod === "icon-heuristic" &&
      (coordinateMethod === "vehicle-gps-only" ||
       coordinateMethod === "icon-pass-by-gps" && estimateIsVehicleGps ||
       estimateIsVehicleGps)) {
    return false;
  }
  return true;
}

function deduplicatePhysicalRoadObjects(items, toleranceMeters = 4) {
  const result = [];
  for (const item of items || []) {
    if (!isRoadObjectCoordinateUsable(item)) continue;
    const kind = String(item.kind || "");
    if (!["camera", "traffic-light", "speed-sign"].includes(kind)) continue;

    const duplicateIndex = result.findIndex(existing =>
      existing.kind === kind &&
      distanceBetween([existing.lat, existing.lng], [item.lat, item.lng]) <= toleranceMeters
    );
    if (duplicateIndex < 0) {
      result.push(item);
      continue;
    }

    // Prefer a manually verified object, then official/open map data. Do not merge
    // camera + traffic-light records: they can be separate real objects at one pole.
    const rank = candidate => {
      if (candidate.manualRoadObject || candidate.manual) return 5;
      const status = String(candidate.privateReviewStatus ?? candidate.reviewStatus ?? candidate.tags?.review_status ?? "").toLowerCase();
      if (["confirmed", "approved", "verified", "accepted"].includes(status)) return 4;
      if (candidate.catalogSource === "astana-gis") return 3;
      if (candidate.catalogSource === "qazgeo") return 2;
      if (candidate.privateRoadObject) return 0;
      return 1;
    };
    if (rank(item) > rank(result[duplicateIndex])) result[duplicateIndex] = item;
  }
  return result;
}

function nextTurnArrow(step) {
  const maneuver = step?.maneuver || {};
  const modifier = String(maneuver.modifier || "").toLowerCase();
  if (maneuver.type === "roundabout" || maneuver.type === "rotary") return "↻";
  if (modifier.includes("uturn") || maneuver.type === "uturn") return "↶";
  if (modifier.includes("left")) return "←";
  if (modifier.includes("right")) return "→";
  return "↑";
}

function nextRouteInstruction(route, points, progress) {
  if (!route?.steps?.length || points.length < 2) return { distance: "", distanceMeters: null, arrow: "↑", maneuverKey: "none" };
  let next = null;
  let nextIndex = Infinity;
  for (const step of route.steps) {
    const loc = step?.maneuver?.location;
    if (!Array.isArray(loc) || !["turn", "roundabout", "rotary", "exit roundabout", "fork", "merge", "on ramp", "off ramp", "end of road", "arrive"].includes(step.maneuver?.type)) continue;
    let nearest = { index: 0, distance: Infinity };
    for (let i = 0; i < points.length; i += 1) {
      const d = (points[i][0] - loc[1]) ** 2 + (points[i][1] - loc[0]) ** 2;
      if (d < nearest.distance) nearest = { index: i, distance: d };
    }
    if (nearest.index > progress + 1 && nearest.index < nextIndex) {
      next = step;
      nextIndex = nearest.index;
    }
  }
  if (!next) return { distance: "", distanceMeters: null, arrow: "↑", maneuverKey: "route-end", maneuverType: "arrive", modifier: "" };
  const distanceMeters = routeDistanceToIndex(points, progress, nextIndex);
  const maneuver = next.maneuver || {};
  const indications = (next.intersections || []).flatMap(intersection =>
    (intersection.lanes || []).flatMap(lane => lane.indications || [])
  ).map(value => String(value).toLowerCase());
  const hasRightLane = indications.includes("right") || indications.includes("slight right");
  const hasStraightLane = indications.includes("straight");
  const laneIntersection = (next.intersections || []).find(intersection => Array.isArray(intersection.lanes) && intersection.lanes.length);
  const indicationGlyph = value => {
    const v = String(value || "").toLowerCase().replace(/_/g, " ");
    if (v.includes("uturn")) return "↶";
    if (v.includes("slight left")) return "↖";
    if (v.includes("sharp left")) return "⬉";
    if (v.includes("left")) return "←";
    if (v.includes("slight right")) return "↗";
    if (v.includes("sharp right")) return "⬈";
    if (v.includes("right")) return "→";
    if (v.includes("straight")) return "↑";
    return "";
  };
  const lanes = (laneIntersection?.lanes || [])
    .slice(0, 7)
    .map(lane => ({
      arrows: (lane.indications || []).map(indicationGlyph).filter(Boolean),
      valid: lane.valid === true,
    }))
    .filter(lane => lane.arrows.length);
  return {
    distance: formatDistance(distanceMeters),
    distanceMeters,
    arrow: nextTurnArrow(next),
    maneuverKey: `${maneuver.type || "turn"}:${maneuver.modifier || ""}:${Array.isArray(maneuver.location) ? maneuver.location.join(",") : nextIndex}`,
    maneuverType: maneuver.type || "turn",
    modifier: maneuver.modifier || "",
    exit: maneuver.exit || next.exit || null,
    laneRight: hasRightLane && hasStraightLane,
    lanes,
  };
}

function voiceDistanceText(meters, forStraight = false) {
  const distance = Math.max(0, Number(meters) || 0);
  if (distance >= 1000) {
    const km = distance >= 5000 ? Math.round(distance / 1000) : Math.round(distance / 500) / 2;
    if (Math.abs(km - 1.5) < 0.001) return "полтора километра";
    if (Math.abs(km % 1 - 0.5) < 0.001) {
      const whole = Math.floor(km);
      const wholeWord = whole === 1 ? "один" : whole === 2 ? "два" : whole === 3 ? "три" : whole === 4 ? "четыре" : String(whole);
      return `${wholeWord} с половиной километра`;
    }
    const rounded = Math.round(km);
    const lastTwo = rounded % 100;
    const last = rounded % 10;
    const unit = rounded === 1 ? "километр" : lastTwo >= 11 && lastTwo <= 14 ? "километров" : last >= 2 && last <= 4 ? "километра" : "километров";
    const number = forStraight && rounded === 1 ? "один" : String(rounded);
    return `${number} ${unit}`;
  }
  const rounded = Math.max(50, Math.round(distance / 50) * 50);
  return `${rounded} метров`;
}

function voiceManeuverText(instruction) {
  const type = String(instruction?.maneuverType || "turn").toLowerCase();
  const modifier = String(instruction?.modifier || "").toLowerCase();
  if (type === "arrive") return "Вы прибыли.";
  if (type === "roundabout" || type === "rotary" || type === "exit roundabout") {
    return instruction?.exit ? `На круговом движении съезд номер ${instruction.exit}.` : "На круговом движении выберите нужный съезд.";
  }
  if (type === "off ramp") return modifier.includes("left") ? "Поверните на съезд налево." : "Поверните на съезд направо.";
  if (type === "on ramp") return modifier.includes("left") ? "Держитесь левой полосы для съезда." : "Держитесь правой полосы для съезда.";
  if (type === "fork") {
    if (modifier.includes("left")) return "На развилке держитесь левее.";
    if (modifier.includes("right")) return "На развилке держитесь правее.";
    return "На развилке держитесь прямо.";
  }
  if (type === "merge") {
    if (modifier.includes("left")) return "Держитесь левой полосы.";
    if (modifier.includes("right")) return "Держитесь правой полосы.";
    return "Перестройтесь на главную дорогу.";
  }
  if (instruction?.laneRight && modifier.includes("right")) return "Держитесь правой полосы.";
  if (instruction?.laneRight && modifier.includes("left")) return "Держитесь левой полосы.";
  if (modifier.includes("uturn")) return "Развернитесь.";
  if (modifier.includes("slight left")) return "Держитесь левее.";
  if (modifier.includes("slight right")) return "Держитесь правее.";
  if (modifier.includes("left")) return "Поверните налево.";
  if (modifier.includes("right")) return "Поверните направо.";
  return "Езжайте прямо.";
}

function speakRoutePrompt(message) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") return false;
  const speech = window.speechSynthesis;
  speech.cancel();
  const utterance = new window.SpeechSynthesisUtterance(String(message).replace(/\s+/g, " ").trim());
  utterance.lang = "ru-RU";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  utterance.volume = 1;

  const chooseRussianVoice = () => {
    const voices = speech.getVoices();
    const russianVoices = voices.filter(voice => /^ru([_-]|$)/i.test(voice.lang));
    // Prefer Galina by name only if the phone/browser actually exposes such a voice.
    // The Galina Yuzefovich package inside 2GIS is not automatically available to a web app.
    const galinaVoice = russianVoices.find(voice => /galina|галин|yuzefovich|юзефович/i.test(voice.name));
    const femaleRussianVoice = russianVoices.find(voice =>
      /female|жен|irina|ирина|milena|милена|alena|алёна|elena|елена|anna|анна|svetlana|светлана|olga|ольга|tatiana|tatyana|татьяна|marina|марина|daria|darya|дарья/i.test(voice.name)
    );
    return galinaVoice
      || femaleRussianVoice
      || russianVoices.find(voice => /google.*рус|google.*russian|yandex|яндекс/i.test(voice.name))
      || russianVoices.find(voice => /ru[-_]RU/i.test(voice.lang) && voice.localService)
      || russianVoices.find(voice => /ru[-_]RU/i.test(voice.lang))
      || russianVoices[0]
      || null;
  };

  const preferredVoice = chooseRussianVoice();
  if (preferredVoice) {
    utterance.voice = preferredVoice;
    speech.speak(utterance);
  } else {
    // Some Android browsers populate their TTS voice list asynchronously.
    let finished = false;
    const speakWithAvailableVoice = () => {
      if (finished) return;
      finished = true;
      speech.removeEventListener?.("voiceschanged", speakWithAvailableVoice);
      const availableVoice = chooseRussianVoice();
      if (availableVoice) utterance.voice = availableVoice;
      speech.speak(utterance);
    };
    speech.addEventListener?.("voiceschanged", speakWithAvailableVoice, { once: true });
    window.setTimeout(speakWithAvailableVoice, 900);
  }
  return true;
}

const ROAD_SCAN_DB_NAME = "astana-guide-road-scan-v1";
const ROAD_SCAN_FRAME_LIMIT = 400;

function openRoadScanDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("Локальное хранилище недоступно в этом браузере."));
      return;
    }
    const request = window.indexedDB.open(ROAD_SCAN_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("frames")) {
        const store = db.createObjectStore("frames", { keyPath: "id" });
        store.createIndex("capturedAt", "capturedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("observations")) {
        const store = db.createObjectStore("observations", { keyPath: "id" });
        store.createIndex("capturedAt", "capturedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Не удалось открыть локальную базу сканирования."));
    request.onblocked = () => reject(new Error("Закрой другие вкладки карты и повтори попытку."));
  });
}

function persistRoadScanFrame(frame, observation = null) {
  return openRoadScanDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(observation ? ["frames", "observations"] : ["frames"], "readwrite");
    const frames = tx.objectStore("frames");
    frames.put(frame);
    if (observation) tx.objectStore("observations").put(observation);

    // Keep a rolling local cache of frames so a long drive cannot fill the phone.
    const keysRequest = frames.index("capturedAt").getAllKeys();
    keysRequest.onsuccess = () => {
      const keys = keysRequest.result || [];
      const excess = keys.length - ROAD_SCAN_FRAME_LIMIT;
      if (excess > 0) keys.slice(0, excess).forEach(key => frames.delete(key));
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const error = tx.error || new Error("Не удалось сохранить кадр."); db.close(); reject(error); };
    tx.onabort = () => { const error = tx.error || new Error("Сохранение кадра отменено."); db.close(); reject(error); };
  }));
}

function getRoadScanData() {
  return openRoadScanDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(["frames", "observations"], "readonly");
    const framesCountRequest = tx.objectStore("frames").count();
    const observationsRequest = tx.objectStore("observations").getAll();
    let framesCount = 0;
    let observations = [];
    framesCountRequest.onsuccess = () => { framesCount = Number(framesCountRequest.result || 0); };
    observationsRequest.onsuccess = () => { observations = observationsRequest.result || []; };
    tx.oncomplete = () => { db.close(); resolve({ framesCount, observations }); };
    tx.onerror = () => { const error = tx.error || new Error("Не удалось прочитать сохранённые наблюдения."); db.close(); reject(error); };
  }));
}

const ROAD_SCAN_KINDS = [
  { value: "traffic-light", label: "Светофор", icon: "🚦" },
  { value: "camera", label: "Камера", icon: "📷" },
  { value: "speed-sign", label: "Ограничение скорости", icon: "🔵" },
  { value: "traffic-sign", label: "Дорожный знак", icon: "🛑" },
  { value: "pedestrian-crossing", label: "Пешеходный переход", icon: "🚸" },
  { value: "roadwork", label: "Дорожные работы", icon: "🚧" },
  { value: "parking", label: "Парковка", icon: "🅿️" },
  { value: "unknown", label: "Не определено", icon: "📍" },
];

function roadScanKindLabel(value) {
  return ROAD_SCAN_KINDS.find(item => item.value === value)?.label || "Дорожный объект";
}

export default function AstanaMapPage() {
  const mapEl = useRef(null);
  const map3dEl = useRef(null);
  const map3dRef = useRef(null);
  const map3dSyncRef = useRef(false);
  const map3dReadyRef = useRef(false);
  const map3dEnabledRef = useRef(true);
  const mapRef = useRef(null);
  const layersRef = useRef(null);
  const locationLayerRef = useRef(null);
  const roadObjectsLayerRef = useRef(null);
  const roadScanLayerRef = useRef(null);
  const roadScanVideoRef = useRef(null);
  const roadScanStreamRef = useRef(null);
  const roadScanIntervalRef = useRef(null);
  const roadScanWatchRef = useRef(null);
  const roadScanPositionRef = useRef(null);
  const roadScanCaptureBusyRef = useRef(false);
  const roadScanNativeObsCountRef = useRef(-1);
  const roadScanNativeScreenMatchCountRef = useRef(-1);
  const roadScanUploadedEvidenceRef = useRef(new Set());
  const roadScanUploadedEvidenceCountRef = useRef(0);
  const roadObjectsRef = useRef([]);
  const privateRoadObjectsRef = useRef([]);
  const publicCameraCatalogRef = useRef({ items: [], fetchedAt: 0 });
  const roadObjectsRequestRef = useRef({ inFlight: false, controller: null, lastRequestAt: 0 });
  const cameraWarningRef = useRef({ routeId: null, announced: new Set() });
  const roadObjectWarningRef = useRef({ routeId: null, announced: new Set() });
  const speedWarningRef = useRef({ active: false, limit: null, lastSpokenAt: 0 });
  const routeRef = useRef(null);
  const passedRouteRef = useRef(null);
  const arrowRef = useRef(null);
  const routePointsRef = useRef([]);
  const routeProgressRef = useRef(-1);
  const lastAppliedNavigationHeadingRef = useRef(null);
  const rerouteRef = useRef({ inFlight: false, lastAttemptAt: 0, offRouteSince: 0, offRouteSamples: 0 });
  const positionRef = useRef(null);
  const watchRef = useRef(null);
  const searchAbortRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const searchRequestRef = useRef(0);
  const lastSearchAtRef = useRef(0);
  const [leafletReady, setLeafletReady] = useState(false);
  const [map3dReady, setMap3dReady] = useState(false);
  const [map3dEnabled, setMap3dEnabled] = useState(true);
  const [map4dEnabled, setMap4dEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showResultsPanel, setShowResultsPanel] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [route, setRoute] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [routeOrigin, setRouteOrigin] = useState(null);
  const [mode, setMode] = useState("car");
  const [mapType, setMapType] = useState("map");
  const [speed, setSpeed] = useState(0);
  const [speedLimit, setSpeedLimit] = useState(null);
  const [upcomingCamera, setUpcomingCamera] = useState(null);
  const speedLimitRequestRef = useRef({ inFlight: false, controller: null, lastRequestAt: 0 });
  const [locating, setLocating] = useState(true);
  const [gpsFixReady, setGpsFixReady] = useState(false);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [nextInstruction, setNextInstruction] = useState(null);
  const [navigationStats, setNavigationStats] = useState({ routeId: null, remainingDistanceMeters: 0, remainingSeconds: 0 });
  const [navigationClock, setNavigationClock] = useState(Date.now());
  const [roadObjectsRevision, setRoadObjectsRevision] = useState(0);
  const [cameraCatalogRevision, setCameraCatalogRevision] = useState(0);
  const [showRoadDataDiagnostics, setShowRoadDataDiagnostics] = useState(false);
  const [roadDataDiagnostics, setRoadDataDiagnostics] = useState(null);
  const [roadScanPanelOpen, setRoadScanPanelOpen] = useState(false);
  const [mapAccessChecked, setMapAccessChecked] = useState(false);
  const [mapAccessAllowed, setMapAccessAllowed] = useState(false);
  const [mapAccessKeyInput, setMapAccessKeyInput] = useState("");
  const [mapAccessError, setMapAccessError] = useState("");
  const [mapAccessBusy, setMapAccessBusy] = useState(false);
  const [manualRoadAddMode, setManualRoadAddMode] = useState(false);
  const [manualRoadPosition, setManualRoadPosition] = useState(null);
  const [manualRoadKind, setManualRoadKind] = useState("traffic-light");
  const [manualRoadLabel, setManualRoadLabel] = useState("");
  const [manualRoadNotes, setManualRoadNotes] = useState("");
  const [manualRoadStatus, setManualRoadStatus] = useState("");
  const [manualRoadBusy, setManualRoadBusy] = useState(false);
  const [nativeScannerAvailable, setNativeScannerAvailable] = useState(false);
  const [roadScanActive, setRoadScanActive] = useState(false);
  const [roadScanStatus, setRoadScanStatus] = useState("Камера выключена");
  const [roadScanError, setRoadScanError] = useState("");
  const [roadScanCloudStatus, setRoadScanCloudStatus] = useState("Общая карта ещё не синхронизирована");
  const [screenScanActive, setScreenScanActive] = useState(false);
  const [screenScanStatus, setScreenScanStatus] = useState("Экран не сканируется");
  const [screenScanLastMatch, setScreenScanLastMatch] = useState("");
  const [screenScanMatchCount, setScreenScanMatchCount] = useState(0);
  const [screenScanCloudStatus, setScreenScanCloudStatus] = useState("Экран ещё не синхронизирован");
  const [screenScanFrameCount, setScreenScanFrameCount] = useState(0);
  const [screenScanIconCandidateFrames, setScreenScanIconCandidateFrames] = useState(0);
  const [screenScanIconCandidatesTotal, setScreenScanIconCandidatesTotal] = useState(0);
  const [screenScanIconSavedCount, setScreenScanIconSavedCount] = useState(0);
  const [screenScanTrackCount, setScreenScanTrackCount] = useState(0);
  const [screenScanIconStatus, setScreenScanIconStatus] = useState("Графические значки ещё не анализировались.");
  const [roadScanPosition, setRoadScanPosition] = useState(null);
  const [roadScanFrameCount, setRoadScanFrameCount] = useState(0);
  const [roadScanObservationCount, setRoadScanObservationCount] = useState(0);
  const [roadScanKind, setRoadScanKind] = useState("traffic-light");
  const [roadScanBusy, setRoadScanBusy] = useState(false);
  const [roadScanRevision, setRoadScanRevision] = useState(0);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherData, setWeatherData] = useState(null);
  const weatherLocationRef = useRef(null);
  const weatherAbortRef = useRef(null);
  const navigationStatsRef = useRef({
    routeId: null,
    remainingDistanceMeters: 0,
    remainingSeconds: 0,
    totalDistanceMeters: 0,
    totalDurationSeconds: 0,
    geometryLength: 0,
    lastGpsPoint: null,
    lastGpsAt: 0,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setShowRoadDataDiagnostics(params.get("debugRoads") === "1");
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/road-auth", { credentials: "same-origin", cache: "no-store" })
      .then(response => response.json().catch(() => null))
      .then(payload => {
        if (cancelled) return;
        setMapAccessAllowed(Boolean(payload?.authenticated));
        setMapAccessChecked(true);
      })
      .catch(() => {
        if (!cancelled) {
          setMapAccessAllowed(false);
          setMapAccessChecked(true);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => {
    if (roadScanIntervalRef.current) window.clearInterval(roadScanIntervalRef.current);
    if (roadScanWatchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(roadScanWatchRef.current);
    roadScanStreamRef.current?.getTracks?.().forEach(track => track.stop());
    roadScanStreamRef.current = null;
  }, []);

  useEffect(() => {
    setNativeScannerAvailable(Boolean(window.AstanaScanner && typeof window.AstanaScanner.getStatus === "function"));
  }, []);

  useEffect(() => {
    if (!window.AstanaScanner || typeof window.AstanaScanner.getStatus !== "function") return;
    let cancelled = false;
    const syncNativeScanner = async () => {
      try {
        const native = JSON.parse(window.AstanaScanner.getStatus() || "{}");
        if (cancelled) return;
        const observations = Array.isArray(native.observations) ? native.observations : [];
        setRoadScanFrameCount(Number(native.framesCount || 0));
        setRoadScanObservationCount(Number(native.observationsCount || observations.length || 0));
        setRoadScanCloudStatus(String(native.cloudSyncStatus || "Проверяем синхронизацию…"));
        setScreenScanActive(Boolean(native.screenScanActive));
        setScreenScanStatus(String(native.screenScanStatus || "Экран не сканируется"));
        setScreenScanLastMatch(String(native.screenScanLastMatch || ""));
        setScreenScanFrameCount(Number(native.screenScanFrameCount || 0));
        setScreenScanIconCandidateFrames(Number(native.screenScanIconCandidateFrames || 0));
        setScreenScanIconCandidatesTotal(Number(native.screenScanIconCandidatesTotal || 0));
        setScreenScanIconSavedCount(Number(native.screenScanIconSavedCount || 0));
        setScreenScanTrackCount(Number(native.screenScanTrackCount || 0));
        setScreenScanIconStatus(String(native.screenScanIconStatus || "Графические значки ещё не анализировались."));
        const screenMatchCount = Number(native.screenScanMatchCount || 0);
        setScreenScanMatchCount(screenMatchCount);
        setScreenScanCloudStatus(roadScanUploadedEvidenceCountRef.current > 0
          ? "Локальные координаты переданы на сервер: " + roadScanUploadedEvidenceCountRef.current
          : String(native.screenScanCloudStatus || "Экран ещё не синхронизирован"));
        if (screenMatchCount !== roadScanNativeScreenMatchCountRef.current) {
          roadScanNativeScreenMatchCountRef.current = screenMatchCount;
          setRoadScanRevision(value => value + 1);
        }
        if (native.lat != null && native.lng != null && Number.isFinite(Number(native.lat)) && Number.isFinite(Number(native.lng))) {
          const fix = {
            lat: Number(native.lat),
            lng: Number(native.lng),
            accuracy: Number(native.accuracy || 0),
            heading: null,
            speedMps: null,
          };
          roadScanPositionRef.current = fix;
          setRoadScanPosition(fix);
        }
        if (native.active) {
          setRoadScanActive(true);
          const gpsFresh = Date.now() - Number(native.gpsAt || 0) < 25000;
          setRoadScanStatus(gpsFresh
            ? "Фоновое сканирование работает · GPS подключён"
            : "Камера работает · ожидаем свежий GPS");
          if (native.lastError) setRoadScanError(String(native.lastError));
          else setRoadScanError("");
        } else if (native.lastError) {
          setRoadScanActive(false);
          setRoadScanStatus("Сканирование остановлено");
          setRoadScanError(String(native.lastError));
        } else if (!roadScanActive) {
          setRoadScanStatus("Камера выключена");
        }
        const count = observations.length;
        if (count !== roadScanNativeObsCountRef.current) {
          roadScanNativeObsCountRef.current = count;
          setRoadScanRevision(value => value + 1);
        }
      } catch (error) {
        if (!cancelled) setRoadScanError("Не удалось прочитать состояние Android-сканера.");
      }
    };
    void syncNativeScanner();
    const interval = window.setInterval(() => { void syncNativeScanner(); }, 2500);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [roadScanPanelOpen]);

  const [voiceGuidanceEnabled, setVoiceGuidanceEnabled] = useState(false);
  const voiceAnnouncementRef = useRef({ key: null, lastDistance: null, announced: new Set(), initialAnnounced: false });
  const [navigationMenuOpen, setNavigationMenuOpen] = useState(false);
  const navigationMapTypeRef = useRef(null);
  const navigationBearingRef = useRef(0);


  useEffect(() => {
    weatherLocationRef.current = origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
      ? { lat: origin.lat, lng: origin.lng, label: "Рядом с вами" }
      : null;
  }, [origin?.lat, origin?.lng]);

  useEffect(() => {
    let cancelled = false;
    let activeController = null;
    let timeoutId = null;

    // Show the last successful reading immediately after reopening the map.
    try {
      const cached = JSON.parse(window.localStorage.getItem("astana-map-weather-v1") || "null");
      if (cached?.current && Number.isFinite(Number(cached.current.temperature_2m)) &&
          Date.now() - Number(cached.savedAt || 0) < 60 * 60 * 1000) {
        setWeatherData(cached.current);
      }
    } catch {}

    const loadCurrentWeather = async () => {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      weatherAbortRef.current = controller;

      const point = weatherLocationRef.current || {
        lat: ASTANA[0],
        lng: ASTANA[1],
        label: "Астана",
      };

      setWeatherLoading(true);
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast");
        url.search = new URLSearchParams({
          latitude: String(point.lat),
          longitude: String(point.lng),
          current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
          timezone: "auto",
          temperature_unit: "celsius",
          wind_speed_unit: "kmh",
          forecast_days: "1",
        }).toString();

        timeoutId = window.setTimeout(() => controller.abort(), 9000);
        const response = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Weather service unavailable");
        const payload = await response.json();
        if (!payload?.current || !Number.isFinite(Number(payload.current.temperature_2m))) {
          throw new Error("No current weather data");
        }
        if (cancelled || controller.signal.aborted) return;

        const current = {
          ...payload.current,
          locationLabel: point.label,
          timezone: payload.timezone || "auto",
        };
        setWeatherData(current);
        try {
          window.localStorage.setItem("astana-map-weather-v1", JSON.stringify({
            savedAt: Date.now(),
            current,
          }));
        } catch {}
      } catch {
        // Keep the last cached reading (if any); the compact badge never blocks map use.
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (!cancelled && weatherAbortRef.current === controller) {
          weatherAbortRef.current = null;
          setWeatherLoading(false);
        }
      }
    };

    void loadCurrentWeather();
    const interval = window.setInterval(() => { void loadCurrentWeather(); }, 15 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      activeController?.abort();
      if (weatherAbortRef.current === activeController) weatherAbortRef.current = null;
    };
  }, [gpsFixReady]);

  useEffect(() => {
    // The map's DOM container is rendered only after private access is confirmed.
    // Start Leaflet after that transition, not during the locked/login render.
    if (!mapAccessAllowed) return;
    let cancelled = false;
    let tileFallbackTimer = null;
    let libraryLoadWatchdog = null;
    const load = () => {
      if (cancelled) return false;
      // Do not report success until the real map container exists.
      if (!mapEl.current) return false;
      if (mapRef.current) return true;
      if (!window.L || typeof window.L.map !== "function") return false;
      try {
      const L = window.L;
      const map = L.map(mapEl.current, {
        zoomControl: false,
        attributionControl: true,
        rotate: true,
        touchRotate: true,
        dragRotate: true,
        rotateClockwise: true,
        shiftKeyRotate: false,
        preventPageGestures: true,
        zoomAnimation: false,
        fadeAnimation: false,
      }).setView(ASTANA, 12);
      const tileOptions = {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
        keepBuffer: 4,
        updateWhenIdle: false,
        updateInterval: 300,
        updateWhenZooming: false,
        crossOrigin: true,
      };
      const base = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileOptions);
      const dark = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", tileOptions);
      const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "© Esri",
        keepBuffer: 4,
        updateWhenIdle: false,
        updateInterval: 300,
        updateWhenZooming: false,
        crossOrigin: true,
      });
      // Keep the street map visible even if the primary OSM tile host is slow or unreachable.
      const carto = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "© OpenStreetMap contributors © CARTO",
        keepBuffer: 4,
        updateWhenIdle: false,
        updateInterval: 300,
        updateWhenZooming: false,
        crossOrigin: true,
      });
      const esriStreet = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles © Esri — Sources: Esri, HERE, Garmin, OpenStreetMap contributors, and the GIS User Community",
        keepBuffer: 4,
        updateWhenIdle: false,
        updateInterval: 300,
        updateWhenZooming: false,
        crossOrigin: true,
      });

      map._moyTileFallbackLevel = 0;
      map._moyHasLoadedBaseTile = false;
      const activateTileFallback = level => {
        if (cancelled || mapRef.current !== map || map.hasLayer(satellite)) return;
        if ((map._moyTileFallbackLevel || 0) >= level) return;
        map._moyTileFallbackLevel = level;
        [base, dark, carto, esriStreet].forEach(layer => {
          if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        (level >= 2 ? esriStreet : carto).addTo(map);
        map.invalidateSize(true);
      };
      const countTileError = layer => {
        layer._moyTileErrors = (layer._moyTileErrors || 0) + 1;
        if (layer._moyTileErrors < 4) return;
        if (layer === base || layer === dark) activateTileFallback(1);
        else if (layer === carto) activateTileFallback(2);
      };
      base.on("tileerror", () => countTileError(base));
      dark.on("tileerror", () => countTileError(dark));
      carto.on("tileerror", () => countTileError(carto));
      base.on("tileload", () => {
        map._moyHasLoadedBaseTile = true;
        if (tileFallbackTimer !== null) {
          window.clearTimeout(tileFallbackTimer);
          tileFallbackTimer = null;
        }
      });

      base.addTo(map);
      tileFallbackTimer = window.setTimeout(() => {
        if (!cancelled && mapRef.current === map && !map._moyHasLoadedBaseTile && !map.hasLayer(satellite)) {
          activateTileFallback(1);
        }
      }, 1800);
      map._moyTiles = { base, dark, satellite, carto, esriStreet };
      layersRef.current = L.layerGroup().addTo(map);
      locationLayerRef.current = L.layerGroup().addTo(map);
      roadObjectsLayerRef.current = L.layerGroup().addTo(map);
      roadScanLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      if (libraryLoadWatchdog !== null) {
        window.clearTimeout(libraryLoadWatchdog);
        libraryLoadWatchdog = null;
      }
      setError("");
      const sync3DCameraFromLeaflet = () => {
        if (!map3dEnabledRef.current || !map3dReadyRef.current || map3dSyncRef.current || !map3dRef.current) return;
        const center = map.getCenter();
        map3dRef.current.jumpTo({ center: [center.lng, center.lat], zoom: map.getZoom() });
      };
      map.on("moveend", sync3DCameraFromLeaflet);
      map.on("zoomend", sync3DCameraFromLeaflet);
      map._moySync3DCamera = sync3DCameraFromLeaflet;
      setLeafletReady(true);
      requestAnimationFrame(() => map.invalidateSize());
      return true;
      } catch (error) {
        console.error("[Astana Guide] Leaflet map initialization failed", error);
        try { mapRef.current?.remove(); } catch {}
        mapRef.current = null;
        if (mapEl.current) {
          mapEl.current.innerHTML = "";
          try { delete mapEl.current._leaflet_id; } catch {}
        }
        setLeafletReady(false);
        setError("Не удалось запустить карту. Нажмите «Обновить» и повторите попытку.");
        return false;
      }
    };
    if (!document.querySelector('link[data-moy-leaflet="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      link.dataset.moyLeaflet = "1";
      document.head.appendChild(link);
    }
    const loadWithRotation = () => {
      if (cancelled || !window.L || typeof window.L.map !== "function") return false;

      // Do not make the whole map wait for the optional rotation plugin.
      // Paint the street map immediately, while rotation support loads in parallel.
      const initialized = load();
      if (!initialized) {
        window.L = undefined;
        loadLeafletFromCDNFallbacks();
        return false;
      }
      if (typeof window.L.Map?.prototype?.setBearing === "function") return true;

      let rotateScript = document.querySelector('script[data-moy-leaflet-rotate-js="1"]');
      if (!rotateScript) {
        rotateScript = document.createElement("script");
        rotateScript.src = "https://unpkg.com/@tomickigrzegorz/leaflet-rotate@0.3.0/dist/leaflet-rotate.umd.min.js";
        rotateScript.dataset.moyLeafletRotateJs = "1";
        rotateScript.addEventListener("load", () => {
          rotateScript.dataset.moyLeafletRotateLoaded = "true";
        }, { once: true });
        document.head.appendChild(rotateScript);
      } else if (rotateScript.dataset.moyLeafletRotateLoaded !== "true") {
        rotateScript.addEventListener("load", () => {
          rotateScript.dataset.moyLeafletRotateLoaded = "true";
        }, { once: true });
      }
      return true;
    };

    // Do not depend on a single CDN: mobile networks and embedded browsers can
    // stall a script request without immediately firing an error event.
    libraryLoadWatchdog = window.setTimeout(() => {
      if (!cancelled && !mapRef.current) {
        setLocating(false);
        setError(previous => previous || "Карта долго загружается. Проверьте интернет и обновите страницу.");
      }
    }, 28000);

    const loadLeafletFromFallbacks = async () => {
      if (cancelled) return;
      if (window.L && typeof window.L.map === "function") {
        loadWithRotation();
        return;
      }
      // A stale or partially loaded Leaflet global must not block recovery.
      window.L = undefined;

      // Prefer the copy bundled with this app. This avoids a blank map when the phone
      // or embedded WebView cannot reach a public CDN (jsDelivr, cdnjs or unpkg).
      let localImportTimeout = null;
      try {
        // A dynamic chunk can stall indefinitely in some mobile browsers. Bound the
        // wait so same-origin and CDN script fallbacks get a chance to initialize.
        const leafletModule = await Promise.race([
          import("leaflet"),
          new Promise((_, reject) => {
            localImportTimeout = window.setTimeout(
              () => reject(new Error("Leaflet module import timed out")),
              3500
            );
          }),
        ]);
        if (localImportTimeout !== null) window.clearTimeout(localImportTimeout);
        if (cancelled) return;
        window.L = leafletModule.default || leafletModule;
        if (!window.L || typeof window.L.map !== "function") {
          throw new Error("Локальная библиотека карты загрузилась без функции map");
        }
        if (loadWithRotation()) return;
        window.L = undefined;
      } catch (localError) {
        if (localImportTimeout !== null) window.clearTimeout(localImportTimeout);
        console.warn("[Astana Guide] Bundled Leaflet unavailable or stalled; trying script fallbacks", localError);
      }
      loadLeafletFromCDNFallbacks();
    };

    const loadLeafletFromCDNFallbacks = () => {
      if (cancelled) return;
      if (window.L && typeof window.L.map === "function") {
        loadWithRotation();
        return;
      }
      window.L = undefined;

      const sources = [
        // Prefer same-origin assets and the app-hosted dependency before third-party CDNs.
        "/vendor/leaflet.js",
        "/api/leaflet-runtime",
        "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
        "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js",
        "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
      ];
      let attempt = 0;

      const tryNextSource = () => {
        if (cancelled) return;
        if (window.L && typeof window.L.map === "function") {
          loadWithRotation();
          return;
        }
        window.L = undefined;
        if (attempt >= sources.length) {
          if (libraryLoadWatchdog !== null) {
            window.clearTimeout(libraryLoadWatchdog);
            libraryLoadWatchdog = null;
          }
          setLocating(false);
          setError("Не удалось загрузить библиотеку карты. Проверьте интернет и нажмите «Обновить».");
          return;
        }

        document.querySelectorAll('script[data-moy-leaflet-js="1"]').forEach(node => node.remove());
        const script = document.createElement("script");
        script.src = sources[attempt++];
        script.dataset.moyLeafletJs = "1";
        let settled = false;
        let attemptTimer = null;
        const cleanup = () => {
          if (attemptTimer !== null) {
            window.clearTimeout(attemptTimer);
            attemptTimer = null;
          }
          script.onload = null;
          script.onerror = null;
        };

        script.onload = () => {
          if (settled || cancelled) return;
          settled = true;
          cleanup();
          // A script may return HTML/error payload with status 200 and still fire load.
          // Only accept a source that exposes the actual Leaflet map API.
          if (window.L && typeof window.L.map === "function") {
            script.dataset.moyLeafletLoaded = "true";
            if (loadWithRotation()) return;
          }
          window.L = undefined;
          script.remove();
          tryNextSource();
        };
        script.onerror = () => {
          if (settled || cancelled) return;
          settled = true;
          cleanup();
          script.remove();
          tryNextSource();
        };
        attemptTimer = window.setTimeout(() => {
          if (settled || cancelled) return;
          settled = true;
          cleanup();
          script.remove();
          tryNextSource();
        }, 4500);
        document.head.appendChild(script);
      };

      const existingLoadedScript = document.querySelector('script[data-moy-leaflet-js="1"][data-moy-leaflet-loaded="true"]');
      if (existingLoadedScript && window.L && typeof window.L.map === "function") loadWithRotation();
      else tryNextSource();
    };

    loadLeafletFromFallbacks();
    return () => {
      cancelled = true;
      if (libraryLoadWatchdog !== null) window.clearTimeout(libraryLoadWatchdog);
      if (tileFallbackTimer !== null) window.clearTimeout(tileFallbackTimer);
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      layersRef.current = null;
      locationLayerRef.current = null;
      roadObjectsLayerRef.current = null;
      roadObjectsRef.current = [];
      privateRoadObjectsRef.current = [];
      passedRouteRef.current = null;
      roadObjectsRequestRef.current.controller?.abort();
      roadObjectsRequestRef.current = { inFlight: false, controller: null, lastRequestAt: 0 };
      routeRef.current = null;
      arrowRef.current = null;
    };
  }, [mapAccessAllowed]);

  useEffect(() => {
    if (!leafletReady) return;
    let cancelled = false;
    let loadTimer = null;
    let start3dTimer = null;
    let mapInstance = null;

    const failTo2D = () => {
      if (cancelled) return;
      map3dEnabledRef.current = false;
      map3dReadyRef.current = false;
      setMap3dEnabled(false);
      setMap3dReady(false);
      setMap4dEnabled(false);
    };

    const addLayerBeforeLabels = (map, layer, labelLayerId) => {
      if (labelLayerId) map.addLayer(layer, labelLayerId);
      else map.addLayer(layer);
    };

    const initialize3DMap = () => {
      if (cancelled || !window.maplibregl || !map3dEl.current || map3dRef.current) return;
      try {
        const initialPosition = positionRef.current || { lat: ASTANA[0], lng: ASTANA[1] };
        const map = new window.maplibregl.Map({
          container: map3dEl.current,
          style: "https://tiles.openfreemap.org/styles/liberty",
          center: [initialPosition.lng, initialPosition.lat],
          zoom: 15.5,
          pitch: 52,
          bearing: 0,
          maxPitch: 65,
          minZoom: 3,
          maxZoom: 20,
          attributionControl: true,
          canvasContextAttributes: { antialias: true },
        });
        mapInstance = map;
        map3dRef.current = map;

        map.once("load", () => {
          if (cancelled || map3dRef.current !== map) return;
          try {
            const styleLayers = map.getStyle().layers || [];
            const labelLayer = styleLayers.find(layer => layer.type === "symbol" && layer.layout && layer.layout["text-field"]);
            const labelLayerId = labelLayer ? labelLayer.id : null;
            const emptyCollection = { type: "FeatureCollection", features: [] };

            // Draw recognizable navigation symbols once and use them as actual map icons.
            // These replace colored circles and single-letter labels on the 3D/4D road layer.
            const roundRect = (ctx, x, y, width, height, radius) => {
              const r = Math.min(radius, width / 2, height / 2);
              ctx.beginPath();
              ctx.moveTo(x + r, y);
              ctx.lineTo(x + width - r, y);
              ctx.quadraticCurveTo(x + width, y, x + width, y + r);
              ctx.lineTo(x + width, y + height - r);
              ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
              ctx.lineTo(x + r, y + height);
              ctx.quadraticCurveTo(x, y + height, x, y + height - r);
              ctx.lineTo(x, y + r);
              ctx.quadraticCurveTo(x, y, x + r, y);
              ctx.closePath();
            };
            const addCanvasRoadIcon = (name, width, height, draw) => {
              if (map.hasImage(name)) return;
              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              draw(ctx, width, height);
              map.addImage(name, ctx.getImageData(0, 0, width, height), { pixelRatio: 2 });
            };

            addCanvasRoadIcon("astana-road-camera", 64, 64, (ctx) => {
              ctx.save();
              ctx.shadowColor = "rgba(0,0,0,0.38)";
              ctx.shadowBlur = 6;
              ctx.shadowOffsetY = 2;
              roundRect(ctx, 7, 9, 50, 46, 12);
              ctx.fillStyle = "#ffffff";
              ctx.fill();
              ctx.shadowColor = "transparent";
              ctx.lineWidth = 3.5;
              ctx.strokeStyle = "#d92c3a";
              ctx.stroke();
              roundRect(ctx, 15, 24, 34, 22, 5);
              ctx.fillStyle = "#273441";
              ctx.fill();
              roundRect(ctx, 22, 19, 14, 8, 3);
              ctx.fillStyle = "#273441";
              ctx.fill();
              ctx.beginPath();
              ctx.arc(32, 35, 8.3, 0, Math.PI * 2);
              ctx.fillStyle = "#ffffff";
              ctx.fill();
              ctx.beginPath();
              ctx.arc(32, 35, 5.1, 0, Math.PI * 2);
              ctx.fillStyle = "#1479b8";
              ctx.fill();
              ctx.beginPath();
              ctx.arc(30.2, 33.1, 1.7, 0, Math.PI * 2);
              ctx.fillStyle = "#dff5ff";
              ctx.fill();
              ctx.restore();
            });

            addCanvasRoadIcon("astana-road-traffic-light", 56, 80, (ctx) => {
              ctx.save();
              ctx.shadowColor = "rgba(0,0,0,0.35)";
              ctx.shadowBlur = 5;
              ctx.shadowOffsetY = 2;
              roundRect(ctx, 8, 3, 40, 74, 12);
              ctx.fillStyle = "#222c36";
              ctx.fill();
              ctx.shadowColor = "transparent";
              ctx.lineWidth = 3;
              ctx.strokeStyle = "#ffffff";
              ctx.stroke();
              [
                { y: 19, color: "#f0444c" },
                { y: 40, color: "#ffbf2f" },
                { y: 61, color: "#24bd67" },
              ].forEach(light => {
                ctx.beginPath();
                ctx.arc(28, light.y, 7.7, 0, Math.PI * 2);
                ctx.fillStyle = light.color;
                ctx.fill();
                ctx.lineWidth = 1.8;
                ctx.strokeStyle = "#f7fafc";
                ctx.stroke();
              });
              ctx.restore();
            });

            addCanvasRoadIcon("astana-road-speed-limit", 64, 64, (ctx) => {
              ctx.save();
              ctx.shadowColor = "rgba(0,0,0,0.30)";
              ctx.shadowBlur = 5;
              ctx.shadowOffsetY = 2;
              ctx.beginPath();
              ctx.arc(32, 32, 25, 0, Math.PI * 2);
              ctx.fillStyle = "#ffffff";
              ctx.fill();
              ctx.shadowColor = "transparent";
              ctx.lineWidth = 5;
              ctx.strokeStyle = "#d92c3a";
              ctx.stroke();
              ctx.restore();
            });

            // OpenFreeMap publishes vector tiles without an API key; this source supplies real
            // building footprints and height attributes for the 3D extrusion layer.
            map.addSource("moy3d-buildings", {
              type: "vector",
              url: "https://tiles.openfreemap.org/planet",
            });
            addLayerBeforeLabels(map, {
              id: "moy3d-building-extrusions",
              type: "fill-extrusion",
              source: "moy3d-buildings",
              "source-layer": "building",
              minzoom: 14.5,
              filter: ["!=", ["get", "hide_3d"], true],
              paint: {
                "fill-extrusion-color": [
                  "interpolate", ["linear"], ["coalesce", ["get", "render_height"], 10],
                  0, "#d7dde4",
                  25, "#c5d0dc",
                  80, "#9bafc2",
                  180, "#869caf",
                ],
                "fill-extrusion-height": [
                  "interpolate", ["linear"], ["zoom"],
                  14.5, 0,
                  16, ["coalesce", ["get", "render_height"], ["get", "height"], 10],
                ],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
                "fill-extrusion-opacity": 0.92,
                "fill-extrusion-vertical-gradient": true,
              },
            }, labelLayerId);

            map.addSource("moy3d-main-route", { type: "geojson", data: emptyCollection });
            map.addSource("moy3d-alternative-routes", { type: "geojson", data: emptyCollection });
            map.addSource("moy3d-location-points", { type: "geojson", data: emptyCollection });
            map.addSource("moy3d-road-objects", { type: "geojson", data: emptyCollection });

            addLayerBeforeLabels(map, {
              id: "moy3d-alternative-route-lines",
              type: "line",
              source: "moy3d-alternative-routes",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: { "line-color": "#3284f6", "line-width": 4, "line-opacity": 0.82, "line-dasharray": [2, 1.6] },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-main-route-outline",
              type: "line",
              source: "moy3d-main-route",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#ffffff",
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 18, 15, 23, 18, 28],
                "line-opacity": 1,
              },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-main-route-line",
              type: "line",
              source: "moy3d-main-route",
              layout: { "line-cap": "round", "line-join": "round" },
              paint: {
                "line-color": "#00e94f",
                "line-width": ["interpolate", ["linear"], ["zoom"], 12, 10, 15, 14, 18, 18],
                "line-opacity": 1,
              },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-current-position-glow",
              type: "circle",
              source: "moy3d-location-points",
              filter: ["==", ["get", "kind"], "current"],
              paint: { "circle-radius": 13, "circle-color": "#1385ff", "circle-opacity": 0.2 },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-current-position",
              type: "circle",
              source: "moy3d-location-points",
              filter: ["==", ["get", "kind"], "current"],
              paint: { "circle-radius": 7, "circle-color": "#087cf5", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-current-direction-arrow",
              type: "symbol",
              source: "moy3d-location-points",
              filter: ["==", ["get", "kind"], "current"],
              layout: {
                "text-field": "▲",
                "text-size": 30,
                "text-rotate": ["get", "heading"],
                "text-rotation-alignment": "map",
                "text-allow-overlap": true,
                "text-ignore-placement": true,
                "text-offset": [0, -0.1],
              },
              paint: {
                "text-color": "#087cf5",
                "text-halo-color": "#ffffff",
                "text-halo-width": 3,
              },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-destination-pin",
              type: "circle",
              source: "moy3d-location-points",
              filter: ["==", ["get", "kind"], "destination"],
              paint: { "circle-radius": 8, "circle-color": "#16b957", "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-destination-label",
              type: "symbol",
              source: "moy3d-location-points",
              filter: ["==", ["get", "kind"], "destination"],
              layout: {
                "text-field": ["get", "title"],
                "text-size": 13,
                "text-offset": [0, 1.3],
                "text-anchor": "top",
                "text-max-width": 14,
                "text-allow-overlap": true,
              },
              paint: {
                "text-color": "#18232e",
                "text-halo-color": "#ffffff",
                "text-halo-width": 2,
              },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-road-object-icons",
              type: "symbol",
              source: "moy3d-road-objects",
              filter: ["in", ["get", "kind"], ["literal", ["camera", "traffic-light", "speed-sign"]]],
              layout: {
                "icon-image": [
                  "match", ["get", "kind"],
                  "camera", "astana-road-camera",
                  "traffic-light", "astana-road-traffic-light",
                  "speed-sign", "astana-road-speed-limit",
                  "astana-road-camera"
                ],
                "icon-size": [
                  "match", ["get", "kind"],
                  "camera", 1.0,
                  "traffic-light", 1.05,
                  "speed-sign", 0.95,
                  1.0
                ],
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-padding": 1,
              },
            }, labelLayerId);
            addLayerBeforeLabels(map, {
              id: "moy3d-road-object-speed-labels",
              type: "symbol",
              source: "moy3d-road-objects",
              filter: ["==", ["get", "kind"], "speed-sign"],
              layout: {
                "text-field": ["to-string", ["get", "speedLimit"]],
                "text-size": 12,
                "text-font": ["Open Sans Regular"],
                "text-allow-overlap": true,
                "text-ignore-placement": true,
                "text-anchor": "center",
              },
              paint: {
                "text-color": "#20242a",
                "text-halo-color": "#ffffff",
                "text-halo-width": 0.5,
              },
            }, labelLayerId);

            map.on("click", "moy3d-road-object-icons", event => {
              const feature = event.features?.[0];
              if (!feature) return;
              const props = feature.properties || {};
              const content = document.createElement("div");
              content.className = "moy-road-object-popup";
              const heading = document.createElement("b");
              heading.textContent = String(props.title || roadObjectTitle(String(props.kind || "")));
              content.appendChild(heading);
              const kind = String(props.kind || "");
              if (kind === "speed-sign" && Number.isFinite(Number(props.speedLimit)) && Number(props.speedLimit) > 0) {
                const limit = document.createElement("div");
                limit.className = "moy-road-object-popup-limit";
                limit.textContent = "Ограничение: " + Math.round(Number(props.speedLimit)) + " км/ч";
                content.appendChild(limit);
              }
              if (["roadwork", "closure", "hazard"].includes(kind)) {
                const note = document.createElement("small");
                note.className = "moy-road-object-popup-caveat";
                note.textContent = "Отметка OpenStreetMap; это не подтверждение текущего перекрытия или активных работ.";
                content.appendChild(note);
              }
              if (String(props.catalogSource || "") === "astana-gis") {
                const sourceNote = document.createElement("small");
                sourceNote.textContent = "Источник: открытый геопортал города Астаны. Отметка показывает расположение парковки, а не наличие свободных мест.";
                content.appendChild(sourceNote);
              }
              const sourceUrl = String(props.sourceUrl || "");
              if (sourceUrl && /^https:\/\/[^\s"'<>]+$/i.test(sourceUrl)) {
                const sourceLabel = document.createElement("small");
                sourceLabel.textContent = "Публичная камера из каталога QazGeo (не live-видеопоток). ";
                content.appendChild(sourceLabel);
                const link = document.createElement("a");
                link.href = sourceUrl;
                link.target = "_blank";
                link.rel = "noopener noreferrer";
                link.textContent = "Открыть источник";
                content.appendChild(link);
              }
              new window.maplibregl.Popup({ closeButton: true, maxWidth: "260px" })
                .setLngLat(event.lngLat)
                .setDOMContent(content)
                .addTo(map);
            });
            map.on("mouseenter", "moy3d-road-object-icons", () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", "moy3d-road-object-icons", () => { map.getCanvas().style.cursor = ""; });

            map.on("moveend", () => {
              if (cancelled || !map3dEnabledRef.current || map3dSyncRef.current || !mapRef.current) return;
              const center = map.getCenter();
              map3dSyncRef.current = true;
              mapRef.current.setView([center.lat, center.lng], map.getZoom(), { animate: false });
              requestAnimationFrame(() => { map3dSyncRef.current = false; });
              navigationBearingRef.current = map.getBearing();
            });

            map.on("error", event => {
              const message = String(event?.error?.message || "");
              if (/webgl context lost|failed to initialize webgl|webgl not supported/i.test(message)) failTo2D();
            });

            if (loadTimer !== null) window.clearTimeout(loadTimer);
            map3dReadyRef.current = true;
            setMap3dReady(true);
            map.resize();

            // Start the 2D controller at the same camera position so existing search,
            // route-building, GPS and navigation logic continues to use the same viewport.
            if (mapRef.current) {
              const center = map.getCenter();
              map3dSyncRef.current = true;
              mapRef.current.setView([center.lat, center.lng], map.getZoom(), { animate: false });
              requestAnimationFrame(() => { map3dSyncRef.current = false; });
            }
          } catch {
            failTo2D();
          }
        });

        map.on("webglcontextlost", failTo2D);
      } catch {
        failTo2D();
      }
    };

    // Start 3D only after the normal map has mounted. This prevents WebGL/style downloads
    // from competing with the first street tiles on a mobile connection.
    const start3DResources = () => {
      if (cancelled) return;
      const cssHref = "https://unpkg.com/maplibre-gl@5.12.0/dist/maplibre-gl.css";
      let css = document.querySelector('link[data-moy-maplibre-css="1"]');
      if (!css) {
        css = document.createElement("link");
        css.rel = "stylesheet";
        css.dataset.moyMaplibreCss = "1";
        document.head.appendChild(css);
      }
      if (css.href !== cssHref) css.href = cssHref;

      loadTimer = window.setTimeout(() => {
        if (!map3dReadyRef.current) failTo2D();
      }, 18000);

      if (window.maplibregl) {
        initialize3DMap();
      } else {
        // Replace an old incompatible script so the global bundle can initialize properly.
        const oldScript = document.querySelector('script[data-moy-maplibre-js="1"]');
        if (oldScript) oldScript.remove();
        const script = document.createElement("script");
        script.src = "https://unpkg.com/maplibre-gl@5.12.0/dist/maplibre-gl.js";
        script.dataset.moyMaplibreJs = "1";
        script.addEventListener("load", () => {
          if (window.maplibregl) initialize3DMap();
          else failTo2D();
        }, { once: true });
        script.addEventListener("error", failTo2D, { once: true });
        document.head.appendChild(script);
      }
    };
    start3dTimer = window.setTimeout(start3DResources, 1600);

    return () => {
      cancelled = true;
      map3dReadyRef.current = false;
      if (start3dTimer !== null) window.clearTimeout(start3dTimer);
      if (loadTimer !== null) window.clearTimeout(loadTimer);
      if (mapInstance) mapInstance.remove();
      if (map3dRef.current === mapInstance) map3dRef.current = null;
      setMap3dReady(false);
    };
  }, [leafletReady]);

  useEffect(() => {
    if (!map3dReady || !map3dRef.current) return;
    const map = map3dRef.current;
    const emptyCollection = { type: "FeatureCollection", features: [] };
    const setGeoJson = (id, data) => {
      const source = map.getSource(id);
      if (source && typeof source.setData === "function") source.setData(data || emptyCollection);
    };

    let mainRouteCoordinates = route?.geometry?.length > 1
      ? route.geometry.map(point => [point[1], point[0]])
      : [];

    if (navigating && mainRouteCoordinates.length > 1 && origin &&
        Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
      const snapped = snapToRoute(origin, mainRouteCoordinates);
      const storedProgress = routeProgressRef.current;
      // While the vehicle is on/near the active route, progress only moves forward.
      // Even if a GPS sample jitters, draw the remaining route from the car onward,
      // never redraw the already-travelled green line behind it.
      let progress = storedProgress >= 0 ? storedProgress : snapped.progress;
      if (Number.isFinite(snapped.distance) && snapped.distance <= 110) {
        progress = storedProgress >= 0 ? Math.max(storedProgress, snapped.progress) : snapped.progress;
        routeProgressRef.current = progress;
      } else if (storedProgress < 0 && Number.isFinite(snapped.progress)) {
        progress = snapped.progress;
        routeProgressRef.current = progress;
      }
      const startPoint = routePointAtProgress(mainRouteCoordinates, progress) || snapped.point;
      const nextIndex = Math.min(mainRouteCoordinates.length - 1, Math.floor(progress) + 1);
      mainRouteCoordinates = [
        startPoint,
        ...mainRouteCoordinates.slice(nextIndex),
      ];
    }

    const mainRoute = mainRouteCoordinates.length > 1 ? {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: mainRouteCoordinates.map(point => [point[1], point[0]]),
      },
    } : null;
    setGeoJson("moy3d-main-route", {
      type: "FeatureCollection",
      features: mainRoute ? [mainRoute] : [],
    });

    const alternativeFeatures = (routeOptions || [])
      .filter(option => option && option.geometry?.length > 1 && option.id !== route?.id)
      .map(option => ({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: option.geometry },
      }));
    setGeoJson("moy3d-alternative-routes", {
      type: "FeatureCollection",
      features: alternativeFeatures,
    });

    const locationFeatures = [];
    if (origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)) {
      const routeCoordinates = (navigating || map4dEnabled) && route?.geometry?.length > 1
        ? route.geometry.map(point => [point[1], point[0]])
        : [];
      const snapped = routeCoordinates.length > 1 ? snapToRoute(origin, routeCoordinates) : null;
      // Use the same route progress for the car icon and follow camera, so the
      // green strip cannot visually drift away from the vehicle while GPS jitters.
      const snapToGreenRoute = Boolean(snapped && Number.isFinite(snapped.distance) && snapped.distance <= 85);
      let markerPosition = [origin.lat, origin.lng];
      let heading = Number.isFinite(origin.heading) ? origin.heading : 0;
      if (snapToGreenRoute) {
        const progress = navigating && routeProgressRef.current >= 0
          ? Math.max(routeProgressRef.current, snapped.progress)
          : snapped.progress;
        if (navigating) routeProgressRef.current = progress;
        markerPosition = routePointAtProgress(routeCoordinates, progress) || snapped.point;
        heading = routeHeadingAtProgress(routeCoordinates, progress, 24) ?? snapped.heading;
      }
      locationFeatures.push({
        type: "Feature",
        properties: { kind: "current", title: "Моё местоположение", heading },
        geometry: { type: "Point", coordinates: [markerPosition[1], markerPosition[0]] },
      });
    }
    if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
      const destinationTitle = selectedPlace
        ? selectedPlaceTitle(selectedPlace)
        : String(query || "Выбранный адрес");
      locationFeatures.push({
        type: "Feature",
        properties: { kind: "destination", title: destinationTitle },
        geometry: { type: "Point", coordinates: [destination.lng, destination.lat] },
      });
    }
    setGeoJson("moy3d-location-points", {
      type: "FeatureCollection",
      features: locationFeatures,
    });

    const routePointsForObjects = route?.geometry?.length > 1
      ? route.geometry.map(point => [point[1], point[0]])
      : [];
    const objectProgress = navigating && routeProgressRef.current >= 0 ? routeProgressRef.current : 0;
    const mapBoundsForObjects = routePointsForObjects.length > 1
      ? null
      : (map3dRef.current?.getBounds?.() || mapRef.current?.getBounds?.() || null);

    const routeRelevantObjects = (roadObjectsRef.current || []).filter(item => {
      if (!isRoadObjectCoordinateUsable(item)) return false;
      if (!["camera", "traffic-light", "speed-sign"].includes(String(item.kind || ""))) return false;
      if (item.kind === "speed-sign" && (!Number.isFinite(Number(item.speedLimit)) || Number(item.speedLimit) <= 0)) return false;
      if (routePointsForObjects.length > 1) {
        const snapped = snapToRoute({ lat: Number(item.lat), lng: Number(item.lng) }, routePointsForObjects);
        // Keep real objects on the selected carriageway, not objects 2–3 lanes or
        // an entire opposing carriageway away from the route.
        const lateralLimit = item.kind === "traffic-light" ? 28 : item.kind === "camera" ? 18 : 22;
        if (!Number.isFinite(snapped.distance) || snapped.distance > lateralLimit) return false;
        const metersAhead = snapped.progress >= objectProgress
          ? routeDistanceBetweenProgress(routePointsForObjects, objectProgress, snapped.progress)
          : -routeDistanceBetweenProgress(routePointsForObjects, snapped.progress, objectProgress);
        // Show the next objects along the chosen travel direction. A few metres behind
        // are retained for map continuity; passed city-wide points are not drawn ahead.
        return metersAhead >= -35 && metersAhead <= 5000;
      }
      if (mapBoundsForObjects?.contains) {
        return mapBoundsForObjects.contains([Number(item.lng), Number(item.lat)]);
      }
      const center = positionRef.current || origin || { lat: ASTANA[0], lng: ASTANA[1] };
      return distanceBetween([center.lat, center.lng], [Number(item.lat), Number(item.lng)]) <= 1800;
    });

    const uniquePhysicalRoadObjects = deduplicatePhysicalRoadObjects(routeRelevantObjects, 4);
    const roadFeatures = uniquePhysicalRoadObjects.map(item => ({
      type: "Feature",
      properties: {
        id: String(item.id || ""),
        kind: item.kind || "traffic-light",
        label: item.shortLabel || roadObjectShortLabel(item.kind),
        title: item.title || roadObjectTitle(item.kind),
        speedLimit: Number.isFinite(Number(item.speedLimit)) ? Number(item.speedLimit) : 0,
        catalogSource: item.catalogSource || (item.tags?.source === "astana-gis" ? "astana-gis" : ""),
        sourceUrl: item.catalogSource === "qazgeo" ? String(item.tags?.source_url || "") : "",
      },
      geometry: { type: "Point", coordinates: [item.lng, item.lat] },
    }));
    setGeoJson("moy3d-road-objects", {
      type: "FeatureCollection",
      features: roadFeatures,
    });
  }, [map3dReady, map4dEnabled, navigating, route, routeOptions, destination, selectedPlace, query, origin?.lat, origin?.lng, roadObjectsRevision]);

  useEffect(() => {
    if (!map3dReady || !map3dRef.current || !map3dEnabled) return;
    const map = map3dRef.current;
    map.resize();
    const current = mapRef.current?.getCenter?.();
    const fallback = positionRef.current || origin || { lat: ASTANA[0], lng: ASTANA[1] };
    const center = current ? [current.lng, current.lat] : [fallback.lng, fallback.lat];
    const targetZoom = Math.max(15.2, Number(mapRef.current?.getZoom?.() || map.getZoom()));
    map.jumpTo({
      center,
      zoom: targetZoom,
      pitch: navigating ? 58 : 52,
      bearing: navigating && Number.isFinite(origin?.heading) ? origin.heading : map.getBearing(),
    });
    requestAnimationFrame(() => map.resize());
  }, [map3dEnabled, map3dReady]);

  useEffect(() => {
    if (!map3dReady || !map3dRef.current || !map3dEnabled || !navigating || !origin) return;
    const map = map3dRef.current;
    const routePoints = route?.geometry?.length > 1
      ? route.geometry.map(point => [point[1], point[0]])
      : [];
    let cameraPoint = [origin.lat, origin.lng];
    let targetHeading = Number.isFinite(origin.heading) && (origin.speedMps || 0) > 2.5
      ? origin.heading
      : map.getBearing();

    if (routePoints.length > 1) {
      const snapped = snapToRoute(origin, routePoints);
      if (Number.isFinite(snapped.distance) && snapped.distance <= 85) {
        const progress = routeProgressRef.current >= 0
          ? Math.max(routeProgressRef.current, snapped.progress)
          : snapped.progress;
        routeProgressRef.current = progress;
        const followPoint = routePointAtProgress(routePoints, progress) || snapped.point;
        if (followPoint) cameraPoint = followPoint;
        // Look ahead along the route so each bend turns the map before the car reaches it.
        const routeHeading = routeHeadingAtProgress(routePoints, progress, 24) ?? snapped.heading;
        if (Number.isFinite(routeHeading)) targetHeading = routeHeading;
      } else if (!Number.isFinite(origin.heading) || (origin.speedMps || 0) <= 2.5) {
        const snapHeading = routeHeadingAtProgress(routePoints, snapped.progress, 32) ?? snapped.heading;
        if (Number.isFinite(snapHeading)) targetHeading = snapHeading;
      }
    }

    const currentBearing = map.getBearing();
    const targetBearing = smoothHeading(currentBearing, targetHeading, 0.76);
    const bearingChanged = angleDifferenceDegrees(currentBearing, targetBearing) >= 1.0;
    const center = [cameraPoint[1], cameraPoint[0]];
    const currentCenter = map.getCenter();
    const centerChanged = distanceBetween(
      [currentCenter.lat, currentCenter.lng],
      cameraPoint
    ) >= 0.8;

    // Camera heading always follows the route geometry (GPS course is only a fallback),
    // keeping the active road centred and pointing toward the top of the screen.
    if (centerChanged || bearingChanged) {
      map.easeTo({
        center,
        zoom: Math.max(16.5, map.getZoom()),
        pitch: 58,
        bearing: targetBearing,
        duration: 220,
        essential: true,
      });
    }
  }, [map3dReady, map3dEnabled, navigating, route, origin?.lat, origin?.lng, origin?.heading, origin?.speedMps]);

  useEffect(() => {
    if (!leafletReady || !navigator.geolocation) {
      setLocating(false);
      return;
    }
    // Never let GPS permission/location lookup hold the home screen in a loading state.
    let locatingFallbackTimer = window.setTimeout(() => setLocating(false), 4500);
    const finishLocating = () => {
      if (locatingFallbackTimer !== null) {
        window.clearTimeout(locatingFallbackTimer);
        locatingFallbackTimer = null;
      }
      setLocating(false);
    };
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null, speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : 0 };
        positionRef.current = p;
        setOrigin(p);
        setGpsFixReady(true);
        setSpeed(Math.max(0, Math.round((pos.coords.speed || 0) * 3.6)));
        finishLocating();
        mapRef.current?.setView([p.lat, p.lng], 15);
      },
      () => { setGpsFixReady(false); setOrigin({ lat: ASTANA[0], lng: ASTANA[1] }); finishLocating(); },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
    );
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: Number.isFinite(pos.coords.heading) ? pos.coords.heading : null, speedMps: Number.isFinite(pos.coords.speed) ? pos.coords.speed : 0 };
        positionRef.current = p;
        setOrigin(p);
        setGpsFixReady(true);
        setSpeed(Math.max(0, Math.round((pos.coords.speed || 0) * 3.6)));
        if (routeRef.current && arrowRef.current) arrowRef.current.setLatLng([p.lat, p.lng]);
      },
      () => setGpsFixReady(false),
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 10000 }
    );
    return () => {
      if (locatingFallbackTimer !== null) window.clearTimeout(locatingFallbackTimer);
      if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    };
  }, [leafletReady]);

  async function searchAddress(value = query) {
    const text = normalizeSearchText(value);
    if (text.length < 2) {
      setResults([]);
      setShowResultsPanel(false);
      setSearching(false);
      setError("Введите хотя бы два символа адреса.");
      return;
    }

    setQuery(text);
    setShowResultsPanel(true);
    setError("");
    const cacheKey = text.toLocaleLowerCase("ru-RU");
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const requestId = ++searchRequestRef.current;
    const cached = searchCacheRef.current.get(cacheKey);
    if (cached) {
      setSearching(false);
      setResults(cached);
      return;
    }

    setSearching(true);
    setResults([]);
    const timeout = window.setTimeout(() => controller.abort(), 18000);

    try {
      // Photon tolerates minor typos and supports location-biased geocoding.
      try {
        const photonUrl = new URL(PHOTON);
        photonUrl.searchParams.set("q", text);
        photonUrl.searchParams.set("limit", "8");
        photonUrl.searchParams.set("lang", "ru");
        photonUrl.searchParams.set("countrycode", "KZ");
        const focus = positionRef.current || origin;
        if (focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng)) {
          photonUrl.searchParams.set("lat", String(focus.lat));
          photonUrl.searchParams.set("lon", String(focus.lng));
          photonUrl.searchParams.set("zoom", "13");
        }
        const response = await fetch(photonUrl.toString(), {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Photon HTTP " + response.status);
        const data = await response.json();
        const found = (Array.isArray(data.features) ? data.features : [])
          .map(photonToAddress)
          .filter(Boolean);
        if (found.length && requestId === searchRequestRef.current && !controller.signal.aborted) {
          searchCacheRef.current.set(cacheKey, found);
          if (searchCacheRef.current.size > 60) searchCacheRef.current.delete(searchCacheRef.current.keys().next().value);
          setResults(found);
          return;
        }
      } catch (e) {
        if (e?.name === "AbortError") throw e;
      }

      // Nominatim is the fallback. The viewbox is a preference, not a hard boundary,
      // so the search can still return settlements and villages outside Astana.
      const nominatimUrl = new URL(NOMINATIM);
      nominatimUrl.searchParams.set("format", "jsonv2");
      nominatimUrl.searchParams.set("addressdetails", "1");
      nominatimUrl.searchParams.set("limit", "8");
      nominatimUrl.searchParams.set("accept-language", "ru");
      nominatimUrl.searchParams.set("countrycodes", "kz");
      nominatimUrl.searchParams.set("q", text);
      const focus = positionRef.current || origin;
      if (focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng)) {
        const span = 0.45;
        nominatimUrl.searchParams.set("viewbox", [
          focus.lng - span, focus.lat + span, focus.lng + span, focus.lat - span
        ].join(","));
        nominatimUrl.searchParams.set("bounded", "0");
      }
      const waitMs = Math.max(0, 1100 - (Date.now() - lastSearchAtRef.current));
      if (waitMs) await new Promise(resolve => window.setTimeout(resolve, waitMs));
      if (controller.signal.aborted || requestId !== searchRequestRef.current) return;
      lastSearchAtRef.current = Date.now();
      const response = await fetch(nominatimUrl.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Nominatim HTTP " + response.status);
      const data = await response.json();
      const found = Array.isArray(data) ? data : [];
      if (requestId === searchRequestRef.current && !controller.signal.aborted) {
        if (found.length) {
          searchCacheRef.current.set(cacheKey, found);
          if (searchCacheRef.current.size > 60) searchCacheRef.current.delete(searchCacheRef.current.keys().next().value);
        }
        setResults(found);
        if (!found.length) setError("Адрес не найден. Попробуйте добавить номер дома или название города/посёлка.");
      }
    } catch (e) {
      if (e?.name !== "AbortError" && requestId === searchRequestRef.current) {
        setResults([]);
        setError("Поиск временно недоступен. Проверьте интернет и попробуйте снова.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestId === searchRequestRef.current) {
        setSearching(false);
        if (controller.signal.aborted) {
          setError("Поиск занимает слишком много времени. Попробуйте ещё раз.");
        }
      }
    }
  }

  function startVoiceSearch() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Голосовой поиск не поддерживается этим браузером. Введите адрес вручную.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "ru-RU";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => { setListening(true); setError(""); };
      recognition.onresult = event => {
        const spoken = event.results?.[0]?.[0]?.transcript?.trim();
        if (spoken) {
          setQuery(spoken);
          setResults([]);
          setShowResultsPanel(false);
          setError("Нажмите поиск, чтобы найти произнесённый адрес.");
        }
      };
      recognition.onerror = () => setError("Не удалось распознать речь. Можно ввести адрес вручную.");
      recognition.onend = () => setListening(false);
      recognition.start();
    } catch {
      setListening(false);
      setError("Не удалось запустить голосовой поиск. Введите адрес вручную.");
    }
  }

  useEffect(() => {
    if (!leafletReady || !mapRef.current) return;
    const L = window.L;
    const tiles = mapRef.current._moyTiles;
    if (!tiles) return;
    Object.values(tiles).forEach(layer => { if (mapRef.current.hasLayer(layer)) mapRef.current.removeLayer(layer); });
    const fallbackLevel = mapRef.current._moyTileFallbackLevel || 0;
    const activeTileKey = mapType === "satellite"
      ? "satellite"
      : fallbackLevel >= 2
        ? "esriStreet"
        : fallbackLevel >= 1
          ? "carto"
          : mapType === "dark" ? "dark" : "base";
    tiles[activeTileKey].addTo(mapRef.current);
  }, [mapType, leafletReady]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || !layersRef.current) return;
    const L = window.L;
    const group = layersRef.current;
    group.clearLayers();
    routeRef.current = null;
    passedRouteRef.current = null;
    routePointsRef.current = [];
    routeProgressRef.current = -1;

    if (destination) {
      const title = selectedPlaceTitle(selectedPlace);
      const rating = Number.isFinite(Number(selectedPlace?.rating)) && selectedPlace?.rating !== null && selectedPlace?.rating !== undefined
        ? `<small>★ ${escapeHtml(Number(selectedPlace.rating).toFixed(1))}</small>`
        : "";
      const icon = L.divIcon({
        className: route ? "moy-destination-icon" : "moy-selected-place",
        html: route
          ? '<span>Б</span>'
          : `<span class="moy-selected-pin"></span><span class="moy-selected-label"><b>${escapeHtml(title)}</b>${rating}</span>`,
        iconSize: route ? [40, 46] : [290, 58],
        iconAnchor: route ? [20, 44] : [20, 38],
      });
      L.marker([destination.lat, destination.lng], { icon, zIndexOffset: 900 }).addTo(group);
    }

    if (route?.geometry?.length > 1) {
      const allOptions = routeOptions.length ? routeOptions : [route];
      const boundsPoints = [];
      allOptions.filter(option => option && option !== route && option.geometry?.length > 1).forEach(option => {
        const alternativeLine = option.geometry.map(p => [p[1], p[0]]);
        boundsPoints.push(...alternativeLine);
        L.polyline(alternativeLine, {
          color: "#3985f6",
          weight: 6,
          opacity: 0.82,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "9 7",
          interactive: false,
        }).addTo(group);
        const middle = alternativeLine[Math.floor(alternativeLine.length / 2)];
        if (middle) {
          const altIcon = L.divIcon({
            className: "moy-alt-route-label",
            html: '<span>' + escapeHtml(formatDuration(option.duration)) + '<small>' + escapeHtml(formatDistance(option.distance)) + '</small></span>',
            iconSize: [88, 44],
            iconAnchor: [44, 22],
          });
          L.marker(middle, { icon: altIcon, interactive: false, zIndexOffset: 600 }).addTo(group);
        }
      });
      const line = route.geometry.map(p => [p[1], p[0]]);
      boundsPoints.push(...line);
      routePointsRef.current = line;
      routeRef.current = L.polyline(line, {
        color: "#20c943",
        weight: 8,
        opacity: 0.98,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(group);
      passedRouteRef.current = L.polyline([line[0]], {
        color: "#d7dfe4",
        weight: 11,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false,
      }).addTo(group);
      const bounds = L.latLngBounds(boundsPoints.length ? boundsPoints : line);
      // During navigation, keep the current camera position and zoom. Fitting the entire route
      // after an automatic reroute causes a visible jump and forces all map tiles to reload.
      if (!navigating) {
        mapRef.current.fitBounds(bounds, { paddingTopLeft: [18, 80], paddingBottomRight: [18, 300], maxZoom: 16 });
      }
      if (route.steps?.length) {
        route.steps.filter(s => ["turn", "roundabout", "fork"].includes(s.maneuver?.type)).forEach(step => {
          const c = step.maneuver?.location;
          if (!Array.isArray(c)) return;
          const icon = L.divIcon({ className: "moy-turn-icon", html: `<span>${turnSymbol(step)}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
          L.marker([c[1], c[0]], { icon, interactive: false }).addTo(group);
        });
      }
    } else if (destination) {
      mapRef.current.setView([destination.lat, destination.lng], 15);
    }
  }, [leafletReady, destination?.lat, destination?.lng, route, routeOptions, selectedPlace]); 

  useEffect(() => {
    if (!navigating || !route) return;

    const points = (route.geometry || []).map(point => [point[1], point[0]]);
    const geometryLength = routeGeometryLength(points);
    const totalDistanceMeters = Math.max(0, Number(route.distance) || geometryLength);
    const totalDurationSeconds = Math.max(0, Number(route.duration) || 0);
    const initialStats = {
      routeId: route.id || null,
      remainingDistanceMeters: totalDistanceMeters,
      remainingSeconds: totalDurationSeconds,
      totalDistanceMeters,
      totalDurationSeconds,
      geometryLength,
      lastGpsPoint: null,
      lastGpsAt: 0,
    };
    navigationStatsRef.current = initialStats;
    setNavigationStats({
      routeId: initialStats.routeId,
      remainingDistanceMeters: totalDistanceMeters,
      remainingSeconds: totalDurationSeconds,
    });
    setNavigationClock(Date.now());

    // Refresh the arrival clock only on the active navigation screen.
    const timer = window.setInterval(() => setNavigationClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [navigating, route]);

  useEffect(() => {
    if (!leafletReady || !locationLayerRef.current) return;
    const L = window.L;
    const group = locationLayerRef.current;
    group.clearLayers();
    arrowRef.current = null;
    if (!origin) return;

    let point = [origin.lat, origin.lng];
    let heading = 0;
    const points = routePointsRef.current;
    if (navigating && route?.geometry?.length > 1 && points.length > 1) {
      const snapped = snapToRoute(origin, points);
      if (snapped.distance <= 85) {
        rerouteRef.current.offRouteSince = 0;
        rerouteRef.current.offRouteSamples = 0;
        if (routeProgressRef.current < 0 || snapped.progress > routeProgressRef.current) {
          routeProgressRef.current = snapped.progress;
        }
        const progress = Math.max(0, Math.min(points.length - 1, routeProgressRef.current));

        // Keep remaining distance tied to progress along the actual route geometry.
        // ETA only consumes the time represented by distance genuinely travelled; while stopped,
        // the remaining-time value holds steady and the displayed arrival time moves later.
        const stats = navigationStatsRef.current;
        if (stats.routeId === (route.id || null)) {
          const geometryRemaining = routeDistanceToIndex(points, progress, points.length - 1);
          const remainingDistanceMeters = stats.geometryLength > 0
            ? Math.max(0, Math.min(stats.totalDistanceMeters, stats.totalDistanceMeters * geometryRemaining / stats.geometryLength))
            : Math.max(0, stats.totalDistanceMeters - (stats.totalDistanceMeters * progress / Math.max(1, points.length - 1)));
          const now = Date.now();
          const previousGpsPoint = stats.lastGpsPoint;
          const gpsDisplacement = previousGpsPoint ? distanceBetween(previousGpsPoint, [origin.lat, origin.lng]) : 0;
          const elapsedSeconds = stats.lastGpsAt ? Math.max(0.1, (now - stats.lastGpsAt) / 1000) : 0;
          const reportedSpeed = Math.max(0, Number(origin.speedMps) || 0);
          const looksMoving = reportedSpeed >= 0.35 ||
            (Boolean(previousGpsPoint) && gpsDisplacement >= Math.max(2.5, elapsedSeconds * 0.55));

          stats.lastGpsPoint = [origin.lat, origin.lng];
          stats.lastGpsAt = now;

          const distanceDelta = Math.max(0, stats.remainingDistanceMeters - remainingDistanceMeters);
          if (looksMoving && distanceDelta >= 0.5) {
            stats.remainingDistanceMeters = remainingDistanceMeters;
            const secondsPerMeter = stats.totalDurationSeconds / Math.max(1, stats.totalDistanceMeters);
            stats.remainingSeconds = Math.max(0, stats.remainingSeconds - distanceDelta * secondsPerMeter);
            setNavigationStats({
              routeId: stats.routeId,
              remainingDistanceMeters: stats.remainingDistanceMeters,
              remainingSeconds: stats.remainingSeconds,
            });
          }
        }

        const segment = Math.min(points.length - 2, Math.floor(progress));
        const fraction = progress >= points.length - 1 ? 1 : progress - segment;
        point = [
          points[segment][0] + (points[segment + 1][0] - points[segment][0]) * fraction,
          points[segment][1] + (points[segment + 1][1] - points[segment][1]) * fraction,
        ];
        // Derive bearing from monotonic route progress rather than the closest GPS snap segment.
        // A short look-ahead reduces small geometry wiggles and wrong turns at parallel roads.
        heading = routeHeadingAtProgress(points, progress, 24);
        if (Number.isFinite(heading) && mapRef.current) {
          const previousHeading = lastAppliedNavigationHeadingRef.current;
          const smoothedHeading = smoothHeading(previousHeading, heading, 0.38);
          if (previousHeading === null || angleDifferenceDegrees(smoothedHeading, previousHeading) >= 2.5) {
            setMapHeadingUp(mapRef.current, smoothedHeading, { ease: 0.28, deadzone: 1.0 });
            lastAppliedNavigationHeadingRef.current = smoothedHeading;
          }
        }

        // Show only the untraveled route ahead. Remove the grey completed-trail layer
        // so nothing resembling a route strip remains behind the vehicle in 2D.
        const remainingPoints = [point, ...points.slice(segment + 1)];
        routeRef.current?.setLatLngs(remainingPoints.length > 1 ? remainingPoints : [point]);
        passedRouteRef.current?.setLatLngs([]);

        setNextInstruction(nextRouteInstruction(route, points, progress));
        // Avoid continuous pans from noisy GPS. A gentler, less frequent pan lets tile grids settle.
        const currentMap = mapRef.current;
        const center = currentMap?.getCenter?.();
        const centerError = center ? distanceBetween([center.lat, center.lng], point) : Infinity;
        if (currentMap && centerError > 18) {
          currentMap.panTo(point, { animate: true, duration: 0.85, easeLinearity: 0.25 });
        }
        const icon = L.divIcon({
          className: "moy-nav-arrow",
          html: '<span class="moy-nav-arrow-shape" aria-hidden="true"><svg viewBox="0 0 48 48" role="presentation"><path d="M24 3 44 44 24 34 4 44Z" fill="#087cf5" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/><path d="M24 15V31" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/></svg></span>',
          iconSize: [52, 52],
          iconAnchor: [26, 26],
        });
        arrowRef.current = L.marker(point, { icon, interactive: false, zIndexOffset: 2000 }).addTo(group);
      } else {
        setNextInstruction({ distance: "", arrow: "↑" });
        const rerouteState = rerouteRef.current;
        const now = Date.now();
        if (!rerouteState.offRouteSince) {
          rerouteState.offRouteSince = now;
          rerouteState.offRouteSamples = 1;
        } else {
          rerouteState.offRouteSamples += 1;
        }
        // Recalculate only after persistent deviation, unless GPS places the driver far away.
        if (snapped.distance > 220 || (rerouteState.offRouteSamples >= 3 && now - rerouteState.offRouteSince >= 2500)) {
          rerouteFromCurrentLocation(origin);
        }
        if (Number.isFinite(origin.heading) && (origin.speedMps || 0) > 3 && mapRef.current) {
          const previousHeading = lastAppliedNavigationHeadingRef.current;
          const smoothedHeading = smoothHeading(previousHeading, origin.heading, 0.24);
          if (previousHeading === null || angleDifferenceDegrees(smoothedHeading, previousHeading) >= 3) {
            setMapHeadingUp(mapRef.current, smoothedHeading, { ease: 0.32, deadzone: 1.5 });
            lastAppliedNavigationHeadingRef.current = smoothedHeading;
          }
        }
        const icon = L.divIcon({ className: "moy-user-icon", html: '<span class="moy-user-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
        L.marker(point, { icon, zIndexOffset: 2000 }).addTo(group);
      }
    } else {
      setNextInstruction(null);
      const icon = L.divIcon({ className: "moy-user-icon", html: '<span class="moy-user-dot"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      L.marker(point, { icon, zIndexOffset: 1000 }).addTo(group);
    }
  }, [leafletReady, origin?.lat, origin?.lng, origin?.heading, origin?.speedMps, navigating, route]);


  useEffect(() => {
    if (!leafletReady) return;
    let cancelled = false;
    let controller = null;

    const refreshPublicCameraCatalog = async () => {
      if (cancelled || Date.now() - publicCameraCatalogRef.current.fetchedAt < 30 * 60 * 1000) return;
      controller = new AbortController();
      try {
        // Proxy through our own API to avoid browser CORS failures and reuse the server-side cache.
        const collection = await fetchRoadDataFromServer("cameras", {}, controller.signal);
        const items = (Array.isArray(collection?.elements) ? collection.elements : [])
          .map(camera => {
            const lat = Number(camera?.lat);
            const lng = Number(camera?.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 40 || lat > 56 || lng < 45 || lng > 90) return null;
            const tags = camera?.tags || {};
            return {
              id: String(camera.id || ("qazgeo-" + lat.toFixed(6) + "-" + lng.toFixed(6))),
              kind: "camera",
              title: String(tags.name || "Публичная камера"),
              shortLabel: "К",
              lat,
              lng,
              catalogSource: "qazgeo",
              tags: {
                name: String(tags.name || "Публичная камера"),
                source_url: String(tags.source_url || ""),
                source: "qazgeo",
              },
            };
          })
          .filter(Boolean);
        if (cancelled || controller.signal.aborted) return;
        publicCameraCatalogRef.current = { items, fetchedAt: Date.now() };
        setRoadDataDiagnostics(previous => ({
          ...(previous || {}),
          cameraStatus: "ok",
          cameraCatalogCount: items.length,
          cameraError: "",
        }));
        setCameraCatalogRevision(value => value + 1);
      } catch (error) {
        const message = String(error?.message || "Camera catalogue request failed");
        console.warn("[Astana Guide] Public camera catalogue unavailable", { message });
        setRoadDataDiagnostics(previous => ({
          ...(previous || {}),
          cameraStatus: "error",
          cameraError: message,
        }));
        // Optional public camera catalogue; OSM objects must continue to work if it is unavailable.
      }
    };

    void refreshPublicCameraCatalog();
    const interval = window.setInterval(() => {
      // Retry the catalogue more promptly after a temporary external-source failure.
      publicCameraCatalogRef.current.fetchedAt = 0;
      void refreshPublicCameraCatalog();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      controller?.abort();
    };
  }, []);

  useEffect(() => {
    if (!leafletReady || !roadScanLayerRef.current || !window.L) return;
    let cancelled = false;
    const loadSavedRoadScanMarkers = async () => {
      try {
        let observations = [];
        let privateCoordinates = [];
        try {
          const data = await getRoadScanData();
          observations = Array.isArray(data.observations) ? data.observations : [];
        } catch {}
        if (window.AstanaScanner && typeof window.AstanaScanner.getStatus === "function") {
          try {
            const native = JSON.parse(window.AstanaScanner.getStatus() || "{}");
            const merged = new Map(observations.map(item => [String(item.id || item.source_id), item]));
            if (Array.isArray(native.observations)) {
              for (const item of native.observations) {
                merged.set(String(item.id), {
                  ...item,
                  accuracy: Number(item.accuracy),
                  source: "android-foreground-camera",
                });
              }
            }
            if (Array.isArray(native.screenScanEvidence)) {
              const localEvidence = native.screenScanEvidence;
              // Rescue retained local coordinates through this same-origin API. This avoids
              // relying on the scanner's old direct Supabase Authorization header.
              const uploadable = localEvidence.filter((item) => {
                const id = String(item?.source_id || item?.sourceId || item?.id || "");
                const kind = String(item?.kind || "");
                const observedLat = Number(item?.observedLat ?? item?.observed_lat);
                const observedLng = Number(item?.observedLng ?? item?.observed_lng);
                const estimateLatValue = item?.estimatedLat ?? item?.estimated_lat;
                const estimateLngValue = item?.estimatedLng ?? item?.estimated_lng;
                const estimatedLat = estimateLatValue == null ? null : Number(estimateLatValue);
                const estimatedLng = estimateLngValue == null ? null : Number(estimateLngValue);
                const distanceValue = item?.distanceAheadM ?? item?.distance_ahead_m;
                const distanceAheadM = distanceValue == null ? null : Number(distanceValue);
                const coordinateMethod = String(item?.coordinateMethod || item?.coordinate_method || "");
                const accuracy = Number(item?.accuracy ?? item?.accuracy_m);
                const isVehicleGpsOnly = coordinateMethod === "vehicle-gps-only" ||
                  (distanceAheadM == null && estimatedLat != null && estimatedLng != null &&
                    Number.isFinite(observedLat) && Number.isFinite(observedLng) &&
                    Math.abs(estimatedLat - observedLat) < 0.0000001 &&
                    Math.abs(estimatedLng - observedLng) < 0.0000001);
                const hasEstimatedObjectLocation = !isVehicleGpsOnly &&
                  Number.isFinite(estimatedLat) && estimatedLat >= 47 && estimatedLat <= 55 &&
                  Number.isFinite(estimatedLng) && estimatedLng >= 65 && estimatedLng <= 77;
                return id.length >= 8
                  && !roadScanUploadedEvidenceRef.current.has(id)
                  && item?.syncStatus !== "synced"
                  && ["speed-camera", "traffic-light", "speed-limit", "roadwork", "road-hazard"].includes(kind)
                  && Number.isFinite(observedLat) && observedLat >= 47 && observedLat <= 55
                  && Number.isFinite(observedLng) && observedLng >= 65 && observedLng <= 77
                  && (isVehicleGpsOnly || hasEstimatedObjectLocation)
                  && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 150;
              });
              for (let offset = 0; offset < uploadable.length; offset += 30) {
                const batch = uploadable.slice(offset, offset + 30);
                const ids = batch.map((item) => String(item.source_id || item.sourceId || item.id));
                void fetch("/api/road-screen-evidence", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Accept: "application/json" },
                  body: JSON.stringify({ observations: batch }),
                  cache: "no-store",
                }).then(async (response) => {
                  if (response.ok) {
                    const result = await response.json();
                    if (result?.ok) {
                      const acceptedIds = Array.isArray(result.sourceIds) ? result.sourceIds.map(String) : ids;
                      acceptedIds.forEach((id) => roadScanUploadedEvidenceRef.current.add(id));
                      roadScanUploadedEvidenceCountRef.current += Number(result.accepted || acceptedIds.length);
                      setScreenScanCloudStatus(
                        "Локальные координаты переданы на сервер: " + roadScanUploadedEvidenceCountRef.current
                      );
                    }
                  } else if (response.status === 400) {
                    // A rejected batch is not useful to retry every minute.
                    ids.forEach((id) => roadScanUploadedEvidenceRef.current.add(id));
                  }
                }).catch(() => {
                  // Transient network/server failures are retried on the next map refresh.
                });
              }
              for (const item of localEvidence) {
                merged.set(String(item.id || item.source_id), {
                  ...item,
                  lat: item.estimatedLat == null ? null : Number(item.estimatedLat),
                  lng: item.estimatedLng == null ? null : Number(item.estimatedLng),
                  source: "screen-evidence",
                });
              }
            }
            observations = Array.from(merged.values());
          } catch {}
        }
        // Fetch shared AI detections from camera scanning.
        try {
          const response = await fetch("/api/road-observations?limit=1500", {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (response.ok) {
            const payload = await response.json();
            const cloudItems = Array.isArray(payload?.observations) ? payload.observations : [];
            const merged = new Map(observations.map(item => [String(item.id || item.source_id), item]));
            for (const item of cloudItems) merged.set(String(item.id || item.source_id), item);
            observations = Array.from(merged.values());
          }
        } catch (error) {
          console.warn("[Astana Guide] Shared road observations unavailable", error);
        }
        // Read screen OCR evidence too. Only distance-based approximate locations become pins.
        try {
          const response = await fetch("/api/road-screen-evidence?limit=800", {
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (response.ok) {
            const payload = await response.json();
            const items = Array.isArray(payload?.observations) ? payload.observations : [];
            privateCoordinates = items;
            const merged = new Map(observations.map(item => [String(item.id || item.source_id), item]));
            for (const item of items) {
              merged.set(String(item.id || item.source_id), {
                ...item,
                lat: item.estimatedLat == null ? null : Number(item.estimatedLat),
                lng: item.estimatedLng == null ? null : Number(item.estimatedLng),
                source: "screen-evidence",
              });
            }
            observations = Array.from(merged.values());
          }
        } catch (error) {
          console.warn("[Astana Guide] Shared screen evidence unavailable", error);
        }
        if (cancelled || !roadScanLayerRef.current) return;

        // Keep verified/private database coordinates in a shared collection too.
        // The 3D map covers the Leaflet canvas, so markers drawn only in the
        // Leaflet road-scan layer are invisible while the 3D mode is active.
        privateRoadObjectsRef.current = privateCoordinates.map(item => {
          const rawKind = String(item?.kind || "");
          const kind = rawKind === "speed-camera" || rawKind === "surveillance-camera"
            ? "camera"
            : rawKind === "speed-limit"
              ? "speed-sign"
              : rawKind === "road-hazard"
                ? "hazard"
                : rawKind;
          const lat = Number(item?.estimatedLat ?? item?.lat ?? item?.observedLat);
          const lng = Number(item?.estimatedLng ?? item?.lng ?? item?.observedLng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
              lat < 47 || lat > 55 || lng < 65 || lng > 77) return null;
          const label = String(item?.label || item?.sourceText || "");
          const typeLabels = {
            "speed-camera": "Камера контроля скорости",
            "surveillance-camera": "Камера видеонаблюдения",
            "traffic-light": "Светофор",
            "speed-limit": "Знак ограничения скорости",
            "traffic-sign": "Дорожный знак",
            "stop-sign": "Знак STOP",
            "give-way-sign": "Знак «Уступи дорогу»",
            "pedestrian-crossing": "Пешеходный переход",
            "no-stopping": "Остановка запрещена",
            "no-parking": "Стоянка запрещена",
            "parking": "Парковка",
            "roadwork": "Дорожные работы",
            "road-hazard": "Дорожная опасность",
          };
          return {
            id: String(item?.id || item?.source_id || "private-road-object"),
            kind,
            manualRoadObject: item.manual === true,
            coordinateMethod: item.coordinateMethod || item.coordinate_method || "",
            detectionMethod: item.detectionMethod || item.detection_method || "",
            observedLat: item.observedLat ?? item.observed_lat ?? null,
            observedLng: item.observedLng ?? item.observed_lng ?? null,
            distanceAheadM: item.distanceAheadM ?? item.distance_ahead_m ?? null,
            reviewStatus: item.reviewStatus || item.review_status || "needs-review",
            title: typeLabels[rawKind] || label || roadObjectTitle(kind),
            shortLabel: roadObjectShortLabel(kind),
            lat,
            lng,
            speedLimit: item?.speedLimit == null ? null : Number(item.speedLimit),
            tags: { source: "astana-gid-private", review_status: item?.reviewStatus || "needs-review" },
            catalogSource: "",
            privateRoadObject: true,
            manualRoadObject: item?.manual === true,
            coordinateMethod: item?.coordinateMethod || item?.coordinate_method || "",
            detectionMethod: item?.detectionMethod || item?.detection_method || "",
            observedLat: item?.observedLat ?? item?.observed_lat ?? null,
            observedLng: item?.observedLng ?? item?.observed_lng ?? null,
            distanceAheadM: item?.distanceAheadM ?? item?.distance_ahead_m ?? null,
            privateReviewStatus: item?.reviewStatus || "needs-review",
          };
        }).filter(Boolean);

        roadObjectsRef.current = [
          ...(roadObjectsRef.current || []).filter(item => !item.privateRoadObject),
          ...privateRoadObjectsRef.current,
        ];
        setRoadObjectsRevision(value => value + 1);

        const group = roadScanLayerRef.current;
        const L = window.L;
        group.clearLayers();
        for (const item of observations) {
          const screenEvidence = item.source === "screen-evidence";
          if (screenEvidence && (item.estimatedLat == null || item.estimatedLng == null)) continue;
          if (screenEvidence && !isRoadObjectCoordinateUsable({
            ...item,
            lat: Number(item.estimatedLat),
            lng: Number(item.estimatedLng),
          })) continue;
          const lat = Number(screenEvidence ? item.estimatedLat : item.lat);
          const lng = Number(screenEvidence ? item.estimatedLng : item.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const screenKinds = {
            "speed-camera": { label: "Камера контроля скорости", icon: "📷" },
            "surveillance-camera": { label: "Камера видеонаблюдения", icon: "🎥" },
            "traffic-light": { label: "Светофор", icon: "🚦" },
            "speed-limit": { label: "Знак ограничения скорости", icon: "🔵" },
            "traffic-sign": { label: "Дорожный знак", icon: "🛑" },
            "stop-sign": { label: "Знак STOP", icon: "🛑" },
            "give-way-sign": { label: "Знак «Уступи дорогу»", icon: "🔻" },
            "pedestrian-crossing": { label: "Пешеходный переход", icon: "🚸" },
            "no-stopping": { label: "Знак «Остановка запрещена»", icon: "⛔" },
            "no-parking": { label: "Знак «Стоянка запрещена»", icon: "🚫" },
            "parking": { label: "Парковка", icon: "🅿️" },
            "roadwork": { label: "Дорожные работы", icon: "🚧" },
            "road-hazard": { label: "Дорожная опасность", icon: "⚠️" },
          };
          const kind = screenEvidence
            ? (screenKinds[item.kind] || { label: "Подсказка с экрана", icon: "📍" })
            : (ROAD_SCAN_KINDS.find(option => option.value === item.kind) || ROAD_SCAN_KINDS[ROAD_SCAN_KINDS.length - 1]);
          const icon = L.divIcon({
            className: "astana-road-scan-map-icon" + (screenEvidence ? " astana-road-scan-screen-icon" : ""),
            html: '<span>' + escapeHtml(kind.icon) + '</span>',
            iconSize: [38, 38],
            iconAnchor: [19, 19],
          });
          const marker = L.marker([lat, lng], { icon, zIndexOffset: 2600 });
          const when = new Date(item.capturedAt).toLocaleString("ru-RU");
          const accuracy = Number.isFinite(Number(item.accuracy)) ? Math.round(Number(item.accuracy)) + " м" : "неизвестна";
          const aiDetected = item.source === "android-ai-detection";
          const confidence = Number(item.confidence);
          const confidenceLine = !item.manual && Number.isFinite(confidence) && (aiDetected || screenEvidence)
            ? '<div>Уверенность распознавания: ' + escapeHtml(Math.round(confidence * 100)) + '%</div>'
            : '';
          const iconEvidence = screenEvidence && (
            item.detectionMethod === "icon-heuristic" ||
            String(item.sourceText || "").toLowerCase().includes("near vehicle marker")
          );
          const travelHeading = Number(item.travelHeadingDegrees ?? item.directionDegrees);
          const directionLine = screenEvidence && Number.isFinite(travelHeading) && travelHeading >= 0 && travelHeading <= 359
            ? '<div>Направление движения при обнаружении: примерно ' + escapeHtml(Math.round(travelHeading)) + '°</div>'
            : '';
          const observationCount = Number(item.observationCount);
          const observationLine = screenEvidence && Number.isFinite(observationCount) && observationCount > 0
            ? '<div>Наблюдений по этому месту: ' + escapeHtml(observationCount) + '</div>'
            : '';
          const sourceLabel = item.manual
            ? "Ручная отметка владельца личной базы"
            : screenEvidence
              ? (iconEvidence ? "Графический значок в интерфейсе навигации" : "Текстовое предупреждение на экране Яндекс/2ГИС")
              : aiDetected ? "Автоматически распознано ИИ на телефоне" : "Отметка с камеры телефона";
          const evidenceText = screenEvidence && item.sourceText
            ? '<div>Текст: ' + escapeHtml(item.sourceText) + '</div>'
            : '';
          const popup = '<div class="astana-road-scan-popup"><b>' + escapeHtml(kind.label) +
            '</b><div>' + escapeHtml(sourceLabel) + '</div>' + evidenceText + confidenceLine + directionLine + observationLine +
            (item.manual
              ? '<div>Точка внесена вручную и хранится в личной базе</div>'
              : screenEvidence
                ? (iconEvidence
                  ? '<div>Графический значок приблизился к маркеру автомобиля; координаты по GPS приблизительные</div>'
                  : '<div>Положение рассчитано примерно по GPS и расстоянию</div>')
                : '<div>GPS: ±' + escapeHtml(accuracy) + '</div>') +
            '<small>' + escapeHtml(when) + '</small><p>' +
            (item.manual
              ? 'Объект добавлен вручную в закрытую базу. Если координаты неточные, перемести или добавь правильную точку.'
              : screenEvidence
                ? 'Это приблизительная отметка, полученная с экрана навигации. Она требует ручной проверки и не является подтверждённым объектом.'
                : 'Это предварительная отметка сканера. Она сохранена локально и не является подтверждённым дорожным объектом.') +
            '</p></div>';
          marker.bindPopup(popup).addTo(group);
        }
      } catch (error) {
        console.warn("[Astana Guide] Could not load local road scan markers", error);
      }
    };
    void loadSavedRoadScanMarkers();
    return () => { cancelled = true; };
  }, [leafletReady, roadScanRevision]);

  useEffect(() => {
    if (!leafletReady) return;
    const interval = window.setInterval(() => {
      setRoadScanRevision(value => value + 1);
    }, 60000);
    return () => window.clearInterval(interval);
  }, [leafletReady]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || !roadObjectsLayerRef.current) return;

    let disposed = false;
    const requestState = { inFlight: false, controller: null, lastRequestAt: 0 };
    roadObjectsRequestRef.current.controller?.abort();
    roadObjectsRequestRef.current = requestState;

    const lookupAndDraw = async () => {
      if (disposed || requestState.inFlight || Date.now() - requestState.lastRequestAt < (navigating ? 90000 : 300000)) return;

      const currentRoutePoints = route?.geometry?.length
        ? route.geometry.map(point => [point[1], point[0]])
        : [];
      const currentProgress = navigating && routeProgressRef.current >= 0 ? routeProgressRef.current : 0;
      const livePosition = positionRef.current || origin;
      const mapCenter = mapRef.current?.getCenter?.();
      const anchor = navigating && livePosition && Number.isFinite(livePosition.lat) && Number.isFinite(livePosition.lng)
        ? [livePosition.lat, livePosition.lng]
        : mapCenter ? [mapCenter.lat, mapCenter.lng]
        : livePosition && Number.isFinite(livePosition.lat) && Number.isFinite(livePosition.lng)
          ? [livePosition.lat, livePosition.lng]
          : ASTANA;

      // Load road data through the same-origin cached API, not directly from the phone.
      // More route samples keep the lookup corridor following bends and intersections.
      const routeQueryPoints = currentRoutePoints.length > 1
        ? sampleRouteForRoadObjects(currentRoutePoints, currentProgress, 4200, 4)
        : [anchor];
      const radius = currentRoutePoints.length > 1 ? 240 : 1500;

      const controller = new AbortController();
      requestState.inFlight = true;
      requestState.lastRequestAt = Date.now();
      requestState.controller = controller;

      try {
        const data = await fetchRoadDataFromServer("objects", {
          points: routeQueryPoints,
          radius,
        }, controller.signal);
        if (disposed || controller.signal.aborted || roadObjectsRequestRef.current !== requestState) return;

        console.info("[Astana Guide] Road-data source response", {
          source: data.source || "unknown",
          count: Number(data.count ?? data.elements?.length ?? 0),
          diagnostics: data.diagnostics || null,
          partial: Boolean(data.partial),
        });
        setRoadDataDiagnostics(previous => ({
          ...(previous || {}),
          roadStatus: "ok",
          source: String(data.source || "Источник не указан"),
          responseCount: Number(data.count ?? data.elements?.length ?? 0),
          sourceCounts: data.diagnostics || null,
          partial: Boolean(data.partial),
          partialReason: String(data.partialReason || ""),
          fetchedAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          roadError: "",
        }));

        const unique = new Map();
        for (const element of data.elements || []) {
          const kind = roadObjectKind(element);
          const lat = Number(element.lat ?? element.center?.lat);
          const lng = Number(element.lon ?? element.center?.lon);
          if (!kind || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          // The faster bbox query may return objects beside the selected road.
          // Keep only markers near the map center or the active route corridor.
          if (currentRoutePoints.length > 1) {
            const snapped = snapToRoute({ lat, lng }, currentRoutePoints);
            const metersAhead = snapped.progress >= currentProgress
              ? routeDistanceBetweenProgress(currentRoutePoints, currentProgress, snapped.progress)
              : -1;
            const lateralLimit = kind === "camera" ? 18 : kind === "traffic-light" ? 28 : kind === "speed-sign" ? 22 : 320;
            if (!Number.isFinite(snapped.distance) || snapped.distance > lateralLimit || metersAhead < 0 || metersAhead > 4800) continue;
          } else {
            const center = mapCenter ? [mapCenter.lat, mapCenter.lng] : anchor;
            // City geoportal layers may return objects up to ~2.25 km from the map center.
            if (distanceBetween(center, [lat, lng]) > 2400) continue;
          }

          const tags = element.tags || {};
          const id = `${element.type || "node"}-${element.id ?? `${lat.toFixed(6)},${lng.toFixed(6)}`}`;
          if (!unique.has(id)) {
            unique.set(id, {
              id,
              kind,
              title: tags.source_layer === "underpasses"
                ? "Подземный пешеходный переход"
                : kind === "traffic-sign"
                  ? "Дорожный знак " + String(tags.traffic_sign || tags["traffic_sign:forward"] || tags["traffic_sign:backward"] || tags["traffic_sign:maxspeed"] || "").slice(0, 80)
                  : roadObjectTitle(kind),
              shortLabel: roadObjectShortLabel(kind),
              speedLimit: kind === "speed-sign" ? postedSpeedFromTags(tags) : null,
              lat,
              lng,
              tags,
              catalogSource: tags.source === "astana-gis" ? "astana-gis" : "",
            });
          }
        }

        // Merge source-linked public camera locations only near the visible area or route.
        // The optional external catalogue can fail without affecting the OSM-backed map.
        const catalogItems = publicCameraCatalogRef.current.items || [];
        for (const item of catalogItems) {
          let isNearMap = false;
          if (currentRoutePoints.length > 1) {
            const snapped = snapToRoute(item, currentRoutePoints);
            if (Number.isFinite(snapped.distance) && snapped.distance <= 350) {
              const metersAhead = snapped.progress >= currentProgress
                ? routeDistanceBetweenProgress(currentRoutePoints, currentProgress, snapped.progress)
                : -1;
              isNearMap = metersAhead >= 0 && metersAhead <= 7500;
            }
          } else if (mapCenter) {
            isNearMap = distanceBetween([mapCenter.lat, mapCenter.lng], [item.lat, item.lng]) <= 4500;
          } else if (livePosition) {
            isNearMap = distanceBetween([livePosition.lat, livePosition.lng], [item.lat, item.lng]) <= 4500;
          }
          if (!isNearMap) continue;
          const duplicate = Array.from(unique.values()).some(existing =>
            existing.kind === "camera" &&
            distanceBetween([existing.lat, existing.lng], [item.lat, item.lng]) < 5
          );
          if (!duplicate) unique.set(item.id, item);
        }

        const deduplicatedObjects = [];
        for (const item of unique.values()) {
          const duplicateIndex = item.kind === "parking"
            ? deduplicatedObjects.findIndex(existing =>
                existing.kind === "parking" &&
                distanceBetween([existing.lat, existing.lng], [item.lat, item.lng]) < 30
              )
            : -1;
          if (duplicateIndex < 0) deduplicatedObjects.push(item);
          else if (item.tags?.source === "astana-gis") deduplicatedObjects[duplicateIndex] = item;
        }
        const objects = deduplicatedObjects;
        roadObjectsRef.current = [...objects, ...(privateRoadObjectsRef.current || [])];
        const mappedByKind = {};
        for (const item of objects) mappedByKind[item.kind] = (mappedByKind[item.kind] || 0) + 1;
        setRoadDataDiagnostics(previous => ({
          ...(previous || {}),
          mappedCount: objects.length,
          byKind: mappedByKind,
        }));
        const group = roadObjectsLayerRef.current;
        if (!group) return;
        group.clearLayers();

        const L = window.L;
        for (const item of objects) {
          const isSignal = item.kind === "traffic-light";
          const isCamera = item.kind === "camera";
          const isSpeedSign = item.kind === "speed-sign";
          const isParking = item.kind === "parking";
          const isCrossing = item.kind === "pedestrian-crossing";
          const isEvent = ["roadwork", "closure", "hazard"].includes(item.kind);
          const title = item.title || roadObjectTitle(item.kind);
          const icon = L.divIcon({
            className: "moy-road-object-icon",
            html: roadObjectIconHtml(item.kind, item.speedLimit),
            iconSize: isCamera ? [42, 42] : isSignal ? [32, 46] : isSpeedSign || isParking || isCrossing ? [42, 42] : [38, 38],
            iconAnchor: isCamera ? [21, 21] : isSignal ? [16, 23] : isSpeedSign || isParking || isCrossing ? [21, 21] : [19, 19],
          });
          const marker = L.marker([item.lat, item.lng], {
            icon,
            title,
            keyboard: false,
            zIndexOffset: 2400,
          });
          const mappedLimit = postedSpeedFromTags(item.tags) ?? parseSpeedLimitValue(item.tags.maxspeed);
          const detailParts = [];
          if (mappedLimit) detailParts.push('<div class="moy-road-object-popup-limit">Ограничение: ' + mappedLimit + ' км/ч</div>');
          const description = item.tags.description || item.tags["description:ru"] || item.tags.note || item.tags["note:ru"] || item.tags.construction || item.tags.hazard;
          if (description) detailParts.push('<div>' + escapeHtml(String(description).slice(0, 220)) + '</div>');
          if (item.catalogSource === "astana-gis" && item.tags?.source_layer === "underpasses") {
            detailParts.push('<small>Источник: открытый геопортал города Астаны. Это отмеченный на карте подземный пешеходный переход.</small>');
          } else if (item.catalogSource === "astana-gis") {
            detailParts.push('<small>Источник: открытый геопортал города Астаны. Отметка показывает расположение парковки, а не наличие свободных мест.</small>');
          }
          if (item.catalogSource === "qazgeo") {
            detailParts.push('<small>Источник: публичный каталог QazGeo. Это ссылка на источник, а не видеопоток в реальном времени.</small>');
            const sourceUrl = String(item.tags.source_url || "");
            if (/^https:\/\/[^\s"'<>]+$/i.test(sourceUrl)) {
              detailParts.push('<a href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Открыть источник камеры</a>');
            }
          }
          if (isEvent) detailParts.push('<small class="moy-road-object-popup-caveat">Отметка OpenStreetMap; это не подтверждение текущего перекрытия или активных работ.</small>');
          marker.bindPopup('<div class="moy-road-object-popup"><b>' + escapeHtml(title) + '</b>' + detailParts.join("") + '</div>');
          marker.addTo(group);
        }
        setRoadObjectsRevision(value => value + 1);
      } catch (error) {
        const message = String(error?.message || "Road-data request failed");
        console.warn("[Astana Guide] Road-data request failed", { message });
        setRoadDataDiagnostics(previous => ({
          ...(previous || {}),
          roadStatus: "error",
          roadError: message,
          fetchedAt: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        }));
        // Keep already-loaded objects visible when Overpass is temporarily unavailable.
      } finally {
        if (roadObjectsRequestRef.current === requestState) {
          requestState.inFlight = false;
          requestState.controller = null;
        }
      }
    };

    void lookupAndDraw();
    const interval = window.setInterval(() => { void lookupAndDraw(); }, navigating ? 90000 : 300000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      requestState.controller?.abort();
      if (roadObjectsRequestRef.current === requestState) {
        roadObjectsRequestRef.current = { inFlight: false, controller: null, lastRequestAt: 0 };
      }
    };
  }, [leafletReady, navigating, route?.id, cameraCatalogRevision]);

  useEffect(() => {
    if (!navigating || !voiceGuidanceEnabled || !nextInstruction || !Number.isFinite(nextInstruction.distanceMeters)) return;
    const instruction = nextInstruction;
    const distanceMeters = Math.max(0, instruction.distanceMeters);
    const currentKey = instruction.maneuverKey || "route";
    let state = voiceAnnouncementRef.current;
    if (state.key !== currentKey) {
      state = { key: currentKey, lastDistance: null, announced: new Set(), initialAnnounced: false };
    }
    let phrase = "";
    if (!state.initialAnnounced) {
      state.initialAnnounced = true;
      if (distanceMeters >= 5000) phrase = `Езжайте прямо ${voiceDistanceText(distanceMeters, true)}.`;
      else if (distanceMeters > 0) phrase = `Через ${voiceDistanceText(distanceMeters)} ${voiceManeuverText(instruction)}`;
      else phrase = voiceManeuverText(instruction);
    } else {
      const thresholds = [1000, 500, 300, 100];
      const crossed = thresholds.find(threshold =>
        state.lastDistance !== null &&
        state.lastDistance > threshold &&
        distanceMeters <= threshold &&
        !state.announced.has(threshold)
      );
      if (crossed !== undefined) {
        state.announced.add(crossed);
        phrase = `Через ${voiceDistanceText(crossed)} ${voiceManeuverText(instruction)}`;
      }
    }
    state.lastDistance = distanceMeters;
    voiceAnnouncementRef.current = state;
    if (phrase) speakRoutePrompt(phrase);
  }, [navigating, voiceGuidanceEnabled, nextInstruction?.maneuverKey, nextInstruction?.distanceMeters, nextInstruction?.maneuverType, nextInstruction?.modifier, nextInstruction?.exit, nextInstruction?.laneRight]);

  useEffect(() => {
    if (!navigating || !route?.geometry?.length || !origin) {
      setUpcomingCamera(null);
      return;
    }
    const points = routePointsRef.current.length > 1
      ? routePointsRef.current
      : route.geometry.map(point => [point[1], point[0]]);
    if (points.length < 2) {
      setUpcomingCamera(null);
      return;
    }
    const progress = routeProgressRef.current;
    let nearest = null;
    for (const item of roadObjectsRef.current) {
      if (!isRoadObjectCoordinateUsable(item)) continue;
      if (item.kind !== "camera") continue;
      const snapped = snapToRoute({ lat: item.lat, lng: item.lng }, points);
      if (!Number.isFinite(snapped.distance) || snapped.distance > 18) continue;
      if (progress >= 0 && snapped.progress < progress - 0.1) continue;
      const meters = routeDistanceBetweenProgress(points, Math.max(0, progress), snapped.progress);
      if (meters < 0 || meters > 1500) continue;
      if (!nearest || meters < nearest.meters) nearest = { id: item.id, title: item.title, meters };
    }
    setUpcomingCamera(current => {
      if (!nearest) return current === null ? null : null;
      if (current?.id === nearest.id && Math.abs(current.meters - nearest.meters) < 20) return current;
      return nearest;
    });
  }, [navigating, origin?.lat, origin?.lng, route?.id, roadObjectsRevision, navigationClock]);

  useEffect(() => {
    if (!navigating || !voiceGuidanceEnabled || !route?.geometry?.length || !origin) return;

    const routeId = route.id || null;
    if (cameraWarningRef.current.routeId !== routeId) {
      cameraWarningRef.current = { routeId, announced: new Set() };
    }
    const points = routePointsRef.current.length > 1
      ? routePointsRef.current
      : route.geometry.map(point => [point[1], point[0]]);
    if (points.length < 2 || routeProgressRef.current < 0) return;

    let nearest = null;
    for (const item of roadObjectsRef.current) {
      if (!isRoadObjectCoordinateUsable(item)) continue;
      if (item.kind !== "camera" || cameraWarningRef.current.announced.has(item.id)) continue;
      const snapped = snapToRoute({ lat: item.lat, lng: item.lng }, points);
      if (!Number.isFinite(snapped.distance) || snapped.distance > 18) continue;
      if (snapped.progress < routeProgressRef.current - 0.1) continue;
      const meters = routeDistanceBetweenProgress(points, routeProgressRef.current, snapped.progress);
      if (meters < 0 || meters > 850) continue;
      if (!nearest || meters < nearest.meters) nearest = { item, meters };
    }
    if (!nearest) return;

    cameraWarningRef.current.announced.add(nearest.item.id);
    const isSpeedCamera = isSpeedEnforcementCamera(nearest.item.tags || {});
    const cameraLimit = isSpeedCamera
      ? parseSpeedLimitValue(nearest.item.tags?.maxspeed)
      : null;
    const limitText = cameraLimit ? ` Ограничение ${cameraLimit} километров в час.` : "";
    const cameraPhrase = isSpeedCamera
      ? "Впереди камера контроля скорости."
      : "Впереди камера дорожного наблюдения.";
    speakRoutePrompt(`${cameraPhrase}${limitText} Через ${voiceDistanceText(nearest.meters)}.`);
  }, [navigating, voiceGuidanceEnabled, origin?.lat, origin?.lng, route, speedLimit, roadObjectsRevision]);

  useEffect(() => {
    if (!navigating || !voiceGuidanceEnabled || !route?.geometry?.length || !origin) return;
    const routeId = route.id || null;
    let warningState = roadObjectWarningRef.current;
    if (warningState.routeId !== routeId) {
      warningState = { routeId, announced: new Set() };
      roadObjectWarningRef.current = warningState;
    }

    const points = routePointsRef.current.length > 1
      ? routePointsRef.current
      : route.geometry.map(point => [point[1], point[0]]);
    if (points.length < 2 || routeProgressRef.current < 0) return;

    let nearest = null;
    for (const item of roadObjectsRef.current) {
      if (!isRoadObjectCoordinateUsable(item)) continue;
      if (warningState.announced.has(item.id)) continue;
      let phrase = "";
      if (item.kind === "traffic-light") phrase = "Впереди светофор";
      else if (item.kind === "traffic-sign") phrase = "Впереди дорожный знак";
      else if (item.kind === "pedestrian-crossing") phrase = "Впереди пешеходный переход";
      else if (item.kind === "stop-sign") phrase = "Впереди знак СТОП";
      else if (item.kind === "give-way-sign") phrase = "Впереди знак «Уступите дорогу»";
      else if (item.kind === "no-stopping") phrase = "Впереди знак «Остановка запрещена»";
      else if (item.kind === "no-parking") phrase = "Впереди знак «Стоянка запрещена»";
      else if (item.kind === "speed-sign" && Number.isFinite(Number(item.speedLimit)) && Number(item.speedLimit) > 0) {
        phrase = "Впереди ограничение скорости " + Math.round(Number(item.speedLimit)) + " километров в час";
      }
      if (!phrase) continue;

      const snapped = snapToRoute({ lat: item.lat, lng: item.lng }, points);
      const lateralLimit = item.kind === "traffic-light" ? 28 : item.kind === "speed-sign" ? 22 : 18;
      if (!Number.isFinite(snapped.distance) || snapped.distance > lateralLimit) continue;
      if (snapped.progress < routeProgressRef.current - 0.1) continue;
      const meters = routeDistanceBetweenProgress(points, routeProgressRef.current, snapped.progress);
      if (meters < 25 || meters > 450) continue;
      if (!nearest || meters < nearest.meters) nearest = { item, meters, phrase };
    }

    if (nearest) {
      warningState.announced.add(nearest.item.id);
      speakRoutePrompt(nearest.phrase + ". Через " + voiceDistanceText(nearest.meters) + ".");
    }
  }, [navigating, voiceGuidanceEnabled, origin?.lat, origin?.lng, route, roadObjectsRevision, navigationClock]);

  useEffect(() => {
    if (!navigating || !route?.geometry?.length) {
      speedLimitRequestRef.current.controller?.abort();
      speedLimitRequestRef.current = { inFlight: false, controller: null, lastRequestAt: 0 };
      setSpeedLimit(null);
      return;
    }

    let disposed = false;
    // Do not show a guessed 60 km/h while the live road lookup is pending.
    const lookup = async () => {
      const requestState = speedLimitRequestRef.current;
      const now = Date.now();
      // Public Overpass is shared infrastructure; polling every 10 seconds limits traffic
      // while allowing the badge to follow speed-limit zones during movement.
      if (requestState.inFlight || now - requestState.lastRequestAt < 9500) return;

      const current = positionRef.current || origin;
      if (!current || !Number.isFinite(current.lat) || !Number.isFinite(current.lng)) return;

      const controller = new AbortController();
      requestState.inFlight = true;
      requestState.lastRequestAt = now;
      requestState.controller = controller;

      try {
        const lat = Number(current.lat.toFixed(6));
        const lng = Number(current.lng.toFixed(6));
        const data = await fetchRoadDataFromServer("speed", { lat, lng }, controller.signal);
        if (disposed || controller.signal.aborted) return;

        const activePoints = routePointsRef.current.length > 1
          ? routePointsRef.current
          : route.geometry.map(point => [point[1], point[0]]);
        let limit = findSpeedLimitForRoute(current, activePoints, data.elements || []);

        // A physically mapped speed sign near the current road is more specific than
        // a road's generic maxspeed zone tag. Use only a numeric sign found in map data.
        let nearestSign = null;
        for (const item of roadObjectsRef.current) {
          if (!isRoadObjectCoordinateUsable(item)) continue;
          if (item.kind !== "speed-sign" || !Number.isFinite(Number(item.speedLimit))) continue;
          const distance = distanceBetween([current.lat, current.lng], [item.lat, item.lng]);
          if (distance > 55) continue;
          const routeSnap = activePoints.length > 1 ? snapToRoute(item, activePoints) : null;
          if (routeSnap && (!Number.isFinite(routeSnap.distance) || routeSnap.distance > 35)) continue;
          if (!nearestSign || distance < nearestSign.distance) nearestSign = { item, distance };
        }
        if (nearestSign) limit = Number(nearestSign.item.speedLimit);

        // A successful lookup with no matched, tagged road/sign means there is no reliable
        // posted value available for this segment. A transient API failure keeps the last value.
        setSpeedLimit(limit);
      } catch {
        // Preserve the latest valid value on transient network or Overpass errors.
      } finally {
        if (speedLimitRequestRef.current.controller === controller) {
          speedLimitRequestRef.current.inFlight = false;
          speedLimitRequestRef.current.controller = null;
        }
      }
    };

    void lookup();
    const interval = window.setInterval(() => { void lookup(); }, 10000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      speedLimitRequestRef.current.controller?.abort();
      speedLimitRequestRef.current = { inFlight: false, controller: null, lastRequestAt: 0 };
    };
  }, [navigating, route]);

  useEffect(() => {
    const state = speedWarningRef.current;
    if (!navigating || !voiceGuidanceEnabled || !Number.isFinite(speedLimit)) {
      state.active = false;
      state.limit = speedLimit ?? null;
      return;
    }

    // Require a small margin above the limit to avoid GPS rounding noise.
    if (speed <= speedLimit + 1) {
      state.active = false;
      state.limit = speedLimit;
      return;
    }
    if (speed < speedLimit + 4) return;

    const now = Date.now();
    const newLimit = state.limit !== speedLimit;
    if (!state.active || newLimit || now - state.lastSpokenAt >= 30000) {
      speakRoutePrompt(`Внимание! Превышение скорости. Ограничение ${speedLimit} километров в час.`);
      state.active = true;
      state.limit = speedLimit;
      state.lastSpokenAt = now;
    }
  }, [navigating, voiceGuidanceEnabled, speed, speedLimit]);

  async function rerouteFromCurrentLocation(currentPosition = origin) {
    const state = rerouteRef.current;
    const now = Date.now();
    if (!navigating || !destination || !currentPosition || state.inFlight) return;
    if (now - state.lastAttemptAt < 12000) return;
    if (currentPosition.lat == null || currentPosition.lng == null) return;

    state.inFlight = true;
    state.lastAttemptAt = now;
    try {
      const router = mode === "walk" ? ROUTERS.walk : ROUTERS.car;
      const alternatives = mode === "car" ? "&alternatives=true" : "";
      const url = `${router}/${currentPosition.lng},${currentPosition.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&annotations=true${alternatives}`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 18000);
      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("Роутер временно недоступен");
      const data = await response.json();
      if (data.code !== "Ok" || !data.routes?.length || !data.routes[0]?.geometry?.coordinates?.length) {
        throw new Error("Новый маршрут не найден");
      }
      const options = data.routes.slice(0, mode === "car" ? 3 : 1).map((item, index) => ({
        id: `reroute-${Date.now()}-${index}`,
        geometry: item.geometry.coordinates,
        distance: item.distance,
        duration: item.duration,
        steps: item.legs?.flatMap(leg => leg.steps || []) || [],
        mode,
        optionIndex: index,
      }));
      setRouteOrigin({ lat: currentPosition.lat, lng: currentPosition.lng });
      setRouteOptions(options);
      setRoute(options[0]);
      routeProgressRef.current = -1;
      rerouteRef.current.offRouteSince = 0;
      rerouteRef.current.offRouteSamples = 0;
      setNextInstruction(null);
      setError("");
      if (voiceGuidanceEnabled) speakRoutePrompt("Маршрут перестроен.");
    } catch {
      // Keep the active route and navigation visible. Retry after the cooldown if still off-route.
      rerouteRef.current.offRouteSince = Date.now();
      rerouteRef.current.offRouteSamples = 0;
    } finally {
      rerouteRef.current.inFlight = false;
    }
  }

  async function buildRoute(nextMode = mode) {
    if (!origin || !destination) {
      setError("Сначала выберите адрес назначения.");
      return;
    }
    if (nextMode === "bus") {
      setError("Маршрут на автобусе пока не подтверждён для Астаны в подключённых данных. Я не буду подменять его автомобильным маршрутом.");
      return;
    }
    setRouting(true);
    setNavigating(false);
    setNextInstruction(null);
    setError("");
    try {
      const fromPoint = routeOrigin || origin;
      if (!fromPoint) throw new Error("Не удалось определить начальную точку маршрута.");
      if (!routeOrigin) setRouteOrigin(fromPoint);
      const router = nextMode === "walk" ? ROUTERS.walk : ROUTERS.car;
      const alternatives = nextMode === "car" ? "&alternatives=true" : "";
      const url = `${router}/${fromPoint.lng},${fromPoint.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true&annotations=true${alternatives}`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 22000);
      let res;
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (e) {
        if (e?.name === "AbortError") throw new Error("Маршрутизатор долго не отвечает. Проверьте интернет и попробуйте ещё раз.");
        throw e;
      } finally {
        window.clearTimeout(timeout);
      }
      if (!res.ok) throw new Error("Маршрутизатор временно недоступен");
      const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.[0]) throw new Error("По этим точкам маршрут не найден");
      const options = data.routes.slice(0, 3).map((r, index) => ({
        id: nextMode + "-" + index + "-" + Math.round(r.distance) + "-" + Math.round(r.duration),
        geometry: r.geometry.coordinates,
        distance: r.distance,
        duration: r.duration,
        steps: r.legs?.flatMap(l => l.steps || []) || [],
        mode: nextMode,
        optionIndex: index,
      }));
      setRouteOptions(options);
      setRoute(options[0]);
      setMode(nextMode);
      setShowSteps(false);
      setNavigating(false);
      routeProgressRef.current = -1;
    } catch (e) {
      setError(e?.message || "Не удалось построить маршрут");
    } finally {
      setRouting(false);
    }
  }

  function chooseResult(item) {
    const point = { lat: Number(item.lat), lng: Number(item.lon) };
    setDestination(point);
    setRouteOrigin(null);
    setRouteOptions([]);
    setSelectedPlace(item);
    setIsFavorite(false);
    setQuery(cleanName(item));
    setResults([]);
    setShowResultsPanel(false);
    setSearchActive(false);
    setRoute(null);
    setNavigating(false);
    setNextInstruction(null);
    setError("");
    mapRef.current?.setView([point.lat, point.lng], 15);
  }

  useEffect(() => {
    if (!map3dReady || !map3dRef.current || !map3dEnabled || !map4dEnabled) return;
    const map = map3dRef.current;
    let phase = 0;

    // 4D = current GPS/route position changing over time, with a subtle pulse
    // at the real vehicle position. No fake traffic-light timings are simulated.
    const animateLivePosition = () => {
      if (!map3dRef.current || !map3dEnabledRef.current) return;
      phase += 0.14;
      const wave = (Math.sin(phase) + 1) / 2;
      try {
        if (gpsFixReady && map.getLayer("moy3d-current-position-glow")) {
          map.setPaintProperty("moy3d-current-position-glow", "circle-radius", 13 + wave * 11);
          map.setPaintProperty("moy3d-current-position-glow", "circle-opacity", 0.12 + wave * 0.32);
        }
        if (map.getLayer("moy3d-main-route-line")) {
          const zoom = map.getZoom();
          const baseWidth = zoom >= 18 ? 18 : zoom >= 15 ? 14 : 10;
          map.setPaintProperty("moy3d-main-route-line", "line-width", baseWidth + wave * 2.5);
        }
      } catch {
        // If a style is temporarily reloading, the next animation frame retries.
      }
    };

    const timer = window.setInterval(animateLivePosition, 90);
    animateLivePosition();
    return () => {
      window.clearInterval(timer);
      try {
        if (map.getLayer("moy3d-current-position-glow")) {
          map.setPaintProperty("moy3d-current-position-glow", "circle-radius", 13);
          map.setPaintProperty("moy3d-current-position-glow", "circle-opacity", 0.2);
        }
        if (map.getLayer("moy3d-main-route-line")) {
          const zoom = map.getZoom();
          map.setPaintProperty("moy3d-main-route-line", "line-width", ["interpolate", ["linear"], ["zoom"], 12, 10, 15, 14, 18, 18]);
        }
      } catch {}
    };
  }, [map3dReady, map3dEnabled, map4dEnabled, gpsFixReady]);

  function toggle4DMap() {
    if (!map3dReady || !map3dRef.current) {
      setError("3D-карта ещё загружается. Подождите, пока появятся улицы, затем включите 4D.");
      return;
    }
    if (!map3dEnabled) {
      map3dEnabledRef.current = true;
      setMap3dEnabled(true);
    }
    setMap4dEnabled(value => !value);
    setError("");
  }

  function toggle3DMap() {
    if (!map3dReady || !map3dRef.current) {
      setError("3D-карта пока не загрузилась. Обычная карта остаётся доступной.");
      return;
    }
    const enabling = !map3dEnabled;
    if (enabling) {
      const center = mapRef.current?.getCenter?.();
      const fallback = positionRef.current || origin || { lat: ASTANA[0], lng: ASTANA[1] };
      map3dRef.current.jumpTo({
        center: center ? [center.lng, center.lat] : [fallback.lng, fallback.lat],
        zoom: Math.max(15.2, Number(mapRef.current?.getZoom?.() || map3dRef.current.getZoom())),
        pitch: 52,
        bearing: 0,
      });
    } else {
      const center = map3dRef.current.getCenter();
      if (mapRef.current) {
        map3dSyncRef.current = true;
        mapRef.current.setView([center.lat, center.lng], map3dRef.current.getZoom(), { animate: false });
        requestAnimationFrame(() => { map3dSyncRef.current = false; });
      }
    }
    map3dEnabledRef.current = enabling;
    setMap3dEnabled(enabling);
    if (!enabling) setMap4dEnabled(false);
    setError("");
  }

  function swapMapType() {
    if (map3dEnabled) {
      map3dEnabledRef.current = false;
      setMap3dEnabled(false);
      setMap4dEnabled(false);
    }
    setMapType(v => v === "map" ? "satellite" : v === "satellite" ? "dark" : "map");
  }

  function toggleVoiceGuidance() {
    if (voiceGuidanceEnabled) {
      setVoiceGuidanceEnabled(false);
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof window.SpeechSynthesisUtterance !== "function") {
      setError("Голосовые подсказки не поддерживаются этим браузером.");
      return;
    }
    voiceAnnouncementRef.current = { key: null, lastDistance: null, announced: new Set(), initialAnnounced: false };
    setVoiceGuidanceEnabled(true);
    if (!navigating || !nextInstruction || !Number.isFinite(nextInstruction.distanceMeters)) {
      speakRoutePrompt("Голосовые подсказки включены.");
    }
  }

  function startNavigation(nextRoute = route) {
    const activeRoute = nextRoute || route;
    if (!activeRoute?.geometry?.length) {
      setError("Сначала построй маршрут, затем нажми «В путь».");
      return;
    }
    setRoute(activeRoute);
    if (navigationMapTypeRef.current === null) {
      navigationMapTypeRef.current = mapType;
      navigationBearingRef.current = typeof mapRef.current?.getBearing === "function" ? mapRef.current.getBearing() : 0;
    }
    setShowSteps(false);
    setNavigationMenuOpen(false);
    routeProgressRef.current = -1;
    lastAppliedNavigationHeadingRef.current = null;
    cameraWarningRef.current = { routeId: activeRoute.id || null, announced: new Set() };
    setNextInstruction(null);
    voiceAnnouncementRef.current = { key: null, lastDistance: null, announced: new Set(), initialAnnounced: false };
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    const current = routeOrigin || origin;
    const routePoints = activeRoute.geometry.map(p => [p[1], p[0]]);
    const initialSnap = current && routePoints.length > 1 ? snapToRoute(current, routePoints) : null;
    const initialHeading = initialSnap
      ? routeHeadingAtProgress(routePoints, initialSnap.progress, 32) ?? initialSnap.heading
      : null;
    setNavigating(true);
    setVoiceGuidanceEnabled(true);
    speedWarningRef.current = { active: false, limit: null, lastSpokenAt: 0 };
    speakRoutePrompt("Голосовые предупреждения включены.");
    // Keep the live-navigation map on the same light OSM tiles; avoid a dark-layer swap.
    setMapType("map");
    if (current && mapRef.current) {
      const startPoint = initialSnap && initialSnap.distance <= 85 ? initialSnap.point : [current.lat, current.lng];
      mapRef.current.setView(startPoint, 17, { animate: true });
      if (Number.isFinite(initialHeading)) {
        setMapHeadingUp(mapRef.current, initialHeading, { ease: 0.22, deadzone: 1.0 });
        lastAppliedNavigationHeadingRef.current = initialHeading;
      }
    }
    window.setTimeout(() => {
      if (mapRef.current) mapRef.current.invalidateSize({ animate: false });
    }, 80);
  }

  function stopNavigation() {
    setNavigating(false);
    passedRouteRef.current?.setLatLngs([]);
    setNavigationMenuOpen(false);
    setNextInstruction(null);
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    voiceAnnouncementRef.current = { key: null, lastDistance: null, announced: new Set(), initialAnnounced: false };
    routeProgressRef.current = -1;
    lastAppliedNavigationHeadingRef.current = null;
    setRouteOptions(items => items.slice());
    if (typeof mapRef.current?.stopHeadingUp === "function") mapRef.current.stopHeadingUp();
    if (typeof mapRef.current?.setBearing === "function") mapRef.current.setBearing(navigationBearingRef.current || 0);
    setMapType(navigationMapTypeRef.current || "map");
    navigationMapTypeRef.current = null;
    navigationBearingRef.current = 0;
  }

  function openSearchFromNavigation() {
    stopNavigation();
    setRoute(null);
    setRouteOptions([]);
    setRouteOrigin(null);
    setQuery("");
    setResults([]);
    setShowResultsPanel(false);
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  const selectedLabel = useMemo(
    () => selectedPlace ? selectedPlaceTitle(selectedPlace) : query || "Куда едем?",
    [selectedPlace, query]
  );
  const selectedAddress = useMemo(
    () => selectedPlace ? selectedPlaceAddress(selectedPlace) : query,
    [selectedPlace, query]
  );
  const selectedCategory = useMemo(() => placeCategory(selectedPlace), [selectedPlace]);
  const isHomeScreen = !searchActive && !query.trim() && !showResultsPanel && !destination && !route;
  const showMapUtilityControls = Boolean(route && navigating);
  const showPlaceMapControls = Boolean(destination && !route && selectedPlace);
  const activeNavigationStats = navigationStats.routeId === (route?.id || null)
    ? navigationStats
    : { remainingDistanceMeters: Number(route?.distance) || 0, remainingSeconds: Number(route?.duration) || 0 };
  const navigationDistanceKm = (Math.max(0, activeNavigationStats.remainingDistanceMeters) / 1000)
    .toLocaleString("ru-RU", { maximumFractionDigits: 1, useGrouping: false });

  function openHomeSearch() {
    setSearchActive(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 30);
  }

  async function refreshRoadScanCounts() {
    try {
      if (window.AstanaScanner && typeof window.AstanaScanner.getStatus === "function") {
        const native = JSON.parse(window.AstanaScanner.getStatus() || "{}");
        const observations = Array.isArray(native.observations) ? native.observations : [];
        setRoadScanFrameCount(Number(native.framesCount || 0));
        setRoadScanObservationCount(Number(native.observationsCount || observations.length || 0));
        setScreenScanActive(Boolean(native.screenScanActive));
        setScreenScanStatus(String(native.screenScanStatus || "Экран не сканируется"));
        setScreenScanLastMatch(String(native.screenScanLastMatch || ""));
        setScreenScanFrameCount(Number(native.screenScanFrameCount || 0));
        setScreenScanIconCandidateFrames(Number(native.screenScanIconCandidateFrames || 0));
        setScreenScanIconCandidatesTotal(Number(native.screenScanIconCandidatesTotal || 0));
        setScreenScanIconSavedCount(Number(native.screenScanIconSavedCount || 0));
        setScreenScanTrackCount(Number(native.screenScanTrackCount || 0));
        setScreenScanIconStatus(String(native.screenScanIconStatus || "Графические значки ещё не анализировались."));
        setScreenScanMatchCount(Number(native.screenScanMatchCount || 0));
        setScreenScanCloudStatus(String(native.screenScanCloudStatus || "Экран ещё не синхронизирован"));
        if (native.lat != null && native.lng != null && Number.isFinite(Number(native.lat)) && Number.isFinite(Number(native.lng))) {
          const fix = { lat: Number(native.lat), lng: Number(native.lng), accuracy: Number(native.accuracy || 0), heading: null, speedMps: null };
          roadScanPositionRef.current = fix;
          setRoadScanPosition(fix);
        }
        if (observations.length !== roadScanNativeObsCountRef.current) {
          roadScanNativeObsCountRef.current = observations.length;
          setRoadScanRevision(value => value + 1);
        }
        if (native.lastError) setRoadScanError(String(native.lastError));
        return native;
      }
      const data = await getRoadScanData();
      setRoadScanFrameCount(data.framesCount);
      setRoadScanObservationCount(data.observations.length);
      return data;
    } catch (scanError) {
      setRoadScanError(String(scanError?.message || "Локальная база камеры недоступна."));
      return null;
    }
  }

  async function captureRoadScanFrame(markObject = false) {
    if (roadScanCaptureBusyRef.current) return;
    const video = roadScanVideoRef.current;
    const position = roadScanPositionRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      if (markObject) setRoadScanError("Камера ещё запускается. Попробуй через секунду.");
      return;
    }
    if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
      if (markObject) setRoadScanError("Ждём GPS. Разреши геолокацию и дождись координат.");
      setRoadScanStatus("Ожидание GPS");
      return;
    }

    roadScanCaptureBusyRef.current = true;
    setRoadScanBusy(true);
    setRoadScanError("");
    try {
      const maxWidth = markObject ? 960 : 720;
      const scale = Math.min(1, maxWidth / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Не удалось подготовить кадр камеры.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error("Не удалось сохранить снимок камеры.")),
        "image/jpeg",
        markObject ? 0.72 : 0.52,
      ));
      const capturedAt = new Date().toISOString();
      const id = "scan-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      const frame = {
        id,
        capturedAt,
        lat: position.lat,
        lng: position.lng,
        accuracy: position.accuracy,
        heading: position.heading,
        speedMps: position.speedMps,
        imageBlob: blob,
      };
      let observation = null;
      if (markObject) {
        observation = {
          id,
          frameId: id,
          capturedAt,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          heading: position.heading,
          speedMps: position.speedMps,
          kind: roadScanKind,
          reviewStatus: "needs-review",
          source: "phone-camera",
        };
      }
      await persistRoadScanFrame(frame, observation);
      setRoadScanFrameCount(value => Math.min(ROAD_SCAN_FRAME_LIMIT, value + 1));
      if (observation) {
        setRoadScanObservationCount(value => value + 1);
        setRoadScanRevision(value => value + 1);
        setRoadScanStatus("Объект сохранён с координатами");
      } else {
        setRoadScanStatus("Кадр сохранён · GPS привязан");
      }
    } catch (scanError) {
      setRoadScanError(String(scanError?.message || "Не удалось сохранить кадр."));
    } finally {
      roadScanCaptureBusyRef.current = false;
      setRoadScanBusy(false);
    }
  }

  async function startRoadScan() {
    setRoadScanError("");
    setRoadScanStatus("Запрашиваем доступ к камере и GPS…");
    try {
      if (window.AstanaScanner && typeof window.AstanaScanner.startScanning === "function") {
        // The native Android foreground service owns the camera so it can keep
        // capturing while the map is hidden, another app is open, or screen is locked.
        window.AstanaScanner.startScanning();
        setRoadScanActive(true);
        setRoadScanStatus("Запрашиваем разрешения Android…");
        await refreshRoadScanCounts();
        return;
      }
      if (!window.isSecureContext) throw new Error("Камера доступна только через защищённый адрес HTTPS.");
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Этот браузер не поддерживает доступ к камере. Открой карту в Chrome.");
      if (!navigator.geolocation) throw new Error("Геолокация недоступна в этом браузере.");

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      roadScanStreamRef.current = stream;
      if (roadScanVideoRef.current) {
        roadScanVideoRef.current.srcObject = stream;
        await roadScanVideoRef.current.play().catch(() => {});
      }

      const geolocationError = error => {
        const reason = error?.code === 1
          ? "Нет разрешения на геолокацию. Разреши доступ к местоположению для карты."
          : error?.code === 3
            ? "GPS пока не отвечает. Оставь сканирование включённым до получения координат."
            : "Не удалось получить GPS. Проверь настройки местоположения телефона.";
        setRoadScanError(reason);
      };
      roadScanWatchRef.current = navigator.geolocation.watchPosition(position => {
        const coords = position.coords;
        const fix = {
          lat: Number(coords.latitude),
          lng: Number(coords.longitude),
          accuracy: Number(coords.accuracy),
          heading: Number.isFinite(coords.heading) ? Number(coords.heading) : null,
          speedMps: Number.isFinite(coords.speed) ? Number(coords.speed) : null,
        };
        roadScanPositionRef.current = fix;
        setRoadScanPosition(fix);
        setRoadScanError("");
        setRoadScanStatus("Сканирование активно · GPS подключён");
      }, geolocationError, {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 15000,
      });
      setRoadScanActive(true);
      setRoadScanStatus("Камера включена · ждём GPS");
      await refreshRoadScanCounts();
      // Collect small local evidence frames in the background; object classification is
      // deliberately user-confirmed until an on-device recognition model is integrated.
      roadScanIntervalRef.current = window.setInterval(() => {
        void captureRoadScanFrame(false);
      }, 8000);
    } catch (scanError) {
      setRoadScanError(String(scanError?.message || "Не удалось запустить камеру."));
      setRoadScanStatus("Сканирование не запущено");
      roadScanStreamRef.current?.getTracks?.().forEach(track => track.stop());
      roadScanStreamRef.current = null;
      if (roadScanVideoRef.current) roadScanVideoRef.current.srcObject = null;
      setRoadScanActive(false);
    }
  }

  function stopRoadScan() {
    if (window.AstanaScanner && typeof window.AstanaScanner.stopScanning === "function") {
      window.AstanaScanner.stopScanning();
      setRoadScanActive(false);
      setRoadScanStatus("Сканирование остановлено");
      setRoadScanBusy(false);
      void refreshRoadScanCounts();
      return;
    }
    if (roadScanIntervalRef.current) window.clearInterval(roadScanIntervalRef.current);
    roadScanIntervalRef.current = null;
    if (roadScanWatchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(roadScanWatchRef.current);
    roadScanWatchRef.current = null;
    roadScanStreamRef.current?.getTracks?.().forEach(track => track.stop());
    roadScanStreamRef.current = null;
    if (roadScanVideoRef.current) roadScanVideoRef.current.srcObject = null;
    setRoadScanActive(false);
    setRoadScanStatus("Сканирование остановлено");
    setRoadScanBusy(false);
  }

  async function unlockMapAccess(event) {
    event?.preventDefault?.();
    if (mapAccessBusy) return;
    setMapAccessBusy(true);
    setMapAccessError("");
    try {
      const response = await fetch("/api/road-auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: mapAccessKeyInput.trim() }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.authenticated) {
        setMapAccessError(payload?.error || "Ключ не принят. Проверь ввод.");
        return;
      }
      try { window.AstanaScanner?.setAccessKey?.(mapAccessKeyInput.trim()); } catch {}
      setMapAccessKeyInput("");
      setMapAccessAllowed(true);
      setMapAccessError("");
    } catch {
      setMapAccessError("Нет связи с сервером. Проверь интернет и повтори.");
    } finally {
      setMapAccessBusy(false);
    }
  }

  function beginManualRoadAdd() {
    setRoadScanPanelOpen(false);
    setManualRoadPosition(null);
    setManualRoadStatus("Переключи карту в 2D и нажми на точное место объекта.");
    setManualRoadAddMode(true);
    setMap3dEnabled(false);
  }

  async function saveManualRoadObject() {
    if (!manualRoadPosition || manualRoadBusy) return;
    setManualRoadBusy(true);
    setManualRoadStatus("");
    try {
      const response = await fetch("/api/road-manual-objects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          kind: manualRoadKind,
          lat: manualRoadPosition.lat,
          lng: manualRoadPosition.lng,
          label: manualRoadLabel.trim(),
          notes: manualRoadNotes.trim(),
          accuracy_m: 10,
        }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        setManualRoadStatus(payload?.error || "Не удалось сохранить объект.");
        return;
      }
      setManualRoadStatus(payload.duplicate
        ? "Такой объект уже есть рядом — существующая точка обновлена."
        : "Объект сохранён в личной базе «Астана Гид».");
      setManualRoadPosition(null);
      setManualRoadNotes("");
      setManualRoadLabel("");
      setRoadScanRevision(value => value + 1);
      setRoadObjectsRevision(value => value + 1);
    } catch {
      setManualRoadStatus("Нет связи с базой. Объект пока не сохранён.");
    } finally {
      setManualRoadBusy(false);
    }
  }

  useEffect(() => {
    if (!leafletReady || !window.L || !mapRef.current || !manualRoadAddMode) return;
    const map = mapRef.current;
    const container = map.getContainer?.();
    const previousCursor = container?.style?.cursor || "";
    if (container?.style) container.style.cursor = "crosshair";
    const onMapClick = event => {
      const lat = Number(event?.latlng?.lat);
      const lng = Number(event?.latlng?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setManualRoadPosition({ lat, lng });
      setManualRoadAddMode(false);
      setManualRoadStatus("Проверь координаты и сохрани объект.");
      if (!manualRoadLabel.trim()) {
        const labels = {
          "traffic-light": "Светофор",
          "speed-camera": "Камера контроля скорости",
          "surveillance-camera": "Камера видеонаблюдения",
          "speed-limit": "Ограничение скорости",
          "traffic-sign": "Дорожный знак",
          "stop-sign": "Знак STOP",
          "give-way-sign": "Уступи дорогу",
          "pedestrian-crossing": "Пешеходный переход",
          "no-stopping": "Остановка запрещена",
          "no-parking": "Стоянка запрещена",
          "parking": "Парковка",
          "roadwork": "Дорожные работы",
          "road-hazard": "Опасный участок",
        };
        setManualRoadLabel(labels[manualRoadKind] || "Дорожный объект");
      }
    };
    map.on("click", onMapClick);
    return () => {
      map.off("click", onMapClick);
      if (container?.style) container.style.cursor = previousCursor;
    };
  }, [leafletReady, manualRoadAddMode, manualRoadKind]);

  if (!mapAccessChecked) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#101820", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 42 }}>🔐</div><h1 style={{ fontSize: 22 }}>Астана Гид</h1><p>Проверяем доступ к личной базе…</p></div>
    </main>;
  }

  if (!mapAccessAllowed) {
    return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 22, boxSizing: "border-box", background: "linear-gradient(150deg,#0e1720,#1c2e3c)", color: "#101820", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ width: "100%", maxWidth: 430, boxSizing: "border-box", background: "#fff", padding: 26, borderRadius: 24, boxShadow: "0 20px 70px #0006" }}>
        <div style={{ fontSize: 38, marginBottom: 8 }}>🗺️🔒</div>
        <h1 style={{ margin: "0 0 8px", fontSize: 25 }}>Астана Гид</h1>
        <p style={{ margin: "0 0 22px", color: "#52616d", lineHeight: 1.5 }}>Личная база координат камер, светофоров и дорожных знаков. Введи свой ключ доступа, чтобы открыть карту.</p>
        <form onSubmit={unlockMapAccess}>
          <label htmlFor="astana-private-key" style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>Личный ключ базы</label>
          <input id="astana-private-key" type="password" autoComplete="current-password" value={mapAccessKeyInput} onChange={event => setMapAccessKeyInput(event.target.value)} placeholder="Вставь ключ доступа" style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "14px 12px", border: "1px solid #a7b5bf", borderRadius: 12, fontSize: 16, marginBottom: 12 }} />
          {mapAccessError && <p role="alert" style={{ color: "#b42318", margin: "0 0 12px" }}>{mapAccessError}</p>}
          <button type="submit" disabled={mapAccessBusy || mapAccessKeyInput.trim().length < 32} style={{ width: "100%", padding: 14, border: 0, borderRadius: 12, background: "#126e59", color: "#fff", fontSize: 16, fontWeight: 800, opacity: mapAccessBusy ? 0.7 : 1 }}>
            {mapAccessBusy ? "Проверяем ключ…" : "Открыть личную базу"}
          </button>
        </form>
        <p style={{ color: "#6b7780", fontSize: 12, lineHeight: 1.5, margin: "18px 0 0" }}>Доступ проверяется на сервере. Не отправляй ключ другим людям.</p>
      </section>
    </main>;
  }

  return (
    <main className="astana-map-page">
      <div ref={mapEl} className={`astana-map-canvas${navigating ? " astana-map-canvas-navigation" : ""}${map3dEnabled && map3dReady ? " astana-map-canvas-3d-hidden" : ""}`} />
      <div ref={map3dEl} className={`astana-map-3d-canvas${map3dEnabled && map3dReady ? " active" : ""}`} aria-hidden={!map3dEnabled || !map3dReady} />
      {showRoadDataDiagnostics && <aside className="astana-road-diagnostics" aria-live="polite">
        <b>Диагностика дорожных данных</b>
        <div>Сервис дороги: {roadDataDiagnostics?.roadStatus === "ok" ? (roadDataDiagnostics?.partial ? "частичная загрузка" : "ответ получен") : roadDataDiagnostics?.roadStatus === "error" ? "ошибка запроса" : "загрузка…"}</div>
        {roadDataDiagnostics?.source && <div>Источник: {roadDataDiagnostics.source}</div>}
        <div>Получено объектов: {roadDataDiagnostics?.responseCount ?? "—"}; обработано: {roadDataDiagnostics?.mappedCount ?? "—"}</div>
        <div>Светофоры: {roadDataDiagnostics?.sourceCounts?.trafficLights ?? "—"}; камеры скорости: {roadDataDiagnostics?.sourceCounts?.speedCameras ?? "—"}</div>
        <div>Другие камеры: {roadDataDiagnostics?.sourceCounts?.surveillanceCameras ?? "—"}; знаки: {roadDataDiagnostics?.sourceCounts?.trafficSigns ?? "—"}</div>
        <div>Переходы: {roadDataDiagnostics?.sourceCounts?.pedestrianCrossings ?? "—"}; парковки: {roadDataDiagnostics?.sourceCounts?.parking ?? "—"}</div>
        <div>Каталог камер: {roadDataDiagnostics?.cameraStatus === "ok" ? `доступен, ${roadDataDiagnostics.cameraCatalogCount ?? 0}` : roadDataDiagnostics?.cameraStatus === "error" ? "недоступен" : "загрузка…"}</div>
        {roadDataDiagnostics?.fetchedAt && <div>Обновлено: {roadDataDiagnostics.fetchedAt}</div>}
        {roadDataDiagnostics?.partialReason && <div>Почему частично: {roadDataDiagnostics.partialReason}</div>}
        {roadDataDiagnostics?.roadError && <div>Ошибка: {roadDataDiagnostics.roadError}</div>}
        {roadDataDiagnostics?.cameraError && <div>Камеры: {roadDataDiagnostics.cameraError}</div>}
      </aside>}
      {isHomeScreen && <>
        <button className={`astana-home-3d-toggle${map3dEnabled && map3dReady ? " active" : ""}`} onClick={toggle3DMap} aria-label={map3dEnabled ? "Переключить на 2D-карту" : "Переключить на 3D-карту"}>{map3dEnabled && map3dReady ? "2D" : "3D"}</button>
        <button className={`astana-home-4d-toggle${map4dEnabled && map3dReady ? " active" : ""}`} onClick={toggle4DMap} aria-label={map4dEnabled ? "Выключить режим 4D" : "Включить режим 4D"}>{map4dEnabled && map3dReady && gpsFixReady ? "LIVE" : "4D"}</button>
      </>}
      {!roadScanPanelOpen && <button type="button" className={`astana-road-scan-toggle${roadScanActive ? " active" : ""}`} onClick={() => { setRoadScanPanelOpen(true); void refreshRoadScanCounts(); }} aria-label="Сканировать дорогу"><span>📷</span><b>СКАН</b></button>}
      {roadScanPanelOpen && <section className="astana-road-scan-panel" role="dialog" aria-modal="true" aria-label="Сканирование дорожных объектов">
        <header className="astana-road-scan-header">
          <div><b>📷 Сканирование дороги</b><small>{roadScanStatus}</small></div>
          <button type="button" onClick={closeRoadScanPanel} aria-label="Закрыть сканирование">×</button>
        </header>
        <div className="astana-road-scan-preview">
          {!nativeScannerAvailable && <video ref={roadScanVideoRef} autoPlay playsInline muted aria-label="Предпросмотр задней камеры телефона" />}
          {(!roadScanActive || nativeScannerAvailable) && <div className="astana-road-scan-placeholder">
            <span>{roadScanActive ? "📡" : "📹"}</span>
            <b>{roadScanActive ? (nativeScannerAvailable ? "Фоновая камера активна" : "Камера включена") : "Камера выключена"}</b>
            <small>{roadScanActive && nativeScannerAvailable
              ? "Android-сервис продолжает сохранять кадры при переходе в другое приложение. Постоянное уведомление показывает состояние."
              : "Нажми «Начать сканирование» и разреши доступ к камере и GPS."}</small>
          </div>}
          {roadScanActive && <span className="astana-road-scan-live">● LIVE</span>}
        </div>
        <div className="astana-road-scan-gps">
          <span>GPS: {roadScanPosition ? `${roadScanPosition.lat.toFixed(6)}, ${roadScanPosition.lng.toFixed(6)}` : "ожидание координат"}</span>
          {roadScanPosition && <small>Точность ±{Math.round(roadScanPosition.accuracy || 0)} м</small>}
          {nativeScannerAvailable && <small>Облако: {roadScanCloudStatus}</small>}
        </div>
        <div className="astana-road-scan-counters">
          <div><b>{roadScanFrameCount}</b><small>кадров задней камеры</small></div>
          <div><b>{roadScanObservationCount}</b><small>предварительных точек камеры</small></div>
        </div>
        <div className="astana-road-scan-actions">
          {!roadScanActive
            ? <button type="button" className="primary" onClick={() => void startRoadScan()}>Начать сканирование</button>
            : <button type="button" className="stop" onClick={stopRoadScan}>Остановить камеру</button>}
        </div>
        {roadScanActive && <div className="astana-road-scan-mark-form">
          <label htmlFor="astana-road-scan-kind">Что за объект?</label>
          <select id="astana-road-scan-kind" value={roadScanKind} onChange={event => setRoadScanKind(event.target.value)}>
            {ROAD_SCAN_KINDS.map(option => <option key={option.value} value={option.value}>{option.icon} {option.label}</option>)}
          </select>
          <button type="button" disabled={roadScanBusy || !roadScanPosition} onClick={() => {
            if (nativeScannerAvailable && window.AstanaScanner?.saveObservation) {
              const result = JSON.parse(window.AstanaScanner.saveObservation(roadScanKind) || "{}");
              if (result.ok) {
                setRoadScanStatus("Сохраняем объект с GPS…");
                window.setTimeout(() => { void refreshRoadScanCounts(); }, 900);
              } else {
                setRoadScanError(result.error || "Не удалось сохранить отметку.");
              }
            } else {
              void captureRoadScanFrame(true);
            }
          }}>
            {roadScanBusy ? "Сохраняем…" : "Сохранить объект с GPS"}
          </button>
          <small>{nativeScannerAvailable
            ? "ИИ автоматически ищет светофоры и знаки STOP. При наличии интернета найденные точки отправляются на общую карту как предварительные отметки. Ограничения скорости и большинство остальных знаков эта модель пока не распознаёт."
            : "Сохраняется текущий кадр с координатами и отметкой. Пока объект указывается вручную — автоматическое распознавание ИИ ещё не подключено."}</small>
          {nativeScannerAvailable && <button type="button" onClick={() => window.AstanaScanner.openBatterySettings()}>Настроить работу в фоне</button>}
        </div>}
        <div className="astana-road-scan-mark-form">
          <button type="button" onClick={beginManualRoadAdd}>📍 Добавить объект вручную на карте</button>
          <small>Для светофоров и камер, которых нет в 2ГИС или Яндекс Навигаторе. Точка сохранится в личную базу с защитой от дубликатов.</small>
        </div>
        <div className="astana-road-scan-mark-form">
          <label>Экран навигатора (Яндекс / 2ГИС)</label>
          <div className="astana-road-scan-actions">
            {!screenScanActive
              ? <button type="button" className="primary" onClick={() => {
                  if (window.AstanaScanner?.startScreenScan) {
                    setScreenScanStatus("Ожидаем системное разрешение Android…");
                    window.AstanaScanner.startScreenScan();
                  } else {
                    setRoadScanError("Анализ экрана доступен в установленном Android-сканере.");
                  }
                }}>Сканировать экран</button>
              : <button type="button" className="stop" onClick={() => {
                  window.AstanaScanner?.stopScreenScan?.();
                  setScreenScanActive(false);
                  setScreenScanStatus("Останавливаем анализ экрана…");
                }}>Остановить экран</button>}
          </div>
          <small><b>{screenScanActive ? "● " : ""}{screenScanStatus}</b></small>
          <small>Кадров экрана: {screenScanFrameCount} · кадров с кандидатами: {screenScanIconCandidateFrames} · графических кандидатов: {screenScanIconCandidatesTotal} · значков отслеживается: {screenScanTrackCount} · сохранено GPS-точек: {screenScanIconSavedCount}</small>
          <small>Диагностика значков: {screenScanIconStatus}</small>
          <small>Разреши захват экрана в системном окне. Если Android предложит выбор приложения, выбери Яндекс Навигатор или 2ГИС. Сканер анализирует значки локально; полные снимки экрана не сохраняются и не отправляются.</small>
          {screenScanLastMatch && <small>Последняя подсказка: {screenScanLastMatch}</small>}
          <small>Текстовых/экранных подсказок: {screenScanMatchCount}. Облако: {screenScanCloudStatus}</small>
        </div>
        {roadScanError && <div className="astana-road-scan-error" role="status">{roadScanError}</div>}
        <p className="astana-road-scan-safety">Настрой камеру до начала движения. Не нажимай кнопки за рулём. Кадры задней камеры хранятся на телефоне; на сервер отправляются только предварительные метаданные объектов. Полные снимки экрана навигатора не загружаются.</p>
      </section>}



      {manualRoadAddMode && <div style={{ position: "fixed", zIndex: 9000, left: "50%", top: 86, transform: "translateX(-50%)", width: "min(92vw,420px)", padding: 14, borderRadius: 16, background: "#fff", color: "#15222b", boxShadow: "0 8px 32px #0004", fontFamily: "system-ui,sans-serif" }}>
        <b style={{ display: "block", marginBottom: 6 }}>Добавление дорожного объекта</b>
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>Нажми на карте ровно в месте светофора, камеры или знака.</div>
        <div style={{ marginTop: 8, fontSize: 12, color: "#52616d" }}>Для точного выбора используй 2D-карту.</div>
        <button type="button" onClick={() => { setManualRoadAddMode(false); setManualRoadStatus("Добавление отменено."); }} style={{ marginTop: 10, border: 0, background: "#e8edf0", padding: "9px 12px", borderRadius: 9, fontWeight: 700 }}>Отмена</button>
      </div>}
      {manualRoadPosition && <div role="dialog" aria-modal="true" aria-label="Сохранить дорожный объект" style={{ position: "fixed", zIndex: 9100, left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(92vw,440px)", maxHeight: "86dvh", overflowY: "auto", boxSizing: "border-box", padding: 20, borderRadius: 18, background: "#fff", color: "#15222b", boxShadow: "0 12px 48px #0006", fontFamily: "system-ui,sans-serif" }}>
        <b style={{ fontSize: 20 }}>Сохранить в личную базу</b>
        <p style={{ fontSize: 13, color: "#52616d" }}>Координаты: {manualRoadPosition.lat.toFixed(6)}, {manualRoadPosition.lng.toFixed(6)}</p>
        <label htmlFor="manual-road-kind" style={{ display: "block", fontWeight: 700, margin: "12px 0 6px" }}>Тип объекта</label>
        <select id="manual-road-kind" value={manualRoadKind} onChange={event => {
          const next = event.target.value;
          setManualRoadKind(next);
          const labels = {
            "traffic-light": "Светофор", "speed-camera": "Камера контроля скорости",
            "surveillance-camera": "Камера видеонаблюдения", "speed-limit": "Ограничение скорости",
            "traffic-sign": "Дорожный знак", "stop-sign": "Знак STOP", "give-way-sign": "Уступи дорогу",
            "pedestrian-crossing": "Пешеходный переход", "no-stopping": "Остановка запрещена",
            "no-parking": "Стоянка запрещена", "parking": "Парковка",
            "roadwork": "Дорожные работы", "road-hazard": "Опасный участок",
          };
          setManualRoadLabel(labels[next] || "Дорожный объект");
        }} style={{ width: "100%", padding: 11, border: "1px solid #a7b5bf", borderRadius: 10, fontSize: 15 }}>
          <option value="traffic-light">🚦 Светофор</option>
          <option value="speed-camera">📷 Камера контроля скорости</option>
          <option value="surveillance-camera">🎥 Камера видеонаблюдения</option>
          <option value="speed-limit">🔵 Ограничение скорости</option>
          <option value="traffic-sign">🛑 Дорожный знак</option>
          <option value="stop-sign">🛑 Знак STOP</option>
          <option value="give-way-sign">🔻 Уступи дорогу</option>
          <option value="pedestrian-crossing">🚸 Пешеходный переход</option>
          <option value="no-stopping">⛔ Остановка запрещена</option>
          <option value="no-parking">🚫 Стоянка запрещена</option>
          <option value="parking">🅿️ Парковка</option>
          <option value="roadwork">🚧 Дорожные работы</option>
          <option value="road-hazard">⚠️ Опасный участок</option>
        </select>
        <label htmlFor="manual-road-label" style={{ display: "block", fontWeight: 700, margin: "12px 0 6px" }}>Название</label>
        <input id="manual-road-label" value={manualRoadLabel} onChange={event => setManualRoadLabel(event.target.value)} maxLength={100} placeholder="Например: светофор на перекрёстке" style={{ width: "100%", boxSizing: "border-box", padding: 11, border: "1px solid #a7b5bf", borderRadius: 10, fontSize: 15 }} />
        <label htmlFor="manual-road-notes" style={{ display: "block", fontWeight: 700, margin: "12px 0 6px" }}>Заметка (необязательно)</label>
        <textarea id="manual-road-notes" value={manualRoadNotes} onChange={event => setManualRoadNotes(event.target.value)} rows={2} maxLength={500} placeholder="Например: Талапкер, направление в город" style={{ width: "100%", boxSizing: "border-box", padding: 11, border: "1px solid #a7b5bf", borderRadius: 10, fontSize: 15 }} />
        {manualRoadStatus && <p role="status" style={{ fontSize: 13, color: "#126e59" }}>{manualRoadStatus}</p>}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button type="button" onClick={() => { setManualRoadPosition(null); setManualRoadStatus(""); }} style={{ flex: 1, padding: 12, border: 0, borderRadius: 10, background: "#e8edf0", fontWeight: 700 }}>Отмена</button>
          <button type="button" disabled={manualRoadBusy || manualRoadLabel.trim().length < 2} onClick={() => void saveManualRoadObject()} style={{ flex: 1, padding: 12, border: 0, borderRadius: 10, background: "#126e59", color: "#fff", fontWeight: 800, opacity: manualRoadBusy ? 0.7 : 1 }}>{manualRoadBusy ? "Сохраняем…" : "Сохранить точку"}</button>
        </div>
      </div>}
      {!route && <div className={`astana-search-wrap ${isHomeScreen ? "astana-search-wrap-home" : showPlaceMapControls ? "astana-search-wrap-selected" : "astana-search-wrap-active"}`}>
        {isHomeScreen && <div className="astana-home-handle"><span /></div>}
        <div className="astana-search-home-row">
          <div className="astana-search-box">
            <button className="astana-search-icon" onClick={() => searchAddress(query)} aria-label="Найти адрес" title="Найти адрес">⌕</button>
            <input
              ref={searchInputRef}
              value={query}
              onFocus={() => setSearchActive(true)}
              onChange={e => { setQuery(e.target.value); setResults([]); setShowResultsPanel(false); setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); searchAddress(query); } }}
              placeholder="Поиск"
              aria-label="Поиск адреса"
            />
            {query && <button className="astana-clear" onClick={() => { setQuery(""); setResults([]); setShowResultsPanel(false); setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setSearchActive(false); setError(""); }}>×</button>}
            <button className={`astana-mic${listening ? " listening" : ""}`} onClick={startVoiceSearch} aria-label="Голосовой поиск" title="Голосовой поиск">🎙</button>
          </div>
          {isHomeScreen && <button className="astana-home-menu" onClick={openHomeSearch} aria-label="Открыть поиск">☰</button>}
        </div>
        {searchActive && <button className="astana-search-cancel" onClick={() => { setSearchActive(false); setShowResultsPanel(false); setResults([]); setQuery(""); setError(""); searchInputRef.current?.blur(); }}>Отмена</button>}
        {showResultsPanel && <div className="astana-results">
          {searching && <div className="astana-result-loading">Ищем адрес…</div>}
          {!searching && results.map((item, i) => <button key={`${item.place_id}-${i}`} className="astana-result" onClick={() => { chooseResult(item); setSearchActive(false); }}>
            <span className="astana-result-pin">⌖</span>
            <span><b>{cleanName(item)}</b><small>{item.display_name}</small></span>
          </button>)}
          {!searching && !results.length && <div className="astana-result-loading">{error || "Ничего не найдено. Проверьте адрес и нажмите поиск."}</div>}
        </div>}

        {isHomeScreen && <>
          <div className="astana-home-shortcuts">
            <button className="astana-shortcut astana-shortcut-icon" onClick={openHomeSearch} aria-label="Сохранённые места">♧</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">◉</span> Найти работу</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">⌂</span> Домой</button>
            <button className="astana-shortcut" onClick={openHomeSearch}><span className="shortcut-symbol">▰</span> На работу</button>
          </div>

          <div className="astana-home-promo-strip" aria-label="Подборки">
            <div className="astana-promo-card astana-promo-child">
              <div className="astana-promo-art">📚👧🏻</div>
              <span>Детский профиль<br />или обычный?</span>
            </div>
            <div className="astana-promo-card astana-promo-business">
              <div className="astana-promo-art">🏙️💚</div>
              <span>Где лучше открыть<br />бизнес?</span>
            </div>
            <div className="astana-promo-card astana-promo-autumn">
              <div className="astana-promo-art">🍁✨</div>
              <span>Гуляйте и собирайте<br />искры</span>
            </div>
            <div className="astana-promo-card astana-promo-smile">
              <div className="astana-promo-art">😁</div>
              <span>Зубы, которые<br />мы потеряли</span>
            </div>
          </div>

          <section className="astana-home-interesting">
            <h2>Интересное для вас</h2>
            <div className="astana-interesting-cards">
              <article className="astana-interesting-card astana-friends-card">
                <div className="astana-interesting-copy"><b>Где ваши друзья?</b><span>Смотрите прямо<br />на карте города</span></div>
                <div className="astana-friends-art"><span>👨🏻</span><b>📍</b><span>👩🏻</span><i>🚘</i></div>
              </article>
              <article className="astana-interesting-card astana-sauna-card">
                <div className="astana-interesting-copy"><b>Избушка, сауна</b><span>Бани и сауны<br />рядом с вами</span></div>
                <div className="astana-sauna-art">🏡</div>
              </article>
            </div>
          </section>
        </>}
      </div>}

      {navigating && route && <div className="astana-nav-guidance" aria-label="Следующий манёвр">
        <div className="astana-nav-guidance-symbol">{nextInstruction?.arrow || "↑"}</div>
        <div className="astana-nav-guidance-copy">
          <b>{nextInstruction?.distance || "— м"}</b>
        </div>
      </div>}
      {navigating && route && nextInstruction?.lanes?.length > 0 && <div className="astana-nav-lane-guidance" aria-label="Полосы перед следующим манёвром">
        {nextInstruction.lanes.map((lane, index) => <div className={`astana-nav-lane${lane.valid ? " active" : ""}`} key={index} aria-label={lane.valid ? "Рекомендуемая полоса" : "Направление полосы"}>
          {lane.arrows.map((arrow, arrowIndex) => <i key={arrowIndex}>{arrow}</i>)}
        </div>)}
      </div>}

      {showPlaceMapControls && <div className="astana-place-map-controls" aria-label="Управление картой">
        <button onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 16); }} aria-label="Моё местоположение" title="Моё местоположение">➤</button>
        <button onClick={() => mapRef.current?.zoomIn()} aria-label="Приблизить" title="Приблизить">+</button>
        <button onClick={() => mapRef.current?.zoomOut()} aria-label="Отдалить" title="Отдалить">−</button>
        <button onClick={swapMapType} aria-label="Сменить карту" title="Сменить тип карты">◈</button>
        <button onClick={toggle3DMap} className="astana-place-3d-toggle" aria-label={map3dEnabled ? "Переключить на 2D-карту" : "Переключить на 3D-карту"} title={map3dEnabled ? "2D-карта" : "3D-карта"}>{map3dEnabled && map3dReady ? "2D" : "3D"}</button>
      </div>}

      {destination && !route && <section className="astana-place-card">
        <div className="astana-place-handle"><span /></div>
        <div className="astana-place-heading">
          <div className="astana-place-heading-copy">
            <h2>{selectedLabel}</h2>
            <span className="astana-place-category">{selectedCategory}</span>
          </div>
          <button className="astana-place-close" onClick={() => {
            setDestination(null); setSelectedPlace(null); setRoute(null); setRouteOptions([]); setRouteOrigin(null); setQuery("");
            setResults([]); setShowResultsPanel(false); setSearchActive(false); setNavigating(false); setError("");
          }} aria-label="Закрыть карточку места">×</button>
        </div>

        {selectedPlace?.rating !== undefined && selectedPlace?.rating !== null && Number.isFinite(Number(selectedPlace.rating)) &&
          <div className="astana-place-rating"><span className="astana-stars">★★★★★</span><b>{Number(selectedPlace.rating).toFixed(1)}</b>{selectedPlace.review_count ? <span>{selectedPlace.review_count} оценок</span> : null}</div>
        }

        <p className="astana-place-address">{selectedAddress}</p>
        <div className="astana-place-meta">
          <span>{selectedPlace?.address?.city || selectedPlace?.address?.town || selectedPlace?.address?.village || selectedPlace?.address?.municipality || "Местоположение на карте"}</span>
          <span className="astana-place-coordinates">{destination.lat.toFixed(5)}, {destination.lng.toFixed(5)}</span>
        </div>

        <div className="astana-place-tabs"><span className="active">Информация</span><span>Рядом</span><span>На карте</span></div>

        <div className="astana-place-actions">
          <button className="astana-place-route-button" onClick={() => buildRoute(mode)} disabled={routing || locating}>
            {routing ? "Строим…" : <><span className="astana-place-route-arrow">➤</span> Маршрут</>}
          </button>
          <button className={`astana-place-icon-action ${isFavorite ? "saved" : ""}`} onClick={() => setIsFavorite(v => !v)} aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"} title="Избранное">{isFavorite ? "★" : "♧"}</button>
          <button className="astana-place-icon-action" onClick={async () => {
            const shareText = `${selectedLabel}\n${selectedAddress}`;
            try {
              if (navigator.share) await navigator.share({ title: selectedLabel, text: shareText, url: window.location.href });
              else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareText); setError("Адрес скопирован."); }
              else setError(shareText);
            } catch {}
          }} aria-label="Поделиться адресом" title="Поделиться">●</button>
          <button className="astana-place-taxi-action" onClick={() => setError("Вызов такси пока не подключён к карте.")}><span>🚕</span><b>На такси</b></button>
        </div>
      </section>}

      {showMapUtilityControls && <div className="astana-map-right-controls astana-navigation-controls">
        <div className={`astana-nav-speed-now${upcomingCamera ? " has-camera" : ""}`} title={upcomingCamera ? `Впереди камера через ${formatDistance(upcomingCamera.meters)}` : "Текущая скорость"}>
          <b>{speed}</b>
          {upcomingCamera && <span className="astana-nav-camera-alert" aria-label={`Камера впереди через ${formatDistance(upcomingCamera.meters)}`} title={`Камера через ${formatDistance(upcomingCamera.meters)}`}>📷</span>}
        </div>
        <div className="astana-nav-speed-limit" aria-label={speedLimit !== null ? `Ограничение скорости ${speedLimit} километров в час` : "Ограничение скорости не определено"} title="Ограничение скорости"><b>{speedLimit ?? "—"}</b></div>
        <button className={`astana-nav-voice-toggle ${voiceGuidanceEnabled ? "enabled" : ""}`} onClick={toggleVoiceGuidance} aria-label={voiceGuidanceEnabled ? "Выключить голосовые подсказки" : "Включить голосовые подсказки"} title={voiceGuidanceEnabled ? "Голосовые подсказки включены" : "Включить голосовые подсказки"}>{voiceGuidanceEnabled ? "🔊" : "🔇"}</button>
        <div className="astana-nav-zoom">
          <button onClick={() => mapRef.current?.zoomIn()} aria-label="Приблизить">+</button>
          <button onClick={() => mapRef.current?.zoomOut()} aria-label="Отдалить">−</button>
        </div>
        <button className={`astana-nav-4d-toggle${map4dEnabled && map3dReady ? " active" : ""}`} onClick={toggle4DMap} aria-label={map4dEnabled ? "Выключить режим 4D" : "Включить режим 4D"} title={map4dEnabled ? "Живая динамика включена" : "Включить 4D"}>{map4dEnabled && map3dReady && gpsFixReady ? "LIVE" : "4D"}</button>
        <button className="astana-nav-3d-toggle" onClick={toggle3DMap} aria-label={map3dEnabled ? "Переключить на 2D-карту" : "Переключить на 3D-карту"} title={map3dEnabled ? "2D-карта" : "3D-карта"}>{map3dEnabled && map3dReady ? "2D" : "3D"}</button>
        <button className="astana-nav-recenter" onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 17, { animate: true }); }} aria-label="Моё местоположение">➤</button>
      </div>}

      {route && !navigating && <div className="astana-route-quick-actions">
        <button className="astana-route-quick-icon" onClick={() => setShowSteps(v => !v)} aria-label="Параметры маршрута" title="Параметры маршрута">☷</button>
        <button className="astana-route-quick-icon" onClick={async () => {
          const shareText = "Маршрут до " + selectedLabel + "\n" + formatDistance(route.distance) + ", " + formatDuration(route.duration);
          try {
            if (navigator.share) await navigator.share({ title: "Маршрут", text: shareText, url: window.location.href });
            else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(shareText); setError("Маршрут скопирован."); }
            else setError(shareText);
          } catch {}
        }} aria-label="Поделиться маршрутом" title="Поделиться маршрутом">♧</button>
        <button onClick={() => setError("Добавление промежуточных остановок пока не подключено.")}>Заехать</button>
        <button onClick={() => {
          if (mapRef.current && routeOptions.length) {
            const points = routeOptions.flatMap(option => (option.geometry || []).map(p => [p[1], p[0]]));
            if (points.length) mapRef.current.fitBounds(window.L.latLngBounds(points), { padding: [30, 320] });
          }
        }}>К подъезду</button>
        <button onClick={() => setError("Данные парковок пока не подключены.")}>На парковку</button>
      </div>}

      {route && !navigating && <section className="astana-route-card astana-route-results">
        <div className="astana-route-handle"><span /></div>
        <div className="astana-route-endpoints">
          <div className="astana-route-endpoint-list">
            <div className="astana-route-endpoint"><span className="astana-endpoint-dot astana-origin-dot" /><span>Моё местоположение</span></div>
            <div className="astana-route-endpoint"><span className="astana-endpoint-dot astana-destination-dot" /><span>{selectedLabel}</span></div>
          </div>
          <div className="astana-route-endpoint-actions">
            <button aria-label="Поменять точки местами" title="Поменять точки местами" onClick={() => {
              const oldStart = routeOrigin || origin;
              if (!oldStart || !destination) return;
              setRouteOrigin(destination);
              setDestination(oldStart);
              setSelectedPlace({ name: "Моё местоположение", display_name: "Моё местоположение", address: { city: "Астана" }, lat: oldStart.lat, lon: oldStart.lng, type: "place" });
              setQuery("Моё местоположение");
              setRoute(null); setRouteOptions([]); setNavigating(false); setNextInstruction(null); setError("");
            }}>↕</button>
            <button aria-label="Закрыть маршрут" title="Закрыть маршрут" onClick={() => {
              setRoute(null); setRouteOptions([]); setRouteOrigin(null); setNavigating(false); setNextInstruction(null); setShowSteps(false); setError("");
              if (destination) mapRef.current?.setView([destination.lat, destination.lng], 15);
            }}>×</button>
          </div>
        </div>

        <div className="astana-route-option-track">
          {(routeOptions.length ? routeOptions : [route]).map((option, index) => <article key={option.id || index} className={`astana-route-option-card ${option === route ? "selected" : ""}`}>
            <div className="astana-route-option-top">
              <div><strong>{formatDuration(option.duration)}</strong><span className="astana-route-arrival">→ {formatArrivalTime(option.duration)}</span></div>
              {option === route && <button type="button" className="astana-route-start-button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); startNavigation(option); }} aria-label="Начать навигацию по выбранному маршруту">В путь</button>}
            </div>
            <p>{formatDistance(option.distance)} · {index === 0 ? "Лучший маршрут" : "Альтернативный маршрут"}</p>
            <div className="astana-route-turns"><span>◉</span> Повороты · {routeTurnCount(option)}</div>
          </article>)}
        </div>

        {showSteps && <div className="astana-steps astana-route-step-list">
          {route.steps.slice(0, 12).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}
        </div>}

        <div className="astana-route-transport-strip">
          <button className={route.mode === "car" ? "active" : ""} onClick={() => buildRoute("car")}><span>🚘</span><b>{route.mode === "car" ? formatDuration(route.duration) : "Авто"}</b></button>
          <button onClick={() => buildRoute("bus")}><span>🚌</span><b>Автобус</b><small>—</small></button>
          <button className={route.mode === "walk" ? "active" : ""} onClick={() => buildRoute("walk")}><span>🚶</span><b>{route.mode === "walk" ? formatDuration(route.duration) : "Пешком"}</b></button>
          <button disabled title="Вызов такси пока не подключён"><span>🚕</span><b>Такси</b><small>—</small></button>
          <button disabled title="Данные для мотоцикла пока не подключены"><span>🏍</span><b>Мото</b><small>—</small></button>
          <button disabled title="Данные для велосипеда пока не подключены"><span>🚲</span><b>Вело</b><small>—</small></button>
        </div>
      </section>}

      {navigating && route && <div className="astana-nav-parking-filter">Все парковки⌄</div>}
      {navigating && route && navigationMenuOpen && <div className="astana-nav-menu">
        <div className="astana-nav-menu-title">Маршрут · {formatDistance(route.distance)}</div>
        <div className="astana-nav-menu-steps">
          {route.steps.slice(0, 10).map((step, i) => <div className="astana-step" key={i}><span>{i + 1}</span><div><b>{stepText(step)}</b><small>{formatDistance(step.distance)}</small></div></div>)}
        </div>
        <button onClick={stopNavigation}>Завершить навигацию</button>
      </div>}
      {navigating && route && <div className="astana-nav-bottom-hud">
        <button className="astana-nav-hud-icon" onClick={openSearchFromNavigation} aria-label="Новый поиск">⌕</button>
        <div className="astana-nav-hud-metric"><b>{formatDuration(activeNavigationStats.remainingSeconds)}</b><span>мин</span></div>
        <div className="astana-nav-hud-metric"><b>{formatArrivalTime(activeNavigationStats.remainingSeconds, navigationClock)}</b><span>прибытие</span></div>
        <div className="astana-nav-hud-metric"><b>{navigationDistanceKm}</b><span>км</span></div>
        <button className="astana-nav-hud-icon" onClick={() => setNavigationMenuOpen(v => !v)} aria-label="Меню навигации">☰</button>
      </div>}

      {locating && <div className="astana-toast">Определяем местоположение…</div>}
      {error && <div className="astana-error">{error}</div>}


      {isHomeScreen && <button className="astana-home-locate" onClick={() => { if (origin) mapRef.current?.setView([origin.lat, origin.lng], 16); }} aria-label="Моё местоположение">➤</button>}
      {isHomeScreen && <div
        className="astana-home-weather"
        aria-label={weatherData
          ? `Погода: ${Math.round(Number(weatherData.temperature_2m))} градусов, ${weatherSummary(weatherData.weather_code, weatherData.is_day)[0]}`
          : "Текущая температура загружается"}
        title={weatherData
          ? `${weatherSummary(weatherData.weather_code, weatherData.is_day)[0]} · ощущается как ${Math.round(Number(weatherData.apparent_temperature))}°C · ветер ${Math.round(Number(weatherData.wind_speed_10m))} км/ч · обновлено ${new Date(weatherData.time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
          : "Загружаем текущую погоду"}>
        <span>{weatherData ? weatherSummary(weatherData.weather_code, weatherData.is_day)[1] : weatherLoading ? "⏳" : "🌤️"}</span>
        <b>{weatherData ? `${Math.round(Number(weatherData.temperature_2m))}°C` : "—°C"}</b>
      </div>}
      {isHomeScreen && <nav className="astana-home-bottom-nav" aria-label="Главное меню">
        <button className="active" onClick={openHomeSearch}><span>▦</span><b>Поиск</b></button>
        <button onClick={() => { if (route) setShowSteps(true); else openHomeSearch(); }}><span>⌁</span><b>Проезд</b></button>
        <button onClick={() => { if (route) setNavigating(true); else openHomeSearch(); }}><span>➤</span><b>Навигатор</b></button>
        <div><span>♧</span><b>Друзья</b></div>
        <div><span>◈</span><b>Места</b></div>
      </nav>}
    </main>
  );
}
