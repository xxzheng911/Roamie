import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import { resolveTripAffiliateBaseUrl } from "@/lib/affiliate/affiliate-env";
import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import {
  defaultTripComCurrency,
  mapLocaleToTripCom,
  normalizeTripComDestination,
} from "@/lib/affiliate/trip-com-hotel-url";
import { resolveTripFlightDates } from "@/lib/affiliate/trip-affiliate-dates";
import type { Locale } from "@/lib/i18n/types";

export type TripComFlightUrlInput = {
  departureLabel: string;
  destinationLabel: string;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  locale?: Locale;
  currency?: string;
};

type FlightCityResolution = {
  code?: string;
  airportCode?: string;
  searchName: string;
};

const TRIP_FLIGHT_HOME_PATH = "/flights/";
/** Trip.com TW 實際航班搜尋結果頁（ddate/rdate/triptype 在此 path 生效） */
const TRIP_FLIGHT_SEARCH_PATH = "/flights/showfarefirst";
const TRIP_FLIGHT_VALID_PATHS = new Set([
  "/flights",
  TRIP_FLIGHT_HOME_PATH.replace(/\/$/, ""),
  TRIP_FLIGHT_SEARCH_PATH,
]);

const PRESERVED_TRACKING_KEYS = ["Allianceid", "SID", "trip_sub3"] as const;

const DEFAULT_DEPARTURE_LABEL = "台北";

const FLIGHT_CITY_BY_KEY: Record<string, FlightCityResolution> = {
  高雄: { code: "KHH", airportCode: "KHH", searchName: "Kaohsiung" },
  kaohsiung: { code: "KHH", airportCode: "KHH", searchName: "Kaohsiung" },
  台北: { code: "TPE", airportCode: "TPE", searchName: "Taipei" },
  臺北: { code: "TPE", airportCode: "TPE", searchName: "Taipei" },
  taipei: { code: "TPE", airportCode: "TPE", searchName: "Taipei" },
  松山: { code: "TSA", airportCode: "TSA", searchName: "Taipei Songshan" },
  songshan: { code: "TSA", airportCode: "TSA", searchName: "Taipei Songshan" },
  台中: { code: "RMQ", airportCode: "RMQ", searchName: "Taichung" },
  臺中: { code: "RMQ", airportCode: "RMQ", searchName: "Taichung" },
  taichung: { code: "RMQ", airportCode: "RMQ", searchName: "Taichung" },
  東京: { code: "TYO", airportCode: "NRT", searchName: "Tokyo" },
  东京: { code: "TYO", airportCode: "NRT", searchName: "Tokyo" },
  tokyo: { code: "TYO", airportCode: "NRT", searchName: "Tokyo" },
  大阪: { code: "OSA", airportCode: "KIX", searchName: "Osaka" },
  osaka: { code: "OSA", airportCode: "KIX", searchName: "Osaka" },
  首爾: { code: "SEL", airportCode: "ICN", searchName: "Seoul" },
  首尔: { code: "SEL", airportCode: "ICN", searchName: "Seoul" },
  seoul: { code: "SEL", airportCode: "ICN", searchName: "Seoul" },
  釜山: { code: "PUS", airportCode: "PUS", searchName: "Busan" },
  busan: { code: "PUS", airportCode: "PUS", searchName: "Busan" },
  曼谷: { code: "BKK", airportCode: "BKK", searchName: "Bangkok" },
  bangkok: { code: "BKK", airportCode: "BKK", searchName: "Bangkok" },
  香港: { code: "HKG", airportCode: "HKG", searchName: "Hong Kong" },
  "hong kong": { code: "HKG", airportCode: "HKG", searchName: "Hong Kong" },
  新加坡: { code: "SIN", airportCode: "SIN", searchName: "Singapore" },
  singapore: { code: "SIN", airportCode: "SIN", searchName: "Singapore" },
};

function normalizeIsoDate(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return raw;
}

function normalizeIataCode(value?: string): string | undefined {
  const raw = value?.trim().toUpperCase();
  if (!raw || !/^[A-Z]{3}$/.test(raw)) return undefined;
  return raw;
}

function splitCityParts(label: string): string[] {
  return label
    .split(/[・·/|,，、\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveFlightCityCode(label: string): FlightCityResolution {
  const trimmed = label.trim();
  if (!trimmed) return { searchName: "" };

  const parts = splitCityParts(trimmed);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const key = parts[i]!;
    const hit = FLIGHT_CITY_BY_KEY[key] ?? FLIGHT_CITY_BY_KEY[key.toLowerCase()];
    if (hit) return hit;
  }

  const whole = FLIGHT_CITY_BY_KEY[trimmed] ?? FLIGHT_CITY_BY_KEY[trimmed.toLowerCase()];
  if (whole) return whole;

  const mapped = normalizeTripComDestination(trimmed);
  return {
    searchName: mapped.keyword || parts[parts.length - 1] || trimmed,
  };
}

function parseTripAffiliateBase(env: AffiliateEnvConfig): URL | null {
  const raw = resolveTripAffiliateBaseUrl(env);
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function tripComOrigin(env: AffiliateEnvConfig): string {
  return parseTripAffiliateBase(env)?.origin ?? "https://tw.trip.com";
}

function appendAffiliateTracking(url: URL, env: AffiliateEnvConfig): void {
  const base = parseTripAffiliateBase(env);
  if (!base) return;

  for (const key of PRESERVED_TRACKING_KEYS) {
    const value = base.searchParams.get(key);
    if (value) url.searchParams.set(key, value);
  }

  url.searchParams.set("trip_sub1", "flight");
}

/** Trip.com 機票首頁（不含日期；/flights/ 不會套用 ddate/rdate） */
export function buildTripComFlightHomeUrl(env: AffiliateEnvConfig): string | null {
  const base = parseTripAffiliateBase(env);
  if (!base) return null;

  const url = new URL(`${tripComOrigin(env)}${TRIP_FLIGHT_HOME_PATH}`);
  appendAffiliateTracking(url, env);
  url.searchParams.set("locale", "zh-TW");
  url.searchParams.set("curr", "TWD");
  return url.toString();
}

export function isValidTripComFlightPageUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    if (!host.endsWith("trip.com")) return false;

    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    return TRIP_FLIGHT_VALID_PATHS.has(normalizedPath);
  } catch {
    return false;
  }
}

function originLabelFromTrip(ctx: TripAffiliateContext): string {
  const loc = ctx.originLocation;
  if (loc?.city?.trim()) return loc.city.trim();
  if (loc?.formattedName?.trim()) return loc.formattedName.trim();
  if (loc?.displayLabel?.trim()) return loc.displayLabel.trim();
  return DEFAULT_DEPARTURE_LABEL;
}

type FlightSearchParams = {
  dcity: string;
  acity: string;
  dairport: string;
  aairport: string;
  departDate?: string;
  returnDate?: string;
  triptype: "rt" | "ow";
  adults: number;
  locale: string;
  currency: string;
};

function buildFlightSearchParams(input: TripComFlightUrlInput): FlightSearchParams | null {
  const destinationLabel = input.destinationLabel.trim();
  if (!destinationLabel) return null;

  const departureLabel = input.departureLabel.trim() || DEFAULT_DEPARTURE_LABEL;
  const dep = resolveFlightCityCode(departureLabel);
  const arr = resolveFlightCityCode(destinationLabel);
  const dcity = normalizeIataCode(dep.code);
  const acity = normalizeIataCode(arr.code);
  if (!dcity || !acity) return null;

  const dairport = normalizeIataCode(dep.airportCode) ?? dcity;
  const aairport = normalizeIataCode(arr.airportCode) ?? acity;

  const departDate = normalizeIsoDate(input.startDate);
  const returnDate = normalizeIsoDate(input.endDate);
  const roundTrip = Boolean(departDate && returnDate && returnDate !== departDate);
  const adults = Math.min(99, Math.max(1, input.travelers ?? 1));
  const locale = mapLocaleToTripCom(input.locale);
  const currency = input.currency?.trim() || defaultTripComCurrency(input.locale);

  return {
    dcity: dcity.toLowerCase(),
    acity: acity.toLowerCase(),
    dairport: dairport.toLowerCase(),
    aairport: aairport.toLowerCase(),
    departDate,
    returnDate: roundTrip ? returnDate : undefined,
    triptype: roundTrip ? "rt" : "ow",
    adults,
    locale,
    currency,
  };
}

/** Trip.com showfarefirst 搜尋頁 — 使用 ddate/rdate + triptype + flighttype */
function buildFlightSearchUrl(
  env: AffiliateEnvConfig,
  search: FlightSearchParams,
): string {
  const url = new URL(`${tripComOrigin(env)}${TRIP_FLIGHT_SEARCH_PATH}`);
  appendAffiliateTracking(url, env);

  url.searchParams.set("dcity", search.dcity);
  url.searchParams.set("acity", search.acity);
  url.searchParams.set("dairport", search.dairport);
  url.searchParams.set("aairport", search.aairport);

  if (search.departDate) {
    url.searchParams.set("ddate", search.departDate);
    url.searchParams.set("departureDate", search.departDate);
    url.searchParams.set("departDate", search.departDate);
  }
  if (search.returnDate) {
    url.searchParams.set("rdate", search.returnDate);
    url.searchParams.set("returnDate", search.returnDate);
    url.searchParams.set("adate", search.returnDate);
  }

  url.searchParams.set("triptype", search.triptype);
  url.searchParams.set("flighttype", search.triptype);
  url.searchParams.set("class", "y");
  url.searchParams.set("quantity", String(search.adults));
  url.searchParams.set("adult", String(search.adults));
  url.searchParams.set("childqty", "0");
  url.searchParams.set("babyqty", "0");
  url.searchParams.set("lowpricesource", "searchform");
  url.searchParams.set("searchboxarg", "t");
  url.searchParams.set("nonstoponly", "off");
  url.searchParams.set("SearchType", "F");
  url.searchParams.set("locale", search.locale);
  url.searchParams.set("curr", search.currency);

  return url.toString();
}

/** Trip.com 機票搜尋 deep link（primary=showfarefirst；fallback=機票首頁無日期） */
export function buildTripComFlightUrl(
  input: TripComFlightUrlInput,
  env: AffiliateEnvConfig,
): string | null {
  console.info("[TRIP_AFFILIATE_FLIGHT_URL_BUILD_START]");

  const departDate = normalizeIsoDate(input.startDate);
  const returnDate = normalizeIsoDate(input.endDate);
  if (departDate) {
    console.info(
      `[TRIP_FLIGHT_DATES] departDate=${departDate} returnDate=${returnDate ?? departDate}`,
    );
  }

  const fallbackUrl = buildTripComFlightHomeUrl(env);
  if (!fallbackUrl) return null;

  const searchParams = buildFlightSearchParams(input);
  if (!searchParams) {
    console.info(
      `[TRIP_AFFILIATE_FLIGHT_URL_FALLBACK] reason=missing_airport_codes fallbackUrl=${fallbackUrl}`,
    );
    console.info(`[AFFILIATE_URL_BUILT] type=flight platform=tripcom url=${fallbackUrl}`);
    return fallbackUrl;
  }

  const primaryUrl = buildFlightSearchUrl(env, searchParams);
  if (!isValidTripComFlightPageUrl(primaryUrl)) {
    console.info(
      `[TRIP_AFFILIATE_FLIGHT_URL_FALLBACK] reason=invalid_primary_url fallbackUrl=${fallbackUrl}`,
    );
    console.info(`[AFFILIATE_URL_BUILT] type=flight platform=tripcom url=${fallbackUrl}`);
    return fallbackUrl;
  }

  console.info(`[TRIP_AFFILIATE_FLIGHT_URL_BUILT] url=${primaryUrl}`);
  console.info(`[AFFILIATE_URL_BUILT] type=flight platform=tripcom url=${primaryUrl}`);
  return primaryUrl;
}

export function buildTripComFlightUrlFromTrip(
  ctx: TripAffiliateContext,
  env: AffiliateEnvConfig,
): string | null {
  const dates = resolveTripFlightDates(ctx);
  return buildTripComFlightUrl(
    {
      departureLabel: originLabelFromTrip(ctx),
      destinationLabel: ctx.destinationLabel,
      startDate: dates.departDate,
      endDate: dates.returnDate,
      travelers: ctx.travelers ?? 1,
      locale: ctx.locale,
    },
    env,
  );
}

/** 開啟前再次驗證 path；無效時改用機票首頁 */
export function resolveTripComFlightOpenUrl(
  url: string,
  env: AffiliateEnvConfig,
): string {
  const trimmed = url.trim();
  if (trimmed && isValidTripComFlightPageUrl(trimmed)) {
    console.info(`[TRIP_AFFILIATE_OPEN_FLIGHT] url=${trimmed}`);
    return trimmed;
  }

  const fallbackUrl = buildTripComFlightHomeUrl(env) ?? trimmed;
  console.error(
    `[TRIP_AFFILIATE_OPEN_ERROR] reason=invalid_flight_url attempted=${trimmed || "(empty)"} fallbackUrl=${fallbackUrl}`,
  );
  if (fallbackUrl && isValidTripComFlightPageUrl(fallbackUrl)) {
    console.info(`[TRIP_AFFILIATE_OPEN_FLIGHT] url=${fallbackUrl}`);
  }
  return fallbackUrl;
}
