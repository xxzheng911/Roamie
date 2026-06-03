import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";

export type OutfitSuggestionDisplayMode = "trip_level" | "daily_specific";

export function logOutfitSuggestionGrouped(meta: {
  mode: OutfitSuggestionDisplayMode;
  reason: string;
  similarity?: number;
}): void {
  console.info("[OUTFIT_SUGGESTION_GROUPED]", meta);
}

export function logDailyOutfitAlertRendered(meta: { day: number; reason: string }): void {
  console.info("[DAILY_OUTFIT_ALERT_RENDERED]", meta);
}

function dayTextSignature(day: DailyOutfitAdvice): string {
  return [
    day.outfitSummary,
    day.narrative,
    ...(day.packingReminders ?? []),
    day.weather.condition,
    String(day.weather.precipProbability ?? ""),
    String(day.weather.tempLowC ?? ""),
    String(day.weather.tempHighC ?? ""),
  ]
    .join("|")
    .trim()
    .toLowerCase();
}

function wordJaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 1));
  const wordsB = new Set(b.split(/[^a-zA-Z0-9\u4e00-\u9fff]+/).filter((w) => w.length > 1));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let inter = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) inter += 1;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return inter / union;
}

/** 比對每日穿搭建議相似度；>= 0.8 視為相同，合併為 trip-level */
export function compareDailyOutfitSuggestions(days: DailyOutfitAdvice[]): {
  similarity: number;
  shouldGroupTripLevel: boolean;
} {
  if (days.length <= 1) {
    return { similarity: 1, shouldGroupTripLevel: true };
  }

  const signatures = days.map(dayTextSignature);
  let minPairSim = 1;
  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const sim = wordJaccardSimilarity(signatures[i]!, signatures[j]!);
      minPairSim = Math.min(minPairSim, sim);
    }
  }

  return {
    similarity: minPairSim,
    shouldGroupTripLevel: minPairSim >= 0.8,
  };
}

export type DailyOutfitAlert = {
  dayNumber: number;
  dateKey: string;
  reason: string;
  message: string;
};

const MOUNTAIN_RE = /富士|河口湖|五合目|山區|登山|健行|戶外|滑雪|雪場|高海拔|山頂/i;
const BEACH_RE = /海邊|沙灘|海灘|衝浪|浮潛|海島/i;
const RAIN_RE = /雨|雷陣雨|降雨|rain|shower/i;
const WIND_RE = /風|強風|wind/i;
const NIGHT_RE = /夜景|夜市|夜間|深夜|night|bar/i;

function dayItemsText(items: RoamieItineraryItem[]): string {
  return items.map((i) => `${i.placeName ?? ""} ${i.title ?? ""} ${i.description ?? ""}`).join(" ");
}

function isRainy(day: DailyOutfitAdvice, baseline: DailyOutfitAdvice): boolean {
  const precip = day.weather.precipProbability ?? 0;
  const basePrecip = baseline.weather.precipProbability ?? 0;
  if (precip >= 45 && precip - basePrecip >= 20) return true;
  if (RAIN_RE.test(day.weather.condition) && !RAIN_RE.test(baseline.weather.condition)) {
    return true;
  }
  return false;
}

function isColder(day: DailyOutfitAdvice, baseline: DailyOutfitAdvice): boolean {
  const low = day.weather.tempLowC;
  const baseLow = baseline.weather.tempLowC;
  if (low == null || baseLow == null) return false;
  return low <= baseLow - 4;
}

function hasMountainContext(items: RoamieItineraryItem[]): boolean {
  return MOUNTAIN_RE.test(dayItemsText(items));
}

function hasBeachContext(items: RoamieItineraryItem[]): boolean {
  return BEACH_RE.test(dayItemsText(items)) || inferActivityTypesFromDayItems(items).includes("beach");
}

function hasNightContext(items: RoamieItineraryItem[]): boolean {
  return NIGHT_RE.test(dayItemsText(items));
}

function buildAlertMessage(reason: string, destination: string, dayNumber: number): string {
  switch (reason) {
    case "rain":
      return "今日可能下雨，建議攜帶摺疊傘與防水鞋。";
    case "cold":
      return "今日氣溫較低，建議多帶保暖層與圍巾。";
    case "wind":
      return "今日風勢較強，建議防風外套與固定髮型/帽子。";
    case "mountain":
      return `今天安排山區或戶外景點，氣溫可能比${destination || "市區"}低，建議多帶圍巾、手套與防風外套。`;
    case "beach":
      return "今日有海邊或水上活動，建議防曬、沙灘鞋與薄外套。";
    case "outdoor":
      return "今日戶外行程較多，建議好走的鞋與分層穿搭。";
    case "night":
      return "今晚有夜間活動，建議多帶一件薄外套，夜間體感會更涼。";
    default:
      return "今日行程與其他天不同，建議留意當日天氣再調整穿搭。";
  }
}

export function resolveDailyOutfitAlerts(
  days: DailyOutfitAdvice[],
  dayGroups: { dateKey: string; dayNumber: number; items: RoamieItineraryItem[] }[],
  destination: string,
  options?: { groupTripLevel: boolean },
): DailyOutfitAlert[] {
  if (!options?.groupTripLevel || days.length === 0) return [];

  const baseline = days[0]!;
  const alerts: DailyOutfitAlert[] = [];

  for (const group of dayGroups) {
    const dayAdvice =
      days.find((d) => d.date === group.dateKey) ?? days[group.dayNumber - 1];
    if (!dayAdvice) continue;

    const baselineSig = dayTextSignature(baseline);
    const daySig = dayTextSignature(dayAdvice);
    if (wordJaccardSimilarity(baselineSig, daySig) >= 0.85 && group.dayNumber > 1) {
      continue;
    }

    const items = group.items;
    let reason: string | null = null;

    if (hasMountainContext(items) && !hasMountainContext(dayGroups[0]?.items ?? [])) {
      reason = "mountain";
    } else if (hasBeachContext(items) && !hasBeachContext(dayGroups[0]?.items ?? [])) {
      reason = "beach";
    } else if (isRainy(dayAdvice, baseline)) {
      reason = "rain";
    } else if (isColder(dayAdvice, baseline)) {
      reason = "cold";
    } else if (WIND_RE.test(dayAdvice.weather.condition) && !WIND_RE.test(baseline.weather.condition)) {
      reason = "wind";
    } else if (hasNightContext(items) && group.dayNumber > 1) {
      reason = "night";
    } else if (
      inferActivityTypesFromDayItems(items).includes("hiking") ||
      inferActivityTypesFromDayItems(items).includes("outdoor")
    ) {
      const baseActs = inferActivityTypesFromDayItems(dayGroups[0]?.items ?? []);
      const dayActs = inferActivityTypesFromDayItems(items);
      if (dayActs.some((a) => !baseActs.includes(a))) reason = "outdoor";
    }

    if (!reason) continue;

    alerts.push({
      dayNumber: group.dayNumber,
      dateKey: group.dateKey,
      reason,
      message: buildAlertMessage(reason, destination, group.dayNumber),
    });
  }

  return alerts;
}

export function resolveOutfitSuggestionDisplay(
  days: DailyOutfitAdvice[],
  dayGroups: { dateKey: string; dayNumber: number; items: RoamieItineraryItem[] }[],
  destination: string,
): {
  mode: OutfitSuggestionDisplayMode;
  reason: string;
  similarity: number;
  tripLevelAdvice: DailyOutfitAdvice | undefined;
  dailyAlerts: DailyOutfitAlert[];
} {
  const { similarity, shouldGroupTripLevel } = compareDailyOutfitSuggestions(days);
  const mode: OutfitSuggestionDisplayMode = shouldGroupTripLevel
    ? "trip_level"
    : "daily_specific";
  const reason = shouldGroupTripLevel
    ? `daily_similarity_${Math.round(similarity * 100)}`
    : "daily_outfit_varies_by_day";

  logOutfitSuggestionGrouped({ mode, reason, similarity });

  const dailyAlerts =
    mode === "trip_level"
      ? resolveDailyOutfitAlerts(days, dayGroups, destination, { groupTripLevel: true })
      : [];

  return {
    mode,
    reason,
    similarity,
    tripLevelAdvice: days[0],
    dailyAlerts,
  };
}
