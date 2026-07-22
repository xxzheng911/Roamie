import type { TransitLegAdvice } from "@/lib/transit/types";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { ROAMIE_API_FALLBACK } from "@/lib/api/constants";
import { isJapanTransitMapsLeg } from "@/lib/saved-trip/japan-transit-maps";
import { travelLabelToRoutesMode } from "@/services/routesService";

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

/** 依使用者選擇的交通方式取分鐘數；若有 fallback 則取實際成功模式的耗時 */
export function travelMinutesForMode(leg: TransitLegAdvice, transportLabel: string): number | null {
  const t = transportLabel.trim();

  if (leg.transportFallbackMode === "drive" && leg.estimates.drive != null) {
    return leg.estimates.drive;
  }
  if (leg.transportFallbackMode === "transit" && leg.estimates.transit != null) {
    return leg.estimates.transit;
  }
  if (leg.transportFallbackMode === "walk" && leg.estimates.walk != null) {
    return leg.estimates.walk;
  }

  // Resolved mode on the leg may differ from the UI preference label (auto drive).
  if (leg.transportMode === "DRIVE" || leg.transportMode === "TWO_WHEELER") {
    if (leg.estimates.drive != null) return leg.estimates.drive;
    if (leg.durationMinutes > 0 && leg.transportStatus === "ok") return leg.durationMinutes;
  }
  if (leg.transportMode === "TRANSIT" && leg.estimates.transit != null) {
    return leg.estimates.transit;
  }

  if (!t) {
    return leg.transportMode && leg.durationMinutes > 0 ? leg.durationMinutes : null;
  }

  const requestedMode = travelLabelToRoutesMode(t);

  const fromEstimates = estimateMinutesForRoutesMode(leg, requestedMode);
  if (fromEstimates != null) return fromEstimates;

  if (leg.transportMode === requestedMode && leg.durationMinutes > 0) {
    return leg.durationMinutes;
  }

  if (/機車|scooter|摩托/i.test(t)) {
    const twoWheel =
      estimateMinutesForRoutesMode(leg, "TWO_WHEELER") ??
      (leg.transportMode === "TWO_WHEELER" && leg.durationMinutes > 0 ? leg.durationMinutes : null);
    if (twoWheel != null) return Math.max(1, Math.round(twoWheel * 0.85));
    const drive = estimateMinutesForRoutesMode(leg, "DRIVE");
    return drive != null ? Math.max(1, Math.round(drive * 0.85)) : null;
  }

  if (/單車|自行車|bike|bicycle/i.test(t)) {
    if (requestedMode === "BICYCLE" && leg.transportMode === "BICYCLE" && leg.durationMinutes > 0) {
      return leg.durationMinutes;
    }
    const bike = estimateMinutesForRoutesMode(leg, "BICYCLE");
    if (bike != null) return bike;
    // Long bike legs often resolve via driving Directions.
    return estimateMinutesForRoutesMode(leg, "DRIVE");
  }

  // Default walk preference but duration came from drive — still show minutes.
  if (/步行|走路|walk/i.test(t) && leg.estimates.drive != null) {
    return leg.estimates.drive;
  }

  return null;
}

function estimateMinutesForRoutesMode(
  leg: TransitLegAdvice,
  mode: RoutesTravelMode,
): number | null {
  if (mode === "WALK" || mode === "BICYCLE") {
    return leg.estimates.walk ?? null;
  }
  if (mode === "DRIVE" || mode === "TWO_WHEELER") {
    return leg.estimates.drive ?? null;
  }
  if (mode === "TRANSIT") {
    return leg.estimates.transit ?? null;
  }
  return null;
}

export function durationSourceForLeg(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): ItineraryDurationSource {
  if (!leg) return "NONE";
  const t = transportLabel.trim();

  if (isTransitRequested(t)) {
    if (
      leg.transportStatus === "ok" &&
      leg.transportMode === "TRANSIT" &&
      leg.estimates.transit != null
    ) {
      return "TRANSIT";
    }
    if (transitUnavailableWithWalkFallback(leg, t)) return "WALKING_FALLBACK_DISPLAY_ONLY";
    return "NONE";
  }
  if (/步行|走路|walk/i.test(t)) {
    if (leg.estimates.walk != null) return "WALK";
    if (leg.transportFallbackMode) return "ESTIMATE";
    return "NONE";
  }
  if (/開車|drive|自駕|租車|計程車|共乘|taxi/i.test(t)) {
    if (leg.estimates.drive != null) return "DRIVE";
    if (leg.transportFallbackMode) return "ESTIMATE";
    return "NONE";
  }
  if (/單車|bike|bicycle/i.test(t)) {
    const mins = travelMinutesForMode(leg, t);
    return mins != null ? (leg.transportFallbackMode ? "ESTIMATE" : "WALK") : "NONE";
  }
  const mins = travelMinutesForMode(leg, t);
  return mins != null ? "ESTIMATE" : "NONE";
}

/** 抵達時間推算用：絕不使用 WALKING_FALLBACK；大眾運輸僅用已確認的 transit duration */
export function travelMinutesForArrival(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): { minutes: number | null; source: ItineraryDurationSource } {
  const source = durationSourceForLeg(leg, transportLabel);
  if (source === "WALKING_FALLBACK_DISPLAY_ONLY" || source === "NONE") {
    return { minutes: null, source };
  }
  if (!leg) return { minutes: null, source: "NONE" };

  if (isTransitRequested(transportLabel)) {
    if (
      source !== "TRANSIT" ||
      leg.transportStatus !== "ok" ||
      leg.transportMode !== "TRANSIT" ||
      leg.estimates.transit == null
    ) {
      return { minutes: null, source: "NONE" };
    }
    return { minutes: leg.estimates.transit, source: "TRANSIT" };
  }

  return { minutes: travelMinutesForMode(leg, transportLabel), source };
}

function displayTextMatchesTransportMode(
  leg: TransitLegAdvice,
  transportLabel: string,
): boolean {
  const text = leg.transportDisplayText?.trim();
  if (!text) return false;
  // Soft unavailable / view-route copy is always acceptable.
  if (/查看路線|暫時無法|無法取得/.test(text)) return true;
  // Fallback drive/transit may differ from preference label.
  if (leg.transportFallbackMode === "drive" && /開車|自駕|租車|drive/i.test(text)) {
    return true;
  }
  if (leg.transportFallbackMode === "transit" && /大眾運輸/.test(text)) return true;
  if (
    (leg.transportMode === "DRIVE" || leg.transportMode === "TWO_WHEELER") &&
    /開車|自駕|租車|drive/i.test(text)
  ) {
    return true;
  }
  const requestedMode = travelLabelToRoutesMode(transportLabel);
  if (
    leg.transportMode &&
    leg.transportMode !== requestedMode &&
    !leg.transportFallbackMode
  ) {
    // Auto-resolved mode (e.g. walk→drive) still OK if text matches resolved mode.
    if (leg.transportMode === "DRIVE" && /開車|自駕/.test(text)) return true;
    if (leg.transportMode === "TRANSIT" && /大眾運輸/.test(text)) return true;
  }
  if (isTransitRequested(transportLabel)) {
    return /大眾運輸/.test(text);
  }
  if (/步行|走路|walk/i.test(transportLabel)) {
    return /步行|走路|開車|大眾運輸/.test(text);
  }
  if (/開車|drive|自駕|租車|計程車|共乘|taxi/i.test(transportLabel)) {
    return /開車|自駕|租車|計程車|共乘|drive/i.test(text);
  }
  return true;
}

export function formatLegTravelTimeLabel(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
  opts?: { loading?: boolean; unavailable?: boolean },
): string | undefined {
  if (opts?.loading) return ROAMIE_API_FALLBACK.routesLoading;
  if (isJapanTransitMapsLeg(leg, transportLabel)) return undefined;
  if (!leg) return opts?.unavailable ? ROAMIE_API_FALLBACK.routesUnavailable : "暫時無法取得交通時間";

  if (
    leg.transportDisplayText?.trim() &&
    displayTextMatchesTransportMode(leg, transportLabel)
  ) {
    return leg.transportDisplayText.trim();
  }

  if (opts?.unavailable) return ROAMIE_API_FALLBACK.routesUnavailable;

  if (isTransitRequested(transportLabel)) {
    const transitMins = leg.estimates.transit;
    if (
      transitMins != null &&
      leg.transportMode === "TRANSIT" &&
      leg.transportStatus === "ok"
    ) {
      return `大眾運輸 約 ${transitMins} 分鐘`;
    }
    if (
      leg.transportStatus === "transit_unavailable" ||
      leg.reason === "transit_unavailable"
    ) {
      return "暫時無法取得大眾運輸時間";
    }
    return undefined;
  }

  const mins = travelMinutesForMode(leg, transportLabel);
  if (mins == null) return "查看路線";

  const fallbackLabel =
    leg.transportFallbackMode === "drive"
      ? "開車"
      : leg.transportFallbackMode === "transit"
        ? "大眾運輸"
        : leg.transportMode === "DRIVE" || leg.transportMode === "TWO_WHEELER"
          ? /步行|走路|walk|單車|bike/i.test(transportLabel)
            ? "開車"
            : transportLabel.trim() || "移動"
          : transportLabel.trim() || "移動";
  const estimatedSuffix = leg.transportFallbackMode ? "（估算）" : "";
  return `${fallbackLabel} 約 ${mins} 分鐘${estimatedSuffix}`;
}

/** 不再顯示步行 fallback 提示 */
export function formatLegWalkFallbackHint(
  _leg: TransitLegAdvice | undefined,
  _transportLabel: string,
): string | null {
  return null;
}
