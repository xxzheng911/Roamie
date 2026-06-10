import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SavedTripItineraryEditor } from "@/components/saved/SavedTripItineraryEditor";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { getItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { TRIP_DETAIL_COMPONENT } from "@/lib/trip/trip-detail-nav";

type Props = {
  tripId: string;
  /** 導航來源（HomeTripCard / SavedTripCard / …） */
  navSource: string;
  onDeleted?: () => void;
};

/**
 * 唯一正式行程詳情頁：載入 StoredItinerary 並使用可編輯行程編輯器。
 */
export function TripDetailScreen({ tripId, navSource, onDeleted }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [stored, setStored] = useState<StoredItinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    console.info("[TRIP_DETAIL] mounted tripId=", tripId);
    console.info("[TRIP_DETAIL] route name=", pathname);
    console.info("[TRIP_DETAIL] using component=", TRIP_DETAIL_COMPONENT);
    console.info("[TRIP_DETAIL] navSource=", navSource);
  }, [tripId, pathname, navSource]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getItinerary(tripId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("找不到這個行程");
          setStored(null);
          return;
        }
        console.info("[TRIP_DETAIL] StoredItinerary loaded tripId=", row.id);
        setStored(row);
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
  }, [tripId]);

  const handleDelete = async () => {
    if (!stored) return;
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

  const deleteButton = (
    <button
      type="button"
      onClick={() => setDeleteOpen(true)}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur"
      aria-label="刪除行程"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );

  return (
    <>
      <SavedTripItineraryEditor
        stored={stored}
        headerRight={deleteButton}
        onStoredChange={setStored}
      />
      <TripDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        confirming={deleting}
      />
    </>
  );
}
