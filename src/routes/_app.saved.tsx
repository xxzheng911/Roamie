import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Loader2, Trash2, MapPin, Heart, Route as RouteIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import cafe from "@/assets/scene-cafe.jpg";
import { deleteItinerary, listItineraries, type StoredItinerary } from "@/lib/itinerary-storage";
import { isRoamiePayloadV2 } from "@/lib/ai/types";
import { deletePlace, listPlaces, type SavedPlace } from "@/lib/places-storage";
import { isMissingTableError } from "@/lib/supabase-errors";

type SavedSearch = { tab?: string };

export const Route = createFileRoute("/_app/saved")({
  validateSearch: (s: Record<string, unknown>): SavedSearch => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: Saved,
});

type Tab = "trips" | "places";

function TripsEmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <RouteIcon className="h-7 w-7 text-clay" />
      </div>
      <p className="font-display text-xl">還沒有收藏內容</p>
      <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">
        探索附近地點，或請 Roamie 幫你規劃第一趟慢旅行。
      </p>
      <Link
        to="/map"
        className="mt-1 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground"
      >
        去探索附近地點
      </Link>
      <Link to="/plan" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        或規劃第一趟旅程
      </Link>
    </div>
  );
}

function PlacesEmptyState() {
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Heart className="h-7 w-7 text-clay" />
      </div>
      <p className="font-display text-xl">還沒有收藏地點</p>
      <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">
        到探索頁找喜歡的角落，點卡片上的愛心即可加入收藏。
      </p>
      <Link
        to="/map"
        className="mt-1 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground"
      >
        去探索頁收藏
      </Link>
    </div>
  );
}

function Saved() {
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab === "places" ? "places" : "trips");
  const [trips, setTrips] = useState<StoredItinerary[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([listItineraries(), listPlaces()])
      .then(([t, p]) => {
        setTrips(t);
        setPlaces(p);
      })
      .catch((err) => {
        if (isMissingTableError(err)) {
          setTrips([]);
          setPlaces([]);
          return;
        }
        toast.error(err instanceof Error ? err.message : "讀取失敗");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (search.tab === "places") setTab("places");
  }, [search.tab]);

  const handleDeleteTrip = async (id: string, title: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`刪除「${title}」？`)) return;
    try {
      await deleteItinerary(id);
      toast.success("已刪除");
      setTrips((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const handleDeletePlace = async (id: string, name: string) => {
    if (!confirm(`移除「${name}」收藏？`)) return;
    try {
      await deletePlace(id);
      toast.success("已移除");
      setPlaces((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const hasAny = trips.length > 0 || places.length > 0;

  return (
    <div className="px-5 pb-6 pt-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl">我的收藏</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "載入中…" : `${trips.length} 個行程 · ${places.length} 個地點`}
          </p>
        </div>
        {hasAny && (
          <Link
            to="/plan"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
            aria-label="規劃新行程"
          >
            <Plus className="h-4 w-4" />
          </Link>
        )}
      </div>

      <div className="mt-4 flex gap-1 rounded-full border border-border bg-card p-1 text-sm">
        {(["trips", "places"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full py-2 transition ${
              tab === t ? "bg-foreground text-background" : "text-muted-foreground"
            }`}
          >
            {t === "trips" ? `行程 (${trips.length})` : `地點 (${places.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "trips" ? (
        trips.length === 0 ? (
          <TripsEmptyState />
        ) : (
          <ul className="mt-6 space-y-3">
            {trips.map((t) => (
              <li key={t.id}>
                <Link
                  to="/trip"
                  search={{ id: t.id }}
                  className="flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft transition active:scale-[0.99]"
                >
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl">
                    <img src={t.cover_image || cafe} alt={t.title} className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium">{t.title}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {isRoamiePayloadV2(t.payload)
                        ? `${t.payload.recommendations?.length ?? 0} 個推薦`
                        : `${(t.payload as { destination?: string }).destination ?? ""} · ${(t.payload as { days?: number }).days ?? "?"} 天`}
                      {t.mood ? ` · ${t.mood}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteTrip(t.id, t.title, e)}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                    aria-label="刪除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : places.length === 0 ? (
        <PlacesEmptyState />
      ) : (
        <ul className="mt-6 space-y-3">
          {places.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-secondary">
                {p.cover_image ? (
                  <img src={p.cover_image} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <MapPin className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{p.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[p.category, p.city, p.address].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDeletePlace(p.id, p.name)}
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                aria-label="移除"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
