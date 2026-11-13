/**
 * A13 (tester) — combination_choice 選組合階段句型判斷第 8 輪：確認句只在緊接的下一輪有效 + 肯定詞。
 *
 * Pipeline per turn mirrors send() in _app.chat.tsx:
 *   send() start (after the generation lock): dropStaleCombinationConfirm(session, text, last assistant msg)
 *   → flag = isCombinationChoiceTurn && (isCombinationPartialModifyReply || isCombinationHoldReply)
 *   → flag ? session : applyTripIntentToSession → prepareSessionForUserTurn
 *   → (isReplanIntent && !flag → reset) → mergeTravelContext (drops again) → processAdviceTurn
 *   → applyAdviceResultToSession → bindSelectionOwner.
 * HEAD: same file inside the HEAD snapshot with --head-probe (no detector, no drop).
 *
 * Sections
 *   S1  affirmation safety (a) no confirm question → HEAD parity; (a') stale confirm, other last reply
 *       (b) nearby in between; (c) yes + modify; (d) partial yes; (e) negatives
 *   S2  every listed affirmation right after the confirm question → [2], days 4
 *   S3  combinationMissingPrefix (4 locales)
 *   S4  「別の」「別に」are not negation (+ the other-place forms in en / ko)
 *   S5  clause split: , ; . ! ? split, 、does not; day-less clause joins the previous day clause
 * [UNSAFE] = generation / wrong combination / trip length; [IMPRECISE] = safe, copy off.
 *
 * Run: npx vite-node scripts/verify-chat-combination-hold-a13.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
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
const nearby = await load("src/lib/ai/nearby-location-clarification.ts");
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
    location: { placeId: "ChIJKyotoA13", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJA13Place${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoA13", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => ({ places: pool, error: null }),
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  s = numericAuth.bindSelectionOwner({ ...s, workspaceId: "ws-a13", conversationId: "cv-a13" });
  return s;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** One send(); `lastMsg` = last assistant chat message (defaults to session.lastAssistantReply). */
function sendTurn(s0, t, locale, lastMsg) {
  let s = clone(s0);
  const lastReply = lastMsg === undefined ? s.lastAssistantReply : lastMsg;
  if (partialApi) s = partialApi.dropStaleCombinationConfirm(s, t, lastReply); // send() L8747
  const choice = partialApi ? partialApi.isCombinationChoiceTurn(s) : false;
  const flag = choice && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  const replan = planningState.isReplanIntent(t);
  if (replan && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  const r = stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
  let next = advice.applyAdviceResultToSession(
    { ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply },
    r.advice,
  );
  next = numericAuth.bindSelectionOwner(next);
  return { r, s: next, flag, replan };
}

function state({ r, s }) {
  return {
    selected: s.travelContext?.selectedCombinationIds ?? [],
    days: s.travelContext?.days ?? null,
    tripDays: s.tripDays ?? null,
    trigger: Boolean(r.advice.triggerItineraryGeneration),
    placeRecs: Boolean(r.advice.triggerPlaceRecommendations),
    pending: s.pendingQuestion?.type ?? null,
    confirm: s.pendingQuestion?.confirmCombinationTitles ?? null,
    destination: s.travelContext?.destination ?? null,
    reply: r.advice.reply ?? null,
  };
}

// ------------------------------------------------------------------ corpus
// S1a: on the plain combination list (no confirm question) → state (+ zh reply) == HEAD.
const NO_CONFIRM = {
  "zh-TW": ["好", "好啊", "好的", "可以", "行", "沒問題"],
  en: ["ok", "okay", "yes", "yes please", "sure", "sounds good"],
  ja: ["はい", "お願いします", "それで", "いいです"],
  ko: ["네", "좋아요", "그래요", "응"],
};
// S1c: yes + modify → no generation; held (follow-up / confirm) and combination_choice kept.
const YES_MODIFY = {
  "zh-TW": ["好，但第二天改一下", "好，第二天改一下", "可以，不過第三天換一下", "好的但是改一下", "沒問題，但改成5天"],
  en: ["ok but change day 2", "ok, change day 2", "yes, but swap day 3", "sure but change the last day", "ok but make it 5 days"],
  ja: ["はい、でも2日目を変えて", "はい。2日目を変えて", "お願いします、でも最終日を変えて", "いいです、けど5日間に変えて"],
  ko: ["네, 근데 2일차 바꿔줘", "네. 2일차 바꿔줘", "좋아요, 하지만 마지막 날 바꿔", "응 근데 5일로 바꿔"],
};
// S1d: only partly like a yes → no generation.
const PARTIAL_YES = {
  "zh-TW": ["好像不太對", "可以嗎？", "好嗎", "好，我再想想", "可以再看看嗎", "好啦好啦等一下", "行不行"],
  en: ["ok?", "okay...?", "yes?", "sure? not really", "ok let me think", "sounds good but wait"],
  ja: ["はいはい、ちょっと待って", "はい？", "それでいいの？", "いいですか", "お願いしますか"],
  ko: ["네? 뭐라고요", "응?", "좋아요?", "그래요? 잠깐만", "네네 잠깐만요"],
};
// S1e: negatives → no generation.
const NEGATIVE = {
  "zh-TW": ["不好", "不可以", "不行", "不要", "好不要", "沒問題嗎"],
  en: ["not ok", "no", "nope", "not okay", "no thanks"],
  ja: ["いいえ", "いいえ、結構です", "それではない", "だめです"],
  ko: ["아니요", "아니", "싫어요", "안 좋아요"],
};
// S2: every whole-sentence affirmation from the ruling (+ trailing punctuation).
const AFFIRM = {
  "zh-TW": ["好", "好啊", "好的", "可以", "行", "沒問題", "好！", "好的。"],
  en: ["ok", "okay", "yes", "yes please", "sure", "sounds good", "OK", "Yes please!", "sure."],
  ja: ["はい", "お願いします", "それで", "いいです", "はい。", "お願いします！"],
  ko: ["네", "좋아요", "그래요", "응", "네!", "좋아요."],
};
const NEARBY = { "zh-TW": "附近有什麼咖啡廳", en: "cafes nearby", ja: "近くのカフェを探して", ko: "근처 카페 추천해줘" };
const CONFIRM = { "zh-TW": "幫我生成", en: "create it for me", ja: "この内容で作成して", ko: "이대로 만들어 주세요" };
const REF = { "zh-TW": "第2組的第一天改一下", en: "option 2, but change day 1", ja: "2番の1日目を変えて", ko: "2번 조합의 1일차를 바꿔" };
// S3: one offered + one missing combination, and only missing.
const MISSING = {
  "zh-TW": [["第1組和第3組，第二天改一下", [1], "3", 2], ["第2組跟第5組的第三天換一下", [2], "5", 3]],
  en: [["options 1 and 3, change day 2", [1], "3", 2], ["option 2 and option 5, swap day 3", [2], "5", 3]],
  ja: [["1番と3番で、2日目を変えて", [1], "3", 2], ["2番と5番の3日目を変えて", [2], "5", 3]],
  ko: [["1번이랑 3번 조합, 2일차 바꿔줘", [1], "3", 2], ["2번과 5번 조합의 3일차 바꿔", [2], "5", 3]],
};
const ONLY_MISSING = { "zh-TW": "第3組的第二天改一下", en: "option 3, change day 2", ja: "3番の2日目を変えて", ko: "3번 조합의 2일차 바꿔" };
// S4: 別の / 別に (and other-place forms) are not negation; a real negation still is.
const BETSU = {
  "zh-TW": [["第二天換去別的地方", "follow:2"], ["第三天想去別處走走", "follow:3"], ["第二天別換", "nudge"]],
  en: [["day 2, somewhere else please", "follow:2"], ["day 3 別の場所がいい", "follow:3"], ["don't change day 2", "nudge"]],
  ja: [["2日目は別の場所にして", "follow:2"], ["4日目は別に行きたいところがある", "follow:4"], ["3日目を別のお寺に変えて", "follow:3"], ["2日目は変えないで", "nudge"]],
  ko: [["2일차는 다른 곳으로 바꿔", "follow:2"], ["3일차 別の場所로 바꿔", "follow:3"], ["2일차는 바꾸지 마", "nudge"]],
};
// S5: clause split.
const CLAUSES = {
  "zh-TW": [
    ["第二天換一下；第三天不用改", "nudge"],
    ["第二天不用改；第三天換一下", "follow:3"],
    ["第二天不用改！第三天換一下", "follow:3"],
    ["第二天不用改？第三天換一下", "follow:3"],
    ["第二天不用改。第三天換一下", "follow:3"],
    ["第二天不用改,第三天換一下", "follow:3"],
    ["第三天換一下，不用改", "nudge"],
    ["第三天換一下，謝謝", "follow:3"],
    ["第二、三天都不用改", "nudge"],
    ["第二、三天換一下", "follow:2"],
  ],
  en: [
    ["change day 2; leave day 3", "nudge"],
    ["don't change day 2; change day 3", "follow:3"],
    ["don't change day 2! change day 3", "follow:3"],
    ["day 2? don't change it", "nudge"],
    ["don't change day 2. change day 3", "follow:3"],
    ["change day 3, thanks", "follow:3"],
    ["change day 3, actually don't", "nudge"],
  ],
  ja: [
    ["2日目は変えないで。3日目を変えて", "follow:3"],
    ["2日目は変えないで！3日目を変えて", "follow:3"],
    ["2日目は変えないで？3日目を変えて", "follow:3"],
    ["3日目を変えて。やっぱり変えないで", "nudge"],
    ["3日目を変えて、お願いします", "follow:3"],
    ["2日目、3日目は変えないで", "nudge"],
  ],
  ko: [
    ["2일차는 바꾸지 마; 3일차 바꿔줘", "follow:3"],
    ["2일차는 바꾸지 마. 3일차 바꿔줘", "follow:3"],
    ["2일차는 바꾸지 마! 3일차 바꿔줘", "follow:3"],
    ["3일차 바꿔줘? 아니 바꾸지 마", "nudge"],
    ["3일차 바꿔줘, 부탁해요", "follow:3"],
  ],
};

if (HEAD_PROBE) {
  const res = {};
  for (const locale of LOCALES) {
    const s = await offeredSession(locale);
    res[locale] = {};
    for (const t of NO_CONFIRM[locale]) res[locale][t] = state(sendTurn(s, t, locale));
  }
  out("@@HEAD_JSON@@" + JSON.stringify({ res, fetchCalls }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ main
const failures = [];
const UNSAFE = [];
const IMPRECISE = [];
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
  const self = "scripts/verify-chat-combination-hold-a13.mjs";
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
const short = (s) => JSON.stringify((s ?? "").slice(0, 90));
const isTwoOnlyGen = (st) => st.trigger && JSON.stringify(st.selected) === "[2]";

for (const locale of LOCALES) {
  const s = await offeredSession(locale);
  const offeredIds = (s.travelContext?.offeredCombinations ?? []).map((_, i) => i + 1);
  const offeredTitles = (s.travelContext?.offeredCombinations ?? []).map((c) => c.title);
  const nudges = new Set([chatRuntimeCopy("combinationSelectionNudge", locale), chatRuntimeCopy("combinationSelectionNudgeShort", locale)]);
  const followCopy = (day) => (day ? chatRuntimeCopy("combinationPartialModifyDay", locale, { day }) : chatRuntimeCopy("combinationPartialModify", locale));
  const replyKind = (reply) => {
    if (nudges.has(reply)) return "nudge";
    for (let d = 0; d <= 10; d += 1) if (reply === followCopy(d)) return `follow:${d}`;
    return "other";
  };
  const ref = sendTurn(s, REF[locale], locale);
  const refSt = state(ref);
  const confirmQ = ref.s.pendingQuestion?.confirmQuestion;
  const { confirmCombinationTitles: _t, confirmQuestion: _q, confirmContextKey: _k, ...plainPending } = ref.s.pendingQuestion ?? {};
  const general = (t, last) => state(sendTurn({ ...ref.s, pendingQuestion: plainPending }, t, locale, last));

  await check(`${locale}: fixture — ≥2 offered, ref turn stores confirm + exact question + context key`, () => {
    assert.equal(s.pendingQuestion?.type, "combination_choice");
    assert.ok(offeredIds.length >= 2, `offered ${offeredIds}`);
    assert.ok(offeredIds.length < 3, `fixture assumes combination 3 is not offered (offered ${offeredIds})`);
    assert.deepEqual(refSt.selected, [2]);
    assert.equal(refSt.trigger, false);
    assert.equal(refSt.confirm?.length, 1);
    assert.equal(confirmQ, refSt.reply, "confirmQuestion = the reply shown");
    assert.equal(ref.s.lastAssistantReply, confirmQ);
    assert.equal(ref.s.pendingQuestion?.confirmContextKey, partialApi.combinationConfirmContextKey(ref.s));
  });

  // ---------------- S1a: no confirm question → HEAD parity
  for (const t of NO_CONFIRM[locale]) {
    const st = state(sendTurn(s, t, locale));
    const h = HEAD?.[locale]?.[t];
    LOG.push(`[${locale}] S1a "${t}" NOW=${JSON.stringify(pickState(st))} reply=${short(st.reply)} | HEAD=${JSON.stringify(pickState(h))} reply=${short(h?.reply)}`);
    await check(`${locale}: S1a no confirm question, "${t}" → == HEAD`, () => {
      assert.ok(h, "no HEAD result");
      assert.deepEqual(pickState(st), pickState(h), "[UNSAFE] state ≠ HEAD");
      if (locale === "zh-TW") assert.equal(st.reply, h.reply, "[UNSAFE] zh reply ≠ HEAD");
    });
  }

  // ---------------- S1a': confirm stored, but the last assistant message is not the confirm question
  for (const t of AFFIRM[locale].slice(0, 2)) {
    const other = chatRuntimeCopy("combinationSelectionNudge", locale);
    const st = state(sendTurn(ref.s, t, locale, other));
    const gen = general(t, other);
    LOG.push(`[${locale}] S1a' last≠confirm "${t}" NOW=${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} | general=${JSON.stringify(pickState(gen))}`);
    await check(`${locale}: S1a' last assistant msg ≠ confirm question, "${t}" → general flow, never [2]-only generation via confirm`, () => {
      assert.equal(st.confirm, null, "confirm not dropped");
      assert.deepEqual(pickState(st), pickState(gen), "≠ general flow");
      if (isTwoOnlyGen(st) && !isTwoOnlyGen(gen)) assert.fail("[UNSAFE] [2]-only generation");
    });
    // Same, but the drop only in mergeTravelContext (session.lastAssistantReply differs).
    const st2 = state(sendTurn({ ...ref.s, lastAssistantReply: other }, t, locale, null));
    await check(`${locale}: S1a' session.lastAssistantReply ≠ confirm question (mergeTravelContext fallback), "${t}" → confirm dropped`, () => {
      assert.equal(st2.confirm, null, "confirm not dropped");
      assert.ok(!isTwoOnlyGen(st2) || isTwoOnlyGen(general(t, other)), "[UNSAFE] [2]-only generation");
    });
  }

  // ---------------- S1b: confirm question → nearby → 「好」
  const near = nearby.resolveExplicitNearbyIntent(NEARBY[locale]);
  const nearbyReply = "NEARBY_RESULTS_PLACEHOLDER";
  // Real send(): the nearby turn itself goes through the send() drop first.
  const afterNearbyDrop = partialApi.dropStaleCombinationConfirm(clone(ref.s), NEARBY[locale], confirmQ);
  const routed = near
    ? { ...afterNearbyDrop, explicitNearbyKeyword: near.rawKeyword, canonicalNearbyKeyword: near.canonicalKeyword, nearbySemanticFamily: near.semanticFamily, activeChatIntent: near.intent, lastAssistantReply: nearbyReply }
    : sendTurn(ref.s, NEARBY[locale], locale).s;
  // Worst case: the nearby turn kept the confirm (no send() drop) and showed no assistant message.
  const routedKeep = near
    ? { ...clone(ref.s), explicitNearbyKeyword: near.rawKeyword, canonicalNearbyKeyword: near.canonicalKeyword, nearbySemanticFamily: near.semanticFamily, activeChatIntent: near.intent }
    : null;
  for (const t of AFFIRM[locale].slice(0, 2)) {
    await check(`${locale}: S1b confirm question → "${NEARBY[locale]}" → "${t}" → never [2]-only generation`, () => {
      assert.equal(routed.pendingQuestion?.confirmCombinationTitles ?? null, null, "[UNSAFE] confirm survives the nearby turn");
      const st = state(sendTurn(routed, t, locale));
      LOG.push(`[${locale}] S1b nearby(explicit=${Boolean(near)}) → "${t}" ${JSON.stringify(pickState(st))} reply=${short(st.reply)}`);
      assert.ok(!isTwoOnlyGen(st), `[UNSAFE] generated with [2] reply=${short(st.reply)}`);
      if (routedKeep) {
        const st2 = state(sendTurn(routedKeep, t, locale, confirmQ));
        LOG.push(`[${locale}] S1b worst case (confirm kept, last msg still the question, nearby keys set) → "${t}" ${JSON.stringify(pickState(st2))} confirm=${JSON.stringify(st2.confirm)}`);
        assert.equal(st2.confirm, null, "[UNSAFE] context key did not drop the confirm");
        assert.ok(!isTwoOnlyGen(st2) || isTwoOnlyGen(state(sendTurn({ ...routedKeep, pendingQuestion: plainPending }, t, locale, confirmQ))), "[UNSAFE] [2]-only generation via the confirm");
      }
    });
  }
  await check(`${locale}: S1b nearby sentence "${NEARBY[locale]}" itself drops the confirm in the send() pre-drop`, () => {
    assert.equal(afterNearbyDrop.pendingQuestion?.confirmCombinationTitles ?? null, null);
    assert.equal(afterNearbyDrop.pendingQuestion?.confirmQuestion ?? null, null);
    assert.equal(afterNearbyDrop.pendingQuestion?.confirmContextKey ?? null, null);
    assert.equal(afterNearbyDrop.pendingQuestion?.type, "combination_choice", "pending type kept");
  });

  // ---------------- S1c / S1d / S1e: after the confirm question
  for (const [section, list] of [["S1c yes+modify", YES_MODIFY], ["S1d partial yes", PARTIAL_YES], ["S1e negative", NEGATIVE]]) {
    for (const t of list[locale]) {
      const turn = sendTurn(ref.s, t, locale);
      const st = state(turn);
      const gen = general(t);
      LOG.push(`[${locale}] ${section} "${t}" hold=${turn.flag} kind=${replyKind(st.reply)} NOW=${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} reply=${short(st.reply)} | general=${JSON.stringify(pickState(gen))}`);
      await check(`${locale}: ${section} after confirm question "${t}" → no generation`, () => {
        assert.equal(partialApi.isCombinationConfirmAffirmation(t), false, "detector reads it as an affirmation");
        assert.equal(st.trigger, false, `[UNSAFE] generation selected=${JSON.stringify(st.selected)} reply=${short(st.reply)}`);
        assert.equal(st.placeRecs, false, "[UNSAFE] place recs");
        assert.equal(st.pending, "combination_choice", `[UNSAFE] pending ${st.pending}`);
        if (section.startsWith("S1c")) {
          // yes + modify: a follow-up / confirm / nudge, never a silent pass-through.
          const k = replyKind(st.reply);
          const isConfirmCopy = /\{|生成嗎|create the itinerary|作成しますか|만들까요/.test(st.reply ?? "");
          if (k === "other" && !isConfirmCopy) IMPRECISE.push(`[${locale}] ${section} "${t}" → reply not a follow-up/confirm: ${short(st.reply)}`);
          assert.ok(st.selected.every((id) => offeredIds.includes(id)), `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
        }
      });
    }
  }

  // ---------------- S2: every affirmation right after the confirm question → [2], days 4
  const viaConfirm = state(sendTurn(ref.s, CONFIRM[locale], locale));
  for (const t of AFFIRM[locale]) {
    const turn = sendTurn(ref.s, t, locale);
    const st = state(turn);
    LOG.push(`[${locale}] S2 "${t}" NOW=${JSON.stringify(pickState(st))} reply=${short(st.reply)}`);
    await check(`${locale}: S2 confirm question → "${t}" → generate with [2], days 4`, () => {
      assert.equal(partialApi.isCombinationConfirmAffirmation(t), true, "detector");
      assert.deepEqual(st.selected, [2], `selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.days, 4, `days ${st.days}`);
      assert.equal(st.trigger, true, `no generation reply=${short(st.reply)}`);
      assert.deepEqual(pickState(st), pickState(viaConfirm), `≠ "${CONFIRM[locale]}"`);
    });
  }
  // Second turn: the confirm does not survive a generation / a second yes on a stale state.
  await check(`${locale}: S2 confirm consumed — "${AFFIRM[locale][0]}" after an other-topic turn never uses [2]`, () => {
    const mid = sendTurn(ref.s, { "zh-TW": "京都冬天會很冷嗎？", en: "Is Kyoto cold in winter?", ja: "京都の冬は寒いですか？", ko: "교토 겨울은 추워요?" }[locale], locale);
    assert.equal(mid.s.pendingQuestion?.confirmCombinationTitles ?? null, null, "[UNSAFE] confirm survives other topic");
    const st = state(sendTurn(mid.s, AFFIRM[locale][0], locale));
    const gen = general(AFFIRM[locale][0], mid.s.lastAssistantReply);
    LOG.push(`[${locale}] S2 other topic → "${AFFIRM[locale][0]}" ${JSON.stringify(pickState(st))} | general=${JSON.stringify(pickState(gen))}`);
    assert.ok(!isTwoOnlyGen(st) || isTwoOnlyGen(gen), "[UNSAFE] [2]-only generation via a stale confirm");
  });

  // ---------------- S3: combinationMissingPrefix
  for (const [t, ids, missing, day] of MISSING[locale]) {
    const turn = sendTurn(s, t, locale);
    const st = state(turn);
    const sep = locale === "en" || locale === "ko" ? ", " : "、";
    const prefix = chatRuntimeCopy("combinationMissingPrefix", locale, { missing });
    const want = partialApi.combinationRefDayConfirmCopy(t, ids.join(sep), locale, missing);
    LOG.push(`[${locale}] S3 "${t}" NOW=${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} reply=${short(st.reply)}`);
    await check(`${locale}: S3 "${t}" → selected ${JSON.stringify(ids)}, no generation, reply starts with the missing prefix`, () => {
      assert.deepEqual(st.selected, ids, `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.days, 4, `[UNSAFE] days ${st.days}`);
      assert.equal(st.trigger, false, "[UNSAFE] generation");
      assert.equal(st.pending, "combination_choice");
      assert.equal(st.confirm?.length, ids.length, `confirm ${JSON.stringify(st.confirm)}`);
      assert.deepEqual(st.confirm, ids.map((i) => offeredTitles[i - 1]), "confirm titles = offered titles");
      assert.ok(st.reply?.startsWith(prefix), `[IMPRECISE] reply lacks prefix ${short(st.reply)}`);
      assert.equal(st.reply, want, `[IMPRECISE] reply ${short(st.reply)}`);
      assert.ok(st.reply.includes(String(day)), "day kept in copy");
      assert.equal(turn.s.pendingQuestion?.confirmQuestion, st.reply, "confirmQuestion = shown reply");
      if (locale === "zh-TW" && missing === "3") assert.equal(st.reply.slice(0, "沒有第 3 組，已選第 1 組。".length), "沒有第 3 組，已選第 1 組。", "zh literal");
      if (locale === "en" && missing === "3") assert.ok(st.reply.startsWith("There's no combination 3, so combination 1 is selected."), `en literal ${short(st.reply)}`);
      // Then a short yes → exactly the offered one(s).
      const yes = state(sendTurn(turn.s, AFFIRM[locale][0], locale));
      assert.deepEqual(yes.selected, ids, `[UNSAFE] yes → selected ${JSON.stringify(yes.selected)}`);
      assert.equal(yes.trigger, true, "yes did not generate");
      assert.equal(yes.days, 4);
    });
  }
  await check(`${locale}: S3 only a missing combination "${ONLY_MISSING[locale]}" → nothing non-offered, no generation`, () => {
    const turn = sendTurn(s, ONLY_MISSING[locale], locale);
    const st = state(turn);
    LOG.push(`[${locale}] S3 only-missing "${ONLY_MISSING[locale]}" ${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} reply=${short(st.reply)}`);
    assert.ok(st.selected.every((id) => offeredIds.includes(id)), `[UNSAFE] selected ${JSON.stringify(st.selected)}`);
    assert.equal(st.trigger, false, "[UNSAFE] generation");
    assert.equal(st.days, 4);
    assert.equal(st.pending, "combination_choice");
    const yes = state(sendTurn(turn.s, AFFIRM[locale][0], locale));
    assert.ok(!(yes.trigger && st.confirm == null && yes.selected.length === 1 && !st.selected.length), "[UNSAFE] yes picked a combination nobody confirmed");
  });

  // ---------------- S4 / S5: day-clause negation + clause split
  for (const [section, list] of [["S4 別", BETSU], ["S5 clause", CLAUSES]]) {
    for (const [t, expect] of list[locale]) {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const kind = replyKind(st.reply);
      LOG.push(`[${locale}] ${section} "${t}" expect=${expect} hold=${turn.flag} kind=${kind} NOW=${JSON.stringify(pickState(st))} reply=${short(st.reply)}`);
      const unsafe = [];
      if (st.trigger) unsafe.push("generation");
      if (st.selected.length) unsafe.push(`selected ${JSON.stringify(st.selected)}`);
      if (st.days !== 4) unsafe.push(`days ${st.days}`);
      if (st.pending !== "combination_choice") unsafe.push(`pending ${st.pending}`);
      if (unsafe.length) UNSAFE.push(`[${locale}] ${section} "${t}": ${unsafe.join(", ")}`);
      if (kind !== expect) IMPRECISE.push(`[${locale}] ${section} "${t}": reply ${kind} (want ${expect}) ${short(st.reply)}`);
      await check(`${locale}: ${section} "${t}" → ${expect}`, () => {
        assert.deepEqual(unsafe, [], `[UNSAFE] ${unsafe.join(", ")}`);
        assert.equal(turn.flag, true, "not held");
        assert.equal(kind, expect, `[IMPRECISE] reply ${kind} ${short(st.reply)}`);
      });
    }
  }
}

// ---------------- informational: ja uses 、 as its ordinary comma (spec: 、 never splits)
await check("S5 info: ja 「…変えないで、3日目を変えて」 with 、 (no split by spec) is held, never selects", () => {
  for (const t of ["2日目は変えないで、3日目を変えて", "初日はそのままで、2日目は変えないで"]) {
    const partial = partialApi.isCombinationPartialModifyReply(t);
    const neg = partialApi.isDayOrdinalNegatedModifyReply(t);
    LOG.push(`[ja] S5 info 、 "${t}" partial=${partial} negated=${neg} follow=${short(partialApi.combinationPartialModifyFollowUp(t, "ja"))}`);
    assert.ok(partial || neg, "not held");
    if (t.startsWith("2日目は変えないで") && neg) IMPRECISE.push(`[ja] "${t}" → nudge (user asked to change day 3; 、 is not a clause boundary by spec)`);
  }
});

// ---------------- detector unit checks (locale-independent)
await check("S2 detector: affirmation list is whole-sentence only", () => {
  const yes = ["好", "好啊", "好的", "可以", "行", "沒問題", "ok", "okay", "yes", "yes please", "sure", "sounds good", "はい", "お願いします", "それで", "いいです", "네", "좋아요", "그래요", "응"];
  for (const t of yes) assert.equal(partialApi.isCombinationConfirmAffirmation(t), true, t);
  const no = ["好像", "好嗎", "可以嗎？", "ok?", "okay?", "yes?", "sure?", "不好", "not ok", "いいえ", "아니요", "はいはい", "네?", "응?", "好好", "ok ok", "yes, but", "行程", "可以了嗎", "沒問題嗎", "それでは", "いいですか", "좋아요?"];
  for (const t of no) assert.equal(partialApi.isCombinationConfirmAffirmation(t), false, t);
});
await check("S4 detector: 別の / 別に not negation; 別 / 别 alone still negation", () => {
  assert.equal(partialApi.isCombinationPartialModifyReply("2日目は別の場所にして"), true);
  assert.equal(partialApi.isCombinationPartialModifyReply("4日目は別に行きたいところがある"), true);
  assert.equal(partialApi.isDayOrdinalNegatedModifyReply("第二天別換"), true);
  assert.equal(partialApi.isDayOrdinalNegatedModifyReply("第二天别动"), true);
});

// ---------------- static: send() drop runs before every branch / early return
await check("static: send() drop after the generation lock, before every later return / branch", () => {
  const src = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const start = src.indexOf("const rawText = overrideText ?? text;");
  assert.ok(start > 0, "send() located");
  const lockStmt = "if (isChatGenerationLocked()) return;";
  const lockAt = src.indexOf(lockStmt, start);
  const dropAt = src.indexOf("dropStaleCombinationConfirm(session, trimmed, lastAssistantForConfirm)", start);
  assert.ok(lockAt > start && dropAt > lockAt, "drop after the lock");
  const pre = src.slice(start, lockAt);
  // Only the busy / empty / lock returns come before (the turn is not sent at all).
  const preReturns = (pre.match(/\breturn\b/g) ?? []).length;
  assert.ok(preReturns <= 3, `returns before the lock: ${preReturns}`);
  assert.doesNotMatch(src.slice(lockAt + lockStmt.length, dropAt), /\breturn\b|\bawait\b/, "return/await between lock and drop");
  const lineOf = (i) => src.slice(0, i).split("\n").length;
  const dropLine = lineOf(dropAt);
  // Every listed early return of send() sits after the drop.
  for (const marker of ["requireAuthForAction(action", "isRepeatedTripDateConfirmation(session, trimmed)", "const combinationPartialModifyTurn =", "A verified destination switch turn (T138)", "let nextSession = explicitNearbyAuthority"]) {
    const at = src.indexOf(marker, start);
    assert.ok(at > dropAt, `${marker} (L${lineOf(at)}) before the drop (L${dropLine})`);
  }
  // The task's L10718 / L10753 / L10825 region returns.
  for (const line of [10718, 10738, 10750, 10753, 10825, 10831, 10848]) assert.ok(line > dropLine, `L${line} vs drop L${dropLine}`);
  // The drop's session is the one the later branches read (sessionForTurn derives from `session`).
  assert.match(src.slice(dropAt, dropAt + 300), /session = keptConfirm;\s*sessionRef\.current = keptConfirm;/);
  const sft = src.indexOf("const sessionForTurn", dropAt);
  LOG.push(`[static] drop at L${dropLine}; lock at L${lineOf(lockAt)}; sessionForTurn at L${lineOf(sft)}`);
});

await check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

out("\n================ LOG ================");
for (const l of LOG) out("  " + l);
out("\n================ [UNSAFE] (" + UNSAFE.length + ") ================");
for (const l of UNSAFE) out("  " + l);
out("\n================ [IMPRECISE] (" + IMPRECISE.length + ") ================");
for (const l of IMPRECISE) out("  " + l);
out("=====================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS combination hold A13");
process.exit(0);
