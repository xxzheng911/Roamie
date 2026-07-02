import { useEffect, useRef, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Loader2, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SavedTripItineraryEditor } from "@/components/saved/SavedTripItineraryEditor";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { TripSharePanel } from "@/components/trip/TripSharePanel";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { getItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { getTripAccess } from "@/lib/trip/trip-collab";
import { useTripRealtimeSync } from "@/lib/trip/use-trip-realtime";
import { TRIP_DETAIL_COMPONENT } from "@/lib/trip/trip-detail-nav";
import { resolveCoreTripTitle, toCoreTrip } from "@/lib/trip/core-trip";
import { isValidUuid } from "@/lib/uuid";

type Props = {
  tripId: string;
  /** 導航來源（HomeTripCard / SavedTripCard / …） */
  navSource: string;
  /** 回到行程時預選第幾天（1-based） */
  initialDay?: number;
  onDeleted?: () => void;
};

/**
 * 唯一正式行程詳情頁：載入 StoredItinerary 並使用可編輯行程編輯器。
 */
export function TripDetailScreen({ tripId, navSource, initialDay, onDeleted }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [stored, setStored] = useState<StoredItinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isOwner, setIsOwner] = useState(true);
  const ignoreRealtimeUntilRef = useRef(0);

  useEffect(() => {
    console.info("[TRIP_DETAIL] mounted tripId=", tripId);
    console.info("[TRIP_DETAIL] route name=", pathname);
    console.info("[TRIP_DETAIL] using component=", TRIP_DETAIL_COMPONENT);
    console.info("[TRIP_DETAIL] navSource=", navSource);
  }, [tripId, pathname, navSource]);

  useEffect(() => {
    if (!isValidUuid(tripId)) {
      console.warn("[TRIP_DETAIL] invalid tripId, navigating back", tripId);
      navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getItinerary(tripId), getTripAccess(tripId)])
      .then(([row, access]) => {
        if (cancelled) return;
        if (!row) {
          setError("找不到這個行程");
          setStored(null);
          return;
        }
        console.info("[TRIP_DETAIL] StoredItinerary loaded tripId=", row.id);
        setStored(row);
        setIsOwner(access.isOwner);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "讀取失敗");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tripId, navigate]);

  const handleStoredChange = (next: StoredItinerary) => {
    ignoreRealtimeUntilRef.current = Date.now() + 2500;
    setStored(next);
  };

  useTripRealtimeSync({
    tripId,
    enabled: Boolean(stored),
    onRemoteUpdate: (remote) => {
      setStored(remote);
    },
    isLocalWrite: () => Date.now() < ignoreRealtimeUntilRef.current,
  });

  const handleDelete = async () => {
    if (!stored || !isOwner) return;
    setDeleting(true);
    try {
      await deleteTrip(stored.id);
      toast.success("已刪除");
      setDeleteOpen(false);
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !stored) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-20 text-center">
        <p className="text-sm text-muted-foreground">{error ?? "找不到行程"}</p>
      </div>
    );
  }

  const tripTitle = resolveCoreTripTitle(toCoreTrip(stored, { isOwner }));

  const headerActions = (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => setShareOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur"
        aria-label="分享行程"
      >
        <Share2 className="h-4 w-4" />
      </button>
      {isOwner ? (
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur"
          aria-label="刪除行程"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="trip-detail-route flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain no-scrollbar">
      <SavedTripItineraryEditor
        stored={stored}
        headerRight={headerActions}
        onStoredChange={handleStoredChange}
        initialDay={initialDay}
        ignoreRealtimeUntilRef={ignoreRealtimeUntilRef}
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
      />
    </div>
  );
}
