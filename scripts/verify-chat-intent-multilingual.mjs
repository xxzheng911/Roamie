/**
 * TS-CHAT-L10N-A — the replies our copy asks en / ja / ko users to send are actually understood.
 *
 *  1. add-all (isAddAllToTripIntent): positive / negative corpora per locale; pasted closing
 *     sentences never count.
 *  2. select-all combinations (isUserAllOrAutoCombinationReply + resolveSelectedCombinations):
 *     all / すべて / 전부 select everything; "all good but change day 2" never does.
 *     Then end-to-end through processAdviceTurn with Discovery-created offers (mocked search).
 *  3. Copy ↔ parser: every reply our en/ja/ko copy tells the user to send (Nudge / Required /
 *     day-plan hint / A-B / bare-number examples / “Create it for me” button) is recognized.
 *  4. _app.chat.tsx send(): every text gate that runs before `isAddAllToTripIntent` (~L11880)
 *     treats "add them all" / "すべて追加" / "전부 추가" exactly like the zh control "加入全部",
 *     and the source order is pinned so a new earlier gate is noticed.
 *  5. zh rules = HEAD: a zh corpus is evaluated on the HEAD snapshot (`--zh-only` child run)
 *     and compared result-by-result.
 *
 * fetch is stubbed (0 calls); Places search is a mock.
 * Run: npx vite-node scripts/verify-chat-intent-multilingual.mjs --config scripts/vite.verify.config.mjs
 *      (add `-- --head-dir=<snapshot>` to reuse a scripts/verify-rel1-head-snapshot.mjs snapshot)
 */
import "./verify-netguard-full.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const ZH_ONLY = argv.includes("--zh-only");
const headDirArg = argv.find((a) => a.startsWith("--head-dir="))?.slice("--head-dir=".length);

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
let fetchCalls = 0;
globalThis.fetch = async (...args) => {
  fetchCalls++;
  throw new Error("NO_NETWORK in verify: " + String(args[0]));
};
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const addAll = await load("src/lib/ai/parse-add-all-to-trip-intent.ts");
const combos = await load("src/lib/ai/destination-combination-suggestions.ts");
const acceptPrev = await load("src/lib/ai/accept-previous-suggestions-intent.ts");
const contextIntent = await load("src/lib/ai/chat-context-intent.ts");

// ------------------------------------------------------------------ zh corpus (HEAD parity)
const ZH_CORPUS = [
  "加入全部", "全部加入", "都加入", "幫我加入", "建立行程", "生成行程", "加進全部", "全部加進", "都加進",
  "幫我加進", "加進行程", "全部加進行程", "加入全部吧", "幫我把這些加入全部", "建立3天行程", "生成京都行程",
  "不要加入全部", "先不要全部加入", "全部都不要", "加入全部景點到明天的行程裡面好嗎",
  "都可以", "都不錯", "全部", "全選", "都要", "全部都要", "3組都要", "混搭", "幫我生成", "可以幫我生成",
  "幫我排", "就這些", "沒問題", "好", "全部，也想去鎌倉", "那就幫我生成", "Roamie幫我安排", "第1組", "1、3",
  "1和3", "都不錯但第二天改一下",
];
/** Han-only strings shared with the new ja rules: reported (not asserted) when they differ from HEAD. */
const SHARED_HAN_CORPUS = ["全部追加", "全部追加します", "全部で", "全部 お願いします", "全て", "全部追加して"];
function zhResults(list = [...ZH_CORPUS, ...SHARED_HAN_CORPUS]) {
  const r = {};
  for (const t of list) {
    r[t] = {
      addAll: addAll.isAddAllToTripIntent(t),
      allOrAuto: combos.isUserAllOrAutoCombinationReply(t),
      soft: combos.isSoftAcceptAllCombinationsReply(t),
      selected: combos.resolveSelectedCombinations("京都", t)?.indexes ?? null,
      create: contextIntent.isCreateItineraryIntent(t),
    };
  }
  return r;
}
if (ZH_ONLY) {
  out("@@ZH_JSON@@" + JSON.stringify({ results: zhResults(), fetchCalls }) + "@@END@@");
  process.exit(0);
}

if (argv.includes("--nextstep-probe")) {
  // Reproduces scripts/verify-itinerary-next-step.mjs:34 (zh, no locale argument) on whichever tree runs it.
  const pq = await load("src/lib/ai/destination-pending-question.ts");
  const ctx = { interests: [], destination: "釜山", destinationCountry: "韓國", days: 5, conversationState: "ready_for_itinerary", tripPurpose: "ready_for_itinerary", selectedInterests: ["attractions", "food"] };
  const reply = pq.buildNextStepAfterAdviceSelection("full_itinerary", pq.pendingQuestionForItineraryAction("釜山", "韓國"), ctx).reply;
  out("@@NEXTSTEP@@" + JSON.stringify({ reply, matchesLine34: /釜山 5 天節奏/.test(reply) }));
  process.exit(0);
}

// Evaluate before any Discovery runs below (Discovery caches combinations for 京都).
const ZH_NOW = zhResults();

const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => out(`PASS ${name}`),
      (error) => {
        failures.push(name);
        out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`);
      },
    );
}

const { chatRuntimeMessages } = await load("src/lib/i18n/chat-runtime.ts");
const { chatRuntimeCopy } = await load("src/lib/chat-runtime-copy.ts");
const tripStyle = await load("src/lib/ai/ai-trip-style.ts");
const pendingQ = await load("src/lib/ai/destination-pending-question.ts");
const bare = await load("src/lib/ai/bare-number-reply.ts");
const shortcut = await load("src/lib/chat-shortcut-chips.ts");

// ------------------------------------------------------------------ 1. add-all corpora
const ADD_ALL_POS = {
  en: ["add them all", "Add them all.", "add them all!", "Add them all to my trip", "add them all to the itinerary", "please add all of them", "add all", "Add everything", "add these all", "add them all please"],
  ja: ["すべて追加", "すべて追加して", "全て追加してください", "全部追加します", "ぜんぶ追加お願いします", "すべて旅程に追加", "旅程にすべて追加して", "すべて 追加。"],
  ko: ["전부 추가", "전부 추가해", "전부 추가해 주세요", "다 추가해줘", "모두 추가해요", "일정에 전부 추가", "전부 일정에 추가할게요", "전부 추가!"],
};
const ADD_ALL_NEG = {
  en: ["don't add them all", "do not add them all", "Don’t add them all", "add them all except the museum", "add them all tomorrow", "I don't want to add them all", "add them", "all good", "add the first one"],
  ja: ["すべて追加しないで", "すべて追加しないでください", "全部は追加しない", "すべて追加するのはやめて", "一つだけ追加", "すべて"],
  ko: ["전부 추가하지 마", "전부 추가하지 마세요", "전부 추가 안 해", "하나만 추가", "전부 추가하지 말아 줘", "전부"],
};

await check("add-all: en / ja / ko positives are recognized", () => {
  const missed = [];
  for (const [locale, list] of Object.entries(ADD_ALL_POS)) for (const t of list) if (!addAll.isAddAllToTripIntent(t)) missed.push(`${locale} "${t}"`);
  assert.deepEqual(missed, []);
});
await check("add-all: en / ja / ko negatives (negation, partial, extra clauses) are rejected", () => {
  const wrong = [];
  for (const [locale, list] of Object.entries(ADD_ALL_NEG)) for (const t of list) if (addAll.isAddAllToTripIntent(t)) wrong.push(`${locale} "${t}"`);
  assert.deepEqual(wrong, []);
});
await check("add-all: en / ja / ko closing sentences pasted back whole are not add-all", () => {
  const wrong = [];
  // zh-TW is HEAD behaviour (checked by the HEAD parity check below; 「有想加進行程的跟我說。」 already
  // matched the HEAD loose rule), so only the new en / ja / ko rules are asserted here.
  for (const locale of ["en", "ja", "ko"]) {
    const lines = [
      tripStyle.dayPlanSummaryAddHintForLocale(locale),
      chatRuntimeCopy("alternativeSummaryFooter", locale),
      chatRuntimeCopy("combinationNext", locale),
      chatRuntimeCopy("combinationSelectionNudge", locale),
      chatRuntimeCopy("combinationSelectionRequired", locale),
      chatRuntimeCopy("combinationAllLockedGenerate", locale, { destination: "Kyoto", days: 3 }),
    ];
    for (const l of lines) if (addAll.isAddAllToTripIntent(l)) wrong.push(`${locale}: ${l}`);
  }
  assert.deepEqual(wrong, []);
});

// ------------------------------------------------------------------ 2. select-all
const ALL_POS = {
  en: ["all", "All", "all of them", "everything", "All.", "all please"],
  ja: ["すべて", "全て", "全部", "全部で", "すべてお願いします", "すべて。"],
  ko: ["전부", "모두", "다", "전부 다", "전부요", "모두요"],
};
const ALL_NEG = {
  en: ["all good but change day 2", "all good", "not all", "all except 2", "allergy friendly", "all the museums", "small"],
  ja: ["すべて良いけど2日目を変えて", "すべてではない", "全部じゃなくて1だけ"],
  ko: ["전부 좋은데 2일차는 바꿔 줘", "전부는 아니고 1번만", "다음"],
};
await check("select-all: all / すべて / 전부 variants select every combination", () => {
  const missed = [];
  const n = combos.getDestinationCombinations("京都").length;
  assert.ok(n >= 2, `京都 combinations ${n}`);
  for (const [locale, list] of Object.entries(ALL_POS)) {
    for (const t of list) {
      const sel = combos.resolveSelectedCombinations("京都", t);
      if (!combos.isUserAllOrAutoCombinationReply(t) || sel?.indexes.length !== n) missed.push(`${locale} "${t}" → ${JSON.stringify(sel?.indexes)}`);
    }
  }
  assert.deepEqual(missed, []);
});
await check("select-all: 'all good but change day 2' and other partial phrases never select all", () => {
  const wrong = [];
  const n = combos.getDestinationCombinations("京都").length;
  for (const [locale, list] of Object.entries(ALL_NEG)) {
    for (const t of list) {
      const sel = combos.resolveSelectedCombinations("京都", t);
      if (combos.isUserAllOrAutoCombinationReply(t) || (sel && sel.indexes.length === n && sel.selectionSource !== "user_indexed")) wrong.push(`${locale} "${t}" → ${JSON.stringify(sel)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

// ------------------------------------------------------------------ 3. copy ↔ parser
function quoted(text) {
  return [...text.matchAll(/[“「"]([^”」"]+)[”」"]/g)].map((m) => m[1]);
}
await check("Nudge / Required: every quoted reply and the example numbers are understood", () => {
  const missed = [];
  const n = combos.getDestinationCombinations("京都").length;
  const every = Array.from({ length: n }, (_, i) => i + 1);
  for (const locale of ["en", "ja", "ko"]) {
    for (const key of ["combinationSelectionNudge", "combinationSelectionNudgeShort", "combinationSelectionRequired"]) {
      const copy = chatRuntimeMessages[locale][key];
      for (const phrase of quoted(copy)) {
        const sel = combos.resolveSelectedCombinations("京都", phrase);
        if (sel?.indexes.length !== n) missed.push(`${locale}.${key} “${phrase}” → ${JSON.stringify(sel?.indexes)}`);
      }
      // "(for example, 1, 3)" / "（例：1、3）" / "(예: 1, 3)": the example must parse to 1 and 3.
      const example = copy.match(/[(（](?:for example, |例：|예: )([^)）]+)[)）]/)?.[1];
      if (!example) missed.push(`${locale}.${key}: no number example`);
      else {
        const idx = combos.resolveSelectedCombinations("京都", example)?.indexes;
        if (JSON.stringify(idx) !== JSON.stringify([0, 2].filter((i) => i < n))) missed.push(`${locale}.${key} example "${example}" → ${JSON.stringify(idx)}`);
      }
      // "every number" → all combinations.
      if (/every number|すべての番号|모든 번호/.test(copy)) {
        const sep = locale === "ja" ? "、" : ", ";
        const sel = combos.resolveSelectedCombinations("京都", every.join(sep));
        if (sel?.indexes.length !== n) missed.push(`${locale}.${key} every number "${every.join(sep)}" → ${JSON.stringify(sel?.indexes)}`);
      }
    }
  }
  assert.deepEqual(missed, []);
});

await check("“Create it for me” button: copy names the real chip label; chip routes to generation", () => {
  const bad = [];
  for (const locale of ["en", "ja", "ko"]) {
    const copy = chatRuntimeMessages[locale].combinationAllLockedGenerate;
    const label = shortcut.chatShortcutLabel("幫我生成", locale);
    if (!quoted(copy).includes(label)) bad.push(`${locale}: copy ${JSON.stringify(quoted(copy))} vs chip "${label}"`);
    const contract = shortcut.chatShortcutContract("幫我生成", locale);
    if (contract.canonicalIntent !== "generate_itinerary" || contract.routingPayload !== "幫我生成") bad.push(`${locale}: contract ${JSON.stringify(contract)}`);
  }
  // The chip only renders when the pending options carry the zh payload (_app.chat.tsx actionChips).
  const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
  assert.match(chat, /if \(options\.includes\("幫我生成"\)\) chips\.push\("幫我生成"\);/);
  const advice = readFileSync("src/lib/ai/destination-advice.ts", "utf8");
  const at = advice.indexOf('chatRuntimeCopy("combinationAllLockedGenerate"');
  assert.ok(at > 0 && /options: \["幫我生成", "重新選擇組合"\]/.test(advice.slice(at, at + 900)), "locked-all reply must offer the 幫我生成 chip");
  // Routing payload is recognized by the same parsers the zh reply uses.
  assert.equal(combos.isUserAllOrAutoCombinationReply("幫我生成"), true);
  assert.deepEqual(bad, []);
});

await check("day-plan hint: the phrase it suggests (add them all / すべて追加 / 전부 추가) is add-all", () => {
  const phrase = { en: "add them all", ja: "すべて追加", ko: "전부 추가" };
  const missed = [];
  for (const locale of ["en", "ja", "ko"]) {
    const hint = tripStyle.dayPlanSummaryAddHintForLocale(locale);
    if (!hint.includes(phrase[locale])) missed.push(`${locale}: hint does not contain "${phrase[locale]}": ${hint}`);
    if (!addAll.isAddAllToTripIntent(phrase[locale])) missed.push(`${locale}: "${phrase[locale]}" not add-all`);
  }
  assert.deepEqual(missed, []);
});

await check("A / B options and bare-number examples are understood", () => {
  const missed = [];
  for (const t of ["A", "a", "B", "b"]) if (!pendingQ.parseItineraryNextStepSelection(t)) missed.push(`A/B "${t}"`);
  const pending = { pendingQuestion: { type: "ask_days", options: [] } };
  for (const [t, days] of [["3 days", 3], ["5 days", 5], ["3日間", 3], ["5日間", 5], ["3일", 3], ["5일", 5]]) {
    const r = bare.parseTripDaysFromPendingReply(t, pending);
    if (r.days !== days) missed.push(`days "${t}" → ${JSON.stringify(r)}`);
  }
  const r = bare.parseTripDaysFromPendingReply("8/15-8/17", pending);
  if (r.days !== 3) missed.push(`range "8/15-8/17" → ${JSON.stringify(r)}`);
  assert.deepEqual(missed, []);
});

// ------------------------------------------------------------------ 2b. end-to-end combination selection
const sessionMod = await load("src/lib/chat-session.ts");
const travelContext = await load("src/lib/ai/travel-context.ts");
const stateMachine = await load("src/lib/ai/chat-state-machine.ts");
const advice = await load("src/lib/ai/destination-advice.ts");
const globalPlanning = await load("src/lib/ai/global-planning-context.ts");
const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
const poolCache = await load("src/lib/ai/places-cost-cache/candidate-pool-cache.ts");

async function offeredSession(locale) {
  discovery.clearDiscoveredCombinationsCache();
  poolCache.clearCandidatePoolCache();
  const turn = (t, s) => {
    const m = travelContext.mergeTravelContext(s, t);
    return stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
  };
  const persist = (r) =>
    advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: undefined, adviceSelectionThisTurn: undefined }, r.advice);
  let r = turn("12月に日本へ旅行に行きたいです。", sessionMod.createEmptySession());
  let s = { ...r.session, pendingQuestion: r.route?.pendingQuestion };
  s = travelContext.mergeTravelContext(s, "京都").session;
  s = await globalPlanning.resolveGlobalPlanningCandidate(s, locale, async () => ({
    rawResultCount: 1,
    location: { placeId: "ChIJKyotoIntent", country: "JP", city: "京都", region: "京都", lat: 35.01, lng: 135.76, formattedName: "京都", displayLabel: "京都" },
  }));
  r = turn("京都", s);
  s = persist(r);
  const names = ["清水寺", "金閣寺", "銀閣寺", "元離宮二条城", "産寧坂", "二寧坂", "京都博物館", "京都美術館", "歴史博物館", "鉄道博物館", "工芸博物館", "文化博物館", "京都御苑", "都市公園", "植物園", "庭園", "緑地公園", "森林公園"];
  const pool = names.map((name, i) => ({ id: `ChIJIntentPlace${i}`, name, sourceLocale: "ja", lat: 35.01 + i * 0.0003, lng: 135.76, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park", rating: 4.6, userRatingCount: 10000, address: "Kyoto Japan", businessStatus: "OPERATIONAL" }));
  let searchCalls = 0;
  const ready = await discovery.ensureDestinationCombinationsReady({
    destination: "京都", destinationCountry: "JP", locale, days: 4,
    resolvedDestination: { label: "京都", city: "京都", country: "JP", countryCode: "JP", type: "city", latitude: 35.01, longitude: 135.76, placeId: "ChIJKyotoIntent", source: "trip_destination", scopeLocked: false },
    searchPlaces: async () => { searchCalls++; return { places: pool, error: null }; },
  });
  const daysText = { "zh-TW": "4天", en: "4 days", ja: "4日間です。", ko: "4일" }[locale];
  r = turn(daysText, s);
  s = persist(r);
  return { s, ready, searchCalls, reply: r.advice.reply };
}

const PARTIAL = { "zh-TW": "都不錯但第二天改一下", en: "all good but change day 2", ja: "すべて良いけど2日目を変えて", ko: "전부 좋은데 2일차는 바꿔 줘" };
if (argv.includes("--partial-probe")) {
  // Same e2e partial phrase on whichever tree this runs in (used to compare with HEAD).
  const res = {};
  for (const locale of ["zh-TW", "en", "ja", "ko"]) {
    const { s } = await offeredSession(locale);
    const m = travelContext.mergeTravelContext(JSON.parse(JSON.stringify(s)), PARTIAL[locale]);
    const r = stateMachine.processAdviceTurn(PARTIAL[locale], m.session, m.context, undefined, locale);
    res[locale] = { pending: s.pendingQuestion?.type, selected: r.session.travelContext?.selectedCombinationIds, days: r.session.travelContext?.days, trigger: Boolean(r.advice.triggerItineraryGeneration) };
  }
  out("@@PARTIAL@@" + JSON.stringify(res));
  process.exit(0);
}
for (const locale of ["en", "ja", "ko"]) {
  const { s, ready, searchCalls, reply } = await offeredSession(locale);
  await check(`${locale}: e2e combination_choice — all-word selects all, partial phrase does not, numbers select subset`, () => {
    assert.equal(ready.ok, true, "discovery ready");
    assert.ok(searchCalls >= 1, "mock search used");
    assert.equal(s.pendingQuestion?.type, "combination_choice", `pending after days: ${s.pendingQuestion?.type}\n${reply}`);
    const offered = s.travelContext?.offeredCombinations?.length ?? 0;
    assert.ok(offered >= 2, `offered ${offered}`);
    const run = (t) => {
      const restored = JSON.parse(JSON.stringify(s));
      const m = travelContext.mergeTravelContext(restored, t);
      return stateMachine.processAdviceTurn(t, m.session, m.context, undefined, locale);
    };
    const allWord = { en: "all", ja: "すべて", ko: "전부" }[locale];
    const all = run(allWord);
    const allIds = all.session.travelContext?.selectedCombinationIds ?? [];
    assert.equal(allIds.length, offered, `"${allWord}" → selected ${JSON.stringify(allIds)} reply=${all.advice.reply}`);
    const partial = { en: "all good but change day 2", ja: "すべて良いけど2日目を変えて", ko: "전부 좋은데 2일차는 바꿔 줘" }[locale];
    const p = run(partial);
    const pIds = p.session.travelContext?.selectedCombinationIds ?? [];
    assert.ok(pIds.length < offered, `"${partial}" must not select all: ${JSON.stringify(pIds)}`);
    const one = run(locale === "ja" ? "1、2" : "1, 2");
    assert.deepEqual(one.session.travelContext?.selectedCombinationIds, [1, 2], `numbers → ${JSON.stringify(one.session.travelContext?.selectedCombinationIds)}`);
    out(`  ${locale}: offered=${offered} all→${JSON.stringify(allIds)} trigger=${Boolean(all.advice.triggerItineraryGeneration)} partial→${JSON.stringify(pIds)} partialTrigger=${Boolean(p.advice.triggerItineraryGeneration)} partialReply=${JSON.stringify(p.advice.reply?.slice(0, 120))}`);
  });
}

// ------------------------------------------------------------------ 4. send() gates before isAddAllToTripIntent
const planningSelection = await load("src/lib/planning-selection.ts");
const nearbyClar = await load("src/lib/ai/nearby-location-clarification.ts");
const budget = await load("src/lib/ai/budget-refinement.ts");
const tripPlanningCtx = await load("src/lib/ai/trip-planning-context.ts");
const dateConfirm = await load("src/lib/ai/trip-date-confirmation.ts");
const planningState = await load("src/lib/ai/chat-planning-state.ts");
const placeDetail = await load("src/lib/ai/place-detail-chat.ts");
const constraints = await load("src/lib/ai/planning-conversation-constraints.ts");
const numericAuth = await load("src/lib/ai/numeric-selection-authority.ts");
const handoff = await load("src/lib/ai/generated-plan-handoff.ts");

const shownCandidates = ["Kinkaku-ji", "Kiyomizu-dera", "Nishiki Market"].map((name, i) => ({
  id: `ChIJGate${i}`, placeId: `ChIJGate${i}`, googlePlaceId: `ChIJGate${i}`, name, placeName: name, lat: 35 + i * 0.01, lng: 135.7, address: "Kyoto",
}));
const baseSession = {
  ...sessionMod.createEmptySession(),
  travelContext: { interests: [], destination: "京都", days: 3 },
  tripDays: 3,
  recommendedPlaces: shownCandidates,
};
function gates(text) {
  const merged = travelContext.mergeTravelContext(baseSession, text);
  const delta = constraints.parsePlanningConstraintDelta({ text, shownCandidates, authoritativeDestination: "京都" });
  const req0 = constraints.resolvePlanningContextRequirement({ text, delta, candidateCount: 0, destinationDetected: true, durationOrDateDetected: true });
  const req3 = constraints.resolvePlanningContextRequirement({ text, delta, candidateCount: shownCandidates.length, destinationDetected: true, durationOrDateDetected: true });
  return {
    switchState: tripPlanningCtx.classifyDestinationSwitchTurn(text).state, // L8746
    repeatedDate: dateConfirm.isRepeatedTripDateConfirmation(baseSession, text), // L8747
    numericReject: numericAuth.rejectNumericSelection(baseSession, text), // L9588
    explicitCreate: handoff.isExplicitTripCreationTurn(text) || sessionMod.isUserConfirmingItinerary(text), // L9597 (marks only)
    selectionGenerate: /^(?:生成行程|生成完整行程|幫我生成)$/.test(text), // L9634
    selectionContinuation: planningSelection.isPlanningSelectionContinuation(text), // L9694
    explicitNearby: Boolean(nearbyClar.resolveExplicitNearbyIntent(text)), // L10202
    refresh: /^(重新整理推薦|重新整理)$/.test(text), // L10231
    regen: /^(重新生成|再生成一次|再試一次|重試)$/.test(text), // L10321
    selectionNamesPlace: planningSelection.planningSelectionTurnNamesPlace?.(text) ?? false, // L10637
    placeDetailFollowUp: placeDetail.parsePlaceDetailFollowUp(text), // L10696 (only when detail chat active)
    placeDetailNearby: Boolean(placeDetail.resolvePlaceDetailNearbyIntent(text)),
    replan: planningState.isReplanIntent(text), // L11313
    destinationAfterMerge: merged.context.destination, // L11402 / L11552 / L11675
    destinationCandidatePending: merged.context.destinationCandidate?.status === "pending",
    destinationClarification: Boolean(merged.context.destinationClarification),
    budget: budget.isBudgetRefinementText(text), // L11574
    tripStyleSelection: tripStyle.parseAskTripStyleSelection(text), // L11671
    unresolvedNoCandidates: req0.requiresCandidateContext, // L11726 with 0 shown candidates
    unresolvedWithCandidates: req3.requiresCandidateContext && shownCandidates.length === 0,
    acceptRemaining: delta.acceptRemainingCandidates,
    styleReselect: Boolean(planningState.isStyleReselectTurn(text, baseSession, merged.context)), // L11828
    stylePlan: Boolean(planningState.shouldTriggerTripStylePlanning(text, baseSession, merged.context)), // L11855
    addAll: addAll.isAddAllToTripIntent(text), // L11880
  };
}
await check("send(): every gate before L11880 treats add-all phrases like the zh control 加入全部", () => {
  const control = gates("加入全部");
  assert.equal(control.addAll, true);
  assert.equal(control.switchState, "NO_SWITCH");
  const diffs = [];
  for (const t of ["add them all", "Add them all to my trip", "すべて追加", "全部追加してください", "전부 추가", "전부 추가해 주세요"]) {
    const g = gates(t);
    for (const [k, v] of Object.entries(g)) {
      if (JSON.stringify(v) !== JSON.stringify(control[k])) diffs.push(`"${t}" ${k}: ${JSON.stringify(v)} (zh control ${JSON.stringify(control[k])})`);
    }
  }
  out(`  zh control gate vector: ${JSON.stringify(control)}`);
  assert.deepEqual(diffs, []);
});

await check("send(): source order — isAddAllToTripIntent still sits after the gates exercised above", () => {
  const chat = readFileSync("src/routes/_app.chat.tsx", "utf8");
  const sendAt = chat.indexOf("  const send = async (");
  const addAt = chat.indexOf("isAddAllToTripIntent(trimmed)", sendAt);
  assert.ok(sendAt > 0 && addAt > sendAt, "send / add-all located");
  const markers = [
    "classifyDestinationSwitchTurn(trimmed)",
    "isRepeatedTripDateConfirmation(session, trimmed)",
    "rejectNumericSelection(session, trimmed)",
    "/^(?:生成行程|生成完整行程|幫我生成)$/.test(trimmed)",
    "isPlanningSelectionContinuation(trimmed)",
    "resolveExplicitNearbyIntent(trimmed)",
    "isPlaceDetailChatActive(session)",
    "isReplanIntent(trimmed)",
    "isBudgetRefinementText(trimmed)",
    "parseAskTripStyleSelection(trimmed)",
    "parsePlanningConstraintDelta({",
    "isStyleReselectTurn(trimmed, nextSession, merged.context)",
    "shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context)",
  ];
  for (const m of markers) {
    const at = chat.indexOf(m, sendAt);
    assert.ok(at > 0 && at < addAt, `gate "${m}" must be inside send() before add-all (at=${at}, addAll=${addAt})`);
  }
  // Text-matching helpers called between the last pinned gate and add-all (new interceptors would show up here).
  const tail = chat.slice(chat.indexOf(markers.at(-1), sendAt), addAt);
  const calls = [...new Set([...tail.matchAll(/\b((?:is|should|parse|resolve|match)[A-Z]\w*)\(trimmed/g)].map((m) => m[1]))];
  assert.deepEqual(calls, ["shouldTriggerTripStylePlanning"], `unexpected text gate(s) before add-all: ${calls.join(", ")}`);
});

// ------------------------------------------------------------------ 5. zh = HEAD
function ensureHeadDir() {
  let dir = headDirArg;
  if (!dir) {
    dir = join(mkdtempSync(join(tmpdir(), "roamie-head-")), "head");
    const r = spawnSync(process.execPath, ["scripts/verify-rel1-head-snapshot.mjs", `--dest=${dir}`], { encoding: "utf8", timeout: 240_000 });
    if (r.status !== 0) throw new Error(`snapshot failed: ${r.stderr || r.stdout}`);
  }
  const self = "scripts/verify-chat-intent-multilingual.mjs";
  if (!existsSync(join(dir, self)) || readFileSync(join(dir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(dir, self));
  return dir;
}
await check(`zh corpus (${ZH_CORPUS.length}): add-all / select-all / create results equal HEAD`, () => {
  const dir = ensureHeadDir();
  assert.ok(!readFileSync(join(dir, "src/lib/ai/parse-add-all-to-trip-intent.ts"), "utf8").includes("ADD_ALL_TO_TRIP_EN_RE"), "snapshot must be HEAD");
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx",
    ["vite-node", "scripts/verify-chat-intent-multilingual.mjs", "--config", "scripts/vite.verify.config.mjs", "--", "--zh-only"],
    { cwd: dir, encoding: "utf8", timeout: 300_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@ZH_JSON@@([\s\S]*?)@@END@@/);
  assert.ok(m, `HEAD child produced no JSON (status ${r.status}): ${(r.stderr ?? "").slice(-1500)}`);
  const head = JSON.parse(m[1]);
  assert.equal(head.fetchCalls, 0);
  const now = ZH_NOW;
  const diffs = [];
  // 「全部都不要」: approved spec change (M2) — reject-all instead of HEAD's select-all; the add-all /
  // create readings stay HEAD's. Every other zh string must equal HEAD.
  const SPEC_CHANGED = { "全部都不要": { ...head.results["全部都不要"], allOrAuto: false, soft: false, selected: null } };
  for (const t of ZH_CORPUS) {
    const want = SPEC_CHANGED[t] ?? head.results[t];
    if (JSON.stringify(now[t]) !== JSON.stringify(want)) diffs.push(`"${t}" EXPECTED=${JSON.stringify(want)} HEAD=${JSON.stringify(head.results[t])} NOW=${JSON.stringify(now[t])}`);
  }
  for (const t of SHARED_HAN_CORPUS) {
    if (JSON.stringify(now[t]) !== JSON.stringify(head.results[t])) out(`  NOTE Han string shared with ja rules changed: "${t}" HEAD=${JSON.stringify(head.results[t])} NOW=${JSON.stringify(now[t])}`);
  }
  assert.deepEqual(diffs, []);
});

await check("no network: fetch never called", () => assert.equal(fetchCalls, 0));

if (failures.length) {
  out(`FAIL ${failures.length} check(s): ${failures.join(" | ")}`);
  process.exit(1);
}
out("PASS chat intent multilingual: add-all, select-all, copy↔parser, send() gate order, zh = HEAD");
process.exit(0);
