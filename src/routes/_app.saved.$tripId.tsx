import { createFileRoute } from "@tanstack/react-router";
import { TripDetailScreen } from "@/components/trip/TripDetailScreen";
import { logTripNav } from "@/lib/trip/trip-detail-nav";

export const Route = createFileRoute("/_app/saved/$tripId")({
  validateSearch: (search: Record<string, unknown>) => ({
    back: search.back === "saved" ? ("saved" as const) : undefined,
  }),
  beforeLoad: ({ params }) => {
    logTripNav("SavedTripCard-route", params.tripId);
  },
  /** 子路由切換時不要掛全屏 pending（與 router defaultPendingMs 搭配） */
  pendingMs: 0,
  component: SavedTripDetailPage,
});

function SavedTripDetailPage() {
  const { tripId } = Route.useParams();
  const { back } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TripDetailScreen
      tripId={tripId}
      navSource="SavedTripCard"
      preferSavedBack={back === "saved"}
      onDeleted={() => navigate({ to: "/saved", search: { tab: "trips" } })}
    />
  );
}
