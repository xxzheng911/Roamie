// 行程子頁（共同記帳、我的行李）與行程總覽之間的返回標記（sessionStorage）：
// - 「從總覽進入」標記（tripId＋時間戳）：總覽卡點擊時留下；子頁掛載時讀取並立即消費。
//   只有標記屬於同一 tripId 且剛留下（FRESH_MS 內）時，子頁「返回」才用 history.back；否則 replace 導到總覽分頁。
// - 「返回總覽」標記（tripId＋時間戳）：從總覽進入的子頁離開時留下；行程頁掛載時讀取，
//   若為總覽分頁 → 還原總覽捲動位置（沿用 trip-detail-view-state 的分頁捲動紀錄），使用一次即清除。
// 記帳頁沿用原本的 key 與 export 名稱（行為不變）；行李頁使用獨立的 key。

/** 標記有效時間（點卡片到子頁掛載、離開子頁到行程頁掛載都應在此時間內） */
const FRESH_MS = 30_000;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isFresh(at: number | null): boolean {
  if (at == null) return true; // 舊格式（只有 tripId）視為有效；新寫入一律帶時間戳
  const age = Date.now() - at;
  return Number.isFinite(age) && age >= 0 && age <= FRESH_MS;
}

function parseAt(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

type ReturnKeys = { from: string; fromAt: string; back: string };

const EXPENSES_KEYS: ReturnKeys = {
  from: "roamie:trip-expenses-return",
  fromAt: "roamie:trip-expenses-return-at",
  back: "roamie:trip-expenses-back",
};

const PACKING_KEYS: ReturnKeys = {
  from: "roamie:trip-packing-return",
  fromAt: "roamie:trip-packing-return-at",
  back: "roamie:trip-packing-back",
};

function markFrom(keys: ReturnKeys, tripId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(keys.from, tripId);
    s.setItem(keys.fromAt, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function readFrom(keys: ReturnKeys, tripId: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    if (s.getItem(keys.from) !== tripId) return false;
    return isFresh(parseAt(s.getItem(keys.fromAt)));
  } catch {
    return false;
  }
}

function clearFrom(keys: ReturnKeys): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(keys.from);
    s.removeItem(keys.fromAt);
  } catch {
    /* ignore */
  }
}

function markBack(keys: ReturnKeys, tripId: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(keys.back, JSON.stringify({ tripId, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

function readBack(s: Storage, keys: ReturnKeys): { tripId: string; at: number } | null {
  try {
    const raw = s.getItem(keys.back);
    if (!raw) return null;
    const v = JSON.parse(raw) as { tripId?: unknown; at?: unknown };
    if (typeof v.tripId !== "string" || typeof v.at !== "number") return null;
    return { tripId: v.tripId, at: v.at };
  } catch {
    return null;
  }
}

function readReturn(keys: ReturnKeys, tripId: string): boolean {
  const s = storage();
  if (!s) return false;
  const back = readBack(s, keys);
  if (back && back.tripId === tripId && isFresh(back.at)) return true;
  return readFrom(keys, tripId);
}

function clearReturn(keys: ReturnKeys): void {
  const s = storage();
  if (!s) return;
  clearFrom(keys);
  try {
    s.removeItem(keys.back);
  } catch {
    /* ignore */
  }
}

// ── 共同記帳 ─────────────────────────────────────────────────────────────

export function markTripExpensesFromOverview(tripId: string): void {
  markFrom(EXPENSES_KEYS, tripId);
}

/** 記帳頁掛載時：是否剛從同一行程的總覽卡進入（只讀；消費請呼叫 clearTripExpensesFromOverview）。 */
export function readTripExpensesFromOverview(tripId: string): boolean {
  return readFrom(EXPENSES_KEYS, tripId);
}

export function clearTripExpensesFromOverview(): void {
  clearFrom(EXPENSES_KEYS);
}

/** 從總覽進入的記帳頁離開時留下「返回總覽」標記（供行程頁還原總覽捲動）。 */
export function markTripExpensesBackToOverview(tripId: string): void {
  markBack(EXPENSES_KEYS, tripId);
}

/** 行程頁掛載時：是否為同一行程、剛從記帳頁返回（或剛點總覽卡尚未進入記帳頁）。 */
export function readTripExpensesReturn(tripId: string): boolean {
  return readReturn(EXPENSES_KEYS, tripId);
}

export function clearTripExpensesReturn(): void {
  clearReturn(EXPENSES_KEYS);
}

// ── 我的行李 ─────────────────────────────────────────────────────────────

export function markTripPackingFromOverview(tripId: string): void {
  markFrom(PACKING_KEYS, tripId);
}

/** 行李頁掛載時：是否剛從同一行程的總覽卡進入（只讀；消費請呼叫 clearTripPackingFromOverview）。 */
export function readTripPackingFromOverview(tripId: string): boolean {
  return readFrom(PACKING_KEYS, tripId);
}

export function clearTripPackingFromOverview(): void {
  clearFrom(PACKING_KEYS);
}

/** 從總覽進入的行李頁離開時留下「返回總覽」標記。 */
export function markTripPackingBackToOverview(tripId: string): void {
  markBack(PACKING_KEYS, tripId);
}

export function readTripPackingReturn(tripId: string): boolean {
  return readReturn(PACKING_KEYS, tripId);
}

export function clearTripPackingReturn(): void {
  clearReturn(PACKING_KEYS);
}

// ── 行程頁使用：任一子頁返回總覽 ─────────────────────────────────────────

/** 行程頁掛載時：是否剛從同一行程的記帳頁或行李頁返回總覽。 */
export function readTripOverviewSubpageReturn(tripId: string): boolean {
  return readTripExpensesReturn(tripId) || readTripPackingReturn(tripId);
}

export function clearTripOverviewSubpageReturn(): void {
  clearTripExpensesReturn();
  clearTripPackingReturn();
}
