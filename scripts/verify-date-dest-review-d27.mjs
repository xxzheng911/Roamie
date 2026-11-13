import "./verify-netguard-full.mjs";
/**
 * D27 (tester, independent review). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice as d25).
 *  p) one-character prefix + category word place names (林百貨 / 森美術館 / 樂美術館 / 栄地下街 / 凪拉麵 / 錦市場商店街 …),
 *     non-category controls (森ビル / 林家花園 / 牛込神楽坂 / 中正紀念堂) and misjudgment probes
 *     (台北喝咖啡 / 台北逛夜市 / 台北好餐廳 / 台北新景點 …): parsers + new-chat turn, W vs H.
 *  r) 「台北無菜單料理／居酒屋／燒肉／鍋物／牛排推薦」: new-chat turn, dest must stay 台北; category signals.
 *  o) おまかせ: delegation wording at the city re-ask (no destination yet) for ja / zh-TW / en (nav=app):
 *     no category route, no Places fetch signal, no candidate, no geocode; 「おまかせ寿司」 → sushi search words;
 *     combos stage 「おまかせで大丈夫です」 never locks an id outside the shown list.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d27.mjs -- --head-dir=<snapshot> [--only=p|r|o]
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
  ["hayashi", "/林百貨|hayashi/i", "Hayashi Department Store", "Tainan", "Taiwan", "TW", 22.9925, 120.2029, ["Hayashi Department Store", "林百貨", "林百貨", "하야시 백화점"]],
  ["tainan", "/tainan|台南|臺南|타이난/i", "Tainan", "Tainan", "Taiwan", "TW", 22.9997, 120.227, ["Tainan", "台南", "台南", "타이난"]],
  ["mori", "/森美術館|mori art/i", "Mori Art Museum", "Tokyo", "Japan", "JP", 35.6604, 139.7292, ["Mori Art Museum", "森美術館", "森美術館", "모리 미술관"]],
  ["raku", "/樂美術館|楽美術館|raku museum/i", "Raku Museum", "Kyoto", "Japan", "JP", 35.0261, 135.7517, ["Raku Museum", "樂美術館", "樂美術館", "라쿠 미술관"]],
  ["sakaechika", "/栄地下街|榮地下街|sakae chika/i", "Sakae Chika", "Aichi", "Japan", "JP", 35.1700, 136.9087, ["Sakae Chika", "榮地下街", "栄地下街", "사카에 지하상가"]],
  ["nagi", "/凪拉麵|ラーメン凪|ramen nagi/i", "Ramen Nagi", "Tokyo", "Japan", "JP", 35.6938, 139.7034, ["Ramen Nagi", "凪拉麵", "ラーメン凪", "라멘 나기"]],
  ["nishiki", "/錦市場|nishiki/i", "Nishiki Market", "Kyoto", "Japan", "JP", 35.005, 135.7649, ["Nishiki Market", "錦市場", "錦市場", "니시키 시장"]],
  ["morib", "/森ビル|mori building/i", "Mori Building", "Tokyo", "Japan", "JP", 35.6605, 139.7293, ["Mori Building", "森大樓", "森ビル", "모리 빌딩"]],
  ["lin", "/林家花園|lin family/i", "Lin Family Mansion and Garden", "New Taipei", "Taiwan", "TW", 25.0110, 121.4554, ["Lin Family Mansion and Garden", "林家花園", "林家花園", "린자화원"]],
  ["ushigome", "/牛込神楽坂|ushigome/i", "Ushigome-kagurazaka", "Tokyo", "Japan", "JP", 35.7012, 139.7357, ["Ushigome-kagurazaka", "牛込神樂坂", "牛込神楽坂", "우시고메카구라자카"]],
  ["ckscm", "/中正紀念堂|chiang kai-shek/i", "Chiang Kai-shek Memorial Hall", "Taipei", "Taiwan", "TW", 25.0346, 121.5218, ["Chiang Kai-shek Memorial Hall", "中正紀念堂", "中正紀念堂", "중정기념당"]],
  ["kyotoc", "/kyoto|京都|교토/i", "Kyoto", "Kyoto", "Japan", "JP", 35.0116, 135.7681, ["Kyoto", "京都市", "京都市", "교토시"]],
  ["nagoya", "/nagoya|名古屋|나고야/i", "Nagoya", "Aichi", "Japan", "JP", 35.1815, 136.9066, ["Nagoya", "名古屋", "名古屋", "나고야"]],
  ["newtaipei", "/new taipei|新北|신베이/i", "New Taipei", "New Taipei", "Taiwan", "TW", 25.012, 121.4657, ["New Taipei", "新北", "新北", "신베이"]],
  ["taipei", "/taipei|台北|臺北|타이베이/i", "Taipei", "Taipei", "Taiwan", "TW", 25.033, 121.5654, ["Taipei", "台北", "台北", "타이베이"]],
  ["taichung", "/taichung|台中|臺中|타이중/i", "Taichung", "Taichung", "Taiwan", "TW", 24.1477, 120.6736, ["Taichung", "台中", "台中", "타이중"]],
  ["kaohsiung", "/kaohsiung|高雄|가오슝/i", "Kaohsiung", "Kaohsiung", "Taiwan", "TW", 22.6273, 120.3014, ["Kaohsiung", "高雄", "高雄", "가오슝"]],
];

// p) [text, expected place regex | null (no area expected: misjudgment probe), kind]
const PLACES = [
  ["台南林百貨", /林百貨/, "1char+cat"], ["東京森美術館", /森美術館/, "1char+cat"], ["京都樂美術館", /樂美術館/, "1char+cat"],
  ["名古屋栄地下街", /栄地下街/, "1char+cat"], ["名古屋榮地下街", /榮地下街/, "1char+cat"], ["東京凪拉麵", /凪拉麵/, "1char+cat"],
  ["京都錦市場商店街", /錦市場/, "1char+cat"], ["林百貨", /林百貨/, "bare"], ["森美術館", /森美術館/, "bare"], ["樂美術館", /樂美術館/, "bare"],
  ["東京森ビル", /森ビル/, "control"], ["新北林家花園", /林家花園/, "control"], ["東京牛込神楽坂", /牛込神楽坂/, "control"], ["台北中正紀念堂", /中正紀念堂/, "control"],
  ["台北喝咖啡", null, "probe"], ["台北吃火鍋", null, "probe"], ["台北逛夜市", null, "probe"], ["台中逛百貨", null, "probe"], ["東京吃拉麵", null, "probe"],
  ["台北好餐廳", null, "probe"], ["台北新景點", null, "probe"], ["台南老咖啡", null, "probe"], ["高雄大夜市", null, "probe"], ["東京有名拉麵", null, "probe"],
  ["台北去夜市", null, "probe"], ["東京看美術館", null, "probe"],
];
const GO = (t) => `我想去${t}`;

// r) 台北 + category recommendation
const R4 = ["台北無菜單料理推薦", "台北居酒屋推薦", "台北燒肉推薦", "台北鍋物推薦", "台北牛排推薦", "台北無菜單料理", "台北無菜單推薦", "台北omakase推薦"];

// o) delegation at city re-ask
// First turn candidates; the first one that reaches the destination clarification (13226) is the re-ask stage.
const ASK_CITY = { ja: ["旅行したい", "旅行の計画を立てたい", "どこか旅行に行きたい", "旅行に行きたい", "旅行プランを作って"], "zh-TW": ["我想去旅行", "幫我規劃旅行"],
  en: ["I want to travel", "I want to plan a trip", "Plan a trip for me", "help me plan a trip", "I want to go on a trip"] };
const OMA = ["おまかせ", "全部おまかせ", "おまかせでいいよ", "じゃあおまかせで", "おまかせしたい", "おまかせで大丈夫です"];
const SUSHI = ["おまかせ寿司", "東京のおまかせ寿司", "おまかせ寿司が食べたい"];

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const dtp = await load("src/lib/ai/destination-travel-profile.ts");
  const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
  const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
  const chatIntent = await load("src/lib/ai/chat-intent.ts");
  const mustVisit = await load("src/lib/ai/must-visit-places.ts");
  const catDest = await load("src/lib/ai/chat-category-destination.ts");
  const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
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
  const reset = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const offeredIds = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => c.id);
  const sig = (s, t) => {
    const pc = g(() => mustVisit.mergeContextForPlaceFetch(s.travelContext ?? { interests: [] }, s));
    const pcObj = typeof pc === "object" ? pc : (s.travelContext ?? { interests: [] });
    return { hasCat: g(() => catTypes.hasCategoryPlaceQuery(t)), catIntents: g(() => placeIntent.parseChatPlaceIntents(t).join(",") || "-"),
      catFetch: g(() => placeIntent.shouldFetchDestinationCategoryPlaces(t, pcObj, s)), destFetch: g(() => mustVisit.shouldFetchDestinationPlaces(t, pcObj, s)),
      nearby: g(() => chatIntent.userExplicitlyWantsNearbyPlaces(t)), catDest: g(() => catDest.resolveDestinationForCategorySearch(pcObj, s, t) ?? null),
      allOrAuto: g(() => combo.isUserAllOrAutoCombinationReply(t)) };
  };
  const turnS = async (s0, t, loc) => {
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(structuredClone(s0), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const q = geoLogs().flatMap((l, i) => l.slice(n0[i]).map((x) => `${["g", "a", "d"][i]}:${x}`));
      return { s, row: { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null, tpcDest: s.tripPlanningContext?.destination ?? null,
        area: s.preferredArea ?? tc.destinationArea ?? null, cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
        geo: q.length, q: q.join("|"), sel: tc.selectedCombinationIds ?? [], placesCalls: r.row?.placesCalls ?? null, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 160) } };
    } catch (e) { return { s: null, row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 } }; }
  };
  const parsers = (u) => {
    const e = sessionMod.createEmptySession();
    return {
      parse: g(() => tpc.parseDestinationFromText(u) ?? null), resolve: g(() => tpc.resolveDestinationFromText(u) ?? null),
      tripIntent: g(() => { const x = tripIntent.parseTripIntentFromText(u, structuredClone(e)); return `city=${x.destinationCity ?? "-"} area=${x.destinationArea ?? "-"}`; }),
      merge: g(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); return `dest=${m.context.destination ?? "-"} cand=${m.context.destinationCandidate?.raw ?? "-"}`; }),
      gpt: g(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"}`; }),
      areaScope: g(() => dtp.resolveDestinationAreaScope(u)?.displayLabel ?? null),
      provisional: g(() => { const p = dtp.extractProvisionalDestinationAreaCandidate(u); return p ? (p.rawLabel ?? p.displayLabel ?? JSON.stringify(p).slice(0, 60)) : null; }),
      hasCat: g(() => catTypes.hasCategoryPlaceQuery(u)),
    };
  };

  if (want("p")) {
    setNav("zh-TW");
    for (const [t] of PLACES) for (const u of [t, GO(t)]) {
      R[`PP|${u}`] = parsers(u);
      await reset("zh-TW");
      R[`PT|${u}`] = (await turnS(sessionMod.createEmptySession(), u, "zh-TW")).row;
    }
    setNav(null);
  }
  if (want("r")) {
    setNav("zh-TW");
    for (const t of R4) {
      await reset("zh-TW");
      const f = await turnS(sessionMod.createEmptySession(), t, "zh-TW");
      const s1 = f.s ?? sessionMod.createEmptySession();
      let attempts = "n/a";
      const intents = g(() => placeIntent.parseChatPlaceIntents(t));
      if (Array.isArray(intents) && intents.length) attempts = g(() => placeIntent.buildChatPlaceSearchAttempts(intents[0], "台北", t).primary.map((a) => a.query).join(" || "));
      R[`R|${t}`] = { row: f.row, parsers: parsers(t), sig: sig(sessionMod.createEmptySession(), t), sigAfter: sig(s1, t), attempts };
    }
    setNav(null);
  }
  if (want("o")) {
    for (const loc of ["ja", "zh-TW", "en"]) {
      setNav(loc);
      let a1 = null;
      for (const first of ASK_CITY[loc]) {
        await reset(loc);
        const r1 = await turnS(sessionMod.createEmptySession(), first, loc);
        R[`OA0|${loc}|${first}`] = r1.row;
        if (!a1 && /13226/.test(r1.row.b ?? "")) { a1 = { ...r1, first }; }
      }
      const askCity = a1 ? { ...(a1.s ?? sessionMod.createEmptySession()), lastAssistantReply: (a1.row.reply ?? "").replace(/ \/ /g, "\n") } : null;
      R[`OA|${loc}`] = a1 ? { ...a1.row, first: a1.first } : { b: "NO_ASK_CITY_STAGE" };
      for (const t of [...OMA, ...SUSHI]) {
        if (askCity) {
          await reset(loc);
          const f = await turnS(askCity, t, loc);
          R[`O|${loc}|askCity|${t}`] = { ...f.row, sig: sig(askCity, t) };
        }
        await reset(loc);
        const fn = await turnS(sessionMod.createEmptySession(), t, loc);
        R[`O|${loc}|new|${t}`] = { ...fn.row, sig: sig(sessionMod.createEmptySession(), t) };
      }
      for (const t of SUSHI) {
        const intents = g(() => placeIntent.parseChatPlaceIntents(t));
        R[`OS|${loc}|${t}`] = { intents, attempts: Array.isArray(intents) && intents.length ? g(() => { const x = placeIntent.buildChatPlaceSearchAttempts(intents[0], "東京", t); return [...x.primary, ...x.fallback].map((a) => a.query).join(" || "); }) : "n/a" };
      }
      // combos stage: shown ids vs locked ids
      await reset(loc);
      const GOx = { ja: "東京へ旅行", "zh-TW": "我要去東京", en: "I'm going to Tokyo" }[loc];
      const DAYS = { ja: "3日間", "zh-TW": "3天", en: "3 days" }[loc];
      const c1 = await H.appTurn(sessionMod.createEmptySession(), GOx, loc);
      const c2 = await H.appTurn({ ...c1.s, lastAssistantReply: c1.row?.reply ?? "" }, DAYS, loc);
      const combos = { ...c2.s, lastAssistantReply: (c2.row?.reply ?? "").replace(/ \/ /g, "\n") };
      for (const t of ["おまかせで大丈夫です", "おまかせ", "全部おまかせ"]) {
        const f = await turnS(combos, t, loc);
        const shown = offeredIds(combos);
        R[`OC|${loc}|${t}`] = { ...f.row, shown, outside: (f.row.sel ?? []).filter((id) => !shown.includes(id)), pre: combos.pendingQuestion?.type ?? null };
      }
    }
    setNav(null);
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D27_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d27.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 290_000, maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@D27_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} area=${x.area ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const hit = (x, re) => Boolean(x) && ([x.dest, x.trip, x.tpcDest, x.area, x.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v))) || re.test(x.q ?? ""));
  if (want("p")) {
    out("==== P) one-character prefix + category place names / controls / probes (W | H) ====");
    for (const [t, re, kind] of PLACES) for (const u of [t, GO(t)]) {
      const pw = WR[`PP|${u}`]; const ph = HR?.[`PP|${u}`]; const w = WR[`PT|${u}`]; const h = HR?.[`PT|${u}`];
      out(`  「${u}」 (${kind})\n     Wp area=${pw.areaScope} prov=${pw.provisional} parse=${pw.parse} trip=${pw.tripIntent} merge=${pw.merge} gpt=${pw.gpt} hasCat=${pw.hasCat}\n     Hp ${ph ? `area=${ph.areaScope} prov=${ph.provisional} parse=${ph.parse} trip=${ph.tripIntent} merge=${ph.merge} gpt=${ph.gpt} hasCat=${ph.hasCat}` : "n/a"}\n     W ${fa(w)}\n     H ${fa(h)}`);
      if (re) {
        if (h && hit(h, re) && !hit(w, re)) fail(`P|${u}#turn`, `REGRESSION place lost in turn: W ${fa(w)} | H ${fa(h)}`);
        if (ph?.areaScope && re.test(String(ph.areaScope)) && !(pw.areaScope && re.test(String(pw.areaScope)))) fail(`P|${u}#areaScope`, `REGRESSION area lost: W=${pw.areaScope} H=${ph.areaScope}`);
        if (!hit(w, re)) notes.push(`P 「${u}」 place not in W turn (HEAD ${h ? (hit(h, re) ? "hit" : "miss") : "n/a"}): ${fa(w)}`);
      } else {
        // probe: the category tail must not become a geographic area / candidate / geocode query that HEAD did not make
        const tail = (x) => [x?.area, x?.cand?.split("/")[0], ...(x?.q ?? "").split("|").map((q) => q.replace(/^[gad]:/, ""))].filter(Boolean).filter((v) => !/^(台北|台中|台南|高雄|東京|Taipei|Tokyo)$/.test(String(v)));
        const wt = tail(w); const ht = tail(h);
        if (wt.length && JSON.stringify(wt) !== JSON.stringify(ht)) fail(`P|${u}#probe`, `category tail read as a place (HEAD ${JSON.stringify(ht)}): ${fa(w)}`);
        if (pw.areaScope && pw.areaScope !== ph?.areaScope) fail(`P|${u}#probeArea`, `areaScope W=${pw.areaScope} H=${ph?.areaScope}`);
      }
      if (h && (h.b !== w.b || h.dest !== w.dest || h.area !== w.area || h.cand !== w.cand)) notes.push(`P turn diff 「${u}」: W ${fa(w)} | H ${fa(h)}`);
      for (const f of ["areaScope", "provisional", "parse", "tripIntent", "merge", "gpt"]) if (ph && JSON.stringify(ph[f]) !== JSON.stringify(pw[f])) notes.push(`P parser diff 「${u}」 ${f}: W=${JSON.stringify(pw[f])} H=${JSON.stringify(ph[f])}`);
    }
  }
  if (want("r")) {
    out("\n==== R) 台北 + category recommendation (W | H) ====");
    for (const t of R4) {
      const w = WR[`R|${t}`]; const h = HR?.[`R|${t}`];
      out(`  「${t}」\n     W ${fa(w.row)} sig=${JSON.stringify(w.sig)} attempts=${w.attempts}\n       parsers=${JSON.stringify(w.parsers)}\n     H ${fa(h?.row)} sig=${JSON.stringify(h?.sig ?? null)} attempts=${h?.attempts ?? "n/a"}`);
      const bad = [w.row.dest, w.row.area, w.row.trip, w.row.cand?.split("/")[0]].filter(Boolean).filter((v) => !/^(台北|Taipei)$/.test(String(v)));
      const catDestOk = /台北/.test(String(w.sig.catDest));
      if (bad.length) fail(`R|${t}#dest`, `non-台北 dest/area/cand: ${JSON.stringify(bad)} ${fa(w.row)}`);
      if (w.row.geo > 0 && !/^[gad]:台北$/.test(w.row.q)) fail(`R|${t}#geo`, `geocode ${w.row.q}`);
      if (w.sig.hasCat === true && !catDestOk) fail(`R|${t}#catDest`, `category search area ${w.sig.catDest}`);
    }
  }
  if (want("o")) {
    out("\n==== O) おまかせ at the city re-ask / new chat / combos (nav=app) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("OA0|"))) {
      out(`  ${k} first-turn candidate W ${fa(WR[k])} reply: ${WR[k]?.reply} | H ${fa(HR?.[k])}`);
      // pre-existing check (reported, compared with HEAD): a wish phrase without a place is never a destination label
      const w = WR[k]; const h = HR?.[k];
      if (w?.dest && !/13226/.test(w.b ?? "")) notes.push(`FIRST-TURN ${k}: phrase without a place became dest=${w.dest} (HEAD dest=${h?.dest ?? "n/a"})`);
    }
    for (const loc of ["ja", "zh-TW", "en"]) {
      out(`  OA|${loc} re-ask stage via 「${WR[`OA|${loc}`]?.first ?? "-"}」 ${fa(WR[`OA|${loc}`])}`);
      if (WR[`OA|${loc}`]?.b === "NO_ASK_CITY_STAGE") notes.push(`OA|${loc}: no first-turn candidate reached the destination clarification (re-ask stage not verified for ${loc})`);
    }
    for (const k of Object.keys(WR).filter((k) => k.startsWith("O|"))) {
      const w = WR[k]; const h = HR?.[k]; const t = k.split("|").slice(3).join("|");
      out(`  ${k}\n     W ${fa(w)} sig=${JSON.stringify(w.sig)}\n       reply: ${w.reply}\n     H ${fa(h)} sig=${JSON.stringify(h?.sig ?? null)}\n       reply: ${h?.reply ?? "-"}`);
      if (OMA.includes(t)) {
        if (/category/.test(w.b ?? "")) fail(k, `delegation routed to category: [${w.b}]`);
        if (w.sig.catFetch === true || w.sig.destFetch === true) fail(`${k}#places`, `Places fetch signal: catFetch=${w.sig.catFetch} destFetch=${w.sig.destFetch}`);
        if (w.geo > 0) fail(`${k}#geo`, `geocode ${w.q}`);
        if (w.cand) fail(`${k}#cand`, `candidate ${w.cand}`);
        if (w.dest && !/東京|Tokyo/.test(w.dest)) fail(`${k}#dest`, `dest ${w.dest}`);
        if (h && (h.b !== w.b || h.dest !== w.dest || h.p !== w.p || h.cand !== w.cand || h.geo !== w.geo)) notes.push(`O diff ${k}: W ${fa(w)} | H ${fa(h)}`);
      }
      if (SUSHI.includes(t) && !/category/.test(w.b ?? "")) notes.push(`${k}: sushi wording not routed to category [${w.b}] (H [${h?.b}])`);
    }
    for (const k of Object.keys(WR).filter((k) => k.startsWith("OS|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k} W intents=${JSON.stringify(w.intents)} attempts=${w.attempts}\n       H intents=${JSON.stringify(h?.intents ?? null)} attempts=${h?.attempts ?? "n/a"}`);
      if (!/寿司|壽司|sushi/i.test(String(w.attempts))) fail(`${k}#sushi`, `search attempts miss sushi: ${w.attempts}`);
    }
    for (const k of Object.keys(WR).filter((k) => k.startsWith("OC|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k} pre=${w.pre} shown=${JSON.stringify(w.shown)} W sel=${JSON.stringify(w.sel)} outside=${JSON.stringify(w.outside)} [${w.b}] | H sel=${JSON.stringify(h?.sel ?? null)} [${h?.b}]`);
      if (w.outside?.length) fail(k, `locked ids outside the shown list ${JSON.stringify(w.outside)}`);
      if (k.endsWith("|おまかせ") && w.pre === "combination_choice" && w.sel.length !== w.shown.length) fail(`${k}#all`, `whole おまかせ did not select all shown: ${JSON.stringify(w.sel)} / ${JSON.stringify(w.shown)}`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
