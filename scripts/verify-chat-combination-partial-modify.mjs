/**
 * A7 — combination_choice「同意 + 轉折 + 修改」(都不錯但第二天改一下 / all good but change day 2 /
 * いいけど2日目を変えて / 좋은데 2일차 바꿔) end-to-end, four locales.
 *
 *  a. Partial phrase → follow-up (no selection / no generation / days stay 4 / pending kept) →
 *     then 「2」「選 2」「第 2 組」「全部」「all／すべて／전부」「幫我生成」「可以幫我生成」 and the
 *     “Create it for me” chip path (都不錯 → locked → 幫我生成): every one behaves exactly like the same
 *     reply sent without the partial turn first (and like HEAD), days stay 4.
 *  b. Counter-examples (spec list + boundary sentences): never the pattern, never the follow-up copy;
 *     zh-TW state equals HEAD.
 *  c. send() branch: static source order (flag before applyTripIntentToSession, branch returns before
 *     parsePlanningConstraintDelta / budget) + every gate before the branch evaluated on the phrase.
 *  d. Every action named in the follow-up copy (number example, quoted reply) is executed and succeeds.
 *
 * Pipeline emulation per turn (same order as send()): applyTripIntentToSession (skipped when the
 * partial flag is set, like _app.chat.tsx) → prepareSessionForUserTurn → mergeTravelContext →
 * processAdviceTurn → persistPlanningAdviceTurn equivalent (pendingQuestion = route.pendingQuestion)
 * → bindSelectionOwner (workspace sync).
 *
 * fetch is stubbed (must stay 0); Places search is a mock. HEAD comparison re-runs this file in a
 * scripts/verify-rel1-head-snapshot.mjs snapshot with `--head-probe`.
 * Run: npx vite-node scripts/verify-chat-combination-partial-modify.mjs --config scripts/vite.verify.config.mjs -- --head-dir=<snapshot>
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
// Watchdog: the run always ends on its own.
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
const combos = await load("src/lib/ai/destination-combination-suggestions.ts");
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
    location: { placeId: "ChIJKyotoA7", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJA7Place${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  let searchCalls = 0;
  const ready = await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoA7", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => { searchCalls++; return { places: pool, error: null }; },
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  // Persisted through workspace sync: the numeric selection owner is bound (rejectNumericSelection checks it).
  s = numericAuth.bindSelectionOwner({ ...s, workspaceId: "ws-a7", conversationId: "cv-a7" });
  return { s, ready, searchCalls, offerReply: r.advice.reply };
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/** One send() turn (see header). */
function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  // send() L10846-10848: combinationPartialModifyTurn = partial || isCombinationHoldReply.
  const flag = partialApi
    ? partialApi.isCombinationChoiceTurn(s) && (partialApi.isCombinationPartialModifyReply(t) || partialApi.isCombinationHoldReply(t))
    : false;
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
  return { r, s: next, flag };
}

function state({ r, s }) {
  return {
    selected: s.travelContext?.selectedCombinationIds ?? [],
    days: s.travelContext?.days ?? null,
    tripDays: s.tripDays ?? null,
    trigger: Boolean(r.advice.triggerItineraryGeneration),
    placeRecs: Boolean(r.advice.triggerPlaceRecommendations),
    pending: s.pendingQuestion?.type ?? null,
    pendingOptions: s.pendingQuestion?.options ?? null,
    destination: s.travelContext?.destination ?? null,
  };
}

const ALL_WORD = { "zh-TW": "全部", en: "all", ja: "すべて", ko: "전부" };
const FOLLOWUPS = (locale) => [...new Set(["2", "選 2", "第 2 組", "全部", ALL_WORD[locale], "幫我生成", "可以幫我生成"])];

const PARTIAL_POS = {
  "zh-TW": [["都不錯但第二天改一下", 2], ["可以，不過第3天想調整", 3], ["都很好但第二天換一下", 2], ["第二天改一下", 2], ["第二天改成去金閣寺", 2], ["第二天換成嵐山", 2], ["第二天改去嵐山", 2], ["第3天換成去奈良", 3]],
  en: [["all good but change day 2", 2], ["Looks great but can we swap the second day?", 2], ["fine but adjust day 3", 3], ["change day 2", 2], ["change day 2 to Kinkaku-ji", 2], ["change day 2 to Kinkaku-ji instead", 2], ["switch day 2 to Arashiyama", 2]],
  ja: [["いいけど2日目を変えて", 2], ["すべて良いけど3日目を変更したい", 3], ["2日目を変えて", 2], ["2日目を金閣寺に変えて", 2]],
  ko: [["좋은데 2일차 바꿔", 2], ["다 좋지만 3일째는 변경해 줘", 3], ["2일차 바꿔", 2], ["2일차를 금각사로 바꿔", 2]],
};

/** Spec counter-examples + boundary sentences (each tagged with its category). */
const COUNTER = {
  "zh-TW": [
    ["可以但改成5天", "spec:days"], ["都不錯但換第2組", "spec:combo"], ["可以但改去大阪", "spec:destination"],
    ["都不錯但有點趕", "contrast-only"], ["改成去首爾吧", "destination-switch-alt"], ["都不錯，但不用改", "negated-modify"],
    ["可以但換成大阪", "destination-switch"], ["可以但改成五天", "days-in-words"], ["都不錯但預算改成3萬", "budget"],
    ["有一天去了大阪很好玩", "vague-day-no-modify"],
  ],
  en: [
    ["fine but change to 5 days", "spec:days"], ["fine but it's a bit pricey", "contrast-only"], ["switch it to Busan", "destination-switch-alt"],
    ["some day I'll visit", "vague-day-no-modify"],
    ["fine but don't change anything", "negated-modify"], ["fine but change it to Osaka", "destination-switch"],
    ["fine but change it to five days", "days-in-words"], ["fine but swap to option 2", "combo"],
  ],
  ja: [
    ["いいけど少し高いね", "contrast-only"], ["やっぱり福岡にして", "destination-switch-alt"], ["いいけど変えないで", "negated-modify"],
    ["いいけど大阪に変えて", "destination-switch"], ["いいけど5日間に変えて", "days"], ["いいけど2番に変えて", "combo"],
  ],
  ko: [
    ["좋은데 3박으로 바꿔", "spec:days"], ["좋은데 좀 비싸네", "contrast-only"], ["부산으로 하자", "destination-switch-alt"],
    ["좋은데 바꾸지 마", "negated-modify"], ["좋은데 오사카로 바꿔", "destination-switch"], ["좋은데 사흘로 바꿔", "days-in-words"],
    ["좋은데 2번으로 바꿔", "combo"],
  ],
};

/** L4 spec A (approved): these counter-examples switch the destination (zh compared to the spec, not HEAD). */
const SPEC_A_SWITCH = { "zh-TW": { "改成去首爾吧": "首爾", "可以但改去大阪": "大阪", "可以但換成大阪": "大阪" } };
/** A8 1c: trip-length-only reply → days updated, nothing selected, no generation, pending kept, general nudge. */
const DAYS_ONLY = {
  "zh-TW": [["可以但改成1天", 1]],
  en: [["fine but change to 1 day", 1]],
  ja: [["いいけど1日に変えて", 1]],
  ko: [["좋은데 1일로 바꿔", 1]],
};
/** A8: no day ordinal / no agreement → original flow (general nudge); zh equals HEAD. */
const GENERIC_NUDGE = { "zh-TW": [], en: [], ja: [], ko: [] };
/**
 * A9 ruling: an unnamed day + modify verb → 「某一天」follow-up (combinationPartialModify), days stay 4,
 * pending kept, nothing selected. zh intentionally differs from HEAD (HEAD read 「一天」 as a trip length).
 */
const VAGUE_POS = {
  "zh-TW": ["其中一天換一下", "某一天想換一下", "哪一天可以改嗎"],
  en: ["one of the days, change it"],
  ja: ["どこか1日変えたい", "ある日を変えて"],
  ko: ["하루는 바꿔 줘", "어느 날 바꿔"],
};
/**
 * A9 reviewer: VAGUE_DAY_RE substrings inside non-day words (「只有一天」= trip length, 「ある日程」= existing
 * schedule, "some day trips"). No day is named → must keep the existing flow (state = HEAD, general nudge).
 */
const VAGUE_FALSE_POS = {
  "zh-TW": ["我只有一天，可以改嗎", "我們只有一天，想換一下"],
  en: ["can we change some day trips?"],
  ja: ["今ある日程を変えたい", "ある日程を変更したい"],
  ko: [],
};
/** Reviewer boundary sentences: recorded with HEAD for judgement (not spec items). */
const REVIEW_EDGE = {
  "zh-TW": ["有一天想改成去大阪", "改成去首爾吧，第二天也行", "第二天不用改"],
  en: ["switch to Busan", "some day I'd like to change plans"],
  ja: [],
  ko: ["어느 날짜로 바꿔", "하루만 바꿔"],
};

// ------------------------------------------------------------------ HEAD probe (child)
if (HEAD_PROBE) {
  const res = {};
  for (const locale of LOCALES) {
    const { s } = await offeredSession(locale);
    const direct = {};
    for (const t of FOLLOWUPS(locale)) direct[t] = state(sendTurn(s, t, locale));
    const counter = {};
    for (const [t] of COUNTER[locale]) {
      const turn = sendTurn(s, t, locale);
      counter[t] = { ...state(turn), reply: turn.r.advice.reply ?? null };
    }
    const partial = {};
    for (const [t] of PARTIAL_POS[locale]) partial[t] = state(sendTurn(s, t, locale));
    const extra = {};
    for (const t of [...DAYS_ONLY[locale].map(([x]) => x), ...GENERIC_NUDGE[locale], ...VAGUE_POS[locale], ...VAGUE_FALSE_POS[locale], ...REVIEW_EDGE[locale]]) {
      const turn = sendTurn(s, t, locale);
      extra[t] = { ...state(turn), reply: turn.r.advice.reply ?? null };
    }
    res[locale] = { direct, counter, partial, extra };
  }
  out("@@HEAD_JSON@@" + JSON.stringify({ res, fetchCalls }) + "@@END@@");
  process.exit(0);
}

// ------------------------------------------------------------------ main
const failures = [];
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
const shortcut = await load("src/lib/chat-shortcut-chips.ts");
const tripPlanningCtx = await load("src/lib/ai/trip-planning-context.ts");
const dateConfirm = await load("src/lib/ai/trip-date-confirmation.ts");
const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
const handoff = await load("src/lib/ai/generated-plan-handoff.ts");
const chatIntent = await load("src/lib/ai/chat-intent.ts");
const dining = await load("src/lib/ai/chat-dining-flow.ts");
const arbitrate = await load("src/lib/ai/recommendation-refinement/arbitrate.ts");
const createAuth = await load("src/lib/ai/chat-create-authority.ts");
const planningSelection = await load("src/lib/planning-selection.ts");
const constraints = await load("src/lib/ai/planning-conversation-constraints.ts");
const budget = await load("src/lib/ai/budget-refinement.ts");

function headResults() {
  const dir = headDirArg;
  assert.ok(dir && existsSync(join(dir, "src")), "pass -- --head-dir=<scripts/verify-rel1-head-snapshot.mjs snapshot>");
  assert.ok(!existsSync(join(dir, "src/lib/ai/combination-partial-modify-reply.ts")), "snapshot must be HEAD source");
  const self = "scripts/verify-chat-combination-partial-modify.mjs";
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
await check("HEAD snapshot probe ran (same pipeline, HEAD source)", () => {
  HEAD = headResults();
});

const SAMPLES = [];
const followCopy = (locale) => [chatRuntimeCopy("combinationPartialModify", locale), ...[1, 2, 3].map((day) => chatRuntimeCopy("combinationPartialModifyDay", locale, { day }))];

/** Actions named in the follow-up copy: number example + quoted replies. */
function copyActions(copy) {
  const quoted = [...copy.matchAll(/[“「"]([^”」"]+)[”」"]/g)].map((m) => m[1]);
  const example = copy.match(/(?:例如\s*|for example,\s*|例：|예:\s*)(\d+)/)?.[1];
  return { quoted, example };
}

for (const locale of LOCALES) {
  const base = await offeredSession(locale);
  const { s } = base;
  const offered = s.travelContext?.offeredCombinations?.length ?? 0;
  const offeredIds = (s.travelContext?.offeredCombinations ?? []).map((c) => c.id);

  await check(`${locale}: fixture — combination_choice offered (mock search only), days 4, owner bound`, () => {
    assert.equal(base.ready.ok, true, "discovery ready");
    assert.ok(base.searchCalls >= 1, "mock search used");
    assert.equal(s.pendingQuestion?.type, "combination_choice", `pending ${s.pendingQuestion?.type}\n${base.offerReply}`);
    assert.ok(offered >= 2, `offered ${offered}`);
    assert.equal(s.travelContext?.days, 4);
    assert.ok(s.pendingQuestion?.selectionOwner, "selection owner bound");
  });

  // ---------------------------------------------------------------- a. partial → follow-up
  for (const [text, day] of PARTIAL_POS[locale]) {
    await check(`${locale}: "${text}" → follow-up only (no selection / generation / day change; pending + owner kept)`, () => {
      const turn = sendTurn(s, text, locale);
      {
        const st0 = state(turn);
        if (!partialApi.isCombinationPartialModifyReply(text)) {
          SAMPLES.push(`[${locale}] NOT-DETECTED "${text}" → ${JSON.stringify({ selected: st0.selected, days: st0.days, trigger: st0.trigger, pending: st0.pending, destination: st0.destination })} reply=${JSON.stringify(turn.r.advice.reply)}`);
        }
      }
      assert.equal(partialApi.isCombinationPartialModifyReply(text), true, "detector");
      assert.equal(turn.flag, true, "send() flag");
      const st = state(turn);
      assert.deepEqual(st.selected, [], `selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.trigger, false, "generation triggered");
      assert.equal(st.placeRecs, false, "place recs triggered");
      assert.equal(st.days, 4, `days ${st.days}`);
      assert.equal(turn.s.tripDays ?? null, s.tripDays ?? null, "session tripDays changed");
      assert.equal(st.pending, "combination_choice", `pending ${st.pending}`);
      assert.deepEqual(turn.s.travelContext?.offeredCombinations?.map((c) => c.id), offeredIds, "offers changed");
      assert.equal(turn.r.advice.reply, chatRuntimeCopy("combinationPartialModifyDay", locale, { day }), `reply: ${turn.r.advice.reply}`);
      assert.equal(numericAuth.matchesSelectionOwner(turn.s, turn.s.pendingQuestion), true, "owner snapshot still matches");
      assert.equal(numericAuth.rejectNumericSelection(turn.s, "2"), false, "「2」 would be rejected next turn");
      // HEAD baseline (the bug this fixes) for the record.
      const h = HEAD?.[locale]?.partial?.[text];
      SAMPLES.push(`[${locale}] "${text}" → ${turn.r.advice.reply}\n      HEAD: selected=${JSON.stringify(h?.selected)} days=${h?.days} trigger=${h?.trigger}`);
    });
  }

  const partialText = PARTIAL_POS[locale][0][0];
  const afterPartial = sendTurn(s, partialText, locale).s;

  // ---------------------------------------------------------------- a. follow-ups after the partial turn
  for (const t of FOLLOWUPS(locale)) {
    await check(`${locale}: partial → "${t}" behaves like "${t}" sent directly (and like HEAD); days stay 4`, () => {
      const after = state(sendTurn(afterPartial, t, locale));
      const direct = state(sendTurn(s, t, locale));
      assert.deepEqual(after, direct, `after partial ${JSON.stringify(after)}\n direct ${JSON.stringify(direct)}`);
      assert.equal(after.days, 4, `days ${after.days}`);
      assert.ok(after.selected.length > 0 || after.trigger, `nothing selected / generated: ${JSON.stringify(after)}`);
      const h = HEAD?.[locale]?.direct?.[t];
      assert.ok(h, "HEAD result");
      const pick = (x) => ({ selected: x.selected, days: x.days, trigger: x.trigger, pending: x.pending });
      if (locale !== "zh-TW" && t === ALL_WORD[locale]) {
        // all / すべて / 전부 are new en/ja/ko replies (earlier rounds); HEAD did not understand them.
        assert.deepEqual([...after.selected].sort(), [...offeredIds].sort(), `"${t}" must select all`);
        SAMPLES.push(`[${locale}] note: HEAD "${t}" → ${JSON.stringify(pick(h))} (word not supported at HEAD)`);
      } else {
        assert.deepEqual(pick(direct), pick(h), `NOW ${JSON.stringify(pick(direct))} vs HEAD ${JSON.stringify(pick(h))}`);
      }
      SAMPLES.push(`[${locale}] partial → "${t}": selected=${JSON.stringify(after.selected)} trigger=${after.trigger} days=${after.days} pending=${after.pending}`);
    });
  }

  // “Create it for me”: 都不錯 locks all → chip 幫我生成 (payload) → generation.
  await check(`${locale}: partial → 都不錯 → “${shortcut.chatShortcutLabel("幫我生成", locale)}” chip (payload 幫我生成) starts generation, days 4`, () => {
    const locked = sendTurn(afterPartial, "都不錯", locale);
    const ls = state(locked);
    assert.equal(ls.pending, "activity_choice", `pending ${ls.pending} reply=${locked.r.advice.reply}`);
    assert.ok(ls.pendingOptions?.includes("幫我生成"), `chip options ${JSON.stringify(ls.pendingOptions)}`);
    const label = shortcut.chatShortcutLabel("幫我生成", locale);
    assert.ok(locked.r.advice.reply.includes(label), `reply names chip "${label}": ${locked.r.advice.reply}`);
    const contract = shortcut.chatShortcutContract("幫我生成", locale);
    assert.equal(contract.routingPayload, "幫我生成");
    const gen = state(sendTurn(locked.s, contract.routingPayload, locale));
    assert.equal(gen.trigger, true, `chip did not generate: ${JSON.stringify(gen)}`);
    assert.equal(gen.days, 4);
    assert.deepEqual([...gen.selected].sort(), [...offeredIds].sort());
  });

  // ---------------------------------------------------------------- d. every action named in the follow-up copy
  await check(`${locale}: follow-up copy — every action it names succeeds after the partial turn`, () => {
    const bad = [];
    for (const copy of followCopy(locale)) {
      const { quoted, example } = copyActions(copy);
      if (!example) bad.push(`no number example: ${copy}`);
      if (!quoted.length) bad.push(`no quoted reply: ${copy}`);
      if (example) {
        const st = state(sendTurn(afterPartial, example, locale));
        if (JSON.stringify(st.selected) !== JSON.stringify([Number(example)]) || st.days !== 4) bad.push(`example "${example}" → ${JSON.stringify(st)}`);
      }
      for (const q of quoted) {
        const st = state(sendTurn(afterPartial, q, locale));
        // zh「可以幫我生成」is described as 混搭全部組合; en/ja/ko quote the all-word ("use all combinations").
        if ([...st.selected].sort().join() !== [...offeredIds].sort().join() || st.days !== 4) bad.push(`quoted "${q}" → ${JSON.stringify(st)}`);
      }
    }
    assert.deepEqual([...new Set(bad)], []);
  });

  // ---------------------------------------------------------------- b. counter-examples
  await check(`${locale}: counter-examples are not the pattern and never get the follow-up copy`, () => {
    const bad = [];
    const copies = new Set(followCopy(locale));
    for (const [t, cat] of COUNTER[locale]) {
      const det = partialApi.isCombinationPartialModifyReply(t);
      const turn = sendTurn(s, t, locale);
      const now = state(turn);
      const h = HEAD?.[locale]?.counter?.[t];
      const pick = (x) => x && ({ selected: x.selected, days: x.days, trigger: x.trigger, pending: x.pending, destination: x.destination });
      const sameAsHead = JSON.stringify(pick(now)) === JSON.stringify(pick(h));
      SAMPLES.push(`[${locale}] counter(${cat}) "${t}": detector=${det} NOW=${JSON.stringify(pick(now))} HEAD=${JSON.stringify(pick(h))}${sameAsHead ? "" : " (differs)"}`);
      if (det) bad.push(`(${cat}) "${t}" judged as partial-modify → reply ${JSON.stringify(turn.r.advice.reply)}`);
      if (copies.has(turn.r.advice.reply)) bad.push(`(${cat}) "${t}" got the follow-up copy`);
      // L4 spec A (approved): a known destination while choosing combinations switches the trip
      // (new planning session, days 4 carried, nothing selected / generated). Combinations for the
      // new destination are checked separately below (this harness has no Places pool for it).
      const specASwitch = SPEC_A_SWITCH[locale]?.[t];
      if (specASwitch) {
        if (now.destination !== specASwitch) bad.push(`(${cat}) "${t}" spec A: destination ${now.destination} (want ${specASwitch})`);
        if (now.days !== 4) bad.push(`(${cat}) "${t}" spec A: days ${now.days} (want 4 carried)`);
        if (now.selected.length || now.trigger) bad.push(`(${cat}) "${t}" spec A: selected/generated ${JSON.stringify(now)}`);
        if (turn.s.planningSessionId === s.planningSessionId) bad.push(`(${cat}) "${t}" spec A: planningSessionId unchanged`);
        if (!["combination_choice", "ask_preference"].includes(now.pending)) bad.push(`(${cat}) "${t}" spec A: pending ${now.pending}`);
        continue;
      }
      if (locale === "zh-TW" && !sameAsHead) bad.push(`(${cat}) "${t}" zh state differs from HEAD: NOW ${JSON.stringify(pick(now))} HEAD ${JSON.stringify(pick(h))}`);
      if (locale === "zh-TW" && (turn.r.advice.reply ?? null) !== h?.reply) bad.push(`(${cat}) "${t}" zh reply differs from HEAD:\n      NOW  ${JSON.stringify(turn.r.advice.reply)}\n      HEAD ${JSON.stringify(h?.reply)}`);
      if (det && h?.reply) SAMPLES.push(`      HEAD reply: ${JSON.stringify(h.reply.slice(0, 160))}`);
    }
    assert.deepEqual(bad, []);
  });

  // ---------------------------------------------------------------- A8 1c. trip-length-only reply (intentionally differs from HEAD)
  const nudges = new Set([chatRuntimeCopy("combinationSelectionNudge", locale), chatRuntimeCopy("combinationSelectionNudgeShort", locale)]);
  for (const [t, days] of DAYS_ONLY[locale]) {
    await check(`${locale}: "${t}" → days ${days} only; selected=[]; no generation; pending combination_choice; general nudge`, () => {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const h = HEAD?.[locale]?.extra?.[t];
      SAMPLES.push(`[${locale}] days-only "${t}" → ${JSON.stringify({ selected: st.selected, days: st.days, trigger: st.trigger, pending: st.pending })} reply=${JSON.stringify(turn.r.advice.reply)}\n      HEAD: ${JSON.stringify(h && { selected: h.selected, days: h.days, trigger: h.trigger, pending: h.pending })}`);
      assert.equal(partialApi.isCombinationPartialModifyReply(t), false, "detector");
      assert.deepEqual(st.selected, [], `selected ${JSON.stringify(st.selected)}`);
      assert.equal(st.days, days, `days ${st.days}`);
      assert.equal(st.trigger, false, "generation triggered");
      assert.equal(st.placeRecs, false, "place recs triggered");
      assert.equal(st.pending, "combination_choice", `pending ${st.pending}`);
      assert.ok(nudges.has(turn.r.advice.reply), `reply is not the general nudge: ${JSON.stringify(turn.r.advice.reply)}`);
    });
  }
  for (const t of GENERIC_NUDGE[locale]) {
    await check(`${locale}: "${t}" (no ordinal) → general nudge, nothing selected, pending kept, zh equals HEAD`, () => {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const h = HEAD?.[locale]?.extra?.[t];
      SAMPLES.push(`[${locale}] generic "${t}" → reply=${JSON.stringify(turn.r.advice.reply)} state=${JSON.stringify({ selected: st.selected, days: st.days, trigger: st.trigger, pending: st.pending })}\n      HEAD: reply=${JSON.stringify(h?.reply)} state=${JSON.stringify(h && { selected: h.selected, days: h.days, trigger: h.trigger, pending: h.pending })}`);
      assert.equal(partialApi.isCombinationPartialModifyReply(t), false, "detector");
      assert.ok(nudges.has(turn.r.advice.reply), `reply ${JSON.stringify(turn.r.advice.reply)}`);
      assert.deepEqual(st.selected, []);
      assert.equal(st.trigger, false);
      assert.equal(st.pending, "combination_choice");
      // Note (HEAD-original): 「一天」 is read as a trip length (days 4 → 1) at HEAD too; spec only asks zh = HEAD here.
      if (locale === "zh-TW") {
        assert.equal(turn.r.advice.reply ?? null, h?.reply, "zh reply vs HEAD");
        const pick = (x) => x && ({ selected: x.selected, days: x.days, trigger: x.trigger, pending: x.pending, destination: x.destination });
        assert.deepEqual(pick(st), pick(h), "zh state vs HEAD");
      }
    });
  }

  // ---------------------------------------------------------------- A9 vague day → 「某一天」follow-up (zh intentionally differs from HEAD)
  for (const t of VAGUE_POS[locale]) {
    await check(`${locale}: "${t}" (unnamed day) → generic 某一天 follow-up; days 4; pending kept; nothing selected / generated`, () => {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const h = HEAD?.[locale]?.extra?.[t];
      SAMPLES.push(`[${locale}] vague "${t}" → reply=${JSON.stringify(turn.r.advice.reply)} state=${JSON.stringify({ selected: st.selected, days: st.days, trigger: st.trigger, pending: st.pending })}\n      HEAD: state=${JSON.stringify(h && { selected: h.selected, days: h.days, trigger: h.trigger, pending: h.pending })} reply=${JSON.stringify(h?.reply?.slice(0, 120))}`);
      assert.equal(partialApi.isCombinationPartialModifyReply(t), true, "detector");
      assert.equal(turn.flag, true, "send() flag");
      assert.equal(turn.r.advice.reply, chatRuntimeCopy("combinationPartialModify", locale), `reply ${JSON.stringify(turn.r.advice.reply)}`);
      assert.deepEqual(st.selected, []);
      assert.equal(st.trigger, false);
      assert.equal(st.placeRecs, false);
      assert.equal(st.days, 4, `days ${st.days}`);
      assert.equal(turn.s.tripDays ?? null, s.tripDays ?? null, "session tripDays changed");
      assert.equal(st.pending, "combination_choice");
      assert.deepEqual(turn.s.travelContext?.offeredCombinations?.map((c) => c.id), offeredIds, "offers changed");
      assert.equal(numericAuth.rejectNumericSelection(turn.s, "2"), false, "「2」 would be rejected next turn");
      const next = state(sendTurn(turn.s, "2", locale));
      assert.deepEqual(next.selected, [2], `「2」 after vague → ${JSON.stringify(next)}`);
      assert.equal(next.days, 4);
    });
  }

  // ---------------------------------------------------------------- A9 reviewer: vague-day substring false positives
  for (const t of VAGUE_FALSE_POS[locale]) {
    await check(`${locale}: "${t}" names no day → not partial-modify; state = HEAD; general nudge`, () => {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const h = HEAD?.[locale]?.extra?.[t];
      const pick = (x) => x && ({ selected: x.selected, days: x.days, trigger: x.trigger, pending: x.pending, destination: x.destination });
      SAMPLES.push(`[${locale}] vague-false-pos "${t}": detector=${partialApi.isCombinationPartialModifyReply(t)} NOW=${JSON.stringify(pick(st))} reply=${JSON.stringify((turn.r.advice.reply ?? "").slice(0, 100))}\n      HEAD=${JSON.stringify(pick(h))} reply=${JSON.stringify((h?.reply ?? "").slice(0, 100))}`);
      assert.equal(partialApi.isCombinationPartialModifyReply(t), false, "detector");
      assert.deepEqual(pick(st), pick(h), "state vs HEAD");
      if (locale === "zh-TW") assert.equal(turn.r.advice.reply ?? null, h?.reply ?? null, "zh reply vs HEAD");
      else assert.ok(nudges.has(turn.r.advice.reply), `reply is not the general nudge: ${JSON.stringify(turn.r.advice.reply)}`);
    });
  }

  // ---------------------------------------------------------------- reviewer boundary sentences (recorded)
  await check(`${locale}: reviewer boundary sentences recorded (NOW vs HEAD)`, () => {
    for (const t of REVIEW_EDGE[locale]) {
      const turn = sendTurn(s, t, locale);
      const st = state(turn);
      const h = HEAD?.[locale]?.extra?.[t];
      const pick = (x) => x && ({ selected: x.selected, days: x.days, trigger: x.trigger, pending: x.pending, destination: x.destination });
      const same = JSON.stringify(pick(st)) === JSON.stringify(pick(h)) && (turn.r.advice.reply ?? null) === (h?.reply ?? null);
      SAMPLES.push(`[${locale}] edge "${t}": detector=${partialApi.isCombinationPartialModifyReply(t)} NOW=${JSON.stringify(pick(st))} reply=${JSON.stringify((turn.r.advice.reply ?? "").slice(0, 100))}\n      HEAD=${JSON.stringify(pick(h))} reply=${JSON.stringify((h?.reply ?? "").slice(0, 100))}${same ? " (same as HEAD)" : " (DIFFERS)"}`);
    }
  });

  // ---------------------------------------------------------------- c. gates in send() before the new branch
  await check(`${locale}: send() gates before the branch let the partial phrase through unchanged`, () => {
    const bad = [];
    for (const t of [...PARTIAL_POS[locale].map(([x]) => x), ...VAGUE_POS[locale]]) {
      const ss = clone(s);
      if (tripPlanningCtx.classifyDestinationSwitchTurn(t).state !== "NO_SWITCH") bad.push(`"${t}" destination switch ${tripPlanningCtx.classifyDestinationSwitchTurn(t).state}`);
      if (dateConfirm.isRepeatedTripDateConfirmation(ss, t)) bad.push(`"${t}" repeated date`);
      if (numericAuth.rejectNumericSelection(ss, t)) bad.push(`"${t}" numeric reject`);
      if (handoff.isExplicitTripCreationTurn(t) || sessionMod.isUserConfirmingItinerary(t)) bad.push(`"${t}" explicit create`);
      if (/^(?:生成行程|生成完整行程|幫我生成)$/.test(t)) bad.push(`"${t}" selection generate`);
      if (planningSelection.isPlanningSelectionMode?.(ss) && planningSelection.isPlanningSelectionContinuation(t)) bad.push(`"${t}" selection continuation`);
      if (nearbyClar.resolveExplicitNearbyIntent(t)) bad.push(`"${t}" explicit nearby`);
      if (planningState.isReplanIntent(t)) bad.push(`"${t}" replan (would reset the pending)`);
      let n = chatIntent.applyQuickChipContext(t, ss);
      n = dining.applyDiningContextFromText(t, n);
      n = createAuth.applyChatCreateAuthority(n, arbitrate.resolveChatIntentArbitration(t, n), false);
      n = convState.prepareSessionForUserTurn(n, ss.lastAssistantReply);
      if (n.pendingQuestion?.type !== "combination_choice") bad.push(`"${t}" pending lost before merge: ${n.pendingQuestion?.type}`);
      if ((n.travelContext?.days ?? null) !== 4 || (n.tripDays ?? null) !== (ss.tripDays ?? null)) bad.push(`"${t}" days changed before merge`);
      if (n.tripCreationAuthority?.explicitCreate) bad.push(`"${t}" create authority set`);
      const m = travelContext.mergeTravelContext(n, t, ss.lastAssistantReply);
      if (m.context.destinationClarification || (m.context.destinationCandidate && m.context.destinationCandidate.status !== "resolved")) bad.push(`"${t}" destination clarification branch (L11563) first`);
      if (m.context.days !== 4) bad.push(`"${t}" merged days ${m.context.days}`);
      // What the skipped helpers would have done (the reason for the branch):
      const intentDays = tripIntent.applyTripIntentToSession(t, ss);
      const delta = constraints.parsePlanningConstraintDelta({ text: t, shownCandidates: [], authoritativeDestination: "京都" });
      SAMPLES.push(`[${locale}] skipped for "${t}": applyTripIntentToSession → tripDays=${intentDays.tripDays ?? null} days=${intentDays.travelContext?.days ?? null}; budget=${budget.isBudgetRefinementText(t)}; delta keys=${Object.keys(delta).filter((k) => delta[k] && (Array.isArray(delta[k]) ? delta[k].length : true)).join(",")}`);
    }
    assert.deepEqual(bad, []);
  });
}

// L4 spec A: after the switch nothing of the old destination is offered or named.
for (const [locale, table] of Object.entries(SPEC_A_SWITCH)) for (const [t, dest] of Object.entries(table)) {
  await check(`${locale}: "${t}" spec A switch → ${dest}; old 京都 combinations / names gone`, async () => {
    const { s } = await offeredSession(locale);
    const first = sendTurn(s, t, locale);
    const st0 = state(first);
    if (st0.pending === "ask_preference") {
      assert.match(first.r.advice.reply ?? "", new RegExp(dest), `fallback reply should name ${dest}: ${first.r.advice.reply}`);
    }
    // This harness never runs Places discovery for the new destination, so the advice turn takes the
    // "no Places data" fallback; the end-to-end listing (with a pool) is in verify-l-combination-switch-extra.
    assert.equal(st0.destination, dest);
    assert.equal(st0.days, 4);
    assert.doesNotMatch(first.r.advice.reply ?? "", /京都|清水寺|金閣寺/, `reply mentions the old destination: ${first.r.advice.reply}`);
    const leftover = first.s.travelContext?.offeredCombinations ?? [];
    assert.deepEqual(leftover.filter((c) => /清水寺|金閣寺|銀閣寺|京都/.test(JSON.stringify(c))).map((c) => c.id), [], `old 京都 combinations kept: ${JSON.stringify(leftover).slice(0, 200)}`);
    SAMPLES.push(`[${locale}] spec A "${t}" pending=${st0.pending} reply=${JSON.stringify((first.r.advice.reply ?? "").slice(0, 100))}`);
  });
}

// ---------------------------------------------------------------- c. static source order in send()
await check("send(): flag skips applyTripIntentToSession; branch returns before parsePlanningConstraintDelta / budget", () => {
  const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const sendAt = chat.indexOf("  const send = async (");
  assert.ok(sendAt > 0, "send located");
  const flagAt = chat.indexOf("const combinationPartialModifyTurn =", sendAt);
  assert.ok(flagAt > sendAt, "flag located");
  assert.match(chat.slice(flagAt, flagAt + 200), /isCombinationChoiceTurn\(sessionForTurn\) && isCombinationPartialModifyReply\(trimmed\)/);
  const ternaryRe = /:\s*combinationPartialModifyTurn\s*\?\s*sessionForTurn\s*:\s*applyTripIntentToSession\(trimmed, sessionForTurn\);/;
  const ternary = chat.slice(flagAt, flagAt + 700).match(ternaryRe);
  assert.ok(ternary, "applyTripIntentToSession must be skipped on the flag");
  const ternaryEnd = flagAt + ternary.index + ternary[0].length;
  const branchAt = chat.indexOf("if (combinationPartialModifyTurn) {", flagAt);
  const deltaAt = chat.indexOf("parsePlanningConstraintDelta({", sendAt);
  const budgetAt = chat.indexOf("if (isBudgetRefinementText(trimmed)) {", sendAt);
  const planningMergeAt = chat.indexOf("mergeTripPlanningContext(trimmed, nextSession, merged.context)", sendAt);
  assert.ok(branchAt > flagAt && branchAt < deltaAt && branchAt < budgetAt && branchAt < planningMergeAt, `order flag=${flagAt} branch=${branchAt} delta=${deltaAt} budget=${budgetAt} planningMerge=${planningMergeAt}`);
  const body = chat.slice(branchAt, chat.indexOf("\n    }\n", branchAt));
  assert.match(body, /processAdviceTurn\(trimmed, nextSession, merged\.context, undefined, locale\)/);
  assert.match(body, /await completeAdviceTurn\(adviceTurn, nextSession, merged\.context, next\);\s*return;/);
  assert.doesNotMatch(body, /applyTripIntentToSession|parsePlanningConstraintDelta|applyBudgetRefinementToSession|tripDays/);
  // Between flag and branch: no other trip-intent / constraint helper writes the session.
  const between = chat.slice(ternaryEnd, branchAt);
  assert.doesNotMatch(between, /applyTripIntentToSession\(|parsePlanningConstraintDelta\(/, "a trip-intent / constraint call sits between flag and branch");
  assert.match(between, /mergeTravelContext\(nextSession, trimmed, lastAssistantReply\)/, "merge reads the unchanged nextSession");
  // The only gate between flag and branch that resets planning on text:
  assert.match(between, /if \(isReplanIntent\(trimmed\)\)/);
});

await check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

out("\n================ SAMPLES ================");
for (const l of SAMPLES) out("  " + l);
out("=========================================\n");

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS combination partial-modify: follow-up, original follow-ups, Create-it-for-me, counter-examples, send() order");
process.exit(0);
