import type {
  RoamieItineraryItem,
  RoamiePayloadV2,
  RoamieRecommendationItem,
  TripTransportMode,
} from "@/lib/ai/types";
import type { ClientContextBundle } from "@/lib/fetch-context";
import type { TripLocation } from "@/lib/location/types";
import { listTripDates } from "@/lib/outfit/group-by-date";
import {
  tripPlaceFromRecommendation,
  tripPlaceToItineraryItem,
} from "@/lib/trip/trip-place-input";
import { generateTripTitle } from "@/lib/trip/trip-title";

export type LocalItineraryFallbackInput = {
  destination: string;
  days: number;
  startDate: string;
  endDate: string;
  mood?: string;
  style?: string;
  transport?: string;
  selectedPlaces: RoamieRecommendationItem[];
  weather?: ClientContextBundle["weather"];
  destinationLocation?: TripLocation;
  origin?: string;
  travelers?: number;
};

function inferTransportMode(transport: string): TripTransportMode {
  const t = transport.trim().toLowerCase();
  if (!t) return "walk";
  if (/機車|scooter|摩托|バイク|오토바이/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車|レンタカー|렌터카|self-drive/.test(t)) return "drive";
  if (
    /捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro|公共交通|대중교통|public transit/.test(t)
  ) {
    return "transit";
  }
  if (/計程車|taxi|uber|配車|택시|rideshare|共乘/.test(t)) return "transit";
  if (/單車|自行车|自転車|자전거|cycling|bike/.test(t)) return "walk";
  return "walk";
}

function buildItineraryItems(input: LocalItineraryFallbackInput): RoamieItineraryItem[] {
  const places = input.selectedPlaces;
  if (places.length === 0) return [];

  const dateKeys = listTripDates([], input.startDate, input.days);
  const itinerary: RoamieItineraryItem[] = [];

  places.forEach((rec, index) => {
    const tripPlace = tripPlaceFromRecommendation(rec);
    const date = dateKeys[index % dateKeys.length] ?? input.startDate;
    const hour = 10 + (index % 6);
    itinerary.push(
      tripPlaceToItineraryItem(tripPlace, {
        date,
        time: `${String(hour).padStart(2, "0")}:00`,
        notes: rec.reason?.trim() ? rec.reason : undefined,
      }),
    );
  });

  return itinerary;
}

function buildSummary(input: LocalItineraryFallbackInput): string {
  const placeNames = input.selectedPlaces.map((p) => p.placeName ?? p.name).filter(Boolean);
  const placeLine =
    placeNames.length === 1
      ? `已將「${placeNames[0]}」排進行程。`
      : `已將你選的 ${placeNames.length} 個地點排進行程：${placeNames.join("、")}。`;
  const parts = [
    `AI 暫時無法使用，我先幫你在 ${input.destination} 建立基本行程。`,
    placeLine,
    "時間與順序可依你的節奏在收藏行程中調整。",
    input.mood?.trim() ? `心情：${input.mood.trim()}` : "",
    input.style?.trim() ? `風格：${input.style.trim()}` : "",
  ].filter(Boolean);
  return parts.join("\n").slice(0, 500);
}

/** OpenAI 403 / 地區限制 / 常見連線錯誤時改走本地行程 */
export function isAiItineraryServiceUnavailableError(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  const lower = m.toLowerCase();
  if (/403/.test(lower)) return true;
  if (/country.*region.*territory.*not supported/i.test(m)) return true;
  if (/openai.*錯誤/i.test(m) && /403|region|territory|not supported/i.test(m)) return true;
  if (/failed to fetch|network error|load failed|timeout|timed out/i.test(m)) return true;
  return false;
}

/** 不依賴 OpenAI，用已選地點建立可編輯的基本行程 */
export function buildLocalItineraryFallback(input: LocalItineraryFallbackInput): RoamiePayloadV2 {
  const itinerary = buildItineraryItems(input);
  const transport = inferTransportMode(input.transport ?? "");
  const w = input.weather;

  return {
    version: 2,
    title: generateTripTitle({
      destination: input.destination,
      mood: input.mood,
      moodTag: input.mood,
    }),
    summary: buildSummary(input),
    moodTag: input.mood?.trim() ?? "",
    recommendations: [],
    itinerary,
    destination: input.destination,
    destinationLocation: input.destinationLocation,
    days: input.days,
    generatedAt: new Date().toISOString(),
    travelers: input.travelers,
    tripSettings: {
      startTime: "10:00",
      transport,
      tripStartDate: input.startDate,
      tripEndDate: input.endDate,
      legMinutes: {},
      legTransport: {},
      transitLegs: {},
    },
    weatherSummary: w
      ? `${w.city ?? input.destination}：${w.condition}，約 ${w.tempC}°C${w.precipProbability != null ? `，降雨機率 ${w.precipProbability}%` : ""}`
      : undefined,
    aiFallbackSource: "local_itinerary",
    fallbackReason: "ai_unavailable",
  } as RoamiePayloadV2;
}
