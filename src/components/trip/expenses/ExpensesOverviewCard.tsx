import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import type { Locale } from "@/lib/i18n/types";
import {
  formatTripWorkspaceCount,
  formatTripWorkspaceTemplate,
  getTripExpensesCopy,
} from "@/lib/i18n/trip-workspace-copy";
import {
  listTripExpenses,
  peekTripExpenses,
  subscribeTripExpensesCache,
  tripExpensesLoadedAt,
} from "@/lib/trip/trip-expenses";
import { safeFormatMoney, summarizeByCurrency } from "./expense-model";
import { markTripExpensesFromOverview } from "./expenses-return";

/** 總覽卡重新讀取的最短間隔（與記帳頁回前景相同：同一行程 30 秒內最多一次） */
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

/** 行程總覽的「共同記帳」卡：第一個幣別總額＋「另 N 種幣別 · M 筆」，點擊進入記帳頁。 */
export function ExpensesOverviewCard({ tripId, locale }: Props) {
  const copy = getTripExpensesCopy(locale);
  const navigate = useNavigate();
  const expenses = useSyncExternalStore(
    subscribeTripExpensesCache,
    () => peekTripExpenses(tripId),
    () => peekTripExpenses(tripId),
  );

  const [failedTripId, setFailedTripId] = useState<string | null>(() =>
    overviewRecentlyFailed(tripId) ? tripId : null,
  );

  // 快取有資料先顯示；同一行程 30 秒內（含記帳頁的讀取、含失敗）不重讀；失敗不自動重試
  useEffect(() => {
    let active = true;
    const loadedAt = tripExpensesLoadedAt(tripId);
    if (
      peekTripExpenses(tripId) != null &&
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
      p = listTripExpenses(tripId).then(
        () => {
          overviewFailedAt.delete(tripId);
          return true;
        },
        (e) => {
          console.warn("[TRIP_EXPENSES] overview load failed", e);
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

  const summaries = useMemo(
    () => (expenses ? summarizeByCurrency(expenses, null).filter((s) => s.expenseCount > 0) : []),
    [expenses],
  );
  const expenseCount = summaries.reduce((n, s) => n + s.expenseCount, 0);
  const first = summaries[0];

  const open = () => {
    markTripExpensesFromOverview(tripId);
    void navigate({ to: "/saved/$tripId/expenses", params: { tripId } });
  };

  return (
    <button
      type="button"
      onClick={open}
      className="block w-full rounded-2xl border border-border bg-card px-4 py-3 text-left transition active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          {copy.title}
        </span>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {copy.overviewCta}
        </span>
      </div>
      {expenses == null ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {failed ? copy.overviewLoadFailed : copy.overviewLoading}
        </p>
      ) : first ? (
        <div className="mt-2">
          <p className="truncate text-lg font-semibold text-foreground tabular-nums">
            {safeFormatMoney(
              first.totalMinor,
              first.currency,
              first.exponent,
              locale,
              summaries.length > 1,
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summaries.length > 1
              ? formatTripWorkspaceTemplate(copy.overviewMore, {
                  n: summaries.length - 1,
                  m: expenseCount,
                })
              : formatTripWorkspaceCount(copy.overviewCount, expenseCount, copy.overviewCountOne)}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{copy.overviewEmpty}</p>
      )}
    </button>
  );
}
