/**
 * A12 (tester) — combination_choice 選組合階段句型判斷第 7 輪：對抗式抽樣（四語系各 ≥15 條，不與既有腳本重複）。
 *
 * Same send() pipeline as scripts/verify-chat-combination-hold-a11.mjs (round 7):
 *   flag = isCombinationChoiceTurn && (isCombinationPartialModifyReply || isCombinationHoldReply)
 *   flag ? session : applyTripIntentToSession → prepareSessionForUserTurn
 *   → (isReplanIntent && !flag → reset) → mergeTravelContext → processAdviceTurn → applyAdviceResultToSession.
 * HEAD: same file in the HEAD snapshot with --head-probe.
 *
 * Expectations:
 *   follow:N   hold; reply combinationPartialModifyDay {day:N} (0 → generic)     [UNSAFE] select/days/generation
 *   nudge      hold; reply = selection nudge
 *   ref:I:D    combination ids I (comma list) + day D (0 → generic copy); no generation; confirm stored
 *   saferef    combination ref naming a non-offered combination: only offered ids, no generation, days 4
 *   days:N     1c: days N, nothing selected, no generation
 *   head       no-day sentence: state == HEAD (zh-TW also reply byte-equal)
 * Output classes: [UNSAFE] (wrong combination / trip length / generation) vs [IMPRECISE] (safe, copy off).
 * The run FAILs on any [UNSAFE]; [IMPRECISE] items are listed and counted.
 *
 * Run: npx vite-node scripts/verify-chat-combination-hold-a12-probe.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
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
    location: { placeId: "ChIJKyotoA12", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJA12Place${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoA12", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => ({ places: pool, error: null }),
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  s = numericAuth.bindSelectionOwner({ ...s, workspaceId: "ws-a12", conversationId: "cv-a12" });
  return s;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
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

// ------------------------------------------------------------------ corpus (new, not in earlier scripts)
const CORPUS = {
  "zh-TW": [
    ["第1組跟第2組，第二天改一下", "ref:1,2:2", "two combos + day"],
    ["第1組跟第3組，第二天改一下", "saferef", "non-offered combo 3 + day"],
    ["第二天重來，第1組不錯", "ref:1:2", "replan word + combo"],
    ["第一組好了，但最後一天換一下", "ref:1:0", "combo + last day"],
    ["第二、三天都換一下", "follow:2", "list form + 都"],
    ["第2-3天不要動", "nudge", "range negated"],
    ["最後一天想輕鬆點", "follow:0", "last day, no verb"],
    ["頭一天不用改", "nudge", "頭一天 negated"],
    ["第二天換成別處", "follow:2", "別處 not negation"],
    ["第二天去別家餐廳", "follow:2", "別家 not negation"],
    ["第三天重新規劃一下，預算3萬", "follow:3", "replan word + budget number"],
    ["2個人，第二天換一下", "follow:2", "number: party size"],
    ["第二天和第四天互換", "follow:2", "two days swap"],
    ["第二天絕對不要改", "nudge", "strong negation"],
    ["最後一天改成3天", "days:3", "1c last day + length"],
    ["第2-3天改成5天", "days:5", "1c range + length"],
    ["第二天幾點起床比較好", "follow:2", "question"],
    ["第2組，第三天重排", "ref:2:3", "combo + replan word"],
    ["預算3萬，選2", "head", "no day, number interference"],
    ["3萬預算夠嗎", "head", "no day, budget question"],
  ],
  en: [
    ["options 1 and 2 but swap day 2", "ref:1,2:2", "two combos + day"],
    ["option 1 and 3 but swap day 2", "saferef", "non-offered combo 3 + day"],
    ["option 2, but the last day should be lighter", "ref:2:0", "combo + last day"],
    ["the 3rd day needs to change", "follow:3", "3rd day"],
    ["change days 2-3", "follow:2", "days range"],
    ["the last day feels rushed", "follow:0", "last day no verb"],
    ["never touch the last day", "nudge", "never + last day"],
    ["not on day 2, change day 3 instead", "follow:3", "not on day N + another day"],
    ["redo day two", "follow:2", "redo + day two"],
    ["replan day 3", "follow:3", "replan word"],
    ["start over on day 2", "follow:2", "start over (replan) + day"],
    ["2 adults, change day 3", "follow:3", "number: party size"],
    ["budget 300, option 2, change the last day", "ref:2:0", "budget number + combo + last day"],
    ["change the 2nd day to 5 days", "days:5", "1c 2nd day + length"],
    ["the first day is too packed", "follow:1", "first day"],
    ["day four, can we go somewhere else", "follow:4", "day four + elsewhere"],
    ["I'll take option 2", "head", "no day"],
  ],
  ja: [
    ["1番と2番で、2日目を変えて", "ref:1,2:2", "two combos + day"],
    ["1番と3番、2日目を変えたい", "saferef", "non-offered combo 3 + day"],
    ["2番、最終日を変えて", "ref:2:0", "combo + 最終日"],
    ["最終日はゆっくりしたい", "follow:0", "最終日 no verb"],
    ["初日は変えないで", "nudge", "初日 negated"],
    ["二日目を変更してほしい", "follow:2", "二日目 変更"],
    ["三日目をやり直したい", "follow:3", "redo"],
    ["2日目と3日目は変えなくていい", "nudge", "two days negated"],
    ["2人で、3日目を変えて", "follow:3", "number: party size"],
    ["予算5万円、最終日を変えて", "follow:0", "budget number + 最終日"],
    ["最終日を3日間に変えて", "days:3", "1c 最終日 + length"],
    ["二日目を5日間にして", "days:5", "1c 二日目 + length"],
    ["4日目は別の場所にしたい", "follow:4", "別の"],
    ["2日目を組み直したい", "follow:2", "re-plan verb"],
    ["初日は絶対に変えないで", "nudge", "strong negation"],
    ["2番の三日目を練り直して", "ref:2:3", "combo + 三日目 + replan verb"],
    ["2番がいい", "head", "no day"],
  ],
  ko: [
    ["1번이랑 2번 조합, 2일차 바꿔줘", "ref:1,2:2", "two combos + day"],
    ["1번과 3번, 둘째 날 바꿔", "saferef", "non-offered combo 3 + day"],
    ["2번 조합, 마지막 날 바꿔", "ref:2:0", "combo + last day"],
    ["마지막 날은 여유롭게", "follow:0", "last day no verb"],
    ["첫째 날은 바꾸지 마", "nudge", "첫째 날 negated"],
    ["두 번째 날 변경해 줘", "follow:2", "두 번째 날"],
    ["이틀째 다시 짜줘", "follow:2", "이틀째 redo"],
    ["3번째 날 바꿔", "follow:3", "N번째 날 is not a combination"],
    ["2명이서, 3일차 바꿔", "follow:3", "number: party size"],
    ["예산 30만원, 마지막 날 바꿔", "follow:0", "budget number + last day"],
    ["마지막 날을 3일로 바꿔", "days:3", "1c last day + length"],
    ["둘째 날은 절대 바꾸지 마", "nudge", "strong negation"],
    ["2일차 다른 곳으로 바꿔", "follow:2", "다른 곳"],
    ["세 번째 날 다시 계획해줘", "follow:3", "replan verb"],
    ["2번째 날이랑 3번째 날 바꿔", "follow:2", "two N번째 날"],
    ["2번 조합의 셋째 날 다시 짜줘", "ref:2:3", "combo + 셋째 날 + redo"],
    ["2번 할게", "head", "no day"],
  ],
};

// After the confirm question: short affirmations (A13 round 8: count as confirm → [2]) and an explicit-nearby turn.
const AFFIRM = { "zh-TW": ["好", "可以"], en: ["ok", "yes please"], ja: ["はい", "お願いします"], ko: ["네", "좋아요"] };
const NEARBY = { "zh-TW": "附近有什麼咖啡廳", en: "cafes nearby", ja: "近くのカフェを探して", ko: "근처 카페 추천해줘" };
const CONFIRM = { "zh-TW": "幫我生成", en: "create it for me", ja: "この内容で作成して", ko: "이대로 만들어 주세요" };
const REF = { "zh-TW": "第2組的第一天改一下", en: "option 2, but change day 1", ja: "2番の1日目を変えて", ko: "2번 조합의 1일차를 바꿔" };

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

await check("corpus is new: no sample appears in earlier combination scripts", () => {
  const earlier = [
    "scripts/verify-chat-combination-hold-a11.mjs",
    "scripts/verify-chat-combination-hold-corpus.mjs",
    "scripts/verify-chat-combination-partial-modify.mjs",
    "scripts/verify-chat-intent-multilingual.mjs",
  ].map((p) => readFileSync(p, "utf8")).join("\n");
  const dup = LOCALES.flatMap((l) => CORPUS[l].map(([t]) => t)).filter((t) => earlier.includes(`"${t}"`));
  assert.deepEqual(dup, []);
  for (const l of LOCALES) assert.ok(CORPUS[l].length >= 15, `${l} has ${CORPUS[l].length} samples`);
});

function headResults() {
  const dir = headDirArg;
  assert.ok(dir && existsSync(join(dir, "src")), "pass -- --head-dir=<snapshot>");
  assert.ok(!existsSync(join(dir, "src/lib/ai/combination-partial-modify-reply.ts")), "snapshot must be HEAD source");
  const self = "scripts/verify-chat-combination-hold-a12-probe.mjs";
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
const short = (s) => JSON.stringify((s ?? "").slice(0, 80));

for (const locale of LOCALES) {
  const s = await offeredSession(locale);
  const offeredIds = (s.travelContext?.offeredCombinations ?? []).map((_, i) => i + 1);
  const nudges = new Set([chatRuntimeCopy("combinationSelectionNudge", locale), chatRuntimeCopy("combinationSelectionNudgeShort", locale)]);
  const followCopy = (day) => (day ? chatRuntimeCopy("combinationPartialModifyDay", locale, { day }) : chatRuntimeCopy("combinationPartialModify", locale));
  const replyKind = (reply) => {
    if (nudges.has(reply)) return "nudge";
    for (let d = 0; d <= 10; d += 1) if (reply === followCopy(d)) return `follow:${d}`;
    for (const ids of [[1], [2], [1, 2]]) {
      const combo = ids.join(locale === "en" || locale === "ko" ? ", " : "、");
      if (reply === chatRuntimeCopy("combinationRefDayConfirmGeneric", locale, { combo })) return `ref:${ids}:0`;
      for (let d = 1; d <= 10; d += 1) if (reply === chatRuntimeCopy("combinationRefDayConfirm", locale, { combo, day: d })) return `ref:${ids}:${d}`;
    }
    return "other";
  };

  for (const [t, expect, tag] of CORPUS[locale]) {
    const turn = sendTurn(s, t, locale);
    const st = state(turn);
    const h = HEAD?.[locale]?.[t];
    const kindNow = replyKind(st.reply);
    LOG.push(`[${locale}] (${tag}) "${t}" expect=${expect} hold=${turn.flag} replan=${turn.replan} kind=${kindNow} NOW=${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} reply=${short(st.reply)}\n        HEAD=${JSON.stringify(pickState(h))} reply=${short(h?.reply)}`);
    const [kind, a, b] = expect.split(":");
    const unsafe = [];
    const imprecise = [];
    if (st.trigger) unsafe.push("generation");
    if (st.placeRecs) unsafe.push("place recs");
    if ((st.tripDays ?? null) !== (s.tripDays ?? null) && kind !== "days") unsafe.push(`tripDays ${st.tripDays}`);
    if (kind === "follow" || kind === "nudge") {
      if (st.selected.length) unsafe.push(`selected ${JSON.stringify(st.selected)}`);
      if (st.days !== 4) unsafe.push(`days ${st.days}`);
      if (st.pending !== "combination_choice") unsafe.push(`pending ${st.pending}`);
      if (kindNow !== expect) imprecise.push(`reply ${kindNow} (want ${expect}) ${short(st.reply)}`);
    } else if (kind === "ref") {
      const ids = a.split(",").map(Number);
      if (JSON.stringify(st.selected) !== JSON.stringify(ids)) unsafe.push(`selected ${JSON.stringify(st.selected)} (want ${JSON.stringify(ids)})`);
      if (st.days !== 4) unsafe.push(`days ${st.days}`);
      if (st.pending !== "combination_choice") unsafe.push(`pending ${st.pending}`);
      if ((st.confirm?.length ?? 0) !== ids.length) imprecise.push(`confirm ${JSON.stringify(st.confirm)}`);
      if (kindNow !== `ref:${ids}:${b}`) imprecise.push(`reply ${kindNow} (want ref:${ids}:${b}) ${short(st.reply)}`);
    } else if (kind === "saferef") {
      if (st.selected.some((id) => !offeredIds.includes(id))) unsafe.push(`selected non-offered ${JSON.stringify(st.selected)}`);
      if (st.days !== 4) unsafe.push(`days ${st.days}`);
      if (st.pending !== "combination_choice") unsafe.push(`pending ${st.pending}`);
      // A13 (round 8): the confirm question names the missing combination (combinationMissingPrefix).
      const missingIds = (t.match(/\d+/g) ?? []).map(Number).filter((n) => !offeredIds.includes(n) && n !== partialApi.parseDayOrdinalFromText(t));
      const prefixed = missingIds.length > 0 && st.reply?.startsWith(chatRuntimeCopy("combinationMissingPrefix", locale, { missing: missingIds.join(locale === "en" || locale === "ko" ? ", " : "、") }));
      if (!prefixed && !kindNow.startsWith("ref:") && kindNow !== "nudge") imprecise.push(`reply ${kindNow} ${short(st.reply)}`);
      if (kindNow.startsWith("ref:")) imprecise.push(`non-offered combination silently dropped → ${kindNow} ${short(st.reply)}`);
    } else if (kind === "days") {
      if (st.selected.length) unsafe.push(`selected ${JSON.stringify(st.selected)}`);
      if (st.days !== Number(a)) unsafe.push(`days ${st.days} (want ${a})`);
      if (st.pending !== "combination_choice") unsafe.push(`pending ${st.pending}`);
    } else if (kind === "head") {
      if (JSON.stringify(pickState(st)) !== JSON.stringify(pickState(h))) unsafe.push(`state ≠ HEAD ${JSON.stringify(pickState(h))}`);
      if (locale === "zh-TW" && st.reply !== (h?.reply ?? null)) unsafe.push("zh reply ≠ HEAD");
      // HEAD may generate here: the row is about parity, not generation.
      const gi = unsafe.indexOf("generation");
      if (gi >= 0 && h?.trigger) unsafe.splice(gi, 1);
    }
    if (unsafe.length) UNSAFE.push(`[${locale}] "${t}" (${tag}) expect=${expect}: ${unsafe.join(", ")} reply=${short(st.reply)}`);
    if (imprecise.length) IMPRECISE.push(`[${locale}] "${t}" (${tag}) expect=${expect}: ${imprecise.join(", ")}`);
    await check(`${locale}: ${expect} "${t}" (${tag})`, () => assert.deepEqual(unsafe, [], `[UNSAFE] ${unsafe.join(", ")}`));
  }

  // ---- after the confirm question
  const ref = sendTurn(s, REF[locale], locale);
  const { confirmCombinationTitles: _c, ...plainPending } = ref.s.pendingQuestion ?? {};
  for (const t of AFFIRM[locale]) {
    const st = state(sendTurn(ref.s, t, locale));
    const gen = state(sendTurn({ ...ref.s, pendingQuestion: plainPending }, t, locale));
    LOG.push(`[${locale}] after confirm question → "${t}" NOW=${JSON.stringify(pickState(st))} confirm=${JSON.stringify(st.confirm)} reply=${short(st.reply)} | general=${JSON.stringify(pickState(gen))}`);
    // A13 (round 8, ruling): right after the confirm question a whole-sentence yes is a confirm →
    // generate with exactly [2], days 4 (same as 「幫我生成」).
    const viaConfirm = state(sendTurn(ref.s, CONFIRM[locale], locale));
    await check(`${locale}: after confirm question "${t}" (affirmation) → generate with [2], days 4`, () => {
      assert.deepEqual(st.selected, [2], `selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.days, 4, `days ${st.days}`);
      assert.equal(st.trigger, true, `no generation reply=${short(st.reply)} (general flow: ${JSON.stringify(pickState(gen))})`);
      assert.deepEqual(pickState(st), pickState(viaConfirm), `≠ "${CONFIRM[locale]}"`);
    });
  }

  // ---- explicit-nearby turn between the confirm question and the confirm phrase.
  // send(): explicitNearbyAuthority (L10214) → nextSession = {...sessionForTurn, explicitNearby…} (L10849)
  // and `merged` skips mergeTravelContext (L11371-11379), so the confirm drop in mergeTravelContext
  // (travel-context.ts L1693) does not run on that turn.
  await check(`${locale}: explicit-nearby turn "${NEARBY[locale]}" between confirm question and "${CONFIRM[locale]}" drops the confirm`, () => {
    const near = nearby.resolveExplicitNearbyIntent(NEARBY[locale]);
    LOG.push(`[${locale}] nearby "${NEARBY[locale]}" explicitNearbyAuthority=${JSON.stringify(near)}`);
    if (!near) return; // not an explicit-nearby turn → goes through mergeTravelContext (covered in a11 e2e d)
    const routed = { ...clone(ref.s), explicitNearbyKeyword: near.rawKeyword, canonicalNearbyKeyword: near.canonicalKeyword, nearbySemanticFamily: near.semanticFamily, activeChatIntent: near.intent };
    const survives = Boolean(routed.pendingQuestion?.confirmCombinationTitles?.length);
    const fin = state(sendTurn(routed, CONFIRM[locale], locale));
    LOG.push(`[${locale}] nearby path keeps confirm=${survives} → "${CONFIRM[locale]}" ${JSON.stringify(pickState(fin))}`);
    if (survives && fin.trigger && JSON.stringify(fin.selected) === "[2]") {
      UNSAFE.push(`[${locale}] confirm question → "${NEARBY[locale]}" (explicit nearby, mergeTravelContext skipped) → "${CONFIRM[locale]}" generates with [2] (route-derived)`);
      assert.fail(`[UNSAFE] confirm survives the explicit-nearby turn; "${CONFIRM[locale]}" then generates with [2]`);
    }
  });
}

function kindOf(reply, locale) {
  return [chatRuntimeCopy("combinationSelectionNudge", locale), chatRuntimeCopy("combinationSelectionNudgeShort", locale)].includes(reply) ? "nudge" : "other";
}

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
out("PASS combination hold A12 adversarial probe");
process.exit(0);
