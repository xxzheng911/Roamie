import { explorePlaceDedupeKey } from "@/lib/explore-all-places-merge";
import { normalizeExplorePlaceId } from "@/lib/explore-selected-place";
import { readSharedNearbyPlaces } from "@/lib/home-nearby-repository";
import { homeNearbyLoadKey } from "@/lib/home-nearby-picks-policy";
import { homeNearbyLoadPeriodKey } from "@/lib/home-nearby-search";
import { normalizedLocationKey } from "@/lib/location-key";
import {
  buildExploreSessionKey,
  buildMapPlacesCacheKey,
  exploreTimeBucket,
  normalizeExploreCityCacheKey,
  readMapPlacesCache,
  type ExploreMapSearchSession,
} from "@/lib/map-places-cache";

type BrowseMode = "city" | "nearby";

export type ExploreBrowseScopeParts = {
  center: { lat: number; lng: number };
  categoryId: string;
  locale: string;
  mode: BrowseMode;
  cityPlaceId?: string | null;
  cityLabel?: string | null;
  freeTextQuery?: string | null;
  nearbyLocationKey?: string;
};

/** Same key authority the Explore search effect already uses. */
export function buildMapExploreCacheKeys(parts: ExploreBrowseScopeParts) {
  const mode: BrowseMode = parts.mode === "city" ? "city" : "nearby";
  const cacheKey = buildMapPlacesCacheKey({
    lat: parts.center.lat,
    lng: parts.center.lng,
    categoryId: parts.categoryId,
    locale: parts.locale,
    mode,
    cityPlaceId: parts.cityPlaceId,
    cityLabel: parts.cityLabel,
  });
  const locationKey =
    mode === "city"
      ? normalizeExploreCityCacheKey(
          parts.cityPlaceId,
          parts.cityLabel,
          parts.center.lat,
          parts.center.lng,
        )
      : (parts.nearbyLocationKey ?? normalizedLocationKey(parts.center.lat, parts.center.lng));
  const sessionKey = buildExploreSessionKey({
    locationKey,
    categoryId: parts.categoryId,
    locale: parts.locale,
    mode,
    timeBucket: exploreTimeBucket(),
    freeTextQuery: parts.freeTextQuery,
  });
  return { cacheKey, sessionKey, locationKey };
}

export function exploreDisplayedPlaceKey(place: {
  id: string;
  name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}): string {
  const id = normalizeExplorePlaceId(place.id);
  if (id && !id.startsWith("mock-") && !id.startsWith("saved-")) return `id:${id}`;
  return explorePlaceDedupeKey({
    id,
    name: place.name ?? "",
    address: place.address ?? null,
    lat: place.lat ?? null,
    lng: place.lng ?? null,
  });
}

/** Full-card loading is only for an empty carousel. */
export function shouldEnterExploreFullLoading(visiblePlaceCount: number): boolean {
  return visiblePlaceCount === 0;
}

/**
 * A new location/category/query with no matching cache must not keep the previous cards.
 * A cache hit for the next scope replaces through the existing apply path instead.
 */
export function shouldResetExploreResultsForScope(input: {
  displayedScopeKey: string | null;
  nextScopeKey: string;
  hasScopeCache: boolean;
}): boolean {
  if (input.hasScopeCache) return false;
  return input.displayedScopeKey != null && input.displayedScopeKey !== input.nextScopeKey;
}

export function shouldApplyExploreProgress(input: {
  requestId: number;
  currentRequestId: number;
  aborted: boolean;
}): boolean {
  return input.requestId === input.currentRequestId && !input.aborted;
}

/**
 * Keep already shown cards in place and append unseen candidates.
 * Returns the same array when nothing new arrived, so React keeps those card instances.
 */
export function mergeStableExploreProgress<T>(
  current: readonly T[],
  incoming: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  for (const item of current) seen.add(keyOf(item));
  const next: T[] = [...current];
  let changed = false;
  for (const item of incoming) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(item);
    changed = true;
  }
  return changed ? next : (current as T[]);
}

export function applyExploreProgressiveUpdate<T>(input: {
  current: readonly T[];
  incoming: readonly T[];
  requestId: number;
  currentRequestId: number;
  aborted: boolean;
  keyOf: (item: T) => string;
}): T[] | null {
  if (!shouldApplyExploreProgress(input)) return null;
  return mergeStableExploreProgress(input.current, input.incoming, input.keyOf);
}

type PhotoCard = {
  photoName?: string | null;
  coverImageUrl?: string | null;
};

function displayedPhoto(place: PhotoCard): { photoName: string; coverImageUrl: string } {
  return {
    photoName: place.photoName?.trim() || "",
    coverImageUrl: place.coverImageUrl?.trim() || "",
  };
}

/**
 * Final ranking wins order and membership.
 * A card that already has a photo keeps that photo identity so signing does not restart.
 */
export function stabilizeExploreCardPhoto<T extends PhotoCard>(previous: T, incoming: T): T {
  const prev = displayedPhoto(previous);
  const next = displayedPhoto(incoming);
  if (!prev.photoName && !prev.coverImageUrl) return incoming;
  if (prev.photoName === next.photoName && prev.coverImageUrl === next.coverImageUrl) return previous;
  return {
    ...incoming,
    photoName: prev.photoName || incoming.photoName,
    coverImageUrl: prev.coverImageUrl || incoming.coverImageUrl,
  };
}

export function convergeExploreDisplayedPlaces<T extends PhotoCard>(
  current: readonly T[],
  finalPlaces: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (current.length === 0) return [...finalPlaces];
  const currentByKey = new Map<string, T>();
  for (const item of current) {
    const key = keyOf(item);
    if (key && !currentByKey.has(key)) currentByKey.set(key, item);
  }
  const next = finalPlaces.map((item) => {
    const previous = currentByKey.get(keyOf(item));
    return previous ? stabilizeExploreCardPhoto(previous, item) : item;
  });
  if (next.length === current.length && next.every((item, index) => item === current[index])) {
    return current as T[];
  }
  return next;
}

export type ExploreFirstPaintCenter = {
  lat: number;
  lng: number;
  label: string;
  types?: string[];
  primaryType?: string | null;
  placeId?: string;
};

export type ExploreFirstPaintResolution<T> = {
  source: "explore-map" | "shared-nearby" | "none";
  places: T[];
  categoryId: string;
  query: string;
  mode: BrowseMode;
  cacheKey: string | null;
  sessionKey: string | null;
  locationKey: string | null;
  center: ExploreFirstPaintCenter | null;
};

export type ExploreFirstPaintLocation = {
  lat: number;
  lng: number;
  locationKey: string;
  label?: string;
};

function emptyFirstPaint(categoryId = "all", query = ""): ExploreFirstPaintResolution<never> {
  return {
    source: "none",
    places: [],
    categoryId,
    query,
    mode: "nearby",
    cacheKey: null,
    sessionKey: null,
    locationKey: null,
    center: null,
  };
}

function asCenter(
  lat: number,
  lng: number,
  label: string,
  extra?: Omit<ExploreFirstPaintCenter, "lat" | "lng" | "label">,
): ExploreFirstPaintCenter {
  return { lat, lng, label, ...extra };
}

/**
 * Synchronous Explore/Home cache read for the current location and category.
 * Does not fetch, does not write a second cache, and does not extend TTL.
 */
export function resolveExploreFirstPaintCache<T>(input: {
  locale: string;
  location: ExploreFirstPaintLocation | null;
  session?: ExploreMapSearchSession | null;
}): ExploreFirstPaintResolution<T> {
  try {
    const session = input.session ?? null;
    if (session) {
      const scope = buildMapExploreCacheKeys({
        center: { lat: session.center.lat, lng: session.center.lng },
        categoryId: session.categoryId,
        locale: input.locale,
        mode: "city",
        cityPlaceId: session.center.placeId,
        cityLabel: session.center.label,
      });
      const cached = readMapPlacesCache(scope.cacheKey);
      if (!cached?.places.length) {
        return {
          ...emptyFirstPaint(session.categoryId, session.query),
          mode: "city",
          cacheKey: scope.cacheKey,
          sessionKey: scope.sessionKey,
          locationKey: scope.locationKey,
          center: session.center,
        };
      }
      return {
        source: "explore-map",
        places: cached.places as T[],
        categoryId: session.categoryId,
        query: session.query,
        mode: "city",
        cacheKey: scope.cacheKey,
        sessionKey: scope.sessionKey,
        locationKey: scope.locationKey,
        center: session.center,
      };
    }

    const location = input.location;
    if (!location) return emptyFirstPaint();
    const label = location.label?.trim() || "";
    const scope = buildMapExploreCacheKeys({
      center: { lat: location.lat, lng: location.lng },
      categoryId: "all",
      locale: input.locale,
      mode: "nearby",
      nearbyLocationKey: location.locationKey,
    });
    const cached = readMapPlacesCache(scope.cacheKey);
    if (cached?.places.length) {
      return {
        source: "explore-map",
        places: cached.places as T[],
        categoryId: "all",
        query: "",
        mode: "nearby",
        cacheKey: scope.cacheKey,
        sessionKey: scope.sessionKey,
        locationKey: scope.locationKey,
        center: asCenter(location.lat, location.lng, label),
      };
    }

    const shared = readSharedNearbyPlaces({
      loadKey: homeNearbyLoadKey(
        location.lat,
        location.lng,
        homeNearbyLoadPeriodKey(),
        input.locale,
      ),
    });
    if (shared && shared.length > 0) {
      return {
        source: "shared-nearby",
        places: shared as T[],
        categoryId: "all",
        query: "",
        mode: "nearby",
        cacheKey: scope.cacheKey,
        sessionKey: scope.sessionKey,
        locationKey: scope.locationKey,
        center: asCenter(location.lat, location.lng, label),
      };
    }
    return {
      ...emptyFirstPaint(),
      cacheKey: scope.cacheKey,
      sessionKey: scope.sessionKey,
      locationKey: scope.locationKey,
      center: asCenter(location.lat, location.lng, label),
    };
  } catch {
    return emptyFirstPaint();
  }
}
