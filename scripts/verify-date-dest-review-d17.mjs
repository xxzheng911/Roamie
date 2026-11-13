import "./verify-netguard-full.mjs";
/**
 * D17 (tester, independent review: re-ask mark single use + relaxed city-name shape). W (working tree) vs H (HEAD via --head-dir).
 * Harness: App-order turn of verify-m16-post-selection-switch-review.mjs (same slice / re-ask seeding as verify-date-dest-review-d15.mjs).
 *  N) re-ask → name (の／ヶ／ノ, Latin ≤5 words, 6-word boundary) → days → combinations; geocode counted.
 *  H) re-ask → hesitation / chit-chat (incl. ja sentences with の) → geocode must be 0.
 *  P) re-ask → no-preference / thanks words, every locale → geocode must be 0; next step recorded.
 *  S) side effects of the wrapper mutating session.travelContext:
 *     S1 globalPlanningTurn twice on the same object (travel-context.ts:2139 then :2165 order) vs once on a clone;
 *     S2 wouldMergeTravelContextResetTrip(n) then mergeTravelContext(n) on the SAME object vs merge on a clone;
 *     S3 _app.chat.tsx:9402/9426: switchBase = {...session}; globalPlanningTurn(switchBase) leaks into session?;
 *        App-order CONFIRMED_SWITCH turns after the re-ask (harness models 9426, appTurn line 307);
 *     S4 mergeTravelContext mutates the caller's (uncloned) session on a legacy turn; a following name turn on it.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=590 scripts/verify-date-dest-review-d17.mjs -- --head-dir=<snapshot>
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
// N: names (required: 鞆の浦 / San Pedro de Atacama; mine: the rest); BOUNDARY = 6 Latin words (record only)
const NAMES_REQ = ["鞆の浦", "San Pedro de Atacama"];
const NAMES_MINE = ["天橋立", "白川郷", "湯布院", "Lake Tekapo", "Cinque Terre", "Mont Saint Michel", "ニセコ", "八ヶ岳", "駒ヶ根", "湯ノ山", "Saint-Jean-Pied-de-Port", "Rio de Janeiro"];
const BOUNDARY = ["Lake Tekapo Village New Zealand South", "San Pedro de Atacama Chile"];
const NAME_RE = {
  鞆の浦: /鞆の浦|鞆之浦|Tomonoura|도모노우라/i, "San Pedro de Atacama": /Atacama|阿塔卡馬|아타카마/i,
  天橋立: /天橋立|Amanohashidate/i, 白川郷: /白川郷|白川乡|Shirakawa/i, 湯布院: /湯布院|由布院|Yufuin/i, "Lake Tekapo": /Tekapo/i,
  "Cinque Terre": /Cinque/i, "Mont Saint Michel": /Michel/i, ニセコ: /ニセコ|Niseko/i, 八ヶ岳: /八ヶ岳|Yatsugatake/i, 駒ヶ根: /駒ヶ根|Komagane/i,
  湯ノ山: /湯ノ山|湯の山|Yunoyama/i, "Saint-Jean-Pied-de-Port": /Pied/i, "Rio de Janeiro": /Janeiro/i,
  "Lake Tekapo Village New Zealand South": /Tekapo/i, "San Pedro de Atacama Chile": /Atacama/i,
};
// H: hesitation / chit-chat (required + ja の sentences + kanji-only / katakana probes)
const HES_REQ = ["まだ決めてない", "not yet", "no thanks", "I don't know yet"];
const HES_NO = ["どこでもいいのですが", "まだなの", "考え中なの", "迷ってるの", "決めてないの", "行きたいところがないの", "そうなの", "どうしようかな", "ちょっと待ってね", "特にないの", "ノープラン", "検討中", "検討中の", "秘密の", "気分次第の", "内緒"];
// P: no preference / thanks
const NOPREF = ["隨便", "都可以", "都行", "你決定", "你推薦", "anywhere", "anything", "you choose", "surprise me", "whatever", "아무데나", "아무거나", "どこでも", "おまかせ", "謝謝", "thanks", "thank you", "ありがとう", "고마워요", "감사합니다"];
const NOPREF_VARIANTS = ["隨便啦", "都可以喔", "Surprise me!", "Thank you!", "ありがとうございます", "감사해요", "おまかせで", "whatever you like"];
// S3: CONFIRMED_SWITCH sentences right after the re-ask
const SWITCH_AFTER = { "zh-TW": ["改去鞆の浦", "改去京都", "改去城崎"], en: ["switch to Kyoto", "switch to Kinosaki"], ja: ["京都に変更", "鞆の浦に変更"], ko: ["교토로 바꿔"] };
const S1_TEXTS = ["附近有什麼好吃的", "nearby restaurants", "大阪", "Osaka", "我再想想", "not yet", "hello", "拉麵", "Kinosaki", "鞆の浦", "San Pedro de Atacama", "隨便", "thanks", "3天", "改去京都", "switch to Kyoto", "まだなの", "검토중", "温泉"];

const EXTRA_FIX = [
  ["kinosaki", "/kinosaki|城崎|키노사키/i", "Kinosaki", "Hyogo", "Japan", "JP", 35.6255, 134.8093, ["Kinosaki", "城崎", "城崎", "키노사키"]],
  ["osaka", "/osaka|大阪|오사카/i", "Osaka", "Osaka", "Japan", "JP", 34.6937, 135.5023, ["Osaka", "大阪", "大阪市", "오사카"]],
  ["naha", "/naha|那霸|那覇|나하/i", "Naha", "Okinawa", "Japan", "JP", 26.2124, 127.6809, ["Naha", "那霸市", "那覇市", "나하시"]],
  ["tomonoura", "/tomonoura|鞆の浦|鞆之浦|도모노우라/i", "Tomonoura", "Hiroshima", "Japan", "JP", 34.3833, 133.3833, ["Tomonoura", "鞆之浦", "鞆の浦", "도모노우라"]],
  ["atacama", "/atacama|阿塔卡馬|아타카마/i", "San Pedro de Atacama", "Antofagasta", "Chile", "CL", -22.9087, -68.1997, ["San Pedro de Atacama", "阿塔卡馬", "サン・ペドロ・デ・アタカマ", "산페드로데아타카마"]],
  ["amanohashidate", "/amanohashidate|天橋立/i", "Amanohashidate", "Kyoto", "Japan", "JP", 35.5694, 135.1906, ["Amanohashidate", "天橋立", "天橋立", "아마노하시다테"]],
  ["shirakawago", "/shirakawa|白川郷|白川乡/i", "Shirakawa-go", "Gifu", "Japan", "JP", 36.2578, 136.9061, ["Shirakawa-go", "白川鄉", "白川郷", "시라카와고"]],
  ["yufuin", "/yufuin|湯布院|由布院|유후인/i", "Yufuin", "Oita", "Japan", "JP", 33.2655, 131.3693, ["Yufuin", "湯布院", "湯布院", "유후인"]],
  ["tekapo", "/tekapo|特卡波|テカポ|테카포/i", "Lake Tekapo", "Canterbury", "New Zealand", "NZ", -44.0046, 170.4771, ["Lake Tekapo", "特卡波湖", "テカポ湖", "테카포 호수"]],
  ["cinque", "/cinque|五漁村|チンクエ|친퀘/i", "Cinque Terre", "Liguria", "Italy", "IT", 44.1461, 9.6439, ["Cinque Terre", "五漁村", "チンクエテッレ", "친퀘테레"]],
  ["msm", "/michel|聖米歇爾|モンサン|몽생미셸/i", "Mont-Saint-Michel", "Normandy", "France", "FR", 48.6361, -1.5115, ["Mont-Saint-Michel", "聖米歇爾山", "モン・サン・ミシェル", "몽생미셸"]],
  ["niseko", "/niseko|ニセコ|二世古|니세코/i", "Niseko", "Hokkaido", "Japan", "JP", 42.8048, 140.6874, ["Niseko", "二世古", "ニセコ", "니세코"]],
  ["yatsugatake", "/yatsugatake|八ヶ岳/i", "Yatsugatake", "Nagano", "Japan", "JP", 35.9708, 138.37, ["Yatsugatake", "八岳", "八ヶ岳", "야쓰가타케"]],
  ["komagane", "/komagane|駒ヶ根/i", "Komagane", "Nagano", "Japan", "JP", 35.7286, 137.9339, ["Komagane", "駒根", "駒ヶ根", "고마가네"]],
  ["yunoyama", "/yunoyama|湯ノ山|湯の山/i", "Yunoyama", "Mie", "Japan", "JP", 35.0166, 136.4666, ["Yunoyama", "湯之山", "湯の山", "유노야마"]],
  ["sjpp", "/pied/i", "Saint-Jean-Pied-de-Port", "Nouvelle-Aquitaine", "France", "FR", 43.1631, -1.2375, ["Saint-Jean-Pied-de-Port", "聖讓皮耶德波爾", "サン＝ジャン＝ピエ＝ド＝ポル", "생장피에드포르"]],
  ["rio", "/janeiro|里約/i", "Rio de Janeiro", "Rio de Janeiro", "Brazil", "BR", -22.9068, -43.1729, ["Rio de Janeiro", "里約熱內盧", "リオデジャネイロ", "리우데자네이루"]],
];

async function collect() {
  const R = {};
  const gpc = await load("src/lib/ai/global-planning-context.ts");
  const sessionMod = await load("src/lib/chat-session.ts");
  const travelContext = await load("src/lib/ai/travel-context.ts");
  const tpc = await load("src/lib/ai/trip-planning-context.ts");
  const HARNESS_SRC = readFileSync("scripts/verify-m16-post-selection-switch-review.mjs", "utf8");
  const from = HARNESS_SRC.indexOf("const resolvedScope = await load(");
  const to = HARNESS_SRC.indexOf("// ------------------------------------------------------------------ scenarios");
  let slice = HARNESS_SRC.slice(from, to);
  const OLD_13058 = 'return dateQuestion("13058");';
  slice = slice.replace(OLD_13058, '{ const dl = planningCtx.destination?.trim() || n.tripDestination?.city?.trim() || ""; '
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
  const geoQ = () => [...H.geocodeLog, ...H.authorityGeocodeLog, ...H.discoveryGeocodeLog];
  const snap = (r) => {
    const s = r.s; const tc = s.travelContext ?? {};
    return { b: r.row?.branch ?? null, cls: r.row?.cls ?? null, p: s.pendingQuestion?.type ?? null, dest: tc.destination ?? null, trip: s.tripDestination?.city ?? null,
      cand: tc.destinationCandidate ? `${tc.destinationCandidate.raw}/${tc.destinationCandidate.status}` : null,
      inputs: tc.destinationInputNames === undefined ? "undef" : JSON.stringify(tc.destinationInputNames),
      days: tc.days ?? s.tripDays ?? null, offered: (tc.offeredCombinations ?? []).length, reply: (r.row?.reply ?? "").replace(/\n/g, " / ").slice(0, 150) };
  };
  const turnS = async (s0, t, loc) => {
    const q0 = geoQ().length;
    try { const r = await H.appTurn(structuredClone(s0), t, loc); const q = geoQ().slice(q0); return { row: { ...snap(r), geo: q.length, q: q.join("|") }, s: r.s }; }
    catch (e) { return { row: { b: `THROW ${String(e?.message ?? e).slice(0, 80)}`, geo: -1 }, s: null }; }
  };
  const fresh = async (loc) => { H.freshAll(); await H.freshAuthority(); H.setLocale(loc); };
  const seedFor = async (loc, base) => {
    for (const t of CAND_SEED[loc]) {
      await fresh(loc);
      let r; try { r = await H.appTurn(structuredClone(base), t, loc); } catch { continue; }
      const c = r.s.travelContext?.destinationCandidate;
      if (c && c.status !== "resolved") return { seed: t, s1: r.s };
    }
    const raw = SYN_RAW[loc];
    return { seed: `SYNTHETIC ${raw}`, s1: { ...base, lastAssistantReply: "(confirm city and country)",
      travelContext: { interests: [], destinationCandidate: { raw, status: "unresolved", locale: loc }, destinationInputNames: [raw], lastIntent: "trip_planning", tripPurpose: "region_selected" } } };
  };
  const nextOf = (a) => ({ ...a.s, lastAssistantReply: (a.row.reply ?? "").replace(/ \/ /g, "\n") });
  const reasked = {};
  for (const loc of LOCS) {
    const { seed, s1 } = await seedFor(loc, sessionMod.createEmptySession());
    await fresh(loc);
    const no = await turnS(s1, NO[loc], loc);
    R[`SEED|${loc}`] = { seed, inputs: no.row.inputs, p: no.row.p, reply: no.row.reply };
    reasked[loc] = no.s ? nextOf(no) : null;
  }
  const gOf = (s, t) => { try { const x = gpc.globalPlanningTurn(structuredClone(s), t); return x === undefined ? "undefined" : `cand=${x.destinationCandidate?.raw ?? "-"}`; } catch (e) { return `THROW ${e?.message}`; } };

  if (want("n")) for (const loc of LOCS) {
    const base = reasked[loc]; if (!base) continue;
    for (const nm of [...NAMES_REQ, ...NAMES_MINE, ...BOUNDARY]) {
      await fresh(loc); const a = await turnS(base, nm, loc);
      let b = null; if (a.s) { await fresh(loc); b = (await turnS(nextOf(a), DAYS[loc], loc)).row; }
      R[`N|${loc}|${nm}`] = { a: { ...a.row, g: gOf(base, nm) }, b };
    }
  }
  if (want("h")) for (const loc of LOCS) {
    const base = reasked[loc]; if (!base) continue;
    for (const t of [...HES_REQ, ...HES_NO]) { await fresh(loc); R[`H|${loc}|${t}`] = { ...(await turnS(base, t, loc)).row, g: gOf(base, t) }; }
  }
  if (want("p")) for (const loc of LOCS) {
    const base = reasked[loc]; if (!base) continue;
    for (const t of [...NOPREF, ...NOPREF_VARIANTS]) {
      await fresh(loc); const a = await turnS(base, t, loc);
      const row = { ...a.row, g: gOf(base, t) };
      // the step after: a city name still taken (mark single use → the name is only a city on a plain session)
      if (a.s) { await fresh(loc); const n = await turnS(nextOf(a), { "zh-TW": "那霸", en: "Naha", ja: "那覇", ko: "나하" }[loc], loc); row.nextName = n.row; }
      R[`P|${loc}|${t}`] = row;
    }
  }
  if (want("f")) {
    // F: after the mark is used by a non-city turn (hesitation / no-pref / thanks), is a city name still taken? vs a fresh session
    const NM = { "zh-TW": ["那霸", "熱海", "鞆の浦"], en: ["Naha", "Atami", "Kinosaki"], ja: ["那覇", "熱海", "鞆の浦"], ko: ["나하", "아타미"] };
    const HES = { "zh-TW": ["我再想想", "隨便", "謝謝"], en: ["not yet", "surprise me", "thanks"], ja: ["まだ決めてない", "おまかせ", "ありがとう"], ko: ["아직 몰라요", "아무데나", "고마워요"] };
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const nm of NM[loc]) {
        await fresh(loc); R[`F0|${loc}|${nm}`] = (await turnS(sessionMod.createEmptySession(), nm, loc)).row;
        await fresh(loc); R[`F0r|${loc}|${nm}`] = (await turnS(base, nm, loc)).row;
        for (const h of HES[loc]) {
          await fresh(loc); const a = await turnS(base, h, loc);
          if (!a.s) continue;
          await fresh(loc); R[`F1|${loc}|${h}>${nm}`] = { first: a.row, name: (await turnS(nextOf(a), nm, loc)).row };
        }
      }
    }
  }
  if (want("l")) {
    // L: Latin names of ≤5 words but >20 characters (and controls) right after the re-ask; then the same name again
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const nm of ["Santiago de Compostela", "Plitvice Lakes National Park", "Saint-Jean-Pied-de-Port", "Torres del Paine", "Rio de Janeiro"]) {
        await fresh(loc); const a = await turnS(base, nm, loc);
        const row = { ...a.row, g: gOf(base, nm), len: nm.length };
        if (a.s) { await fresh(loc); row.again = (await turnS(nextOf(a), nm, loc)).row; }
        await fresh(loc); row.freshSession = (await turnS(sessionMod.createEmptySession(), nm, loc)).row;
        R[`L|${loc}|${nm}`] = row;
      }
    }
  }
  if (want("s3c")) {
    // S3c: negated-switch sentences right after the re-ask (CONFIRMED_SWITCH → _app.chat.tsx:9402/9426 path in appTurn)
    const S3C = { "zh-TW": ["不去草津溫泉了，改去鞆の浦", "不去草津溫泉了，改去京都", "不去草津溫泉了，改去城崎"], en: ["not Kusatsu Onsen anymore, switch to Kinosaki", "not Kusatsu Onsen anymore, switch to Kyoto"],
      ja: ["草津温泉はやめて、鞆の浦に変更", "草津温泉はやめて、京都に変更"], ko: ["오키나와 말고 교토로 바꿔", "오키나와 말고 키노사키로 바꿔"] };
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of S3C[loc]) {
        await fresh(loc); const a = await turnS(base, t, loc);
        const row = { ...a.row, cls0: tpc.classifyDestinationSwitchTurn(t).state, g: gOf(base, t) };
        if (a.s) { await fresh(loc); row.next = (await turnS(nextOf(a), DAYS[loc], loc)).row; }
        // the same sentence when the mark is absent (re-ask state minus the mark)
        const noMark = { ...structuredClone(base), travelContext: { ...(base.travelContext ?? { interests: [] }), destinationInputNames: undefined } };
        await fresh(loc); row.noMark = (await turnS(noMark, t, loc)).row;
        R[`S3c|${loc}|${t}`] = row;
      }
    }
  }
  if (want("s")) {
    // S1: two calls on the same object (wouldMerge :2139 → merge :2165) vs one call on a clone
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of S1_TEXTS) {
        const obj = structuredClone(base);
        const j = (x) => (x === undefined ? "undefined" : JSON.stringify({ d: x.destination ?? null, c: x.destinationCandidate?.raw ?? null, s: x.destinationCandidate?.status ?? null, i: x.destinationInputNames ?? null, days: x.days ?? null }));
        let first, second, clonedOnce, markAfter1;
        try { first = j(gpc.globalPlanningTurn(obj, t)); markAfter1 = JSON.stringify(obj.travelContext?.destinationInputNames ?? null); second = j(gpc.globalPlanningTurn(obj, t)); clonedOnce = j(gpc.globalPlanningTurn(structuredClone(base), t)); }
        catch (e) { first = `THROW ${e?.message}`; }
        R[`S1|${loc}|${t}`] = { first, second, clonedOnce, markAfter1 };
      }
    }
    // S2: wouldMergeTravelContextResetTrip(n) then mergeTravelContext(n) on the same object vs merge on a clone
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of S1_TEXTS) {
        const pick = (m) => JSON.stringify({ d: m.context.destination ?? null, c: m.context.destinationCandidate ? `${m.context.destinationCandidate.raw}/${m.context.destinationCandidate.status}` : null, i: m.context.destinationInputNames ?? null, days: m.context.days ?? null, si: m.session.travelContext?.destinationInputNames ?? null });
        try {
          const same = structuredClone(base);
          const would = travelContext.wouldMergeTravelContextResetTrip(same, t);
          const markAfterWould = JSON.stringify(same.travelContext?.destinationInputNames ?? null);
          const a = pick(travelContext.mergeTravelContext(same, t, base.lastAssistantReply));
          const b = pick(travelContext.mergeTravelContext(structuredClone(base), t, base.lastAssistantReply));
          R[`S2|${loc}|${t}`] = { would, markAfterWould, sameObj: a, cloned: b };
        } catch (e) { R[`S2|${loc}|${t}`] = { err: String(e?.message ?? e).slice(0, 120) }; }
      }
    }
    // S3a: _app.chat.tsx:9402 switchBase = { ...session, pendingClarification: undefined } (shallow copy)
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of [...SWITCH_AFTER[loc], "附近有什麼好吃的", "hello"]) {
        const session = structuredClone(base);
        const tcRef = session.travelContext;
        const switchBase = { ...session, pendingClarification: undefined };
        let g; try { g = gpc.globalPlanningTurn(switchBase, t); } catch (e) { g = `THROW ${e?.message}`; }
        R[`S3a|${loc}|${t}`] = { g: g === undefined ? "undefined" : typeof g === "string" ? g : `cand=${g.destinationCandidate?.raw ?? "-"}`,
          sessionMark: JSON.stringify(session.travelContext?.destinationInputNames ?? null), sessionTcSameRef: session.travelContext === tcRef,
          tcObjMark: JSON.stringify(tcRef?.destinationInputNames ?? null), switchBaseMark: JSON.stringify(switchBase.travelContext?.destinationInputNames ?? null) };
      }
    }
    // S3b: App-order CONFIRMED_SWITCH turns after the re-ask (appTurn models 9402/9426 at harness line 304-307), vs fresh session
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const t of SWITCH_AFTER[loc]) {
        await fresh(loc); const a = await turnS(base, t, loc);
        const row = { ...a.row, cls0: tpc.classifyDestinationSwitchTurn(t).state };
        if (a.s) { await fresh(loc); row.next = (await turnS(nextOf(a), DAYS[loc], loc)).row; }
        await fresh(loc); row.freshSession = (await turnS(sessionMod.createEmptySession(), t, loc)).row;
        R[`S3b|${loc}|${t}`] = row;
      }
    }
    // S4: mergeTravelContext on the caller's object (no clone) for a legacy turn, then a name on that same object
    for (const loc of LOCS) {
      const base = reasked[loc]; if (!base) continue;
      for (const [t1, t2] of [["附近有什麼好吃的", "鞆の浦"], ["hello", "Kinosaki"], ["大阪", "Kinosaki"]]) {
        try {
          const obj = structuredClone(base);
          const tcRef = obj.travelContext;
          const g1 = gOf(base, t1);
          travelContext.mergeTravelContext(obj, t1, base.lastAssistantReply);
          const mutated = obj.travelContext !== tcRef;
          const markAfter = JSON.stringify(obj.travelContext?.destinationInputNames ?? null);
          const g2same = (() => { const x = gpc.globalPlanningTurn(structuredClone(obj), t2); return x === undefined ? "undefined" : `cand=${x.destinationCandidate?.raw ?? "-"}`; })();
          const g2base = gOf(base, t2);
          R[`S4|${loc}|${t1}>${t2}`] = { g1, mutated, markAfter, g2AfterMutation: g2same, g2OnUntouched: g2base };
        } catch (e) { R[`S4|${loc}|${t1}>${t2}`] = { err: String(e?.message ?? e).slice(0, 120) }; }
      }
    }
  }
  return R;
}

if (CHILD) {
  const R = await collect();
  out(`@@D17_JSON@@${JSON.stringify({ R })}@@END@@`);
  process.stdout.write("", () => process.exit(0));
} else {
  let HR = null;
  if (headDir) {
    const self = "scripts/verify-date-dest-review-d17.mjs";
    for (const f of [self, "scripts/verify-m16-post-selection-switch-review.mjs", "scripts/verify-netguard-full.mjs"]) {
      if (!existsSync(join(headDir, f)) || readFileSync(join(headDir, f), "utf8") !== readFileSync(f, "utf8")) copyFileSync(f, join(headDir, f));
    }
    const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child", ...(ONLY ? [`--only=${ONLY.join(",")}`] : [])], { cwd: headDir, encoding: "utf8", timeout: 280_000, maxBuffer: 128 << 20 });
    const m = (r.stdout ?? "").match(/@@D17_JSON@@([\s\S]*?)@@END@@/);
    HR = m ? JSON.parse(m[1]).R : null;
    const ng = (r.stderr ?? "").match(/NETGUARD blocked=\d+/g);
    out(`HEAD child: status=${r.status} ${ng ? ng.join(" ") : "NETGUARD line missing"}`);
    if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status} signal ${r.signal}): ${(r.stderr ?? "").slice(-600)}`);
  }
  const WR = await collect();
  const failures = []; const notes = [];
  const fail = (k, m) => { failures.push(k); out(`FAIL ${k}: ${m}`); };
  const fa = (x) => !x ? "n/a" : `[${x.b}] cls=${x.cls ?? "-"} p=${x.p ?? "-"} dest=${x.dest} trip=${x.trip} cand=${x.cand ?? "-"} inputs=${x.inputs} days=${x.days ?? "-"} off=${x.offered ?? "-"} geo=${x.geo}${x.q ? `(${x.q})` : ""}${x.g ? ` g=${x.g}` : ""} | ${x.reply ?? ""}`;
  const took = (x, re) => [x?.dest, x?.trip, x?.cand?.split("/")[0]].filter(Boolean).some((v) => re.test(String(v))) && !/destination_clarification/.test(x?.b ?? "");

  out("==== seeds / re-ask ====");
  for (const loc of LOCS) out(`-- ${loc} W seed=${WR[`SEED|${loc}`]?.seed} inputs=${WR[`SEED|${loc}`]?.inputs} p=${WR[`SEED|${loc}`]?.p} | H seed=${HR?.[`SEED|${loc}`]?.seed ?? "n/a"} inputs=${HR?.[`SEED|${loc}`]?.inputs ?? "n/a"}`);

  if (want("n")) {
    out("\n==== N) re-ask → name → days → combinations ====");
    for (const loc of LOCS) for (const nm of [...NAMES_REQ, ...NAMES_MINE, ...BOUNDARY]) {
      const k = `N|${loc}|${nm}`; const w = WR[k]; const h = HR?.[k]; if (!w) { fail(k, "missing"); continue; }
      const re = NAME_RE[nm];
      const ok = took(w.a, re) && w.a.geo === 1 && w.a.p === "ask_days" && w.b?.p === "combination_choice" && (w.b?.offered ?? 0) > 0;
      const hOk = h ? took(h.a, re) && h.a.geo === 1 && h.a.p === "ask_days" && h.b?.p === "combination_choice" && (h.b?.offered ?? 0) > 0 : null;
      const boundary = BOUNDARY.includes(nm);
      const tag = ok ? "ok" : boundary ? "BOUND" : "BAD";
      if (!ok && !boundary) fail(k, `W ${fa(w.a)} → ${fa(w.b)}`);
      if (boundary) notes.push(`BOUNDARY ${loc} 「${nm}」 W ok=${ok} geo=${w.a.geo} [${w.a.b}] | H ok=${hOk} geo=${h?.a?.geo ?? "n/a"}`);
      out(`${tag.padEnd(5)} ${loc} 「${nm}」 W geo=${w.a.geo} p=${w.a.p} → p=${w.b?.p} off=${w.b?.offered} | H ok=${hOk} geo=${h?.a?.geo ?? "n/a"} p=${h?.a?.p ?? "n/a"} → p=${h?.b?.p ?? "n/a"} off=${h?.b?.offered ?? "n/a"}`);
      if (!ok) { out(`    W a ${fa(w.a)}`); out(`    W b ${fa(w.b)}`); }
    }
  }
  if (want("h")) {
    out("\n==== H) re-ask → hesitation / chit-chat: geocode must be 0 ====");
    for (const loc of LOCS) for (const t of [...HES_REQ, ...HES_NO]) {
      const k = `H|${loc}|${t}`; const w = WR[k]; const h = HR?.[k]; if (!w) { fail(k, "missing"); continue; }
      const ok = w.geo === 0 && !w.cand && !w.dest;
      const regress = !ok && h && h.geo === 0;
      if (!ok) (regress ? fail(k, `REGRESSION vs HEAD geo=${h.geo}: ${fa(w)}`) : notes.push(`H ${loc} 「${t}」 W geo=${w.geo}(${w.q}) [${w.b}] cand=${w.cand} | HEAD geo=${h?.geo ?? "n/a"} (not a regression)`));
      out(`${(ok ? "ok" : regress ? "BAD" : "SAME").padEnd(5)} ${loc} 「${t}」 W [${w.b}] p=${w.p ?? "-"} geo=${w.geo}${w.q ? `(${w.q})` : ""} cand=${w.cand ?? "-"} g=${w.g} | H geo=${h?.geo ?? "n/a"}${h?.q ? `(${h.q})` : ""} g=${h?.g ?? "n/a"}`);
    }
  }
  if (want("p")) {
    out("\n==== P) re-ask → no preference / thanks: geocode must be 0; next step ====");
    for (const loc of LOCS) for (const t of [...NOPREF, ...NOPREF_VARIANTS]) {
      const k = `P|${loc}|${t}`; const w = WR[k]; const h = HR?.[k]; if (!w) { fail(k, "missing"); continue; }
      const ok = w.geo === 0 && !w.cand && !w.dest;
      const req = NOPREF.includes(t);
      if (!ok && req) fail(k, fa(w));
      if (!ok && !req) notes.push(`P variant ${loc} 「${t}」 W geo=${w.geo}(${w.q}) cand=${w.cand} | H geo=${h?.geo ?? "n/a"}`);
      out(`${(ok ? "ok" : req ? "BAD" : "VAR").padEnd(5)} ${loc} 「${t}」 W [${w.b}] p=${w.p ?? "-"} geo=${w.geo}${w.q ? `(${w.q})` : ""} inputs=${w.inputs} g=${w.g} | H geo=${h?.geo ?? "n/a"}${h?.q ? `(${h.q})` : ""} cand=${h?.cand ?? "-"}`);
      out(`      W reply: ${w.reply}`);
      out(`      W next 「name」 [${w.nextName?.b}] p=${w.nextName?.p} dest=${w.nextName?.dest} cand=${w.nextName?.cand} geo=${w.nextName?.geo} | H next [${h?.nextName?.b ?? "n/a"}] p=${h?.nextName?.p ?? "n/a"} geo=${h?.nextName?.geo ?? "n/a"}`);
    }
  }
  if (want("f")) {
    out("\n==== F) a city name after the mark was used by a non-city turn (vs fresh session / directly after the re-ask) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("F1|"))) {
      const [, loc, pair] = k.split("|"); const nm = pair.split(">")[1];
      const w = WR[k]; const f0 = WR[`F0|${loc}|${nm}`]; const fr = WR[`F0r|${loc}|${nm}`]; const h = HR?.[k];
      const taken = (x) => Boolean(x && (x.dest || x.trip || (x.cand && /resolved/.test(x.cand))) && !/destination_clarification/.test(x.b ?? ""));
      // The App's own reply to the non-city turn re-asks the city (destination_clarification): the answer must be taken.
      const askedCity = /destination_clarification/.test(w.first.b ?? "");
      const tag = taken(w.name) ? "ok" : askedCity ? "LOOP" : "SAME";
      if (tag === "LOOP") fail(k, `App re-asked the city ([${w.first.b}] 「${w.first.reply}」) but 「${nm}」 is not taken: [${w.name.b}] geo=${w.name.geo} 「${w.name.reply}」 (fresh session [${f0?.b}], HEAD [${h?.name?.b ?? "n/a"}] dest=${h?.name?.dest ?? "n/a"})`);
      if (tag === "LOOP") notes.push(`F ${loc} re-ask → 「${pair.split(">")[0]}」 → 「${nm}」 not taken (W [${w.name.b}] geo=${w.name.geo}) but a fresh session takes it ([${f0.b}] dest=${f0.dest}); HEAD [${h?.name?.b ?? "n/a"}] dest=${h?.name?.dest ?? "n/a"}`);
      out(`${tag.padEnd(5)} ${k} first [${w.first.b}] geo=${w.first.geo} → name [${w.name.b}] p=${w.name.p} dest=${w.name.dest} cand=${w.name.cand} geo=${w.name.geo} | fresh [${f0?.b}] dest=${f0?.dest} geo=${f0?.geo} | right after re-ask [${fr?.b}] dest=${fr?.dest} geo=${fr?.geo} | H name [${h?.name?.b ?? "n/a"}] dest=${h?.name?.dest ?? "n/a"} geo=${h?.name?.geo ?? "n/a"}`);
      out(`      W name reply: ${w.name.reply}`);
    }
  }
  if (want("l")) {
    out("\n==== L) Latin names ≤5 words, >20 characters, right after the re-ask (record) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("L|"))) {
      const w = WR[k]; const h = HR?.[k];
      const taken = w.geo === 1 && w.p === "ask_days";
      if (!taken) notes.push(`L ${k} (len ${w.len}) not taken after the re-ask: W [${w.b}] geo=${w.geo} g=${w.g}; again [${w.again?.b}] geo=${w.again?.geo}; fresh [${w.freshSession?.b}] geo=${w.freshSession?.geo}; HEAD geo=${h?.geo ?? "n/a"} p=${h?.p ?? "n/a"}`);
      out(`${(taken ? "ok" : "MISS").padEnd(5)} ${k} len=${w.len} W [${w.b}] p=${w.p} geo=${w.geo} g=${w.g} | again [${w.again?.b}] geo=${w.again?.geo} | fresh [${w.freshSession?.b}] dest=${w.freshSession?.dest} geo=${w.freshSession?.geo} | H [${h?.b ?? "n/a"}] geo=${h?.geo ?? "n/a"}`);
    }
  }
  if (want("s3c")) {
    out("\n==== S3c) negated switch right after the re-ask (9426 path when CONFIRMED_SWITCH) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S3c|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`   ${k} cls=${w.cls0} g=${w.g}`);
      out(`       W     ${fa(w)}`);
      out(`       W→days ${fa(w.next)}`);
      out(`       noMark ${fa(w.noMark)}`);
      if (HR) out(`       H     ${fa(h)} | H→days ${fa(h?.next)}`);
      const diff = ["b", "dest", "cand", "geo", "p"].filter((f) => JSON.stringify(w[f]) !== JSON.stringify(w.noMark?.[f]));
      if (diff.length) notes.push(`S3c ${k} mark vs no mark differ [${diff}]: W [${w.b}] dest=${w.dest} geo=${w.geo} | noMark [${w.noMark?.b}] dest=${w.noMark?.dest} geo=${w.noMark?.geo}`);
    }
  }
  if (want("s")) {
    out("\n==== S1) globalPlanningTurn twice on the same object (2139 → 2165 order) ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S1|"))) {
      const x = WR[k]; const diff = x.first !== x.second;
      const cloneDiff = x.first !== x.clonedOnce;
      if (diff) fail(k, `second call differs: first=${x.first} second=${x.second}`);
      if (cloneDiff) fail(k, `first call differs from clone: ${x.first} vs ${x.clonedOnce}`);
      out(`${(diff || cloneDiff ? "BAD" : "ok").padEnd(5)} ${k} first=${x.first} markAfter1=${x.markAfter1} second=${x.second}`);
    }
    out("\n==== S2) wouldMergeTravelContextResetTrip(n) → mergeTravelContext(n) on the same object vs clone ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S2|"))) {
      const x = WR[k];
      if (x.err) { fail(k, x.err); continue; }
      const diff = x.sameObj !== x.cloned;
      if (diff) fail(k, `same=${x.sameObj} clone=${x.cloned}`);
      out(`${(diff ? "BAD" : "ok").padEnd(5)} ${k} would=${x.would} markAfterWould=${x.markAfterWould} merge=${x.sameObj}`);
    }
    out("\n==== S3a) _app.chat.tsx:9402/9426 shallow copy: does globalPlanningTurn(switchBase) leak into session? ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S3a|"))) {
      const x = WR[k];
      const leak = x.sessionMark !== "[]" || !x.sessionTcSameRef || x.tcObjMark !== "[]";
      if (leak) fail(k, JSON.stringify(x));
      out(`${(leak ? "LEAK" : "ok").padEnd(5)} ${k} g=${x.g} session.mark=${x.sessionMark} sameRef=${x.sessionTcSameRef} sharedTcObj.mark=${x.tcObjMark} switchBase.mark=${x.switchBaseMark}`);
    }
    out("\n==== S3b) App-order CONFIRMED_SWITCH turn after the re-ask (harness 9426 model) vs fresh session ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S3b|"))) {
      const w = WR[k]; const h = HR?.[k];
      out(`   ${k} cls=${w.cls0} W ${fa(w)}`);
      out(`       W then days ${fa(w.next)}`);
      out(`       fresh ${fa(w.freshSession)}`);
      if (HR) out(`       H ${fa(h)} | H then ${fa(h?.next)}`);
      const sameAsFresh = w.b === w.freshSession?.b && w.dest === w.freshSession?.dest && w.cand === w.freshSession?.cand && w.geo === w.freshSession?.geo;
      if (!sameAsFresh) notes.push(`S3b ${k} differs from fresh session: W [${w.b}] dest=${w.dest} cand=${w.cand} geo=${w.geo} vs fresh [${w.freshSession?.b}] dest=${w.freshSession?.dest} cand=${w.freshSession?.cand} geo=${w.freshSession?.geo} (HEAD [${h?.b ?? "n/a"}] geo=${h?.geo ?? "n/a"})`);
      if (h && (h.b !== w.b || h.geo !== w.geo || h.dest !== w.dest)) notes.push(`S3b ${k} W vs HEAD: W [${w.b}] dest=${w.dest} geo=${w.geo} | H [${h.b}] dest=${h.dest} geo=${h.geo}`);
    }
    out("\n==== S4) mergeTravelContext mutates the caller's session (legacy turn), then a name on the same object ====");
    for (const k of Object.keys(WR).filter((k) => k.startsWith("S4|"))) {
      const x = WR[k]; const h = HR?.[k];
      out(`   ${k} g1=${x.g1} mutatedCaller=${x.mutated} markAfter=${x.markAfter} name on mutated obj → ${x.g2AfterMutation} | on untouched → ${x.g2OnUntouched} | H mutated=${h?.mutated ?? "n/a"} H name→${h?.g2AfterMutation ?? "n/a"}`);
      if (x.mutated) notes.push(`S4 ${k}: mergeTravelContext replaced the caller's session.travelContext (input object mutated)`);
    }
  }
  if (!HR) out("NOTE no HEAD rows (run with --head-dir)");
  out(`\nNOTES ${notes.length}:\n  ${notes.join("\n  ")}`);
  out(`SUMMARY fail=${failures.length}`);
  out(failures.length ? `FAIL ${failures.length} check(s): ${failures.join(" | ")}` : "PASS all");
  process.stdout.write("", () => process.exit(failures.length ? 1 : 0));
}
