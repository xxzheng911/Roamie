#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  buildWalkingTransportHint,
  estimateTravelModesLocal,
  mergeTravelDurations,
  recommendTransportMode,
} from "../src/lib/estimate-travel-mode.ts";

const walkingFriendly = /散步|適合步行|走路方便|慢慢走|附近散步/;

const short = estimateTravelModesLocal(400, { walk: 6 });
const shortWalk = short.find((mode) => mode.id === "walk");
assert.ok(shortWalk);
assert.match(shortWalk.hint, /適合步行/);

const boundary = buildWalkingTransportHint(1200, 20);
assert.match(boundary, /適合步行/);
assert.doesNotMatch(buildWalkingTransportHint(1201, 20), walkingFriendly);
assert.doesNotMatch(buildWalkingTransportHint(1200, 21), walkingFriendly);

const long = mergeTravelDurations(estimateTravelModesLocal(37_900), {
  distanceMeters: 37_900,
  walk: 505,
  transit: 62,
  drive: 48,
});
const longWalk = long.find((mode) => mode.id === "walk");
assert.ok(longWalk);
assert.equal(longWalk.minutes, 505);
assert.equal(longWalk.distanceMeters, 37_900);
assert.doesNotMatch(longWalk.hint, walkingFriendly);
assert.match(longWalk.hint, /距離較遠/);

const recommended = recommendTransportMode(long, {
  distanceMeters: 37_900,
  inTaiwan: true,
});
assert.equal(recommended.modeId, "transit");

console.info("verify-transport-copy-consistency: ok");
