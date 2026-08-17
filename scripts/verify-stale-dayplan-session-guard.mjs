#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const chat = readFileSync(join(root, "src/routes/_app.chat.tsx"), "utf8");

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:stale-dayplan-session-guard]\n");

test("stale check uses original incoming plan session id", () => {
  assert.match(chat, /const incomingPlanSessionId = incomingDayPlan\?\.planningSessionId;/);
  assert.match(
    chat,
    /incomingPlanSessionId !== flowSessionId[\s\S]*isStalePlanningSession\(sessionForPlan, incomingPlanSessionId, flowSessionId\)/,
  );
});

test("alignDayPlanToSession only runs after stale check", () => {
  const staleCheckAt = chat.indexOf("isStalePlanningSession(sessionForPlan, incomingPlanSessionId, flowSessionId)");
  const alignAt = chat.indexOf("alignDayPlanToSession(incomingDayPlan, flowSessionId)");
  assert.ok(staleCheckAt > 0);
  assert.ok(alignAt > 0);
  assert.ok(alignAt > staleCheckAt);
});

console.log("\n[verify:stale-dayplan-session-guard] OK\n");
