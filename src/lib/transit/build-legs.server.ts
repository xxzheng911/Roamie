import { fetchLegDurations } from "@/lib/google-directions.server";
import { enrichTransitLegsWithAI } from "@/lib/transit/transit-ai.server";
import { recommendLegFromEstimates } from "@/lib/transit/recommend-leg";
import { resolveRegionProfile } from "@/lib/transit/region-profiles";
import type {
  TransitLegAdvice,
  TransitLegInput,
  TransitPreferences,
  TransitWeatherHint,
} from "@/lib/transit/types";

export type BuildTransitResult = {
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

      const estimates = await fetchLegDurations(
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      );

      const leg = recommendLegFromEstimates({
        fromName: from.placeName || from.title,
        toName: to.placeName || to.title,
        estimates,
        destination: args.destination,
        preferences: args.preferences,
        weather: args.weather,
        time: to.time || from.time || args.time,
      });

      legs.push(leg);
    }
  }

  let finalLegs = legs;
  if (args.useAiReasons !== false && legs.length > 0 && legs.length <= 12) {
    try {
      finalLegs = await enrichTransitLegsWithAI(legs, {
        destination: args.destination,
        preferences: args.preferences,
      });
    } catch (e) {
      console.warn("[Roamie Transit] AI enrich skipped", e);
    }
  }

  return {
    legs: finalLegs,
    transportTips: buildTransportTips(args.destination, finalLegs.length),
  };
}
