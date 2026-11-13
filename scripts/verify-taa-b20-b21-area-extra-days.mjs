import "./verify-netguard-full.mjs";
/**
 * T-AA (tester, independent review of B20 same-name district + B21 「多待一天」 duration exclusion).
 * W (working tree) vs H (HEAD via --head-dir). Harness = verify-tz-b17-colloquial-pick.mjs (App-order turn from
 * verify-m16-post-selection-switch-review.mjs with the real _app.chat.tsx candidate-context routing statement).
 *  A) area sentences on a new chat: dest / cand / trip / days / area-ish context keys / geocode count + queries,
 *     resolveDestinationAreaScope + resolveCuratedOrCachedDestinationAreaScope unit, doubled-label check (濟州濟州).
 *  L) CURATED_PROFILES list scan (source text): districts whose label minus 市/區 equals the parent city.
 *  F) multi-turn flows: 東京 3 天 → 「第2組但是想多待一天」/「多待一天」, ja 「もう1日いたい」「もう3日間滞在したい」.
 *  U) parseDayCountFromText unit rows.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=500 scripts/verify-taa-b20-b21-area-extra-days.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const BRIEF = argv.includes("--brief");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 470s"); process.exit(3); }, 470_000).unref();

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

// Geocode fixtures (substring match; every query is logged). Inserted before kamakura in the m16 GEO table.
const EXTRA_FIX = [
  ["jeju", "/jeju|濟州|済州|제주/i", "Jeju", "Jeju", "South Korea", "KR", 33.4996, 126.5312, ["Jeju", "濟州", "済州", "제주"]],
  ["taipei", "/taipei|台北|臺北|타이베이/i", "Taipei", "Taipei", "Taiwan", "TW", 25.033, 121.5654, ["Taipei", "台北", "台北", "타이베이"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["seoul", "/seoul|首爾|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
  ["tainan", "/tainan|台南|臺南/i", "Tainan", "Tainan", "Taiwan", "TW", 22.9997, 120.227, ["Tainan", "台南", "台南", "타이난"]],
  ["nagoya", "/nagoya|名古屋|나고야/i", "Nagoya", "Aichi", "Japan", "JP", 35.1815, 136.9066, ["Nagoya", "名古屋", "名古屋市", "나고야"]],
  ["taitung", "/taitung|台東|臺東/i", "Taitung", "Taitung", "Taiwan", "TW", 22.7583, 121.1444, ["Taitung", "台東", "台東", "타이둥"]],
];

// [text, locale]
const AREA = [
  ["我想去濟州", "zh-TW"], ["我想去濟州市", "zh-TW"], ["我想去濟州島 3 天", "zh-TW"], ["我想去濟州市 3 天", "zh-TW"],
  ["我想去台北信義區", "zh-TW"], ["我想去台北信義", "zh-TW"], ["我想去大阪難波", "zh-TW"], ["我想去大阪道頓堀", "zh-TW"],
  ["我想去首爾明洞", "zh-TW"], ["我想去京都 3 天", "zh-TW"], ["我想去台南", "zh-TW"], ["我想去台南安平", "zh-TW"],
  // extra city analogs (list scan in L decides which one is a true same-name district)
  ["我想去名古屋", "zh-TW"], ["我想去名古屋市", "zh-TW"], ["我想去名古屋站", "zh-TW"], ["我想去台東", "zh-TW"], ["我想去台東市區", "zh-TW"],
  ["済州市に行きたい", "ja"], ["제주시 가고 싶어", "ko"],
];

// Flows: [id, locale, [turns...]]
const FLOWS = [
  ["F1", "zh-TW", ["我想去東京 3 天", "第2組但是想多待一天"]],
  ["F2", "zh-TW", ["東京3天，第2天想多待一天"]],
  ["F3a", "zh-TW", ["我想去東京 3 天", "多待一天"]],
  ["F3b", "zh-TW", ["我想去東京 3 天", "第2組", "多待一天"]],
  ["F4", "ja", ["東京に3日間行きたい", "もう1日いたい"]],
  ["F5", "ja", ["東京に3日間行きたい", "もう3日間滞在したい"]],
  ["F6", "ja", ["東京にもう3日間滞在したい"]],
  // follow-ups: digit / uncovered extra-day wordings on the same menu
  ["F7", "zh-TW", ["我想去東京 3 天", "多待1天"]],
  ["F8", "zh-TW", ["我想去東京 3 天", "可以多一天嗎"]],
  ["F9", "ja", ["東京に3日間行きたい", "あと1日いたい"]],
  ["F10", "ko", ["도쿄 3일 여행", "3일 더 있고 싶어"]],
];
const AREA_UNIT = ["済州に行きたい", "済州市に行きたい", "大阪市に行きたい", "京都市に行きたい", "名古屋市に行きたい", "東京都に行きたい",
  "濟州市西歸浦", "台北市信義區", "我想去濟州島", "大阪大阪城", "名古屋城", "我想去大阪城"];

const UNIT = [
  "多待一天", "第2組但是想多待一天", "東京3天，第2天想多待一天", "我想去東京 3 天", "もう1日いたい", "東京に3日間行きたい",
  "もう3日間滞在したい", "東京にもう3日間滞在したい", "もう一日", "多留兩天", "再待一晚", "多玩3天", "多住一晚",
  "再多待1天，總共4天", "總共4天，想多住一晚", "東京5天4夜，多待一晚", "第3天", "3日目", "もう3日後に出発", "あと1日いたい",
  "多一天", "하루 더 있고 싶어", "3일 더", "one more day",
];

function sliceHarness() {
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const rs = slice.indexOf("  let delta = constraints.parsePlanningConstraintDelta(");
  const reEnd = "  n = constraints.applyPlanningConstraintDelta(n, delta, []);";
  const re = slice.indexOf(reEnd);
  if (rs < 0 || re < 0) return { err: `HARNESS anchors missing rs=${rs} re=${re}` };
  const replacement = [
    "  const shownCandidates = constraints.resolvePlanningCandidateContext(n, []).candidates;",
    "  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates, authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate,",
    "    activePlace: n.placeDetailFocus ?? (shownCandidates.length === 1 ? shownCandidates[0] : undefined) });",
    "  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });",
    "  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: shownCandidates.length, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });",
    "  if (globalThis.__TAA(req, shownCandidates, base, n)) return { s: n, row: snapOf(n, \"missing candidate context clarification\", prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? \"(p0bde867c73)\") };",
    "  n = constraints.applyPlanningConstraintDelta(n, delta, shownCandidates);",
  ].join("\n");
  slice = slice.slice(0, rs) + replacement + slice.slice(re + reEnd.length);
  slice = slice.replace('return dateQuestion("13058");', '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const geoLines = EXTRA_FIX.map(([k, re2, city, region, country, code, lat, lng]) => `  ${k}: { re: ${re2}, city: ${JSON.stringify(city)}, region: ${JSON.stringify(region)}, country: ${JSON.stringify(country)}, code: "${code}", lat: ${lat}, lng: ${lng} },\n`).join("");
  const localLines = EXTRA_FIX.map(([k, , , , , , , , loc]) => `${k}: ${JSON.stringify(loc)}, `).join("");
  slice = slice.replace("  kamakura: { re: /kamakura", geoLines + "  kamakura: { re: /kamakura")
    .replace('kamakura: ["Kamakura"', localLines + 'kamakura: ["Kamakura"')
    .replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  return { slice };
}

function extractRoute() {
  const src = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const a = src.indexOf('parseStage = "apply_delta";');
  if (a < 0) return { err: "anchor parseStage apply_delta not found" };
  const b = src.indexOf("unresolvedPlanningCandidateContext =", a);
  if (b < 0) return { err: "assignment not found" };
  const c = src.indexOf(";", b);
  const code = src.slice(a + 'parseStage = "apply_delta";'.length, c + 1);
  const fn = new Function("contextRequirement", "shownCandidates", "sessionForTurn", "nextSession", "isCombinationChoiceTurn",
    `let unresolvedPlanningCandidateContext = false;\n${code}\nreturn unresolvedPlanningCandidateContext;`);
  return { fn };
}

function scanCuratedList() {
  const src = readFileSync("src/lib/ai/destination-travel-profile.ts", "utf8");
  const a = src.indexOf("const CURATED_PROFILES");
  const b = src.indexOf("function toDestinationAreaScope", a);
  const body = src.slice(a, b);
  const rows = [];
  const re = /\n {2}([^\s:]+): \{\n\s+categories:[^\n]*\n\s+districts: \[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body))) {
    const city = m[1];
    const districts = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    rows.push({ city, districts });
  }
  return rows;
}

async function collect() {
  const R = { area: {}, flows: {}, unit: {}, list: [] };
  const sessionMod = await load("src/lib/chat-session.ts");
  const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const tpcU = await load("src/lib/ai/trip-planning-context.ts");
  const prof = await load("src/lib/ai/destination-travel-profile.ts");
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const route = extractRoute();
  if (!route.fn) { R.err = route.err; return R; }
  const isCCT = partialApi?.isCombinationChoiceTurn ?? ((s) => s?.pendingQuestion?.type === "combination_choice");
  globalThis.__TAA = (req, shown, base, n) => route.fn(req, shown, base, n, isCCT);
  const hs = sliceHarness();
  if (!hs.slice) { R.err = hs.err; return R; }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    hs.slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? null : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const areaKeys = (tc, s) => {
    const keys = Object.keys(tc).filter((k) => /area|scope|district|preferred/i.test(k) && tc[k] !== undefined);
    const parts = keys.map((k) => `${k}=${String(JSON.stringify(tc[k])).slice(0, 70)}`);
    if (s.preferredArea) parts.push(`s.preferredArea=${s.preferredArea}`);
    if (s.tripDestination?.displayLabel) parts.push(`trip.displayLabel=${s.tripDestination.displayLabel}`);
    return parts.join(" ; ") || "-";
  };
  const offeredIds = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => c.id);
  const rowOf = (r, n0, shownIds) => {
    const s = r.s; const tc = s.travelContext ?? {};
    const per = geoLogs().map((l, i) => l.slice(n0[i]));
    return { b: r.row?.branch ?? null, pend: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      trip: s.tripDestination?.city ?? null, days: tc.days ?? null, tripDays: s.tripDays ?? null,
      offered: offeredIds(s).length, sel: shownIds ? (tc.selectedCombinationIds ?? []).map((id) => shownIds.indexOf(id) + 1) : (tc.selectedCombinationIds ?? []).length,
      area: areaKeys(tc, s), geo: per.reduce((a, l) => a + l.length, 0), q: per.flatMap((l, i) => l.map((x) => `${["g", "a", "d"][i]}:${x}`)).join(" ; "),
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 90) };
  };
  // A) area
  for (const [t, loc] of AREA) {
    setNav(loc); H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const n0 = geoLogs().map((l) => l.length);
    const unit = { scope: g(() => { const v = prof.resolveDestinationAreaScope(t); return v ? `${v.displayLabel}(${v.parentCity}+${v.area})` : null; }),
      curated: g(() => { const v = prof.resolveCuratedOrCachedDestinationAreaScope(t); return v ? `${v.displayLabel}(${v.parentCity}+${v.area})` : null; }),
      norm: g(() => tpcU.normalizeDestinationLabel(t.replace(/^我想去/, "").replace(/\s*\d+\s*天$/, ""))) };
    try {
      const r = await H.appTurn(sessionMod.createEmptySession(), t, loc);
      R.area[t] = { ...rowOf(r, n0, null), unit };
    } catch (e) { R.area[t] = { b: `THROW ${String(e?.message ?? e).slice(0, 120)}`, stack: String(e?.stack ?? "").split("\n").slice(1, 5).map((x) => x.trim().slice(-110)).join(" <- "), unit, geo: -1 }; }
  }
  // L) list scan
  const strip = (x) => x.replace(/[市區区]$/u, "");
  for (const { city, districts } of scanCuratedList()) {
    for (const d of districts) {
      const nd = g(() => tpcU.normalizeDestinationLabel(d));
      if (strip(d) === city || nd === city || d.includes(city)) R.list.push({ city, d, norm: nd, sameAfterStrip: strip(d) === city, sameNorm: nd === city });
    }
  }
  // F) flows
  for (const [id, loc, turns] of FLOWS) {
    setNav(loc); H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    let s = sessionMod.createEmptySession();
    let shownIds = null;
    const steps = [];
    for (const t of turns) {
      const n0 = geoLogs().map((l) => l.length);
      try {
        const pre = offeredIds(s); if (pre.length) shownIds = pre;
        const r = await H.appTurn(structuredClone(s), t, loc);
        steps.push({ t, ...rowOf(r, n0, shownIds) });
        s = { ...r.s, lastAssistantReply: r.s?.lastAssistantReply ?? (r.row?.reply ?? "").replace(/ \/ /g, "\n") };
      } catch (e) { steps.push({ t, b: `THROW ${String(e?.message ?? e).slice(0, 120)}`, stack: String(e?.stack ?? "").split("\n").slice(1, 5).map((x) => x.trim().slice(-110)).join(" <- ") }); break; }
    }
    R.flows[id] = steps;
  }
  // U) unit
  for (const t of UNIT) R.unit[t] = g(() => dur.parseDayCountFromText(t));
  R.areaUnit = {};
  for (const t of AREA_UNIT) R.areaUnit[t] = g(() => { const v = prof.resolveDestinationAreaScope(t); return v ? `${v.displayLabel}(${v.parentCity}+${v.area})` : null; });
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAA_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-taa-b20-b21-area-extra-days.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 220_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TAA_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  if (W.err) out(`FAIL harness: ${W.err}`);
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const cell = (x) => (!x ? "n/a" : `[${(x.b ?? "").slice(0, 34)}] p=${x.pend ?? "-"} dest=${x.dest ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} days=${x.days ?? "-"}/${x.tripDays ?? "-"} off=${x.offered} geo=${x.geo}${x.q ? `(${x.q})` : ""}`);
  const DOUBLED = /(\p{Script=Han}{2,})\1/u;

  out("==== A) area sentences (W | H) ====");
  for (const [t] of AREA) {
    const w = W.area[t]; const h = HR?.area?.[t];
    if (!BRIEF) {
      out(`「${t}」\n   W ${cell(w)}\n     W area: ${w?.area ?? "-"}\n     W unit: scope=${w?.unit?.scope} curated=${w?.unit?.curated} norm=${w?.unit?.norm}\n     W reply: ${w?.reply ?? "-"}`);
      out(`   H ${cell(h)}\n     H area: ${h?.area ?? "-"}\n     H unit: scope=${h?.unit?.scope} curated=${h?.unit?.curated} norm=${h?.unit?.norm}\n     H reply: ${h?.reply ?? "-"}`);
    }
    if (!w || String(w.b).startsWith("THROW")) { fail(`${t}#err`, `${w?.b ?? "no row"} STACK ${w?.stack ?? "-"}`); continue; }
    const blob = [w.dest, w.trip, w.reply, w.unit?.scope, w.unit?.curated].filter(Boolean).join(" ");
    if (/濟州濟州|済州済州|제주제주/.test(blob) || DOUBLED.test(w.dest ?? "")) fail(`${t}#doubled`, `doubled label: ${blob.slice(0, 120)}`);
  }
  const regressArea = [["我想去台北信義區", /信義/], ["我想去首爾明洞", /明洞/], ["我想去大阪難波", /難波/], ["我想去台南安平", /安平/], ["我想去大阪道頓堀", /道頓堀/]];
  for (const [t, re] of regressArea) {
    const w = W.area[t]; const h = HR?.area?.[t];
    const has = (x) => Boolean(x) && re.test([x.dest, x.cand, x.trip, x.area, x.unit?.scope].filter(Boolean).join(" "));
    if (h && has(h) && !has(w)) fail(`${t}#areaRegress`, `area lost vs HEAD: W ${cell(w)} | H ${cell(h)}`);
  }

  out("\n==== A) SUMMARY TABLE (text | W dest / unit scope / geo | H dest / unit scope / geo) ====");
  const sa = (x) => (!x ? "n/a" : `${x.dest ?? "-"} / ${x.unit?.scope ?? "-"} / days=${x.days ?? "-"} / geo${x.geo} [${(x.b ?? "").slice(0, 26)}]`);
  for (const [t] of AREA) out(`  ${t} | W ${sa(W.area[t])} | H ${sa(HR?.area?.[t])}`);

  out("\n==== L) CURATED_PROFILES districts containing / equal to their parent city (W) ====");
  for (const x of W.list) out(`  ${x.city}: ${x.d} norm=${x.norm} sameAfterStrip(市/區)=${x.sameAfterStrip} sameNorm=${x.sameNorm}`);

  out("\n==== F) flows (W | H) ====");
  for (const [id, , turns] of FLOWS) {
    const ws = W.flows[id] ?? []; const hs2 = HR?.flows?.[id] ?? [];
    turns.forEach((t, i) => {
      const w = ws[i]; const h = hs2[i];
      if (BRIEF) { out(`  ${id}.${i + 1} ${t} | W ${w?.b?.slice(0, 20)} p=${w?.pend ?? "-"} days=${w?.days ?? "-"} sel=${JSON.stringify(w?.sel)} r=${(w?.reply ?? "").slice(0, 34)} | H p=${h?.pend ?? "-"} days=${h?.days ?? "-"} sel=${JSON.stringify(h?.sel)}`); return; }
      out(`  ${id}.${i + 1} 「${t}」\n     W ${cell(w)} sel=${JSON.stringify(w?.sel)}\n       reply: ${w?.reply ?? "-"}\n     H ${cell(h)} sel=${JSON.stringify(h?.sel)}\n       reply: ${h?.reply ?? "-"}`);
    });
  }
  for (const [id] of FLOWS) for (const x of W.flows[id] ?? []) if (x.stack) out(`  STACK W ${id} 「${x.t}」: ${x.stack}`);
  const step = (id, i) => W.flows[id]?.[i];
  const daysOf = (x) => x?.days ?? x?.tripDays ?? null;
  const expect = (k, ok, m) => { if (!ok) fail(k, m); };
  expect("F1.1#days3", daysOf(step("F1", 0)) === 3, `「我想去東京 3 天」 days=${daysOf(step("F1", 0))}`);
  expect("F1.2#sel2", JSON.stringify(step("F1", 1)?.sel) === "[2]", `sel=${JSON.stringify(step("F1", 1)?.sel)}`);
  expect("F1.2#days3", daysOf(step("F1", 1)) === 3, `days=${daysOf(step("F1", 1))}`);
  expect("F2.1#days3", daysOf(step("F2", 0)) === 3, `「東京3天，第2天想多待一天」 days=${daysOf(step("F2", 0))}`);
  expect("F3a.2#days3", daysOf(step("F3a", 1)) === 3, `「多待一天」 on menu days=${daysOf(step("F3a", 1))}`);
  expect("F3b.3#days3", daysOf(step("F3b", 2)) === 3, `「多待一天」 after pick days=${daysOf(step("F3b", 2))}`);
  expect("F4.1#days3", daysOf(step("F4", 0)) === 3, `「東京に3日間行きたい」 days=${daysOf(step("F4", 0))}`);
  expect("F4.2#days3", daysOf(step("F4", 1)) === 3, `「もう1日いたい」 days=${daysOf(step("F4", 1))}`);
  for (const id of ["F1", "F3a", "F3b", "F4", "F5"]) {
    const last = (W.flows[id] ?? []).at(-1);
    if (last && /濟州|釜山|Jeju/.test(last.dest ?? "")) fail(`${id}#dest`, `dest drifted: ${cell(last)}`);
  }

  out("\n==== U) parseDayCountFromText (text | W | H) ====");
  for (const t of UNIT) out(`  ${t} | W ${W.unit[t]} | H ${HR?.unit?.[t] ?? "n/a"}${HR && W.unit[t] !== HR.unit?.[t] ? "  (diff)" : ""}`);
  expect("U#我想去東京3天", W.unit["我想去東京 3 天"] === 3, `got ${W.unit["我想去東京 3 天"]}`);
  expect("U#東京に3日間", W.unit["東京に3日間行きたい"] === 3, `got ${W.unit["東京に3日間行きたい"]}`);
  expect("U#多待一天", W.unit["多待一天"] == null, `got ${W.unit["多待一天"]}`);
  expect("U#総共4天", W.unit["再多待1天，總共4天"] === 4, `got ${W.unit["再多待1天，總共4天"]}`);
  expect("U#総共4天b", W.unit["總共4天，想多住一晚"] === 4, `got ${W.unit["總共4天，想多住一晚"]}`);

  out("\n==== U2) resolveDestinationAreaScope (text | W | H) ====");
  for (const t of AREA_UNIT) out(`  ${t} | W ${W.areaUnit?.[t]} | H ${HR?.areaUnit?.[t] ?? "n/a"}${HR && W.areaUnit?.[t] !== HR.areaUnit?.[t] ? "  (diff)" : ""}`);
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
