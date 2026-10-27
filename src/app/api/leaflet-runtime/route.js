import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);

export async function GET(request) {
  try {
    // Serve Leaflet from the installed app dependency on the same origin.
    // This avoids relying on third-party CDNs in constrained mobile browsers.
    const filePath = require.resolve("leaflet/dist/leaflet.js");
    const source = await readFile(filePath);
    if (source.byteLength < 100_000) {
      throw new Error("Leaflet runtime file is unexpectedly small");
    }

    // Safe diagnostic mode confirms whether the runtime asset exists without returning JS.
    if (new URL(request.url).searchParams.get("check") === "1") {
      return Response.json(
        { ok: true, asset: "Leaflet", bytes: source.byteLength },
        { headers: { "Cache-Control": "no-store" } }
      );
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
    const isCheck = new URL(request.url).searchParams.get("check") === "1";
    return Response.json(
      isCheck
        ? { ok: false, error: "Leaflet runtime недоступен на сервере" }
        : { error: "Не удалось прочитать встроенную библиотеку карты" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
