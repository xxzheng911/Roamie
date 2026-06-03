import type { RoamieRequestContext } from "@/lib/ai/context";
import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { TripIntent } from "@/lib/recommendation/trip-intent";
import type { WeatherSummary } from "@/lib/weather-types";
import { inferEmotionSignals } from "@/lib/ai/emotion-inference";
import {
  chatPhaseForStage,
  resolveConversationStage,
} from "@/lib/ai/conversation-stage";
import { resolveAiUserIntent, responseModeForIntent } from "@/lib/ai/user-intent";
import { buildSessionMemorySnapshot } from "@/lib/ai/memory/session-memory";
import { buildLongTermMemory } from "@/lib/ai/memory/long-term-memory";
import type { PlanTier } from "@/lib/plan-tier/types";
import { buildNormalizedTravelContextLog, logContextNormalized } from "@/lib/ai/context-normalize";
import { loadConversationContext, rowPlusMemory } from "@/lib/conversation-context-store";
import {
  logPlusMemoryAppliedToChat,
  logPlusMemoryError,
  logPlusMemoryLoad,
  logPlusMemorySkippedFree,
} from "@/lib/ai/plus-memory-log";
import { formatLongTermMemoryForPrompt } from "@/lib/ai/memory/long-term-memory";

/** 組裝對話階段、情緒推測、本輪／長期記憶後再送 AI */
export async function enrichRoamieContext(
  ctx: RoamieRequestContext,
  options: {
    session: ChatPlanningSession;
    userText: string;
    conversation?: ChatMsg[];
    tripIntent?: TripIntent;
    planTier?: PlanTier;
    weather?: WeatherSummary | null;
  },
): Promise<RoamieRequestContext> {
  const { session, userText, conversation, tripIntent, planTier, weather } = options;
  const tier = planTier ?? ctx.planTier ?? "free";

  const aiIntent = resolveAiUserIntent(session, userText, tripIntent, {
    chatPhaseOverride: ctx.chatPhase,
  });
  responseModeForIntent(aiIntent);

  const conversationStage =
    ctx.conversationStage ??
    (ctx.chatPhase === "handoff"
      ? "recommend"
      : ctx.chatPhase === "recommend" && aiIntent.type === "place_recommendation"
        ? "recommend"
        : resolveConversationStage(session, userText, tripIntent, aiIntent.type));
  const computedPhase = chatPhaseForStage(conversationStage, session, userText);
  const chatPhase =
    ctx.chatPhase === "recommend" ||
    ctx.chatPhase === "handoff" ||
    ctx.chatPhase === "discover" ||
    ctx.chatPhase === "place_discussion"
      ? ctx.chatPhase
      : computedPhase;
  const emotionSignals = inferEmotionSignals(userText, session, weather ?? ctx.weather);
  const sessionMemory = buildSessionMemorySnapshot(session, conversation);

  if (session.travelContext || session.conversationContext) {
    logContextNormalized(
      buildNormalizedTravelContextLog(userText, session, session.travelContext),
    );
  }

  let longTermMemory = ctx.longTermMemory;
  if (tier === "plus" && !longTermMemory) {
    try {
      const persisted = await loadConversationContext();
      const plusMemory = persisted ? rowPlusMemory(persisted) : null;
      logPlusMemoryLoad({ source: "chat_enrich", memory: plusMemory });
      longTermMemory = await buildLongTermMemory("client", plusMemory);
      const preview = formatLongTermMemoryForPrompt(longTermMemory);
      if (preview.trim()) {
        logPlusMemoryAppliedToChat({
          traitCount: longTermMemory.traits?.length ?? 0,
          preview: preview.slice(0, 200),
        });
      }
    } catch (e) {
      logPlusMemoryError("chat_enrich", e);
      console.warn("[Roamie AI] long-term memory", e);
    }
  } else if (tier !== "plus") {
    logPlusMemorySkippedFree("chat_enrich");
  }

  return {
    ...ctx,
    planTier: tier,
    aiUserIntent: aiIntent.type,
    conversationStage,
    chatPhase,
    emotionSignals,
    sessionMemory,
    conversationContext: session.conversationContext ?? ctx.conversationContext,
    longTermMemory: tier === "plus" ? longTermMemory : undefined,
  };
}
