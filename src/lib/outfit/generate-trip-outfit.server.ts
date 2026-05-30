import { getOpenAIKey } from "@/lib/env.server";
import { mapOpenAIError } from "@/lib/ai/errors";
import type { DailyForecast } from "@/lib/weather-types";
import type { WeatherSummary } from "@/lib/weather-types";
import { ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";
import { openWeatherGetCurrent, openWeatherGetForecast } from "@/lib/weather/openweather.server";
import { deriveOutfitTags, mergeOutfitTags } from "@/lib/outfit/derive-outfit-tags";
import { inferActivityTypesFromDayItems, formatActivityTypesForPrompt } from "@/lib/outfit/infer-activities";
import {
  formatTripScenesForPrompt,
  inferTripSceneTypes,
} from "@/lib/outfit/infer-trip-scene";
import { loadOutfitUserContext } from "@/lib/outfit/load-outfit-user-context";
import {
  composeWeatherInputSignature,
  pickDisplayWeather,
} from "@/lib/outfit/trip-outfit-weather";
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
  outfitTags: string[];
  weatherTempC: number | null;
  weatherFeelsLikeC: number | null;
  weatherCondition: string;
  weatherIconType: string;
  weatherIsDaytime: boolean;
  weatherPrecipPercent: number | null;
  weatherInputSignature: string;
  outfitTier: "free" | "plus";
};

const TRIP_OUTFIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    suggestion: {
      type: "string",
      description:
        "2-4 句繁體中文穿搭建議，需具體提到溫度感受、降雨、日夜與行程類型，像旅伴提醒，禁止模板句",
    },
    highlightTags: {
      type: "array",
      items: { type: "string" },
      description: "2-5 個短標籤，從：防風、防曬、防水、好走、適合拍照、保暖、透氣、層次穿搭、夜間加溫",
    },
  },
  required: ["suggestion", "highlightTags"],
} as const;

function unavailableResult(): GenerateOutfitSuggestionResult {
  return {
    outfitSuggestion: ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
    weatherSummary: "",
    weatherSource: "unavailable",
    outfitSuggestionUpdatedAt: new Date().toISOString(),
    outfitTags: [],
    weatherTempC: null,
    weatherFeelsLikeC: null,
    weatherCondition: "",
    weatherIconType: "03",
    weatherIsDaytime: true,
    weatherPrecipPercent: null,
    weatherInputSignature: "unavailable",
    outfitTier: "free",
  };
}

function aggregateWeatherSummary(
  destination: string,
  dateRangeLabel: string,
  forecast: DailyForecast[],
  current: WeatherSummary | null,
): string {
  const lo = Math.min(...forecast.map((f) => f.tempLowC ?? 99), current?.tempC ?? 99);
  const hi = Math.max(...forecast.map((f) => f.tempHighC ?? -99), current?.tempC ?? -99);
  const avgPrecip =
    forecast.reduce((s, f) => s + (f.precipProbability ?? 0), 0) / Math.max(1, forecast.length);
  const conditions = [...new Set(forecast.map((f) => f.condition))].slice(0, 2).join("、");
  const uviMax = Math.max(...forecast.map((f) => f.uvi ?? 0), current?.uvi ?? 0);
  const uviBit = uviMax >= 6 ? ` · 紫外線偏強（UV ${Math.round(uviMax)}）` : "";
  const feels =
    current?.feelsLikeC != null ? ` · 體感約 ${Math.round(current.feelsLikeC)}°C` : "";
  const dayNight = current ? (current.isDaytime ? " · 目前白天" : " · 目前夜晚") : "";
  return `${destination} ${dateRangeLabel} · ${Math.round(lo)}–${Math.round(hi)}°C${feels}${dayNight} · ${conditions} · 降雨機率約 ${Math.round(avgPrecip)}%${uviBit}`;
}

function buildTripOutfitSystemPrompt(isPlus: boolean): string {
  const tierBlock = isPlus
    ? `使用者為 Roamie Plus：請融入其旅行風格、偏好標籤、拍照／慢旅／美食等傾向，可建議色系與單品風格（仍須符合天氣）。`
    : `使用者為 Free：提供實用、具體的基本穿搭建議即可，不需展開色彩或長期偏好記憶。`;

  return `你是 Roamie，使用者的旅行穿搭夥伴。
${tierBlock}

規則：
- 只輸出一個 JSON 物件，符合 schema
- suggestion 2–4 句繁體中文，必須依【真實天氣】的氣溫、體感、降雨機率、日夜與【行程場景】動態撰寫
- 禁止固定模板（如只說「適合薄外套」）；要寫出為何、何時加減衣物、鞋款建議
- 範例語氣：高雄 32°C 晴天 → 透氣短袖與輕便鞋，室內冷氣可帶薄罩衫；京都 12°C 下雨 → 洋蔥式穿搭與防水外套，避免帆布鞋
- 語氣溫柔像旅伴，不要氣象局播報口吻
- highlightTags 2–5 個，從允許清單挑選`;
}

function buildTripOutfitUserMessage(params: {
  destination: string;
  dateRangeLabel: string;
  forecast: DailyForecast[];
  current: WeatherSummary | null;
  transport: string;
  hasNightActivities: boolean;
  heavyOutdoorWalking: boolean;
  mood?: string;
  activities: ReturnType<typeof inferActivityTypesFromDayItems>;
  scenes: ReturnType<typeof inferTripSceneTypes>;
  travelProfileText: string;
  isPlus: boolean;
}): string {
  const dayLines = params.forecast
    .map((f) => {
      const uvi = f.uvi != null ? `、UV ${Math.round(f.uvi)}` : "";
      const night = f.sunset ? `、日落約 ${f.sunset}` : "";
      return `${f.date}：${f.condition}，${Math.round(f.tempLowC ?? 0)}–${Math.round(f.tempHighC ?? 0)}°C，降雨 ${f.precipProbability ?? "?"}%${uvi}${night}`;
    })
    .join("\n");

  const currentLine = params.current?.available
    ? `【即時】${params.current.condition} · ${Math.round(params.current.tempC ?? 0)}°C（體感 ${Math.round(params.current.feelsLikeC ?? 0)}°C）· ${params.current.isDaytime ? "白天" : "夜晚"} · 降雨 ${params.current.precipProbability ?? "?"}%`
    : "【即時】暫無";

  return `目的地：${params.destination}
旅行日期：${params.dateRangeLabel}
行程類型：${formatActivityTypesForPrompt(params.activities)}
行程場景：${formatTripScenesForPrompt(params.scenes)}
交通：${params.transport}
夜間行程：${params.hasNightActivities ? "有" : "無"}
多戶外步行：${params.heavyOutdoorWalking ? "是" : "否"}
${params.mood ? `旅行心情：${params.mood}` : ""}

${params.isPlus ? `【使用者旅行檔案】\n${params.travelProfileText}` : `【使用者】${params.travelProfileText}`}

【即時天氣】
${currentLine}

【每日預報（OpenWeather）】
${dayLines}

請輸出 JSON（suggestion + highlightTags）。`;
}

async function callTripOutfitAI(
  userMessage: string,
  isPlus: boolean,
): Promise<{ suggestion: string; highlightTags: string[] }> {
  const apiKey = getOpenAIKey();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: isPlus ? 520 : 400,
      temperature: 0.78,
      messages: [
        { role: "system", content: buildTripOutfitSystemPrompt(isPlus) },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "roamie_trip_outfit_v2",
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

  const parsed = JSON.parse(raw) as { suggestion?: string; highlightTags?: string[] };
  const suggestion = parsed.suggestion?.trim();
  if (!suggestion) throw new Error("穿搭 AI 回應為空");
  return {
    suggestion,
    highlightTags: Array.isArray(parsed.highlightTags) ? parsed.highlightTags : [],
  };
}

function buildRuleBasedTripSuggestion(params: {
  destination: string;
  forecast: DailyForecast[];
  current: WeatherSummary | null;
  hasNightActivities: boolean;
  heavyOutdoorWalking: boolean;
  scenes: ReturnType<typeof inferTripSceneTypes>;
}): string {
  const hi = Math.max(...params.forecast.map((f) => f.tempHighC ?? -99), params.current?.tempC ?? -99);
  const lo = Math.min(...params.forecast.map((f) => f.tempLowC ?? 99), params.current?.tempC ?? 99);
  const avgPrecip =
    params.forecast.reduce((s, f) => s + (f.precipProbability ?? 0), 0) /
    Math.max(1, params.forecast.length);
  const rainy = avgPrecip >= 40;
  const cold = hi <= 12 || lo <= 5;
  const hot = hi >= 28;
  const scorching = hi >= 32;
  const nightCold = params.hasNightActivities && lo <= 14;
  const dest = params.destination;
  const currentTemp = params.current?.tempC;
  const feelsHot =
    scorching || (currentTemp != null && currentTemp >= 30 && hi >= 26);

  const parts: string[] = [];
  if (feelsHot) {
    parts.push(
      `${dest} 偏熱（約 ${Math.round(hi)}°C${currentTemp != null ? `，目前約 ${Math.round(currentTemp)}°C` : ""}），建議輕薄透氣短袖、防曬帽與好走的涼鞋／運動鞋；戶外記得補水。`,
    );
  } else if (hot) {
    parts.push(
      `${dest} 白天偏熱（約 ${Math.round(hi)}°C），建議透氣短袖與輕便鞋；進冷氣空間可多帶一件薄罩衫。`,
    );
  } else if (cold && rainy) {
    parts.push(
      `${dest} 偏冷且可能下雨（約 ${Math.round(lo)}–${Math.round(hi)}°C），建議防水外套、薄針織或保暖內層，鞋子選防滑好走款。`,
    );
  } else if (cold) {
    parts.push(
      `${dest} 氣溫偏低（約 ${Math.round(lo)}–${Math.round(hi)}°C），建議洋蔥式穿搭與保暖外套，鞋子選好走防滑款。`,
    );
  } else {
    parts.push(
      `${dest} 氣溫適中（約 ${Math.round(lo)}–${Math.round(hi)}°C），以舒適層次穿搭為主，方便依溫差加減。`,
    );
  }
  if (rainy && !cold) parts.push("降雨機率偏高，外層建議防水薄外套，鞋子避免帆布鞋。");
  else if (rainy && cold) parts.push("雨勢可能持續，記得折疊傘與防水鞋套。");
  if (params.scenes.includes("beach")) parts.push("海邊行程記得防曬帽與透氣長褲。");
  if (params.scenes.includes("mountain")) parts.push("山區風大，建議防風外套與機能鞋。");
  if (params.heavyOutdoorWalking) parts.push("步行多，選好走透氣的鞋款會更輕鬆。");
  if (nightCold) parts.push("晚間偏涼，建議大衣或厚外套，適合層次感穿搭。");
  return parts.join(" ");
}

async function resolveTripCoords(input: GenerateOutfitSuggestionInput): Promise<{
  lat: number;
  lng: number;
} | null> {
  const { resolveOutfitCoords } = await import("@/lib/outfit/resolve-outfit-coords");
  return resolveOutfitCoords({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.items,
    lat: input.lat,
    lng: input.lng,
  });
}

/** 依行程資料生成整趟穿搭建議 */
export async function generateOutfitSuggestion(
  input: GenerateOutfitSuggestionInput,
): Promise<GenerateOutfitSuggestionResult> {
  const userCtx = await loadOutfitUserContext();
  const destination = resolveTripDestination({
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    itinerary: input.items,
  });
  const dateRangeLabel = formatTripDateRangeLabel(input.startDate, input.endDate);
  const transport = transportLabelForPrompt(input.transport);
  const hasNightActivities = inferHasNightActivities(input.items);
  const heavyOutdoorWalking = inferHeavyOutdoorWalking(input.items, input.transport);
  const activities = inferActivityTypesFromDayItems(input.items);
  const scenes = inferTripSceneTypes(input.items);

  const coords = await resolveTripCoords(input);
  if (!coords) {
    return unavailableResult();
  }

  let forecast: DailyForecast[];
  let current: WeatherSummary | null = null;
  try {
    const days = Math.min(Math.max(input.dayCount, 1), 14);
    [forecast, current] = await Promise.all([
      openWeatherGetForecast(coords.lat, coords.lng, days),
      openWeatherGetCurrent(coords.lat, coords.lng, destination).catch(() => null),
    ]);
  } catch (e) {
    console.warn("[Roamie TripOutfit] weather fetch failed", e);
    return unavailableResult();
  }

  if (!forecast.length) {
    return unavailableResult();
  }

  const weatherInputSignature = composeWeatherInputSignature(forecast, current);
  const displayWx = pickDisplayWeather(current, forecast);
  const weatherSummary = aggregateWeatherSummary(destination, dateRangeLabel, forecast, current);

  const ruleTags = deriveOutfitTags({
    current,
    forecast,
    activities,
    scenes,
    hasNightActivities,
    isPlus: userCtx.hasPlusAccess,
    travelTags: userCtx.travelTags,
  });

  let outfitSuggestion: string;
  let outfitTags: string[];

  try {
    const userMsg = buildTripOutfitUserMessage({
      destination,
      dateRangeLabel,
      forecast,
      current,
      transport,
      hasNightActivities,
      heavyOutdoorWalking,
      mood: input.mood,
      activities,
      scenes,
      travelProfileText: userCtx.travelProfileText,
      isPlus: userCtx.hasPlusAccess,
    });
    const ai = await callTripOutfitAI(userMsg, userCtx.hasPlusAccess);
    outfitSuggestion = ai.suggestion;
    outfitTags = mergeOutfitTags(ruleTags, ai.highlightTags);
  } catch (e) {
    console.warn("[Roamie TripOutfit] AI failed, using forecast-based rules", e);
    outfitSuggestion = buildRuleBasedTripSuggestion({
      destination,
      forecast,
      current,
      hasNightActivities,
      heavyOutdoorWalking,
      scenes,
    });
    outfitTags = ruleTags;
  }

  return {
    outfitSuggestion,
    weatherSummary,
    weatherSource: "openweather",
    outfitSuggestionUpdatedAt: new Date().toISOString(),
    outfitTags,
    weatherTempC: displayWx.tempC,
    weatherFeelsLikeC: displayWx.feelsLikeC,
    weatherCondition: displayWx.condition,
    weatherIconType: displayWx.iconType,
    weatherIsDaytime: displayWx.isDaytime,
    weatherPrecipPercent: displayWx.precipPercent,
    weatherInputSignature,
    outfitTier: userCtx.hasPlusAccess ? "plus" : "free",
  };
}
