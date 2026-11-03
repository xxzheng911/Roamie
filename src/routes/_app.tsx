import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/use-i18n";
import { markBootPhase } from "@/lib/boot-diagnostics";
import { scheduleIosSnapshotRefreshBurst } from "@/lib/ios-snapshot-bridge";
import { readBrowserPathname } from "@/lib/startup-path";
import { MobileFrame } from "@/components/MobileFrame";
import { BottomNav, RIGHT_RAIL_WIDTH_VALUE, RIGHT_RAIL_WIDTH_VAR } from "@/components/BottomNav";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { requireAppShellAccess } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { enterHomeLocationMode, leaveHomeLocationMode } from "@/lib/location-coordinator";
import { setHomeRouteVisible } from "@/lib/home-route-active";
import { syncRouteKeyboardMode } from "@/lib/route-keyboard-mode";
import { logPerfRouteChange, logPerfRouteDuration } from "@/lib/app-perf";
import { useScrollPerfMonitor } from "@/hooks/use-scroll-perf-monitor";
import { useDuoLayout } from "@/hooks/use-duo-layout";
import { useDuoDevice, useDuoFlatPortrait, useDuoLaptop } from "@/hooks/use-duo-laptop";
import {
  appContentWrapperClass,
  isMainScrollLockedPath,
  isTripDetailPath,
  normalizeAppPath,
} from "@/lib/app-scroll-contract";

export const Route = createFileRoute("/_app")({
  beforeLoad: requireAppShellAccess,
  component: AppLayout,
});

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

/** iPhone Duo：main 右側讓出系統直欄（右側導覽所在，寬度＝--app-rail-width），內容不得進入直欄。 */
const RIGHT_RAIL_MAIN_STYLE: CSSProperties = { paddingRight: RIGHT_RAIL_WIDTH_VAR };
/** main 已讓出右側安全區；內層頁面的 max(…, var(--safe-area-right)) 不再重複內縮。 */
const RIGHT_RAIL_CONTENT_STYLE = { "--safe-area-right": "0px" } as CSSProperties;
/**
 * iPhone Duo 展開雙欄＋行程詳情：內容改為橫向排列（左欄行程｜摺痕間隔｜右欄地圖，見 TripDetailScreen）。
 * 右欄以 flex 填滿剩餘寬度，因此右緣與 main 的 --app-rail-width 內縮一致。
 */
const RIGHT_RAIL_TWO_PANE_TRIP_CONTENT_STYLE = {
  ...RIGHT_RAIL_CONTENT_STYLE,
  flexDirection: "row",
  paddingLeft: "var(--safe-area-left)",
} as CSSProperties;

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
    document.documentElement.classList.toggle(
      "trip-detail-route-active",
      isTripDetailPath(pathname),
    );

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

  // iPhone Duo（右側系統直欄）才啟用新版型；其他裝置 rightRail 為 false，以下輸出與修改前相同。
  const duoLayout = useDuoLayout();
  const rightRail = duoLayout.navPlacement === "right-rail";
  const duoPane =
    rightRail && duoLayout.tripLayout === "two-pane" ? (duoLayout.pane ?? null) : null;
  // 摺痕左右緣（px）：styles.css 的 html.duo-two-pane 規則以此把浮動元件限制在左頁
  const foldLeftEdge = duoPane ? duoPane.foldX - duoPane.gutter / 2 : null;
  const foldRightEdge = duoPane ? duoPane.foldX + duoPane.gutter / 2 : null;

  useLayoutEffect(() => {
    if (!rightRail) return;
    // 導覽改在右側直欄：底部不再預留導覽高度。用 0.01px 而非 0：
    // map-visible-padding／use-messenger-chat-layout 以 `parseFloat(...) || 68` 讀取，0 會被當成 68。
    // duo-rail class 與 --app-rail-width 只在 rail 時存在（styles.css 的 Duo 規則皆以 html.duo-rail 為前綴）。
    const root = document.documentElement;
    root.style.setProperty("--bottom-nav-height", "0.01px");
    root.style.setProperty("--app-rail-width", RIGHT_RAIL_WIDTH_VALUE);
    root.classList.add("duo-rail");
    return () => {
      root.style.removeProperty("--bottom-nav-height");
      root.style.removeProperty("--app-rail-width");
      root.classList.remove("duo-rail");
    };
  }, [rightRail]);

  useLayoutEffect(() => {
    if (foldLeftEdge == null || foldRightEdge == null) return;
    const root = document.documentElement;
    root.style.setProperty("--duo-fold-left-edge", `${foldLeftEdge}px`);
    root.style.setProperty("--duo-fold-right-edge", `${foldRightEdge}px`);
    root.classList.add("duo-two-pane");
    return () => {
      root.style.removeProperty("--duo-fold-left-edge");
      root.style.removeProperty("--duo-fold-right-edge");
      root.classList.remove("duo-two-pane");
    };
  }, [foldLeftEdge, foldRightEdge]);

  // iPhone Duo 上下版型（#H3-3 合一）：筆電半開（橫向摺痕）或直向攤平（fullyOpen、直向）。
  // 兩個 hook 衍生自同一個穩定化 store，同一次 render 一起改變；這裡依同一個結果、在同一個 effect 內
  // 切換 class（duo-laptop／duo-flat-portrait）與摺痕上下緣變數，筆電↔直向攤平互換時不經過手機版型。
  // 優先序：雙欄 > 筆電 > 直向攤平（duoPane 存在時兩者皆不設定）。其他裝置兩者恆為否，不設定任何 class／變數。
  const duoLaptop = useDuoLaptop();
  const duoFlatPortrait = useDuoFlatPortrait();
  const stackedClass = duoPane
    ? null
    : duoLaptop.laptop
      ? "duo-laptop"
      : duoFlatPortrait.flat
        ? "duo-flat-portrait"
        : null;
  const stackedFold = duoLaptop.laptop ? duoLaptop : duoFlatPortrait.flat ? duoFlatPortrait : null;
  const hingeTop = stackedClass && stackedFold ? stackedFold.foldTop : null;
  const hingeBottom = stackedClass && stackedFold ? stackedFold.foldBottom : null;

  // 版型或摺痕改變時，舊值的 cleanup 與新值的設定在同一次 commit 內同步執行（中間不繪製）。
  useLayoutEffect(() => {
    if (stackedClass == null || hingeTop == null || hingeBottom == null) return;
    const root = document.documentElement;
    root.style.setProperty("--duo-hinge-top", `${hingeTop}px`);
    root.style.setProperty("--duo-hinge-bottom", `${hingeBottom}px`);
    root.classList.add(stackedClass);
    return () => {
      root.style.removeProperty("--duo-hinge-top");
      root.style.removeProperty("--duo-hinge-bottom");
      root.classList.remove(stackedClass);
    };
  }, [stackedClass, hingeTop, hingeBottom]);

  // iPhone Duo 裝置標記：只在原生 iOS 且裝置有 hinge 時加 duo-device（styles.css 的 html.duo-device 規則）；
  // 其他裝置 useDuoDevice 恆為 false，不加 class。
  const duoDevice = useDuoDevice();

  useLayoutEffect(() => {
    if (!duoDevice) return;
    const root = document.documentElement;
    root.classList.add("duo-device");
    return () => {
      root.classList.remove("duo-device");
    };
  }, [duoDevice]);

  const contentStyle = !rightRail
    ? undefined
    : duoPane && isTripDetailPath(pathname)
      ? RIGHT_RAIL_TWO_PANE_TRIP_CONTENT_STYLE
      : RIGHT_RAIL_CONTENT_STYLE;

  return (
    <MobileFrame fullBleed={rightRail}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <main
          className={cn(
            "app-scroll flex min-h-0 flex-1 flex-col no-scrollbar pt-[var(--safe-area-top)]",
            pathname === "/chat" ? "pb-0" : "pb-[var(--app-nav-total-height)]",
            mainScrollLocked
              ? "min-h-0 flex-1 overflow-hidden"
              : "overflow-x-hidden overflow-y-auto",
          )}
          style={rightRail ? RIGHT_RAIL_MAIN_STYLE : undefined}
        >
          <AppErrorBoundary routeLabel="_app">
            <div className={appContentWrapperClass(mainScrollLocked)} style={contentStyle}>
              <Outlet />
            </div>
          </AppErrorBoundary>
        </main>
        <BottomNav
          hiddenOnKeyboard={pathname === "/chat"}
          placement={rightRail ? "right-rail" : "bottom"}
        />
      </div>
    </MobileFrame>
  );
}
