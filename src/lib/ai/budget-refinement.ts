import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";

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
  const t = text.trim();
  if (!t) return undefined;
  if (BUDGET_REFINEMENT_RE.test(t)) return "low";
  if (/(奢華|高級|premium|luxury|不差錢|預算高)/i.test(t)) return "high";
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
  const preference = parseBudgetPreferenceFromText(text);
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
  const preference = parseBudgetPreferenceFromText(text);
  if (!preference) return session;

  const avoidTypes = new Set(session.avoidTypes ?? []);
  if (preference === "low") {
    avoidTypes.add("高價位");
    avoidTypes.add("需要門票");
    avoidTypes.add("高消費酒吧");
  }

  return {
    ...session,
    budget: preference === "low" ? "低預算" : session.budget,
    avoidTypes: [...avoidTypes],
    phase: session.recommendedPlaces.length > 0 ? "followup" : session.phase,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...applyBudgetRefinementToContext(text, session.travelContext ?? { interests: [] }),
    },
  };
}

function placeBudgetBlob(place: { name?: string; type?: string; description?: string; types?: string[] }): string {
  return `${place.name ?? ""} ${place.type ?? ""} ${place.description ?? ""} ${(place.types ?? []).join(" ")}`;
}

export function budgetPenaltyForPlace(
  place: { name?: string; type?: string; description?: string; types?: string[] },
  preference?: BudgetPreference,
): number {
  if (preference !== "low") return 0;
  const blob = placeBudgetBlob(place);
  if (EXPENSIVE_PLACE_RE.test(blob)) return 40;
  if (LOW_COST_PLACE_RE.test(blob)) return -15;
  return 0;
}

export function isExpensivePlace(
  place: { name?: string; type?: string; description?: string; types?: string[] },
  preference?: BudgetPreference,
): boolean {
  if (preference !== "low") return false;
  return budgetPenaltyForPlace(place, preference) >= 40;
}

export function refineRecommendationItemsForBudget(
  items: RoamieRecommendationItem[],
  preference: BudgetPreference = "low",
): RoamieRecommendationItem[] {
  const affordable = items.filter((item) => !isExpensivePlace(item, preference));
  const pool = affordable.length >= 2 ? affordable : items;
  return [...pool].sort(
    (a, b) => budgetPenaltyForPlace(a, preference) - budgetPenaltyForPlace(b, preference),
  );
}

export function refinePlaceResultsForBudget(
  places: PlaceResult[],
  preference: BudgetPreference = "low",
): PlaceResult[] {
  const affordable = places.filter((place) => !isExpensivePlace(place, preference));
  const pool = affordable.length >= 2 ? affordable : places;
  return [...pool].sort(
    (a, b) => budgetPenaltyForPlace(a, preference) - budgetPenaltyForPlace(b, preference),
  );
}

export function buildBudgetRefinementSummary(
  ctx: CanonicalTravelContext,
  picks: Array<{ name: string }>,
): string {
  const mood = ctx.mood?.trim();
  const moodLead = mood ? `記著你「${mood}」的心情，` : "";
  const list = picks
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join("\n");

  return [
    `${moodLead}懂，你想找比較省預算、不太需要門票或低消的選擇。`,
    "那我會優先幫你看免費景點、河岸散步、公園、市集，或平價咖啡店。",
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
