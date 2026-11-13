import "./verify-netguard-full.mjs";
/**
 * T-X (tester, independent review of B11: ko 「<place> (N박)N일 가고 싶어／갈래／가려고／가자」 + non-place nouns).
 * W (working tree) vs H (HEAD via --head-dir). Harness: App-order turn of verify-m16-post-selection-switch-review.mjs
 * (tripIntent → mergeTravelContext → resolveGlobalPlanningCandidate (geocode mock, counted) → …), same slice as verify-tw-review.
 * Reports parsers (travelDestinationCandidates / jaKoTravelPhraseName / mergeTravelContext / globalPlanningTurn) and the new-chat App turn.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-tx-b11-ko-phrase.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 280s"); process.exit(3); }, 280_000).unref();

{
  const mem = new Map();
  const stub = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); }, clear: () => mem.clear(), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  try { Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true }); } catch { /* keep */ }
}
const storageWrites = [];
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
  ["seoul", "/seoul|首爾|首尔|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
  ["busan", "/busan|釜山|부산/i", "Busan", "Busan", "South Korea", "KR", 35.1796, 129.0756, ["Busan", "釜山", "釜山", "부산"]],
  ["jeju", "/jeju|濟州|済州|제주/i", "Jeju", "Jeju", "South Korea", "KR", 33.4996, 126.5312, ["Jeju", "濟州", "済州", "제주"]],
];

// [text, locale, kind]
const SENT = [
  ["안동 3일 가고 싶어", "ko", "andong3"], ["안동 2박 3일 가고 싶어", "ko", "andong3"], ["부산 가고 싶어", "ko", "busan"], ["서울에 가고 싶어", "ko", "seoul"],
  ["놀러 가고 싶어", "ko", "nonplace"], ["한번 가고 싶어", "ko", "nonplace"], ["제주도도 가고 싶어", "ko", "report"], ["거기 가고 싶어", "ko", "nonplace"],
  ["我想去安東 3 天", "zh-TW", "andong3"], ["京都に3日行きたい", "ja", "kyoto"],
  // extra (same pattern family): 갈래 / 가려고 / 가자, 다시 / 같이
  ["안동 3일 갈래", "ko", "andong3"], ["안동 3일 가려고", "ko", "andong3"], ["안동 3일 가자", "ko", "andong3"],
  ["다시 가고 싶어", "ko", "nonplace"], ["같이 가고 싶어", "ko", "nonplace"], ["부산 3일 가고 싶어", "ko", "busan3"],
  // np2: common non-place words before 가고 싶어／갈래／가려고／가자 (t2 / t4 found 「휴가 가고 싶어」) — [text, locale, "np2", word]
  ...[["휴가", "가고 싶어"], ["휴가", "3일 가고 싶어"], ["여름휴가", "가고 싶어"], ["집에", "가고 싶어"], ["회사", "가기 싫어"], ["학교", "가고 싶어"],
    ["바다", "가고 싶어"], ["바다", "2박 3일 가고 싶어"], ["캠핑", "가고 싶어"], ["캠핑", "3일 가자"], ["쇼핑", "가고 싶어"], ["해외", "가고 싶어"], ["해외여행", "가고 싶어"],
    ["온천", "가고 싶어"], ["맛집", "가고 싶어"], ["놀이공원", "가고 싶어"], ["시골", "가고 싶어"], ["고향", "가고 싶어"], ["어디든", "가고 싶어"], ["멀리", "가고 싶어"],
    ["혼자", "가고 싶어"], ["빨리", "가고 싶어"], ["꼭", "가고 싶어"], ["진짜", "가고 싶어"], ["또", "가고 싶어"], ["주말에", "가고 싶어"], ["내일", "가고 싶어"],
    ["데이트", "가자"], ["출장", "가려고"], ["신혼여행", "가고 싶어"], ["가족여행", "3일 가고 싶어"], ["친구랑", "가고 싶어"], ["친구들이랑", "3일 갈래"], ["산", "가고 싶어"], ["등산", "가자"]]
    .map(([word, tail]) => [`${word} ${tail}`, "ko", "np2", word]),
];
const NONPLACE_RE = /놀러|한번|거기|다시|같이/;

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const tls = await load("src/lib/ai/travel-language-signals.ts");
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
    slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  for (const [t, loc] of SENT) {
    setNav(loc);
    const e = sessionMod.createEmptySession();
    R[`P|${t}`] = {
      cands: g(() => tls.travelDestinationCandidates(t)),
      phrase: g(() => (tls.jaKoTravelPhraseName ? tls.jaKoTravelPhraseName(t) ?? null : "n/a(not exported)")),
      merge: g(() => { const m = travelContext.mergeTravelContext(structuredClone(e), t, ""); const c = m.context;
        return { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}` : null, days: c.days ?? null, country: c.destinationCountry ?? null }; }),
      gpt: g(() => { const x = gpc.globalPlanningTurn(structuredClone(e), t); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"} days=${x.days ?? "-"}`; }),
    };
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(sessionMod.createEmptySession(), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const per = geoLogs().map((l, i) => l.slice(n0[i]));
      R[`T|${t}`] = { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, country: tc.destinationCountry ?? null, type: tc.destinationType ?? null,
        days: tc.days ?? s.tripDays ?? null, cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null, trip: s.tripDestination?.city ?? null,
        geoG: per[0].length, geoA: per[1].length, geoD: per[2].length, q: per.flatMap((l, i) => l.map((x) => `${["g", "a", "d"][i]}:${x}`)).join("|"),
        reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 150) };
    } catch (err) { R[`T|${t}`] = { b: `THROW ${String(err?.message ?? err).slice(0, 120)}`, geoG: -1 }; }
  }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TX11_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tx-b11-ko-phrase.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TX11_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  const geoN = (x) => (x ? (x.geoG ?? 0) + (x.geoA ?? 0) + (x.geoD ?? 0) : "n/a");
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} cand=${x.cand ?? "-"} days=${x.days} country=${x.country} type=${x.type} trip=${x.trip ?? "-"} geo=g${x.geoG}/a${x.geoA}/d${x.geoD}${x.q ? `(${x.q})` : ""}`;
  const destOrCand = (x) => [x?.dest, x?.cand?.split("/")[0], x?.trip].filter(Boolean).join(",");
  out("==== sentences: parsers + new-chat App turn (W | H) ====");
  const np2Rows = [];
  for (const [t, , kind, word] of SENT) {
    const pw = WR[`P|${t}`]; const ph = HR?.[`P|${t}`]; const w = WR[`T|${t}`]; const h = HR?.[`T|${t}`];
    if (kind === "np2") {
      const hitOf = (p, x) => Boolean(x) && (destOrCand(x).includes(word) || (x.q ?? "").includes(word)
        || String(p?.merge?.dest ?? "").includes(word) || String(p?.merge?.cand ?? "").includes(word));
      const wHit = hitOf(pw, w); const hHit = hitOf(ph, h);
      np2Rows.push(`${wHit ? (h && !hHit ? "BAD NEW-vs-HEAD" : "BAD HEAD-also") : "ok"} 「${t}」 W cand=${pw.merge?.cand ?? "-"} ${fa(w)} | H cand=${ph?.merge?.cand ?? "-"} geo=${geoN(h)}`);
      if (wHit) fail(`${t}#np2`, `non-place word 「${word}」 became a candidate / geocode${h && !hHit ? " (NEW vs HEAD)" : " (HEAD also)"}: W ${fa(w)}`);
      continue;
    }
    if (!argv.includes("--brief")) out(`  「${t}」 (${kind})\n     Wp cands=${S(pw.cands)} phrase=${S(pw.phrase)} merge=${S(pw.merge)} gpt=${pw.gpt}\n     Hp ${ph ? `cands=${S(ph.cands)} phrase=${S(ph.phrase)} merge=${S(ph.merge)} gpt=${ph.gpt}` : "n/a"}\n     W ${fa(w)}\n       reply: ${w?.reply}\n     H ${fa(h)}\n       reply: ${h?.reply ?? "-"}`);
    const candRaw = String(pw.merge?.cand ?? "").split("/")[0];
    if (kind === "andong3") {
      if (!/安東|安东|안동|Andong/i.test(destOrCand(w))) fail(`${t}#dest`, `安東 not a destination/candidate: ${fa(w)}`);
      if ((w?.geoG ?? 0) + (w?.geoA ?? 0) !== 1) fail(`${t}#geo`, `destination geocode g+a=${(w?.geoG ?? 0) + (w?.geoA ?? 0)} (expected 1): ${w?.q}`);
      if (Number(w?.days) !== 3) fail(`${t}#days`, `days=${w?.days}`);
      if (/\d|天|日|박|일|가고|갈래|가려고|가자/.test(candRaw)) fail(`${t}#candRaw`, `candidate keeps trip-length / verb: ${pw.merge?.cand}`);
    }
    if (kind === "busan" || kind === "busan3") {
      if (!/釜山|부산|Busan/i.test(destOrCand(w))) fail(`${t}#dest`, `부산 not a destination/candidate: ${fa(w)}`);
      if (kind === "busan3" && Number(w?.days) !== 3) fail(`${t}#days`, `days=${w?.days}`);
      if (/가고|싶어|\d|일/.test(candRaw)) fail(`${t}#candRaw`, `candidate keeps verb: ${pw.merge?.cand}`);
      if (h && geoN(w) > geoN(h)) fail(`${t}#geoVsHEAD`, `W geocode ${geoN(w)} > H ${geoN(h)}`);
    }
    if (kind === "seoul") {
      if (!/首爾|서울|Seoul/i.test(destOrCand(w))) fail(`${t}#dest`, `서울 not a destination/candidate: ${fa(w)}`);
      if (/에$|가고|싶어/.test(candRaw)) fail(`${t}#candRaw`, `candidate keeps particle / verb: ${pw.merge?.cand}`);
      if (h && geoN(w) > geoN(h)) fail(`${t}#geoVsHEAD`, `W geocode ${geoN(w)} > H ${geoN(h)}`);
    }
    if (kind === "nonplace") {
      if (NONPLACE_RE.test(destOrCand(w))) fail(`${t}#turn`, `non-place word became a place: ${fa(w)}`);
      if (NONPLACE_RE.test(String(pw.merge?.dest ?? "") + String(pw.merge?.cand ?? ""))) fail(`${t}#merge`, `merge ${S(pw.merge)}`);
      if (NONPLACE_RE.test(w?.q ?? "")) fail(`${t}#geo`, `geocoded a non-place word: ${w.q}`);
      if (NONPLACE_RE.test(S(pw.cands)) || NONPLACE_RE.test(String(pw.phrase ?? ""))) fail(`${t}#parsers`, `parser extracted non-place: cands=${S(pw.cands)} phrase=${S(pw.phrase)}`);
    }
    if (kind === "kyoto") {
      if (!/京都|Kyoto|교토/.test(destOrCand(w))) fail(`${t}#dest`, `京都 lost: ${fa(w)}`);
      if (h && ((h.dest && !w.dest) || h.days !== w.days || geoN(w) > geoN(h) || h.cand !== w.cand)) fail(`${t}#vsHEAD`, `W worse than / differs from HEAD: W ${fa(w)} | H ${fa(h)}`);
    }
  }
  out("\n==== SUMMARY TABLE (text | W merge dest/cand/days | W turn dest/cand/days/geo | H merge | H turn) ====");
  const mm = (m) => (m ? `${m.dest ?? "-"}/${m.cand ?? "-"}/${m.days ?? "-"}` : "n/a");
  const tt = (x) => (x ? `${x.dest ?? "-"}/${x.cand ?? "-"}/${x.days ?? "-"}/g${x.geoG}a${x.geoA}d${x.geoD}${x.q ? `(${x.q})` : ""}` : "n/a");
  out("\n==== NP2 (common non-place words + 가고 싶어 / 갈래 / 가려고 / 가자) ====");
  for (const l of np2Rows) out(`  ${l}`);
  out(`NP2 bad W=${np2Rows.filter((l) => l.startsWith("BAD")).length}/${np2Rows.length} (NEW vs HEAD=${np2Rows.filter((l) => l.startsWith("BAD NEW")).length})`);
  out("\n==== SUMMARY TABLE (main sentences) ====");
  for (const [t, , kind] of SENT) if (kind !== "np2") out(`  ${t} | Wm ${mm(WR[`P|${t}`]?.merge)} | Wt ${tt(WR[`T|${t}`])} | Hm ${mm(HR?.[`P|${t}`]?.merge)} | Ht ${tt(HR?.[`T|${t}`])}`);
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
