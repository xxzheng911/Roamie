import type { AffiliateEnvConfig } from "@/lib/affiliate/affiliate-env";
import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import { resolveTripStayDates } from "@/lib/affiliate/trip-affiliate-dates";
import {
  defaultTripComCurrency,
  normalizeTripComDestination,
  pickSearchKeyword,
} from "@/lib/affiliate/trip-com-hotel-url";
import type { Locale } from "@/lib/i18n/types";

export type AgodaAffiliateInput = {
  destination?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  rooms?: number;
  locale?: Locale;
  currency?: string;
};

function normalizeIsoDate(value?: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

function mapLocaleToAgodaHl(locale?: Locale): string {
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

function logAgodaAffiliateBuild(input: {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  rooms: number;
  urlHasCheckIn: boolean;
  urlHasCheckOut: boolean;
}): void {
  console.info(
    `[AGODA_AFFILIATE_URL] destination=${input.destination} checkIn=${input.checkIn} checkOut=${input.checkOut} adults=${input.adults} rooms=${input.rooms} urlHasCheckIn=${String(input.urlHasCheckIn)} urlHasCheckOut=${String(input.urlHasCheckOut)}`,
  );
}

/** 以 VITE_AGODA_AFFILIATE_URL 為基底，安全附加搜尋參數（保留 cid / pcs） */
export function buildAgodaAffiliateUrl(
  input: AgodaAffiliateInput,
  env: AffiliateEnvConfig,
): string | null {
  const raw = env.agodaAffiliateUrl?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    const destination = destinationSearchText(input.destination);
    const checkIn = normalizeIsoDate(input.checkIn) ?? "";
    const checkOut = normalizeIsoDate(input.checkOut) ?? "";
    const adults = Math.min(99, Math.max(1, input.adults ?? 2));
    const rooms = Math.min(9, Math.max(1, input.rooms ?? 1));
    const currency = input.currency?.trim() || defaultTripComCurrency(input.locale);
    const hl = mapLocaleToAgodaHl(input.locale);

    if (!url.searchParams.has("hl")) url.searchParams.set("hl", hl);
    if (!url.searchParams.has("currency")) url.searchParams.set("currency", currency);

    if (destination) {
      url.searchParams.set("cityName", destination);
      url.searchParams.set("textToSearch", destination);
    }

    if (checkIn) {
      url.searchParams.set("checkin", checkIn);
      url.searchParams.set("checkIn", checkIn);
    }
    if (checkOut) {
      url.searchParams.set("checkout", checkOut);
      url.searchParams.set("checkOut", checkOut);
    }

    url.searchParams.set("NumberofAdults", String(adults));
    url.searchParams.set("adults", String(adults));
    url.searchParams.set("Rooms", String(rooms));
    url.searchParams.set("rooms", String(rooms));

    logAgodaAffiliateBuild({
      destination,
      checkIn,
      checkOut,
      adults,
      rooms,
      urlHasCheckIn: url.searchParams.has("checkin") || url.searchParams.has("checkIn"),
      urlHasCheckOut: url.searchParams.has("checkout") || url.searchParams.has("checkOut"),
    });

    return url.toString();
  } catch {
    return null;
  }
}

/** 依行程上下文組 Agoda 住宿搜尋 URL（不會用今天日期替代使用者未設定的日期） */
export function buildAgodaHotelUrl(
  ctx: TripAffiliateContext,
  env: AffiliateEnvConfig,
): string | null {
  const stay = resolveTripStayDates(ctx);
  const mapped = normalizeTripComDestination(ctx.destinationLabel);
  const destination =
    pickSearchKeyword(mapped, ctx.locale) || ctx.destinationLabel?.trim() || "";

  return buildAgodaAffiliateUrl(
    {
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
