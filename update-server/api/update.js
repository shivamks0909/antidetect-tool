import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tauri Updater v2 API endpoint.
 *
 * Tauri updater plugin sends these headers:
 *   Current-Version: <installed version>
 *   X-Platform: windows / linux / macos
 *   X-Arch: x86_64 / aarch64
 *
 * Response:
 *   204 → no update
 *   200 → update available (Tauri updater JSON)
 */
export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Current-Version, X-Platform, X-Arch");
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    // Read the version manifest
    const manifestPath = join(process.cwd(), "version.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    const latestVersion = manifest.version;
    const platform = req.headers["x-platform"] || "windows";
    const arch = req.headers["x-arch"] || "x86_64";
    const platformKey = `${platform}-${arch}`;

    // Get current version from header or query param
    const currentVersion =
      req.headers["current-version"] || req.query.current || "";

    // Compare versions (simple semver: major.minor.patch)
    if (currentVersion && compareVersions(currentVersion, latestVersion) >= 0) {
      // Current version is up to date or newer
      return res.status(204).end();
    }

    // Check if we have an artifact for this platform
    const artifact = manifest.platforms?.[platformKey];
    if (!artifact) {
      // No artifact for this platform — treat as up to date (don't break the app)
      return res.status(204).end();
    }

    // Return Tauri updater v2 response
    const updateResponse = {
      version: latestVersion,
      notes: manifest.notes || "New version available.",
      pub_date: manifest.pub_date || new Date().toISOString(),
      platforms: {
        [platformKey]: {
          url: artifact.url,
          signature: artifact.signature,
        },
      },
    };

    return res.status(200).json(updateResponse);
  } catch (err) {
    console.error("[update-api] Error:", err);
    // On error, return 204 (don't break the app)
    return res.status(204).end();
  }
}

/**
 * Compare two semver strings. Returns:
 *   1  if a > b
 *   0  if a === b
 *  -1  if a < b
 */
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}
