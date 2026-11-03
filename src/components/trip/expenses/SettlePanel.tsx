import { ArrowRight, Info, Loader2 } from "lucide-react";
import type { Locale } from "@/lib/i18n/types";
import type { TripExpensesCopy } from "@/lib/i18n/trip-workspace-copy";
import type { CurrencySettlement, SuggestedTransfer } from "@/lib/money/settle";
import { cn } from "@/lib/utils";
import { personLabel, safeFormatMoney, transferKey, type ExpensePerson } from "./expense-model";

type Props = {
  settlements: CurrencySettlement[];
  locale: Locale;
  copy: TripExpensesCopy;
  showCode: boolean;
  resolvePerson: (userId: string) => ExpensePerson;
  /** 處理中的轉帳（transferKey） */
  marking: ReadonlySet<string>;
  /** 成員名單已載入（才判斷建議轉帳是否涉及已不在行程中的成員） */
  membersLoaded: boolean;
  onMarkPaid: (settlement: CurrencySettlement, transfer: SuggestedTransfer) => void;
};

/** 結算：每個幣別一張卡（成員已付／應付／淨額＋建議轉帳與「標記已還」）。 */
export function SettlePanel({
  settlements,
  locale,
  copy,
  showCode,
  resolvePerson,
  marking,
  membersLoaded,
  onMarkPaid,
}: Props) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{copy.settleIntro}</span>
      </p>
      {settlements.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{copy.settleEmpty}</p>
      ) : (
        settlements.map((s) => {
          const fmt = (minor: number) =>
            safeFormatMoney(minor, s.currency, s.currency_exponent, locale, showCode);
          return (
            <section
              key={`${s.currency}:${s.currency_exponent}`}
              className="rounded-2xl border border-border bg-card px-4 py-3"
            >
              <h3 className="text-sm font-semibold text-foreground">{s.currency}</h3>
              {s.precision_exceeded ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  {copy.settlePrecision}
                </p>
              ) : null}
              <table className="mt-2 w-full table-fixed text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th scope="col" className="w-[34%] py-1 text-left font-normal">
                      {copy.settleMember}
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      {copy.settlePaid}
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      {copy.settleOwed}
                    </th>
                    <th scope="col" className="py-1 text-right font-normal">
                      {copy.settleNet}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.members.map((m) => {
                    const person = resolvePerson(m.user_id);
                    return (
                      <tr key={m.user_id} className="border-t border-border">
                        <th
                          scope="row"
                          className={cn(
                            "truncate py-1.5 text-left font-normal",
                            person.isDeleted ? "text-muted-foreground" : "text-foreground",
                          )}
                        >
                          {personLabel(person, copy)}
                        </th>
                        <td className="truncate py-1.5 text-right tabular-nums text-foreground">
                          {fmt(m.paid_minor)}
                        </td>
                        <td className="truncate py-1.5 text-right tabular-nums text-foreground">
                          {fmt(m.owed_minor)}
                        </td>
                        <td
                          className={cn(
                            "truncate py-1.5 text-right font-medium tabular-nums",
                            m.net_minor > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : m.net_minor < 0
                                ? "text-destructive"
                                : "text-muted-foreground",
                          )}
                        >
                          {m.net_minor > 0 ? "+" : ""}
                          {fmt(m.net_minor)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-1 text-[11px] text-muted-foreground">{copy.settleNetNote}</p>

              <h4 className="mt-3 text-xs font-medium text-muted-foreground">
                {copy.settleTransfers}
              </h4>
              {s.transfers.length === 0 ? (
                <p className="mt-1 text-sm text-foreground">{copy.settleAllSettled}</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {s.transfers.map((t) => {
                    const key = transferKey(s, t);
                    const busy = marking.has(key);
                    const from = resolvePerson(t.from_user_id);
                    const to = resolvePerson(t.to_user_id);
                    // 涉及已不在行程中的成員：後端必定拒絕，按鈕停用並說明
                    const formerMember = membersLoaded && (!from.isMember || !to.isMember);
                    return (
                      <li key={key}>
                        <div className="flex items-center gap-2">
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-foreground">
                            <span className="truncate">{personLabel(from, copy)}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{personLabel(to, copy)}</span>
                          </span>
                          <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                            {fmt(t.amount_minor)}
                          </span>
                          <button
                            type="button"
                            onClick={() => onMarkPaid(s, t)}
                            disabled={
                              busy || s.precision_exceeded || !membersLoaded || formerMember
                            }
                            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-secondary px-3 text-xs font-medium text-foreground disabled:opacity-60"
                          >
                            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                            {busy ? copy.settleMarking : copy.settleMarkPaid}
                          </button>
                        </div>
                        {formerMember ? (
                          <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
                            {copy.settleFormerMember}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
