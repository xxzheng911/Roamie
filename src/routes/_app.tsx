import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useEffect, useState } from "react";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { readBrowserPathname } from "@/lib/startup-path";
import { MobileFrame } from "@/components/MobileFrame";
import { BottomNav } from "@/components/BottomNav";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { requireAppShellAccess } from "@/lib/require-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app")({
  beforeLoad: requireAppShellAccess,
  component: AppLayout,
});

function isMainScrollLockedPath(pathname: string): boolean {
  return pathname === "/chat" || pathname === "/map" || pathname === "/plan";
}

function AppLayout() {
  const router = useRouter();

  useLayoutEffect(() => {
    scheduleIosSnapshotRefreshBurst("app-shell");
  }, []);
  const [pathname, setPathname] = useState(
    () => router.state.location.pathname || readBrowserPathname(),
  );

  useEffect(() => {
    markBootPhase("route:_app:mounted", "path=" + pathname);
    console.info("[ROUTE_MOUNT]", pathname);
    const sync = () => setPathname(router.state.location.pathname);
    const unsub = router.subscribe("onResolved", sync);
    window.addEventListener("popstate", sync);
    return () => {
      unsub();
      window.removeEventListener("popstate", sync);
    };
  }, [router]);

  const mainScrollLocked = isMainScrollLockedPath(pathname);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("map-route-active", pathname === "/map");
    document.documentElement.classList.toggle("chat-route-active", pathname === "/chat");

    const main = document.querySelector("main.app-scroll");
    if (!(main instanceof HTMLElement)) return;

    if (!mainScrollLocked) {
      main.style.removeProperty("overflow");
      main.style.removeProperty("overflow-y");
      main.style.removeProperty("overflow-x");
    }
  }, [pathname, mainScrollLocked]);

  return (
    <MobileFrame>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main
          className={cn(
            "app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)]",
            pathname === "/chat"
              ? "pb-0"
              : "pb-[var(--app-nav-total-height)]",
            mainScrollLocked ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto",
          )}
        >
          <AppErrorBoundary>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Outlet />
            </div>
          </AppErrorBoundary>
        </main>
        <BottomNav hiddenOnKeyboard={pathname === "/chat"} />
      </div>
    </MobileFrame>
  );
}
