// 共同記帳（Trip Workspace V1 第 4 階段）資料存取：讀取、upsert、delete、restore、錯誤碼對應。
// 表格只能 SELECT；寫入一律透過 RPC（upsert_trip_expense／delete_trip_expense／restore_trip_expense）。
// 不新增 Realtime channel：同步由頁面在進入、下拉更新、回到前景時重新讀取。

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { SplitMethod } from "@/lib/money/split";

export type TripExpenseKind = "expense" | "settlement";

export type TripExpensePayer = { user_id: string; amount_minor: number };
export type TripExpenseShare = { user_id: string; share_minor: number; percent_bp: number | null };

export type TripExpense = {
  id: string;
  trip_id: string;
  kind: TripExpenseKind;
  title: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  spent_on: string;
  split_method: SplitMethod;
  note: string | null;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  version: number;
  payers: TripExpensePayer[];
  shares: TripExpenseShare[];
};

/** upsert_trip_expense 的 p_expense（id＝null 為新增；client_request_id 新增必填）。 */
export type TripExpenseInput = {
  id: string | null;
  client_request_id: string;
  kind: TripExpenseKind;
  title: string;
  amount_minor: number;
  currency: string;
  currency_exponent: number;
  spent_on: string;
  split_method: SplitMethod;
  note: string | null;
  payers: TripExpensePayer[];
  shares: TripExpenseShare[];
};

export const TRIP_EXPENSE_ERROR_CODES = [
  "not_authenticated",
  "not_trip_member",
  "expense_malformed",
  "expense_invalid_kind",
  "expense_invalid_title",
  "expense_invalid_amount",
  "expense_invalid_currency",
  "expense_invalid_date",
  "expense_invalid_split_method",
  "expense_invalid_note",
  "expense_payers_mismatch",
  "expense_shares_mismatch",
  "expense_percent_mismatch",
  "expense_split_mismatch",
  "expense_duplicate_participant",
  "expense_participant_not_member",
  "expense_invalid_settlement",
  "expense_not_found",
  "expense_deleted",
  "expense_conflict",
  "expense_limit_reached",
] as const;

export type TripExpenseServerErrorCode = (typeof TRIP_EXPENSE_ERROR_CODES)[number];
export type TripExpenseErrorCode = TripExpenseServerErrorCode | "network" | "unknown";

export class TripExpenseError extends Error {
  readonly code: TripExpenseErrorCode;
  constructor(code: TripExpenseErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TripExpenseError";
    this.code = code;
  }
}

// 長的代碼排前面，避免 "expense_deleted" 之類的前綴誤判（目前無重疊，仍保守處理）。
const CODES_BY_LENGTH = [...TRIP_EXPENSE_ERROR_CODES].sort((a, b) => b.length - a.length);

function rawErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [e.message, e.details, e.hint, e.code].filter((x) => typeof x === "string").join(" ");
  }
  return String(error);
}

/** 任意錯誤 → 錯誤碼（server RAISE 的代碼、網路錯誤、其他）。 */
export function tripExpenseErrorCode(error: unknown): TripExpenseErrorCode {
  if (error instanceof TripExpenseError) return error.code;
  const text = rawErrorText(error);
  for (const code of CODES_BY_LENGTH) {
    if (text.includes(code)) return code;
  }
  if (/failed to fetch|network|load failed|fetch failed|timed? ?out|offline/i.test(text)) {
    return "network";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  return "unknown";
}

function toError(error: unknown): TripExpenseError {
  return new TripExpenseError(tripExpenseErrorCode(error), rawErrorText(error) || undefined);
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

type ExpenseJoinedRow = Omit<TripExpense, "payers" | "shares"> & {
  deleted_at: string | null;
  trip_expense_payers?: TripExpensePayer[] | TripExpensePayer | null;
  trip_expense_shares?: TripExpenseShare[] | TripExpenseShare | null;
};

const EXPENSE_SELECT = `
  id,
  trip_id,
  kind,
  title,
  amount_minor,
  currency,
  currency_exponent,
  spent_on,
  split_method,
  note,
  created_by,
  updated_by,
  created_at,
  updated_at,
  version,
  deleted_at,
  trip_expense_payers ( user_id, amount_minor ),
  trip_expense_shares ( user_id, share_minor, percent_bp )
`;

function normalizeRow(row: ExpenseJoinedRow): TripExpense {
  return {
    id: row.id,
    trip_id: row.trip_id,
    kind: row.kind,
    title: row.title,
    amount_minor: Number(row.amount_minor),
    currency: String(row.currency).trim().toUpperCase(),
    currency_exponent: Number(row.currency_exponent),
    spent_on: row.spent_on,
    split_method: row.split_method,
    note: row.note,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version,
    payers: asArray(row.trip_expense_payers).map((p) => ({
      user_id: p.user_id,
      amount_minor: Number(p.amount_minor),
    })),
    shares: asArray(row.trip_expense_shares).map((s) => ({
      user_id: s.user_id,
      share_minor: Number(s.share_minor),
      percent_bp: s.percent_bp == null ? null : Number(s.percent_bp),
    })),
  };
}

// ── 記憶體快取（每個行程最近一次讀取結果；供總覽卡與記帳頁立即顯示） ──────────
const expensesCache = new Map<string, TripExpense[]>();
const cacheListeners = new Set<() => void>();

export function peekTripExpenses(tripId: string): TripExpense[] | null {
  return expensesCache.get(tripId) ?? null;
}

export function subscribeTripExpensesCache(listener: () => void): () => void {
  cacheListeners.add(listener);
  return () => {
    cacheListeners.delete(listener);
  };
}

function setCache(tripId: string, rows: TripExpense[]) {
  expensesCache.set(tripId, rows);
  for (const l of cacheListeners) l();
}

// 每個行程的讀取序號：較早發出的讀取晚回來時不得覆蓋較新的結果。
const listIssuedSeq = new Map<string, number>();
const listAppliedSeq = new Map<string, number>();
const listLoadedAt = new Map<string, number>();

/** 此行程最近一次成功讀取（且已寫入快取）的時間；沒有則為 null。 */
export function tripExpensesLoadedAt(tripId: string): number | null {
  return listLoadedAt.get(tripId) ?? null;
}

/** 讀取行程內未刪除的記帳紀錄（一次巢狀 select 帶出 payers 與 shares）。新到舊排序。 */
export async function listTripExpenses(tripId: string): Promise<TripExpense[]> {
  const seq = (listIssuedSeq.get(tripId) ?? 0) + 1;
  listIssuedSeq.set(tripId, seq);
  const { data, error } = await supabase
    .from("trip_expenses")
    .select(EXPENSE_SELECT)
    .eq("trip_id", tripId)
    .is("deleted_at", null)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw toError(error);
  const rows = ((data ?? []) as unknown as ExpenseJoinedRow[])
    .filter((r) => !r.deleted_at)
    .map(normalizeRow);
  if (seq > (listAppliedSeq.get(tripId) ?? 0)) {
    listAppliedSeq.set(tripId, seq);
    listLoadedAt.set(tripId, Date.now());
    setCache(tripId, rows);
  }
  return rows;
}

export type UpsertTripExpenseResult = { id: string; version: number; replayed: boolean };

/** 新增（expectedVersion＝null）或修改（expectedVersion 必填）。修改沒有冪等：重送會得到 expense_conflict。 */
export async function upsertTripExpense(
  tripId: string,
  input: TripExpenseInput,
  expectedVersion: number | null,
): Promise<UpsertTripExpenseResult> {
  let res;
  try {
    res = await supabase.rpc("upsert_trip_expense", {
      p_trip_id: tripId,
      p_expense: input as unknown as Json,
      p_expected_version: expectedVersion,
    });
  } catch (e) {
    throw toError(e);
  }
  if (res.error) throw toError(res.error);
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) throw new TripExpenseError("unknown", "upsert_trip_expense returned no row");
  return { id: row.expense_id, version: row.expense_version, replayed: Boolean(row.replayed) };
}

export async function deleteTripExpense(
  expenseId: string,
  expectedVersion: number,
): Promise<{ id: string; version: number }> {
  let res;
  try {
    res = await supabase.rpc("delete_trip_expense", {
      p_expense_id: expenseId,
      p_expected_version: expectedVersion,
    });
  } catch (e) {
    throw toError(e);
  }
  if (res.error) throw toError(res.error);
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) throw new TripExpenseError("unknown", "delete_trip_expense returned no row");
  return { id: row.expense_id, version: row.expense_version };
}

export async function restoreTripExpense(
  expenseId: string,
): Promise<{ id: string; version: number }> {
  let res;
  try {
    res = await supabase.rpc("restore_trip_expense", { p_expense_id: expenseId });
  } catch (e) {
    throw toError(e);
  }
  if (res.error) throw toError(res.error);
  const row = Array.isArray(res.data) ? res.data[0] : null;
  if (!row) throw new TripExpenseError("unknown", "restore_trip_expense returned no row");
  return { id: row.expense_id, version: row.expense_version };
}

/** client_request_id（uuid v4）。 */
export function newClientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
