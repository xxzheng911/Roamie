import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MobileFrame } from "@/components/MobileFrame";
import { BottomNav } from "@/components/BottomNav";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  return (
    <MobileFrame>
      <div className="flex min-h-0 flex-1 flex-col">
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto no-scrollbar pb-[calc(var(--bottom-nav-height,4.25rem)+env(safe-area-inset-bottom,0px))]">
          <Outlet />
        </main>
        <BottomNav />
      </div>
    </MobileFrame>
  );
}
