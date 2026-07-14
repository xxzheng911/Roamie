import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import {
  PLACES_FIELD_MASK,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_DETAILS_SCREEN_FIELD_MASK,
  placesSearchNearbyUrl,
  placesSearchTextUrl,
  placeDetailsUrl,
} from "@/lib/google-maps-api";
import { distanceMeters } from "@/lib/map-explore";
import { DEFAULT_SEARCH_RADIUS_M, MAX_PLACE_DISTANCE_M } from "@/lib/places-search-config";
import { geocodeRegionFromCoordinates, placesRegionCodeFromCoordinates } from "@/lib/geo-region";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  isPlaceAvailableNow,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { applyNormalizedOpeningToPlaceResult } from "@/lib/normalized-opening-status";
import { isFallbackPlanningPlaceId } from "@/lib/ai/planning-place-id";
import { normalizeGooglePlace } from "@/lib/ai/normalize-google-place";
import { filterExplorePlaces } from "@/lib/filter-explore-places";
import {
  isRecommendablePlace,
  placeResultToRecommendableInput,
} from "@/lib/is-recommendable-place";
import type { PlaceResult } from "@/lib/place-result";
import { resolvePlaceDisplayAddress } from "@/lib/place-display-address";
import {
  buildPlacesHttpKey,
  logPlacesCacheHit,
  logPlacesCacheMiss,
  runPlacesApiDeduped,
} from "@/lib/places-api-guard";
import {
  buildUnifiedPlaceDetailsCacheKey,
  readUnifiedPlaceDetailsCache,
  writeUnifiedPlaceDetailsCache,
  isPlaceDetailsCacheComplete,
} from "@/lib/unified-place-cache";
import {
  pushPlacesCallContext,
  popPlacesCallContext,
  recordPlacesHttpCall,
  getPlacesCallContext,
  type PlacesScreen,
} from "@/lib/places-api-stats";
import { sanitizeNearbyGroups, sanitizeNearbyTypes } from "@/lib/places-nearby-types";

export type { PlaceResult } from "@/lib/place-result";

export type RawPlaceHours = PlaceHoursData & {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  vicinity?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  photos?: Array<{ name: string }>;
  primaryType?: string;
  types?: string[];
};

const ExploreSearchInput = z.object({
  query: z.string().min(0).max(120).default(""),
  lat: z.number(),
  lng: z.number(),
  radius: z.number().min(500).max(50_000).optional().default(DEFAULT_SEARCH_RADIUS_M),
  mode: z.enum(["nearby", "text", "multi"]).default("nearby"),
  includedTypes: z.array(z.string()).max(50).optional(),
  nearbyGroups: z.array(z.array(z.string()).max(10)).max(12).optional(),
  /** 使用者 App 語言（非所在地） */
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  categoryId: z.string().max(32).optional(),
  placesCaller: z.string().max(80).optional(),
  placesScreen: z
    .enum([
      "home",
      "explore",
      "chat",
      "ai_recommend",
      "itinerary",
      "plan",
      "place_detail",
      "unknown",
    ])
    .optional(),
  destinationName: z.string().max(80).optional(),
  searchMode: z.enum(["destination", "nearby"]).optional(),
  skipLocationBias: z.boolean().optional(),
  intentCategory: z.string().max(32).optional(),
});

type RawPlace = RawPlaceHours;

export function rawPlaceToHoursData(p: RawPlace): PlaceHoursData {
  return {
    businessStatus: p.businessStatus,
    currentOpeningHours: p.currentOpeningHours,
    regularOpeningHours: p.regularOpeningHours,
    utcOffsetMinutes: p.utcOffsetMinutes,
  };
}

function mapRawPlaces(
  raw: RawPlace[],
  options?: {
    screen?: PlacesScreen;
    locale?: Locale;
    intentCategory?: string;
    searchMode?: string;
  },
): PlaceResult[] {
  const isHome = options?.screen === "home";
  const isChat = options?.screen === "chat";
  const isExplore = options?.screen === "explore";
  const locale = options?.locale ?? "zh-TW";
  const chatNearbyRelaxed =
    isChat && options?.searchMode === "nearby" && Boolean(options?.intentCategory);
  return raw
    .map((p) => {
      const hours = rawPlaceToHoursData(p);
      const name = p.displayName?.text ?? "Unknown";
      const type = p.primaryType ?? p.types?.[0] ?? "";
      if (
        !isHome &&
        !isChat &&
        !isExplore &&
        !isPlaceAvailableNow(hours, { name, type }, { context: "now" })
      ) {
        return null;
      }
      const availability = derivePlaceAvailability(hours, { context: "now" });
      const normalized = normalizeGooglePlace(p, { locale });
      if (!normalized) return null;
      const place = applyNormalizedOpeningToPlaceResult(
        {
          ...normalized,
          businessStatus: availability.businessStatus,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
        },
        hours,
      );
      return {
        place,
        sortWeight: isHome ? 0 : availability.sortWeight,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sortWeight - b.sortWeight)
    .map(({ place }) => place)
    .filter((place) => {
      if (isHome) return true;
      if (options?.screen === "explore") return true;
      if (isChat) {
        const recContext = chatNearbyRelaxed ? "chat_nearby" : "chat_destination_recommend";
        return isRecommendablePlace(
          placeResultToRecommendableInput(place),
          recContext,
        ).ok;
      }
      return isRecommendablePlace(placeResultToRecommendableInput(place), "explore_map").ok;
    });
}

function parseGoogleError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* ignore */
  }
  return text.slice(0, 200);
}

async function getServerMapsKey(): Promise<string> {
  const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
  return requireGoogleMapsServerKey();
}

function locationCircle(lat: number, lng: number, radius: number) {
  return {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: Math.min(Math.max(radius, 1), 50_000),
    },
  };
}

function filterWithinDistance(
  places: PlaceResult[],
  center: { lat: number; lng: number },
  maxMeters: number,
): PlaceResult[] {
  return places.filter((p) => {
    if (p.lat == null || p.lng == null) return false;
    return distanceMeters(center, { lat: p.lat, lng: p.lng }) <= maxMeters;
  });
}

async function postPlaces(
  url: string,
  body: Record<string, unknown>,
  apiKey: string,
  callType: "nearby" | "text",
  stats?: {
    caller: string;
    screen: PlacesScreen;
    category?: string;
    destinationName?: string;
    searchMode?: string;
    intentCategory?: string;
  },
): Promise<{ places: RawPlace[]; error: string | null; nextPageToken?: string }> {
  const circle =
    (body.locationRestriction as { circle?: { center?: { latitude?: number; longitude?: number } } })
      ?.circle ??
    (body.locationBias as { circle?: { center?: { latitude?: number; longitude?: number } } })
      ?.circle;
  const httpKey = buildPlacesHttpKey(callType, {
    lat: circle?.center?.latitude,
    lng: circle?.center?.longitude,
    query: typeof body.textQuery === "string" ? body.textQuery : "",
    types: Array.isArray(body.includedTypes) ? body.includedTypes.join(",") : "",
    radius: (circle as { radius?: number } | undefined)?.radius,
    destinationName: stats?.destinationName,
    searchMode: stats?.searchMode,
    intentCategory: stats?.intentCategory,
    skipBias: body.skipLocationBias === true ? "1" : undefined,
  });

  const guarded = await runPlacesApiDeduped(httpKey, callType, async () => {
    recordPlacesHttpCall(callType, {
      functionName: "postPlaces",
      requestKey: httpKey,
      caller: stats?.caller,
      screen: stats?.screen,
      category: stats?.category,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      const detail = parseGoogleError(text);
      console.error("[Roamie Places] request failed", res.status, url, detail);
      if (res.status === 429 || res.status === 503) {
        // Let the shared Places queue retry with exponential backoff.
        throw new Error(`places_http_${res.status}:${detail}`);
      }
      if (stats?.screen === "chat") {
        console.warn("[CHAT_NEARBY_ERROR]", {
          message: `Google Places API ${res.status}: ${detail}`,
          rawResponse: text.slice(0, 500),
        });
      }
      return { places: [] as RawPlace[], error: `Google Places API ${res.status}: ${detail}` };
    }

    const json = (await res.json()) as { places?: RawPlace[]; nextPageToken?: string };
    return {
      places: json.places ?? [],
      error: null as string | null,
      nextPageToken: json.nextPageToken,
    };
  });

  if (guarded === null) {
    if (stats?.screen === "chat") {
      console.warn("[CHAT_NEARBY_ERROR]", {
        message: "places_rate_limited",
        rawResponse: "",
      });
    }
    return { places: [], error: "places_rate_limited" };
  }
  return guarded;
}

function exploreLocale(lat: number, lng: number, userLocale?: Locale) {
  const locale = userLocale ?? "zh-TW";
  return {
    languageCode: localeToGoogleLanguageCode(locale),
    regionCode: placesRegionCodeFromCoordinates(lat, lng),
  };
}

type PlacesSearchStats = {
  caller: string;
  screen: PlacesScreen;
  category?: string;
  destinationName?: string;
  searchMode?: string;
  intentCategory?: string;
};

function buildSearchStats(
  data: z.infer<typeof ExploreSearchInput>,
): PlacesSearchStats {
  return {
    caller: data.placesCaller ?? "executeExploreSearch",
    screen: data.placesScreen ?? "unknown",
    category: data.categoryId,
    destinationName: data.destinationName,
    searchMode: data.searchMode,
    intentCategory: data.intentCategory,
  };
}

async function searchText(
  apiKey: string,
  query: string,
  lat: number,
  lng: number,
  radius: number,
  pageSize = 20,
  userLocale?: Locale,
  stats?: PlacesSearchStats,
  skipLocationBias = false,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const { languageCode, regionCode } = exploreLocale(lat, lng, userLocale);
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode,
    pageSize,
  };
  if (!skipLocationBias) {
    body.locationBias = locationCircle(lat, lng, radius);
  }
  if (regionCode) body.regionCode = regionCode;

  const { places: raw, error } = await postPlaces(
    placesSearchTextUrl(),
    body,
    apiKey,
    "text",
    stats,
  );
  if (error) return { places: [], error };
  return { places: mapRawPlaces(raw, { screen: stats?.screen, locale: userLocale, intentCategory: stats?.intentCategory, searchMode: stats?.searchMode }), error: null };
}

async function searchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  includedTypes: string[],
  maxResultCount = 12,
  userLocale?: Locale,
  stats?: PlacesSearchStats,
  opts?: { maxPages?: number },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const { languageCode, regionCode } = exploreLocale(lat, lng, userLocale);
  const perPageMax = Math.min(maxResultCount, 20);
  const maxPages = opts?.maxPages ?? 1;
  const allRaw: RawPlace[] = [];
  let pageToken: string | undefined;
  let lastError: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      includedTypes,
      languageCode,
      locationRestriction: locationCircle(lat, lng, radius),
      maxResultCount: perPageMax,
      rankPreference: "DISTANCE",
    };
    if (regionCode) body.regionCode = regionCode;
    if (pageToken) body.pageToken = pageToken;

    const { places: raw, error, nextPageToken } = await postPlaces(
      placesSearchNearbyUrl(),
      body,
      apiKey,
      "nearby",
      stats,
    );
    if (error) {
      lastError = error;
      if (allRaw.length === 0) return { places: [], error };
      break;
    }
    allRaw.push(...raw);
    if (!nextPageToken || raw.length === 0) break;
    pageToken = nextPageToken;
    if (page < maxPages - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  const places = mapRawPlaces(allRaw, {
    screen: stats?.screen,
    locale: userLocale,
    intentCategory: stats?.intentCategory,
    searchMode: stats?.searchMode,
  });
  if (stats?.screen === "chat") {
    devVerboseInfo("[CHAT_NEARBY_API]", {
      mode: "nearby",
      types: includedTypes.join(","),
      radius,
      rawCount: allRaw.length,
      mappedCount: places.length,
      pages: maxPages > 1 ? maxPages : 1,
      error: lastError ?? "",
    });
  }
  return { places, error: null };
}

async function searchMultiNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  groups: string[][],
  userLocale?: Locale,
  stats?: PlacesSearchStats,
  opts?: { perGroupMax?: number; mergedMax?: number },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const perGroupMax = opts?.perGroupMax ?? 6;
  const mergedMax = opts?.mergedMax ?? 24;
  const paginate = stats?.caller.includes("trip_add_place") ?? false;
  const settled = await Promise.all(
    groups.map((types) =>
      searchNearby(
        apiKey,
        lat,
        lng,
        radius,
        types,
        perGroupMax,
        userLocale,
        stats,
        paginate ? { maxPages: 3 } : undefined,
      ),
    ),
  );

  const errors = settled.map((r) => r.error).filter(Boolean);
  if (errors.length === groups.length) {
    return { places: [], error: errors[0] ?? "搜尋失敗" };
  }

  const seen = new Set<string>();
  const merged: PlaceResult[] = [];
  for (const { places } of settled) {
    for (const p of places) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
    }
  }

  if (stats?.screen === "chat" && stats.caller.includes("trip_add_place")) {
    devVerboseInfo("[TRIP_ADD_PLACE_RAW_MERGE]", {
      groups: groups.length,
      perGroupMax,
      mergedCount: merged.length,
      radius,
    });
  }

  return { places: merged.slice(0, mergedMax), error: null };
}

type PlaceHoursLookupResult = { hours: PlaceHoursData; placeId: string | null };

async function lookupPlaceHoursFromRaw(
  name: string,
  lat: number,
  lng: number,
  address?: string | null,
  stats?: PlacesSearchStats,
): Promise<PlaceHoursLookupResult | null> {
  const apiKey = await getServerMapsKey();
  const query = [name, address].filter(Boolean).join(" ").trim() || name;
  const { languageCode, regionCode } = exploreLocale(lat, lng);
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode,
    locationBias: locationCircle(lat, lng, DEFAULT_SEARCH_RADIUS_M),
    pageSize: 3,
  };
  if (regionCode) body.regionCode = regionCode;
  const { places: raw, error } = await postPlaces(
    placesSearchTextUrl(),
    body,
    apiKey,
    "text",
    stats
      ? {
          caller: stats.caller,
          screen: stats.screen,
          category: stats.category,
        }
      : {
          caller: "lookupPlaceHoursFromRaw",
          screen: "unknown",
        },
  );
  if (error || !raw.length) return null;
  const best =
    raw.find((p) => (p.displayName?.text ?? "") === name) ??
    raw.find((p) => (p.displayName?.text ?? "").includes(name)) ??
    raw[0];
  return {
    hours: rawPlaceToHoursData(best),
    placeId: best.id?.trim() || null,
  };
}

function buildHoursLookupRequestKey(input: {
  name: string;
  placeId?: string | null;
  lat: number;
  lng: number;
}): string {
  const placeId = input.placeId?.trim();
  if (placeId) return `pid:${placeId}`;
  return `name:${input.name.trim().toLowerCase()}:${input.lat.toFixed(3)}:${input.lng.toFixed(3)}`;
}

export async function lookupPlacesHoursBatch(
  items: Array<{
    name: string;
    placeId?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
  }>,
  center: { lat: number; lng: number },
  stats?: PlacesSearchStats,
): Promise<Map<string, PlaceHoursData>> {
  const {
    getAiHoursCacheByPlaceId,
    logAiPlaceBatchLookup,
    logAiPlaceCacheHit,
    runAiHoursLookupDeduped,
    setAiHoursCacheByPlaceId,
  } = await import("@/lib/recommendation/ai-places-cache");

  const lookupStats: PlacesSearchStats = stats ?? {
    caller: "lookupPlacesHoursBatch",
    screen: "unknown",
  };

  const map = new Map<string, PlaceHoursData>();
  const unique = [...new Map(items.map((i) => [i.name, i])).values()];
  const concurrency = 4;

  async function resolveItemHours(item: (typeof unique)[number]): Promise<{
    name: string;
    hours: PlaceHoursData | null;
  }> {
    const lat = item.lat ?? center.lat;
    const lng = item.lng ?? center.lng;
    const placeId = item.placeId?.trim() || null;

    if (placeId) {
      const cached = getAiHoursCacheByPlaceId(placeId);
      if (cached) {
        logAiPlaceCacheHit(`hours:${placeId}`);
        logAiPlaceBatchLookup({ name: item.name, placeId, cacheHit: true });
        return { name: item.name, hours: cached };
      }
    }

    const requestKey = buildHoursLookupRequestKey({ name: item.name, placeId, lat, lng });

    const hours = await runAiHoursLookupDeduped(requestKey, async () => {
      logAiPlaceBatchLookup({ name: item.name, placeId, cacheHit: false });
      const result = await lookupPlaceHoursFromRaw(
        item.name,
        lat,
        lng,
        item.address,
        lookupStats,
      );
      if (!result) return null;
      if (result.placeId) {
        setAiHoursCacheByPlaceId(result.placeId, result.hours);
      }
      return result.hours;
    });

    return { name: item.name, hours };
  }

  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map((item) => resolveItemHours(item)));
    for (const { name, hours } of results) {
      if (hours) map.set(name, hours);
    }
  }

  return map;
}

async function runExploreSearch(
  data: z.infer<typeof ExploreSearchInput>,
  apiKey: string,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const center = { lat: data.lat, lng: data.lng };
  const radius = data.radius ?? DEFAULT_SEARCH_RADIUS_M;
  const userLocale = data.locale ? coerceLocale(data.locale) : undefined;
  const stats = buildSearchStats(data);

  let result: { places: PlaceResult[]; error: string | null };

  if (data.mode === "multi" && data.nearbyGroups?.length) {
    const groups = sanitizeNearbyGroups(data.nearbyGroups);
    const isTripAddPlace = data.placesCaller?.includes("trip_add_place") ?? false;
    result =
      groups.length > 0
        ? await searchMultiNearby(
            apiKey,
            data.lat,
            data.lng,
            radius,
            groups,
            userLocale,
            stats,
            isTripAddPlace ? { perGroupMax: 20, mergedMax: 100 } : undefined,
          )
        : { places: [], error: null };
  } else if (data.mode === "nearby" && data.includedTypes?.length) {
    const includedTypes = sanitizeNearbyTypes(data.includedTypes);
    result =
      includedTypes.length > 0
        ? await searchNearby(
            apiKey,
            data.lat,
            data.lng,
            radius,
            includedTypes,
            20,
            userLocale,
            stats,
          )
        : { places: [], error: null };
  } else if (data.query.trim()) {
    result = await searchText(
      apiKey,
      data.query.trim(),
      data.lat,
      data.lng,
      radius,
      20,
      userLocale,
      stats,
      data.skipLocationBias === true,
    );
  } else {
    result = { places: [], error: null };
  }

  if (result.error) return result;

  const chatDestinationText =
    data.placesScreen === "chat" && data.mode === "text" && data.query.trim().length > 0;
  const skipDistanceFilter = data.skipLocationBias === true && data.searchMode === "destination";
  const maxDistance = chatDestinationText ? 150_000 : MAX_PLACE_DISTANCE_M;
  const distanceFiltered = skipDistanceFilter
    ? result.places
    : filterWithinDistance(result.places, center, maxDistance);

  if (data.placesScreen === "home") {
    return {
      places: distanceFiltered,
      error: distanceFiltered.length === 0 ? result.error : null,
    };
  }

  if (data.placesScreen === "chat") {
    return {
      places: distanceFiltered,
      error: distanceFiltered.length === 0 ? result.error : null,
    };
  }

  const nearby = filterExplorePlaces(distanceFiltered, { exploreMapTier: "strict" });

  if (nearby.length > 0) {
    return { places: nearby, error: null };
  }

  if (data.placesScreen === "explore") {
    return { places: distanceFiltered, error: null };
  }

  return {
    places: [],
    error: "附近找不到符合的地點，請確認定位權限或稍後再試。",
  };
}

export async function executeExploreSearch(
  data: z.infer<typeof ExploreSearchInput>,
  options?: { apiKey?: string },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const stats = buildSearchStats(data);
  pushPlacesCallContext(stats);
  try {
    const apiKey = options?.apiKey?.trim() || (await getServerMapsKey());
    return await runExploreSearch(data, apiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "request failed";
    console.error("[Roamie Places] search threw", msg);
    return { places: [], error: msg };
  } finally {
    popPlacesCallContext();
  }
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input) => ExploreSearchInput.parse(input))
  .handler(async ({ data }): Promise<{ places: PlaceResult[]; error: string | null }> => {
    return executeExploreSearch(data);
  });

type PlaceDetailsRaw = RawPlace & {
  editorialSummary?: { text?: string };
  reviews?: Array<{ text?: { text?: string } }>;
};

export async function fetchPlaceDetailsForIntro(
  placeId: string,
  locale?: Locale,
): Promise<{
  place: PlaceResult;
  editorialSummary: string | null;
  reviewSnippets: string[];
} | null> {
  try {
    const apiKey = await getServerMapsKey();
    const languageCode = localeToGoogleLanguageCode(locale ?? "zh-TW");
    const httpKey = buildPlacesHttpKey("details", { placeId, locale: locale ?? "zh-TW" });
    recordPlacesHttpCall("details", {
      functionName: "fetchPlaceDetailsForIntro",
      requestKey: httpKey,
      caller: getPlacesCallContext().caller,
      screen: getPlacesCallContext().screen,
    });
    const res = await fetch(placeDetailsUrl(placeId, languageCode), {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
        "Accept-Language": languageCode,
      },
    });
    if (!res.ok) return null;
    const p = (await res.json()) as PlaceDetailsRaw;
    const hours = rawPlaceToHoursData(p);
    const availability = derivePlaceAvailability(hours, { context: "now" });
    const fields = applyAvailabilityFields({}, availability);
    const place: PlaceResult = {
      id: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: resolvePlaceDisplayAddress(
        {
          formattedAddress: p.formattedAddress,
          shortFormattedAddress: p.shortFormattedAddress,
          vicinity: p.vicinity,
        },
        { locale },
      ),
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      photoName: p.photos?.[0]?.name ?? null,
      primaryType: p.primaryType ?? null,
      types: p.types ?? null,
      businessStatus: availability.businessStatus,
      openStatus: availability.openStatus,
      openStatusLabel: fields.openStatusLabel,
      todayHoursLabel: fields.todayHoursLabel,
      closingSoonNote: fields.closingSoonNote,
      nextOpenHint: fields.nextOpenHint,
    };
    return {
      place,
      editorialSummary: p.editorialSummary?.text?.trim() ?? null,
      reviewSnippets: (p.reviews ?? [])
        .map((r) => r.text?.text?.trim())
        .filter((t): t is string => Boolean(t))
        .slice(0, 3),
    };
  } catch (e) {
    console.warn("[Roamie Places] place details failed", placeId, e);
    return null;
  }
}

export type PlaceDetailsScreenResult = PlaceResult & {
  website: string | null;
  phone: string | null;
  coverImageUrl?: string | null;
  photoNames?: string[];
  googleFormattedAddress?: string | null;
  googleShortFormattedAddress?: string | null;
  googleVicinity?: string | null;
};

type PlaceDetailsScreenRaw = PlaceDetailsRaw & {
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
};

function mapPlaceDetailsScreenRaw(
  p: PlaceDetailsScreenRaw,
  locale?: Locale,
): PlaceDetailsScreenResult {
  const hours = rawPlaceToHoursData(p);
  const hasCoords = p.location?.latitude != null && p.location?.longitude != null;
  const googleFields = {
    formattedAddress: p.formattedAddress,
    shortFormattedAddress: p.shortFormattedAddress,
    vicinity: p.vicinity,
  };
  const basePlace: PlaceResult = {
    id: p.id,
    name: p.displayName?.text ?? "Unknown",
    address: resolvePlaceDisplayAddress(googleFields, {
      hasCoords,
      locale,
      googleFieldsOnly: true,
    }),
    lat: p.location?.latitude ?? null,
    lng: p.location?.longitude ?? null,
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? null,
    photoName: p.photos?.[0]?.name ?? null,
    primaryType: p.primaryType ?? null,
    types: p.types ?? null,
    businessStatus: p.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  };
  const place = applyNormalizedOpeningToPlaceResult(basePlace, hours);
  return {
    ...place,
    googleFormattedAddress: p.formattedAddress ?? null,
    googleShortFormattedAddress: p.shortFormattedAddress ?? null,
    googleVicinity: p.vicinity ?? null,
    photoNames: (p.photos ?? [])
      .map((ph) => ph.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 10),
    website: p.websiteUri?.trim() || null,
    phone: p.nationalPhoneNumber?.trim() || p.internationalPhoneNumber?.trim() || null,
  };
}

/** 瀏覽器直連 Google Places Details（Capacitor bundle 無 server 時） */
export async function fetchPlaceDetailsForScreenWithKey(
  placeId: string,
  apiKey: string,
  locale?: Locale,
  cacheScope?: { cityLabel?: string; country?: string; lat?: number; lng?: number },
): Promise<PlaceDetailsScreenResult | null> {
  const cacheKey = buildUnifiedPlaceDetailsCacheKey(placeId, locale ?? "zh-TW", cacheScope);
  const cached = readUnifiedPlaceDetailsCache(cacheKey);
  if (cached?.place) {
    logPlacesCacheHit(cacheKey);
    return cached.place;
  }

  logPlacesCacheMiss(cacheKey);

  const httpKey = buildPlacesHttpKey("details", { placeId, locale: locale ?? "zh-TW" });
  const guarded = await runPlacesApiDeduped(httpKey, "details", async () => {
    recordPlacesHttpCall("details", {
      functionName: "fetchPlaceDetailsForScreenWithKey",
      requestKey: httpKey,
      caller: getPlacesCallContext().caller,
      screen: getPlacesCallContext().screen,
    });

    try {
      const languageCode = localeToGoogleLanguageCode(locale ?? "zh-TW");
      const res = await fetch(placeDetailsUrl(placeId, languageCode), {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PLACE_DETAILS_SCREEN_FIELD_MASK,
          "Accept-Language": languageCode,
        },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.warn("[Roamie Places] place details client HTTP", res.status, detail.slice(0, 200));
        if (res.status === 429 || res.status === 503) {
          throw new Error(`places_details_http_${res.status}`);
        }
        return null;
      }
      const p = (await res.json()) as PlaceDetailsScreenRaw;
      return mapPlaceDetailsScreenRaw(p, locale);
    } catch (e) {
      console.warn("[Roamie Places] place details client failed", placeId, e);
      return null;
    }
  });

  if (guarded && isPlaceDetailsCacheComplete(guarded)) {
    writeUnifiedPlaceDetailsCache(cacheKey, guarded, null);
  } else if (guarded) {
    writeUnifiedPlaceDetailsCache(cacheKey, guarded, null);
  }
  return guarded;
}

export async function fetchPlaceDetailsForScreen(
  placeId: string,
  locale?: Locale,
): Promise<PlaceDetailsScreenResult | null> {
  try {
    const apiKey = await getServerMapsKey();
    return await fetchPlaceDetailsForScreenWithKey(placeId, apiKey, locale);
  } catch (e) {
    console.warn("[Roamie Places] place details screen failed", placeId, e);
    return null;
  }
}

const PlaceDetailsInput = z.object({
  placeId: z.string().min(1),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

export const getPlaceDetails = createServerFn({ method: "POST" })
  .inputValidator((input) => PlaceDetailsInput.parse(input))
  .handler(
    async ({ data }): Promise<{ place: PlaceDetailsScreenResult | null; error: string | null }> => {
      if (
        data.placeId.startsWith("latlng:") ||
        data.placeId.startsWith("saved-") ||
        data.placeId.startsWith("session:") ||
        data.placeId.startsWith("trip:") ||
        data.placeId.startsWith("memory:") ||
        data.placeId.startsWith("synthetic:") ||
        isFallbackPlanningPlaceId(data.placeId) ||
        !/^ChIJ[\w-]+$/i.test(data.placeId.replace(/^places\//i, ""))
      ) {
        return { place: null, error: "synthetic_id" };
      }
      try {
        const locale = coerceLocale(data.locale);
        const place = await fetchPlaceDetailsForScreen(data.placeId, locale);
        if (!place) return { place: null, error: "place_not_found" };
        return { place, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "place_details_failed";
        return { place: null, error: msg };
      }
    },
  );
