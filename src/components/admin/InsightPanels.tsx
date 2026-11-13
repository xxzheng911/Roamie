import { Activity, Database } from "lucide-react";
import type { AdminActiveUser, PopularDestination } from "@/lib/admin/admin-analytics";
import { formatDate, formatNumber } from "./admin-format";
import { UserLabel } from "./UserLabel";
import { UserStat } from "./UsersSection";

const TOP_USER_COLUMNS = [
  "排名",
  "使用者",
  "近 7 日",
  "近 30 日",
  "對話",
  "行程",
  "地點",
  "最後活躍",
];

function EmptyState({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{text}</p>;
}

export function TopUsersPanel({ users }: { users: AdminActiveUser[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Activity className="h-4 w-4 text-slate-500" />
        <h2 className="font-semibold">最活躍使用者</h2>
      </div>
      {users.length === 0 ? (
        <EmptyState text="尚無活躍使用者資料" />
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  {TOP_USER_COLUMNS.map((x) => (
                    <th key={x} className="pb-2 pr-3 font-medium">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user, index) => (
                  <tr key={user.userId}>
                    <td className="py-3 pr-3 text-slate-400">{index + 1}</td>
                    <td className="max-w-56 py-3 pr-3">
                      <UserLabel user={user} />
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{formatNumber(user.actions7d)}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatNumber(user.actions30d)}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatNumber(user.chatCount)}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatNumber(user.tripCount)}</td>
                    <td className="py-3 pr-3 tabular-nums">{formatNumber(user.savedPlaceCount)}</td>
                    <td className="py-3 text-slate-500">{formatDate(user.lastActiveAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="divide-y divide-slate-100 md:hidden">
            {users.map((user, index) => (
              <li key={user.userId} className="space-y-2 py-3 text-sm">
                <div className="flex items-start gap-3">
                  <span className="w-5 shrink-0 text-slate-400">{index + 1}</span>
                  <UserLabel user={user} />
                </div>
                <dl className="grid grid-cols-3 gap-2 pl-8">
                  <UserStat label="近 7 日" value={user.actions7d} />
                  <UserStat label="近 30 日" value={user.actions30d} />
                  <UserStat label="對話" value={user.chatCount} />
                  <UserStat label="行程" value={user.tripCount} />
                  <UserStat label="地點" value={user.savedPlaceCount} />
                </dl>
                <p className="pl-8 text-xs text-slate-400">
                  最後活躍 {formatDate(user.lastActiveAt)}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function DestinationsPanel({ rows }: { rows: PopularDestination[] }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="mb-4 flex items-center gap-2">
        <Database className="h-4 w-4 text-slate-500" />
        <h2 className="font-semibold">熱門收藏行程目的地</h2>
      </div>
      {rows.length === 0 ? (
        <EmptyState text="尚無收藏行程目的地" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="pb-2 pr-3 font-medium">目的地</th>
                <th className="pb-2 pr-3 font-medium">收藏行程</th>
                <th className="pb-2 pr-3 font-medium">使用者</th>
                <th className="pb-2 font-medium">最後收藏</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.destination}>
                  <td className="break-words py-3 pr-3 font-medium">{row.destination}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatNumber(row.tripCount)}</td>
                  <td className="py-3 pr-3 tabular-nums">{formatNumber(row.uniqueUsers)}</td>
                  <td className="py-3 text-slate-500">{formatDate(row.lastSavedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
