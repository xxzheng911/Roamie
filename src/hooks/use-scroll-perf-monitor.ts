import { useEffect, type RefObject } from "react";
import { logPerfScroll } from "@/lib/app-perf";

const FRAME_BUDGET_MS = 16.67;
const SCROLL_IDLE_MS = 180;
const FPS_DROP_LOG_THRESHOLD = 2;

function resolveScrollRoot(ref?: RefObject<HTMLElement | null>): HTMLElement | null {
  if (ref?.current instanceof HTMLElement) return ref.current;
  const main = document.querySelector("main.app-scroll");
  return main instanceof HTMLElement ? main : null;
}

/** 被動監測 scroll 期間掉幀與 long task，僅在異常時輸出 [PERF_SCROLL] */
export function useScrollPerfMonitor(
  page: string,
  scrollRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!page) return;

    const el = resolveScrollRoot(scrollRef);
    if (!el) return;

    let rafId = 0;
    let lastFrame = performance.now();
    let frameDrops = 0;
    let scrolling = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      scrolling = false;
      if (frameDrops >= FPS_DROP_LOG_THRESHOLD) {
        logPerfScroll(page, { fpsDrop: frameDrops });
      }
      frameDrops = 0;
    };

    const onScroll = () => {
      scrolling = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, SCROLL_IDLE_MS);
    };

    const tick = (now: number) => {
      if (scrolling) {
        const delta = now - lastFrame;
        if (delta > FRAME_BUDGET_MS * 2) {
          frameDrops += Math.max(0, Math.round(delta / FRAME_BUDGET_MS) - 1);
        }
        lastFrame = now;
      }
      rafId = requestAnimationFrame(tick);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    rafId = requestAnimationFrame(tick);

    let longTaskObserver: PerformanceObserver | undefined;
    if (typeof PerformanceObserver !== "undefined") {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          if (!scrolling) return;
          for (const entry of list.getEntries()) {
            if (entry.duration >= 50) {
              logPerfScroll(page, { longTaskMs: Math.round(entry.duration) });
            }
          }
        });
        longTaskObserver.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
      } catch {
        /* Safari may not support longtask */
      }
    }

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (idleTimer) clearTimeout(idleTimer);
      cancelAnimationFrame(rafId);
      longTaskObserver?.disconnect();
    };
  }, [page, scrollRef]);
}
