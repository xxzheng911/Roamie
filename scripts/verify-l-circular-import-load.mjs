/**
 * L4 — trip-planning-session-reset.ts <-> global-planning-context.ts circular import.
 * Loads ONE entry (argv --entry=reset|global|travel) in a fresh vite-node process and checks that the
 * cross-module exports are functions at call time (no TDZ / undefined at module-eval time).
 *
 * Run: npx vite-node scripts/verify-l-circular-import-load.mjs --config scripts/vite.verify.config.mjs -- --entry=reset
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
const entry = process.argv.find((a) => a.startsWith("--entry="))?.slice(8) ?? "reset";
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
globalThis.fetch = async () => { throw new Error("NO_NETWORK"); };
const paths = { reset: "src/lib/ai/trip-planning-session-reset.ts", global: "src/lib/ai/global-planning-context.ts", travel: "src/lib/ai/travel-context.ts" };
const first = await import(/* @vite-ignore */ `/${paths[entry]}`);
const reset = await import(/* @vite-ignore */ `/${paths.reset}`);
const global = await import(/* @vite-ignore */ `/${paths.global}`);
assert.equal(typeof reset.isNewTripPlanning, "function");
assert.equal(typeof reset.resetForDestinationChange, "function");
assert.equal(typeof global.combinationChoiceSwitchForSession, "function");
assert.equal(typeof global.globalPlanningTurn, "function");
const session = await import(/* @vite-ignore */ "/src/lib/chat-session.ts");
const s = { ...session.createEmptySession(), pendingQuestion: { type: "combination_choice", baseDestination: "雪梨" },
  travelContext: { interests: [], destination: "雪梨", destinationCity: "雪梨", destinationType: "city", days: 5 } };
// Exercises both directions at call time.
const det = reset.isNewTripPlanning(s, "改去京都");
const g = global.globalPlanningTurn(s, "改去京都");
out(`entry=${entry} firstKeys=${Object.keys(first).length} isNew=${det.isNew} reason=${det.reason ?? ""} incoming=${det.incomingDestination ?? ""} global=${g?.destination ?? ""}`);
assert.ok(det.isNew, "isNewTripPlanning must see the combination switch");
assert.equal(g?.destination, "京都");
out("PASS circular import load " + entry);
