import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { LogIn, RotateCw, ShieldCheck } from "lucide-react";
import { getClientAuthSession } from "@/lib/auth-session";
import type {
  AdminAnalyticsV1,
  AdminDashboardData,
  AdminUserSort,
} from "@/lib/admin/admin-analytics";
import { stashAdminReturn } from "@/lib/admin/admin-route-boundary";
import { formatDate, type AdminAnalyticsPeriod } from "@/components/admin/admin-format";
import { KpiSection } from "@/components/admin/KpiSection";
import { UsersSection } from "@/components/admin/UsersSection";
import { DestinationsPanel, TopUsersPanel } from "@/components/admin/InsightPanels";
import { CreditsPanel } from "@/components/admin/CreditsPanel";
import { AnalyticsPanel } from "@/components/admin/AnalyticsPanel";

export const Route = createFileRoute("/admin")({
  component: AdminDashboardPage,
});

type AdminFetchResult<T> =
  | { kind: "ok"; body: T }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

const SORT_OPTIONS: Array<{ value: AdminUserSort; label: string }> = [
  { value: "recently_active", label: "最近活躍" },
  { value: "active_7d", label: "近 7 日最活躍" },
  { value: "active_30d", label: "近 30 日最活躍" },
  { value: "newest", label: "最新加入" },
  { value: "oldest", label: "最早加入" },
];

function friendlyErrorMessage(status: number, code: string | undefined): string {
  if (status === 429 || code === "rate_limited") return "操作太頻繁，請稍候約 1 分鐘再試。";
  if (status === 400) return "查詢條件無效，請調整搜尋或排序後再試。";
  return "伺服器暫時無法取得資料，請稍後再試。";
}

async function fetchAdmin<T>(params: URLSearchParams): Promise<AdminFetchResult<T>> {
  try {
    const session = await getClientAuthSession();
    if (!session?.access_token) return { kind: "unauthenticated" };
    const { resolveApiUrl } = await import("@/lib/api-url");
    const response = await fetch(resolveApiUrl(`/api/admin/dashboard?${params.toString()}`), {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
    });
    if (response.status === 401) return { kind: "unauthenticated" };
    if (response.status === 403) return { kind: "forbidden" };
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      return { kind: "error", message: friendlyErrorMessage(response.status, body.error) };
    }
    return { kind: "ok", body };
  } catch {
    return { kind: "error", message: "網路連線失敗，請確認連線後重試。" };
  }
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
    >
      <RotateCw className="h-4 w-4" /> 重試
    </button>
  );
}

function AdminDashboardPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AdminUserSort>("recently_active");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [gate, setGate] = useState<"ok" | "unauthenticated" | "forbidden">("ok");
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [period, setPeriod] = useState<AdminAnalyticsPeriod>("30d");
  const periodRef = useRef<AdminAnalyticsPeriod>("30d");
  const analyticsSeq = useRef(0);
  // 成功載入後才更新畫面上的頁碼；失敗時仍顯示上一個成功的頁碼
  const [shownPage, setShownPage] = useState(1);
  const [analytics, setAnalytics] = useState<AdminAnalyticsV1 | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // 搜尋／排序／換頁：只讓使用者表格區顯示 skeleton，其餘區塊保留上一份資料
  useEffect(() => {
    let cancelled = false;
    setUsersLoading(true);
    setUsersError(null);
    const requestedPeriod = periodRef.current;
    const analyticsSeqAtStart = analyticsSeq.current;
    const params = new URLSearchParams({ sort, page: String(page), period: requestedPeriod });
    if (search) params.set("search", search);
    void fetchAdmin<{ dashboard?: AdminDashboardData }>(params).then((result) => {
      if (cancelled) return;
      setUsersLoading(false);
      if (result.kind === "unauthenticated" || result.kind === "forbidden") {
        setGate(result.kind);
        return;
      }
      if (result.kind === "error") {
        setUsersError(result.message);
        return;
      }
      const dashboard = result.body.dashboard;
      if (!dashboard) {
        setUsersError("管理後台暫時無法載入，請稍後再試。");
        return;
      }
      setShownPage(page);
      setData(dashboard);
      // 期間內若已切換時間範圍，分析區以切換後的請求為準
      if (requestedPeriod === periodRef.current && analyticsSeqAtStart === analyticsSeq.current) {
        setAnalytics(dashboard.analytics);
        setAnalyticsError(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [page, search, sort, reloadKey]);

  // 時間範圍切換：只重抓分析區
  const loadAnalytics = useCallback((value: AdminAnalyticsPeriod) => {
    const seq = ++analyticsSeq.current;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    const params = new URLSearchParams({ scope: "analytics", period: value });
    void fetchAdmin<{ analytics?: AdminAnalyticsV1 | null }>(params).then((result) => {
      if (seq !== analyticsSeq.current) return;
      setAnalyticsLoading(false);
      if (result.kind === "unauthenticated" || result.kind === "forbidden") {
        setGate(result.kind);
        return;
      }
      if (result.kind === "error") {
        setAnalyticsError(result.message);
        return;
      }
      setAnalytics(result.body.analytics ?? null);
    });
  }, []);

  const handlePeriod = (value: AdminAnalyticsPeriod) => {
    if (value === periodRef.current) return;
    periodRef.current = value;
    setPeriod(value);
    loadAnalytics(value);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.usersTotal / 50)) : 1;

  if (gate === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <LogIn className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">請先登入 Roamie</h1>
          <p className="mt-2 text-sm text-slate-500">請先登入 Roamie 後再開啟管理後台。</p>
          <button
            type="button"
            onClick={() => {
              stashAdminReturn();
              void navigate({ to: "/login" });
            }}
            className="mt-6 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white"
          >
            前往登入
          </button>
        </div>
      </main>
    );
  }

  if (gate === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">403 · 此帳號沒有管理員權限</h1>
          <p className="mt-2 text-sm text-slate-500">請使用已授權的 Roamie 管理員帳號。</p>
        </div>
      </main>
    );
  }

  if (!data && usersError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">管理後台暫時無法載入</h1>
          <p className="mt-2 text-sm text-slate-500">{usersError}</p>
          <div className="mt-6">
            <RetryButton onClick={() => setReloadKey((value) => value + 1)} />
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">載入中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 py-4 lg:px-8">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4" /> Roamie 營運後台
            </div>
            <h1 className="mt-1 text-2xl font-semibold">管理後台</h1>
          </div>
          <p className="text-xs text-slate-400">更新時間：{formatDate(data.observedAt)}</p>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-8 px-4 py-6 lg:px-8">
        <KpiSection summary={data.summary} />

        <div className="min-w-0 space-y-3">
          {usersError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <span>{usersError}</span>
              <RetryButton onClick={() => setReloadKey((value) => value + 1)} />
            </div>
          ) : null}
          <UsersSection
            users={data.users}
            usersTotal={data.usersTotal}
            page={usersLoading ? page : shownPage}
            totalPages={totalPages}
            loading={usersLoading}
            searchInput={searchInput}
            onSearchInput={setSearchInput}
            sort={sort}
            sortOptions={SORT_OPTIONS}
            onSort={(value) => {
              setSort(value);
              setPage(1);
            }}
            onPage={(value) => (value === page ? setReloadKey((key) => key + 1) : setPage(value))}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <TopUsersPanel users={data.topUsers} />
          <DestinationsPanel rows={data.popularDestinations} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <CreditsPanel summary={data.summary} breakdown={data.creditBreakdown30d} />
          <div className="min-w-0 lg:col-span-2">
            <AnalyticsPanel
              analytics={analytics}
              period={period}
              onPeriod={handlePeriod}
              loading={analyticsLoading}
              error={analyticsError}
              onRetry={() => loadAnalytics(periodRef.current)}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
