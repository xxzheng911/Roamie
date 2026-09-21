import type { Locale } from "@/lib/i18n/types";
import { translate } from "@/lib/i18n/translate";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import { isCurrentGeneratedCopy } from "@/lib/generated-locale";

/** Reconstruct display from factual weather. Never write over a saved record. */
export function localizedOutfitCopy(locale: Locale, facts: {
  low?: number | null; high?: number | null; rain?: number | null; uv?: number | null;
  walking?: boolean; night?: boolean;
}): string {
  const keys = [facts.high != null && facts.high < 18 ? "cold"
    : facts.high != null && facts.high >= 28 ? "hot" : "mild"];
  if ((facts.rain ?? 0) >= 40) keys.push("rain");
  if ((facts.uv ?? 0) >= 6) keys.push("uv");
  if (facts.walking) keys.push("walk");
  if (facts.night) keys.push("night");
  return keys.map((key) => translate(locale, `destinationEditorial.outfit_${key}`)).join(" ");
}

export function dailyOutfitDisplay(advice: DailyOutfitAdvice, locale: Locale): DailyOutfitAdvice {
  if (isCurrentGeneratedCopy(advice, locale)) return locale === "zh-TW" ? advice
    : { ...advice, weather: { ...advice.weather, condition: "" } };
  return { ...advice,
    outfitSummary: translate(locale, "destinationEditorial.outfit_heading"),
    narrative: localizedOutfitCopy(locale, {
      low: advice.weather.tempLowC, high: advice.weather.tempHighC,
      rain: advice.weather.precipProbability, uv: advice.weather.uvi,
      walking: advice.activityTypes.some((type) => ["hiking", "outdoor", "city"].includes(type)),
    }),
    packingReminders: [],
    // Keep numerical weather and icons; the old condition label has unknown provenance.
    weather: { ...advice.weather, condition: "" },
  };
}
