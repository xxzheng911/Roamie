import "./verify-netguard-full.mjs";
/**
 * D13 (tester, independent round-6 review). W (working tree) vs H (HEAD snapshot via --head-dir, spawned child).
 *  C1) "nah" lead must not swallow Naha: first turn "Naha" / "I want to go to Naha"; at candidate confirmation
 *      "no, Naha" / "Naha" take Naha; "nah, later" / "nah" / "Nah." are bare no (cleared, geocode 0).
 *  C2) correction at candidate confirmation: dest / tripDestination / preferredArea / tripPlanningContext.destination /
 *      location.city never keep the old candidate; a different GPS city (and lat/lng) is kept; direct new-city input
 *      (no negation) and non-place replies do not clear fields they should not clear.
 *  K)  「不是京都，是大阪」 residual: follow 2–3 turns (3天 → 1 → 推薦) and record where 京都 is visible.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d13.mjs -- --head-dir=<snapshot>
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

const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const SEED_RE = /草津|Kusatsu|오키나와|沖縄|Okinawa|쿠사츠|由布院/i;
const OSAKA = /大阪|Osaka|오사카/i;
const NAHA = /那霸|那覇|Naha|나하/i;
const KYOTO = /京都|Kyoto|교토/i;
const GPS = { lat: 25.033, lng: 121.5654, city: "台北市", country: "Taiwan", displayLabel: "台灣・台北市" };
const LOCS = ["zh-TW", "en", "ja", "ko"];

// C1
// first turn: "I want to go to Naha" is required; bare "Naha" / "Naha trip" are recorded with controls (bare unknown city)
const C1_FIRST = ["I want to go to Naha"];
const C1_FIRST_REC = ["Naha", "Naha trip", "Osaka", "Atami"];
const C1_CONF_CITY = ["Naha", "I want to go to Naha"];
// "no, <cold city>": the rest must be extracted (lexical) — taking it is the known cold-city limitation (recorded)
const C1_CONF_COLD = ["no, Naha", "nope, Naha", "no, Nikko"];
// controls: the same negation shape with a known city must take it
const C1_CONF_KNOWN = ["no, Osaka", "nah, Osaka"];
const C1_CONF_BARE = ["nah, later", "nah", "Nah.", "nah thanks", "no, later"];
// answers after the city is re-asked (bare no): known city, cold city, wish form
const RE_ASK = { "zh-TW": ["大阪", "那霸", "熱海", "我想去那霸"], en: ["Osaka", "Naha", "Atami", "Nikko", "I want to go to Naha"], ja: ["大阪", "那覇", "熱海"], ko: ["오사카", "나하", "아타미"] };
// C2 corrections with negation (required) per locale
const C2_NEG = { "zh-TW": ["不是，是大阪"], en: ["no, Osaka"], ja: ["いいえ、大阪です"], ko: ["아니요, 오사카요"] };
// C2 direct new city (no negation)
const C2_DIRECT = { "zh-TW": ["大阪", "我想去大阪"], en: ["Osaka", "I want to go to Osaka"], ja: ["大阪", "大阪に行きたい"], ko: ["오사카", "오사카 여행"] };
// C2 non-place replies at confirmation: must not clear the candidate mirrors
const C2_KEEP = { "zh-TW": ["3天"], en: ["3 days"], ja: ["3日間"], ko: ["3일"] };
const FOLLOW = { "zh-TW": ["3天", "1", "推薦一下"], en: ["3 days", "1", "any suggestions?"], ja: ["3日間", "1", "おすすめは？"], ko: ["3일", "1", "추천해줘"] };

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const OLD_13058 = 'return dateQuestion("13058");';
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  slice = slice.replace("  kamakura: { re: /kamakura",
    '  osaka: { re: /osaka|大阪|오사카/i, city: "Osaka", region: "Osaka", country: "Japan", code: "JP", lat: 34.6937, lng: 135.5023 },\n'
    + '  naha: { re: /naha|那霸|那覇|나하/i, city: "Naha", region: "Okinawa", country: "Japan", code: "JP", lat: 26.2124, lng: 127.6809 },\n  kamakura: { re: /kamakura')
    .replace('kamakura: ["Kamakura"', 'osaka: ["Osaka", "大阪", "大阪市", "오사카"], naha: ["Naha", "那霸市", "那覇市", "나하시"], kamakura: ["Kamakura"');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const geoQ = () => [...H.geocodeLog, ...H.authorityGeocodeLog, ...H.discoveryGeocodeLog];
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, base: s.pendingQuestion?.baseDestination ?? null,
      dest: tc.destination ?? null, city: tc.destinationCity ?? null, trip: s.tripDestination?.city ?? null, tripLabel: s.tripDestination?.formattedName ?? s.tripDestination?.displayLabel ?? null,
      area: s.preferredArea ?? null, tpcDest: s.tripPlanningContext?.destination ?? null, tpcKeys: s.tripPlanningContext ? Object.keys(s.tripPlanningContext).sort().join(",") : null,
      tpcDays: s.tripPlanningContext?.days ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      days: tc.days ?? s.tripDays ?? null, loc: s.location ? `${s.location.city ?? "-"}@${s.location.lat},${s.location.lng}` : null,
      offered: (tc.offeredCombinations ?? []).flatMap((c) => (c?.places ?? c?.placeNames ?? []).map((p) => (typeof p === "string" ? p : p?.name))).slice(0, 6).join("|") || null,
      weather: s.weather ? (s.weather.location ?? s.weather.city ?? "set") : null, draft: s.draftTrip ? (s.draftTrip.destination ?? s.draftTrip.title ?? "set") : null,
      // _app.chat.tsx:14136 trip-creation destination query order
      createQ: s.tripDestination?.formattedName || tc.destination || s.tripPlanningContext?.destination || s.preferredArea || "",
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 200) };
  };
  const turnS = async (s0, t, loc) => {
    const q0 = geoQ().length;
    try { const r = await H.appTurn(structuredClone(s0), t, loc); const q = geoQ().slice(q0); return { row: { ...snap(r), geo: q.length, q: q.join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }, s: null }; }
  };
  const fresh = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const seedFor = async (loc, base) => {
    for (const t of CAND_SEED[loc]) {
      await fresh(loc);
      let r; try { r = await H.appTurn(structuredClone(base), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: r.s };
    }
    await fresh(loc);
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...base, lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };

  // ---- C1
  for (const t of [...C1_FIRST, ...C1_FIRST_REC]) { await fresh("en"); R[`C1F|${t}`] = (await turnS(sessionMod.createEmptySession(), t, "en")).row; }
  {
    const { seed, s1 } = await seedFor("en", sessionMod.createEmptySession());
    R["C1S"] = { seed, row: snap({ s: s1, row: {} }) };
    for (const t of [...C1_CONF_CITY, ...C1_CONF_COLD, ...C1_CONF_KNOWN, ...C1_CONF_BARE]) {
      let g; try { const x = gpc.globalPlanningTurn(structuredClone(s1), t); g = x === undefined ? "undefined" : `dest=${x.destination ?? "-"} cand=${x.destinationCandidate?.raw ?? "-"}`; } catch (e) { g = `THROW ${e?.message}`; }
      await fresh("en");
      const a = await turnS(s1, t, "en");
      R[`C1C|${t}`] = { ...a.row, g };
      // what the user does next after a cold-city correction is dropped: types the city again
      if (C1_CONF_COLD.includes(t) && a.s) { await fresh("en"); R[`C1C2|${t}`] = (await turnS(a.s, "Naha", "en")).row; }
    }
    // after a bare no (city re-asked), the next answer per locale
    for (const loc of LOCS) {
      const { s1: sL } = await seedFor(loc, sessionMod.createEmptySession());
      await fresh(loc);
      const no = await turnS(sL, { "zh-TW": "不是", en: "nah, later", ja: "いいえ", ko: "아니요" }[loc], loc);
      R[`RA|${loc}|no`] = no.row;
      for (const t of RE_ASK[loc]) { if (!no.s) break; await fresh(loc); R[`RA|${loc}|${t}`] = (await turnS(no.s, t, loc)).row; }
      // App-faithful: _app.chat.tsx:11128 reads the last assistant message (the re-ask copy) as lastAssistantReply
      if (no.s) {
        const reAsk = (no.row.reply ?? "").replace(/ \/ /g, "\n");
        for (const t of RE_ASK[loc]) { await fresh(loc); R[`RAF|${loc}|${t}`] = (await turnS({ ...no.s, lastAssistantReply: reAsk }, t, loc)).row; }
      }
    }
  }

  // ---- C2
  for (const loc of LOCS) {
    const { seed, s1 } = await seedFor(loc, sessionMod.createEmptySession());
    R[`C2S|${loc}`] = { seed, row: snap({ s: s1, row: {} }) };
    const raw = s1.travelContext?.destinationCandidate?.raw ?? SYN_RAW[loc];
    // mirrored: every mirror holds the old candidate name (worst case) + GPS lat/lng
    const mirrored = { ...structuredClone(s1), preferredArea: raw, tripPlanningContext: { ...(s1.tripPlanningContext ?? {}), intent: "destination_planning", destination: raw, interests: ["onsen"] },
      location: { ...GPS, city: raw } };
    // gps: a different GPS city + mirrors holding the old name
    const gps = { ...structuredClone(mirrored), location: { ...GPS } };
    // unrelated: mirrors hold another value (must survive)
    const unrelated = { ...structuredClone(s1), preferredArea: "北海道", tripPlanningContext: { ...(s1.tripPlanningContext ?? {}), intent: "destination_planning", destination: "北海道" }, location: { ...GPS } };
    const bases = { real: s1, mirrored, gps, unrelated };
    for (const [bn, b] of Object.entries(bases)) {
      for (const t of C2_NEG[loc]) { await fresh(loc); R[`C2N|${loc}|${bn}|${t}`] = (await turnS(b, t, loc)).row; }
      for (const t of C2_DIRECT[loc]) { await fresh(loc); R[`C2D|${loc}|${bn}|${t}`] = (await turnS(b, t, loc)).row; }
      for (const t of C2_KEEP[loc]) { await fresh(loc); R[`C2K|${loc}|${bn}|${t}`] = (await turnS(b, t, loc)).row; }
      // re-entering the same candidate name is no replacement
      await fresh(loc); R[`C2R|${loc}|${bn}`] = (await turnS(b, raw, loc)).row;
    }
    // realistic GPS flow: GPS session → seed → correction
    const { s1: sG } = await seedFor(loc, { ...sessionMod.createEmptySession(), location: { ...GPS } });
    R[`C2GS|${loc}`] = snap({ s: sG, row: {} });
    await fresh(loc); R[`C2G|${loc}`] = (await turnS(sG, C2_NEG[loc][0], loc)).row;
    await fresh(loc); R[`C2GD|${loc}`] = (await turnS(sG, C2_DIRECT[loc][0], loc)).row;
  }

  // ---- K: 「不是京都，是大阪」 residual, followed 3 turns (+ GPS variant)
  for (const [kn, base, loc, text] of [["zh", null, "zh-TW", "不是京都，是大阪"], ["zhGPS", GPS, "zh-TW", "不是京都，是大阪"], ["en", null, "en", "no, not Kyoto, Osaka"], ["ja", null, "ja", "いいえ、京都じゃなくて、大阪です"]]) {
    const { seed, s1 } = await seedFor(loc, { ...sessionMod.createEmptySession(), ...(base ? { location: { ...base } } : {}) });
    await fresh(loc);
    const rows = [{ t: `seed ${seed}`, ...snap({ s: s1, row: {} }) }];
    let cur = await turnS(s1, text, loc);
    rows.push({ t: text, ...cur.row });
    for (const f of FOLLOW[loc]) {
      if (!cur.s) break;
      cur = await turnS(cur.s, f, loc);
      rows.push({ t: f, ...cur.row });
    }
    R[`K|${kn}`] = rows;
  }
  void tpc;
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D13_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d13.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D13_JSON@@([\s\S]*?)@@END@@/);
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
  const vals = (w) => [w?.dest, w?.trip, w?.cand?.split("/")[0]].filter(Boolean).map(String);
  const mirrors = (w) => ({ dest: w?.dest, trip: w?.trip, area: w?.area, tpc: w?.tpcDest, locCity: w?.loc?.split("@")[0] });

  out("==== C1) Naha vs nah ====");
  for (const t of C1_FIRST) {
    const w = WR[`C1F|${t}`]; const h = HR?.[`C1F|${t}`];
    const ok = vals(w).some((v) => NAHA.test(v)) && !/destination_clarification/.test(w?.b ?? "");
    if (!ok) fail(`C1first|${t}`, fa(w));
    show(ok ? "ok" : "BAD", `first turn 「${t}」`, w, h);
  }
  for (const t of C1_FIRST_REC) {
    const w = WR[`C1F|${t}`]; const h = HR?.[`C1F|${t}`];
    const same = h && w?.b === h.b && w?.dest === h.dest && w?.cand === h.cand;
    if (HR && !same) fail(`C1firstRec|${t}`, `differs from HEAD: ${fa(w)}`);
    out(`REC   first turn 「${t}」 sameAsHEAD=${HR ? same : "n/a"}`); out(`    W ${fa(w)}`);
  }
  out(`-- seed W=${WR.C1S?.seed} H=${HR?.C1S?.seed ?? "n/a"}`);
  const takesCity = (w, re) => vals(w).some((v) => re.test(v)) && !vals(w).some((v) => SEED_RE.test(v) || /^(?:no|nope|nah)\b/i.test(v)) && (w?.geo ?? 0) >= 1
    && !Object.values(mirrors(w)).some((v) => SEED_RE.test(v ?? ""));
  for (const [t, re] of [...C1_CONF_CITY.map((t) => [t, NAHA]), ...C1_CONF_KNOWN.map((t) => [t, /Nikko|日光/i.test(t) ? /Nikko|日光|닛코/i : OSAKA])]) {
    const w = WR[`C1C|${t}`]; const h = HR?.[`C1C|${t}`];
    const ok = takesCity(w, re);
    if (!ok) fail(`C1city|${t}`, fa(w));
    show(ok ? "ok" : "BAD", `confirmation 「${t}」`, w, h);
  }
  for (const t of C1_CONF_COLD) {
    const w = WR[`C1C|${t}`]; const h = HR?.[`C1C|${t}`]; const w2 = WR[`C1C2|${t}`]; const h2 = HR?.[`C1C2|${t}`];
    const taken = takesCity(w, NAHA);
    // never worse than HEAD: no old-candidate leak and no "nah"/"no" written as a destination
    const noLeak = w && !Object.values(mirrors(w)).some((v) => SEED_RE.test(v ?? "")) && !vals(w).some((v) => /^(?:no|nope|nah)\b/i.test(v));
    if (!noLeak) fail(`C1cold|${t}`, fa(w));
    if (!taken) notes.push(`LIMIT C1 cold-city 「${t}」 at confirmation: Naha not taken (W [${w?.b}] dest=${w?.dest} cand=${w?.cand}; HEAD [${h?.b}] dest=${h?.dest} cand=${h?.cand}); next 「Naha」 → W dest=${w2?.dest} cand=${w2?.cand} geo=${w2?.geo} (HEAD dest=${h2?.dest} cand=${h2?.cand})`);
    show(taken ? "ok" : "LIMIT", `confirmation cold 「${t}」 then 「Naha」`, w, h);
    if (!taken) { out(`    W next 「Naha」 ${fa(w2)}`); if (HR) out(`    H next 「Naha」 ${fa(h2)}`); }
  }
  for (const t of C1_CONF_BARE) {
    const w = WR[`C1C|${t}`]; const h = HR?.[`C1C|${t}`];
    const ok = w && !w.cand && !w.dest && !w.trip && !w.area && !w.tpcDest && w.geo === 0 && /destination_clarification/.test(w.b ?? "") && !SEED_RE.test(w.reply ?? "");
    if (!ok) fail(`C1bare|${t}`, fa(w));
    show(ok ? "ok" : "BAD", `confirmation bare 「${t}」`, w, h);
  }

  out("\n==== C1b) after the city is re-asked: next answer (W vs HEAD; regression = HEAD took the city, W does not) ====");
  for (const loc of LOCS) {
    out(`-- ${loc} no → W ${fa(WR[`RA|${loc}|no`])}`);
    if (HR) out(`          H ${fa(HR[`RA|${loc}|no`])}`);
    for (const t of RE_ASK[loc]) {
      const w = WR[`RA|${loc}|${t}`]; const h = HR?.[`RA|${loc}|${t}`];
      const re = /大阪|Osaka|오사카/i.test(t) ? OSAKA : /那霸|那覇|Naha|나하/i.test(t) ? NAHA : /熱海|Atami|아타미/i.test(t) ? /熱海|Atami|아타미/i : /Nikko|日光/i;
      // took = the city became the destination / candidate (a known city may resolve locally, geocode 0)
      const took = (x) => vals(x).some((v) => re.test(v)) && !/destination_clarification/.test(x?.b ?? "");
      const wTook = took(w); const hTook = h ? took(h) : null;
      const reg = HR && hTook && !wTook;
      if (reg) fail(`C1reask|${loc}|${t}`, `HEAD took the city after re-ask, W does not: ${fa(w)}`);
      show(wTook ? "ok" : reg ? "BAD" : "LIMIT", `${loc} re-ask 「${t}」 W took=${wTook} H took=${hTook}`, w, h);
      const wf = WR[`RAF|${loc}|${t}`]; const hf = HR?.[`RAF|${loc}|${t}`];
      const wfTook = took(wf); const hfTook = hf ? took(hf) : null;
      const regF = HR && hfTook && !wfTook;
      if (regF) fail(`C1reaskApp|${loc}|${t}`, `App-faithful lastAssistantReply: HEAD took the city, W does not: ${fa(wf)}`);
      show(wfTook ? "ok" : regF ? "BAD" : "LIMIT", `${loc} re-ask (App lastAssistantReply) 「${t}」 W took=${wfTook} H took=${hfTook}`, wf, hf);
    }
  }

  out("\n==== C2) correction / direct input at confirmation ====");
  for (const loc of LOCS) {
    out(`-- ${loc} seed W=${WR[`C2S|${loc}`]?.seed} H=${HR?.[`C2S|${loc}`]?.seed ?? "n/a"}  seedRow ${fa(WR[`C2S|${loc}`]?.row)}`);
    for (const bn of ["real", "mirrored", "gps", "unrelated"]) {
      for (const [kind, list] of [["C2N", C2_NEG[loc]], ["C2D", C2_DIRECT[loc]]]) for (const t of list) {
        const k = `${kind}|${loc}|${bn}|${t}`; const w = WR[k]; const h = HR?.[k];
        const m = mirrors(w);
        const takes = OSAKA.test(m.dest ?? "") || OSAKA.test(w?.cand ?? "");
        const leak = Object.entries(m).filter(([, v]) => SEED_RE.test(v ?? "")).map(([f]) => f);
        let ok = takes && leak.length === 0 && (w?.geo ?? 0) >= 1;
        const latKept = /@25\.033,121\.5654$/.test(w?.loc ?? "");
        if (bn !== "real" && !latKept) ok = false;
        // a GPS city different from the old name is never cleared by the correction (it may be overwritten with
        // the new city by trip-intent — recorded and compared with HEAD)
        if (bn === "gps" || bn === "unrelated") {
          const lc = m.locCity;
          if (!lc || lc === "-") ok = false;
          else if (lc !== "台北市") notes.push(`C2 ${loc} ${bn} 「${t}」 location.city 台北市 → ${lc} (HEAD ${h?.loc?.split("@")[0] ?? "n/a"})`);
        }
        const unrelatedLost = bn === "unrelated" && (!w?.area || !w?.tpcDest);
        if (unrelatedLost) notes.push(`C2 ${loc} unrelated 「${t}」 area=${w?.area} tpc=${w?.tpcDest} (北海道 replaced; HEAD area=${h?.area} tpc=${h?.tpcDest})`);
        if (!ok) fail(`${kind}|${loc}|${bn}|${t}`, `leak=[${leak}] ${fa(w)}`);
        show(ok ? "ok" : "BAD", `${loc} ${kind === "C2N" ? "neg" : "direct"} ${bn} 「${t}」 dest=${m.dest} trip=${m.trip} area=${m.area} tpc=${m.tpc} locCity=${m.locCity}`, w, h);
        if (HR && h) { const hm = mirrors(h); const hl = Object.entries(hm).filter(([, v]) => SEED_RE.test(v ?? "")).map(([f]) => f); if (hl.length) out(`    (HEAD leak=[${hl}])`); }
      }
      for (const t of C2_KEEP[loc]) {
        const k = `C2K|${loc}|${bn}|${t}`; const w = WR[k]; const h = HR?.[k];
        // a non-place reply: W must not clear more than HEAD
        const lost = h ? Object.entries(mirrors(h)).filter(([f, v]) => v && !mirrors(w)[f]).map(([f]) => f) : [];
        const latKept = bn === "real" || /@25\.033,121\.5654$/.test(w?.loc ?? "");
        const ok = lost.length === 0 && latKept;
        if (!ok) fail(`C2keep|${loc}|${bn}|${t}`, `W cleared [${lost}] vs HEAD: ${fa(w)}`);
        show(ok ? "ok" : "BAD", `${loc} non-place ${bn} 「${t}」 (cleared vs HEAD: [${lost}])`, w, h);
      }
      {
        const k = `C2R|${loc}|${bn}`; const w = WR[k]; const h = HR?.[k];
        const lost = h ? Object.entries(mirrors(h)).filter(([f, v]) => v && !mirrors(w)[f]).map(([f]) => f) : [];
        const ok = lost.length === 0;
        if (!ok) fail(`C2same|${loc}|${bn}`, `W cleared [${lost}] vs HEAD: ${fa(w)}`);
        show(ok ? "ok" : "BAD", `${loc} same-name re-entry ${bn} (cleared vs HEAD: [${lost}])`, w, h);
      }
    }
    for (const k of [`C2G|${loc}`, `C2GD|${loc}`]) {
      const w = WR[k]; const h = HR?.[k]; const m = mirrors(w);
      const leak = Object.entries(m).filter(([, v]) => SEED_RE.test(v ?? "")).map(([f]) => f);
      const ok = (OSAKA.test(m.dest ?? "") || OSAKA.test(w?.cand ?? "")) && leak.length === 0 && /@25\.033,121\.5654$/.test(w?.loc ?? "");
      if (!ok) fail(k, `leak=[${leak}] ${fa(w)}`);
      show(ok ? "ok" : "BAD", `${loc} GPS flow ${k.startsWith("C2GD") ? "direct" : "neg"} seedLoc=${WR[`C2GS|${loc}`]?.loc} → loc=${w?.loc}`, w, h);
    }
  }

  out("\n==== K) 「不是京都，是大阪」 residual visibility (record only) ====");
  for (const kn of ["zh", "zhGPS", "en", "ja"]) {
    const rows = WR[`K|${kn}`] ?? []; const hrows = HR?.[`K|${kn}`] ?? [];
    out(`-- ${kn}`);
    rows.forEach((w, i) => {
      const h = hrows[i];
      const vis = ["dest", "city", "trip", "tripLabel", "area", "tpcDest", "loc", "base", "offered", "weather", "draft", "createQ", "reply"].filter((f) => KYOTO.test(String(w?.[f] ?? "")));
      const hvis = h ? ["dest", "city", "trip", "tripLabel", "area", "tpcDest", "loc", "base", "offered", "weather", "draft", "createQ", "reply"].filter((f) => KYOTO.test(String(h?.[f] ?? ""))) : [];
      out(`  「${w.t}」 W Kyoto-in=[${vis}] q=${w.q ?? ""}`);
      out(`     W [${w.b}] p=${w.p} base=${w.base} dest=${w.dest} trip=${w.trip} area=${w.area} tpc=${w.tpcDest} loc=${w.loc} days=${w.days} offered=${w.offered} createQ=${w.createQ} | ${w.reply}`);
      if (HR) out(`     H Kyoto-in=[${hvis}] [${h?.b}] dest=${h?.dest} area=${h?.area} tpc=${h?.tpcDest} loc=${h?.loc} offered=${h?.offered} createQ=${h?.createQ} | ${h?.reply ?? ""}`);
      if (vis.some((f) => ["reply", "offered", "base", "createQ", "weather", "draft", "dest", "trip"].includes(f))) notes.push(`K ${kn} 「${w.t}」 Kyoto user-facing in [${vis}]`);
      else if (vis.length) notes.push(`K ${kn} 「${w.t}」 Kyoto internal only in [${vis}]`);
      if (KYOTO.test(w.q ?? "")) notes.push(`K ${kn} 「${w.t}」 geocode query mentions Kyoto: ${w.q}`);
    });
  }

  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
