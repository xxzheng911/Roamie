/** 聊聊除錯 log — 獨立模組，避免 chat-turn-engine ↔ destination-pending-question 循環引用 */

export function logChatContextUpdate(
  fields: Record<string, string | number | undefined>,
): void {
  const parts = Object.entries(fields)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}=${value}`);
  if (parts.length > 0) {
    console.info("[CHAT_CONTEXT_UPDATE]", parts.join(" "));
  }
}

export function logChatNextStep(step: string): void {
  console.info("[CHAT_NEXT_STEP]", step);
}
