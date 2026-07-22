#!/usr/bin/env node
/**
 * P0 stabilization — offline checks (no Places / no Feature Flag changes).
 * - Chat navigation: travel_draft → /travel-drafts
 * - Planning context authority: duration merge must not drop destination
 * - Validator soft rules must not hard-block (date_span / route_backtrack)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveChatBackTarget,
  resolveChatEntrySource,
  CHAT_FROM_TRAVEL_DRAFT,
  TRAVEL_DRAFTS_ROUTE,
} from "../src/lib/chat-navigation.ts";
import {
  finalizePlanningContextAuthority,
  readPlanningContextAuthority,
} from "../src/lib/ai/planning-context-authority.ts";
import {
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
  shouldBlockItineraryDelivery,
} from "../src/lib/ai/itinerary-validator/index.ts";
import { createEmptySession } from "../src/lib/chat-session.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

test("travel_draft entry resolves back to /travel-drafts", () => {
  assert.equal(
    resolveChatEntrySource({ from: CHAT_FROM_TRAVEL_DRAFT }),
    "travel_draft",
  );
  const back = resolveChatBackTarget({ from: "travel-draft" });
  assert.equal(back.entrySource, "travel_draft");
  assert.equal(back.target.to, TRAVEL_DRAFTS_ROUTE);
  assert.equal(back.usedFallback, false);
});

test("main_chat still returns home", () => {
  const back = resolveChatBackTarget({});
  assert.equal(back.entrySource, "main_chat");
  assert.equal(back.target.to, "/");
});

test("travel-drafts openWorkspace passes from=travel-draft", () => {
  const src = readFileSync(join(root, "src/routes/_app.travel-drafts.tsx"), "utf8");
  assert.match(src, /from:\s*["']travel-draft["']/);
  assert.match(src, /workspaceId/);
});

test("duration finalize preserves destination", () => {
  const before = {
    ...createEmptySession(),
    pendingQuestion: { type: "ask_days", options: [] },
    travelContext: {
      interests: [],
      destination: "奈良",
      destinationCountry: "日本",
      conversationState: "awaiting_days",
    },
  };
  const { context, session } = finalizePlanningContextAuthority({
    before,
    context: {
      interests: [],
      // simulate accidental clear during duration merge
      days: 3,
      destinationCountry: "日本",
      conversationState: "awaiting_days",
    },
    session: {
      ...before,
      tripDays: 3,
      pendingQuestion: undefined,
      adviceSelectionThisTurn: "3",
      lastResolvedPendingQuestion: { type: "ask_days" },
      travelContext: {
        interests: [],
        days: 3,
        destinationCountry: "日本",
      },
    },
  });
  assert.equal(context.destination, "奈良");
  assert.equal(session.travelContext?.destination, "奈良");
  const auth = readPlanningContextAuthority(session);
  assert.equal(auth.destination, "奈良");
  assert.equal(auth.days, 3);
});

test("soft date_span / route_backtrack do not block delivery", () => {
  setItineraryValidatorEnabledOverride(true);
  const place = (partial) => ({
    address: "addr",
    photoName: "p",
    businessStatus: "OPERATIONAL",
    openStatus: "open",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    openNow: true,
    userRatingCount: 50,
    rating: 4.2,
    primaryType: "tourist_attraction",
    types: ["tourist_attraction"],
    ...partial,
  });
  const entry = (time, label, p) => ({ time, label, name: p.name, place: p });
  const fullDay = (day, lat, lng, tag) => ({
    day,
    entries: [
      entry("08:00", "早餐", place({ id: `b-${tag}`, name: `BF ${tag}`, lat, lng, primaryType: "cafe", types: ["cafe"] })),
      entry("09:30", "景點", place({ id: `a1-${tag}`, name: `A1 ${tag}`, lat: lat + 0.01, lng })),
      entry("12:30", "午餐", place({ id: `l-${tag}`, name: `Lunch ${tag}`, lat: lat + 0.02, lng, primaryType: "restaurant", types: ["restaurant"] })),
      entry("15:00", "景點", place({ id: `a2-${tag}`, name: `A2 ${tag}`, lat: lat + 0.03, lng })),
      entry("18:30", "晚餐", place({ id: `d-${tag}`, name: `Dinner ${tag}`, lat: lat + 0.04, lng, primaryType: "restaurant", types: ["restaurant"] })),
    ],
  });
  // Intentionally mismatched date span (2 calendar days vs requestedDays=3) — must WARN not FAIL
  const result = validateItineraryPlan({
    plans: [fullDay(1, 35.68, 139.76, "s1"), fullDay(2, 35.69, 139.77, "s2"), fullDay(3, 35.7, 139.78, "s3")],
    requestedDays: 3,
    plannedDate: "2026-08-01",
    endDate: "2026-08-02",
    destination: "東京",
  });
  assert.equal(result.pass, true, JSON.stringify(result.failedRules));
  assert.ok(
    result.warnings.some((w) => w.message.includes("date_span_mismatch")),
    "date_span should be warning",
  );
  assert.equal(shouldBlockItineraryDelivery(result), false);
  setItineraryValidatorEnabledOverride(null);
});

test("legacy inventory doc exists", () => {
  const doc = readFileSync(
    join(root, "docs/raos/candidate-pool-legacy-inventory.md"),
    "utf8",
  );
  assert.match(doc, /shouldSkipPlanningPlacesApi/);
  assert.match(doc, /Safe to remove/);
  assert.match(doc, /This sprint: zero deletions/);
});

console.info("\n[verify:p0-runtime-stabilization] passed\n");
