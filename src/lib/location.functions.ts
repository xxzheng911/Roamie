import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  placesAutocompleteUrl,
  placeDetailsUrl,
} from "@/lib/google-maps-api";
import { requireGoogleMapsServerKey } from "@/lib/google-maps.server";
import { formatTripLocationLabel, timezoneLabelFromOffset } from "@/lib/location/format";
import {
  TRIP_LOCATION_PRIMARY_TYPES,
  buildFormattedName,
  formatGeographicSuggestionLabel,
  isGeographicPlaceTypes,
  isRejectedTripLocationLabel,
} from "@/lib/location/geographic-only";
import type { LocationSuggestion, TripLocation } from "@/lib/location/types";
import { PLACES_REGION } from "@/lib/places-search-config";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";

const TRIP_PLACE_DETAILS_FIELD_MASK =
  "id,displayName,formattedAddress,location,addressComponents,utcOffsetMinutes,types,primaryType";

const AUTOCOMPLETE_FIELD_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";

const AutocompleteInput = z.object({
  query: z.string().min(1).max(120),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

const ResolveInput = z.object({
  placeId: z.string().min(1).max(200),
});

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type RawPlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  addressComponents?: AddressComponent[];
  utcOffsetMinutes?: number;
  types?: string[];
  primaryType?: string;
};

type AutocompleteSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
    types?: string[];
  };
};

function parseGoogleError(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string; status?: string } };
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch {
    /* ignore */
  }
  return text.slice(0, 200);
}

function componentText(components: AddressComponent[] | undefined, type: string): string {
  const c = components?.find((x) => x.types?.includes(type));
  return c?.longText?.trim() || c?.shortText?.trim() || "";
}

function resolveCity(components: AddressComponent[] | undefined, displayName: string): string {
  const locality = componentText(components, "locality");
  if (locality) return locality;
  const admin2 = componentText(components, "administrative_area_level_2");
  if (admin2) return admin2;
  const admin1 = componentText(components, "administrative_area_level_1");
  if (admin1 && admin1 !== displayName) return admin1;
  return displayName;
}

function resolveRegion(components: AddressComponent[] | undefined): string | undefined {
  const admin1 = componentText(components, "administrative_area_level_1");
  if (admin1) return admin1;
  const admin2 = componentText(components, "administrative_area_level_2");
  return admin2 || undefined;
}

function rawToTripLocation(raw: RawPlaceDetails, placeId: string): TripLocation | null {
  const types = [...(raw.types ?? []), ...(raw.primaryType ? [raw.primaryType] : [])];
  if (!isGeographicPlaceTypes(types)) return null;

  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (lat == null || lng == null) return null;

  const displayName = raw.displayName?.text?.trim() || "";
  const country = componentText(raw.addressComponents, "country") || displayName;
  const city = resolveCity(raw.addressComponents, displayName);
  const region = resolveRegion(raw.addressComponents);
  const utcOffsetMinutes = raw.utcOffsetMinutes ?? null;
  const formattedName = buildFormattedName(country, city, displayName);

  if (isRejectedTripLocationLabel(formattedName)) return null;

  return {
    placeId: raw.id ?? placeId,
    country: country || city,
    city: city || country || displayName,
    region,
    lat,
    lng,
    formattedName,
    displayLabel: formattedName,
    address: raw.formattedAddress,
    timezone: timezoneLabelFromOffset(utcOffsetMinutes),
    utcOffsetMinutes,
  };
}

export const searchTripLocations = createServerFn({ method: "POST" })
  .inputValidator((input) => AutocompleteInput.parse(input))
  .handler(async ({ data }): Promise<{ suggestions: LocationSuggestion[]; error: string | null }> => {
    const apiKey = requireGoogleMapsServerKey();
    const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
    const res = await fetch(placesAutocompleteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify({
        input: data.query.trim(),
        languageCode: localeToGoogleLanguageCode(userLocale),
        regionCode: PLACES_REGION,
        includedPrimaryTypes: [...TRIP_LOCATION_PRIMARY_TYPES],
      }),
    });

    if (!res.ok) {
      const detail = parseGoogleError(await res.text());
      console.error("[Roamie Location] autocomplete failed", res.status, detail);
      return { suggestions: [], error: detail };
    }

    const json = (await res.json()) as { suggestions?: AutocompleteSuggestion[] };
    const suggestions: LocationSuggestion[] = [];
    const seen = new Set<string>();

    for (const s of json.suggestions ?? []) {
      const pred = s.placePrediction;
      const placeId = pred?.placeId;
      if (!placeId) continue;

      const types = pred?.types ?? [];
      if (!isGeographicPlaceTypes(types)) continue;

      const main = pred?.structuredFormat?.mainText?.text ?? pred?.text?.text ?? "";
      const secondary = pred?.structuredFormat?.secondaryText?.text?.trim();
      const label = formatGeographicSuggestionLabel(main, secondary);
      if (!label || isRejectedTripLocationLabel(label)) continue;
      if (seen.has(label)) continue;
      seen.add(label);

      suggestions.push({
        placeId,
        label,
        ...(secondary && !label.includes(secondary) ? { secondary } : {}),
      });
    }

    return { suggestions, error: null };
  });

export const resolveTripLocation = createServerFn({ method: "POST" })
  .inputValidator((input) => ResolveInput.parse(input))
  .handler(async ({ data }): Promise<{ location: TripLocation | null; error: string | null }> => {
    const apiKey = requireGoogleMapsServerKey();
    const res = await fetch(placeDetailsUrl(data.placeId), {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": TRIP_PLACE_DETAILS_FIELD_MASK,
      },
    });

    if (!res.ok) {
      const detail = parseGoogleError(await res.text());
      console.error("[Roamie Location] details failed", res.status, detail);
      return { location: null, error: detail };
    }

    const raw = (await res.json()) as RawPlaceDetails;
    const location = rawToTripLocation(raw, data.placeId);
    if (!location) {
      return { location: null, error: "請選擇國家、城市或地區（非店家或景點）" };
    }
    if (!location.formattedName) {
      const name = formatTripLocationLabel(location);
      location.formattedName = name;
      location.displayLabel = name;
    }
    return { location, error: null };
  });
