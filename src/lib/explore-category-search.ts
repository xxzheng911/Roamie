import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import {
  COFFEE_MIN_FILTERED_RESULTS,
  DISTRICT_MIN_FILTERED_RESULTS,
  DEFAULT_SEARCH_RADIUS_M,
  getExploreTextFallbackQueries,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  filterByExploreCategory,
  matchesCategory,
  getExploreCategoryDisplayLabel,
} from "@/lib/place-category";
import { filterExplorePlaces } from "@/lib/filter-explore-places";
import { distanceMeters, savedPlacesNear } from "@/lib/map-explore";
import { sortExplorePlaces } from "@/lib/sort-explore-places";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { mapPlaceResultToChatItem } from "@/lib/chat-session";
import type { WeatherSummary } from "@/lib/weather-types";
import { getMockHomeNearbyPicks, getMockPlacesForCategory } from "@/lib/map-mock-places";
import { withSearchTimeout } from "@/lib/search-timeout";

export type ExplorePlaceCard = PlaceResult & {
  reason: string;
  isSavedFavorite?: boolean;
};

export type SearchPlacesInput = {
  lat: number;
  lng: number;
  radius?: number;
  query: string;
  mode: "text" | "nearby" | "multi";
  includedTypes?: string[];
  nearbyGroups?: string[][];
  locale?: Locale;
};

export type SearchPlacesFn = (
  args: { data: SearchPlacesInput },
) => Promise<{ places: PlaceResult[]; error: string | null }>;

function mergePlacesById(base: PlaceResult[], extra: PlaceResult[]): PlaceResult[] {
  const seen = new Set(base.map((p) => p.id));
  const merged = [...base];
  for (const p of extra) {
    if (!seen.has(p.id)) {
      seen.add(p.id);
      merged.push(p);
    }
  }
  return merged;
}

function savedToPlaceResult(s: SavedPlace): PlaceResult {
  return {
    id: `saved-${s.id}`,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    rating: null,
    userRatingCount: null,
    photoName: null,
    primaryType: s.category,
    types: s.category ? [s.category] : null,
    businessStatus: null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
}

/** 與探索地圖單一分類搜尋相同的篩選、補齊、排序邏輯 */
export async function searchExploreCategoryPlaces(
  cat: ExploreCategory,
  ctx: {
    userLocation: { lat: number; lng: number };
    weather: WeatherSummary | null;
    locale: Locale;
    reasonProfile: UserProfileForReason | null;
    saved: SavedPlace[];
    searchPlacesFn: SearchPlacesFn;
  },
): Promise<ExplorePlaceCard[]> {
  const { userLocation, weather, locale, reasonProfile, saved, searchPlacesFn } = ctx;
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius: DEFAULT_SEARCH_RADIUS_M,
  };

  const primary = await withSearchTimeout(
    searchPlacesFn({
      data: {
        ...basePayload,
        query: cat.query,
        mode: cat.mode,
        includedTypes: cat.includedTypes,
        nearbyGroups: cat.nearbyGroups,
        locale,
      },
    }),
  );

  let apiPlaces = primary.places;

  const applyFilters = (list: PlaceResult[]) =>
    filterByExploreCategory(filterExplorePlaces(list), cat);

  let filtered = applyFilters(apiPlaces);

  if (cat.id === "coffee" && filtered.length < COFFEE_MIN_FILTERED_RESULTS) {
    for (const textQuery of getExploreTextFallbackQueries("coffee", userLocation)) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      if (fallback.places.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallback.places);
        filtered = applyFilters(apiPlaces);
        if (filtered.length >= COFFEE_MIN_FILTERED_RESULTS) break;
      }
    }
  }

  if (cat.id === "district" && filtered.length < DISTRICT_MIN_FILTERED_RESULTS) {
    for (const textQuery of getExploreTextFallbackQueries("district", userLocation)) {
      const fallback = await withSearchTimeout(
        searchPlacesFn({
          data: { ...basePayload, query: textQuery, mode: "text", locale },
        }),
      );
      if (fallback.places.length > 0) {
        apiPlaces = mergePlacesById(apiPlaces, fallback.places);
        filtered = applyFilters(apiPlaces);
        if (filtered.length >= DISTRICT_MIN_FILTERED_RESULTS) break;
      }
    }
  }

  const nearbySaved = savedPlacesNear(userLocation, saved, 5000);
  const apiNames = new Set(apiPlaces.map((p) => p.name));
  const savedCards: ExplorePlaceCard[] = nearbySaved
    .filter((s) => !apiNames.has(s.name))
    .filter((s) =>
      matchesCategory(
        { primaryType: s.category, name: s.name, types: s.category ? [s.category] : null },
        cat,
      ),
    )
    .map((s) => {
      const base = savedToPlaceResult(s);
      const distM =
        base.lat != null && base.lng != null
          ? distanceMeters(userLocation, { lat: base.lat, lng: base.lng })
          : undefined;
      const item = mapPlaceResultToChatItem(base, {
        weather,
        userProfile: reasonProfile,
        categoryLabel: getExploreCategoryDisplayLabel(base),
        distanceMeters: distM,
        isSavedFavorite: true,
        locale,
      });
      return { ...base, reason: item.reason, isSavedFavorite: true };
    });

  const enriched: ExplorePlaceCard[] = [
    ...savedCards,
    ...filtered.map((p) => {
      const distM =
        p.lat != null && p.lng != null
          ? distanceMeters(userLocation, { lat: p.lat, lng: p.lng })
          : undefined;
      const item = mapPlaceResultToChatItem(p, {
        weather,
        userProfile: reasonProfile,
        categoryLabel: getExploreCategoryDisplayLabel(p),
        distanceMeters: distM,
        locale,
      });
      return { ...p, reason: item.reason };
    }),
  ];

  if (enriched.length === 0) {
    const mocks = getMockPlacesForCategory(userLocation, cat).map((p) => {
      const distM =
        p.lat != null && p.lng != null
          ? distanceMeters(userLocation, { lat: p.lat, lng: p.lng })
          : undefined;
      const item = mapPlaceResultToChatItem(p, {
        weather,
        userProfile: reasonProfile,
        categoryLabel: getExploreCategoryDisplayLabel(p),
        distanceMeters: distM,
        locale,
      });
      return { ...p, reason: item.reason };
    });
    return sortExplorePlaces(mocks, userLocation, reasonProfile);
  }

  return sortExplorePlaces(enriched, userLocation, reasonProfile);
}

export type HomeNearbyPick = ExplorePlaceCard & { categoryId: string };

const PICKS_PER_CATEGORY = 2;

/** 各探索分類取 1～2 筆，再依旅遊偏好排序 */
export async function loadHomeNearbyPicks(ctx: {
  userLocation: { lat: number; lng: number };
  weather: WeatherSummary | null;
  locale: Locale;
  reasonProfile: UserProfileForReason | null;
  saved: SavedPlace[];
  searchPlacesFn: SearchPlacesFn;
  categories: ExploreCategory[];
}): Promise<HomeNearbyPick[]> {
  const perCategory = await Promise.all(
    ctx.categories.map(async (cat) => {
      try {
        const sorted = await searchExploreCategoryPlaces(cat, ctx);
        return sorted.slice(0, PICKS_PER_CATEGORY).map((p) => ({ ...p, categoryId: cat.id }));
      } catch (e) {
        console.warn("[Roamie Home] category search failed", cat.id, e);
        return getMockPlacesForCategory(ctx.userLocation, cat)
          .slice(0, PICKS_PER_CATEGORY)
          .map((p) => ({ ...p, categoryId: cat.id }));
      }
    }),
  );

  const merged = perCategory.flat();
  const deduped = new Map<string, HomeNearbyPick>();
  for (const p of merged) {
    if (!deduped.has(p.id)) deduped.set(p.id, p);
  }

  const sorted = sortExplorePlaces([...deduped.values()], ctx.userLocation, ctx.reasonProfile);
  if (sorted.length > 0) return sorted;

  return getMockHomeNearbyPicks(ctx.userLocation, ctx.categories, PICKS_PER_CATEGORY);
}
