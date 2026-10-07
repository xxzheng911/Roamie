import type { GeneratedLocaleContract } from "@/lib/generated-locale";
import { getRouteDuration } from "@/lib/google-routes.server";
import { distanceMeters } from "@/lib/geo-distance";
import { enrichTransitLegsWithAI } from "@/lib/transit/transit-ai.server";
import { getTransitModeLabel, recommendLegFromEstimates } from "@/lib/transit/recommend-leg";
import { resolveRegionProfile } from "@/lib/transit/region-profiles";
import type {
  TransitLegAdvice,
  TransitLegInput,
  TransitPreferences,
  TransitWeatherHint,
} from "@/lib/transit/types";

export type BuildTransitResult = GeneratedLocaleContract & {
  legs: TransitLegAdvice[];
  /** 整體交通提示 */
  transportTips: string;
};

function buildTransportTips(destination: string | undefined, legCount: number): string {
  const region = resolveRegionProfile(destination);
  const notes = region.notes.slice(0, 2).join("；");
  if (!notes) return `共 ${legCount} 段移動，Roamie 已依距離與路況建議最適合的交通方式。`;
  return `${notes}。共分析 ${legCount} 段移動。`;
}

/** 依行程順序建立相鄰地點的交通建議（同日期內） */
export async function buildTransitLegsForItinerary(args: {
  items: TransitLegInput[];
  destination?: string;
  preferences?: TransitPreferences;
  weather?: TransitWeatherHint;
  time?: string;
  useAiReasons?: boolean;
}): Promise<BuildTransitResult> {
  const legs: TransitLegAdvice[] = [];
  const byDate = new Map<string, TransitLegInput[]>();

  for (const item of args.items) {
    const d = item.date?.trim() || "default";
    const list = byDate.get(d) ?? [];
    list.push(item);
    byDate.set(d, list);
  }

  for (const dayItems of byDate.values()) {
    for (let i = 0; i < dayItems.length - 1; i++) {
      const from = dayItems[i]!;
      const to = dayItems[i + 1]!;
      if (
        from.lat == null ||
        from.lng == null ||
        to.lat == null ||
        to.lng == null
      ) {
        continue;
      }

      const origin = { lat: from.lat, lng: from.lng };
      const destination = { lat: to.lat, lng: to.lng };
      // Local rule selection only: no provider durations are needed to pick a mode.
      const selected = recommendLegFromEstimates({
        fromName: from.placeName || from.title,
        toName: to.placeName || to.title,
        estimates: { distanceMeters: distanceMeters(origin, destination) },
        destination: args.destination,
        preferences: args.preferences,
        weather: args.weather,
        time: to.time || from.time || args.time,
      });
      const mode = selected.recommendedMode === "walk" ? "WALK"
        : ["subway", "bus", "transit", "hsr", "train"].includes(selected.recommendedMode)
          ? "TRANSIT" : "DRIVE";
      // One provider request only. Never reselect from a partial set of durations.
      const route = await getRouteDuration(origin, destination, mode);
      const ok = route.ok && route.data.travelMode === mode &&
        Number.isFinite(route.data.durationMinutes) && route.data.durationMinutes > 0;
      const minutes = route.ok && ok ? route.data.durationMinutes : 0;
      const estimateKey = mode === "WALK" ? "walk" : mode === "DRIVE" ? "drive" : "transit";
      const label = getTransitModeLabel(selected.recommendedMode);
      const leg: TransitLegAdvice = {
        ...selected,
        headline: ok ? `${label}（約 ${minutes} 分鐘）` : `${label}（交通時間無法取得）`,
        durationMinutes: minutes,
        reason: ok ? selected.reason : "mode_unavailable",
        distanceMeters: route.ok && ok ? route.data.distanceMeters : selected.distanceMeters,
        estimates: ok ? { [estimateKey]: minutes } : {},
        alternatives: [],
        requestedMode: mode,
        resolvedMode: ok ? mode : undefined,
        transportMode: ok ? mode : undefined,
        durationSource: ok ? "directions" : "none",
        routeStatus: ok ? "ok" : "mode_unavailable",
        transportStatus: ok ? "ok" : "failed",
        transportDurationMinutes: ok ? minutes : undefined,
        fallbackReason: ok ? null : "mode_unavailable",
        modeSelectionSource: "auto",
      };

      legs.push(leg);
    }
  }

  let finalLegs = legs;
  if (args.useAiReasons !== false && legs.length > 0 && legs.length <= 12) {
    try {
      const enriched = await enrichTransitLegsWithAI(legs, {
        destination: args.destination,
        preferences: args.preferences,
      });
      // AI may refine prose, never the selected mode or provider duration/status.
      finalLegs = legs.map((leg, index) => ({
        ...leg,
        reason: enriched[index]?.reason ?? leg.reason,
        source: enriched[index]?.source ?? leg.source,
      }));
    } catch (e) {
      console.warn("[Roamie Transit] AI enrich skipped", e);
    }
  }

  return {
    generatedLocale: "zh-TW",
    legs: finalLegs,
    transportTips: buildTransportTips(args.destination, finalLegs.length),
  };
}
