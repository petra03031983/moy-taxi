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
    start_url: startUrl,
    scope: startUrl,
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#146b4b",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }]
  };
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
}
