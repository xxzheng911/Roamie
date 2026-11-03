// 分攤計算：必須與 server（upsert_trip_expense）完全一致，否則會回 expense_split_mismatch。
//   排序：user_id 由小到大（uuid 小寫十六進位字串比較）。
//   equal  ：q = floor(總額 / n)，r = 總額 − q×n；排序後前 r 人 q+1，其餘 q。
//   percent：base = floor(總額 × bp / 10000)；剩餘零頭依 (總額 × bp) % 10000 由大到小、
//            同餘數依 user_id，每人 +1。bp 總和必須為 10000。
//   exact  ：分攤總和必須等於總額。
// 輸出一律依 user_id 排序，與輸入順序無關。

import { MAX_AMOUNT_MINOR } from "./money-parse.ts";

export type SplitMethod = "equal" | "exact" | "percent";

export interface ShareResult {
  user_id: string;
  share_minor: number;
  percent_bp: number | null;
}

export type SplitFailure =
  | "invalid_amount"
  | "no_participants"
  | "too_many_participants"
  | "duplicate_participant"
  | "invalid_user_id"
  | "invalid_percent"
  | "percent_sum_mismatch"
  | "invalid_share"
  | "exact_sum_mismatch";

export type SplitResult = { ok: true; shares: ShareResult[] } | { ok: false; reason: SplitFailure };

export const MAX_PARTICIPANTS = 50;
export const PERCENT_BP_TOTAL = 10000;

export function normalizeUserId(id: string): string {
  return String(id).trim().toLowerCase();
}

/** uuid 小寫十六進位字串比較（等同 Postgres uuid 位元組順序）。 */
export function compareUserId(a: string, b: string): number {
  const x = normalizeUserId(a);
  const y = normalizeUserId(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function isValidAmount(total: number): boolean {
  return Number.isSafeInteger(total) && total >= 1 && total <= MAX_AMOUNT_MINOR;
}

function checkParticipants(ids: string[]): SplitFailure | null {
  if (ids.length === 0) return "no_participants";
  if (ids.length > MAX_PARTICIPANTS) return "too_many_participants";
  if (ids.some((id) => id === "")) return "invalid_user_id";
  if (new Set(ids).size !== ids.length) return "duplicate_participant";
  return null;
}

/** 平均分攤。 */
export function splitEqual(total: number, userIds: string[]): SplitResult {
  if (!isValidAmount(total)) return { ok: false, reason: "invalid_amount" };
  const ids = userIds.map(normalizeUserId);
  const bad = checkParticipants(ids);
  if (bad) return { ok: false, reason: bad };
  const sorted = [...ids].sort(compareUserId);
  const n = sorted.length;
  const q = Math.floor(total / n);
  const r = total - q * n;
  return {
    ok: true,
    shares: sorted.map((user_id, i) => ({
      user_id,
      share_minor: i < r ? q + 1 : q,
      percent_bp: null,
    })),
  };
}

/** 百分比分攤（basis points，10000 = 100%）。 */
export function splitPercent(
  total: number,
  participants: Array<{ user_id: string; percent_bp: number }>,
): SplitResult {
  if (!isValidAmount(total)) return { ok: false, reason: "invalid_amount" };
  const rows = participants.map((p) => ({ user_id: normalizeUserId(p.user_id), bp: p.percent_bp }));
  const bad = checkParticipants(rows.map((r) => r.user_id));
  if (bad) return { ok: false, reason: bad };
  if (rows.some((r) => !Number.isInteger(r.bp) || r.bp < 0 || r.bp > PERCENT_BP_TOTAL)) {
    return { ok: false, reason: "invalid_percent" };
  }
  if (rows.reduce((s, r) => s + r.bp, 0) !== PERCENT_BP_TOTAL) {
    return { ok: false, reason: "percent_sum_mismatch" };
  }

  // 總額 × bp 最大 10^17，超出安全整數 → 用 BigInt。
  const T = BigInt(total);
  const D = BigInt(PERCENT_BP_TOTAL);
  const calc = rows.map((r) => {
    const prod = T * BigInt(r.bp);
    return { user_id: r.user_id, bp: r.bp, base: prod / D, rem: prod % D };
  });
  const leftover = Number(T - calc.reduce((s, c) => s + c.base, 0n));
  const order = [...calc].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    return compareUserId(a.user_id, b.user_id);
  });
  const bonus = new Set(order.slice(0, leftover).map((c) => c.user_id));

  const shares = calc
    .map((c) => ({
      user_id: c.user_id,
      share_minor: Number(c.base) + (bonus.has(c.user_id) ? 1 : 0),
      percent_bp: c.bp,
    }))
    .sort((a, b) => compareUserId(a.user_id, b.user_id));
  return { ok: true, shares };
}

/** 將 10000 bp 依 equal 規則平均分給參與者（供百分比模式的預設值）。 */
export function evenPercentBp(userIds: string[]): Array<{ user_id: string; percent_bp: number }> {
  const r = splitEqual(PERCENT_BP_TOTAL, userIds);
  if (!r.ok) return [];
  return r.shares.map((s) => ({ user_id: s.user_id, percent_bp: s.share_minor }));
}

export interface ExactCheck {
  ok: boolean;
  reason: SplitFailure | null;
  /** 依 user_id 排序；格式有誤時為空陣列。 */
  shares: ShareResult[];
  sum: number;
  /** 總額 − 分攤總和：正＝還差、負＝超出、0＝剛好。 */
  difference: number;
}

/** 指定金額分攤：驗證總和並回報差額（供畫面即時顯示）。 */
export function checkExactSplit(
  total: number,
  participants: Array<{ user_id: string; share_minor: number }>,
): ExactCheck {
  const rows = participants.map((p) => ({
    user_id: normalizeUserId(p.user_id),
    share_minor: p.share_minor,
  }));
  const validShares = rows.every(
    (r) =>
      Number.isSafeInteger(r.share_minor) &&
      r.share_minor >= 0 &&
      r.share_minor <= MAX_AMOUNT_MINOR,
  );
  const sum = validShares ? rows.reduce((s, r) => s + r.share_minor, 0) : 0;
  const safeTotal = Number.isSafeInteger(total) ? total : 0;
  const difference = safeTotal - sum;
  const shares: ShareResult[] = validShares
    ? rows
        .map((r) => ({ user_id: r.user_id, share_minor: r.share_minor, percent_bp: null }))
        .sort((a, b) => compareUserId(a.user_id, b.user_id))
    : [];

  let reason: SplitFailure | null = null;
  if (!isValidAmount(total)) reason = "invalid_amount";
  else reason = checkParticipants(rows.map((r) => r.user_id));
  if (!reason && !validShares) reason = "invalid_share";
  if (!reason && difference !== 0) reason = "exact_sum_mismatch";
  return { ok: reason === null, reason, shares, sum, difference };
}

/** exact 的 SplitResult 版本（與 equal／percent 介面一致）。 */
export function splitExact(
  total: number,
  participants: Array<{ user_id: string; share_minor: number }>,
): SplitResult {
  const c = checkExactSplit(total, participants);
  return c.ok ? { ok: true, shares: c.shares } : { ok: false, reason: c.reason ?? "invalid_share" };
}
