/**
 * Itinerary Auto Repair Flow
 *
 * Validator 失敗且僅為可修復問題時（timeline / hours / balance…）：
 * 1. 重新排列同一天順序（去重時間 + 路線組裝）
 * 2. 將晚間景點移到白天（博物館／文創等）
 * 3. 將營業時間衝突地點替換為同類型附近景點
 * 4. 跨天重新分配 Stop
 * 5. 再次 Validator
 *
 * 最多 {@link MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS} 次。
 * Soft-only 失敗或 ≥80% stop 仍可用 → soft-pass 交付，不整份報廢。
 */

import type { ComposedDayPlan, DayPlanEntry } from "@/lib/ai/ai-day-plan-source";
import {
  classifyPlanPlaceKind,
  ensureAllDayPlansExist,
  flattenComposedDayPlanPlaces,
  resolveEntryLabel,
} from "@/lib/ai/ai-day-plan-source";
import {
  dedupeEntryTimes,
  repairDayPlanSlots,
} from "@/lib/ai/ai-day-plan-slot-rules";
import {
  redistributePlacesEvenly,
  repairTripDuplicatePlaces,
  ensureDayPlansMeetMinimum,
} from "@/lib/ai/ai-multi-day-planner";
import { dedupeByCanonicalLandmark } from "@/lib/ai/canonical-landmark";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { applyPlannerRouteAndCapacityAssembly } from "@/lib/ai/planner-day-route-assembly";
import type { TripStyleKey } from "@/lib/ai/ai-trip-style";
import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { isClearlyClosedAtSlot } from "@/lib/ai/itinerary-validator/place-checks";
import {
  SOFT_PASS_MIN_PLACES_PER_FULL_DAY,
  SOFT_REPAIRABLE_RULE_CODES,
  MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS,
  type ItineraryValidationResult,
  type ItineraryValidatorInput,
  type SoftPassQualityCheck,
} from "@/lib/ai/itinerary-validator/types";
import {
  dayCountsOfPlans,
  hasHardBlockFailures,
  hasUnrepairableHardBlockFailures,
  validateItineraryPlan,
} from "@/lib/ai/itinerary-validator/validate";
import { evaluateTourismQuality } from "@/lib/ai/tourism-quality-gate";
import {
  asComposedDayPlans,
  ensureAllDaysCovered,
  evaluateDayCoverageGate,
  normalizeCompleteDayMap,
  repairDailyDiversityByMove,
} from "@/lib/ai/itinerary-day-coverage";
import {
  buildItineraryQualitySummary,
  logItineraryQualitySummary,
} from "@/lib/ai/itinerary-quality-summary";
import { resolvePlaceDisplayName } from "@/lib/place-display-name";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import {
  evaluateRouteNavigabilityGate,
  findNavigableReplacement,
  logRouteNavigabilityGate,
} from "@/lib/ai/route-navigability-gate";
import { checkStopNavigationIdentity } from "@/lib/saved-trip/stop-navigation";
import {
  isPlaceLocked,
  buildSelectedPlaceLock,
  type SelectedPlaceLock,
} from "@/lib/ai/required-anchor-runtime";
import { resolveNightlifeClassification } from "@/lib/ai/nightlife-classification";
import {
  assessRepairProgress,
  buildItineraryPlanSignature,
  resolveRepairRoundStopReason,
  shortRepairFingerprint,
} from "@/lib/ai/itinerary-validator/repair-progress";
import {
  degradeDiversityFailureToWarning,
  evaluateDiversityDegradationEvidence,
} from "@/lib/ai/itinerary-validator/diversity-degradation";

export type ItineraryReplanParams = {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  nearbyExtensions?: string[];
  validatorInput: Omit<ItineraryValidatorInput, "plans">;
};

function lockFromValidatorInput(
  input: Omit<ItineraryValidatorInput, "plans"> | undefined,
): SelectedPlaceLock | null {
  if (!input?.lockedPlaceIds?.length && !input?.lockedPlaceNames?.length) return null;
  return buildSelectedPlaceLock({
    selectedPlaceNames: [...(input.lockedPlaceNames ?? [])],
    placeIds: [...(input.lockedPlaceIds ?? [])],
  });
}

function isLockedEntry(entry: DayPlanEntry, lock: SelectedPlaceLock | null): boolean {
  if (!lock) return false;
  return isPlaceLocked(
    {
      name: entry.name,
      placeName: entry.place.name,
      id: entry.place.id,
      googlePlaceId: entry.place.id,
    },
    lock,
  );
}

export type ItineraryReplanOutcome = {
  plans: ComposedDayPlan[];
  validation: ItineraryValidationResult;
  attempts: number;
  stopReason:
    | "success"
    | "max_rounds"
    | "no_progress"
    | "cycle_detected"
    | "unrepaired_failure";
  noProgress: boolean;
  cycleDetected: boolean;
};

const DAYTIME_SLOTS = ["09:30", "10:30", "11:00", "14:00", "15:00", "16:00", "16:30"];
const EVENING_MINUTES = 19 * 60;
const MUSEUM_CULTURE_RE =
  /museum|art_gallery|gallery|美術館|博物館|文學館|藝術中心|展覽館|文學公園/i;
const REPLACE_RADIUS_M = 8_000;

function parseMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function placeIdOf(place: PlaceResult): string {
  return (place.id ?? "").trim() || (place.name ?? "").trim().toLowerCase();
}

function primaryTypeOf(place: PlaceResult): string {
  return (place.primaryType ?? place.types?.[0] ?? "tourist_attraction").toLowerCase();
}

function isDaytimeOnlyPlace(place: PlaceResult): boolean {
  const blob = [place.name, place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ");
  return MUSEUM_CULTURE_RE.test(blob);
}

/** 1. 同日重排：去重衝突時間 + 路線組裝 */
function repairReorderSameDay(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  nearbyExtensions?: string[],
): ComposedDayPlan[] {
  let current = ensureAllDayPlansExist(plans, days).map((plan) => ({
    ...plan,
    entries: dedupeEntryTimes(
      [...plan.entries].sort((a, b) => parseMinutes(a.time) - parseMinutes(b.time)),
    ),
  }));

  try {
    const assembled = applyPlannerRouteAndCapacityAssembly({
      plans: current,
      pool,
      days,
      style,
      nearbyExtensions,
    });
    current = ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], days).map(
      (plan) => ({
        ...plan,
        entries: dedupeEntryTimes(plan.entries),
      }),
    );
  } catch {
    /* keep current */
  }

  logAiPipeline("[ITINERARY_AUTO_REPAIR]", "step=reorder_same_day");
  return current;
}

const LONG_LEG_REPAIR_M = 15_000;

/** Remove non-tourism / low-value stops; localize remaining names. */
function repairRemoveLowValueAndLocalize(
  plans: ComposedDayPlan[],
  days: number,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  let removed = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries: DayPlanEntry[] = [];
    for (const entry of plan.entries) {
      if (!isLockedEntry(entry, lock) && !evaluateTourismQuality(entry.place).ok) {
        removed += 1;
        continue;
      }
      const resolved = resolvePlaceDisplayName(
        {
          name: entry.place.name ?? entry.name,
          originalName: entry.place.originalName ?? entry.place.name ?? entry.name,
          placeId: entry.place.id,
          canonicalPlaceId: entry.place.id,
          types: entry.place.types,
          primaryType: entry.place.primaryType,
        },
        effectiveAppLocale(),
      );
      const place: PlaceResult = {
        ...entry.place,
        name: resolved.localizedDisplayName,
        originalName: resolved.originalName,
        localizedDisplayName: resolved.localizedDisplayName,
        languageCode: resolved.languageCode,
        localizationSource: resolved.localizationSource,
      };
      entries.push({
        ...entry,
        name: resolved.localizedDisplayName,
        place,
      });
    }
    return { ...plan, entries };
  });
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=remove_low_value_and_localize",
    `removed=${removed}`,
    `lockedProtected=${Boolean(lock)}`,
  );
  return current;
}

/** Enforce daily category diversity — move violators to other days (do not drop). */
function repairDailyCategoryDiversity(
  plans: ComposedDayPlan[],
  days: number,
  style: TripStyleKey,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const moved = repairDailyDiversityByMove({
    plans,
    tripDays: days,
    style,
    lock,
  });
  // Coverage may have been disturbed by moves — re-cover empty days.
  const covered = ensureAllDaysCovered({
    plans: moved.plans,
    tripDays: days,
    style,
    lock,
    source: "daily_diversity_repair",
  });
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=daily_category_diversity",
    `moved=${moved.moved}`,
    `dropped=0`,
  );
  return asComposedDayPlans(covered.plans);
}

/** Peel from heaviest days into empty days until minimum coverage. */
function repairEmptyDays(
  plans: ComposedDayPlan[],
  days: number,
  partialDays: readonly number[] | undefined,
  lock: SelectedPlaceLock | null,
): ComposedDayPlan[] {
  const before = dayCountsOfPlans(plans);
  const covered = ensureAllDaysCovered({
    plans,
    tripDays: days,
    partialDays,
    lock,
    source: "auto_repair_empty_days",
  });
  const after = dayCountsOfPlans(asComposedDayPlans(covered.plans));
  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_empty_days",
    `before=${before.join(",")}`,
    `after=${after.join(",")}`,
    `remainingEmpty=${covered.emptyDaysRemaining.join(",") || "(none)"}`,
  );
  return asComposedDayPlans(covered.plans);
}

/**
 * Long-leg / geo repair: move the farther stop to another day with nearer cluster,
 * or drop when no better day exists. Prefer not masking with transport-mode changes.
 */
function repairLongRouteLegs(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  const current = ensureAllDayPlansExist(plans, days).map((p) => ({
    ...p,
    entries: [...p.entries],
  }));
  let moved = 0;

  for (const plan of current) {
    if (plan.entries.length < 2) continue;
    const toMove: DayPlanEntry[] = [];
    const stay: DayPlanEntry[] = [plan.entries[0]!];

    for (let i = 1; i < plan.entries.length; i++) {
      const prev = stay[stay.length - 1]!;
      const curr = plan.entries[i]!;
      const a = prev.place;
      const b = curr.place;
      if (
        a.lat == null ||
        a.lng == null ||
        b.lat == null ||
        b.lng == null
      ) {
        stay.push(curr);
        continue;
      }
      const dist = distanceMeters(
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
      );
      if (dist > LONG_LEG_REPAIR_M) {
        toMove.push(curr);
      } else {
        stay.push(curr);
      }
    }

    plan.entries = stay;

    for (const entry of toMove) {
      if (entry.place.lat == null || entry.place.lng == null) continue;
      let bestDay: ComposedDayPlan | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const other of current) {
        if (other.day === plan.day) continue;
        const anchor = other.entries[0]?.place;
        if (anchor?.lat == null || anchor.lng == null) continue;
        const d = distanceMeters(
          { lat: entry.place.lat, lng: entry.place.lng },
          { lat: anchor.lat, lng: anchor.lng },
        );
        if (d < bestDist && d < LONG_LEG_REPAIR_M) {
          bestDist = d;
          bestDay = other;
        }
      }
      if (bestDay) {
        bestDay.entries.push(entry);
        moved += 1;
      }
      // else: drop the long-leg orphan rather than keep a zig-zag day
    }
  }

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_long_route_legs",
    `moved=${moved}`,
  );
  return current;
}

/**
 * Replace stops that lack placeId / use approx coords with nearby navigable pool places.
 * Syncs name + placeId + coords + types together (never name-only).
 */
function repairNonNavigableStops(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const usedIds = new Set<string>();
  for (const plan of plans) {
    for (const entry of plan.entries) {
      const id = entry.place.id?.trim();
      if (id) usedIds.add(id);
    }
  }

  let replaced = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries = plan.entries.map((entry) => {
      const identity = checkStopNavigationIdentity({
        placeName: entry.name,
        title: entry.name,
        localizedDisplayName: entry.place.localizedDisplayName,
        googlePlaceId: entry.place.id,
        lat: entry.place.lat,
        lng: entry.place.lng,
        navigationLatitude: entry.place.navigationLatitude,
        navigationLongitude: entry.place.navigationLongitude,
        coordinateSource: entry.place.coordinateSource,
        address: entry.place.address,
      }, { silent: true });
      if (identity.useForDirections && identity.placeId) return entry;
      // Selected Place Lock: never silently replace user-chosen anchors.
      if (isLockedEntry(entry, lock)) return entry;

      const replacement = findNavigableReplacement(entry.place, pool, usedIds);
      if (!replacement) return entry;

      const oldId = entry.place.id?.trim();
      if (oldId) usedIds.delete(oldId);
      usedIds.add(replacement.id.trim());
      replaced += 1;

      const display = resolvePlaceDisplayName(
        {
          name: replacement.localizedDisplayName ?? replacement.name,
          originalName: replacement.originalName ?? replacement.name,
          placeId: replacement.id,
          canonicalPlaceId: replacement.id,
          types: replacement.types,
          primaryType: replacement.primaryType,
        },
        effectiveAppLocale(),
      );

      return {
        ...entry,
        name: display.localizedDisplayName,
        place: {
          ...replacement,
          name: display.localizedDisplayName,
          localizedDisplayName: display.localizedDisplayName,
          originalName: display.originalName,
          languageCode: display.languageCode,
          localizationSource: display.localizationSource,
          coordinateSource: replacement.coordinateSource ?? "google_places",
        },
      };
    });
    return { ...plan, entries };
  });

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=repair_non_navigable_stops",
    `replaced=${replaced}`,
  );
  return current;
}

/** 2. 晚間景點移到白天（博物館／文創等不應排在 19:00+） */
function repairMoveEveningToDaytime(plans: ComposedDayPlan[], days: number): ComposedDayPlan[] {
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const used = new Set(plan.entries.map((e) => parseMinutes(e.time)));
    const entries: DayPlanEntry[] = plan.entries.map((entry) => {
      const minutes = parseMinutes(entry.time);
      if (minutes < EVENING_MINUTES || !isDaytimeOnlyPlace(entry.place)) {
        return entry;
      }
      const slot =
        DAYTIME_SLOTS.find((t) => !used.has(parseMinutes(t))) ??
        formatMinutes(Math.max(10 * 60, minutes - 6 * 60));
      used.delete(minutes);
      used.add(parseMinutes(slot));
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "step=move_evening_to_daytime",
        `place=${entry.name}`,
        `from=${entry.time}`,
        `to=${slot}`,
      );
      return { ...entry, time: slot, label: entry.label || "景點" };
    });
    return { ...plan, entries: dedupeEntryTimes(entries) };
  });
  return current;
}

/** Move only high-confidence, type-backed nightlife to an evening slot. */
export function repairNightlifeTiming(
  plans: ComposedDayPlan[],
  days: number,
): ComposedDayPlan[] {
  return ensureAllDayPlansExist(plans, days).map((plan) => {
    const used = new Set(plan.entries.map((entry) => parseMinutes(entry.time)));
    const entries = plan.entries.map((entry) => {
      const classification = resolveNightlifeClassification(entry.place);
      if (!classification.isNightlife || classification.confidence < 0.9) return entry;
      const earliest = classification.nightlifeSubtype === "night_market" ? 17 * 60 + 30 : 18 * 60;
      const from = parseMinutes(entry.time);
      if (from >= earliest) return entry;
      let target = earliest;
      while (used.has(target) && target <= 21 * 60 + 30) target += 30;
      if (target > 21 * 60 + 30) {
        logAiPipeline(
          "[ITINERARY_AUTO_REPAIR]",
          "rule=nightlife_timing",
          `placeId=${entry.place.id}`,
          `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
          `fromDay=${plan.day}`,
          `fromTime=${entry.time}`,
          `toDay=${plan.day}`,
          "toTime=",
          "action=replan_required",
          "reason=no_evening_capacity",
        );
        return entry;
      }
      used.delete(from);
      used.add(target);
      const toTime = formatMinutes(target);
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "rule=nightlife_timing",
        `placeId=${entry.place.id}`,
        `placeName=${entry.place.localizedDisplayName ?? entry.name}`,
        `fromDay=${plan.day}`,
        `fromTime=${entry.time}`,
        `toDay=${plan.day}`,
        `toTime=${toTime}`,
        "action=moved",
        `reason=${classification.reason}`,
      );
      return { ...entry, time: toTime, label: entry.label || "夜間" };
    });
    return { ...plan, entries: dedupeEntryTimes(entries) };
  });
}

function similarType(a: PlaceResult, b: PlaceResult): boolean {
  const ta = primaryTypeOf(a);
  const tb = primaryTypeOf(b);
  if (ta && tb && ta === tb) return true;
  const setA = new Set((a.types ?? []).map((t) => t.toLowerCase()));
  const setB = new Set((b.types ?? []).map((t) => t.toLowerCase()));
  for (const t of setA) {
    if (setB.has(t)) return true;
  }
  return false;
}

/** 3. 營業時間衝突 → 以 pool 中同類型附近景點替換 */
function repairReplaceClosedPlaces(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  plannedDate?: string,
  lock: SelectedPlaceLock | null = null,
): ComposedDayPlan[] {
  const used = new Set(
    flattenComposedDayPlanPlaces(plans)
      .map(placeIdOf)
      .filter(Boolean),
  );
  const candidates = pool.filter((p) => {
    const id = placeIdOf(p);
    return id && !used.has(id);
  });

  let replaced = 0;
  const current = ensureAllDayPlansExist(plans, days).map((plan) => {
    const entries = plan.entries.map((entry) => {
      const closed = isClearlyClosedAtSlot(entry.place, plannedDate, entry.time);
      if (closed !== true) return entry;
      // Locked places: only permanently-closed Google status may replace (handled upstream).
      if (isLockedEntry(entry, lock)) return entry;
      if (entry.place.lat == null || entry.place.lng == null) return entry;

      let best: PlaceResult | null = null;
      let bestDist = Infinity;
      for (const cand of candidates) {
        if (cand.lat == null || cand.lng == null) continue;
        if (!similarType(entry.place, cand)) continue;
        if (isClearlyClosedAtSlot(cand, plannedDate, entry.time) === true) continue;
        const d = distanceMeters(
          { lat: entry.place.lat, lng: entry.place.lng },
          { lat: cand.lat, lng: cand.lng },
        );
        if (d <= REPLACE_RADIUS_M && d < bestDist) {
          best = cand;
          bestDist = d;
        }
      }
      if (!best) return entry;
      const oldId = placeIdOf(entry.place);
      const newId = placeIdOf(best);
      if (oldId) used.delete(oldId);
      if (newId) used.add(newId);
      replaced += 1;
      logAiPipeline(
        "[ITINERARY_AUTO_REPAIR]",
        "step=replace_closed_place",
        `from=${entry.name}`,
        `to=${best.name}`,
        `distanceM=${Math.round(bestDist)}`,
      );
      return {
        ...entry,
        name: best.name,
        place: best,
      };
    });
    return { ...plan, entries };
  });

  if (replaced) {
    logAiPipeline("[ITINERARY_AUTO_REPAIR]", "step=replace_closed_place", `count=${replaced}`);
  }
  return current;
}

/** 4. 跨天重新分配（不均 / multi_day_balance） */
function repairRedistributeAcrossDays(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  plannedDate: string | undefined,
  nearbyExtensions: string[] | undefined,
  force: boolean,
): ComposedDayPlan[] {
  const counts = dayCountsOfPlans(plans);
  const max = Math.max(0, ...counts);
  const min = Math.min(...counts, max);
  const uneven = max - min >= 2 || counts.some((c) => c < 2);

  if (!force && !uneven) return plans;

  const mergedPool = dedupeByCanonicalLandmark([
    ...flattenComposedDayPlanPlaces(plans),
    ...pool,
  ]).places;

  let current = ensureDayPlansMeetMinimum({
    plans,
    pool: mergedPool,
    days,
    style,
    plannedDate,
    nearbyExtensions,
  });

  if (mergedPool.length >= days * 2) {
    current = redistributePlacesEvenly({
      places: mergedPool,
      days,
      style,
      plannedDate,
    });
  }

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR]",
    "step=redistribute_across_days",
    `before=${counts.join(",")}`,
    `after=${dayCountsOfPlans(current).join(",")}`,
  );
  return ensureAllDayPlansExist(current, days);
}

function applyAutoRepairPass(
  plans: ComposedDayPlan[],
  pool: PlaceResult[],
  days: number,
  style: TripStyleKey,
  plannedDate: string | undefined,
  reasons: string[],
  nearbyExtensions: string[] | undefined,
  attempt: number,
  lock: SelectedPlaceLock | null = null,
  partialDays?: readonly number[],
  failedDays?: readonly number[],
): ComposedDayPlan[] {
  const reasonSet = new Set(reasons);
  let current = normalizeCompleteDayMap(
    ensureAllDayPlansExist(plans, days),
    days,
  ) as ComposedDayPlan[];
  const mergedPool = dedupeByCanonicalLandmark([
    ...flattenComposedDayPlanPlaces(current),
    ...pool,
  ]).places;
  const previousDayCounts = dayCountsOfPlans(current);
  const needsCoverage = shouldRepairDayCoverage(reasons, previousDayCounts);

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_START]",
    `attempt=${attempt}`,
    `reasons=${reasons.join("|") || "(soft)"}`,
    `poolSize=${mergedPool.length}`,
    `previousDayCounts=${previousDayCounts.join(",")}`,
    `failedDays=${(failedDays ?? []).join(",") || "(none)"}`,
  );

  // Always-safe soft repairs for timeline / hours / balance (and any soft pass).
  const softTimeline =
    reasonSet.has("replan_for_route_timeline") ||
    reasonSet.size === 0 ||
    [...reasonSet].some((r) => r.includes("timeline") || r.includes("route"));
  const softHours =
    reasonSet.has("replan_for_open_hours") ||
    reasonSet.has("replan_meal_or_nightlife_slots");
  const softBalance =
    reasonSet.has("replan_for_multi_day_balance") ||
    reasonSet.has("replan_for_day_capacity") ||
    reasonSet.has("replan_for_full_day_coverage") ||
    needsCoverage;

  // Step 0 — empty-day coverage BEFORE reorder/assembly (assembly used to re-empty Day N).
  if (needsCoverage) {
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Always strip low-value facilities + unify display names before other repairs.
  // Selected Place Lock: quality / diversity / replacement must not drop locked anchors.
  current = repairRemoveLowValueAndLocalize(current, days, lock);
  current = repairDailyCategoryDiversity(current, days, style, lock);
  current = repairNonNavigableStops(current, mergedPool, days, lock);
  current = repairNightlifeTiming(current, days);

  if (
    reasonSet.has("replan_to_dedupe_places") ||
    reasonSet.has("replan_to_replace_excluded_or_unsuitable")
  ) {
    current = repairTripDuplicatePlaces({
      plans: current,
      pool: mergedPool,
      days,
      style,
      plannedDate,
    });
  }

  // Step 1 — reorder same day (assembly now preserves day coverage)
  if (softTimeline || softHours || attempt === 1) {
    current = repairReorderSameDay(current, mergedPool, days, style, nearbyExtensions);
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Long / cross-area legs: move stops across days (do not mask with transport mode).
  if (softTimeline || attempt <= 2) {
    current = repairLongRouteLegs(current, days);
    current = repairEmptyDays(current, days, partialDays, lock);
    current = repairReorderSameDay(current, mergedPool, days, style, nearbyExtensions);
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  // Step 2 — evening → daytime
  if (softTimeline || softHours || attempt <= 2) {
    current = repairMoveEveningToDaytime(current, days);
  }

  // Step 3 — replace closed / hours conflict
  if (softHours || attempt >= 2) {
    current = repairReplaceClosedPlaces(current, mergedPool, days, plannedDate, lock);
    current = repairDayPlanSlots(
      current,
      mergedPool,
      style,
      classifyPlanPlaceKind,
      resolveEntryLabel,
      days,
      plannedDate,
    );
  }

  // Step 4 — redistribute across days (force when coverage failed)
  if (softBalance || attempt >= 2 || needsCoverage) {
    current = repairRedistributeAcrossDays(
      current,
      mergedPool,
      days,
      style,
      plannedDate,
      nearbyExtensions,
      softBalance || attempt >= 3 || needsCoverage,
    );
    current = repairEmptyDays(current, days, partialDays, lock);
  }

  if (reasonSet.has("replan_for_nearby_extension_coverage")) {
    try {
      const assembled = applyPlannerRouteAndCapacityAssembly({
        plans: current,
        pool: mergedPool,
        days,
        style,
        nearbyExtensions,
      });
      current = ensureAllDayPlansExist(assembled.plans as ComposedDayPlan[], days);
      current = repairEmptyDays(current, days, partialDays, lock);
    } catch {
      /* keep */
    }
  }

  // Final: diversity move + coverage + time dedupe
  current = repairDailyCategoryDiversity(current, days, style, lock);
  current = repairEmptyDays(current, days, partialDays, lock);
  current = repairNightlifeTiming(current, days);
  current = normalizeCompleteDayMap(
    ensureAllDayPlansExist(current, days).map((plan) => ({
      ...plan,
      entries: dedupeEntryTimes(plan.entries),
    })),
    days,
  ) as ComposedDayPlan[];

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_DONE]",
    `attempt=${attempt}`,
    `dayCounts=${dayCountsOfPlans(current).join(",")}`,
    `stopCount=${current.reduce((n, p) => n + p.entries.length, 0)}`,
  );

  return current;
}

export function shouldRepairDayCoverage(
  reasons: readonly string[],
  dayCounts: readonly number[],
): boolean {
  return (
    reasons.includes("replan_for_full_day_coverage") ||
    dayCounts.some((count) => count === 0)
  );
}

function softPassValidation(
  validation: ItineraryValidationResult,
  mode: string,
): ItineraryValidationResult {
  return {
    ...validation,
    pass: true,
    score: Math.max(validation.score, 80),
    warnings: [
      ...validation.warnings,
      ...validation.failedRules.map((r) => ({
        code: r.code,
        message: `${mode}:${r.message}`,
        day: r.day,
        placeIds: r.placeIds,
      })),
    ],
    failedRules: [],
    replanReasons: [],
    path: "validator",
  };
}

/**
 * Soft Pass 最低可接受品質（不以 Stop 百分比）：
 * 1. 每天至少有基本完整結構
 * 2. 仍符合使用者原始偏好（無 user_exclusions）
 * 3. 沒有重複地點
 * 4. 沒有明顯營業時間衝突（not_open_at_slot）
 */
export function evaluateMinimumAcceptableQuality(
  plans: ComposedDayPlan[],
  validation: ItineraryValidationResult,
  opts: {
    days: number;
    partialDays?: readonly number[];
  },
): SoftPassQualityCheck {
  const reasons: string[] = [];
  const partial = new Set(opts.partialDays ?? []);
  const byDay = new Map(plans.map((p) => [p.day, p]));

  let dayStructureOk = true;
  for (let day = 1; day <= opts.days; day += 1) {
    const plan = byDay.get(day);
    const count = plan?.entries.length ?? 0;
    if (!plan || count === 0) {
      dayStructureOk = false;
      reasons.push(`day_structure:empty_day:${day}`);
      continue;
    }
    const min = partial.has(day) ? 1 : SOFT_PASS_MIN_PLACES_PER_FULL_DAY;
    if (count < min) {
      dayStructureOk = false;
      reasons.push(`day_structure:sparse_day:${day}:${count}<${min}`);
    }
  }
  if (
    validation.failedRules.some(
      (r) => r.code === "missing_days" || r.code === "day_place_count",
    )
  ) {
    dayStructureOk = false;
    if (!reasons.some((r) => r.startsWith("day_structure:"))) {
      reasons.push("day_structure:validator_failed_rules");
    }
  }

  // Soft pass must never deliver low-value / non-tourism stops.
  let noLowValue = true;
  for (const plan of plans) {
    for (const entry of plan.entries) {
      if (!evaluateTourismQuality(entry.place).ok) {
        noLowValue = false;
        reasons.push(`low_value_place:${entry.name}`);
      }
    }
  }

  const preferencesOk = !validation.failedRules.some((r) => r.code === "user_exclusions");
  if (!preferencesOk) reasons.push("preferences:user_exclusions");

  const noDuplicates = !validation.failedRules.some((r) => r.code === "place_duplicate");
  if (!noDuplicates) reasons.push("duplicates:place_duplicate");

  const obviousHours =
    validation.failedRules.some((r) => r.code === "business_hours_cover") ||
    validation.warnings.some(
      (w) =>
        w.code === "business_hours_cover" &&
        (w.message.startsWith("not_open_at_slot:") ||
          w.message.includes("not_open_at_slot:")),
    );
  const noObviousHoursConflict = !obviousHours;
  if (!noObviousHoursConflict) reasons.push("hours:not_open_at_slot");

  const ok =
    dayStructureOk &&
    preferencesOk &&
    noDuplicates &&
    noObviousHoursConflict &&
    noLowValue;

  logAiPipeline(
    "[ITINERARY_SOFT_PASS_QUALITY]",
    `ok=${ok}`,
    `dayStructure=${dayStructureOk}`,
    `preferences=${preferencesOk}`,
    `noDuplicates=${noDuplicates}`,
    `noObviousHours=${noObviousHoursConflict}`,
    `noLowValue=${noLowValue}`,
    `reasons=${reasons.join("|") || "(none)"}`,
    `dayCounts=${dayCountsOfPlans(plans).join(",")}`,
  );

  return {
    ok,
    dayStructureOk,
    preferencesOk,
    noDuplicates,
    noObviousHoursConflict,
    reasons,
  };
}

/** Soft-pass 可容忍的殘餘規則（品質門檻已過時） */
function remainingFailsAreSoftPassTolerated(
  validation: ItineraryValidationResult,
): boolean {
  if (!validation.failedRules.length) return true;
  return validation.failedRules.every((r) =>
    (SOFT_REPAIRABLE_RULE_CODES as readonly string[]).includes(r.code),
  );
}

/**
 * Auto Repair：最多 {@link MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS} 次。
 * 仍有 soft error 時：以最低可接受品質門檻 soft-pass（不依 Stop 百分比）。
 */
export function replanUntilItineraryValid(
  params: ItineraryReplanParams,
  initial: ItineraryValidationResult,
): ItineraryReplanOutcome {
  const originalPlans = params.plans;
  const originalStopCount = originalPlans.reduce((n, p) => n + p.entries.length, 0);
  let plans = normalizeCompleteDayMap(
    ensureAllDayPlansExist(params.plans, params.days),
    params.days,
  ) as ComposedDayPlan[];
  let validation = initial;
  let attempts = 0;
  let stopReason: ItineraryReplanOutcome["stopReason"] = initial.pass
    ? "success"
    : "unrepaired_failure";
  let noProgress = false;
  let cycleDetected = false;
  const selectedLock = lockFromValidatorInput(params.validatorInput);
  const seenPlanSignatures = new Set<string>([
    buildItineraryPlanSignature(plans, selectedLock),
  ]);

  // missing_days is hard for delivery but MUST enter Auto Repair first.
  while (
    !validation.pass &&
    validation.path === "validator" &&
    !hasUnrepairableHardBlockFailures(validation) &&
    attempts < MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS
  ) {
    attempts += 1;
    const previousDayCounts = dayCountsOfPlans(plans);
    const failedDays = [
      ...new Set([
        ...validation.affectedDays,
        ...validation.failedRules
          .filter((r) => r.code === "missing_days" && r.day != null)
          .map((r) => r.day!),
      ]),
    ];
    const lockedCount =
      (params.validatorInput.lockedPlaceIds?.length ?? 0) +
      (params.validatorInput.lockedPlaceNames?.length ?? 0);
    const redistributionRequired =
      validation.replanReasons.includes("replan_for_full_day_coverage") ||
      previousDayCounts.some((c) => c === 0);

    logAiPipeline(
      "[ITINERARY_REPLAN_INPUT]",
      `attempt=${attempts}`,
      `tripDays=${params.days}`,
      `previousDayCounts=${previousDayCounts.join(",")}`,
      `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      `failedDays=${failedDays.join(",") || "(none)"}`,
      `candidateCount=${params.pool.length}`,
      `lockedPlaceCount=${lockedCount}`,
      `redistributionRequired=${redistributionRequired}`,
    );
    logAiPipeline(
      "[ITINERARY_REPLAN_START]",
      `attempt=${attempts}`,
      `reasons=${validation.replanReasons.join("|")}`,
      `poolSize=${params.pool.length}`,
      "placesSearch=false",
      "mode=auto_repair",
    );

    const before = plans;
    const validationBefore = validation;
    // Do not reuse a failed day map: coverage repair rebuilds from stops across days.
    plans = applyAutoRepairPass(
      plans,
      params.pool,
      params.days,
      params.style,
      params.plannedDate,
      validation.replanReasons.length
        ? validation.replanReasons
        : [
            "replan_for_full_day_coverage",
            "replan_for_route_timeline",
            "replan_for_open_hours",
            "replan_for_multi_day_balance",
          ],
      params.nearbyExtensions,
      attempts,
      selectedLock,
      params.validatorInput.partialDays,
      failedDays,
    );

    const coverageGate = evaluateDayCoverageGate({
      plans,
      tripDays: params.days,
      partialDays: params.validatorInput.partialDays,
    });
    if (!coverageGate.allDaysCovered) {
      plans = repairEmptyDays(
        plans,
        params.days,
        params.validatorInput.partialDays,
        selectedLock,
      );
    }

    validation = validateItineraryPlan({
      ...params.validatorInput,
      plans,
    });

    const newDayCounts = dayCountsOfPlans(plans);
    const remainingEmptyDays = newDayCounts
      .map((c, i) => (c === 0 ? i + 1 : 0))
      .filter((d) => d > 0);
    logAiPipeline(
      "[ITINERARY_REPLAN_OUTPUT]",
      `newDayCounts=${newDayCounts.join(",")}`,
      `movedPlaces=${previousDayCounts.join(">")}->${newDayCounts.join(",")}`,
      `remainingEmptyDays=${remainingEmptyDays.join(",") || "(none)"}`,
      `validatorPass=${validation.pass}`,
    );
    logAiPipeline(
      "[ITINERARY_REPLAN_RESULT]",
      `attempt=${attempts}`,
      `pass=${validation.pass}`,
      `dayCounts=${newDayCounts.join(",")}`,
      `stopCount=${plans.reduce((n, p) => n + p.entries.length, 0)}`,
      `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
    );

    const stopCount = plans.reduce((n, p) => n + p.entries.length, 0);
    const beforeCount = before.reduce((n, p) => n + p.entries.length, 0);
    if (!validation.pass && stopCount < Math.max(params.days, Math.floor(beforeCount * 0.5))) {
      logAiPipeline(
        "[ITINERARY_REPLAN_KEEP_ORIGINAL]",
        "reason=replan_shrunk_plan",
        `before=${beforeCount}`,
        `after=${stopCount}`,
      );
      plans = before;
    }

    // Identical empty day map after a coverage repair → force even redistribute once.
    if (
      !validation.pass &&
      redistributionRequired &&
      newDayCounts.join(",") === previousDayCounts.join(",") &&
      previousDayCounts.some((c) => c === 0)
    ) {
      const mergedPool = dedupeByCanonicalLandmark([
        ...flattenComposedDayPlanPlaces(plans),
        ...params.pool,
      ]).places;
      if (mergedPool.length >= params.days) {
        logAiPipeline(
          "[ITINERARY_REPLAN_FORCE_REDISTRIBUTE]",
          `attempt=${attempts}`,
          `previousDayCounts=${previousDayCounts.join(",")}`,
        );
        plans = redistributePlacesEvenly({
          places: mergedPool,
          days: params.days,
          style: params.style,
          plannedDate: params.plannedDate,
        });
        plans = repairEmptyDays(
          plans,
          params.days,
          params.validatorInput.partialDays,
          selectedLock,
        );
        validation = validateItineraryPlan({
          ...params.validatorInput,
          plans,
        });
        logAiPipeline(
          "[ITINERARY_REPLAN_OUTPUT]",
          `newDayCounts=${dayCountsOfPlans(plans).join(",")}`,
          `movedPlaces=force_redistribute`,
          `remainingEmptyDays=${dayCountsOfPlans(plans)
            .map((c, i) => (c === 0 ? i + 1 : 0))
            .filter((d) => d > 0)
            .join(",") || "(none)"}`,
          `validatorPass=${validation.pass}`,
        );
      }
    }

    const progress = assessRepairProgress({
      plansBefore: before,
      plansAfter: plans,
      validationBefore,
      validationAfter: validation,
      seenPlanSignatures,
      lock: selectedLock,
    });
    const roundStopReason = resolveRepairRoundStopReason(validation.pass, progress);
    logAiPipeline(
      "[ITINERARY_REPAIR_PROGRESS]",
      `repairRound=${attempts}`,
      `planSignatureBefore=${shortRepairFingerprint(progress.planSignatureBefore)}`,
      `planSignatureAfter=${shortRepairFingerprint(progress.planSignatureAfter)}`,
      `failureFingerprintBefore=${shortRepairFingerprint(progress.failureFingerprintBefore)}`,
      `failureFingerprintAfter=${shortRepairFingerprint(progress.failureFingerprintAfter)}`,
      `operationCount=${progress.operationCount}`,
      `actualPlanChanged=${progress.actualPlanChanged}`,
      `hardFailureImproved=${progress.hardFailureImproved}`,
      `noProgress=${progress.noProgress}`,
      `cycleDetected=${progress.cycleDetected}`,
      `stopReason=${roundStopReason ?? "continue"}`,
    );
    if (roundStopReason) {
      noProgress = roundStopReason === "no_progress";
      cycleDetected = roundStopReason === "cycle_detected";
      stopReason = roundStopReason;
      break;
    }
    seenPlanSignatures.add(progress.planSignatureAfter);
  }

  if (
    !validation.pass &&
    stopReason === "unrepaired_failure" &&
    attempts >= MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS
  ) {
    stopReason = "max_rounds";
  }

  if (!validation.pass && (noProgress || cycleDetected)) {
    const evidence = evaluateDiversityDegradationEvidence({
      plans,
      validation,
      pool: params.pool,
      days: params.days,
      style: params.style,
      plannedDate: params.plannedDate,
      repairStalled: noProgress,
      cycleDetected,
      lock: selectedLock,
    });
    if (evidence.eligible) {
      validation = degradeDiversityFailureToWarning(validation);
    }
    logAiPipeline(
      "[ITINERARY_DIVERSITY_DEGRADATION]",
      `degradedRule=${evidence.degradedRule ?? ""}`,
      `degradationReason=${evidence.degradationReason}`,
      `candidatePoolExhausted=${evidence.candidatePoolExhausted}`,
      `repairStalled=${evidence.repairStalled}`,
      `cycleDetected=${evidence.cycleDetected}`,
      `degradedDelivery=${evidence.eligible}`,
      `deliveryAllowed=${validation.pass}`,
    );
  }

  if (!validation.pass && !hasHardBlockFailures(validation)) {
    const quality = evaluateMinimumAcceptableQuality(plans, validation, {
      days: params.days,
      partialDays: params.validatorInput.partialDays,
    });
    const tolerated = remainingFailsAreSoftPassTolerated(validation);
    const navGate = evaluateRouteNavigabilityGate({ plans });
    logRouteNavigabilityGate(navGate);

    if (quality.ok && tolerated && navGate.ok) {
      const repairedCount = plans.reduce((n, p) => n + p.entries.length, 0);
      if (repairedCount < params.days) {
        // Structure already checked by quality; prefer original only if repair emptied.
        plans = originalPlans;
      }
      logAiPipeline(
        "[ITINERARY_REPLAN_KEEP_ORIGINAL]",
        "reason=quality_gate_soft_pass",
        `attempts=${attempts}`,
        `originalStops=${originalStopCount}`,
        `qualityReasons=${quality.reasons.join("|") || "(none)"}`,
        `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      );
      validation = softPassValidation(validation, "auto_repair_quality_pass");
      logAiPipeline(
        "[ITINERARY_REPLAN_RESULT]",
        `attempt=${attempts}`,
        "pass=true",
        "mode=quality_gate_soft_pass",
        `dayCounts=${dayCountsOfPlans(plans).join(",")}`,
      );
    } else {
      logAiPipeline(
        "[ITINERARY_SOFT_PASS_REJECTED]",
        `attempts=${attempts}`,
        `qualityOk=${quality.ok}`,
        `tolerated=${tolerated}`,
        `navigabilityOk=${navGate.ok}`,
        `reasons=${[...quality.reasons, ...navGate.reasons].join("|") || "(none)"}`,
        `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      );
    }
  }

  // Final quality summary (one line — no per-place spam).
  const summary = buildItineraryQualitySummary({
    destination: params.validatorInput.destination ?? "",
    days: params.days,
    plans,
    candidatePool: params.pool,
  });
  logItineraryQualitySummary(summary);

  const hardFailures = validation.failedRules.filter((rule) =>
    hasHardBlockFailures({ ...validation, failedRules: [rule] }),
  );
  if (validation.pass && !noProgress && !cycleDetected) stopReason = "success";
  logAiPipeline(
    "[ITINERARY_FINAL_GATE]",
    `hardFailures=${hardFailures.map((rule) => rule.code).join(",") || "(none)"}`,
    `warnings=${validation.warnings.map((warning) => warning.code).join(",") || "(none)"}`,
    `repairAttempts=${attempts}`,
    `deliveryAllowed=${validation.pass || hardFailures.length === 0}`,
    `reason=${validation.pass ? "validated" : hardFailures.length ? "hard_failure" : "warnings_only"}`,
  );

  logAiPipeline(
    "[ITINERARY_REPAIR_STOP]",
    `repairRound=${attempts}`,
    `stopReason=${stopReason}`,
    `noProgress=${noProgress}`,
    `cycleDetected=${cycleDetected}`,
  );
  return { plans, validation, attempts, stopReason, noProgress, cycleDetected };
}
