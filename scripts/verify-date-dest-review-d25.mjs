import "./verify-netguard-full.mjs";
/**
 * D25 (tester, independent review). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice as d23 / combo-allselect-probe).
 *  t) "leave 30 minutes, come back and say 全部": the list is shown at T0, the clock (Date) is advanced by 31 min
 *     (every TTL cache — discovery / candidate pool / resolved scope — expires by the clock, nothing is cleared by hand),
 *     then the all-select word is sent. Variants: same pool on re-discovery / a different pool on re-discovery.
 *     Offered count 2/3/4 (natural from trip days + the cache trimmed / extended before the list is built).
 *  x) soft-accept / all + extension / numbered picks at combination_choice (Tokyo 3 days), ×4 locales, W vs H.
 *  e) extra en food sentences (self-written): parsers + new chat turn + new chat → Kinosaki, W vs H.
 *  a) place names that contain a category word (夜市 / 商圈 / 溫泉 / 市場 / 居酒屋 / 美術館 / 百貨…): parsers + new-chat turn, W vs H.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d25.mjs -- --head-dir=<snapshot> [--only=t|x|e|a]
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
let OFFSET = 0;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW + OFFSET); else super(...a); }
  static now() { return NOW + OFFSET; }
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
// App device locale (same axis as verify-combo-allselect-probe: nav=app → navigator.language = chat locale; nav=node → Node default)
const NAV0 = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const NAV_LANG = { "zh-TW": "zh-TW", en: "en-US", ja: "ja-JP", ko: "ko-KR" };
const setNav = (loc) => {
  if (!loc) { if (NAV0) Object.defineProperty(globalThis, "navigator", NAV0); else delete globalThis.navigator; return; }
  Object.defineProperty(globalThis, "navigator", { value: { language: NAV_LANG[loc], languages: [NAV_LANG[loc]], userAgent: "probe" }, configurable: true, writable: true });
};

const LOCS = ["zh-TW", "en", "ja", "ko"];
const GO = { "zh-TW": (c) => `我要去${c}`, en: (c) => `I'm going to ${c}`, ja: (c) => `${c}へ旅行`, ko: (c) => `${c} 여행` };
const DAYS = { "zh-TW": (d) => `${d}天`, en: (d) => `${d} days`, ja: (d) => `${d}日間`, ko: (d) => `${d}일` };
const TOKYO = { "zh-TW": "東京", en: "Tokyo", ja: "東京", ko: "도쿄" };
const REQ_WORDS = ["all", "全部", "すべて", "전부", "おまかせ", "お任せします"];
const EXTRA_WORDS = ["all of them", "全部都要", "全部で", "전부 다"];
const MIN31 = 31 * 60 * 1000;

const EXTRA_FIX = [
  ["kinosaki", "/kinosaki|城崎|키노사키/i", "Kinosaki", "Hyogo", "Japan", "JP", 35.6255, 134.8093, ["Kinosaki", "城崎", "城崎", "키노사키"]],
  ["shibuya", "/shibuya|渋谷|澀谷|涩谷|시부야/i", "Shibuya", "Tokyo", "Japan", "JP", 35.6618, 139.7041, ["Shibuya", "澀谷區", "渋谷区", "시부야구"]],
  ["shinjuku", "/shinjuku|新宿|신주쿠/i", "Shinjuku", "Tokyo", "Japan", "JP", 35.6938, 139.7034, ["Shinjuku", "新宿區", "新宿区", "신주쿠구"]],
  ["ginza", "/ginza|銀座|긴자/i", "Ginza", "Tokyo", "Japan", "JP", 35.6717, 139.765, ["Ginza", "銀座", "銀座", "긴자"]],
  ["tsukiji", "/tsukiji|築地|츠키지/i", "Tsukiji", "Tokyo", "Japan", "JP", 35.6655, 139.7707, ["Tsukiji", "築地", "築地", "츠키지"]],
  ["fukuoka", "/fukuoka|福岡|후쿠오카/i", "Fukuoka", "Fukuoka", "Japan", "JP", 33.5902, 130.4017, ["Fukuoka", "福岡市", "福岡市", "후쿠오카시"]],
  ["sapporo", "/sapporo|札幌|삿포로/i", "Sapporo", "Hokkaido", "Japan", "JP", 43.0618, 141.3545, ["Sapporo", "札幌市", "札幌市", "삿포로시"]],
  ["dotonbori", "/dotonbori|道頓堀|道顿堀|도톤보리/i", "Dotonbori", "Osaka", "Japan", "JP", 34.6687, 135.5013, ["Dotonbori", "道頓堀", "道頓堀", "도톤보리"]],
  ["kuromon", "/黑門|黒門|kuromon/i", "Kuromon Market", "Osaka", "Japan", "JP", 34.6654, 135.5065, ["Kuromon Market", "黑門市場", "黒門市場", "구로몬 시장"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["nishiki", "/錦市場|nishiki/i", "Nishiki Market", "Kyoto", "Japan", "JP", 35.005, 135.7649, ["Nishiki Market", "錦市場", "錦市場", "니시키 시장"]],
  ["hakone", "/hakone|箱根|하코네/i", "Hakone", "Kanagawa", "Japan", "JP", 35.2324, 139.1069, ["Hakone", "箱根町", "箱根町", "하코네"]],
  ["bangkok", "/bangkok|曼谷|バンコク|방콕/i", "Bangkok", "Bangkok", "Thailand", "TH", 13.7563, 100.5018, ["Bangkok", "曼谷", "バンコク", "방콕"]],
  ["fengjia", "/逢甲|fengjia/i", "Fengjia Night Market", "Taichung", "Taiwan", "TW", 24.1757, 120.6455, ["Fengjia Night Market", "逢甲夜市", "逢甲夜市", "펑자 야시장"]],
  ["taichung", "/taichung|台中|臺中|타이중/i", "Taichung", "Taichung", "Taiwan", "TW", 24.1477, 120.6736, ["Taichung", "台中", "台中", "타이중"]],
  ["shilin", "/士林|shilin/i", "Shilin", "Taipei", "Taiwan", "TW", 25.0881, 121.5246, ["Shilin", "士林區", "士林区", "스린"]],
  ["xinyi", "/信義|xinyi/i", "Xinyi", "Taipei", "Taiwan", "TW", 25.0330, 121.5654, ["Xinyi", "信義區", "信義区", "신이"]],
  ["beitou", "/北投|beitou/i", "Beitou", "Taipei", "Taiwan", "TW", 25.1321, 121.4987, ["Beitou", "北投區", "北投区", "베이터우"]],
  ["raohe", "/饒河|raohe/i", "Raohe Night Market", "Taipei", "Taiwan", "TW", 25.0509, 121.5775, ["Raohe Night Market", "饒河夜市", "饒河夜市", "라오허 야시장"]],
  ["hayashi", "/林百貨|hayashi/i", "Hayashi Department Store", "Tainan", "Taiwan", "TW", 22.9925, 120.2029, ["Hayashi Department Store", "林百貨", "林百貨", "하야시 백화점"]],
  ["tainan", "/tainan|台南|臺南|타이난/i", "Tainan", "Tainan", "Taiwan", "TW", 22.9997, 120.227, ["Tainan", "台南", "台南", "타이난"]],
  ["liuhe", "/六合|liuhe/i", "Liuhe Night Market", "Kaohsiung", "Taiwan", "TW", 22.6315, 120.3014, ["Liuhe Night Market", "六合夜市", "六合夜市", "류허 야시장"]],
  ["kaohsiung", "/kaohsiung|高雄|가오슝/i", "Kaohsiung", "Kaohsiung", "Taiwan", "TW", 22.6273, 120.3014, ["Kaohsiung", "高雄", "高雄", "가오슝"]],
  ["mori", "/森美術館|mori art/i", "Mori Art Museum", "Tokyo", "Japan", "JP", 35.6604, 139.7292, ["Mori Art Museum", "森美術館", "森美術館", "모리 미술관"]],
  ["taipei", "/taipei|台北|臺北|타이베이/i", "Taipei", "Taipei", "Taiwan", "TW", 25.033, 121.5654, ["Taipei", "台北", "台北", "타이베이"]],
  ["seoul", "/seoul|首爾|首尔|ソウル|서울/i", "Seoul", "Seoul", "South Korea", "KR", 37.5665, 126.978, ["Seoul", "首爾", "ソウル", "서울"]],
];

// x) replies at combination_choice
const XT = ["都不錯", "都不错", "都可以", "全部，也想去鎌倉", "all of them, plus Kamakura", "全部、鎌倉も行きたい", "전부, 가마쿠라도 가고 싶어", "1、3", "1 and 3", "1,3", "1と3", "1번이랑 3번", "おまかせ", "全部"];
const NUMBERED = new Set(["1、3", "1 and 3", "1,3", "1と3", "1번이랑 3번"]);

// e) extra en food sentences: [text, expected real place regex or null]
const EAT2 = [
  ["try ramen in Osaka", /osaka|大阪|오사카/i], ["have dinner in Kyoto", /kyoto|京都|교토/i], ["let's eat and drink in Shibuya", /shibuya|渋谷|澀谷|시부야/i],
  ["food in Taipei", /taipei|台北|타이베이/i], ["drinks near Shinjuku", /shinjuku|新宿|신주쿠/i], ["eat local food in Fukuoka", /fukuoka|福岡|후쿠오카/i],
  ["I want to try ramen", null], ["I want to have dinner in Sapporo tonight", /sapporo|札幌|삿포로/i], ["want to eat sushi in Ginza", /ginza|銀座|긴자/i],
  ["where to drink in Osaka", /osaka|大阪|오사카/i], ["I want to eat and drink in Seoul", /seoul|서울|首爾|ソウル/i], ["I want to go to Fukuoka to eat ramen", /fukuoka|福岡|후쿠오카/i],
  ["street food in Bangkok", /bangkok|曼谷|バンコク|방콕/i], ["to eat in Kyoto", /kyoto|京都|교토/i], ["I want to have a trip to Tokyo", /tokyo|東京|도쿄/i],
  ["try the best sushi", null], ["have a drink", null], ["eat and drink", null],
];
const EAT_DEST_RE = /^(?:(?:any|some)thing\s+)?(?:good\s+)?(?:to\s+)?(?:eat|drinks?|food|try|have)\b|\bto eat\b|^(?:ramen|sushi|dinner|a drink|the best sushi|local food|street food)$/i;

// a) place names containing a category word: [text, expected regex for the place]
const AREA = [
  ["台中逢甲夜市", /逢甲/], ["士林夜市", /士林/], ["信義商圈", /信義/], ["北投溫泉", /北投/], ["箱根溫泉", /箱根/], ["道頓堀", /道頓堀/],
  ["錦市場", /錦市場/], ["築地市場", /築地/], ["新宿居酒屋街", /新宿/],
  ["台北士林夜市", /士林/], ["台北饒河夜市", /饒河/], ["高雄六合夜市", /六合/], ["台北信義商圈", /信義/], ["台北北投溫泉", /北投/],
  ["大阪黑門市場", /黑門|黒門/], ["京都錦市場", /錦/], ["東京築地市場", /築地/], ["台南林百貨", /林百貨/], ["東京森美術館", /森美術館/], ["大阪道頓堀", /道頓堀/],
];
const AREA_GO = (t) => `我想去${t}`;

// o) おまかせ wording beyond the whole-reply delegation list (「おまかせ」 entered the category vocabulary this round)
const OMA2 = ["おまかせ", "おまかせで", "おまかせでいいよ", "じゃあおまかせで", "全部おまかせ", "おまかせします！", "おまかせでお願いします。", "おまかせしたい", "おまかせで大丈夫です", "お任せで", "お任せします",
  "おまかせコース", "東京のおまかせ寿司", "omakase", "無菜單"];
const OMA_DELEGATE = new Set(["おまかせ", "おまかせで", "おまかせでいいよ", "じゃあおまかせで", "全部おまかせ", "おまかせします！", "おまかせでお願いします。", "おまかせしたい", "おまかせで大丈夫です", "お任せで", "お任せします"]);

async function collect() {
  const R = {};
  const sessionMod = await load("src/lib/chat-session.ts");
  const combo = await load("src/lib/ai/destination-combination-suggestions.ts");
  const pendingMod = await load("src/lib/ai/destination-pending-question.ts");
  const authMod = await loadOpt("src/lib/ai/selected-combination-authority.ts");
  const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const dtp = await load("src/lib/ai/destination-travel-profile.ts");
  const catTypes = await load("src/lib/ai/chat-place-category-types.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to).replace("const poolFor = (dest) => {", "const poolFor = (dest) => { if (globalThis.__POOL) return globalThis.__POOL(dest);");
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
    slice + "\nreturn { appTurn, freshAll, freshAuthority, fresh, geocodeLog, authorityGeocodeLog, discoveryGeocodeLog, setLocale: (l) => { curLocale = l; } };",
  )(load, loadOpt, readFileSync, storageWrites);
  const g = (fn) => { try { const v = fn(); return v === undefined ? "undef" : v; } catch (e) { return `THROW ${String(e?.message ?? e).slice(0, 80)}`; } };
  const offeredOf = (s) => (s?.travelContext?.offeredCombinations ?? []).map((c) => ({ id: c.id, title: c.title ?? "", places: (c.places ?? []).map((p) => p.originalName ?? p.name) }));
  const reset = async (loc) => { OFFSET = 0; globalThis.__POOL = undefined; H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const ALT_NAMES = ["Kiyosumi Garden", "Koishikawa Korakuen", "Sumida Aquarium", "Nakameguro", "Shimokitazawa", "Kichijoji", "Odaiba Seaside", "Tokyo Skytree", "Ryogoku Kokugikan",
    "Kappabashi", "Jimbocho", "Akihabara Electric Town", "Toyosu Market", "teamLab Planets", "Gotokuji", "Todoroki Valley", "Showa Kinen Park", "Takao-san"];
  const altPool = (dest) => (/tokyo|東京|도쿄/i.test(dest ?? "") ? ALT_NAMES.map((name, i) => ({ id: `ChIJalt${i}`, name, sourceLocale: "en", lat: 35.6762 + i * 0.0009, lng: 139.6503 + (i % 4) * 0.0008,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.5, userRatingCount: 9000, address: "Tokyo, Japan", businessStatus: "OPERATIONAL" })) : []);
  const pickRow = (a, shown, w) => {
    const tc = a.s?.travelContext ?? {};
    const sel = tc.selectedCombinationIds ?? [];
    const shownIds = shown.map((c) => c.id);
    const reply = a.row?.reply ?? "";
    const dest = a.s?.travelContext?.destination ?? "";
    const auth = authMod ? g(() => { const x = authMod.resolveSelectedCombinationAuthority(tc, dest); return x.ok ? { ok: true, ids: x.allowlist.selectedCombinationIds, places: x.allowlist.allowedPlaceNames.length } : { ok: false, reason: x.reason }; }) : "n/a";
    const shownPlaces = new Set(shown.flatMap((c) => c.places));
    const locked = tc.selectedCombinationPlaceNames ?? [];
    return { w, branch: a.row?.branch ?? null, p: a.s?.pendingQuestion?.type ?? null, purpose: tc.tripPurpose ?? null, dest, shown: shown.map((c) => `${c.id}:${c.title}`), sel,
      outside: sel.filter((id) => !shownIds.includes(id)), missing: shownIds.filter((id) => !sel.includes(id)),
      titlesInReply: shown.map((c) => Boolean(c.title) && reply.includes(c.title)), auth, lockedOutside: locked.filter((p) => !shownPlaces.has(p)).length, locked: locked.length,
      afterOffered: offeredOf(a.s).map((c) => `${c.id}:${c.title}`), nearby: (tc.nearbyExtensions ?? []).map((x) => (typeof x === "string" ? x : x?.name ?? x?.label ?? JSON.stringify(x))).join("|") || null,
      discoveryRuns: a.row?.discoveryRuns ?? null, placesCalls: a.row?.placesCalls ?? null, reply: reply.replace(/\n/g, " / ").slice(0, 220) };
  };

  if (want("t")) {
    for (const nav of ["app", "node"]) for (const loc of LOCS) {
      setNav(nav === "app" ? loc : null);
      // natural offered counts by trip days, then cache trimmed (2) / extended (4) on the 3-day list
      const seen = new Set(); const builds = [];
      for (const d of [1, 2, 3, 4, 5, 6]) {
        await reset(loc);
        const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[loc](TOKYO[loc]), loc);
        const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[loc](d), loc);
        const n = offeredOf(a2.s).length;
        R[`TB|${nav}|${loc}|${d}`] = { p: a2.s?.pendingQuestion?.type ?? null, n };
        if (a2.s?.pendingQuestion?.type === "combination_choice" && n >= 2 && !seen.has(n)) { seen.add(n); builds.push({ d, mode: "natural" }); }
      }
      builds.push({ d: 3, mode: "syn2" }, { d: 3, mode: "syn4" });
      for (const b of builds) {
        for (const variant of ["kept", "expired", "expiredAltPool"]) {
          if (b.mode !== "natural" && variant === "expiredAltPool") continue;
          for (const w of nav === "app" ? [...REQ_WORDS, ...EXTRA_WORDS] : REQ_WORDS) {
            await reset(loc);
            const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[loc](TOKYO[loc]), loc);
            const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[loc](b.d), loc);
            let s2 = { ...a2.s, lastAssistantReply: (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
            const dest = s2.pendingQuestion?.baseDestination ?? s2.travelContext?.destination ?? "";
            if (b.mode !== "natural") {
              const raw = discovery.getCachedDiscoveredCombinations(dest, undefined, undefined, { skipLocalizationGate: true }) ?? [];
              let next = structuredClone(raw);
              if (b.mode === "syn2") next = next.slice(0, 2);
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
            const shown = offeredOf(s2);
            const cachedBefore = g(() => discovery.getCachedDiscoveredCombinations(dest)?.length ?? null);
            if (variant !== "kept") OFFSET = MIN31;
            if (variant === "expiredAltPool") globalThis.__POOL = altPool;
            // proof the cache expired by the clock (no manual clear)
            const cachedAt = g(() => discovery.getCachedDiscoveredCombinations(dest)?.length ?? null);
            const srcList = g(() => combo.getDestinationCombinations(dest).map((c, i) => `${i + 1}.${c.title}`));
            const pending = g(() => pendingMod.parsePendingOptionSelection(w, s2.pendingQuestion, s2.travelContext?.offeredCombinations));
            let a3;
            try { a3 = await H.appTurn(structuredClone(s2), w, loc); } catch (e) { R[`T|${nav}|${loc}|${b.mode}${shown.length}|${variant}|${w}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
            R[`T|${nav}|${loc}|${b.mode}${shown.length}|${variant}|${w}`] = { ...pickRow(a3, shown, w), cachedBefore, cachedAt, srcList, pending, allOrAuto: g(() => combo.isUserAllOrAutoCombinationReply(w)) };
          }
        }
      }
    }
    OFFSET = 0; globalThis.__POOL = undefined; setNav(null);
  }

  const REAL = ["Senso-ji", "Meiji Jingu", "Ueno Park", "Tokyo National Museum", "Shinjuku Gyoen", "Tokyo Tower", "Yoyogi Park", "Mori Art Museum", "Hamarikyu Gardens",
    "Nezu Shrine", "Edo-Tokyo Museum", "Inokashira Park", "Rikugien", "Zojo-ji", "Ginza Six", "Omotesando Hills", "Tsukiji Outer Market", "Yanaka Ginza"];
  const real3 = (dest) => (/tokyo|東京|도쿄/i.test(dest ?? "") ? REAL.map((name, i) => ({ id: `ChIJJPreal${i}`, name, sourceLocale: "en", lat: 35.6762 + i * 0.0007, lng: 139.6503 + (i % 5) * 0.0006,
    types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Tokyo, Japan", businessStatus: "OPERATIONAL" })) : []);
  if (want("x")) {
    for (const nav of ["app", "node"]) for (const pool of ["m16", "real3"]) for (const loc of LOCS) {
      for (const t of XT) {
        setNav(nav === "app" ? loc : null);
        await reset(loc);
        globalThis.__POOL = pool === "real3" ? real3 : undefined;
        const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[loc](TOKYO[loc]), loc);
        const a2 = await H.appTurn({ ...a1.s, lastAssistantReply: a1.row?.reply ?? "" }, DAYS[loc](3), loc);
        const s2 = { ...a2.s, lastAssistantReply: (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
        const shown = offeredOf(s2);
        const dest = s2.pendingQuestion?.baseDestination ?? "";
        const sig = { allOrAuto: g(() => combo.isUserAllOrAutoCombinationReply(t)), soft: g(() => combo.isSoftAcceptAllCombinationsReply(t)),
          resolved: g(() => { const x = combo.resolveSelectedCombinations(dest, t); return x ? { idx: x.indexes.map((i) => i + 1), src: x.selectionSource } : null; }),
          pending: g(() => pendingMod.parsePendingOptionSelection(t, s2.pendingQuestion, s2.travelContext?.offeredCombinations)),
          prePending: s2.pendingQuestion?.type ?? null, srcList: g(() => combo.getDestinationCombinations(dest).map((c, i) => `${i + 1}.${c.title}`)) };
        let a3;
        try { a3 = await H.appTurn(structuredClone(s2), t, loc); } catch (e) { R[`X|${nav}|${pool}|${loc}|${t}`] = { err: String(e?.message ?? e).slice(0, 100) }; continue; }
        R[`X|${nav}|${pool}|${loc}|${t}`] = { ...pickRow(a3, shown, t), sig, selSource: a3.s?.travelContext?.selectionSource ?? null };
      }
    }
    globalThis.__POOL = undefined; setNav(null);
  }

  const geoLogs = () => [H.geocodeLog, H.authorityGeocodeLog, H.discoveryGeocodeLog];
  const turnS = async (s0, t, loc) => {
    const n0 = geoLogs().map((l) => l.length);
    try {
      const r = await H.appTurn(structuredClone(s0), t, loc); const s = r.s; const tc = s.travelContext ?? {};
      const q = geoLogs().flatMap((l, i) => l.slice(n0[i]).map((x) => `${["g", "a", "d"][i]}:${x}`));
      return { s, row: { b: r.row?.branch ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null, tpcDest: s.tripPlanningContext?.destination ?? null,
        area: s.preferredArea ?? tc.destinationArea ?? null, cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
        geo: q.length, q: q.join("|"), reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 180) } };
    } catch (e) { return { s: null, row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 } }; }
  };
  const parsers = (u) => {
    const e = sessionMod.createEmptySession();
    return {
      nonPlace: g(() => tpc.isNonPlaceDestinationText(u)), parse: g(() => tpc.parseDestinationFromText(u) ?? null), resolve: g(() => tpc.resolveDestinationFromText(u) ?? null),
      tripIntent: g(() => { const x = tripIntent.parseTripIntentFromText(u, structuredClone(e)); return `city=${x.destinationCity ?? "-"} area=${x.destinationArea ?? "-"}`; }),
      merge: g(() => { const m = travelContext.mergeTravelContext(structuredClone(e), u, ""); return `dest=${m.context.destination ?? "-"} cand=${m.context.destinationCandidate?.raw ?? "-"}`; }),
      gpt: g(() => { const x = gpc.globalPlanningTurn(structuredClone(e), u); return x === undefined ? "undef" : `d=${x.destination ?? "-"} c=${x.destinationCandidate?.raw ?? "-"}`; }),
      areaScope: g(() => dtp.resolveDestinationAreaScope(u)?.displayLabel ?? null),
      provisional: g(() => { const p = dtp.extractProvisionalDestinationAreaCandidate(u); return p ? (p.rawLabel ?? p.displayLabel ?? JSON.stringify(p).slice(0, 60)) : null; }),
      hasCat: g(() => catTypes.hasCategoryPlaceQuery(u)),
    };
  };

  if (want("e")) {
    for (const [t] of EAT2) {
      R[`EP|${t}`] = parsers(t);
      for (const loc of LOCS) {
        await reset(loc);
        const f = await turnS(sessionMod.createEmptySession(), t, loc);
        const fk = f.s ? await turnS({ ...f.s, lastAssistantReply: (f.row.reply ?? "").replace(/ \/ /g, "\n") }, "Kinosaki", loc) : null;
        R[`ET|${loc}|${t}`] = { fresh: f.row, kino: fk?.row ?? null };
      }
    }
  }

  if (want("o")) {
    for (const loc of ["ja", "zh-TW", "en"]) {
      setNav(loc);
      await reset(loc);
      const a1 = await H.appTurn(sessionMod.createEmptySession(), GO[loc](TOKYO[loc]), loc);
      const askDays = { ...a1.s, lastAssistantReply: a1.row?.reply ?? "" };
      const a2 = await H.appTurn(structuredClone(askDays), DAYS[loc](3), loc);
      const combos = { ...a2.s, lastAssistantReply: (a2.row?.reply ?? "").replace(/ \/ /g, "\n") };
      const stages = { new: sessionMod.createEmptySession(), askDays, combos };
      for (const t of OMA2) {
        for (const [stage, s0] of Object.entries(stages)) {
          await reset(loc);
          const shown = offeredOf(s0);
          const f = await turnS(s0, t, loc);
          const tc = f.s?.travelContext ?? {};
          R[`O|${loc}|${stage}|${t}`] = { ...f.row, shownN: shown.length, sel: tc.selectedCombinationIds ?? [], hasCat: g(() => catTypes.hasCategoryPlaceQuery(t)), allOrAuto: g(() => combo.isUserAllOrAutoCombinationReply(t)) };
        }
      }
    }
    setNav(null);
  }

  if (want("k")) {
    // 「eat and drink」 → 「Kinosaki」: what the later dispatch would read (category / nearby routing signals)
    const chatIntent = await load("src/lib/ai/chat-intent.ts");
    const placeIntent = await load("src/lib/ai/chat-place-intent.ts");
    const catDest = await load("src/lib/ai/chat-category-destination.ts");
    const mustVisit = await load("src/lib/ai/must-visit-places.ts");
    const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
    const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
    const dining = await loadOpt("src/lib/ai/chat-dining-intent.ts");
    for (const loc of LOCS) {
      setNav(loc);
      for (const [first, second] of [["eat and drink", "Kinosaki"], ["eat and drink", "Tokyo"], ["I want to eat sushi", "Tokyo"], ["places to eat in Tokyo", null], ["Kinosaki", null], ["hello", "Kinosaki"]]) {
        await reset(loc);
        const f = await turnS(sessionMod.createEmptySession(), first, loc);
        const sig = (s, t) => {
          const pc = g(() => mustVisit.mergeContextForPlaceFetch(s.travelContext ?? { interests: [] }, s));
          const pcObj = typeof pc === "object" ? pc : (s.travelContext ?? { interests: [] });
          const catFetch = g(() => placeIntent.shouldFetchDestinationCategoryPlaces(t, pcObj, s));
          return { detect: g(() => chatIntent.detectChatIntent(t)), catIntents: g(() => placeIntent.parseChatPlaceIntents(t).join(",") || "-"),
            explicitNearby: g(() => chatIntent.userExplicitlyWantsNearbyPlaces(t)), inferNearby: g(() => JSON.stringify(chatIntent.inferNearbyIntentFromContext(pcObj, t, s) ?? null)),
            catFetch, catDest: g(() => catDest.resolveDestinationForCategorySearch(pcObj, s, t) ?? null), arb: g(() => arbitrate.resolveChatIntentArbitration(t, structuredClone(s)).route),
            authority: g(() => nearbyClar.resolveChatRouteAuthority({ structuredShortcut: false, explicitNearbyRequest: chatIntent.userExplicitlyWantsNearbyPlaces(t), pendingNearbyLocationRequest: Boolean(s.pendingNearbyLocationRequest), resolvedNearbyIntent: chatIntent.inferNearbyIntentFromContext(pcObj, t, s) ?? null, categoryPlaceQuery: catFetch === true })),
            dining: dining ? g(() => JSON.stringify(dining.resolveChatIntent?.(t, structuredClone(s)) ?? null).slice(0, 80)) : "n/a",
            state: JSON.stringify({ pnl: s.pendingNearbyLocationRequest ?? null, aci: s.activeCategoryIntent ?? null, pending: s.pendingQuestion?.type ?? null, cc: s.pendingCategoryContinuation ?? s.categoryContinuation ?? null, intent: s.activeChatIntent ?? null }).slice(0, 200) };
        };
        const s1 = f.s ? { ...f.s, lastAssistantReply: (f.row.reply ?? "").replace(/ \/ /g, "\n") } : null;
        const row = { first: f.row, sigFirst: sig(sessionMod.createEmptySession(), first) };
        if (second && s1) { const k2 = await turnS(s1, second, loc); row.second = k2.row; row.sigSecond = sig(s1, second); }
        R[`K|${loc}|${first}|${second ?? "-"}`] = row;
      }
    }
    setNav(null);
  }

  if (want("a")) {
    for (const [t] of AREA) {
      R[`AP|${t}`] = parsers(t);
      R[`AP|${AREA_GO(t)}`] = parsers(AREA_GO(t));
      for (const u of [t, AREA_GO(t)]) {
        await reset("zh-TW");
        const f = await turnS(sessionMod.createEmptySession(), u, "zh-TW");
        R[`AT|${u}`] = f.row;
      }
    }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D25_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d25.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 290_000, maxBuffer: 256 << 20 });
    const m = (r.stdout ?? "").match(/@@D25_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const allOk = (x) => x && !x.err && x.sel.length === x.shown.length && !x.outside.length && !x.missing.length && typeof x.auth === "object" && x.auth.ok && x.auth.ids.length === x.shown.length && x.lockedOutside === 0;
  const verdict = (x) => !x ? "n/a" : x.err ? `ERR ${x.err}` : allOk(x) ? (x.titlesInReply.every(Boolean) ? "ALL-OK" : "ALL-OK(title?)") : x.sel.length === 0 ? "NONE" : "MISMATCH";
  if (want("t")) {
    out("==== TB) list builders ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("TB|"))) out(`  ${k} W p=${WR[k].p} n=${WR[k].n} | H p=${HR?.[k]?.p ?? "n/a"} n=${HR?.[k]?.n ?? "n/a"}`);
    out("\n==== T) all-select after 31 min (clock advanced; caches expire by TTL) ====");
    const table = {};
    for (const k of Object.keys(WR).filter((k) => k.startsWith("T|"))) {
      const w = WR[k]; const h = HR?.[k];
      const [, nav, loc, build, variant, word] = k.split("|");
      const v = verdict(w);
      (table[`${nav}|${variant}|${loc}|${build}`] ??= []).push(`${word}=${v}|H:${verdict(h)}`);
      out(`  ${k} W ${v} | H ${verdict(h)}`);
      if (w.err) { fail(k, w.err); continue; }
      out(`     shown=${JSON.stringify(w.shown)} cachedBefore=${w.cachedBefore} cachedAtReply=${w.cachedAt} src=${JSON.stringify(w.srcList)}`);
      out(`     allOrAuto=${w.allOrAuto} pending=${JSON.stringify(w.pending)} [${w.branch}] p=${w.p} purpose=${w.purpose} sel=${JSON.stringify(w.sel)} outside=${JSON.stringify(w.outside)} missing=${JSON.stringify(w.missing)}`);
      out(`     auth=${JSON.stringify(w.auth)} locked=${w.locked} lockedOutside=${w.lockedOutside} titlesInReply=${JSON.stringify(w.titlesInReply)} discoveryRuns=${w.discoveryRuns} placesCalls=${w.placesCalls}`);
      out(`     reply: ${w.reply}`);
      if (h && !h.err) out(`     H [${h.branch}] p=${h.p} sel=${JSON.stringify(h.sel)} auth=${JSON.stringify(h.auth)} cachedAtReply=${h.cachedAt} discoveryRuns=${h.discoveryRuns}`);
      if (variant !== "kept" && w.cachedAt !== null && w.cachedAt !== "undef") notes.push(`${k}: cache still present after +31 min (${w.cachedAt})`);
      if (REQ_WORDS.includes(word)) {
        if (!allOk(w)) fail(k, `required all-select not full: sel=${JSON.stringify(w.sel)} shown=${JSON.stringify(w.shown)} auth=${JSON.stringify(w.auth)} lockedOutside=${w.lockedOutside}`);
        else if (!w.titlesInReply.every(Boolean)) fail(`${k}#title`, `reply misses shown title(s): ${JSON.stringify(w.titlesInReply)} reply=${w.reply}`);
      } else if (!allOk(w) && allOk(h)) fail(k, `REGRESSION extra word vs HEAD`);
      else if (!allOk(w)) notes.push(`${k} extra word not full (HEAD ${verdict(h)})`);
    }
    out("\n==== T TABLE (variant|locale|build) ====");
    for (const [k, v] of Object.entries(table)) out(`  ${k}: ${v.join("  ")}`);
  }
  if (want("x")) {
    out("\n==== X) soft-accept / all + extension / numbered at combination_choice (Tokyo 3 days) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("X|"))) {
      const w = WR[k]; const h = HR?.[k]; const t = k.split("|").slice(4).join("|");
      if (w.err) { fail(k, w.err); continue; }
      out(`  ${k}\n     W pre=${w.sig?.prePending} shown=${JSON.stringify(w.shown)} src=${JSON.stringify(w.sig?.srcList)}\n     H pre=${h?.sig?.prePending ?? "n/a"} shown=${JSON.stringify(h?.shown ?? null)} src=${JSON.stringify(h?.sig?.srcList ?? null)}`);
      out(`     W [${w.branch}] p=${w.p} purpose=${w.purpose} src=${w.selSource} sel=${JSON.stringify(w.sel)} outside=${JSON.stringify(w.outside)} nearby=${w.nearby} auth=${JSON.stringify(w.auth)} sig=${JSON.stringify(w.sig)}\n       reply: ${w.reply}`);
      out(`     H ${h ? `[${h.branch}] p=${h.p} purpose=${h.purpose} src=${h.selSource} sel=${JSON.stringify(h.sel)} nearby=${h.nearby} auth=${JSON.stringify(h.auth)} sig=${JSON.stringify(h.sig)}\n       reply: ${h.reply}` : "n/a"}`);
      if (w.outside.length) fail(k, `ids outside shown list ${JSON.stringify(w.outside)}`);
      const sameShown = h && !h.err && JSON.stringify(h.shown) === JSON.stringify(w.shown) && h.sig?.prePending === w.sig?.prePending;
      if (NUMBERED.has(t) && sameShown && (JSON.stringify(h.sel) !== JSON.stringify(w.sel) || h.branch !== w.branch || h.p !== w.p || h.nearby !== w.nearby)) fail(k, `numbered pick differs from HEAD (same shown list): W sel=${JSON.stringify(w.sel)} [${w.branch}] | H sel=${JSON.stringify(h.sel)} [${h.branch}]`);
      if (NUMBERED.has(t) && w.sig?.prePending === "combination_choice" && w.shown.length >= 3 && JSON.stringify(w.sel) !== "[1,3]") fail(`${k}#intent`, `user picked 1 and 3 of the shown list, W locked ${JSON.stringify(w.sel)} (H ${h ? JSON.stringify(h.sel) : "n/a"}, H shown same=${Boolean(sameShown)})`);
      if (NUMBERED.has(t) && h && !sameShown) notes.push(`${k}: HEAD showed a different list — W shown=${JSON.stringify(w.shown)} | H shown=${JSON.stringify(h.shown)} pre=${h.sig?.prePending}`);
      if (h && !h.err && !NUMBERED.has(t) && (JSON.stringify(h.sel) !== JSON.stringify(w.sel) || h.branch !== w.branch)) notes.push(`X diff vs HEAD ${k}: W sel=${JSON.stringify(w.sel)} nearby=${w.nearby} [${w.branch}] | H sel=${JSON.stringify(h.sel)} nearby=${h.nearby} [${h.branch}]`);
      if (allOk(h) && !allOk(w) && !NUMBERED.has(t)) fail(k, "REGRESSION: HEAD selected all shown, W not");
    }
    out("\n==== X TABLE (nav|pool|locale: text → W sel/shown | H sel/shown) ====");
    const xt = {};
    for (const k of Object.keys(WR).filter((k) => k.startsWith("X|"))) {
      const [, nav, pool, loc] = k.split("|"); const t = k.split("|").slice(4).join("|"); const w = WR[k]; const h = HR?.[k];
      (xt[`${nav}|${pool}|${loc}`] ??= []).push(`「${t}」W${JSON.stringify(w.sel ?? null)}/${w.shown?.length ?? "-"}${w.nearby ? `+${w.nearby}` : ""} H${JSON.stringify(h?.sel ?? null)}/${h?.shown?.length ?? "-"}${h?.nearby ? `+${h.nearby}` : ""}`);
    }
    for (const [k, v] of Object.entries(xt)) out(`  ${k}: ${v.join("  ")}`);
  }
  const fa = (x) => !x ? "n/a" : `[${x.b}] p=${x.p ?? "-"} dest=${x.dest} area=${x.area ?? "-"} cand=${x.cand ?? "-"} trip=${x.trip ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}`;
  const hit = (x, re) => Boolean(x) && ([x.dest, x.trip, x.tpcDest, x.area, x.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v))) || re.test(x.q ?? ""));
  if (want("e")) {
    out("\n==== EP) extra food sentences: parsers (W | H) ====");
    for (const [t] of EAT2) out(`  「${t}」\n     W ${JSON.stringify(WR[`EP|${t}`])}\n     H ${JSON.stringify(HR?.[`EP|${t}`] ?? null)}`);
    out("\n==== ET) extra food sentences: new chat / new → Kinosaki ====");
    for (const [t, re] of EAT2) {
      for (const loc of LOCS) {
        const k = `ET|${loc}|${t}`; const w = WR[k]; const h = HR?.[k];
        out(`  ${k}\n     W ${fa(w.fresh)} → Kino ${fa(w.kino)}\n       reply: ${w.fresh?.reply ?? "-"}\n     H ${fa(h?.fresh)} → Kino ${fa(h?.kino)}\n       reply: ${h?.fresh?.reply ?? "-"}`);
        const bad = (x) => x && ([x.dest, x.trip, x.tpcDest, x.cand?.split("/")[0]].filter(Boolean).some((v) => EAT_DEST_RE.test(String(v).trim()))
          || (x.q ?? "").split("|").filter(Boolean).some((q) => EAT_DEST_RE.test(q.replace(/^[gad]:/, "").trim())));
        if (bad(w.fresh)) fail(`${k}#fresh`, `food residue as dest/cand/geocode: ${fa(w.fresh)}`);
        if (bad(w.kino)) fail(`${k}#kino`, `food residue as dest/cand/geocode: ${fa(w.kino)}`);
        if (re) {
          if (!hit(w.fresh, re)) { if (hit(h?.fresh, re)) fail(`${k}#place`, `REGRESSION: HEAD reached the place, W not: W ${fa(w.fresh)} | H ${fa(h?.fresh)}`); else notes.push(`${k}: place not reached (HEAD same): W ${fa(w.fresh)} | H ${fa(h?.fresh)}`); }
        }
        if (h?.fresh && (h.fresh.b !== w.fresh?.b || h.fresh.dest !== w.fresh?.dest || h.fresh.p !== w.fresh?.p)) notes.push(`ET diff vs HEAD ${k}: W ${fa(w.fresh)} | H ${fa(h.fresh)}`);
      }
    }
  }
  if (want("o")) {
    out("\n==== O) おまかせ wording at new chat / Tokyo ask_days / Tokyo combination_choice (nav=app) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("O|"))) {
      const w = WR[k]; const h = HR?.[k]; const [, loc, stage] = k.split("|"); const t = k.split("|").slice(3).join("|");
      out(`  ${k}\n     W ${fa(w)} sel=${JSON.stringify(w.sel)}/${w.shownN} hasCat=${w.hasCat} allOrAuto=${w.allOrAuto}\n       reply: ${w.reply ?? "-"}\n     H ${fa(h)} sel=${JSON.stringify(h?.sel ?? null)}/${h?.shownN ?? "-"} hasCat=${h?.hasCat} allOrAuto=${h?.allOrAuto}\n       reply: ${h?.reply ?? "-"}`);
      if (OMA_DELEGATE.has(t) && /category/.test(w.b ?? "") && !/category/.test(h?.b ?? "")) fail(k, `delegation wording routed to category search (HEAD not): W [${w.b}] | H [${h?.b}]`);
      if (stage === "combos" && h && h.sel?.length === h.shownN && h.shownN > 0 && w.sel.length !== w.shownN) fail(k, `HEAD selected all, W not: W ${JSON.stringify(w.sel)}/${w.shownN}`);
      if (h && (h.b !== w.b || h.dest !== w.dest || h.p !== w.p || JSON.stringify(h.sel) !== JSON.stringify(w.sel))) notes.push(`O diff ${k}: W [${w.b}] p=${w.p} dest=${w.dest} sel=${JSON.stringify(w.sel)} | H [${h.b}] p=${h.p} dest=${h.dest} sel=${JSON.stringify(h.sel)}`);
    }
  }
  if (want("k")) {
    out("\n==== K) 「eat and drink」 → city: routing signals the later dispatch reads (W | H) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("K|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`  ${k}\n     1st W ${fa(w.first)} | H ${fa(h?.first)}\n       sig W ${JSON.stringify(w.sigFirst)}\n       sig H ${JSON.stringify(h?.sigFirst ?? null)}`);
      if (w.second) out(`     2nd W ${fa(w.second)}\n         reply: ${w.second.reply}\n     2nd H ${fa(h?.second)}\n         reply: ${h?.second?.reply ?? "-"}\n       sig W ${JSON.stringify(w.sigSecond)}\n       sig H ${JSON.stringify(h?.sigSecond ?? null)}`);
    }
  }
  if (want("a")) {
    out("\n==== A) place names with a category word (W | H) ====");
    for (const [t, re] of AREA) {
      for (const u of [t, AREA_GO(t)]) {
        const pw = WR[`AP|${u}`]; const ph = HR?.[`AP|${u}`];
        const w = WR[`AT|${u}`]; const h = HR?.[`AT|${u}`];
        out(`  「${u}」\n     Wp ${JSON.stringify(pw)}\n     Hp ${JSON.stringify(ph ?? null)}\n     W ${fa(w)}\n       reply: ${w?.reply ?? "-"}\n     H ${fa(h)}\n       reply: ${h?.reply ?? "-"}`);
        for (const f of ["areaScope", "provisional", "parse", "resolve", "tripIntent", "merge", "gpt"]) {
          if (ph && JSON.stringify(ph[f]) !== JSON.stringify(pw[f])) notes.push(`A parser diff 「${u}」 ${f}: W=${JSON.stringify(pw[f])} H=${JSON.stringify(ph[f])}`);
        }
        if (ph && ph.areaScope && re.test(String(ph.areaScope)) && !(pw.areaScope && re.test(String(pw.areaScope)))) fail(`A|${u}#areaScope`, `REGRESSION area lost: W=${pw.areaScope} H=${ph.areaScope}`);
        if (h && hit(h, re) && !hit(w, re)) fail(`A|${u}#turn`, `REGRESSION place lost in turn: W ${fa(w)} | H ${fa(h)}`);
        if (h && (h.b !== w?.b || h.dest !== w?.dest || h.area !== w?.area || h.cand !== w?.cand)) notes.push(`A turn diff 「${u}」: W ${fa(w)} | H ${fa(h)}`);
      }
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
