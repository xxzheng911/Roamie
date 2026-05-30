import { AnalyticsEvents } from "@/constants/analytics-events";
import { trackEvent } from "@/services/analytics";
import type { AffiliateClickContext } from "./types";
import type { AffiliatePlaceIntent } from "./affiliate-place-intent";

export type AffiliateClickPayload = {
  platform: "klook" | "kkday" | AffiliateClickContext["partnerId"];
  place_name: string;
  source: AffiliateClickContext["source"];
  timestamp: string;
  affiliate_intent: AffiliatePlaceIntent;
};

/** 統一 affiliate_click 事件欄位，供轉換與平台比較 */
export function trackAffiliateClick(payload: AffiliateClickPayload): void {
  trackEvent(AnalyticsEvents.AFFILIATE_CLICK, {
    platform: payload.platform,
    place_name: payload.place_name,
    source: payload.source,
    timestamp: payload.timestamp,
    affiliate_intent: payload.affiliate_intent,
  });
}
