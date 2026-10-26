import { checkAstanaAccessKey, readAccessKey, privateApiError } from "../_lib/astanaAccess.js";

const COOKIE = "astana_guide_key";
const COOKIE_OPTIONS = "Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict";

function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

export async function GET(request) {
  const key = readAccessKey(request);
  if (!key) return json({ ok: true, authenticated: false });
  try {
    const authenticated = await checkAstanaAccessKey(key);
    if (!authenticated) {
      return json({ ok: true, authenticated: false }, 200, {
        "Set-Cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
      });
    }
    return json({ ok: true, authenticated: true });
  } catch (error) {
    return privateApiError(error);
  }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Укажи личный ключ базы." }, 400); }
  const key = String(body?.key || "").trim();
  if (key.length < 32 || key.length > 256) {
    return json({ ok: false, error: "Ключ базы не принят. Проверь ввод." }, 401);
  }
  try {
    const authenticated = await checkAstanaAccessKey(key);
    if (!authenticated) return json({ ok: false, error: "Неверный ключ личной базы." }, 401);
    return json({ ok: true, authenticated: true }, 200, {
      "Set-Cookie": COOKIE + "=" + encodeURIComponent(key) + "; " + COOKIE_OPTIONS,
    });
  } catch (error) {
    return privateApiError(error);
  }
}

export async function DELETE() {
  return json({ ok: true, authenticated: false }, 200, {
    "Set-Cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
  });
}
