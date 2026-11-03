// 共同記帳畫面用的純函式：成員顯示、錯誤文案、幣別排序、總覽統計。
// 分攤／結算一律使用 src/lib/money（split.ts／settle.ts），此檔不做任何分攤計算。

import type { Locale } from "@/lib/i18n/types";
import type { TripExpensesCopy } from "@/lib/i18n/trip-workspace-copy";
import { formatTripWorkspaceTemplate } from "@/lib/i18n/trip-workspace-copy";
import {
  computeSettlements,
  type CurrencySettlement,
  type SuggestedTransfer,
} from "@/lib/money/settle";
import { formatMoney } from "@/lib/money/money-format";
import { normalizeUserId } from "@/lib/money/split";
import {
  COLLABORATOR_MISSING_PROFILE_NAME,
  resolveCollaboratorAvatarUrl,
  resolveCollaboratorDisplayName,
} from "@/lib/trip/collab-member-display";
import type { TripMemberProfile, TripMemberRow } from "@/lib/trip/trip-collab";
import type { TripExpense, TripExpenseErrorCode } from "@/lib/trip/trip-expenses";

export type ExpensePerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  profile: TripMemberProfile | null;
  isMember: boolean;
  isMe: boolean;
  isDeleted: boolean;
};

/**
 * user_id → 顯示資料。不在目前成員名單者一律顯示「已不在行程中的成員」
 * （離開行程與刪除帳號在前端無法區分；非成員的 profile 無讀取權限，不補查）。
 * members＝null（名單尚未載入／讀取失敗）：無法判斷是否為成員，一律顯示通用占位名稱。
 */
export function buildPeopleResolver(
  members: TripMemberRow[] | null,
  meId: string | null,
  copy: TripExpensesCopy,
): (userId: string) => ExpensePerson {
  const byId = new Map<string, TripMemberRow>();
  for (const m of members ?? []) {
    if (m.status === "accepted") byId.set(normalizeUserId(m.user_id), m);
  }
  const me = meId ? normalizeUserId(meId) : null;
  const unknown = members == null;
  return (userId: string) => {
    const id = normalizeUserId(userId);
    const member = byId.get(id);
    const profile = member ? (member.profile ?? null) : null;
    const isDeleted = !member && !unknown;
    const resolved = resolveCollaboratorDisplayName(profile);
    return {
      userId: id,
      name: unknown
        ? copy.memberPlaceholder
        : isDeleted
          ? copy.deletedUser
          : (resolved ?? COLLABORATOR_MISSING_PROFILE_NAME),
      avatarUrl: resolveCollaboratorAvatarUrl(profile),
      profile,
      isMember: Boolean(member),
      isMe: id === me,
      isDeleted,
    };
  };
}

/** 列表／結算用的稱呼：自己顯示「你」。 */
export function personLabel(person: ExpensePerson, copy: TripExpensesCopy): string {
  return person.isMe ? copy.you : person.name;
}

export function expenseErrorMessage(code: TripExpenseErrorCode, copy: TripExpensesCopy): string {
  switch (code) {
    case "not_authenticated":
      return copy.errorNotAuthenticated;
    case "not_trip_member":
      return copy.errorNotMember;
    case "expense_malformed":
    case "expense_invalid_kind":
    case "expense_invalid_split_method":
      return copy.errorMalformed;
    case "expense_invalid_title":
      return copy.errorTitle;
    case "expense_invalid_amount":
      return copy.errorAmount;
    case "expense_invalid_currency":
      return copy.errorCurrency;
    case "expense_invalid_date":
      return copy.errorDate;
    case "expense_invalid_note":
      return copy.errorNote;
    case "expense_payers_mismatch":
    case "expense_shares_mismatch":
    case "expense_percent_mismatch":
    case "expense_split_mismatch":
      return copy.errorSplit;
    case "expense_duplicate_participant":
      return copy.errorDuplicate;
    case "expense_participant_not_member":
      return copy.errorParticipantNotMember;
    case "expense_invalid_settlement":
      return copy.errorSettlement;
    case "expense_not_found":
      return copy.errorNotFound;
    case "expense_deleted":
      return copy.errorDeleted;
    case "expense_conflict":
      return copy.errorConflict;
    case "expense_limit_reached":
      return copy.errorLimit;
    case "network":
      return copy.errorNetwork;
    default:
      return copy.errorUnknown;
  }
}

/** 本機日期 YYYY-MM-DD。 */
export function todayDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t);
}

/** 日期分組標題（例如「11月20日 週五」）。 */
export function formatExpenseDate(dateKey: string, locale: Locale): string {
  if (!isDateKey(dateKey)) return dateKey;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      weekday: "short",
      timeZone: "UTC",
    }).format(new Date(`${dateKey}T00:00:00Z`));
  } catch {
    return dateKey;
  }
}

const LOCALE_DEFAULT_CURRENCY: Record<Locale, string> = {
  "zh-TW": "TWD",
  en: "USD",
  ja: "JPY",
  ko: "KRW",
};

/** 此行程用過的幣別（最近建立的在前）。 */
export function usedCurrencies(expenses: TripExpense[]): string[] {
  const sorted = [...expenses].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );
  const out: string[] = [];
  for (const e of sorted) if (!out.includes(e.currency)) out.push(e.currency);
  return out;
}

/** 新增花費的預設幣別：此行程最近一筆的幣別，沒有則依語系。 */
export function defaultExpenseCurrency(expenses: TripExpense[], locale: Locale): string {
  return usedCurrencies(expenses)[0] ?? LOCALE_DEFAULT_CURRENCY[locale] ?? "USD";
}

export type CurrencySummary = {
  key: string;
  currency: string;
  exponent: number;
  /** 一般支出總額（不含還款紀錄）。 */
  totalMinor: number;
  expenseCount: number;
  /** 自己的淨額（正＝別人欠你；負＝你欠別人）；不是成員時為 null。 */
  myNetMinor: number | null;
  precisionExceeded: boolean;
};

/**
 * 依幣別（＋快照小數位）分組的總覽。排序：最近使用的幣別在前。
 * 淨額直接取 computeSettlements 的結果（不另寫結算邏輯）。
 */
export function summarizeByCurrency(
  expenses: TripExpense[],
  meId: string | null,
): CurrencySummary[] {
  const settlements = computeSettlements(expenses);
  const me = meId ? normalizeUserId(meId) : null;
  const order = usedCurrencies(expenses);
  const totals = new Map<string, { total: bigint; count: number }>();
  for (const e of expenses) {
    if (e.kind !== "expense") continue;
    const key = `${e.currency}:${e.currency_exponent}`;
    const t = totals.get(key) ?? { total: 0n, count: 0 };
    t.total += BigInt(e.amount_minor);
    t.count += 1;
    totals.set(key, t);
  }
  const out: CurrencySummary[] = settlements.map((s) => {
    const key = `${s.currency}:${s.currency_exponent}`;
    const t = totals.get(key) ?? { total: 0n, count: 0 };
    const mine = me ? s.members.find((m) => m.user_id === me) : undefined;
    const total = Number(t.total);
    return {
      key,
      currency: s.currency,
      exponent: s.currency_exponent,
      totalMinor: total,
      expenseCount: t.count,
      myNetMinor: mine ? mine.net_minor : me ? 0 : null,
      precisionExceeded: s.precision_exceeded || !Number.isSafeInteger(total),
    };
  });
  return out.sort((a, b) => {
    const ia = order.indexOf(a.currency);
    const ib = order.indexOf(b.currency);
    if (ia !== ib) return ia - ib;
    return a.exponent - b.exponent;
  });
}

/** 安全格式化（數值異常時退回代碼＋數字，不讓畫面崩潰）。 */
export function safeFormatMoney(
  minor: number,
  currency: string,
  exponent: number,
  locale: Locale,
  showCode = false,
): string {
  try {
    return formatMoney(minor, currency, exponent, { locale, showCode });
  } catch {
    return `${currency} ${minor}`;
  }
}

export function formatNetLabel(
  netMinor: number,
  currency: string,
  exponent: number,
  locale: Locale,
  copy: TripExpensesCopy,
  showCode = false,
): string {
  if (netMinor === 0) return copy.netSettled;
  const amount = safeFormatMoney(Math.abs(netMinor), currency, exponent, locale, showCode);
  return formatTripWorkspaceTemplate(netMinor > 0 ? copy.netOwed : copy.netOwe, { amount });
}

/** 建議轉帳的穩定識別（處理中狀態與重試用的 client_request_id 以此為 key）。 */
export function transferKey(s: CurrencySettlement, t: SuggestedTransfer): string {
  return `${s.currency}:${s.currency_exponent}:${t.from_user_id}:${t.to_user_id}:${t.amount_minor}`;
}

/** 百分比（basis points）→ 輸入框文字（例如 3333 → "33.33"）。 */
export function bpToPercentText(bp: number): string {
  const whole = Math.floor(bp / 100);
  const frac = bp % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/** 輸入框文字 → basis points；空字串＝0；格式錯誤回 null。最多兩位小數、0–100。 */
export function percentTextToBp(text: string): number | null {
  const raw = text.trim();
  if (raw === "") return 0;
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(raw);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bp >= 0 && bp <= 10000 ? bp : null;
}
