import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { subscribeChatKeyboardLayout } from "@/lib/chat-keyboard-listeners";
import {
  estimateNativeKeyboardHeight,
  measureVisualViewportKeyboardInset,
  readSafeAreaBottomPx,
  readTabBarHeightPx,
} from "@/lib/chat-keyboard-layout";

/** 鍵盤關閉時輸入列離底最小距離（Tab Bar 已隱藏，僅保留 safe area） */
const ADD_PLACE_KEYBOARD_CLOSED_BOTTOM_PX = 0;

/** 鍵盤開啟且 WebView 已被 visualViewport 推高時，離 layout 底的最大留白 */
const ADD_PLACE_VIEWPORT_RESIZED_GAP_PX = 8;

export type AddPlaceBottomStrategy = "keyboard_height_only" | "viewport_resized";

export function logAddPlaceInputFocused(): void {
  console.info("[ADD_PLACE_INPUT_FOCUSED]");
}

export function logAddPlaceKeyboardVisible(open: boolean, height: number): void {
  console.info("[ADD_PLACE_KEYBOARD_VISIBLE]", { open, height });
}

export function logAddPlaceInputBottomUpdated(params: {
  keyboardHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  vvInset: number;
  strategy: AddPlaceBottomStrategy;
  finalBottom: number;
}): void {
  console.info("[ADD_PLACE_INPUT_BOTTOM_UPDATED]", params);
}

export function logAddPlaceInputLayoutDebug(params: {
  keyboardHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  finalBottom: number;
  containerMarginBottom: number;
  containerPaddingBottom: number;
  visualGapPx: number;
}): void {
  console.info("[ADD_PLACE_INPUT_LAYOUT_DEBUG]", params);
}

export function logAddPlaceKeyboardListenerAttached(): void {
  console.info("[ADD_PLACE_KEYBOARD_LISTENER_ATTACHED]");
}

export function logAddPlaceKeyboardListenerRemoved(): void {
  console.info("[ADD_PLACE_KEYBOARD_LISTENER_REMOVED]");
}

/**
 * 新增地點輸入：鍵盤開啟時 bottom = keyboardHeight（不疊 tabBar / safeArea / 額外 gap）。
 * WebView 已被 visualViewport 推高時僅留 0～8px。
 */
export function resolveAddPlaceInputBottomPx(params: {
  keyboardVisible: boolean;
  keyboardHeightPx: number;
  vvInsetPx: number;
}): {
  keyboardHeight: number;
  safeAreaBottom: number;
  tabBarHeight: number;
  vvInset: number;
  strategy: AddPlaceBottomStrategy;
  finalBottom: number;
} {
  const safeAreaBottom = readSafeAreaBottomPx();
  const tabBarHeight = readTabBarHeightPx();
  const vvInset = Math.max(0, Math.round(params.vvInsetPx));
  const reported = Math.max(0, Math.round(params.keyboardHeightPx));
  const keyboardHeight =
    reported > 50 ? reported : params.keyboardVisible ? estimateNativeKeyboardHeight() : 0;

  if (!params.keyboardVisible) {
    return {
      keyboardHeight: 0,
      safeAreaBottom,
      tabBarHeight,
      vvInset,
      strategy: "keyboard_height_only",
      finalBottom: Math.max(ADD_PLACE_KEYBOARD_CLOSED_BOTTOM_PX, safeAreaBottom),
    };
  }

  if (vvInset > 50) {
    return {
      keyboardHeight,
      safeAreaBottom,
      tabBarHeight,
      vvInset,
      strategy: "viewport_resized",
      finalBottom: ADD_PLACE_VIEWPORT_RESIZED_GAP_PX,
    };
  }

  return {
    keyboardHeight,
    safeAreaBottom,
    tabBarHeight,
    vvInset,
    strategy: "keyboard_height_only",
    finalBottom: keyboardHeight,
  };
}

/** 量測輸入容器底緣與鍵盤上緣的視覺距離（px） */
export function measureAddPlaceVisualGapPx(
  composerEl: HTMLElement | null,
  keyboardHeightPx: number,
): number {
  if (typeof window === "undefined" || !composerEl || keyboardHeightPx <= 0) return 0;
  const rect = composerEl.getBoundingClientRect();
  const layoutBottom = window.visualViewport?.height ?? window.innerHeight;
  const keyboardTop = layoutBottom - keyboardHeightPx;
  return Math.max(0, Math.round(keyboardTop - rect.bottom));
}

/** 自行輸入地點：共用聊聊頁鍵盤單例，不重複 Keyboard.addListener */
export function useAddPlaceKeyboardLayout(
  enabled: boolean,
  composerRef?: RefObject<HTMLElement | null>,
) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeightPx, setKeyboardHeightPx] = useState(0);
  const [vvInsetPx, setVvInsetPx] = useState(0);
  const layoutRef = useRef({ visible: false, height: 0 });

  const syncVisualViewportInset = useCallback(() => {
    setVvInsetPx(measureVisualViewportKeyboardInset());
  }, []);

  const layoutMetrics = useMemo(
    () =>
      resolveAddPlaceInputBottomPx({
        keyboardVisible: enabled && keyboardVisible,
        keyboardHeightPx,
        vvInsetPx,
      }),
    [enabled, keyboardVisible, keyboardHeightPx, vvInsetPx],
  );

  const inputBottomPx = layoutMetrics.finalBottom;

  const layoutLogRef = useRef("");
  useEffect(() => {
    if (!enabled) return;
    const key = `${keyboardVisible}|${keyboardHeightPx}|${vvInsetPx}|${inputBottomPx}|${layoutMetrics.strategy}`;
    if (layoutLogRef.current === key) return;
    layoutLogRef.current = key;
    logAddPlaceInputBottomUpdated({
      keyboardHeight: layoutMetrics.keyboardHeight,
      safeAreaBottom: layoutMetrics.safeAreaBottom,
      tabBarHeight: layoutMetrics.tabBarHeight,
      vvInset: layoutMetrics.vvInset,
      strategy: layoutMetrics.strategy,
      finalBottom: layoutMetrics.finalBottom,
    });
  }, [
    enabled,
    keyboardVisible,
    keyboardHeightPx,
    vvInsetPx,
    inputBottomPx,
    layoutMetrics,
  ]);

  const debugLayout = useCallback(() => {
    if (!enabled) return;
    const el = composerRef?.current ?? null;
    const style = el ? window.getComputedStyle(el) : null;
    const marginBottom = style ? parseFloat(style.marginBottom) || 0 : 0;
    const paddingBottom = style ? parseFloat(style.paddingBottom) || 0 : 0;
    const visualGapPx = measureAddPlaceVisualGapPx(el, layoutMetrics.keyboardHeight);
    logAddPlaceInputLayoutDebug({
      keyboardHeight: layoutMetrics.keyboardHeight,
      safeAreaBottom: layoutMetrics.safeAreaBottom,
      tabBarHeight: layoutMetrics.tabBarHeight,
      finalBottom: layoutMetrics.finalBottom,
      containerMarginBottom: marginBottom,
      containerPaddingBottom: paddingBottom,
      visualGapPx,
    });
  }, [enabled, composerRef, layoutMetrics]);

  useEffect(() => {
    if (!enabled || !keyboardVisible) return;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(debugLayout);
    });
    return () => cancelAnimationFrame(raf);
  }, [enabled, keyboardVisible, inputBottomPx, debugLayout]);

  const applyKeyboard = useCallback(
    (reportedHeight: number, open: boolean) => {
      const roundedHeight = Math.max(0, Math.round(reportedHeight));
      const prev = layoutRef.current;
      if (prev.visible === open && prev.height === roundedHeight) {
        syncVisualViewportInset();
        return;
      }
      layoutRef.current = { visible: open, height: roundedHeight };
      logAddPlaceKeyboardVisible(open, roundedHeight);
      setKeyboardVisible((v) => (v === open ? v : open));
      setKeyboardHeightPx((h) => (h === roundedHeight ? h : roundedHeight));
      if (open) {
        syncVisualViewportInset();
        requestAnimationFrame(() => {
          syncVisualViewportInset();
          requestAnimationFrame(syncVisualViewportInset);
        });
      } else {
        setVvInsetPx(0);
      }
    },
    [syncVisualViewportInset],
  );

  useEffect(() => {
    if (!enabled) return;
    logAddPlaceKeyboardListenerAttached();
    const unsubscribe = subscribeChatKeyboardLayout(({ height, open }) => {
      applyKeyboard(height, open);
    });
    return () => {
      unsubscribe();
      logAddPlaceKeyboardListenerRemoved();
    };
  }, [enabled, applyKeyboard]);

  useEffect(() => {
    if (!enabled) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const onVvChange = () => {
      if (!layoutRef.current.visible) return;
      syncVisualViewportInset();
    };

    vv.addEventListener("resize", onVvChange);
    vv.addEventListener("scroll", onVvChange);
    return () => {
      vv.removeEventListener("resize", onVvChange);
      vv.removeEventListener("scroll", onVvChange);
    };
  }, [enabled, syncVisualViewportInset]);

  const notifyInputFocused = useCallback(() => {
    logAddPlaceInputFocused();
    syncVisualViewportInset();
    requestAnimationFrame(() => {
      syncVisualViewportInset();
      requestAnimationFrame(debugLayout);
    });
  }, [syncVisualViewportInset, debugLayout]);

  const keyboardOpen = enabled && keyboardVisible;
  const composerPaddingBottomPx = keyboardOpen ? 0 : Math.max(0, layoutMetrics.safeAreaBottom);

  return {
    keyboardVisible,
    keyboardHeightPx,
    inputBottomPx,
    composerPaddingBottomPx,
    notifyInputFocused,
    debugLayout,
  };
}
