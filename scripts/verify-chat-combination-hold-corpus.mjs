/**
 * A10 (tester) — combination_choice「選組合階段句型判斷」第 5 輪實跑語料。
 *
 * Pipeline per turn mirrors send() in _app.chat.tsx (L10844-10857, L11592):
 *   flag = isCombinationChoiceTurn && (isCombinationPartialModifyReply || isDayOrdinalNegatedModifyReply)
 *   flag ? session : applyTripIntentToSession → prepareSessionForUserTurn → mergeTravelContext
 *   → processAdviceTurn → applyAdviceResultToSession → bindSelectionOwner.
 * HEAD: same file re-run inside the HEAD snapshot with --head-probe (no detector; HEAD send()).
 * fetch is stubbed and must stay 0; Places search is a mock.
 *
 * Run: npx vite-node scripts/verify-chat-combination-hold-corpus.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
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
    location: { placeId: "ChIJKyotoA10", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJA10Place${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoA10", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => ({ places: pool, error: null }),
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  s = numericAuth.bindSelectionOwner({ ...s, workspaceId: "ws-a10", conversationId: "cv-a10" });
  return s;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const choice = partialApi ? partialApi.isCombinationChoiceTurn(s) : false;
  const partial = choice && partialApi.isCombinationPartialModifyReply(t);
  const dayNegated = choice && partialApi.isDayOrdinalNegatedModifyReply(t);
  // send() L10846-10848: combinationPartialModifyTurn = partial || isCombinationHoldReply.
  const flag = choice && (partial || partialApi.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  // send() L11333-11335: replan reset skipped when the hold flag is set.
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  const r = stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
  let next = advice.applyAdviceResultToSession(
    { ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply },
    r.advice,
  );
  next = numericAuth.bindSelectionOwner(next);
  return { r, s: next, partial, dayNegated, flag };
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
/** 1b: day ordinal + negated modify → general nudge (combinationSelectionNudge). */
const DAY_NEG = {
  "zh-TW": ["第二天不用改", "第二天別改", "第二天不要換"],
  en: ["day 2 is fine, no need to change", "don't change day 2"],
  ja: ["2日目は変えなくていい", "2日目は変更しなくていい"],
  ko: ["2일차는 바꾸지 마", "2일차는 변경하지 말아줘"],
};
/** 1a: real unnamed day + modify verb → 某一天 follow-up (combinationPartialModify). */
const VAGUE_TRUE = {
  "zh-TW": [],
  en: ["change some day to food", "some day, change it"],
  ja: ["ある日を変えて"],
  ko: ["어느 날에 바꿔"],
};
/** 1a: day ordinal + modify verb (sanity; must still be the day follow-up). */
const ORDINAL_TRUE = {
  "zh-TW": [["第二天特別想改一下", 2]],
  en: [],
  ja: [],
  ko: [],
};
/** 2: not an unnamed day. zh 天數句 = HEAD; others → general nudge, nothing selected, days 4. */
const FALSE_POS = {
  "zh-TW": ["我只有一天，可以改嗎", "我們只有一天，想換一下"],
  en: ["can we change some day trips?", "some day I'd like to change plans"],
  ja: ["今ある日程を変えたい", "ある日程を変更したい"],
  ko: ["어느 날짜로 바꿔"],
};
/** Extra out-of-table wording: detectors must be false; state (and zh reply) = HEAD. */
const EXTRA = {
  "zh-TW": ["就有一天，想換一下", "才一天，可以改嗎", "還有一天想改", "沒有一天想換", "哪一天出發都可以", "改天再說", "有一天會再去", "改天再換"],
  en: ["some day-trip, can we change it?", "some days feel long, change?", "someday change it"],
  ja: ["ある日本の寺に変えたい", "ある日付に変更したい", "ある日数を変えたい"],
  ko: ["어느 날씨에 바꿔", "어느 날짜에 변경해"],
};
/** Negation variants outside NEGATED_MODIFY_RE (requirement 1b 「等」): recorded + checked for safety. */
const NEG_VARIANTS = {
  "zh-TW": ["第二天不改", "第二天先不換", "第二天沒有要改"],
  en: ["day 2 doesn't need to change", "leave day 2, no changes", "I won't change day 2"],
  ja: ["2日目は変えない", "2日目は変更しない"],
  ko: ["2일차는 안 바꿔도 돼", "2일차는 변경 안 해도 돼", "2일차는 바꿀 필요 없어"],
};
/** Day ordinal + modify-verb inflections outside MODIFY_VERB_RE: hold safety (requirement 1a). */
const VERB_VARIANTS = {
  "zh-TW": ["第二天想動一下", "第二天重新安排"],
  en: ["replace day 2", "edit day 2", "modify day 2"],
  ja: ["2日目を替えて", "2日目をかえて"],
  ko: ["2일차 바꿀래", "2일차는 바꿨으면 좋겠어", "2일차 변경할래"],
};
/** Mixed (record only). */
const MIXED = {
  "zh-TW": ["第二天不用改，但第三天換一下"],
  en: ["day 2 is fine, no need to change, but change day 3"],
  ja: [],
  ko: [],
};

const allTexts = (locale) => [
  ...DAY_NEG[locale], ...VAGUE_TRUE[locale], ...ORDINAL_TRUE[locale].map(([t]) => t),
  ...FALSE_POS[locale], ...EXTRA[locale], ...NEG_VARIANTS[locale], ...VERB_VARIANTS[locale], ...MIXED[locale],
];

if (HEAD_PROBE) {
  const res = {};
  for (const locale of LOCALES) {
    const s = await offeredSession(locale);
    res[locale] = {};
    for (const t of allTexts(locale)) res[locale][t] = state(sendTurn(s, t, locale));
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
  const self = "scripts/verify-chat-combination-hold-corpus.mjs";
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

for (const locale of LOCALES) {
  const s = await offeredSession(locale);
  const offeredIds = (s.travelContext?.offeredCombinations ?? []).map((c) => c.id);
  const nudge = chatRuntimeCopy("combinationSelectionNudge", locale);
  const nudges = new Set([nudge, chatRuntimeCopy("combinationSelectionNudgeShort", locale)]);
  const vagueCopy = chatRuntimeCopy("combinationPartialModify", locale);
  const followCopies = new Set([vagueCopy, ...[1, 2, 3, 4].map((day) => chatRuntimeCopy("combinationPartialModifyDay", locale, { day }))]);
  const record = (cat, t, turn) => {
    const st = state(turn);
    const h = HEAD?.[locale]?.[t];
    const same = JSON.stringify(pickState(st)) === JSON.stringify(pickState(h)) && st.reply === h?.reply;
    LOG.push(`[${locale}] ${cat} "${t}" partial=${turn.partial} neg=${turn.dayNegated} NOW=${JSON.stringify(pickState(st))} reply=${short(st.reply)}\n        HEAD=${JSON.stringify(pickState(h))} reply=${short(h?.reply)}${same ? " (=HEAD)" : " (DIFFERS)"}`);
    return { st, h, same };
  };
  const holdSafety = (st) => {
    assert.deepEqual(st.selected, [], `selected ${JSON.stringify(st.selected)}`);
    assert.equal(st.trigger, false, "generation triggered");
    assert.equal(st.placeRecs, false, "place recs triggered");
    assert.equal(st.days, 4, `days ${st.days}`);
    assert.equal(st.tripDays ?? null, s.tripDays ?? null, `tripDays ${st.tripDays}`);
    assert.equal(st.pending, "combination_choice", `pending ${st.pending}`);
  };

  await check(`${locale}: fixture combination_choice, days 4`, () => {
    assert.equal(s.pendingQuestion?.type, "combination_choice");
    assert.equal(s.travelContext?.days, 4);
    assert.ok(offeredIds.length >= 2);
  });

  for (const t of DAY_NEG[locale]) {
    await check(`${locale}: 日序否定 "${t}" → combinationSelectionNudge; nothing selected / generated; days 4; then 「2」 selects`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("day-neg", t, turn);
      assert.equal(turn.partial, false, "partial detector");
      assert.equal(turn.dayNegated, true, "day-negated detector");
      assert.equal(planningState.isReplanIntent(t), false, "replan gate would fire first");
      holdSafety(st);
      assert.equal(st.reply, nudge, `reply ${JSON.stringify(st.reply)}`);
      const next = state(sendTurn(turn.s, "2", locale));
      assert.deepEqual(next.selected, [2], `「2」 after → ${JSON.stringify(next.selected)}`);
      assert.equal(next.days, 4);
    });
  }

  for (const t of VAGUE_TRUE[locale]) {
    await check(`${locale}: 模糊某一天 "${t}" → combinationPartialModify follow-up; hold`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("vague", t, turn);
      assert.equal(turn.partial, true, "partial detector");
      assert.equal(planningState.isReplanIntent(t), false, "replan gate would fire first");
      holdSafety(st);
      assert.equal(st.reply, vagueCopy, `reply ${JSON.stringify(st.reply)}`);
      const next = state(sendTurn(turn.s, "2", locale));
      assert.deepEqual(next.selected, [2]);
    });
  }

  for (const [t, day] of ORDINAL_TRUE[locale]) {
    await check(`${locale}: 日序修改 "${t}" → day ${day} follow-up; hold`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("ordinal", t, turn);
      assert.equal(turn.partial, true, "partial detector");
      holdSafety(st);
      assert.equal(st.reply, chatRuntimeCopy("combinationPartialModifyDay", locale, { day }));
    });
  }

  for (const t of FALSE_POS[locale]) {
    await check(`${locale}: 誤判反例 "${t}" → not a vague day; ${locale === "zh-TW" ? "state + reply = HEAD" : "general nudge, nothing selected, days 4"}`, () => {
      const turn = sendTurn(s, t, locale);
      const { st, h } = record("false-pos", t, turn);
      assert.equal(turn.partial, false, "partial detector");
      assert.equal(turn.dayNegated, false, "day-negated detector");
      assert.ok(!followCopies.has(st.reply), `got follow-up copy ${JSON.stringify(st.reply)}`);
      if (locale === "zh-TW") {
        assert.deepEqual(pickState(st), pickState(h), "zh state vs HEAD");
        assert.equal(st.reply, h?.reply ?? null, "zh reply vs HEAD");
      } else {
        holdSafety(st);
        assert.ok(nudges.has(st.reply), `reply not general nudge: ${JSON.stringify(st.reply)}`);
      }
    });
  }

  for (const t of EXTRA[locale]) {
    await check(`${locale}: 表外 "${t}" → detectors false; state = HEAD${locale === "zh-TW" ? "; reply = HEAD" : ""}`, () => {
      const turn = sendTurn(s, t, locale);
      const { st, h } = record("extra", t, turn);
      assert.equal(turn.partial, false, "partial detector");
      assert.equal(turn.dayNegated, false, "day-negated detector");
      assert.ok(!followCopies.has(st.reply), `got follow-up copy ${JSON.stringify(st.reply)}`);
      assert.deepEqual(pickState(st), pickState(h), "state vs HEAD");
      if (locale === "zh-TW") assert.equal(st.reply, h?.reply ?? null, "zh reply vs HEAD");
    });
  }

  for (const t of NEG_VARIANTS[locale]) {
    await check(`${locale}: 否定變體 "${t}" → must not select / generate / change days (requirement 1)`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("neg-variant", t, turn);
      holdSafety(st);
    });
  }

  for (const t of VERB_VARIANTS[locale]) {
    await check(`${locale}: 動詞變化 "${t}" → must not select / generate / change days (requirement 1a)`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("verb-variant", t, turn);
      holdSafety(st);
    });
  }

  for (const t of MIXED[locale]) {
    await check(`${locale}: mixed "${t}" recorded; hold safety`, () => {
      const turn = sendTurn(s, t, locale);
      const { st } = record("mixed", t, turn);
      holdSafety(st);
    });
  }
}

await check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

out("\n================ LOG ================");
for (const l of LOG) out("  " + l);
out("=====================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS combination hold corpus");
process.exit(0);
