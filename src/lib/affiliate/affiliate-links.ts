import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import type {
  AffiliateLinkOffer,
  AffiliateOfferKind,
  AffiliateProviderId,
  TripAffiliateContext,
} from "@/lib/affiliate/affiliate-types";
import {
  deriveAffiliateAiHints,
  isCrossBorderTrip,
  isTicketEligiblePlace,
} from "@/lib/affiliate/affiliate-types";

type AffiliateEnvConfig = {
  tripAccountId: string;
  tripWebsiteId: string;
  klookAid: string;
  kkdayCid: string;
  agodaAid: string;
  bookingAid: string;
};

function readEnv(key: string): string {
  const v = import.meta.env[key];
  return typeof v === "string" ? v.trim() : "";
}

export function readAffiliateEnv(): AffiliateEnvConfig {
  return {
    tripAccountId: readEnv("VITE_TRIP_ACCOUNT_ID"),
    tripWebsiteId: readEnv("VITE_TRIP_WEBSITE_ID"),
    klookAid: readEnv("VITE_KLOOK_AID"),
    kkdayCid: readEnv("VITE_KKDAY_CID"),
    agodaAid: readEnv("VITE_AFFILIATE_AGODA_AID"),
    bookingAid: readEnv("VITE_AFFILIATE_BOOKING_AID"),
  };
}

function encodeQuery(value: string): string {
  return encodeURIComponent(value.trim());
}

function buildTripHotelUrl(destination: string, env: AffiliateEnvConfig): string | null {
  if (!env.tripAccountId || !env.tripWebsiteId) {
    console.warn("[Affiliate] Trip.com hotel link disabled: missing VITE_TRIP_ACCOUNT_ID or VITE_TRIP_WEBSITE_ID");
    return null;
  }
  const qs = new URLSearchParams({
    city: destination,
    Allianceid: env.tripAccountId,
    SID: env.tripWebsiteId,
  });
  return `https://www.trip.com/hotels/list?${qs.toString()}`;
}

function buildTripFlightUrl(destination: string, env: AffiliateEnvConfig): string | null {
  if (!env.tripAccountId || !env.tripWebsiteId) {
    console.warn("[Affiliate] Trip.com flight link disabled: missing VITE_TRIP_ACCOUNT_ID or VITE_TRIP_WEBSITE_ID");
    return null;
  }
  const qs = new URLSearchParams({
    Allianceid: env.tripAccountId,
    SID: env.tripWebsiteId,
    tripType: "1",
  });
  if (destination) qs.set("acity", destination);
  return `https://www.trip.com/flights/?${qs.toString()}`;
}

function buildKlookUrl(query: string, env: AffiliateEnvConfig): string | null {
  if (!env.klookAid) {
    console.warn("[Affiliate] Klook link disabled: missing VITE_KLOOK_AID");
    return null;
  }
  const qs = new URLSearchParams({ query, aid: env.klookAid });
  return `https://www.klook.com/zh-TW/search/?${qs.toString()}`;
}

function buildKkdayUrl(query: string, env: AffiliateEnvConfig): string | null {
  if (!env.kkdayCid) {
    console.warn("[Affiliate] KKday link disabled: missing VITE_KKDAY_CID");
    return null;
  }
  const qs = new URLSearchParams({ keyword: query, cid: env.kkdayCid });
  return `https://www.kkday.com/zh-tw/search?${qs.toString()}`;
}

/** Agoda：無 affiliate id 時使用一般搜尋入口（TODO: 串接 VITE_AFFILIATE_AGODA_AID） */
function buildAgodaUrl(destination: string, env: AffiliateEnvConfig): string {
  const qs = new URLSearchParams({ city: destination });
  if (env.agodaAid) qs.set("cid", env.agodaAid);
  return `https://www.agoda.com/search?${qs.toString()}`;
}

/** Booking.com：無 affiliate id 時使用一般搜尋入口 */
function buildBookingUrl(destination: string, env: AffiliateEnvConfig): string {
  const qs = new URLSearchParams({ ss: destination });
  if (env.bookingAid) qs.set("aid", env.bookingAid);
  return `https://www.booking.com/searchresults.html?${qs.toString()}`;
}

function offer(
  provider: AffiliateProviderId,
  kind: AffiliateOfferKind,
  label: string,
  url: string | null,
  disabledReason?: string,
): AffiliateLinkOffer {
  return {
    provider,
    kind,
    label,
    url: url ?? "",
    enabled: Boolean(url),
    disabledReason,
  };
}

export function buildHotelAffiliateOffers(ctx: TripAffiliateContext): AffiliateLinkOffer[] {
  if (ctx.dayCount < 2) return [];
  const env = readAffiliateEnv();
  const dest = ctx.destinationLabel;
  return [
    offer(
      "trip",
      "hotel",
      "Trip.com 尋找住宿",
      buildTripHotelUrl(dest, env),
      "missing_trip_env",
    ),
  ].filter((o) => o.enabled);
}

export function buildFlightAffiliateOffers(ctx: TripAffiliateContext): AffiliateLinkOffer[] {
  if (!isCrossBorderTrip(ctx.originLocation, ctx.destinationLocation)) return [];
  const env = readAffiliateEnv();
  const dest = ctx.destinationLabel;
  return [
    offer(
      "trip",
      "flight",
      "Trip.com 查看機票",
      buildTripFlightUrl(dest, env),
      "missing_trip_env",
    ),
  ].filter((o) => o.enabled);
}

export function buildTicketAffiliateOffers(placeQuery: string): AffiliateLinkOffer[] {
  const q = placeQuery.trim();
  if (!q) return [];
  const env = readAffiliateEnv();
  return [
    offer("klook", "activity_ticket", "Klook", buildKlookUrl(q, env), "missing_klook_env"),
    offer("kkday", "activity_ticket", "KKday", buildKkdayUrl(q, env), "missing_kkday_env"),
  ].filter((o) => o.enabled);
}

export function buildPlaceTicketOffers(
  item: Parameters<typeof isTicketEligiblePlace>[0],
): AffiliateLinkOffer[] {
  if (!isTicketEligiblePlace(item)) return [];
  const query = item.placeName || item.title;
  return buildTicketAffiliateOffers(query);
}

/** 開啟聯盟外連：Capacitor Browser 優先，否則 window.open */
export async function openAffiliateUrl(url: string): Promise<void> {
  if (!url) return;
  try {
    if (isCapacitorNativeShell()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "fullscreen" });
      return;
    }
  } catch (e) {
    console.warn("[Affiliate] Capacitor Browser failed, fallback to window.open", e);
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export { deriveAffiliateAiHints, isTicketEligiblePlace };
