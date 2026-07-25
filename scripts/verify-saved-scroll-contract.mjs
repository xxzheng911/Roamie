import assert from "node:assert/strict";
import { appContentWrapperClass, isMainScrollLockedPath } from "../src/lib/app-scroll-contract.ts";

for (const path of ["/", "/saved", "/saved/", "/settings", "/recommendations"]) {
  assert.equal(isMainScrollLockedPath(path), false, `${path} must use main.app-scroll`);
}

for (const path of [
  "/chat",
  "/map",
  "/plan",
  "/place",
  "/profile",
  "/travel-drafts",
  "/saved/11111111-1111-4111-8111-111111111111",
]) {
  assert.equal(isMainScrollLockedPath(path), true, `${path} must retain page-owned scrolling`);
}

const mainScrollContent = appContentWrapperClass(false);
assert.match(mainScrollContent, /min-h-full/);
assert.match(mainScrollContent, /shrink-0/);
assert.doesNotMatch(mainScrollContent, /overflow-hidden/);
assert.doesNotMatch(mainScrollContent, /flex-1/);

const lockedContent = appContentWrapperClass(true);
assert.match(lockedContent, /min-h-0/);
assert.match(lockedContent, /flex-1/);
assert.match(lockedContent, /overflow-hidden/);

console.log("verify-saved-scroll-contract: OK");
