import "./verify-netguard-full.mjs";
/**
 * T-W (tester, independent review of B9: trailing trip-length phrase stripped from destination candidates).
 * W (working tree) vs H (HEAD via --head-dir). Harness: App-order turn of verify-m16-post-selection-switch-review.mjs
 * (tripIntent → mergeTravelContext → resolveGlobalPlanningCandidate (geocode mock, counted) → … ), same slice as d27.
 *  s) 11 task sentences + extra (京都／台南／釜山 N 天, 東京 3/10-3/13, 我 3 天後要去安東): direct parsers + new-chat turn.
 *  d) after a generated trip (phase done, trip_created cleanup): 「我想去玩 3 天」 and controls → reset or not.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-tw-review.mjs -- --head-dir=<snapshot> [--only=s|d]
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const ONLY = argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (s) => !ONLY || ONLY.includes(s);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 370s"); process.exit(3); }, 370_000).unref();

const storageWrites = [];
{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { storageWrites.push(`set:${k}`); mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);
const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};

const EXTRA_FIX = [
  ["andong", "/andong|安東|安东|안동/i", "Andong", "North Gyeongsang", "South Korea", "KR", 36.5684, 128.7294, ["Andong", "安東市", "安東市", "안동시"]],
  ["daegu", "/daegu|大邱|대구/i", "Daegu", "Daegu", "South Korea", "KR", 35.8714, 128.6014, ["Daegu", "大邱", "大邱", "대구"]],
  ["seoul", "/seoul|首爾|首尔|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
  ["busan", "/busan|釜山|부산/i", "Busan", "Busan", "South Korea", "KR", 35.1796, 129.0756, ["Busan", "釜山", "釜山", "부산"]],
  ["tainan", "/tainan|台南|臺南|타이난/i", "Tainan", "Tainan", "Taiwan", "TW", 22.9997, 120.227, ["Tainan", "台南", "台南", "타이난"]],
];

// [text, locale, kind]
const SENT = [
  ["我想去安東 3 天", "zh-TW", "andong"], ["我想去安東3天", "zh-TW", "andong"], ["我想去安東三天", "zh-TW", "andong"],
  ["去大邱 5 天玩", "zh-TW", "daegu"], ["I want to go to Andong for 3 days", "en", "andong"], ["안동 3일 가고 싶어", "ko", "andong"],
  ["我想去首爾 3 天", "zh-TW", "seoul"], ["我想去日本 3 天", "zh-TW", "japan"], ["我想去玩 3 天", "zh-TW", "nonplace"],
  ["我想去一趟 3 天", "zh-TW", "nonplace"], ["我想去看看", "zh-TW", "nonplace"],
  // extra
  ["我想去京都 3 天", "zh-TW", "kyoto"], ["我想去台南 5 天", "zh-TW", "tainan"], ["我想去釜山 2 天", "zh-TW", "busan"],
  ["我想去東京 3/10-3/13", "zh-TW", "tokyoRange"], ["我 3 天後要去安東", "zh-TW", "andongRel"],
];
const AFTER_DONE = ["我想去玩 3 天", "我想去一趟 3 天", "我想去看看", "我想去安東 3 天", "我想去京都 3 天", "3 天"];

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const tls = await load("src/lib/ai/travel-language-signals.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  slice = slice.replace('return dateQuestion("13058");', '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
    + 'if (!dl) { const s = { ...n, travelContext: planningCtx }; return { s, row: snapOf(s, "13226 destination_clarification", tpc.buildDestinationPlanningClarify(planningCtx, n, "destination", locale)) }; } '
    + 'return dateQuestion("13058"); }');
  const geoLines = EXTRA_FIX.map(([k, re, city, region, country, code, lat, lng]) => `  ${k}: { re: ${re}, city: ${JSON.stringify(city)}, region: ${JSON.stringify(region)}, country: ${JSON.stringify(country)}, code: "${code}", lat: ${lat}, lng: ${lng} },\n`).join("");
  const localLines = EXTRA_FIX.map(([k, , , , , , , , loc]) => `${k}: ${JSON.stringify(loc)}, `).join("");
  slice = slice.replace("  kamakura: { re: /kamakura", geoLines + "  kamakura: { re: /kamakura")
    .replace('kamakura: ["Kamakura"', localLines + 'kamakura: ["Kamakura"')
    .replace('if (!k || k === "nikko") return [];', "if (!k) return [];");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, generatedDone, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const reset = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const turnS = async (s0, t, loc) => {
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(structuredClone(s0), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const per = geoLogs().map((l, i) => l.slice(n0[i]));
      return { s, row: { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, country: tc.destinationCountry ?? null, type: tc.destinationType ?? null,
        days: tc.days ?? s.tripDays ?? null, start: tc.startDate ?? null, end: tc.endDate ?? null,
        cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, trip: s.tripDestination?.city ?? null,
        geoG: per[0].length, geoA: per[1].length, geoD: per[2].length, q: per.flatMap((l, i) => l.map((x) => `${["g", "a", "d"][i]}:${x}`)).join("|"),
        phase: s.phase ?? null, lastTrip: s.lastGeneratedTripId ?? null, sid: s.planningSessionId ?? null, sidChanged: r.row?.sidChanged ?? null,
        reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 140) } };
    } catch (e) { return { s: null, row: { b: `THROW ${String(e?.message ?? e).slice(0, 120)}`, geoG: -1 } }; }
  };
  const parsers = (u) => {
    const e = sessionMod.createEmptySession();
    return {
      cands: g(() => tls.travelDestinationCandidates(u)),
      merge: g(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); const c = m.context;
        return { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}` : null, days: c.days ?? null, country: c.destinationCountry ?? null, type: c.destinationType ?? null, start: c.startDate ?? null, end: c.endDate ?? null }; }),
      gpt: g(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"} days=${x.days ?? "-"}`; }),
      parseDest: g(() => tpc.parseDestinationFromText(u) ?? null),
    };
  };

  if (want("s")) {
    for (const [t, loc] of SENT) {
      setNav(loc);
      R[`SP|${t}`] = parsers(t);
      await reset(loc);
      R[`ST|${t}`] = (await turnS(sessionMod.createEmptySession(), t, loc)).row;
    }
    setNav(null);
  }
  if (want("d")) {
    setNav("zh-TW");
    await reset("zh-TW");
    const t1 = await turnS(sessionMod.createEmptySession(), "12/10-12/14 我要去東京", "zh-TW");
    R["D0"] = t1.row;
    const done = t1.s ? H.generatedDone(t1.s, "tokyo") : null;
    R["D0done"] = done ? { phase: done.phase, lastTrip: done.lastGeneratedTripId ?? null, dest: done.travelContext?.destination ?? null, days: done.travelContext?.days ?? done.tripDays ?? null, sid: done.planningSessionId ?? null } : null;
    for (const t of AFTER_DONE) {
      if (!done) break;
      await reset("zh-TW");
      R[`DW|${t}`] = g(() => travelContext.wouldMergeTravelContextResetTrip(structuredClone(done), t));
      const m = g(() => { const x = travelContext.mergeTravelContext(structuredClone(done), t, done.lastAssistantReply ?? ""); return { dest: x.context.destination ?? null, cand: x.context.destinationCandidate?.raw ?? null, days: x.context.days ?? null, sidChanged: x.session.planningSessionId !== done.planningSessionId, lastTrip: x.session.lastGeneratedTripId ?? null, phase: x.session.phase ?? null }; });
      R[`DM|${t}`] = m;
      const r = await turnS(done, t, "zh-TW");
      R[`DT|${t}`] = { ...r.row, sidChangedVsDone: r.s ? r.s.planningSessionId !== done.planningSessionId : null };
    }
    setNav(null);
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TW_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tw-review.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const headSig = readFileSync(join(headDir, "src/lib/ai/travel-language-signals.ts"), "utf8");
    out(`HEAD snapshot sanity: trailing-days strip present=${/日間\|days\?\|일/.test(headSig)} (expected false); W present=${/日間\|days\?\|일/.test(readFileSync("src/lib/ai/travel-language-signals.ts", "utf8"))}`);
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 180_000, killSignal: "SIGKILL", maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@TW_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const geoN = (x) => (x ? (x.geoG ?? 0) + (x.geoA ?? 0) + (x.geoD ?? 0) : "n/a");
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} country=${x.country} type=${x.type} days=${x.days} start=${x.start ?? "-"} end=${x.end ?? "-"} cand=${x.cand ?? "-"} geo=g${x.geoG}/a${x.geoA}/d${x.geoD}${x.q ? `(${x.q})` : ""}`;
  const S = (v) => JSON.stringify(v);
  if (want("s")) {
    out("==== S) sentences: parsers + new-chat App turn (W | H) ====");
    for (const [t, , kind] of SENT) {
      const pw = WR[`SP|${t}`]; const ph = HR?.[`SP|${t}`]; const w = WR[`ST|${t}`]; const h = HR?.[`ST|${t}`];
      out(`  「${t}」 (${kind})\n     Wp cands=${S(pw.cands)} merge=${S(pw.merge)} gpt=${pw.gpt} parseDest=${pw.parseDest}\n     Hp ${ph ? `cands=${S(ph.cands)} merge=${S(ph.merge)} gpt=${ph.gpt} parseDest=${ph.parseDest}` : "n/a"}\n     W ${fa(w)}\n       reply: ${w?.reply}\n     H ${fa(h)}\n       reply: ${h?.reply ?? "-"}`);
      const mw = pw.merge ?? {};
      const destOrCand = (x) => [x?.dest, x?.cand?.split("/")[0], x?.trip].filter(Boolean).join(",");
      if (kind === "andong") {
        if (!/安東|安东|안동|Andong/i.test(destOrCand(w))) fail(`S|${t}#dest`, `安東 not a destination/candidate: ${fa(w)}`);
        if ((w?.geoG ?? 0) + (w?.geoA ?? 0) !== 1) fail(`S|${t}#geo`, `destination geocode g+a ${(w?.geoG ?? 0) + (w?.geoA ?? 0)} (expected 1): ${w?.q}`);
        if (Number(w?.days) !== 3) fail(`S|${t}#days`, `days=${w?.days}`);
        if (/\d|天|日|days?/i.test(String(mw.cand ?? "").split("/")[0])) fail(`S|${t}#candRaw`, `candidate keeps trip length: ${mw.cand}`);
      }
      if (kind === "daegu") {
        if (!/大邱|대구|Daegu/i.test(destOrCand(w))) fail(`S|${t}#dest`, `大邱 not a destination/candidate: ${fa(w)}`);
        if (Number(w?.days) !== 5) fail(`S|${t}#days`, `days=${w?.days}`);
      }
      if (kind === "seoul") {
        if (!/首爾|서울|Seoul/i.test(String(w?.dest))) fail(`S|${t}#dest`, `dest=${w?.dest}`);
        if (Number(w?.days) !== 3) fail(`S|${t}#days`, `days=${w?.days}`);
        // destination-verification geocode (g = global planning candidate, a = authority); d = combination discovery (reported)
        if ((w?.geoG ?? 0) + (w?.geoA ?? 0) !== 0) fail(`S|${t}#geo`, `destination geocode g+a ${(w?.geoG ?? 0) + (w?.geoA ?? 0)} (expected 0): ${w?.q}`);
        if (h && (w?.geoD ?? 0) > (h?.geoD ?? 0)) fail(`S|${t}#geoD`, `discovery geocode W ${w?.geoD} > H ${h?.geoD}`);
      }
      if (kind === "japan") {
        if (!(w?.type === "country" || /日本|Japan/.test(String(w?.country)))) fail(`S|${t}#country`, `not a country: ${fa(w)}`);
        if (Number(w?.days) !== 3) fail(`S|${t}#days`, `days=${w?.days}`);
      }
      if (kind === "nonplace") {
        if (/玩|一趟|看看/.test(destOrCand(w))) fail(`S|${t}#nonplace`, `non-place word became a place: ${fa(w)}`);
        if (/玩|一趟|看看/.test(String(mw.dest ?? "") + String(mw.cand ?? ""))) fail(`S|${t}#nonplaceMerge`, `merge ${S(mw)}`);
        if ((w?.q ?? "").match(/玩|一趟|看看/)) fail(`S|${t}#nonplaceGeo`, `geocode ${w.q}`);
      }
      if (["kyoto", "tainan", "busan"].includes(kind)) {
        const re = { kyoto: /京都|Kyoto/, tainan: /台南|Tainan/, busan: /釜山|Busan/ }[kind];
        if (!re.test(destOrCand(w))) fail(`S|${t}#dest`, `dest lost: ${fa(w)}`);
        if (h && ((h.dest && !w.dest) || h.days !== w.days || geoN(w) > geoN(h))) fail(`S|${t}#vsHEAD`, `listed city worse than HEAD: W ${fa(w)} | H ${fa(h)}`);
      }
      if (kind === "tokyoRange") {
        if (!/東京|Tokyo/.test(String(w?.dest))) fail(`S|${t}#dest`, `dest=${w?.dest}`);
        if (!w?.start || !w?.end) fail(`S|${t}#range`, `range lost start=${w?.start} end=${w?.end}`);
        if (h && (h.start !== w.start || h.end !== w.end || h.dest !== w.dest || h.days !== w.days)) fail(`S|${t}#vsHEAD`, `W ${fa(w)} | H ${fa(h)}`);
      }
      if (kind === "andongRel") {
        if (h && (h.days !== w.days || h.start !== w.start || h.dest !== w.dest || h.cand !== w.cand)) notes.push(`「${t}」 differs from HEAD: W ${fa(w)} | H ${fa(h)}`);
        if (/\d|天後|天后/.test(String(mw.cand ?? "")) && !/\d|天後/.test(String(ph?.merge?.cand ?? ""))) fail(`S|${t}#cand`, `candidate keeps time phrase ${mw.cand}`);
      }
      if (h && (h.dest !== w.dest || h.days !== w.days || h.cand !== w.cand || h.country !== w.country || geoN(h) !== geoN(w))) notes.push(`DIFF 「${t}」: W ${fa(w)} | H ${fa(h)}`);
    }
  }
  if (want("d")) {
    out("\n==== D) after a generated trip (phase done) (W | H) ====");
    out(`  D0 W ${fa(WR.D0)}\n     H ${fa(HR?.D0)}\n  done W ${S(WR.D0done)}\n       H ${S(HR?.D0done)}`);
    for (const t of AFTER_DONE) {
      const w = WR[`DT|${t}`]; const h = HR?.[`DT|${t}`];
      out(`  「${t}」\n     wouldReset W=${S(WR[`DW|${t}`])} H=${S(HR?.[`DW|${t}`])}\n     merge W=${S(WR[`DM|${t}`])}\n           H=${S(HR?.[`DM|${t}`])}\n     W ${fa(w)} sidChangedVsDone=${w?.sidChangedVsDone} phase=${w?.phase} lastTrip=${w?.lastTrip}\n       reply: ${w?.reply}\n     H ${fa(h)} sidChangedVsDone=${h?.sidChangedVsDone} phase=${h?.phase} lastTrip=${h?.lastTrip}\n       reply: ${h?.reply ?? "-"}`);
      if (h && (S(WR[`DW|${t}`]) !== S(HR?.[`DW|${t}`]) || w?.sidChangedVsDone !== h?.sidChangedVsDone || w?.dest !== h?.dest || w?.days !== h?.days)) notes.push(`AFTER-DONE DIFF 「${t}」 wouldReset W=${S(WR[`DW|${t}`])} H=${S(HR?.[`DW|${t}`])} sidChanged W=${w?.sidChangedVsDone} H=${h?.sidChangedVsDone} dest W=${w?.dest} H=${h?.dest} days W=${w?.days} H=${h?.days}`);
    }
  }
  if (want("s")) {
    out("\n==== SUMMARY TABLE S (sentence | W merge dest/cand/days/country | W turn dest/cand/days/country/type/geo g/a/d | H same) ====");
    const mm = (m) => (m ? `${m.dest ?? "-"}/${m.cand ?? "-"}/${m.days ?? "-"}/${m.country ?? "-"}` : "n/a");
    const tt = (x) => (x ? `${x.dest ?? "-"}/${x.cand ?? "-"}/${x.days ?? "-"}/${x.country ?? "-"}/${x.type ?? "-"}/g${x.geoG}a${x.geoA}d${x.geoD}${x.q ? `(${x.q})` : ""}` : "n/a");
    for (const [t] of SENT) out(`  ${t} | Wm ${mm(WR[`SP|${t}`]?.merge)} | Wt ${tt(WR[`ST|${t}`])} | Hm ${mm(HR?.[`SP|${t}`]?.merge)} | Ht ${tt(HR?.[`ST|${t}`])}`);
  }
  if (want("d")) {
    out("\n==== SUMMARY TABLE D (after done: text | wouldReset W/H | sidChanged W/H | dest W/H | days W/H) ====");
    for (const t of AFTER_DONE) { const w = WR[`DT|${t}`]; const h = HR?.[`DT|${t}`]; out(`  ${t} | reset ${S(WR[`DW|${t}`])}/${S(HR?.[`DW|${t}`])} | sid ${w?.sidChangedVsDone}/${h?.sidChangedVsDone} | dest ${w?.dest}/${h?.dest} | days ${w?.days}/${h?.days} | cand ${w?.cand}/${h?.cand} | geo W g${w?.geoG}a${w?.geoA}d${w?.geoD}(${w?.q}) H g${h?.geoG}a${h?.geoA}d${h?.geoD}(${h?.q}) | branch W[${w?.b}] H[${h?.b}] p W=${w?.p} H=${h?.p}\n      W reply: ${(w?.reply ?? "").slice(0, 90)}\n      H reply: ${(h?.reply ?? "").slice(0, 90)}`); }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  out(`NOTES ${notes.length}:\n  ${notes.map((n) => n.slice(0, 160)).join("\n  ")}`);
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
