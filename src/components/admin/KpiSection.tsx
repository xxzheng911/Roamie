import { BarChart3 } from "lucide-react";
import type { AdminDashboardSummary } from "@/lib/admin/admin-analytics";
import { formatNumber, formatPercent } from "./admin-format";

type Kpi = { label: string; value: number; note?: string; primary?: boolean };

function KpiCard({ label, value, note, primary }: Kpi) {
  return (
    <article
      className={`min-w-0 rounded-xl border bg-white shadow-sm ${primary ? "border-slate-300 p-4" : "border-slate-200 p-3"}`}
    >
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`mt-1 font-semibold tabular-nums text-slate-950 ${primary ? "text-3xl" : "text-xl"}`}
      >
        {formatNumber(value)}
      </p>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </article>
  );
}

function KpiGroup({ title, items }: { title: string; items: Kpi[] }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-xs font-semibold text-slate-500">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.map((item) => (
          <KpiCard key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
}

export function KpiSection({ summary }: { summary: AdminDashboardSummary }) {
  const plusPercent = summary.totalUsers > 0 ? (summary.plusUsers / summary.totalUsers) * 100 : 0;
  return (
    <section className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-600">總覽</h2>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        總覽為固定時間口徑：「今日」自資料庫當日 0 點起算，「近 7 日／近 30
        日」為滾動區間，不受下方分析指標的時間切換影響。
      </p>
      <div className="space-y-5">
        <KpiGroup
          title="成長"
          items={[
            { label: "總使用者", value: summary.totalUsers, primary: true },
            { label: "今日新增", value: summary.newUsersToday },
            { label: "近 7 日新增", value: summary.newUsers7d },
            { label: "近 30 日新增", value: summary.newUsers30d },
          ]}
        />
        <KpiGroup
          title="活躍"
          items={[
            {
              label: "日活躍使用者",
              value: summary.dau,
              note: "近 24 小時有產品操作的使用者",
              primary: true,
            },
            { label: "週活躍使用者", value: summary.wau, note: "近 7 日有產品操作的使用者" },
            { label: "月活躍使用者", value: summary.mau, note: "近 30 日有產品操作的使用者" },
            { label: "今日使用者對話", value: summary.userChatsToday },
            { label: "近 7 日使用者對話", value: summary.userChats7d },
          ]}
        />
        <KpiGroup
          title="內容"
          items={[
            { label: "今日收藏行程", value: summary.savedTripsToday, primary: true },
            { label: "近 7 日收藏行程", value: summary.savedTrips7d },
            { label: "近 7 日收藏地點", value: summary.savedPlaces7d },
          ]}
        />
        <KpiGroup
          title="營收"
          items={[
            {
              label: "Plus 使用者",
              value: summary.plusUsers,
              note: `佔總使用者 ${formatPercent(plusPercent)}`,
              primary: true,
            },
            { label: "Free 使用者", value: summary.freeUsers },
          ]}
        />
      </div>
    </section>
  );
}
