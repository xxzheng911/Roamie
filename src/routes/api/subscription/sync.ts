import { createFileRoute } from "@tanstack/react-router";
import { requireAuthenticatedAiRequest } from "@/lib/ai/endpoint-guard.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { isKillSwitchOn, fixedStatusResponse } from "@/lib/kill-switch.server";
import {
  subscriptionSyncFailureResponse,
  syncRevenueCatSubscription,
} from "@/lib/subscription/revenuecat-sync.server";

export const Route = createFileRoute("/api/subscription/sync")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        if (
          isAbuseGuardEnforcementOn(context.cloudflareEnv) &&
          isKillSwitchOn(context.cloudflareEnv, "DISABLE_SUBSCRIPTION_SYNC")
        ) {
          return fixedStatusResponse("sync_unavailable");
        }
        const auth = await requireAuthenticatedAiRequest(request);
        if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
        // The authenticated Supabase user is the only owner. The body cannot name one.
        try {
          const result = await syncRevenueCatSubscription(auth.userId, context.cloudflareEnv);
          return Response.json({
            synced: true,
            active: result.active,
            expiresAt: result.expiresAt,
            lifecyclePersisted: result.lifecyclePersisted,
          });
        } catch (error) {
          return subscriptionSyncFailureResponse(error);
        }
      },
    },
  },
});
