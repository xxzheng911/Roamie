import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SavedPlace } from "@/lib/places-storage";
import {
  COFFEE_MIN_FILTERED_RESULTS,
  DISTRICT_MIN_FILTERED_RESULTS,
} from "@/lib/places-search-config";
import { allowDemoPlaceFallback, searchRadiusMeters } from "@/lib/search-radius";
import {
  getExploreTextFallbackQueries,
  type ExploreCategory,
} from "@/lib/places-search-config";
import {
  filterByExploreCategory,
  matchesCategory,
} from "@/lib/place-category";
import { filterExplorePlaces } from "@/lib/filter-explore-places";
import { distanceMeters, savedPlacesNear } from "@/lib/map-explore";
import { sortExplorePlaces } from "@/lib/sort-explore-places";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { buildUnifiedPlaceCard } from "@/lib/unified-place-card";
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
  const radius = searchRadiusMeters();
  const basePayload = {
    lat: userLocation.lat,
    lng: userLocation.lng,
    radius,
  };
  console.info("[explore] nearby search", { category: cat.id, radius, lat: userLocation.lat, lng: userLocation.lng });

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
      return buildUnifiedPlaceCard({
        place: base,
        categoryId: cat.id,
        isSavedFavorite: true,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      });
    });

  const enriched: ExplorePlaceCard[] = [
    ...savedCards,
    ...filtered.map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      }),
    ),
  ];

  if (enriched.length === 0 && allowDemoPlaceFallback()) {
    const mocks = getMockPlacesForCategory(userLocation, cat).map((p) =>
      buildUnifiedPlaceCard({
        place: p,
        categoryId: cat.id,
        userLocation,
        weather,
        userProfile: reasonProfile,
        locale,
      }),
    );
    return sortExplorePlaces(mocks, userLocation, reasonProfile, weather);
  }

  if (enriched.length === 0) {
    console.info("[explore] no places for category", cat.id);
  }

  return sortExplorePlaces(enriched, userLocation, reasonProfile, weather);
}

export type HomeNearbyPick = ExplorePlaceCard & {
  categoryId: string;
  displayCategory?: string;
  coverImageUrl?: string;
  distanceLabel?: string;
};

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
        if (!allowDemoPlaceFallback()) return [];
        return getMockPlacesForCategory(ctx.userLocation, cat)
          .slice(0, PICKS_PER_CATEGORY)
          .map((p) => ({ ...p, categoryId: cat.id }));
      }
    }),
  );

  const merged = perCategory.flat();
  const deduped = new Map<string, HomeNearbyPick>();
  for (const p of merged) {
    const prev = deduped.get(p.id);
    if (!prev) {
      deduped.set(p.id, p);
      continue;
    }
    /** 保留較完整的 categoryId（避免先寫入錯誤分類導致地圖 handoff 錯 tab） */
    if (prev.categoryId === "all" && p.categoryId !== "all") {
      deduped.set(p.id, p);
    }
  }

  const sorted = sortExplorePlaces(
    [...deduped.values()],
    ctx.userLocation,
    ctx.reasonProfile,
    ctx.weather,
  );
  if (sorted.length > 0) return sorted;

  if (allowDemoPlaceFallback()) {
    return getMockHomeNearbyPicks(ctx.userLocation, ctx.categories, PICKS_PER_CATEGORY);
  }
  console.info("[Roamie Home] nearby picks empty (no mock in production)");
  return [];
}
