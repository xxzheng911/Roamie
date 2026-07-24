/**
 * Itinerary Validator（P4.2）
 *
 * 只驗證已組裝行程；不重排、不重組、不新增替代地點。
 * Flag OFF → pass-through（不改變既有行為）。
 */

import {
  excludedRetailReasonLocal,
  hasOpeningHoursDataLocal,
  isBarBistroPlaceLocal,
  isCafePlaceLocal,
  isClearlyClosedAtSlot,
  isNightMarketPlaceLocal,
  isProperRestaurantPlaceLocal,
} from "@/lib/ai/itinerary-validator/place-checks";
import { resolveCanonicalLandmarkKey, normalizeLandmarkNameForDedup } from "@/lib/ai/canonical-landmark";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { isItineraryValidatorEnabled } from "@/lib/ai/itinerary-validator/feature-flag";
import {
  HARD_BLOCK_RULE_CODES,
  REPAIR_FIRST_HARD_RULE_CODES,
  ITINERARY_VALIDATOR_VERSION,
  SOFT_REPAIRABLE_RULE_CODES,
  type ItineraryFailedRule,
  type ItineraryRuleCode,
  type ItineraryValidationResult,
  type ItineraryValidatorInput,
  type ItineraryWarning,
  type NearbyExtensionCoverage,
  type PersistenceDayCountsCompareInput,
  type PersistenceDayCountsCompareResult,
} from "@/lib/ai/itinerary-validator/types";
import {
  parseExcludedCategoriesFromText,
  placeMatchesExcludedCategories,
  extractUserAuthoredExclusionText,
} from "@/lib/ai/recommendation-exclusion";
import { isForbiddenTransitAttraction } from "@/lib/ai/transit-station-filter";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { distanceMeters } from "@/lib/geo-distance";
import { isLodgingPlace } from "@/lib/lodging-place-filter";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import type { PlaceResult } from "@/lib/place-result";
import { summarizeDailyCategoryDiversity } from "@/lib/ai/daily-category-diversity";
import { resolveNightlifeClassification } from "@/lib/ai/nightlife-classification";

/** 本地結構型別 — 避免 import ai-day-plan-source 觸發循環依賴 */
type DayPlanEntry = {
  time: string;
  label: string;
  name: string;
  place: PlaceResult;
};

type ComposedDayPlan = {
  day: number;
  entries: DayPlanEntry[];
  isIncomplete?: boolean;
};

/** 近郊匹配（精簡版；不經 planner-day-route-assembly） */
function placeMatchesNearbyExtension(
  place: PlaceResult,
  extensions: string[],
): string | null {
  if (!extensions.length) return null;
  if (
    place.destinationScope === "nearby_extension" &&
    place.extensionDestination
  ) {
    const tagged = normalizeDestinationLabel(place.extensionDestination);
    if (extensions.some((e) => normalizeDestinationLabel(e) === tagged)) {
      return tagged;
    }
  }
  const blob = [place.name, place.address, ...(place.types ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  for (const ext of extensions) {
    const label = normalizeDestinationLabel(ext);
    const tokens = [...new Set([label, ext].map((a) => a.trim().toLowerCase()).filter(Boolean))];
    // 常見別名
    if (label === "橫濱" || /yokohama|横浜|橫濱/i.test(ext)) {
      tokens.push("yokohama", "横浜", "橫濱", "よこはま");
    }
    if (tokens.some((t) => t && blob.includes(t))) return label;
  }
  return null;
}

const BREAKFAST_RE = /早餐/;
const LUNCH_RE = /午餐/;
const DINNER_RE = /晚餐/;
const MEAL_RE = /早餐|午餐|晚餐/;

/** 完整旅遊日硬下限（單點日必須 fail） */
const HARD_MIN_PLACES_FULL_DAY = 2;
/** 一般行程目標容量（低於此 → warning，仍 ≥ HARD_MIN） */
const TARGET_PLACES_FULL_DAY = 3;
/** 慢步調硬下限 */
const HARD_MIN_PLACES_SLOW = 2;
/** partial day 允許的最低（抵達／離境） */
const HARD_MIN_PLACES_PARTIAL = 1;

const MAX_LEG_WARN_M = 12_000;
const MAX_LEG_FAIL_M = 35_000;
const MAX_BACKTRACK_M = 18_000;
const WALK_METERS_PER_MIN = 80;
const NEAR_DUP_METERS = 450;
const NEARBY_CONCENTRATE_MIN = 2;
const NEARBY_CONCENTRATE_MAX = 4;

const FAIL_PENALTY = 8;
const WARN_PENALTY = 2;

const SHOPPING_EXCLUDE_RE = /不要購物|不要逛街|不要商場|不要百貨|別推薦購物/;
const CHAIN_EXCLUDE_RE = /不要連鎖|不要連鎖店|別給連鎖|避免連鎖/;
const PARK_EXCLUDE_RE = /不要公園|不要戶外|別推薦公園/;

let lastResult: ItineraryValidationResult | null = null;

export function getLastItineraryValidationResult(): ItineraryValidationResult | null {
  return lastResult
    ? {
        ...lastResult,
        failedRules: [...lastResult.failedRules],
        warnings: [...lastResult.warnings],
        nearbyCoverage: lastResult.nearbyCoverage
          ? { ...lastResult.nearbyCoverage }
          : undefined,
      }
    : null;
}

export function resetLastItineraryValidationResult(): void {
  lastResult = null;
}

function parseTimeMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function placeId(place: PlaceResult): string {
  return (place.id ?? "").trim();
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function stayMinutes(entry: DayPlanEntry): number {
  if (BREAKFAST_RE.test(entry.label)) return 45;
  if (LUNCH_RE.test(entry.label) || DINNER_RE.test(entry.label)) return 60;
  if (/咖啡|下午茶/.test(entry.label)) return 40;
  return 75;
}

function travelMinutes(a: DayPlanEntry, b: DayPlanEntry): number | null {
  if (a.place.lat == null || a.place.lng == null || b.place.lat == null || b.place.lng == null) {
    return null;
  }
  const d = distanceMeters(
    { lat: a.place.lat, lng: a.place.lng },
    { lat: b.place.lat, lng: b.place.lng },
  );
  return Math.max(5, Math.round(d / WALK_METERS_PER_MIN));
}

function passThroughResult(): ItineraryValidationResult {
  return {
    pass: true,
    score: 100,
    failedRules: [],
    warnings: [],
    affectedDays: [],
    affectedPlaceIds: [],
    validatorVersion: ITINERARY_VALIDATOR_VERSION,
    replanReasons: [],
    path: "pass_through",
  };
}

function logRule(
  code: ItineraryRuleCode,
  pass: boolean,
  opts?: { day?: number; placeIds?: string[]; details?: string; affectedDays?: number[] },
): void {
  const days =
    opts?.affectedDays?.length
      ? opts.affectedDays.join(",")
      : opts?.day != null
        ? String(opts.day)
        : "";
  logAiPipeline(
    "[ITINERARY_VALIDATOR_RULE]",
    `rule=${code}`,
    `pass=${pass}`,
    days ? `affectedDays=${days}` : "",
    opts?.placeIds?.length ? `affectedPlaceIds=${opts.placeIds.join(",")}` : "",
    opts?.details ? `details=${opts.details}` : "",
  );
}

function pushFail(
  failed: ItineraryFailedRule[],
  code: ItineraryRuleCode,
  message: string,
  day?: number,
  placeIds?: string[],
  affectedDays?: number[],
): void {
  failed.push({ code, message, day, placeIds, severity: "fail" });
  logRule(code, false, { day, placeIds, details: message, affectedDays });
}

function pushWarn(
  warnings: ItineraryWarning[],
  code: ItineraryRuleCode,
  message: string,
  day?: number,
  placeIds?: string[],
): void {
  warnings.push({ code, message, day, placeIds });
  logRule(code, true, { day, placeIds, details: `warning:${message}` });
}

function hardMinForDay(day: number, input: ItineraryValidatorInput): number {
  const partial = new Set(input.partialDays ?? []);
  if (partial.has(day)) return HARD_MIN_PLACES_PARTIAL;
  if (input.slowTravel) return HARD_MIN_PLACES_SLOW;
  return HARD_MIN_PLACES_FULL_DAY;
}

function resolveExclusionKeywords(input: ItineraryValidatorInput): string[] {
  const fromSession = [...(input.excludedCategories ?? [])];
  const fromText = input.userText ? parseExcludedCategoriesFromText(input.userText) : [];
  const extra: string[] = [];
  // Only scan user-authored exclusion text — never AI conversation prose.
  const t = input.userText ? extractUserAuthoredExclusionText(input.userText) : "";
  if (t && SHOPPING_EXCLUDE_RE.test(t)) {
    extra.push("購物", "商場", "百貨", "shopping", "mall", "outlet");
  }
  if (t && CHAIN_EXCLUDE_RE.test(t)) {
    extra.push("連鎖", "chain", "starbucks", "mcdonald", "便利商店");
  }
  if (t && PARK_EXCLUDE_RE.test(t) && !fromText.some((k) => /公園|park/i.test(k))) {
    extra.push("公園", "park");
  }
  return [...new Set([...fromSession, ...fromText, ...extra].map((s) => s.trim()).filter(Boolean))];
}

function isParkPlace(place: PlaceResult): boolean {
  const types = [place.primaryType, ...(place.types ?? [])].filter(Boolean).join(" ").toLowerCase();
  const name = (place.name ?? "").toLowerCase();
  return /park|公園/.test(types) || /公園|park/.test(name);
}

function isLowQualityPlace(place: PlaceResult): boolean {
  if (place.businessStatus === "CLOSED_PERMANENTLY") return true;
  const rating = place.rating ?? 0;
  const count = place.userRatingCount ?? 0;
  if (count === 0 && rating === 0) {
    const hasId = Boolean(place.id?.trim());
    const hasCoords = place.lat != null && place.lng != null;
    const hasAddress = Boolean(place.address?.trim());
    const hasPhoto = Boolean(place.photoName);
    // 僅在幾乎無可信資料時 fail；有 placeId／座標／地址／照片任一即可通過
    if (!hasId && !hasCoords && !hasAddress && !hasPhoto) return true;
  }
  return false;
}

function isOfficeOrResidential(place: PlaceResult): boolean {
  const types = new Set(
    [place.primaryType, ...(place.types ?? [])].filter(Boolean).map((t) => t!.toLowerCase()),
  );
  return (
    types.has("office") ||
    types.has("premise") ||
    types.has("residential") ||
    types.has("apartment_complex") ||
    types.has("parking") ||
    types.has("parking_garage") ||
    types.has("parking_lot")
  );
}

function nameStemOverlap(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length < 4) return false;
  return longer.includes(shorter);
}

function evaluateNearbyCoverage(
  plans: readonly import("@/lib/ai/itinerary-validator/types").ItineraryComposedDayPlanLike[],
  extensions: string[],
): NearbyExtensionCoverage {
  const expected = [...new Set(extensions.map((e) => normalizeDestinationLabel(e)).filter(Boolean))];
  const covered: string[] = [];
  const daysByExtension: Record<string, number[]> = {};
  const concentratedCounts: Record<string, number> = {};
  const affectedPlaceIds: string[] = [];
  const affectedDays = new Set<number>();

  for (const ext of expected) {
    const dayHits = new Map<number, string[]>();
    for (const plan of plans) {
      for (const entry of plan.entries) {
        const matched = placeMatchesNearbyExtension(entry.place, [ext]);
        if (!matched) continue;
        const ids = dayHits.get(plan.day) ?? [];
        const id = placeId(entry.place);
        if (id) {
          ids.push(id);
          affectedPlaceIds.push(id);
        }
        dayHits.set(plan.day, ids);
        affectedDays.add(plan.day);
      }
    }
    const days = [...dayHits.keys()].sort((a, b) => a - b);
    daysByExtension[ext] = days;
    if (days.length === 0) {
      concentratedCounts[ext] = 0;
      continue;
    }
    covered.push(ext);
    let bestCount = 0;
    for (const d of days) {
      const c = dayHits.get(d)?.length ?? 0;
      if (c > bestCount) bestCount = c;
    }
    concentratedCounts[ext] = bestCount;
  }

  return {
    expectedExtensions: expected,
    coveredExtensions: covered,
    missingExtensions: expected.filter((e) => !covered.includes(e)),
    affectedDays: [...affectedDays].sort((a, b) => a - b),
    affectedPlaceIds: [...new Set(affectedPlaceIds)],
    daysByExtension,
    concentratedCounts,
  };
}

function runRules(input: ItineraryValidatorInput): {
  failedRules: ItineraryFailedRule[];
  warnings: ItineraryWarning[];
  nearbyCoverage?: NearbyExtensionCoverage;
} {
  const failedRules: ItineraryFailedRule[] = [];
  const warnings: ItineraryWarning[] = [];
  const plans = [...input.plans].sort((a, b) => a.day - b.day);
  const requestedDays = Math.max(1, input.requestedDays);
  const excludeIds = new Set((input.excludePlaceIds ?? []).map((id) => id.trim()).filter(Boolean));
  const rejectedNames = new Set(
    (input.rejectedPlaceNames ?? []).map(normalizeName).filter(Boolean),
  );
  const lockedIds = new Set((input.lockedPlaceIds ?? []).map((id) => id.trim()).filter(Boolean));
  const exclusionKeywords = resolveExclusionKeywords(input);
  const partialDays = new Set(input.partialDays ?? []);
  const intents = input.intents ?? {};

  logAiPipeline(
    "[ITINERARY_USER_EXCLUSION_CHECK]",
    `sessionExclusions=${(input.excludedCategories ?? []).join("|") || "none"}`,
    `memoryExclusions=${(input.rejectedPlaceNames ?? []).join("|") || "none"}`,
    `parsedKeywords=${exclusionKeywords.join("|") || "none"}`,
    `excludePlaceIds=${[...excludeIds].join("|") || "none"}`,
    `userTextHasTrigger=${Boolean(extractUserAuthoredExclusionText(input.userText ?? ""))}`,
  );

  // ——— days_date_consistency ———
  let daysDateOk = plans.length === requestedDays;
  if (!daysDateOk) {
    pushFail(
      failedRules,
      "days_date_consistency",
      `day_count_mismatch:${plans.length}!=${requestedDays}`,
      undefined,
      undefined,
      plans.map((p) => p.day),
    );
  }
  if (input.plannedDate && input.endDate) {
    const start = Date.parse(input.plannedDate);
    const end = Date.parse(input.endDate);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      if (end < start) {
        daysDateOk = false;
        pushFail(failedRules, "days_date_consistency", "end_date_before_start_date");
      } else {
        const expectedSpan = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1;
        if (expectedSpan !== requestedDays) {
          // Date span is often system-derived / approximate; day-count is already
          // validated above. Do not hard-block an otherwise renderable plan.
          pushWarn(
            warnings,
            "days_date_consistency",
            `date_span_mismatch:${expectedSpan}!=${requestedDays}`,
          );
        }
      }
    }
  }
  if (daysDateOk) {
    logRule("days_date_consistency", true, { details: `days=${requestedDays}` });
  }

  // ——— missing_days ———
  const presentDays = new Set(plans.map((p) => p.day));
  const missingDayNums: number[] = [];
  for (let day = 1; day <= requestedDays; day += 1) {
    if (!presentDays.has(day)) {
      missingDayNums.push(day);
      pushFail(failedRules, "missing_days", `missing_day:${day}`, day, undefined, [day]);
    }
  }
  const emptyDayNums = plans.filter((p) => p.entries.length === 0).map((p) => p.day);
  for (const day of emptyDayNums) {
    pushFail(failedRules, "missing_days", `empty_day_plan:${day}`, day, undefined, [day]);
  }
  if (
    requestedDays > 1 &&
    plans.filter((p) => p.entries.length > 0).length === 1 &&
    plans.some((p) => p.day === 1 && p.entries.length > 0)
  ) {
    pushFail(failedRules, "missing_days", "only_first_day_populated", 1, undefined, [1]);
  }
  if (!missingDayNums.length && !emptyDayNums.length) {
    logRule("missing_days", true);
  }

  // ——— day_place_count + day_capacity_pace_lock ———
  for (const plan of plans) {
    const count = plan.entries.length;
    const hardMin = hardMinForDay(plan.day, input);
    if (count === 0) {
      continue;
    }
    if (count === 1 && !partialDays.has(plan.day)) {
      pushFail(
        failedRules,
        "day_place_count",
        `single_place_day:${plan.day}`,
        plan.day,
        plan.entries.map((e) => placeId(e.place)).filter(Boolean),
        [plan.day],
      );
    } else if (count < hardMin) {
      pushFail(
        failedRules,
        "day_place_count",
        `sparse_day:${plan.day}:${count}<${hardMin}`,
        plan.day,
        undefined,
        [plan.day],
      );
    } else if (
      !input.slowTravel &&
      !partialDays.has(plan.day) &&
      count < TARGET_PLACES_FULL_DAY
    ) {
      pushWarn(
        warnings,
        "day_place_count",
        `below_target:${plan.day}:${count}<${TARGET_PLACES_FULL_DAY}`,
        plan.day,
      );
    } else {
      logRule("day_place_count", true, { day: plan.day, details: `count=${count}` });
    }

    if (input.slowTravel && count > HARD_MIN_PLACES_SLOW + 3) {
      pushFail(
        failedRules,
        "day_capacity_pace_lock",
        `overflow_slow_day:${plan.day}:${count}`,
        plan.day,
      );
    }
  }

  // ——— daily_category_diversity (hard; repair must move or replace) ———
  for (const plan of plans) {
    const diversity = summarizeDailyCategoryDiversity(
      plan.day,
      plan.entries.map((entry) => entry.place),
      { style: input.style, userText: input.userText },
    );
    if (!diversity.gatePass) {
      pushFail(
        failedRules,
        "daily_category_diversity",
        diversity.violations.join("|"),
        plan.day,
        plan.entries.map((entry) => placeId(entry.place)).filter(Boolean),
      );
    } else {
      logRule("daily_category_diversity", true, { day: plan.day });
    }
  }

  // ——— place_duplicate ———
  type Seen = { day: number; name: string; place: PlaceResult; key: string };
  const byPlaceId = new Map<string, Seen>();
  const byCanonical = new Map<string, Seen>();
  const byNormName = new Map<string, Seen>();
  const coordSeen: Seen[] = [];

  for (const plan of plans) {
    const dayIds = new Set<string>();
    for (const entry of plan.entries) {
      const id = placeId(entry.place);
      const ids = id ? [id] : undefined;
      const canon = resolveCanonicalLandmarkKey(entry.place);
      const norm = normalizeLandmarkNameForDedup(entry.name || entry.place.name || "");
      const seen: Seen = { day: plan.day, name: entry.name, place: entry.place, key: canon };

      if (id) {
        if (dayIds.has(id)) {
          pushFail(
            failedRules,
            "place_duplicate",
            `same_day_duplicate:day${plan.day}:${entry.name}`,
            plan.day,
            ids,
          );
        }
        dayIds.add(id);
        const prev = byPlaceId.get(id);
        if (prev && prev.day !== plan.day) {
          pushFail(
            failedRules,
            "place_duplicate",
            `cross_day_duplicate:day${prev.day}+day${plan.day}:${entry.name}`,
            plan.day,
            ids,
          );
        } else if (!prev) {
          byPlaceId.set(id, seen);
        }
      }

      if (canon) {
        const prevC = byCanonical.get(canon);
        if (prevC && (prevC.day !== plan.day || placeId(prevC.place) !== id)) {
          pushFail(
            failedRules,
            "place_duplicate",
            `canonical_duplicate:${prevC.name}+${entry.name}:${canon}`,
            plan.day,
            [placeId(prevC.place), id].filter(Boolean),
          );
        } else if (!prevC) {
          byCanonical.set(canon, seen);
        }
      }

      if (norm && norm.length >= 3) {
        const prevN = byNormName.get(norm);
        if (prevN && placeId(prevN.place) !== id) {
          pushFail(
            failedRules,
            "place_duplicate",
            `name_duplicate:${prevN.name}+${entry.name}`,
            plan.day,
            [placeId(prevN.place), id].filter(Boolean),
          );
        } else if (!prevN) {
          byNormName.set(norm, seen);
        }
      }

      if (entry.place.lat != null && entry.place.lng != null && norm) {
        for (const other of coordSeen) {
          if (other.place.lat == null || other.place.lng == null) continue;
          if (placeId(other.place) === id && id) continue;
          const d = distanceMeters(
            { lat: entry.place.lat, lng: entry.place.lng },
            { lat: other.place.lat, lng: other.place.lng },
          );
          const otherNorm = normalizeLandmarkNameForDedup(other.name);
          if (d <= NEAR_DUP_METERS && nameStemOverlap(norm, otherNorm)) {
            pushFail(
              failedRules,
              "place_duplicate",
              `geo_name_duplicate:${other.name}+${entry.name}:${Math.round(d)}m`,
              plan.day,
              [placeId(other.place), id].filter(Boolean),
            );
          }
        }
        coordSeen.push(seen);
      }
    }
  }
  if (!failedRules.some((r) => r.code === "place_duplicate")) {
    logRule("place_duplicate", true);
  }

  const scheduledIds = new Set(
    plans.flatMap((p) => p.entries.map((e) => placeId(e.place)).filter(Boolean)),
  );
  for (const lockedId of lockedIds) {
    if (!scheduledIds.has(lockedId)) {
      pushFail(
        failedRules,
        "day_capacity_pace_lock",
        `locked_place_missing:${lockedId}`,
        undefined,
        [lockedId],
      );
    }
  }

  for (const plan of plans) {
    const ordered = [...plan.entries].sort(
      (a, b) => parseTimeMinutes(a.time) - parseTimeMinutes(b.time),
    );
    const seenTimes = new Map<number, string>();

    for (const entry of ordered) {
      const id = placeId(entry.place);
      const ids = id ? [id] : undefined;
      const minutes = parseTimeMinutes(entry.time);

      const prevName = seenTimes.get(minutes);
      if (prevName) {
        pushFail(
          failedRules,
          "timeline_conflict",
          `time_conflict:day${plan.day}:${entry.time}:${prevName}+${entry.name}`,
          plan.day,
          ids,
        );
      } else {
        seenTimes.set(minutes, entry.name);
      }

      if (BREAKFAST_RE.test(entry.label)) {
        if (
          isBarBistroPlaceLocal(entry.place) ||
          isNightMarketPlaceLocal(entry.place) ||
          (!isProperRestaurantPlaceLocal(entry.place) && !isCafePlaceLocal(entry.place))
        ) {
          pushFail(
            failedRules,
            "meal_slot_category",
            `breakfast_invalid:${entry.name}`,
            plan.day,
            ids,
          );
        }
      }
      if (LUNCH_RE.test(entry.label)) {
        if (
          isParkPlace(entry.place) ||
          !isProperRestaurantPlaceLocal(entry.place) ||
          isBarBistroPlaceLocal(entry.place) ||
          isNightMarketPlaceLocal(entry.place)
        ) {
          pushFail(
            failedRules,
            "meal_slot_category",
            `lunch_invalid:${entry.name}`,
            plan.day,
            ids,
          );
        }
      }
      if (DINNER_RE.test(entry.label)) {
        const okDinner =
          isProperRestaurantPlaceLocal(entry.place) ||
          isBarBistroPlaceLocal(entry.place) ||
          (isNightMarketPlaceLocal(entry.place) && minutes >= 17 * 60 + 30);
        if (!okDinner || isParkPlace(entry.place)) {
          pushFail(
            failedRules,
            "meal_slot_category",
            `dinner_invalid:${entry.name}`,
            plan.day,
            ids,
          );
        }
      }

      const nightlife = resolveNightlifeClassification(entry.place);
      if (nightlife.isNightlife && nightlife.confidence >= 0.9 && nightlife.nightlifeSubtype !== "night_market") {
        if (minutes < 17 * 60) {
          pushFail(
            failedRules,
            "nightlife_timing",
            `${nightlife.nightlifeSubtype}_too_early:${entry.name}@${entry.time}`,
            plan.day,
            ids,
          );
        }
      }
      if (isNightMarketPlaceLocal(entry.place) && minutes < 17 * 60 + 30) {
        pushFail(
          failedRules,
          "nightlife_timing",
          `night_market_too_early:${entry.name}@${entry.time}`,
          plan.day,
          ids,
        );
      }

      const closed = isClearlyClosedAtSlot(entry.place, input.plannedDate, entry.time);
      if (closed === null) {
        pushWarn(
          warnings,
          "business_hours_cover",
          `hours_unknown:${entry.name}@${entry.time}`,
          plan.day,
          ids,
        );
      } else if (closed === true) {
        // Opening-hours data is frequently incomplete/wrong; warn instead of
        // blocking an otherwise deliverable itinerary.
        pushWarn(
          warnings,
          "business_hours_cover",
          `not_open_at_slot:${entry.name}@${entry.time}`,
          plan.day,
          ids,
        );
      }

      if (id && excludeIds.has(id)) {
        pushFail(failedRules, "user_exclusions", `excluded_place_id:${entry.name}`, plan.day, ids);
        logAiPipeline(
          "[ITINERARY_USER_EXCLUSION_CHECK]",
          `matched=place_id`,
          `place=${entry.name}`,
          `pass=false`,
        );
      }
      if (rejectedNames.has(normalizeName(entry.name))) {
        pushFail(failedRules, "user_exclusions", `rejected_place_name:${entry.name}`, plan.day, ids);
        logAiPipeline(
          "[ITINERARY_USER_EXCLUSION_CHECK]",
          `matched=rejected_name`,
          `place=${entry.name}`,
          `pass=false`,
        );
      }
      if (exclusionKeywords.length && placeMatchesExcludedCategories(entry.place, exclusionKeywords)) {
        pushFail(failedRules, "user_exclusions", `excluded_category:${entry.name}`, plan.day, ids);
        logAiPipeline(
          "[ITINERARY_USER_EXCLUSION_CHECK]",
          `matched=category`,
          `place=${entry.name}`,
          `keywords=${exclusionKeywords.join("|")}`,
          `pass=false`,
        );
      }

      if (isBurialOrFuneralPlace(entry.place)) {
        pushFail(failedRules, "unsuitable_place", `burial_or_funeral:${entry.name}`, plan.day, ids);
      }
      const retail = excludedRetailReasonLocal(entry.place, {
        shoppingIntent: Boolean(intents.shopping),
      });
      if (retail) {
        pushFail(
          failedRules,
          "unsuitable_place",
          `excluded_retail:${entry.name}:${retail}`,
          plan.day,
          ids,
        );
      }
      if (isForbiddenTransitAttraction(entry.place, input.userText)) {
        pushFail(failedRules, "unsuitable_place", `transit_station:${entry.name}`, plan.day, ids);
      }
      if (isLodgingPlace(entry.place) && !/住宿|飯店|hotel|旅館/i.test(input.userText ?? "")) {
        pushFail(failedRules, "unsuitable_place", `lodging_as_stop:${entry.name}`, plan.day, ids);
      }
      if (isOfficeOrResidential(entry.place)) {
        pushFail(
          failedRules,
          "unsuitable_place",
          `office_residential_parking:${entry.name}`,
          plan.day,
          ids,
        );
      }
      if (isLowQualityPlace(entry.place)) {
        pushFail(failedRules, "unsuitable_place", `low_quality:${entry.name}`, plan.day, ids);
      }
    }

    let dayDistanceKm = 0;
    let backtrackScore = 0;
    let routePass = true;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i]!;
      const b = ordered[i + 1]!;
      const legIds = [placeId(a.place), placeId(b.place)].filter(Boolean);

      if (
        a.place.lat != null &&
        a.place.lng != null &&
        b.place.lat != null &&
        b.place.lng != null
      ) {
        const d = distanceMeters(
          { lat: a.place.lat, lng: a.place.lng },
          { lat: b.place.lat, lng: b.place.lng },
        );
        dayDistanceKm += d / 1000;
        if (d > MAX_LEG_FAIL_M) {
          routePass = false;
          // Extreme legs are often suburb day-trips; warn rather than false-block.
          pushWarn(
            warnings,
            "route_travel_time",
            `leg_too_far:day${plan.day}:${a.name}->${b.name}:${Math.round(d)}m`,
            plan.day,
            legIds,
          );
        } else if (d > MAX_LEG_WARN_M) {
          pushWarn(
            warnings,
            "route_travel_time",
            `leg_long:day${plan.day}:${a.name}->${b.name}:${Math.round(d)}m`,
            plan.day,
            legIds,
          );
        }
      }

      const travel = travelMinutes(a, b);
      if (travel != null) {
        const earliestNext = parseTimeMinutes(a.time) + stayMinutes(a) + travel;
        if (parseTimeMinutes(b.time) + 5 < earliestNext) {
          // Feasibility uses rough stay/travel estimates — soft signal only.
          pushWarn(
            warnings,
            "timeline_conflict",
            `arrival_before_feasible:day${plan.day}:${a.name}->${b.name}`,
            plan.day,
            legIds,
          );
        }
      }
    }

    const scenic = ordered.filter((e) => !MEAL_RE.test(e.label));
    for (let i = 0; i < scenic.length - 2; i += 1) {
      const a = scenic[i]!;
      const b = scenic[i + 1]!;
      const c = scenic[i + 2]!;
      if (
        a.place.lat == null ||
        a.place.lng == null ||
        b.place.lat == null ||
        b.place.lng == null ||
        c.place.lat == null ||
        c.place.lng == null
      ) {
        continue;
      }
      const ab = distanceMeters(
        { lat: a.place.lat, lng: a.place.lng },
        { lat: b.place.lat, lng: b.place.lng },
      );
      const ac = distanceMeters(
        { lat: a.place.lat, lng: a.place.lng },
        { lat: c.place.lat, lng: c.place.lng },
      );
      const bc = distanceMeters(
        { lat: b.place.lat, lng: b.place.lng },
        { lat: c.place.lat, lng: c.place.lng },
      );
      if (ab > MAX_BACKTRACK_M && ac < ab && bc < ab) {
        routePass = false;
        backtrackScore += 1;
        // Geometric backtrack heuristic has high false-positive rate in dense cities.
        pushWarn(
          warnings,
          "route_backtrack",
          `route_backtrack:day${plan.day}:${a.name}->${b.name}->${c.name}`,
          plan.day,
          [placeId(a.place), placeId(b.place), placeId(c.place)].filter(Boolean),
        );
      }
    }

    logAiPipeline(
      "[ITINERARY_ROUTE_VALIDATION]",
      `day=${plan.day}`,
      `distanceKm=${dayDistanceKm.toFixed(1)}`,
      `backtrackScore=${backtrackScore}`,
      `pass=${routePass}`,
    );
  }

  let nearbyCoverage: NearbyExtensionCoverage | undefined;
  const extensions = (input.nearbyExtensions ?? [])
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);
  if (extensions.length) {
    nearbyCoverage = evaluateNearbyCoverage(plans, extensions);
    const missing = nearbyCoverage.missingExtensions;
    logAiPipeline(
      "[ITINERARY_NEARBY_COVERAGE]",
      `expected=${nearbyCoverage.expectedExtensions.join(",")}`,
      `covered=${nearbyCoverage.coveredExtensions.join(",")}`,
      `missing=${missing.join(",")}`,
      `pass=${missing.length === 0}`,
    );
    if (missing.length) {
      pushFail(
        failedRules,
        "nearby_extension_coverage",
        `missing_extensions:${missing.join(",")}`,
        undefined,
        nearbyCoverage.affectedPlaceIds,
        nearbyCoverage.affectedDays,
      );
    } else {
      for (const ext of nearbyCoverage.expectedExtensions) {
        const days = nearbyCoverage.daysByExtension[ext] ?? [];
        const conc = nearbyCoverage.concentratedCounts[ext] ?? 0;
        if (days.length >= 3) {
          pushFail(
            failedRules,
            "nearby_extension_coverage",
            `scattered_extension:${ext}:days=${days.join(",")}`,
            undefined,
            nearbyCoverage.affectedPlaceIds,
            days,
          );
        } else if (conc > 0 && conc < NEARBY_CONCENTRATE_MIN) {
          pushWarn(warnings, "nearby_extension_coverage", `thin_extension_day:${ext}:count=${conc}`);
        } else if (conc > NEARBY_CONCENTRATE_MAX) {
          pushWarn(warnings, "nearby_extension_coverage", `dense_extension_day:${ext}:count=${conc}`);
        } else {
          logRule("nearby_extension_coverage", true, {
            details: `ext=${ext},concentrated=${conc}`,
          });
        }
      }
    }
  }

  if (requestedDays >= 2 && plans.length >= 2) {
    const counts = plans.map((p) => p.entries.length);
    const max = Math.max(...counts, 0);
    const positive = counts.filter((c) => c > 0);
    const min = positive.length ? Math.min(...positive) : 0;
    if (max - min >= 3 && min >= HARD_MIN_PLACES_FULL_DAY) {
      pushWarn(warnings, "multi_day_balance", `uneven_distribution:${counts.join(",")}`);
    }
    const typeByDay = plans.map((plan) =>
      plan.entries.map((e) => (e.place.primaryType ?? "unknown").toLowerCase()),
    );
    const sig = (types: string[]) => [...types].sort().join("|");
    if (
      typeByDay.length >= 2 &&
      typeByDay.every((t) => t.length > 0) &&
      typeByDay.every((t) => sig(t) === sig(typeByDay[0]!))
    ) {
      pushWarn(warnings, "multi_day_balance", "identical_type_composition_across_days");
    }
    if (!failedRules.some((r) => r.code === "multi_day_balance")) {
      logRule("multi_day_balance", true, { details: `counts=${counts.join(",")}` });
    }
  }

  return { failedRules, warnings, nearbyCoverage };
}

function buildScore(failedCount: number, warnCount: number): number {
  // warnings 輕扣，且上限 20，避免 hours_unknown 大量刷分
  const warnDeduction = Math.min(20, warnCount * WARN_PENALTY);
  return Math.max(0, Math.min(100, 100 - failedCount * FAIL_PENALTY - warnDeduction));
}

function collectAffected(
  failedRules: ItineraryFailedRule[],
  warnings: ItineraryWarning[],
): { affectedDays: number[]; affectedPlaceIds: string[] } {
  const days = new Set<number>();
  const placeIds = new Set<string>();
  for (const item of [...failedRules, ...warnings]) {
    if (item.day != null) days.add(item.day);
    for (const id of item.placeIds ?? []) {
      if (id) placeIds.add(id);
    }
  }
  return {
    affectedDays: [...days].sort((a, b) => a - b),
    affectedPlaceIds: [...placeIds],
  };
}

function buildReplanReasons(failedRules: ItineraryFailedRule[]): string[] {
  const codes = new Set(failedRules.map((r) => r.code));
  const reasons: string[] = [];
  if (codes.has("missing_days") || codes.has("days_date_consistency")) {
    reasons.push("replan_for_full_day_coverage");
  }
  if (codes.has("day_place_count") || codes.has("day_capacity_pace_lock")) {
    reasons.push("replan_for_day_capacity");
  }
  if (codes.has("daily_category_diversity")) reasons.push("replan_daily_category_diversity");
  if (codes.has("place_duplicate")) reasons.push("replan_to_dedupe_places");
  if (codes.has("meal_slot_category") || codes.has("nightlife_timing")) {
    reasons.push("replan_meal_or_nightlife_slots");
  }
  if (codes.has("business_hours_cover")) reasons.push("replan_for_open_hours");
  if (
    codes.has("route_travel_time") ||
    codes.has("route_backtrack") ||
    codes.has("timeline_conflict")
  ) {
    reasons.push("replan_for_route_timeline");
  }
  if (codes.has("user_exclusions") || codes.has("unsuitable_place")) {
    reasons.push("replan_to_replace_excluded_or_unsuitable");
  }
  if (codes.has("nearby_extension_coverage")) {
    reasons.push("replan_for_nearby_extension_coverage");
  }
  if (codes.has("multi_day_balance")) reasons.push("replan_for_multi_day_balance");
  if (codes.has("persistence_mismatch")) reasons.push("replan_persistence_mismatch");
  return reasons;
}

/**
 * 結構化行程驗證。Flag OFF 時回傳 pass-through，不跑規則。
 * **絕不**修改 `plans`、不新增地點、不重排。
 */
export function validateItineraryPlan(input: ItineraryValidatorInput): ItineraryValidationResult {
  if (!isItineraryValidatorEnabled()) {
    const result = passThroughResult();
    lastResult = result;
    return result;
  }

  const stopCount = input.plans.reduce((n, p) => n + p.entries.length, 0);
  logAiPipeline(
    "[ITINERARY_VALIDATOR_START]",
    `destination=${input.destination ?? ""}`,
    `days=${input.requestedDays}`,
    `path=${input.creationPath ?? "style"}`,
    `nearbyExtensions=${(input.nearbyExtensions ?? []).join(",")}`,
    `plannerStopCount=${stopCount}`,
  );

  const { failedRules, warnings, nearbyCoverage } = runRules(input);

  // Safety net: never fail user_exclusions when no exclusion signal exists.
  const exclusionKeywords = resolveExclusionKeywords(input);
  const hasExclusionSignal =
    exclusionKeywords.length > 0 ||
    (input.excludePlaceIds?.length ?? 0) > 0 ||
    (input.rejectedPlaceNames?.length ?? 0) > 0;
  const cleanedFails = hasExclusionSignal
    ? failedRules
    : failedRules.filter((r) => r.code !== "user_exclusions");
  if (!hasExclusionSignal && failedRules.some((r) => r.code === "user_exclusions")) {
    logAiPipeline(
      "[ITINERARY_USER_EXCLUSION_CHECK]",
      "sessionExclusions=none",
      "memoryExclusions=none",
      "matched=none",
      "pass=true",
      "note=stripped_false_user_exclusions",
    );
  }

  const { affectedDays, affectedPlaceIds } = collectAffected(cleanedFails, warnings);
  const result: ItineraryValidationResult = {
    pass: cleanedFails.length === 0,
    score: buildScore(cleanedFails.length, warnings.length),
    failedRules: cleanedFails,
    warnings,
    affectedDays,
    affectedPlaceIds,
    validatorVersion: ITINERARY_VALIDATOR_VERSION,
    replanReasons: buildReplanReasons(cleanedFails),
    path: "validator",
    nearbyCoverage,
  };
  lastResult = result;

  logAiPipeline(
    "[ITINERARY_VALIDATOR_INPUT]",
    `destination=${input.destination ?? ""}`,
    `days=${input.requestedDays}`,
    `stopCount=${stopCount}`,
    `path=${input.creationPath ?? "style"}`,
  );

  logAiPipeline(
    "[ITINERARY_VALIDATOR_RESULT]",
    `pass=${result.pass}`,
    `score=${result.score}`,
    `failedRules=${result.failedRules.map((r) => r.code).join(",")}`,
    `warnings=${result.warnings.map((w) => w.code).join(",")}`,
    `replanReasons=${result.replanReasons.join("|")}`,
    `affectedDays=${result.affectedDays.join(",")}`,
  );

  return result;
}

/** Planner / Persistence / UI dayCounts 比對；matched=false 不得標記建立成功 */
export function compareItineraryPersistenceDayCounts(
  input: PersistenceDayCountsCompareInput,
): PersistenceDayCountsCompareResult {
  const { plannerDayCounts, validatedDayCounts, persistedDayCounts, uiDayCounts } = input;
  const same = (a: number[], b: number[]) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const matched =
    same(plannerDayCounts, validatedDayCounts) &&
    same(validatedDayCounts, persistedDayCounts) &&
    same(persistedDayCounts, uiDayCounts);

  logAiPipeline(
    "[ITINERARY_VALIDATOR_PERSISTENCE_COMPARE]",
    `plannerDayCounts=${plannerDayCounts.join(",")}`,
    `validatedDayCounts=${validatedDayCounts.join(",")}`,
    `persistedDayCounts=${persistedDayCounts.join(",")}`,
    `uiDayCounts=${uiDayCounts.join(",")}`,
    `matched=${matched}`,
  );

  return {
    matched,
    plannerDayCounts,
    validatedDayCounts,
    persistedDayCounts,
    uiDayCounts,
  };
}

export function logItineraryDeliveryAllowed(
  result: ItineraryValidationResult,
  dayCounts: number[],
): void {
  const stopCount = dayCounts.reduce((a, b) => a + b, 0);
  logAiPipeline(
    "[ITINERARY_DELIVERY_START]",
    `tripDays=${dayCounts.length}`,
    `stopCount=${stopCount}`,
    `dayCount=${dayCounts.length}`,
  );
  logAiPipeline(
    "[ITINERARY_DELIVERY_ALLOWED]",
    `score=${result.score}`,
    `dayCounts=${dayCounts.join(",")}`,
    `nearbyCovered=${(result.nearbyCoverage?.coveredExtensions ?? []).join(",")}`,
  );
  logAiPipeline(
    "[ITINERARY_DELIVERY_RESULT]",
    "success=true",
    "failureReason=",
  );
}

export function logItineraryDeliveryBlocked(
  reason: string,
  validation?: ItineraryValidationResult | null,
): void {
  const failed =
    validation?.failedRules.map((r) => `${r.code}:${r.message}`).join("|") ?? "";
  const warnings =
    validation?.warnings.map((w) => `${w.code}:${w.message}`).join("|") ?? "";
  const score = validation?.score != null ? String(validation.score) : "";
  const affectedDays = validation?.affectedDays?.join(",") ?? "";
  const primary =
    validation?.failedRules[0]?.code ??
    (reason === "validator_failed" ? "validator_failed" : reason);
  logAiPipeline("[ITINERARY_DELIVERY_BLOCKED]", `reason=${reason}`);
  logAiPipeline(
    "[ITINERARY_DELIVERY_BLOCKED_DETAIL]",
    `reason=${reason}`,
    `pass=${validation?.pass ?? "unknown"}`,
    `score=${score}`,
    `failedRules=${failed || "(none)"}`,
    `warnings=${warnings || "(none)"}`,
    `affectedDays=${affectedDays || "(none)"}`,
    `path=${validation?.path ?? "unknown"}`,
    `validatorVersion=${validation?.validatorVersion ?? ""}`,
  );
  logAiPipeline(
    "[ITINERARY_DELIVERY_RESULT]",
    "success=false",
    `failureReason=${reason}`,
    `failedRules=${validation?.failedRules.map((r) => r.code).join(",") ?? ""}`,
  );
  logAiPipeline(
    "[ITINERARY_FAILURE_REASON]",
    `reason=${reason}`,
    `failedRules=${validation?.failedRules.map((r) => r.code).join(",") ?? ""}`,
  );
  logAiPipeline(
    "[ITINERARY_FAILURE_CHAIN]",
    JSON.stringify({
      primary,
      validator: reason === "validator_failed" || validation ? "validator_failed" : "",
      persistence: reason === "payload_incomplete" ? "payload_incomplete" : "",
      payloadPresent: validation != null,
      dayCount: validation?.affectedDays.length ?? 0,
      stopCount: 0,
      failedRules: validation?.failedRules.map((rule) => rule.code) ?? [],
      warnings: validation?.warnings.map((warning) => warning.code) ?? [],
      affectedDays: validation?.affectedDays ?? [],
    }),
  );
}

export function dayCountsOfPlans(
  plans: readonly { day: number; entries: readonly unknown[] }[],
): number[] {
  return [...plans].sort((a, b) => a.day - b.day).map((plan) => plan.entries.length);
}

/**
 * 失敗規則是否全為可修復（soft）規則。
 */
export function isOnlySoftRepairableFailures(
  result: ItineraryValidationResult | undefined | null,
): boolean {
  if (!result?.failedRules.length) return true;
  return result.failedRules.every((r) =>
    (SOFT_REPAIRABLE_RULE_CODES as readonly string[]).includes(r.code),
  );
}

/**
 * 是否含硬阻擋規則（結構／持久化不一致等）。
 */
export function hasHardBlockFailures(
  result: ItineraryValidationResult | undefined | null,
): boolean {
  if (!result?.failedRules.length) return false;
  return result.failedRules.some((r) =>
    (HARD_BLOCK_RULE_CODES as readonly string[]).includes(r.code),
  );
}

/**
 * 是否含「不可先修」的硬阻擋（排除 missing_days 等 REPAIR_FIRST）。
 * Auto Repair 迴圈用此判斷；最終交付仍看 hasHardBlockFailures / pass。
 */
export function hasUnrepairableHardBlockFailures(
  result: ItineraryValidationResult | undefined | null,
): boolean {
  if (!result?.failedRules.length) return false;
  const repairFirst = new Set<string>(REPAIR_FIRST_HARD_RULE_CODES);
  return result.failedRules.some(
    (r) =>
      (HARD_BLOCK_RULE_CODES as readonly string[]).includes(r.code) &&
      !repairFirst.has(r.code),
  );
}

/**
 * Flag ON 且 pass=false → 不可交付。
 * Soft 失敗須經 Auto Repair soft-pass（品質門檻）後才會 pass=true。
 * Flag OFF → 一律允許（pass-through）。
 */
export function shouldBlockItineraryDelivery(
  result: ItineraryValidationResult | undefined | null,
): boolean {
  if (!result) return false;
  if (result.path === "pass_through") return false;
  return result.pass === false;
}
