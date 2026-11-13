import "./verify-netguard-full.mjs";
/**
 * T-Z (tester, independent review of B17: shownCombinationPickText on colloquial group picks).
 * W (working tree) vs H (HEAD via --head-dir). Harness = verify-ty-b16-group-pick-route.mjs (App-order turn from
 * verify-m16-post-selection-switch-review.mjs with the real _app.chat.tsx candidate-context routing statement).
 * Menu: 東京 3 days → combination_choice (built in the sentence's locale; non-zh sentences also on the zh-TW menu).
 * Per sentence: sel (positions in the shown list), branch, pending, dest, sid change, switch classification,
 * and "dest-switch misjudged" (= dest no longer 東京 / sid changed / CONFIRMED_SWITCH / candidate / k2 / p1 / E1 branch).
 * u) shownCombinationPickText(text, "東京") unit rows (W; H = n/a when not exported).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-tz-b17-colloquial-pick.mjs -- --head-dir=<snapshot>
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
const GO = { "zh-TW": "我要去東京", ja: "東京へ旅行", en: "I'm going to Tokyo", ko: "도쿄 여행" };
const DAYS = { "zh-TW": "3天", ja: "3日間", en: "3 days", ko: "3일" };

// [text, locale, expected sel (null = report only)]
const SENT = [
  ["那就第2組吧", "zh-TW", "[2]"],
  ["我選第2組好了", "zh-TW", "[2]"],
  ["第2組看起來不錯", "zh-TW", "[2]"],
  ["第2組，謝謝", "zh-TW", "[2]"],
  ["2번으로 할게요", "ko", "[2]"],
  ["2番目でお願いします", "ja", "[2]"],
  ["Let's go with option 2", "en", "[2]"],
  ["第1組跟第3組都要", "zh-TW", "[1,3]"],
  ["第2組但是想多待一天", "zh-TW", null],
  ["全部都要", "zh-TW", "[1,2,3]"],
  // d25 x follow-up: all + nearby extension (鎌倉 is a day trip from 東京, not a destination change); ja@node = no navigator
  ["全部，也想去鎌倉", "ja", "[1,2,3]", ["ja", "ja@node", "zh-TW"]],
  ["全部、鎌倉も行きたい", "ja", "[1,2,3]", ["ja", "ja@node", "zh-TW"]],
];
const menusOf = (loc, menus) => menus ?? (loc === "zh-TW" ? ["zh-TW"] : [loc, "zh-TW"]);

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
  const R = { rows: {}, unit: {}, menus: {} };
  const sessionMod = await load("src/lib/chat-session.ts");
  const partialApi = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const pq = await load("src/lib/ai/destination-pending-question.ts");
  const tpcU = await load("src/lib/ai/trip-planning-context.ts");
  const route = extractRoute();
  if (!route.fn) { R.err = route.err; return R; }
  const isCCT = partialApi?.isCombinationChoiceTurn ?? ((s) => s?.pendingQuestion?.type === "combination_choice");
  const log = [];
  globalThis.__B16 = (req, shown, base, n) => {
    const v = route.fn(req, shown, base, n, isCCT);
    log.push({ reason: req.reason, shown: shown.length, offered: (n.travelContext?.offeredCombinations ?? []).length, unresolved: v });
    return v;
  };
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const rs = slice.indexOf("  let delta = constraints.parsePlanningConstraintDelta(");
  const reEnd = "  n = constraints.applyPlanningConstraintDelta(n, delta, []);";
  const re = slice.indexOf(reEnd);
  if (rs < 0 || re < 0) { R.err = `HARNESS anchors missing rs=${rs} re=${re}`; return R; }
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
  const toCombos = async (spec) => {
    const chat = spec.split("@")[0];
    setNav(spec.endsWith("@node") ? null : chat); H.freshAll(); await H.freshAuthority(); H.setLocale(chat);
    const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[chat], chat);
    const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[chat], chat);
    return { ...a2.s, lastAssistantReply: a2.s?.lastAssistantReply ?? (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
  };
  const TOKYO_RE = /^(?:東京|東京都|Tokyo|도쿄)$/i;
  for (const [t, loc, , m] of SENT) {
    for (const spec of menusOf(loc, m)) {
      const key = `${spec}|${t}`;
      try {
        const pre = await toCombos(spec);
        const shownIds = offeredIds(pre);
        R.menus[spec] = { p: pre.pendingQuestion?.type ?? null, offered: shownIds.length, dest: pre.travelContext?.destination ?? null };
        const n0 = log.length;
        const a = await H.appTurn(structuredClone(pre), t, spec.split("@")[0]);
        const tc = a.s?.travelContext ?? {};
        const destNow = tc.destination ?? null;
        const switched = (destNow != null && !TOKYO_RE.test(tpcU.normalizeDestinationLabel(destNow)))
          || a.s?.planningSessionId !== pre.planningSessionId || a.row?.cls === "CONFIRMED_SWITCH"
          || /candidate advice|k2_|p1 stop|E1 ask|wrapper_|^B /.test(a.row?.branch ?? "");
        R.rows[key] = { preP: pre.pendingQuestion?.type ?? null, preOffered: shownIds.length, branch: a.row?.branch ?? null, cls: a.row?.cls ?? null,
          p: a.s?.pendingQuestion?.type ?? null, selIdx: (tc.selectedCombinationIds ?? []).map((id) => shownIds.indexOf(id) + 1), dest: destNow,
          days: tc.days ?? a.s?.tripDays ?? null, sidChanged: a.s?.planningSessionId !== pre.planningSessionId, switched,
          route: log.length > n0 ? log.at(-1) : null, reply: (a.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 160) };
      } catch (e) { R.rows[key] = { err: String(e?.message ?? e).slice(0, 160) }; }
    }
  }
  for (const [t] of SENT) {
    try { R.unit[t] = pq.shownCombinationPickText ? pq.shownCombinationPickText(t, "東京") : "n/a(not exported)"; }
    catch (e) { R.unit[t] = `THROW ${String(e?.message ?? e).slice(0, 80)}`; }
  }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TZB17_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tz-b17-colloquial-pick.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 260_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TZB17_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  if (W.err) fail("harness", W.err);
  out(`menus W=${S(W.menus)}\nmenus H=${S(HR?.menus ?? null)}`);
  const ab = (b) => (b ?? "-").replace("missing candidate context clarification", "CLARIFY").replace("planning advice", "ADVICE").replace(" date/duration question", " ask_days");
  const cell = (x) => (!x ? "n/a" : x.err ? `ERR ${x.err.slice(0, 80)}` : `${ab(x.branch)} p=${x.p ?? "-"} sel=${S(x.selIdx)} dest=${x.dest ?? "-"} days=${x.days ?? "-"} sid${x.sidChanged ? "+" : "="} cls=${x.cls ?? "-"} switch=${x.switched ? "YES" : "no"}`);
  out("\n==== SUMMARY TABLE (menu|text | W | H) ====");
  for (const [t, loc, exp, m] of SENT) {
    for (const spec of menusOf(loc, m)) {
      const chat = spec.split("@")[0];
      const k = `${spec}|${t}`; const w = W.rows[k]; const h = HR?.rows?.[k];
      out(`  ${k} (expect ${exp ?? "report"}) | W ${cell(w)} | H ${cell(h)}`);
      if (!argv.includes("--brief")) out(`     W reply: ${w?.reply ?? "-"}\n     H reply: ${h?.reply ?? "-"}`);
      if (!w || w.err) { fail(`${k}#err`, w?.err ?? "no row"); continue; }
      if (w.preOffered !== 3) out(`   NOTE ${k}: menu offered ${w.preOffered} (expected 3)`);
      if (w.switched) fail(`${k}#switch`, `no other city named but W treated as destination change: ${cell(w)}`);
      if (chat === loc && exp && S(w.selIdx) !== exp) {
        const tag = h && S(h.selIdx) === exp ? "NEW vs HEAD" : "HEAD also";
        fail(`${k}#sel`, `W sel ${S(w.selIdx)} expected ${exp} (${tag}; H sel ${S(h?.selIdx ?? null)})`);
      }
      if (h && S(w.selIdx) !== S(h.selIdx)) out(`   NOTE ${k}: sel differs W ${S(w.selIdx)} | H ${S(h.selIdx)}`);
    }
  }
  out("\n==== shownCombinationPickText(text, 東京) (W | H) ====");
  for (const [t] of SENT) out(`  ${t}: W ${S(W.unit[t])} | H ${S(HR?.unit?.[t] ?? "n/a")}`);
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
