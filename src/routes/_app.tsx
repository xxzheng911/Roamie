import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useEffect, useState } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { readBrowserPathname } from "@/lib/startup-path";
import { MobileFrame } from "@/components/MobileFrame";
import { BottomNav } from "@/components/BottomNav";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { requireAppShellAccess } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { enterHomeLocationMode, leaveHomeLocationMode } from "@/lib/location-coordinator";

export const Route = createFileRoute("/_app")({
  beforeLoad: requireAppShellAccess,
  component: AppLayout,
});

function normalizeAppPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function isMainScrollLockedPath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return path === "/chat" || path === "/map" || path === "/plan";
}

function isTripDetailPath(pathname: string): boolean {
  return /^\/saved\/[^/]+$/.test(normalizeAppPath(pathname));
}

function stopLocationWatch(reason: string): void {
  void import("@/lib/location-watch-cleanup").then(({ stopNavigationLocationWatch }) =>
    stopNavigationLocationWatch(reason),
  );
}

function AppLayout() {
  const router = useRouter();
  const { locale } = useI18n();

  const [pathname, setPathname] = useState(
    () => router.state.location.pathname || readBrowserPathname(),
  );

  useLayoutEffect(() => {
    scheduleIosSnapshotRefreshBurst("app-shell");
    const path = (router.state.location.pathname || readBrowserPathname()).replace(/\/+$/, "") || "/";
    if (path === "/") {
      enterHomeLocationMode();
      stopLocationWatch("home_route_active");
    }
    void import("@/lib/effective-location").then(({ ensureEffectiveLocationBootstrap }) => {
      ensureEffectiveLocationBootstrap();
    });
  }, [router]);

  useLayoutEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (path === "/") {
      enterHomeLocationMode();
      stopLocationWatch("home_route_active");
    } else {
      leaveHomeLocationMode();
    }
  }, [pathname]);

  useLayoutEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (path !== "/") return;
    console.info("[HOME_SHELL] index route active");
    void import("@/lib/home-weather-bootstrap").then(({ ensureHomeWeatherBootstrap }) => {
      ensureHomeWeatherBootstrap(locale, "app-shell");
    });
  }, [pathname, locale]);

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

  useEffect(() => {
    const path = pathname.replace(/\/+$/, "") || "/";
    if (path !== "/map") {
      stopLocationWatch("left_map_route");
    }
  }, [pathname]);

  const mainScrollLocked = isMainScrollLockedPath(pathname);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("map-route-active", pathname === "/map");
    document.documentElement.classList.toggle("chat-route-active", pathname === "/chat");
    document.documentElement.classList.toggle("trip-detail-route-active", isTripDetailPath(pathname));

    const main = document.querySelector("main.app-scroll");
    if (!(main instanceof HTMLElement)) return;

    if (!mainScrollLocked) {
      main.style.removeProperty("overflow");
      main.style.removeProperty("overflow-y");
      main.style.removeProperty("overflow-x");
      main.style.removeProperty("height");
      main.style.removeProperty("min-height");
    } else {
      main.style.overflow = "hidden";
      main.style.overflowY = "hidden";
      main.style.overflowX = "hidden";
      main.style.minHeight = "0";
      main.style.removeProperty("height");
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
            mainScrollLocked ? "min-h-0 flex-1 overflow-hidden" : "overflow-x-hidden overflow-y-auto",
          )}
        >
          <AppErrorBoundary>
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                mainScrollLocked && "min-h-0",
              )}
            >
              <Outlet />
            </div>
          </AppErrorBoundary>
        </main>
        <BottomNav hiddenOnKeyboard={pathname === "/chat"} />
      </div>
    </MobileFrame>
  );
}
