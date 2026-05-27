import type { DailyForecast } from "@/lib/weather-types";
import type { WeatherSummary } from "@/lib/weather-types";
import type { TripActivityType } from "@/lib/outfit/types";
import type { TripSceneType } from "@/lib/outfit/infer-trip-scene";

const ALLOWED_TAGS = [
  "防風",
  "防曬",
  "防水",
  "好走",
  "適合拍照",
  "保暖",
  "透氣",
  "層次穿搭",
  "夜間加溫",
] as const;

export type OutfitHighlightTag = (typeof ALLOWED_TAGS)[number];

function normalizeTag(raw: string): OutfitHighlightTag | null {
  const t = raw.trim().replace(/\s/g, "");
  if ((ALLOWED_TAGS as readonly string[]).includes(t)) return t as OutfitHighlightTag;
  if (/防風/.test(t)) return "防風";
  if (/防曬|紫外線|UV/.test(t)) return "防曬";
  if (/防水|雨具|下雨/.test(t)) return "防水";
  if (/好走|步行|舒適鞋/.test(t)) return "好走";
  if (/拍照|打卡|網美/.test(t)) return "適合拍照";
  if (/保暖|寒冷|厚外套|大衣/.test(t)) return "保暖";
  if (/透氣|短袖|炎熱/.test(t)) return "透氣";
  if (/層次|洋蔥/.test(t)) return "層次穿搭";
  if (/夜間|晚上|薄外套/.test(t)) return "夜間加溫";
  return null;
}

export function mergeOutfitTags(
  ruleTags: OutfitHighlightTag[],
  aiTags?: string[],
  max = 5,
): OutfitHighlightTag[] {
  const out: OutfitHighlightTag[] = [];
  const seen = new Set<string>();
  for (const t of [...ruleTags, ...(aiTags ?? []).map(normalizeTag).filter(Boolean)]) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function deriveOutfitTags(params: {
  current: WeatherSummary | null;
  forecast: DailyForecast[];
  activities: TripActivityType[];
  scenes: TripSceneType[];
  hasNightActivities: boolean;
  isPlus?: boolean;
  travelTags?: string[];
}): OutfitHighlightTag[] {
  const tags: OutfitHighlightTag[] = [];
  const hi = Math.max(
    params.current?.tempC ?? -99,
    ...params.forecast.map((f) => f.tempHighC ?? -99),
  );
  const lo = Math.min(
    params.current?.tempC ?? 99,
    ...params.forecast.map((f) => f.tempLowC ?? 99),
  );
  const avgPrecip =
    [params.current?.precipProbability, ...params.forecast.map((f) => f.precipProbability)]
      .filter((p): p is number => p != null)
      .reduce((s, p, _, arr) => s + p / Math.max(1, arr.length), 0) ?? 0;
  const uviMax = Math.max(
    params.current?.uvi ?? 0,
    ...params.forecast.map((f) => f.uvi ?? 0),
  );
  const windy =
    (params.current?.windSpeedKmh ?? 0) >= 28 ||
    params.forecast.some((f) => (f.windSpeedKmh ?? 0) >= 28);

  if (avgPrecip >= 35) tags.push("防水");
  if (uviMax >= 6 || hi >= 28) tags.push("防曬");
  if (windy) tags.push("防風");
  if (hi <= 12 || lo <= 8) tags.push("保暖");
  if (hi >= 26 && lo >= 18) tags.push("透氣");
  if (hi - lo >= 8) tags.push("層次穿搭");
  if (params.hasNightActivities && lo <= 18) tags.push("夜間加溫");

  if (
    params.activities.includes("hiking") ||
    params.activities.includes("city") ||
    params.activities.includes("outdoor") ||
    params.scenes.includes("mountain")
  ) {
    tags.push("好走");
  }
  if (params.activities.includes("photo")) tags.push("適合拍照");

  if (params.isPlus && params.travelTags?.length) {
    const blob = params.travelTags.join(" ");
    if (/拍照|攝影|打卡|網美/.test(blob) && !tags.includes("適合拍照")) {
      tags.push("適合拍照");
    }
    if (/戶外|健行|登山/.test(blob) && !tags.includes("好走")) tags.push("好走");
    if (/慢旅|文青|質感/.test(blob) && !tags.includes("層次穿搭")) tags.push("層次穿搭");
  }

  return mergeOutfitTags(tags, [], 5);
}
