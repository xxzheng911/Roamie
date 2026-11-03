import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import type { Locale } from "@/lib/i18n/types";
import { formatTripWorkspaceTemplate, type TripExpensesCopy } from "@/lib/i18n/trip-workspace-copy";
import { getIsoCurrencyExponent } from "@/lib/money/iso4217";
import { minorToDecimalString, parseMoneyInput } from "@/lib/money/money-parse";
import {
  checkExactSplit,
  evenPercentBp,
  normalizeUserId,
  PERCENT_BP_TOTAL,
  splitEqual,
  splitPercent,
  type ShareResult,
  type SplitMethod,
} from "@/lib/money/split";
import { collaboratorInitial } from "@/lib/trip/collab-member-display";
import type { TripMemberRow } from "@/lib/trip/trip-collab";
import {
  newClientRequestId,
  tripExpenseErrorCode,
  upsertTripExpense,
  type TripExpense,
  type TripExpenseErrorCode,
} from "@/lib/trip/trip-expenses";
import { cn } from "@/lib/utils";
import { CurrencyPicker } from "./CurrencyPicker";
import {
  bpToPercentText,
  expenseErrorMessage,
  isDateKey,
  percentTextToBp,
  personLabel,
  safeFormatMoney,
  todayDateKey,
  type ExpensePerson,
} from "./expense-model";

const TITLE_MAX = 80;
const NOTE_MAX = 500;

type FormState = {
  amountText: string;
  currency: string;
  title: string;
  date: string;
  payerId: string | null;
  method: SplitMethod;
  selected: string[];
  exactText: Record<string, string>;
  percentText: Record<string, string>;
  note: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tripId: string;
  locale: Locale;
  copy: TripExpensesCopy;
  /** 每次開啟換新：表單以當下資料重新初始化 */
  sessionKey: number;
  /** null＝新增 */
  expense: TripExpense | null;
  /** 改變時以 expense 重新初始化表單（例如版本衝突後載入最新版本） */
  formKey: string;
  /** 顯示「已載入最新版本」提示 */
  conflictNotice: boolean;
  members: TripMemberRow[];
  /** 成員名單是否已成功載入；未載入時既有參與者都保留可選，避免取消勾選後消失 */
  membersLoaded?: boolean;
  resolvePerson: (userId: string) => ExpensePerson;
  meId: string | null;
  usedCurrencies: string[];
  defaultCurrency: string;
  onSaved: () => void;
  /** 版本衝突：上層重新讀取並以新版本重設表單 */
  onConflict: (expenseId: string) => void;
  /** 修改時發現已刪除／不存在 */
  onGone: (code: TripExpenseErrorCode) => void;
  onDelete: (expense: TripExpense) => void;
  deleting: boolean;
};

function exponentOf(currency: string): number {
  return getIsoCurrencyExponent(currency) ?? 2;
}

function initForm(
  expense: TripExpense | null,
  memberIds: string[],
  meId: string | null,
  defaultCurrency: string,
): FormState {
  if (!expense) {
    const me = meId ? normalizeUserId(meId) : null;
    return {
      amountText: "",
      currency: defaultCurrency,
      title: "",
      date: todayDateKey(),
      payerId: me && memberIds.includes(me) ? me : (memberIds[0] ?? null),
      method: "equal",
      selected: [...memberIds],
      exactText: {},
      percentText: {},
      note: "",
    };
  }
  const exactText: Record<string, string> = {};
  const percentText: Record<string, string> = {};
  for (const s of expense.shares) {
    const id = normalizeUserId(s.user_id);
    exactText[id] = minorToDecimalString(s.share_minor, expense.currency_exponent);
    if (s.percent_bp != null) percentText[id] = bpToPercentText(s.percent_bp);
  }
  return {
    amountText: minorToDecimalString(expense.amount_minor, expense.currency_exponent),
    currency: expense.currency,
    title: expense.title,
    date: expense.spent_on,
    payerId: expense.payers[0] ? normalizeUserId(expense.payers[0].user_id) : null,
    method: expense.split_method,
    selected: expense.shares.map((s) => normalizeUserId(s.user_id)),
    exactText,
    percentText,
    note: expense.note ?? "",
  };
}

/** 自訂金額欄位：空白＝0；其餘以 parseMoneyInput 解析（"0"、"0.00" 視為 0）。 */
function parseShareText(text: string, exponent: number): number | null {
  const raw = text.trim();
  if (raw === "" || /^0*(\.0*)?$/.test(raw)) return 0;
  const r = parseMoneyInput(raw, exponent);
  return r.ok ? r.minor : null;
}

function PersonAvatar({ person, size = "h-8 w-8" }: { person: ExpensePerson; size?: string }) {
  return (
    <ProfileAvatar
      avatarUrl={person.avatarUrl}
      displayName={person.name}
      avatarUpdatedAt={person.profile?.profile_updated_at}
      initial={person.avatarUrl ? undefined : collaboratorInitial(person.profile, person.name)}
      showDefault={person.profile == null}
      className={cn("pointer-events-none shrink-0 rounded-full", size)}
      imgClassName="rounded-full"
    />
  );
}

export function ExpenseSheet(props: Props) {
  const { open, onOpenChange, expense, copy } = props;
  const isSettlement = expense?.kind === "settlement";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        closeLabel={copy.close}
        className="flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border-0 bg-background px-0 pb-0"
      >
        {isSettlement && expense ? (
          <SettlementDetail {...props} expense={expense} />
        ) : (
          <ExpenseForm key={props.sessionKey} {...props} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SettlementDetail({
  expense,
  copy,
  locale,
  resolvePerson,
  onDelete,
  deleting,
}: Props & { expense: TripExpense }) {
  const from = resolvePerson(expense.payers[0]?.user_id ?? "");
  const to = resolvePerson(expense.shares[0]?.user_id ?? "");
  return (
    <>
      <SheetTitle className="px-5 text-base font-medium">{copy.settlementSheetTitle}</SheetTitle>
      <SheetDescription className="sr-only">{expense.title}</SheetDescription>
      <div className="px-5 pb-8 pt-5">
        <div className="flex items-center justify-center gap-4">
          <div className="flex min-w-0 flex-col items-center gap-1">
            <PersonAvatar person={from} size="h-11 w-11" />
            <span className="max-w-24 truncate text-xs text-foreground">
              {personLabel(from, copy)}
            </span>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col items-center gap-1">
            <PersonAvatar person={to} size="h-11 w-11" />
            <span className="max-w-24 truncate text-xs text-foreground">
              {personLabel(to, copy)}
            </span>
          </div>
        </div>
        <p className="mt-4 text-center text-2xl font-semibold tabular-nums text-foreground">
          {safeFormatMoney(
            expense.amount_minor,
            expense.currency,
            expense.currency_exponent,
            locale,
            true,
          )}
        </p>
        <p className="mt-1 text-center text-xs text-muted-foreground">{expense.spent_on}</p>
        <button
          type="button"
          onClick={() => onDelete(expense)}
          disabled={deleting}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-destructive/10 text-sm font-medium text-destructive disabled:opacity-60"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {deleting ? copy.deleting : copy.delete}
        </button>
      </div>
    </>
  );
}

function ExpenseForm({
  tripId,
  locale,
  copy,
  expense,
  formKey,
  conflictNotice,
  members,
  membersLoaded = true,
  resolvePerson,
  meId,
  usedCurrencies,
  defaultCurrency,
  onSaved,
  onConflict,
  onGone,
  onDelete,
  deleting,
}: Props) {
  const memberIds = useMemo(
    () => members.filter((m) => m.status === "accepted").map((m) => normalizeUserId(m.user_id)),
    [members],
  );

  const [form, setForm] = useState<FormState>(() =>
    initForm(expense, memberIds, meId, defaultCurrency),
  );
  const [view, setView] = useState<"form" | "currency">("form");
  const [attempted, setAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<TripExpenseErrorCode | null>(null);
  // 重試時送出內容與上次相同才沿用同一個 client_request_id；內容不同或表單重設時換新
  const requestIdRef = useRef(newClientRequestId());
  // 目前 client_request_id 第一次送出時的內容（不含 client_request_id）
  const sentContentRef = useRef<string | null>(null);
  const baseVersionRef = useRef<number | null>(expense?.version ?? null);
  const expenseRef = useRef(expense);
  expenseRef.current = expense;

  // formKey 改變（版本衝突後載入最新版本）：以最新資料重設表單
  const lastFormKeyRef = useRef(formKey);
  useEffect(() => {
    if (lastFormKeyRef.current === formKey) return;
    lastFormKeyRef.current = formKey;
    const latest = expenseRef.current;
    setForm(initForm(latest, memberIds, meId, defaultCurrency));
    baseVersionRef.current = latest?.version ?? null;
    requestIdRef.current = newClientRequestId();
    sentContentRef.current = null;
    setAttempted(false);
    setSubmitError(null);
  }, [formKey, memberIds, meId, defaultCurrency]);

  // 候選成員：目前成員＋此筆既有、已不在成員名單的參與者（可保留，不可新增）
  const candidates = useMemo(() => {
    const ids = [...memberIds];
    if (expense) {
      for (const u of [
        ...expense.payers.map((p) => p.user_id),
        ...expense.shares.map((s) => s.user_id),
      ]) {
        const id = normalizeUserId(u);
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids.map((id) => resolvePerson(id));
  }, [memberIds, expense, resolvePerson]);

  const exponent = exponentOf(form.currency);
  const amount = parseMoneyInput(form.amountText, exponent);
  const amountMinor = amount.ok ? amount.minor : 0;
  const participants = candidates.filter((p) => form.selected.includes(p.userId));
  const participantIds = participants.map((p) => p.userId);

  // ── 分攤（一律使用 split.ts） ──
  const equalResult =
    amount.ok && participantIds.length > 0 ? splitEqual(amountMinor, participantIds) : null;

  const exactParsed = participants.map((p) => ({
    user_id: p.userId,
    minor: parseShareText(form.exactText[p.userId] ?? "", exponent),
  }));
  const exactInvalid = exactParsed.some((r) => r.minor == null);
  const exactCheck = checkExactSplit(
    amountMinor,
    exactParsed.map((r) => ({ user_id: r.user_id, share_minor: r.minor ?? 0 })),
  );

  const percentParsed = participants.map((p) => ({
    user_id: p.userId,
    bp: percentTextToBp(form.percentText[p.userId] ?? ""),
  }));
  const percentInvalid = percentParsed.some((r) => r.bp == null);
  const percentSum = percentParsed.reduce((s, r) => s + (r.bp ?? 0), 0);
  const percentResult =
    amount.ok && !percentInvalid && participantIds.length > 0
      ? splitPercent(
          amountMinor,
          percentParsed.map((r) => ({ user_id: r.user_id, percent_bp: r.bp ?? 0 })),
        )
      : null;

  const shareById = new Map<string, number>();
  if (form.method === "equal" && equalResult?.ok) {
    for (const s of equalResult.shares) shareById.set(s.user_id, s.share_minor);
  } else if (form.method === "percent" && percentResult?.ok) {
    for (const s of percentResult.shares) shareById.set(s.user_id, s.share_minor);
  }

  const fmt = (minor: number) => safeFormatMoney(minor, form.currency, exponent, locale);

  // ── 驗證 ──
  const amountError = amount.ok
    ? null
    : amount.reason === "too_many_decimals"
      ? formatTripWorkspaceTemplate(copy.validationAmountDecimals, { n: exponent })
      : amount.reason === "too_large"
        ? copy.validationAmountTooLarge
        : copy.validationAmount;
  const titleTrimmed = form.title.trim();
  const titleError = titleTrimmed.length < 1 || titleTrimmed.length > TITLE_MAX;
  const dateError = !isDateKey(form.date);
  const payerError = !form.payerId;
  const participantsError = participantIds.length === 0;
  const splitError =
    participantsError || !amount.ok
      ? null
      : form.method === "exact"
        ? exactInvalid
          ? copy.validationShareInvalid
          : exactCheck.ok
            ? null
            : copy.validationExact
        : form.method === "percent"
          ? percentInvalid
            ? copy.validationShareInvalid
            : percentResult?.ok
              ? null
              : copy.validationPercent
          : equalResult?.ok
            ? null
            : copy.errorSplit;
  const noteError = form.note.length > NOTE_MAX;
  const hasError =
    Boolean(amountError) ||
    titleError ||
    dateError ||
    payerError ||
    participantsError ||
    Boolean(splitError) ||
    noteError;

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSubmitError(null);
  };

  const setMethod = (method: SplitMethod) => {
    if (method === form.method) return;
    if (method === "percent") {
      const even = evenPercentBp(participantIds);
      const percentText: Record<string, string> = {};
      for (const p of even) percentText[p.user_id] = bpToPercentText(p.percent_bp);
      update({ method, percentText });
      return;
    }
    if (method === "exact") {
      // 先以目前顯示的分攤結果預填（沒有則留空）
      const exactText: Record<string, string> = { ...form.exactText };
      if (shareById.size > 0) {
        for (const [id, minor] of shareById) exactText[id] = minorToDecimalString(minor, exponent);
      }
      update({ method, exactText });
      return;
    }
    update({ method });
  };

  const toggleParticipant = (id: string) => {
    const selected = form.selected.includes(id)
      ? form.selected.filter((x) => x !== id)
      : [...form.selected, id];
    if (form.method === "percent") {
      const ids = candidates.map((c) => c.userId).filter((x) => selected.includes(x));
      const percentText: Record<string, string> = {};
      for (const p of evenPercentBp(ids)) percentText[p.user_id] = bpToPercentText(p.percent_bp);
      update({ selected, percentText });
      return;
    }
    update({ selected });
  };

  const submit = async () => {
    if (submitting) return;
    setAttempted(true);
    if (hasError || !form.payerId || !amount.ok) return;
    let shares: ShareResult[] | null = null;
    if (form.method === "equal" && equalResult?.ok) shares = equalResult.shares;
    else if (form.method === "percent" && percentResult?.ok) shares = percentResult.shares;
    else if (form.method === "exact" && exactCheck.ok) shares = exactCheck.shares;
    if (!shares) return;

    setSubmitting(true);
    setSubmitError(null);
    const editing = expense != null;
    const content = {
      id: expense?.id ?? null,
      kind: "expense" as const,
      title: titleTrimmed,
      amount_minor: amount.minor,
      currency: form.currency,
      currency_exponent: exponent,
      spent_on: form.date,
      split_method: form.method,
      note: form.note.trim() ? form.note.trim() : null,
      payers: [{ user_id: form.payerId, amount_minor: amount.minor }],
      shares: shares.map((s) => ({
        user_id: s.user_id,
        share_minor: s.share_minor,
        percent_bp: form.method === "percent" ? s.percent_bp : null,
      })),
    };
    const fingerprint = JSON.stringify(content);
    if (sentContentRef.current != null && sentContentRef.current !== fingerprint) {
      // 失敗後修改內容再送：換新的 client_request_id，避免後端 replay 舊內容而丟掉修改
      requestIdRef.current = newClientRequestId();
      sentContentRef.current = null;
    }
    if (sentContentRef.current == null) sentContentRef.current = fingerprint;
    try {
      // replayed＝true（回應遺失後原樣重試）同樣視為成功並重新讀取
      await upsertTripExpense(
        tripId,
        { ...content, client_request_id: requestIdRef.current },
        editing ? baseVersionRef.current : null,
      );
      setSubmitting(false);
      onSaved();
    } catch (e) {
      setSubmitting(false);
      const code = tripExpenseErrorCode(e);
      console.warn("[TRIP_EXPENSES] upsert failed", code, e);
      if (editing && code === "expense_conflict" && expense) {
        onConflict(expense.id);
        return;
      }
      if (editing && (code === "expense_deleted" || code === "expense_not_found")) {
        onGone(code);
        return;
      }
      setSubmitError(code);
    }
  };

  if (view === "currency") {
    return (
      <>
        <SheetTitle className="px-5 pb-3 text-base font-medium">{copy.currencyChange}</SheetTitle>
        <SheetDescription className="sr-only">{copy.currencySearch}</SheetDescription>
        <CurrencyPicker
          locale={locale}
          copy={copy}
          value={form.currency}
          used={usedCurrencies}
          onBack={() => setView("form")}
          onSelect={(code) => {
            update({ currency: code });
            setView("form");
          }}
        />
      </>
    );
  }

  const exactDiff = exactCheck.difference;
  const percentDiff = PERCENT_BP_TOTAL - percentSum;
  const showError = (flag: boolean) => attempted && flag;

  return (
    <>
      <SheetTitle className="px-5 text-base font-medium">
        {expense ? copy.sheetEditTitle : copy.sheetAddTitle}
      </SheetTitle>
      <SheetDescription className="sr-only">{copy.amountLabel}</SheetDescription>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-4">
        {conflictNotice ? (
          <p
            role="status"
            className="mb-3 rounded-xl bg-secondary px-3 py-2 text-xs text-foreground"
          >
            {copy.conflictReloaded}
          </p>
        ) : null}

        {/* 金額＋幣別 */}
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => setView("currency")}
            aria-label={`${copy.currencyChange}: ${form.currency}`}
            className="flex h-12 shrink-0 items-center gap-1 rounded-full bg-secondary px-4 text-sm font-semibold text-foreground"
          >
            {form.currency}
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </button>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{copy.amountLabel}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={form.amountText}
              onChange={(e) => update({ amountText: e.target.value })}
              placeholder="0"
              aria-invalid={showError(Boolean(amountError))}
              className="h-12 w-full border-b border-border bg-transparent text-right text-3xl font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-foreground"
            />
          </label>
        </div>
        {showError(Boolean(amountError)) ? (
          <p className="mt-1 text-right text-xs text-destructive">{amountError}</p>
        ) : null}

        {/* 名稱、日期 */}
        <div className="mt-5 grid grid-cols-[1fr_auto] gap-3">
          <label className="block min-w-0">
            <span className="text-xs text-muted-foreground">{copy.titleLabel}</span>
            <input
              type="text"
              value={form.title}
              maxLength={TITLE_MAX}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={copy.titlePlaceholder}
              aria-invalid={showError(titleError)}
              className="mt-1 h-10 w-full rounded-xl bg-secondary px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{copy.dateLabel}</span>
            <input
              type="date"
              value={form.date}
              onChange={(e) => update({ date: e.target.value })}
              aria-invalid={showError(dateError)}
              className="mt-1 h-10 rounded-xl bg-secondary px-3 text-sm text-foreground outline-none"
            />
          </label>
        </div>
        {showError(titleError) ? (
          <p className="mt-1 text-xs text-destructive">{copy.validationTitle}</p>
        ) : null}
        {showError(dateError) ? (
          <p className="mt-1 text-xs text-destructive">{copy.validationDate}</p>
        ) : null}

        {/* 誰先付款（V1 單一付款人） */}
        <fieldset className="mt-5">
          <legend className="text-xs text-muted-foreground">{copy.payerLabel}</legend>
          <div
            role="radiogroup"
            aria-label={copy.payerLabel}
            className="no-scrollbar -mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {candidates
              .filter((p) => !membersLoaded || p.isMember || p.userId === form.payerId)
              .map((p) => {
                const active = form.payerId === p.userId;
                return (
                  <button
                    key={p.userId}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => update({ payerId: p.userId })}
                    className="flex w-16 shrink-0 flex-col items-center gap-1"
                  >
                    <span
                      className={cn(
                        "rounded-full p-0.5 ring-2",
                        active ? "ring-primary" : "ring-transparent",
                      )}
                    >
                      <PersonAvatar person={p} size="h-10 w-10" />
                    </span>
                    <span
                      className={cn(
                        "w-full truncate text-center text-[11px]",
                        active ? "font-medium text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {personLabel(p, copy)}
                    </span>
                  </button>
                );
              })}
          </div>
          {showError(payerError) ? (
            <p className="mt-1 text-xs text-destructive">{copy.validationPayer}</p>
          ) : null}
        </fieldset>

        {/* 分攤方式 */}
        <div className="mt-5">
          <span className="text-xs text-muted-foreground">{copy.splitLabel}</span>
          <div
            role="radiogroup"
            aria-label={copy.splitLabel}
            className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-secondary p-1"
          >
            {(
              [
                ["equal", copy.splitEqual],
                ["exact", copy.splitExact],
                ["percent", copy.splitPercent],
              ] as const
            ).map(([method, label]) => (
              <button
                key={method}
                type="button"
                role="radio"
                aria-checked={form.method === method}
                onClick={() => setMethod(method)}
                className={cn(
                  "h-8 truncate rounded-full px-2 text-xs font-medium transition",
                  form.method === method
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 參與成員與每人金額 */}
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{copy.participantsLabel}</span>
            {form.method === "exact" && amount.ok && participantIds.length > 0 ? (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  exactDiff === 0 && !exactInvalid ? "text-muted-foreground" : "text-destructive",
                )}
              >
                {exactDiff === 0
                  ? copy.exactMatched
                  : formatTripWorkspaceTemplate(
                      exactDiff > 0 ? copy.exactRemaining : copy.exactOver,
                      { amount: fmt(Math.abs(exactDiff)) },
                    )}
              </span>
            ) : null}
            {form.method === "percent" && participantIds.length > 0 && !percentInvalid ? (
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  percentDiff === 0 ? "text-muted-foreground" : "text-destructive",
                )}
              >
                {percentDiff === 0
                  ? copy.percentMatched
                  : formatTripWorkspaceTemplate(
                      percentDiff > 0 ? copy.percentRemaining : copy.percentOver,
                      { value: bpToPercentText(Math.abs(percentDiff)) },
                    )}
              </span>
            ) : null}
          </div>
          <ul className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
            {candidates
              .filter((p) => !membersLoaded || p.isMember || form.selected.includes(p.userId))
              .map((p) => {
                const checked = form.selected.includes(p.userId);
                const share = shareById.get(p.userId);
                return (
                  <li
                    key={p.userId}
                    className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-0"
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={personLabel(p, copy)}
                      onClick={() => toggleParticipant(p.userId)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-background",
                        )}
                      >
                        {checked ? <Check className="h-3.5 w-3.5" /> : null}
                      </span>
                      <PersonAvatar person={p} size="h-7 w-7" />
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {personLabel(p, copy)}
                      </span>
                    </button>
                    {checked && form.method === "exact" ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={form.exactText[p.userId] ?? ""}
                        onChange={(e) =>
                          update({ exactText: { ...form.exactText, [p.userId]: e.target.value } })
                        }
                        placeholder="0"
                        aria-label={`${personLabel(p, copy)} ${copy.amountLabel}`}
                        className="h-9 w-28 shrink-0 rounded-lg bg-secondary px-2 text-right text-sm tabular-nums text-foreground outline-none"
                      />
                    ) : checked && form.method === "percent" ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={form.percentText[p.userId] ?? ""}
                          onChange={(e) =>
                            update({
                              percentText: { ...form.percentText, [p.userId]: e.target.value },
                            })
                          }
                          placeholder="0"
                          aria-label={`${personLabel(p, copy)} ${copy.splitPercent}`}
                          className="h-9 w-16 rounded-lg bg-secondary px-2 text-right text-sm tabular-nums text-foreground outline-none"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </span>
                    ) : null}
                    {checked && form.method !== "exact" && share != null ? (
                      <span className="w-24 shrink-0 truncate text-right text-sm tabular-nums text-muted-foreground">
                        {fmt(share)}
                      </span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
          {showError(participantsError) ? (
            <p className="mt-1 text-xs text-destructive">{copy.validationParticipants}</p>
          ) : null}
          {showError(Boolean(splitError)) ? (
            <p className="mt-1 text-xs text-destructive">{splitError}</p>
          ) : null}
        </div>

        {/* 備註 */}
        <label className="mt-5 block">
          <span className="text-xs text-muted-foreground">{copy.noteLabel}</span>
          <textarea
            value={form.note}
            maxLength={NOTE_MAX}
            onChange={(e) => update({ note: e.target.value })}
            placeholder={copy.notePlaceholder}
            rows={2}
            className="mt-1 w-full resize-none rounded-xl bg-secondary px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div className="border-t border-border px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
        {submitError ? (
          <p
            role="alert"
            className="mb-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {expenseErrorMessage(submitError, copy)}
          </p>
        ) : null}
        <div className="flex gap-2">
          {expense ? (
            <button
              type="button"
              onClick={() => onDelete(expense)}
              disabled={deleting || submitting}
              aria-label={copy.delete}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive disabled:opacity-60"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || deleting}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {submitting ? copy.saving : submitError ? copy.retry : copy.save}
          </button>
        </div>
      </div>
    </>
  );
}
