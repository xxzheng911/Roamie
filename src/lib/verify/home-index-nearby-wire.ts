import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 靜態檢查：首頁 cache hit 仍會跑 enrichHomeNearbyPicks（避免只改 helper 未接線） */
export function _appIndexUsesHomeNearbyEnrichOnCacheHit(): boolean {
  const path = join(__dirname, "../../routes/_app.index.tsx");
  const src = readFileSync(path, "utf8");
  return (
    src.includes("[NEARBY_FETCH_CACHE_HIT]") &&
    src.includes("isFetchingNearbyRef") &&
    src.includes("shouldSkipNearbyRefetch") &&
    src.includes("homeNearbyPicksNeedEnrichment")
  );
}
