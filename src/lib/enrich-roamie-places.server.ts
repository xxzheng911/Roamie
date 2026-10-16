import {
  buildPlaceRecommendationReason,
  resolveRecommendationReasonPlace,
} from "@/lib/build-place-recommendation-reason";
import { translate } from "@/lib/i18n/translate";
import { localizedAvailabilityCopy } from "@/lib/generated-display-projection";
import type { RoamieRequestContext } from "@/lib/ai/context";
import type { RoamieItineraryItem, RoamieRecommendationItem, RoamieResponse } from "@/lib/ai/types";
import { normalizeRecommendationItem } from "@/lib/ai/types";
import {
  applyAvailabilityFields,
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
import { userProfileForReasonFrom } from "@/lib/build-place-recommendation-reason";
import {
  buildExplicitAvoidKeywords,
  buildExplicitPreferKeywords,
  buildPlusPreferenceRankingContext,
} from "@/lib/plus-preference-ranking";
import { isRecommendablePlace, itineraryToRecommendableInput } from "@/lib/is-recommendable-place";
import {
  lookupPlacesHoursBatchWithIdentity,
  type VerifiedPlaceHours,
} from "@/lib/places.functions";
import { normalizeTrustedGooglePlaceId } from "@/lib/ai/combination-candidate-quality";
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
        ctx.itineraryRequest?.startDate?.trim() || new Date().toISOString().slice(0, 10),
      at,
    };
  }

  return { context: "now", lat: center.lat, lng: center.lng, at };
}

/** Name-keyed hours exactly as lookupPlacesHoursBatch returned them (existing consumers). */
function hoursOnlyMap(withIdentity: Map<string, VerifiedPlaceHours>): Map<string, PlaceHoursData> {
  const map = new Map<string, PlaceHoursData>();
  for (const [name, entry] of withIdentity) map.set(name, entry.hours);
  return map;
}

/**
 * Tourist Quality Gate evidence: the hours only when their verified Google Place ID strictly
 * equals the item's googlePlaceId. Name matches, missing IDs and unverified results yield null.
 */
function verifiedGateHours(
  entry: VerifiedPlaceHours | undefined,
  googlePlaceId: string | undefined,
): Pick<PlaceHoursData, "regularOpeningHours" | "currentOpeningHours"> | null {
  const id = googlePlaceId?.trim();
  if (!entry?.verifiedPlaceId || !id || entry.verifiedPlaceId !== id) return null;
  return {
    regularOpeningHours: entry.hours.regularOpeningHours,
    currentOpeningHours: entry.hours.currentOpeningHours,
  };
}

/** Google Place IDs the user explicitly selected (identity by Place ID only, never by name). */
function selectedGooglePlaceIds(ctx: RoamieRequestContext): Set<string> {
  const ids = new Set<string>();
  for (const place of [
    ...(ctx.itineraryRequest?.selectedPlaces ?? []),
    ...(ctx.selectedPlaces ?? []),
  ]) {
    // Any Google Place ID format (ChIJ / GhIJ / EiQ …); synthetic and fallback IDs never protect.
    const id = normalizeTrustedGooglePlaceId(place.googlePlaceId);
    if (id) ids.add(id);
  }
  return ids;
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
): Promise<{
  recommendations: RoamieRecommendationItem[];
  lateNightMode: boolean;
  stats: ReturnType<typeof summarizeAvailabilityStats>;
}> {
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

  const hoursWithIdentity = await lookupPlacesHoursBatchWithIdentity(
    recs.map((r) => ({
      name: r.name,
      placeId: r.googlePlaceId,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
    })),
    center,
    {
      caller: "enrichRecommendations",
      screen: "ai_recommend",
    },
  );
  const hoursMap = hoursOnlyMap(hoursWithIdentity);

  const normalized = recs.map((r) => normalizeRecommendationItem(r));
  const openOnly = filterOpenPlaces(
    normalized,
    (r) => hoursMap.get(r.name) ?? {},
    (r) => ({ name: r.name, type: r.type }),
    { context: "now", at },
  );

  const mood = ctx.mood ?? ctx.selectedMood;
  const plusCtx =
    ctx.planTier === "plus"
      ? buildPlusPreferenceRankingContext({
          surface: "destination",
          profile: userProfileForReasonFrom(ctx.preferences, {
            hasPlusAccess: true,
            travelStyle: ctx.longTermMemory?.travelStyle,
            personalityType: ctx.longTermMemory?.personalityType,
            personalitySummary: ctx.longTermMemory?.personalitySummary,
            mood: mood ?? undefined,
          }),
          savedPlaces: (ctx.savedPlaceNames ?? []).map((name) => ({ name })),
          explicitAvoidKeywords: buildExplicitAvoidKeywords(undefined, ctx.avoidTypes),
          explicitPreferKeywords: buildExplicitPreferKeywords({
            mood,
            setting: ctx.planningHints?.setting,
          }),
          mood,
          setting: ctx.planningHints?.setting,
        })
      : null;
  // Tourist Quality Gate inside ranking reads hours from the rec itself. Rank gate-only copies
  // that carry Place-ID-verified hours, then map results back to the original objects so the
  // response shape never gains opening-hours fields.
  const originalByGateCopy = new Map<RoamieRecommendationItem, RoamieRecommendationItem>();
  const gateInputs = openOnly.map((rec) => {
    const gateHours = verifiedGateHours(hoursWithIdentity.get(rec.name), rec.googlePlaceId);
    if (!gateHours) return rec;
    const copy: RoamieRecommendationItem = { ...rec, ...gateHours };
    originalByGateCopy.set(copy, rec);
    return copy;
  });
  const ranked = rankRecommendations(
    gateInputs,
    hoursMap,
    at,
    mood,
    ctx.weather ?? null,
    plusCtx,
  ).map((entry) => {
    const original = originalByGateCopy.get(entry.rec);
    return original ? { ...entry, rec: original } : entry;
  });
  const stats = summarizeAvailabilityStats(ranked);
  const lateNightMode = isLateNightMode(at) || sceneFlow;

  let selected = selectRecommendationsForNow(ranked, {
    maxCount: ctx.mode === "recommend" ? 5 : 8,
    at,
    mood,
  });

  let recommendations = selected.map(({ rec, availability }) => {
    const patched = applyAvailabilityFields(rec, availability);
    const display =
      ctx.locale && ctx.locale !== "zh-TW"
        ? localizedAvailabilityCopy(patched, ctx.locale, availability.openStatus)
        : patched;
    return {
      ...display,
      reason: buildPlaceRecommendationReason(
        resolveRecommendationReasonPlace(patched),
        null,
        null,
        at,
        undefined,
        ctx.locale,
      ),
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
  selectedPlaceIds: ReadonlySet<string> = new Set(),
): Promise<RoamieItineraryItem[]> {
  const { beginPlacesFlow, endPlacesFlow } = await import("@/lib/places-api-stats");
  const flow = beginPlacesFlow("itinerary_once");
  try {
    const center = { lat: opts.lat!, lng: opts.lng! };
    const names = [...new Set(items.map((i) => i.placeName).filter(Boolean))];
    if (!names.length) return items;

    // Request keys unchanged (no placeId passed): only this call's own lookup can verify an ID.
    const hoursWithIdentity = await lookupPlacesHoursBatchWithIdentity(
      names.map((name) => {
        const item = items.find((i) => i.placeName === name);
        return { name, lat: item?.lat, lng: item?.lng };
      }),
      center,
      {
        caller: "enrichItinerary",
        screen: "itinerary",
      },
    );

    const kept: RoamieItineraryItem[] = [];

    for (const item of items) {
      const entry = hoursWithIdentity.get(item.placeName);
      const hours: PlaceHoursData = entry?.hours ?? {};
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

      const availability = derivePlaceAvailability(hours, {
        context: "scheduled",
        at,
        atTime: item.time,
      });
      const itemPlaceId = normalizeTrustedGooglePlaceId(item.googlePlaceId);
      const recommendable = isRecommendablePlace(
        itineraryToRecommendableInput(
          item,
          {
            businessStatus: availability.businessStatus,
            openStatus: availability.openStatus,
          },
          verifiedGateHours(entry, item.googlePlaceId),
        ),
        "plan_trip",
        {
          // User-selected stops (matched by Google Place ID only) are never removed by the Gate.
          touristQualityProtection:
            itemPlaceId && selectedPlaceIds.has(itemPlaceId) ? "explicit" : null,
        },
      );
      if (!recommendable.ok) continue;

      kept.push(item);
    }

    return kept;
  } finally {
    endPlacesFlow(flow);
  }
}

/** AI 回應後補齊營業時間、依時段排序，深夜套用 Roamie 風格空狀態文案 */
export async function enrichRoamieResponse(
  response: RoamieResponse,
  ctx: RoamieRequestContext,
): Promise<RoamieResponse> {
  const { endAiPlaceApiSession } = await import("@/lib/recommendation/ai-places-cache");
  const { endTrackedPlacesFlow } = await import("@/lib/places-api-stats");

  try {
    const opts = enrichOptsFromContext(ctx);
    if (!opts?.lat || !opts.lng) return response;

    const {
      recommendations: enrichedRecs,
      lateNightMode,
      stats,
    } = await enrichRecommendations(response.recommendations ?? [], opts, ctx);

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
        ? await enrichItinerary(response.itinerary, opts, selectedGooglePlaceIds(ctx))
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
      summary =
        ctx.locale && ctx.locale !== "zh-TW"
          ? translate(ctx.locale, "destinationEditorial.late_places", { count: finalRecs.length })
          : buildLateNightMoodSummary({
              city: ctx.location?.city ?? ctx.weather?.city,
              mood: ctx.mood ?? ctx.selectedMood,
              placeCount: finalRecs.length,
            });
    } else if (lateNightMode && finalRecs.length === 0) {
      summary =
        ctx.locale && ctx.locale !== "zh-TW"
          ? translate(ctx.locale, "destinationEditorial.late_empty")
          : buildLateNightCompanionSummary({
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
      summary =
        ctx.locale && ctx.locale !== "zh-TW"
          ? `${summary.trim()}\n\n${translate(ctx.locale, "destinationEditorial.late_check")}`
          : `${summary.trim()}\n\n${buildLateNightCompanionSummary({
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
  } finally {
    endTrackedPlacesFlow("ai_recommend");
    endAiPlaceApiSession();
  }
}
