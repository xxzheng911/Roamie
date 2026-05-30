import type { ChatPlanningSession } from "@/lib/chat-session";
import { isUserConfirmingItinerary } from "@/lib/chat-session";
import type { ChatPhase } from "@/lib/ai/context";
import type { Locale } from "@/lib/i18n/types";
import type { TripIntentMissingKey } from "@/lib/recommendation/trip-intent";
import { shouldUseCompanionAiReply } from "@/lib/ai/conversation-intent";
import {
  type CanonicalTravelContext,
  isReadyForRecommendation,
  logTravelContext,
  missingContextKeys,
} from "@/lib/ai/travel-context";
import { isFlexiblePreferenceReply } from "@/lib/ai/flexible-preference";
import {
  isReadyForPlanningConfirm,
  shouldOrchestrateCompanion,
  userWantsPlanNow,
} from "@/lib/ai/conversation-state";
import { userAsksTravelTimeAdvice } from "@/lib/ai/user-intent";

export type AiChatRouteMode = "clarify" | "recommend" | "itinerary" | "companion";

export type AiChatRoute = {
  mode: AiChatRouteMode;
  chatPhase: ChatPhase;
  missingKey?: TripIntentMissingKey;
  question?: string;
};

const CLARIFY_ZH: Record<TripIntentMissingKey, (ctx: CanonicalTravelContext) => string> = {
  destination: () => "你想去哪裡玩呢？跟我說城市就可以～",
  vibe: () => "這趟比較想放鬆散步、拍照打卡、美食探索，還是都有呢？",
  setting: () => "今天比較想待在室內，還是戶外走走？",
  companionship: () => "你是自己旅行，還是跟朋友、家人一起呢？",
  date: () => "你預計什麼時候出發呢？",
};

function buildClarifyQuestion(
  key: TripIntentMissingKey,
  ctx: CanonicalTravelContext,
  locale: Locale,
): string {
  if (locale !== "zh-TW") {
    const en: Record<TripIntentMissingKey, string> = {
      destination: "Where would you like to go?",
      vibe: "Relaxing walks, photos, food, or a bit of everything?",
      setting: "Prefer indoors or outdoors?",
      companionship: "Solo or with friends/family?",
      date: "When are you planning to go?",
    };
    return en[key];
  }
  return CLARIFY_ZH[key](ctx);
}

function nextUnaskedKey(
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
): TripIntentMissingKey | null {
  const asked = new Set(session.askedClarifyKeys ?? []);
  for (const key of missingContextKeys(ctx, session)) {
    if (!asked.has(key)) return key;
  }
  return null;
}

export function resolveChatRoute(
  userText: string,
  ctx: CanonicalTravelContext,
  session: ChatPlanningSession,
  locale: Locale = "zh-TW",
): AiChatRoute {
  if (isUserConfirmingItinerary(userText) || userWantsPlanNow(userText)) {
    console.info("[AI_ROUTE] itinerary_mode", logTravelContext(ctx));
    return { mode: "itinerary", chatPhase: "handoff" };
  }

  if (shouldOrchestrateCompanion(session)) {
    if (isReadyForPlanningConfirm(session.conversationState)) {
      console.info("[AI_ROUTE] companion_confirming", logTravelContext(ctx));
      return { mode: "companion", chatPhase: "discover" };
    }
    if (isFlexiblePreferenceReply(userText)) {
      console.info("[AI_ROUTE] companion_flexible", logTravelContext(ctx));
      return { mode: "companion", chatPhase: "discover" };
    }
    console.info("[AI_ROUTE] companion_gathering", logTravelContext(ctx));
    return { mode: "companion", chatPhase: "discover" };
  }

  if (userAsksTravelTimeAdvice(userText)) {
    console.info("[AI_ROUTE] travel_advice_mode", logTravelContext(ctx));
    return { mode: "recommend", chatPhase: "discover" };
  }

  if (isReadyForRecommendation(ctx, session)) {
    console.info("[AI_ROUTE] recommendation_mode", logTravelContext(ctx));
    return { mode: "recommend", chatPhase: "recommend" };
  }

  const nextKey = nextUnaskedKey(ctx, session);
  if (nextKey && !shouldUseCompanionAiReply(userText, session)) {
    const question = buildClarifyQuestion(nextKey, ctx, locale);
    console.info("[AI_ROUTE] next_question", nextKey, logTravelContext(ctx));
    return { mode: "clarify", chatPhase: "discover", missingKey: nextKey, question };
  }

  console.info("[AI_ROUTE] recommendation_mode", "fallback-ready", logTravelContext(ctx));
  return { mode: "recommend", chatPhase: "recommend" };
}

export function markAskedClarifyKey(
  session: ChatPlanningSession,
  key: TripIntentMissingKey,
): ChatPlanningSession {
  const prev = session.askedClarifyKeys ?? [];
  if (prev.includes(key)) return session;
  return { ...session, askedClarifyKeys: [...prev, key] };
}
