import { createFileRoute, Navigate } from "@tanstack/react-router";

/** Legacy route — redirects to home (fake AI flow removed). */
export const Route = createFileRoute("/loading")({
  component: () => <Navigate to="/" replace />,
});
