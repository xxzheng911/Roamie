import type { RoamiePayloadV2, RoamieRecommendationItem } from "@/lib/ai/types";
import type { ChatPlanningSession, ChatPlaceItem } from "@/lib/chat-session";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import { logTravelContext } from "@/lib/ai/travel-context";
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";

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

  if (/深夜散步|夜景/.test(mood)) {
    return [
      `如果今天想${mood}，我幫你找了${placeCount > 0 ? `${placeCount} 個` : "幾個"}現在還適合慢慢走的地方。`,
      "挑一個最有感覺的，我再幫你往下串。",
    ].join("\n");
  }

  if (/下雨|雨/.test(mood)) {
    return [
      "今天可能會下雨，我先幫你找幾個適合待在室內、還是有氛圍的地方。",
      placeCount > 0 ? "下面這幾個你可以先看看。" : "跟我說想咖啡、書店還是展覽，我再幫你挑。",
    ].join("\n");
  }

  return [
    `依「${mood}」的心情，我在${dest}幫你找了${placeCount > 0 ? `${placeCount} 個` : "幾個"}適合的地點。`,
    "選一個後我可以幫你安排路線。",
  ].join("\n");
}

function staticFallbackPlaces(ctx: CanonicalTravelContext): RoamieRecommendationItem[] {
  const dest = ctx.destination ?? "附近";
  if (/釜山|Busan/i.test(dest)) {
    return [
      {
        name: "廣安里海邊",
        type: "海邊散步",
        address: "釜山廣安里",
        reason: "11 月海風涼爽，適合情侶慢步看海。",
        lat: 35.1532,
        lng: 129.1186,
      },
      {
        name: "The Bay 101",
        type: "夜景",
        address: "釜山海雲台",
        reason: "夜景氛圍好，適合晚餐後散步。",
        lat: 35.1631,
        lng: 129.1638,
      },
      {
        name: "海東龍宮寺",
        type: "景點",
        address: "釜山機張郡",
        reason: "情侶拍照熱點，海景與建築都很上鏡。",
        lat: 35.1885,
        lng: 129.2234,
      },
    ];
  }

  return [
    {
      name: `${dest} 附近散步點`,
      type: "散步",
      address: dest,
      reason: `適合「${ctx.mood ?? "放鬆"}」的節奏，可以先從這裡開始。`,
    },
    {
      name: `${dest} 安靜咖啡`,
      type: "咖啡廳",
      address: dest,
      reason: "適合坐下來發呆、整理思緒。",
    },
  ];
}

export function generateLocalRecommendationFallback(
  input: LocalFallbackInput,
): { summary: string; payload: RoamiePayloadV2; places: ChatPlaceItem[] } {
  const { context: ctx, session, locale = "zh-TW", places = [] } = input;
  console.info("[AI_FALLBACK] used", logTravelContext(ctx));

  const candidates: ChatPlaceItem[] =
    places.length > 0
      ? places.slice(0, 4).map((p) =>
          mapPlaceResultToChatItem(p, {
            mood: ctx.mood,
            weather: ctx.weather,
            locale,
            currentTime: new Date(),
          }),
        )
      : staticFallbackPlaces(ctx).map((r) => ({
          ...r,
          placeName: r.name,
          reasonSource: "template" as const,
        }));

  const summary = buildSummary(ctx, candidates.length);
  const moodTag = ctx.mood ?? session.selectedMood ?? "";

  const payload: RoamiePayloadV2 = {
    title: moodTag ? `${moodTag} 推薦` : "Roamie 推薦",
    summary,
    moodTag,
    recommendations: candidates,
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
