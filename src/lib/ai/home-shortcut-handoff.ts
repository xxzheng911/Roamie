import type { ChatPlanningSession } from "@/lib/chat-session";

export type HomeShortcutSearchProfile = "home_late_night" | "home_sea";

export function isStructuredHomeNearbyShortcut(
  session: ChatPlanningSession,
): boolean {
  const request = session.normalizedShortcutRequest;
  return Boolean(
    session.homeMoodShortcutEntry &&
      request?.source === "home_mood" &&
      request.structured === true &&
      request.intent === "nearby_recommendation",
  );
}

export function resolveHomeShortcutSearchProfile(
  session: ChatPlanningSession,
): HomeShortcutSearchProfile | null {
  const retainedProfile = session.activeRecommendationContext?.searchProfile;
  if (retainedProfile === "home_late_night" || retainedProfile === "home_sea") {
    return retainedProfile;
  }
  if (!isStructuredHomeNearbyShortcut(session)) return null;
  if (session.normalizedShortcutRequest?.mode === "late_night") return "home_late_night";
  if (session.normalizedShortcutRequest?.mode === "sea") return "home_sea";
  return null;
}

export function isStructuredHomeSeaShortcut(session: ChatPlanningSession): boolean {
  return (
    isStructuredHomeNearbyShortcut(session) &&
    session.normalizedShortcutRequest?.mode === "sea"
  );
}

/** A Home Nearby shortcut starts a recommendation turn, never a pending Planner turn. */
export function isolateHomeShortcutFromPlanning(
  session: ChatPlanningSession,
): ChatPlanningSession {
  if (!isStructuredHomeNearbyShortcut(session)) return session;
  const travelContext = session.travelContext
    ? {
        ...session.travelContext,
        destination: undefined,
        destinationCity: undefined,
        destinationCountry: undefined,
        destinationCountryCode: undefined,
        destinationCoordinates: undefined,
        destinationScopeId: undefined,
        days: undefined,
        startDate: undefined,
        endDate: undefined,
        conversationState: undefined,
        planningDaysConfirmed: undefined,
      }
    : { interests: [] as string[] };

  return {
    ...session,
    activeRecommendationContext: undefined,
    recommendationSession: undefined,
    activeChatIntent:
      session.normalizedShortcutRequest?.mode === "coffee" ? "cafe" : "attraction",
    activeCategoryIntent:
      session.normalizedShortcutRequest?.mode === "coffee" ? "cafe" : "attraction",
    pendingQuestion: undefined,
    adviceSelectionThisTurn: undefined,
    lastResolvedPendingQuestion: undefined,
    pendingClarification: undefined,
    conversationMode: "mood_recommend",
    chatPlanningState: "idle",
    tripPlanningContext: {
      selectedPlaces: [],
      intent: "mood_recommend",
    },
    tripDestination: undefined,
    tripDays: undefined,
    tripStartDate: undefined,
    tripEndDate: undefined,
    preferredArea: undefined,
    travelContext: {
      ...travelContext,
      lastIntent: undefined,
    },
  };
}

export function isolateHomeSeaShortcutFromPlanning(
  session: ChatPlanningSession,
): ChatPlanningSession {
  if (!isStructuredHomeSeaShortcut(session)) return session;
  const isolated = isolateHomeShortcutFromPlanning(session);
  return {
    ...isolated,
    travelContext: {
      ...(isolated.travelContext ?? { interests: [] }),
      lastIntent: undefined,
      tripPurpose: "coastal",
    },
  };
}
