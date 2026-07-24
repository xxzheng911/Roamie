import type { TransitLegAdvice } from "@/lib/transit/types";
import type { RoutesTravelMode } from "@/lib/routes/types";
import { ROAMIE_API_FALLBACK } from "@/lib/api/constants";
import { isJapanTransitMapsLeg } from "@/lib/saved-trip/japan-transit-maps";
import { travelLabelToRoutesMode } from "@/services/routesService";
import {
  displayTransportLabelForLeg,
  resolvedModeOfLeg,
} from "@/lib/saved-trip/leg-transport-sot";

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

function minutesForResolvedMode(leg: TransitLegAdvice): number | null {
  const resolved = resolvedModeOfLeg(leg);
  if (!resolved) {
    if (leg.durationMinutes > 0 && (leg.routeStatus ?? leg.transportStatus) === "ok") {
      return leg.durationMinutes;
    }
    return null;
  }
  if (resolved === "TRANSIT") {
    return leg.estimates.transit ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  if (resolved === "DRIVE" || resolved === "TWO_WHEELER") {
    return leg.estimates.drive ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  if (resolved === "WALK" || resolved === "BICYCLE") {
    return leg.estimates.walk ?? (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  }
  return leg.durationMinutes > 0 ? leg.durationMinutes : null;
}

/**
 * Minutes for the resolved mode (Source of Truth).
 * Never returns another mode's duration when the requested mode failed (mode_unavailable).
 */
export function travelMinutesForMode(leg: TransitLegAdvice, transportLabel: string): number | null {
  const status = leg.routeStatus ?? leg.transportStatus;
  if (status === "mode_unavailable" || status === "failed" || status === "transit_unavailable") {
    return null;
  }
  if (status === "ok" || leg.transportFallbackMode || leg.resolvedMode || leg.transportMode) {
    const fromResolved = minutesForResolvedMode(leg);
    if (fromResolved != null) return fromResolved;
  }

  const t = transportLabel.trim();
  if (!t) {
    return leg.transportMode && leg.durationMinutes > 0 ? leg.durationMinutes : null;
  }

  const requestedMode = travelLabelToRoutesMode(t);
  const fromEstimates = estimateMinutesForRoutesMode(leg, requestedMode);
  if (fromEstimates != null) return fromEstimates;

  if (leg.transportMode === requestedMode && leg.durationMinutes > 0) {
    return leg.durationMinutes;
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
  const status = leg.routeStatus ?? leg.transportStatus;
  if (status === "mode_unavailable" || status === "failed" || status === "transit_unavailable") {
    return "NONE";
  }

  const resolved = resolvedModeOfLeg(leg);
  if (status === "ok" && resolved) {
    if (resolved === "TRANSIT") return "TRANSIT";
    if (resolved === "DRIVE" || resolved === "TWO_WHEELER") {
      return leg.transportFallbackMode || leg.fallbackReason ? "ESTIMATE" : "DRIVE";
    }
    if (resolved === "WALK" || resolved === "BICYCLE") {
      return leg.transportFallbackMode || leg.fallbackReason ? "ESTIMATE" : "WALK";
    }
  }

  const t = transportLabel.trim();
  if (isTransitRequested(t)) {
    if (
      leg.transportStatus === "ok" &&
      leg.transportMode === "TRANSIT" &&
      leg.estimates.transit != null
    ) {
      return "TRANSIT";
    }
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
  const mins = travelMinutesForMode(leg, t);
  return mins != null ? "ESTIMATE" : "NONE";
}

/** 抵達時間推算：一律用 resolvedMode 的 duration */
export function travelMinutesForArrival(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
): { minutes: number | null; source: ItineraryDurationSource } {
  const source = durationSourceForLeg(leg, transportLabel);
  if (source === "WALKING_FALLBACK_DISPLAY_ONLY" || source === "NONE") {
    return { minutes: null, source };
  }
  if (!leg) return { minutes: null, source: "NONE" };

  const mins = minutesForResolvedMode(leg);
  if (mins != null) return { minutes: mins, source };
  return { minutes: travelMinutesForMode(leg, transportLabel), source };
}

/** Rewrite legacy「開車」duration copy to the unified「租車自駕」label. */
function normalizeStoredTransportDisplayText(
  text: string,
  displayLabel: string,
): string {
  if (displayLabel === "租車自駕" && /開車/.test(text)) {
    return text.replace(/開車/g, "租車自駕");
  }
  return text;
}

function displayTextMatchesTransportMode(
  leg: TransitLegAdvice,
  transportLabel: string,
): boolean {
  const text = leg.transportDisplayText?.trim();
  if (!text) return false;
  if (/查看路線|暫時無法|無法取得/.test(text)) return true;

  const displayLabel = displayTransportLabelForLeg(leg, transportLabel);
  if (displayLabel === "大眾運輸" && /大眾運輸/.test(text)) return true;
  if (
    /租車|自駕|開車|計程車|共乘/.test(displayLabel) &&
    /開車|自駕|租車|計程車|共乘|drive/i.test(text)
  ) {
    return true;
  }
  if (displayLabel === "步行" && /步行|走路/.test(text)) return true;
  if (displayLabel === "單車" && /單車|bike|步行/.test(text)) return true;

  // Legacy fallback fields
  if (leg.transportFallbackMode === "drive" && /開車|自駕|租車|drive/i.test(text)) {
    return true;
  }
  if (leg.transportFallbackMode === "transit" && /大眾運輸/.test(text)) return true;
  return true;
}

export function formatLegTravelTimeLabel(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
  opts?: { loading?: boolean; unavailable?: boolean },
): string | undefined {
  if (opts?.loading) return ROAMIE_API_FALLBACK.routesLoading;
  if (isJapanTransitMapsLeg(leg, transportLabel)) return undefined;
  if (!leg) {
    return opts?.unavailable ? ROAMIE_API_FALLBACK.routesUnavailable : "暫時無法取得交通時間";
  }

  const status = leg.routeStatus ?? leg.transportStatus;
  if (status === "mode_unavailable") {
    return "暫無法取得交通時間";
  }
  if (status === "failed" || status === "transit_unavailable") {
    if (leg.transportDisplayText?.trim()) return leg.transportDisplayText.trim();
    return opts?.unavailable ? ROAMIE_API_FALLBACK.routesUnavailable : "查看路線";
  }

  const displayLabel = displayTransportLabelForLeg(leg, transportLabel);

  if (
    leg.transportDisplayText?.trim() &&
    displayTextMatchesTransportMode(leg, transportLabel)
  ) {
    return normalizeStoredTransportDisplayText(
      leg.transportDisplayText.trim(),
      displayLabel,
    );
  }

  if (opts?.unavailable) return ROAMIE_API_FALLBACK.routesUnavailable;

  const mins = travelMinutesForMode(leg, displayLabel);
  if (mins == null) return "查看路線";

  const estimatedSuffix =
    leg.transportFallbackMode ||
    (leg.fallbackReason && leg.requestedMode && leg.resolvedMode && leg.requestedMode !== leg.resolvedMode)
      ? "（估算）"
      : "";
  return `${displayLabel} 約 ${mins} 分鐘${estimatedSuffix}`;
}

/** 不再顯示步行 fallback 提示 */
export function formatLegWalkFallbackHint(
  _leg: TransitLegAdvice | undefined,
  _transportLabel: string,
): string | null {
  return null;
}
