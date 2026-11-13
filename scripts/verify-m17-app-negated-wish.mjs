import "./verify-netguard-full.mjs";
/**
 * M17 (tester): App-order turn for negated-current + wish/activity wording, WORK vs HEAD.
 * Reuses the App-order harness of verify-m16-post-selection-switch-review.mjs (its source slice from the
 * module loads to the scenarios section is evaluated with this module's vite-node `load`), so the turn order
 * is exactly the m16/m15 one (A2 classification → confirmed wrapper / NO_SWITCH merge chain).
 * Misfire = a sentence that names an activity / category / generic wording after rejecting the current city.
 * A misfire must not switch destination, must not reset the session, and must not cost more geocode than HEAD.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=580 scripts/verify-m17-app-negated-wish.mjs [-- --head-dir=<snapshot>]
 */
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 560_000).unref();
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
  "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, SWITCH, NAME, generatedDone, failedCatch, refreshPref, pk, setLocale: (l) => { curLocale = l; } };",
)(load, loadOpt, readFileSync, storageWrites);

const LOCALES = ["zh-TW", "en", "ja", "ko"];
const ZH = ["雪梨不去了，我想去衝浪", "雪梨不去了，我要去休息", "雪梨不去了，我要去機場", "雪梨不去了，我想去市區", "雪梨不去了，我想去露營",
  "雪梨不去了，我要去吃拉麵", "雪梨不去了，我想去別的城市", "雪梨不去了，我想去其他地方", "雪梨不去了，我要去購物", "雪梨不去了，我要去海邊", "雪梨不去了，我想去看夜景",
  "不去博物館了，我要去逛街", "今天不去了，我要去休息"];
const LOC = {
  en: ["not Sydney anymore, I want to go surfing", "not Sydney anymore, I want to rest", "rather than Sydney, I want to go to a museum", "not Sydney anymore, I want to go to the beach"],
  ja: ["シドニーはやめて、サーフィンに行きたい", "シドニーじゃなくて海に行きたい", "シドニーはやめて、買い物に行きたい"],
  ko: ["시드니 말고 서핑하러 가고 싶어", "시드니 말고 쉬고 싶어", "시드니 말고 쇼핑하러 갈래"],
};
const POS = ["雪梨不去了，我要去熱海", "雪梨不去了，我要去京都"];
const STAGES = ["choosing", "picked", "done", "failedCatch"];

const reach = async (locale) => { H.freshAll(); await H.freshAuthority(); H.setLocale(locale); return (await H.first(H.STEP1[locale](H.NAME[locale].sydney), locale)).s; };
const stageSession = async (locale, stage) => {
  const s = await reach(locale);
  if (stage === "choosing") return s;
  const picked = (await H.appTurn(s, "1", locale)).s;
  if (stage === "picked") return picked;
  if (stage === "done") return H.generatedDone(picked, "sydney");
  return H.failedCatch(picked, "sydney");
};

const RES = {};
for (const locale of LOCALES) {
  const texts = [...(locale === "zh-TW" || locale === "en" ? ZH : []), ...(LOC[locale] ?? []), ...(locale === "zh-TW" ? POS : [])];
  for (const stage of STAGES) for (const t of texts) {
    const s = await stageSession(locale, stage);
    const r = await H.appTurn(s, t, locale);
    RES[`${locale}|${stage}|${t}`] = { t, pos: POS.includes(t), row: H.pk(r.row) };
  }
}

if (CHILD) {
  process.stdout.write(`@@M17A_JSON@@${JSON.stringify({ RES, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m17-app-negated-wish.mjs";
  const harness = "scripts/verify-m16-post-selection-switch-review.mjs";
  for (const f of [self, harness]) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 520_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M17A_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).RES : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

const failures = [];
const brief = (x) => x ? `${x.cls}/${x.branch} dest=${x.dest} cand=${x.cand ?? "-"} pend=${x.pending ?? "-"} off=${x.offered} sid=${x.sidChanged} geo=${x.geoQ.length}${x.geoQ.length ? `[${x.geoQ.join(",")}]` : ""} | ${(x.reply ?? "").slice(0, 70)}` : "-";
const isSydney = (d) => /sydney|雪梨|シドニー|시드니/i.test(d ?? "");
// M16 round 3 (assigner rulings):
//  - 「雪梨不去了，我要去熱海」: 熱海 is outside the local city table → HEAD's confirmation question (E1, 0 geocode) is
//    the accepted outcome; a direct switch is not required.
//  - 「不去博物館了，我要去逛街」: WORK keeps 雪梨 without a reset where HEAD made 「博物館了我要去」 the destination
//    (accepted improvement): 雪梨 kept, geocode ≤ HEAD, no reset HEAD did not do; the branch may differ.
//  - 「今天不去了，我要去休息」: HEAD already sets 「休息」 as the destination at picked / done / failed; recorded as a
//    HEAD-existing issue: WORK must equal HEAD (destination, reset, branch, geocode), never be worse.
const RULING_CONFIRM = new Set(["雪梨不去了，我要去熱海"]);
const RULING_IMPROVEMENT = new Set(["不去博物館了，我要去逛街"]);
// M16 round 4 (user-approved requirement 5): 「今天不去了，我要去休息」 must now keep 雪梨 (HEAD made 「休息」 the
// destination), so it is no longer HEAD-existing. Required: 雪梨 kept, no 「休息」 destination reply, geocode ≤ HEAD,
// no reset HEAD did not do — except at done, where every turn starts a new planning session (phase_done; the same
// for 「今天天氣如何」 at HEAD, verified in verify-m18-nonplace-guard-review).
const HEAD_EXISTING = new Set();
const REQUIRE_KEEP = new Set(["今天不去了，我要去休息"]);
// M16 round 4 (tester review, accepted improvement): en negated city + article/category ("the beach" / "a museum")
// was geocoded at HEAD (candidate advice, confirm-city question). WORK keeps 雪梨 with 0 geocode; the branch may
// differ, and at done the phase_done session reset applies (same as any other sentence at that stage).
const CATEGORY_IMPROVEMENT = new Set(["rather than Sydney, I want to go to a museum", "not Sydney anymore, I want to go to the beach"]);
// M18 round 2 (assigner ruling, expected improvement): after a failed generation a ja negated-city category wish
// answered LAST-RESORT at HEAD; it must now explain that these combinations have no plan centred on the category
// (requirement 1). Required: not LAST-RESORT, シドニー kept, category named in the reply, the failed-stage pending kept
// (activity_choice), geocode ≤ HEAD and no reset.
const M18_FAILED_CATEGORY = new Map([
  ["ja|failedCatch|シドニーじゃなくて海に行きたい", /海/],
  ["ja|failedCatch|シドニーはやめて、買い物に行きたい", /買い物/],
]);
const LAST_RESORT_RE = /LAST-RESORT|実在する場所の組み合わせを十分に取得できませんでした/;
for (const [k, w] of Object.entries(RES)) {
  const h = HEAD?.[k];
  const x = w.row;
  const atDone = k.split("|")[1] === "done";
  if (M18_FAILED_CATEGORY.has(k)) {
    const issues = [];
    if (LAST_RESORT_RE.test(`${x.branch} ${x.reply}`)) issues.push("LAST-RESORT");
    if (!isSydney(x.dest)) issues.push("destination changed");
    if (!M18_FAILED_CATEGORY.get(k).test(x.reply ?? "") || !/組み合わせ/.test(x.reply ?? "")) issues.push("no category / combination explanation");
    if (x.pending !== "activity_choice") issues.push(`pending ${x.pending} (want activity_choice)`);
    if (h && x.geoQ.length > h.row.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.row.geoQ.length}`);
    if (x.sidChanged) issues.push("session reset");
    if (issues.length) { failures.push(k); out(`FAIL m18-ruling ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
    else out(`PASS m18-ruling ${k}: category explanation (HEAD branch=${h?.row.branch ?? "n/a"})\n   W ${brief(x)}`);
    continue;
  }
  if (REQUIRE_KEEP.has(w.t) || CATEGORY_IMPROVEMENT.has(w.t)) {
    const issues = [];
    if (!isSydney(x.dest)) issues.push("destination changed");
    if (/休息|museum|beach/i.test(x.dest ?? "") || /以休息為主|trip to 休息/.test(x.reply ?? "")) issues.push("non-place destination reply");
    if (h && x.geoQ.length > h.row.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.row.geoQ.length}`);
    if (CATEGORY_IMPROVEMENT.has(w.t) && x.geoQ.length !== 0) issues.push(`geocode ${x.geoQ.length} (want 0)`);
    if (h && x.sidChanged && !h.row.sidChanged && !atDone) issues.push("reset HEAD did not do");
    if (issues.length) { failures.push(k); out(`FAIL required ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
    else out(`PASS required ${k}: 雪梨 kept geo=${x.geoQ.length} (HEAD dest=${h?.row.dest ?? "n/a"} geo=${h?.row.geoQ.length ?? "n/a"})`);
    continue;
  }
  if (RULING_CONFIRM.has(w.t)) {
    const issues = [];
    if (x.cls !== "NEGATED_UNCERTAIN" || !/^E1 ask/.test(x.branch)) issues.push(`want the confirmation question, got ${x.cls}/${x.branch}`);
    if (x.geoQ.length !== 0) issues.push(`geocode ${x.geoQ.length}`);
    if (!isSydney(x.dest)) issues.push("destination changed");
    if (h && h.row.branch !== x.branch) issues.push(`branch WORK=${x.branch} HEAD=${h.row.branch}`);
    if (issues.length) { failures.push(k); out(`FAIL ruling ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
    else out(`PASS ruling ${k}: confirmation question kept (0 geocode)`);
    continue;
  }
  if (RULING_IMPROVEMENT.has(w.t)) {
    const issues = [];
    if (!isSydney(x.dest)) issues.push("destination changed");
    if (h && x.geoQ.length > h.row.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.row.geoQ.length}`);
    if (h && x.sidChanged && !h.row.sidChanged) issues.push("reset HEAD did not do");
    if (issues.length) { failures.push(k); out(`FAIL ruling ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
    else out(`PASS ruling ${k}: 雪梨 kept (HEAD dest=${h?.row.dest ?? "n/a"})`);
    continue;
  }
  if (HEAD_EXISTING.has(w.t)) {
    const issues = [];
    if (h) {
      if (x.dest !== h.row.dest) issues.push(`dest WORK=${x.dest} HEAD=${h.row.dest}`);
      if (x.geoQ.length > h.row.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.row.geoQ.length}`);
      if (x.sidChanged !== h.row.sidChanged) issues.push(`reset WORK=${x.sidChanged} HEAD=${h.row.sidChanged}`);
      if (x.branch !== h.row.branch) issues.push(`branch WORK=${x.branch} HEAD=${h.row.branch}`);
    } else if (!isSydney(x.dest)) issues.push("destination changed (no HEAD to compare)");
    if (issues.length) { failures.push(k); out(`FAIL head-existing ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
    else out(`KNOWN head-existing ${k}: same as HEAD (dest=${x.dest})`);
    continue;
  }
  if (w.pos) { out(`${!isSydney(x.dest) && x.geoQ.length <= 1 ? "PASS" : "FAIL"} pos ${k}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); if (isSydney(x.dest) || x.geoQ.length > 1) failures.push(k); continue; }
  const issues = [];
  if (!isSydney(x.dest)) issues.push("destination changed");
  if (h && x.geoQ.length > h.row.geoQ.length) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h.row.geoQ.length}`);
  if (h && x.sidChanged !== h.row.sidChanged) issues.push(`session reset WORK=${x.sidChanged} HEAD=${h.row.sidChanged}`);
  if (h && x.branch !== h.row.branch) issues.push(`branch WORK=${x.branch} HEAD=${h.row.branch}`);
  if (issues.length) { failures.push(k); out(`FAIL ${k}: ${issues.join("; ")}\n   W ${brief(x)}${h ? `\n   H ${brief(h.row)}` : ""}`); }
  else out(`PASS ${k}\n   W ${brief(x)}`);
}
if (fetchCalls) { failures.push("fetch"); out(`FAIL no network fetch=${fetchCalls}`); }
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
