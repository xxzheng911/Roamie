/**
 * M19 (tester, independent review of M18 round 1): category wish wording, 今天／明天 date guard, Japan region_choice.
 *  --section=p  pure: categorySwitchSearchText / isFutureTripPlanningStatement / detectChatIntent / resolveChatContextIntent /
 *               parsePlaceRecommendationIntent on category wishes, trip statements and ambiguous words; plus a NEW-chat App turn.
 *  --section=d  dates: Sydney 12/10-12/14 trip at every stage, non-date 今天／明天 sentences must keep dates; explicit trip-date
 *               wording must change them.
 *  --section=j  Japan (country-level) region_choice: category wishes re-ask the region choice (geo 0, places 0, no LAST-RESORT);
 *               real place names (別府 …) must still narrow / become a candidate.
 *  --section=c  ja / ko / en category wishes on the Sydney trip at every stage (no LAST-RESORT, combinations kept).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-m19-m18-review.mjs -- --section=d [--head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const section = argv.find((a) => a.startsWith("--section="))?.slice(10) ?? "p";
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
const chatIntent = await load("src/lib/ai/chat-intent.ts");
const ctxIntent = await load("src/lib/ai/chat-context-intent.ts");
const recParse = await load("src/lib/ai/place-recommendation-intent/parse.ts");
const sessionMod = await load("src/lib/chat-session.ts");

const safe = (f) => { try { const v = f(); return v === undefined ? null : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 60)}`; } };
const STAGES = ["choosing", "picked", "done", "failedCatch", "refreshPref"];
const reach = async (locale, place) => { H.freshAll(); await H.freshAuthority(); H.setLocale(locale); return (await H.first(H.STEP1[locale](place), locale)).s; };
const stageSession = async (locale, stage, place = H.NAME[locale].sydney) => {
  const s = await reach(locale, place);
  if (stage === "choosing") return s;
  if (stage === "refreshPref") return H.refreshPref(s);
  const picked = (await H.appTurn(s, "1", locale)).s;
  if (stage === "picked") return picked;
  if (stage === "done") return H.generatedDone(picked, "sydney");
  return H.failedCatch(picked, "sydney");
};
const row = (r) => ({ ...H.pk(r.row), runs: r.row.discoveryRuns ?? 0, places: r.row.placesCalls ?? 0 });
const R = {};

// ------------------------------------------------------------------ p) pure + NEW chat
const PURE = ["我想去博物館", "我要去博物館", "I want to go to a museum", "美術館に行きたい", "박물관에 가고 싶어", "我想去東京玩", "我想去東京", "I want to go to Tokyo",
  "I want to go to Japan", "我要去台北", "我明天要去台北", "明天去海邊", "I'm going to Market", "I'm going to the market", "I'm going to Bar Harbor", "I'm going to Hot Springs",
  "I want to go to hot springs", "I'd like coffee", "我想要咖啡", "我想去上海", "我想去海南", "我想去公園", "我想去夜市", "我要去士林夜市", "我想去草津溫泉", "想去泡湯",
  "我想泡溫泉", "I love shopping", "I want to go to Bondi Beach", "I want to go to the beach", "12月想去東京玩", "下個月想去大阪", "I'm going to Park City", "我想去台北的博物館"];
if (section === "p") {
  for (const t of PURE) {
    R[`p|${t}`] = {
      cat: typeof tpc.categorySwitchSearchText === "function" ? safe(() => tpc.categorySwitchSearchText(t)) : "n/a",
      future: safe(() => tpc.isFutureTripPlanningStatement(t)),
      chat: safe(() => chatIntent.detectChatIntent(t)),
      ctx: safe(() => ctxIntent.resolveChatContextIntent(t)),
      rec: safe(() => recParse.parsePlaceRecommendationIntent(t)?.primaryType ?? null),
      parse: safe(() => tpc.parseDestinationFromText(t)),
    };
  }
  for (const [locale, t] of [["zh-TW", "我想去博物館"], ["en", "I want to go to a museum"], ["ja", "美術館に行きたい"], ["ko", "박물관에 가고 싶어"], ["zh-TW", "我想去東京玩"],
    ["en", "I want to go to Tokyo"], ["zh-TW", "我想去東京"], ["en", "I'm going to Market"], ["zh-TW", "我想去夜市"], ["zh-TW", "明天去海邊"],
    ["en", "I want to go to the beach"], ["en", "I want to go to hot springs"], ["en", "I'm going to the market"], ["zh-TW", "我想去公園"], ["zh-TW", "想去泡湯"]]) {
    H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
    R[`new|${locale}|${t}`] = row(await H.first(t, locale));
  }
}
// ------------------------------------------------------------------ d) dates
const KEEP = [["zh-TW", "今天天氣如何"], ["zh-TW", "今天不去了，我要去休息"], ["zh-TW", "明天天氣如何"], ["zh-TW", "明天要下雨嗎"], ["ja", "明日の天気は？"],
  ["en", "what's the weather today"], ["en", "will it rain tomorrow"], ["en", "let's go tomorrow"], ["ko", "오늘 날씨 어때"], ["ko", "내일 비 와?"],
  ["zh-TW", "明天去海邊"], ["zh-TW", "明天要去哪裡吃"], ["zh-TW", "今天到底要去哪"], ["zh-TW", "明天開始下雨嗎"], ["zh-TW", "明天至少要帶傘嗎"], ["zh-TW", "明晚吃什麼"],
  ["zh-TW", "我想去明日香"]];
const CHANGE = [["zh-TW", "今天出發"], ["zh-TW", "從明天開始"], ["zh-TW", "改成明天到週五"], ["ja", "明日から"], ["zh-TW", "明晚出發"]];
const dStages = argv.find((a) => a.startsWith("--stages="))?.slice(9).split(",") ?? STAGES;
if (section === "d") {
  for (const [locale, t] of [...KEEP, ...CHANGE]) for (const stage of dStages) {
    R[`d|${locale}|${stage}|${t}`] = row(await H.appTurn(await stageSession(locale, stage), t, locale));
  }
}
// ------------------------------------------------------------------ j) Japan region_choice
const JCAT = ["溫泉", "推薦溫泉", "想去海邊", "我想泡溫泉", "想去泡湯", "我想泡湯", "想泡湯", "泡湯", "我想去博物館"];
const j = (v) => JSON.stringify(v);
const JPLACE = ["我想去別府", "別府", "我想去北海道", "去京都", "我想去草津溫泉", "我想去箱根泡湯"];
if (section === "j") {
  for (const [locale, place] of [["zh-TW", "日本"], ["en", "Japan"], ["ja", "日本"]]) {
    const s0 = await reach(locale, place);
    out(`INFO j|first|${locale}|${place} pending=${j(s0.pendingQuestion)} reply=${(s0.lastAssistantReply ?? "").replace(/\n/g, " / ").slice(0, 160)}`);
  }
  for (const t of [...JCAT, ...JPLACE]) {
    const s = await reach("zh-TW", "日本");
    R[`j|zh-TW|${t}`] = { before: s.pendingQuestion?.type ?? null, ...row(await H.appTurn(s, t, "zh-TW")) };
  }
  for (const [locale, t] of [["en", "hot springs"], ["en", "I want to go to a museum"], ["ja", "温泉に行きたい"], ["en", "I want to go to Beppu"]]) {
    const s = await reach(locale, locale === "en" ? "Japan" : "日本");
    R[`j|${locale}|${t}`] = { before: s.pendingQuestion?.type ?? null, ...row(await H.appTurn(s, t, locale)) };
  }
}
// ------------------------------------------------------------------ c) ja / ko / en category wishes on Sydney
const CAT = [["ja", "美術館に行きたい"], ["ko", "박물관에 가고 싶어"], ["en", "I want to go to a museum"], ["en", "rather than Sydney, I want to go to a museum"], ["en", "I'm going to Market"], ["zh-TW", "我想泡溫泉"]];
if (section === "c") {
  for (const [locale, t] of CAT) for (const stage of STAGES) R[`c|${locale}|${stage}|${t}`] = row(await H.appTurn(await stageSession(locale, stage), t, locale));
}

if (CHILD) {
  process.stdout.write(`@@M19_JSON@@${JSON.stringify({ R, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}
let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m19-m18-review.mjs";
  const harness = "scripts/verify-m16-post-selection-switch-review.mjs";
  for (const f of [self, harness]) if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...argv.filter((a) => a.startsWith("--section=") || a.startsWith("--stages="))],
    { cwd: headDir, encoding: "utf8", timeout: 540_000, maxBuffer: 128 << 20 });
  const m = (r.stdout ?? "").match(/@@M19_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).R : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
}

const failures = [];
const fail = (k, msg) => { failures.push(k); out(`FAIL ${k}: ${msg}`); };
const LR = /LAST-RESORT|暫時無法取得足夠|aren.t enough verified|couldn.t get enough/i;
const brief = (x) => x ? `${x.cls}/${x.branch} dest=${x.dest} tpc=${x.tpc} cand=${x.cand ?? "-"} pend=${x.pending ?? "-"} off=${x.offered} ${x.start}~${x.end} prov=${x.prov} sid=${x.sidChanged} geo=${x.geoQ.length}${x.geoQ.length ? `[${x.geoQ.join(",")}]` : ""} runs=${x.runs} places=${x.places} | ${(x.reply ?? "").slice(0, 120)}` : "-";
const line = (k, x) => `${k}\n   W ${x.before ? `(before=${x.before}) ` : ""}${brief(x)}${HEAD?.[k] ? `\n   H ${brief(HEAD[k])}` : ""}`;

for (const [k, x] of Object.entries(R)) {
  if (k.startsWith("p|")) { out(`INFO ${k} W=${j(x)}${HEAD?.[k] ? ` H=${j(HEAD[k])}` : ""}`); continue; }
  if (k.startsWith("new|")) { out(`INFO ${line(k, x)}`); continue; }
  const issues = [];
  if (k.startsWith("d|")) {
    const [, locale, stage, t] = k.split("|");
    const change = CHANGE.some(([l, c]) => l === locale && c === t);
    const kept = x.start === "2026-12-10" && x.end === "2026-12-14" && x.prov === "user_date/true";
    if (!change && !kept) issues.push(`dates not kept (${x.start}~${x.end} ${x.prov})`);
    if (change && x.start === "2026-12-10") issues.push(`explicit trip date not applied (${x.start}~${x.end})`);
    if (/明日香/.test(t) && !/明日香/.test(`${x.dest} ${x.tpc} ${x.cand}`)) issues.push("明日香 not read as a place");
    void stage;
  }
  if (k.startsWith("j|")) {
    const t = k.split("|")[2];
    const isCat = JCAT.includes(t) || ["hot springs", "I want to go to a museum", "温泉に行きたい"].includes(t);
    if (isCat) {
      if (x.geoQ.length) issues.push(`geocode ${j(x.geoQ)}`);
      if (x.places) issues.push(`places ${x.places}`);
      if (LR.test(`${x.branch} ${x.reply}`)) issues.push("LAST-RESORT");
      if (x.before === "region_choice" && x.pending !== "region_choice") issues.push(`pending ${x.pending}`);
      if (x.before === "region_choice" && !/東京|Tokyo|大阪|京都/.test(x.reply ?? "")) issues.push("region choice not re-listed");
      if (x.before !== "region_choice") out(`NOTE ${k}: first turn did not leave region_choice (before=${x.before}); pending checks skipped`);
    } else {
      const want = /別府|Beppu/.test(t) ? /別府|Beppu|べっぷ/i : /北海道/.test(t) ? /北海道/ : /京都/.test(t) ? /京都/ : /草津/.test(t) ? /草津/ : /箱根/;
      if (!want.test(`${x.dest} ${x.tpc} ${x.cand} ${x.reply}`)) issues.push("real place not narrowed / no candidate");
      const h = HEAD?.[k];
      // M18 C (dispatcher ruling, round 3): the Japan trip has confirmed 12/10–12/14, so a city answer keeps the dates
      // and lists combinations directly (HEAD asked the dates again: old wrong behavior, not the baseline).
      const C_ROWS = ["我想去別府", "別府", "去京都", "I want to go to Beppu"];
      if (C_ROWS.includes(t)) {
        if (x.pending === "ask_days") issues.push("asked the days again");
        if (x.pending !== "combination_choice" || !x.offered) issues.push(`combinations not listed (pending ${x.pending} offered ${x.offered})`);
        if (x.start !== "2026-12-10" || x.end !== "2026-12-14" || x.prov !== "user_date/true") issues.push(`dates not kept (${x.start}~${x.end} ${x.prov})`);
        if (x.runs > 1 || x.places > 3 || x.geoQ.length > 1) issues.push(`cost runs=${x.runs} places=${x.places} geo=${x.geoQ.length}`);
        if (h && h.dest && x.dest !== h.dest) issues.push(`narrowed to ${x.dest}, HEAD ${h.dest}`);
      } else if (h && want.test(`${h.dest} ${h.tpc} ${h.cand} ${h.reply}`) && (x.dest !== h.dest || x.branch !== h.branch)) issues.push(`differs from HEAD (H dest=${h.dest} ${h.branch})`);
    }
  }
  if (k.startsWith("c|")) {
    if (LR.test(`${x.branch} ${x.reply}`)) issues.push("LAST-RESORT");
    if (!/sydney|雪梨|シドニー|시드니/i.test(x.dest ?? "")) issues.push(`dest ${x.dest}`);
    if (x.geoQ.length) issues.push(`geocode ${j(x.geoQ)}`);
    if (x.start !== "2026-12-10") issues.push(`start ${x.start}`);
    if (/\|choosing\|/.test(k) && x.pending !== "combination_choice") issues.push(`combination_choice lost (${x.pending})`);
  }
  if (issues.length) {
    const h = HEAD?.[k];
    out(`ISSUE ${line(k, x)}\n   -> ${issues.join("; ")}${h ? ` [HEAD start=${h.start} branch=${h.branch}]` : ""}`);
    if (!k.startsWith("d|") || !h || (h.start === "2026-12-10" && h.prov === "user_date/true")) fail(k, issues.join("; "));
    else out(`KNOWN ${k}: HEAD also lost the dates (HEAD-existing)`);
  } else out(`PASS ${line(k, x)}`);
}
if (fetchCalls) fail("fetch", `no network fetch=${fetchCalls}`);
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
