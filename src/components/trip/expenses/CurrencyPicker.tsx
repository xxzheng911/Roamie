import { useMemo, useState } from "react";
import { Check, ChevronLeft, Search } from "lucide-react";
import type { Locale } from "@/lib/i18n/types";
import type { TripExpensesCopy } from "@/lib/i18n/trip-workspace-copy";
import {
  COMMON_CURRENCY_CODES,
  getSelectableCurrencies,
  type SelectableCurrency,
} from "@/lib/money/currency-list";
import { cn } from "@/lib/utils";

type Props = {
  locale: Locale;
  copy: TripExpensesCopy;
  value: string;
  /** 此行程用過的幣別（最近的在前）。 */
  used: string[];
  onSelect: (code: string) => void;
  onBack: () => void;
};

function matches(c: SelectableCurrency, q: string): boolean {
  if (!q) return true;
  return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
}

/** 可搜尋的幣別選擇器：此行程用過／常用／全部 A–Z。 */
export function CurrencyPicker({ locale, copy, value, used, onSelect, onBack }: Props) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => getSelectableCurrencies(locale), [locale]);
  const byCode = useMemo(() => new Map(all.map((c) => [c.code, c] as const)), [all]);
  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const pick = (codes: readonly string[]) =>
      codes
        .map((code) => byCode.get(code))
        .filter((c): c is SelectableCurrency => c != null && matches(c, q));
    const out: Array<{ id: string; title: string; items: SelectableCurrency[] }> = [];
    const usedItems = pick(used);
    if (usedItems.length > 0) out.push({ id: "used", title: copy.currencyUsed, items: usedItems });
    const common = pick(COMMON_CURRENCY_CODES);
    if (common.length > 0) out.push({ id: "common", title: copy.currencyCommon, items: common });
    const rest = all.filter((c) => matches(c, q));
    if (rest.length > 0) out.push({ id: "all", title: copy.currencyAll, items: rest });
    return out;
  }, [all, byCode, used, q, copy.currencyUsed, copy.currencyCommon, copy.currencyAll]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={copy.back}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-secondary px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.currencySearch}
            aria-label={copy.currencySearch}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {sections.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{copy.currencyNone}</p>
        ) : (
          sections.map((section) => (
            <section key={section.id} className="mb-4">
              <h4 className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                {section.title}
              </h4>
              <ul className="overflow-hidden rounded-2xl border border-border bg-card">
                {section.items.map((c) => (
                  <li
                    key={`${section.id}-${c.code}`}
                    className="border-b border-border last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(c.code)}
                      aria-pressed={c.code === value}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <span className="w-11 shrink-0 text-sm font-semibold text-foreground">
                        {c.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {c.name}
                      </span>
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0 text-primary",
                          c.code === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
