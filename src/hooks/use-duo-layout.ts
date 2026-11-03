import { useSyncExternalStore } from "react";
import { resolveDuoLayout, type DuoLayout } from "@/lib/layout/duo-layout";

/**
 * iPhone Duo 版型：讀取 viewport 寬高與實際 safe-area inset，回傳 resolveDuoLayout 的結果。
 *
 * - safe-area 以隱藏量測元素（padding: env(safe-area-inset-*)）的 computed padding 讀取，不寫死數值。
 * - 監聽 resize／orientationchange（開合會觸發 resize）；orientationchange 後 env() 可能晚一幀更新，再量一次。
 * - 全站共用一個量測元素與一組監聽（module-level store）；結果不變時回傳同一物件，不觸發 re-render。
 * - SSR／無 window 時回傳 bottom＋single。
 */

const SERVER_LAYOUT: DuoLayout = { navPlacement: "bottom", tripLayout: "single", usableWidth: 0 };

let current: DuoLayout = SERVER_LAYOUT;
let probe: HTMLDivElement | null = null;
const listeners = new Set<() => void>();
let rafId: number | null = null;

function ensureProbe(): HTMLDivElement | null {
  if (typeof document === "undefined" || !document.body) return null;
  if (probe && probe.isConnected) return probe;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top,0px)",
    "padding-right:env(safe-area-inset-right,0px)",
    "padding-bottom:env(safe-area-inset-bottom,0px)",
    "padding-left:env(safe-area-inset-left,0px)",
  ].join(";");
  document.body.appendChild(el);
  probe = el;
  return el;
}

/**
 * 只有 navPlacement、tripLayout、（rail 時的）pane 改變才視為新版型；usableWidth 不參與比對。
 * 非 rail 時 pane 不被任何畫面使用，一般裝置寬度改變（旋轉、iPad 分割畫面）不觸發 re-render；
 * 此時回傳的舊物件 usableWidth／pane 可能不是最新值（呼叫端不得在非 rail 時依賴這兩個欄位）。
 */
function sameLayout(a: DuoLayout, b: DuoLayout): boolean {
  if (a.navPlacement !== b.navPlacement) return false;
  if (a.tripLayout !== b.tripLayout) return false;
  if (a.navPlacement !== "right-rail") return true;
  if (!a.pane || !b.pane) return a.pane === b.pane;
  return (
    a.pane.leftWidth === b.pane.leftWidth &&
    a.pane.rightWidth === b.pane.rightWidth &&
    a.pane.gutter === b.pane.gutter &&
    a.pane.foldX === b.pane.foldX
  );
}

function measure(): DuoLayout {
  if (typeof window === "undefined") return SERVER_LAYOUT;
  const el = ensureProbe();
  const cs = el ? getComputedStyle(el) : null;
  const next = resolveDuoLayout({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    safeTop: cs ? parseFloat(cs.paddingTop) : 0,
    safeRight: cs ? parseFloat(cs.paddingRight) : 0,
    safeBottom: cs ? parseFloat(cs.paddingBottom) : 0,
    safeLeft: cs ? parseFloat(cs.paddingLeft) : 0,
  });
  return sameLayout(current, next) ? current : next;
}

function update() {
  const next = measure();
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

function handleViewportChange() {
  update();
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = null;
    update();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    update();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("orientationchange", handleViewportChange);
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

function getSnapshot(): DuoLayout {
  if (listeners.size === 0) current = measure();
  return current;
}

function getServerSnapshot(): DuoLayout {
  return SERVER_LAYOUT;
}

export function useDuoLayout(): DuoLayout {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
