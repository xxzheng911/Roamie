import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), "utf8");

const [app, plan, chat, router, bridge, native] = await Promise.all([
  read("src/routes/_app.tsx"),
  read("src/routes/_app.plan.tsx"),
  read("src/routes/_app.chat.tsx"),
  read("src/router.tsx"),
  read("src/lib/ios-snapshot-bridge.ts"),
  read("ios/App/App/RoamieWebKitMitigation.swift"),
]);

assert.match(plan, /to:\s*["']\/chat["']/, "planning handoff must use canonical /chat route");
assert.match(app, /<Outlet\s*\/>/, "app shell must render one route outlet");
assert.equal((app.match(/<BottomNav\b/g) ?? []).length, 1, "app shell must render one BottomNav");
assert.match(
  chat,
  /messenger-chat-root[^"\n]*\bh-full\b[^"\n]*\bbg-background\b/,
  "chat route must fill and opaquely cover the app content viewport",
);
assert.match(router, /requestIosRouteSnapshotRefresh\(path\)/);
assert.match(bridge, /requestAnimationFrame[\s\S]*requestAnimationFrame[\s\S]*route:\$\{reason\}/);
assert.match(native, /let isResolvedRouteSnapshot = reason\.hasPrefix\("route:"\)/);
assert.match(native, /if !isResolvedRouteSnapshot, let existing = lastMirrorImage\(\)/);

const routeFiles = (await readdir(path.join(root, "src/routes"))).filter((name) =>
  name.endsWith(".tsx"),
);
let bottomNavRenderCount = 0;
for (const file of routeFiles) {
  const source = await read(`src/routes/${file}`);
  bottomNavRenderCount += (source.match(/<BottomNav\b/g) ?? []).length;
}
assert.equal(bottomNavRenderCount, 1, "route tree must not contain a nested/duplicate BottomNav");

console.log("planning chat shell regression: PASS");
