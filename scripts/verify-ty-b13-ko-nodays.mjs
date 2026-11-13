import "./verify-netguard-full.mjs";
/**
 * T-Y (tester): B13 spec judgement for ko 「<place> 가고 싶어」 without trip length.
 * Spec (approved): ko 「名字＋天數＋想去」 requires (N박)N일; without days → HEAD behaviour.
 * W (working tree) vs H (HEAD via --head-dir); same App-order harness slice as verify-tx-b11-ko-phrase.mjs.
 * Judgement per row:
 *   nodays  → W must equal H (dest / cand / trip / days / geocode count).
 *   withdays→ W must extract the place; W geocode may exceed H by exactly 1 (approved).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-ty-b13-ko-nodays.mjs -- --head-dir=<snapshot>
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
];

// [text, locale, kind, placeRe]
const SENT = [
  ["부산 가고 싶어", "ko", "nodays", /釜山|부산|Busan/i],
  ["안동 가고 싶어", "ko", "nodays", /安東|안동|Andong/i],
  ["서울 가고 싶어", "ko", "nodays", /首爾|서울|Seoul/i],
  ["부산 여행 가고 싶어", "ko", "nodays", /釜山|부산|Busan/i],
  ["서울에 가고 싶어", "ko", "nodays", /首爾|서울|Seoul/i],
  ["부산 3일 가고 싶어", "ko", "withdays", /釜山|부산|Busan/i],
  ["안동 3일 가고 싶어", "ko", "withdays", /安東|안동|Andong/i],
  // comparison (other locales, no days) — shows whether the gap is ko-specific
  ["我想去釜山", "zh-TW", "ref", /釜山|부산|Busan/i],
  ["釜山に行きたい", "ja", "ref", /釜山|부산|Busan/i],
];

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
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
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  for (const [t, loc] of SENT) {
    setNav(loc);
    let merge;
    try { const m = travelContext.mergeTravelContext(structuredClone(sessionMod.createEmptySession()), t, ""); const c = m.context;
      merge = { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}` : null, days: c.days ?? null };
    } catch (e) { merge = { err: String(e?.message ?? e).slice(0, 80) }; }
    H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(sessionMod.createEmptySession(), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const per = geoLogs().map((l, i) => l.slice(n0[i]));
      R[t] = { merge, b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null,
        cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
        trip: s.tripDestination?.city ?? null, days: tc.days ?? s.tripDays ?? null,
        geo: per.reduce((a, l) => a + l.length, 0), q: per.flatMap((l, i) => l.map((x) => `${["g", "a", "d"][i]}:${x}`)).join("|"),
        reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 110) };
    } catch (err) { R[t] = { merge, b: `THROW ${String(err?.message ?? err).slice(0, 120)}`, geo: -1 }; }
  }
  setNav(null);
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@TYB13_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-ty-b13-ko-nodays.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 150_000, killSignal: "SIGKILL", maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@TYB13_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} signal=${r.signal ?? ""} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON: ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const place = (x) => [x?.dest, x?.cand?.split("/")[0], x?.trip].filter(Boolean).join(",");
  const fa = (x) => (!x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} days=${x.days ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""} merge=${JSON.stringify(x.merge)}`);
  out("==== rows (W | H) ====");
  for (const [t, loc, kind, re] of SENT) {
    const w = WR[t]; const h = HR?.[t];
    out(`「${t}」 (${loc}/${kind})\n   W ${fa(w)}\n     reply: ${w?.reply ?? "-"}\n   H ${fa(h)}\n     reply: ${h?.reply ?? "-"}`);
    out(`   placeFound W=${re.test(place(w))} H=${h ? re.test(place(h)) : "n/a"}`);
    if (!h) { fail(`${t}#noHEAD`, "no HEAD row"); continue; }
    if (kind === "nodays") {
      const same = place(w) === place(h) && w.geo === h.geo && String(w.days) === String(h.days);
      if (!same) fail(`${t}#nodays=HEAD`, `W differs from HEAD: W place=${place(w) || "-"} geo=${w.geo} | H place=${place(h) || "-"} geo=${h.geo}`);
    }
    if (kind === "withdays") {
      if (!re.test(place(w))) fail(`${t}#dest`, "place not extracted");
      if (w.geo - h.geo > 1) fail(`${t}#geo`, `W geocode ${w.geo} exceeds H ${h.geo} by more than 1`);
    }
  }
  out(`\nSUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
