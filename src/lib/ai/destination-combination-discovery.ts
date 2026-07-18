/**
 * Destination-agnostic combination discovery via Places category search.
 * Combinations are built only from resolved real place candidates — never from
 * destination + category-label templates.
 */
import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { GeocodeDestinationFn } from "@/lib/ai/destination-geocode";
import {
  geocodeDestinationWithFallback,
  resolveDestinationApproxCenter,
  clearDestinationGeocodeCache,
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
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import {
  isLikelyPlaceName,
  normalizePlaceCandidateName,
  logNonPlaceCandidateRejected,
} from "@/lib/ai/place-name-likelihood";
import {
  resolveDestinationCoordinates,
  validateDestinationScope,
  resolveDestinationCountryLabel,
  clearResolvedDestinationScope,
  enrichDestinationCountry,
  finalizeDestinationScope,
  buildDestinationScopeContextPatch,
  countryCodeForCountryName,
} from "@/lib/ai/resolved-destination-scope";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import { beginPlacesGenerationSession, getActivePlacesGenerationRequestId } from "@/lib/places-api-guard";
import {
  buildDestinationDiscoveryQueries,
  buildDestinationSearchAreas,
  buildThemeSearchDirections,
  resolveDiscoveryRegionProfile,
} from "@/lib/ai/destination-discovery-queries";

/** Soft ceiling — stop discovery rather than hang forever on rate limits. */
const COMBINATION_DISCOVERY_TIMEOUT_MS = 45_000;

export type CombinationPlaceCandidate = {
  name: string;
  googlePlaceId?: string;
  searchCandidateId?: string;
  coordinates?: { lat: number; lng: number };
  address?: string;
  district?: string;
  types: string[];
  primaryType?: string | null;
  rating?: number | null;
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
  | "destination_country_unresolved"
  | "destination_coordinate_mismatch"
  | "places_no_results"
  | "places_rate_limited"
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
  if (
    r.includes("country_unresolved") ||
    r.includes("destination_country") ||
    r === "country_unresolved"
  ) {
    return `目前暫時無法確認${label}的國家範圍，請稍後再試一次。`;
  }
  if (
    r.includes("coordinate_mismatch") ||
    r.includes("taiwan_default") ||
    r.includes("invalid_destination_scope")
  ) {
    return `目前暫時無法確認${label}的目的地範圍，請稍後再試或換個寫法。`;
  }
  if (r.includes("rate_limited") || r.includes("timeout")) {
    return `目前服務較忙碌，暫時無法整理${label}的推薦，請稍後再試。`;
  }
  return `目前暫時無法取得${label}的景點資料。\n\n你可以點「重新整理推薦」再試一次。`;
}

export const REFRESH_DESTINATION_RECOMMENDATIONS_OPTION = "重新整理推薦";

const MIN_COMBINATIONS = 3;
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
    key: "market",
    title: "商圈市集組合",
    typeHint: /market|shopping_mall|store|tourist_attraction/i,
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
    typeHint: /park|natural|tourist_attraction/i,
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

const discoveryCache = new Map<string, StructuredCombinationOption[]>();
const validationLogKeys = new Set<string>();

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

export function getCachedDiscoveredCombinations(
  destination: string,
): StructuredCombinationOption[] | null {
  const key = normalizeDestinationLabel(destination);
  const cached = discoveryCache.get(key);
  return cached?.length ? cached : null;
}

export function setCachedDiscoveredCombinations(
  destination: string,
  combinations: StructuredCombinationOption[],
): void {
  discoveryCache.set(normalizeDestinationLabel(destination), combinations);
}

export function clearDiscoveredCombinationsCache(destination?: string): void {
  if (!destination) {
    discoveryCache.clear();
    return;
  }
  discoveryCache.delete(normalizeDestinationLabel(destination));
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
  return (place.name ?? "").trim();
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

function splitPrimaryFallback(
  pool: CombinationPlaceCandidate[],
): {
  primary: CombinationPlaceCandidate[];
  fallback: CombinationPlaceCandidate[];
  all: CombinationPlaceCandidate[];
} {
  const sorted = [...pool].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const primary = sorted.slice(0, PRIMARY_PLACES_PER_COMBO);
  const fallback = sorted.slice(
    PRIMARY_PLACES_PER_COMBO,
    PRIMARY_PLACES_PER_COMBO + FALLBACK_PLACES_PER_COMBO,
  );
  return { primary, fallback, all: [...primary, ...fallback] };
}

function toCandidate(
  place: PlaceResult,
  destination: string,
  center?: { lat: number; lng: number } | null,
): CombinationPlaceCandidate | null {
  const rawName = placeNameOf(place);
  if (!rawName) return null;
  if (isGenericDestinationPlaceholder(rawName, destination)) return null;
  if (isNonAttractionPlace(place)) return null;

  const normalized = normalizePlaceCandidateName(rawName);
  if (!normalized.accepted) {
    logNonPlaceCandidateRejected(
      rawName,
      normalized.reason ?? "rejected_non_place",
      "places_discovery_to_candidate",
    );
    return null;
  }
  const name = normalized.normalized;

  const lat = place.lat;
  const lng = place.lng;
  const candidate: CombinationPlaceCandidate = {
    name,
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
    combo.placeCandidates = kept;
    combo.primaryCandidates = kept.slice(0, PRIMARY_PLACES_PER_COMBO);
    combo.fallbackCandidates = kept.slice(PRIMARY_PLACES_PER_COMBO);
    logAiPipeline(
      "[COMBINATION_PLACE_VALIDATION]",
      `combinationId=${combo.combinationId}`,
      `rawCount=${rawCount}`,
      `validRealPlaces=${kept.length}`,
      `rejectedNonPlaces=${rejectedNonPlaces}`,
    );
    if (kept.length < MIN_PLACES_PER_COMBO) {
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
    if (combo.placeCandidates.length < MIN_PLACES_PER_COMBO) {
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
    if (pool.length < MIN_PLACES_PER_COMBO) continue;
    const { primary, fallback, all } = splitPrimaryFallback(pool);
    if (all.length < MIN_PLACES_PER_COMBO) continue;
    for (const p of all) used.add(p.name.replace(/\s+/g, "").toLowerCase());
    combos.push({
      combinationId: `${normalizeDestinationLabel(destination)}:${theme.key}:${combos.length + 1}`,
      title: theme.title,
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
    let title = themeMeta.title;
    if (usedTitles.has(title)) {
      title = `推薦景點組合 ${combos.length + 1}`;
    }
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

/** Soft theme titles when Places exist but theme bucketing is sparse. */
const SOFT_COMBO_TITLES = [
  "自然風景組合",
  "咖啡散步組合",
  "人氣美食組合",
  "購物散策組合",
] as const;

/**
 * Build combinations from a flat popular-places pool when themed discovery
 * cannot fill enough buckets. Requires >= MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS.
 */
function buildSoftCombinationsFromPlaces(
  destination: string,
  candidates: CombinationPlaceCandidate[],
): StructuredCombinationOption[] {
  const usable = candidates.filter((c) => c.name.trim().length >= 2);
  if (usable.length < MIN_RESOLVED_PLACES_FOR_SOFT_COMBOS) return [];

  const combos: StructuredCombinationOption[] = [];
  const chunkSize = Math.max(
    MIN_PLACES_PER_COMBO,
    Math.ceil(usable.length / Math.min(SOFT_COMBO_TITLES.length, MAX_COMBINATIONS)),
  );

  for (let i = 0; i < SOFT_COMBO_TITLES.length && combos.length < MAX_COMBINATIONS; i += 1) {
    const start = i * chunkSize;
    const slice = usable.slice(start, start + chunkSize);
    if (slice.length < MIN_PLACES_PER_COMBO) {
      // Borrow from head of pool when tail is thin
      const borrow = usable.slice(0, MIN_PLACES_PER_COMBO);
      if (borrow.length < MIN_PLACES_PER_COMBO) break;
      const { primary, fallback, all } = splitPrimaryFallback(
        [...slice, ...borrow].filter(
          (p, idx, arr) =>
            arr.findIndex(
              (x) => x.name.replace(/\s+/g, "").toLowerCase() === p.name.replace(/\s+/g, "").toLowerCase(),
            ) === idx,
        ),
      );
      if (all.length < MIN_PLACES_PER_COMBO) break;
      combos.push({
        combinationId: `${normalizeDestinationLabel(destination)}:soft:${combos.length + 1}`,
        title: SOFT_COMBO_TITLES[i]!,
        theme: "soft",
        placeCandidates: all,
        primaryCandidates: primary,
        fallbackCandidates: fallback,
      });
      continue;
    }
    const { primary, fallback, all } = splitPrimaryFallback(slice);
    combos.push({
      combinationId: `${normalizeDestinationLabel(destination)}:soft:${combos.length + 1}`,
      title: SOFT_COMBO_TITLES[i]!,
      theme: "soft",
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
      `${en ?? area} attractions`,
      `${en ?? area} cafe`,
      `${area} 景點`,
      `${area} 咖啡`,
    ],
    includedTypes: ["tourist_attraction", "cafe", "coffee_shop", "park"],
  },
  {
    mode: "popular_plus_food",
    queries: (area, en) => [
      `${en ?? area} restaurant`,
      `${en ?? area} food`,
      `${area} 景點`,
      `${area} 美食`,
    ],
    includedTypes: ["tourist_attraction", "restaurant", "market"],
  },
  {
    mode: "popular_plus_shopping",
    queries: (area, en, profile) => {
      if (profile === "taiwan") {
        return [`${area} 景點`, `${area} 商圈`, `${area} 購物`, ...(en ? [`${en} shopping`] : [])];
      }
      return [
        `${en ?? area} market`,
        `${en ?? area} shopping`,
        `${area} 景點`,
        ...(en ? [`${en} market`] : []),
      ];
    },
    includedTypes: ["tourist_attraction", "shopping_mall", "market"],
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
}): Promise<PlaceResult[]> {
  const { destination, areas, lat, lng, searchPlaces, mode, generationRequestId, country, deadlineAt } =
    params;
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
}): Promise<StructuredCombinationOption[]> {
  const { destination, country, lat, lng, searchPlaces, generationRequestId, deadlineAt } =
    params;
  const directions = buildThemeSearchDirections(destination, country);
  const usedKeys = new Set<string>();
  const ready: StructuredCombinationOption[] = [];

  for (const direction of directions) {
    if (Date.now() > deadlineAt) break;

    logAiPipeline(
      "[COMBINATION_THEME_CREATED]",
      `combinationId=${direction.combinationId}`,
      `title=${direction.title}`,
      `queries=[${direction.queries.slice(0, 6).join("|")}]`,
    );
    logAiPipeline(
      "[COMBINATION_REAL_PLACE_SEARCH_STARTED]",
      `combinationId=${direction.combinationId}`,
      `destination=${destination}`,
      `queryCount=${direction.queries.length}`,
    );

    const raw: PlaceResult[] = [];
    const seen = new Set<string>();
    for (const query of direction.queries.slice(0, 6)) {
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

    const candidates = candidatesFromPlaces(destination, raw, { lat, lng }).filter((c) => {
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

    logAiPipeline(
      "[COMBINATION_REAL_PLACE_RESOLVED]",
      `combinationId=${direction.combinationId}`,
      `candidateCount=${raw.length}`,
      `resolvedCount=${candidates.length}`,
    );

    if (candidates.length < MIN_PLACES_PER_COMBO) {
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

    ready.push({
      combinationId: `${normalizeDestinationLabel(destination)}:theme:${direction.combinationId}`,
      title: direction.title,
      theme: direction.themeKey,
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
): CombinationPlaceCandidate[] {
  const candidates: CombinationPlaceCandidate[] = [];
  const seenNames = new Set<string>();
  for (const place of places) {
    const candidate = toCandidate(place, destination, center);
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

  // Soft rebuild: themed buckets optional when we already have enough Places.
  combinations = buildSoftCombinationsFromPlaces(destination, candidates);
  if (combinations.length < MIN_COMBINATIONS) return null;

  validation = validateCombinationOptions(
    combinations,
    destination,
    known,
    generationRequestId,
  );
  if (validation.ok) return combinations;
  // Soft combos from real Places — accept unless names are generic placeholders.
  if (!validation.genericPlaceNames.length) {
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
}): Promise<PlaceResult[]> {
  const { area, destination, lat, lng, searchPlaces, country, generationRequestId, deadlineAt } =
    params;
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
          ],
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
}): Promise<StructuredCombinationOption[] | null> {
  const label = normalizeDestinationLabel(params.destination);
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
  const cached = getCachedDiscoveredCombinations(label);
  if (cached) return cached;

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

  // Prefer locked / approx / places geometry before burning Geocode quota.
  // Enrich country from coords before validation — never leave country=unknown + TW coords.
  let coordResult = resolveDestinationCoordinates({
    destination: label,
    country,
    approxCenter: resolveDestinationApproxCenter(label, country),
    generationRequestId,
  });
  let coordinates = coordResult.coordinates;
  if (coordResult.scope?.country) {
    country = coordResult.scope.country;
  } else if (coordinates) {
    const enriched = enrichDestinationCountry({
      destination: label,
      country,
      latitude: coordinates.lat,
      longitude: coordinates.lng,
    });
    if (enriched.country) country = enriched.country;
  }

  if (params.geocodeFn && !coordinates) {
    const geo = await geocodeDestinationWithFallback({
      destination: label,
      locale: params.locale ?? "zh-TW",
      geocodeFn: params.geocodeFn,
      preferCachedCoordinates: true,
    });
    if (geo?.lat != null && geo?.lng != null) {
      const enriched = enrichDestinationCountry({
        destination: label,
        country: country ?? geo.country,
        latitude: geo.lat,
        longitude: geo.lng,
      });
      if (enriched.country) country = enriched.country;
      const v = validateDestinationScope({
        destination: label,
        country,
        countryCode: enriched.countryCode,
        latitude: geo.lat,
        longitude: geo.lng,
      });
      if (v.ok) {
        coordinates = { lat: geo.lat, lng: geo.lng };
        country = v.country ?? country;
        finalizeDestinationScope({
          destination: label,
          latitude: geo.lat,
          longitude: geo.lng,
          source: "geocode",
          country: v.country,
          countryCode: v.countryCode,
          type: resolveDestinationEntity(label).type,
          generationRequestId,
        });
      } else {
        clearResolvedDestinationScope(label);
      }
    }
  }

  // Still no coords: retry live geocode (bypass failed cache) then approx again.
  if (!coordinates && params.geocodeFn) {
    clearDestinationGeocodeCache(label);
    const geoRetry = await geocodeDestinationWithFallback({
      destination: label,
      locale: params.locale ?? "zh-TW",
      geocodeFn: params.geocodeFn,
      preferCachedCoordinates: false,
    });
    if (geoRetry?.lat != null && geoRetry?.lng != null) {
      const enriched = enrichDestinationCountry({
        destination: label,
        country: country ?? geoRetry.country,
        latitude: geoRetry.lat,
        longitude: geoRetry.lng,
      });
      if (enriched.country) country = enriched.country;
      const v = validateDestinationScope({
        destination: label,
        country,
        countryCode: enriched.countryCode,
        latitude: geoRetry.lat,
        longitude: geoRetry.lng,
      });
      if (v.ok) {
        coordinates = { lat: geoRetry.lat, lng: geoRetry.lng };
        country = v.country ?? country;
        finalizeDestinationScope({
          destination: label,
          latitude: geoRetry.lat,
          longitude: geoRetry.lng,
          source: "geocode",
          country: v.country,
          countryCode: v.countryCode,
          type: resolveDestinationEntity(label).type,
          generationRequestId,
        });
      }
    }
  }
  if (!coordinates) {
    coordinates = resolveDestinationApproxCenter(label, country);
    if (coordinates) {
      const enriched = enrichDestinationCountry({
        destination: label,
        country,
        latitude: coordinates.lat,
        longitude: coordinates.lng,
      });
      if (enriched.country) country = enriched.country;
    }
  }

  const resolution = resolveDestinationForCombinations(label, coordinates, country);
  if (!resolution.coordinates) {
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      "reason=no_coordinates",
      `destination=${label}`,
      "resolvedPlaces=0",
      "themeCount=0",
      "districtCount=0",
    );
    logAiPipeline(
      "[COMBINATION_DISCOVERY_STATS]",
      `destination=${label}`,
      "placesCandidates=0",
      "resolvedCandidates=0",
      "districtCount=0",
      "themeCount=0",
      "reason=no_coordinates",
    );
    return setDiscoveryFailure(label, "destination_resolution_failed", "no_coordinates");
  }

  const { lat, lng } = resolution.coordinates;
  const scopeValidation = validateDestinationScope({
    destination: label,
    country,
    latitude: lat,
    longitude: lng,
  });
  logAiPipeline(
    "[DESTINATION_SCOPE_BEFORE_SEARCH]",
    `destination=${label}`,
    `country=${scopeValidation.country ?? country ?? "unknown"}`,
    `lat=${lat}`,
    `lng=${lng}`,
    `source=resolved`,
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
    source: coordResult.source ?? "approx_center",
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
      });
      rawPlaces.push(...batch);
    }
  }

  if (timedOut() && rawPlaces.length === 0) return failTimeout();

  let candidates = candidatesFromPlaces(label, rawPlaces, { lat, lng });

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
      });
      const mergedPlaces = [...rawPlaces, ...fallbackPlaces];
      candidates = candidatesFromPlaces(label, mergedPlaces, { lat, lng });
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

  // Drop any combo that still lacks enough real places (never show thin/generic groups).
  if (combinations?.length) {
    combinations = combinations.filter(
      (c) => (c.primaryCandidates ?? c.placeCandidates).length >= MIN_PLACES_PER_COMBO,
    );
    if (combinations.length < 3) {
      combinations = null;
    }
  }

  if (!combinations?.length) {
    logAiPipeline(
      "[COMBINATION_DISCOVERY_FAILED]",
      "reason=all_layers_exhausted",
      `resolvedPlaces=${candidates.length}`,
      `themeCount=0`,
      `districtCount=${districts.size}`,
    );
    return setDiscoveryFailure(
      label,
      candidates.length === 0 ? "places_no_results" : "combination_insufficient",
      "all_layers_exhausted",
    );
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
  return combinations.map((combo) => ({
    title: combo.title,
    // Reply surfaces primary names; full pool (primary+fallback) stays in cache for mapping.
    places: (combo.primaryCandidates?.length
      ? combo.primaryCandidates
      : combo.placeCandidates.slice(0, PRIMARY_PLACES_PER_COMBO)
    ).map((p) => p.name),
  }));
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
}): Promise<{
  ok: boolean;
  combinations: StructuredCombinationOption[];
  source: "cache" | "curated_or_local" | "discovered" | "failed" | "blocked_country";
  failureReason?: DestinationDiscoveryFailureReason;
  scopePatch?: ReturnType<typeof buildDestinationScopeContextPatch> | null;
}> {
  const label = normalizeDestinationLabel(params.destination);
  if (isCountryLevelDestination(label)) {
    logCountryLevelPlacesBlocked(label, "city_required");
    return {
      ok: false,
      combinations: [],
      source: "blocked_country",
      failureReason: "blocked_country",
    };
  }
  const cached = getCachedDiscoveredCombinations(label);
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
      title: combo.title,
      theme: combo.title.replace(/組合$/, ""),
      placeCandidates: combo.places.map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [],
      })),
      primaryCandidates: combo.places.slice(0, PRIMARY_PLACES_PER_COMBO).map((name) => ({
        name,
        searchCandidateId: `name:${name}`,
        types: [],
      })),
    }));
    // Cache so reply builder / offeredCombinations share the same resolved list.
    setCachedDiscoveredCombinations(label, structured);
    return { ok: true, combinations: structured, source: "curated_or_local" };
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

  return {
    ok: false,
    combinations: [],
    source: "failed",
    failureReason: lastDiscoveryFailure?.reason ?? "places_no_results",
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
