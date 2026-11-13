import { RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminAnalyticsV1 } from "@/lib/admin/admin-analytics";
import {
  PERIOD_OPTIONS,
  formatDate,
  formatNumber,
  formatPercent,
  mergeByLabel,
  periodTitle,
  providerLabel,
  recommendationFamilyLabel,
  surfaceLabel,
  type AdminAnalyticsPeriod,
} from "./admin-format";

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

function ShareList({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  unit: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold text-slate-500">{title}</h3>
      {rows.length === 0 || total === 0 ? (
        <p className="mt-2 text-sm text-slate-400">尚無資料</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {rows.map((row) => {
            const share = (row.count / total) * 100;
            return (
              <li key={row.label} className="min-w-0">
                <div className="flex justify-between gap-3">
                  <span className="truncate text-slate-700">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {formatNumber(row.count)} {unit} · {formatPercent(share)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-slate-500"
                    style={{ width: `${Math.max(2, share)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ProviderList({ rows }: { rows: AdminAnalyticsV1["affiliateByProvider"] }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold text-slate-500">聯盟導購 · 依合作商</h3>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">尚無資料</p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {rows.map((row) => (
            <li key={row.provider} className="min-w-0">
              <div className="flex justify-between gap-3">
                <span className="truncate text-slate-700">{providerLabel(row.provider)}</span>
                <span className="min-w-0 text-right text-xs tabular-nums text-slate-500">
                  曝光 {formatNumber(row.impressions)} · 點擊 {formatNumber(row.clicks)} · 成功開啟{" "}
                  {formatNumber(row.opens)}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                <div
                  className="h-1.5 rounded-full bg-sky-500"
                  style={{
                    width: `${row.impressions > 0 ? Math.min(100, (row.clicks / row.impressions) * 100) : 0}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AnalyticsBody({ analytics }: { analytics: AdminAnalyticsV1 }) {
  const completed = analytics.itinerarySuccesses + analytics.itineraryFailures;
  const families = mergeByLabel(
    analytics.popularRecommendationFamilies,
    (row) => recommendationFamilyLabel(row.family),
    (row) => row.count,
  );
  const surfaces = mergeByLabel(
    analytics.placeClickSurfaces,
    (row) => surfaceLabel(row.surface),
    (row) => row.count,
  );
  return (
    <>
      <p className="mt-1 text-xs text-slate-400">
        事件自 {formatDate(analytics.trackingStartedAt)} 起統計
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <dl className="min-w-0 space-y-3 text-sm">
          <Metric label="對話工作階段">{formatNumber(analytics.chatSessions)}</Metric>
          <Metric label="所有行程生成次數">{formatNumber(analytics.itineraryAttempts)}</Metric>
          <Metric label="行程生成成功率">
            {completed === 0
              ? "—（尚無完成紀錄）"
              : `${formatPercent(analytics.itinerarySuccessRate)}（成功 ${formatNumber(analytics.itinerarySuccesses)}／失敗 ${formatNumber(analytics.itineraryFailures)}）`}
          </Metric>
          <Metric label="地點卡片點擊">
            {`${formatNumber(analytics.placeCardClicks)} 次（不重複地點 ${formatNumber(analytics.uniqueClickedPlaces)} 個）`}
          </Metric>
          <Metric label="聯盟導購點擊漏斗">
            {analytics.affiliateImpressions === 0
              ? "—（尚無曝光）"
              : `曝光 ${formatNumber(analytics.affiliateImpressions)} → 點擊 ${formatNumber(analytics.affiliateClicks)} → 成功開啟 ${formatNumber(analytics.affiliateOpenSuccesses)}`}
          </Metric>
          <Metric label="點擊率">
            {analytics.affiliateImpressions === 0 ? "—" : formatPercent(analytics.affiliateCtr)}
          </Metric>
        </dl>
        <ShareList title="熱門推薦類型" rows={families} unit="次" />
        <ShareList title="地點卡片點擊來源" rows={surfaces} unit="次" />
        <ProviderList rows={analytics.affiliateByProvider} />
      </div>
    </>
  );
}

export function AnalyticsPanel({
  analytics,
  period,
  onPeriod,
  loading,
  error,
  onRetry,
}: {
  analytics: AdminAnalyticsV1 | null;
  period: AdminAnalyticsPeriod;
  onPeriod: (value: AdminAnalyticsPeriod) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold">分析指標 · {periodTitle(period)}</h2>
        <div
          role="group"
          aria-label="分析指標時間範圍"
          className="inline-flex w-fit rounded-md border border-slate-300 bg-slate-50 p-0.5"
        >
          {PERIOD_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={period === option.value}
              onClick={() => onPeriod(option.value)}
              className={`rounded px-3 py-1 text-xs font-medium ${period === option.value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="載入分析指標中">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-6 w-full bg-slate-200" />
          ))}
        </div>
      ) : error || !analytics ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-amber-700">
          <span>{error ?? "暫時無法取得"}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700"
          >
            <RotateCw className="h-3 w-3" /> 重試
          </button>
        </div>
      ) : (
        <AnalyticsBody analytics={analytics} />
      )}
    </section>
  );
}
