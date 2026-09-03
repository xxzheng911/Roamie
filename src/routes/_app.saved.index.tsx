import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import { Plus, Loader2, Trash2, Heart, Route as RouteIcon, Share2 } from "lucide-react";
import { useAddToTrip } from "@/hooks/use-add-to-trip";
import { tripPlaceFromSavedPlace } from "@/lib/trip/trip-place-input";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n } from "@/hooks/use-i18n";
import { SavedTripCard } from "@/components/saved/SavedTripCard";
import { SavedPlaceCoverThumb } from "@/components/saved/SavedPlaceCoverThumb";
import { SavedPlaceRemoveConfirmDialog } from "@/components/saved/SavedPlaceRemoveConfirmDialog";
import { SAVED_TRIPS_CHANGED_EVENT } from "@/lib/itinerary-storage";
import { deleteTrip } from "@/lib/saved-trip/delete-trip";
import { TripDeleteConfirmDialog } from "@/components/saved/TripDeleteConfirmDialog";
import { TripSharePanel } from "@/components/trip/TripSharePanel";
import { listCoreTrips, type CoreTrip, resolveCoreTripTitle } from "@/lib/trip/core-trip";
import { isMissingTableError } from "@/lib/supabase-errors";
import {
  deletePlace,
  listPlaces,
  readPlacesLocalCacheSync,
  SAVED_PLACES_CHANGED_EVENT,
  type SavedPlace,
} from "@/lib/places-storage";
import {
  readSavedPlacesSnapshot,
  readSavedTripsSnapshot,
  writeSavedPlacesSnapshot,
  writeSavedTripsSnapshot,
} from "@/lib/saved-list-snapshot";
import { setPlaceDetailHandoff } from "@/lib/place-detail-handoff";
import {
  resolveSavedPlaceGooglePlaceId,
  savedPlaceToHandoff,
} from "@/lib/saved-place-utils";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/providers/SubscriptionProvider";

type SavedSearch = { tab?: string };

export const Route = createFileRoute("/_app/saved/")({
  validateSearch: (s: Record<string, unknown>): SavedSearch => ({
    tab: typeof s.tab === "string" ? s.tab : undefined,
  }),
  component: Saved,
});

type Tab = "trips" | "places";

function TripsEmptyState() {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <RouteIcon className="h-7 w-7 text-clay" />
      </div>
      <p className="font-display text-xl">{t("saved.emptyAllTitle")}</p>
      <p className="max-w-[280px] text-sm leading-relaxed text-muted-foreground">
        還沒有收藏的行程，等你和 Roamie 一起收藏第一段旅程。
      </p>
      <Link
        to="/map"
        className="mt-1 rounded-full bg-primary px-6 py-3 text-sm text-primary-foreground"
      >
        {t("saved.exploreCta")}
      </Link>
      <Link to="/plan" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
        {t("saved.planCta")}
      </Link>
    </div>
  );
}

function PlacesEmptyState() {
  const { t } = useI18n();
  return (
    <div className="mt-8 flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
        <Heart className="h-7 w-7 text-clay" />
      </div>
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
  const { t } = useI18n();
  const tt = t as unknown as (key: string, params?: Record<string, unknown>) => string;
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { openAddToTrip } = useAddToTrip();
  const { user, session: authSession, loading: authLoading } = useAuth();
  const { loading: subscriptionLoading } = useSubscription();
  const routeStartedAtRef = useRef(Date.now());
  const requestSequenceRef = useRef(0);
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab === "places" ? "places" : "trips");
  const initialTrips = readSavedTripsSnapshot();
  const initialPlaces =
    readSavedPlacesSnapshot().length > 0
      ? readSavedPlacesSnapshot()
      : readPlacesLocalCacheSync();
  const hasCachedAtMountRef = useRef(initialTrips.length > 0 || initialPlaces.length > 0);
  const [trips, setTrips] = useState<CoreTrip[]>(() => initialTrips);
  const [places, setPlaces] = useState<SavedPlace[]>(() => initialPlaces);
  const [loading, setLoading] = useState(
    () => initialTrips.length === 0 && initialPlaces.length === 0,
  );
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string; isOwner: boolean } | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [removePlaceTarget, setRemovePlaceTarget] = useState<SavedPlace | null>(null);
  const [removingPlace, setRemovingPlace] = useState(false);
  const [openingPlaceId, setOpeningPlaceId] = useState<string | null>(null);

  const authUserId = user?.id ?? null;
  const sessionPresent = Boolean(authSession);
  const refresh = useCallback((opts?: { background?: boolean }) => {
    const requestId = `favorites_${Date.now().toString(36)}_${++requestSequenceRef.current}`;
    const elapsedMs = () => Date.now() - routeStartedAtRef.current;
    if (!opts?.background) setLoading(true);
    console.info("[FAVORITES_DATA_REQUEST_START]", {
      elapsedMs: elapsedMs(),
      route: "/saved",
      userPresent: Boolean(authUserId),
      sessionPresent,
      requestId,
    });
    Promise.allSettled([listCoreTrips(), listPlaces()])
      .then(([tripsResult, placesResult]) => {
        if (tripsResult.status === "fulfilled") {
          setTrips(tripsResult.value);
          writeSavedTripsSnapshot(tripsResult.value);
        } else if (isMissingTableError(tripsResult.reason)) {
          setTrips([]);
          writeSavedTripsSnapshot([]);
        } else if (!opts?.background) {
          toast.error(
            tripsResult.reason instanceof Error ? tripsResult.reason.message : t("saved.loadFailed"),
          );
        }

        if (placesResult.status === "fulfilled") {
          setPlaces(placesResult.value);
          writeSavedPlacesSnapshot(placesResult.value);
        } else if (isMissingTableError(placesResult.reason)) {
          setPlaces([]);
          writeSavedPlacesSnapshot([]);
        } else if (!opts?.background) {
          toast.error(
            placesResult.reason instanceof Error
              ? placesResult.reason.message
              : t("saved.loadFailed"),
          );
        }
        const failed = [tripsResult, placesResult].filter(
          (result) => result.status === "rejected",
        );
        console.info("[FAVORITES_DATA_REQUEST_DONE]", {
          elapsedMs: elapsedMs(),
          route: "/saved",
          userPresent: Boolean(authUserId),
          sessionPresent,
          requestId,
          count:
            (tripsResult.status === "fulfilled" ? tripsResult.value.length : 0) +
            (placesResult.status === "fulfilled" ? placesResult.value.length : 0),
        });
        if (failed.length) {
          console.warn("[FAVORITES_DATA_REQUEST_ERROR]", {
            elapsedMs: elapsedMs(),
            route: "/saved",
            userPresent: Boolean(authUserId),
            sessionPresent,
            requestId,
            failureCount: failed.length,
          });
        }
      })
      .finally(() => {
        setLoading(false);
        console.info("[FAVORITES_LOADING_CLEAR]", {
          elapsedMs: elapsedMs(),
          route: "/saved",
          userPresent: Boolean(authUserId),
          sessionPresent,
          requestId,
        });
      });
  }, [authUserId, sessionPresent, t]);

  useEffect(() => {
    const elapsedMs = Date.now() - routeStartedAtRef.current;
    console.info("[FAVORITES_ROUTE_MOUNT]", {
      elapsedMs,
      route: "/saved",
      userPresent: Boolean(user),
      sessionPresent: Boolean(authSession),
      requestId: "mount",
    });
    console.info("[FAVORITES_HYDRATION_START]", {
      elapsedMs,
      route: "/saved",
      userPresent: Boolean(user),
      sessionPresent: Boolean(authSession),
      requestId: "mount",
    });
  }, []);

  useEffect(() => {
    console.info("[FAVORITES_AUTH_STATE]", {
      elapsedMs: Date.now() - routeStartedAtRef.current,
      route: "/saved",
      userPresent: Boolean(user),
      sessionPresent: Boolean(authSession),
      requestId: "auth",
      state: authLoading ? "loading" : user ? "authenticated" : "anonymous",
    });
  }, [authLoading, authSession, user]);

  useEffect(() => {
    console.info("[FAVORITES_SUBSCRIPTION_STATE]", {
      elapsedMs: Date.now() - routeStartedAtRef.current,
      route: "/saved",
      userPresent: Boolean(user),
      sessionPresent: Boolean(authSession),
      requestId: "subscription",
      state: subscriptionLoading ? "loading" : "ready",
    });
  }, [authSession, subscriptionLoading, user]);

  useEffect(() => {
    const blockingDependencies = loading ? ["favorites_data_request"] : [];
    console.info("[ROUTE_LOADING_STATE]", {
      route: "/saved",
      loading,
      reason: loading ? "favorites_data_request_pending" : "render_ready",
      blockingDependencies,
    });
    if (!loading) {
      console.info("[FAVORITES_RENDER_READY]", {
        elapsedMs: Date.now() - routeStartedAtRef.current,
        route: "/saved",
        userPresent: Boolean(user),
        sessionPresent: Boolean(authSession),
        requestId: "render",
      });
    }
  }, [authSession, loading, user]);

  useEffect(() => {
    refresh({ background: hasCachedAtMountRef.current });
    const onRefresh = () => refresh({ background: true });
    window.addEventListener(SAVED_PLACES_CHANGED_EVENT, onRefresh);
    window.addEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    return () => {
      window.removeEventListener(SAVED_PLACES_CHANGED_EVENT, onRefresh);
      window.removeEventListener(SAVED_TRIPS_CHANGED_EVENT, onRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (search.tab === "places") setTab("places");
  }, [search.tab]);

  const handleConfirmDeleteTrip = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTrip(deleteTarget.id);
      toast.success(t("saved.deleted"));
      setTrips((prev) => {
        const next = prev.filter((trip) => trip.id !== deleteTarget.id);
        writeSavedTripsSnapshot(next);
        return next;
      });
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saved.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmRemovePlace = async () => {
    if (!removePlaceTarget) return;
    setRemovingPlace(true);
    try {
      await deletePlace(removePlaceTarget.id, removePlaceTarget.name);
      toast.success(t("saved.removed"));
      setPlaces((prev) => {
        const next = prev.filter(
          (p) => p.id !== removePlaceTarget.id && p.name !== removePlaceTarget.name,
        );
        writeSavedPlacesSnapshot(next);
        return next;
      });
      setRemovePlaceTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("saved.deleteFailed"));
    } finally {
      setRemovingPlace(false);
    }
  };

  const handleOpenSavedPlace = useCallback(
    async (place: SavedPlace) => {
      setOpeningPlaceId(place.id);
      try {
        const handoff = savedPlaceToHandoff(place);
        setPlaceDetailHandoff(handoff);
        const googlePlaceId = resolveSavedPlaceGooglePlaceId(place);
        await navigate({
          to: "/place",
          search: {
            placeId: googlePlaceId ?? handoff.placeId ?? undefined,
            lat: place.lat ?? undefined,
            lng: place.lng ?? undefined,
            returnTo: "saved",
          },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("saved.loadFailed"));
      } finally {
        setOpeningPlaceId(null);
      }
    },
    [navigate, t],
  );

  const hasAny = trips.length > 0 || places.length > 0;
  const routeVisible = routeLocation.pathname.replace(/\/+$/, "") === "/saved";
  const renderBranch = loading
    ? "loading"
    : tab === "trips"
      ? trips.length > 0
        ? "content"
        : "empty"
      : places.length > 0
        ? "content"
        : "empty";

  useEffect(() => {
    console.info("[FAVORITES_RENDER_BRANCH]", {
      branch: renderBranch,
      loading,
      tripsCount: trips.length,
      placesCount: places.length,
      authReady: !authLoading,
      sessionReady: Boolean(authSession),
      routeVisible,
    });
    const frame = requestAnimationFrame(() => {
      const localSpinnerVisible = Boolean(
        document.querySelector('[data-loading-owner="favorites-route"]'),
      );
      const routePendingVisible = Boolean(
        document.querySelector('[data-loading-owner="router-pending"]'),
      );
      const startupPendingVisible = Boolean(
        document.querySelector('[data-loading-owner="startup-gate"]'),
      );
      console.info("[FAVORITES_VISIBLE_LOADING_OWNER]", {
        routeVisible,
        localSpinnerVisible,
        routePendingVisible,
        startupPendingVisible,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [authLoading, authSession, loading, places.length, renderBranch, routeVisible, trips.length]);

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
          <Link
            to="/plan"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground"
            aria-label={t("saved.planNewAria")}
          >
            <Plus className="h-4 w-4" />
          </Link>
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
        <div data-loading-owner="favorites-route" className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : tab === "trips" ? (
        trips.length === 0 ? (
          <TripsEmptyState />
        ) : (
          <ul className="mt-6 space-y-3">
            {trips.map((trip) => (
              <li key={trip.id}>
                <SavedTripCard
                  trip={trip}
                  shareSlot={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setShareTarget({
                          id: trip.id,
                          title: resolveCoreTripTitle(trip),
                          isOwner: trip.isOwner ?? true,
                        });
                      }}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-soft hover:bg-secondary"
                      aria-label="分享行程"
                    >
                      <Share2 className="h-4 w-4" />
                    </button>
                  }
                  deleteSlot={
                    (trip.isOwner ?? true) ? (
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
                    ) : null
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
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-3xl border border-border bg-card p-3 shadow-soft"
            >
              <button
                type="button"
                onClick={() => void handleOpenSavedPlace(p)}
                disabled={openingPlaceId === p.id}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <SavedPlaceCoverThumb
                  place={p}
                  className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-secondary"
                  alt={p.name}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{p.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[p.category, p.city, p.address].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </button>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => openAddToTrip(tripPlaceFromSavedPlace(p))}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background"
                  aria-label={t("chat.addToTrip")}
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRemovePlaceTarget(p)}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                  aria-label={t("saved.removeAria")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
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

      <TripSharePanel
        open={shareTarget != null}
        onOpenChange={(open) => {
          if (!open) setShareTarget(null);
        }}
        tripId={shareTarget?.id ?? ""}
        tripTitle={shareTarget?.title ?? ""}
        isOwner={shareTarget?.isOwner ?? false}
      />

      <SavedPlaceRemoveConfirmDialog
        open={removePlaceTarget != null}
        placeName={removePlaceTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open && !removingPlace) setRemovePlaceTarget(null);
        }}
        onConfirm={handleConfirmRemovePlace}
        confirming={removingPlace}
      />
    </div>
  );
}
