import "./lib/production-logging";
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
import { requestIosRouteSnapshotRefresh } from "@/lib/ios-snapshot-bridge";
import { normalizeRouterSsrManifest } from "@/lib/ssr-manifest";
import { logRouterCreate } from "@/lib/startup-boot-state";
import { routeTree } from "./routeTree.gen";

function BootAwareRoutePending() {
  if (hasExternalBootSplash()) return null;
  return <RoamieRoutePending />;
}

let sharedRouter: AnyRouter | null = null;

export const getRouter = () => {
  if (typeof window !== "undefined" && sharedRouter) {
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

  // SSR requests must not reuse another request's history/search/redirect state.
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: BootAwareRoutePending,
    defaultPendingMinMs: 0,
  });
  console.info("[APP_BOOT_STAGE]", {
    stage: "router_ready",
    elapsedMs: Math.round(performance.now()),
    route: typeof location !== "undefined" ? location.pathname : "",
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
      requestIosRouteSnapshotRefresh(path);
      if (import.meta.env.DEV) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            console.debug("[APP_SURFACE_RUNTIME]", {
              route: path,
              shellCount: document.querySelectorAll(".mobile-frame-inner").length,
              chatSurfaceCount: document.querySelectorAll(".messenger-chat-root").length,
              bottomNavCount: document.querySelectorAll(".bottom-nav").length,
            });
          });
        });
      }
    });
  }

  if (typeof window !== "undefined") sharedRouter = router;
  return router;
};
