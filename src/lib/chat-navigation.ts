/**
 * Chat entry source + back destination.
 * Separates navigation return routing from Workspace restore.
 */

export type ChatEntrySource =
  | "main_chat"
  | "travel_draft"
  | "trip_detail"
  | "plan"
  | "map"
  | "mood"
  | "place_detail"
  | "unknown";

/** Search param value when opening chat from Plus travel drafts list. */
export const CHAT_FROM_TRAVEL_DRAFT = "travel-draft";

export const TRAVEL_DRAFTS_ROUTE = "/travel-drafts" as const;
export const CHAT_DEFAULT_BACK_ROUTE = "/" as const;

type ResolveChatEntrySourceInput = {
  from?: string | null;
  fromTripAddPlace?: boolean;
  fromPlanForm?: boolean;
  fromPlanAi?: boolean;
};

export function resolveChatEntrySource(
  input: ResolveChatEntrySourceInput,
): ChatEntrySource {
  if (input.fromTripAddPlace) return "trip_detail";
  const from = (input.from ?? "").trim();
  if (from === CHAT_FROM_TRAVEL_DRAFT || from === "travel-drafts") {
    return "travel_draft";
  }
  if (input.fromPlanForm || input.fromPlanAi || from === "plan" || from === "plan-ai") {
    return "plan";
  }
  if (from === "map") return "map";
  if (from === "mood") return "mood";
  if (from === "place") return "place_detail";
  if (!from) return "main_chat";
  return "unknown";
}

export type ChatBackTarget = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
};

type ResolveChatBackTargetInput = ResolveChatEntrySourceInput & {
  tripAddPlaceTarget?: ChatBackTarget | null;
};

/**
 * Prefer explicit entry source over browser history for chat back.
 * Workspace restore must not influence this decision.
 */
export function resolveChatBackTarget(
  input: ResolveChatBackTargetInput,
): { entrySource: ChatEntrySource; target: ChatBackTarget; usedFallback: boolean; reason?: string } {
  const entrySource = resolveChatEntrySource(input);

  switch (entrySource) {
    case "travel_draft":
      return {
        entrySource,
        target: { to: TRAVEL_DRAFTS_ROUTE },
        usedFallback: false,
      };
    case "trip_detail": {
      if (input.tripAddPlaceTarget?.to) {
        return {
          entrySource,
          target: input.tripAddPlaceTarget,
          usedFallback: false,
        };
      }
      return {
        entrySource,
        target: { to: CHAT_DEFAULT_BACK_ROUTE },
        usedFallback: true,
        reason: "missing_return_route",
      };
    }
    case "plan":
      return {
        entrySource,
        target: { to: "/plan" },
        usedFallback: false,
      };
    case "main_chat":
    case "map":
    case "mood":
    case "place_detail":
    case "unknown":
    default:
      return {
        entrySource,
        target: { to: CHAT_DEFAULT_BACK_ROUTE },
        usedFallback: entrySource === "unknown",
        reason: entrySource === "unknown" ? "invalid_route" : undefined,
      };
  }
}

export function logChatNavigationEntry(input: {
  entrySource: ChatEntrySource;
  workspaceId?: string | null;
  returnRoute: string;
}): void {
  console.info(
    `[CHAT_NAVIGATION_ENTRY] entrySource=${input.entrySource} workspaceId=${input.workspaceId ?? "(none)"} returnRoute=${input.returnRoute}`,
  );
}

export function logChatNavigationBack(input: {
  entrySource: ChatEntrySource;
  resolvedReturnRoute: string;
  method: "button" | "gesture" | "history";
}): void {
  console.info(
    `[CHAT_NAVIGATION_BACK] entrySource=${input.entrySource} resolvedReturnRoute=${input.resolvedReturnRoute} method=${input.method}`,
  );
}

export function logChatNavigationFallback(input: {
  entrySource: ChatEntrySource;
  reason: string;
  fallbackRoute: string;
}): void {
  console.info(
    `[CHAT_NAVIGATION_FALLBACK] entrySource=${input.entrySource} reason=${input.reason} fallbackRoute=${input.fallbackRoute}`,
  );
}
