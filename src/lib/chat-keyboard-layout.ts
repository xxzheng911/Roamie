import { detectPlatform } from "@/services/platform";
import {
  logKeyboardOverlayLayout,
  resolveKeyboardOverlayLayout,
} from "@/lib/keyboard-overlay-layout";
import { isChatKeyboardDebugEnabled, logChatKeyboardDebug } from "@/lib/chat-keyboard-debug";

/** 聊聊 composer 與鍵盤上緣的留白（px）；勿與 shell padding-bottom 重複套用 */
export const CHAT_KEYBOARD_GAP_PX = 10;

/**
 * iOS 可選微調（0~12px）；預設 0。勿使用大 offset，以 DOM inputRowToKeyboardGap 為準。
 */
export const IOS_KEYBOARD_VISUAL_OFFSET_PX = 0;

function resolveChatIosVisualKeyboardOffset(): number {
  if (IOS_KEYBOARD_VISUAL_OFFSET_PX <= 0) return 0;
  if (typeof window === "undefined") return 0;
  const { isIOS, isNative } = detectPlatform();
  if (!isNative || !isIOS) return 0;
  return Math.min(12, Math.max(0, IOS_KEYBOARD_VISUAL_OFFSET_PX));
}

export type ChatComposerKeyboardLayout = {
  composerBottomPx: number;
  /** 實際採用的 bottom 來源 */
  composerBottomPxSource:
    | "native-keyboard-no-safearea"
    | "native-keyboard-webview-resized"
    | "safe-area-only"
    | "closed";
  nativeKeyboardHeightPx: number;
  visualKeyboardOffsetPx: number;
  composerBottomPxAfterVisualOffset: number;
  visualViewportInsetPx: number;
  webviewResized: boolean;
  /** 診斷用；chat 計算不再使用 vv / fallback inset */
  fallbackInsetPx: number;
  safeAreaBottomPx: number;
  doubleInsetAvoided: true;
};

/**
 * 聊聊頁 overlay composer 的 `bottom`（自 layout viewport 底緣算起）。
 * overlay（webviewResized=false）：nativeKeyboardHeight + gap，不加 safeAreaBottom。
 */
export function resolveChatComposerKeyboardLayout(params: {
  keyboardOpen: boolean;
  nativeKeyboardHeightPx: number;
}): ChatComposerKeyboardLayout {
  const safeAreaBottomPx = readSafeAreaBottomPx();
  const visualViewportInsetPx = measureVisualViewportKeyboardInset();
  const webviewResized = params.keyboardOpen && visualViewportInsetPx > 50;
  const nativeKeyboardHeightPx = Math.max(0, Math.round(params.nativeKeyboardHeightPx));
  const visualKeyboardOffsetPx =
    params.keyboardOpen && nativeKeyboardHeightPx > 0 && !webviewResized
      ? resolveChatIosVisualKeyboardOffset()
      : 0;

  if (!params.keyboardOpen) {
    return {
      composerBottomPx: safeAreaBottomPx,
      composerBottomPxSource: "closed",
      nativeKeyboardHeightPx,
      visualKeyboardOffsetPx: 0,
      composerBottomPxAfterVisualOffset: safeAreaBottomPx,
      visualViewportInsetPx,
      webviewResized: false,
      fallbackInsetPx: 0,
      safeAreaBottomPx,
      doubleInsetAvoided: true,
    };
  }

  if (nativeKeyboardHeightPx > 0 && !webviewResized) {
    const composerBottomPxAfterVisualOffset =
      Math.max(0, nativeKeyboardHeightPx - visualKeyboardOffsetPx) + CHAT_KEYBOARD_GAP_PX;
    return {
      composerBottomPx: composerBottomPxAfterVisualOffset,
      composerBottomPxSource: "native-keyboard-no-safearea",
      nativeKeyboardHeightPx,
      visualKeyboardOffsetPx,
      composerBottomPxAfterVisualOffset,
      visualViewportInsetPx,
      webviewResized,
      fallbackInsetPx: 0,
      safeAreaBottomPx,
      doubleInsetAvoided: true,
    };
  }

  if (nativeKeyboardHeightPx > 0 && webviewResized) {
    const composerBottomPxAfterVisualOffset = safeAreaBottomPx + CHAT_KEYBOARD_GAP_PX;
    return {
      composerBottomPx: composerBottomPxAfterVisualOffset,
      composerBottomPxSource: "native-keyboard-webview-resized",
      nativeKeyboardHeightPx,
      visualKeyboardOffsetPx: 0,
      composerBottomPxAfterVisualOffset,
      visualViewportInsetPx,
      webviewResized,
      fallbackInsetPx: 0,
      safeAreaBottomPx,
      doubleInsetAvoided: true,
    };
  }

  return {
    composerBottomPx: safeAreaBottomPx,
    composerBottomPxSource: "safe-area-only",
    nativeKeyboardHeightPx,
    visualKeyboardOffsetPx: 0,
    composerBottomPxAfterVisualOffset: safeAreaBottomPx,
    visualViewportInsetPx,
    webviewResized,
    fallbackInsetPx: 0,
    safeAreaBottomPx,
    doubleInsetAvoided: true,
  };
}

export function logChatComposerKeyboardLayout(layout: ChatComposerKeyboardLayout): void {
  if (!isChatKeyboardDebugEnabled()) return;

  const visualKeyboardTopY =
    typeof window !== "undefined" && layout.nativeKeyboardHeightPx > 0
      ? Math.round(
          window.innerHeight -
            Math.max(0, layout.nativeKeyboardHeightPx - layout.visualKeyboardOffsetPx),
        )
      : null;

  logChatKeyboardDebug("[Chat Composer Keyboard]");
  logChatKeyboardDebug("[keyboardHeight]", layout.nativeKeyboardHeightPx);
  logChatKeyboardDebug("[nativeKeyboardHeight]", layout.nativeKeyboardHeightPx);
  logChatKeyboardDebug("[visualViewportInset]", layout.visualViewportInsetPx);
  logChatKeyboardDebug("[webviewResized]", layout.webviewResized);
  logChatKeyboardDebug("[fallbackInset]", layout.fallbackInsetPx);
  logChatKeyboardDebug("[safeAreaBottom]", layout.safeAreaBottomPx);
  logChatKeyboardDebug("[visualKeyboardOffset]", layout.visualKeyboardOffsetPx);
  logChatKeyboardDebug("[composerBottomPxAfterVisualOffset]", layout.composerBottomPxAfterVisualOffset);
  logChatKeyboardDebug("[composerBottomPx]", layout.composerBottomPx);
  logChatKeyboardDebug("[composerBottomPx source]", layout.composerBottomPxSource);
  logChatKeyboardDebug("[visualKeyboardTopY]", visualKeyboardTopY);
  logChatKeyboardDebug("[double inset avoided]", layout.doubleInsetAvoided);
}

export function logChatComposerDomLayout(params: {
  composerShellEl: HTMLElement | null;
  inputRowEl: HTMLElement | null;
  nativeKeyboardHeightPx: number;
  visualKeyboardOffsetPx: number;
  composerBottomPxAfterVisualOffset: number;
}): void {
  if (!isChatKeyboardDebugEnabled()) return;
  if (typeof window === "undefined") return;

  const innerHeight = window.innerHeight;
  const nativeKeyboardHeightPx = Math.max(0, params.nativeKeyboardHeightPx);
  const keyboardTopY = innerHeight - nativeKeyboardHeightPx;
  const visualKeyboardTopY =
    innerHeight - Math.max(0, nativeKeyboardHeightPx - params.visualKeyboardOffsetPx);
  const shellRect = params.composerShellEl?.getBoundingClientRect();
  const inputRect = params.inputRowEl?.getBoundingClientRect();
  const shellStyle = params.composerShellEl
    ? getComputedStyle(params.composerShellEl)
    : null;
  const inputRowStyle = params.inputRowEl ? getComputedStyle(params.inputRowEl) : null;
  const composerEl = params.composerShellEl?.querySelector(".chat-composer");
  const composerStyle =
    composerEl instanceof HTMLElement ? getComputedStyle(composerEl) : null;
  const followGroupEl = params.composerShellEl?.querySelector(".chat-keyboard-follow-group");
  const followGroupStyle =
    followGroupEl instanceof HTMLElement ? getComputedStyle(followGroupEl) : null;

  const inputRowRectBottom = inputRect ? Math.round(inputRect.bottom) : null;
  const inputRowToKeyboardGap =
    inputRowRectBottom != null ? Math.round(keyboardTopY - inputRowRectBottom) : null;
  const actualInputToKeyboardVisualGapEstimate =
    inputRowRectBottom != null
      ? Math.round(visualKeyboardTopY - inputRowRectBottom)
      : null;

  logChatKeyboardDebug("[Chat Composer DOM Layout]");
  logChatKeyboardDebug("[keyboardTopY]", Math.round(keyboardTopY));
  logChatKeyboardDebug("[visualKeyboardTopY]", Math.round(visualKeyboardTopY));
  logChatKeyboardDebug("[visualKeyboardOffset]", params.visualKeyboardOffsetPx);
  logChatKeyboardDebug("[composerBottomPxAfterVisualOffset]", params.composerBottomPxAfterVisualOffset);
  logChatKeyboardDebug("[composerShellRect.bottom]", shellRect ? Math.round(shellRect.bottom) : null);
  logChatKeyboardDebug("[inputRowRect.bottom]", inputRowRectBottom);
  logChatKeyboardDebug("[inputRowToKeyboardGap]", inputRowToKeyboardGap);
  logChatKeyboardDebug("[actualInputToKeyboardVisualGapEstimate]", actualInputToKeyboardVisualGapEstimate);
  logChatKeyboardDebug("[shellPaddingBottom]", shellStyle?.paddingBottom ?? null);
  logChatKeyboardDebug("[shellMarginBottom]", shellStyle?.marginBottom ?? null);
  logChatKeyboardDebug("[followGroupPaddingBottom]", followGroupStyle?.paddingBottom ?? null);
  logChatKeyboardDebug("[composerPaddingBottom]", composerStyle?.paddingBottom ?? null);
  logChatKeyboardDebug("[inputRowMarginBottom]", inputRowStyle?.marginBottom ?? null);
  logChatKeyboardDebug("[shellTransform]", shellStyle?.transform ?? null);
  logChatKeyboardDebug("[shellMinHeight]", shellStyle?.minHeight ?? null);
}

/** @deprecated 使用 resolveChatComposerKeyboardLayout */
export function resolveChatComposerOverlayBottom(params: {
  keyboardOpen: boolean;
  reportedKeyboardHeightPx: number;
}): number {
  return resolveChatComposerKeyboardLayout({
    keyboardOpen: params.keyboardOpen,
    nativeKeyboardHeightPx: params.reportedKeyboardHeightPx,
  }).composerBottomPx;
}

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
 * @deprecated 使用 resolveKeyboardOverlayLayout（keyboard-overlay-layout.ts）
 * 保留供舊 log / 漸進遷移；overlay 模式不再把 keyboard 高度加進 flex padding。
 */
export function resolveComposerBottomInset(params: {
  keyboardVisible: boolean;
  reportedKeyboardHeightPx: number;
}): number {
  if (!params.keyboardVisible) return 0;
  const { composerBottomPx, webviewResized, effectiveKeyboardHeightPx } =
    resolveKeyboardOverlayLayout({
      keyboardOpen: params.keyboardVisible,
      reportedKeyboardHeightPx: params.reportedKeyboardHeightPx,
      composerContentHeightPx: 0,
    });
  void webviewResized;
  void effectiveKeyboardHeightPx;
  return composerBottomPx;
}

/** Capacitor config Keyboard.resize — overlay 模式使用 none */
export const CAPACITOR_KEYBOARD_RESIZE_MODE = "none";

export function detectKeyboardDoubleInset(params: {
  keyboardVisible: boolean;
  composerBottomInsetPx: number;
}): boolean {
  if (!params.keyboardVisible) return false;
  const vvInset = measureVisualViewportKeyboardInset();
  return vvInset > 50 && params.composerBottomInsetPx > CHAT_KEYBOARD_GAP_PX + 20;
}

/** App shell 鍵盤診斷 — 聊聊 / 規劃頁共用 */
export function logAppKeyboardLayoutDiagnostics(params: {
  keyboardVisible: boolean;
  keyboardHeightPx: number;
  composerBottomInsetPx?: number;
  routeHint?: string;
}): void {
  if (!isChatKeyboardDebugEnabled()) return;

  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const vvInset = measureVisualViewportKeyboardInset();
  const innerHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const vvHeight = vv != null ? Math.round(vv.height) : null;
  const composerBottomInset =
    params.composerBottomInsetPx ??
    resolveComposerBottomInset({
      keyboardVisible: params.keyboardVisible,
      reportedKeyboardHeightPx: params.keyboardHeightPx,
    });

  const bottomNav = document.querySelector(".bottom-nav");
  const bottomNavEl = bottomNav instanceof HTMLElement ? bottomNav : null;
  const bottomNavStyle = bottomNavEl ? getComputedStyle(bottomNavEl) : null;
  const appScroll = document.querySelector("main.app-scroll");
  const appScrollStyle = appScroll instanceof HTMLElement ? getComputedStyle(appScroll) : null;
  const pageContainer = document.querySelector(".mobile-frame-inner");
  const pageContainerStyle =
    pageContainer instanceof HTMLElement ? getComputedStyle(pageContainer) : null;

  const keyboardClasses = typeof document !== "undefined"
    ? [...document.documentElement.classList].filter((c) => /keyboard/i.test(c))
    : [];

  const doubleInset = detectKeyboardDoubleInset({
    keyboardVisible: params.keyboardVisible,
    composerBottomInsetPx: composerBottomInset,
  });

  logChatKeyboardDebug("[Capacitor Keyboard Resize Mode]", CAPACITOR_KEYBOARD_RESIZE_MODE);
  logChatKeyboardDebug("[visualViewport height]", vvHeight);
  logChatKeyboardDebug("[window.innerHeight]", innerHeight);
  logChatKeyboardDebug("[keyboardHeight]", params.keyboardHeightPx);
  logChatKeyboardDebug("[composerBottomInset]", composerBottomInset);
  logChatKeyboardDebug("[bottomNav visibility]", bottomNavStyle?.visibility ?? "—");
  logChatKeyboardDebug("[bottomNav opacity]", bottomNavStyle?.opacity ?? "—");
  logChatKeyboardDebug(
    "[bottomNav mounted]",
    Boolean(bottomNavEl),
    bottomNavEl ? `rect=${Math.round(bottomNavEl.getBoundingClientRect().top)}px` : "",
  );
  logChatKeyboardDebug("[pageContainer transform]", pageContainerStyle?.transform ?? "none");
  logChatKeyboardDebug("[pageContainer padding]", appScrollStyle?.paddingBottom ?? "—");
  logChatKeyboardDebug("[html keyboard classes]", keyboardClasses.join(", ") || "—");
  logChatKeyboardDebug("[vvInset]", vvInset);
  logChatKeyboardDebug("[double inset detected]", doubleInset);
  if (params.routeHint) {
    logChatKeyboardDebug("[keyboard route]", params.routeHint);
  }
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
  if (!isChatKeyboardDebugEnabled()) return;
  logChatKeyboardDebug("[Chat Keyboard Show]", { height });
}

export function logChatKeyboardHide(): void {
  if (!isChatKeyboardDebugEnabled()) return;
  logChatKeyboardDebug("[Chat Keyboard Hide]");
}

export function logChatComposerRender(): void {
  if (!isChatKeyboardDebugEnabled()) return;
  logChatKeyboardDebug("[ChatComposer Render]");
}

export function logComposerLayoutSnapshot(params: {
  keyboardVisible: boolean;
  reportedKeyboardHeightPx: number;
  composerBottomInsetPx: number;
  headerHeightPx?: number;
}): void {
  if (!isChatKeyboardDebugEnabled()) return;

  const platform = detectPlatform();
  const vvInset = measureVisualViewportKeyboardInset();
  const safeBottom = readSafeAreaBottomPx();
  const tabBar = readTabBarHeightPx();
  const tabBarVisible = !params.keyboardVisible;

  logChatKeyboardDebug("[Keyboard Visible]", params.keyboardVisible);
  logChatKeyboardDebug("[Keyboard Height]", params.reportedKeyboardHeightPx);
  logChatKeyboardDebug("[Keyboard Vertical Offset]", params.headerHeightPx ?? 0);
  logChatKeyboardDebug("[TabBar Visible]", tabBarVisible);
  logChatKeyboardDebug("[SafeArea Bottom]", safeBottom);
  logChatKeyboardDebug("[Composer Bottom Gap]", params.composerBottomInsetPx);

  logAppKeyboardLayoutDiagnostics({
    keyboardVisible: params.keyboardVisible,
    keyboardHeightPx: params.reportedKeyboardHeightPx,
    composerBottomInsetPx: params.composerBottomInsetPx,
    routeHint: "chat",
  });

  const overlayLayout = resolveKeyboardOverlayLayout({
    keyboardOpen: params.keyboardVisible,
    reportedKeyboardHeightPx: params.reportedKeyboardHeightPx,
    composerContentHeightPx: 0,
  });
  logKeyboardOverlayLayout(overlayLayout, "chat");

  logChatKeyboardDebug("[Chat Input Layout Rendered]", {
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
