import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";
import type { AffiliateClickContext, AffiliateOffer, AffiliateProvider } from "./types";

type PartnerConfig = {
  id: AffiliateProvider["id"];
  displayName: string;
  baseUrl: string;
  envKey?: string;
};

const PARTNERS: PartnerConfig[] = [
  { id: "booking", displayName: "Booking.com", baseUrl: "https://www.booking.com/searchresults.html", envKey: "VITE_AFFILIATE_BOOKING_AID" },
  { id: "agoda", displayName: "Agoda", baseUrl: "https://www.agoda.com/search", envKey: "VITE_AFFILIATE_AGODA_AID" },
  { id: "klook", displayName: "Klook", baseUrl: "https://www.klook.com/search/", envKey: "VITE_AFFILIATE_KLOOK_AID" },
  { id: "kkday", displayName: "KKday", baseUrl: "https://www.kkday.com/en-us/category/", envKey: "VITE_AFFILIATE_KKDAY_AID" },
  { id: "skyscanner", displayName: "Skyscanner", baseUrl: "https://www.skyscanner.com/transport/flights", envKey: "VITE_AFFILIATE_SKYSCANNER_AID" },
  { id: "expedia", displayName: "Expedia", baseUrl: "https://www.expedia.com/Hotel-Search", envKey: "VITE_AFFILIATE_EXPEDIA_AID" },
  { id: "airbnb", displayName: "Airbnb", baseUrl: "https://www.airbnb.com/s/homes", envKey: "VITE_AFFILIATE_AIRBNB_AID" },
  { id: "uber", displayName: "Uber", baseUrl: "https://m.uber.com/looking", envKey: "VITE_AFFILIATE_UBER_AID" },
  { id: "google_places", displayName: "Google Places", baseUrl: "https://www.google.com/maps/search/" },
];

function readAffiliateId(envKey?: string): string {
  if (!envKey) return "";
  const v = import.meta.env[envKey];
  return typeof v === "string" ? v : "";
}

function toProvider(config: PartnerConfig): AffiliateProvider {
  return {
    id: config.id,
    displayName: config.displayName,
    isEnabled: () => !config.envKey || Boolean(readAffiliateId(config.envKey)),
    buildOutboundUrl(params) {
      const qs = new URLSearchParams({ ...params, aid: readAffiliateId(config.envKey) }).toString();
      return `${config.baseUrl}?${qs}`;
    },
  };
}

export const affiliateRegistry: AffiliateProvider[] = PARTNERS.map(toProvider);

export function getAffiliateProvider(id: AffiliateProvider["id"]): AffiliateProvider | undefined {
  return affiliateRegistry.find((p) => p.id === id);
}

export function openAffiliateOffer(
  offer: AffiliateOffer,
  ctx: Omit<AffiliateClickContext, "offerId" | "partnerId">,
): void {
  trackEvent(AnalyticsEvents.AFFILIATE_CLICK, {
    offer_id: offer.id,
    partner_id: offer.partnerId,
    source: ctx.source,
    type: offer.type,
  });
  if (typeof window !== "undefined") {
    window.open(offer.outboundUrl, "_blank", "noopener,noreferrer");
  }
}

export function buildAffiliateOffer(input: {
  partnerId: AffiliateProvider["id"];
  type: AffiliateOffer["type"];
  title: string;
  params: Record<string, string>;
  id?: string;
}): AffiliateOffer | null {
  const provider = getAffiliateProvider(input.partnerId);
  if (!provider?.isEnabled()) return null;
  return {
    id: input.id ?? `${input.partnerId}-${Date.now()}`,
    partnerId: input.partnerId,
    type: input.type,
    title: input.title,
    outboundUrl: provider.buildOutboundUrl(input.params),
  };
}
