import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { TripAffiliateContext } from "@/lib/affiliate/affiliate-types";
import { PLACE_TYPE_CATEGORY_MAP } from "@/lib/affiliate/place-type-category-map";
import { shouldShowTicketAffiliate } from "@/lib/affiliate/ticket-affiliate-eligibility";
import { daysBetweenDates } from "@/lib/fetch-context";
import type { TripLocation } from "@/lib/location/types";

export type AffiliatePlaceInput = Pick<
  RoamieItineraryItem,
  "placeType" | "title" | "placeName" | "description" | "notes"
> & {
  googleTypes?: string[] | null;
  category?: string | null;
  /** AI itinerary / recommendation tags */
  tags?: string[] | null;
};

const COUNTRY_ALIASES: Record<string, string> = {
  台灣: "TW",
  臺灣: "TW",
  taiwan: "TW",
  tw: "TW",
  日本: "JP",
  japan: "JP",
  jp: "JP",
  韓國: "KR",
  南韓: "KR",
  korea: "KR",
  kr: "KR",
  泰國: "TH",
  thailand: "TH",
  th: "TH",
  香港: "HK",
  "hong kong": "HK",
  hk: "HK",
  澳門: "MO",
  macau: "MO",
  mo: "MO",
  新加坡: "SG",
  singapore: "SG",
  sg: "SG",
  中國: "CN",
  中国: "CN",
  china: "CN",
  cn: "CN",
  美國: "US",
  美国: "US",
  usa: "US",
  us: "US",
};

export function normalizeCountryCode(country?: string | null): string {
  const raw = (country ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  return COUNTRY_ALIASES[key] ?? COUNTRY_ALIASES[raw] ?? raw.toUpperCase();
}

export function computeTripNights(
  dayCount: number,
  startDate?: string,
  endDate?: string,
): number {
  if (
    startDate &&
    endDate &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    return Math.max(0, daysBetweenDates(startDate, endDate) - 1);
  }
  return Math.max(0, dayCount - 1);
}

/** 從 payload 讀取 international trip 標記（不 hardcode 城市） */
export function inferInternationalTripFlag(payload: RoamiePayloadV2): boolean {
  const raw = payload as Record<string, unknown>;
  if (raw.isInternational === true || raw.internationalTrip === true) return true;
  const core = payload.coreTrip as Record<string, unknown> | undefined;
  if (core?.isInternational === true || core?.international === true) return true;
  if (typeof raw.tripScope === "string" && /international|overseas|abroad/i.test(raw.tripScope)) {
    return true;
  }
  return false;
}

export function resolveHomeCountryCode(ctx: TripAffiliateContext): string {
  return (
    normalizeCountryCode(ctx.originLocation?.country) ||
    normalizeCountryCode(ctx.userCountryCode) ||
    "TW"
  );
}

export function resolveDestinationCountryCode(ctx: TripAffiliateContext): string {
  return normalizeCountryCode(ctx.destinationLocation?.country);
}

export function resolveIsInternationalTrip(ctx: TripAffiliateContext): {
  international: boolean;
  reason: string;
} {
  if (ctx.isInternational === true) {
    return { international: true, reason: "trip_international_flag" };
  }

  const destCode = resolveDestinationCountryCode(ctx);
  const homeCode = resolveHomeCountryCode(ctx);

  if (destCode && homeCode && destCode !== homeCode) {
    return { international: true, reason: "destination_country_differs" };
  }

  if (destCode && !homeCode) {
    return { international: false, reason: "home_country_unknown" };
  }

  return { international: false, reason: "domestic_or_same_country" };
}

export function parsePlaceGoogleTypes(place: AffiliatePlaceInput): string[] {
  const out = new Set<string>();
  for (const t of place.googleTypes ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const pt = place.placeType?.trim();
  if (pt) {
    if (pt.includes(",")) {
      for (const part of pt.split(",")) {
        const n = part.trim().toLowerCase();
        if (n) out.add(n);
      }
    } else {
      const lower = pt.toLowerCase();
      out.add(lower);
      const mapped = PLACE_TYPE_CATEGORY_MAP[pt] ?? PLACE_TYPE_CATEGORY_MAP[lower];
      if (mapped) out.add(mapped);
    }
  }
  const category = place.category?.trim();
  if (category) {
    out.add(category.toLowerCase());
    const mapped = PLACE_TYPE_CATEGORY_MAP[category];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

export function resolvePlaceCategory(place: AffiliatePlaceInput): string {
  if (place.category?.trim()) return place.category.trim();
  if (place.placeType?.trim()) return place.placeType.trim();
  return "";
}

export function parsePlaceTags(place: AffiliatePlaceInput): string {
  return [
    place.placeType,
    place.description,
    place.notes,
    place.title,
    ...(place.tags ?? []),
  ]
    .filter(Boolean)
    .join("|");
}

function placeTextBlob(place: AffiliatePlaceInput): string {
  return [parsePlaceTags(place), place.placeName, place.title].filter(Boolean).join(" ");
}

export type TicketAffiliateDecision = {
  eligible: boolean;
  reason: string;
};

/** 景點 / 活動：是否顯示 Klook + KKday */
export function resolveTicketAffiliateEligibility(
  place: AffiliatePlaceInput,
): TicketAffiliateDecision {
  const decision = shouldShowTicketAffiliate({
    placeName: place.placeName,
    title: place.title,
    placeType: place.placeType,
    category: place.category,
    types: place.googleTypes ?? undefined,
  });
  return {
    eligible: decision.show,
    reason: decision.reason,
  };
}

export function isTicketEligiblePlace(
  item: Pick<RoamieItineraryItem, "placeType" | "title" | "placeName" | "description" | "notes"> & {
    category?: string | null;
    googleTypes?: string[] | null;
  },
): boolean {
  return resolveTicketAffiliateEligibility(item).eligible;
}

export function isPlaceDetailTicketEligible(place: {
  name?: string | null;
  primaryType?: string | null;
  types?: string[] | null;
  category?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
}): boolean {
  return shouldShowTicketAffiliate({
    name: place.name,
    primaryType: place.primaryType,
    types: place.types,
    category: place.category,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
  }).show;
}

export type HotelAffiliateDecision = {
  eligible: boolean;
  reason: string;
  nights: number;
};

/** 住宿：≥2 日 或 nights ≥ 1，且有目的地 */
export function resolveHotelAffiliateEligibility(ctx: TripAffiliateContext): HotelAffiliateDecision {
  const hasDestination = Boolean(ctx.destinationLabel?.trim());
  const nights = ctx.nights ?? computeTripNights(ctx.dayCount, ctx.startDate, ctx.endDate);

  if (!hasDestination) {
    return { eligible: false, reason: "missing_destination", nights };
  }
  if (ctx.dayCount >= 2 || nights >= 1) {
    return { eligible: true, reason: "multi_day_or_overnight", nights };
  }
  return { eligible: false, reason: "single_day_no_overnight", nights };
}

export type FlightAffiliateDecision = {
  eligible: boolean;
  reason: string;
};

/** 機票：出國行程（跨國 / international flag） */
export function resolveFlightAffiliateEligibility(ctx: TripAffiliateContext): FlightAffiliateDecision {
  if (ctx.dayCount < 1) {
    return { eligible: false, reason: "no_trip_days" };
  }

  const intl = resolveIsInternationalTrip(ctx);
  if (intl.international) {
    return { eligible: true, reason: intl.reason };
  }

  return { eligible: false, reason: intl.reason };
}

export type AffiliateRuleCheckLog = {
  destination?: string;
  country?: string;
  isInternational?: boolean;
  tripDays?: number;
  nights?: number;
  placeName?: string;
  placeTypes?: string;
  category?: string;
  tags?: string;
  showKlook?: boolean;
  showKKday?: boolean;
  showTripFlight?: boolean;
  showAgodaHotel?: boolean;
  showTripHotel?: boolean;
  reason?: string;
};

export function logAffiliateRuleCheck(input: AffiliateRuleCheckLog): void {
  console.info(
    `[AFFILIATE_RULE_CHECK] destination=${input.destination ?? ""} country=${input.country ?? ""} isInternational=${String(input.isInternational ?? false)} tripDays=${input.tripDays ?? ""} nights=${input.nights ?? ""} placeName=${input.placeName ?? ""} placeTypes=${input.placeTypes ?? ""} category=${input.category ?? ""} tags=${input.tags ?? ""} showKlook=${String(input.showKlook ?? false)} showKKday=${String(input.showKKday ?? false)} showTripFlight=${String(input.showTripFlight ?? false)} showAgodaHotel=${String(input.showAgodaHotel ?? false)} showTripHotel=${String(input.showTripHotel ?? false)}${input.reason ? ` reason=${input.reason}` : ""}`,
  );
}

export function logPlaceAffiliateRuleCheck(
  place: AffiliatePlaceInput,
  offers: { provider: string; enabled: boolean }[],
  tripCtx?: TripAffiliateContext,
): void {
  const decision = resolveTicketAffiliateEligibility(place);
  const enabled = offers.filter((o) => o.enabled);
  logAffiliateRuleCheck({
    destination: tripCtx?.destinationLabel,
    country: tripCtx ? resolveDestinationCountryCode(tripCtx) : undefined,
    isInternational: tripCtx ? resolveIsInternationalTrip(tripCtx).international : undefined,
    tripDays: tripCtx?.dayCount,
    nights: tripCtx
      ? (tripCtx.nights ?? computeTripNights(tripCtx.dayCount, tripCtx.startDate, tripCtx.endDate))
      : undefined,
    placeName: place.placeName || place.title || "",
    placeTypes: parsePlaceGoogleTypes(place).join(","),
    category: resolvePlaceCategory(place),
    tags: parsePlaceTags(place),
    showKlook: decision.eligible && enabled.some((o) => o.provider === "klook"),
    showKKday: decision.eligible && enabled.some((o) => o.provider === "kkday"),
    showTripFlight: false,
    showAgodaHotel: false,
    showTripHotel: false,
    reason: decision.reason,
  });
}

export function logTripAffiliateRuleCheck(
  ctx: TripAffiliateContext,
  sections: {
    showAgodaHotel: boolean;
    showTripHotel: boolean;
    showTripFlight: boolean;
  },
): void {
  const hotel = resolveHotelAffiliateEligibility(ctx);
  const flight = resolveFlightAffiliateEligibility(ctx);
  const intl = resolveIsInternationalTrip(ctx);

  logAffiliateRuleCheck({
    destination: ctx.destinationLabel,
    country: resolveDestinationCountryCode(ctx) || ctx.destinationLocation?.country || "",
    isInternational: intl.international,
    tripDays: ctx.dayCount,
    nights: hotel.nights,
    showKlook: false,
    showKKday: false,
    showTripFlight: sections.showTripFlight && flight.eligible,
    showAgodaHotel: sections.showAgodaHotel && hotel.eligible,
    showTripHotel: sections.showTripHotel && hotel.eligible,
    reason: `hotel=${hotel.reason};flight=${flight.reason}`,
  });
}
