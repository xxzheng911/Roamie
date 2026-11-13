import "./verify-netguard-full.mjs";
/**
 * D3 (tester, independent review): false-positive controls for the en / ko / ja relative trip-date parser
 * (travel-context.ts enKoExplicitTripDayOffset / parseTravelDateFromText / parseRelativeTripDateRange) and
 * the ja / ko destination phrase reader (travel-language-signals.ts jaKoTravelPhraseName), plus tomorrow / 내일
 * and other weekday names. Time is pinned with a fake Date; each case runs for several "today" values.
 *  K) keep: sentences that are NOT trip dates (weather, plain go questions, en sentence-final "from today" /
 *     "starting today", ko 「오늘부터 …」 non-trip wording). Empty session → no dates; dated trip → 12/10–12/14/5 kept.
 *  P) positive: tomorrow / 내일 / 明日 + N days, and today → Sunday / Monday / Saturday ranges in four locales.
 *  N) non-place: 「家族旅行」「海外旅行」「週末旅行」「温泉に行きたい」「コンビニに行きたい」「畢業旅行」 never become a destination,
 *     and on a Sydney trip never replace 雪梨. 「도쿄 여행」 is not a city-only answer.
 *  I) INFO probes for the m21 t rows (resolveDestinationFromText on the full / stripped sentence).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=240 scripts/verify-date-dest-review-d3.mjs
 */
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 220s"); process.exit(3); }, 220_000).unref();

const RealDate = Date;
let NOW = new RealDate("2026-11-16T10:00:00").getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const setToday = (iso) => { NOW = new RealDate(`${iso}T10:00:00`).getTime(); };
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const travelContext = await load("src/lib/ai/travel-context.ts");
const sessionMod = await load("src/lib/chat-session.ts");
const tpc = await load("src/lib/ai/trip-planning-context.ts");
const tls = await load("src/lib/ai/travel-language-signals.ts");

const DAY = 86_400_000;
const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return RealDate.UTC(y, m - 1, d); };
const addDays = (iso, n) => new RealDate(toMs(iso) + n * DAY).toISOString().slice(0, 10);
const dow = (iso) => new RealDate(toMs(iso)).getUTCDay();
const TODAYS = { mon: "2026-11-16", wed: "2026-11-11", fri: "2026-11-13", sat: "2026-11-14", sun: "2026-11-15", monEnd: "2026-11-30", thuYearEnd: "2026-12-31" };
const OLD = { start: "2026-12-10", end: "2026-12-14", days: 5 };

const datedSession = (pending) => ({
  ...sessionMod.createEmptySession(),
  tripStartDate: OLD.start, tripEndDate: OLD.end, tripDays: OLD.days,
  travelContext: { interests: [], destination: "雪梨", destinationCountry: "Australia", startDate: OLD.start, endDate: OLD.end, days: OLD.days,
    dateProvenance: { source: "user_date", confirmed: true, startDate: OLD.start, endDate: OLD.end }, planningDaysConfirmed: true },
  ...(pending ? { pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: "雪梨" } } : {}),
});
const CTX = { empty: () => sessionMod.createEmptySession(), dated: () => datedSession(false), datedPending: () => datedSession(true) };
const merge = (s, t) => {
  try {
    const r = travelContext.mergeTravelContext(s, t);
    const c = r.context;
    return { start: c.startDate ?? null, end: c.endDate ?? null, days: c.days ?? null, dest: c.destination ?? null,
      cand: c.destinationCandidate?.raw ?? null, sStart: r.session.tripStartDate ?? null, sEnd: r.session.tripEndDate ?? null };
  } catch (e) { return { error: String(e?.message ?? e).slice(0, 100) }; }
};

const failures = [];
const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
let passes = 0;
const pass = () => { passes++; };

// ------------------------------------------------------------------ K) keep (never a trip date)
const KEEP = [
  ["en", "the museum is open from today"], ["en", "prices go up starting today"], ["en", "prices go up starting today."],
  ["en", "the new exhibition runs from today"], ["en", "I'm free from today"], ["en", "the museum is open today through Friday"],
  ["en", "the sale starts today"], ["en", "is the museum open today"], ["en", "will it rain tomorrow"], ["en", "what's the weather today"],
  ["en", "where should we go today"], ["en", "what should we eat tomorrow"], ["en", "it will be cold starting tomorrow"],
  ["ko", "오늘 날씨 어때"], ["ko", "내일 비 와?"], ["ko", "내일 비 와"], ["ko", "오늘 어디 가지"], ["ko", "오늘 뭐 먹지"],
  ["ko", "오늘부터 세일이래"], ["ko", "오늘부터 다이어트 시작"], ["ko", "오늘부터 시작하는 축제 있어?"],
  ["ja", "今日の天気は"], ["ja", "明日は雨ですか"], ["ja", "今日どこ行こう"],
  ["zh-TW", "今天天氣如何"], ["zh-TW", "明天要下雨嗎"], ["zh-TW", "今天到底要去哪"],
];
const keepHits = new Map();
for (const [tk, today] of Object.entries(TODAYS)) {
  setToday(today);
  for (const [locale, t] of KEEP) for (const [cn, mk] of Object.entries(CTX)) {
    const o = merge(mk(), t);
    const want = cn === "empty" ? { start: null, end: null } : { start: OLD.start, end: OLD.end, days: OLD.days };
    const ok = !o.error && o.start === want.start && o.end === want.end && (cn === "empty" || o.days === want.days);
    const k = `K|${locale}|${t}|${cn}`;
    if (ok) pass();
    else if (!keepHits.has(k)) keepHits.set(k, `${tk}(${today}) got ${o.error ?? `${o.start}~${o.end}/${o.days}`} want ${want.start}~${want.end}${want.days ? `/${want.days}` : ""}`);
  }
}
for (const [k, m] of keepHits) fail(k, m);

// ------------------------------------------------------------------ P) positive (tomorrow / weekdays)
// kind: ["n", offsetStart, days] or ["wd", offsetStart, targetDow]
const POS = [
  ["en", "starting tomorrow for 3 days", ["n", 1, 3]], ["en", "from tomorrow for 3 days", ["n", 1, 3]],
  ["ko", "내일부터 3일", ["n", 1, 3]], ["ja", "明日から3日間", ["n", 1, 3]], ["zh-TW", "從明天開始玩3天", ["n", 1, 3]],
  ["en", "change it to today through Sunday", ["wd", 0, 0]], ["en", "change it to today through Monday", ["wd", 0, 1]],
  ["en", "change it to today through Saturday", ["wd", 0, 6]], ["en", "change it to tomorrow through Friday", ["wd", 1, 5]],
  ["ko", "오늘부터 일요일까지", ["wd", 0, 0]], ["ko", "오늘부터 월요일까지", ["wd", 0, 1]], ["ko", "내일부터 금요일까지", ["wd", 1, 5]],
  ["ja", "今日から日曜日までに変更", ["wd", 0, 0]], ["ja", "今日から月曜日までに変更", ["wd", 0, 1]], ["ja", "今日から土曜日まで", ["wd", 0, 6]],
  ["zh-TW", "改成今天到週日", ["wd", 0, 0]], ["zh-TW", "改成今天到週一", ["wd", 0, 1]], ["zh-TW", "改成明天到週五", ["wd", 1, 5]],
];
const posHits = new Map();
for (const [tk, today] of Object.entries(TODAYS)) {
  setToday(today);
  for (const [locale, t, [kind, so, x]] of POS) for (const [cn, mk] of Object.entries(CTX)) {
    const start = addDays(today, so);
    const exp = kind === "n" ? { start, end: addDays(start, x - 1), days: x }
      : (() => { const off = (x - dow(start) + 7) % 7; return { start, end: addDays(start, off), days: off + 1 }; })();
    const o = merge(mk(), t);
    const exact = !o.error && o.start === exp.start && o.end === exp.end && o.days === exp.days;
    // New chat with weekday wording: start only (no end) is accepted (same rule as verify-date-phrase-today-retest).
    const startOnly = kind === "wd" && cn === "empty" && o.start === exp.start && o.end == null;
    const sessionOk = cn === "empty" || (o.sStart === exp.start && o.sEnd === exp.end);
    const k = `P|${locale}|${t}|${cn}`;
    if ((exact && (sessionOk || cn === "empty")) || startOnly) pass();
    else if (!posHits.has(k)) posHits.set(k, `${tk}(${today}) got ${o.error ?? `${o.start}~${o.end}/${o.days} session=${o.sStart}~${o.sEnd}`} want ${exp.start}~${exp.end}/${exp.days}`);
  }
}
for (const [k, m] of posHits) fail(k, m);
// 「day after tomorrow」「내일모레」 are never read as tomorrow.
setToday(TODAYS.mon);
for (const [t, notStart] of [["starting the day after tomorrow for 3 days", addDays(TODAYS.mon, 1)], ["내일모레부터 3일", addDays(TODAYS.mon, 1)]]) {
  for (const [cn, mk] of Object.entries(CTX)) {
    const o = merge(mk(), t);
    if (o.start === notStart) fail(`P|not-tomorrow|${t}|${cn}`, `read as tomorrow ${o.start}~${o.end}/${o.days}`); else { pass(); out(`INFO not-tomorrow 「${t}」 ${cn}: ${o.start}~${o.end}/${o.days}`); }
  }
}

// ------------------------------------------------------------------ N) non-place trip nouns
setToday(TODAYS.mon);
const NON_PLACE = ["家族旅行", "海外旅行", "週末旅行", "温泉に行きたい", "コンビニに行きたい", "畢業旅行", "가족 여행", "주말 여행", "해외여행", "온천에 가고 싶어", "편의점에 가고 싶어"];
for (const t of NON_PLACE) {
  const cands = (() => { try { return tls.travelDestinationCandidates(t); } catch (e) { return [`THROW ${e?.message}`]; } })();
  const e = merge(CTX.empty(), t);
  const d = merge(CTX.dated(), t);
  const issues = [];
  if (e.dest || e.cand) issues.push(`empty session dest=${e.dest} cand=${e.cand}`);
  if (d.dest !== "雪梨") issues.push(`Sydney trip dest → ${d.dest} (cand ${d.cand})`);
  if (cands.length) issues.push(`travelDestinationCandidates=${JSON.stringify(cands)}`);
  if (issues.length) fail(`N|${t}`, issues.join("; ")); else pass();
}
for (const [t, want] of [["도쿄 여행", undefined], ["도쿄", "東京"], ["東京", "東京"]]) {
  const got = tpc.cityOnlyAnswerDestination(t);
  if (got !== want) fail(`N|cityOnly|${t}`, `cityOnlyAnswerDestination=${got} want ${want}`); else pass();
}
// ja / ko Sydney phrases (requirement 4) through the pure merge: destination or a pending candidate is Sydney.
for (const t of ["シドニーへ旅行", "シドニー旅行", "シドニーに行きたい", "시드니 여행", "시드니에 가고 싶어"]) {
  const e = merge(CTX.empty(), t);
  if (!/シドニー|시드니|雪梨|Sydney/.test(`${e.dest} ${e.cand}`) || e.start) fail(`N|sydney|${t}`, `dest=${e.dest} cand=${e.cand} start=${e.start}`); else pass();
}

// ------------------------------------------------------------------ I) INFO probes for m21 t rows
// HEAD parseDestinationFromTurn = resolveDestinationAreaScope(full)?.displayLabel ?? resolveDestinationFromText(full)
// (no stripTravelWishSuffix); WORK reads the stripped body. Both forms are probed with the WORK resolvers.
const profile = await load("src/lib/ai/destination-travel-profile.ts");
for (const t of ["別府に観光します", "東京 へ旅行", "沖縄へ旅行に行きたい", "日本へ旅行中", "日本へ旅行に行く"]) {
  const strip = tpc.stripTravelWishSuffix(t);
  const area = (x) => { try { return profile.resolveDestinationAreaScope(x)?.displayLabel ?? null; } catch (e) { return `THROW ${e?.message}`; } };
  out(`INFO area-probe 「${t}」 area(full)=${JSON.stringify(area(t))} area(strip)=${JSON.stringify(area(strip))}`);
}
for (const t of ["別府に観光します", "東京 へ旅行", "沖縄へ旅行に行きたい", "日本へ旅行中", "日本へ旅行に行く"]) {
  const strip = tpc.stripTravelWishSuffix(t);
  const safe = (f) => { try { return f() ?? null; } catch (e) { return `THROW ${e?.message}`; } };
  out(`INFO t-probe 「${t}」 strip=${JSON.stringify(strip)} resolve(full)=${JSON.stringify(safe(() => tpc.resolveDestinationFromText(t)))} resolve(strip)=${JSON.stringify(safe(() => tpc.resolveDestinationFromText(strip)))} parse=${JSON.stringify(safe(() => tpc.parseDestinationFromText(t)))} cands=${JSON.stringify(safe(() => tls.travelDestinationCandidates(t)))} nonPlace(full)=${safe(() => tpc.isNonPlaceDestinationText(t))} merge=${JSON.stringify(merge(CTX.empty(), t))}`);
}

out(`\nSUMMARY pass=${passes} fail=${failures.length}`);
out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
