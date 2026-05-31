import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { RoamieResponse } from "@/lib/ai/types";
import { parseTravelContextFromText } from "@/lib/ai/travel-context";
import {
  buildTravelAdviceFallbackReply,
  buildTravelAdviceHint,
  tryLocalTravelAdviceReply,
  userAsksTravelTimeAdviceText,
  type TravelAdviceHint,
} from "@/lib/ai/travel-advice-fallback";
import { CHAT_PIPELINE_FALLBACK } from "@/lib/chat/chat-pipeline-constants";
import { resolveCompanionDialogueReply } from "@/lib/ai/companion-dialogue";
import { shouldOrchestrateCompanion } from "@/lib/ai/conversation-state";

export { CHAT_PIPELINE_FALLBACK };

export type InstantChatReply = {
  summary: string;
  source: "local_travel" | "local_itinerary" | "generic_fallback" | "companion_dialogue";
  showConfirmChips?: boolean;
  startItinerary?: boolean;
};

const ITINERARY_HINTS: Record<string, Record<string, string>> = {
  釜山: {
    "11月":
      "11 月釜山我會這樣排：Day1 海雲台＋廣安里看海，Day2 西面市場＋南浦洞吃海鮮，Day3 甘川洞文化村＋札嘎其市場。這時節早晚偏涼，行程可混搭海景與室內市場，記得帶防風外套。",
  },
  京都: {
    "11月":
      "11 月京都紅葉尾聲，建議 Day1 東山（清水寺、祇園），Day2 嵐山＋金閣寺，Day3 伏見稻荷或宇治。步行多，鞋要舒服，早晚加一件外套。",
  },
  大阪: {
    "11月":
      "11 月大阪適合 2–3 天：Day1 道頓堀＋心齋橋，Day2 大阪城＋天滿宮附近，Day3 環球或近郊。可混搭美食與室內，偶發小雨帶折疊傘即可。",
  },
};

function normalizeCity(name?: string | null): string | undefined {
  const raw = name?.trim().replace(/(市|縣|都|府|道)$/u, "");
  return raw || undefined;
}

/** 使用者問某城市某月份怎麼排行程 */
export function userAsksDestinationItineraryAdvice(
  text: string,
  session: ChatPlanningSession,
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (userAsksTravelTimeAdviceText(t) && /(天氣|氣候|溫度|下雨|穿什麼)/.test(t)) return false;
  return (
    /(行程|怎麼安排|如何安排|安排|幾天幾夜|規劃|路線|待幾天|玩幾天)/.test(t) &&
    (/(推薦|建議|如何|怎麼|好不好|比較好)/.test(t) ||
      Boolean(parseTravelContextFromText(t, session).destination))
  );
}

function buildItineraryAdviceReply(
  userText: string,
  session: ChatPlanningSession,
  hint: TravelAdviceHint,
): string {
  const parsed = parseTravelContextFromText(userText, session);
  const destination =
    normalizeCity(hint.destination) ??
    normalizeCity(parsed.destination) ??
    normalizeCity(session.tripDestination?.city) ??
    normalizeCity(session.preferredArea);
  const month = hint.travelMonth ?? parsed.travelMonth;

  if (destination && month && ITINERARY_HINTS[destination]?.[month]) {
    return ITINERARY_HINTS[destination][month];
  }
  if (destination && month) {
    return `${month}去${destination}，若 2–3 天可拆成「市區美食＋一個標準景點＋半日自由」。告訴我偏好放鬆或美食，我可以再幫你排細一點。`;
  }
  if (destination) {
    return `若你打算安排${destination}行程，跟我說月份、天數和旅伴，我會依季節建議節奏與區域。`;
  }
  return CHAT_PIPELINE_FALLBACK;
}

/** 不需 OpenAI 即可回覆的訊息（旅伴編排、天氣、季節建議） */
export function resolveInstantChatReply(
  userText: string,
  session: ChatPlanningSession,
): InstantChatReply | null {
  const trimmed = userText.trim();
  if (!trimmed) return null;

  if (shouldOrchestrateCompanion(session)) {
    const companion = resolveCompanionDialogueReply(trimmed, session);
    if (companion) {
      return {
        summary: companion.summary,
        source: "companion_dialogue",
        showConfirmChips: companion.showConfirmChips,
        startItinerary: companion.startItinerary,
      };
    }
  }

  const hint = buildTravelAdviceHint(trimmed, session);

  if (userAsksTravelTimeAdviceText(trimmed)) {
    const travel = tryLocalTravelAdviceReply(trimmed, session, hint);
    if (travel) return { summary: travel, source: "local_travel" };
    const fallback = buildTravelAdviceFallbackReply(trimmed, session, hint);
    if (fallback && !fallback.startsWith("你想問哪個城市")) {
      return { summary: fallback, source: "local_travel" };
    }
  }

  if (userAsksDestinationItineraryAdvice(trimmed, session)) {
    return {
      summary: buildItineraryAdviceReply(trimmed, session, hint),
      source: "local_itinerary",
    };
  }

  return null;
}

export function buildAssistantChatMsg(summary: string, session: ChatPlanningSession): ChatMsg {
  const text = summary.trim();
  const roamie: Partial<RoamieResponse> = {
    title: "",
    summary: text,
    moodTag: session.mood ?? session.selectedMood ?? "",
    recommendations: [],
    itinerary: [],
  };
  return { role: "assistant", content: text, roamie };
}

export function appendAssistantToConversation(
  conversation: ChatMsg[],
  summary: string,
  session: ChatPlanningSession,
): ChatMsg[] {
  return [...conversation, buildAssistantChatMsg(summary, session)];
}

export function conversationMissingAssistantReply(conversation: ChatMsg[]): boolean {
  const last = conversation.at(-1);
  if (!last) return false;
  if (last.role === "user") return true;
  if (last.role === "assistant" && !last.content?.trim()) return true;
  return false;
}
