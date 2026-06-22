import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import {
  buildTripComAffiliateUrl,
  getTripComBaseAffiliateUrl,
} from "@/lib/affiliate/trip-com-affiliate-url";
import {
  defaultTripComCurrency,
  mapLocaleToTripCom,
  normalizeTripComDestination,
  pickSearchKeyword,
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
  airportCodes?: string[];
  searchName: string;
};

const FLIGHT_CITY_BY_KEY: Record<string, FlightCityResolution> = {
  高雄: { code: "KHH", airportCodes: ["KHH"], searchName: "Kaohsiung" },
  kaohsiung: { code: "KHH", airportCodes: ["KHH"], searchName: "Kaohsiung" },
  台北: { code: "TPE", airportCodes: ["TPE", "TSA"], searchName: "Taipei" },
  臺北: { code: "TPE", airportCodes: ["TPE", "TSA"], searchName: "Taipei" },
  taipei: { code: "TPE", airportCodes: ["TPE", "TSA"], searchName: "Taipei" },
  松山: { code: "TSA", airportCodes: ["TSA"], searchName: "Taipei Songshan" },
  songshan: { code: "TSA", airportCodes: ["TSA"], searchName: "Taipei Songshan" },
  東京: { code: "TYO", airportCodes: ["NRT", "HND"], searchName: "Tokyo" },
  东京: { code: "TYO", airportCodes: ["NRT", "HND"], searchName: "Tokyo" },
  tokyo: { code: "TYO", airportCodes: ["NRT", "HND"], searchName: "Tokyo" },
  大阪: { code: "OSA", airportCodes: ["KIX"], searchName: "Osaka" },
  osaka: { code: "OSA", airportCodes: ["KIX"], searchName: "Osaka" },
  首爾: { code: "SEL", airportCodes: ["ICN", "GMP"], searchName: "Seoul" },
  首尔: { code: "SEL", airportCodes: ["ICN", "GMP"], searchName: "Seoul" },
  seoul: { code: "SEL", airportCodes: ["ICN", "GMP"], searchName: "Seoul" },
  釜山: { code: "PUS", airportCodes: ["PUS"], searchName: "Busan" },
  busan: { code: "PUS", airportCodes: ["PUS"], searchName: "Busan" },
  曼谷: { code: "BKK", airportCodes: ["BKK", "DMK"], searchName: "Bangkok" },
  bangkok: { code: "BKK", airportCodes: ["BKK", "DMK"], searchName: "Bangkok" },
  香港: { code: "HKG", airportCodes: ["HKG"], searchName: "Hong Kong" },
  "hong kong": { code: "HKG", airportCodes: ["HKG"], searchName: "Hong Kong" },
  新加坡: { code: "SIN", airportCodes: ["SIN"], searchName: "Singapore" },
  singapore: { code: "SIN", airportCodes: ["SIN"], searchName: "Singapore" },
};

function normalizeIsoDate(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
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

function originLabelFromTrip(ctx: TripAffiliateContext): string {
  const loc = ctx.originLocation;
  if (loc?.city?.trim()) return loc.city.trim();
  if (loc?.formattedName?.trim()) return loc.formattedName.trim();
  if (loc?.displayLabel?.trim()) return loc.displayLabel.trim();
  return "";
}

function logTripFlightUrlBuild(input: {
  departure: string;
  destination: string;
  departureCode?: string;
  destinationCode?: string;
  startDate?: string;
  endDate?: string;
  travelers: number;
  hasSearchParams: boolean;
}): void {
  console.info(
    `[Affiliate] flightTripLink hasOrigin=${Boolean(input.departure)} hasDestination=${Boolean(input.destination)} hasDates=${Boolean(input.startDate)} departureCode=${input.departureCode ?? ""} destinationCode=${input.destinationCode ?? ""}`,
  );
}

/** Trip.com 機票搜尋 deep link（保留聯盟 tracking） */
export function buildTripComFlightUrl(
  input: TripComFlightUrlInput,
  env: AffiliateEnvConfig,
): string | null {
  const baseUrl = getTripComBaseAffiliateUrl(env);
  if (!baseUrl) return null;

  const departureLabel = input.departureLabel.trim();
  const destinationLabel = input.destinationLabel.trim();
  const dep = resolveFlightCityCode(departureLabel);
  const arr = resolveFlightCityCode(destinationLabel);
  const startDate = normalizeIsoDate(input.startDate);
  const endDate = normalizeIsoDate(input.endDate);
  const roundTrip = Boolean(startDate && endDate && endDate !== startDate);
  const adults = Math.min(99, Math.max(1, input.travelers ?? 1));
  const locale = mapLocaleToTripCom(input.locale);
  const currency = input.currency?.trim() || defaultTripComCurrency(input.locale);

  const params: Record<string, string> = {
    locale,
    lang: locale,
    curr: currency,
    barCurr: currency,
    quantity: String(adults),
    adult: String(adults),
    childqty: "0",
    babyqty: "0",
    children: "0",
    class: "y",
    SearchType: "F",
    triptype: roundTrip ? "1" : "0",
    flighttype: roundTrip ? "rt" : "ow",
  };

  if (dep.code) {
    params.dcity = dep.code;
    if (dep.airportCodes?.[0]) params.dairport = dep.airportCodes[0];
  } else if (dep.searchName) {
    params.dcityname = dep.searchName;
  }

  if (arr.code) {
    params.acity = arr.code;
    if (arr.airportCodes?.[0]) params.aairport = arr.airportCodes[0];
  } else if (arr.searchName) {
    params.acityname = arr.searchName;
  }

  if (startDate) {
    params.ddate = startDate;
    params.departureDate = startDate;
  }
  if (roundTrip && endDate) {
    params.rdate = endDate;
    params.adate = endDate;
    params.returnDate = endDate;
  }

  const hasSearchParams = Boolean(
    (dep.code || dep.searchName) && (arr.code || arr.searchName),
  );

  logTripFlightUrlBuild({
    departure: departureLabel,
    destination: destinationLabel,
    departureCode: dep.code,
    destinationCode: arr.code,
    startDate,
    endDate,
    travelers: adults,
    hasSearchParams,
  });

  return (
    buildTripComAffiliateUrl(env, "flight", {
      sub1: "flight",
      params,
    }) ?? baseUrl.replace(/\/?$/, "/flights/")
  );
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
      startDate: dates.startDate,
      endDate: dates.endDate,
      travelers: ctx.travelers ?? 1,
      locale: ctx.locale,
    },
    env,
  );
}
