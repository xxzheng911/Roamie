import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy alias — startup gate lives at /loading */
export const Route = createFileRoute("/splash")({
  beforeLoad: () => {
    throw redirect({ to: "/loading" });
  },
});
