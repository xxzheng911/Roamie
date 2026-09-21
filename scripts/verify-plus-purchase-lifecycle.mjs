import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createSubscriptionConfigurationAuthority } from "../src/services/subscription/configuration-authority.ts";
import { classifyPurchaseError } from "../src/services/subscription/purchase-outcome.ts";
import { withSubscriptionTimeout } from "../src/lib/subscription/async-timeout.ts";
import { statusFromRevenueCatCustomerInfo } from "../src/services/subscription/revenuecat-customer-info.ts";

// Load the real adapter with only its native/network boundaries replaced. No StoreKit call or network.
function isolatedModule(path, dependencies) {
  const output = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const exports = {};
  new Function("require", "exports", output)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const free = {
  tier: "free",
  isActive: false,
  expiresAt: null,
  productId: null,
  willRenew: false,
  source: "revenuecat",
};
const plus = { ...free, tier: "plus", isActive: true };
const info = { entitlements: { active: { premium: { isActive: true, willRenew: true } } } };
const monthly = {
  identifier: "$rc_monthly",
  product: {
    identifier: "roamie_premium_monthly",
    priceString: "NT$90",
    title: "Monthly",
    description: "",
  },
};
const annual = {
  ...monthly,
  identifier: "$rc_annual",
  product: { ...monthly.product, identifier: "roamie_premium_yearly" },
};
function nativeHarness() {
  const configure = deferred();
  const reconciliation = deferred();
  let offerings = { current: { availablePackages: [monthly, annual] } };
  let nativeError;
  const calls = [];
  let identity = null;
  const Purchases = {
    configure: async ({ appUserID }) => {
      calls.push("configure");
      await configure.promise;
      identity = appUserID;
    },
    logIn: async ({ appUserID }) => {
      identity = appUserID;
      calls.push(`login:${appUserID}`);
    },
    logOut: async () => {
      identity = null;
      calls.push("logout");
    },
    syncPurchases: async () => {
      calls.push("reconcile");
      await reconciliation.promise;
    },
    getOfferings: async () => {
      calls.push(`offerings:${identity}`);
      return offerings;
    },
    getCustomerInfo: async () => {
      calls.push("status");
      return { customerInfo: info };
    },
    purchasePackage: async () => {
      if (nativeError) throw nativeError;
      return { customerInfo: info };
    },
    restorePurchases: async () => ({ customerInfo: info }),
    getAppUserID: async () => ({ appUserID: identity }),
  };
  const { revenueCatAdapter: adapter } = isolatedModule("src/services/subscription/index.ts", {
    "@capacitor/core": { Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true } },
    "@/constants/env": {
      clientEnv: { revenueCatAppleKey: "test-only-placeholder", billingEnabled: true },
    },
    "@/services/subscription/tiers": { defaultFreeStatus: () => free, readLocalUsage: () => ({}) },
    "./configuration-authority": { createSubscriptionConfigurationAuthority },
    "./revenuecat-customer-info": { statusFromRevenueCatCustomerInfo },
    "./purchase-outcome": { classifyPurchaseError },
    "@/lib/subscription/async-timeout": {
      withSubscriptionTimeout,
      SUBSCRIPTION_OFFERINGS_TIMEOUT_MS: 15,
    },
    "@revenuecat/purchases-capacitor": { Purchases },
  });
  return {
    adapter,
    calls,
    configure,
    reconciliation,
    setOfferings: (next) => {
      offerings = next;
    },
    setError: (next) => {
      nativeError = next;
    },
  };
}
let concurrentIdentityChanges = 0;
const simultaneous = createSubscriptionConfigurationAuthority(async () => {
  assert.ok(
    ++concurrentIdentityChanges <= 3,
    "simultaneous identities must not reconfigure each other indefinitely",
  );
});
assert.deepEqual(
  await Promise.all([
    simultaneous.runForIdentity("A", async () => "A"),
    simultaneous.runForIdentity("B", async () => "B"),
    simultaneous.runForIdentity("A", async () => "A"),
  ]),
  ["A", "B", "A"],
);
assert.equal(concurrentIdentityChanges, 3);

const identityEvents = [];
let failSwitch = true;
const identityAuthority = createSubscriptionConfigurationAuthority(async (id) => {
  identityEvents.push(id);
  if (id === "B" && failSwitch) throw new Error("login_failed");
});
await identityAuthority.ensureConfigured("A");
await assert.rejects(identityAuthority.ensureConfigured("B"), /login_failed/);
await identityAuthority.ensureConfigured("A");
assert.deepEqual(
  identityEvents,
  ["A", "B", "A"],
  "failed login invalidates the old configured identity",
);
const logoutGate = deferred();
const clearing = identityAuthority.clearConfiguredIdentity(() => logoutGate.promise);
let oldIdentityReady = false;
const oldIdentity = identityAuthority.ensureConfigured("A").then(() => {
  oldIdentityReady = true;
});
await tick();
assert.equal(oldIdentityReady, false, "same identity cannot bypass an in-flight logout");
logoutGate.resolve();
await Promise.all([clearing, oldIdentity]);

for (const code of [1, "1"]) assert.equal(classifyPurchaseError({ code }), "cancelled");
for (const code of [20, "20"]) assert.equal(classifyPurchaseError({ code }), "pending");
assert.equal(classifyPurchaseError({ userCancelled: true }), "cancelled");
assert.equal(classifyPurchaseError({ code: "PAYMENT_PENDING_ERROR" }), "pending");
for (const error of [null, {}, { code: "10" }, new Error("failure")])
  assert.equal(classifyPurchaseError(error), "failure");

const native = nativeHarness();
const first = native.adapter.getPackages("A");
await tick();
assert.deepEqual(native.calls, ["configure"], "offerings never precedes configure");
// Wait beyond the shortened offerings deadline: configuration has its own phase.
await new Promise((resolve) => setTimeout(resolve, 25));
native.configure.resolve();
assert.equal((await first).length, 2);
const reconcile = native.adapter.reconcile("A");
await tick();
assert.equal(
  (await native.adapter.getPackages("A")).length,
  2,
  "same-user reconciliation does not block offerings",
);
const switching = native.adapter.configure("B");
await tick();
assert.ok(!native.calls.includes("login:B"), "identity switch waits for receipt reconciliation");
native.reconciliation.resolve();
await Promise.all([reconcile, switching]);
await assert.rejects(
  native.adapter.purchase("$rc_monthly", "B"),
  /package_not_loaded/,
  "A packages cannot be purchased as B",
);
for (const packages of [
  [],
  [monthly],
  [annual],
  [monthly, annual],
  [monthly, { ...annual, identifier: "custom" }],
]) {
  native.setOfferings({ current: { availablePackages: packages } });
  const result = await native.adapter.getPackages("B");
  assert.equal(result.length, packages.length);
  if (result.length) assert.equal(result[0].priceString, "NT$90");
}
native.setOfferings({ current: null });
assert.deepEqual(await native.adapter.getPackages("B"), []);
const late = deferred();
native.setOfferings(late.promise);
await assert.rejects(native.adapter.getPackages("B"), /offerings_timeout/);
native.setOfferings({ current: { availablePackages: [monthly] } });
await native.adapter.getPackages("B");
late.resolve({ current: { availablePackages: [annual] } });
await tick();
await assert.rejects(
  native.adapter.purchase("$rc_annual", "B"),
  /package_not_loaded/,
  "late timeout response cannot replace package cache",
);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(native.adapter.getPackages("B", aborted.signal));
for (const [code, outcome] of [
  ["1", "cancelled"],
  [1, "cancelled"],
  ["20", "pending"],
  [20, "pending"],
]) {
  native.setError({ code });
  const count = native.calls.length;
  assert.deepEqual(await native.adapter.purchase("$rc_monthly", "B"), { outcome, status: null });
  assert.equal(native.calls.length, count, "cancel/pending does not issue getCustomerInfo");
}
native.setError({ code: "2" });
await assert.rejects(native.adapter.purchase("$rc_monthly", "B"));
native.setError(null);
assert.equal((await native.adapter.purchase("$rc_monthly", "B")).status.isActive, true);
assert.equal((await native.adapter.restore("B")).status.isActive, true);

// Minimal hook scheduler exercises the actual provider, including effects and stale completions.
let userId = "A",
  cursor = 0,
  effects = [],
  slots = [],
  cleanups = [],
  context,
  providerWrites = 0;
const changed = (a, b) =>
  !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
const React = {
  createContext: () => ({ Provider: "Provider" }),
  createElement: (_type, props) => {
    context = props.value;
    return null;
  },
  useState: (initial) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof initial === "function" ? initial() : initial;
    return [
      slots[i],
      (next) => {
        providerWrites++;
        slots[i] = typeof next === "function" ? next(slots[i]) : next;
      },
    ];
  },
  useRef: (initial) => {
    const i = cursor++;
    return (slots[i] ??= { current: initial });
  },
  useMemo: (fn, deps) => {
    const i = cursor++;
    if (changed(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
    return slots[i].value;
  },
  useCallback: (fn, deps) => React.useMemo(() => fn, deps),
  useLayoutEffect: (fn, deps) => {
    const i = cursor++;
    if (changed(slots[i], deps)) {
      slots[i] = deps;
      effects.push(() => {
        cleanups[i]?.();
        cleanups[i] = fn();
      });
    }
  },
};
let providerUsage = { aiChatsToday: 7 };
let providerOfferings = Promise.resolve([]),
  providerStatus = Promise.resolve(free),
  syncResult = { ok: true, active: false };
const adapter = {
  id: "revenuecat",
  configure: async () => {},
  logOut: async () => {},
  addStatusListener: async () => () => {},
  getUsage: async () => providerUsage,
  getStatus: () => providerStatus,
  getPackages: () => providerOfferings,
  purchase: async () => ({ outcome: "success", status: plus }),
  restore: async () => ({ outcome: "success", status: plus }),
};
const { SubscriptionProvider } = isolatedModule("src/providers/SubscriptionProvider.tsx", {
  react: React,
  "@/services/subscription": { createSubscriptionAdapter: () => adapter },
  "@/services/subscription/tiers": {
    readLocalUsage: () => ({}),
    canUseFeature: () => ({ allowed: false }),
  },
  "@/hooks/use-auth": { useAuth: () => ({ user: userId ? { id: userId } : null, loading: false }) },
  "@/lib/subscription/revenuecat-sync": {
    syncRevenueCatEntitlementWithServer: async () => syncResult,
    syncRevenueCatEntitlementAfterRestore: async ({ sync }) => sync(),
    isCanonicalRestoreConfirmed: (active, result) => active && result.ok && result.active,
  },
  "@/lib/subscription/async-timeout": {
    withSubscriptionTimeout,
    SUBSCRIPTION_HYDRATION_TIMEOUT_MS: 25,
  },
});
// JSX classic transform uses React, while source imports named hooks only.
globalThis.React = React;
function render() {
  cursor = 0;
  SubscriptionProvider({ children: null });
  for (const effect of effects.splice(0)) effect();
}
render();
await tick();
render();
assert.equal(context.offeringsState, "idle");
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "empty");
const old = deferred();
providerOfferings = old.promise;
const oldRequest = context.loadOfferings();
await tick();
render();
assert.equal(context.offeringsState, "retrying");
providerOfferings = Promise.resolve([monthly]);
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "success");
old.resolve([annual]);
await oldRequest;
render();
assert.equal(context.packages[0].identifier, "$rc_monthly");
const userA = deferred();
providerOfferings = userA.promise;
const userARequest = context.loadOfferings();
await tick();
userId = null;
render();
userId = "B";
render();
await tick();
render();
userA.reject(new Error("A_error"));
await userARequest;
render();
assert.deepEqual(context.packages, []);
assert.equal(context.offeringsError, null);
providerOfferings = Promise.reject(new Error("offerings_timeout"));
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "timeout");
providerOfferings = Promise.resolve([monthly]);
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "success");
syncResult = { ok: false, active: null, errorCode: "subscription_sync_timeout" };
const purchaseSync = deferred();
const expectedSyncFailure = syncResult;
syncResult = purchaseSync.promise;
providerUsage = { aiChatsToday: 9 };
const inFlightPurchase = context.purchase("$rc_monthly");
await tick();
render();
assert.equal(context.canonicalSyncLoading, true, "canonical sync has a separate busy state");
purchaseSync.resolve(expectedSyncFailure);
const purchased = await inFlightPurchase;
render();
assert.equal(context.canonicalSyncLoading, false);
assert.equal(context.usage.aiChatsToday, 9, "purchase refreshes current usage");
assert.equal(purchased.outcome, "success");
assert.equal(purchased.canonicalSynced, false);
assert.equal(context.purchaseError, null);
assert.equal(context.canonicalSyncError, "subscription_sync_timeout");
// Failed initialization must never become an offerings error; retry recovers.
const savedConfigure = adapter.configure;
adapter.configure = () => new Promise(() => {});
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "idle");
assert.equal(context.initializationError, "subscription_initialization_timeout");
assert.equal(context.offeringsError, null);
adapter.configure = savedConfigure;
providerOfferings = Promise.reject(new Error("network_error"));
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "error");
providerOfferings = Promise.resolve([annual]);
await context.loadOfferings();
render();
assert.equal(context.offeringsState, "success");
// A late CustomerInfo failure cannot overwrite successfully loaded options.
const lateHydration = deferred();
providerStatus = lateHydration.promise;
userId = "C";
render();
await tick();
render();
await context.loadOfferings();
render();
lateHydration.reject(new Error("customer_info_failed"));
await tick();
render();
assert.equal(context.initializationError, "customer_info_failed");
assert.equal(context.offeringsState, "success");
assert.equal(context.offeringsError, null);
assert.equal(context.packages[0].identifier, "$rc_annual");
providerStatus = Promise.resolve(plus);
syncResult = { ok: true, active: true };
providerUsage = { aiChatsToday: 11 };
assert.equal(await context.refresh(), true);
render();
assert.equal(context.canonicalSyncError, null);
assert.equal(context.usage.aiChatsToday, 11, "refresh reloads usage");
providerUsage = { aiChatsToday: 13 };
await context.restore();
render();
assert.equal(context.usage.aiChatsToday, 13, "restore reloads usage");
// Provider status, sync and usage must not cross account generations.
for (const rejects of [false, true]) {
  const pending = deferred();
  adapter.restore = () => pending.promise;
  const operation = context.restore().catch(() => null);
  userId = null;
  render();
  userId = rejects ? "E" : "D";
  render();
  await tick();
  render();
  const before = providerWrites;
  if (rejects) pending.reject(new Error("old account"));
  else pending.resolve({ outcome: "success", status: plus });
  await operation;
  assert.equal(providerWrites, before, "old restore cannot write provider state");
}
const oldSync = deferred();
syncResult = oldSync.promise;
const pendingRefresh = context.refresh();
await tick();
userId = "F";
syncResult = { ok: true, active: false };
providerStatus = Promise.resolve(free);
render();
await tick();
render();
const beforeSync = providerWrites;
oldSync.resolve({ ok: true, active: true });
assert.equal(await pendingRefresh, false);
assert.equal(providerWrites, beforeSync, "old resync cannot write provider state");
const oldUsage = deferred();
adapter.getUsage = () => oldUsage.promise;
const pendingUsage = context.refresh();
await tick();
adapter.getUsage = async () => ({ aiChatsToday: 3 });
userId = "G";
render();
await tick();
render();
const beforeUsage = providerWrites;
oldUsage.resolve({ aiChatsToday: 99 });
await pendingUsage;
render();
assert.equal(context.usage.aiChatsToday, 3);
assert.equal(providerWrites, beforeUsage, "old usage cannot overwrite new account refresh");
const purchaseReject = deferred(),
  restoreReject = deferred();
adapter.purchase = () => purchaseReject.promise;
adapter.restore = () => restoreReject.promise;
const pendingPurchase = context.purchase("monthly").catch(() => null);
const pendingRestore = context.restore().catch(() => null);
for (const cleanup of cleanups) cleanup?.();
const beforeUnmount = providerWrites;
purchaseReject.reject(new Error("unmounted"));
restoreReject.reject(new Error("unmounted"));
await Promise.all([pendingPurchase, pendingRestore]);
assert.equal(providerWrites, beforeUnmount, "no provider setters after unmount");
delete globalThis.React;

// The real client sync includes both session acquisition and body parsing in its deadline.
let session = Promise.resolve({
  data: { session: { user: { id: "B" }, access_token: "test-token" } },
});
const realFetch = globalThis.fetch;
let http = async () => ({ ok: true, json: async () => ({ active: true }) });
let fetchCalls = 0;
globalThis.fetch = (...args) => {
  fetchCalls++;
  return http(...args);
};
const syncModule = isolatedModule("src/lib/subscription/revenuecat-sync.ts", {
  "@/lib/supabase": { supabase: { auth: { getSession: () => session } } },
  "@/lib/api-url": { resolveApiUrl: () => "https://test.invalid/sync", isApiUrlError: () => false },
  "./async-timeout": {
    withSubscriptionTimeout: (operation, _timeout, code) =>
      withSubscriptionTimeout(operation, 15, code),
  },
});
try {
  assert.equal((await syncModule.syncRevenueCatEntitlementWithServer("B")).active, true);
  assert.equal(
    (await syncModule.syncRevenueCatEntitlementWithServer("A")).errorCode,
    "subscription_session_missing",
  );
  http = async () => ({ ok: true, json: () => new Promise(() => {}) });
  assert.equal(
    (await syncModule.syncRevenueCatEntitlementWithServer("B")).errorCode,
    "subscription_sync_timeout",
  );
  const lateSession = deferred();
  session = lateSession.promise;
  const count = fetchCalls;
  assert.equal(
    (await syncModule.syncRevenueCatEntitlementWithServer("B")).errorCode,
    "subscription_sync_timeout",
  );
  lateSession.resolve({ data: { session: { user: { id: "B" }, access_token: "test-token" } } });
  await tick();
  assert.equal(fetchCalls, count, "expired session wait cannot send a late request");
  const restoreSync = deferred();
  let restoreAttempts = 0;
  const restoreDeadline = await syncModule.syncRevenueCatEntitlementAfterRestore({
    sync: () => {
      restoreAttempts++;
      return restoreSync.promise;
    },
    wait: async () => {},
  });
  assert.equal(restoreDeadline.errorCode, "subscription_sync_timeout");
  restoreSync.resolve({ ok: true, active: false });
  await tick();
  assert.equal(restoreAttempts, 1, "restore total deadline prevents late retry requests");
} finally {
  globalThis.fetch = realFetch;
}
console.log(
  "Plus purchase lifecycle: PASS (native boundaries, identity, stale requests, state machine, sync deadline)",
);

await import("./verify-plus-purchase-ui-lifecycle.mjs");
