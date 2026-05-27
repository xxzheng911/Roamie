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
    defaultPendingMinMs: 0,
  });

  try {
    normalizeRouterSsrManifest(router);
  } catch (error) {
    logAppError("APP_INIT_ERROR", error, { source: "getRouter.normalizeRouterSsrManifest" });
  }

  if (typeof window !== "undefined") {
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
      requestIosSnapshotRefresh("route", { force: true });
    });
  }

  return router;
};
