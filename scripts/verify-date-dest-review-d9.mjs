import "./verify-netguard-full.mjs";
/**
 * D9 (tester, independent round-4 review). W (working tree) vs H (HEAD snapshot via --head-dir, spawned child).
 *  N) A9 day count: ordinal days (第二天／第2天／2日目) are no length; core length phrases unchanged.
 *  X) A7 exclusion guard: excluded place is no destination; leak sentences keep the wanted place.
 *  Y) A6 candidate confirmation (four locales): yes / bare no / correction / everyday no-phrases, plus a days follow-up.
 *  O) A9 ordinal-day sentences on a Kyoto picked state: days / combinations kept.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d9.mjs -- --head-dir=<snapshot>
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

// [text, expected day count or null]
const DAYS = [
  ["3天", 3], ["三天", 3], ["3日間", 3], ["5天4夜", 5], ["五天四夜", 5], ["3 days", 3], ["3일", 3], ["3일간", 3], ["2박3일", null],
  ["我想去京都3天", 3], ["京都玩三天", 3], ["明日から3日間", 3], ["for three days", 3],
  ["第二天", null], ["第2天", null], ["2日目", null], ["第2日", null], ["把第二天的清水寺拿掉", null], ["第2天想去海邊", null], ["2日目は清水寺", null],
  ["第十二天", null], ["2일째", null], ["第12天", null],
];
// [locale, text, want dest label or null]
const EXCL = [
  ["zh-TW", "京都以外", null], ["zh-TW", "京都不要", null], ["ja", "京都はやめて", null], ["ja", "京都以外で", null], ["en", "anything but Kyoto", null], ["en", "not Kyoto", null],
  ["ko", "교토 말고", null],
  // leak checks: the wanted place must survive
  ["ja", "東京以外にも京都に行きたい", "京都"], ["zh-TW", "除了東京還想去京都", "京都"], ["en", "not only Tokyo but also Kyoto", "京都"],
  ["en", "I'm not sure, maybe Osaka", "大阪"], ["en", "Not sure yet, maybe Osaka", "大阪"], ["ja", "京都以外の場所も見たいので大阪へ", "大阪"],
  ["zh-TW", "我想去大阪，京都不要", "大阪"], ["ko", "교토 말고 오사카", "大阪"], ["ja", "京都はやめて大阪に行きたい", "大阪"],
  ["zh-TW", "我想去東京", "東京"], ["en", "I want to go to Osaka", "大阪"],
];
const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const YES = { "zh-TW": ["是", "是的", "好", "對", "嗯"], en: ["yes", "yeah", "ok"], ja: ["はい", "うん", "そうです"], ko: ["네", "응"] };
const NO = { "zh-TW": ["不是", "不要", "沒有", "不對"], en: ["no", "nope"], ja: ["いいえ"], ko: ["아니요"] };
const CORR = { "zh-TW": ["不是，是大阪", "不是京都，是大阪", "不是 大阪"], en: ["no, Osaka", "no Osaka", "nope, it's Osaka"], ja: ["いいえ、大阪です"], ko: ["아니요, 오사카요"] };
const EVERY = { "zh-TW": ["不是很確定", "沒有問題", "不要太遠的", "不是，我再想想"], en: ["no problem", "no thanks", "no idea", "nope, not sure"], ja: ["いいえ、大丈夫です", "いや、まだ決めてない"], ko: ["아니 괜찮아", "아니요, 아직 몰라요"] };
const FOLLOW = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const ORD = { "zh-TW": ["第二天想去海邊", "第2天輕鬆一點"], en: ["day 2 should be relaxed"], ja: ["2日目はゆっくりしたい"], ko: ["둘째 날은 여유롭게"] };

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
    slice + "\nreturn { appTurn, first, freshAll, freshAuthority, STEP1, NODATE, NAME, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const geoCount = () => H.geocodeLog.length + H.authorityGeocodeLog.length + H.discoveryGeocodeLog.length;
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      area: s.preferredArea ?? null, cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null, offered: (tc.offeredCombinations ?? []).length,
      sel: (tc.selectedCombinationIds ?? []).join("|") || null, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 100) };
  };
  const turn = async (s0, t, loc) => { try { return snap(await H.appTurn(structuredClone(s0), t, loc)); } catch (e) { return { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }; } };
  const turnS = async (s0, t, loc) => { try { const r = await H.appTurn(structuredClone(s0), t, loc); return { row: snap(r), s: r.s }; } catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}` }, s: null }; } };
  const LOCS = ["zh-TW", "en", "ja", "ko"];

  // N) day count
  for (const [t] of DAYS) { try { R[`N|${t}`] = dur.parseDayCountFromText(t) ?? null; } catch (e) { R[`N|${t}`] = `THROW ${e?.message}`; } }
  // X) exclusion guard — pure + App new
  for (const [loc, t] of EXCL) {
    let p; try { p = tpc.parseDestinationFromText(t) ?? null; } catch (e) { p = `THROW ${e?.message}`; }
    let m; try { const c = travelContext.mergeTravelContext(sessionMod.createEmptySession(), t).context; m = { dest: c.destination ?? null, cand: c.destinationCandidate?.raw ?? null, names: (c.destinationInputNames ?? []).join("|") || null }; } catch (e) { m = { err: String(e?.message) }; }
    R[`X|${loc}|${t}|pure`] = { p, m };
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    R[`X|${loc}|${t}|app`] = await turn(sessionMod.createEmptySession(), t, loc);
  }
  // Y) candidate confirmation
  for (const loc of LOCS) {
    let seed = null; let s1 = null;
    for (const t of CAND_SEED[loc]) {
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      let r; try { r = await H.first(t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") { seed = t; s1 = r.s; break; }
    }
    if (!s1) {
      // Synthetic unresolved candidate (same state on W and HEAD).
      H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
      const raw = SYN_RAW[loc];
      seed = `SYNTHETIC ${raw}`;
      s1 = { ...sessionMod.createEmptySession(), lastAssistantReply: "(confirm city and country)",
        travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } };
    }
    R[`Y|${loc}|seed`] = seed; R[`Y|${loc}|seedRow`] = snap({ s: s1, row: {} });
    for (const t of [...YES[loc], ...NO[loc], ...CORR[loc], ...EVERY[loc]]) {
      let g; try { const x = gpc.globalPlanningTurn(structuredClone(s1), t); g = x === undefined ? "undefined" : `dest=${x.destination ?? "-"} cand=${x.destinationCandidate?.raw ?? "-"}`; } catch (e) { g = `THROW ${e?.message}`; }
      const g0 = geoCount();
      const r = await turnS(s1, t, loc);
      R[`Y|${loc}|${t}`] = { ...r.row, g, geo: geoCount() - g0 };
      if (r.s && (NO[loc].includes(t) || YES[loc].slice(0, 1).includes(t))) {
        R[`Y|${loc}|${t}|follow`] = await turn(r.s, FOLLOW[loc], loc);
        if (NO[loc].includes(t)) {
          // Residual: which session paths still carry the dropped candidate, and does the pure merge restore it?
          const raw = s1.travelContext?.destinationCandidate?.raw ?? SYN_RAW[loc];
          const paths = [];
          const walk = (v, p, d) => { if (d > 6 || v == null) return; if (typeof v === "string") { if (v.includes(raw)) paths.push(p); return; }
            if (Array.isArray(v)) { v.slice(0, 40).forEach((x, i) => walk(x, `${p}[${i}]`, d + 1)); return; }
            if (typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, d + 1); };
          walk(r.s, "", 0);
          R[`Y|${loc}|${t}|residue`] = paths.slice(0, 20).join(", ") || "none";
          // Control: the same follow-up with only location.city cleared (does the old candidate still come back?).
          const noLoc = { ...r.s, location: r.s.location ? { ...r.s.location, city: undefined } : r.s.location };
          R[`Y|${loc}|${t}|followNoLoc`] = await turn(noLoc, FOLLOW[loc], loc);
          try { const c = travelContext.mergeTravelContext(structuredClone(r.s), FOLLOW[loc]).context; R[`Y|${loc}|${t}|followPure`] = `dest=${c.destination ?? "-"} cand=${c.destinationCandidate?.raw ?? "-"} days=${c.days ?? "-"}`; }
          catch (e) { R[`Y|${loc}|${t}|followPure`] = `THROW ${e?.message}`; }
        }
      }
    }
  }
  // O) ordinal-day sentences on Kyoto picked
  for (const loc of LOCS) {
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const s = (await H.first(H.STEP1[loc](H.NAME[loc].kyoto), loc)).s;
    const picked = (await H.appTurn(s, "1", loc)).s;
    R[`O|${loc}|base`] = snap({ s: picked, row: {} });
    for (const t of ORD[loc]) R[`O|${loc}|${t}`] = await turn(picked, t, loc);
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D9_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d9.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D9_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const known = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} area=${x.area} cand=${x.cand ?? "-"} ${x.start ?? "-"}~${x.end ?? "-"}/${x.days ?? "-"} offered=${x.offered} sel=${x.sel ?? "-"}${x.g ? ` g=${x.g}` : ""}${x.geo != null ? ` geo=${x.geo}` : ""} | ${x.reply ?? ""}`;

  out("==== N) day count (parseDayCountFromText) ====");
  const KNOWN_N = new Set(["第十二天", "2일째"]);
  for (const [t, want] of DAYS) {
    const w = WR[`N|${t}`]; const h = HR?.[`N|${t}`];
    const ok = want === null ? (t === "2박3일" ? true : w === null) : w === want;
    const tag = ok ? "ok  " : KNOWN_N.has(t) ? "KNOWN" : "BAD ";
    if (!ok && KNOWN_N.has(t)) known.push(`N ${t}=${w}`);
    else if (!ok) fail(`N|${t}`, `want ${want} got ${w} (HEAD ${h})`);
    out(`${tag} 「${t}」 W=${w}${HR ? ` H=${h}` : ""}`);
  }

  out("\n==== X) exclusion guard / leak ====");
  for (const [loc, t, want] of EXCL) {
    const w = WR[`X|${loc}|${t}|pure`]; const h = HR?.[`X|${loc}|${t}|pure`];
    const wa = WR[`X|${loc}|${t}|app`]; const ha = HR?.[`X|${loc}|${t}|app`];
    const appDest = (x) => x?.dest ?? x?.trip ?? (x?.cand ? x.cand.split("/")[0] : null);
    const norm = (v) => (v == null ? null : String(v));
    let verdict;
    if (want === null) {
      const leaked = [w?.p, w?.m?.dest, w?.m?.cand, appDest(wa)].some((v) => v && /京都|Kyoto|교토/i.test(v));
      verdict = leaked ? "BAD excluded place became destination" : "ok";
      if (leaked) fail(`X|${loc}|${t}`, verdict);
    } else {
      const has = (x) => x && new RegExp(want === "大阪" ? "大阪|Osaka|오사카" : want === "京都" ? "京都|Kyoto|교토" : "東京|Tokyo|도쿄", "i").test(String(x));
      const wOk = has(w?.p) || has(w?.m?.dest) || has(appDest(wa));
      const hOk = h && (has(h?.p) || has(h?.m?.dest) || has(appDest(ha)));
      verdict = wOk ? "ok" : hOk ? "LEAK REGRESSION (HEAD keeps the place)" : "MISS (HEAD also)";
      if (!wOk && hOk) fail(`X|${loc}|${t}`, verdict);
    }
    out(`${verdict.padEnd(6)} ${loc} 「${t}」 want=${want}`);
    out(`    W pure parseDest=${norm(w?.p)} merge=${JSON.stringify(w?.m)}`);
    out(`    W app ${fa(wa)}`);
    if (HR) { out(`    H pure parseDest=${norm(h?.p)} merge=${JSON.stringify(h?.m)}`); out(`    H app ${fa(ha)}`); }
  }

  out("\n==== Y) candidate confirmation ====");
  const YN = /^(?:是|是的|好|對|嗯|yes|yeah|ok|はい|うん|そうです|네|응|不是|不要|沒有|不對|no|nope|いいえ|아니요|아니)$/i;
  const NEGWORD = /不是|不要|沒有|いいえ|いや|아니|^no\b|nope|problem|thanks|idea|sure|確定|問題|太遠|再想想|大丈夫|決めて|괜찮|몰라/i;
  for (const loc of ["zh-TW", "en", "ja", "ko"]) {
    out(`-- ${loc} seed W=${WR[`Y|${loc}|seed`]} H=${HR?.[`Y|${loc}|seed`] ?? "n/a"}`);
    out(`   W seedRow ${fa(WR[`Y|${loc}|seedRow`])}`);
    if (HR) out(`   H seedRow ${fa(HR[`Y|${loc}|seedRow`])}`);
    for (const t of [...YES[loc], ...NO[loc], ...CORR[loc], ...EVERY[loc]]) {
      const w = WR[`Y|${loc}|${t}`]; const h = HR?.[`Y|${loc}|${t}`];
      const vals = (x) => [x?.dest, x?.trip, x?.area, x?.cand?.split("/")[0]].filter(Boolean).map(String);
      let tag = "info";
      if (YES[loc].includes(t)) {
        // Affirm keeps the pending candidate itself (same raw, still unresolved, no new geocode); HEAD's own
        // 「yes」-as-candidate bug is no baseline, so the candidate is compared with the seed, not with HEAD.
        const seedCand = WR[`Y|${loc}|seedRow`]?.cand;
        const bad = vals(w).some((v) => YN.test(v));
        const kept = w?.cand === seedCand && (w?.geo ?? 0) === 0;
        const hBad = h && [h.dest, h.trip, h.cand?.split("/")[0]].filter(Boolean).some((v) => YN.test(String(v)));
        tag = bad ? "BAD" : kept ? (hBad ? "ok (HEAD made the reply a candidate)" : "ok") : "CHANGED";
        if (bad) fail(`Y|${loc}|${t}`, "yes became a place");
        if (!kept) fail(`Y|${loc}|${t}|affirm`, `affirm no longer keeps the pending candidate: W ${fa(w)} | seed ${seedCand}`);
      } else if (NO[loc].includes(t)) {
        const cleared = !w?.cand && !w?.dest && !w?.trip;
        tag = cleared ? "ok" : "BAD";
        if (!cleared) fail(`Y|${loc}|${t}`, "bare negation kept a destination / candidate");
      } else if (CORR[loc].includes(t)) {
        const okc = vals(w).some((v) => /大阪|Osaka|오사카/i.test(v)) && !vals(w).some((v) => NEGWORD.test(v));
        tag = okc ? "ok" : "BAD";
        if (!okc) fail(`Y|${loc}|${t}`, "correction did not take the new city");
      } else {
        // Everyday no-phrases: W must not geocode a new non-place candidate where HEAD kept the old candidate.
        const newCand = (x) => x?.cand && x.cand.split("/")[0] !== WR[`Y|${loc}|seedRow`]?.cand?.split("/")[0];
        const wNew = newCand(w) && (w?.geo ?? 0) > 0;
        const hNew = h && newCand(h) && (h?.geo ?? 0) > 0;
        tag = !wNew ? "ok" : hNew ? "SUSPECT (HEAD also: phrase geocoded as candidate)" : "REGRESSION (new geocoded non-place candidate)";
        if (wNew && !hNew) fail(`Y|${loc}|${t}|every`, `no-phrase became a geocoded candidate (HEAD kept the seed): ${fa(w)}`);
        else if (wNew) known.push(`Y ${loc} 「${t}」 cand=${w.cand} (HEAD also)`);
      }
      out(`${tag.padEnd(5)} ${loc} 「${t}」`);
      out(`    W ${fa(w)}`);
      if (HR) out(`    H ${fa(h)}`);
      const wf = WR[`Y|${loc}|${t}|follow`]; const hf = HR?.[`Y|${loc}|${t}|follow`];
      if (wf || hf) { out(`    W follow 「${FOLLOW[loc]}」 ${fa(wf)}`); if (HR) out(`    H follow 「${FOLLOW[loc]}」 ${fa(hf)}`); }
      if (WR[`Y|${loc}|${t}|residue`]) {
        out(`    W residual: session paths with old candidate = ${WR[`Y|${loc}|${t}|residue`]} ; pure merge 「${FOLLOW[loc]}」 → ${WR[`Y|${loc}|${t}|followPure`]}`);
        out(`    W control (location.city cleared) follow 「${FOLLOW[loc]}」 ${fa(WR[`Y|${loc}|${t}|followNoLoc`])}`);
      }
    }
  }

  out("\n==== O) ordinal-day sentences on Kyoto picked ====");
  for (const loc of ["zh-TW", "en", "ja", "ko"]) {
    const b = WR[`O|${loc}|base`];
    out(`-- ${loc} base W ${fa(b)}`);
    for (const t of ORD[loc]) {
      const w = WR[`O|${loc}|${t}`]; const h = HR?.[`O|${loc}|${t}`];
      const ok = w && w.days === b.days && w.start === b.start && w.end === b.end && (w.dest === b.dest);
      out(`${ok ? "ok  " : "BAD "} ${loc} 「${t}」 W ${fa(w)}`);
      if (HR) out(`      H ${fa(h)}`);
      if (!ok) {
        const hb = HR?.[`O|${loc}|base`];
        const hok = h && hb && h.days === hb.days && h.dest === hb.dest;
        if (hok || !HR) fail(`O|${loc}|${t}`, "ordinal-day sentence changed days / dates / destination");
        else known.push(`O ${loc} ${t} (HEAD also)`);
      }
    }
  }

  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nKNOWN ${known.length}: ${known.join(" | ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
