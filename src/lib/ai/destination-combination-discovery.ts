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
import { shouldSkipPlanningPlacesApi, waitIfPlacesRateLimited } from "@/lib/ai/planning-candidate-pool";
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
import {
  resolveDestinationAnchor,
  type DestinationAnchor,
} from "@/lib/ai/destination-anchor";
import { beginPlacesGenerationSession, getActivePlacesGenerationRequestId } from "@/lib/places-api-guard";
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
  /** Coarse category from Google types + name signals (category contract). */
  normalizedCategory?: NormalizedPlaceCategory;
  /** Combination id this place was validated into (1-based when offered). */
  combinationId?: string;
  /** Pre-localization / local-script name */
  originalName?: string;
  /** App-locale display name (UI / chat must prefer this) */
  localizedDisplayName?: string;
  languageCode?: string;
  localizationSource?: PlaceNameLocalizationSource | string;
  englishName?: string;
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

export const INSUFFICIENT_COMBINATION_PLACES_MESSAGE =
  "目前暫時無法取得景點資料。";

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
  if (
    blob.includes("anchor_type_rejected") ||
    blob.includes("destination_anchor_invalid")
  ) {
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
    if (
      blob.includes("geocode_request_denied") ||
      blob.includes("REQUEST_DENIED")
    ) {
      return `目前無法解析${label}的位置（地圖服務授權失敗：REQUEST_DENIED），請稍後再試或換一個城市名稱。`;
    }
    if (
      blob.includes("geocode_over_query_limit") ||
      blob.includes("geocode_rate_limited")
    ) {
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
  if (
    blob.includes("place_discovery_failed") ||
    blob.includes("places_no_results")
  ) {
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
const MAX_DISTANCE_FROM_CENTER_M = 55_000;

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
    typeHint: /park|zoo|garden|natural/i,
    nameHint: /公園|動物園|綠地|湖|草原|步道|濕地/,
  },
  {
    key: "coast",
    title: "海岸夕陽組合",
    typeHint: /marina|beach|natural_feature|park/i,
    nameHint: /漁港|海岸|海灘|濱海|濕地|碼頭|天梯|漁會|港/,
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
    typeHint: /park|natural/i,
    nameHint: /山|湖|牧場|森林|露營|溫泉|農場|溪/,
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
    return localizeCachedCombinations(layered, locale);
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
  return localizeCachedCombinations(cached.combinations, locale);
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
  const coords =
    coordinates ?? resolveDestinationApproxCenter(displayName, country) ?? null;

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
    place.localizedDisplayName?.trim() ||
    place.name?.trim() ||
    place.originalName?.trim() ||
    ""
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
        place.localizationSource === "english" ||
        place.localizationSource === "english_fallback"
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
): {
  primary: CombinationPlaceCandidate[];
  fallback: CombinationPlaceCandidate[];
  all: CombinationPlaceCandidate[];
} {
  const sorted = [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
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
  const blob = `${candidate.name} ${candidate.types.join(" ")} ${candidate.primaryType ?? ""}`;
  for (const theme of THEME_DEFS) {
    if (theme.typeHint.test(blob) || theme.nameHint.test(candidate.name)) {
      return theme.key;
    }
  }
  return "attraction";
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

function minPlacesForTheme(themeKey: string, title?: string): number {
  return themeRequiresCategoryContract(themeKey, title)
    ? MIN_TYPED_COMBO_PLACES
    : MIN_PLACES_PER_COMBO;
}

function buildCombinationsFromCandidates(
  destination: string,
  candidates: CombinationPlaceCandidate[],
): StructuredCombinationOption[] {
  const byTheme = new Map<string, CombinationPlaceCandidate[]>();
  for (const theme of THEME_DEFS) byTheme.set(theme.key, []);

  for (const candidate of candidates) {
    const key = assignThemeKey(candidate);
    const list = byTheme.get(key) ?? byTheme.get("attraction")!;
    list.push(candidate);
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
    const validated = filterPoolByCategoryContract(
      pool,
      theme.key,
      theme.title,
      combinationId,
    );
    const minPlaces = minPlacesForTheme(theme.key, theme.title);
    if (validated.length < minPlaces) continue;
    const { primary, fallback, all } = splitPrimaryFallback(validated);
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
  const leftover = candidates.filter(
    (p) => !used.has(p.name.replace(/\s+/g, "").toLowerCase()),
  );
  let idx = 0;
  const usedTitles = new Set(combos.map((c) => c.title));
  while (combos.length < MAX_COMBINATIONS && leftover.length - idx >= MIN_PLACES_PER_COMBO) {
    const chunk = leftover.slice(idx, idx + TARGET_PLACES_PER_COMBO);
    idx += TARGET_PLACES_PER_COMBO;
    if (chunk.length < MIN_PLACES_PER_COMBO) break;
    const { primary, fallback, all } = splitPrimaryFallback(chunk);
    for (const p of all) used.add(p.name.replace(/\s+/g, "").toLowerCase());
    const themeKey = assignThemeKey(all[0]!);
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

    const minPlaces =
      themeRequiresCategoryContract(slot.themeKey) ? MIN_TYPED_COMBO_PLACES : MIN_PLACES_PER_COMBO;
    if (validated.length < minPlaces) continue;

    const { primary, fallback, all } = splitPrimaryFallback(validated);
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
  const leftover = usable.filter(
    (p) => !used.has(p.name.replace(/\s+/g, "").toLowerCase()),
  );
  if (combos.length < MAX_COMBINATIONS && leftover.length >= MIN_PLACES_PER_COMBO) {
    const { primary, fallback, all } = splitPrimaryFallback(leftover);
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
async function searchPlacesForThemeDirections(params: {
  destination: string;
  country?: string | null;
  lat: number;
  lng: number;
  searchPlaces: PlaceSearchFn;
  generationRequestId: string;
  deadlineAt: number;
  locale?: Locale;
}): Promise<StructuredCombinationOption[]> {
  const {
    destination,
    country,
    lat,
    lng,
    searchPlaces,
    generationRequestId,
    deadlineAt,
    locale = effectiveAppLocale(),
  } = params;
  const directions = buildThemeSearchDirections(destination, country);
  const usedKeys = new Set<string>();
  const ready: StructuredCombinationOption[] = [];

  for (const direction of directions) {
    if (Date.now() > deadlineAt) break;

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

    const themeKeyForSearch = resolveCombinationThemeKey(direction.themeKey, direction.title);
    const queries = [
      ...direction.queries,
      ...categoryThemeSearchQueries(themeKeyForSearch, destination),
    ];
    const uniqueQueries = [...new Set(queries)].slice(0, 8);
    const includedTypes = includedTypesForTheme(themeKeyForSearch);

    const raw: PlaceResult[] = [];
    const seen = new Set<string>();
    for (const query of uniqueQueries) {
      if (raw.length >= 12 || Date.now() > deadlineAt) break;
      const cooldown = await waitIfPlacesRateLimited({
        generationRequestId,
        maxWaitMs: Math.min(8_000, Math.max(0, deadlineAt - Date.now())),
      });
      if (cooldown !== "ready") break;
      try {
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
        for (const place of result.places ?? []) {
          const key = (place.id ?? place.name ?? "").trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          raw.push(place);
        }
      } catch {
        // continue other queries for this theme only
      }
    }

    const scoped = candidatesFromPlaces(destination, raw, { lat, lng }, locale).filter((c) => {
      const key = c.name.replace(/\s+/g, "").toLowerCase();
      if (usedKeys.has(key)) return false;
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

    const minPlaces = minPlacesForTheme(themeKey, direction.title);
    if (candidates.length < minPlaces) {
      // Per-combo failure: skip this theme only — do not wipe other ready combos.
      continue;
    }

    const { primary, fallback, all } = splitPrimaryFallback(candidates);
    for (const p of all) {
      usedKeys.add(p.name.replace(/\s+/g, "").toLowerCase());
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
    logAiPipeline(
      "[COMBINATION_READY]",
      `combinationId=${direction.combinationId}`,
      `realPlaceCount=${all.length}`,
    );
  }

  return ready;
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
      distanceMeters(
        center,
        { lat: candidate.coordinates.lat, lng: candidate.coordinates.lng },
      ) > MAX_DISTANCE_FROM_CENTER_M * 1.5
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

  const known = new Set(
    candidates.map((c) => c.name.replace(/\s+/g, "").toLowerCase()),
  );
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

  validation = validateCombinationOptions(
    combinations,
    destination,
    known,
    generationRequestId,
  );
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
}): Promise<PlaceResult[]> {
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
  const queries = buildDestinationDiscoveryQueries({
    destination,
    country,
    area,
  });

  const out: PlaceResult[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    if (out.length >= 18) break;
    if (Date.now() > deadlineAt) break;
    const cooldown = await waitIfPlacesRateLimited({
      generationRequestId,
      maxWaitMs: Math.min(8_000, Math.max(0, deadlineAt - Date.now())),
    });
    if (cooldown !== "ready") break;
    try {
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
      for (const place of result.places ?? []) {
        const key = (place.id ?? place.name ?? "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(place);
      }
    } catch {
      // continue other queries
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
      for (const place of nearby.places ?? []) {
        const key = (place.id ?? place.name ?? "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(place);
      }
    } catch {
      // ignore
    }
  }

  return out;
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
  offeredDestinationOptions?: import("@/lib/ai/destination-anchor").DestinationOptionMetadata[] | null;
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
    params.generationRequestId?.trim() ||
    `combo_${label}_${Date.now().toString(36)}`;
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
    rawPlaces.push(...batch);
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
      rawPlaces.push(...batch);
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

  let candidates = candidatesFromPlaces(label, rawPlaces, { lat, lng }, locale);

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

  let combinations = finalizeCombinationsFromCandidates(
    label,
    candidates,
    generationRequestId,
  );

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
      combinations = finalizeCombinationsFromCandidates(
        label,
        candidates,
        generationRequestId,
      );
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

  // Theme-directed per-combo search: fill missing themes without wiping ready ones.
  if (
    (!combinations || combinations.length < MIN_COMBINATIONS) &&
    !timedOut()
  ) {
    const themed = await searchPlacesForThemeDirections({
      destination: label,
      country,
      lat,
      lng,
      searchPlaces: params.searchPlaces,
      generationRequestId,
      deadlineAt,
      locale,
    });
    if (themed.length) {
      const byTitle = new Map<string, StructuredCombinationOption>();
      for (const c of combinations ?? []) byTitle.set(c.title, c);
      for (const c of themed) {
        const existing = byTitle.get(c.title);
        if (
          !existing ||
          (existing.placeCandidates?.length ?? 0) < (c.placeCandidates?.length ?? 0)
        ) {
          byTitle.set(c.title, c);
        }
      }
      const merged = [...byTitle.values()].filter(
        (c) => (c.primaryCandidates ?? c.placeCandidates).length >= MIN_PLACES_PER_COMBO,
      );
      if (merged.length >= Math.min(MIN_COMBINATIONS, themed.length) || merged.length >= 3) {
        combinations = merged.slice(0, MAX_COMBINATIONS);
      } else if (merged.length > (combinations?.length ?? 0)) {
        combinations = merged;
      }
    }
  }

  // Drop any combo that still lacks enough real places (typed food/shopping may show with 2).
  if (combinations?.length) {
    combinations = combinations.filter((c) => {
      const count = (c.primaryCandidates ?? c.placeCandidates).length;
      return count >= minPlacesForTheme(c.theme, c.title);
    });
    if (combinations.length < 2) {
      combinations = null;
    }
  }

  // Combination Localization Gate — must pass before chat delivery / cache write.
  if (combinations?.length) {
    const gated = applyCombinationLocalizationGate(combinations, {
      locale,
      minPlacesPerCombo: 2,
      minCombinations: MIN_COMBINATIONS,
    });
    combinations = gated.combinations as StructuredCombinationOption[];
    if (!combinations.length) {
      logAiPipeline(
        "[COMBINATION_DISCOVERY_FAILED]",
        "reason=combination_localization_gate",
        `detail=${gated.reason ?? "unreadable"}`,
        `droppedForeignScript=${gated.droppedForeignScript}`,
      );
      return setDiscoveryFailure(
        label,
        "combination_candidates_insufficient",
        "combination_localization_gate",
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
    logAiPipeline(
      "[COMBINATION_READY]",
      `combinationId=${i + 1}`,
      `realPlaceCount=${count}`,
    );
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
          combo.primaryCandidates?.length
            ? combo.primaryCandidates
            : combo.placeCandidates,
          { baseTitle: combo.title },
        )
      : localizeCombinationThemeTitle(combo.title);
    // Reply surfaces localizedDisplayName only — never raw name / english fallback.
    const places = (combo.primaryCandidates?.length
      ? combo.primaryCandidates
      : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO)
    )
      .map((p) => p.localizedDisplayName?.trim() || "")
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

export {
  PRIMARY_PLACES_PER_COMBO,
  FALLBACK_PLACES_PER_COMBO,
  TARGET_PLACES_PER_COMBO,
};

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
  offeredDestinationOptions?: import("@/lib/ai/destination-anchor").DestinationOptionMetadata[] | null;
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
  const { getDestinationCombinations, dropGenericCombinationLabel } = await import(
    "@/lib/ai/destination-combination-suggestions"
  );
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
    if (contracted.length >= MIN_COMBINATIONS) {
      const gatedLocal = applyCombinationLocalizationGate(contracted, {
        locale,
        minPlacesPerCombo: 2,
        minCombinations: MIN_COMBINATIONS,
      });
      if (gatedLocal.combinations.length >= MIN_COMBINATIONS) {
        const localized = gatedLocal.combinations as StructuredCombinationOption[];
        setCachedDiscoveredCombinations(label, localized);
        return { ok: true, combinations: localized, source: "curated_or_local" };
      }
    }
    // Curated seeds failed food/shopping contracts — fall through to Places discovery.
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
