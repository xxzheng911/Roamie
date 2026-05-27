import "./client-entry";
import "./boot-trace";
import { scheduleAppInitHandlers } from "@/lib/app-init-handlers";

scheduleAppInitHandlers();

import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import { logAppError } from "@/lib/log-error";
import { requestIosSnapshotRefresh } from "@/lib/ios-snapshot-bridge";
import { normalizeRouterSsrManifest } from "@/lib/ssr-manifest";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  if (typeof window !== "undefined") {
    try {
      normalizeCapacitorEntryPath();
    } catch (error) {
      logAppError("APP_INIT_ERROR", error, { source: "getRouter.normalizeCapacitorEntryPath" });
    }
  }

  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: RoamieRoutePending,
    /** 避免子路由切換時瞬間閃出全屏 loading（實機尤其明顯） */
    defaultPendingMs: 220,
    defaultPendingMinMs: 120,
  });

  try {
    normalizeRouterSsrManifest(router);
  } catch (error) {
    logAppError("APP_INIT_ERROR", error, { source: "getRouter.normalizeRouterSsrManifest" });
  }

  if (typeof window !== "undefined") {
    router.subscribe("onLoad", (event) => {
      if (event.type === "onLoad" && event.routeError) {
        logAppError("ROUTER_ROUTE_LOAD_ERROR", event.routeError, {
          routeId: event.routeId,
          path: window.location.pathname,
        });
      }
    });

    let routeSnapshotTimer: ReturnType<typeof setTimeout> | undefined;
    router.subscribe("onResolved", () => {
      const path = window.location.pathname.replace(/\/+$/, "") || "/";
      if (
        path === "/login" ||
        path.startsWith("/login/") ||
        path === "/auth/callback" ||
        path === "/welcome"
      ) {
        return;
      }
      if (routeSnapshotTimer) clearTimeout(routeSnapshotTimer);
      routeSnapshotTimer = setTimeout(() => {
        requestIosSnapshotRefresh("route", { force: true });
      }, 450);
    });
  }

  return router;
};
