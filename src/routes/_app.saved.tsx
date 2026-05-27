export const Route = createFileRoute("/_app/saved")({
  component: SavedLayout,
});
import { createFileRoute, Outlet } from "@tanstack/react-router";

function SavedLayout() {
  return <Outlet />;
}
