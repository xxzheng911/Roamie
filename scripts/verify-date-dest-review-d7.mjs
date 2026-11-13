import "./verify-netguard-full.mjs";
/**
 * D7 (tester, independent round-3 review). Every section runs on the working tree (W) and, with --head-dir, on the
 * HEAD snapshot (H, spawned child running this same file there) so each row shows W vs H.
 *  S) self-written survey (not in D5 F): weather + trip, weather + trip noun (not a date change), pure weather,
 *     everyday variants, ambiguous. Pure merge on an empty session and a dated Sydney trip, plus App-order turns at
 *     new / picked.
 *  G) destination + N days + relative start (en / ko / ja / zh) at App new / nodate / picked.
 *  T) tomorrow series and other weekdays at new / nodate / choosing / picked / done (today = Mon and Thu / Sun / Wed).
 *  Q) 「今天到底要去哪」 on done: dates, destination and planned stops kept.
 *  Y) yes / no replies on the candidate confirmation (four locales).
 *  I) investigations: 「오늘로 바꿔줘」 on done; 京都旅行 / 北海道旅行 / 沖縄旅行 / zh 京都旅行 / 沖繩旅行; principle 2(b).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d7.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const ONLY = argv.find((a) => a.startsWith("--section="))?.slice(10);
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 570s"); process.exit(3); }, 570_000).unref();

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

const DAY = 86_400_000;
const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return RealDate.UTC(y, m - 1, d); };
const addDays = (iso, n) => new RealDate(toMs(iso) + n * DAY).toISOString().slice(0, 10);
const dow = (iso) => new RealDate(toMs(iso)).getUTCDay();
const TODAYS = { mon: "2026-11-16", thu: "2026-11-12", sun: "2026-11-15", wed: "2026-11-11", fri: "2026-11-13" };
const OLD = { start: "2026-12-10", end: "2026-12-14", days: 5 };

// [id, locale, sentence, tag, offset, days, dest] tag: trip = must set start=today+offset & days; fp = must not set / move; amb = report only.
const SURVEY = [
  ["W1", "zh-TW", "從明天開始玩3天，下雨也可以", "trip", 1, 3],
  ["W2", "zh-TW", "明天開始去東京玩3天，聽說會下雨", "trip", 1, 3, "東京"],
  ["W3", "ja", "明日から3日間京都旅行、雨でも大丈夫", "trip", 1, 3, "京都"],
  ["W4", "en", "rainy or not, starting tomorrow for 3 days", "trip", 1, 3],
  ["W5", "en", "starting today for 3 days even if it rains", "trip", 0, 3],
  ["W6", "ko", "내일부터 3일, 비 와도 괜찮아", "trip", 1, 3],
  ["W7", "ja", "雨でもいいので明日から3日間", "trip", 1, 3],
  ["W8", "zh-TW", "今天天氣不錯，從今天開始玩3天", "trip", 0, 3],
  ["F1", "zh-TW", "明天到週五都會下雨，行程要改嗎", "fp"],
  ["F2", "ja", "明日から金曜日まで雨だけど、旅行は大丈夫？", "fp"],
  ["F3", "en", "it'll be rainy from today through Friday, is the trip still ok?", "fp"],
  ["F4", "ko", "내일부터 금요일까지 비 온대, 여행 괜찮을까?", "fp"],
  ["F5", "en", "Tokyo will be rainy for 3 days starting tomorrow", "fp"],
  ["F6", "zh-TW", "東京從明天開始下雨3天", "fp"],
  ["F7", "ko", "도쿄 내일부터 3일 동안 비 온대", "fp"],
  ["F8", "ja", "明日から3日間、東京は雪らしい", "fp"],
  ["F9", "zh-TW", "今天到週五都要加班", "fp"],
  ["F10", "zh-TW", "從今天起，我要早睡", "fp"],
  ["F11", "zh-TW", "從明天開始玩手機要少一點", "fp"],
  ["F12", "en", "the conference runs from today through Friday", "fp"],
  ["F13", "en", "my friend is traveling from tomorrow for 3 days", "fp"],
  ["F14", "en", "starting tomorrow for 3 days I'm on a diet", "fp"],
  ["F15", "ko", "동생이 내일부터 3일 여행 가", "fp"],
  ["F16", "ko", "내일부터 3일 동안 야근해", "fp"],
  ["F17", "ja", "明日から3日間出張です", "fp"],
  ["F18", "ja", "今日から3日間ダイエットする", "fp"],
  ["F19", "en", "my parents are on vacation starting today", "fp"],
  ["F20", "ko", "오늘부터 금요일까지 출장이야", "fp"],
  ["F21", "ja", "今日から金曜日まで仕事です", "fp"],
  ["F22", "zh-TW", "明天到週五我都在上班", "fp"],
  ["A1", "en", "my business trip starts tomorrow", "amb"],
  ["A2", "ko", "내일 출발하는 거 맞지?", "amb"],
];
const DESTDAYS = [
  ["G1", "en", "starting tomorrow for 3 days in Tokyo", 1, "東京"],
  ["G2", "en", "we'll be in Tokyo from tomorrow for 3 days", 1, "東京"],
  ["G3", "en", "Tokyo for 3 days starting today", 0, "東京"],
  ["G4", "ko", "내일부터 3일 도쿄 갈래", 1, "東京"],
  ["G5", "ko", "오늘부터 3일 동안 도쿄", 0, "東京"],
  ["G6", "ja", "明日から3日間東京に行きたい", 1, "東京"],
  ["G7", "ja", "今日から3日間京都", 0, "京都"],
  ["G8", "zh-TW", "明天開始去東京玩3天", 1, "東京"],
  ["G9", "zh-TW", "從今天開始去京都3天", 0, "京都"],
];
// [locale, phrase, kind] kind: t3 = tomorrow + 3 days; tf = tomorrow .. nearest Fri; ws = today .. nearest Sun; ww = today .. nearest Wed
const TPHRASES = [
  ["zh-TW", "從明天開始玩3天", "t3"], ["zh-TW", "改成明天到週五", "tf"], ["zh-TW", "改成今天到週日", "ws"], ["zh-TW", "改成今天到週三", "ww"],
  ["en", "starting tomorrow for 3 days", "t3"], ["en", "from tomorrow for 3 days", "t3"], ["en", "change it to tomorrow through Friday", "tf"], ["en", "change it to today through Sunday", "ws"], ["en", "change it to today through Wednesday", "ww"],
  ["ja", "明日から3日間", "t3"], ["ja", "明日から金曜日までに変更", "tf"], ["ja", "今日から日曜日までに変更", "ws"], ["ja", "今日から水曜日までに変更", "ww"],
  ["ko", "내일부터 3일", "t3"], ["ko", "내일부터 금요일까지", "tf"], ["ko", "오늘부터 일요일까지", "ws"], ["ko", "오늘부터 수요일까지로 바꿔줘", "ww"],
];
const expectT = (kind, today) => {
  const tm = addDays(today, 1);
  if (kind === "t3") return { start: tm, end: addDays(tm, 2), days: 3 };
  const to = (start, wd) => { const off = (wd - dow(start) + 7) % 7; return { start, end: addDays(start, off), days: off + 1 }; };
  if (kind === "tf") return to(tm, 5);
  if (kind === "ws") return to(today, 0);
  if (kind === "ww") return to(today, 3);
  return null;
};
const YESNO = { ja: ["はい", "いいえ", "うん", "はい、そうです"], ko: ["네", "아니요"], en: ["yes", "no"], "zh-TW": ["是", "好", "對", "不是"] };
const CAND_SEED = { ja: ["沖縄へ旅行に行きたい", "沖縄に行きたい"], ko: ["오키나와 여행", "오키나와에 가고 싶어"], en: ["I want to go to Okinawa", "trip to Okinawa", "I want to go to Hokkaido", "I want to go to Kusatsu Onsen", "I want to go to Hakone", "I want to go to Yufuin", "I want to go to Shirakawa-go", "trip to Kusatsu", "I'm going to Bondi Beach"], "zh-TW": ["我想去北海道", "我想去沖繩玩", "我想去草津溫泉"] };
const KANJI_TRIP = [["ja", "京都旅行"], ["ja", "北海道旅行"], ["ja", "沖縄旅行"], ["zh-TW", "京都旅行"], ["zh-TW", "沖繩旅行"]];
const FOLLOW = { ja: "3日間", "zh-TW": "3天" };
const P2B = ["change it to today through Friday", "switch it to tomorrow for 2 nights", "move it to today through Sunday", "can you change it to tomorrow for 3 days",
  "change to tomorrow for 1 day", "move to today through Friday", "please switch to tomorrow through Monday", "starting today through Friday", "from tomorrow for a day"];

async function collect() {
  const R = {};
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  const OLD_13058 = 'return dateQuestion("13058");';
  let slice = HARNESS_SRC.slice(from, to);
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, NAME, generatedDone, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);

  const dated = () => ({
    ...sessionMod.createEmptySession(), tripStartDate: OLD.start, tripEndDate: OLD.end, tripDays: OLD.days,
    travelContext: { interests: [], destination: "雪梨", destinationCountry: "Australia", startDate: OLD.start, endDate: OLD.end, days: OLD.days,
      dateProvenance: { source: "user_date", confirmed: true, startDate: OLD.start, endDate: OLD.end }, planningDaysConfirmed: true },
  });
  const merge = (s, t) => {
    try { const c = travelContext.mergeTravelContext(s, t).context; return { start: c.startDate ?? null, end: c.endDate ?? null, days: c.days ?? null, dest: c.destination ?? null, cand: c.destinationCandidate?.raw ?? null }; }
    catch (e) { return { error: String(e?.message ?? e).slice(0, 80) }; }
  };
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      start: tc.startDate ?? null, end: tc.endDate ?? null, days: tc.days ?? s.tripDays ?? null,
      sStart: s.tripStartDate ?? null, sEnd: s.tripEndDate ?? null, phase: s.phase ?? null, stops: Array.isArray(s.plannedStops) ? s.plannedStops.length : null,
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 110) };
  };
  const turn = async (s0, t, loc) => { try { return snap(await H.appTurn(structuredClone(s0), t, loc)); } catch (e) { return { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }; } };
  const base = async (stage, loc) => {
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    if (stage === "new") return sessionMod.createEmptySession();
    const place = H.NAME[loc].sydney;
    if (stage === "nodate") return (await H.first(H.NODATE[loc](place), loc)).s;
    const s = (await H.first(H.STEP1[loc](place), loc)).s;
    if (stage === "choosing") return s;
    const picked = (await H.appTurn(s, "1", loc)).s;
    return stage === "picked" ? picked : H.generatedDone(picked, "sydney");
  };
  const LOCS = ["zh-TW", "en", "ja", "ko"];

  if (ONLY === "yi") return collectYI(R, { H, snap, turn, base, merge, dated, sessionMod, LOCS });
  // S) survey — pure (Mon) and App new / picked (Mon)
  setToday(TODAYS.mon);
  for (const [id, , t] of SURVEY) R[`S|pure|${id}`] = { e: merge(sessionMod.createEmptySession(), t), d: merge(dated(), t) };
  for (const loc of LOCS) for (const stage of ["new", "picked"]) {
    const s0 = await base(stage, loc);
    for (const [id, l, t] of SURVEY) if (l === loc) R[`S|app|${stage}|${id}`] = await turn(s0, t, loc);
    for (const [id, l, t] of DESTDAYS) if (l === loc) R[`G|${stage}|${id}`] = await turn(s0, t, loc);
  }
  for (const loc of LOCS) {
    const s0 = await base("nodate", loc);
    for (const [id, l, t] of DESTDAYS) if (l === loc) R[`G|nodate|${id}`] = await turn(s0, t, loc);
  }
  // T) tomorrow series / other weekdays
  for (const tk of ["mon", "thu", "sun", "wed"]) {
    setToday(TODAYS[tk]);
    for (const loc of LOCS) for (const stage of ["new", "nodate", "choosing", "picked", "done"]) {
      const s0 = await base(stage, loc);
      for (const [l, t, kind] of TPHRASES) if (l === loc) R[`T|${tk}|${stage}|${loc}|${t}|${kind}`] = await turn(s0, t, loc);
    }
  }
  // Q) 今天到底要去哪 on done
  setToday(TODAYS.mon);
  {
    const s0 = await base("done", "zh-TW");
    R["Q|before"] = snap({ s: s0, row: {} });
    R["Q|after"] = await turn(s0, "今天到底要去哪", "zh-TW");
  }
  return collectYI(R, { H, snap, turn, base, merge, dated, sessionMod, LOCS });
}

async function collectYI(R, { H, snap, turn, base, merge, dated, sessionMod, LOCS }) {
  setToday(TODAYS.mon);
  // Y) yes / no on the candidate confirmation
  for (const loc of LOCS) {
    let seed = null; let s1 = null;
    for (const t of CAND_SEED[loc]) {
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      let r; try { r = await H.first(t, loc); } catch { continue; }
      R[`Y|seed|${loc}|${t}`] = snap(r);
      if (!seed && r.s.travelContext?.destinationCandidate && r.s.travelContext.destinationCandidate.status !== "resolved") { seed = t; s1 = r.s; }
    }
    R[`Y|seedPicked|${loc}`] = seed;
    if (!s1) continue;
    for (const a of YESNO[loc]) R[`Y|${loc}|${a}`] = await turn(s1, a, loc);
  }
  // I) investigations
  {
    const s0 = await base("done", "ko");
    R["I|ko-today|before"] = snap({ s: s0, row: {} });
    R["I|ko-today|after"] = await turn(s0, "오늘로 바꿔줘", "ko");
  }
  for (const [loc, t] of KANJI_TRIP) {
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    let r; try { r = await H.first(t, loc); } catch (e) { R[`I|kanji|${loc}|${t}`] = { b: `THROW ${e?.message}` }; continue; }
    R[`I|kanji|${loc}|${t}`] = snap(r);
    R[`I|kanji|${loc}|${t}|pure`] = merge(sessionMod.createEmptySession(), t);
    R[`I|kanji|${loc}|${t}|follow`] = await turn(r.s, FOLLOW[loc], loc);
  }
  for (const t of P2B) {
    R[`I|p2b|${t}|pure`] = { e: merge(sessionMod.createEmptySession(), t), d: merge(dated(), t) };
    const s0 = await base("new", "en");
    R[`I|p2b|${t}|app`] = await turn(s0, t, "en");
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D7_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d7.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--section=${ONLY}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D7_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fmt = (x) => !x ? "n/a" : x.error ? `ERR ${x.error}` : `${x.start ?? "-"}~${x.end ?? "-"}/${x.days ?? "-"}${x.dest !== undefined ? ` dest=${x.dest}` : ""}${x.cand ? ` cand=${x.cand}` : ""}`;
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} cand=${x.cand ?? "-"} ${x.start ?? "-"}~${x.end ?? "-"}/${x.days ?? "-"}${x.stops != null ? ` stops=${x.stops}` : ""} | ${x.reply ?? ""}`;
  const mon = TODAYS.mon;

  if (!ONLY) out("==== S) self-written survey (today Mon 2026-11-16; dated = Sydney 12/10-12/14/5) ====");
  for (const [id, loc, t, tag, off, days] of ONLY ? [] : SURVEY) {
    const w = WR[`S|pure|${id}`]; const h = HR?.[`S|pure|${id}`];
    const wa = { new: WR[`S|app|new|${id}`], picked: WR[`S|app|picked|${id}`] };
    const ha = HR ? { new: HR[`S|app|new|${id}`], picked: HR[`S|app|picked|${id}`] } : null;
    const moved = (x) => x && (x.start !== OLD.start || x.end !== OLD.end);
    const setNew = (x) => x && Boolean(x.start);
    let verdict;
    if (tag === "trip") {
      const exp = addDays(mon, off);
      const ok = (x) => x && x.start === exp && x.days === days;
      const okApp = ok(wa.new) && ok(wa.picked);
      verdict = okApp ? "correct" : "MISS(漏判)";
      if (!okApp) {
        // HEAD comparison on the empty session (pure + App new): HEAD set the start date, W does not → regression.
        const headSet = h && h.e.start === exp && (!ha || ha.new?.start === exp || !wa.new?.start);
        const wSet = w.e.start === exp || wa.new?.start === exp;
        const regress = headSet && !wSet ? "REGRESSION vs HEAD (HEAD sets the start on an empty session)" : "HEAD also misses";
        verdict += ` ${regress}`;
        if (headSet && !wSet) fail(`S|${id}`, `${loc} 「${t}」 trip date lost; HEAD sets it`);
      }
    } else if (tag === "fp") {
      const bad = setNew(wa.new) || moved(wa.picked) || setNew(w.e) || moved(w.d);
      verdict = bad ? "FP(誤判)" : "correct";
      if (bad) {
        // pure merge only: the HEAD ja / ko picked base carries no dates, so its App rows cannot show a move.
        const hb = h && (setNew(h.e) || moved(h.d));
        verdict += hb ? " (HEAD also)" : ha ? " (NEW vs HEAD)" : "";
        failures.push(`S|${id}`);
      }
    } else verdict = (setNew(wa.new) || moved(wa.picked)) ? "amb: read as date" : "amb: not read";
    out(`${id} ${tag} ${loc} 「${t}」 => ${verdict}`);
    out(`   W pure empty=${fmt(w.e)} dated=${fmt(w.d)}`);
    out(`   W app new=${fa(wa.new)}`);
    out(`   W app picked=${fa(wa.picked)}`);
    if (h) out(`   H pure empty=${fmt(h.e)} dated=${fmt(h.d)}`);
    if (ha) { out(`   H app new=${fa(ha.new)}`); out(`   H app picked=${fa(ha.picked)}`); }
  }

  if (!ONLY) {
  out("\n==== G) destination + N days + relative start (today Mon; expected start=today+off, days=3) ====");
  for (const [id, loc, t, off, dest] of DESTDAYS) {
    out(`${id} ${loc} 「${t}」 (want start ${addDays(mon, off)} days 3 dest ${dest})`);
    for (const stage of ["new", "nodate", "picked"]) {
      out(`   W ${stage}: ${fa(WR[`G|${stage}|${id}`])}`);
      if (HR) out(`   H ${stage}: ${fa(HR[`G|${stage}|${id}`])}`);
    }
  }

  out("\n==== T) tomorrow series / other weekdays (all stages) ====");
  const tCounts = {};
  for (const [k, x] of Object.entries(WR).filter(([k]) => k.startsWith("T|"))) {
    const [, tk, stage, loc, t, kind] = k.split("|");
    const exp = expectT(kind, TODAYS[tk]);
    const ok = x.start === exp.start && x.end === exp.end && x.days === exp.days
      && (!x.sStart || x.sStart === exp.start) && (!x.sEnd || x.sEnd === exp.end);
    const key = `${loc} 「${t}」`;
    tCounts[key] = tCounts[key] ?? { pass: 0, fail: 0 };
    if (ok) tCounts[key].pass++;
    else {
      tCounts[key].fail++;
      const h = HR?.[k];
      fail(`T|${tk}|${stage}|${loc}|${t}`, `want ${exp.start}~${exp.end}/${exp.days} got ${fa(x)} | HEAD ${h ? `${h.start}~${h.end}/${h.days}` : "n/a"}`);
    }
  }
  for (const [k, c] of Object.entries(tCounts)) out(`T ${k}: pass=${c.pass} fail=${c.fail}`);

  out("\n==== Q) 「今天到底要去哪」 on done ====");
  out(`   before: ${fa(WR["Q|before"])}`);
  out(`   after : ${fa(WR["Q|after"])}`);
  {
    const b = WR["Q|before"]; const a = WR["Q|after"];
    if (!a || a.start !== b.start || a.end !== b.end || a.dest !== b.dest) fail("Q|kept", "dates / destination changed");
    if (HR) out(`   H after: ${fa(HR["Q|after"])}`);
  }
  }

  out("\n==== Y) yes / no on the candidate confirmation ====");
  const YN_RE = /^(?:はい|いいえ|うん|はい、そうです|네|아니요|yes|no|是|好|對|不是)(?:\/|$)/;
  for (const loc of Object.keys(YESNO)) {
    for (const k of Object.keys(WR).filter((k) => k.startsWith(`Y|seed|${loc}|`))) out(`   seed ${k.slice(7)}: ${fa(WR[k])}`);
    out(`   seed used (${loc}): ${WR[`Y|seedPicked|${loc}`] ?? "NONE — no candidate state reached"} | HEAD seed used: ${HR ? (HR[`Y|seedPicked|${loc}`] ?? "NONE") : "n/a"}`);
    if (!WR[`Y|seedPicked|${loc}`]) { out(`UNVERIFIED Y|${loc}: no candidate confirmation state`); continue; }
    for (const a of YESNO[loc]) {
      const x = WR[`Y|${loc}|${a}`]; const h = HR?.[`Y|${loc}|${a}`];
      const bad = (x.cand && YN_RE.test(x.cand)) || (x.dest && YN_RE.test(`${x.dest}`)) || (x.trip && YN_RE.test(`${x.trip}`));
      out(`${bad ? "BAD " : "ok  "} Y ${loc} 「${a}」 W ${fa(x)}`);
      if (h) out(`        H ${fa(h)}`);
      if (bad) fail(`Y|${loc}|${a}`, "yes / no became a destination candidate");
    }
  }

  out("\n==== I) investigations (INFO only) ====");
  out(`   오늘로 바꿔줘 done before: ${fa(WR["I|ko-today|before"])}`);
  out(`   W after: ${fa(WR["I|ko-today|after"])}`);
  if (HR) out(`   H after: ${fa(HR["I|ko-today|after"])}`);
  for (const [loc, t] of KANJI_TRIP) {
    const k = `I|kanji|${loc}|${t}`;
    out(`   ${loc} 「${t}」 W T1 ${fa(WR[k])}`);
    out(`        W pure ${fmt(WR[`${k}|pure`])}  W T2 「${FOLLOW[loc]}」 ${fa(WR[`${k}|follow`])}`);
    if (HR) { out(`        H T1 ${fa(HR[k])}`); out(`        H pure ${fmt(HR[`${k}|pure`])}  H T2 ${fa(HR[`${k}|follow`])}`); }
  }
  for (const t of P2B) {
    const w = WR[`I|p2b|${t}|pure`]; const h = HR?.[`I|p2b|${t}|pure`];
    out(`   2b 「${t}」 W empty=${fmt(w.e)} dated=${fmt(w.d)}${h ? ` | H empty=${fmt(h.e)} dated=${fmt(h.d)}` : ""}`);
    out(`        W app new ${fa(WR[`I|p2b|${t}|app`])}`);
    if (HR) out(`        H app new ${fa(HR[`I|p2b|${t}|app`])}`);
  }

  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
