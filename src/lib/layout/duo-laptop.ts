/**
 * iPhone Duo「筆電半開」姿勢判斷（純邏輯）。
 * 不得 import "@/..."，需相容 node --experimental-strip-types。
 *
 * 筆電姿勢＝半開（partiallyOpen）且摺痕為橫向：上半部看（地圖）、下半部操作（行程內容）。
 * 條件全部成立才算：
 *   1. supported 為 true，status 為 "partiallyOpen"（fullyOpen 攤平、closed、unknown 皆不算）；
 *   2. 有一個 active 的 division，且 width > height（橫向摺痕）；
 *   3. division 與目前 viewport 方向一致：寬度 ≥ viewport 寬的 80%，x 範圍與 y＋height 皆落在 viewport 內；
 *      （旋轉動畫期間原生座標與 viewport 可能短暫不一致，此時一律判定為非筆電）
 *   4. 摺痕上方（0～y）與下方（y＋height～viewport 高）各至少 200px。
 * 任何不合法數值（NaN、負數、非 number）一律視為非筆電姿勢。
 */

export const LAPTOP_MIN_FOLD_WIDTH_RATIO = 0.8;
export const LAPTOP_MIN_HALF_HEIGHT = 200;
/** 原生座標四捨五入誤差容許量（px） */
const EDGE_TOLERANCE = 1;

export type DuoLaptopRectInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
};

export type DuoLaptopHingeInput = {
  supported: boolean;
  status: string;
  divisions: readonly DuoLaptopRectInput[];
};

export type DuoLaptopViewport = {
  width: number;
  height: number;
};

export type DuoLaptop = { laptop: false } | { laptop: true; foldTop: number; foldBottom: number };

export const NOT_DUO_LAPTOP: DuoLaptop = Object.freeze({ laptop: false }) as DuoLaptop;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function laptopFold(
  rect: unknown,
  vw: number,
  vh: number,
): { foldTop: number; foldBottom: number } | null {
  if (!rect || typeof rect !== "object") return null;
  const r = rect as Record<string, unknown>;
  if (r.active !== true) return null;
  const { x, y, width, height } = r;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return null;
  if (width <= 0 || height < 0 || width <= height) return null;
  if (width < vw * LAPTOP_MIN_FOLD_WIDTH_RATIO) return null;
  if (x < -EDGE_TOLERANCE || x + width > vw + EDGE_TOLERANCE) return null;
  if (y < 0 || y + height > vh + EDGE_TOLERANCE) return null;
  const foldTop = y;
  const foldBottom = y + height;
  if (foldTop < LAPTOP_MIN_HALF_HEIGHT) return null;
  if (vh - foldBottom < LAPTOP_MIN_HALF_HEIGHT) return null;
  return { foldTop, foldBottom };
}

export function resolveDuoLaptop(hinge: unknown, viewport: unknown): DuoLaptop {
  if (!hinge || typeof hinge !== "object" || !viewport || typeof viewport !== "object") {
    return NOT_DUO_LAPTOP;
  }
  const h = hinge as Record<string, unknown>;
  const v = viewport as Record<string, unknown>;
  if (h.supported !== true || h.status !== "partiallyOpen") return NOT_DUO_LAPTOP;
  if (!Array.isArray(h.divisions)) return NOT_DUO_LAPTOP;
  const vw = v.width;
  const vh = v.height;
  if (!finite(vw) || !finite(vh) || vw <= 0 || vh <= 0) return NOT_DUO_LAPTOP;
  for (const rect of h.divisions) {
    const fold = laptopFold(rect, vw, vh);
    if (fold)
      return Object.freeze({ laptop: true, foldTop: fold.foldTop, foldBottom: fold.foldBottom });
  }
  return NOT_DUO_LAPTOP;
}

export function sameDuoLaptop(a: DuoLaptop, b: DuoLaptop): boolean {
  if (a.laptop !== b.laptop) return false;
  if (!a.laptop || !b.laptop) return true;
  return a.foldTop === b.foldTop && a.foldBottom === b.foldBottom;
}

/**
 * iPhone Duo「直向攤平」：完全展開（fullyOpen）、viewport 直向（高 > 寬），版型照筆電（上半部看、下半部操作）。
 * 是否為雙欄由呼叫端（_app.tsx）以 duo-layout 判斷並優先處理（雙欄 > 筆電 > 直向攤平）。
 * 分界：
 *   1. 有 active 的橫向 division 且通過與筆電相同的檢查（寬度、範圍、上下各 ≥ 200px）→ 用該 division；
 *   2. 有 active 的 division 但沒有一個合格（直向摺痕、旋轉過渡中座標不一致等）→ 非直向攤平；
 *   3. 原生沒有回報任何 active division → 以 viewport 中線為分界（foldTop＝foldBottom＝高度一半），上下各 ≥ 200px。
 * 任何不合法數值一律視為非直向攤平。
 */
export type DuoFlatPortrait =
  | { flat: false }
  | { flat: true; foldTop: number; foldBottom: number };

export const NOT_DUO_FLAT_PORTRAIT: DuoFlatPortrait = Object.freeze({
  flat: false,
}) as DuoFlatPortrait;

export function resolveDuoFlatPortrait(hinge: unknown, viewport: unknown): DuoFlatPortrait {
  if (!hinge || typeof hinge !== "object" || !viewport || typeof viewport !== "object") {
    return NOT_DUO_FLAT_PORTRAIT;
  }
  const h = hinge as Record<string, unknown>;
  const v = viewport as Record<string, unknown>;
  if (h.supported !== true || h.status !== "fullyOpen") return NOT_DUO_FLAT_PORTRAIT;
  if (!Array.isArray(h.divisions)) return NOT_DUO_FLAT_PORTRAIT;
  const vw = v.width;
  const vh = v.height;
  if (!finite(vw) || !finite(vh) || vw <= 0 || vh <= 0) return NOT_DUO_FLAT_PORTRAIT;
  if (vh <= vw) return NOT_DUO_FLAT_PORTRAIT;
  let hasActive = false;
  for (const rect of h.divisions) {
    if (rect && typeof rect === "object" && (rect as Record<string, unknown>).active === true) {
      hasActive = true;
    }
    const fold = laptopFold(rect, vw, vh);
    if (fold) {
      return Object.freeze({ flat: true, foldTop: fold.foldTop, foldBottom: fold.foldBottom });
    }
  }
  if (hasActive) return NOT_DUO_FLAT_PORTRAIT;
  const mid = vh / 2;
  if (mid < LAPTOP_MIN_HALF_HEIGHT) return NOT_DUO_FLAT_PORTRAIT;
  return Object.freeze({ flat: true, foldTop: mid, foldBottom: mid });
}

export function sameDuoFlatPortrait(a: DuoFlatPortrait, b: DuoFlatPortrait): boolean {
  if (a.flat !== b.flat) return false;
  if (!a.flat || !b.flat) return true;
  return a.foldTop === b.foldTop && a.foldBottom === b.foldBottom;
}

/**
 * iPhone Duo「上下版型」（筆電／直向攤平）合一判斷，供單一穩定化 store 使用（#H3-3）。
 * 回傳 null＝不確定（過渡狀態，沒有新資訊：呼叫端維持目前版型、不提交）；其餘為明確結果。
 *
 * 明確：
 *   - "laptop"／"flat-portrait"：resolveDuoLaptop／resolveDuoFlatPortrait 成立（筆電優先）；
 *   - "none"：hinge 非物件或 supported 不為 true（unsupported）、status "closed"；
 *     有 active division 且方向與 viewport 一致但不構成上下版型（橫向 viewport＋直向摺痕＝書本／雙欄；
 *     直向 viewport＋合格範圍的橫向摺痕但上下不足 200px）；
 *     橫向 viewport 且沒有任何 active division（攤平橫向）。
 * 不確定（null）：
 *   - status 不是 partiallyOpen／fullyOpen／closed（unknown 等）；
 *   - viewport 不合法（0、NaN 等，旋轉中可能短暫出現）；
 *   - divisions 非陣列，或有 active division 但沒有一個與 viewport 方向／範圍一致（旋轉過渡中座標不一致）；
 *   - 直向 viewport、partiallyOpen 但沒有 active division（division 暫時消失）。
 */
export type DuoPostureKind = "none" | "laptop" | "flat-portrait";

export type DuoPosture =
  | { posture: "none" }
  | { posture: "laptop" | "flat-portrait"; foldTop: number; foldBottom: number };

export const DUO_POSTURE_NONE: DuoPosture = Object.freeze({ posture: "none" }) as DuoPosture;

/** active division 與 viewport 方向／範圍一致：橫向摺痕（直向 viewport）或直向摺痕（橫向 viewport）。 */
function divisionMatchesViewport(rect: Record<string, unknown>, vw: number, vh: number): boolean {
  const { x, y, width, height } = rect;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height)) return false;
  if (width < 0 || height < 0) return false;
  if (x < -EDGE_TOLERANCE || x + width > vw + EDGE_TOLERANCE) return false;
  if (y < -EDGE_TOLERANCE || y + height > vh + EDGE_TOLERANCE) return false;
  if (width > height) return width >= vw * LAPTOP_MIN_FOLD_WIDTH_RATIO;
  if (height > width) return vw > vh && height >= vh * LAPTOP_MIN_FOLD_WIDTH_RATIO;
  return false;
}

export function classifyDuoPosture(hinge: unknown, viewport: unknown): DuoPosture | null {
  if (!hinge || typeof hinge !== "object") return DUO_POSTURE_NONE;
  const h = hinge as Record<string, unknown>;
  if (h.supported !== true) return DUO_POSTURE_NONE;
  if (h.status === "closed") return DUO_POSTURE_NONE;
  if (h.status !== "partiallyOpen" && h.status !== "fullyOpen") return null;
  if (!viewport || typeof viewport !== "object") return null;
  const v = viewport as Record<string, unknown>;
  const vw = v.width;
  const vh = v.height;
  if (!finite(vw) || !finite(vh) || vw <= 0 || vh <= 0) return null;
  if (!Array.isArray(h.divisions)) return null;

  const laptop = resolveDuoLaptop(hinge, viewport);
  if (laptop.laptop) {
    return Object.freeze({
      posture: "laptop",
      foldTop: laptop.foldTop,
      foldBottom: laptop.foldBottom,
    });
  }
  const flat = resolveDuoFlatPortrait(hinge, viewport);
  if (flat.flat) {
    return Object.freeze({
      posture: "flat-portrait",
      foldTop: flat.foldTop,
      foldBottom: flat.foldBottom,
    });
  }

  let hasActive = false;
  for (const rect of h.divisions) {
    if (!rect || typeof rect !== "object") continue;
    const r = rect as Record<string, unknown>;
    if (r.active !== true) continue;
    hasActive = true;
    if (divisionMatchesViewport(r, vw, vh)) return DUO_POSTURE_NONE;
  }
  if (hasActive) return null;
  if (vw > vh) return DUO_POSTURE_NONE;
  return null;
}

export function sameDuoPosture(a: DuoPosture, b: DuoPosture): boolean {
  if (a.posture !== b.posture) return false;
  if (a.posture === "none" || b.posture === "none") return true;
  return a.foldTop === b.foldTop && a.foldBottom === b.foldBottom;
}
