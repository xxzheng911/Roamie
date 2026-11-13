import "./verify-netguard-full.mjs";
/**
 * T2 (tester, independent review): travel-wish sentences without a place (「我想去旅行」"I want to travel"
 * 「旅行したい」「여행 가고 싶어」 …) must never become a destination / candidate; geocode 0.
 * W (working tree) vs H (HEAD via --head-dir). Harness: App-order turn of verify-m16-post-selection-switch-review.mjs
 * with the same 13226 destination-clarification patch as verify-date-dest-review-d27.mjs.
 * Stages per sentence:
 *   new    — empty session, first turn
 *   tokyo  — existing Tokyo trip (「我要去東京」→「3天」 per locale), then the sentence
 *   reask  — city re-ask stage (a seed wish sentence that reached 13226), then the sentence
 *   city   — after the "new" turn, answer the city (東京 / Tokyo / 東京 / 도쿄): the re-ask → city flow
 * Controls (place present / Trip-Travel inside real place names) must behave exactly as HEAD.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-travel-intent-review-t2.mjs -- --head-dir=<snapshot> [--only=w|c]
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
setTimeout(() => { out("FAIL internal watchdog 580s"); process.exit(3); }, 580_000).unref();

const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};

// Real place names that contain Trip / Travel (geocode fixtures; all mocked).
const EXTRA_FIX = [
  ["tripoli", "/tripoli|的黎波里|トリポリ|트리폴리/i", "Tripoli", "Tripoli", "Libya", "LY", 32.8872, 13.1913, ["Tripoli", "的黎波里", "トリポリ", "트리폴리"]],
  ["tripura", "/tripura|特里普拉|トリプラ|트리푸라/i", "Tripura", "Tripura", "India", "IN", 23.9408, 91.9882, ["Tripura", "特里普拉", "トリプラ", "트리푸라"]],
  ["travelersrest", "/travelers rest/i", "Travelers Rest", "South Carolina", "United States", "US", 34.9676, -82.4435, ["Travelers Rest", "Travelers Rest", "Travelers Rest", "Travelers Rest"]],
  ["traveltown", "/travel town/i", "Travel Town Museum", "California", "United States", "US", 34.1556, -118.3073, ["Travel Town Museum", "Travel Town Museum", "Travel Town Museum", "Travel Town Museum"]],
  ["holidayinnshinjuku", "/holiday inn/i", "Holiday Inn Express Tokyo Shinjuku", "Tokyo", "Japan", "JP", 35.6938, 139.7034, ["Holiday Inn Express Tokyo Shinjuku", "Holiday Inn Express Tokyo Shinjuku", "Holiday Inn Express Tokyo Shinjuku", "Holiday Inn Express Tokyo Shinjuku"]],
];

const WISH = {
  "zh-TW": { given: ["我想去旅行", "想出去玩", "幫我規劃旅行", "我想安排一趟旅行"], own: ["幫我排個行程", "我想放假出去走走", "想去度假", "帶我去旅遊", "我要規劃行程", "想出去走走"] },
  en: { given: ["I want to travel", "I want to plan a trip", "I want to go on a trip", "plan a vacation for me"], own: ["take me somewhere", "I want to go on vacation", "plan my trip", "I need a getaway", "help me plan a holiday", "let's travel"] },
  ja: { given: ["旅行したい", "旅行の計画を立てたい", "旅行プランを作って", "どこか旅行に行きたい"], own: ["旅に出たい", "旅行に行きたい", "どこかに行きたい", "旅行の予定を立てて", "観光したい"] },
  ko: { given: ["여행 가고 싶어", "여행 계획 세워줘", "여행하고 싶어", "어디론가 떠나고 싶어"], own: ["휴가 가고 싶어", "여행 일정 짜줘", "여행 가고 싶어요", "어디 여행 가고 싶어", "여행을 떠나고 싶어"] },
};
// [text, locale, expected place regex]
const CONTROLS = [
  ["東京旅行", "zh-TW", /東京|Tokyo/], ["我想去東京旅行", "zh-TW", /東京|Tokyo/], ["シドニーへ旅行", "ja", /シドニー|Sydney/], ["シドニー旅行", "ja", /シドニー|Sydney/],
  ["trip to Tokyo", "en", /東京|Tokyo/], ["Tokyo trip", "en", /東京|Tokyo/], ["도쿄 여행", "ko", /도쿄|東京|Tokyo/], ["시드니 여행", "ko", /시드니|Sydney|雪梨/],
  ["Tripoli", "en", /Tripoli/], ["I want to go to Tripoli", "en", /Tripoli/], ["trip to Tripoli", "en", /Tripoli/], ["Tripoli trip", "en", /Tripoli/],
  ["Tripura", "en", /Tripura/], ["plan a trip to Tripura", "en", /Tripura/], ["Travelers Rest", "en", /Travelers Rest/], ["I want to go to Travelers Rest", "en", /Travelers Rest/],
  ["Travel Town Museum", "en", /Travel Town/], ["I want to visit Travel Town Museum", "en", /Travel Town/], ["Holiday Inn Express Tokyo Shinjuku", "en", /Holiday Inn|Tokyo|東京|Shinjuku/],
  ["我想去的黎波里旅行", "zh-TW", /的黎波里|Tripoli/], ["トリポリへ旅行", "ja", /トリポリ|Tripoli/], ["트리폴리 여행", "ko", /트리폴리|Tripoli/],
];
const SEEDS = { "zh-TW": ["我想規劃一趟旅行", "幫我規劃旅行", "我想去旅行", "我想旅遊"], en: ["I want to plan a trip", "help me plan a trip", "Plan a trip for me", "I want to travel"],
  ja: ["旅行の計画を立てたい", "旅行したい", "どこか旅行に行きたい"], ko: ["여행 계획 세워줘", "여행 가고 싶어", "여행하고 싶어"] };
const GO_TOKYO = { "zh-TW": "我要去東京", en: "I'm going to Tokyo", ja: "東京へ旅行", ko: "도쿄 여행" };
const DAYS = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const CITY = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const LOC_ARG = argv.find((a) => a.startsWith("--loc="))?.slice(6).split(",");
const LOCS = ["zh-TW", "en", "ja", "ko"].filter((l) => !LOC_ARG || LOC_ARG.includes(l));

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  slice = slice.replace('return dateQuestion("13058");', '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const geoLines = EXTRA_FIX.map(([k, re, city, region, country, code, lat, lng]) => `  ${k}: { re: ${re}, city: ${JSON.stringify(city)}, region: ${JSON.stringify(region)}, country: ${JSON.stringify(country)}, code: "${code}", lat: ${lat}, lng: ${lng} },\n`).join("");
  const localLines = EXTRA_FIX.map(([k, , , , , , , , loc]) => `${k}: ${JSON.stringify(loc)}, `).join("");
  if (!slice.includes("  kamakura: { re: /kamakura")) throw new Error("harness fixture anchor missing");
  slice = slice.replace("  kamakura: { re: /kamakura", geoLines + "  kamakura: { re: /kamakura")
    .replace('kamakura: ["Kamakura"', localLines + 'kamakura: ["Kamakura"')
    .replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const reset = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const turnS = async (s0, t, loc) => {
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(structuredClone(s0), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const q = geoLogs().flatMap((l, i) => l.slice(n0[i]).map((x) => `${["g", "a", "d"][i]}:${x}`));
      return { s: { ...s, lastAssistantReply: r.row?.reply ? String(r.row.reply).replace(/ \/ /g, "\n") : s.lastAssistantReply }, row: { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null,
        trip: s.tripDestination?.city ?? null, tpcDest: s.tripPlanningContext?.destination ?? null, area: s.preferredArea ?? tc.destinationArea ?? null,
        cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, inputs: tc.destinationInputNames ?? null,
        geo: q.length, q: q.join("|"), reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 150) } };
    } catch (e) { return { s: null, row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 } }; }
  };
  const parsers = (u) => {
    const e = sessionMod.createEmptySession();
    return { parse: g(() => tpc.parseDestinationFromText(u) ?? null), resolve: g(() => tpc.resolveDestinationFromText(u) ?? null),
      nonPlace: g(() => tpc.isNonPlaceDestinationText(u)),
      merge: g(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); return `dest=${m.context.destination ?? "-"} cand=${m.context.destinationCandidate?.raw ?? "-"}`; }),
      gpt: g(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"}`; }) };
  };

  const items = [];
  if (want("w")) for (const loc of LOCS) for (const t of [...WISH[loc].given, ...WISH[loc].own]) items.push({ t, loc, kind: WISH[loc].given.includes(t) ? "wish-given" : "wish-own" });
  if (want("c")) for (const [t, loc] of CONTROLS) items.push({ t, loc, kind: "control" });

  for (const loc of LOCS) {
    if (!items.some((x) => x.loc === loc)) continue;
    setNav(loc);
    // tokyo stage base
    await reset(loc);
    const c1 = await turnS(sessionMod.createEmptySession(), GO_TOKYO[loc], loc);
    const c2 = c1.s ? await turnS(c1.s, DAYS[loc], loc) : { s: null, row: { b: "NO_BASE" } };
    const tokyoBase = c2.s;
    R[`BASE|tokyo|${loc}`] = { first: c1.row, second: c2.row };
    // reask stage base
    let reaskBase = null;
    for (const seed of SEEDS[loc]) {
      await reset(loc);
      const r1 = await turnS(sessionMod.createEmptySession(), seed, loc);
      R[`SEED|${loc}|${seed}`] = r1.row;
      if (!reaskBase && /13226/.test(r1.row.b ?? "") && !r1.row.dest && !r1.row.cand) { reaskBase = r1.s; R[`BASE|reask|${loc}`] = { seed, ...r1.row }; }
    }
    if (!reaskBase) R[`BASE|reask|${loc}`] = { b: "NO_REASK_STAGE" };
    for (const it of items.filter((x) => x.loc === loc)) {
      const key = `${it.loc}|${it.t}`;
      R[`P|${key}`] = parsers(it.t);
      await reset(loc);
      const n = await turnS(sessionMod.createEmptySession(), it.t, loc);
      R[`new|${key}`] = n.row;
      if (n.s) { await reset(loc); R[`city|${key}`] = (await turnS(n.s, CITY[loc], loc)).row; }
      if (tokyoBase) { await reset(loc); R[`tokyo|${key}`] = { ...(await turnS(tokyoBase, it.t, loc)).row, pre: tokyoBase.travelContext?.destination ?? null }; }
      if (reaskBase) { await reset(loc); R[`reask|${key}`] = (await turnS(reaskBase, it.t, loc)).row; }
    }
  }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@T2_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-travel-intent-review-t2.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : []), ...(LOC_ARG ? [`--loc=${LOC_ARG.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 300_000, maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@T2_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const failLines = [];
  const fail = (k, m) => { failures.push(k); failLines.push(`  FAIL ${k}: ${m}`); };
  const VERBOSE = argv.includes("--verbose");
  const sb = (x) => !x ? "n/a" : String(x.b ?? "").replace("destination_clarification", "ask").replace(" date/duration question", "date").replace("planning advice", "plan").replace("candidate advice", "cand").replace("later dispatch", "later");
  const replies = new Map();
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} area=${x.area ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const placeOf = (x) => [x?.dest, x?.trip, x?.tpcDest, x?.area, x?.cand?.split("/")[0]].filter(Boolean);
  const hit = (x, re) => Boolean(x) && (placeOf(x).some((v) => re.test(String(v))) || re.test(x.q ?? ""));
  const TOKYO = /東京|Tokyo|도쿄/;
  const bad = (x) => !x || /THROW|LAST-RESORT|HARNESS/.test(x.b ?? "");
  out("==== BASES ====");
  for (const k of Object.keys(WR).filter((k) => k.startsWith("BASE|") || k.startsWith("SEED|"))) {
    const w = WR[k]; const h = HR?.[k];
    out(k.startsWith("BASE|tokyo") ? `  ${k} W ${fa(w.second)} | H ${fa(h?.second)}` : `  ${k} W ${fa(w)}${w.seed ? ` seed=${w.seed}` : ""} | H ${fa(h)}${h?.seed ? ` seed=${h.seed}` : ""}`);
  }
  for (const loc of LOCS) {
    if (WR[`BASE|reask|${loc}`]?.b === "NO_REASK_STAGE") fail(`BASE|reask|${loc}`, "W never reached the city re-ask stage");
    const tb = WR[`BASE|tokyo|${loc}`]; if (tb && !TOKYO.test(String(tb.second?.dest ?? ""))) fail(`BASE|tokyo|${loc}`, `Tokyo trip base not Tokyo: ${fa(tb.second)}`);
  }
  const table = { W: { ok: 0, bad: 0 }, H: { ok: 0, bad: 0 } };
  const wishOk = (stage, x) => {
    if (!x || bad(x)) return false;
    if (stage === "new" || stage === "reask") return placeOf(x).length === 0 && x.geo === 0 && Boolean(x.reply);
    if (stage === "tokyo") return TOKYO.test(String(x.dest ?? "")) && !x.cand && x.geo === 0;
    if (stage === "city") return TOKYO.test(String(x.dest ?? x.cand ?? ""));
    return false;
  };
  if (want("w")) {
    out("\n==== WISH sentences (W | H) ====");
    for (const loc of LOCS) for (const t of [...WISH[loc].given, ...WISH[loc].own]) {
      const key = `${loc}|${t}`; const pw = WR[`P|${key}`]; const ph = HR?.[`P|${key}`];
      if (VERBOSE) out(`  「${t}」 Wp ${JSON.stringify(pw)} | Hp ${JSON.stringify(ph ?? null)}`);
      const cells = [];
      for (const stage of ["new", "tokyo", "reask", "city"]) {
        const w = WR[`${stage}|${key}`]; const h = HR?.[`${stage}|${key}`];
        const wOk = wishOk(stage, w); const hOk = h ? wishOk(stage, h) : null;
        table.W[wOk ? "ok" : "bad"]++; if (h) table.H[hOk ? "ok" : "bad"]++;
        cells.push(`${stage}: W${wOk ? "+" : "X"}[${sb(w)}${w?.geo ? ` g${w.geo}` : ""}] H${hOk === null ? "?" : hOk ? "+" : "X"}[${sb(h)}${h?.geo ? ` g${h.geo}` : ""}${h && !hOk && placeOf(h).length ? ` ${h.cand ?? h.dest}` : ""}]`);
        if (stage !== "city" && w?.reply) replies.set(`${loc}|${sb(w)}|${w.reply.slice(0, 90)}`, (replies.get(`${loc}|${sb(w)}|${w.reply.slice(0, 90)}`) ?? 0) + 1);
        if (!wOk) fail(`WISH|${stage}|${key}`, `W ${fa(w)} reply=${w?.reply} | H ${fa(h)}`);
      }
      out(`  ${loc} ${WISH[loc].given.includes(t) ? "G" : "O"} 「${t}」 ${cells.join(" ")}`);
    }
  }
  if (want("c")) {
    out("\n==== CONTROLS (must match HEAD) ====");
    for (const [t, loc, re] of CONTROLS.filter(([, l]) => LOCS.includes(l))) {
      const key = `${loc}|${t}`; const pw = WR[`P|${key}`]; const ph = HR?.[`P|${key}`];
      if (VERBOSE) out(`  「${t}」 Wp ${JSON.stringify(pw)} | Hp ${JSON.stringify(ph ?? null)}`);
      for (const f of ["parse", "resolve", "merge", "gpt"]) if (ph && JSON.stringify(ph[f]) !== JSON.stringify(pw[f])) notes.push(`CONTROL parser diff 「${t}」 ${f}: W=${JSON.stringify(pw[f])} H=${JSON.stringify(ph[f])}`);
      const cells = [];
      for (const stage of ["new", "tokyo", "reask", "city"]) {
        const w = WR[`${stage}|${key}`]; const h = HR?.[`${stage}|${key}`];
        const same = h && w && h.b === w.b && h.dest === w.dest && h.cand === w.cand && h.trip === w.trip && h.area === w.area && h.q === w.q && h.p === w.p;
        cells.push(`${stage}: ${h ? (same ? "SAME" : "DIFF") : "n/a"}[${sb(w)} d=${w?.dest ?? "-"} c=${w?.cand ?? "-"} g=${w?.geo}]${h && !same ? `/H[${sb(h)} d=${h.dest ?? "-"} c=${h.cand ?? "-"} g=${h.geo}]` : ""}`);
        if (stage === "city") continue;
        if (h && hit(h, re) && !hit(w, re)) fail(`CONTROL|${stage}|${key}`, `place lost vs HEAD: W ${fa(w)} | H ${fa(h)}`);
        if (h && !same) notes.push(`CONTROL diff ${stage} 「${t}」: W ${fa(w)} | H ${fa(h)}`);
        if (stage === "new" && !hit(w, re)) notes.push(`CONTROL new 「${t}」 place not kept in W (HEAD ${h ? (hit(h, re) ? "hit" : "miss") : "n/a"}): ${fa(w)}`);
      }
      out(`  ${loc} 「${t}」 ${cells.join(" ")}`);
    }
  }
  if (replies.size) out(`\nW replies (wish, by locale|branch): \n  ${[...replies.entries()].map(([k, n]) => `${n}x ${k}`).join("\n  ")}`);
  out(`\nFAIL DETAILS ${failLines.length}:\n${failLines.join("\n")}`);
  out(`\nWISH stage cells: W ok=${table.W.ok} bad=${table.W.bad} | H ok=${table.H.ok} bad=${table.H.bad}`);
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
