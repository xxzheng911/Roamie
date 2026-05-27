import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Clock, Loader2, MapPin, Navigation, RouteIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { TRIP_DETAIL_COMPONENT } from "@/lib/trip/trip-detail-nav";
import { getCoreTripById, resolveCoreTripTitle, type CoreTrip } from "@/lib/trip/core-trip";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";

type Props = {
  tripId: string;
  /** 導航來源（HomeTripCard / SavedTripCard / …） */
  navSource: string;
  onDeleted?: () => void;
};

/**
 * 唯一正式行程詳情頁：僅接受 tripId，進入後以 getItinerary(tripId) 載入。
 */
export function TripDetailScreen({ tripId, navSource, onDeleted }: Props) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [trip, setTrip] = useState<CoreTrip | null>(null);
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
    getCoreTripById(tripId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("找不到這個行程");
          setTrip(null);
          return;
        }
        console.info("[TRIP_DETAIL] CoreTrip loaded tripId=", row.id);
        setTrip(row);
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
    if (!trip) return;
    setDeleting(true);
    try {
      await deleteTrip(trip.id);
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

  if (error || !trip) {
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
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border bg-background/95 px-5 pb-4 pt-3 backdrop-blur">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/saved"
              search={{ tab: "trips" }}
              className="rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground"
            >
              返回
            </Link>
            {deleteButton}
          </div>
          <h1 className="mt-3 font-display text-[22px] leading-snug">{resolveCoreTripTitle(trip)}</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {trip.days} 天 · {trip.destinationPlace?.name ?? "未設定目的地"}
          </p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-3">
            {trip.places.map((place, index) => (
              <article key={`${place.placeId || place.name}-${index}`} className="rounded-2xl border border-border bg-card p-4">
                <h3 className="text-sm font-medium">{place.name}</h3>
                <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                  <MapPin className="mt-0.5 h-3 w-3" />
                  {place.address || "尚未設定"}
                </p>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p className="flex items-center gap-1"><Clock className="h-3 w-3" />抵達時間：{place.arrivalTime || "尚未設定"}</p>
                  <p>停留時間：{place.duration}</p>
                  <p className="flex items-center gap-1"><RouteIcon className="h-3 w-3" />交通方式：{place.transportMode || "尚未設定"}</p>
                  <p>點到點耗時：{place.pointToPointDuration}</p>
                </div>
                <PlaceNavButtons
                  lat={place.lat}
                  lng={place.lng}
                  address={place.address || undefined}
                  placeName={place.name}
                  compact
                  className="mt-3"
                />
              </article>
            ))}
          </div>
          {trip.places.length === 0 ? (
            <p className="mt-8 text-center text-sm text-muted-foreground">此行程尚未包含地點</p>
          ) : null}
        </div>
      </div>
      <TripDeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={handleDelete}
        confirming={deleting}
      />
    </>
  );
}
