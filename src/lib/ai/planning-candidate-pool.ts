import type { PlaceResult } from "@/lib/place-result";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import {
  buildComposedDayPlans,
  ensureAllDayPlansExist,
  isItineraryRenderable,
  minItemsPerDayForTrip,
  preferBetterComposedPlans,
  rebuildIncompleteDays,
  validateGeneratedDays,
  type ComposedDayPlan,
  type GeneratedDaysValidation,
} from "@/lib/ai/ai-day-plan-source";
import { minCandidatePoolSize, dedupeCandidatePlaces, isPlannerPoolReady } from "@/lib/ai/ai-multi-day-planner";
import { filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";
import { buildLocalLifeCityFallbackPlaces } from "@/lib/ai/ai-local-life-rules";
import { buildNamedFallbackRecommendations } from "@/lib/ai/must-visit-places";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  buildLocalClassicLandmarkPool,
  buildSyntheticClassicLandmarkPlace,
  logAiPlacesRateLimitFallback,
  mergeClassicLandmarkCaches,
  persistClassicLandmarkCaches,
} from "@/lib/places-classic-landmark-cache";

export { logAiPlacesRateLimitFallback };

export const MAX_DAY_PLAN_CACHE_REBUILDS = 3;

export function logAiCandidatePoolReused(count: number, source: string): void {
  logAiPipeline("[AI_CANDIDATE_POOL_REUSED]", { count, source });
}

export function logAiDayPlanRebuildFromCache(
  attempt: number,
  dayCounts: Record<number, number>,
): void {
  logAiPipeline("[AI_DAY_PLAN_REBUILD_FROM_CACHE]", { attempt, dayCounts });
}

export function shouldSkipPlanningPlacesApi(): boolean {
  // Soft budget / brief cooldown must wait and resume — never hard-skip mid discovery.
  // Sticky "encountered" alone must not abort a new generation.
  return false;
}

/** Wait out a short Places cooldown instead of returning empty combinations. */
export async function waitIfPlacesRateLimited(opts?: {
  generationRequestId?: string;
  maxWaitMs?: number;
}): Promise<"ready" | "timeout" | "stale"> {
  const {
    waitForPlacesGenerationCooldown,
    isPlacesRateLimited,
    getActivePlacesGenerationRequestId,
  } = await import("@/lib/places-api-guard");
  const { logAiPipeline } = await import("@/lib/ai/ai-pipeline-log");
  const maxWaitMs = opts?.maxWaitMs ?? 20_000;
  const started = Date.now();
  let waited = false;
  while (isPlacesRateLimited()) {
    if (
      opts?.generationRequestId &&
      getActivePlacesGenerationRequestId() &&
      getActivePlacesGenerationRequestId() !== opts.generationRequestId
    ) {
      return "stale";
    }
    if (Date.now() - started > maxWaitMs) return "timeout";
    waited = true;
    logAiPipeline(
      "[PLACES_COOLDOWN_WAIT]",
      `generationRequestId=${opts?.generationRequestId ?? "—"}`,
      `waitMs=${Math.max(0, generationWaitRemaining())}`,
    );
    await waitForPlacesGenerationCooldown();
  }
  if (waited) {
    logAiPipeline(
      "[PLACES_COOLDOWN_RESUMED]",
      `generationRequestId=${opts?.generationRequestId ?? "—"}`,
    );
  }
  return "ready";
}

function generationWaitRemaining(): number {
  // Best-effort; waitForPlacesGenerationCooldown is the real gate.
  return 1000;
}

function dedupePlaces(places: PlaceResult[]): PlaceResult[] {
  return dedupeCandidatePlaces(places);
}

function minPoolSize(days: number): number {
  return minCandidatePoolSize(days);
}

export function mergePlanningCandidatePool(params: {
  label: string;
  style: TripStyleKey;
  places: PlaceResult[];
  lat: number;
  lng: number;
  days: number;
}): PlaceResult[] {
  const { label, style, places, lat, lng, days } = params;
  const minNeeded = minPoolSize(days);
  let pool = dedupePlaces(places);

  const cached = mergeClassicLandmarkCaches(label, style);
  if (cached?.length) {
    logAiCandidatePoolReused(cached.length, "session_or_daily_cache");
    pool = dedupePlaces([...pool, ...cached]);
  }

  if (pool.length < minNeeded) {
    const localLandmarks = buildLocalClassicLandmarkPool({
      destination: label,
      days,
      lat,
      lng,
      minCount: minNeeded,
    });
    if (localLandmarks.length) {
      logAiCandidatePoolReused(localLandmarks.length, "local_landmark_pool");
      pool = dedupePlaces([...pool, ...localLandmarks]);
    }
  }

  if (pool.length < minNeeded && style === "local_life") {
    const existingNames = new Set(pool.map((p) => (p.name ?? "").trim()).filter(Boolean));
    const localLife = buildLocalLifeCityFallbackPlaces({
      destination: label,
      lat,
      lng,
      minCount: minNeeded,
      existingNames,
    });
    if (localLife.length) {
      logAiCandidatePoolReused(localLife.length, "local_life_city_fallback");
      pool = dedupePlaces([...pool, ...localLife]);
    }
  }

  if (pool.length < minNeeded) {
    const named = buildNamedFallbackRecommendations(label);
    const synthetics = named.map((rec, index) =>
      buildSyntheticClassicLandmarkPlace({
        name: rec.name,
        destination: label,
        lat,
        lng,
        index: index + pool.length,
      }),
    );
    if (synthetics.length) {
      logAiCandidatePoolReused(synthetics.length, "named_city_fallback");
      pool = dedupePlaces([...pool, ...synthetics]);
    }
  }

  return filterRealPlanningPlaces(pool);
}

export function persistPlanningCandidatePool(
  label: string,
  style: TripStyleKey,
  places: PlaceResult[],
): void {
  if (!places.length) return;
  persistClassicLandmarkCaches(normalizeDestinationLabel(label), style, places);
}

function dayCountsFromPlans(plans: ComposedDayPlan[], days: number): Record<number, number> {
  return Object.fromEntries(
    ensureAllDayPlansExist(plans, days).map((plan) => [plan.day, plan.entries.length]),
  ) as Record<number, number>;
}

export function rebuildDayPlansFromCandidatePool(params: {
  composedPlans: ComposedDayPlan[];
  candidatePool: PlaceResult[];
  style: TripStyleKey;
  label: string;
  days: number;
  plannedDate?: string;
  lat?: number;
  lng?: number;
}): ComposedDayPlan[] {
  const { composedPlans, candidatePool, style, label, days, plannedDate } = params;
  const original = ensureAllDayPlansExist(composedPlans, days);
  if (isItineraryRenderable(original, days, style)) {
    return original;
  }
  let current = original;
  let validation = validateGeneratedDays(current, days, style);

  for (let attempt = 1; !validation.ok && attempt <= MAX_DAY_PLAN_CACHE_REBUILDS; attempt += 1) {
    logAiDayPlanRebuildFromCache(attempt, dayCountsFromPlans(current, days));

    if (validation.incompleteDays.length) {
      const rebuilt = rebuildIncompleteDays(
        current,
        validation.incompleteDays,
        candidatePool,
        style,
        label,
        days,
      );
      current = preferBetterComposedPlans(
        ensureAllDayPlansExist(rebuilt, days),
        current,
        days,
        style,
      );
    }

    const realPool = filterRealPlanningPlaces(candidatePool);
    if (isPlannerPoolReady(realPool, days)) {
      const replanned = ensureAllDayPlansExist(
        buildComposedDayPlans({
          places: realPool,
          days,
          style,
          destination: label,
          plannedDate,
          lat: params.lat,
          lng: params.lng,
        }),
        days,
      );
      current = preferBetterComposedPlans(replanned, current, days, style);
    }

    validation = validateGeneratedDays(current, days, style);
  }

  return preferBetterComposedPlans(current, original, days, style);
}

export function ensureRenderableStyleDayPlans(params: {
  composedPlans: ComposedDayPlan[];
  places: PlaceResult[];
  style: TripStyleKey;
  label: string;
  days: number;
  lat: number;
  lng: number;
  plannedDate?: string;
}): { composedPlans: ComposedDayPlan[]; candidatePool: PlaceResult[]; validation: GeneratedDaysValidation } {
  const { style, label, days, lat, lng, plannedDate } = params;

  persistPlanningCandidatePool(label, style, params.places);
  let candidatePool = mergePlanningCandidatePool({
    label,
    style,
    places: params.places,
    lat,
    lng,
    days,
  });

  const normalizedInput = ensureAllDayPlansExist(params.composedPlans, days);
  if (isItineraryRenderable(normalizedInput, days, style)) {
    return {
      composedPlans: normalizedInput,
      candidatePool,
      validation: validateGeneratedDays(normalizedInput, days, style),
    };
  }

  let composedPlans = rebuildDayPlansFromCandidatePool({
    composedPlans: params.composedPlans,
    candidatePool,
    style,
    label,
    days,
    plannedDate,
    lat,
    lng,
  });
  composedPlans = preferBetterComposedPlans(
    ensureAllDayPlansExist(composedPlans, days),
    ensureAllDayPlansExist(params.composedPlans, days),
    days,
    style,
  );

  let validation = validateGeneratedDays(composedPlans, days, style);
  if (!validation.ok && !isItineraryRenderable(composedPlans, days, style)) {
    logAiPlacesRateLimitFallback(
      `local_city_day_plan pool=${candidatePool.length} reasons=${validation.reasons.join(",")}`,
    );
    candidatePool = mergePlanningCandidatePool({
      label,
      style,
      places: candidatePool,
      lat,
      lng,
      days,
    });
    const rebuilt = buildComposedDayPlans({
      places: candidatePool,
      days,
      style,
      destination: label,
      plannedDate,
      lat,
      lng,
    });
    composedPlans = preferBetterComposedPlans(
      ensureAllDayPlansExist(rebuilt, days),
      composedPlans,
      days,
      style,
    );
    validation = validateGeneratedDays(composedPlans, days, style);
  }

  return { composedPlans, candidatePool, validation };
}
