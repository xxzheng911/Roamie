import "./verify-netguard-full.mjs";
/**
 * T-AF (tester): B25 supplement. W (working tree) vs H (HEAD via --head-dir).
 *  A) mergeTravelContext turn1 -> turn2 (days / dest)
 *  B) App-order turn1 -> turn2 (harness = verify-m16-post-selection-switch-review.mjs, like verify-tae-*)
 *  C) combination_choice menu (我要去東京 -> 3天) -> change phrase
 *  D) place names 四日市 / 十日町 / 廿日市 / 三日月 / 九十九里: 「我想去X」「我想去X 3 天」 (merge + App + pure fns)
 *  E) bare 「三天」「五日」 (fresh, and after 我想去東京 3 天): report only
 *  F) pure parseDayCountFromText edge probes: report only
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=598 scripts/verify-taf-b25-supplement.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
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
const setNav = (on) => {
  if (!on) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: "zh-TW", languages: ["zh-TW"], userAgent: "probe" }, configurable: true, writable: true });
};

const T3 = "我想去東京 3 天";
const T4 = "我想去東京 4 天";
// [turn1, turn2, expectedDays, expectedDestRe]
const PAIRS = [
  [T3, "改成三天", 3, "東京"],
  [T4, "改成三天", 3, "東京"],
  [T3, "換成五天", 5, "東京"],
  [T3, "變成兩天", 2, "東京"],
  [T3, "改去京都", null, "京都"],
  [T3, "我要改去大阪", null, "大阪"],
  [T3, "不是3天是4天", 4, "東京"],
  [T3, "不要太累，3天就好", 3, "東京"],
  [T4, "不要太累，3天就好", 3, "東京"],
  [T3, "別3天，5天", 5, "東京"],
];
const COMBO = ["改成三天", "換成五天", "變成兩天", "改去京都", "我要改去大阪", "不是3天是4天", "別3天，5天"];
const COMBO_EXP = { 改成三天: [3, "東京"], 換成五天: [5, "東京"], 變成兩天: [2, "東京"], 改去京都: [null, "京都"], 我要改去大阪: [null, "大阪"], 不是3天是4天: [4, "東京"], "別3天，5天": [5, "東京"] };
const PLACES = ["四日市", "十日町", "廿日市", "三日月", "九十九里"];
const BARE = ["三天", "五日"];
const PURE = ["不要 3 天，要 4 天", "不要３天要４天", "這不是3天的行程嗎", "不要超過3天", "我不要3天4夜", "不要三天，五天", "別人說3天", "特別想去3天", "不是第3天", "3天不要"];

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

async function collect() {
  const R = { merge: {}, app: {}, combo: {}, menu: null, place: {}, bare: {}, pure: {} };
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const tc = await load("src/lib/ai/travel-context.ts");
  const sig = await loadOpt("src/lib/ai/travel-language-signals.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const g = (fn) => { try { return fn(); } catch (e) { return { err: `THROW ${String(e?.message ?? e).slice(0, 120)}` }; } };
  const snapM = (r) => ({ dest: r.context.destination ?? null, days: r.context.days ?? null, sDays: r.session.tripDays ?? null, p: r.session.pendingQuestion?.type ?? null });
  const merge2 = (a, b) => g(() => {
    const r1 = tc.mergeTravelContext(sessionMod.createEmptySession(), a);
    if (b === undefined) return { t1: snapM(r1) };
    const r2 = tc.mergeTravelContext(r1.session, b);
    return { t1: snapM(r1), t2: snapM(r2), p2: dur.parseDayCountFromText(b) ?? null };
  });

  for (const [a, b] of PAIRS) R.merge[`${a} -> ${b}`] = merge2(a, b);
  for (const x of PURE) R.pure[x] = g(() => dur.parseDayCountFromText(x) ?? null);
  for (const p of PLACES) {
    for (const t of [`我想去${p}`, `我想去${p} 3 天`]) {
      R.place[t] = { merge: merge2(t), safe: g(() => sig?.safeDestinationCandidate?.(p) ?? "n/a"),
        cands: g(() => sig?.travelDestinationCandidates?.(t) ?? "n/a"), dur: g(() => dur.parseDayCountFromText(t) ?? null) };
    }
  }
  for (const x of BARE) R.bare[x] = { fresh: merge2(x), afterT3: merge2(T3, x), dur: g(() => dur.parseDayCountFromText(x) ?? null) };

  const route = extractRoute();
  if (!route.fn) { R.err = route.err; return R; }
  const isCCT = partialApi?.isCombinationChoiceTurn ?? ((s) => s?.pendingQuestion?.type === "combination_choice");
  globalThis.__B16 = (req, shown, base, n) => route.fn(req, shown, base, n, isCCT);
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const rs = slice.indexOf("  let delta = constraints.parsePlanningConstraintDelta(");
  const reEnd = "  n = constraints.applyPlanningConstraintDelta(n, delta, []);";
  const re = slice.indexOf(reEnd);
  if (from < 0 || to < 0 || rs < 0 || re < 0) { R.err = `HARNESS anchors missing from=${from} to=${to} rs=${rs} re=${re}`; return R; }
  const replacement = [
    "  const shownCandidates = constraints.resolvePlanningCandidateContext(n, []).candidates;",
    "  let delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates, authoritativeDestination: n.travelContext?.destination ?? merged.context.destination ?? destCandidate,",
    "    activePlace: n.placeDetailFocus ?? (shownCandidates.length === 1 ? shownCandidates[0] : undefined) });",
    "  delta = constraints.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });",
    "  const req = constraints.resolvePlanningContextRequirement({ text: t, delta, candidateCount: shownCandidates.length, destinationDetected: Boolean(destCandidate), durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate) });",
    "  if (globalThis.__B16(req, shownCandidates, base, n)) return { s: n, row: snapOf(n, \"missing candidate context clarification\", prodUi.productionUiMessages?.[locale]?.p0bde867c73 ?? \"(p0bde867c73)\") };",
    "  n = constraints.applyPlanningConstraintDelta(n, delta, shownCandidates);",
  ].join("\n");
  slice = slice.slice(0, rs) + replacement + slice.slice(re + reEnd.length);
  slice = slice.replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const offeredIds = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => c.id);
  const rowOf = (a, pre) => {
    const t = a.s?.travelContext ?? {};
    const shownIds = offeredIds(pre);
    return { branch: a.row?.branch ?? null, p: a.s?.pendingQuestion?.type ?? null, dest: t.destination ?? null,
      days: t.days ?? null, sDays: a.s?.tripDays ?? null, offered: offeredIds(a.s).length,
      sel: (t.selectedCombinationIds ?? []).map((id) => shownIds.indexOf(id) + 1), reply: (a.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 90) };
  };
  const nextBase = (a) => ({ ...a.s, lastAssistantReply: a.s?.lastAssistantReply ?? (a.row?.reply ?? "").replace(/ \/ /g, "\n") });
  const fresh = async () => { setNav(true); H.freshAll(); await H.freshAuthority(); H.setLocale("zh-TW"); };
  const app2 = async (a, b) => {
    try {
      await fresh();
      const a1 = await H.appTurn(sessionMod.createEmptySession(), a, "zh-TW");
      const t1 = rowOf(a1, sessionMod.createEmptySession());
      if (b === undefined) return { t1 };
      const pre = nextBase(a1);
      const a2 = await H.appTurn(structuredClone(pre), b, "zh-TW");
      return { t1, t2: rowOf(a2, pre) };
    } catch (e) { return { err: String(e?.message ?? e).slice(0, 160) }; }
  };

  for (const [a, b] of PAIRS) R.app[`${a} -> ${b}`] = await app2(a, b);
  for (const p of PLACES) for (const t of [`我想去${p}`, `我想去${p} 3 天`]) R.place[t].app = await app2(t);
  for (const x of BARE) { R.bare[x].appFresh = await app2(x); R.bare[x].appAfterT3 = await app2(T3, x); }
  for (const b of COMBO) {
    try {
      await fresh();
      const a1 = await H.appTurn(sessionMod.createEmptySession(), "我要去東京", "zh-TW");
      const a2 = await H.appTurn(nextBase(a1), "3天", "zh-TW");
      const pre = nextBase(a2);
      R.menu = { p: pre.pendingQuestion?.type ?? null, offered: offeredIds(pre).length, days: pre.travelContext?.days ?? null, dest: pre.travelContext?.destination ?? null };
      const a3 = await H.appTurn(structuredClone(pre), b, "zh-TW");
      R.combo[b] = rowOf(a3, pre);
    } catch (e) { R.combo[b] = { err: String(e?.message ?? e).slice(0, 160) }; }
  }
  setNav(false);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAF_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-taf-b25-supplement.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 270_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TAF_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  // --compact: drop reply / turn1 lines and sections A, E, F so the whole report fits
  const CP = argv.includes("--compact");
  const R1 = (s) => (CP ? s.split("\n").filter((l) => !/^\s+(W reply|fresh app W reply|t1 W)/.test(l)).join("\n") : s);
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`   FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  if (!HR) fail("HEAD", "no HEAD result");
  if (W.err) fail("harness", W.err);
  if (HR?.err) out(`NOTE HEAD harness err: ${HR.err}`);
  const m = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err.slice(0, 60)}` : `dest=${x.dest ?? "-"} days=${x.days ?? "-"} sDays=${x.sDays ?? "-"} p=${x.p ?? "-"}`);
  const ab = (b) => (b ?? "-").replace("missing candidate context clarification", "CLARIFY").replace("planning advice", "ADVICE").replace(" date/duration question", " ask_days");
  const c = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err.slice(0, 80)}` : `${ab(x.branch)} p=${x.p ?? "-"} dest=${x.dest ?? "-"} days=${x.days ?? "-"} sDays=${x.sDays ?? "-"} offered=${x.offered} sel=${S(x.sel)}`);
  const daysOf = (x) => x?.days ?? x?.sDays ?? null;
  const check = (k, x, expDays, expDest, needMenu) => {
    if (!x || x.err) return fail(`${k}#err`, x?.err ?? "no row");
    if (expDays !== null && daysOf(x) !== expDays) fail(`${k}#days`, `days ${daysOf(x)} expected ${expDays}`);
    if (!new RegExp(expDest).test(x.dest ?? "")) fail(`${k}#dest`, `dest ${x.dest} expected ${expDest}`);
    if (needMenu && (x.p !== "combination_choice" || !(x.offered > 0))) fail(`${k}#menu`, `p=${x.p} offered=${x.offered} (menu not kept)`);
    if (needMenu && x.sel?.length) fail(`${k}#sel`, `treated as group pick sel=${S(x.sel)}`);
  };

  out("\n==== A) merge turn1 -> turn2 (W | H) ====");
  for (const [a, b, d, re] of PAIRS) {
    const k = `${a} -> ${b}`; const w = W.merge[k]; const h = HR?.merge?.[k];
    if (!CP) out(`  ${k}\n     W ${m(w?.t2)} p2=${w?.p2} | H ${m(h?.t2)} p2=${h?.p2}`);
    check(`A#${k}`, w?.err ? w : w?.t2, d, re, false);
  }
  out("\n==== B) App turn1 -> turn2 (W | H) ====");
  for (const [a, b, d, re] of PAIRS) {
    const k = `${a} -> ${b}`; const w = W.app[k]; const h = HR?.app?.[k];
    out(R1(`  ${k}\n     t1 W ${c(w?.t1)} | H ${c(h?.t1)}\n     t2 W ${c(w?.t2)}\n     t2 H ${c(h?.t2)}\n     W reply: ${w?.t2?.reply ?? "-"}`));
    // destination change: menu may be rebuilt for the new place; days check only when expected
    check(`B#${k}`, w?.err ? w : w?.t2, d, re, d !== null);
  }
  out(`\n==== C) menu (W ${S(W.menu)} | H ${S(HR?.menu ?? null)}) -> phrase ====`);
  for (const b of COMBO) {
    const w = W.combo[b]; const h = HR?.combo?.[b]; const [d, re] = COMBO_EXP[b];
    out(R1(`  ${b}\n     W ${c(w)}\n     H ${c(h)}\n     W reply: ${w?.reply ?? "-"}`));
    check(`C#${b}`, w, d, re, d !== null);
  }
  out("\n==== D) place names (W | H) ====");
  for (const p of PLACES) for (const t of [`我想去${p}`, `我想去${p} 3 天`]) {
    const w = W.place[t]; const h = HR?.place?.[t]; const wantDays = t.endsWith("3 天") ? 3 : null;
    out(`  ${t}\n     merge W ${m(w?.merge?.t1)} | H ${m(h?.merge?.t1)}\n     safe(${p}) W ${S(w?.safe)} H ${S(h?.safe)}  cands W ${S(w?.cands)} H ${S(h?.cands)}  dur W ${S(w?.dur)} H ${S(h?.dur)}\n     app W ${c(w?.app?.t1)}\n     app H ${c(h?.app?.t1)}`);
    if (w?.safe !== true) fail(`D#${t}#safe`, `safeDestinationCandidate(${p}) W ${S(w?.safe)} H ${S(h?.safe)}`);
    if (w?.dur !== wantDays) fail(`D#${t}#dur`, `parseDayCount W ${S(w?.dur)} expected ${wantDays} (H ${S(h?.dur)})`);
    const wd = w?.merge?.t1?.dest ?? ""; const hd = h?.merge?.t1?.dest ?? "";
    if (hd.includes(p) && !wd.includes(p)) fail(`D#${t}#merge-dest-regress`, `H ${hd} -> W ${wd}`);
    const wa = w?.app?.t1?.dest ?? ""; const ha = h?.app?.t1?.dest ?? "";
    if (ha.includes(p) && !wa.includes(p)) fail(`D#${t}#app-dest-regress`, `H ${ha} -> W ${wa}`);
    if (!wd.includes(p) && !wa.includes(p)) out(`   NOTE ${t}: W did not keep ${p} as destination (merge ${wd || "-"} / app ${wa || "-"})`);
  }
  out("\n==== E) bare (report only, W | H) ====");
  for (const x of CP ? [] : BARE) {
    const w = W.bare[x]; const h = HR?.bare?.[x];
    out(`  ${x}: dur W ${S(w?.dur)} H ${S(h?.dur)}\n     fresh merge W ${m(w?.fresh?.t1)} | H ${m(h?.fresh?.t1)}\n     afterT3 merge W ${m(w?.afterT3?.t2)} | H ${m(h?.afterT3?.t2)}\n     fresh app W ${c(w?.appFresh?.t1)} | H ${c(h?.appFresh?.t1)}\n     fresh app W reply: ${w?.appFresh?.t1?.reply ?? "-"}\n     afterT3 app W ${c(w?.appAfterT3?.t2)} | H ${c(h?.appAfterT3?.t2)}`);
  }
  out("\n==== F) pure parseDayCountFromText (report only, W | H) ====");
  for (const x of CP ? [] : PURE) out(`  ${x}: W ${S(W.pure[x])} H ${S(HR?.pure?.[x])}`);

  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
