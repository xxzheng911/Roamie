/**
 * KIJ2-J — localized "Mix / you decide" = all combinations; day-follow-up copy actions are valid.
 *  A. isUserAllOrAutoCombinationReply: ≥10 positives and ≥10 negatives per locale (negatives include
 *     the word inside a longer sentence, negation, partial picks).
 *  B. End-to-end (send() pipeline as in verify-combination-date-correction): on an offered Sydney
 *     combination list, every action named by the new copy (numbers, “all”/「すべて」/“전부”/「可以幫我生成」,
 *     mix wording, the ref-day confirm reply) really does what the copy says.
 *  C. en copy: straight vs curly apostrophes / quotes (workspace vs HEAD snapshot).
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-kij2-j-mix-and-day-copy.mjs -- --head-dir=<snap-HEAD>
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 280_000).unref();
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error("NO_NETWORK"); };
const headDir = process.argv.slice(2).find((a) => a.startsWith("--head-dir="))?.slice(11);

const failures = [];
const infos = [];
async function check(name, fn) {
  try { await fn(); out(`PASS ${name}`); } catch (error) { failures.push(name); out(`FAIL ${name}\n  ${String(error?.message ?? error).split("\n").join("\n  ")}`); }
}
const load = (p) => import(/* @vite-ignore */ `/${p}`);

const CHILD = process.argv.includes("--child");
const sugg = await load("src/lib/ai/destination-combination-suggestions.ts");
const { chatRuntimeMessages } = await load("src/lib/i18n/chat-runtime.ts");

// ---------------------------------------------------------------- A. classification tables
const MIX = {
  "zh-TW": {
    pos: ["混搭", "混搭全部", "都可以", "全部", "全部都要", "都要", "你決定", "幫我混搭", "全選", "隨便你排", "都不錯"],
    neg: ["不要混搭", "第一組和第三組混搭", "混搭風格的咖啡廳", "1和3混搭", "第2組", "都不錯但第二天改一下", "我想要混搭第二天", "不用全部", "全部都不要", "改去京都", "混搭一下第二組和第三組就好"],
  },
  en: {
    pos: ["mix", "Mix", "mix them", "Mix them, please", "mix it up", "mix them all", "mix all", "Mix all of them!", "you decide", "You decide.", "just mix", "either is fine", "any is fine", "all", "all of them", "everything"],
    neg: ["mix of museums and parks", "can you mix day 2 and day 3?", "I don't want to mix", "Don't mix them", "mix 1 and 3", "you decide day 2", "a mix of food and shopping please", "not all", "all good but change day 2", "mix up the order of day 1", "I'll decide later", "remix", "everything except 2"],
  },
  ja: {
    pos: ["ミックス", "ミックスで", "ミックスでお願いします", "混ぜて", "混ぜてください", "おまかせ", "おまかせで", "おまかせします", "お任せで", "お任せでお願いします", "すべて", "全部", "全部で", "全て"],
    neg: ["ミックスジュースが飲みたい", "1と3をミックスして", "ミックスしないで", "混ぜないで", "2日目はおまかせ", "おまかせコースのレストラン", "全部じゃなくて1だけ", "すべて良いけど2日目を変えて", "ミックスナッツ", "2番", "全部はいらない"],
  },
  ko: {
    pos: ["섞어", "섞어줘", "섞어 줘", "섞어 주세요", "섞어요", "믹스", "믹스로", "믹스해줘", "알아서", "알아서 해줘", "알아서 해 주세요", "전부", "모두", "다", "전부 다"],
    neg: ["섞지 마", "1번이랑 3번 섞어줘", "알아서 2일차만 바꿔줘", "믹스커피 파는 곳", "다 좋은데 2일차 바꿔줘", "섞어서 2개만", "전부는 아니고 1번", "다음에", "2번", "믹스 안 해", "모두 별로예요"],
  },
};
const EXTRA_INFO_TEXTS = ["mix them up", "mix and match", "let's mix", "Mix please!", "your choice", "ミックスしてください", "おまかせでいいです", "섞어서 해줘", "알아서 해"];
const quoteStats = (msgs) => {
  const vals = Object.values(msgs).join("\n");
  return { straightApos: (vals.match(/[A-Za-z]'[A-Za-z]/g) ?? []).length, curlyApos: (vals.match(/[A-Za-z]’[A-Za-z]/g) ?? []).length, straightDq: (vals.match(/"/g) ?? []).length, curlyDq: (vals.match(/[“”]/g) ?? []).length };
};
if (CHILD) {
  const cls = {};
  for (const { pos, neg } of Object.values(MIX)) for (const t of [...pos, ...neg, ...EXTRA_INFO_TEXTS]) cls[t] = sugg.isUserAllOrAutoCombinationReply(t);
  for (const t of EXTRA_INFO_TEXTS) cls[t] = sugg.isUserAllOrAutoCombinationReply(t);
  out("@@J_JSON@@" + JSON.stringify({ cls, quotes: quoteStats(chatRuntimeMessages.en) }) + "@@END@@");
  process.exit(0);
}
const partial = await load("src/lib/ai/combination-partial-modify-reply.ts");
let HEAD = null;
if (headDir) {
  const { spawnSync } = await import("node:child_process");
  const { copyFileSync } = await import("node:fs");
  const self = "scripts/verify-kij2-j-mix-and-day-copy.mjs";
  copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 200_000, maxBuffer: 32 << 20 });
  const m = (r.stdout ?? "").match(/@@J_JSON@@([\s\S]*?)@@END@@/);
  HEAD = m ? JSON.parse(m[1]) : null;
  if (!HEAD) out(`INFO HEAD child failed: ${(r.stdout ?? "").slice(-500)} ${(r.stderr ?? "").slice(-800)}`);
}
const headSays = (t) => (HEAD ? ` (HEAD=${HEAD.cls[t]})` : "");
for (const [locale, { pos, neg }] of Object.entries(MIX)) {
  await check(`[${locale}] ≥10 positives / ≥10 negatives in the table`, () => { assert.ok(pos.length >= 10 && neg.length >= 10); });
  if (locale === "zh-TW") {
    // zh-TW is outside J (LOCALIZED_MIX_COMBINATIONS_RE is en / ja / ko): no change vs HEAD allowed;
    // expectation mismatches are reported as INFO (pre-existing HEAD behaviour).
    // 「全部都不要」: approved spec change (M2) — HEAD read it as select-all; it now rejects every
    // combination (isRejectAllCombinationsReply) and selects none. Every other zh string stays = HEAD.
    const SPEC_CHANGED = { "全部都不要": false };
    await check(`[zh-TW] 「全部都不要」 is reject-all, never select-all (approved spec)`, () => {
      assert.equal(sugg.isUserAllOrAutoCombinationReply("全部都不要"), false);
      assert.equal(sugg.isRejectAllCombinationsReply?.("全部都不要"), true);
      assert.deepEqual(sugg.parseCombinationSelectionIndices("全部都不要", 3), []);
    });
    if (HEAD) {
      await check(`[zh-TW] classification identical to HEAD (out of J scope; approved spec changes excepted)`, () => {
        const diff = [...pos, ...neg].filter((t) => sugg.isUserAllOrAutoCombinationReply(t) !== (t in SPEC_CHANGED ? SPEC_CHANGED[t] : HEAD.cls[t]));
        assert.deepEqual(diff, []);
      });
    }
    const posMiss = pos.filter((t) => !sugg.isUserAllOrAutoCombinationReply(t)).map((t) => t + headSays(t));
    const negHit = neg.filter((t) => sugg.isUserAllOrAutoCombinationReply(t)).map((t) => t + headSays(t));
    infos.push(`zh-TW pre-existing: positives not recognised [${posMiss.join(", ")}]; negatives read as ALL [${negHit.join(", ")}]`);
    continue;
  }
  await check(`[${locale}] positives select all combinations`, () => {
    const bad = pos.filter((t) => !sugg.isUserAllOrAutoCombinationReply(t)).map((t) => t + headSays(t));
    assert.deepEqual(bad, []);
  });
  await check(`[${locale}] negatives (in-sentence / negated / partial) are NOT all-combinations`, () => {
    const bad = neg.filter((t) => sugg.isUserAllOrAutoCombinationReply(t)).map((t) => t + headSays(t));
    assert.deepEqual(bad, []);
  });
}
if (HEAD) {
  const changed = Object.entries(HEAD.cls).filter(([t, h]) => sugg.isUserAllOrAutoCombinationReply(t) !== h).map(([t, h]) => `${t}: HEAD=${h} WORK=${!h}`);
  infos.push(`classification changed vs HEAD (${changed.length}): ${changed.join(" | ")}`);
}
// Observation only: plausible en / ja / ko phrasings outside the whole-message list.
infos.push("not recognised (INFO): " + EXTRA_INFO_TEXTS.map((t) => `${t}=${sugg.isUserAllOrAutoCombinationReply(t)}`).join(", "));

// ---------------------------------------------------------------- B. end-to-end actions
const sessionMod = await load("src/lib/chat-session.ts");
const travelContext = await load("src/lib/ai/travel-context.ts");
const stateMachine = await load("src/lib/ai/chat-state-machine.ts");
const advice = await load("src/lib/ai/destination-advice.ts");
const globalPlanning = await load("src/lib/ai/global-planning-context.ts");
const discovery = await load("src/lib/ai/destination-combination-discovery.ts");
const poolCache = await load("src/lib/ai/places-cost-cache/candidate-pool-cache.ts");
const tripIntent = await load("src/lib/recommendation/trip-intent.ts");
const convState = await load("src/lib/ai/chat-conversation-state.ts");
const planningState = await load("src/lib/ai/chat-planning-state.ts");
const countryNorm = await load("src/lib/ai/destination-country-normalize.ts");

const SYD = { lat: -33.8688, lng: 151.2093 };
const geocode = async (q) => (/sydney|雪梨|シドニー|시드니/i.test(q)
  ? { rawResultCount: 1, location: { placeId: "ChIJ_AU_Sydney", country: countryNorm.normalizeCountryReference("Australia", "AU").country, city: "Sydney", region: "New South Wales", lat: SYD.lat, lng: SYD.lng, formattedName: "Sydney", displayLabel: "Sydney" } }
  : { rawResultCount: 0, location: null });
const pool = () => Array.from({ length: 18 }, (_, i) => ({
  id: `ChIJAUPlace${i}`, name: `Sydney ${["Temple", "Tower", "Market", "Garden", "Museum", "Bridge"][i % 6]} ${i + 1}`, sourceLocale: "en",
  lat: SYD.lat + i * 0.0003, lng: SYD.lng, types: [i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park"], primaryType: i < 6 ? "tourist_attraction" : i < 12 ? "museum" : "park",
  rating: 4.6, userRatingCount: 10000, address: "Sydney NSW, Australia", businessStatus: "OPERATIONAL",
}));
const clone = (v) => JSON.parse(JSON.stringify(v));
async function sendTurn(s0, t, locale) {
  const s = clone(s0);
  const lastReply = s.lastAssistantReply;
  const flag = partial.isCombinationChoiceTurn(s) && (partial.isCombinationPartialModifyReply(t) || partial.isCombinationHoldReply(t));
  let n = flag ? s : tripIntent.applyTripIntentToSession(t, s);
  n = convState.prepareSessionForUserTurn(n, lastReply);
  if (planningState.isReplanIntent(t) && !flag) n = planningState.resetChatPlanningForReplan(n, "user_replan_intent");
  const m = travelContext.mergeTravelContext(n, t, lastReply);
  let session = m.session; let ctx = m.context;
  if (ctx.destinationCandidate?.status === "pending") { session = await globalPlanning.resolveGlobalPlanningCandidate(session, locale, geocode); ctx = session.travelContext ?? ctx; }
  const days = ctx.days ?? session.tripDays;
  if (!flag && !(ctx.destinationClarification || (ctx.destinationCandidate && ctx.destinationCandidate.status !== "resolved")) && ctx.destination && days) {
    await discovery.ensureDestinationCombinationsReady({
      destination: ctx.destination, destinationCountry: ctx.destinationCountryCode ?? ctx.destinationCountry, locale, days,
      resolvedDestination: ctx.destinationCoordinates ? { label: ctx.destination, city: ctx.destinationCity ?? ctx.destination, country: ctx.destinationCountryCode ?? ctx.destinationCountry, countryCode: ctx.destinationCountryCode, type: ctx.destinationType ?? "city", latitude: ctx.destinationCoordinates.lat, longitude: ctx.destinationCoordinates.lng, placeId: session.tripDestination?.placeId, source: "trip_destination", scopeLocked: false } : undefined,
      searchPlaces: async () => ({ places: pool(), error: null }),
    }).catch(() => null);
  }
  const r = stateMachine.processAdviceTurn(t, session, ctx, undefined, locale);
  const next = advice.applyAdviceResultToSession({ ...r.session, pendingQuestion: r.route?.pendingQuestion, lastResolvedPendingQuestion: r.session.lastResolvedPendingQuestion, adviceSelectionThisTurn: undefined, lastAssistantReply: r.advice.reply ?? lastReply }, r.advice);
  return { r, s: next };
}
const view = (turn) => {
  const tc = turn.s.travelContext ?? {};
  return {
    pending: turn.s.pendingQuestion?.type ?? null, confirmTitles: turn.s.pendingQuestion?.confirmCombinationTitles ?? null,
    selected: tc.selectedCombinationIds ?? [], offered: (tc.offeredCombinations ?? []).map((c) => c.id),
    action: turn.r.advice?.action ?? turn.r.advice?.nextAction ?? null, shouldGenerate: turn.r.advice?.shouldGenerateItinerary ?? turn.r.advice?.generateItinerary ?? null,
    route: turn.r.route?.type ?? turn.r.route?.kind ?? null, reply: (turn.r.advice?.reply ?? "").replace(/\n+/g, " / ").slice(0, 200),
  };
};
const STEP1 = { "zh-TW": "12/10-12/14 我要去雪梨", en: "12/10-12/14 I'm going to sydney", ja: "12/10-12/14 シドニーへ旅行", ko: "12/10-12/14 시드니 여행" };
/** Action phrases exactly as the new copy names them. */
const quoted = (s) => [...s.matchAll(/[“「]([^”」]+)[”」]/g)].map((m) => m[1]);
const copyAll = (locale) => quoted(chatRuntimeMessages[locale].combinationPartialModify).at(-1);
const copyConfirm = (locale) => quoted(chatRuntimeMessages[locale].combinationRefDayConfirm).at(-1);
const REF_DAY = { "zh-TW": "第2組但第一天改一下", en: "Option 2 but change day 1", ja: "2番で、でも1日目を変えて", ko: "2번 조합으로 하되 1일차 바꿔 주세요" };
const ALL_SELECTED = (v) => v.offered.length >= 2 && v.offered.every((id) => v.selected.includes(id));
const e2e = {};
for (const locale of Object.keys(STEP1)) {
  discovery.clearDiscoveredCombinationsCache(); poolCache.clearCandidatePoolCache();
  const step1 = await sendTurn(sessionMod.createEmptySession(), STEP1[locale], locale);
  e2e[locale] = { step1: view(step1) };
  await check(`[${locale}] fixture: Sydney combinations offered`, () => assert.equal(step1.s.pendingQuestion?.type, "combination_choice", view(step1).reply));
  const allPhrase = copyAll(locale);
  await check(`[${locale}] copy names an "all" action: 「${allPhrase}」 → selects every combination`, async () => {
    const v = view(await sendTurn(step1.s, allPhrase, locale));
    e2e[locale].all = v;
    assert.ok(ALL_SELECTED(v) || v.shouldGenerate === true, JSON.stringify(v));
  });
  for (const t of (locale === "zh-TW" ? ["混搭", "都可以", "全部", "你決定"] : MIX[locale].pos.slice(0, 4).concat(MIX[locale].pos.slice(-4)))) {
    await check(`[${locale}] mix reply 「${t}」 end-to-end selects every combination`, async () => {
      const v = view(await sendTurn(step1.s, t, locale));
      assert.ok(ALL_SELECTED(v) || v.shouldGenerate === true, JSON.stringify(v));
    });
  }
  const numbers = locale === "en" || locale === "ko" ? "1, 3" : "1、3";
  await check(`[${locale}] copy example numbers 「${numbers}」 select combinations 1 and 3`, async () => {
    const v = view(await sendTurn(step1.s, numbers, locale));
    assert.ok(v.selected.length === 2 && v.selected.includes(v.offered[0]) && v.selected.includes(v.offered[2]), JSON.stringify(v));
  });
  await check(`[${locale}] day follow-up 「${REF_DAY[locale]}」 → ref-day confirm copy; then 「${copyConfirm(locale)}」 creates with combination 2`, async () => {
    const t1 = await sendTurn(step1.s, REF_DAY[locale], locale);
    const v1 = view(t1);
    e2e[locale].refDay = v1;
    const expectStart = chatRuntimeMessages[locale].combinationRefDayConfirm.split("{combo}")[0];
    assert.ok(v1.reply.startsWith(expectStart.replace(/\n+/g, " / ")) || v1.confirmTitles?.length, `ref-day reply: ${JSON.stringify(v1)}`);
    const t2 = await sendTurn(t1.s, copyConfirm(locale), locale);
    const v2 = view(t2);
    e2e[locale].confirm = v2;
    assert.ok(v2.selected.length === 1 && v2.selected[0] === v1.offered[1] && v2.pending !== "combination_choice", `confirm: ${JSON.stringify(v2)}`);
  });
}

// ---------------------------------------------------------------- C. en quotes
const J_KEYS = ["combinationPartialModifyDay", "combinationPartialModify", "combinationRefDayConfirm", "combinationRefDayConfirmGeneric", "combinationDatesUpdated", "combinationMissingPrefix"];
const workStats = quoteStats(chatRuntimeMessages.en);
if (HEAD) infos.push(`en chat-runtime quotes HEAD: ${JSON.stringify(HEAD.quotes)}`);
const jStats = quoteStats(Object.fromEntries(J_KEYS.map((k) => [k, chatRuntimeMessages.en[k]])));
infos.push(`en chat-runtime quotes WORK: ${JSON.stringify(workStats)}; J keys: ${JSON.stringify(jStats)}`);
await check("en J copy: quotes are curly “…” (no straight double quotes)", () => {
  for (const k of J_KEYS) assert.doesNotMatch(chatRuntimeMessages.en[k], /"/, k);
});
await check("en J copy: apostrophes use one style across the J keys", () => {
  assert.ok(jStats.straightApos === 0 || jStats.curlyApos === 0, JSON.stringify(jStats));
});
await check("network: fetch calls = 0", () => assert.equal(fetchCalls, 0));

out("\n---- e2e views");
for (const [locale, v] of Object.entries(e2e)) out(`[${locale}] ${JSON.stringify(v)}`);
for (const i of infos) out(`INFO ${i}`);
out(`\n${failures.length ? "FAIL" : "PASS"} verify-kij2-j-mix-and-day-copy — ${failures.length} failing; fetch=${fetchCalls}`);
process.exit(failures.length ? 1 : 0);
