import type { ChatPlanningSession } from "@/lib/chat-session";
import {
  extractKnownDestinationFromText,
  normalizeDestination,
} from "@/lib/ai/normalize-destination";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";
import {
  isFlexiblePreferenceReply,
  normalizeFlexiblePreferences,
} from "@/lib/ai/flexible-preference";
import {
  resolveSessionDestination,
  syncConversationState,
  userWantsChatMore,
  type ConversationState,
} from "@/lib/ai/conversation-state";
import { userAsksTravelTimeAdvice } from "@/lib/ai/user-intent";
import { resolveCuratedTripLocationByDestination } from "@/lib/trip-location-curated";
import {
  mergeMustIncludePlaces,
  parseMustIncludePlaces,
} from "@/lib/ai/must-include-places";

export const ITINERARY_GENERATING_MESSAGE = "Roamie 正在整理行程…";

export const ITINERARY_GENERATION_FAILED_MESSAGE =
  "Roamie 暫時想不到好點子，請稍後再試一次。";

/** 明確要求完整行程安排（含必去、幫我安排、幫我規劃等） */
export function userRequestsFullItineraryPlanning(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (userWantsChatMore(t)) return false;
  if (
    /(哪幾天|建議哪|覺得要哪|要哪\s*\d+\s*天)/.test(t) &&
    !/(請幫我安排|幫我排|幫我規劃|完整行程|排一版)/.test(t)
  ) {
    return false;
  }

  if (
    /(請幫我安排|幫我安排|請幫我規劃|幫我規劃|幫我規劃行程|幫我排行程|幫我排|排完整|完整行程|安排完整)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/行程要有|一定要有|必去|指定.{0,8}(富士|哈利|環球)/.test(t)) return true;
  if (/(我預計|預計).{0,24}(去|到).{0,16}\d+\s*天/.test(t)) return true;
  if (/\d+\s*天.{0,48}(行程|安排|規劃|排)/.test(t)) return true;

  return userRequestsItineraryGeneration(t);
}

/** 使用者明確要求產生可儲存的完整行程（非僅聊天建議） */
export function userRequestsItineraryGeneration(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (userWantsChatMore(t)) return false;

  if (
    /(幫我排|生成行程|排行程|規劃行程|行程安排|直接規劃|那就出發|出發吧|排一版|整理.{0,8}行程|出行程|做一份行程|請幫我安排|幫我安排|幫我規劃)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\d+\s*天.{0,48}(行程|規劃|排|安排)/.test(t)) return true;
  if (/(行程呢|行程嗎|行程吧|行程啊|的行程)/.test(t)) return true;
  if (/^(那|就|再)?.{0,6}(幫我)?(排|規劃|出).{0,6}(行程|版本)/.test(t)) return true;
  if (/行程要有/.test(t)) return true;

  if (userAsksTravelTimeAdvice(t) && /(排|生成|規劃|行程呢|出行程|安排)/.test(t)) {
    return true;
  }

  return false;
}

function parseDaysFromText(text: string, session: ChatPlanningSession): number | undefined {
  const m = text.match(/(\d+)\s*天/);
  if (m) return Number.parseInt(m[1], 10);
  const parsed = parseTravelContextFromText(text, session);
  if (parsed.days != null) return parsed.days;
  return session.conversationState?.days ?? session.tripDays ?? undefined;
}

function defaultConversationState(
  base: ConversationState | undefined,
  patch: Partial<ConversationState>,
): ConversationState {
  return {
    preferences: [],
    stage: "gathering",
    updatedAt: new Date().toISOString(),
    ...base,
    ...patch,
  };
}

/** 合併對話上下文，優先採用本則訊息中的目的地／天數 */
export function prepareSessionForItineraryGeneration(
  session: ChatPlanningSession,
  userText: string,
): ChatPlanningSession {
  const synced = syncConversationState(session, userText);
  const t = userText.trim();
  const parsed = parseTravelContextFromText(t, session);
  const destFromText = extractKnownDestinationFromText(t);

  const destination =
    (destFromText ? normalizeDestination(destFromText) : undefined) ??
    (parsed.destination ? normalizeDestination(parsed.destination) : undefined) ??
    normalizeDestination(synced.conversationState?.destination) ??
    resolveSessionDestination(synced);

  const days = parseDaysFromText(t, synced) ?? 3;
  const travelMonth =
    parsed.travelMonth ??
    synced.conversationContext?.travelMonth ??
    synced.conversationState?.travelMonth ??
    (t.match(/(\d{1,2})\s*月/)?.[0] ?? "近期");

  let preferences = [...(synced.conversationState?.preferences ?? [])];
  if (isFlexiblePreferenceReply(t)) {
    preferences = normalizeFlexiblePreferences();
  } else if (preferences.length === 0) {
    preferences = normalizeFlexiblePreferences();
  }

  const companions =
    synced.conversationState?.companions?.trim() ||
    (/(一個人|獨自|朋友|家人|情侶)/.test(t)
      ? parseCompanionFromText(t)
      : undefined) ||
    "尚未指定";

  const tripLoc = destination ? resolveCuratedTripLocationByDestination(destination) : null;
  const mustIncludePlaces = mergeMustIncludePlaces(
    synced.travelContext?.mustIncludePlaces,
    mergeMustIncludePlaces(
      synced.conversationContext?.mustIncludePlaces,
      parseMustIncludePlaces(t),
    ),
  );

  return {
    ...synced,
    tripDays: days,
    tripDestination: tripLoc ?? synced.tripDestination,
    phase: "ready",
    travelContext: {
      ...(synced.travelContext ?? { interests: [] }),
      destination,
      travelMonth,
      days,
      mustIncludePlaces,
    },
    conversationContext: synced.conversationContext
      ? { ...synced.conversationContext, mustIncludePlaces, travelDays: days, destination }
      : undefined,
    conversationState: defaultConversationState(synced.conversationState, {
      destination,
      travelMonth,
      days,
      preferences,
      companions,
      stage: "planning_confirmed",
    }),
  };
}

function parseCompanionFromText(text: string): string | undefined {
  if (/(一個人|獨自|solo)/i.test(text)) return "一個人";
  if (/(朋友|閨蜜)/.test(text)) return "朋友";
  if (/(家人|爸媽|親子)/.test(text)) return "家人";
  if (/(女友|男友|情侶)/.test(text)) return "情侶";
  return undefined;
}

export function canAutoGenerateItineraryFromSession(session: ChatPlanningSession): boolean {
  const destination = resolveSessionDestination(session);
  const days = session.conversationState?.days ?? session.tripDays;
  return Boolean(destination) && days != null && days >= 1;
}

export function shouldAutoStartItineraryFromChat(
  userText: string,
  session: ChatPlanningSession,
): boolean {
  if (!userRequestsFullItineraryPlanning(userText) && !userRequestsItineraryGeneration(userText)) {
    return false;
  }
  const prepared = prepareSessionForItineraryGeneration(session, userText);
  return canAutoGenerateItineraryFromSession(prepared);
}
