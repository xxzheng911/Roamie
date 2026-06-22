import "./client-entry";
import "./boot-trace";
import { scheduleAppInitHandlers } from "@/lib/app-init-handlers";

scheduleAppInitHandlers();

import { QueryClient } from "@tanstack/react-query";
import { createRouter, type AnyRouter } from "@tanstack/react-router";
import { RoamieRoutePending } from "@/components/RoamieRoutePending";
import { hasExternalBootSplash } from "@/lib/boot-splash";
import { normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import { logAppError } from "@/lib/log-error";
import { requestIosSnapshotRefresh } from "@/lib/ios-snapshot-bridge";
import { normalizeRouterSsrManifest } from "@/lib/ssr-manifest";
import { logRouterCreate } from "@/lib/startup-boot-state";
import { routeTree } from "./routeTree.gen";

function BootAwareRoutePending() {
  if (hasExternalBootSplash()) return null;
  return <RoamieRoutePending />;
}

let sharedQueryClient: QueryClient | null = null;
let sharedRouter: AnyRouter | null = null;

export const getRouter = () => {
  if (sharedRouter) {
    logRouterCreate(true);
    return sharedRouter;
  }

  logRouterCreate(false);

  if (typeof window !== "undefined") {
    try {
      normalizeCapacitorEntryPath();
    } catch (error) {
      logAppError("APP_INIT_ERROR", error, { source: "getRouter.normalizeCapacitorEntryPath" });
    }
  }

  sharedQueryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient: sharedQueryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: BootAwareRoutePending,
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

  sharedRouter = router;
  return router;
};
