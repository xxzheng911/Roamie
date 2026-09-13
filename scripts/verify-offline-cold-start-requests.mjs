import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const credits = await readFile("src/lib/credits/account.ts", "utf8");
assert.match(credits, /try \{[\s\S]*await supabase\.rpc\("credits_get_account"\)/);
assert.match(credits, /catch \(error\)[\s\S]*return memorySnapshot/);

const favorites = await readFile("src/lib/places-storage.ts", "utf8");
assert.match(
  favorites,
  /if \(isNetworkFailureError\(error\)\) throw error/,
);

const home = await readFile("src/routes/_app.index.tsx", "utf8");
assert.match(home, /Offline background personalization is never Home render authority/);
assert.match(home, /cachedResult\.trip/);
assert.doesNotMatch(home, /catch[^}]*setLatestTrip\(null\)/);

const providers = await readFile("src/providers/AppProviders.tsx", "utf8");
assert.match(providers, /hydrateAppBootCachesAsync\(userId\)\.catch/);

const analytics = await readFile("src/providers/AnalyticsProvider.tsx", "utf8");
assert.match(analytics, /getAnalyticsService\(\)\.init\(\)\.catch/);

console.log("Offline cold-start feature request containment regression: PASS");
