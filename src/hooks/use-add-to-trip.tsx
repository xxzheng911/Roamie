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
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { logTripNav, tripDetailNavigateOptions } from "@/lib/trip/trip-detail-nav";

const AddToTripSheetLazy = lazy(() =>
  import("@/components/AddToTripSheet").then((m) => ({ default: m.AddToTripSheet })),
);

type AddToTripContextValue = {
  openAddToTrip: (place: TripPlaceInput) => void;
};

const AddToTripContext = createContext<AddToTripContextValue | null>(null);

export function AddToTripProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [place, setPlace] = useState<TripPlaceInput | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const openAddToTrip = useCallback((p: TripPlaceInput) => {
    setPlace(p);
    setSheetOpen(true);
  }, []);

  const handleConfirm = useCallback(
    async (opts: {
      target: "draft" | { tripId: string } | "new";
      newTitle?: string;
      date: string;
      time: string;
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
            time: opts.time,
            position: opts.position,
            afterPlaceName: opts.afterPlaceName,
          },
        );
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
        toast.error(e instanceof Error ? e.message : "加入行程失敗");
      } finally {
        setBusy(false);
      }
    },
    [place, navigate],
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
