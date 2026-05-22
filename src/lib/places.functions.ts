import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  PLACES_FIELD_MASK,
  placesSearchNearbyUrl,
  placesSearchTextUrl,
  requireGoogleMapsServerKey,
} from "@/lib/google-maps.server";
import { distanceMeters } from "@/lib/map-explore";
import {
  DEFAULT_SEARCH_RADIUS_M,
  MAX_PLACE_DISTANCE_M,
} from "@/lib/places-search-config";
import {
  geocodeRegionFromCoordinates,
  placesRegionCodeFromCoordinates,
} from "@/lib/geo-region";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  isPlaceAvailableNow,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import { filterExplorePlaces, isTravelFriendlyPlace } from "@/lib/filter-explore-places";
import type { PlaceResult } from "@/lib/place-result";

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

function mapRawPlaces(raw: RawPlace[]): PlaceResult[] {
  return raw
    .map((p) => {
      const hours = rawPlaceToHoursData(p);
      const name = p.displayName?.text ?? "Unknown";
      const type = p.primaryType ?? p.types?.[0] ?? "";
      if (!isPlaceAvailableNow(hours, { name, type }, { context: "now" })) return null;
      const availability = derivePlaceAvailability(hours, { context: "now" });
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
          closingSoonNote: fields.closingSoonNote,
          nextOpenHint: fields.nextOpenHint,
        } satisfies PlaceResult,
        sortWeight: availability.sortWeight,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.sortWeight - b.sortWeight)
    .map(({ place }) => place)
    .filter(isTravelFriendlyPlace);
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
): Promise<{ places: RawPlace[]; error: string | null }> {
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
    return { places: [], error: `Google Places API ${res.status}: ${detail}` };
  }

  const json = (await res.json()) as { places?: RawPlace[] };
  return { places: json.places ?? [], error: null };
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
  pageSize = 20,
  userLocale?: Locale,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const { languageCode, regionCode } = exploreLocale(lat, lng, userLocale);
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode,
    locationBias: locationCircle(lat, lng, radius),
    pageSize,
  };
  if (regionCode) body.regionCode = regionCode;

  const { places: raw, error } = await postPlaces(placesSearchTextUrl(), body, apiKey);
  if (error) return { places: [], error };
  return { places: mapRawPlaces(raw), error: null };
}

async function searchNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  includedTypes: string[],
  maxResultCount = 12,
  userLocale?: Locale,
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

  const { places: raw, error } = await postPlaces(placesSearchNearbyUrl(), body, apiKey);
  if (error) return { places: [], error };
  return { places: mapRawPlaces(raw), error: null };
}

async function searchMultiNearby(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
  groups: string[][],
  userLocale?: Locale,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const settled = await Promise.all(
    groups.map((types) => searchNearby(apiKey, lat, lng, radius, types, 6, userLocale)),
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

  return { places: merged.slice(0, 24), error: null };
}

async function lookupPlaceHoursFromRaw(
  name: string,
  lat: number,
  lng: number,
  address?: string | null,
): Promise<PlaceHoursData | null> {
  const apiKey = requireGoogleMapsServerKey();
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

export async function lookupPlacesHoursBatch(
  items: Array<{ name: string; address?: string | null; lat?: number | null; lng?: number | null }>,
  center: { lat: number; lng: number },
): Promise<Map<string, PlaceHoursData>> {
  const map = new Map<string, PlaceHoursData>();
  const unique = [...new Map(items.map((i) => [i.name, i])).values()];
  const concurrency = 4;

  for (let i = 0; i < unique.length; i += concurrency) {
    const chunk = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (item) => {
        const lat = item.lat ?? center.lat;
        const lng = item.lng ?? center.lng;
        const hours = await lookupPlaceHoursFromRaw(item.name, lat, lng, item.address);
        return { name: item.name, hours };
      }),
    );
    for (const { name, hours } of results) {
      if (hours) map.set(name, hours);
    }
  }

  return map;
}

async function runExploreSearch(
  data: z.infer<typeof ExploreSearchInput>,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const apiKey = requireGoogleMapsServerKey();
  const center = { lat: data.lat, lng: data.lng };
  const radii = [data.radius ?? DEFAULT_SEARCH_RADIUS_M, 8_000, 5_000];
  const userLocale = data.locale ? coerceLocale(data.locale) : undefined;

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
      );
    } else if (data.mode === "nearby" && data.includedTypes?.length) {
      result = await searchNearby(
        apiKey,
        data.lat,
        data.lng,
        radius,
        data.includedTypes,
        20,
        userLocale,
      );
    } else if (data.query.trim()) {
      result = await searchText(
        apiKey,
        data.query.trim(),
        data.lat,
        data.lng,
        radius,
        20,
        userLocale,
      );
    } else {
      result = { places: [], error: null };
    }

    if (result.error) return result;

    const nearby = filterExplorePlaces(
      filterWithinDistance(result.places, center, MAX_PLACE_DISTANCE_M),
    );

    if (nearby.length > 0) {
      return { places: nearby, error: null };
    }

    if (result.places.length > 0 && nearby.length === 0) {
      continue;
    }
  }

  return {
    places: [],
    error: "附近找不到符合的地點，請確認定位權限或稍後再試。",
  };
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input) => ExploreSearchInput.parse(input))
  .handler(async ({ data }): Promise<{ places: PlaceResult[]; error: string | null }> => {
    try {
      return await runExploreSearch(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "request failed";
      console.error("[Roamie Places] search threw", msg);
      return { places: [], error: msg };
    }
  });
