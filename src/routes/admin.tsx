import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
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

export const Route = createFileRoute("/admin")({
  component: AdminDashboardPage,
});

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; data: AdminDashboardData }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

const SORT_OPTIONS: Array<{ value: AdminUserSort; label: string }> = [
  { value: "recently_active", label: "Recently Active" },
  { value: "active_7d", label: "Most Active 7D" },
  { value: "active_30d", label: "Most Active 30D" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
];

const UNAVAILABLE_ANALYTICS = [
  "Chat Sessions",
  "All Itinerary Generations",
  "Itinerary Generation Success Rate",
  "Popular Recommendation Categories",
  "Place Card Clicks",
  "Affiliate Click Funnel",
] as const;

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function displayName(user: AdminActiveUser): string {
  return user.displayName?.trim() || "Unnamed user";
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
      <p className="truncate text-xs text-slate-500">{user.email ?? "No email"}</p>
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
        if (!cancelled) void navigate({ to: "/login", replace: true });
        return;
      }
      const params = new URLSearchParams({ sort, page: String(page) });
      if (search) params.set("search", search);
      const response = await fetch(`/api/admin/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (cancelled) return;
      if (response.status === 401) {
        void navigate({ to: "/login", replace: true });
        return;
      }
      if (response.status === 403) {
        setState({ kind: "forbidden" });
        return;
      }
      const body = (await response.json()) as { dashboard?: AdminDashboardData; error?: string };
      if (!response.ok || !body.dashboard) {
        setState({ kind: "error", message: body.error ?? "Admin analytics unavailable" });
        return;
      }
      setState({ kind: "ready", data: body.dashboard });
    })().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : "Admin analytics unavailable",
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

  if (state.kind === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-400" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">403 · Admin access required</h1>
          <p className="mt-2 text-sm text-slate-500">
            This account is not authorized for Roamie Admin.
          </p>
        </div>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-950">Admin analytics unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">{state.message}</p>
        </div>
      </main>
    );
  }

  if (state.kind === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm text-slate-500">Loading protected analytics…</p>
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
              <ShieldCheck className="h-4 w-4" /> Roamie Operations
            </div>
            <h1 className="mt-1 text-2xl font-semibold">Admin Dashboard</h1>
          </div>
          <p className="text-xs text-slate-400">Updated {formatDate(data.observedAt)}</p>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-8 px-5 py-7 lg:px-8">
        <section>
          <div className="mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Overview
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            <KpiCard label="Total Users" value={summary.totalUsers} />
            <KpiCard label="New Today" value={summary.newUsersToday} />
            <KpiCard label="New 7D" value={summary.newUsers7d} />
            <KpiCard label="New 30D" value={summary.newUsers30d} />
            <KpiCard label="DAU" value={summary.dau} note="Unique product activity · 24h" />
            <KpiCard label="WAU" value={summary.wau} note="Unique product activity · 7d" />
            <KpiCard label="MAU" value={summary.mau} note="Unique product activity · 30d" />
            <KpiCard label="User Chats Today" value={summary.userChatsToday} />
            <KpiCard label="User Chats 7D" value={summary.userChats7d} />
            <KpiCard label="Saved Trips Today" value={summary.savedTripsToday} />
            <KpiCard label="Saved Trips 7D" value={summary.savedTrips7d} />
            <KpiCard label="Saved Places 7D" value={summary.savedPlaces7d} />
            <KpiCard label="Free Users" value={summary.freeUsers} />
            <KpiCard
              label="Plus Users"
              value={summary.plusUsers}
              note={`${plusPercent.toFixed(1)}% of users`}
            />
            <KpiCard
              label="Committed Credits 7D"
              value={summary.committedCredits7d}
              note="Production ledger only"
            />
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />
              <h2 className="font-semibold">Active Users</h2>
              <span className="text-xs text-slate-400">
                {data.usersTotal.toLocaleString()} results
              </span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search name, email, or UUID"
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
                    "Display Name / Email",
                    "Joined",
                    "Last Sign In",
                    "Last Active",
                    "Actions 7D",
                    "Actions 30D",
                    "User Chats",
                    "Saved Trips",
                    "Saved Places",
                    "Plan",
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
                      No users found
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-500">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page <= 1}
                className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
                aria-label="Next page"
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
              <h2 className="font-semibold">Top Active Users</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-400">
                  <tr>
                    {["Rank", "User", "7D", "30D", "Chats", "Trips", "Places", "Last Active"].map(
                      (x) => (
                        <th key={x} className="pb-2 pr-3 font-medium">
                          {x}
                        </th>
                      ),
                    )}
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
              <h2 className="font-semibold">Popular Saved Destinations</h2>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 font-medium">Saved Trips</th>
                  <th className="pb-2 font-medium">Users</th>
                  <th className="pb-2 font-medium">Last Saved</th>
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
            <h2 className="font-semibold">Free / Plus Distribution</h2>
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
                <dt className="text-slate-500">Plus %</dt>
                <dd className="font-medium">{plusPercent.toFixed(1)}%</dd>
              </div>
            </dl>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Credits Usage</h2>
            <p className="mt-1 text-xs text-amber-700">Free / ledger-covered usage only</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Today</dt>
                <dd>{summary.committedCreditsToday}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">7D</dt>
                <dd>{summary.committedCredits7d}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">30D</dt>
                <dd>{summary.committedCredits30d}</dd>
              </div>
              {data.creditBreakdown30d.map((row) => (
                <div
                  key={row.featureType}
                  className="flex justify-between border-t border-slate-100 pt-3"
                >
                  <dt className="text-slate-500">
                    {row.featureType === "PLACE_RECOMMENDATION"
                      ? "AI place recommendation"
                      : row.featureType === "ITINERARY_GENERATION"
                        ? "Itinerary generation"
                        : row.featureType}
                  </dt>
                  <dd>{row.credits}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold">Analytics Not Yet Available</h2>
            <ul className="mt-4 space-y-2 text-sm">
              {UNAVAILABLE_ANALYTICS.map((metric) => (
                <li key={metric} className="flex items-center justify-between gap-3">
                  <span className="text-slate-600">{metric}</span>
                  <span className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
                    unavailable · analytics_source_missing
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
