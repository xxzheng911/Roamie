import assert from "node:assert/strict";
import {
  logNearbyExtensionMergeTelemetry,
  logNearbyExtensionSearchTelemetry,
} from "../src/lib/ai/nearby-extension-candidate-telemetry.ts";

const logs = [];
const originalInfo = console.info;
console.info = (...args) => logs.push(args.join(" "));

try {
  const accepted = [
    {
      googlePlaceId: "ChIJYokohamaTelemetryOne",
      placeName: "Yokohama Telemetry One",
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    },
    {
      googlePlaceId: "ChIJYokohamaTelemetryTwo",
      placeName: "Yokohama Telemetry Two",
      destinationScope: "nearby_extension",
      extensionDestination: "橫濱",
    },
  ];

  logNearbyExtensionSearchTelemetry({
    requestedExtension: "橫濱",
    rawCount: 5,
    acceptedPlaces: accepted,
    rejectionReasons: { duplicate: 1, subplace: 2 },
  });
  logNearbyExtensionMergeTelemetry({
    requestedExtension: "橫濱",
    beforeMerge: 21,
    nearbyAdded: 2,
    afterMerge: 23,
    calculatedCap: 21,
    afterSlice: 21,
    remainingPlaces: [],
  });
  logNearbyExtensionMergeTelemetry({
    requestedExtension: "橫濱",
    beforeMerge: 10,
    nearbyAdded: 2,
    afterMerge: 12,
    calculatedCap: 12,
    afterSlice: 12,
    remainingPlaces: accepted,
  });
} finally {
  console.info = originalInfo;
}

const search = logs.find((line) => line.includes("[NEARBY_EXTENSION_SEARCH]"));
assert.ok(search);
assert.match(search, /requestedExtension=橫濱/);
assert.match(search, /rawCount=5/);
assert.match(search, /acceptedCount=2/);
assert.match(search, /rejectedCount=3/);
assert.match(search, /acceptedPlaceCount=2/);
assert.match(search, /acceptedPlaceIds=\[ChIJ\*\*\*One\|ChIJ\*\*\*Two\]/);
assert.match(search, /acceptedPlaceNames=\[Yokohama Telemetry One\|Yokohama Telemetry Two\]/);
assert.match(search, /rejectionReasons=duplicate:1\|subplace:2/);

const mergeLogs = logs.filter((line) => line.includes("[NEARBY_EXTENSION_MERGE]"));
assert.equal(mergeLogs.length, 2);
assert.match(mergeLogs[0], /beforeMerge=21/);
assert.match(mergeLogs[0], /nearbyAdded=2/);
assert.match(mergeLogs[0], /afterMerge=23/);
assert.match(mergeLogs[0], /calculatedCap=21/);
assert.match(mergeLogs[0], /afterSlice=21/);
assert.match(mergeLogs[0], /remainingNearby=0/);
assert.match(mergeLogs[1], /remainingNearby=2/);
assert.match(
  mergeLogs[1],
  /remainingNearbyDestinationScope=\[nearby_extension\|nearby_extension\]/,
);
assert.match(mergeLogs[1], /remainingNearbyExtensionDestination=\[橫濱\|橫濱\]/);

console.log("verify-nearby-extension-candidate-telemetry: OK");
