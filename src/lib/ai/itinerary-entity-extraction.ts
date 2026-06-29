import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import { isMoodNearbyRelaxationRequest } from "@/lib/mood-nearby-intent";
import {
  isKnownCountryLabel,
  isKnownScenicLabel,
  isKnownTouristCityLabel,
  isValidParsedDestinationLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";

export type ItineraryEntityExtraction = {
  destination?: string;
  days?: number;
  nights?: number;
  travelMonth?: string;
  intent: "CREATE_ITINERARY" | "none";
};

const CREATE_ITINERARY_SIGNALS =
  /(?:幫我安排|帮我安排|幫我規劃|帮我规划|幫我排|帮我排|幫我生成|帮我生成|幫我建立|帮我建立|直接生成|排行程|安排.{0,8}行程|規劃.{0,8}行程|规划.{0,8}行程|生成.{0,6}天.{0,6}行程|生成行程|建立行程|创建行程|完整.{0,4}行程|itinerary|你可以幫我安排|可以幫我安排)/i;

const ITINERARY_DESTINATION_PATTERNS: RegExp[] = [
  /(?:我)?(?:下個月|下个月|下月)(?:想|要)?去([\u4e00-\u9fffA-Za-z]{2,10})(?=\s*\d+\s*天|\d+\s*天|[，。\s]|$|你可以|可以)/,
  /(?:我)?(?:想|要)?去([\u4e00-\u9fffA-Za-z]{2,10})(?=\s*\d+\s*天|\d+\s*天|[，。\s]|$)/,
  /(?:幫我|帮我)(?:安排|排|規劃|规划)(?:一下)?([\u4e00-\u9fffA-Za-z]{2,10})/,
  /(?:想)?去([\u4e00-\u9fffA-Za-z]{2,10})(?:\s*(\d+|[一二三四五六七八九十]+)\s*天\s*(\d+|[一二三四五六七八九十]+)\s*夜)/,
  /^([\u4e00-\u9fffA-Za-z]{2,10})(?=\s*\d+\s*天\s*\d+\s*夜)/,
  /^([\u4e00-\u9fffA-Za-z]{2,10})(?=\s*(?:\d+|[一二三四五六七八九十]+)\s*天)/,
];

const EMBEDDED_ITINERARY_DESTINATIONS = [
  "阿里山", "日月潭", "太魯閣", "清境", "墾丁", "九份", "富士山", "箱根", "鎌倉",
  "芭達雅", "普吉島", "清邁", "札幌", "北海道", "沖繩",
  "台北", "臺北", "新北", "桃園", "台中", "臺中", "台南", "臺南", "高雄", "基隆",
  "新竹", "花蓮", "台東", "臺東", "宜蘭", "澎湖", "金門", "馬祖",
  "京都", "大阪", "東京", "橫濱", "名古屋", "福岡", "首爾", "釜山", "濟州",
  "曼谷", "清邁", "新加坡", "香港", "澳門", "巴黎", "倫敦", "雪梨", "墨爾本",
].sort((a, b) => b.length - a.length);

const DESTINATION_NOISE_IN_LABEL =
  /(?:下個月|下个月|下月|這個月|这个月|想去|想要|可以|幫我|帮我|安排|規劃|规划|幾天|天|夜|你可以|嗎|吗|呢|啊|我)/;

function acceptItineraryDestination(candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  const normalized = normalizeDestinationLabel(
    candidate.replace(/(?:走走|逛逛|玩玩|玩)$/, "").trim(),
  );
  if (!normalized || !isValidParsedDestinationLabel(normalized)) return undefined;
  if (DESTINATION_NOISE_IN_LABEL.test(normalized)) return undefined;
  if (
    !isKnownTouristCityLabel(normalized) &&
    !isKnownCountryLabel(normalized) &&
    !isKnownScenicLabel(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function parseNightsFromText(text: string): number | undefined {
  const m = text.match(/(\d+)\s*天\s*(\d+)\s*夜/);
  if (m?.[2]) return Math.max(1, Number.parseInt(m[2], 10));
  const cn = text.match(/([一二三四五六七八九十两兩三]+)\s*天\s*([一二三四五六七八九十两兩]+)\s*夜/);
  if (cn) {
    const dayMap: Record<string, number> = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    return cn[2] ? dayMap[cn[2]] : undefined;
  }
  return undefined;
}

function parseTravelMonthFromText(text: string): string | undefined {
  if (/下個月|下个月|下月/.test(text)) return "next_month";
  if (/這個月|这个月|本月/.test(text)) return "this_month";
  const m = text.match(/(\d{1,2})\s*月/);
  if (m?.[1]) return `${m[1]}月`;
  return undefined;
}

export function isCreateItineraryRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isMoodNearbyRelaxationRequest(t)) return false;
  if (CREATE_ITINERARY_SIGNALS.test(t) && /\d+\s*天/.test(t)) return true;
  if (CREATE_ITINERARY_SIGNALS.test(t) && /行程/.test(t)) return true;
  if (/(幫我生成|帮我生成|幫我建立|直接生成)/.test(t) && (/\d+\s*天/.test(t) || /行程/.test(t))) {
    return true;
  }
  if (/(都不錯|都可以|就這些|很好).{0,20}(生成|排成|建立|安排).{0,12}(行程|\d+\s*天)/.test(t)) {
    return true;
  }
  if (/\d+\s*天\s*\d+\s*夜/.test(t) && /(?:安排|規劃|规划|排|行程|幫我|帮我|可以)/.test(t)) {
    return true;
  }
  if (
    /(?:可以|能不能).{0,12}(?:幫我|帮我).{0,12}(?:安排|規劃|规划|排)/.test(t) &&
    /\d+\s*天/.test(t)
  ) {
    return true;
  }
  return false;
}

/** 從行程規劃句型抽取目的地（不含規劃語、月份、天數） */
export function extractItineraryDestinationFromText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  for (const re of ITINERARY_DESTINATION_PATTERNS) {
    const m = t.match(re);
    if (!m?.[1]) continue;
    const accepted = acceptItineraryDestination(m[1]);
    if (accepted) return accepted;
  }

  for (const label of EMBEDDED_ITINERARY_DESTINATIONS) {
    if (!t.includes(label)) continue;
    const accepted = acceptItineraryDestination(label);
    if (accepted) return accepted;
  }

  return undefined;
}

/** 若 label 含整句噪音，嘗試抽出內嵌已知目的地（geocode 用） */
export function sanitizeDestinationForGeocode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;

  const direct = acceptItineraryDestination(trimmed);
  if (direct) return direct;

  if (isKnownTouristCityLabel(normalizeDestinationLabel(trimmed))) {
    return normalizeDestinationLabel(trimmed);
  }

  const extracted = extractItineraryDestinationFromText(trimmed);
  if (extracted) return extracted;

  for (const label of EMBEDDED_ITINERARY_DESTINATIONS) {
    if (trimmed.includes(label)) {
      const accepted = acceptItineraryDestination(label);
      if (accepted) return accepted;
    }
  }

  return normalizeDestinationLabel(trimmed);
}

export function extractItineraryEntitiesFromText(text: string): ItineraryEntityExtraction {
  const t = text.trim();
  const intent = isCreateItineraryRequest(t) ? "CREATE_ITINERARY" : "none";
  const destination = extractItineraryDestinationFromText(t);
  const days = parseDayCountFromText(t);
  const nights = parseNightsFromText(t);
  const travelMonth = parseTravelMonthFromText(t);

  if (intent === "CREATE_ITINERARY") {
    logItineraryIntentResolved(intent, t.slice(0, 80));
    logItineraryEntityExtracted({ destination, days, nights, travelMonth });
  }

  return { destination, days, nights, travelMonth, intent };
}

export function logItineraryIntentResolved(intent: string, text: string): void {
  console.info("[ITINERARY_INTENT_RESOLVED]", `intent=${intent}`, `text=${text}`);
}

export function logItineraryEntityExtracted(entity: {
  destination?: string;
  days?: number;
  nights?: number;
  travelMonth?: string;
}): void {
  console.info(
    "[ITINERARY_ENTITY_EXTRACTED]",
    `destination=${entity.destination ?? "—"}`,
    entity.days != null ? `days=${entity.days}` : "",
    entity.nights != null ? `nights=${entity.nights}` : "",
    entity.travelMonth ? `month=${entity.travelMonth}` : "",
  );
}

export function logItineraryDestinationParsed(destination: string): void {
  console.info("[ITINERARY_DESTINATION_PARSED]", `destination=${destination}`);
}

export function logItineraryDateParsed(value: string): void {
  console.info("[ITINERARY_DATE_PARSED]", `value=${value}`);
}

export function logItineraryDaysParsed(days: number, nights?: number): void {
  console.info(
    "[ITINERARY_DAYS_PARSED]",
    `days=${days}`,
    nights != null ? `nights=${nights}` : "",
  );
}

export function logItineraryGeocodeQuery(query: string): void {
  console.info("[ITINERARY_GEOCODE_QUERY]", `query=${query}`);
}

export function logItineraryObjectBuilt(stops: number, days: number): void {
  console.info("[ITINERARY_OBJECT_BUILT]", `stops=${stops}`, `days=${days}`);
}

export function logItinerarySaveStart(): void {
  console.info("[ITINERARY_SAVE_START]");
}

export function logItinerarySaveSuccess(tripId?: string): void {
  console.info("[ITINERARY_SAVE_SUCCESS]", tripId ? `tripId=${tripId}` : "");
}

export function logItineraryItemsCoalesced(count: number): void {
  console.info("[ITINERARY_ITEMS_COALESCED]", count);
}

export function logItinerarySavePayloadReady(
  destination: string,
  days: number,
  stops: number,
): void {
  console.info(
    "[ITINERARY_SAVE_PAYLOAD_READY]",
    `destination=${destination}`,
    `days=${days}`,
    `stops=${stops}`,
  );
}

export function logItinerarySaveFailed(reason: string): void {
  console.warn("[ITINERARY_SAVE_FAILED]", `reason=${reason}`);
}

export function logItineraryFailureReason(reason: string): void {
  console.warn("[ITINERARY_FAILURE_REASON]", `reason=${reason}`);
}

export function logItineraryBuildSource(source: string, count: number): void {
  console.info("[ITINERARY_BUILD_SOURCE]", `source=${source}`, `count=${count}`);
}

export function logItineraryUsedRecommendedPlaces(count: number): void {
  console.info("[ITINERARY_USED_RECOMMENDED_PLACES]", `count=${count}`);
}

export function logItineraryDaysBuilt(days: number, stops: number): void {
  console.info("[ITINERARY_DAYS_BUILT]", `days=${days}`, `stops=${stops}`);
}

export function logItineraryValidationResult(valid: boolean, detail?: string): void {
  console.info(
    "[ITINERARY_VALIDATION_RESULT]",
    valid ? "valid" : "invalid",
    detail ? `detail=${detail}` : "",
  );
}
