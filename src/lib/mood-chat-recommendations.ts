import type { RoamieRecommendationItem } from "@/lib/ai/types";
import {
  buildMoodRecommendationSummary,
} from "@/lib/ai/local-recommendation-fallback";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatPlanningSession } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { Locale } from "@/lib/i18n/types";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import {
  attachMoodRankingToRecommendation,
  countValidMoodRecommendations,
  type MoodPipelineMeta,
  resolveMoodRecommendationIntent,
} from "@/lib/recommendation/mood-place-pipeline";
import { searchPlacesWithMoodFallback } from "@/lib/places-mood-search";

/** 心情／聊聊推薦是否應以 Google Places 為準（不用 AI 幻覺地點） */
export function isMoodGroundedChatSession(session: ChatPlanningSession): boolean {
  return (
    session.chatEntry === "home_mood" ||
    session.fromMoodCard === true ||
    Boolean(session.selectedMood?.trim() || session.mood?.trim())
  );
}

/** 依使用者最新一句話調整 Places 搜尋 mood */
export function resolveMoodForPlacesSearch(
  session: ChatPlanningSession,
  userText?: string,
): string {
  const text = userText?.trim() ?? "";
  if (/宵夜|消夜|小吃|夜市|深夜食堂|late.?night.?food/i.test(text)) return "宵夜";
  if (/咖啡|caf[eé]/i.test(text)) return "找咖啡";
  if (/散步|走走|河堤|夜景/i.test(text)) return "想散步";
  if (/下雨|室內/i.test(text)) return "下雨天";
  if (/海|海岸|看海/i.test(text)) return "看海";
  if (/累|休息|按摩|spa/i.test(text)) return "今天有點累";
  return session.selectedMood?.trim() || session.mood?.trim() || text || "附近";
}

export function aiRecommendationsLookGrounded(recs: RoamieRecommendationItem[]): boolean {
  if (recs.length < 2) return false;
  const withId = recs.filter((r) => r.googlePlaceId?.trim());
  return withId.length >= 2;
}

export function summaryCardCountMismatch(summary: string, cardCount: number): boolean {
  if (cardCount >= 2) return false;
  if (/這幾個|這些|以下|幫你找[了到]?[2-9]|找了[2-9]/.test(summary)) return true;
  if (/幾個|數個|多個/.test(summary) && cardCount < 2) return true;
  return false;
}

export type MoodGroundedResult = {
  summary: string;
  recommendations: RoamieRecommendationItem[];
  placesQuery: string;
  source: "google_places";
  intent: ReturnType<typeof resolveMoodRecommendationIntent>;
  pipelineMeta: MoodPipelineMeta | null;
};

/**
 * 心情聊聊推薦 pipeline：
 * mood → intent → tags → Google Places → validate/rank → cards + aligned summary
 */
export async function resolveMoodGroundedRecommendations(opts: {
  session: ChatPlanningSession;
  context: CanonicalTravelContext;
  locale: Locale;
  searchNearbyPlaces: SearchPlacesFn;
  lat: number;
  lng: number;
  userText?: string;
}): Promise<MoodGroundedResult> {
  const mood = resolveMoodForPlacesSearch(opts.session, opts.userText);
  const ctx = { ...opts.context, mood };

  const moodSearch = await searchPlacesWithMoodFallback(opts.searchNearbyPlaces, {
    mood,
    lat: opts.lat,
    lng: opts.lng,
    minCount: 3,
    maxCount: 6,
    userText: opts.userText,
    weather: ctx.weather ?? opts.session.weather,
  });

  const recommendations = moodSearch.ranked.map(({ place: p, validation }) => {
    const item = mapPlaceResultToChatItem(p, {
      mood,
      weather: ctx.weather,
      locale: opts.locale,
      currentTime: new Date(),
    });
    return {
      ...attachMoodRankingToRecommendation(item, { place: p, validation }),
      recommendationSource: "mood_pipeline",
      nearbyPlacesSource: "places_text_search",
      aiFallbackSource: "mood_place_pipeline",
      fallbackReason: moodSearch.fallbackReason ?? undefined,
      googlePlaceId: p.id,
    } as RoamieRecommendationItem;
  });

  const summary = buildMoodRecommendationSummary(
    ctx,
    recommendations.length,
    moodSearch.intent.summaryTone,
  );

  console.info("[MOOD_GROUNDED_RECS]", {
    mood,
    intent: moodSearch.intent.detectedIntent,
    tags: moodSearch.intent.selectedTags,
    count: recommendations.length,
    names: recommendations.map((r) => r.placeName ?? r.name),
  });

  return {
    summary,
    recommendations,
    placesQuery: mood,
    source: "google_places",
    intent: moodSearch.intent,
    pipelineMeta: moodSearch.pipelineMeta,
  };
}

export function shouldReplaceAiWithMoodGrounded(opts: {
  session: ChatPlanningSession;
  aiSummary: string;
  aiRecs: RoamieRecommendationItem[];
  userText?: string;
}): boolean {
  if (!isMoodGroundedChatSession(opts.session)) return false;
  const mood = resolveMoodForPlacesSearch(opts.session, opts.userText);
  const { validCount } = countValidMoodRecommendations(opts.aiRecs, mood, {
    userText: opts.userText,
    weather: opts.session.weather,
  });
  if (validCount < 2) return true;
  if (!aiRecommendationsLookGrounded(opts.aiRecs)) return true;
  if (summaryCardCountMismatch(opts.aiSummary, opts.aiRecs.length)) return true;
  if (/室內|下雨|咖啡|休息|累/.test(opts.aiSummary) && validCount < opts.aiRecs.length) return true;
  return false;
}
