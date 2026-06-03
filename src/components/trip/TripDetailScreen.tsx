import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SavedTripItineraryEditor } from "@/components/saved/SavedTripItineraryEditor";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { getItinerary, type StoredItinerary } from "@/lib/itinerary-storage";
import { seedCoreTripPersistedFingerprint } from "@/lib/trip/core-trip-update-guard";
import { tripPayloadFingerprint } from "@/lib/trip/trip-payload-persist";
import {
  logTripDetailMount,
  logTripDetailReloadSkipped,
  resetTripDetailSkipLogs,
} from "@/lib/trip/trip-detail-log";

import type { TripDetailFromSource } from "@/lib/trip/trip-detail-back";

type Props = {
  tripId: string;
  /** 導航來源（HomeTripCard / SavedTripCard / …） */
  navSource: string;
  /** URL search 來源，決定返回目的地 */
  fromSource?: TripDetailFromSource;
  onDeleted?: () => void;
};

/**
 * 正式行程詳情：載入 saved_trips 後以 SavedTripItineraryEditor 手動編輯。
 */
export function TripDetailScreen({ tripId, navSource, fromSource = "saved", onDeleted }: Props) {
  const [stored, setStored] = useState<StoredItinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mountLoggedRef = useRef<string | null>(null);
  const loadStartedRef = useRef<string | null>(null);

  useEffect(() => {
    if (mountLoggedRef.current === tripId) return;
    mountLoggedRef.current = tripId;
    resetTripDetailSkipLogs(tripId);
    logTripDetailMount(tripId);
  }, [tripId]);

  useEffect(() => {
    let cancelled = false;

    if (loadStartedRef.current === tripId && stored?.id === tripId) {
      logTripDetailReloadSkipped(tripId, "already_loaded");
      return;
    }

    loadStartedRef.current = tripId;
    if (!stored || stored.id !== tripId) {
      setLoading(true);
      setError(null);
    }

    getItinerary(tripId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("找不到這個行程");
          setStored(null);
          return;
        }
        if (!isRoamiePayloadV2(row.payload)) {
          setError("此行程格式較舊，請從收藏列表重新建立");
          setStored(null);
          return;
        }
        console.info("[TRIP_DETAIL] StoredItinerary loaded tripId=", row.id);
        seedCoreTripPersistedFingerprint(row.id, row.payload, row.mood);
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

  const handleStoredChange = useCallback((row: StoredItinerary) => {
    setStored((prev) => {
      if (!prev || prev.id !== row.id) return row;

      const prevStart = isRoamiePayloadV2(prev.payload)
        ? prev.payload.tripSettings?.tripStartDate ?? ""
        : "";
      const nextStart = isRoamiePayloadV2(row.payload)
        ? row.payload.tripSettings?.tripStartDate ?? ""
        : "";
      const prevDayDates = isRoamiePayloadV2(prev.payload)
        ? (prev.payload.tripSettings?.tripDayDates ?? []).join(",")
        : "";
      const nextDayDates = isRoamiePayloadV2(row.payload)
        ? (row.payload.tripSettings?.tripDayDates ?? []).join(",")
        : "";
      const datesChanged = prevStart !== nextStart || prevDayDates !== nextDayDates;

      const prevFp = tripPayloadFingerprint(prev.payload, prev.mood);
      const nextFp = tripPayloadFingerprint(row.payload, row.mood);
      if (prevFp === nextFp && !datesChanged) {
        logTripDetailReloadSkipped(row.id, "same_fingerprint");
        return prev;
      }
      if (isRoamiePayloadV2(row.payload)) {
        seedCoreTripPersistedFingerprint(row.id, row.payload, row.mood);
      }
      return row;
    });
  }, []);

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

  if (loading && !stored) {
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
        <Link
          to="/saved"
          search={{ tab: "trips" }}
          className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
        >
          返回收藏
        </Link>
      </div>
    );
  }

  const deleteButton = (
    <button
      type="button"
      onClick={() => setDeleteOpen(true)}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      aria-label="刪除行程"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SavedTripItineraryEditor
        key={stored.id}
        stored={stored}
        navSource={navSource}
        fromSource={fromSource}
        headerRight={deleteButton}
        onStoredChange={handleStoredChange}
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
