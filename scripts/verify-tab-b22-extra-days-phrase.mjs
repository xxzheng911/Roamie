import "./verify-netguard-full.mjs";
/**
 * T-AB (tester, independent re-check of B22: EXTRA_DAYS_PHRASE_RE in parseDayCountFromText and
 * parseCombinationSelectionIndices). W (working tree) vs H (HEAD via --head-dir). Pure function rows only.
 *  S) parseCombinationSelectionIndices(text, 3)
 *  D) parseDayCountFromText(text) + normalizeDestinationAndDuration(text).tripDays
 *  R) parseCombinationSelectionReply(text, {combinationCount:3}).selectedCombinationIds / continuation
 *  G) isCombinationSelectionGrammar(text, {combinationCount:3})
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-tab-b22-extra-days-phrase.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 250s"); process.exit(3); }, 250_000).unref();
const load = (p) => import(/* @vite-ignore */ `/${p}`);

// [text, expected (JSON) or null = report only]
const SEL = [
  ["1番目でお願いします", "[0]"], ["第1組", "[0]"], ["1、3", "[0,2]"], ["もう1日いたい", "[]"], ["あと2日いたい", "[]"], ["再2天", null],
  ["第2個", "[1]"], ["1和3", "[0,2]"], ["第2組但是想多待一天", "[1]"], ["2番目、もう1日いたい", "[1]"], ["2번, 하루 더", "[1]"],
  ["3일 더 있고 싶어", "[]"], ["第2組再待2天", "[1]"], ["多2天", "[]"], ["差不多2天", null], ["最多2天", null], ["第3組，最多2天", null],
  ["1번이랑 3번", "[0,2]"], ["2", "[1]"], ["第一組和第三組", "[0,2]"], ["1到3", "[0,1,2]"],
];
const DAYS = [
  ["差不多3天", 3], ["最多3天", 3], ["3天多", 3], ["多少天", undefined], ["我想去東京再待2天", "not2"], ["東京3天再大阪2天", null],
  ["あと3日で出発", null], ["頂多3天", 3], ["至多3天", 3], ["不多3天", null],
  // place names containing 多 right before the duration
  ["博多3天", 3], ["我想去博多3天", 3], ["去博多 3 天", 3], ["博多2日間", 2], ["福岡博多3天", 3], ["喜多方3天", 3],
  ["我想去東京3天", 3], ["東京に3日間行きたい", 3], ["도쿄 3일 여행", 3], ["3일 더 있고 싶어 총 5일", 5], ["東京 3 天，多待一天", 3],
];
const REPLY = ["第2個", "1和3", "選 3，再待一天", "全部，多待一天", "もう1日いたい", "第1組", "再2天"];
const FLOW_T = ["我想去博多3天", "博多 3 天", "我想去福岡博多2天", "博多に3日間行きたい", "我想去東京3天", "我想去東京再待2天"];
const GRAMMAR = ["第2個", "1和3", "第2組多待一天", "多一天", "もう1日いたい", "再2天", "1、3"];

async function collect() {
  const R = { sel: {}, days: {}, norm: {}, reply: {}, gram: {}, hasRe: false };
  const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const csr = await load("src/lib/ai/combination-selection-reply.ts");
  const gm = await load("src/lib/ai/place-recommendation-intent/combination.ts");
  R.hasRe = Boolean(dur.EXTRA_DAYS_PHRASE_RE);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undefined" : JSON.stringify(v); } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  for (const [t] of SEL) R.sel[t] = g(() => combo.parseCombinationSelectionIndices(t, 3));
  for (const [t] of DAYS) {
    R.days[t] = g(() => dur.parseDayCountFromText(t));
    R.norm[t] = g(() => dur.normalizeDestinationAndDuration(t.replace(/^(?:我想去|去)/, "")).tripDays);
  }
  for (const t of REPLY) R.reply[t] = g(() => { const r = csr.parseCombinationSelectionReply(t, { combinationCount: 3 }); return { ids: r.selectedCombinationIds, cont: r.isCombinationContinuation }; });
  for (const t of GRAMMAR) R.gram[t] = g(() => gm.isCombinationSelectionGrammar(t, { combinationCount: 3 }));
  // T) chat-path context extraction on an empty session (destination + days)
  const tc = await load("src/lib/ai/travel-context.ts");
  const sess = await load("src/lib/chat-session.ts");
  R.flow = {};
  for (const t of FLOW_T) {
    R.flow[t] = g(() => { const p = tc.parseTravelContextFromText(t, sess.createEmptySession()); const m = tc.mergeTravelContext(sess.createEmptySession(), t).context; return { pDest: p.destination ?? null, pDays: p.days ?? null, mDest: m.destination ?? null, mDays: m.days ?? null }; });
  }
  // guard: the /g regex must not keep lastIndex state between calls
  R.repeat = [1, 2, 3].map(() => g(() => dur.parseDayCountFromText("多待一天，總共4天"))).join(",");
  R.repeatSel = [1, 2, 3].map(() => g(() => combo.parseCombinationSelectionIndices("もう1日いたい、2番", 3))).join(",");
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TAB_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tab-b22-extra-days-phrase.mjs";
    for (const f of [self, "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
    const m = (r.stdout ?? "").match(/@@TAB_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const d = (a, b) => (HR && a !== b ? "  (diff)" : "");
  out(`EXTRA_DAYS_PHRASE_RE exported: W=${W.hasRe} H=${HR?.hasRe ?? "n/a"}`);

  out("\n==== S) parseCombinationSelectionIndices(text, 3) 0-based (text | W | H) ====");
  for (const [t, exp] of SEL) {
    out(`  ${t} | W ${W.sel[t]} | H ${HR?.sel?.[t] ?? "n/a"}${d(W.sel[t], HR?.sel?.[t])}${exp ? ` expect ${exp}` : " (report)"}`);
    if (exp && W.sel[t] !== exp) fail(`S#${t}`, `W ${W.sel[t]} expected ${exp}`);
  }
  out("\n==== D) parseDayCountFromText / normalizeDestinationAndDuration.tripDays (text | W | H) ====");
  for (const [t, exp] of DAYS) {
    out(`  ${t} | W ${W.days[t]} norm=${W.norm[t]} | H ${HR?.days?.[t] ?? "n/a"} norm=${HR?.norm?.[t] ?? "n/a"}${d(W.days[t], HR?.days?.[t])}${exp === null ? " (report)" : ` expect ${exp}`}`);
    if (exp === "not2") { if (W.days[t] === "2") fail(`D#${t}`, `W ${W.days[t]} must not be 2`); }
    else if (exp !== null && W.days[t] !== (exp === undefined ? "undefined" : JSON.stringify(exp))) fail(`D#${t}`, `W ${W.days[t]} expected ${exp}`);
    if (HR && exp !== null && exp !== "not2" && HR.days?.[t] === (exp === undefined ? "undefined" : JSON.stringify(exp)) && W.days[t] !== HR.days[t]) out(`   REGRESSION vs HEAD: ${t} H ${HR.days[t]} -> W ${W.days[t]}`);
  }
  out("\n==== R) parseCombinationSelectionReply(text, {combinationCount:3}) 1-based (text | W | H) ====");
  for (const t of REPLY) out(`  ${t} | W ${W.reply[t]} | H ${HR?.reply?.[t] ?? "n/a"}${d(W.reply[t], HR?.reply?.[t])}`);
  const rx = (t, ids) => { const v = JSON.parse(W.reply[t]); if (JSON.stringify(v.ids) !== ids) fail(`R#${t}`, `W ids ${JSON.stringify(v.ids)} expected ${ids}`); };
  rx("第2個", "[2]"); rx("1和3", "[1,3]"); rx("選 3，再待一天", "[3]"); rx("全部，多待一天", "[1,2,3]"); rx("もう1日いたい", "[]"); rx("第1組", "[1]");
  out("\n==== G) isCombinationSelectionGrammar(text, {combinationCount:3}) (text | W | H) ====");
  for (const t of GRAMMAR) out(`  ${t} | W ${W.gram[t]} | H ${HR?.gram?.[t] ?? "n/a"}${d(W.gram[t], HR?.gram?.[t])}`);
  for (const [t, e] of [["第2個", "true"], ["1和3", "true"], ["第2組多待一天", "true"], ["1、3", "true"], ["もう1日いたい", "false"], ["多一天", "false"]]) {
    if (W.gram[t] !== e) fail(`G#${t}`, `W ${W.gram[t]} expected ${e}`);
  }
  out("\n==== T) parseTravelContextFromText / mergeTravelContext on empty session (text | W | H) ====");
  for (const t of FLOW_T) {
    out(`  ${t} | W ${W.flow?.[t]} | H ${HR?.flow?.[t] ?? "n/a"}${d(W.flow?.[t], HR?.flow?.[t])}`);
    if (/博多/.test(t)) { const v = JSON.parse(W.flow[t]); const want = /2天/.test(t) ? 2 : 3; if (v.mDays !== want) fail(`T#${t}`, `W merged days=${v.mDays} expected ${want}`); }
  }
  out(`\nrepeat (lastIndex state) days: W ${W.repeat} | H ${HR?.repeat ?? "n/a"} ; sel: W ${W.repeatSel} | H ${HR?.repeatSel ?? "n/a"}`);
  if (new Set(W.repeat.split(",")).size !== 1 || W.repeat.split(",")[0] !== "4") fail("repeat#days", W.repeat);
  if (new Set(W.repeatSel.split(",")).size !== 1 || W.repeatSel.split(",")[0] !== "[1]") fail("repeat#sel", W.repeatSel);
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" ; ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
