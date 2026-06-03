import type { PlaceResult } from "@/lib/place-result";
import type { PlaceLike } from "@/lib/place-category";
import { FOOD_MERCHANT_DENY_RE, matchesAllExplore } from "@/lib/place-category";
import {
  EXPLORE_EXCLUDED_TYPES,
  isExcludedExploreType,
  isTravelFriendlyPlace,
} from "@/lib/filter-explore-places";
import { logExploreSearchFiltered } from "@/lib/explore-places-search-diagnostics";
import { readLastSearchLocation } from "@/lib/last-search-location";
import { TAIPEI_CENTER } from "@/lib/geo";
import { readBootstrapDeviceLocation } from "@/lib/device-location";

const UNSET_CITY_LABELS = new Set(["附近", "nearby", "付近", "근처"]);

const TRANSIT_TYPES = [
  "train_station",
  "subway_station",
  "bus_station",
  "transit_station",
  "light_rail_station",
] as const;

const LODGING_TYPES = [
  "hotel",
  "lodging",
  "motel",
  "hostel",
  "guest_house",
  "resort_hotel",
  "bed_and_breakfast",
] as const;

export type ExploreSearchCenterSource =
  | "map_center"
  | "device_location"
  | "last_search"
  | "bootstrap"
  | "default_city";

export type ExploreSearchCenter = {
  lat: number;
  lng: number;
  source: ExploreSearchCenterSource;
  city?: string;
};

export function logExploreSearchStart(params: {
  query: string;
  lat: number;
  lng: number;
  radius: number;
  mode: string;
  freeText: boolean;
}): void {
  console.info("[EXPLORE_SEARCH_START]", params);
}

export function logExploreSearchQueryBuilt(params: {
  userInput: string;
  builtQuery: string;
  city?: string | null;
  centerSource: ExploreSearchCenterSource;
}): void {
  console.info("[EXPLORE_SEARCH_QUERY_BUILT]", params);
}

export function logExploreSearchSubmit(params: {
  query: string;
  lat?: number;
  lng?: number;
}): void {
  console.info("[EXPLORE_SEARCH_SUBMIT]", params);
}

export function logExploreSearchQueryBuiltV2(params: {
  rawQuery: string;
  finalQuery: string;
  lat: number;
  lng: number;
}): void {
  console.info("[EXPLORE_SEARCH_QUERY_BUILT]", params);
}

export function logExploreSearchFetchStart(): void {
  console.info("[EXPLORE_SEARCH_FETCH_START]");
}

export function logExploreSearchFetchSuccess(params: {
  resultCount: number;
  firstResultName: string | null;
}): void {
  console.info("[EXPLORE_SEARCH_FETCH_SUCCESS]", params);
}

export function logExploreSearchResultsApplied(params: {
  resultCount: number;
  displayMode: "searchResults" | "nearbyPlaces";
}): void {
  console.info("[EXPLORE_SEARCH_RESULTS_APPLIED]", params);
}

export function logExploreBottomSheetSource(params: {
  source: "searchResults" | "nearbyPlaces" | "savedPlaces";
  count: number;
  query?: string;
  isFreeText?: boolean;
}): void {
  console.info("[EXPLORE_BOTTOM_SHEET_SOURCE]", params);
}

export function logExploreResultsStateChanged(params: {
  phase:
    | "query_change_clear"
    | "submit_clear"
    | "search_loading"
    | "search_applied"
    | "search_error"
    | "display_results";
  query: string;
  isFreeText: boolean;
  resultsCount: number;
  displayCount: number;
  loading: boolean;
  bottomSheetSource?: "searchResults" | "nearbyPlaces" | "savedPlaces";
  reason: string;
  requestId?: number;
  apiPlacesCount?: number;
}): void {
  console.info("[EXPLORE_RESULTS_STATE_CHANGED]", params);
}

export const EXPLORE_FREE_TEXT_EMPTY_MESSAGE = "找不到符合的地點，換個關鍵字試試";

export function logExploreSearchSuccess(params: {
  query: string;
  lat: number;
  lng: number;
  radius: number;
  resultCount: number;
}): void {
  console.info("[EXPLORE_SEARCH_SUCCESS]", params);
}

export function logExploreSearchEmpty(params: {
  query: string;
  lat: number;
  lng: number;
  radius: number;
  error?: string | null;
}): void {
  console.info("[EXPLORE_SEARCH_EMPTY]", params);
}

export function logExploreSearchFailed(params: {
  query: string;
  lat: number;
  lng: number;
  radius: number;
  error: string;
}): void {
  console.info("[EXPLORE_SEARCH_FAILED]", params);
}

export function logExplorePlaceCardRendered(params: {
  placeName: string;
  placeId: string;
  category?: string | null;
}): void {
  console.info("[EXPLORE_PLACE_CARD_RENDERED]", params);
}

/** 組合關鍵字 + 城市（探索地圖自由搜尋） */
export function buildExploreMapSearchQuery(
  userInput: string,
  options?: { city?: string | null },
): string {
  const q = userInput.trim();
  if (!q) return "";
  const city = options?.city?.trim();
  if (!city || UNSET_CITY_LABELS.has(city)) return q;
  const qNorm = q.toLowerCase();
  const cityNorm = city.toLowerCase();
  if (qNorm.includes(cityNorm)) return q;
  /** 英文／拉丁關鍵字：不強制加當地城市，避免「高雄 Stellar garden」搜不到他城地點 */
  const looksLatinQuery = /[a-z]/i.test(q) && /^[\p{L}\p{N}\s'.,&+\-/]+$/u.test(q);
  if (looksLatinQuery) return q;
  return `${city} ${q}`;
}

/** 定位失敗時：地圖中心 → 裝置 → 上次搜尋 → bootstrap → 台北 */
export function resolveExploreSearchCenter(options: {
  mapCenter: { lat: number; lng: number };
  userLocation: { lat: number; lng: number };
  userLocationSource: "device_location" | "fallback_location" | "mock_location";
  locationLabel?: string;
}): ExploreSearchCenter {
  const last = readLastSearchLocation();
  const boot =
    typeof window !== "undefined"
      ? readBootstrapDeviceLocation()
      : { lat: TAIPEI_CENTER.lat, lng: TAIPEI_CENTER.lng };

  const cityFromLabel =
    options.locationLabel?.trim() &&
    !UNSET_CITY_LABELS.has(options.locationLabel.trim())
      ? options.locationLabel.trim()
      : undefined;

  if (options.userLocationSource === "device_location") {
    return {
      lat: options.userLocation.lat,
      lng: options.userLocation.lng,
      source: "device_location",
      city: cityFromLabel ?? last?.city,
    };
  }

  if (last) {
    return {
      lat: last.lat,
      lng: last.lng,
      source: "last_search",
      city: last.city ?? cityFromLabel,
    };
  }

  if (
    Number.isFinite(options.mapCenter.lat) &&
    Number.isFinite(options.mapCenter.lng)
  ) {
    return {
      lat: options.mapCenter.lat,
      lng: options.mapCenter.lng,
      source: "map_center",
      city: cityFromLabel,
    };
  }

  if (Number.isFinite(boot.lat) && Number.isFinite(boot.lng)) {
    return {
      lat: boot.lat,
      lng: boot.lng,
      source: "bootstrap",
      city: cityFromLabel,
    };
  }

  return {
    lat: TAIPEI_CENTER.lat,
    lng: TAIPEI_CENTER.lng,
    source: "default_city",
    city: cityFromLabel ?? "台北",
  };
}

function collectTypes(place: PlaceLike): string[] {
  const out = new Set<string>();
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  for (const t of place.types ?? []) {
    const n = (t ?? "").trim().toLowerCase();
    if (n) out.add(n);
  }
  return [...out];
}

function queryAllowsLodging(query: string): boolean {
  return /飯店|旅館|民宿|住宿|宾馆|hotel|hostel|motel|inn|resort/i.test(query);
}

function queryAllowsTransit(query: string): boolean {
  return /車站|駅|站|station|捷運|地鐵|mrt|train|bus terminal/i.test(query);
}

function isDeniedMapSearchPlace(place: PlaceLike, query: string): boolean {
  const name = (place.name ?? "").trim();
  if (!name) return true;
  if (FOOD_MERCHANT_DENY_RE.test(name) && !/餐|食|拉麵|咖啡|飯/i.test(query)) return true;
  const types = collectTypes(place);
  if (queryAllowsLodging(query)) {
    if (types.some((t) => (LODGING_TYPES as readonly string[]).includes(t))) return false;
    if (/飯店|旅館|民宿|hotel|hostel/i.test(name)) return false;
  }
  if (queryAllowsTransit(query)) {
    if (types.some((t) => (TRANSIT_TYPES as readonly string[]).includes(t))) return false;
  }
  if (isExcludedExploreType(place.primaryType) && !queryAllowsLodging(query)) {
    return true;
  }
  return false;
}

/**
 * 探索地圖自由搜尋：不限制 tourist_attraction，支援餐廳／飯店／車站／夜市等。
 */
/** 嚴格篩選後若為空，保留有座標的 API 結果（避免探索地圖顯示 0 筆） */
export function filterExploreMapTextResults(
  places: PlaceResult[],
  query: string,
): PlaceResult[] {
  const q = query.trim();
  const beforeCount = places.length;
  const strict = places.filter((place) => {
    if (isDeniedMapSearchPlace(place, q)) return false;
    const types = collectTypes(place);
    if (queryAllowsLodging(q)) {
      if (types.some((t) => (LODGING_TYPES as readonly string[]).includes(t))) return true;
      if (/飯店|旅館|民宿|hotel|hostel/i.test(place.name ?? "")) return true;
    }
    if (queryAllowsTransit(q)) {
      if (types.some((t) => (TRANSIT_TYPES as readonly string[]).includes(t))) return true;
    }
    if (/夜市/.test(q) && /夜市/.test(place.name ?? "")) return true;
    if (isTravelFriendlyPlace(place)) return true;
    if (matchesAllExplore(place)) return true;
    const primary = (place.primaryType ?? "").toLowerCase();
    if (
      primary &&
      !(EXPLORE_EXCLUDED_TYPES as readonly string[]).includes(primary as never)
    ) {
      return true;
    }
    return false;
  });
  if (strict.length > 0) {
    if (beforeCount !== strict.length) {
      logExploreSearchFiltered({
        beforeCount,
        afterCount: strict.length,
        filterReason: "strict_map_text_filter",
      });
    }
    return strict;
  }
  const relaxed = places.filter(
    (p) =>
      (p.name ?? "").trim().length > 0 &&
      p.lat != null &&
      p.lng != null &&
      !isDeniedMapSearchPlace(p, q),
  );
  if (relaxed.length > 0) {
    logExploreSearchFiltered({
      beforeCount,
      afterCount: relaxed.length,
      filterReason: "relaxed_keep_coords",
    });
  } else if (beforeCount > 0) {
    logExploreSearchFiltered({
      beforeCount,
      afterCount: 0,
      filterReason: "all_denied",
    });
  }
  return relaxed;
}

/** mapRawPlaces 寬鬆模式：僅排除明顯非探索類型 */
export function isPermissiveExploreMapRawPlace(place: PlaceLike): boolean {
  const name = (place.name ?? "").trim();
  if (!name) return false;
  if (FOOD_MERCHANT_DENY_RE.test(name)) return false;
  const types = collectTypes(place);
  if (types.some((t) => (LODGING_TYPES as readonly string[]).includes(t))) return true;
  if (types.some((t) => (TRANSIT_TYPES as readonly string[]).includes(t))) return true;
  if (isExcludedExploreType(place.primaryType)) return false;
  return true;
}
