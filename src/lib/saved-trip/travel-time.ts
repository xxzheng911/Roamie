import type { TransitLegAdvice } from "@/lib/transit/types";
import { ROAMIE_API_FALLBACK } from "@/lib/api/constants";
import { isJapanTransitMapsLeg } from "@/lib/saved-trip/japan-transit-maps";

export type ItineraryDurationSource =
  | "TRANSIT"
  | "WALK"
  | "DRIVE"
  | "ESTIMATE"
  | "NONE"
  | "WALKING_FALLBACK_DISPLAY_ONLY";

export function isTransitRequested(transportLabel: string): boolean {
  return /大眾|地鐵|捷運|公車|火車|高鐵|transit|mrt|metro/i.test(transportLabel.trim());
}

export function transitUnavailableWithWalkFallback(
  _leg: TransitLegAdvice,
  _transportLabel: string,
): boolean {
  return false;
}

/** 依使用者選擇的交通方式取分鐘數；大眾運輸失敗時不偷用步行估算 */
export function travelMinutesForMode(leg: TransitLegAdvice, transportLabel: string): number | null {
  const t = transportLabel.trim();
  if (!t) return leg.durationMinutes > 0 ? leg.durationMinutes : null;

  if (/步行|走路|walk/i.test(t)) {
    return leg.estimates.walk ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  if (/開車|drive|自駕|租車/i.test(t)) {
    return leg.estimates.drive ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  if (/機車|scooter|摩托/i.test(t)) {
    const drive = leg.estimates.drive ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
    return drive != null ? Math.max(1, Math.round(drive * 0.85)) : null;
  }
  if (isTransitRequested(t)) {
    return leg.estimates.transit ?? null;
  }
  if (/單車|自行车|bike|bicycle/i.test(t)) {
    return leg.estimates.walk ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  if (/計程車|共乘|taxi|uber/i.test(t)) {
    return leg.estimates.drive ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  return leg.durationMinutes > 0 ? leg.durationMinutes : null;
}

export function durationSourceForLeg(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): ItineraryDurationSource {
  if (!leg) return "NONE";
  const t = transportLabel.trim();

  if (isTransitRequested(t)) {
    if (leg.estimates.transit != null) return "TRANSIT";
    if (transitUnavailableWithWalkFallback(leg, t)) return "WALKING_FALLBACK_DISPLAY_ONLY";
    return "NONE";
  }
  if (/步行|走路|walk/i.test(t)) return leg.estimates.walk != null ? "WALK" : "NONE";
  if (/開車|drive|自駕|租車|計程車|共乘|taxi/i.test(t)) {
    return leg.estimates.drive != null ? "DRIVE" : "NONE";
  }
  const mins = travelMinutesForMode(leg, t);
  return mins != null ? "TRANSIT" : "NONE";
}

/** 抵達時間推算用：絕不使用 WALKING_FALLBACK */
export function travelMinutesForArrival(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): { minutes: number | null; source: ItineraryDurationSource } {
  const source = durationSourceForLeg(leg, transportLabel);
  if (source === "WALKING_FALLBACK_DISPLAY_ONLY" || source === "NONE") {
    return { minutes: null, source };
  }
  if (!leg) return { minutes: null, source: "NONE" };
  return { minutes: travelMinutesForMode(leg, transportLabel), source };
}

export function formatLegTravelTimeLabel(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
  opts?: { loading?: boolean; unavailable?: boolean },
): string | undefined {
  if (opts?.loading) return ROAMIE_API_FALLBACK.routesLoading;
  if (isJapanTransitMapsLeg(leg, transportLabel)) return undefined;
  if (!leg) return opts?.unavailable ? ROAMIE_API_FALLBACK.routesUnavailable : "暫時無法取得交通時間";

  if (leg.transportDisplayText?.trim()) {
    return leg.transportDisplayText.trim();
  }

  if (opts?.unavailable) return ROAMIE_API_FALLBACK.routesUnavailable;

  if (isTransitRequested(transportLabel)) {
    const transitMins = leg.estimates.transit;
    if (transitMins != null) {
      return `大眾運輸 約 ${transitMins} 分鐘`;
    }
    if (
      leg.transportStatus === "transit_unavailable" ||
      leg.reason === "transit_unavailable"
    ) {
      return "暫時無法取得大眾運輸時間";
    }
    return "暫時無法取得大眾運輸時間";
  }

  const mins = travelMinutesForMode(leg, transportLabel);
  if (mins == null) return "暫時無法取得交通時間";

  const label = transportLabel.trim() || "移動";
  return `${label} 約 ${mins} 分鐘`;
}

/** 不再顯示步行 fallback 提示 */
export function formatLegWalkFallbackHint(
  _leg: TransitLegAdvice | undefined,
  _transportLabel: string,
): string | null {
  return null;
}
