import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MobileFrame } from "@/components/MobileFrame";
import { BottomNav } from "@/components/BottomNav";
import { requireAppShellAccess } from "@/lib/require-auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: requireAppShellAccess,
  component: AppLayout,
});

function AppLayout() {
  return (
    <MobileFrame>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main className="app-scroll flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto no-scrollbar pt-[var(--safe-area-top)] pb-[var(--app-nav-total-height)]">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </MobileFrame>
  );
}
