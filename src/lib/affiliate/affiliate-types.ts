import type { RoamieItineraryItem, RoamiePayloadV2 } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";

/** 聯盟導購平台（可擴充） */
export type AffiliateProviderId = "trip" | "agoda" | "booking" | "klook" | "kkday";

export type AffiliateOfferKind = "hotel" | "flight" | "activity_ticket";

export type AffiliateLinkOffer = {
  provider: AffiliateProviderId;
  kind: AffiliateOfferKind;
  label: string;
  url: string;
  enabled: boolean;
  /** env 缺失等原因 */
  disabledReason?: string;
};

export type TripAffiliateContext = {
  tripId: string;
  destinationLabel: string;
  destinationLocation?: TripLocation | null;
  originLocation?: TripLocation | null;
  dayCount: number;
  items: RoamieItineraryItem[];
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
}): TripAffiliateContext {
  return {
    tripId: input.tripId,
    destinationLabel: input.destinationLabel,
    destinationLocation: input.payload.destinationLocation ?? null,
    originLocation: input.payload.originLocation ?? null,
    dayCount: input.dayCount,
    items: input.items,
  };
}

export function deriveAffiliateAiHints(ctx: TripAffiliateContext): AffiliateAiHints {
  return {
    suggestHotel: ctx.dayCount >= 2,
    suggestFlight: isCrossBorderTrip(ctx.originLocation, ctx.destinationLocation),
  };
}

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

/** 目的地國家 ≠ 出發地國家（缺 origin 時預設台灣） */
export function isCrossBorderTrip(
  origin?: TripLocation | null,
  destination?: TripLocation | null,
): boolean {
  const destCode = normalizeCountryCode(destination?.country);
  if (!destCode) return false;
  const originCode = normalizeCountryCode(origin?.country) || "TW";
  return originCode !== destCode;
}

const TICKET_PLACE_RE =
  /景點|樂園|主題樂園|遊樂|展覽|博物館|美術館|一日遊|體驗|門票|票券|交通票|纜車|展望|動物園|水族館|amusement|theme\s*park|museum|gallery|exhibition|attraction|ticket|day\s*trip|experience|observatory|zoo|aquarium/i;

/** 景點票券：依地點類型 / 名稱 / 描述判斷 */
export function isTicketEligiblePlace(item: Pick<RoamieItineraryItem, "placeType" | "title" | "placeName" | "description">): boolean {
  const blob = [item.placeType, item.title, item.placeName, item.description].filter(Boolean).join(" ");
  return TICKET_PLACE_RE.test(blob);
}
