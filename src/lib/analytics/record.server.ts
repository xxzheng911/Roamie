import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AnalyticsEventV1 } from "./events";

export async function recordAnalyticsEventServer(
  event: AnalyticsEventV1,
  userId?: string | null,
): Promise<void> {
  const analyticsClient = supabaseAdmin as unknown as {
    from: (table: "analytics_events") => {
      upsert: (
        row: Record<string, unknown>,
        options: { onConflict: string; ignoreDuplicates: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  const { error } = await analyticsClient.from("analytics_events").upsert(
    {
      event_id: event.eventId,
      event_name: event.eventName,
      occurred_at: event.occurredAt ?? new Date().toISOString(),
      user_id: userId ?? null,
      tier: event.tier ?? null,
      session_id: event.sessionId?.slice(0, 160) ?? null,
      surface: event.surface ?? null,
      place_id: event.placeId?.replace(/^places\//, "").slice(0, 255) ?? null,
      recommendation_family: event.recommendationFamily?.slice(0, 80) ?? null,
      provider: event.provider?.slice(0, 80) ?? null,
      failure_code: event.failureCode?.slice(0, 100) ?? null,
    },
    { onConflict: "event_id,event_name", ignoreDuplicates: true },
  );
  if (error) console.error("[ANALYTICS_EVENT_WRITE]", event.eventName, error.message);
}
