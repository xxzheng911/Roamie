import { createFileRoute } from "@tanstack/react-router";
import { TripDetailScreen } from "@/components/trip/TripDetailScreen";
import { logTripNav } from "@/lib/trip/trip-detail-nav";
import { isValidUuid } from "@/lib/uuid";

type TripDetailSearch = {
  day?: number;
};

export const Route = createFileRoute("/_app/saved/$tripId")({
  validateSearch: (s: Record<string, unknown>): TripDetailSearch => {
    const raw = s.day;
    const day =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim()
          ? Number.parseInt(raw, 10)
          : undefined;
    return { day: day != null && Number.isFinite(day) && day > 0 ? day : undefined };
  },
  beforeLoad: ({ params }) => {
    logTripNav("SavedTripCard-route", params.tripId);
  },
  component: SavedTripDetailPage,
});

function SavedTripDetailPage() {
  const { tripId } = Route.useParams();
  const { day } = Route.useSearch();
  const navigate = Route.useNavigate();

  if (!isValidUuid(tripId)) {
    console.warn("[TRIP_DETAIL_ROUTE] invalid tripId, redirecting", tripId);
    void navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
    return null;
  }

  return (
    <TripDetailScreen
      tripId={tripId}
      navSource="SavedTripCard"
      initialDay={day}
      onDeleted={() => navigate({ to: "/saved", search: { tab: "trips" } })}
    />
  );
}
