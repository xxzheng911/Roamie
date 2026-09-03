#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveHomeNearbyViewState } from "../src/lib/home-nearby-view-state.ts";
import {
  isHomeRouteVisible,
  setHomeRouteVisible,
  subscribeHomeRouteVisible,
} from "../src/lib/home-route-active.ts";

assert.equal(
  resolveHomeNearbyViewState({ placeCount: 0, loading: true, renderState: "loading" }),
  "loading",
  "initial hydration must show loading rather than empty",
);
assert.equal(
  resolveHomeNearbyViewState({ placeCount: 0, loading: true, renderState: "empty" }),
  "loading",
  "an in-flight request must win over a premature empty signal",
);
assert.equal(
  resolveHomeNearbyViewState({ placeCount: 3, loading: true, renderState: "cached" }),
  "content",
  "cached results remain visible during background refresh",
);
assert.equal(
  resolveHomeNearbyViewState({ placeCount: 0, loading: false, renderState: "empty" }),
  "empty",
  "empty is visible only after loading settles",
);
assert.equal(
  resolveHomeNearbyViewState({ placeCount: 0, loading: false, renderState: "error" }),
  "error",
  "a first-load failure remains distinguishable from empty",
);
assert.equal(
  resolveHomeNearbyViewState({ placeCount: 2, loading: false, renderState: "fresh" }),
  "content",
);

let visibilityNotifications = 0;
const unsubscribe = subscribeHomeRouteVisible(() => {
  visibilityNotifications += 1;
});
setHomeRouteVisible(false);
setHomeRouteVisible(true);
assert.equal(isHomeRouteVisible(), true);
assert.equal(visibilityNotifications, 1, "cold-start parent visibility publication must wake Home");
unsubscribe();

const homeSource = readFileSync(new URL("../src/routes/_app.index.tsx", import.meta.url), "utf8");
assert.match(homeSource, /useSyncExternalStore\([\s\S]*subscribeHomeRouteVisible/);
assert.match(homeSource, /\[HOME_NEARBY_REQUEST_DISPATCH\]/);
assert.match(homeSource, /\[HOME_NEARBY_REQUEST_DONE\]/);
assert.match(homeSource, /\[HOME_NEARBY_REQUEST_ERROR\]/);
assert.match(homeSource, /\[HOME_NEARBY_LOADING_CLEAR\]/);
assert.match(homeSource, /safeSessionNearbyBootPicks/, "only geographically validated fresh cache renders at boot");

console.info("verify-home-nearby-loading-state: ok");
