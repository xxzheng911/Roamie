import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isPlaceAvailableNow,
  type FilterPlacesContext,
} from "@/lib/filter-available-places";
import {
  filterExploreMapTextResults,
  isPermissiveExploreMapRawPlace,
} from "@/lib/explore-map-search";
import { distanceMeters } from "@/lib/map-explore";
import { PLACES_FIELD_MASK, placesSearchTextUrl } from "@/lib/google-maps-api";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { executeExploreSearch, rawPlaceToHoursData } from "@/lib/places.functions";
import type { PlaceResult } from "@/lib/place-result";
import type { z } from "zod";
import type { ExploreSearchInput } from "@/lib/places.functions";

type RawPlace = {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  currentOpeningHours?: unknown;
  regularOpeningHours?: unknown;
  utcOffsetMinutes?: number;
};

export type ExploreSearchDiagnosticReport = {
  query: string;
  apiKeyPresent: boolean;
  googleHttpStatus: number | null;
  googleRawCount: number;
  googleFirstPlaceName: string | null;
  googleError: string | null;
  enteredAvailabilityFilter: boolean;
  afterAvailabilityCount: number;
  afterPermissiveTypeCount: number;
  afterDistanceCount: number;
  executeExploreResultCount: number;
  executeExploreFirstPlaceName: string | null;
  executeExploreError: string | null;
  clientFilterBeforeCount: number;
  clientFilterAfterCount: number;
  enteredClientMapTextFilter: boolean;
};

function loadApiKeyFromEnvFile(): string | null {
  try {
    const text = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("GOOGLE_PLACES_SERVER_API_KEY=")) {
        const value = trimmed.slice("GOOGLE_PLACES_SERVER_API_KEY=".length).trim();
        if (value) return value;
      }
    }
  } catch {
    /* no .env */
  }
  return null;
}

export function resolveExploreSearchApiKey(): string | null {
  const fromProcess = process.env.GOOGLE_PLACES_SERVER_API_KEY?.trim();
  if (fromProcess) return fromProcess;
  return loadApiKeyFromEnvFile();
}

function countAfterAvailability(
  raw: RawPlace[],
  context: FilterPlacesContext,
): { count: number; entered: boolean } {
  let entered = false;
  let count = 0;
  for (const p of raw) {
    const hours = rawPlaceToHoursData(p);
    const name = p.displayName?.text ?? "Unknown";
    const type = p.primaryType ?? p.types?.[0] ?? "";
    if (!isPlaceAvailableNow(hours, { name, type }, { context })) {
      entered = true;
      continue;
    }
    count += 1;
  }
  if (raw.length > count) entered = true;
  return { count, entered };
}

function countAfterPermissiveTypes(raw: RawPlace[]): number {
  return raw.filter((p) => {
    const place: PlaceResult = {
      id: p.id,
      name: p.displayName?.text ?? "Unknown",
      address: p.formattedAddress ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
      rating: null,
      userRatingCount: null,
      photoName: null,
      primaryType: p.primaryType ?? null,
      types: p.types ?? null,
      businessStatus: p.businessStatus ?? null,
      openStatus: null,
      openStatusLabel: null,
      todayHoursLabel: null,
      closesAtLabel: null,
      closingSoonNote: null,
      nextOpenHint: null,
    };
    return isPermissiveExploreMapRawPlace(place);
  }).length;
}

function countAfterDistance(
  raw: RawPlace[],
  center: { lat: number; lng: number },
  maxMeters: number,
): number {
  return raw.filter((p) => {
    const lat = p.location?.latitude;
    const lng = p.location?.longitude;
    if (lat == null || lng == null) return false;
    return distanceMeters(center, { lat, lng }) <= maxMeters;
  }).length;
}

async function fetchGoogleTextSearchRaw(
  apiKey: string,
  query: string,
  lat: number,
  lng: number,
  locale: "zh-TW" | "en" | "ja" | "ko",
): Promise<{
  httpStatus: number;
  raw: RawPlace[];
  error: string | null;
}> {
  const body = {
    textQuery: query,
    languageCode: localeToGoogleLanguageCode(locale),
    pageSize: 10,
  };
  const res = await fetch(placesSearchTextUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { places?: RawPlace[]; error?: { message?: string } } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return { httpStatus: res.status, raw: [], error: text.slice(0, 300) };
  }
  if (!res.ok) {
    return {
      httpStatus: res.status,
      raw: [],
      error: json.error?.message ?? text.slice(0, 300),
    };
  }
  return { httpStatus: res.status, raw: json.places ?? [], error: null };
}

export async function diagnoseExploreMapTextSearch(
  data: z.infer<typeof ExploreSearchInput>,
): Promise<ExploreSearchDiagnosticReport> {
  const query = data.query.trim();
  const apiKey = resolveExploreSearchApiKey();
  const center = { lat: data.lat, lng: data.lng };
  const availabilityContext = data.availabilityContext ?? "lenient";
  const maxDistanceM = 800_000;

  const base: ExploreSearchDiagnosticReport = {
    query,
    apiKeyPresent: Boolean(apiKey),
    googleHttpStatus: null,
    googleRawCount: 0,
    googleFirstPlaceName: null,
    googleError: null,
    enteredAvailabilityFilter: false,
    afterAvailabilityCount: 0,
    afterPermissiveTypeCount: 0,
    afterDistanceCount: 0,
    executeExploreResultCount: 0,
    executeExploreFirstPlaceName: null,
    executeExploreError: null,
    clientFilterBeforeCount: 0,
    clientFilterAfterCount: 0,
    enteredClientMapTextFilter: false,
  };

  if (!apiKey) {
    base.googleError = "missing GOOGLE_PLACES_SERVER_API_KEY";
    base.executeExploreError = base.googleError;
    return base;
  }

  const google = await fetchGoogleTextSearchRaw(
    apiKey,
    query,
    data.lat,
    data.lng,
    data.locale ?? "zh-TW",
  );
  base.googleHttpStatus = google.httpStatus;
  base.googleRawCount = google.raw.length;
  base.googleFirstPlaceName = google.raw[0]?.displayName?.text ?? null;
  base.googleError = google.error;

  const avail = countAfterAvailability(google.raw, availabilityContext);
  base.enteredAvailabilityFilter = avail.entered;
  base.afterAvailabilityCount = avail.count;

  const afterAvailPlaces = google.raw.filter((p) => {
    const hours = rawPlaceToHoursData(p);
    const name = p.displayName?.text ?? "Unknown";
    const type = p.primaryType ?? p.types?.[0] ?? "";
    return isPlaceAvailableNow(hours, { name, type }, { context: availabilityContext });
  });
  base.afterPermissiveTypeCount = countAfterPermissiveTypes(afterAvailPlaces);
  base.afterDistanceCount = countAfterDistance(google.raw, center, maxDistanceM);

  const executed = await executeExploreSearch(data, { apiKey });
  base.executeExploreResultCount = executed.places.length;
  base.executeExploreFirstPlaceName = executed.places[0]?.name ?? null;
  base.executeExploreError = executed.error;

  const beforeClient = executed.places.length;
  const afterClient = filterExploreMapTextResults(executed.places, query).length;
  base.clientFilterBeforeCount = beforeClient;
  base.clientFilterAfterCount = afterClient;
  base.enteredClientMapTextFilter = beforeClient !== afterClient;

  return base;
}
