import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowRight, ChevronLeft, Loader2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useI18n } from "@/hooks/use-i18n";
import { getAuthenticatedUserId, readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import { formatTripWorkspaceTemplate, getTripExpensesCopy } from "@/lib/i18n/trip-workspace-copy";
import { shouldShowCurrencyCode } from "@/lib/money/money-format";
import {
  computeSettlements,
  type CurrencySettlement,
  type SuggestedTransfer,
} from "@/lib/money/settle";
import { normalizeUserId } from "@/lib/money/split";
import { collaboratorInitial } from "@/lib/trip/collab-member-display";
import { listTripMembers, type TripMemberRow } from "@/lib/trip/trip-collab";
import {
  deleteTripExpense,
  listTripExpenses,
  newClientRequestId,
  peekTripExpenses,
  restoreTripExpense,
  subscribeTripExpensesCache,
  tripExpenseErrorCode,
  upsertTripExpense,
  type TripExpense,
  type TripExpenseErrorCode,
} from "@/lib/trip/trip-expenses";
import { cn } from "@/lib/utils";
import { ExpenseSheet } from "./ExpenseSheet";
import { SettlePanel } from "./SettlePanel";
import {
  buildPeopleResolver,
  defaultExpenseCurrency,
  expenseErrorMessage,
  formatExpenseDate,
  formatNetLabel,
  personLabel,
  safeFormatMoney,
  summarizeByCurrency,
  todayDateKey,
  transferKey,
  usedCurrencies,
} from "./expense-model";
import {
  clearTripExpensesFromOverview,
  markTripExpensesBackToOverview,
  readTripExpensesFromOverview,
} from "./expenses-return";
import { PULL_TO_REFRESH_TRIGGER_PX, usePullToRefresh } from "./use-pull-to-refresh";

/** 回到前景時重新讀取的最短間隔（同頁 30 秒內最多一次） */
const FOREGROUND_REFETCH_MS = 30_000;
const UNDO_TOAST_MS = 6_000;
const TITLE_MAX = 80;
// 標題列吸頂時蓋住狀態列：main.app-scroll 有 padding-top（狀態列高度），sticky 會停在 padding 下緣，
// 捲動內容因而從 padding 區（狀態列）露出。以負 top 停在捲動容器最上緣，並以負 margin＋同量 padding
// 把不透明背景延伸到狀態列；Duo 雙欄時 main 的 padding 為 --duo-app-top，取同一來源。
const TRIP_SUBPAGE_TOP_INSET = "var(--duo-app-top, var(--safe-area-top, 0px))";
const TRIP_SUBPAGE_HEADER_STYLE = {
  top: `calc(-1 * ${TRIP_SUBPAGE_TOP_INSET})`,
  marginTop: `calc(-1 * ${TRIP_SUBPAGE_TOP_INSET})`,
  paddingTop: `calc(${TRIP_SUBPAGE_TOP_INSET} + 0.625rem)`,
};

type Tab = "expenses" | "settle";

type SheetState = {
  open: boolean;
  session: number;
  expenseId: string | null;
  formKey: number;
  conflictNotice: boolean;
};

const CLOSED_SHEET: SheetState = {
  open: false,
  session: 0,
  expenseId: null,
  formKey: 0,
  conflictNotice: false,
};

function clampTitle(text: string): string {
  return Array.from(text.trim()).slice(0, TITLE_MAX).join("") || "-";
}

type Props = { tripId: string };

export function TripExpensesScreen({ tripId }: Props) {
  const { locale } = useI18n();
  const copy = getTripExpensesCopy(locale);
  const navigate = useNavigate();
  const router = useRouter();

  const cached = useSyncExternalStore(
    subscribeTripExpensesCache,
    () => peekTripExpenses(tripId),
    () => peekTripExpenses(tripId),
  );
  const [loadError, setLoadError] = useState<TripExpenseErrorCode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 已刪除、等待讀取結果反映的花費：id → 刪除完成當下已發出的最後讀取序號
  // （只有序號更大的讀取——即刪除之後才發出的讀取——回來時才清除）
  const [hiddenIds, setHiddenIds] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [members, setMembers] = useState<TripMemberRow[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  // 記帳頁掛載時讀取「從總覽進入」標記並立即消費（記在 state）
  const [fromOverview] = useState(() => readTripExpensesFromOverview(tripId));
  const [meId, setMeId] = useState<string | null>(() => readCachedAuthenticatedUserIdSync());
  const [tab, setTab] = useState<Tab>("expenses");
  const [sheet, setSheet] = useState<SheetState>(CLOSED_SHEET);
  const [deleting, setDeleting] = useState(false);
  const [marking, setMarking] = useState<ReadonlySet<string>>(() => new Set());
  const markRequestIdsRef = useRef(new Map<string, string>());
  const inflightRef = useRef<{ seq: number; promise: Promise<TripExpense[] | null> } | null>(null);
  const loadSeqRef = useRef(0);
  const lastForegroundFetchRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const lastSheetExpenseRef = useRef<TripExpense | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 消費「從總覽進入」標記；離開時（返回鍵、系統返回或其他路徑）留下「返回總覽」標記供行程頁還原捲動
  useEffect(() => {
    clearTripExpensesFromOverview();
    if (!fromOverview) return;
    return () => markTripExpensesBackToOverview(tripId);
  }, [fromOverview, tripId]);

  // ── 讀取 ─────────────────────────────────────────────────────────────
  // fresh＝true（寫入之後）：一定發出新的讀取，不沿用寫入前發出的進行中讀取。
  // 較早發出的讀取晚回來時不覆蓋快取（trip-expenses.ts 以序號判斷）。
  const reload = useCallback(
    (fresh = false): Promise<TripExpense[] | null> => {
      if (!fresh && inflightRef.current) return inflightRef.current.promise;
      const seq = ++loadSeqRef.current;
      setRefreshing(true);
      const p = listTripExpenses(tripId)
        .then((rows) => {
          if (mountedRef.current) {
            if (seq === loadSeqRef.current) setLoadError(null);
            setHiddenIds((prev) => {
              if (prev.size === 0) return prev;
              let changed = false;
              const next = new Map(prev);
              for (const [id, issuedAt] of prev) {
                if (seq > issuedAt) {
                  next.delete(id);
                  changed = true;
                }
              }
              return changed ? next : prev;
            });
          }
          return rows;
        })
        .catch((e) => {
          const code = tripExpenseErrorCode(e);
          console.warn("[TRIP_EXPENSES] load failed", code, e);
          if (mountedRef.current && seq === loadSeqRef.current) setLoadError(code);
          return null;
        })
        .finally(() => {
          if (inflightRef.current?.seq === seq) {
            inflightRef.current = null;
            if (mountedRef.current) setRefreshing(false);
          }
        });
      inflightRef.current = { seq, promise: p };
      return p;
    },
    [tripId],
  );
  const reloadAfterWrite = useCallback(() => reload(true), [reload]);

  // 讀取失敗：保留先前名單；從未成功載入則維持 null（不把空名單當成已載入）並顯示錯誤＋重試
  const reloadMembers = useCallback(() => {
    setMembersError(false);
    listTripMembers(tripId)
      .then((rows) => {
        if (mountedRef.current) setMembers(rows);
      })
      .catch((e) => {
        console.warn("[TRIP_EXPENSES] listTripMembers failed", e);
        if (mountedRef.current) setMembersError(true);
      });
  }, [tripId]);

  // 進入頁面
  useEffect(() => {
    void reload();
    reloadMembers();
    void getAuthenticatedUserId().then((id) => {
      if (mountedRef.current) setMeId(id);
    });
  }, [reload, reloadMembers]);

  // App 回到前景（同頁 30 秒內最多一次）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastForegroundFetchRef.current < FOREGROUND_REFETCH_MS) return;
      lastForegroundFetchRef.current = now;
      void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  // 下拉更新
  const pull = usePullToRefresh(
    () => document.querySelector<HTMLElement>("main.app-scroll"),
    () => {
      void reload();
      reloadMembers();
    },
    !sheet.open,
  );

  const expenses = useMemo(
    () => (cached ?? []).filter((e) => !hiddenIds.has(e.id)),
    [cached, hiddenIds],
  );

  // 不在目前成員名單的使用者一律顯示「已不在行程中的成員」（不補查 profiles）；
  // 名單未載入時顯示通用占位名稱
  const resolvePerson = useMemo(
    () => buildPeopleResolver(members, meId, copy),
    [members, meId, copy],
  );
  const memberIds = useMemo(
    () =>
      (members ?? []).filter((m) => m.status === "accepted").map((m) => normalizeUserId(m.user_id)),
    [members],
  );
  const showCode = useMemo(
    () => shouldShowCurrencyCode(expenses.map((e) => e.currency)),
    [expenses],
  );
  const summaries = useMemo(() => summarizeByCurrency(expenses, meId), [expenses, meId]);
  const settlements = useMemo(() => computeSettlements(expenses, memberIds), [expenses, memberIds]);
  const used = useMemo(() => usedCurrencies(cached ?? []), [cached]);
  const defaultCurrency = useMemo(
    () => defaultExpenseCurrency(cached ?? [], locale),
    [cached, locale],
  );
  const groups = useMemo(() => {
    const out: Array<{ date: string; items: TripExpense[] }> = [];
    for (const e of expenses) {
      const last = out[out.length - 1];
      if (last && last.date === e.spent_on) last.items.push(e);
      else out.push({ date: e.spent_on, items: [e] });
    }
    return out;
  }, [expenses]);

  // ── 返回 ─────────────────────────────────────────────────────────────
  const goBack = () => {
    if (fromOverview && router.history.canGoBack()) {
      router.history.back();
      return;
    }
    void navigate({
      to: "/saved/$tripId",
      params: { tripId },
      search: { view: "overview" },
      replace: true,
    });
  };

  // ── Sheet ────────────────────────────────────────────────────────────
  const sheetExpense = sheet.expenseId
    ? (expenses.find((e) => e.id === sheet.expenseId) ?? lastSheetExpenseRef.current)
    : null;
  if (sheetExpense) lastSheetExpenseRef.current = sheetExpense;

  const closeSheet = () => setSheet((s) => ({ ...s, open: false }));

  const openAdd = () => {
    lastSheetExpenseRef.current = null;
    setSheet((s) => ({
      open: true,
      session: s.session + 1,
      expenseId: null,
      formKey: 0,
      conflictNotice: false,
    }));
  };

  const openEdit = (expense: TripExpense) => {
    lastSheetExpenseRef.current = expense;
    setSheet((s) => ({
      open: true,
      session: s.session + 1,
      expenseId: expense.id,
      formKey: 0,
      conflictNotice: false,
    }));
  };

  const handleConflict = async (expenseId: string) => {
    const rows = await reloadAfterWrite();
    if (!mountedRef.current) return;
    const latest = rows?.find((e) => e.id === expenseId);
    if (rows && !latest) {
      toast.error(copy.errorDeleted);
      closeSheet();
      return;
    }
    if (latest) lastSheetExpenseRef.current = latest;
    setSheet((s) => ({ ...s, formKey: s.formKey + 1, conflictNotice: true }));
  };

  const handleGone = (code: TripExpenseErrorCode) => {
    toast.error(expenseErrorMessage(code, copy));
    closeSheet();
    void reloadAfterWrite();
  };

  const handleSaved = () => {
    closeSheet();
    void reloadAfterWrite();
  };

  const undoDelete = async (expenseId: string) => {
    try {
      await restoreTripExpense(expenseId);
      toast.success(copy.restored);
    } catch (e) {
      toast.error(expenseErrorMessage(tripExpenseErrorCode(e), copy));
    }
    void reloadAfterWrite();
  };

  const handleDelete = async (expense: TripExpense) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteTripExpense(expense.id, expense.version);
      if (!mountedRef.current) return;
      const issuedAt = loadSeqRef.current;
      setHiddenIds((prev) => new Map(prev).set(expense.id, issuedAt));
      closeSheet();
      toast(formatTripWorkspaceTemplate(copy.deleted, { title: expense.title }), {
        duration: UNDO_TOAST_MS,
        action: { label: copy.undo, onClick: () => void undoDelete(expense.id) },
      });
      void reloadAfterWrite();
    } catch (e) {
      const code = tripExpenseErrorCode(e);
      console.warn("[TRIP_EXPENSES] delete failed", code, e);
      if (code === "expense_conflict") {
        await handleConflict(expense.id);
      } else if (code === "expense_not_found" || code === "expense_deleted") {
        handleGone(code);
      } else {
        toast.error(expenseErrorMessage(code, copy));
      }
    } finally {
      if (mountedRef.current) setDeleting(false);
    }
  };

  // ── 標記已還：建立 settlement（付款人＝還錢的人、分攤對象＝收錢的人、exact） ──
  const handleMarkPaid = async (s: CurrencySettlement, t: SuggestedTransfer) => {
    const key = transferKey(s, t);
    if (marking.has(key)) return;
    // 成員名單未載入：無法確認雙方仍在行程中，不送出
    if (members == null) return;
    // 涉及已不在行程中的成員：後端必定拒絕（expense_participant_not_member），不送出
    if (!resolvePerson(t.from_user_id).isMember || !resolvePerson(t.to_user_id).isMember) {
      return;
    }
    setMarking((prev) => new Set(prev).add(key));
    // 同一筆建議轉帳的重試沿用同一個 client_request_id（防重送）
    let requestId = markRequestIdsRef.current.get(key);
    if (!requestId) {
      requestId = newClientRequestId();
      markRequestIdsRef.current.set(key, requestId);
    }
    const from = resolvePerson(t.from_user_id);
    const to = resolvePerson(t.to_user_id);
    try {
      const res = await upsertTripExpense(
        tripId,
        {
          id: null,
          client_request_id: requestId,
          kind: "settlement",
          title: clampTitle(
            formatTripWorkspaceTemplate(copy.settlementTitle, { from: from.name, to: to.name }),
          ),
          amount_minor: t.amount_minor,
          currency: s.currency,
          currency_exponent: s.currency_exponent,
          spent_on: todayDateKey(),
          split_method: "exact",
          note: null,
          payers: [{ user_id: t.from_user_id, amount_minor: t.amount_minor }],
          shares: [{ user_id: t.to_user_id, share_minor: t.amount_minor, percent_bp: null }],
        },
        null,
      );
      markRequestIdsRef.current.delete(key);
      toast.success(copy.settleMarked, {
        duration: UNDO_TOAST_MS,
        action: {
          label: copy.undo,
          onClick: () => {
            deleteTripExpense(res.id, res.version)
              .catch((e) => toast.error(expenseErrorMessage(tripExpenseErrorCode(e), copy)))
              .finally(() => void reloadAfterWrite());
          },
        },
      });
      void reloadAfterWrite();
    } catch (e) {
      const code = tripExpenseErrorCode(e);
      console.warn("[TRIP_EXPENSES] mark paid failed", code, e);
      toast.error(expenseErrorMessage(code, copy));
    } finally {
      if (mountedRef.current) {
        setMarking((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    }
  };

  // ── 畫面 ─────────────────────────────────────────────────────────────
  const initialLoading = cached == null && !loadError;
  const pullReady = pull >= PULL_TO_REFRESH_TRIGGER_PX;

  return (
    <div className="flex min-h-full flex-col">
      <header
        className="sticky z-20 flex items-center gap-2 border-b border-border bg-background px-3 py-2.5"
        style={TRIP_SUBPAGE_HEADER_STYLE}
      >
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.back}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {copy.title}
        </h1>
        {refreshing && cached != null ? (
          <Loader2
            className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
            aria-label={copy.refreshing}
          />
        ) : null}
      </header>

      {pull > 0 ? (
        <div
          className="flex items-end justify-center overflow-hidden text-xs text-muted-foreground"
          style={{ height: pull }}
          aria-hidden
        >
          <span className="pb-2">{pullReady ? copy.releaseToRefresh : copy.pullToRefresh}</span>
        </div>
      ) : null}

      <div className="px-5 pt-3">
        <div
          role="tablist"
          aria-label={copy.tabsLabel}
          className="grid grid-cols-2 gap-1 rounded-full bg-secondary p-1"
        >
          {(
            [
              ["expenses", copy.tabExpenses],
              ["settle", copy.tabSettle],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`trip-expenses-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`trip-expenses-panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "h-8 rounded-full text-sm font-medium transition",
                tab === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {members == null && membersError ? (
          <div
            role="alert"
            className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2"
          >
            <span className="min-w-0 text-xs text-destructive">{copy.membersLoadFailed}</span>
            <button
              type="button"
              onClick={reloadMembers}
              className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground"
            >
              {copy.retry}
            </button>
          </div>
        ) : null}
      </div>

      <div
        id={`trip-expenses-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`trip-expenses-tab-${tab}`}
        className="flex-1 px-5 pb-4 pt-4"
      >
        {initialLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {copy.loading}
          </div>
        ) : cached == null && loadError ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {loadError === "network" ? copy.errorNetwork : copy.loadFailed}
            </p>
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-foreground"
            >
              {copy.retry}
            </button>
          </div>
        ) : tab === "settle" ? (
          <SettlePanel
            settlements={settlements}
            locale={locale}
            copy={copy}
            showCode={showCode}
            resolvePerson={resolvePerson}
            marking={marking}
            membersLoaded={members != null}
            onMarkPaid={(s, t) => void handleMarkPaid(s, t)}
          />
        ) : (
          <>
            {loadError ? (
              <div
                role="alert"
                className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2"
              >
                <span className="min-w-0 text-xs text-destructive">
                  {loadError === "network" ? copy.errorNetwork : copy.loadFailed}
                </span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  className="shrink-0 rounded-full bg-background px-3 py-1 text-xs font-medium text-foreground"
                >
                  {copy.retry}
                </button>
              </div>
            ) : null}

            {summaries.length > 0 ? (
              <section className="rounded-2xl border border-border bg-card px-4 py-1">
                <ul>
                  {summaries.map((s) => (
                    <li
                      key={s.key}
                      className="flex items-center justify-between gap-3 border-b border-border py-2.5 last:border-0"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {copy.totalLabel} · {s.currency}
                        </p>
                        <p className="truncate text-lg font-semibold tabular-nums text-foreground">
                          {safeFormatMoney(s.totalMinor, s.currency, s.exponent, locale, showCode)}
                        </p>
                      </div>
                      {s.myNetMinor != null ? (
                        <div className="min-w-0 text-right">
                          <p className="text-xs text-muted-foreground">{copy.myNetLabel}</p>
                          <p
                            className={cn(
                              "truncate text-sm font-medium tabular-nums",
                              s.myNetMinor > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : s.myNetMinor < 0
                                  ? "text-destructive"
                                  : "text-muted-foreground",
                            )}
                          >
                            {formatNetLabel(
                              s.myNetMinor,
                              s.currency,
                              s.exponent,
                              locale,
                              copy,
                              showCode,
                            )}
                          </p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {groups.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                  <Wallet className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">{copy.emptyTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{copy.emptyBody}</p>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {groups.map((g) => (
                  <section key={g.date}>
                    <h2 className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
                      {formatExpenseDate(g.date, locale)}
                    </h2>
                    <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                      {g.items.map((e) => (
                        <ExpenseRow
                          key={e.id}
                          expense={e}
                          locale={locale}
                          showCode={showCode}
                          copy={copy}
                          resolvePerson={resolvePerson}
                          onOpen={() => openEdit(e)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {tab === "expenses" && !(cached == null && loadError) ? (
        <div className="sticky bottom-0 z-10 bg-gradient-to-t from-background via-background/95 to-background/0 px-5 pb-3 pt-4">
          <button
            type="button"
            onClick={openAdd}
            disabled={members == null || initialLoading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground shadow-lift disabled:opacity-60"
          >
            {members == null && !membersError ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-label={copy.membersLoading} />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {copy.add}
          </button>
        </div>
      ) : null}

      <ExpenseSheet
        open={sheet.open}
        onOpenChange={(open) => (open ? undefined : closeSheet())}
        tripId={tripId}
        locale={locale}
        copy={copy}
        sessionKey={sheet.session}
        expense={sheet.expenseId ? sheetExpense : null}
        formKey={String(sheet.formKey)}
        conflictNotice={sheet.conflictNotice}
        members={members ?? []}
        membersLoaded={members != null}
        resolvePerson={resolvePerson}
        meId={meId}
        usedCurrencies={used}
        defaultCurrency={defaultCurrency}
        onSaved={handleSaved}
        onConflict={(id) => void handleConflict(id)}
        onGone={handleGone}
        onDelete={(e) => void handleDelete(e)}
        deleting={deleting}
      />
    </div>
  );
}

function ExpenseRow({
  expense,
  locale,
  showCode,
  copy,
  resolvePerson,
  onOpen,
}: {
  expense: TripExpense;
  locale: Parameters<typeof safeFormatMoney>[3];
  showCode: boolean;
  copy: ReturnType<typeof getTripExpensesCopy>;
  resolvePerson: ReturnType<typeof buildPeopleResolver>;
  onOpen: () => void;
}) {
  const payer = resolvePerson(expense.payers[0]?.user_id ?? "");
  const isSettlement = expense.kind === "settlement";
  const receiver = isSettlement ? resolvePerson(expense.shares[0]?.user_id ?? "") : null;
  return (
    <li className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <ProfileAvatar
          avatarUrl={payer.avatarUrl}
          displayName={payer.name}
          avatarUpdatedAt={payer.profile?.profile_updated_at}
          initial={payer.avatarUrl ? undefined : collaboratorInitial(payer.profile, payer.name)}
          showDefault={payer.profile == null}
          className="pointer-events-none h-8 w-8 shrink-0 rounded-full"
          imgClassName="rounded-full"
        />
        <span className="min-w-0 flex-1">
          {isSettlement && receiver ? (
            <>
              <span className="flex items-center gap-1 truncate text-sm text-foreground">
                <span className="truncate">{personLabel(payer, copy)}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{personLabel(receiver, copy)}</span>
              </span>
              <span className="mt-0.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                {copy.settlementTag}
              </span>
            </>
          ) : (
            <>
              <span className="block truncate text-sm font-medium text-foreground">
                {expense.title}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {formatTripWorkspaceTemplate(copy.paidBy, { name: personLabel(payer, copy) })}
              </span>
            </>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 text-sm font-medium tabular-nums",
            isSettlement ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {safeFormatMoney(
            expense.amount_minor,
            expense.currency,
            expense.currency_exponent,
            locale,
            showCode,
          )}
        </span>
      </button>
    </li>
  );
}
