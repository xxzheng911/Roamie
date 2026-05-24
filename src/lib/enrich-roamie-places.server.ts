import type { RoamieRequestContext } from "@/lib/ai/context";
import type { RoamieItineraryItem, RoamieRecommendationItem, RoamieResponse } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  applyAvailabilityFields,
  appendReasonWithHours,
  derivePlaceAvailability,
  filterOpenPlaces,
  isPlaceAvailableNow,
  type FilterPlacesContext,
  type PlaceHoursData,
} from "@/lib/filter-available-places";
import {
  buildLateNightCompanionSummary,
  isLateNightMode,
  rankRecommendations,
  selectRecommendationsForNow,
  summarizeAvailabilityStats,
} from "@/lib/recommend-place-ranking";
import { lookupPlacesHoursBatch } from "@/lib/places.functions";
import {
  filterAlreadyRecommendedPlaces,
  mergeRecommendationsWithSelected,
} from "@/lib/place-planning-memory";
import {
  buildLateNightMoodSummary,
  shouldActivateLateNightSceneFlow,
} from "@/lib/late-night-scene-recommendations";

export type EnrichRoamieOptions = {
  context: FilterPlacesContext;
  lat?: number;
  lng?: number;
  /** 行程起始日 YYYY-MM-DD */
  tripStartDate?: string;
  at?: Date;
};

function resolveCenter(ctx: RoamieRequestContext): { lat: number; lng: number } | null {
  const lat = ctx.location?.lat;
  const lng = ctx.location?.lng;
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function resolveAt(ctx: RoamieRequestContext): Date {
  if (ctx.time) {
    const d = new Date(ctx.time);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function enrichOptsFromContext(ctx: RoamieRequestContext): EnrichRoamieOptions | null {
  const center = resolveCenter(ctx);
  if (!center) return null;
  const at = resolveAt(ctx);

  if (ctx.mode === "itinerary") {
    return {
      context: "scheduled",
      lat: center.lat,
      lng: center.lng,
      tripStartDate:
        ctx.itineraryRequest?.startDate?.trim() ||
        new Date().toISOString().slice(0, 10),
      at,
    };
  }

  return { context: "now", lat: center.lat, lng: center.lng, at };
}

function parseItineraryAt(tripStartDate: string | undefined, item: RoamieItineraryItem): Date {
  const dateStr = item.date?.trim() || tripStartDate || new Date().toISOString().slice(0, 10);
  const base = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(base.getTime())) return new Date();
  return base;
}

async function enrichRecommendations(
  recs: RoamieRecommendationItem[],
  opts: EnrichRoamieOptions,
  ctx: RoamieRequestContext,
): Promise<{ recommendations: RoamieRecommendationItem[]; lateNightMode: boolean; stats: ReturnType<typeof summarizeAvailabilityStats> }> {
  const center = { lat: opts.lat!, lng: opts.lng! };
  const at = opts.at ?? new Date();
  const sceneFlow = shouldActivateLateNightSceneFlow(ctx.mood ?? ctx.selectedMood, at);

  if (!recs.length) {
    const lateNightMode = isLateNightMode(at);
    return {
      recommendations: [],
      lateNightMode,
      stats: { total: 0, open: 0, closingSoon: 0, closed: 0, unknown: 0 },
    };
  }

  const hoursMap = await lookupPlacesHoursBatch(
    recs.map((r) => ({
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
    })),
    center,
  );

  const normalized = recs.map((r) => normalizeRecommendationItem(r));
  const openOnly = filterOpenPlaces(
    normalized,
    (r) => hoursMap.get(r.name) ?? {},
    (r) => ({ name: r.name, type: r.type }),
    { context: "now", at },
  );

  const mood = ctx.mood ?? ctx.selectedMood;
  const ranked = rankRecommendations(openOnly, hoursMap, at, mood);
  const stats = summarizeAvailabilityStats(ranked);
  const lateNightMode = isLateNightMode(at) || sceneFlow;

  let selected = selectRecommendationsForNow(ranked, {
    maxCount: ctx.mode === "recommend" ? 5 : 8,
    at,
    mood,
  });

  let recommendations = selected.map(({ rec, availability }) => {
    const patched = applyAvailabilityFields(rec, availability);
    return {
      ...patched,
      reason: appendReasonWithHours(patched.reason, availability),
    };
  });

  if (sceneFlow && ctx.location && recommendations.length < 3) {
    // 不再注入硬編深夜種子 — 僅使用 Google Places 驗證過的候選
  }

  return { recommendations, lateNightMode, stats };
}

async function enrichItinerary(
  items: RoamieItineraryItem[],
  opts: EnrichRoamieOptions,
): Promise<RoamieItineraryItem[]> {
  const center = { lat: opts.lat!, lng: opts.lng! };
  const names = [...new Set(items.map((i) => i.placeName).filter(Boolean))];
  if (!names.length) return items;

  const hoursMap = await lookupPlacesHoursBatch(
    names.map((name) => {
      const item = items.find((i) => i.placeName === name);
      return { name, lat: item?.lat, lng: item?.lng };
    }),
    center,
  );

  const kept: RoamieItineraryItem[] = [];

  for (const item of items) {
    const hours: PlaceHoursData = hoursMap.get(item.placeName) ?? {};
    const at = parseItineraryAt(opts.tripStartDate, item);
    if (
      !isPlaceAvailableNow(
        hours,
        { name: item.placeName, type: item.title },
        { context: "scheduled", at, atTime: item.time },
      )
    ) {
      continue;
    }

    kept.push(item);
  }

  return kept;
}

/** AI 回應後補齊營業時間、依時段排序，深夜套用 Roamie 風格空狀態文案 */
export async function enrichRoamieResponse(
  response: RoamieResponse,
  ctx: RoamieRequestContext,
): Promise<RoamieResponse> {
  const opts = enrichOptsFromContext(ctx);
  if (!opts?.lat || !opts.lng) return response;

  const { recommendations: enrichedRecs, lateNightMode, stats } =
    await enrichRecommendations(response.recommendations ?? [], opts, ctx);

  let finalRecs = enrichedRecs;
  const selected = ctx.selectedPlaces ?? [];
  if (selected.length) {
    const filtered = filterAlreadyRecommendedPlaces(enrichedRecs, {
      selected,
      recommended: ctx.recommendedPlaces,
      rejectedNames: ctx.rejectedPlaceNames,
      recentNames: ctx.recentRecommendationNames,
    });
    finalRecs = mergeRecommendationsWithSelected(selected, filtered, {
      maxNew: 4,
      location: ctx.location ?? null,
    });
  } else if (enrichedRecs.length) {
    finalRecs = filterAlreadyRecommendedPlaces(enrichedRecs, {
      recommended: ctx.recommendedPlaces,
      rejectedNames: ctx.rejectedPlaceNames,
      recentNames: ctx.recentRecommendationNames,
    });
  }

  const itinerary =
    response.itinerary?.length && opts.context === "scheduled"
      ? await enrichItinerary(response.itinerary, opts)
      : (response.itinerary ?? []);

  const sceneFlow = shouldActivateLateNightSceneFlow(
    ctx.mood ?? ctx.selectedMood,
    resolveAt(ctx),
  );
  let summary = response.summary;
  const aiRecCount = response.recommendations?.length ?? 0;
  if (
    sceneFlow &&
    finalRecs.length > 0 &&
    (aiRecCount < 2 || /要不要看看夜景|附近大部分店家慢慢休息|適合深夜待著/.test(summary))
  ) {
    summary = buildLateNightMoodSummary({
      city: ctx.location?.city ?? ctx.weather?.city,
      mood: ctx.mood ?? ctx.selectedMood,
      placeCount: finalRecs.length,
    });
  } else if (lateNightMode && finalRecs.length === 0) {
    summary = buildLateNightCompanionSummary({
      mood: ctx.mood,
      weather: ctx.weather,
      city: ctx.location?.city ?? ctx.weather?.city,
      stats,
    });
  } else if (
    lateNightMode &&
    finalRecs.length > 0 &&
    stats.open + stats.closingSoon <= 1 &&
    !/休息|深夜|慢慢/.test(summary)
  ) {
    summary = `${summary.trim()}\n\n${buildLateNightCompanionSummary({
      mood: ctx.mood,
      weather: ctx.weather,
      city: ctx.location?.city,
      stats,
    })}`;
  }

  return {
    ...response,
    summary,
    recommendations: finalRecs,
    itinerary,
  };
}
