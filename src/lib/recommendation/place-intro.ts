import type { Locale } from "@/lib/i18n/types";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene } from "@/lib/weather-scene";
import type { PlaceIntroPayload } from "@/lib/recommendation/types";

const SPARSE_MSG: Record<Locale, string> = {
  "zh-TW": "目前資料較少，Roamie 先依地點類型與周邊環境為你整理。",
  en: "Details are limited — Roamie summarized this spot from its type and surroundings.",
  ja: "情報が少ないため、種類と周辺から整理しました。",
  ko: "정보가 적어 유형과 주변을 바탕으로 정리했어요.",
};

function templateIntro(place: PlaceResult, locale: Locale): PlaceIntroPayload {
  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));
  const sparse = !place.rating && !place.address;
  const loc = locale in SPARSE_MSG ? locale : "en";

  const ratingPart =
    place.rating != null
      ? locale === "zh-TW"
        ? `評分 ${place.rating.toFixed(1)}`
        : `Rated ${place.rating.toFixed(1)}`
      : "";

  const intro = sparse
    ? SPARSE_MSG[loc]
    : locale === "zh-TW"
      ? `${place.name}是一間${typeLabel}。${ratingPart ? `${ratingPart}，` : ""}適合順路安排進今天的行程。`
      : `${place.name} is a ${typeLabel}. ${ratingPart ? `${ratingPart}. ` : ""}Easy to fit into today's plan.`;

  return {
    intro,
    recommendReason: "",
    suitableFor: locale === "zh-TW" ? "想慢慢逛、不趕行程的人" : "Anyone who prefers a relaxed pace",
    weatherFit: weatherFitText(null, locale),
    goNowAdvice: place.openStatusLabel || (locale === "zh-TW" ? "出發前可再確認營業時間" : "Check hours before you go"),
    dataSparse: sparse,
    source: "template",
  };
}

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

/** 依 Google Places 資料產生地點介紹（不憑空編造） */
export function buildPlaceIntroFromFacts(input: PlaceIntroInput): PlaceIntroPayload {
  const { place, reason, weather, locale, editorialSummary, reviewSnippets } = input;
  const base = templateIntro(place, locale);
  const typeLabel = identityDisplayLabel(resolvePlaceIdentity(place));

  const facts: string[] = [];
  if (editorialSummary?.trim()) facts.push(editorialSummary.trim());
  if (place.rating != null) {
    facts.push(
      locale === "zh-TW"
        ? `Google 評分 ${place.rating.toFixed(1)}`
        : `Google rating ${place.rating.toFixed(1)}`,
    );
  }
  if (reviewSnippets?.length) {
    facts.push(
      locale === "zh-TW"
        ? `訪客提到：${reviewSnippets.slice(0, 2).join("；")}`
        : `Visitors mention: ${reviewSnippets.slice(0, 2).join("; ")}`,
    );
  }
  if (place.todayHoursLabel) {
    facts.push(
      locale === "zh-TW" ? `今日營業：${place.todayHoursLabel}` : `Hours: ${place.todayHoursLabel}`,
    );
  }

  const hasRichData = facts.length >= 2 || Boolean(editorialSummary?.trim());
  const intro = hasRichData
    ? locale === "zh-TW"
      ? `${place.name}是${typeLabel}。${facts.slice(0, 3).join("。")}。`
      : `${place.name} — ${typeLabel}. ${facts.slice(0, 3).join(". ")}.`
    : base.intro;

  return {
    intro: intro.slice(0, 280),
    recommendReason: reason?.trim() || base.recommendReason,
    suitableFor: base.suitableFor,
    weatherFit: weatherFitText(weather ?? null, locale),
    goNowAdvice:
      place.openStatus === "open"
        ? locale === "zh-TW"
          ? "現在適合前往"
          : "Good time to go now"
        : place.nextOpenHint || base.goNowAdvice,
    dataSparse: !hasRichData,
    source: hasRichData ? "ai" : "template",
  };
}
