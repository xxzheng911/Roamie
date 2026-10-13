/**
 * Runs the real generateItinerary server handler end to end (no TanStack compile step) with
 * mocked OpenAI / Google / Supabase credits context, and checks the delivered itinerary:
 * daily balance, final delivery gate, selected-only, locked / reservation, credits settlement.
 * Every non-OpenAI request is blocked; OpenAI returns a fixed mock response.
 */
import assert from "node:assert/strict";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { createMiddleware } from "@tanstack/react-start";
import { generateItinerary, InputSchema } from "../src/lib/itinerary.functions.ts";
import {
  shouldBlockItineraryDelivery,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/validate.ts";

process.env.OPENAI_API_KEY = "sk-mock-not-a-real-key";
let aiJson = null;
const net = [];
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  net.push(url);
  if (url.includes("api.openai.com")) {
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(aiJson) } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  throw new Error("network blocked");
};

// ── Fixtures ──
const P = (id, n, t, lat, lng) => ({ id, n, t, lat, lng, gid: `ChIJh${id}` });
const at = (base, i) => [base[0] + i * 0.004, base[1] + i * 0.003];
const T = [35.69, 139.7];
const U = [35.715, 139.797];
const sights = (k, base, n, t = "tourist_attraction") =>
  Array.from({ length: n }, (_, i) => P(`${k}${i}`, `${k}景點${i}`, t, ...at(base, i)));
const rest = (k, base, n) => Array.from({ length: n }, (_, i) => P(`${k}${i}`, `${k}餐廳${i}`, "restaurant", ...at(base, i + 6)));
const D1 = "2026-11-02";
const D2 = "2026-11-03";
const item = (date, time, p, title = p.n) => ({
  date, time, title, description: p.n, placeName: p.n, lat: p.lat, lng: p.lng,
  address: "東京都", googlePlaceId: p.gid, placeType: p.t, types: p.types ?? [p.t], notes: "",
});
const toRec = (p, combo) => ({
  name: p.n, placeName: p.n, type: p.t, types: p.types ?? [p.t], primaryType: p.t, ...(p.required === false ? {isRequiredBySelection:false} : {}), description: p.n, reason: "",
  estimatedTime: "1 小時", address: "東京都", lat: p.lat, lng: p.lng, googleMapsUrl: "", reasonSource: "template",
  googlePlaceId: p.gid, photoName: null, rating: 4.5, userRatingCount: 1200, businessStatus: "OPERATIONAL",
  ...(combo ? { matchedSelectedCombinationIds: [1], sourceCombinationId: 1 } : {}),
});

// ── Harness ──
async function run({ days, places, endDate, it = [], interests = "", selected = false, credits = { plusBypass: true } }) {
  aiJson = { summary: "東京", recommendations: [], itinerary: it };
  const rpc = [];
  let captured = null;
  const mockCtx = createMiddleware({ type: "function" }).client(async ({ next }) => {
    const r = await next({
      sendContext: {
        itineraryCreditReservation: { ledgerId: "ledger-mock", idempotencyKey: "idem-mock", ...credits },
        userId: "verify-user",
        supabase: { rpc: async (name, args) => (rpc.push({ name, args }), { data: { ok: true }, error: null }) },
      },
    });
    captured = r;
    return r;
  });
  const logs = [];
  const events = [];
  const original = { info: console.info, log: console.log, warn: console.warn };
  const sink = (...args) => { events.push(args); logs.push(args.map((a) => (typeof a === "string" ? a : "")).join(" ")); };
  console.info = sink;
  console.log = sink;
  console.warn = sink;
  const before = net.length;
  let thrown = null;
  try {
    const data = InputSchema.parse({
      destination: "東京", days, startDate: D1, ...(endDate ? {endDate} : {}), locale: "zh-TW", interests,
      selectedPlaces: places.map((p) => toRec(p, selected)),
      ...(selected ? { selectedCombinationIds: [1], placeAuthority: "selected_only" } : {}),
    });
    await runWithStartContext(
      { startOptions: { functionMiddleware: [mockCtx] }, contextAfterGlobalMiddlewares: {} },
      () => generateItinerary({ data }),
    );
  } catch (error) {
    thrown = error;
  } finally {
    Object.assign(console, original);
  }
  const calls = net.slice(before);
  const out = captured ?? {};
  const stops = out?.trip?.payload?.itinerary ?? [];
  return {
    out, stops, logs, events, rpc, thrown,
    aiCalls: calls.filter((u) => u.includes("api.openai.com")).length,
    googleCalls: calls.filter((u) => /googleapis|maps\.google|places/.test(u)).length,
  };
}

// ── Oracle (independent of the contract) ──
const min = (t) => { const m = String(t).match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const byDay = (stops) => {
  const days = new Map();
  for (const s of stops) days.set(s.date, [...(days.get(s.date) ?? []), s]);
  return [...days.entries()].sort().map(([date, list]) => ({ date, list: list.sort((a, b) => min(a.time) - min(b.time)) }));
};
const isMeal = (s) => /restaurant/.test(s.placeType ?? "");
const mealGaps = (list) => {
  const gaps = [];
  for (let i = 1; i < list.length; i += 1) if (isMeal(list[i - 1]) && isMeal(list[i])) gaps.push(min(list[i].time) - min(list[i - 1].time));
  return gaps;
};
const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push([name, null]); }
  catch (error) { results.push([name, String(error?.message ?? error).split("\n")[0].slice(0, 170)]); }
};
const ok = (r) => assert.equal(r.out.success, true, `delivery failed: ${r.out.errorCode ?? ""} ${r.out.failureReason ?? ""} ${r.thrown?.message ?? ""}`);
const ids = (list) => new Set(list.map((s) => s.googlePlaceId));

// Scenario data
const good = { s: sights("g", T, 4), r: rest("gr", T, 2) };
const p0 = { a: sights("pa", U, 2), r: rest("pr", U, 4), b: sights("pb", T, 4), reservation: P("rsv", "茶道體驗", "tourist_attraction", ...at(T, 5)) };
const p0Items = [
  item(D1, "09:30", p0.a[0]), item(D1, "11:00", p0.a[1]),
  ...p0.r.map((p, i) => item(D1, ["14:00", "15:30", "17:00", "19:00"][i], p)),
  ...p0.b.map((p, i) => item(D2, ["09:30", "11:00", "12:30", "15:30"][i], p)),
  item(D2, "14:00", p0.reservation),
];
const p0Places = [...p0.a, ...p0.r, ...p0.b, p0.reservation];
const selectedPlaces = [
  ...rest("sr", U, 3),
  ...sights("sa", U, 2),
  ...sights("sb", T, 4),
];

const H1 = await run({ days: 1, places: [...good.s, ...good.r], it: [item(D1, "09:30", good.s[0]), item(D1, "11:00", good.s[1]), item(D1, "12:30", good.r[0]), item(D1, "14:00", good.s[2]), item(D1, "15:30", good.s[3]), item(D1, "19:00", good.r[1])] });
const H2 = await run({ days: 2, places: p0Places, it: p0Items });
// Hard failure: a 2-day trip with a single place — missing_days cannot be repaired.
const lone = sights("x", T, 1);
const hard = { days: 2, places: lone, it: [item(D1, "10:00", lone[0])] };
const H4 = await run(hard);
const H5 = await run({ days: 3, places: selectedPlaces, selected: true });
const H11 = await run({ days: 1, places: sights("n", T, 5), it: sights("n", T, 5).map((p, i) => item(D1, ["09:30", "11:00", "12:30", "14:00", "15:30"][i], p)) });
const half = { s: sights("h", T, 2), r: rest("hr", T, 2) };
const H12 = await run({ days: 1, places: [...half.s, ...half.r], it: [item(D1, "14:00", half.r[0]), item(D1, "15:30", half.s[0]), item(D1, "17:00", half.s[1]), item(D1, "19:00", half.r[1])] });
const fd = { s: sights("f", T, 2), r: rest("fr", T, 3) };
const H13 = await run({ days: 1, places: [...fd.s, ...fd.r], interests: "這次是美食之旅", it: [item(D1, "09:30", fd.s[0]), item(D1, "11:00", fd.r[0]), item(D1, "12:30", fd.r[1]), item(D1, "15:30", fd.s[1]), item(D1, "19:00", fd.r[2])] });
const hike = sights("o", [35.62, 139.24], 4, "park");
const H14 = await run({ days: 1, places: hike, interests: "高尾山登山健行", it: hike.map((p, i) => item(D1, ["08:30", "11:00", "13:30", "15:30"][i], p)) });
const H15 = await run({ days: 2, places: p0Places, it: p0Items });
const H18 = await run({ days: 2, places: p0Places, it: p0Items, credits: { plusBypass: false } });
const H18b = await run({ ...hard, credits: { plusBypass: false } });
// Title keywords are not a time authority (no reservation feature): same P0, one restaurant renamed.
const KEYWORD_NAMES = { D2: "予約制 鮨 ささ木", D3: "預約制私廚", D4: "예약 전용 식당", D5: "Reservation Bistro" };
const keywordRuns = {};
for (const [key, name] of Object.entries(KEYWORD_NAMES)) {
  const renamed = p0.r.map((p, i) => (i === 1 ? { ...p, n: name } : p));
  keywordRuns[key] = await run({
    days: 2,
    places: [...p0.a, ...renamed, ...p0.b, p0.reservation],
    it: [
      item(D1, "09:30", p0.a[0]), item(D1, "11:00", p0.a[1]),
      ...renamed.map((p, i) => item(D1, ["14:00", "15:30", "17:00", "19:00"][i], p)),
      ...p0.b.map((p, i) => item(D2, ["09:30", "11:00", "12:30", "15:30"][i], p)),
      item(D2, "14:00", p0.reservation),
    ],
  });
}
const delivered = [H1, H2, H5, H11, H12, H13, H14, H15];

await test("H1 LLM normal itinerary is delivered unchanged", () => {
  ok(H1);
  assert.deepEqual(H1.stops.map((s) => `${s.time} ${s.placeName}`), ["09:30 g景點0", "11:00 g景點1", "12:30 gr餐廳0", "14:00 g景點2", "15:30 g景點3", "19:00 gr餐廳1"]);
});
await test("H2 LLM P0 itinerary is flagged and enters replan", () => {
  assert.ok(H2.logs.some((l) => /rule=consecutive_food_stops pass=false/.test(l)), "validator flags P0");
  assert.ok(H2.logs.some((l) => l.includes("[ITINERARY_REPLAN_INPUT]") || l.includes("[ITINERARY_REPLAN_RESULT]")), "replan ran");
});
await test("H3 residual soft schedule warning does not block delivery", () => {
  ok(H2);
  const day1 = byDay(H2.stops)[0].list;
  assert.ok(Math.min(...mealGaps(day1), Infinity) >= 120, `day1 still stacks meals: ${mealGaps(day1)}`);
  const residual = H2.logs.filter((l) => /rule=(consecutive_food_stops|meal_window_mismatch|long_stretch_without_break) pass=true .*details=warning:/.test(l));
  const finalFails = H2.logs.filter((l) => /\[ITINERARY_DELIVERY_BLOCKED/.test(l));
  assert.deepEqual(finalFails, [], "not blocked");
  if (mealGaps(day1).some((g) => g < 180)) assert.ok(residual.length > 0, "unrepaired residual is reported as a warning, not as fixed");
});
await test("H4 hard validation still blocks delivery", () => {
  // Handler: an undeliverable trip is still rejected before persistence.
  assert.notEqual(H4.out.success, true, "hard failure must not be delivered");
  // Final delivery gate itself: a hard rule at the final stage still blocks.
  const place = { id: "x0", googlePlaceId: "ChIJhx0", name: "x", lat: 35.69, lng: 139.7, primaryType: "tourist_attraction", types: ["tourist_attraction"], rating: 4.5, userRatingCount: 900, businessStatus: "OPERATIONAL" };
  const v = validateItineraryPlan({
    plans: [{ day: 1, entries: [{ time: "10:00", label: "景點", name: "x", place }] }],
    requestedDays: 2, style: "mixed", destination: "東京", creationPath: "direct",
    lockedPlaceIds: [], lockedPlaceNames: [], validationStage: "final",
  });
  assert.ok(v.failedRules.some((r) => r.code === "missing_days"));
  assert.equal(shouldBlockItineraryDelivery(v), true);
});
await test("H5 selected combination delivers", () => ok(H5));
await test("H6 selected combination never stacks two lunches", () => {
  ok(H5);
  for (const { date, list } of byDay(H5.stops)) {
    assert.deepEqual(mealGaps(list).filter((g) => g < 180), [], `${date}: ${list.map((s) => `${s.time} ${s.placeName}`).join(", ")}`);
  }
});
await test("H7 final cross-day ordering keeps every delivered day balanced", () => {
  for (const r of [H1, H2, H5, H12, H15]) {
    ok(r);
    for (const { date, list } of byDay(r.stops)) {
      assert.deepEqual(mealGaps(list).filter((g) => g < 120), [], `${date}: ${list.map((s) => `${s.time} ${s.placeName}`).join(", ")}`);
    }
  }
});
await test("H8 every original stop (incl. required) is kept", () => {
  ok(H2);
  const outIds = ids(H2.stops);
  for (const p of p0Places) assert.ok(outIds.has(p.gid), `lost ${p.n}`);
});
const mealWindowOk = (t) => (t >= 660 && t <= 870) || (t >= 1020 && t <= 1260) || (t >= 420 && t <= 600);
for (const [key, name] of Object.entries(KEYWORD_NAMES)) {
  await test(`${key} "${name}" is not locked by its name`, () => {
    const r = keywordRuns[key];
    ok(r);
    const stop = r.stops.find((s) => s.googlePlaceId === p0.r[1].gid);
    assert.ok(stop, "kept");
    assert.ok(mealWindowOk(min(stop.time)), `${name} left at ${stop.time}`);
    for (const { date, list } of byDay(r.stops)) {
      assert.deepEqual(mealGaps(list).filter((g) => g < 120), [], `${date}: ${list.map((s) => `${s.time} ${s.placeName}`).join(", ")}`);
    }
  });
}
await test("D7 replan is never reverted because of a place name", () => {
  for (const r of [H2, ...Object.values(keywordRuns)]) {
    assert.deepEqual(r.logs.filter((l) => /KEEP_ORIGINAL\] reason=daily_schedule_regression/.test(l) && /authorityBreaches=[1-9]/.test(l)), []);
  }
});
await test("H10 selected-only never mixes in unselected places", () => {
  ok(H5);
  const allowed = new Set(selectedPlaces.map((p) => p.gid));
  for (const s of H5.stops) assert.ok(allowed.has(s.googlePlaceId), `unselected ${s.placeName}`);
});
await test("H11 no meal candidates: nothing invented, all stops kept", () => {
  ok(H11);
  assert.equal(H11.stops.length, 5);
  assert.ok(!H11.stops.some(isMeal));
  assert.ok(H11.logs.some((l) => /rule=long_stretch_without_break pass=true .*details=warning:/.test(l)), "warning recorded");
});
await test("H12 afternoon half day: no breakfast, nothing before departure", () => {
  ok(H12);
  assert.ok(H12.stops.every((s) => min(s.time) >= 14 * 60), H12.stops.map((s) => s.time).join(","));
});
await test("H13 food trip keeps several meals", () => { ok(H13); assert.equal(H13.stops.filter(isMeal).length, 3); });
await test("H14 outdoor / hiking day is delivered", () => { ok(H14); assert.equal(H14.stops.length, 4); });
await test("H15 regenerate (second identical request) applies the same rules", () => {
  ok(H15);
  assert.deepEqual(H15.stops.map((s) => `${s.date} ${s.time} ${s.googlePlaceId}`), H2.stops.map((s) => `${s.date} ${s.time} ${s.googlePlaceId}`));
});
await test("H16 delivered stops carry Place ID, trip date, valid time and day order", () => {
  for (const r of delivered.filter((x) => x.out.success)) {
    for (const s of r.stops) {
      assert.match(s.googlePlaceId ?? "", /^ChIJ/);
      assert.match(s.date, /^2026-11-0[2-4]$/);
      assert.ok(Number.isFinite(min(s.time)));
    }
    for (const { list } of byDay(r.stops)) {
      const times = list.map((s) => min(s.time));
      assert.deepEqual(times, [...times].sort((a, b) => a - b));
      assert.equal(new Set(times).size, times.length, "no clock collision");
    }
  }
});
await test("H17 provider calls do not increase (AI ≤ 2 per generation, Google 0)", () => {
  for (const r of [H1, H2, H4, H5, H11, H12, H13, H14, H15]) {
    assert.ok(r.aiCalls <= 2, `ai calls ${r.aiCalls}`);
    assert.equal(r.googleCalls, 0);
  }
});
await test("H18 credits settlement contract unchanged (commit on success, rollback on failure)", () => {
  assert.deepEqual(H18.rpc.map((c) => c.name), [H18.out.success ? "credits_commit" : "credits_rollback"]);
  assert.deepEqual(H18.rpc[0].args, { p_ledger_id: "ledger-mock", p_idempotency_key: "idem-mock" });
  assert.deepEqual(H18b.rpc.map((c) => c.name), ["credits_rollback"]);
  assert.equal(H1.rpc.length, 0, "plus bypass never settles");
});


const { productionA, productionB } = await import("./fixtures/daily-balance-production.mjs");
const productionRuns=[];
for (const [name,fixture] of [["A",productionA],["B-pre-release",productionB]]) {
  const places=fixture.flatMap(d=>d.places.map(p=>({...p,n:p.name,t:p.primaryType,gid:p.googlePlaceId})));
  const it=fixture.flatMap(d=>d.places.map(p=>item(d.day===1?D1:D2,p.time,{...p,n:p.name,t:p.primaryType,gid:p.googlePlaceId})));
  const r=await run({days:2,places,it,endDate:D2}); productionRuns.push(r);
  await test(`PROD ${name}: real Handler repairs schedule without adding providers`,()=>{
    ok(r);
    for(const {list} of byDay(r.stops)) {
      assert.ok(list.some(s=>isMeal(s)&&min(s.time)>=660&&min(s.time)<=870),"missing lunch");
      assert.deepEqual(mealGaps(list).filter(g=>g<120),[],"consecutive full meals");
    }
    assert.equal(r.stops.length,places.length);
    assert.deepEqual([...ids(r.stops)].sort(),places.map(p=>p.gid).sort());
    assert.ok(r.aiCalls<=2);assert.equal(r.googleCalls,0);
  });
}
await test("PROD A: initial validator detects two structured meals and requests repair",()=>{
  const r=productionRuns[0];
  assert.ok(r.logs.some(l=>/rule=consecutive_food_stops pass=false/.test(l)));
  assert.ok(r.logs.some(l=>l.includes("[ITINERARY_REPLAN_INPUT]")));
});

await test("R11 production selected-only preserves all IDs, capacity and zero Google calls",async()=>{
  const places=productionA.flatMap(d=>d.places.map(p=>({...p,n:p.name,t:p.primaryType,gid:p.googlePlaceId})));
  const r=await run({days:2,places,selected:true,endDate:D2});ok(r);
  assert.deepEqual([...ids(r.stops)].sort(),places.map(p=>p.gid).sort());
  assert.ok(byDay(r.stops).every(d=>d.list.length<=6));
  assert.equal(r.googleCalls,0);assert.equal(r.aiCalls,0);
});
await test("R15 no candidates: final warning never claims repaired",()=>{
  assert.ok(H11.logs.some(l=>l.includes("unrepaired_at_final:")));
});
await test("R16 real Handler payload survives JSON persistence and saved normalization",async()=>{
  const {normalizeStoredTrip}=await import("../src/lib/saved-trip/normalize.ts");
  for(const r of productionRuns){
    ok(r);
    const payload=JSON.parse(JSON.stringify(r.out.trip.payload));
    const view=normalizeStoredTrip({id:"fixture",title:"fixture",payload,created_at:"2026-11-01",updated_at:"2026-11-01"});
    const expected=byDay(r.stops).flatMap(d=>d.list.map(s=>`${s.date}|${s.time}|${s.googlePlaceId}`));
    const actual=view.days.flatMap(d=>d.items.map(s=>`${d.date}|${s.time}|${s.placeId}`));
    assert.deepEqual(actual,expected);
  }
});
const {diversitySixDayPlans}=await import("./fixtures/daily-balance-production.mjs");
await test("D Handler: six days / 28 stops survive replan and final meal exchange",async()=>{
  const plans=diversitySixDayPlans();
  const places=plans.flatMap(d=>d.entries.map(e=>({...e.place,n:e.place.name,t:e.place.primaryType,gid:e.place.googlePlaceId,required:false})));
  const it=plans.flatMap(d=>d.entries.map(e=>item(`2026-11-0${d.day+1}`,e.time,{...e.place,n:e.place.name,t:e.place.primaryType,gid:e.place.googlePlaceId})));
  const r=await run({days:6,places,it,endDate:"2026-11-07"});
  console.log(`D_PROVIDER_CALLS ai=${r.aiCalls} google=${r.googleCalls}`);
  ok(r);assert.equal(byDay(r.stops).length,6);
  const selectedIds=new Set(places.map(p=>p.gid));
  assert.ok(r.stops.every(s=>selectedIds.has(s.googlePlaceId)),"no unselected candidate added");
  assert.ok(byDay(r.stops).every(d=>d.list.length<=6),"daily capacity preserved");
  assert.ok(r.logs.some(l=>l.includes("[ITINERARY_REPLAN_INPUT]")),"actual replan executed");
  const replanIndex=r.events.findIndex(e=>e[0]==="[ITINERARY_REPLAN_INPUT]");
  const finalIndex=r.events.findIndex(e=>e[0]==="[ITINERARY_CROSS_DAY_GEOGRAPHIC_VALIDATION]"&&e[1]?.stage==="final_pre_persistence");
  const gateIndex=r.events.findIndex(e=>e[0]==="[ITINERARY_DELIVERY_ALLOWED]");
  assert.ok(replanIndex>=0&&finalIndex>replanIndex&&gateIndex>finalIndex,"Replan -> final meal exchange -> final Validator -> delivery");
  const finalDiversity=r.events.filter(e=>e[0]==="[ITINERARY_DAILY_DIVERSITY]"&&e[1]?.stage==="final");
  assert.equal(finalDiversity.length,6);assert.ok(finalDiversity.every(e=>!e[1].ruleEmitted));
  assert.equal(r.googleCalls,0);assert.ok(r.aiCalls<=2);
});
let failed = 0;
for (const [name, error] of results) {
  if (error) failed += 1;
  console.log(`${error ? "FAIL" : "PASS"} ${name}${error ? ` — ${error}` : ""}`);
}
console.log(`verify-itinerary-handler-daily-balance: ${results.length - failed}/${results.length} PASS`);
if (failed) process.exit(1);
