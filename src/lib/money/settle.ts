// 結算：每個幣別獨立計算，不同幣別絕不相加。
//   淨額 = 已付 − 應付 + 已還出 − 已收回（settlement 沖銷欠款）。
//   settlement 紀錄：付款人＝還錢的人，分攤對象＝收錢的人。
//   已軟刪除（deleted_at 非空）的紀錄不計入。
//   建議轉帳：欠款與墊款各自由大到小（同金額依 user_id）貪婪配對，最多「有餘額人數 − 1」筆。
// 所有輸出依 currency／user_id 排序，與輸入順序無關。

import { compareUserId, normalizeUserId } from "./split.ts";

export type ExpenseKind = "expense" | "settlement";

export interface SettleRecordInput {
  kind: ExpenseKind;
  currency: string;
  currency_exponent: number;
  amount_minor: number;
  deleted_at?: string | null;
  payers: Array<{ user_id: string; amount_minor: number }>;
  shares: Array<{ user_id: string; share_minor: number }>;
}

export interface MemberBalance {
  user_id: string;
  /** 一般支出中此人墊付的金額。 */
  paid_minor: number;
  /** 一般支出中此人應分攤的金額。 */
  owed_minor: number;
  /** 此人透過 settlement 還出去的金額。 */
  settlement_sent_minor: number;
  /** 此人透過 settlement 收到的金額。 */
  settlement_received_minor: number;
  /** 正＝別人欠他；負＝他欠別人。 */
  net_minor: number;
}

export interface SuggestedTransfer {
  from_user_id: string;
  to_user_id: string;
  amount_minor: number;
}

export interface CurrencySettlement {
  currency: string;
  currency_exponent: number;
  members: MemberBalance[];
  transfers: SuggestedTransfer[];
  /** 任一數值超出 Number 安全整數範圍時為 true（此時數值不可信，畫面應提示）。 */
  precision_exceeded: boolean;
}

interface Acc {
  paid: bigint;
  owed: bigint;
  sent: bigint;
  received: bigint;
}

/**
 * @param records 行程內所有記帳紀錄（含已刪除者；會自動排除）。
 * @param memberIds 選填：要一併列出的成員（即使該幣別沒有紀錄也顯示 0）。
 */
export function computeSettlements(
  records: SettleRecordInput[],
  memberIds: string[] = [],
): CurrencySettlement[] {
  // 以 currency + exponent 分組：同幣別若快照小數位不同，最小單位不可相加。
  const groups = new Map<string, { currency: string; exponent: number; acc: Map<string, Acc> }>();

  const getAcc = (m: Map<string, Acc>, uid: string): Acc => {
    let a = m.get(uid);
    if (!a) {
      a = { paid: 0n, owed: 0n, sent: 0n, received: 0n };
      m.set(uid, a);
    }
    return a;
  };

  for (const r of records) {
    if (r.deleted_at) continue;
    const currency = String(r.currency).trim().toUpperCase();
    const exponent = r.currency_exponent;
    const key = `${currency}:${exponent}`;
    let g = groups.get(key);
    if (!g) {
      g = { currency, exponent, acc: new Map() };
      groups.set(key, g);
    }
    const isSettlement = r.kind === "settlement";
    for (const p of r.payers) {
      const a = getAcc(g.acc, normalizeUserId(p.user_id));
      if (isSettlement) a.sent += BigInt(p.amount_minor);
      else a.paid += BigInt(p.amount_minor);
    }
    for (const s of r.shares) {
      const a = getAcc(g.acc, normalizeUserId(s.user_id));
      if (isSettlement) a.received += BigInt(s.share_minor);
      else a.owed += BigInt(s.share_minor);
    }
  }

  const extraMembers = memberIds.map(normalizeUserId);
  const out: CurrencySettlement[] = [];

  for (const g of groups.values()) {
    for (const uid of extraMembers) getAcc(g.acc, uid);
    let precisionExceeded = false;
    const toNum = (v: bigint): number => {
      const n = Number(v);
      if (!Number.isSafeInteger(n)) precisionExceeded = true;
      return n;
    };

    const uids = [...g.acc.keys()].sort(compareUserId);
    const nets = new Map<string, bigint>();
    const members: MemberBalance[] = uids.map((uid) => {
      const a = g.acc.get(uid) as Acc;
      const net = a.paid - a.owed + a.sent - a.received;
      nets.set(uid, net);
      return {
        user_id: uid,
        paid_minor: toNum(a.paid),
        owed_minor: toNum(a.owed),
        settlement_sent_minor: toNum(a.sent),
        settlement_received_minor: toNum(a.received),
        net_minor: toNum(net),
      };
    });

    out.push({
      currency: g.currency,
      currency_exponent: g.exponent,
      members,
      transfers: suggestTransfers(nets).map((t) => ({
        from_user_id: t.from,
        to_user_id: t.to,
        amount_minor: toNum(t.amount),
      })),
      precision_exceeded: precisionExceeded,
    });
  }

  return out.sort((a, b) =>
    a.currency !== b.currency
      ? a.currency < b.currency
        ? -1
        : 1
      : a.currency_exponent - b.currency_exponent,
  );
}

function byAmountDescThenId(
  a: { uid: string; amt: bigint },
  b: { uid: string; amt: bigint },
): number {
  if (a.amt !== b.amt) return a.amt > b.amt ? -1 : 1;
  return compareUserId(a.uid, b.uid);
}

/** 貪婪配對；每一步至少讓一人歸零，故筆數 ≤ 有餘額人數 − 1。 */
function suggestTransfers(
  nets: Map<string, bigint>,
): Array<{ from: string; to: string; amount: bigint }> {
  const debtors: Array<{ uid: string; amt: bigint }> = [];
  const creditors: Array<{ uid: string; amt: bigint }> = [];
  for (const [uid, net] of nets) {
    if (net < 0n) debtors.push({ uid, amt: -net });
    else if (net > 0n) creditors.push({ uid, amt: net });
  }
  debtors.sort(byAmountDescThenId);
  creditors.sort(byAmountDescThenId);

  const transfers: Array<{ from: string; to: string; amount: bigint }> = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = d.amt < c.amt ? d.amt : c.amt;
    if (amount > 0n) transfers.push({ from: d.uid, to: c.uid, amount });
    d.amt -= amount;
    c.amt -= amount;
    if (d.amt === 0n) i += 1;
    if (c.amt === 0n) j += 1;
  }
  return transfers;
}
