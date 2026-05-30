import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlanningSession, ChatPlaceItem } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logTravelContext } from "@/lib/ai/travel-context";
import { normalizeDestination } from "@/lib/ai/normalize-destination";
import { buildPlaceSearchQuery } from "@/lib/ai/place-search-query";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { filterVerifiedPlaceResults } from "@/lib/place-verification";
import { dedupePlaceResults } from "@/lib/recommendation-dedupe";
import type { MoodRecommendationIntent } from "@/lib/recommendation/mood-place-pipeline";
import { resolveMoodSearchQueries } from "@/lib/places-mood-search";

export type LocalFallbackInput = {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  locale?: Locale;
  places?: PlaceResult[];
  summaryTone?: MoodRecommendationIntent["summaryTone"];
};

function moodSearchQuery(mood: string): string {
  return resolveMoodSearchQueries(mood)[0] ?? `${mood} nearby places`;
}

function countLabel(placeCount: number): string {
  return placeCount === 1 ? "1 個" : `${placeCount} 個`;
}

/** 依 mood tone 產生與卡片數量一致的摘要 */
export function buildMoodRecommendationSummary(
  ctx: CanonicalTravelContext,
  placeCount: number,
  tone?: MoodRecommendationIntent["summaryTone"],
): string {
  const mood = ctx.mood ?? "今天";
  const dest =
    normalizeDestination(ctx.destination) ?? ctx.currentLocation ?? "附近";
  const resolvedTone =
    tone ??
    (/下雨|雨/.test(mood)
      ? "rainy_indoor"
      : /咖啡/.test(mood)
        ? "coffee"
        : /累/.test(mood)
          ? "tired_rest"
          : /一個人/.test(mood)
            ? "solo_quiet"
            : /深夜/.test(mood)
              ? "late_night"
              : /宵夜|消夜/.test(mood)
                ? "supper"
                : /海/.test(mood)
                  ? "sea"
                  : /放空/.test(mood)
                    ? "relax_scenic"
                    : "generic");

  if (placeCount === 0) {
    return [
      `我剛剛在${dest}附近找了一輪，暫時沒有合適的地點可以推薦。`,
      "你可以換個關鍵字，或到探索地圖看看附近還有什麼。",
    ].join("\n");
  }

  const n = countLabel(placeCount);
  const tail =
    placeCount === 1 ? "先看看這個選項，有興趣我再幫你往下串。" : "下面這幾個你可以先看看。";

  switch (resolvedTone) {
    case "rainy_indoor":
      return [
        `今天可能會下雨，我幫你找了${n}適合待在室內、還有氛圍的地方。`,
        tail,
      ].join("\n");
    case "coffee":
      return [`我幫你找了${n}附近適合喝咖啡、坐坐的地方。`, tail].join("\n");
    case "solo_quiet":
      return [`一個人也可以很自在，我挑了${n}適合獨處的角落。`, tail].join("\n");
    case "tired_rest":
      return [`今天有點累的話，這${n}地方比較好休息、補充能量。`, tail].join("\n");
    case "relax_scenic":
      return [`想放空的話，我找了${n}可以慢下來的角落。`, tail].join("\n");
    case "walk":
      return [`我幫你找了${n}適合走走看看的路線或空間。`, tail].join("\n");
    case "late_night":
      return [`如果今天想${mood}，我幫你找了${n}現在還適合慢慢走的地方。`, tail].join("\n");
    case "supper":
      return [`深夜如果餓了，我幫你找了${n}附近還適合吃點東西的地方。`, tail].join("\n");
    case "sea":
      return [`想看海吹風的話，這${n}地方離你不算遠。`, tail].join("\n");
    default:
      return [
        `我在${dest}幫你找了 ${n}真實地點，你可以先挑一個最有感覺的。`,
        tail,
      ].join("\n");
  }
}

export function generateLocalRecommendationFallback(input: LocalFallbackInput): {
  summary: string;
  payload: RoamiePayloadV2;
  places: ChatPlaceItem[];
} {
  const { context: ctx, session, locale = "zh-TW", places = [] } = input;
  console.info("[AI_FALLBACK] used", logTravelContext(ctx));

  const verified = filterVerifiedPlaceResults(places);
  const { places: uniquePlaces, meta: dedupeMeta } = dedupePlaceResults(verified, {
    maxCount: 4,
  });
  const candidates: ChatPlaceItem[] = uniquePlaces
    .map((p) => {
      const item = mapPlaceResultToChatItem(p, {
        mood: ctx.mood,
        weather: ctx.weather,
        locale,
        currentTime: new Date(),
      });
      return {
        ...item,
        recommendationSource: "mood_pipeline",
        nearbyPlacesSource: "places_text_search",
        aiFallbackSource: "local_recommendation_fallback",
        fallbackReason: "ai_or_network_fallback",
        googlePlaceId: p.id,
      };
    });

  console.info("[REC_DEDUPE] local_fallback", dedupeMeta);

  const summary = buildMoodRecommendationSummary(ctx, candidates.length, input.summaryTone);
  const moodTag = ctx.mood ?? session.selectedMood ?? "";

  const payload: RoamiePayloadV2 = {
    title: moodTag ? `${moodTag} 推薦` : "Roamie 推薦",
    summary,
    moodTag,
    recommendations: candidates as RoamieRecommendationItem[],
    itinerary: [],
  };

  console.info(
    "[AI_RECOMMENDATION] generated",
    `count=${candidates.length}`,
    logTravelContext(ctx),
  );

  return { summary, payload, places: candidates };
}

export function fallbackSearchQuery(ctx: CanonicalTravelContext): string {
  return buildPlaceSearchQuery({
    destination: ctx.destination,
    mood: ctx.mood,
    interests: ctx.interests,
  });
}
