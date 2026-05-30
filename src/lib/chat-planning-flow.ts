import type { ChatPhase } from "@/lib/ai/context";
import {
  chatPhaseForStage,
  resolveConversationStage,
} from "@/lib/ai/conversation-stage";
import { resolveAiUserIntent } from "@/lib/ai/user-intent";
import { userAsksTravelTimeAdviceText } from "@/lib/ai/travel-advice-fallback";
import type { TripIntent } from "@/lib/recommendation/trip-intent";
import type { ChatMsg } from "@/lib/chat-history";
import {
  isUserConfirmingItinerary,
  roamieRecToChatItem,
  type ChatPlaceItem,
  type ChatPlanningSession,
} from "@/lib/chat-session";
import type { RoamieRecommendationItem } from "@/lib/ai/types";

/** 使用者想繼續探索、調整推薦方向 */
export function userWantsMoreRecommendations(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // 不可呼叫 userAsksTravelTimeAdvice（會經 userWantsItineraryPlanning → userWantsPlanningFinalize 循環）
  if (userAsksTravelTimeAdviceText(t)) return false;
  return /(怎麼安排|還能|還可以|推薦|想去|想找|有沒有|附近|這一帶|晚上|散步|咖啡|餐廳|酒吧|宵夜|安靜|熱鬧|人少|換一個|別的|再幫我|幫我找|走走|坐坐|續攤|夜景)/.test(
    t,
  );
}

/** 使用者想進入交通／預算／排行程確認 */
export function userWantsPlanningFinalize(text: string): boolean {
  const t = text.trim();
  if (isUserConfirmingItinerary(t)) return true;
  if (userWantsMoreRecommendations(t)) return false;
  return /(交通|預算|花費|幾點|停留|就這樣|排行程|排成|整理成行程|可以了|差不多了)/.test(t);
}

export function extractChatPlanningContextFromText(
  text: string,
  session: ChatPlanningSession,
): ChatPlanningSession {
  const t = text.trim();
  if (!t) return session;

  let next: ChatPlanningSession = {
    ...session,
    lastUserIntent: t.slice(0, 200),
  };

  const avoidTypes = new Set(session.avoidTypes ?? []);
  if (/(太吵|吵|擠|人多|不想.*人)/.test(t)) avoidTypes.add("人多吵雜");
  if (/(不想走太多|少走路|不想走太多|不要走太多|怕走路)/.test(t)) avoidTypes.add("長距離步行");
  if (/(太貴|高價|奢侈)/.test(t)) avoidTypes.add("高價位");
  if (/(戶外|曬|太陽)/.test(t) && /(不要|不想|怕)/.test(t)) avoidTypes.add("長時間戶外曝曬");
  if (/(室內|冷氣)/.test(t) && /(想|要|偏好)/.test(t)) next.discovery = { ...next.discovery, setting: "室內" };

  if (/(安靜|靜|人少|幽靜)/.test(t)) {
    avoidTypes.add("熱鬧喧嘩");
    if (!next.mood?.includes("安靜")) next.mood = next.mood ? `${next.mood}·安靜` : "安靜";
  }
  if (/(熱鬧|嗨|續攤)/.test(t)) avoidTypes.add("過度安靜無氣氛");

  const areaMatch = t.match(
    /(?:在|到|去|這附近|附近|那一帶|區域)(.{2,24}?)(?:走走|逛逛|安排|推薦|有|嗎|吧|呢|，|。|$)/,
  );
  if (areaMatch?.[1] && areaMatch[1].length >= 2) {
    next.preferredArea = areaMatch[1].trim().slice(0, 40);
  }
  if (/這附近|這一帶|這邊/.test(t) && !next.preferredArea) {
    next.preferredArea = "目前位置附近";
  }

  const rejectMatch = t.match(/(?:不要|不想|不喜歡|排除)(.{2,20}?)(?:店|餐廳|地方|點|的)/);
  if (rejectMatch?.[1]) {
    const rejected = new Set(session.rejectedPlaceNames ?? []);
    rejected.add(rejectMatch[1].trim());
    next.rejectedPlaceNames = [...rejected];
  }

  if (avoidTypes.size) next.avoidTypes = [...avoidTypes];

  if (userWantsPlanningFinalize(t) && next.selectedPlaces.length >= 1) {
    next.phase = "ready";
  } else if (userWantsMoreRecommendations(t)) {
    if (next.phase === "collect" || next.phase === "discover") {
      next.phase = next.selectedPlaces.length ? "followup" : "recommend";
    }
  }

  return next;
}

export function mergeRecommendedPlaces(
  existing: ChatPlaceItem[],
  incoming: RoamieRecommendationItem[],
): ChatPlaceItem[] {
  const map = new Map<string, ChatPlaceItem>();
  for (const p of existing) map.set(p.name, p);
  for (const r of incoming) {
    const item = roamieRecToChatItem(r);
    map.set(item.name, map.has(item.name) ? { ...map.get(item.name)!, ...item } : item);
  }
  return [...map.values()];
}

/** 依最新訊息決定送給 AI 的 chatPhase（與 session.phase 可不同） */
export function resolveChatApiPhase(
  session: ChatPlanningSession,
  userText: string,
  override?: ChatPhase,
  tripIntent?: TripIntent,
): ChatPhase {
  if (override) return override;
  const aiIntent = resolveAiUserIntent(session, userText, tripIntent, {
    chatPhaseOverride: override,
  });
  const stage = resolveConversationStage(session, userText, tripIntent, aiIntent.type);
  return chatPhaseForStage(stage, session, userText);
}

/** 對話紀錄給 AI：助理訊息用 summary + 地點名，避免整包 JSON 難以接話 */
export function formatMessageForAiContext(msg: ChatMsg): string {
  if (msg.role === "user") return msg.content.trim();
  if (msg.roamie?.summary) {
    const names = (msg.roamie.recommendations ?? []).map((r) => r.name).filter(Boolean);
    const placesBit = names.length ? `\n（當時推薦：${names.join("、")}）` : "";
    return `${msg.roamie.summary.trim()}${placesBit}`;
  }
  return msg.content.trim();
}

export function buildApiMessagesFromConversation(conversation: ChatMsg[]): {
  role: "user" | "assistant";
  content: string;
}[] {
  return conversation
    .filter((m) => m.content.trim() || m.roamie?.summary)
    .map((m) => ({
      role: m.role,
      content: formatMessageForAiContext(m),
    }))
    .filter((m) => m.content.length > 0);
}

export function resolveSessionPhaseAfterReply(
  session: ChatPlanningSession,
  hadNewRecommendations: boolean,
  apiPhase: ChatPhase,
): ChatPlanningSession["phase"] {
  if (session.phase === "ready" || session.phase === "generating" || session.phase === "done") {
    return session.phase;
  }
  if (session.phase === "discover" && hadNewRecommendations) return "followup";
  if (apiPhase === "collect" && userWantsPlanningFinalize(session.lastUserIntent ?? "")) {
    return session.selectedPlaces.length ? "collect" : "followup";
  }
  if (hadNewRecommendations) {
    if (session.selectedPlaces.length) return "followup";
    return "followup";
  }
  if (session.selectedPlaces.length) return "followup";
  if (session.recommendedPlaces.length) return "followup";
  return session.phase === "discover" ? "recommend" : session.phase;
}
