import type { Locale } from "@/lib/i18n/types";
import {
  identityDisplayLabel,
  resolvePlaceIdentity,
  type PlaceIdentity,
} from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";
import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene } from "@/lib/weather-scene";
import {
  isGenericPlaceReason,
  PLACE_INTRO_GENERIC_FALLBACK,
} from "@/lib/place/place-intro-constants";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";

export type PlaceIntroItineraryContext = {
  city?: string | null;
  destination?: string | null;
  travelMonth?: number | null;
  dayIndex?: number | null;
  dayDate?: string | null;
  nearbyStops?: string[];
  tripSummary?: string | null;
  travelStyle?: string | null;
  pace?: string | null;
  mood?: string | null;
};

export type PlaceIntroPlaceInput = {
  placeName: string;
  city?: string | null;
  category?: string | null;
  address?: string | null;
  types?: string[] | null;
  primaryType?: string | null;
  rating?: number | null;
  userRatingsTotal?: number | null;
  openingHours?: string | null;
  openStatusLabel?: string | null;
  editorialSummary?: string | null;
};

export type GeneratedPlaceIntro = {
  intro: string;
  highlights: string[];
  visitTips: string[];
  recommendReason: string;
  suitableFor: string;
  suggestedStay: string;
  routeTips: string;
  cautions: string;
};

export function logPlaceIntroGenerateStart(meta: {
  placeName: string;
  city?: string | null;
  category?: string | null;
}): void {
  console.info("[PLACE_INTRO_GENERATE_START]", meta);
}

export function logPlaceIntroGenerateSuccess(meta: {
  placeName: string;
  introPreview: string;
}): void {
  console.info("[PLACE_INTRO_GENERATE_SUCCESS]", {
    placeName: meta.placeName,
    introPreview: meta.introPreview.slice(0, 80),
  });
}

export function logPlaceIntroFallbackUsed(meta: { placeName: string; reason: string }): void {
  console.info("[PLACE_INTRO_FALLBACK_USED]", meta);
}

function monthLabelZh(month: number | null | undefined): string {
  if (month == null) return "";
  return `${month} 月`;
}

function cityLabel(ctx: PlaceIntroItineraryContext, place: PlaceIntroPlaceInput): string {
  return (
    ctx.city?.trim() ||
    ctx.destination?.trim() ||
    place.city?.trim() ||
    extractCityFromAddress(place.address) ||
    ""
  );
}

function extractCityFromAddress(address?: string | null): string {
  if (!address?.trim()) return "";
  const parts = address.split(/[,，]/).map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? parts[0] ?? "";
}

function toPlaceResult(place: PlaceIntroPlaceInput): PlaceResult {
  return {
    id: "intro-gen",
    name: place.placeName,
    address: place.address ?? null,
    lat: null,
    lng: null,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingsTotal ?? null,
    photoName: null,
    primaryType: place.primaryType ?? place.category ?? null,
    types: place.types ?? (place.category ? [place.category] : null),
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: place.openStatusLabel ?? "",
    todayHoursLabel: place.openingHours ?? "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

type LandmarkProfile = {
  match: (name: string) => boolean;
  build: (
    place: PlaceIntroPlaceInput,
    ctx: PlaceIntroItineraryContext,
  ) => GeneratedPlaceIntro;
};

function nearbyRouteTip(ctx: PlaceIntroItineraryContext): string {
  const nearby = ctx.nearbyStops?.filter(Boolean) ?? [];
  if (!nearby.length) return "可與同一天的鄰近景點串在一起，減少來回折返。";
  return `建議與同一天的「${nearby.slice(0, 3).join("」、「")}」一起安排，動線較順。`;
}

function monthWeatherNote(month: number | null | undefined, locale: Locale): string {
  if (month == null || locale !== "zh-TW") return "";
  if ([11, 12, 1, 2].includes(month)) {
    return `${monthLabelZh(month)}前往時氣溫偏冷`;
  }
  if ([6, 7, 8].includes(month)) {
    return `${monthLabelZh(month)}天氣較熱`;
  }
  return "";
}

const LANDMARK_PROFILES: LandmarkProfile[] = [
  {
    match: (n) => /淺草寺|senso.?ji|asakusa temple/i.test(n),
    build: (place, ctx) => {
      const city = cityLabel(ctx, place) || "東京";
      const monthNote = monthWeatherNote(ctx.travelMonth, "zh-TW");
      const intro = `淺草寺是${city}經典寺院景點，適合安排在上野、雷門、仲見世通一帶一起散步。${monthNote ? `${monthNote}，` : ""}建議白天安排，順路吃小吃或拍照。`;
      return {
        intro,
        highlights: ["經典寺院與參道散步", "適合與雷門、仲見世通串遊"],
        visitTips: ["建議白天前往，光線與人潮節奏較舒服", "可預留時間逛仲見世通小吃"],
        recommendReason: intro,
        suitableFor: "想感受傳統氛圍、喜歡拍照與散步的人",
        suggestedStay: "建議停留 1.5～2.5 小時",
        routeTips: nearbyRouteTip(ctx) || "與雷門、仲見世通、上野可排在同一天。",
        cautions: monthNote ? `${monthNote}，戶外排隊請備薄外套。` : "參道人潮多，尖峰時段請預留排隊時間。",
      };
    },
  },
  {
    match: (n) => /仲見世/i.test(n),
    build: (_place, ctx) => {
      const recommendReason =
        "仲見世商店街連接雷門與淺草寺，適合安排在同一天散步採買伴手禮與小吃，停留時間可依人潮彈性調整。";
      return {
        intro: recommendReason,
        highlights: [],
        visitTips: [],
        recommendReason,
        suitableFor: "",
        suggestedStay: "建議停留 45～90 分鐘（彈性）",
        routeTips: nearbyRouteTip(ctx),
        cautions: "",
      };
    },
  },
  {
    match: (n) => /雷門|kaminarimon/i.test(n),
    build: (_place, ctx) => {
      const recommendReason =
        "雷門是淺草最具代表性的地標，適合與淺草寺、仲見世商店街安排在同一區塊慢慢逛。拍照與小吃都很適合順路停留。";
      return {
        intro: recommendReason,
        highlights: [],
        visitTips: [],
        recommendReason,
        suitableFor: "",
        suggestedStay: "建議停留 30～60 分鐘",
        routeTips: nearbyRouteTip(ctx) || "與淺草寺、仲見世商店街同一動線最順。",
        cautions: "",
      };
    },
  },
  {
    match: (n) => /哈利波特|harry potter|warner bros|スタジオツアー/i.test(n),
    build: (place, ctx) => {
      const name = /哈利波特|harry potter/i.test(place.placeName) ? place.placeName : "東京哈利波特影城";
      const intro = `${name}適合安排半天以上，沉浸式展區多、拍照點也多。建議提前預約時段，並預留交通與排隊時間。`;
      return {
        intro,
        highlights: ["沉浸式展區與拍照點多", "需預留半日以上"],
        visitTips: ["建議提前預約入場時段", "園內動線長，穿舒適的鞋"],
        recommendReason: intro,
        suitableFor: "哈利波特粉絲、喜歡主題體驗與拍照的人",
        suggestedStay: "建議停留 4～6 小時",
        routeTips: nearbyRouteTip(ctx) || "當天不宜再排太多市區密集行程。",
        cautions: "務必確認預約時段與交通轉乘時間。",
      };
    },
  },
  {
    match: (n) => /富士山|河口湖|五合目|忍野|fuji|kawaguchiko/i.test(n),
    build: (place, ctx) => {
      const monthNote = monthWeatherNote(ctx.travelMonth, "zh-TW");
      const intro = monthNote
        ? `富士山適合安排一日行程，${monthNote}，山區天氣變化大但能見度常不錯。建議搭配河口湖、忍野八海或觀景點，當天不要排太多市區行程。`
        : "富士山適合安排一日行程，山區天氣變化大但能見度常不錯。建議搭配河口湖、忍野八海或觀景點，當天不要排太多市區行程。";
      return {
        intro,
        highlights: ["適合一日郊區行程", "可搭配湖區或觀景點"],
        visitTips: ["建議早出發，預留交通與天候緩衝", "山區比市區冷，多帶一層"],
        recommendReason: intro,
        suitableFor: "想看山景、願意接受一日交通的人",
        suggestedStay: "建議整日或至少 6～8 小時",
        routeTips: nearbyRouteTip(ctx) || "與河口湖、忍野八海可串成一日線。",
        cautions: "天候不佳時能見度會受影響，請保留備案。",
      };
    },
  },
];

const STAY_BY_IDENTITY: Partial<Record<PlaceIdentity, string>> = {
  tourist_attraction: "建議停留 1.5～3 小時",
  museum: "建議停留 2～3 小時",
  restaurant: "建議停留 1～2 小時",
  cafe: "建議停留 45～90 分鐘",
  night_market: "建議停留 2～3 小時",
  district: "建議停留 2～4 小時（彈性）",
  park: "建議停留 1～2 小時",
  shopping_mall: "建議停留 2～4 小時",
  generic: "建議停留 1～2 小時",
};

const SUITABLE_BY_IDENTITY: Partial<Record<PlaceIdentity, string>> = {
  tourist_attraction: "想拍照、感受在地氛圍的旅人",
  museum: "喜歡室內、文化展覽的旅人",
  restaurant: "想把正餐排進行程的人",
  cafe: "想中途歇腳、放空的人",
  night_market: "喜歡晚上邊逛邊吃的人",
  district: "喜歡自由探索街區的人",
  park: "想放慢腳步、透透氣的人",
  shopping_mall: "想逛街、吹冷氣的人",
  generic: "行程中想彈性停留的人",
};

function buildIdentityIntro(
  place: PlaceIntroPlaceInput,
  identity: PlaceIdentity,
  ctx: PlaceIntroItineraryContext,
  locale: Locale,
): GeneratedPlaceIntro {
  const city = cityLabel(ctx, place);
  const typeLabel = identityDisplayLabel(identity);
  const monthNote = monthWeatherNote(ctx.travelMonth, locale);
  const ratingPart =
    place.rating != null
      ? locale === "zh-TW"
        ? `Google 評分 ${place.rating.toFixed(1)}`
        : `Rated ${place.rating.toFixed(1)}`
      : "";

  const dayPhrase =
    locale === "zh-TW"
      ? ctx.dayIndex != null
        ? `適合排進第 ${ctx.dayIndex} 天的行程`
        : "適合排進這趟行程"
      : ctx.dayIndex != null
        ? `Fits day ${ctx.dayIndex} of your trip`
        : "Fits this trip";

  const intro =
    locale === "zh-TW"
      ? `${place.placeName}是${city ? `${city}的` : ""}${typeLabel}。${ratingPart ? `${ratingPart}，` : ""}${monthNote ? `${monthNote}，` : ""}${dayPhrase}中彈性停留。`
      : `${place.placeName} is a ${typeLabel} in ${city || "the area"}. ${ratingPart ? `${ratingPart}. ` : ""}${dayPhrase}.`;

  const highlights =
    locale === "zh-TW"
      ? [`${typeLabel}體驗`, city ? `位於${city}行程動線中` : "可順路安排"]
      : [typeLabel, city ? `In ${city}` : "Easy to slot in"];

  const visitTips: string[] = [];
  if (place.openingHours?.trim()) {
    visitTips.push(
      locale === "zh-TW"
        ? `營業資訊：${place.openingHours}`
        : `Hours: ${place.openingHours}`,
    );
  }
  if (ctx.pace === "relaxed") {
    visitTips.push(locale === "zh-TW" ? "你的節奏偏慢，可多留緩衝時間" : "Allow extra buffer time");
  } else if (ctx.pace === "packed") {
    visitTips.push(locale === "zh-TW" ? "行程較滿，建議控制停留時間" : "Keep visit time tight");
  }

  return {
    intro: intro.slice(0, 320),
    highlights,
    visitTips: visitTips.length ? visitTips : [locale === "zh-TW" ? "出發前可再確認營業時間" : "Check hours before you go"],
    recommendReason: intro.slice(0, 200),
    suitableFor: SUITABLE_BY_IDENTITY[identity] ?? SUITABLE_BY_IDENTITY.generic!,
    suggestedStay: STAY_BY_IDENTITY[identity] ?? STAY_BY_IDENTITY.generic!,
    routeTips: nearbyRouteTip(ctx),
    cautions: buildWeatherCaution(locale, null),
  };
}

function buildEditorialIntro(
  place: PlaceIntroPlaceInput,
  ctx: PlaceIntroItineraryContext,
  locale: Locale,
): GeneratedPlaceIntro {
  const city = cityLabel(ctx, place);
  const summary = place.editorialSummary!.trim();
  const intro =
    locale === "zh-TW"
      ? `${place.placeName}${city ? `位於${city}，` : ""}${summary.replace(/\s+/g, " ")}`
      : `${place.placeName}: ${summary}`;
  return {
    intro: intro.slice(0, 320),
    highlights: [locale === "zh-TW" ? "Google 編輯摘要" : "Editorial summary"],
    visitTips: place.openingHours?.trim()
      ? [locale === "zh-TW" ? `今日營業：${place.openingHours}` : `Hours: ${place.openingHours}`]
      : [],
    recommendReason: intro.slice(0, 200),
    suitableFor: SUITABLE_BY_IDENTITY.tourist_attraction!,
    suggestedStay: STAY_BY_IDENTITY.tourist_attraction!,
    routeTips: nearbyRouteTip(ctx),
    cautions: buildWeatherCaution(locale, null),
  };
}

function buildMinimalIntro(
  place: PlaceIntroPlaceInput,
  ctx: PlaceIntroItineraryContext,
  locale: Locale,
): GeneratedPlaceIntro {
  const city = cityLabel(ctx, place);
  const category = place.category?.trim() || identityDisplayLabel(resolvePlaceIdentity(toPlaceResult(place)));
  const monthNote = monthWeatherNote(ctx.travelMonth, locale);
  const styleNote =
    ctx.travelStyle?.trim() ?
      locale === "zh-TW"
        ? `依你的旅遊風格（${ctx.travelStyle}）`
        : `Matches your style (${ctx.travelStyle})`
    : "";

  const intro =
    locale === "zh-TW"
      ? `${place.placeName}${city ? `是${city}的` : "是"}${category}。${monthNote ? `${monthNote}，` : ""}${styleNote ? `${styleNote}，` : ""}適合排進行程中順路造訪。`
      : `${place.placeName} in ${city || "the area"} (${category}). Fits your itinerary.`;

  return {
    intro,
    highlights: [category, city ? `${city}行程` : "順路安排"].filter(Boolean) as string[],
    visitTips: [
      locale === "zh-TW" ? "出發前建議再確認營業時間" : "Verify opening hours",
    ],
    recommendReason: intro.slice(0, 200),
    suitableFor: SUITABLE_BY_IDENTITY.generic!,
    suggestedStay: STAY_BY_IDENTITY.generic!,
    routeTips: nearbyRouteTip(ctx),
    cautions: buildWeatherCaution(locale, null),
  };
}

function buildWeatherCaution(locale: Locale, weather: WeatherSummary | null | undefined): string {
  if (!weather) {
    return locale === "zh-TW" ? "戶外行程請留意當日天氣與體感溫度。" : "Check weather for outdoor visits.";
  }
  const scene = classifyWeatherScene({
    tempC: weather.tempC,
    precipProbability: weather.precipProbability,
    condition: weather.condition,
    isDaytime: weather.isDaytime,
  });
  if (scene === "rainy") {
    return locale === "zh-TW" ? "今日可能下雨，建議備雨具與防滑鞋。" : "Rain likely — bring rain gear.";
  }
  if (scene === "hot") {
    return locale === "zh-TW" ? "天氣偏熱，建議避開正午、多補充水分。" : "Hot weather — avoid midday sun.";
  }
  if (weather.tempC != null && weather.tempC <= 12) {
    return locale === "zh-TW" ? "氣溫偏低，建議多帶一層外套。" : "Cool — bring an extra layer.";
  }
  return locale === "zh-TW" ? "出發前可再確認營業與交通狀況。" : "Confirm hours and transit before you go.";
}

function applyWeatherToIntro(
  base: GeneratedPlaceIntro,
  weather: WeatherSummary | null | undefined,
  locale: Locale,
): GeneratedPlaceIntro {
  return { ...base, cautions: buildWeatherCaution(locale, weather) };
}

export type GeneratePlaceIntroOptions = {
  locale?: Locale;
  weather?: WeatherSummary | null;
  userProfile?: UserProfileForReason | null;
  /** 若已有個人化推薦理由且非通用句，可優先併入 */
  existingReason?: string | null;
};

/**
 * 依地點本身與行程情境產生專屬簡介（不依賴 window / 外部 API）。
 */
export function generatePlaceIntro(
  place: PlaceIntroPlaceInput,
  itineraryContext: PlaceIntroItineraryContext = {},
  options: GeneratePlaceIntroOptions = {},
): GeneratedPlaceIntro {
  const locale = options.locale ?? "zh-TW";
  const placeName = place.placeName?.trim() ?? "";

  logPlaceIntroGenerateStart({
    placeName,
    city: itineraryContext.city ?? place.city,
    category: place.category ?? place.primaryType,
  });

  if (!placeName) {
    logPlaceIntroFallbackUsed({ placeName: "(empty)", reason: "missing_place_name" });
    const fallback = PLACE_INTRO_GENERIC_FALLBACK;
    return {
      intro: fallback,
      highlights: [],
      visitTips: [],
      recommendReason: fallback,
      suitableFor: "",
      suggestedStay: "",
      routeTips: "",
      cautions: "",
    };
  }

  const ctx: PlaceIntroItineraryContext = {
    ...itineraryContext,
    city: itineraryContext.city ?? place.city,
  };

  let result: GeneratedPlaceIntro | null = null;

  for (const profile of LANDMARK_PROFILES) {
    if (profile.match(placeName)) {
      result = profile.build(place, ctx);
      break;
    }
  }

  if (!result && place.editorialSummary?.trim()) {
    result = buildEditorialIntro(place, ctx, locale);
  }

  if (!result) {
    const identity = resolvePlaceIdentity(toPlaceResult(place));
    if (identity !== "generic" && identity !== "unsupported") {
      result = buildIdentityIntro(place, identity, ctx, locale);
    }
  }

  if (!result) {
    result = buildMinimalIntro(place, ctx, locale);
  }

  const existing = options.existingReason?.trim();
  if (existing && !isGenericPlaceReason(existing)) {
    result = {
      ...result,
      recommendReason: existing,
    };
  }

  if (options.userProfile?.mood?.trim() && locale === "zh-TW") {
    result.visitTips = [
      ...result.visitTips,
      `目前心情偏「${options.userProfile.mood}」，可挑符合氛圍的時段前往`,
    ].slice(0, 4);
  }

  result = applyWeatherToIntro(result, options.weather, locale);

  logPlaceIntroGenerateSuccess({
    placeName,
    introPreview: result.intro,
  });

  return result;
}

/** 將詳情頁 view model 轉為 generatePlaceIntro 輸入 */
export function placeDetailToIntroInput(
  place: PlaceResult & {
    reason?: string;
    city?: string | null;
  },
  extras?: { city?: string | null; editorialSummary?: string | null },
): PlaceIntroPlaceInput {
  return {
    placeName: place.name,
    city: extras?.city ?? null,
    category: place.primaryType ?? null,
    address: place.address,
    types: place.types,
    primaryType: place.primaryType,
    rating: place.rating,
    userRatingsTotal: place.userRatingCount,
    openingHours: place.todayHoursLabel || null,
    openStatusLabel: place.openStatusLabel || null,
    editorialSummary: extras?.editorialSummary ?? null,
  };
}
