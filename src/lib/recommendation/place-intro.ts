import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { PlaceIntroPayload } from "@/lib/recommendation/types";
import {
  generatePlaceIntro,
  placeDetailToIntroInput,
} from "@/lib/place/generate-place-intro";
import { isGenericPlaceReason } from "@/lib/place/place-intro-constants";

function weatherFitText(weather: WeatherSummary | null, locale: Locale): string {
  if (!weather) {
    return locale === "zh-TW" ? "天氣資料暫不可用" : "Weather unavailable";
  }
  const scene = classifyWeatherScene({
    tempC: weather.tempC,
    precipProbability: weather.precipProbability,
    condition: weather.condition,
    isDaytime: weather.isDaytime,
  });
  const map: Record<string, Record<Locale, string>> = {
    rainy: {
      "zh-TW": "下雨時較適合，若為戶外點請備雨具",
      en: "Better in rain; bring gear for outdoor spots",
      ja: "雨の日向き。屋外は雨具を",
      ko: "비 오는 날 적합, 실외는 우비 준비",
    },
    hot: {
      "zh-TW": "炎熱天建議避開正午，傍晚較舒服",
      en: "Avoid midday heat; evenings are nicer",
      ja: "真昼は避け、夕方がおすすめ",
      ko: "한날은 피하고 저녁이 좋아요",
    },
    night: {
      "zh-TW": "適合夜晚氛圍",
      en: "Fits a night-out mood",
      ja: "夜の雰囲気に合う",
      ko: "밤 분위기에 어울려요",
    },
    default: {
      "zh-TW": "目前天氣適合前往",
      en: "Weather looks fine for a visit",
      ja: "今の天気なら行きやすい",
      ko: "지금 날씨로 가기 괜찮아요",
    },
  };
  const key = scene === "rainy" || scene === "hot" || scene === "night" ? scene : "default";
  return map[key][locale in map[key] ? locale : "en"];
}

export type PlaceIntroInput = {
  place: PlaceResult;
  reason?: string;
  weather?: WeatherSummary | null;
  locale: Locale;
  /** Google Place Details 摘要（若有） */
  editorialSummary?: string | null;
  reviewSnippets?: string[];
};

/** 依 Google Places 資料產生地點介紹（合併編輯摘要與行程情境） */
export function buildPlaceIntroFromFacts(input: PlaceIntroInput): PlaceIntroPayload {
  const { place, reason, weather, locale, editorialSummary } = input;
  const generated = generatePlaceIntro(
    placeDetailToIntroInput(place, { editorialSummary }),
    {},
    {
      locale,
      weather,
      existingReason: isGenericPlaceReason(reason) ? null : reason,
    },
  );

  let intro = generated.intro;
  if (editorialSummary?.trim() && !intro.includes(editorialSummary.trim().slice(0, 20))) {
    intro =
      locale === "zh-TW"
        ? `${place.name}：${editorialSummary.trim().slice(0, 200)}`
        : `${place.name}: ${editorialSummary.trim().slice(0, 200)}`;
  }

  return {
    intro: intro.slice(0, 280),
    recommendReason: generated.recommendReason,
    suitableFor: generated.suitableFor,
    weatherFit: weatherFitText(weather ?? null, locale),
    goNowAdvice:
      place.openStatus === "open"
        ? locale === "zh-TW"
          ? "現在適合前往"
          : "Good time to go now"
        : place.nextOpenHint || generated.visitTips[0] || "",
    dataSparse: false,
    source: editorialSummary?.trim() ? "ai" : "template",
  };
}
