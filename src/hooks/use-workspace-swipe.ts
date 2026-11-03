import { useEffect, useRef, type CSSProperties } from "react";
import {
  classifySwipeAxis,
  dampedOffset,
  resolveSwipeEnd,
  shouldTrackSwipeStart,
  type SwipeAxis,
} from "@/lib/trip/workspace-swipe";
import { adjacentWorkspaceView, type WorkspaceView } from "@/lib/trip/workspace-view";

/** 拖曳中分頁位移（CSS 變數，由各分頁 pane 的 inline style 讀取；預設 none）。 */
export const WORKSPACE_DRAG_TRANSFORM_VAR = "--trip-ws-transform";
export const WORKSPACE_DRAG_TRANSITION_VAR = "--trip-ws-transition";

/** 分頁 pane 的 inline style：未拖曳時 transform 為 none（不建立 containing block）。 */
export const WORKSPACE_PANE_STYLE: CSSProperties = {
  transform: `var(${WORKSPACE_DRAG_TRANSFORM_VAR}, none)`,
  transition: `var(${WORKSPACE_DRAG_TRANSITION_VAR}, none)`,
};

const SNAP_BACK_TRANSITION = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const VELOCITY_WINDOW_MS = 100;

const OPEN_OVERLAY_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-vaul-drawer][data-state="open"]',
].join(",");

function isOverlayOpen(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector(OPEN_OVERLAY_SELECTOR) != null;
}

function isInputFocused(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function isInsideHorizontalScroller(target: Element | null, boundary: HTMLElement): boolean {
  let el: Element | null = target;
  while (el && el !== boundary) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type Options = {
  /**
   * 監聽手勢與寫入 CSS 變數的容器元素（以元素為值，例如 callback ref 存入 state）。
   * 元素替換（重新掛載）時監聽會解除舊元素、重新綁到新元素。
   */
  container: HTMLElement | null;
  view: WorkspaceView;
  onChange: (next: WorkspaceView) => void;
  enabled?: boolean;
};

type Sample = { x: number; t: number };

/**
 * 分頁左右滑動（Pointer Events，僅觸控／觸控筆）。
 * 停用條件：左緣 24px 內起點、起點在可水平捲動元素或 [data-no-page-swipe] 內、
 * Sheet／對話框／日期選擇器開啟、輸入框聚焦、enabled=false。
 */
export function useWorkspaceSwipe({
  container: containerEl,
  view,
  onChange,
  enabled = true,
}: Options) {
  const viewRef = useRef(view);
  const onChangeRef = useRef(onChange);
  viewRef.current = view;
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerEl;
    if (!container || !enabled) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let axis: SwipeAxis = "pending";
    let lastDx = 0;
    let samples: Sample[] = [];
    let snapTimer: ReturnType<typeof setTimeout> | null = null;

    const setDrag = (offset: number | null, animate: boolean) => {
      if (snapTimer) {
        clearTimeout(snapTimer);
        snapTimer = null;
      }
      if (offset == null) {
        if (animate && !prefersReducedMotion()) {
          container.style.setProperty(WORKSPACE_DRAG_TRANSITION_VAR, SNAP_BACK_TRANSITION);
          container.style.setProperty(WORKSPACE_DRAG_TRANSFORM_VAR, "translate3d(0px, 0, 0)");
          snapTimer = setTimeout(() => {
            container.style.removeProperty(WORKSPACE_DRAG_TRANSFORM_VAR);
            container.style.removeProperty(WORKSPACE_DRAG_TRANSITION_VAR);
            snapTimer = null;
          }, 240);
        } else {
          container.style.removeProperty(WORKSPACE_DRAG_TRANSFORM_VAR);
          container.style.removeProperty(WORKSPACE_DRAG_TRANSITION_VAR);
        }
        return;
      }
      container.style.setProperty(WORKSPACE_DRAG_TRANSITION_VAR, "none");
      container.style.setProperty(WORKSPACE_DRAG_TRANSFORM_VAR, `translate3d(${offset}px, 0, 0)`);
    };

    const suppressNextClick = () => {
      const handler = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", handler, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", handler, { capture: true }), 350);
    };

    const detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const reset = (animate: boolean) => {
      detach();
      pointerId = null;
      axis = "pending";
      samples = [];
      if (lastDx !== 0) setDrag(null, animate);
      lastDx = 0;
    };

    const onDown = (e: PointerEvent) => {
      if (pointerId != null) return;
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const target = e.target instanceof Element ? e.target : null;
      const track = shouldTrackSwipeStart({
        startX: e.clientX,
        insideHorizontalScroller: isInsideHorizontalScroller(target, container),
        insideNoSwipe: Boolean(target?.closest("[data-no-page-swipe]")),
        overlayOpen: isOverlayOpen(),
        inputFocused: isInputFocused(),
      });
      if (!track) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      axis = "pending";
      lastDx = 0;
      samples = [{ x: e.clientX, t: e.timeStamp }];
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (axis === "pending") {
        axis = classifySwipeAxis(dx, dy);
        if (axis === "vertical") {
          reset(false);
          return;
        }
        if (axis === "pending") return;
      }
      samples.push({ x: e.clientX, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
      const current = viewRef.current;
      const offset = dampedOffset(dx, container.clientWidth || window.innerWidth, {
        canGoNext: adjacentWorkspaceView(current, "next") != null,
        canGoPrev: adjacentWorkspaceView(current, "prev") != null,
      });
      lastDx = dx;
      setDrag(offset, false);
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (axis !== "horizontal") {
        reset(false);
        return;
      }
      const dx = e.clientX - startX;
      const first = samples[0];
      const dt = first ? e.timeStamp - first.t : 0;
      const velocity = first && dt > 0 ? (e.clientX - first.x) / dt : 0;
      const current = viewRef.current;
      const dir = resolveSwipeEnd({
        dx,
        velocity,
        canGoNext: adjacentWorkspaceView(current, "next") != null,
        canGoPrev: adjacentWorkspaceView(current, "prev") != null,
      });
      suppressNextClick();
      if (dir) {
        const next = adjacentWorkspaceView(current, dir);
        reset(false);
        if (next) onChangeRef.current(next);
        return;
      }
      reset(true);
    };

    const onCancel = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      reset(true);
    };

    container.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      container.removeEventListener("pointerdown", onDown);
      detach();
      if (snapTimer) clearTimeout(snapTimer);
      container.style.removeProperty(WORKSPACE_DRAG_TRANSFORM_VAR);
      container.style.removeProperty(WORKSPACE_DRAG_TRANSITION_VAR);
    };
  }, [containerEl, enabled]);
}
