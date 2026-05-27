import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  placesAutocompleteUrl,
  placeDetailsUrl,
  PLACE_DETAILS_FIELD_MASK,
} from "@/lib/google-maps-api";
import { localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import { coerceLocale } from "@/lib/i18n/resolve-locale";
import type { Locale } from "@/lib/i18n/types";
import { PLACES_REGION } from "@/lib/places-search-config";
import { identityDisplayLabel, resolvePlaceIdentity } from "@/lib/place-identity";
import type { PlaceResult } from "@/lib/place-result";
import { buildPlaceMapsUrl } from "@/lib/maps-navigation";

const AUTOCOMPLETE_MASK =
  "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types";

const StopSearchInput = z.object({
  query: z.string().min(1).max(120),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  sessionToken: z.string().min(8).max(128).optional(),
});

const ResolveStopInput = z.object({
  placeId: z.string().min(1).max(200),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

export type TripStopSuggestion = {
  placeId: string;
  label: string;
  secondary?: string;
  types?: string[];
};

export type ResolvedTripStop = TripStopSuggestion & {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  placeType: string;
  googleMapsUrl: string;
  photoName: string | null;
  rating: number | null;
};

function normalizeGooglePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
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

export const searchTripStops = createServerFn({ method: "POST" })
  .inputValidator((input) => StopSearchInput.parse(input))
  .handler(
    async ({ data }): Promise<{ suggestions: TripStopSuggestion[]; error: string | null }> => {
      const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
      const apiKey = requireGoogleMapsServerKey();
      const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
      const body: Record<string, unknown> = {
        input: data.query.trim(),
        languageCode: localeToGoogleLanguageCode(userLocale),
        regionCode: PLACES_REGION,
      };
      if (data.sessionToken) {
        body.sessionToken = data.sessionToken;
      }
      if (data.lat != null && data.lng != null) {
        body.locationBias = {
          circle: {
            center: { latitude: data.lat, longitude: data.lng },
            radius: 50_000,
          },
        };
      }

      const res = await fetch(placesAutocompleteUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": AUTOCOMPLETE_MASK,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = parseGoogleError(await res.text());
        console.info("[PLACES_SEARCH] query=", data.query.trim());
        console.info("[PLACES_SEARCH] endpoint=", "placesAutocomplete");
        console.info("[PLACES_SEARCH] predictions=", 0);
        console.info("[PLACES_SEARCH] error=", detail);
        return { suggestions: [], error: detail };
      }

      const json = (await res.json()) as {
        suggestions?: Array<{
          placePrediction?: {
            placeId?: string;
            place?: string;
            text?: { text?: string };
            structuredFormat?: {
              mainText?: { text?: string };
              secondaryText?: { text?: string };
            };
            types?: string[];
          };
        }>;
      };

      const suggestions: TripStopSuggestion[] = [];
      const seen = new Set<string>();
      for (const s of json.suggestions ?? []) {
        const pred = s.placePrediction;
        const placeId = normalizeGooglePlaceId(
          pred?.placeId ?? (pred?.place ? pred.place.replace(/^places\//, "") : ""),
        );
        if (!placeId || seen.has(placeId)) continue;
        seen.add(placeId);
        const label =
          pred?.structuredFormat?.mainText?.text?.trim() || pred?.text?.text?.trim() || "";
        if (!label) continue;
        suggestions.push({
          placeId,
          label,
          secondary: pred?.structuredFormat?.secondaryText?.text?.trim(),
          types: pred?.types,
        });
      }

      console.info("[PLACES_SEARCH] query=", data.query.trim());
      console.info("[PLACES_SEARCH] endpoint=", "placesAutocomplete");
      console.info("[PLACES_SEARCH] predictions=", suggestions.length);
      if (suggestions.length === 0) {
        console.info("[PLACES_SEARCH] error=", "ZERO_RESULTS");
      }
      return { suggestions, error: null };
    },
  );

export const resolveTripStop = createServerFn({ method: "POST" })
  .inputValidator((input) => ResolveStopInput.parse(input))
  .handler(async ({ data }): Promise<{ stop: ResolvedTripStop | null; error: string | null }> => {
    const normalizedPlaceId = normalizeGooglePlaceId(data.placeId);
    const { requireGoogleMapsServerKey } = await import("@/lib/google-maps.server");
    const apiKey = requireGoogleMapsServerKey();
    const userLocale: Locale = data.locale ? coerceLocale(data.locale) : "zh-TW";
    const requestUrl = placeDetailsUrl(normalizedPlaceId);
    console.info("[PLACES_DETAILS] start placeId=", normalizedPlaceId);
    console.info("[PLACES_DETAILS] request url=", requestUrl);
    const res = await fetch(requestUrl, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
        "Accept-Language": localeToGoogleLanguageCode(userLocale),
      },
    });
    console.info("[PLACES_DETAILS] status=", res.status);

    if (!res.ok) {
      const rawError = await res.text();
      console.error("[PLACES_DETAILS] raw response=", rawError.slice(0, 500));
      const parsedError = parseGoogleError(rawError);
      if (parsedError.includes("REQUEST_DENIED")) {
        return {
          stop: null,
          error:
            "Places API Details 權限未開，或 API key restriction 未允許 Places API，或 billing 設定有問題。",
        };
      }
      return { stop: null, error: parsedError };
    }

    const raw = (await res.json()) as {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
      primaryType?: string;
      types?: string[];
      rating?: number;
      photos?: Array<{ name: string }>;
    };
    console.info("[PLACES_DETAILS] raw response=", JSON.stringify(raw).slice(0, 1000));

    const name = raw.displayName?.text?.trim() || "地點";
    const lat = raw.location?.latitude ?? null;
    const lng = raw.location?.longitude ?? null;
    const effectivePlaceId = normalizeGooglePlaceId(raw.id ?? normalizedPlaceId);
    const place: PlaceResult = {
      id: effectivePlaceId,
      name,
      address: raw.formattedAddress ?? null,
      lat,
      lng,
      rating: raw.rating ?? null,
      userRatingCount: null,
      photoName: raw.photos?.[0]?.name ?? null,
      primaryType: raw.primaryType ?? null,
      types: raw.types ?? null,
      businessStatus: null,
      openStatus: "unknown",
      openStatusLabel: "",
      todayHoursLabel: "",
      closingSoonNote: "",
      nextOpenHint: "",
    };

    return {
      stop: {
        placeId: effectivePlaceId,
        label: name,
        secondary: place.address ?? undefined,
        name,
        address: place.address ?? "",
        lat,
        lng,
        placeType: identityDisplayLabel(resolvePlaceIdentity(place)),
        googleMapsUrl: buildPlaceMapsUrl(name, lat, lng),
        photoName: place.photoName,
        rating: place.rating,
      },
      error: null,
    };
  });
