import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/place")({
  component: PlaceLayout,
});

function PlaceLayout() {
  return <Outlet />;
}
