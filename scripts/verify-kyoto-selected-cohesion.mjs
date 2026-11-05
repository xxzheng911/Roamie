/**
 * TS-GEO-DAYS：使用者挑選地點（placeAuthority "selected_only"）生成多日行程時，
 * 同一區的點要排在同一天；非 selected_only 的 AI 推薦行程維持原規則。
 *
 * 京都 3 天、9 個使用者挑選點（真實座標）：
 *   嵐山 4：天龍寺、竹林之道、%Arabica 嵐山、eX café 嵐山（兩間咖啡）
 *   東山 3：清水寺、高台寺、二年坂
 *   市中心 2：錦市場、京都國際漫畫博物館
 * AI 原始分配：D1＝天龍寺、竹林、清水寺；D2＝%Arabica、高台寺、錦市場；D3＝eX café、二年坂、漫畫博物館。
 *
 * 覆蓋：repairCrossDayGeographicCohesion（medium/slow、selected_only/非 selected_only、
 * AI 補位咖啡、固定日期、午餐錨點）、redistributePlacesEvenly、replanUntilItineraryValid。
 * 純函式＋本地 fixture，不發任何網路請求（fetch 被替換成會丟錯的 stub 並計數）。
 *
 * HEAD 對照：node scripts/verify-rel1-head-snapshot.mjs --dest=<scratchpad>/head 後，
 * 在快照目錄執行同一支腳本，預期 selected_only 相關斷言失敗。
 */
import { repairCrossDayGeographicCohesion } from "../src/lib/ai/cross-day-geographic-cohesion.ts";
import { redistributePlacesEvenly } from "../src/lib/ai/ai-multi-day-planner.ts";
import { clusterItemsByGeography } from "../src/lib/ai/geographic-clustering.ts";
import { replanUntilItineraryValid } from "../src/lib/ai/itinerary-validator/replan.ts";
import {
  setItineraryValidatorEnabledOverride,
  validateItineraryPlan,
} from "../src/lib/ai/itinerary-validator/index.ts";
import { resolveItineraryValidatorFlag } from "../src/lib/ai/itinerary-validator/feature-flag.ts";

let fetchCalls = 0;
globalThis.fetch = async () => {
  fetchCalls += 1;
  throw new Error("network disabled in verify-kyoto-selected-cohesion");
};

const failures = [];
const passed = [];
function check(name, fn) {
  try {
    fn();
    passed.push(name);
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function place(id, name, lat, lng, primaryType, extra = {}) {
  return {
    id,
    googlePlaceId: id,
    name,
    address: `${name}, 京都市, 日本`,
    lat,
    lng,
    rating: 4.5,
    userRatingCount: 1000,
    photoName: null,
    primaryType,
    types: [primaryType, "point_of_interest"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
    ...extra,
  };
}

const P = {
  tenryuji: place("ChIJKyotoTenryujiTemple0001", "天龍寺", 35.0158, 135.6737, "buddhist_temple"),
  bamboo: place("ChIJKyotoArashiyamaBamboo01", "嵐山竹林之道", 35.017, 135.6713, "tourist_attraction"),
  arabica: place("ChIJKyotoArabicaArashiyama1", "%Arabica 京都嵐山", 35.0143, 135.6776, "cafe"),
  excafe: place("ChIJKyotoExCafeArashiyama01", "eX café 京都嵐山本店", 35.0158, 135.6769, "cafe"),
  kiyomizu: place("ChIJKyotoKiyomizuderaTemple", "清水寺", 34.9949, 135.785, "buddhist_temple"),
  kodaiji: place("ChIJKyotoKodaijiTemple00001", "高台寺", 35.0007, 135.781, "buddhist_temple"),
  ninenzaka: place("ChIJKyotoNinenzakaSlope0001", "二年坂", 34.9982, 135.7808, "tourist_attraction"),
  nishiki: place("ChIJKyotoNishikiMarket00001", "錦市場", 35.005, 135.7649, "market"),
  manga: place("ChIJKyotoMangaMuseum0000001", "京都國際漫畫博物館", 35.0116, 135.759, "museum"),
};
const ALL = Object.values(P);
const AREAS = {
  arashiyama: [P.tenryuji.id, P.bamboo.id, P.arabica.id, P.excafe.id],
  higashiyama: [P.kiyomizu.id, P.kodaiji.id, P.ninenzaka.id],
  center: [P.nishiki.id, P.manga.id],
};
const CAFES = [P.arabica.id, P.excafe.id];

const stop = (p, time, label = "景點") => ({ time, label, name: p.name, place: p });

function aiSplit(overrides = {}) {
  const s = (key, time) => overrides[key] ?? stop(P[key], time);
  return [
    { day: 1, entries: [s("tenryuji", "09:30"), s("bamboo", "11:00"), s("kiyomizu", "14:00")] },
    { day: 2, entries: [s("arabica", "09:30"), s("kodaiji", "14:00"), s("nishiki", "16:00")] },
    { day: 3, entries: [s("excafe", "09:30"), s("ninenzaka", "14:00"), s("manga", "16:00")] },
  ];
}

const selectedAuthority = (lockedIds = ALL.map((p) => p.id)) => ({
  style: "mixed",
  userText: "",
  placeAuthority: "selected_only",
  lockedPlaceIds: lockedIds,
  lockedPlaceNames: ALL.filter((p) => lockedIds.includes(p.id)).map((p) => p.name),
});

function runCohesion(plans, { pace, authority } = {}) {
  return repairCrossDayGeographicCohesion(plans, {
    generationId: "kyoto-selected",
    stage: "initial",
    plannedDate: "2026-11-10",
    pace,
    logDiagnostics: false,
    diversityAuthority: authority,
  });
}

const idsOfDay = (plan) => plan.entries.map((entry) => entry.place.id);
const dayOf = (plans, id) => plans.find((plan) => idsOfDay(plan).includes(id))?.day;
const daysOf = (plans, ids) => new Set(ids.map((id) => dayOf(plans, id)));
const counts = (plans) => plans.map((plan) => plan.entries.length);
const summary = (plans) =>
  plans.map((plan) => `D${plan.day}=[${plan.entries.map((e) => e.place.name).join("、")}]`).join(" ");
const allIds = (plans) => plans.flatMap(idsOfDay).sort();

function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function assertTimelines(plans, label) {
  for (const plan of plans) {
    const clocks = plan.entries.map((entry) => clockMinutes(entry.time));
    expect(clocks.every((c) => c != null), `${label} D${plan.day} 有無效時間 ${plan.entries.map((e) => e.time)}`);
    expect(new Set(clocks).size === clocks.length, `${label} D${plan.day} 時間重複 ${plan.entries.map((e) => e.time)}`);
  }
}
function assertSamePlaces(after, label) {
  const expected = ALL.map((p) => p.id).sort();
  expect(JSON.stringify(allIds(after)) === JSON.stringify(expected), `${label} 地點集合改變：${summary(after)}`);
}
function assertAreasGrouped(plans, label) {
  for (const [area, ids] of Object.entries(AREAS)) {
    expect(daysOf(plans, ids).size === 1, `${label} ${area} 被拆到多天：${summary(plans)}`);
  }
  const areaDays = Object.values(AREAS).map((ids) => dayOf(plans, ids[0]));
  expect(new Set(areaDays).size === 3, `${label} 三區沒有各自一天：${summary(plans)}`);
  expect(
    JSON.stringify([...counts(plans)].sort((a, b) => b - a)) === JSON.stringify([4, 3, 2]),
    `${label} 每日點數應為 4/3/2，實際 ${counts(plans)}：${summary(plans)}`,
  );
  expect(daysOf(plans, CAFES).size === 1, `${label} 兩間咖啡不在同一天：${summary(plans)}`);
}

const results = {};

// ── 1. cohesion：selected_only medium / slow ──────────────────────────────
for (const pace of ["medium", "slow"]) {
  check(`cohesion selected_only ${pace}: 嵐山4／東山3／市中心2，咖啡同天`, () => {
    const out = runCohesion(aiSplit(), { pace, authority: selectedAuthority() });
    results[`cohesion_selected_${pace}`] = summary(out);
    assertSamePlaces(out, pace);
    assertTimelines(out, pace);
    assertAreasGrouped(out, `selected_only ${pace}`);
  });
}

// ── 2. cohesion：非 selected_only 對照（維持每天 ≥ pace 最小、咖啡分開）─────
for (const [pace, min] of [["medium", 3], ["slow", 2]]) {
  check(`cohesion 非 selected_only ${pace}: 每天 ≥${min}，咖啡不同天`, () => {
    const out = runCohesion(aiSplit(), { pace });
    results[`cohesion_ai_${pace}`] = summary(out);
    assertSamePlaces(out, `ai ${pace}`);
    assertTimelines(out, `ai ${pace}`);
    expect(counts(out).every((n) => n >= min), `ai ${pace} 有天少於 ${min}：${counts(out)} ${summary(out)}`);
    expect(daysOf(out, CAFES).size === 2, `ai ${pace} 兩間咖啡被排同一天：${summary(out)}`);
  });
}
check("cohesion 非 selected_only medium: 仍做不增加類別超量的交換（嵐山至少 3 點同天）", () => {
  const out = runCohesion(aiSplit(), { pace: "medium" });
  const arashiyamaDay = dayOf(out, P.tenryuji.id);
  const sameDay = AREAS.arashiyama.filter((id) => dayOf(out, id) === arashiyamaDay).length;
  expect(sameDay >= 3, `嵐山同天只有 ${sameDay}：${summary(out)}`);
});

// ── 3. selected_only 但 eX café 是 AI 補位（不在 locked 名單）→ 類別上限仍適用 ──
check("cohesion selected_only: AI 補位咖啡不放寬類別上限", () => {
  const locked = ALL.map((p) => p.id).filter((id) => id !== P.excafe.id);
  for (const pace of ["medium", "slow"]) {
    const out = runCohesion(aiSplit(), { pace, authority: selectedAuthority(locked) });
    results[`cohesion_selected_ai_cafe_${pace}`] = summary(out);
    assertSamePlaces(out, `ai-cafe ${pace}`);
    expect(daysOf(out, CAFES).size === 2, `${pace} AI 補位咖啡與使用者咖啡同天：${summary(out)}`);
    const exDay = out.find((plan) => plan.day === dayOf(out, P.excafe.id));
    expect(exDay.entries.length >= (pace === "slow" ? 2 : 3), `${pace} 含 AI 點的日子低於 pace 最小：${summary(out)}`);
  }
});

// ── 4. 固定日期（FIXED_DAY_RE）不可被搬走 ─────────────────────────────────
check("cohesion selected_only: 標記預約的 eX café 留在 D3", () => {
  const plans = aiSplit({ excafe: stop(P.excafe, "09:30", "Day 3 reservation 咖啡") });
  const out = runCohesion(plans, { pace: "medium", authority: selectedAuthority() });
  results.cohesion_selected_fixed = summary(out);
  assertSamePlaces(out, "fixed");
  expect(dayOf(out, P.excafe.id) === 3, `固定日期點被搬走：${summary(out)}`);
});

// ── 5. 午餐錨點：餐點不單獨搬移，每天午餐不超過 1 個 ─────────────────────
check("cohesion selected_only: 午餐錨點不被堆疊或拆走", () => {
  const plans = aiSplit({
    nishiki: stop(P.nishiki, "12:00", "午餐"),
    manga: stop(P.manga, "16:00"),
  });
  plans[0].entries[2] = stop(P.kiyomizu, "15:30");
  plans[2].entries = [stop(P.excafe, "09:30"), stop(P.ninenzaka, "12:00", "午餐"), stop(P.manga, "16:00")];
  const out = runCohesion(plans, { pace: "medium", authority: selectedAuthority() });
  results.cohesion_selected_lunch = summary(out);
  assertSamePlaces(out, "lunch");
  assertTimelines(out, "lunch");
  for (const plan of out) {
    const lunches = plan.entries.filter((e) => /午餐/.test(e.label));
    expect(lunches.length <= 1, `D${plan.day} 有 ${lunches.length} 個午餐：${summary(out)}`);
    for (const lunch of lunches) {
      const m = clockMinutes(lunch.time);
      expect(m >= 11 * 60 + 30 && m < 13 * 60 + 30, `午餐時間被移出窗口 ${lunch.time}`);
    }
  }
});

// ── 5b. 需要兩步搬移才能復原的拆分（replan auto repair 實際產生的形狀）─────
// D2 只剩 2 點時 %Arabica 不能直接搬回 D1（來源會低於 2）；要先把錦市場搬進 D2，
// 再把 %Arabica 搬回 D1。兩步都合法（每天 ≥2、≤ pace 上限、時間可排）。
for (const pace of ["medium", "slow"]) {
  check(`cohesion selected_only ${pace}: 兩步搬移可復原（嵐山3+%Arabica 在漫畫日、錦市場在東山日）`, () => {
    const plans = [
      { day: 1, entries: [stop(P.bamboo, "09:30"), stop(P.tenryuji, "11:00"), stop(P.excafe, "14:00")] },
      { day: 2, entries: [stop(P.manga, "11:00"), stop(P.arabica, "14:00")] },
      { day: 3, entries: [stop(P.kiyomizu, "09:30"), stop(P.ninenzaka, "11:00"), stop(P.kodaiji, "14:00"), stop(P.nishiki, "16:00")] },
    ];
    const out = runCohesion(plans, { pace, authority: selectedAuthority() });
    results[`cohesion_selected_two_step_${pace}`] = summary(out);
    assertSamePlaces(out, `two-step ${pace}`);
    assertTimelines(out, `two-step ${pace}`);
    assertAreasGrouped(out, `two-step ${pace}`);
  });
}

// 觀察：cohesion 使用的不合併分群（fitToDays:false）把 9 點分成哪些群。
{
  const { clusters } = clusterItemsByGeography(ALL, 3, {
    coords: (p) => ({ lat: p.lat, lng: p.lng }),
    id: (p) => p.id,
    name: () => "",
    address: (p) => p.address,
    weight: (p) => p.userRatingCount ?? 0,
  }, { fitToDays: false });
  results.observation_unmerged_clusters = clusters.map((c) => c.items.map((p) => p.name).join("、"));
}

// ── 6. redistributePlacesEvenly：地理優先切天 ──────────────────────────────
// 註：「錦市場」（名稱含「錦」、type market）會被 filterExcludedRetailPlaces 從 redistribute
// 候選池移除（HEAD 既有行為，與本修正無關），這段改用市中心的六角堂（真實座標，距漫畫博物館約 330m）
// 沿用同一個 id，只驗分群。
const nishikiStreet = {
  ...P.nishiki,
  name: "六角堂",
  address: "六角堂, 京都市中京區, 日本",
  lat: 35.0087,
  lng: 135.7598,
  primaryType: "buddhist_temple",
  types: ["buddhist_temple", "point_of_interest"],
};
const REDIST_POOL = ALL.map((p) => (p.id === P.nishiki.id ? nishikiStreet : p));
const relaxAll = (p) => ALL.some((picked) => picked.id === p.id);
check("redistribute selected_only: 嵐山4／東山3／市中心2，咖啡同天", () => {
  const out = redistributePlacesEvenly({ places: REDIST_POOL, days: 3, style: "mixed", plannedDate: "2026-11-10", relaxDiversityFor: relaxAll });
  results.redistribute_selected = summary(out);
  assertSamePlaces(out, "redistribute selected");
  assertAreasGrouped(out, "redistribute selected");
});
check("redistribute 非 selected_only: 每天 ≥3，咖啡不同天", () => {
  const out = redistributePlacesEvenly({ places: REDIST_POOL, days: 3, style: "mixed", plannedDate: "2026-11-10" });
  results.redistribute_ai = summary(out);
  assertSamePlaces(out, "redistribute ai");
  expect(counts(out).every((n) => n >= 3), `每日點數 ${counts(out)}：${summary(out)}`);
  expect(daysOf(out, CAFES).size === 2, `咖啡同天：${summary(out)}`);
});
// 觀察（不列入 PASS/FAIL）：使用者挑選的「錦市場」在 redistribute 會被零售過濾移除。
results.observation_redistribute_drops_nishiki_market = !redistributePlacesEvenly({
  places: ALL, days: 3, style: "mixed", relaxDiversityFor: relaxAll,
}).some((plan) => idsOfDay(plan).includes(P.nishiki.id));
// 觀察：非 selected_only、12 點、三區 5/4/3 時，redistribute 的每日點數（HEAD 為平均 4/4/4）。
{
  const cluster = (prefix, lat, lng, n) => Array.from({ length: n }, (_, i) =>
    place(`ChIJObs${prefix}${String(i).padStart(14, "0")}`, `${prefix}-${i}`, lat + i * 0.001, lng + i * 0.001, "tourist_attraction"));
  const pool = [...cluster("West", 35.0158, 135.6737, 5), ...cluster("East", 34.9982, 135.7808, 4), ...cluster("North", 35.0394, 135.7292, 3)];
  const out = redistributePlacesEvenly({ places: pool, days: 3, style: "mixed" });
  results.observation_ai_redistribute_12_counts = counts(out);
}

// ── 7. replanUntilItineraryValid：修正後不會再被拆散 ─────────────────────
// 環境觀察：未覆寫前的 validator flag 來源（只記錄布林值與來源，不讀 .env 內容）。
results.environment_validator_flag = {
  ...resolveItineraryValidatorFlag(),
  fromProcessEnv:
    process.env.ITINERARY_VALIDATOR_ENABLED != null || process.env.VITE_ITINERARY_VALIDATOR_ENABLED != null,
};
setItineraryValidatorEnabledOverride(true);
function replan(plans, { slowTravel = false } = {}) {
  const authority = selectedAuthority();
  const validatorInput = {
    requestedDays: 3,
    destination: "京都",
    style: "mixed",
    userText: "",
    generationId: "kyoto-replan",
    validationStage: "final",
    placeAuthority: "selected_only",
    lockedPlaceIds: authority.lockedPlaceIds,
    lockedPlaceNames: authority.lockedPlaceNames,
    slowTravel,
  };
  const initial = validateItineraryPlan({ ...validatorInput, plans });
  const outcome = replanUntilItineraryValid({
    generationId: "kyoto-replan",
    plans,
    pool: ALL,
    days: 3,
    style: "mixed",
    plannedDate: "2026-11-10",
    validatorInput,
    requiredPlaces: ALL,
  }, initial);
  return { initial, outcome };
}
const grouped = () => [
  { day: 1, entries: [stop(P.tenryuji, "09:30"), stop(P.bamboo, "11:00"), stop(P.arabica, "14:00"), stop(P.excafe, "16:00")] },
  { day: 2, entries: [stop(P.kiyomizu, "09:30"), stop(P.ninenzaka, "11:00"), stop(P.kodaiji, "14:00")] },
  { day: 3, entries: [stop(P.nishiki, "11:00"), stop(P.manga, "14:00")] },
];
for (const slowTravel of [false, true]) {
  check(`replan selected_only 已分好群（slowTravel=${slowTravel}）不再拆散`, () => {
    const { initial, outcome } = replan(grouped(), { slowTravel });
    results[`replan_grouped_slow_${slowTravel}`] = {
      initialPass: initial.pass,
      initialFails: initial.failedRules.map((r) => r.code),
      attempts: outcome.attempts,
      pass: outcome.validation.pass,
      fails: outcome.validation.failedRules.map((r) => r.code),
      plan: summary(outcome.plans),
    };
    assertSamePlaces(outcome.plans, "replan grouped");
    assertAreasGrouped(outcome.plans, "replan grouped");
  });
}
// 已分好群、但 D1 有同時段衝突 → 驗證器失敗 → 進入 auto repair（attempts ≥ 1），
// 修完後三區與兩間咖啡仍不可被拆散（類別修復／cohesion／redistribute 都會經過）。
for (const slowTravel of [false, true]) {
  check(`replan selected_only 進入 auto repair（slowTravel=${slowTravel}）後仍維持分組`, () => {
    const plans = grouped();
    plans[0].entries[1] = stop(P.bamboo, "09:30");
    const { initial, outcome } = replan(plans, { slowTravel });
    results[`replan_repair_slow_${slowTravel}`] = {
      initialPass: initial.pass,
      initialFails: initial.failedRules.map((r) => r.code),
      attempts: outcome.attempts,
      pass: outcome.validation.pass,
      fails: outcome.validation.failedRules.map((r) => r.code),
      plan: summary(outcome.plans),
    };
    expect(initial.pass === false, `fixture 應讓驗證器失敗，實際 ${initial.failedRules.map((r) => r.code)}`);
    expect(outcome.attempts >= 1, `auto repair 沒有執行（attempts=${outcome.attempts}）`);
    assertSamePlaces(outcome.plans, "replan repair");
    assertTimelines(outcome.plans, "replan repair");
    assertAreasGrouped(outcome.plans, "replan repair");
  });
}

check("不對外發請求（fetch 呼叫 0 次）", () => {
  expect(fetchCalls === 0, `fetch 被呼叫 ${fetchCalls} 次`);
});

console.log(JSON.stringify(results, null, 2));
for (const name of passed) console.log(`PASS  ${name}`);
for (const failure of failures) console.error(`FAIL  ${failure.name}\n      ${failure.message}`);
console.log(`kyoto selected cohesion: ${passed.length} passed, ${failures.length} failed, fetchCalls=${fetchCalls}`);
if (failures.length) process.exit(1);
process.exit(0);
