import { ROAMIE_API_FALLBACK } from "@/lib/api/constants";
import type { TransitLegAdvice } from "@/lib/transit/types";

export function travelMinutesForMode(leg: TransitLegAdvice, transportLabel: string): number | null {
  const t = transportLabel.trim();
  if (!t) return leg.durationMinutes ?? null;
  if (/步行|走路|walk/i.test(t)) return leg.estimates.walk ?? leg.durationMinutes ?? null;
  if (/開車|drive|自駕/i.test(t)) return leg.estimates.drive ?? null;
  if (/機車|scooter|摩托/i.test(t)) {
    const drive = leg.estimates.drive;
    return drive != null ? Math.max(1, Math.round(drive * 0.85)) : null;
  }
  if (/大眾|地鐵|捷運|公車|火車|高鐵|transit|mrt|metro/i.test(t)) {
    return leg.estimates.transit ?? null;
  }
  return leg.durationMinutes ?? null;
}

export function formatLegTravelTimeLabel(
  leg: TransitLegAdvice | undefined,
  transportLabel: string,
  opts?: { loading?: boolean },
): string {
  if (opts?.loading) return ROAMIE_API_FALLBACK.routesLoading;
  if (!leg) return ROAMIE_API_FALLBACK.routesLoading;
  const mins = travelMinutesForMode(leg, transportLabel);
  if (mins == null) return ROAMIE_API_FALLBACK.routesLoading;
  const label = transportLabel.trim() || "移動";
  return `${label} 約 ${mins} 分鐘`;
}
