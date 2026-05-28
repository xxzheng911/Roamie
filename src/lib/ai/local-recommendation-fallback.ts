import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlanningSession, ChatPlaceItem } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import { filterVerifiedPlaceResults } from "@/lib/place-verification";

export type LocalFallbackInput = {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  locale?: Locale;
  places?: PlaceResult[];
};

function moodSearchQuery(mood: string): string {
  if (/深夜散步/.test(mood)) return "night walk riverside park night view cafe";
  if (/找咖啡|咖啡/.test(mood)) return "cafe coffee quiet";
  if (/下雨天|雨/.test(mood)) return "indoor museum cafe bookstore";
  if (/想放空|放鬆/.test(mood)) return "park quiet cafe scenic";
  if (/看海/.test(mood)) return "coastal seaside walk";
  return `${mood} nearby places`;
}

function buildSummary(ctx: CanonicalTravelContext, placeCount: number): string {
  const mood = ctx.mood ?? "今天";
  const dest = ctx.destination ?? ctx.currentLocation ?? "附近";

  if (placeCount === 0) {
    return [
      `我剛剛在${dest}附近找了一輪，暫時沒有合適的營業中地點可以推薦。`,
      "你可以換個關鍵字，或到探索地圖看看附近還有什麼。",
    ].join("\n");
  }

  if (/深夜散步|夜景/.test(mood)) {
    return [
      `如果今天想${mood}，我幫你找了${placeCount} 個現在還適合慢慢走的地方。`,
      "挑一個最有感覺的，我再幫你往下串。",
    ].join("\n");
  }

  if (/下雨|雨/.test(mood)) {
    return [
      "今天可能會下雨，我先幫你找幾個適合待在室內、還是有氛圍的地方。",
      "下面這幾個你可以先看看。",
    ].join("\n");
  }

  return [
    `感覺今天比較適合慢慢走呢。`,
    `我在${dest}幫你找了 ${placeCount} 個真實地點，你可以先挑一個最有感覺的 ☕️`,
  ].join("\n");
}

export function generateLocalRecommendationFallback(
  input: LocalFallbackInput,
): { summary: string; payload: RoamiePayloadV2; places: ChatPlaceItem[] } {
  const { context: ctx, session, locale = "zh-TW", places = [] } = input;
  console.info("[AI_FALLBACK] used", logTravelContext(ctx));

  const verified = filterVerifiedPlaceResults(places);
  const candidates: ChatPlaceItem[] = verified.slice(0, 4).map((p) =>
    mapPlaceResultToChatItem(p, {
      mood: ctx.mood,
      weather: ctx.weather,
      locale,
      currentTime: new Date(),
    }),
  );

  const summary = buildSummary(ctx, candidates.length);
  const moodTag = ctx.mood ?? session.selectedMood ?? "";

  const payload: RoamiePayloadV2 = {
    title: moodTag ? `${moodTag} 推薦` : "Roamie 推薦",
    summary,
    moodTag,
    recommendations: candidates as RoamieRecommendationItem[],
    itinerary: [],
  };

  console.info("[AI_RECOMMENDATION] generated", `count=${candidates.length}`, logTravelContext(ctx));

  return { summary, payload, places: candidates };
}

export function fallbackSearchQuery(ctx: CanonicalTravelContext): string {
  const mood = ctx.mood ?? "";
  if (mood) return moodSearchQuery(mood);
  if (ctx.interests.includes("咖啡")) return "cafe coffee";
  if (ctx.interests.includes("美食")) return "restaurant local food";
  return "nearby places";
}
