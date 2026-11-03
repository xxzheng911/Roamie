import { useEffect, useRef, useState } from "react";

const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;

/**
 * 簡易下拉更新：在捲動容器頂端往下拉超過門檻後放開 → onRefresh。
 * 監聽皆為 passive，不攔截原生捲動；Sheet 等 portal 內的觸控不在容器內，不受影響。
 */
export function usePullToRefresh(
  getContainer: () => HTMLElement | null,
  onRefresh: () => void,
  enabled: boolean,
): number {
  const [pull, setPull] = useState(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const getContainerRef = useRef(getContainer);
  getContainerRef.current = getContainer;

  useEffect(() => {
    if (!enabled) return;
    const el = getContainerRef.current();
    if (!el) return;
    let startY: number | null = null;
    let current = 0;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || el.scrollTop > 0) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      if (el.scrollTop > 0) {
        startY = null;
        current = 0;
        setPull(0);
        return;
      }
      const dy = e.touches[0].clientY - startY;
      current = dy > 0 ? Math.min(MAX_PULL_PX, dy * 0.5) : 0;
      setPull(current);
    };
    const onEnd = () => {
      if (startY != null && current >= TRIGGER_PX * 0.75) onRefreshRef.current();
      startY = null;
      current = 0;
      setPull(0);
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return pull;
}

export const PULL_TO_REFRESH_TRIGGER_PX = TRIGGER_PX * 0.75;
