import type { Locale } from "@/lib/i18n/types";
import { isCityRecommendSelection, type CityRecommendSelection } from "@/lib/explore-recommend-mode";

const PINNABLE_PLACE_TYPES = new Set([
  "point_of_interest",
  "tourist_attraction",
  "establishment",
  "museum",
  "amusement_park",
  "theme_park",
  "historical_landmark",
  "monument",
  "art_gallery",
  "cultural_center",
  "park",
  "zoo",
  "aquarium",
  "shopping_mall",
  "department_store",
  "cafe",
  "coffee_shop",
  "restaurant",
  "bakery",
  "bar",
  "night_club",
  "store",
  "stadium",
  "performing_arts_theater",
  "movie_theater",
  "lodging",
  "spa",
  "gym",
]);

const NON_PINNABLE_TYPES = new Set([
  "geocode",
  "locality",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "country",
  "political",
  "sublocality",
  "route",
  "street_address",
]);

function normalizedTypes(input: {
  types?: string[] | null;
  primaryType?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const t of input.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = input.primaryType?.trim().toLowerCase();
  if (primary) out.add(primary);
  return [...out];
}

/** 使用者選了明確景點 / 地標 / 店名 → 置頂推薦第一筆（城市 / 行政區除外） */
export function isPinnableSearchSelection(
  input: CityRecommendSelection & {
    placeId?: string | null;
  },
): boolean {
  if (isCityRecommendSelection(input)) return false;

  const placeId = input.placeId?.trim() ?? "";
  if (placeId) return true;

  const types = normalizedTypes(input);
  if (types.some((t) => NON_PINNABLE_TYPES.has(t)) && !types.some((t) => PINNABLE_PLACE_TYPES.has(t))) {
    return false;
  }
  return types.some((t) => PINNABLE_PLACE_TYPES.has(t));
}

/** 大型景點 / 已選地點：距離顯示 0m 或「目前選取地點」 */
export function buildSelectedPlaceDistanceLabel(locale: Locale): string {
  if (locale === "en") return "Selected location";
  if (locale === "ja") return "選択中の場所";
  if (locale === "ko") return "선택한 장소";
  return "目前選取地點";
}

export function normalizeExplorePlaceId(raw?: string | null): string {
  return (raw ?? "").replace(/^places\//, "").trim();
}

export function pinSelectedPlaceFirst<T extends { id: string }>(pinned: T, results: T[]): T[] {
  const pinKey = normalizeExplorePlaceId(pinned.id);
  const rest = results.filter((item) => normalizeExplorePlaceId(item.id) !== pinKey);
  return [pinned, ...rest];
}

export function logExploreSearchSelect(input: {
  name: string;
  placeId?: string | null;
  types?: string[] | null;
}): void {
  const types = (input.types ?? []).join(",");
  console.info(`[EXPLORE_SEARCH_SELECT] name=${input.name}`);
  console.info(`[EXPLORE_SEARCH_SELECT] placeId=${input.placeId ?? ""}`);
  console.info(`[EXPLORE_SEARCH_SELECT] types=${types}`);
}

export function logExploreSelectedPlaceDetails(input: {
  name: string;
  rating?: number | null;
  address?: string | null;
  photo?: string | null;
}): void {
  console.info(`[EXPLORE_SELECTED_PLACE_DETAILS] name=${input.name}`);
  console.info(`[EXPLORE_SELECTED_PLACE_DETAILS] rating=${input.rating ?? ""}`);
  console.info(`[EXPLORE_SELECTED_PLACE_DETAILS] address=${input.address ?? ""}`);
  console.info(`[EXPLORE_SELECTED_PLACE_DETAILS] photo=${input.photo ? "yes" : "no"}`);
}

export function logExploreSelectedPlacePin(input: {
  name: string;
  placeId: string;
  types?: string[] | null;
  pinned?: boolean;
}): void {
  const types = (input.types ?? []).join(",");
  console.info(
    `[EXPLORE_SELECTED_PLACE_PIN] name=${input.name} placeId=${input.placeId} types=${types} pinned=${input.pinned === false ? "false" : "true"}`,
  );
}

export function logExploreRecommendResult(firstPlace?: string | null): void {
  console.info(`[EXPLORE_RECOMMEND_RESULT] firstPlace=${firstPlace ?? ""}`);
}

export function logExploreRenderCards(firstCard?: string | null): void {
  console.info(`[EXPLORE_RENDER_CARDS] firstCard=${firstCard ?? ""}`);
}
