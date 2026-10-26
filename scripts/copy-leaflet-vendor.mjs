import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "leaflet", "dist", "leaflet.js");
const target = join(root, "public", "vendor", "leaflet.js");

try {
  const stat = statSync(source);
  if (!stat.isFile() || stat.size < 100_000) {
    throw new Error("Installed Leaflet file is missing or unexpectedly small.");
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  console.log("Bundled Leaflet runtime at /vendor/leaflet.js (" + stat.size + " bytes).");
} catch (error) {
  console.error("Cannot bundle the local Leaflet map runtime:", error);
  process.exitCode = 1;
}
