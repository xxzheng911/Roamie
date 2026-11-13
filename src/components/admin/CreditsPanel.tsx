import type { AdminDashboardSummary, CreditFeatureUsage } from "@/lib/admin/admin-analytics";
import { featureTypeLabel, formatNumber, mergeByLabel } from "./admin-format";

/** 口徑依 admin_dashboard_phase1：credit_ledger 中 status = committed 且 environment = production 的 amount 加總 */
export const CREDITS_SCOPE_NOTE =
  "僅統計 Production 環境已完成扣點（committed）的 Credits 紀錄；沒有扣點紀錄的使用不計入。";

export function CreditsPanel({
  summary,
  breakdown,
}: {
  summary: AdminDashboardSummary;
  breakdown: CreditFeatureUsage[];
}) {
  const rows = mergeByLabel(
    breakdown,
    (row) => featureTypeLabel(row.featureType),
    (row) => row.credits,
  );
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <h2 className="font-semibold">Credits 使用量</h2>
      <p className="mt-1 text-xs text-amber-700">{CREDITS_SCOPE_NOTE}</p>
      <dl className="mt-4 space-y-3 text-sm">
        {[
          { label: "今日", value: summary.committedCreditsToday },
          { label: "近 7 日", value: summary.committedCredits7d },
          { label: "近 30 日", value: summary.committedCredits30d },
        ].map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-slate-500">{row.label}</dt>
            <dd className="tabular-nums">{formatNumber(row.value)}</dd>
          </div>
        ))}
      </dl>
      <h3 className="mt-5 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
        近 30 日依功能
      </h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">尚無資料</p>
      ) : (
        <dl className="mt-2 space-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-4">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="tabular-nums">{formatNumber(row.count)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
