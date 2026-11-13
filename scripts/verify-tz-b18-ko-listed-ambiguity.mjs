import "./verify-netguard-full.mjs";
/**
 * T-Z (tester, independent review of B17 KO_LISTED_CITY_RE + B18/B19 Korean CITY_LOCALE_ALIASES).
 * W (working tree) vs H (HEAD via --head-dir). Harness: same App-order slice as verify-ty-b13-ko-nodays.mjs.
 * Geocode fixtures for the new cities are FULL-MATCH only (「나라」 resolves, 「우리나라」 does not), so a mock
 * substring hit cannot fake a destination; every geocode query is logged and counted.
 *  n) new listed cities without days (나고야 / 홍콩 / 뉴욕 / 삿포로 / 다낭 / 제주 가고 싶어): dest, geocode count, ko reply place name.
 *  a) ambiguity: 나라 (country) / 파리 (fly) sentences + general sentences that contain 나라 / 파리.
 *  u) unit: travelDestinationCandidates / extractKnownAliasDestination / resolveDestinationFromText / mergeTravelContext,
 *     cityLocaleEvidenceAliases / evidenceIncludesParentCity on address-like blobs / displayDestinationForCopy(ko).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=400 scripts/verify-tz-b18-ko-listed-ambiguity.mjs -- --head-dir=<snapshot>
 */
import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL internal watchdog 380s"); process.exit(3); }, 380_000).unref();

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
const setNav = (on) => {
  if (!on) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: "ko-KR", languages: ["ko-KR"], userAgent: "probe" }, configurable: true, writable: true });
};

const full = (names) => `/^(?:${names})(?:시|市|도|島)?(?:,.*)?$/i`;
const EXTRA_FIX = [
  ["nagoya", full("nagoya|名古屋|나고야"), "Nagoya", "Aichi", "Japan", "JP", 35.1815, 136.9066, ["Nagoya", "名古屋", "名古屋市", "나고야"]],
  ["hongkong", full("hong kong|香港|홍콩"), "Hong Kong", "Hong Kong", "Hong Kong", "HK", 22.3193, 114.1694, ["Hong Kong", "香港", "香港", "홍콩"]],
  ["newyork", full("new york|紐約|ニューヨーク|뉴욕"), "New York", "New York", "United States", "US", 40.7128, -74.006, ["New York", "紐約", "ニューヨーク", "뉴욕"]],
  ["sapporo", full("sapporo|札幌|삿포로"), "Sapporo", "Hokkaido", "Japan", "JP", 43.0618, 141.3545, ["Sapporo", "札幌", "札幌市", "삿포로"]],
  ["danang", full("da nang|danang|峴港|ダナン|다낭"), "Da Nang", "Da Nang", "Vietnam", "VN", 16.0544, 108.2022, ["Da Nang", "峴港", "ダナン", "다낭"]],
  ["jeju", full("jeju|濟州|済州|제주"), "Jeju", "Jeju", "South Korea", "KR", 33.4996, 126.5312, ["Jeju", "濟州", "済州", "제주"]],
  ["nara", full("nara|奈良|나라"), "Nara", "Nara", "Japan", "JP", 34.6851, 135.8048, ["Nara", "奈良", "奈良市", "나라"]],
  ["paris", full("paris|巴黎|パリ|파리"), "Paris", "Ile-de-France", "France", "FR", 48.8566, 2.3522, ["Paris", "巴黎", "パリ", "파리"]],
];

// [text, kind, expect]  kind: n = new listed city; a = ambiguity; g = general sentence containing 나라 / 파리
const SENT = [
  ["나고야 가고 싶어", "n", /名古屋|나고야|Nagoya/i],
  ["홍콩 가고 싶어", "n", /香港|홍콩|Hong Kong/i],
  ["뉴욕 가고 싶어", "n", /紐約|뉴욕|New York/i],
  ["삿포로 가고 싶어", "n", /札幌|삿포로|Sapporo/i],
  ["다낭 가고 싶어", "n", /峴港|다낭|Da Nang/i],
  ["제주 가고 싶어", "n", /濟州|済州|제주|Jeju/i],
  ["다른 나라 여행 가고 싶어", "a", "notNara"],
  ["나라 여행 가고 싶어", "a", "report"],
  ["우리나라 여행 가고 싶어", "a", "notNara"],
  ["이 나라 가고 싶어", "a", "notNara"],
  ["파리 잡고 싶어", "a", "notParis"],
  ["파리 가고 싶어", "a", "paris"],
  ["나라 가고 싶어", "a", "report"],
  ["다른 나라 가고 싶어", "g", "notNara"],
  ["나라마다 날씨가 달라요", "g", "notNara"],
  ["우리나라 음식 추천해줘", "g", "notNara"],
  ["따뜻한 나라 가고 싶어", "g", "notNara"],
  ["나라 3일 가고 싶어", "g", "report"],
  ["파리바게뜨 가고 싶어", "g", "notParis"],
  ["파리 여행 가고 싶어", "g", "paris"],
  // follow-ups (삿포로 / 제주 forms): HEAD also or new?
  ["삿포로 여행 가고 싶어", "f", /札幌|삿포로|Sapporo/i],
  ["삿포로 3일 가고 싶어", "f", /札幌|삿포로|Sapporo/i],
  ["삿포로에 가고 싶어", "f", /札幌|삿포로|Sapporo/i],
  ["제주도 가고 싶어", "f", /濟州|済州|제주|Jeju/i],
  ["제주 여행 가고 싶어", "f", /濟州|済州|제주|Jeju/i],
  ["제주 3일 가고 싶어", "f", /濟州|済州|제주|Jeju/i],
];
// Whole-field match: 「다른 나라」「우리나라」 as a candidate is a generic noun phrase, not 奈良.
const NARA_RE = /(?:^|,)(?:奈良|奈良市|나라|나라시|Nara)(?:,|$)/i;
const PARIS_RE = /(?:^|,)(?:巴黎|파리|Paris)(?:,|$)/i;

async function collect() {
  const R = { rows: {}, unit: {} };
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const tls = await load("src/lib/ai/travel-language-signals.ts");
  const tpcU = await load("src/lib/ai/trip-planning-context.ts");
  const ali = await load("src/lib/ai/destination-locale-aliases.ts");
  const area = await load("src/lib/ai/destination-area-aliases.ts");
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
  const g = (fn) => { try { const v = fn(); return v === undefined ? null : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  setNav(true);
  for (const [t] of SENT) {
    const e = sessionMod.createEmptySession();
    const p = {
      cands: g(() => tls.travelDestinationCandidates(t)),
      alias: g(() => ali.extractKnownAliasDestination(t)),
      resolve: g(() => tpcU.resolveDestinationFromText(t)),
      merge: g(() => { const c = travelContext.mergeTravelContext(structuredClone(e), t, "").context; return { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}` : null, days: c.days ?? null }; }),
    };
    H.freshAll(); await H.freshAuthority(); H.setLocale("ko");
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(sessionMod.createEmptySession(), t, "ko"); const s = r.s; const tc = s.travelContext ?? {};
      const per = geoLogs().map((l, i) => l.slice(n0[i]));
      R.rows[t] = { p, b: r.row?.branch ?? null, pend: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null,
        cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
        trip: s.tripDestination?.city ?? null, days: tc.days ?? s.tripDays ?? null,
        geo: per.reduce((a, l) => a + l.length, 0), q: per.flatMap((l, i) => l.map((x) => `${["g", "a", "d"][i]}:${x}`)).join("|"),
        reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 120) };
    } catch (err) { R.rows[t] = { p, b: `THROW ${String(err?.message ?? err).slice(0, 120)}`, geo: -1 }; }
  }
  // unit: evidence aliases are matched by substring against place address / evidence blobs (not user text).
  R.unit.evidenceAliasesNara = g(() => ali.cityLocaleEvidenceAliases("奈良"));
  R.unit.evidenceAliasesParis = g(() => ali.cityLocaleEvidenceAliases("巴黎"));
  const BLOBS = [["일본 나라현 나라시 노보리오지초", "奈良", true], ["서울특별시 중구 다른나라 식당", "奈良", false], ["우리나라 여행 가고 싶어", "奈良", false],
    ["Kyoto, 교토부, 일본 (나라 방향)", "奈良", false], ["프랑스 파리 75001", "巴黎", true], ["파리바게뜨 서울역점, 서울특별시 용산구", "巴黎", false], ["Lyon, France", "巴黎", false]];
  R.unit.blobs = BLOBS.map(([blob, city, truth]) => ({ blob, city, truth, hit: g(() => area.evidenceIncludesParentCity(blob, city)) }));
  R.unit.display = ["다른 나라 여행 가고 싶어", "파리 잡고 싶어", "나라 가고 싶어"].map((t) => ({ t, nara: g(() => ali.displayDestinationForCopy("奈良", t, "ko")), paris: g(() => ali.displayDestinationForCopy("巴黎", t, "ko")) }));
  setNav(false);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TZB18_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-tz-b18-ko-listed-ambiguity.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 170_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TZB18_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const W = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const S = (v) => JSON.stringify(v);
  const place = (x) => [x?.dest, x?.cand?.split("/")[0], x?.trip, x?.p?.merge?.dest, x?.p?.merge?.cand?.split("/")[0]].filter(Boolean).join(",");
  const cell = (x) => (!x ? "n/a" : `[${x.b}] p=${x.pend ?? "-"} dest=${x.dest ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} days=${x.days ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`);
  const par = (x) => (!x ? "n/a" : `cands=${S(x.p.cands)} alias=${S(x.p.alias)} resolve=${S(x.p.resolve)} merge=${S(x.p.merge)}`);
  out("==== rows (W | H) ====");
  for (const [t, kind, exp] of SENT) {
    const w = W.rows[t]; const h = HR?.rows?.[t];
    if (!argv.includes("--brief")) out(`「${t}」 (${kind})\n   W ${cell(w)}\n     Wp ${par(w)}\n     W reply: ${w?.reply ?? "-"}\n   H ${cell(h)}\n     Hp ${par(h)}\n     H reply: ${h?.reply ?? "-"}`);
    if (!w || String(w.b).startsWith("THROW")) { fail(`${t}#err`, w?.b ?? "no row"); continue; }
    const tag = (bad) => (h && !bad(h) ? "NEW vs HEAD" : "HEAD also");
    if (kind === "n" || kind === "f") {
      if (!exp.test(place(w))) fail(`${t}#dest`, `listed city not resolved (${h && exp.test(place(h)) ? "NEW vs HEAD" : "HEAD also"}): ${cell(w)}`);
      if (/^(\p{Script=Han}+)\1$/u.test(w.dest ?? "")) fail(`${t}#doubled`, `doubled canonical label ${w.dest} (${h && /^(\p{Script=Han}+)\1$/u.test(h.dest ?? "") ? "HEAD also" : "NEW vs HEAD"})`);
      if (w.geo > 0) out(`   NOTE ${t}: W geocode ${w.geo} (${w.q}) — listed city expected without geocode`);
      if (!exp.test(w.reply ?? "")) fail(`${t}#reply`, `ko reply has no place name: ${w.reply}`);
    }
    if (exp === "notNara") { const bad = (x) => NARA_RE.test(place(x)) || /奈良|Nara/.test(x.q ?? ""); if (bad(w)) fail(`${t}#nara`, `misread as 奈良 (${tag(bad)}): ${cell(w)}`); }
    if (exp === "notParis") { const bad = (x) => PARIS_RE.test(place(x)) || /巴黎|Paris/.test(x.q ?? ""); if (bad(w)) fail(`${t}#paris`, `misread as 巴黎 (${tag(bad)}): ${cell(w)}`); }
    if (exp === "paris" && !PARIS_RE.test(place(w))) out(`   NOTE ${t}: Paris not resolved: ${cell(w)}`);
  }
  out("\n==== SUMMARY TABLE (text | W dest/cand/geo | H dest/cand/geo) ====");
  const sc = (x) => (!x ? "n/a" : `${x.dest ?? "-"}/${x.cand ?? "-"}/geo${x.geo}${x.q ? `(${x.q})` : ""} [${(x.b ?? "").slice(0, 28)}]`);
  for (const [t, kind] of SENT) out(`  ${kind} ${t} | W ${sc(W.rows[t])} | H ${sc(HR?.rows?.[t])}`);
  out("\n==== ko reply heads for new cities (W | H) ====");
  for (const [t, kind] of SENT) if (kind === "n" || kind === "f") out(`  ${t} | W ${(W.rows[t]?.reply ?? "").slice(0, 40)} | H ${(HR?.rows?.[t]?.reply ?? "").slice(0, 40)}`);
  out("\n==== unit: evidence aliases / parent-city substring match / ko display ====");
  out(`  cityLocaleEvidenceAliases(奈良) W ${S(W.unit.evidenceAliasesNara)} | H ${S(HR?.unit?.evidenceAliasesNara ?? null)}`);
  out(`  cityLocaleEvidenceAliases(巴黎) W ${S(W.unit.evidenceAliasesParis)} | H ${S(HR?.unit?.evidenceAliasesParis ?? null)}`);
  for (const [i, b] of W.unit.blobs.entries()) {
    const hb = HR?.unit?.blobs?.[i];
    out(`  evidenceIncludesParentCity("${b.blob}", ${b.city}) truth=${b.truth} W=${b.hit} H=${hb?.hit ?? "n/a"}${b.hit !== b.truth ? "  <= WRONG" : ""}${hb && b.hit !== hb.hit ? " (NEW vs HEAD)" : ""}`);
  }
  for (const [i, d] of W.unit.display.entries()) out(`  displayDestinationForCopy(奈良|巴黎, "${d.t}", ko) W ${d.nara}|${d.paris} | H ${HR?.unit?.display?.[i]?.nara ?? "n/a"}|${HR?.unit?.display?.[i]?.paris ?? "n/a"}`);
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
