import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { DailyForecast } from "@/lib/weather.functions";
import { ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";
import { buildFallbackOutfitAdvice } from "@/lib/outfit/fallback-outfit";
import { groupItineraryByDate, listTripDates } from "@/lib/outfit/group-by-date";
import {
  categoriesToOutfitSummary,
  inferCategoriesForItineraryDay,
  mergeAccessoriesIntoPacking,
} from "@/lib/outfit/infer-outfit-categories";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";
import type { DailyOutfitAdvice, OutfitAdvicePayload } from "@/lib/outfit/types";
import type { OutfitCategoryAdvice } from "@/lib/outfit/types";

type OutfitAIItem = {
  date: string;
  outfitSummary?: string;
  narrative?: string;
  packingReminders?: string[];
  categories?: OutfitCategoryAdvice;
};

function resolveItemsForDay(
  tripDate: string,
  fIndex: number,
  forecastLen: number,
  itemsByDate: Map<string, RoamieItineraryItem[]>,
  allItems: RoamieItineraryItem[],
): RoamieItineraryItem[] {
  const direct = itemsByDate.get(tripDate);
  if (direct?.length) return direct;
  if (forecastLen === 1) return allItems;
  const keys = [...itemsByDate.keys()].filter((k) => k !== "未指定日期").sort();
  if (keys[fIndex]) return itemsByDate.get(keys[fIndex]) ?? [];
  if (itemsByDate.size === 1) return [...itemsByDate.values()][0] ?? [];
  return [];
}

function mergeForecastWithAI(
  forecast: DailyForecast[],
  tripDates: string[],
  aiItems: OutfitAIItem[],
  itemsByDate: Map<string, RoamieItineraryItem[]>,
  allItems: RoamieItineraryItem[],
  fashionStyle?: string,
): DailyOutfitAdvice[] {
  const aiByDate = new Map(aiItems.map((a) => [a.date, a]));

  return forecast.map((f, i) => {
    const tripDate = tripDates[i] ?? f.date;
    const items = resolveItemsForDay(tripDate, i, forecast.length, itemsByDate, allItems);
    const activities = inferActivityTypesFromDayItems(items);
    const ai = aiByDate.get(tripDate) ?? aiByDate.get(f.date);
    const hi = f.tempHighC;
    const lo = f.tempLowC;
    const categories =
      ai?.categories ??
      inferCategoriesForItineraryDay(f, items, fashionStyle);
    const outfitSummary = ai?.outfitSummary?.trim() || categoriesToOutfitSummary(categories);
    const packingReminders = mergeAccessoriesIntoPacking(
      categories,
      ai?.packingReminders?.length ? ai.packingReminders : [],
    );

    return {
      date: tripDate,
      dayIndex: i + 1,
      weather: {
        condition: f.condition,
        tempHighC: hi,
        tempLowC: lo,
        precipProbability: f.precipProbability,
        diurnalRangeC: hi != null && lo != null ? Math.round((hi - lo) * 10) / 10 : null,
        iconType: f.iconType,
        cloudCoverPercent: f.cloudCoverPercent ?? null,
        uvi: f.uvi ?? null,
      },
      activityTypes: activities,
      outfitSummary,
      narrative: ai?.narrative ?? "記得依天氣多帶一層，讓自己走得舒服。",
      packingReminders,
      categories,
      styleTone: fashionStyle,
    };
  });
}

export async function buildOutfitAdviceForTrip(params: {
  destination: string;
  startDate: string;
  days: number;
  forecast: DailyForecast[];
  itinerary: RoamieItineraryItem[];
  fashionStyle?: string;
  mood?: string;
}): Promise<OutfitAdvicePayload> {
  const { callOutfitAI, buildScheduleSummary } = await import("@/lib/outfit/outfit-ai.server");
  const itemsByDate = groupItineraryByDate(params.itinerary);
  const forecast =
    params.forecast.length > 0 ? params.forecast.slice(0, params.days) : params.forecast;

  if (!forecast.length) {
    return buildUnavailableOutfitAdvice(params.destination);
  }

  const tripDates = listTripDates(params.itinerary, params.startDate, params.days);

  const dayInputs = forecast.map((f, i) => {
    const tripDate = tripDates[i] ?? f.date;
    const items = itemsByDate.get(tripDate) ?? [];
    return {
      date: tripDate,
      dayIndex: i + 1,
      forecast: f,
      activities: inferActivityTypesFromDayItems(items),
      scheduleSummary: buildScheduleSummary(items),
    };
  });

  try {
    const aiItems = await callOutfitAI({
      destination: params.destination,
      fashionStyle: params.fashionStyle,
      mood: params.mood,
      days: dayInputs,
    });
    return {
      destination: params.destination,
      generatedAt: new Date().toISOString(),
      fashionStyle: params.fashionStyle,
      days: mergeForecastWithAI(
        forecast,
        tripDates,
        aiItems,
        itemsByDate,
        params.itinerary,
        params.fashionStyle,
      ),
    };
  } catch (e) {
    console.warn("[Roamie Outfit] AI failed, using fallback", e);
    return {
      destination: params.destination,
      generatedAt: new Date().toISOString(),
      fashionStyle: params.fashionStyle,
      days: buildFallbackOutfitAdvice(forecast, tripDates, itemsByDate, {
        fashionStyle: params.fashionStyle,
        startDate: params.startDate,
      }),
    };
  }
}

/** 天氣 API 無法取得時的回傳 payload */
export function buildUnavailableOutfitAdvice(destination: string): OutfitAdvicePayload {
  return {
    destination,
    generatedAt: new Date().toISOString(),
    days: [],
    status: "weather_unavailable",
    statusMessage: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
  };
}
