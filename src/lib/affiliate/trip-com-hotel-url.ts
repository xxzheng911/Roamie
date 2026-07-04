import type { Locale } from "@/lib/i18n/types";
import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import {
  buildTripComAffiliateUrl,
  getTripComBaseAffiliateUrl,
} from "@/lib/affiliate/trip-com-affiliate-url";

export type TripComHotelUrlInput = {
  destination: string;
  startDate?: string;
  endDate?: string;
  adults?: number;
  locale?: Locale;
  currency?: string;
};

export type TripComDestination = {
  keyword: string;
  cityId?: string;
  countryId?: string;
  /** zh-TW / zh-CN display keyword for search box */
  zhKeyword?: string;
};

const TRIP_CITY_BY_KEY: Record<string, TripComDestination> = {
  東京: { keyword: "Tokyo", cityId: "228", countryId: "78", zhKeyword: "東京" },
  东京: { keyword: "Tokyo", cityId: "228", countryId: "78", zhKeyword: "东京" },
  tokyo: { keyword: "Tokyo", cityId: "228", countryId: "78", zhKeyword: "東京" },
  大阪: { keyword: "Osaka", cityId: "219", countryId: "78", zhKeyword: "大阪" },
  osaka: { keyword: "Osaka", cityId: "219", countryId: "78", zhKeyword: "大阪" },
  京都: { keyword: "Kyoto", cityId: "220", countryId: "78", zhKeyword: "京都" },
  kyoto: { keyword: "Kyoto", cityId: "220", countryId: "78", zhKeyword: "京都" },
  首爾: { keyword: "Seoul", cityId: "274", countryId: "42", zhKeyword: "首爾" },
  首尔: { keyword: "Seoul", cityId: "274", countryId: "42", zhKeyword: "首尔" },
  seoul: { keyword: "Seoul", cityId: "274", countryId: "42", zhKeyword: "首爾" },
  釜山: { keyword: "Busan", cityId: "279", countryId: "42", zhKeyword: "釜山" },
  busan: { keyword: "Busan", cityId: "279", countryId: "42", zhKeyword: "釜山" },
  台北: { keyword: "Taipei", cityId: "617", countryId: "1", zhKeyword: "台北" },
  臺北: { keyword: "Taipei", cityId: "617", countryId: "1", zhKeyword: "台北" },
  taipei: { keyword: "Taipei", cityId: "617", countryId: "1", zhKeyword: "台北" },
  台中: { keyword: "Taichung", cityId: "1369", countryId: "1", zhKeyword: "台中" },
  臺中: { keyword: "Taichung", cityId: "1369", countryId: "1", zhKeyword: "台中" },
  taichung: { keyword: "Taichung", cityId: "1369", countryId: "1", zhKeyword: "台中" },
  高雄: { keyword: "Kaohsiung", cityId: "720", countryId: "1", zhKeyword: "高雄" },
  kaohsiung: { keyword: "Kaohsiung", cityId: "720", countryId: "1", zhKeyword: "高雄" },
  香港: { keyword: "Hong Kong", cityId: "58", countryId: "1", zhKeyword: "香港" },
  "hong kong": { keyword: "Hong Kong", cityId: "58", countryId: "1", zhKeyword: "香港" },
  曼谷: { keyword: "Bangkok", cityId: "359", countryId: "4", zhKeyword: "曼谷" },
  bangkok: { keyword: "Bangkok", cityId: "359", countryId: "4", zhKeyword: "曼谷" },
  新加坡: { keyword: "Singapore", cityId: "73", countryId: "3", zhKeyword: "新加坡" },
  singapore: { keyword: "Singapore", cityId: "73", countryId: "3", zhKeyword: "新加坡" },
  上海: { keyword: "Shanghai", cityId: "2", countryId: "1", zhKeyword: "上海" },
  shanghai: { keyword: "Shanghai", cityId: "2", countryId: "1", zhKeyword: "上海" },
  北京: { keyword: "Beijing", cityId: "1", countryId: "1", zhKeyword: "北京" },
  beijing: { keyword: "Beijing", cityId: "1", countryId: "1", zhKeyword: "北京" },
  沖繩: { keyword: "Okinawa", countryId: "78", zhKeyword: "沖繩" },
  冲绳: { keyword: "Okinawa", countryId: "78", zhKeyword: "冲绳" },
  okinawa: { keyword: "Okinawa", countryId: "78", zhKeyword: "沖繩" },
  福岡: { keyword: "Fukuoka", cityId: "733", countryId: "78", zhKeyword: "福岡" },
  福冈: { keyword: "Fukuoka", cityId: "733", countryId: "78", zhKeyword: "福冈" },
  fukuoka: { keyword: "Fukuoka", cityId: "733", countryId: "78", zhKeyword: "福岡" },
  札幌: { keyword: "Sapporo", cityId: "236", countryId: "78", zhKeyword: "札幌" },
  sapporo: { keyword: "Sapporo", cityId: "236", countryId: "78", zhKeyword: "札幌" },
  名古屋: { keyword: "Nagoya", cityId: "222", countryId: "78", zhKeyword: "名古屋" },
  nagoya: { keyword: "Nagoya", cityId: "222", countryId: "78", zhKeyword: "名古屋" },
  橫濱: { keyword: "Yokohama", cityId: "229", countryId: "78", zhKeyword: "橫濱" },
  横滨: { keyword: "Yokohama", cityId: "229", countryId: "78", zhKeyword: "横滨" },
  yokohama: { keyword: "Yokohama", cityId: "229", countryId: "78", zhKeyword: "橫濱" },
  濟州: { keyword: "Jeju", cityId: "737", countryId: "42", zhKeyword: "濟州" },
  济州: { keyword: "Jeju", cityId: "737", countryId: "42", zhKeyword: "济州" },
  jeju: { keyword: "Jeju", cityId: "737", countryId: "42", zhKeyword: "濟州" },
};

function normalizeIsoDate(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return undefined;
}

function splitDestinationParts(destination: string): string[] {
  return destination
    .split(/[・·/|,，、\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function lookupTripDestination(part: string): TripComDestination | null {
  const key = part.trim();
  if (!key) return null;
  const direct = TRIP_CITY_BY_KEY[key] ?? TRIP_CITY_BY_KEY[key.toLowerCase()];
  if (direct) return direct;
  return null;
}

/** 將行程目的地轉成 Trip.com 可搜尋的 keyword（含常見城市 mapping） */
export function normalizeTripComDestination(destination: string): TripComDestination {
  const trimmed = destination.trim();
  if (!trimmed) {
    return { keyword: "" };
  }

  const parts = splitDestinationParts(trimmed);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const hit = lookupTripDestination(parts[i]!);
    if (hit) return hit;
  }

  const whole = lookupTripDestination(trimmed);
  if (whole) return whole;

  const fallbackPart = parts[parts.length - 1] ?? trimmed;
  return { keyword: fallbackPart };
}

export function mapLocaleToTripCom(locale?: Locale): string {
  switch (locale) {
    case "en":
      return "en-US";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "zh-TW":
    default:
      return "zh-TW";
  }
}

export function defaultTripComCurrency(locale?: Locale): string {
  switch (locale) {
    case "ja":
      return "JPY";
    case "ko":
      return "KRW";
    case "en":
      return "USD";
    case "zh-TW":
    default:
      return "TWD";
  }
}

export function pickSearchKeyword(dest: TripComDestination, locale?: Locale): string {
  if ((locale === "zh-TW" || !locale) && dest.zhKeyword) return dest.zhKeyword;
  return dest.keyword;
}

function logTripAffiliateHotelUrl(details: {
  hasDestination: boolean;
  hasDates: boolean;
}): void {
  console.info(
    `[Affiliate] tripHotelLink hasDestination=${details.hasDestination} hasDates=${details.hasDates}`,
  );
}

export function buildTripComHotelUrl(
  input: TripComHotelUrlInput,
  env: AffiliateEnvConfig,
): string | null {
  const baseUrl = getTripComBaseAffiliateUrl(env);
  if (!baseUrl) return null;

  const tripDestination = input.destination.trim();
  if (!tripDestination) return baseUrl;

  const mapped = normalizeTripComDestination(tripDestination);
  const searchKeyword = pickSearchKeyword(mapped, input.locale) || tripDestination;

  const locale = mapLocaleToTripCom(input.locale);
  const currency = input.currency?.trim() || defaultTripComCurrency(input.locale);
  const adults = Math.min(99, Math.max(1, input.adults ?? 2));
  const checkIn = normalizeIsoDate(input.startDate) ?? "";
  const checkOut = normalizeIsoDate(input.endDate) ?? "";

  const params: Record<string, string> = {
    locale,
    lang: locale,
    barCurr: currency,
    adult: String(adults),
    children: "0",
    crn: "1",
    searchType: "CT",
    keyword: searchKeyword,
    searchValue: searchKeyword,
    searchBoxArg: "t",
    travelPurpose: "0",
  };

  if (mapped.cityId) params.city = mapped.cityId;
  if (mapped.countryId) params.countryId = mapped.countryId;
  if (checkIn) {
    params.checkIn = checkIn;
    params.checkin = checkIn;
  }
  if (checkOut) {
    params.checkOut = checkOut;
    params.checkout = checkOut;
  } else if (checkIn) {
    params.checkOut = checkIn;
    params.checkout = checkIn;
  }

  const finalUrl =
    buildTripComAffiliateUrl(env, "hotel", {
      sub1: "hotel",
      params,
    }) ?? baseUrl;

  logTripAffiliateHotelUrl({
    hasDestination: Boolean(tripDestination),
    hasDates: Boolean(checkIn),
  });

  console.info(`[AFFILIATE_URL_BUILT] type=hotel url=${finalUrl}`);

  return finalUrl;
}

/** 點按 Trip.com 連結前再次記錄（不輸出完整 URL） */
export function logTripComAffiliateOpen(_finalUrl: string): void {
  console.info("[Affiliate] tripComLink action=open");
}
