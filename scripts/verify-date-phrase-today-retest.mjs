import "./verify-netguard-full.mjs";
/**
 * D1 (tester, pre-release retest): 「從今天開始玩3天」「改成今天到週五」 (+ en / ja / ko equivalents and controls).
 * Time is pinned with a fake Date (never the real day). Each case runs for several "today" values
 * (Mon / Wed / Fri / Sat / Sun / month end / year end).
 *  P) pure: parseTravelContextFromText + mergeTravelContext on (A) an empty session, (B) a dated trip
 *     12/10–12/14 with no pending question, (C) the same trip with a combination_choice pending question.
 *  A) App order turn (harness slice of verify-m16-post-selection-switch-review.mjs, same as verify-m19 d):
 *     stages new / nodate (destination, no dates) / choosing / picked / done. Checks travelContext,
 *     session tripStartDate/tripEndDate/tripDays, resolveTripCreateDates (what the trip is created with)
 *     and the dates shown in the reply.
 * Network: global fetch, http(s).request/get, net.connect/createConnection, tls.connect are replaced;
 * any call is counted and fails the run.
 * D2b: en / ko phrases and controls are required (no "unsupported" pass-through); D) destination probe checks a
 * no-date "trip to Sydney" first turn sets the destination in every locale, and the A/nodate stage base must have it.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=240 scripts/verify-date-phrase-today-retest.mjs [-- --skip-app] [--days=mon,fri]
 */
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const argv = process.argv.slice(2);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 230s"); process.exit(3); }, 230_000).unref();

// ------------------------------------------------------------------ network guard
const netCalls = [];
const deny = (kind) => (...a) => { netCalls.push(`${kind} ${String(a[0]?.href ?? a[0]?.host ?? a[0]).slice(0, 80)}`); throw new Error(`NO_NETWORK ${kind}`); };
globalThis.fetch = async (...a) => deny("fetch")(...a);
for (const [mod, name] of [[http, "http"], [https, "https"]]) { mod.request = deny(`${name}.request`); mod.get = deny(`${name}.get`); }
net.connect = deny("net.connect"); net.createConnection = deny("net.createConnection"); tls.connect = deny("tls.connect");

// ------------------------------------------------------------------ fake clock
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
const createDates = await load("src/lib/ai/resolve-trip-create-dates.ts");

// ------------------------------------------------------------------ helpers
const DAY = 86_400_000;
const toMs = (iso) => { const [y, m, d] = iso.split("-").map(Number); return RealDate.UTC(y, m - 1, d); };
const addDays = (iso, n) => new RealDate(toMs(iso) + n * DAY).toISOString().slice(0, 10);
const dow = (iso) => new RealDate(toMs(iso)).getUTCDay();
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const TODAYS = {
  mon: "2026-11-16", wed: "2026-11-11", fri: "2026-11-13", sat: "2026-11-14", sun: "2026-11-15",
  monEnd: "2026-11-30", thuYearEnd: "2026-12-31",
};
const dayFilter = argv.find((a) => a.startsWith("--days="))?.slice(7).split(",");
const todayKeys = Object.keys(TODAYS).filter((k) => !dayFilter || dayFilter.includes(k));

// kind: "d3" (today + 3 days), "fri" (today .. nearest Friday), "keep" (control; never a trip date)
// D2b: en / ko are required (same expectations as zh-TW / ja); no locale is "unsupported" any more.
const PHRASES = [
  ["zh-TW", "從今天開始玩3天", "d3"],
  ["zh-TW", "改成今天到週五", "fri"],
  ["en", "starting today for 3 days", "d3"],
  ["en", "from today for 3 days", "d3"],
  ["en", "change it to today through Friday", "fri"],
  ["en", "change to today until Friday", "fri"],
  ["ja", "今日から3日間", "d3"],
  ["ja", "今日から金曜日までに変更", "fri"],
  ["ko", "오늘부터 3일", "d3"],
  ["ko", "오늘부터 3일 동안", "d3"],
  ["ko", "오늘부터 금요일까지로 바꿔줘", "fri"],
  ["ko", "오늘부터 금요일까지", "fri"],
  ["zh-TW", "今天天氣如何", "keep"],
  ["zh-TW", "今天到底要去哪", "keep"],
  ["en", "what's the weather today", "keep"],
  ["en", "will it rain tomorrow", "keep"],
  ["en", "where should we go today", "keep"],
  ["ko", "오늘 날씨 어때", "keep"],
  ["ko", "오늘 어디 가지", "keep"],
];
const OLD = { start: "2026-12-10", end: "2026-12-14", days: 5 };
const expected = (kind, today) => {
  if (kind === "d3") return { start: today, end: addDays(today, 2), days: 3 };
  if (kind === "fri") { const off = (5 - dow(today) + 7) % 7; return { start: today, end: addDays(today, off), days: off + 1 }; }
  return null;
};

const failures = [];
const notes = [];
const table = [];
const unsupported = new Set();
const extraFails = [];

/** Judge one observed {start,end,days} for a phrase. Returns { verdict, why }. */
function judge({ kind, locale, today, hasDates, obs }) {
  const exp = expected(kind, today);
  if (kind === "keep") {
    const want = hasDates ? OLD : { start: null, end: null, days: null };
    const ok = obs.start === want.start && obs.end === want.end && (!hasDates || obs.days === want.days);
    return ok ? { verdict: "PASS" } : { verdict: "FAIL", why: `control changed dates: want ${want.start}~${want.end}/${want.days}` };
  }
  const exact = obs.start === exp.start && obs.end === exp.end && obs.days === exp.days;
  if (exact) return { verdict: "PASS" };
  // New chat without dates, Friday wording: start today with no end is acceptable.
  if (kind === "fri" && !hasDates && obs.start === exp.start && obs.end == null) return { verdict: "PASS", why: "start only (allowed for new chat)" };
  const untouched = hasDates ? obs.start === OLD.start && obs.end === OLD.end : obs.start == null && obs.end == null;
  return { verdict: "FAIL", why: `${untouched ? "not parsed as a date; " : ""}want ${exp.start}~${exp.end}/${exp.days}` };
}

const VERBOSE = argv.includes("--verbose");
const record = (layer, ctxName, todayKey, locale, t, kind, hasDates, obs, extra = "") => {
  const today = TODAYS[todayKey];
  const j = judge({ kind, locale, today, hasDates, obs });
  const key = `${layer}|${ctxName}|${todayKey}(${today} 週${WD[dow(today)]})|${locale}|${t}`;
  table.push({ key, layer, ctxName, todayKey, locale, t, kind, hasDates, obs, extra, ...j });
  if (VERBOSE) out(`${j.verdict.padEnd(11)} ${key} -> start=${obs.start} end=${obs.end} days=${obs.days}${obs.prov ? ` prov=${obs.prov}` : ""}${j.why ? ` [${j.why}]` : ""}${extra}`);
};
/** All phrases are required (D2b). `unsupported` only lists phrases never read as today anywhere (diagnostic; they still FAIL). */
const finalize = () => {
  const supported = new Set(table.filter((r) => r.kind !== "keep" && r.obs.start === TODAYS[r.todayKey]).map((r) => `${r.locale}|${r.t}`));
  for (const r of table) if (r.kind !== "keep" && !supported.has(`${r.locale}|${r.t}`)) unsupported.add(`${r.locale} 「${r.t}」`);
  for (const r of table) if (r.verdict === "FAIL") failures.push(r.key);
};
const cell = (r) => `${r.obs.start ? r.obs.start.slice(5) : "-"}~${r.obs.end ? r.obs.end.slice(5) : "-"}/${r.obs.days ?? "-"}${{ PASS: "", FAIL: " X", UNSUPPORTED: " u" }[r.verdict]}`;

// ------------------------------------------------------------------ P) pure
const datedTc = (pending) => ({
  ...sessionMod.createEmptySession(),
  tripStartDate: OLD.start, tripEndDate: OLD.end, tripDays: OLD.days,
  travelContext: { interests: [], destination: "雪梨", destinationCountry: "Australia", startDate: OLD.start, endDate: OLD.end, days: OLD.days,
    dateProvenance: { source: "user_date", confirmed: true, startDate: OLD.start, endDate: OLD.end }, planningDaysConfirmed: true },
  ...(pending ? { pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: "雪梨" } } : {}),
});
const PURE_CTX = { A_empty: () => sessionMod.createEmptySession(), B_dated: () => datedTc(false), C_datedPending: () => datedTc(true) };
for (const tk of todayKeys) {
  setToday(TODAYS[tk]);
  for (const [locale, t, kind] of PHRASES) for (const [cn, mk] of Object.entries(PURE_CTX)) {
    const s = mk();
    let obs;
    try {
      const merged = travelContext.mergeTravelContext(s, t).context;
      obs = { start: merged.startDate ?? null, end: merged.endDate ?? null, days: merged.days ?? null,
        prov: merged.dateProvenance ? `${merged.dateProvenance.source}/${merged.dateProvenance.confirmed}` : null };
    } catch (e) { obs = { start: `THROW ${String(e?.message ?? e).slice(0, 60)}`, end: null, days: null }; }
    record("P", cn, tk, locale, t, kind, cn !== "A_empty", obs);
  }
}

// ------------------------------------------------------------------ A) App-order turns
if (!argv.includes("--skip-app")) {
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  if (from < 0 || to < 0) { out("FAIL harness slice not found"); process.exit(2); }
  // D2b harness sync: _app.chat.tsx:13206-13239 now asks for the destination (buildDestinationPlanningClarify, no
  // pendingQuestion change) when the post-discovery duration check fails with no destination; the m16 slice still
  // emitted a "這趟" ask_days question there, which fabricated an ask_days state with no destination.
  const OLD_13058 = 'return dateQuestion("13058");';
  let slice = HARNESS_SRC.slice(from, to);
  if (!slice.includes(OLD_13058)) { out("FAIL harness 13058 branch not found (m16 slice changed)"); process.exit(2); }
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice +
    "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, NAME, generatedDone, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);

  // ---------------------------------------------------------------- D) destination probe (D2b item 2)
  // Does a no-date "trip to Sydney" sentence set the destination on the first App-order turn? Must pass for
  // every locale; the A/nodate stage below is only meaningful when it does.
  const tpcMod = await load("src/lib/ai/trip-planning-context.ts");
  const gpcMod = await loadOpt("src/lib/ai/global-planning-context.ts");
  const SYD = /sydney|雪梨|シドニー|시드니/i;
  const DEST_PROBE = [
    ["zh-TW", "我要去雪梨"], ["zh-TW", "我想去雪梨旅行"], ["zh-TW", "雪梨旅行"],
    ["en", "I'm going to Sydney"], ["en", "trip to Sydney"],
    ["ja", "シドニーへ旅行"], ["ja", "シドニーに旅行"], ["ja", "シドニー旅行"], ["ja", "シドニーに行きたい"], ["ja", "12/10-12/14 シドニーへ旅行"],
    ["ko", "시드니 여행"], ["ko", "시드니에 가고 싶어"],
  ];
  out("\n==== DEST PROBE (first App-order turn on an empty session) ====");
  setToday(TODAYS.mon);
  for (const [locale, t] of DEST_PROBE) {
    H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
    let r; try { r = await H.first(t, locale); } catch (e) { r = { s: sessionMod.createEmptySession(), row: { branch: `THROW ${String(e?.message ?? e).slice(0, 80)}`, reply: "" } }; }
    const tc = r.s.travelContext ?? {};
    let pureDest = null; let pureCand = null; let parsed = null; let gpc = null;
    try { const m = travelContext.mergeTravelContext(sessionMod.createEmptySession(), t).context; pureDest = m.destination ?? null; pureCand = m.destinationCandidate ? `${m.destinationCandidate.raw}/${m.destinationCandidate.status}` : null; } catch (e) { pureDest = `THROW ${String(e?.message ?? e).slice(0, 40)}`; }
    try { parsed = tpcMod.parseDestinationFromText?.(t) ?? null; } catch { parsed = "THROW"; }
    try { gpc = gpcMod?.globalPlanningTurn?.(sessionMod.createEmptySession(), t)?.destinationCandidate?.raw ?? null; } catch { gpc = "THROW"; }
    const ok = SYD.test(tc.destination ?? "") || SYD.test(r.s.tripDestination?.city ?? "");
    out(`${ok ? "PASS" : "FAIL"} dest ${locale} 「${t}」 -> app.dest=${tc.destination ?? null} trip=${r.s.tripDestination?.city ?? null} pending=${r.s.pendingQuestion?.type ?? "-"} branch=${r.row.branch}`
      + ` | pure.merge.dest=${pureDest} cand=${pureCand} parseDestinationFromText=${JSON.stringify(parsed)} globalPlanningTurn.raw=${gpc} | ${(r.row.reply ?? "").replace(/\n/g, " / ").slice(0, 90)}`);
    if (!ok) failures.push(`DEST|${locale}|${t}`);
  }

  const MD = (iso) => iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : null;
  const replyDates = (reply) => {
    const r = reply ?? "";
    const found = new Set();
    for (const m of r.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) found.add(`${Number(m[2])}/${Number(m[3])}`);
    for (const m of r.matchAll(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g)) found.add(`${Number(m[1])}/${Number(m[2])}`);
    for (const m of r.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日號号]/g)) found.add(`${Number(m[1])}/${Number(m[2])}`);
    for (const m of r.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) found.add(`${Number(m[1])}/${Number(m[2])}`);
    const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    for (const m of r.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b/gi)) found.add(`${MON.indexOf(m[1].slice(0, 3).toLowerCase()) + 1}/${Number(m[2])}`);
    return [...found];
  };
  const STAGES = ["new", "nodate", "choosing", "picked", "done"];
  for (const tk of todayKeys) {
    setToday(TODAYS[tk]);
    for (const locale of ["zh-TW", "en", "ja", "ko"]) {
      const place = H.NAME[locale].sydney;
      const base = async (stage) => {
        H.freshAll(); await H.freshAuthority(); H.setLocale(locale);
        if (stage === "new") return sessionMod.createEmptySession();
        if (stage === "nodate") return (await H.first(H.NODATE[locale](place), locale)).s;
        const s = (await H.first(H.STEP1[locale](place), locale)).s;
        if (stage === "choosing") return s;
        const picked = (await H.appTurn(s, "1", locale)).s;
        return stage === "picked" ? picked : H.generatedDone(picked, "sydney");
      };
      for (const stage of STAGES) {
        const s0 = await base(stage);
        const before = { start: s0.travelContext?.startDate ?? null, end: s0.travelContext?.endDate ?? null };
        const hasDates = stage !== "new" && stage !== "nodate";
        if (hasDates && (before.start !== OLD.start || before.end !== OLD.end)) notes.push(`stage ${stage}/${locale}/${tk} did not start from 12/10-12/14 (${before.start}~${before.end})`);
        if (!hasDates && (before.start || before.end)) notes.push(`stage ${stage}/${locale}/${tk} unexpectedly dated (${before.start}~${before.end})`);
        // D2b: the nodate stage must really carry the destination (otherwise it tests "no destination, no date").
        if (stage === "nodate" && !SYD.test(s0.travelContext?.destination ?? "") && !SYD.test(s0.tripDestination?.city ?? "")) {
          const k = `NODATE-BASE|${locale}|${tk}`;
          failures.push(k);
          const note = `NODATE-BASE|${locale} 「${H.NODATE[locale](place)}」 no destination (dest=${s0.travelContext?.destination ?? null} pending=${s0.pendingQuestion?.type ?? "-"})`;
          if (!notes.includes(note)) notes.push(note);
        }
        for (const [pl, t, kind] of PHRASES) {
          if (pl !== locale) continue;
          let r;
          try { r = await H.appTurn(structuredClone(s0), t, locale); }
          catch (e) { r = { s: s0, row: { branch: `THROW ${String(e?.message ?? e).slice(0, 80)}`, reply: "" } }; }
          const s = r.s; const tc = s.travelContext ?? {};
          const obs = { start: tc.startDate ?? null, end: tc.endDate ?? null, days: tc.days ?? s.tripDays ?? null,
            prov: tc.dateProvenance ? `${tc.dateProvenance.source}/${tc.dateProvenance.confirmed}` : null };
          const extras = [];
          // Session top-level copies (persisted with the chat session).
          if ((s.tripStartDate ?? null) !== null || (s.tripEndDate ?? null) !== null) {
            if ((s.tripStartDate && s.tripStartDate !== obs.start) || (s.tripEndDate && s.tripEndDate !== obs.end) || (s.tripDays && obs.days && s.tripDays !== obs.days))
              extras.push(`SESSION-MISMATCH trip=${s.tripStartDate}~${s.tripEndDate}/${s.tripDays}`);
          }
          // What a trip created now would use.
          let created = null;
          try { created = createDates.resolveTripCreateDates({ context: tc, session: s, days: tc.days ?? s.tripDays ?? 1 }); } catch { /* ignore */ }
          const exp = expected(kind, TODAYS[tk]) ?? (hasDates ? OLD : null);
          if (exp && created?.startDate && (created.startDate !== exp.start || created.endDate !== exp.end || created.days !== exp.days))
            extras.push(`CREATE-MISMATCH create=${created.startDate}~${created.endDate}/${created.days}`);
          // Dates shown in the reply.
          const shown = replyDates(r.row.reply);
          const allowed = new Set([MD(exp?.start), MD(exp?.end)].filter(Boolean));
          const badShown = shown.filter((d) => !allowed.has(d));
          if (exp && shown.length && badShown.length) extras.push(`REPLY-DATES ${shown.join(",")} (unexpected ${badShown.join(",")})`);
          const judged = judge({ kind, locale, today: TODAYS[tk], hasDates, obs });
          const extraStr = ` branch=${r.row.branch} pending=${s.pendingQuestion?.type ?? "-"} create=${created ? `${created.startDate}~${created.endDate}/${created.days}` : "-"} shown=[${shown.join(",")}]${extras.length ? ` !! ${extras.join(" ; ")}` : ""} | ${(r.row.reply ?? "").slice(0, 110)}`;
          record("A", stage, tk, locale, t, kind, hasDates, obs, extraStr);
          if (judged.verdict !== "FAIL" && judged.verdict !== "UNSUPPORTED" && extras.length) {
            failures.push(`A|${stage}|${tk}|${locale}|${t} ${extras.join(" ; ")}`);
            extraFails.push(`A|${stage}|${tk}|${locale}|${t} ${extras.join(" ; ")} | branch=${r.row.branch} | ${(r.row.reply ?? "").slice(0, 160)}`);
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ summary
finalize();
out(`\n==== GRID: cell = start~end/days (MM-DD); X = FAIL, u = unsupported ====`);
out(`TODAY: ${todayKeys.map((k) => `${k}=${TODAYS[k]}(週${WD[dow(TODAYS[k])]})`).join("  ")}`);
const rows = new Map();
for (const r of table) { const k = `${r.layer}|${r.ctxName}|${r.locale}|${r.t}`; if (!rows.has(k)) rows.set(k, {}); rows.get(k)[r.todayKey] = r; }
// Default: grid rows that contain a non-PASS cell only (all-PASS rows are summarised in "verdict counts"); --print=P,A for all.
const PRINT = argv.find((a) => a.startsWith("--print="))?.slice(8).split(",") ?? ["failgrid", "fail", "extra"];
for (const [k, m] of rows) {
  const anyBad = Object.values(m).some((r) => r.verdict !== "PASS");
  if (PRINT.includes(k.split("|")[0]) || (PRINT.includes("failgrid") && anyBad)) out(`${k.padEnd(46)} ${todayKeys.map((tk) => (m[tk] ? cell(m[tk]) : "n/a").padEnd(19)).join(" ")}`);
}
out("\n==== FAIL details (first per layer|ctx|phrase) ====");
const seen = new Set();
for (const r of table) {
  if (r.verdict !== "FAIL" || !PRINT.includes("fail")) continue;
  const k =`${r.layer}|${r.ctxName}|${r.locale}|${r.t}`;
  const n = table.filter((x) => x.verdict === "FAIL" && `${x.layer}|${x.ctxName}|${x.locale}|${x.t}` === k).length;
  if (seen.has(k)) continue; seen.add(k);
  if (seen.size > 12) continue;
  out(`FAIL ${r.key} (x${n}) -> ${r.obs.start}~${r.obs.end}/${r.obs.days} [${r.why}]${r.extra ? ` ${r.extra.slice(0, 120)}` : ""}`);
}
if (seen.size > 12) out(`... ${seen.size - 12} more FAIL groups (see grid / verdict counts)`);
out(`\n==== FAIL-EXTRA (dates right, but session copy / trip create / reply text wrong): ${extraFails.length} ====`);
if (PRINT.includes("extra")) for (const x of extraFails.slice(0, 40)) out(`FAIL-EXTRA ${x}`);
// D2b: compact per-phrase result for en / ko (distinct observed start~end/days per context; T = varies by today).
out("\n==== EN/KO CASES (layer phrase -> ctx=observed start~end/days [verdicts]) ====");
{
  const by = new Map();
  for (const r of table) {
    if (r.locale !== "en" && r.locale !== "ko") continue;
    const k = `${r.layer} ${r.locale} 「${r.t}」`;
    if (!by.has(k)) by.set(k, new Map());
    const m = by.get(k);
    if (!m.has(r.ctxName)) m.set(r.ctxName, { cells: new Set(), v: new Set() });
    m.get(r.ctxName).cells.add(`${r.obs.start ?? "-"}~${r.obs.end ?? "-"}/${r.obs.days ?? "-"}`); m.get(r.ctxName).v.add(r.verdict);
  }
  for (const [k, m] of by) out(`${k} -> ${[...m].map(([c, x]) => `${c}=${x.cells.size === 1 ? [...x.cells][0] : `T(${[...x.cells].slice(0, 2).join("|")}…)`}[${[...x.v].join("/")}]`).join(" ")}`);
}
out("\n==== verdict counts ====");
const agg = {};
for (const r of table) { const k = `${r.layer} ${r.locale} 「${r.t}」`; agg[k] ??= {}; agg[k][r.verdict] = (agg[k][r.verdict] ?? 0) + 1; }
for (const [k, v] of Object.entries(agg)) out(`${k}: ${JSON.stringify(v)}`);
for (const n of notes) out(`NOTE ${n}`);
out(`UNSUPPORTED: ${[...unsupported].join(" / ") || "none"}`);
if (netCalls.length) { failures.push("network"); out(`FAIL network calls ${netCalls.length}: ${netCalls.slice(0, 5).join(" | ")}`); }
else out("network calls: 0");
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
// Flush stdout before exiting (a piped stdout is async on macOS; a bare process.exit truncated long output).
process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
