export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PHOTON_API = "https://photon.komoot.io/api/";
const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 16;
const PHOTON_TIMEOUT_MS = 6500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

// Astana + nearby settlements. Photon uses minLon,minLat,maxLon,maxLat.
const ASTANA_BBOX = "71.00,50.85,71.85,51.40";
const ASTANA_CENTER = { lat: 51.1694, lon: 71.4491 };

const CURATED_PLACES = [
  {
    id: "W507841374",
    name: "Международный аэропорт Нурсултан Назарбаев",
    aliases: [
      "аэропорт", "әуежай", "airport", "nqz", "uacc",
      "нурсултан", "нурсултан назарбаев", "международный аэропорт астаны",
      "астана халықаралық әуежайы",
    ],
    lat: 51.02589,
    lon: 71.46629,
    osm_type: "W",
    osm_id: 507841374,
    osm_key: "aeroway",
    osm_value: "aerodrome",
    street: "",
    housenumber: "",
    display_name: "Международный аэропорт Нурсултан Назарбаев, Астана, Казахстан",
  },
  {
    id: "W166500593",
    name: "Терминал T2 — аэропорт Астаны",
    aliases: ["терминал t2", "терминал 2", "t2 аэропорт", "внутренний терминал"],
    lat: 51.02697,
    lon: 71.46082,
    osm_type: "W",
    osm_id: 166500593,
    osm_key: "aeroway",
    osm_value: "terminal",
    street: "проспект Кабанбай батыра",
    housenumber: "119",
    display_name: "Терминал T2, проспект Кабанбай батыра, 119, Астана",
  },
  {
    id: "W460703779",
    name: "Хан Шатыр",
    aliases: ["хан шатыр", "ханшатыр", "khan shatyr"],
    lat: 51.13251,
    lon: 71.40387,
    osm_type: "W",
    osm_id: 460703779,
    osm_key: "shop",
    osm_value: "mall",
    street: "проспект Туран",
    housenumber: "37",
    display_name: "ТРЦ Хан Шатыр, проспект Туран, 37, Астана",
  },
  {
    id: "W108096984",
    name: "ТРЦ Керуен",
    aliases: ["керуен", "keruen", "трц керуен", "торговый центр керуен"],
    lat: 51.12779,
    lon: 71.42531,
    osm_type: "W",
    osm_id: 108096984,
    osm_key: "shop",
    osm_value: "mall",
    street: "улица Достык",
    housenumber: "9",
    display_name: "ТРЦ Керуен, улица Достык, 9, Астана",
  },
  {
    id: "W499328514",
    name: "MEGA Silk Way",
    aliases: ["mega silk way", "мега силк вей", "мега силквей", "mega", "мега"],
    lat: 51.08909,
    lon: 71.40733,
    osm_type: "W",
    osm_id: 499328514,
    osm_key: "shop",
    osm_value: "mall",
    street: "проспект Кабанбай батыра",
    housenumber: "62",
    display_name: "ТРЦ MEGA Silk Way, проспект Кабанбай батыра, 62, Астана",
  },
  {
    id: "N4020137343",
    name: "Железнодорожный вокзал Астана-1",
    aliases: ["жд вокзал", "ж/д вокзал", "железнодорожный вокзал", "астана-1", "астана 1", "старый вокзал", "вокзал гете"],
    lat: 51.1958965,
    lon: 71.4099867,
    osm_type: "N",
    osm_id: 4020137343,
    osm_key: "railway",
    osm_value: "station",
    street: "улица Гёте",
    housenumber: "",
    display_name: "Железнодорожный вокзал Астана-1, улица Гёте, Астана",
  },
  {
    id: "N13612447905",
    name: "Железнодорожный вокзал Нурлы Жол",
    aliases: ["жд вокзал", "ж/д вокзал", "железнодорожный вокзал", "нурлы жол", "нурлыжол", "nurly zhol", "вокзал нурлы жол", "новый вокзал"],
    lat: 51.1119775,
    lon: 71.5288523,
    osm_type: "N",
    osm_id: 13612447905,
    osm_key: "railway",
    osm_value: "station",
    street: "улица Мухамеджан Тынышбайулы",
    housenumber: "",
    display_name: "Железнодорожный вокзал Нурлы Жол, улица Мухамеджан Тынышбайулы, Астана",
  },
];

function json(body, status = 200, cacheSeconds = 30) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, max-age=3, s-maxage=" + cacheSeconds + ", stale-while-revalidate=300"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Astana-Search-Source": "openstreetmap-photon",
    },
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/ж\s*[./-]\s*д/g, "железнодорожный")
    .replace(/\s+/g, " ")
    .trim();
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function getCache() {
  if (!globalThis.__astanaPhotonSearchCache) {
    globalThis.__astanaPhotonSearchCache = new Map();
  }
  if (!globalThis.__astanaPhotonSearchInflight) {
    globalThis.__astanaPhotonSearchInflight = new Map();
  }
  return {
    cache: globalThis.__astanaPhotonSearchCache,
    inflight: globalThis.__astanaPhotonSearchInflight,
  };
}

function matchesAirport(query) {
  return /аэропорт|әуежай|airport|nqz|uacc|нурсултан/.test(query);
}

function matchesGenericMall(query) {
  return /^(тц|трц|т\.ц\.?)$/.test(query) ||
    /торгов(ый|о-развлекательн)(ый)? центр|shopping mall|shopping centre|молл/.test(query);
}

function matchesStation(query) {
  return /вокзал|железнодорожн|(^|\s)жд($|\s)|станци|temirzhol/.test(query);
}

function normalizeStreet(value) {
  return normalize(value)
    .replace(/^(улица|ул\.?|проспект|пр-т|пр\.?|даңғылы|көшесі)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesCuratedAddress(query, place) {
  const house = normalize(place.housenumber);
  const street = normalizeStreet(place.street);
  if (!house || !street || !query.includes(house)) return false;
  const words = street.split(/\s+/).filter(word => word.length > 2);
  return words.length > 0 && words.every(word => query.includes(word));
}

function curatedFeatures(query) {
  const airport = matchesAirport(query);
  const genericMall = matchesGenericMall(query);

  const station = matchesStation(query);

  return CURATED_PLACES
    .filter(place => {
      if (airport && place.osm_key === "aeroway") return true;
      if (genericMall && place.osm_value === "mall") return true;
      if (station && place.osm_key === "railway" && place.osm_value === "station") return true;
      if (matchesCuratedAddress(query, place)) return true;
      return place.aliases.some(alias => {
        const candidate = normalize(alias);
        return query.length >= 3 && (
          candidate.includes(query) ||
          query.includes(candidate)
        );
      });
    })
    .map(place => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [place.lon, place.lat],
      },
      properties: {
        name: place.name,
        country: "Казахстан",
        countrycode: "KZ",
        city: "Астана",
        street: place.street,
        housenumber: place.housenumber,
        osm_key: place.osm_key,
        osm_value: place.osm_value,
        osm_type: place.osm_type,
        osm_id: place.osm_id,
        display_name: place.display_name,
        extra: {
          source: "OpenStreetMap curated OSM object",
          aeroway: place.osm_key === "aeroway" ? place.osm_value : undefined,
          shop: place.osm_key === "shop" ? place.osm_value : undefined,
        },
      },
    }));
}

function featureIdentity(feature) {
  const properties = feature?.properties || {};
  const type = String(properties.osm_type || "").toUpperCase();
  const id = String(properties.osm_id || "");
  if (/^(N|W|R)$/.test(type) && /^\d+$/.test(id)) return type + ":" + id;

  const coordinates = feature?.geometry?.coordinates;
  if (Array.isArray(coordinates)) {
    return normalize(properties.name) + ":" +
      Number(coordinates[0]).toFixed(5) + ":" +
      Number(coordinates[1]).toFixed(5);
  }
  return normalize(properties.name || properties.street || "");
}

function curatedFirst(query) {
  return matchesAirport(query) || matchesGenericMall(query) || matchesStation(query) ||
    CURATED_PLACES.some(place =>
      matchesCuratedAddress(query, place) ||
      place.aliases.some(alias => {
        const candidate = normalize(alias);
        return query.length >= 3 && candidate.includes(query);
      })
    );
}

async function fetchPhoton(term, options, signal) {
  const url = new URL(PHOTON_API);
  url.searchParams.set("q", term);
  url.searchParams.set("limit", String(options.limit));
  url.searchParams.set("lang", "default");
  url.searchParams.set("countrycode", "KZ");
  url.searchParams.set("bbox", ASTANA_BBOX);
  url.searchParams.set("lat", String(options.lat));
  url.searchParams.set("lon", String(options.lon));
  url.searchParams.set("zoom", "12");
  url.searchParams.set("location_bias_scale", "0.15");
  url.searchParams.set("dedupe", "1");
  if (options.osmTag) url.searchParams.append("osm_tag", options.osmTag);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/geo+json, application/json",
      "User-Agent": "AstanaGuide/1.0 (https://astana-map-roads.vercel.app/; OpenStreetMap search)",
      Referer: "https://astana-map-roads.vercel.app/",
    },
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    const error = new Error("Photon HTTP " + response.status);
    error.status = response.status;
    throw error;
  }

  const payload = await response.json();
  return Array.isArray(payload?.features) ? payload.features : [];
}

function queryVariants(query) {
  const variants = [{ term: query, osmTag: "" }];
  if (matchesAirport(query)) {
    variants.push({
      term: "Nursultan Nazarbayev International Airport",
      osmTag: "aeroway:aerodrome",
    });
  } else if (matchesGenericMall(query)) {
    variants.push({ term: "shopping mall Astana", osmTag: "" });
  } else if (matchesStation(query)) {
    variants.push({ term: "Nurly Zhol station Astana", osmTag: "" });
    variants.push({ term: "Astana-1", osmTag: "" });
  }
  return variants;
}

function dedupeFeatures(features, query) {
  const unique = [];
  const seen = new Set();
  const curatedPriority = curatedFirst(query);

  const sorted = curatedPriority
    ? [
        ...features.filter(feature => feature?.properties?.extra?.source === "OpenStreetMap curated OSM object"),
        ...features.filter(feature => feature?.properties?.extra?.source !== "OpenStreetMap curated OSM object"),
      ]
    : features;

  for (const feature of sorted) {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lon < 70.8 || lon > 72.0 || lat < 50.7 || lat > 51.55) continue;

    const key = featureIdentity(feature);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(feature);
  }
  return unique;
}

export async function GET(request) {
  const incoming = new URL(request.url);
  const query = String(incoming.searchParams.get("q") || "")
    .trim()
    .replace(/\s+/g, " ");
  if (query.length < 2) return json({ features: [], count: 0 });
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ error: "Слишком длинный поисковый запрос." }, 400, 0);
  }

  const requestedLimit = Number(incoming.searchParams.get("limit") || 12);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(requestedLimit)))
    : 12;

  const lat = validCoordinate(incoming.searchParams.get("lat"), -90, 90) ?? ASTANA_CENTER.lat;
  const lon = validCoordinate(incoming.searchParams.get("lon"), -180, 180) ?? ASTANA_CENTER.lon;
  const normalizedQuery = normalize(query);
  const key = [normalizedQuery, limit, lat.toFixed(3), lon.toFixed(3)].join("|");
  const { cache, inflight } = getCache();
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && now - cached.savedAt < CACHE_TTL_MS) {
    return json(cached.value, 200, 120);
  }
  if (inflight.has(key)) {
    try {
      return json(await inflight.get(key), 200, 60);
    } catch {}
  }

  const task = (async () => {
    const localCurated = curatedFeatures(normalizedQuery);
    const variants = queryVariants(query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PHOTON_TIMEOUT_MS);
    let providerFeatures = [];
    let providerError = null;

    try {
      const results = await Promise.allSettled(
        variants.map(variant => fetchPhoton(variant.term, {
          limit,
          lat,
          lon,
          osmTag: variant.osmTag,
        }, controller.signal))
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          providerFeatures.push(...result.value);
        } else {
          providerError = result.reason;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const features = dedupeFeatures(
      curatedFirst(normalizedQuery)
        ? [...localCurated, ...providerFeatures]
        : [...providerFeatures, ...localCurated],
      normalizedQuery
    ).slice(0, limit);

    if (!providerFeatures.length && !features.length) {
      throw providerError || new Error("Photon вернул пустой ответ.");
    }

    const value = {
      features,
      count: features.length,
      provider: "OpenStreetMap / Photon",
      partial: !providerFeatures.length,
    };

    cache.set(key, { savedAt: Date.now(), value });
    if (cache.size > 500) {
      for (const [cacheKey, entry] of cache) {
        if (now - entry.savedAt > STALE_TTL_MS) cache.delete(cacheKey);
        if (cache.size <= 350) break;
      }
    }
    return value;
  })();

  inflight.set(key, task);
  try {
    const value = await task;
    return json(value, 200, 120);
  } catch (error) {
    if (cached && now - cached.savedAt < STALE_TTL_MS) {
      return json({ ...cached.value, stale: true }, 200, 60);
    }
    const limited = Number(error?.status) === 429;
    return json({
      error: limited
        ? "Бесплатный поиск OpenStreetMap временно ограничил запросы. Повтори поиск через несколько секунд."
        : "Сервис OpenStreetMap сейчас не ответил. Проверь интернет и попробуй ещё раз.",
      providerStatus: Number(error?.status) || 502,
      features: [],
      count: 0,
    }, limited ? 503 : 502, 0);
  } finally {
    inflight.delete(key);
  }
}
