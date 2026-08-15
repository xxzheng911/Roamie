import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  consumeAdminReturn,
  hasPendingAdminReturn,
  isAdminAuthBoundaryRoute,
  isAdminRoute,
  stashAdminReturn,
} from "../src/lib/admin/admin-route-boundary.ts";

assert.equal(isAdminRoute("/admin"), true);
assert.equal(isAdminRoute("/admin/users"), true);
assert.equal(isAdminRoute("/administrator"), false);
assert.equal(isAdminRoute("/welcome"), false);
assert.equal(isAdminAuthBoundaryRoute("/login", true), true);
assert.equal(isAdminAuthBoundaryRoute("/auth/callback", true), true);
assert.equal(isAdminAuthBoundaryRoute("/login", false), false);
assert.equal(isAdminAuthBoundaryRoute("/welcome", true), false);

const storage = new Map();
const originalWindow = globalThis.window;
globalThis.window = {
  sessionStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};
assert.equal(hasPendingAdminReturn(), false);
stashAdminReturn();
assert.equal(hasPendingAdminReturn(), true);
assert.equal(consumeAdminReturn(), "/admin");
assert.equal(hasPendingAdminReturn(), false);
globalThis.window = originalWindow;

const rootRoute = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const adminRoute = await readFile(new URL("../src/routes/admin.tsx", import.meta.url), "utf8");
const loginRoute = await readFile(new URL("../src/routes/login.tsx", import.meta.url), "utf8");
const callbackRoute = await readFile(
  new URL("../src/routes/auth.callback.tsx", import.meta.url),
  "utf8",
);

assert.match(rootRoute, /isAdminAuthBoundaryRoute\(path\)/);
assert.match(rootRoute, /path === "\/welcome" \|\| path === "\/onboarding"/);
assert.match(app, /if \(isAdminPage\)/);
assert.match(app, /if \(isAdminBoundary\)/);
assert.match(app, /<OnboardingGate>/, "ordinary app routes must retain onboarding");
assert.match(loginRoute, /hasPendingAdminReturn\(\)/);
assert.match(callbackRoute, /consumeAdminReturn\(\)/);
assert.match(adminRoute, /載入中…/);
assert.match(adminRoute, /請先登入 Roamie 後再開啟管理後台。/);
assert.match(adminRoute, /此帳號沒有管理員權限/);
assert.match(adminRoute, /管理後台暫時無法載入/);
assert.match(adminRoute, /Authorization: `Bearer \$\{session\.access_token\}`/);

console.info("[verify-admin-route-boundary] all checks passed");
