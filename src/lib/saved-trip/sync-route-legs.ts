import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { buildLegKey } from "@/lib/transit/types";
import type { TransitLegAdvice } from "@/lib/transit/types";
import {
  getTripLegsWithDurations,
  travelLabelToRoutesMode,
  type RoutesTravelMode,
} from "@/services/routesService";

function transportLabelForLeg(settings: TripPlanSettings, item: RoamieItineraryItem): string {
  const key = item.placeName || item.title;
  const custom = settings.legTransport?.[key];
  if (custom?.trim()) return custom.trim();
  const mode = settings.transport ?? "walk";
  if (mode === "walk") return "步行";
  if (mode === "drive") return "開車";
  if (mode === "transit") return "大眾運輸";
  if (mode === "scooter") return "機車";
  return "步行";
}

function buildTransitLeg(
  legKey: string,
  fromName: string,
  toName: string,
  durationMinutes: number,
  distanceMeters: number,
  transportLabel: string,
): TransitLegAdvice {
  const mode = /步行|walk/i.test(transportLabel)
    ? "walk"
    : /開車|drive/i.test(transportLabel)
      ? "drive"
      : /大眾|transit|捷運|地鐵/i.test(transportLabel)
        ? "transit"
        : "walk";
  return {
    legKey,
    fromName,
    toName,
    recommendedMode: mode,
    headline: transportLabel,
    durationMinutes,
    distanceMeters,
    reason: "",
    complexity: "low",
    estimates: {
      walk: durationMinutes,
      drive: durationMinutes,
      transit: durationMinutes,
    },
    source: "rules",
  };
}

/**
 * 依 Google Routes API 更新相鄰地點的點到點耗時（寫入 tripSettings.transitLegs）。
 */
export async function syncTripLegsFromGoogleRoutes(
  items: RoamieItineraryItem[],
  settings: TripPlanSettings,
): Promise<Record<string, TransitLegAdvice>> {
  const withCoords = items.filter((i) => i.lat != null && i.lng != null);
  if (withCoords.length < 2) return settings.transitLegs ?? {};

  const defaultMode = travelLabelToRoutesMode(
    settings.transport === "walk"
      ? "步行"
      : settings.transport === "drive"
        ? "開車"
        : settings.transport === "transit"
          ? "大眾運輸"
          : "步行",
  );

  const next: Record<string, TransitLegAdvice> = { ...(settings.transitLegs ?? {}) };

  for (let i = 1; i < withCoords.length; i++) {
    const prev = withCoords[i - 1]!;
    const curr = withCoords[i]!;
    const legKey = buildLegKey(prev.placeName || prev.title, curr.placeName || curr.title);
    const transportLabel = transportLabelForLeg(settings, curr);
    const mode: RoutesTravelMode = travelLabelToRoutesMode(transportLabel) || defaultMode;

    const legs = await getTripLegsWithDurations(
      [
        { lat: prev.lat!, lng: prev.lng! },
        { lat: curr.lat!, lng: curr.lng! },
      ],
      mode,
    );
    const leg = legs[0];
    if (leg && leg.durationMinutes > 0) {
      next[legKey] = buildTransitLeg(
        legKey,
        prev.placeName || prev.title,
        curr.placeName || curr.title,
        leg.durationMinutes,
        leg.distanceMeters,
        transportLabel,
      );
    }
  }

  return next;
}
