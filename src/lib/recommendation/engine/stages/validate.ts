/**
 * Recommendation Validator（pipeline `validate` stage）— Priority 2 / P4.1
 *
 * 對「已排序的推薦候選」做品質閘門；**不重排、不重算分數、不組裝行程、不補搜**。
 * 與 Itinerary Validator（行程組裝後）分層。
 *
 * Flag OFF（預設）→ pass-through
 * Flag ON → 規則閘門 + 過濾後覆蓋／數量檢查；不足則 recommendationInsufficient
 */

import {
  classifyPoolCategory,
  classifyTemporalSlots,
  classifyTravelIntent,
} from "@/lib/ai/candidate-pool/classify";
import { resolveCanonicalLandmarkKey } from "@/lib/ai/canonical-landmark";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { placeMatchesExcludedCategories } from "@/lib/ai/recommendation-exclusion";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import type { PlaceResult } from "@/lib/place-result";
import { isRecEngineValidatorEnabled } from "@/lib/recommendation/engine/feature-flag-validator";
import type {
  RecommendationCandidate,
  RecommendationContext,
  RecommendationResult,
  ScoredCandidate,
} from "@/lib/recommendation/engine/types";

export type RecommendationValidationRejectReason =
  | "missing_place_id"
  | "missing_name"
  | "closed_permanently"
  | "burial_or_funeral"
  | "excluded_retail"
  | "excluded_lodging"
  | "excluded_office"
  | "excluded_residential"
  | "excluded_transit"
  | "excluded_parking"
  | "excluded_shopping_mall"
  | "excluded_market"
  | "excluded_park"
  | "excluded_bar"
  | "excluded_by_context"
  | "duplicate_place_id"
  | "duplicate_canonical"
  | "low_quality"
  | "non_place_type";

export type RecommendationValidationResult = {
  accepted: boolean;
  placeId?: string;
  canonicalLandmarkKey?: string;
  failedRules: string[];
  warnings: string[];
};

export type RecommendationValidationSummary = {
  pass: boolean;
  requiredCount: number;
  inputCount: number;
  acceptedCount: number;
  rejectedCount: number;
  recommendationInsufficient: boolean;
  failedRuleCounts: Record<string, number>;
  acceptedCandidates: RecommendationResult[];
  rejectedCandidates: RecommendationValidationResult[];
  /** 診斷：覆蓋前後 */
  categoryBefore: Record<string, number>;
  categoryAfter: Record<string, number>;
  clusterBefore: number;
  clusterAfter: number;
  canonicalBefore: number;
  canonicalAfter: number;
  temporalBefore: Record<string, number>;
  temporalAfter: Record<string, number>;
  flowBefore: Record<string, number>;
  flowAfter: Record<string, number>;
  affectedKinds: string[];
  affectedClusters: string[];
  missingCount: number;
  availableCount: number;
  path: "pass_through" | "recommendation_validator";
};

/** @deprecated 使用 RecommendationValidationSummary.failedRuleCounts */
export type RecommendationValidationStats = {
  input: number;
  passed: number;
  rejected: number;
  byReason: Partial<Record<RecommendationValidationRejectReason, number>>;
  path: "pass_through" | "validator";
  recommendationInsufficient?: boolean;
  requiredCount?: number;
};

const CLOSED_NAME_RE =
  /永久停業|永久歇業|已歇業|已停業|closed permanently|permanently closed|closed down|廢業|不再營業|結束營業/i;

const HARD_RETAIL_TYPES = new Set([
  "supermarket",
  "hypermarket",
  "grocery_store",
  "grocery_or_supermarket",
  "convenience_store",
  "warehouse_store",
  "wholesale_store",
]);

const LODGING_TYPES = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "resort_hotel",
  "extended_stay_hotel",
  "bed_and_breakfast",
]);

const OFFICE_TYPES = new Set([
  "corporate_office",
  "local_government_office",
  "accounting",
  "lawyer",
  "real_estate_agency",
  "insurance_agency",
  "finance",
  "bank",
  "atm",
]);

const TRANSIT_TYPES = new Set([
  "transit_station",
  "train_station",
  "subway_station",
  "bus_station",
  "bus_stop",
  "light_rail_station",
  "airport",
]);

const PARKING_TYPES = new Set(["parking", "parking_garage", "parking_lot"]);

const RESIDENTIAL_ONLY_TYPES = new Set([
  "street_address",
  "route",
  "intersection",
  "plus_code",
  "neighborhood",
  "political",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "postal_code",
  "floor",
  "room",
  "subpremise",
]);

const TRAVEL_EXCEPTION_TYPES = new Set([
  "tourist_attraction",
  "museum",
  "art_gallery",
  "park",
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "night_club",
  "shopping_mall",
  "department_store",
  "market",
  "lodging",
  "hotel",
  "church",
  "hindu_temple",
  "place_of_worship",
  "aquarium",
  "zoo",
  "amusement_park",
]);

const HARD_RETAIL_NAME_RE =
  /超市|量販|量販店|大賣場|生鮮超市|全聯|px\s*mart|家樂福|costco|carrefour|大潤發|愛買|hypermarket|convenience\s*store|便利商店|7[\-\s]?eleven|familymart|family\s*mart|萊爾富/i;

const LODGING_NAME_RE =
  /飯店|酒店|旅館|民宿|hostel|hotel|motel|resort|住宿|膠囊旅店|青旅/i;

const OFFICE_NAME_RE =
  /辦公|办公|office\s*building|corporate\s*office|市政府|區公所|行政中心/i;

const RESIDENTIAL_NAME_RE =
  /住宅|公寓|community\s*center|私人住宅|private\s*residence|宿舍|大樓住戶/i;

const TRANSIT_NAME_RE =
  /車站|火车站|地鐵站|地铁站|巴士站|公車站|機場航廈|train\s*station|subway\s*station|bus\s*station/i;

const PARKING_NAME_RE = /停車場|停车场|parking\s*(lot|garage)?/i;

const CHAIN_WARN_RE =
  /麥當勞|肯德基|摩斯|subway|漢堡王|starbucks|星巴克|路易莎|7[\-\s]?eleven|familymart|全家/i;

let lastSummary: RecommendationValidationSummary = emptySummary("pass_through");

function emptySummary(
  path: RecommendationValidationSummary["path"],
): RecommendationValidationSummary {
  return {
    pass: true,
    requiredCount: 0,
    inputCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    recommendationInsufficient: false,
    failedRuleCounts: {},
    acceptedCandidates: [],
    rejectedCandidates: [],
    categoryBefore: {},
    categoryAfter: {},
    clusterBefore: 0,
    clusterAfter: 0,
    canonicalBefore: 0,
    canonicalAfter: 0,
    temporalBefore: {},
    temporalAfter: {},
    flowBefore: {},
    flowAfter: {},
    affectedKinds: [],
    affectedClusters: [],
    missingCount: 0,
    availableCount: 0,
    path,
  };
}

export function getLastRecommendationValidationSummary(): Readonly<RecommendationValidationSummary> {
  return {
    ...lastSummary,
    failedRuleCounts: { ...lastSummary.failedRuleCounts },
    acceptedCandidates: [...lastSummary.acceptedCandidates],
    rejectedCandidates: lastSummary.rejectedCandidates.map((r) => ({
      ...r,
      failedRules: [...r.failedRules],
      warnings: [...r.warnings],
    })),
    categoryBefore: { ...lastSummary.categoryBefore },
    categoryAfter: { ...lastSummary.categoryAfter },
    temporalBefore: { ...lastSummary.temporalBefore },
    temporalAfter: { ...lastSummary.temporalAfter },
    flowBefore: { ...lastSummary.flowBefore },
    flowAfter: { ...lastSummary.flowAfter },
    affectedKinds: [...lastSummary.affectedKinds],
    affectedClusters: [...lastSummary.affectedClusters],
  };
}

/** @deprecated 使用 getLastRecommendationValidationSummary */
export function getLastRecommendationValidationStats(): Readonly<RecommendationValidationStats> {
  const s = lastSummary;
  const byReason: Partial<Record<RecommendationValidationRejectReason, number>> = {};
  for (const [k, n] of Object.entries(s.failedRuleCounts)) {
    byReason[k as RecommendationValidationRejectReason] = n;
  }
  return {
    input: s.inputCount,
    passed: s.acceptedCount,
    rejected: s.rejectedCount,
    byReason,
    path: s.path === "recommendation_validator" ? "validator" : "pass_through",
    recommendationInsufficient: s.recommendationInsufficient,
    requiredCount: s.requiredCount,
  };
}

export function resetRecommendationValidationStats(): void {
  lastSummary = emptySummary("pass_through");
}

function bump(
  counts: Record<string, number>,
  key: string,
): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function toResult(item: ScoredCandidate): RecommendationResult {
  const scoreBreakdown = item.scoreBreakdown ?? item.breakdown ?? {};
  return {
    placeId: item.candidate.placeId,
    score: item.score,
    reasons: item.reasons,
    scoreBreakdown,
    breakdown: scoreBreakdown,
    candidate: item.candidate,
    profileId: item.profileId,
  };
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function collectTypes(candidate: RecommendationCandidate): Set<string> {
  const out = new Set<string>();
  const primary = (candidate.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of candidate.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return out;
}

function candidateBlob(candidate: RecommendationCandidate): string {
  return [candidate.name, candidate.primaryType, ...(candidate.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function asPlaceResult(candidate: RecommendationCandidate): PlaceResult {
  const raw = candidate.raw as PlaceResult | undefined;
  if (raw && typeof raw === "object" && "id" in raw) return raw;
  return {
    id: candidate.placeId,
    name: candidate.name,
    lat: candidate.lat,
    lng: candidate.lng,
    rating: candidate.rating,
    userRatingCount: candidate.userRatingCount,
    primaryType: candidate.primaryType,
    types: candidate.types ?? undefined,
    openStatus: candidate.openStatus,
    openNow: candidate.openNow,
  };
}

function readBusinessStatus(candidate: RecommendationCandidate): string {
  const raw = candidate.raw as { businessStatus?: string | null } | undefined;
  return (raw?.businessStatus ?? "").trim().toUpperCase();
}

function readStyle(ctx?: RecommendationContext): TripStyleKey | undefined {
  const fromOpts = ctx?.surfaceOptions?.style;
  if (typeof fromOpts === "string" && fromOpts) return fromOpts as TripStyleKey;
  const scoring = ctx?.surfaceOptions?.scoringInput as { style?: TripStyleKey } | undefined;
  return scoring?.style;
}

function readUserText(ctx?: RecommendationContext): string {
  const fromOpts = ctx?.surfaceOptions?.userText;
  if (typeof fromOpts === "string") return fromOpts;
  const scoring = ctx?.surfaceOptions?.scoringInput as
    | { context?: { rawUserText?: string; userText?: string } }
    | undefined;
  return (
    scoring?.context?.rawUserText ??
    scoring?.context?.userText ??
    ""
  ).trim();
}

function readExcludedKeywords(ctx?: RecommendationContext): string[] {
  const out = new Set<string>();
  for (const n of ctx?.exclusions?.names ?? []) {
    if (n.trim()) out.add(n.trim());
  }
  for (const n of ctx?.exclusions?.rejectedNames ?? []) {
    if (n.trim()) out.add(n.trim());
  }
  const fromOpts = ctx?.surfaceOptions?.excludedCategories;
  if (Array.isArray(fromOpts)) {
    for (const n of fromOpts) {
      if (typeof n === "string" && n.trim()) out.add(n.trim());
    }
  }
  const scoring = ctx?.surfaceOptions?.scoringInput as
    | { context?: { excludedCategories?: string[] } }
    | undefined;
  for (const n of scoring?.context?.excludedCategories ?? []) {
    if (n.trim()) out.add(n.trim());
  }
  return [...out];
}

function readRequiredCount(ctx?: RecommendationContext): number {
  const raw = ctx?.surfaceOptions?.requiredCount;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const scoring = ctx?.surfaceOptions?.scoringInput as { days?: number; pace?: string } | undefined;
  const days = scoring?.days;
  if (typeof days === "number" && days > 0) {
    const pace = scoring?.pace;
    return pace === "slow" ? days * 2 : days * 3;
  }
  return 0;
}

type IntentFlags = {
  shopping: boolean;
  nightlife: boolean;
  nature: boolean;
  lodging: boolean;
  localLife: boolean;
};

function resolveIntentFlags(ctx?: RecommendationContext): IntentFlags {
  const style = readStyle(ctx);
  const hint = (ctx?.categoryHint ?? "").trim().toLowerCase();
  const userText = readUserText(ctx);
  const text = `${hint} ${userText}`.toLowerCase();
  const shopping =
    style === "local_life" ||
    hint === "shopping" ||
    /購物|逛街|商場|shopping|mall|百貨|outlet/.test(text);
  const nightlife =
    hint === "night" ||
    /夜生活|nightlife|酒吧|居酒屋|夜市|bar|pub|club/.test(text);
  const nature =
    style === "slow_nature" ||
    hint === "nature" ||
    /自然|散步|公園|步道|綠地|nature|park|walk/.test(text);
  const lodging =
    ctx?.surfaceOptions?.explicitLodgingSearch === true ||
    /住宿|飯店|酒店|旅館|民宿|hotel|hostel|lodging|where\s*to\s*stay/.test(text);
  const localLife = style === "local_life" || style === "mixed";
  return { shopping, nightlife, nature, lodging, localLife };
}

function isHardRetail(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if ([...types].some((t) => HARD_RETAIL_TYPES.has(t))) return true;
  return HARD_RETAIL_NAME_RE.test(candidateBlob(candidate));
}

function isLodging(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if ([...types].some((t) => LODGING_TYPES.has(t))) return true;
  // lodging name alone only if no strong travel type
  if (LODGING_NAME_RE.test(candidate.name ?? "")) {
    if (![...types].some((t) => TRAVEL_EXCEPTION_TYPES.has(t) && !LODGING_TYPES.has(t))) {
      return true;
    }
  }
  return false;
}

function isOffice(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if ([...types].some((t) => OFFICE_TYPES.has(t))) return true;
  if (OFFICE_NAME_RE.test(candidateBlob(candidate))) {
    return ![...types].some((t) => TRAVEL_EXCEPTION_TYPES.has(t));
  }
  return false;
}

function isResidential(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  const meaningful = [...types].filter((t) => !RESIDENTIAL_ONLY_TYPES.has(t) && t !== "premise");
  if (types.size > 0 && meaningful.length === 0) return true;
  if (types.has("premise") && meaningful.length === 0) return true;
  return RESIDENTIAL_NAME_RE.test(candidateBlob(candidate));
}

function isTransitFacility(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  // station that is also a tourist attraction (e.g. 東京駅) may keep attraction tag —
  // still reject pure transit-only entities.
  if ([...types].some((t) => TRANSIT_TYPES.has(t))) {
    const hasTravel = [...types].some(
      (t) => TRAVEL_EXCEPTION_TYPES.has(t) && t !== "lodging" && t !== "hotel",
    );
    if (!hasTravel) return true;
  }
  if (TRANSIT_NAME_RE.test(candidate.name ?? "")) {
    return ![...types].some((t) => TRAVEL_EXCEPTION_TYPES.has(t));
  }
  return false;
}

function isParkingFacility(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if ([...types].some((t) => PARKING_TYPES.has(t))) return true;
  return PARKING_NAME_RE.test(candidateBlob(candidate));
}

function isShoppingMall(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if (types.has("shopping_mall") || types.has("department_store")) return true;
  return /購物中心|商場|百貨|outlet|\bmall\b/i.test(candidateBlob(candidate));
}

function isMarketPlace(candidate: RecommendationCandidate): boolean {
  const blob = candidateBlob(candidate);
  if (/夜市|night\s*market/i.test(blob)) return false;
  const types = collectTypes(candidate);
  if (types.has("market")) return true;
  return /市場|market/i.test(blob);
}

function isNightMarket(candidate: RecommendationCandidate): boolean {
  return /夜市|night\s*market/i.test(candidateBlob(candidate));
}

function isParkPlace(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if (types.has("park") || types.has("natural_feature")) return true;
  return /公園|\bpark\b/i.test(candidate.name ?? "");
}

function isBarPlace(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if (types.has("bar") || types.has("night_club")) return true;
  return /酒吧|居酒屋|bar|pub|lounge/i.test(candidateBlob(candidate));
}

function isExcludedByContext(
  candidate: RecommendationCandidate,
  ctx?: RecommendationContext,
): boolean {
  const exclusions = ctx?.exclusions;
  const placeId = candidate.placeId.trim();
  if (placeId && exclusions?.placeIds.some((id) => id === placeId)) return true;

  const nameKey = normalizeKey(candidate.name);
  if (nameKey) {
    for (const n of exclusions?.names ?? []) {
      if (normalizeKey(n) === nameKey) return true;
    }
    for (const n of exclusions?.rejectedNames ?? []) {
      if (normalizeKey(n) === nameKey) return true;
    }
  }

  const keywords = readExcludedKeywords(ctx);
  if (!keywords.length) return false;
  return placeMatchesExcludedCategories(
    {
      name: candidate.name,
      primaryType: candidate.primaryType,
      types: candidate.types,
    },
    keywords,
  );
}

function isLowQuality(candidate: RecommendationCandidate): boolean {
  const rating = candidate.rating;
  const reviews = candidate.userRatingCount ?? 0;
  if (rating != null && rating < 2.5 && reviews < 3) return true;
  return false;
}

function isNonPlaceType(candidate: RecommendationCandidate): boolean {
  const types = collectTypes(candidate);
  if (types.size === 0) return false;
  if ([...types].some((t) => TRAVEL_EXCEPTION_TYPES.has(t))) return false;
  // pure geo / admin — premise without travel exception already caught as residential
  return [...types].every((t) => RESIDENTIAL_ONLY_TYPES.has(t) || t === "premise");
}

function evaluateCandidate(
  candidate: RecommendationCandidate,
  ctx: RecommendationContext | undefined,
  intents: IntentFlags,
  seenIds: Set<string>,
  seenCanonical: Set<string>,
): RecommendationValidationResult {
  const place = asPlaceResult(candidate);
  const placeId = candidate.placeId?.trim() ?? "";
  const name = candidate.name?.trim() ?? "";
  const canonicalLandmarkKey = resolveCanonicalLandmarkKey(place);
  const failedRules: string[] = [];
  const warnings: string[] = [];

  if (!placeId) failedRules.push("missing_place_id");
  if (!name) failedRules.push("missing_name");

  if (placeId && seenIds.has(placeId)) failedRules.push("duplicate_place_id");
  if (canonicalLandmarkKey && seenCanonical.has(canonicalLandmarkKey)) {
    failedRules.push("duplicate_canonical");
  }

  const biz = readBusinessStatus(candidate);
  if (biz === "CLOSED_PERMANENTLY" || CLOSED_NAME_RE.test(name)) {
    failedRules.push("closed_permanently");
  }

  if (
    isBurialOrFuneralPlace({
      name: candidate.name,
      primaryType: candidate.primaryType,
      types: candidate.types,
    })
  ) {
    failedRules.push("burial_or_funeral");
  }

  // Hard retail — never relax for shopping hint
  if (isHardRetail(candidate)) failedRules.push("excluded_retail");

  if (isLodging(candidate) && !intents.lodging) failedRules.push("excluded_lodging");
  if (isOffice(candidate)) failedRules.push("excluded_office");
  if (isResidential(candidate)) failedRules.push("excluded_residential");
  if (isTransitFacility(candidate)) failedRules.push("excluded_transit");
  if (isParkingFacility(candidate)) failedRules.push("excluded_parking");

  // Conditional retention
  if (isShoppingMall(candidate) && !isHardRetail(candidate)) {
    if (!intents.shopping && !intents.localLife) {
      failedRules.push("excluded_shopping_mall");
    }
  }

  if (isMarketPlace(candidate) && !isNightMarket(candidate) && !isHardRetail(candidate)) {
    if (!intents.shopping && !intents.localLife) {
      failedRules.push("excluded_market");
    }
  }

  if (isNightMarket(candidate) && !intents.nightlife && !intents.localLife && !intents.shopping) {
    // night markets are commonly kept for local_life / shopping / nightlife;
    // for classic-only without those intents, still allow (conditional retain — do not hard-delete)
    warnings.push("night_market_kept");
  }

  if (isParkPlace(candidate)) {
    const keywords = readExcludedKeywords(ctx).map((k) => k.toLowerCase());
    if (keywords.some((k) => k.includes("公園") || k === "park" || k.includes("outdoor"))) {
      failedRules.push("excluded_park");
    } else if (!intents.nature && readStyle(ctx) === "classic_landmarks") {
      warnings.push("park_kept_for_general");
    }
  }

  if (isBarPlace(candidate)) {
    if (!intents.nightlife && !intents.localLife) {
      // conditional: do not hard-delete; warn only unless exclusion says so
      warnings.push("bar_kept_pending_schedule");
    }
  }

  if (CHAIN_WARN_RE.test(candidateBlob(candidate))) {
    warnings.push("chain_store");
  }

  if (isExcludedByContext(candidate, ctx)) failedRules.push("excluded_by_context");
  if (isNonPlaceType(candidate)) failedRules.push("non_place_type");
  if (isLowQuality(candidate)) failedRules.push("low_quality");

  return {
    accepted: failedRules.length === 0,
    placeId: placeId || undefined,
    canonicalLandmarkKey,
    failedRules,
    warnings,
  };
}

function coverageMaps(candidates: RecommendationCandidate[]): {
  category: Record<string, number>;
  temporal: Record<string, number>;
  flow: Record<string, number>;
  clusters: Set<string>;
  canonical: Set<string>;
} {
  const category: Record<string, number> = {};
  const temporal: Record<string, number> = {};
  const flow: Record<string, number> = {};
  const clusters = new Set<string>();
  const canonical = new Set<string>();

  for (const c of candidates) {
    const place = asPlaceResult(c);
    const cat = classifyPoolCategory(place);
    bump(category, cat);
    for (const slot of classifyTemporalSlots(place)) bump(temporal, slot);
    bump(flow, classifyTravelIntent(place));
    canonical.add(resolveCanonicalLandmarkKey(place));
    if (place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
      // coarse geo bucket for coverage compare (not a full density re-cluster)
      const bucket = `${Math.round(place.lat * 100) / 100},${Math.round(place.lng * 100) / 100}`;
      clusters.add(bucket);
    }
  }

  return { category, temporal, flow, clusters, canonical };
}

function formatCountMap(map: Record<string, number>): string {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "none";
  return entries.map(([k, n]) => `${k}:${n}`).join("|");
}

function logValidatorLine(tag: string, parts: Array<string | number | boolean>): void {
  logAiPipeline(tag, ...parts.map(String));
}

/**
 * Recommendation Validator 詳細入口（結構化 Summary）。
 */
export function validateRecommendationsDetailed(
  ranked: readonly ScoredCandidate[],
  ctx?: RecommendationContext,
): RecommendationValidationSummary {
  if (!isRecEngineValidatorEnabled()) {
    const accepted = ranked.map(toResult);
    lastSummary = {
      ...emptySummary("pass_through"),
      pass: true,
      requiredCount: readRequiredCount(ctx),
      inputCount: ranked.length,
      acceptedCount: ranked.length,
      rejectedCount: 0,
      acceptedCandidates: accepted,
      availableCount: ranked.length,
    };
    logValidatorLine("[REC_VALIDATOR_SUMMARY]", [
      `inputCount=${ranked.length}`,
      `acceptedCount=${ranked.length}`,
      `rejectedCount=0`,
      `requiredCount=${lastSummary.requiredCount}`,
      "recommendationInsufficient=false",
      "failedRuleCounts=none",
      "path=pass_through",
    ]);
    return getLastRecommendationValidationSummary();
  }

  const requiredCount = readRequiredCount(ctx);
  const intents = resolveIntentFlags(ctx);
  const inputCandidates = ranked.map((r) => r.candidate);
  const before = coverageMaps(inputCandidates);

  logValidatorLine("[REC_VALIDATOR_INPUT]", [
    `inputCount=${ranked.length}`,
    `requiredCount=${requiredCount}`,
    `style=${readStyle(ctx) ?? ""}`,
    `categoryHint=${ctx?.categoryHint ?? ""}`,
    `shopping=${intents.shopping}`,
    `nightlife=${intents.nightlife}`,
    `nature=${intents.nature}`,
    `lodging=${intents.lodging}`,
    `path=recommendation_validator`,
  ]);

  const failedRuleCounts: Record<string, number> = {};
  const seenIds = new Set<string>();
  const seenCanonical = new Set<string>();
  const acceptedCandidates: RecommendationResult[] = [];
  const rejectedCandidates: RecommendationValidationResult[] = [];

  for (const item of ranked) {
    const result = evaluateCandidate(
      item.candidate,
      ctx,
      intents,
      seenIds,
      seenCanonical,
    );

    logValidatorLine("[REC_VALIDATOR_ITEM]", [
      `placeId=${result.placeId ?? ""}`,
      `name=${item.candidate.name ?? ""}`,
      `canonicalLandmarkKey=${result.canonicalLandmarkKey ?? ""}`,
      `accepted=${result.accepted}`,
      `failedRules=${result.failedRules.join("|") || "none"}`,
      `warnings=${result.warnings.join("|") || "none"}`,
      `path=recommendation_validator`,
    ]);

    if (!result.accepted) {
      for (const rule of result.failedRules) bump(failedRuleCounts, rule);
      rejectedCandidates.push(result);
      logValidatorLine("[REC_VALIDATOR_REJECT]", [
        `placeId=${result.placeId ?? ""}`,
        `name=${item.candidate.name ?? ""}`,
        `canonicalLandmarkKey=${result.canonicalLandmarkKey ?? ""}`,
        `failedRules=${result.failedRules.join("|")}`,
        `path=recommendation_validator`,
      ]);
      continue;
    }

    const id = item.candidate.placeId.trim();
    if (id) seenIds.add(id);
    if (result.canonicalLandmarkKey) seenCanonical.add(result.canonicalLandmarkKey);
    acceptedCandidates.push(toResult(item));
  }

  const after = coverageMaps(acceptedCandidates.map((r) => r.candidate));
  const availableCount = after.canonical.size;
  const missingCount = requiredCount > 0 ? Math.max(0, requiredCount - availableCount) : 0;
  const recommendationInsufficient = requiredCount > 0 && availableCount < requiredCount;

  const affectedKinds: string[] = [];
  for (const [kind, n] of Object.entries(before.category)) {
    const afterN = after.category[kind] ?? 0;
    if (n > 0 && afterN === 0) affectedKinds.push(kind);
  }
  const affectedClusters: string[] = [];
  for (const c of before.clusters) {
    if (!after.clusters.has(c)) affectedClusters.push(c);
  }

  // 不足時不得靜默交給 Planner — 清空 accepted
  const delivered = recommendationInsufficient ? [] : acceptedCandidates;

  lastSummary = {
    pass: !recommendationInsufficient,
    requiredCount,
    inputCount: ranked.length,
    acceptedCount: delivered.length,
    rejectedCount: rejectedCandidates.length,
    recommendationInsufficient,
    failedRuleCounts,
    acceptedCandidates: delivered,
    rejectedCandidates,
    categoryBefore: before.category,
    categoryAfter: after.category,
    clusterBefore: before.clusters.size,
    clusterAfter: after.clusters.size,
    canonicalBefore: before.canonical.size,
    canonicalAfter: after.canonical.size,
    temporalBefore: before.temporal,
    temporalAfter: after.temporal,
    flowBefore: before.flow,
    flowAfter: after.flow,
    affectedKinds,
    affectedClusters: affectedClusters.slice(0, 12),
    missingCount,
    availableCount,
    path: "recommendation_validator",
  };

  logValidatorLine("[REC_VALIDATOR_POOL_COMPARE]", [
    `categoryBefore=${formatCountMap(before.category)}`,
    `categoryAfter=${formatCountMap(after.category)}`,
    `clusterBefore=${before.clusters.size}`,
    `clusterAfter=${after.clusters.size}`,
    `canonicalBefore=${before.canonical.size}`,
    `canonicalAfter=${after.canonical.size}`,
    `temporalBefore=${formatCountMap(before.temporal)}`,
    `temporalAfter=${formatCountMap(after.temporal)}`,
    `flowBefore=${formatCountMap(before.flow)}`,
    `flowAfter=${formatCountMap(after.flow)}`,
    `affectedKinds=${affectedKinds.join("|") || "none"}`,
    `path=recommendation_validator`,
  ]);

  logValidatorLine("[REC_VALIDATOR_SUMMARY]", [
    `inputCount=${ranked.length}`,
    `acceptedCount=${delivered.length}`,
    `rejectedCount=${rejectedCandidates.length}`,
    `requiredCount=${requiredCount}`,
    `availableCount=${availableCount}`,
    `missingCount=${missingCount}`,
    `recommendationInsufficient=${recommendationInsufficient}`,
    `failedRuleCounts=${formatCountMap(failedRuleCounts)}`,
    `categoryBefore=${formatCountMap(before.category)}`,
    `categoryAfter=${formatCountMap(after.category)}`,
    `clusterBefore=${before.clusters.size}`,
    `clusterAfter=${after.clusters.size}`,
    `canonicalBefore=${before.canonical.size}`,
    `canonicalAfter=${after.canonical.size}`,
    `path=recommendation_validator`,
  ]);

  return getLastRecommendationValidationSummary();
}

/**
 * Recommendation Validator 入口（pipeline 相容：回傳通過的 RecommendationResult[]）。
 * Flag ON 且 recommendationInsufficient 時回傳 []，避免 Planner 收到不足候選。
 */
export function validateRecommendations(
  ranked: readonly ScoredCandidate[],
  ctx?: RecommendationContext,
): RecommendationResult[] {
  return validateRecommendationsDetailed(ranked, ctx).acceptedCandidates;
}

/** @deprecated 使用 validateRecommendations（Recommendation Validator） */
export const validateCandidates = validateRecommendations;
