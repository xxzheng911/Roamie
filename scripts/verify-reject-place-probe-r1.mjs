import "./verify-netguard-full.mjs";
/**
 * R1 (tester, investigation only): "the user does not want a place" scenarios, W (working tree) vs H (HEAD snapshot).
 *  A) reject a place while choosing combinations / after a pick / on a new session (Kyoto trip).
 *  B) itinerary edit on a generated Kyoto trip (remove a stop / change a day).
 *  C) destination correction: candidate confirmation state and the Kyoto ask_days state (「不是，是大阪」…).
 *  D) bare negation on the candidate confirmation, plus a follow-up days turn.
 *  P) pure: isNonPlaceDestinationText / globalPlanningTurn / parsePlanningConstraintDelta per sentence.
 * Harness: the App-order turn of verify-m16-post-selection-switch-review.mjs (as verify-date-dest-review-d7.mjs), plus an
 * Osaka geocode fixture. All network is blocked (verify-netguard-full + harness fetch stub).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-reject-place-probe-r1.mjs -- --head-dir=<snapshot>
 * INFO probe: exit 0 unless the harness itself fails; findings are printed as BAD / REGRESSION rows.
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const LOC_ONLY = argv.find((a) => a.startsWith("--loc="))?.slice(6);
const PART = argv.find((a) => a.startsWith("--part="))?.slice(7);
const part = (p) => !PART || PART === p;
const T0 = performance.now();
const progress = (m) => { if (CHILD) process.stderr.write(`PROGRESS +${Math.round(performance.now() - T0)}ms ${m}\n`); };
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

const LOCS = ["zh-TW", "en", "ja", "ko"].filter((l) => !LOC_ONLY || l === LOC_ONLY);
// A) reject a place (current destination Kyoto)
const REJECT = {
  "zh-TW": ["不要這個", "不要去京都", "京都以外", "京都不要"],
  en: ["I don't want Kyoto", "not Kyoto", "anything but Kyoto", "not this one"],
  ja: ["京都はやめて", "京都以外で", "これはいらない"],
  ko: ["교토는 빼줘", "교토 말고", "이건 싫어"],
};
// B) itinerary edit on a generated Kyoto trip
const EDIT = {
  "zh-TW": ["把第二天的清水寺拿掉", "第2天不要去金閣寺"],
  en: ["remove Kinkakuji from day 2"],
  ja: ["2日目の清水寺は外して"],
  ko: ["둘째 날 청수사 빼줘"],
};
// C) destination correction
const CORRECT = {
  "zh-TW": ["不是，是大阪", "不是京都，是大阪"],
  en: ["no, Osaka"],
  ja: ["いいえ、大阪です"],
  ko: ["아니요, 오사카요"],
};
// D) bare negation on the candidate confirmation (+ yes as the control)
const NEGATE = {
  "zh-TW": ["不是", "不要", "沒有", "是"],
  en: ["no", "nope", "yes"],
  ja: ["いいえ", "はい"],
  ko: ["아니요", "네"],
};
const FOLLOW = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const CAND_SEED = {
  "zh-TW": ["我想去草津溫泉"],
  en: ["I want to go to Kusatsu Onsen", "I want to go to Yufuin"],
  ja: ["沖縄へ旅行に行きたい", "草津温泉に行きたい", "由布院に行きたい"],
  ko: ["오키나와 여행", "쿠사츠 온천 여행", "유후인 여행"],
};
const STOPS = [
  { name: "清水寺", placeId: "ChIJ_kiyomizu", lat: 34.9949, lng: 135.785, category: "attraction", city: "京都市" },
  { name: "金閣寺", placeId: "ChIJ_kinkakuji", lat: 35.0394, lng: 135.7292, category: "attraction", city: "京都市" },
  { name: "Kinkakuji", placeId: "ChIJ_kinkakuji_en", lat: 35.0394, lng: 135.7292, category: "attraction", city: "Kyoto" },
  { name: "청수사", placeId: "ChIJ_kiyomizu_ko", lat: 34.9949, lng: 135.785, category: "attraction", city: "교토시" },
];

async function collect() {
  const R = {};
  progress("collect start");
  const sessionMod = await load("src/lib/chat-session.ts");
  progress("chat-session loaded");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const constraints = await load("src/lib/ai/planning-conversation-constraints.ts");
  const partial = await loadOpt("src/lib/ai/combination-partial-modify-reply.ts");
  const combos = await loadOpt("src/lib/ai/destination-combination-suggestions.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const OLD_13058 = 'return dateQuestion("13058");';
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  // Osaka fixture (geocode + local labels), so 「是大阪」 can resolve.
  slice = slice.replace("  kamakura: { re: /kamakura", '  osaka: { re: /osaka|大阪|오사카/i, city: "Osaka", region: "Osaka", country: "Japan", code: "JP", lat: 34.6937, lng: 135.5023 },\n  kamakura: { re: /kamakura')
    .replace('kamakura: ["Kamakura"', 'osaka: ["Osaka", "大阪", "大阪市", "오사카"], kamakura: ["Kamakura"');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, NAME, generatedDone, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  progress("harness ready");

  const geoCount = () => H.geocodeLog.length + H.authorityGeocodeLog.length + H.discoveryGeocodeLog.length;
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, cls: r.row?.cls ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      clar: tc.destinationClarification ?? null, days: tc.days ?? s.tripDays ?? null, phase: s.phase ?? null,
      sid: s.planningSessionId ?? null,
      stops: Array.isArray(s.plannedStops) ? s.plannedStops.map((p) => p?.name).join("|") : null,
      excl: (s.planningConstraints?.excludedPlaces ?? []).map((p) => p?.canonicalName ?? p?.name ?? p?.placeId).join("|") || null,
      rejected: (s.rejectedPlaceNames ?? []).join("|") || null,
      exclCombo: (tc.excludedCombinationPlaceNames ?? []).join("|") || null,
      offered: (tc.offeredCombinations ?? []).length,
      geo: [...(r.row?.geo ?? []), ...(r.row?.ageo ?? []), ...(r.row?.dgeo ?? [])],
      reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 120) };
  };
  const turn = async (s0, t, loc) => { if (SKIP.has(t)) return { b: "SKIPPED (HEAD hang)" }; progress(`turn ${loc} ${t}`); try { return snap(await H.appTurn(structuredClone(s0), t, loc)); } catch (e) { return { b: `THROW ${String(e?.message ?? e).slice(0, 100)}` }; } };
  const SKIP = new Set((argv.find((a) => a.startsWith("--skip="))?.slice(7) ?? "").split("~").filter(Boolean));
  const pure = (s0, t) => {
    let g;
    if (SKIP.has(t)) return { g: "SKIPPED (HEAD hang)" };
    progress(`pure global ${t}`);
    try { const r = gpc.globalPlanningTurn(structuredClone(s0), t); g = r === undefined ? "undefined(legacy)" : `dest=${r.destination ?? "-"} cand=${r.destinationCandidate?.raw ?? "-"} clar=${r.destinationClarification ?? "-"}`; }
    catch (e) { g = `THROW ${e?.message}`; }
    progress(`pure cls ${t}`);
    let cls; try { const c = tpc.classifyDestinationSwitchTurn(t); cls = `${c.state}${c.targetLabel ? `→${c.targetLabel}` : ""}`; } catch { cls = "n/a"; }
    progress(`pure nonPlace ${t}`);
    const nonPlace = typeof tpc.isNonPlaceDestinationText === "function" ? tpc.isNonPlaceDestinationText(t) : "absent";
    progress(`pure rejectAll ${t}`);
    const rejectAll = combos?.isRejectAllCombinationsReply?.(t) ?? null;
    progress(`pure partial ${t}`);
    const partialR = partial?.isCombinationPartialModifyReply?.(t) ?? null;
    progress(`pure hold ${t}`);
    const hold = partial?.isCombinationHoldReply?.(t) ?? null;
    progress(`pure end ${t}`);
    return { g, cls, nonPlace, rejectAll, partial: partialR, hold };
  };
  const base = async (stage, loc, key = "kyoto") => {
    progress(`base ${stage} ${loc}`);
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    if (stage === "new") return sessionMod.createEmptySession();
    const place = H.NAME[loc][key];
    if (stage === "nodate") return (await H.first(H.NODATE[loc](place), loc)).s;
    const s = (await H.first(H.STEP1[loc](place), loc)).s;
    if (stage === "choosing") return s;
    const picked = (await H.appTurn(s, "1", loc)).s;
    if (stage === "picked") return picked;
    const done = H.generatedDone(picked, key);
    return { ...done, plannedStops: [...(done.plannedStops ?? []), ...STOPS], selectedPlaces: [...(done.selectedPlaces ?? []), ...STOPS],
      currentDayPlan: { day: 2, places: STOPS } };
  };
  const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "沖縄", ko: "오키나와" };
  const candBase = async (loc) => {
    if (argv.includes("--synthetic")) {
      // Same unresolved candidate state on W and HEAD (the App state after a geocode miss: candidate advice asked).
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      const raw = SYN_RAW[loc];
      const s = { ...sessionMod.createEmptySession(), lastAssistantReply: "(confirm city and country)",
        travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } };
      return { seed: `SYNTHETIC ${raw}/unresolved`, s, row: snap({ s, row: {} }) };
    }
    for (const t of CAND_SEED[loc]) {
      progress(`seed ${loc} ${t}`);
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      let r; try { r = await H.first(t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s: r.s, row: snap(r) };
    }
    return { seed: null, s: null };
  };

  for (const loc of LOCS) {
    // A
    for (const stage of part("A") ? ["new", "choosing", "picked"] : []) {
      const s0 = await base(stage, loc);
      R[`A|${loc}|${stage}|base`] = snap({ s: s0, row: {} });
      for (const t of REJECT[loc]) { R[`A|${loc}|${stage}|${t}|pure`] = pure(s0, t); R[`A|${loc}|${stage}|${t}`] = await turn(s0, t, loc); }
    }
    // B
    for (const stage of part("B") ? ["done", "picked"] : []) {
      const s0 = await base(stage, loc);
      R[`B|${loc}|${stage}|base`] = snap({ s: s0, row: {} });
      for (const t of EDIT[loc]) {
        R[`B|${loc}|${stage}|${t}|pure`] = pure(s0, t);
        const d = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: STOPS, authoritativeDestination: s0.travelContext?.destination });
        R[`B|${loc}|${stage}|${t}|delta`] = { excl: (d.excludedPlaces ?? []).map((p) => p.canonicalName ?? p.placeId).join("|") || null, changed: (d.changedFields ?? []).join(",") || null };
        R[`B|${loc}|${stage}|${t}`] = await turn(s0, t, loc);
      }
    }
    // C + D on the candidate confirmation
    const cb = part("CD") ? await candBase(loc) : { seed: null, s: null };
    R[`CD|${loc}|seed`] = cb.seed; R[`CD|${loc}|seedRow`] = cb.row ?? null;
    if (cb.s) {
      for (const t of [...CORRECT[loc], ...NEGATE[loc]]) {
        if (SKIP.has(t)) { R[`CD|${loc}|${t}|skipped`] = true; continue; }
        progress(`cd ${loc} ${t}`);
        R[`CD|${loc}|${t}|pure`] = pure(cb.s, t);
        progress(`cd pure done ${loc} ${t}`);
        const g0 = geoCount();
        const r = await H.appTurn(structuredClone(cb.s), t, loc).catch((e) => ({ s: cb.s, row: { branch: `THROW ${e?.message}` } }));
        R[`CD|${loc}|${t}`] = snap(r);
        R[`CD|${loc}|${t}|geo`] = geoCount() - g0;
        if (NEGATE[loc].includes(t)) R[`CD|${loc}|${t}|follow`] = await turn(r.s, FOLLOW[loc], loc);
      }
    }
    // C on the Kyoto ask_days state (destination just accepted)
    if (part("C2")) {
      const s0 = await base("nodate", loc);
      R[`C2|${loc}|base`] = snap({ s: s0, row: {} });
      for (const t of CORRECT[loc]) { R[`C2|${loc}|${t}|pure`] = pure(s0, t); R[`C2|${loc}|${t}`] = await turn(s0, t, loc); }
    }
  }
  return R;
}

if (CHILD) {
  progress("boot");
  let R;
  try { R = await collect(); }
  catch (e) { process.stderr.write(`CHILD THROW ${String(e?.stack ?? e).slice(0, 600)}\n`, () => process.exit(4)); await new Promise(() => {}); }
  out(`@@R1_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-reject-place-probe-r1.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(LOC_ONLY ? [`--loc=${LOC_ONLY}`] : []), ...(PART ? [`--part=${PART}`] : []), ...(argv.includes("--synthetic") ? ["--synthetic"] : []),
      ...argv.filter((a) => a.startsWith("--skip-head="))].map((a) => a.replace(/^--skip-head=/, "--skip=")), { cwd: headDir, encoding: "utf8", timeout: 290_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@R1_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").split("\n").filter((l) => !/^PROGRESS/.test(l)).join("\n").slice(-800)}`);
    const prog = (r.stderr ?? "").split("\n").filter((l) => /^PROGRESS/.test(l));
    out(`HEAD child progress: ${prog.length} steps; last=${prog.slice(-2).join(" || ")}`);
    if (!m) for (const l of prog) out(`   ${l}`);
  }
  const WR = await collect();
  const fa = (x) => !x ? "n/a" : `[${x.b}] cls=${x.cls ?? "-"} p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} cand=${x.cand ?? "-"} clar=${x.clar ?? "-"} days=${x.days ?? "-"} phase=${x.phase ?? "-"}`
    + `${x.excl ? ` excl=${x.excl}` : ""}${x.rejected ? ` rejected=${x.rejected}` : ""}${x.exclCombo ? ` exclCombo=${x.exclCombo}` : ""} offered=${x.offered ?? "-"} geo=${JSON.stringify(x.geo ?? [])} | ${x.reply ?? ""}`;
  const fp = (x) => !x ? "n/a" : `global=${x.g} cls=${x.cls} nonPlace=${x.nonPlace} rejectAll=${x.rejectAll} partial=${x.partial} hold=${x.hold}`;
  const NEG_WORD_RE = /不是|不要|沒有|以外|いいえ|아니|^no\b|nope|やめ|말고|빼|拿掉|外し|don't|anything but|^not\b|いらない|싫어|^是$|^yes$|^はい$|^네$|です$|是大阪|オサカ요|요$/i;
  const flags = [];
  const show = (key, label) => {
    const w = WR[key]; const h = HR?.[key];
    const bad = (x) => x && ((x.cand && NEG_WORD_RE.test(x.cand.split("/")[0])) || (x.dest && NEG_WORD_RE.test(`${x.dest}`)) || (x.trip && NEG_WORD_RE.test(`${x.trip}`)));
    const wb = bad(w); const hb = bad(h);
    const tag = wb ? (h && !hb ? "BAD REGRESSION" : "BAD") : (hb ? "fixed" : "ok");
    if (wb) flags.push(`${tag} ${key}`);
    out(`${tag.padEnd(14)} ${label}`);
    out(`      W ${fa(w)}`);
    if (HR) out(`      H ${fa(h)}`);
    const wp = WR[`${key}|pure`]; const hp = HR?.[`${key}|pure`];
    if (wp) out(`      W pure ${fp(wp)}`);
    if (hp) out(`      H pure ${fp(hp)}`);
  };
  for (const loc of LOCS) {
    out(`\n==== ${loc} ====`);
    out("-- A) reject a place (Kyoto trip)");
    for (const stage of part("A") ? ["new", "choosing", "picked"] : []) {
      out(`  base ${stage}: W ${fa(WR[`A|${loc}|${stage}|base`])}`);
      if (HR) out(`  base ${stage}: H ${fa(HR[`A|${loc}|${stage}|base`])}`);
      for (const t of REJECT[loc]) show(`A|${loc}|${stage}|${t}`, `A ${loc} ${stage} 「${t}」`);
    }
    out("-- B) itinerary edit (Kyoto, stops incl. 清水寺/金閣寺)");
    for (const stage of part("B") ? ["done", "picked"] : []) {
      out(`  base ${stage}: W ${fa(WR[`B|${loc}|${stage}|base`])}`);
      if (HR) out(`  base ${stage}: H ${fa(HR[`B|${loc}|${stage}|base`])}`);
      for (const t of EDIT[loc]) {
        show(`B|${loc}|${stage}|${t}`, `B ${loc} ${stage} 「${t}」`);
        out(`      W delta ${JSON.stringify(WR[`B|${loc}|${stage}|${t}|delta`])}${HR ? ` | H delta ${JSON.stringify(HR[`B|${loc}|${stage}|${t}|delta`])}` : ""}`);
      }
    }
    out(`-- C/D) candidate confirmation; W seed=${WR[`CD|${loc}|seed`]} H seed=${HR ? HR[`CD|${loc}|seed`] : "n/a"}`);
    if (WR[`CD|${loc}|seedRow`]) out(`  W seed row ${fa(WR[`CD|${loc}|seedRow`])}`);
    if (HR?.[`CD|${loc}|seedRow`]) out(`  H seed row ${fa(HR[`CD|${loc}|seedRow`])}`);
    for (const t of [...CORRECT[loc], ...NEGATE[loc]]) {
      if (!WR[`CD|${loc}|${t}`] && !HR?.[`CD|${loc}|${t}`]) continue;
      show(`CD|${loc}|${t}`, `CD ${loc} 「${t}」 (geo W=${WR[`CD|${loc}|${t}|geo`] ?? "-"} H=${HR?.[`CD|${loc}|${t}|geo`] ?? "-"})`);
      if (WR[`CD|${loc}|${t}|follow`] || HR?.[`CD|${loc}|${t}|follow`]) {
        out(`      W follow 「${FOLLOW[loc]}」 ${fa(WR[`CD|${loc}|${t}|follow`])}`);
        if (HR) out(`      H follow 「${FOLLOW[loc]}」 ${fa(HR[`CD|${loc}|${t}|follow`])}`);
      }
    }
    out("-- C2) correction on the Kyoto ask_days state");
    out(`  base: W ${fa(WR[`C2|${loc}|base`])}`);
    if (HR) out(`  base: H ${fa(HR[`C2|${loc}|base`])}`);
    for (const t of part("C2") ? CORRECT[loc] : []) show(`C2|${loc}|${t}`, `C2 ${loc} 「${t}」`);
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nFLAGS ${flags.length}`);
  for (const f of flags) out(`  ${f}`);
  out("INFO probe done");
  process.stdout.write("", () => process.exit(0));
}
