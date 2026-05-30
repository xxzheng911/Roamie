import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Share2, Trash2, MapPin, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { MobileFrame } from "@/components/MobileFrame";
import { BackButton } from "@/components/BackButton";
import { TripPlanEditor } from "@/components/TripPlanEditor";
import { useIosInteractiveRoute } from "@/hooks/use-ios-interactive-route";
import { requireAuthenticatedRoute } from "@/lib/require-auth";
import {
  confirmSaveTrip,
  getItinerary,
  updateItinerary,
  type StoredItinerary,
} from "@/lib/itinerary-storage";
import { clearDraftTrip, loadDraftTrip } from "@/lib/trip-draft-storage";
import type { Itinerary } from "@/lib/itinerary.functions";
import { generateItinerary } from "@/lib/itinerary.functions";
import {
  isRoamiePayloadV2,
  type RoamieItineraryItem,
  type RoamiePayloadV2,
  type TripPlanSettings,
} from "@/lib/ai/types";
import { buildClientContextBundle } from "@/lib/fetch-context";
import { getWeather } from "@/lib/weather.functions";
import { getPreferences } from "@/lib/preferences-storage";
import { getUserProfile } from "@/lib/profile-storage";
import { resolveFashionStyle } from "@/lib/outfit/resolve-style";
import { budgetModeToItineraryTier } from "@/lib/ai/context";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import { logTripNav, TRIP_DETAIL_ROUTE, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";

type TripSearch = { id?: string; draft?: string };

export const Route = createFileRoute("/trip")({
  validateSearch: (s: Record<string, unknown>): TripSearch => ({
    id: typeof s.id === "string" ? s.id : undefined,
    draft: typeof s.draft === "string" ? s.draft : undefined,
  }),
  beforeLoad: async ({ search }) => {
    await requireAuthenticatedRoute();
    if (typeof window === "undefined") return;
    if (search.id && search.draft !== "1") {
      logTripNav("trip-route-legacy-redirect", search.id);
      throw redirect({ to: TRIP_DETAIL_ROUTE, params: { tripId: search.id } });
    }
  },
  component: Trip,
});

const TRANSPORT_HINT: Record<string, string> = {
  walk: "步行",
  scooter: "機車",
  drive: "開車",
  transit: "大眾運輸",
};

function TripScreenShell({
  headerRight,
  children,
  onScroll,
}: {
  headerRight?: ReactNode;
  children: ReactNode;
  onScroll?: () => void;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="z-20 flex shrink-0 items-center justify-between border-b border-border bg-background/95 px-5 pb-3 pt-[var(--safe-area-top)] backdrop-blur">
        <BackButton
          fallback={{ to: "/saved" }}
          onBack={() => console.info("[Trip Plan Back Pressed]")}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
        />
        {headerRight ? <div className="flex gap-2">{headerRight}</div> : <span className="w-9" />}
      </header>
      <main
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain no-scrollbar"
        onScroll={onScroll}
      >
        {children}
      </main>
    </div>
  );
}

function Trip() {
  const { id, draft } = Route.useSearch();
  const navigate = useNavigate();
  const generate = useServerFn(generateItinerary);
  const fetchWeather = useServerFn(getWeather);
  const [trip, setTrip] = useState<StoredItinerary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrollLoggedRef = useRef(false);
  const isDraft = draft === "1";

  useIosInteractiveRoute("trip-plan");

  useEffect(() => {
    console.info("[Trip Plan Screen Mounted]", { id, isDraft });
  }, [id, isDraft]);

  useEffect(() => {
    if (!loading) {
      console.info("[Trip Plan Loading End]", { hasTrip: Boolean(trip), loadError });
    }
  }, [loading, trip, loadError]);

  const handleScroll = useCallback(() => {
    if (scrollLoggedRef.current) return;
    scrollLoggedRef.current = true;
    console.info("[Trip Plan Scroll Enabled]");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    if (isDraft) {
      console.info("[Trip Plan Data Loading]", { source: "draft" });
      const payload = loadDraftTrip();
      if (payload) {
        setTrip({
          id: "draft",
          title: payload.title,
          mood: payload.moodTag ?? null,
          cover_image: null,
          cover_image_url: null,
          cover_source: null,
          cover_query: null,
          created_at: payload.generatedAt ?? new Date().toISOString(),
          updated_at: payload.generatedAt ?? new Date().toISOString(),
          payload,
        });
        console.info("[Trip Plan Data Loaded]", { source: "draft", title: payload.title });
      } else {
        console.info("[Trip Plan Data Error]", { source: "draft", reason: "empty_draft" });
        setLoadError("找不到行程草稿");
      }
      setLoading(false);
      return;
    }

    console.info("[Trip Plan Data Error]", { reason: "draft_only_route" });
    setLoadError("請從首頁或收藏開啟已儲存的行程");
    setLoading(false);
    return () => {
      cancelled = true;
    };
  }, [isDraft]);

  const handleSaveDraft = async () => {
    if (!trip || !isDraft) return;
    try {
      const saved = await confirmSaveTrip(trip.payload as RoamiePayloadV2, "chat");
      clearDraftTrip();
      toast.success("已儲存到收藏");
      logTripNav("trip-draft-saved", saved.id);
      navigate(tripDetailNavigateOptions(saved.id, { back: "saved", replace: true }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "儲存失敗");
    }
  };

  const handleDelete = async () => {
    if (!trip || isDraft) return;
    setDeleting(true);
    try {
      await deleteTrip(trip.id);
      toast.success("已刪除");
      setDeleteOpen(false);
      navigate({ to: "/saved", search: { tab: "trips" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setDeleting(false);
    }
  };

  const handleShare = async () => {
    if (!trip) return;
    const url = window.location.href;
    const summary = isRoamiePayloadV2(trip.payload)
      ? trip.payload.summary
      : (trip.payload as Itinerary).summary;
    const text = `${trip.title}\n${summary}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.title, text, url });
        return;
      } catch {
        /* cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast.success("已複製分享連結");
    } catch {
      toast.error("分享失敗");
    }
  };

  const handleSavePayload = async (next: RoamiePayloadV2) => {
    if (!trip) return;
    const updated = await updateItinerary(trip.id, { ...next, recommendations: [], version: 2 });
    if (updated) {
      setTrip(updated);
      toast.success("已儲存調整");
    }
  };

  const handleReplan = async (settings: TripPlanSettings, items: RoamieItineraryItem[]) => {
    if (!trip || !isRoamiePayloadV2(trip.payload)) return;
    const payload = trip.payload;
    try {
      const [bundle, prefs, profile] = await Promise.all([
        buildClientContextBundle(fetchWeather),
        getPreferences(),
        getUserProfile(),
      ]);
      const fashionStyle = resolveFashionStyle({
        travelStyle: profile.travelStyle,
        interests: prefs.interests,
      });
      const transport = TRANSPORT_HINT[settings.transport ?? "walk"] ?? "步行";
      const legNotes = Object.entries(settings.legMinutes ?? {})
        .map(([name, min]) => `${name}停留${min}分鐘`)
        .join("、");

      const { itinerary } = await generate({
        data: {
          destination: payload.destination ?? bundle.location.city ?? "目前位置",
          days: payload.days ?? 1,
          budget: budgetModeToItineraryTier(resolveBudgetMode(prefs)),
          mood: trip.mood ?? payload.moodTag ?? "",
          interests: [
            payload.summary,
            `出發時間 ${settings.startTime ?? "10:00"}`,
            legNotes ? `各站停留：${legNotes}` : "",
            `交通方式：${transport}`,
            "請依上述交通與停留時間，重新排列最順路的單日行程動線",
            ...items.map((i) => `${i.placeName}（${i.time}）`),
          ]
            .filter(Boolean)
            .join("\n"),
          startDate: settings.tripStartDate ?? new Date().toISOString().slice(0, 10),
          endDate:
            settings.tripEndDate ?? settings.tripStartDate ?? new Date().toISOString().slice(0, 10),
          transport,
          selectedPlaces: [],
          preferences: prefs,
          location: bundle.location,
          weather: bundle.weather,
          time: bundle.time,
          fashionStyle: fashionStyle ?? "",
        },
      });

      const nextPayload: RoamiePayloadV2 = {
        ...payload,
        ...itinerary,
        recommendations: [],
        itinerary: itinerary.itinerary,
        outfitAdvice: itinerary.outfitAdvice ?? payload.outfitAdvice,
        tripSettings: settings,
        version: 2,
      };
      const updated = await updateItinerary(trip.id, nextPayload);
      if (updated) {
        setTrip(updated);
        toast.success("路線已重新規劃");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重新規劃失敗");
    }
  };

  const headerActions =
    trip && !loading ? (
      <>
        <button
          type="button"
          onClick={() => void handleShare()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          aria-label="分享"
        >
          <Share2 className="h-4 w-4" />
        </button>
        {!isDraft && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
            aria-label="刪除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </>
    ) : null;

  if (loading) {
    return (
      <MobileFrame>
        <TripScreenShell onScroll={handleScroll}>
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">讀取行程中…</p>
          </div>
        </TripScreenShell>
      </MobileFrame>
    );
  }

  if (!trip || loadError) {
    return (
      <MobileFrame>
        <TripScreenShell onScroll={handleScroll}>
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-sm text-muted-foreground">{loadError ?? "找不到這個行程"}</p>
            <Link
              to="/plan"
              className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              規劃新行程
            </Link>
            <Link
              to="/saved"
              search={{ tab: "trips" }}
              className="text-sm text-muted-foreground underline"
            >
              查看所有行程
            </Link>
          </div>
        </TripScreenShell>
      </MobileFrame>
    );
  }

  const payload = trip.payload;
  const isV2 = isRoamiePayloadV2(payload);

  return (
    <MobileFrame>
      <TripScreenShell headerRight={headerActions} onScroll={handleScroll}>
        <div className="px-5 pb-10 pt-5">
          {isDraft && (
            <div className="mb-4 rounded-2xl border border-dashed border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
              <p>這是行程草稿，尚未加入收藏。</p>
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                className="mt-3 w-full rounded-full bg-primary py-2.5 text-sm font-medium text-primary-foreground"
              >
                儲存這趟行程
              </button>
            </div>
          )}
          <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">旅行計劃</p>
          <h1 className="mt-2 font-display text-[26px] leading-snug">{trip.title}</h1>

          {isV2 && payload.itinerary.length > 0 ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {payload.destination && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {payload.destination}
                  </span>
                )}
                {payload.days && (
                  <>
                    <span>·</span>
                    <span>{payload.days} 天</span>
                  </>
                )}
                {(trip.mood || payload.moodTag) && (
                  <>
                    <span>·</span>
                    <span>{trip.mood || payload.moodTag}</span>
                  </>
                )}
              </div>
              <div className="mt-6">
                <TripPlanEditor
                  payload={{ ...payload, recommendations: [] }}
                  onSave={handleSavePayload}
                  onReplan={handleReplan}
                />
              </div>
            </>
          ) : (
            <TripLegacy it={payload as Itinerary} />
          )}

          <div className="mt-10 flex gap-3">
            <Link
              to="/chat"
              className="flex-1 rounded-full border border-border bg-card py-3.5 text-center text-sm"
            >
              和 Roamie 調整
            </Link>
            <Link
              to="/saved"
              className="flex-1 rounded-full bg-primary py-3.5 text-center text-sm font-medium text-primary-foreground shadow-lift"
            >
              查看所有行程
            </Link>
          </div>
        </div>
      </TripScreenShell>
      <TripDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        confirming={deleting}
      />
    </MobileFrame>
  );
}

function TripLegacy({ it }: { it: Itinerary }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> {it.destination}
        </span>
        <span>·</span>
        <span>{it.days} 天</span>
      </div>
      <p className="mt-4 rounded-2xl bg-secondary p-4 text-sm leading-relaxed">{it.summary}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        此為舊版行程格式，建議重新規劃以使用完整時間軸編輯。
      </p>
    </>
  );
}
