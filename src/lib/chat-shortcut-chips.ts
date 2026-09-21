import { translate } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/types";
/** 聊聊頁固定快捷按鍵（順序不可變） */
export const CHAT_SHORTCUT_PLAN_LABEL = "進階手動規劃";

export const CHAT_SHORTCUT_SEND_CHIPS = [
  "今天想放鬆走走",
  "想找安靜的咖啡廳",
  "下雨天可以去哪",
] as const;

export type ChatShortcutSendChip = (typeof CHAT_SHORTCUT_SEND_CHIPS)[number];

const SHORTCUT_DISPLAY_KEYS: Record<string, string> = {
  進階手動規劃: "planShortcut",
  今天想放鬆走走: "relaxShortcut",
  想找安靜的咖啡廳: "cafeShortcut",
  下雨天可以去哪: "rainShortcut",
  生成行程: "generateShortcut",
  再推薦一些: "moreShortcut",
  重新生成: "retryShortcut",
  幫我生成: "helpGenerateShortcut",
};
export function chatShortcutLabel(payload: string, locale: Locale): string {
  const key = SHORTCUT_DISPLAY_KEYS[payload];
  return key ? translate(locale, `uiCoverage.${key}`) : payload;
}

/** Routing stays canonical; only the localized message enters conversation history. */
export function chatShortcutContract(routingPayload: string, locale: Locale) {
  return {
    canonicalIntent: ({ relaxShortcut: "relax_walk", cafeShortcut: "quiet_cafe", rainShortcut: "rainy_indoor", generateShortcut: "generate_itinerary", moreShortcut: "more_recommendations", retryShortcut: "regenerate", helpGenerateShortcut: "generate_itinerary" } as Record<string, string>)[SHORTCUT_DISPLAY_KEYS[routingPayload]] ?? null,
    routingPayload,
    displayMessage: chatShortcutLabel(routingPayload, locale),
  };
}
