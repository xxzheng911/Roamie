import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { syncRevenueCatSubscription } from "@/lib/subscription/revenuecat-sync.server";

export const Route = createFileRoute("/api/subscription/sync")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        try {
          const result = await syncRevenueCatSubscription(auth.userId, context.cloudflareEnv);
          return Response.json({
            synced: true,
            active: result.active,
            expiresAt: result.expiresAt,
          });
        } catch (error) {
          const code = error instanceof Error ? error.message : "subscription_sync_failed";
          return Response.json(
            { error: code },
            { status: code === "subscription_sync_configuration_missing" ? 503 : 502 },
          );
        }
      },
    },
  },
});
