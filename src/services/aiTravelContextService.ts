import type { RoamieRequestContext } from "@/lib/ai/context";
import { buildContextBlock } from "@/lib/ai/context";
import { createRequestCache } from "@/services/requestCache";
import { parseTravelContextFromText, logTravelContext } from "@/lib/ai/travel-context";
import { createEmptySession } from "@/lib/chat-session";

type TravelIntent = {
  destination?: string;
  origin?: string;
  startDate?: string;
  endDate?: string;
  travelMonth?: string;
  days?: number;
  mood?: string;
  companion?: string;
  transportMode?: string;
};

const tripDraftCache = createRequestCache({
  prefix: "ai-trip-draft",
  ttlMs: 30 * 60 * 1000,
  persist: true,
});

export function extractTravelIntent(message: string): TravelIntent {
  const parsed = parseTravelContextFromText(message, createEmptySession());
  console.info("[AI_CONTEXT] parsed", logTravelContext({ interests: [], ...parsed }));
  return {
    destination: parsed.destination,
    travelMonth: parsed.travelMonth,
    days: parsed.days,
    mood: parsed.mood ?? parsed.vibe,
    companion: parsed.companion,
    transportMode: parsed.transportMode,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
  };
}

export function updateTripDraftFromConversation<T extends Record<string, unknown>>(
  currentDraft: T,
  intent: TravelIntent,
): T {
  return {
    ...currentDraft,
    destination: intent.destination ?? (currentDraft.destination as string | undefined),
    origin: intent.origin ?? (currentDraft.origin as string | undefined),
    startDate: intent.startDate ?? (currentDraft.startDate as string | undefined),
    endDate: intent.endDate ?? (currentDraft.endDate as string | undefined),
    days: intent.days ?? (currentDraft.days as number | undefined),
    transportMode: intent.transportMode ?? (currentDraft.transportMode as string | undefined),
    mood: intent.mood ?? (currentDraft.mood as string | undefined),
  };
}

export function buildTravelContext(
  userInput: string,
  tripDraft: Record<string, unknown>,
  userProfile: Record<string, unknown>,
  baseContext: RoamieRequestContext,
): string {
  const intent = extractTravelIntent(userInput);
  const enriched = {
    ...baseContext,
    chatInput: userInput,
    planningHints: {
      ...baseContext.planningHints,
      travelDate: intent.startDate ?? (tripDraft.startDate as string | undefined),
      transportation: intent.transportMode ?? (tripDraft.transportMode as string | undefined),
      conversationSummary: `draft=${JSON.stringify(tripDraft)}; profile=${JSON.stringify(userProfile)}`,
      lastUserIntent: userInput,
      companionship:
        intent.companion ??
        (tripDraft.companion as string | undefined) ??
        (userProfile.companion as string | undefined),
      selectedMood:
        intent.mood ??
        (tripDraft.mood as string | undefined) ??
        (userProfile.mood as string | undefined) ??
        baseContext.selectedMood,
    },
  } satisfies RoamieRequestContext;
  console.info(
    "[AI_CONTEXT_BUILT]",
    `destination=${intent.destination ?? (tripDraft.destination as string | undefined) ?? "unknown"}`,
    `travelMonth=${intent.travelMonth ?? "unknown"}`,
    `days=${intent.days ?? (tripDraft.days as number | undefined) ?? "unknown"}`,
    `mood=${intent.mood ?? (tripDraft.mood as string | undefined) ?? "unknown"}`,
    `companion=${intent.companion ?? (tripDraft.companion as string | undefined) ?? "unknown"}`,
  );
  return buildContextBlock(enriched);
}

export async function generateTravelReply(args: {
  conversationId: string;
  context: string;
  userInput: string;
}): Promise<string> {
  const key = `${args.conversationId}:reply:${args.userInput.trim().toLowerCase()}`;
  console.info("[AI_REPLY_REQUEST]", `conversationId=${args.conversationId}`);
  try {
    const reply = await tripDraftCache.getOrFetch(
      key,
      async () => `已理解你的需求：${args.userInput}\n\n${args.context}`,
    );
    console.info("[AI_REPLY_SUCCESS]", `conversationId=${args.conversationId}`);
    return reply;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[AI_REPLY_ERROR]", msg);
    throw error;
  }
}

export async function generateTripPlan(args: {
  conversationId: string;
  draft: Record<string, unknown>;
  context: string;
}): Promise<Record<string, unknown>> {
  const key = `${args.conversationId}:plan`;
  return tripDraftCache.getOrFetch(key, async () => ({
    ...args.draft,
    context: args.context,
    updatedAt: new Date().toISOString(),
  }));
}
