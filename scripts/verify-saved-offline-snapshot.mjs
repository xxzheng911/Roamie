import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const snapshot = await readFile("src/lib/saved-list-snapshot.ts", "utf8");
assert.match(snapshot, /roamie:saved-list-snapshot:/);
assert.match(snapshot, /ownerUserId !== userId/);
assert.match(snapshot, /Preferences\.set/);
assert.match(snapshot, /Preferences\.get/);
assert.match(snapshot, /places: safePlaces\(places\)/);
assert.match(snapshot, /trips: safeTrips\(trips\)/);
assert.doesNotMatch(snapshot, /access_token|refresh_token|authorization/i);

const route = await readFile("src/routes/_app.saved.index.tsx", "utf8");
assert.match(route, /hydrateSavedListSnapshot\(authUserId\)/);
assert.match(route, /if \(tripsResult\.status === "fulfilled"\)/);
assert.match(route, /if \(placesResult\.status === "fulfilled"\)/);
assert.match(route, /canonicalNetworkError: true/);
assert.match(route, /cleared: false/);

const places = await readFile("src/lib/places-storage.ts", "utf8");
assert.match(places, /if \(isNetworkFailureError\(error\)\) throw error/);

const collab = await readFile("src/lib/trip/trip-collab.ts", "utf8");
assert.doesNotMatch(collab, /catch[\s\S]{0,120}listOwnedTripIds[\s\S]{0,120}return new Map/);

const workspace = await readFile("src/lib/conversation-workspace/remote-sync.ts", "utf8");
assert.match(workspace, /catch \(e\)[\s\S]*return false/);

const cleanup = await readFile("src/lib/clear-auth-state.ts", "utf8");
assert.match(cleanup, /isSavedListSnapshotKey/);

console.log("Saved places/trips durable offline snapshot regression: PASS");
