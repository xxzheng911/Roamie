import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createHomeTripSummarySnapshot,
  restoreHomeTripFromSnapshot,
} from "../src/lib/home-trip-snapshot.ts";

const trip = {
  id: "trip-1",
  title: "東京散步",
  customTitle: null,
  isTitleCustomized: false,
  coverImageUrl: "https://images.example/trip.jpg",
  customCoverImageUrl: "https://storage.example/cover.jpg?token=signed",
  aiGeneratedCoverImageUrl: null,
  isCoverCustomized: true,
  destinationPlace: { name: "東京" },
  originPlace: null,
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  days: 3,
  transportMode: "步行",
  places: [{ placeId: "secret-detail", name: "不應保存完整行程" }],
  weatherSummary: "live weather",
  outfitSuggestion: "live outfit",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  isOwner: true,
};

const snapshot = createHomeTripSummarySnapshot("user-a", trip);
assert.equal(snapshot.trip.title, "東京散步");
assert.equal(snapshot.trip.days, 3);
assert.equal(snapshot.trip.customCoverImageUrl, null, "signed/query URL must not persist");
assert.equal("places" in snapshot.trip, false, "full itinerary must not persist");

const restored = restoreHomeTripFromSnapshot(snapshot, "user-a");
assert.equal(restored?.id, "trip-1");
assert.equal(restored?.places.length, 0);
assert.equal(restoreHomeTripFromSnapshot(snapshot, "user-b"), null, "cross-user read rejected");

const home = await readFile("src/routes/_app.index.tsx", "utf8");
assert.match(home, /readHomeTripSummarySnapshotResult\(userId\)/);
assert.match(home, /source: cachedResult\.source/);
assert.match(home, /\[HOME_TRIP_SNAPSHOT\]/);
assert.match(home, /writeHomeTripSummarySnapshot\(userId, view\)/);
assert.match(home, /else \{[\s\S]{0,120}await clearHomeTripSummarySnapshot\(userId\)/);
assert.match(home, /network failure is not evidence[\s\S]*Keep the same-user durable snapshot/);
assert.doesNotMatch(home, /catch\(\(\) => \{[\s\S]{0,180}setLatestTrip\(null\)/);

const cleanup = await readFile("src/lib/clear-auth-state.ts", "utf8");
assert.match(cleanup, /isHomeTripSummarySnapshotKey/);

console.log("Home user-scoped offline trip snapshot regression: PASS");
