/**
 * L6 (tester) — root cause probe for 2b: a typed date range on the first turn must be a confirmed
 * user date in every locale. Locally known destinations (「12/10-12/14 我要去雪梨」) go through
 * mergeTravelContextLegacy, which stamps dateProvenance (ai-trip-style.ts:260-265); a destination
 * that goes through the global planning candidate path (「12/10-12/14 シドニーへ旅行」, "sydney trip")
 * gets startDate / endDate from global-planning-context.ts:28-30 with NO dateProvenance.
 * Same for a date-only correction while choosing combinations (global calendar branch :83-85),
 * which keeps the previous turn's provenance for the old dates.
 *
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=120 scripts/verify-l-date-provenance-probe.mjs
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
globalThis.fetch = async () => { throw new Error("NO_NETWORK"); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const sessionMod = await load("src/lib/chat-session.ts");
const travelContext = await load("src/lib/ai/travel-context.ts");
const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
const convState = await load("src/lib/ai/chat-conversation-state.ts");
const gp = await load("src/lib/ai/global-planning-context.ts");

const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행",
  "ja/行きます": "12/10-12/14 シドニーに行きます", "en/trip": "12/10-12/14 sydney trip", "zh/旅行": "12/10-12/14 雪梨旅行" };
const failures = [];
for (const [loc, t] of Object.entries(STEP1)) {
  const s0 = sessionMod.createEmptySession();
  let n = tripIntent.applyTripIntentToSession(t, s0);
  n = convState.prepareSessionForUserTurn(n, undefined);
  const viaGlobal = Boolean(gp.globalPlanningTurn(n, t));
  const m = travelContext.mergeTravelContext(n, t, undefined);
  const row = `${loc} 「${t}」 path=${viaGlobal ? "global(global-planning-context.ts:28-30)" : "legacy(ai-trip-style.ts:260-265)"} start=${m.context.startDate} end=${m.context.endDate} prov=${JSON.stringify(m.context.dateProvenance ?? null)}`;
  try {
    assert.equal(m.context.startDate, "2026-12-10");
    assert.equal(m.context.dateProvenance?.source, "user_date", "typed range has no user_date provenance");
    assert.equal(m.context.dateProvenance?.confirmed, true);
    assert.equal(m.context.dateProvenance?.startDate, m.context.startDate, "provenance is for other dates");
    out(`PASS ${row}`);
  } catch (e) { failures.push(loc); out(`FAIL ${row}\n  ${e.message.split("\n")[0]}`); }
}
out(failures.length ? `\nFAIL ${failures.length}: ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
