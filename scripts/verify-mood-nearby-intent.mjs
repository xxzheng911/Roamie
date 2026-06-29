#!/usr/bin/env node
import assert from "node:assert/strict";
import { isMoodNearbyRelaxationRequest } from "../src/lib/mood-nearby-intent.ts";
import { isCreateItineraryIntent } from "../src/lib/ai/chat-context-intent.ts";
import { detectChatIntent, inferNearbyIntentFromContext } from "../src/lib/ai/chat-intent.ts";

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("[verify:mood-nearby]");

test("relax prompt is mood nearby not itinerary", () => {
  const text = "我今天想放空，幫我安排一段輕鬆行程。";
  assert.equal(isMoodNearbyRelaxationRequest(text), true);
  assert.equal(isCreateItineraryIntent(text), false);
  assert.equal(detectChatIntent(text), "attraction");
});

test("fromMoodFlow infers nearby attraction", () => {
  const text = "我今天想放空，幫我安排一段輕鬆行程。";
  const session = { fromMoodFlow: true, mood: "想放空" };
  const ctx = { interests: [], mood: "想放空", vibe: "放鬆" };
  assert.equal(inferNearbyIntentFromContext(ctx, text, session), "attraction");
});

console.log("[verify:mood-nearby] 全部通過");
