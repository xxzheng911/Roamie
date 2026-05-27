import { createFileRoute } from "@tanstack/react-router";
import { TripDetailScreen } from "@/components/trip/TripDetailScreen";
import { logTripNav } from "@/lib/trip/trip-detail-nav";

export const Route = createFileRoute("/_app/saved/$tripId")({
  beforeLoad: ({ params }) => {
    logTripNav("SavedTripCard-route", params.tripId);
  },
  component: SavedTripDetailPage,
});

function SavedTripDetailPage() {
  const { tripId } = Route.useParams();
  const navigate = Route.useNavigate();

  return (
    <TripDetailScreen
      tripId={tripId}
      navSource="SavedTripCard"
      onDeleted={() => navigate({ to: "/saved", search: { tab: "trips" } })}
    />
  );
}
