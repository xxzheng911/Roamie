import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  InvalidTripPlaceInputError,
  logAddToTripInputNormalization,
  normalizeTripPlaceInput,
  type AddToTripSurface,
  type TripPlaceInput,
} from "@/lib/trip/trip-place-input";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";
import { logRecommendationReasonHandoff } from "@/lib/trip/recommendation-reason-persistence-log";

const AddToTripSheetLazy = lazy(() =>
  import("@/components/AddToTripSheet").then((m) => ({ default: m.AddToTripSheet })),
);

type AddToTripContextValue = {
  openAddToTrip: (place: TripPlaceInput, surface?: AddToTripSurface) => void;
};

const AddToTripContext = createContext<AddToTripContextValue | null>(null);

export function AddToTripProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [place, setPlace] = useState<TripPlaceInput | null>(null);
  const [sourceSurface, setSourceSurface] = useState<AddToTripSurface>("unknown");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openAddToTrip = useCallback((p: TripPlaceInput, surface: AddToTripSurface = "unknown") => {
    try {
      const normalized = normalizeTripPlaceInput({
        ...p,
        recommendationSource: p.recommendationReason ? surface : undefined,
      });
      logAddToTripInputNormalization({ surface, raw: p, normalized });
      logRecommendationReasonHandoff({
        surface,
        canonicalPlaceId: normalized.canonicalPlaceId,
        hasReason: Boolean(normalized.recommendationReason),
        reasonSource: normalized.recommendationReasonSource,
        target: "add_to_trip",
      });
      setPlace(normalized);
      setSourceSurface(surface);
      setSheetOpen(true);
    } catch (error) {
      const normalizationError = error instanceof InvalidTripPlaceInputError
        ? error
        : new InvalidTripPlaceInputError("input", "unexpected_normalization_error");
      logAddToTripInputNormalization({ surface, raw: p, error: normalizationError });
      console.error("[ADD_TO_TRIP_ERROR]", {
        surface,
        failureReason: normalizationError.code,
        failureField: normalizationError.failureField,
      });
      console.info("[ADD_TO_TRIP_RESULT]", {
        surface,
        success: false,
        failureReason: normalizationError.code,
        itineraryTargetResolved: false,
      });
      setBusy(false);
      setSheetOpen(false);
      setPlace(null);
      setSourceSurface("unknown");
      toast.error(normalizationError.message);
    }
  }, []);

  const handleConfirm = useCallback(
    async (opts: {
      target: "draft" | { tripId: string } | "new";
      newTitle?: string;
      date: string;
      position: "start" | "end";
      afterPlaceName?: string;
    }) => {
      if (!place) return;
      setBusy(true);
      try {
        const { appendPlaceToTrip } = await import("@/lib/trip/append-place-to-trip");
        const result = await appendPlaceToTrip(
          opts.target === "draft"
            ? { kind: "draft" }
            : opts.target === "new"
              ? {
                  kind: "new",
                  title: opts.newTitle ?? `${place.placeName} 的小旅行`,
                  destination: place.address,
                }
              : { kind: "trip", tripId: opts.target.tripId },
          place,
          {
            date: opts.date,
            position: opts.position,
            afterPlaceName: opts.afterPlaceName,
          },
        );
        console.info("[ADD_TO_TRIP_RESULT]", {
          surface: sourceSurface,
          success: true,
          failureReason: "",
          itineraryTargetResolved: true,
        });
        toast.success("已加入行程");
        setSheetOpen(false);
        setPlace(null);
        if (result.isDraft) {
          navigate({ to: "/trip", search: { draft: "1" } });
        } else {
          logTripNav("AddToTrip", result.tripId);
          navigate(tripDetailNavigateOptions(result.tripId));
        }
      } catch (e) {
        console.error("[ADD_TO_TRIP_ERROR]", {
          surface: sourceSurface,
          failureReason: e instanceof InvalidTripPlaceInputError ? e.code : "append_failed",
        });
        console.info("[ADD_TO_TRIP_RESULT]", {
          surface: sourceSurface,
          success: false,
          failureReason: e instanceof InvalidTripPlaceInputError ? e.code : "append_failed",
          itineraryTargetResolved: true,
        });
        toast.error(e instanceof Error ? e.message : "加入行程失敗");
      } finally {
        setBusy(false);
      }
    },
    [place, navigate, sourceSurface],
  );

  const value = useMemo(() => ({ openAddToTrip }), [openAddToTrip]);

  return (
    <AddToTripContext.Provider value={value}>
      {children}
      {sheetOpen ? (
        <Suspense fallback={null}>
          <AddToTripSheetLazy
            open={sheetOpen}
            onOpenChange={(o) => {
              setSheetOpen(o);
              if (!o) setPlace(null);
              if (!o) setSourceSurface("unknown");
            }}
            place={place}
            busy={busy}
            onConfirm={handleConfirm}
          />
        </Suspense>
      ) : null}
    </AddToTripContext.Provider>
  );
}

export function useAddToTrip(): AddToTripContextValue {
  const ctx = useContext(AddToTripContext);
  if (!ctx) throw new Error("useAddToTrip must be used within AddToTripProvider");
  return ctx;
}

/** 可選：地圖等未包 Provider 時不 crash */
export function useAddToTripOptional(): AddToTripContextValue | null {
  return useContext(AddToTripContext);
}
