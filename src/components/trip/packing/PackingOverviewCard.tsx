import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Luggage } from "lucide-react";
import type { Locale } from "@/lib/i18n/types";
import { formatTripWorkspaceTemplate, getTripPackingCopy } from "@/lib/i18n/trip-workspace-copy";
import {
  loadTripPacking,
  peekTripPacking,
  subscribeTripPackingCache,
  tripPackingLoadedAt,
} from "@/lib/trip/trip-packing";
import { markTripPackingFromOverview } from "@/components/trip/expenses/expenses-return";
import {
  computePackingProgress,
  packingProgressPercent,
  visiblePackingItems,
} from "./packing-model";

/** 總覽卡重新讀取的最短間隔（與行李頁回前景相同：同一行程 30 秒內最多一次） */
const OVERVIEW_REFETCH_MS = 30_000;
/** 同一行程進行中的總覽讀取（避免重複掛載時重送） */
const overviewInflight = new Map<string, Promise<boolean>>();
/** 同一行程總覽讀取最近一次失敗的時間（失敗也計入 30 秒節流） */
const overviewFailedAt = new Map<string, number>();

function overviewRecentlyFailed(tripId: string): boolean {
  const at = overviewFailedAt.get(tripId);
  return at != null && Date.now() - at < OVERVIEW_REFETCH_MS;
}

type Props = {
  tripId: string;
  locale: Locale;
};

/** 行程總覽的「我的行李」卡：自己的打包進度條與「13 / 23 已打包」，點擊進入行李頁。 */
export function PackingOverviewCard({ tripId, locale }: Props) {
  const copy = getTripPackingCopy(locale);
  const navigate = useNavigate();
  const data = useSyncExternalStore(
    subscribeTripPackingCache,
    () => peekTripPacking(tripId),
    () => peekTripPacking(tripId),
  );

  const [failedTripId, setFailedTripId] = useState<string | null>(() =>
    overviewRecentlyFailed(tripId) ? tripId : null,
  );

  // 快取有資料先顯示；同一行程 30 秒內（含行李頁的讀取、含失敗）不重讀；失敗不自動重試
  useEffect(() => {
    let active = true;
    const loadedAt = tripPackingLoadedAt(tripId);
    if (
      peekTripPacking(tripId) != null &&
      loadedAt != null &&
      Date.now() - loadedAt < OVERVIEW_REFETCH_MS
    ) {
      return;
    }
    if (!overviewInflight.has(tripId) && overviewRecentlyFailed(tripId)) {
      setFailedTripId(tripId);
      return;
    }
    let p = overviewInflight.get(tripId);
    if (!p) {
      p = loadTripPacking(tripId).then(
        () => {
          overviewFailedAt.delete(tripId);
          return true;
        },
        (e) => {
          console.warn("[TRIP_PACKING] overview load failed", e);
          overviewFailedAt.set(tripId, Date.now());
          return false;
        },
      );
      const q = p;
      overviewInflight.set(tripId, q);
      void q.finally(() => {
        if (overviewInflight.get(tripId) === q) overviewInflight.delete(tripId);
      });
    }
    void p.then((ok) => {
      if (active) setFailedTripId(ok ? null : tripId);
    });
    return () => {
      active = false;
    };
  }, [tripId]);
  const failed = failedTripId === tripId;

  const progress = useMemo(
    () => (data ? computePackingProgress(visiblePackingItems(data.items, data.categories)) : null),
    [data],
  );

  const open = () => {
    markTripPackingFromOverview(tripId);
    void navigate({ to: "/saved/$tripId/packing", params: { tripId } });
  };

  return (
    <button
      type="button"
      onClick={open}
      className="block w-full rounded-2xl border border-border bg-card px-4 py-3 text-left transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Luggage className="h-4 w-4 text-muted-foreground" />
          {copy.title}
        </span>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {copy.overviewCta}
        </span>
      </div>
      {progress == null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {failed ? copy.overviewLoadFailed : copy.overviewLoading}
        </p>
      ) : progress.total > 0 ? (
        <div className="mt-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.checked}
            aria-label={copy.title}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150"
              style={{ width: `${packingProgressPercent(progress)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
            {formatTripWorkspaceTemplate(copy.overviewProgress, {
              checked: progress.checked,
              total: progress.total,
            })}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{copy.overviewEmpty}</p>
      )}
    </button>
  );
}
