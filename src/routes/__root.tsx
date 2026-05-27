import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  redirect,
  useRouter,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";
import { App } from "@/App";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { detectPlatform } from "@/services/platform";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { RoamieAppErrorFallback } from "@/components/RoamieAppErrorFallback";
import { StartupGate } from "@/components/StartupGate";
import { OAuthRouterBridge } from "@/components/OAuthRouterBridge";
import { scheduleRemoveStaticBootPlaceholder } from "@/main";
import { bootstrapNativeShell } from "@/services/platform";
import { markAppReady } from "@/lib/startup-route";
import { toCapacitorBundledAssetHref } from "@/lib/capacitor-asset-href";
import { isCapacitorSpaMount, normalizeCapacitorEntryPath } from "@/lib/capacitor-entry-path";
import { formatErrorDetail, logAppError } from "@/lib/log-error";
import { normalizeRouterSsrManifest } from "@/lib/ssr-manifest";
import { useServerFn } from "@tanstack/react-start";
import {
  routesComputeDistance,
  routesComputeDuration,
  routesComputeTripLegs,
  routesTestConnection,
} from "@/lib/routes.functions";
import { getWeather, getWeatherForecast, weatherTestConnection } from "@/lib/weather.functions";
import { runApiBootstrap } from "@/services/apiBootstrap";
import { isOnboardingCompletedSync, loadOnboardingState } from "@/lib/onboarding-storage";
import { readBrowserPathname } from "@/lib/startup-path";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  logAppError("[Roamie] route error boundary", error);
  const router = useRouter();
  const navigate = useNavigate();

  const recoverToStartup = () => {
    reset();
    void import("@/lib/clear-auth-state").then(({ resetToLoginScreen }) => {
      void resetToLoginScreen("root-error-recover");
    });
  };

  const detail = formatErrorDetail(error);

  return (
    <RoamieAppErrorFallback
      title="Roamie 暫時無法載入"
      message="發生未預期的錯誤。請重試，或重新啟動 App。"
      detail={detail}
      onRetry={() => window.location.reload()}
      onHome={recoverToStartup}
      retryLabel="重新整理"
      homeLabel="重新啟動"
    />
  );
}

/** Ensures SSR manifest shape after Capacitor SPA hydrate (manifest.routes must exist). */
function RouterSsrManifestGuard() {
  const router = useRouter();

  useEffect(() => {
    try {
      normalizeCapacitorEntryPath();
    } catch (e) {
      logAppError("APP_INIT_ERROR", e, { source: "RouterSsrManifestGuard" });
    }
    try {
      normalizeRouterSsrManifest(router);
    } catch (e) {
      logAppError("APP_INIT_ERROR", e, { source: "RouterSsrManifestGuard.manifest" });
    }
  }, [router]);

  return null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    await loadOnboardingState();
    if (isOnboardingCompletedSync()) return;
    const path = readBrowserPathname().replace(/\/+$/, "") || "/";
    if (path === "/welcome" || path === "/onboarding") return;
    if (path.startsWith("/auth/")) return;
    console.log("[ONBOARDING_GUARD] blocked home redirect", {
      source: "root-beforeLoad",
      from: path,
      targetRoute: "/welcome",
    });
    throw redirect({ to: "/welcome" });
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no",
      },
      { name: "screen-orientation", content: "portrait" },
      { name: "theme-color", content: "#f7f4ef" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { title: "Roamie｜你的慢旅行夥伴" },
      {
        name: "description",
        content:
          "Roamie 是一個讓你不再為了「今天要做什麼」煩惱的旅行夥伴。給你剛剛好的安排，剛剛好的留白。",
      },
      { property: "og:title", content: "Roamie｜你的慢旅行夥伴" },
      {
        property: "og:description",
        content: "一個溫柔的 AI 旅行夥伴，幫你避開人潮、留下舒服的空白。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: toCapacitorBundledAssetHref(appCss),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // Capacitor bundled HTML already has <html>/<body>; nesting another document in #root causes WKWebView white screen.
  if (isCapacitorSpaMount()) {
    return <>{children}</>;
  }

  return (
    <html lang="zh-Hant" className="roamie-app">
      <head>
        <HeadContent />
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body{background-color:#f7f4ef;color:#2a2520}`,
          }}
        />
      </head>
      <body className="roamie-body antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const routesDuration = useServerFn(routesComputeDuration);
  const routesDistance = useServerFn(routesComputeDistance);
  const routesTripLegs = useServerFn(routesComputeTripLegs);
  const routesTest = useServerFn(routesTestConnection);
  const fetchWeather = useServerFn(getWeather);
  const fetchForecast = useServerFn(getWeatherForecast);
  const weatherTest = useServerFn(weatherTestConnection);

  useLayoutEffect(() => {
    runApiBootstrap({
      weather: {
        fetchWeather: (args) => fetchWeather(args),
        fetchForecast: (args) => fetchForecast(args),
        testConnection: () => weatherTest(),
      },
      routes: {
        computeDuration: (args) => routesDuration(args),
        computeDistance: (args) => routesDistance(args),
        computeTripLegs: (args) => routesTripLegs(args),
        testConnection: () => routesTest(),
      },
    });
    markBootPhase("root:layoutEffect");
    scheduleRemoveStaticBootPlaceholder();
    markAppReady();
    const platform = detectPlatform();
    if (!(platform.isCapacitor && platform.isIOS)) {
      scheduleIosSnapshotRefreshBurst("root-ready");
    }
    const deferNative = () => {
      void bootstrapNativeShell();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(deferNative, { timeout: 3_000 });
    } else {
      window.setTimeout(deferNative, 0);
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <App>
          <RouterSsrManifestGuard />
          <OAuthRouterBridge />
          <StartupGate>
            <Outlet />
          </StartupGate>
          <Toaster />
        </App>
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}
