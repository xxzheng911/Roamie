import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useEffect, useRef, useState } from "react";
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
import { setHomeRouteVisible } from "@/lib/home-route-active";
import { syncRouteKeyboardMode } from "@/lib/route-keyboard-mode";
import {
  logPerfRouteChange,
  logPerfRouteDuration,
} from "@/lib/app-perf";
import { useScrollPerfMonitor } from "@/hooks/use-scroll-perf-monitor";

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

function scrollPerfPageName(pathname: string): string | null {
  const path = normalizeAppPath(pathname);
  if (path === "/") return "home";
  if (path === "/chat") return null;
  if (path === "/map") return "map";
  if (path === "/saved") return "saved";
  if (path === "/profile") return "profile";
  if (isTripDetailPath(path)) return "trip-detail";
  return path.replace(/^\//, "") || null;
}

function applyRouteSideEffects(nextPath: string, prevPath: string): void {
  const next = normalizeAppPath(nextPath);
  const prev = normalizeAppPath(prevPath);
  const onHome = next === "/";
  const wasHome = prev === "/";

  setHomeRouteVisible(onHome);
  if (onHome && !wasHome) {
    enterHomeLocationMode();
    stopLocationWatch("home_route_active");
  } else if (!onHome && wasHome) {
    leaveHomeLocationMode();
  }

  syncRouteKeyboardMode(next);
}

function stopLocationWatch(reason: string): void {
  void import("@/lib/location-watch-cleanup").then(({ stopNavigationLocationWatch }) =>
    stopNavigationLocationWatch(reason),
  );
}

let appShellBootstrapped = false;

function bootstrapAppShellOnce(locale: string): void {
  if (appShellBootstrapped) return;
  appShellBootstrapped = true;

  void import("@/lib/home-startup").then(({ prefetchHomeData }) => {
    prefetchHomeData(locale as import("@/lib/i18n/types").Locale);
  });

  void import("@/lib/capacitor-keyboard-bridge").then(({ bootstrapCapacitorKeyboardBridge }) => {
    bootstrapCapacitorKeyboardBridge();
  });
}

function AppLayout() {
  const router = useRouter();
  const { locale } = useI18n();

  const [pathname, setPathname] = useState(
    () => router.state.location.pathname || readBrowserPathname(),
  );

  const pathnameRef = useRef(pathname);
  const normalizedPath = normalizeAppPath(pathname);

  useLayoutEffect(() => {
    scheduleIosSnapshotRefreshBurst("app-shell");
    bootstrapAppShellOnce(locale);
  }, [locale]);

  useLayoutEffect(() => {
    applyRouteSideEffects(normalizedPath, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial shell route only
  }, []);

  useEffect(() => {
    markBootPhase("route:_app:mounted", "shell");
    console.info("[ROUTE_MOUNT]", "_app");

    const sync = () => {
      const from = pathnameRef.current;
      const next = router.state.location.pathname;
      if (from === next) return;
      applyRouteSideEffects(next, from);
      logPerfRouteChange(from, next);
      pathnameRef.current = next;
      setPathname(next);
      requestAnimationFrame(() => {
        logPerfRouteDuration(from, next);
      });
    };

    const unsub = router.subscribe("onResolved", sync);
    window.addEventListener("popstate", sync);
    return () => {
      unsub();
      window.removeEventListener("popstate", sync);
    };
  }, [router]);

  useEffect(() => {
    if (normalizedPath !== "/map") {
      stopLocationWatch("left_map_route");
    }
  }, [normalizedPath]);

  const mainScrollLocked = isMainScrollLockedPath(pathname);
  const scrollPerfPage = scrollPerfPageName(pathname);
  useScrollPerfMonitor(scrollPerfPage ?? "");

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
          <AppErrorBoundary routeLabel="_app">
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
