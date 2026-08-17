#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearSessionCandidatePool,
  readSessionCandidatePool,
} from "../src/lib/ai/places-cost-cache/session-pool.ts";
import { ingestResolvedPlacesIntoCandidatePool } from "../src/lib/ai/places-cost-cache/ingest.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ingestSource = readFileSync(
  join(root, "src/lib/ai/places-cost-cache/ingest.ts"),
  "utf8",
);
const recSource = readFileSync(
  join(root, "src/lib/ai/destination-place-recommendation.ts"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    throw error;
  }
}

console.log("\n[verify:recommendation-pool-isolation-contract]\n");

test("source no longer falls back to shared chat_default", () => {
  assert.doesNotMatch(ingestSource, /chat_default/);
  assert.doesNotMatch(recSource, /chat_default/);
});

test("conversation/session pools are isolated", () => {
  clearSessionCandidatePool();
  ingestResolvedPlacesIntoCandidatePool({
    sessionId: "conversation-A",
    destination: "東京",
    places: [{ id: "ChIJ_A", name: "A Cafe", lat: 35.67, lng: 139.7 }],
  });
  ingestResolvedPlacesIntoCandidatePool({
    sessionId: "conversation-B",
    destination: "東京",
    places: [{ id: "ChIJ_B", name: "B Cafe", lat: 35.68, lng: 139.71 }],
  });

  const poolA = readSessionCandidatePool({ sessionId: "conversation-A", destination: "東京" });
  const poolB = readSessionCandidatePool({ sessionId: "conversation-B", destination: "東京" });
  assert.ok(poolA && poolB);
  assert.equal(poolA?.sessionId, "conversation-A");
  assert.equal(poolB?.sessionId, "conversation-B");
  assert.ok(poolA?.places.some((place) => place.id === "ChIJ_A"));
  assert.ok(poolB?.places.some((place) => place.id === "ChIJ_B"));
});

test("missing sessionId does not populate shared default pool", () => {
  clearSessionCandidatePool();
  ingestResolvedPlacesIntoCandidatePool({
    destination: "台南",
    places: [{ id: "ChIJ_C", name: "C Place", lat: 23.0, lng: 120.2 }],
  });
  const shared = readSessionCandidatePool({ sessionId: "chat_default", destination: "台南" });
  assert.equal(shared, null);
});

console.log("\n[verify:recommendation-pool-isolation-contract] OK\n");
