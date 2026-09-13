import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveHomeTripHydrationAction } from "../src/lib/home-trip-hydration.ts";

for (const locationPermission of ["granted", "denied", "not_determined"]) {
  assert.equal(
    resolveHomeTripHydrationAction(false, "authenticated-user"),
    "load",
    `saved trip hydration must load when location is ${locationPermission}`,
  );
}

assert.equal(resolveHomeTripHydrationAction(true, "authenticated-user"), "wait");
assert.equal(resolveHomeTripHydrationAction(false, null), "clear");

const home = await readFile("src/routes/_app.index.tsx", "utf8");
assert.match(home, /const userId = authenticatedUser\?\.id;/);
assert.match(home, /resolveHomeTripHydrationAction\(authLoading, userId\)/);
assert.match(home, /\[authLoading, authenticatedUser\?\.id, refreshLatestTrip\]/);

const hydrationEffect = home.slice(
  home.indexOf("const action = resolveHomeTripHydrationAction"),
  home.indexOf(
    "const onRuntimeCache",
    home.indexOf("const action = resolveHomeTripHydrationAction"),
  ),
);
assert.doesNotMatch(hydrationEffect, /effectiveLocation|locationPermission|userLocation/);

console.log("home trip location independence regression: PASS");
