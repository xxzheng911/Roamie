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
  PLACES_LANGUAGE,
  PLACES_REGION,
} from "@/lib/places-search-config";
import {
  applyAvailabilityFields,
  derivePlaceAvailability,
  type PlaceHoursData,
  type PlaceOpenStatus,
} from "@/lib/filter-available-places";

export type PlaceResult = {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  primaryType: string | null;
  businessStatus: string | null;
  openStatus: PlaceOpenStatus;
  /** 營業中 / 目前未營業 / 即將打烊；已停業則不會出現在結果 */
  openStatusLabel: string;
  todayHoursLabel: string;
  closingSoonNote: string;
  nextOpenHint: string;
};

export type RawPlaceHours = PlaceHoursData & {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  photos?: Array<{ name: string }>;
  primaryType?: string;
};

const ExploreSearchInput = z.object({
  query: z.string().min(0).max(120).default(""),
  lat: z.number(),
  lng: z.number(),
  radius: z.number().min(500).max(50_000).optional().default(DEFAULT_SEARCH_RADIUS_M),
  mode: z.enum(["nearby", "text", "multi"]).default("nearby"),
  includedTypes: z.array(z.string()).max(50).optional(),
  nearbyGroups: z.array(z.array(z.string()).max(10)).max(12).optional(),
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
      const availability = derivePlaceAvailability(hours, { context: "now" });
      if (!availability.isRecommendable) return null;
      const fields = applyAvailabilityFields({}, availability);
      return {
        place: {
          id: p.id,
          name: p.displayName?.text ?? "Unknown",
          address: p.formattedAddress ?? null,
          lat: p.location?.latitude ?? null,
          lng: p.location?.longitude ?? null,
          rating: p.rating ?? null,
          userRatingCount: p.userRatingCount ?? null,
          photoName: p.photos?.[0]?.name ?? null,
          primaryType: p.primaryType ?? null,
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
    .map(({ place }) => place);
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

async function searchText(
  apiKey: string,
  query: string,
  lat: number,
  lng: number,
  radius: number,
  pageSize = 20,
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: PLACES_LANGUAGE,
    regionCode: PLACES_REGION,
    locationBias: locationCircle(lat, lng, radius),
    pageSize,
  };

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
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const body: Record<string, unknown> = {
    includedTypes,
    languageCode: PLACES_LANGUAGE,
    regionCode: PLACES_REGION,
    locationRestriction: locationCircle(lat, lng, radius),
    maxResultCount,
    rankPreference: "DISTANCE",
  };

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
): Promise<{ places: PlaceResult[]; error: string | null }> {
  const settled = await Promise.all(
    groups.map((types) => searchNearby(apiKey, lat, lng, radius, types, 6)),
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
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: PLACES_LANGUAGE,
    regionCode: PLACES_REGION,
    locationBias: locationCircle(lat, lng, DEFAULT_SEARCH_RADIUS_M),
    pageSize: 3,
  };
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

  for (const radius of radii) {
    let result: { places: PlaceResult[]; error: string | null };

    if (data.mode === "multi" && data.nearbyGroups?.length) {
      result = await searchMultiNearby(apiKey, data.lat, data.lng, radius, data.nearbyGroups);
    } else if (data.mode === "nearby" && data.includedTypes?.length) {
      result = await searchNearby(apiKey, data.lat, data.lng, radius, data.includedTypes, 20);
    } else if (data.query.trim()) {
      result = await searchText(apiKey, data.query.trim(), data.lat, data.lng, radius);
    } else {
      result = { places: [], error: null };
    }

    if (result.error) return result;

    const nearby = filterWithinDistance(result.places, center, MAX_PLACE_DISTANCE_M);

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
