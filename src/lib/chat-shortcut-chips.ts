/** 聊聊頁固定快捷按鍵（順序不可變） */
export const CHAT_SHORTCUT_PLAN_LABEL = "進階手動規劃";

export const CHAT_SHORTCUT_SEND_CHIPS = [
  "今天想放鬆走走",
  "想找安靜的咖啡廳",
  "下雨天可以去哪",
] as const;

export type ChatShortcutSendChip = (typeof CHAT_SHORTCUT_SEND_CHIPS)[number];
