/**
 * Style 候選多樣性：多 kind × 多 query 各自取樣，避免單一 Search 拉高 limit 卻全是同義地標。
 *
 * 診斷階段：
 * - STYLE_SEARCH_QUERY：每個 Places Search 回傳數
 * - STYLE_CATEGORY_PRE_DEDUPE / POST_CANONICAL：各 category 數量
 * - STYLE_PLANNER_POOL_FINAL：進 Planner 的 canonical 數量
 */
import type { PlaceResult } from "@/lib/place-result";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  buildCategorySearchAttempts,
  classifyPlanPlaceKind,
  kindsForStyle,
  type PlanPlaceKind,
} from "@/lib/ai/ai-day-plan-source";
import {
  dedupeByCanonicalLandmark,
  requiredCanonicalCandidatesForTrip,
} from "@/lib/ai/canonical-landmark";
import { EN_CITY_NAMES } from "@/lib/ai/destination-geocode";

/** 多元來源 — 不只景點；用於補足 days×3 canonical */
export const STYLE_DIVERSITY_KINDS: PlanPlaceKind[] = [
  "attraction",
  "culture",
  "nature",
  "restaurant",
  "cafe",
  "shopping",
  "night_market",
  "market",
];

/** 每個 query 保留上限 — 刻意偏低，逼出多 query 多樣性 */
export const STYLE_PER_QUERY_KEEP = 8;

/** 每個 kind 最多發幾個不同 query */
export const STYLE_MAX_QUERIES_PER_KIND = 4;

export function buildNightScenerySearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label];
  return [
    {
      query: `${label} 夜景`,
      mode: "text",
      includedTypes: ["tourist_attraction", "observation_deck", "viewpoint"],
    },
    {
      query: `${label} 展望台`,
      mode: "text",
      includedTypes: ["observation_deck", "tourist_attraction"],
    },
    ...(en && en !== label
      ? [
          {
            query: `${en} night view`,
            mode: "text" as const,
            includedTypes: ["tourist_attraction", "observation_deck"],
          },
        ]
      : []),
  ];
}

export function countPlacesByPlanKind(
  places: PlaceResult[],
): Record<PlanPlaceKind, number> {
  const counts: Record<PlanPlaceKind, number> = {
    attraction: 0,
    restaurant: 0,
    cafe: 0,
    shopping: 0,
    market: 0,
    culture: 0,
    nature: 0,
    night_market: 0,
  };
  for (const place of places) {
    counts[classifyPlanPlaceKind(place)] += 1;
  }
  return counts;
}

export function formatKindCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}:${n}`)
    .join("|");
}

export function resolveStyleSearchKinds(
  style: TripStyleKey,
  days: number,
): PlanPlaceKind[] {
  const primary = kindsForStyle(style);
  // 3 天以上強制拉齊多元來源，避免只掃景點同義 query
  if (days < 3) return primary;
  const seen = new Set<PlanPlaceKind>();
  const ordered: PlanPlaceKind[] = [];
  for (const kind of [...primary, ...STYLE_DIVERSITY_KINDS]) {
    if (seen.has(kind)) continue;
    seen.add(kind);
    ordered.push(kind);
  }
  return ordered;
}

export function buildAttemptsForStyleKind(
  destination: string,
  kind: PlanPlaceKind,
): SearchAttempt[] {
  const base = buildCategorySearchAttempts(destination, kind);
  const night =
    kind === "attraction" ? buildNightScenerySearchAttempts(destination) : [];
  const seen = new Set<string>();
  const out: SearchAttempt[] = [];
  for (const attempt of [...base, ...night]) {
    const key = attempt.query.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(attempt);
    if (out.length >= STYLE_MAX_QUERIES_PER_KIND) break;
  }
  return out;
}

/** 哪些 kind 偏低，需要再補一輪不同 query */
export function underrepresentedKinds(
  places: PlaceResult[],
  kinds: PlanPlaceKind[],
  minPerKind: number,
): PlanPlaceKind[] {
  const counts = countPlacesByPlanKind(places);
  return kinds.filter((kind) => (counts[kind] ?? 0) < minPerKind);
}

export function logStyleCategoryInventory(params: {
  stage: "pre_canonical" | "post_canonical" | "planner_final";
  places: PlaceResult[];
  days: number;
  style: TripStyleKey;
  searchRequestCount?: number;
}): {
  byKind: Record<PlanPlaceKind, number>;
  total: number;
  canonicalCount: number;
  requiredCanonical: number;
} {
  const pace = params.style === "slow_nature" ? "slow" : "medium";
  const requiredCanonical = requiredCanonicalCandidatesForTrip(params.days, pace);
  const deduped = dedupeByCanonicalLandmark(params.places);
  // pre：以原始池分類；post／planner：以 canonical 代表點分類
  const placesForKind =
    params.stage === "pre_canonical" ? params.places : deduped.places;
  const kindCounts = countPlacesByPlanKind(placesForKind);
  const canonicalCount = deduped.uniqueCanonicalCount;

  const tag =
    params.stage === "pre_canonical"
      ? "[STYLE_CATEGORY_PRE_DEDUPE]"
      : params.stage === "post_canonical"
        ? "[STYLE_CATEGORY_POST_CANONICAL]"
        : "[STYLE_PLANNER_POOL_FINAL]";

  logAiPipeline(
    tag,
    `style=${params.style}`,
    `days=${params.days}`,
    `total=${params.places.length}`,
    `canonicalCount=${canonicalCount}`,
    `requiredCanonical=${requiredCanonical}`,
    `byKind=${formatKindCounts(kindCounts)}`,
    params.searchRequestCount != null
      ? `searchRequestCount=${params.searchRequestCount}`
      : "",
    canonicalCount < requiredCanonical
      ? "enough=false"
      : "enough=true",
  );

  return {
    byKind: kindCounts,
    total: params.places.length,
    canonicalCount,
    requiredCanonical,
  };
}
