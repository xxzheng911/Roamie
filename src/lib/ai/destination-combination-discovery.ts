/**
 * Destination-agnostic combination discovery via Places category search.
 * Combinations are built only from resolved real place candidates — never from
 * destination + category-label templates.
 */
import type { Locale } from "@/lib/i18n/types";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import type { PlaceResult } from "@/lib/place-result";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import {
  resolveDestinationApproxCenter,
  EN_CITY_NAMES,
  buildDestinationGeocodeQueries,
} from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  isCountryLevelDestination,
  logCountryLevelPlacesBlocked,
} from "@/lib/ai/destination-scope";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { isGenericDestinationPlaceholder } from "@/lib/ai/generic-place-label";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { distanceMeters } from "@/lib/map-explore";
import {
  shouldSkipPlanningPlacesApi,
  waitIfPlacesRateLimited,
} from "@/lib/ai/planning-candidate-pool";
import {
  readCombinationCache,
  writeCombinationCache,
  clearCombinationCache as clearCombinationCostCache,
  logCombinationCacheHit,
  logCombinationCacheMiss,
  readCandidatePoolCache,
  readSessionCandidatePool,
  ingestResolvedPlacesIntoCandidatePool,
  logPlacesSearchSkipped,
} from "@/lib/ai/places-cost-cache";
import {
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
  logNonPlaceCandidateRejected,
} from "@/lib/ai/place-name-likelihood";
import {
  validateDestinationScope,
  resolveDestinationCountryLabel,
  finalizeDestinationScope,
  buildDestinationScopeContextPatch,
  countryCodeForCountryName,
} from "@/lib/ai/resolved-destination-scope";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { resolveDestinationAnchor, type DestinationAnchor } from "@/lib/ai/destination-anchor";
import {
  beginPlacesGenerationSession,
  getActivePlacesGenerationRequestId,
} from "@/lib/places-api-guard";
import {
  buildDestinationDiscoveryQueries,
  buildDestinationSearchAreas,
  buildThemeSearchDirections,
  resolveDiscoveryRegionProfile,
} from "@/lib/ai/destination-discovery-queries";
import {
  adjustCombinationTitle,
  assignSoftThemeSlot,
  categoryThemeSearchQueries,
  includedTypesForTheme,
  inspectCoastAuthority,
  logCombinationCategoryCounts,
  logCombinationFoodGap,
  MIN_TYPED_COMBO_PLACES,
  normalizePlaceCategory,
  resolveCombinationThemeKey,
  SOFT_THEME_SLOTS,
  themeRequiresCategoryContract,
  validateFoodCombinationPlaces,
  validatePlaceForCombination,
  type NormalizedPlaceCategory,
} from "@/lib/ai/combination-category-contract";
import { collapseParentLandmarkCandidates } from "@/lib/ai/ai-parent-landmark-dedup";
import { applyCombinationLocalizationGate } from "@/lib/ai/combination-localization-gate";
import {
  hasForeignLocalScript,
  resolvePlaceDisplayName,
  type PlaceNameLocalizationSource,
} from "@/lib/place-display-name";
import {
  deriveCombinationThemeTitle,
  isMechanicalCombinationTitle,
  localizeCombinationThemeTitle,
} from "@/lib/ai/combination-theme-titles";
import { classifyDailyDiversityCategory } from "@/lib/ai/daily-category-diversity";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";
import { resolvePlaceCategoryFamily } from "@/lib/ai/place-category-family";
import { logAffiliateFactualEvidenceLifecycle } from "@/lib/affiliate/factual-evidence-lifecycle";

/** Soft ceiling — stop discovery rather than hang forever on rate limits. */
const COMBINATION_DISCOVERY_TIMEOUT_MS = 45_000;

export type CombinationPlaceCandidate = {
  /** Display name — always localizedDisplayName after resolver / gate. */
  name: string;
  googlePlaceId?: string;
  searchCandidateId?: string;
  coordinates?: { lat: number; lng: number };
  address?: string;
  district?: string;
  types: string[];
  primaryType?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  businessStatus?: string | null;
  /** Coarse category from Google types + name signals (category contract). */
  normalizedCategory?: NormalizedPlaceCategory;
  /** Combination id this place was validated into (1-based when offered). */
  combinationId?: string;
  /** Pre-localization / local-script name */
  originalName?: string;
  /** App-locale display name (UI / chat must prefer this) */
  localizedDisplayName?: string;
  /** Final UI name: localizedDisplayName || englishName || readable original */
  effectiveDisplayName?: string;
  languageCode?: string;
  localizationSource?: PlaceNameLocalizationSource | string;
  englishName?: string;
  localizationStatus?: "complete" | "partial" | "fallback";
  isReadableFallback?: boolean;
  /** Privacy-safe diagnostic provenance only; never semantic authority. */
  sourceQueryLane?: PlanningDiscoveryQueryLane;
};

export type StructuredCombinationOption = {
  combinationId: string;
  title: string;
  theme: string;
  /** Full pool: primary first, then fallback backups */
  placeCandidates: CombinationPlaceCandidate[];
  primaryCandidates?: CombinationPlaceCandidate[];
  fallbackCandidates?: CombinationPlaceCandidate[];
};

export type DestinationResolution = {
  input: string;
  displayName: string;
  coordinates: { lat: number; lng: number } | null;
  searchAreas: string[];
};

export type CombinationValidationResult = {
  ok: boolean;
  reason?: string;
  genericPlaceNames: string[];
};

export type DestinationDiscoveryFailureReason =
  | "destination_resolution_failed"
  | "no_coordinates"
  | "destination_country_unresolved"
  | "destination_coordinate_mismatch"
  | "place_discovery_failed"
  | "places_no_results"
  | "places_rate_limited"
  | "real_places_below_minimum"
  | "combination_candidates_insufficient"
  | "combination_insufficient"
  | "invalid_destination_scope"
  | "blocked_country"
  | "timeout";

let lastDiscoveryFailure: {
  destination: string;
  reason: DestinationDiscoveryFailureReason;
  detail?: string;
} | null = null;

let lastFinalizedScopePatch: ReturnType<typeof buildDestinationScopeContextPatch> | null = null;

export function getLastCombinationDiscoveryFailure(): typeof lastDiscoveryFailure {
  return lastDiscoveryFailure;
}

export function getLastFinalizedDestinationScopePatch(): typeof lastFinalizedScopePatch {
  return lastFinalizedScopePatch;
}

function setDiscoveryFailure(
  destination: string,
  reason: DestinationDiscoveryFailureReason,
  detail?: string,
): null {
  lastDiscoveryFailure = { destination: normalizeDestinationLabel(destination), reason, detail };
  return null;
}

export const INSUFFICIENT_COMBINATION_PLACES_MESSAGE = "目前暫時無法取得景點資料。";

/**
 * User-facing failure copy. Keeps root reasons in logs via getLastCombinationDiscoveryFailure.
 * Do not collapse scope/country errors into a Places「無資料」message.
 */
export function buildDestinationRecommendationFailedMessage(
  destination: string,
  reason?: string | null,
): string {
  const label = normalizeDestinationLabel(destination) || "這個目的地";
  const r = (reason ?? lastDiscoveryFailure?.reason ?? "").toLowerCase();
  const detail = (lastDiscoveryFailure?.detail ?? "").toLowerCase();
  const blob = `${r} ${detail}`;

  if (
    blob.includes("country_unresolved") ||
    blob.includes("destination_country") ||
    blob.includes("country_hint_missing") ||
    r === "country_unresolved"
  ) {
    return `目前暫時無法確認${label}的國家範圍，請稍後再試一次。`;
  }
  if (blob.includes("anchor_type_rejected") || blob.includes("destination_anchor_invalid")) {
    return `目前暫時無法確認${label}的目的地類型，請稍後再試或換個寫法。`;
  }
  if (
    blob.includes("no_coordinates") ||
    blob.includes("destination_resolution_failed") ||
    blob.includes("anchor_geocode_empty") ||
    blob.includes("destination_geocode_empty") ||
    blob.includes("anchor_all_providers_failed") ||
    blob.includes("anchor_geometry_missing") ||
    blob.includes("anchor_autocomplete_empty") ||
    blob.includes("geocode_request_denied") ||
    blob.includes("geocode_zero_results") ||
    blob.includes("geocode_network_error") ||
    blob.includes("geocode_over_query_limit") ||
    blob.includes("places_autocomplete_empty") ||
    blob.includes("places_details_empty")
  ) {
    if (blob.includes("geocode_request_denied") || blob.includes("REQUEST_DENIED")) {
      return `目前無法解析${label}的位置（地圖服務授權失敗：REQUEST_DENIED），請稍後再試或換一個城市名稱。`;
    }
    if (blob.includes("geocode_over_query_limit") || blob.includes("geocode_rate_limited")) {
      return `目前地圖查詢過於頻繁，暫時無法取得${label}的位置，請稍後再試一次。`;
    }
    if (blob.includes("geocode_network_error")) {
      return `目前網路異常，暫時無法取得${label}的位置資訊，請稍後再試一次。`;
    }
    if (
      blob.includes("geocode_zero_results") ||
      blob.includes("places_autocomplete_empty") ||
      blob.includes("places_details_empty")
    ) {
      return `找不到「${label}」的可靠位置結果，請改用更完整的城市名稱後再試。`;
    }
    return `目前暫時無法取得${label}的位置資訊，請稍後再試一次。`;
  }
  if (
    blob.includes("coordinate_mismatch") ||
    blob.includes("taiwan_default") ||
    blob.includes("invalid_destination_scope") ||
    blob.includes("anchor_country_mismatch")
  ) {
    return `目前暫時無法確認${label}的目的地範圍，請稍後再試或換個寫法。`;
  }
  if (blob.includes("place_discovery_failed") || blob.includes("places_no_results")) {
    return `目前暫時無法取得${label}的景點資料。\n\n你可以點「重新整理推薦」再試一次。`;
  }
  if (
    blob.includes("real_places_below_minimum") ||
    blob.includes("combination_candidates_insufficient") ||
    blob.includes("combination_insufficient") ||
    blob.includes("combination_discovery_empty")
  ) {
    return `目前暫時無法整理出足夠的${label}行程組合。\n\n你可以點「重新整理推薦」再試一次。`;
  }
  if (blob.includes("rate_limited") || blob.includes("timeout")) {
    return `目前服務較忙碌，暫時無法整理${label}的推薦，請稍後再試。`;
  }
  return `目前暫時無法取得${label}的景點資料。\n\n你可以點「重新整理推薦」再試一次。`;
}

export const REFRESH_DESTINATION_RECOMMENDATIONS_OPTION = "重新整理推薦";

/** Prefer 3+ groups, but accept 2 when typed food/shopping leave fewer valid themes. */
const MIN_COMBINATIONS = 2;
const PREFERRED_COMBINATIONS = 3;
const MAX_COMBINATIONS = 5;
/** Minimum real Places required per combination before showing it. */
const MIN_PLACES_PER_COMBO = 3;
/** Soft floor: enough real Places to assemble combinations without strict themes. */
const MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS = 6;
/** Primary slots shown / mapped first */
const PRIMARY_PLACES_PER_COMBO = 3;
/** Extra backup candidates kept per combination for mapping refill */
const FALLBACK_PLACES_PER_COMBO = 5;
const TARGET_PLACES_PER_COMBO = PRIMARY_PLACES_PER_COMBO + FALLBACK_PLACES_PER_COMBO;
const MAX_TOP_UP_THEME_ATTEMPTS = 4;
const MAX_DISTANCE_FROM_CENTER_M = 55_000;

export type PlanningDiscoveryQueryLane =
  | "candidate_pool_seed"
  | "generic_attraction"
  | "must_see"
  | "museum"
  | "art"
  | "park"
  | "night_market"
  | "old_street"
  | "tourist_attraction"
  | "historic_landmark"
  | "market"
  | "nature"
  | "theme_topup"
  | "nearby_attraction"
  | "other";

type DiscoveryQueryLaneRecord = {
  lane: PlanningDiscoveryQueryLane;
  phase: "core_semantic" | "category_enrichment" | "generic_topup";
  coreLane: boolean;
  executed: boolean;
  skippedReason: string;
  resultCount: number;
  uniqueAddedCount: number;
  cumulativeUniqueCount: number;
  capReachedAfterLane: boolean;
  reservedBudgetBefore: number;
  remainingBudget: number;
  capBlocked: boolean;
};

const INITIAL_DISCOVERY_CANDIDATE_CAP = 18;

function discoveryLanePriority(lane: PlanningDiscoveryQueryLane): number {
  if (lane === "must_see") return 0;
  if (lane === "tourist_attraction" || lane === "historic_landmark") return 1;
  if (lane === "nature") return 2;
  if (lane === "museum" || lane === "art") return 3;
  if (lane === "market" || lane === "night_market" || lane === "old_street") return 4;
  if (lane === "park") return 5;
  if (lane === "generic_attraction") return 6;
  return 7;
}

function discoveryLanePhase(lane: PlanningDiscoveryQueryLane): DiscoveryQueryLaneRecord["phase"] {
  const priority = discoveryLanePriority(lane);
  if (priority <= 2) return "core_semantic";
  if (priority <= 5) return "category_enrichment";
  return "generic_topup";
}

function isCoreDiscoveryLane(lane: PlanningDiscoveryQueryLane): boolean {
  return discoveryLanePhase(lane) === "core_semantic";
}

function discoveryLaneDiagnosticContext(
  lane: PlanningDiscoveryQueryLane,
  cumulativeUniqueCountBefore: number,
  capBlocked: boolean,
  cap = INITIAL_DISCOVERY_CANDIDATE_CAP,
  cumulativeUniqueCountAfter = cumulativeUniqueCountBefore,
): Pick<
  DiscoveryQueryLaneRecord,
  "phase" | "coreLane" | "reservedBudgetBefore" | "remainingBudget" | "capBlocked"
> {
  return {
    phase: discoveryLanePhase(lane),
    coreLane: isCoreDiscoveryLane(lane),
    reservedBudgetBefore: Math.max(0, cap - cumulativeUniqueCountBefore),
    remainingBudget: Math.max(0, cap - cumulativeUniqueCountAfter),
    capBlocked,
  };
}

export function orderPlanningDiscoveryQueryLanes<T extends { query: string }>(items: T[]): T[] {
  return items
    .map((item, inputIndex) => ({ item, inputIndex }))
    .sort((a, b) => {
      const priorityDelta =
        discoveryLanePriority(queryLaneForSemanticQuery(a.item.query)) -
        discoveryLanePriority(queryLaneForSemanticQuery(b.item.query));
      return priorityDelta || a.inputIndex - b.inputIndex;
    })
    .map(({ item }) => item);
}

function queryLaneForSemanticQuery(query: string): PlanningDiscoveryQueryLane {
  if (/必去/.test(query)) return "must_see";
  if (/tourist\s+attractions?/i.test(query)) return "tourist_attraction";
  if (/historic\s+landmark|歷史地標/i.test(query)) return "historic_landmark";
  if (/博物館|museum/i.test(query)) return "museum";
  if (/美術館|art\s+gallery/i.test(query)) return "art";
  if (/夜市|night\s+market/i.test(query)) return "night_market";
  if (/老街|old\s+street|old\s+town/i.test(query)) return "old_street";
  if (/公園|\bpark\b/i.test(query)) return "park";
  if (/市場|\bmarket\b/i.test(query)) return "market";
  if (/自然|nature|scenic|beach|waterfall/i.test(query)) return "nature";
  if (/景點|attraction/i.test(query)) return "generic_attraction";
  return "other";
}

function anonymousRawCandidateHash(place: PlaceResult): string {
  const value = place.id?.trim() || place.name?.trim() || "unknown";
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function rawCandidateKey(place: PlaceResult): string {
  return (place.id ?? place.name ?? "").trim().toLowerCase();
}

export function buildDiscoveryQueryLaneTraceFixture(
  lanes: Array<{
    lane: PlanningDiscoveryQueryLane;
    resultCount: number;
    uniqueAddedCount?: number;
  }>,
  cap: number,
): DiscoveryQueryLaneRecord[] {
  const ordered = [...lanes].sort(
    (a, b) => discoveryLanePriority(a.lane) - discoveryLanePriority(b.lane),
  );
  let cumulativeUniqueCount = 0;
  let capped = false;
  return ordered.map((item) => {
    const phase = discoveryLanePhase(item.lane);
    const coreLane = isCoreDiscoveryLane(item.lane);
    const reservedBudgetBefore = Math.max(0, cap - cumulativeUniqueCount);
    if (capped) {
      return {
        lane: item.lane,
        phase,
        coreLane,
        executed: false,
        skippedReason: "candidate_cap_reached",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount,
        capReachedAfterLane: false,
        reservedBudgetBefore,
        remainingBudget: 0,
        capBlocked: true,
      };
    }
    const uniqueAddedCount = item.uniqueAddedCount ?? item.resultCount;
    cumulativeUniqueCount += uniqueAddedCount;
    capped = cumulativeUniqueCount >= cap;
    return {
      lane: item.lane,
      phase,
      coreLane,
      executed: true,
      skippedReason: "",
      resultCount: item.resultCount,
      uniqueAddedCount,
      cumulativeUniqueCount,
      capReachedAfterLane: capped,
      reservedBudgetBefore,
      remainingBudget: Math.max(0, cap - cumulativeUniqueCount),
      capBlocked: false,
    };
  });
}

const NON_ATTRACTION_NAME_RE =
  /停車場|停車格|便利商店|超商|加油站|銀行|診所|醫院|藥局|學校|派出所|戶政|地政|公所|清潔隊|垃圾|回收|長照|殯儀|宅配|物流|協會|學會|創價|辦公室|總部|股份有限|有限公司|企業社|私人會所|會員中心/;

const THEME_DEFS: Array<{
  key: string;
  title: string;
  typeHint: RegExp;
  nameHint: RegExp;
}> = [
  {
    key: "historic",
    title: "舊城文化組合",
    typeHint: /histor|monument|place_of_worship|church|temple|shrine/i,
    nameHint: /廟|寺|教堂|神社|城隍|州廳|古蹟|老街|城門|東門|西門|孔廟|神社/,
  },
  {
    key: "culture",
    title: "藝文博物館組合",
    typeHint: /museum|art_gallery|cultural/i,
    nameHint: /博物|美術|藝文|文化館|玻璃|展覽/,
  },
  {
    key: "nature",
    title: "城市慢遊組合",
    typeHint: /park|zoo|garden|natural|waterfall|hiking|campground/i,
    nameHint:
      /公園|動物園|綠地|湖|草原|步道|濕地|瀑布|waterfall|viewpoint|view point|觀景|lookout|observation|zipline|樹冠/,
  },
  {
    key: "coast",
    title: "海岸夕陽組合",
    typeHint: /marina|beach|natural_feature|park/i,
    nameHint: /漁港|海岸|海灘|濱海|濕地|碼頭|天梯|漁會|港|beach|beach club|sunset|海岸線/,
  },
  {
    key: "cafe",
    title: "咖啡散步組合",
    typeHint: /cafe|coffee_shop|dessert_shop|confectionery|tea_house/i,
    nameHint: /咖啡|Café|Cafe|茶屋|茶館/,
  },
  {
    key: "food",
    title: "人氣美食組合",
    typeHint: /restaurant|food|bakery|meal_takeaway|meal_delivery|food_court|night_market/i,
    nameHint: /餐廳|小吃|美食|夜市|食堂|料理|甜點|烘焙/,
  },
  {
    key: "shopping",
    title: "購物散策組合",
    typeHint: /shopping_mall|department_store|store|clothing_store|souvenir|bookstore|supermarket/i,
    nameHint: /商圈|百貨|商場|購物|Outlet|伴手禮|商店街|步行街/,
  },
  {
    key: "market",
    title: "商圈市集組合",
    typeHint: /market|shopping_mall|department_store|store/i,
    nameHint: /夜市|市場|商圈|老街|市集|商場/,
  },
  {
    key: "attraction",
    title: "經典景點組合",
    typeHint: /tourist_attraction|landmark|point_of_interest/i,
    nameHint: /景點|地標|觀景|塔|橋|園區/,
  },
  {
    key: "suburb",
    title: "近郊自然組合",
    typeHint: /park|natural|waterfall|hiking/i,
    nameHint: /山|湖|牧場|森林|露營|溫泉|農場|溪|waterfall|瀑布|viewpoint|觀景/,
  },
];

/** Soft search-area hints for dual city/county labels — data only, not flow branching. */
const SEARCH_AREA_HINTS: Record<string, string[]> = {
  新竹: ["新竹市", "竹北", "南寮", "香山", "北埔", "峨眉"],
  嘉義: ["嘉義市", "民雄", "中埔", "阿里山"],
  彰化: ["彰化市", "鹿港", "員林"],
  宜蘭: ["宜蘭市", "羅東", "礁溪", "頭城", "冬山", "五結", "蘇澳"],
  屏東: ["屏東市區", "東港", "恆春", "墾丁", "車城", "枋寮"],
  花蓮: ["花蓮市", "壽豐", "瑞穗", "玉里", "太魯閣"],
  台東: ["台東市", "鹿野", "池上", "成功", "知本"],
  南投: ["南投市", "埔里", "魚池", "日月潭", "竹山"],
  濟州: ["濟州島", "Jeju", "Jeju Island", "제주도", "西歸浦", "濟州市"],
  宿霧: ["Cebu", "Cebu City", "Mactan", "麥克坦", "宿霧市"],
  沖繩: ["那霸", "Okinawa", "沖繩縣"],
  北海道: ["札幌", "小樽", "函館", "Hokkaido"],
  九州: ["福岡", "熊本", "長崎", "Kyushu"],
  峇里島: ["烏布", "庫塔", "Bali", "Denpasar"],
  長灘島: ["Boracay", "White Beach"],
  愛丁堡: ["Edinburgh", "Edinburgh Old Town", "Leith"],
  曼徹斯特: ["Manchester", "Salford"],
  湖區: ["Lake District", "Keswick", "Windermere"],
};

const discoveryCache = new Map<
  string,
  { combinations: StructuredCombinationOption[]; at: number }
>();
const validationLogKeys = new Set<string>();
const COMBINATION_DISCOVERY_TTL_MS = 30 * 60 * 1000;

function logCombinationValidationOnce(
  reason: string,
  genericPlaceNames: string[],
  destination: string,
  generationRequestId?: string,
): void {
  const key = `${generationRequestId ?? "anon"}:${normalizeDestinationLabel(destination)}:${reason}:${genericPlaceNames.join(",")}`;
  if (validationLogKeys.has(key)) return;
  validationLogKeys.add(key);
  logAiPipeline(
    "[COMBINATION_VALIDATION_FAILED]",
    `reason=${reason}`,
    `genericPlaceNames=[${genericPlaceNames.join(",")}]`,
  );
  if (reason.startsWith("too_few_combinations")) {
    void import("@/lib/ai/resolved-trip-destination").then(
      ({
        resolvePlanningDestination,
        assertDestinationConsistency,
        logCombinationFailureChain,
      }) => {
        const resolved = resolvePlanningDestination({ destination });
        const consistency = assertDestinationConsistency(resolved);
        logCombinationFailureChain({
          destinationLabel: destination,
          destinationResolved: consistency.ok,
          destinationLocked: Boolean(resolved?.scopeLocked),
          guardHasDestination: consistency.ok,
          primaryReason: consistency.ok
            ? "candidate_pool_insufficient"
            : "destination_state_desync",
          secondaryReason: consistency.ok ? undefined : "missing_destination",
          terminalReason: reason,
        });
      },
    );
  }
}

function localizeCachedCombinations(
  combinations: StructuredCombinationOption[],
  locale: Locale = effectiveAppLocale(),
): StructuredCombinationOption[] | null {
  const gated = applyCombinationLocalizationGate(combinations, {
    locale,
    minPlacesPerCombo: 2,
    minCombinations: 2,
  });
  if (!gated.combinations.length) return null;
  const usedTitles = new Set<string>();
  return gated.combinations.map((c) => {
    const title = isMechanicalCombinationTitle(c.title)
      ? deriveCombinationThemeTitle(c.placeCandidates, {
          locale,
          baseTitle: c.title,
          usedTitles,
        })
      : localizeCombinationThemeTitle(c.title, locale);
    usedTitles.add(title);
    return { ...c, title };
  }) as StructuredCombinationOption[];
}

export function getCachedDiscoveredCombinations(
  destination: string,
  travelStyle?: string,
  group?: string,
  opts?: { log?: boolean; locale?: Locale; skipLocalizationGate?: boolean },
): StructuredCombinationOption[] | null {
  const shouldLog = opts?.log === true;
  const locale = opts?.locale ?? effectiveAppLocale();
  // Prefer TTL'd Layer-3 cache (destination + style + group)
  const layered = readCombinationCache<StructuredCombinationOption>({
    destination,
    travelStyle,
    group,
    log: shouldLog,
  });
  if (layered?.length) {
    if (shouldLog) {
      logCombinationCacheHit({
        destination: normalizeDestinationLabel(destination),
        travelStyle: travelStyle ?? "any",
        group: group ?? "all",
        count: layered.length,
        source: "layer3",
      });
    }
    if (opts?.skipLocalizationGate) return layered;
    const localized = localizeCachedCombinations(layered, locale);
    return localized ? enforcePlanningCombinationComposition(localized) : null;
  }

  const key = normalizeDestinationLabel(destination);
  const cached = discoveryCache.get(key);
  if (!cached?.combinations.length) {
    if (shouldLog) {
      logCombinationCacheMiss({
        destination: key,
        travelStyle: travelStyle ?? "any",
        group: group ?? "all",
      });
    }
    return null;
  }
  if (Date.now() - cached.at > COMBINATION_DISCOVERY_TTL_MS) {
    discoveryCache.delete(key);
    if (shouldLog) {
      logCombinationCacheMiss({
        destination: key,
        travelStyle: travelStyle ?? "any",
        group: group ?? "all",
        reason: "ttl_expired",
      });
    }
    return null;
  }
  if (shouldLog) {
    logCombinationCacheHit({
      destination: key,
      travelStyle: travelStyle ?? "any",
      group: group ?? "all",
      count: cached.combinations.length,
      source: "discovery_ttl",
    });
  }
  if (opts?.skipLocalizationGate) return cached.combinations;
  const localized = localizeCachedCombinations(cached.combinations, locale);
  return localized ? enforcePlanningCombinationComposition(localized) : null;
}

export function setCachedDiscoveredCombinations(
  destination: string,
  combinations: StructuredCombinationOption[],
  travelStyle?: string,
  group?: string,
): void {
  const label = normalizeDestinationLabel(destination);
  discoveryCache.set(label, { combinations, at: Date.now() });
  writeCombinationCache({
    destination: label,
    travelStyle,
    group,
    combinations,
  });
}

export function clearDiscoveredCombinationsCache(destination?: string): void {
  if (!destination) {
    discoveryCache.clear();
  } else {
    discoveryCache.delete(normalizeDestinationLabel(destination));
  }
  clearCombinationCostCache(destination);
}

export function resolveDestinationSearchAreas(
  destination: string,
  country?: string | null,
): string[] {
  const label = normalizeDestinationLabel(destination);
  const hints = SEARCH_AREA_HINTS[label];
  if (hints?.length) {
    return [...new Set([label, ...hints].filter(Boolean))];
  }
  return buildDestinationSearchAreas({ destination: label, country });
}

export function resolveDestinationForCombinations(
  destination: string,
  coordinates?: { lat: number; lng: number } | null,
  country?: string | null,
): DestinationResolution {
  const displayName = normalizeDestinationLabel(destination);
  const searchAreas = resolveDestinationSearchAreas(displayName, country);
  const coords = coordinates ?? resolveDestinationApproxCenter(displayName, country) ?? null;

  logAiPipeline(
    "[DESTINATION_RESOLVED]",
    `input=${destination}`,
    `displayName=${displayName}`,
    `coordinates=${coords ? `${coords.lat},${coords.lng}` : "null"}`,
    `searchAreas=${searchAreas.join("|")}`,
  );

  return {
    input: destination,
    displayName,
    coordinates: coords,
    searchAreas,
  };
}

function placeNameOf(place: PlaceResult): string {
  // Prefer localizedDisplayName only — never silently prefer raw English.
  return (
    place.localizedDisplayName?.trim() || place.name?.trim() || place.originalName?.trim() || ""
  );
}

function resolveCandidateDisplayName(
  place: PlaceResult,
  locale: Locale,
): {
  displayName: string;
  originalName: string;
  englishName?: string;
  languageCode: string;
  localizationSource: PlaceNameLocalizationSource | string;
} {
  const originalName =
    place.originalName?.trim() || place.name?.trim() || place.localizedDisplayName?.trim() || "";
  const resolved = resolvePlaceDisplayName(
    {
      name: place.localizedDisplayName || place.name,
      originalName,
      placeId: place.id,
      canonicalPlaceId: place.id,
      englishName:
        place.localizationSource === "english" || place.localizationSource === "english_fallback"
          ? place.name
          : undefined,
      types: place.types,
      primaryType: place.primaryType,
    },
    locale,
  );
  return {
    displayName: resolved.localizedDisplayName,
    originalName: resolved.originalName || originalName,
    englishName: resolved.englishName,
    languageCode: resolved.languageCode,
    localizationSource: resolved.localizationSource,
  };
}

function isNonAttractionPlace(place: PlaceResult): boolean {
  if (isForbiddenTransitAttraction(place)) return true;
  const name = placeNameOf(place);
  if (!name) return true;
  if (NON_ATTRACTION_NAME_RE.test(name)) return true;
  const likelihood = isLikelyPlaceName(name);
  if (!likelihood.ok) {
    logNonPlaceCandidateRejected(
      name,
      likelihood.reason ?? "long_marketing_text",
      "places_discovery",
    );
    return true;
  }
  const types = new Set(
    [...(place.types ?? []), place.primaryType ?? ""]
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  if (
    types.has("parking") ||
    types.has("gas_station") ||
    types.has("convenience_store") ||
    types.has("bank") ||
    types.has("atm") ||
    types.has("hospital") ||
    types.has("pharmacy") ||
    types.has("school") ||
    types.has("primary_school") ||
    types.has("secondary_school") ||
    types.has("local_government_office") ||
    types.has("insurance_agency") ||
    types.has("real_estate_agency") ||
    types.has("accounting") ||
    types.has("lawyer") ||
    types.has("funeral_home") ||
    types.has("travel_agency") ||
    types.has("tour_operator") ||
    types.has("event_ticket_seller")
  ) {
    return true;
  }
  return false;
}

function isViewpointLikeCandidate(place: CombinationPlaceCandidate): boolean {
  const blob = [place.name, place.localizedDisplayName, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ");
  return (
    classifyDailyDiversityCategory({
      name: place.localizedDisplayName || place.name,
      types: place.types,
      primaryType: place.primaryType,
    } as import("@/lib/place-result").PlaceResult) === "viewpoint_tower" ||
    /觀景|viewpoint|viewing|sunset\s*hill|observation/i.test(blob)
  );
}

/**
 * Pick primary places with light category diversity:
 * avoid packing 3 near-identical viewpoint/sunset spots into the shown trio.
 * Extra viewpoints remain in fallback for optional user choice.
 */
function splitPrimaryFallback(
  pool: CombinationPlaceCandidate[],
  semanticFamily?: string,
): {
  primary: CombinationPlaceCandidate[];
  fallback: CombinationPlaceCandidate[];
  all: CombinationPlaceCandidate[];
} {
  const sorted = [...pool].sort((a, b) => {
    if (semanticFamily === "attraction") {
      return (
        computeCombinationProminenceScore(b, semanticFamily).prominenceScore -
        computeCombinationProminenceScore(a, semanticFamily).prominenceScore
      );
    }
    return (b.rating ?? 0) - (a.rating ?? 0);
  });
  const primary: CombinationPlaceCandidate[] = [];
  const deferredViewpoints: CombinationPlaceCandidate[] = [];
  let viewpointInPrimary = 0;

  for (const place of sorted) {
    if (primary.length >= PRIMARY_PLACES_PER_COMBO) break;
    if (isViewpointLikeCandidate(place)) {
      if (viewpointInPrimary >= 1) {
        deferredViewpoints.push(place);
        continue;
      }
      viewpointInPrimary += 1;
    }
    primary.push(place);
  }

  // Fill remaining primary slots from non-deferred, then deferred if needed.
  if (primary.length < PRIMARY_PLACES_PER_COMBO) {
    for (const place of sorted) {
      if (primary.length >= PRIMARY_PLACES_PER_COMBO) break;
      if (primary.includes(place) || deferredViewpoints.includes(place)) continue;
      primary.push(place);
    }
  }
  if (primary.length < PRIMARY_PLACES_PER_COMBO) {
    for (const place of deferredViewpoints) {
      if (primary.length >= PRIMARY_PLACES_PER_COMBO) break;
      primary.push(place);
    }
  }

  const primaryKeys = new Set(
    primary.map((p) => p.googlePlaceId || p.name.replace(/\s+/g, "").toLowerCase()),
  );
  const rest = sorted.filter(
    (p) => !primaryKeys.has(p.googlePlaceId || p.name.replace(/\s+/g, "").toLowerCase()),
  );
  const fallback = rest.slice(0, FALLBACK_PLACES_PER_COMBO);
  return { primary, fallback, all: [...primary, ...fallback] };
}

function toCandidate(
  place: PlaceResult,
  destination: string,
  center?: { lat: number; lng: number } | null,
  locale: Locale = effectiveAppLocale(),
): CombinationPlaceCandidate | null {
  const resolved = resolveCandidateDisplayName(place, locale);
  if (!resolved.displayName) return null;

  // Drop destination local-script names early (Thai / Greek / Myanmar / …).
  if (hasForeignLocalScript(resolved.displayName, locale)) {
    logAiPipeline(
      "[PLACE_LOCALIZATION_FALLBACK]",
      `placeId=${place.id ?? ""}`,
      `originalName=${resolved.originalName}`,
      `requestedLocale=${locale}`,
      `resolvedName=${resolved.displayName}`,
      `resolvedLanguage=${resolved.languageCode}`,
      `localizationSource=${resolved.localizationSource}`,
      "reason=foreign_local_script_dropped_at_candidate",
    );
    return null;
  }

  if (isGenericDestinationPlaceholder(resolved.displayName, destination)) return null;
  if (isGenericDestinationPlaceholder(resolved.originalName, destination)) return null;
  if (isNonAttractionPlace(place)) return null;

  // Likelihood / SEO filters run on original + display; keep original for proper-noun checks.
  const normalized = normalizePlaceCandidateName(resolved.displayName);
  if (!normalized.accepted) {
    const originalCheck = normalizePlaceCandidateName(resolved.originalName);
    if (!originalCheck.accepted) {
      logNonPlaceCandidateRejected(
        resolved.displayName,
        normalized.reason ?? "rejected_non_place",
        "places_discovery_to_candidate",
      );
      return null;
    }
  }
  const name = normalized.accepted ? normalized.normalized : resolved.displayName;

  const lat = place.lat;
  const lng = place.lng;
  const normalizedCategory = normalizePlaceCategory({
    name,
    types: place.types,
    primaryType: place.primaryType,
    address: place.address,
  });
  const candidate: CombinationPlaceCandidate = {
    name,
    localizedDisplayName: name,
    originalName: resolved.originalName,
    englishName: resolved.englishName,
    languageCode: resolved.languageCode,
    localizationSource: resolved.localizationSource,
    googlePlaceId: place.id?.trim() || undefined,
    searchCandidateId: place.id?.trim() || `name:${name}`,
    coordinates:
      lat != null && lng != null && (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
        ? { lat, lng }
        : undefined,
    address: place.address?.trim() || undefined,
    district: place.address?.split(/[，,]/)[0]?.trim(),
    types: place.types ?? [],
    primaryType: place.primaryType,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    normalizedCategory,
  };

  const quality = validateCandidateIntent(
    {
      name: candidate.name,
      types: candidate.types,
      primaryType: candidate.primaryType,
      address: place.address,
      lat: candidate.coordinates?.lat,
      lng: candidate.coordinates?.lng,
      rating: candidate.rating,
      googlePlaceId: candidate.googlePlaceId,
    },
    { theme: assignThemeKey(candidate) },
    destination,
    { center: center ?? null, requireTourismType: false, source: "places_discovery" },
  );
  if (!quality.ok) {
    logRejectedCandidate(candidate, "discovery", quality.reason ?? "quality");
    return null;
  }

  return candidate;
}

function assignThemeKey(candidate: CombinationPlaceCandidate): string {
  return resolvePrimarySemanticFamily(candidate).resolvedPrimaryTheme;
}

function previousFirstMatchedTheme(candidate: CombinationPlaceCandidate): string {
  const blob = `${candidate.name} ${candidate.types.join(" ")} ${candidate.primaryType ?? ""}`;
  for (const theme of THEME_DEFS) {
    if (theme.typeHint.test(blob) || theme.nameHint.test(candidate.name)) {
      return theme.key;
    }
  }
  return "attraction";
}

type SemanticAuthorityFamily =
  | "attraction"
  | "historic"
  | "culture"
  | "nature"
  | "coast"
  | "food"
  | "cafe"
  | "shopping"
  | "market";

type SemanticAuthorityTier = "none" | "weak" | "supporting" | "core" | "primary";

function authorityTier(score: number): SemanticAuthorityTier {
  if (score >= 90) return "primary";
  if (score >= 70) return "core";
  if (score >= 40) return "supporting";
  return score > 0 ? "weak" : "none";
}

/** Resolve one primary family from place-level semantic authority, never query provenance. */
export function resolvePrimarySemanticFamily(candidate: CombinationPlaceCandidate): {
  resolvedPrimaryTheme: SemanticAuthorityFamily;
  previousFirstMatchedTheme: string;
  authorityOverrideApplied: boolean;
  authorityScores: Record<SemanticAuthorityFamily, SemanticAuthorityTier>;
} {
  const types = combinationTypes(candidate);
  const primary = candidate.primaryType?.trim().toLowerCase() ?? "";
  const name = candidate.name;
  const coast = inspectCoastAuthority(candidate);
  const explicitLandmark = [...types].some((type) => EXPLICIT_LANDMARK_TYPES.has(type));
  const majorLandmarkName =
    /地標|紀念堂|紀念碑|塔|城堡|宮殿|landmark|tower|castle|palace|monument/i.test(name);
  const templeCore =
    types.has("place_of_worship") ||
    types.has("church") ||
    types.has("hindu_temple") ||
    types.has("buddhist_temple") ||
    types.has("shinto_shrine") ||
    /寺|廟|神社|教堂|temple|shrine|church/i.test(name);
  const museumCore =
    primary === "museum" ||
    primary === "art_gallery" ||
    types.has("museum") ||
    types.has("art_gallery");
  const natureCore =
    /^(?:park|national_park|garden|hiking_area|natural_feature|mountain|waterfall)$/.test(primary) ||
    /山|步道|森林|瀑布|公園|mountain|trail|forest|waterfall|garden/i.test(name);
  const shoppingCore = /shopping_mall|department_store|store|market/.test(primary);
  const foodCore = /restaurant|food|meal_takeaway|bakery/.test(primary);
  const cafeCore = /cafe|coffee_shop|tea_house|dessert_shop/.test(primary);

  const scores: Record<SemanticAuthorityFamily, number> = {
    attraction:
      explicitLandmark
        ? 100
        : types.has("tourist_attraction") && majorLandmarkName
          ? 92
          : types.has("tourist_attraction")
            ? 48
            : types.has("point_of_interest")
              ? 20
              : 0,
    historic: templeCore
      ? 110
      : types.has("historical_landmark") && /歷史|古蹟|遺產|heritage|historic/i.test(name)
        ? 108
        : types.has("historical_landmark")
          ? 76
          : /古蹟|歷史街區|老街|heritage|historic district/i.test(name)
            ? 82
            : 0,
    culture: museumCore
      ? 108
      : types.has("cultural_landmark") && /文化|藝文|博物|美術|cultural|museum|gallery/i.test(name)
        ? 90
        : types.has("cultural_landmark")
          ? 68
          : 0,
    nature: natureCore
      ? 106
      : [...types].some((type) => /park|garden|hiking|natural|waterfall/.test(type))
        ? 65
        : /觀景|viewpoint|scenic/i.test(name)
          ? 30
          : 0,
    coast: coast.coastAuthorityPresent ? 106 : 0,
    food: foodCore ? 96 : [...types].some((type) => /restaurant|food|bakery/.test(type)) ? 70 : 0,
    cafe: cafeCore ? 97 : types.has("cafe") || types.has("coffee_shop") ? 75 : 0,
    shopping: shoppingCore
      ? 105
      : [...types].some((type) => /shopping_mall|department_store|clothing_store|store/.test(type))
        ? 60
        : 0,
    market:
      primary === "market" || primary === "night_market"
        ? 98
        : types.has("market") || types.has("night_market")
          ? 80
          : 0,
  };
  const familyOrder: SemanticAuthorityFamily[] = [
    "coast",
    "historic",
    "culture",
    "nature",
    "cafe",
    "food",
    "shopping",
    "market",
    "attraction",
  ];
  const resolvedPrimaryTheme = familyOrder.reduce((best, family) =>
    scores[family] > scores[best] ? family : best,
  "attraction");
  const previous = previousFirstMatchedTheme(candidate);
  return {
    resolvedPrimaryTheme,
    previousFirstMatchedTheme: previous,
    authorityOverrideApplied: resolvedPrimaryTheme !== previous,
    authorityScores: Object.fromEntries(
      Object.entries(scores).map(([family, score]) => [family, authorityTier(score)]),
    ) as Record<SemanticAuthorityFamily, SemanticAuthorityTier>,
  };
}

export function inspectCombinationThemeAssignment(candidate: CombinationPlaceCandidate): {
  assignedTheme: string;
  competingThemeSignals: string[];
  attractionAuthorityPresent: boolean;
  historicAuthorityPresent: boolean;
  cultureAuthorityPresent: boolean;
  natureAuthorityPresent: boolean;
  shoppingAuthorityPresent: boolean;
  multiSemantic: boolean;
  firstMatchedTheme: string;
  resolvedPrimaryTheme: string;
  previousFirstMatchedTheme: string;
  authorityOverrideApplied: boolean;
  authorityScores: Record<SemanticAuthorityFamily, SemanticAuthorityTier>;
} {
  const blob = `${candidate.name} ${candidate.types.join(" ")} ${candidate.primaryType ?? ""}`;
  const competingThemeSignals = THEME_DEFS.filter(
    (theme) => theme.typeHint.test(blob) || theme.nameHint.test(candidate.name),
  ).map((theme) => theme.key);
  const types = combinationTypes(candidate);
  const attractionAuthorityPresent =
    types.has("tourist_attraction") ||
    [...types].some((type) => EXPLICIT_LANDMARK_TYPES.has(type));
  const historicAuthorityPresent = competingThemeSignals.includes("historic");
  const cultureAuthorityPresent = competingThemeSignals.includes("culture");
  const natureAuthorityPresent = competingThemeSignals.includes("nature");
  const shoppingAuthorityPresent =
    competingThemeSignals.includes("shopping") || competingThemeSignals.includes("market");
  const authority = resolvePrimarySemanticFamily(candidate);
  const assignedTheme = authority.resolvedPrimaryTheme;
  const authorityCount = [
    attractionAuthorityPresent,
    historicAuthorityPresent,
    cultureAuthorityPresent,
    natureAuthorityPresent,
    shoppingAuthorityPresent,
  ].filter(Boolean).length;
  return {
    assignedTheme,
    competingThemeSignals,
    attractionAuthorityPresent,
    historicAuthorityPresent,
    cultureAuthorityPresent,
    natureAuthorityPresent,
    shoppingAuthorityPresent,
    multiSemantic: authorityCount > 1,
    firstMatchedTheme: authority.previousFirstMatchedTheme,
    resolvedPrimaryTheme: authority.resolvedPrimaryTheme,
    previousFirstMatchedTheme: authority.previousFirstMatchedTheme,
    authorityOverrideApplied: authority.authorityOverrideApplied,
    authorityScores: authority.authorityScores,
  };
}

function jaccardOverlap(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.replace(/\s+/g, "").toLowerCase()));
  const sb = new Set(b.map((x) => x.replace(/\s+/g, "").toLowerCase()));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Drop SEO / booking / affiliate product titles from structured combo pools
 * before chat UI or validation. Mutates `combinations` in place.
 */
export function sanitizeStructuredCombinationPlaces(
  combinations: StructuredCombinationOption[],
  destination: string,
): void {
  const label = normalizeDestinationLabel(destination);
  for (let i = combinations.length - 1; i >= 0; i -= 1) {
    const combo = combinations[i]!;
    const rawCount = combo.placeCandidates.length;
    const kept: CombinationPlaceCandidate[] = [];
    let rejectedNonPlaces = 0;
    for (const place of combo.placeCandidates) {
      const check = normalizePlaceCandidateName(place.name);
      if (!check.accepted) {
        rejectedNonPlaces += 1;
        logNonPlaceCandidateRejected(
          place.name,
          check.reason ?? "rejected_non_place",
          `combination:${combo.title}`,
        );
        continue;
      }
      if (isGenericDestinationPlaceholder(check.normalized, label)) {
        rejectedNonPlaces += 1;
        continue;
      }
      kept.push({ ...place, name: check.normalized });
    }

    // Parent Landmark Collapse BEFORE user selection / Planner.
    const collapsed = collapseParentLandmarkCandidates(
      kept.map((p) => ({
        name: p.name,
        googlePlaceId: p.googlePlaceId,
        address: p.address,
        lat: p.coordinates?.lat,
        lng: p.coordinates?.lng,
        rating: p.rating,
      })),
    );
    const collapseKeepKeys = new Set(
      collapsed.kept.map((c) => c.name.trim().replace(/\s+/g, "").toLowerCase()),
    );
    const afterCollapse = kept.filter((p) =>
      collapseKeepKeys.has(p.name.trim().replace(/\s+/g, "").toLowerCase()),
    );

    combo.placeCandidates = afterCollapse;
    combo.primaryCandidates = afterCollapse.slice(0, PRIMARY_PLACES_PER_COMBO);
    combo.fallbackCandidates = afterCollapse.slice(PRIMARY_PLACES_PER_COMBO);
    logAiPipeline(
      "[COMBINATION_PLACE_VALIDATION]",
      `combinationId=${combo.combinationId}`,
      `rawCount=${rawCount}`,
      `validRealPlaces=${afterCollapse.length}`,
      `rejectedNonPlaces=${rejectedNonPlaces}`,
      `parentCollapseDropped=${collapsed.dropped.length}`,
    );
    if (afterCollapse.length < minPlacesForTheme(combo.theme, combo.title)) {
      combinations.splice(i, 1);
    }
  }
}

/**
 * Validate structured combinations before showing them in chat.
 */
export function validateCombinationOptions(
  combinations: StructuredCombinationOption[],
  destination: string,
  knownCandidateNames?: Set<string>,
  generationRequestId?: string,
): CombinationValidationResult {
  const genericPlaceNames: string[] = [];
  const label = normalizeDestinationLabel(destination);

  sanitizeStructuredCombinationPlaces(combinations, label);

  for (const combo of combinations) {
    for (const place of combo.placeCandidates) {
      if (isGenericDestinationPlaceholder(place.name, label)) {
        genericPlaceNames.push(place.name);
      }
      const likelihood = isLikelyPlaceName(place.name);
      if (!likelihood.ok) {
        genericPlaceNames.push(place.name);
        logNonPlaceCandidateRejected(
          place.name,
          likelihood.reason ?? "rejected_non_place",
          "combination_validation",
        );
      }
    }
  }

  if (genericPlaceNames.length) {
    const result = {
      ok: false,
      reason: "generic_placeholder_names",
      genericPlaceNames,
    };
    logCombinationValidationOnce(result.reason, genericPlaceNames, label, generationRequestId);
    return result;
  }

  if (combinations.length < MIN_COMBINATIONS) {
    const result = {
      ok: false,
      reason: `too_few_combinations:${combinations.length}`,
      genericPlaceNames,
    };
    logCombinationValidationOnce(result.reason, [], label, generationRequestId);
    return result;
  }

  for (const combo of combinations) {
    const minPlaces = minPlacesForTheme(combo.theme, combo.title);
    if (combo.placeCandidates.length < minPlaces) {
      const result = {
        ok: false,
        reason: `combo_too_few_places:${combo.title}:${combo.placeCandidates.length}`,
        genericPlaceNames,
      };
      logCombinationValidationOnce(result.reason, [], label, generationRequestId);
      return result;
    }

    for (const place of combo.placeCandidates) {
      if (
        knownCandidateNames &&
        knownCandidateNames.size > 0 &&
        !knownCandidateNames.has(place.name.replace(/\s+/g, "").toLowerCase())
      ) {
        const result = {
          ok: false,
          reason: `unresolved_candidate:${place.name}`,
          genericPlaceNames,
        };
        logCombinationValidationOnce(result.reason, genericPlaceNames, label, generationRequestId);
        return result;
      }
    }
  }

  for (let i = 0; i < combinations.length; i += 1) {
    for (let j = i + 1; j < combinations.length; j += 1) {
      const a = combinations[i]!.placeCandidates.map((p) => p.name);
      const b = combinations[j]!.placeCandidates.map((p) => p.name);
      if (jaccardOverlap(a, b) >= 0.7) {
        const result = {
          ok: false,
          reason: `high_overlap:${combinations[i]!.title}|${combinations[j]!.title}`,
          genericPlaceNames,
        };
        logCombinationValidationOnce(result.reason, [], label, generationRequestId);
        return result;
      }
    }
  }

  return { ok: true, genericPlaceNames: [] };
}

function filterPoolByCategoryContract(
  pool: CombinationPlaceCandidate[],
  themeKey: string,
  title: string,
  combinationId: string,
): CombinationPlaceCandidate[] {
  let validCount = 0;
  let rejectedCount = 0;
  const validated: CombinationPlaceCandidate[] = [];
  for (const place of pool) {
    if (!themeRequiresCategoryContract(themeKey, title)) {
      validated.push({
        ...place,
        normalizedCategory:
          place.normalizedCategory ??
          normalizePlaceCategory({
            name: place.name,
            types: place.types,
            primaryType: place.primaryType,
            address: place.address,
          }),
        combinationId,
      });
      validCount += 1;
      continue;
    }
    const check = validatePlaceForCombination(place, themeKey, {
      title,
      combinationId,
    });
    if (resolveCombinationThemeKey(themeKey, title) === "coast") {
      const coast = inspectCoastAuthority(place);
      console.info("[PLANNING_COMBINATION_CANDIDATE_DECISION]", {
        candidateHash: combinationCandidateHash(place),
        semanticFamily: "coast",
        coastAuthorityPresent: coast.coastAuthorityPresent,
        coastEvidenceType: coast.coastEvidenceType,
        semanticContractPassed: check.valid,
        eligible: check.valid,
        finalRank: null,
        selected: false,
        dropReason: check.valid ? "" : "coast_authority_missing",
      });
    }
    if (!check.valid) {
      rejectedCount += 1;
      continue;
    }
    validCount += 1;
    validated.push({
      ...place,
      normalizedCategory: check.normalizedCategory,
      combinationId,
    });
  }
  logCombinationCategoryCounts({
    combinationId,
    theme: themeKey,
    candidateCount: pool.length,
    validCount,
    rejectedCount,
  });
  return validated;
}

/** Shared per-place admission boundary for normal, leftover and directed groups. */
export function filterCandidatesForProposedCombinationTheme(
  pool: CombinationPlaceCandidate[],
  themeKey: string,
  title = "",
  combinationId = "diagnostic",
): CombinationPlaceCandidate[] {
  return filterPoolByCategoryContract(pool, themeKey, title, combinationId);
}

function minPlacesForTheme(themeKey: string, title?: string): number {
  return themeRequiresCategoryContract(themeKey, title)
    ? MIN_TYPED_COMBO_PLACES
    : MIN_PLACES_PER_COMBO;
}

type CompositionDropReason =
  | "category_mismatch"
  | "coast_authority_missing"
  | "coast_category_mismatch"
  | "venue_duplicate"
  | "child_place"
  | "unsuitable"
  | "ranking_excluded";

type CombinationParentChildRole = "parent" | "child" | "standalone";

const DESTINATION_CHILD_PLACE_RE =
  /觀景台|展望台|阻尼|風阻尼|紀念品|禮品店|映池|景觀池|裝飾池|gift\s*shop|observation\s*(?:deck|component)|internal\s*(?:exhibit|feature|plaza|observation\s*component)|decorative\s*pond|館內|樓內|店內|入口|出口|售票處|服務台|ticket(?:ing)?\s*(?:office|counter)/i;
const STORE_NAME_RE = /旗艦店|門市|專賣店|(?:^|\s)(?:store|shop|boutique|outlet)(?:\s|$)/i;
const UNSUITABLE_COMBINATION_TYPES = new Set([
  "clothing_store",
  "shoe_store",
  "store",
  "convenience_store",
  "office",
  "corporate_office",
  "service_establishment",
  "car_repair",
  "real_estate_agency",
]);

const EXPLICIT_LANDMARK_TYPES = new Set([
  "landmark",
  "cultural_landmark",
  "historical_landmark",
  "monument",
  "castle",
  "palace",
]);

function combinationTypes(candidate: CombinationPlaceCandidate): Set<string> {
  return new Set(
    [candidate.primaryType, ...(candidate.types ?? [])]
      .map((type) => type?.trim().toLowerCase())
      .filter((type): type is string => Boolean(type)),
  );
}

function hasStrongLandmarkEvidence(candidate: CombinationPlaceCandidate): boolean {
  const types = combinationTypes(candidate);
  if ([...types].some((type) => EXPLICIT_LANDMARK_TYPES.has(type))) return true;
  return (
    types.has("tourist_attraction") &&
    /地標|紀念堂|紀念碑|塔|城|宮|神社|寺|廟|landmark|tower|castle|palace|shrine|temple|monument/i.test(
      candidate.name,
    )
  );
}

function combinationParentChildRole(
  candidate: CombinationPlaceCandidate,
): CombinationParentChildRole {
  if (DESTINATION_CHILD_PLACE_RE.test(candidate.name)) return "child";
  return hasStrongLandmarkEvidence(candidate) ? "parent" : "standalone";
}

/** Lower tier is better. The contract is destination-agnostic and evidence-driven. */
function combinationLandmarkTier(
  candidate: CombinationPlaceCandidate,
  semanticFamily: string,
): number {
  const role = combinationParentChildRole(candidate);
  if (role === "child") return 6;
  const types = combinationTypes(candidate);
  const name = candidate.name;
  if (hasStrongLandmarkEvidence(candidate)) return 1;
  if (
    types.has("historical_landmark") ||
    types.has("cultural_landmark") ||
    types.has("place_of_worship") ||
    /古蹟|歷史|文化資產|heritage|historic/i.test(name)
  )
    return 2;
  if (
    types.has("museum") ||
    types.has("art_gallery") ||
    types.has("monument") ||
    /博物館|美術館|紀念館|museum|gallery|monument/i.test(name)
  )
    return 3;
  if (types.has("park") || types.has("national_park") || /公園|大型公園|park/i.test(name)) return 4;
  if (/廣場|步行街|散步道|plaza|promenade/i.test(name)) return 5;
  return semanticFamily === "attraction" && types.has("tourist_attraction") ? 5 : 6;
}

export function computeCombinationProminenceScore(
  candidate: CombinationPlaceCandidate,
  semanticFamily: string,
): {
  prominenceScore: number;
  popularityScore: number;
  landmarkTier: number;
  parentChildRole: CombinationParentChildRole;
} {
  const parentChildRole = combinationParentChildRole(candidate);
  const landmarkTier = combinationLandmarkTier(candidate, semanticFamily);
  const popularityScore =
    Math.max(0, candidate.rating ?? 0) * 20 +
    Math.log1p(Math.max(0, candidate.userRatingCount ?? 0)) * 25;
  const semanticFidelity = combinationCategoryEligible(candidate, semanticFamily) ? 200 : 0;
  const parentAuthority =
    parentChildRole === "parent" ? 1_000 : parentChildRole === "child" ? -2_000 : 0;
  return {
    prominenceScore:
      (7 - landmarkTier) * 10_000 + popularityScore + semanticFidelity + parentAuthority,
    popularityScore,
    landmarkTier,
    parentChildRole,
  };
}

function combinationCandidateHash(candidate: CombinationPlaceCandidate): string {
  const value = candidate.googlePlaceId?.trim() || candidate.name;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function logAttractionCandidateLifecycle(
  candidate: CombinationPlaceCandidate,
  state: {
    rawPresent?: boolean;
    sanitizedPresent?: boolean;
    categoryContractPassed?: boolean;
    primaryOrFallback?: "primary" | "fallback" | "none";
    shortlistIncluded?: boolean;
    compositionIncluded?: boolean;
    finalSelected?: boolean;
    dropReason?: string;
  },
): void {
  const assignment = inspectCombinationThemeAssignment(candidate);
  if (!assignment.attractionAuthorityPresent) return;
  const score = computeCombinationProminenceScore(candidate, "attraction");
  console.info("[PLANNING_ATTRACTION_CANDIDATE_LIFECYCLE]", {
    candidateHash: combinationCandidateHash(candidate),
    rawPresent: state.rawPresent ?? true,
    sanitizedPresent: state.sanitizedPresent ?? true,
    assignedTheme: assignment.assignedTheme,
    attractionAuthorityPresent: true,
    multiSemantic: assignment.multiSemantic,
    firstMatchedTheme: assignment.firstMatchedTheme,
    authorityScores: assignment.authorityScores,
    resolvedPrimaryTheme: assignment.resolvedPrimaryTheme,
    previousFirstMatchedTheme: assignment.previousFirstMatchedTheme,
    authorityOverrideApplied: assignment.authorityOverrideApplied,
    categoryContractPassed: state.categoryContractPassed ?? false,
    primaryOrFallback: state.primaryOrFallback ?? "none",
    shortlistIncluded: state.shortlistIncluded ?? false,
    compositionIncluded: state.compositionIncluded ?? false,
    finalSelected: state.finalSelected ?? false,
    dropReason: state.dropReason ?? "",
    landmarkTier: score.landmarkTier,
    prominenceScore: Math.round(score.prominenceScore * 100) / 100,
    userRatingCountPresent: candidate.userRatingCount != null,
    sourceQueryLane: candidate.sourceQueryLane ?? "other",
  });
}

function combinationCategoryEligible(
  candidate: CombinationPlaceCandidate,
  semanticFamily: string,
): boolean {
  const types = combinationTypes(candidate);
  const name = candidate.name;
  const strongLandmarkEvidence = hasStrongLandmarkEvidence(candidate);
  if (
    semanticFamily !== "shopping" &&
    semanticFamily !== "market" &&
    ([...types].some((type) => UNSUITABLE_COMBINATION_TYPES.has(type)) ||
      (STORE_NAME_RE.test(name) && !strongLandmarkEvidence))
  ) {
    return false;
  }
  if (semanticFamily === "nature") {
    return (
      [...types].some((type) =>
        /park|natural|hiking|garden|scenic|tourist_attraction/.test(type),
      ) || /公園|步道|山|湖|河岸|海岸|garden|park|trail|mount|scenic/i.test(name)
    );
  }
  if (semanticFamily === "historic" || semanticFamily === "culture") {
    return (
      [...types].some((type) =>
        /museum|historic|cultural|place_of_worship|tourist_attraction|monument/.test(type),
      ) || /古蹟|歷史|文化|文物|眷村|寺|廟|宮|城|heritage|historic|museum|temple|shrine/i.test(name)
    );
  }
  if (semanticFamily === "attraction") {
    return (
      [...types].some((type) =>
        /tourist_attraction|museum|monument|landmark|park|place_of_worship/.test(type),
      ) || /地標|紀念堂|博物館|美術館|寺|廟|塔|城|landmark|museum|temple|palace|castle/i.test(name)
    );
  }
  return validatePlaceForCombination(candidate, semanticFamily).valid;
}

function compositionClusterCollision(
  candidate: CombinationPlaceCandidate,
  selected: readonly CombinationPlaceCandidate[],
): boolean {
  if (!candidate.coordinates) return false;
  const candidateNature = /山|步道|公園|trail|park|mount|boulder|巨石/i.test(candidate.name);
  const candidateHeritage = /村|文化|文物|heritage|historic|village|museum/i.test(candidate.name);
  return selected.some((other) => {
    if (!other.coordinates) return false;
    const meters = distanceMeters(candidate.coordinates!, other.coordinates);
    const otherNature = /山|步道|公園|trail|park|mount|boulder|巨石/i.test(other.name);
    const otherHeritage = /村|文化|文物|heritage|historic|village|museum/i.test(other.name);
    const normalized = normalizePlaceCandidateName(candidate.name).normalized;
    const otherNormalized = normalizePlaceCandidateName(other.name).normalized;
    const sharedCore =
      normalized.length >= 2 &&
      otherNormalized.length >= 2 &&
      (normalized.includes(otherNormalized) || otherNormalized.includes(normalized));
    const candidateAddress = candidate.address?.trim() ?? "";
    const sameAddress = Boolean(
      candidateAddress.length >= 8 &&
      /\d/.test(candidateAddress) &&
      candidateAddress === other.address?.trim(),
    );
    return (
      (sharedCore && meters <= 700) ||
      (sameAddress && meters <= 250) ||
      (candidateNature && otherNature && meters <= 700) ||
      (candidateHeritage && otherHeritage && meters <= 180)
    );
  });
}

/** Final destination-level composition gate; never performs discovery. */
export function enforcePlanningCombinationComposition(
  combinations: StructuredCombinationOption[],
): StructuredCombinationOption[] {
  const globallySelected: CombinationPlaceCandidate[] = [];
  return combinations.flatMap((combo, groupIndex) => {
    const semanticFamily = resolveCombinationThemeKey(combo.theme, combo.title);
    const input = combo.placeCandidates;
    console.info("[PLANNING_COMBINATION_BUCKET_BUILD]", {
      stage: "composition_input",
      semanticFamily,
      compositionInputCount: input.length,
    });
    const selected: CombinationPlaceCandidate[] = [];
    const reasons: Record<CompositionDropReason, number> = {
      category_mismatch: 0,
      coast_authority_missing: 0,
      coast_category_mismatch: 0,
      venue_duplicate: 0,
      child_place: 0,
      unsuitable: 0,
      ranking_excluded: 0,
    };
    const rankedInput = input
      .map((candidate, inputIndex) => ({
        candidate,
        inputIndex,
        score: computeCombinationProminenceScore(candidate, semanticFamily),
      }))
      .sort(
        (a, b) => b.score.prominenceScore - a.score.prominenceScore || a.inputIndex - b.inputIndex,
      );
    const decisions = new Map<
      CombinationPlaceCandidate,
      {
        dropReason: CompositionDropReason | null;
        venuePrimary: boolean;
        finalRank: number | null;
        selected: boolean;
      }
    >();
    for (const { candidate } of rankedInput) {
      let dropReason: CompositionDropReason | null = null;
      const types = [...combinationTypes(candidate)];
      if (
        candidate.businessStatus === "CLOSED_PERMANENTLY" ||
        types.some((type) => UNSUITABLE_COMBINATION_TYPES.has(type)) ||
        (semanticFamily !== "shopping" &&
          semanticFamily !== "market" &&
          STORE_NAME_RE.test(candidate.name) &&
          !hasStrongLandmarkEvidence(candidate))
      ) {
        dropReason = "unsuitable";
      } else if (DESTINATION_CHILD_PLACE_RE.test(candidate.name)) {
        dropReason = "child_place";
      } else if (
        semanticFamily === "coast" &&
        !inspectCoastAuthority(candidate).coastAuthorityPresent
      ) {
        dropReason = "coast_authority_missing";
      } else if (!combinationCategoryEligible(candidate, semanticFamily)) {
        dropReason = semanticFamily === "coast" ? "coast_category_mismatch" : "category_mismatch";
      } else if (compositionClusterCollision(candidate, [...globallySelected, ...selected])) {
        dropReason = "venue_duplicate";
      }
      if (dropReason) reasons[dropReason] += 1;
      else selected.push(candidate);
      decisions.set(candidate, {
        dropReason,
        venuePrimary: !dropReason,
        finalRank: null,
        selected: false,
      });
    }
    const deliverable = selected.slice(0, PRIMARY_PLACES_PER_COMBO);
    selected.forEach((candidate, index) => {
      const decision = decisions.get(candidate)!;
      decision.finalRank = index + 1;
      decision.selected = index < PRIMARY_PLACES_PER_COMBO;
      if (!decision.selected) {
        decision.dropReason = "ranking_excluded";
        reasons.ranking_excluded += 1;
      }
    });
    for (const candidate of input) {
      const decision = decisions.get(candidate)!;
      const score = computeCombinationProminenceScore(candidate, semanticFamily);
      const coast = inspectCoastAuthority(candidate);
      console.info("[PLANNING_COMBINATION_CANDIDATE_DECISION]", {
        candidateHash: combinationCandidateHash(candidate),
        semanticFamily,
        categoryFamily:
          candidate.normalizedCategory ??
          resolvePlaceCategoryFamily({
            name: candidate.name,
            primaryType: candidate.primaryType,
            types: candidate.types,
          } as import("@/lib/place-result").PlaceResult),
        prominenceScore: Math.round(score.prominenceScore * 100) / 100,
        landmarkTier: score.landmarkTier,
        popularityScore: Math.round(score.popularityScore * 100) / 100,
        parentChildRole: score.parentChildRole,
        venuePrimary: decision.venuePrimary,
        eligible: !decision.dropReason || decision.dropReason === "ranking_excluded",
        finalRank: decision.finalRank,
        selected: decision.selected,
        dropReason: decision.dropReason ?? "",
        clusterCollision: decision.dropReason === "venue_duplicate",
        coastAuthorityPresent: coast.coastAuthorityPresent,
        coastEvidenceType: coast.coastEvidenceType,
        semanticContractPassed:
          decision.dropReason !== "category_mismatch" &&
          decision.dropReason !== "coast_authority_missing" &&
          decision.dropReason !== "coast_category_mismatch",
      });
      logAttractionCandidateLifecycle(candidate, {
        categoryContractPassed:
          decision.dropReason !== "category_mismatch" &&
          decision.dropReason !== "coast_category_mismatch",
        shortlistIncluded: true,
        compositionIncluded: !decision.dropReason || decision.dropReason === "ranking_excluded",
        finalSelected: decision.selected,
        dropReason: decision.dropReason ?? "",
      });
    }
    globallySelected.push(...deliverable);
    console.info("[PLANNING_COMBINATION_COMPOSITION]", {
      groupIndex,
      semanticFamily,
      inputCandidateCount: input.length,
      eligibleCount: selected.length,
      selectedCount: deliverable.length,
      categoryMismatchDropped: reasons.category_mismatch,
      venueDuplicateDropped: reasons.venue_duplicate,
      childPlaceDropped: reasons.child_place,
      unsuitableDropped: reasons.unsuitable,
      rankingExcluded: reasons.ranking_excluded,
      coastAuthorityDropped: reasons.coast_authority_missing,
      semanticContractDropped:
        reasons.category_mismatch +
        reasons.coast_category_mismatch +
        reasons.coast_authority_missing,
    });
    if (deliverable.length < 2) return [];
    return [
      {
        ...combo,
        placeCandidates: selected,
        primaryCandidates: deliverable,
        fallbackCandidates: selected.slice(PRIMARY_PLACES_PER_COMBO),
      },
    ];
  });
}

export function buildCombinationsFromCandidates(
  destination: string,
  candidates: CombinationPlaceCandidate[],
): StructuredCombinationOption[] {
  const byTheme = new Map<string, CombinationPlaceCandidate[]>();
  for (const theme of THEME_DEFS) byTheme.set(theme.key, []);

  for (const candidate of candidates) {
    const assignment = inspectCombinationThemeAssignment(candidate);
    const key = assignment.assignedTheme;
    const list = byTheme.get(key) ?? byTheme.get("attraction")!;
    list.push(candidate);
    console.info("[PLANNING_COMBINATION_BUCKET_BUILD]", {
      candidateHash: combinationCandidateHash(candidate),
      assignedTheme: assignment.assignedTheme,
      competingThemeSignals: assignment.competingThemeSignals,
      attractionAuthorityPresent: assignment.attractionAuthorityPresent,
      historicAuthorityPresent: assignment.historicAuthorityPresent,
      cultureAuthorityPresent: assignment.cultureAuthorityPresent,
      natureAuthorityPresent: assignment.natureAuthorityPresent,
      shoppingAuthorityPresent: assignment.shoppingAuthorityPresent,
      multiSemantic: assignment.multiSemantic,
      firstMatchedTheme: assignment.firstMatchedTheme,
      authorityScores: assignment.authorityScores,
      resolvedPrimaryTheme: assignment.resolvedPrimaryTheme,
      previousFirstMatchedTheme: assignment.previousFirstMatchedTheme,
      authorityOverrideApplied: assignment.authorityOverrideApplied,
    });
    console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
      candidateHash: combinationCandidateHash(candidate),
      admissionStage: `${key}_bucket`,
      dropped: false,
      dropReason: "",
    });
    logAttractionCandidateLifecycle(candidate, {
      categoryContractPassed: false,
      dropReason:
        assignment.authorityOverrideApplied && key === "attraction"
          ? "semantic_authority_override"
          : key === "attraction"
            ? ""
            : `primary_semantic_family:${key}`,
    });
  }

  // Prefer themes with enough places; top up from leftovers.
  const used = new Set<string>();
  const combos: StructuredCombinationOption[] = [];

  const themeOrder = [...THEME_DEFS].sort((a, b) => {
    const ca = byTheme.get(a.key)?.length ?? 0;
    const cb = byTheme.get(b.key)?.length ?? 0;
    return cb - ca;
  });

  for (const theme of themeOrder) {
    if (combos.length >= MAX_COMBINATIONS) break;
    const pool = (byTheme.get(theme.key) ?? []).filter(
      (p) => !used.has(p.name.replace(/\s+/g, "").toLowerCase()),
    );
    const combinationId = `${normalizeDestinationLabel(destination)}:${theme.key}:${combos.length + 1}`;
    const validated = filterPoolByCategoryContract(pool, theme.key, theme.title, combinationId);
    const validatedHashes = new Set(validated.map(combinationCandidateHash));
    for (const candidate of pool) {
      const categoryContractPassed = validatedHashes.has(combinationCandidateHash(candidate));
      logAttractionCandidateLifecycle(candidate, {
        categoryContractPassed,
        dropReason: categoryContractPassed ? "" : "category_contract_rejected",
      });
      if (categoryContractPassed) continue;
      console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
        candidateHash: combinationCandidateHash(candidate),
        admissionStage: "category_contract",
        dropped: true,
        dropReason: "category_contract_rejected",
      });
    }
    const minPlaces = minPlacesForTheme(theme.key, theme.title);
    if (validated.length < minPlaces) {
      console.info("[PLANNING_COMBINATION_BUCKET_BUILD]", {
        stage: "pre_shortlist",
        semanticFamily: theme.key,
        rawCandidateCount: candidates.length,
        assignedCount: pool.length,
        primaryCount: 0,
        fallbackCount: 0,
        postCategoryContractCount: validated.length,
        compositionInputCount: 0,
      });
      continue;
    }
    const { primary, fallback, all } = splitPrimaryFallback(validated, theme.key);
    for (const candidate of primary) {
      console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
        candidateHash: combinationCandidateHash(candidate),
        admissionStage: "primary",
        dropped: false,
        dropReason: "",
      });
      logAttractionCandidateLifecycle(candidate, {
        categoryContractPassed: true,
        primaryOrFallback: "primary",
        shortlistIncluded: true,
      });
    }
    for (const candidate of fallback) {
      console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
        candidateHash: combinationCandidateHash(candidate),
        admissionStage: "fallback",
        dropped: false,
        dropReason: "",
      });
      logAttractionCandidateLifecycle(candidate, {
        categoryContractPassed: true,
        primaryOrFallback: "fallback",
        shortlistIncluded: true,
      });
    }
    const shortlisted = new Set(all);
    for (const candidate of validated) {
      if (shortlisted.has(candidate)) continue;
      console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
        candidateHash: combinationCandidateHash(candidate),
        admissionStage: "shortlist",
        dropped: true,
        dropReason: "bucket_shortlist_cap",
      });
      logAttractionCandidateLifecycle(candidate, {
        categoryContractPassed: true,
        shortlistIncluded: false,
        dropReason: "bucket_shortlist_cap",
      });
    }
    console.info("[PLANNING_COMBINATION_BUCKET_BUILD]", {
      stage: "pre_shortlist",
      semanticFamily: theme.key,
      rawCandidateCount: candidates.length,
      assignedCount: pool.length,
      primaryCount: primary.length,
      fallbackCount: fallback.length,
      postCategoryContractCount: validated.length,
      compositionInputCount: all.length,
    });
    if (all.length < minPlaces) continue;
    for (const p of all) used.add(p.name.replace(/\s+/g, "").toLowerCase());
    const categories = all
      .map((p) => p.normalizedCategory)
      .filter((c): c is NormalizedPlaceCategory => Boolean(c));
    const title = adjustCombinationTitle(theme.title, theme.key, categories);
    combos.push({
      combinationId,
      title,
      theme: theme.key,
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    });
    logAiPipeline(
      "[COMBINATION_CANDIDATE_POOL]",
      `theme=${theme.key}`,
      `primary=${primary.map((p) => p.name).join("|")}`,
      `fallback=${fallback.map((p) => p.name).join("|")}`,
    );
  }

  // Chunk remaining candidates into extra theme groups up to MAX_COMBINATIONS.
  const leftover = candidates.filter((p) => !used.has(p.name.replace(/\s+/g, "").toLowerCase()));
  let idx = 0;
  const usedTitles = new Set(combos.map((c) => c.title));
  while (combos.length < MAX_COMBINATIONS && leftover.length - idx >= MIN_PLACES_PER_COMBO) {
    const chunk = leftover.slice(idx, idx + TARGET_PLACES_PER_COMBO);
    idx += TARGET_PLACES_PER_COMBO;
    if (chunk.length < MIN_PLACES_PER_COMBO) break;
    const proposedTheme = assignThemeKey(chunk[0]!);
    const validatedChunk = filterPoolByCategoryContract(
      chunk,
      proposedTheme,
      THEME_DEFS.find((theme) => theme.key === proposedTheme)?.title ?? "",
      `${normalizeDestinationLabel(destination)}:extra:${combos.length + 1}`,
    );
    if (validatedChunk.length < minPlacesForTheme(proposedTheme)) continue;
    const { primary, fallback, all } = splitPrimaryFallback(validatedChunk, proposedTheme);
    for (const p of all) used.add(p.name.replace(/\s+/g, "").toLowerCase());
    const themeKey = proposedTheme;
    const themeMeta = THEME_DEFS.find((t) => t.key === themeKey) ?? THEME_DEFS[0]!;
    const title = deriveCombinationThemeTitle(all, {
      baseTitle: themeMeta.title,
      usedTitles,
      destinationLabel: normalizeDestinationLabel(destination),
    });
    usedTitles.add(title);
    combos.push({
      combinationId: `${normalizeDestinationLabel(destination)}:extra:${combos.length + 1}`,
      title,
      theme: themeKey,
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    });
  }

  return combos.slice(0, MAX_COMBINATIONS);
}

/**
 * Build combinations from a flat popular-places pool when themed discovery
 * cannot fill enough buckets. Places are assigned by category contract —
 * never by array index / soft title stamp.
 */
function buildSoftCombinationsFromPlaces(
  destination: string,
  candidates: CombinationPlaceCandidate[],
): StructuredCombinationOption[] {
  const usable = candidates.filter((c) => c.name.trim().length >= 2);
  if (usable.length < MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS) return [];

  const buckets = new Map<string, CombinationPlaceCandidate[]>();
  for (const slot of SOFT_THEME_SLOTS) buckets.set(slot.themeKey, []);

  const used = new Set<string>();
  for (const candidate of usable) {
    const key = candidate.name.replace(/\s+/g, "").toLowerCase();
    if (used.has(key)) continue;
    const slot = assignSoftThemeSlot(candidate);
    if (!slot) continue;
    const list = buckets.get(slot);
    if (!list) continue;
    const withCat: CombinationPlaceCandidate = {
      ...candidate,
      normalizedCategory:
        candidate.normalizedCategory ??
        normalizePlaceCategory({
          name: candidate.name,
          types: candidate.types,
          primaryType: candidate.primaryType,
          address: candidate.address,
        }),
    };
    list.push(withCat);
    used.add(key);
  }

  const combos: StructuredCombinationOption[] = [];
  for (const slot of SOFT_THEME_SLOTS) {
    if (combos.length >= MAX_COMBINATIONS) break;
    const pool = buckets.get(slot.themeKey) ?? [];
    const combinationId = `${normalizeDestinationLabel(destination)}:soft:${slot.themeKey}`;
    let validCount = 0;
    let rejectedCount = 0;
    const validated: CombinationPlaceCandidate[] = [];
    for (const place of pool) {
      const check = validatePlaceForCombination(place, slot.themeKey, {
        title: slot.defaultTitle,
        combinationId,
      });
      if (!check.valid) {
        rejectedCount += 1;
        continue;
      }
      validCount += 1;
      validated.push({
        ...place,
        normalizedCategory: check.normalizedCategory,
        combinationId,
      });
    }
    logCombinationCategoryCounts({
      combinationId,
      theme: slot.themeKey,
      candidateCount: pool.length,
      validCount,
      rejectedCount,
    });

    const minPlaces = themeRequiresCategoryContract(slot.themeKey)
      ? MIN_TYPED_COMBO_PLACES
      : MIN_PLACES_PER_COMBO;
    if (validated.length < minPlaces) continue;

    const { primary, fallback, all } = splitPrimaryFallback(validated, slot.themeKey);
    const categories = all
      .map((p) => p.normalizedCategory)
      .filter((c): c is NormalizedPlaceCategory => Boolean(c));
    const title = adjustCombinationTitle(slot.defaultTitle, slot.themeKey, categories);
    combos.push({
      combinationId,
      title,
      theme: slot.themeKey,
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    });
  }

  // Remaining untyped places → classic attraction combo (no food/shopping labels).
  const leftover = usable.filter((p) => !used.has(p.name.replace(/\s+/g, "").toLowerCase()));
  if (combos.length < MAX_COMBINATIONS && leftover.length >= MIN_PLACES_PER_COMBO) {
    const { primary, fallback, all } = splitPrimaryFallback(leftover, "attraction");
    combos.push({
      combinationId: `${normalizeDestinationLabel(destination)}:soft:attraction`,
      title: "經典景點組合",
      theme: "attraction",
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    });
  }

  return combos.slice(0, MAX_COMBINATIONS);
}

type FallbackSearchMode =
  | "popular_places"
  | "popular_plus_cafe"
  | "popular_plus_food"
  | "popular_plus_shopping"
  | "high_rating";

export type CombinationTopUpDegradedReason =
  | "insufficient_verified_candidates"
  | "rate_limited"
  | "no_unused_theme"
  | "validation_failed";

type ThemeDirectionSearchResult = {
  combinations: StructuredCombinationOption[];
  attemptedThemeCount: number;
  stopReason?: CombinationTopUpDegradedReason;
};

const FALLBACK_SEARCH_MODES: Array<{
  mode: FallbackSearchMode;
  queries: (area: string, en: string | undefined, profile: string) => string[];
  includedTypes: string[];
  minRating?: number;
}> = [
  {
    mode: "popular_places",
    queries: (area, en, profile) => {
      if (profile === "taiwan") {
        return [
          `${area} 熱門景點`,
          `${area} 必去景點`,
          `${area} popular attractions`,
          ...(en ? [`${en} tourist attractions`, `${en} must visit`] : []),
        ];
      }
      return [
        `${en ?? area} tourist attractions`,
        `${en ?? area} must visit`,
        `${area} 景點`,
        ...(en ? [`${en} top attractions`] : []),
      ];
    },
    includedTypes: ["tourist_attraction", "park", "museum", "natural_feature"],
  },
  {
    mode: "popular_plus_cafe",
    queries: (area, en) => [
      `${en ?? area} cafe`,
      `${en ?? area} coffee shop`,
      `${area} 咖啡廳`,
      `${area} 咖啡`,
      `${area} 甜點`,
    ],
    includedTypes: ["cafe", "coffee_shop", "bakery"],
  },
  {
    mode: "popular_plus_food",
    queries: (area, en) => [
      `${en ?? area} restaurant`,
      `${en ?? area} popular food`,
      `${en ?? area} local restaurant`,
      `${area} 人氣餐廳`,
      `${area} 在地小吃`,
      `${area} 必吃美食`,
      `${area} 夜市`,
      `${area} 甜點`,
    ],
    includedTypes: ["restaurant", "food", "cafe", "bakery", "meal_takeaway"],
  },
  {
    mode: "popular_plus_shopping",
    queries: (area, en, profile) => {
      if (profile === "taiwan") {
        return [
          `${area} 商圈`,
          `${area} 百貨`,
          `${area} 購物中心`,
          `${area} 老街`,
          `${area} 市場`,
          `${area} 伴手禮`,
          ...(en ? [`${en} shopping mall`, `${en} shopping street`] : []),
        ];
      }
      return [
        `${en ?? area} shopping mall`,
        `${en ?? area} department store`,
        `${en ?? area} shopping street`,
        `${en ?? area} market`,
        `${area} 商圈`,
        `${area} 購物`,
      ];
    },
    includedTypes: ["shopping_mall", "department_store", "market", "clothing_store", "store"],
  },
  {
    mode: "high_rating",
    queries: (area, en) => [
      `${en ?? area} tourist attractions`,
      `${area} 熱門景點`,
      ...(en ? [`${en} top attractions`] : []),
    ],
    includedTypes: ["tourist_attraction", "park", "museum", "natural_feature"],
    minRating: 4.5,
  },
];

async function searchFallbackPlaces(params: {
  destination: string;
  areas: string[];
  lat: number;
  lng: number;
  searchPlaces: PlaceSearchFn;
  mode: (typeof FALLBACK_SEARCH_MODES)[number];
  generationRequestId: string;
  country?: string | null;
  deadlineAt: number;
  locale?: Locale;
}): Promise<PlaceResult[]> {
  const {
    destination,
    areas,
    lat,
    lng,
    searchPlaces,
    mode,
    generationRequestId,
    country,
    deadlineAt,
    locale = effectiveAppLocale(),
  } = params;
  const en = EN_CITY_NAMES[normalizeDestinationLabel(destination)];
  const profile = resolveDiscoveryRegionProfile(destination, country);
  const out: PlaceResult[] = [];
  const seen = new Set<string>();

  for (const area of areas.slice(0, 3)) {
    if (out.length >= 18) break;
    if (Date.now() > deadlineAt) break;
    const cooldown = await waitIfPlacesRateLimited({
      generationRequestId,
      maxWaitMs: Math.min(10_000, Math.max(0, deadlineAt - Date.now())),
    });
    if (cooldown !== "ready") break;

    for (const query of mode.queries(area, en, profile)) {
      if (out.length >= 18 || Date.now() > deadlineAt) break;
      try {
        const result = await searchPlaces({
          data: {
            query,
            lat,
            lng,
            radius: 40_000,
            mode: "text",
            placesScreen: "chat",
            placesCaller: `combination_fallback_${mode.mode}`,
            destinationName: destination,
            searchMode: "destination",
            includedTypes: mode.includedTypes,
            locale,
          },
        });
        for (const place of result.places ?? []) {
          if (mode.minRating != null && (place.rating ?? 0) < mode.minRating) continue;
          const key = (place.id ?? place.name ?? "").trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(place);
        }
      } catch {
        // continue
      }
    }
  }

  return out;
}

/**
 * Per-theme Places search driven by theme fallback directions.
 * Themes never become place names — only search queries.
 */
export async function searchPlacesForThemeDirections(params: {
  destination: string;
  country?: string | null;
  lat: number;
  lng: number;
  searchPlaces: PlaceSearchFn;
  generationRequestId: string;
  deadlineAt: number;
  locale?: Locale;
  existingCombinations?: StructuredCombinationOption[];
  targetCombinationCount?: number;
  rateProtectionActive?: () => boolean;
}): Promise<ThemeDirectionSearchResult> {
  const {
    destination,
    country,
    lat,
    lng,
    searchPlaces,
    generationRequestId,
    deadlineAt,
    locale = effectiveAppLocale(),
    existingCombinations = [],
    targetCombinationCount = PREFERRED_COMBINATIONS,
    rateProtectionActive = shouldSkipPlanningPlacesApi,
  } = params;
  const directions = buildThemeSearchDirections(destination, country);
  const usedKeys = new Set(
    existingCombinations.flatMap((combo) =>
      combo.placeCandidates.map((place) => place.name.replace(/\s+/g, "").toLowerCase()),
    ),
  );
  const usedPlaceIds = new Set(
    existingCombinations.flatMap((combo) =>
      combo.placeCandidates
        .map((place) => place.googlePlaceId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const usedThemes = new Set(
    existingCombinations.map((combo) => resolveCombinationThemeKey(combo.theme, combo.title)),
  );
  const ready: StructuredCombinationOption[] = [];
  let attemptedThemeCount = 0;
  let stopReason: CombinationTopUpDegradedReason | undefined;

  for (const direction of directions) {
    if (existingCombinations.length + ready.length >= targetCombinationCount) break;
    if (attemptedThemeCount >= MAX_TOP_UP_THEME_ATTEMPTS) break;
    if (Date.now() > deadlineAt) break;

    const themeKeyForSearch = resolveCombinationThemeKey(direction.themeKey, direction.title);
    if (usedThemes.has(themeKeyForSearch)) continue;
    if (rateProtectionActive()) {
      stopReason = "rate_limited";
      break;
    }
    attemptedThemeCount += 1;

    const localizedTitle = localizeCombinationThemeTitle(direction.title, locale);
    logAiPipeline(
      "[COMBINATION_THEME_CREATED]",
      `combinationId=${direction.combinationId}`,
      `title=${localizedTitle}`,
      `queries=[${direction.queries.slice(0, 6).join("|")}]`,
    );
    logAiPipeline(
      "[COMBINATION_REAL_PLACE_SEARCH_STARTED]",
      `combinationId=${direction.combinationId}`,
      `destination=${destination}`,
      `queryCount=${direction.queries.length}`,
    );

    const queries = [
      ...direction.queries,
      ...categoryThemeSearchQueries(themeKeyForSearch, destination),
    ];
    const uniqueQueries = [...new Set(queries)].slice(0, 8);
    const includedTypes = includedTypesForTheme(themeKeyForSearch);

    const raw: PlaceResult[] = [];
    const seen = new Set<string>();
    for (const query of uniqueQueries) {
      if (raw.length >= 12 || Date.now() > deadlineAt) {
        console.info("[PLANNING_DISCOVERY_QUERY_LANES]", {
          lane: "theme_topup",
          ...discoveryLaneDiagnosticContext("theme_topup", raw.length, raw.length >= 12, 12),
          executed: false,
          skippedReason: raw.length >= 12 ? "candidate_cap_reached" : "deadline_reached",
          resultCount: 0,
          uniqueAddedCount: 0,
          cumulativeUniqueCount: raw.length,
          capReachedAfterLane: false,
        });
        continue;
      }
      const cooldown = await waitIfPlacesRateLimited({
        generationRequestId,
        maxWaitMs: Math.min(8_000, Math.max(0, deadlineAt - Date.now())),
      });
      if (cooldown !== "ready") {
        stopReason = "rate_limited";
        break;
      }
      if (rateProtectionActive()) {
        stopReason = "rate_limited";
        break;
      }
      try {
        const uniqueCountBeforeLane = raw.length;
        const result = await searchPlaces({
          data: {
            query,
            lat,
            lng,
            radius: 45_000,
            mode: "text",
            placesScreen: "chat",
            placesCaller: "combination_theme_direction",
            destinationName: destination,
            searchMode: "destination",
            includedTypes,
            locale,
          },
        });
        let uniqueAddedCount = 0;
        for (const place of result.places ?? []) {
          const key = (place.id ?? place.name ?? "").trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          raw.push(place);
          uniqueAddedCount += 1;
        }
        console.info("[PLANNING_DISCOVERY_QUERY_LANES]", {
          lane: "theme_topup",
          ...discoveryLaneDiagnosticContext(
            "theme_topup",
            uniqueCountBeforeLane,
            false,
            12,
            raw.length,
          ),
          executed: true,
          skippedReason: "",
          resultCount: result.places?.length ?? 0,
          uniqueAddedCount,
          cumulativeUniqueCount: raw.length,
          capReachedAfterLane: raw.length >= 12,
        });
      } catch {
        console.info("[PLANNING_DISCOVERY_QUERY_LANES]", {
          lane: "theme_topup",
          ...discoveryLaneDiagnosticContext("theme_topup", raw.length, false, 12),
          executed: true,
          skippedReason: "request_failed",
          resultCount: 0,
          uniqueAddedCount: 0,
          cumulativeUniqueCount: raw.length,
          capReachedAfterLane: false,
        });
      }
    }

    const scoped = candidatesFromPlaces(destination, raw, { lat, lng }, locale)
      .map((candidate) => ({ ...candidate, sourceQueryLane: "theme_topup" as const }))
      .filter((c) => {
      const key = c.name.replace(/\s+/g, "").toLowerCase();
      if (usedKeys.has(key) || (c.googlePlaceId && usedPlaceIds.has(c.googlePlaceId))) return false;
      // A top-up group must be Places-backed and navigable. Existing minimum
      // recovery keeps its prior contract when no combinations exist yet.
      if (existingCombinations.length > 0 && (!c.googlePlaceId || !c.coordinates)) return false;
      if (isGenericDestinationPlaceholder(c.name, destination)) {
        logAiPipeline(
          "[COMBINATION_GENERIC_LABEL_DROPPED]",
          `value=${c.name}`,
          "reason=not_a_real_place",
        );
        return false;
      }
      return true;
      });

    const combinationId = `${normalizeDestinationLabel(destination)}:theme:${direction.combinationId}`;
    const themeKey = resolveCombinationThemeKey(direction.themeKey, direction.title);
    const candidates = filterPoolByCategoryContract(
      scoped,
      themeKey,
      direction.title,
      combinationId,
    );

    logAiPipeline(
      "[COMBINATION_REAL_PLACE_RESOLVED]",
      `combinationId=${direction.combinationId}`,
      `candidateCount=${raw.length}`,
      `resolvedCount=${candidates.length}`,
    );

    const minPlaces =
      existingCombinations.length > 0
        ? Math.max(MIN_PLACES_PER_COMBO, minPlacesForTheme(themeKey, direction.title))
        : minPlacesForTheme(themeKey, direction.title);
    if (candidates.length < minPlaces) {
      // Per-combo failure: skip this theme only — do not wipe other ready combos.
      continue;
    }

    const { primary, fallback, all } = splitPrimaryFallback(candidates, themeKey);
    for (const p of all) {
      usedKeys.add(p.name.replace(/\s+/g, "").toLowerCase());
      if (p.googlePlaceId) usedPlaceIds.add(p.googlePlaceId);
      if (p.googlePlaceId) {
        logAiPipeline(
          "[COMBINATION_PLACE_VALIDATED]",
          `combinationId=${direction.combinationId}`,
          `placeId=${p.googlePlaceId}`,
          `displayName=${p.name}`,
        );
      }
    }

    const categories = all
      .map((p) => p.normalizedCategory)
      .filter((c): c is NormalizedPlaceCategory => Boolean(c));
    const title = localizeCombinationThemeTitle(
      adjustCombinationTitle(direction.title, themeKey, categories),
      locale,
    );

    ready.push({
      combinationId,
      title,
      theme: themeKey,
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    });
    usedThemes.add(themeKey);
    logAiPipeline(
      "[COMBINATION_READY]",
      `combinationId=${direction.combinationId}`,
      `realPlaceCount=${all.length}`,
    );
  }

  if (!stopReason && attemptedThemeCount === 0) stopReason = "no_unused_theme";
  if (!stopReason && existingCombinations.length + ready.length < targetCombinationCount) {
    stopReason = "insufficient_verified_candidates";
  }
  return { combinations: ready, attemptedThemeCount, stopReason };
}

/** Append only verified, unused-theme top-up groups while preserving existing groups. */
export function mergeVerifiedCombinationTopUp(
  destination: string,
  existing: StructuredCombinationOption[],
  topUpCandidates: StructuredCombinationOption[],
  preferredCount = PREFERRED_COMBINATIONS,
): {
  combinations: StructuredCombinationOption[];
  addedCount: number;
  degradedReason?: CombinationTopUpDegradedReason;
} {
  if (existing.length >= preferredCount) {
    return { combinations: existing, addedCount: 0 };
  }

  const result = [...existing];
  const usedThemes = new Set(
    existing.map((combo) => resolveCombinationThemeKey(combo.theme, combo.title)),
  );
  const usedNames = new Set(
    existing.flatMap((combo) =>
      combo.placeCandidates.map((place) => place.name.replace(/\s+/g, "").toLowerCase()),
    ),
  );
  const usedIds = new Set(
    existing.flatMap((combo) =>
      combo.placeCandidates
        .map((place) => place.googlePlaceId?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  );
  let sawValidationFailure = false;

  for (const combo of topUpCandidates) {
    if (result.length >= preferredCount) break;
    const themeKey = resolveCombinationThemeKey(combo.theme, combo.title);
    if (usedThemes.has(themeKey)) continue;

    const verified = combo.placeCandidates.filter((place) => {
      const id = place.googlePlaceId?.trim();
      const nameKey = place.name.replace(/\s+/g, "").toLowerCase();
      const syntheticId = /^(?:name|synthetic|generated|fallback):/i.test(id ?? "");
      if (!id || syntheticId || !place.coordinates || usedIds.has(id) || usedNames.has(nameKey)) {
        return false;
      }
      return validateCandidateIntent(
        {
          name: place.name,
          types: place.types,
          primaryType: place.primaryType,
          address: place.address,
          lat: place.coordinates.lat,
          lng: place.coordinates.lng,
          rating: place.rating,
          googlePlaceId: id,
        },
        { title: combo.title, theme: themeKey },
        destination,
        { requireTourismType: true, source: "combination_preferred_top_up" },
      ).ok;
    });
    if (
      verified.length < Math.max(MIN_PLACES_PER_COMBO, minPlacesForTheme(themeKey, combo.title))
    ) {
      sawValidationFailure = true;
      continue;
    }

    const { primary, fallback, all } = splitPrimaryFallback(verified, themeKey);
    const added: StructuredCombinationOption = {
      ...combo,
      theme: themeKey,
      placeCandidates: all,
      primaryCandidates: primary,
      fallbackCandidates: fallback,
    };

    // Re-run the final combination contract on a disposable copy. Validation
    // may sanitize arrays, so the already-deliverable groups remain untouched.
    const validationCopy = [...result, added].map((candidateCombo) => ({
      ...candidateCombo,
      placeCandidates: candidateCombo.placeCandidates.map((place) => ({ ...place })),
      primaryCandidates: candidateCombo.primaryCandidates?.map((place) => ({ ...place })),
      fallbackCandidates: candidateCombo.fallbackCandidates?.map((place) => ({ ...place })),
    }));
    const knownNames = new Set(
      validationCopy.flatMap((candidateCombo) =>
        candidateCombo.placeCandidates.map((place) => place.name.replace(/\s+/g, "").toLowerCase()),
      ),
    );
    const finalValidation = validateCombinationOptions(validationCopy, destination, knownNames);
    if (!finalValidation.ok || validationCopy.length < result.length + 1) {
      sawValidationFailure = true;
      continue;
    }
    result.push(added);
    usedThemes.add(themeKey);
    for (const place of all) {
      usedNames.add(place.name.replace(/\s+/g, "").toLowerCase());
      if (place.googlePlaceId) usedIds.add(place.googlePlaceId);
    }
  }

  return {
    combinations: result,
    addedCount: result.length - existing.length,
    degradedReason:
      result.length >= preferredCount
        ? undefined
        : sawValidationFailure
          ? "validation_failed"
          : "insufficient_verified_candidates",
  };
}

function candidatesFromPlaces(
  destination: string,
  places: PlaceResult[],
  center: { lat: number; lng: number },
  locale: Locale = effectiveAppLocale(),
): CombinationPlaceCandidate[] {
  const candidates: CombinationPlaceCandidate[] = [];
  const seenNames = new Set<string>();
  for (const place of places) {
    const candidate = toCandidate(place, destination, center, locale);
    if (!candidate) continue;
    if (
      candidate.coordinates &&
      distanceMeters(center, { lat: candidate.coordinates.lat, lng: candidate.coordinates.lng }) >
        MAX_DISTANCE_FROM_CENTER_M * 1.5
    ) {
      continue;
    }
    const key = candidate.name.replace(/\s+/g, "").toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

function finalizeCombinationsFromCandidates(
  destination: string,
  candidates: CombinationPlaceCandidate[],
  generationRequestId: string,
): StructuredCombinationOption[] | null {
  if (candidates.length < MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS) {
    return null;
  }

  const known = new Set(candidates.map((c) => c.name.replace(/\s+/g, "").toLowerCase()));
  const districts = new Set(
    candidates.map((c) => c.district).filter((d): d is string => Boolean(d)),
  );

  let combinations = buildCombinationsFromCandidates(destination, candidates);
  let validation = validateCombinationOptions(
    combinations,
    destination,
    known,
    generationRequestId,
  );

  if (validation.ok && combinations.length >= PREFERRED_COMBINATIONS) {
    return combinations;
  }
  // Keep solid typed buckets (≥2) — do not wipe them with soft rebuild.
  if (validation.ok && combinations.length >= MIN_COMBINATIONS) {
    return combinations;
  }

  logAiPipeline(
    "[COMBINATION_DISCOVERY_FAILED]",
    `reason=${validation.reason ?? `too_few_combinations:${combinations.length}`}`,
    `resolvedPlaces=${candidates.length}`,
    `themeCount=${combinations.length}`,
    `districtCount=${districts.size}`,
  );

  // Soft rebuild: category-contract buckets (never index-stamped food/shopping titles).
  combinations = buildSoftCombinationsFromPlaces(destination, candidates);
  // Accept 2+ typed groups; theme-direction search can still top up later.
  if (combinations.length < MIN_COMBINATIONS) return null;

  validation = validateCombinationOptions(combinations, destination, known, generationRequestId);
  if (validation.ok) return combinations;
  // Soft combos from real Places — accept unless names are generic placeholders.
  if (!validation.genericPlaceNames.length && combinations.length >= 2) {
    return combinations;
  }
  return null;
}

async function searchAreaPlaces(params: {
  area: string;
  destination: string;
  lat: number;
  lng: number;
  searchPlaces: PlaceSearchFn;
  country?: string | null;
  generationRequestId: string;
  deadlineAt: number;
  locale?: Locale;
}): Promise<{
  places: PlaceResult[];
  queryLanes: DiscoveryQueryLaneRecord[];
  sourceLaneByCandidateKey: Map<string, PlanningDiscoveryQueryLane>;
}> {
  const {
    area,
    destination,
    lat,
    lng,
    searchPlaces,
    country,
    generationRequestId,
    deadlineAt,
    locale = effectiveAppLocale(),
  } = params;
  const queries = orderPlanningDiscoveryQueryLanes(
    buildDestinationDiscoveryQueries({ destination, country, area }).map((query) => ({ query })),
  ).map((item) => item.query);

  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  const queryLanes: DiscoveryQueryLaneRecord[] = [];
  const sourceLaneByCandidateKey = new Map<string, PlanningDiscoveryQueryLane>();

  for (const query of queries) {
    const lane = queryLaneForSemanticQuery(query);
    if (out.length >= 18) {
      queryLanes.push({
        lane,
        ...discoveryLaneDiagnosticContext(lane, out.length, true),
        executed: false,
        skippedReason: "candidate_cap_reached",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
      continue;
    }
    if (Date.now() > deadlineAt) {
      queryLanes.push({
        lane,
        ...discoveryLaneDiagnosticContext(lane, out.length, false),
        executed: false,
        skippedReason: "deadline_reached",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
      continue;
    }
    const cooldown = await waitIfPlacesRateLimited({
      generationRequestId,
      maxWaitMs: Math.min(8_000, Math.max(0, deadlineAt - Date.now())),
    });
    if (cooldown !== "ready") {
      queryLanes.push({
        lane,
        ...discoveryLaneDiagnosticContext(lane, out.length, false),
        executed: false,
        skippedReason: "rate_limited",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
      continue;
    }
    try {
      const uniqueCountBeforeLane = out.length;
      const result = await searchPlaces({
        data: {
          query,
          lat,
          lng,
          radius: 25_000,
          mode: "text",
          placesScreen: "chat",
          placesCaller: "combination_discovery",
          destinationName: destination,
          searchMode: "destination",
          includedTypes: [
            "tourist_attraction",
            "museum",
            "art_gallery",
            "park",
            "zoo",
            "aquarium",
            "historical_landmark",
            "cultural_landmark",
            "market",
            "shopping_mall",
            "department_store",
            "restaurant",
            "cafe",
            "bakery",
          ],
          locale,
        },
      });
      let uniqueAddedCount = 0;
      for (const place of result.places ?? []) {
        const key = rawCandidateKey(place);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(place);
        uniqueAddedCount += 1;
        sourceLaneByCandidateKey.set(key, lane);
      }
      queryLanes.push({
        lane,
        ...discoveryLaneDiagnosticContext(
          lane,
          uniqueCountBeforeLane,
          false,
          INITIAL_DISCOVERY_CANDIDATE_CAP,
          out.length,
        ),
        executed: true,
        skippedReason: "",
        resultCount: result.places?.length ?? 0,
        uniqueAddedCount,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: out.length >= 18,
      });
    } catch {
      queryLanes.push({
        lane,
        ...discoveryLaneDiagnosticContext(lane, out.length, false),
        executed: true,
        skippedReason: "request_failed",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
    }
  }

  // Nearby fallback for denser core results
  if (Date.now() <= deadlineAt) {
    try {
      const nearby = await searchPlaces({
        data: {
          query: `${destination} attractions`,
          lat,
          lng,
          radius: 12_000,
          mode: "nearby",
          placesScreen: "chat",
          placesCaller: "combination_discovery_nearby",
          destinationName: destination,
          searchMode: "destination",
          includedTypes: ["tourist_attraction", "museum", "park", "art_gallery"],
          locale,
        },
      });
      let uniqueAddedCount = 0;
      for (const place of nearby.places ?? []) {
        const key = rawCandidateKey(place);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(place);
        uniqueAddedCount += 1;
        sourceLaneByCandidateKey.set(key, "nearby_attraction");
      }
      queryLanes.push({
        lane: "nearby_attraction",
        ...discoveryLaneDiagnosticContext("nearby_attraction", out.length, false),
        executed: true,
        skippedReason: "",
        resultCount: nearby.places?.length ?? 0,
        uniqueAddedCount,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
    } catch {
      queryLanes.push({
        lane: "nearby_attraction",
        ...discoveryLaneDiagnosticContext("nearby_attraction", out.length, false),
        executed: true,
        skippedReason: "request_failed",
        resultCount: 0,
        uniqueAddedCount: 0,
        cumulativeUniqueCount: out.length,
        capReachedAfterLane: false,
      });
    }
  } else {
    queryLanes.push({
      lane: "nearby_attraction",
      ...discoveryLaneDiagnosticContext("nearby_attraction", out.length, false),
      executed: false,
      skippedReason: "deadline_reached",
      resultCount: 0,
      uniqueAddedCount: 0,
      cumulativeUniqueCount: out.length,
      capReachedAfterLane: false,
    });
  }

  return { places: out, queryLanes, sourceLaneByCandidateKey };
}

/**
 * Discover real place candidates and build validated combination options.
 * On sparse theme results, runs Fallback Discovery instead of hard-failing.
 * Returns null only when geocode + places + all fallback layers fail.
 */
export async function discoverDestinationCombinations(params: {
  destination: string;
  searchPlaces: PlaceSearchFn;
  geocodeFn?: GeocodeDestinationFn;
  locale?: Locale;
  days?: number;
  generationRequestId?: string;
  destinationCountry?: string | null;
  /** Travel Context / session coordinates when already known */
  contextCoordinates?: { lat: number; lng: number } | null;
  /** Places Autocomplete / Place Details city center */
  placesGeometry?: { lat: number; lng: number } | null;
  /** Previous-round country→city options for Destination Anchor matching */
  offeredDestinationOptions?:
    | import("@/lib/ai/destination-anchor").DestinationOptionMetadata[]
    | null;
  /** Chat / planning session — reuse Recommendation Candidate Pool */
  sessionId?: string | null;
}): Promise<StructuredCombinationOption[] | null> {
  const label = normalizeDestinationLabel(params.destination);
  const locale = params.locale ?? effectiveAppLocale();
  if (isCountryLevelDestination(label)) {
    logCountryLevelPlacesBlocked(label, "city_required");
    return setDiscoveryFailure(label, "blocked_country", "city_required");
  }
  lastDiscoveryFailure = null;
  lastFinalizedScopePatch = null;

  let country = resolveDestinationCountryLabel(label, params.destinationCountry);
  const generationRequestId =
    params.generationRequestId?.trim() || `combo_${label}_${Date.now().toString(36)}`;
  beginPlacesGenerationSession(generationRequestId);

  const startedAt = Date.now();
  const deadlineAt = startedAt + COMBINATION_DISCOVERY_TIMEOUT_MS;
  // Silent peek only — never log COMBINATION_CACHE_MISS before Destination Anchor succeeds.
  const cached = getCachedDiscoveredCombinations(label, undefined, undefined, { log: false });
  if (cached) {
    logCombinationCacheHit({
      destination: label,
      travelStyle: "any",
      group: "all",
      count: cached.length,
      source: "pre_anchor_hit",
    });
    return cached;
  }

  logAiPipeline(
    "[COMBINATION_DISCOVERY_STARTED]",
    `destination=${label}`,
    `country=${country ?? "unknown"}`,
    `generationRequestId=${generationRequestId}`,
  );

  const timedOut = () => Date.now() > deadlineAt;
  const failTimeout = () => {
    logAiPipeline(
      "[RECOMMENDATION_PIPELINE_TIMEOUT]",
      `generationRequestId=${generationRequestId}`,
      `destination=${label}`,
      `elapsedMs=${Date.now() - startedAt}`,
    );
    return setDiscoveryFailure(label, "timeout");
  };

  const waitState = await waitIfPlacesRateLimited({
    generationRequestId,
    maxWaitMs: Math.min(20_000, COMBINATION_DISCOVERY_TIMEOUT_MS),
  });
  if (waitState === "stale") {
    logAiPipeline(
      "[STALE_GENERATION_RESPONSE_IGNORED]",
      `oldRequestId=${generationRequestId}`,
      "activeRequestId=other",
    );
    return null;
  }
  if (waitState === "timeout" || timedOut()) {
    logAiPipeline(
      "[COMBINATION_DISCOVERY_STATS]",
      `destination=${label}`,
      "placesCandidates=0",
      "resolvedCandidates=0",
      "districtCount=0",
      "themeCount=0",
      "reason=places_rate_limited",
    );
    return waitState === "timeout" || timedOut()
      ? failTimeout()
      : setDiscoveryFailure(label, "places_rate_limited");
  }

  // Unified Destination Anchor — never enter Places Search without coordinates.
  const anchorResult = await resolveDestinationAnchor({
    destination: label,
    locale: params.locale ?? "zh-TW",
    countryHint: country ?? params.destinationCountry,
    contextCoordinates: params.contextCoordinates,
    placesGeometry: params.placesGeometry,
    offeredOptions: params.offeredDestinationOptions,
    geocodeFn: params.geocodeFn,
    generationRequestId,
  });

  if (anchorResult.status !== "ok") {
    const detail =
      anchorResult.reason === "destination_geocode_empty" ||
      anchorResult.reason === "anchor_geocode_empty" ||
      anchorResult.reason === "anchor_all_providers_failed" ||
      anchorResult.reason === "no_coordinates"
        ? "no_coordinates"
        : anchorResult.reason === "country_hint_missing" ||
            anchorResult.reason === "destination_country_context_missing"
          ? "country_hint_missing"
          : anchorResult.reason === "destination_anchor_invalid"
            ? "destination_anchor_invalid"
            : anchorResult.reason;
    logAiPipeline(
      "[COMBINATION_DISCOVERY_ENTRY]",
      `destination=${label}`,
      "hasCoordinates=false",
      `lat=`,
      `lng=`,
      `reason=${detail}`,
      "status=destination_resolution_failed",
    );
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      `reason=${detail}`,
      `destination=${label}`,
      "status=destination_resolution_failed",
      "retryable=true",
      `queriesTried=${(anchorResult.queriesTried ?? []).slice(0, 6).join(" | ")}`,
    );
    // Anchor failed — do NOT touch Combination Cache (no miss spam / no discovery).
    return setDiscoveryFailure(label, "destination_resolution_failed", detail);
  }

  const anchor: DestinationAnchor = anchorResult.anchor;
  let coordinates = { lat: anchor.latitude, lng: anchor.longitude };
  country = anchor.country ?? country;

  // Anchor succeeded — now Combination Cache miss may be logged once if empty.
  const postAnchorCached = getCachedDiscoveredCombinations(label, undefined, undefined, {
    log: true,
  });
  if (postAnchorCached?.length) {
    return postAnchorCached;
  }

  logAiPipeline(
    "[COMBINATION_DISCOVERY_ENTRY]",
    `destination=${label}`,
    "hasCoordinates=true",
    `lat=${anchor.latitude}`,
    `lng=${anchor.longitude}`,
    `source=${anchor.source}`,
    `countryCode=${anchor.countryCode ?? "unknown"}`,
    `destinationType=${anchor.destinationType ?? anchor.entityType ?? "unknown"}`,
  );

  const resolution = resolveDestinationForCombinations(label, coordinates, country);
  if (!resolution.coordinates) {
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      "reason=no_coordinates",
      `destination=${label}`,
      "status=destination_resolution_failed",
      "retryable=true",
    );
    logAiPipeline(
      "[DESTINATION_CANDIDATE_FETCH_FAILED]",
      `destination=${label}`,
      `countryCode=${anchor.countryCode ?? ""}`,
      `coordinates=missing`,
      "requestCount=0",
      "provider=geocode",
      "failureReason=no_coordinates",
    );
    return setDiscoveryFailure(label, "destination_resolution_failed", "no_coordinates");
  }

  const { lat, lng } = resolution.coordinates;
  const scopeValidation = validateDestinationScope({
    destination: label,
    country,
    countryCode: anchor.countryCode,
    latitude: lat,
    longitude: lng,
  });
  logAiPipeline(
    "[DESTINATION_SCOPE_BEFORE_SEARCH]",
    `destination=${label}`,
    `country=${scopeValidation.country ?? country ?? "unknown"}`,
    `lat=${lat}`,
    `lng=${lng}`,
    `source=${anchor.source}`,
  );
  if (!scopeValidation.ok) {
    const mapped: DestinationDiscoveryFailureReason =
      scopeValidation.reason === "country_unresolved"
        ? "destination_country_unresolved"
        : scopeValidation.reason === "country_coordinate_mismatch" ||
            scopeValidation.reason === "taiwan_default_fallback"
          ? "destination_coordinate_mismatch"
          : "invalid_destination_scope";
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      `reason=invalid_destination_scope:${scopeValidation.reason ?? "unknown"}`,
      `destination=${label}`,
    );
    return setDiscoveryFailure(label, mapped, scopeValidation.reason);
  }

  country = scopeValidation.country ?? country;
  const finalized = finalizeDestinationScope({
    destination: label,
    latitude: lat,
    longitude: lng,
    source:
      anchor.source === "geocode"
        ? "geocode"
        : anchor.source === "places_autocomplete"
          ? "places_geometry"
          : anchor.source === "city_centroid_cache"
            ? "cache"
            : anchor.source === "context"
              ? "scope_lock"
              : "approx_center",
    country,
    countryCode: scopeValidation.countryCode ?? countryCodeForCountryName(country),
    type: resolveDestinationEntity(label).type,
    generationRequestId,
  });
  if (finalized) {
    lastFinalizedScopePatch = buildDestinationScopeContextPatch(finalized);
  }

  const regionRadiusM = 40_000;
  logAiPipeline(
    "[REGION_SEARCH_CENTER_CREATED]",
    `center=${lat},${lng}`,
    `radius=${regionRadiusM}`,
    `destination=${label}`,
  );

  const rawPlaces: PlaceResult[] = [];
  const discoveryQueryLanes: DiscoveryQueryLaneRecord[] = [];
  const sourceLaneByCandidateKey = new Map<string, PlanningDiscoveryQueryLane>();

  // Seed from shared Candidate Pool (chat recommendations / prior planner) — 0 Places
  {
    const sessionId = params.sessionId?.trim() || generationRequestId;
    const sessionPool = readSessionCandidatePool({
      sessionId,
      destination: label,
    });
    let poolPlaces = sessionPool?.places ?? [];
    if (!poolPlaces.length) {
      const hit = readCandidatePoolCache(label, country ?? undefined);
      if (hit?.places.length) poolPlaces = hit.places;
    }
    if (poolPlaces.length) {
      rawPlaces.push(...poolPlaces);
      for (const place of poolPlaces) {
        const key = rawCandidateKey(place);
        if (key) sourceLaneByCandidateKey.set(key, "candidate_pool_seed");
      }
      logPlacesSearchSkipped({
        reason: "candidate_pool_seed_combination",
        destination: label,
        count: poolPlaces.length,
      });
    }
  }

  for (const area of resolution.searchAreas.slice(0, 4)) {
    if (shouldSkipPlanningPlacesApi() || timedOut()) break;
    if (
      getActivePlacesGenerationRequestId() &&
      getActivePlacesGenerationRequestId() !== generationRequestId
    ) {
      return null;
    }
    const cooldown = await waitIfPlacesRateLimited({
      generationRequestId,
      maxWaitMs: Math.min(15_000, Math.max(0, deadlineAt - Date.now())),
    });
    if (cooldown !== "ready") {
      logAiPipeline(
        "[COMBINATION_DISCOVERY_STATS]",
        `destination=${label}`,
        `placesCandidates=${rawPlaces.length}`,
        "resolvedCandidates=0",
        "districtCount=0",
        "themeCount=0",
        "reason=places_rate_limited",
      );
      break;
    }
    const batch = await searchAreaPlaces({
      area,
      destination: label,
      lat,
      lng,
      searchPlaces: params.searchPlaces,
      country,
      generationRequestId,
      deadlineAt,
      locale,
    });
    rawPlaces.push(...batch.places);
    discoveryQueryLanes.push(...batch.queryLanes);
    for (const [key, lane] of batch.sourceLaneByCandidateKey) {
      if (!sourceLaneByCandidateKey.has(key)) sourceLaneByCandidateKey.set(key, lane);
    }
    if (rawPlaces.length >= 24) break;
  }

  // Expand radius via secondary areas if sparse
  if (rawPlaces.length < 12 && !timedOut()) {
    for (const area of resolution.searchAreas.slice(4, 8)) {
      if (timedOut()) break;
      const cooldown = await waitIfPlacesRateLimited({
        generationRequestId,
        maxWaitMs: Math.min(10_000, Math.max(0, deadlineAt - Date.now())),
      });
      if (cooldown !== "ready") break;
      const batch = await searchAreaPlaces({
        area,
        destination: label,
        lat,
        lng,
        searchPlaces: params.searchPlaces,
        country,
        generationRequestId,
        deadlineAt,
        locale,
      });
      rawPlaces.push(...batch.places);
      discoveryQueryLanes.push(...batch.queryLanes);
      for (const [key, lane] of batch.sourceLaneByCandidateKey) {
        if (!sourceLaneByCandidateKey.has(key)) sourceLaneByCandidateKey.set(key, lane);
      }
    }
  }

  if (rawPlaces.length) {
    ingestResolvedPlacesIntoCandidatePool({
      sessionId: params.sessionId?.trim() || generationRequestId,
      destination: label,
      countryCode: scopeValidation.countryCode ?? countryCodeForCountryName(country),
      places: rawPlaces,
      source: "combination_discovery",
    });
  }

  if (timedOut() && rawPlaces.length === 0) return failTimeout();

  if (rawPlaces.length === 0) {
    logAiPipeline(
      "[DESTINATION_CANDIDATE_FETCH_FAILED]",
      `destination=${label}`,
      `countryCode=${anchor.countryCode ?? ""}`,
      `coordinates=${lat},${lng}`,
      "requestCount=places_search",
      "provider=places",
      "failureReason=empty_places_response",
    );
  }

  let candidates = candidatesFromPlaces(label, rawPlaces, { lat, lng }, locale);
  for (const candidate of candidates) {
    const sourcePlace = rawPlaces.find(
      (place) =>
        (candidate.googlePlaceId && place.id?.trim() === candidate.googlePlaceId) ||
        (place.name ?? "").replace(/\s+/g, "").toLowerCase() ===
          candidate.name.replace(/\s+/g, "").toLowerCase(),
    );
    if (sourcePlace) {
      candidate.sourceQueryLane =
        sourceLaneByCandidateKey.get(rawCandidateKey(sourcePlace)) ?? "other";
    }
  }

  for (const record of discoveryQueryLanes) {
    console.info("[PLANNING_DISCOVERY_QUERY_LANES]", record);
  }

  const uniqueRaw = new Map<string, PlaceResult>();
  for (const place of rawPlaces) {
    const key = rawCandidateKey(place);
    if (key && !uniqueRaw.has(key)) uniqueRaw.set(key, place);
  }
  const acceptedGoogleIds = new Set(
    candidates
      .map((candidate) => candidate.googlePlaceId?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const acceptedNameKeys = new Set(
    candidates.map((candidate) => candidate.name.replace(/\s+/g, "").toLowerCase()),
  );
  console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
    destinationScopePresent: Boolean(finalized),
    queryLaneCountAttempted: discoveryQueryLanes.filter((lane) => lane.executed).length,
    queryLaneCountSkipped: discoveryQueryLanes.filter((lane) => !lane.executed).length,
    rawCandidateCount: rawPlaces.length,
    uniqueCandidateCount: uniqueRaw.size,
    validGoogleIdCount: [...uniqueRaw.values()].filter((place) =>
      isHardGooglePlaceId(place.id?.trim()),
    ).length,
    operationalCount: [...uniqueRaw.values()].filter(
      (place) => place.businessStatus === "OPERATIONAL",
    ).length,
    travelEligibleCount: candidates.length,
  });
  for (const [key, place] of uniqueRaw) {
    logAffiliateFactualEvidenceLifecycle("raw_candidate", place);
    const admitted =
      (place.id && acceptedGoogleIds.has(place.id.trim())) ||
      acceptedNameKeys.has((place.name ?? "").replace(/\s+/g, "").toLowerCase());
    const candidateDiagnostic = {
      candidateHash: anonymousRawCandidateHash(place),
      sourceQueryLane: sourceLaneByCandidateKey.get(key) ?? "other",
      googleTypesFamily: resolvePlaceCategoryFamily(place),
      primaryTypeFamily: resolvePlaceCategoryFamily({
        ...place,
        types: place.primaryType ? [place.primaryType] : [],
      }),
      ratingPresent: place.rating != null,
      userRatingCountPresent: place.userRatingCount != null,
    };
    console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
      ...candidateDiagnostic,
      admissionStage: "raw",
      dropped: false,
      dropReason: "",
    });
    console.info("[PLANNING_GROUNDED_CANDIDATE_POOL]", {
      ...candidateDiagnostic,
      admissionStage: admitted ? "sanitized" : "sanitization_rejected",
      dropped: !admitted,
      dropReason: admitted ? "" : "candidate_sanitization_rejected",
    });
    const diagnosticCandidate: CombinationPlaceCandidate = {
      name: place.name ?? "",
      googlePlaceId: place.id?.trim() || undefined,
      types: place.types ?? [],
      primaryType: place.primaryType,
      address: place.address,
      rating: place.rating,
      userRatingCount: place.userRatingCount,
      businessStatus: place.businessStatus,
      sourceQueryLane: sourceLaneByCandidateKey.get(key) ?? "other",
    };
    logAttractionCandidateLifecycle(diagnosticCandidate, {
      rawPresent: true,
      sanitizedPresent: admitted,
      dropReason: admitted ? "" : "candidate_sanitization_rejected",
    });
  }

  const districts = new Set(
    candidates.map((c) => c.district).filter((d): d is string => Boolean(d)),
  );
  const themes = new Set(candidates.map(assignThemeKey));

  logAiPipeline(
    "[COMBINATION_DISCOVERY_STATS]",
    `destination=${label}`,
    `placesCandidates=${rawPlaces.length}`,
    `resolvedCandidates=${candidates.length}`,
    `districtCount=${districts.size}`,
    `themeCount=${themes.size}`,
  );
  logAiPipeline(
    "[PLACE_DISCOVERY_SUMMARY]",
    `destination=${label}`,
    `rawCount=${rawPlaces.length}`,
    `acceptedCount=${candidates.length}`,
    `rejectedCount=${Math.max(0, rawPlaces.length - candidates.length)}`,
  );
  const themeCounts: Record<string, number> = {
    landmark: 0,
    culture: 0,
    nature: 0,
    beach: 0,
    shopping: 0,
    food: 0,
    nightlife: 0,
  };
  for (const c of candidates) {
    const key = assignThemeKey(c);
    if (key in themeCounts) themeCounts[key] = (themeCounts[key] ?? 0) + 1;
    else if (/beach|海灘|海岸/i.test(key)) themeCounts.beach += 1;
    else if (/night|夜/i.test(key)) themeCounts.nightlife += 1;
    else if (/shop|購物/i.test(key)) themeCounts.shopping += 1;
    else if (/food|餐|美食/i.test(key)) themeCounts.food += 1;
    else if (/nature|自然|公園/i.test(key)) themeCounts.nature += 1;
    else if (/culture|文化|寺/i.test(key)) themeCounts.culture += 1;
    else themeCounts.landmark += 1;
  }
  logAiPipeline(
    "[CATEGORY_CLUSTER_SUMMARY]",
    `landmark=${themeCounts.landmark}`,
    `culture=${themeCounts.culture}`,
    `nature=${themeCounts.nature}`,
    `beach=${themeCounts.beach}`,
    `shopping=${themeCounts.shopping}`,
    `food=${themeCounts.food}`,
    `nightlife=${themeCounts.nightlife}`,
  );

  let combinations = finalizeCombinationsFromCandidates(label, candidates, generationRequestId);

  // Fallback Discovery: do not hard-fail on sparse themes.
  if (!combinations && !timedOut()) {
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      "reason=too_few_combinations",
      `resolvedPlaces=${candidates.length}`,
      `themeCount=${themes.size}`,
      `districtCount=${districts.size}`,
    );

    for (const mode of FALLBACK_SEARCH_MODES) {
      if (timedOut()) break;
      logAiPipeline("[COMBINATION_FALLBACK_STARTED]", `mode=${mode.mode}`);
      const fallbackPlaces = await searchFallbackPlaces({
        destination: label,
        areas: resolution.searchAreas,
        lat,
        lng,
        searchPlaces: params.searchPlaces,
        mode,
        generationRequestId,
        country,
        deadlineAt,
        locale,
      });
      const mergedPlaces = [...rawPlaces, ...fallbackPlaces];
      candidates = candidatesFromPlaces(label, mergedPlaces, { lat, lng }, locale);
      combinations = finalizeCombinationsFromCandidates(label, candidates, generationRequestId);
      if (combinations?.length) {
        logAiPipeline(
          "[COMBINATION_FALLBACK_SUCCESS]",
          `places=${candidates.length}`,
          `mode=${mode.mode}`,
          `combinationCount=${combinations.length}`,
        );
        break;
      }
    }
  }

  if (timedOut() && !combinations?.length) return failTimeout();

  // Theme-directed per-combo search: minimum (2) is degraded delivery, not
  // discovery completion. Preserve ready groups and try unused themes until 3.
  const initialCombinationCount = combinations?.length ?? 0;
  let topUpAttempted = false;
  let topUpThemeCount = 0;
  let topUpResultCount = 0;
  let degradedReason: CombinationTopUpDegradedReason | undefined;
  if ((!combinations || combinations.length < PREFERRED_COMBINATIONS) && !timedOut()) {
    topUpAttempted = true;
    const themed = await searchPlacesForThemeDirections({
      destination: label,
      country,
      lat,
      lng,
      searchPlaces: params.searchPlaces,
      generationRequestId,
      deadlineAt,
      locale,
      existingCombinations: combinations ?? [],
      targetCombinationCount: PREFERRED_COMBINATIONS,
    });
    topUpThemeCount = themed.attemptedThemeCount;
    if (initialCombinationCount >= MIN_COMBINATIONS) {
      const merged = mergeVerifiedCombinationTopUp(
        label,
        combinations ?? [],
        themed.combinations,
        PREFERRED_COMBINATIONS,
      );
      combinations = merged.combinations.length ? merged.combinations : null;
      topUpResultCount = merged.addedCount;
      degradedReason = themed.stopReason ?? merged.degradedReason;
    } else {
      // Preserve the pre-existing minimum-recovery contract for <2 groups.
      combinations =
        themed.combinations.length >= MIN_COMBINATIONS
          ? themed.combinations.slice(0, PREFERRED_COMBINATIONS)
          : combinations;
      topUpResultCount = Math.max(0, (combinations?.length ?? 0) - initialCombinationCount);
      degradedReason = themed.stopReason;
    }
  }

  const finalTopUpCombinationCount = combinations?.length ?? 0;
  const degradedDelivery =
    finalTopUpCombinationCount >= MIN_COMBINATIONS &&
    finalTopUpCombinationCount < PREFERRED_COMBINATIONS;
  if (degradedDelivery && !degradedReason) {
    degradedReason = "insufficient_verified_candidates";
  }
  logAiPipeline(
    "[COMBINATION_PREFERRED_TOP_UP]",
    `initialCombinationCount=${initialCombinationCount}`,
    `preferredCombinationCount=${PREFERRED_COMBINATIONS}`,
    `topUpAttempted=${topUpAttempted}`,
    `topUpThemeCount=${topUpThemeCount}`,
    `topUpResultCount=${topUpResultCount}`,
    `finalCombinationCount=${finalTopUpCombinationCount}`,
    `degradedDelivery=${degradedDelivery}`,
    `degradedReason=${degradedDelivery ? (degradedReason ?? "insufficient_verified_candidates") : ""}`,
  );

  // Drop any combo that still lacks enough real places (typed food/shopping may show with 2).
  if (combinations?.length) {
    combinations = enforcePlanningCombinationComposition(combinations);
    combinations = combinations.filter((c) => {
      const count = (c.primaryCandidates ?? c.placeCandidates).length;
      return count >= 2;
    });
    if (combinations.length < 2) {
      combinations = null;
    }
  }

  // Combination Localization Repair Gate — names only; never delete for English fallback.
  if (combinations?.length) {
    const gated = applyCombinationLocalizationGate(combinations, {
      locale,
      minPlacesPerCombo: 2,
      minCombinations: MIN_COMBINATIONS,
      preferredCombinations: PREFERRED_COMBINATIONS,
    });
    combinations = gated.combinations as StructuredCombinationOption[];
    logAiPipeline(
      "[COMBINATION_DELIVERY_SUMMARY]",
      `destination=${label}`,
      `tripDays=`,
      `candidatePlaceCount=${candidates.length}`,
      `validRealPlaceCount=${gated.localizationCompleteCount + gated.localizationPartialCount}`,
      `qualityRejectedCount=${gated.unreadableRejectedCount}`,
      `localizationCompleteCount=${gated.localizationCompleteCount}`,
      `localizationPartialCount=${gated.localizationPartialCount}`,
      `englishFallbackCount=${gated.englishFallbackCount}`,
      `unreadableRejectedCount=${gated.unreadableRejectedCount}`,
      `combinationTargetCount=${PREFERRED_COMBINATIONS}`,
      `combinationBuiltCount=${gated.combinations.length}`,
      `combinationDeliveredCount=${gated.combinations.length}`,
      `deliveryPass=${gated.tripCombinationDeliveryPass}`,
      `failureReason=${gated.reason ?? ""}`,
      `localizationDisplayPass=${gated.localizationDisplayPass}`,
      `minimumCombinationCountPass=${gated.minimumCombinationCountPass}`,
    );
    // Fail discovery only when no deliverable real-place combinations remain —
    // never solely because localizationCoverage < 1 / english_fallback.
    if (!combinations.length) {
      logAiPipeline(
        "[COMBINATION_DISCOVERY_FAILED]",
        "reason=combination_real_places_insufficient",
        `detail=${gated.reason ?? "no_deliverable_combinations"}`,
        `droppedForeignScript=${gated.droppedForeignScript}`,
        `droppedUnreadable=${gated.droppedUnreadable}`,
        `droppedEnglishFallback=${gated.droppedEnglishFallback}`,
      );
      return setDiscoveryFailure(
        label,
        "combination_candidates_insufficient",
        "combination_real_places_insufficient",
      );
    }
    // Localize theme titles to effective App locale (never mechanical numbered titles).
    const usedTitles = new Set<string>();
    combinations = combinations.map((c) => {
      const title = isMechanicalCombinationTitle(c.title)
        ? deriveCombinationThemeTitle(c.placeCandidates, {
            locale,
            baseTitle: c.title,
            usedTitles,
            destinationLabel: label,
          })
        : localizeCombinationThemeTitle(c.title, locale);
      usedTitles.add(title);
      return { ...c, title };
    });
  }

  if (!combinations?.length) {
    const failureReason: DestinationDiscoveryFailureReason =
      candidates.length === 0
        ? "place_discovery_failed"
        : candidates.length < MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS
          ? "real_places_below_minimum"
          : "combination_candidates_insufficient";
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      `reason=${failureReason}`,
      `resolvedPlaces=${candidates.length}`,
      `themeCount=0`,
      `districtCount=${districts.size}`,
    );
    return setDiscoveryFailure(label, failureReason, "all_layers_exhausted");
  }

  setCachedDiscoveredCombinations(label, combinations);
  for (let i = 0; i < combinations.length; i += 1) {
    const combo = combinations[i]!;
    const count = (combo.primaryCandidates ?? combo.placeCandidates).length;
    logAiPipeline("[COMBINATION_READY]", `combinationId=${i + 1}`, `realPlaceCount=${count}`);
  }
  logAiPipeline(
    "[STYLE_COMBINATION_GENERATED]",
    `combinationCount=${combinations.length}`,
    `styles=${combinations.map((c) => c.theme || c.title).join("|")}`,
  );
  logAiPipeline(
    "[COMBINATION_DISCOVERY_COMPLETED]",
    `candidateCount=${candidates.length}`,
    `combinationCount=${combinations.length}`,
    `elapsedMs=${Date.now() - startedAt}`,
  );
  return combinations;
}

/** Convert structured options to the light combination shape used by chat replies. */
export function structuredCombinationsToTitlesPlaces(
  combinations: StructuredCombinationOption[],
): Array<{ title: string; places: string[] }> {
  return combinations.map((combo) => {
    const title = isMechanicalCombinationTitle(combo.title)
      ? deriveCombinationThemeTitle(
          combo.primaryCandidates?.length ? combo.primaryCandidates : combo.placeCandidates,
          { baseTitle: combo.title },
        )
      : localizeCombinationThemeTitle(combo.title);
    // Reply surfaces effectiveDisplayName (繁中 → English readable fallback).
    const places = (
      combo.primaryCandidates?.length
        ? combo.primaryCandidates
        : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO)
    )
      .map(
        (p) =>
          p.effectiveDisplayName?.trim() || p.localizedDisplayName?.trim() || p.name?.trim() || "",
      )
      .filter(Boolean);
    return { title, places };
  });
}

export function getStructuredCombinationByIndex(
  destination: string,
  combinationId1Based: number,
): StructuredCombinationOption | null {
  const cached = getCachedDiscoveredCombinations(destination);
  if (!cached?.length) return null;
  return cached[combinationId1Based - 1] ?? null;
}

export { PRIMARY_PLACES_PER_COMBO, FALLBACK_PLACES_PER_COMBO, TARGET_PLACES_PER_COMBO };

/**
 * Ensure combinations are ready for a destination.
 * Uses curated/synthesized cache when valid; otherwise discovers via Places.
 */
export async function ensureDestinationCombinationsReady(params: {
  destination: string;
  searchPlaces: PlaceSearchFn;
  geocodeFn?: GeocodeDestinationFn;
  locale?: Locale;
  days?: number;
  generationRequestId?: string;
  destinationCountry?: string | null;
  contextCoordinates?: { lat: number; lng: number } | null;
  placesGeometry?: { lat: number; lng: number } | null;
  offeredDestinationOptions?:
    | import("@/lib/ai/destination-anchor").DestinationOptionMetadata[]
    | null;
}): Promise<{
  ok: boolean;
  combinations: StructuredCombinationOption[];
  source: "cache" | "curated_or_local" | "discovered" | "failed" | "blocked_country";
  failureReason?: DestinationDiscoveryFailureReason;
  failureDetail?: string;
  /** Distinct from real_places_below_minimum — destination never became searchable. */
  destinationResolutionFailed?: boolean;
  scopePatch?: ReturnType<typeof buildDestinationScopeContextPatch> | null;
}> {
  const label = normalizeDestinationLabel(params.destination);
  const locale = params.locale ?? effectiveAppLocale();
  if (isCountryLevelDestination(label)) {
    logCountryLevelPlacesBlocked(label, "city_required");
    return {
      ok: false,
      combinations: [],
      source: "blocked_country",
      failureReason: "blocked_country",
    };
  }
  const cached = getCachedDiscoveredCombinations(label, undefined, undefined, {
    log: false,
    locale,
  });
  if (cached?.length) {
    return { ok: true, combinations: cached, source: "cache" };
  }

  // Lazy import to avoid circular dependency with destination-travel-profile
  const { getDestinationCombinations, dropGenericCombinationLabel } =
    await import("@/lib/ai/destination-combination-suggestions");
  // Curated/local named places only — theme fallback no longer returns fake places.
  const local = getDestinationCombinations(label);
  const strongLocal = local.filter(
    (c) =>
      c.places.length >= MIN_PLACES_PER_COMBO &&
      c.places.every((p) => !dropGenericCombinationLabel(p, "not_a_real_place")),
  );
  if (strongLocal.length >= MIN_COMBINATIONS) {
    const structured: StructuredCombinationOption[] = strongLocal.map((combo, index) => ({
      combinationId: `${label}:local:${index + 1}`,
      title: localizeCombinationThemeTitle(combo.title, locale),
      theme: combo.title.replace(/組合$/, ""),
      placeCandidates: combo.places.map((name) => {
        const resolved = resolvePlaceDisplayName(name, locale);
        return {
          name: resolved.localizedDisplayName,
          localizedDisplayName: resolved.localizedDisplayName,
          originalName: resolved.originalName,
          languageCode: resolved.languageCode,
          localizationSource: resolved.localizationSource,
          searchCandidateId: `name:${resolved.localizedDisplayName}`,
          types: [],
        };
      }),
      primaryCandidates: combo.places.slice(0, PRIMARY_PLACES_PER_COMBO).map((name) => {
        const resolved = resolvePlaceDisplayName(name, locale);
        return {
          name: resolved.localizedDisplayName,
          localizedDisplayName: resolved.localizedDisplayName,
          originalName: resolved.originalName,
          languageCode: resolved.languageCode,
          localizationSource: resolved.localizationSource,
          searchCandidateId: `name:${resolved.localizedDisplayName}`,
          types: [],
        };
      }),
    }));
    // Enforce category contracts on curated seeds (e.g. 美食探索 must not keep temples).
    const contracted: StructuredCombinationOption[] = [];
    for (const combo of structured) {
      const themeKey = resolveCombinationThemeKey(combo.theme, combo.title);
      const filtered = filterPoolByCategoryContract(
        combo.placeCandidates,
        themeKey,
        combo.title,
        combo.combinationId,
      );
      const minPlaces = minPlacesForTheme(themeKey, combo.title);
      if (filtered.length < minPlaces) {
        if (themeKey === "food") {
          logCombinationFoodGap({
            required: minPlaces,
            available: filtered.length,
            missing: Math.max(0, minPlaces - filtered.length),
          });
        }
        continue;
      }
      const primary = filtered.slice(0, PRIMARY_PLACES_PER_COMBO);
      if (themeKey === "food") {
        const foodCheck = validateFoodCombinationPlaces(primary, {
          combinationId: combo.combinationId,
          requiredCount: primary.length,
        });
        if (!foodCheck.passed) continue;
      }
      contracted.push({
        ...combo,
        placeCandidates: filtered,
        primaryCandidates: primary,
        fallbackCandidates: filtered.slice(PRIMARY_PLACES_PER_COMBO),
      });
    }
    const groundedContracted = contracted.filter((combo) => {
      const primary = combo.primaryCandidates?.length
        ? combo.primaryCandidates
        : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO);
      return (
        primary.length >= 2 && primary.every((place) => isHardGooglePlaceId(place.googlePlaceId))
      );
    });
    if (groundedContracted.length >= MIN_COMBINATIONS) {
      const gatedLocal = applyCombinationLocalizationGate(groundedContracted, {
        locale,
        minPlacesPerCombo: 2,
        minCombinations: MIN_COMBINATIONS,
        preferredCombinations: PREFERRED_COMBINATIONS,
      });
      // Deliver when Repair Gate kept ≥ MIN real-place combos (English fallback OK).
      if (
        gatedLocal.tripCombinationDeliveryPass ||
        gatedLocal.combinations.length >= MIN_COMBINATIONS
      ) {
        const localized = gatedLocal.combinations as StructuredCombinationOption[];
        setCachedDiscoveredCombinations(label, localized);
        return { ok: true, combinations: localized, source: "curated_or_local" };
      }
    }
    // A curated label is a search seed, not a selectable candidate. If it has
    // no grounded identity, continue through the existing Places discovery
    // below instead of caching a name-only option as ready.
  }

  const discovered = await discoverDestinationCombinations(params);
  if (discovered?.length) {
    return {
      ok: true,
      combinations: discovered,
      source: "discovered",
      scopePatch: lastFinalizedScopePatch,
    };
  }

  const failureReason = lastDiscoveryFailure?.reason ?? "places_no_results";
  const destinationResolutionFailed =
    failureReason === "destination_resolution_failed" ||
    lastDiscoveryFailure?.detail === "no_coordinates";

  return {
    ok: false,
    combinations: [],
    source: "failed",
    failureReason,
    failureDetail: lastDiscoveryFailure?.detail,
    destinationResolutionFailed,
    scopePatch: lastFinalizedScopePatch,
  };
}

export function needsDestinationCombinationDiscovery(destination: string): boolean {
  const label = normalizeDestinationLabel(destination);
  if (!label) return false;
  if (isCountryLevelDestination(label)) return false;
  if (getCachedDiscoveredCombinations(label)?.length) return false;
  // Curated cities short-circuit inside ensureDestinationCombinationsReady;
  // call discovery path whenever destination is known and cache is empty.
  return true;
}

export function logDestinationGeocodeHint(destination: string): void {
  const queries = buildDestinationGeocodeQueries(destination);
  logAiPipeline(
    "[DESTINATION_RESOLVED]",
    `input=${destination}`,
    `geocodeQueries=${queries.slice(0, 4).join("|")}`,
  );
}
