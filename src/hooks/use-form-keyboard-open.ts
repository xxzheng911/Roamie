import { useEffect } from "react";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";
import {
  isCapacitorNativeShell,
  measureVisualViewportKeyboardInset,
} from "@/lib/chat-keyboard-layout";

const KEYBOARD_OPEN_THRESHOLD_PX = 80;

/** 表單頁：鍵盤展開時加 html class，配合 CSS 隱藏 Tab Bar、移除 main 底部 padding */
export function useFormKeyboardOpen(htmlClass: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;

    let keyboardOpen = false;

    const apply = (open: boolean) => {
      if (keyboardOpen === open) return;
      keyboardOpen = open;
      document.documentElement.classList.toggle(htmlClass, open);
    };

    const syncFromViewport = () => {
      if (isCapacitorNativeShell()) return;
      const inset = measureVisualViewportKeyboardInset();
      apply(inset >= KEYBOARD_OPEN_THRESHOLD_PX);
    };

    const removeCap = subscribeCapacitorKeyboard({
      onShow: () => apply(true),
      onHide: () => apply(false),
    });

    const vv = window.visualViewport;
    vv?.addEventListener("resize", syncFromViewport);
    vv?.addEventListener("scroll", syncFromViewport);
    syncFromViewport();

    return () => {
      removeCap();
      vv?.removeEventListener("resize", syncFromViewport);
      vv?.removeEventListener("scroll", syncFromViewport);
      document.documentElement.classList.remove(htmlClass);
    };
  }, [htmlClass]);
}
