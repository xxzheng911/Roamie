import {
  isCapacitorNativeShell,
  measureVisualViewportKeyboardInset,
  readSafeAreaBottomPx,
} from "@/lib/chat-keyboard-layout";
import { isChatKeyboardDebugEnabled, logChatKeyboardDebug } from "@/lib/chat-keyboard-debug";

/** composer 與鍵盤上緣 / 輸入列間距（8~12px） */
export const KEYBOARD_OVERLAY_GAP_PX = 10;

/** WebView 是否已被 keyboard 縮小（Capacitor resize 或 visualViewport shrink） */
export function isWebViewKeyboardResized(): boolean {
  return measureVisualViewportKeyboardInset() > 50;
}

export type KeyboardOverlayLayout = {
  keyboardOpen: boolean;
  webviewResized: boolean;
  reportedKeyboardHeightPx: number;
  /** 實際用於定位的 keyboard 高度（resize 後為 0，避免 double inset） */
  effectiveKeyboardHeightPx: number;
  /** fixed/absolute composer 的 bottom offset（自 viewport / frame 底緣算起） */
  composerBottomPx: number;
  /** messages 列表底部 spacer：僅 composer 高度 + gap，不含 keyboard */
  messagesBottomSpacerPx: number;
  safeAreaBottomPx: number;
};

export function resolveKeyboardOverlayLayout(params: {
  keyboardOpen: boolean;
  reportedKeyboardHeightPx: number;
  composerContentHeightPx: number;
}): KeyboardOverlayLayout {
  const safeAreaBottomPx = readSafeAreaBottomPx();
  const webviewResized = params.keyboardOpen && isWebViewKeyboardResized();
  const keyboardPx = Math.max(0, Math.round(params.reportedKeyboardHeightPx));
  const vvInset = measureVisualViewportKeyboardInset();

  let effectiveKeyboardHeightPx = 0;
  let composerBottomPx = safeAreaBottomPx;

  if (params.keyboardOpen) {
    if (webviewResized) {
      effectiveKeyboardHeightPx = 0;
      composerBottomPx = safeAreaBottomPx + KEYBOARD_OVERLAY_GAP_PX;
    } else {
      effectiveKeyboardHeightPx =
        keyboardPx > 0 ? keyboardPx : vvInset > 0 ? vvInset : 0;
      composerBottomPx =
        effectiveKeyboardHeightPx + safeAreaBottomPx + KEYBOARD_OVERLAY_GAP_PX;
    }
  }

  const messagesBottomSpacerPx = params.keyboardOpen
    ? Math.max(0, params.composerContentHeightPx) + KEYBOARD_OVERLAY_GAP_PX
    : 0;

  return {
    keyboardOpen: params.keyboardOpen,
    webviewResized,
    reportedKeyboardHeightPx: keyboardPx,
    effectiveKeyboardHeightPx,
    composerBottomPx,
    messagesBottomSpacerPx,
    safeAreaBottomPx,
  };
}

/** 將 focus 的 input/textarea 捲到鍵盤上方（規劃表單等） */
export function scrollFocusedInputAboveKeyboard(
  element: HTMLElement,
  layout: KeyboardOverlayLayout,
): void {
  const scrollRoot =
    element.closest(".plan-page-scroll") ??
    element.closest(".chat-messages") ??
    element.closest("[data-keyboard-scroll-root]");

  const gap = KEYBOARD_OVERLAY_GAP_PX;
  const keyboardTop = layout.webviewResized
    ? window.innerHeight - layout.safeAreaBottomPx - gap
    : window.innerHeight - layout.composerBottomPx + gap;

  const rect = element.getBoundingClientRect();
  const overflow = rect.bottom - keyboardTop + gap;

  if (overflow <= 0) return;

  if (scrollRoot instanceof HTMLElement) {
    scrollRoot.scrollTop += overflow;
    return;
  }

  element.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export const APP_KEYBOARD_OPEN_CLASS = "app-keyboard-open";

export function setAppKeyboardOpen(open: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(APP_KEYBOARD_OPEN_CLASS, open);
}

export function logKeyboardOverlayLayout(
  layout: KeyboardOverlayLayout,
  routeHint?: string,
): void {
  if (!isChatKeyboardDebugEnabled()) return;

  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  logChatKeyboardDebug("[Keyboard Overlay Mode]", "transparent");
  logChatKeyboardDebug("[Keyboard Visible]", layout.keyboardOpen);
  logChatKeyboardDebug("[keyboardHeight]", layout.reportedKeyboardHeightPx);
  logChatKeyboardDebug("[effectiveKeyboardHeight]", layout.effectiveKeyboardHeightPx);
  logChatKeyboardDebug("[webviewResized]", layout.webviewResized);
  logChatKeyboardDebug("[composerBottomPx]", layout.composerBottomPx);
  logChatKeyboardDebug("[messagesBottomSpacerPx]", layout.messagesBottomSpacerPx);
  logChatKeyboardDebug("[visualViewport height]", vv ? Math.round(vv.height) : null);
  logChatKeyboardDebug("[window.innerHeight]", typeof window !== "undefined" ? window.innerHeight : 0);
  logChatKeyboardDebug("[vvInset]", measureVisualViewportKeyboardInset());
  logChatKeyboardDebug("[native shell]", isCapacitorNativeShell());
  logChatKeyboardDebug(
    "[double inset avoided]",
    layout.webviewResized && layout.effectiveKeyboardHeightPx === 0,
  );
  if (routeHint) logChatKeyboardDebug("[keyboard route]", routeHint);
}
