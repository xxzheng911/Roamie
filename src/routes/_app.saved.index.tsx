import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Loader2, Trash2 } from "lucide-react";
import { SavedPlaceCard } from "@/components/saved/SavedPlaceCard";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromSavedPlace } from "@/lib/trip/trip-place-input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { SavedTripCard } from "@/components/saved/SavedTripCard";
import { SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { listCoreTrips, type CoreTrip, resolveCoreTripTitle } from "@/lib/trip/core-trip";
import {
  deletePlace,
  listPlaces,
  SAVED_PLACES_CHANGED_EVENT,
  type SavedPlace,
} from "@/lib/places-storage";
import { isMissingColumnError, isMissingTableError } from "@/lib/supabase-errors";
import { openSavedPlaceDetail } from "@/lib/navigate-saved-place-detail";
import { createBlankSavedTrip } from "@/lib/trip/create-blank-trip";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";

type SavedSearch = { tab?: string };

export const Route = createFileRoute("/_app/saved/")({
  validateSearch: (s: Record<string, unknown>): SavedSearch => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: Saved,
});

type Tab = "trips" | "places";

function TripsEmptyState({ onNewTrip, creating }: { onNewTrip: () => void; creating: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <p className="font-display text-xl">{t("saved.emptyAllTitle")}</p>
      <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">
        還沒有收藏的行程，可以先建立空白行程，再自行加入想去的地點。
      </p>
      <button
        type="button"
        onClick={onNewTrip}
        disabled={creating}
        className="mt-1 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground disabled:opacity-60"
      >
        {creating ? t("common.loading") : "建立空白行程"}
      </button>
      <Link
        to="/map"
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        {t("saved.exploreCta")}
      </Link>
    </div>
  );
}

function PlacesEmptyState() {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <p className="font-display text-xl">{t("saved.emptyPlacesTitle")}</p>
      <p className="max-w-[260px] text-sm leading-relaxed text-muted-foreground">
        {t("saved.emptyPlacesDesc")}
      </p>
      <Link
        to="/map"
        className="mt-1 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground"
      >
        {t("saved.explorePlacesCta")}
      </Link>
    </div>
  );
}

function Saved() {
  const { t, locale } = useI18n();
  const tt = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const navigate = useNavigate();
  const { openAddToTrip } = useAddToTrip();
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab === "places" ? "places" : "trips");
  const [trips, setTrips] = useState<CoreTrip[]>([]);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openingPlaceId, setOpeningPlaceId] = useState<string | null>(null);
  const [creatingTrip, setCreatingTrip] = useState(false);

  const handleNewBlankTrip = async () => {
    if (creatingTrip) return;
    setCreatingTrip(true);
    try {
      const saved = await createBlankSavedTrip();
      logTripNav("saved", saved.id);
      await navigate(tripDetailNavigateOptions(saved.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saved.loadFailed"));
    } finally {
      setCreatingTrip(false);
    }
  };

  const refresh = () => {
    setLoading(true);
    Promise.allSettled([listCoreTrips(), listPlaces()])
      .then(([tripsResult, placesResult]) => {
        if (tripsResult.status === "fulfilled") {
          setTrips(tripsResult.value);
        } else if (
          isMissingTableError(tripsResult.reason) ||
          isMissingColumnError(tripsResult.reason)
        ) {
          console.warn("[SAVED_TRIPS] schema fallback empty list", tripsResult.reason);
          setTrips([]);
        } else {
          toast.error(
            tripsResult.reason instanceof Error ? tripsResult.reason.message : t("saved.loadFailed"),
          );
        }

        if (placesResult.status === "fulfilled") {
          setPlaces(placesResult.value);
        } else if (isMissingTableError(placesResult.reason)) {
          setPlaces([]);
        } else {
          toast.error(
            placesResult.reason instanceof Error
              ? placesResult.reason.message
              : t("saved.loadFailed"),
          );
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const onRefresh = () => refresh();
    window.addEventListener(SAVED_PLACES_CHANGED_EVENT, onRefresh);
    window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(SAVED_PLACES_CHANGED_EVENT, onRefresh);
      window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    };
  }, []);

  useEffect(() => {
    if (search.tab === "places") setTab("places");
  }, [search.tab]);

  const handleConfirmDeleteTrip = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTrip(deleteTarget.id);
      toast.success(t("saved.deleted"));
      setTrips((prev) => prev.filter((trip) => trip.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saved.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleDeletePlace = async (id: string, name: string) => {
    if (!confirm(tt("saved.removePlaceConfirm", { name }))) return;
    const prev = places;
    setPlaces((list) => list.filter((p) => p.id !== id));
    try {
      await deletePlace(id);
      toast.success(t("saved.removed"));
    } catch (err) {
      setPlaces(prev);
      toast.error(err instanceof Error ? err.message : t("saved.deleteFailed"));
    }
  };

  const handleOpenPlace = (p: SavedPlace) => {
    if (openingPlaceId) return;
    setOpeningPlaceId(p.id);
    void openSavedPlaceDetail(p, locale, async (opts) => {
      await navigate(opts);
    }).then((ok) => {
      if (!ok) {
        toast.error(t("map.noCoordsDetail"));
      }
    }).finally(() => {
      window.setTimeout(() => setOpeningPlaceId(null), 400);
    });
  };

  const hasAny = trips.length > 0 || places.length > 0;

  return (
    <div className="px-5 pb-6 pt-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl">{t("saved.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? t("common.loading")
              : tt("saved.summary", { trips: trips.length, places: places.length })}
          </p>
        </div>
        {hasAny && (
          <button
            type="button"
            onClick={() => void handleNewBlankTrip()}
            disabled={creatingTrip}
            className="flex h-10 w-10 touch-manipulation items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-60 active:scale-95"
            aria-label={t("saved.planNewAria")}
          >
            {creatingTrip ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <div className="mt-4 flex gap-1 rounded-full border border-border bg-card p-1 text-sm">
        {(["trips", "places"] as const).map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            onClick={() => setTab(tabKey)}
            className={`flex-1 rounded-full py-2 transition ${
              tab === tabKey ? "bg-foreground text-background" : "text-muted-foreground"
            }`}
          >
            {tabKey === "trips"
              ? tt("saved.tabTrips", { count: trips.length })
              : tt("saved.tabPlaces", { count: places.length })}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "trips" ? (
        trips.length === 0 ? (
          <TripsEmptyState onNewTrip={() => void handleNewBlankTrip()} creating={creatingTrip} />
        ) : (
          <ul className="mt-6 space-y-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <SavedTripCard
                  trip={trip}
                  deleteSlot={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDeleteTarget({ id: trip.id, title: resolveCoreTripTitle(trip) });
                      }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-soft hover:bg-secondary"
                      aria-label={t("saved.deleteAria")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        )
      ) : places.length === 0 ? (
        <PlacesEmptyState />
      ) : (
        <ul className="mt-6 space-y-3">
          {places.map((p) => (
            <li key={p.id}>
              <SavedPlaceCard
                place={p}
                addLabel={t("chat.addToTrip")}
                removeLabel={t("saved.removeAria")}
                opening={openingPlaceId === p.id}
                onOpen={handleOpenPlace}
                onAddToTrip={(place) => openAddToTrip(tripPlaceFromSavedPlace(place))}
                onDelete={(place) => void handleDeletePlace(place.id, place.name)}
              />
            </li>
          ))}
        </ul>
      )}

      <TripDeleteConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={handleConfirmDeleteTrip}
        confirming={deleting}
      />
    </div>
  );
}
