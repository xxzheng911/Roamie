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

const TRIP_RESET_CLEARED_FIELDS = [
  "travelDate",
  "startDate",
  "endDate",
  "tripDays",
  "tripStartDate",
  "tripEndDate",
  "suggestedStartDate",
  "travelMonth",
  "travelYear",
  "destination",
  "destinationCountry",
  "destinationCity",
  "destinationRegion",
  "destinationCities",
  "selectedCombinationIds",
  "selectedCombinationPlaceNames",
  "excludedCombinationPlaceNames",
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

  const prevIsCountry =
    isKnownCountryLabel(prev) && !isKnownTouristCityLabel(prev) && !isTravelRegionLabel(prev);
  if (!prevIsCountry) return false;

  const nextIsPlace =
    isKnownTouristCityLabel(next) ||
    isTravelRegionLabel(next) ||
    resolveDestinationEntity(next).type !== "country";
  if (!nextIsPlace) return false;

  const entity = resolveDestinationEntity(next);
  const nextCountry = entity.country
    ? normalizeDestinationLabel(entity.country)
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

  const incomingDestination = resolveDestinationFromText(text);
  const incomingTravelMonth = parseTravelMonthFromText(text);
  const incomingRange = parseTravelDateRangeFromText(text);
  const prevDest = resolveActiveDestination(session);
  const prevCountry = resolveActiveCountry(session);
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
            (prevEntity.type === "country" ? prevDest : prevEntity.country ?? prevDest),
        );
        const nextCountryLabel = normalizeDestinationLabel(
          nextEntity.type === "country" ? next : nextEntity.country ?? next,
        );
        const bothCountries =
          (prevEntity.type === "country" ||
            (isKnownCountryLabel(prevDest) && !isKnownTouristCityLabel(prevDest))) &&
          (nextEntity.type === "country" ||
            (isKnownCountryLabel(next) && !isKnownTouristCityLabel(next)));
        const bothPlacesSameCountry =
          prevCountryLabel === nextCountryLabel &&
          !bothCountries &&
          (prevEntity.type === "city" ||
            prevEntity.type === "region" ||
            isKnownTouristCityLabel(prevDest) ||
            isTravelRegionLabel(prevDest)) &&
          (nextEntity.type === "city" ||
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

  if (
    (incomingRange.startDate || incomingRange.endDate) &&
    datesDiffer(
      { start: prevStart, end: prevEnd },
      { start: incomingRange.startDate, end: incomingRange.endDate },
    ) &&
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

/**
 * Hard-reset destination-bound trip planning state and open a new planningSessionId.
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
  const oldSessionId = session.planningSessionId;
  const newSessionId = createPlanningSessionId();
  const prefs = preserveLongTermPreferences(session.travelContext);
  const clearedList = [...TRIP_RESET_CLEARED_FIELDS];

  clearFrozenPlanningDayPlan(session.planningSessionId);
  resetPlannerSession(session.planningSessionId);
  if (session.travelContext?.destination) {
    clearResolvedDestinationScope(session.travelContext.destination);
  }
  if (session.tripDestination?.city) {
    clearResolvedDestinationScope(session.tripDestination.city);
  }

  logAiPipeline(
    "[NEW_TRIP_SESSION_CREATED]",
    `oldSessionId=${oldSessionId ?? "none"}`,
    `newSessionId=${newSessionId}`,
    `reason=${opts.reason}`,
  );
  logAiSessionCreate(opts.reason, newSessionId);
  logAiPlanningSessionStart(newSessionId);
  logAiPipeline(
    "[TRIP_CONTEXT_RESET]",
    `cleared=[${clearedList.join(",")}]`,
    `reason=${opts.reason}`,
  );

  const incoming = opts.incomingDestination?.trim()
    ? normalizeDestinationLabel(opts.incomingDestination)
    : undefined;
  const scope = incoming ? resolveDestinationScopeFields(incoming) : undefined;
  const monthFromText =
    opts.incomingTravelMonth ??
    (opts.userText ? parseTravelMonthFromText(opts.userText) : undefined);
  const rangeFromText = opts.userText
    ? parseTravelDateRangeFromText(opts.userText)
    : {};
  const daysFromText = opts.userText
    ? parseDayCountFromText(opts.userText) ?? rangeFromText.days
    : undefined;

  const travelContext: CanonicalTravelContext = {
    ...prefs,
    destination: scope?.destinationName,
    destinationCountry: scope?.destinationCountry,
    destinationType: scope?.destinationType,
    destinationCity: scope?.destinationCity,
    destinationRegion: scope?.destinationRegion,
    travelMonth: monthFromText,
    startDate: rangeFromText.startDate,
    endDate: rangeFromText.endDate,
    days: daysFromText,
    planningDaysConfirmed: Boolean(
      daysFromText && rangeFromText.startDate && rangeFromText.endDate,
    ),
    conversationState: daysFromText ? undefined : "awaiting_days",
    selectedCombinationIds: [],
    interests: prefs.interests,
  };

  logAiPipeline(
    "[TRIP_CONTEXT_AFTER_RESET]",
    `destination=${travelContext.destination ?? "null"}`,
    `travelDate=${travelContext.startDate ?? "null"}`,
    `tripDays=${travelContext.days ?? "null"}`,
    `selectedCombinationIds=[]`,
    `planningStage=ASK_DATE`,
  );

  return {
    ...session,
    planningSessionId: newSessionId,
    planVersion: (session.planVersion ?? 0) + 1,
    phase: session.phase === "done" ? "discover" : session.phase,
    travelDate: travelContext.startDate,
    tripStartDate: travelContext.startDate,
    tripEndDate: travelContext.endDate,
    tripDays: travelContext.days,
    tripDestination: incoming
      ? {
          placeId: "",
          country: travelContext.destinationCountry ?? "",
          city: incoming,
          lat: 0,
          lng: 0,
          formattedName: incoming,
          displayLabel: incoming,
        }
      : undefined,
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
