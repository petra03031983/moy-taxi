import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

export async function GET() {
  try {
    // Serve Leaflet from the installed app dependency on the same origin.
    // This avoids relying on third-party CDNs in constrained mobile browsers.
    const filePath = require.resolve("leaflet/dist/leaflet.js");
    const source = await readFile(filePath);
    if (source.byteLength < 100_000) {
      throw new Error("Leaflet runtime file is unexpectedly small");
    }

    return new Response(source, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error: "Не удалось прочитать встроенную библиотеку карты",
        details: String(error?.message || "Unknown runtime error").slice(0, 240),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
