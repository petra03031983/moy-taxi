import { getSupabaseConfig } from "../_lib/astanaAccess.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 12;
const REQUEST_TIMEOUT_MS = 5000;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, max-age=2, s-maxage=5, stale-while-revalidate=15"
        : "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Astana-Search-Source": "local-address-index",
    },
  });
}

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? number
    : null;
}

export async function GET(request) {
  const incoming = new URL(request.url);
  const query = String(incoming.searchParams.get("q") || "")
    .trim()
    .replace(/\\s+/g, " ");

  if (query.length < 2) return json({ features: [] });
  if (query.length > MAX_QUERY_LENGTH) {
    return json({ error: "Слишком длинный поисковый запрос." }, 400);
  }

  const rawLimit = Number(incoming.searchParams.get("limit") || MAX_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(rawLimit)))
    : MAX_LIMIT;

  const lat = validCoordinate(incoming.searchParams.get("lat"), -90, 90);
  const lng = validCoordinate(incoming.searchParams.get("lon"), -180, 180);
  const config = getSupabaseConfig();

  if (!config) {
    return json({
      error: "Локальная адресная база «Астана Гид» пока не подключена.",
    }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromClient = () => controller.abort();
  request.signal?.addEventListener("abort", abortFromClient, { once: true });

  try {
    const response = await fetch(
      config.base + "/rest/v1/rpc/search_astana_addresses",
      {
        method: "POST",
        headers: {
          apikey: config.key,
          Authorization: "Bearer " + config.key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          p_query: query,
          p_lat: lat,
          p_lng: lng,
          p_limit: limit,
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("Astana local address search failed:", response.status, payload);
      return json({
        error: "Не удалось выполнить поиск по локальной адресной базе.",
      }, 502);
    }

    const features = Array.isArray(payload?.features)
      ? payload.features.slice(0, limit)
      : [];

    return json({
      features,
      provider: "Астана Гид — собственная адресная база",
      count: features.length,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    return json({
      error: timedOut
        ? "Локальный поиск адресов отвечает слишком долго. Попробуй ещё раз."
        : "Не удалось подключиться к собственной адресной базе «Астана Гид».",
    }, 502);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", abortFromClient);
  }
}
