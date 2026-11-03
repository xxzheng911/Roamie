// 可選幣別清單 = ISO 4217 表 ∩ Intl.supportedValuesOf("currency")。
// iOS 15.0–15.3 沒有 Intl.supportedValuesOf：直接使用 ISO 表。
// 名稱以 Intl.DisplayNames 依語系顯示；不可用時退回代碼。

import { ISO_4217_CURRENCIES, getIsoCurrency } from "./iso4217.ts";
import type { CurrencyExponent } from "./iso4217.ts";

export const COMMON_CURRENCY_CODES: ReadonlyArray<string> = [
  "TWD",
  "JPY",
  "USD",
  "KRW",
  "EUR",
  "GBP",
  "AUD",
  "HKD",
  "CNY",
  "SGD",
  "THB",
];

export interface SelectableCurrency {
  code: string;
  numeric: string;
  exponent: CurrencyExponent;
  name: string;
}

type IntlWithSupportedValues = {
  supportedValuesOf?: (key: string) => string[];
};

function getIntlSupportedCurrencies(): Set<string> | null {
  const fn = (Intl as unknown as IntlWithSupportedValues).supportedValuesOf;
  if (typeof fn !== "function") return null;
  try {
    const values = fn.call(Intl, "currency");
    if (!Array.isArray(values) || values.length === 0) return null;
    return new Set(values.map((v) => String(v).toUpperCase()));
  } catch {
    return null;
  }
}

type DisplayNamesLike = { of: (code: string) => string | undefined };

function createCurrencyNamer(locale: string | undefined): (code: string) => string {
  let names: DisplayNamesLike | null = null;
  try {
    const Ctor = (
      Intl as unknown as {
        DisplayNames?: new (
          l: string[] | string | undefined,
          o: { type: string; fallback?: string },
        ) => DisplayNamesLike;
      }
    ).DisplayNames;
    if (typeof Ctor === "function") {
      names = new Ctor(locale ? [locale] : undefined, { type: "currency", fallback: "code" });
    }
  } catch {
    names = null;
  }
  return (code: string) => {
    if (!names) return code;
    try {
      const n = names.of(code);
      return n && n.trim() ? n : code;
    } catch {
      return code;
    }
  };
}

/** 全部可選幣別（依代碼排序，結果具決定性）。 */
export function getSelectableCurrencies(locale?: string): SelectableCurrency[] {
  const supported = getIntlSupportedCurrencies();
  const nameOf = createCurrencyNamer(locale);
  return ISO_4217_CURRENCIES.filter((c) => (supported ? supported.has(c.code) : true))
    .map((c) => ({ code: c.code, numeric: c.numeric, exponent: c.exponent, name: nameOf(c.code) }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** 常用幣別（維持 COMMON_CURRENCY_CODES 順序；不在可選清單者略過）。 */
export function getCommonCurrencies(locale?: string): SelectableCurrency[] {
  const all = getSelectableCurrencies(locale);
  const byCode = new Map(all.map((c) => [c.code, c] as const));
  const out: SelectableCurrency[] = [];
  for (const code of COMMON_CURRENCY_CODES) {
    const c = byCode.get(code);
    if (c) out.push(c);
  }
  return out;
}

/** 單一幣別的語系名稱；未知代碼或 DisplayNames 不可用時回傳代碼。 */
export function getCurrencyDisplayName(code: string, locale?: string): string {
  const iso = getIsoCurrency(code);
  const normalized = iso ? iso.code : String(code).trim().toUpperCase();
  return createCurrencyNamer(locale)(normalized);
}
