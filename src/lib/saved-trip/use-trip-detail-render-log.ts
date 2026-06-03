import { useEffect, useRef } from "react";
import { logTripDetailRender } from "@/lib/trip/trip-detail-log";

type DepSnapshot = Record<string, string | number | boolean | null | undefined>;

function snapDeps(values: DepSnapshot): string {
  return JSON.stringify(values);
}

/**
 * 開發用：追蹤 SavedTripItineraryEditor 哪個依賴在變導致 rerender。
 * 僅在 changedDeps 非空時 log。
 */
export function useTripDetailRenderLog(tripId: string, deps: DepSnapshot): void {
  const renderCountRef = useRef(0);
  const prevSnapRef = useRef<string | null>(null);

  renderCountRef.current += 1;

  useEffect(() => {
    const snap = snapDeps(deps);
    const prev = prevSnapRef.current;
    prevSnapRef.current = snap;

    if (prev == null) return;

    const changedDeps: string[] = [];
    for (const key of Object.keys(deps)) {
      const prevVal = JSON.parse(prev)[key];
      const nextVal = deps[key];
      if (prevVal !== nextVal) changedDeps.push(key);
    }

    if (changedDeps.length === 0) return;

    logTripDetailRender({
      tripId,
      renderCount: renderCountRef.current,
      changedDeps,
    });
  });
}
