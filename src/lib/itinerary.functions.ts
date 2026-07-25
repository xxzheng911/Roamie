import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import type {
  RoamiePayloadV2,
  RoamieRecommendationItem,
  RoamieItineraryItem,
  RoamieResponse,
  TripTransportMode,
} from "@/lib/ai/types";
import { buildOutfitAdviceForTrip } from "@/lib/outfit/build-advice";
import { normalizeTime } from "@/lib/picker-utils";
import {
  INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
  isGenericPlaceLabel,
  isValidItineraryStopPlace,
} from "@/lib/ai/generic-place-label";
import {
  buildFallbackItineraryFromPlaces,
  coalesceItineraryItems,
  groupItineraryItemsByDay,
  type GenerateItineraryResult,
} from "@/lib/trip/itinerary-guards";
import { preparePlacesForItineraryBuild } from "@/lib/place-planning-memory";
import type { PlaceResult } from "@/lib/place-result";
import { dedupeLandmarkItems } from "@/lib/ai/landmark-cluster";
import { validateCrossDayGeographicAllocation } from "@/lib/ai/geographic-clustering";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  validateFinalItineraryIntegrity,
  validateGeneratedItinerary,
  groupStopsByTripDays,
} from "@/lib/ai/combination-itinerary-integrity";
import {
  buildRequiredAnchorPlaces,
  buildSelectedPlaceLock,
  recommendationIntegrityCheck,
  plannerDeliveryCheck,
} from "@/lib/ai/required-anchor-runtime";
import {
  isItineraryValidatorEnabled,
  validateItineraryPlan,
  shouldBlockItineraryDelivery,
  logItineraryDeliveryBlocked,
  logItineraryDeliveryAllowed,
  dayCountsOfPlans,
  compareItineraryPersistenceDayCounts,
  ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
} from "@/lib/ai/itinerary-validator";
import { applyItineraryLocalizationGate } from "@/lib/ai/itinerary-localization-gate";
import { buildLegMinutesFromPlaces } from "@/lib/ai/estimate-place-visit-duration";
import { resolvePlannerPaceFromProfile } from "@/lib/ai/required-anchor-runtime";
import {
  applyComposedPlansToItineraryItems,
  composedPlansFromItineraryItems,
} from "@/lib/ai/itinerary-validator/from-payload";
import { replanUntilItineraryValid } from "@/lib/ai/itinerary-validator/replan";
import type { ItineraryValidatorInput } from "@/lib/ai/itinerary-validator/types";
import { resolvePlannerStyleKey, type ComposedDayPlan } from "@/lib/ai/ai-day-plan-source";

const PlaceSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    primaryType: z.string().nullable().optional(),
    types: z.array(z.string()).optional(),
    description: z.string().optional(),
    reason: z.string().optional(),
    estimatedTime: z.string().optional(),
    address: z.string().optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    googleMapsUrl: z.string().optional(),
    placeName: z.string().optional(),
    googlePlaceId: z.string().optional(),
    reasonSource: z.enum(["template", "ai"]).optional(),
    sourceCombinationId: z.number().optional(),
    sourceCombinationIds: z.array(z.number()).optional(),
    matchedCombinationIds: z.array(z.number()).optional(),
    matchedSelectedCombinationIds: z.array(z.number()).optional(),
    sourceRegionCandidate: z.string().optional(),
    isRequiredBySelection: z.boolean().optional(),
    photoName: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    userRatingCount: z.number().nullable().optional(),
    businessStatus: z.string().nullable().optional(),
    openStatusLabel: z.string().optional(),
    todayHoursLabel: z.string().optional(),
  })
  .transform((raw) => ({
    name: raw.name,
    type: raw.type ?? "地點",
    ...(raw.primaryType != null ? { primaryType: raw.primaryType } : {}),
    types: raw.types,
    description: raw.description ?? "",
    reason: raw.reason ?? "",
    estimatedTime: raw.estimatedTime ?? "1-2 小時",
    address: raw.address ?? "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    googleMapsUrl: raw.googleMapsUrl ?? "",
    placeName: raw.placeName ?? raw.name,
    googlePlaceId: raw.googlePlaceId,
    reasonSource: raw.reasonSource ?? "template",
    sourceCombinationId: raw.sourceCombinationId,
    sourceCombinationIds: raw.sourceCombinationIds,
    matchedCombinationIds: raw.matchedCombinationIds,
    matchedSelectedCombinationIds: raw.matchedSelectedCombinationIds,
    sourceRegionCandidate: raw.sourceRegionCandidate,
    isRequiredBySelection: raw.isRequiredBySelection,
    photoName: raw.photoName,
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    businessStatus: raw.businessStatus,
    openStatusLabel: raw.openStatusLabel,
    todayHoursLabel: raw.todayHoursLabel,
  }));

const InputSchema = z.object({
  destination: z.string().min(1).max(100),
  days: z.number().int().min(1).max(14),
  budget: z.enum(["low", "medium", "high"]).default("medium"),
  style: z.string().max(120).optional().default(""),
  mood: z.string().max(120).optional().default(""),
  interests: z.string().max(4000).optional().default(""),
  conversationSummary: z.string().max(4000).optional().default(""),
  startDate: z.string().max(40).optional().default(""),
  endDate: z.string().max(40).optional().default(""),
  origin: z.string().max(120).optional().default(""),
  travelers: z.number().int().min(1).max(20).optional(),
  transport: z.string().max(120).optional().default(""),
  selectedPlaces: z.array(PlaceSchema).max(70).optional().default([]),
  selectedCombinationIds: z.array(z.number().int().positive()).max(10).optional().default([]),
  nearbyExtensions: z.array(z.string().max(80)).max(10).optional().default([]),
  excludedCategories: z.array(z.string().max(40)).max(30).optional().default([]),
  preferences: z.record(z.unknown()).optional(),
  location: z.object({ lat: z.number(), lng: z.number(), city: z.string().optional() }).optional(),
  weather: z.record(z.unknown()).nullable().optional(),
  time: z.string().optional(),
  /** 穿搭風格（文青、韓系、極簡等），來自個人檔案 */
  fashionStyle: z.string().max(80).optional().default(""),
  locale: z.enum(["zh-TW", "en", "ja", "ko"]).optional(),
});

function inferTripTransport(transport?: string): TripTransportMode {
  const t = (transport ?? "").toLowerCase();
  if (/機車|scooter|摩托/.test(t)) return "scooter";
  if (/開車|自驾|自駕|drive|car|租車/.test(t)) return "drive";
  if (/捷運|地鐵|地铁|大眾|公車|公交|transit|mrt|metro/.test(t)) return "transit";
  return "walk";
}

function filterValidSelectedPlaces(
  places: RoamieRecommendationItem[],
  destination: string,
): RoamieRecommendationItem[] {
  return preparePlacesForItineraryBuild(
    places.map((p) => ({
      ...p,
      placeId: p.googlePlaceId ?? (p as RoamieRecommendationItem & { placeId?: string }).placeId,
    })),
    destination,
  );
}

function enrichItineraryFromSelectedPlaces(
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
  destination: string,
): RoamieItineraryItem[] {
  const byId = new Map(
    selectedPlaces.filter((p) => p.googlePlaceId?.trim()).map((p) => [p.googlePlaceId!.trim(), p]),
  );
  const byName = new Map(selectedPlaces.map((p) => [(p.placeName ?? p.name).trim(), p]));

  return items
    .map((item) => {
      const name = (item.placeName ?? item.title).trim();
      if (!name || isGenericPlaceLabel(name, destination)) return null;

      const match =
        (item.googlePlaceId?.trim() && byId.get(item.googlePlaceId.trim())) ||
        byName.get(name) ||
        byName.get(item.title.trim());

      const enriched: RoamieItineraryItem = match
        ? {
            ...item,
            placeName: match.placeName ?? match.name,
            title: item.title?.trim() ? item.title : match.name,
            googlePlaceId: match.googlePlaceId,
            lat: match.lat,
            lng: match.lng,
            address: item.address?.trim() ? item.address : match.address,
            placeType: item.placeType || match.type,
            photoName: item.photoName ?? match.photoName,
            rating: item.rating ?? match.rating,
            userRatingCount: item.userRatingCount ?? match.userRatingCount,
            businessStatus: item.businessStatus ?? match.businessStatus,
            openStatusLabel: item.openStatusLabel || match.openStatusLabel,
            todayHoursLabel: item.todayHoursLabel || match.todayHoursLabel,
            types: item.types?.length ? item.types : match.type ? [match.type] : undefined,
            placeSnapshotSource: item.placeSnapshotSource ?? "selected_place",
            sourceCombinationId: item.sourceCombinationId ?? match.sourceCombinationId,
            matchedCombinationIds: item.matchedCombinationIds ?? match.matchedCombinationIds,
            matchedSelectedCombinationIds:
              item.matchedSelectedCombinationIds ?? match.matchedSelectedCombinationIds,
          }
        : item;

      if (
        !isValidItineraryStopPlace(
          {
            placeName: enriched.placeName,
            name: enriched.title,
            placeId: enriched.googlePlaceId,
            googlePlaceId: enriched.googlePlaceId,
            address: enriched.address,
            lat: enriched.lat,
            lng: enriched.lng,
          },
          destination,
        )
      ) {
        return null;
      }
      return enriched;
    })
    .filter((item): item is RoamieItineraryItem => item != null);
}

function buildItineraryFromSelectedPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  selectedCombinationIds?: number[],
): RoamieItineraryItem[] {
  return buildFallbackItineraryFromPlaces(selectedPlaces, days, startDate, destination, {
    selectedCombinationIds,
  });
}

function buildFallbackTripPayload(
  data: ItineraryInput,
  items: RoamieItineraryItem[],
  selectedPlaces: RoamieRecommendationItem[],
): RoamiePayloadV2 {
  const placeNames = selectedPlaces.map((p) => p.placeName ?? p.name).join("、");
  return {
    version: 2,
    title: `${data.destination} ${data.days} 天`,
    summary: `依你選的地點排成 ${data.days} 天節奏：${placeNames}`,
    moodTag: data.mood ?? "",
    recommendations: selectedPlaces,
    itinerary: items,
    destination: data.destination,
    days: data.days,
    generatedAt: new Date().toISOString(),
  };
}

export type ItineraryInput = z.infer<typeof InputSchema>;

/** @deprecated Legacy format — kept for backward-compatible trip display */
export type ItineraryBlock = {
  time: string;
  title: string;
  type: "place" | "food" | "transit" | "rest" | "experience";
  description: string;
  duration_minutes: number;
  estimated_cost: string;
  tags: string[];
};

export type ItineraryDay = {
  day: number;
  date?: string;
  theme: string;
  weather_note?: string;
  blocks: ItineraryBlock[];
  rainy_alternative?: string;
  estimated_daily_cost: string;
};

export type Itinerary = {
  title: string;
  destination: string;
  days: number;
  mood: string;
  summary: string;
  total_estimated_cost: string;
  transport_tips: string;
  daily_plan: ItineraryDay[];
};

export const generateItinerary = createServerFn({ method: "POST" })
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<GenerateItineraryResult> => {
    const [{ callRoamieAI }, { buildTransitLegsForItinerary }, { openWeatherGetForecast }] =
      await Promise.all([
        import("@/lib/ai/service.server"),
        import("@/lib/transit/build-legs.server"),
        import("@/lib/weather/openweather.server"),
      ]);
    const selectedPlaces = filterValidSelectedPlaces(
      (data.selectedPlaces ?? []) as RoamieRecommendationItem[],
      data.destination,
    );

    if (selectedPlaces.length < 1) {
      return {
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      };
    }

    if (selectedPlaces.length < data.days) {
      logAiPipeline(
        "[INSUFFICIENT_REAL_PLACES_DETECTED]",
        `tripDays=${data.days}`,
        `resolvedPlaces=${selectedPlaces.length}`,
        `minimumRequired=${data.days}`,
        "stage=generate_itinerary_entry",
      );
      return {
        success: false,
        errorCode: "insufficient_places",
        message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
      };
    }

    const interestsText = [data.interests, data.conversationSummary].filter(Boolean).join("\n\n");
    const startDate = data.startDate?.trim() || new Date().toISOString().slice(0, 10);
    const selectedCombinationIds = data.selectedCombinationIds ?? [];
    const requiredPlaceNames = selectedPlaces.map((p) => p.placeName ?? p.name);

    logAiPipeline("[SELECTED_COMBINATIONS_CONFIRMED]", `ids=[${selectedCombinationIds.join(",")}]`);
    logAiPipeline(
      "[SELECTED_PLACE_POOL_BUILT]",
      `count=${selectedPlaces.length}`,
      `places=[${requiredPlaceNames.join(",")}]`,
    );

    logAiPipeline(
      "[ITINERARY_PLANNER_START]",
      `destination=${data.destination}`,
      `days=${data.days}`,
      `selectedPlaces=${selectedPlaces.length}`,
      `selectedCombinationIds=${selectedCombinationIds.join(",")}`,
    );

    let ai: RoamiePayloadV2 | null = null;
    let usedDeterministic = false;

    // When the user locked combination selections, the deterministic geography-first
    // allocator is authoritative. AI may only rearrange; coverage failures rebuild.
    if (selectedCombinationIds.length > 0) {
      const builtItems = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      const coverageCheck = validateGeneratedItinerary({
        tripDays: data.days,
        startDate,
        selectedCombinationIds,
        days: groupStopsByTripDays(builtItems, data.days, startDate),
        resolvedPlaces: selectedPlaces,
        destination: data.destination,
      });
      if (coverageCheck.ok || builtItems.length >= selectedCombinationIds.length) {
        ai = buildFallbackTripPayload(data, builtItems, selectedPlaces);
        usedDeterministic = true;
        logAiPipeline(
          "[ITINERARY_BUILD_PATH]",
          "path=deterministic_selected_combinations",
          `places=${builtItems.length}`,
        );
      }
    }

    if (!ai) {
      try {
        const aiResponse: RoamieResponse = await callRoamieAI({
          mode: "itinerary",
          locale: data.locale,
          mood: data.mood,
          preferences: data.preferences as never,
          location: data.location,
          weather: data.weather as never,
          time: data.time,
          planningHints: {
            transportation: data.transport,
            budget: data.budget === "low" ? "省錢" : data.budget === "high" ? "舒適" : "適中",
            conversationSummary: data.conversationSummary,
          },
          itineraryRequest: {
            destination: data.destination,
            days: data.days,
            budget: data.budget,
            style: data.style,
            mood: data.mood,
            interests: interestsText,
            startDate: data.startDate,
            endDate: data.endDate,
            origin: data.origin,
            travelers: data.travelers,
            transport: data.transport,
            selectedPlaces,
            selectedCombinationIds,
          },
        });

        let rawItinerary = coalesceItineraryItems(aiResponse.itinerary);
        if (rawItinerary.length > 0) {
          const enrichedItinerary = enrichItineraryFromSelectedPlaces(
            rawItinerary,
            selectedPlaces,
            data.destination,
          );
          if (enrichedItinerary.length > 0) {
            const aiCoverage = validateGeneratedItinerary({
              tripDays: data.days,
              startDate,
              selectedCombinationIds,
              days: groupStopsByTripDays(enrichedItinerary, data.days, startDate),
              resolvedPlaces: selectedPlaces,
              destination: data.destination,
            });
            if (!aiCoverage.ok && selectedCombinationIds.length > 0) {
              logAiPipeline(
                "[ITINERARY_AI_COVERAGE_FAILED]",
                `reasons=${aiCoverage.reasons.join("|")}`,
              );
            } else {
              ai = {
                ...aiResponse,
                itinerary: enrichedItinerary,
              } as RoamiePayloadV2;
              logAiPipeline("[ITINERARY_BUILD_PATH]", "path=ai");
            }
          }
        }
      } catch (e) {
        console.warn("[Roamie] AI itinerary generation failed", e);
      }
    }

    if (!ai || coalesceItineraryItems(ai.itinerary).length < 1) {
      devVerboseInfo("[AI_ITINERARY_BUILD] building from selectedPlaces", {
        count: selectedPlaces.length,
        days: data.days,
      });
      const builtItems = buildItineraryFromSelectedPlaces(
        selectedPlaces,
        data.days,
        startDate,
        data.destination,
        selectedCombinationIds,
      );
      ai = buildFallbackTripPayload(data, builtItems, selectedPlaces);
      usedDeterministic = true;
      logAiPipeline(
        "[ITINERARY_BUILD_PATH]",
        "path=deterministic_fallback",
        `places=${builtItems.length}`,
      );
    }

    // Global landmark dedupe must run before final day geography is trusted.
    // For AI paths that already assigned dates, rebuild via deterministic allocator
    // when nearby main/sub landmarks remain or selected coverage is incomplete.
    {
      const itemToPlace = (item: RoamieItineraryItem): PlaceResult =>
        ({
          id: item.googlePlaceId?.trim() || item.placeName || item.title,
          name: item.placeName || item.title,
          address: item.address ?? null,
          lat: item.lat ?? null,
          lng: item.lng ?? null,
          rating: item.rating ?? null,
          userRatingCount: item.userRatingCount ?? null,
          photoName: item.photoName ?? null,
          primaryType: item.placeType ?? null,
          types: item.types ?? (item.placeType ? [item.placeType] : null),
          businessStatus: item.businessStatus ?? null,
          openStatus: "unknown",
          openStatusLabel: item.openStatusLabel ?? "",
          todayHoursLabel: item.todayHoursLabel ?? "",
          closingSoonNote: "",
          nextOpenHint: "",
        }) as unknown as PlaceResult;

      const current = coalesceItineraryItems(ai.itinerary);
      const { kept, removed } = dedupeLandmarkItems(current, itemToPlace);
      if (removed.length) {
        for (const r of removed) {
          logAiPipeline(
            "[SELECTED_PLACE_MERGED]",
            `source=${r.item.placeName ?? r.item.title}`,
            `representative=${kept.find((k) => k.googlePlaceId === r.item.googlePlaceId)?.placeName ?? "cluster"}`,
            `reason=${r.reason}`,
          );
          logAiPipeline(
            "[DUPLICATE_LANDMARK_REMOVED]",
            `day=${(r.item.dayIndex ?? 0) + 1}`,
            `place=${r.item.placeName ?? r.item.title}`,
            `reason=${r.reason}`,
          );
        }
        logAiPipeline("[ITINERARY_TIMELINE_RECALCULATED]", `removedPlaceCount=${removed.length}`);
        ai = { ...ai, itinerary: kept };
      }

      const dateOrder: string[] = [];
      for (const item of kept) {
        const d = item.date?.trim();
        if (d && !dateOrder.includes(d)) dateOrder.push(d);
      }
      const entries = kept.map((item) => ({
        place: itemToPlace(item),
        day:
          item.dayIndex != null
            ? item.dayIndex + 1
            : Math.max(1, dateOrder.indexOf(item.date?.trim() ?? "") + 1),
      }));
      const geoCheck = validateCrossDayGeographicAllocation(entries, data.days);
      if (!geoCheck.ok && !usedDeterministic) {
        logAiPipeline(
          "[ITINERARY_GEOGRAPHIC_REALLOCATION]",
          `reason=nearby_places_split_across_days`,
          `details=${geoCheck.reasons.join("|")}`,
        );
        // Rebuild with geography-first allocator instead of keeping a broken AI layout.
        const rebuilt = buildItineraryFromSelectedPlaces(
          selectedPlaces,
          data.days,
          startDate,
          data.destination,
          selectedCombinationIds,
        );
        ai = buildFallbackTripPayload(data, rebuilt, selectedPlaces);
        usedDeterministic = true;
      } else if (!geoCheck.ok) {
        logAiPipeline(
          "[ITINERARY_GEOGRAPHIC_REALLOCATION]",
          `reason=nearby_places_split_across_days`,
          `details=${geoCheck.reasons.join("|")}`,
        );
      }
    }

    let finalStops = coalesceItineraryItems(ai.itinerary);
    const requiredAnchors = buildRequiredAnchorPlaces({
      selectedPlaceNames: requiredPlaceNames,
      placeIdsByName: Object.fromEntries(
        selectedPlaces
          .filter((p) => (p.placeName ?? p.name) && p.googlePlaceId)
          .map((p) => [p.placeName ?? p.name, p.googlePlaceId!]),
      ),
    });
    const selectedLock = buildSelectedPlaceLock({ anchors: requiredAnchors });
    const integrity = validateFinalItineraryIntegrity({
      selectedCombinationIds,
      sessionSelectedCombinationIds: selectedCombinationIds,
      requiredPlaceNames,
      scheduledStops: finalStops,
      resolvedPlaces: selectedPlaces,
      tripDays: data.days,
      startDate,
      destination: data.destination,
    });
    const recommendationIntegrity = recommendationIntegrityCheck({
      selectedPlaces: requiredPlaceNames,
      anchors: requiredAnchors,
      scheduledPlaceNames: finalStops.map((s) => s.placeName ?? s.title),
    });
    const delivery = plannerDeliveryCheck({
      integrity: recommendationIntegrity,
      validatorOk: integrity.ok || selectedCombinationIds.length === 0,
      qualityGateOk: true,
      routeOk: true,
    });

    logAiPipeline(
      "[ITINERARY_SAVE_STATS]",
      `expectedPlaces=${selectedPlaces.length}`,
      `savedPlaces=${finalStops.length}`,
      `integrityOk=${integrity.ok}`,
      `recommendationIntegrityOk=${recommendationIntegrity.ok}`,
      `coveragePercent=${recommendationIntegrity.coveragePercent}`,
      `delivery=${delivery.deliveryResult}`,
    );

    if (
      (!integrity.ok || !recommendationIntegrity.ok || !delivery.ok) &&
      selectedCombinationIds.length > 0
    ) {
      // Hard gate: do not persist a half-built selected-combination itinerary.
      const critical = [
        ...integrity.reasons.filter(
          (r) =>
            r.startsWith("fallback_over_selected") ||
            r.startsWith("silent_drop") ||
            r.startsWith("unselected_combination_place") ||
            r.startsWith("missing_combination") ||
            r.startsWith("empty_day") ||
            r.startsWith("empty_non_free_day") ||
            r.startsWith("insufficient_real_places"),
        ),
        ...recommendationIntegrity.reasons,
        ...delivery.reasons.filter((r) => r.startsWith("missing_") || r.startsWith("coverage")),
      ];
      if (critical.length || !recommendationIntegrity.ok) {
        logAiPipeline(
          "[ITINERARY_INTEGRITY_BLOCKED_SAVE]",
          `reasons=${critical.join("|") || recommendationIntegrity.reasons.join("|")}`,
          `coveragePercent=${recommendationIntegrity.coveragePercent}`,
        );
        return {
          success: false,
          errorCode: "itinerary_integrity_failed",
          message: INSUFFICIENT_ITINERARY_PLACES_MESSAGE,
        };
      }
    }

    // P4.2：Itinerary Validator — direct / selected_places 建立路徑
    if (isItineraryValidatorEnabled()) {
      const composed = composedPlansFromItineraryItems(finalStops, data.days, startDate);
      const plannerDayCounts = dayCountsOfPlans(composed);
      const styleKey = resolvePlannerStyleKey(data.style);
      const creationPath = selectedCombinationIds.length > 0 ? "selected_places" : "direct";
      logAiPipeline(
        "[ITINERARY_PLANNER_RESULT]",
        `success=true`,
        `stopCount=${finalStops.length}`,
        `dayCounts=${plannerDayCounts.join(",")}`,
        `path=${usedDeterministic ? "deterministic" : "ai"}`,
      );
      const validatorInputBase: Omit<ItineraryValidatorInput, "plans"> = {
        requestedDays: data.days,
        style: styleKey,
        plannedDate: startDate,
        endDate: data.endDate?.trim() || undefined,
        nearbyExtensions: data.nearbyExtensions,
        excludedCategories: data.excludedCategories,
        userText: [data.interests, data.conversationSummary].filter(Boolean).join("\n"),
        destination: data.destination,
        creationPath: creationPath as ItineraryValidatorInput["creationPath"],
        lockedPlaceIds: [...selectedLock.placeIds],
        lockedPlaceNames: selectedLock.names,
      };
      let validation = validateItineraryPlan({
        plans: composed,
        ...validatorInputBase,
      });
      if (!validation.pass) {
        const pool: PlaceResult[] = selectedPlaces.map((p) => ({
          id: (p.googlePlaceId ?? p.name).trim(),
          name: p.placeName ?? p.name,
          address: p.address ?? null,
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          rating: p.rating ?? null,
          userRatingCount: p.userRatingCount ?? null,
          photoName: p.photoName ?? null,
          primaryType: p.type ?? null,
          types: p.type ? [p.type] : null,
          businessStatus: null,
          openStatus: "unknown",
          openStatusLabel: "",
          todayHoursLabel: "",
          closingSoonNote: "",
          nextOpenHint: "",
          openNow: null,
        }));
        const replanned = replanUntilItineraryValid(
          {
            plans: composed as unknown as ComposedDayPlan[],
            pool,
            days: data.days,
            style: styleKey,
            plannedDate: startDate,
            nearbyExtensions: data.nearbyExtensions,
            validatorInput: validatorInputBase,
          },
          validation,
        );
        validation = replanned.validation;
        if (replanned.plans.length) {
          finalStops = applyComposedPlansToItineraryItems(finalStops, replanned.plans, startDate);
          ai = { ...ai, itinerary: finalStops };
        }
      }
      if (shouldBlockItineraryDelivery(validation)) {
        logItineraryDeliveryBlocked("validator_failed", validation);
        return {
          success: false,
          errorCode: "itinerary_validator_failed",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
          failureReason: "validator_failed",
          failedRules: validation.failedRules.map((rule) => rule.code),
          diagnostics: {
            affectedDays: validation.affectedDays,
            dayCount: data.days,
            stopCount: finalStops.length,
            details: validation.failedRules.map((rule) => rule.message),
          },
        };
      }
      const finalDayCounts = dayCountsOfPlans(
        composedPlansFromItineraryItems(finalStops, data.days, startDate),
      );
      const compare = compareItineraryPersistenceDayCounts({
        plannerDayCounts: finalDayCounts,
        validatedDayCounts: finalDayCounts,
        persistedDayCounts: finalDayCounts,
        uiDayCounts: finalDayCounts,
      });
      if (!compare.matched) {
        logItineraryDeliveryBlocked("persistence_mismatch", validation);
        return {
          success: false,
          errorCode: "persistence_mismatch",
          message: ITINERARY_VALIDATOR_BLOCKED_USER_MESSAGE,
        };
      }
      logItineraryDeliveryAllowed(validation, finalDayCounts);
    } else {
      logAiPipeline(
        "[ITINERARY_PLANNER_RESULT]",
        `success=true`,
        `stopCount=${finalStops.length}`,
        `path=${usedDeterministic ? "deterministic" : "ai"}`,
      );
    }

    logAiPipeline(
      "[ITINERARY_SAVE_RESULT]",
      "success=true",
      `stops=${finalStops.length}`,
      `days=${data.days}`,
    );

    const dayStats = groupStopsByTripDays(finalStops, data.days, startDate)
      .map((d, i) => `day${i + 1}=${d.places.length}`)
      .join(" ");
    logAiPipeline("[DAILY_ALLOCATION_STATS]", dayStats);

    const lat = data.location?.lat;
    const lng = data.location?.lng;

    let outfitAdvice: RoamiePayloadV2["outfitAdvice"];
    if (lat != null && lng != null) {
      try {
        const forecast = await openWeatherGetForecast(lat, lng, data.days);
        outfitAdvice = await buildOutfitAdviceForTrip({
          destination: data.destination,
          startDate,
          days: data.days,
          forecast,
          itinerary: ai.itinerary,
          fashionStyle: data.fashionStyle || undefined,
          mood: data.mood || undefined,
        });
      } catch (e) {
        console.warn("[Roamie] outfit advice skipped", e);
      }
    }

    let tripSettings: RoamiePayloadV2["tripSettings"];
    try {
      const weatherHint = data.weather as {
        condition?: string;
        precipProbability?: number;
        tempC?: number;
        feelsLikeC?: number;
        isDaytime?: boolean;
        uvi?: number;
      } | null;
      const temp = weatherHint?.feelsLikeC ?? weatherHint?.tempC;
      const transit = await buildTransitLegsForItinerary({
        items: ai.itinerary.map((i) => ({
          placeName: i.placeName,
          title: i.title,
          lat: i.lat,
          lng: i.lng,
          date: i.date,
          time: i.time,
        })),
        destination: data.destination,
        preferences: {
          transportation: data.transport,
          pace: data.preferences?.pace as string | undefined,
        },
        weather: weatherHint
          ? {
              ...weatherHint,
              isRainy:
                (weatherHint.precipProbability ?? 0) >= 40 ||
                (weatherHint.condition ?? "").includes("雨"),
              isHot: temp != null && temp >= 32,
              isNight: weatherHint.isDaytime === false,
              uvi: weatherHint.uvi ?? null,
            }
          : undefined,
        time: data.time,
        useAiReasons: true,
      });
      const pace = resolvePlannerPaceFromProfile({
        style: resolvePlannerStyleKey(data.style),
        quizPace: data.preferences?.pace as "slow" | "medium" | "active" | null,
      });
      const localizedGate = applyItineraryLocalizationGate(coalesceItineraryItems(ai.itinerary), {
        softPassEnglish: true,
      });
      ai = { ...ai, itinerary: localizedGate.items };
      const seededLegMinutes = buildLegMinutesFromPlaces(localizedGate.items, pace);
      tripSettings = {
        startTime: data.time
          ? normalizeTime(data.time)
          : (coalesceItineraryItems(ai.itinerary)[0]?.time?.slice(0, 5) ?? "09:30"),
        tripStartDate: data.startDate?.trim() || startDate,
        tripEndDate: data.endDate?.trim() || data.startDate?.trim() || startDate,
        transport: inferTripTransport(data.transport),
        legMinutes: seededLegMinutes,
        transitLegs: Object.fromEntries(transit.legs.map((l) => [l.legKey, l])),
        transportTips: transit.transportTips,
      };
    } catch (e) {
      console.warn("[Roamie] transit legs skipped on generate", e);
    }

    const gated = applyItineraryLocalizationGate(coalesceItineraryItems(ai.itinerary), {
      softPassEnglish: true,
    });
    const itineraryItems = gated.items;
    const paceForLegs = resolvePlannerPaceFromProfile({
      style: resolvePlannerStyleKey(data.style),
      quizPace: data.preferences?.pace as "slow" | "medium" | "active" | null,
    });
    if (!tripSettings) {
      tripSettings = {
        startTime: coalesceItineraryItems(itineraryItems)[0]?.time?.slice(0, 5) ?? "09:30",
        tripStartDate: data.startDate?.trim() || startDate,
        tripEndDate: data.endDate?.trim() || data.startDate?.trim() || startDate,
        transport: inferTripTransport(data.transport),
        legMinutes: buildLegMinutesFromPlaces(itineraryItems, paceForLegs),
      };
    } else if (!tripSettings.legMinutes || !Object.keys(tripSettings.legMinutes).length) {
      tripSettings = {
        ...tripSettings,
        legMinutes: buildLegMinutesFromPlaces(itineraryItems, paceForLegs),
      };
    }
    const payload: RoamiePayloadV2 = {
      ...ai,
      version: 2,
      destination: data.destination,
      days: data.days,
      generatedAt: new Date().toISOString(),
      outfitAdvice,
      tripSettings,
      itinerary: itineraryItems,
    };

    return {
      success: true,
      trip: {
        id: `trip-${Date.now()}`,
        title: payload.title || `${data.destination} ${data.days} 天`,
        destination: data.destination,
        days: data.days,
        itinerary: groupItineraryItemsByDay(itineraryItems, startDate),
        payload,
      },
    };
  });
