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

/** iOS WKWebView 在 plugin 未回報高度時的合理鍵盤高度估計 */
export function estimateNativeKeyboardHeight(): number {
  if (typeof window === "undefined") return 320;
  return Math.round(Math.min(420, Math.max(280, window.innerHeight * 0.36)));
}

export function parseKeyboardEventHeight(info: unknown): number {
  if (info == null) return 0;
  if (typeof info === "number" && Number.isFinite(info)) {
    return Math.max(0, Math.round(info));
  }
  if (typeof info === "object") {
    const rec = info as Record<string, unknown>;
    const raw = rec.keyboardHeight ?? rec.keyboardFrameHeight ?? rec.height;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return Math.max(0, Math.round(raw));
    }
  }
  return 0;
}

/**
 * 量測 composer 底緣距 layout 底邊的距離（px）。鍵盤開啟且 native resize 生效時會明顯 > 鍵盤高度。
 */
export function measureComposerClearanceAboveLayoutBottom(
  shellEl: HTMLElement | null,
): number {
  if (typeof window === "undefined" || !shellEl) return 0;
  const bottom = shellEl.getBoundingClientRect().bottom;
  const layoutBottom = window.visualViewport?.height ?? window.innerHeight;
  return Math.max(0, Math.round(layoutBottom - bottom));
}

/**
 * ChatComposer 外層 shell 的單一 bottom inset（不含 TabBar；鍵盤開啟時 TabBar 已隱藏）。
 * - Capacitor resize:native + plugin 有高度：WebView 已上移，僅加 gap（勿再加 keyboardHeight）
 * - visualViewport 已縮小且 native 未撐起 composer：用 vv inset + gap
 * - plugin 高度為 0：估計高度 + gap（native resize 與 plugin 皆失效時）
 */
export function resolveComposerBottomInset(params: {
  keyboardVisible: boolean;
  reportedKeyboardHeightPx: number;
  composerShellEl?: HTMLElement | null;
}): number {
  if (!params.keyboardVisible) return 0;

  const vvInset = measureVisualViewportKeyboardInset();
  const keyboardPx = Math.max(0, Math.round(params.reportedKeyboardHeightPx));
  const nativeShell = isCapacitorNativeShell();

  if (nativeShell && keyboardPx > 50) {
    return CHAT_KEYBOARD_GAP_PX;
  }

  if (vvInset > 50) {
    const clearance = measureComposerClearanceAboveLayoutBottom(
      params.composerShellEl ?? null,
    );
    if (nativeShell && clearance > keyboardPx * 0.55) {
      return CHAT_KEYBOARD_GAP_PX;
    }
    return vvInset + CHAT_KEYBOARD_GAP_PX;
  }

  if (nativeShell) {
    const clearance = measureComposerClearanceAboveLayoutBottom(
      params.composerShellEl ?? null,
    );
    if (clearance > 120) {
      return CHAT_KEYBOARD_GAP_PX;
    }
    const manualLift =
      keyboardPx > 50 ? keyboardPx : estimateNativeKeyboardHeight();
    return manualLift + CHAT_KEYBOARD_GAP_PX;
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

  const clearance =
    typeof document !== "undefined"
      ? measureComposerClearanceAboveLayoutBottom(
          document.querySelector(".chat-composer-shell"),
        )
      : 0;

  console.info("[Chat Input Layout Rendered]", {
    ...params,
    vvInset,
    composerClearancePx: clearance,
    insetStrategy:
      params.composerBottomInsetPx <= CHAT_KEYBOARD_GAP_PX + 2
        ? "native-gap-only"
        : "manual-lift",
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
