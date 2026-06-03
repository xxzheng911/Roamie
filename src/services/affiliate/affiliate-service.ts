import {
  affiliateIntentFromPlaceInput,
  type AffiliatePlaceIntent,
  type AffiliatePlaceTypeInput,
} from "./affiliate-place-intent";
import { trackAffiliateClick } from "./track-affiliate-click";
import { openAffiliateBrowser } from "./open-affiliate-browser";
import type { AffiliateClickContext, AffiliatePartnerId } from "./types";

/** Klook / KKday 搜尋導購（依地點名稱動態生成，無商品資料庫） */
const KLOOK_SEARCH_URL = "https://www.klook.com/zh-TW/search/result/";
const KKDAY_SEARCH_URL = "https://www.kkday.com/zh-tw/search/keyword";

const ENV = {
  klookAid: ["VITE_KLOOK_AID", "VITE_AFFILIATE_KLOOK_AID"] as const,
  kkdayCid: ["VITE_KKDAY_CID", "VITE_AFFILIATE_KKDAY_AID"] as const,
  bookingAid: ["VITE_AFFILIATE_BOOKING_AID"] as const,
  agodaAid: ["VITE_AFFILIATE_AGODA_AID"] as const,
} as const;

function readEnv(keys: readonly string[]): string {
  for (const key of keys) {
    const v = import.meta.env[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizePlaceQuery(placeName: string): string {
  return placeName.trim();
}

/** 組合城市 + 地點名稱作為 Klook / KKday 搜尋字 */
export function buildAffiliateSearchQuery(placeName: string, city?: string | null): string {
  const name = normalizePlaceQuery(placeName);
  const cityPart = (city ?? "").trim();
  if (!cityPart) return name;
  if (!name) return cityPart;
  if (name.includes(cityPart)) return name;
  return `${cityPart} ${name}`;
}

export function buildKlookAffiliateUrl(placeName: string, city?: string | null): string | null {
  return AffiliateService.generateKlookLink(buildAffiliateSearchQuery(placeName, city));
}

export function buildKKdayAffiliateUrl(placeName: string, city?: string | null): string | null {
  return AffiliateService.generateKKdayLink(buildAffiliateSearchQuery(placeName, city));
}

export type PlaceExperienceAffiliateLink = {
  platform: "klook" | "kkday";
  partnerId: AffiliatePartnerId;
  label: string;
  url: string;
  intent: AffiliatePlaceIntent;
};

export const AffiliateService = {
  isKlookEnabled(): boolean {
    return Boolean(readEnv(ENV.klookAid));
  },

  isKKdayEnabled(): boolean {
    return Boolean(readEnv(ENV.kkdayCid));
  },

  /** @example generateKlookLink("釜山塔") → klook.com search + aid */
  generateKlookLink(placeName: string): string | null {
    const query = normalizePlaceQuery(placeName);
    const aid = readEnv(ENV.klookAid);
    if (!query || !aid) return null;
    const params = new URLSearchParams({ query, aid });
    return `${KLOOK_SEARCH_URL}?${params.toString()}`;
  },

  /** @example generateKKdayLink("清水寺") → kkday.com keyword search + cid */
  generateKKdayLink(placeName: string): string | null {
    const query = normalizePlaceQuery(placeName);
    const cid = readEnv(ENV.kkdayCid);
    if (!query || !cid) return null;
    const params = new URLSearchParams({ q: query, cid });
    return `${KKDAY_SEARCH_URL}?${params.toString()}`;
  },

  /** 預留：Booking.com 飯店搜尋 */
  generateBookingLink(placeName: string): string | null {
    const query = normalizePlaceQuery(placeName);
    const aid = readEnv(ENV.bookingAid);
    if (!query || !aid) return null;
    const params = new URLSearchParams({ ss: query, aid });
    return `https://www.booking.com/searchresults.html?${params.toString()}`;
  },

  /** 預留：Agoda 搜尋 */
  generateAgodaLink(placeName: string): string | null {
    const query = normalizePlaceQuery(placeName);
    const aid = readEnv(ENV.agodaAid);
    if (!query || !aid) return null;
    const params = new URLSearchParams({ textToSearch: query, cid: aid });
    return `https://www.agoda.com/search?${params.toString()}`;
  },

  getPlaceExperienceLinks(
    placeName: string,
    typeInput?: AffiliatePlaceTypeInput,
    options?: { city?: string | null; usePlatformLabels?: boolean },
  ): PlaceExperienceAffiliateLink[] {
    const { intent, label } = affiliateIntentFromPlaceInput({
      placeName,
      ...typeInput,
    });
    const query = buildAffiliateSearchQuery(placeName, options?.city);
    const links: PlaceExperienceAffiliateLink[] = [];
    const klook = this.generateKlookLink(query);
    if (klook) {
      links.push({
        platform: "klook",
        partnerId: "klook",
        label: options?.usePlatformLabels ? "在 Klook 查看相關體驗" : label,
        url: klook,
        intent,
      });
    }
    const kkday = this.generateKKdayLink(query);
    if (kkday) {
      links.push({
        platform: "kkday",
        partnerId: "kkday",
        label: options?.usePlatformLabels ? "在 KKday 查看相關體驗" : label,
        url: kkday,
        intent,
      });
    }
    return links;
  },

  async openExperienceLink(
    link: PlaceExperienceAffiliateLink,
    ctx: {
      source: AffiliateClickContext["source"];
      placeName: string;
    },
  ): Promise<void> {
    const place_name = normalizePlaceQuery(ctx.placeName);
    console.info("[AFFILIATE_LINK_CLICKED]", {
      platform: link.platform,
      placeName: place_name,
    });
    trackAffiliateClick({
      platform: link.platform,
      place_name,
      source: ctx.source,
      timestamp: new Date().toISOString(),
      affiliate_intent: link.intent,
    });
    await openAffiliateBrowser(link.url, link.platform);
  },
};

export function generateKlookLink(placeName: string): string | null {
  return AffiliateService.generateKlookLink(placeName);
}

export function generateKKdayLink(placeName: string): string | null {
  return AffiliateService.generateKKdayLink(placeName);
}
