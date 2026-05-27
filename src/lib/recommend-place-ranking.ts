import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceAvailability, PlaceHoursData } from "@/lib/filter-available-places";
import {
  derivePlaceAvailability,
  isLateNightMode,
  isLateNightScenicAccessible,
  isPlaceAvailableNow,
  isTimePeriodMismatch,
} from "@/lib/filter-available-places";
import {
  classifyLateNightCategory,
  lateNightCategoryRankScore,
  shouldActivateLateNightSceneFlow,
} from "@/lib/late-night-scene-recommendations";
import type { WeatherSummary } from "@/lib/weather-types";
import { weatherRankingBoost } from "@/lib/weather/weather-place-ranking";

export { isLateNightMode } from "@/lib/filter-available-places";

export type RankedRecommendation = {
  rec: RoamieRecommendationItem;
  availability: PlaceAvailability;
  rankScore: number;
};

export type RecommendationAvailabilityStats = {
  total: number;
  open: number;
  closingSoon: number;
  closed: number;
  unknown: number;
};

function availabilityRankScore(
  availability: PlaceAvailability,
  lateNight: boolean,
): number {
  switch (availability.openStatus) {
    case "open":
      return 0;
    case "closing_soon":
      return 1;
    case "closed_now":
      return availability.nextOpenHint ? 3 : 99;
    case "unknown":
      return lateNight ? 5 : 4;
    default:
      return 9;
  }
}

export function rankRecommendationItem(
  rec: RoamieRecommendationItem,
  hours: PlaceHoursData,
  at: Date,
  mood?: string | null,
  weather?: WeatherSummary | null,
): RankedRecommendation | null {
  const identity = { name: rec.name, type: rec.type };
  if (!isPlaceAvailableNow(hours, identity, { context: "now", at })) {
    return null;
  }

  let availability = derivePlaceAvailability(hours, { context: "now", at });
  const lateNight = isLateNightMode(at);
  if (lateNight && isLateNightScenicAccessible(rec.name, rec.type)) {
    availability = {
      ...availability,
      openStatus: availability.openStatus === "closed_now" ? "unknown" : availability.openStatus,
      displayStatus: availability.displayStatus || "適合夜晚散步",
      isRecommendable: true,
    };
  }

  const mismatchPenalty = isTimePeriodMismatch(rec.name, rec.type, at) ? 20 : 0;
  let rankScore = availabilityRankScore(availability, lateNight) + mismatchPenalty;
  if (lateNight && shouldActivateLateNightSceneFlow(mood, at)) {
    const cat = classifyLateNightCategory(rec.name, rec.type);
    rankScore += lateNightCategoryRankScore(cat, mood);
  }

  rankScore += weatherRankingBoost(weather, `${rec.name} ${rec.type} ${rec.description}`);

  return { rec, availability, rankScore };
}

export function rankRecommendations(
  recs: RoamieRecommendationItem[],
  hoursMap: Map<string, PlaceHoursData>,
  at: Date = new Date(),
  mood?: string | null,
  weather?: WeatherSummary | null,
): RankedRecommendation[] {
  return recs
    .map((rec) => rankRecommendationItem(rec, hoursMap.get(rec.name) ?? {}, at, mood, weather))
    .filter((x): x is RankedRecommendation => x != null)
    .sort((a, b) => a.rankScore - b.rankScore);
}

export function summarizeAvailabilityStats(ranked: RankedRecommendation[]): RecommendationAvailabilityStats {
  let open = 0;
  let closingSoon = 0;
  let closed = 0;
  let unknown = 0;
  for (const { availability } of ranked) {
    if (availability.openStatus === "open") open += 1;
    else if (availability.openStatus === "closing_soon") closingSoon += 1;
    else if (availability.openStatus === "closed_now") closed += 1;
    else unknown += 1;
  }
  return {
    total: ranked.length,
    open,
    closingSoon,
    closed,
    unknown,
  };
}

const LATE_NIGHT_EXTENSION_HINTS = [
  "酒吧或小酒吧",
  "深夜仍開的咖啡廳",
  "宵夜、居酒屋",
  "KTV 或續攤",
  "夜景、河岸散步",
  "24 小時超商或便利點",
];

export function buildLateNightExtensionHints(): string {
  return LATE_NIGHT_EXTENSION_HINTS.join("、");
}

/** 深夜且多數已休息時的 Roamie 風格 summary */
export function buildLateNightCompanionSummary(opts: {
  mood?: string;
  weather?: WeatherSummary | null;
  city?: string;
  stats: RecommendationAvailabilityStats;
}): string {
  const moodLead = opts.mood?.trim()
    ? `記著你說的「${opts.mood}」的心情，`
    : "";
  const cityBit = opts.city?.trim() ? `在${opts.city}，` : "";

  if (opts.stats.open > 0) {
    return `${moodLead}${cityBit}這時間附近大部分店家慢慢休息了，不過如果你還想晃晃，附近還有一些適合深夜待著的地方。想續攤、喝杯東西，或找個地方坐坐，我可以再幫你多找${LATE_NIGHT_EXTENSION_HINTS.slice(0, 4).join("、")}這類的去處 ☺️`;
  }

  return `${moodLead}${cityBit}這時間附近大部分店家慢慢休息了，不過如果你還想晃晃，我還可以幫你找一些適合深夜待著的地方 ☺️ 要不要看看夜景、酒吧，或是還開著的深夜咖啡廳？`;
}

export function selectRecommendationsForNow(
  ranked: RankedRecommendation[],
  opts?: { maxCount?: number; at?: Date; mood?: string | null },
): RankedRecommendation[] {
  const max = opts?.maxCount ?? 5;
  const at = opts?.at ?? new Date();

  let pool = ranked;
  if (shouldActivateLateNightSceneFlow(opts?.mood, at)) {
    pool = [...ranked].sort((a, b) => {
      const ca = classifyLateNightCategory(a.rec.name, a.rec.type);
      const cb = classifyLateNightCategory(b.rec.name, b.rec.type);
      const moodDiff =
        lateNightCategoryRankScore(ca, opts?.mood) - lateNightCategoryRankScore(cb, opts?.mood);
      if (moodDiff !== 0) return moodDiff;
      return a.rankScore - b.rankScore;
    });
  }

  const openish = pool.filter(
    ({ availability }) =>
      availability.openStatus === "open" || availability.openStatus === "closing_soon",
  );
  const openingSoon = pool.filter(
    ({ availability }) =>
      availability.openStatus === "closed_now" && !!availability.nextOpenHint,
  );
  const unknown = pool.filter(({ availability }) => availability.openStatus === "unknown");

  const picked: RankedRecommendation[] = [];
  const seen = new Set<string>();

  const push = (items: RankedRecommendation[]) => {
    for (const item of items) {
      if (picked.length >= max) return;
      if (seen.has(item.rec.name)) continue;
      seen.add(item.rec.name);
      picked.push(item);
    }
  };

  if (openish.length >= max) {
    return openish.slice(0, max);
  }

  push(openish);
  push(openingSoon);
  push(unknown);

  return picked;
}

export function shouldUseLateNightEmptySummary(
  stats: RecommendationAvailabilityStats,
  at: Date = new Date(),
): boolean {
  if (!isLateNightMode(at)) return false;
  return stats.open + stats.closingSoon === 0;
}

type RecommendationDisplayItem = {
  name: string;
  type?: string;
  openStatusLabel?: string;
  closingSoonNote?: string;
  nextOpenHint?: string;
};

/** 顯示排序：營業中 → 即將打烊 → 待確認 → 稍後營業 → 未營業 */
export function recommendationOpenDisplayPriority(item: RecommendationDisplayItem): number {
  const label = item.openStatusLabel?.trim() ?? "";
  const closing = item.closingSoonNote?.trim();

  if (label.includes("營業中")) return 0;
  if (closing || label.includes("即將打烊")) return 1;
  if (!label || label.includes("待確認")) return 2;
  if (label.includes("目前未營業") || label.includes("休息") || label.includes("打烊")) {
    return item.nextOpenHint?.trim() ? 4 : 5;
  }
  return 3;
}

export function sortRecommendationItemsForDisplay<T extends RecommendationDisplayItem>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) => recommendationOpenDisplayPriority(a) - recommendationOpenDisplayPriority(b),
  );
}

/** 客戶端顯示前二次過濾（依 enrich 後欄位）並以營業狀態排序 */
export function filterRecommendationItemsForDisplay<T extends RecommendationDisplayItem>(
  items: T[],
): T[] {
  const filtered = items.filter((item) => {
    if (item.openStatusLabel === "目前未營業" && !item.nextOpenHint?.trim()) {
      return false;
    }
    if (isTimePeriodMismatch(item.name, item.type, new Date())) {
      return false;
    }
    return true;
  });
  return sortRecommendationItemsForDisplay(filtered);
}
