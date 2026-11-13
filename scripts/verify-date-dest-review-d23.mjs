import "./verify-netguard-full.mjs";
/**
 * D23 (tester, independent review). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice / seeds / fixtures as d21).
 *  e) 「eat」 residue fix #2 (NON_PLACE_EN_NEARBY_RE): self-written en food sentences — unit parsers, new chat,
 *     new chat → Kinosaki, re-ask → sentence → Kinosaki, ×4 locales. 「places to eat in Tokyo」 must reach Tokyo.
 *  c) ② item 1 read-only: 「台北無菜單料理推薦」 and other city + category sentences — every destination parser,
 *     and the App-order turn at new chat / Tokyo ask_days / Tokyo done (trip already generated).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d23.mjs -- --head-dir=<snapshot> [--only=e|c]
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

const LOCS = ["zh-TW", "en", "ja", "ko"];
const CAND_SEED = { "zh-TW": ["我想去草津溫泉"], en: ["I want to go to Kusatsu Onsen"], ja: ["草津温泉に行きたい", "由布院に行きたい"], ko: ["오키나와 여행", "쿠사츠 온천 여행"] };
const SYN_RAW = { "zh-TW": "草津溫泉", en: "Kusatsu Onsen", ja: "草津温泉", ko: "오키나와" };
const NO = { "zh-TW": "不是", en: "no", ja: "いいえ", ko: "아니요" };
const DAYS = { "zh-TW": "3天", en: "3 days", ja: "3日間", ko: "3일" };
const GO = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const TOKYO = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const KINO_RE = /kinosaki|城崎|키노사키/i;
const TOKYO_RE = /tokyo|東京|도쿄/i;
const EAT_DEST_RE = /^(?:(?:any|some)thing\s+)?(?:good\s+)?(?:to\s+)?eat\b|\bto eat\b|^here$|^me$|^nearby$|near me|around here/i;

const EXTRA_FIX = [
  ["kinosaki", "/kinosaki|城崎|키노사키/i", "Kinosaki", "Hyogo", "Japan", "JP", 35.6255, 134.8093, ["Kinosaki", "城崎", "城崎", "키노사키"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["taipei", "/taipei|台北|臺北|타이베이/i", "Taipei", "Taipei", "Taiwan", "TW", 25.033, 121.5654, ["Taipei", "台北", "台北", "타이베이"]],
  ["seoul", "/seoul|首爾|首尔|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
];

// self-written en food sentences (task: ≥ 8) + the three required ones
const EAT = ["where can I eat?", "somewhere to eat", "best place to eat", "I want to eat sushi", "let's eat", "places to eat in Tokyo", "what to eat here",
  "eat and drink", "anything to eat?", "good places to eat", "where to eat nearby", "I'm hungry, where should we eat?",
  "anything good to eat?", "something good to eat", "is there anything good to eat here?"];
const EAT_UNIT = [...EAT, "eat", "eat here", "to eat", "eat nearby", "good to eat", "nearby", "near me", "around here", "Good to Eat Cafe", "Near Islands", "Linear Park", "Nearchos", "Eaton", "Eat Street", "附近", "近く", "근처", "Kinosaki", "Tokyo"];

// city + category sentences (② item 1)
const CAT = ["台北無菜單料理推薦", "台北咖啡廳推薦", "東京拉麵推薦", "京都溫泉推薦", "台北居酒屋推薦", "台北燒肉推薦", "台北鍋物推薦", "台北牛排推薦", "台北無菜單推薦", "台北 omakase 推薦", "推薦台北無菜單料理", "台北的無菜單料理推薦"];

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
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
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const planSession = await load("src/lib/ai/ai-planning-session.ts");
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const H = await new AsyncFunction("load", "loadOpt", "readFileSync", "storageWrites",
    slice + "\nreturn { appTurn, freshAll, freshAuthority, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      tpcDest: s.tripPlanningContext?.destination ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      days: tc.days ?? s.tripDays ?? null, offered: (tc.offeredCombinations ?? []).length, phase: s.phase ?? null, lastTrip: s.lastGeneratedTripId ?? null,
      sid: s.planningSessionId ?? null, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 200) };
  };
  const logs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const turnS = async (s0, t, loc) => {
    const n0 = logs().map((l) => l.length);
    try { const r = await H.appTurn(structuredClone(s0), t, loc); const q = logs().flatMap((l, i) => l.slice(n0[i]).map((x) => `${["g", "a", "d"][i]}:${x}`)); return { row: { ...snap(r), geo: q.length, q: q.join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 }, s: null }; }
  };
  const fresh = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const nextOf = (a) => ({ ...a.s, lastAssistantReply: (a.row.reply ?? "").replace(/ \/ /g, "\n") });
  const seedFor = async (loc) => {
    for (const t of CAND_SEED[loc]) {
      await fresh(loc);
      let r; try { r = await H.appTurn(sessionMod.createEmptySession(), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: { ...r.s, lastAssistantReply: (r.row?.reply ?? "") } };
    }
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...sessionMod.createEmptySession(), lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };
  const runFrom = async (loc, start, steps) => {
    await fresh(loc);
    let cur = start; const rows = []; const states = [cur];
    for (const t of steps) {
      const a = await turnS(cur, t, loc);
      rows.push({ t, ...a.row });
      if (!a.s) break;
      cur = nextOf(a); states.push(cur);
    }
    return { rows, states };
  };
  const guard = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 60)}`; } };
  const parsers = (u, base) => {
    const e = base ?? sessionMod.createEmptySession();
    return {
      nonPlace: guard(() => tpc.isNonPlaceDestinationText(u)), valid: guard(() => tpc.isValidParsedDestinationLabel(u)),
      parse: guard(() => tpc.parseDestinationFromText(u) ?? null), resolve: guard(() => tpc.resolveDestinationFromText(u) ?? null),
      tripIntent: guard(() => { const x = tripIntent.parseTripIntentFromText(u, structuredClone(e)); return `city=${x.destinationCity ?? "-"} area=${x.destinationArea ?? "-"}`; }),
      applyTripIntent: guard(() => { const x = tripIntent.applyTripIntentToSession(u, structuredClone(e)); return `tc=${x.travelContext?.destination ?? "-"} tpc=${x.tripPlanningContext?.destination ?? "-"} trip=${x.tripDestination?.city ?? "-"}`; }),
      merge: guard(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); return `dest=${m.context.destination ?? "-"} cand=${m.context.destinationCandidate?.raw ?? "-"}`; }),
      gpt: guard(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"}`; }),
    };
  };

  if (want("e")) {
    const seeds = {};
    for (const loc of LOCS) { seeds[loc] = await seedFor(loc); R[`SEED|${loc}`] = { seed: seeds[loc].seed }; }
    for (const u of EAT_UNIT) R[`EU|${u}`] = parsers(u);
    for (const loc of LOCS) {
      for (const v of EAT) {
        await fresh(loc); const f = await turnS(sessionMod.createEmptySession(), v, loc);
        const fk = f.s ? await turnS(nextOf(f), "Kinosaki", loc) : null;
        const re = await runFrom(loc, seeds[loc].s1, [NO[loc], v, "Kinosaki"]);
        R[`EV|${loc}|${v}`] = { fresh: f.row, freshKino: fk?.row ?? null, reask: re.rows };
      }
    }
  }

  if (want("c")) {
    const chatIntent = await load("src/lib/ai/chat-intent.ts");
    const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
    const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
    const catDest = await load("src/lib/ai/chat-category-destination.ts");
    const destTravelProfile = await load("src/lib/ai/destination-travel-profile.ts");
    const mustVisit = await load("src/lib/ai/must-visit-places.ts");
    const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
    const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
    const loc = "zh-TW";
    const stages = { new: sessionMod.createEmptySession() };
    const tk = await runFrom(loc, sessionMod.createEmptySession(), [GO[loc](TOKYO[loc]), DAYS[loc], "1"]);
    R["CS|tokyo"] = tk.rows;
    stages.tokyoAskDays = tk.states[1];
    const st3 = tk.states[3];
    stages.tokyoDone = st3 && planSession.clearPlanningSessionState({ ...structuredClone(st3), phase: "done", aiItineraryState: "SUCCESS", lastGeneratedTripId: "trip_tokyo" }, "trip_created");
    for (const t of CAT) {
      R[`CP|${t}`] = {
        ...parsers(t),
        hasCat: guard(() => catTypes.hasCategoryPlaceQuery(t)), catIntents: guard(() => placeIntent.parseChatPlaceIntents(t).join(",") || "-"),
        catSwitch: guard(() => tpc.categorySwitchSearchText(t) ?? null),
        areaScope: guard(() => destTravelProfile.resolveDestinationAreaScope(t)?.displayLabel ?? null),
        provisional: guard(() => { const p = destTravelProfile.extractProvisionalDestinationAreaCandidate(t); return p ? (p.rawLabel ?? JSON.stringify(p).slice(0, 80)) : null; }),
        catDestNew: guard(() => catDest.resolveDestinationForCategorySearch({ interests: [] }, sessionMod.createEmptySession(), t) ?? null),
        coerce: guard(() => tpc.coerceTravelDestination(t) ?? null),
      };
      for (const [stage, s0] of Object.entries(stages)) {
        if (!s0) { R[`CT|${t}|${stage}`] = { missing: true }; continue; }
        const pc0 = guard(() => mustVisit.mergeContextForPlaceFetch(s0.travelContext ?? { interests: [] }, s0));
        const before = snap({ s: s0, row: {} });
        await fresh(loc);
        const a = await turnS(s0, t, loc);
        const n = a.s ?? s0;
        const pc = guard(() => mustVisit.mergeContextForPlaceFetch(n.travelContext ?? { interests: [] }, n));
        const pcObj = typeof pc === "object" ? pc : (n.travelContext ?? { interests: [] });
        const catFetch = guard(() => placeIntent.shouldFetchDestinationCategoryPlaces(t, pcObj, n));
        R[`CT|${t}|${stage}`] = { before, turn: a.row,
          sig: { parsersOnStage: parsers(t, s0), catDestStage: guard(() => catDest.resolveDestinationForCategorySearch(typeof pc0 === "object" ? pc0 : { interests: [] }, s0, t) ?? null),
            catFetch, arb: guard(() => arbitrate.resolveChatIntentArbitration(t, structuredClone(s0)).route),
            authority: guard(() => nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: false, resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pcObj, t, n) ?? null, categoryPlaceQuery: catFetch === true })) } };
      }
    }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D23_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d23.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D23_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} days=${x.days ?? "-"} lastTrip=${x.lastTrip ?? "-"} phase=${x.phase ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const took = (x, re) => [x?.dest, x?.trip, x?.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v)));
  const eatBad = (x) => [x?.dest, x?.trip, x?.tpcDest, x?.cand?.split("/")[0]].filter(Boolean).some((v) => EAT_DEST_RE.test(String(v).trim()))
    || (x?.q ?? "").split("|").filter(Boolean).some((q) => EAT_DEST_RE.test(q.replace(/^[gad]:/, "").trim()));
  if (want("e")) {
    out("==== seeds ====");
    for (const loc of LOCS) out(`-- ${loc} W seed=${WR[`SEED|${loc}`]?.seed} | H seed=${HR?.[`SEED|${loc}`]?.seed ?? "n/a"}`);
    out("\n==== EU) unit parsers (W | H) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("EU|"))) {
      const u = k.slice(3); const w = WR[k]; const h = HR?.[k];
      out(`  「${u}」\n     W ${JSON.stringify(w)}\n     H ${JSON.stringify(h ?? null)}`);
      for (const f of ["parse", "resolve"]) if (typeof w[f] === "string" && EAT_DEST_RE.test(w[f])) fail(`${k}#${f}`, `eat residue as destination: ${w[f]}`);
      if (/city=([^ ]+)/.test(w.tripIntent) && EAT_DEST_RE.test(w.tripIntent.match(/city=(.*?) area=/)?.[1] ?? "")) fail(`${k}#tripIntent`, w.tripIntent);
      if (["eat nearby", "nearby", "near me", "around here", "good to eat", "eat", "eat here"].includes(u) && w.nonPlace !== true) fail(k, "must stay non-place");
      if (["Good to Eat Cafe", "Near Islands", "Linear Park", "Nearchos", "Eaton", "Eat Street", "Kinosaki", "Tokyo"].includes(u) && w.nonPlace !== false) fail(k, "real / shop name blocked");
      if (["附近", "近く", "근처"].includes(u) && h && h.valid !== w.valid) fail(k, `CJK changed valid W=${w.valid} H=${h.valid}`);
    }
    out("\n==== EV) en food sentences: new chat / new→Kinosaki / re-ask → sentence → Kinosaki ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("EV|"))) {
      const w = WR[k]; const h = HR?.[k]; const v = k.split("|").slice(2).join("|");
      const rv = w.reask[1]; const rk = w.reask[2];
      out(`  ${k}\n     new W ${fa(w.fresh)}\n         W reply: ${w.fresh?.reply ?? "-"}\n     new H ${fa(h?.fresh)}\n         H reply: ${h?.fresh?.reply ?? "-"}\n     new→Kino W ${fa(w.freshKino)} | H ${fa(h?.freshKino)}\n     reask W ${fa(rv)} → Kino ${fa(rk)}\n         W reply: ${rv?.reply ?? "-"}\n     reask H ${fa(h?.reask?.[1])} → Kino ${fa(h?.reask?.[2])}`);
      for (const [lab, x] of [["new", w.fresh], ["reask", rv], ["newKino", w.freshKino], ["reaskKino", rk]]) if (eatBad(x)) fail(`${k}#${lab}`, `eat residue as dest / cand / geocode: ${fa(x)}`);
      if (v === "places to eat in Tokyo") {
        const ok = took(w.fresh, TOKYO_RE) || (w.fresh?.q ?? "").match(TOKYO_RE);
        if (!ok) {
          const hok = h && (took(h.fresh, TOKYO_RE) || (h.fresh?.q ?? "").match(TOKYO_RE));
          if (hok) fail(`${k}#Tokyo`, `REGRESSION: HEAD reached Tokyo, W not: W ${fa(w.fresh)} | H ${fa(h.fresh)}`);
          else notes.push(`EV ${k} new chat did not reach Tokyo (HEAD same/n.a.): W ${fa(w.fresh)} | H ${fa(h?.fresh)}`);
        }
      }
      if (!rk || !(rk.geo === 1 && rk.p === "ask_days" && took(rk, KINO_RE))) {
        const hk = h?.reask?.[2];
        if (hk && hk.geo === 1 && hk.p === "ask_days" && took(hk, KINO_RE)) fail(`${k}#Kino`, `REGRESSION re-ask → sentence → Kinosaki: W ${fa(rk)} | H ${fa(hk)}`);
        else notes.push(`EV ${k} re-ask → sentence → Kinosaki not ask_days/geo1 (HEAD same/n.a.): W ${fa(rk)} | H ${fa(hk)}`);
      }
      if (h && h.fresh && (h.fresh.b !== w.fresh?.b || h.fresh.dest !== w.fresh?.dest || h.fresh.p !== w.fresh?.p)) notes.push(`EV new-chat diff vs HEAD ${k}: W ${fa(w.fresh)} | H ${fa(h.fresh)}`);
    }
  }
  if (want("c")) {
    out("\n==== CS) Tokyo stage builder ====");
    out(`  W ${(WR["CS|tokyo"] ?? []).map((r) => `「${r.t}」[${r.b}] p=${r.p} dest=${r.dest} off=${r.offered}`).join(" → ")}`);
    out(`  H ${(HR?.["CS|tokyo"] ?? []).map((r) => `「${r.t}」[${r.b}] p=${r.p} dest=${r.dest} off=${r.offered}`).join(" → ")}`);
    out("\n==== CP) city + category parsers (W | H) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("CP|"))) out(`  「${k.slice(3)}」\n     W ${JSON.stringify(WR[k])}\n     H ${JSON.stringify(HR?.[k] ?? null)}`);
    out("\n==== CT) city + category turns (zh-TW) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("CT|"))) {
      const w = WR[k]; const h = HR?.[k];
      if (w.missing) { out(`  ${k}: stage missing`); continue; }
      out(`  ${k}\n     before ${fa(w.before)}\n     W ${fa(w.turn)}\n         reply: ${w.turn.reply}\n     H ${fa(h?.turn)}\n         reply: ${h?.turn?.reply ?? "-"}\n     sig W ${JSON.stringify(w.sig)}\n     sig H ${JSON.stringify(h?.sig ?? null)}`);
      const t = k.split("|")[1];
      if (/無菜單/.test(t) && [w.turn.dest, w.turn.trip, w.turn.cand?.split("/")[0]].some((x) => /無菜單/.test(x ?? ""))) notes.push(`CT ${k}: destination carries the category word: ${fa(w.turn)} (H ${fa(h?.turn)})`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
