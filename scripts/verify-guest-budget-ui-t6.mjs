import "./verify-netguard-full.mjs";
/**
 * T6 part 2 (tester): what a guest sees when the Worker denies Google with
 * HTTP 429 {"error":"rate_limited","reason":"guest_global_budget_limited"}, compared with
 * the existing global_budget_limited denial. Runs the REAL client-side mapping modules
 * (no React render: the repo has no vitest / jsdom / testing-library).
 * Every entry is traced as far as a node process can go: reason mapper -> per-surface
 * classifier -> the localized copy that the component renders.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-guest-budget-ui-t6.mjs
 */
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug", "error"]) console[k] = () => {};
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const GUEST_BODY = { error: "rate_limited", reason: "guest_global_budget_limited" };
const GLOBAL_BODY = { error: "rate_limited", reason: "global_budget_limited" };
const LOCALES = ["zh-TW", "en", "ja", "ko"];
// places.functions.ts:221-231 parseGoogleError + :424 throw (re-derived: parseGoogleError is not exported).
const reasonMod = await load("src/lib/places-failure-reason.ts");
const parseGoogleError = (text) => {
  try {
    const j = JSON.parse(text);
    const r = reasonMod.fixedPlacesFailureReason(j);
    if (r) return r;
    if (j.error?.message) return `${j.error.status ?? "ERROR"}: ${j.error.message}`;
  } catch { /* ignore */ }
  return text.slice(0, 200);
};
const KIND = { guest: GUEST_BODY, global: GLOBAL_BODY };
const searchMsg = (k) => `places_http_429:${parseGoogleError(JSON.stringify(KIND[k]))}`;

const issues = [];
const rows = [];
const row = (entry, layer, k, value) => rows.push(`  [${entry}] ${k.padEnd(6)} ${layer}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
const RAW = /\{|\}|"error"|rate_limited|budget_limited|cooldown|places_http|_skipped/;
const userText = (entry, k, loc, text) => {
  row(entry, `UI text ${loc}`, k, text);
  if (!text || RAW.test(text)) issues.push(`${entry} ${k} ${loc}: user-visible text looks raw/empty: ${JSON.stringify(text)}`);
};

// 0) server body -> error text the client code throws
for (const k of ["guest", "global"]) {
  row("server->client", "fixedPlacesFailureReason(body)", k, reasonMod.fixedPlacesFailureReason(KIND[k]) ?? "undefined");
  row("server->client", "places.functions throw message", k, searchMsg(k));
  row("server->client", "fixedPlacesFailureReason(message)", k, reasonMod.fixedPlacesFailureReason(searchMsg(k)) ?? "undefined");
}

// 1) unified search (Explore search / category, Home nearby, chat category all call createUnifiedSearchPlacesFn)
const guard = await load("src/lib/places-api-guard.ts");
const unified = await load("src/lib/places-search-unified.ts");
const normalize = await load("src/lib/places-search-normalize.ts");
for (const k of ["guest", "global"]) {
  // (a) client cooldown active (the 429 was seen by this JS context): places-search-unified.ts:122-126
  guard.notePlacesRateLimited({ retryAfterMs: 60_000 });
  let serverCalls = 0;
  const fn = unified.createUnifiedSearchPlacesFn(async () => { serverCalls += 1; throw new Error(searchMsg(k)); });
  const r = await fn({ data: { query: `t6 probe ${k}`, mode: "text", lat: 35.68, lng: 139.76, radius: 1000, locale: "en", placesScreen: "explore", placesCaller: "map.freeTextSearch", categoryId: "search" } });
  row("unified(rate-limited)", "result", k, { places: r.places.length, error: r.error, reason: r.reason ?? null, serverCalls });
  // (b) Saved Trip add place: unified returns the server error as-is (places-search-unified.ts:115-117)
  const fn2 = unified.createUnifiedSearchPlacesFn(async () => { throw new Error(searchMsg(k)); });
  const r2 = await fn2({ data: { query: `t6 trip ${k}`, mode: "text", lat: 35.68, lng: 139.76, radius: 1000, locale: "en", placesScreen: "chat", placesCaller: "chat.fetchNearbyPlacesForIntent.trip_add_place", categoryId: "search" } });
  row("unified(trip_add_place)", "result", k, { places: r2.places.length, error: r2.error, reason: r2.reason ?? null });
  rows.push("");
  // (c) client fallback when this JS context has no cooldown yet: runClientSearch catch -> normalizePlacesSearchResult
  const fb = normalize.normalizePlacesSearchResult({ places: [], error: searchMsg(k) });
  row("unified(client fallback catch)", "normalizePlacesSearchResult", k, fb);
}

// 2) Home nearby: home-nearby-search.ts:814 throws the first provider failure; _app.index.tsx:854-888 -> "error" state
const homeRetry = await load("src/lib/home-nearby-transient-retry.ts");
const messages = (await load("src/lib/i18n/messages.ts"));
const msgTable = messages.i18nMessages ?? null;
for (const k of ["guest", "global"]) {
  row("home nearby", "classifyHomeNearbyFailure(throw msg)", k, homeRetry.classifyHomeNearbyFailure(searchMsg(k)));
  row("home nearby", "classifyHomeNearbyFailure(cooldown_skipped)", k, homeRetry.classifyHomeNearbyFailure("cooldown_skipped"));
}
for (const loc of LOCALES) {
  const t = msgTable?.[loc]?.home;
  const text = t ? `${t.nearbyEmpty} [${t.nearbyRetry}]` : "(messages table not exported)";
  for (const k of ["guest", "global"]) userText("home nearby", k, loc, text);
}

// 3) Saved Trip add place: trip-add-place-outcome.ts:25-45
const trip = await load("src/lib/trip/trip-add-place-outcome.ts");
for (const k of ["guest", "global"]) {
  const f1 = trip.tripSearchFailure(new Error(searchMsg(k)));
  const f2 = trip.tripSearchFailure({ places: [], error: searchMsg(k) });
  row("trip add place", "tripSearchFailure(Error)", k, f1.outcome);
  row("trip add place", "tripSearchFailure(result)", k, f2.outcome);
  for (const loc of LOCALES) userText("trip add place", k, loc, trip.tripSearchOutcomeCopy(f1.outcome, loc));
}

// 4) Explore map: _app.map.tsx:1084/1111 keeps emptyError only for logs; 1213-1218 setError(null); list shows uiCoverage.noResults (:2270)
const uiCov = await load("src/lib/i18n/ui-coverage.ts");
const covTable = uiCov.uiCoverageMessages ?? null;
for (const loc of LOCALES) {
  const text = covTable?.[loc]?.noResults ?? "(ui-coverage table not exported)";
  for (const k of ["guest", "global"]) userText("explore search/category", k, loc, text);
}

// 5) Destination geocode: destination-geocode-client.ts:128-214 with the 429 JSON body
const provider = await load("src/lib/ai/destination-provider-result.ts");
for (const k of ["guest", "global"]) {
  const n = provider.normalizeDestinationProviderResponse(KIND[k], { provider: "geocode", query: "Tokyo", httpStatus: 429 });
  row("destination geocode", "normalizeDestinationProviderResponse", k, { ok: n.ok, status: n.status, failureReason: n.failureReason, httpStatus: n.httpStatus });
}

// 6) Chat category / discovery: discovery-search-scope + combination-discovery-trace
const scope = await load("src/lib/ai/discovery-search-scope.ts");
const trace = await load("src/lib/ai/combination-discovery-trace.ts");
for (const k of ["guest", "global"]) {
  const e = new Error(searchMsg(k));
  const cls = scope.classifyDiscoverySearch(e, true);
  const reason = scope.discoverySearchFailureReason(e, cls);
  row("chat category/discovery", "classify/reason/discoveryFailure", k, { cls, reason, discoveryFailure: trace.discoveryFailure(reason) });
}

out("==== T6 part 2: guest_global_budget_limited vs global_budget_limited ====");
out(rows.join("\n"));
out(`\nNOTE photo / place detail are traced by reading only (img onError -> default image; places_details_http_429 -> fixed copy).`);
out(`\nISSUES ${issues.length}:\n  ${issues.join("\n  ")}`);
out(issues.length ? `FAIL ${issues.length}` : "PASS all");
process.stdout.write("", () => process.exit(issues.length ? 1 : 0));
