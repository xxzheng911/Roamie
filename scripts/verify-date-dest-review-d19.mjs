import "./verify-netguard-full.mjs";
/**
 * D19 (tester, independent review: re-ask mark carried by globalPlanningTurn wrapper + Latin ≤5 words). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice / seeds as verify-date-dest-review-d17.mjs).
 * Within one multi-step scenario the caches are NOT cleared between turns (App-faithful); fresh() only at scenario start.
 *  M) multi-step scenarios S-a..S-f × 4 locales: every step records reply / pending / dest / cand / inputs / geocode; days → combinations → 「1」.
 *  I) interleaver chains: re-ask → <word> → city (and two words chained) for the required words 我再想想 / 隨便 / 謝謝 / not yet / おまかせ / 아직 몰라요.
 *  Z) the same words at every position (re-ask, after hesitation, after 不是×2, ask_days, combination_choice, after 「1」): geocode 0.
 *  L) Latin names after the re-ask (with fixtures for Santiago / Plitvice, control without fixture): geocode / pending.
 *  S) the input session is not mutated (JSON before / after) for globalPlanningTurn + wouldMerge + merge; two calls on one object agree.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d19.mjs -- --head-dir=<snapshot>
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
const L = {
  "zh-TW": { no: "不是", hes: "我再想想", pref: "隨便", thx: "謝謝", naha: "那霸", tomo: "鞆の浦", atami: "熱海", kino: "Kinosaki", osaka: "大阪", near: "附近有什麼好吃的", food: "拉麵", days: "3天" },
  en: { no: "no", hes: "not yet", pref: "anywhere", thx: "thanks", naha: "Naha", tomo: "Tomonoura", atami: "Atami", kino: "Kinosaki", osaka: "Osaka", near: "anything good to eat nearby?", food: "ramen", days: "3 days" },
  ja: { no: "いいえ", hes: "まだ決めてない", pref: "おまかせ", thx: "ありがとう", naha: "那覇", tomo: "鞆の浦", atami: "熱海", kino: "Kinosaki", osaka: "大阪", near: "近くに美味しいものある？", food: "ラーメン", days: "3日間" },
  ko: { no: "아니요", hes: "아직 몰라요", pref: "아무데나", thx: "고마워요", naha: "나하", tomo: "도모노우라", atami: "아타미", kino: "Kinosaki", osaka: "오사카", near: "근처에 맛집 있어?", food: "라멘", days: "3일" },
};
// step kinds: Q = must be geocode 0 (no-city word), C = city answer (geo 1 + ask_days), D = days (combinations), S = 「1」, X = record only
const SCEN = {
  "S-a": (l) => [["no", "X"], ["hes", "Q"], ["pref", "Q"], ["naha", "C"], ["days", "D"], ["1", "S"]],
  "S-b": (l) => [["no", "X"], ["no", "X"], ["naha", "C"], ["days", "D"], ["1", "S"]],
  "S-c": (l) => [["no", "X"], ["thx", "Q"], ["tomo", "C"], ["days", "D"], ["1", "S"]],
  "S-c2": (l) => [["no", "X"], ["thx", "Q"], ["鞆の浦", "C"], ["days", "D"], ["1", "S"]],
  "S-d": (l) => [["no", "X"], ["naha", "C"], ["no", "X"], ["atami", "C"], ["days", "D"], ["1", "S"]],
  "S-e": (l) => [["no", "X"], ["hes", "Q"], ["near", "X"], ["kino", "X"]],
  "S-f": (l) => [["no", "X"], ["osaka", "X"], ["food", "F"]],
};
const CITY_RE = { naha: /naha|那霸|那覇|나하/i, tomo: /tomonoura|鞆の浦|鞆之浦|도모노우라/i, "鞆の浦": /tomonoura|鞆の浦|鞆之浦|도모노우라/i, atami: /atami|熱海|热海|아타미/i, kino: /kinosaki|城崎|키노사키/i, osaka: /osaka|大阪|오사카/i };
const REQ_WORDS = ["我再想想", "隨便", "謝謝", "not yet", "おまかせ", "아직 몰라요"];
const LATIN_REQ = ["Saint-Jean-Pied-de-Port", "Santiago de Compostela", "Plitvice Lakes National Park", "San Pedro de Atacama Chile"];
const LATIN_BLOCK = ["Lake Tekapo Village New Zealand South", "I don't know yet", "no thanks", "not yet"];
const LATIN_CTRL = ["Torres del Paine"]; // no fixture (provider 0 results)

const EXTRA_FIX = [
  ["kinosaki", "/kinosaki|城崎|키노사키/i", "Kinosaki", "Hyogo", "Japan", "JP", 35.6255, 134.8093, ["Kinosaki", "城崎", "城崎", "키노사키"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["naha", "/naha|那霸|那覇|나하/i", "Naha", "Okinawa", "Japan", "JP", 26.2124, 127.6809, ["Naha", "那霸市", "那覇市", "나하시"]],
  ["tomonoura", "/tomonoura|鞆の浦|鞆之浦|도모노우라/i", "Tomonoura", "Hiroshima", "Japan", "JP", 34.3833, 133.3833, ["Tomonoura", "鞆之浦", "鞆の浦", "도모노우라"]],
  ["atacama", "/atacama|阿塔卡馬|아타카마/i", "San Pedro de Atacama", "Antofagasta", "Chile", "CL", -22.9087, -68.1997, ["San Pedro de Atacama", "阿塔卡馬", "サン・ペドロ・デ・アタカマ", "산페드로데아타카마"]],
  ["tekapo", "/tekapo|特卡波|テカポ|테카포/i", "Lake Tekapo", "Canterbury", "New Zealand", "NZ", -44.0046, 170.4771, ["Lake Tekapo", "特卡波湖", "テカポ湖", "테카포 호수"]],
  ["sjpp", "/pied/i", "Saint-Jean-Pied-de-Port", "Nouvelle-Aquitaine", "France", "FR", 43.1631, -1.2375, ["Saint-Jean-Pied-de-Port", "聖讓皮耶德波爾", "サン＝ジャン＝ピエ＝ド＝ポル", "생장피에드포르"]],
  ["santiago", "/compostela/i", "Santiago de Compostela", "Galicia", "Spain", "ES", 42.8782, -8.5448, ["Santiago de Compostela", "聖地牙哥德孔波斯特拉", "サンティアゴ・デ・コンポステーラ", "산티아고데콤포스텔라"]],
  ["plitvice", "/plitvice/i", "Plitvice Lakes National Park", "Lika-Senj", "Croatia", "HR", 44.8654, 15.582, ["Plitvice Lakes National Park", "十六湖國家公園", "プリトヴィツェ湖群国立公園", "플리트비체 호수 국립공원"]],
];

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
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
      days: tc.days ?? s.tripDays ?? null, offered: offered.length,
      combos: offered.slice(0, 5).map((c, i) => `${i + 1}.${c.id}:${(c.title ?? c.name ?? "").slice(0, 24)}`).join(" ; ") || null,
      sel: sel.join(",") || null,
      selTitle: sel.map((id) => { const c = offered.find((o) => o.id === id); return c ? `${offered.indexOf(c) + 1}.${(c.title ?? c.name ?? "").slice(0, 24)}` : `${id}(not in offered)`; }).join(",") || null,
      phase: s.phase ?? null, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 160) };
  };
  // per-log deltas (slicing the concatenation mislabels the query when an earlier log grows)
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
  const textOf = (loc, k) => L[loc][k] ?? k;
  // runs steps on a seeded session without clearing caches between steps; returns rows + states
  const run = async (loc, steps) => {
    await fresh(loc);
    let cur = seeds[loc].s1; const rows = []; const states = [cur];
    for (const [k, kind] of steps) {
      const t = textOf(loc, k);
      const a = await turnS(cur, t, loc);
      rows.push({ k, kind, t, ...a.row });
      if (!a.s) break;
      cur = nextOf(a); states.push(cur);
    }
    return { rows, states };
  };
  const reaskedOf = async (loc) => (await run(loc, [["no", "X"]])).states[1];

  if (want("m")) for (const loc of LOCS) for (const [sn, f] of Object.entries(SCEN)) {
    const { rows, states } = await run(loc, f(loc));
    R[`M|${loc}|${sn}`] = rows;
    if (sn === "S-e") {
      // control: Kinosaki on a new chat; and directly after the re-ask
      await fresh(loc); R[`M|${loc}|S-e|fresh`] = (await turnS(sessionMod.createEmptySession(), "Kinosaki", loc)).row;
      await fresh(loc); R[`M|${loc}|S-e|direct`] = (await turnS(states[1], "Kinosaki", loc)).row;
      // the nearby turn on a new chat (legacy path), then Kinosaki
      await fresh(loc); const nf = await turnS(sessionMod.createEmptySession(), textOf(loc, "near"), loc);
      R[`M|${loc}|S-e|freshNear`] = nf.row;
      if (nf.s) R[`M|${loc}|S-e|freshNear>kino`] = (await turnS(nextOf(nf), "Kinosaki", loc)).row;
      // other nearby wordings at the same step (en / zh), each followed by Kinosaki; lexical destination parse of the sentence
      for (const nt of ["anything good to eat nearby?", "nearby restaurants", "restaurants near me", "what's good to eat nearby", "any good food around here?", "附近有什麼好吃的", "附近景點"]) {
        const r = await run(loc, [["no", "X"], ["hes", "Q"], [nt, "X"], ["kino", "X"]]);
        let parsed; try { parsed = tpc.parseDestinationFromText(nt) ?? null; } catch (e) { parsed = `THROW ${e?.message}`; }
        R[`NV|${loc}|${nt}`] = { rows: r.rows, parsed };
      }
    }
    if (sn === "S-f" && states[2]) {
      // extra: after Osaka → 3天 → 拉麵 / and 拉麵 at ask_days
      const st = states[2];
      R[`M|${loc}|S-f|osakaState`] = { inputs: st.travelContext?.destinationInputNames === undefined ? "undef" : JSON.stringify(st.travelContext.destinationInputNames), dest: st.travelContext?.destination ?? null, p: st.pendingQuestion?.type ?? null };
      const d = await turnS(st, textOf(loc, "days"), loc);
      R[`M|${loc}|S-f|days`] = d.row;
      if (d.s) R[`M|${loc}|S-f|days>food`] = (await turnS(nextOf(d), textOf(loc, "food"), loc)).row;
    }
  }
  if (want("i")) for (const loc of LOCS) {
    for (const w of REQ_WORDS) {
      R[`I|${loc}|${w}`] = (await run(loc, [["no", "X"], [w, "Q"], ["naha", "C"], ["days", "D"]])).rows;
    }
    R[`I|${loc}|chain3`] = (await run(loc, [["no", "X"], ["我再想想", "Q"], ["not yet", "Q"], ["아직 몰라요", "Q"], ["naha", "C"], ["days", "D"]])).rows;
    // days-only answer after the re-ask (wrapper keeps the mark on a dated turn without destination), then the city
    R[`I|${loc}|daysFirst`] = (await run(loc, [["no", "X"], ["days", "X"], ["naha", "X"], ["1", "X"]])).rows;
  }
  if (want("z")) for (const loc of LOCS) {
    const pos = {};
    { const r = await run(loc, [["no", "X"], ["hes", "Q"]]); pos.reask = r.states[1]; pos.afterHes = r.states[2]; }
    { const r = await run(loc, [["no", "X"], ["no", "X"]]); pos.afterNoNo = r.states[2]; }
    { const r = await run(loc, [["no", "X"], ["naha", "C"], ["days", "D"], ["1", "S"]]); pos.askDays = r.states[2]; pos.combos = r.states[3]; pos.afterOne = r.states[4]; }
    for (const [pn, st] of Object.entries(pos)) {
      if (!st) { R[`Z|${loc}|${pn}`] = "missing state"; continue; }
      for (const w of [...REQ_WORDS, textOf(loc, "pref"), textOf(loc, "thx"), textOf(loc, "hes")]) {
        const c = st.travelContext?.destinationCandidate;
        await fresh(loc); R[`Z|${loc}|${pn}|${w}`] = { ...(await turnS(st, w, loc)).row, inCand: c ? `${c.raw}/${c.status}` : null, inDest: st.travelContext?.destination ?? null, inSel: (st.travelContext?.selectedCombinationIds ?? []).join(",") || null };
      }
    }
  }
  if (want("l")) for (const loc of LOCS) {
    const base = await reaskedOf(loc);
    for (const nm of [...LATIN_REQ, ...LATIN_BLOCK, ...LATIN_CTRL]) {
      await fresh(loc); const a = await turnS(base, nm, loc);
      const row = { ...a.row };
      if (a.s && a.row.p === "ask_days") row.next = (await turnS(nextOf(a), textOf(loc, "days"), loc)).row;
      await fresh(loc); row.fresh = (await turnS(sessionMod.createEmptySession(), nm, loc)).row;
      R[`L|${loc}|${nm}`] = row;
    }
  }
  if (want("s")) for (const loc of LOCS) {
    const r = await run(loc, [["no", "X"], ["hes", "Q"], ["near", "X"]]);
    const st = { reask: r.states[1], afterHes: r.states[2], afterNear: r.states[3] };
    const j = (x) => (x === undefined ? "undefined" : JSON.stringify({ d: x.destination ?? null, c: x.destinationCandidate?.raw ?? null, s: x.destinationCandidate?.status ?? null, i: x.destinationInputNames ?? null, days: x.days ?? null }));
    for (const [sn, base] of Object.entries(st)) {
      if (!base) continue;
      for (const t of ["那霸", "Naha", "我再想想", "not yet", "隨便", "おまかせ", "아직 몰라요", "附近有什麼好吃的", "大阪", "拉麵", "3天", "Kinosaki", "鞆の浦", "Santiago de Compostela", "hello"]) {
        const row = {};
        try {
          const obj = structuredClone(base); const before = JSON.stringify(obj);
          row.first = j(gpc.globalPlanningTurn(obj, t)); row.mutG1 = JSON.stringify(obj) !== before;
          row.second = j(gpc.globalPlanningTurn(obj, t)); row.mutG2 = JSON.stringify(obj) !== before;
          row.clone = j(gpc.globalPlanningTurn(structuredClone(base), t));
          const o2 = structuredClone(base); const b2 = JSON.stringify(o2);
          row.would = travelContext.wouldMergeTravelContextResetTrip(o2, t); row.mutWould = JSON.stringify(o2) !== b2;
          const pick = (m) => JSON.stringify({ d: m.context.destination ?? null, c: m.context.destinationCandidate ? `${m.context.destinationCandidate.raw}/${m.context.destinationCandidate.status}` : null, i: m.context.destinationInputNames ?? null });
          row.mergeSame = pick(travelContext.mergeTravelContext(o2, t, base.lastAssistantReply)); row.mutMerge = JSON.stringify(o2) !== b2;
          row.mergeClone = pick(travelContext.mergeTravelContext(structuredClone(base), t, base.lastAssistantReply));
          // S4 analogue: the mutated object (if any) then a name
          row.nameAfter = j(gpc.globalPlanningTurn(structuredClone(o2), "那霸"));
          row.nameOnBase = j(gpc.globalPlanningTurn(structuredClone(base), "那霸"));
        } catch (e) { row.err = String(e?.message ?? e).slice(0, 120); }
        R[`S|${loc}|${sn}|${t}`] = row;
      }
    }
  }
  if (want("probe")) for (const loc of LOCS) {
    // identical synthetic inputs on W and HEAD: destination 「eat nearby」 (as the legacy nearby turn leaves it) with / without the mark
    const g = (s, t) => { try { const x = gpc.globalPlanningTurn(structuredClone(s), t); return x === undefined ? "undefined" : JSON.stringify({ d: x.destination ?? null, c: x.destinationCandidate ? `${x.destinationCandidate.raw}/${x.destinationCandidate.status}` : null, i: x.destinationInputNames ?? null }); } catch (e) { return `THROW ${e?.message}`; } };
    for (const [vn, tc] of [["eatMark", { interests: [], destination: "eat nearby", destinationInputNames: [] }], ["eatNoMark", { interests: [], destination: "eat nearby" }],
      ["candMark", { interests: [], destinationInputNames: [] }]]) {
      const s = { ...sessionMod.createEmptySession(), lastAssistantReply: "(refinement)", travelContext: tc };
      for (const t of ["Kinosaki", "那霸", "anything good to eat nearby?"]) {
        await fresh(loc); const a = await turnS(s, t, loc);
        let m; try { const r = travelContext.mergeTravelContext(structuredClone(s), t, s.lastAssistantReply); m = JSON.stringify({ d: r.context.destination ?? null, c: r.context.destinationCandidate?.raw ?? null, i: r.context.destinationInputNames ?? null }); } catch (e) { m = `THROW ${e?.message}`; }
        R[`P|${loc}|${vn}|${t}`] = { g: g(s, t), merge: m, ...a.row };
      }
    }
    // after the re-ask: the nearby sentence alone (no hesitation step) → merge context
    const re = await reaskedOf(loc);
    let m; try { const r = travelContext.mergeTravelContext(structuredClone(re), "anything good to eat nearby?", re.lastAssistantReply); m = JSON.stringify({ d: r.context.destination ?? null, i: r.context.destinationInputNames ?? null }); } catch (e) { m = `THROW ${e?.message}`; }
    R[`P|${loc}|reask|merge`] = { merge: m, g: g(re, "anything good to eat nearby?") };
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D19_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d19.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D19_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = []; const existing = []; const diffs = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} cand=${x.cand ?? "-"} inputs=${x.inputs} days=${x.days ?? "-"} off=${x.offered ?? "-"} sel=${x.selTitle ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const isKnownSel = (loc) => loc === "zh-TW";
  const took = (x, re) => [x?.dest, x?.trip, x?.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v))) && !/destination_clarification/.test(x?.b ?? "");
  const checkStep = (key, loc, r, sh) => {
    const re = CITY_RE[r.k] ?? /$^/;
    if (r.kind === "Q" && r.geo !== 0) fail(`${key}#${r.t}`, `no-city word geocoded: ${fa(r)}`);
    if (r.kind === "Q" && (r.cand || r.dest)) fail(`${key}#${r.t}`, `no-city word set cand/dest: ${fa(r)}`);
    if (r.kind === "C" && !(r.geo === 1 && r.p === "ask_days" && took(r, re))) {
      // the App did not re-ask the city on the previous step (destination kept) and HEAD behaves the same: existing, recorded separately
      const sameHead = sh && sh.b === r.b && sh.dest === r.dest && sh.geo === r.geo && sh.p === r.p;
      if (sameHead) existing.push(`${key}#${r.t}: ${fa(r)} (HEAD identical)`);
      else fail(`${key}#${r.t}`, `city not taken (need geo 1 + ask_days): ${fa(r)} | HEAD ${fa(sh)}`);
    }
    if (sh && (sh.b !== r.b || sh.dest !== r.dest || sh.geo !== r.geo || sh.p !== r.p || (sh.sel ?? null) !== (r.sel ?? null))) diffs.push(`${key} step 「${r.t}」: W [${r.b}] p=${r.p} dest=${r.dest} geo=${r.geo} sel=${r.selTitle ?? "-"} | H [${sh.b}] p=${sh.p} dest=${sh.dest} geo=${sh.geo} sel=${sh.selTitle ?? "-"}`);
    if (r.kind === "D" && !(r.p === "combination_choice" && r.offered > 0)) fail(`${key}#${r.t}`, `no combinations listed: ${fa(r)} | HEAD ${fa(sh)}`);
    if (r.kind === "S" && !r.sel) {
      if (isKnownSel(loc) && !sh?.sel) notes.push(`KNOWN(existing) ${key} 「1」 selects nothing in zh (HEAD same: ${sh ? `sel=${sh.sel}` : "n/a"})`);
      else if (sh?.sel) fail(`${key}#1`, `「1」 selected nothing, HEAD selected ${sh.selTitle}: ${fa(r)}`);
      else notes.push(`${key} 「1」 selects nothing (HEAD ${sh ? `sel=${sh.sel}` : "n/a"}) ${fa(r)}`);
    }
    if (r.kind === "F" && (r.geo !== 0 || (r.cand && !/osaka|大阪|오사카/i.test(r.cand)) || !/osaka|大阪|오사카/i.test(String(r.dest ?? r.trip ?? "")))) fail(`${key}#${r.t}`, `food after Osaka became a candidate / geocoded / lost Osaka: ${fa(r)}`);
  };
  out("==== seeds ====");
  for (const loc of LOCS) out(`-- ${loc} W seed=${WR[`SEED|${loc}`]?.seed} | H seed=${HR?.[`SEED|${loc}`]?.seed ?? "n/a"}`);
  if (want("m")) {
    out("\n==== M) multi-step scenarios (W vs HEAD) ====");
    for (const loc of LOCS) for (const sn of Object.keys(SCEN)) {
      const key = `M|${loc}|${sn}`; const w = WR[key] ?? []; const h = HR?.[key] ?? [];
      out(`\n-- ${loc} ${sn}`);
      w.forEach((r, i) => {
        const sh = h[i];
        checkStep(key, loc, r, sh);
        out(`  ${String(i + 1).padStart(2)} 「${r.t}」(${r.kind}) W ${fa(r)}`);
        out(`        W reply: ${r.reply}`);
        if (r.combos && r.kind === "D") out(`        W combos: ${r.combos}`);
        out(`        H ${fa(sh)}${sh?.reply ? ` | ${sh.reply.slice(0, 90)}` : ""}`);
      });
      if (sn === "S-e") {
        for (const x of ["fresh", "direct", "freshNear", "freshNear>kino"]) out(`   [${x}] W ${fa(WR[`${key}|${x}`])} | H ${fa(HR?.[`${key}|${x}`])}`);
        const last = w[w.length - 1]; const fr = WR[`${key}|fresh`];
        const near = w[2];
        const askedCity = /destination_clarification/.test(near?.b ?? "") || /destination_clarification/.test(w[1]?.b ?? "");
        const hl = h[h.length - 1];
        if (last && hl && took(hl, CITY_RE.kino) && !took(last, CITY_RE.kino)) fail(`${key}#Kinosaki`, `REGRESSION: HEAD takes Kinosaki ([${hl.b}] dest=${hl.dest} geo=${hl.geo}), W does not: ${fa(last)} 「${last.reply}」`);
        out(`   S-e Kinosaki: W [${last?.b}] dest=${last?.dest} cand=${last?.cand} geo=${last?.geo} | new chat [${fr?.b}] dest=${fr?.dest} cand=${fr?.cand} geo=${fr?.geo} | nearby turn re-asked city=${askedCity}`);
        if (last && fr && (Boolean(took(last, CITY_RE.kino)) !== Boolean(took(fr, CITY_RE.kino)))) notes.push(`S-e ${loc} Kinosaki differs from new chat: W [${last.b}] dest=${last.dest} cand=${last.cand} geo=${last.geo} vs new [${fr.b}] dest=${fr.dest} cand=${fr.cand} geo=${fr.geo}; HEAD [${h[h.length - 1]?.b ?? "n/a"}] dest=${h[h.length - 1]?.dest ?? "n/a"} geo=${h[h.length - 1]?.geo ?? "n/a"}`);
      }
      if (sn === "S-f") {
        out(`   Osaka state: W ${JSON.stringify(WR[`${key}|osakaState`])} | H ${JSON.stringify(HR?.[`${key}|osakaState`] ?? null)}`);
        out(`   →days W ${fa(WR[`${key}|days`])} | H ${fa(HR?.[`${key}|days`])}`);
        out(`      W days reply: ${WR[`${key}|days`]?.reply ?? "-"}`);
        const df = WR[`${key}|days>food`];
        out(`   →days→food W ${fa(df)} | H ${fa(HR?.[`${key}|days>food`])}`);
        if (df) checkStep(`${key}|days>food`, loc, { ...df, k: "food", kind: "F", t: L[loc].food }, null);
      }
    }
  }
  if (want("i")) {
    out("\n==== I) re-ask → <word> → city → days ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("I|"))) {
      const w = WR[k]; const h = HR?.[k] ?? [];
      const loc = k.split("|")[1];
      w.forEach((r, i) => checkStep(k, loc, r, h[i]));
      out(`  ${k}: ${w.map((r) => `「${r.t}」[${r.b}] p=${r.p} geo=${r.geo} dest=${r.dest} inputs=${r.inputs}`).join(" → ")}`);
      out(`     H: ${h.map((r) => `「${r.t}」p=${r.p} geo=${r.geo} dest=${r.dest}`).join(" → ") || "n/a"}`);
      if (k.endsWith("|daysFirst")) {
        w.forEach((r, i) => out(`     W ${i + 1} 「${r.t}」 [${r.b}] p=${r.p} dest=${r.dest} days=${r.days} off=${r.offered} sel=${r.selTitle ?? "-"} geo=${r.geo}${r.q ? `(${r.q})` : ""} | ${r.reply}`));
        h.forEach((r, i) => out(`     H ${i + 1} 「${r.t}」 [${r.b}] p=${r.p} dest=${r.dest} days=${r.days} off=${r.offered} sel=${r.selTitle ?? "-"} geo=${r.geo} | ${r.reply}`));
        const d = w[1];
        if (d && /LAST-RESORT/.test(d.b ?? "") && !d.dest) notes.push(`daysFirst ${k}: re-ask → 「${d.t}」 shows the failure copy with no destination: 「${d.reply}」 (HEAD [${h[1]?.b ?? "n/a"}] 「${h[1]?.reply ?? ""}」)`);
      }
    }
  }
  if (want("z")) {
    out("\n==== Z) no-city words at every position: geocode 0 ====");
    let n = 0;
    for (const k of Object.keys(WR).filter((k) => k.startsWith("Z|"))) {
      const w = WR[k]; const h = HR?.[k];
      if (typeof w === "string") { fail(k, w); continue; }
      n++;
      // geocode 0 and no NEW candidate / destination (an earlier resolved candidate / destination is kept as is)
      const ok = w.geo === 0 && w.cand === w.inCand && w.dest === w.inDest;
      if (!ok) fail(k, `${fa(w)} (in cand=${w.inCand} dest=${w.inDest}) | HEAD geo=${h?.geo ?? "n/a"} cand=${h?.cand ?? "-"}`);
      else out(`  ok ${k} [${w.b}] p=${w.p} geo=0 dest=${w.dest} sel=${w.selTitle ?? "-"} (in sel=${w.inSel ?? "-"}) | H [${h?.b ?? "n/a"}] p=${h?.p ?? "n/a"} geo=${h?.geo ?? "n/a"} sel=${h?.selTitle ?? "-"}`);
      if (h && (h.b !== w.b || h.p !== w.p || h.sel !== w.sel)) notes.push(`Z diff vs HEAD ${k}: W [${w.b}] p=${w.p} sel=${w.selTitle ?? "-"} | H [${h.b}] p=${h.p} sel=${h.selTitle ?? "-"} geo=${h.geo}`);
    }
    out(`  Z rows=${n}`);
  }
  if (want("l")) {
    out("\n==== L) Latin names after the re-ask ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("L|"))) {
      const nm = k.split("|")[2]; const w = WR[k]; const h = HR?.[k];
      if (LATIN_REQ.includes(nm)) {
        if (w.geo !== 1) fail(k, `need geo 1: ${fa(w)}`);
        if (w.p !== "ask_days") notes.push(`L ${k} geo=${w.geo} but p=${w.p} [${w.b}] (HEAD p=${h?.p ?? "n/a"} geo=${h?.geo ?? "n/a"})`);
      } else if (LATIN_BLOCK.includes(nm)) {
        if (w.geo !== 0 || w.cand) fail(k, `must be blocked (geo 0, no cand): ${fa(w)}`);
      }
      out(`  ${k} W ${fa(w)} → days ${w.next ? `p=${w.next.p} off=${w.next.offered}` : "-"} | fresh ${fa(w.fresh)}`);
      out(`      reply: ${w.reply}`);
      out(`      H ${fa(h)} → days ${h?.next ? `p=${h.next.p} off=${h.next.offered}` : "-"} | H fresh ${fa(h?.fresh)}`);
      if (w.next && w.next.p !== "combination_choice") notes.push(`L ${k} → days gives no combinations: W [${w.next.b}] p=${w.next.p} off=${w.next.offered} | HEAD → days ${h?.next ? `[${h.next.b}] p=${h.next.p} off=${h.next.offered}` : "n/a"} | reply ${w.next.reply}`);
    }
  }
  if (want("m")) {
    out("\n==== NV) S-e with other nearby wordings (re-ask → hesitation → <nearby> → Kinosaki) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("NV|"))) {
      const w = WR[k]; const h = HR?.[k];
      const near = w.rows[2]; const kino = w.rows[3]; const hk = h?.rows?.[3];
      const bogus = near?.dest && !CITY_RE.kino.test(near.dest);
      if (bogus) notes.push(`NV ${k}: nearby sentence set destination 「${near.dest}」 (parse=${JSON.stringify(w.parsed)}); next Kinosaki W [${kino?.b}] dest=${kino?.dest} geo=${kino?.geo} | HEAD Kinosaki [${hk?.b ?? "n/a"}] dest=${hk?.dest ?? "n/a"} geo=${hk?.geo ?? "n/a"}`);
      out(`  ${bogus ? "BOGUS" : "ok   "} ${k} parse=${JSON.stringify(w.parsed)} near W [${near?.b}] dest=${near?.dest} geo=${near?.geo} → Kinosaki W [${kino?.b}] dest=${kino?.dest} geo=${kino?.geo} | H near dest=${h?.rows?.[2]?.dest ?? "n/a"} → Kinosaki [${hk?.b ?? "n/a"}] dest=${hk?.dest ?? "n/a"} geo=${hk?.geo ?? "n/a"}`);
      if (kino) out(`        W Kinosaki reply: ${kino.reply}`);
    }
  }
  if (want("s")) {
    out("\n==== S) no mutation of the input session; two calls on one object agree ====");
    let n = 0;
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S|"))) {
      const x = WR[k]; const h = HR?.[k]; n++;
      if (x.err) { fail(k, x.err); continue; }
      const bad = [];
      if (x.mutG1 || x.mutG2) bad.push("globalPlanningTurn mutated input");
      if (x.first !== x.second) bad.push(`2nd call differs ${x.first} vs ${x.second}`);
      if (x.first !== x.clone) bad.push(`differs from clone ${x.first} vs ${x.clone}`);
      if (x.mutWould) bad.push("wouldMerge mutated input");
      if (x.mergeSame !== x.mergeClone) bad.push(`merge after wouldMerge differs ${x.mergeSame} vs ${x.mergeClone}`);
      if (x.mutMerge) notes.push(`S ${k}: mergeTravelContext mutated caller (HEAD mutMerge=${h?.mutMerge ?? "n/a"}); name after: ${x.nameAfter} vs on base ${x.nameOnBase}`);
      if (x.mutMerge && x.nameAfter !== x.nameOnBase) bad.push(`name after mutated merge differs: ${x.nameAfter} vs ${x.nameOnBase}`);
      if (bad.length) fail(k, bad.join("; "));
      out(`  ${bad.length ? "BAD" : "ok "} ${k} g=${x.first} mutG=${x.mutG1 || x.mutG2} mutWould=${x.mutWould} mutMerge=${x.mutMerge} merge=${x.mergeSame} | H g=${h?.first ?? "n/a"} H mutMerge=${h?.mutMerge ?? "n/a"}`);
    }
    out(`  S rows=${n}`);
  }
  if (want("probe")) {
    out("\n==== PROBE) destination 「eat nearby」 with / without the mark (identical input W vs HEAD) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("P|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k} W g=${w.g} merge=${w.merge}${w.b ? ` turn [${w.b}] dest=${w.dest} cand=${w.cand ?? "-"} geo=${w.geo}` : ""}`);
      out(`  ${" ".repeat(k.length)} H g=${h?.g ?? "n/a"} merge=${h?.merge ?? "n/a"}${h?.b ? ` turn [${h.b}] dest=${h.dest} cand=${h.cand ?? "-"} geo=${h.geo}` : ""}`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nEXISTING (HEAD identical, not counted as fail) ${existing.length}:\n  ${existing.join("\n  ")}`);
  out(`\nSTEP DIFFS W vs HEAD ${diffs.length}:\n  ${diffs.join("\n  ")}`);
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
