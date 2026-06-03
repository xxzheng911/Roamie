import type { Locale } from "@/lib/i18n/types";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import type { PlaceDetailViewModel } from "@/lib/place-detail-resolve";
import type { WeatherSummary } from "@/lib/weather-types";
import {
  generatePlaceIntro,
  placeDetailToIntroInput,
  type GeneratedPlaceIntro,
  type PlaceIntroItineraryContext,
} from "@/lib/place/generate-place-intro";
import {
  isGenericPlaceReason,
  PLACE_INTRO_GENERIC_FALLBACK,
} from "@/lib/place/place-intro-constants";

export type PlaceDetailReasonSource = "ai_generated" | "google_places" | "fallback" | "handoff";

export function logPlaceDetailReasonSource(meta: {
  placeName: string;
  source: PlaceDetailReasonSource;
  content: string;
}): void {
  console.info("[PLACE_DETAIL_REASON_SOURCE]", {
    placeName: meta.placeName,
    source: meta.source,
    content: meta.content.slice(0, 120),
  });
}

export function logPlaceDetailReasonRendered(meta: {
  placeName: string;
  reasonPreview: string;
}): void {
  console.info("[PLACE_DETAIL_REASON_RENDERED]", {
    placeName: meta.placeName,
    reasonPreview: meta.reasonPreview.slice(0, 120),
  });
}

export type EnrichPlaceDetailAiOptions = {
  locale?: Locale;
  weather?: WeatherSummary | null;
  userProfile?: UserProfileForReason | null;
  itineraryContext?: PlaceIntroItineraryContext | null;
  editorialSummary?: string | null;
  city?: string | null;
};

function resolveReasonSource(
  generated: GeneratedPlaceIntro,
  editorialSummary: string | null | undefined,
  handoffReason: string | undefined,
): PlaceDetailReasonSource {
  if (editorialSummary?.trim()) return "google_places";
  if (
    handoffReason?.trim() &&
    !isGenericPlaceReason(handoffReason) &&
    generated.recommendReason === handoffReason.trim()
  ) {
    return "handoff";
  }
  if (
    generated.intro === PLACE_INTRO_GENERIC_FALLBACK ||
    generated.recommendReason === PLACE_INTRO_GENERIC_FALLBACK
  ) {
    return "fallback";
  }
  return "ai_generated";
}

/** 將 generatePlaceIntro 結果寫入地點詳情 view model（單一資料來源） */
export function enrichPlaceDetailWithAiContent(
  place: PlaceDetailViewModel,
  options: EnrichPlaceDetailAiOptions = {},
): PlaceDetailViewModel {
  const locale = options.locale ?? "zh-TW";
  const itineraryContext = options.itineraryContext ?? {};
  const city =
    options.city ??
    itineraryContext.city ??
    itineraryContext.destination ??
    null;

  const input = placeDetailToIntroInput(place, {
    city,
    editorialSummary: options.editorialSummary ?? null,
  });

  const handoffReason = isGenericPlaceReason(place.reason) ? undefined : place.reason;
  const generated = generatePlaceIntro(input, itineraryContext, {
    locale,
    weather: options.weather,
    userProfile: options.userProfile,
    existingReason: handoffReason,
  });

  const recommendationReason =
    generated.recommendReason?.trim() || generated.intro?.trim() || "";
  const source = resolveReasonSource(generated, options.editorialSummary, handoffReason);

  logPlaceDetailReasonSource({
    placeName: place.name,
    source,
    content: recommendationReason,
  });

  logPlaceDetailReasonRendered({
    placeName: place.name,
    reasonPreview: recommendationReason,
  });

  return {
    ...place,
    recommendationReason,
    reason: recommendationReason,
    suggestedStay: generated.suggestedStay,
    reasonSource: source,
    introLoading: false,
    aiIntro: undefined,
    intro: undefined,
    highlights: undefined,
    visitTips: undefined,
    suitableFor: undefined,
    routeTips: undefined,
    cautions: undefined,
    weatherFit: undefined,
    goNowAdvice: undefined,
  };
}

/** UI 顯示用：推薦理由優先 ai_generated 欄位 */
export function resolvePlaceDetailRecommendationText(place: {
  recommendationReason?: string;
  aiIntro?: string;
  reason?: string;
  intro?: string;
  introLoading?: boolean;
}): string {
  if (place.introLoading) return "";
  for (const candidate of [
    place.recommendationReason,
    place.reason,
    place.aiIntro,
    place.intro,
  ]) {
    const t = candidate?.trim();
    if (t && !isGenericPlaceReason(t)) return t;
  }
  return "";
}

/** @deprecated 請改用 generatePlaceIntro；保留相容名稱 */
export function generateRecommendationReason(
  place: Parameters<typeof placeDetailToIntroInput>[0],
  itineraryContext: PlaceIntroItineraryContext = {},
  options: EnrichPlaceDetailAiOptions = {},
): string {
  const generated = generatePlaceIntro(place, itineraryContext, {
    locale: options.locale,
    weather: options.weather,
    userProfile: options.userProfile,
    existingReason: undefined,
  });
  return generated.recommendReason || generated.intro;
}
