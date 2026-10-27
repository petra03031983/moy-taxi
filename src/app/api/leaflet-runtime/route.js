import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    // The build script copies Leaflet into public/vendor. Read that exact built
    // artifact instead of resolving node_modules from a serverless runtime.
    const filePath = join(process.cwd(), "public", "vendor", "leaflet.js");
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
        ? {
            ok: false,
            error: "Leaflet runtime недоступен на сервере",
            code: String(error?.code || "unknown").slice(0, 40),
          }
        : { error: "Не удалось прочитать встроенную библиотеку карты" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
