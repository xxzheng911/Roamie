import "./verify-netguard-full.mjs";
/**
 * D21 (tester, independent review). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice / seeds as d19).
 *  n) 「eat nearby」 fix (NON_PLACE_EN_NEARBY_RE): guard unit rows, re-ask → not yet → nearby → Kinosaki ×4 locales,
 *     new chat nearby wording, Near-named real places (Near Islands / Near East / Nearchos / Linear Park), CJK 附近 / 近く / 근처 unchanged.
 *  o) omakase / 無菜單 read-only probe: each sentence × stage (new / Tokyo ask_days / Tokyo done / Taipei done / combos / re-ask):
 *     intent signals, allOrAuto, destination parse, appTurn branch + geocode, and the Places requests the category / nearby
 *     builders would send (mock searchPlaces records the request; nothing leaves the process).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d21.mjs -- --head-dir=<snapshot> [--only=n|o]
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (s) => !ONLY || ONLY.includes(s);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 570s"); process.exit(3); }, 570_000).unref();

const RealDate = Date;
const NOW = new RealDate("2026-11-16T10:00:00").getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))]);

const LOCS = ["zh-TW", "en", "ja", "ko"];
const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const NO = { "zh-TW": "不是", en: "no", ja: "いいえ", ko: "아니요" };
const DAYS = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const GO = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const TOKYO = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const TAIPEI = { "zh-TW": "台北", en: "Taipei", ja: "台北", ko: "타이베이" };
const KINO_RE = /kinosaki|城崎|키노사키/i;
const NEARBY_RESIDUE_RE = /^(?:(?:to\s+)?eat\s+)?(?:nearby|near\s+me|around\s+here)$|\bgood\s+to\s+eat\b/i; // copy of the diff regex (unit rows only)
const BAD_DEST_RE = /eat nearby|^nearby$|near me|around here|good to eat|^here$|^me$/i;

const EXTRA_FIX = [
  ["kinosaki", "/kinosaki|城崎|키노사키/i", "Kinosaki", "Hyogo", "Japan", "JP", 35.6255, 134.8093, ["Kinosaki", "城崎", "城崎", "키노사키"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["naha", "/naha|那霸|那覇|나하/i", "Naha", "Okinawa", "Japan", "JP", 26.2124, 127.6809, ["Naha", "那霸市", "那覇市", "나하시"]],
  ["taipei", "/taipei|台北|臺北|타이베이/i", "Taipei", "Taipei", "Taiwan", "TW", 25.033, 121.5654, ["Taipei", "台北", "台北", "타이베이"]],
  ["seoul", "/seoul|首爾|首尔|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
  ["nearislands", "/near islands/i", "Near Islands", "Alaska", "United States", "US", 52.75, 173.5, ["Near Islands", "近島群島", "ニア諸島", "니어 제도"]],
];

const CENTER = { tokyo: [35.6762, 139.6503], taipei: [25.033, 121.5654], seoul: [37.5665, 126.978] };
const centerOf = (d) => (/taipei|台北|臺北|타이베이/i.test(d ?? "") ? "taipei" : /seoul|首爾|ソウル|서울/i.test(d ?? "") ? "seoul" : "tokyo");

// omakase sentences: [text, locale]
const OMA = [
  ["附近有無菜單料理嗎", "zh-TW"], ["台北無菜單料理推薦", "zh-TW"], ["我想吃 omakase", "zh-TW"],
  ["omakase near me", "en"], ["best omakase in Tokyo", "en"], ["omakase", "en"],
  ["近くのおまかせ寿司", "ja"], ["東京でおまかせコースのお店", "ja"], ["おまかせ寿司", "ja"], ["おまかせ", "ja"],
  ["근처 오마카세 추천", "ko"], ["서울 오마카세 맛집", "ko"], ["오마카세", "ko"],
];

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  slice = slice.replace('return dateQuestion("13058");', '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const geoLines = EXTRA_FIX.map(([k, re, city, region, country, code, lat, lng]) => `  ${k}: { re: ${re}, city: ${JSON.stringify(city)}, region: ${JSON.stringify(region)}, country: ${JSON.stringify(country)}, code: "${code}", lat: ${lat}, lng: ${lng} },\n`).join("");
  const localLines = EXTRA_FIX.map(([k, , , , , , , , loc]) => `${k}: ${JSON.stringify(loc)}, `).join("");
  slice = slice.replace("  kamakura: { re: /kamakura", geoLines + "  kamakura: { re: /kamakura")
    .replace('kamakura: ["Kamakura"', localLines + 'kamakura: ["Kamakura"')
    .replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    const offered = tc.offeredCombinations ?? [];
    const sel = tc.selectedCombinationIds ?? [];
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      inputs: tc.destinationInputNames === undefined ? "undef" : JSON.stringify(tc.destinationInputNames),
      days: tc.days ?? s.tripDays ?? null, offered: offered.length, sel: sel.join(",") || null, nSel: sel.length,
      selTitle: sel.map((id) => { const c = offered.find((o) => o.id === id); return c ? `${offered.indexOf(c) + 1}.${(c.title ?? c.name ?? "").slice(0, 20)}` : `${id}(not offered)`; }).join(",") || null,
      offeredTitles: offered.map((c, i) => `${i + 1}.${c.id}:${(c.title ?? c.name ?? "").slice(0, 16)}`).join(" ; ") || null,
      phase: s.phase ?? null, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 200) };
  };
  const logs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const turnS = async (s0, t, loc) => {
    const n0 = logs().map((l) => l.length);
    try { const r = await H.appTurn(structuredClone(s0), t, loc); const q = logs().flatMap((l, i) => l.slice(n0[i]).map((x) => `${["g", "a", "d"][i]}:${x}`)); return { row: { ...snap(r), geo: q.length, q: q.join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 }, s: null }; }
  };
  const fresh = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const nextOf = (a) => ({ ...a.s, lastAssistantReply: (a.row.reply ?? "").replace(/ \/ /g, "\n") });
  const seedFor = async (loc) => {
    for (const t of CAND_SEED[loc]) {
      await fresh(loc);
      let r; try { r = await H.appTurn(sessionMod.createEmptySession(), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: { ...r.s, lastAssistantReply: (r.row?.reply ?? "") } };
    }
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...sessionMod.createEmptySession(), lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };
  const seeds = {};
  for (const loc of LOCS) { seeds[loc] = await seedFor(loc); R[`SEED|${loc}`] = { seed: seeds[loc].seed }; }
  const runFrom = async (loc, start, steps) => {
    await fresh(loc);
    let cur = start; const rows = []; const states = [cur];
    for (const t of steps) {
      const a = await turnS(cur, t, loc);
      rows.push({ t, ...a.row });
      if (!a.s) break;
      cur = nextOf(a); states.push(cur);
    }
    return { rows, states };
  };
  const run = (loc, steps) => runFrom(loc, seeds[loc].s1, steps);
  const guard = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 60)}`; } };

  // ------------------------------------------------------------------ n) eat nearby review
  if (want("n")) {
    const UNIT = ["eat nearby", "nearby", "near me", "around here", "to eat nearby", "Eat Nearby", "NEAR ME", "anything good to eat", "good to eat nearby",
      "eat nearby?", "near me.", "what's around here", "here",
      "Near Islands", "Near East", "Nearchos", "Linear Park", "Nearby Hostel Tokyo", "Kearney", "Good to Eat Cafe",
      "附近", "近く", "근처", "附近有什麼好吃的", "近くに美味しいものある？", "근처에 맛집 있어?", "京都", "Kinosaki"];
    for (const u of UNIT) {
      R[`NU|${u}`] = { nonPlace: guard(() => tpc.isNonPlaceDestinationText(u)), valid: guard(() => tpc.isValidParsedDestinationLabel(u)),
        parse: guard(() => tpc.parseDestinationFromText(u) ?? null), re: NEARBY_RESIDUE_RE.test(u) };
    }
    // which parser leaves 「eat」 for 「anything good to eat?」 (source locator, new chat)
    {
      const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
      const travelContext = await load("src/lib/ai/travel-context.ts");
      const planningFlow = await load("src/lib/chat-planning-flow.ts");
      for (const u of ["anything good to eat?", "something good to eat", "is there anything good to eat here?", "anything good to eat nearby?"]) {
        const e = sessionMod.createEmptySession();
        R[`NS|${u}`] = {
          tripIntent: guard(() => { const x = tripIntent.parseTripIntentFromText(u, structuredClone(e)); return `city=${x.destinationCity ?? "-"} area=${x.destinationArea ?? "-"}`; }),
          applyTripIntent: guard(() => { const x = tripIntent.applyTripIntentToSession(u, structuredClone(e)); return `tc.dest=${x.travelContext?.destination ?? "-"} tpc=${x.tripPlanningContext?.destination ?? "-"} trip=${x.tripDestination?.city ?? "-"}`; }),
          merge: guard(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); return `dest=${m.context.destination ?? "-"} cand=${m.context.destinationCandidate?.raw ?? "-"}`; }),
          tpcMerge: guard(() => { const m = tpc.mergeTripPlanningContext(u, structuredClone(e), { interests: [] }); return `tc.dest=${m.session?.travelContext?.destination ?? "-"} tpc=${m.session?.tripPlanningContext?.destination ?? "-"}`; }),
          hints: guard(() => { const x = sessionMod.extractPlanningHintsFromText(u, structuredClone(e)); return `tc.dest=${x.travelContext?.destination ?? "-"} tpc=${x.tripPlanningContext?.destination ?? "-"}`; }),
          flow: guard(() => { const x = planningFlow.extractChatPlanningContextFromText(u, structuredClone(e)); return `tc.dest=${x.travelContext?.destination ?? "-"} tpc=${x.tripPlanningContext?.destination ?? "-"}`; }),
          gpt: guard(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"}`; }),
          parse: guard(() => tpc.parseDestinationFromText(u) ?? null), resolve: guard(() => tpc.resolveDestinationFromText(u) ?? null),
          nonPlaceEat: guard(() => tpc.isNonPlaceDestinationText("eat")), nonPlaceEatHere: guard(() => tpc.isNonPlaceDestinationText("eat here")),
        };
      }
    }
    for (const loc of LOCS) {
      // re-ask → not yet → nearby → Kinosaki (literal 「not yet」 in every locale)
      R[`NF|${loc}|notyet`] = (await run(loc, [NO[loc], "not yet", "anything good to eat nearby?", "Kinosaki"])).rows;
      // re-ask → nearby (no hesitation) → Kinosaki
      R[`NF|${loc}|direct`] = (await run(loc, [NO[loc], "anything good to eat nearby?", "Kinosaki"])).rows;
      // re-ask → not yet → nearby → Kinosaki → days (combinations)
      R[`NF|${loc}|toDays`] = (await run(loc, [NO[loc], "not yet", "anything good to eat nearby?", "Kinosaki", DAYS[loc]])).rows;
      for (const v of ["anything good to eat nearby?", "eat nearby", "nearby", "near me", "around here", "to eat nearby", "anything good to eat?", "what's good to eat around here?", "anything near me?", "is there anything good to eat here?", "something good to eat"]) {
        await fresh(loc); const f = await turnS(sessionMod.createEmptySession(), v, loc);
        const fk = f.s ? await turnS(nextOf(f), "Kinosaki", loc) : null;
        const re = await run(loc, [NO[loc], v, "Kinosaki"]);
        R[`NV|${loc}|${v}`] = { fresh: f.row, freshKino: fk?.row ?? null, reask: re.rows };
      }
      for (const nm of ["Near Islands", "Near East", "Nearchos", "Linear Park"]) {
        const re = await run(loc, [NO[loc], nm]);
        await fresh(loc); const f = await turnS(sessionMod.createEmptySession(), nm, loc);
        await fresh(loc); const g = await turnS(sessionMod.createEmptySession(), loc === "en" ? `I'm going to ${nm}` : GO[loc](nm), loc);
        R[`NN|${loc}|${nm}`] = { reask: re.rows[1] ?? null, fresh: f.row, go: g.row };
      }
      const CJK = { "zh-TW": ["附近有什麼好吃的", "附近景點", "我附近的咖啡廳"], en: ["附近有什麼好吃的"], ja: ["近くに美味しいものある？", "近くのカフェ"], ko: ["근처에 맛집 있어?", "근처 카페"] }[loc];
      for (const c of CJK) {
        await fresh(loc); const f = await turnS(sessionMod.createEmptySession(), c, loc);
        const re = await run(loc, [NO[loc], c, "Kinosaki"]);
        R[`NC|${loc}|${c}`] = { fresh: f.row, reask: re.rows };
      }
    }
  }

  // ------------------------------------------------------------------ o) omakase probe
  if (want("o")) {
    const chatIntent = await load("src/lib/ai/chat-intent.ts");
    const dining = await load("src/lib/ai/chat-dining-flow.ts");
    const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
    const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
    const placeRec = await load("src/lib/ai/place-recommendation-intent/parse.ts");
    const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
    const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
    const mustVisit = await load("src/lib/ai/must-visit-places.ts");
    const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
    const catRec = await load("src/lib/ai/chat-destination-category-recommendation.ts");
    const nearbyRec = await load("src/lib/ai/chat-place-recommendation.ts");
    const planSession = await load("src/lib/ai/ai-planning-session.ts");
    const router = await loadOpt("src/lib/ai/chat-intent-router.ts");
    const destTravelProfile = await load("src/lib/ai/destination-travel-profile.ts");
    let bump = 0;

    const builtStages = {};
    for (const loc of LOCS) {
      const st = { new: sessionMod.createEmptySession() };
      const tk = await runFrom(loc, sessionMod.createEmptySession(), [GO[loc](TOKYO[loc]), DAYS[loc], "1"]);
      st.tokyoAskDays = tk.states[1]; st.tokyoCombos = tk.states[2];
      R[`OS|${loc}|tokyo`] = tk.rows;
      const done = (s, id) => s && planSession.clearPlanningSessionState({ ...structuredClone(s), phase: "done", aiItineraryState: "SUCCESS", lastGeneratedTripId: id }, "trip_created");
      st.tokyoDone = done(tk.states[3], "trip_tokyo");
      const tp = await runFrom(loc, sessionMod.createEmptySession(), [GO[loc](TAIPEI[loc]), DAYS[loc], "1"]);
      R[`OS|${loc}|taipei`] = tp.rows;
      st.taipeiDone = done(tp.states[3], "trip_taipei");
      st.reask = (await run(loc, [NO[loc]])).states[1];
      builtStages[loc] = st;
    }
    // allOrAuto controls at combination_choice (Tokyo): whole-reply all / mix words vs おまかせ variants
    for (const loc of LOCS) {
      const st = builtStages[loc].tokyoCombos;
      if (!st) continue;
      for (const c of ["all", "mix them", "全部", "すべて", "おまかせ", "おまかせで", "お任せします", "おまかせ寿司", "omakase", "오마카세", "알아서", "전부"]) {
        await fresh(loc); const a = await turnS(st, c, loc);
        R[`OC|${loc}|${c}`] = { allOrAuto: guard(() => combo.isUserAllOrAutoCombinationReply(c)), turn: a.row };
      }
    }
    for (const [t, loc] of OMA) {
      for (const [stage, s0] of Object.entries(builtStages[loc])) {
        if (!s0) { R[`O|${t}|${stage}`] = { missing: true }; continue; }
        const row = {};
        const ctx0 = s0.travelContext ?? { interests: [] };
        row.sig = {
          detect: guard(() => chatIntent.detectChatIntent(t)),
          resolveIntent: guard(() => dining.resolveChatIntent(t, structuredClone(s0))),
          explicitNearby: guard(() => chatIntent.userExplicitlyWantsNearbyPlaces(t)),
          inferNearby: guard(() => chatIntent.inferNearbyIntentFromContext(ctx0, t, structuredClone(s0)) ?? null),
          hasCat: guard(() => catTypes.hasCategoryPlaceQuery(t)),
          catIntents: guard(() => placeIntent.parseChatPlaceIntents(t).join(",") || "-"),
          placeRec: guard(() => { const p = placeRec.parsePlaceRecommendationIntent(t); return p ? `${p.primaryType}[${p.subtypes.join(",")}]dest=${p.destinationName ?? "-"}` : null; }),
          allOrAuto: guard(() => combo.isUserAllOrAutoCombinationReply(t)),
          parseDest: guard(() => tpc.parseDestinationFromText(t) ?? null),
          resolveDest: guard(() => tpc.resolveDestinationFromText(t) ?? null),
          nonPlace: guard(() => tpc.isNonPlaceDestinationText(t)),
          gpt: guard(() => { const x = gpc.globalPlanningTurn(structuredClone(s0), t); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate ? `${x.destinationCandidate.raw}/${x.destinationCandidate.status}` : "-"}`; }),
          arb: guard(() => arbitrate.resolveChatIntentArbitration(t, structuredClone(s0)).route),
          travelPlanning: guard(() => router?.isTravelPlanningText?.(t) ?? "n/a"),
        };
        await fresh(loc);
        const a = await turnS(s0, t, loc);
        row.turn = a.row;
        const n = a.s ?? s0;
        const pc = guard(() => mustVisit.mergeContextForPlaceFetch(n.travelContext ?? { interests: [] }, n));
        const pcObj = typeof pc === "object" ? pc : (n.travelContext ?? { interests: [] });
        const catFetch = guard(() => placeIntent.shouldFetchDestinationCategoryPlaces(t, pcObj, n));
        const catDestName = guard(() => placeIntent.resolveDestinationForCategorySearch(pcObj, n, t) ?? null);
        row.sig.provisionalArea = guard(() => { const p = destTravelProfile.extractProvisionalDestinationAreaCandidate(t); return p ? (p.rawLabel ?? JSON.stringify(p).slice(0, 60)) : null; });
        const resolvedIntent = row.sig.resolveIntent;
        const nearbyIntent = (typeof resolvedIntent === "string" && chatIntent.isNearbyPlaceIntent(resolvedIntent) ? resolvedIntent : null) ?? row.sig.inferNearby ?? null;
        const authority = guard(() => nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: row.sig.explicitNearby === true,
          pendingNearbyLocationRequest: Boolean(n.pendingNearbyLocationRequest), resolvedNearbyIntent: nearbyIntent, categoryPlaceQuery: catFetch === true }));
        row.route = { catFetch, catDestName, nearbyIntent, authority };
        // Places requests (mock provider: records the request, returns fake sushi places)
        const reqs = [];
        bump++; // distinct coordinates per row: the in-process Places result cache must not hide later requests
        const mkPlaces = (data) => { const [lat, lng] = [data.lat || 35.6762, data.lng || 139.6503]; return Array.from({ length: 6 }, (_, i) => ({ id: `ChIJmock${i}`, name: `Mock Sushi ${i + 1}`, lat: lat + i * 0.001, lng, types: ["restaurant", "japanese_restaurant", "sushi_restaurant", "food"], primaryType: "sushi_restaurant", rating: 4.6, userRatingCount: 800, address: `${data.destinationName ?? "Tokyo"}`, businessStatus: "OPERATIONAL" })); };
        const searchPlaces = async ({ data }) => { reqs.push(`${data.mode}:「${data.query}」types=${(data.includedTypes ?? []).join("/") || "-"}${data.intentCategory ? ` cat=${data.intentCategory}` : ""}${data.searchMode ? ` sm=${data.searchMode}` : ""}`); return { places: mkPlaces(data), error: null, rawCount: 6 }; };
        const catGeo = [];
        const geocodeFn = async ({ data }) => { catGeo.push(data.query); const [lat0, lng] = CENTER[centerOf(data.query)]; const lat = lat0 + bump * 0.0001; return { location: { placeId: `ChIJ_${centerOf(data.query)}`, city: data.query, country: centerOf(data.query) === "taipei" ? "Taiwan" : centerOf(data.query) === "seoul" ? "South Korea" : "Japan", lat, lng, formattedName: data.query, displayLabel: data.query }, error: null }; };
        if (authority === "destination_category") {
          const dest = (typeof catDestName === "string" && catDestName !== "undef" && catDestName) || n.travelContext?.destination || n.tripDestination?.city || "";
          if (!dest) {
            // _app.chat.tsx pushDestinationCategoryPlaceRecommendation: no turnSearchDestination → returns false (no Places request).
            row.places = { kind: "category(no destination → App returns false before Places, _app.chat.tsx:6705)", reqs };
            R[`O|${t}|${stage}`] = row; continue;
          }
          try {
            const intents = placeIntent.parseChatPlaceIntents(t);
            const r = await withTimeout(catRec.buildDestinationCategoryRecommendations({ destination: dest, intents, userText: t, context: pcObj, locale: loc, searchPlaces, geocodeFn, session: n }), 8000);
            row.places = { kind: `category(dest=${dest})`, reqs, catGeo, cards: r.recommendations.length, reply: (r.summary ?? "").replace(/\n/g, " / ").slice(0, 200) };
          } catch (e) { row.places = { kind: `category(dest=${dest})`, reqs, catGeo, err: String(e?.message ?? e).slice(0, 120) }; }
        } else if (authority === "nearby" && !nearbyIntent) {
          // shouldAllowNearbyDispatch needs a nearbyIntent; without one the App uses the legacy gate (not replicated here).
          row.places = { kind: "nearby authority but nearbyIntent=null (no nearby dispatch by authority; legacy gate — 推測 no Places)", reqs };
        } else if (authority === "nearby") {
          const ni = nearbyIntent;
          const clar = guard(() => nearbyClar.buildNearbyLocationClarificationCopy(t, ni, loc).renderedCopy);
          try {
            const [lat0, lng] = CENTER.tokyo; const lat = lat0 + bump * 0.0001;
            const r = await withTimeout(nearbyRec.buildNearbyPlaceRecommendation({ intent: ni, lat, lng, locale: loc, context: pcObj, searchPlaces, userText: t, foodPreference: dining.parseFoodPreference?.(t) }), 8000);
            row.places = { kind: `nearby(${ni}, device=Tokyo)`, noLocationReply: clar, reqs, cards: r.recommendations.length, reply: (r.summary ?? "").replace(/\n/g, " / ").slice(0, 200) };
          } catch (e) { row.places = { kind: `nearby(${ni}, device=Tokyo)`, noLocationReply: clar, reqs, err: String(e?.message ?? e).slice(0, 120) }; }
        } else {
          row.places = { kind: "none", reqs };
        }
        R[`O|${t}|${stage}`] = row;
      }
    }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D21_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d21.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D21_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} days=${x.days ?? "-"} off=${x.offered ?? "-"} nSel=${x.nSel ?? 0} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const took = (x) => [x?.dest, x?.trip, x?.cand?.split("/")[0]].filter(Boolean).some((v) => KINO_RE.test(String(v)));
  const bad = (x) => [x?.dest, x?.cand?.split("/")[0]].filter(Boolean).some((v) => BAD_DEST_RE.test(String(v).trim()));
  const geoBad = (x) => (x?.q ?? "").split("|").filter(Boolean).some((q) => BAD_DEST_RE.test(q.replace(/^[gad]:/, "").trim()));
  out("==== seeds ====");
  for (const loc of LOCS) out(`-- ${loc} W seed=${WR[`SEED|${loc}`]?.seed} | H seed=${HR?.[`SEED|${loc}`]?.seed ?? "n/a"}`);
  if (want("n")) {
    out("\n==== NU) guard unit rows (W | H) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NU|"))) {
      const u = k.slice(3); const w = WR[k]; const h = HR?.[k];
      out(`  「${u}」 W nonPlace=${w.nonPlace} valid=${w.valid} parse=${JSON.stringify(w.parse)} re=${w.re} | H nonPlace=${h?.nonPlace ?? "n/a"} valid=${h?.valid ?? "n/a"} parse=${JSON.stringify(h?.parse ?? "n/a")}`);
      const mustBlock = ["eat nearby", "nearby", "near me", "around here", "to eat nearby", "Eat Nearby", "NEAR ME", "anything good to eat", "good to eat nearby"];
      const mustPass = ["Near Islands", "Near East", "Nearchos", "Linear Park", "Kearney", "京都", "Kinosaki"];
      if (mustBlock.includes(u) && w.nonPlace !== true) fail(k, "must be non-place");
      if (mustPass.includes(u) && w.nonPlace !== false) fail(k, "Near-named / real place blocked");
      // HEAD has no isNonPlaceDestinationText: compare only when both sides are booleans; the diff regex itself must never match CJK.
      if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}]/u.test(u) && (w.re || (typeof h?.nonPlace === "boolean" && w.nonPlace !== h.nonPlace))) fail(k, `CJK changed: W ${w.nonPlace} H ${h?.nonPlace}`);
      if (h && (w.valid !== h.valid || JSON.stringify(w.parse) !== JSON.stringify(h.parse)) && h.parse !== "n/a") notes.push(`NU diff vs HEAD 「${u}」 valid W=${w.valid} H=${h.valid} parse W=${JSON.stringify(w.parse)} H=${JSON.stringify(h.parse)}`);
      if (u === "Good to Eat Cafe" && w.nonPlace === true) notes.push(`NU 「Good to Eat Cafe」 (a shop name containing 'good to eat') is non-place on W (HEAD ${h?.nonPlace ?? "n/a"}) — unanchored \\bgood\\s+to\\s+eat\\b`);
      if (u === "Nearby Hostel Tokyo") notes.push(`NU 「Nearby Hostel Tokyo」 W nonPlace=${w.nonPlace} (H ${h?.nonPlace ?? "n/a"})`);
    }
    out("\n==== NS) source locator: which step leaves 「eat」 ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NS|"))) out(`  ${k}\n     W ${JSON.stringify(WR[k])}\n     H ${JSON.stringify(HR?.[k] ?? null)}`);
    out("\n==== NF) re-ask → (not yet) → anything good to eat nearby? → Kinosaki ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NF|"))) {
      const w = WR[k]; const h = HR?.[k] ?? [];
      out(`\n-- ${k}`);
      w.forEach((r, i) => { out(`  ${i + 1} 「${r.t}」 W ${fa(r)}\n        W reply: ${r.reply}\n        H ${fa(h[i])}`); });
      const near = w.find((r) => r.t === "anything good to eat nearby?");
      const kino = w.find((r) => r.t === "Kinosaki");
      if (near && (bad(near) || geoBad(near))) fail(`${k}#nearby`, `nearby residue became dest/cand/geocode: ${fa(near)}`);
      if (!kino || !(kino.geo === 1 && kino.p === "ask_days" && took(kino))) fail(`${k}#Kinosaki`, `need geo 1 + ask_days + Kinosaki: ${fa(kino)} | H ${fa(h.find((r) => r.t === "Kinosaki"))}`);
      const nt = w.find((r) => r.t === "not yet");
      if (nt && (nt.geo !== 0 || nt.cand || nt.dest)) fail(`${k}#not yet`, `not yet geocoded / set: ${fa(nt)}`);
      const d = w.find((r) => r.t === DAYS[k.split("|")[1]]);
      if (k.endsWith("|toDays") && !(d && d.p === "combination_choice" && d.offered > 0)) fail(`${k}#days`, `no combinations: ${fa(d)}`);
    }
    out("\n==== NV) nearby wordings: new chat / new chat → Kinosaki / re-ask → wording → Kinosaki ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NV|"))) {
      const w = WR[k]; const h = HR?.[k];
      const rv = w.reask[1]; const rk = w.reask[2];
      out(`  ${k}\n     new W ${fa(w.fresh)} | H ${fa(h?.fresh)}\n         W reply: ${w.fresh?.reply ?? "-"}\n     new→Kino W ${fa(w.freshKino)}\n     reask W ${fa(rv)} → Kino ${fa(rk)}\n         W reply: ${rv?.reply ?? "-"} → ${rk?.reply ?? "-"}\n     reask H ${fa(h?.reask?.[1])} → Kino ${fa(h?.reask?.[2])}`);
      if (bad(w.fresh) || geoBad(w.fresh)) fail(`${k}#new`, `new chat nearby residue as dest/cand/geo: ${fa(w.fresh)}`);
      if (rv && (bad(rv) || geoBad(rv))) fail(`${k}#reask`, `re-ask nearby residue as dest/cand/geo: ${fa(rv)}`);
      if (!rk || !(rk.geo === 1 && rk.p === "ask_days" && took(rk))) {
        const hk = h?.reask?.[2];
        if (hk && hk.geo === 1 && hk.p === "ask_days" && took(hk)) fail(`${k}#Kino`, `REGRESSION Kinosaki after re-ask→wording: ${fa(rk)} | H ${fa(hk)}`);
        else notes.push(`NV ${k} re-ask → wording → Kinosaki not taken (HEAD same/n.a.): W ${fa(rk)} | H ${fa(hk)}`);
      }
      if (w.freshKino && !took(w.freshKino)) notes.push(`NV ${k} new chat → wording → Kinosaki: ${fa(w.freshKino)}`);
      // requirement: a string containing 「good to eat」 never becomes a destination (any residue, e.g. 「eat」)
      const v = k.split("|").slice(2).join("|");
      if (/good to eat/i.test(v)) {
        for (const [lab, x, hx] of [["new", w.fresh, h?.fresh], ["reask", rv, h?.reask?.[1]]]) {
          if (x?.dest || (x?.cand && !/resolved/.test(x.cand) && x.cand.split("/")[0] !== "")) fail(`${k}#${lab}-goodToEat`, `「${v}」 left dest=${x.dest} cand=${x.cand ?? "-"} reply 「${x.reply}」 | HEAD dest=${hx?.dest ?? "n/a"} cand=${hx?.cand ?? "-"}`);
        }
      }
    }
    out("\n==== NN) Near-named real places ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NN|"))) {
      const w = WR[k]; const h = HR?.[k]; const nm = k.split("|")[2];
      out(`  ${k}\n     reask W ${fa(w.reask)} | H ${fa(h?.reask)}\n     new   W ${fa(w.fresh)} | H ${fa(h?.fresh)}\n     go    W ${fa(w.go)} | H ${fa(h?.go)}`);
      const qOk = (x) => (x?.q ?? "").toLowerCase().includes(nm.toLowerCase());
      if (nm === "Near Islands" && !(w.reask?.geo >= 1 && qOk(w.reask))) fail(`${k}#reask`, `Near Islands not geocoded after re-ask: ${fa(w.reask)}`);
      for (const [lab, x, hx] of [["reask", w.reask, h?.reask], ["new", w.fresh, h?.fresh], ["go", w.go, h?.go]]) {
        if (hx && (hx.geo !== x?.geo || hx.dest !== x?.dest || hx.p !== x?.p)) {
          const regress = qOk(hx) && !qOk(x);
          if (regress) fail(`${k}#${lab}`, `REGRESSION: HEAD geocoded ${nm}, W does not: W ${fa(x)} | H ${fa(hx)}`);
          else notes.push(`NN diff ${k}#${lab}: W ${fa(x)} | H ${fa(hx)}`);
        }
      }
    }
    out("\n==== NC) CJK 附近 / 近く / 근처 (W vs HEAD) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NC|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k}\n     new W ${fa(w.fresh)} | H ${fa(h?.fresh)}\n     reask W ${w.reask.map(fa).join(" → ")}\n     reask H ${(h?.reask ?? []).map(fa).join(" → ")}`);
      if (h && (h.fresh.b !== w.fresh.b || h.fresh.dest !== w.fresh.dest || h.fresh.geo !== w.fresh.geo || h.fresh.p !== w.fresh.p)) notes.push(`NC new-chat diff vs HEAD ${k}: W ${fa(w.fresh)} | H ${fa(h.fresh)}`);
      const wk = w.reask[2]; const hk = h?.reask?.[2];
      if (hk && took(hk) && !took(wk)) fail(`${k}#Kino`, `REGRESSION CJK nearby → Kinosaki: W ${fa(wk)} | H ${fa(hk)}`);
      if (h && h.reask[1] && (h.reask[1].dest !== w.reask[1]?.dest || h.reask[1].geo !== w.reask[1]?.geo)) notes.push(`NC re-ask diff vs HEAD ${k}: W ${fa(w.reask[1])} | H ${fa(h.reask[1])}`);
    }
  }
  if (want("o")) {
    out("\n==== OS) stage builders ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("OS|"))) out(`  ${k}: ${WR[k].map((r) => `「${r.t}」[${r.b}] p=${r.p} dest=${r.dest} off=${r.offered} nSel=${r.nSel}`).join(" → ")}\n     H: ${(HR?.[k] ?? []).map((r) => `「${r.t}」p=${r.p} dest=${r.dest} off=${r.offered} nSel=${r.nSel}`).join(" → ")}`);
    out("\n==== OC) combination_choice (Tokyo) — all / mix / おまかせ controls ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("OC|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k} W allOrAuto=${w.allOrAuto} ${fa(w.turn)} sel=${w.turn.selTitle ?? "-"}\n      offered: ${w.turn.offeredTitles ?? "-"}\n      reply: ${w.turn.reply}\n      H allOrAuto=${h?.allOrAuto ?? "n/a"} ${fa(h?.turn)} sel=${h?.turn?.selTitle ?? "-"}`);
    }
    out("\n==== O) omakase × stage ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("O|"))) {
      const w = WR[k]; const h = HR?.[k];
      if (w.missing) { out(`  ${k}: stage missing`); continue; }
      const s = w.sig;
      out(`\n  ${k}`);
      out(`    sig W detect=${s.detect} resolveIntent=${s.resolveIntent} arb=${s.arb} explicitNearby=${s.explicitNearby} inferNearby=${s.inferNearby} hasCat=${s.hasCat} catIntents=${s.catIntents} placeRec=${s.placeRec} allOrAuto=${s.allOrAuto} parseDest=${s.parseDest} resolveDest=${s.resolveDest} nonPlace=${s.nonPlace} provisionalArea=${s.provisionalArea} gpt=${s.gpt}`);
      if (h?.sig) {
        const diffs = Object.keys(s).filter((x) => JSON.stringify(s[x]) !== JSON.stringify(h.sig[x])).map((x) => `${x}: W=${s[x]} H=${h.sig[x]}`);
        out(`    sig H ${diffs.length ? `DIFF ${diffs.join("; ")}` : "same"}`);
      }
      out(`    route W cat=${w.route.catFetch} catDest=${w.route.catDestName} nearbyIntent=${w.route.nearbyIntent} authority=${w.route.authority} | H authority=${h?.route?.authority ?? "n/a"} cat=${h?.route?.catFetch ?? "n/a"} catDest=${h?.route?.catDestName ?? "n/a"}`);
      out(`    turn W ${fa(w.turn)}\n         reply: ${w.turn.reply}\n    turn H ${fa(h?.turn)}`);
      const pl = w.places;
      out(`    places W ${pl.kind}${pl.catGeo?.length ? ` geocode=${pl.catGeo.join("|")}` : ""} reqs(${pl.reqs.length})=${pl.reqs.join(" ‖ ") || "-"}${pl.err ? ` ERR ${pl.err}` : ""}`);
      if (pl.noLocationReply) out(`         no-location reply: ${pl.noLocationReply}`);
      if (pl.reply !== undefined) out(`         cards=${pl.cards} reply: ${pl.reply}`);
      if (h?.places) out(`    places H ${h.places.kind} reqs=${JSON.stringify(h.places.reqs) === JSON.stringify(pl.reqs) ? "same" : (h.places.reqs.join(" ‖ ") || "-")}`);
      if (s.allOrAuto === true) notes.push(`O allOrAuto ${k}: whole-reply 「${k.split("|")[1]}」 read as all/auto (stage ${k.split("|")[2]}; turn nSel=${w.turn.nSel} offered=${w.turn.offered})`);
      if (w.turn.geo > 0) notes.push(`O geocode ${k}: ${w.turn.q} → dest=${w.turn.dest} cand=${w.turn.cand} (H geo=${h?.turn?.geo ?? "n/a"} ${h?.turn?.q ?? ""})`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
