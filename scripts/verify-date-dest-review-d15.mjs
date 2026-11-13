import "./verify-netguard-full.mjs";
/**
 * D15 (tester, independent review: city re-ask after 「不是」). W (working tree) vs H (HEAD snapshot via --head-dir).
 * Harness: App-order turn from verify-m16-post-selection-switch-review.mjs (same slice as verify-date-dest-review-d13.mjs),
 * geocode calls counted (resolveGlobalPlanningCandidate + authority + discovery geocode logs).
 *  R1) seed candidate → bare 「不是」 (city re-asked) → bare city name (App-faithful lastAssistantReply = re-ask copy)
 *      → must take the city with geocode 1 → asks days → 「3天」 → combinations listed. Four locales × required + cold cities.
 *  R2) after the re-ask, non-city replies → geocode must be 0; next step recorded vs HEAD.
 *  R3) the destinationInputNames [] mark: single use (re-ask → hesitation → name / non-place word), no effect with an
 *      existing destination / combinations, legacy-merge turns (globalPlanningTurn undefined) that keep the mark.
 *  K1) 「不是京都，是大阪」 → 3天 → 「1」: why 「1」 is not taken (owner / snapshot / parsePendingOptionSelection / stage bisect).
 *  K2) nearby search after the K flow: cityLabel / query city (library layer of _app.chat.tsx:4045-4655).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d15.mjs -- --head-dir=<snapshot>
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

const LOCS = ["zh-TW", "en", "ja", "ko"];
const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const NO = { "zh-TW": "不是", en: "no", ja: "いいえ", ko: "아니요" };
const DAYS = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const CITIES_REQ = ["熱海", "那霸", "Naha", "Atami", "Nikko", "那覇", "나하", "아타미"];
const CITIES_COLD = ["城崎", "伊根", "美瑛", "高千穗", "鞆の浦", "Kinosaki", "Biei", "Takachiho", "San Pedro de Atacama", "비에이", "키노사키", "다카치호"];
const CITY_RE = {
  熱海: /熱海|Atami|아타미/i, Atami: /熱海|Atami|아타미/i, 아타미: /熱海|Atami|아타미/i,
  那霸: /那霸|那覇|Naha|나하/i, Naha: /那霸|那覇|Naha|나하/i, 那覇: /那霸|那覇|Naha|나하/i, 나하: /那霸|那覇|Naha|나하/i,
  Nikko: /Nikko|日光|닛코/i, 城崎: /城崎|Kinosaki|키노사키/i, Kinosaki: /城崎|Kinosaki|키노사키/i, 키노사키: /城崎|Kinosaki|키노사키/i,
  伊根: /伊根|\bIne\b|이네/i, 美瑛: /美瑛|Biei|비에이/i, Biei: /美瑛|Biei|비에이/i, 비에이: /美瑛|Biei|비에이/i,
  高千穗: /高千穗|高千穂|Takachiho|다카치호/i, Takachiho: /高千穗|高千穂|Takachiho|다카치호/i, 다카치호: /高千穗|高千穂|Takachiho|다카치호/i,
  鞆の浦: /鞆の浦|鞆之浦|Tomonoura|도모노우라/i, "San Pedro de Atacama": /Atacama|阿塔卡馬|아타카마/i,
};
const NON_CITY_REQ = ["不是，我再想想", "我再想想", "no thanks", "later", "not yet", "まだ決めてない", "아직 몰라요", "3天", "3 days", "3日間", "3일", "是", "好", "yes"];
const NON_CITY_MINE = ["隨便", "都可以", "你推薦", "anywhere", "you choose", "おすすめで", "아무데나", "再說", "不知道", "surprise me", "溫泉", "海邊", "beach", "hello", "ok", "謝謝", "拉麵", "sushi", "온천", "ラーメン", "便宜一點", "附近有什麼好吃的"];
const HESITATE = { "zh-TW": "我再想想", en: "not yet", ja: "まだ決めてない", ko: "아직 몰라요" };
const NAME_AFTER = { "zh-TW": "那霸", en: "Naha", ja: "那覇", ko: "나하" };
const LINGER = ["溫泉", "beach", "hello", "ok", "拉麵", "sushi", "온천", "ラーメン", "海邊", "Kinosaki"];
const KYOTO = /京都|Kyoto|교토/i;
const GPS = { lat: 25.033, lng: 121.5654, city: "台北市", country: "Taiwan", displayLabel: "台灣・台北市" };

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
  const convState = await load("src/lib/ai/chat-conversation-state.ts");
  const stateMachine = await load("src/lib/ai/chat-state-machine.ts");
  const planSession = await load("src/lib/ai/ai-planning-session.ts");
  const pq = await load("src/lib/ai/destination-pending-question.ts");
  const numericAuth = await loadOpt("src/lib/ai/numeric-selection-authority.ts");
  const searchCtxMod = await loadOpt("src/lib/ai/chat-place-search-context.ts");
  const scopeMod = await loadOpt("src/lib/ai/recommendation-search-scope.ts");
  const chatIntent = await loadOpt("src/lib/ai/chat-intent.ts");
  const nearbyClar = await loadOpt("src/lib/ai/nearby-location-clarification.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const OLD_13058 = 'return dateQuestion("13058");';
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  // fixtures: osaka / naha (as d13) + cold cities; every fixture city has a place pool (combinations can be listed)
  slice = slice.replace("  kamakura: { re: /kamakura",
    '  osaka: { re: /osaka|大阪|오사카/i, city: "Osaka", region: "Osaka", country: "Japan", code: "JP", lat: 34.6937, lng: 135.5023 },\n'
    + '  naha: { re: /naha|那霸|那覇|나하/i, city: "Naha", region: "Okinawa", country: "Japan", code: "JP", lat: 26.2124, lng: 127.6809 },\n'
    + '  kinosaki: { re: /kinosaki|城崎|키노사키/i, city: "Kinosaki", region: "Hyogo", country: "Japan", code: "JP", lat: 35.6255, lng: 134.8093 },\n'
    + '  ine: { re: /\\bine\\b|伊根|이네/i, city: "Ine", region: "Kyoto", country: "Japan", code: "JP", lat: 35.6765, lng: 135.2886 },\n'
    + '  biei: { re: /biei|美瑛|비에이/i, city: "Biei", region: "Hokkaido", country: "Japan", code: "JP", lat: 43.5883, lng: 142.4669 },\n'
    + '  takachiho: { re: /takachiho|高千穂|高千穗|다카치호/i, city: "Takachiho", region: "Miyazaki", country: "Japan", code: "JP", lat: 32.7114, lng: 131.3077 },\n'
    + '  tomonoura: { re: /tomonoura|鞆の浦|鞆之浦|도모노우라/i, city: "Tomonoura", region: "Hiroshima", country: "Japan", code: "JP", lat: 34.3833, lng: 133.3833 },\n'
    + '  atacama: { re: /atacama|阿塔卡馬|아타카마/i, city: "San Pedro de Atacama", region: "Antofagasta", country: "Chile", code: "CL", lat: -22.9087, lng: -68.1997 },\n'
    + '  kamakura: { re: /kamakura')
    .replace('kamakura: ["Kamakura"', 'osaka: ["Osaka", "大阪", "大阪市", "오사카"], naha: ["Naha", "那霸市", "那覇市", "나하시"], '
      + 'kinosaki: ["Kinosaki", "城崎", "城崎", "키노사키"], ine: ["Ine", "伊根", "伊根町", "이네"], biei: ["Biei", "美瑛", "美瑛町", "비에이"], '
      + 'takachiho: ["Takachiho", "高千穗", "高千穂町", "다카치호"], tomonoura: ["Tomonoura", "鞆之浦", "鞆の浦", "도모노우라"], '
      + 'atacama: ["San Pedro de Atacama", "阿塔卡馬", "サン・ペドロ・デ・アタカマ", "산페드로데아타카마"], kamakura: ["Kamakura"')
    .replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, authorityGeocodeFn, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const geoQ = () => [...H.geocodeLog, ...H.authorityGeocodeLog, ...H.discoveryGeocodeLog];
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, base: s.pendingQuestion?.baseDestination ?? null,
      dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null, area: s.preferredArea ?? null, tpcDest: s.tripPlanningContext?.destination ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      inputs: tc.destinationInputNames === undefined ? "undef" : JSON.stringify(tc.destinationInputNames),
      days: tc.days ?? s.tripDays ?? null, loc: s.location ? `${s.location.city ?? "-"}@${s.location.lat},${s.location.lng}` : null,
      offered: (tc.offeredCombinations ?? []).length, sel: (tc.selectedCombinationIds ?? []).join(",") || null,
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 150) };
  };
  const turnS = async (s0, t, loc) => {
    const q0 = geoQ().length;
    try { const r = await H.appTurn(structuredClone(s0), t, loc); const q = geoQ().slice(q0); return { row: { ...snap(r), geo: q.length, q: q.join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }, s: null }; }
  };
  const fresh = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const seedFor = async (loc, base) => {
    for (const t of CAND_SEED[loc]) {
      await fresh(loc);
      let r; try { r = await H.appTurn(structuredClone(base), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: r.s };
    }
    await fresh(loc);
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...base, lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };
  // the re-asked state (App-faithful: the next turn reads the re-ask copy as lastAssistantReply, _app.chat.tsx:11128)
  const reasked = {};
  for (const loc of LOCS) {
    const { seed, s1 } = await seedFor(loc, sessionMod.createEmptySession());
    await fresh(loc);
    const no = await turnS(s1, NO[loc], loc);
    R[`SEED|${loc}`] = { seed, no: no.row };
    reasked[loc] = no.s ? { ...no.s, lastAssistantReply: (no.row.reply ?? "").replace(/ \/ /g, "\n") } : null;
  }
  const gOf = (s, t) => { try { const x = gpc.globalPlanningTurn(structuredClone(s), t); return x === undefined ? "undefined" : `dest=${x.destination ?? "-"} cand=${x.destinationCandidate?.raw ?? "-"} inputs=${JSON.stringify(x.destinationInputNames ?? null)}`; } catch (e) { return `THROW ${e?.message}`; } };

  // ---- R1
  if (want("r1")) for (const loc of LOCS) {
    const base = reasked[loc]; if (!base) continue;
    for (const city of [...CITIES_REQ, ...CITIES_COLD]) {
      await fresh(loc);
      const a = await turnS(base, city, loc);
      let b = null;
      if (a.s) { b = (await turnS({ ...a.s, lastAssistantReply: (a.row.reply ?? "").replace(/ \/ /g, "\n") }, DAYS[loc], loc)).row; }
      R[`R1|${loc}|${city}`] = { a: { ...a.row, g: gOf(base, city) }, b };
    }
  }
  // ---- R2
  if (want("r2")) for (const loc of LOCS) {
    const base = reasked[loc]; if (!base) continue;
    for (const t of [...NON_CITY_REQ, ...NON_CITY_MINE]) { await fresh(loc); R[`R2|${loc}|${t}`] = { ...(await turnS(base, t, loc)).row, g: gOf(base, t) }; }
  }
  // ---- R3 mark
  if (want("r3")) {
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      await fresh(loc);
      const h = await turnS(base, HESITATE[loc], loc);
      R[`M1|${loc}|hes`] = { ...h.row, g: gOf(base, HESITATE[loc]) };
      if (h.s) {
        const hs = { ...h.s, lastAssistantReply: (h.row.reply ?? "").replace(/ \/ /g, "\n") };
        await fresh(loc); R[`M1|${loc}|name`] = { ...(await turnS(hs, NAME_AFTER[loc], loc)).row, g: gOf(hs, NAME_AFTER[loc]) };
        for (const t of LINGER) { await fresh(loc); R[`M1|${loc}|linger|${t}`] = { ...(await turnS(hs, t, loc)).row, g: gOf(hs, t) }; }
        // two more idle turns then a name
        await fresh(loc); const h2 = await turnS(hs, { "zh-TW": "謝謝", en: "thanks", ja: "ありがとう", ko: "고마워요" }[loc], loc);
        R[`M1|${loc}|idle`] = h2.row;
        if (h2.s) { await fresh(loc); R[`M1|${loc}|idle+name`] = (await turnS(h2.s, NAME_AFTER[loc], loc)).row; }
      }
      // controls: the same words on a fresh session (no mark)
      for (const t of LINGER) { await fresh(loc); R[`M0|${loc}|${t}`] = (await turnS(sessionMod.createEmptySession(), t, loc)).row; }
    }
    // M2: existing destination / combinations with the mark injected vs without
    {
      const loc = "zh-TW";
      await fresh(loc); const d = await turnS(sessionMod.createEmptySession(), "我想去大阪", loc);
      await fresh(loc); const c = d.s ? await turnS(d.s, "3天", loc) : null;
      const states = { dest: d.s, combo: c?.s,
        // synthetic: tripDestination kept but travelContext.destination absent
        tripOnly: d.s ? { ...structuredClone(d.s), travelContext: { interests: [] } } : null };
      for (const [sn, st] of Object.entries(states)) {
        if (!st) continue;
        for (const t of ["那霸", "Naha", "hello", "溫泉", "Kinosaki", "3天", "1"]) {
          const marked = { ...structuredClone(st), travelContext: { ...(st.travelContext ?? { interests: [] }), destinationInputNames: [] } };
          await fresh(loc); const wm = await turnS(marked, t, loc);
          await fresh(loc); const wo = await turnS(st, t, loc);
          R[`M2|${sn}|${t}`] = { marked: { ...wm.row, g: gOf(marked, t) }, plain: { ...wo.row, g: gOf(st, t) } };
        }
      }
    }
    // M3: turns where globalPlanningTurn returns undefined (legacy merge) right after the re-ask
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of ["附近有什麼好吃的", "nearby restaurants", "大阪", "Osaka", HESITATE[loc], "hello"]) {
        const g = gOf(base, t);
        await fresh(loc); const a = await turnS(base, t, loc);
        const row = { ...a.row, g };
        if (a.s) {
          const as = { ...a.s, lastAssistantReply: (a.row.reply ?? "").replace(/ \/ /g, "\n") };
          await fresh(loc); row.next = (await turnS(as, "Kinosaki", loc)).row;
          await fresh(loc); row.nextWord = (await turnS(as, "hello", loc)).row;
          // reset helpers keep / drop the mark?
          try { const ns = planSession.startNewPlanningSession(structuredClone(as), "phase_done"); row.afterNewSession = ns.travelContext?.destinationInputNames === undefined ? "undef" : JSON.stringify(ns.travelContext.destinationInputNames); } catch (e) { row.afterNewSession = `THROW ${e?.message}`; }
          // a known-destination legacy turn: follow 3天 → mark still there?
          if (/大阪|Osaka/.test(t) && a.s) {
            await fresh(loc); const f = await turnS(as, DAYS[loc], loc); row.days = f.row;
          }
        }
        R[`M3|${loc}|${t}`] = row;
      }
    }
  }
  // ---- K1 「1」 after 「不是京都，是大阪」 → 3天 (+ control 我想去大阪 → 3天 → 1)
  if (want("k")) {
    const diag = async (kn, s, loc) => {
      const p = s?.pendingQuestion; const d = { p: p?.type ?? null, opts: (p?.options ?? []).length, optsList: p?.options ?? null, owner: Boolean(p?.selectionOwner),
        offeredIds: (s?.travelContext?.offeredCombinations ?? []).map((c) => `${c.id}:${c.title ?? c.name ?? ""}`) };
      if (!p) return d;
      try { d.parse = pq.parsePendingOptionSelection("1", p); } catch (e) { d.parse = `THROW ${e?.message}`; }
      if (numericAuth) {
        d.matches = numericAuth.matchesSelectionOwner(s, p);
        d.reject = numericAuth.rejectNumericSelection(s, "1");
        const bound = numericAuth.bindSelectionOwner({ ...structuredClone(s), workspaceId: "ws_d15", conversationId: "cv_d15" });
        d.boundReject = numericAuth.rejectNumericSelection(bound, "1");
        d.boundMatches = numericAuth.matchesSelectionOwner(bound, bound.pendingQuestion);
      }
      // stage bisect of the 「1」 turn (chainTurn order): which stage stops the selection?
      const t = "1"; const lr = s.lastAssistantReply;
      const probe = (n, ctx) => { try { const r = stateMachine.processAdviceTurn(t, structuredClone(n), structuredClone(ctx ?? n.travelContext ?? { interests: [] }), undefined, loc);
        return `${r.advice?.pendingQuestion?.type ?? "-"} sel=${(r.advice?.contextPatch?.selectedCombinationIds ?? []).join(",") || "-"} ${String(r.advice?.reply ?? "").slice(0, 40).replace(/\n/g, " ")}`; } catch (e) { return `THROW ${e?.message}`; } };
      const st = {};
      let n = structuredClone(s);
      st.raw = probe(n);
      n = tripIntent.applyTripIntentToSession(t, n); st.afterTripIntent = probe(n);
      st.locAfterTripIntent = n.location ? `${n.location.city}@${n.location.lat},${n.location.lng}` : null;
      n = convState.prepareSessionForUserTurn(n, lr); st.afterPrepare = probe(n);
      const merged = travelContext.mergeTravelContext(n, t, lr); n = merged.session; st.afterMerge = probe(n, merged.context);
      st.pAfterMerge = n.pendingQuestion?.type ?? null;
      n = tpc.mergeTripPlanningContext(t, n, merged.context).session; st.afterTpc = probe(n, merged.context);
      const destForSession = merged.context.destination?.trim() || n.tripDestination?.displayLabel?.trim() || n.tripDestination?.city?.trim();
      st.newSession = n.phase === "done" ? "phase_done" : planSession.shouldStartNewPlanningSession(n, destForSession) ? `destination_change(${destForSession})` : "no";
      if (st.newSession !== "no") { const n2 = planSession.startNewPlanningSession(n, "destination_change"); st.afterNewSession = probe(n2, merged.context); st.pAfterNewSession = n2.pendingQuestion?.type ?? null; }
      d.stages = st;
      d.sid = s.planningSessionId ?? null; d.dest = s.travelContext?.destination ?? null; d.base = p.baseDestination ?? null; d.trip = s.tripDestination?.city ?? null;
      d.tpcDest = s.tripPlanningContext?.destination ?? null; d.area = s.preferredArea ?? null;
      return d;
    };
    for (const [kn, loc, seedText, corr] of [["zh", "zh-TW", null, "不是京都，是大阪"], ["zhCtl", "zh-TW", "我想去大阪", null], ["zhDirect", "zh-TW", null, "大阪"], ["en", "en", null, "no, not Kyoto, Osaka"], ["ja", "ja", null, "いいえ、京都じゃなくて、大阪です"]]) {
      let cur;
      if (seedText) { await fresh(loc); cur = await turnS(sessionMod.createEmptySession(), seedText, loc); }
      else { const { s1 } = await seedFor(loc, sessionMod.createEmptySession()); await fresh(loc); cur = await turnS(s1, corr, loc); }
      const rows = [{ t: seedText ?? corr, ...cur.row }];
      if (cur.s) { cur = await turnS(cur.s, DAYS[loc], loc); rows.push({ t: DAYS[loc], ...cur.row }); }
      const dg = cur.s ? await diag(kn, cur.s, loc) : null;
      let one = null;
      if (cur.s) { one = await turnS(cur.s, "1", loc); rows.push({ t: "1", ...one.row }); }
      R[`K1|${kn}`] = { rows, diag: dg };
      // K2 nearby after the flow (state after 「1」, and state at combination_choice)
      if (want("k2") && (kn === "zh" || kn === "en" || kn === "ja")) {
        for (const [stn, st0] of [["afterOne", one?.s], ["atCombos", cur.s]]) {
          if (!st0) continue;
          for (const gps of [false, true]) {
            const st = gps ? { ...structuredClone(st0), location: { ...(st0.location ?? {}), lat: GPS.lat, lng: GPS.lng } } : st0;
            for (const t of ["附近有什麼好吃的", "附近景點", "nearby restaurants", "我附近有什麼好吃的", "restaurants near me"]) {
              R[`K2|${kn}|${stn}|${gps ? "gps" : "nogps"}|${t}`] = await nearbyProbe(st, t, loc);
            }
          }
        }
      }
    }
  }
  async function nearbyProbe(s0, t, loc) {
    const r = { locIn: s0.location ? `${s0.location.city}@${s0.location.lat},${s0.location.lng}` : null };
    if (!searchCtxMod || !scopeMod) return { ...r, skip: "modules missing" };
    try {
      const geoCalls = [];
      const geocodeFn = async (req) => { geoCalls.push(req.data.query); return H.authorityGeocodeFn(req); };
      const merged = travelContext.mergeTravelContext(structuredClone(s0), t, s0.lastAssistantReply);
      const ws = merged.session;
      const explicitDevice = scopeMod.isExplicitDeviceNearbyRequest(t);
      const shouldResolve = explicitDevice || (nearbyClar?.shouldResolveNearbyCurrentLocation?.({ userText: t, structuredShortcut: false }) ?? false);
      const wantsNearby = chatIntent?.userExplicitlyWantsNearbyPlaces?.(t) ?? false;
      // resolveChatLocation (_app.chat.tsx:4133) modeled: device unavailable → session unchanged (推測 for the device path)
      const ds = ws;
      const hasDevice = ds.location?.lat != null && ds.location?.lng != null;
      const searchCtx = await searchCtxMod.resolveChatPlaceSearchContext({ context: merged.context, session: ds, userText: t, locale: loc, geocodeFn,
        deviceLatLng: shouldResolve && hasDevice ? { lat: ds.location.lat, lng: ds.location.lng } : null });
      const raw = scopeMod.resolveRecommendationSearchCenter({ userText: t, session: ds, context: merged.context, destinationLatLng: searchCtx.destinationLatLng,
        destinationName: searchCtx.destinationName, deviceLatLng: hasDevice ? { lat: ds.location.lat, lng: ds.location.lng } : null });
      const explicitGps = wantsNearby && hasDevice;
      const ctxMode0 = searchCtx.searchMode; const ctxDest0 = searchCtx.destinationName ?? null; const ctxLatLng0 = searchCtx.destinationLatLng ? `${searchCtx.destinationLatLng.lat},${searchCtx.destinationLatLng.lng}` : null;
      // _app.chat.tsx:4193-4228 (persisted authority → explicit nearby GPS → resolveRecommendationSearchCenter)
      const center = ds.nearbyLocationAuthority ? { mode: "current_location", label: ds.nearbyLocationAuthority.displayLabel, src: "persisted", deviceLocationUsed: ds.nearbyLocationAuthority.source === "device" }
        : explicitGps ? { mode: "current_location", label: ds.location?.city, src: "explicitNearbyGps", latitude: ds.location.lat, longitude: ds.location.lng, deviceLocationUsed: true } : raw;
      r.ctxMode0 = ctxMode0; r.ctxDest0 = ctxDest0; r.ctxLatLng0 = ctxLatLng0;
      let label;
      if (center) {
        if (searchCtx.searchMode === "destination" && center.deviceLocationUsed) label = searchCtx.destinationLatLng ? searchCtx.destinationName : "(skipped)";
        else { label = center.label ?? center.destination; if (center.mode === "current_location") { searchCtx.searchMode = "nearby"; delete searchCtx.destinationName; } }
      } else if (searchCtx.searchMode === "destination") label = searchCtx.destinationName;
      const cityLabel = label ?? (searchCtx.searchMode === "destination" ? searchCtx.destinationName : (ds.location?.city ?? merged.context.destination));
      return { ...r, mergedDest: merged.context.destination ?? null, wsLoc: ws.location ? `${ws.location.city}@${ws.location.lat},${ws.location.lng}` : null,
        explicitDevice, shouldResolve, wantsNearby, mode: searchCtx.searchMode, destName: searchCtx.destinationName ?? null,
        centerMode: center?.mode ?? null, centerLabel: center?.label ?? null, centerDest: center?.destination ?? null, centerSrc: center?.source ?? center?.src ?? null,
        cityLabel: cityLabel ?? null, geo: geoCalls.join("|"),
        saveCity: null };
    } catch (e) { return { ...r, err: String(e?.message ?? e).slice(0, 120) }; }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D15_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d15.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D15_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} cand=${x.cand ?? "-"} inputs=${x.inputs} days=${x.days ?? "-"} off=${x.offered ?? "-"} sel=${x.sel ?? "-"} loc=${x.loc ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}${x.g ? ` g=${x.g}` : ""} | ${x.reply ?? ""}`;
  const took = (x, re) => [x?.dest, x?.trip, x?.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v))) && !/destination_clarification/.test(x?.b ?? "");

  out("==== seeds / re-ask ====");
  for (const loc of LOCS) { out(`-- ${loc} seed W=${WR[`SEED|${loc}`]?.seed} H=${HR?.[`SEED|${loc}`]?.seed ?? "n/a"}`); out(`   W no ${fa(WR[`SEED|${loc}`]?.no)}`); if (HR) out(`   H no ${fa(HR[`SEED|${loc}`]?.no)}`); }

  if (want("r1")) {
    out("\n==== R1) re-ask → bare city → days → 3天 → combinations ====");
    for (const loc of LOCS) for (const city of [...CITIES_REQ, ...CITIES_COLD]) {
      const k = `R1|${loc}|${city}`; const w = WR[k]; const h = HR?.[k]; if (!w) { fail(k, "missing"); continue; }
      const re = CITY_RE[city];
      const wTook = took(w.a, re); const geoOk = w.a.geo === 1; const askDays = w.a.p === "ask_days";
      const combos = w.b?.p === "combination_choice" && (w.b?.offered ?? 0) > 0;
      const req = CITIES_REQ.includes(city);
      const ok = wTook && geoOk && askDays && combos;
      const hTook = h ? took(h.a, re) : null;
      const tag = ok ? "ok" : req ? "BAD" : "LIMIT";
      if (!ok && req) fail(k, `took=${wTook} geo=${w.a.geo} askDays=${askDays} combos=${combos}`);
      if (!ok && !req) notes.push(`LIMIT R1 cold ${loc} 「${city}」 took=${wTook} geo=${w.a.geo} askDays=${askDays} combos=${combos} (HEAD took=${hTook})`);
      out(`${tag.padEnd(5)} ${loc} 「${city}」 W took=${wTook} geo=${w.a.geo} p=${w.a.p} → ${DAYS[loc]} p=${w.b?.p} off=${w.b?.offered} | H took=${hTook} geo=${h?.a?.geo ?? "n/a"} p=${h?.a?.p ?? "n/a"} → p=${h?.b?.p ?? "n/a"} off=${h?.b?.offered ?? "n/a"}`);
      if (!ok || argv.includes("--verbose")) { out(`    W a ${fa(w.a)}`); out(`    W b ${fa(w.b)}`); if (HR) { out(`    H a ${fa(h?.a)}`); out(`    H b ${fa(h?.b)}`); } }
    }
  }
  if (want("r2")) {
    out("\n==== R2) re-ask → non-city reply: geocode must be 0 ====");
    for (const loc of LOCS) for (const t of [...NON_CITY_REQ, ...NON_CITY_MINE]) {
      const k = `R2|${loc}|${t}`; const w = WR[k]; const h = HR?.[k]; if (!w) { fail(k, "missing"); continue; }
      const ok = w.geo === 0 && !w.cand && !w.dest;
      // 3天 / 3 days … : no geocode and no destination (days may be kept)
      if (!ok) fail(k, fa(w));
      out(`${(ok ? "ok" : "BAD").padEnd(5)} ${loc} 「${t}」 W [${w.b}] p=${w.p ?? "-"} geo=${w.geo} days=${w.days ?? "-"} inputs=${w.inputs} | H [${h?.b ?? "n/a"}] geo=${h?.geo ?? "n/a"}${h?.q ? `(${h.q})` : ""} cand=${h?.cand ?? "-"}`);
      out(`    W reply: ${w.reply}`);
      if (HR && h) out(`    H reply: ${h.reply}`);
    }
  }
  if (want("r3")) {
    out("\n==== R3) mark single use / leaks ====");
    for (const loc of LOCS) {
      const hes = WR[`M1|${loc}|hes`]; const nm = WR[`M1|${loc}|name`];
      out(`-- ${loc} re-ask → 「${HESITATE[loc]}」 W ${fa(hes)}`);
      if (HR) out(`                 H ${fa(HR[`M1|${loc}|hes`])}`);
      out(`   → 「${NAME_AFTER[loc]}」 W ${fa(nm)}`);
      if (HR) out(`                 H ${fa(HR[`M1|${loc}|name`])}`);
      out(`   idle → name W ${fa(WR[`M1|${loc}|idle+name`])} (idle row inputs=${WR[`M1|${loc}|idle`]?.inputs} geo=${WR[`M1|${loc}|idle`]?.geo})`);
      for (const t of LINGER) {
        const w = WR[`M1|${loc}|linger|${t}`]; const c = WR[`M0|${loc}|${t}`]; const h = HR?.[`M1|${loc}|linger|${t}`];
        const extra = (w?.geo ?? 0) > (c?.geo ?? 0);
        const isCity = t === "Kinosaki";
        if (extra && !isCity) notes.push(`MARK-LINGER ${loc} re-ask → ${HESITATE[loc]} → 「${t}」 geocoded ${w.geo} (${w.q}) vs fresh session ${c?.geo} (HEAD ${h?.geo ?? "n/a"})`);
        out(`   ${extra && !isCity ? "LINGER" : "ok    "} → 「${t}」 W geo=${w?.geo}${w?.q ? `(${w.q})` : ""} [${w?.b}] cand=${w?.cand ?? "-"} dest=${w?.dest ?? "-"} | fresh geo=${c?.geo} [${c?.b}] | H geo=${h?.geo ?? "n/a"}`);
      }
    }
    out("-- M2 existing destination / combinations (mark injected vs plain)");
    for (const sn of ["dest", "combo", "tripOnly"]) for (const t of ["那霸", "Naha", "hello", "溫泉", "Kinosaki", "3天", "1"]) {
      const x = WR[`M2|${sn}|${t}`]; if (!x) continue;
      const keys = ["b", "p", "dest", "trip", "cand", "days", "offered", "sel", "geo"];
      const diff = keys.filter((f) => JSON.stringify(x.marked[f]) !== JSON.stringify(x.plain[f]));
      const synthetic = sn === "tripOnly";
      if (diff.length && !synthetic) fail(`M2|${sn}|${t}`, `marked differs [${diff}] marked=${fa(x.marked)} plain=${fa(x.plain)}`);
      if (diff.length && synthetic) notes.push(`M2 synthetic tripOnly 「${t}」 mark changes [${diff}]: marked=${fa(x.marked)} plain=${fa(x.plain)}`);
      out(`${(diff.length ? (synthetic ? "NOTE" : "BAD") : "ok").padEnd(5)} ${sn} 「${t}」 diff=[${diff}] marked geo=${x.marked.geo} inputs=${x.marked.inputs} [${x.marked.b}] | plain geo=${x.plain.geo} [${x.plain.b}]`);
      if (diff.length) { out(`    marked ${fa(x.marked)}`); out(`    plain  ${fa(x.plain)}`); }
    }
    out("-- M3 legacy-merge turns right after the re-ask (globalPlanningTurn undefined?)");
    for (const loc of LOCS) for (const t of ["附近有什麼好吃的", "nearby restaurants", "大阪", "Osaka", HESITATE[loc], "hello"]) {
      const x = WR[`M3|${loc}|${t}`]; if (!x) continue;
      out(`   ${loc} 「${t}」 g=${x.g} → W [${x.b}] p=${x.p ?? "-"} dest=${x.dest} inputs=${x.inputs} geo=${x.geo} newSession.inputs=${x.afterNewSession}`);
      out(`       next 「Kinosaki」 [${x.next?.b}] dest=${x.next?.dest} cand=${x.next?.cand} geo=${x.next?.geo} inputs=${x.next?.inputs} | next 「hello」 [${x.nextWord?.b}] geo=${x.nextWord?.geo}${x.nextWord?.q ? `(${x.nextWord.q})` : ""} cand=${x.nextWord?.cand ?? "-"}`);
      if (x.days) out(`       then ${DAYS[loc]} [${x.days.b}] p=${x.days.p} off=${x.days.offered} inputs=${x.days.inputs}`);
      if ((x.nextWord?.geo ?? 0) > 0) notes.push(`M3 ${loc} re-ask → 「${t}」 (g=${x.g}) → 「hello」 geocoded ${x.nextWord.geo} (${x.nextWord.q})`);
      if (x.inputs === "[]" && x.dest) notes.push(`M3 ${loc} 「${t}」 mark [] kept next to destination ${x.dest}`);
    }
  }
  if (want("k")) {
    out("\n==== K1) 「1」 after the correction (record only) ====");
    for (const kn of ["zh", "zhCtl", "zhDirect", "en", "ja"]) {
      const w = WR[`K1|${kn}`]; const h = HR?.[`K1|${kn}`]; if (!w) continue;
      out(`-- ${kn}`);
      w.rows.forEach((x, i) => { out(`   W 「${x.t}」 ${fa(x)}`); if (HR) out(`   H 「${h?.rows?.[i]?.t ?? "-"}」 ${fa(h?.rows?.[i])}`); });
      out(`   W diag ${JSON.stringify(w.diag)}`);
      if (HR) out(`   H diag ${JSON.stringify(h?.diag ?? null)}`);
      const last = w.rows[w.rows.length - 1]; const hl = h?.rows?.[h.rows.length - 1];
      const wSel = last?.t === "1" && last.p !== "combination_choice"; const hSel = hl?.t === "1" && hl.p !== "combination_choice";
      notes.push(`K1 ${kn} 「1」 W selected=${wSel} H selected=${HR ? hSel : "n/a"}${HR && hSel && !wSel ? " → REGRESSION" : ""}`);
    }
    out("\n==== K2) nearby after the K flow (library layer; record only) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("K2|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`   ${k} W cityLabel=${w.cityLabel} ctx0=${w.ctxMode0}/${w.ctxDest0}/${w.ctxLatLng0} mode=${w.mode} destName=${w.destName} center=${w.centerMode}/${w.centerSrc}/${w.centerLabel ?? w.centerDest} locIn=${w.locIn} wsLoc=${w.wsLoc} mergedDest=${w.mergedDest} explicitDevice=${w.explicitDevice} wantsNearby=${w.wantsNearby} geo=${w.geo}${w.err ? ` ERR ${w.err}` : ""}`);
      if (HR) out(`      H cityLabel=${h?.cityLabel} mode=${h?.mode} destName=${h?.destName} locIn=${h?.locIn}`);
      if (KYOTO.test(String(w.cityLabel ?? "")) || KYOTO.test(String(w.destName ?? "")) || KYOTO.test(w.geo ?? "")) notes.push(`K2 Kyoto in nearby search: ${k} cityLabel=${w.cityLabel} destName=${w.destName} geo=${w.geo}`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
