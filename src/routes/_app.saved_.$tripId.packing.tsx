import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TripPackingScreen } from "@/components/trip/packing/TripPackingScreen";
import { isValidUuid } from "@/lib/uuid";

// 我的行李（Trip Workspace V1 第 5 階段）：/saved/$tripId/packing
// 以 saved_ 跳出 /saved layout 巢狀，不把行程頁（_app.saved.$tripId.tsx）改成 layout route。
export const Route = createFileRoute("/_app/saved_/$tripId/packing")({
  component: TripPackingPage,
});

function TripPackingPage() {
  const { tripId } = Route.useParams();
  const navigate = Route.useNavigate();
  const valid = isValidUuid(tripId);

  useEffect(() => {
    if (valid) return;
    console.warn("[TRIP_PACKING_ROUTE] invalid tripId, redirecting", tripId);
    void navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
  }, [valid, tripId, navigate]);

  if (!valid) return null;
  return <TripPackingScreen key={tripId} tripId={tripId} />;
}
