#!/usr/bin/env node
/**
 * verify-more-places-destination-switch-mp25-r2（A2-MP-T5，tester）：MP-25「換目的地驗證失敗」失敗測試第 2 版（施工前預期 work FAIL）。
 * 舊版 scripts/verify-more-places-destination-switch-mp25.mjs 保留不改；本檔只「加嚴或修正寫反的條件」（逐條見 CHANGES／--emit-diff）。
 *
 * 契約（使用者原文＋A2-MP-T4 後裁決）：京都 → 換金澤 → Provider 失敗時必須：保存尚未完成的切換意圖（pendingClarification
 *   destination_switch：rawGeographicLabel／previousConfirmedDestination／categoryIntent／originatingRoute="more_places"）、不搜尋 Places、
 *   不開始 Credits、不覆蓋原本可信目的地、不自動回到京都續推、不顯示 noMore／替代推薦提問。下一輪「好」「再推薦幾個」「便宜一點的」不得
 *   觸發京都搜尋或扣點。明確確認金澤：只把原始請求交回既有 Destination Authority 驗證，驗證成功（且結果＝待確認目的地）才切換。
 *   再次 timeout／null／ZERO_RESULTS：維持 unavailable、不搜尋、不扣點、不得無限重問或無限重試。明確選擇京都：清除 Pending 後沿用可信京都。
 *   新的明確目的地優先於舊 Pending。Client 保存的 Pending（含 previousConfirmedDestination）不是 Provider 證據。
 * 只以「行為」斷言（Session 中的 Pending、Provider／Credits 次數、六欄目的地、助理回覆），不限定 if／switch／helper 名稱。
 *
 * 上限（本檔訂定；理由見 LIMITS）：
 *   Q1 同一輪 待確認城市 *_validate geocode ≤ 1；weather 階段 geocode ≤ 1、weather 請求 ≤ 1（分開計數）。
 *   Q2 非確認輪（hold／idle／chooseOld／oldMore／cancel／noRevive）待確認城市 *_validate geocode = 0。
 *   Q3 同一 Pending 生命週期的自動 Provider 驗證 ≤ 2 次（切換輪 1＋第一次明確確認 1）；第二次以後的確認失敗輪（confirmCapped）= 0。
 *   Q4 同一 Pending 的「確認詢問」（輪末仍是同一 destination_switch Pending、且本輪助理回覆提及該城市）≤ 3 輪。
 *   Q5 確認成功輪：Places 請求 ≤ 2、Builder ≤ 1、Weather ≤ 1、Credits.begin＝1。
 *
 * 機制：不自建 Harness；以 r19（--extra-scenarios=本檔）執行：正式 Callback／send() 區塊擷取（destination_switch handler 依位置擷取 r19-H）、
 *   Mock Provider（逐輪模式 r18GeoByTurn；本檔情境另以 r19Coords 給金澤／京都／大阪不同座標）、Credits RPC Mock、外部網路攔截、
 *   故障模式 r19ThrowMoreOnce（續推 Callback 拋錯 → 正式 catch → applyLocalFallback → 正式 fallback continue）。
 *   Reload＝r13 Harness 以 persisted JSON 開新程序（真實 saveChatSession／loadChatSession 未執行 → UNVERIFIED）。
 *
 * 執行：node scripts/verify-more-places-destination-switch-mp25-r2.mjs [--conc=N] [--with-r19-subset]
 *       （＝ node scripts/verify-destination-authority-phase2-r19.mjs --brief --a2 --mp1 --only=<ids> --extra-scenarios=本檔 --out=<scratchpad>/mp25-r2.log；
 *         --with-r19-subset 另加 --pa2 與 R10-a2-kyoto-kanazawa-more、R15-PROBE，輸出 <scratchpad>/r19-subset.log）
 *       node scripts/verify-more-places-destination-switch-mp25-r2.mjs --emit-diff   （寫 <scratchpad>/mp25-r2.diff）
 */
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R19 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r19.mjs`;
const OLD = `${WORK_ROOT}/scripts/verify-more-places-destination-switch-mp25.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const T1 = "京都推薦景點";
const T2 = "換金澤，再推薦幾個";
const FAULT_MORE = { text: "再推薦幾個", fault: "r19ThrowMoreOnce" };
/** 修正 6：金澤／京都／大阪不同 Mock 座標（只在本檔外掛情境；r13 情境不受影響）。 */
const COORDS = { 金澤: { lat: 36.5613, lng: 136.6562 }, 京都: { lat: 35.0116, lng: 135.7681 }, 大阪: { lat: 34.6937, lng: 135.5023 } };
const FORGED = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: T2 };
/** 修正 2：Client 端偽造 previousConfirmedDestination（未確認城市大阪；可信 Session＝京都）。 */
const FORGED_PREV = { ...FORGED, previousConfirmedDestination: "大阪" };
/** Client 端偽造 Pending 夾帶搜尋欄位（中心／範圍／可搜尋標籤）。 */
const FORGED_FIELDS = { ...FORGED, center: { lat: 36.5613, lng: 136.6562 }, searchScope: "city", radius: 3000, confirmedParentCity: "金澤" };
const INIT_KYOTO = { topic: "attraction", rec: { destination: "京都", n: 6, batch: 3 }, travelDestination: "京都" };

export const LIMITS = {
  validatePerTurn: 1, // Q1：每輪最多 1 次（去重；不重試）
  weatherGeoPerTurn: 1,
  weatherPerTurn: 1,
  validatePerPending: 2, // Q3：切換輪 1＋第一次明確確認 1（給暫時性 timeout 一次重試機會；之後連續失敗＝Provider 不可用，再試只增加成本、回覆相同）
  asksPerPending: 3, // Q4：切換失敗 1＋確認失敗 1＋到達上限的告知 1；之後不得再以同一 Pending 詢問
  confirmPlaces: 2, // Q5：確認成功輪 Places 請求上限（＝既有 destination-category 路徑 T1 京都 2 次；more_places 路徑 r18-N C5 為 1）
  confirmBuilder: 1,
  confirmWeather: 1,
};

/**
 * expect[turnIndex]＝該輪的行為類型（舊版全部保留；★＝本版新增）：
 *   origin / switchFail / hold / chooseOld / oldMore / confirmNew / newMore / confirmFail / idle / cancel / noRevive / replace / same / forgedHold / forgedOk（同舊版）
 *   ★confirmCapped   第二次（含）以後的確認失敗輪：不得再自動驗證（Q3）、不搜尋、不扣點、不回京都、pending 保留（同 confirmFail）
 *   ★forgedPrevKeep  偽造 previousConfirmedDestination＋「繼續原本的」：大阪不得被驗證／搜尋／扣點／寫入；以 Session 可信京都為準或安全停止；pending 清除
 *   ★forgedPrevCancel 偽造 previousConfirmedDestination＋「不用了」：同上（大阪）；pending 清除；金澤不得出現
 *   ★forgedPrevYes   偽造 previousConfirmedDestination＋「好」（Provider 成功）：大阪同上；金澤只能在本輪驗證後使用（同 forgedOk）
 *   ★forgedPrevHold  偽造 previousConfirmedDestination＋「好」（Provider 失敗）：大阪同上＋forgedHold
 */
const NEW_SCENARIOS = [
  { case: 1, id: "MP25R2-01-switch-fail-timeout", label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider timeout）", turns: [T1, T2], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail"] },
  { case: 2, id: "MP25R2-02-fail-then-more", label: "… → 換金澤（timeout）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 2, id: "MP25R2-02b-fail-then-more-fault", label: "… → 換金澤（timeout）→ 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback］", turns: [T1, T2, FAULT_MORE], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 3, id: "MP25R2-03-fail-then-cheaper", label: "… → 換金澤（timeout）→ 便宜一點的", turns: [T1, T2, "便宜一點的"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 4, id: "MP25R2-04-choose-kyoto", label: "… → 換金澤（timeout）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "chooseOld", "oldMore"] },
  { case: 5, id: "MP25R2-05-confirm-kanazawa-yes", label: "… → 換金澤（timeout）→ 好（Provider 成功）→ 再推薦幾個", turns: [T1, T2, "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew", "newMore"] },
  { case: 5, id: "MP25R2-05b-confirm-kanazawa-echo", label: "… → 換金澤（timeout）→ 金澤（Provider 成功）", turns: [T1, T2, "金澤"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"] },
  { case: 6, id: "MP25R2-06-confirm-timeout-again", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（timeout）→ 再推薦幾個", turns: [T1, T2, "好", "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "idle"] },
  { case: 6, id: "MP25R2-06b-confirm-timeout-repeat", label: "… → 換金澤（timeout）→ 好 ×4（皆 timeout）", turns: [T1, T2, "好", "好", "好", "好"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout", 5: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "confirmCapped", "confirmCapped"] },
  { case: 7, id: "MP25R2-07-switch-fail-null", label: "… → 換金澤（Provider null）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "null" }, expect: ["origin", "switchFail", "hold"] },
  { case: 7, id: "MP25R2-07b-confirm-null-again", label: "… → 換金澤（null）→ 好（null）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "null", 2: "null" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 8, id: "MP25R2-08-switch-fail-zero", label: "… → 換金澤（ZERO_RESULTS）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "zero" }, expect: ["origin", "switchFail", "hold"] },
  { case: 8, id: "MP25R2-08b-confirm-zero-again", label: "… → 換金澤（ZERO_RESULTS）→ 好（ZERO_RESULTS）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "zero", 2: "zero" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 9, id: "MP25R2-09-reload-confirm", label: "… → 換金澤（timeout）→（重新載入）→ 好（Provider 成功）", turns: [T1, T2, "好"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"], restoredAt: 2 },
  { case: 9, id: "MP25R2-09b-reload-more", label: "… → 換金澤（timeout）→（重新載入）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"], restoredAt: 2 },
  { case: 10, id: "MP25R2-10-cancel-reload", label: "… → 換金澤（timeout）→ 不用了 →（重新載入）→ 好", turns: [T1, T2, "不用了", "好"], reloadAfter: 2, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "cancel", "noRevive"] },
  { case: 11, id: "MP25R2-11-replace-osaka", label: "… → 換金澤（timeout）→ 換大阪，再推薦幾個（Provider 成功）→ 好", turns: [T1, T2, "換大阪，再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "replace", "noRevive"] },
  { case: 12, id: "MP25R2-12-same-kyoto", label: "（對照）京都推薦景點 → 再推薦幾個 → 再推薦幾個", turns: [T1, "再推薦幾個", "再推薦幾個"], expect: ["origin", "same", "same"] },
  { case: 12, id: "MP25R2-12b-same-kyoto-fault", label: "（對照）京都推薦景點 → 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback → 正式 fallback continue］", turns: [T1, FAULT_MORE], expect: ["origin", "same"], requireFbContinue: [1] },
  { case: 14, id: "MP25R2-14-forged-pending-timeout", label: "（Session 恢復：rec=京都＋Client 保存的 destination_switch pending=金澤）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  { case: 14, id: "MP25R2-14b-forged-pending-ok", label: "（同上）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, expect: ["forgedOk"] },
  { case: 14, id: "MP25R2-14c-forged-prev-keep", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 繼續原本的", turns: ["繼續原本的"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevKeep"] },
  { case: 14, id: "MP25R2-14d-forged-prev-cancel", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 不用了", turns: ["不用了"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevCancel"] },
  { case: 14, id: "MP25R2-14e-forged-prev-yes", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevYes"] },
  { case: 14, id: "MP25R2-14f-forged-prev-timeout", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedPrevHold"] },
  { case: 14, id: "MP25R2-14g-forged-fields-timeout", label: "（rec=京都＋Client pending 夾帶 center／searchScope／radius／confirmedParentCity）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_FIELDS, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
].map((s) => ({ ...s, r15Modes: [OK], r19Coords: COORDS, r18GeoByTurn: s.r18GeoByTurn ? Object.fromEntries(Object.entries(s.r18GeoByTurn).map(([k, v]) => [String(k), v])) : undefined }));

export const scenarios = NEW_SCENARIOS;

// ════════════════ 共用 ════════════════
const PLACE_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
const K = (v) => {
  if (v == null || v === "") return null;
  const k = PLACE_KEYS.find((x) => String(v).includes(x)) ?? "?";
  return k === "金沢" ? "金澤" : k;
};
const cardDest = (c) => K(`${c?.name ?? ""}|${c?.id ?? ""}`);
const uniq = (a) => [...new Set(a)];
const turnOf = (turns, i) => turns.find((x) => x.turnIndex === i);
const cols = (t) => ({
  credits: (t.r15Credits ?? []).map((c) => K(c.destination)),
  cards: uniq((t.r15Cards ?? []).map(cardDest)),
  places: uniq((t.placesQueries ?? []).map((x) => K(String(x).split("@").at(-1)))),
  rec: K(t.r15Rec?.destination),
  arc: K(t.r17Arc?.destinationName),
  tc: K(t.sessionDest),
  tpc: K(t.r18Tpc),
  trip: K(t.r18TripDest),
});
const fmt = (c) => `Credits=[${c.credits.join(",") || "-"}] 卡片=[${c.cards.join(",") || "-"}] Places=[${c.places.join(",") || "-"}] rec=${c.rec ?? "-"} Context=${c.arc ?? "-"} travelContext=${c.tc ?? "-"} tpc=${c.tpc ?? "-"}`;
const trustedIn = (t, d) => (t.trust ?? []).some((x) => x.status === "trusted" && K(x.destination) === d);
/** 修正 7：只計 Provider 驗證階段（*_validate）；weather／builder 階段的 geocode 另計。 */
const geoAll = (t, d) => (t.geocodes ?? []).filter((g) => K(String(g).split(":").slice(1).join(":")) === d || (d === "金澤" && /Kanazawa|石川/i.test(String(g))));
const geoQ = (t, d) => geoAll(t, d).filter((g) => /^[a-z]+_validate:/.test(String(g)));
const weatherGeo = (t) => (t.geocodes ?? []).filter((g) => /^weather:/.test(String(g)));
const pendingOf = (t) => t.r18Pending ?? null;
const isSwitchPending = (p) => Boolean(p) && p.kind === "destination_switch" && K(p.rawGeographicLabel) === "金澤" && K(p.previousConfirmedDestination) === "京都" && p.categoryIntent === "attraction" && p.originatingRoute === "more_places";
const pendingStr = (p) => (p ? JSON.stringify({ kind: p.kind, raw: p.rawGeographicLabel ?? null, prev: p.previousConfirmedDestination ?? null, cat: p.categoryIntent ?? null, route: p.originatingRoute ?? null }) : "null");
/** 與 r19-E 相同的 Pending 欄位白名單（Session 中的 destination_switch 不得夾帶座標／範圍／可搜尋標籤）。 */
const PENDING_ALLOWED = ["kind", "rawGeographicLabel", "previousConfirmedDestination", "categoryIntent", "originatingRoute", "parentIntent", "originalUserText", "confirmationAttempts"];
const pendingBadFields = (p) => (p && p.kind === "destination_switch" ? Object.keys(p).filter((k) => p[k] !== undefined && !PENDING_ALLOWED.includes(k)) : []);
/** 修正 3：noMore／替代推薦提問（「要不要換成美食、咖啡廳或室內景點？」等）。 */
const MISLEAD_RE = /要不要換成|換成美食|美食、咖啡廳|室內景點|換一個方向|另一個類別/;
const assistantOf = (t) => t.r15Assistant ?? [];
const near = (c, d) => Boolean(c) && Math.abs(c.lat - COORDS[d].lat) < 1e-6 && Math.abs(c.lng - COORDS[d].lng) < 1e-6;
function creditsFails(t) {
  const f = [];
  const cards = t.r15Cards ?? [];
  const credits = t.r15Credits ?? [];
  const settle = t.creditsSettle ?? [];
  const rpc = t.creditsRpc ?? [];
  if (settle.length !== credits.length) f.push(`Credits begin=${credits.length} settle=${settle.length}`);
  if (settle.filter((x) => x === true).length !== (cards.length ? 1 : 0)) f.push(`Credits 成功結算=${settle.filter((x) => x === true).length}（卡片=${cards.length}）`);
  const reserves = rpc.filter((x) => x === "credits_reserve").length;
  if (reserves !== rpc.filter((x) => x === "credits_commit" || x === "credits_rollback").length) f.push(`reserve=${reserves} 與 commit＋rollback 不一致（${rpc.join(",")}）`);
  if (rpc.filter((x) => x === "credits_commit").length !== (cards.length ? 1 : 0)) f.push(`credits_commit=${rpc.filter((x) => x === "credits_commit").length}（卡片=${cards.length}）`);
  return f;
}
const FAIL_KINDS = ["switchFail", "confirmFail", "confirmCapped", "forgedHold", "forgedPrevHold"];
const NON_CONFIRM = ["hold", "idle", "chooseOld", "oldMore", "cancel", "noRevive", "forgedPrevKeep", "forgedPrevCancel"];

/**
 * 逐輪判定。回傳 [{cat, msg}]；cat：PENDING（切換意圖未保存／未清除）、OLD-CITY（Provider 失敗後回到京都搜尋／扣點／顯示）、
 * FEATURE（確認／選擇／取消／回覆行為未達成）、SAFETY（未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限、r14-A2 違反）。
 */
function judgeTurn(kind, t, ctx) {
  const out = [];
  const add = (cat, msg) => out.push({ cat, msg });
  const c = cols(t);
  const shown = [...c.credits, ...c.cards, ...c.places];
  const kz = trustedIn(t, "金澤");
  const kzConfirmed = kz || ctx.kzConfirmedBefore;
  const pend = pendingOf(t);
  // ── 全輪不變條件（13／14／15）──
  if (!kzConfirmed && shown.includes("金澤")) add("SAFETY", `未確認金澤仍搜尋／扣點／顯示（${fmt(c)}）`);
  if (!kzConfirmed) for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === "金澤") add("SAFETY", `${k} 寫入未確認目的地「金澤」`);
  if (!kzConfirmed && c.credits.includes("金澤")) add("SAFETY", "Credits metadata.destination＝未確認「金澤」");
  for (const x of creditsFails(t)) add("SAFETY", x);
  const g = t.geocodes ?? [];
  if (new Set(g).size !== g.length) add("SAFETY", `同一輪重複 geocode（${g.join(",")}）`);
  if (geoQ(t, "金澤").length > LIMITS.validatePerTurn) add("SAFETY", `同一輪金澤 Provider 驗證 ${geoQ(t, "金澤").length} 次（>${LIMITS.validatePerTurn}）`);
  if (weatherGeo(t).length > LIMITS.weatherGeoPerTurn) add("SAFETY", `同一輪 weather 階段 geocode ${weatherGeo(t).length} 次（>${LIMITS.weatherGeoPerTurn}）`);
  if ((t.weatherCalls ?? 0) > LIMITS.weatherPerTurn) add("SAFETY", `同一輪 weather 請求 ${t.weatherCalls} 次（>${LIMITS.weatherPerTurn}）`);
  for (const v of t.r14Violations ?? []) add("SAFETY", `r14-A2 違反：${v}`);
  const bad = pendingBadFields(pend);
  if (bad.length) add("SAFETY", `Session 的 destination_switch Pending 夾帶不允許欄位 ${bad.join(",")}`);
  if (pend?.kind === "destination_switch" && pend.previousConfirmedDestination != null && K(pend.previousConfirmedDestination) !== "京都") add("SAFETY", `Session 的 Pending previousConfirmedDestination=${pend.previousConfirmedDestination}（不是可信京都；偽造值被保留）`);
  if (NON_CONFIRM.includes(kind) && geoQ(t, "金澤").length) add("SAFETY", `非確認輪自動重新驗證金澤（${geoQ(t, "金澤").join(",")}）`);
  if (FAIL_KINDS.includes(kind)) {
    if ((t.weatherCalls ?? 0) || (t.builderCalls ?? 0)) add("SAFETY", `Provider 失敗輪仍呼叫 Weather ${t.weatherCalls ?? 0}／Builder ${t.builderCalls ?? 0}`);
    const mis = assistantOf(t).filter((x) => MISLEAD_RE.test(x));
    if (mis.length) add("FEATURE", `Provider 失敗輪顯示 noMore／替代推薦提問（${mis[0].slice(0, 60)}）`);
  }
  // ── 類型 ──
  const kyotoShown = shown.includes("京都");
  if (kind === "origin") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `前置：T1 沒有京都卡片（${fmt(c)}）`);
  } else if (kind === "switchFail") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍開始 Credits（${c.credits.join(",")}）`);
    if ((t.r15Cards ?? []).length) add(kyotoShown ? "OLD-CITY" : "SAFETY", `Provider 失敗仍顯示卡片（${c.cards.join(",")}）`);
    if (c.rec !== "京都") add("SAFETY", `原本可信目的地被覆蓋：recommendationSession=${c.rec ?? "-"}（應保留京都）`);
    if (c.tc !== "京都") add("SAFETY", `原本可信目的地被覆蓋：travelContext=${c.tc ?? "-"}（應保留京都）`);
    if (!isSwitchPending(pend)) add("PENDING", `未保存切換意圖：pendingClarification=${pendingStr(pend)}（應為 destination_switch／金澤／原確認京都／attraction／more_places）`);
    if (!assistantOf(t).length) add("FEATURE", "Provider 失敗輪沒有任何助理回覆（使用者看不到待確認狀態）");
  } else if (kind === "hold") {
    if (kyotoShown) add("OLD-CITY", `Pending 期間自動回到京都（${fmt(c)}）`);
    if (!isSwitchPending(pend)) add("PENDING", `切換意圖未保留：pendingClarification=${pendingStr(pend)}`);
    if (c.rec !== "京都") add("SAFETY", `recommendationSession=${c.rec ?? "-"}（未確認前應保留京都）`);
  } else if (kind === "chooseOld") {
    if (pend) add("PENDING", `選京都後 pending 未清除（${pendingStr(pend)}）`);
    if (shown.includes("金澤") || [c.rec, c.tc, c.arc].includes("金澤")) add("FEATURE", `選京都後仍出現金澤（${fmt(c)}）`);
    if ((t.r15Cards ?? []).length && c.cards.some((d) => d !== "京都")) add("FEATURE", `選京都後卡片非京都（${c.cards.join(",")}）`);
    if (c.rec !== "京都" || c.tc !== "京都") add("FEATURE", `選京都後可信目的地未恢復為京都（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}）`);
  } else if (kind === "oldMore") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `選京都後續推沒有京都卡片（${fmt(c)}）`);
    if (pend) add("PENDING", `選京都後續推仍有 pending（${pendingStr(pend)}）`);
  } else if (kind === "confirmNew") {
    if (!kz) add("FEATURE", `確認金澤：本輪沒有可信判定成功（trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? "-"}`).join(",") || "-"}）`);
    if (!geoQ(t, "金澤").length) add("FEATURE", "確認金澤：本輪沒有 Provider 驗證（Client pending 不是證據）");
    const tk = (t.trust ?? []).filter((x) => x.status === "trusted" && K(x.destination) === "金澤");
    if (tk.length && !tk.every((x) => K(x.label) === "金澤")) add("FEATURE", `確認金澤：可信判定的輸入標籤與待確認目的地不一致（label=${tk.map((x) => x.label).join(",")}）`);
    if (tk.length && !tk.some((x) => near(x.center, "金澤"))) add("FEATURE", `確認金澤：可信中心不是金澤 Provider 座標（${tk.map((x) => JSON.stringify(x.center)).join(",")}）`);
    if ((t.trust ?? []).some((x) => x.status === "trusted" && K(x.destination) === "京都")) add("OLD-CITY", "確認金澤輪的可信判定含京都");
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `確認金澤後沒有金澤卡片（${fmt(c)}）`);
    if (c.credits.length !== 1 || c.credits[0] !== "金澤") add("FEATURE", `確認金澤：Credits metadata=[${c.credits.join(",") || "-"}]（應恰好 1 次金澤）`);
    if (c.rec !== "金澤" || c.tc !== "金澤") add("FEATURE", `確認金澤：rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}（應為金澤）`);
    if (kyotoShown) add("OLD-CITY", `確認金澤後仍出現京都（${fmt(c)}）`);
    if (pend) add("PENDING", `確認後 pending 未清除（${pendingStr(pend)}）`);
    if ((t.placesRequests ?? 0) > LIMITS.confirmPlaces || (t.builderCalls ?? 0) > LIMITS.confirmBuilder || (t.weatherCalls ?? 0) > LIMITS.confirmWeather) add("SAFETY", `確認輪成本超限 Places=${t.placesRequests ?? 0}（≤${LIMITS.confirmPlaces}）Builder=${t.builderCalls ?? 0}（≤${LIMITS.confirmBuilder}）Weather=${t.weatherCalls ?? 0}（≤${LIMITS.confirmWeather}）`);
  } else if (kind === "newMore") {
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `切換金澤後續推沒有金澤卡片（${fmt(c)}）`);
    if (kyotoShown || [c.rec, c.tc, c.arc].includes("京都")) add("OLD-CITY", `切換金澤後續推出現京都（${fmt(c)}）`);
  } else if (kind === "confirmFail" || kind === "confirmCapped") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍開始 Credits（${c.credits.join(",")}）`);
    if (kyotoShown) add("OLD-CITY", `確認輪 Provider 失敗後回到京都（${fmt(c)}）`);
    if (!isSwitchPending(pend)) add("PENDING", `確認輪 Provider 失敗後 pending 未保留（${pendingStr(pend)}）`);
    if (c.rec !== "京都" || c.tc !== "京都") add("SAFETY", `確認輪 Provider 失敗後京都被覆蓋（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}）`);
    if (kind === "confirmCapped" && geoQ(t, "金澤").length) add("SAFETY", `同一 Pending 已達自動驗證上限 ${LIMITS.validatePerPending} 次仍再驗證金澤（${geoQ(t, "金澤").join(",")}）＝無限重試`);
  } else if (kind === "idle") {
    if (geoQ(t, "金澤").length) add("SAFETY", `非確認輪自動重新驗證金澤（${geoQ(t, "金澤").join(",")}）＝反覆自動驗證`);
    if (kyotoShown) add("OLD-CITY", `連續失敗後自動回到京都（${fmt(c)}）`);
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `連續失敗後仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
  } else if (kind === "cancel") {
    if (pend) add("PENDING", `取消後 pending 未清除（${pendingStr(pend)}）`);
    if (shown.includes("金澤") || [c.rec, c.tc, c.arc].includes("金澤")) add("FEATURE", `取消後仍出現金澤（${fmt(c)}）`);
  } else if (kind === "noRevive") {
    if (geoQ(t, "金澤").length || shown.includes("金澤")) add("PENDING", `已取消／取代的金澤切換被復活（geocode=${geoQ(t, "金澤").join(",") || "-"}；${fmt(c)}）`);
    if (isSwitchPending(pend)) add("PENDING", `已取消／取代的 pending 仍存在（${pendingStr(pend)}）`);
    if (ctx.restoredPending && isSwitchPending(ctx.restoredPending)) add("PENDING", `重新載入後取消的 pending 復活（輪初 ${pendingStr(ctx.restoredPending)}）`);
  } else if (kind === "replace") {
    if (!c.cards.length || c.cards.some((d) => d !== "大阪")) add("FEATURE", `換大阪沒有大阪卡片（${fmt(c)}）`);
    if (shown.includes("金澤") || shown.includes("京都")) add("SAFETY", `換大阪仍出現金澤／京都（${fmt(c)}）`);
    if (isSwitchPending(pend)) add("PENDING", `新目的地後舊 pending（金澤）仍存在（${pendingStr(pend)}）`);
  } else if (kind === "same") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `同城續推沒有京都卡片（${fmt(c)}）`);
    if (pend) add("PENDING", `同城續推出現 pending（${pendingStr(pend)}）`);
    if (c.rec !== "京都") add("FEATURE", `同城續推 rec=${c.rec ?? "-"}`);
  } else if (kind === "forgedHold" || kind === "forgedPrevHold") {
    if (shown.includes("金澤") || (t.placesRequests > 0 && c.places.includes("金澤"))) add("SAFETY", `Client pending 被當成驗證證據：Provider 失敗仍搜尋／扣點／顯示金澤（${fmt(c)}）`);
    if ([c.rec, c.tc, c.arc, c.tpc].includes("金澤")) add("SAFETY", `Client pending 被當成驗證證據：Session 寫入金澤（${fmt(c)}）`);
    // 修正 1：舊版 `kyotoShown && !cards.length` 寫反（顯示京都卡片時反而不判）；偽造 Pending＋「好」＋Provider 失敗後任何京都搜尋／扣點／卡片皆 FAIL
    if (kyotoShown) add("OLD-CITY", `Provider 失敗後以京都搜尋／扣點／顯示（${fmt(c)}）`);
  } else if (kind === "forgedOk" || kind === "forgedPrevYes") {
    if (shown.includes("金澤") && !(kz && geoQ(t, "金澤").length)) add("SAFETY", `Client pending 被當成驗證證據：未在本輪完成 Provider 驗證就使用金澤（${fmt(c)}）`);
    if (kyotoShown) add("OLD-CITY", `「好」（確認 Pending）卻以京都搜尋／扣點／顯示（${fmt(c)}）`);
  } else if (kind === "forgedPrevKeep" || kind === "forgedPrevCancel") {
    if (pend) add("PENDING", `${kind === "forgedPrevKeep" ? "選擇原本的" : "取消"}後 pending 未清除（${pendingStr(pend)}）`);
    if (shown.includes("金澤") || [c.rec, c.tc, c.arc, c.tpc].includes("金澤")) add("SAFETY", `偽造 Pending 後出現金澤（${fmt(c)}）`);
    if ((t.r15Cards ?? []).length && c.cards.some((d) => d !== "京都")) add("SAFETY", `偽造 Pending 後卡片非可信京都（${c.cards.join(",")}）`);
  }
  if (kind.startsWith("forgedPrev")) {
    // 修正 2：偽造的 previousConfirmedDestination（大阪）不得被驗證、搜尋、扣點或寫入任何可信欄位
    if (geoAll(t, "大阪").length) add("SAFETY", `偽造 previousConfirmedDestination「大阪」被送去 Provider（${geoAll(t, "大阪").join(",")}）`);
    if (shown.includes("大阪")) add("SAFETY", `偽造 previousConfirmedDestination「大阪」被搜尋／扣點／顯示（${fmt(c)}）`);
    for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === "大阪") add("SAFETY", `${k} 寫入偽造的「大阪」`);
    if (c.rec !== "京都" && !kz) add("SAFETY", `可信京都被覆蓋（rec=${c.rec ?? "-"}）`);
  }
  // 本輪經過 r13 模型「未重建」路徑（下游未執行正式碼）：失敗只能記為 MODEL（UNVERIFIED），不作為 PASS 也不作為正式碼 P1
  if (/未重建/.test(String(t.path ?? ""))) return out.map((x) => ({ cat: "MODEL", msg: `${x.msg}（r13 模型未重建路徑：${String(t.path).slice(0, 60)}）` }));
  return out;
}

// ════════════════ report ════════════════
const CAT_EXPECTED = new Set(["PENDING", "OLD-CITY", "FEATURE"]);
const KZ_CONFIRM_KINDS = ["switchFail", "confirmNew", "confirmFail", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold"];
const YES_KINDS = ["confirmNew", "confirmFail", "confirmCapped", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold"];
export function report({ results, TREES, out }) {
  const SHOW = ["work", "mp1", "a2"].filter((t) => TREES.includes(t));
  const H = globalThis.__R19_H ?? {};
  out.push("\n══════════════ MP-25 destination_switch 失敗測試 r2（A2-MP-T5；r19 掛載；樹 work／mp1／a2）══════════════");
  out.push("  分類：PENDING＝切換意圖未保存／未清除／復活；OLD-CITY＝Provider 失敗後回到京都；FEATURE＝確認／選擇／取消／回覆行為未達成；SAFETY＝未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限、r14-A2 違反");
  out.push(`  上限：${JSON.stringify(LIMITS)}`);
  for (const tree of SHOW) {
    const h = H[tree];
    const model = (h?.refs ?? []).filter((r) => r.where === "model");
    out.push(`  r19-H ${tree.padEnd(5)} destination_switch 區段=${h?.region ? `L${h.region.start}-${h.region.end}（${h.region.statements} 句）` : "（無 handler → 模型照舊）"}；區段外（模型路徑）參照=${model.length ? model.map((r) => `L${r.line}`).join(",") : "0"}`);
  }
  const table = {};
  const caseRow = (no, tree) => ((table[no] ??= {})[tree] ??= { fails: [], ran: 0, model: [] });
  const agg = { 13: {}, 14: {}, 15: {}, 16: {} };
  for (const s of NEW_SCENARIOS) {
    out.push(`\n[MP25R2][${s.id}] 案例 ${s.case}：${s.label}`);
    for (const tree of SHOW) {
      const r = results[`${tree}|ok|${s.id}`];
      if (!r) continue;
      const row = caseRow(s.case, tree);
      row.ran += 1;
      if (r.err || r.result?.error) {
        row.fails.push({ cat: "INFRA", msg: `${s.id}：${String(r.err ?? r.result.error).slice(0, 160)}` });
        out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
        continue;
      }
      if (r.fetchCalls) row.fails.push({ cat: "SAFETY", msg: `外部請求 ${r.fetchCalls} 次` });
      const turns = r.result.turns ?? [];
      let kzConfirmedBefore = false;
      let kzGeoTotal = 0;
      let asks = 0;
      const A = (no, cat, msg) => (agg[no][tree] ??= []).push({ cat, msg });
      for (const [i, kind] of s.expect.entries()) {
        const t = turnOf(turns, i);
        if (!t) {
          row.fails.push({ cat: "INFRA", msg: `${s.id} T${i + 1} 缺失` });
          out.push(`  ${tree.padEnd(5)} T${i + 1} 缺失`);
          continue;
        }
        if (t.error) row.fails.push({ cat: "INFRA", msg: `${s.id} T${i + 1} ${String(t.error).slice(0, 160)}` });
        const ctx = { kzConfirmedBefore, restoredPending: s.reloadAfter != null && i === s.reloadAfter + 1 ? t.r18PendingAtStart : null };
        const f = judgeTurn(kind, t, ctx);
        if (s.restoredAt === i && !isSwitchPending(t.r18PendingAtStart)) f.push({ cat: "PENDING", msg: `重新載入後 pending 未恢復（輪初 ${pendingStr(t.r18PendingAtStart)}）` });
        const turnSpec = s.turns[i];
        if (turnSpec && typeof turnSpec === "object" && turnSpec.fault && !/r19:fault/.test(String(t.path ?? ""))) f.push({ cat: "INFRA", msg: `故障注入未生效（path=${String(t.path ?? "").slice(0, 80)}）` });
        if ((s.requireFbContinue ?? []).includes(i) && !/r18:fbContinue\(real\)/.test(String(t.path ?? ""))) f.push({ cat: "INFRA", msg: `故障模式未走到正式 fallback continue（path=${String(t.path ?? "").slice(0, 100)}）` });
        // Q4：同一 Pending 的確認詢問次數
        if (isSwitchPending(pendingOf(t)) && assistantOf(t).some((x) => /金澤|金沢/.test(x))) asks += 1;
        if (asks > LIMITS.asksPerPending && isSwitchPending(pendingOf(t))) f.push({ cat: "SAFETY", msg: `同一 Pending 已詢問 ${asks} 輪（>${LIMITS.asksPerPending}）＝無限重問` });
        kzGeoTotal += geoQ(t, "金澤").length;
        kzConfirmedBefore = kzConfirmedBefore || trustedIn(t, "金澤");
        out.push(`  ${tree.padEnd(5)} T${i + 1}「${t.text}」（${kind}） ${fmt(cols(t))} pending=${pendingStr(pendingOf(t))}`);
        out.push(`        path=${String(t.path ?? "").slice(0, 220)} geocode=${(t.geocodes ?? []).length}[${(t.geocodes ?? []).join(",")}] placesReq=${t.placesRequests ?? 0} builder=${t.builderCalls ?? 0} weather=${t.weatherCalls ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? x.reason ?? "-"}${x.center ? `@${x.center.lat},${x.center.lng}` : ""}`).join(",") || "-"}`);
        out.push(`        助理=${JSON.stringify(assistantOf(t).map((x) => x.slice(0, 60)))}${t.r19Exc?.length ? ` r19Exc=${JSON.stringify(t.r19Exc)}` : ""}`);
        if (f.length) out.push(`        ✗ ${f.map((x) => `[${x.cat}] ${x.msg}`).join("；")}`);
        row.fails.push(...f.map((x) => ({ ...x, msg: `${s.id} T${i + 1}：${x.msg}` })));
        if (/未重建/.test(String(t.path ?? ""))) row.model.push(`${s.id} T${i + 1}`);
        for (const x of f) {
          if (x.cat !== "SAFETY") continue;
          if (/Credits/.test(x.msg)) A(13, "SAFETY", `${s.id} T${i + 1}：${x.msg}`);
          if (/寫入|Client pending|覆蓋|偽造|夾帶/.test(x.msg)) A(14, "SAFETY", `${s.id} T${i + 1}：${x.msg}`);
          if (/geocode|Places|重新驗證|驗證|Weather|weather|Builder|上限|重試|重問/.test(x.msg)) A(15, "SAFETY", `${s.id} T${i + 1}：${x.msg}`);
        }
        const modelTurn = /未重建/.test(String(t.path ?? ""));
        const tc = cols(t);
        if (!modelTurn && FAIL_KINDS.includes(kind) && (t.r15Credits ?? []).length) A(13, tc.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `${s.id} T${i + 1}：失敗輪開始 Credits（${tc.credits.join(",")}）`);
        if (!modelTurn && FAIL_KINDS.includes(kind) && t.placesRequests > 0) A(15, tc.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `${s.id} T${i + 1}：失敗輪 Places=${t.placesRequests}（${tc.places.join(",")}）`);
        // 16：「好」那一輪（確認 Pending）不得京都搜尋／扣點／顯示
        if (t.text === "好" && YES_KINDS.includes(kind)) {
          const k = [...tc.places, ...tc.credits, ...tc.cards].includes("京都");
          (agg[16][tree] ??= []);
          if (k) A(16, modelTurn ? "MODEL" : "OLD-CITY", `${s.id} T${i + 1}：「好」輪京都 Places=${(t.placesQueries ?? []).filter((q) => K(String(q).split("@").at(-1)) === "京都").length} Credits=[${tc.credits.join(",") || "-"}] 卡片=[${tc.cards.join(",") || "-"}]`);
          else if (modelTurn) A(16, "MODEL", `${s.id} T${i + 1}：模型路徑（UNVERIFIED）`);
        }
      }
      // 15／Q3：情境總金澤 Provider 驗證 ≤ 本情境「點名／確認金澤」輪數，且同一 Pending ≤ LIMITS.validatePerPending
      const allowedKz = s.expect.filter((k) => KZ_CONFIRM_KINDS.includes(k)).length;
      if (kzGeoTotal > allowedKz) A(15, "SAFETY", `${s.id}：情境總金澤 Provider 驗證=${kzGeoTotal} > 點名／確認輪數 ${allowedKz}`);
      if (s.expect.includes("switchFail") && !s.expect.includes("confirmNew") && kzGeoTotal > LIMITS.validatePerPending) A(15, "SAFETY", `${s.id}：同一 Pending 自動驗證=${kzGeoTotal} > ${LIMITS.validatePerPending}`);
      if (s.case === 12 && results[`mp1|ok|${s.id}`] && tree === "work") {
        const sum = (ts, fn) => ts.reduce((a, t) => a + fn(t), 0);
        const m = results[`mp1|ok|${s.id}`].result?.turns ?? [];
        if (sum(turns, (t) => t.geocodes?.length ?? 0) > sum(m, (t) => t.geocodes?.length ?? 0)) row.fails.push({ cat: "SAFETY", msg: `${s.id}：同城續推 geocode 次數高於 mp1` });
        if (sum(turns, (t) => t.placesRequests ?? 0) > sum(m, (t) => t.placesRequests ?? 0)) row.fails.push({ cat: "SAFETY", msg: `${s.id}：同城續推 Places 次數高於 mp1` });
      }
    }
  }
  for (const no of [13, 14, 15, 16]) for (const tree of SHOW) {
    const row = caseRow(no, tree);
    row.ran += 1;
    for (const x of agg[no][tree] ?? []) {
      if (x.cat === "MODEL") row.model.push(x.msg);
      else row.fails.push(x);
    }
  }
  const NAMES = {
    1: "京都→金澤驗證失敗（timeout）",
    2: "下一輪「再推薦幾個」（含故障模式）",
    3: "下一輪「便宜一點的」",
    4: "明確選擇京都",
    5: "明確確認金澤（Provider 成功才切換）",
    6: "Provider 再次 timeout（含上限）",
    7: "Provider null（含再次 null）",
    8: "ZERO_RESULTS（含再次 ZERO）",
    9: "Reload Restore",
    10: "Pending 取消（含 Reload）",
    11: "新目的地取代舊 Pending",
    12: "同目的地正常續推（含故障模式）",
    13: "Credits Metadata（彙總）",
    14: "Session 污染／Client pending 非證據",
    15: "Provider 成本與去重（彙總）",
    16: "「好」輪不得京都搜尋／扣點",
  };
  const outsideModel = (H.work?.refs ?? []).filter((r) => r.where === "model").length;
  out.push("\n── MP-25 r2：16 項 × 樹（PASS／FAIL／UNVERIFIED；括號＝失敗分類計數）──");
  const otherWork = [];
  const modelWork = [];
  let workFail = 0;
  const summary = {};
  for (let no = 1; no <= 16; no += 1) {
    const cells = SHOW.map((tree) => {
      const r = table[no]?.[tree];
      if (!r || !r.ran) return `${tree}=-`;
      const cats = {};
      for (const x of r.fails) cats[x.cat] = (cats[x.cat] ?? 0) + 1;
      const real = r.fails.filter((x) => x.cat !== "MODEL");
      let v = real.length ? "FAIL" : r.fails.length || r.model.length ? "UNVERIFIED" : "PASS";
      if (v === "PASS" && tree === "work" && outsideModel) v = "UNVERIFIED";
      (summary[no] ??= {})[tree] = v;
      if (tree === "work") {
        if (v !== "PASS") workFail += 1;
        for (const x of r.fails) if (!CAT_EXPECTED.has(x.cat) && x.cat !== "MODEL") otherWork.push(`案例 ${no}：[${x.cat}] ${x.msg}`);
        for (const x of r.fails) if (x.cat === "MODEL") modelWork.push(`案例 ${no}：${x.msg}`);
      }
      return `${tree}=${v}${r.fails.length ? `(${Object.entries(cats).map(([k, n]) => `${k}:${n}`).join(",")})` : ""}${r.model.length && !real.length ? `(模型輪:${r.model.length})` : ""}`;
    });
    out.push(`  ${String(no).padStart(2)}. ${NAMES[no].padEnd(30)} ${cells.join("  ")}`);
  }
  if (outsideModel) out.push(`  ※ work 有 ${outsideModel} 處 destination_switch 參照不在擷取範圍（模型路徑）→ work 的 PASS 一律改列 UNVERIFIED`);
  out.push("\n── work 上「PENDING／OLD-CITY／FEATURE（契約未施工）」以外的失敗（SAFETY／INFRA；停止條件候選）──", ...(otherWork.length ? otherWork.map((x) => `  ${x}`) : ["  (none)"]));
  out.push("── work 上經過 r13 模型「未重建」路徑的判定（MODEL＝UNVERIFIED；不計 PASS、不作為正式碼 P1）──", ...(modelWork.length ? modelWork.map((x) => `  ${x}`) : ["  (none)"]));
  out.push(`MP-25 r2（work）：非 PASS 項目=${workFail}/16；SAFETY／INFRA=${otherWork.length}；MODEL=${modelWork.length}`);
  out.push(`@@MP25R2_SUMMARY@@${JSON.stringify(summary)}`);
  return { fail: workFail, pass: 16 - workFail };
}

/** mp25 → mp25-r2 的每一處斷言差異（舊 → 新 → 理由 → 修正編號）。 */
export const CHANGES = [
  { no: 1, old: "forgedHold：`if (kyotoShown && !(t.r15Cards ?? []).length)` → OLD-CITY", neu: "`if (kyotoShown)` → OLD-CITY（任何京都 Places／Credits／卡片）", why: "舊條件寫反：顯示京都卡片時反而不判 FAIL", fix: "1" },
  { no: 2, old: "（無）", neu: "新增情境 14c／14d／14e／14f（偽造 previousConfirmedDestination=大阪；繼續原本的／不用了／好〔成功〕／好〔timeout〕）與判定 forgedPrev*：大阪不得被 Provider 驗證、搜尋、扣點、寫入六欄；可信京都不得被覆蓋；選原本的／取消後 pending 清除", why: "Client 保存的 previousConfirmedDestination 不是可信證據", fix: "2" },
  { no: 3, old: "（無）", neu: "switchFail／confirmFail／confirmCapped／forgedHold／forgedPrevHold：助理回覆不得含 noMore／替代推薦提問（MISLEAD_RE）→ FEATURE；switchFail 必須有助理回覆 → FEATURE", why: "Provider 失敗不是「沒有更多地點」；錯誤引導", fix: "3" },
  { no: 4, old: "MP25-06 T4「好」=confirmFail（允許再驗證 1 次）；情境總 geocode ≤ 點名／確認輪數", neu: "T4=confirmCapped（confirmFail 全部條件＋金澤 *_validate=0）；新增 06b（好×4）；同一 Pending 自動驗證 ≤2、確認詢問 ≤3 輪", why: "不得無限重試／重問；上限理由見 LIMITS", fix: "4" },
  { no: 5, old: "hold：`if (!kz && geoQ(...).length)` SAFETY；`if (c.rec !== \"京都\" && !kz)` SAFETY", neu: "兩者改為無條件；chooseOld／oldMore／cancel／noRevive／forgedPrevKeep／forgedPrevCancel 同樣不得自動驗證金澤（NON_CONFIRM）", why: "非確認輪本身出現金澤可信判定就是違規，不能以 kz 為由跳過", fix: "5" },
  { no: 6, old: "金澤與京都皆為 Mock 預設座標 (35,135)", neu: "情境 r19Coords：金澤 36.5613,136.6562／京都 35.0116,135.7681／大阪 34.6937,135.5023；confirmNew 新增「可信中心＝金澤 Provider 座標」「可信判定標籤＝金澤」「可信判定不得含京都」", why: "座標相同時無法分辨是否用了京都中心", fix: "6" },
  { no: 7, old: "geoQ 含所有階段 geocode（weather 階段也算驗證）；同輪 >1 → SAFETY", neu: "geoQ 只計 *_validate（>1 → SAFETY）；weather 階段 geocode ≤1、weather 請求 ≤1 另計 SAFETY；失敗輪 weather／builder 必須 0", why: "舊版把必要的 weather geocode（r18-N C6／C7）算成重複驗證；改為分開計數並各自設上限（修正，非放寬）", fix: "7" },
  { no: 8, old: "confirmNew：只檢查卡片／Credits／rec／travelContext", neu: "另加成本上限 Places ≤2、Builder ≤1、Weather ≤1", why: "審查 5：確認輪缺上限", fix: "5" },
  { no: 9, old: "forgedOk：只檢查未驗證先用金澤", neu: "另加：京都搜尋／扣點／卡片 → OLD-CITY；新增案例 16（「好」輪不得京都搜尋／扣點）彙總", why: "任務單：「好」那一輪不得京都搜尋／扣點（alt 分支同一根因）", fix: "任務單（另加）" },
  { no: 10, old: "（無）", neu: "全輪：r14Violations → SAFETY；Session Pending 夾帶白名單外欄位或 previousConfirmedDestination≠京都 → SAFETY；新增 14g（Client pending 夾帶 center／searchScope／radius／confirmedParentCity）", why: "與 r19-E 例外欄位白名單一致；Client 欄位不得被保留或使用", fix: "2／裁決（Pending 安全例外）" },
  { no: 11, old: "（無）", neu: "新增 02b、12b（故障模式 r19ThrowMoreOnce）；故障未生效或未走到正式 fallback continue → INFRA", why: "審查 7：fallback continue 原 invoked=0", fix: "任務單（r19-F）" },
  { no: 12, old: "MP25-07／08 只有切換輪失敗", neu: "新增 07b（再次 null）、08b（再次 ZERO_RESULTS）＝confirmFail", why: "任務單：再次 timeout／null／ZERO_RESULTS 皆須維持 unavailable", fix: "任務單" },
  { no: 14, old: "情境 ID 前綴 MP25-（16 個）", neu: "MP25R2-（同內容；每個情境另加 r19Coords；MP25-06 的 expect 見 #4）", why: "與舊版同時執行時避免 ID 衝突；情境回合文字／Provider 模式／Reload 位置不變", fix: "6（座標）" },
  { no: 15, old: "forgedHold：`shown.includes(\"金澤\") || t.placesRequests > 0 && c.places.includes(\"金澤\")`", neu: "同一條件加括號（語意不變）", why: "可讀性；運算子優先順序與舊版相同", fix: "-" },
  { no: 16, old: "（無）", neu: "每輪 obs.error（THROW）→ INFRA", why: "舊版不檢查輪內例外，拋錯輪可能被誤判 PASS", fix: "8" },
  { no: 13, old: "work PASS 判定只看失敗清單", neu: "work 若有 destination_switch 參照不在 r19-H 擷取範圍（模型路徑）→ PASS 改列 UNVERIFIED", why: "避免正式碼未被執行卻判 PASS", fix: "8（只依行為驗收）" },
];

// ── 直接執行：以 r19 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  if (process.argv.includes("--emit-diff")) {
    let d = "";
    try {
      d = execFileSync("diff", ["-u", "--label", "scripts/verify-more-places-destination-switch-mp25.mjs", "--label", "scripts/verify-more-places-destination-switch-mp25-r2.mjs", OLD, SELF], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      d = String(e.stdout ?? "");
    }
    const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail(", "add("];
    const del = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const head = [
      "# mp25-r2.diff（相對 scripts/verify-more-places-destination-switch-mp25.mjs；A2-MP-T5）",
      `# 刪除行=${del.length}；刪除行含 ${KEYS.join("／")}＝${hit.length}（逐行列於下方；每一處對應 CHANGES 的舊→新→理由→修正編號）`,
      ...hit.map((l) => `#   [刪除行命中] ${l.slice(0, 220)}`),
      "# CHANGES：",
      ...CHANGES.map((c) => `#   ${c.no}. 舊：${c.old}｜新：${c.neu}｜理由：${c.why}｜修正編號：${c.fix}`),
      "",
    ];
    writeFileSync(`${PRE_DIR}/mp25-r2.diff`, `${head.join("\n")}\n${d}`);
    console.log(`wrote ${PRE_DIR}/mp25-r2.diff`);
    console.log(head.join("\n"));
    process.exit(0);
  }
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const sub = process.argv.includes("--with-r19-subset");
  const ids = [...scenarios.map((s) => s.id), ...(sub ? ["R10-a2-kyoto-kanazawa-more", "R15-PROBE"] : [])];
  const args = [R19, "--brief", ...(sub ? ["--pa2"] : []), "--a2", "--mp1", `--only=${ids.join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/${sub ? "r19-subset" : "mp25-r2"}.log`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
