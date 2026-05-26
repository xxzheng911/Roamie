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
import { buildSessionMemorySnapshot } from "@/lib/ai/memory/session-memory";
import { buildLongTermMemory } from "@/lib/ai/memory/long-term-memory";
import type { PlanTier } from "@/lib/plan-tier/types";

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

  const conversationStage = resolveConversationStage(session, userText, tripIntent);
  const chatPhase = chatPhaseForStage(conversationStage, session, userText);
  const emotionSignals = inferEmotionSignals(userText, session, weather ?? ctx.weather);
  const sessionMemory = buildSessionMemorySnapshot(session, conversation);

  let longTermMemory = ctx.longTermMemory;
  if (tier === "plus" && !longTermMemory) {
    try {
      longTermMemory = await buildLongTermMemory("client");
    } catch (e) {
      console.warn("[Roamie AI] long-term memory", e);
    }
  }

  return {
    ...ctx,
    planTier: tier,
    conversationStage,
    chatPhase,
    emotionSignals,
    sessionMemory,
    longTermMemory: tier === "plus" ? longTermMemory : undefined,
  };
}
