/** 聊聊鍵盤 visual area 驗證（不改 layout 計算） */
import { CHAT_KEYBOARD_GAP_PX } from "@/lib/chat-keyboard-layout";
import { detectPlatform } from "@/services/platform";
import {
  isChatKeyboardDebugEnabled,
  logChatKeyboardDebug,
} from "@/lib/chat-keyboard-debug";

/**
 * iOS 注音/emoji 鍵盤候選列透明區高度（僅視覺背景延伸，不影響 composer bottom）。
 * 可微調 36~52。
 */
export const CHAT_KEYBOARD_VISUAL_FILLER_PX = 34;

/** 鍵盤開啟時 shell::after 背景 filler 高度（不改輸入框位置） */
export function resolveChatKeyboardVisualFillerPx(params: {
  keyboardOpen: boolean;
  nativeKeyboardHeightPx: number;
}): number {
  if (!params.keyboardOpen || params.nativeKeyboardHeightPx <= 0) return 0;
  const domGapFill = CHAT_KEYBOARD_GAP_PX;
  if (typeof window === "undefined") return domGapFill;
  const { isIOS, isNative } = detectPlatform();
  if (isNative && isIOS) {
    return domGapFill + CHAT_KEYBOARD_VISUAL_FILLER_PX;
  }
  return domGapFill;
}

export { isChatKeyboardDebugEnabled } from "@/lib/chat-keyboard-debug";

export type ChatKeyboardDebugMetrics = {
  visualViewportHeightPx: number;
  visualViewportBottomY: number;
  inputRowBottomY: number;
  keyboardTopY: number;
  inputRowToKeyboardGapPx: number;
  inputRowToVisualViewportGapPx: number;
};

export function measureChatKeyboardDebugMetrics(params: {
  inputRowEl: HTMLElement | null;
  nativeKeyboardHeightPx: number;
}): ChatKeyboardDebugMetrics | null {
  if (typeof window === "undefined") return null;

  const vv = window.visualViewport;
  const visualViewportHeightPx = vv ? Math.round(vv.height) : Math.round(window.innerHeight);
  const visualViewportBottomY = vv
    ? Math.round(vv.offsetTop + vv.height)
    : Math.round(window.innerHeight);
  const keyboardTopY =
    window.innerHeight - Math.max(0, Math.round(params.nativeKeyboardHeightPx));
  const inputRect = params.inputRowEl?.getBoundingClientRect();
  if (!inputRect) return null;

  const inputRowBottomY = Math.round(inputRect.bottom);

  return {
    visualViewportHeightPx,
    visualViewportBottomY,
    inputRowBottomY,
    keyboardTopY,
    inputRowToKeyboardGapPx: Math.round(keyboardTopY - inputRowBottomY),
    inputRowToVisualViewportGapPx: Math.round(visualViewportBottomY - inputRowBottomY),
  };
}

let keyboardShowIndex = 0;

export function logChatKeyboardVisualVerification(params: {
  nativeKeyboardHeightPx: number;
  inputRowEl: HTMLElement | null;
}): void {
  if (!isChatKeyboardDebugEnabled()) return;

  keyboardShowIndex += 1;
  const metrics = measureChatKeyboardDebugMetrics(params);
  if (!metrics) return;

  logChatKeyboardDebug("[Chat Keyboard Visual Verification]");
  logChatKeyboardDebug(
    "[testHint]",
    "手動切換鍵盤：English → emoji → 注音；若 DOM gap≈8~12 但注音視覺空隙較大 → iOS keyboard visual effect",
  );
  logChatKeyboardDebug("[keyboardShowIndex]", keyboardShowIndex);
  logChatKeyboardDebug("[keyboardTopY]", metrics.keyboardTopY);
  logChatKeyboardDebug("[visualViewport.height]", metrics.visualViewportHeightPx);
  logChatKeyboardDebug("[visualViewportBottomY]", metrics.visualViewportBottomY);
  logChatKeyboardDebug("[inputRowRect.bottom]", metrics.inputRowBottomY);
  logChatKeyboardDebug("[inputRowToKeyboardGap]", metrics.inputRowToKeyboardGapPx);
  logChatKeyboardDebug("[inputRowToVisualViewportGap]", metrics.inputRowToVisualViewportGapPx);
  logChatKeyboardDebug(
    "[chatComposerKeyboardFillerPx]",
    resolveChatKeyboardVisualFillerPx({
      keyboardOpen: true,
      nativeKeyboardHeightPx: params.nativeKeyboardHeightPx,
    }),
  );
  logChatKeyboardDebug(
    "[visualAreaNote]",
    metrics.inputRowToKeyboardGapPx >= 8 && metrics.inputRowToKeyboardGapPx <= 12
      ? "DOM gap OK — compare visual gap across keyboard layouts"
      : "DOM gap outside 8~12 — re-check before blaming iOS visual area",
  );
}
