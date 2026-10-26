const DEFAULT_SUPABASE_URL = "https://qyejqovxwniqlcsspmbc.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_YjssgR_0Of2b5dhqsSfG_Q_EnYTkrOn";

export function getSupabaseConfig() {
  let base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return base && key ? { base, key } : null;
}

export function readAccessKey(request) {
  const headerKey = String(request.headers.get("x-astana-guide-key") || "").trim();
  if (headerKey) return headerKey;
  const cookieHeader = String(request.headers.get("cookie") || "");
  const item = cookieHeader.split(";").map(part => part.trim()).find(part => part.startsWith("astana_guide_key="));
  if (!item) return "";
  try { return decodeURIComponent(item.slice("astana_guide_key=".length)); }
  catch { return ""; }
}

export async function callAstanaRpc(functionName, args = {}) {
  const config = getSupabaseConfig();
  if (!config) {
    const error = new Error("Private road-data service is not configured.");
    error.status = 503;
    throw error;
  }
  const response = await fetch(config.base + "/rest/v1/rpc/" + functionName, {
    method: "POST",
    headers: {
      apikey: config.key,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch {}
  if (!response.ok) {
    const message = String(payload?.message || payload?.error || "Private road-data request failed.");
    const error = new Error(message);
    error.status = /unauthorized|invalid access key/i.test(message) ? 401 : response.status;
    throw error;
  }
  return payload;
}

export async function checkAstanaAccessKey(key) {
  if (!key || String(key).length < 32) return false;
  const result = await callAstanaRpc("astana_guide_check_key", { p_access_key: String(key) });
  return result === true;
}

export function privateApiError(error) {
  const status = Number(error?.status) || (/unauthorized|invalid access key/i.test(String(error?.message || "")) ? 401 : 502);
  const message = status === 401
    ? "Нужен личный ключ базы «Астана Гид»."
    : status === 503
      ? "Сервис личной базы временно не настроен."
      : "Не удалось выполнить запрос к личной базе.";
  return Response.json({ ok: false, error: message }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
  });
}
