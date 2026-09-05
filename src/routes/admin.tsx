import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  LogIn,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { getClientAuthSession } from "@/lib/auth-session";
import type {
  AdminActiveUser,
  AdminDashboardData,
  AdminUserSort,
} from "@/lib/admin/admin-analytics";
import { stashAdminReturn } from "@/lib/admin/admin-route-boundary";

export const Route = createFileRoute("/admin")({
  component: AdminDashboardPage,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AdminDashboardData }
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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("zh-TW", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function displayName(user: AdminActiveUser): string {
  return user.displayName?.trim() || "未命名使用者";
}

function KpiCard({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-950">
        {value.toLocaleString()}
      </p>
      {note ? <p className="mt-1 text-xs text-slate-400">{note}</p> : null}
    </article>
  );
}

function UserLabel({ user }: { user: AdminActiveUser }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900">{displayName(user)}</p>
      <p className="truncate text-xs text-slate-500">{user.email ?? "無 Email"}</p>
    </div>
  );
}

function AdminDashboardPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<AdminUserSort>("recently_active");
  const [page, setPage] = useState(1);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void (async () => {
      const session = await getClientAuthSession();
      if (!session?.access_token) {
        if (!cancelled) setState({ kind: "unauthenticated" });
        return;
      }
      const params = new URLSearchParams({ sort, page: String(page) });
      if (search) params.set("search", search);
      const { resolveApiUrl } = await import("@/lib/api-url");
      const response = await fetch(resolveApiUrl(`/api/admin/dashboard?${params.toString()}`), {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (cancelled) return;
      if (response.status === 401) {
        setState({ kind: "unauthenticated" });
        return;
      }
      if (response.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      const body = (await response.json()) as { dashboard?: AdminDashboardData; error?: string };
      if (!response.ok || !body.dashboard) {
        setState({ kind: "error", message: body.error ?? "管理後台暫時無法載入" });
        return;
      }
      setState({ kind: "ready", data: body.dashboard });
    })().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "管理後台暫時無法載入",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, page, search, sort]);

  const totalPages = useMemo(
    () => (state.kind === "ready" ? Math.max(1, Math.ceil(state.data.usersTotal / 50)) : 1),
    [state],
  );

  if (state.kind === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
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

  if (state.kind === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">403 · 此帳號沒有管理員權限</h1>
          <p className="mt-2 text-sm text-slate-500">請使用已授權的 Roamie 管理員帳號。</p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">管理後台暫時無法載入</h1>
          <p className="mt-2 text-sm text-slate-500">請稍後再試。</p>
        </div>
      </main>
    );
  }

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">載入中…</p>
      </main>
    );
  }

  const { data } = state;
  const { summary } = data;
  const plusPercent = summary.totalUsers > 0 ? (summary.plusUsers / summary.totalUsers) * 100 : 0;

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4" /> Roamie 營運後台
            </div>
            <h1 className="mt-1 text-2xl font-semibold">管理後台</h1>
          </div>
          <p className="text-xs text-slate-400">更新時間：{formatDate(data.observedAt)}</p>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-8 px-5 py-7 lg:px-8">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">總覽</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <KpiCard label="總使用者" value={summary.totalUsers} />
            <KpiCard label="今日新增" value={summary.newUsersToday} />
            <KpiCard label="近 7 日新增" value={summary.newUsers7d} />
            <KpiCard label="近 30 日新增" value={summary.newUsers30d} />
            <KpiCard label="日活躍使用者" value={summary.dau} note="近 24 小時有產品操作的使用者" />
            <KpiCard label="週活躍使用者" value={summary.wau} note="近 7 日有產品操作的使用者" />
            <KpiCard label="月活躍使用者" value={summary.mau} note="近 30 日有產品操作的使用者" />
            <KpiCard label="今日使用者對話" value={summary.userChatsToday} />
            <KpiCard label="近 7 日使用者對話" value={summary.userChats7d} />
            <KpiCard label="今日收藏行程" value={summary.savedTripsToday} />
            <KpiCard label="近 7 日收藏行程" value={summary.savedTrips7d} />
            <KpiCard label="近 7 日收藏地點" value={summary.savedPlaces7d} />
            <KpiCard label="Free 使用者" value={summary.freeUsers} />
            <KpiCard
              label="Plus 使用者"
              value={summary.plusUsers}
              note={`使用者佔比 ${plusPercent.toFixed(1)}%`}
            />
            <KpiCard
              label="近 7 日已使用 Credits"
              value={summary.committedCredits7d}
              note="僅統計 Production 已完成扣點"
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold">活躍使用者</h2>
              <span className="text-xs text-slate-400">
                {data.usersTotal.toLocaleString("zh-TW")} 位使用者
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="搜尋名稱、Email 或 UUID"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-500 sm:w-72"
                />
              </label>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as AdminUserSort);
                  setPage(1);
                }}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "顯示名稱 / Email",
                    "加入時間",
                    "最後登入",
                    "最後活躍",
                    "近 7 日操作",
                    "近 30 日操作",
                    "使用者對話",
                    "收藏行程",
                    "收藏地點",
                    "方案",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.users.map((user) => (
                  <tr key={user.userId} className="hover:bg-slate-50/70">
                    <td className="max-w-64 px-4 py-3">
                      <UserLabel user={user} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(user.lastSignInAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(user.lastActiveAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{user.actions7d}</td>
                    <td className="px-4 py-3 tabular-nums">{user.actions30d}</td>
                    <td className="px-4 py-3 tabular-nums">{user.chatCount}</td>
                    <td className="px-4 py-3 tabular-nums">{user.tripCount}</td>
                    <td className="px-4 py-3 tabular-nums">{user.savedPlaceCount}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${user.plan === "plus" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {user.plan === "plus" ? "Plus" : "Free"}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.users.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                      找不到符合條件的使用者
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-500">
              第 {page} 頁，共 {totalPages} 頁
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
                aria-label="上一頁"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
                aria-label="下一頁"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold">最活躍使用者</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    {[
                      "排名",
                      "使用者",
                      "近 7 日",
                      "近 30 日",
                      "對話",
                      "行程",
                      "地點",
                      "最後活躍",
                    ].map((x) => (
                      <th key={x} className="pb-2 pr-3 font-medium">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topUsers.map((user, index) => (
                    <tr key={user.userId}>
                      <td className="py-3 pr-3 text-slate-400">{index + 1}</td>
                      <td className="py-3 pr-3">
                        <UserLabel user={user} />
                      </td>
                      <td className="py-3 pr-3">{user.actions7d}</td>
                      <td className="py-3 pr-3">{user.actions30d}</td>
                      <td className="py-3 pr-3">{user.chatCount}</td>
                      <td className="py-3 pr-3">{user.tripCount}</td>
                      <td className="py-3 pr-3">{user.savedPlaceCount}</td>
                      <td className="py-3 text-slate-500">{formatDate(user.lastActiveAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold">熱門收藏行程目的地</h2>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">目的地</th>
                  <th className="pb-2 font-medium">收藏行程</th>
                  <th className="pb-2 font-medium">使用者</th>
                  <th className="pb-2 font-medium">最後收藏</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.popularDestinations.map((row) => (
                  <tr key={row.destination}>
                    <td className="py-3 font-medium">{row.destination}</td>
                    <td className="py-3">{row.tripCount}</td>
                    <td className="py-3">{row.uniqueUsers}</td>
                    <td className="py-3 text-slate-500">{formatDate(row.lastSavedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Free / Plus 使用者分布</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Free</dt>
                <dd className="font-medium">{summary.freeUsers.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Plus</dt>
                <dd className="font-medium">{summary.plusUsers.toLocaleString()}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3">
                <dt className="text-slate-500">Plus 佔比</dt>
                <dd className="font-medium">{plusPercent.toFixed(1)}%</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Credits 使用量</h2>
            <p className="mt-1 text-xs text-amber-700">僅包含 Free / 有 Credits 紀錄的使用量</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">今日</dt>
                <dd>{summary.committedCreditsToday}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">近 7 日</dt>
                <dd>{summary.committedCredits7d}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">近 30 日</dt>
                <dd>{summary.committedCredits30d}</dd>
              </div>
              {data.creditBreakdown30d.map((row) => (
                <div
                  key={row.featureType}
                  className="flex justify-between border-t border-slate-100 pt-3"
                >
                  <dt className="text-slate-500">
                    {row.featureType === "PLACE_RECOMMENDATION"
                      ? "AI 地點推薦"
                      : row.featureType === "ITINERARY_GENERATION"
                        ? "行程生成"
                        : row.featureType}
                  </dt>
                  <dd>{row.credits}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">分析指標 · 近 30 日</h2>
            {!data.analytics ? (
              <p className="mt-4 text-sm text-amber-700">暫時無法取得</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-slate-400">
                  自 {formatDate(data.analytics.trackingStartedAt)} 起統計
                </p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">對話工作階段</dt>
                    <dd>{data.analytics.chatSessions.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">所有行程生成次數</dt>
                    <dd>{data.analytics.itineraryAttempts.toLocaleString()}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">行程生成成功率</dt>
                    <dd>
                      {data.analytics.itinerarySuccessRate.toFixed(1)}%（
                      {data.analytics.itinerarySuccesses} / {data.analytics.itineraryFailures}{" "}
                      failed）
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">熱門推薦類型</dt>
                    <dd className="text-right">
                      {data.analytics.popularRecommendationFamilies
                        .map((x) => x.family)
                        .join(" / ") || "0"}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">地點卡片點擊</dt>
                    <dd>
                      {data.analytics.placeCardClicks.toLocaleString()}（
                      {data.analytics.uniqueClickedPlaces} places）
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">聯盟導購點擊漏斗</dt>
                    <dd>
                      {data.analytics.affiliateClicks} / {data.analytics.affiliateImpressions} ·{" "}
                      {data.analytics.affiliateCtr.toFixed(1)}%
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
