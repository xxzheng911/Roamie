import "./verify-netguard-full.mjs";
/**
 * D5 (tester, independent round-2 review).
 *  F) en / ko everyday sentences (NOT trip dates; many contain plan / stay / change / move / switch / 일정-free
 *     schedule words) through mergeTravelContext on an empty session and a dated Sydney trip (12/10–12/14/5),
 *     for several "today" values, plus the App-order turn on the generated ("done") Sydney trip. Every row that
 *     sets / moves a trip date is listed (the quantified false-positive survey). Rows tagged "amb" are trip-ish
 *     wording where reading a date is defensible; they are reported but not counted as false positives.
 *  O) 「沖縄へ旅行に行きたい」 on the App-order harness: first turn (branch / pending / dest / candidate / reply) and the
 *     follow-up turn, compared with 「別府に観光します」, a bare typed 「沖縄」, 「沖縄に行きたい」 and zh 「我想去沖繩旅行」.
 *  C) consistency probe: a dated trip + "starting the day after tomorrow for 3 days" / 「내일모레부터 3일」 /
 *     「從後天開始玩3天」 → days must equal the start~end span.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-date-dest-review-d5.mjs
 */
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 380s"); process.exit(3); }, 380_000).unref();

const RealDate = Date;
let NOW = new RealDate("2026-11-16T10:00:00").getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const setToday = (iso) => { NOW = new RealDate(`${iso}T10:00:00`).getTime(); };
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const travelContext = await load("src/lib/ai/travel-context.ts");
const sessionMod = await load("src/lib/chat-session.ts");

const DAY = 86_400_000;
const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return RealDate.UTC(y, m - 1, d); };
const span = (a, b) => (a && b ? Math.round((toMs(b) - toMs(a)) / DAY) + 1 : null);
const TODAYS = { mon: "2026-11-16", wed: "2026-11-11", fri: "2026-11-13", sun: "2026-11-15" };
const OLD = { start: "2026-12-10", end: "2026-12-14", days: 5 };
const dated = () => ({
  ...sessionMod.createEmptySession(),
  tripStartDate: OLD.start, tripEndDate: OLD.end, tripDays: OLD.days,
  travelContext: { interests: [], destination: "雪梨", destinationCountry: "Australia", startDate: OLD.start, endDate: OLD.end, days: OLD.days,
    dateProvenance: { source: "user_date", confirmed: true, startDate: OLD.start, endDate: OLD.end }, planningDaysConfirmed: true },
});
const merge = (s, t) => {
  try { const c = travelContext.mergeTravelContext(s, t).context; return { start: c.startDate ?? null, end: c.endDate ?? null, days: c.days ?? null, dest: c.destination ?? null }; }
  catch (e) { return { error: String(e?.message ?? e).slice(0, 80) }; }
};

const failures = [];
const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };

// ------------------------------------------------------------------ F) false-positive survey
// [locale, sentence, tag] tag: "fp" = not a trip date (must not set / move dates), "amb" = trip-ish, reported only.
const SURVEY = [
  ["en", "I plan to rest from today", "fp"], ["en", "we changed the menu today", "fp"], ["en", "stay safe starting today", "fp"],
  ["en", "move the meeting to Friday", "fp"], ["en", "I'm staying home from today", "fp"], ["en", "prices change starting tomorrow", "fp"],
  ["en", "the weather will change starting tomorrow", "fp"], ["en", "my plans changed today", "fp"], ["en", "the store will move to a new location starting tomorrow", "fp"],
  ["en", "can you switch to dark mode starting today", "fp"], ["en", "the travel ban is lifted from today", "fp"], ["en", "we plan to go out from today.", "fp"],
  ["en", "is the itinerary from today ready?", "fp"], ["en", "switch to tomorrow's forecast", "fp"], ["en", "change to today's menu", "fp"],
  ["en", "it's going to rain starting today for 3 days", "fp"], ["en", "will it rain from today through Friday", "fp"], ["en", "the museum is closed from today until Friday", "fp"],
  ["en", "I'm free starting tomorrow", "fp"], ["en", "our hotel stay starts today", "amb"], ["en", "I'm on holiday from today", "amb"],
  ["en", "move it to tomorrow", "amb"], ["en", "the shuttle schedule changes from tomorrow", "fp"], ["en", "my plan today is to sleep", "fp"],
  ["en", "the vacation rental opens from tomorrow, for 2 nights only", "fp"],
  ["ko", "다이어트는 오늘부터", "fp"], ["ko", "운동은 내일부터!", "fp"], ["ko", "세일은 내일부터.", "fp"], ["ko", "오늘부터 일 시작해", "fp"],
  ["ko", "내일 출발하는 버스 있어?", "fp"], ["ko", "회의를 내일로 옮겨줘", "fp"], ["ko", "메뉴를 오늘로 바꿨어", "fp"],
  ["ko", "오늘부터 3일 동안 비 온대", "fp"], ["ko", "내일부터 금요일까지 비 와?", "fp"], ["ko", "오늘부터 금요일까지 휴무야", "fp"],
  ["ko", "오늘부터 날씨가 추워진대", "fp"], ["ko", "내일부터 일정 바꿀래", "amb"], ["ko", "오늘로 바꿔줘", "amb"],
  // zh / ja weather-range questions (requirement 5 "four locales"), same class as the ko 「내일부터 금요일까지 비 와?」 row.
  ["zh-TW", "明天到週五會下雨嗎", "fp"], ["zh-TW", "今天到週五都會下雨嗎", "fp"], ["zh-TW", "從明天開始會下雨嗎", "fp"],
  ["ja", "明日から金曜日まで雨ですか", "fp"], ["ja", "明日から3日間雨が降るらしい", "fp"], ["ja", "今日から寒くなる", "fp"],
];
const hits = [];
for (const [tk, today] of Object.entries(TODAYS)) {
  setToday(today);
  for (const [loc, t, tag] of SURVEY) {
    const e = merge(sessionMod.createEmptySession(), t);
    const d = merge(dated(), t);
    const eHit = e.error || e.start || e.end;
    const dHit = d.error || d.start !== OLD.start || d.end !== OLD.end || d.days !== OLD.days;
    if (eHit || dHit) hits.push({ tk, loc, t, tag, e, d });
  }
}
const byText = new Map();
for (const h of hits) { if (!byText.has(h.t)) byText.set(h.t, h); }
out("==== F) survey: sentences that set / move a trip date (first today shown) ====");
let fpCount = 0; let ambCount = 0;
for (const [t, h] of byText) {
  if (h.tag === "fp") fpCount++; else ambCount++;
  out(`${h.tag === "fp" ? "FP " : "AMB"} ${h.loc} 「${t}」 (${h.tk}) empty=${h.e.error ?? `${h.e.start}~${h.e.end}/${h.e.days}`} dated=${h.d.error ?? `${h.d.start}~${h.d.end}/${h.d.days}`}`);
}
out(`survey: ${SURVEY.filter((x) => x[2] === "fp").length} fp-tagged sentences, ${fpCount} misread; ${SURVEY.filter((x) => x[2] === "amb").length} amb, ${ambCount} read as dates`);
for (const [t, h] of byText) if (h.tag === "fp") failures.push(`F|${h.loc}|${t}`);

// ------------------------------------------------------------------ App harness (same slice as verify-date-phrase-today-retest)
const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
if (from < 0 || to < 0) { out("FAIL harness slice not found"); process.exit(2); }
const OLD_13058 = 'return dateQuestion("13058");';
let slice = HARNESS_SRC.slice(from, to);
if (!slice.includes(OLD_13058)) { out("FAIL harness 13058 branch not found"); process.exit(2); }
slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
  + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
  + 'return dateQuestion("13058"); }');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
  slice + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, NAME, generatedDone, setLocale: (l) => { curLocale = l; } };",
)(load, loadOpt, readFileSync, storageWrites);
const row = (r) => {
  const s = r.s; const tc = s.travelContext ?? {};
  return `branch=${r.row.branch} pending=${s.pendingQuestion?.type ?? "-"} dest=${tc.destination ?? null} trip=${s.tripDestination?.city ?? null}`
    + ` cand=${tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : "-"} dates=${tc.startDate ?? "-"}~${tc.endDate ?? "-"}/${tc.days ?? s.tripDays ?? "-"}`
    + ` | ${(r.row.reply ?? "").replace(/\n/g, " / ").slice(0, 140)}`;
};

// App impact of the survey hits on a generated Sydney trip.
setToday(TODAYS.mon);
out("\n==== F) App-order turn on the generated (done) Sydney trip, survey hits only ====");
for (const [t, h] of byText) {
  H.freshAll(); await H.freshAuthority(); H.setLocale(h.loc);
  const s = (await H.first(H.STEP1[h.loc](H.NAME[h.loc].sydney), h.loc)).s;
  const picked = (await H.appTurn(s, "1", h.loc)).s;
  const done = H.generatedDone(picked, "sydney");
  let r; try { r = await H.appTurn(structuredClone(done), t, h.loc); } catch (e) { out(`THROW ${t} ${e?.message}`); continue; }
  const tc = r.s.travelContext ?? {};
  const moved = tc.startDate !== OLD.start || tc.endDate !== OLD.end;
  out(`${moved ? "MOVED" : "kept "} ${h.tag} ${h.loc} 「${t}」 -> ${row(r)}`);
}

// ------------------------------------------------------------------ O) Okinawa flow
out("\n==== O) 「沖縄へ旅行に行きたい」 App flow vs controls (empty session, first turn + follow-up) ====");
const FLOW = [
  ["ja", "沖縄へ旅行に行きたい"], ["ja", "沖縄に行きたい"], ["ja", "沖縄"], ["ja", "沖縄旅行"], ["ja", "別府に観光します"], ["ja", "別府"],
  ["zh-TW", "我想去沖繩旅行"], ["zh-TW", "沖繩"], ["ko", "오키나와 여행"],
];
const FOLLOW = { ja: ["3日間", "はい"], "zh-TW": ["3天", "好"], ko: ["3일", "네"] };
const firstRows = {};
for (const [loc, t] of FLOW) {
  H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
  let r; try { r = await H.first(t, loc); } catch (e) { out(`THROW ${loc} 「${t}」 ${e?.message}`); continue; }
  firstRows[t] = r;
  out(`T1 ${loc} 「${t}」 -> ${row(r)}`);
  const vis = `${r.s.travelContext?.destination ?? ""} ${r.s.tripDestination?.city ?? ""} ${r.row.reply ?? ""}`;
  if (/沖縄(?:へ|に)?(?:旅行|観光)|沖繩旅行/.test(vis)) fail(`O|visible-travel-word|${t}`, "visible destination text carries 旅行/観光");
  for (const f of FOLLOW[loc]) {
    let r2; try { r2 = await H.appTurn(structuredClone(r.s), f, loc); } catch (e) { out(`   THROW follow 「${f}」 ${e?.message}`); continue; }
    out(`   T2 「${f}」 -> ${row(r2)}`);
  }
}
const sig = (t) => { const r = firstRows[t]; return r ? `${r.row.branch}|${r.s.pendingQuestion?.type ?? "-"}|${r.s.travelContext?.destinationCandidate?.status ?? "-"}` : "missing"; };
out(`\nINFO flow signature 沖縄へ旅行に行きたい=${sig("沖縄へ旅行に行きたい")} 沖縄=${sig("沖縄")} 沖縄に行きたい=${sig("沖縄に行きたい")} 別府に観光します=${sig("別府に観光します")} 別府=${sig("別府")} 我想去沖繩旅行=${sig("我想去沖繩旅行")}`);
// A bare typed ja name ends in the harness "later dispatch" (handled after this slice): not comparable here.
for (const [phrase, bare, wish] of [["沖縄へ旅行に行きたい", "沖縄", "沖縄に行きたい"], ["別府に観光します", "別府", null]]) {
  if (sig(bare).startsWith("later dispatch")) out(`UNVERIFIED typed 「${bare}」 = harness later dispatch; 「${phrase}」 compared with the existing ja wish path instead`);
  else if (sig(phrase) !== sig(bare)) fail(`O|same-as-typed-name|${bare}`, `${phrase} ${sig(phrase)} ≠ typed ${bare} ${sig(bare)}`);
  if (wish && sig(phrase) !== sig(wish)) fail(`O|same-as-wish|${bare}`, `${phrase} ${sig(phrase)} ≠ ${wish} ${sig(wish)}`);
}

// ------------------------------------------------------------------ C) consistency probe
out("\n==== C) dated trip + non-today/tomorrow relative start: days must equal start~end span ====");
setToday(TODAYS.mon);
for (const t of ["starting the day after tomorrow for 3 days", "내일모레부터 3일", "從後天開始玩3天", "3 days", "3일", "3天"]) {
  const d = merge(dated(), t);
  const ok = !d.error && span(d.start, d.end) === d.days;
  // INFO only: plain 「3天」 shows the same pure-merge span, so this is not specific to the D5 diff.
  out(`INFO ${ok ? "ok  " : "BAD "} 「${t}」 dated -> ${d.error ?? `${d.start}~${d.end}/${d.days}`} span=${span(d.start, d.end)}`);
}

out(`\nSUMMARY fail=${failures.length}`);
out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
