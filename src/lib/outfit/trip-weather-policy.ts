import type { DailyForecast } from "@/lib/weather-types";
import type { Locale } from "@/lib/i18n/types";
import type { TripOutfitSuggestionFields } from "./types";

export const TRIP_WEATHER_VERSION = "trip-weather-v3";
export const FORECAST_TTL_MS = 45 * 60_000;
export const UNAVAILABLE_TTL_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

/** Calendar arithmetic only: never substitute today's date for missing trip dates. */
export function tripCalendarDates(start: string, end: string): string[] {
  const valid = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
  if (!valid(start) || !valid(end)) return [];
  const count = (Date.parse(end) - Date.parse(start)) / DAY_MS + 1;
  if (count < 1 || count > 14) return [];
  return Array.from({ length: count }, (_, i) => new Date(Date.parse(start) + i * DAY_MS).toISOString().slice(0, 10));
}

export function validWeatherCoords(lat: unknown, lng: unknown): boolean {
  return typeof lat === "number" && Number.isFinite(lat) && Math.abs(lat) <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function destinationDate(now: number, timezone?: string, offsetSeconds?: number): string | null {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat("en", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      return ["year", "month", "day"].map(k => parts.find(p => p.type === k)!.value).join("-");
    } catch { return null; }
  }
  return Number.isFinite(offsetSeconds)
    ? new Date(now + offsetSeconds! * 1000).toISOString().slice(0, 10) : null;
}

/** Require every requested calendar day and both temperatures. Rain remains unknown when absent. */
export function selectTripForecast(rows: DailyForecast[], dates: string[]): DailyForecast[] {
  if (!dates.length) return [];
  const selected: DailyForecast[] = [];
  for (const date of dates) {
    const matches = rows.filter(r => r.date === date);
    if (matches.length !== 1) return [];
    const row = matches[0];
    if (row.tempLowC == null || row.tempHighC == null || !Number.isFinite(row.tempLowC) ||
      !Number.isFinite(row.tempHighC) || row.tempLowC > row.tempHighC) return [];
    selected.push({ ...row, precipProbability: row.precipProbability != null &&
      Number.isFinite(row.precipProbability) && row.precipProbability >= 0 && row.precipProbability <= 100
      ? row.precipProbability : null });
  }
  return selected;
}

export function forecastFacts(rows: DailyForecast[]) {
  return {
    low: Math.min(...rows.map(r => r.tempLowC!)),
    high: Math.max(...rows.map(r => r.tempHighC!)),
    rain: rows.every(r => r.precipProbability != null && Number.isFinite(r.precipProbability))
      ? rows.reduce((sum, r) => sum + r.precipProbability!, 0) / rows.length : null,
  };
}

const labels = {
  "zh-TW": ["天氣預報", "每日降雨機率平均", "降雨資料不足", "天氣資料暫不可用；目前沒有涵蓋完整行程日期的可靠資料。"],
  en: ["Weather forecast", "Mean daily rain probability", "Rain data unavailable", "Weather unavailable: reliable data does not cover the complete trip dates."],
  ja: ["天気予報", "日別降水確率の平均", "降水データ不足", "旅行期間全体を網羅する信頼できる天気データがありません。"],
  ko: ["일기 예보", "일별 강수 확률 평균", "강수 자료 부족", "전체 여행 날짜를 포함하는 신뢰할 수 있는 날씨 자료가 없습니다."],
} satisfies Record<Locale, string[]>;
export function unavailableTripWeatherCopy(locale: Locale): string { return labels[locale][3]; }
export function tripForecastSummary(locale: Locale, destination: string, start: string, end: string, rows: DailyForecast[]): string {
  const facts = forecastFacts(rows);
  const copy = labels[locale];
  const condition = locale === "zh-TW" ? [...new Set(rows.map(r => r.condition).filter(Boolean))].join("、") : "";
  return `${destination} ${start}～${end} · ${copy[0]} · ${Math.round(facts.low)}–${Math.round(facts.high)}°C` +
    (condition ? ` · ${condition}` : "") + ` · ${facts.rain == null ? copy[2] : `${copy[1]} ${Math.round(facts.rain)}%`}`;
}

export function isFreshTripOutfit(fields: TripOutfitSuggestionFields, key: string, now = Date.now()): boolean {
  const age = now - Date.parse(fields.outfitSuggestionUpdatedAt ?? "");
  const ttl = fields.weatherSource === "openweather" ? FORECAST_TTL_MS : UNAVAILABLE_TTL_MS;
  return fields.outfitSuggestionInputKey === key && key.includes(TRIP_WEATHER_VERSION) &&
    Boolean(fields.outfitSuggestion) && Number.isFinite(age) && age >= 0 && age < ttl;
}
