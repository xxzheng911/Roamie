/**
 * M16 round 3 (tester, independent review): coverage of the "all stages switch city with one rule" change.
 *  a) common four-locale switch phrasings (negated current city + explicit switch, or bare 「X 말고 Y」 forms)
 *     at every stage (choosing / picked / done / failedCatch / refreshPref), known target (Kyoto) and a
 *     geocode-only target (Atami); App turn order via the m16 harness. WORK vs HEAD.
 *  n) English noun-phrase check of negatedCurrentSwitchCandidate: multi-word / lowercase / "the" / "St."
 *     place names after "not Sydney anymore, switch to …" (pure globalPlanningTurn on a picked session).
 *  b) extra misfire corpus (negated current city + activity / generic wording): must equal HEAD.
 * Informational rows are printed as INFO; only (b) regressions vs HEAD and >1 geocode / fetch fail.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-m16r3-switch-coverage.mjs [-- --head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 570_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { storageWrites.push(`remove:${k}`); mem.delete(k); }, clear: () => { storageWrites.push("clear"); mem.clear(); }, key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep existing */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);

const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
if (from < 0 || to < 0) { out("FAIL harness slice not found"); process.exit(2); }
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
  HARNESS_SRC.slice(from, to) +
  "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NAME, generatedDone, failedCatch, refreshPref, pk, setLocale: (l) => { curLocale = l; } };",
)(load, loadOpt, readFileSync, storageWrites);
const gp = await load("src/lib/ai/global-planning-context.ts");
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const sessionMod = await load("src/lib/chat-session.ts");

const STAGES = ["choosing", "picked", "done", "failedCatch", "refreshPref"];
const reach = async (locale) => { H.freshAll(); await H.freshAuthority(); H.setLocale(locale); return (await H.first(H.STEP1[locale](H.NAME[locale].sydney), locale)).s; };
const stageSession = async (locale, stage) => {
  const s = await reach(locale);
  if (stage === "choosing") return s;
  if (stage === "refreshPref") return H.refreshPref(s);
  const picked = (await H.appTurn(s, "1", locale)).s;
  if (stage === "picked") return picked;
  if (stage === "done") return H.generatedDone(picked, "sydney");
  return H.failedCatch(picked, "sydney");
};

// a) positive corpus: [locale, text, target key]
const POS = [
  ["zh-TW", "不去雪梨了，改去京都", "kyoto"], ["zh-TW", "雪梨不要了，換成京都", "kyoto"], ["zh-TW", "雪梨不去了，改去京都", "kyoto"],
  ["zh-TW", "不去雪梨了，改去熱海", "atami"], ["zh-TW", "雪梨不要了，換成熱海", "atami"], ["zh-TW", "雪梨不去了，我要去京都", "kyoto"],
  ["en", "forget Sydney, let's go to Kyoto", "kyoto"], ["en", "no Sydney, Kyoto instead", "kyoto"], ["en", "forget Sydney, Kyoto", "kyoto"],
  ["en", "forget Sydney, let's go to Atami", "atami"], ["en", "no Sydney, Atami instead", "atami"], ["en", "forget Sydney, Atami", "atami"],
  ["en", "not Sydney anymore, switch to Atami", "atami"], ["en", "Kyoto instead of Sydney", "kyoto"],
  ["ja", "シドニーはやめて京都にする", "kyoto"], ["ja", "シドニーじゃなくて京都", "kyoto"], ["ja", "シドニーはやめて熱海にする", "atami"], ["ja", "シドニーじゃなくて熱海", "atami"],
  ["ja", "シドニーはやめて、熱海に変更", "atami"],
  ["ko", "시드니 말고 교토", "kyoto"], ["ko", "시드니 대신 교토로", "kyoto"], ["ko", "시드니 말고 아타미", "atami"], ["ko", "시드니 대신 아타미로", "atami"],
  ["ko", "시드니 말고 아타미로 바꿔", "atami"],
  // zh negation-form variants (「不要了」「算了」「我不要X了」) with a geocode-only target.
  ["zh-TW", "雪梨不要了，改去熱海", "atami"], ["zh-TW", "雪梨不要了，換成別府", "beppu"], ["zh-TW", "不要雪梨了，換成熱海", "atami"],
  ["zh-TW", "我不要雪梨了，改去熱海", "atami"], ["zh-TW", "雪梨算了，改去熱海", "atami"], ["zh-TW", "雪梨不想去了，改去熱海", "atami"],
];
// b) extra misfires (not in verify-m17-*): [locale, text]
const MIS = [
  ["zh-TW", "雪梨不去了，改天再說"], ["zh-TW", "不去雪梨了，改成自由行"], ["zh-TW", "雪梨不要了，換成五天"], ["zh-TW", "雪梨不去了，換成住飯店"],
  ["zh-TW", "雪梨不去了，我要去看醫生"], ["zh-TW", "雪梨不去了，我要去睡覺"], ["zh-TW", "不去雪梨了，我想去喝咖啡"],
  ["en", "forget Sydney, let's go hiking"], ["en", "no Sydney, beaches instead"], ["en", "forget Sydney, I'm going to bed"], ["en", "not Sydney anymore, let's go to the zoo"],
  ["en", "forget Sydney, switch to a cheaper hotel"], ["en", "skip Sydney, let's go somewhere warm"], ["en", "switch to a cheaper hotel"],
  ["ja", "シドニーはやめて温泉にする"], ["ja", "シドニーじゃなくて、のんびりしたい"], ["ja", "シドニーはやめて、ホテルに変更"],
  ["ko", "시드니 말고 바다로 갈래"], ["ko", "시드니 말고 다른 데"], ["ko", "시드니 대신 쇼핑으로 바꿔"],
];
// n) en noun-phrase names after "not Sydney anymore, switch to …" (pure, picked session)
const NAMES = ["New York", "new york", "Gold Coast", "the Gold Coast", "St. Petersburg", "St Ives", "Hot Springs", "Reading", "reading", "beijing", "Beijing",
  "kunming", "Kunming", "Toronto", "Santo Domingo", "Isle of Skye", "Lake Tahoe", "Ho Chi Minh City", "Washington", "To Lich", "Go Cong", "Wyoming", "wyoming", "Hong Kong", "San Sebastián"];
const pureSession = () => {
  const base = sessionMod.createEmptySession();
  const ctx = { interests: [], destination: "雪梨", destinationCountry: "澳洲", destinationType: "city", destinationInputNames: ["Sydney"],
    startDate: "2026-12-10", endDate: "2026-12-14", days: 5, dateProvenance: { source: "user_date", confirmed: true, startDate: "2026-12-10", endDate: "2026-12-14" },
    tripPurpose: "combination_suggestions_offered", offeredCombinations: [{ id: "combo_1", places: ["A", "B"] }], selectedCombinationIds: ["combo_1"] };
  return { ...base, travelContext: ctx, tripDestination: { city: "雪梨", displayLabel: "雪梨", country: "澳洲" }, phase: "recommend", planningSessionId: "ps_1", planVersion: 1 };
};
const sum = (c) => c ? { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}${c.destinationCandidate.combinationSwitch ? "/sw" : ""}` : null, start: c.startDate ?? null } : null;

const RES = { a: {}, b: {}, n: {} };
for (const [locale, t, key] of POS) for (const stage of STAGES) {
  const r = await H.appTurn(await stageSession(locale, stage), t, locale);
  RES.a[`${locale}|${stage}|${t}`] = { t, key, row: H.pk(r.row) };
}
for (const [locale, t] of MIS) for (const stage of STAGES) {
  const r = await H.appTurn(await stageSession(locale, stage), t, locale);
  RES.b[`${locale}|${stage}|${t}`] = { t, row: H.pk(r.row) };
}
for (const name of NAMES) for (const t of [`not Sydney anymore, switch to ${name}`, `forget Sydney, let's go to ${name}`]) {
  let r; try { r = sum(gp.globalPlanningTurn(pureSession(), t)); } catch (e) { r = `THROW ${String(e?.message ?? e).slice(0, 80)}`; }
  RES.n[t] = { cls: tpc.classifyDestinationSwitchTurn(t).state, target: tpc.classifyDestinationSwitchTurn(t).targetLabel ?? null, ctx: r };
}

if (CHILD) {
  process.stdout.write(`@@M16R3_JSON@@${JSON.stringify({ RES, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m16r3-switch-coverage.mjs";
  const harness = "scripts/verify-m16-post-selection-switch-review.mjs";
  for (const f of [self, harness]) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 540_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M16R3_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).RES : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

const failures = [];
const j = (v) => JSON.stringify(v);
const brief = (x) => x ? `${x.cls}/${x.branch} dest=${x.dest} cand=${x.cand ?? "-"} pend=${x.pending ?? "-"} off=${x.offered} first=${x.first || "-"} start=${x.start} prov=${x.prov} sid=${x.sidChanged} geo=${x.geoQ.length}${x.geoQ.length ? `[${x.geoQ.join(",")}]` : ""} | ${(x.reply ?? "").slice(0, 90)}` : "-";
const isSydney = (d) => /sydney|雪梨|シドニー|시드니/i.test(d ?? "");
const TARGET = { kyoto: /kyoto|京都|교토/i, atami: /atami|熱海|아타미/i, beppu: /beppu|別府|벳푸/i };
for (const [k, w] of Object.entries(RES.a)) {
  const x = w.row; const h = HEAD?.a?.[k]?.row;
  const switched = TARGET[w.key].test(x.dest ?? "") && x.offered > 0 && x.start === "2026-12-10";
  const asked = !switched && isSydney(x.dest);
  if (x.geoQ.length > 1) { failures.push(`a|${k}`); out(`FAIL a|${k}: geocode ${x.geoQ.length} > 1\n   W ${brief(x)}`); continue; }
  // Once the destination leaves Sydney it must be a clean switch (combinations re-listed, dates kept, no
  // last-resort / desync). A broken result identical to HEAD (same destination label) is HEAD-existing (KNOWN).
  const moved = !isSydney(x.dest);
  const clean = switched && x.pending === "combination_choice" && !/LAST-RESORT|desync/i.test(x.branch);
  if (moved && !clean) {
    if (h && h.dest === x.dest && h.branch === x.branch) { out(`KNOWN  a|${k}: HEAD-existing broken destination\n   W ${brief(x)}\n   H ${brief(h)}`); continue; }
    failures.push(`a|${k}`);
    out(`FAIL a|${k}: destination left Sydney without a clean switch (no combinations / last-resort / desync)\n   W ${brief(x)}${h ? `\n   H ${brief(h)}` : ""}`);
    continue;
  }
  out(`${switched ? "SWITCH" : asked ? "KEEP  " : "OTHER "} a|${k}\n   W ${brief(x)}${h ? `\n   H ${brief(h)}` : ""}`);
}
for (const [k, w] of Object.entries(RES.b)) {
  const x = w.row; const h = HEAD?.b?.[k]?.row;
  const issues = [];
  if (!isSydney(x.dest) && !(h && x.dest === h.dest)) issues.push("destination changed");
  if (h && x.geoQ.length > h.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.geoQ.length}`);
  // M16 round 4 (tester review, accepted improvement): "switch to a cheaper hotel" (no negation) was geocoded
  // at HEAD as the candidate "a cheaper hotel" (confirm-city question, trip left without combinations). WORK
  // creates no candidate, 0 geocode, Sydney kept. Because HEAD returned early on candidate advice, WORK now
  // reaches the done-stage phase_done session reset that every other sentence gets there (e.g. 「今天天氣如何」,
  // verify-m18-nonplace-guard-review); only that reset at done is accepted, nothing else.
  const genericCandidateDropped = Boolean(h) && x.cand == null && /^a cheaper hotel\/unresolved$/.test(h.cand ?? "") && x.geoQ.length === 0 && isSydney(x.dest);
  const atDone = k.split("|")[1] === "done";
  if (h && x.sidChanged !== h.sidChanged && x.sidChanged && !(genericCandidateDropped && atDone)) issues.push(`session reset WORK=${x.sidChanged} HEAD=${h.sidChanged}`);
  if (h && (x.cand ?? null) !== (h.cand ?? null) && !genericCandidateDropped) issues.push(`cand WORK=${x.cand} HEAD=${h.cand}`);
  if (issues.length) { failures.push(`b|${k}`); out(`FAIL b|${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h)}` : ""}`); }
  else out(`PASS b|${k}\n   W ${brief(x)}${h && j(h) !== j(x) ? `\n   H ${brief(h)}` : ""}`);
}
for (const [k, w] of Object.entries(RES.n)) {
  const h = HEAD?.n?.[k];
  out(`INFO n|${k} cls=${w.cls}/${w.target} W=${j(w.ctx)}${h ? ` H=${h.cls}/${h.target} ${j(h.ctx)}` : ""}`);
}
if (fetchCalls) { failures.push("fetch"); out(`FAIL no network fetch=${fetchCalls}`); }
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
