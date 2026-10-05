import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sanitizeItineraryFailureTelemetry } from "@/lib/analytics/itinerary-failure-telemetry";
import type { AnalyticsEventV1 } from "./events";
import { generationDiagnosticSnapshot } from "@/lib/itinerary-diagnostics.server";
import { getWorkerScope } from "@/lib/worker-request-scope";

const generationFailureMetadata = new WeakMap<object, Record<string, unknown>>();

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
  const row: Record<string, unknown> = {
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
  };
  if (event.failureDiagnostics) {
    row.metadata = sanitizeItineraryFailureTelemetry(event.failureDiagnostics);
  }
  // Reuse the existing terminal event write (no new subrequest or schema).
  // An inner pre-settlement event must not hide the later commit/cleanup result.
  const diagnostic =
    event.eventName === "itinerary_generation_failed" ||
    event.eventName === "itinerary_generation_succeeded"
      ? generationDiagnosticSnapshot()
      : undefined;
  const terminalDiagnostic =
    diagnostic &&
    (diagnostic.primary ||
      ["succeeded", "plus_bypass", "rejected", "unconfirmed"].includes(diagnostic.commit));
  const scope = getWorkerScope();
  if (diagnostic && scope && row.metadata) {
    generationFailureMetadata.set(scope, row.metadata as Record<string, unknown>);
  }
  if (terminalDiagnostic) {
    row.metadata = {
      ...(scope ? generationFailureMetadata.get(scope) : undefined),
      ...(row.metadata as Record<string, unknown> | undefined),
      generationDiagnostic: diagnostic,
    };
  }
  const { error } = await analyticsClient
    .from("analytics_events")
    .upsert(row, { onConflict: "event_id,event_name", ignoreDuplicates: !terminalDiagnostic });
  if (error) console.error("[ANALYTICS_EVENT_WRITE]", event.eventName, "write_failed");
}
