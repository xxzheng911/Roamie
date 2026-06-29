import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";

const MAP_LAYOUT_HEIGHT_VAR = "--map-layout-height";
let layoutHeightPx = 0;
let activeSearchFocusCount = 0;
let mapKeyboardPrepared = false;

/** 進入探索地圖前量測可用高度，鍵盤展開時鎖定版面 */
export function captureMapLayoutHeight(): number {
  const frame = document.querySelector(".mobile-frame-inner");
  const main = document.querySelector("main.app-scroll");
  const h = Math.round(
    main instanceof HTMLElement && main.clientHeight > 0
      ? main.clientHeight
      : frame instanceof HTMLElement && frame.clientHeight > 0
        ? frame.clientHeight
        : window.innerHeight,
  );
  if (h <= 0) return 0;
  layoutHeightPx = h;
  document.documentElement.style.setProperty(MAP_LAYOUT_HEIGHT_VAR, `${h}px`);
  return h;
}

export function releaseMapLayoutHeight(): void {
  layoutHeightPx = 0;
  document.documentElement.style.removeProperty(MAP_LAYOUT_HEIGHT_VAR);
}

async function applyNativeKeyboardLayout(frozen: boolean): Promise<void> {
  if (!isCapacitorNativeShell()) return;
  try {
    const { Keyboard, KeyboardResize } = await import("@capacitor/keyboard");
    await Keyboard.setResizeMode({
      mode: KeyboardResize.None,
    });
    await Keyboard.setScroll({ isDisabled: frozen });
  } catch (e) {
    console.warn("[MAP_KEYBOARD] native layout failed", e instanceof Error ? e.message : e);
  }
}

/** 進入探索地圖：一次性設定 KeyboardResize.None，避免 focus/blur 反覆呼叫 native API */
export async function prepareMapPageKeyboard(): Promise<void> {
  if (mapKeyboardPrepared) return;
  mapKeyboardPrepared = true;
  if (layoutHeightPx <= 0) captureMapLayoutHeight();
  await applyNativeKeyboardLayout(true);
}

/** 離開探索地圖：還原 native resize */
export async function releaseMapPageKeyboard(): Promise<void> {
  if (!mapKeyboardPrepared) return;
  mapKeyboardPrepared = false;
  activeSearchFocusCount = 0;
  document.documentElement.classList.remove("map-keyboard-open");
  await applyNativeKeyboardLayout(false);
  releaseMapLayoutHeight();
}

/** 探索地圖搜尋欄 focus：僅切換 CSS class，不呼叫 Capacitor Keyboard API */
export function enterMapSearchKeyboardMode(): void {
  if (activeSearchFocusCount === 0) {
    if (layoutHeightPx <= 0) captureMapLayoutHeight();
    document.documentElement.classList.add("map-keyboard-open");
  }
  activeSearchFocusCount += 1;
}

/** 探索地圖搜尋欄 blur：僅移除 CSS class */
export function exitMapSearchKeyboardMode(): void {
  activeSearchFocusCount = Math.max(0, activeSearchFocusCount - 1);
  if (activeSearchFocusCount > 0) return;
  document.documentElement.classList.remove("map-keyboard-open");
}

export function resetMapSearchKeyboardMode(): void {
  activeSearchFocusCount = 0;
  document.documentElement.classList.remove("map-keyboard-open");
}
