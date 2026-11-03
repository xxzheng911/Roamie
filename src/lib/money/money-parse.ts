// 金額字串 → 最小單位整數（amount_minor）。全程不經浮點：
// 以字串切分整數／小數部分後用 BigInt 組合。

export const MAX_AMOUNT_MINOR = 10_000_000_000_000; // 10^13，與 server 上限一致

export type MoneyParseFailure =
  | "empty"
  | "invalid_format"
  | "invalid_exponent"
  | "too_many_decimals"
  | "not_positive"
  | "too_large";

export type MoneyParseResult =
  | { ok: true; minor: number }
  | { ok: false; reason: MoneyParseFailure };

const INT_WITH_GROUPING = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

/**
 * 解析使用者輸入的金額。
 * - 前後空白 trim；接受千分位逗號（必須為合法 3 位分組，例如 1,234,567）。
 * - 小數點為「.」；小數位超過 exponent 且多出的位數非 0 時回 too_many_decimals
 *   （多出的位數全為 0 時接受，例如 JPY "1000.00"）。
 * - 0 與負數回 not_positive；超過 10^13 回 too_large。
 */
export function parseMoneyInput(input: string, exponent: number): MoneyParseResult {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4) {
    return { ok: false, reason: "invalid_exponent" };
  }
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw === "") return { ok: false, reason: "empty" };

  let body = raw;
  if (body.startsWith("-")) {
    // 先確認格式合法，再判定為負數，避免 "-abc" 被誤報為 not_positive。
    return isWellFormed(body.slice(1))
      ? { ok: false, reason: "not_positive" }
      : { ok: false, reason: "invalid_format" };
  }
  if (body.startsWith("+")) body = body.slice(1);
  if (!isWellFormed(body)) return { ok: false, reason: "invalid_format" };

  const dot = body.indexOf(".");
  const intPartRaw = dot === -1 ? body : body.slice(0, dot);
  let fracPart = dot === -1 ? "" : body.slice(dot + 1);
  const intPart = intPartRaw.replace(/,/g, "") || "0";

  if (fracPart.length > exponent) {
    const extra = fracPart.slice(exponent);
    if (/[^0]/.test(extra)) return { ok: false, reason: "too_many_decimals" };
    fracPart = fracPart.slice(0, exponent);
  }

  const minorBig = BigInt(intPart + fracPart.padEnd(exponent, "0"));
  if (minorBig <= 0n) return { ok: false, reason: "not_positive" };
  if (minorBig > BigInt(MAX_AMOUNT_MINOR)) return { ok: false, reason: "too_large" };
  const minor = Number(minorBig);
  if (!Number.isSafeInteger(minor)) return { ok: false, reason: "too_large" };
  return { ok: true, minor };
}

function isWellFormed(body: string): boolean {
  if (body === "" || body === ".") return false;
  const dot = body.indexOf(".");
  if (dot !== body.lastIndexOf(".")) return false;
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? "" : body.slice(dot + 1);
  if (intPart !== "" && !INT_WITH_GROUPING.test(intPart)) return false;
  if (fracPart !== "" && !/^\d+$/.test(fracPart)) return false;
  return true;
}

/** 最小單位整數 → 不含千分位的十進位字串（例如 1234, 2 → "12.34"），供編輯欄位回填。 */
export function minorToDecimalString(minor: number, exponent: number): string {
  if (!Number.isSafeInteger(minor)) throw new RangeError("minor must be a safe integer");
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 4)
    throw new RangeError("invalid exponent");
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const intPart = exponent === 0 ? digits : digits.slice(0, digits.length - exponent);
  const fracPart = exponent === 0 ? "" : digits.slice(digits.length - exponent);
  const body = fracPart && /[^0]/.test(fracPart) ? `${intPart}.${fracPart}` : intPart;
  return negative ? `-${body}` : body;
}
