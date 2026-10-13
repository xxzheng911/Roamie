/**
 * Plus itinerary personalization through the real generateItinerary handler (no TanStack compile
 * step), with mocked OpenAI / Google / credits context. Plus is decided only by the server
 * entitlement the credits middleware resolved (itineraryCreditReservation.plusBypass).
 * Separates: data passed → prompt used → planner used → delivered itinerary.
 */
import assert from "node:assert/strict";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { createMiddleware } from "@tanstack/react-start";
import { generateItinerary, InputSchema } from "../src/lib/itinerary.functions.ts";
import { buildConversationSummary } from "../src/lib/chat-session.ts";
import { readFileSync } from "node:fs";

process.env.OPENAI_API_KEY = "sk-mock-not-a-real-key";
let aiJson = null;
let prompts = [];
const net = [];
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  net.push(url);
  if (url.includes("api.openai.com")) {
    prompts.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiJson) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("network blocked");
};

const P = (id, n, t, lat, lng) => ({ id, n, t, lat, lng, gid: `ChIJp${id}` });
const at = (base, i) => [base[0] + i * 0.004, base[1] + i * 0.003];
const T = [35.69, 139.7];
const U = [35.715, 139.797];
const D1 = "2026-11-02";
const D2 = "2026-11-03";
const item = (date, time, p) => ({
  date, time, title: p.n, description: p.n, placeName: p.n, lat: p.lat, lng: p.lng,
  address: "東京都", googlePlaceId: p.gid, placeType: p.t, notes: "",
});
const toRec = (p, combo) => ({
  name: p.n, placeName: p.n, type: p.t, types: [p.t], primaryType: p.t, description: p.n, reason: "",
  estimatedTime: "1 小時", address: "東京都", lat: p.lat, lng: p.lng, googleMapsUrl: "", reasonSource: "template",
  googlePlaceId: p.gid, photoName: null, rating: 4.5, userRatingCount: 1200, businessStatus: "OPERATIONAL",
  ...(combo ? { matchedSelectedCombinationIds: [1], sourceCombinationId: 1 } : {}),
});
const quiz = (pace, extra = {}) => ({
  onboarded: true, pace, vibe: "quiet", avoid: ["crowds"], interests: ["咖啡", "美術館"], ...extra,
});

async function run({ days = 1, places, it = [], prefs, plus, selected = false, interests = "", locale = "zh-TW", userId = "u1", style }) {
  aiJson = { summary: "東京", recommendations: [], itinerary: it };
  prompts = [];
  const rpc = [];
  let captured = null;
  const mw = createMiddleware({ type: "function" }).client(async ({ next }) => {
    const r = await next({
      sendContext: {
        itineraryCreditReservation: { plusBypass: plus, ledgerId: plus ? null : "ledger", idempotencyKey: plus ? null : "idem" },
        userId,
        supabase: { rpc: async (name, args) => (rpc.push({ name, args }), { data: { ok: true }, error: null }) },
      },
    });
    captured = r;
    return r;
  });
  const logs = [];
  const original = { info: console.info, log: console.log, warn: console.warn };
  console.info = console.log = console.warn = (...args) => logs.push(args.map((a) => (typeof a === "string" ? a : "")).join(" "));
  const before = net.length;
  try {
    const data = InputSchema.parse({
      destination: "東京", days, startDate: D1, locale, interests, ...(style ? { style } : {}),
      selectedPlaces: places.map((p) => toRec(p, selected)),
      ...(prefs ? { preferences: prefs } : {}),
      ...(selected ? { selectedCombinationIds: [1], placeAuthority: "selected_only" } : {}),
    });
    await runWithStartContext(
      { startOptions: { functionMiddleware: [mw] }, contextAfterGlobalMiddlewares: {} },
      () => generateItinerary({ data }),
    );
  } catch {
    /* outcome read from the captured result */
  } finally {
    Object.assign(console, original);
  }
  const calls = net.slice(before);
  const itineraryPrompt = (() => {
    try { return JSON.parse(prompts[0] ?? "{}").messages.map((m) => m.content).join("\n"); } catch { return ""; }
  })();
  const stops = captured?.trip?.payload?.itinerary ?? [];
  const perDay = new Map();
  for (const s of stops) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
  const minimumLog = logs.find((l) => l.includes("[PLANNER_POOL_DIAG_C]")) ?? "";
  return {
    out: captured ?? {}, stops, logs, rpc, itineraryPrompt,
    plannerRequiredMinimum: Number(minimumLog.match(/requiredMinimumCount=(\d+)/)?.[1] ?? NaN),
    stopsPerDay: [...perDay.entries()].sort().map(([, n]) => n),
    aiCalls: calls.filter((u) => u.includes("api.openai.com")).length,
    googleCalls: calls.filter((u) => /googleapis|places/.test(u)).length,
  };
}

const results = [];
const notVerified = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, null]); }
  catch (error) { results.push([name, String(error?.message ?? error).split("\n")[0].slice(0, 170)]); }
};
const ok = (r) => assert.equal(r.out.success, true, `delivery failed: ${r.out.errorCode ?? ""} ${r.out.failureReason ?? ""}`);
const FREE_MODE = "Free 模式";

// Fixtures
const s = Array.from({ length: 4 }, (_, i) => P(`s${i}`, `景點${i}`, "tourist_attraction", ...at(T, i)));
const r0 = P("r0", "餐廳0", "restaurant", ...at(T, 8));
const llmIt = [item(D1, "09:30", s[0]), item(D1, "11:00", s[1]), item(D1, "12:30", r0), item(D1, "14:00", s[2]), item(D1, "15:30", s[3])];
const llm = { places: [...s, r0], it: llmIt };
const sel = [
  ...Array.from({ length: 4 }, (_, i) => P(`ss${i}`, `選景點${i}`, "tourist_attraction", ...at(T, i))),
  ...Array.from({ length: 2 }, (_, i) => P(`sr${i}`, `選餐廳${i}`, "restaurant", ...at(U, i))),
];
const selected = { days: 2, places: sel, selected: true };

const plusSlow = await run({ ...llm, prefs: quiz("slow"), plus: true });
const plusActive = await run({ ...llm, prefs: quiz("active"), plus: true });
const freeSlow = await run({ ...llm, prefs: quiz("slow"), plus: false });
const noPrefs = await run({ ...llm, plus: true });
const requestWins = await run({ ...llm, prefs: quiz("slow"), plus: true, interests: "這次想積極探索，行程排滿一點，也想熱鬧一點" });
const selSlow = await run({ ...selected, prefs: quiz("slow"), plus: true });
const selMedium = await run({ ...selected, prefs: quiz("medium"), plus: true });
const selFreeSlow = await run({ ...selected, prefs: quiz("slow"), plus: false });
const selRequestActive = await run({ ...selected, prefs: quiz("slow"), plus: true, interests: "行程排滿一點，積極探索" });
const tooMany = Array.from({ length: 10 }, (_, i) => P(`tm${i}`, `多選${i}`, i < 2 ? "restaurant" : "tourist_attraction", ...at(i % 2 ? U : T, i)));
const selSlowOverCapacity = await run({ days: 2, places: tooMany, selected: true, prefs: quiz("slow"), plus: true });
const p0 = {
  a: [0, 1].map((i) => P(`pa${i}`, `pa景點${i}`, "tourist_attraction", ...at(U, i))),
  r: [0, 1, 2, 3].map((i) => P(`pr${i}`, `pr餐廳${i}`, "restaurant", ...at(U, i + 6))),
  b: [0, 1, 2, 3, 4].map((i) => P(`pb${i}`, `pb景點${i}`, "tourist_attraction", ...at(T, i))),
};
const p0It = [
  item(D1, "09:30", p0.a[0]), item(D1, "11:00", p0.a[1]),
  ...p0.r.map((p, i) => item(D1, ["14:00", "15:30", "17:00", "19:00"][i], p)),
  ...p0.b.map((p, i) => item(D2, ["09:30", "11:00", "12:30", "14:00", "15:30"][i], p)),
];
const p0Slow = await run({ days: 2, places: [...p0.a, ...p0.r, ...p0.b], it: p0It, prefs: quiz("slow"), plus: true });
const regenA = await run({ ...llm, prefs: quiz("slow"), plus: true });
const userA = await run({ ...llm, prefs: quiz("slow"), plus: true, userId: "user-a" });
const userB = await run({ ...llm, plus: false, userId: "user-b" });
const locales = {};
for (const locale of ["en", "ja", "ko"]) locales[locale] = await run({ ...llm, prefs: quiz("slow"), plus: true, locale });
const freeSettle = await run({ ...llm, prefs: quiz("slow"), plus: false });

// Client → server: the chat session pace travels in the formal client summary (節奏：…).
const sessionSummary = (pace) => buildConversationSummary({ destination: "東京", pace, selectedPlaces: [] }, []);
const t1 = await run({ ...selected, prefs: quiz("slow"), plus: true, interests: sessionSummary("排滿") });
const t1llm = await run({ ...llm, prefs: quiz("slow"), plus: true, interests: sessionSummary("排滿") });
const t2 = await run({ ...selected, prefs: quiz("active"), plus: true, interests: sessionSummary("悠閒") });
const t2llm = await run({ ...llm, prefs: quiz("active"), plus: true, interests: sessionSummary("悠閒") });
const t3 = await run({ ...llm, prefs: quiz("slow"), plus: true, interests: sessionSummary("排滿"), style: "slow_nature" });
const t3sel = await run({ ...selected, prefs: quiz("slow"), plus: true, interests: sessionSummary("排滿"), style: "slow_nature" });
const t8 = await run({ ...llm, prefs: quiz("slow"), plus: true, interests: sessionSummary("排滿") });

await test("P1 Plus slow: quiz reaches the itinerary prompt", () => {
  ok(plusSlow);
  assert.ok(!plusSlow.itineraryPrompt.includes(FREE_MODE), "prompt must not be Free mode");
  for (const text of ["步調：慢、留白", "氛圍：安靜", "想避開：人潮太多", "興趣標籤：咖啡、美術館"]) {
    assert.ok(plusSlow.itineraryPrompt.includes(text), `missing ${text}`);
  }
});
await test("P2 Plus active: prompt carries the active pace", () => {
  ok(plusActive);
  assert.ok(plusActive.itineraryPrompt.includes("步調：多走走看看"));
});
await test("P3 Free never receives Plus quiz content (prompt or planner)", () => {
  ok(freeSlow);
  assert.ok(freeSlow.itineraryPrompt.includes(FREE_MODE));
  assert.ok(!freeSlow.itineraryPrompt.includes("步調：慢、留白"));
  assert.equal(selFreeSlow.plannerRequiredMinimum, selMedium.plannerRequiredMinimum, "Free planner ignores quiz pace");
});
await test("P4 no quiz data: nothing personal is invented", () => {
  ok(noPrefs);
  assert.ok(!noPrefs.itineraryPrompt.includes("步調：慢、留白"));
  assert.ok(!noPrefs.itineraryPrompt.includes("想避開："));
});
await test("P5 this-turn request outranks the long-term quiz", () => {
  ok(requestWins);
  assert.ok(requestWins.itineraryPrompt.includes("步調：多走走看看"), "explicit 積極探索 wins over quiz slow");
  assert.ok(!requestWins.itineraryPrompt.includes("步調：慢、留白"));
  assert.ok(requestWins.itineraryPrompt.includes("氛圍：有生活感"), "explicit 熱鬧 wins over quiz quiet");
  assert.notEqual(selRequestActive.plannerRequiredMinimum, selSlow.plannerRequiredMinimum, "planner uses the request pace");
});
await test("T1 quiz slow + this session 排滿 → active (prompt and planner)", () => {
  assert.ok(sessionSummary("排滿").includes("節奏：排滿"), "client summary carries the session pace");
  ok(t1); ok(t1llm);
  assert.ok(t1llm.itineraryPrompt.includes("步調：多走走看看"), "prompt");
  assert.equal(t1.plannerRequiredMinimum, selMedium.plannerRequiredMinimum, "planner uses active, not quiz slow");
});
await test("T2 quiz active + this session 悠閒 → slow (prompt and planner)", () => {
  ok(t2); ok(t2llm);
  assert.ok(t2llm.itineraryPrompt.includes("步調：慢、留白"), "prompt");
  assert.equal(t2.plannerRequiredMinimum, selSlow.plannerRequiredMinimum, "planner uses slow");
});
await test("T3 session 排滿 is not overridden by a slow_nature trip style", () => {
  ok(t3); ok(t3sel);
  assert.ok(t3.itineraryPrompt.includes("步調：多走走看看"));
  assert.equal(t3sel.plannerRequiredMinimum, selMedium.plannerRequiredMinimum);
});
await test("T3b the formal chat client call passes the session pace as requestPace, never as quizPace", () => {
  const src = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
  const call = src.slice(src.indexOf("const pace = resolvePlannerPaceFromProfile({"), src.indexOf("createResult = {", src.indexOf("const pace = resolvePlannerPaceFromProfile({")));
  assert.match(call, /requestPace:/);
  assert.doesNotMatch(call, /quizPace:/);
  assert.match(call, /悠閒/, "the session value 悠閒 maps to slow");
});
await test("T8 regenerate keeps the effective (session) pace", () => {
  ok(t8);
  assert.equal(t8.itineraryPrompt, t1llm.itineraryPrompt);
});
await test("P7 avoid preference is not dropped", () => {
  assert.ok(plusSlow.itineraryPrompt.includes("想避開：人潮太多"));
  assert.ok(plusActive.itineraryPrompt.includes("想避開：人潮太多"));
});
await test("P8 selected combination planner receives the Plus pace", () => {
  ok(selSlow); ok(selMedium);
  assert.ok(selSlow.plannerRequiredMinimum < selMedium.plannerRequiredMinimum, `slow ${selSlow.plannerRequiredMinimum} vs medium ${selMedium.plannerRequiredMinimum}`);
  if (selSlow.stopsPerDay.join(",") === selMedium.stopsPerDay.join(",")) {
    notVerified.push(`P8 final density: slow ${selSlow.stopsPerDay} = medium ${selMedium.stopsPerDay} (all selected places fit both paces)`);
  }
});
await test("P8b slow pace never drops selected must-visit places", () => {
  ok(selSlowOverCapacity);
  assert.equal(selSlowOverCapacity.stops.length, tooMany.length);
});
await test("P9 Daily Balance still holds for a Plus slow user", () => {
  ok(p0Slow);
  const byDay = new Map();
  for (const st of p0Slow.stops) byDay.set(st.date, [...(byDay.get(st.date) ?? []), st]);
  const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const [date, list] of byDay) {
    const meals = list.filter((x) => x.placeType === "restaurant").map((x) => min(x.time)).sort((a, b) => a - b);
    for (let i = 1; i < meals.length; i += 1) assert.ok(meals[i] - meals[i - 1] >= 120, `${date} meals ${meals}`);
  }
  assert.equal(p0Slow.stops.length, 11, "no stop lost");
});
await test("P10/P11 selected-only and required places preserved", () => {
  for (const r of [selSlow, selMedium, selRequestActive, selSlowOverCapacity]) {
    ok(r);
    const allowed = new Set((r === selSlowOverCapacity ? tooMany : sel).map((p) => p.gid));
    for (const st of r.stops) assert.ok(allowed.has(st.googlePlaceId), `unselected ${st.placeName}`);
    assert.equal(r.stops.length, allowed.size, "every selected place delivered");
  }
});
await test("P12 regenerate uses the same effective preference", () => {
  ok(regenA);
  assert.equal(regenA.itineraryPrompt, plusSlow.itineraryPrompt);
  assert.deepEqual(regenA.stops.map((x) => `${x.time} ${x.googlePlaceId}`), plusSlow.stops.map((x) => `${x.time} ${x.googlePlaceId}`));
});
await test("P13 different users / sessions do not leak preferences", () => {
  ok(userA); ok(userB);
  assert.ok(userA.itineraryPrompt.includes("步調：慢、留白"));
  assert.ok(!userB.itineraryPrompt.includes("步調：慢、留白"));
  assert.ok(!userB.itineraryPrompt.includes("咖啡、美術館"));
});
await test("P14 without server Plus entitlement (expired) the Free contract applies", () => {
  assert.ok(freeSettle.itineraryPrompt.includes(FREE_MODE));
});
await test("P15 four locales keep the Plus preference block", () => {
  for (const [locale, r] of Object.entries(locales)) {
    ok(r);
    assert.ok(!r.itineraryPrompt.includes(FREE_MODE), `${locale} fell back to Free`);
    assert.ok(r.itineraryPrompt.includes("步調："), `${locale} pace missing`);
  }
});
await test("P16 provider calls do not increase (AI ≤ 2, Google 0)", () => {
  for (const r of [plusSlow, plusActive, freeSlow, requestWins, selSlow, selMedium, p0Slow]) {
    assert.ok(r.aiCalls <= 2, `ai ${r.aiCalls}`);
    assert.equal(r.googleCalls, 0);
  }
});
await test("P17 credits / owner settlement unchanged", () => {
  assert.equal(plusSlow.rpc.length, 0, "Plus bypass never settles");
  assert.deepEqual(freeSettle.rpc.map((c) => c.name), [freeSettle.out.success ? "credits_commit" : "credits_rollback"]);
});

let failed = 0;
for (const [name, error] of results) {
  if (error) failed += 1;
  console.log(`${error ? "FAIL" : "PASS"} ${name}${error ? ` — ${error}` : ""}`);
}
for (const note of notVerified) console.log(`NOT-VERIFIED ${note}`);
console.log(`verify-itinerary-handler-plus-personalization: ${results.length - failed}/${results.length} PASS, ${notVerified.length} not verified`);
if (failed) process.exit(1);
