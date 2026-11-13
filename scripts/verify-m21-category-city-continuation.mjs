/**
 * M21 (tester, independent review of M18 round 3).
 *  --section=a  NEW chat category wish → "which city?" → city-only answer, four locales, through REAL modules:
 *               turn 1 = _app.chat.tsx 12706 pending (buildPendingGeographicClarification + categorySearchWord),
 *               turn 2 = 11301 branch (cityOnlyAnswerDestination / isCountryLevelDestination /
 *               buildCityCategoryContinuationText) and the body of pushDestinationCategoryPlaceRecommendation
 *               (6545–6766: mergeTravelContext(turnText) / mergeContextForPlaceFetch / intents /
 *               resolveCategoryTurnDestination("") / validateCategoryTurnDestination / planCategoryTurnClarification /
 *               resolveTrustedContextTurnDestination / resolveTrustedRecommendationSearchScope) and the REAL
 *               buildDestinationCategoryRecommendations with a counting mock searchPlaces / geocode.
 *               Mirror boundary: send() order before 11110 (turn start: applyTripIntentToSession /
 *               prepareSessionForUserTurn are real; the other early branches between 9051 and 11110 are not run),
 *               Credits / setMsgs / persistSession are not run. Everything after "push received (text, intents)" is real.
 *               Baselines (same real builder): B1 = the same wish typed on a session whose destination is already
 *               the city (App: early dispatch push(session, wish) when the route is destination_category);
 *               B2 = round-2 text (wish / buildParentScopeCategoryUserText) with parsed intents.
 *  --section=f  downstream text forms: filterRecommendationsForCategoryRender / filterPlacesByDestinationGuard /
 *               parsePlaceRecommendationIntent / resolveExplicitMealIntent on 「東京海邊」「東京 박물관」「東京 beach」 …
 *  --section=k  resolveGlobalPlanningCandidate keptDays truth table (pure, mock resolve), HEAD compared with --head-dir.
 *  --section=j  Japan (country) → 別府／벳푸／Beppu／京都 through the m16 harness: dated (combos, no date question),
 *               no-date / month-only (days asked). With --head-dir the HEAD total after answering the days is compared.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-m21-category-city-continuation.mjs -- --section=a
 */
import "./verify-netguard-full.mjs";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const section = argv.find((a) => a.startsWith("--section="))?.slice(10) ?? "a";
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 570_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { storageWrites.push(`remove:${k}`); mem.delete(k); }, clear: () => { storageWrites.push("clear"); mem.clear(); }, key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep existing */ }
  try { Object.defineProperty(globalThis, "sessionStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep existing */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const j = (v) => JSON.stringify(v);
const safe = (f) => { try { const v = f(); return v === undefined ? null : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
const R = {};
const failures = [];
const fail = (k, msg) => { failures.push(k); out(`FAIL ${k}: ${msg}`); };
const pass = (k, msg = "") => out(`PASS ${k}${msg ? ` ${msg}` : ""}`);

// ------------------------------------------------------------------ shared geo / places mocks
const GEO = {
  tokyo: { re: /tokyo|東京|도쿄/i, city: "Tokyo", region: "Tokyo", country: "Japan", code: "JP", lat: 35.6762, lng: 139.6503 },
  kyoto: { re: /kyoto|京都|교토/i, city: "Kyoto", region: "Kyoto", country: "Japan", code: "JP", lat: 35.0116, lng: 135.7681 },
  osaka: { re: /osaka|大阪|오사카/i, city: "Osaka", region: "Osaka", country: "Japan", code: "JP", lat: 34.6937, lng: 135.5023 },
  beppu: { re: /beppu|別府|别府|벳푸/i, city: "Beppu", region: "Oita", country: "Japan", code: "JP", lat: 33.2846, lng: 131.4912 },
  taichung: { re: /taichung|台中|臺中/i, city: "Taichung", region: "Taichung", country: "Taiwan", code: "TW", lat: 24.1477, lng: 120.6736 },
};
const keyOf = (q) => Object.keys(GEO).find((k) => GEO[k].re.test(q ?? ""));
const geocodeCalls = [];
const geocodeFn = async ({ data }) => {
  geocodeCalls.push(data.query);
  const k = keyOf(data.query);
  if (!k) return { location: null, error: null, providerResult: { ok: true, rawResultCount: 0 } };
  const d = GEO[k];
  const loc = { placeId: `ChIJ_${d.code}_${d.city}`, country: d.country, city: d.city, region: d.region, lat: d.lat, lng: d.lng, formattedName: d.city, displayLabel: d.city };
  return { location: loc, error: null, providerResult: { ok: true, rawResultCount: 1, placeId: loc.placeId, types: ["locality", "political"], primaryType: "locality", countryCode: d.code, latitude: d.lat, longitude: d.lng } };
};
const placesCalls = [];
/** Returns 10 real-shaped places per query whose types follow includedTypes (city from the query). */
const searchPlaces = async ({ data }) => {
  placesCalls.push({ q: data.query, types: (data.includedTypes ?? []).join(",") });
  const k = keyOf(data.query) ?? "tokyo";
  const d = GEO[k];
  const type = data.includedTypes?.[0] ?? "tourist_attraction";
  const tag = `${type}`.replace(/_/g, " ");
  const places = Array.from({ length: 10 }, (_, i) => ({
    id: `ChIJ${k}${type}${i}${data.query.length}`, name: `${d.city} ${tag} ${i + 1}`, lat: d.lat + i * 0.002, lng: d.lng + i * 0.001,
    types: [type, "point_of_interest", "establishment"], primaryType: type, rating: 4.5, userRatingCount: 3000 + i,
    address: `${i + 1} Chome, ${d.city}, ${d.country}`, formattedAddress: `${i + 1} Chome, ${d.city}, ${d.country}`, businessStatus: "OPERATIONAL",
    city: d.city, sourceLocale: "en",
  }));
  return { places, error: null, rawCount: places.length };
};

// ------------------------------------------------------------------ a) App continuation, real modules
if (["a", "f", "s", "d", "q", "t", "o"].includes(section)) {
  var tpc = await load("src/lib/ai/trip-planning-context.ts");
  var geoClar = await load("src/lib/ai/destination-geographic-clarification.ts");
  var placeIntent = await load("src/lib/ai/chat-place-intent.ts");
  var catDest = await load("src/lib/ai/chat-category-destination.ts");
  var scopeMod = await load("src/lib/ai/destination-scope.ts");
  var travelContext = await load("src/lib/ai/travel-context.ts");
  var mustVisit = await load("src/lib/ai/must-visit-places.ts");
  var turnDestMod = await load("src/lib/ai/chat-turn-destination.ts");
  var catRec = await load("src/lib/ai/chat-destination-category-recommendation.ts");
  var placeRec = await load("src/lib/ai/chat-place-recommendation.ts");
  var sessionMod = await load("src/lib/chat-session.ts");
  var tripIntent = await load("src/lib/recommendation/trip-intent.ts");
  var convState = await load("src/lib/ai/chat-conversation-state.ts");
  var chatIntent = await load("src/lib/ai/chat-intent.ts");
  var nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
  var guard = await load("src/lib/ai/chat-category-place-guard.ts");
  var recParse = await load("src/lib/ai/place-recommendation-intent/parse.ts");
  var resolvedScope = await loadOpt("src/lib/ai/resolved-destination-scope.ts");
  var poolCache = await loadOpt("src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
}
const APP = existsSync("src/routes/_app.chat.tsx") ? readFileSync("src/routes/_app.chat.tsx", "utf8") : "";
const freshCaches = () => { placeRec.resetShortcutProviderOrchestrationForTests?.(); resolvedScope?.clearResolvedDestinationScope?.(); poolCache?.clearCandidatePoolCache?.(); };

/** Real body of pushDestinationCategoryPlaceRecommendation up to buildDestinationCategoryRecommendations. */
async function realPush(activeSession, userText, locale, opts = {}) {
  freshCaches();
  const g0 = geocodeCalls.length; const p0 = placesCalls.length;
  const res = { userText, stop: null };
  if (chatIntent.userExplicitlyWantsNearbyPlaces(userText)) return { ...res, stop: "nearby" };
  const continuation = opts.categoryContinuation?.intents.length ? opts.categoryContinuation : undefined;
  const merged = travelContext.mergeTravelContext(activeSession, continuation?.turnText ?? userText);
  const placeCtx = mustVisit.mergeContextForPlaceFetch(merged.context, activeSession);
  res.mergedDest = merged.context.destination ?? null;
  res.mergedStart = merged.context.startDate ?? null;
  const intents = continuation ? [...continuation.intents] : placeIntent.parseChatPlaceIntents(userText);
  res.intents = intents;
  if (!intents.length) return { ...res, stop: "no_intents" };
  let turnDestination = turnDestMod.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session,
    userText: continuation || tpc.categorySwitchSearchText(userText) ? "" : userText, locale });
  turnDestination = await turnDestMod.validateCategoryTurnDestination(turnDestination, { locale, geocodeFn });
  res.turnDest = turnDestination.destination ?? null;
  const plan = turnDestMod.planCategoryTurnClarification(turnDestination);
  if (plan && opts.fromClarification) return { ...res, stop: `clarification_already_asked(${plan.kind})`, geo: geocodeCalls.slice(g0), places: placesCalls.slice(p0) };
  if (plan) return { ...res, stop: `clarification(${plan.kind})`, geo: geocodeCalls.slice(g0), places: placesCalls.slice(p0) };
  const turnSearchDestination = turnDestination.destination ?? (await turnDestMod.resolveTrustedContextTurnDestination({ ctx: placeCtx, session: merged.session,
    userText: continuation ? "" : userText, locale, geocodeFn }));
  res.searchDest = turnSearchDestination ?? null;
  if (!turnSearchDestination) return { ...res, stop: "no_search_destination", geo: geocodeCalls.slice(g0), places: placesCalls.slice(p0) };
  const trusted = await turnDestMod.resolveTrustedRecommendationSearchScope({ label: turnSearchDestination, ctx: placeCtx, session: merged.session, locale, geocodeFn });
  if (trusted.status !== "trusted") return { ...res, stop: `untrusted(${trusted.reason})`, geo: geocodeCalls.slice(g0), places: placesCalls.slice(p0) };
  res.destination = trusted.destination;
  const built = await catRec.buildDestinationCategoryRecommendations({ destination: trusted.destination, intents, userText, context: { ...placeCtx, destination: trusted.destination },
    locale, searchPlaces: opts.searchPlacesFn ?? searchPlaces, geocodeFn, excludePlaceIds: [], rejectedPlaceNames: [], session: activeSession, userProfile: null, trustedCenter: trusted.center,
    // _app.chat.tsx 6768: ...(continuation?.categoryQueryWord ? { categoryQueryWord } : {})
    ...(continuation?.categoryQueryWord ? { categoryQueryWord: continuation.categoryQueryWord } : {}) });
  res.recs = built.recommendations.length;
  res.recNames = built.recommendations.map((r) => r.name);
  res.recTypes = [...new Set(built.recommendations.map((r) => r.primaryType ?? r.type ?? "?"))].join(",");
  res.geo = geocodeCalls.slice(g0);
  res.places = placesCalls.slice(p0);
  res.summary = (built.summary ?? "").split("\n")[0];
  return res;
}

/** Turn-start chain (real) + 11301 branch (mirror) → push inputs. */
async function continuationTurn(s1, answer, locale, pushOpts = {}) {
  // 9051 turn-start consumption → 10913 applyTripIntentToSession → 11107 prepareSessionForUserTurn.
  let n = tripIntent.applyTripIntentToSession(answer, JSON.parse(JSON.stringify(s1)));
  n = convState.prepareSessionForUserTurn(n, s1.lastAssistantReply);
  const pending = n.pendingClarification ?? s1.pendingClarification;
  n = { ...n, pendingClarification: undefined };
  const row = { answer };
  if (!(pending?.kind === "destination_area" && !pending.rawGeographicLabel.trim() && pending.originalUserText?.trim())) return { ...row, branch: "no_pending" };
  const wishText = pending.originalUserText.trim();
  const answeredCity = geoClar.isPlaceClarificationTripPlanningOverride(answer) ? undefined : tpc.cityOnlyAnswerDestination(answer);
  row.answeredCity = answeredCity ?? null;
  row.country = answeredCity ? scopeMod.isCountryLevelDestination(answeredCity) : null;
  if (!(answeredCity && !scopeMod.isCountryLevelDestination(answeredCity) && tpc.categorySwitchSearchText(wishText))) return { ...row, branch: "general_flow" };
  const sessionForRec = { ...n, pendingClarification: undefined, activeCategoryIntent: pending.categoryIntent,
    travelContext: { ...(n.travelContext ?? { interests: [] }), destination: answeredCity } };
  const continuationText = geoClar.buildCityCategoryContinuationText?.(pending, answeredCity);
  const categoryText = continuationText ?? (placeIntent.parseChatPlaceIntents(wishText).length ? wishText : geoClar.buildParentScopeCategoryUserText(pending, answeredCity));
  row.branch = "11301 continuation";
  row.categoryText = categoryText;
  row.storedWord = pending.categorySearchWord ?? null;
  row.storedIntent = pending.categoryIntent;
  // _app.chat.tsx 11341–11353: categoryQueryWord = pendingGeographic.categorySearchWord (only with continuationText).
  row.push = await realPush(sessionForRec, categoryText, locale, { fromClarification: true, ...pushOpts,
    ...(continuationText ? { categoryContinuation: { intents: [pending.categoryIntent], turnText: wishText, categoryQueryWord: pending.categorySearchWord } } : {}) });
  row.continuationText = continuationText ?? null;
  row.sessionForRec = sessionForRec;
  return row;
}

function turnOne(wish, locale) {
  const s0 = sessionMod.createEmptySession();
  const pc = mustVisit.mergeContextForPlaceFetch(s0.travelContext ?? { interests: [] }, s0);
  const asks = Boolean(tpc.categorySwitchSearchText(wish)) && !catDest.resolveDestinationForCategorySearch(pc, s0, wish);
  const askCity = tpc.buildDestinationPlanningClarify(pc, s0, "destination", locale);
  const s1 = { ...s0, lastAssistantReply: askCity, pendingClarification: geoClar.buildPendingGeographicClarification({ rawGeographicLabel: "",
    categoryIntent: placeIntent.parseChatPlaceIntents(wish)[0] ?? "attraction", originalUserText: wish, categorySearchWord: tpc.categorySwitchSearchText(wish) }) };
  return { asks, s1 };
}

// 博物館 → 「文化景點」 (culture subtype) is accepted as the museum category.
const CAT_WORDS = { 海邊: /海邊|海灘|海|beach|coast|sea/i, 溫泉: /溫泉|温泉|onsen|hot spring|spa/i, 温泉: /溫泉|温泉|onsen|hot spring|spa/i, 泡湯: /溫泉|温泉|泡湯|onsen|hot spring|spa/i,
  博物館: /博物館|museum|文化/i, 美術館: /美術館|museum|art|文化/i, museum: /museum|博物館|文化/i, beach: /beach|海|coast/i, "hot spring": /溫泉|温泉|onsen|hot spring|spa/i,
  박물관: /박물관|museum|博物館|文化/i, 바다: /바다|beach|海|coast|sea/i, 온천: /온천|溫泉|温泉|onsen|hot spring|spa/i, 夜市: /夜市|night market|market/i, 咖啡廳: /咖啡|cafe|café|coffee|カフェ/i,
  購物: /購物|shopping|商店|mall|百貨/i };
/** Task M18 r4 approved continuation queries (order: primary, primary, fallback; all tourist_attraction). */
function expectedContinuationQueries(word, city) {
  const w = (word ?? "").trim();
  const T = "tourist_attraction";
  const mk = (a, b) => [`${city} ${a}@${T}`, `${city} ${b}@${T}`, `${city} ${b} sightseeing@${T}`];
  if (/^(?:海邊|beach|바다)$/i.test(w)) return mk("海灘", "beach");
  if (/^(?:泡湯|溫泉|温泉|hot springs?|온천)$/i.test(w)) return mk("溫泉", "hot springs");
  if (/^美術館$/.test(w)) return mk("美術館", "art museum");
  if (/^(?:박물관|博物館|museums?)$/i.test(w)) return mk("博物館", "museum");
  return null;
}
const wantRe = (word) => { for (const [k, re] of Object.entries(CAT_WORDS)) if ((word ?? "").includes(k)) return re; return null; };

if (section === "a") {
  out(`INFO app source: categorySearchWord=${APP.includes("categorySearchWord: categorySwitchSearchText(trimmed)")} continuationText=${APP.includes("buildCityCategoryContinuationText(pendingGeographic, answeredCity)")} countryGuard=${APP.includes("!isCountryLevelDestination(answeredCity)")}`);
  const CASES = [
    ["zh-TW", "我想去博物館", ["東京", "東京吧", "東京で"]], ["zh-TW", "明天去海邊", ["東京"]], ["zh-TW", "想去泡湯", ["東京"]], ["zh-TW", "我想泡溫泉", ["東京"]],
    ["zh-TW", "我想去夜市", ["東京"]], ["zh-TW", "我想去咖啡廳", ["東京"]], ["zh-TW", "我想去購物", ["東京"]],
    ["en", "I want to go to the beach", ["Tokyo", "Tokyo please"]], ["en", "I want to go to a museum", ["Tokyo"]], ["en", "I want to go to hot springs", ["Tokyo"]],
    ["ja", "美術館に行きたい", ["東京", "東京で"]], ["ja", "温泉に行きたい", ["東京"]],
    ["ko", "박물관에 가고 싶어", ["도쿄", "도쿄요", "도쿄로"]], ["ko", "바다에 가고 싶어", ["도쿄"]], ["ko", "온천에 가고 싶어", ["도쿄"]],
  ];
  const COUNTRY = [["zh-TW", "我想去博物館", "日本"], ["en", "I want to go to the beach", "Japan"], ["ko", "바다에 가고 싶어", "일본"], ["ja", "美術館に行きたい", "日本"]];
  const GENERAL = ["東京 3天", "12/10去東京", "算了", "好", "不知道"];
  const onlyLocales = argv.find((a) => a.startsWith("--locales="))?.slice(10).split(",");
  for (const [locale, wish, answers] of CASES) {
    if (onlyLocales && !onlyLocales.includes(locale)) continue;
    const { asks, s1 } = turnOne(wish, locale);
    const k1 = `a1|${locale}|${wish}`;
    if (!asks) { out(`INFO ${k1}: not a new-chat "ask city" wish (categorySwitchSearchText=${j(tpc.categorySwitchSearchText(wish))}); skipped`); continue; }
    if (!s1.pendingClarification.categorySearchWord) fail(k1, `pending has no categorySearchWord (${j(s1.pendingClarification)})`);
    else pass(k1, `word=${s1.pendingClarification.categorySearchWord} intent=${s1.pendingClarification.categoryIntent}`);
    for (const a of answers) {
      const r = await continuationTurn(s1, a, locale);
      const k = `a2|${locale}|${wish}|${a}`;
      const issues = [];
      const p = r.push ?? {};
      if (r.branch !== "11301 continuation") issues.push(`branch ${r.branch} (city=${r.answeredCity})`);
      else {
        if (p.stop) issues.push(`push stopped: ${p.stop}`);
        if (!/東京|Tokyo/.test(p.destination ?? "")) issues.push(`destination ${p.destination}`);
        if (p.mergedDest && !/東京|Tokyo/.test(p.mergedDest)) issues.push(`merge moved destination to ${p.mergedDest}`);
        const re = wantRe(r.storedWord) ?? wantRe(wish);
        const queries = (p.places ?? []).map((x) => x.q).join(" | ");
        if (!(p.places ?? []).length) issues.push("no Places call");
        if (re && !re.test(queries)) issues.push(`original category lost in Places queries: ${queries}`);
        if (!p.recs) issues.push(`0 recommendations after downstream filters (types ${p.recTypes})`);
        if (j(p.intents) !== j([r.storedIntent])) issues.push(`intents ${j(p.intents)} != stored ${r.storedIntent}`);
      }
      // Baselines on the same city session (destination already set).
      const tripSession = { ...sessionMod.createEmptySession(), travelContext: { interests: [], destination: r.answeredCity ?? "東京" } };
      const tpcCtx = mustVisit.mergeContextForPlaceFetch(tripSession.travelContext, tripSession);
      const route = nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(wish), pendingNearbyLocationRequest: false,
        resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(tpcCtx, wish, tripSession) ?? null, categoryPlaceQuery: placeIntent.shouldFetchDestinationCategoryPlaces(wish, tpcCtx, tripSession) });
      const b1 = route === "destination_category" ? await realPush(tripSession, wish, locale) : { stop: `route=${route}` };
      const b1b = await realPush(tripSession, wish, locale, { categoryContinuation: { intents: [r.storedIntent ?? "attraction"], turnText: wish } });
      // B2: round-2 search text (wish when it parses an intent, else buildParentScopeCategoryUserText) on the same session.
      if (r.sessionForRec) {
        const pend = { ...s1.pendingClarification };
        const r2Text = placeIntent.parseChatPlaceIntents(wish).length ? wish : geoClar.buildParentScopeCategoryUserText(pend, r.answeredCity);
        const b2 = await realPush(r.sessionForRec, r2Text, locale, { fromClarification: true });
        out(`INFO B2 ${locale}|${wish}|${a}: round-2 text 「${r2Text}」 intents=${j(b2.intents)} stop=${b2.stop} places=${(b2.places ?? []).length} recs=${b2.recs ?? 0} q=${j((b2.places ?? []).map((x) => x.q))}`);
      }
      R[k] = { branch: r.branch, city: r.answeredCity, word: r.storedWord, text: r.categoryText, intents: p.intents, stop: p.stop ?? null, dest: p.destination ?? null, merged: p.mergedDest ?? null,
        start: p.mergedStart ?? null, places: (p.places ?? []).length, geo: (p.geo ?? []).length, recs: p.recs ?? 0, queries: (p.places ?? []).map((x) => x.q),
        b1: { route, stop: b1.stop ?? null, places: (b1.places ?? []).length, geo: (b1.geo ?? []).length, recs: b1.recs ?? 0, queries: (b1.places ?? []).map((x) => x.q) },
        b1b: { places: (b1b.places ?? []).length, recs: b1b.recs ?? 0, queries: (b1b.places ?? []).map((x) => x.q) } };
      const x = R[k];
      const line = `${k}\n   W text=「${x.text}」 intents=${j(x.intents)} dest=${x.dest} merged=${x.merged} start=${x.start} places=${x.places} geo=${x.geo} recs=${x.recs} stop=${x.stop}\n     q=${j(x.queries)}`
        + `\n   B1(${x.b1.route}) wish on a ${r.answeredCity} session: places=${x.b1.places} geo=${x.b1.geo} recs=${x.b1.recs} stop=${x.b1.stop} q=${j(x.b1.queries)}`
        + `\n   B1b same wish, stored intent, session dest: places=${x.b1b.places} recs=${x.b1b.recs} q=${j(x.b1b.queries)}`;
      if (x.places > Math.max(x.b1.places, x.b1b.places) && x.b1.places + x.b1b.places > 0) issues.push(`Places ${x.places} > destination baseline ${Math.max(x.b1.places, x.b1b.places)}`);
      // M18 r4 approved mapping (2 primary + 1 fallback, tourist_attraction) vs "same as B1" rows.
      {
        const wishParsed = recParse.parsePlaceRecommendationIntent(wish);
        const sameAsB1 = r.storedIntent !== "attraction" || (wishParsed?.subtypes?.length ?? 0) > 0;
        const exp = expectedContinuationQueries(r.storedWord, p.destination ?? "");
        const sent = (p.places ?? []).map((y) => `${y.q}@${y.types}`);
        if (r.branch === "11301 continuation") {
          if (sameAsB1) {
            if (x.b1.route === "destination_category" && j(x.queries) !== j(x.b1.queries)) issues.push(`queries differ from B1 (same wish on a ${r.answeredCity} trip): W=${j(x.queries)} B1=${j(x.b1.queries)}`);
            else out(`NOTE ${k}: same-as-B1 row (${r.storedIntent}${wishParsed?.subtypes?.length ? ` subtypes=${wishParsed.subtypes}` : ""}) queries ${x.b1.route === "destination_category" ? "== B1" : `B1 route=${x.b1.route}`}`);
          } else if (exp) {
            const prefix = sent.slice(0, exp.length);
            const okPrefix = prefix.every((q, i) => q === exp[i]);
            if (!okPrefix || sent.length > 3) issues.push(`queries ${j(sent)} != approved ${j(exp)}`);
          } else issues.push(`stored word ${r.storedWord} has no approved mapping`);
        }
      }
      if (issues.length) { out(`ISSUE ${line}\n   -> ${issues.join("; ")}`); fail(k, issues.join("; ")); } else pass(line);
      if (/明天/.test(wish) && x.start) out(`NOTE ${k}: wish date carried start=${x.start}`);
    }
  }
  for (const [locale, wish, country] of COUNTRY) {
    const { s1 } = turnOne(wish, locale);
    const r = await continuationTurn(s1, country, locale);
    const k = `a3|${locale}|${wish}|${country}`;
    const bad = r.branch === "11301 continuation";
    R[k] = { branch: r.branch, city: r.answeredCity, country: r.country };
    if (bad) fail(k, `country answer continued the category search (${j(r.push)})`); else pass(k, `branch=${r.branch} city=${r.answeredCity} countryLevel=${r.country}`);
  }
  for (const a of GENERAL) {
    const { s1 } = turnOne("我想去博物館", "zh-TW");
    const r = await continuationTurn(s1, a, "zh-TW");
    const k = `a4|zh-TW|我想去博物館|${a}`;
    if (r.branch === "11301 continuation") fail(k, `continued (${r.categoryText})`); else pass(k, `branch=${r.branch} city=${r.answeredCity}`);
  }
  // Pending valid for one turn: the second answer after 「算了」 sees no pending (turn start consumed it).
  {
    const { s1 } = turnOne("我想去博物館", "zh-TW");
    let n = tripIntent.applyTripIntentToSession("算了", JSON.parse(JSON.stringify(s1)));
    n = { ...convState.prepareSessionForUserTurn(n, s1.lastAssistantReply), pendingClarification: undefined };
    const r = await continuationTurn(n, "東京", "zh-TW");
    if (r.branch === "11301 continuation") fail("a5|one-turn", "pending survived 「算了」"); else pass("a5|one-turn", `branch=${r.branch}`);
  }
  // buildCityCategoryContinuationText table (joins).
  for (const [city, word, want] of [["東京", "海邊", "東京海邊"], ["東京", "박물관", "東京 박물관"], ["東京", "beach", "東京 beach"], ["Tokyo", "museum", "Tokyo museum"], ["東京", "museum", "東京 museum"], ["東京", "温泉", "東京温泉"]]) {
    const got = geoClar.buildCityCategoryContinuationText({ kind: "destination_area", rawGeographicLabel: "", categoryIntent: "attraction", originatingRoute: "destination_category", originalUserText: "x", categorySearchWord: word }, city);
    if (got !== want) fail(`a6|join|${city}+${word}`, `got ${j(got)} want ${j(want)}`); else pass(`a6|join|${city}+${word}`, `→ ${got}`);
  }
  {
    const got = geoClar.buildCityCategoryContinuationText({ kind: "destination_area", rawGeographicLabel: "", categoryIntent: "attraction", originatingRoute: "destination_category", originalUserText: "x" }, "東京");
    if (got !== undefined) fail("a6|no-word", `got ${j(got)}`); else pass("a6|no-word", "→ undefined (old pending without the word keeps round-2 text)");
  }
}

// ------------------------------------------------------------------ f) downstream text forms
if (section === "f") {
  const mkItem = (i, type) => ({ id: `ChIJf${type}${i}`, placeId: `ChIJf${type}${i}`, googlePlaceId: `ChIJf${type}${i}`, name: `Tokyo ${type} ${i}`, placeName: `Tokyo ${type} ${i}`, type,
    primaryType: type, types: [type, "point_of_interest"], lat: 35.67 + i * 0.001, lng: 139.65, address: "Tokyo, Japan", rating: 4.5 });
  const TEXTS = [["東京海邊", "attraction", "tourist_attraction"], ["東京 박물관", "attraction", "museum"], ["東京 beach", "attraction", "tourist_attraction"], ["東京 museum", "attraction", "museum"],
    ["東京溫泉", "attraction", "spa"], ["東京 hot springs", "attraction", "spa"], ["東京美術館", "attraction", "art_gallery"], ["東京 바다", "attraction", "tourist_attraction"], ["東京 온천", "attraction", "spa"],
    ["東京夜市", "night_market", "tourist_attraction"], ["東京咖啡廳", "cafe", "cafe"], ["東京 購物", "shopping", "shopping_mall"], ["東京購物", "shopping", "shopping_mall"]];
  for (const [text, intent, type] of TEXTS) {
    const items = Array.from({ length: 6 }, (_, i) => mkItem(i, type));
    const kept = safe(() => guard.filterRecommendationsForCategoryRender(items, intent, text));
    const bare = text.replace(/^東京\s*/, "");
    const keptBare = safe(() => guard.filterRecommendationsForCategoryRender(items, intent, bare));
    const parsed = safe(() => recParse.parsePlaceRecommendationIntent(text));
    const meal = safe(() => catRec.resolveExplicitMealIntent?.(text));
    const destFromText = safe(() => tpc.parseDestinationFromText(text));
    const k = `f|${text}|${intent}`;
    const issues = [];
    const n = Array.isArray(kept) ? kept.length : kept;
    const nb = Array.isArray(keptBare) ? keptBare.length : keptBare;
    if (n !== nb) issues.push(`render filter kept ${n} vs bare word 「${bare}」 ${nb}`);
    if (n === 0) issues.push("all filtered");
    if (destFromText && !/東京/.test(destFromText)) issues.push(`destination misread as ${destFromText}`);
    const line = `${k} render=${n}/6 bare=${nb}/6 parsed=${j(parsed && { primaryType: parsed.primaryType, subtypes: parsed.subtypes, preferred: parsed.preferredFeatures, destinationName: parsed.destinationName })} meal=${j(meal)} parseDest=${j(destFromText)}`;
    if (issues.length) fail(k, `${issues.join("; ")} | ${line}`); else pass(line);
  }
  // Destination guard: places in Tokyo with the continuation text must survive the destination filter.
  if (typeof catRec.filterPlacesByDestinationGuard === "function" || typeof placeRec.filterPlacesByDestinationGuard === "function") {
    const fn = catRec.filterPlacesByDestinationGuard ?? placeRec.filterPlacesByDestinationGuard;
    const places = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, name: `Tokyo spot ${i}`, address: "Shibuya, Tokyo, Japan", formattedAddress: "Shibuya, Tokyo, Japan", lat: 35.66, lng: 139.7, city: "Tokyo" }));
    for (const t of ["東京海邊", "東京 박물관", "東京 beach", "東京溫泉"]) {
      const kept = safe(() => fn(places, "東京", t));
      const n = Array.isArray(kept) ? kept.length : kept;
      if (n !== 4) fail(`f|destGuard|${t}`, `kept ${j(n)}/4`); else pass(`f|destGuard|${t}`, "4/4");
    }
  } else out("INFO f|destGuard: filterPlacesByDestinationGuard not exported (covered end-to-end by section a recs>0)");
}

// ------------------------------------------------------------------ k) keptDays truth table
if (section === "k") {
  const gp = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod2 = await load("src/lib/chat-session.ts");
  const beppu = { placeId: "ChIJ_JP_Beppu", country: "Japan", city: "Beppu", region: "Oita", lat: 33.28, lng: 131.49, formattedName: "Beppu", displayLabel: "Beppu" };
  const resolve = async () => ({ location: beppu, rawResultCount: 1 });
  const prov = (o = {}) => ({ source: "user_date", confirmed: true, startDate: "2026-12-10", endDate: "2026-12-14", ...o });
  const base = (ctx = {}, cand = {}) => ({ ...sessionMod2.createEmptySession(), travelContext: { interests: [], destination: "日本", destinationType: "country", destinationCountry: "Japan", destinationCountryCode: "JP",
    startDate: "2026-12-10", endDate: "2026-12-14", dateProvenance: prov(), destinationCandidate: { raw: "別府", status: "pending", countryTrip: true, ...cand }, ...ctx } });
  const CASES = [
    ["confirmed user dates (country)", base(), "kept"],
    ["confirmed user dates, days already 5", base({ days: 5 }), "kept"],
    ["month only (travelMonth, no dates, no provenance)", base({ startDate: undefined, endDate: undefined, dateProvenance: undefined, travelMonth: "2026-12" }), "ask"],
    ["month only + month_default provenance", base({ startDate: "2026-12-01", endDate: "2026-12-05", travelMonth: "2026-12", dateProvenance: prov({ source: "month_default", confirmed: false, startDate: "2026-12-01", endDate: "2026-12-05" }) }), "ask"],
    ["month only + month_default confirmed", base({ startDate: "2026-12-01", endDate: "2026-12-05", travelMonth: "2026-12", dateProvenance: prov({ source: "month_default", confirmed: true, startDate: "2026-12-01", endDate: "2026-12-05" }) }), "ask"],
    ["user_date unconfirmed", base({ dateProvenance: prov({ confirmed: false }) }), "ask"],
    ["ai_suggested confirmed", base({ dateProvenance: prov({ source: "ai_suggested" }) }), "ask"],
    ["unknown source", base({ dateProvenance: prov({ source: "unknown" }) }), "ask"],
    ["provenance start differs", base({ dateProvenance: prov({ startDate: "2026-12-11" }) }), "ask"],
    ["provenance end differs", base({ dateProvenance: prov({ endDate: "2026-12-15" }) }), "ask"],
    ["context dates changed, provenance old", base({ startDate: "2026-12-20", endDate: "2026-12-24" }), "ask"],
    ["no provenance, dates present", base({ dateProvenance: undefined }), "ask"],
    ["range 31 days", base({ startDate: "2026-12-01", endDate: "2026-12-31", dateProvenance: prov({ startDate: "2026-12-01", endDate: "2026-12-31" }) }), "ask"],
    ["end before start", base({ startDate: "2026-12-14", endDate: "2026-12-10", dateProvenance: prov({ startDate: "2026-12-14", endDate: "2026-12-10" }) }), "ask"],
    ["start only", base({ endDate: undefined, dateProvenance: prov({ endDate: undefined }) }), "ask"],
    ["city-level trip (東京) + confirmed dates", base({ destination: "東京", destinationType: "city", destinationCity: "Tokyo" }, { countryTrip: false }), "head"],
    ["region-level trip + confirmed dates", base({ destination: "北海道", destinationType: "region" }, { countryTrip: false }), "head"],
    ["no destinationType + confirmed dates", base({ destinationType: undefined }), "head"],
  ];
  for (const [name, s, want] of CASES) {
    const r = await gp.resolveGlobalPlanningCandidate(s, "zh-TW", resolve);
    R[`k|${name}`] = { pending: r.pendingQuestion?.type ?? null, days: r.travelContext?.days ?? null, dest: r.travelContext?.destination ?? null, start: r.travelContext?.startDate ?? null, end: r.travelContext?.endDate ?? null, want };
  }
}

// ------------------------------------------------------------------ j) Japan → 別府 through the m16 harness
let H = null;
if (section === "j") {
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    HARNESS_SRC.slice(from, to) + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, pk, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const row = (r) => ({ ...H.pk(r.row), runs: r.row.discoveryRuns ?? 0, places: r.row.placesCalls ?? 0 });
  const COUNTRY = { "zh-TW": "日本", en: "Japan", ja: "日本", ko: "일본" };
  // ja 「日本へ旅行」 / ko 「12월에 일본 여행」 are not read as Japan at HEAD either (HEAD-existing parse gap); the
  // first turns below use forms both trees read as the country so the 別府 turn is what is compared.
  const MONTH = { "zh-TW": "12月我要去日本", en: "I'm going to Japan in December", ja: "12月に日本に行きたい", ko: "12월 일본 여행" };
  H.NODATE = { ...H.NODATE, ja: (c) => `${c}に行きたい` };
  const PLACES = [["zh-TW", "別府"], ["zh-TW", "我想去別府"], ["zh-TW", "去京都"], ["en", "I want to go to Beppu"], ["en", "Beppu"], ["ja", "別府"], ["ko", "벳푸"], ["ko", "벳푸에 가고 싶어"],
    ["ja", "別府に行きたい"], ["ja", "京都に行きたい"], ["ko", "교토에 가고 싶어"], ["ko", "교토"]];
  const DAYS = { "zh-TW": "5天", en: "5 days", ja: "5日間", ko: "5일" };
  const onlyLocales = argv.find((a) => a.startsWith("--locales="))?.slice(10).split(",");
  const onlyModes = argv.find((a) => a.startsWith("--modes="))?.slice(8).split(",") ?? ["dated", "nodate", "month"];
  for (const [locale, t] of PLACES) {
    if (onlyLocales && !onlyLocales.includes(locale)) continue;
    for (const mode of onlyModes) {
      H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
      const firstText = mode === "dated" ? H.STEP1[locale](COUNTRY[locale]) : mode === "nodate" ? H.NODATE[locale](COUNTRY[locale]) : MONTH[locale];
      const s0 = (await H.first(firstText, locale)).s;
      const r1 = await H.appTurn(s0, t, locale);
      const x = { firstPending: s0.pendingQuestion?.type ?? null, firstType: s0.travelContext?.destinationType ?? null, firstProv: s0.travelContext?.dateProvenance ? `${s0.travelContext.dateProvenance.source}/${s0.travelContext.dateProvenance.confirmed}` : null, ...row(r1) };
      // HEAD comparison: total Places after the days answer when the place turn asked the days.
      if (x.pending === "ask_days" || /幾天|how many days|何日|며칠/i.test(x.reply ?? "")) {
        const r2 = await H.appTurn(r1.s, DAYS[locale], locale);
        x.after = row(r2);
      }
      R[`j|${mode}|${locale}|${t}`] = x;
    }
  }
}

// ------------------------------------------------------------------ r) requirement D: route authority on a trip with a destination
if (section === "r") {
  const sm = await load("src/lib/chat-session.ts");
  const mv = await load("src/lib/ai/must-visit-places.ts");
  const pi = await load("src/lib/ai/chat-place-intent.ts");
  const ci = await load("src/lib/ai/chat-intent.ts");
  const nc = await load("src/lib/ai/nearby-location-clarification.ts");
  const ar = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
  const TEXTS = ["改去溫泉", "改去海邊", "switch to beach", "onsen instead", "想去海邊", "我想去博物館", "推薦餐廳", "東京海邊", "東京 beach", "東京 박물관", "我想去夜市", "推薦咖啡廳"];
  for (const dest of ["東京", "雪梨"]) for (const t of TEXTS) {
    const s = { ...sm.createEmptySession(), travelContext: { interests: [], destination: dest, destinationType: "city" } };
    const pc = mv.mergeContextForPlaceFetch(s.travelContext, s);
    const cat = safe(() => pi.shouldFetchDestinationCategoryPlaces(t, pc, s));
    R[`r|${dest}|${t}`] = { cat, intents: safe(() => pi.parseChatPlaceIntents(t)),
      auth: safe(() => nc.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: ci.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: false,
        resolvedNearbyIntent: ci.inferNearbyIntentFromContext(pc, t, s) ?? null, categoryPlaceQuery: cat })),
      arb: safe(() => ar.resolveChatIntentArbitration(t, s).route) };
  }
}

// ------------------------------------------------------------------ x) extractKnownAliasDestination short-form matcher misfires
if (section === "x") {
  const al = await load("src/lib/ai/destination-locale-aliases.ts");
  const tp = await load("src/lib/ai/trip-planning-context.ts");
  const WANT = { "도쿄 3일": "東京", "도쿄 여행": "東京", "go Tokyo": "東京", "Tokyo trip": "東京", "let's go Osaka": "大阪", "오사카로 여행": "大阪", "도쿄에 3박": "東京", "go Japan": "日本", "Japan trip": "日本" };
  const MISS = ["go home", "go back", "let's go", "go shopping", "road trip", "day trip", "business trip", "go 3 days", "go now", "go there", "여행 3일", "3일 여행",
    "go beach", "beach trip", "the trip", "go to Tokyo", "go ahead", "go on", "go for it", "go Sydney please"];
  for (const t of [...Object.keys(WANT), ...MISS]) {
    R[`x|${t}`] = { alias: safe(() => al.extractKnownAliasDestination(t)?.canonical ?? null), parse: safe(() => tp.parseDestinationFromText(t)), want: WANT[t] ?? null };
  }
}

// ------------------------------------------------------------------ p) probe (INFO): place wish wording on a Japan trip
if (section === "p") {
  const tpcP = await load("src/lib/ai/trip-planning-context.ts");
  const gpP = await load("src/lib/ai/global-planning-context.ts");
  const aliasP = await load("src/lib/ai/destination-locale-aliases.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const HH = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    HARNESS_SRC.slice(from, to) + "\nreturn { first, freshAll, freshAuthority, STEP1, setLocale: (l) => { curLocale = l; }, tripIntent, travelContext };",
  )(load, loadOpt, readFileSync, storageWrites);
  for (const [locale, t] of [["ko", "벳푸에 가고 싶어"], ["ko", "벳푸"], ["ko", "교토에 가고 싶어"], ["ko", "벳푸로 가고 싶어"], ["ko", "벳푸 가고 싶어"], ["ja", "別府に行きたい"], ["ja", "京都に行きたい"], ["zh-TW", "我想去別府"], ["en", "I want to go to Beppu"]]) {
    HH.freshAll(); await HH.freshAuthority(); HH.setLocale(locale);
    const s = (await HH.first(HH.STEP1[locale](locale === "en" ? "Japan" : locale === "ko" ? "일본" : "日本"), locale)).s;
    const n = HH.tripIntent.applyTripIntentToSession(t, JSON.parse(JSON.stringify(s)));
    const merged = safe(() => HH.travelContext.mergeTravelContext(n, t, s.lastAssistantReply));
    R[`p|${locale}|${t}`] = {
      parse: safe(() => tpcP.parseDestinationFromText(t)), resolve: safe(() => tpcP.resolveDestinationFromText(t)), strip: safe(() => tpcP.stripTravelWishSuffix?.(t)),
      cat: safe(() => tpcP.categorySwitchSearchText?.(t)), future: safe(() => tpcP.isFutureTripPlanningStatement(t)), nonPlace: safe(() => tpcP.isNonPlaceDestinationText?.(t)),
      alias: safe(() => aliasP.extractKnownAliasDestination(t)), cityOnly: safe(() => tpcP.cityOnlyAnswerDestination?.(t)),
      gpt: safe(() => { const g = gpP.globalPlanningTurn(s, t); return g ? { raw: g.destinationCandidate?.raw, status: g.destinationCandidate?.status, dest: g.destination } : null; }),
      mergedDest: merged?.context?.destination ?? null, mergedCand: merged?.context?.destinationCandidate ? `${merged.context.destinationCandidate.raw}/${merged.context.destinationCandidate.status}` : null,
    };
  }
}

// ------------------------------------------------------------------ o) category words OUTSIDE the approved table on the continuation path (INFO)
if (section === "o") {
  for (const [locale, wish, ans] of [["zh-TW", "我想去公園", "東京"], ["zh-TW", "想去動物園", "東京"], ["zh-TW", "想去遊樂園", "東京"], ["zh-TW", "我想去看夜景", "東京"], ["zh-TW", "想去爬山", "東京"],
    ["en", "I'm going to the market", "Tokyo"], ["en", "I want to go to the park", "Tokyo"], ["en", "I want to go to an art gallery", "Tokyo"], ["ja", "海に行きたい", "東京"], ["ja", "博物館に行きたい", "東京"],
    ["ko", "미술관에 가고 싶어", "도쿄"], ["ko", "해변에 가고 싶어", "도쿄"], ["zh-TW", "想去海灘", "東京"], ["zh-TW", "想去美術館", "東京"], ["zh-TW", "想去SPA", "東京"]]) {
    const { asks, s1 } = turnOne(wish, locale);
    if (!asks) { out(`INFO o|${locale}|${wish}: not an ask-city wish (cat=${j(tpc.categorySwitchSearchText(wish))})`); continue; }
    const r = await continuationTurn(s1, ans, locale);
    const p = r.push ?? {};
    const tripSession = { ...sessionMod.createEmptySession(), travelContext: { interests: [], destination: r.answeredCity ?? "東京" } };
    const b1b = await realPush(tripSession, wish, locale, { categoryContinuation: { intents: [r.storedIntent ?? "attraction"], turnText: wish } });
    const exp = expectedContinuationQueries(r.storedWord, p.destination ?? "");
    out(`INFO o|${locale}|${wish}|${ans}: word=${j(r.storedWord)} intent=${r.storedIntent} branch=${r.branch} text=${j(r.categoryText)} inTable=${Boolean(exp)} places=${(p.places ?? []).length} recs=${p.recs ?? 0} q=${j((p.places ?? []).map((x) => x.q))} | default(no word) q=${j((b1b.places ?? []).map((x) => x.q))}`);
  }
}

// ------------------------------------------------------------------ s) area-scope destination + continuation (ForScope ×2)
if (section === "s") {
  /** Places whose address is in the parent city only (no area match) unless areaHit: forces every fallback round. */
  const mkScoped = (areaHit) => async ({ data }) => {
    placesCalls.push({ q: data.query, types: (data.includedTypes ?? []).join(",") });
    const k = keyOf(data.query) ?? "tokyo"; const d = GEO[k];
    const area = areaHit ? (/新宿/.test(data.query) ? "新宿区 Shinjuku" : /東區/.test(data.query) ? "東區 East District" : "") : "";
    const places = Array.from({ length: 10 }, (_, i) => ({ id: `ChIJs${k}${i}${data.query.length}${areaHit ? "a" : "c"}`, name: `${d.city} spot ${i + 1} ${data.query.length}`,
      lat: d.lat + i * 0.002, lng: d.lng + i * 0.001, types: ["tourist_attraction", "point_of_interest", "establishment"], primaryType: "tourist_attraction",
      rating: 4.5, userRatingCount: 3000 + i, address: `${i + 1} Chome, ${area ? `${area}, ` : ""}${d.city}, ${d.country}`,
      formattedAddress: `${i + 1} Chome, ${area ? `${area}, ` : ""}${d.city}, ${d.country}`, businessStatus: "OPERATIONAL", city: d.city, sourceLocale: "en" }));
    return { places, error: null, rawCount: places.length };
  };
  const { resolveDestinationAreaScope } = await load("src/lib/ai/destination-travel-profile.ts");
  // 1) the App continuation with area-style answers (what branch / destination they reach).
  for (const [locale, wish, ans] of [["zh-TW", "明天去海邊", "東京新宿"], ["zh-TW", "想去泡湯", "新宿"], ["zh-TW", "想去泡湯", "東京新宿"], ["zh-TW", "明天去海邊", "台中東區"], ["ko", "바다에 가고 싶어", "도쿄 신주쿠"]]) {
    const { s1 } = turnOne(wish, locale);
    const r = await continuationTurn(s1, ans, locale, { searchPlacesFn: mkScoped(false) });
    const p = r.push ?? {};
    out(`INFO s1|${locale}|${wish}|${ans}: branch=${r.branch} city=${r.answeredCity} text=${j(r.categoryText)} dest=${p.destination ?? null} stop=${p.stop ?? null} places=${(p.places ?? []).length} recs=${p.recs ?? 0} q=${j((p.places ?? []).map((x) => x.q))}`);
  }
  // 2) direct: buildDestinationCategoryRecommendations on an area destination with / without categoryQueryWord.
  const { buildChatPlaceSearchAttempts } = placeIntent;
  for (const dest of ["東京新宿", "台中東區"]) for (const word of ["海邊", "泡湯", "美術館", "박물관", "beach"]) {
    const exp = buildChatPlaceSearchAttempts("attraction", dest, `${dest}${word}`, word);
    const base = buildChatPlaceSearchAttempts("attraction", dest, `${dest}${word}`);
    const all = [...exp.primary, ...exp.fallback];
    const k = `s2|${dest}|${word}`;
    const sc = resolveDestinationAreaScope(dest);
    const issues = [];
    if (!sc) issues.push("no area scope (ForScope ×2 path not exercised)");
    else {
      const want = [...expectedContinuationQueries(word, sc.displayLabel), ...expectedContinuationQueries(word, sc.parentCity)];
      const got = all.map((a) => `${a.query}@${(a.includedTypes ?? []).join(",")}`);
      if (j(got) !== j(want)) issues.push(`attempts ${j(got)} != ${j(want)}`);
      if (all.length !== base.primary.length + base.fallback.length) issues.push(`attempt count ${all.length} != default ${base.primary.length + base.fallback.length}`);
    }
    for (const areaHit of [false, true]) {
      const ctxSession = { ...sessionMod.createEmptySession(), travelContext: { interests: [], destination: dest } };
      const run = async (withWord) => {
        freshCaches(); const p0 = placesCalls.length;
        const pc = mustVisit.mergeContextForPlaceFetch(ctxSession.travelContext, ctxSession);
        const c = GEO[keyOf(dest)];
        const built = await catRec.buildDestinationCategoryRecommendations({ destination: dest, intents: ["attraction"], userText: `${dest}${word}`, context: { ...pc, destination: dest },
          locale: "zh-TW", searchPlaces: mkScoped(areaHit), geocodeFn, excludePlaceIds: [], rejectedPlaceNames: [], session: ctxSession, userProfile: null, trustedCenter: { lat: c.lat, lng: c.lng },
          ...(withWord ? { categoryQueryWord: word } : {}) });
        return { q: placesCalls.slice(p0).map((x) => x.q), recs: built.recommendations.length };
      };
      const w = await run(true); const b = await run(false);
      if (w.q.length > b.q.length) issues.push(`${areaHit ? "area-hit" : "area-miss"}: Places ${w.q.length} > default ${b.q.length}`);
      if (!w.q.every((q) => new RegExp(`${word === "beach" || word === "海邊" ? "海灘|beach" : word === "泡湯" ? "溫泉|hot springs" : word === "美術館" ? "美術館|art museum" : "博物館|museum"}`).test(q))) issues.push(`a query lost the category: ${j(w.q)}`);
      out(`INFO ${k}|${areaHit ? "area-hit" : "area-miss"} W places=${w.q.length} recs=${w.recs} q=${j(w.q)} | default places=${b.q.length} recs=${b.recs}`);
    }
    if (issues.length) fail(k, issues.join("; ")); else pass(k, `scope=${sc.displayLabel}/${sc.parentCity} attempts=${all.length}`);
  }
}

// ------------------------------------------------------------------ d) downstream filters on realistic beach / onsen / museum Places types
if (section === "d") {
  // Text-mode chat searches do NOT send includedTypes to Google (places.functions.ts 994–1006: searchText(query) only),
  // so the provider returns whatever the text query matches. Realistic Places (New) shapes per category:
  const P = (name, primaryType, types, extra = {}) => ({ name, primaryType, types: [...types, "point_of_interest", "establishment"], ...extra });
  const SHAPES = {
    beach: [P("お台場海浜公園", "park", ["park", "tourist_attraction"]), P("葛西海浜公園", "park", ["park"]), P("おだいばビーチ", "beach", ["beach"]),
      P("城南島海浜公園", "park", ["park", "campground"]), P("若洲海浜公園", "park", ["park", "tourist_attraction"]), P("Kasai Rinkai Beach", "beach", ["beach", "natural_feature"]),
      P("Tokyo Bay Seaside", "natural_feature", ["natural_feature"]), P("Odaiba Marine Park", "tourist_attraction", ["tourist_attraction", "park"])],
    onsen: [P("東京ドーム天然温泉 Spa LaQua", "spa", ["spa"]), P("前野原温泉 さやの湯処", "spa", ["spa", "public_bath"]), P("浅草 蛇骨湯", "public_bath", ["public_bath"]),
      P("豊島園 庭の湯", "spa", ["spa", "sauna"]), P("温泉旅館 東京", "japanese_inn", ["japanese_inn", "lodging", "hotel"]), P("Tokyo Onsen Tourist Spot", "tourist_attraction", ["tourist_attraction", "spa"]),
      P("Hot spring hotel", "hotel", ["hotel", "lodging", "spa"]), P("大江戸温泉物語 跡", "tourist_attraction", ["tourist_attraction"])],
    art: [P("国立西洋美術館", "art_museum", ["art_museum", "museum", "tourist_attraction"]), P("森美術館", "art_museum", ["art_museum", "museum"]), P("Gallery X", "art_gallery", ["art_gallery"]),
      P("東京都美術館", "museum", ["museum", "tourist_attraction"]), P("アーティゾン美術館", "art_museum", ["art_museum", "museum"]), P("Small gallery", "art_gallery", ["art_gallery", "store"])],
    museum: [P("東京国立博物館", "museum", ["museum", "tourist_attraction"]), P("江戸東京博物館", "history_museum", ["history_museum", "museum"]), P("国立科学博物館", "science_museum", ["science_museum", "museum", "tourist_attraction"]),
      P("郵政博物館", "museum", ["museum"]), P("Tokyo Museum Shop", "store", ["store", "museum"])],
  };
  const mkPlaces = (shape, d, q) => SHAPES[shape].map((x, i) => ({ id: `ChIJd${shape}${i}${q.length}`, name: x.name, lat: d.lat + i * 0.003, lng: d.lng + i * 0.002, types: x.types, primaryType: x.primaryType,
    rating: 4.4, userRatingCount: 2500 + i * 10, address: `${i + 1} Chome, ${d.city}, ${d.country}`, formattedAddress: `${i + 1} Chome, ${d.city}, ${d.country}`, businessStatus: "OPERATIONAL", city: d.city, sourceLocale: "en" }));
  const shapeOf = (q) => /海灘|beach|바다/i.test(q) ? "beach" : /溫泉|温泉|hot spring|온천/i.test(q) ? "onsen" : /美術館|art museum/i.test(q) ? "art" : /博物館|museum|박물관/i.test(q) ? "museum" : null;
  const genericOf = (d, q) => Array.from({ length: 10 }, (_, i) => ({ id: `ChIJg${i}${q.length}`, name: `${d.city} landmark ${i + 1}`, lat: d.lat + i * 0.002, lng: d.lng + i * 0.001,
    types: ["tourist_attraction", "point_of_interest", "establishment"], primaryType: "tourist_attraction", rating: 4.5, userRatingCount: 3000 + i,
    address: `${i + 1} Chome, ${d.city}, ${d.country}`, formattedAddress: `${i + 1} Chome, ${d.city}, ${d.country}`, businessStatus: "OPERATIONAL", city: d.city, sourceLocale: "en" }));
  const realistic = async ({ data }) => {
    placesCalls.push({ q: data.query, types: (data.includedTypes ?? []).join(",") });
    const d = GEO[keyOf(data.query) ?? "tokyo"]; const sh = shapeOf(data.query);
    const places = sh ? mkPlaces(sh, d, data.query) : genericOf(d, data.query);
    return { places, error: null, rawCount: places.length };
  };
  for (const [locale, wish, ans, shape] of [["zh-TW", "明天去海邊", "東京", "beach"], ["en", "I want to go to the beach", "Tokyo", "beach"], ["ko", "바다에 가고 싶어", "도쿄", "beach"],
    ["zh-TW", "想去泡湯", "東京", "onsen"], ["zh-TW", "我想泡溫泉", "東京", "onsen"], ["en", "I want to go to hot springs", "Tokyo", "onsen"], ["ja", "温泉に行きたい", "東京", "onsen"], ["ko", "온천에 가고 싶어", "도쿄", "onsen"],
    ["ja", "美術館に行きたい", "東京", "art"], ["ko", "박물관에 가고 싶어", "도쿄", "museum"]]) {
    const { s1 } = turnOne(wish, locale);
    const r = await continuationTurn(s1, ans, locale, { searchPlacesFn: realistic });
    const p = r.push ?? {};
    const raw = SHAPES[shape].length;
    const kept = p.recNames ?? [];
    const dropped = SHAPES[shape].map((x) => x.name).filter((n) => !kept.includes(n));
    const k = `d|${locale}|${wish}|${ans}`;
    const line = `${k} shape=${shape} places=${(p.places ?? []).length} q=${j((p.places ?? []).map((x) => x.q))} recs=${p.recs ?? 0}/${raw} stop=${p.stop ?? null}\n   kept=${j(kept)}\n   dropped=${j(dropped.map((n) => `${n}(${SHAPES[shape].find((x) => x.name === n).primaryType})`))}`;
    R[k] = { recs: p.recs ?? 0, raw, kept, places: (p.places ?? []).length };
    // App 6779: recommendations.length === 0 → push returns false → "noResults" copy (category request answered with nothing).
    if (!p.recs) fail(k, `all ${raw} realistic results filtered → App shows noResults\n${line}`);
    else if (p.recs < Math.min(3, raw) ) fail(k, `only ${p.recs}/${raw} realistic results survive downstream filters\n${line}`);
    else pass(line);
  }
  // Pure-type pools (no parks / tourist_attraction rescue): which single Places types the attraction filters drop.
  for (const [shape, pool] of [["beachPure", ["beach", "beach", "natural_feature", "natural_feature", "beach", "natural_feature"]], ["onsenBath", ["public_bath", "public_bath", "spa", "sauna", "public_bath", "spa"]],
    ["onsenLodging", ["japanese_inn", "japanese_inn", "hotel", "lodging", "resort_hotel", "japanese_inn"]], ["artGallery", ["art_gallery", "art_gallery", "art_museum", "art_gallery", "art_museum", "art_gallery"]]]) {
    SHAPES[shape] = pool.map((t, i) => P(`${shape} place ${i + 1}`, t, t === "japanese_inn" || t === "hotel" || t === "resort_hotel" ? [t, "lodging"] : [t]));
    const word = /beach/.test(shape) ? ["zh-TW", "明天去海邊", "東京"] : /art/.test(shape) ? ["ja", "美術館に行きたい", "東京"] : ["zh-TW", "想去泡湯", "東京"];
    const fn = async ({ data }) => { placesCalls.push({ q: data.query, types: "" }); const pl = mkPlaces(shape, GEO.tokyo, data.query); return { places: pl, error: null, rawCount: pl.length }; };
    const { s1 } = turnOne(word[1], word[0]);
    const r = await continuationTurn(s1, word[2], word[0], { searchPlacesFn: fn });
    const p = r.push ?? {};
    const keptTypes = (p.recNames ?? []).map((n) => SHAPES[shape].find((x) => n.startsWith(x.name))?.primaryType ?? n);
    R[`dp|${shape}`] = { recs: p.recs ?? 0, places: (p.places ?? []).length };
    out(`INFO dp|${shape} (${word[1]}→${word[2]}): places=${(p.places ?? []).length} recs=${p.recs ?? 0}/${pool.length} keptTypes=${j(keptTypes)} q=${j((p.places ?? []).map((x) => x.q))}`);
  }
  // Per-type survival through the render filter alone (filterRecommendationsForCategoryRender, intent attraction).
  for (const [text, shape] of [["東京海邊", "beach"], ["東京 beach", "beach"], ["東京泡湯", "onsen"], ["東京溫泉", "onsen"], ["東京 hot springs", "onsen"], ["東京美術館", "art"], ["東京 박물관", "museum"]]) {
    const items = mkPlaces(shape, GEO.tokyo, text).map((x) => ({ ...x, placeId: x.id, googlePlaceId: x.id, placeName: x.name, type: x.primaryType }));
    const kept = safe(() => guard.filterRecommendationsForCategoryRender(items, "attraction", text));
    out(`INFO d-render|${text}: kept ${Array.isArray(kept) ? kept.length : j(kept)}/${items.length} ${Array.isArray(kept) ? j(kept.map((x) => x.primaryType)) : ""}`);
  }
}

// ------------------------------------------------------------------ q) no categoryQueryWord → byte-identical to HEAD
if (section === "q") {
  const INTENTS = ["attraction", "cafe", "restaurant", "shopping", "night_market", "bar", "indoor"];
  const DESTS = ["東京", "東京新宿", "台中東區", "台北", "雪梨", "Sydney", "京都嵐山", "大阪", "首爾明洞", "別府"];
  const TEXTS = ["", "我想去博物館", "東京海邊", "東京 박물관", "推薦咖啡廳", "想吃壽喜燒", "我想去夜市", "東京溫泉", "附近有什麼景點", "室內景點", "美術館に行きたい", "바다에 가고 싶어", "I want to go to the beach", "買衣服"];
  const parsedOf = (t) => safe(() => { const p = t.trim() ? recParse.parsePlaceRecommendationIntent(t) : null; return p && { primaryType: p.primaryType, subtypes: p.subtypes, preferred: p.preferredFeatures, indoor: p.indoorOnly }; });
  const inert = [];
  for (const it of INTENTS) for (const d of DESTS) for (const t of TEXTS) {
    const pure = safe(() => placeIntent.buildChatPlaceSearchAttempts(it, d, t));
    const scope = safe(() => placeIntent.buildChatPlaceSearchAttemptsForScope(it, d, t));
    const label = safe(() => tpc.normalizeDestinationLabel(d));
    R[`q|pure|${it}|${d}|${t}`] = { a: pure, parsed: parsedOf(t), label };
    R[`q|scope|${it}|${d}|${t}`] = { a: scope, parsed: parsedOf(t), label };
    // Same tree: an absent / empty / blank word is inert; a word on a non-attraction intent is ignored.
    if (!CHILD) for (const w of [undefined, "", "   ", ...(it === "attraction" ? [] : ["海邊", "박물관"])]) {
      if (j(safe(() => placeIntent.buildChatPlaceSearchAttempts(it, d, t, w))) !== j(pure) || j(safe(() => placeIntent.buildChatPlaceSearchAttemptsForScope(it, d, t, w))) !== j(scope)) inert.push(`${it}|${d}|${t}|word=${j(w)}`);
    }
  }
  if (!CHILD) { if (inert.length) fail("q|inert", `categoryQueryWord changed attempts: ${j(inert.slice(0, 10))} (${inert.length})`); else pass("q|inert", "undefined / \"\" / blank word, and any word on non-attraction intents → attempts identical to no argument (both builders)"); }
  // Full builder (no categoryQueryWord), counting mock: queries / types / rec ids.
  const FULL = [["東京", ["attraction"], "東京海邊"], ["東京", ["attraction"], "我想去博物館"], ["東京", ["attraction"], "東京有什麼景點推薦嗎"], ["東京新宿", ["attraction"], "東京新宿景點"],
    ["台中東區", ["cafe"], "推薦咖啡廳"], ["東京", ["night_market"], "我想去夜市"], ["東京", ["shopping"], "我想去購物"], ["東京", ["cafe"], "我想去咖啡廳"], ["京都", ["restaurant"], "想吃壽喜燒"],
    ["東京", ["attraction", "cafe"], "景點和咖啡廳"], ["大阪", ["bar"], "推薦酒吧"], ["東京", ["indoor"], "室內景點"]];
  for (const [dest, intents, text] of FULL) for (const locale of ["zh-TW", "en"]) {
    freshCaches(); const p0 = placesCalls.length; const g0 = geocodeCalls.length;
    const s = { ...sessionMod.createEmptySession(), travelContext: { interests: [], destination: dest } };
    const pc = mustVisit.mergeContextForPlaceFetch(s.travelContext, s);
    const c = GEO[keyOf(dest) ?? "tokyo"];
    let built;
    try { built = await catRec.buildDestinationCategoryRecommendations({ destination: dest, intents, userText: text, context: { ...pc, destination: dest }, locale, searchPlaces, geocodeFn,
      excludePlaceIds: [], rejectedPlaceNames: [], session: s, userProfile: null, trustedCenter: { lat: c.lat, lng: c.lng } }); } catch (e) { built = { error: String(e?.message ?? e) }; }
    R[`q|full|${dest}|${intents}|${text}|${locale}`] = { parsed: parsedOf(text), label: safe(() => tpc.normalizeDestinationLabel(dest)), q: placesCalls.slice(p0), geo: geocodeCalls.slice(g0).length, recs: (built.recommendations ?? []).map((r) => r.placeId ?? r.id ?? r.name), usedQueries: built.usedQueries ?? null, error: built.error ?? null,
      summaryHead: (built.summary ?? "").split("\n")[0] };
  }
}

// ------------------------------------------------------------------ t) 「X へ旅行」 through parseDestinationFromTurn (mergeTravelContext) vs HEAD
if (section === "t") {
  const T = ["日本へ旅行", "日本に旅行", "日本へ旅行したい", "日本へ旅行します", "東京へ旅行", "京都に旅行したいです", "北海道へ観光", "別府に観光します", "ロンドンへ旅行", "パリに観光したい",
    "12月に旅行したい", "冬に旅行したい", "週末に旅行", "来月へ旅行", "家族に旅行", "海外へ旅行", "国内に旅行", "温泉に旅行", "海に旅行したい", "山へ観光", "東京 へ旅行", "Tokyoへ旅行", "おおさかへ旅行",
    "12/10-12/14 日本へ旅行", "12月に日本へ旅行", "日本へ旅行 5日間", "沖縄へ旅行に行きたい", "日本への旅行", "日本へ旅行中", "旅行に行きたい", "観光したい", "日本へ旅行に行く",
    "12월 일본 여행", "12월에 일본 여행", "1월에 도쿄 여행", "12월에 여행", "go Sydney please", "go Tokyo please", "Sydney please", "please", "go home please", "12월에 please"];
  for (const t of T) {
    const m = safe(() => { const r = travelContext.mergeTravelContext(sessionMod.createEmptySession(), t); return { dest: r.context.destination ?? null, start: r.context.startDate ?? null, end: r.context.endDate ?? null,
      month: r.context.travelMonth ?? null, days: r.context.days ?? null, cand: r.context.destinationCandidate?.raw ?? null }; });
    R[`t|${t}`] = { merge: m, parse: safe(() => tpc.parseDestinationFromText(t)), strip: safe(() => tpc.stripTravelWishSuffix?.(t)) };
  }
}

// ------------------------------------------------------------------ w) 「日本へ旅行」/「12월에 일본 여행」 no-date full flow (m16 harness)
if (section === "w") {
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const HW = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    HARNESS_SRC.slice(from, to) + "\nreturn { appTurn, first, freshAll, freshAuthority, pk, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const tc = (s) => { const c = s.travelContext ?? {}; return { dest: c.destination ?? null, type: c.destinationType ?? null, month: c.travelMonth ?? null, start: c.startDate ?? null, end: c.endDate ?? null,
    days: c.days ?? null, prov: c.dateProvenance ? `${c.dateProvenance.source}/${c.dateProvenance.confirmed}` : null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}` : null,
    tpc: s.tripPlanningContext?.destination ?? null, pending: s.pendingQuestion?.type ?? null, offered: (c.offeredCombinations ?? []).length }; };
  const FLOWS = [["ja", ["日本へ旅行", "別府に行きたい", "5日間"]], ["ja", ["日本へ旅行したい", "京都に行きたい", "5日間"]], ["ja", ["12月に日本へ旅行", "別府に行きたい", "5日間"]],
    ["ko", ["12월에 일본 여행", "벳푸에 가고 싶어", "5일"]], ["ko", ["12월 일본 여행", "교토에 가고 싶어", "5일"]], ["ko", ["일본 여행", "벳푸에 가고 싶어", "5일"]],
    ["en", ["go Sydney please", "5 days"]]];
  for (const [locale, turns] of FLOWS) {
    HW.freshAll(); await HW.freshAuthority(); HW.setLocale(locale);
    let s = null; const steps = [];
    for (const t of turns) {
      const r = s ? await HW.appTurn(s, t, locale) : await HW.first(t, locale);
      s = r.s;
      steps.push({ t, ...tc(s), branch: r.row.branch, runs: r.row.discoveryRuns ?? 0, places: r.row.placesCalls ?? 0, geo: (HW.pk(r.row).geoQ ?? []).length, reply: (r.row.reply ?? "").slice(0, 140) });
    }
    R[`w|${locale}|${turns.join(" → ")}`] = steps;
  }
}

if (CHILD) {
  process.stdout.write(`@@M21_JSON@@${JSON.stringify({ R, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
let HEAD = null;
if (headDir && ["k", "j", "p", "r", "x", "q", "t", "w"].includes(section)) {
  const self = "scripts/verify-m21-category-city-continuation.mjs";
  const files = [self, "scripts/verify-m16-post-selection-switch-review.mjs"];
  for (const f of files) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", `--section=${section}`, ...argv.filter((a) => a.startsWith("--locales=") || a.startsWith("--modes="))],
    { cwd: headDir, encoding: "utf8", timeout: 540_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M21_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).R : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

if (section === "k") {
  for (const [k, x] of Object.entries(R)) {
    const h = HEAD?.[k];
    const line = `${k}\n   W pending=${x.pending} days=${x.days} dest=${x.dest} ${x.start}~${x.end}${h ? `\n   H pending=${h.pending} days=${h.days} dest=${h.dest}` : ""}`;
    const issues = [];
    if (x.want === "kept") { if (x.pending) issues.push(`asked ${x.pending}`); if (x.days !== 5) issues.push(`days ${x.days}`); }
    if (x.want === "ask" && x.pending !== "ask_days") issues.push(`pending ${x.pending} (want ask_days)`);
    if (x.want === "head" && h && (h.pending !== x.pending || h.days !== x.days)) issues.push(`differs from HEAD (H pending=${h.pending} days=${h.days})`);
    if (x.want === "head" && !h) out(`NOTE ${k}: no HEAD row (run with --head-dir to compare)`);
    if (issues.length) fail(k, `${issues.join("; ")}\n${line}`); else pass(line);
  }
}
if (section === "j") {
  const LR = /LAST-RESORT|暫時無法取得足夠|aren.t enough verified|couldn.t get enough/i;
  const brief = (x) => x ? `${x.branch} dest=${x.dest} type=${x.type} pend=${x.pending} off=${x.offered} ${x.start}~${x.end} d=${x.days} prov=${x.prov} geo=${x.geoQ.length} runs=${x.runs} places=${x.places} | ${(x.reply ?? "").slice(0, 110)}` : "-";
  for (const [k, x] of Object.entries(R)) {
    const [, mode, , t] = k.split("|");
    const h = HEAD?.[k];
    const issues = [];
    const want = /京都|교토/.test(t) ? /京都|Kyoto|교토/ : /別府|Beppu|벳푸|べっぷ/i;
    if (!want.test(`${x.dest} ${x.tpc} ${x.cand} ${x.reply}`)) issues.push("place not narrowed");
    if (LR.test(`${x.branch} ${x.reply}`)) issues.push("LAST-RESORT");
    if (mode === "dated") {
      if (x.firstType !== "country" && x.firstProv !== "user_date/true") out(`NOTE ${k}: first turn type=${x.firstType} prov=${x.firstProv}`);
      if (x.pending === "ask_days" || x.after) issues.push(`asked the days again (pending ${x.pending})`);
      if (x.pending !== "combination_choice" || !x.offered) issues.push(`combinations not listed (pending ${x.pending} offered ${x.offered})`);
      if (x.start !== "2026-12-10" || x.end !== "2026-12-14" || x.prov !== "user_date/true") issues.push(`dates not kept (${x.start}~${x.end} ${x.prov})`);
      if (x.days !== 5) issues.push(`days ${x.days}`);
      if (x.places > 3 || x.geoQ.length > 2) issues.push(`cost places=${x.places} geo=${x.geoQ.length}`);
      if (h) {
        const headTotal = h.places + (h.after?.places ?? 0);
        const headGeo = h.geoQ.length + (h.after?.geoQ.length ?? 0);
        out(`COST ${k}: WORK places=${x.places} geo=${x.geoQ.length} | HEAD this turn places=${h.places} geo=${h.geoQ.length} + after days answer places=${h.after?.places ?? "-"} geo=${h.after?.geoQ.length ?? "-"} (total ${headTotal}/${headGeo})`);
        // HEAD +days rows can read a warm Places result cache from an earlier row (places 0, runs 1): compare only cold rows.
        if (x.places > headTotal && h.after && headTotal > 0) issues.push(`Places ${x.places} > HEAD total after days ${headTotal}`);
        if (h.after && headTotal === 0 && x.places) out(`NOTE ${k}: HEAD +days row read a warm cache (places 0, runs ${h.after.runs}); cost not compared`);
        if (x.geoQ.length > headGeo && h.after) issues.push(`geocode ${x.geoQ.length} > HEAD total ${headGeo}`);
      }
    } else {
      if (x.pending !== "ask_days" && !/幾天|how many days|何日|며칠|日数|일정/i.test(x.reply ?? "")) issues.push(`days not asked (pending ${x.pending})`);
      if (x.offered && x.pending === "combination_choice") issues.push("combinations listed without days");
      if (x.runs || x.places) issues.push(`discovery before days runs=${x.runs} places=${x.places}`);
      // HEAD did not read the first turn as the country (requirement B gap): no like-for-like HEAD row.
      if (h && h.firstType === "country" && (h.pending !== x.pending || h.dest !== x.dest)) issues.push(`differs from HEAD (H pend=${h.pending} dest=${h.dest})`);
    }
    const line = `${k} (first pend=${x.firstPending} type=${x.firstType} prov=${x.firstProv}${h ? ` | H first type=${h.firstType}` : ""})\n   W ${brief(x)}${x.after ? `\n     +days ${brief(x.after)}` : ""}${h ? `\n   H ${brief(h)}${h.after ? `\n     +days ${brief(h.after)}` : ""}` : ""}`;
    const headSame = h && brief(h) === brief(x).replace(/’/g, "'") || (h && brief(h).replace(/’/g, "'") === brief(x).replace(/’/g, "'"));
    if (issues.length && headSame) out(`KNOWN ${line}\n   -> ${issues.join("; ")} (HEAD identical: HEAD-existing)`);
    else if (issues.length) { out(`ISSUE ${line}\n   -> ${issues.join("; ")}`); fail(k, issues.join("; ")); } else pass(line);
  }
}
if (section === "r") for (const [k, x] of Object.entries(R)) {
  const h = HEAD?.[k];
  const line = `${k} W=${j(x)}${h ? ` H=${j(h)}` : ""}`;
  // M18 round 1 (approved): a category wish on a trip with a destination searches that destination
  // (HEAD sent it to the device-nearby route). Every other row (requirement D) must equal HEAD.
  if (/\|我想去(博物館|夜市)$/.test(k)) {
    if (x.auth !== "destination_category") fail(k, `wish not on the destination-category route: ${line}`); else pass(`${line} (M18 r1 approved change)`);
    continue;
  }
  if (!h) { out(`NOTE ${line} (no HEAD row)`); continue; }
  if (j(x) !== j(h)) fail(k, `route differs from HEAD: ${line}`); else pass(line);
}
if (section === "x") for (const [k, x] of Object.entries(R)) {
  const h = HEAD?.[k];
  const line = `${k} W=${j({ alias: x.alias, parse: x.parse })}${h ? ` H=${j({ alias: h.alias, parse: h.parse })}` : ""}`;
  if (x.want) { if (x.alias !== x.want && x.parse !== x.want) fail(k, `not parsed: ${line}`); else pass(line); continue; }
  // Misfire rows: the new short matcher must add no destination that HEAD did not have.
  const newAlias = x.alias && (!h || h.alias !== x.alias);
  if (newAlias) fail(k, `new alias destination misfire: ${line}`); else pass(line);
}
if (section === "q") {
  if (!HEAD) fail("q|head", "run with --head-dir (no HEAD rows)");
  else {
    let same = 0; let summaryOnly = 0;
    const cls = { label: [], parser: [], universal: [] };
    const universal = (p) => p && (p.subtypes?.length || p.preferred?.length || p.indoor);
    for (const [k, x] of Object.entries(R)) {
      const h = HEAD[k];
      if (h === undefined) { fail(k, "no HEAD row"); continue; }
      const full = k.startsWith("q|full|");
      const { summaryHead: ws, ...wr } = x; const { summaryHead: hs, ...hr } = h;
      if (j(wr) === j(hr)) { same++; if (full && ws !== hs) { summaryOnly++; out(`INFO ${k}: queries/recs == HEAD; summary first line W=${j(ws)} H=${j(hs)}`); } continue; }
      // Attribution: a different parse (parse.ts deps) or the universal builder path (place-recommendation-intent/queries.ts,
      // earlier M rounds) is outside this round's two files; a default switch-branch diff with the same parse is not.
      if (j(x.label) !== j(h.label)) { cls.label.push(k); continue; }
      if (j(x.parsed) !== j(h.parsed)) { cls.parser.push(k); continue; }
      if (universal(x.parsed)) { cls.universal.push(k); continue; }
      fail(k, `differs from HEAD on the default (non-universal) path with the same parse\n   W ${j(wr)}\n   H ${j(hr)}`);
    }
    out(`INFO q: ${same}/${Object.keys(R).length} rows identical to HEAD (${summaryOnly} full rows differ only in the summary copy)`);
    for (const [c, keys] of Object.entries(cls)) {
      const texts = [...new Set(keys.map((k) => k.split("|").slice(-1)[0] === "zh-TW" || k.split("|").slice(-1)[0] === "en" ? k.split("|").slice(-2, -1)[0] : k.split("|").slice(-1)[0]))];
      out(`INFO q diff class=${c}: ${keys.length} rows, texts=${j(texts)}`);
    }
    for (const k of [...cls.parser, ...cls.universal].filter((k) => k.startsWith("q|full|"))) out(`INFO q full diff ${k}\n   W ${j({ ...R[k], summaryHead: undefined })}\n   H ${j({ ...HEAD[k], summaryHead: undefined })}`);
    const sampleP = cls.parser.find((k) => k.startsWith("q|pure|")); if (sampleP) out(`INFO q parser sample ${sampleP}: W parsed=${j(R[sampleP].parsed)} H parsed=${j(HEAD[sampleP].parsed)}`);
  }
}
if (section === "t") {
  const WANT = { 日本へ旅行: "日本", 日本に旅行: "日本", 日本へ旅行したい: "日本", 日本へ旅行します: "日本", 東京へ旅行: "東京", 京都に旅行したいです: "京都", 北海道へ観光: "北海道", 別府に観光します: "別府",
    "12/10-12/14 日本へ旅行": "日本", "12月に日本へ旅行": "日本", "12월 일본 여행": "日本", "12월에 일본 여행": "日本", "go Sydney please": "雪梨" };
  const MONTH_ONLY = ["12月に日本へ旅行", "12월 일본 여행", "12월에 일본 여행"];
  const NOT = ["12月に旅行したい", "冬に旅行したい", "週末に旅行", "来月へ旅行", "家族に旅行", "海外へ旅行", "国内に旅行", "旅行に行きたい", "観光したい", "12월에 여행", "please", "go home please", "12월에 please", "山へ観光", "海に旅行したい", "温泉に旅行"];
  for (const [k, x] of Object.entries(R)) {
    const t = k.slice(2); const h = HEAD?.[k];
    const line = `${k}\n   W ${j(x)}${h ? `\n   H ${j(h)}` : ""}`;
    const d = x.merge?.dest ?? null;
    const issues = [];
    if (d && /旅行|観光|please|여행/i.test(d)) issues.push(`destination literal ${d}`);
    if (WANT[t] && d !== WANT[t]) issues.push(`dest ${d} (want ${WANT[t]})`);
    if (MONTH_ONLY.includes(t) && (x.merge?.start || x.merge?.end)) issues.push(`month-only turn got dates ${x.merge.start}~${x.merge.end}`);
    // mergeTravelContext stores the month as 「12月」 (HEAD and WORK; the session-level month is normalized later).
    if (MONTH_ONLY.includes(t) && !/^(?:12月|2026-12)$/.test(x.merge?.month ?? "")) issues.push(`travelMonth ${x.merge?.month}`);
    if (NOT.includes(t) && d && (!h || h.merge?.dest !== d)) issues.push(`new non-place destination ${d} (HEAD ${h?.merge?.dest ?? null})`);
    const diff = h && j(h) !== j(x);
    const headSameDest = h && (h.merge?.dest ?? null) === d;
    const headAlsoLiteral = h && /旅行|観光|please|여행/i.test(h.merge?.dest ?? "") && /旅行|観光|please|여행/i.test(d ?? "");
    if (issues.length && !WANT[t] && (headSameDest || headAlsoLiteral)) out(`KNOWN ${line}\n   -> ${issues.join("; ")} (HEAD has the same problem: HEAD-existing)`);
    else if (issues.length && WANT[t] && headSameDest) out(`KNOWN ${line}\n   -> ${issues.join("; ")} (HEAD identical: HEAD-existing, not in requirement 3)`);
    else if (issues.length) fail(k, `${issues.join("; ")}${line}`);
    else if (diff) out(`DIFF ${line}`); else pass(line);
  }
}
if (section === "w") {
  const LR = /LAST-RESORT|暫時無法取得足夠|aren.t enough verified|couldn.t get enough|実際のスポットの組み合わせ|실제 장소 조합을 충분히/i;
  for (const [k, steps] of Object.entries(R)) {
    const h = HEAD?.[k];
    const issues = [];
    const f = steps[0];
    const sydney = /Sydney/.test(k);
    if (!(sydney ? /雪梨|Sydney/ : /日本|Japan/).test(f.dest ?? "")) issues.push(`first turn dest ${f.dest}`);
    if (/旅行|여행|please/i.test(`${f.dest} ${f.cand ?? ""} ${f.tpc ?? ""}`)) issues.push(`literal destination ${f.dest}/${f.cand}/${f.tpc}`);
    if (/12월|12月/.test(k)) { if (!/^(?:12月|2026-12)$/.test(f.month ?? "")) issues.push(`travelMonth ${f.month}`); if (f.start || f.end) issues.push(`forged dates ${f.start}~${f.end} prov=${f.prov}`); }
    if (!sydney) {
      const p = steps[1];
      if (p.pending !== "ask_days" && !/幾天|how many days|何日|며칠|日数|일정/i.test(p.reply)) issues.push(`place turn did not ask the days (pending ${p.pending})`);
      if (!/別府|Beppu|벳푸|京都|Kyoto|교토/.test(`${p.dest} ${p.cand} ${p.tpc} ${p.reply}`)) issues.push("place not narrowed");
      if (p.runs || p.places) issues.push(`discovery before days runs=${p.runs} places=${p.places}`);
    }
    for (const st of steps) if (LR.test(`${st.branch} ${st.reply}`)) issues.push(`LAST-RESORT at 「${st.t}」`);
    const fmt = (ss) => ss.map((st) => `\n     「${st.t}」 ${st.branch} dest=${st.dest} type=${st.type} month=${st.month} ${st.start}~${st.end} d=${st.days} prov=${st.prov} cand=${st.cand} pend=${st.pending} off=${st.offered} runs=${st.runs} places=${st.places} geo=${st.geo} | ${st.reply}`).join("");
    const line = `${k}\n   W${fmt(steps)}${h ? `\n   H${fmt(h)}` : ""}`;
    if (issues.length) fail(k, `${issues.join("; ")}\n${line}`); else pass(line);
  }
}
if (section === "p") for (const [k, x] of Object.entries(R)) out(`INFO ${k}\n   W ${j(x)}${HEAD?.[k] ? `\n   H ${j(HEAD[k])}` : ""}`);
if (fetchCalls) fail("fetch", `no network fetch=${fetchCalls}`);
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
