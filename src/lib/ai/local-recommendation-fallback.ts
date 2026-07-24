import { filterNonLodgingPlaces } from "@/lib/lodging-place-filter";
import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlanningSession, ChatPlaceItem } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { lowBudgetSearchQuery, buildBudgetRefinementSummary } from "@/lib/ai/budget-refinement";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  buildCampingIntroReply,
  buildCampingRecommendationSummary,
  filterCampingPlaces,
} from "@/lib/ai/activity-camping";
import { logTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";

export type LocalFallbackInput = {
  context: CanonicalTravelContext;
  session: ChatPlanningSession;
  locale?: Locale;
  places?: PlaceResult[];
};

function moodSearchQuery(mood: string, ctx?: CanonicalTravelContext): string {
  if (ctx?.budgetPreference === "low" || ctx?.tripPurpose === "refine_recommendations") {
    return lowBudgetSearchQuery("attraction", mood).query;
  }
  if (/深夜散步/.test(mood)) return "night walk riverside park night view cafe";
  if (/找咖啡|咖啡/.test(mood)) return "cafe coffee quiet";
  if (/下雨天|雨/.test(mood)) return "indoor museum cafe bookstore";
  if (/想放空|放鬆/.test(mood)) return "park quiet cafe scenic";
  if (/看海/.test(mood)) return "coastal seaside walk scenic park cafe";
  return "tourist attraction cafe restaurant park museum";
}

function buildSummary(ctx: CanonicalTravelContext, placeCount: number, places: PlaceResult[] = []): string {
  if (ctx.budgetPreference === "low" || ctx.tripPurpose === "refine_recommendations") {
    return buildBudgetRefinementSummary(ctx, places.slice(0, placeCount));
  }

  if (ctx.activity === "camping" || ctx.interests.includes("露營")) {
    if (places.length > 0) {
      return buildCampingRecommendationSummary(places.slice(0, placeCount), ctx);
    }
    return buildCampingIntroReply(ctx);
  }

  const mood = ctx.mood;
  const dest = ctx.destination ?? ctx.currentLocation ?? "附近";
  const month = ctx.travelMonth ? `${ctx.travelMonth}的` : "";
  const companion = ctx.companion ? `跟${ctx.companion}` : "你";

  if (ctx.destination && ctx.days) {
    const weatherHint = ctx.weather
      ? `${ctx.weather.city}${ctx.weather.condition ? ` ${ctx.weather.condition}` : ""}`
      : "天氣適合慢慢走";
    return [
      `${month}${dest}很適合${companion}一起待 ${ctx.days} 天。${weatherHint}。`,
      "我先幫你抓幾個方向：",
      placeCount > 0
        ? "下面是我挑的幾個起點，選一個最有感覺的，我再幫你往下串。"
        : "你可以跟我說偏好美食、拍照或散步，我再幫你細排。",
    ].join("\n");
  }

  if (mood && /深夜散步|夜景/.test(mood)) {
    return [
      `如果今天想${mood}，我幫你找了${placeCount > 0 ? `${placeCount} 個` : "幾個"}現在還適合慢慢走的地方。`,
      "挑一個最有感覺的，我再幫你往下串。",
    ].join("\n");
  }

  if (/下雨|雨/.test(mood ?? "")) {
    return [
      "今天可能會下雨，我先幫你找幾個適合待在室內、還是有氛圍的地方。",
      placeCount > 0 ? "下面這幾個你可以先看看。" : "跟我說想咖啡、書店還是展覽，我再幫你挑。",
    ].join("\n");
  }

  if (!mood) {
    if (placeCount <= 0) {
      return `目前沒有找到合適的地點，我可以換個區域或條件再找找。`;
    }
    if (placeCount === 1) {
      return `我找到一個符合條件的地點，你可以先看看是否喜歡。`;
    }
    return [
      `我在${dest}幫你找了 ${placeCount} 個適合的地點。`,
      "你可以選一個或多個，我再幫你安排路線。",
    ].join("\n");
  }

  if (placeCount <= 0) {
    return `目前沒有找到合適的地點，我可以換個區域或條件再找找。`;
  }
  if (placeCount === 1) {
    return `依「${mood}」的心情，我找到一個符合條件的地點，你可以先看看是否喜歡。`;
  }
  return [
    `依「${mood}」的心情，我在${dest}幫你找了 ${placeCount} 個適合的地點。`,
    "你可以選一個或多個，我再幫你安排路線。",
  ].join("\n");
}

export function generateLocalRecommendationFallback(
  input: LocalFallbackInput,
): { summary: string; payload: RoamiePayloadV2; places: ChatPlaceItem[] } {
  const { context: ctx, session, locale = "zh-TW", places = [] } = input;
  logAiPipeline("[CHAT_FALLBACK_USED]", logTravelContext(ctx));

  const filteredPlaces =
    ctx.activity === "camping" || ctx.interests.includes("露營")
      ? filterCampingPlaces(places)
      : filterNonLodgingPlaces(places);

  const candidates: ChatPlaceItem[] = filteredPlaces
    .slice(0, 5)
    .map((p) =>
    mapPlaceResultToChatItem(p, {
      mood: ctx.mood,
      weather: ctx.weather,
      locale,
      currentTime: new Date(),
    }),
  );

  if (!candidates.length) {
    const dest = ctx.destination ?? ctx.currentLocation ?? "附近";
    const summary = `目前在${dest}暫時找不到符合的地點，可以換個描述或稍後再試。`;
    return {
      summary,
      payload: {
        title: "Roamie 推薦",
        summary,
        moodTag: ctx.mood ?? session.selectedMood ?? "",
        recommendations: [],
        itinerary: [],
      },
      places: [],
    };
  }

  const summary = buildSummary(ctx, candidates.length, places);
  const moodTag = ctx.mood ?? session.selectedMood ?? "";

  const payload: RoamiePayloadV2 = {
    title: moodTag ? `${moodTag} 推薦` : "Roamie 推薦",
    summary,
    moodTag,
    recommendations: candidates,
    itinerary: [],
  };

  logAiPipeline("[AI_RECOMMENDATION] generated", `count=${candidates.length}`, logTravelContext(ctx));

  return { summary, payload, places: candidates };
}

export function fallbackSearchQuery(ctx: CanonicalTravelContext): string {
  if (ctx.activity === "camping" || ctx.interests.includes("露營")) {
    return "露營區 campground campsite glamping 豪華露營";
  }
  const mood = ctx.mood ?? "";
  if (mood) return moodSearchQuery(mood, ctx);
  if (ctx.interests.includes("咖啡")) return "cafe coffee";
  if (ctx.interests.includes("美食")) return "restaurant local food";
  return "tourist attraction cafe restaurant park";
}
