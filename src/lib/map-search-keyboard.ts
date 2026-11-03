import { isCapacitorNativeShell } from "@/lib/capacitor-native-shell";
import { subscribeCapacitorKeyboard } from "@/lib/capacitor-keyboard-bridge";

const MAP_LAYOUT_HEIGHT_VAR = "--map-layout-height";
let layoutHeightPx = 0;
let activeSearchFocusCount = 0;
let mapKeyboardPrepared = false;

/**
 * iPhone Duo 上下版型（html.duo-laptop／html.duo-flat-portrait，由 _app 設定）：鍵盤開合時暫時加上
 * duo-map-kb-anim，styles.css 只在此 class 存在時對搜尋列＋面板整塊的位置做 transition（約 0.25s）。
 * 只在開合當下加上、結束後移除：姿勢切換、進出地點詳情等其他版面變化不會被動畫。
 * 其他裝置（無上述 class）與 prefers-reduced-motion 時不加 class（直接切換）。
 */
const DUO_KB_ANIM_CLASS = "duo-map-kb-anim";
const DUO_KB_ANIM_MS = 400;
let duoKbAnimTimer: ReturnType<typeof setTimeout> | null = null;

function clearDuoKeyboardAnim(): void {
  if (duoKbAnimTimer != null) clearTimeout(duoKbAnimTimer);
  duoKbAnimTimer = null;
  document.documentElement.classList.remove(DUO_KB_ANIM_CLASS);
}

function markDuoKeyboardAnim(): void {
  const cl = document.documentElement.classList;
  if (!cl.contains("duo-laptop") && !cl.contains("duo-flat-portrait")) return;
  // 地點詳情一頁式（duo-map-detail-page，_app.map.tsx）期間不加：進出詳情不得有動畫。
  if (
    cl.contains("duo-map-detail-page") ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    clearDuoKeyboardAnim();
    return;
  }
  if (duoKbAnimTimer != null) clearTimeout(duoKbAnimTimer);
  cl.add(DUO_KB_ANIM_CLASS);
  duoKbAnimTimer = setTimeout(() => {
    duoKbAnimTimer = null;
    cl.remove(DUO_KB_ANIM_CLASS);
  }, DUO_KB_ANIM_MS);
}

/**
 * iPhone Duo 上下版型（html.duo-laptop／html.duo-flat-portrait）：鍵盤展開時把鍵盤上緣（相對 .map-page 上緣，px）
 * 寫入 <html> 的 --duo-map-keyboard-top，styles.css 用它決定搜尋列＋面板整塊的下緣。
 * 鍵盤高度沿用 capacitor-keyboard-bridge 既有的 Keyboard 事件（不新增原生程式）；拿不到（web、事件未到）時不設定，
 * CSS 退回摺痕／中線。只在上述版型、搜尋聚焦期間訂閱；其他裝置不訂閱、不寫入任何樣式。
 * 寫入值即整塊下緣（筆電與直向攤平相同，不上限於摺痕）；聚焦期間離開上述版型時立即清除、回到時依最近的鍵盤高度重寫。
 */
const DUO_KB_TOP_VAR = "--duo-map-keyboard-top";
let duoKbUnsubscribe: (() => void) | null = null;
let duoKbClassObserver: MutationObserver | null = null;
let duoKbLastHeight = 0;

function isDuoStackedLayout(): boolean {
  const cl = document.documentElement.classList;
  return cl.contains("duo-laptop") || cl.contains("duo-flat-portrait");
}

function removeDuoKeyboardTopVar(): void {
  const style = document.documentElement.style;
  if (style.getPropertyValue(DUO_KB_TOP_VAR)) style.removeProperty(DUO_KB_TOP_VAR);
}

/** 鍵盤收起：忘記鍵盤高度並移除變數 */
function clearDuoKeyboardTop(): void {
  duoKbLastHeight = 0;
  removeDuoKeyboardTopVar();
}

function stopDuoKeyboardTop(): void {
  if (duoKbClassObserver) duoKbClassObserver.disconnect();
  duoKbClassObserver = null;
  if (duoKbUnsubscribe) duoKbUnsubscribe();
  duoKbUnsubscribe = null;
  clearDuoKeyboardTop();
}

/** 依最近一次鍵盤高度寫入 --duo-map-keyboard-top；沒有高度或非上述版型時只移除變數（保留高度） */
function applyDuoKeyboardTop(): void {
  if (!(duoKbLastHeight > 0) || !isDuoStackedLayout()) {
    removeDuoKeyboardTopVar();
    return;
  }
  const page = document.querySelector(".map-page");
  const pageTop = page instanceof HTMLElement ? page.getBoundingClientRect().top : 0;
  // 只寫入鍵盤上緣（floor：不往下取整）；筆電與直向攤平皆直接以此為整塊下緣（#H3-3 起筆電不再取 min(摺痕上緣, …)）。
  const top = Math.floor(window.innerHeight - duoKbLastHeight - pageTop);
  if (!(top > 0)) {
    removeDuoKeyboardTopVar();
    return;
  }
  const style = document.documentElement.style;
  if (style.getPropertyValue(DUO_KB_TOP_VAR) !== `${top}px`)
    style.setProperty(DUO_KB_TOP_VAR, `${top}px`);
}

/** 聚焦期間 html class 改變：進入上述版型時才訂閱鍵盤，並依最近的鍵盤高度寫入／移除變數 */
function syncDuoKeyboardTop(): void {
  if (!duoKbUnsubscribe && isDuoStackedLayout()) subscribeDuoKeyboardTop();
  if (duoKbUnsubscribe) applyDuoKeyboardTop();
}

function startDuoKeyboardTop(): void {
  if (duoKbUnsubscribe || duoKbClassObserver) return;
  const cl = document.documentElement.classList;
  // 只在 Duo 裝置（_app 設定的 duo-device）或已在上述版型時監看；一般 iPhone 等其他裝置不掛 observer、不訂閱。
  if (!cl.contains("duo-device") && !isDuoStackedLayout()) return;
  duoKbLastHeight = 0;
  // 聚焦期間姿勢改變（含合起時聚焦後攤平）：observer 只監看 class，不寫樣式；進入筆電／直向攤平時才訂閱鍵盤並寫入變數，
  // 離開（例如合起）時立即移除變數，回到時依最近的鍵盤高度重寫；筆電↔直向攤平由 _app 在同一次 commit 直接互換 class。
  // 鍵盤訂閱維持到失焦（穩定期間的鍵盤收起事件仍需接收）。
  if (typeof MutationObserver === "function") {
    duoKbClassObserver = new MutationObserver(syncDuoKeyboardTop);
    duoKbClassObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  if (isDuoStackedLayout()) subscribeDuoKeyboardTop();
}

function subscribeDuoKeyboardTop(): void {
  duoKbUnsubscribe = subscribeCapacitorKeyboard({
    onShow: (keyboardHeight) => {
      duoKbLastHeight = keyboardHeight > 0 ? keyboardHeight : 0;
      applyDuoKeyboardTop();
    },
    onHide: clearDuoKeyboardTop,
  });
}

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
  clearDuoKeyboardAnim();
  stopDuoKeyboardTop();
  document.documentElement.classList.remove("map-keyboard-open");
  await applyNativeKeyboardLayout(false);
  releaseMapLayoutHeight();
}

/** 探索地圖搜尋欄 focus：僅切換 CSS class，不呼叫 Capacitor Keyboard API */
export function enterMapSearchKeyboardMode(): void {
  if (activeSearchFocusCount === 0) {
    if (layoutHeightPx <= 0) captureMapLayoutHeight();
    markDuoKeyboardAnim();
    startDuoKeyboardTop();
    document.documentElement.classList.add("map-keyboard-open");
  }
  activeSearchFocusCount += 1;
}

/** 探索地圖搜尋欄 blur：僅移除 CSS class */
export function exitMapSearchKeyboardMode(): void {
  activeSearchFocusCount = Math.max(0, activeSearchFocusCount - 1);
  if (activeSearchFocusCount > 0) return;
  if (document.documentElement.classList.contains("map-keyboard-open")) markDuoKeyboardAnim();
  stopDuoKeyboardTop();
  document.documentElement.classList.remove("map-keyboard-open");
}

export function resetMapSearchKeyboardMode(): void {
  activeSearchFocusCount = 0;
  clearDuoKeyboardAnim();
  stopDuoKeyboardTop();
  document.documentElement.classList.remove("map-keyboard-open");
}
