import { detectPlatform } from "@/services/platform";

/** 輸入列與鍵盤上緣的留白（px） */
export const CHAT_KEYBOARD_GAP_PX = 10;

export function isCapacitorNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (
    window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

export function readSafeAreaBottomPx(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;";
  document.body.appendChild(probe);
  const px = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(px);
}

export function readTabBarHeightPx(): number {
  if (typeof document === "undefined") return 0;
  const nav = document.querySelector(".bottom-nav");
  if (!(nav instanceof HTMLElement)) return 0;
  return Math.round(nav.getBoundingClientRect().height);
}

export function measureVisualViewportKeyboardInset(): number {
  if (typeof window === "undefined") return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop || 0)));
}

/**
 * ChatComposer 外層 shell 的單一 bottom inset（不含 TabBar；鍵盤開啟時 TabBar 已隱藏）。
 * - visualViewport 已縮小：用 vv inset + gap
 * - Capacitor native resize 有效：僅 gap
 * - 否則 fallback 用 plugin 回報高度 + gap
 */
export function resolveComposerBottomInset(params: {
  keyboardVisible: boolean;
  reportedKeyboardHeightPx: number;
}): number {
  if (!params.keyboardVisible) return 0;

  const vvInset = measureVisualViewportKeyboardInset();
  const keyboardPx = Math.max(0, Math.round(params.reportedKeyboardHeightPx));

  if (vvInset > 50) {
    return vvInset + CHAT_KEYBOARD_GAP_PX;
  }

  if (isCapacitorNativeShell() && keyboardPx > 0) {
    return CHAT_KEYBOARD_GAP_PX;
  }

  if (keyboardPx > 50) {
    return keyboardPx + CHAT_KEYBOARD_GAP_PX;
  }

  return CHAT_KEYBOARD_GAP_PX;
}

/** @deprecated 使用 resolveComposerBottomInset */
export function resolveChatInputBarLift(
  open: boolean,
  reportedKeyboardHeightPx: number,
): number {
  const inset = resolveComposerBottomInset({
    keyboardVisible: open,
    reportedKeyboardHeightPx,
  });
  if (!open) return 0;
  return Math.max(0, inset - CHAT_KEYBOARD_GAP_PX);
}

/** @deprecated 使用 resolveComposerBottomInset */
export function resolveChatPageBottomInset(
  open: boolean,
  keyboardHeightPx: number,
): number {
  return resolveChatInputBarLift(open, keyboardHeightPx);
}

export function logChatKeyboardShow(height: number): void {
  console.info("[Chat Keyboard Show]", { height });
}

export function logChatKeyboardHide(): void {
  console.info("[Chat Keyboard Hide]");
}

export function logChatComposerRender(): void {
  console.info("[ChatComposer Render]");
}

export function logComposerLayoutSnapshot(params: {
  keyboardVisible: boolean;
  reportedKeyboardHeightPx: number;
  composerBottomInsetPx: number;
  headerHeightPx?: number;
}): void {
  const platform = detectPlatform();
  const vvInset = measureVisualViewportKeyboardInset();
  const safeBottom = readSafeAreaBottomPx();
  const tabBar = readTabBarHeightPx();
  const tabBarVisible = !params.keyboardVisible;

  console.info("[Keyboard Visible]", params.keyboardVisible);
  console.info("[Keyboard Height]", params.reportedKeyboardHeightPx);
  console.info("[Keyboard Vertical Offset]", params.headerHeightPx ?? 0);
  console.info("[TabBar Visible]", tabBarVisible);
  console.info("[SafeArea Bottom]", safeBottom);
  console.info("[Composer Bottom Gap]", params.composerBottomInsetPx);

  console.info("[Chat Input Layout Rendered]", {
    ...params,
    vvInset,
    safeAreaBottom: safeBottom,
    tabBarHeight: tabBar,
    tabBarVisible,
    native: platform.isCapacitor,
    windowInnerHeight: typeof window !== "undefined" ? window.innerHeight : 0,
    visualViewportHeight:
      typeof window !== "undefined" ? window.visualViewport?.height ?? null : null,
  });
}

/** @deprecated 使用 logComposerLayoutSnapshot */
export function logChatKeyboardLayoutSnapshot(params: {
  open: boolean;
  reportedKeyboardHeightPx: number;
  inputBarLiftPx: number;
  headerHeightPx?: number;
}): void {
  logComposerLayoutSnapshot({
    keyboardVisible: params.open,
    reportedKeyboardHeightPx: params.reportedKeyboardHeightPx,
    composerBottomInsetPx: params.open
      ? params.inputBarLiftPx + CHAT_KEYBOARD_GAP_PX
      : 0,
    headerHeightPx: params.headerHeightPx,
  });
}
