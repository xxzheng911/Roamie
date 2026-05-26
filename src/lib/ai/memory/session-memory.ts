import type { ChatMsg } from "@/lib/chat-history";
import type { ChatPlanningSession } from "@/lib/chat-session";
import type { SessionMemorySnapshot } from "@/lib/ai/memory/types";

export function buildSessionMemorySnapshot(
  session: ChatPlanningSession,
  conversation?: ChatMsg[],
): SessionMemorySnapshot {
  const userTurns = conversation?.filter((m) => m.role === "user").length ?? 0;
  return {
    mood: session.mood,
    selectedMood: session.selectedMood,
    preferredArea: session.preferredArea,
    avoidTypes: session.avoidTypes,
    rejectedPlaceNames: session.rejectedPlaceNames,
    selectedPlaceNames: session.selectedPlaceNames,
    companionship: session.discovery?.companionship,
    setting: session.discovery?.setting,
    transportation: session.transportation,
    pace: session.pace ?? session.discovery?.pace,
    lastUserIntent: session.lastUserIntent,
    conversationSummary: session.planningHints?.conversationSummary,
    turnCount: userTurns,
  };
}

export function formatSessionMemoryForPrompt(snapshot: SessionMemorySnapshot): string {
  const lines: string[] = [];
  if (snapshot.selectedMood || snapshot.mood)
    lines.push(`當下心情：${snapshot.selectedMood ?? snapshot.mood}`);
  if (snapshot.preferredArea) lines.push(`想去的區域：${snapshot.preferredArea}`);
  if (snapshot.setting) lines.push(`室內外傾向：${snapshot.setting}`);
  if (snapshot.companionship) lines.push(`旅伴：${snapshot.companionship}`);
  if (snapshot.transportation) lines.push(`交通：${snapshot.transportation}`);
  if (snapshot.pace) lines.push(`節奏：${snapshot.pace}`);
  if (snapshot.avoidTypes?.length) lines.push(`想避開：${snapshot.avoidTypes.join("、")}`);
  if (snapshot.rejectedPlaceNames?.length)
    lines.push(`明確不要：${snapshot.rejectedPlaceNames.join("、")}`);
  if (snapshot.selectedPlaceNames?.length)
    lines.push(`已選地點：${snapshot.selectedPlaceNames.join("、")}`);
  if (snapshot.lastUserIntent) lines.push(`最新一句：${snapshot.lastUserIntent.slice(0, 200)}`);
  if (snapshot.conversationSummary)
    lines.push(`對話摘要：${snapshot.conversationSummary.slice(0, 500)}`);
  if (snapshot.turnCount != null) lines.push(`本輪使用者發言約 ${snapshot.turnCount} 次`);
  return lines.length ? lines.join("\n") : "（本輪對話剛開始）";
}
