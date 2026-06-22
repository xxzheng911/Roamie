import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import {
  geocodeForwardUrl,
  placeDetailsUrl,
  placesAutocompleteUrl,
} from "@/lib/google-maps-api";
import { getGoogleMapsBrowserKey } from "@/lib/google-maps-client";
import { localeToGeocodeRegion, localeToGoogleLanguageCode } from "@/lib/i18n/places-language";
import type { Locale } from "@/lib/i18n/types";
import type { RoamieItineraryItem } from "@/lib/ai/types";

const PLACE_COORDS_MASK = "location";

function normalizePlaceId(raw: string): string {
  return raw.replace(/^places\//, "").trim();
}

/** 依地名推斷 geocode region，避免 zh-TW 預設 tw 把東京地點偏到台灣 */
function geocodeRegionForQuery(query: string, locale: Locale): string | undefined {
  const q = query;
  if (/東京|大阪|京都|日本|横濱|横浜|神戸|奈良|札幌|福岡|沖繩|沖縄|淺草|上野|新宿|澀谷|银座|銀座|隅田/i.test(q)) {
    return "jp";
  }
  if (/首爾|首爾|韓國|釜山|明洞|弘大|濟州/i.test(q)) {
    return "kr";
  }
  if (/台北|台灣|高雄|台中|台南|新北|桃園/i.test(q)) {
    return "tw";
  }
  if (/曼谷|泰國|清邁|普吉/i.test(q)) {
    return "th";
  }
  return localeToGeocodeRegion(locale);
}

function geocodeQueriesForItem(item: RoamieItineraryItem): string[] {
  const name = (item.placeName || item.title || "").trim();
  const address = item.address?.trim() ?? "";
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  push(address);
  push(name);
  if (address && name && !address.includes(name)) push(`${address} ${name}`);
  if (name.includes("・")) push(name.replace(/[·・]/g, " "));
  if (/東京|大阪|京都|淺草|上野|隅田|雷門|阿美橫|涩谷|渋谷|新宿|银座|銀座/i.test(`${address} ${name}`) && name) {
    const bare = name.replace(/^東京\s*/, "");
    push(`日本 ${bare}`);
    push(`東京都 ${bare}`);
  }

  return out;
}

async function fetchPlaceCoordsClient(
  placeId: string,
  locale: Locale,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) return null;

  const normalized = normalizePlaceId(placeId);
  const languageCode = localeToGoogleLanguageCode(locale);
  const res = await fetch(placeDetailsUrl(normalized, languageCode), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACE_COORDS_MASK,
      "Accept-Language": languageCode,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(
      `[ROUTE_DURATION_ERROR] status=place_details http=${res.status} message=${text.slice(0, 200)}`,
    );
    return null;
  }

  const raw = (await res.json()) as {
    location?: { latitude?: number; longitude?: number };
  };
  const lat = raw.location?.latitude;
  const lng = raw.location?.longitude;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

async function geocodeTextToCoordsClient(
  query: string,
  locale: Locale,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) return null;

  const language = localeToGoogleLanguageCode(locale);
  const region = geocodeRegionForQuery(query, locale);
  const queries = [query.trim(), query.trim().replace(/[·・,，/\s]+/g, " ")].filter(Boolean);
  const uniqueQueries = [...new Set(queries)];

  for (const q of uniqueQueries) {
    const regionParam = geocodeRegionForQuery(q, locale);
    const res = await fetch(
      geocodeForwardUrl(q, apiKey, { language, region: regionParam ?? region }),
    );
    const json = (await res.json()) as {
      status?: string;
      error_message?: string;
      results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
    };

    if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
      console.warn(
        `[ROUTE_DURATION_ERROR] status=geocode_${json.status} message=${json.error_message ?? "geocode_failed"} query=${q}`,
      );
    }

    const loc = json.results?.[0]?.geometry?.location;
    if (loc?.lat != null && loc?.lng != null) {
      return { lat: loc.lat, lng: loc.lng };
    }
  }

  return null;
}

async function autocompleteTextToCoordsClient(
  query: string,
  locale: Locale,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(placesAutocompleteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify({
        input: query.trim(),
        languageCode: localeToGoogleLanguageCode(locale),
      }),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; place?: string } }>;
    };
    const pred = json.suggestions?.[0]?.placePrediction;
    const placeId = normalizePlaceId(pred?.placeId ?? pred?.place?.replace(/^places\//, "") ?? "");
    if (!placeId) return null;

    return fetchPlaceCoordsClient(placeId, locale);
  } catch {
    return null;
  }
}

export type ResolveTripStopCoordsDeps = {
  locale: Locale;
  resolveStopFn: (args: {
    data: { placeId: string; locale?: Locale };
  }) => Promise<{ stop: { lat: number | null; lng: number | null } | null; error: string | null }>;
  geocodeFn: (args: {
    data: { query: string; locale?: Locale };
  }) => Promise<{ location: { lat: number; lng: number } | null; error: string | null }>;
};

async function geocodeItemToCoords(
  item: RoamieItineraryItem,
  deps: ResolveTripStopCoordsDeps,
  preferClient: boolean,
): Promise<{ lat: number; lng: number } | null> {
  const queries = geocodeQueriesForItem(item);

  for (const q of queries) {
    if (preferClient) {
      const coords = await geocodeTextToCoordsClient(q, deps.locale);
      if (coords) return coords;
    } else {
      try {
        const result = await deps.geocodeFn({ data: { query: q, locale: deps.locale } });
        if (result.location?.lat != null && result.location?.lng != null) {
          return { lat: result.location.lat, lng: result.location.lng };
        }
      } catch {
        /* try next */
      }
      const coords = await geocodeTextToCoordsClient(q, deps.locale);
      if (coords) return coords;
    }
  }

  for (const q of queries) {
    const coords = await autocompleteTextToCoordsClient(q, deps.locale);
    if (coords) return coords;
  }

  return null;
}

/** 解析行程地點座標：Capacitor 優先 client API，web 先 server 再 client fallback */
export async function resolveTripStopCoords(
  item: RoamieItineraryItem,
  deps: ResolveTripStopCoordsDeps,
): Promise<{ lat: number; lng: number } | null> {
  if (
    item.lat != null &&
    item.lng != null &&
    !Number.isNaN(item.lat) &&
    !Number.isNaN(item.lng)
  ) {
    return { lat: item.lat, lng: item.lng };
  }

  const preferClient = isCapacitorNativeShell();
  const placeId = item.googlePlaceId?.trim();

  if (placeId) {
    if (preferClient) {
      const coords = await fetchPlaceCoordsClient(placeId, deps.locale);
      if (coords) return coords;
    } else {
      try {
        const resolved = await deps.resolveStopFn({ data: { placeId, locale: deps.locale } });
        if (resolved.stop?.lat != null && resolved.stop?.lng != null) {
          return { lat: resolved.stop.lat, lng: resolved.stop.lng };
        }
        if (resolved.error) {
          console.warn(`[ROUTE_DURATION_ERROR] status=place_details message=${resolved.error}`);
        }
      } catch (e) {
        console.warn(
          `[ROUTE_DURATION_ERROR] status=place_details_exception message=${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const coords = await fetchPlaceCoordsClient(placeId, deps.locale);
      if (coords) return coords;
    }
  }

  const name = item.placeName || item.title;
  if (!name && !item.address?.trim()) return null;

  return geocodeItemToCoords(item, deps, preferClient);
}
