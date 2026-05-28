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

export type AiChatRouteMode = "clarify" | "recommend" | "itinerary";

export type AiChatRoute = {
  mode: AiChatRouteMode;
  chatPhase: ChatPhase;
  missingKey?: TripIntentMissingKey;
  question?: string;
};

const CLARIFY_ZH: Record<TripIntentMissingKey, (ctx: CanonicalTravelContext) => string> = {
  destination: (ctx) =>
    ctx.destination
      ? `好的，我們從${ctx.destination}出發。這趟比較想放鬆、拍照，還是吃美食？`
      : "你想從哪個地區開始逛呢？",
  vibe: () => "這趟比較想放鬆、拍照，還是吃美食？",
  setting: () => "今天比較想待在室內，還是戶外走走？",
  companionship: () => "這次是一個人，還是跟朋友／家人一起？",
  date: () => "大概哪一天出門呢？",
};

function buildClarifyQuestion(
  key: TripIntentMissingKey,
  ctx: CanonicalTravelContext,
  locale: Locale,
): string {
  if (locale !== "zh-TW") {
    const en: Record<TripIntentMissingKey, string> = {
      destination: "Which area would you like to start from?",
      vibe: "More into relaxing, photos, or food?",
      setting: "Prefer indoors or outdoors?",
      companionship: "Solo or with friends/family?",
      date: "Which day are you heading out?",
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
  if (isUserConfirmingItinerary(userText)) {
    console.info("[AI_ROUTE] itinerary_mode", logTravelContext(ctx));
    return { mode: "itinerary", chatPhase: "handoff" };
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
