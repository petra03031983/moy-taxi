export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ASTANA = { lat: 51.1694, lon: 71.4491 };
const MAX_LOCAL_KM = 125;
const cache = new Map();
let lastNominatimAt = 0;

function norm(value) {
  return String(value || "").toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[қ]/g, "к").replace(/[ғ]/g, "г").replace(/[ң]/g, "н")
    .replace(/[ә]/g, "а").replace(/[ө]/g, "о").replace(/[і]/g, "и")
    .replace(/[ұү]/g, "у")
    .replace(/[.,;:()[\]{}]/g, " ")
    .replace(/№/g, " ")
    .replace(/\s+/g, " ").trim();
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function intentFor(raw) {
  const q = norm(raw);
  const compact = q.replace(/\s/g, "");
  const forestAddress = /(лесная|lesnaya)/.test(q) && /(поляна|polyana)/.test(q) && /(^|\s)16($|\s)/.test(q);
  if (forestAddress) return { type: "lesnaya16", canonical: "Лесная поляна, 16", queries: [
    "Лесная поляна, 16, Косшы, Акмолинская область, Казахстан",
    "микрорайон Лесная Поляна, дом 16, Косшы",
    "Lesnaya Polyana 16, Kosshy, Kazakhstan"
  ]};

  if (/^(хоша|коша|косша|кошша|коши|косши|косшы|кошшы|qosha|kosha|qossha|qosshy|kosshy|kosshi|koschi|koshy)$/.test(compact))
    return { type: "kosshy", canonical: "Косшы", queries: ["Косшы, Акмолинская область, Казахстан", "Kosshy, Kazakhstan"] };
  if (/^(коянда|коянды|хойанды|койанды|koyanda|koyandy|koyandi|qoyandy)$/.test(compact))
    return { type: "koyandy", canonical: "Коянды", queries: ["Коянды, Акмолинская область, Казахстан", "Қоянды, Қазақстан"] };
  if (/^(малиновка|акмол|aqmol|akmol|malinovka)$/.test(compact))
    return { type: "malinovka", canonical: "Акмол (Малиновка)", queries: ["Акмол (Малиновка), Акмолинская область, Казахстан", "Akmol, Kazakhstan"] };
  if (/^(талапкер|талпакер|talapker)$/.test(compact))
    return { type: "talapker", canonical: "Талапкер", queries: ["Талапкер, Акмолинская область, Казахстан", "Talapker, Kazakhstan"] };

  const queries = [String(raw).trim()];
  if (!/астана|astana/i.test(raw)) queries.push(String(raw).trim() + ", Астана, Казахстан");
  if (/(лесная|lesnaya)/.test(q) && /(поляна|polyana)/.test(q))
    queries.push("Лесная поляна, Косшы, Акмолинская область, Казахстан");
  return { type: "general", canonical: String(raw).trim(), queries: [...new Set(queries)] };
}

function item({ title, address, lat, lon, kind = "Место", source = "OpenStreetMap", priority = 10 }, origin) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const regionDistance = distanceKm(ASTANA.lat, ASTANA.lon, lat, lon);
  const isAstana = /астан|astana|нур-султан|nur-sultan/i.test(String(address || "") + " " + String(title || ""));
  return {
    title: String(title || "Адрес на карте"),
    address: String(address || title || ""),
    lat, lon, distance: distanceKm(origin.lat, origin.lon, lat, lon),
    isAstana, near: regionDistance <= MAX_LOCAL_KM,
    regionDistance, kind, source, priority
  };
}

function knownLocalResult(type, origin) {
  const entries = {
    lesnaya16: {
      title: "Улица Лесная поляна, 16",
      address: "Косшы, микрорайон Лесная Поляна, Акмолинская область, Казахстан",
      lat: 51.003308, lon: 71.375615, kind: "Адрес · дом 16", priority: 0
    },
    kosshy: {
      title: "Косшы",
      address: "Акмолинская область, Казахстан",
      lat: 50.970257, lon: 71.355375, kind: "Город · ориентир", priority: 1
    },
    koyandy: {
      title: "Коянды",
      address: "Целиноградский район, Акмолинская область, Казахстан",
      lat: 51.275875, lon: 71.643096, kind: "Село · ориентир", priority: 1
    },
    malinovka: {
      title: "Акмол (Малиновка)",
      address: "Целиноградский район, Акмолинская область, Казахстан",
      lat: 51.068440, lon: 70.965240, kind: "Село · ориентир", priority: 1
    },
    talapker: {
      title: "Талапкер",
      address: "Целиноградский район, Акмолинская область, Казахстан",
      lat: 51.244103, lon: 71.159497, kind: "Село · ориентир", priority: 1
    }
  };
  const d = entries[type];
  if (!d) return null;
  return item({ ...d, source: "Местный справочный адрес" }, origin);
}

async function fetchJson(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json", "Accept-Language": "ru,en" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parsePhoton(feature, raw, origin) {
  const p = feature?.properties || {};
  const xy = feature?.geometry?.coordinates;
  if (!xy || !Number.isFinite(Number(xy[0])) || !Number.isFinite(Number(xy[1]))) return null;

  const name = String(p.name || "");
  const street = String(p.street || "");
  const house = String(p.housenumber || "");
  const locality = String(p.city || p.town || p.village || p.municipality || p.suburb || "");
  let title = name || street || p.locality || locality || "Адрес на карте";
  if (house && !norm(title).split(" ").includes(norm(house))) title += ", " + house;

  const addressParts = [street && norm(street) !== norm(title) ? street : "", locality, p.county, p.state, p.country]
    .filter(Boolean).map(String);
  const address = [...new Set(addressParts)].join(", ") || String(p.label || "");
  const q = norm(raw), searchText = norm([title, address, p.type, p.osm_key, p.osm_value].join(" "));
  const tokens = q.split(" ").filter(t => t.length > 1);
  const matched = tokens.filter(t => searchText.includes(t)).length;
  const rank = matched === tokens.length ? 0 : matched ? 2 : 8;

  return item({
    title, address, lat: Number(xy[1]), lon: Number(xy[0]),
    kind: String(p.osm_value || p.type || "Место"),
    source: "OpenStreetMap", priority: rank + 4
  }, origin);
}

function parseNominatim(feature, raw, origin) {
  const p = feature?.properties || {};
  const a = p.address || {};
  const xy = feature?.geometry?.coordinates;
  if (!xy || !Number.isFinite(Number(xy[0])) || !Number.isFinite(Number(xy[1]))) return null;

  const road = String(a.road || a.pedestrian || a.residential || "");
  const house = String(a.house_number || "");
  const named = String(p.name || p.namedetails?.name || a.amenity || a.shop || a.building || "");
  let title = named || [road, house].filter(Boolean).join(", ") || a.city || a.town || a.village || String(p.display_name || raw).split(",")[0];
  if (house && road && !norm(title).includes(norm(house))) title = road + ", " + house;

  return item({
    title,
    address: String(p.display_name || [road, house, a.city || a.town || a.village, a.state, a.country].filter(Boolean).join(", ")),
    lat: Number(xy[1]), lon: Number(xy[0]),
    kind: String(p.type || p.class || "Место"),
    source: "OpenStreetMap", priority: 5
  }, origin);
}

function merge(target, candidate) {
  if (!candidate) return;
  const key = norm(candidate.title) + "|" + candidate.lat.toFixed(4) + "|" + candidate.lon.toFixed(4);
  const old = target.get(key);
  if (!old || candidate.priority < old.priority) target.set(key, candidate);
}

function isExplicitFarSearch(q) {
  return /(алматы|шымкент|караганд|кокшетау|павлодар|тараз|атырау|актобе|костанай|петропавловск|усть-каменогорск)/i.test(q);
}

function buildPhotonQueries(raw, intent) {
  const all = [...intent.queries];
  if (intent.type === "general" && !/казахстан|kazakhstan/i.test(raw)) {
    all.push(raw + ", Казахстан");
  }
  return [...new Set(all)].slice(0, 4);
}

async function photonSearch(query, origin) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "30");
  url.searchParams.set("lang", "ru");
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lon", String(origin.lon));
  const data = await fetchJson(url.toString(), 5000);
  return (data.features || []).map(f => parsePhoton(f, query, origin)).filter(Boolean);
}

async function nominatimSearch(query, origin) {
  // Respect the public Nominatim server's request rate; it is a fallback only.
  const wait = Math.max(0, 1100 - (Date.now() - lastNominatimAt));
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatimAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "geojson");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("limit", "25");
  url.searchParams.set("countrycodes", "kz");
  url.searchParams.set("accept-language", "ru");
  url.searchParams.set("q", query);
  const data = await fetchJson(url.toString(), 6500);
  return (data.features || []).map(f => parseNominatim(f, query, origin)).filter(Boolean);
}

export async function GET(request) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get("q") || "").trim();
  if (raw.length < 2) return Response.json({ results: [] });

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const origin = {
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : ASTANA.lat,
    lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : ASTANA.lon
  };
  const intent = intentFor(raw);
  const cacheKey = norm(raw) + "|" + origin.lat.toFixed(2) + "|" + origin.lon.toFixed(2);
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 90_000) {
    return Response.json({ results: hit.results, cached: true }, { headers: { "Cache-Control": "private, max-age=20" } });
  }

  const merged = new Map();
  const known = knownLocalResult(intent.type, origin);
  merge(merged, known);

  let providerCount = 0;
  const queries = buildPhotonQueries(raw, intent);
  const fetched = await Promise.allSettled(queries.map(q => photonSearch(q, origin)));
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    for (const candidate of result.value) {
      // Without an explicit far-away city, do not show unrelated places hundreds of kilometres away.
      if (!isExplicitFarSearch(raw) && candidate.regionDistance > MAX_LOCAL_KM) continue;
      merge(merged, candidate);
      providerCount++;
    }
  }

  if (providerCount < 3 && !isExplicitFarSearch(raw)) {
    let fallbackQuery = raw;
    if (intent.type === "lesnaya16") fallbackQuery = "Лесная поляна, 16, Косшы, Акмолинская область, Казахстан";
    else if (intent.type === "kosshy") fallbackQuery = "Косшы, Акмолинская область, Казахстан";
    else if (intent.type === "koyandy") fallbackQuery = "Коянды, Акмолинская область, Казахстан";
    else if (intent.type === "malinovka") fallbackQuery = "Акмол (Малиновка), Акмолинская область, Казахстан";
    else if (intent.type === "talapker") fallbackQuery = "Талапкер, Акмолинская область, Казахстан";
    else if (!/астана|astana/i.test(raw)) fallbackQuery = raw + ", Астана, Казахстан";

    try {
      const candidates = await nominatimSearch(fallbackQuery, origin);
      for (const candidate of candidates) {
        if (!isExplicitFarSearch(raw) && candidate.regionDistance > MAX_LOCAL_KM) continue;
        merge(merged, candidate);
      }
    } catch (_) {
      // Local exact fallbacks remain available if a public geocoder is down.
    }
  }

  const results = [...merged.values()]
    .filter(x => isExplicitFarSearch(raw) || x.regionDistance <= MAX_LOCAL_KM)
    .sort((a, b) => a.priority - b.priority || Number(b.isAstana) - Number(a.isAstana) ||
      a.distance - b.distance)
    .slice(0, 30)
    .map(({ regionDistance, kind, source, priority, ...x }) => x);

  cache.set(cacheKey, { at: Date.now(), results });
  return Response.json({ results, query: raw, source: "Photon + OpenStreetMap + local fallback" }, {
    headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" }
  });
}
