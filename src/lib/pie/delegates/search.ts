/**
 * PIE Search delegates → 既有 placesService / places.functions
 * 無額外商業邏輯。
 */

import { executeExploreSearch, searchPlaces as searchPlacesServerFn } from "@/lib/places.functions";
import { normalizePlace, searchPlaces as searchPlacesAutocomplete } from "@/services/placesService";

export const pieSearchDelegate = {
  /** Autocomplete / trip-stop 搜尋（client service） */
  searchAutocomplete: searchPlacesAutocomplete,
  /** Explore nearby/text/multi 搜尋核心 */
  searchExplore: executeExploreSearch,
  /** TanStack server fn（既有契約） */
  searchExploreServerFn: searchPlacesServerFn,
  normalizePlace,
} as const;
