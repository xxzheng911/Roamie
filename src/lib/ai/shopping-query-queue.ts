/**
 * Shopping Query Queue — coverage-aware, budgeted Places searches for shopping
 * recommendation +「還有嗎」follow-up.
 *
 * Rules:
 * - One primary search intent per network call
 * - Cross different query groups within the same budget (never 3 synonym queries)
 * - Prefer uncovered shopping types + high-hit-rate local queries
 * - Reserve unused first-round candidates before calling Places again
 */
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import type { ConversationRecommendationSession } from "@/lib/ai/conversation-recommendation-session";
import type { RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizePlaceName } from "@/lib/place-planning-memory";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  resolveShoppingSearchScope,
  type ShoppingSearchScope,
} from "@/lib/ai/shopping-search-scope";

export type ShoppingSubtype =
  | "general"
  | "department_store"
  | "outlet"
  | "shopping_street"
  | "underground_mall"
  | "mall"
  | "market";

export type ShoppingType =
  | "shopping_street"
  | "department_store"
  | "shopping_mall"
  | "station_mall"
  | "underground_mall"
  | "outlet"
  | "market"
  | "retail_complex"
  | "fashion_building"
  | "local_shopping_area"
  | "specialty_store_area";

export type ShoppingQueryGroupId =
  | "underground_mall"
  | "shopping_mall_complex"
  | "local_market"
  | "fashion_specialty"
  | "outlet"
  | "department_store"
  | "shopping_street"
  | "station_mall";

export type ShoppingQueryLocale = "ja" | "en" | "zh";

export type ShoppingQueryGroup = {
  id: ShoppingQueryGroupId;
  label: string;
  /** Shopping types this group primarily covers */
  covers: ShoppingType[];
  /** Lower = higher hit-rate for general JP urban follow-up */
  priority: number;
  queries: Record<ShoppingQueryLocale, string[]>;
  includedTypes: string[];
};

export type ShoppingCoverageState = {
  seenPlaceIds: string[];
  seenCanonicalKeys: string[];
  seenPlaceNames: string[];
  coveredShoppingTypes: ShoppingType[];
  coveredClusters: string[];
  usedQueryGroups: ShoppingQueryGroupId[];
  destination: string;
  destinationCountryCode?: string;
  destinationLanguage?: ShoppingQueryLocale;
};

/** Legacy page shape kept for verify / callers that still iterate pages. */
export type ShoppingQueryPage = {
  queries: string[];
  includedTypes: string[];
};

const SHOPPING_SEARCH_TYPES = [
  "shopping_mall",
  "department_store",
  "store",
  "clothing_store",
  "home_goods_store",
  "gift_shop",
] as const;

function q(
  id: ShoppingQueryGroupId,
  label: string,
  covers: ShoppingType[],
  priority: number,
  ja: string[],
  en: string[],
  zh: string[],
  includedTypes: string[] = [...SHOPPING_SEARCH_TYPES],
): ShoppingQueryGroup {
  return {
    id,
    label,
    covers,
    priority,
    queries: { ja, en, zh },
    includedTypes,
  };
}

/**
 * Follow-up query groups — ordered by typical urban hit-rate.
 * Outlet is last: often suburban / sparse for city centers like Sapporo.
 */
export const SHOPPING_QUERY_GROUPS: ShoppingQueryGroup[] = [
  q(
    "underground_mall",
    "underground_mall",
    ["underground_mall"],
    1,
    ["{city} 地下街", "{city} 地下ショッピング", "{city} 地下商店街", "{city} 地下街 商業施設"],
    ["{city} underground shopping mall", "{city} underground shopping street"],
    ["{city} 地下街", "{city} 地下商場"],
  ),
  q(
    "shopping_mall_complex",
    "shopping_mall_complex",
    ["shopping_mall", "retail_complex", "station_mall"],
    2,
    ["{city} ショッピングモール", "{city} 商業施設", "{city} 複合商業施設", "{city} ショッピングセンター"],
    ["{city} shopping mall", "{city} shopping center", "{city} commercial complex"],
    ["{city} 購物中心", "{city} 商場", "{city} 複合商場"],
  ),
  q(
    "local_market",
    "local_market",
    ["market", "local_shopping_area", "shopping_street"],
    3,
    ["{city} 市場", "{city} 商店街", "{city} ローカルショッピング", "{city} 買い物エリア"],
    ["{city} market", "{city} local shopping area", "{city} shopping district"],
    ["{city} 市場", "{city} 商店街", "{city} 在地購物"],
  ),
  q(
    "fashion_specialty",
    "fashion_specialty",
    ["fashion_building", "specialty_store_area"],
    4,
    ["{city} ファッションビル", "{city} セレクトショップ", "{city} 雑貨 商業施設", "{city} ライフスタイルショップ"],
    ["{city} fashion mall", "{city} specialty shopping", "{city} lifestyle shopping"],
    ["{city} 時尚商場", "{city} 選物店", "{city} 特色購物"],
  ),
  q(
    "outlet",
    "outlet",
    ["outlet"],
    5,
    ["{city} アウトレット"],
    ["{city} outlet mall"],
    ["{city} Outlet", "{city} 暢貨中心"],
  ),
  q(
    "department_store",
    "department_store",
    ["department_store"],
    6,
    ["{city} 百貨店", "{city} デパート"],
    ["{city} department store"],
    ["{city} 百貨公司", "{city} 百貨"],
    ["department_store", "shopping_mall", "store"],
  ),
  q(
    "shopping_street",
    "shopping_street",
    ["shopping_street"],
    7,
    ["{city} 商店街"],
    ["{city} shopping street"],
    ["{city} 商店街"],
  ),
  q(
    "station_mall",
    "station_mall",
    ["station_mall", "shopping_mall"],
    8,
    ["{city} 駅ビル", "{city} 駅 ショッピングモール"],
    ["{city} station mall", "{city} station shopping"],
    ["{city} 車站商場", "{city} 車站購物"],
  ),
];

/** @deprecated prefer SHOPPING_QUERY_GROUPS — kept as group→page projection */
export const SHOPPING_QUERY_PAGES: ShoppingQueryPage[] = SHOPPING_QUERY_GROUPS.map(
  (g) => ({
    queries: g.queries.ja,
    includedTypes: g.includedTypes,
  }),
);

/** Soft upper bound on follow-up geo/group rounds (budget is the hard stop). */
export const SHOPPING_FOLLOWUP_MAX_ROUNDS = 3;
export const SHOPPING_FOLLOWUP_IDEAL_NEW = 4;
export const SHOPPING_FOLLOWUP_MIN_NEW = 2;
/** @deprecated alias — prefer SHOPPING_FOLLOWUP_IDEAL_NEW */
export const SHOPPING_FOLLOWUP_TARGET_NEW = SHOPPING_FOLLOWUP_IDEAL_NEW;

export const SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS = 3;
export const SHOPPING_FOLLOWUP_MAX_QUERIES = 3;
export const SHOPPING_FOLLOWUP_DEADLINE_MS = 9_000;
/** Follow-up takes 1 query per group/call — never dump synonyms. */
export const SHOPPING_QUERIES_PER_GROUP = 1;
export const SHOPPING_RESULTS_PER_QUERY = 8;

/** UI batch size for shopping recommendations. */
export const SHOPPING_DISPLAY_LIMIT = 4;
/** Valid candidates after category gate + canonical dedupe (display + reserve). */
export const SHOPPING_INITIAL_VALID_TARGET = 8;
/** Raw Places target before validation (oversample). */
export const SHOPPING_INITIAL_RAW_TARGET = 16;
/** Max network calls for first-round multi-group oversample. */
export const SHOPPING_INITIAL_MAX_NETWORK_CALLS = 5;
/** @deprecated prefer SHOPPING_INITIAL_VALID_TARGET */
export const SHOPPING_INITIAL_POOL_TARGET = SHOPPING_INITIAL_VALID_TARGET;
/** How many reserve slots we aim to keep after first-round display. */
export const SHOPPING_INITIAL_RESERVE_TARGET = 4;

export const SHOPPING_NO_MORE_RECOMMENDATIONS_MESSAGE =
  "目前暫時找不到更多符合條件、且不重複的購物地點。你也可以指定想找百貨、地下街、Outlet 或特色商店，我再換一個方向幫你找。";

/** Shown when the same destination+shopping session is already exhausted. */
export function buildShoppingExhaustedFollowupMessage(destination: string): string {
  const label = destination.trim() || "這裡";
  return `${label}目前符合這組購物條件、且未重複的地點已經看完了。你可以指定想找百貨、地下街、Outlet 或特色商店，我再換一個方向幫你找。`;
}

export type ShoppingReserveUsedReason =
  | "used"
  | "empty_reserve"
  | "no_matching_subtype";

export type FollowUpSearchBudget = {
  maxNetworkCalls: number;
  usedNetworkCalls: number;
  maxQueries: number;
  usedQueries: string[];
  targetNewResults: number;
  deadlineMs: number;
};

export type FollowUpSearchStatus =
  | "success"
  | "partial"
  | "exhausted"
  | "rate_limited"
  | "error"
  | "timeout";

export type ShoppingFollowupGroupPlan = {
  availableGroups: ShoppingQueryGroupId[];
  selectedGroups: ShoppingQueryGroupId[];
  reason: string;
};

export type ShoppingFollowupCall = {
  group: ShoppingQueryGroup;
  query: string;
  attempt: SearchAttempt;
};

export function createShoppingFollowUpBudget(
  now = Date.now(),
): FollowUpSearchBudget {
  return {
    maxNetworkCalls: SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS,
    usedNetworkCalls: 0,
    maxQueries: SHOPPING_FOLLOWUP_MAX_QUERIES,
    usedQueries: [],
    targetNewResults: SHOPPING_FOLLOWUP_IDEAL_NEW,
    deadlineMs: now + SHOPPING_FOLLOWUP_DEADLINE_MS,
  };
}

export function shoppingBudgetExhausted(
  budget: FollowUpSearchBudget,
  now = Date.now(),
): boolean {
  return (
    budget.usedNetworkCalls >= budget.maxNetworkCalls ||
    budget.usedQueries.length >= budget.maxQueries ||
    now >= budget.deadlineMs
  );
}

const DEPARTMENT_STORE_RE = /百貨|デパート|department\s*store/i;
const OUTLET_RE = /outlet|アウトレット/i;
const UNDERGROUND_RE = /地下街|地下ショッピング|underground\s*(?:mall|shopping)/i;
const STREET_RE = /商店街|shopping\s*street|商圈/i;
const MARKET_RE = /市場|市集|\bmarket\b|ふくこいち|二条市場/i;
const MALL_RE = /購物中心|商場|ショッピングモール|shopping\s*mall|\bmall\b|商業施設/i;

export function detectShoppingSubtype(userText: string): ShoppingSubtype {
  const t = userText.trim();
  if (!t) return "general";
  if (DEPARTMENT_STORE_RE.test(t)) return "department_store";
  if (OUTLET_RE.test(t)) return "outlet";
  if (UNDERGROUND_RE.test(t)) return "underground_mall";
  if (MARKET_RE.test(t)) return "market";
  if (STREET_RE.test(t)) return "shopping_street";
  if (MALL_RE.test(t)) return "mall";
  return "general";
}

export function resolveShoppingQueryLocale(params: {
  countryCode?: string | null;
  country?: string | null;
  city?: string | null;
  destinationLanguage?: ShoppingQueryLocale | null;
}): ShoppingQueryLocale {
  if (params.destinationLanguage) return params.destinationLanguage;
  const country = `${params.countryCode ?? ""} ${params.country ?? ""}`.toLowerCase();
  if (/(?:jp|japan|日本|日本国)/i.test(country)) return "ja";
  if (/(?:tw|taiwan|台灣|台湾|中華民國)/i.test(country)) return "zh";
  if (/(?:cn|china|中國|中国)/i.test(country)) return "zh";
  const city = params.city ?? "";
  if (/[\u3040-\u30ff]/.test(city) || /(?:札幌|東京|大阪|京都|福岡|名古屋|橫濱|横浜)/.test(city)) {
    return "ja";
  }
  if (/[\u4e00-\u9fff]/.test(city)) return "zh";
  return "en";
}

function fillCity(template: string, city: string): string {
  return template
    .replaceAll("{city}", city.trim())
    .replaceAll("{dest}", city.trim());
}

function groupQueriesForLocale(
  group: ShoppingQueryGroup,
  locale: ShoppingQueryLocale,
): string[] {
  const primary = group.queries[locale] ?? [];
  if (primary.length) return primary;
  return group.queries.en.length ? group.queries.en : group.queries.ja;
}

export function inferShoppingTypesFromPlace(place: {
  name?: string | null;
  placeName?: string | null;
  types?: string[] | null;
  type?: string | null;
  primaryType?: string | null;
  address?: string | null;
}): ShoppingType[] {
  const name = `${place.placeName ?? ""} ${place.name ?? ""}`.trim();
  const blob = `${name} ${place.address ?? ""}`;
  const types = [
    place.primaryType,
    place.type,
    ...(place.types ?? []),
  ]
    .map((t) => (t ?? "").trim().toLowerCase())
    .filter(Boolean);
  const out = new Set<ShoppingType>();

  if (/地下街|地下歩行|underground\s*(?:mall|shopping)|ポールタウン|pole\s*town|apia/i.test(blob)) {
    out.add("underground_mall");
  }
  if (/商店街|shopping\s*street|狸小路/i.test(name)) {
    out.add("shopping_street");
  }
  if (
    /百貨|デパート|department\s*store|大丸|三越|高島屋|伊勢丹|松坂屋|そごう|sogo/i.test(name) ||
    types.includes("department_store")
  ) {
    out.add("department_store");
  }
  if (/outlet|アウトレット/i.test(name) || types.some((t) => t.includes("outlet"))) {
    out.add("outlet");
  }
  if (/市場|市集|\bmarket\b/i.test(name) || types.includes("market") || types.includes("flea_market")) {
    out.add("market");
  }
  if (
    /駅ビル|station\s*(?:mall|building)|JR塔|ステラ|stellar\s*place|pole\s*town|apia|エスタ|esta/i.test(
      blob,
    )
  ) {
    out.add("station_mall");
  }
  if (
    types.includes("shopping_mall") ||
    /モール|購物中心|ショッピングモール|shopping\s*(?:mall|center)|plaza|factory|商業施設|複合商業/i.test(
      name,
    )
  ) {
    out.add("shopping_mall");
  }
  if (/ファッションビル|fashion\s*(?:building|mall)|セレクトショップ/i.test(name)) {
    out.add("fashion_building");
  }
  if (/雑貨|lifestyle|選物|specialty/i.test(name)) {
    out.add("specialty_store_area");
  }
  if (/ローカル|買い物エリア|local\s*shopping|shopping\s*district/i.test(blob)) {
    out.add("local_shopping_area");
  }
  if (/複合商業|retail\s*complex|commercial\s*complex/i.test(name)) {
    out.add("retail_complex");
  }

  if (!out.size) {
    if (types.includes("store") || types.includes("clothing_store")) {
      out.add("specialty_store_area");
    } else {
      out.add("shopping_mall");
    }
  }
  return [...out];
}

export function buildShoppingCoverageState(params: {
  destination: string;
  places: Array<{
    name?: string | null;
    placeName?: string | null;
    googlePlaceId?: string | null;
    placeId?: string | null;
    types?: string[] | null;
    type?: string | null;
    primaryType?: string | null;
    address?: string | null;
  }>;
  coveredClusters?: string[];
  usedQueryGroups?: ShoppingQueryGroupId[];
  destinationCountryCode?: string;
  destinationLanguage?: ShoppingQueryLocale;
  existing?: ShoppingCoverageState | null;
}): ShoppingCoverageState {
  const seenPlaceIds = new Set(params.existing?.seenPlaceIds ?? []);
  const seenCanonicalKeys = new Set(params.existing?.seenCanonicalKeys ?? []);
  const seenPlaceNames = new Set(params.existing?.seenPlaceNames ?? []);
  const coveredShoppingTypes = new Set<ShoppingType>(
    params.existing?.coveredShoppingTypes ?? [],
  );

  for (const place of params.places) {
    const id = (place.googlePlaceId ?? place.placeId ?? "").trim();
    if (id) seenPlaceIds.add(id);
    const key = shoppingCanonicalKey(place);
    if (key) seenCanonicalKeys.add(key);
    const name = (place.placeName ?? place.name ?? "").trim();
    if (name) seenPlaceNames.add(name);
    for (const t of inferShoppingTypesFromPlace(place)) {
      coveredShoppingTypes.add(t);
    }
  }

  return {
    seenPlaceIds: [...seenPlaceIds],
    seenCanonicalKeys: [...seenCanonicalKeys],
    seenPlaceNames: [...seenPlaceNames],
    coveredShoppingTypes: [...coveredShoppingTypes],
    coveredClusters: [
      ...new Set([
        ...(params.existing?.coveredClusters ?? []),
        ...(params.coveredClusters ?? []),
      ]),
    ],
    usedQueryGroups: [
      ...new Set([
        ...(params.existing?.usedQueryGroups ?? []),
        ...(params.usedQueryGroups ?? []),
      ]),
    ],
    destination: params.destination,
    destinationCountryCode:
      params.destinationCountryCode ?? params.existing?.destinationCountryCode,
    destinationLanguage:
      params.destinationLanguage ?? params.existing?.destinationLanguage,
  };
}

function groupForSubtype(subtype: ShoppingSubtype): ShoppingQueryGroup | null {
  if (subtype === "department_store") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "department_store") ?? null;
  }
  if (subtype === "outlet") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "outlet") ?? null;
  }
  if (subtype === "underground_mall") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "underground_mall") ?? null;
  }
  if (subtype === "shopping_street") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "shopping_street") ?? null;
  }
  if (subtype === "market") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "local_market") ?? null;
  }
  if (subtype === "mall") {
    return SHOPPING_QUERY_GROUPS.find((g) => g.id === "shopping_mall_complex") ?? null;
  }
  return null;
}

/** Groups to push down when their primary type already appeared in round 1. */
const FOLLOWUP_DEPRIORITIZE_IDS = new Set<ShoppingQueryGroupId>([
  "shopping_street",
  "department_store",
  "station_mall",
]);

function groupShouldDeprioritize(
  group: ShoppingQueryGroup,
  covered: Set<ShoppingType>,
): boolean {
  if (!FOLLOWUP_DEPRIORITIZE_IDS.has(group.id)) return false;
  return group.covers.some((t) => covered.has(t));
}

/**
 * Plan follow-up groups: high-hit-rate first, deprioritize already-shown street/dept/station.
 * Refinement subtypes pin to that group (may re-search same type for new places).
 */
export function planShoppingFollowupGroups(params: {
  coverage: ShoppingCoverageState;
  subtype?: ShoppingSubtype;
  maxGroups?: number;
}): ShoppingFollowupGroupPlan {
  const subtype = params.subtype ?? "general";
  const maxGroups = params.maxGroups ?? SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS;
  const covered = new Set(params.coverage.coveredShoppingTypes);
  const used = new Set(params.coverage.usedQueryGroups);

  const subtypeGroup = groupForSubtype(subtype);
  if (subtypeGroup) {
    return {
      availableGroups: [subtypeGroup.id],
      selectedGroups: [subtypeGroup.id],
      reason: `intent_refinement:${subtype}`,
    };
  }

  const ranked = [...SHOPPING_QUERY_GROUPS].sort((a, b) => {
    const aUsed = used.has(a.id) ? 1 : 0;
    const bUsed = used.has(b.id) ? 1 : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    const aCov = groupShouldDeprioritize(a, covered) ? 1 : 0;
    const bCov = groupShouldDeprioritize(b, covered) ? 1 : 0;
    if (aCov !== bCov) return aCov - bCov;
    return a.priority - b.priority;
  });

  const availableGroups = ranked.map((g) => g.id);
  const selectedGroups = ranked.slice(0, maxGroups).map((g) => g.id);
  const top = ranked[0];
  let reason = "high_hit_rate";
  if (!top) reason = "exhausted";
  else if (used.has(top.id)) reason = "reuse_after_exhaustion";
  else if (!groupShouldDeprioritize(top, covered)) reason = "uncovered_type";
  else reason = "high_hit_rate";

  return { availableGroups, selectedGroups, reason };
}

function pickUnusedQuery(
  group: ShoppingQueryGroup,
  city: string,
  locale: ShoppingQueryLocale,
  usedQueries: Set<string>,
): string | null {
  // Prefer destination locale; only fall back to other locales after primary templates are exhausted.
  const locales: ShoppingQueryLocale[] =
    locale === "ja"
      ? ["ja", "en", "zh"]
      : locale === "zh"
        ? ["zh", "en", "ja"]
        : ["en", "ja", "zh"];
  for (const loc of locales) {
    for (const template of groupQueriesForLocale(group, loc)) {
      const query = fillCity(template, city);
      if (!usedQueries.has(query)) return query;
    }
  }
  return null;
}

/**
 * Build up to `maxCalls` follow-up calls.
 * General: 1 query × distinct groups (cross-group).
 * Refinement (百貨/地下街/…): up to maxCalls queries from the pinned group.
 */
export function buildShoppingFollowupCalls(params: {
  destination: string;
  activeSearchCity?: string;
  coverage: ShoppingCoverageState;
  subtype?: ShoppingSubtype;
  radius?: number;
  skipQueries?: string[];
  maxCalls?: number;
}): {
  calls: ShoppingFollowupCall[];
  plan: ShoppingFollowupGroupPlan;
  activeSearchCity: string;
  locale: ShoppingQueryLocale;
} {
  const city =
    params.activeSearchCity?.trim() ||
    resolveInitialShoppingCity(params.destination);
  const locale = resolveShoppingQueryLocale({
    countryCode: params.coverage.destinationCountryCode,
    city,
    destinationLanguage: params.coverage.destinationLanguage,
  });
  const maxCalls = params.maxCalls ?? SHOPPING_FOLLOWUP_MAX_NETWORK_CALLS;
  const subtype = params.subtype ?? "general";
  const plan = planShoppingFollowupGroups({
    coverage: params.coverage,
    subtype,
    maxGroups: maxCalls,
  });
  const usedQueryStrings = new Set(params.skipQueries ?? []);
  const calls: ShoppingFollowupCall[] = [];
  const selected: ShoppingQueryGroupId[] = [];

  if (subtype !== "general") {
    const groupId = plan.selectedGroups[0];
    const group = groupId
      ? SHOPPING_QUERY_GROUPS.find((g) => g.id === groupId)
      : null;
    if (group) {
      for (let i = 0; i < maxCalls; i++) {
        const query = pickUnusedQuery(group, city, locale, usedQueryStrings);
        if (!query) break;
        usedQueryStrings.add(query);
        selected.push(group.id);
        calls.push({
          group,
          query,
          attempt: {
            query,
            mode: "text",
            includedTypes: [...group.includedTypes],
          },
        });
      }
    }
    return {
      calls,
      plan: { ...plan, selectedGroups: selected },
      activeSearchCity: city,
      locale,
    };
  }

  for (const groupId of plan.availableGroups) {
    if (calls.length >= maxCalls) break;
    if (selected.includes(groupId)) continue;
    const group = SHOPPING_QUERY_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;
    const query = pickUnusedQuery(group, city, locale, usedQueryStrings);
    if (!query) {
      logShoppingQuerySkipped({ query: group.label, reason: "no_unused_query" });
      continue;
    }
    usedQueryStrings.add(query);
    selected.push(groupId);
    calls.push({
      group,
      query,
      attempt: {
        query,
        mode: "text",
        includedTypes: [...group.includedTypes],
      },
    });
  }

  return {
    calls,
    plan: { ...plan, selectedGroups: selected },
    activeSearchCity: city,
    locale,
  };
}

export function buildShoppingAttemptsFromPage(
  city: string,
  page: ShoppingQueryPage,
  _radius?: number,
  limit = SHOPPING_QUERIES_PER_GROUP,
): SearchAttempt[] {
  return page.queries.slice(0, limit).map((template) => ({
    query: fillCity(template, city),
    mode: "text" as const,
    includedTypes: [...page.includedTypes],
  }));
}

function buildAttemptsFromGroup(
  city: string,
  group: ShoppingQueryGroup,
  locale: ShoppingQueryLocale,
  _radius?: number,
  limit = SHOPPING_QUERIES_PER_GROUP,
): SearchAttempt[] {
  const queries = groupQueriesForLocale(group, locale).slice(0, limit);
  return queries.map((template) => ({
    query: fillCity(template, city),
    mode: "text" as const,
    includedTypes: [...group.includedTypes],
  }));
}

/** Resolve which query group/page to use for this recommendation page index. */
export function resolveShoppingQueryPage(params: {
  destination: string;
  pageIndex: number;
  subtype?: ShoppingSubtype;
  activeSearchCity?: string;
  queryLimit?: number;
  destinationCountryCode?: string;
}): {
  page: ShoppingQueryPage;
  attempts: SearchAttempt[];
  pageIndex: number;
  group: ShoppingQueryGroup;
} {
  const city = (params.activeSearchCity ?? params.destination).trim();
  const subtype = params.subtype ?? "general";
  const limit = params.queryLimit ?? SHOPPING_QUERIES_PER_GROUP;
  const locale = resolveShoppingQueryLocale({
    countryCode: params.destinationCountryCode,
    city,
  });
  const subtypeGroup = groupForSubtype(subtype);
  if (subtypeGroup && params.pageIndex === 0) {
    const attempts = buildAttemptsFromGroup(city, subtypeGroup, locale, undefined, limit);
    return {
      page: {
        queries: groupQueriesForLocale(subtypeGroup, locale),
        includedTypes: subtypeGroup.includedTypes,
      },
      attempts,
      pageIndex: 0,
      group: subtypeGroup,
    };
  }
  const idx = Math.min(
    Math.max(0, params.pageIndex),
    SHOPPING_QUERY_GROUPS.length - 1,
  );
  const group = SHOPPING_QUERY_GROUPS[idx]!;
  const attempts = buildAttemptsFromGroup(city, group, locale, undefined, limit);
  return {
    page: {
      queries: groupQueriesForLocale(group, locale),
      includedTypes: group.includedTypes,
    },
    attempts,
    pageIndex: idx,
    group,
  };
}

export function shoppingCanonicalKey(place: {
  name?: string | null;
  placeName?: string | null;
  googlePlaceId?: string | null;
  placeId?: string | null;
}): string {
  const id = (place.googlePlaceId ?? place.placeId ?? "").trim();
  if (id) return `id:${id}`;
  return `n:${normalizePlaceName(place.placeName ?? place.name ?? "")}`;
}

/**
 * Brand key for soft de-priority (not hard exclude).
 * Different branches of the same brand share a brand key.
 */
export function shoppingBrandKey(place: {
  name?: string | null;
  placeName?: string | null;
}): string {
  const name = normalizePlaceName(place.placeName ?? place.name ?? "");
  if (!name) return "";
  const brand = name
    .replace(
      /(?:札幌|sapporo|東京|大阪|京都)?\s*(?:店|支店|本店)?\s*$/i,
      "",
    )
    .replace(
      /\s*(?:apia|pole\s*town|ポールタウン|ステラ|stella|factory|大通|駅前).*$/i,
      "",
    )
    .trim();
  return brand.length >= 2 ? `b:${brand}` : "";
}

export function remainingShoppingPages(
  session: ConversationRecommendationSession,
): number {
  const used = new Set(session.shoppingCoverage?.usedQueryGroups ?? []);
  return Math.max(0, SHOPPING_QUERY_GROUPS.length - used.size);
}

export function remainingShoppingGroups(
  session: ConversationRecommendationSession,
): number {
  return remainingShoppingPages(session);
}

export function isShoppingQueryQueueExhausted(
  session: ConversationRecommendationSession,
): boolean {
  if (session.exhausted) return true;
  const reserve = session.shoppingCandidateReserve?.length ?? 0;
  if (reserve > 0) return false;
  const used = session.shoppingCoverage?.usedQueryGroups?.length ?? 0;
  return used >= SHOPPING_QUERY_GROUPS.length;
}

export function splitShoppingDisplayAndReserve(
  pool: RoamieRecommendationItem[],
  batchSize: number,
): {
  batch: RoamieRecommendationItem[];
  reserve: RoamieRecommendationItem[];
} {
  return {
    batch: pool.slice(0, batchSize),
    reserve: pool.slice(batchSize),
  };
}

function placeMatchesShoppingSubtype(
  place: RoamieRecommendationItem,
  subtype: ShoppingSubtype,
): boolean {
  if (subtype === "general") return true;
  const types = inferShoppingTypesFromPlace({
    name: place.name,
    placeName: place.placeName,
    types: (place as RoamieRecommendationItem & { types?: string[] }).types,
    type: place.type,
    address: place.address,
  });
  if (subtype === "department_store") return types.includes("department_store");
  if (subtype === "outlet") return types.includes("outlet");
  if (subtype === "underground_mall") return types.includes("underground_mall");
  if (subtype === "shopping_street") {
    return (
      types.includes("shopping_street") || types.includes("local_shopping_area")
    );
  }
  if (subtype === "market") {
    return types.includes("market") || types.includes("local_shopping_area");
  }
  if (subtype === "mall") {
    return (
      types.includes("shopping_mall") ||
      types.includes("station_mall") ||
      types.includes("retail_complex")
    );
  }
  return true;
}

/**
 * Consume shoppingCandidateReserve before Places API.
 * Always logs [SHOPPING_FOLLOWUP_RESERVE_USED], even when reserve is empty.
 */
export function takeShoppingReserveBatch(
  session: ConversationRecommendationSession,
  batchSize: number,
  opts?: { subtype?: ShoppingSubtype },
): {
  batch: RoamieRecommendationItem[];
  session: ConversationRecommendationSession;
  reserveBefore: number;
  taken: number;
  reserveAfter: number;
  reason: ShoppingReserveUsedReason;
} {
  const reserve = session.shoppingCandidateReserve ?? [];
  const reserveBefore = reserve.length;
  const subtype = opts?.subtype ?? "general";

  if (reserveBefore === 0) {
    logShoppingFollowupReserveUsed({
      reserveBefore: 0,
      taken: 0,
      reserveAfter: 0,
      reason: "empty_reserve",
    });
    return {
      batch: [],
      session,
      reserveBefore: 0,
      taken: 0,
      reserveAfter: 0,
      reason: "empty_reserve",
    };
  }

  const matched: RoamieRecommendationItem[] = [];
  const unmatched: RoamieRecommendationItem[] = [];
  for (const item of reserve) {
    if (matched.length < batchSize && placeMatchesShoppingSubtype(item, subtype)) {
      matched.push(item);
    } else {
      unmatched.push(item);
    }
  }

  if (matched.length === 0 && subtype !== "general") {
    logShoppingFollowupReserveUsed({
      reserveBefore,
      taken: 0,
      reserveAfter: reserveBefore,
      reason: "no_matching_subtype",
    });
    return {
      batch: [],
      session,
      reserveBefore,
      taken: 0,
      reserveAfter: reserveBefore,
      reason: "no_matching_subtype",
    };
  }

  const batch = matched;
  const rest = unmatched;
  const taken = batch.length;

  const returnedPlaceIds = [
    ...session.returnedPlaceIds,
    ...batch.map((p) => (p.googlePlaceId ?? "").trim()).filter(Boolean),
  ];
  const returnedCanonicalKeys = [
    ...(session.returnedCanonicalKeys ?? []),
    ...batch.map((p) => shoppingCanonicalKey(p)).filter(Boolean),
  ];
  const coverage = buildShoppingCoverageState({
    destination: session.destination,
    places: batch,
    existing: session.shoppingCoverage,
    destinationCountryCode: session.shoppingCoverage?.destinationCountryCode,
    destinationLanguage: session.shoppingCoverage?.destinationLanguage,
  });

  const next: ConversationRecommendationSession = {
    ...session,
    shoppingCandidateReserve: rest,
    returnedPlaceIds: [...new Set(returnedPlaceIds)],
    returnedCanonicalKeys: [...new Set(returnedCanonicalKeys)],
    shoppingCoverage: coverage,
    cursor: Math.max(session.cursor, (session.cursor ?? 0) + taken),
    exhausted: false,
    exhaustedAt: undefined,
    updatedAt: new Date().toISOString(),
  };

  logShoppingFollowupReserveUsed({
    reserveBefore,
    taken,
    reserveAfter: rest.length,
    reason: "used",
  });

  return {
    batch,
    session: next,
    reserveBefore,
    taken,
    reserveAfter: rest.length,
    reason: "used",
  };
}

/** Split full validated pool → display batch + reserve (never build reserve from displayed slice). */
export function buildShoppingDisplayAndReserveFromPool(
  validCandidates: RoamieRecommendationItem[],
  displayLimit = SHOPPING_DISPLAY_LIMIT,
): {
  displayed: RoamieRecommendationItem[];
  reserve: RoamieRecommendationItem[];
} {
  const { batch, reserve } = splitShoppingDisplayAndReserve(
    validCandidates,
    displayLimit,
  );
  logShoppingReserveCreated({
    validCount: validCandidates.length,
    displayedCount: batch.length,
    reserveCount: reserve.length,
    displayedPlaceIds: batch
      .map((p) => (p.googlePlaceId ?? "").trim())
      .filter(Boolean),
    reservePlaceIds: reserve
      .map((p) => (p.googlePlaceId ?? "").trim())
      .filter(Boolean),
  });
  return { displayed: batch, reserve };
}

export function logShoppingCoverageState(coverage: ShoppingCoverageState, reserveCount = 0): void {
  devVerboseInfo(
    "[SHOPPING_COVERAGE_STATE]",
    `coveredTypes=${coverage.coveredShoppingTypes.join(",")}`,
    `coveredClusters=${coverage.coveredClusters.join(",")}`,
    `seenPlaceCount=${coverage.seenPlaceIds.length}`,
    `reserveCount=${reserveCount}`,
  );
}

export function logShoppingFollowupGroupPlan(plan: ShoppingFollowupGroupPlan): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_GROUP_PLAN]",
    `availableGroups=${plan.availableGroups.join(",")}`,
    `selectedGroups=${plan.selectedGroups.join(",")}`,
    `reason=${plan.reason}`,
  );
}

export function logShoppingFollowupReserveUsed(params: {
  reserveBefore: number;
  taken: number;
  reserveAfter: number;
  reason?: ShoppingReserveUsedReason;
}): void {
  const reason =
    params.reason ??
    (params.reserveBefore === 0
      ? "empty_reserve"
      : params.taken > 0
        ? "used"
        : "empty_reserve");
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_RESERVE_USED]",
    `reserveBefore=${params.reserveBefore}`,
    `taken=${params.taken}`,
    `reserveAfter=${params.reserveAfter}`,
    `reason=${reason}`,
  );
}

export function logShoppingInitialSearchSummary(params: {
  rawCount: number;
  validatedCount: number;
  canonicalCount: number;
  displayTarget?: number;
  reserveTarget?: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_INITIAL_SEARCH_SUMMARY]",
    `rawCount=${params.rawCount}`,
    `validatedCount=${params.validatedCount}`,
    `canonicalCount=${params.canonicalCount}`,
    `displayTarget=${params.displayTarget ?? SHOPPING_DISPLAY_LIMIT}`,
    `reserveTarget=${params.reserveTarget ?? SHOPPING_INITIAL_RESERVE_TARGET}`,
  );
}

export function logShoppingInitialPool(params: {
  candidateCount: number;
  byType: Record<string, number> | string;
  byCluster: Record<string, number> | string;
}): void {
  const byType =
    typeof params.byType === "string"
      ? params.byType
      : Object.entries(params.byType)
          .map(([k, v]) => `${k}:${v}`)
          .join(",");
  const byCluster =
    typeof params.byCluster === "string"
      ? params.byCluster
      : Object.entries(params.byCluster)
          .map(([k, v]) => `${k}:${v}`)
          .join(",");
  devVerboseInfo(
    "[SHOPPING_INITIAL_POOL]",
    `candidateCount=${params.candidateCount}`,
    `byType=${byType}`,
    `byCluster=${byCluster}`,
  );
}

export function logShoppingReserveCreated(params: {
  validCount: number;
  displayedCount: number;
  reserveCount: number;
  displayedPlaceIds: string[];
  reservePlaceIds: string[];
}): void {
  devVerboseInfo(
    "[SHOPPING_RESERVE_CREATED]",
    `validCount=${params.validCount}`,
    `displayedCount=${params.displayedCount}`,
    `reserveCount=${params.reserveCount}`,
    `displayedPlaceIds=${params.displayedPlaceIds.join(",")}`,
    `reservePlaceIds=${params.reservePlaceIds.join(",")}`,
  );
}

export function logShoppingReservePersisted(params: {
  destinationKey: string;
  workspaceId?: string;
  reserveCount: number;
  storage: "memory" | "localStorage" | "sessionStorage" | "supabase";
}): void {
  devVerboseInfo(
    "[SHOPPING_RESERVE_PERSISTED]",
    `destinationKey=${params.destinationKey}`,
    `workspaceId=${params.workspaceId ?? ""}`,
    `reserveCount=${params.reserveCount}`,
    `storage=${params.storage}`,
  );
}

export function logShoppingReserveLoaded(params: {
  destinationKey: string;
  workspaceId?: string;
  found: boolean;
  reserveCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_RESERVE_LOADED]",
    `destinationKey=${params.destinationKey}`,
    `workspaceId=${params.workspaceId ?? ""}`,
    `found=${params.found}`,
    `reserveCount=${params.reserveCount}`,
  );
}

export function logShoppingFollowupNewCandidates(params: {
  rawCount: number;
  acceptedCount: number;
  newDisplayCount: number;
  newReserveCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_NEW_CANDIDATES]",
    `rawCount=${params.rawCount}`,
    `acceptedCount=${params.acceptedCount}`,
    `newDisplayCount=${params.newDisplayCount}`,
    `newReserveCount=${params.newReserveCount}`,
  );
}

export function logShoppingFollowupQueryAttempt(params: {
  callIndex: number;
  group: string;
  query: string;
  rawCount: number;
  acceptedCount: number;
  newCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_QUERY_ATTEMPT]",
    `callIndex=${params.callIndex}`,
    `group=${params.group}`,
    `query=${params.query}`,
    `rawCount=${params.rawCount}`,
    `acceptedCount=${params.acceptedCount}`,
    `newCount=${params.newCount}`,
  );
}

export function logShoppingFollowupGroupSwitch(params: {
  from: string;
  to: string;
  reason: string;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_GROUP_SWITCH]",
    `from=${params.from}`,
    `to=${params.to}`,
    `reason=${params.reason}`,
  );
}

export function logShoppingFollowupFilterSummary(params: {
  raw: number;
  rejectedDuplicate: number;
  rejectedWrongCategory: number;
  rejectedSameCanonical: number;
  acceptedNew: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_FILTER_SUMMARY]",
    `raw=${params.raw}`,
    `rejectedDuplicate=${params.rejectedDuplicate}`,
    `rejectedWrongCategory=${params.rejectedWrongCategory}`,
    `rejectedSameCanonical=${params.rejectedSameCanonical}`,
    `acceptedNew=${params.acceptedNew}`,
  );
}

export function logShoppingSessionState(session: ConversationRecommendationSession): void {
  devVerboseInfo(
    "[SHOPPING_SESSION_STATE]",
    `shoppingSessionId=${session.sessionId}`,
    `destination=${session.destination}`,
    `activeSearchCity=${session.activeSearchCity ?? ""}`,
    `intent=${session.topic}`,
    `page=${session.recommendationPage ?? 0}`,
    `returnedCount=${session.returnedPlaceIds.length}`,
    `queryCursor=${session.nextQueryCursor ?? 0}`,
    `geoClusterIndex=${session.geoClusterIndex ?? 0}`,
    `searchRadius=${session.searchRadius ?? ""}`,
    `reserveCount=${session.shoppingCandidateReserve?.length ?? 0}`,
    `coveredTypes=${session.shoppingCoverage?.coveredShoppingTypes?.join(",") ?? ""}`,
    `exhausted=${Boolean(session.exhausted)}`,
  );
}

export function logShoppingFollowupRequest(params: {
  requestId: string;
  shoppingSessionId: string;
  destination: string;
  seenPlaceCount: number;
  remainingGroupCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_REQUEST]",
    `requestId=${params.requestId}`,
    `shoppingSessionId=${params.shoppingSessionId}`,
    `destination=${params.destination}`,
    `seenPlaceCount=${params.seenPlaceCount}`,
    `remainingGroupCount=${params.remainingGroupCount}`,
  );
}

export function logShoppingFollowupBudget(budget: FollowUpSearchBudget): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_BUDGET]",
    `maxNetworkCalls=${budget.maxNetworkCalls}`,
    `usedNetworkCalls=${budget.usedNetworkCalls}`,
    `maxQueries=${budget.maxQueries}`,
    `usedQueries=${budget.usedQueries.join(" | ")}`,
    `targetNewResults=${budget.targetNewResults}`,
  );
}

export function logShoppingQueryGroupStart(params: {
  group: string;
  queries: string[];
  requestId: string;
}): void {
  devVerboseInfo(
    "[SHOPPING_QUERY_GROUP_START]",
    `group=${params.group}`,
    `queries=${params.queries.join(" | ")}`,
    `requestId=${params.requestId}`,
  );
}

export function logShoppingQuerySkipped(params: {
  query: string;
  reason: string;
}): void {
  devVerboseInfo(
    "[SHOPPING_QUERY_SKIPPED]",
    `query=${params.query}`,
    `reason=${params.reason}`,
  );
}

export function logShoppingFollowupEarlyStop(params: {
  reason: string;
  newCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_EARLY_STOP]",
    `reason=${params.reason}`,
    `newCount=${params.newCount}`,
  );
}

export function logShoppingFollowupRateLimited(params: {
  requestId: string;
  usedNetworkCalls: number;
  partialNewCount: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_RATE_LIMITED]",
    `requestId=${params.requestId}`,
    `usedNetworkCalls=${params.usedNetworkCalls}`,
    `partialNewCount=${params.partialNewCount}`,
  );
}

export function logShoppingFollowupSearchStart(params: {
  destination: string;
  activeSearchCity?: string;
  queries: string[];
  excludedPlaceIds: string[];
  excludedCanonicalKeys: string[];
  lat?: number;
  lng?: number;
  radius?: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_SEARCH_START]",
    `destination=${params.destination}`,
    `activeSearchCity=${params.activeSearchCity ?? params.destination}`,
    `queries=${params.queries.join(" | ")}`,
    `excludedPlaceIds=${params.excludedPlaceIds.length}`,
    `excludedCanonicalKeys=${params.excludedCanonicalKeys.length}`,
    `lat=${params.lat ?? ""}`,
    `lng=${params.lng ?? ""}`,
    `radius=${params.radius ?? ""}`,
  );
}

export function logShoppingQueryResult(params: {
  query: string;
  raw: number;
  categoryAccepted: number;
  categoryRejected?: number;
  duplicateRejected: number;
  invalidRejected: number;
  newAccepted?: number;
  networkCall?: number;
}): void {
  const categoryRejected =
    params.categoryRejected ??
    Math.max(
      0,
      params.raw -
        params.categoryAccepted -
        params.duplicateRejected -
        params.invalidRejected,
    );
  devVerboseInfo(
    "[SHOPPING_QUERY_RESULT]",
    `query=${params.query}`,
    `raw=${params.raw}`,
    `categoryAccepted=${params.categoryAccepted}`,
    `categoryRejected=${categoryRejected}`,
    `duplicateRejected=${params.duplicateRejected}`,
    `invalidRejected=${params.invalidRejected}`,
    `newAccepted=${params.newAccepted ?? ""}`,
    `networkCall=${params.networkCall ?? ""}`,
  );
}

export function logShoppingQueryDiag(params: {
  query: string;
  city: string;
  lat: number;
  lng: number;
  radius: number;
  requestStatus: string;
  rawCount: number;
  acceptedCount: number;
  rejectedCategory: number;
  rejectedDuplicate: number;
  rejectedInvalid: number;
}): void {
  devVerboseInfo(
    "[SHOPPING_QUERY_DIAG]",
    `query=${params.query}`,
    `city=${params.city}`,
    `lat=${params.lat.toFixed(4)}`,
    `lng=${params.lng.toFixed(4)}`,
    `radius=${params.radius}`,
    `requestStatus=${params.requestStatus}`,
    `rawCount=${params.rawCount}`,
    `acceptedCount=${params.acceptedCount}`,
    `rejectedCategory=${params.rejectedCategory}`,
    `rejectedDuplicate=${params.rejectedDuplicate}`,
    `rejectedInvalid=${params.rejectedInvalid}`,
  );
}

export function logShoppingFollowupFinal(params: {
  requestId?: string;
  newCount: number;
  displayCount?: number;
  usedNetworkCalls?: number;
  queriesUsed: string[];
  remainingQueries: number;
  remainingGroupCount?: number;
  exhausted: boolean;
  status?: FollowUpSearchStatus | "reserve_success" | "search_success";
  activeSearchCity?: string;
  reserveUsed?: number;
  reserveRemaining?: number;
  groupsUsed?: string[];
}): void {
  const status =
    params.status ?? (params.exhausted ? "exhausted" : "success");
  devVerboseInfo(
    "[SHOPPING_FOLLOWUP_FINAL]",
    `requestId=${params.requestId ?? ""}`,
    `newCount=${params.newCount}`,
    `displayCount=${params.displayCount ?? params.newCount}`,
    `reserveUsed=${params.reserveUsed ?? 0}`,
    `reserveRemaining=${params.reserveRemaining ?? ""}`,
    `networkCalls=${params.usedNetworkCalls ?? ""}`,
    `groupsUsed=${(params.groupsUsed ?? []).join(",")}`,
    `usedNetworkCalls=${params.usedNetworkCalls ?? ""}`,
    `activeSearchCity=${params.activeSearchCity ?? ""}`,
    `usedQueries=${params.queriesUsed.join(" | ")}`,
    `remainingQueries=${params.remainingQueries}`,
    `remainingGroupCount=${params.remainingGroupCount ?? params.remainingQueries}`,
    `exhausted=${params.exhausted}`,
    `status=${status}`,
  );
}

export function logShoppingCategoryRejected(params: {
  name: string;
  primaryType?: string | null;
  normalizedCategory?: string | null;
  reason: string;
}): void {
  devVerboseInfo(
    "[SHOPPING_CATEGORY_REJECTED]",
    `name=${params.name}`,
    `primaryType=${params.primaryType ?? ""}`,
    `normalizedCategory=${params.normalizedCategory ?? ""}`,
    `reason=${params.reason}`,
  );
}

export function logChatLoadingFinalized(params: {
  requestId: string;
  reason: string;
}): void {
  devVerboseInfo(
    "[CHAT_LOADING_FINALIZED]",
    `requestId=${params.requestId}`,
    `reason=${params.reason}`,
  );
}

/** Resolve search city for initial shopping ask. */
export function resolveInitialShoppingCity(destination: string): string {
  return resolveShoppingSearchScope({ destination }).activeSearchCity;
}

/**
 * Initial shopping groups for oversample (cross-type pool for reserve).
 * A street → B department → C underground → D mall → E market/specialty.
 * One query per group (max SHOPPING_INITIAL_MAX_NETWORK_CALLS).
 */
const INITIAL_SHOPPING_GROUP_ORDER: ShoppingQueryGroupId[] = [
  "shopping_street",
  "department_store",
  "underground_mall",
  "shopping_mall_complex",
  "local_market",
];

/** Initial shopping search — multi-group oversample for display(4) + reserve(≥4). */
export function buildInitialShoppingSearchAttempts(
  destination: string,
  userText = "",
  activeSearchCity?: string,
  destinationCountryCode?: string,
): {
  primary: SearchAttempt[];
  fallback: SearchAttempt[];
  usedQueries: string[];
  nextQueryCursor: number;
  activeSearchCity: string;
  group: ShoppingQueryGroup;
  groups: ShoppingQueryGroup[];
  locale: ShoppingQueryLocale;
} {
  const city =
    activeSearchCity?.trim() || resolveInitialShoppingCity(destination);
  const subtype = detectShoppingSubtype(userText);
  const locale = resolveShoppingQueryLocale({
    countryCode: destinationCountryCode,
    city,
  });

  // Refinement (百貨 / 地下街 / …): pin that group first, then fill pool from others.
  const pinned = groupForSubtype(subtype);
  const orderedIds = pinned
    ? [
        pinned.id,
        ...INITIAL_SHOPPING_GROUP_ORDER.filter((id) => id !== pinned.id),
      ]
    : INITIAL_SHOPPING_GROUP_ORDER;

  const groups: ShoppingQueryGroup[] = [];
  const primary: SearchAttempt[] = [];
  const usedQueries: string[] = [];
  const usedQuerySet = new Set<string>();

  for (const groupId of orderedIds) {
    if (groups.length >= SHOPPING_INITIAL_MAX_NETWORK_CALLS) break;
    const group = SHOPPING_QUERY_GROUPS.find((g) => g.id === groupId);
    if (!group) continue;
    const query = pickUnusedQuery(group, city, locale, usedQuerySet);
    if (!query) continue;
    usedQuerySet.add(query);
    usedQueries.push(query);
    groups.push(group);
    primary.push({
      query,
      mode: "text",
      includedTypes: [...group.includedTypes],
    });
  }

  // Keep a short fallback list for searchCategoryPlaces budgeted top-up.
  const fallback = primary.slice(2);
  const primaryOnly = primary.slice(0, 2);
  const leadGroup = groups[0] ?? SHOPPING_QUERY_GROUPS[0]!;

  return {
    primary: primaryOnly.length ? primaryOnly : primary,
    fallback: fallback.length ? fallback : primary.slice(0, 1),
    usedQueries,
    nextQueryCursor: 0,
    activeSearchCity: city,
    group: leadGroup,
    groups,
    locale,
  };
}

/** All initial oversample attempts (primary + fallback groups) in order. */
export function flattenInitialShoppingAttempts(seeded: {
  primary: SearchAttempt[];
  fallback: SearchAttempt[];
}): SearchAttempt[] {
  const seen = new Set<string>();
  const out: SearchAttempt[] = [];
  for (const attempt of [...seeded.primary, ...seeded.fallback]) {
    const q = attempt.query.trim();
    if (!q || seen.has(q)) continue;
    seen.add(q);
    out.push(attempt);
  }
  return out;
}

/**
 * Next unused shopping follow-up call(s) — one query per distinct group.
 * Kept for verify / callers that expect the previous API shape.
 */
export function takeNextShoppingFollowupAttempts(params: {
  destination: string;
  session: ConversationRecommendationSession;
  userText?: string;
  radius?: number;
  activeSearchCity?: string;
  skipQueries?: string[];
}): {
  attempts: SearchAttempt[];
  queries: string[];
  nextQueryCursor: number;
  recommendationPage: number;
  exhausted: boolean;
  activeSearchCity: string;
  group: ShoppingQueryGroup;
  plan: ShoppingFollowupGroupPlan;
} | null {
  const coverage =
    params.session.shoppingCoverage ??
    buildShoppingCoverageState({
      destination: params.destination,
      places: params.session.pool ?? [],
      usedQueryGroups: [],
    });
  const subtype = detectShoppingSubtype(params.userText ?? "");
  const { calls, plan, activeSearchCity } = buildShoppingFollowupCalls({
    destination: params.destination,
    activeSearchCity:
      params.activeSearchCity ?? params.session.activeSearchCity,
    coverage,
    subtype,
    radius: params.radius,
    skipQueries: [
      ...(params.session.usedQueries ?? []),
      ...(params.skipQueries ?? []),
    ],
    maxCalls: 1,
  });
  if (!calls.length) return null;
  const call = calls[0]!;
  const recommendationPage = (params.session.recommendationPage ?? 0) + 1;
  const usedGroups = new Set(coverage.usedQueryGroups);
  usedGroups.add(call.group.id);
  return {
    attempts: [call.attempt],
    queries: [call.query],
    nextQueryCursor: usedGroups.size,
    recommendationPage,
    exhausted: false,
    activeSearchCity,
    group: call.group,
    plan,
  };
}

export function scopeFromRecommendationSession(
  session: ConversationRecommendationSession,
): ShoppingSearchScope {
  return resolveShoppingSearchScope({
    destination: session.destination,
    existingScope: {
      activeSearchCity: session.activeSearchCity,
      searchCentroid: session.searchCentroid,
      searchRadius: session.searchRadius,
      searchRegionLabel: session.searchRegionLabel,
      geoClusterIndex: session.geoClusterIndex,
      primaryDestination: session.destination,
    },
  });
}

export function makeShoppingFollowupRequestId(shoppingSessionId: string): string {
  return `shopping_followup_${shoppingSessionId}_${Date.now().toString(36)}`;
}
