/**
 * Destination Resolution Authority (Phase 1) — single, reusable, pure destination verdict.
 *
 * Order: place first, activity second.
 *   a. curated district / provider-validated cache scope  → curated
 *   b. the extracted label itself is a known destination    → confirmed
 *   c. known parent + unvalidated tail                      → pending_provider (+ areaCandidate)
 *   d. no known parent: provisional geographic fragment     → pending_provider (+ provisionalCandidate)
 *   e. no destination fragment in this turn: confirmed session destination → confirmed (source: session)
 *   otherwise                                               → ambiguous
 *
 * This module never calls geocode / fetch / AI. Provider evidence is handled in two pure steps:
 *   1. classifyDestinationProviderEvidence(candidate, outcome) turns the caller's existing
 *      geocode envelope (or thrown error) into a three-state verdict:
 *        validated   — known-parent candidates only: the provider's ADMINISTRATIVE fields
 *                      (district / sublocality) equal the candidate area, and city / region
 *                      equal the parent, after normalisation. Exact equality only — never
 *                      substring containment, and never names that appear only in
 *                      formattedName / displayLabel / address (POI names are not admin proof).
 *        rejected    — reserved. The current envelope (no place types, no partial_match) has
 *                      no signal that can safely disprove a tail, so classify never emits it.
 *        unavailable — network error, timeout, zero results, insufficient or uncertain
 *                      evidence (including "only the parent city matched"), and ALWAYS for
 *                      provisional (no trusted parent) candidates — see Phase 1 limit below.
 *   2. applyDestinationProviderValidation(resolution, verdict, activityEvidence?) applies it.
 *
 * rejected is NOT an activity. A tail is separated as activityPreference only when the verdict
 * is rejected, the parent city is confirmed, AND the caller-supplied activity evidence
 * (from an existing parser) normalises to exactly the whole tail. Otherwise the resolution
 * stays ambiguous (existing clarification flow).
 * The verdict lives in `providerValidation`; `source` only describes where the result came from.
 *
 * Phase 1 conservative limit (provisional candidates): when the user named no trusted parent
 * city, the provider response alone cannot confirm a parent the user never specified (any
 * provider-returned city is structurally indistinguishable from a legitimate one). So
 * provisional candidates are never validated: classify returns unavailable and apply keeps them
 * ambiguous (destination undefined, rawLabel / candidate kept) for the existing clarification
 * flow; they are never a Search / Weather / Credits / Session destination. This is NOT a
 * permanent judgement that the place is invalid: once the user adds trusted geography (country /
 * region / city) and the input takes the known-parent path, the strict known-parent rules apply.
 *
 * No verb / suffix / activity / place-name lists live here: tails are never classified by wording.
 */
import {
  applyAreaLocaleAlias,
  areaEvidenceAliases,
  normalizeAreaEvidence,
  parentCityEvidenceAliases,
  stripAdministrativeSuffix,
} from "@/lib/ai/destination-area-aliases";
import type { DestinationEntityType } from "@/lib/ai/destination-entity";
import { isTravelRegionLabel } from "@/lib/ai/destination-entity";
import type { GeocodeFnEnvelope } from "@/lib/ai/destination-provider-result";
import type { TripLocation } from "@/lib/location/types";
import {
  extractGenericDestinationAreaCandidate,
  extractProvisionalDestinationAreaCandidate,
  resolveCuratedOrCachedDestinationAreaScope,
  type DestinationAreaCandidate,
  type DestinationAreaScope,
  type ProvisionalDestinationAreaCandidate,
} from "@/lib/ai/destination-travel-profile";
import {
  isKnownCountryLabel,
  isKnownDestinationLabel,
  isKnownScenicLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";

/**
 * Only confirmed / curated resolutions carry a searchable `destination`.
 * pending_provider / ambiguous always have `destination: undefined`.
 */
export type DestinationResolutionConfidence =
  | "confirmed"
  | "curated"
  | "pending_provider"
  | "ambiguous";

export type DestinationResolutionSource =
  /** Curated profile district or provider-validated area cache. */
  | "curated_scope"
  /** Extracted label is itself in the existing known-destination tables. */
  | "known_city"
  /** Known parent destination + unvalidated tail (awaiting provider). */
  | "known_parent_tail"
  /** No known parent; provisional geographic fragment (awaiting provider). */
  | "provisional_fragment"
  /** Turn had no destination fragment; confirmed session destination reused. */
  | "session"
  /** Destination comes from provider-validated scope. */
  | "provider_validated"
  /**
   * Confirmed parent kept; tail separated as activityPreference because the verdict was
   * rejected and the caller's activity evidence equals the whole tail.
   * (Provider verdict is in `providerValidation`.)
   */
  | "activity_evidence_split"
  /** Nothing recognisable. */
  | "none";

/** Three-state provider contract. See classifyDestinationProviderEvidence(). */
export type DestinationProviderValidationStatus = "validated" | "rejected" | "unavailable";

/**
 * A `validated` verdict is ONLY trusted when it was produced by
 * classifyDestinationProviderEvidence() (registered in a module-private WeakMap, frozen, and
 * bound to the exact candidate identity it verified). Hand-written literals, copies, or spreads
 * (`{ ...verdict }`) of a validated verdict are treated as unavailable by
 * applyDestinationProviderValidation().
 */
export type DestinationProviderVerdict =
  | { status: "validated"; scope: DestinationAreaScope }
  | { status: "rejected"; scope?: undefined }
  | { status: "unavailable"; scope?: undefined };

/** What the caller observed from the existing geocode call (never performed here). */
export type DestinationProviderOutcome =
  | { kind: "envelope"; envelope: GeocodeFnEnvelope | null | undefined }
  | { kind: "thrown"; error: unknown };

/** Whole-label scope (city / country / region / scenic label as listed in known tables). */
export type DestinationLabelScope = {
  displayLabel: string;
  searchScope: "city";
};

export type DestinationResolutionGeographicScope = DestinationAreaScope | DestinationLabelScope;

declare const clarificationOnlyBrand: unique symbol;

/**
 * Raw user wording, kept ONLY for clarification prompts and logging.
 * MUST NOT be used for Search, Geocoding, Weather, Credits, or any provider/billing input.
 * Use `DestinationResolution.destination` (confirmed / curated only) for those.
 */
export type ClarificationOnlyRawLabel = string & {
  readonly [clarificationOnlyBrand]: "clarification_only";
};

export type DestinationResolution<TCategory = unknown> = {
  /** Searchable destination. Present only when confidence is confirmed | curated. */
  destination: string | undefined;
  destinationType: DestinationEntityType;
  geographicScope: DestinationResolutionGeographicScope | undefined;
  /**
   * The extractor's tail (`areaCandidate.area`). Set only by applyDestinationProviderValidation()
   * when the verdict is rejected, the parent is confirmed, AND the caller-supplied activity
   * evidence normalises to exactly this whole tail. Note: the tail is the extractor's compacted
   * form (whitespace / separators removed), not byte-for-byte user wording; it is never
   * re-derived or invented here.
   */
  activityPreference: string | undefined;
  /** Pass-through of the caller's existing classification; no rules are added here. */
  recommendationCategory: TCategory | undefined;
  confidence: DestinationResolutionConfidence;
  source: DestinationResolutionSource;
  /** Clarification / logging only — see ClarificationOnlyRawLabel. */
  rawLabel: ClarificationOnlyRawLabel | undefined;
  /** Known parent + tail awaiting provider validation (step c). */
  areaCandidate?: DestinationAreaCandidate;
  /** Parent-less geographic fragment awaiting provider validation (step d). */
  provisionalCandidate?: ProvisionalDestinationAreaCandidate;
  /** Provider verdict, set only by applyDestinationProviderValidation(). */
  providerValidation?: DestinationProviderValidationStatus;
};

/** Caller passes a session destination only after it was confirmed by the existing flow. */
export type ConfirmedSessionDestination = {
  destination: string;
  geographicScope?: DestinationResolutionGeographicScope;
};

export type ResolveDestinationInput<TCategory = unknown> = {
  text: string;
  sessionDestination?: ConfirmedSessionDestination | null;
  recommendationCategory?: TCategory;
};

function asRawLabel(value: string | undefined): ClarificationOnlyRawLabel | undefined {
  const trimmed = value?.trim();
  return trimmed ? (trimmed as ClarificationOnlyRawLabel) : undefined;
}

function labelScope(displayLabel: string): DestinationLabelScope {
  return { displayLabel, searchScope: "city" };
}

/** Entity type from existing known tables only (no new lists, no logging side effects). */
function destinationTypeForLabel(label: string): DestinationEntityType {
  if (isKnownCountryLabel(label)) return "country";
  if (isTravelRegionLabel(label)) return "region";
  if (isKnownTouristCityLabel(label)) return "city";
  if (isKnownScenicLabel(label)) return "attraction";
  return "unknown";
}

function sameLabel(a: string, b: string): boolean {
  const norm = (value: string) => normalizeDestinationLabel(value).replace(/[\s,，、/／-]+/g, "");
  return norm(a) === norm(b);
}

export function resolveDestination<TCategory = unknown>(
  input: ResolveDestinationInput<TCategory>,
): DestinationResolution<TCategory> {
  const text = input.text ?? "";
  const recommendationCategory = input.recommendationCategory;
  const base = {
    activityPreference: undefined,
    recommendationCategory,
  } as const;

  // a. curated district / validated cache
  const curated = resolveCuratedOrCachedDestinationAreaScope(text);
  if (curated) {
    return {
      ...base,
      destination: curated.displayLabel,
      destinationType: "district",
      geographicScope: curated,
      confidence: "curated",
      source: "curated_scope",
      rawLabel: asRawLabel(curated.displayLabel),
    };
  }

  // Curated already excluded, so this is the known-parent + tail candidate (if any).
  const tail = extractGenericDestinationAreaCandidate(text);
  if (tail) {
    // b. the parent+tail label as a whole is already a known destination
    if (isKnownDestinationLabel(tail.displayLabel)) {
      const destination = normalizeDestinationLabel(tail.displayLabel);
      return {
        ...base,
        destination,
        destinationType: destinationTypeForLabel(destination),
        geographicScope: labelScope(destination),
        confidence: "confirmed",
        source: "known_city",
        rawLabel: asRawLabel(tail.displayLabel),
      };
    }
    // c. known parent + unvalidated tail — never classify the tail here
    return {
      ...base,
      destination: undefined,
      destinationType: "unknown",
      geographicScope: undefined,
      confidence: "pending_provider",
      source: "known_parent_tail",
      rawLabel: asRawLabel(tail.displayLabel),
      areaCandidate: { ...tail, validationStatus: "pending_provider" },
    };
  }

  // b. a known destination with no tail
  const known = resolveDestinationFromText(text);
  if (known && isKnownDestinationLabel(known)) {
    const destination = normalizeDestinationLabel(known);
    return {
      ...base,
      destination,
      destinationType: destinationTypeForLabel(destination),
      geographicScope: labelScope(destination),
      confidence: "confirmed",
      source: "known_city",
      rawLabel: asRawLabel(known),
    };
  }

  // d. no known parent: provisional fragment (existing extractor conditions)
  const provisional = extractProvisionalDestinationAreaCandidate(text);
  if (provisional) {
    return {
      ...base,
      destination: undefined,
      destinationType: "unknown",
      geographicScope: undefined,
      confidence: "pending_provider",
      source: "provisional_fragment",
      rawLabel: asRawLabel(provisional.rawLabel),
      provisionalCandidate: provisional,
    };
  }

  // A parsed but unlisted label is a destination fragment: never fall back to session.
  if (known) {
    return {
      ...base,
      destination: undefined,
      destinationType: "unknown",
      geographicScope: undefined,
      confidence: "ambiguous",
      source: "none",
      rawLabel: asRawLabel(known),
    };
  }

  // e. this turn has no destination fragment: reuse the confirmed session destination
  const session = input.sessionDestination;
  if (session?.destination?.trim()) {
    const destination = session.destination.trim();
    const scope = session.geographicScope ?? labelScope(destination);
    return {
      ...base,
      destination,
      destinationType:
        scope.searchScope === "area" ? "district" : destinationTypeForLabel(destination),
      geographicScope: scope,
      confidence: "confirmed",
      source: "session",
      rawLabel: undefined,
    };
  }

  return {
    ...base,
    destination: undefined,
    destinationType: "unknown",
    geographicScope: undefined,
    confidence: "ambiguous",
    source: "none",
    rawLabel: asRawLabel(text),
  };
}

const UNAVAILABLE: DestinationProviderVerdict = { status: "unavailable" };

/**
 * Validated verdicts issued by classifyDestinationProviderEvidence(), keyed by object identity
 * and bound to the candidate identity they verified. Module-private: callers cannot register
 * their own objects, and copies / spreads are different objects (not present here).
 */
const classifiedValidatedVerdicts = new WeakMap<object, string>();

function isProvisionalCandidate(
  candidate: DestinationAreaCandidate | ProvisionalDestinationAreaCandidate,
): candidate is ProvisionalDestinationAreaCandidate {
  return "rawLabel" in candidate && "areaCandidate" in candidate;
}

/** Canonical administrative key: locale alias → strip admin suffix → compact normalise. */
function strictAdministrativeKey(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  return normalizeAreaEvidence(stripAdministrativeSuffix(applyAreaLocaleAlias(raw)));
}

/** Keys of one provider administrative field (as-is and canonical). Exact-match use only. */
function providerFieldKeys(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];
  return [normalizeAreaEvidence(raw), strictAdministrativeKey(raw)].filter(Boolean);
}

function candidateKeySet(aliases: string[], label: string): Set<string> {
  return new Set(
    [
      ...aliases.map((alias) => normalizeAreaEvidence(alias)),
      strictAdministrativeKey(label),
    ].filter(Boolean),
  );
}

/** Exact (normalised) equality only — never substring containment. */
function fieldEquals(value: string | undefined, keys: Set<string>): boolean {
  return providerFieldKeys(value).some((key) => keys.has(key));
}

type AdministrativeField = "district" | "sublocality" | "city" | "region";

/**
 * Strict administrative-scope proof:
 * - the area equals one of `areaFields` (provider administrative fields), exactly;
 * - the parent equals city or region, exactly, in a DIFFERENT field than the area;
 * - area and parent are not the same administrative unit.
 * formattedName / displayLabel / address are never consulted (POI names are not admin proof).
 */
function locationStrictlyMatchesArea(
  area: string,
  parentCity: string,
  location: TripLocation,
  areaFields: readonly AdministrativeField[],
): boolean {
  const areaKey = strictAdministrativeKey(area);
  const parentKey = strictAdministrativeKey(parentCity);
  if (!areaKey || !parentKey || areaKey === parentKey) return false;
  const areaKeys = candidateKeySet(areaEvidenceAliases(area), area);
  const parentKeys = candidateKeySet(parentCityEvidenceAliases(parentCity), parentCity);
  const matchedAreaFields = areaFields.filter((field) => fieldEquals(location[field], areaKeys));
  if (matchedAreaFields.length === 0) return false;
  const parentFields: readonly AdministrativeField[] = ["city", "region"];
  return parentFields.some(
    (field) =>
      fieldEquals(location[field], parentKeys) &&
      matchedAreaFields.some((areaField) => areaField !== field),
  );
}

const KNOWN_PARENT_AREA_FIELDS: readonly AdministrativeField[] = ["district", "sublocality"];

/**
 * Pure three-state classification of an existing geocode outcome. Never calls geocode / fetch.
 *
 * - Provisional candidate (no trusted parent city): always unavailable in Phase 1, whatever
 *   the provider returns. The provider response cannot confirm a parent city the user never
 *   specified, and the destination is never substituted from provider fields. Not a permanent
 *   verdict: adding trusted geography routes the input to the known-parent path below.
 * - validated (known-parent candidate only): envelope has no error, providerResult (if any) is
 *   not a failure, location has a placeId, and locationStrictlyMatchesArea() holds: tail equals
 *   district / sublocality, parent equals city / region.
 *   Equality is after alias / suffix stripping / normalisation; substring containment and
 *   POI-only names (formattedName / displayLabel / address) never validate. Scope is the
 *   candidate label.
 * - rejected: never emitted. Google falls back to the parent city (or a nearby POI) when it
 *   cannot find the tail, and the envelope carries no place types / partial_match, so no
 *   available signal can safely disprove a tail. The type and apply handling are kept.
 * - unavailable: everything else (provisional candidate, thrown, error, null location,
 *   ZERO_RESULTS / EMPTY, no placeId, parent-only evidence, POI-only evidence, other-city
 *   match, uncertain).
 */
export function classifyDestinationProviderEvidence(
  candidate: DestinationAreaCandidate | ProvisionalDestinationAreaCandidate,
  outcome: DestinationProviderOutcome,
): DestinationProviderVerdict {
  // Phase 1 conservative limit: no trusted parent city → never validated (see module header).
  if (isProvisionalCandidate(candidate)) return UNAVAILABLE;
  if (outcome.kind !== "envelope") return UNAVAILABLE;
  const envelope = outcome.envelope;
  if (!envelope || envelope.error != null) return UNAVAILABLE;
  const location = envelope.location;
  if (!location?.placeId) return UNAVAILABLE;
  const providerResult = envelope.providerResult;
  if (providerResult && providerResult.ok === false) return UNAVAILABLE;

  const areaCandidate = candidate;
  if (!areaCandidate.area || !areaCandidate.parentCity) return UNAVAILABLE;
  if (
    !locationStrictlyMatchesArea(
      areaCandidate.area,
      areaCandidate.parentCity,
      location,
      KNOWN_PARENT_AREA_FIELDS,
    )
  ) {
    return UNAVAILABLE;
  }
  const identity = areaIdentityKey(areaCandidate);
  if (!identity) return UNAVAILABLE;
  const scope: DestinationAreaScope = Object.freeze({
    displayLabel: areaCandidate.displayLabel,
    parentCity: areaCandidate.parentCity,
    area: areaCandidate.area,
    searchScope: "area" as const,
  });
  const verdict: DestinationProviderVerdict = Object.freeze({
    status: "validated" as const,
    scope,
  });
  classifiedValidatedVerdicts.set(verdict, identity);
  return verdict;
}

/**
 * Strict identity key of an area: parentCity + area + displayLabel, each compact-normalised,
 * compared by whole-key equality only (never substring). Empty when any part is missing.
 */
function areaIdentityKey(
  value: Pick<DestinationAreaCandidate, "parentCity" | "area" | "displayLabel">,
): string {
  const parts = [value.parentCity, value.area, value.displayLabel].map((part) =>
    typeof part === "string" && part.trim() ? normalizeAreaEvidence(part.trim()) : "",
  );
  if (parts.some((part) => !part)) return "";
  return parts.join("\u0000");
}

/**
 * True only for a validated verdict that classify produced, that is still frozen, and whose
 * bound identity and scope both exactly equal the resolution's known-parent candidate.
 */
function isTrustedValidatedVerdict(
  verdict: DestinationProviderVerdict,
  candidate: DestinationAreaCandidate,
): boolean {
  if (!verdict || typeof verdict !== "object") return false;
  if (!candidate || typeof candidate !== "object") return false;
  if (verdict.status !== "validated") return false;
  const bound = classifiedValidatedVerdicts.get(verdict);
  if (!bound) return false;
  const scope: unknown = (verdict as { scope?: unknown }).scope;
  if (!scope || typeof scope !== "object") return false;
  if (!Object.isFrozen(verdict) || !Object.isFrozen(scope)) return false;
  if (verdict.scope.searchScope !== "area") return false;
  const candidateKey = areaIdentityKey(candidate);
  if (!candidateKey || candidateKey !== bound) return false;
  return areaIdentityKey(verdict.scope) === bound;
}

/**
 * Apply a three-state provider verdict to a pending_provider resolution. Never calls geocode.
 *
 * - validated + known-parent candidate whose parent matches AND the verdict was issued by
 *   classifyDestinationProviderEvidence() for exactly this candidate (parentCity + area +
 *   displayLabel, normalised whole-key equality) → confirmed, destination = scope.displayLabel.
 *   Hand-written / copied / other-area validated verdicts → ambiguous "unavailable". A pending resolution with no known-parent candidate
 *   (provisional path) is never confirmed here (Phase 1 limit) → ambiguous "unavailable".
 * - rejected + confirmed parent + caller-supplied activityEvidence that, after normalisation,
 *   EQUALS the whole tail (no substring / prefix matching) → destination = parent (confirmed),
 *   activityPreference = the extractor's tail (`areaCandidate.area`).
 * - rejected otherwise → ambiguous, destination undefined, rawLabel / candidates kept.
 * - unavailable, or validated with mismatching parent → ambiguous, providerValidation
 *   "unavailable", rawLabel / candidates kept.
 * `activityEvidence` must come from an existing parser; this module never derives it.
 * Non-pending resolutions are returned unchanged.
 */
export function applyDestinationProviderValidation<TCategory>(
  resolution: DestinationResolution<TCategory>,
  verdict: DestinationProviderVerdict,
  activityEvidence?: string,
): DestinationResolution<TCategory> {
  if (resolution.confidence !== "pending_provider") return resolution;
  const parentCandidate = resolution.areaCandidate;

  const ambiguous = (
    providerValidation: DestinationProviderValidationStatus,
  ): DestinationResolution<TCategory> => ({
    ...resolution,
    destination: undefined,
    destinationType: "unknown",
    geographicScope: undefined,
    activityPreference: undefined,
    confidence: "ambiguous",
    providerValidation,
  });

  // Malformed input (null / undefined / non-object verdict) never throws → unavailable.
  if (!verdict || typeof verdict !== "object") return ambiguous("unavailable");

  if (verdict.status === "validated") {
    // Phase 1: provisional (no known parent) is never confirmed, even if a validated verdict
    // is passed in directly.
    if (!parentCandidate) return ambiguous("unavailable");
    // Identity guard runs BEFORE any scope field is read: only classify-issued, frozen verdicts
    // bound to exactly this candidate (parentCity + area + displayLabel). Other-area,
    // POI-substituted, hand-written, copied, or malformed verdicts are never trusted.
    if (!isTrustedValidatedVerdict(verdict, parentCandidate)) return ambiguous("unavailable");
    const scope = verdict.scope;
    if (!sameLabel(scope.parentCity, parentCandidate.parentCity)) return ambiguous("unavailable");
    return {
      ...resolution,
      destination: scope.displayLabel,
      destinationType: "district",
      geographicScope: scope,
      activityPreference: undefined,
      confidence: "confirmed",
      source: "provider_validated",
      providerValidation: "validated",
    };
  }

  if (verdict.status === "rejected") {
    const evidence = activityEvidence?.trim();
    const tail = parentCandidate?.area ?? "";
    const parentConfirmed = Boolean(
      parentCandidate?.parentCity && isKnownDestinationLabel(parentCandidate.parentCity),
    );
    const evidenceKey = evidence ? normalizeAreaEvidence(evidence) : "";
    const tailKey = tail ? normalizeAreaEvidence(tail) : "";
    if (parentCandidate && parentConfirmed && evidenceKey && tailKey && evidenceKey === tailKey) {
      const destination = normalizeDestinationLabel(parentCandidate.parentCity);
      return {
        ...resolution,
        destination,
        destinationType: destinationTypeForLabel(destination),
        geographicScope: labelScope(destination),
        activityPreference: tail,
        confidence: "confirmed",
        source: "activity_evidence_split",
        providerValidation: "rejected",
      };
    }
    return ambiguous("rejected");
  }

  return ambiguous("unavailable");
}
