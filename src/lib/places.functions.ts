import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  PLACES_FIELD_MASK,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_DETAILS_SCREEN_FIELD_MASK,
  placesSearchNearbyUrl,
  placesSearchTextUrl,
  placeDetailsUrl,
} from "@/lib/google-maps-api";
import { distanceMeters } from "@/lib/map-explore";
import { PLACES_SEARCH_LIMITS } from "@/lib/places-cache-config";
import { shouldSkipPlacesClientRetry } from "@/lib/places-api-errors";
import { getServerCachedExploreSearch } from "@/lib/places-search-server-cache";
import { getServerCachedPlaceDetailsScreen } from "@/lib/places-details-server-cache";
import { DEFAULT_SEARCH_RADIUS_M, MAX_PLACE_DISTANCE_M } from "@/lib/places-search-config";
import { geocodeRegionFromCoordinates, placesRegionCodeFromCoordinates } from "@/lib/geo-region";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  isPlaceAvailableNow,
  type FilterPlacesContext,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { filterExplorePlaces, isTravelFriendlyPlace } from "@/lib/filter-explore-places";
import { isPermissiveExploreMapRawPlace } from "@/lib/explore-map-search";
import {
  buildRequestDeniedDiagnostics,
  logExploreSearchRequest,
  logExploreSearchResponse,
  logExploreSearchResponseBody,
  maskApiKeyHint,
  textSearchEndpoint,
} from "@/lib/explore-places-search-diagnostics";
import { exploreMapTextSearchViaAutocomplete } from "@/lib/explore-map-text-search-fallback";
import type { PlaceResult } from "@/lib/place-result";
import { logPlacesApiResponse } from "@/lib/places-api-errors";
import { recordPlacesApiCallServer } from "@/lib/places-api-telemetry.server";
import type { PlacesApiSurface } from "@/lib/places-api-telemetry";

export type { PlaceResult } from "@/lib/place-result";

export type RawPlaceHours = PlaceHoursData & {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  photos?: Array<{ name: string }>;
  primaryType?: string;
  types?: string[];
};

export const ExploreSearchInput = z.object({
  query: z.string().min(0).max(120).default(""),
  lat: z.number(),
  lng: z.number(),
  radius: z.number().min(500).max(50_000).optional().default(DEFAULT_SEARCH_RADIUS_M),
  mode: z.enum(["nearby", "text", "multi"]).default("nearby"),
  includedTypes: z.array(z.string()).max(50).optional(),
  nearbyGroups: z.array(z.array(z.string()).max(10)).max(12).optional(),
  /** 使用者 App 語言（非所在地） */
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  /** now：只推營業中；lenient：聊天／心情可含休息中 */
  availabilityContext: z.enum(["now", "lenient"]).optional().default("now"),
  /** 成本 telemetry：home / map / ai */
  telemetrySurface: z.enum(["home", "map", "ai", "chat", "other"]).optional(),
  /** 探索地圖自由搜尋：不套用 50km 硬限制、寬鬆類型 */
  exploreMapTextSearch: z.boolean().optional(),
  /** 使用者原始輸入（診斷 log；final 為 query） */
  rawQuery: z.string().max(120).optional(),
});

type RawPlace = RawPlaceHours;

export function rawPlaceToHoursData(p: RawPlace): PlaceHoursData {
  const legacyOpening = (p as PlaceHoursData & { openingHours?: PlaceHoursData["currentOpeningHours"] })
    .openingHours;
  return {
    businessStatus: p.businessStatus,
    currentOpeningHours: p.currentOpeningHours ?? legacyOpening ?? null,
    regularOpeningHours: p.regularOpeningHours,
    utcOffsetMinutes: p.utcOffsetMinutes,
  };
}

function mapRawPlaces(
  raw: RawPlace[],
  availabilityContext: FilterPlacesContext = "now",
  options?: { permissiveMapTypes?: boolean },
): PlaceResult[] {
  const permissive = options?.permissiveMapTypes === true;
  return raw
    .map((p) => {
      const hours = rawPlaceToHoursData(p);
      const name = p.displayName?.text ?? "Unknown";
      const type = p.primaryType ?? p.types?.[0] ?? "";
      if (!isPlaceAvailableNow(hours, { name, type }, { context: availabilityContext })) {
        return null;
      }
      const availability = derivePlaceAvailability(hours, { context: availabilityContext });
      const fields = applyAvailabilityFields({}, availability);
      return {
        place: {
          id: p.id,
          name,
          address: p.formattedAddress ?? null,
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
          closesAtLabel: fields.closesAtLabel,
          closingSoonNote: fields.closingSoonNote,
          nextOpenHint: fields.nextOpenHint,
        } satisfies PlaceResult,
        sortWeight: availability.sortWeight,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sortWeight - b.sortWeight)
    .map(({ place }) => place)
    .filter((place) =>
      permissive ? isPermissiveExploreMapRawPlace(place) : isTravelFriendlyPlace(place),
    );
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
  telemetry?: { sku: "nearby" | "text"; surface?: PlacesApiSurface },
  exploreDiag?: {
    query: string;
    lat: number;
    lng: number;
    radius: number;
    mapTextSearch?: boolean;
  },
): Promise<{ places: RawPlace[]; error: string | null }> {
  const isExploreText =
    telemetry?.sku === "text" &&
    telemetry?.surface === "map" &&
    exploreDiag != null;

  if (isExploreText) {
    logExploreSearchRequest({
      rawQuery: exploreDiag.query,
      finalQuery: exploreDiag.query,
      lat: exploreDiag.lat,
      lng: exploreDiag.lng,
      radius: exploreDiag.radius,
      endpoint: url,
      transport: "google_direct",
      mode: "text",
      exploreMapTextSearch: exploreDiag.mapTextSearch,
      locationBias: body.locationBias != null,
    });
  }

  if (telemetry) {
    recordPlacesApiCallServer(telemetry.sku, telemetry.surface ?? "other", {
      url: telemetry.sku === "nearby" ? "searchNearby" : "searchText",
    });
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  let json: { places?: RawPlace[]; error?: { message?: string; status?: string } } = {};
  try {
    json = JSON.parse(responseText) as typeof json;
  } catch {
    json = {};
  }

  if (!res.ok) {
    const detail = parseGoogleError(responseText);
    const errMsg = `Google Places API ${res.status}: ${detail}`;
    logPlacesApiResponse(res.status, errMsg, responseText);
    if (isExploreText) {
      logExploreSearchResponse({
        status: res.status,
        resultCount: 0,
        firstPlaceName: null,
        rawResultCount: 0,
        error: errMsg,
        transport: "google_direct",
      });
      logExploreSearchResponseBody(
        json && Object.keys(json).length > 0 ? json : responseText,
      );
      buildRequestDeniedDiagnostics(errMsg, "google_direct_server_key", apiKey);
    }
    if (/API_KEY_IOS_APP_BLOCKED/i.test(detail)) {
      console.warn(
        "[PLACES_API] ios_key_blocked — server 請使用 GOOGLE_PLACES_SERVER_API_KEY（非 iOS App 限制）",
      );
    }
    console.error("[Roamie Places] request failed", res.status, url, detail);
    return { places: [], error: errMsg };
  }

  logPlacesApiResponse(res.status, null);
  const rawPlaces = json.places ?? [];
  const firstName = rawPlaces[0]?.displayName?.text ?? null;

  if (isExploreText) {
    logExploreSearchResponse({
      status: res.status,
      resultCount: rawPlaces.length,
      firstPlaceName: firstName,
      rawResultCount: rawPlaces.length,
      transport: "google_direct",
    });
    if (rawPlaces.length === 0) {
      logExploreSearchResponseBody(json);
      console.info("[EXPLORE_SEARCH_RESPONSE] apiKeyHint=", maskApiKeyHint(apiKey));
    }
  }

  return { places: rawPlaces, error: null };
}

function exploreLocale(lat: number, lng: number, userLocale?: Locale) {
  const locale = userLocale ?? "zh-TW";
  return {
    languageCode: localeToGoogleLanguageCode(locale),
    regionCode: placesRegionCodeFromCoordinates(lat, lng),
  };
}

async function searchText(
  apiKey: string,
  query: string,
  lat: number,
  lng: number,
  radius: number,
  pageSize = PLACES_SEARCH_LIMITS.textPageSize,
  userLocale?: Locale,
  availabilityContext: FilterPlacesContext = "now",
  telemetrySurface?: PlacesApiSurface,
  mapRawOpts?: { permissiveMapTypes?: boolean; mapTextSearch?: boolean },
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const { languageCode, regionCode } = exploreLocale(lat, lng, userLocale);
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode,
    pageSize,
  };
  if (!mapRawOpts?.mapTextSearch) {
    body.locationBias = locationCircle(lat, lng, radius);
  }
  if (regionCode) body.regionCode = regionCode;

  const exploreDiag =
    telemetrySurface === "map"
      ? { query, lat, lng, radius, mapTextSearch: mapRawOpts?.mapTextSearch }
      : undefined;

  const { places: raw, error } = await postPlaces(
    textSearchEndpoint(),
    body,
    apiKey,
    {
      sku: "text",
      surface: telemetrySurface,
    },
    exploreDiag,
  );
  if (error) return { places: [], error };
  const mapped = mapRawPlaces(raw, availabilityContext, mapRawOpts);
  if (telemetrySurface === "map") {
    console.info("[EXPLORE_SEARCH_MAP_RAW]", {
      rawCount: raw.length,
      mappedCount: mapped.length,
      permissive: mapRawOpts?.permissiveMapTypes === true,
      availabilityContext,
    });
  }
  return { places: mapped, error: null };
}

async function searchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  includedTypes: string[],
  maxResultCount = PLACES_SEARCH_LIMITS.nearbyMaxResults,
  userLocale?: Locale,
  availabilityContext: FilterPlacesContext = "now",
  telemetrySurface?: PlacesApiSurface,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const { languageCode, regionCode } = exploreLocale(lat, lng, userLocale);
  const body: Record<string, unknown> = {
    includedTypes,
    languageCode,
    locationRestriction: locationCircle(lat, lng, radius),
    maxResultCount,
    rankPreference: "DISTANCE",
  };
  if (regionCode) body.regionCode = regionCode;

  const { places: raw, error } = await postPlaces(placesSearchNearbyUrl(), body, apiKey, {
    sku: "nearby",
    surface: telemetrySurface,
  });
  if (error) return { places: [], error };
  return { places: mapRawPlaces(raw, availabilityContext), error: null };
}

async function searchMultiNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  groups: string[][],
  userLocale?: Locale,
  availabilityContext: FilterPlacesContext = "now",
  telemetrySurface?: PlacesApiSurface,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const settled = await Promise.all(
    groups.map((types) =>
      searchNearby(
        apiKey,
        lat,
        lng,
        radius,
        types,
        PLACES_SEARCH_LIMITS.multiNearbyPerGroup,
        userLocale,
        availabilityContext,
        telemetrySurface,
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

  return { places: merged.slice(0, PLACES_SEARCH_LIMITS.multiNearbyMergedMax), error: null };
}

async function lookupPlaceHoursFromRaw(
  name: string,
  lat: number,
  lng: number,
  address?: string | null,
): Promise<PlaceHoursData | null> {
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
  const { places: raw, error } = await postPlaces(placesSearchTextUrl(), body, apiKey);
  if (error || !raw.length) return null;
  const best =
    raw.find((p) => (p.displayName?.text ?? "") === name) ??
    raw.find((p) => (p.displayName?.text ?? "").includes(name)) ??
    raw[0];
  return rawPlaceToHoursData(best);
}

/** @deprecated P0：不再對 AI 回覆批次 Text Search；保留簽名供相容 */
export async function lookupPlacesHoursBatch(
  items: Array<{ name: string; address?: string | null; lat?: number | null; lng?: number | null }>,
  _center: { lat: number; lng: number },
): Promise<Map<string, PlaceHoursData>> {
  void items;
  return new Map();
}

async function runExploreSearch(
  data: z.infer<typeof ExploreSearchInput>,
  apiKey: string,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const center = { lat: data.lat, lng: data.lng };
  const radii = [data.radius ?? DEFAULT_SEARCH_RADIUS_M, 8_000, 5_000];
  const userLocale = data.locale ? coerceLocale(data.locale) : undefined;
  const availabilityContext =
    data.availabilityContext ??
    (data.exploreMapTextSearch ? "lenient" : "now");
  const telemetrySurface = data.telemetrySurface;
  const mapTextSearch =
    data.exploreMapTextSearch === true ||
    (data.telemetrySurface === "map" && data.mode === "text");
  const maxDistanceM = mapTextSearch ? 800_000 : MAX_PLACE_DISTANCE_M;
  const mapRawOpts = mapTextSearch
    ? { permissiveMapTypes: true, mapTextSearch: true }
    : undefined;

  for (const radius of radii) {
    let result: { places: PlaceResult[]; error: string | null };

    if (data.mode === "multi" && data.nearbyGroups?.length) {
      result = await searchMultiNearby(
        apiKey,
        data.lat,
        data.lng,
        radius,
        data.nearbyGroups,
        userLocale,
        availabilityContext,
        telemetrySurface,
      );
    } else if (data.mode === "nearby" && data.includedTypes?.length) {
      result = await searchNearby(
        apiKey,
        data.lat,
        data.lng,
        radius,
        data.includedTypes,
        PLACES_SEARCH_LIMITS.nearbyMaxResults,
        userLocale,
        availabilityContext,
        telemetrySurface,
      );
    } else if (data.query.trim()) {
      if (telemetrySurface === "map") {
        console.info("[EXPLORE_SEARCH_RUN_TEXT]", {
          query: data.query.trim(),
          radius,
          mapTextSearch,
          lat: data.lat,
          lng: data.lng,
        });
      }
      result = await searchText(
        apiKey,
        data.query.trim(),
        data.lat,
        data.lng,
        radius,
        PLACES_SEARCH_LIMITS.textPageSize,
        userLocale,
        availabilityContext,
        telemetrySurface,
        mapTextSearch ? mapRawOpts : undefined,
      );
    } else {
      if (telemetrySurface === "map") {
        console.info("[EXPLORE_SEARCH_SKIPPED]", { reason: "empty_query_trim" });
      }
      result = { places: [], error: null };
    }

    if (result.error) {
      if (telemetrySurface === "map") {
        console.info("[EXPLORE_SEARCH_RESPONSE]", {
          status: "error",
          resultCount: 0,
          firstPlaceName: null,
          error: result.error,
        });
        buildRequestDeniedDiagnostics(result.error, "runExploreSearch", apiKey);
      }
      return result;
    }

    const mapped = result.places;

    let within = filterWithinDistance(mapped, center, maxDistanceM);
    if (mapTextSearch && within.length === 0 && mapped.length > 0) {
      within = mapped;
    }

    const nearby = mapTextSearch
      ? within
      : filterExplorePlaces(within);

    if (nearby.length > 0) {
      if (telemetrySurface === "map") {
        console.info("[EXPLORE_SEARCH_RESPONSE]", {
          status: "ok",
          resultCount: nearby.length,
          firstPlaceName: nearby[0]?.name ?? null,
          rawResultCount: mapped.length,
          mappedResultCount: mapped.length,
        });
      }
      return { places: nearby, error: null };
    }

    if (mapped.length > 0 && nearby.length === 0) {
      if (telemetrySurface === "map") {
        console.info("[EXPLORE_SEARCH_FILTER_EMPTY]", {
          query: data.query,
          radius,
          mappedCount: mapped.length,
          mapTextSearch,
        });
      }
      continue;
    }
  }

  if (mapTextSearch && data.query.trim()) {
    const rawQ = data.rawQuery?.trim() || data.query.trim();
    const fb = await exploreMapTextSearchViaAutocomplete(apiKey, {
      rawQuery: rawQ,
      finalQuery: data.query.trim(),
      lat: data.lat,
      lng: data.lng,
      radius: data.radius ?? DEFAULT_SEARCH_RADIUS_M,
      locale: userLocale ?? "zh-TW",
    });
    if (fb.places.length > 0) {
      return fb;
    }
  }

  if (telemetrySurface === "map") {
    console.info("[EXPLORE_SEARCH_RESPONSE]", {
      status: "empty_after_radii_and_autocomplete",
      resultCount: 0,
      firstPlaceName: null,
    });
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
  try {
    const apiKey = options?.apiKey?.trim() || (await getServerMapsKey());
    return await runExploreSearch(data, apiKey);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "request failed";
    console.error("[Roamie Places] search threw", msg);
    return { places: [], error: msg };
  }
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input) => ExploreSearchInput.parse(input))
  .handler(async ({ data }): Promise<{ places: PlaceResult[]; error: string | null }> => {
    return getServerCachedExploreSearch(
      data,
      () => executeExploreSearch(data),
      (r) =>
        r.places.length > 0 &&
        !(r.error && shouldSkipPlacesClientRetry(r.error)),
    );
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
    const res = await fetch(placeDetailsUrl(placeId), {
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
      address: p.formattedAddress ?? null,
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
      closesAtLabel: fields.closesAtLabel,
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
  googleMapsUri?: string | null;
  coverImageUrl?: string | null;
  photoNames?: string[];
  hoursData?: PlaceHoursData;
};

type PlaceDetailsScreenRaw = PlaceDetailsRaw & {
  websiteUri?: string;
  googleMapsUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
};

export async function fetchPlaceDetailsForScreen(
  placeId: string,
  locale?: Locale,
  options?: { apiKey?: string; telemetrySurface?: PlacesApiSurface },
): Promise<PlaceDetailsScreenResult | null> {
  try {
    recordPlacesApiCallServer("details", options?.telemetrySurface ?? "other", { placeId });
    const apiKey = options?.apiKey?.trim() || (await getServerMapsKey());
    const languageCode = localeToGoogleLanguageCode(locale ?? "zh-TW");
    const res = await fetch(placeDetailsUrl(placeId), {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_DETAILS_SCREEN_FIELD_MASK,
        "Accept-Language": languageCode,
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn("[Roamie Places] place details screen HTTP", res.status, detail.slice(0, 200));
      return null;
    }
    const p = (await res.json()) as PlaceDetailsScreenRaw;
    const hours = rawPlaceToHoursData(p);
    const availability = derivePlaceAvailability(hours, { context: "lenient" });
    const fields = applyAvailabilityFields({}, availability);
    const photoNames = (p.photos ?? [])
      .map((ph) => ph.name?.trim())
      .filter((n): n is string => Boolean(n));
    return {
      id: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: p.rating ?? null,
      userRatingCount: p.userRatingCount ?? null,
      photoName: photoNames[0] ?? null,
      photoNames,
      hoursData: hours,
      primaryType: p.primaryType ?? null,
      types: p.types ?? null,
      businessStatus: availability.businessStatus,
      openStatus: availability.openStatus,
      openStatusLabel: fields.openStatusLabel,
      todayHoursLabel: fields.todayHoursLabel,
      closesAtLabel: fields.closesAtLabel,
      closingSoonNote: fields.closingSoonNote,
      nextOpenHint: fields.nextOpenHint,
      website: p.websiteUri?.trim() || null,
      phone: p.nationalPhoneNumber?.trim() || p.internationalPhoneNumber?.trim() || null,
      googleMapsUri: p.googleMapsUri?.trim() || null,
    };
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
        data.placeId.startsWith("temp:")
      ) {
        return { place: null, error: "synthetic_id" };
      }
      try {
        const locale = coerceLocale(data.locale);
        const place = await getServerCachedPlaceDetailsScreen(data.placeId, locale, () =>
          fetchPlaceDetailsForScreen(data.placeId, locale),
        );
        if (!place) return { place: null, error: "place_not_found" };
        return { place, error: null };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "place_details_failed";
        return { place: null, error: msg };
      }
    },
  );
