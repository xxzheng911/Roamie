#!/usr/bin/env node
// Retain an actual pending match snapshot across loader completion, redirects,
// invalidation and background revalidation. A React render may still own it.
import assert from "node:assert/strict";
process.env.NODE_ENV = "test";
const { createRootRoute, createRoute, createRouter, createMemoryHistory, redirect } =
  await import("@tanstack/react-router");

const snapshots = [];
let router;
let loads = 0;
let hold;
const root = createRootRoute({
  loader: () => {
    loads++;
    snapshots.push(
      router.getMatch(router.state.matches[0]?.id || router.stores.pendingMatches.get()[0].id),
    );
    return hold;
  },
});
const login = createRoute({ getParentRoute: () => root, path: "/login" });
const saved = createRoute({
  getParentRoute: () => root,
  path: "/saved",
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});
router = createRouter({
  routeTree: root.addChildren([login, saved]),
  history: createMemoryHistory({ initialEntries: ["/saved"] }),
  isServer: false,
  origin: "http://localhost",
  defaultPendingMinMs: 0,
});
await router.load();
assert.equal(router.state.location.pathname, "/login");
assert.ok(router.state.matches.every((m) => m.status === "success"));
assert.ok(snapshots.length > 0);
const stale = snapshots.find((m) => m.status === "pending");
assert.ok(stale, "must exercise an older pending snapshot, not just success state");
assert.equal(
  typeof stale._nonReactive.loadPromise?.then,
  "function",
  "pending render must retain a thenable",
);
assert.equal(stale._nonReactive.loadPromise.status, "resolved");
const previous = stale._nonReactive.loadPromise;
await router.invalidate({ sync: true });
assert.ok(loads >= 2, "invalidation still runs loader");
const current = router.state.matches[0];
assert.notEqual(current._nonReactive.loadPromise, previous, "next cycle replaces settled promise");
assert.equal(current._nonReactive.loadPromise.status, "resolved");
assert.ok(router.state.matches.every((m) => m.status === "success"));
console.log("PASS router pending snapshot, redirect, settled thenable and subsequent invalidation");

let release;
hold = new Promise((resolve) => {
  release = resolve;
});
await router.invalidate();
const background = router.state.matches[0];
assert.equal(background.status, "success", "background revalidation preserves usable data");
const pending = background._nonReactive.loadPromise;
assert.equal(pending.status, "pending");
release();
await pending;
assert.equal(background._nonReactive.loadPromise.status, "resolved");
assert.equal(typeof background._nonReactive.loadPromise.then, "function");
console.log("PASS background revalidation settles and retains a reusable thenable");
