import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";
import {
  isCapacitorNativeShell,
  measureVisualViewportKeyboardInset,
  readSafeAreaBottomPx,
  readTabBarHeightPx,
} from "@/lib/chat-keyboard-layout";

const NEAR_BOTTOM_THRESHOLD_PX = 96;
const KEYBOARD_OPEN_THRESHOLD_PX = 50;
const COMPOSER_HEIGHT_FALLBACK_PX = 120;
const CHAT_KEYBOARD_OPEN_CLASS = "chat-keyboard-open";

export type MessengerScrollReason =
  | "new_message"
  | "ai_reply_complete"
  | "keyboard_did_show"
  | "keyboard_did_hide"
  | "user_near_bottom";

export type MessengerChatLayoutMetrics = {
  viewportHeightPx: number;
  headerHeightPx: number;
  composerHeightPx: number;
  bottomNavHeightPx: number;
  safeAreaBottomPx: number;
  bottomNavTotalPx: number;
  nativeKeyboardHeightPx: number;
  visualViewportInsetPx: number;
  messagesPaddingBottomPx: number;
  keyboardOpen: boolean;
  composerBottomPx: number;
};

function isNearBottom(el: HTMLElement, thresholdPx = NEAR_BOTTOM_THRESHOLD_PX): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx;
}

function isTextInputFocused(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLTextAreaElement ||
    active instanceof HTMLInputElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
}

function readBottomNavLayout(): {
  bottomNavHeightPx: number;
  safeAreaBottomPx: number;
  bottomNavTotalPx: number;
} {
  const safeAreaBottomPx = readSafeAreaBottomPx();
  const measuredTotal = readTabBarHeightPx();
  if (measuredTotal > 0) {
    const bottomNavHeightPx = Math.max(0, measuredTotal - safeAreaBottomPx);
    return {
      bottomNavHeightPx,
      safeAreaBottomPx,
      bottomNavTotalPx: measuredTotal,
    };
  }

  if (typeof document === "undefined") {
    return { bottomNavHeightPx: 68, safeAreaBottomPx: 0, bottomNavTotalPx: 68 };
  }

  const root = getComputedStyle(document.documentElement);
  const bottomNavHeightPx = Math.round(
    parseFloat(root.getPropertyValue("--bottom-nav-height")) || 68,
  );
  return {
    bottomNavHeightPx,
    safeAreaBottomPx,
    bottomNavTotalPx: bottomNavHeightPx + safeAreaBottomPx,
  };
}

function measureComposerHeight(composerRoot: HTMLElement | null): number {
  if (!composerRoot) return 0;

  const inner = composerRoot.querySelector(".chat-composer");
  const targets = [
    inner instanceof HTMLElement ? inner : null,
    composerRoot,
  ].filter(Boolean) as HTMLElement[];

  for (const el of targets) {
    const rectH = Math.round(el.getBoundingClientRect().height);
    const offsetH = Math.round(el.offsetHeight);
    const h = Math.max(rectH, offsetH);
    if (h > 0) return h;
  }

  return 0;
}

function resolveKeyboardOpen(
  nativeKeyboardHeightPx: number,
  visualViewportInsetPx: number,
): boolean {
  if (nativeKeyboardHeightPx > KEYBOARD_OPEN_THRESHOLD_PX) return true;
  if (isCapacitorNativeShell()) return false;
  return visualViewportInsetPx > KEYBOARD_OPEN_THRESHOLD_PX;
}

export function useMessengerChatLayout(params: {
  headerRef: RefObject<HTMLElement | null>;
  composerRef: RefObject<HTMLElement | null>;
  messagesRef: RefObject<HTMLElement | null>;
  bottomAnchorRef: RefObject<HTMLElement | null>;
}) {
  const { headerRef, composerRef, messagesRef, bottomAnchorRef } = params;

  const nativeKeyboardHeightRef = useRef(0);
  const hideClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastComposerHeightRef = useRef(COMPOSER_HEIGHT_FALLBACK_PX);

  const initialNav = readBottomNavLayout();
  const [metrics, setMetrics] = useState<MessengerChatLayoutMetrics>(() => ({
    viewportHeightPx: 0,
    headerHeightPx: 0,
    composerHeightPx: COMPOSER_HEIGHT_FALLBACK_PX,
    bottomNavHeightPx: initialNav.bottomNavHeightPx,
    safeAreaBottomPx: initialNav.safeAreaBottomPx,
    bottomNavTotalPx: initialNav.bottomNavTotalPx,
    nativeKeyboardHeightPx: 0,
    visualViewportInsetPx: 0,
    messagesPaddingBottomPx:
      COMPOSER_HEIGHT_FALLBACK_PX + initialNav.bottomNavTotalPx,
    keyboardOpen: false,
    composerBottomPx: initialNav.bottomNavTotalPx,
  }));

  const userNearBottomRef = useRef(true);
  const prevKeyboardOpenRef = useRef(false);
  const lastScrollLogRef = useRef("");
  const lastLayoutLogRef = useRef("");
  const scrollToBottomRafRef = useRef<number | null>(null);

  const applyKeyboardDomState = useCallback((keyboardOpen: boolean) => {
    document.documentElement.classList.toggle(CHAT_KEYBOARD_OPEN_CLASS, keyboardOpen);
    document.documentElement.classList.toggle("app-keyboard-open", keyboardOpen);
  }, []);

  const recomputeLayout = useCallback(() => {
    const headerEl = headerRef.current;
    if (!headerEl) return;

    const headerHeightPx = Math.round(headerEl.getBoundingClientRect().height);
    const measuredComposerHeight = measureComposerHeight(composerRef.current);
    let composerHeightPx = measuredComposerHeight;
    if (composerHeightPx <= 0) {
      composerHeightPx = lastComposerHeightRef.current || COMPOSER_HEIGHT_FALLBACK_PX;
    } else {
      lastComposerHeightRef.current = composerHeightPx;
    }

    const { bottomNavHeightPx, safeAreaBottomPx, bottomNavTotalPx } = readBottomNavLayout();
    const visualViewportInsetPx = measureVisualViewportKeyboardInset();
    const nativeKeyboardHeightPx = nativeKeyboardHeightRef.current;
    const keyboardOpen = resolveKeyboardOpen(nativeKeyboardHeightPx, visualViewportInsetPx);

    applyKeyboardDomState(keyboardOpen);

    const composerBottomPx = keyboardOpen
      ? nativeKeyboardHeightPx
      : bottomNavHeightPx + safeAreaBottomPx;

    const messagesPaddingBottomPx = keyboardOpen
      ? composerHeightPx + nativeKeyboardHeightPx
      : composerHeightPx + bottomNavHeightPx + safeAreaBottomPx;

    const viewportHeightPx =
      typeof window !== "undefined" && window.visualViewport
        ? Math.round(window.visualViewport.height)
        : typeof window !== "undefined"
          ? window.innerHeight
          : 0;

    setMetrics((prev) => {
      if (
        prev.viewportHeightPx === viewportHeightPx &&
        prev.headerHeightPx === headerHeightPx &&
        prev.composerHeightPx === composerHeightPx &&
        prev.bottomNavHeightPx === bottomNavHeightPx &&
        prev.safeAreaBottomPx === safeAreaBottomPx &&
        prev.bottomNavTotalPx === bottomNavTotalPx &&
        prev.nativeKeyboardHeightPx === nativeKeyboardHeightPx &&
        prev.visualViewportInsetPx === visualViewportInsetPx &&
        prev.messagesPaddingBottomPx === messagesPaddingBottomPx &&
        prev.keyboardOpen === keyboardOpen &&
        prev.composerBottomPx === composerBottomPx
      ) {
        return prev;
      }
      return {
        viewportHeightPx,
        headerHeightPx,
        composerHeightPx,
        bottomNavHeightPx,
        safeAreaBottomPx,
        bottomNavTotalPx,
        nativeKeyboardHeightPx,
        visualViewportInsetPx,
        messagesPaddingBottomPx,
        keyboardOpen,
        composerBottomPx,
      };
    });
  }, [applyKeyboardDomState, composerRef, headerRef]);

  const setNativeKeyboardHeight = useCallback(
    (heightPx: number) => {
      if (hideClearTimerRef.current) {
        clearTimeout(hideClearTimerRef.current);
        hideClearTimerRef.current = null;
      }
      nativeKeyboardHeightRef.current = Math.max(0, Math.round(heightPx));
      recomputeLayout();
    },
    [recomputeLayout],
  );

  const clearNativeKeyboardHeight = useCallback(() => {
    if (hideClearTimerRef.current) {
      clearTimeout(hideClearTimerRef.current);
    }
    hideClearTimerRef.current = setTimeout(() => {
      hideClearTimerRef.current = null;
      if (isTextInputFocused()) {
        recomputeLayout();
        return;
      }
      nativeKeyboardHeightRef.current = 0;
      recomputeLayout();
    }, 80);
  }, [recomputeLayout]);

  const setNativeKeyboardHeightRef = useRef(setNativeKeyboardHeight);
  setNativeKeyboardHeightRef.current = setNativeKeyboardHeight;
  const clearNativeKeyboardHeightRef = useRef(clearNativeKeyboardHeight);
  clearNativeKeyboardHeightRef.current = clearNativeKeyboardHeight;
  const recomputeLayoutRef = useRef(recomputeLayout);
  recomputeLayoutRef.current = recomputeLayout;

  const scrollToBottom = useCallback(
    (reason: MessengerScrollReason, opts?: { force?: boolean }) => {
      const messagesEl = messagesRef.current;
      const anchorEl = bottomAnchorRef.current;
      if (!messagesEl || !anchorEl) return;

      const nearBottom = isNearBottom(messagesEl);
      userNearBottomRef.current = nearBottom;

      const shouldScroll =
        opts?.force === true ||
        reason === "new_message" ||
        (nearBottom &&
          (reason === "ai_reply_complete" ||
            reason === "keyboard_did_show" ||
            reason === "keyboard_did_hide" ||
            reason === "user_near_bottom"));

      const logKey = `${reason}:${nearBottom}:${shouldScroll}`;
      if (lastScrollLogRef.current !== logKey) {
        lastScrollLogRef.current = logKey;
        console.info("[CHAT_AUTO_SCROLL_REASON]", reason);
        console.info("[CHAT_USER_IS_NEAR_BOTTOM]", nearBottom);
      }

      if (!shouldScroll) return;

      if (scrollToBottomRafRef.current != null) return;
      scrollToBottomRafRef.current = requestAnimationFrame(() => {
        scrollToBottomRafRef.current = null;
        anchorEl.scrollIntoView({ block: "end", behavior: "auto" });
      });
    },
    [bottomAnchorRef, messagesRef],
  );

  useLayoutEffect(() => {
    recomputeLayout();
  }, [recomputeLayout]);

  useEffect(() => {
    const onLayoutChange = () => {
      recomputeLayoutRef.current();
    };

    const roTargets = [
      headerRef.current,
      composerRef.current,
      composerRef.current?.querySelector(".chat-composer"),
      document.querySelector(".bottom-nav"),
    ].filter(Boolean) as HTMLElement[];
    const ro = new ResizeObserver(onLayoutChange);
    for (const el of roTargets) ro.observe(el);

    const vv = window.visualViewport;
    vv?.addEventListener("resize", onLayoutChange);
    vv?.addEventListener("scroll", onLayoutChange);
    window.addEventListener("resize", onLayoutChange);

    const removeCap = subscribeCapacitorKeyboard({
      onShow: (keyboardHeight) => {
        console.info(
          "[MESSENGER_KEYBOARD_SHOW]",
          `nativeKeyboardHeight=${Math.round(keyboardHeight)}`,
        );
        setNativeKeyboardHeightRef.current(keyboardHeight);
      },
      onHide: () => {
        console.info("[MESSENGER_KEYBOARD_HIDE]");
        clearNativeKeyboardHeightRef.current();
      },
    });

    return () => {
      if (hideClearTimerRef.current) {
        clearTimeout(hideClearTimerRef.current);
      }
      ro.disconnect();
      vv?.removeEventListener("resize", onLayoutChange);
      vv?.removeEventListener("scroll", onLayoutChange);
      window.removeEventListener("resize", onLayoutChange);
      removeCap();
      document.documentElement.classList.remove(CHAT_KEYBOARD_OPEN_CLASS);
      document.documentElement.classList.remove("app-keyboard-open");
    };
    // Mount once; refs forward latest layout/keyboard handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const messagesEl = messagesRef.current;
    if (!messagesEl) return;
    const onScroll = () => {
      userNearBottomRef.current = isNearBottom(messagesEl);
    };
    messagesEl.addEventListener("scroll", onScroll, { passive: true });
    return () => messagesEl.removeEventListener("scroll", onScroll);
  }, [messagesRef]);

  useEffect(() => {
    const open = metrics.keyboardOpen;
    const wasOpen = prevKeyboardOpenRef.current;
    if (open && !wasOpen) {
      scrollToBottom("keyboard_did_show");
    } else if (!open && wasOpen) {
      scrollToBottom("keyboard_did_hide");
    }
    prevKeyboardOpenRef.current = open;
  }, [metrics.keyboardOpen, scrollToBottom]);

  useEffect(() => {
    if (!metrics.keyboardOpen) return;
    scrollToBottom("keyboard_did_show");
  }, [metrics.messagesPaddingBottomPx, metrics.composerBottomPx, metrics.keyboardOpen, scrollToBottom]);

  useEffect(() => {
    if (!document.documentElement.classList.contains("chat-route-active")) return;
    const payload = JSON.stringify({
      viewportHeight: metrics.viewportHeightPx,
      header: metrics.headerHeightPx,
      composer: metrics.composerHeightPx,
      bottomNav: metrics.bottomNavHeightPx,
      safeAreaBottom: metrics.safeAreaBottomPx,
      nativeKeyboardHeight: metrics.nativeKeyboardHeightPx,
      visualViewportInset: metrics.visualViewportInsetPx,
      messagesPaddingBottom: metrics.messagesPaddingBottomPx,
      keyboardOpen: metrics.keyboardOpen,
      composerBottom: metrics.composerBottomPx,
    });
    if (lastLayoutLogRef.current === payload) return;
    lastLayoutLogRef.current = payload;
    console.info("[MESSENGER_CHAT_LAYOUT]", payload);
  }, [metrics]);

  return {
    metrics,
    scrollToBottom,
    userNearBottomRef,
    recomputeLayout,
  };
}
