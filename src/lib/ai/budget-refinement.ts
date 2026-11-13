import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import { parseExplicitBudgetConstraint } from "@/lib/budget-context";
import { chatMoodDisplay } from "@/lib/chat-runtime-copy";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { Locale } from "@/lib/i18n/types";

export type BudgetPreference = "low" | "medium" | "high";

const BUDGET_REFINEMENT_RE =
  /(?:便宜(?:一點|些|的)?|省錢|省一點|預算低|低預算|不想花太多|不要花太多|免費|平價|cp\s*值|不要太貴|小資|省預算|花費少|低消)/i;

const EXPENSIVE_PLACE_RE =
  /(酒吧|夜店|lounge|米其林|fine dining|高級餐廳|精品|百貨|商場|shopping mall|甜點店|下午茶|會所|club|牛排館|燒肉|高價)/i;

const LOW_COST_PLACE_RE =
  /(公園|park|河濱|河岸|步道|夜市|market|市場|廣場|plaza|免費|廟|寺|老街|商圈|散步|綠地|濕地|海邊|看海|廣場|紀念館|博物館.*免)/i;

export function isBudgetRefinementText(text: string): boolean {
  return BUDGET_REFINEMENT_RE.test(text.trim());
}

export function parseBudgetPreferenceFromText(text: string): BudgetPreference | undefined {
  const explicit = parseExplicitBudgetConstraint(text);
  if (!explicit || explicit.unrestricted) return undefined;
  if (explicit.mode === "budget") return "low";
  if (explicit.mode === "luxury") return "high";
  if (explicit.mode === "standard" || explicit.mode === "quality") return "medium";
  return undefined;
}

export function isBudgetRefinementActive(
  session: ChatPlanningSession,
  ctx?: CanonicalTravelContext,
): boolean {
  const purpose = ctx?.tripPurpose ?? session.travelContext?.tripPurpose;
  return (
    purpose === "refine_recommendations" ||
    ctx?.budgetPreference === "low" ||
    ctx?.priceSensitivity === true ||
    session.travelContext?.budgetPreference === "low" ||
    session.travelContext?.priceSensitivity === true
  );
}

export function applyBudgetRefinementToContext(
  text: string,
  prev: CanonicalTravelContext,
): Partial<CanonicalTravelContext> {
  const explicit = parseExplicitBudgetConstraint(text);
  if (!explicit) return {};
  const preference = parseBudgetPreferenceFromText(text);
  if (explicit.unrestricted) {
    return { budgetPreference: undefined, priceSensitivity: false };
  }
  if (!preference) return {};

  return {
    budgetPreference: preference,
    priceSensitivity: preference === "low",
    budgetLevel: preference === "low" ? "budget" : prev.budgetLevel,
    tripPurpose: "refine_recommendations",
    interests: preference === "low" ? [...new Set([...prev.interests, "省預算", "平價"])] : prev.interests,
  };
}

export function applyBudgetRefinementToSession(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const explicit = parseExplicitBudgetConstraint(text);
  if (!explicit) return session;
  const preference = parseBudgetPreferenceFromText(text);

  return {
    ...session,
    // Explicit request budget is request-scoped. The trip budget remains unchanged.
    budget: session.budget,
    avoidTypes: session.avoidTypes,
    phase: session.recommendedPlaces.length > 0 ? "followup" : session.phase,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...applyBudgetRefinementToContext(text, session.travelContext ?? { interests: [] }),
    },
  };
}

function placeBudgetBlob(place: { name?: string; type?: string; description?: string; types?: string[] | null }): string {
  return `${place.name ?? ""} ${place.type ?? ""} ${place.description ?? ""} ${(place.types ?? []).join(" ")}`;
}

export function budgetPenaltyForPlace(
  place: { name?: string; type?: string; description?: string; types?: string[] | null },
  preference?: BudgetPreference,
): number {
  if (preference !== "low") return 0;
  const blob = placeBudgetBlob(place);
  if (EXPENSIVE_PLACE_RE.test(blob)) return 40;
  if (LOW_COST_PLACE_RE.test(blob)) return -15;
  return 0;
}

export function isExpensivePlace(
  place: { name?: string; type?: string; description?: string; types?: string[] | null },
  preference?: BudgetPreference,
): boolean {
  if (preference !== "low") return false;
  return budgetPenaltyForPlace(place, preference) >= 40;
}

export function refineRecommendationItemsForBudget(
  items: RoamieRecommendationItem[],
  preference: BudgetPreference = "low",
): RoamieRecommendationItem[] {
  return [...items].sort(
    (a, b) => budgetPenaltyForPlace(a, preference) - budgetPenaltyForPlace(b, preference),
  );
}

export function refinePlaceResultsForBudget(
  places: PlaceResult[],
  preference: BudgetPreference = "low",
): PlaceResult[] {
  return [...places].sort(
    (a, b) => budgetPenaltyForPlace(a, preference) - budgetPenaltyForPlace(b, preference),
  );
}

function buildForeignBudgetRefinementSummary(
  ctx: CanonicalTravelContext,
  picks: Array<{ name: string }>,
  locale: Exclude<Locale, "zh-TW">,
): string {
  const rawMood = ctx.mood?.trim();
  const mood = rawMood ? chatMoodDisplay(rawMood, locale).trim() : "";
  const list = picks
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");
  const copy = {
    en: {
      lead: mood
        ? `Keeping your "${mood}" mood in mind, I'll keep spending on this trip easy.`
        : "Got it, you'd like to keep spending on this trip easy.",
      method:
        "Without reliable price data, I'll put places that suit this way of traveling first, rather than treating a category as an actual price.",
      better: "These should suit you better than the earlier picks:",
      none: "I couldn't find better budget-friendly options nearby yet. Describe it a little differently and I'll look again.",
      narrow: "If you want to narrow it down by style or distance, just let me know.",
    },
    ja: {
      lead: mood
        ? `「${mood}」の気分を大切にしつつ、今回は出費を抑えて気軽に楽しみたいんですね。`
        : "なるほど、今回は出費を抑えて気軽に楽しみたいんですね。",
      method:
        "信頼できる価格データがない場合は、この旅のスタイルに合うスポットを優先して並べ、カテゴリを実際の価格とはみなしません。",
      better: "さきほどのおすすめより、こちらのほうが合いそうです：",
      none: "近くで予算を抑えたより良い候補が見つかりませんでした。言い方を変えて教えてもらえれば、もう一度探します。",
      narrow: "スタイルや距離でさらに絞りたい場合は、気軽に教えてください。",
    },
    ko: {
      lead: mood
        ? `"${mood}" 기분을 기억하면서, 이번에는 지출을 부담 없이 하고 싶으시군요.`
        : "알겠어요, 이번에는 지출을 부담 없이 하고 싶으시군요.",
      method:
        "신뢰할 만한 가격 정보가 없을 때는 이런 여행 방식에 더 맞는 장소를 먼저 보여 드리고, 카테고리를 실제 가격으로 보지 않아요.",
      better: "아까 추천보다 이곳들이 더 잘 맞을 거예요:",
      none: "근처에서 더 알맞은 저예산 옵션을 아직 찾지 못했어요. 조금 다르게 설명해 주시면 다시 찾아볼게요.",
      narrow: "스타일이나 거리로 더 좁히고 싶다면 편하게 말해 주세요.",
    },
  }[locale];
  return [
    copy.lead,
    copy.method,
    picks.length ? copy.better : copy.none,
    picks.length ? "" : undefined,
    picks.length ? list : undefined,
    picks.length ? "" : undefined,
    picks.length ? copy.narrow : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function buildBudgetRefinementSummary(
  ctx: CanonicalTravelContext,
  picks: Array<{ name: string }>,
  locale: Locale = effectiveAppLocale(),
): string {
  if (locale !== "zh-TW") return buildForeignBudgetRefinementSummary(ctx, picks, locale);
  const mood = ctx.mood?.trim();
  const moodLead = mood ? `記著你「${mood}」的心情，` : "";
  const list = picks
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  return [
    `${moodLead}懂，你想讓這次的消費安排輕鬆一些。`,
    "在沒有可靠價格資料時，我會把較符合這種旅行方式的地點優先排列，不把類別當成實際價格。",
    picks.length ? "這幾個會比剛剛推薦更適合：" : "附近暫時沒找到更合適的低預算選項，可以換個描述我再幫你找。",
    picks.length ? "" : undefined,
    picks.length ? list : undefined,
    picks.length ? "" : undefined,
    picks.length ? "想再收窄風格或距離，跟我說一聲就好。" : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function lowBudgetSearchQuery(
  intent: "restaurant" | "cafe" | "attraction",
  moodBlob: string,
): { query: string; mode: "nearby" | "text"; includedTypes?: string[] } {
  if (intent === "restaurant") {
    return { query: "平價餐廳 小吃 夜市", mode: "text" };
  }
  if (intent === "cafe") {
    return { query: "平價 咖啡廳", mode: "text" };
  }
  if (/(深夜|夜景|晚上)/.test(moodBlob)) {
    return {
      query: "夜市 河濱 夜景 散步",
      mode: "nearby",
      includedTypes: ["park", "tourist_attraction", "point_of_interest"],
    };
  }
  return {
    query: "公園 河濱 夜市 免費景點",
    mode: "nearby",
    includedTypes: ["park", "tourist_attraction", "point_of_interest"],
  };
}
