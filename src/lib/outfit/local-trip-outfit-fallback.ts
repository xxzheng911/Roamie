import type { Locale } from "@/lib/i18n/types";
import { unavailableTripWeatherCopy, tripCalendarDates, validWeatherCoords, destinationDate } from "./trip-weather-policy";
import type { RoamieItineraryItem, TripTransportMode } from "@/lib/ai/types";
import type { TripOutfitSuggestionFields, TripWeatherSource } from "@/lib/outfit/types";

type Season = "cool" | "warm" | "transition" | "neutral";

/** Broad packing guidance only, not a climate estimate. Unknown/polar/tropical locations stay neutral. */
export function tripPackingSeason(params: {
  destination: string; startDate: string; endDate: string; lat?: number | null; lng?: number | null;
}): Season {
  const dates = tripCalendarDates(params.startDate, params.endDate);
  if (!params.destination.trim() || !dates.length || !validWeatherCoords(params.lat, params.lng)) return "neutral";
  const latitude = params.lat!;
  if (Math.abs(latitude) < 23.5 || Math.abs(latitude) > 60) return "neutral";
  const seasons = new Set(dates.map(date => {
    const month = Number(date.slice(5, 7));
    const localSeasonMonth = latitude < 0 ? (month + 5) % 12 + 1 : month;
    return localSeasonMonth >= 11 || localSeasonMonth <= 3 ? "cool"
      : localSeasonMonth >= 6 && localSeasonMonth <= 8 ? "warm" : "transition";
  }));
  return seasons.size === 1 ? [...seasons][0] as Season : "transition";
}

const seasonalCopy: Record<Locale, Record<Season | "disclaimer", string>> = {
  "zh-TW": {
    cool: "以較冷季節的旅行準備為參考，可攜帶長袖、保暖外套及舒適步行鞋，採用方便增減的多層次穿搭。",
    warm: "以夏季旅行準備為參考，可攜帶輕便透氣衣物、遮陽用品及舒適步行鞋，另備一件可增減的外層。",
    transition: "行程可能涵蓋季節轉換，建議準備長短袖、可增減的外套及舒適步行鞋，依出發前的實際預報調整。",
    neutral: "建議準備舒適衣物、可增減的外層及好走的鞋；當地氣候尚未確認，請於出發前依實際預報調整。",
    disclaimer: "此建議為一般季節性／旅行準備參考，並非實際天氣預報或歷史氣候統計。",
  },
  en: {
    cool: "For cooler-season packing, consider long sleeves, a warm jacket and comfortable walking shoes, with layers you can add or remove.",
    warm: "For summer packing, consider light, breathable clothes, sun protection and comfortable walking shoes, plus an adjustable outer layer.",
    transition: "Your trip may span a seasonal transition. Pack short and long sleeves, removable layers and comfortable walking shoes; adjust using forecasts before departure.",
    neutral: "Pack comfortable clothes, removable layers and walking shoes. Local climate is unconfirmed; adjust using forecasts before departure.",
    disclaimer: "General seasonal/packing guidance only, not a weather forecast or historical climate statistics.",
  },
  ja: {
    cool: "寒い季節の旅支度の参考として、長袖、防寒用の上着、歩きやすい靴を用意し、脱ぎ着しやすい重ね着を検討してください。",
    warm: "夏の旅支度の参考として、軽く通気性のよい服、日よけ用品、歩きやすい靴に加え、調節できる上着を検討してください。",
    transition: "季節の変わり目を含む可能性があります。半袖と長袖、脱ぎ着できる上着、歩きやすい靴を用意し、出発前の予報に合わせて調整してください。",
    neutral: "快適な服、脱ぎ着できる上着、歩きやすい靴を用意してください。現地の気候は未確認のため、出発前の予報に合わせて調整してください。",
    disclaimer: "一般的な季節・旅支度の参考であり、実際の天気予報や過去の気候統計ではありません。",
  },
  ko: {
    cool: "서늘한 계절의 여행 준비 참고로 긴소매, 보온 외투와 편한 운동화를 준비하고, 벗고 입기 쉬운 겹옷을 고려하세요.",
    warm: "여름 여행 준비 참고로 가볍고 통기성 좋은 옷, 햇빛 차단용품, 편한 운동화와 조절 가능한 겉옷을 고려하세요.",
    transition: "여행이 환절기에 걸칠 수 있습니다. 반소매와 긴소매, 조절 가능한 겉옷과 편한 신발을 준비하고 출발 전 예보에 맞춰 조정하세요.",
    neutral: "편한 옷, 벗고 입기 쉬운 겉옷과 걷기 좋은 신발을 준비하세요. 현지 기후는 확인되지 않았으므로 출발 전 예보에 맞춰 조정하세요.",
    disclaimer: "일반적인 계절별 여행 준비 참고이며, 실제 일기 예보나 과거 기후 통계가 아닙니다.",
  },
};

/** 無天氣 API 時的本地穿搭建議（僅顯示，不寫回 trip） */
export function buildLocalTripOutfitFallback(params: {
  locale: Locale;
  destination: string;
  startDate: string;
  endDate: string;
  items: RoamieItineraryItem[];
  transport?: TripTransportMode | string | null;
  inputKey: string;
  lat?: number | null;
  lng?: number | null;
}): TripOutfitSuggestionFields {
  const wording = seasonalCopy[params.locale];
  const copy = [unavailableTripWeatherCopy(params.locale), wording[tripPackingSeason(params)], wording.disclaimer].join("\n\n");
  const weatherSource: TripWeatherSource = "unavailable";
  return {
    outfitSuggestion: copy,
    outfitCopy: { generatedLocale: params.locale },
    weatherSummary: "",
    weatherSource,
    outfitSuggestionUpdatedAt: new Date().toISOString(),
    outfitSuggestionInputKey: params.inputKey,
  };
}


/** Resolve outside the provider horizon BEFORE saved-cache/server results can override it. */
export function resolveLocalTripOutfit(
  params: Parameters<typeof buildLocalTripOutfitFallback>[0] & {
    timezone?: string; utcOffsetMinutes?: number | null;
  },
  now = Date.now(),
): TripOutfitSuggestionFields | null {
  const dates = tripCalendarDates(params.startDate, params.endDate);
  if (!dates.length) return null;
  const today = destinationDate(now, params.timezone,
    params.utcOffsetMinutes == null ? undefined : params.utcOffsetMinutes * 60);
  const day = Date.parse(today ?? new Date(now).toISOString().slice(0, 10));
  const last = Date.parse(dates[dates.length - 1]);
  const first = Date.parse(dates[0]);
  if (last > day + (today ? 7 : 8) * 86_400_000 || first < day - (today ? 0 : 1) * 86_400_000) {
    return buildLocalTripOutfitFallback(params);
  }
  return null;
}
