import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { analyticsOperationEventId } from "../src/lib/analytics/events.ts";
import { normalizeAdminAnalyticsV1 } from "../src/lib/admin/admin-analytics.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260905090000_admin_analytics_v1.sql");

test("event table has idempotency, no authenticated direct access, and service-only aggregate", () => {
  assert.match(migration, /UNIQUE \(event_id, event_name\)/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\.analytics_events FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.admin_analytics_v1\(text\) TO service_role/,
  );
});

test("success rate excludes started and uses success plus failure denominator", () => {
  assert.match(migration, /itinerary_successes\+c\.itinerary_failures/);
  assert.doesNotMatch(migration, /itinerarySuccessRate[^;]+itinerary_attempts/);
});

test("operation phase ids are deterministic for retries and distinct across lifecycle", () => {
  assert.equal(analyticsOperationEventId("request-1", "started"), "request-1:started");
  assert.equal(
    analyticsOperationEventId("request-1", "started"),
    analyticsOperationEventId("request-1", "started"),
  );
  assert.notEqual(
    analyticsOperationEventId("request-1", "started"),
    analyticsOperationEventId("request-1", "failed"),
  );
});

test("admin aggregate normalizer distinguishes valid zero data from unavailable response", () => {
  const empty = normalizeAdminAnalyticsV1({
    observedAt: "2026-09-05T00:00:00Z",
    period: "30d",
    trackingStartedAt: "2026-09-05T00:00:00Z",
  });
  assert.equal(empty?.chatSessions, 0);
  assert.equal(empty?.affiliateCtr, 0);
  assert.equal(normalizeAdminAnalyticsV1({}), null);
});

test("client ingest cannot forge server lifecycle and admin endpoint enforces admin guard", () => {
  const ingest = read("src/routes/api/analytics/events.ts");
  const admin = read("src/routes/api/admin/dashboard.ts");
  assert.match(ingest, /Server-authority event required/);
  assert.doesNotMatch(
    ingest.match(/const ClientNames[^;]+/)?.[0] ?? "",
    /itinerary_generation_succeeded/,
  );
  assert.match(admin, /requireAdminFromRequest\(request\)/);
});

test("meaningful interactions are explicit rather than render-wide place impressions", () => {
  const chat = read("src/routes/_app.chat.tsx");
  const affiliate = read("src/components/trip/TripAffiliateSection.tsx");
  assert.match(
    chat,
    /if \(!trimmed \|\| streaming \|\| generating\) return;[\s\S]+chat_session_started/,
  );
  assert.match(affiliate, /affiliate_cta_impression/);
  assert.match(read("src/lib/affiliate/affiliate-links.ts"), /affiliate_cta_clicked/);
});
