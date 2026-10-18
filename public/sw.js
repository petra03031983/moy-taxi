self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "POST") return;

  const url = new URL(request.url);
  const isApi = /\/functions\/v1\/moy-taxi-api$/.test(url.pathname);
  if (!isApi) return;

  event.respondWith((async () => {
    try {
      const body = await request.clone().json();
      if (body?.action !== "address_suggest") return fetch(request);

      const query = String(body.query || "").trim();
      if (query.length < 2) {
        return new Response(JSON.stringify({ ok: true, suggestions: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" }
        });
      }

      const params = new URLSearchParams({
        q: query,
        lat: String(body.near_lat ?? ""),
        lon: String(body.near_lng ?? "")
      });
      const localUrl = new URL("/api/address-suggest?" + params.toString(), self.location.origin);
      const response = await fetch(localUrl.toString(), { headers: { "Accept": "application/json" } });
      const data = await response.json().catch(() => ({ suggestions: [] }));

      return new Response(JSON.stringify({
        ok: response.ok,
        suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
        error: response.ok ? undefined : "Поиск адресов временно недоступен."
      }), {
        status: response.ok ? 200 : 502,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    } catch (error) {
      console.error("address_suggest proxy failed", error);
      return fetch(request);
    }
  })());
});
