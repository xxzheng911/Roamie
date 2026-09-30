import { createFileRoute } from "@tanstack/react-router";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { handleUnsplashProxy } from "@/lib/unsplash-proxy.server";

export const Route = createFileRoute("/api/unsplash")({
  server: {
    handlers: {
      POST: ({ request, context }) =>
        handleUnsplashProxy(
          request,
          (context as { cloudflareEnv?: CloudflareRuntimeEnv } | undefined)?.cloudflareEnv ?? {},
        ),
      GET: () =>
        Response.json(
          { error: "method_not_allowed" },
          { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } },
        ),
    },
  },
});
