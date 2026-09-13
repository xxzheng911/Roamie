import assert from "node:assert/strict";
import fs from "node:fs";

const mapSource = fs.readFileSync("src/routes/_app.map.tsx", "utf8");
const guardSource = fs.readFileSync("src/lib/places-api-guard.ts", "utf8");
const loaderSource = fs.readFileSync("src/lib/google-maps-loader.ts", "utf8");
const googleMapSource = fs.readFileSync("src/components/GoogleMap.tsx", "utf8");
const appInitSource = fs.readFileSync("src/lib/app-init-handlers.ts", "utf8");
const earlyErrorSource = fs.readFileSync("src/lib/log-error.ts", "utf8");

assert.match(mapSource, /if \(!networkOnline\)[\s\S]*?setError\(t\("map\.offline"\)\)[\s\S]*?return;/);
assert.match(mapSource, /subscribeBrowserConnectivity/);
assert.match(mapSource, /setSearchTrigger\(\(value\) => value \+ 1\)/);
assert.match(mapSource, /isNetworkFailureError\(e\)/);
assert.match(mapSource, /EXPLORE_NETWORK_UNAVAILABLE/);
assert.match(guardSource, /if \(!shouldRetryPlacesFailure\(error\)\) break;/);
assert.doesNotMatch(guardSource, /void import\([^\n]+\)\.then\([\s\S]{0,180}?\);/);

// Offline before mount: Explore never mounts the Maps renderer/script loader.
assert.match(mapSource, /geoReady && networkOnline && !mapUnavailable/);
// A failed transport attempt must be removable/retryable rather than permanently cached.
assert.match(loaderSource, /if \(navigator\.onLine === false\)/);
assert.match(loaderSource, /loadPromise = null/);
assert.match(loaderSource, /retryAfterNetworkRecovery && navigator\.onLine !== false/);
assert.match(loaderSource, /return loadGoogleMapsApi\(false\)/);
assert.match(loaderSource, /data-roamie-maps-state="failed"/);
assert.match(loaderSource, /s\.remove\(\)/);
assert.match(loaderSource, /GoogleMapsNetworkError/);
assert.match(googleMapSource, /reportError\(msg, isGoogleMapsNetworkError\(e\)\)/);
// Only the known offline Google Maps resource error bypasses global fatal escalation.
for (const source of [appInitSource, earlyErrorSource]) {
  assert.match(source, /dataset\.roamieMaps/);
  assert.match(source, /navigator\.onLine === false/);
}
assert.match(appInitSource, /showCapacitorFatalOverlay\("APP_INIT_ERROR"/);

console.log("Explore offline request, Maps loader recovery, and fatal isolation regression: PASS");
