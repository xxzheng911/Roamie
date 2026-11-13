/**
 * M17 (tester, independent review round 2 of the "all stages switch city with one rule" change).
 *  a) negatedOnlyWishSwitchText widening: 「<city>不去了，我要去 Y」 — activity / category / generic Y must never be a
 *     CONFIRMED_SWITCH (no switch, no paid geocode). Four locales. Compared WORK vs HEAD (classification + the
 *     global-planning candidate on choosing / picked / done sessions). A CONFIRMED_SWITCH(pending_provider) costs
 *     one provider geocode in the App (resolveTrustedRecommendationSearchScope), counted here with a mock.
 *  b) isCurrentTripDateSnapshot: the normal first-trip generation (id assigned during generation via
 *     getOrCreatePlanningSessionId, planVersion unchanged) is never dropped.
 *  t) 臺／台 variants of the negated current destination under en / ja / ko (and zh-TW).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-m17-negated-wish-misfires.mjs [-- --head-dir=<snapshot>]
 */
import "./verify-netguard-full.mjs";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 280_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const loadOpt = (p) => load(p).catch(() => null);

const tpc = await load("src/lib/ai/trip-planning-context.ts");
const gp = await load("src/lib/ai/global-planning-context.ts");
const sessionMod = await load("src/lib/chat-session.ts");
const turnDest = await load("src/lib/ai/chat-turn-destination.ts");
const planSession = await load("src/lib/ai/ai-planning-session.ts");
const dateConfirm = await loadOpt("src/lib/ai/trip-date-confirmation.ts");

// ------------------------------------------------------------------ fixtures
const CITY = {
  "雪梨": { country: "澳洲" }, "熱海": { country: "日本" }, "京都": { country: "日本" }, "東京": { country: "日本" },
  "Sydney": { country: "Australia" }, "シドニー": { country: "オーストラリア" }, "시드니": { country: "호주" },
  "台北": { country: "台灣" }, "臺北": { country: "臺灣" }, "台南": { country: "台灣" }, "臺南": { country: "臺灣" },
};
const mk = (dest, stage) => {
  const base = sessionMod.createEmptySession();
  const ctx = { interests: [], destination: dest, destinationCountry: CITY[dest]?.country, destinationType: "city", destinationInputNames: [dest],
    startDate: "2026-12-10", endDate: "2026-12-14", days: 5, dateProvenance: { source: "user_date", confirmed: true, startDate: "2026-12-10", endDate: "2026-12-14" },
    tripPurpose: "combination_suggestions_offered", offeredCombinations: [{ id: "combo_1", places: ["A", "B"] }] };
  const s = { ...base, travelContext: ctx, tripDestination: { city: dest, displayLabel: dest, country: CITY[dest]?.country }, phase: "recommend", planningSessionId: "ps_1", planVersion: 1 };
  if (stage === "choosing") return { ...s, pendingQuestion: { type: "combination_choice", options: ["1", "2", "3"], baseDestination: dest } };
  if (stage === "picked") return { ...s, travelContext: { ...ctx, selectedCombinationIds: ["combo_1"] } };
  if (stage === "done") return { ...s, phase: "done", aiItineraryState: "SUCCESS", lastGeneratedTripId: "trip_1", travelContext: { ...ctx, offeredCombinations: undefined, selectedCombinationIds: [] } };
  if (stage === "failed") return { ...s, chatPlanningState: "generationFailed", aiItineraryState: "FAILED", phase: "ready",
    pendingQuestion: { type: "activity_choice", options: ["重新生成"], baseDestination: dest }, travelContext: { ...ctx, selectedCombinationIds: ["combo_1"] } };
  return s;
};

// Misfire corpus: negated current city + wish + activity / category / generic wording. None is a city switch.
const MIS = {
  "zh-TW": [
    "雪梨不去了，我想去衝浪", "雪梨不去了，我要去購物", "雪梨不去了，我要去海邊", "雪梨不去了，我想去看夜景", "雪梨不去了，我要去吃拉麵",
    "雪梨不去了，我想去泡溫泉", "雪梨不去了，我要去爬山", "雪梨不去了，我想去潛水", "雪梨不去了，我要去休息", "雪梨不去了，我想去夜市",
    "雪梨不去了，我想去博物館", "雪梨不去了，我要去逛街", "雪梨不去了，我想去滑雪", "雪梨不去了，我想去海灘", "雪梨不去了，我要去咖啡廳",
    "雪梨不去了，我想去健行", "雪梨不去了，我想去露營", "雪梨不去了，我要去機場", "雪梨不去了，我要去上班", "雪梨不去了，我想去溫泉",
    "雪梨不去了，我想去鄉下", "雪梨不去了，我想去山上", "雪梨不去了，我想去郊外", "雪梨不去了，我想去市區", "雪梨不去了，我想去動物園",
    "雪梨不去了，我想去遊樂園", "雪梨不去了，我想去購物中心", "雪梨不去了，我想去看展", "雪梨不去了，我想去喝酒", "雪梨不去了，我想去按摩",
    "雪梨不去了，我想去別的城市", "雪梨不去了，我想去其他地方", "雪梨不去了，我要去度假", "雪梨不去了，我想去賞櫻", "雪梨不去了，我想去賞楓",
    "雪梨不去了，我想去看極光", "雪梨不去了，我要去朋友家", "雪梨不去了，我想去浮潛", "雪梨不去了，我想去跳傘", "雪梨不去了，我想去海島",
    "雪梨不去了，我想去度假村", "雪梨不去了，我想去SPA", "雪梨不去了，我要去公司", "雪梨不去了，我想去outlet", "雪梨不去了，我想去吃好吃的",
    "熱海不去了，我想去衝浪", "熱海不去了，我要去購物", "東京不去了，我想去溫泉", "京都不去了，我想去看夜景",
    "不去博物館了，我要去逛街", "今天不去了，我要去休息", "海邊不去了，我想去購物", "雪梨就不去了，我想去衝浪", "雪梨不想去了，我要去購物",
  ],
  en: ["not Sydney anymore, I want to go surfing", "skip Sydney, I want to go shopping", "not Sydney anymore, I want to go to the beach",
    "forget Sydney, I'd like to go hiking", "not Sydney anymore, I want to go eat ramen", "instead of Sydney, I want to see the night view",
    "not Sydney anymore, I want to rest", "rather than Sydney, I want to go to a museum"],
  ja: ["シドニーはやめて、サーフィンに行きたい", "シドニーはやめて、買い物に行きたい", "シドニーじゃなくて海に行きたい", "シドニーはやめて、ラーメンを食べに行きたい",
    "シドニーはやめて、夜景を見に行きたい", "シドニーはやめて、温泉に行きたい", "シドニーじゃなくて、休みたい", "シドニーはやめて、美術館に行きたい"],
  ko: ["시드니 말고 서핑하러 가고 싶어", "시드니 말고 쇼핑하러 갈래", "시드니 말고 바다에 가고 싶어", "시드니 말고 라멘 먹으러 갈래",
    "시드니 말고 야경 보러 가고 싶어", "시드니 말고 온천에 가고 싶어", "시드니 말고 쉬고 싶어", "시드니 말고 박물관에 가고 싶어"],
};
// Positive controls: a place after the wish wording is a switch (requirement).
const POS = ["雪梨不去了，我要去熱海", "雪梨不去了，我要去京都", "熱海不去了，我要去雪梨", "雪梨不去了，我想去別府"];
const cityOf = (t) => (/^(?:不去)?(雪梨|熱海|東京|京都)/.exec(t)?.[1]) ?? (/Sydney/.test(t) ? "Sydney" : /シドニー/.test(t) ? "シドニー" : /시드니/.test(t) ? "시드니" : "雪梨");

const geocodeLog = [];
const geocodeFn = async ({ data }) => { geocodeLog.push(data.query); return { location: null, error: null, providerResult: { ok: true, rawResultCount: 0 } }; };
const ctxSummary = (c) => c ? { dest: c.destination ?? null, cand: c.destinationCandidate ? `${c.destinationCandidate.raw}/${c.destinationCandidate.status}${c.destinationCandidate.combinationSwitch ? "/sw" : ""}` : null,
  clar: c.destinationClarification ?? null, offered: (c.offeredCombinations ?? []).length, start: c.startDate ?? null } : null;

async function rowFor(t, locale) {
  const cls = tpc.classifyDestinationSwitchTurn(t);
  const parsed = tpc.parseNegatedDestinationSwitchTurn ? tpc.parseNegatedDestinationSwitchTurn(t) : tpc.parseNegatedDestinationSwitch?.(t);
  let geo = 0;
  if (cls.state === "CONFIRMED_SWITCH" && cls.targetLabel?.trim()) {
    const g0 = geocodeLog.length;
    const city = cityOf(t);
    const s = mk(city, "picked");
    try { await turnDest.resolveTrustedRecommendationSearchScope({ label: cls.targetLabel.trim(), ctx: s.travelContext, session: s, locale, geocodeFn }); } catch { /* counted */ }
    geo = geocodeLog.length - g0;
  }
  const stages = {};
  for (const stage of ["choosing", "picked", "done", "failed"]) {
    let r; try { r = ctxSummary(gp.globalPlanningTurn(mk(cityOf(t), stage), t)); } catch (e) { r = `THROW ${String(e?.message ?? e).slice(0, 80)}`; }
    stages[stage] = r;
  }
  return { cls: cls.state, authority: cls.authority ?? null, target: cls.targetLabel ?? null, parsed: parsed ? (parsed.target ?? parsed.targetLabel ?? parsed.to ?? JSON.stringify(parsed).slice(0, 60)) : null, geo, stages };
}

const RES = { a: {}, pos: {}, b: {}, t: {} };
for (const locale of Object.keys(MIS)) for (const t of MIS[locale]) RES.a[`${locale}|${t}`] = await rowFor(t, locale);
for (const locale of ["zh-TW", "en", "ja", "ko"]) for (const t of POS) RES.pos[`${locale}|${t}`] = await rowFor(t, locale);

// b) first-trip generation snapshot.
if (dateConfirm?.isCurrentTripDateSnapshot) {
  const cur = dateConfirm.isCurrentTripDateSnapshot;
  const firstNoId = { ...mk("雪梨", "picked"), planningSessionId: undefined, planVersion: undefined };
  const assigned = planSession.getOrCreatePlanningSessionId(firstNoId, "generate_places").session;
  const generatingNow = { ...assigned, phase: "generating", aiItineraryState: "CREATING_TRIP" };
  RES.b["first trip: id assigned during generation, planVersion undefined→undefined"] = { got: cur(firstNoId, generatingNow), want: true };
  RES.b["first trip: id assigned, planVersion undefined vs 0"] = { got: cur(firstNoId, { ...generatingNow, planVersion: 0 }), want: true };
  RES.b["first trip: id assigned, planVersion 1 → 1"] = { got: cur({ ...firstNoId, planVersion: 1 }, { ...generatingNow, planVersion: 1 }), want: true };
  RES.b["first trip: id assigned + ensurePlanningSessionId again (reuse)"] = { got: cur(firstNoId, planSession.ensurePlanningSessionId(generatingNow)), want: true };
  RES.b["first trip: no id on both sides"] = { got: cur(firstNoId, { ...firstNoId, phase: "generating" }), want: true };
  RES.b["snapshot with id, same id"] = { got: cur(assigned, generatingNow), want: true };
  RES.b["first trip: trip_created cleanup after id assigned"] = { got: cur(firstNoId, planSession.clearPlanningSessionState(generatingNow, "trip_created")), want: true };
  // INFO only (mid-generation switch is not a real scenario: input is locked while generating).
  RES.b["INFO no-id snapshot vs startNewPlanningSession (new id, planVersion not bumped)"] = { got: cur(firstNoId, planSession.startNewPlanningSession(firstNoId, "destination_change")), want: "info" };
  RES.b["INFO no-id snapshot vs resetPlanningPipelineForRegenerate (bumped)"] = { got: cur(firstNoId, planSession.resetPlanningPipelineForRegenerate(firstNoId, "regenerate")), want: "info" };
}

// t) 臺／台 variants of the negated current destination.
for (const [dest, texts] of [["台北", ["臺北不去了，改去京都", "不去臺北了，改去熱海", "not 臺北 anymore, switch to Kyoto", "臺北はやめて、京都に変更", "臺北 말고 교토로 바꿔", "臺北不去了，我要去熱海"]],
  ["臺北", ["台北不去了，改去京都", "not 台北 anymore, switch to Kyoto", "台北はやめて、京都に変更", "台北 말고 교토로 바꿔", "台北不去了，我要去熱海"]],
  ["台南", ["臺南不去了，改去京都", "臺南はやめて、熱海に変更", "臺南 말고 교토로 바꿔"]]]) {
  for (const t of texts) for (const stage of ["choosing", "picked", "done"]) {
    let r; try { r = ctxSummary(gp.globalPlanningTurn(mk(dest, stage), t)); } catch (e) { r = `THROW ${String(e?.message ?? e).slice(0, 80)}`; }
    RES.t[`${dest}|${stage}|${t}`] = { cls: tpc.classifyDestinationSwitchTurn(t).state, ctx: r };
  }
}

if (CHILD) {
  process.stdout.write(`@@M17_JSON@@${JSON.stringify({ RES, fetchCalls })}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

let HEAD = null;
if (headDir) {
  const self = "scripts/verify-m17-negated-wish-misfires.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 240_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@M17_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]).RES : null;
  if (!m) out(`NOTE HEAD child produced no JSON (status ${r.status}): ${(r.stderr ?? "").slice(-600)}`);
}

const failures = [];
const j = (v) => JSON.stringify(v);
const fail = (name, detail) => { failures.push(name); out(`FAIL ${name}\n   ${detail}`); };
// a) misfires: never CONFIRMED_SWITCH, geocode 0, and the global-planning candidate the same as HEAD.
for (const [k, w] of Object.entries(RES.a)) {
  const h = HEAD?.a?.[k];
  const issues = [];
  if (w.cls === "CONFIRMED_SWITCH") issues.push(`CONFIRMED_SWITCH target=${w.target} authority=${w.authority} geocode=${w.geo}`);
  if (h && h.cls !== w.cls) issues.push(`cls WORK=${w.cls} HEAD=${h.cls}`);
  // M16 round 4 (tester review): HEAD turned an en article + category ("the beach" / "a museum") into a
  // pending destination candidate (one paid geocode, trip left on a confirm-city question). WORK no longer
  // creates that candidate (globalPlanningTurn → null, the Sydney trip unchanged). Only this exact
  // improvement is accepted: WORK null at a stage where HEAD's only change was that category candidate.
  const categoryCandidateDropped = (ws, hs) => ws === null && hs && /^(?:the beach|a museum)\/pending$/.test(hs.cand ?? "") &&
    /sydney|雪梨/i.test(hs.dest ?? "") && !hs.clar && !hs.offered;
  if (h) for (const st of Object.keys(w.stages)) {
    if (j(w.stages[st]) === j(h.stages[st])) continue;
    if (categoryCandidateDropped(w.stages[st], h.stages[st])) { out(`INFO a|${k} ${st}: improvement — HEAD category candidate ${h.stages[st].cand} no longer created`); continue; }
    issues.push(`${st}: WORK=${j(w.stages[st])} HEAD=${j(h.stages[st])}`);
  }
  if (issues.length) fail(`a|${k}`, issues.join("\n   ")); else out(`PASS a|${k} (cls=${w.cls}${h ? ` HEAD=${h.cls}` : ""})`);
}
// M16 round 3 (assigner ruling): 「雪梨不去了，我要去 Y」 switches directly only when Y is in the local city table
// (京都); Y outside it (熱海 / 別府) keeps HEAD's confirmation question (NEGATED_UNCERTAIN, 0 geocode).
// 「熱海不去了，我要去雪梨」: the negated 熱海 is not in the local table, so the classifier stays NO_SWITCH; the switch
// is the global-planning one on the 熱海 session (destination 雪梨, old combinations cleared, dates kept) at every stage.
const LOCAL_WISH_TARGET = new Set(["京都", "雪梨"]);
for (const [k, w] of Object.entries(RES.pos)) {
  const h = HEAD?.pos?.[k];
  const t = k.slice(k.indexOf("|") + 1);
  const target = /我[要想]去(.+)$/.exec(t)?.[1];
  const negatedKnown = /^雪梨/.test(t);
  if (negatedKnown && LOCAL_WISH_TARGET.has(target)) {
    if (w.cls !== "CONFIRMED_SWITCH" || w.geo > 1) fail(`pos|${k}`, `cls=${w.cls} target=${w.target} geo=${w.geo}`);
    else out(`PASS pos|${k} target=${w.target} geo=${w.geo}${h ? ` (HEAD cls=${h.cls})` : ""}`);
  } else if (negatedKnown) {
    const issues = [];
    if (w.cls !== "NEGATED_UNCERTAIN") issues.push(`cls=${w.cls} (want NEGATED_UNCERTAIN confirmation)`);
    if (w.geo !== 0) issues.push(`geo=${w.geo}`);
    if (h && h.cls !== w.cls) issues.push(`cls WORK=${w.cls} HEAD=${h.cls}`);
    if (issues.length) fail(`pos|${k}`, issues.join("; ")); else out(`PASS pos|${k} unknown target keeps confirmation (cls=${w.cls} geo=0)`);
  } else {
    const issues = [];
    if (w.cls === "CONFIRMED_SWITCH") issues.push(`unexpected classifier switch target=${w.target}`);
    if (w.geo !== 0) issues.push(`geo=${w.geo}`);
    for (const st of ["choosing", "picked", "done", "failed"]) {
      const c = w.stages[st];
      if (!c || typeof c === "string" || c.dest !== target || c.offered !== 0 || c.start !== "2026-12-10" || c.cand) issues.push(`${st}: ${j(c)} (want dest ${target}, offered 0, start kept, no candidate)`);
    }
    if (issues.length) fail(`pos|${k}`, issues.join("\n   ")); else out(`PASS pos|${k} global-planning switch to ${target} at every stage (cls=${w.cls})`);
  }
}
for (const [k, v] of Object.entries(RES.b)) {
  if (v.want === "info") out(`INFO b|${k}: isCurrent=${v.got}`);
  else if (v.got !== v.want) fail(`b|${k}`, `isCurrent=${v.got} want ${v.want}`);
  else out(`PASS b|${k}`);
}
for (const [k, v] of Object.entries(RES.t)) {
  const h = HEAD?.t?.[k];
  out(`${v.ctx && (v.ctx.cand || (v.ctx.dest && !/台北|臺北|台南|臺南/.test(v.ctx.dest))) ? "SWITCH" : "NOSWITCH"} t|${k} cls=${v.cls} W=${j(v.ctx)}${h ? ` H=${j(h.ctx)}` : ""}`);
}
if (fetchCalls) fail("no network", `fetch=${fetchCalls}`);
out(failures.length ? `FAIL ${failures.length} check(s)` : "PASS all");
process.exit(failures.length ? 1 : 0);
