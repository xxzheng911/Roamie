import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  coerceTravelDestination,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import {
  formatTripInterestMix,
  type TripInterest,
} from "@/lib/ai/trip-preference";

export type ConversationState =
  | "discover"
  | "awaiting_days"
  | "awaiting_preference"
  | "preference_selected"
  | "ready_for_itinerary"
  | "itinerary_draft";

export type ItineraryPlanMode = "full_itinerary" | "daily_recommendations";

type DayPlan = {
  title: string;
  items: string[];
};

function formatDayPlans(plans: DayPlan[]): string {
  return plans
    .map((plan) => [`${plan.title}`, ...plan.items.map((item) => `- ${item}`)].join("\n"))
    .join("\n\n");
}

export function planModeHumanLabel(mode: ItineraryPlanMode, days?: number): string {
  if (mode === "full_itinerary") {
    return days ? `完整 ${days} 天行程` : "完整行程";
  }
  return "每天值得去的地點";
}

export function parseEmbeddedAbPlanMode(text: string): ItineraryPlanMode | null {
  const t = text.trim();
  if (!t) return null;
  const choice = t.match(/(?:我(?:們|们)?)?(?:选|選|选择|選擇)\s*([AaBb])(?:\s*[项項])?/);
  if (choice?.[1]) {
    return choice[1].toLowerCase() === "a" ? "full_itinerary" : "daily_recommendations";
  }
  const letter = t.match(/(?:^|\s)([AaBb])(?:\s*[\.、)]|$)/);
  if (letter?.[1]) {
    return letter[1].toLowerCase() === "a" ? "full_itinerary" : "daily_recommendations";
  }
  return null;
}

export function parseItineraryPlanModeIntent(text: string): ItineraryPlanMode | null {
  const t = text.trim();
  if (!t) return null;
  const embedded = parseEmbeddedAbPlanMode(t);
  if (embedded) return embedded;
  if (/^b$/i.test(t)) return "daily_recommendations";
  if (/^a$/i.test(t)) return "full_itinerary";
  if (
    /(先列必去點|必去點|每天值得去|先推薦地點|列景點|先推薦每一天|每一天值得去|逐日推薦)/.test(
      t,
    )
  ) {
    return "daily_recommendations";
  }
  if (
    /(幫我排完整|你幫我排|排完整\s*\d*\s*天|完整\s*\d+\s*天|直接排|直接安排|完整行程|直接幫你排|排完整行程|排完整5天|排完整五天|生成行程|幫我安排|帮我安排|幫我規劃|帮我规划|幫我生成|帮我生成|幫我建立|帮我建立|直接生成|生成.{0,6}天.{0,6}行程|排行程|安排.{0,8}行程)/.test(
      t,
    )
  ) {
    return "full_itinerary";
  }
  if (/(都不錯|都可以|就這些).{0,20}(幫我生成|生成|排成|建立)/.test(t) && (/\d+\s*天/.test(t) || /行程/.test(t))) {
    return "full_itinerary";
  }
  return null;
}

const BANGKOK_FULL_ITINERARY_5: DayPlan[] = [
  {
    title: "Day 1：市區寺廟與河岸",
    items: ["大皇宮＋玉佛寺", "臥佛寺", "鄭王廟", "ICONSIAM"],
  },
  {
    title: "Day 2：購物與市區散策",
    items: ["Siam 商圈", "CentralWorld", "Big C", "喬德夜市"],
  },
  {
    title: "Day 3：市集與近郊",
    items: ["美功鐵道市場", "丹嫩莎朵水上市場", "晚上回曼谷按摩或夜市"],
  },
  {
    title: "Day 4：文青咖啡與慢步調",
    items: ["Ari 區咖啡", "恰圖恰市集", "暹羅或河岸晚餐"],
  },
  {
    title: "Day 5：補買伴手禮與輕鬆收尾",
    items: ["Terminal 21", "按摩", "機場前簡單用餐"],
  },
];

const BUSAN_FULL_ITINERARY_5: DayPlan[] = [
  {
    title: "Day 1：海雲台與東部海岸",
    items: ["海雲台海水浴場", "海雲台藍線公園", "尾浦", "廣安里夜景"],
  },
  {
    title: "Day 2：市場與文化巷弄",
    items: ["札嘎其市場", "國際市場", "BIFF 廣場", "南浦洞步行街"],
  },
  {
    title: "Day 3：甘川與松島",
    items: ["甘川文化村", "松島天空步道", "松島海水浴場", "海鮮晚餐"],
  },
  {
    title: "Day 4：文青街區與咖啡",
    items: ["田浦洞咖啡街", "西面商圈", "釜山塔", "富平夜市"],
  },
  {
    title: "Day 5：近郊或輕鬆收尾",
    items: ["機張海岸散步", "樂天世界釜山", "機場前簡單用餐"],
  },
];

function buildBusanFullItineraryDraft(days: number): DayPlan[] {
  if (days === 5) return BUSAN_FULL_ITINERARY_5;
  return buildGenericFullItineraryDraft("釜山", days, []);
}

function buildBusanDailyRecommendations(days: number): string[] {
  return buildBusanFullItineraryDraft(days).map(
    (plan) => `${plan.title}：${plan.items.slice(0, 3).join("、")}`,
  );
}

function buildBangkokFullItineraryDraft(days: number, interests: TripInterest[]): DayPlan[] {
  if (days === 5 && interests.length === 0) return BANGKOK_FULL_ITINERARY_5;
  if (days === 5) return BANGKOK_FULL_ITINERARY_5;

  const compact = buildBangkokDayPlans(days, interests).map((plan, index) => ({
    title: `Day ${index + 1}`,
    items: plan.items,
  }));
  return compact;
}

function buildBangkokDailyRecommendations(days: number, interests: TripInterest[]): string[] {
  const plans = buildBangkokFullItineraryDraft(days, interests);
  return plans.map((plan) => `${plan.title}：${plan.items.slice(0, 3).join("、")}`);
}

function buildGenericFullItineraryDraft(
  destination: string,
  days: number,
  interests: TripInterest[],
): DayPlan[] {
  const mix = formatTripInterestMix(interests);
  const front = Math.max(1, Math.floor(days / 3));
  const middle = Math.max(1, Math.floor(days / 3));
  const tail = Math.max(1, days - front - middle);
  const plans: DayPlan[] = [];
  let day = 1;

  for (let i = 0; i < front; i += 1, day += 1) {
    plans.push({
      title: `Day ${day}：${destination}經典區`,
      items: [`${destination}地標`, `${mix}重點`, "市區散策"],
    });
  }
  for (let i = 0; i < middle; i += 1, day += 1) {
    plans.push({
      title: `Day ${day}：美食與市集`,
      items: ["在地小吃", "市集或商圈", "夜景或按摩"],
    });
  }
  for (let i = 0; i < tail; i += 1, day += 1) {
    plans.push({
      title: `Day ${day}：近郊或彈性`,
      items: ["近郊一日遊", "自由安排", "輕鬆收尾"],
    });
  }
  return plans.slice(0, days);
}

export function itineraryGenerationStatusReply(ctx: CanonicalTravelContext): string | null {
  const destination = ctx.destination?.trim();
  const days = ctx.days;
  if (!destination || !days) return null;
  const label = normalizeDestinationLabel(destination);
  return `好，我來幫你找${label}的實際景點，並排成 ${days} 天行程，稍等我一下。`;
}

/** @deprecated 僅供離線 fallback；實機流程應走 triggerItineraryGeneration */
export function buildFullItineraryDraftReply(
  ctx: CanonicalTravelContext,
  interests: TripInterest[] = (ctx.selectedInterests as TripInterest[] | undefined) ?? [],
): string | null {
  const destination = ctx.destination?.trim();
  const days = ctx.days;
  if (!destination || !days) return null;

  const label = normalizeDestinationLabel(destination);
  const plans =
    label === "曼谷" || label.includes("曼谷")
      ? buildBangkokFullItineraryDraft(days, interests)
      : label === "釜山"
        ? buildBusanFullItineraryDraft(days)
        : buildGenericFullItineraryDraft(label, days, interests);

  return [
    `好，我先幫你抓一版${label} ${days} 天節奏：`,
    "",
    formatDayPlans(plans),
    "",
    "你想要我接著幫你把這版變成每天早中晚順序嗎？",
  ].join("\n");
}

export function buildDailyRecommendationsReply(
  ctx: CanonicalTravelContext,
  interests: TripInterest[] = (ctx.selectedInterests as TripInterest[] | undefined) ?? [],
): string | null {
  const destination = ctx.destination?.trim();
  const days = ctx.days;
  if (!destination || !days) return null;

  const label = normalizeDestinationLabel(destination);
  const lines =
    label === "曼谷" || label.includes("曼谷")
      ? buildBangkokDailyRecommendations(days, interests)
      : label === "釜山"
        ? buildBusanDailyRecommendations(days)
        : buildGenericFullItineraryDraft(label, days, interests).map(
            (plan) => `${plan.title}：${plan.items.join("、")}`,
          );

  return [
    `好，我先幫你列出${label} ${days} 天每天值得去的方向：`,
    "",
    ...lines.map((line, index) => `${index + 1}. ${line}`),
    "",
    "你想先從哪一天開始細排，還是直接幫你排成完整行程？",
  ].join("\n");
}

function buildBangkokDayPlans(
  days: number,
  interests: TripInterest[],
): Array<{ label: string; items: string[] }> {
  const hasAttractions = interests.includes("attractions") || interests.includes("culture");
  const hasShopping = interests.includes("shopping");
  const hasFood = interests.includes("food");
  const hasNightMarket = interests.includes("night_market");

  const plans: Array<{ label: string; items: string[] }> = [];

  if (hasAttractions) {
    plans.push({
      label: "Day1",
      items: ["大皇宮", "玉佛寺", "鄭王廟"],
    });
  }

  if (hasShopping) {
    plans.push({
      label: `Day${plans.length + 1}`,
      items: ["ICONSIAM", "暹羅商圈", "Central World"],
    });
  }

  if (hasShopping || hasFood) {
    plans.push({
      label: `Day${plans.length + 1}`,
      items: ["恰圖恰市集"],
    });
  }

  if (hasAttractions) {
    plans.push({
      label: `Day${plans.length + 1}`,
      items: ["臥佛寺", hasNightMarket ? "河濱夜市" : "河畔散步"],
    });
  }

  plans.push({
    label: `Day${plans.length + 1}`,
    items: ["水上市場或美功鐵道市場（近郊一日遊）"],
  });

  while (plans.length < days) {
    const day = plans.length + 1;
    if (hasShopping && day === plans.length) {
      plans.push({ label: `Day${day}`, items: ["暹羅商圈", "百貨補貨", "按摩"] });
      continue;
    }
    if (hasFood) {
      plans.push({ label: `Day${day}`, items: ["在地小吃", "咖啡廳", "夜市"] });
      continue;
    }
    plans.push({ label: `Day${day}`, items: ["自由安排", "咖啡廳或近郊"] });
  }

  return plans.slice(0, days);
}

function formatCompactDayPlans(plans: Array<{ label: string; items: string[] }>): string {
  return plans
    .map((plan) => [plan.label + "：", ...plan.items.map((item) => item)].join("\n"))
    .join("\n\n");
}

export function isReadyForItineraryPlanning(
  ctx: CanonicalTravelContext,
  options?: { preferencePending?: boolean },
): boolean {
  return Boolean(
    coerceTravelDestination(ctx.destination) &&
      ctx.days &&
      (ctx.mustVisitGenerated ||
        ctx.tripPurpose === "must_visit_places" ||
        ctx.conversationState === "ready_for_itinerary" ||
        options?.preferencePending),
  );
}

export function buildItineraryPlanningReply(
  ctx: CanonicalTravelContext,
  interests: TripInterest[],
): string | null {
  const label = coerceTravelDestination(ctx.destination);
  if (!label || !ctx.days) return null;

  const days = ctx.days;
  const mix = formatTripInterestMix(interests);

  if (label === "曼谷" || label.includes("曼谷")) {
    const plans = buildBangkokDayPlans(days, interests);
    return [
      `那我會建議把曼谷 ${days} 天排成${mix}混搭。`,
      "",
      formatCompactDayPlans(plans),
      "",
      "你比較想：",
      `A. 我直接幫你排完整 ${days} 天`,
      "B. 我先推薦每一天值得去的地點",
    ].join("\n");
  }

  return [
    `好，${label} ${days} 天我會依${mix}幫你抓方向。`,
    "前段排經典景點，中段穿插購物或美食，最後留一天彈性或近郊。",
    "",
    "你比較想：",
    `A. 我直接幫你排完整 ${days} 天`,
    "B. 我先推薦每一天值得去的地點",
  ].join("\n");
}
