import "./verify-netguard-full.mjs";
/**
 * D11 (tester, independent round-5 review). W (working tree) vs H (HEAD snapshot via --head-dir, spawned child).
 *  B1) candidate confirmation: negation + separator + non-place = bare no (cleared, city re-asked, geocode 0);
 *      corrections still take the new city, incl. less-known cities (熱海／Atami／別府／Beppu／日光).
 *  B2) exclusion vs 「以外にも」 (pure parse + App new turn).
 *  B3) seed → no → days: dest null, reply never names the dropped candidate (4 locales); GPS city kept.
 *  B4) day count: ordinal days are no length; core length phrases unchanged; 「十二天」 recorded only.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d11.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 570s"); process.exit(3); }, 570_000).unref();

const RealDate = Date;
const NOW = new RealDate("2026-11-16T10:00:00").getTime();
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FakeDate;
const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);

// B4 [text, expected | "REC" (record only)]
const DAYS = [
  ["3天", 3], ["三天", 3], ["十天", 10], ["3日間", 3], ["5天4夜", 5], ["3 days", 3], ["3일", 3], ["3일간", 3], ["3박 4일", 4], ["2박3일", 3],
  ["2일째", null], ["3일째", null], ["2일째에 바다", null], ["여행 3일째", null], ["第十二天", null], ["第十天", null], ["第3天", null], ["3日目", null],
  ["十二天", "REC"],
];
const EXCL = [
  ["ja", "東京以外にも京都に行きたい", "京都"],
  ["zh-TW", "京都以外", null], ["ja", "京都以外", null], ["ja", "京都以外で", null], ["zh-TW", "京都不要", null], ["ja", "京都はやめて", null],
];
const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const SEED_RE = /草津|Kusatsu|오키나와|沖縄|Okinawa|쿠사츠|由布院/i;
// B1 bare negations (required + self-composed)
const BARE = {
  "zh-TW": ["不是，我再想想", "不是啦，等等", "不是，先不要", "不是，還沒決定", "不要，我再看看", "不對，等一下"],
  en: ["no thanks", "no, not yet", "nah, later", "no, maybe later", "nope, still thinking", "no, wait"],
  ja: ["いいえ、大丈夫です", "いや、まだ決めてない", "いいえ、まだです", "いや、ちょっと待って", "ううん、まだ"],
  ko: ["아니요, 아직 몰라요", "아니, 잠깐만", "아니요, 나중에요", "아니, 아직이요"],
};
// B1 corrections [text, target regex]
const OSAKA = /大阪|Osaka|오사카/i, ATAMI = /熱海|Atami|아타미/i, BEPPU = /別府|Beppu|벳푸/i, NIKKO = /日光|Nikko|닛코/i;
const CORR = {
  "zh-TW": [["不是，是大阪", OSAKA], ["不是京都，是大阪", OSAKA], ["不是，是熱海", ATAMI], ["不是，熱海", ATAMI], ["不是草津，是熱海", ATAMI], ["不是，是別府", BEPPU], ["不是，是日光", NIKKO]],
  en: [["no, Osaka", OSAKA], ["no, Atami", ATAMI], ["nope, it's Atami", ATAMI], ["no, Beppu", BEPPU], ["no, Nikko", NIKKO]],
  ja: [["いいえ、大阪です", OSAKA], ["いいえ、熱海です", ATAMI], ["いや、熱海", ATAMI], ["いいえ、別府です", BEPPU]],
  ko: [["아니요, 오사카요", OSAKA], ["아니요, 아타미요", ATAMI], ["아니, 벳푸", BEPPU]],
};
const NO = { "zh-TW": "不是", en: "no", ja: "いいえ", ko: "아니요" };
const FOLLOW = { "zh-TW": ["3天"], en: ["3 days"], ja: ["3日間"], ko: ["3일"] };
const GPS = { lat: 25.033, lng: 121.5654, city: "台北市", country: "Taiwan", displayLabel: "台灣・台北市" };

async function collect() {
  const R = {};
  const dur = await load("src/lib/parse-chinese-duration.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const OLD_13058 = 'return dateQuestion("13058");';
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  slice = slice.replace("  kamakura: { re: /kamakura", '  osaka: { re: /osaka|大阪|오사카/i, city: "Osaka", region: "Osaka", country: "Japan", code: "JP", lat: 34.6937, lng: 135.5023 },\n  kamakura: { re: /kamakura')
    .replace('kamakura: ["Kamakura"', 'osaka: ["Osaka", "大阪", "大阪市", "오사카"], kamakura: ["Kamakura"');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const geoCount = () => H.geocodeLog.length + H.authorityGeocodeLog.length + H.discoveryGeocodeLog.length;
  const geoQ = () => [...H.geocodeLog, ...H.authorityGeocodeLog, ...H.discoveryGeocodeLog];
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      area: s.preferredArea ?? null, tpcDest: s.tripPlanningContext?.destination ?? null, cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      days: tc.days ?? s.tripDays ?? null, loc: s.location ? `${s.location.city ?? "-"}@${s.location.lat},${s.location.lng}` : null,
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 140) };
  };
  const turnS = async (s0, t, loc) => {
    const g0 = geoCount(); const q0 = geoQ().length;
    try { const r = await H.appTurn(structuredClone(s0), t, loc); return { row: { ...snap(r), geo: geoCount() - g0, q: geoQ().slice(q0).join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }, s: null }; }
  };
  const LOCS = ["zh-TW", "en", "ja", "ko"];

  for (const [t] of DAYS) { try { R[`N|${t}`] = dur.parseDayCountFromText(t) ?? null; } catch (e) { R[`N|${t}`] = `THROW ${e?.message}`; } }
  for (const [loc, t] of EXCL) {
    let p; try { p = tpc.parseDestinationFromText(t) ?? null; } catch (e) { p = `THROW ${e?.message}`; }
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const a = await turnS(sessionMod.createEmptySession(), t, loc);
    R[`X|${loc}|${t}`] = { p, app: a.row };
  }
  const seedFor = async (loc, base) => {
    for (const t of CAND_SEED[loc]) {
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      let r; try { r = await H.appTurn(structuredClone(base), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: r.s };
    }
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...base, lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };
  for (const loc of LOCS) {
    const { seed, s1 } = await seedFor(loc, sessionMod.createEmptySession());
    R[`S|${loc}`] = { seed, row: snap({ s: s1, row: {} }) };
    for (const t of BARE[loc]) {
      let g; try { const x = gpc.globalPlanningTurn(structuredClone(s1), t); g = x === undefined ? "undefined" : `dest=${x.destination ?? "-"} cand=${x.destinationCandidate?.raw ?? "-"}`; } catch (e) { g = `THROW ${e?.message}`; }
      R[`B|${loc}|${t}`] = { ...(await turnS(s1, t, loc)).row, g };
    }
    for (const [t] of CORR[loc]) R[`C|${loc}|${t}`] = (await turnS(s1, t, loc)).row;
    // B3 seed → no → days
    const n1 = await turnS(s1, NO[loc], loc);
    R[`F|${loc}|no`] = n1.row;
    if (n1.s) for (const f of FOLLOW[loc]) {
      const f1 = await turnS(n1.s, f, loc);
      R[`F|${loc}|${f}`] = f1.row;
      if (f1.s) R[`F|${loc}|${f}|then`] = (await turnS(f1.s, loc === "ko" ? "추천해줘" : loc === "ja" ? "おすすめは？" : loc === "en" ? "any suggestions?" : "推薦一下", loc)).row;
    }
    // B3 GPS (a) GPS city present at confirmation time (different from the candidate) — injected
    const gA = { ...structuredClone(s1), location: { ...GPS } };
    const gA1 = await turnS(gA, NO[loc], loc);
    R[`G|${loc}|injected`] = gA1.row;
    // B3 GPS (b) realistic: GPS session → seed → no (does the seed turn already overwrite location.city?)
    const { seed: seedB, s1: sB } = await seedFor(loc, { ...sessionMod.createEmptySession(), location: { ...GPS } });
    R[`G|${loc}|flowSeed`] = { seed: seedB, row: snap({ s: sB, row: {} }) };
    const gB1 = await turnS(sB, NO[loc], loc);
    R[`G|${loc}|flowNo`] = gB1.row;
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D11_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d11.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D11_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} area=${x.area} tpc=${x.tpcDest} cand=${x.cand ?? "-"} days=${x.days ?? "-"} loc=${x.loc ?? "-"}${x.g ? ` g=${x.g}` : ""}${x.geo != null ? ` geo=${x.geo}${x.q ? `(${x.q})` : ""}` : ""} | ${x.reply ?? ""}`;
  const VERBOSE = argv.includes("--verbose");
  const show = (tag, label, w, h) => { out(`${tag.padEnd(5)} ${label}`); if (!VERBOSE && tag === "ok") return; out(`    W ${fa(w)}`); if (HR) out(`    H ${fa(h)}`); };

  out("==== B4) day count ====");
  for (const [t, want] of DAYS) {
    const w = WR[`N|${t}`]; const h = HR?.[`N|${t}`];
    if (want === "REC") { notes.push(`「${t}」 W=${w} H=${h}`); out(`REC   「${t}」 W=${w}${HR ? ` H=${h}` : ""}`); continue; }
    const ok = w === want;
    if (!ok) fail(`N|${t}`, `want ${want} got ${w} (HEAD ${h})`);
    out(`${ok ? "ok   " : "BAD  "} 「${t}」 W=${w}${HR ? ` H=${h}` : ""}`);
  }

  out("\n==== B2) exclusion vs 以外にも ====");
  for (const [loc, t, want] of EXCL) {
    const w = WR[`X|${loc}|${t}`]; const h = HR?.[`X|${loc}|${t}`];
    const vals = (x) => [x?.p, x?.app?.dest, x?.app?.trip, x?.app?.cand?.split("/")[0]].filter(Boolean).map(String);
    let ok;
    if (want === null) ok = !vals(w).some((v) => /京都|Kyoto|교토/i.test(v));
    else ok = vals(w).some((v) => v === "京都" || v === "京都市" || v === "Kyoto") && !vals(w).some((v) => /以外|行きたい/.test(v));
    if (!ok) fail(`X|${loc}|${t}`, `want ${want}: ${JSON.stringify(vals(w))}`);
    out(`${ok ? "ok   " : "BAD  "} ${loc} 「${t}」 want=${want} W parse=${w?.p} dest=${w?.app?.dest} cand=${w?.app?.cand ?? "-"}${HR ? ` | H parse=${h?.p} dest=${h?.app?.dest}` : ""}`);
  }

  out("\n==== B1) candidate confirmation ====");
  const NEGWORD = /不是|不要|不對|沒有|いいえ|いや|ううん|아니|^no\b|nope|nah|thanks|later|wait|yet|thinking|再想想|等等|等一下|先不要|決定|再看看|大丈夫|決めて|まだ|待って|몰라|잠깐|나중|아직/i;
  for (const loc of ["zh-TW", "en", "ja", "ko"]) {
    out(`-- ${loc} seed W=${WR[`S|${loc}`]?.seed} H=${HR?.[`S|${loc}`]?.seed ?? "n/a"}  W seedRow ${fa(WR[`S|${loc}`]?.row)}`);
    for (const t of BARE[loc]) {
      const w = WR[`B|${loc}|${t}`]; const h = HR?.[`B|${loc}|${t}`];
      const cleared = w && !w.cand && !w.dest && !w.trip && !w.area && (w.geo ?? 1) === 0;
      const mentions = SEED_RE.test(w?.reply ?? "");
      const ok = cleared && !mentions && /destination_clarification/.test(w?.b ?? "");
      if (!ok) fail(`B1bare|${loc}|${t}`, `not a bare no: ${fa(w)}`);
      show(ok ? "ok" : "BAD", `${loc} bare 「${t}」`, w, h);
    }
    for (const [t, re] of CORR[loc]) {
      const w = WR[`C|${loc}|${t}`]; const h = HR?.[`C|${loc}|${t}`];
      const vals = [w?.dest, w?.trip, w?.cand?.split("/")[0]].filter(Boolean).map(String);
      const ok = vals.some((v) => re.test(v)) && !vals.some((v) => NEGWORD.test(v) || SEED_RE.test(v)) && (w?.geo ?? 0) >= 1;
      if (!ok) fail(`B1corr|${loc}|${t}`, `correction did not take the new city: ${fa(w)}`);
      const areaLeak = w?.area && !re.test(w.area);
      if (ok && areaLeak) notes.push(`B1corr ${loc} 「${t}」 preferredArea=${w.area} (not the new city)`);
      show(ok ? (areaLeak ? "ok*" : "ok") : "BAD", `${loc} corr 「${t}」`, w, h);
    }
  }

  out("\n==== B3) seed → no → days (+ GPS city) ====");
  for (const loc of ["zh-TW", "en", "ja", "ko"]) {
    const n = WR[`F|${loc}|no`];
    show(n && !n.cand && !n.dest && n.geo === 0 ? "ok" : "BAD", `${loc} 「${NO[loc]}」`, n, HR?.[`F|${loc}|no`]);
    if (!(n && !n.cand && !n.dest && n.geo === 0)) fail(`B3no|${loc}`, fa(n));
    for (const f of FOLLOW[loc]) {
      const w = WR[`F|${loc}|${f}`];
      const ok = w && w.dest === null && !w.cand && !w.trip && !SEED_RE.test(w.area ?? "") && !SEED_RE.test(w.reply ?? "") && w.days === 3;
      if (!ok) fail(`B3follow|${loc}|${f}`, fa(w));
      show(ok ? "ok" : "BAD", `${loc} follow 「${f}」`, w, HR?.[`F|${loc}|${f}`]);
      const th = WR[`F|${loc}|${f}|then`];
      const thOk = th && !SEED_RE.test(th.reply ?? "") && !SEED_RE.test(th.dest ?? "") && !SEED_RE.test(th.cand ?? "");
      if (!thOk) fail(`B3then|${loc}`, fa(th));
      show(thOk ? "ok" : "BAD", `${loc} next turn after 「${f}」`, th, HR?.[`F|${loc}|${f}|then`]);
      if (/p7fe9e2ed49/.test(w?.b ?? "")) notes.push(`B3 ${loc} 「${f}」 with no destination answers LAST-RESORT (no-combination copy), not a city question`);
    }
    const gi = WR[`G|${loc}|injected`];
    const giOk = gi && /^台北市@25\.033,121\.5654$/.test(gi.loc ?? "") && !gi.cand && !gi.dest;
    if (!giOk) fail(`B3gps|${loc}|injected`, fa(gi));
    show(giOk ? "ok" : "BAD", `${loc} GPS(台北市) at confirmation → 「${NO[loc]}」`, gi, HR?.[`G|${loc}|injected`]);
    const fs = WR[`G|${loc}|flowSeed`]; const fn = WR[`G|${loc}|flowNo`];
    out(`info  ${loc} GPS flow seed=${fs?.seed} W seedRow loc=${fs?.row?.loc}${HR ? ` H seedRow loc=${HR[`G|${loc}|flowSeed`]?.row?.loc}` : ""}`);
    out(`    W after 「${NO[loc]}」 ${fa(fn)}`);
    if (HR) out(`    H after 「${NO[loc]}」 ${fa(HR[`G|${loc}|flowNo`])}`);
    const latKept = /@25\.033,121\.5654$/.test(fn?.loc ?? "");
    if (!latKept) fail(`B3gps|${loc}|flowLatLng`, `GPS lat/lng lost: ${fn?.loc}`);
    if (fs?.row?.loc && !/^台北市@/.test(fs.row.loc)) notes.push(`B3 GPS ${loc}: seed turn already overwrites location.city → ${fs.row.loc} (HEAD ${HR?.[`G|${loc}|flowSeed`]?.row?.loc ?? "n/a"}); after no W loc=${fn?.loc}`);
  }

  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
