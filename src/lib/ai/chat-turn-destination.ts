/**
 * Chat turn ↔ Destination Resolution Authority wiring (moved out of chat-category-destination
 * so that module stays inside the chat-intent-router dependency chain without importing
 * destination-resolution — this module must never be imported by that chain).
 *
 * Responsibilities only: Authority wiring, destination state hand-off, session source
 * selection, clarification flow coordination. No destination parsing rules live here; every
 * verdict comes from resolveDestination() / classify / apply.
 */
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  classifyDestinationSwitchTurn,
  coerceTravelDestination,
  normalizeDestinationLabel,
  isCategoryNonDestinationLabel,
  isKnownDestinationLabel,
  isKnownTouristCityLabel,
  splitKnownParentAreaLabel,
  splitTrailingActivityTail,
} from "@/lib/ai/trip-planning-context";
import { hasCategoryPlaceQuery } from "@/lib/ai/chat-place-category-types";
import type { DestinationAreaCandidate } from "@/lib/ai/destination-travel-profile";
import {
  applyDestinationProviderValidation,
  classifyDestinationProviderEvidence,
  resolveDestination,
  type ConfirmedSessionDestination,
  type DestinationProviderOutcome,
  type DestinationProviderVerdict,
  type DestinationResolution,
} from "@/lib/ai/destination-resolution";
import {
  resolveDestinationApproxCenter,
  type GeocodeDestinationFn,
} from "@/lib/ai/destination-geocode";
import {
  countryCodeForCountryName,
  getResolvedDestinationScope,
  lockDestinationCoordinatesFromGeocode,
  resolveDestinationCountryLabel,
} from "@/lib/ai/resolved-destination-scope";
import { isResolvedDestination } from "@/lib/location/destination-authority";
import {
  isValidAnchorCoordinate,
  type GeocodeFnEnvelope,
} from "@/lib/ai/destination-provider-result";
import {
  applyAreaLocaleAlias,
  normalizeAreaEvidence,
  stripAdministrativeSuffix,
} from "@/lib/ai/destination-area-aliases";
import type { DestinationAreaScope } from "@/lib/ai/destination-travel-profile";
import { isValidCoordinate } from "@/lib/ai/resolved-trip-destination";
import { resolveExplicitMealIntent } from "@/lib/ai/meal-intent-parser";
import {
  buildParentScopeCategoryUserText,
  type PendingGeographicClarification,
} from "@/lib/ai/destination-geographic-clarification";
import type { Locale } from "@/lib/i18n/types";
import {
  analyzeContinueRecommendationStructure,
  hasDanglingContinuationFragment,
  matchesContinueRecommendationGrammar,
  parseNegatedDestinationSwitch,
} from "@/lib/ai/continue-recommendation-intent";

// ─────────────── Destination Resolution Authority wiring (chat turn) ───────────────
// One DestinationResolution per chat turn, shared by Dispatch / Category Search / Weather /
// Credits / Session. Only `resolution.destination` (confirmed | curated) is searchable;
// rawLabel stays clarification-only. No new provider calls: the only geocode here is the
// former category-path validation call, with identical query parameters.

function compactLabel(value: string | undefined): string {
  return value ? normalizeDestinationLabel(value).replace(/[\s,，、/／-]+/g, "") : "";
}

function areaVerdictKey(candidate: DestinationAreaCandidate): string {
  return [candidate.parentCity, candidate.area, candidate.displayLabel]
    .map((part) => compactLabel(part))
    .join("\u0000");
}

/** classify-issued validated verdicts (identity-bound; re-applied, never forged). */
const validatedAreaVerdicts = new Map<string, DestinationProviderVerdict>();
/** Clean provider answers that did not validate (not network errors), per locale. */
const unavailableAreaKeys = new Set<string>();
/** Labels this module's provider validation confirmed (compact label). */
const providerVerifiedLabels = new Set<string>();
/** Search centers taken from this module's validated provider answers (compact label). */
const providerTrustedCenters = new Map<string, { lat: number; lng: number }>();
/**
 * The validated provider answers behind providerTrustedCenters (same key, same lifetime). Lets a
 * later provider_locked verdict restore the label's scope lock after a trip reset cleared it
 * (雪梨 → 熱海 → 雪梨 → 熱海), without a provider request.
 */
const providerTrustedLocations = new Map<string, NonNullable<GeocodeFnEnvelope["location"]>>();

/**
 * Country code the current trip / candidate gives for this very label (Springfield on an
 * Australian trip): the candidate's countryHint, or the trip's own country when the trip
 * destination is this label. Undefined when there is no such hint (a switch target never reads
 * the previous destination's country).
 */
function tripCountryHintCodeFor(label: string, ctx: CanonicalTravelContext | undefined): string | undefined {
  const key = compactLabel(label);
  if (!key || !ctx) return undefined;
  const candidate = ctx.destinationCandidate;
  if (candidate?.countryHint?.trim() && compactLabel(candidate.raw) === key) {
    return countryCodeForCountryName(candidate.countryHint)?.toUpperCase();
  }
  if (ctx.destination?.trim() && compactLabel(ctx.destination) === key) {
    return (
      ctx.destinationCountryCode?.trim().toUpperCase() ||
      countryCodeForCountryName(ctx.destinationCountry)?.toUpperCase()
    );
  }
  return undefined;
}

/** The cached provider answer for this label is in another country than the trip's hint for it. */
function cachedProviderCountryConflicts(label: string, hintCode: string | undefined): boolean {
  if (!hintCode) return false;
  const location = providerTrustedLocations.get(compactLabel(label));
  const cachedCode = location ? countryCodeForCountryName(location.country)?.toUpperCase() : undefined;
  return Boolean(cachedCode && cachedCode !== hintCode);
}

/** provider_locked: re-lock the label's scope from this module's own validated answer if a reset cleared it. */
function restoreProviderScopeLock(label: string): void {
  const key = compactLabel(label);
  const center = providerTrustedCenters.get(key);
  const location = providerTrustedLocations.get(key);
  if (!center || !location || location.lat !== center.lat || location.lng !== center.lng) return;
  if (getResolvedDestinationScope(label)) return;
  lockDestinationCoordinatesFromGeocode({
    destination: label,
    lat: center.lat,
    lng: center.lng,
    country: location.country,
    location,
  });
}
/**
 * Parent administrative names (city / region above the label, never the label itself) from the
 * same validated provider answers (compact label). Comparison only (same-destination checks).
 */
const providerTrustedParents = new Map<string, string[]>();
/**
 * Search-scope-only area evidence (areaVerdictKey) for a known-parent tail the Authority left
 * unvalidated: never an Authority verdict, never a clarification / Session destination source.
 */
const providerTrustedAreas = new Map<
  string,
  { destination: string; center: { lat: number; lng: number }; area: DestinationAreaScope }
>();

function applyCachedAreaVerdict<TCategory>(
  resolution: DestinationResolution<TCategory>,
  locale?: Locale,
): DestinationResolution<TCategory> {
  const candidate = resolution.areaCandidate;
  if (resolution.confidence !== "pending_provider" || !candidate) return resolution;
  const key = areaVerdictKey(candidate);
  const validated = validatedAreaVerdicts.get(key);
  if (validated) return applyDestinationProviderValidation(resolution, validated);
  if (locale && unavailableAreaKeys.has(`${locale}\u0000${key}`)) {
    return applyDestinationProviderValidation(resolution, { status: "unavailable" });
  }
  return resolution;
}

/**
 * Labels verified by this module's own single provider validation (identity evidence checked
 * here, see trustedProviderEvidence). Client-modifiable state — destinationCandidate.status,
 * a complete-looking tripDestination, saved Place IDs or coordinates — never proves a label.
 */
function providerConfirmedLabels(): Set<string> {
  return providerVerifiedLabels;
}

/**
 * Persisted-field retention only (clarification cleanup): a resolved trip destination keeps its
 * own labels in the session's destination fields. Never search / Credits evidence — paid search
 * entries go through resolveTrustedRecommendationSearchScope.
 */
function retainedTripDestinationLabels(session: ChatPlanningSession): Set<string> {
  const labels = new Set<string>();
  const trip = session.tripDestination;
  if (isResolvedDestination(trip)) {
    for (const label of [trip.city, trip.region, trip.displayLabel]) {
      if (label?.trim()) labels.add(compactLabel(label));
    }
  }
  labels.delete("");
  return labels;
}

/**
 * Session Restore candidate: recommendationSession / activeRecommendationContext are client-
 * modifiable, so a snapshot area is NEVER trusted on its own (pool, searchScope, names, parent).
 * When the label is exactly a snapshot's area destination and the Authority's own known-parent
 * candidate for it has the same identity under an Authority-confirmed parent city, this returns
 * the Authority's pending_provider resolution — a candidate that only becomes searchable through
 * validateCategoryTurnDestination (or its cached verdict).
 */
function snapshotAreaCandidate(
  label: string | undefined,
  session: ChatPlanningSession,
  locale?: Locale,
): DestinationResolution | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  const resolution = applyCachedAreaVerdict(resolveDestination({ text: trimmed }), locale);
  const candidate = resolution.areaCandidate;
  if (resolution.destination || !candidate) return undefined;
  if (!authorityConfirmedParentCity(candidate)) return undefined;
  const rec = session.recommendationSession;
  const active = session.activeRecommendationContext;
  const snapshots = [
    rec && rec.pool.length > 0
      ? {
          destinationName: rec.destination,
          parentCity: rec.parentCity,
          area: rec.area,
          searchScope: rec.searchScope,
        }
      : undefined,
    active,
  ];
  const labelKey = compactLabel(trimmed);
  const candidateKey = areaVerdictKey(candidate);
  for (const snapshot of snapshots) {
    if (!snapshot || snapshot.searchScope !== "area") continue;
    const { destinationName, parentCity, area } = snapshot;
    if (!parentCity?.trim() || !area?.trim() || compactLabel(destinationName) !== labelKey) {
      continue;
    }
    if (areaVerdictKey({ parentCity, area, displayLabel: destinationName }) !== candidateKey) {
      continue;
    }
    return resolution;
  }
  return undefined;
}

/** First usable context / session destination label (resolveDestinationForCategorySearch order). */
function firstContextDestinationLabel(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): string | undefined {
  const labels = [
    ctx.destination,
    session.travelContext?.destination,
    session.tripPlanningContext?.destination,
    session.tripDestination?.city,
    session.tripDestination?.displayLabel,
    session.preferredArea,
  ];
  for (const raw of labels) {
    const label = coerceTravelDestination(raw?.trim());
    if (label) return label;
  }
  return undefined;
}

/**
 * The context / session destination, only when the existing flow confirmed it.
 * Same label order as resolveDestinationForCategorySearch; the first usable label decides
 * (an unconfirmed label never falls through to an older, different destination).
 * A recommendation snapshot alone never confirms (see snapshotAreaCandidate).
 */
export function confirmedContextDestination(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): ConfirmedSessionDestination | null {
  const label = firstContextDestinationLabel(ctx, session);
  if (!label) return null;
  const own = applyCachedAreaVerdict(resolveDestination({ text: label }));
  if (own.destination && own.geographicScope) {
    return { destination: own.destination, geographicScope: own.geographicScope };
  }
  if (providerConfirmedLabels().has(compactLabel(label))) {
    return { destination: label };
  }
  return null;
}

/**
 * Pending snapshot candidate for the same first label, when confirmedContextDestination found
 * no confirmation. Provider validation (validateCategoryTurnDestination) decides; never searched
 * as-is.
 */
function contextSnapshotAreaCandidate(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  locale?: Locale,
): DestinationResolution | undefined {
  if (confirmedContextDestination(ctx, session)) return undefined;
  return snapshotAreaCandidate(firstContextDestinationLabel(ctx, session), session, locale);
}

/**
 * A single formal-destination label, kept only when the Authority (known tables / cached
 * validated verdict) or an existing provider flow (resolved trip destination) confirmed it.
 * Used to keep unconfirmed clarification wording out of persisted destination fields.
 */
export function confirmedDestinationLabelOrUndefined(
  label: string | undefined,
  session: ChatPlanningSession,
): string | undefined {
  const trimmed = label?.trim();
  const coerced = coerceTravelDestination(trimmed);
  if (!trimmed || !coerced) return undefined;
  const own = applyCachedAreaVerdict(resolveDestination({ text: coerced }));
  if (own.destination && own.geographicScope) return trimmed;
  const key = compactLabel(coerced);
  return providerConfirmedLabels().has(key) || retainedTripDestinationLabels(session).has(key)
    ? trimmed
    : undefined;
}

/**
 * Clarification turn: this turn's context / planning merge may have copied the unconfirmed
 * wording into the session's formal destination fields. Each field keeps its value only when
 * that value itself is confirmed (see confirmedDestinationLabelOrUndefined); otherwise cleared.
 * travelContext.destination is handled by the caller (confirmedContextDestination). Recommendation
 * snapshots are never touched here (they are written only after a successful search).
 *
 * `before`: the persisted session from before this clarification turn. When given, a confirmed
 * value is kept only if that session already held it as a confirmed destination (a known city
 * read out of the unconfirmed sentence is not trusted on its own); otherwise the field falls
 * back to its own pre-turn value when that value was confirmed. With `before`, the derived
 * travelContext city scope / currentLocation and location.city follow the same rule.
 */
export function withoutUnconfirmedSessionDestinations(
  session: ChatPlanningSession,
  before?: ChatPlanningSession,
): ChatPlanningSession {
  const priorLabels = before
    ? new Set(
        [
          before.travelContext?.destination,
          before.tripPlanningContext?.destination,
          before.tripDestination?.city,
          before.tripDestination?.displayLabel,
          before.preferredArea,
          before.recommendationSession?.destination,
          before.activeRecommendationContext?.destinationName,
        ]
          .map((label) => compactLabel(confirmedDestinationLabelOrUndefined(label, before)))
          .filter(Boolean),
      )
    : null;
  const keptLabel = (current: string | undefined, previous: string | undefined) => {
    const confirmed = confirmedDestinationLabelOrUndefined(current, session);
    if (!before || !priorLabels) return confirmed;
    if (confirmed && priorLabels.has(compactLabel(confirmed))) return confirmed;
    return confirmedDestinationLabelOrUndefined(previous, before);
  };
  const planning = session.tripPlanningContext;
  const planningDestination = keptLabel(
    planning?.destination,
    before?.tripPlanningContext?.destination,
  );
  const tripCity = session.tripDestination?.city;
  const keepTripDestination =
    !tripCity?.trim() ||
    Boolean(
      before
        ? keptLabel(tripCity, undefined)
        : confirmedDestinationLabelOrUndefined(tripCity, session),
    );
  const beforeTripCity = before?.tripDestination?.city;
  const fallbackTripDestination =
    before &&
    (!beforeTripCity?.trim() || confirmedDestinationLabelOrUndefined(beforeTripCity, before))
      ? before.tripDestination
      : undefined;
  const cleared: ChatPlanningSession = {
    ...session,
    tripPlanningContext: planning ? { ...planning, destination: planningDestination } : planning,
    preferredArea: keptLabel(session.preferredArea, before?.preferredArea),
    tripDestination: keepTripDestination ? session.tripDestination : fallbackTripDestination,
  };
  if (!before || !priorLabels) return cleared;
  // Derived destination fields the same merge copied out of the unconfirmed sentence
  // (travelContext city scope): kept only when the pre-turn session already held the value as
  // a confirmed destination; otherwise the pre-turn value (or nothing). A pre-turn
  // currentLocation / location (the user's real position) is always restored; a position
  // acquired this turn is recognised by coordinates only (see `location` below).
  const heldBefore = (value: string | undefined) => {
    const confirmed = compactLabel(confirmedDestinationLabelOrUndefined(value, session));
    return Boolean(confirmed) && priorLabels.has(confirmed);
  };
  // location by the coordinate contract (isValidCoordinate), never by city strings:
  // invalid coords = applyTripIntentToSession placeholder → pre-turn location (or none);
  // same coords as pre-turn (only city overwritten) → pre-turn city; coords copied from the
  // pre-turn nearbyLocationAuthority (resolveChatLocation requireNearbyAuthority) are not this
  // turn's position: a user-chosen center → pre-turn location, a "device" one → coords kept,
  // city unknown (""); other new valid coords = position acquired this turn (resolveChatLocation)
  // → kept with its own source city. Trip Add Place (flag + context) coords are the trip's
  // destination, never a position: location / authority / currentLocation stay pre-turn.
  const tripAddPlaceTurn = Boolean(
    (session.fromTripAddPlace && session.tripAddPlaceContext) ||
    (before.fromTripAddPlace && before.tripAddPlaceContext),
  );
  const beforeLocation = before.location;
  const beforeAuthority = before.nearbyLocationAuthority;
  const sessionLocation = session.location;
  const locationHasCoords = isValidCoordinate(sessionLocation?.lat, sessionLocation?.lng);
  const sameCoordsAsBefore =
    locationHasCoords &&
    isValidCoordinate(beforeLocation?.lat, beforeLocation?.lng) &&
    sessionLocation?.lat === beforeLocation?.lat &&
    sessionLocation?.lng === beforeLocation?.lng;
  const copiedBeforeAuthority =
    locationHasCoords &&
    !sameCoordsAsBefore &&
    Boolean(beforeAuthority) &&
    sessionLocation?.lat === beforeAuthority?.lat &&
    sessionLocation?.lng === beforeAuthority?.lng;
  const turnAcquiredLocation =
    !tripAddPlaceTurn && locationHasCoords && !sameCoordsAsBefore && !copiedBeforeAuthority
      ? sessionLocation
      : undefined;
  const location =
    tripAddPlaceTurn || !sessionLocation || !locationHasCoords
      ? beforeLocation
      : sameCoordsAsBefore
        ? { ...sessionLocation, city: beforeLocation?.city }
        : copiedBeforeAuthority
          ? beforeAuthority?.source === "device"
            ? { ...sessionLocation, city: "" }
            : beforeLocation
          : sessionLocation;
  // nearbyLocationAuthority: only a new "device" authority written with this turn's acquired
  // position (resolveChatLocation) is kept; anything else (unchanged, Trip Add Place, a
  // non-device center) → pre-turn authority (or none).
  const authority = session.nearbyLocationAuthority;
  const keepTurnAuthority =
    !tripAddPlaceTurn &&
    Boolean(authority) &&
    authority !== beforeAuthority &&
    authority?.source === "device" &&
    isValidCoordinate(authority.lat, authority.lng) &&
    authority.lat === turnAcquiredLocation?.lat &&
    authority.lng === turnAcquiredLocation?.lng;
  const nearbyLocationAuthority = keepTurnAuthority ? authority : beforeAuthority;
  const ctx = session.travelContext;
  const prevCtx = before.travelContext;
  const keepCityScope = !ctx?.destinationCity?.trim() || heldBefore(ctx.destinationCity);
  const travelContext = ctx
    ? {
        ...ctx,
        ...(keepCityScope
          ? {}
          : {
              destinationCity: prevCtx?.destinationCity,
              destinationRegion: prevCtx?.destinationRegion,
              destinationCountry: prevCtx?.destinationCountry,
              destinationType: prevCtx?.destinationType,
            }),
        currentLocation: tripAddPlaceTurn
          ? prevCtx?.currentLocation
          : (prevCtx?.currentLocation ??
            (ctx.currentLocation ? turnAcquiredLocation?.city || undefined : undefined)),
      }
    : ctx;
  return { ...cleared, travelContext, location, nearbyLocationAuthority };
}

/**
 * True when a search destination is still an unconfirmed known-parent + tail label
 * (Authority: pending provider, no cached validated verdict) and is not the destination of the
 * session's existing recommendation snapshot (written only after a successful search).
 * Such a label must never reach Places search or Credits metadata.
 */
export function isUnconfirmedSearchDestination(
  label: string | undefined,
  session: ChatPlanningSession,
): boolean {
  const trimmed = label?.trim();
  if (!trimmed) return false;
  const verdict = applyCachedAreaVerdict(resolveDestination({ text: trimmed }));
  if (verdict.destination || !verdict.areaCandidate) return false;
  const snapshotLabels = [
    session.recommendationSession?.destination,
    session.activeRecommendationContext?.destinationName,
  ]
    .map((value) => compactLabel(value?.trim()))
    .filter(Boolean);
  return !snapshotLabels.includes(compactLabel(trimmed));
}

/**
 * The turn's single DestinationResolution (synchronous; no provider calls).
 * `providerResolvedTurnDestination`: label the existing global-candidate flow resolved in
 * THIS turn; used only when the Authority found a parsed-but-unlisted label (ambiguous, no
 * candidate). Known-parent tails and provisional fragments are never replaced by it.
 */
export function resolveCategoryTurnDestination<TCategory = unknown>(params: {
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  userText: string;
  locale?: Locale;
  recommendationCategory?: TCategory;
  providerResolvedTurnDestination?: string;
}): DestinationResolution<TCategory> {
  const sessionDestination = confirmedContextDestination(params.ctx, params.session);
  // Continuation tail wording never reaches the Authority / geocode: a continuation sentence
  // with text before its boundary hands only that clean candidate text over.
  const structure = analyzeContinueRecommendationStructure(params.userText ?? "");
  const authorityText =
    structure.isContinue && structure.hasPendingPlaceCandidate
      ? structure.candidateText
      : (params.userText ?? "");
  const authorityResolution = applyCachedAreaVerdict(
    resolveDestination<TCategory>({
      text: authorityText,
      sessionDestination,
      recommendationCategory: params.recommendationCategory,
    }),
    params.locale,
  );
  // A weak trailing continuation piece (「…再」) leaves no clean label: its area candidate is
  // marked unavailable (same state as the cooldown path), so it is never sent for validation.
  const resolution =
    !structure.isContinue &&
    authorityResolution.confidence === "pending_provider" &&
    authorityResolution.areaCandidate &&
    hasDanglingContinuationFragment(params.userText ?? "")
      ? applyDestinationProviderValidation(authorityResolution, { status: "unavailable" })
      : authorityResolution;
  const providerLabel = coerceTravelDestination(params.providerResolvedTurnDestination?.trim());
  if (
    providerLabel &&
    resolution.confidence === "ambiguous" &&
    !resolution.areaCandidate &&
    !resolution.provisionalCandidate
  ) {
    // Existing-flow confirmed destination, passed through the Authority's session input.
    return resolveDestination<TCategory>({
      text: "",
      sessionDestination: { destination: providerLabel },
      recommendationCategory: params.recommendationCategory,
    });
  }
  if (!sessionDestination && turnHasNoDestinationFragment(params.userText ?? "")) {
    // No confirmed session destination: a recommendation snapshot area is only a pending
    // candidate; the caller's validateCategoryTurnDestination decides (never searched as-is).
    const candidate = contextSnapshotAreaCandidate(params.ctx, params.session, params.locale);
    if (candidate) return { ...candidate, recommendationCategory: params.recommendationCategory };
  }
  return resolution;
}

/** Placeholder session label: only marks the Authority's step e; its verdict is discarded. */
const NO_FRAGMENT_PROBE = "\u0000";

/** True when the Authority finds no destination fragment in the turn text (step e reached). */
function turnHasNoDestinationFragment(text: string): boolean {
  return (
    resolveDestination({ text, sessionDestination: { destination: NO_FRAGMENT_PROBE } }).source ===
    "session"
  );
}

/**
 * Provider validation for a pending known-parent tail, replacing the former
 * resolveValidatedDestinationAreaScope call on the category path: same single geocode,
 * same query parameters, but Authority classify → apply (strict administrative equality).
 * Provisional fragments are never geocoded here (Phase 1: classify can never validate them).
 */
export async function validateCategoryTurnDestination<TCategory>(
  resolution: DestinationResolution<TCategory>,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn },
): Promise<DestinationResolution<TCategory>> {
  const cached = applyCachedAreaVerdict(resolution, params.locale);
  const candidate = cached.areaCandidate;
  if (cached.confidence !== "pending_provider" || !candidate) return cached;
  const localeKey = `${params.locale}\u0000${areaVerdictKey(candidate)}`;
  const failedAt = transientAreaFailures.get(localeKey);
  if (failedAt !== undefined && Date.now() - failedAt < TRANSIENT_RETRY_MS) {
    return applyDestinationProviderValidation(cached, { status: "unavailable" });
  }
  // One geocode per candidate at a time: concurrent callers share the in-flight verdict.
  let inFlight = inFlightAreaValidations.get(localeKey);
  if (!inFlight) {
    inFlight = runAreaProviderValidation(cached, candidate, params).finally(() => {
      inFlightAreaValidations.delete(localeKey);
    });
    inFlightAreaValidations.set(localeKey, inFlight);
  }
  return applyDestinationProviderValidation(cached, await inFlight);
}

/** In-flight provider validations per locale + candidate key. */
const inFlightAreaValidations = new Map<string, Promise<DestinationProviderVerdict>>();
/** Last transient failure (thrown / error envelope / failed provider result) per locale + key. */
const transientAreaFailures = new Map<string, number>();
/** A transient failure is not retried within this window (same turn); next turn may retry once. */
const TRANSIENT_RETRY_MS = 15_000;

/** The one candidate geocode form (same query parameters; placesFallback: false). */
function geocodeDestinationCandidate(
  query: string,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn },
): Promise<GeocodeFnEnvelope> {
  return params.geocodeFn({
    data: {
      query,
      destinationName: query,
      locale: params.locale,
      language: params.locale,
      disableLocaleRegionBias: true,
      placesFallback: false,
    },
  });
}

async function runAreaProviderValidation<TCategory>(
  cached: DestinationResolution<TCategory>,
  candidate: DestinationAreaCandidate,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn },
): Promise<DestinationProviderVerdict> {
  let outcome: DestinationProviderOutcome;
  try {
    const envelope = await geocodeDestinationCandidate(candidate.displayLabel, params);
    outcome = { kind: "envelope", envelope };
  } catch (error) {
    outcome = { kind: "thrown", error };
  }
  const classified = classifyDestinationProviderEvidence(candidate, outcome);
  // Stricter AND gate on the same envelope: Place ID, geographic types, country of the
  // Authority parent, consistent coordinates. Insufficient evidence → unavailable.
  const evidence =
    outcome.kind === "envelope"
      ? trustedProviderEvidence(outcome.envelope, countryCodeForLabel(candidate.parentCity))
      : null;
  const verdict: DestinationProviderVerdict =
    classified.status === "validated" && !evidence ? { status: "unavailable" } : classified;
  const applied = applyDestinationProviderValidation(cached, verdict);
  const key = areaVerdictKey(candidate);
  const localeKey = `${params.locale}\u0000${key}`;
  const location = outcome.kind === "envelope" ? outcome.envelope?.location : null;
  if (applied.confidence === "confirmed" && applied.destination && location && evidence) {
    validatedAreaVerdicts.set(key, verdict);
    transientAreaFailures.delete(localeKey);
    for (const label of [applied.destination, candidate.displayLabel]) {
      providerTrustedCenters.set(compactLabel(label), evidence.center);
      providerTrustedLocations.set(compactLabel(label), evidence.location);
    }
    lockDestinationCoordinatesFromGeocode({
      destination: applied.destination,
      lat: location.lat,
      lng: location.lng,
      country: location.country,
      location: evidence.location,
    });
  } else if (
    outcome.kind === "envelope" &&
    outcome.envelope &&
    outcome.envelope.error == null &&
    outcome.envelope.providerResult?.ok !== false
  ) {
    unavailableAreaKeys.add(localeKey);
    transientAreaFailures.delete(localeKey);
    // Search-scope only (the Authority verdict above is unchanged): a city-state parent
    // (香港跑馬地) appears only as the provider's country, never as city / region.
    if (evidence && areaUnderCountryParent(evidence.location, candidate)) {
      providerTrustedAreas.set(key, {
        destination: candidate.displayLabel,
        center: evidence.center,
        area: {
          displayLabel: candidate.displayLabel,
          parentCity: candidate.parentCity,
          area: candidate.area,
          searchScope: "area",
        },
      });
    }
  } else {
    transientAreaFailures.set(localeKey, Date.now());
  }
  return verdict;
}

// ─────────────── Trusted recommendation search scope (paid search entries) ───────────────
// Refinement / destination places / more_places / destination_category / alternative
// recommendations resolve their destination AND search center here before Session writes,
// Credits, Places or Weather. A Client snapshot (coordinates, radius, city, Place ID,
// resolved flags) never proves itself.

/**
 * What the destination provider check of this call actually did (optional diagnostic; absent
 * when no provider check was involved). cooldown / cached_miss: no request was sent this call.
 */
export type DestinationProviderCheckOutcome =
  | "provider_cooldown"
  | "provider_cached_miss"
  | "provider_attempted_failure"
  | "provider_verified";

export type TrustedRecommendationSearchScope =
  | {
      status: "trusted";
      destination: string;
      center: { lat: number; lng: number };
      centerSource: "authority" | "provider_locked" | "provider_this_turn";
      area?: DestinationAreaScope;
      providerOutcome?: DestinationProviderCheckOutcome;
      /**
       * Administrative names above `destination` (area parent city; provider city / region),
       * present only when known. Containment comparison only; never a search name or center.
       */
      parentAdministrativeNames?: string[];
    }
  | { status: "unavailable"; reason: string; providerOutcome?: DestinationProviderCheckOutcome };

/** Google geographic place types accepted as identity evidence (never POI / establishment). */
const GEOGRAPHIC_PROVIDER_TYPES = new Set([
  "locality",
  "sublocality",
  "sublocality_level_1",
  "sublocality_level_2",
  "sublocality_level_3",
  "neighborhood",
  "colloquial_area",
  "postal_town",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "administrative_area_level_4",
  "administrative_area_level_5",
]);

/** Island-wide default center (destination-geocode DEFAULT_SEARCH_CENTER): never a city center. */
const TAIWAN_WIDE_CENTER = { lat: 23.9739, lng: 120.9823 };

function countryCodeForLabel(label: string | undefined): string | undefined {
  const country = label?.trim() ? resolveDestinationCountryLabel(label) : undefined;
  return countryCodeForCountryName(country)?.toUpperCase();
}

/**
 * Identity evidence from this turn's geocode envelope: Place ID, explicit geographic types,
 * country (equal to the Authority country when one is known), valid coordinates that agree
 * between providerResult and location. Names are never evidence on their own.
 */
function trustedProviderEvidence(
  envelope: GeocodeFnEnvelope | null | undefined,
  expectedCountryCode: string | undefined,
): {
  center: { lat: number; lng: number };
  location: NonNullable<GeocodeFnEnvelope["location"]>;
} | null {
  const location = envelope?.location;
  const result = envelope?.providerResult;
  if (!envelope || envelope.error != null || !location || !result || result.ok !== true) {
    return null;
  }
  const placeId = result.placeId?.trim();
  if (!placeId || placeId.startsWith("geocode:") || placeId !== location.placeId?.trim()) {
    return null;
  }
  const types = result.types ?? [];
  if (!types.some((type) => GEOGRAPHIC_PROVIDER_TYPES.has(type))) return null;
  if (types.includes("establishment") || types.includes("point_of_interest")) return null;
  if (result.primaryType && !GEOGRAPHIC_PROVIDER_TYPES.has(result.primaryType)) return null;
  const countryCode = result.countryCode?.trim().toUpperCase();
  if (!countryCode || (expectedCountryCode && countryCode !== expectedCountryCode)) return null;
  const { lat, lng } = location;
  if (!isValidAnchorCoordinate(lat, lng) || (lat === 0 && lng === 0)) return null;
  if (result.latitude !== lat || result.longitude !== lng) return null;
  return { center: { lat, lng }, location };
}

function sameAdministrativeLabel(left: string | undefined, right: string | undefined): boolean {
  // 別府・甲府・成都・京都: a two-character name ending in 府 / 都 / 縣 is the name itself (same rule
  // as normalizeCityLabel), so 別府 equals the provider's 別府市 (never the one-character 別).
  const strip = (value: string) =>
    /^\p{Script=Han}[府都縣县]$/u.test(value.trim()) ? value.trim() : stripAdministrativeSuffix(value);
  const norm = (value: string) => normalizeAreaEvidence(strip(applyAreaLocaleAlias(value)));
  const a = left?.trim() ? norm(left) : "";
  const b = right?.trim() ? norm(right) : "";
  return Boolean(a && b && a === b);
}

/** Same administrative label after alias / suffix normalisation (exact; never substring). */
export function isSameAdministrativeLabel(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return sameAdministrativeLabel(left, right);
}

/** Distinct parent names, excluding the label itself (and anything equal to it). */
function parentNamesExcluding(label: string, names: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const name of names) {
    const value = name?.trim();
    if (!value || sameAdministrativeLabel(value, label)) continue;
    if (out.some((existing) => sameAdministrativeLabel(existing, value))) continue;
    out.push(value);
  }
  return out;
}

/**
 * Parent administrative names this module already learned for a label from its own validated
 * provider answers (no request). Comparison only; empty when unknown.
 */
export function cachedTrustedParentAdministrativeNames(label: string | undefined): string[] {
  const key = compactLabel(label);
  return key ? [...(providerTrustedParents.get(key) ?? [])] : [];
}

/** Adds parentAdministrativeNames to a trusted scope when any is known (shape otherwise unchanged). */
function withParentAdministrativeNames(
  scope: TrustedRecommendationSearchScope,
): TrustedRecommendationSearchScope {
  if (scope.status !== "trusted") return scope;
  const parents = parentNamesExcluding(scope.destination, [
    scope.area?.parentCity,
    ...(providerTrustedParents.get(compactLabel(scope.destination)) ?? []),
  ]);
  return parents.length ? { ...scope, parentAdministrativeNames: parents } : scope;
}

/**
 * Known-parent tail whose parent is the provider's country itself (city-state): the area equals
 * district / sublocality exactly and the parent equals the country label exactly.
 */
function areaUnderCountryParent(
  location: NonNullable<GeocodeFnEnvelope["location"]>,
  candidate: DestinationAreaCandidate,
): boolean {
  if (sameAdministrativeLabel(candidate.area, candidate.parentCity)) return false;
  return (
    [location.district, location.sublocality].some((value) =>
      sameAdministrativeLabel(value, candidate.area),
    ) && sameAdministrativeLabel(location.country, candidate.parentCity)
  );
}

/** Provider administrative fields equal the requested city (or area under its parent). */
function providerAdministrativeMatch(
  location: NonNullable<GeocodeFnEnvelope["location"]>,
  label: string,
  area: DestinationAreaScope | undefined,
): boolean {
  if (area) {
    return (
      [location.district, location.sublocality, location.city].some((value) =>
        sameAdministrativeLabel(value, area.area),
      ) &&
      [location.city, location.region].some((value) =>
        sameAdministrativeLabel(value, area.parentCity),
      )
    );
  }
  return [location.city, location.region, location.district].some((value) =>
    sameAdministrativeLabel(value, label),
  );
}

/** In-flight city validations per locale + label. */
const inFlightCityValidations = new Map<string, Promise<{ lat: number; lng: number } | null>>();
/** Clean provider answers that did not validate a city label, per locale + label. */
const unavailableCityKeys = new Set<string>();
/** Last transient city validation failure per locale + label (same window as areas). */
const transientCityFailures = new Map<string, number>();

/**
 * One existing-form geocode (placesFallback: false) for an explicit city / area candidate the
 * Authority proposed but has no center for. At most one Google request per candidate: in-flight
 * sharing, clean-miss cache, 15s transient window. Success records the label + center here.
 */
async function validateCityCandidateCenter(
  label: string,
  area: DestinationAreaScope | undefined,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn; countryHintCode?: string },
  report?: { outcome?: DestinationProviderCheckOutcome },
): Promise<{ lat: number; lng: number } | null> {
  const key = compactLabel(label);
  if (!key) return null;
  // A cached answer in another country than the trip's own hint for this label is not reused
  // (no restore); the existing single provider check runs instead.
  const locked = cachedProviderCountryConflicts(label, params.countryHintCode)
    ? undefined
    : providerTrustedCenters.get(key);
  if (locked) {
    restoreProviderScopeLock(label);
    return locked;
  }
  const localeKey = `${params.locale}\u0000${key}`;
  if (unavailableCityKeys.has(localeKey)) {
    if (report) report.outcome = "provider_cached_miss";
    return null;
  }
  const failedAt = transientCityFailures.get(localeKey);
  if (failedAt !== undefined && Date.now() - failedAt < TRANSIENT_RETRY_MS) {
    if (report) report.outcome = "provider_cooldown";
    return null;
  }
  // From here the existing single provider check runs (or is shared while in flight).
  if (report) report.outcome = "provider_attempted_failure";
  let inFlight = inFlightCityValidations.get(localeKey);
  if (!inFlight) {
    inFlight = (async () => {
      let envelope: GeocodeFnEnvelope | null | undefined;
      try {
        envelope = await geocodeDestinationCandidate(label, params);
      } catch {
        transientCityFailures.set(localeKey, Date.now());
        return null;
      }
      const evidence = trustedProviderEvidence(
        envelope,
        countryCodeForLabel(area?.parentCity ?? label),
      );
      if (evidence && providerAdministrativeMatch(evidence.location, label, area)) {
        providerTrustedCenters.set(key, evidence.center);
        providerTrustedLocations.set(key, evidence.location);
        providerVerifiedLabels.add(key);
        // Only levels above the label (city / region); district / sublocality may be below it.
        const parents = parentNamesExcluding(label, [
          area?.parentCity,
          evidence.location.city,
          evidence.location.region,
        ]).filter((name) => !sameAdministrativeLabel(name, area?.area));
        if (parents.length) providerTrustedParents.set(key, parents);
        transientCityFailures.delete(localeKey);
        lockDestinationCoordinatesFromGeocode({
          destination: label,
          lat: evidence.center.lat,
          lng: evidence.center.lng,
          country: evidence.location.country,
          location: evidence.location,
        });
        return evidence.center;
      }
      if (envelope && envelope.error == null && envelope.providerResult?.ok !== false) {
        unavailableCityKeys.add(localeKey);
        transientCityFailures.delete(localeKey);
      } else {
        transientCityFailures.set(localeKey, Date.now());
      }
      return null;
    })().finally(() => {
      inFlightCityValidations.delete(localeKey);
    });
    inFlightCityValidations.set(localeKey, inFlight);
  }
  const center = await inFlight;
  if (report && center) report.outcome = "provider_verified";
  return center;
}

/** Authority center for a confirmed / curated destination (known tables; never island-wide). */
function authoritySearchCenter(
  resolution: DestinationResolution,
): { lat: number; lng: number } | undefined {
  if (!resolution.destination) return undefined;
  const approx = resolveDestinationApproxCenter(resolution.destination);
  if (!approx || !isValidAnchorCoordinate(approx.lat, approx.lng)) return undefined;
  if (approx.lat === 0 && approx.lng === 0) return undefined;
  const islandWide = approx.lat === TAIWAN_WIDE_CENTER.lat && approx.lng === TAIWAN_WIDE_CENTER.lng;
  if (islandWide && resolution.destinationType !== "country") return undefined;
  return { lat: approx.lat, lng: approx.lng };
}

function areaScopeOf(resolution: DestinationResolution): DestinationAreaScope | undefined {
  const scope = resolution.geographicScope;
  return scope?.searchScope === "area" ? scope : undefined;
}

/**
 * Trusted destination + search center for one paid recommendation search. Order:
 * 1. Authority confirmed / curated (incl. cached validated area verdict): Authority center,
 *    else a center this module already validated (provider_locked), else one provider check.
 * 2. Pending known-parent tail: the existing single area validation (validateCategoryTurnDestination)
 *    plus the identity AND gate; center from that same answer.
 * 3. Explicit city candidate the Authority parsed but cannot confirm (provisional fragment /
 *    parsed-but-unlisted label): one provider check with identity + administrative evidence.
 * Anything else, or insufficient evidence → unavailable: no search, no Credits, no old city.
 * The session / ctx are never read for coordinates, radius, city or Place IDs.
 */
export async function resolveTrustedRecommendationSearchScope(params: {
  label: string | undefined;
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<TrustedRecommendationSearchScope> {
  // Same verdict / center / provider requests; only adds the parent names already known.
  return withParentAdministrativeNames(await resolveTrustedScopeVerdict(params));
}

async function resolveTrustedScopeVerdict(params: {
  label: string | undefined;
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<TrustedRecommendationSearchScope> {
  const text = params.label?.trim();
  if (!text) return { status: "unavailable", reason: "no_destination" };
  const providerParams = { locale: params.locale, geocodeFn: params.geocodeFn };
  const authorityResolution = resolveDestination({ text });
  let resolution = applyCachedAreaVerdict(authorityResolution, params.locale);
  let thisTurn = false;
  // Diagnostic only (no request added / skipped): what this call's provider check did.
  let areaOutcome: DestinationProviderCheckOutcome | undefined =
    authorityResolution.confidence === "pending_provider" &&
    authorityResolution.areaCandidate &&
    resolution.confidence !== "pending_provider" &&
    !resolution.destination
      ? "provider_cached_miss"
      : undefined;
  if (resolution.confidence === "pending_provider" && resolution.areaCandidate) {
    const failedAt = transientAreaFailures.get(
      `${params.locale}\u0000${areaVerdictKey(resolution.areaCandidate)}`,
    );
    areaOutcome =
      failedAt !== undefined && Date.now() - failedAt < TRANSIENT_RETRY_MS
        ? "provider_cooldown"
        : "provider_attempted_failure";
    resolution = await validateCategoryTurnDestination(resolution, providerParams);
    thisTurn = true;
  }
  const cityReport: { outcome?: DestinationProviderCheckOutcome } = {};
  if (resolution.destination) {
    const destination = resolution.destination;
    const area = areaScopeOf(resolution);
    const authorityCenter = thisTurn ? undefined : authoritySearchCenter(resolution);
    if (authorityCenter) {
      return {
        status: "trusted",
        destination,
        center: authorityCenter,
        centerSource: "authority",
        area,
      };
    }
    const destinationHintCode = tripCountryHintCodeFor(destination, params.ctx);
    const locked =
      !thisTurn && cachedProviderCountryConflicts(destination, destinationHintCode)
        ? undefined
        : providerTrustedCenters.get(compactLabel(destination));
    if (locked) {
      if (!thisTurn) restoreProviderScopeLock(destination);
      return withProviderOutcome(
        {
          status: "trusted",
          destination,
          center: locked,
          centerSource: thisTurn ? "provider_this_turn" : "provider_locked",
          area,
        },
        thisTurn ? "provider_verified" : undefined,
      );
    }
    if (thisTurn) {
      return withProviderOutcome(
        { status: "unavailable", reason: "area_center_unverified" },
        areaOutcome,
      );
    }
    const center = await validateCityCandidateCenter(
      destination,
      area,
      { ...providerParams, countryHintCode: destinationHintCode },
      cityReport,
    );
    return withProviderOutcome(
      center
        ? { status: "trusted", destination, center, centerSource: "provider_this_turn", area }
        : { status: "unavailable", reason: "destination_center_unverified" },
      cityReport.outcome,
    );
  }
  if (resolution.areaCandidate) {
    const trustedArea = providerTrustedAreas.get(areaVerdictKey(resolution.areaCandidate));
    return trustedArea
      ? withProviderOutcome(
          {
            status: "trusted",
            destination: trustedArea.destination,
            center: trustedArea.center,
            centerSource: thisTurn ? "provider_this_turn" : "provider_locked",
            area: trustedArea.area,
          },
          thisTurn && areaOutcome === "provider_attempted_failure"
            ? "provider_verified"
            : undefined,
        )
      : withProviderOutcome({ status: "unavailable", reason: "area_unconfirmed" }, areaOutcome);
  }
  const cityCandidate =
    resolution.provisionalCandidate?.areaCandidate?.trim() ||
    (resolution.confidence === "ambiguous" && resolution.source === "none"
      ? coerceTravelDestination(resolution.rawLabel)
      : undefined);
  if (!cityCandidate) return { status: "unavailable", reason: "no_destination_candidate" };
  const candidateHintCode = tripCountryHintCodeFor(cityCandidate, params.ctx);
  const wasVerified =
    providerTrustedCenters.has(compactLabel(cityCandidate)) &&
    !cachedProviderCountryConflicts(cityCandidate, candidateHintCode);
  const center = await validateCityCandidateCenter(
    cityCandidate,
    undefined,
    { ...providerParams, countryHintCode: candidateHintCode },
    cityReport,
  );
  return withProviderOutcome(
    center
      ? {
          status: "trusted",
          destination: cityCandidate,
          center,
          centerSource: wasVerified ? "provider_locked" : "provider_this_turn",
        }
      : { status: "unavailable", reason: "destination_unverified" },
    cityReport.outcome,
  );
}

/** Adds the optional provider outcome only when one was observed (shape otherwise unchanged). */
function withProviderOutcome(
  scope: TrustedRecommendationSearchScope,
  outcome: DestinationProviderCheckOutcome | undefined,
): TrustedRecommendationSearchScope {
  return outcome ? { ...scope, providerOutcome: outcome } : scope;
}

/**
 * Pure geographic-scope check (no provider call): may an existing recommendation pool be reused
 * for this turn's trusted scope? Canonical destination, parent city, area / district and search
 * scope must all agree. The snapshot fields can only reject reuse; the destination itself is
 * always the Authority's trustedScope, never the snapshot. A city-level scope never reuses an
 * area pool, and an area scope never reuses a pool of another area of the same parent city.
 */
export function recommendationSessionMatchesTrustedScope(
  rec: ChatPlanningSession["recommendationSession"],
  trustedScope: TrustedRecommendationSearchScope,
): boolean {
  if (!rec || trustedScope.status !== "trusted") return false;
  const destination = compactLabel(trustedScope.destination);
  if (!destination || compactLabel(rec.destination) !== destination) return false;
  const area = trustedScope.area;
  if (area) {
    if (rec.searchScope !== "area") return false;
    const recArea = compactLabel(rec.area);
    const recParent = compactLabel(rec.parentCity);
    return (
      Boolean(recArea) &&
      Boolean(recParent) &&
      recArea === compactLabel(area.area) &&
      recParent === compactLabel(area.parentCity)
    );
  }
  if (rec.searchScope === "area" || rec.searchScope === "district") return false;
  const recArea = compactLabel(rec.area);
  if (recArea && recArea !== destination) return false;
  const recParent = compactLabel(rec.parentCity);
  if (recParent && recParent !== destination) return false;
  return true;
}

/** Client snapshot search-scope fields (coordinates, radius, viewport, search city, area). */
const CLIENT_SEARCH_SCOPE_KEYS = [
  "latitude",
  "longitude",
  "searchCentroid",
  "radius",
  "searchRadius",
  "viewport",
  "resolvedSearchCity",
  "activeSearchCity",
  "area",
  "parentCity",
  "searchScope",
  "searchRegionLabel",
] as const;
const CLIENT_SCOPE_COORDINATE_KEYS = ["lat", "lng", "latitude", "longitude", "radius", "viewport"];

function withoutKeys(value: unknown, keys: readonly string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const key of keys) delete record[key];
  return record;
}

/**
 * Removes Client-saved search scope (center / radius / viewport / search city / area) from a
 * session or a recommendation snapshot, including its recommendationSession,
 * activeRecommendationContext and planningSelection.destinationScope. Pool, used queries and
 * preferences are kept. The trusted scope is then passed explicitly by the caller.
 */
export function stripClientSearchScope<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const record = withoutKeys(snapshot, CLIENT_SEARCH_SCOPE_KEYS) as Record<string, unknown>;
  for (const key of ["recommendationSession", "activeRecommendationContext"]) {
    if (record[key] && typeof record[key] === "object") {
      record[key] = withoutKeys(record[key], CLIENT_SEARCH_SCOPE_KEYS);
    }
  }
  const selection = record.planningSelection as Record<string, unknown> | undefined;
  if (selection && typeof selection === "object" && selection.destinationScope) {
    record.planningSelection = {
      ...selection,
      destinationScope: withoutKeys(selection.destinationScope, CLIENT_SCOPE_COORDINATE_KEYS),
    };
  }
  return record as T;
}

/**
 * A context / session destination the Authority cannot confirm (e.g. a Trip → Chat city outside
 * the known tables) is only a pending candidate: it becomes the turn destination through
 * resolveTrustedRecommendationSearchScope. Known-parent tails stay on their existing paths
 * (snapshot candidate / clarification), so they are never geocoded here.
 */
async function trustedContextCandidateDestination(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn },
): Promise<string | undefined> {
  if (confirmedContextDestination(ctx, session)) return undefined;
  const label = firstContextDestinationLabel(ctx, session);
  if (!label || resolveDestination({ text: label }).areaCandidate) return undefined;
  const scope = await resolveTrustedRecommendationSearchScope({ label, ctx, session, ...params });
  return scope.status === "trusted" ? scope.destination : undefined;
}

/**
 * Category turn without its own destination fragment and without a confirmed context
 * destination: the context label as a pending candidate (see trustedContextCandidateDestination).
 */
export async function resolveTrustedContextTurnDestination(params: {
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  userText: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<string | undefined> {
  if (!turnHasNoDestinationFragment(params.userText ?? "")) return undefined;
  return trustedContextCandidateDestination(params.ctx, params.session, params);
}

/**
 * Authority verdict for one clean destination text (never continuation wording): known city /
 * curated / cached validated area → searchable; a known-parent tail gets the one existing
 * provider validation; anything else (provisional fragment, unlisted label) → undefined.
 * Never falls back to the parent city or an older destination.
 */
async function resolveNamedTurnDestination(
  text: string,
  params: { locale: Locale; geocodeFn: GeocodeDestinationFn },
  allowProviderValidation = true,
): Promise<string | undefined> {
  const turn = applyCachedAreaVerdict(resolveDestination({ text }), params.locale);
  if (turn.destination) return turn.destination;
  if (!turn.areaCandidate || !allowProviderValidation) return undefined;
  return (await validateCategoryTurnDestination(turn, params)).destination;
}

/**
 * more_places (Continuation) search destination. Intent first (full sentence), then destination:
 * 1. analyzeContinueRecommendationStructure(full text) finds the continuation boundary.
 * 2. Continuation with text before the boundary: only that clean candidate text goes to the
 *    Destination Authority (resolveNamedTurnDestination); it wins over the older destination.
 *    Pending → one existing provider validation; failure → undefined (never the old city, never
 *    the parent city).
 * 3. Pure continuation: the conversation's confirmed scope; a recommendation snapshot area is
 *    only a candidate and must pass validateCategoryTurnDestination.
 * 4. Not a continuation sentence: the whole text goes to the Authority (same as 2). When the
 *    frozen grammar still reads it as continuation and the Authority finds no destination
 *    fragment in it, it is handled as a pure continuation (3).
 * 5. Otherwise undefined: the caller stops before Credits (existing no-more / safe-end branch).
 */
export async function resolveMorePlacesTurnDestination(params: {
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  userText: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
}): Promise<string | undefined> {
  const text = params.userText ?? "";
  // Per-turn switch state: an uncertain negation never searches (never the old / negated city);
  // a switch only hands its target label to the Authority (a classify verdict is never trust).
  const turnSwitch = classifyDestinationSwitchTurn(text);
  const switchLabel =
    turnSwitch.state === "CONFIRMED_SWITCH" ? turnSwitch.targetLabel?.trim() || undefined : undefined;
  if (turnSwitch.state === "NEGATED_UNCERTAIN") return undefined;
  if (turnSwitch.state === "CONFIRMED_SWITCH" && !switchLabel) return undefined;
  const structure = analyzeContinueRecommendationStructure(text);
  if (structure.isContinue && (switchLabel || structure.hasPendingPlaceCandidate)) {
    const candidateLabel = switchLabel ?? structure.candidateText;
    // Same label as the already-confirmed scope (existing F10 confirmation; no snapshot trust):
    // continue it as-is. Never widened to a parent city; any other label goes to the Authority.
    const confirmed = confirmedContextDestination(params.ctx, params.session);
    if (
      confirmed &&
      compactLabel(candidateLabel) === compactLabel(confirmed.destination)
    ) {
      return confirmed.destination;
    }
    const named = await resolveNamedTurnDestination(candidateLabel, params);
    if (named || confirmed) return named;
    // The named label is the unconfirmed context destination itself (e.g. a Trip → Chat city
    // outside the known tables): only a pending candidate, never trusted from its shape.
    return compactLabel(candidateLabel) ===
      compactLabel(firstContextDestinationLabel(params.ctx, params.session))
      ? trustedContextCandidateDestination(params.ctx, params.session, params)
      : undefined;
  }
  if (!structure.isContinue) {
    // Confirmed switch: only its target label goes to the Authority (never the old city).
    if (switchLabel) {
      return resolveNamedTurnDestination(
        switchLabel,
        params,
        !hasDanglingContinuationFragment(switchLabel),
      );
    }
    // 「大阪不去了，換金澤」: the negated place is never the search destination. Only the switched-to
    // wording goes to the Authority; none / unconfirmed → undefined (never the negated or old city).
    const negatedSwitch = parseNegatedDestinationSwitch(text);
    if (negatedSwitch) {
      const switched = negatedSwitch.switchedText;
      if (!switched) return undefined;
      return resolveNamedTurnDestination(
        switched,
        params,
        !hasDanglingContinuationFragment(switched),
      );
    }
    // A weak trailing continuation piece (「…再」) leaves no clean label: never geocoded.
    const named = await resolveNamedTurnDestination(
      text,
      params,
      !hasDanglingContinuationFragment(text),
    );
    if (named) return named;
    if (!matchesContinueRecommendationGrammar(text) || !turnHasNoDestinationFragment(text)) {
      return undefined;
    }
  }
  const confirmed = confirmedContextDestination(params.ctx, params.session);
  if (confirmed) return confirmed.destination;
  const candidate = contextSnapshotAreaCandidate(params.ctx, params.session, params.locale);
  if (!candidate) return trustedContextCandidateDestination(params.ctx, params.session, params);
  return (await validateCategoryTurnDestination(candidate, params)).destination;
}

/**
 * Planner selection continuation (「再推薦一些」in planning_selection mode): this turn's destination
 * label for resolveTrustedRecommendationSearchScope. A sentence that names a place gets only the
 * more_places verdict above (a named city wins; never the old city; untrusted → undefined). Only a
 * pure continuation (no place candidate, no switch wording) uses the selection's own Plan form
 * label, which is still just a candidate for the A2 gate (never trusted from the Client snapshot).
 */
function planningSelectionTurnHasPlaceFragment(userText: string): boolean {
  // Pure (no provider): whether this sentence names a place for the Planner selection gate.
  const text = userText ?? "";
  // Same place-candidate verdict as the more_places path: a continue sentence names a place only
  // through its pending candidate / switch wording; any other sentence through an Authority
  // fragment. A pure continuation (no candidate) is always the selection itself — never the
  // context destination a previous turn wrote (e.g. a sub-area of the selection).
  const structure = analyzeContinueRecommendationStructure(text);
  return (
    classifyDestinationSwitchTurn(text).state !== "NO_SWITCH" ||
    (structure.isContinue
      ? structure.hasPendingPlaceCandidate
      : !turnHasNoDestinationFragment(text))
  );
}

/**
 * Planner selection general / place-detail turn: whether the sentence names a place. Same verdict
 * as the continuation above, except that a one-character provisional fragment (「我想吃拉麵」→「我」)
 * is a pronoun / function word, never a place name. The general gate itself runs only on the
 * destination name this turn would actually write.
 */
export function planningSelectionTurnNamesPlace(userText: string): boolean {
  const text = userText ?? "";
  if (!planningSelectionTurnHasPlaceFragment(text)) return false;
  if (classifyDestinationSwitchTurn(text).state !== "NO_SWITCH") return true;
  if (analyzeContinueRecommendationStructure(text).isContinue) return true;
  const turn = resolveDestination({ text });
  return !(
    turn.source === "provisional_fragment" && Array.from(turn.rawLabel?.trim() ?? "").length < 2
  );
}

/**
 * Planner selection general / place-detail turn: the sentence itself asks to go somewhere else
 * (existing switch wording「改去〇〇」「換到〇〇」, or a negated switch). Pure; no provider.
 */
export function planningSelectionTurnRequestsSwitch(userText: string): boolean {
  const text = userText ?? "";
  return (
    classifyDestinationSwitchTurn(text).state !== "NO_SWITCH" ||
    Boolean(parseNegatedDestinationSwitch(text)) ||
    Boolean(planningSelectionTurnSwitchTarget(text))
  );
}

// Planner selection only (classifyDestinationSwitchTurn is unchanged for every other path):
// explicit switch wording 「改去／換到／換去／改成〇〇」「我要換到〇〇」「不要京都了，去〇〇」.
const SELECTION_SWITCH_PRONOUN = "(?:我們|我们|那我|那就|我|那|就|還是|还是|先)";
const SELECTION_SWITCH_LEAD_RE = new RegExp(
  `^${SELECTION_SWITCH_PRONOUN}?(?:要|想)?(?:改|換|换)(?:去|到|成)`,
);
const SELECTION_SWITCH_NEGATED_RE = new RegExp(
  `^${SELECTION_SWITCH_PRONOUN}?(?:不要|不想|不)去?[^，,、。！!？?\\s]{1,12}?了[，,、。！!\\s]*` +
    `${SELECTION_SWITCH_PRONOUN}?(?:要|想)?(?:(?:改|換|换)(?:去|到|成)?|去)`,
);
const SELECTION_SWITCH_TARGET_END_RE = /[，,、。！!？?\s]/;
const SELECTION_SWITCH_TARGET_PARTICLE_RE = /(?:好了|吧|啦|了|嗎|吗|呢)+$/;
/** Plan edits after 「改成」 (days, time of day, pace, transport, budget…) are never a place. */
const SELECTION_SWITCH_NON_PLACE_RE =
  /^(?:[一二三四五六七八九十兩两半幾几\d]+\s*(?:天|日|晚|夜|點|点|個|个|小時|小时|週|周|月|號|号|人|位|元|塊|块|次)|早上|上午|中午|下午|傍晚|晚上|半夜|凌晨|白天|今天|明天|後天|后天|今晚|明晚|週末|周末|平日|假日|早一|晚一|輕鬆|轻松|悠閒|悠闲|緊湊|紧凑|自由行|跟團|跟团|自駕|自驾|開車|开车|步行|走路|騎車|骑车|搭|坐|大眾運輸|大众运输|捷運|捷运|公車|公车|火車|火车|高鐵|高铁|飛機|飞机|預算|预算|便宜|高級|高级|素食|室內|室内|戶外|户外|別的|别的|其他|其它|另一|下一)/;

/**
 * Planner selection general / place-detail turn: the place an explicit switch sentence asks to go
 * to (「改去台中」→「台中」); undefined when the wording is absent or what follows is no place
 * (「改成三天」「改成下午」). Pure and lexical; the A2 gate decides whether it is trusted.
 */
export function planningSelectionTurnSwitchTarget(userText: string): string | undefined {
  const text = (userText ?? "").trim();
  const lead = text.match(SELECTION_SWITCH_NEGATED_RE) ?? text.match(SELECTION_SWITCH_LEAD_RE);
  if (!lead) return undefined;
  const rest = text.slice(lead[0].length).trim();
  const head = (rest.split(SELECTION_SWITCH_TARGET_END_RE)[0] ?? "")
    .replace(SELECTION_SWITCH_TARGET_PARTICLE_RE, "")
    .trim();
  const split = splitTrailingActivityTail(head);
  const label = split.kind === "split" ? split.head : split.kind === "none" ? head : "";
  if (Array.from(label).length < 2 || Array.from(label).length > 12) return undefined;
  if (isKnownTouristCityLabel(label) || isKnownDestinationLabel(label)) return label;
  if (SELECTION_SWITCH_NON_PLACE_RE.test(label) || /[廳厅店館馆]$/.test(label)) return undefined;
  if (/^[一另別别其下新](?:家|間|间|個|个|的|處|处|種|种)/.test(label)) return undefined;
  if (!/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z]+$/u.test(label)) return undefined;
  if (hasCategoryPlaceQuery(label) || isCategoryNonDestinationLabel(label)) return undefined;
  return planningSelectionTurnNamesPlace(label) ? label : undefined;
}

/**
 * Planner selection: the known city a written destination name starts with (「大阪道頓堀」→「大阪」,
 * or the known city itself). Only when the whole name is a local known destination / curated area:
 * a known city followed by free text (「大阪朋友…」) is never one. Pure; no provider.
 */
export function planningSelectionWrittenLeadingCity(label: string | undefined): string | undefined {
  const text = label?.trim();
  if (!text) return undefined;
  if (isKnownTouristCityLabel(text)) return normalizeDestinationLabel(text);
  const verdict = resolveDestination({ text });
  if (verdict.confidence !== "confirmed" && verdict.confidence !== "curated") return undefined;
  return splitKnownParentAreaLabel(text)?.parentCity;
}

// #PL-FIX-T7: a written name the sentence only uses incidentally — a food / product / dialect /
// people word named after the place (「大阪燒」「京都抹茶」「大阪腔」「大阪人」), where someone else
// lives / comes from (「我朋友住大阪」), or a comparison of something there (「大阪的拉麵比較好吃嗎」).
// #PL-FIX-T8: 「人氣」「人潮」 and 「拉麵店」 are not incidental (the place is still asked about).
const SELECTION_INCIDENTAL_SUFFIX_RE =
  /^(?:燒|焼|抹茶|拉麵(?!店)|拉面(?!店)|香蕉|牛奶|米粉|太陽餅|太阳饼|擔仔麵|担仔面|腔|人(?![氣气潮])|名產|名产|特產|特产|伴手禮|伴手礼|風味|风味|口味)/;
const SELECTION_INCIDENTAL_OTHER_PERSON_RE =
  /(?:朋友|家人|同事|親戚|亲戚|同學|同学|父母|爸媽|爸妈|爸爸|媽媽|妈妈|男友|女友|老公|老婆|哥哥|姊姊|姐姐|弟弟|妹妹|親友|亲友)(?:們|们)?(?:都|也)?(?:住在|住|來自|来自|在)$/;
const SELECTION_INCIDENTAL_COMPARISON_RE = /^的[^，,、。！!？?\s]{1,8}?(?:比較|比较|比)/;

/**
 * #PL-FIX-T8: Planner selection explicit nearby turn — the written name when it is the nearby
 * anchor itself (「大阪附近」「京都車站附近」→ the name). A finer place written after it
 * (「大阪道頓堀附近」, a landmark) or no 「附近」 after it → undefined (not gated). Pure; no provider.
 */
export function planningSelectionTurnNearbyAnchor(
  userText: string,
  label: string | undefined,
): string | undefined {
  const name = label?.trim();
  if (!name) return undefined;
  const text = userText ?? "";
  const at = text.indexOf(name);
  if (at < 0) return undefined;
  const near = text.indexOf("附近", at + name.length);
  if (near < 0) return undefined;
  const tail = text.slice(at + name.length, near).trim();
  return /^(?:(?:火)?[車车]站|站|駅)?$/.test(tail) ? name : undefined;
}

/**
 * #PL-FIX-T7: Planner selection general turn — every occurrence of the written name in the
 * sentence is incidental (see above), so the sentence does not ask to go there. Pure; no provider.
 */
export function planningSelectionTurnMentionsPlaceIncidentally(
  userText: string,
  label: string | undefined,
): boolean {
  const text = userText ?? "";
  const name = label?.trim();
  if (!name || !text.includes(name)) return false;
  let index = text.indexOf(name);
  while (index >= 0) {
    const before = text.slice(0, index);
    const after = text.slice(index + name.length);
    const incidental =
      SELECTION_INCIDENTAL_SUFFIX_RE.test(after) ||
      SELECTION_INCIDENTAL_OTHER_PERSON_RE.test(before) ||
      SELECTION_INCIDENTAL_COMPARISON_RE.test(after);
    if (!incidental) return false;
    index = text.indexOf(name, index + name.length);
  }
  return true;
}

/**
 * #PL-FIX-T7: a geocode answer of this turn with no result at all (ZERO_RESULTS). A transient
 * failure (thrown / quota / denied / network) or any returned-but-untrusted result is not one.
 * Pure: reads an envelope this turn already received; never sends a request.
 */
export function isGeocodeZeroResultsEnvelope(envelope: GeocodeFnEnvelope | null | undefined): boolean {
  if (!envelope || envelope.location) return false;
  const result = envelope.providerResult;
  const reason = result?.failureReason ?? envelope.error ?? undefined;
  if (reason !== "geocode_zero_results") return false;
  return !result || (result.rawResultCount ?? 0) === 0;
}

export async function resolvePlanningSelectionTurnDestination(params: {
  ctx: CanonicalTravelContext;
  session: ChatPlanningSession;
  userText: string;
  locale: Locale;
  geocodeFn: GeocodeDestinationFn;
  selectionLabel: string | undefined;
}): Promise<string | undefined> {
  const text = params.userText ?? "";
  if (!planningSelectionTurnHasPlaceFragment(text))
    return params.selectionLabel?.trim() || undefined;
  // A named place: only the more_places verdict for it (never the selection / old city when it is
  // not trusted — the caller then stops before Credits / Places).
  return resolveMorePlacesTurnDestination(params);
}

// ─────────────── Clarification flow coordination ───────────────

/**
 * A known parent city is trusted only when the Authority itself confirms the parent label
 * (existing known-destination tables). Returns the Authority's normalised destination.
 */
function authorityConfirmedParentCity(candidate: DestinationAreaCandidate): string | undefined {
  const parent = candidate.parentCity?.trim();
  if (!parent) return undefined;
  const verdict = resolveDestination({ text: parent });
  return verdict.confidence === "confirmed" && verdict.source === "known_city"
    ? verdict.destination
    : undefined;
}

export type CategoryTurnClarificationPlan =
  /** Trusted parent + unconfirmed tail: confirm searching the parent city only. */
  | { kind: "parent_city_scope"; confirmedParentCity: string }
  /** Parent-less fragment: existing「哪個城市／地區」clarification (copy label only). */
  | { kind: "destination_area"; clarificationLabel: string };

/**
 * Which clarification (if any) an unconfirmed turn destination needs. Pure; no provider calls.
 * A known-parent tail never becomes a "which region of <whole string>" question, and a tail
 * whose parent the Authority cannot confirm gets no clarification (caller's general flow).
 */
export function planCategoryTurnClarification(
  resolution: DestinationResolution,
): CategoryTurnClarificationPlan | null {
  if (resolution.destination) return null;
  if (resolution.areaCandidate) {
    const confirmedParentCity = authorityConfirmedParentCity(resolution.areaCandidate);
    return confirmedParentCity ? { kind: "parent_city_scope", confirmedParentCity } : null;
  }
  const fragment = resolution.provisionalCandidate?.areaCandidate?.trim();
  return fragment ? { kind: "destination_area", clarificationLabel: fragment } : null;
}

/**
 * The turn destination after the user confirmed the parent-city scope: Authority verdict for
 * the parent label alone (confirmed known city → no provider validation / geocode needed).
 */
export function resolveConfirmedParentScopeTurnDestination(
  confirmedParentCity: string,
): DestinationResolution {
  return resolveDestination({ text: confirmedParentCity });
}

/**
 * userText handed to the existing category flow after a parent-scope confirmation.
 * The original sentence is kept (intent / subtype parsing). Exception: the existing
 * explicit-meal parser would read its own city out of the sentence and use it as a Places
 * query city (chat-destination-category-recommendation: mealIntent.city); when that city is
 * not the confirmed parent, the unconfirmed wording must not reach Google.
 *
 * Meal preservation: the pending's unconfirmed label is replaced by the confirmed parent in
 * the original sentence (the unconfirmed tail is dropped, never treated as a scope), and the
 * existing parser must then read exactly the confirmed parent as its city with the same meal
 * slot. Only if no such text exists, the existing parent + category request text is used.
 */
export function resolveParentScopeSearchUserText(
  pending: PendingGeographicClarification,
  confirmedParentCity: string,
): string {
  const original = pending.originalUserText?.trim() ?? "";
  if (!original) return buildParentScopeCategoryUserText(pending, confirmedParentCity);
  const originalMeal = resolveExplicitMealIntent(original);
  const mealCity = originalMeal?.city;
  if (!originalMeal || !mealCity || compactLabel(mealCity) === compactLabel(confirmedParentCity)) {
    return original;
  }
  const parent = confirmedParentCity.trim();
  const rawLabel = pending.rawGeographicLabel?.trim() ?? "";
  if (parent && rawLabel && original.includes(rawLabel)) {
    // The extractor's label may have absorbed the meal wording (「京都看楓葉晚餐」). Remove the
    // longest label prefix (always longer than the parent, so the tail is cut) whose removal
    // still lets the existing parser read the same meal slot with the parent as its city.
    const minLength = rawLabel.startsWith(parent) ? parent.length + 1 : rawLabel.length;
    for (let length = rawLabel.length; length >= minLength; length -= 1) {
      const removed = rawLabel.slice(0, length);
      const remainder = original.replace(removed, "").trim();
      const candidates = [
        original.replace(removed, parent),
        // Parent followed by the parser's own city delimiter, then the rest of the sentence.
        remainder ? `${parent}的 ${remainder}` : "",
      ];
      for (const candidate of candidates) {
        if (!candidate) continue;
        const meal = resolveExplicitMealIntent(candidate);
        if (
          meal?.slot === originalMeal.slot &&
          meal.city &&
          compactLabel(meal.city) === compactLabel(parent)
        ) {
          return candidate;
        }
      }
    }
  }
  return buildParentScopeCategoryUserText(pending, confirmedParentCity);
}
