export async function GET(_request, context) {
  const params = await context.params;
  const raw = String(params?.driverCode || "");
  const code = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code) return new Response("Not found", { status: 404 });
  const startUrl = `/c/${code}`;
  const manifest = {
    id: startUrl,
    name: "Мой Такси — заказ у водителя",
    short_name: "Мой Такси",
    description: "Постоянная ссылка на заказ такси у выбранного водителя.",
    prefer_related_applications: false,
    orientation: "portrait-primary",
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#146b4b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
