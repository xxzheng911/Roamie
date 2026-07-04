import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import { resolveAgodaCityId } from "@/lib/affiliate/agoda-city-ids";
import { resolveAgodaStayDates } from "@/lib/affiliate/trip-affiliate-dates";
import {
  defaultTripComCurrency,
  normalizeTripComDestination,
  pickSearchKeyword,
} from "@/lib/affiliate/trip-com-hotel-url";
import type { Locale } from "@/lib/i18n/types";

export type AgodaAffiliateInput = {
  tripId?: string;
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  rooms?: number;
  locale?: Locale;
  currency?: string;
};

const AGODA_SEARCH_ORIGIN = "https://www.agoda.com";

function normalizeIsoDate(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return raw;
}

function mapLocaleToAgodaPath(locale?: Locale): string {
  switch (locale) {
    case "en":
      return "en-us";
    case "ja":
      return "ja-jp";
    case "ko":
      return "ko-kr";
    case "zh-TW":
    default:
      return "zh-tw";
  }
}

function destinationSearchText(destination?: string): string {
  const trimmed = destination?.trim() ?? "";
  if (!trimmed) return "";
  const mapped = normalizeTripComDestination(trimmed);
  return mapped.zhKeyword?.trim() || mapped.keyword?.trim() || trimmed;
}

type AgodaTracking = {
  cid: string;
  pcs: string;
};

function parseAgodaTracking(rawAffiliateUrl: string): AgodaTracking | null {
  try {
    const parsed = new URL(rawAffiliateUrl);
    const cid = parsed.searchParams.get("cid")?.trim() ?? "";
    const pcs = parsed.searchParams.get("pcs")?.trim() ?? "1";
    if (!cid) return null;
    return { cid, pcs };
  } catch {
    return null;
  }
}

/**
 * Agoda 城市搜尋頁（/zh-tw/search）— 官方可帶 checkIn/checkOut + city。
 * partnersearch.aspx 僅適合 hid 單一飯店，cityName 會 redirect 到首頁且日期常失效。
 */
export function buildAgodaAffiliateUrl(
  input: AgodaAffiliateInput,
  env: AffiliateEnvConfig,
): string | null {
  const tracking = parseAgodaTracking(env.agodaAffiliateUrl?.trim() ?? "");
  if (!tracking) return null;

  const tripId = input.tripId?.trim() ?? "";
  const checkIn = normalizeIsoDate(input.checkIn) ?? "";
  const checkOut = normalizeIsoDate(input.checkOut) ?? "";
  const destination = destinationSearchText(input.destination);
  const cityId = destination ? resolveAgodaCityId(destination) : undefined;
  const adults = Math.min(99, Math.max(1, input.adults ?? 2));
  const rooms = Math.min(9, Math.max(1, input.rooms ?? 1));
  const currency = input.currency?.trim() || defaultTripComCurrency(input.locale);
  const localePath = mapLocaleToAgodaPath(input.locale);

  if (!checkIn || !checkOut) {
    console.info(`[AFFILIATE_DATE_MISSING] tripId=${tripId || "(none)"} reason=missing_hotel_dates`);
  } else {
    console.info(`[AGODA_HOTEL_DATES] checkIn=${checkIn} checkOut=${checkOut}`);
  }

  const url = new URL(`${AGODA_SEARCH_ORIGIN}/${localePath}/search`);

  if (cityId) {
    url.searchParams.set("city", cityId);
  } else if (destination) {
    url.searchParams.set("textToSearch", destination);
  }

  if (checkIn) url.searchParams.set("checkIn", checkIn);
  if (checkOut) url.searchParams.set("checkOut", checkOut);

  url.searchParams.set("adults", String(adults));
  url.searchParams.set("rooms", String(rooms));
  url.searchParams.set("children", "0");
  url.searchParams.set("currency", currency);
  url.searchParams.set("cid", tracking.cid);
  url.searchParams.set("pcs", tracking.pcs);
  url.searchParams.set("pslc", "1");

  const built = url.toString();
  console.info(
    `[AFFILIATE_URL_BUILT] type=hotel platform=agoda cityId=${cityId ?? ""} url=${built}`,
  );
  return built;
}

/** 依行程上下文組 Agoda 住宿搜尋 URL */
export function buildAgodaHotelUrl(
  ctx: TripAffiliateContext,
  env: AffiliateEnvConfig,
): string | null {
  const stay = resolveAgodaStayDates(ctx);
  const mapped = normalizeTripComDestination(ctx.destinationLabel);
  const destination =
    pickSearchKeyword(mapped, ctx.locale) || ctx.destinationLabel?.trim() || "";

  return buildAgodaAffiliateUrl(
    {
      tripId: ctx.tripId,
      destination,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      adults: ctx.travelers ?? 2,
      rooms: 1,
      locale: ctx.locale,
      currency: defaultTripComCurrency(ctx.locale),
    },
    env,
  );
}
