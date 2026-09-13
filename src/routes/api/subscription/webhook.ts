import { createFileRoute } from "@tanstack/react-router";
import { handleRevenueCatWebhook } from "@/lib/subscription/revenuecat-webhook.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

export const Route = createFileRoute("/api/subscription/webhook")({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } }),
      POST: async ({ request, context }) =>
        handleRevenueCatWebhook(
          request,
          (context as { cloudflareEnv?: CloudflareRuntimeEnv } | undefined)?.cloudflareEnv ?? {},
        ),
    },
  },
});
