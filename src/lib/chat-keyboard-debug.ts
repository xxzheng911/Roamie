/** 單一開關：設為 true 才輸出 keyboard layout / visual 驗證 log */
export const DEBUG_CHAT_KEYBOARD = false;

export function isChatKeyboardDebugEnabled(): boolean {
  return DEBUG_CHAT_KEYBOARD;
}

export function logChatKeyboardDebug(...args: unknown[]): void {
  if (!DEBUG_CHAT_KEYBOARD) return;
  console.info(...args);
}
