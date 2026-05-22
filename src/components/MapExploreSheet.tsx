import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { isMapDetailOpen, type MapExploreSheetMode } from "@/lib/map-explore-sheet-mode";

/** 收起約 28% 頁高（為地圖 attribution 留出底部安全區）· 展開依內容（上限 70dvh） */
const COLLAPSED_FRACTION = 0.28;
const EXPANDED_MAX = "70dvh";
const SPRING_TRANSITION = "height 0.48s cubic-bezier(0.33, 1.1, 0.68, 1)";

const MIN_SHEET_PX = 200;
const DRAG_EXPAND_RATIO = 0.22;
const DRAG_START_THRESHOLD_PX = 8;
const DETAIL_SHEET_FRACTION = 0.82;
const DETAIL_PEEK_FRACTION = 0.38;

export type MapSheetCollapseTarget = "min" | "peek";

export type MapExploreSheetHandle = {
  collapse: (target: MapSheetCollapseTarget) => void;
  expand: () => void;
};

type Props = {
  header: ReactNode;
  children: ReactNode;
  sheetMode?: MapExploreSheetMode;
};

type DragSession = {
  startY: number;
  startX: number;
  startH: number;
  pointerId: number;
  mode: "pending" | "sheet" | "scroll";
};

function isInteractiveDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(
    "button, a, input, textarea, select, [data-no-sheet-drag], [data-sheet-chips-scroll], [data-sheet-cards-scroll]",
  );
}

function isSheetDragHandle(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("[data-sheet-drag-handle]");
}

function pointerHasPrimaryButton(e: PointerEvent): boolean {
  return (e.buttons & 1) === 1;
}

export const MapExploreSheet = forwardRef<MapExploreSheetHandle, Props>(function MapExploreSheet(
  { header, children, sheetMode = "list" },
  ref,
) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerWrapRef = useRef<HTMLDivElement>(null);
  const bodyInnerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const dragHeightPxRef = useRef<number | null>(null);

  const [pageH, setPageH] = useState(0);
  const [open, setOpen] = useState(false);
  const [expandedH, setExpandedH] = useState(MIN_SHEET_PX);
  const [isDragging, setIsDragging] = useState(false);
  const [dragHeightPx, setDragHeightPx] = useState<number | null>(null);
  const [collapsedOverride, setCollapsedOverride] = useState<MapSheetCollapseTarget | null>(null);

  const collapsedH = useMemo(() => {
    if (pageH <= 0) return MIN_SHEET_PX;
    return Math.max(MIN_SHEET_PX, Math.round(pageH * COLLAPSED_FRACTION));
  }, [pageH]);

  const maxH = useMemo(() => {
    const fraction = isMapDetailOpen(sheetMode) ? 0.88 : 0.7;
    if (typeof window === "undefined") return Math.round(pageH * fraction);
    return Math.min(Math.round(pageH * fraction), Math.round(window.innerHeight * fraction));
  }, [pageH, sheetMode]);

  const measurePage = useCallback(() => {
    const page = sheetRef.current?.closest(".map-page");
    if (!page) return;
    const h = page.clientHeight;
    if (h > 0) setPageH(h);
  }, []);

  const measureExpanded = useCallback(() => {
    const headerEl = headerWrapRef.current;
    const bodyEl = bodyInnerRef.current;
    if (!headerEl || !bodyEl) return maxH;
    const natural = headerEl.offsetHeight + bodyEl.offsetHeight + 4;
    return Math.min(maxH, Math.max(collapsedH + 32, natural));
  }, [collapsedH, maxH]);

  useLayoutEffect(() => {
    setExpandedH(measureExpanded());
  }, [measureExpanded, children, header, pageH]);

  useEffect(() => {
    measurePage();
    const page = sheetRef.current?.closest(".map-page");
    if (!page) return;
    const ro = new ResizeObserver(() => {
      measurePage();
      setExpandedH(measureExpanded());
    });
    ro.observe(page);
    if (bodyInnerRef.current) ro.observe(bodyInnerRef.current);
    return () => ro.disconnect();
  }, [measurePage, measureExpanded]);

  const detailH = useMemo(() => {
    if (pageH <= 0) return maxH;
    return Math.min(maxH, Math.max(collapsedH + 80, Math.round(pageH * DETAIL_SHEET_FRACTION)));
  }, [pageH, maxH, collapsedH]);

  const peekH = useMemo(() => {
    if (pageH <= 0) return collapsedH + 48;
    return Math.min(
      detailH - 24,
      Math.max(collapsedH + 48, Math.round(pageH * DETAIL_PEEK_FRACTION)),
    );
  }, [pageH, collapsedH, detailH]);

  const detailOpen = isMapDetailOpen(sheetMode);

  const dragMinH = detailOpen ? peekH : collapsedH;
  const dragMaxH = detailOpen ? detailH : expandedH;

  const committedHeight = useMemo(() => {
    if (detailOpen) return collapsedOverride === "peek" ? peekH : detailH;
    if (collapsedOverride === "min") return collapsedH;
    return open ? expandedH : collapsedH;
  }, [detailOpen, collapsedOverride, peekH, detailH, open, expandedH, collapsedH]);

  useEffect(() => {
    setCollapsedOverride(null);
  }, [sheetMode]);

  useImperativeHandle(
    ref,
    () => ({
      collapse(target) {
        setCollapsedOverride(target);
        setDragHeightPx(null);
        setIsDragging(false);
        dragRef.current = null;
        if (target === "min") {
          setOpen(false);
        } else {
          setOpen(true);
        }
      },
      expand() {
        setCollapsedOverride(null);
        setDragHeightPx(null);
        setIsDragging(false);
        dragRef.current = null;
        setOpen(true);
      },
    }),
    [],
  );

  const resolveOpenFromHeight = useCallback(
    (h: number, dy: number) => {
      const travel = expandedH - collapsedH;
      if (travel <= 0) return open;
      if (dy > 24) return true;
      if (dy < -24) return false;
      return h >= collapsedH + travel * DRAG_EXPAND_RATIO;
    },
    [collapsedH, expandedH, open],
  );

  const snapTo = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) setCollapsedOverride(null);
      setOpen(nextOpen);
    },
    [],
  );

  const clearDragSession = useCallback(() => {
    dragRef.current = null;
    dragHeightPxRef.current = null;
    setIsDragging(false);
    setDragHeightPx(null);
  }, []);

  const finishDrag = useCallback(
    (finalHeight: number, totalDy: number) => {
      setDragHeightPx(null);
      setIsDragging(false);
      dragRef.current = null;

      if (detailOpen) {
        const expandDetail = finalHeight >= peekH + (detailH - peekH) * 0.45 || totalDy > 20;
        setCollapsedOverride(expandDetail ? null : "peek");
        setOpen(true);
        return;
      }
      snapTo(resolveOpenFromHeight(finalHeight, totalDy));
    },
    [detailOpen, detailH, peekH, resolveOpenFromHeight, snapTo],
  );

  const onWindowPointerMove = useCallback(
    (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      if (!pointerHasPrimaryButton(e)) {
        clearDragSession();
        return;
      }

      const dy = session.startY - e.clientY;
      const dx = e.clientX - session.startX;

      if (session.mode === "pending") {
        if (Math.abs(dy) < DRAG_START_THRESHOLD_PX && Math.abs(dx) < DRAG_START_THRESHOLD_PX) {
          return;
        }
        const onHorizontalScroll = (e.target as HTMLElement | null)?.closest?.(
          "[data-sheet-chips-scroll], [data-sheet-cards-scroll]",
        );
        if (onHorizontalScroll && Math.abs(dx) > Math.abs(dy)) {
          dragRef.current = { ...session, mode: "scroll" };
          return;
        }
        dragRef.current = { ...session, mode: "sheet" };
        setIsDragging(true);
        try {
          handleRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }

      if (dragRef.current?.mode !== "sheet") return;

      e.preventDefault();
      const nextH = Math.min(dragMaxH, Math.max(dragMinH, session.startH + dy));
      dragHeightPxRef.current = nextH;
      setDragHeightPx(nextH);
    },
    [clearDragSession, dragMaxH, dragMinH],
  );

  const onWindowPointerUp = useCallback(
    (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session || session.pointerId !== e.pointerId) return;

      try {
        handleRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      if (session.mode === "sheet") {
        const finalH = dragHeightPxRef.current ?? session.startH;
        finishDrag(finalH, session.startY - e.clientY);
      } else {
        clearDragSession();
      }
    },
    [clearDragSession, finishDrag],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => onWindowPointerMove(e);
    const onUp = (e: PointerEvent) => onWindowPointerUp(e);
    const onCancel = (e: PointerEvent) => onWindowPointerUp(e);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [onWindowPointerMove, onWindowPointerUp]);

  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !isSheetDragHandle(e.target) || isInteractiveDragTarget(e.target)) {
      return;
    }
    e.stopPropagation();

    const currentH = sheetRef.current?.getBoundingClientRect().height ?? committedHeight;
    dragRef.current = {
      startY: e.clientY,
      startX: e.clientX,
      startH: currentH,
      pointerId: e.pointerId,
      mode: "pending",
    };
  };

  const resolvedH = isDragging && dragHeightPx != null ? dragHeightPx : committedHeight;

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-label="推薦地點"
      aria-expanded={open || detailOpen}
      data-map-explore-sheet="true"
      data-map-sheet-dragging={isDragging ? "true" : undefined}
      className={cn(
        "pointer-events-auto relative z-40 flex w-full shrink-0 flex-col overflow-hidden rounded-t-[2rem] border-t border-border bg-cream shadow-lift",
        "isolate",
      )}
      style={{
        height: resolvedH,
        maxHeight: EXPANDED_MAX,
        transition: isDragging ? "none" : SPRING_TRANSITION,
        backgroundColor: "var(--cream)",
      }}
    >
      <div
        ref={headerWrapRef}
        className="min-w-0 shrink-0 overflow-visible bg-cream"
        style={{ backgroundColor: "var(--cream)" }}
      >
        <div
          ref={handleRef}
          data-sheet-drag-handle
          className={cn(
            "cursor-grab select-none bg-cream",
            isDragging && "cursor-grabbing",
          )}
          style={{
            touchAction: "none",
            backgroundColor: "var(--cream)",
          }}
          onPointerDown={onHandlePointerDown}
        >
          <div className="flex justify-center bg-cream py-2.5" aria-hidden>
            <span className="block h-1 w-11 rounded-full bg-muted-foreground/40" />
          </div>
        </div>
        <div className="min-w-0 w-full overflow-visible bg-cream">{header}</div>
      </div>

      <div
        className={cn(
          "min-h-0 min-w-0 bg-cream",
          detailOpen || open
            ? "flex-1 overflow-y-auto overscroll-contain"
            : "shrink-0 overflow-x-visible overflow-y-hidden",
        )}
        style={{ WebkitOverflowScrolling: "touch", backgroundColor: "var(--cream)" }}
      >
        <div
          ref={bodyInnerRef}
          className="min-w-0 w-full overflow-x-visible bg-cream pb-4"
          style={{ backgroundColor: "var(--cream)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
});

export function MapExploreSheetFallback(props: Props) {
  return <MapExploreSheet {...props} />;
}
