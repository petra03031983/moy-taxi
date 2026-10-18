export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ASTANA = { lat: 51.1694, lon: 71.4491 };
const MAX_LOCAL_KM = 125;
const cache = new Map();
let lastNominatimAt = 0;

function norm(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[қ]/g, "к").replace(/[ғ]/g, "г").replace(/[ң]/g, "н")
    .replace(/[ә]/g, "а").replace(/[ө]/g, "о")
    .replace(/[і]/g, "и").replace(/[ұү]/g, "у")
    .replace(/[.,;:()[\]{}]/g, " ").replace(/№/g, " ")
    .replace(/\s+/g, " ").trim();
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function item({ title, address, lat, lon, kind = "Место", priority = 10 }, origin) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const regionDistance = distanceKm(ASTANA.lat, ASTANA.lon, lat, lon);
  const searchText = norm(`${title} ${address}`);
  return {
    title: String(title || "Адрес на карте"),
    address: String(address || title || ""),
    lat, lon,
    distance: distanceKm(origin.lat, origin.lon, lat, lon),
    isAstana: /астан|astana|нур-султан|nur-sultan/i.test(`${title} ${address}`),
    near: regionDistance <= MAX_LOCAL_KM,
    kind,
    priority,
    _searchText: searchText,
    _regionDistance: regionDistance
  };
}

const LOCAL = [
  { keys: ["аэропорт", "аэро", "airport", "нурсултан назарбаев", "нур султан назарбаев"], title: "Международный аэропорт Нурсултан Назарбаев", address: "Астана, аэропорт Нурсултан Назарбаев, Казахстан", lat: 51.0222, lon: 71.4669, kind: "Аэропорт", priority: 0 },
  { keys: ["жд вокзал", "жд", "железнодорожный вокзал", "вокзал", "railway"], title: "Железнодорожный вокзал Астана", address: "Астана, площадь Вокзальная, Казахстан", lat: 51.1807, lon: 71.4301, kind: "ЖД вокзал", priority: 0 },
  { keys: ["мега", "mega silk way", "mega silkway"], title: "MEGA Silk Way", address: "Астана, проспект Кабанбай батыра, 62", lat: 51.0898, lon: 71.4075, kind: "Торговый центр", priority: 0 },
  { keys: ["байтерек", "bәйтерек", "baiterek"], title: "Байтерек", address: "Астана, проспект Нуржол, 14", lat: 51.1282, lon: 71.4304, kind: "Достопримечательность", priority: 0 },
  { keys: ["хан шатыр", "ханшатр", "khan shatyr"], title: "Хан Шатыр", address: "Астана, проспект Туран, 37", lat: 51.1327, lon: 71.4034, kind: "Торговый центр", priority: 0 },
  { keys: ["экспо", "expo"], title: "EXPO", address: "Астана, проспект Мангилик Ел, 53/1", lat: 51.0908, lon: 71.4126, kind: "Комплекс EXPO", priority: 0 },
  { keys: ["косшы", "косши", "кошшы", "kosshy"], title: "Косшы", address: "Акмолинская область, Казахстан", lat: 50.9703, lon: 71.3554, kind: "Город", priority: 1 },
  { keys: ["коянды", "коянда", "хойанды", "койанды", "qoyandy"], title: "Коянды", address: "Целиноградский район, Акмолинская область, Казахстан", lat: 51.2759, lon: 71.6431, kind: "Село", priority: 1 },
  { keys: ["малиновка", "акмол", "aqmol", "akmol"], title: "Акмол (Малиновка)", address: "Целиноградский район, Акмолинская область, Казахстан", lat: 51.0684, lon: 70.9652, kind: "Село", priority: 1 },
  { keys: ["таләпкер", "талпакер", "талапкер", "talapker"], title: "Талапкер", address: "Целиноградский район, Акмолинская область, Казахстан", lat: 51.2441, lon: 71.1595, kind: "Село", priority: 1 }
];

function localResults(raw, origin) {
  const q = norm(raw);
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);
  return LOCAL.map(entry => {
    const matched = entry.keys.some(key => {
      const k = norm(key);
      return k.startsWith(q) || q.startsWith(k) || k.includes(q);
    });
    if (!matched) return null;
    return item(entry, origin);
  }).filter(Boolean);
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", "Accept-Language": "ru,en" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function parsePhoton(feature, raw, origin) {
  const p = feature?.properties || {};
  const xy = feature?.geometry?.coordinates;
  if (!xy || !Number.isFinite(Number(xy[0])) || !Number.isFinite(Number(xy[1]))) return null;
  const name = String(p.name || "");
  const street = String(p.street || p.road || "");
  const house = String(p.housenumber || "");
  const locality = String(p.city || p.town || p.village || p.municipality || p.suburb || "");
  let title = name || street || locality || "Адрес на карте";
  if (house && !norm(title).includes(norm(house))) title += ", " + house;
  const address = [street && norm(street) !== norm(title) ? street : "", locality, p.county, p.state, p.country].filter(Boolean).join(", ") || String(p.label || title);
  const q = norm(raw);
  const searchText = norm(`${title} ${address} ${p.type || ""} ${p.osm_key || ""} ${p.osm_value || ""}`);
  const tokens = q.split(" ").filter(t => t.length > 1);
  const matched = tokens.filter(t => searchText.includes(t)).length;
  const priority = tokens.length && matched === tokens.length ? 2 : matched ? 5 : 8;
  return item({ title, address, lat: Number(xy[1]), lon: Number(xy[0]), kind: String(p.osm_value || p.type || "Место"), priority }, origin);
}

function parseNominatim(feature, raw, origin) {
  const p = feature?.properties || {}, a = p.address || {}, xy = feature?.geometry?.coordinates;
  if (!xy || !Number.isFinite(Number(xy[0])) || !Number.isFinite(Number(xy[1]))) return null;
  const road = String(a.road || a.pedestrian || a.residential || "");
  const house = String(a.house_number || "");
  const named = String(p.name || p.namedetails?.name || a.amenity || a.shop || a.building || "");
  let title = named || [road, house].filter(Boolean).join(", ") || a.city || a.town || a.village || String(p.display_name || raw).split(",")[0];
  if (house && road && !norm(title).includes(norm(house))) title = `${road}, ${house}`;
  return item({ title, address: String(p.display_name || [road, house, a.city || a.town || a.village, a.state, a.country].filter(Boolean).join(", ")), lat: Number(xy[1]), lon: Number(xy[0]), kind: String(p.type || p.class || "Место"), priority: 4 }, origin);
}

function merge(target, candidate) {
  if (!candidate) return;
  const key = `${norm(candidate.title)}|${candidate.lat.toFixed(4)}|${candidate.lon.toFixed(4)}`;
  const old = target.get(key);
  if (!old || candidate.priority < old.priority) target.set(key, candidate);
}

function isExplicitFarSearch(q) {
  return /(алматы|шымкент|караганд|кокшетау|павлодар|тараз|атырау|актобе|костанай|петропавловск|усть-каменогорск)/i.test(q);
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
  if (raw.length < 1) return Response.json({ results: [] });

  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  const origin = { lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : ASTANA.lat, lon: Number.isFinite(lon) && Math.abs(lon) <= 180 ? lon : ASTANA.lon };
  const cacheKey = `${norm(raw)}|${origin.lat.toFixed(2)}|${origin.lon.toFixed(2)}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < 90_000) return Response.json({ results: hit.results, cached: true });

  const merged = new Map();
  for (const candidate of localResults(raw, origin)) merge(merged, candidate);

  const explicit = isExplicitFarSearch(raw);
  const queries = [...new Set([raw, `${raw}, Астана, Казахстан`, `${raw}, Казахстан`])].slice(0, 3);
  const fetched = await Promise.allSettled(queries.map(q => photonSearch(q, origin)));
  for (const result of fetched) {
    if (result.status !== "fulfilled") continue;
    for (const candidate of result.value) {
      if (!explicit && candidate._regionDistance > MAX_LOCAL_KM) continue;
      merge(merged, candidate);
    }
  }

  if (merged.size < 5 && !explicit) {
    try {
      const fallback = await nominatimSearch(`${raw}, Астана, Казахстан`, origin);
      for (const candidate of fallback) {
        if (!explicit && candidate._regionDistance > MAX_LOCAL_KM) continue;
        merge(merged, candidate);
      }
    } catch (_) {}
  }

  const results = [...merged.values()]
    .sort((a, b) => a.priority - b.priority || a.distance - b.distance)
    .slice(0, 30)
    .map(({ _searchText, _regionDistance, kind, priority, ...result }) => result);

  cache.set(cacheKey, { at: Date.now(), results });
  return Response.json({ results, query: raw, source: "Photon + OpenStreetMap + local Astana aliases" }, { headers: { "Cache-Control": "private, max-age=20, stale-while-revalidate=60" } });
}
