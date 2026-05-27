import { useAuth } from "@/hooks/use-auth";
import { isQaBuildEnabled } from "@/lib/qa-auth/build";
import { isQaTestUser } from "@/lib/qa-auth/user";

export function QaTestUserBadge() {
  const { user } = useAuth();

  if (!isQaBuildEnabled() || !isQaTestUser(user)) return null;

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 z-[9998] flex justify-center px-3"
      style={{ top: "max(6px, env(safe-area-inset-top, 0px))" }}
      role="status"
      aria-live="polite"
    >
      <span className="rounded-full border border-amber-600/50 bg-amber-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-950 shadow-md">
        DEV TEST USER
      </span>
    </div>
  );
}
