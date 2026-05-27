import { getOpenAIKey } from "@/lib/env.server";
import { mapOpenAIError } from "@/lib/ai/errors";
import type { DailyForecast } from "@/lib/weather-types";
import { ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";
import { openWeatherGetForecast } from "@/lib/weather/openweather.server";
import {
  formatTripDateRangeLabel,
  inferHasNightActivities,
  inferHeavyOutdoorWalking,
  resolveTripDestination,
  transportLabelForPrompt,
} from "@/lib/outfit/trip-outfit-context";
import type { RoamieItineraryItem, TripTransportMode } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import type { TripWeatherSource } from "@/lib/outfit/types";

export type GenerateOutfitSuggestionInput = {
  destination?: string;
  destinationLocation?: TripLocation | null;
  startDate: string;
  endDate: string;
  dayCount: number;
  items: RoamieItineraryItem[];
  transport?: TripTransportMode | string | null;
  lat?: number | null;
  lng?: number | null;
  mood?: string;
};

export type GenerateOutfitSuggestionResult = {
  outfitSuggestion: string;
  weatherSummary: string;
  weatherSource: TripWeatherSource;
  outfitSuggestionUpdatedAt: string;
};

const TRIP_OUTFIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestion: {
      type: "string",
      description: "2-4 句繁體中文穿搭建議，溫柔實用，像旅伴提醒",
    },
  },
  required: ["suggestion"],
} as const;

function aggregateWeatherSummary(
  destination: string,
  dateRangeLabel: string,
  forecast: DailyForecast[],
): string {
  const lo = Math.min(...forecast.map((f) => f.tempLowC ?? 99));
  const hi = Math.max(...forecast.map((f) => f.tempHighC ?? -99));
  const avgPrecip =
    forecast.reduce((s, f) => s + (f.precipProbability ?? 0), 0) / Math.max(1, forecast.length);
  const conditions = [...new Set(forecast.map((f) => f.condition))].slice(0, 2).join("、");
  const uviMax = Math.max(...forecast.map((f) => f.uvi ?? 0));
  const uviBit = uviMax >= 6 ? ` · 紫外線偏強（UV ${Math.round(uviMax)}）` : "";
  return `${destination} ${dateRangeLabel} · ${Math.round(lo)}–${Math.round(hi)}°C · ${conditions} · 降雨機率約 ${Math.round(avgPrecip)}%${uviBit}`;
}

function buildTripOutfitSystemPrompt(): string {
  return `你是 Roamie，使用者的旅行穿搭夥伴。

規則：
- 只輸出一個 JSON 物件，符合 schema
- suggestion 控制在 2–4 句繁體中文
- 語氣溫柔、實用、有生活感；禁止像氣象局播報或表格列點
- 必須依【真實天氣預報】的溫度、降雨、紫外線、日夜溫差給建議
- 冷天要提保暖、洋蔥式穿搭；熱天要提透氣、防曬、補水；下雨要提雨具
- 多步行要提好走的鞋；有夜間行程要提加一層
- 不要開頭問候，直接給建議`;
}

function buildTripOutfitUserMessage(params: {
  destination: string;
  dateRangeLabel: string;
  forecast: DailyForecast[];
  transport: string;
  hasNightActivities: boolean;
  heavyOutdoorWalking: boolean;
  mood?: string;
}): string {
  const dayLines = params.forecast
    .map((f) => {
      const uvi = f.uvi != null ? `、UV ${Math.round(f.uvi)}` : "";
      const night = f.sunset ? `、日落約 ${f.sunset}` : "";
      return `${f.date}：${f.condition}，${Math.round(f.tempLowC ?? 0)}–${Math.round(f.tempHighC ?? 0)}°C，降雨 ${f.precipProbability ?? "?"}%${uvi}${night}`;
    })
    .join("\n");

  return `目的地：${params.destination}
旅行日期：${params.dateRangeLabel}
天氣來源：OpenWeather 官方預報

【每日預報】
${dayLines}

交通方式：${params.transport}
是否有夜間行程：${params.hasNightActivities ? "是" : "否"}
是否多戶外步行：${params.heavyOutdoorWalking ? "是" : "否"}
${params.mood ? `旅行心情：${params.mood}` : ""}

請生成整趟旅程的穿搭建議與攜帶物提醒（JSON）。`;
}

async function callTripOutfitAI(userMessage: string): Promise<string> {
  const apiKey = getOpenAIKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: 400,
      temperature: 0.75,
      messages: [
        { role: "system", content: buildTripOutfitSystemPrompt() },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roamie_trip_outfit",
          strict: true,
          schema: TRIP_OUTFIT_SCHEMA,
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw mapOpenAIError(response.status, err);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content;
  if (!raw) throw new Error("穿搭 AI 沒有回應");

  const parsed = JSON.parse(raw) as { suggestion?: string };
  const text = parsed.suggestion?.trim();
  if (!text) throw new Error("穿搭 AI 回應為空");
  return text;
}

function buildRuleBasedTripSuggestion(params: {
  forecast: DailyForecast[];
  hasNightActivities: boolean;
  heavyOutdoorWalking: boolean;
}): string {
  const hi = Math.max(...params.forecast.map((f) => f.tempHighC ?? -99));
  const lo = Math.min(...params.forecast.map((f) => f.tempLowC ?? 99));
  const avgPrecip =
    params.forecast.reduce((s, f) => s + (f.precipProbability ?? 0), 0) /
    Math.max(1, params.forecast.length);
  const rainy = avgPrecip >= 40;
  const cold = hi <= 12 || lo <= 5;
  const hot = hi >= 28;
  const highUvi = params.forecast.some((f) => (f.uvi ?? 0) >= 7);

  const parts: string[] = [];
  if (cold) {
    parts.push("預報偏冷，建議洋蔥式穿搭，帶保暖外套、圍巾與好走的鞋。");
  } else if (hot) {
    parts.push("預報炎熱，建議透氣短袖與排汗衣物，白天注意補水與防曬。");
  } else {
    parts.push("氣溫適中，以舒適好走的層次穿搭為主，方便依溫差加減。");
  }
  if (rainy) parts.push("可能下雨，記得帶輕便雨具。");
  if (highUvi) parts.push("紫外線偏強，帽子與防曬別忘了。");
  if (params.heavyOutdoorWalking) parts.push("行程步行多，鞋子選好走透氣的款式會更輕鬆。");
  if (params.hasNightActivities) parts.push("有夜間行程的話，多帶一件薄外套會更安心。");
  return parts.join(" ");
}

/** 依行程資料生成整趟穿搭建議 */
export async function generateOutfitSuggestion(
  input: GenerateOutfitSuggestionInput,
): Promise<GenerateOutfitSuggestionResult> {
  const destination = resolveTripDestination({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.items,
  });
  const dateRangeLabel = formatTripDateRangeLabel(input.startDate, input.endDate);
  const transport = transportLabelForPrompt(input.transport);
  const hasNightActivities = inferHasNightActivities(input.items);
  const heavyOutdoorWalking = inferHeavyOutdoorWalking(input.items, input.transport);

  const lat = input.lat ?? input.destinationLocation?.lat ?? null;
  const lng = input.lng ?? input.destinationLocation?.lng ?? null;

  if (lat == null || lng == null) {
    return {
      outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
      weatherSummary: "",
      weatherSource: "unavailable",
      outfitSuggestionUpdatedAt: new Date().toISOString(),
    };
  }

  let forecast: DailyForecast[];
  try {
    const days = Math.min(Math.max(input.dayCount, 1), 14);
    forecast = await openWeatherGetForecast(lat, lng, days);
  } catch (e) {
    console.warn("[Roamie TripOutfit] OpenWeather forecast failed", e);
    return {
      outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
      weatherSummary: "",
      weatherSource: "unavailable",
      outfitSuggestionUpdatedAt: new Date().toISOString(),
    };
  }

  if (!forecast.length) {
    return {
      outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
      weatherSummary: "",
      weatherSource: "unavailable",
      outfitSuggestionUpdatedAt: new Date().toISOString(),
    };
  }

  const weatherSummary = aggregateWeatherSummary(destination, dateRangeLabel, forecast);

  let outfitSuggestion: string;
  try {
    const userMsg = buildTripOutfitUserMessage({
      destination,
      dateRangeLabel,
      forecast,
      transport,
      hasNightActivities,
      heavyOutdoorWalking,
      mood: input.mood,
    });
    outfitSuggestion = await callTripOutfitAI(userMsg);
  } catch (e) {
    console.warn("[Roamie TripOutfit] AI failed, using forecast-based rules", e);
    outfitSuggestion = buildRuleBasedTripSuggestion({
      forecast,
      hasNightActivities,
      heavyOutdoorWalking,
    });
  }

  return {
    outfitSuggestion,
    weatherSummary,
    weatherSource: "openweather",
    outfitSuggestionUpdatedAt: new Date().toISOString(),
  };
}
