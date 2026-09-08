import assert from "node:assert/strict";
import { createLatestRequestGuard } from "../src/lib/latest-request-guard";

const guard = createLatestRequestGuard();
const applied = [];
let loading = false;
const begin = (scope) => {
  loading = true;
  return guard.begin(scope);
};
const complete = (token, value) => {
  if (!guard.isCurrent(token)) return;
  applied.push(value);
  loading = false;
};

const requestA = begin("user-a");
const requestB = begin("user-a");
complete(requestB, "B");
complete(requestA, "A");
assert.deepEqual(applied, ["B"]);

const mutationA = begin("user-a");
const mutationB = begin("user-a");
complete(mutationA, "stale-add");
assert.equal(loading, true, "a stale finally must not clear the latest loading state");
complete(mutationB, "latest-remove");
assert.equal(loading, false);
assert.equal(applied.at(-1), "latest-remove");

const oldAccount = begin("user-a");
const newAccount = begin("user-b");
complete(oldAccount, "user-a-data");
complete(newAccount, "user-b-data");
assert.equal(applied.at(-1), "user-b-data");

const unmounted = begin("user-b");
guard.invalidate();
complete(unmounted, "after-unmount");
assert.notEqual(applied.at(-1), "after-unmount");

console.log("verify-favorites-refresh-race: ok");
