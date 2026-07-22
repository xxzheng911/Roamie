/**
 * Style Geo / Region Diversity — 進 Planner 前讓候選跨行政區分散。
 *
 * 與 Category／Query Diversity 並用：
 * - 每輪 Search 輪替 Region hub（淺草 → 澀谷 → 新宿 → …）
 * - 同一 Geo Cluster 占比過高時，後續優先切到其他 Region
 */
import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { distanceMeters } from "@/lib/geo-distance";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationTravelProfile } from "@/lib/ai/destination-travel-profile";
import { extractAreaNameFromAddress } from "@/lib/ai/geographic-clustering";

export type GeoHub = {
  id: string;
  label: string;
  aliases: string[];
  lat: number | null;
  lng: number | null;
};

/** 同區占比上限（其餘分給其他 Region） */
export const GEO_MAX_CLUSTER_SHARE = 0.32;

/** Region-biased search 半徑（公尺） */
export const GEO_REGION_SEARCH_RADIUS_M = 3_200;

/** 座標歸屬最近 hub 的最大距離 */
const GEO_HUB_MATCH_RADIUS_M = 2_800;

/**
 * 已知商圈／下町中心座標（搜尋 bias 用）。
 * 無座標時仍可用地區名做 query 前綴。
 */
const KNOWN_HUB_CENTERS: Record<string, Record<string, { lat: number; lng: number }>> = {
  東京: {
    淺草: { lat: 35.7148, lng: 139.7967 },
    上野: { lat: 35.7142, lng: 139.7731 },
    新宿: { lat: 35.6938, lng: 139.7034 },
    澀谷: { lat: 35.6595, lng: 139.7005 },
    渋谷: { lat: 35.6595, lng: 139.7005 },
    銀座: { lat: 35.6717, lng: 139.765 },
    原宿: { lat: 35.6702, lng: 139.7026 },
    六本木: { lat: 35.6629, lng: 139.7314 },
  },
  大阪: {
    道頓堀: { lat: 34.6687, lng: 135.5013 },
    心齋橋: { lat: 34.6745, lng: 135.5005 },
    新世界: { lat: 34.6522, lng: 135.5063 },
    大阪城: { lat: 34.6873, lng: 135.5262 },
  },
  京都: {
    東山: { lat: 34.9949, lng: 135.785 },
    嵐山: { lat: 35.0094, lng: 135.6666 },
    祇園: { lat: 35.0037, lng: 135.7788 },
    金閣寺: { lat: 35.0394, lng: 135.7292 },
  },
  首爾: {
    景福宮: { lat: 37.5796, lng: 126.977 },
    弘大: { lat: 37.5563, lng: 126.9236 },
    明洞: { lat: 37.5636, lng: 126.986 },
    東大門: { lat: 37.5665, lng: 127.0092 },
    南山: { lat: 37.5512, lng: 126.9882 },
  },
  台北: {
    信義: { lat: 25.033, lng: 121.5654 },
    西門: { lat: 25.042, lng: 121.508 },
    大稻埕: { lat: 25.0568, lng: 121.5105 },
    松山: { lat: 25.048, lng: 121.5525 },
    北投: { lat: 25.132, lng: 121.503 },
  },
  臺北: {
    信義: { lat: 25.033, lng: 121.5654 },
    西門: { lat: 25.042, lng: 121.508 },
    大稻埕: { lat: 25.0568, lng: 121.5105 },
    松山: { lat: 25.048, lng: 121.5525 },
    北投: { lat: 25.132, lng: 121.503 },
  },
};

function hubId(label: string): string {
  return normalizeDestinationLabel(label).toLowerCase();
}

function hubAliases(label: string): string[] {
  const base = normalizeDestinationLabel(label);
  const aliases = [base, label];
  // 常見正異體／日文
  if (base === "澀谷" || base === "渋谷") aliases.push("澀谷", "渋谷", "Shibuya", "shibuya");
  if (base === "淺草") aliases.push("浅草", "Asakusa", "asakusa");
  if (base === "新宿") aliases.push("Shinjuku", "shinjuku");
  if (base === "銀座") aliases.push("Ginza", "ginza");
  if (base === "上野") aliases.push("Ueno", "ueno");
  return [...new Set(aliases.map((a) => a.trim()).filter(Boolean))];
}

/** 從 travel profile districts + 已知中心建立 Geo hubs */
export function resolveGeoHubsForDestination(destination: string): GeoHub[] {
  const label = normalizeDestinationLabel(destination);
  const profile = resolveDestinationTravelProfile(label);
  const centers = KNOWN_HUB_CENTERS[label] ?? {};

  // 東京：使用者案例明確要含銀座（profile 可能沒列）
  const districtNames = [...profile.districts];
  if (label === "東京" && !districtNames.some((d) => /銀座|Ginza/i.test(d))) {
    districtNames.splice(3, 0, "銀座");
  }

  const hubs: GeoHub[] = [];
  const seen = new Set<string>();
  for (const raw of districtNames) {
    const name = normalizeDestinationLabel(raw);
    if (!name || name.length < 2) continue;
    const id = hubId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const center =
      centers[name] ??
      centers[raw] ??
      Object.entries(centers).find(([k]) => hubAliases(name).some((a) => k.includes(a) || a.includes(k)))?.[1];
    hubs.push({
      id,
      label: name,
      aliases: hubAliases(name),
      lat: center?.lat ?? null,
      lng: center?.lng ?? null,
    });
  }

  // 無 profile districts 時：若有已知中心表，直接用
  if (!hubs.length && Object.keys(centers).length) {
    for (const [name, center] of Object.entries(centers)) {
      hubs.push({
        id: hubId(name),
        label: normalizeDestinationLabel(name),
        aliases: hubAliases(name),
        lat: center.lat,
        lng: center.lng,
      });
    }
  }

  return hubs.slice(0, 8);
}

export function matchPlaceToGeoHub(
  place: PlaceResult,
  hubs: GeoHub[],
): GeoHub | null {
  if (!hubs.length) return null;
  const blob = [place.name, place.address, extractAreaNameFromAddress(place.address ?? "")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const hub of hubs) {
    if (hub.aliases.some((a) => a && blob.includes(a.toLowerCase()))) {
      return hub;
    }
  }

  if (
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng)
  ) {
    let best: GeoHub | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const hub of hubs) {
      if (hub.lat == null || hub.lng == null) continue;
      const d = distanceMeters(
        { lat: place.lat, lng: place.lng },
        { lat: hub.lat, lng: hub.lng },
      );
      if (d <= GEO_HUB_MATCH_RADIUS_M && d < bestDist) {
        best = hub;
        bestDist = d;
      }
    }
    if (best) return best;
  }

  return null;
}

export function countPlacesByGeoHub(
  places: PlaceResult[],
  hubs: GeoHub[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hub of hubs) counts.set(hub.id, 0);
  counts.set("other", 0);
  for (const place of places) {
    const hub = matchPlaceToGeoHub(place, hubs);
    const key = hub?.id ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function isGeoHubSaturated(
  places: PlaceResult[],
  hub: GeoHub,
  hubs: GeoHub[],
  maxShare = GEO_MAX_CLUSTER_SHARE,
): boolean {
  const total = places.length;
  if (total < Math.max(4, hubs.length)) return false;
  const counts = countPlacesByGeoHub(places, hubs);
  const share = (counts.get(hub.id) ?? 0) / total;
  const dynamicCap = Math.max(maxShare, 1 / Math.max(hubs.length, 1));
  return share >= dynamicCap;
}

/** 輪替選下一個未飽和 hub；全飽和時仍輪替（避免鎖死） */
export function pickNextGeoHub(params: {
  hubs: GeoHub[];
  places: PlaceResult[];
  roundIndex: number;
  maxShare?: number;
}): { hub: GeoHub | null; skippedSaturated: string[] } {
  const hubs = params.hubs;
  if (!hubs.length) return { hub: null, skippedSaturated: [] };

  const saturated = hubs.filter((h) =>
    isGeoHubSaturated(params.places, h, hubs, params.maxShare),
  );
  const unsaturated = hubs.filter((h) => !saturated.includes(h));
  const pool = unsaturated.length ? unsaturated : hubs;
  const hub = pool[params.roundIndex % pool.length] ?? null;

  return {
    hub,
    skippedSaturated: saturated.map((h) => h.label),
  };
}

/** 將 city-level query 轉成 region-scoped（「東京 景點」→「淺草 景點」） */
export function scopeAttemptToGeoHub(
  attempt: SearchAttempt,
  hub: GeoHub,
  city: string,
): SearchAttempt {
  const cityLabel = normalizeDestinationLabel(city);
  let query = attempt.query.trim();
  if (cityLabel && query.startsWith(cityLabel)) {
    query = `${hub.label}${query.slice(cityLabel.length)}`;
  } else if (!hub.aliases.some((a) => query.includes(a))) {
    query = `${hub.label} ${query}`;
  }
  return { ...attempt, query };
}

export function formatGeoHubCounts(
  counts: Map<string, number>,
  hubs: GeoHub[],
): string {
  const parts: string[] = [];
  for (const hub of hubs) {
    const n = counts.get(hub.id) ?? 0;
    if (n > 0) parts.push(`${hub.label}:${n}`);
  }
  const other = counts.get("other") ?? 0;
  if (other > 0) parts.push(`other:${other}`);
  return parts.join("|") || "none";
}

export function logStyleGeoInventory(params: {
  stage: "pre_planner" | "after_search";
  places: PlaceResult[];
  hubs: GeoHub[];
  destination: string;
}): { counts: Map<string, number>; saturated: string[] } {
  const counts = countPlacesByGeoHub(params.places, params.hubs);
  const saturated = params.hubs
    .filter((h) => isGeoHubSaturated(params.places, h, params.hubs))
    .map((h) => h.label);

  logAiPipeline(
    "[STYLE_GEO_INVENTORY]",
    `stage=${params.stage}`,
    `destination=${normalizeDestinationLabel(params.destination)}`,
    `hubs=[${params.hubs.map((h) => h.label).join(",")}]`,
    `byRegion=${formatGeoHubCounts(counts, params.hubs)}`,
    `saturated=[${saturated.join(",") || "none"}]`,
    `total=${params.places.length}`,
  );

  return { counts, saturated };
}

/** 需要補搜的 unsaturated hubs（目前為 0 或明顯偏低） */
export function underrepresentedGeoHubs(
  places: PlaceResult[],
  hubs: GeoHub[],
  minPerHub = 2,
): GeoHub[] {
  if (!hubs.length) return [];
  const counts = countPlacesByGeoHub(places, hubs);
  return hubs.filter((h) => (counts.get(h.id) ?? 0) < minPerHub);
}
