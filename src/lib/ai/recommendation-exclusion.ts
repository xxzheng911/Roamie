import type { ChatPlanningSession } from "@/lib/chat-session";
import type { PlaceResult } from "@/lib/place-result";
import type { RoamieRecommendationItem } from "@/lib/ai/types";

export type ExclusionCategoryId =
  | "hotpot"
  | "italian"
  | "japanese"
  | "bbq"
  | "korean"
  | "thai"
  | "ramen"
  | "sushi"
  | "steak"
  | "seafood"
  | "vegetarian"
  | "cafe"
  | "outdoor"
  | "expensive"
  | "queue"
  | "far";

type ExclusionCategoryDef = {
  id: ExclusionCategoryId;
  labels: string[];
  keywords: string[];
};

const EXCLUSION_CATEGORIES: ExclusionCategoryDef[] = [
  {
    id: "hotpot",
    labels: ["火鍋"],
    keywords: ["火鍋", "hotpot", "hot pot", "shabu", "涮涮鍋", "麻辣鍋", "壽喜", "寿喜"],
  },
  {
    id: "italian",
    labels: ["義式", "義大利"],
    keywords: [
      "義式",
      "義大利",
      "italian",
      "pasta",
      "pizza",
      "披薩",
      "spaghetti",
      "trattoria",
      "ristorante",
    ],
  },
  {
    id: "japanese",
    labels: ["日式", "日料"],
    keywords: ["日式", "日料", "japanese", "居酒屋", "定食"],
  },
  {
    id: "bbq",
    labels: ["燒肉", "烤肉"],
    keywords: ["燒肉", "烤肉", "bbq", "yakiniku", "焼肉"],
  },
  {
    id: "korean",
    labels: ["韓式"],
    keywords: ["韓式", "korean", "韓國料理"],
  },
  {
    id: "thai",
    labels: ["泰式"],
    keywords: ["泰式", "thai", "泰國料理"],
  },
  {
    id: "ramen",
    labels: ["拉麵"],
    keywords: ["拉麵", "ramen", "ラーメン"],
  },
  {
    id: "sushi",
    labels: ["壽司", "寿司"],
    keywords: ["壽司", "寿司", "sushi", "迴轉"],
  },
  {
    id: "steak",
    labels: ["牛排"],
    keywords: ["牛排", "steak", "排餐"],
  },
  {
    id: "seafood",
    labels: ["海鮮"],
    keywords: ["海鮮", "seafood", "海產"],
  },
  {
    id: "vegetarian",
    labels: ["素食"],
    keywords: ["素食", "vegetarian", "蔬食"],
  },
  {
    id: "cafe",
    labels: ["咖啡廳", "咖啡"],
    keywords: ["咖啡廳", "咖啡店", "cafe", "coffee"],
  },
];

const EXCLUSION_TRIGGER_RE =
  /(?:不要|不喜歡|不太喜歡|不想吃|不太想吃|避免|排除|先不要|不要推薦|不考慮|不想)/;

const EXCLUSION_LIFT_RE =
  /(?:也可以|沒關係|没关系|沒問題|没问题|行|ok|OK|能接受|可以接受)/;

export function isExclusionReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isExclusionLiftReply(t)) return false;
  if (!EXCLUSION_TRIGGER_RE.test(t)) return false;
  return parseExcludedCategoryIds(t).length > 0 || parseAvoidConstraints(t).length > 0;
}

export function isExclusionLiftReply(text: string): boolean {
  const t = text.trim();
  if (!t || !EXCLUSION_LIFT_RE.test(t)) return false;
  return parseExcludedCategoryIds(t.replace(EXCLUSION_LIFT_RE, "")).length > 0;
}

function categoryFromToken(token: string): ExclusionCategoryDef | undefined {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return undefined;
  return EXCLUSION_CATEGORIES.find(
    (cat) =>
      cat.labels.some((label) => normalized.includes(label.toLowerCase())) ||
      cat.keywords.some((kw) => normalized.includes(kw.toLowerCase())),
  );
}

export function parseExcludedCategoryIds(text: string): ExclusionCategoryId[] {
  const t = text.trim();
  if (!t) return [];
  const ids = new Set<ExclusionCategoryId>();

  for (const cat of EXCLUSION_CATEGORIES) {
    const matched =
      cat.labels.some((label) => t.includes(label)) ||
      cat.keywords.some((kw) => t.toLowerCase().includes(kw.toLowerCase()));
    if (matched) ids.add(cat.id);
  }

  const segments = t
    .replace(EXCLUSION_TRIGGER_RE, " ")
    .replace(/先不要/g, " ")
    .split(/(?:跟|和|及|、|，|,|\/|\s+)+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const cat = categoryFromToken(segment);
    if (cat) ids.add(cat.id);
  }

  return [...ids];
}

export function expandExcludedKeywords(categoryIds: Iterable<ExclusionCategoryId>): string[] {
  const keywords = new Set<string>();
  for (const id of categoryIds) {
    const cat = EXCLUSION_CATEGORIES.find((c) => c.id === id);
    if (!cat) continue;
    for (const label of cat.labels) keywords.add(label);
    for (const kw of cat.keywords) keywords.add(kw);
  }
  return [...keywords];
}

export function parseExcludedCategoriesFromText(text: string): string[] {
  if (!EXCLUSION_TRIGGER_RE.test(text.trim()) && !isExclusionLiftReply(text)) {
    return [];
  }
  return expandExcludedKeywords(parseExcludedCategoryIds(text));
}

export function parseExclusionLifts(text: string): ExclusionCategoryId[] {
  if (!isExclusionLiftReply(text)) return [];
  return parseExcludedCategoryIds(text.replace(EXCLUSION_LIFT_RE, ""));
}

export function parseAvoidConstraints(text: string): string[] {
  const t = text.trim();
  if (!EXCLUSION_TRIGGER_RE.test(t)) return [];
  const avoid: string[] = [];
  if (/(太貴|貴一點|高價|奢侈)/.test(t)) avoid.push("高價位");
  if (/排隊/.test(t)) avoid.push("排隊");
  if (/(戶外|曝曬|太陽)/.test(t)) avoid.push("長時間戶外曝曬");
  if (/(太遠|遠一點|走太多|少走路|不想走)/.test(t)) avoid.push("長距離步行");
  if (/(太吵|人多|擠)/.test(t)) avoid.push("人多吵雜");
  return avoid;
}

export function mergeExcludedCategories(
  prev: string[] | undefined,
  additions: string[],
  lifts: ExclusionCategoryId[] = [],
): string[] {
  const liftKeywords = new Set(expandExcludedKeywords(lifts));
  const merged = new Set(prev ?? []);
  for (const kw of additions) merged.add(kw);
  for (const kw of liftKeywords) {
    for (const existing of [...merged]) {
      if (existing.toLowerCase() === kw.toLowerCase()) merged.delete(existing);
    }
  }
  return [...merged];
}

export function applyExclusionToSession(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const lifts = parseExclusionLifts(text);
  const additions = isExclusionLiftReply(text) ? [] : parseExcludedCategoriesFromText(text);
  const avoidAdds = isExclusionLiftReply(text) ? [] : parseAvoidConstraints(text);

  if (!additions.length && !avoidAdds.length && !lifts.length) {
    return session;
  }

  const excludedCategories = mergeExcludedCategories(session.excludedCategories, additions, lifts);
  const avoidTypes = new Set(session.avoidTypes ?? []);
  for (const a of avoidAdds) avoidTypes.add(a);

  const travelContext = {
    ...(session.travelContext ?? { interests: [] }),
    excludedCategories: excludedCategories.length ? excludedCategories : session.travelContext?.excludedCategories,
  };

  return {
    ...session,
    excludedCategories: excludedCategories.length ? excludedCategories : session.excludedCategories,
    avoidTypes: avoidTypes.size ? [...avoidTypes] : session.avoidTypes,
    travelContext,
  };
}

function placeTextBlob(place: {
  name?: string;
  address?: string | null;
  type?: string;
  description?: string;
  primaryType?: string | null;
  types?: string[] | null;
}): string {
  return [
    place.name,
    place.address,
    place.type,
    place.description,
    place.primaryType,
    ...(place.types ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function placeMatchesExcludedCategories(
  place: {
    name?: string;
    address?: string | null;
    type?: string;
    description?: string;
    primaryType?: string | null;
    types?: string[] | null;
  },
  excludedCategories: string[] | undefined,
): boolean {
  if (!excludedCategories?.length) return false;
  const blob = placeTextBlob(place);
  return excludedCategories.some((kw) => blob.includes(kw.toLowerCase()));
}

export function filterPlacesByExclusion<T extends PlaceResult>(places: T[], excluded?: string[]): T[] {
  if (!excluded?.length) return places;
  return places.filter((p) => !placeMatchesExcludedCategories(p, excluded));
}

export function filterRecommendationsByExclusion(
  items: RoamieRecommendationItem[],
  excluded?: string[],
): RoamieRecommendationItem[] {
  if (!excluded?.length) return items;
  return items.filter((item) => !placeMatchesExcludedCategories(item, excluded));
}

export function exclusionDisplayLabels(excludedCategories: string[] | undefined): string[] {
  if (!excludedCategories?.length) return [];
  const labels = new Set<string>();
  for (const cat of EXCLUSION_CATEGORIES) {
    if (cat.keywords.some((kw) => excludedCategories.some((e) => e.toLowerCase() === kw.toLowerCase()))) {
      labels.add(cat.labels[0] ?? cat.id);
    }
  }
  if (!labels.size) {
    return excludedCategories.slice(0, 4);
  }
  return [...labels];
}

export function buildExclusionAcknowledgment(excludedCategories: string[] | undefined): string | null {
  const labels = exclusionDisplayLabels(excludedCategories);
  if (!labels.length) return null;
  if (labels.length === 1) {
    return `好，我先避開${labels[0]}，幫你找其他比較適合的選擇。`;
  }
  const last = labels.pop()!;
  return `好，我先避開${labels.join("、")}和${last}，幫你找其他比較適合的選擇。`;
}

export function buildExclusionInsufficientSummary(
  excludedCategories: string[] | undefined,
  intent: "restaurant" | "cafe" | "attraction" = "restaurant",
): string {
  const ack = buildExclusionAcknowledgment(excludedCategories);
  const lead = ack ?? "好，我會依你的排除條件幫你找。";
  if (intent === "cafe") {
    return `${lead}\n\n目前附近符合條件的咖啡廳比較少，我可以改找甜點、輕食或安靜的簡餐店。`;
  }
  if (intent === "attraction") {
    return `${lead}\n\n目前附近符合條件的景點比較少，我可以改找室內、散步或輕量選項。`;
  }
  return `${lead}\n\n目前附近符合條件的選擇比較少，我可以改找日式、台式、小吃或咖啡簡餐。`;
}

export function resolveExcludedCategories(
  session: ChatPlanningSession,
  contextExcluded?: string[],
): string[] {
  return contextExcluded ?? session.excludedCategories ?? session.travelContext?.excludedCategories ?? [];
}
