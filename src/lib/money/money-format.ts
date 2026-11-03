// 金額格式化：依語系 Intl.NumberFormat，小數位強制為快照 exponent，
// 小數部分為 0 時省略小數。行程內有兩種以上幣別時可在金額旁加代碼。

import { minorToDecimalString } from "./money-parse.ts";

export interface FormatMoneyOptions {
  /** 例如 "zh-TW"；undefined 時使用執行環境預設語系。 */
  locale?: string;
  /** 是否在金額旁附加 ISO 代碼（例如 "$1,000 TWD"）。預設 false。 */
  showCode?: boolean;
  /** 是否顯示貨幣符號；false 時只輸出數字（showCode 仍有效）。預設 true。 */
  showSymbol?: boolean;
}

/** 行程內出現兩種以上幣別時應顯示代碼。 */
export function shouldShowCurrencyCode(currencies: Iterable<string>): boolean {
  const set = new Set<string>();
  for (const c of currencies) set.add(String(c).trim().toUpperCase());
  return set.size >= 2;
}

/**
 * 將最小單位整數格式化。minor 可為負數（淨額顯示用）。
 * exponent 必須是該筆紀錄的快照小數位（0–4）。
 */
export function formatMoney(
  minor: number,
  currency: string,
  exponent: number,
  options: FormatMoneyOptions = {},
): string {
  const code = String(currency).trim().toUpperCase();
  const decimal = minorToDecimalString(minor, exponent); // 驗證 minor／exponent
  const hasFraction = decimal.includes(".");
  const digits = hasFraction ? exponent : 0;
  const showSymbol = options.showSymbol !== false;
  // 直接傳十進位字串：支援 Intl.NumberFormat v3 的引擎可精確格式化大額；舊引擎會轉成 Number（與舊行為相同）。
  const value = decimal as unknown as number;

  let text: string;
  try {
    const nf = new Intl.NumberFormat(options.locale, {
      ...(showSymbol
        ? { style: "currency" as const, currency: code, currencyDisplay: "symbol" as const }
        : {}),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    text = nf.format(value);
  } catch {
    text = fallbackFormat(decimal, showSymbol ? code : null);
    // 退回格式已含代碼，不需再附加。
    return options.showCode && !showSymbol ? `${text} ${code}` : text;
  }

  if (options.showCode && !text.includes(code)) {
    text = `${text} ${code}`;
  }
  return text;
}

function fallbackFormat(decimal: string, code: string | null): string {
  const negative = decimal.startsWith("-");
  const body = negative ? decimal.slice(1) : decimal;
  const [intPart, fracPart] = body.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const num = fracPart ? `${grouped}.${fracPart}` : grouped;
  const signed = negative ? `-${num}` : num;
  return code ? `${code} ${signed}` : signed;
}
