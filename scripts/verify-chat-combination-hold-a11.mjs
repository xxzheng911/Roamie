/**
 * A11 (tester) — combination_choice「選組合階段句型判斷」第 6 輪結構性規則：正式斷言 + 對抗式抽樣。
 *
 * A12 (round 7): flag = isCombinationHoldReply; replan reset skipped on the flag; select:N = combination
 * number + day → [N] + confirm question; e2e (a)-(d) confirm / all-word / 「1」/ other topic; static L9641-9647.
 *
 * Pipeline per turn mirrors send() in _app.chat.tsx (L10846-10859, L11333-11335, L11595):
 *   flag = isCombinationChoiceTurn && (isCombinationPartialModifyReply || isCombinationHoldReply)
 *   flag ? session : applyTripIntentToSession → prepareSessionForUserTurn
 *   → (isReplanIntent && !flag → resetChatPlanningForReplan) → mergeTravelContext
 *   → processAdviceTurn → applyAdviceResultToSession → bindSelectionOwner.
 * HEAD: same file re-run inside the HEAD snapshot with --head-probe (no detector; HEAD send()).
 * fetch is stubbed and must stay 0; Places search is a mock.
 *
 * Expectation kinds:
 *   follow:N   hold; reply = combinationPartialModifyDay {day:N} (N=0 → combinationPartialModify)
 *   nudge      hold; reply = combinationSelectionNudge(Short)
 *   select:N   combination number + day → selected [N], days 4, no generation, confirmCombinationTitles,
 *              reply = combinationRefDayConfirm
 *   days:N     1c trip-length sentence → days N, selected [], no generation, pending kept, nudge
 *   probe      unrecognised day wording: recorded with HEAD; FAIL [UNSAFE] if it selects / changes days / generates
 *   head       zh no-day sentence: state + reply byte-equal to HEAD
 * Mismatch classes in the output: [UNSAFE] (select / days / generation) vs [IMPRECISE] (held, wrong copy).
 *
 * Run: npx vite-node scripts/verify-chat-combination-hold-a11.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const HEAD_PROBE = argv.includes("--head-probe");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => {
  out("FAIL watchdog: run exceeded time limit");
  process.exit(3);
}, HEAD_PROBE ? 280_000 : 560_000).unref();

let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const sessionMod = await load("src/lib/chat-session.ts");
const travelContext = await load("src/lib/ai/travel-context.ts");
const stateMachine = await load("src/lib/ai/chat-state-machine.ts");
const advice = await load("src/lib/ai/destination-advice.ts");
const globalPlanning = await load("src/lib/ai/global-planning-context.ts");
const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
const poolCache = await load("src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
const convState = await load("src/lib/ai/chat-conversation-state.ts");
const numericAuth = await load("src/lib/ai/numeric-selection-authority.ts");
const planningState = await load("src/lib/ai/chat-planning-state.ts");
const partialApi = HEAD_PROBE ? null : await load("src/lib/ai/combination-partial-modify-reply.ts");

const LOCALES = ["zh-TW", "en", "ja", "ko"];

async function offeredSession(locale) {
  discovery.clearDiscoveredCombinationsCache();
  poolCache.clearCandidatePoolCache();
  const turn = (t, s) => {
    const m = travelContext.mergeTravelContext(s, t);
    return stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
  };
  const persist = (r) =>
    advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply }, r.advice);
  let r = turn("12月に日本へ旅行に行きたいです。", sessionMod.createEmptySession());
  let s = { ...r.session, pendingQuestion: r.route?.pendingQuestion };
  s = travelContext.mergeTravelContext(s, "京都").session;
  s = await globalPlanning.resolveGlobalPlanningCandidate(s, locale, async () => ({
    rawResultCount: 1,
    location: { placeId: "ChIJKyotoA11", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJA11Place${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoA11", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => ({ places: pool, error: null }),
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  s = numericAuth.bindSelectionOwner({ ...s, workspaceId: "ws-a11", conversationId: "cv-a11" });
  return s;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const choice = partialApi ? partialApi.isCombinationChoiceTurn(s) : false;
  const partial = choice && partialApi.isCombinationPartialModifyReply(t);
  const dayNegated = choice && partialApi.isDayOrdinalNegatedModifyReply(t);
  const comboRefDay = choice && partialApi.isCombinationRefWithDayReply(t);
  // send() L10846-10848: combinationPartialModifyTurn = partial || isCombinationHoldReply.
  const flag = choice && (partial || partialApi.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  // send() L11333-11335: replan reset runs before `merged`, skipped when the hold flag is set.
  const replan = planningState.isReplanIntent(t);
  if (replan && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  const r = stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
  let next = advice.applyAdviceResultToSession(
    { ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply },
    r.advice,
  );
  next = numericAuth.bindSelectionOwner(next);
  return { r, s: next, partial, dayNegated, comboRefDay, flag, replan };
}

function state({ r, s }) {
  return {
    selected: s.travelContext?.selectedCombinationIds ?? [],
    days: s.travelContext?.days ?? null,
    tripDays: s.tripDays ?? null,
    trigger: Boolean(r.advice.triggerItineraryGeneration),
    placeRecs: Boolean(r.advice.triggerPlaceRecommendations),
    pending: s.pendingQuestion?.type ?? null,
    destination: s.travelContext?.destination ?? null,
    reply: r.advice.reply ?? null,
  };
}

// ------------------------------------------------------------------ corpus
// [text, expectation, tag]. "F" tag = formal assertion from the task sheet.
const CORPUS = {
  "zh-TW": [
    ["第二天不用改，但第三天換一下", "follow:3", "F mixed"],
    ["第一天幾點出發？", "follow:1", "F question"],
    ["第2組的第一天改一下", "select:2", "F combo-ref"],
    ["第二天改成5天", "days:5", "F 1c"],
    ["第二天想動一下", "follow:2", "verb 動一下"],
    ["第二天重新安排", "follow:2", "verb 重新安排 (replan word)"],
    ["第二天重排", "follow:2", "verb 重排 (replan word)"],
    ["第三天重來", "follow:3", "verb 重來 (replan word)"],
    ["第二天重新規劃", "follow:2", "verb 重新規劃 (replan word)"],
    ["第2天換掉", "follow:2", "verb 換掉"],
    ["第二日改一下", "follow:2", "form 第二日"],
    ["第２天改一下", "follow:2", "form fullwidth"],
    ["第二天替換成其他景點", "follow:2", "verb 替換"],
    ["第二天換成別的", "follow:2", "別的 is not negation"],
    ["預算2萬，第二天改一下", "follow:2", "number elsewhere"],
    ["第二天改一下，但第三天不用改", "nudge", "contrast last negated"],
    ["第二天換一下，但第三天不用，可是第四天要改", "follow:4", "multi contrast"],
    ["第二天不要換，不過第三天可以換，但第四天別動", "nudge", "multi contrast negated"],
    ["第二天不改了，第三天也不用", "nudge", "neg no contrast"],
    ["第二天先不換", "nudge", "neg 先不"],
    ["第二天別換成金閣寺", "nudge", "neg 別換成"],
    ["都不錯，不過第3天想換個地方", "follow:3", "agree + day"],
    ["第三天可以晚一點出發嗎", "follow:3", "question"],
    ["第一天跟第二天對調", "follow:1", "two days"],
    ["第二到第三天改一下", "follow:3", "range 第二到第三天"],
    ["第二、三天改一下", "probe", "form 第二、三天 (unrecognised)"],
    ["第2-3天換一下", "probe", "form 第2-3天 (unrecognised)"],
    ["最後一天改一下", "probe", "form 最後一天 (unrecognised)"],
    ["頭一天換一下", "probe", "form 頭一天 (unrecognised)"],
    ["day 2改一下", "follow:2", "en ordinal in zh"],
    ["都不錯，但不用改", "head", "no-day neg"],
    // M11 (approved spec): a destination switch while choosing combinations keeps dates / days;
    // pending is combination_choice or ask_preference (this harness runs no discovery).
    ["可以但改去大阪", "switch:大阪", "no-day destination"],
    ["都不錯但預算改成3萬", "head", "no-day budget"],
    ["我只有一天，可以改嗎", "head", "only one day"],
    ["某一天想去大阪", "head", "vague no verb (rule 4)"],
  ],
  en: [
    ["day 2 is fine, no need to change, but change day 3", "follow:3", "F mixed"],
    ["what time on day 1?", "follow:1", "F question"],
    ["option 2, but change day 1", "select:2", "F combo-ref"],
    ["change day 2 to 5 days", "days:5", "F 1c"],
    ["rework day 2", "follow:2", "verb rework"],
    ["replace day 2", "follow:2", "verb replace"],
    ["edit day 2", "follow:2", "verb edit"],
    ["modify day 2", "follow:2", "verb modify"],
    ["the second day needs a change", "follow:2", "form second day"],
    ["the third day, modify please", "follow:3", "form third day"],
    ["Day 2 looks good but day 3 could use a change", "follow:3", "contrast"],
    ["change day 2 but don't change day 3", "nudge", "contrast last negated"],
    ["day 2 stays, but day 3 must change, but not day 4", "nudge", "multi contrast, 'not' negation"],
    ["don't touch day 2", "nudge", "neg don't"],
    ["day 2 is perfect, leave it", "nudge", "neg leave"],
    ["never change day 2", "nudge", "neg never"],
    ["keep day 2 as is", "follow:2", "keep (not grammatical negation)"],
    ["budget 20000, change day 2", "follow:2", "number elsewhere"],
    ["Day 1 is too packed", "follow:1", "no verb"],
    ["day 3 can we start later?", "follow:3", "question"],
    ["day 2 change it, budget is $500", "follow:2", "number elsewhere 2"],
    ["2nd day, change it", "probe", "form 2nd day (unrecognised)"],
    ["day two, change it", "probe", "form day two (unrecognised)"],
    ["on the 2nd day, swap something", "probe", "form 2nd day (unrecognised)"],
    ["change days 2 and 3", "probe", "form days 2 and 3"],
    ["change the last day", "probe", "form last day"],
  ],
  ja: [
    ["2日目は変えなくていい、でも3日目は変えて", "follow:3", "F mixed"],
    ["1日目は何時出発？", "follow:1", "F question"],
    ["2番の1日目を変えて", "select:2", "F combo-ref"],
    ["2日目を5日間に変えて", "days:5", "F 1c"],
    ["2日目を変えたい", "follow:2", "verb 変えたい"],
    ["2日目を変えてほしい", "follow:2", "verb 変えてほしい"],
    ["2日目をかえる", "follow:2", "verb かえる"],
    ["2日目を替える", "follow:2", "verb 替える"],
    ["2日目を変更して", "follow:2", "verb 変更"],
    ["第二日を変えたい", "follow:2", "form 第二日"],
    ["2日目はいいけど3日目を変えて", "follow:3", "contrast"],
    ["2日目を変えて、でも3日目は変えないで", "nudge", "contrast last negated"],
    ["1日目は良い。けど3日目は変更したい。でも4日目は変えないで", "nudge", "multi contrast"],
    ["2日目は変えない", "nudge", "neg ない"],
    ["2日目は変えなくて大丈夫", "nudge", "neg なくて"],
    ["2日目はそのままで", "follow:2", "keep (not grammatical negation)"],
    ["予算2万円、2日目を変えたい", "follow:2", "number elsewhere"],
    ["3日目は雨かな", "follow:3", "no verb"],
    ["2日目と3日目を入れ替えて", "follow:2", "two days"],
    ["二日目を変えたい", "probe", "form 二日目 (unrecognised)"],
    ["最終日を変えたい", "probe", "form 最終日"],
    ["初日を変えたい", "probe", "form 初日"],
  ],
  ko: [
    ["2일차는 안 바꿔도 돼, 근데 3일차는 바꿔줘", "follow:3", "F mixed"],
    ["1일차 몇 시 출발?", "follow:1", "F question"],
    ["2번 조합의 1일차를 바꿔", "select:2", "F combo-ref"],
    ["2일차를 5일로 바꿔", "days:5", "F 1c"],
    ["2일차 바꿀래", "follow:2", "verb 바꿀"],
    ["2일차는 바꿨으면 좋겠어", "follow:2", "verb 바꿨"],
    ["2일차 바꿔요", "follow:2", "verb 바꿔요"],
    ["2일차 변경해 주세요", "follow:2", "verb 변경"],
    ["2일째 바꿔", "follow:2", "form 2일째"],
    ["2일차는 괜찮아, 하지만 3일차는 바꿔", "follow:3", "contrast"],
    ["2일차 바꿔, 근데 3일차는 바꾸지 마", "nudge", "contrast last negated"],
    ["2일차 바꿔, 근데 3일차는 괜찮아, 하지만 4일차는 바꾸지 마", "nudge", "multi contrast"],
    ["2일차는 바꾸지 마", "nudge", "neg 지 마"],
    ["2일차는 안 바꿔도 돼", "nudge", "neg 안"],
    ["2일차는 바꿀 필요 없어", "nudge", "neg 필요 없"],
    ["2일차는 그대로 둬", "follow:2", "keep (not grammatical negation)"],
    ["예산 2만원, 2일차 바꿔", "follow:2", "number elsewhere"],
    ["3일차 날씨 어때?", "follow:3", "no verb"],
    ["2일차랑 3일차 바꿔", "follow:2", "two days"],
    ["이틀째 바꿔", "probe", "form 이틀째 (unrecognised)"],
    ["둘째 날 바꿔", "probe", "form 둘째 날 (unrecognised)"],
    ["두 번째 날 바꿔", "probe", "form 두 번째 날"],
    ["2번째 날 바꿔", "probe", "form 2번째 날"],
    ["마지막 날 바꿔", "probe", "form 마지막 날"],
    ["첫째 날 바꿔", "probe", "form 첫째 날"],
  ],
};

if (HEAD_PROBE) {
  const res = {};
  for (const locale of LOCALES) {
    const s = await offeredSession(locale);
    res[locale] = {};
    for (const [t] of CORPUS[locale]) res[locale][t] = state(sendTurn(s, t, locale));
  }
  out("@@HEAD_JSON@@" + JSON.stringify({ res, fetchCalls }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ main
const failures = [];
const LOG = [];
async function check(name, fn) {
  try {
    await fn();
    out(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
  }
}

const { chatRuntimeCopy } = await load("src/lib/chat-runtime-copy.ts");

function headResults() {
  const dir = headDirArg;
  assert.ok(dir && existsSync(join(dir, "src")), "pass -- --head-dir=<snapshot>");
  assert.ok(!existsSync(join(dir, "src/lib/ai/combination-partial-modify-reply.ts")), "snapshot must be HEAD source");
  const self = "scripts/verify-chat-combination-hold-a11.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--head-probe"],
    { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@HEAD_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stdout ?? "").slice(-800)} ${(r.stderr ?? "").slice(-1500)}`);
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.fetchCalls, 0, "HEAD child fetch calls");
  return parsed.res;
}
let HEAD = null;
await check("HEAD snapshot probe ran", () => { HEAD = headResults(); });

const pickState = (x) => x && ({ selected: x.selected, days: x.days, tripDays: x.tripDays, trigger: x.trigger, pending: x.pending, destination: x.destination });
const short = (s) => JSON.stringify((s ?? "").slice(0, 70));
const unsafeOf = (st, base) => {
  const bad = [];
  if (st.selected.length) bad.push(`selected ${JSON.stringify(st.selected)}`);
  if (st.days !== 4) bad.push(`days ${st.days}`);
  if ((st.tripDays ?? null) !== (base.tripDays ?? null)) bad.push(`tripDays ${st.tripDays}`);
  if (st.trigger) bad.push("generation");
  if (st.placeRecs) bad.push("place recs");
  return bad;
};

for (const locale of LOCALES) {
  const s = await offeredSession(locale);
  const nudges = new Set([chatRuntimeCopy("combinationSelectionNudge", locale), chatRuntimeCopy("combinationSelectionNudgeShort", locale)]);
  const followCopy = (day) => (day ? chatRuntimeCopy("combinationPartialModifyDay", locale, { day }) : chatRuntimeCopy("combinationPartialModify", locale));
  const followCopies = new Set([followCopy(0), ...Array.from({ length: 10 }, (_, i) => followCopy(i + 1))]);
  const replyKind = (reply) => {
    if (nudges.has(reply)) return "nudge";
    for (let d = 0; d <= 10; d += 1) if (reply === followCopy(d)) return `follow:${d}`;
    return "other";
  };

  await check(`${locale}: fixture combination_choice, days 4`, () => {
    assert.equal(s.pendingQuestion?.type, "combination_choice");
    assert.equal(s.travelContext?.days, 4);
    assert.ok((s.travelContext?.offeredCombinations ?? []).length >= 2);
  });

  for (const [t, expect, tag] of CORPUS[locale]) {
    const turn = sendTurn(s, t, locale);
    const st = state(turn);
    const h = HEAD?.[locale]?.[t];
    const same = JSON.stringify(pickState(st)) === JSON.stringify(pickState(h)) && st.reply === h?.reply;
    const unsafe = unsafeOf(st, s);
    const headUnsafe = h ? unsafeOf({ placeRecs: false, ...h }, s) : ["no HEAD"];
    LOG.push(`[${locale}] (${tag}) "${t}" expect=${expect} hold=${turn.flag} kind=${replyKind(st.reply)} NOW=${JSON.stringify(pickState(st))} reply=${short(st.reply)}\n        HEAD=${JSON.stringify(pickState(h))} reply=${short(h?.reply)}${same ? " (=HEAD)" : " (DIFFERS)"} HEAD-unsafe=${JSON.stringify(headUnsafe)}`);
    const [kind, numRaw] = expect.split(":");
    const num = Number(numRaw);

    await check(`${locale}: ${expect} "${t}" (${tag})`, () => {
      if (kind === "follow" || kind === "nudge") {
        assert.equal(turn.flag, true, `[UNSAFE?] not held → ${JSON.stringify(pickState(st))} reply=${short(st.reply)}`);
        assert.deepEqual(unsafe, [], `[UNSAFE] held but ${unsafe.join(", ")}${turn.replan ? " (isReplanIntent reset at L11331)" : ""}`);
        assert.equal(st.pending, "combination_choice", `[UNSAFE] pending ${st.pending} — combination list dropped${turn.replan ? " (isReplanIntent reset at L11331)" : ""}`);
        // Round 7: a replan word inside a held day sentence must not reset (L11333-11335).
        if (turn.replan) assert.equal(turn.flag, true, "isReplanIntent reset not skipped");
        const want = kind === "nudge" ? "nudge" : `follow:${num}`;
        assert.equal(replyKind(st.reply), want, `[IMPRECISE] reply ${replyKind(st.reply)} ${short(st.reply)}`);
        // The pending stays usable: 「2」 still selects next turn.
        const next = state(sendTurn(turn.s, "2", locale));
        assert.deepEqual(next.selected, [2], `「2」 after hold → ${JSON.stringify(next.selected)}`);
        assert.equal(next.days, 4);
      } else if (kind === "select") {
        // A7 round 7 (rule 2): combination number + day → only [N], days unchanged, no generation,
        // pending kept with confirmCombinationTitles, reply = combinationRefDayConfirm.
        assert.equal(turn.comboRefDay, true, "isCombinationRefWithDayReply");
        assert.equal(turn.flag, true, "send() hold flag (isCombinationHoldReply) not set");
        assert.deepEqual(st.selected, [num], `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
        assert.equal(st.days, 4, `[UNSAFE] days ${st.days}`);
        assert.equal(st.tripDays ?? null, s.tripDays ?? null, `[UNSAFE] tripDays ${st.tripDays}`);
        assert.equal(st.trigger, false, "[UNSAFE] generation started");
        assert.equal(st.placeRecs, false, "[UNSAFE] place recs");
        assert.equal(st.pending, "combination_choice", `[UNSAFE] pending ${st.pending}`);
        const titles = turn.s.pendingQuestion?.confirmCombinationTitles ?? [];
        assert.equal(titles.length, 1, `confirmCombinationTitles ${JSON.stringify(titles)}`);
        const offered = s.travelContext.offeredCombinations ?? [];
        const offeredN = offered.find((c) => Number(c.id ?? c.index) === num) ?? offered[num - 1];
        if (offeredN?.title) assert.equal(titles[0], offeredN.title, "confirm title is combination N");
        const day = partialApi.parseDayOrdinalFromText(t);
        assert.equal(day, 1, `day ordinal parsed ${day}`);
        assert.equal(st.reply, chatRuntimeCopy("combinationRefDayConfirm", locale, { combo: String(num), day }), `[IMPRECISE] reply ${short(st.reply)}`);
      } else if (kind === "days") {
        assert.equal(turn.flag, false, "held despite trip-length wording (1c)");
        assert.equal(partialApi.isTripLengthOnlyCombinationReply(t), true, "1c detector");
        assert.deepEqual(st.selected, [], `selected ${JSON.stringify(st.selected)}`);
        assert.equal(st.days, num, `days ${st.days}`);
        assert.equal(st.trigger, false, "generation");
        assert.equal(st.pending, "combination_choice", `pending ${st.pending}`);
        assert.ok(nudges.has(st.reply), `reply not nudge ${short(st.reply)}`);
      } else if (kind === "probe") {
        assert.ok(!followCopies.has(st.reply) || turn.flag, "follow-up copy without hold");
        assert.deepEqual(unsafe, [], `[UNSAFE] unrecognised day wording reaches HEAD flow → ${unsafe.join(", ")} (HEAD: ${JSON.stringify(headUnsafe)})`);
      } else if (kind === "switch") {
        // M11 approved spec: combination-choice destination switch keeps days, never held / selected / generated.
        assert.equal(turn.flag, false, "held a destination switch");
        assert.equal(st.destination, numRaw, `destination ${st.destination}`);
        assert.deepEqual(st.selected, [], `selected ${JSON.stringify(st.selected)}`);
        assert.equal(st.days, s.travelContext.days, `days not kept: ${st.days}`);
        assert.equal(st.tripDays ?? null, s.tripDays ?? null, `tripDays not kept: ${st.tripDays}`);
        assert.equal(turn.s.travelContext?.startDate ?? null, s.travelContext?.startDate ?? null, "startDate not kept");
        assert.equal(turn.s.travelContext?.endDate ?? null, s.travelContext?.endDate ?? null, "endDate not kept");
        assert.equal(st.trigger, false, "generation started");
        assert.equal(st.placeRecs, false, "place recs");
        assert.ok(["combination_choice", "ask_preference"].includes(st.pending), `pending ${st.pending}`);
        assert.ok(!/京都/.test(JSON.stringify(turn.s.travelContext?.offeredCombinations ?? [])), "old destination combinations kept");
      } else if (kind === "head") {
        assert.equal(turn.flag, false, "held a no-day sentence");
        assert.deepEqual(pickState(st), pickState(h), "state vs HEAD");
        if (locale === "zh-TW") assert.equal(st.reply, h?.reply ?? null, "zh reply vs HEAD (byte-equal)");
      }
    });
  }
}

// ------------------------------------------------------------------ e2e (A12): combination + day → confirm
const REF_TEXT = { "zh-TW": "第2組的第一天改一下", en: "option 2, but change day 1", ja: "2番の1日目を変えて", ko: "2번 조합의 1일차를 바꿔" };
// 「幫我生成」is the routing payload of the “Create it for me” chip in every locale (onChipSend(label)).
const CONFIRM_TEXTS = {
  "zh-TW": ["幫我生成"],
  en: ["幫我生成", "create it for me", "Create it for me"],
  ja: ["幫我生成", "この内容で作成して"],
  ko: ["幫我生成", "이대로 만들어 주세요"],
};
const OTHER_TOPIC = { "zh-TW": "京都冬天會很冷嗎？", en: "Is Kyoto cold in winter?", ja: "京都の冬は寒いですか？", ko: "교토 겨울은 추워요?" };
const HOLD_TOPIC = { "zh-TW": "第三天改一下", en: "change day 3", ja: "3日目を変えて", ko: "3일차 바꿔" };
const ALL_TEXT = { "zh-TW": "全部", en: "all", ja: "すべて", ko: "전부" };
const e2eState = (turn) => ({ ...pickState(state(turn)), confirm: turn.s.pendingQuestion?.confirmCombinationTitles ?? null });

for (const locale of LOCALES) {
  const s = await offeredSession(locale);
  const offeredIds = (s.travelContext?.offeredCombinations ?? []).map((_, i) => i + 1);
  const ref = sendTurn(s, REF_TEXT[locale], locale);
  const direct = (t) => e2eState(sendTurn(s, t, locale));
  const after = (t, base = ref.s) => sendTurn(base, t, locale);

  await check(`${locale}: e2e ref+day turn → [2], days 4, no generation, confirm stored`, () => {
    const st = e2eState(ref);
    assert.deepEqual(st.selected, [2]);
    assert.equal(st.days, 4);
    assert.equal(st.trigger, false);
    assert.equal(st.pending, "combination_choice");
    assert.equal(st.confirm?.length, 1, `confirm ${JSON.stringify(st.confirm)}`);
  });

  for (const c of CONFIRM_TEXTS[locale]) {
    await check(`${locale}: e2e (a) confirm "${c}" → generate with [2], days 4`, () => {
      assert.equal(partialApi.isCombinationCreateConfirmReply(c), true, "confirm detector");
      const st = e2eState(after(c));
      const two = direct("2");
      assert.deepEqual(st.selected, [2], `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.days, 4, `[UNSAFE] days ${st.days}`);
      assert.equal(st.trigger, true, "no generation on confirm");
      assert.deepEqual({ ...st, confirm: null }, { ...two, confirm: null }, "confirm ≠ direct 「2」");
    });
  }

  await check(`${locale}: e2e (b) confirm question → "${ALL_TEXT[locale]}" → every combination (general flow)`, () => {
    const st = e2eState(after(ALL_TEXT[locale]));
    const base = direct(ALL_TEXT[locale]);
    assert.deepEqual(st.selected, offeredIds, `[UNSAFE] selected ${JSON.stringify(st.selected)} (offered ${JSON.stringify(offeredIds)})`);
    assert.equal(st.days, 4);
    assert.equal(st.confirm, null, "confirm not dropped");
    assert.deepEqual(st, base, "≠ direct all-word from the offered list");
  });

  await check(`${locale}: e2e (c) confirm question → "1" → [1]`, () => {
    const st = e2eState(after("1"));
    assert.deepEqual(st.selected, [1], `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
    assert.equal(st.days, 4);
    assert.equal(st.confirm, null, "confirm not dropped");
    assert.deepEqual(st, direct("1"), "≠ direct 「1」");
  });

  for (const [label, topic] of [["other topic", OTHER_TOPIC[locale]], ["held day sentence", HOLD_TOPIC[locale]]]) {
    await check(`${locale}: e2e (d) confirm question → ${label} → 「幫我生成」 → general flow, never [2] only`, () => {
      const mid = after(topic);
      assert.equal(mid.s.pendingQuestion?.confirmCombinationTitles ?? null, null, `[UNSAFE] confirm survives "${topic}"`);
      assert.equal(state(mid).trigger, false, `"${topic}" generated`);
      for (const c of CONFIRM_TEXTS[locale]) {
        const fin = after(c, mid.s);
        const st = e2eState(fin);
        const dir = direct(c);
        LOG.push(`[${locale}] e2e(d) ${label} "${topic}" → pending=${mid.s.pendingQuestion?.type ?? null} midSelected=${JSON.stringify(mid.s.travelContext?.selectedCombinationIds ?? [])} reply=${short(mid.r.advice.reply)}\n        → "${c}" ${JSON.stringify(st)} reply=${short(fin.r.advice.reply)}\n        direct "${c}" on offered list ${JSON.stringify(dir)}`);
        assert.ok(!(st.trigger && JSON.stringify(st.selected) === "[2]"), `[UNSAFE] "${c}" two turns later generated with [2] (direct on the offered list: ${JSON.stringify(dir)})`);
        assert.equal(mid.s.pendingQuestion?.type, "combination_choice", "pending dropped by the in-between turn");
        // General flow = the same text on the ref+day state without the confirm (selected [2] is the
        // user's own pick from the ref turn; only the confirm shortcut must be gone).
        const { confirmCombinationTitles: _c, ...plainPending } = ref.s.pendingQuestion;
        const gen = e2eState(after(c, { ...ref.s, pendingQuestion: plainPending }));
        assert.deepEqual(st.selected, gen.selected, `"${c}" → ${JSON.stringify(st.selected)} ≠ general flow ${JSON.stringify(gen.selected)}`);
        assert.equal(st.trigger, gen.trigger, `"${c}" generation ≠ general flow`);
        assert.equal(st.trigger, dir.trigger, `"${c}" generation ≠ same text on the offered list`);
        if (st.trigger) assert.deepEqual(st.selected, dir.selected, `"${c}" generated ${JSON.stringify(st.selected)} ≠ offered-list ${JSON.stringify(dir.selected)}`);
      }
    });
  }
}

await check("send() L9641-9647: 「幫我生成」selection-generate gate yields only to a pending combination confirm", () => {
  const src = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const at = src.indexOf("A verified destination switch turn (T138)");
  assert.ok(at > 0, "gate comment located");
  const gate = src.slice(at, src.indexOf("{", src.indexOf("/^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed)", at)));
  const conds = gate.slice(gate.indexOf("if (")).replace(/\/\/[^\n]*\n/g, "").replace(/\s+/g, " ").trim();
  assert.equal(
    conds,
    "if ( !turnSwitchVerified && isPlanningSelectionMode(sessionRef.current) && !(isCombinationChoiceTurn(sessionRef.current) && sessionRef.current.pendingQuestion?.confirmCombinationTitles?.length) && /^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed) )",
    "gate condition",
  );
  // Same gate in HEAD without the confirm clause: nothing else about it changed.
  if (headDirArg) {
    const head = readFileSync(join(headDirArg, "src/routes/_app.chat.tsx"), "utf8");
    const hAt = head.indexOf("A verified destination switch turn (T138)");
    const hGate = head.slice(hAt, head.indexOf("{", head.indexOf("/^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed)", hAt)));
    const hConds = hGate.slice(hGate.indexOf("if (")).replace(/\/\/[^\n]*\n/g, "").replace(/\s+/g, " ").trim();
    assert.equal(hConds, conds.replace(" !(isCombinationChoiceTurn(sessionRef.current) && sessionRef.current.pendingQuestion?.confirmCombinationTitles?.length) &&", ""), "HEAD gate differs beyond the confirm clause");
  }
  // The confirm is only answered by parsePendingOptionSelection, and dropped by any other merged turn.
  const pq = readFileSync("src/lib/ai/destination-pending-question.ts", "utf8");
  assert.match(pq, /pending\.confirmCombinationTitles\?\.length && isCombinationCreateConfirmReply\(t\)/);
  // A13 (round 8): the drop lives in dropStaleCombinationConfirm — keep only when the reply is a
  // confirm phrase or a short yes, right after that exact question, in the same nearby context.
  const tc = readFileSync("src/lib/ai/travel-context.ts", "utf8");
  const mtcAt = tc.indexOf("export function mergeTravelContext(");
  assert.ok(mtcAt > 0, "mergeTravelContext located");
  const mtcBody = tc.slice(tc.indexOf("\n", mtcAt) + 1, tc.indexOf("\n", mtcAt) + 600);
  assert.match(mtcBody, /^\s*(?:\/\/[^\n]*\n\s*)*session = dropStaleCombinationConfirm\(session, userText, lastAssistantReply \?\? session\.lastAssistantReply\);/, "mergeTravelContext opens with dropStaleCombinationConfirm");
  const cp = readFileSync("src/lib/ai/combination-partial-modify-reply.ts", "utf8");
  const dropFn = cp.slice(cp.indexOf("export function dropStaleCombinationConfirm"), cp.indexOf("/** Confirm question after"));
  assert.match(dropFn, /const answersConfirm = isCombinationCreateConfirmReply\(text\) \|\| isCombinationConfirmAffirmation\(text\);/, "affirmation check");
  assert.match(dropFn, /lastAssistantReply\.trim\(\) === pending\.confirmQuestion\.trim\(\)/, "confirm question text check");
  assert.match(dropFn, /pending\.confirmContextKey === combinationConfirmContextKey\(session\)/, "nearby context check");
  assert.match(dropFn, /if \(answersConfirm && questionMatches && contextMatches\) return session;/, "all three required");
  assert.match(dropFn, /confirmCombinationTitles: _titles, confirmQuestion: _question, confirmContextKey: _key, \.\.\.rest/, "drop clears all three fields");
  // send() call site: right after the generation lock, before any other branch.
  const lockAt = src.indexOf("if (isChatGenerationLocked()) return;", src.indexOf("const rawText = overrideText ?? text;"));
  const dropAt = src.indexOf("dropStaleCombinationConfirm(session, trimmed, lastAssistantForConfirm)");
  assert.ok(lockAt > 0 && dropAt > lockAt, "send() drop after the generation lock");
  const between = src.slice(lockAt + "if (isChatGenerationLocked()) return;".length, dropAt);
  assert.doesNotMatch(between, /\breturn\b|\bawait\b|setMsgs\(/, "nothing between the lock and the drop");
  assert.match(src.slice(dropAt, dropAt + 300), /if \(keptConfirm !== session\) \{\s*session = keptConfirm;\s*sessionRef\.current = keptConfirm;/, "send() drop applied to session + sessionRef");
  // Hold flag gates the replan reset.
  assert.match(src, /if \(isReplanIntent\(trimmed\)\) \{[\s\S]{0,200}if \(!combinationPartialModifyTurn\) nextSession = resetChatPlanningForReplan/);
});

await check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

out("\n================ LOG ================");
for (const l of LOG) out("  " + l);
out("=====================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS combination hold A11");
process.exit(0);
