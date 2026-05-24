import type { RoamieRequestContext } from "@/lib/ai/context";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import { fetchFestivalContext, formatFestivalBlock } from "@/lib/recommendation/festival-context";
import {
  candidatesToAiList,
  fetchVerifiedCandidates,
} from "@/lib/recommendation/fetch-candidates.server";
import {
  formatTripIntentForAi,
  parseTripIntentFromRoamieContext,
  type TripIntent,
} from "@/lib/recommendation/trip-intent";
import type { RecommendationContext, VerifiedPlaceCandidate } from "@/lib/recommendation/types";

export type PlacesFirstPrepResult = {
  ctx: RoamieRequestContext;
  candidates: VerifiedPlaceCandidate[];
  candidateBlock: string;
  festivalBlock: string;
};

/**
 * Places-first 管線前置：
 * Google Places 候選 → 天氣（已在 ctx）→ 節慶 fallback → 注入 AI context
 */
export async function preparePlacesFirstContext(
  ctx: RoamieRequestContext,
): Promise<PlacesFirstPrepResult> {
  const locale = coerceLocale(ctx.locale);
  const lat = ctx.location?.lat;
  const lng = ctx.location?.lng;

  if (lat == null || lng == null) {
    return {
      ctx,
      candidates: [],
      candidateBlock: "（無定位，無法取得 Google Places 候選）",
      festivalBlock: formatFestivalBlock(null),
    };
  }

  const tripIntent: TripIntent = parseTripIntentFromRoamieContext(ctx);

  const tripIntentBlock = formatTripIntentForAi(tripIntent, ctx.preferences);

  const recCtx: RecommendationContext = {
    locale,
    location: {
      lat,
      lng,
      city: ctx.location?.city,
      displayLabel: ctx.location?.displayLabel,
    },
    weather: ctx.weather ?? null,
    time: ctx.time ?? new Date().toISOString(),
    mood: tripIntent.mood ?? ctx.mood ?? ctx.selectedMood,
    preferences: ctx.preferences,
    savedPlaceNames: ctx.savedPlaceNames,
    recentRecommendationNames: ctx.recentRecommendationNames,
    rejectedPlaceNames: [
      ...(ctx.rejectedPlaceNames ?? []),
      ...tripIntent.rejectedPlaces,
    ],
    selectedPlaceNames: ctx.selectedPlaceNames,
    constraints: tripIntent.constraints,
  };

  const [candidates, festival] = await Promise.all([
    fetchVerifiedCandidates(recCtx).catch((e) => {
      console.error("[Roamie Rec] fetch candidates failed", e);
      return [] as VerifiedPlaceCandidate[];
    }),
    fetchFestivalContext({
      lat,
      lng,
      city: ctx.location?.city,
      locale,
      date: ctx.time?.slice(0, 10),
    }),
  ]);

  recCtx.festival = festival;

  const candidateBlock =
    candidates.length > 0
      ? `【Google Places 候選 — 只能從以下地點挑選，禁止 invent 新地點】\n${candidatesToAiList(candidates)}`
      : "（Google Places 未取得候選；recommendations 必須為空陣列，summary 說明暫時無法推薦並建議稍後重試或手動搜尋）";

  const festivalBlock = formatFestivalBlock(festival);

  const recommendedPlaces = candidates.map(({ sourcePlace: _s, categoryId: _c, ...item }) => item);

  return {
    ctx: {
      ...ctx,
      locale,
      recommendedPlaces,
      planningHints: {
        ...ctx.planningHints,
        initialChatContext: [
          ctx.initialChatContext,
          ctx.planningHints?.initialChatContext,
          tripIntentBlock,
          candidateBlock,
          `【節慶／活動】${festivalBlock}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    },
    candidates,
    candidateBlock,
    festivalBlock,
  };
}
