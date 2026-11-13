import "./verify-netguard-full.mjs";
/**
 * T-Y (tester, independent review of B16: 「第2組」 on the combination menu is not "missing candidate context").
 * W (working tree) vs H (HEAD via --head-dir). Harness: App-order turn of verify-m16-post-selection-switch-review.mjs,
 * but the m16 routing block (shownCandidates: [] + req.requiresCandidateContext) is replaced by:
 *   - shownCandidates = resolvePlanningCandidateContext(nextSession, rendered) (as _app.chat.tsx ~11868)
 *   - the REAL _app.chat.tsx text from `parseStage = "apply_delta";` up to the end of the
 *     `unresolvedPlanningCandidateContext = …;` statement, extracted from the tree under test and executed
 *     with (contextRequirement, shownCandidates, sessionForTurn, nextSession, isCombinationChoiceTurn).
 * Scenarios:
 *  a) combination_choice (Tokyo 3 days) → 「第2組」 (zh-TW, ja): no clarification, advice, locked combo 2.
 *  b) combination_choice → 「那組」「這組」: actual advice behaviour.
 *  c) no combination_choice, no cards → 「第2組」 (empty session; ask_days pending): clarification as before.
 *  d) recommendation cards (recommendedPlaces) present → 「第2組」 (with / without combination_choice): W == H.
 *  e) destination change in the same turn (new session, offeredCombinations empty) → clarification.
 *  u) predicate unit rows on synthetic inputs (exact extracted text).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-ty-b16-group-pick-route.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 370s"); process.exit(3); }, 370_000).unref();

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
const GO = { "zh-TW": (c) => `我要去${c}`, ja: (c) => `${c}へ旅行` };
const DAYS = { "zh-TW": (d) => `${d}天`, ja: (d) => `${d}日間` };
const TOKYO = { "zh-TW": "東京", ja: "東京" };

/** Extract the real routing statement from _app.chat.tsx (the tree under test). */
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
  const R = { rows: {}, unit: {} };
  const sessionMod = await load("src/lib/chat-session.ts");
  const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const route = extractRoute();
  R.code = route.code ?? route.err;
  R.hasIsCombinationChoiceTurn = Boolean(partialApi?.isCombinationChoiceTurn);
  if (!route.fn) return R;
  const isCCT = partialApi?.isCombinationChoiceTurn ?? ((s) => s?.pendingQuestion?.type === "combination_choice");
  const log = [];
  globalThis.__B16 = (req, shown, base, n) => {
    const v = route.fn(req, shown, base, n, isCCT);
    log.push({ reason: req.reason, requires: req.requiresCandidateContext, shown: shown.length, baseCombo: isCCT(base), offered: (n.travelContext?.offeredCombinations ?? []).length, unresolved: v });
    return v;
  };
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const rs = slice.indexOf("  let delta = constraints.parsePlanningConstraintDelta(");
  const reEnd = "  n = constraints.applyPlanningConstraintDelta(n, delta, []);";
  const re = slice.indexOf(reEnd);
  if (rs < 0 || re < 0) { R.code = `HARNESS anchors missing rs=${rs} re=${re}`; return R; }
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
    slice + "\nreturn { appTurn, freshAll, freshAuthority, fakePlaces: (k) => fakePlaces(k), setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const offeredIds = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => c.id);
  const reset = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const toCombos = async (chat) => {
    setNav(chat); await reset(chat);
    const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[chat](TOKYO[chat]), chat);
    const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[chat](3), chat);
    return { s: { ...a2.s, lastAssistantReply: a2.s?.lastAssistantReply ?? (a2.row?.reply ?? "").replace(/ \/ /g, "\n") }, a1 };
  };
  const rowOf = (pre, a) => {
    const tc = a.s?.travelContext ?? {};
    const shownIds = offeredIds(pre);
    return { preP: pre.pendingQuestion?.type ?? null, preOffered: shownIds, preRec: (pre.recommendedPlaces ?? []).length,
      branch: a.row?.branch ?? null, p: a.s?.pendingQuestion?.type ?? null, sel: tc.selectedCombinationIds ?? [],
      selIdx: (tc.selectedCombinationIds ?? []).map((id) => shownIds.indexOf(id) + 1), dest: tc.destination ?? null, offeredAfter: offeredIds(a.s).length,
      sidChanged: a.s?.planningSessionId !== pre.planningSessionId, route: log.at(-1) ?? null,
      reply: (a.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 220) };
  };
  const run = async (key, pre, t, chat) => {
    const n0 = log.length;
    try { const a = await H.appTurn(structuredClone(pre), t, chat); R.rows[key] = { ...rowOf(pre, a), routeCalls: log.length - n0, routeLast: log.length > n0 ? log.at(-1) : null }; }
    catch (e) { R.rows[key] = { err: String(e?.message ?? e).slice(0, 140) }; }
  };
  // a) / b)
  for (const chat of ["zh-TW", "ja"]) {
    for (const w of ["第2組", "那組", "這組"]) { const { s } = await toCombos(chat); await run(`${w.startsWith("第") ? "a" : "b"}|${chat}|${w}`, s, w, chat); }
  }
  // c) no combination_choice, no cards
  setNav("zh-TW"); await reset("zh-TW");
  await run("c|empty|第2組", sessionMod.createEmptySession(), "第2組", "zh-TW");
  { setNav("zh-TW"); await reset("zh-TW"); const a1 = await H.appTurn(sessionMod.createEmptySession(), "我要去東京", "zh-TW");
    await run("c|ask_days|第2組", { ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, "第2組", "zh-TW"); }
  { const { s } = await toCombos("zh-TW");
    // combination_choice answered earlier: pending cleared, offered still present (stale menu)
    await run("c|offered-no-pending|第2組", { ...s, pendingQuestion: undefined }, "第2組", "zh-TW"); }
  // d) recommendation cards
  { const { s } = await toCombos("zh-TW"); const cards = H.fakePlaces("tokyo");
    await run("d|cards+combo|第2組", { ...s, recommendedPlaces: cards }, "第2組", "zh-TW");
    await run("d|cards-only|第2組", { ...s, pendingQuestion: undefined, recommendedPlaces: cards, travelContext: { ...s.travelContext, offeredCombinations: undefined } }, "第2組", "zh-TW");
    await run("d|cards+combo|那組", { ...s, recommendedPlaces: cards }, "那組", "zh-TW"); }
  // a0 / b0 / c0) same states with activeShownCandidates cleared (shownCandidates = 0: the only state where B16 can matter)
  const noShown = (s) => ({ ...s, activeShownCandidates: undefined, recommendedPlaces: [] });
  for (const chat of ["zh-TW", "ja"]) {
    for (const w of ["第2組", "那組", "這組"]) { const { s } = await toCombos(chat); await run(`${w.startsWith("第") ? "a0" : "b0"}|${chat}|${w}`, noShown(s), w, chat); }
  }
  { const { s } = await toCombos("zh-TW"); await run("c0|offered-no-pending|第2組", noShown({ ...s, pendingQuestion: undefined }), "第2組", "zh-TW"); }
  // e) destination change in the same turn (with and without shown candidates)
  for (const t of ["我要去京都 第2組", "改去京都，第2組", "京都3天 第2組"]) {
    { const { s } = await toCombos("zh-TW"); await run(`e|${t}`, s, t, "zh-TW"); }
    { const { s } = await toCombos("zh-TW"); await run(`e0|${t}`, noShown(s), t, "zh-TW"); }
  }
  // x) extra: trip length next to a group pick
  for (const t of ["第2組 3天", "3天 第2組", "第2組，4天"]) { const { s } = await toCombos("zh-TW"); await run(`x|${t}`, s, t, "zh-TW"); }
  // u) predicate unit rows on synthetic inputs
  const combo = { pendingQuestion: { type: "combination_choice", options: ["a", "b"] }, travelContext: { offeredCombinations: [{ id: "c1" }, { id: "c2" }] } };
  const none = { pendingQuestion: undefined, travelContext: {} };
  const U = {
    "group+combo+offered+0shown": [{ reason: "group_reference", requiresCandidateContext: true }, [], combo, combo],
    "group+combo+offeredEmptyInNext": [{ reason: "group_reference", requiresCandidateContext: true }, [], combo, { travelContext: { offeredCombinations: [] } }],
    "group+noCombo+offered": [{ reason: "group_reference", requiresCandidateContext: true }, [], none, combo],
    "ordinal+combo+offered": [{ reason: "ordinal", requiresCandidateContext: true }, [], combo, combo],
    "previous+combo+offered": [{ reason: "previous_reference", requiresCandidateContext: true }, [], combo, combo],
    "group+combo+1shown": [{ reason: "group_reference", requiresCandidateContext: true }, [{ name: "x" }], combo, combo],
  };
  for (const [k, args] of Object.entries(U)) { try { R.unit[k] = route.fn(args[0], args[1], args[2], args[3], isCCT); } catch (e) { R.unit[k] = `THROW ${e?.message}`; } }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TYB16_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-ty-b16-group-pick-route.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TYB16_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  out(`==== extracted routing code (W) ====\n${W.code}\n==== extracted routing code (H) ====\n${HR?.code ?? "n/a"}`);
  out(`isCombinationChoiceTurn exported: W=${W.hasIsCombinationChoiceTurn} H=${HR?.hasIsCombinationChoiceTurn ?? "n/a"}`);
  const fa = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err}` : `[${x.branch}] p=${x.p ?? "-"} sel=${S(x.selIdx)} dest=${x.dest ?? "-"} offeredAfter=${x.offeredAfter} sid${x.sidChanged ? "+" : "="} route=${x.routeLast ? `${x.routeLast.reason}/shown${x.routeLast.shown}/baseCombo=${x.routeLast.baseCombo}/offered${x.routeLast.offered}/unres=${x.routeLast.unresolved}` : "not-reached"}`);
  out("\n==== rows (W | H) ====");
  for (const k of Object.keys(W.rows)) {
    const w = W.rows[k]; const h = HR?.rows?.[k];
    if (!argv.includes("--brief")) out(`${k}  (pre p=${w.preP ?? "-"} offered=${w.preOffered?.length ?? "-"} rec=${w.preRec ?? "-"})\n   W ${fa(w)}\n     reply: ${w.reply ?? "-"}\n   H ${fa(h)}\n     reply: ${h?.reply ?? "-"}`);
    const [sec] = k.split("|");
    const clar = (x) => x?.branch === "missing candidate context clarification";
    if (w.err) { fail(`${k}#err`, w.err); continue; }
    if (sec === "a" || sec === "a0") {
      if (clar(w)) fail(`${k}#route`, "W still asks missing candidate context");
      if (S(w.selIdx) !== "[2]") fail(`${k}#sel`, `W selected ${S(w.selIdx)} (expected [2])`);
      if (!/advice/.test(w.branch ?? "")) fail(`${k}#advice`, `W branch ${w.branch}`);
    }
    if ((sec === "c" || sec === "c0") && (w.routeLast?.shown ?? 0) === 0 && !clar(w)) fail(`${k}#clarify`, `W no longer asks: ${w.branch}`);
    if ((sec === "c" || sec === "c0") && h && clar(h) !== clar(w)) fail(`${k}#vsHEAD`, `W ${w.branch} | H ${h.branch}`);
    if (sec === "x" && S(w.selIdx) !== "[2]") fail(`${k}#sel`, `W selected ${S(w.selIdx)} (expected [2]; trip length is not a group number)`);
    if (sec === "e0" && w.routeLast && w.routeLast.offered === 0 && !clar(w)) fail(`${k}#clarify`, `offered empty, no shown, but W did not ask: ${w.branch}`);
    if (sec === "d" && h) {
      const pick = (x) => S({ branch: x.branch, p: x.p, sel: x.selIdx, dest: x.dest, offeredAfter: x.offeredAfter, reply: x.reply });
      if (w.branch !== h.branch) fail(`${k}#vsHEAD`, `branch W ${w.branch} | H ${h.branch}`);
      else if (pick(w) !== pick(h)) out(`   NOTE ${k}: same branch, other fields differ (W ${pick(w)} | H ${pick(h)})`);
    }
    if (sec === "e" && h && w.branch !== h.branch) out(`   NOTE ${k}: branch differs W ${w.branch} | H ${h.branch}`);
    if ((sec === "e" || sec === "e0") && /京都/.test(k) && w.dest && !/京都|Kyoto/.test(w.dest) && (w.selIdx?.length ?? 0) > 0) out(`   NOTE ${k}: user named 京都 but W locked ${S(w.selIdx)} of ${w.dest}`);
  }
  out("\n==== SUMMARY TABLE (key | W branch p sel dest shown/offered | H …) ====");
  const ab = (b) => (b ?? "-").replace("missing candidate context clarification", "CLARIFY").replace("planning advice", "ADVICE").replace(" date/duration question", " ask_days");
  const cell = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err.slice(0, 60)}` : `${ab(x.branch)} p=${x.p ?? "-"} sel=${S(x.selIdx)} dest=${x.dest ?? "-"} sh${x.routeLast?.shown ?? "?"}/of${x.routeLast?.offered ?? "?"}`);
  for (const k of Object.keys(W.rows)) out(`  ${k} | W ${cell(W.rows[k])} | H ${cell(HR?.rows?.[k])}`);
  out("\n==== reply heads for b / b0 (W | H) ====");
  for (const k of Object.keys(W.rows).filter((k) => /^b0?\|/.test(k))) out(`  ${k} | W ${(W.rows[k].reply ?? "").slice(0, 70)} | H ${(HR?.rows?.[k]?.reply ?? "").slice(0, 70)}`);
  out("\n==== predicate unit rows (W | H) ====");
  for (const k of Object.keys(W.unit)) out(`  ${k}: W unresolved=${W.unit[k]} | H unresolved=${HR?.unit?.[k] ?? "n/a"}`);
  if (W.unit["group+combo+offered+0shown"] !== false) fail("u#exempt", "exemption not applied");
  for (const k of ["group+combo+offeredEmptyInNext", "group+noCombo+offered", "ordinal+combo+offered", "previous+combo+offered"]) if (W.unit[k] !== true) fail(`u#${k}`, "should still require context");
  if (W.unit["group+combo+1shown"] !== false) fail("u#shown", "shown cards should never be unresolved");
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
