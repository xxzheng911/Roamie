import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";
import { isCapacitorNativeShell, measureVisualViewportKeyboardInset } from "@/lib/chat-keyboard-layout";
import {
  APP_KEYBOARD_OPEN_CLASS,
  logKeyboardOverlayLayout,
  resolveKeyboardOverlayLayout,
  scrollFocusedInputAboveKeyboard,
  setAppKeyboardOpen,
  type KeyboardOverlayLayout,
} from "@/lib/keyboard-overlay-layout";

const KEYBOARD_OPEN_THRESHOLD_PX = 50;

export type UseKeyboardOverlayOptions = {
  /** 頁面專用 class，例如 chat-keyboard-open / plan-keyboard-open */
  pageClass?: string;
  routeHint?: string;
};

const CLOSED_LAYOUT: KeyboardOverlayLayout = {
  keyboardOpen: false,
  webviewResized: false,
  reportedKeyboardHeightPx: 0,
  effectiveKeyboardHeightPx: 0,
  composerBottomPx: 0,
  messagesBottomSpacerPx: 0,
  safeAreaBottomPx: 0,
};

export function useKeyboardOverlay(options: UseKeyboardOverlayOptions = {}) {
  const { pageClass, routeHint } = options;
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [reportedKeyboardHeightPx, setReportedKeyboardHeightPx] = useState(0);
  const keyboardOpenRef = useRef(false);
  const reportedHeightRef = useRef(0);

  const applyKeyboardState = useCallback(
    (open: boolean, heightPx: number) => {
      if (keyboardOpenRef.current === open && reportedHeightRef.current === heightPx) {
        return;
      }
      keyboardOpenRef.current = open;
      reportedHeightRef.current = heightPx;
      setKeyboardOpen(open);
      setReportedKeyboardHeightPx(heightPx);

      setAppKeyboardOpen(open);
      if (pageClass) {
        document.documentElement.classList.toggle(pageClass, open);
      }

      const layout = resolveKeyboardOverlayLayout({
        keyboardOpen: open,
        reportedKeyboardHeightPx: heightPx,
        composerContentHeightPx: 0,
      });
      logKeyboardOverlayLayout(layout, routeHint);
    },
    [pageClass, routeHint],
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isNative = isCapacitorNativeShell();

    const syncFromViewport = () => {
      if (isNative) return;
      const inset = measureVisualViewportKeyboardInset();
      if (inset >= KEYBOARD_OPEN_THRESHOLD_PX) {
        applyKeyboardState(true, inset);
      } else if (keyboardOpenRef.current) {
        applyKeyboardState(false, 0);
      }
    };

    const removeCap = subscribeCapacitorKeyboard({
      onShow: (height) => applyKeyboardState(true, height),
      onHide: () => applyKeyboardState(false, 0),
    });

    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncFromViewport);
    vv?.addEventListener("scroll", syncFromViewport);
    syncFromViewport();

    return () => {
      removeCap();
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      document.documentElement.classList.remove(APP_KEYBOARD_OPEN_CLASS);
      if (pageClass) {
        document.documentElement.classList.remove(pageClass);
      }
    };
  }, [applyKeyboardState, pageClass]);

  const resolveLayout = useCallback(
    (composerContentHeightPx: number): KeyboardOverlayLayout => {
      if (!keyboardOpen) return CLOSED_LAYOUT;
      return resolveKeyboardOverlayLayout({
        keyboardOpen,
        reportedKeyboardHeightPx,
        composerContentHeightPx,
      });
    },
    [keyboardOpen, reportedKeyboardHeightPx],
  );

  const scrollInputAboveKeyboard = useCallback(
    (element: HTMLElement, composerContentHeightPx = 0) => {
      const layout = resolveKeyboardOverlayLayout({
        keyboardOpen: keyboardOpenRef.current,
        reportedKeyboardHeightPx: reportedHeightRef.current,
        composerContentHeightPx,
      });
      requestAnimationFrame(() => scrollFocusedInputAboveKeyboard(element, layout));
    },
    [],
  );

  return {
    keyboardOpen,
    reportedKeyboardHeightPx,
    resolveLayout,
    scrollInputAboveKeyboard,
  };
}
