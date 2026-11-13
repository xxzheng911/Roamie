import { ChevronLeft, ChevronRight, Search, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminActiveUser, AdminUserSort } from "@/lib/admin/admin-analytics";
import { formatDate, formatNumber } from "./admin-format";
import { PlanBadge, UserLabel } from "./UserLabel";

const USER_COLUMNS = [
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
];

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="載入表格中">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full bg-slate-200" />
      ))}
    </div>
  );
}

function UsersTable({ users }: { users: AdminActiveUser[] }) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[1200px] text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {USER_COLUMNS.map((label) => (
              <th key={label} className="px-4 py-3 font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((user) => (
            <tr key={user.userId} className="hover:bg-slate-50/70">
              <td className="max-w-64 px-4 py-3">
                <UserLabel user={user} />
              </td>
              <td className="px-4 py-3 text-slate-600">{formatDate(user.createdAt)}</td>
              <td className="px-4 py-3 text-slate-600">{formatDate(user.lastSignInAt)}</td>
              <td className="px-4 py-3 text-slate-600">{formatDate(user.lastActiveAt)}</td>
              <td className="px-4 py-3 tabular-nums">{formatNumber(user.actions7d)}</td>
              <td className="px-4 py-3 tabular-nums">{formatNumber(user.actions30d)}</td>
              <td className="px-4 py-3 tabular-nums">{formatNumber(user.chatCount)}</td>
              <td className="px-4 py-3 tabular-nums">{formatNumber(user.tripCount)}</td>
              <td className="px-4 py-3 tabular-nums">{formatNumber(user.savedPlaceCount)}</td>
              <td className="px-4 py-3">
                <PlanBadge plan={user.plan} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UserStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="tabular-nums text-slate-800">{formatNumber(value)}</dd>
    </div>
  );
}

function UserCardList({ users }: { users: AdminActiveUser[] }) {
  return (
    <ul className="divide-y divide-slate-100 md:hidden">
      {users.map((user) => (
        <li key={user.userId} className="space-y-2 px-4 py-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <UserLabel user={user} />
            <PlanBadge plan={user.plan} />
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <UserStat label="近 7 日操作" value={user.actions7d} />
            <UserStat label="近 30 日操作" value={user.actions30d} />
            <UserStat label="使用者對話" value={user.chatCount} />
            <UserStat label="收藏行程" value={user.tripCount} />
            <UserStat label="收藏地點" value={user.savedPlaceCount} />
          </dl>
          <p className="text-xs text-slate-400">
            最後活躍 {formatDate(user.lastActiveAt)} · 加入 {formatDate(user.createdAt)}
          </p>
          <p className="text-xs text-slate-400">最後登入 {formatDate(user.lastSignInAt)}</p>
        </li>
      ))}
    </ul>
  );
}

export function UsersSection({
  users,
  usersTotal,
  page,
  totalPages,
  loading,
  searchInput,
  onSearchInput,
  sort,
  sortOptions,
  onSort,
  onPage,
}: {
  users: AdminActiveUser[];
  usersTotal: number;
  /** loading 時為正在請求的頁碼，其餘時候為上一個成功載入的頁碼 */
  page: number;
  totalPages: number;
  loading: boolean;
  searchInput: string;
  onSearchInput: (value: string) => void;
  sort: AdminUserSort;
  sortOptions: Array<{ value: AdminUserSort; label: string }>;
  onSort: (value: AdminUserSort) => void;
  onPage: (value: number) => void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" />
          <h2 className="font-semibold">活躍使用者</h2>
          <span className="text-xs text-slate-400">{formatNumber(usersTotal)} 位使用者</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative min-w-0">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={searchInput}
              onChange={(event) => onSearchInput(event.target.value)}
              placeholder="搜尋名稱、Email 或 UUID"
              className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-slate-500 sm:w-72"
            />
          </label>
          <select
            value={sort}
            onChange={(event) => onSort(event.target.value as AdminUserSort)}
            className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? (
        <TableSkeleton />
      ) : users.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">找不到符合條件的使用者</p>
      ) : (
        <>
          <UsersTable users={users} />
          <UserCardList users={users} />
        </>
      )}
      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
        <span className="text-slate-500">
          {loading
            ? `正在載入第 ${formatNumber(page)} 頁…`
            : `第 ${formatNumber(page)} 頁，共 ${formatNumber(totalPages)} 頁`}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={loading || page <= 1}
            className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
            aria-label="上一頁"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={loading || page >= totalPages}
            className="rounded-md border border-slate-300 p-2 disabled:opacity-40"
            aria-label="下一頁"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
