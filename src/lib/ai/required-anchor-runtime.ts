/**
 * Required Anchor / Selected Place Lock / Recommendation Integrity Runtime.
 *
 * Product principle: AI 推薦 ≠ AI 自己決定.
 * Once the user selects combination places, Planner may schedule / reorder /
 * adjust transport — but must not drop or arbitrarily replace locked places
 * unless Google Places says the place is missing or permanently closed.
 *
 * Flow:
 *   selectedPlace → requiredAnchor → coverage → planner → validator → delivery
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { resolveCanonicalPlaceIdentity } from "@/lib/place-canonical-identity";

function normalizePlaceNameKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

function placeNameMatchesCandidate(placeName: string, candidate: string): boolean {
  const key = normalizePlaceNameKey(placeName);
  const allowed = normalizePlaceNameKey(candidate);
  if (!key || !allowed) return false;
  return key === allowed || key.includes(allowed) || allowed.includes(key);
}

export type RequiredAnchorStatus =
  | "required"
  | "covered"
  | "missing"
  | "replaced"
  | "unresolvable_google"
  | "permanently_closed";

export type RequiredAnchorPlace = {
  name: string;
  normalizedName: string;
  placeId?: string;
  locked: true;
  source: "selected_combination" | "favorite" | "user_explicit";
  status: RequiredAnchorStatus;
  replacementName?: string;
  reason?: string;
};

export type SelectedPlaceLock = {
  names: string[];
  normalizedNames: Set<string>;
  placeIds: Set<string>;
  anchors: RequiredAnchorPlace[];
};

export type SelectedPlaceCoverageSummary = {
  required: string[];
  covered: string[];
  missing: string[];
  replacement: Array<{ from: string; to: string; reason: string }>;
  coveragePercent: number;
};

export type RecommendationIntegrityResult = {
  ok: boolean;
  selectedPlaces: string[];
  requiredAnchorPlaces: string[];
  coveredPlaces: string[];
  missingPlaces: string[];
  replacementPlaces: Array<{ from: string; to: string; reason: string }>;
  coveragePercent: number;
  reasons: string[];
};

export type PlannerDeliveryCheckResult = {
  ok: boolean;
  coverageOk: boolean;
  parentCollapseOk: boolean;
  replacementOk: boolean;
  validatorOk: boolean;
  coveragePercent: number;
  reasons: string[];
  deliveryResult: "deliver" | "replan" | "block";
};

export function normalizeRequiredAnchorName(name: string): string {
  return normalizePlaceNameKey(name);
}

/** Build required anchors from every user-selected combination place name. */
export function buildRequiredAnchorPlaces(params: {
  selectedPlaceNames: string[];
  placeIdsByName?: Record<string, string>;
  source?: RequiredAnchorPlace["source"];
}): RequiredAnchorPlace[] {
  const source = params.source ?? "selected_combination";
  const seen = new Set<string>();
  const anchors: RequiredAnchorPlace[] = [];
  for (const raw of params.selectedPlaceNames) {
    const name = raw.trim();
    const key = normalizePlaceNameKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    anchors.push({
      name,
      normalizedName: key,
      placeId: params.placeIdsByName?.[name]?.trim() || undefined,
      locked: true,
      source,
      status: "required",
    });
  }
  return anchors;
}

/** Lock selected combination / favorite / explicit places against removal. */
export function buildSelectedPlaceLock(params: {
  selectedPlaceNames?: string[];
  placeIds?: string[];
  anchors?: RequiredAnchorPlace[];
  source?: RequiredAnchorPlace["source"];
}): SelectedPlaceLock {
  const anchors =
    params.anchors ??
    buildRequiredAnchorPlaces({
      selectedPlaceNames: params.selectedPlaceNames ?? [],
      source: params.source,
    });
  const names = anchors.map((a) => a.name);
  const normalizedNames = new Set(anchors.map((a) => a.normalizedName));
  const placeIds = new Set(
    [
      ...(params.placeIds ?? []),
      ...anchors.map((a) => a.placeId).filter((id): id is string => Boolean(id)),
    ]
      .map((id) => resolveCanonicalPlaceIdentity({ id }).identityKey)
      .filter(Boolean),
  );
  return { names, normalizedNames, placeIds, anchors };
}

export function isPlaceNameLocked(
  placeName: string | null | undefined,
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  if (!lock || !placeName?.trim()) return false;
  const key = normalizePlaceNameKey(placeName);
  if (lock.normalizedNames.has(key)) return true;
  return lock.names.some((n) => placeNameMatchesCandidate(placeName, n));
}

export function isPlaceIdLocked(
  placeId: string | null | undefined,
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  if (!lock || !placeId?.trim()) return false;
  return lock.placeIds.has(resolveCanonicalPlaceIdentity({ id: placeId }).identityKey);
}

export function isPlaceLocked(
  place: { name?: string | null; placeName?: string | null; id?: string | null; googlePlaceId?: string | null },
  lock: SelectedPlaceLock | null | undefined,
): boolean {
  if (!lock) return false;
  const identity = resolveCanonicalPlaceIdentity(place);
  if (identity.canonicalPlaceId && lock.placeIds.has(identity.identityKey)) return true;
  const name = place.placeName ?? place.name;
  return isPlaceNameLocked(name, lock);
}

/**
 * Allowed replacement reasons only — Google cannot resolve / permanently closed / missing.
 * Arbitrary nearby swaps are forbidden for locked places.
 */
export function isAllowedAnchorReplacementReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    reason === "google_not_found" ||
    reason === "permanently_closed" ||
    reason === "place_does_not_exist" ||
    reason === "unresolvable_google" ||
    reason.startsWith("google_") ||
    reason.startsWith("closed_")
  );
}

export function markAnchorUnresolvable(
  anchors: RequiredAnchorPlace[],
  placeName: string,
  reason: "unresolvable_google" | "permanently_closed",
): RequiredAnchorPlace[] {
  const key = normalizePlaceNameKey(placeName);
  return anchors.map((a) =>
    a.normalizedName === key || placeNameMatchesCandidate(placeName, a.name)
      ? { ...a, status: reason, reason }
      : a,
  );
}

export function markAnchorReplaced(
  anchors: RequiredAnchorPlace[],
  fromName: string,
  toName: string,
  reason: string,
): RequiredAnchorPlace[] {
  if (!isAllowedAnchorReplacementReason(reason)) {
    return anchors;
  }
  const key = normalizePlaceNameKey(fromName);
  return anchors.map((a) =>
    a.normalizedName === key || placeNameMatchesCandidate(fromName, a.name)
      ? { ...a, status: "replaced", replacementName: toName, reason }
      : a,
  );
}

function scheduledNamesCoverAnchor(
  anchor: RequiredAnchorPlace,
  scheduledNames: string[],
  replacements?: Array<{ from: string; to: string }>,
): "covered" | "replaced" | "missing" {
  if (
    scheduledNames.some(
      (n) =>
        placeNameMatchesCandidate(n, anchor.name) ||
        (anchor.replacementName
          ? placeNameMatchesCandidate(n, anchor.replacementName)
          : false),
    )
  ) {
    return anchor.status === "replaced" ? "replaced" : "covered";
  }
  const rep = replacements?.find(
    (r) =>
      placeNameMatchesCandidate(r.from, anchor.name) ||
      normalizePlaceNameKey(r.from) === anchor.normalizedName,
  );
  if (rep && scheduledNames.some((n) => placeNameMatchesCandidate(n, rep.to))) {
    return "replaced";
  }
  if (
    anchor.status === "unresolvable_google" ||
    anchor.status === "permanently_closed"
  ) {
    return "covered"; // excused — Google cannot deliver
  }
  return "missing";
}

/** Coverage summary for every required anchor (100% target). */
export function buildSelectedPlaceCoverageSummary(params: {
  anchors: RequiredAnchorPlace[];
  scheduledPlaceNames: string[];
  replacements?: Array<{ from: string; to: string; reason: string }>;
}): SelectedPlaceCoverageSummary {
  const required = params.anchors.map((a) => a.name);
  const covered: string[] = [];
  const missing: string[] = [];
  const replacement: Array<{ from: string; to: string; reason: string }> = [];

  for (const anchor of params.anchors) {
    const outcome = scheduledNamesCoverAnchor(
      anchor,
      params.scheduledPlaceNames,
      params.replacements,
    );
    if (outcome === "missing") {
      missing.push(anchor.name);
      continue;
    }
    covered.push(anchor.name);
    if (outcome === "replaced") {
      const rep =
        params.replacements?.find((r) =>
          placeNameMatchesCandidate(r.from, anchor.name),
        ) ??
        (anchor.replacementName
          ? {
              from: anchor.name,
              to: anchor.replacementName,
              reason: anchor.reason ?? "allowed_replacement",
            }
          : null);
      if (rep) replacement.push(rep);
    }
  }

  const denom = Math.max(required.length, 1);
  const coveragePercent =
    required.length === 0
      ? 100
      : Math.round(((required.length - missing.length) / denom) * 100);

  const summary: SelectedPlaceCoverageSummary = {
    required,
    covered,
    missing,
    replacement,
    coveragePercent,
  };

  logAiPipeline(
    "[SELECTED_PLACE_COVERAGE_SUMMARY]",
    `required=[${summary.required.join("|")}]`,
    `covered=[${summary.covered.join("|")}]`,
    `missing=[${summary.missing.join("|")}]`,
    `replacement=[${summary.replacement.map((r) => `${r.from}→${r.to}`).join("|")}]`,
    `coveragePercent=${summary.coveragePercent}`,
  );

  return summary;
}

/**
 * Hard integrity gate: every required anchor must be covered (or excused by Google).
 * Missing places must not be delivered — caller must repair / replan.
 */
export function recommendationIntegrityCheck(params: {
  selectedPlaces: string[];
  anchors: RequiredAnchorPlace[];
  scheduledPlaceNames: string[];
  replacements?: Array<{ from: string; to: string; reason: string }>;
}): RecommendationIntegrityResult {
  const summary = buildSelectedPlaceCoverageSummary({
    anchors: params.anchors,
    scheduledPlaceNames: params.scheduledPlaceNames,
    replacements: params.replacements,
  });

  const reasons: string[] = [];
  if (summary.missing.length) {
    reasons.push(`missing_required_anchors:${summary.missing.join(",")}`);
  }
  for (const rep of summary.replacement) {
    if (!isAllowedAnchorReplacementReason(rep.reason)) {
      reasons.push(`illegal_replacement:${rep.from}→${rep.to}:${rep.reason}`);
    }
  }

  const ok = reasons.length === 0 && summary.coveragePercent === 100;
  const result: RecommendationIntegrityResult = {
    ok,
    selectedPlaces: [...params.selectedPlaces],
    requiredAnchorPlaces: summary.required,
    coveredPlaces: summary.covered,
    missingPlaces: summary.missing,
    replacementPlaces: summary.replacement,
    coveragePercent: summary.coveragePercent,
    reasons,
  };

  logAiPipeline(
    "[RECOMMENDATION_INTEGRITY]",
    `selectedPlaces=[${result.selectedPlaces.join("|")}]`,
    `requiredAnchorPlaces=[${result.requiredAnchorPlaces.join("|")}]`,
    `coveredPlaces=[${result.coveredPlaces.join("|")}]`,
    `missingPlaces=[${result.missingPlaces.join("|")}]`,
    `replacementPlaces=[${result.replacementPlaces.map((r) => `${r.from}→${r.to}`).join("|")}]`,
    `coveragePercent=${result.coveragePercent}`,
    `ok=${result.ok}`,
  );

  return result;
}

/** Final delivery gate before user sees the itinerary. */
export function plannerDeliveryCheck(params: {
  integrity: RecommendationIntegrityResult;
  parentDuplicateNames?: string[];
  samePlaceAliasDuplicates?: string[];
  qualityGateOk?: boolean;
  routeOk?: boolean;
  validatorOk?: boolean;
  plannerScore?: number;
  parentCollapseCount?: number;
  replacementCount?: number;
}): PlannerDeliveryCheckResult {
  const reasons: string[] = [];
  const coverageOk =
    params.integrity.ok && params.integrity.coveragePercent === 100;
  if (!coverageOk) {
    reasons.push(...params.integrity.reasons);
    reasons.push(`coverage=${params.integrity.coveragePercent}`);
  }

  const parentCollapseOk = !(params.parentDuplicateNames?.length);
  if (!parentCollapseOk) {
    reasons.push(
      `parent_attraction_duplicate:${params.parentDuplicateNames!.join(",")}`,
    );
  }

  if (params.samePlaceAliasDuplicates?.length) {
    reasons.push(
      `alias_duplicate:${params.samePlaceAliasDuplicates.join(",")}`,
    );
  }

  const replacementOk = !params.integrity.replacementPlaces.some(
    (r) => !isAllowedAnchorReplacementReason(r.reason),
  );
  if (!replacementOk) {
    reasons.push("illegal_replacement_present");
  }

  if (params.qualityGateOk === false) {
    reasons.push("quality_gate_failed");
  }
  if (params.routeOk === false) {
    reasons.push("route_not_ok");
  }
  const validatorOk = params.validatorOk !== false;
  if (!validatorOk) {
    reasons.push("validator_failed");
  }

  const ok =
    coverageOk &&
    parentCollapseOk &&
    replacementOk &&
    !(params.samePlaceAliasDuplicates?.length) &&
    params.qualityGateOk !== false &&
    params.routeOk !== false &&
    validatorOk;

  const deliveryResult: PlannerDeliveryCheckResult["deliveryResult"] = ok
    ? "deliver"
    : coverageOk
      ? "replan"
      : "replan";

  const result: PlannerDeliveryCheckResult = {
    ok,
    coverageOk,
    parentCollapseOk,
    replacementOk,
    validatorOk,
    coveragePercent: params.integrity.coveragePercent,
    reasons,
    deliveryResult: ok ? "deliver" : deliveryResult,
  };

  logAiPipeline(
    "[PLANNER_DELIVERY_SUMMARY]",
    `Coverage=${result.coveragePercent}%`,
    `ParentCollapse=${params.parentCollapseCount ?? 0}`,
    `Replacement=${params.replacementCount ?? params.integrity.replacementPlaces.length}`,
    `Validator=${result.validatorOk}`,
    `PlannerScore=${params.plannerScore ?? "n/a"}`,
    `DeliveryResult=${result.deliveryResult}`,
    `ok=${result.ok}`,
    `reasons=${result.reasons.join("|") || "none"}`,
  );

  return result;
}

/** Resolve planner pace from trip style + Plus quiz pace. */
export function resolvePlannerPaceFromProfile(params: {
  style?: string | null;
  quizPace?: "slow" | "medium" | "active" | null;
}): "slow" | "medium" | "active" {
  if (params.quizPace === "slow" || params.quizPace === "active" || params.quizPace === "medium") {
    return params.quizPace;
  }
  if (params.style === "slow_nature") return "slow";
  return "medium";
}

/** Suggested stay copy influenced by Plus quiz pace. */
export function suggestStayDurationForPace(
  pace?: "slow" | "medium" | "active" | null,
): string {
  if (pace === "slow") return "2-3 小時";
  if (pace === "active") return "45-90 分鐘";
  return "1-2 小時";
}

/** Max stops per full day — quiz pace overrides trip-style defaults. */
export function maxPlacesPerDayForPace(
  pace?: "slow" | "medium" | "active" | null,
): number {
  if (pace === "slow") return 4;
  if (pace === "active") return 8;
  return 6;
}
