import { applyTripCover, readTripCoverEvent, SAVED_TRIPS_CHANGED_EVENT } from "@/lib/saved-trip/cover-live-state";
import { useI18n } from "@/hooks/use-i18n";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useRouter, useRouterState, type RouterEvents } from "@tanstack/react-router";
import { Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SavedTripItineraryEditor } from "@/components/saved/SavedTripItineraryEditor";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { TripSharePanel } from "@/components/trip/TripSharePanel";
import { deleteTripDialogLabels } from "@/lib/i18n/delete-trip-dialog";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { getItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { getTripAccess, listTripMembers, type TripMemberRow } from "@/lib/trip/trip-collab";
import {
  TripWorkspaceBar,
  workspacePanelId,
  workspaceTabId,
} from "@/components/trip/TripWorkspaceBar";
import { TripWorkspaceOverview } from "@/components/trip/TripWorkspaceOverview";
import { TripWorkspaceMap } from "@/components/trip/TripWorkspaceMap";
import {
  clearTripOverviewSubpageReturn,
  readTripOverviewSubpageReturn,
} from "@/components/trip/expenses/expenses-return";
import {
  clearTripMapReturnState,
  readTripMapReturnState,
  saveTripMapReturnState,
} from "@/components/trip/trip-map-return";
import type { RoamiePayloadV2 } from "@/lib/ai/types";
import { isLocatedCoordinate } from "@/lib/trip/trip-map-markers";
import { useWorkspaceSwipe, WORKSPACE_PANE_STYLE } from "@/hooks/use-workspace-swipe";
import { useDuoLayout } from "@/hooks/use-duo-layout";
import { getTripWorkspaceCopy } from "@/lib/i18n/trip-workspace-copy";
import { effectiveAppLocale } from "@/lib/i18n/effective-app-locale";
import { translate } from "@/lib/i18n/translate";
import {
  readTripWorkspaceScrollTops,
  saveTripWorkspaceScrollTops,
  type TripWorkspaceScrollTops,
} from "@/lib/trip/trip-detail-view-state";
import type { WorkspaceView } from "@/lib/trip/workspace-view";
import type { TripWorkspaceRenderContext } from "@/components/saved/SavedTripItineraryEditor";
import { useTripRealtimeSync } from "@/lib/trip/use-trip-realtime";
import { TRIP_DETAIL_COMPONENT } from "@/lib/trip/trip-detail-nav";
import { resolveCoreTripTitle, toCoreTrip } from "@/lib/trip/core-trip";
import { isValidUuid } from "@/lib/uuid";
import { readSavedTripsSnapshot } from "@/lib/saved-list-snapshot";

const tripDetailMemoryCache = new Map<string, StoredItinerary>();

/** RLS／權限拒絕（被移除的成員再次讀寫行程） */
function isTripAccessDeniedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /permission denied|row-level security|42501/i.test(msg);
}

/** iPhone Duo 雙欄：地圖常駐右欄，切換列只剩「行程｜總覽」 */
const TWO_PANE_VIEWS: readonly WorkspaceView[] = ["trip", "overview"];

type Props = {
  tripId: string;
  /** 導航來源（HomeTripCard / SavedTripCard / …） */
  navSource: string;
  /** 回到行程時預選第幾天（1-based） */
  initialDay?: number;
  /** Trip Workspace 分頁（來自 URL ?view=；未提供＝行程） */
  initialView?: WorkspaceView;
  onDeleted?: () => void;
};

/**
 * 唯一正式行程詳情頁：載入 StoredItinerary 並使用可編輯行程編輯器。
 */
export function TripDetailScreen({ tripId, navSource, initialDay, initialView, onDeleted }: Props) {
  const { locale, t: uiT } = useI18n();

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const router = useRouter();
  const cachedTrip = tripDetailMemoryCache.get(tripId) ?? null;
  const [stored, setStored] = useState<StoredItinerary | null>(cachedTrip);
  const [loading, setLoading] = useState(!cachedTrip);
  const [error, setError] = useState<string | null>(null);
  // 已判定被移除、等待導回行程列表：維持載入畫面，不閃出「找不到」空狀態
  const [removed, setRemoved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // null＝權限尚未查回（未知）：不顯示擁有者限定操作（邀請成員）
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  // 切換 tripId：在 render 階段同步重設（不等 effect），避免任何一幀渲染前一個行程的內容
  const [stateTripId, setStateTripId] = useState(tripId);
  if (stateTripId !== tripId) {
    setStateTripId(tripId);
    setStored(cachedTrip);
    setLoading(!cachedTrip);
    setError(null);
    setRemoved(false);
    setIsOwner(null);
  }
  const ignoreRealtimeUntilRef = useRef(0);

  // ── Trip Workspace（行程｜總覽｜地圖） ──────────────────────────────
  // 只有從地圖分頁「查看詳情」直接返回時（見 trip-map-return），還原地圖分頁與其模式／選取。
  const [mapReturn] = useState(() => readTripMapReturnState(tripId, initialView, initialDay));
  const [view, setView] = useState<WorkspaceView>(mapReturn ? "map" : (initialView ?? "trip"));
  const viewRef = useRef(view);
  viewRef.current = view;
  // iPhone Duo：只有右側直欄（right-rail）裝置才啟用雙欄；其他裝置 rightRail／twoPane 恆為 false，
  // displayView === view，輸出與修改前相同。雙欄時地圖常駐右欄，?view=map 視同行程（view 原值保留，
  // 合起來回到單欄時仍回到地圖分頁）。
  const duoLayout = useDuoLayout();
  const rightRail = duoLayout.navPlacement === "right-rail";
  const duoPane =
    rightRail && duoLayout.tripLayout === "two-pane" ? (duoLayout.pane ?? null) : null;
  const twoPane = duoPane != null;
  // iPhone Duo 上下版型（筆電半開／直向攤平）：與一般 iPhone 相同的一頁式（行程｜總覽｜地圖三分頁、
  // 地圖在分頁內）；只在 html.duo-laptop／duo-flat-portrait 時由 styles.css 讓封面延伸到螢幕頂端、
  // 返回／分享／刪除下移，並在吸頂切換列上方顯示狀態列底板（.trip-duo-status-backdrop；其他版型
  // display: none、高度 0，版面與修改前相同）。雙頁優先。
  const stackedBackdropRef = useRef<HTMLDivElement | null>(null);
  const mapDocked = twoPane;
  const displayView: WorkspaceView = mapDocked && view === "map" ? "trip" : view;
  // 地圖分頁第一次顯示時才掛載（Maps JS 只在此時載入）；之後切走只隱藏不卸載。
  const [mapMounted, setMapMounted] = useState(view === "map");
  if (view === "map" && !mapMounted) setMapMounted(true);
  // 雙欄↔單欄／上下版型切換時，單欄地圖分頁會重新掛載：若此時不在地圖分頁，先不掛載，
  // 避免在隱藏（高度 0）狀態初始化 Google 地圖而反覆重試、之後切回地圖也無法初始化。
  const [mapTwoPane, setMapTwoPane] = useState(twoPane);
  if (mapTwoPane !== twoPane) {
    setMapTwoPane(twoPane);
    if (view !== "map") setMapMounted(false);
  }
  const [mapPaneEl, setMapPaneEl] = useState<HTMLDivElement | null>(null);
  const lastInitialViewRef = useRef(initialView);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // 捲動容器也存成 state：元素替換時，捲動與滑動監聽跟著重新綁定（不停在舊元素上）
  const [scrollContainerEl, setScrollContainerEl] = useState<HTMLDivElement | null>(null);
  const setScrollContainer = useCallback((el: HTMLDivElement | null) => {
    scrollContainerRef.current = el;
    setScrollContainerEl(el);
  }, []);
  const barSentinelRef = useRef<HTMLDivElement>(null);
  const scrollTopsRef = useRef<{ tripId: string; tops: TripWorkspaceScrollTops }>({
    tripId,
    tops: readTripWorkspaceScrollTops(tripId),
  });
  if (scrollTopsRef.current.tripId !== tripId) {
    scrollTopsRef.current = { tripId, tops: readTripWorkspaceScrollTops(tripId) };
  }
  const pendingScrollRestoreRef = useRef<WorkspaceView | null>(null);
  const [members, setMembers] = useState<TripMemberRow[] | null>(null);
  // 切換 tripId：旅伴也在 render 階段同步清空，避免新行程短暫顯示前一個行程的旅伴
  const membersRequestedForRef = useRef<string | null>(null);
  // 成員查詢失敗（members 會被設成 []，不能當成「只有自己」）；刪除視窗據此視為有其他成員
  const [membersFailed, setMembersFailed] = useState(false);
  // 刪除視窗開啟後成員 5 秒仍未查回：視為有其他成員並開放刪除（每次開啟視窗重設）
  const [deleteMembersTimedOut, setDeleteMembersTimedOut] = useState(false);
  const [membersTripId, setMembersTripId] = useState(tripId);
  if (membersTripId !== tripId) {
    setMembersTripId(tripId);
    setMembers(null);
    setMembersFailed(false);
    setDeleteMembersTimedOut(false);
    // 清空後需允許旅伴 effect 重新查詢（否則經非總覽分頁切回原行程時不再載入）
    membersRequestedForRef.current = null;
  }

  // URL（返回／外部導覽）改變 view 時同步（只回應 initialView 的變化；掛載時 view 已由其初始化）
  useEffect(() => {
    if (lastInitialViewRef.current === initialView) return;
    lastInitialViewRef.current = initialView;
    const next = initialView ?? "trip";
    if (next === viewRef.current) return;
    const el = scrollContainerRef.current;
    if (el) scrollTopsRef.current.tops[viewRef.current] = el.scrollTop;
    pendingScrollRestoreRef.current = next;
    setView(next);
  }, [initialView]);

  const changeView = useCallback(
    (next: WorkspaceView) => {
      const current = viewRef.current;
      if (next === current) return;
      const el = scrollContainerRef.current;
      if (el) scrollTopsRef.current.tops[current] = el.scrollTop;
      saveTripWorkspaceScrollTops(tripId, scrollTopsRef.current.tops);
      pendingScrollRestoreRef.current = next;
      viewRef.current = next;
      setView(next);
      void navigate({
        to: "/saved/$tripId",
        params: { tripId },
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          view: next === "trip" ? undefined : next,
        }),
        replace: true,
      });
    },
    [navigate, tripId],
  );

  // 地圖返回狀態每次掛載都清除（不論是否套用）；套用時 URL 同步為 ?view=map（保留 ?day=）
  useEffect(() => {
    clearTripMapReturnState();
    if (!mapReturn || initialView === "map") return;
    void navigate({
      to: "/saved/$tripId",
      params: { tripId },
      search: (prev: Record<string, unknown>) => ({ ...prev, view: "map" }),
      replace: true,
    });
    // 僅掛載時執行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切換後還原該分頁捲動位置；首次進入的分頁則讓 bar 停在原位或吸頂處
  useLayoutEffect(() => {
    if (pendingScrollRestoreRef.current !== view) return;
    pendingScrollRestoreRef.current = null;
    const el = scrollContainerRef.current;
    if (!el) return;
    const saved = scrollTopsRef.current.tops[view];
    if (saved != null) {
      el.scrollTop = saved;
      return;
    }
    const sentinel = barSentinelRef.current;
    if (!sentinel) return;
    const barTop =
      sentinel.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    // Duo 上下版型：切換列吸頂於狀態列底板下方（底板高度＝吸頂偏移）；其他裝置底板不存在，偏移為 0。
    const stickyOffset = stackedBackdropRef.current?.offsetHeight ?? 0;
    el.scrollTop = Math.min(el.scrollTop, Math.max(0, barTop - stickyOffset));
  }, [view]);

  // 記憶體持續記錄目前分頁捲動位置；卸載時寫入 sessionStorage
  const hasStored = stored != null;
  useEffect(() => {
    const el = scrollContainerEl;
    if (!hasStored || !el) return;
    const onScroll = () => {
      scrollTopsRef.current.tops[viewRef.current] = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      saveTripWorkspaceScrollTops(scrollTopsRef.current.tripId, scrollTopsRef.current.tops);
    };
  }, [hasStored, scrollContainerEl]);

  // 從共同記帳頁／我的行李頁返回總覽：還原總覽分頁捲動位置（標記由子頁離開時留下，帶 tripId 與時間戳；使用一次即清除）
  const expensesReturnRef = useRef<boolean | null>(null);
  if (expensesReturnRef.current === null) {
    expensesReturnRef.current = readTripOverviewSubpageReturn(tripId);
  }
  useLayoutEffect(() => {
    if (!expensesReturnRef.current || !hasStored) return;
    const el = scrollContainerEl;
    if (!el) return;
    expensesReturnRef.current = false;
    clearTripOverviewSubpageReturn();
    if (viewRef.current !== "overview") return;
    const saved = scrollTopsRef.current.tops.overview;
    if (saved != null) el.scrollTop = saved;
  }, [hasStored, scrollContainerEl]);

  // 旅伴：第一次顯示總覽時呼叫 listTripMembers 一次（每個 tripId；ref 守門，與 stored 更新無關）
  useEffect(() => {
    if (view !== "overview" || !hasStored) return;
    if (membersRequestedForRef.current === tripId) return;
    membersRequestedForRef.current = tripId;
    setMembers(null);
    listTripMembers(tripId)
      .then((rows) => {
        if (membersRequestedForRef.current === tripId) setMembers(rows);
      })
      .catch((e) => {
        console.warn("[TRIP_WORKSPACE] listTripMembers failed", e);
        if (membersRequestedForRef.current === tripId) {
          setMembers([]);
          setMembersFailed(true);
        }
      });
  }, [view, hasStored, tripId]);

  // 雙欄時左右滑動只在「行程｜總覽」間切換：把兩個分頁對應到三分頁序列的兩端（trip↔map），
  // 讓 hook 的邊界阻尼與換頁判斷照舊，任何換頁都翻到另一個分頁。單欄時照原樣傳入。
  const swipeView: WorkspaceView = mapDocked ? (displayView === "overview" ? "map" : "trip") : view;
  useWorkspaceSwipe({
    container: scrollContainerEl,
    view: swipeView,
    onChange: mapDocked ? () => changeView(swipeView === "trip" ? "overview" : "trip") : changeView,
    enabled: hasStored && !shareOpen && !deleteOpen,
  });

  useEffect(() => {
    console.info("[TRIP_DETAIL] mounted tripId=", tripId);
    console.info("[TRIP_DETAIL] route name=", pathname);
    console.info("[TRIP_DETAIL] using component=", TRIP_DETAIL_COMPONENT);
    console.info("[TRIP_DETAIL] navSource=", navSource);
    if (initialDay != null) {
      console.info(`[TRIP_DETAIL_RESTORE_DAY] dayIndex=${initialDay - 1}`);
    }
  }, [tripId, pathname, navSource, initialDay]);

  useEffect(() => {
    if (!isValidUuid(tripId)) {
      console.warn("[TRIP_DETAIL] invalid tripId, navigating back", tripId);
      navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
      return;
    }
    let cancelled = false;
    const hadCachedTrip = tripDetailMemoryCache.has(tripId);
    if (!hadCachedTrip) {
      setLoading(true);
    }
    setError(null);
    setRemoved(false);
    setIsOwner(null);
    // 冷啟動（無記憶體快取）：本機行程列表快照記錄此行程為「共享給我」（非擁有）→ 曾是成員。
    // 讀不到行程且已非成員時視同被移除；自己擁有的行程讀不到（已刪除）仍顯示 not-found 錯誤（productionUi.pb93438d9d6）。
    const wasSharedMember =
      !hadCachedTrip && readSavedTripsSnapshot().some((t) => t.id === tripId && !t.isOwner);
    // 被移除的成員：曾讀到此行程（記憶體快取／列表快照）但這次讀取被權限擋下 → 清快取、提示並回行程列表
    const leaveRemovedTrip = () => {
      tripDetailMemoryCache.delete(tripId);
      setRemoved(true);
      toast.error(getTripWorkspaceCopy().removedFromTrip);
      navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
    };
    Promise.all([getItinerary(tripId), getTripAccess(tripId)])
      .then(([row, access]) => {
        if (cancelled) return;
        if (!row && (hadCachedTrip || wasSharedMember) && !access.isMember) {
          leaveRemovedTrip();
          return;
        }
        if (!row) {
          // Same device-locale source as getTripWorkspaceCopy() above; keeps this effect's deps unchanged.
          setError(translate(effectiveAppLocale(), "productionUi.pb93438d9d6"));
          setStored(null);
          tripDetailMemoryCache.delete(tripId);
          return;
        }
        console.info("[TRIP_DETAIL] StoredItinerary loaded tripId=", row.id);
        const current = applyTripCover(row);
        tripDetailMemoryCache.set(tripId, current);
        setStored(current);
        setIsOwner(access.isOwner);
      })
      .catch((e) => {
        if (cancelled) return;
        // 權限拒絕錯誤本身即可判定（有無快取皆同）
        if (isTripAccessDeniedError(e)) {
          leaveRemovedTrip();
          return;
        }
        setError(e instanceof Error ? e.message : translate(effectiveAppLocale(), "saved.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, navigate]);

  useEffect(() => {
    const apply = () => setStored((current) => {
      if (!current || current.id !== tripId) return current;
      const next = applyTripCover(current);
      tripDetailMemoryCache.set(tripId, next);
      return next;
    });
    const onChanged = (event: Event) => {
      if (readTripCoverEvent(event)?.tripId === tripId) apply();
    };
    window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, onChanged);
    apply(); // Replay an update that completed before this listener mounted.
    return () => window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, onChanged);
  }, [tripId]);

  const handleStoredChange = (next: StoredItinerary) => {
    ignoreRealtimeUntilRef.current = Date.now() + 2500;
    tripDetailMemoryCache.set(tripId, next);
    setStored(next);
  };

  useTripRealtimeSync({
    tripId,
    enabled: Boolean(stored),
    onRemoteUpdate: (remote) => {
      const current = applyTripCover(remote);
      tripDetailMemoryCache.set(tripId, current);
      setStored(current);
    },
    isLocalWrite: () => Date.now() < ignoreRealtimeUntilRef.current,
  });

  const handleDelete = async () => {
    if (!stored || !isOwner) return;
    setDeleting(true);
    try {
      await deleteTrip(stored.id);
      toast.success(uiT("productionUi.p22dd07b022"));
      setDeleteOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : uiT("productionUi.p4ce9d7c1e4"));
    } finally {
      setDeleting(false);
    }
  };

  // 刪除確認視窗需知道是否有其他成員：旅伴已載入（總覽）就沿用；尚未查詢過才補查一次，結果與總覽共用（ref 守門不重複查）
  const openDeleteDialog = () => {
    setDeleteMembersTimedOut(false);
    setDeleteOpen(true);
    if (membersRequestedForRef.current === tripId) return;
    membersRequestedForRef.current = tripId;
    listTripMembers(tripId)
      .then((rows) => {
        if (membersRequestedForRef.current === tripId) setMembers(rows);
      })
      .catch((e) => {
        console.warn("[TRIP_WORKSPACE] listTripMembers failed", e);
        if (membersRequestedForRef.current === tripId) {
          setMembers([]);
          setMembersFailed(true);
        }
      });
  };
  // 視窗開著且成員未查回：5 秒後視為有其他成員；關閉視窗、成員查回或卸載時清除計時器
  const membersPending = members === null;
  useEffect(() => {
    if (!deleteOpen || !membersPending) return;
    const timer = window.setTimeout(() => setDeleteMembersTimedOut(true), 5000);
    return () => window.clearTimeout(timer);
  }, [deleteOpen, membersPending, tripId]);
  // 逾時後即固定為「有其他成員」直到視窗關閉：晚到的結果不會讓已顯示的提醒消失
  const hasOtherMembers =
    membersFailed ||
    deleteMembersTimedOut ||
    (members ?? []).some((m) => !m.is_owner && m.status === "accepted");
  const deleteConfirmDisabled = deleteOpen && membersPending && !deleteMembersTimedOut;

  if (loading || removed) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !stored) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center">
        <p className="text-sm text-muted-foreground">{error ?? uiT("productionUi.p3b14a9fe8c")}</p>
      </div>
    );
  }

  const tripTitle = resolveCoreTripTitle(toCoreTrip(stored, { isOwner: isOwner ?? undefined }));
  const workspaceCopy = getTripWorkspaceCopy(locale);
  // 目的地座標只讀已存資料（不查詢）
  const destinationLocation = (stored.payload as RoamiePayloadV2).destinationLocation;
  const mapDestination =
    destinationLocation && isLocatedCoordinate(destinationLocation.lat, destinationLocation.lng)
      ? { lat: destinationLocation.lat, lng: destinationLocation.lng }
      : null;

  const headerActions = (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setShareOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur"
        aria-label={uiT("productionUi.pd50e0839b9")}
      >
        <Share2 className="h-4 w-4" />
      </button>
      {isOwner ? (
        <button
          type="button"
          onClick={openDeleteDialog}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur"
          aria-label={uiT("productionUi.p045efb886f")}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  const renderMap = (ctx: TripWorkspaceRenderContext, active: boolean, inPane: boolean) => (
    <TripWorkspaceMap
      dayGroups={ctx.dayGroups}
      active={active}
      copy={workspaceCopy}
      destination={mapDestination}
      initialState={mapReturn}
      layout={inPane ? "pane" : undefined}
      onOpenDetail={(item, state, dayIndex) => {
        saveTripMapReturnState({ tripId, ...state, day: dayIndex + 1 }, (listener) =>
          // onBeforeLoad：每次 load 無條件發出；onBeforeNavigate 在 session 曾 redirect 後即不再發出
          router.subscribe("onBeforeLoad", (event: RouterEvents["onBeforeLoad"]) =>
            listener(event.toLocation.pathname),
          ),
        );
        ctx.openPlaceDetail(item, dayIndex);
      }}
      onGoToDay={(dayIndex) => {
        changeView("trip");
        ctx.selectDay(dayIndex);
      }}
    />
  );

  const scrollPane = (
    <div
      ref={setScrollContainer}
      className="trip-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain no-scrollbar"
      style={
        duoPane
          ? { flex: `0 0 ${duoPane.leftWidth}px`, width: `${duoPane.leftWidth}px` }
          : undefined
      }
    >
      <SavedTripItineraryEditor
        stored={stored}
        headerRight={headerActions}
        onStoredChange={handleStoredChange}
        initialDay={initialDay}
        ignoreRealtimeUntilRef={ignoreRealtimeUntilRef}
        workspaceView={displayView}
        workspaceBar={
          <>
            {/* Duo 上下版型：狀態列底板（styles.css 的 .trip-duo-status-backdrop，吸頂於 [頂端, 狀態列下緣]；其他版型 display: none） */}
            <div ref={stackedBackdropRef} aria-hidden className="trip-duo-status-backdrop" />
            <TripWorkspaceBar
              ref={barSentinelRef}
              view={displayView}
              onChange={changeView}
              copy={workspaceCopy}
              views={mapDocked ? TWO_PANE_VIEWS : undefined}
            />
          </>
        }
        workspaceContent={(ctx) => (
          <>
            {displayView === "overview" ? (
              <div
                id={workspacePanelId("overview")}
                role="tabpanel"
                aria-labelledby={workspaceTabId("overview")}
                style={WORKSPACE_PANE_STYLE}
              >
                <TripWorkspaceOverview
                  stored={stored}
                  locale={locale}
                  copy={workspaceCopy}
                  members={members}
                  onOpenMap={() => changeView("map")}
                  onInvite={() => setShareOpen(true)}
                  isOwner={isOwner}
                  tripTitle={tripTitle}
                />
              </div>
            ) : null}
            {twoPane ? (
              // 雙欄：地圖以 portal 渲染到右欄（仍讀編輯器的即時 dayGroups，不另查資料）
              mapPaneEl ? (
                createPortal(renderMap(ctx, true, true), mapPaneEl)
              ) : null
            ) : mapMounted ? (
              <div
                id={workspacePanelId("map")}
                role="tabpanel"
                aria-labelledby={workspaceTabId("map")}
                className={view === "map" ? undefined : "hidden"}
                style={WORKSPACE_PANE_STYLE}
              >
                {renderMap(ctx, view === "map", false)}
              </div>
            ) : null}
          </>
        )}
      />
      <TripSharePanel
        open={shareOpen}
        onOpenChange={setShareOpen}
        tripId={stored.id}
        tripTitle={tripTitle}
        isOwner={isOwner}
      />
      <TripDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        confirming={deleting}
        confirmDisabled={deleteConfirmDisabled}
        {...deleteTripDialogLabels(locale, { hasOtherMembers })}
      />
    </div>
  );

  if (!rightRail) return scrollPane;

  // iPhone Duo：不另包外層。未帶 key 的頂層 Fragment 對 React 而言等同其子陣列，scrollPane
  // 固定在第 0 個位置，因此 rightRail 翻轉（單一元素 ↔ Fragment）與開合時，捲動容器與編輯器
  // 都沿用同一個 fiber，不重新掛載；非 rail 仍直接回傳 scrollPane，DOM 與修改前相同。
  // 雙欄：_app 把內容外層改為橫向（RIGHT_RAIL_TWO_PANE_TRIP_CONTENT_STYLE），
  // 左欄行程（pane.leftWidth，止於摺痕左緣）｜摺痕間隔｜右欄地圖（填滿到 --app-rail-width 內縮處）。
  return (
    <>
      {scrollPane}
      {duoPane ? (
        <div aria-hidden className="shrink-0" style={{ width: `${duoPane.gutter}px` }} />
      ) : null}
      {duoPane ? (
        <div
          ref={setMapPaneEl}
          role="region"
          aria-label={workspaceCopy.tabMap}
          data-no-page-swipe
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-y-contain no-scrollbar"
        />
      ) : null}
    </>
  );
}
