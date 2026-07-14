import type { ChatPlanningSession } from "@/lib/chat-session";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ChatConversationMode } from "@/lib/ai/trip-planning-context";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { isKnownCountryLabel, isKnownTouristCityLabel, normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { isPlaceDetailChatActive } from "@/lib/ai/place-detail-chat";
import { isTripAddPlaceSession } from "@/lib/trip/trip-add-place-session";

export type UnifiedChatMode =
  | "destination_planning"
  | "trip_add_place"
  | "place_detail"
  | "mood"
  | "nearby_explore"
  | "general";

export type UnifiedChatContext = {
  mode: UnifiedChatMode;
  destinationCountry?: string;
  destinationCity?: string;
  destinationRegion?: string;
  days?: number;
  date?: string;
  startDate?: string;
  endDate?: string;
  budgetPreference?: "low" | "medium" | "high";
  excludedCategories?: string[];
  selectedInterests?: string[];
  tripStyle?: string;
  selectedPlace?: string;
  tripId?: string;
  selectedDay?: number;
  existingPlaces?: string[];
  source?: string;
  userInteracted: boolean;
  mustVisitGenerated?: boolean;
  conversationState?: string;
  tripPurpose?: string;
};

export type UnifiedPendingQuestion = PendingQuestion & {
  askedAtMessageId?: string;
};

export function resolveUnifiedChatMode(session: ChatPlanningSession): UnifiedChatMode {
  if (isTripAddPlaceSession(session)) return "trip_add_place";
  if (isPlaceDetailChatActive(session)) return "place_detail";
  if (
    session.fromMoodFlow ||
    session.fromMoodCard ||
    session.homeMoodShortcutEntry ||
    session.conversationMode === "mood_recommend"
  ) {
    return "mood";
  }
  if (
    session.conversationMode === "destination_planning" ||
    session.activeChatIntent === "destination_advice" ||
    session.tripPlanningContext?.intent === "destination_planning"
  ) {
    return "destination_planning";
  }
  if (session.conversationMode === "nearby_explore") return "nearby_explore";
  return "general";
}

function splitDestination(
  destination?: string,
  destinationCountry?: string,
): Pick<UnifiedChatContext, "destinationCity" | "destinationCountry" | "destinationRegion"> {
  if (!destination?.trim()) {
    return { destinationCountry };
  }

  const label = normalizeDestinationLabel(destination);
  if (isKnownCountryLabel(label) && !isKnownTouristCityLabel(label)) {
    return { destinationCountry: label };
  }

  if (isKnownTouristCityLabel(label)) {
    return {
      destinationCity: label,
      destinationCountry,
    };
  }

  if (label.includes("＋") || label.includes("+")) {
    return {
      destinationRegion: label,
      destinationCity: label.split(/[＋+]/)[0]?.trim(),
      destinationCountry,
    };
  }

  // Unknown short labels: prefer region/city only if not a known country.
  // Avoid defaulting countries (or country-like) into destinationCity.
  if (isKnownCountryLabel(label)) {
    return { destinationCountry: label };
  }

  return {
    destinationCity: label,
    destinationCountry,
  };
}

export function sessionToUnifiedContext(session: ChatPlanningSession): UnifiedChatContext {
  const travel = session.travelContext;
  const tripCtx = session.tripPlanningContext;
  const destination =
    travel?.destination ??
    tripCtx?.destination ??
    session.tripDestination?.city ??
    session.tripAddPlaceContext?.destination;
  const destinationCountry = travel?.destinationCountry;
  const split = splitDestination(destination, destinationCountry);

  return {
    mode: resolveUnifiedChatMode(session),
    ...split,
    days: travel?.days ?? session.tripDays ?? tripCtx?.days,
    date: session.travelDate ?? travel?.travelMonth,
    startDate: travel?.startDate ?? session.tripStartDate,
    endDate: travel?.endDate ?? session.tripEndDate,
    budgetPreference: travel?.budgetPreference,
    excludedCategories: session.excludedCategories ?? travel?.excludedCategories,
    selectedInterests: travel?.selectedInterests,
    tripStyle: travel?.selectedTripStyle ?? travel?.travelStyle ?? session.tripStyles,
    selectedPlace: session.placeDetailFocus?.name,
    tripId: session.tripAddPlaceContext?.tripId,
    selectedDay: session.tripAddPlaceContext?.selectedDay,
    existingPlaces:
      session.tripAddPlaceContext?.existingPlaceNames ??
      session.tripAddPlaceContext?.currentPlaces.map((place) => place.name),
    source: session.tripAddPlaceContext?.source ?? (session.fromMoodFlow ? "mood" : session.conversationMode),
    userInteracted: Boolean(session.homeMoodShortcutEngaged || session.lastUserIntent),
    mustVisitGenerated: travel?.mustVisitGenerated,
    conversationState: travel?.conversationState,
    tripPurpose: travel?.tripPurpose,
  };
}

export function unifiedContextToTravelPatch(
  unified: UnifiedChatContext,
): Partial<CanonicalTravelContext> {
  const destination =
    unified.destinationRegion ??
    unified.destinationCity ??
    unified.destinationCountry;

  return {
    destination,
    destinationCountry: unified.destinationCountry,
    days: unified.days,
    startDate: unified.startDate,
    endDate: unified.endDate,
    travelMonth: unified.date,
    budgetPreference: unified.budgetPreference,
    excludedCategories: unified.excludedCategories,
    selectedInterests: unified.selectedInterests,
    selectedTripStyle: unified.tripStyle,
    travelStyle: unified.tripStyle,
    mustVisitGenerated: unified.mustVisitGenerated,
    conversationState: unified.conversationState as CanonicalTravelContext["conversationState"],
    tripPurpose: unified.tripPurpose,
  };
}

export function mergeUnifiedIntoSession(
  session: ChatPlanningSession,
  unified: UnifiedChatContext,
  conversationMode?: ChatConversationMode,
): ChatPlanningSession {
  const travelPatch = unifiedContextToTravelPatch(unified);
  const nextMode = conversationMode ?? (unified.mode === "general" ? session.conversationMode : unified.mode);

  return {
    ...session,
    conversationMode: nextMode as ChatConversationMode | undefined,
    tripDays: unified.days ?? session.tripDays,
    travelDate: unified.date ?? session.travelDate,
    tripStartDate: unified.startDate ?? session.tripStartDate,
    tripEndDate: unified.endDate ?? session.tripEndDate,
    excludedCategories: unified.excludedCategories ?? session.excludedCategories,
    travelContext: {
      ...(session.travelContext ?? { interests: [] }),
      ...travelPatch,
      interests: session.travelContext?.interests ?? [],
    },
    tripPlanningContext: session.tripPlanningContext
      ? {
          ...session.tripPlanningContext,
          destination: travelPatch.destination ?? session.tripPlanningContext.destination,
          days: unified.days ?? session.tripPlanningContext.days,
          intent: (nextMode as ChatConversationMode) ?? session.tripPlanningContext.intent,
        }
      : session.tripPlanningContext,
  };
}
