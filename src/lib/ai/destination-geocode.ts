import type { Locale } from "@/lib/i18n/types";
import type { TripLocation } from "@/lib/location/types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import type { SearchAttempt } from "@/lib/ai/chat-place-recommendation";
import {
  logChatGeocodeFallback,
  logChatGeocodeRequest,
  logChatGeocodeResponse,
  logChatTextSearchResponse,
} from "@/lib/ai/chat-place-flow-log";
import {
  logItineraryGeocodeQuery,
  sanitizeDestinationForGeocode,
} from "@/lib/ai/itinerary-entity-extraction";
import {
  getResolvedDestinationScope,
  lockDestinationCoordinatesFromGeocode,
  setResolvedDestinationScope,
} from "@/lib/ai/resolved-destination-scope";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { devVerboseInfo } from "@/lib/dev-verbose-log";

export type GeocodeDestinationFn = (args: {
  data: { query: string; locale?: Locale };
}) => Promise<{ location: TripLocation | null; error: string | null }>;

type GeocodeCacheEntry = {
  location: TripLocation | null;
  error: string | null;
  at: number;
};

const GEOCODE_FAIL_TTL_MS = 30_000;
const GEOCODE_OK_TTL_MS = 30 * 60 * 1000;

const destinationCoordinateCache = new Map<string, GeocodeCacheEntry>();
const inFlightGeocodeMap = new Map<string, Promise<TripLocation | null>>();

function geocodeCacheKey(destination: string, countryCode?: string): string {
  const label = normalizeDestinationLabel(destination);
  const cc = (countryCode ?? "").trim().toUpperCase();
  return cc ? `${label}|${cc}` : label;
}

function readGeocodeCache(key: string, now = Date.now()): GeocodeCacheEntry | null {
  const entry = destinationCoordinateCache.get(key);
  if (!entry) return null;
  const ttl = entry.location ? GEOCODE_OK_TTL_MS : GEOCODE_FAIL_TTL_MS;
  if (now - entry.at > ttl) {
    destinationCoordinateCache.delete(key);
    return null;
  }
  return entry;
}

export function clearDestinationGeocodeCache(destination?: string): void {
  if (!destination) {
    destinationCoordinateCache.clear();
    inFlightGeocodeMap.clear();
    return;
  }
  const label = normalizeDestinationLabel(destination);
  for (const key of [...destinationCoordinateCache.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      destinationCoordinateCache.delete(key);
    }
  }
  for (const key of [...inFlightGeocodeMap.keys()]) {
    if (key === label || key.startsWith(`${label}|`)) {
      inFlightGeocodeMap.delete(key);
    }
  }
}

/** 景區／國家森林遊樂區 — geocode 需用完整正式名稱 */
const SCENIC_GEOCODE: Record<string, readonly string[]> = {
  阿里山: [
    "阿里山國家森林遊樂區, 嘉義縣, 台灣",
    "阿里山, 嘉義縣, 台灣",
    "Alishan National Forest Recreation Area, Taiwan",
    "Alishan, Chiayi County, Taiwan",
  ],
  日月潭: [
    "日月潭, 南投縣, 台灣",
    "Sun Moon Lake, Nantou County, Taiwan",
  ],
  太魯閣: [
    "太魯閣國家公園, 花蓮縣, 台灣",
    "Taroko National Park, Hualien, Taiwan",
  ],
};

/** 模糊地名 → geocode 查詢（優先順序） */
const TW_AMBIGUOUS_GEOCODE: Record<string, readonly string[]> = {
  嘉義: ["嘉義市, 台灣", "嘉義縣, 台灣", "Chiayi City, Taiwan", "Chiayi County, Taiwan"],
  新竹: ["新竹市, 台灣", "新竹縣, 台灣", "Hsinchu City, Taiwan", "Hsinchu County, Taiwan"],
  台中: ["台中市, 台灣", "Taichung City, Taiwan", "Taichung, Taiwan"],
  臺中: ["台中市, 台灣", "Taichung City, Taiwan", "Taichung, Taiwan"],
  彰化: ["彰化縣, 台灣", "Changhua County, Taiwan"],
};

const COUNTRY_EN: Record<string, string> = {
  澳洲: "Australia",
  日本: "Japan",
  韓國: "South Korea",
  泰國: "Thailand",
  新加坡: "Singapore",
  法國: "France",
  英國: "United Kingdom",
  美國: "United States",
  台灣: "Taiwan",
};

export const EN_CITY_NAMES: Record<string, string> = {
  嘉義: "Chiayi",
  新竹: "Hsinchu",
  台中: "Taichung",
  臺中: "Taichung",
  彰化: "Changhua",
  花蓮: "Hualien",
  台南: "Tainan",
  臺南: "Tainan",
  高雄: "Kaohsiung",
  台北: "Taipei",
  臺北: "Taipei",
  宜蘭: "Yilan",
  屏東: "Pingtung",
  台東: "Taitung",
  臺東: "Taitung",
  澎湖: "Penghu",
  金門: "Kinmen",
  東京: "Tokyo",
  大阪: "Osaka",
  首爾: "Seoul",
  京都: "Kyoto",
  曼谷: "Bangkok",
  新加坡: "Singapore",
  雪梨: "Sydney",
  墨爾本: "Melbourne",
  巴黎: "Paris",
  倫敦: "London",
  紐約: "New York",
  洛杉磯: "Los Angeles",
  舊金山: "San Francisco",
  清邁: "Chiang Mai",
  香港: "Hong Kong",
  澳門: "Macau",
  釜山: "Busan",
  福岡: "Fukuoka",
  名古屋: "Nagoya",
  橫濱: "Yokohama",
  冰島: "Iceland",
  濟州: "Jeju",
  沖繩: "Okinawa",
  北海道: "Hokkaido",
  九州: "Kyushu",
  峇里島: "Bali",
  長灘島: "Boracay",
};

const INTL_GEOCODE: Record<string, readonly string[]> = {
  東京: ["Tokyo, Japan", "東京都, 日本", "Tokyo Metropolis, Japan"],
  大阪: ["Osaka, Japan", "大阪府, 日本", "Osaka, Osaka Prefecture, Japan"],
  首爾: ["Seoul, South Korea", "首爾, 韓國", "Seoul, Korea"],
  京都: ["Kyoto, Japan", "京都府, 日本"],
  曼谷: ["Bangkok, Thailand", "曼谷, 泰國"],
  新加坡: ["Singapore", "新加坡"],
  墨爾本: ["Melbourne, Victoria, Australia", "Melbourne, Australia", "墨爾本, 澳洲"],
  雪梨: ["Sydney, New South Wales, Australia", "Sydney, Australia", "雪梨, 澳洲"],
  巴黎: ["Paris, France", "巴黎, 法國"],
  倫敦: ["London, United Kingdom", "倫敦, 英國"],
  紐約: ["New York, NY, USA", "New York City, United States"],
  洛杉磯: ["Los Angeles, CA, USA", "Los Angeles, California"],
  舊金山: ["San Francisco, CA, USA", "San Francisco, California"],
  清邁: ["Chiang Mai, Thailand", "清邁, 泰國"],
  香港: ["Hong Kong", "香港"],
  澳門: ["Macau", "Macao", "澳門"],
  釜山: ["Busan, South Korea", "釜山, 韓國"],
  冰島: ["Iceland", "冰島", "Reykjavik, Iceland", "雷克雅維克, 冰島"],
  濟州: [
    "濟州島, 韓國",
    "Jeju Island, South Korea",
    "Jeju-do, South Korea",
    "Jeju-si, South Korea",
    "Jeju, South Korea",
    "제주도",
    "제주",
    "濟州, 韓國",
  ],
  沖繩: ["Okinawa, Japan", "沖繩縣, 日本", "Okinawa Island, Japan"],
  北海道: ["Hokkaido, Japan", "北海道, 日本", "Sapporo, Hokkaido, Japan"],
  九州: ["Kyushu, Japan", "九州, 日本", "Fukuoka, Japan"],
  峇里島: ["Bali, Indonesia", "峇里島, 印尼", "Denpasar, Bali"],
  長灘島: ["Boracay, Philippines", "長灘島, 菲律賓"],
};

/** 無 geocode 時 text search 用的近似中心 */
const DESTINATION_APPROX_CENTER: Record<string, { lat: number; lng: number }> = {
  嘉義: { lat: 23.4801, lng: 120.4491 },
  新竹: { lat: 24.8138, lng: 120.9675 },
  台中: { lat: 24.1477, lng: 120.6736 },
  臺中: { lat: 24.1477, lng: 120.6736 },
  彰化: { lat: 24.08, lng: 120.54 },
  花蓮: { lat: 23.9871, lng: 121.6015 },
  台南: { lat: 22.9997, lng: 120.227 },
  臺南: { lat: 22.9997, lng: 120.227 },
  高雄: { lat: 22.6273, lng: 120.3014 },
  台北: { lat: 25.033, lng: 121.5654 },
  臺北: { lat: 25.033, lng: 121.5654 },
  阿里山: { lat: 23.508, lng: 120.801 },
  台東: { lat: 22.758, lng: 121.1444 },
  臺東: { lat: 22.758, lng: 121.1444 },
  宜蘭: { lat: 24.757, lng: 121.753 },
  屏東: { lat: 22.669, lng: 120.489 },
  苗栗: { lat: 24.564, lng: 120.823 },
  東京: { lat: 35.6762, lng: 139.6503 },
  大阪: { lat: 34.6937, lng: 135.5023 },
  首爾: { lat: 37.5665, lng: 126.978 },
  京都: { lat: 35.0116, lng: 135.7681 },
  曼谷: { lat: 13.7563, lng: 100.5018 },
  新加坡: { lat: 1.3521, lng: 103.8198 },
  墨爾本: { lat: -37.8136, lng: 144.9631 },
  雪梨: { lat: -33.8688, lng: 151.2093 },
  巴黎: { lat: 48.8566, lng: 2.3522 },
  倫敦: { lat: 51.5074, lng: -0.1278 },
  紐約: { lat: 40.7128, lng: -74.006 },
  洛杉磯: { lat: 34.0522, lng: -118.2437 },
  舊金山: { lat: 37.7749, lng: -122.4194 },
  清邁: { lat: 18.7883, lng: 98.9853 },
  香港: { lat: 22.3193, lng: 114.1694 },
  澳門: { lat: 22.1987, lng: 113.5439 },
  釜山: { lat: 35.1796, lng: 129.0756 },
  濟州: { lat: 33.4996, lng: 126.5312 },
  沖繩: { lat: 26.2124, lng: 127.6809 },
  北海道: { lat: 43.0618, lng: 141.3545 },
  九州: { lat: 33.5904, lng: 130.4017 },
  峇里島: { lat: -8.4095, lng: 115.1889 },
  長灘島: { lat: 11.9674, lng: 121.9248 },
  冰島: { lat: 64.1466, lng: -21.9426 },
  雷克雅維克: { lat: 64.1466, lng: -21.9426 },
};

const DEFAULT_SEARCH_CENTER = { lat: 23.9739, lng: 120.9823 };

function isTaiwanDestination(label: string): boolean {
  const entity = resolveDestinationEntity(label);
  if (entity.country === "台灣" || entity.country === "台湾") return true;
  if (entity.type === "country" && (label === "台灣" || label === "台湾")) return true;
  return Boolean(DESTINATION_APPROX_CENTER[label] && !INTL_GEOCODE[label]);
}

export function buildDestinationGeocodeQueries(destination: string, _locale?: Locale): string[] {
  const label = sanitizeDestinationForGeocode(destination);
  const queries: string[] = [];
  const entity = resolveDestinationEntity(label);
  const country = entity.country;
  const en = EN_CITY_NAMES[label];

  const scenic = SCENIC_GEOCODE[label];
  if (scenic) queries.push(...scenic);

  const intl = INTL_GEOCODE[label];
  if (intl) queries.push(...intl);

  const preset = TW_AMBIGUOUS_GEOCODE[label];
  if (preset) queries.push(...preset);

  // Region / island query expansion — never rely on a single short label.
  if (
    entity.type === "island" ||
    entity.type === "region" ||
    entity.type === "state" ||
    /(島|岛)$/.test(label)
  ) {
    queries.push(label);
    if (!label.endsWith("島") && !label.endsWith("岛")) {
      queries.push(`${label}島`, `${label}岛`);
    }
    if (en) {
      queries.push(en, `${en} Island`, `${en}-do`, `${en}-si`, `${en} Island, South Korea`);
    }
    if (country) {
      const countryEn = COUNTRY_EN[country] ?? country;
      queries.push(`${label}, ${country}`, `${label}, ${countryEn}`);
      if (en) queries.push(`${en}, ${countryEn}`, `${en} Island, ${countryEn}`);
    }
  }

  if (country && country !== "台灣" && country !== "台湾") {
    const countryEn = COUNTRY_EN[country] ?? country;
    if (en) {
      queries.push(`${en}, ${countryEn}`, `${en}, ${country}`);
    }
    queries.push(`${label}, ${country}`, `${label}, ${countryEn}`);
  } else if (isTaiwanDestination(label) || !country) {
    queries.push(`${label}市, 台灣`, `${label}縣, 台灣`, `${label}, 台灣`, `${label}, Taiwan`);
    if (en) {
      queries.push(`${en} City, Taiwan`, `${en}, Taiwan`, `${en} County, Taiwan`);
    }
  }

  queries.push(label);

  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

export function resolveDestinationApproxCenter(
  destination: string,
): { lat: number; lng: number } | null {
  const label = normalizeDestinationLabel(destination);
  const known = DESTINATION_APPROX_CENTER[label];
  if (known) return known;

  const entity = resolveDestinationEntity(label);
  if (entity.country && entity.country !== "台灣" && entity.country !== "台湾") {
    return null;
  }

  return DEFAULT_SEARCH_CENTER;
}

export function buildDestinationTextSearchAttempts(destination: string): SearchAttempt[] {
  const label = normalizeDestinationLabel(destination);
  const en = EN_CITY_NAMES[label] ?? label;
  const base = [
    { query: `${label} popular attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 景點`, mode: "text", includedTypes: ["tourist_attraction", "museum", "art_gallery"] },
    { query: `${label} 必去景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${label} 室內景點`, mode: "text", includedTypes: ["museum", "shopping_mall", "art_gallery"] },
    { query: `${label} 美術館`, mode: "text", includedTypes: ["museum", "art_gallery"] },
    { query: `${label} 商圈`, mode: "text", includedTypes: ["shopping_mall", "tourist_attraction"] },
    { query: `${label} 夜市`, mode: "text", includedTypes: ["market", "tourist_attraction"] },
    { query: `${label} 美食`, mode: "text", includedTypes: ["restaurant"] },
    { query: `${label} 咖啡`, mode: "text", includedTypes: ["cafe", "coffee_shop"] },
    { query: `${label} 著名景點`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} tourist attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
    { query: `${en} attractions`, mode: "text", includedTypes: ["tourist_attraction"] },
  ] as SearchAttempt[];

  if (label === "冰島" || en === "Iceland") {
    base.push(
      { query: "冰島 景點", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 極光", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 冰川", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "冰島 溫泉", mode: "text", includedTypes: ["tourist_attraction", "spa"] },
      { query: "Iceland attractions", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland aurora", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland glacier", mode: "text", includedTypes: ["tourist_attraction"] },
      { query: "Iceland itinerary", mode: "text", includedTypes: ["tourist_attraction"] },
    );
  }

  return base;
}

export async function geocodeDestinationWithFallback(params: {
  destination: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  /** When true (default), reuse locked / approx center and skip live geocode spam. */
  preferCachedCoordinates?: boolean;
}): Promise<TripLocation | null> {
  const { destination, locale, geocodeFn } = params;
  const label = normalizeDestinationLabel(destination);
  const cacheKey = geocodeCacheKey(label);
  const preferCached = params.preferCachedCoordinates !== false;

  if (preferCached) {
    const locked = getResolvedDestinationScope(label);
    if (locked) {
      logAiPipeline(
        "[DESTINATION_RESOLUTION_REUSED]",
        "source=scope_lock",
        `destination=${label}`,
        `lat=${locked.latitude}`,
        `lng=${locked.longitude}`,
      );
      return {
        placeId: `scope:${label}`,
        country: "台灣",
        city: label,
        lat: locked.latitude,
        lng: locked.longitude,
        formattedName: label,
        displayLabel: label,
        address: label,
        timezone: undefined,
        utcOffsetMinutes: null,
      };
    }
    const approx = resolveDestinationApproxCenter(label);
    if (approx) {
      setResolvedDestinationScope({
        displayName: label,
        normalizedName: label,
        latitude: approx.lat,
        longitude: approx.lng,
        source: "approx_center",
        resolvedAt: Date.now(),
      });
      logAiPipeline(
        "[DESTINATION_RESOLUTION_REUSED]",
        "source=approx_center",
        `destination=${label}`,
        `lat=${approx.lat}`,
        `lng=${approx.lng}`,
      );
      return {
        placeId: `approx:${label}`,
        country: "台灣",
        city: label,
        lat: approx.lat,
        lng: approx.lng,
        formattedName: label,
        displayLabel: label,
        address: label,
        timezone: undefined,
        utcOffsetMinutes: null,
      };
    }
  }

  const cached = readGeocodeCache(cacheKey);
  if (cached?.location) {
    logAiPipeline("[GEOCODE_REQUEST_DEDUPED]", `key=${cacheKey}`, "source=cache_hit");
    return cached.location;
  }
  if (cached && !cached.location) {
    logAiPipeline(
      "[GEOCODE_REQUEST_DEDUPED]",
      `key=${cacheKey}`,
      `source=cache_fail`,
      `error=${cached.error ?? "unknown"}`,
    );
    return null;
  }

  const inflight = inFlightGeocodeMap.get(cacheKey);
  if (inflight) {
    logAiPipeline("[GEOCODE_REQUEST_DEDUPED]", `key=${cacheKey}`, "source=in_flight");
    return inflight;
  }

  const task = (async (): Promise<TripLocation | null> => {
    const queries = buildDestinationGeocodeQueries(destination, locale);
    let lastError: string | null = null;

    for (let qi = 0; qi < queries.length; qi += 1) {
      const query = queries[qi]!;
      if (qi > 0) {
        logAiPipeline("[GEOCODE_QUERY_RETRY]", `query=${query}`, `attempt=${qi + 1}`);
      }
      logChatGeocodeRequest(query);
      // Only log itinerary geocode once per outer destination to cut duplicate noise.
      if (query === queries[0]) {
        logItineraryGeocodeQuery(query);
      }
      try {
        const result = await geocodeFn({ data: { query, locale } });
        const loc = result.location;
        if (loc?.lat != null && loc?.lng != null) {
          logChatGeocodeResponse("ok", `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`);
          lockDestinationCoordinatesFromGeocode({
            destination: label,
            lat: loc.lat,
            lng: loc.lng,
          });
          destinationCoordinateCache.set(cacheKey, {
            location: loc,
            error: null,
            at: Date.now(),
          });
          return loc;
        }
        lastError = result.error ?? "geocode_empty_response";
        logChatGeocodeFallback(query, lastError);
        devVerboseInfo(
          "[GEOCODE_FAILURE_DETAIL]",
          `code=${lastError}`,
          `query=${query}`,
        );
        // Auth / rate-limit: stop burning queries in this round.
        if (
          lastError === "geocode_auth_error" ||
          lastError === "geocode_rate_limited" ||
          lastError === "geocode_network_error"
        ) {
          break;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        logChatGeocodeFallback(query, lastError);
      }
    }

    // Known admin centers remain usable even when Geocoding API fails.
    const approx = resolveDestinationApproxCenter(label);
    if (approx) {
      logChatGeocodeResponse("approx_fallback", `${approx.lat},${approx.lng}`);
      const loc: TripLocation = {
        placeId: `approx:${label}`,
        country: "台灣",
        city: label,
        lat: approx.lat,
        lng: approx.lng,
        formattedName: label,
        displayLabel: label,
        address: label,
        timezone: undefined,
        utcOffsetMinutes: null,
      };
      lockDestinationCoordinatesFromGeocode({
        destination: label,
        lat: approx.lat,
        lng: approx.lng,
      });
      destinationCoordinateCache.set(cacheKey, {
        location: loc,
        error: null,
        at: Date.now(),
      });
      return loc;
    }

    logChatGeocodeResponse("empty", lastError ?? "all_queries_failed");
    destinationCoordinateCache.set(cacheKey, {
      location: null,
      error: lastError ?? "geocode_empty_response",
      at: Date.now(),
    });
    return null;
  })().finally(() => {
    inFlightGeocodeMap.delete(cacheKey);
  });

  inFlightGeocodeMap.set(cacheKey, task);
  return task;
}

export function logDestinationTextSearchResult(count: number): void {
  logChatTextSearchResponse(count);
}
