import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import type {
  AffiliateLinkOffer,
  AffiliateOfferKind,
  AffiliateProviderId,
  TripAffiliateContext,
} from "@/lib/affiliate/affiliate-types";
import {
  deriveAffiliateAiHints,
  isPlaceDetailTicketEligible,
  isTicketEligiblePlace,
} from "@/lib/affiliate/affiliate-types";
import {
  logPlaceAffiliateRuleCheck,
  logTripAffiliateRuleCheck,
  resolveFlightAffiliateEligibility,
  resolveHotelAffiliateEligibility,
  resolveTicketAffiliateEligibility,
} from "@/lib/affiliate/affiliate-display-rules";
import {
  getAffiliateEnv,
  warnAffiliateOnce,
  type AffiliateEnvConfig,
} from "@/lib/affiliate/affiliate-env";
import { isDebugAffiliateEnabled } from "@/lib/affiliate/affiliate-debug-log";
import { logAffiliateClick, logAffiliateRender } from "@/lib/affiliate/affiliate-url-utils";
import {
  probeAffiliateRedirectUrl,
  resolveAffiliatePlatform,
} from "@/lib/affiliate/affiliate-open-url";
import { buildAgodaAffiliateUrl, buildAgodaHotelUrl } from "@/lib/affiliate/agoda-affiliate-url";
import { buildKlookAffiliateUrl } from "@/lib/affiliate/klook-affiliate-url";
import {
  buildTripComFlightUrlFromTrip,
  resolveTripComFlightOpenUrl,
} from "@/lib/affiliate/trip-com-flight-url";
import {
  buildTripComHotelUrl,
  normalizeTripComDestination,
  pickSearchKeyword,
} from "@/lib/affiliate/trip-com-hotel-url";
import {
  buildTripComAffiliateUrl,
  getTripComBaseAffiliateUrl,
} from "@/lib/affiliate/trip-com-affiliate-url";
import {
  buildKkdayAffiliateUrl,
  buildKkdaySearchKeyword,
  type KkdayAffiliateInput,
} from "@/lib/affiliate/kkday-affiliate-url";
import type { TicketAffiliatePlaceInput } from "@/lib/affiliate/ticket-affiliate-eligibility";
import {
  resolveTicketAffiliateTripContext,
  shouldShowTicketAffiliate,
} from "@/lib/affiliate/ticket-affiliate-eligibility";
import { resolveAgodaStayDates, resolveTripStayDates } from "@/lib/affiliate/trip-affiliate-dates";
import type { TripLocation } from "@/lib/location/types";
import type { Locale } from "@/lib/i18n/types";

export {
  getAffiliateEnv,
  readAffiliateEnv,
  resolveTripAffiliateBaseUrl,
} from "@/lib/affiliate/affiliate-env";
export {
  normalizeTripComDestination,
  buildTripComHotelUrl,
} from "@/lib/affiliate/trip-com-hotel-url";
export {
  buildKkdayAffiliateUrl,
  buildKkdaySearchKeyword,
} from "@/lib/affiliate/kkday-affiliate-url";
export { buildKlookAffiliateUrl } from "@/lib/affiliate/klook-affiliate-url";
export { buildAgodaAffiliateUrl, buildAgodaHotelUrl } from "@/lib/affiliate/agoda-affiliate-url";
export {
  buildTripComFlightUrl,
  buildTripComFlightUrlFromTrip,
  buildTripComFlightHomeUrl,
  isValidTripComFlightPageUrl,
  resolveFlightCityCode,
  resolveTripComFlightOpenUrl,
} from "@/lib/affiliate/trip-com-flight-url";
export {
  shouldShowTicketAffiliate,
  buildTicketAffiliateSearchKeyword,
} from "@/lib/affiliate/ticket-affiliate-eligibility";

export type AffiliateClickContext = {
  provider?: string;
  type?: string;
  destination?: string;
  placeName?: string;
  keyword?: string;
  checkIn?: string;
  checkOut?: string;
  adults?: number;
  surface?: "home" | "chat" | "explore" | "selection" | "favorites" | "itinerary" | "map";
  eventId?: string;
};

function buildTripFlightUrl(ctx: TripAffiliateContext, env: AffiliateEnvConfig): string | null {
  return buildTripComFlightUrlFromTrip(ctx, env);
}

function buildTripPackageUrl(ctx: TripAffiliateContext, env: AffiliateEnvConfig): string | null {
  const mapped = normalizeTripComDestination(ctx.destinationLabel);
  const keyword = pickSearchKeyword(mapped, ctx.locale);
  if (!keyword) return null;
  return buildTripComAffiliateUrl(env, "package", {
    sub1: "package",
    params: {
      keyword,
      searchValue: keyword,
    },
  });
}

function buildAgodaUrl(ctx: TripAffiliateContext, env: AffiliateEnvConfig): string | null {
  return buildAgodaHotelUrl(ctx, env);
}

function buildKlookUrl(query: string, env: AffiliateEnvConfig, locale?: Locale): string | null {
  return buildKlookAffiliateUrl(query, env, locale);
}

function buildKkdayUrl(input: KkdayAffiliateInput, env: AffiliateEnvConfig): string | null {
  return buildKkdayAffiliateUrl(input, env);
}

function offer(
  provider: AffiliateProviderId,
  kind: AffiliateOfferKind,
  label: string,
  url: string | null,
  meta?: {
    destination?: string;
    placeName?: string;
    keyword?: string;
    checkIn?: string;
    checkOut?: string;
    adults?: number;
    disabledReason?: string;
  },
): AffiliateLinkOffer {
  return {
    provider,
    kind,
    label,
    url: url ?? "",
    enabled: Boolean(url),
    disabledReason: meta?.disabledReason,
    destination: meta?.destination,
    placeName: meta?.placeName,
    keyword: meta?.keyword,
    checkIn: meta?.checkIn,
    checkOut: meta?.checkOut,
    adults: meta?.adults,
  };
}

function logTripRender(type: "hotel" | "flight" | "package", show: boolean, reason: string): void {
  logAffiliateRender({
    provider: "tripcom",
    type,
    shouldShow: show,
    reason,
  });
}

export function buildHotelAffiliateOffers(ctx: TripAffiliateContext): AffiliateLinkOffer[] {
  const env = getAffiliateEnv();
  const hotelDecision = resolveHotelAffiliateEligibility(ctx);
  const tripBaseUrl = getTripComBaseAffiliateUrl(env);
  logTripRender(
    "hotel",
    hotelDecision.eligible && Boolean(tripBaseUrl),
    hotelDecision.eligible
      ? tripBaseUrl
        ? "destination_ready"
        : "missing_trip_env"
      : hotelDecision.reason,
  );

  if (!hotelDecision.eligible) return [];

  const dest = ctx.destinationLabel;
  const agodaStay = resolveAgodaStayDates(ctx);
  const tripStay = resolveTripStayDates(ctx);
  const checkIn = agodaStay.checkIn ?? "";
  const checkOut = agodaStay.checkOut ?? "";
  const adults = ctx.travelers ?? 2;
  const tripHotelUrl =
    buildTripComHotelUrl(
      {
        destination: ctx.destinationLabel,
        startDate: tripStay.checkIn,
        endDate: tripStay.checkOut,
        adults: ctx.travelers,
        locale: ctx.locale,
      },
      env,
    ) ?? tripBaseUrl;

  const offers = [
    offer("agoda", "hotel", "Agoda", buildAgodaUrl(ctx, env), {
      destination: dest,
      checkIn,
      checkOut,
      adults,
      disabledReason: "missing_agoda_env",
    }),
    offer("trip", "hotel", "Trip.com", tripHotelUrl, {
      destination: dest,
      checkIn,
      checkOut,
      adults,
      disabledReason: "missing_trip_env",
    }),
  ];

  logAffiliateRender({
    provider: "tripcom",
    type: "hotel",
    shouldShow: Boolean(tripHotelUrl),
    reason: tripHotelUrl ? "url_ready" : "missing_trip_env",
  });

  return offers.filter((o) => o.enabled);
}

export function buildFlightAffiliateOffers(ctx: TripAffiliateContext): AffiliateLinkOffer[] {
  const flightDecision = resolveFlightAffiliateEligibility(ctx);
  const env = getAffiliateEnv();
  const tripBaseUrl = getTripComBaseAffiliateUrl(env);
  const dest = ctx.destinationLabel;
  const url = flightDecision.eligible ? buildTripFlightUrl(ctx, env) : null;

  logAffiliateRender({
    provider: "tripcom",
    type: "flight",
    shouldShow: Boolean(url),
    reason: flightDecision.eligible
      ? url
        ? "url_ready"
        : "missing_trip_env"
      : flightDecision.reason,
  });

  if (!flightDecision.eligible) return [];

  return [
    offer("trip", "flight", "Trip.com 機票", url, {
      destination: dest,
      disabledReason: "missing_trip_env",
    }),
  ].filter((o) => o.enabled);
}

export function buildPackageAffiliateOffers(ctx: TripAffiliateContext): AffiliateLinkOffer[] {
  if (ctx.dayCount < 2) return [];
  const env = getAffiliateEnv();
  const dest = ctx.destinationLabel;
  const url = buildTripPackageUrl(ctx, env);
  logAffiliateRender({
    provider: "tripcom",
    type: "package",
    shouldShow: Boolean(url),
    reason: url ? "url_ready" : "missing_trip_env_or_keyword",
  });
  return [
    offer("trip", "package", "Trip.com 找套裝行程", url, {
      destination: dest,
      disabledReason: "missing_trip_env",
    }),
  ].filter((o) => o.enabled);
}

export type PlaceTicketAffiliateContext = {
  destinationLabel?: string;
  destinationLocation?: TripLocation | null;
  locale?: Locale;
  tripCtx?: TripAffiliateContext;
};

export function buildTicketAffiliateOffers(
  place: TicketAffiliatePlaceInput,
  ctx?: PlaceTicketAffiliateContext,
): AffiliateLinkOffer[] {
  const ticketCtx = resolveTicketAffiliateTripContext(ctx?.tripCtx);
  const decision = shouldShowTicketAffiliate(place, {
    destinationLabel: ctx?.destinationLabel,
    destinationCountry: ticketCtx?.destinationCountry,
    travelDate: ctx?.tripCtx?.startDate,
    tripCtx: ctx?.tripCtx,
  });
  if (!decision.show) return [];

  const q = decision.searchKeyword.trim();
  if (!q) return [];

  const env = getAffiliateEnv();
  const destination =
    ctx?.destinationLabel?.trim() ||
    ctx?.destinationLocation?.displayLabel?.trim() ||
    ctx?.destinationLocation?.city?.trim() ||
    "";
  const kkdayInput: KkdayAffiliateInput = {
    placeName: q,
    destinationLabel: ctx?.destinationLabel,
    destinationLocation: ctx?.destinationLocation,
    locale: ctx?.locale,
  };

  return [
    offer("klook", "activity_ticket", "Klook", buildKlookUrl(q, env, ctx?.locale), {
      destination,
      placeName: placeDisplayName(place),
      keyword: q,
      disabledReason: "missing_klook_env",
    }),
    offer("kkday", "activity_ticket", "KKday", buildKkdayUrl(kkdayInput, env), {
      destination,
      placeName: placeDisplayName(place),
      keyword: q,
      disabledReason: "missing_kkday_env",
    }),
  ].filter((o) => o.enabled);
}

function placeDisplayName(place: TicketAffiliatePlaceInput): string {
  return (place.placeName || place.name || place.title || "").trim();
}

export function buildPlaceTicketOffers(
  item: Parameters<typeof isTicketEligiblePlace>[0],
  ctx?: PlaceTicketAffiliateContext,
): AffiliateLinkOffer[] {
  const place: TicketAffiliatePlaceInput = {
    placeName: item.placeName,
    title: item.title,
    placeType: item.placeType,
    category: item.category,
    types: item.googleTypes ?? undefined,
    primaryType: item.googleTypes?.[0] ?? item.placeType ?? undefined,
  };
  const decision = shouldShowTicketAffiliate(place, {
    destinationLabel: ctx?.destinationLabel,
    tripCtx: ctx?.tripCtx,
  });
  if (!decision.show) {
    logPlaceAffiliateRuleCheck(item, [], ctx?.tripCtx);
    return [];
  }
  const offers = buildTicketAffiliateOffers(place, ctx);
  logPlaceAffiliateRuleCheck(item, offers, ctx?.tripCtx);
  return offers;
}

export function logPlaceDetailAffiliateRender(input: {
  placeName: string;
  placeTypes: string;
  showKlook: boolean;
  showKKday: boolean;
}): void {
  // Consolidated into [AFFILIATE_SUMMARY] / [AFFILIATE_SKIP] via logPlaceAffiliateRuleCheck.
  if (!isDebugAffiliateEnabled()) return;
  console.log(
    `[PLACE_DETAIL_AFFILIATE_RENDER] placeName=${input.placeName} placeTypes=${input.placeTypes} showKlook=${input.showKlook} showKKday=${input.showKKday}`,
  );
}

/** 探索地圖／地點詳情頁票券導購（Klook + KKday） */
export function buildPlaceDetailTicketOffers(
  place: {
    name?: string | null;
    primaryType?: string | null;
    types?: string[] | null;
    category?: string | null;
    rating?: number | null;
    userRatingCount?: number | null;
  },
  ctx?: PlaceTicketAffiliateContext,
): AffiliateLinkOffer[] {
  const placeName = place.name?.trim() ?? "";
  const placeTypes = [
    ...(place.types ?? []),
    ...(place.primaryType ? [place.primaryType] : []),
  ].join(",");

  const ticketPlace: TicketAffiliatePlaceInput = {
    name: place.name,
    primaryType: place.primaryType,
    types: place.types,
    category: place.category,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
  };

  const decision = shouldShowTicketAffiliate(ticketPlace, {
    destinationLabel: ctx?.destinationLabel,
    tripCtx: ctx?.tripCtx,
  });

  if (!decision.show) {
    logPlaceAffiliateRuleCheck(
      {
        placeName: placeName,
        title: placeName,
        description: "",
        notes: "",
        placeType: place.primaryType ?? undefined,
        googleTypes: place.types ?? undefined,
        category: place.category ?? undefined,
      },
      [],
      ctx?.tripCtx,
    );
    logPlaceDetailAffiliateRender({
      placeName,
      placeTypes,
      showKlook: false,
      showKKday: false,
    });
    return [];
  }

  const offers = buildTicketAffiliateOffers(ticketPlace, ctx);
  logPlaceAffiliateRuleCheck(
    {
      placeName,
      title: placeName,
      description: "",
      notes: "",
      placeType: place.primaryType ?? undefined,
      googleTypes: place.types ?? undefined,
      category: place.category ?? undefined,
    },
    offers,
    ctx?.tripCtx,
  );
  logPlaceDetailAffiliateRender({
    placeName,
    placeTypes,
    showKlook: offers.some((o) => o.provider === "klook" && o.enabled),
    showKKday: offers.some((o) => o.provider === "kkday" && o.enabled),
  });
  return offers;
}

/** 開啟聯盟外連：Capacitor Browser 優先，否則 window.open */
const AFFILIATE_OPEN_DEBOUNCE_MS = 800;

let affiliateOpenInFlight = false;
let lastAffiliateOpenUrl = "";
let lastAffiliateOpenAt = 0;

export async function openAffiliateUrl(url: string, ctx?: AffiliateClickContext): Promise<void> {
  let trimmed = url?.trim();
  if (!trimmed) return;

  if (ctx?.type === "flight" && ctx.provider === "tripcom") {
    trimmed = resolveTripComFlightOpenUrl(trimmed, getAffiliateEnv());
    if (!trimmed) return;
  }

  const platform = resolveAffiliatePlatform(ctx?.provider, ctx?.type);
  let openUrl = trimmed;
  if (platform !== "other") {
    try {
      const probed = await probeAffiliateRedirectUrl(trimmed, platform);
      openUrl = probed.finalUrl || trimmed;
    } catch {
      // ignore probe failure
    }
  } else {
    // no-op for other platforms
  }

  const now = Date.now();
  if (affiliateOpenInFlight) return;
  if (openUrl === lastAffiliateOpenUrl && now - lastAffiliateOpenAt < AFFILIATE_OPEN_DEBOUNCE_MS) {
    return;
  }

  affiliateOpenInFlight = true;
  lastAffiliateOpenUrl = openUrl;
  lastAffiliateOpenAt = now;
  const clickEventId = ctx?.eventId ?? crypto.randomUUID();
  const { recordAnalyticsEvent } = await import("@/lib/analytics/record");
  recordAnalyticsEvent({
    eventId: clickEventId,
    eventName: "affiliate_cta_clicked",
    provider: ctx?.provider,
    surface: ctx?.surface,
  });

  logAffiliateClick({
    provider: ctx?.provider,
    type: ctx?.type,
    destination: ctx?.destination,
    placeName: ctx?.placeName,
    keyword: ctx?.keyword,
    checkIn: ctx?.checkIn,
    checkOut: ctx?.checkOut,
    adults: ctx?.adults,
    finalUrl: openUrl,
  });

  try {
    if (isCapacitorNativeShell()) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: openUrl, presentationStyle: "fullscreen" });
      recordAnalyticsEvent({
        eventId: clickEventId,
        eventName: "affiliate_outbound_open_succeeded",
        provider: ctx?.provider,
        surface: ctx?.surface,
      });
      return;
    }
  } catch (e) {
    console.warn("[Affiliate] Capacitor Browser failed, fallback to window.open", e);
  } finally {
    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        affiliateOpenInFlight = false;
      }, AFFILIATE_OPEN_DEBOUNCE_MS);
    } else {
      affiliateOpenInFlight = false;
    }
  }

  if (typeof window !== "undefined") {
    const opened = window.open(openUrl, "_blank", "noopener,noreferrer");
    if (opened)
      recordAnalyticsEvent({
        eventId: clickEventId,
        eventName: "affiliate_outbound_open_succeeded",
        provider: ctx?.provider,
        surface: ctx?.surface,
      });
  }
}

export { deriveAffiliateAiHints, isPlaceDetailTicketEligible, isTicketEligiblePlace };
export {
  computeTripNights,
  inferInternationalTripFlag,
  logAffiliateRuleCheck,
  logPlaceAffiliateRuleCheck,
  logTripAffiliateRuleCheck,
  normalizeCountryCode,
  parsePlaceTags,
  resolveDestinationCountryCode,
  resolveHomeCountryCode,
  resolveIsInternationalTrip,
  resolveFlightAffiliateEligibility,
  resolveHotelAffiliateEligibility,
  resolveTicketAffiliateEligibility,
} from "@/lib/affiliate/affiliate-display-rules";
