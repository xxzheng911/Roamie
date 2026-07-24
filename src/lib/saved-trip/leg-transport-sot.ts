/**
 * Point-to-point transport Source of Truth helpers.
 * UI label, duration text, and arrival times must all use resolvedMode.
 *
 * All user-visible transport copy must go through displayTransportLabel.
 * Internal enums/API modes may remain DRIVE / driving / car.
 */
import type { RoutesTravelMode } from "@/lib/routes/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import type { TripTransportOptionLabel } from "@/lib/saved-trip/transport-options";
import { TRIP_TRANSPORT_OPTIONS } from "@/lib/saved-trip/transport-options";
import { travelLabelToRoutesMode } from "@/services/routesService";

/**
 * Single UI label mapper for every transport surface.
 * walking → 步行
 * transit → 大眾運輸
 * driving / drive / car → 租車自駕
 * taxi / rideshare → 計程車/共乘
 * bicycling → 單車
 */
export function displayTransportLabel(
  modeOrLabel: string | RoutesTravelMode | null | undefined,
): string {
  const t = String(modeOrLabel ?? "").trim();
  if (!t) return "步行";
  if (/^WALK$/i.test(t) || /步行|走路|^walk$/i.test(t)) return "步行";
  if (
    /^TRANSIT$/i.test(t) ||
    /大眾運輸|大眾|地鐵|捷運|公車|火車|transit|mrt/i.test(t)
  ) {
    return "大眾運輸";
  }
  if (/taxi|rideshare|計程車|共乘|uber/i.test(t)) return "計程車/共乘";
  if (/^BICYCLE$/i.test(t) || /單車|自行車|bike|bicycle/i.test(t)) return "單車";
  if (/機車|scooter|摩托|motorcycle|two.?wheeler/i.test(t)) return "機車";
  if (
    /^DRIVE$|^TWO_WHEELER$|^CAR$/i.test(t) ||
    /開車|drive|自駕|租車|^car$/i.test(t)
  ) {
    return "租車自駕";
  }
  return t;
}

export function routesModeToTripTransportLabel(
  mode: RoutesTravelMode | null | undefined,
  preferenceLabel?: string,
): TripTransportOptionLabel | string {
  if (mode === "TRANSIT") return "大眾運輸";
  if (mode === "DRIVE" || mode === "TWO_WHEELER") {
    if (preferenceLabel && /計程車|共乘|taxi|uber/i.test(preferenceLabel)) {
      return "計程車/共乘";
    }
    return "租車自駕";
  }
  if (mode === "BICYCLE") return "單車";
  if (mode === "WALK") {
    if (preferenceLabel && /單車|bike|bicycle/i.test(preferenceLabel)) return "單車";
    return "步行";
  }
  if (preferenceLabel?.trim()) return displayTransportLabel(preferenceLabel);
  return "步行";
}

export function resolvedModeOfLeg(
  leg: TransitLegAdvice | undefined,
): RoutesTravelMode | undefined {
  if (!leg) return undefined;
  return leg.resolvedMode ?? leg.transportMode;
}

/**
 * Picker value: always show resolvedMode when the leg succeeded.
 * Prefer preference label only while pending / before first successful sync.
 */
export function displayTransportLabelForLeg(
  leg: TransitLegAdvice | undefined,
  preferenceLabel: string,
): string {
  const pref = displayTransportLabel(preferenceLabel.trim() || "步行");
  if (!leg) return pref;

  const status = leg.routeStatus ?? leg.transportStatus;
  if (status === "pending") return pref;

  // Manual pick failed for this mode — keep showing the requested preference.
  if (
    status === "mode_unavailable" ||
    status === "failed" ||
    status === "transit_unavailable"
  ) {
    if (leg.requestedMode) {
      return routesModeToTripTransportLabel(leg.requestedMode, pref);
    }
    return pref;
  }

  const resolved = resolvedModeOfLeg(leg);
  if (!resolved || status !== "ok") return pref;

  return routesModeToTripTransportLabel(resolved, pref);
}

/** True when duration text may safely show minutes for this leg. */
export function legHasUsableResolvedDuration(leg: TransitLegAdvice | undefined): boolean {
  if (!leg) return false;
  const status = leg.routeStatus ?? leg.transportStatus;
  if (status !== "ok") return false;
  const mins =
    leg.transportDurationMinutes ??
    (leg.durationMinutes > 0 ? leg.durationMinutes : null);
  return mins != null && mins > 0;
}

export function isKnownTripTransportLabel(label: string): boolean {
  return TRIP_TRANSPORT_OPTIONS.some((o) => o.label === label);
}

export function requestedModeFromLabel(label: string): RoutesTravelMode {
  return travelLabelToRoutesMode(label);
}
