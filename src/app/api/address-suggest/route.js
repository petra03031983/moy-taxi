export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASTANA = { lat: 51.1694, lon: 71.4491 };
const RADIUS_KM = 100;

function norm(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[қ]/g, "к").replace(/[ғ]/g, "г").replace(/[ң]/g, "н")
    .replace(/[ә]/g, "а").replace(/[ө]/g, "о").replace(/[і]/g, "и")
    .replace(/[ұү]/g, "у")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function cityFrom(parts) {
  const values = (parts || []).map(x => String(x || "")).filter(Boolean);
  return values.find(x => /астан|нур.?султан|косш|коянд|малинов|акмол|тал[аә]пкер|кызыл|камен/i.test(x)) || values[0] || "Казахстан";
}

function makeResult({ name, label, city, lat, lon, query, origin }) {
  const d = distanceKm(origin.lat, origin.lon, lat, lon);
  const text = norm([name, label, city].join(" "));
  const q = norm(query);
  const tokens = q.split(" ").filter(Boolean);
  const matched = tokens.filter(token => text.includes(token)).length;
  const exact = norm(name) === q || norm(label) === q;
  const isAstana = /астан|нур.?султан/i.test(text);
  const regionDistance = distanceKm(ASTANA.lat, ASTANA.lon, lat, lon);
  return {
    name: name || label || "Место",
    label: label || name || "Адрес",
    city: city || "Казахстан",
    lat,
    lng: lon,
    distance_km: Number(d.toFixed(1)),
    distance: Number(d.toFixed(1)),
    isAstana,
    regionDistance,
    _rank: exact ? 0 : matched === tokens.length ? 1 : matched ? 2 : 5
  };
}

function knownPlace(query, origin) {
  const q = norm(query).replace(/\s/g, "");
  const places = [
    ["косшы", "Косшы", "Косшы, Акмолинская область, Казахстан", 50.970257, 71.355375],
    ["коянды", "Коянды", "Коянды, Акмолинская область, Казахстан", 51.275875, 71.643096],
    ["хойанды", "Коянды", "Коянды, Акмолинская область, Казахстан", 51.275875, 71.643096],
    ["малиновка", "Акмол (Малиновка)", "Акмол, Акмолинская область, Казахстан", 51.068440, 70.965240],
    ["акмол", "Акмол (Малиновка)", "Акмол, Акмолинская область, Казахстан", 51.068440, 70.965240],
    ["талапкер", "Талапкер", "Талапкер, Акмолинская область, Казахстан", 51.244103, 71.159497],
    ["мега", "MEGA Silk Way", "Астана, проспект Кабанбай батыра, 62", 51.090430, 71.418520]
  ];
  const found = places.find(x => q === x[0]);
  return found ? makeResult({ name: found[1], label: found[2], city: found[2].split(",")[0], lat: found[3], lon: found[4], query, origin }) : null;
}

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "Accept": "application/json", "Accept-Language": "ru,en" } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function photon(query, origin) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "40");
  url.searchParams.set("lang", "ru");
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lon", String(origin.lon));
  const data = await fetchJson(url.toString());
  return (data.features || []).map(feature => {
    const p = feature?.properties || {};
    const xy = feature?.geometry?.coordinates;
    const lat = Number(xy?.[1]), lon = Number(xy?.[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const name = String(p.name || p.street || p.city || p.town || p.village || "Место");
    const house = String(p.housenumber || "");
    const label = [p.name || p.street, house, p.city || p.town || p.village || p.municipality, p.state, p.country]
      .filter(Boolean).join(", ");
    const city = cityFrom([p.city, p.town, p.village, p.municipality, p.suburb, p.county]);
    return makeResult({ name: house && p.street ? `${p.street}, ${house}` : name, label: label || name, city, lat, lon, query, origin });
  }).filter(Boolean);
}

async function nominatim(query, origin) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("limit", "30");
  url.searchParams.set("countrycodes", "kz");
  url.searchParams.set("accept-language", "ru");
  url.searchParams.set("q", query);
  const data = await fetchJson(url.toString(), 7000);
  return (data || []).map(item => {
    const lat = Number(item.lat), lon = Number(item.lon), a = item.address || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const name = String(item.name || a.road || a.city || a.town || a.village || "Место");
    const label = String(item.display_name || name);
    const city = cityFrom([a.city, a.town, a.village, a.municipality, a.county]);
    return makeResult({ name, label, city, lat, lon, query, origin });
  }).filter(Boolean);
}

export async function GET(request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2) return Response.json({ suggestions: [] });

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const origin = {
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : ASTANA.lat,
    lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : ASTANA.lon
  };

  const local = knownPlace(query, origin);
  const merged = new Map();
  if (local) merged.set(norm(local.label) + local.lat.toFixed(4), local);

  const add = item => {
    if (!item || item.regionDistance > RADIUS_KM) return;
    const key = norm(item.label) + item.lat.toFixed(4) + item.lng.toFixed(4);
    if (!merged.has(key)) merged.set(key, item);
  };

  const queries = [query];
  if (!/астана|косш|коянд|малинов|акмол|тал[аә]пкер/i.test(query)) queries.push(`${query}, Астана, Казахстан`);

  const photonResults = await Promise.allSettled(queries.map(q => photon(q, origin)));
  for (const result of photonResults) if (result.status === "fulfilled") result.value.forEach(add);

  if (merged.size < 3) {
    const nom = await Promise.allSettled(queries.slice(0, 2).map(q => nominatim(q, origin)));
    for (const result of nom) if (result.status === "fulfilled") result.value.forEach(add);
  }

  const results = [...merged.values()]
    .sort((a, b) => {
      if (a._rank !== b._rank) return a._rank - b._rank;
      if (a.isAstana !== b.isAstana) return a.isAstana ? -1 : 1;
      return a.distance - b.distance;
    })
    .slice(0, 12)
    .map(({ _rank, regionDistance, isAstana, ...item }) => item);

  return Response.json({ ok: true, suggestions: results, query }, { headers: { "Cache-Control": "no-store" } });
}
