import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SavedTripDetailView } from "@/components/saved/SavedTripDetailView";
import { deleteItinerary, getItinerary } from "@/lib/itinerary-storage";
import { normalizeStoredTrip, type SavedTripView } from "@/lib/saved-trip/normalize";

export const Route = createFileRoute("/_app/saved/$tripId")({
  component: SavedTripDetailPage,
});

function SavedTripDetailPage() {
  const { tripId } = Route.useParams();
  const navigate = Route.useNavigate();
  const [trip, setTrip] = useState<SavedTripView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getItinerary(tripId)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setError("找不到這個行程");
          setTrip(null);
          return;
        }
        setTrip(normalizeStoredTrip(row));
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
    if (!confirm(`確定要刪除「${trip.title}」嗎？`)) return;
    try {
      await deleteItinerary(trip.id);
      toast.success("已刪除");
      navigate({ to: "/saved", search: { tab: "trips" } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "刪除失敗");
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
        <Link to="/saved" search={{ tab: "trips" }} className="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground">
          返回收藏
        </Link>
      </div>
    );
  }

  return (
    <SavedTripDetailView
      trip={trip}
      headerRight={
        <button
          type="button"
          onClick={() => void handleDelete()}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          aria-label="刪除行程"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      }
    />
  );
}
