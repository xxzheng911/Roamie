#!/usr/bin/env node
/**
 * verify-more-places-cross-destination-r3（A2-MP-T2，tester）：A2-MP-F2（過期 activeRecommendationContext）的獨立驗收。
 *
 * 機制：與 r2（scripts/verify-more-places-cross-destination-r2.mjs，sha c5fb0ec9，不修改）相同，不自建 Harness，改經 r17 執行
 *   （r17 → r16 → r15 → r14 → r13 的正式 Callback 擷取、閉包依賴逐一實作（F2 模組層函式＝該樹正式實作）、Provider／Places／
 *    Credits 計數、Mock Key、外部網路攔截、r15-F Fixture 有效性分類）。樹＝work（F2 後）／mp1（F1 後、F2 前）／a2（post-A2）／
 *    pa2（A2 前）／base（aa2db59）＋ f10／pre。
 *
 * 情境：r2 全部情境（import r2 scenarios，逐字沿用；r2 再 import 原檔 17 案）＋ 本檔新增（只增不減）。
 * 判定：
 *   (1) r2 全部情境：直接呼叫 r2 report()（同一組斷言，逐字沿用；r2 再呼叫原檔 report）。
 *   (2) r3 追加（只新增）：
 *       a. 六欄逐輪：Credits metadata.destination／畫面卡片目的地／Places 搜尋目的地／recommendationSession.destination／
 *          activeRecommendationContext.destinationName／travelContext.destination，不得出現「舊城市」（跨城市互相污染）。
 *       b. MODEL-PATH：目標輪經過 F2 修改點只存在於 r13／r14 模型的路徑（refinement 區塊 MORE_RECOMMENDATIONS＝work L10193、
 *          applyLocalFallback continue＝work L6804；模型仍為 F2 前寫法）→ 該案 work 判定不得為 PASS（記為 UNVERIFIED）。
 *       c. Refinement 1–6（新增情境 RF-*）：已確認範圍內的 Refinement 必須真的執行正式 pushRecommendationRefinement，
 *          六欄全為本輪目的地；舊 Context 不得決定目的地；Credits 只在可信範圍確認後開始、成功只結算一次、無卡退還。
 *       d. work vs mp1：同範圍續推／Refinement 的 geocode／Places 次數不得高於 mp1；Refinement 欄位（budget／cuisine）保留不得退步。
 *
 * 執行：node scripts/verify-more-places-cross-destination-r3.mjs [--conc=N]
 *       （＝ node scripts/verify-destination-authority-phase2-r17.mjs --brief --f10 --pa2 --a2 --mp1 --only=<ids>
 *          --extra-scenarios=scripts/verify-more-places-cross-destination-r3.mjs --out=<scratchpad>/mp-cross-r3.log）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { scenarios as R2_SCENARIOS, report as r2Report } from "./verify-more-places-cross-destination-r2.mjs";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R17 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r17.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const ZERO = { id: "zero", geo: "zero", search: "ok" };
const NULLM = { id: "null", geo: "null", search: "ok" };
const TIMEOUT = { id: "timeout", geo: "timeout", search: "ok" };
const BEITUN = {
  台中北屯: { placeId: "mock-台中市北屯區", country: "台灣", city: "台中市", region: "台中市", district: "北屯區", lat: 24.18, lng: 120.7, formattedName: "台中市北屯區", displayLabel: "台中市北屯區" },
};

/**
 * r3 新增情境。kind：refine（目標輪＝Refinement：必須真的執行正式 pushRecommendationRefinement、六欄＝to、不得出現 forbid）；
 *       refineFailClosed（新目的地 Provider 驗證失敗後的 Refinement：不得以 forbid 搜尋／扣點／顯示卡片，不得把未確認 to 寫成已確認）；
 *       more（目標輪＝續推：卡片／Credits／rec＝to、不得出現 forbid）；info（只列六欄，不判定）。
 * also：其他要列六欄並檢查 forbid 的輪（{ turn, forbid, to }）。
 */
const NEW_SCENARIOS = [
  // Refinement 1：正常京都 Refinement
  { id: "RF-01-kyoto-refine", no: "R1", label: "京都美食 → 便宜一點的（正常京都 Refinement）", turns: ["京都美食", "便宜一點的"], r15Modes: [OK], rf: { kind: "refine", turn: 1, to: "京都" } },
  { id: "RF-01b-kyoto-refine-x2", no: "R1b", label: "京都美食 → 便宜一點的 → 要拉麵（連續 Refinement；欄位保留）", turns: ["京都美食", "便宜一點的", "要拉麵"], r15Modes: [OK], rf: { kind: "refine", turn: 2, to: "京都", also: [{ turn: 1, kind: "refine", to: "京都" }], keepSlots: true } },
  { id: "RF-01c-kyoto-refine-more", no: "R1c", label: "京都美食 → 便宜一點的 → 再推薦幾個（Refinement 後同範圍續推）", turns: ["京都美食", "便宜一點的", "再推薦幾個"], r15Modes: [OK], rf: { kind: "more", turn: 2, to: "京都", also: [{ turn: 1, kind: "refine", to: "京都" }] } },
  // Refinement 2：京都換金澤後 Refinement
  { id: "RF-02-kyoto-kanazawa-refine", no: "R2", label: "京都美食 → 換金澤，再推薦幾個 → 便宜一點的", turns: ["京都美食", "換金澤，再推薦幾個", "便宜一點的"], r15Modes: [OK], rf: { kind: "refine", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "cross", to: "金澤", forbid: "京都" }] } },
  { id: "RF-02b-kyoto-refine-kanazawa-more", no: "R2b", label: "京都美食 → 便宜一點的 → 換金澤，再推薦幾個 → 再推薦幾個（Refinement 後換城市再續推）", turns: ["京都美食", "便宜一點的", "換金澤，再推薦幾個", "再推薦幾個"], r15Modes: [OK], rf: { kind: "more", turn: 3, to: "金澤", forbid: "京都", also: [{ turn: 2, kind: "cross", to: "金澤", forbid: "京都" }] } },
  // Refinement 3：過期 activeRecommendationContext（Session 恢復：rec＝金澤、Context＝京都）
  {
    id: "RF-03a-stale-arc-refine",
    no: "R3a",
    label: "（Session 恢復）recommendationSession=金澤（6 筆、已展示 3）＋travelContext=金澤＋activeRecommendationContext=京都（過期）→ 便宜一點的",
    turns: ["便宜一點的"],
    r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" },
    r17Arc: { destination: "京都", intent: "restaurant" },
    r15Modes: [OK],
    rf: { kind: "refine", turn: 0, to: "金澤", forbid: "京都" },
  },
  {
    id: "RF-03b-stale-arc-more",
    no: "R3b",
    label: "（Session 恢復）recommendationSession=金澤＋travelContext=金澤＋activeRecommendationContext=京都（過期）→ 再推薦幾個",
    turns: ["再推薦幾個"],
    r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" },
    r17Arc: { destination: "京都", intent: "restaurant" },
    r15Modes: [OK],
    rf: { kind: "more", turn: 0, to: "金澤", forbid: "京都" },
  },
  {
    id: "RF-03c-stale-arc-haiyouma",
    no: "R3c",
    label: "（Session 恢復）recommendationSession=金澤＋travelContext=金澤＋activeRecommendationContext=京都（過期）→ 還有嗎",
    turns: ["還有嗎"],
    r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" },
    r17Arc: { destination: "京都", intent: "restaurant" },
    r15Modes: [OK],
    rf: { kind: "more", turn: 0, to: "金澤", forbid: "京都" },
  },
  {
    id: "RF-03d-fresh-arc-refine",
    no: "R3d",
    label: "（對照；Session 恢復）recommendationSession=金澤＋travelContext=金澤＋activeRecommendationContext=金澤（未過期）→ 便宜一點的",
    turns: ["便宜一點的"],
    r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" },
    r17Arc: { destination: "金澤", intent: "restaurant" },
    r15Modes: [OK],
    rf: { kind: "refine", turn: 0, to: "金澤", forbid: "京都" },
  },
  // Refinement 4：同城市不同行政區
  { id: "RF-04a-xitun-refine", no: "R4a", label: "台中西屯美食 → 便宜一點的（行政區 Refinement）", turns: ["台中西屯美食", "便宜一點的"], r15Modes: [OK], rf: { kind: "refine", turn: 1, to: "西屯" } },
  { id: "RF-04b-xitun-beitun-refine", no: "R4b", label: "台中西屯美食 → 換台中北屯，再推薦幾個 → 便宜一點的（同城市不同行政區）", turns: ["台中西屯美食", "換台中北屯，再推薦幾個", "便宜一點的"], r15Real: BEITUN, r15Modes: [OK], rf: { kind: "refine", turn: 2, to: "北屯", forbid: "西屯", also: [{ turn: 1, kind: "cross", to: "北屯", forbid: "西屯" }] } },
  {
    id: "RF-04c-stale-area-arc-refine",
    no: "R4c",
    label: "（Session 恢復）recommendationSession=台中北屯（area）＋travelContext=台中北屯＋activeRecommendationContext=台中西屯（過期）→ 便宜一點的",
    turns: ["便宜一點的"],
    r15Init: { topic: "restaurant", rec: { destination: "台中北屯", parentCity: "台中", area: "北屯", n: 6, batch: 3 }, travelDestination: "台中北屯" },
    r17Arc: { destination: "台中西屯", intent: "restaurant", parentCity: "台中", area: "西屯", searchScope: "area" },
    r15Real: BEITUN,
    r15Modes: [OK],
    rf: { kind: "refine", turn: 0, to: "北屯", forbid: "西屯" },
  },
  // Refinement 5：Reload 後 Refinement
  { id: "RF-05a-reload-kyoto-refine", no: "R5a", label: "京都美食 →（重新載入）→ 便宜一點的", turns: ["京都美食", "便宜一點的"], reloadAfter: 0, r15Modes: [OK], rf: { kind: "refine", turn: 1, to: "京都" } },
  { id: "RF-05b-reload-kanazawa-refine", no: "R5b", label: "京都美食 → 換金澤，再推薦幾個 →（重新載入）→ 便宜一點的", turns: ["京都美食", "換金澤，再推薦幾個", "便宜一點的"], reloadAfter: 1, r15Modes: [OK], rf: { kind: "refine", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "cross", to: "金澤", forbid: "京都" }] } },
  { id: "RF-05c-reload-xitun-refine", no: "R5c", label: "台中西屯美食 →（重新載入）→ 便宜一點的", turns: ["台中西屯美食", "便宜一點的"], reloadAfter: 0, r15Modes: [OK], rf: { kind: "refine", turn: 1, to: "西屯" } },
  // Refinement 6：Provider timeout／null／ZERO_RESULTS
  { id: "RF-06a-kanazawa-fail-refine", no: "R6a", label: "京都美食 → 換金澤，再推薦幾個（金澤 Provider 失敗）→ 便宜一點的（MP-25 類：不得自動搜尋京都）", turns: ["京都美食", "換金澤，再推薦幾個", "便宜一點的"], r15Modes: [TIMEOUT, NULLM, ZERO], rf: { kind: "refineFailClosed", turn: 2, to: "金澤", forbid: "京都", mp25: true, also: [{ turn: 1, kind: "failclosed", to: "金澤", forbid: "京都" }] } },
  { id: "RF-06b-kyoto-refine-provider-fail", no: "R6b", label: "京都美食 → 便宜一點的（Provider timeout／null／ZERO_RESULTS；京都為 Authority）", turns: ["京都美食", "便宜一點的"], r15Modes: [TIMEOUT, NULLM, ZERO], rf: { kind: "refine", turn: 1, to: "京都", vsMp1: true } },
  { id: "RF-06c-xitun-refine-provider-fail", no: "R6c", label: "台中西屯美食 → 便宜一點的（Provider timeout／null／ZERO_RESULTS；行政區需 Provider 驗證）", turns: ["台中西屯美食", "便宜一點的"], r15Modes: [TIMEOUT, NULLM, ZERO], rf: { kind: "refine", turn: 1, to: "西屯", vsMp1: true } },
  { id: "RF-06d-stale-arc-refine-provider-fail", no: "R6d", label: "（Session 恢復）rec=金澤＋Context=京都（過期）→ 便宜一點的（Provider timeout／null／ZERO_RESULTS）", turns: ["便宜一點的"], r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" }, r17Arc: { destination: "京都", intent: "restaurant" }, r15Modes: [TIMEOUT, NULLM, ZERO], rf: { kind: "refineFailClosed", turn: 0, to: "金澤", forbid: "京都" } },
  // 獨立審查：F2 未涵蓋的可能路徑（destination_places 不改推薦池／Context）
  { id: "RF-07-dp-kanazawa-more", no: "R7", label: "（審查）京都美食 → 金澤有什麼好玩的 → 再推薦幾個（destination_places 後續推）", turns: ["京都美食", "金澤有什麼好玩的", "再推薦幾個"], r15Modes: [OK], rf: { kind: "info", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "info", to: "金澤", forbid: "京都" }] } },
  { id: "RF-07b-kyoto-kanazawa-food-refine", no: "R7b", label: "（審查）京都美食 → 金澤美食 → 便宜一點的（新目的地 destination_category 後 Refinement）", turns: ["京都美食", "金澤美食", "便宜一點的"], r15Modes: [OK], rf: { kind: "refine", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "cross", to: "金澤", forbid: "京都" }] } },
  // 獨立審查：本輪「明確點名」城市（named）— 不得用另一城市的池／Context 搜尋、扣點或顯示卡片
  // arbitrate.ts L175-187 只以 activeRecommendationContext.destinationName 判斷「點名換城市」；F2 換城市後清掉 Context
  { id: "RF-08a-kanazawa-then-named-kyoto-indoor", no: "R8a", label: "（審查）京都推薦景點 → 換金澤，再推薦幾個 → 京都有室內景點嗎（點名回京都）", turns: ["京都推薦景點", "換金澤，再推薦幾個", "京都有室內景點嗎"], r15Modes: [OK], rf: { kind: "named", turn: 2, to: "京都", forbid: "金澤" } },
  { id: "RF-08b-kanazawa-then-named-kyoto-cheap", no: "R8b", label: "（審查）京都美食 → 換金澤，再推薦幾個 → 京都便宜一點的（點名回京都）", turns: ["京都美食", "換金澤，再推薦幾個", "京都便宜一點的"], r15Modes: [OK], rf: { kind: "named", turn: 2, to: "京都", forbid: "金澤" } },
  {
    id: "RF-08c-stale-arc-named-kyoto",
    no: "R8c",
    label: "（審查；Session 恢復）rec=金澤＋travelContext=金澤＋Context=京都（過期）→ 京都便宜一點的（點名京都）",
    turns: ["京都便宜一點的"],
    r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 }, travelDestination: "金澤" },
    r17Arc: { destination: "京都", intent: "restaurant" },
    r15Modes: [OK],
    rf: { kind: "named", turn: 0, to: "京都", forbid: "金澤" },
  },
  { id: "RF-08d-kanazawa-then-named-kanazawa-indoor", no: "R8d", label: "（對照）京都推薦景點 → 換金澤，再推薦幾個 → 金澤有室內景點嗎（點名同一新城市）", turns: ["京都推薦景點", "換金澤，再推薦幾個", "金澤有室內景點嗎"], r15Modes: [OK], rf: { kind: "named", turn: 2, to: "金澤", forbid: "京都" } },
  { id: "RF-08e-kyoto-named-kyoto-indoor", no: "R8e", label: "（對照）京都推薦景點 → 京都有室內景點嗎（同城點名）", turns: ["京都推薦景點", "京都有室內景點嗎"], r15Modes: [OK], rf: { kind: "named", turn: 1, to: "京都", forbid: "金澤" } },
  // 獨立審查：destination_places（pushDestinationPlaceRecommendation 不改 rec／Context，只改 travelContext）後續推
  { id: "RF-09a-kyoto-dp-kanazawa-more", no: "R9a", label: "（審查）京都推薦景點 → 金澤必去 → 再推薦幾個（destination_places 換城市後續推）", turns: ["京都推薦景點", "金澤必去", "再推薦幾個"], r15Modes: [OK], rf: { kind: "named", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "info", to: "金澤", forbid: "京都" }] } },
  { id: "RF-09b-kyoto-dp-kanazawa-haiyouma", no: "R9b", label: "（審查）京都推薦景點 → 金澤有哪些必去的地方 → 還有嗎", turns: ["京都推薦景點", "金澤有哪些必去的地方", "還有嗎"], r15Modes: [OK], rf: { kind: "named", turn: 2, to: "金澤", forbid: "京都", also: [{ turn: 1, kind: "info", to: "金澤", forbid: "京都" }] } },
  // isStale 標籤寫法探針（work 正式實作）
  { id: "RF-PROBE-stale-labels", no: "P", label: "（探針）isStaleActiveRecommendationContext 正式實作：同一地點不同寫法是否誤判為過期", turns: [], r17Probe: true, r15Modes: [OK], rf: { kind: "probe" } },
];

export const scenarios = [...R2_SCENARIOS, ...NEW_SCENARIOS];
const R2_IDS = new Set(R2_SCENARIOS.map((s) => s.id));

// ════════════════ 共用 ════════════════
const PLACE_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
const keyOf = (v) => (v == null || v === "" ? null : (PLACE_KEYS.find((k) => String(v).includes(k)) ?? "?"));
const norm = (k) => (k === "金沢" ? "金澤" : k);
const K = (v) => norm(keyOf(v));
const cardDest = (c) => K(`${c?.name ?? ""}|${c?.id ?? ""}`);
const uniq = (a) => [...new Set(a)];
const turnOf = (turns, i) => turns.find((x) => x.turnIndex === i);
const MODEL_PATH_RE = /refinement:MORE_RECOMMENDATIONS|fb_continue\(real\)/;

/** 六欄（本輪結束時）：Credits／卡片／Places／rec／Context／travelContext。 */
function sixCols(t) {
  const searchDests = uniq((t.placesQueries ?? []).map((x) => String(x).split("@").at(-1)));
  return {
    credits: (t.r15Credits ?? []).map((c) => c.destination),
    cards: uniq((t.r15Cards ?? []).map(cardDest)),
    places: searchDests,
    rec: t.r15Rec?.destination ?? null,
    arc: t.r17Arc?.destinationName ?? null,
    tc: t.sessionDest ?? null,
  };
}
const fmtCols = (c) =>
  `Credits=[${c.credits.join(",") || "-"}] 卡片=[${c.cards.join(",") || "-"}] Places=[${c.places.join(",") || "-"}] rec=${c.rec ?? "-"} Context=${c.arc ?? "-"} travelContext=${c.tc ?? "-"}`;
/** 六欄不得出現 forbid（舊城市）。failClosed＝本輪未確認新目的地：rec／Context／travelContext 可保留舊確認值（MP-25 契約），只檢查 Credits／卡片／Places。 */
function sixColsPolluted(c, forbid, { failClosed = false } = {}) {
  if (!forbid) return [];
  const bad = [];
  if (c.credits.some((d) => K(d) === forbid)) bad.push(`Credits metadata.destination 含「${forbid}」`);
  if (c.cards.includes(forbid)) bad.push(`畫面卡片含「${forbid}」`);
  if (c.places.some((d) => K(d) === forbid)) bad.push(`Places 搜尋「${forbid}」`);
  if (!failClosed) {
    if (K(c.rec) === forbid) bad.push(`recommendationSession.destination=${c.rec}`);
    if (K(c.arc) === forbid) bad.push(`activeRecommendationContext.destinationName=${c.arc}`);
    if (K(c.tc) === forbid) bad.push(`travelContext.destination=${c.tc}`);
  }
  return bad;
}
const confirmedOf = (t) => {
  const s = (t.r15Flows ?? []).filter((f) => !f.nested && f.fn === "resolveTrustedRecommendationSearchScope").at(-1);
  if (s) return s.status === "trusted" ? s.destination : `未確認(${s.reason ?? s.status})`;
  const m = (t.r15Flows ?? []).filter((f) => !f.nested && f.fn === "resolveMorePlacesTurnDestination").at(-1);
  return m ? (m.status === "trusted" ? m.destination : "未確認(more_places)") : "-";
};
function creditsCheck(t) {
  const fails = [];
  const cards = t.r15Cards ?? [];
  const credits = t.r15Credits ?? [];
  const settle = t.creditsSettle ?? [];
  const rpc = t.creditsRpc ?? [];
  if (settle.length !== credits.length) fails.push(`Credits begin=${credits.length} settle=${settle.length}`);
  if (settle.filter((x) => x === true).length !== (cards.length ? 1 : 0)) fails.push(`Credits 成功結算=${settle.filter((x) => x === true).length}（卡片=${cards.length}）`);
  const reserves = rpc.filter((x) => x === "credits_reserve").length;
  if (reserves !== rpc.filter((x) => x === "credits_commit" || x === "credits_rollback").length) fails.push(`reserve=${reserves} 與 commit＋rollback 不一致（${rpc.join(",")}）`);
  if (rpc.filter((x) => x === "credits_commit").length !== (cards.length ? 1 : 0)) fails.push(`credits_commit=${rpc.filter((x) => x === "credits_commit").length}（卡片=${cards.length}）`);
  return fails;
}

/**
 * r3 新增情境的目標輪判定。prev＝上一輪 obs（第一輪＝情境初始 Session 的 rec／Context），只用於判斷「本輪寫入」：
 * rec／Context 與上一輪相同＝沿用既有狀態，不算本輪寫入未確認目的地。
 */
function judgeRf(kind, spec, t, prev) {
  const fails = [];
  const notes = [];
  const c = sixCols(t);
  const cards = t.r15Cards ?? [];
  const refined = /real:refine=T/.test(String(t.path ?? ""));
  const failClosed = /^未確認|^-$/.test(confirmedOf(t)) && !cards.length && !(t.r15Credits ?? []).length && !(t.placesRequests > 0);
  const wroteRec = K(c.rec) !== K(prev?.rec ?? null);
  const wroteArc = K(c.arc) !== K(prev?.arc ?? null);
  if (kind === "info") return { fails, notes: [`（資訊）path=${String(t.path ?? "").slice(0, 160)}`], c };
  if (kind === "named") {
    // 使用者本輪明確點名 to：不得以 forbid（另一城市）搜尋／扣點／顯示卡片；有卡片時必須全是 to；Credits 結算規則同上
    fails.push(...sixColsPolluted(c, spec.forbid, { failClosed: true }).map((x) => `${x}（使用者點名「${spec.to}」）`));
    if (cards.some((x) => cardDest(x) !== spec.to)) fails.push(`卡片目的地=${uniq(cards.map(cardDest)).join(",")} ≠ 點名「${spec.to}」`);
    if (c.credits.some((d) => K(d) !== spec.to)) fails.push(`Credits metadata.destination=${c.credits.join(",")} ≠ 點名「${spec.to}」`);
    fails.push(...creditsCheck(t));
    notes.push(`refine 執行=${refined} 本輪確認=${confirmedOf(t)} 卡片=${cards.length}`);
    return { fails, notes, c };
  }
  if (kind === "failclosed") {
    if (t.placesRequests > 0) fails.push(`Provider 驗證失敗仍搜尋 Places（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) fails.push("Provider 驗證失敗仍開始 Credits");
    if (cards.length) fails.push("Provider 驗證失敗仍顯示卡片");
    if (K(c.rec) === spec.to && wroteRec) fails.push(`recommendationSession 寫入未確認「${c.rec}」`);
    if (K(c.arc) === spec.to && wroteArc) fails.push(`activeRecommendationContext 寫入未確認「${c.arc}」`);
    fails.push(...sixColsPolluted(c, spec.forbid, { failClosed: true }));
    return { fails, notes, c };
  }
  if (kind === "refineFailClosed") {
    fails.push(...sixColsPolluted(c, spec.forbid, { failClosed: true }).map((x) => `${x}（舊 Context／舊確認目的地被自動搜尋）`));
    if (K(c.rec) === spec.to && failClosed && wroteRec) fails.push(`recommendationSession 寫入未確認「${c.rec}」`);
    if (K(c.arc) === spec.to && failClosed && wroteArc) fails.push(`activeRecommendationContext 寫入未確認「${c.arc}」`);
    if (cards.length && cards.some((x) => cardDest(x) !== spec.to)) fails.push(`顯示非本輪目的地卡片：${uniq(cards.map(cardDest)).join(",")}`);
    fails.push(...creditsCheck(t));
    notes.push(`refine 執行=${refined} 本輪確認=${confirmedOf(t)}`);
    return { fails, notes, c };
  }
  // refine 但本輪沒有執行正式 pushRecommendationRefinement：Refinement 未測到 → PRECOND（不算 PASS）；跨城市污染仍判 FAIL
  if (kind === "refine" && !refined) {
    fails.push(...sixColsPolluted(c, spec.forbid));
    fails.push(`PRECOND：本輪沒有執行正式 pushRecommendationRefinement（path=${String(t.path ?? "").slice(0, 120)}；卡片=${cards.length}）`);
    return { fails, notes, c };
  }
  // refine／more／cross：六欄＝to、不得出現 forbid
  fails.push(...sixColsPolluted(c, spec.forbid));
  if (!cards.length) fails.push("沒有顯示任何卡片");
  if (cards.some((x) => cardDest(x) !== spec.to)) fails.push(`卡片目的地=${uniq(cards.map(cardDest)).join(",")} ≠ ${spec.to}`);
  if (c.credits.some((d) => K(d) !== spec.to)) fails.push(`Credits metadata.destination=${c.credits.join(",")} ≠ ${spec.to}`);
  if (c.places.some((d) => K(d) !== spec.to)) fails.push(`Places 搜尋目的地=${c.places.join(",")} ≠ ${spec.to}`);
  if (K(c.rec) !== spec.to) fails.push(`recommendationSession.destination=${c.rec ?? "-"} ≠ ${spec.to}`);
  if (c.arc != null && K(c.arc) !== spec.to) fails.push(`activeRecommendationContext.destinationName=${c.arc} ≠ ${spec.to}`);
  if (c.tc != null && K(c.tc) !== spec.to) fails.push(`travelContext.destination=${c.tc} ≠ ${spec.to}`);
  fails.push(...creditsCheck(t));
  return { fails, notes, c };
}

// ════════════════ report ════════════════
export function report({ results, TREES, out }) {
  // (1) r2 全部情境（同一組斷言；r2 再呼叫原檔 report）
  const o0 = out.length;
  const r2 = r2Report({ results, TREES, out });
  const r2Rows = new Map();
  for (const line of out.slice(o0)) {
    const m = line.match(/^ {2}(\S+?)\[(\w+)\](?:（原 FAIL 5 案之一）)? work=(\S+?)（原檔斷言=(\S+?)） a2=(\S+?)（/);
    if (m) r2Rows.set(`${m[1]}|${m[2]}`, { work: m[3], core: m[4], a2: m[5], cost: / 成本對照=FAIL/.test(line) });
  }
  const SHOW = ["work", "mp1", "a2", "pa2", "base"].filter((t) => TREES.includes(t));
  const state = { rows: [], pass: 0, fail: 0, precond: 0, unverified: 0, info: 0, infra: 0, mp25: 0 };
  out.push("\n══════════════ more_places r3（A2-MP-T2；r17 掛載；樹 work／mp1／a2／pa2／base）══════════════");
  out.push("  六欄＝Credits metadata.destination｜畫面卡片目的地｜Places 搜尋目的地｜recommendationSession.destination｜activeRecommendationContext.destinationName｜travelContext.destination");
  out.push("  MODEL-PATH＝目標輪經過 F2 只存在於 r13／r14 模型的路徑（refinement:MORE_RECOMMENDATIONS＝work L10193、fb_continue＝work L6804）→ 不得判 PASS");

  // (2a) r2 情境：六欄逐輪＋MODEL-PATH＋work 判定合併
  for (const s of R2_SCENARIOS) {
    for (const m of s.r15Modes) {
      const key = `${s.id}|${m.id}`;
      const mp = s.mp;
      // 每個目標輪各自的「舊城市」：主目標＝cross／noRevive／failclosed 的 from（same 只在 crossFrom 時）；alsoCross＝crossFrom ?? from；
      // noReviveTurn＝from；alsoSame（同城對照輪）＝無（該輪本來就應是同一城市）
      const forbidOf = new Map();
      forbidOf.set(mp.turn, mp.kind === "same" ? (mp.crossFrom ? norm(mp.crossFrom) : null) : mp.kind === "cross" || mp.kind === "noRevive" || mp.kind === "failclosed" ? norm(mp.from) : null);
      if (mp.alsoSame != null && !forbidOf.has(mp.alsoSame)) forbidOf.set(mp.alsoSame, null);
      if (mp.alsoCross != null) forbidOf.set(mp.alsoCross, norm(mp.crossFrom ?? mp.from));
      if (mp.noReviveTurn != null) forbidOf.set(mp.noReviveTurn, norm(mp.from));
      const detail = s.id === "MP-24-kanazawa-then-more" || s.id === "MP-13-empty-then-more" || s.id === "MP-25-kanazawa-timeout-retry";
      const targetTurns = [...forbidOf.keys()];
      out.push(`\n[r3][${s.id}][${m.id}] 案例 ${s.no}：${s.label}`);
      const per = {};
      for (const tree of SHOW) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        if (r.err || r.result?.error) {
          per[tree] = { infra: true };
          out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
          continue;
        }
        const turns = r.result.turns ?? [];
        const pol = [];
        const model = [];
        const showTurns = detail ? turns.map((x) => x.turnIndex) : targetTurns;
        for (const ti of showTurns) {
          const t = turnOf(turns, ti);
          if (!t) continue;
          const c = sixCols(t);
          const isTarget = targetTurns.includes(ti);
          const fc = /^未確認|^-$/.test(confirmedOf(t)) && !(t.r15Cards ?? []).length && !(t.r15Credits ?? []).length;
          const forbid = isTarget ? forbidOf.get(ti) : null;
          const bad = isTarget && forbid ? sixColsPolluted(c, forbid, { failClosed: fc || (ti === mp.turn && mp.kind === "failclosed") }) : [];
          const mpth = isTarget && MODEL_PATH_RE.test(String(t.path ?? ""));
          if (bad.length) pol.push(`T${ti + 1}:${bad.join("、")}`);
          if (mpth) model.push(`T${ti + 1}`);
          out.push(`  ${tree.padEnd(5)} T${ti + 1}「${t.text}」${isTarget ? "（目標）" : ""} 確認=${confirmedOf(t)} ${fmtCols(c)}${mpth ? " ［MODEL-PATH］" : ""}${bad.length ? ` ← 六欄污染：${bad.join("、")}` : ""}`);
          if (detail) out.push(`        path=${String(t.path ?? "").slice(0, 200)} geocode=${t.geocodes?.length ?? 0} placesReq=${t.placesRequests ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] stale=${JSON.stringify(t.r17StaleCalls ?? null)} match=${JSON.stringify(t.r17MatchCalls ?? null)} pending=${JSON.stringify(t.r17Pending ?? null)}`);
        }
        per[tree] = { pol, model };
      }
      const row = r2Rows.get(key);
      const w = per.work;
      let v = row?.work ?? "-";
      const why = [];
      if (w?.infra) v = "INFRA";
      if (w?.pol?.length) {
        why.push(`六欄污染 ${w.pol.join("；")}`);
        if (v === "PASS") v = "FAIL";
      }
      if (w?.model?.length && v === "PASS") {
        v = "UNVERIFIED";
        why.push(`MODEL-PATH ${w.model.join(",")}`);
      }
      const mp1Pol = per.mp1?.pol?.length ? "污染" : per.mp1 ? "無污染" : "-";
      out.push(`  判定（work）：r2=${row?.work ?? "-"}（原檔斷言=${row?.core ?? "-"}${row?.cost ? "；成本對照=FAIL" : ""}）｜r3 六欄=${w?.pol?.length ? "FAIL" : "PASS"}｜MODEL-PATH=${w?.model?.length ? w.model.join(",") : "無"} → ${v}${why.length ? ` ← ${why.join("；")}` : ""}（mp1 六欄=${mp1Pol}）`);
      state.rows.push(`${s.id}[${m.id}] work=${v}（r2=${row?.work ?? "-"}${row?.cost ? "／成本對照 FAIL" : ""}） 六欄 work=${w?.pol?.length ? "FAIL" : "PASS"} mp1=${mp1Pol}${w?.model?.length ? ` MODEL-PATH=${w.model.join(",")}` : ""}`);
      if (v === "PASS") state.pass += 1;
      else if (v === "FAIL") state.fail += 1;
      else if (v === "PRECOND") state.precond += 1;
      else if (v === "UNVERIFIED") state.unverified += 1;
      else if (v === "INFRA") state.infra += 1;
      else state.info += 1;
    }
  }

  // (2b) r3 新增情境
  for (const s of NEW_SCENARIOS) {
    for (const m of s.r15Modes) {
      const rf = s.rf;
      out.push(`\n[r3][${s.id}][${m.id}] ${s.no}：${s.label}`);
      if (rf.kind === "probe") {
        for (const tree of SHOW) {
          const r = results[`${tree}|${m.id}|${s.id}`];
          const pr = r?.result?.r17Probe;
          if (!r) continue;
          if (r.err || r.result?.error) {
            out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
            continue;
          }
          if (!pr || pr.na) {
            out.push(`  ${tree.padEnd(5)} （該樹沒有 isStale 正式實作：N/A）`);
            continue;
          }
          const wrong = pr.rows.filter((x) => x.got !== x.want);
          out.push(`  ${tree.padEnd(5)} isStale(arc, rec)：${pr.rows.map((x) => `${x.arc}/${x.rec}=${x.got}${x.got !== x.want ? "✗" : ""}`).join("；")}`);
          out.push(`        isStale(arc, travelContext)：${pr.tc.map((x) => `${x.arc}/${x.travelContext}=${x.got}${x.got !== x.want ? "✗" : ""}`).join("；")}`);
          out.push(`        activeRecommendationContextMatchesTrustedScope(台中西屯 area ctx, trusted)：${pr.scope.map((x) => `${x.trusted}=${x.got}`).join("；")}`);
          out.push(`        同地點寫法誤判為過期：${wrong.filter((x) => !x.want).map((x) => `${x.arc}/${x.rec}`).join("、") || "無"}；不同城市未判為過期：${wrong.filter((x) => x.want).map((x) => `${x.arc}/${x.rec}`).join("、") || "無"}`);
          if (tree === "work") state.rows.push(`${s.id}[${m.id}] work=INFO（誤判過期 ${wrong.filter((x) => !x.want).length} 組：${wrong.filter((x) => !x.want).map((x) => `${x.arc}/${x.rec}`).join("、") || "無"}）`);
        }
        state.info += 1;
        continue;
      }
      const per = {};
      for (const tree of SHOW) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        if (r.err || r.result?.error) {
          per[tree] = { v: "INFRA" };
          out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
          continue;
        }
        const turns = r.result.turns ?? [];
        const all = [];
        let model = [];
        const targets = [{ turn: rf.turn, kind: rf.kind, to: rf.to, forbid: rf.forbid }, ...(rf.also ?? []).map((x) => ({ forbid: rf.forbid, ...x }))];
        let prevCols = { rec: s.r15Init?.rec?.destination ?? null, arc: s.r17Arc?.destination ?? null };
        for (const t of turns) {
          const tg = targets.find((x) => x.turn === t.turnIndex);
          const res = tg ? judgeRf(tg.kind, tg, t, prevCols) : { fails: [], notes: [], c: sixCols(t) };
          prevCols = res.c;
          const mpth = tg && MODEL_PATH_RE.test(String(t.path ?? ""));
          if (mpth) model.push(`T${t.turnIndex + 1}`);
          if (tg) all.push(...res.fails.map((f) => `T${t.turnIndex + 1}:${f}`));
          out.push(`  ${tree.padEnd(5)} T${t.turnIndex + 1}「${t.text}」${tg ? `（${tg.kind}→${tg.to}）` : ""} 確認=${confirmedOf(t)} ${fmtCols(res.c)}${mpth ? " ［MODEL-PATH］" : ""}`);
          out.push(`        path=${String(t.path ?? "").slice(0, 200)} geocode=${t.geocodes?.length ?? 0}[${(t.geocodes ?? []).join(",")}] placesReq=${t.placesRequests ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] arc=${JSON.stringify(t.r17Arc ?? null)} stale=${JSON.stringify(t.r17StaleCalls ?? null)}${res.notes.length ? ` ${res.notes.join("；")}` : ""}`);
          if (tg && res.fails.length) out.push(`        ✗ ${res.fails.join("；")}`);
        }
        // 只在 r3 新增情境的 work 判定：Refinement 欄位保留（vs mp1）、成本（vs mp1）
        per[tree] = { turns, all, model };
      }
      const w = per.work;
      const extra = [];
      if (w?.turns && per.mp1?.turns) {
        const sumG = (ts) => ts.reduce((a, t) => a + (t.geocodes?.length ?? 0), 0);
        const sumP = (ts) => ts.reduce((a, t) => a + (t.placesRequests ?? 0), 0);
        const same = !rf.forbid;
        if (same && sumG(w.turns) > sumG(per.mp1.turns)) extra.push(`[成本] 情境總 geocode work=${sumG(w.turns)} > mp1=${sumG(per.mp1.turns)}`);
        if (same && sumP(w.turns) > sumP(per.mp1.turns)) extra.push(`[成本] 情境總 Places work=${sumP(w.turns)} > mp1=${sumP(per.mp1.turns)}`);
        if (rf.keepSlots) {
          const slot = (ts) => JSON.stringify((turnOf(ts, rf.turn)?.r17Arc ?? {}) && { budget: turnOf(ts, rf.turn)?.r17Arc?.budget ?? null, cuisine: turnOf(ts, rf.turn)?.r17Arc?.cuisine ?? null });
          if (slot(w.turns) !== slot(per.mp1.turns)) extra.push(`[Refinement 欄位] work=${slot(w.turns)} ≠ mp1=${slot(per.mp1.turns)}（退步？）`);
        }
        if (rf.vsMp1) {
          const wc = (turnOf(w.turns, rf.turn)?.r15Cards ?? []).length;
          const mc = (turnOf(per.mp1.turns, rf.turn)?.r15Cards ?? []).length;
          if (!wc && mc) extra.push(`[退步] work 無卡片、mp1 有 ${mc} 張`);
        }
      }
      let v;
      const precond = (w?.all ?? []).some((f) => f.includes("PRECOND："));
      const realFails = (w?.all ?? []).filter((f) => !f.includes("PRECOND："));
      if (!w) v = "-";
      else if (w.v === "INFRA") v = "INFRA";
      else if (rf.kind === "info") v = "INFO";
      else if (realFails.length || extra.length) v = "FAIL";
      else if (rf.vsMp1 && precond) {
        // Provider 失敗模式：mp1 同樣沒有進入 Refinement → 無退步（不是 PASS：未測到 Refinement 本身）
        const mpPre = (per.mp1?.all ?? []).some((f) => f.includes("PRECOND："));
        v = mpPre ? "PRECOND" : "FAIL";
        if (!mpPre) extra.push("[退步] mp1 有進入 Refinement、work 沒有");
      } else if (precond) v = "PRECOND";
      else if (w.model.length) v = "UNVERIFIED";
      else v = "PASS";
      if (v === "FAIL" && rf.mp25) state.mp25 += 1;
      // 失敗分類：同一輪同一訊息 mp1 也有＝既有（F2 前即如此）；mp1 沒有＝F2 後新出現
      const mp1Set = new Set(per.mp1?.all ?? []);
      const newAfterF2 = realFails.filter((f) => !mp1Set.has(f));
      if (realFails.length) out.push(`  失敗分類（vs mp1）：既有=${realFails.length - newAfterF2.length}｜F2 後新出現=${newAfterF2.length}${newAfterF2.length ? ` ← ${newAfterF2.join("；")}` : ""}`);
      if (v === "FAIL") state.newAfterF2 = (state.newAfterF2 ?? 0) + (newAfterF2.length ? 1 : 0);
      const vMp1 = per.mp1 ? (per.mp1.v === "INFRA" ? "INFRA" : per.mp1.all.filter((f) => !f.includes("PRECOND：")).length ? "FAIL" : per.mp1.all.length ? "PRECOND" : "PASS") : "-";
      const vA2 = per.a2 ? (per.a2.v === "INFRA" ? "INFRA" : per.a2.all.filter((f) => !f.includes("PRECOND：")).length ? "FAIL" : per.a2.all.length ? "PRECOND" : "PASS") : "-";
      out.push(`  判定（work）：${v}${realFails.length ? ` ← ${realFails.join("；")}` : ""}${extra.length ? ` ｜ ${extra.join("；")}` : ""}${precond && v !== "FAIL" ? "（未進入 Refinement＝未測到，不算 PASS）" : ""}${w?.model?.length ? ` ｜ MODEL-PATH=${w.model.join(",")}` : ""}${rf.mp25 && v === "FAIL" ? "（MP-25 類：契約未施工）" : ""}｜mp1=${vMp1} a2=${vA2}`);
      state.rows.push(`${s.id}[${m.id}] work=${v}${rf.mp25 && v === "FAIL" ? "（MP-25 類）" : ""}${v === "FAIL" ? `（F2 後新出現=${newAfterF2.length}）` : ""} mp1=${vMp1} a2=${vA2}${w?.model?.length ? ` MODEL-PATH=${w.model.join(",")}` : ""}`);
      if (v === "PASS") state.pass += 1;
      else if (v === "FAIL") state.fail += 1;
      else if (v === "PRECOND") state.precond += 1;
      else if (v === "UNVERIFIED") state.unverified += 1;
      else if (v === "INFRA") state.infra += 1;
      else state.info += 1;
    }
  }
  out.push("\n── more_places r3：逐案總表（work；r2 情境＝r2 判定＋r3 六欄／MODEL-PATH；RF＝r3 新增）──", ...state.rows.map((x) => `  ${x}`));
  out.push(`more_places r3（work，全部 ${scenarios.length} 情境×mode）：PASS=${state.pass} FAIL=${state.fail}（其中 MP-25 類 ${state.mp25}；RF 含 F2 後新出現失敗 ${state.newAfterF2 ?? 0} 案） PRECOND=${state.precond} UNVERIFIED(MODEL-PATH)=${state.unverified} INFO=${state.info} INFRA=${state.infra}；r2 report fail 計數=${r2.fail}`);
  return { fail: state.fail + state.precond + state.infra + state.unverified + (r2.fail ? 0 : 0), pass: state.pass };
}

// ── 直接執行：以 r17 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [R17, "--brief", "--f10", "--pa2", "--a2", "--mp1", `--only=${scenarios.map((s) => s.id).join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/mp-cross-r3.log`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
