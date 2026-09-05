import { getClientAuthSession } from "@/lib/auth-session";
import type { AnalyticsEventV1 } from "./events";
import { resolveApiUrl } from "@/lib/api-url";

const sent = new Set<string>();

/** Browser interaction recorder. SSR calls are deliberately ignored. */
export function recordAnalyticsEvent(event: AnalyticsEventV1): void {
  if (typeof window === "undefined") return;
  const dedupeKey = `${event.eventName}:${event.eventId}`;
  if (sent.has(dedupeKey)) return;
  sent.add(dedupeKey);
  void getClientAuthSession()
    .then(async (session) => {
      if (!session?.access_token) return;
      const response = await fetch(resolveApiUrl("/api/analytics/events"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(event),
        keepalive: true,
      });
      if (!response.ok) sent.delete(dedupeKey);
    })
    .catch(() => sent.delete(dedupeKey));
}
