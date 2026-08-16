#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolveHomeNearbyViewState } from "../src/lib/home-nearby-view-state.ts";

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

console.info("verify-home-nearby-loading-state: ok");
