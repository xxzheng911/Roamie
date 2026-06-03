import type { ChatPlanningSession } from "@/lib/chat-session";
import type { PlusConversationMemory } from "@/lib/ai/plus-conversation-memory";

function uniqStrings(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

/** 從單則使用者訊息萃取可持久化的 Plus 偏好 */
export function extractPlusMemoryFromUserText(
  text: string,
  existing: PlusConversationMemory,
): PlusConversationMemory {
  const t = text.trim();
  if (!t) return existing;

  const likes = [...(existing.likes ?? [])];
  const dislikes = [...(existing.dislikes ?? [])];
  let travelPace = existing.travelPace;

  if (/(不喜歡|不想|不要).{0,8}(太趕|趕行程|排太滿|太滿)|不要太趕|不想太趕|不趕/.test(t)) {
    dislikes.push("行程太趕、排太滿");
    travelPace = "慢旅行、留白多、不趕行程";
  }
  if (/(喜歡|愛|偏好).{0,6}(咖啡|café|cafe)/i.test(t)) {
    likes.push("咖啡廳");
  }
  if (/(喜歡|愛|想).{0,6}散步|適合散步|慢慢走/.test(t)) {
    likes.push("適合散步的路線");
  }
  if (/(不要太多人|不想人擠|避開人潮|人少一點|不要太熱鬧|不想太吵)/.test(t)) {
    dislikes.push("人潮太多、太吵的景點");
  }
  if (/(安靜|幽靜|靜一點)/.test(t)) {
    likes.push("安靜氛圍");
  }
  if (/(室內|下雨天|雨天)/.test(t) && /(喜歡|偏好|優先)/.test(t)) {
    likes.push("室內景點");
  }

  const styleMatch = t.match(/(?:旅行風格|風格)[：:]\s*([^\n。，,]+)/);
  if (styleMatch?.[1]) {
    for (const s of styleMatch[1].split(/[、,，/]/)) {
      if (s.trim()) likes.push(s.trim());
    }
  }

  return {
    ...existing,
    likes: uniqStrings(likes).length ? uniqStrings(likes) : existing.likes,
    dislikes: uniqStrings(dislikes).length ? uniqStrings(dislikes) : existing.dislikes,
    travelPace: travelPace ?? existing.travelPace,
  };
}

/** 合併 session 內已解析的偏好（avoidTypes、discovery、規劃狀態） */
export function mergeSessionIntoPlusMemory(
  existing: PlusConversationMemory,
  session: ChatPlanningSession,
): PlusConversationMemory {
  const likes = [...(existing.likes ?? [])];
  const dislikes = [...(existing.dislikes ?? [])];

  for (const a of session.avoidTypes ?? []) {
    if (/人多|吵|擠/.test(a)) dislikes.push("人潮太多、太吵");
    else if (/步行|走太多/.test(a)) dislikes.push("需要走太多路");
    else if (/曬|戶外/.test(a)) dislikes.push("長時間戶外曝曬");
    else if (/貴|高價/.test(a)) dislikes.push("高價位");
    else dislikes.push(a);
  }

  for (const p of session.conversationState?.preferences ?? []) {
    if (p === "flexible") continue;
    likes.push(p);
  }

  if (session.tripStyles?.trim()) {
    for (const s of session.tripStyles.split(/[、,，/]/)) {
      if (s.trim()) likes.push(s.trim());
    }
  }

  if (session.discovery?.setting === "室內") likes.push("室內景點");
  if (session.pace === "悠閒" || session.discovery?.pace === "慢") {
    existing = { ...existing, travelPace: "慢旅行、留白多" };
  }

  let next: PlusConversationMemory = {
    ...existing,
    likes: uniqStrings(likes).length ? uniqStrings(likes) : existing.likes,
    dislikes: uniqStrings(dislikes).length ? uniqStrings(dislikes) : existing.dislikes,
    preferredTransport: session.transportation?.trim() || existing.preferredTransport,
    budgetRange: session.budget?.trim() || existing.budgetRange,
    travelPace: existing.travelPace,
  };

  if (session.lastUserIntent?.trim()) {
    next = extractPlusMemoryFromUserText(session.lastUserIntent, next);
  }

  return next;
}
