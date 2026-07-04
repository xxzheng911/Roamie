import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import type { Locale } from "@/lib/i18n/types";
import {
  computeTripNights,
  inferInternationalTripFlag,
  resolveFlightAffiliateEligibility,
  resolveHotelAffiliateEligibility,
  resolveIsInternationalTrip,
} from "@/lib/affiliate/affiliate-display-rules";
import { getTripDateRange } from "@/lib/affiliate/get-trip-date-range";

/** 聯盟導購平台（可擴充） */
export type AffiliateProviderId = "trip" | "agoda" | "booking" | "klook" | "kkday";

export type AffiliateOfferKind = "hotel" | "flight" | "activity_ticket" | "package";

export type AffiliateLinkOffer = {
  provider: AffiliateProviderId;
  kind: AffiliateOfferKind;
  label: string;
  url: string;
  enabled: boolean;
  /** env 缺失等原因 */
  disabledReason?: string;
  destination?: string;
  placeName?: string;
  keyword?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
};

export type TripAffiliateContext = {
  tripId: string;
  destinationLabel: string;
  destinationLocation?: TripLocation | null;
  originLocation?: TripLocation | null;
  dayCount: number;
  nights?: number;
  /** payload / coreTrip 標記的出國行程 */
  isInternational?: boolean;
  /** 使用者所在國家（缺 origin 時 fallback） */
  userCountryCode?: string | null;
  items: RoamieItineraryItem[];
  payload?: RoamiePayloadV2;
  itineraryDays?: Array<{ date?: string | null; dateKey?: string | null } | string>;
  startDate?: string;
  endDate?: string;
  travelers?: number;
  locale?: Locale;
};

/** AI 對話可自然詢問的導購時機（不強制推銷、不自動跳轉） */
export type AffiliateAiHints = {
  /** 行程 >= 2 天時可問「需要住宿推薦嗎？」 */
  suggestHotel: boolean;
  /** 跨國旅遊時可問「需要我幫你找機票嗎？」 */
  suggestFlight: boolean;
};

export function buildTripAffiliateContext(input: {
  tripId: string;
  payload: RoamiePayloadV2;
  items: RoamieItineraryItem[];
  dayCount: number;
  destinationLabel: string;
  itineraryDays?: Array<{ date?: string | null; dateKey?: string | null } | string>;
  travelers?: number;
  locale?: Locale;
}): TripAffiliateContext {
  const destinationLocation = input.payload.destinationLocation ?? null;
  const originLocation = input.payload.originLocation ?? null;
  const dateRange = getTripDateRange({
    tripId: input.tripId,
    payload: input.payload,
    items: input.items,
    dayCount: input.dayCount,
    days: input.payload.days,
    tripSettings: input.payload.tripSettings,
    itineraryDays: input.itineraryDays,
  });
  const startDate = dateRange?.startDate;
  const endDate = dateRange?.endDate;
  const nights = computeTripNights(input.dayCount, startDate, endDate);
  const isInternational = inferInternationalTripFlag(input.payload);

  return {
    tripId: input.tripId,
    destinationLabel: input.destinationLabel,
    destinationLocation,
    originLocation,
    dayCount: input.dayCount,
    nights,
    isInternational,
    userCountryCode: originLocation?.country ?? null,
    items: input.items,
    payload: input.payload,
    itineraryDays: input.itineraryDays,
    startDate,
    endDate,
    travelers: input.travelers,
    locale: input.locale,
  };
}

/** 從 payload 解析旅伴人數（預設 2） */
export function parseTripTravelers(payload: RoamiePayloadV2): number {
  const raw = payload as Record<string, unknown>;
  const travelers = raw.travelers ?? raw.peopleCount;
  if (typeof travelers === "number" && Number.isInteger(travelers) && travelers >= 1) {
    return Math.min(99, travelers);
  }
  return 2;
}

export function deriveAffiliateAiHints(ctx: TripAffiliateContext): AffiliateAiHints {
  return {
    suggestHotel: resolveHotelAffiliateEligibility(ctx).eligible,
    suggestFlight: resolveFlightAffiliateEligibility(ctx).eligible,
  };
}

/** 目的地國家 ≠ 出發地國家（缺 origin 時預設台灣） */
export function isCrossBorderTrip(
  origin?: TripLocation | null,
  destination?: TripLocation | null,
): boolean {
  return resolveTripFlightVisibility(origin, destination).show;
}

/** Trip.com 機票顯示：出國行程（跨國 / international flag） */
export function resolveTripFlightVisibility(
  origin?: TripLocation | null,
  destination?: TripLocation | null,
  destinationLabel?: string,
  dayCount = 1,
  isInternational?: boolean,
): { show: boolean; reason: string } {
  const decision = resolveFlightAffiliateEligibility({
    tripId: "",
    destinationLabel:
      destinationLabel ?? destination?.displayLabel ?? destination?.city ?? "",
    destinationLocation: destination ?? null,
    originLocation: origin ?? null,
    dayCount,
    isInternational,
    userCountryCode: origin?.country ?? null,
    items: [],
  });
  return { show: decision.eligible, reason: decision.reason };
}

export {
  computeTripNights,
  inferInternationalTripFlag,
  isPlaceDetailTicketEligible,
  isTicketEligiblePlace,
  logAffiliateRuleCheck,
  logPlaceAffiliateRuleCheck,
  logTripAffiliateRuleCheck,
  normalizeCountryCode,
  parsePlaceGoogleTypes,
  parsePlaceTags,
  resolveDestinationCountryCode,
  resolveHomeCountryCode,
  resolveHotelAffiliateEligibility,
  resolveIsInternationalTrip,
  resolvePlaceCategory,
  resolveTicketAffiliateEligibility,
} from "@/lib/affiliate/affiliate-display-rules";
