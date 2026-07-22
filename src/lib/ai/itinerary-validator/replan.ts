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
  validateItineraryPlan,
} from "@/lib/ai/itinerary-validator/validate";

export type ItineraryReplanParams = {
  plans: ComposedDayPlan[];
  pool: PlaceResult[];
  days: number;
  style: TripStyleKey;
  plannedDate?: string;
  nearbyExtensions?: string[];
  validatorInput: Omit<ItineraryValidatorInput, "plans">;
};

export type ItineraryReplanOutcome = {
  plans: ComposedDayPlan[];
  validation: ItineraryValidationResult;
  attempts: number;
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
): ComposedDayPlan[] {
  const reasonSet = new Set(reasons);
  let current = ensureAllDayPlansExist(plans, days);
  const mergedPool = dedupeByCanonicalLandmark([
    ...flattenComposedDayPlanPlaces(current),
    ...pool,
  ]).places;

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_START]",
    `attempt=${attempt}`,
    `reasons=${reasons.join("|") || "(soft)"}`,
    `poolSize=${mergedPool.length}`,
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
    reasonSet.has("replan_for_full_day_coverage");

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

  // Step 1 — reorder same day
  if (softTimeline || softHours || attempt === 1) {
    current = repairReorderSameDay(current, mergedPool, days, style, nearbyExtensions);
  }

  // Step 2 — evening → daytime
  if (softTimeline || softHours || attempt <= 2) {
    current = repairMoveEveningToDaytime(current, days);
  }

  // Step 3 — replace closed / hours conflict
  if (softHours || attempt >= 2) {
    current = repairReplaceClosedPlaces(current, mergedPool, days, plannedDate);
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

  // Step 4 — redistribute across days
  if (softBalance || attempt >= 2) {
    current = repairRedistributeAcrossDays(
      current,
      mergedPool,
      days,
      style,
      plannedDate,
      nearbyExtensions,
      softBalance || attempt >= 3,
    );
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
    } catch {
      /* keep */
    }
  }

  // Final pass: always dedupe times after repairs
  current = ensureAllDayPlansExist(current, days).map((plan) => ({
    ...plan,
    entries: dedupeEntryTimes(plan.entries),
  }));

  logAiPipeline(
    "[ITINERARY_AUTO_REPAIR_DONE]",
    `attempt=${attempt}`,
    `dayCounts=${dayCountsOfPlans(current).join(",")}`,
    `stopCount=${current.reduce((n, p) => n + p.entries.length, 0)}`,
  );

  return current;
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
    dayStructureOk && preferencesOk && noDuplicates && noObviousHoursConflict;

  logAiPipeline(
    "[ITINERARY_SOFT_PASS_QUALITY]",
    `ok=${ok}`,
    `dayStructure=${dayStructureOk}`,
    `preferences=${preferencesOk}`,
    `noDuplicates=${noDuplicates}`,
    `noObviousHours=${noObviousHoursConflict}`,
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
  let plans = params.plans;
  let validation = initial;
  let attempts = 0;

  while (
    !validation.pass &&
    validation.path === "validator" &&
    !hasHardBlockFailures(validation) &&
    attempts < MAX_ITINERARY_VALIDATOR_REPLAN_ATTEMPTS
  ) {
    attempts += 1;
    logAiPipeline(
      "[ITINERARY_REPLAN_START]",
      `attempt=${attempts}`,
      `reasons=${validation.replanReasons.join("|")}`,
      `poolSize=${params.pool.length}`,
      "placesSearch=false",
      "mode=auto_repair",
    );

    const before = plans;
    plans = applyAutoRepairPass(
      plans,
      params.pool,
      params.days,
      params.style,
      params.plannedDate,
      validation.replanReasons.length
        ? validation.replanReasons
        : ["replan_for_route_timeline", "replan_for_open_hours", "replan_for_multi_day_balance"],
      params.nearbyExtensions,
      attempts,
    );

    validation = validateItineraryPlan({
      ...params.validatorInput,
      plans,
    });

    logAiPipeline(
      "[ITINERARY_REPLAN_RESULT]",
      `attempt=${attempts}`,
      `pass=${validation.pass}`,
      `dayCounts=${dayCountsOfPlans(plans).join(",")}`,
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
  }

  if (!validation.pass && !hasHardBlockFailures(validation)) {
    const quality = evaluateMinimumAcceptableQuality(plans, validation, {
      days: params.days,
      partialDays: params.validatorInput.partialDays,
    });
    const tolerated = remainingFailsAreSoftPassTolerated(validation);

    if (quality.ok && tolerated) {
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
        `reasons=${quality.reasons.join("|") || "(none)"}`,
        `failedRules=${validation.failedRules.map((r) => r.code).join(",")}`,
      );
    }
  }

  return { plans, validation, attempts };
}
