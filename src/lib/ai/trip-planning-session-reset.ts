import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import {
  createPlanningSessionId,
  clearFrozenPlanningDayPlan,
  logAiPlanningSessionStart,
  logAiSessionCreate,
} from "@/lib/ai/ai-planning-session";
import { resetPlannerSession } from "@/lib/ai/planner-session-guard";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isDestinationPlanningText,
  isKnownCountryLabel,
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
  resolveDestinationFromText,
} from "@/lib/ai/trip-planning-context";
import {
  isTravelRegionLabel,
  resolveDestinationEntity,
} from "@/lib/ai/destination-entity";
import { resolveDestinationScopeFields } from "@/lib/ai/destination-scope";
import { clearResolvedDestinationScope } from "@/lib/ai/resolved-destination-scope";
import { parseTravelDateRangeFromText } from "@/lib/ai/parse-travel-date-range";
import { parseDayCountFromText } from "@/lib/parse-chinese-duration";
import {
  isCombinationSelectionContinuationReply,
  isExplicitPrimaryDestinationSwitch,
  parseExplicitPrimaryDestinationSwitch,
} from "@/lib/ai/combination-selection-reply";
import {
  captureLockedDestinationSnapshot,
  isValidCoordinate,
  resolvePlanningDestination,
  restoreLockedDestinationToContext,
  type ResolvedTripDestination,
} from "@/lib/ai/resolved-trip-destination";

export type NewTripPlanningReason =
  | "destination_changed"
  | "country_changed"
  | "city_changed"
  | "travel_month_changed"
  | "travel_date_changed"
  | "phase_done_new_trip"
  | "new_trip_requirements";

export type NewTripPlanningResult = {
  isNew: boolean;
  reason?: NewTripPlanningReason;
  incomingDestination?: string;
  incomingTravelMonth?: string;
};

/** Date / itinerary fields only — never wipe a locked destination. */
const DATE_CHANGE_CLEARED_FIELDS = [
  "travelDate",
  "startDate",
  "endDate",
  "tripDays",
  "tripStartDate",
  "tripEndDate",
  "suggestedStartDate",
  "travelMonth",
  "travelYear",
  "selectedCombinationIds",
  "selectedCombinationPlaceNames",
  "excludedCombinationPlaceNames",
  "nearbyExtensions",
  "unresolvedNearbyExtensions",
  "offeredCombinations",
  "selectionSource",
  "generationRequestId",
  "lastItineraryFailure",
  "partiallyResolvedPlaces",
  "failedCombinationIds",
  "mustVisitGenerated",
  "planningStage",
  "conversationState",
  "selectedPlanMode",
  "planningTripStyle",
  "selectedTripStyle",
  "tripPurpose",
  "pendingQuestion",
  "generatedItinerary",
  "draftTrip",
  "currentDayPlan",
  "weather",
  "weatherContext",
  "candidatePools",
  "regionExpansionCache",
  "placeResolutionCache",
  "dailyClusters",
  "coverageReport",
  "combinationSelectionState",
  "aiItineraryState",
] as const;

/** Destination switch — clear destination + date/itinerary state. */
const DESTINATION_CHANGE_CLEARED_FIELDS = [
  ...DATE_CHANGE_CLEARED_FIELDS,
  "destination",
  "destinationCountry",
  "destinationCountryCode",
  "destinationCity",
  "destinationRegion",
  "destinationCities",
  "destinationType",
  "destinationScopeId",
  "destinationCoordinates",
] as const;

/** Full new conversation — same as destination change for trip fields. */
const NEW_CONVERSATION_CLEARED_FIELDS = DESTINATION_CHANGE_CLEARED_FIELDS;

function isDateOnlyResetReason(reason: NewTripPlanningReason): boolean {
  return reason === "travel_date_changed" || reason === "travel_month_changed";
}

function isDestinationResetReason(reason: NewTripPlanningReason): boolean {
  return (
    reason === "destination_changed" ||
    reason === "country_changed" ||
    reason === "city_changed"
  );
}

/** Parse relative / absolute month labels from user text. */
export function parseTravelMonthFromText(text: string, now = new Date()): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (/下個月|下个月|下月/.test(t)) {
    const next = new Date(now);
    next.setMonth(next.getMonth() + 1);
    return `${next.getMonth() + 1}月`;
  }
  if (/這個月|这个月|本月/.test(t)) {
    return `${now.getMonth() + 1}月`;
  }
  const m = t.match(/(\d{1,2})\s*月/);
  if (!m) return undefined;
  return `${Number.parseInt(m[1], 10)}月`;
}

function resolveActiveDestination(session: ChatPlanningSession): string | undefined {
  const candidates = [
    session.travelContext?.destination,
    session.tripPlanningContext?.destination,
    session.tripDestination?.displayLabel,
    session.tripDestination?.city,
  ];
  for (const c of candidates) {
    const label = c?.trim();
    if (label) return normalizeDestinationLabel(label);
  }
  return undefined;
}

function resolveActiveCountry(session: ChatPlanningSession): string | undefined {
  const raw =
    session.travelContext?.destinationCountry?.trim() ||
    (session.travelContext?.destination &&
    isKnownCountryLabel(session.travelContext.destination) &&
    !isKnownTouristCityLabel(session.travelContext.destination)
      ? session.travelContext.destination
      : undefined);
  return raw ? normalizeDestinationLabel(raw) : undefined;
}

/**
 * Country → city/region in the same country is a refinement of the same trip,
 * not a brand-new planning session (e.g. 日本 → 東京).
 */
export function isCountryToCityRefinement(
  prevDestination: string | undefined,
  prevCountry: string | undefined,
  nextDestination: string,
): boolean {
  const prev = prevDestination ? normalizeDestinationLabel(prevDestination) : "";
  const next = normalizeDestinationLabel(nextDestination);
  if (!prev || !next || prev === next) return false;

  const prevEntity = resolveDestinationEntity(prev);
  const prevIsCountry =
    prevEntity.type === "country" &&
    isKnownCountryLabel(prev) &&
    !isKnownTouristCityLabel(prev) &&
    !isTravelRegionLabel(prev);
  if (!prevIsCountry) return false;

  const nextEntity = resolveDestinationEntity(next);
  if (nextEntity.type === "city_state") return false;

  const nextIsPlace =
    isKnownTouristCityLabel(next) ||
    isTravelRegionLabel(next) ||
    nextEntity.type !== "country";
  if (!nextIsPlace) return false;

  const nextCountry = nextEntity.country
    ? normalizeDestinationLabel(nextEntity.country)
    : undefined;
  const expectedCountry = prevCountry
    ? normalizeDestinationLabel(prevCountry)
    : prev;
  return Boolean(nextCountry && nextCountry === expectedCountry);
}

function destinationsDiffer(a: string, b: string): boolean {
  return normalizeDestinationLabel(a) !== normalizeDestinationLabel(b);
}

function datesDiffer(
  a: { start?: string; end?: string },
  b: { start?: string; end?: string },
): boolean {
  const aStart = a.start?.trim() || "";
  const aEnd = a.end?.trim() || "";
  const bStart = b.start?.trim() || "";
  const bEnd = b.end?.trim() || "";
  if (!bStart && !bEnd) return false;
  if (!aStart && !aEnd) return false;
  return aStart !== bStart || aEnd !== bEnd;
}

/**
 * Detect whether the user turn starts a NEW trip planning session
 * rather than continuing / refining the current one.
 */
export function isNewTripPlanning(
  session: ChatPlanningSession,
  userText: string,
): NewTripPlanningResult {
  const text = userText.trim();
  if (!text) return { isNew: false };

  const prevDest = resolveActiveDestination(session);
  const prevCountry = resolveActiveCountry(session);
  const offeredCount = session.travelContext?.offeredCombinations?.length ?? 0;
  const pendingType = session.pendingQuestion?.type;
  const primaryForContinuation =
    session.pendingQuestion?.baseDestination?.trim() || prevDest;

  // 組合選擇延續（如「1、2跟橫濱」）：近郊延伸不得觸發 city_changed reset
  if (
    isCombinationSelectionContinuationReply(text, {
      pendingType,
      primaryDestination: primaryForContinuation,
      combinationCount: offeredCount || undefined,
      hasOfferedCombinations: offeredCount > 0,
    })
  ) {
    return {
      isNew: false,
      incomingDestination: prevDest,
    };
  }

  // combination_choice 中未明確「改去／目的地改成」時，嵌入城市不得覆蓋主目的地
  if (
    pendingType === "combination_choice" &&
    !isExplicitPrimaryDestinationSwitch(text) &&
    prevDest
  ) {
    return {
      isNew: false,
      incomingDestination: prevDest,
    };
  }

  const explicitSwitch = parseExplicitPrimaryDestinationSwitch(text);
  const incomingDestination =
    explicitSwitch ??
    (isExplicitPrimaryDestinationSwitch(text)
      ? undefined
      : resolveDestinationFromText(text));
  const incomingTravelMonth = parseTravelMonthFromText(text);
  const incomingRange = parseTravelDateRangeFromText(text);
  const prevMonth = session.travelContext?.travelMonth?.trim();
  const prevStart =
    session.travelContext?.startDate?.trim() ||
    session.tripStartDate?.trim() ||
    session.travelDate?.trim();
  const prevEnd =
    session.travelContext?.endDate?.trim() || session.tripEndDate?.trim();

  const hasExistingTripState = Boolean(
    prevDest ||
      prevStart ||
      prevEnd ||
      session.tripDays ||
      session.travelContext?.selectedCombinationIds?.length ||
      session.travelContext?.offeredCombinations?.length ||
      session.draftTrip ||
      session.currentDayPlan ||
      session.planningSessionId ||
      session.phase === "done",
  );

  if (incomingDestination) {
    const next = normalizeDestinationLabel(incomingDestination);
    if (prevDest && destinationsDiffer(prevDest, next)) {
      if (!isCountryToCityRefinement(prevDest, prevCountry, next)) {
        const prevEntity = resolveDestinationEntity(prevDest);
        const nextEntity = resolveDestinationEntity(next);
        const prevCountryLabel = normalizeDestinationLabel(
          prevCountry ??
            (prevEntity.type === "country" || prevEntity.type === "city_state"
              ? prevDest
              : prevEntity.country ?? prevDest),
        );
        const nextCountryLabel = normalizeDestinationLabel(
          nextEntity.type === "country" || nextEntity.type === "city_state"
            ? next
            : nextEntity.country ?? next,
        );
        const bothCountries =
          (prevEntity.type === "country" ||
            (isKnownCountryLabel(prevDest) &&
              !isKnownTouristCityLabel(prevDest) &&
              prevEntity.type !== "city_state")) &&
          (nextEntity.type === "country" ||
            (isKnownCountryLabel(next) &&
              !isKnownTouristCityLabel(next) &&
              nextEntity.type !== "city_state"));
        const bothPlacesSameCountry =
          prevCountryLabel === nextCountryLabel &&
          !bothCountries &&
          (prevEntity.type === "city" ||
            prevEntity.type === "city_state" ||
            prevEntity.type === "region" ||
            isKnownTouristCityLabel(prevDest) ||
            isTravelRegionLabel(prevDest)) &&
          (nextEntity.type === "city" ||
            nextEntity.type === "city_state" ||
            nextEntity.type === "region" ||
            isKnownTouristCityLabel(next) ||
            isTravelRegionLabel(next));

        let reason: NewTripPlanningReason = "destination_changed";
        if (bothCountries) reason = "country_changed";
        else if (bothPlacesSameCountry) reason = "city_changed";

        return {
          isNew: true,
          reason,
          incomingDestination: next,
          incomingTravelMonth,
        };
      }
    }

    // Completed trip → same destination again still needs a fresh session.
    if (session.phase === "done" && hasExistingTripState) {
      return {
        isNew: true,
        reason: "phase_done_new_trip",
        incomingDestination: next,
        incomingTravelMonth,
      };
    }
  }

  if (
    incomingTravelMonth &&
    prevMonth &&
    incomingTravelMonth !== prevMonth &&
    hasExistingTripState
  ) {
    return {
      isNew: true,
      reason: "travel_month_changed",
      incomingDestination: incomingDestination
        ? normalizeDestinationLabel(incomingDestination)
        : prevDest,
      incomingTravelMonth,
    };
  }

  const monthOnlyToConcreteDates =
    Boolean(prevMonth || prevStart) &&
    !session.travelContext?.startDate &&
    !session.tripStartDate &&
    Boolean(incomingRange.startDate || incomingRange.endDate) &&
    // prevStart may be a non-ISO month label mirrored onto session.travelDate
    Boolean(prevDest || incomingDestination) &&
    hasExistingTripState;

  if (
    (incomingRange.startDate || incomingRange.endDate) &&
    (datesDiffer(
      { start: prevStart, end: prevEnd },
      { start: incomingRange.startDate, end: incomingRange.endDate },
    ) ||
      monthOnlyToConcreteDates) &&
    hasExistingTripState &&
    // Changing dates on an active destination is a new trip window.
    Boolean(prevDest || incomingDestination)
  ) {
    return {
      isNew: true,
      reason: "travel_date_changed",
      incomingDestination: incomingDestination
        ? normalizeDestinationLabel(incomingDestination)
        : prevDest,
      incomingTravelMonth: incomingTravelMonth ?? prevMonth,
    };
  }

  // Explicit new-trip phrasing without destination still resets after a finished plan.
  if (
    session.phase === "done" &&
    isDestinationPlanningText(text, session) &&
    hasExistingTripState
  ) {
    return {
      isNew: true,
      reason: "phase_done_new_trip",
      incomingDestination: incomingDestination
        ? normalizeDestinationLabel(incomingDestination)
        : undefined,
      incomingTravelMonth,
    };
  }

  // Brand-new destination while previous trip still has dates/session (empty prev dest rare).
  if (
    incomingDestination &&
    !prevDest &&
    (prevStart || prevEnd || session.tripDays || session.planningSessionId) &&
    isDestinationPlanningText(text, session)
  ) {
    return {
      isNew: true,
      reason: "new_trip_requirements",
      incomingDestination: normalizeDestinationLabel(incomingDestination),
      incomingTravelMonth,
    };
  }

  return {
    isNew: false,
    incomingDestination: incomingDestination
      ? normalizeDestinationLabel(incomingDestination)
      : undefined,
    incomingTravelMonth,
  };
}

function preserveLongTermPreferences(
  prev?: CanonicalTravelContext,
): Pick<
  CanonicalTravelContext,
  | "interests"
  | "selectedInterests"
  | "excludedCategories"
  | "companion"
  | "budgetPreference"
  | "priceSensitivity"
  | "budgetLevel"
  | "travelStyle"
> {
  return {
    interests: [...(prev?.interests ?? [])],
    selectedInterests: prev?.selectedInterests ? [...prev.selectedInterests] : undefined,
    excludedCategories: prev?.excludedCategories
      ? [...prev.excludedCategories]
      : undefined,
    companion: prev?.companion,
    budgetPreference: prev?.budgetPreference,
    priceSensitivity: prev?.priceSensitivity,
    budgetLevel: prev?.budgetLevel,
    travelStyle: prev?.travelStyle,
  };
}

function buildTripDestinationFromResolved(
  resolved: ResolvedTripDestination,
): ChatPlanningSession["tripDestination"] {
  const coordsOk = isValidCoordinate(resolved.latitude, resolved.longitude);
  return {
    placeId: resolved.placeId ?? "",
    country: resolved.country ?? "",
    city: resolved.city ?? resolved.label,
    lat: coordsOk ? resolved.latitude! : 0,
    lng: coordsOk ? resolved.longitude! : 0,
    formattedName: resolved.label,
    displayLabel: resolved.label,
  };
}

function hydrateDestinationFromIncoming(
  incoming: string,
  prefs: ReturnType<typeof preserveLongTermPreferences>,
  locked?: ResolvedTripDestination | null,
): {
  travelContext: CanonicalTravelContext;
  resolved: ResolvedTripDestination;
} {
  const scope = resolveDestinationScopeFields(incoming);
  const base: CanonicalTravelContext = {
    ...prefs,
    destination: scope.destinationName,
    destinationCountry: scope.destinationCountry,
    destinationType: scope.destinationType,
    destinationCity: scope.destinationCity,
    destinationRegion: scope.destinationRegion,
    interests: prefs.interests,
  };

  // Prefer previously locked snapshot (same label) over label-only stub.
  if (locked && normalizeDestinationLabel(locked.label) === incoming) {
    const restored = restoreLockedDestinationToContext(locked, base);
    const resolved =
      resolvePlanningDestination(restored) ??
      ({
        ...locked,
        label: incoming,
        type: scope.destinationType,
        city: scope.destinationCity ?? locked.city,
        country: scope.destinationCountry ?? locked.country,
      } satisfies ResolvedTripDestination);
    return { travelContext: restored, resolved };
  }

  const resolved =
    resolvePlanningDestination(base) ??
    ({
      label: incoming,
      city: scope.destinationCity,
      country: scope.destinationCountry,
      type: scope.destinationType,
      source: "scope_fields",
      scopeLocked: false,
    } satisfies ResolvedTripDestination);

  return {
    travelContext: {
      ...base,
      destinationCountryCode: resolved.countryCode,
      destinationCoordinates: isValidCoordinate(resolved.latitude, resolved.longitude)
        ? { lat: resolved.latitude!, lng: resolved.longitude! }
        : undefined,
      destinationScopeId: resolved.scopeId,
    },
    resolved,
  };
}

function applyCommonSessionShell(
  session: ChatPlanningSession,
  opts: {
    reason: NewTripPlanningReason;
    newSessionId: string;
    travelContext: CanonicalTravelContext;
    tripDestination?: ChatPlanningSession["tripDestination"];
    incoming?: string;
    monthFromText?: string;
    rangeFromText: { startDate?: string; endDate?: string; days?: number };
    daysFromText?: number;
  },
): ChatPlanningSession {
  const {
    newSessionId,
    travelContext,
    tripDestination,
    incoming,
    monthFromText,
    rangeFromText,
    daysFromText,
  } = opts;

  return {
    ...session,
    planningSessionId: newSessionId,
    planVersion: (session.planVersion ?? 0) + 1,
    phase: session.phase === "done" ? "discover" : session.phase,
    travelDate: travelContext.startDate,
    tripStartDate: travelContext.startDate,
    tripEndDate: travelContext.endDate,
    tripDays: travelContext.days,
    tripDestination,
    tripPlanningContext: incoming
      ? {
          destination: incoming,
          travelMonth: monthFromText,
          startDate: rangeFromText.startDate,
          endDate: rangeFromText.endDate,
          days: daysFromText,
          selectedPlaces: [],
          intent: "destination_planning",
        }
      : undefined,
    travelContext,
    weather: undefined,
    pendingQuestion: undefined,
    adviceSelectionThisTurn: undefined,
    lastResolvedPendingQuestion: undefined,
    lastAssistantReply: undefined,
    currentDayPlan: undefined,
    draftTrip: undefined,
    lastGeneratedTripId: undefined,
    recommendedPlaces: [],
    selectedPlaces: [],
    recommendedPlaceIds: [],
    recommendedNormalizedNames: [],
    plannedStops: [],
    selectedPlaceIds: [],
    selectedPlaceNames: [],
    usedPlaceIds: undefined,
    usedPlaceNames: undefined,
    usedAreaKeys: undefined,
    aiItineraryState: undefined,
    chatPlanningState: "idle",
    conversationMode: incoming ? "destination_planning" : session.conversationMode,
    preferredArea: incoming ?? undefined,
    askedClarifyKeys: undefined,
    activeChatIntent: undefined,
  };
}

function beginNewPlanningSessionIds(
  session: ChatPlanningSession,
  reason: NewTripPlanningReason,
): string {
  const oldSessionId = session.planningSessionId;
  const newSessionId = createPlanningSessionId();
  clearFrozenPlanningDayPlan(session.planningSessionId);
  resetPlannerSession(session.planningSessionId);
  logAiPipeline(
    "[NEW_TRIP_SESSION_CREATED]",
    `oldSessionId=${oldSessionId ?? "none"}`,
    `newSessionId=${newSessionId}`,
    `reason=${reason}`,
  );
  logAiPipeline(
    "[PLANNER_SESSION_NEW]",
    `oldSessionId=${oldSessionId ?? "none"}`,
    `newSessionId=${newSessionId}`,
    `reason=${reason}`,
  );
  logAiSessionCreate(reason, newSessionId);
  logAiPlanningSessionStart(newSessionId);
  return newSessionId;
}

/**
 * Date / month change: clear itinerary + date fields only.
 * Preserve locked destination (label, city, country, coords, scope).
 */
export function resetForDateChange(
  session: ChatPlanningSession,
  opts: {
    reason: "travel_date_changed" | "travel_month_changed";
    incomingDestination?: string;
    incomingTravelMonth?: string;
    userText?: string;
  },
): ChatPlanningSession {
  const prefs = preserveLongTermPreferences(session.travelContext);
  const locked = captureLockedDestinationSnapshot(session);
  const clearedList = [...DATE_CHANGE_CLEARED_FIELDS];
  const newSessionId = beginNewPlanningSessionIds(session, opts.reason);

  // Do NOT clearResolvedDestinationScope — date change must keep the lock.

  logAiPipeline(
    "[TRIP_CONTEXT_RESET]",
    `cleared=[${clearedList.join(",")}]`,
    `reason=${opts.reason}`,
    "mode=resetForDateChange",
  );

  const incomingRaw =
    opts.incomingDestination?.trim() ||
    locked?.label ||
    resolveActiveDestination(session);
  const incoming = incomingRaw
    ? normalizeDestinationLabel(incomingRaw)
    : undefined;

  const monthFromText =
    opts.incomingTravelMonth ??
    (opts.userText ? parseTravelMonthFromText(opts.userText) : undefined);
  const rangeFromText = opts.userText
    ? parseTravelDateRangeFromText(opts.userText)
    : {};
  const daysFromText = opts.userText
    ? parseDayCountFromText(opts.userText) ?? rangeFromText.days
    : undefined;

  const hydrated = incoming
    ? hydrateDestinationFromIncoming(incoming, prefs, locked)
    : {
        travelContext: { ...prefs, interests: prefs.interests } as CanonicalTravelContext,
        resolved: null as ResolvedTripDestination | null,
      };

  const conversationState = daysFromText
    ? "awaiting_combination_selection"
    : "awaiting_days";
  const planningStage = daysFromText ? "GENERATING_COMBINATIONS" : "ASK_DATE";

  const travelContext: CanonicalTravelContext = {
    ...hydrated.travelContext,
    travelMonth: monthFromText,
    startDate: rangeFromText.startDate,
    endDate: rangeFromText.endDate,
    days: daysFromText,
    planningDaysConfirmed: Boolean(
      daysFromText && rangeFromText.startDate && rangeFromText.endDate,
    ),
    conversationState,
    selectedCombinationIds: [],
  };

  logAiPipeline(
    "[TRIP_CONTEXT_AFTER_RESET]",
    `destination=${travelContext.destination ?? "null"}`,
    `destinationCity=${travelContext.destinationCity ?? "null"}`,
    `destinationCountry=${travelContext.destinationCountry ?? "null"}`,
    `destinationType=${travelContext.destinationType ?? "null"}`,
    `countryCode=${travelContext.destinationCountryCode ?? hydrated.resolved?.countryCode ?? "null"}`,
    `lat=${travelContext.destinationCoordinates?.lat ?? hydrated.resolved?.latitude ?? "null"}`,
    `lng=${travelContext.destinationCoordinates?.lng ?? hydrated.resolved?.longitude ?? "null"}`,
    `travelDate=${travelContext.startDate ?? "null"}`,
    `tripDays=${travelContext.days ?? "null"}`,
    `selectedCombinationIds=[]`,
    `planningStage=${planningStage}`,
    `conversationState=${conversationState}`,
  );

  return applyCommonSessionShell(session, {
    reason: opts.reason,
    newSessionId,
    travelContext,
    tripDestination: hydrated.resolved
      ? buildTripDestinationFromResolved(hydrated.resolved)
      : undefined,
    incoming,
    monthFromText,
    rangeFromText,
    daysFromText,
  });
}

/**
 * Destination / country / city switch: clear destination + itinerary, rehydrate new label.
 */
export function resetForDestinationChange(
  session: ChatPlanningSession,
  opts: {
    reason: NewTripPlanningReason;
    incomingDestination?: string;
    incomingTravelMonth?: string;
    userText?: string;
  },
): ChatPlanningSession {
  const prefs = preserveLongTermPreferences(session.travelContext);
  const clearedList = [...DESTINATION_CHANGE_CLEARED_FIELDS];
  const newSessionId = beginNewPlanningSessionIds(session, opts.reason);

  if (session.travelContext?.destination) {
    clearResolvedDestinationScope(session.travelContext.destination);
  }
  if (session.tripDestination?.city) {
    clearResolvedDestinationScope(session.tripDestination.city);
  }

  logAiPipeline(
    "[TRIP_CONTEXT_RESET]",
    `cleared=[${clearedList.join(",")}]`,
    `reason=${opts.reason}`,
    "mode=resetForDestinationChange",
  );

  const incoming = opts.incomingDestination?.trim()
    ? normalizeDestinationLabel(opts.incomingDestination)
    : undefined;
  const monthFromText =
    opts.incomingTravelMonth ??
    (opts.userText ? parseTravelMonthFromText(opts.userText) : undefined);
  const rangeFromText = opts.userText
    ? parseTravelDateRangeFromText(opts.userText)
    : {};
  const daysFromText = opts.userText
    ? parseDayCountFromText(opts.userText) ?? rangeFromText.days
    : undefined;

  const hydrated = incoming
    ? hydrateDestinationFromIncoming(incoming, prefs, null)
    : {
        travelContext: { ...prefs, interests: prefs.interests } as CanonicalTravelContext,
        resolved: null as ResolvedTripDestination | null,
      };

  const conversationState = daysFromText
    ? "awaiting_combination_selection"
    : "awaiting_days";
  const planningStage = daysFromText ? "GENERATING_COMBINATIONS" : "ASK_DATE";

  const travelContext: CanonicalTravelContext = {
    ...hydrated.travelContext,
    travelMonth: monthFromText,
    startDate: rangeFromText.startDate,
    endDate: rangeFromText.endDate,
    days: daysFromText,
    planningDaysConfirmed: Boolean(
      daysFromText && rangeFromText.startDate && rangeFromText.endDate,
    ),
    conversationState,
    selectedCombinationIds: [],
  };

  logAiPipeline(
    "[TRIP_CONTEXT_AFTER_RESET]",
    `destination=${travelContext.destination ?? "null"}`,
    `destinationCity=${travelContext.destinationCity ?? "null"}`,
    `destinationCountry=${travelContext.destinationCountry ?? "null"}`,
    `destinationType=${travelContext.destinationType ?? "null"}`,
    `travelDate=${travelContext.startDate ?? "null"}`,
    `tripDays=${travelContext.days ?? "null"}`,
    `selectedCombinationIds=[]`,
    `planningStage=${planningStage}`,
  );

  return applyCommonSessionShell(session, {
    reason: opts.reason,
    newSessionId,
    travelContext,
    tripDestination: hydrated.resolved
      ? buildTripDestinationFromResolved(hydrated.resolved)
      : undefined,
    incoming,
    monthFromText,
    rangeFromText,
    daysFromText,
  });
}

/** Finished trip / new conversation requirements. */
export function resetForNewConversation(
  session: ChatPlanningSession,
  opts: {
    reason: NewTripPlanningReason;
    incomingDestination?: string;
    incomingTravelMonth?: string;
    userText?: string;
  },
): ChatPlanningSession {
  const prefs = preserveLongTermPreferences(session.travelContext);
  const clearedList = [...NEW_CONVERSATION_CLEARED_FIELDS];
  const newSessionId = beginNewPlanningSessionIds(session, opts.reason);

  if (session.travelContext?.destination) {
    clearResolvedDestinationScope(session.travelContext.destination);
  }
  if (session.tripDestination?.city) {
    clearResolvedDestinationScope(session.tripDestination.city);
  }

  logAiPipeline(
    "[TRIP_CONTEXT_RESET]",
    `cleared=[${clearedList.join(",")}]`,
    `reason=${opts.reason}`,
    "mode=resetForNewConversation",
  );

  const incoming = opts.incomingDestination?.trim()
    ? normalizeDestinationLabel(opts.incomingDestination)
    : undefined;
  const monthFromText =
    opts.incomingTravelMonth ??
    (opts.userText ? parseTravelMonthFromText(opts.userText) : undefined);
  const rangeFromText = opts.userText
    ? parseTravelDateRangeFromText(opts.userText)
    : {};
  const daysFromText = opts.userText
    ? parseDayCountFromText(opts.userText) ?? rangeFromText.days
    : undefined;

  const hydrated = incoming
    ? hydrateDestinationFromIncoming(incoming, prefs, null)
    : {
        travelContext: { ...prefs, interests: prefs.interests } as CanonicalTravelContext,
        resolved: null as ResolvedTripDestination | null,
      };

  const conversationState = daysFromText
    ? "awaiting_combination_selection"
    : incoming
      ? "awaiting_days"
      : undefined;
  const planningStage = daysFromText
    ? "GENERATING_COMBINATIONS"
    : incoming
      ? "ASK_DATE"
      : "NEW";

  const travelContext: CanonicalTravelContext = {
    ...hydrated.travelContext,
    travelMonth: monthFromText,
    startDate: rangeFromText.startDate,
    endDate: rangeFromText.endDate,
    days: daysFromText,
    planningDaysConfirmed: Boolean(
      daysFromText && rangeFromText.startDate && rangeFromText.endDate,
    ),
    conversationState,
    selectedCombinationIds: [],
  };

  logAiPipeline(
    "[TRIP_CONTEXT_AFTER_RESET]",
    `destination=${travelContext.destination ?? "null"}`,
    `travelDate=${travelContext.startDate ?? "null"}`,
    `tripDays=${travelContext.days ?? "null"}`,
    `selectedCombinationIds=[]`,
    `planningStage=${planningStage}`,
  );

  return applyCommonSessionShell(session, {
    reason: opts.reason,
    newSessionId,
    travelContext,
    tripDestination: hydrated.resolved
      ? buildTripDestinationFromResolved(hydrated.resolved)
      : undefined,
    incoming,
    monthFromText,
    rangeFromText,
    daysFromText,
  });
}

/**
 * Hard-reset destination-bound trip planning state and open a new planningSessionId.
 * Dispatches to date / destination / new-conversation reset modes.
 * Long-term Plus Memory preferences (coffee / slow travel / no spice / photo) are kept.
 */
export function resetTripPlanningContext(
  session: ChatPlanningSession,
  opts: {
    reason: NewTripPlanningReason;
    incomingDestination?: string;
    incomingTravelMonth?: string;
    userText?: string;
  },
): ChatPlanningSession {
  if (isDateOnlyResetReason(opts.reason)) {
    return resetForDateChange(session, {
      reason: opts.reason,
      incomingDestination: opts.incomingDestination,
      incomingTravelMonth: opts.incomingTravelMonth,
      userText: opts.userText,
    });
  }
  if (isDestinationResetReason(opts.reason)) {
    return resetForDestinationChange(session, opts);
  }
  return resetForNewConversation(session, opts);
}

/**
 * Apply new-trip reset when needed. Call BEFORE mergeTravelContext so stale
 * dates / pending questions cannot poison the merge.
 */
export function maybeResetForNewTripPlanning(
  session: ChatPlanningSession,
  userText: string,
): { session: ChatPlanningSession; didReset: boolean; reason?: NewTripPlanningReason } {
  const detected = isNewTripPlanning(session, userText);
  if (!detected.isNew || !detected.reason) {
    return { session, didReset: false };
  }
  return {
    session: resetTripPlanningContext(session, {
      reason: detected.reason,
      incomingDestination: detected.incomingDestination,
      incomingTravelMonth: detected.incomingTravelMonth,
      userText,
    }),
    didReset: true,
    reason: detected.reason,
  };
}
