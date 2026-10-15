export async function GET() {
  const body = {
    id: "/",
    name: "Кабинет владельца — Мой Такси",
    short_name: "Владелец",
    description: "Отдельное приложение для управления сервисом Мой Такси.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef3f8",
    theme_color: "#183b63",
    orientation: "portrait-primary",
    prefer_related_applications: false,
    icons: [
      { src: "/owner-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }
    ]
  };
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0"
    }
  });
}
