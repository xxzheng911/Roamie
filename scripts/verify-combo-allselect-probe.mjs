import "./verify-netguard-full.mjs";
/**
 * D23 ② item 5 (tester, read-only probe). W (working tree) vs H (HEAD via --head-dir).
 * Whole-reply all-select words at combination_choice: 「all」「全部」「すべて」「전부」「おまかせ」「お任せします」.
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice / seeds as d21).
 * Axes: locale × offered count (2/3/4 via trip days) × device locale (nav=app: navigator.language = chat locale, as in the App;
 *       nav=node: the Node default navigator) × discovery cache at the selection turn (kept / cleared before the turn).
 * Per row: offered ids+titles shown, isUserAllOrAuto, parsePendingOptionSelection, resolveSelectedCombinations (source list),
 *          selectedCombinationIds after the turn, ids outside the shown list, reply titles vs ids, and
 *          resolveSelectedCombinationAuthority (what generation will read) vs the shown list.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-combo-allselect-probe.mjs -- --head-dir=<snapshot>
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
const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);

const LOCS = ["zh-TW", "en", "ja", "ko"];
const GO = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const DAYS = { "zh-TW": (d) => `${d}天`, en: (d) => `${d} days`, ja: (d) => `${d}日間`, ko: (d) => `${d}일` };
const TOKYO = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const WORDS = ["all", "全部", "すべて", "전부", "おまかせ", "お任せします"];
const DAY_TRIES = [1, 2, 3, 4, 5, 6];

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
  const pendingMod = await load("src/lib/ai/destination-pending-question.ts");
  const authMod = await loadOpt("src/lib/ai/selected-combination-authority.ts");
  const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
  const eff = await load("src/lib/i18n/effective-app-locale.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  // pool hook: realistic place names / type mixes (the m16 mock names 「東京 Shrine 1」 start with a city name)
  const slice = HARNESS_SRC.slice(from, to).replace("const poolFor = (dest) => {", "const poolFor = (dest) => { if (globalThis.__POOL) return globalThis.__POOL(dest);");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, fresh, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const offeredOf = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => ({ id: c.id, title: c.title ?? "", places: (c.places ?? []).map((p) => p.originalName ?? p.name) }));
  R.navNode = g(() => `${typeof navigator}:${globalThis.navigator?.language ?? "-"} eff=${eff.effectiveAppLocale()}`);

  const REAL = ["Senso-ji", "Meiji Jingu", "Ueno Park", "Tokyo National Museum", "Shinjuku Gyoen", "Tokyo Tower", "Yoyogi Park", "Mori Art Museum", "Hamarikyu Gardens",
    "Nezu Shrine", "Edo-Tokyo Museum", "Inokashira Park", "Rikugien", "Zojo-ji", "Ginza Six", "Omotesando Hills", "Tsukiji Outer Market", "Yanaka Ginza"];
  const TYPE_MIX = {
    real3: (i) => (i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"),
    real2: (i) => (i < 9 ? "tourist_attraction" : "museum"),
    real4: (i) => ["tourist_attraction", "museum", "park", "shopping_mall"][i % 4],
    real5: (i) => ["tourist_attraction", "museum", "park", "shopping_mall", "place_of_worship"][i % 5],
  };
  const mkPool = (mix) => (dest) => {
    if (!/tokyo|東京|도쿄/i.test(dest ?? "")) return [];
    return REAL.map((name, i) => ({ id: `ChIJJPreal${i}`, name, sourceLocale: "en", lat: 35.6762 + i * 0.0007, lng: 139.6503 + (i % 5) * 0.0006,
      types: [TYPE_MIX[mix](i)], primaryType: TYPE_MIX[mix](i), rating: 4.6, userRatingCount: 10000, address: "Tokyo, Japan", businessStatus: "OPERATIONAL" }));
  };
  // real2 / real4 / real5 type mixes were tried in the previous run: every locale still offered 3 (dropped to save time)
  const SCEN = [["app", "m16"], ["node", "m16"], ["app", "real3"]];
  for (const [nav, pool] of SCEN) {
    globalThis.__POOL = pool === "m16" ? undefined : mkPool(pool);
    for (const loc of LOCS) {
      setNav(nav === "app" ? loc : null);
      const effLoc = g(() => eff.effectiveAppLocale());
      const seen = new Set();
      for (const d of (pool === "m16" ? DAY_TRIES : [3])) {
        H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
        let s = sessionMod.createEmptySession();
        let r1, r2;
        try { r1 = await H.appTurn(s, GO[loc](TOKYO[loc]), loc); s = { ...r1.s, lastAssistantReply: r1.row?.reply ?? "" };
          r2 = await H.appTurn(s, DAYS[loc](d), loc); } catch (e) { R[`B|${nav}:${pool}|${loc}|${d}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
        const st = { ...r2.s, lastAssistantReply: (r2.row?.reply ?? "").replace(/ \/ /g, "\n") };
        const shown = offeredOf(st);
        R[`B|${nav}:${pool}|${loc}|${d}`] = { p: st.pendingQuestion?.type ?? null, n: shown.length, eff: effLoc, reply: (r2.row?.reply ?? "").slice(0, 260) };
        if (st.pendingQuestion?.type !== "combination_choice" || ![2, 3, 4, 5].includes(shown.length) || seen.has(shown.length)) continue;
        seen.add(shown.length);
        const dest = st.pendingQuestion?.baseDestination ?? st.travelContext?.destination ?? "";
        // snapshot the discovery cache state right after the list was shown (App: in-memory, 30 min TTL)
        for (const cache of ["kept", "cleared", ...(pool === "real3" && nav === "app" ? ["syn2", "syn4"] : [])]) {
          for (const w of WORDS) {
            // rebuild the same state for each word (same pool → same combinations)
            H.freshAll(); await H.freshAuthority(); H.setLocale(loc);
            let s1 = sessionMod.createEmptySession();
            const a1 = await H.appTurn(s1, GO[loc](TOKYO[loc]), loc); s1 = { ...a1.s, lastAssistantReply: a1.row?.reply ?? "" };
            const a2 = await H.appTurn(s1, DAYS[loc](d), loc);
            let s2 = { ...a2.s, lastAssistantReply: (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
            if (cache === "syn2" || cache === "syn4") {
              // same discovery cache entry, trimmed to 2 or extended to 4; the shown list is rebuilt from it the way the App builds it
              const raw = discovery.getCachedDiscoveredCombinations(dest, undefined, undefined, { skipLocalizationGate: true }) ?? [];
              let next = structuredClone(raw);
              if (cache === "syn2") next = next.slice(0, 2);
              else if (next.length) {
                const extra = structuredClone(next[0]);
                const ren = (c) => ({ ...c, name: `${c.name} Annex`, originalName: c.originalName ? `${c.originalName} Annex` : c.originalName, localizedDisplayName: c.localizedDisplayName ? `${c.localizedDisplayName} Annex` : c.localizedDisplayName,
                  googlePlaceId: c.googlePlaceId ? `${c.googlePlaceId}X` : c.googlePlaceId, searchCandidateId: c.searchCandidateId ? `${c.searchCandidateId}X` : c.searchCandidateId });
                extra.title = `${extra.title} Plus`; extra.placeCandidates = (extra.placeCandidates ?? []).map(ren);
                if (extra.primaryCandidates) extra.primaryCandidates = extra.primaryCandidates.map(ren);
                if (extra.fallbackCandidates) extra.fallbackCandidates = extra.fallbackCandidates.map(ren);
                next.push(extra);
              }
              discovery.setCachedDiscoveredCombinations(dest, next);
              s2 = { ...s2, travelContext: { ...s2.travelContext, offeredCombinations: combo.buildOfferedCombinationsForSession(dest, loc) } };
            }
            const shown2 = offeredOf(s2);
            if (cache === "cleared") H.fresh();
            const srcList = g(() => combo.getDestinationCombinations(dest).map((c, i) => `${i + 1}.${c.title}`));
            // why the source list differs: per shown place, the filters getDestinationCombinations applies (cache path)
            const cachedN = g(() => discovery.getCachedDiscoveredCombinations(dest)?.length ?? null);
            const placeDiag = shown2.flatMap((c) => c.places.slice(0, 3).map((p) => `${c.id}:${p}[generic=${g(() => combo.dropGenericCombinationLabel(p))} scope=${g(() => combo.isSuggestionInDestinationScope(p, dest))}]`));
            const resolved = g(() => { const x = combo.resolveSelectedCombinations(dest, w); return x ? { idx: x.indexes.map((i) => i + 1), titles: x.titles, src: x.selectionSource } : null; });
            const pending = g(() => pendingMod.parsePendingOptionSelection(w, s2.pendingQuestion));
            let a3;
            try { a3 = await H.appTurn(structuredClone(s2), w, loc); } catch (e) { R[`C|${nav}:${pool}|${loc}|${shown2.length}|${cache}|${w}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
            const tc = a3.s?.travelContext ?? {};
            const sel = tc.selectedCombinationIds ?? [];
            const shownIds = shown2.map((c) => c.id);
            const outside = sel.filter((id) => !shownIds.includes(id));
            const missing = shownIds.filter((id) => !sel.includes(id));
            const reply = a3.row?.reply ?? "";
            const titleHits = shown2.map((c) => ({ id: c.id, inReply: Boolean(c.title) && reply.includes(c.title) }));
            const auth = authMod ? g(() => { const x = authMod.resolveSelectedCombinationAuthority(tc, dest); return x.ok ? { ok: true, ids: x.allowlist.selectedCombinationIds, titles: x.allowlist.allowedTitles, places: x.allowlist.allowedPlaceNames.length } : { ok: false, reason: x.reason }; }) : "n/a";
            const shownPlaces = new Set(shown2.flatMap((c) => c.places));
            const lockedPlaces = tc.selectedCombinationPlaceNames ?? [];
            const placesOutsideShown = lockedPlaces.filter((p) => !shownPlaces.has(p));
            const shownNotLocked = [...shownPlaces].filter((p) => !lockedPlaces.includes(p));
            R[`C|${nav}:${pool}|${loc}|${shown2.length}|${cache}|${w}`] = {
              days: d, eff: effLoc, shown: shown2.map((c) => `${c.id}:${c.title}`), srcList, cachedN, placeDiag: w === "all" ? placeDiag : undefined, dest, allOrAuto: g(() => combo.isUserAllOrAutoCombinationReply(w)), pending, resolved,
              branch: a3.row?.branch ?? null, p: a3.s?.pendingQuestion?.type ?? null, sel, outside, missing, purpose: tc.tripPurpose ?? null,
              afterOffered: offeredOf(a3.s).map((c) => `${c.id}:${c.title}`), titleHits, auth,
              locked: lockedPlaces.length, placesOutsideShown: placesOutsideShown.slice(0, 6), nOutsideShown: placesOutsideShown.length, nShownNotLocked: shownNotLocked.length,
              reply: reply.replace(/\n/g, " / ").slice(0, 240),
            };
          }
        }
      }
      R[`N|${nav}:${pool}|${loc}`] = [...seen];
    }
  }
  setNav(null);
  globalThis.__POOL = undefined;
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@CAP_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-combo-allselect-probe.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@CAP_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  out(`navigator (node default): W ${WR.navNode} | H ${HR?.navNode ?? "n/a"}`);
  out("\n==== B) list builders (days → pending / offered count) ====");
  for (const k of Object.keys(WR).filter((k) => k.startsWith("B|"))) out(`  ${k} W p=${WR[k].p} n=${WR[k].n} eff=${WR[k].eff}${WR[k].err ? ` ERR ${WR[k].err}` : ""} | H p=${HR?.[k]?.p ?? "n/a"} n=${HR?.[k]?.n ?? "n/a"}`);
  for (const k of Object.keys(WR).filter((k) => k.startsWith("N|"))) out(`  ${k} counts covered W=${JSON.stringify(WR[k])} H=${JSON.stringify(HR?.[k] ?? null)}`);
  out("\n==== C) all-select rows ====");
  const table = {};
  for (const k of Object.keys(WR).filter((k) => k.startsWith("C|"))) {
    const w = WR[k]; const h = HR?.[k];
    if (w.err) { out(`  ${k} ERR ${w.err}`); continue; }
    const full = w.sel.length === w.shown.length && !w.outside.length && !w.missing.length;
    const authFull = typeof w.auth === "object" && w.auth.ok && w.auth.ids.length === w.shown.length;
    const titlesOk = w.titleHits.every((x) => x.inReply);
    const verdict = full && authFull && w.nOutsideShown === 0 ? "ALL-OK" : w.sel.length === 0 ? "NONE" : "MISMATCH";
    const [, nav, loc, n, cache, word] = k.split("|");
    table[`${nav}|${cache}|${loc}|${n}`] ??= [];
    table[`${nav}|${cache}|${loc}|${n}`].push(`${word}=${verdict}${titlesOk ? "" : "(title?)"}`);
    const hv = h && !h.err ? (h.sel.length === h.shown.length && !h.outside.length && !h.missing.length ? "ALL-OK" : h.sel.length === 0 ? "NONE" : "MISMATCH") : "n/a";
    out(`  ${k} ${verdict} | H ${hv}${h && !h.err ? ` sel=${JSON.stringify(h.sel)}` : ""}`);
    out(`     dest=${w.dest} shown=${JSON.stringify(w.shown)} src=${JSON.stringify(w.srcList)} cachedN=${w.cachedN}`);
    if (w.placeDiag) out(`     placeDiag=${JSON.stringify(w.placeDiag)}`);
    out(`     allOrAuto=${w.allOrAuto} pending=${JSON.stringify(w.pending)} resolved=${JSON.stringify(w.resolved)}`);
    out(`     [${w.branch}] p=${w.p} purpose=${w.purpose} sel=${JSON.stringify(w.sel)} outside=${JSON.stringify(w.outside)} missing=${JSON.stringify(w.missing)} afterOffered=${JSON.stringify(w.afterOffered)}`);
    out(`     auth=${JSON.stringify(w.auth)} locked=${w.locked} lockedOutsideShown=${w.nOutsideShown}${w.nOutsideShown ? ` e.g.${JSON.stringify(w.placesOutsideShown)}` : ""} shownNotLocked=${w.nShownNotLocked} titleHits=${JSON.stringify(w.titleHits)}`);
    out(`     reply: ${w.reply}`);
  }
  out("\n==== TABLE (nav|cache|locale|offered) ====");
  for (const [k, v] of Object.entries(table)) out(`  ${k}: ${v.join("  ")}`);
  out("SUMMARY probe (read-only, no pass/fail)");
  process.stdout.write("", () => process.exit(0));
}
