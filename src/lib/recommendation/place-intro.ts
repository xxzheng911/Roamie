import type { Locale } from "@/lib/i18n/types";
import { buildPlaceRecommendationReason } from "@/lib/build-place-recommendation-reason";
import { identityDisplayLabel, resolvePlaceIdentity, type PlaceIdentity } from "@/lib/place-identity";
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

function templateIntro(
  place: PlaceResult,
  locale: Locale,
  weather?: WeatherSummary | null,
  reason?: string,
): PlaceIntroPayload {
  const identity = resolvePlaceIdentity(place);
  const typeLabel = identityDisplayLabel(identity, place);
  const sparse = !place.rating && !place.address;
  const loc = locale in SPARSE_MSG ? locale : "en";

  const contextualReason =
    reason?.trim() ||
    buildPlaceRecommendationReason(place, null, weather ?? null, undefined, undefined, locale);

  const ratingPart =
    place.rating != null
      ? locale === "zh-TW"
        ? `Google 評分 ${place.rating.toFixed(1)}`
        : `Rated ${place.rating.toFixed(1)}`
      : "";

  const addressPart =
    place.address?.trim() &&
    (locale === "zh-TW" ? `位於 ${place.address.trim()}` : `Located at ${place.address.trim()}`);

  let intro: string;
  if (sparse) {
    intro =
      locale === "zh-TW"
        ? `${place.name}是一間${typeLabel}。${contextualReason}`
        : `${place.name} is a ${typeLabel}. ${contextualReason}`;
  } else if (locale === "zh-TW") {
    const parts = [`${place.name}是一間${typeLabel}`];
    if (ratingPart) parts.push(ratingPart);
    if (addressPart) parts.push(addressPart);
    parts.push(contextualReason.replace(/^這[^，。]+[，。]/, "").trim() || contextualReason);
    intro = `${parts.filter(Boolean).join("，")}。`;
  } else {
    intro = `${place.name} — ${typeLabel}. ${ratingPart ? `${ratingPart}. ` : ""}${contextualReason}`;
  }

  const suitableFor = suitableForIdentity(identity, locale);

  return {
    intro,
    recommendReason: contextualReason,
    suitableFor,
    weatherFit: weatherFitText(weather ?? null, locale),
    goNowAdvice: goNowAdviceForPlace(place, locale),
    dataSparse: sparse,
    source: "template",
  };
}

function suitableForIdentity(identity: PlaceIdentity, locale: Locale): string {
  const map: Partial<Record<PlaceIdentity, Record<Locale, string>>> = {
    night_market: {
      "zh-TW": "想邊逛邊吃、感受夜市的人",
      en: "Night-market strolls and street food",
      ja: "夜市を歩きながら食べ歩きしたい人",
      ko: "야시장 구경과 먹거리를 즐기고 싶은 분",
    },
    museum: {
      "zh-TW": "喜歡看展、想躲雨或吹冷氣的人",
      en: "Museum-goers and rainy-day planners",
      ja: "展示をじっくり見たい人",
      ko: "전시를 천천히 보고 싶은 분",
    },
    cafe: {
      "zh-TW": "想坐下來放空、歇腳的人",
      en: "Anyone needing a quiet break",
      ja: "一息つきたい人",
      ko: "잠시 쉬고 싶은 분",
    },
    restaurant: {
      "zh-TW": "想好好吃頓飯再繼續走的人",
      en: "A proper meal between stops",
      ja: "しっかり食事をしたい人",
      ko: "제대로 한 끼 하고 싶은 분",
    },
    tourist_attraction: {
      "zh-TW": "想順路繞進去看看、拍拍照的人",
      en: "Sightseeing and photo stops",
      ja: "寄り道して写真を撮りたい人",
      ko: "들러 사진 남기고 싶은 분",
    },
    park: {
      "zh-TW": "想放慢腳步、透透氣的人",
      en: "Slow walks and fresh air",
      ja: "ゆっくり散歩したい人",
      ko: "천천히 산책하고 싶은 분",
    },
    district: {
      "zh-TW": "喜歡逛街、探索巷弄的人",
      en: "Browsing shops and side streets",
      ja: "街歩きが好きな人",
      ko: "골목과 상점을 돌아보고 싶은 분",
    },
    bar: {
      "zh-TW": "夜晚小酌、散步後放鬆的人",
      en: "Evening drinks after a long day",
      ja: "夜に一杯楽しみたい人",
      ko: "저녁에 한잔하고 싶은 분",
    },
  };
  const row = map[identity];
  if (row?.[locale]) return row[locale]!;
  return locale === "zh-TW" ? "想慢慢逛、不趕行程的人" : "Anyone who prefers a relaxed pace";
}

function goNowAdviceForPlace(place: PlaceResult, locale: Locale): string {
  if (place.openStatus === "open" || place.openNow === true) {
    return locale === "zh-TW" ? "目前營業中，現在出發剛好" : "Open now—good time to go";
  }
  if (place.openStatus === "closed_now" || place.openNow === false) {
    return (
      place.nextOpenHint?.trim() ||
      (locale === "zh-TW" ? "出發前建議再確認營業時間" : "Check hours before you go")
    );
  }
  return locale === "zh-TW" ? "出發前可再確認營業時間" : "Check hours before you go";
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
  const base = templateIntro(place, locale, weather, reason);
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
    goNowAdvice: goNowAdviceForPlace(place, locale),
    dataSparse: !hasRichData,
    source: hasRichData ? "ai" : "template",
  };
}
