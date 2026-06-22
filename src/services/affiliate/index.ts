import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";
import {
  buildKkdayAffiliateUrl,
  buildKkdaySearchKeyword,
  type KkdayAffiliateInput,
} from "@/lib/affiliate/kkday-affiliate-url";
import { buildKlookAffiliateUrl } from "@/lib/affiliate/klook-affiliate-url";
import { openAffiliateUrl } from "@/lib/affiliate/affiliate-links";
import { getAffiliateEnv, resolveTripAffiliateBaseUrl } from "@/lib/affiliate/affiliate-env";
import type { AffiliateOffer, AffiliateProvider } from "./types";

type PartnerConfig = {
  id: AffiliateProvider["id"];
  displayName: string;
  baseUrl: string;
  envKey?: string;
  trackingParam?: { key: string; envKey: string };
};

const PARTNERS: PartnerConfig[] = [
  { id: "booking", displayName: "Booking.com", baseUrl: "https://www.booking.com/searchresults.html", envKey: "VITE_AFFILIATE_BOOKING_AID" },
  { id: "agoda", displayName: "Agoda", baseUrl: "https://www.agoda.com/partners/partnersearch.aspx", envKey: "VITE_AGODA_AFFILIATE_URL" },
  { id: "klook", displayName: "Klook", baseUrl: "https://www.klook.com/zh-TW/search/", trackingParam: { key: "aid", envKey: "VITE_KLOOK_AID" } },
  { id: "kkday", displayName: "KKday", baseUrl: "https://www.kkday.com/zh-tw/product/productlist", trackingParam: { key: "cid", envKey: "VITE_KKDAY_CID" } },
  { id: "skyscanner", displayName: "Skyscanner", baseUrl: "https://www.skyscanner.com/transport/flights", envKey: "VITE_AFFILIATE_SKYSCANNER_AID" },
  { id: "expedia", displayName: "Expedia", baseUrl: "https://www.expedia.com/Hotel-Search", envKey: "VITE_AFFILIATE_EXPEDIA_AID" },
  { id: "airbnb", displayName: "Airbnb", baseUrl: "https://www.airbnb.com/s/homes", envKey: "VITE_AFFILIATE_AIRBNB_AID" },
  { id: "uber", displayName: "Uber", baseUrl: "https://m.uber.com/looking", envKey: "VITE_AFFILIATE_UBER_AID" },
  { id: "google_places", displayName: "Google Places", baseUrl: "https://www.google.com/maps/search/" },
];

function readAffiliateId(envKey?: string): string {
  if (!envKey) return "";
  const v = import.meta.env[envKey];
  return typeof v === "string" ? v.trim() : "";
}

function buildKkdayRegistryUrl(params: Record<string, string>): string | null {
  const env = getAffiliateEnv();
  if (!env.kkdayCid) return null;
  const keyword = params.keyword?.trim() || params.query?.trim() || params.q?.trim() || "";
  if (!keyword) return null;
  const input: KkdayAffiliateInput = { placeName: keyword };
  return buildKkdayAffiliateUrl(input, env);
}

function toProvider(config: PartnerConfig): AffiliateProvider {
  return {
    id: config.id,
    displayName: config.displayName,
    isEnabled: () => {
      if (config.id === "agoda") return Boolean(readAffiliateId("VITE_AGODA_AFFILIATE_URL"));
      if (config.trackingParam) return Boolean(readAffiliateId(config.trackingParam.envKey));
      return !config.envKey || Boolean(readAffiliateId(config.envKey));
    },
    buildOutboundUrl(params) {
      if (config.id === "agoda") {
        const url = readAffiliateId("VITE_AGODA_AFFILIATE_URL");
        return url || config.baseUrl;
      }
      if (config.id === "klook") {
        const env = getAffiliateEnv();
        const query = params.keyword?.trim() || params.query?.trim() || params.q?.trim() || "";
        return buildKlookAffiliateUrl(query, env) ?? config.baseUrl;
      }
      if (config.id === "kkday") {
        return buildKkdayRegistryUrl(params) ?? config.baseUrl;
      }
      const qs = new URLSearchParams(params);
      const aid = readAffiliateId(config.envKey);
      if (aid) qs.set("aid", aid);
      let url = `${config.baseUrl}?${qs.toString()}`;
      if (config.trackingParam) {
        const trackingValue = readAffiliateId(config.trackingParam.envKey);
        if (trackingValue) {
          const parsed = new URL(url);
          if (!parsed.searchParams.has(config.trackingParam.key)) {
            parsed.searchParams.set(config.trackingParam.key, trackingValue);
          }
          url = parsed.toString();
        }
      }
      return url;
    },
  };
}

export const affiliateRegistry: AffiliateProvider[] = PARTNERS.map(toProvider);

function logAffiliateServiceInit(): void {
  const env = getAffiliateEnv();
  const tripUrl = resolveTripAffiliateBaseUrl(env);
  console.info(
    `[AffiliateService] init hasTripAffiliateUrl=${Boolean(tripUrl)} tripUrlLength=${tripUrl.length}`,
  );
}

logAffiliateServiceInit();

export function getAffiliateProvider(id: AffiliateProvider["id"]): AffiliateProvider | undefined {
  return affiliateRegistry.find((p) => p.id === id);
}

export function openAffiliateOffer(
  offer: AffiliateOffer,
  ctx: {
    source: "chat" | "map" | "itinerary" | "home";
    destination?: string;
    placeName?: string;
    keyword?: string;
  },
): void {
  trackEvent(AnalyticsEvents.AFFILIATE_CLICK, {
    offer_id: offer.id,
    partner_id: offer.partnerId,
    source: ctx.source,
    type: offer.type,
  });
  void openAffiliateUrl(offer.outboundUrl, {
    provider: offer.partnerId,
    type: offer.type,
    destination: ctx.destination,
    placeName: ctx.placeName,
    keyword:
      ctx.keyword ??
      (offer.partnerId === "kkday"
        ? buildKkdaySearchKeyword({ placeName: ctx.placeName ?? "" })
        : undefined),
  });
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
