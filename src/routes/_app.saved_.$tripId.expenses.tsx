import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { TripExpensesScreen } from "@/components/trip/expenses/TripExpensesScreen";
import { isValidUuid } from "@/lib/uuid";

// 共同記帳（Trip Workspace V1 第 4 階段）：/saved/$tripId/expenses
// 以 saved_ 跳出 /saved layout 巢狀，不把行程頁（_app.saved.$tripId.tsx）改成 layout route。
export const Route = createFileRoute("/_app/saved_/$tripId/expenses")({
  component: TripExpensesPage,
});

function TripExpensesPage() {
  const { tripId } = Route.useParams();
  const navigate = Route.useNavigate();
  const valid = isValidUuid(tripId);

  useEffect(() => {
    if (valid) return;
    console.warn("[TRIP_EXPENSES_ROUTE] invalid tripId, redirecting", tripId);
    void navigate({ to: "/saved", search: { tab: "trips" }, replace: true });
  }, [valid, tripId, navigate]);

  if (!valid) return null;
  return <TripExpensesScreen key={tripId} tripId={tripId} />;
}
