import { createFileRoute } from "@tanstack/react-router";
import { handleGoogleProxy } from "@/lib/google-proxy.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
export const Route = createFileRoute("/api/google")({
  server: {
    handlers: {
      POST: ({ request, context }) =>
        handleGoogleProxy(
          request,
          (context as { cloudflareEnv?: CloudflareRuntimeEnv } | undefined)?.cloudflareEnv ?? {},
        ),
      GET: () =>
        Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } }),
    },
  },
});
