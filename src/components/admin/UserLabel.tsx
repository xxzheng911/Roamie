import type { AdminActiveUser } from "@/lib/admin/admin-analytics";
import { displayName } from "./admin-format";
import { EmailCell } from "./EmailCell";

export function UserLabel({ user }: { user: AdminActiveUser }) {
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-slate-900">{displayName(user)}</p>
      <EmailCell email={user.email} />
    </div>
  );
}

export function PlanBadge({ plan }: { plan: AdminActiveUser["plan"] }) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-medium ${plan === "plus" ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-600"}`}
    >
      {plan === "plus" ? "Plus" : "Free"}
    </span>
  );
}
