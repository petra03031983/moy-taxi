export async function GET() {
  const body = {
    id: "/admin",
    name: "Мой Такси — кабинет владельца",
    short_name: "Кабинет владельца",
    description: "Статистика, водители, заказы и настройки сервиса Мой Такси.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#f5f7f5",
    theme_color: "#146b4b",
    orientation: "portrait-primary",
    prefer_related_applications: false,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }
    ]
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
