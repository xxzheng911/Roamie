/**
 * M18 (tester, independent review of M16 round 4): the "non-place never becomes a destination" guard.
 *  p) pure: isNonPlaceDestinationText (WORK only), parseDestinationFromText, resolveIncomingDestinationFromText and
 *     extractChatPlanningContextFromText().preferredArea on real place names (must not be blocked) and
 *     non-place wording (must be blocked). WORK vs HEAD.
 *  a) App-order turns (m16 harness) on a Sydney 12/10-12/14 trip at every stage: rest / time-word / generic
 *     sentences ("今天天氣如何" is the baseline for the done-stage reset claim), category turns. WORK vs HEAD.
 *  c) country-level trip (日本) + bare category words (「溫泉」): category flow must still answer; WORK vs HEAD.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-m18-nonplace-guard-review.mjs [-- --head-dir=<snapshot>]
 */
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
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const reset = await load("src/lib/ai/trip-planning-session-reset.ts");
const flow = await load("src/lib/chat-planning-flow.ts");
const sessionMod = await load("src/lib/chat-session.ts");

// ------------------------------------------------------------------ p) pure
const REAL = ["明日香", "明日香村", "淺草", "浅草", "澀谷", "澀谷一帶", "熱海", "上海", "北海道", "海口", "青海", "別府", "甲府", "成都", "草津溫泉", "別府温泉",
  "九份老街", "築地市場", "士林夜市", "今治", "今帰仁", "江ノ島", "お台場", "해운대", "부산", "제주도", "남대문시장",
  "New York", "Gold Coast", "the Gold Coast", "St. Petersburg", "Hot Springs", "Palm Beach", "Bondi Beach", "Long Beach", "Miami Beach", "Virginia Beach",
  "Park City", "The Hague", "The Rocks", "Bar Harbor", "Coffee Bay", "Market Harborough", "Reading", "Nice", "A Coruña", "Ho Chi Minh City", "Isle of Skye"];
const NONPLACE = ["雪梨了改去熱海", "雪梨了", "今天", "今天不去了", "這次", "休息", "衝浪", "溫泉", "咖啡廳", "去咖啡廳", "的咖啡廳", "海邊", "a cheaper hotel", "the other option",
  "the beach", "a museum", "hot springs", "京都にする", "switch to Kyoto", "改去熱海"];
const SENT = [
  ["我要去明日香", "明日香"], ["我想去淺草", "淺草"], ["去澀谷一帶走走", "澀谷"], ["我要去今治", "今治"], ["我要去草津溫泉", "草津"], ["我要去上海", "上海"], ["我要去北海道", "北海道"],
  ["我要去熱海", "熱海"], ["我要去別府", "別府"], ["我要去甲府", "甲府"],
  ["I want to go to New York", "New York"], ["I want to go to the Gold Coast", "Gold Coast"], ["let's go to St. Petersburg", "Petersburg"], ["I'm going to Hot Springs", "Hot Springs"],
  ["I'm going to Palm Beach", "Palm Beach"], ["I want to go to Long Beach", "Long Beach"], ["I'm going to Park City", "Park City"],
  ["我要去休息", null], ["我想去休息", null], ["今天不去了，我要去休息", null], ["我想去海邊", null], ["我要去溫泉", null], ["去咖啡廳", null],
  ["I want to go to the beach", null], ["switch to a cheaper hotel", null], ["I want to go to a museum", null], ["I want to go to hot springs", null],
  // Dropped-city forms: the lexical parse must never return the dropped 雪梨 or a residue (「雪梨了改去熱海」);
  // the switch itself goes through classifyDestinationSwitchTurn + Destination Authority (section s).
  ["我不要雪梨了，改去熱海", "!雪梨"], ["雪梨算了，改去熱海", "!雪梨"], ["不要雪梨了，換成熱海", "!雪梨"], ["雪梨不要了，換成別府", "!雪梨"],
];
const AREA = ["附近的咖啡廳", "去咖啡廳", "我想去淺草走走", "去澀谷一帶逛逛", "我要去休息", "去明日香走走", "到新宿逛逛", "這附近有咖啡廳嗎", "去中山區走走", "去海邊走走", "今天去天母逛逛"];
const safe = (f) => { try { return f() ?? null; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 60)}`; } };
const P = { nonplace: {}, parse: {}, incoming: {}, area: {} };
// Ambiguous one-word names that are also category words (Bar, Montenegro / Temple, Texas): INFO only.
const AMBIG = ["Bar", "Temple", "Market", "Beach"];
for (const n of AMBIG) P.nonplace[n] = typeof tpc.isNonPlaceDestinationText === "function" ? safe(() => tpc.isNonPlaceDestinationText(n)) : "n/a";
for (const n of [...REAL, ...NONPLACE]) P.nonplace[n] = typeof tpc.isNonPlaceDestinationText === "function" ? safe(() => tpc.isNonPlaceDestinationText(n)) : "n/a";
for (const [t] of SENT) { P.parse[t] = safe(() => tpc.parseDestinationFromText(t)); P.incoming[t] = safe(() => reset.resolveIncomingDestinationFromText(t)); }
for (const t of AREA) P.area[t] = safe(() => flow.extractChatPlanningContextFromText(t, sessionMod.createEmptySession()).preferredArea);

// ------------------------------------------------------------------ a) App turns on a Sydney trip
const STAGES = ["choosing", "picked", "done", "failedCatch", "refreshPref"];
const reach = async (locale, place = H.NAME[locale].sydney) => { H.freshAll(); await H.freshAuthority(); H.setLocale(locale); return (await H.first(H.STEP1[locale](place), locale)).s; };
const stageSession = async (locale, stage) => {
  const s = await reach(locale);
  if (stage === "choosing") return s;
  if (stage === "refreshPref") return H.refreshPref(s);
  const picked = (await H.appTurn(s, "1", locale)).s;
  if (stage === "picked") return picked;
  if (stage === "done") return H.generatedDone(picked, "sydney");
  return H.failedCatch(picked, "sydney");
};
const TURNS = [
  ["zh-TW", "今天不去了，我要去休息"], ["zh-TW", "我想去休息"], ["zh-TW", "今天不去了"], ["zh-TW", "今天天氣如何"], ["zh-TW", "我要去休息"],
  ["zh-TW", "想去海邊"], ["zh-TW", "推薦咖啡廳"], ["zh-TW", "附近的咖啡廳"], ["zh-TW", "去咖啡廳"], ["zh-TW", "我想泡溫泉"],
  ["en", "switch to a cheaper hotel"], ["en", "forget Sydney, switch to a cheaper hotel"], ["en", "what's the weather today"],
  ["en", "rather than Sydney, I want to go to a museum"], ["en", "recommend some cafes"],
  ["en", "I want to go to a museum"], ["en", "I want to go to the beach"], ["zh-TW", "我想去博物館"],
];
const row = (r) => ({ ...H.pk(r.row), preferredArea: r.s?.preferredArea ?? null });
const A = {};
for (const [locale, t] of TURNS) for (const stage of STAGES) {
  const r = await H.appTurn(await stageSession(locale, stage), t, locale);
  A[`${locale}|${stage}|${t}`] = row(r);
}
// ------------------------------------------------------------------ s) switch consistency (requirements 1 / 3 / 4)
const SW = [
  ["zh-TW", "改去熱海", "atami"], ["zh-TW", "換成熱海", "atami"], ["zh-TW", "換成別府", "beppu"], ["zh-TW", "雪梨不要了，換成熱海", "atami"],
  ["zh-TW", "我不要雪梨了，改去熱海", "atami"], ["zh-TW", "雪梨算了，改去熱海", "atami"], ["zh-TW", "不要雪梨了，換成熱海", "atami"],
  ["ja", "シドニーはやめて京都にする", "kyoto"], ["en", "forget Sydney, let's switch to Atami", "atami"],
];
const S = {};
for (const [locale, t, key] of SW) for (const stage of STAGES) {
  const r = await H.appTurn(await stageSession(locale, stage), t, locale);
  S[`${locale}|${stage}|${t}`] = { key, row: row(r) };
}
// ------------------------------------------------------------------ c) country-level trip
const C = {};
for (const t of ["溫泉", "推薦溫泉", "我想泡溫泉", "想去海邊", "推薦咖啡廳", "去咖啡廳"]) {
  const s = await reach("zh-TW", "日本");
  const r = await H.appTurn(s, t, "zh-TW");
  C[t] = row(r);
}

if (CHILD) {
  process.stdout.write(`@@M18_JSON@@${JSON.stringify({ P, A, S, C, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m18-nonplace-guard-review.mjs";
  const harness = "scripts/verify-m16-post-selection-switch-review.mjs";
  for (const f of [self, harness]) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 540_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M18_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]) : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

const failures = [];
const fail = (k, msg) => { failures.push(k); out(`FAIL ${k}: ${msg}`); };
const j = (v) => JSON.stringify(v);
// p)
for (const n of AMBIG) out(`INFO p|ambiguous|${n} isNonPlaceDestinationText=${j(P.nonplace[n])}`);
for (const n of REAL) if (P.nonplace[n] === true) fail(`p|nonplace|${n}`, "real place name blocked by isNonPlaceDestinationText");
for (const n of NONPLACE) if (P.nonplace[n] !== true) fail(`p|nonplace|${n}`, `non-place not blocked (${j(P.nonplace[n])})`);
for (const [t, want] of SENT) for (const fn of ["parse", "incoming"]) {
  const w = P[fn][t]; const h = HEAD?.P?.[fn]?.[t];
  const okOf = (v) => want === null ? v === null
    : want.startsWith("!") ? !(typeof v === "string" && (v.includes(want.slice(1)) || /了|改去|換成|不要|算了/.test(v)))
    : typeof v === "string" && v.includes(want);
  if (!okOf(w)) {
    // Regression only when HEAD was right; a wrong HEAD answer is HEAD-existing (KNOWN), even if it changed.
    if (HEAD && !okOf(h)) out(`KNOWN p|${fn}|${t}: HEAD-existing (WORK=${j(w)} HEAD=${j(h)} want=${j(want)})`);
    else fail(`p|${fn}|${t}`, `WORK=${j(w)} want=${j(want)} HEAD=${j(h)}`);
  } else out(`PASS p|${fn}|${t} WORK=${j(w)}${HEAD && j(h) !== j(w) ? ` HEAD=${j(h)}` : ""}`);
}
for (const t of AREA) out(`INFO p|area|${t} WORK=${j(P.area[t])}${HEAD ? ` HEAD=${j(HEAD.P.area[t])}` : ""}`);
for (const t of ["我想去淺草走走", "去澀谷一帶逛逛", "去明日香走走", "到新宿逛逛", "去中山區走走", "今天去天母逛逛"]) {
  const h = HEAD?.P?.area?.[t];
  if (HEAD && h && !P.area[t]) fail(`p|area|${t}`, `real-place preferredArea dropped (HEAD=${j(h)})`);
}
// a)
const brief = (x) => x ? `${x.cls}/${x.branch} dest=${x.dest} trip=${x.trip} tpc=${x.tpc} cand=${x.cand ?? "-"} pend=${x.pending ?? "-"} off=${x.offered} start=${x.start} end=${x.end} prov=${x.prov} sid=${x.sidChanged} geo=${x.geoQ.length}${x.geoQ.length ? `[${x.geoQ.join(",")}]` : ""} pa=${x.preferredArea} | ${(x.reply ?? "").slice(0, 110)}` : "-";
const isSydney = (d) => /sydney|雪梨|シドニー|시드니/i.test(d ?? "");
for (const [k, x] of Object.entries(A)) {
  const h = HEAD?.A?.[k];
  const issues = [];
  if (!isSydney(x.dest)) issues.push(`destination left Sydney (${x.dest})`);
  if (/休息|咖啡|海邊|溫泉|hotel|museum|cafe/i.test(x.dest ?? "") || /以休息為主|trip to 休息/.test(x.reply ?? "")) issues.push("non-place as destination");
  if (x.geoQ.length > (h?.geoQ.length ?? 0)) issues.push(`geocode WORK=${x.geoQ.length} > HEAD=${h?.geoQ.length ?? "-"}`);
  if (h && x.sidChanged && !h.sidChanged) issues.push(`session reset WORK=true HEAD=false`);
  if (h && h.start && x.start !== h.start) issues.push(`start WORK=${x.start} HEAD=${h.start}`);
  const dateLost = x.start !== "2026-12-10" && !/\|done\|/.test(k);
  if (dateLost) issues.push(`dates not kept (start=${x.start} end=${x.end})`);
  const line = `${k}\n   W ${brief(x)}${h ? `\n   H ${brief(h)}` : ""}`;
  if (issues.length) out(`ISSUE a|${line}\n   -> ${issues.join("; ")}`);
  else out(`PASS a|${line}`);
}
// s)
const TARGET = { kyoto: /kyoto|京都|교토/i, atami: /atami|熱海|아타미/i, beppu: /beppu|別府|벳푸/i };
for (const [k, { key, row: x }] of Object.entries(S)) {
  const h = HEAD?.S?.[k]?.row;
  const issues = [];
  const re = TARGET[key];
  if (!re.test(x.dest ?? "")) issues.push(`travelContext.destination=${x.dest}`);
  if (!re.test(x.tpc ?? "")) issues.push(`tripPlanningContext.destination=${x.tpc}`);
  if (!re.test(x.trip ?? "")) issues.push(`tripDestination=${x.trip}`);
  if (x.dest && x.tpc && tpc.normalizeDestinationLabel(x.dest) !== tpc.normalizeDestinationLabel(x.tpc)) issues.push(`desync dest=${x.dest} tpc=${x.tpc}`);
  if (!(x.offered > 0) || x.pending !== "combination_choice") issues.push(`combinations not re-listed (off=${x.offered} pend=${x.pending})`);
  if (x.start !== "2026-12-10" || x.end !== "2026-12-14" || x.prov !== "user_date/true") issues.push(`dates ${x.start}~${x.end} prov=${x.prov}`);
  if (x.sidChanged !== true) issues.push("no planning session reset");
  if (x.chainReset === true) issues.push("second reset in the same turn (chainReset)");
  if (x.geoQ.length > 1) issues.push(`geocode ${x.geoQ.length} > 1`);
  if (/雪梨了|改去熱海|換成熱海|換成別府|にする/.test(`${x.dest} ${x.tpc} ${x.trip}`)) issues.push("switch residue in destination");
  if (!re.test(x.reply ?? "") || /LAST-RESORT|candidate advice|E1 ask/.test(x.branch)) issues.push(`reply/branch ${x.branch}`);
  const line = `${k}\n   W ${brief(x)} chainReset=${x.chainReset}${h ? `\n   H ${brief(h)}` : ""}`;
  if (issues.length) fail(`s|${k}`, `${issues.join("; ")}\n   ${line}`);
  else out(`PASS s|${line}`);
}
// c)
for (const [t, x] of Object.entries(C)) {
  const h = HEAD?.C?.[t];
  out(`INFO c|日本|${t}\n   W ${brief(x)}${h ? `\n   H ${brief(h)}` : ""}`);
  if (!x.reply && !/category|later dispatch|destination places/.test(x.branch)) fail(`c|${t}`, "no reply and no category route");
}
if (fetchCalls) fail("fetch", `no network fetch=${fetchCalls}`);
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all (ISSUE rows need manual triage)");
process.exit(failures.length ? 1 : 0);
