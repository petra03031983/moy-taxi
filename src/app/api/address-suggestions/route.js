const PHOTON_API = "https://photon.komoot.io/api/";
const CACHE_TTL_MS = 20_000;
const STALE_TTL_MS = 120_000;
const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 12;
const ALLOWED_LAYERS = [
  "house",
  "street",
  "locality",
  "district",
  "city",
  "county",
  "state",
  "country",
  "other",
];

// The public Photon demo asks API consumers to identify their application
// and keep usage reasonable. All browser requests are proxied through here,
// cached briefly, and sent with the official Astana Guide site identity.
const memoryCache = new Map();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, max-age=10, s-maxage=20, stale-while-revalidate=60"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function makeCacheKey(params) {
  return [
    String(params.get("q") || "").trim().toLocaleLowerCase("ru-RU"),
    params.get("lat") || "",
    params.get("lon") || "",
    params.get("limit") || "12",
  ].join("|");
}

export async function GET(request) {
  const incoming = new URL(request.url);
  const query = String(incoming.searchParams.get("q") || "").trim().replace(/\s+/g, " ");
  if (query.length < 2) {
    return json({ features: [] });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ error: "Слишком длинный поисковый запрос." }, 400);
  }

  const rawLimit = Number(incoming.searchParams.get("limit") || 12);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(rawLimit)))
    : 12;

  const lat = validCoordinate(incoming.searchParams.get("lat"), -90, 90);
  const lon = validCoordinate(incoming.searchParams.get("lon"), -180, 180);
  const keyParams = new URLSearchParams({ q: query, limit: String(limit) });
  if (lat !== null && lon !== null) {
    keyParams.set("lat", String(lat.toFixed(4)));
    keyParams.set("lon", String(lon.toFixed(4)));
  }
  const cacheKey = makeCacheKey(keyParams);
  const now = Date.now();
  const cached = memoryCache.get(cacheKey);
  if (cached && now - cached.savedAt < CACHE_TTL_MS) {
    return json({ features: cached.features, cached: true }, 200, {
      "X-Address-Search-Cache": "HIT",
    });
  }

  const overpassKey = String(process.env.OVERPASS_CH_API_KEY || "").trim();
  const providers = [];
  if (overpassKey) {
    providers.push({
      name: "Overpass.ch",
      url: "https://api.overpass.ch/v1/" + encodeURIComponent(overpassKey) + "/geocode/api",
    });
  }
  providers.push({ name: "Photon", url: PHOTON_API });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  const requestAbort = () => controller.abort();
  request.signal?.addEventListener("abort", requestAbort, { once: true });
  let lastProviderError = null;

  try {
    for (const provider of providers) {
      if (controller.signal.aborted) break;
      const providerUrl = new URL(provider.url);
      providerUrl.searchParams.set("q", query);
      providerUrl.searchParams.set("limit", String(limit));
      providerUrl.searchParams.set("lang", "ru");
      providerUrl.searchParams.set("countrycode", "KZ");
      providerUrl.searchParams.set("dedupe", "1");

      for (const layer of ALLOWED_LAYERS) {
        providerUrl.searchParams.append("layer", layer);
      }

      if (lat !== null && lon !== null) {
        providerUrl.searchParams.set("lat", String(lat));
        providerUrl.searchParams.set("lon", String(lon));
        providerUrl.searchParams.set("zoom", "13");
        providerUrl.searchParams.set("location_bias_scale", "0.2");
      }

      try {
        const response = await fetch(providerUrl.toString(), {
          method: "GET",
          headers: {
            Accept: "application/geo+json, application/json",
            "Accept-Language": "ru-RU,ru;q=0.9,kk;q=0.8,en;q=0.7",
            "User-Agent": "AstanaGuide/1.0 (https://astana-map-roads.vercel.app/; address search)",
            Referer: "https://astana-map-roads.vercel.app/",
          },
          signal: controller.signal,
          cache: "no-store",
        });

        if (response.status === 429) {
          lastProviderError = {
            provider: provider.name,
            status: 429,
            retryAfter: response.headers.get("Retry-After") || "",
          };
          continue;
        }

        if (!response.ok) {
          const responseText = await response.text().catch(() => "");
          lastProviderError = {
            provider: provider.name,
            status: response.status,
            detail: String(responseText || "").slice(0, 140),
          };
          continue;
        }

        const payload = await response.json();
        if (!Array.isArray(payload?.features)) {
          lastProviderError = {
            provider: provider.name,
            status: 502,
            detail: "Некорректный формат GeoJSON",
          };
          continue;
        }

        const features = payload.features.slice(0, limit);
        memoryCache.set(cacheKey, { savedAt: Date.now(), features });
        if (memoryCache.size > 300) {
          for (const [key, value] of memoryCache) {
            if (now - value.savedAt > STALE_TTL_MS) memoryCache.delete(key);
            if (memoryCache.size <= 220) break;
          }
        }

        return json({
          features,
          cached: false,
          provider: provider.name,
        }, 200, {
          "X-Address-Search-Cache": "MISS",
          "X-Address-Search-Provider": provider.name,
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        lastProviderError = {
          provider: provider.name,
          status: 502,
          detail: String(error?.message || "network error").slice(0, 140),
        };
      }
    }

    if (cached && Date.now() - cached.savedAt < STALE_TTL_MS) {
      return json({
        features: cached.features,
        cached: true,
        stale: true,
        providerError: lastProviderError,
      }, 200, { "X-Address-Search-Cache": "STALE" });
    }

    if (lastProviderError?.status === 429) {
      return json({
        error: "Сервис адресов временно ограничил запросы. Попробуй ещё раз через несколько секунд.",
        providerStatus: 429,
        provider: lastProviderError.provider,
      }, 503, {
        "Retry-After": lastProviderError.retryAfter || "10",
      });
    }

    const needsKey = !overpassKey && lastProviderError?.provider === "Photon";
    return json({
      error: needsKey
        ? "Публичный Photon временно недоступен. Для стабильных подсказок нужен бесплатный ключ резервного сервиса."
        : "Не удалось получить подсказки от резервных сервисов адресного поиска.",
      providerStatus: lastProviderError?.status || 502,
      provider: lastProviderError?.provider || "unknown",
    }, 502);
  } catch (error) {
    if (cached && Date.now() - cached.savedAt < STALE_TTL_MS) {
      return json({
        features: cached.features,
        cached: true,
        stale: true,
      }, 200, { "X-Address-Search-Cache": "STALE" });
    }

    const timedOut = error?.name === "AbortError";
    return json({
      error: timedOut
        ? "Сервис адресов отвечает слишком долго. Попробуй ещё раз."
        : "Не удалось подключиться к сервису адресных подсказок.",
      providerStatus: 502,
    }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", requestAbort);
  }
}
