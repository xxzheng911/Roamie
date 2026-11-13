import "./verify-netguard-full.mjs";
/**
 * T-AE (tester): with an existing trip (東京 3 天), can the user change the trip length by saying 「改成 4 天」 etc.?
 * W (working tree) vs H (HEAD via --head-dir).
 *  A) pure multi-turn mergeTravelContext: turn1 -> turn2, report dest / context.days / session.tripDays / pendingQuestion
 *  B) App-order turn (harness = verify-m16-post-selection-switch-review.mjs, routing statement from _app.chat.tsx like
 *     verify-tz-b17-colloquial-pick.mjs): turn1 -> turn2, report branch / pending / days / dest / reply
 *  C) combination_choice menu (我要去東京 -> 3天) then 「改成 4 天」 etc.: days must become 4, must not pick group 4
 * Expected: W turn2 days === 4 (and dest stays 東京). HEAD 4 but W not 4 => regression.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-tae-change-days-existing-trip.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 560s"); process.exit(3); }, 560_000).unref();

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

const T1_ZH = "我想去東京 3 天";
// [turn1, turn1 locale, turn2, turn2 locale]
const PAIRS = [
  [T1_ZH, "zh-TW", "改成 4 天", "zh-TW"],
  [T1_ZH, "zh-TW", "我要 4 天", "zh-TW"],
  [T1_ZH, "zh-TW", "4天好了", "zh-TW"],
  [T1_ZH, "zh-TW", "改成四天", "zh-TW"],
  [T1_ZH, "zh-TW", "天數改成 4 天", "zh-TW"],
  [T1_ZH, "zh-TW", "不要3天，要4天", "zh-TW"],
  [T1_ZH, "zh-TW", "4日間にして", "ja"],
  [T1_ZH, "zh-TW", "make it 4 days", "en"],
  [T1_ZH, "zh-TW", "4일로 해줘", "ko"],
  ["東京に3日間行きたい", "ja", "4日間にして", "ja"],
  ["make a 3 day trip to Tokyo", "en", "make it 4 days", "en"],
];
// combination_choice menu built in zh-TW (我要去東京 -> 3天), then these
const COMBO = ["改成 4 天", "我要 4 天", "4天好了", "改成四天", "天數改成 4 天", "不要3天，要4天"];
const TOKYO_RE = /東京|Tokyo|도쿄/i;

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
  return { code: code.trim(), fn };
}

async function collect() {
  const R = { merge: {}, app: {}, combo: {}, menu: null };
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const tc = await load("src/lib/ai/travel-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const g = (fn) => { try { return fn(); } catch (e) { return { err: `THROW ${String(e?.message ?? e).slice(0, 120)}` }; } };

  // A) pure mergeTravelContext
  for (const [a, , b] of PAIRS) {
    R.merge[`${a} -> ${b}`] = g(() => {
      const r1 = tc.mergeTravelContext(sessionMod.createEmptySession(), a);
      const r2 = tc.mergeTravelContext(r1.session, b);
      const snap = (r) => ({ dest: r.context.destination ?? null, days: r.context.days ?? null, sDays: r.session.tripDays ?? null, p: r.session.pendingQuestion?.type ?? null });
      return { t1: snap(r1), t2: snap(r2), p2: dur.parseDayCountFromText(b) ?? null };
    });
  }

  // B/C) App-order harness
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
    return { branch: a.row?.branch ?? null, cls: a.row?.cls ?? null, p: a.s?.pendingQuestion?.type ?? null, dest: t.destination ?? null,
      days: t.days ?? null, sDays: a.s?.tripDays ?? null, offered: offeredIds(a.s).length,
      sel: (t.selectedCombinationIds ?? []).map((id) => shownIds.indexOf(id) + 1), sidChanged: a.s?.planningSessionId !== pre?.planningSessionId,
      reply: (a.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 200) };
  };
  const nextBase = (a) => ({ ...a.s, lastAssistantReply: a.s?.lastAssistantReply ?? (a.row?.reply ?? "").replace(/ \/ /g, "\n") });

  for (const [a, la, b, lb] of PAIRS) {
    const key = `${a} -> ${b}`;
    try {
      setNav(la); H.freshAll(); await H.freshAuthority(); H.setLocale(la);
      const a1 = await H.appTurn(sessionMod.createEmptySession(), a, la);
      const pre = nextBase(a1);
      const t1 = rowOf(a1, sessionMod.createEmptySession());
      setNav(lb); H.setLocale(lb);
      const a2 = await H.appTurn(structuredClone(pre), b, lb);
      R.app[key] = { t1, t2: rowOf(a2, pre) };
    } catch (e) { R.app[key] = { err: String(e?.message ?? e).slice(0, 160) }; }
  }

  for (const b of COMBO) {
    try {
      setNav("zh-TW"); H.freshAll(); await H.freshAuthority(); H.setLocale("zh-TW");
      const a1 = await H.appTurn(sessionMod.createEmptySession(), "我要去東京", "zh-TW");
      const a2 = await H.appTurn(nextBase(a1), "3天", "zh-TW");
      const pre = nextBase(a2);
      R.menu = { p: pre.pendingQuestion?.type ?? null, offered: offeredIds(pre).length, days: pre.travelContext?.days ?? null, dest: pre.travelContext?.destination ?? null };
      const a3 = await H.appTurn(structuredClone(pre), b, "zh-TW");
      R.combo[b] = { preP: pre.pendingQuestion?.type ?? null, preOffered: offeredIds(pre).length, preDays: pre.travelContext?.days ?? null, t: rowOf(a3, pre) };
    } catch (e) { R.combo[b] = { err: String(e?.message ?? e).slice(0, 160) }; }
  }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAE_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tae-change-days-existing-trip.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 260_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TAE_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  if (!HR) fail("HEAD", "no HEAD result");
  if (W.err) fail("harness", W.err);
  if (HR?.err) out(`NOTE HEAD harness err: ${HR.err}`);
  const reg = (k, w, h) => { if (h === 4 && w !== 4) out(`   REGRESSION vs HEAD: ${k} H days 4 -> W ${w}`); };

  out("\n==== A) mergeTravelContext multi-turn (W | H) ====");
  for (const [a, , b] of PAIRS) {
    const k = `${a} -> ${b}`; const w = W.merge[k]; const h = HR?.merge?.[k];
    const ok = w && !w.err && w.t2.days === 4 && TOKYO_RE.test(w.t2.dest ?? "");
    out(`  ${ok ? "PASS" : "FAIL"} ${k}\n     W ${S(w)}\n     H ${S(h ?? null)}`);
    if (!w || w.err) { fail(`A#${k}#err`, w?.err ?? "no row"); continue; }
    if (w.t1.days !== 3) fail(`A#${k}#t1`, `turn1 days ${w.t1.days} expected 3`);
    if (w.t2.days !== 4) fail(`A#${k}#days`, `turn2 context.days ${w.t2.days} expected 4 (H ${h?.t2?.days ?? "n/a"})`);
    if (w.t2.sDays !== null && w.t2.sDays !== 4) fail(`A#${k}#sDays`, `turn2 session.tripDays ${w.t2.sDays} expected 4`);
    if (!TOKYO_RE.test(w.t2.dest ?? "")) fail(`A#${k}#dest`, `turn2 dest ${w.t2.dest}`);
    reg(`A ${k}`, w.t2.days, h?.t2?.days);
  }

  const ab = (b) => (b ?? "-").replace("missing candidate context clarification", "CLARIFY").replace("planning advice", "ADVICE").replace(" date/duration question", " ask_days");
  const cell = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err.slice(0, 80)}` : `${ab(x.branch)} p=${x.p ?? "-"} dest=${x.dest ?? "-"} days=${x.days ?? "-"} sDays=${x.sDays ?? "-"} offered=${x.offered} sel=${S(x.sel)} sid${x.sidChanged ? "+" : "="} cls=${x.cls ?? "-"}`);
  const verbose = !argv.includes("--brief");
  out("\n==== B) App-order turn1 -> turn2 (W | H) ====");
  for (const [a, la, b, lb] of PAIRS) {
    const k = `${a} -> ${b}`; const w = W.app[k]; const h = HR?.app?.[k];
    if (!w || w.err) { fail(`B#${k}#err`, w?.err ?? "no row"); continue; }
    const d = w.t2.days ?? w.t2.sDays;
    const ok = d === 4 && TOKYO_RE.test(w.t2.dest ?? "");
    out(`  ${ok ? "PASS" : "FAIL"} [${la}->${lb}] ${k}\n     t1 W ${cell(w.t1)} | H ${cell(h?.t1)}\n     t2 W ${cell(w.t2)}\n     t2 H ${cell(h?.t2)}`);
    if (verbose) out(`     W reply: ${w.t2.reply}\n     H reply: ${h?.t2?.reply ?? "-"}`);
    if (w.t1.days !== 3 && w.t1.sDays !== 3) fail(`B#${k}#t1`, `turn1 days ${w.t1.days}/${w.t1.sDays} expected 3`);
    if (d !== 4) fail(`B#${k}#days`, `turn2 days ${w.t2.days}/${w.t2.sDays} expected 4 (H ${h?.t2?.days ?? "n/a"})`);
    if (!TOKYO_RE.test(w.t2.dest ?? "")) fail(`B#${k}#dest`, `turn2 dest ${w.t2.dest}`);
    if (w.t2.sidChanged) out(`   NOTE ${k}: planningSessionId changed on turn2`);
    reg(`B ${k}`, d, h?.t2 ? (h.t2.days ?? h.t2.sDays) : undefined);
  }

  out(`\n==== C) combination_choice menu -> change days (menu W ${S(W.menu)} | H ${S(HR?.menu ?? null)}) ====`);
  for (const b of COMBO) {
    const w = W.combo[b]; const h = HR?.combo?.[b];
    if (!w || w.err) { fail(`C#${b}#err`, w?.err ?? "no row"); continue; }
    const d = w.t.days ?? w.t.sDays;
    const picked4 = w.t.sel.includes(4) || w.t.sel.includes(0);
    const ok = d === 4 && !picked4 && TOKYO_RE.test(w.t.dest ?? "");
    out(`  ${ok ? "PASS" : "FAIL"} ${b} (pre p=${w.preP} offered=${w.preOffered} days=${w.preDays})\n     W ${cell(w.t)}\n     H ${cell(h?.t)}`);
    if (verbose) out(`     W reply: ${w.t.reply}\n     H reply: ${h?.t?.reply ?? "-"}`);
    if (w.preP !== "combination_choice") out(`   NOTE ${b}: menu pending is ${w.preP}, not combination_choice`);
    if (d !== 4) fail(`C#${b}#days`, `days ${w.t.days}/${w.t.sDays} expected 4 (H ${h?.t?.days ?? "n/a"})`);
    if (picked4) fail(`C#${b}#sel`, `treated as group pick sel=${S(w.t.sel)}`);
    if (!TOKYO_RE.test(w.t.dest ?? "")) fail(`C#${b}#dest`, `dest ${w.t.dest}`);
    reg(`C ${b}`, d, h?.t ? (h.t.days ?? h.t.sDays) : undefined);
  }

  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
