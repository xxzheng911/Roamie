import { createFileRoute } from "@tanstack/react-router";
import { TripDetailScreen } from "@/components/trip/TripDetailScreen";

export const Route = createFileRoute("/_app/saved/$tripId")({
  validateSearch: (search: Record<string, unknown>) => {
    const fromRaw = search.from ?? (search.back === "saved" ? "saved" : undefined);
    const from =
      fromRaw === "saved" ||
      fromRaw === "chat" ||
      fromRaw === "plan" ||
      fromRaw === "home"
        ? fromRaw
        : undefined;
    return { from };
  },
  /** 子路由切換時不要掛全屏 pending（與 router defaultPendingMs 搭配） */
  pendingMs: 0,
  component: SavedTripDetailPage,
});

function SavedTripDetailPage() {
  const { tripId } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TripDetailScreen
      tripId={tripId}
      navSource="SavedTripCard"
      fromSource={from ?? "saved"}
      onDeleted={() => navigate({ to: "/saved", search: { tab: "trips" } })}
    />
  );
}
