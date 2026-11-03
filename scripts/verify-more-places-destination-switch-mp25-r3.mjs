#!/usr/bin/env node
/**
 * verify-more-places-destination-switch-mp25-r3（A2-MP-T7，tester）：MP-25「換目的地驗證失敗」失敗測試第 3 版（施工前預期 work FAIL）。
 * 舊版 scripts/verify-more-places-destination-switch-mp25.mjs、mp25-r2 保留不改；本檔只「加嚴、修正寫反／錯誤的條件，或依 A2-MP-T6 後使用者裁決調整」
 * （逐條見 CHANGES／--emit-diff）。
 *
 * 契約（使用者原文＋A2-MP-T4／T6 後裁決）：京都 → 換金澤 → Provider 失敗時必須：保存尚未完成的切換意圖（pendingClarification
 *   destination_switch：rawGeographicLabel／previousConfirmedDestination／categoryIntent／originatingRoute="more_places"／originalUserText／
 *   confirmationAttempts）、不搜尋 Places、不開始 Credits、不覆蓋原本可信目的地、不自動回到京都續推、不顯示 noMore／替代推薦提問。
 *   下一輪「好」「再推薦幾個」「便宜一點的」不得觸發京都搜尋或扣點。明確確認金澤：只把原始請求交回既有 Destination Authority 驗證，
 *   驗證成功（且結果＝待確認目的地）才切換。再次 timeout／null／ZERO_RESULTS：維持 unavailable、不搜尋、不扣點、不得無限重問或無限重試。
 *   明確選擇京都：清除 Pending 後沿用可信京都。新的明確目的地優先於舊 Pending。Client 保存的 Pending（含 previousConfirmedDestination）不是 Provider 證據。
 * 只以「行為」斷言（Session 中的 Pending、Provider／Credits 次數、Session 地理投影、助理回覆），不限定 if／switch／helper 名稱。
 *
 * 計數規則（使用者裁決；本檔定義如下，皆可機器檢查）：
 *   驗證次數 V(d)  ＝本輪所有「非 weather 階段」對 d 的 geocode（init／post／global_candidate／builder／nearby／*_validate…；不只 *_validate）。
 *   Weather       ＝weather 階段 geocode WG 與 weather 請求 W，分開統計；未確認 d 期間 WG(d)／W(near d) 必須 0；確認輪 weather 不得早於 d 的首次驗證。
 *   Q1 單一 User Turn：V(金澤) ≤ 1；WG ≤ 1；W ≤ 1。
 *   Q2 非確認輪（hold／idle／chooseOld／oldMore／cancel／noRevive／forgedPrevKeep／forgedPrevCancel）V(金澤)=0。
 *   Q3 同一 Pending（相同輸入）自動驗證 ≤ 2 次（切換輪 1＋第一次明確確認 1；同 r2，未放寬）；confirmCapped／rebuildCapped 輪 V(金澤)=0。
 *      「相同輸入」＝同一 Pending 身分：kind、rawGeographicLabel（金沢／金澤視為同一）、previousConfirmedDestination、categoryIntent、originatingRoute 皆同；
 *      逐字相同的原句（例：達上限後再次輸入「換金澤，再推薦幾個」）是其子集。重建不得重置 confirmationAttempts、不得再觸發 Provider。
 *   Q4 同一 Pending 的「確認提問」≤ 3 次。確認提問＝輪末 Session 仍有同一 Pending、本輪有新的助理訊息、本輪沒有卡片，且
 *      （助理訊息含問號「？／?」或與先前任一確認提問逐字相同）。不再以「回覆提到金澤」計數。
 *   Q5（mp25-r2 的「確認成功輪 Places ≤2、Builder ≤1、Weather ≤1」）依裁決移除；改為「確認成功輪 ≤ 同樹既有推薦流程（REF：京都 → 換金澤，
 *      Provider 成功）T2 的 Places／Builder／Weather／Credits.begin」＋ r14-A2／Credits 結算斷言（既有契約）。
 *   未確認期間 Places＝0、Credits（begin 與任何 credits_* RPC，含 credits_check）＝0、非 RPC Supabase 寫入＝0、Session 地理投影不變。
 *
 * 機制：不自建 Harness；以 r20（--extra-scenarios=本檔）執行（r20 → r19 → … → r13）：正式 Callback／send() 區塊擷取（r19-H 位置擷取）、
 *   Mock Provider（逐輪模式 r18GeoByTurn；r19Coords 給金澤／京都／大阪不同座標）、Credits RPC Mock、外部網路攔截、故障模式 r19ThrowMoreOnce、
 *   r20-O 記錄（輪初／輪末 Session 地理投影、非 RPC Supabase 存取、正式 isAlternativeRecommendationOffer、座標命中、卡片座標）。
 *   Reload＝r13 Harness 以 persisted JSON 開新程序（真實 saveChatSession／loadChatSession 未執行 → UNVERIFIED）。
 *
 * 執行：node scripts/verify-more-places-destination-switch-mp25-r3.mjs [--conc=N] [--out=<path>] [--with-r20-subset]
 *       （＝ node scripts/verify-destination-authority-phase2-r20.mjs --brief --a2 --mp1 --only=<ids> --extra-scenarios=本檔 --out=<scratchpad>/mp25-r3.log；
 *         --with-r20-subset 另加 --pa2 與 R10-a2-kyoto-kanazawa-more、R15-PROBE，預設輸出 <scratchpad>/r20-subset-mp25r3.log）
 *       node scripts/verify-more-places-destination-switch-mp25-r3.mjs --emit-diff   （寫 <scratchpad>/mp25-r3.diff）
 */
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R20 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r20.mjs`;
const OLD = `${WORK_ROOT}/scripts/verify-more-places-destination-switch-mp25-r2.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const T1 = "京都推薦景點";
const T2 = "換金澤，再推薦幾個";
const T2_OTHER = "不去大阪了，換金澤，再推薦幾個";
const FAULT_MORE = { text: "再推薦幾個", fault: "r19ThrowMoreOnce" };
/** 修正 6（r2）：金澤／京都／大阪不同 Mock 座標（只在本檔外掛情境；r13 情境不受影響）。 */
const COORDS = { 金澤: { lat: 36.5613, lng: 136.6562 }, 京都: { lat: 35.0116, lng: 135.7681 }, 大阪: { lat: 34.6937, lng: 135.5023 } };
const FORGED = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: T2 };
/** 修正 2（r2）：Client 端偽造 previousConfirmedDestination（未確認城市大阪；可信 Session＝京都）。 */
const FORGED_PREV = { ...FORGED, previousConfirmedDestination: "大阪" };
/** Client 端偽造 Pending 夾帶搜尋欄位（中心／範圍／可搜尋標籤）。 */
const FORGED_FIELDS = { ...FORGED, center: { lat: 36.5613, lng: 136.6562 }, searchScope: "city", radius: 3000, confirmedParentCity: "金澤" };
/** r3：Client 端偽造 Pending 的 categoryIntent（cafe；可信 Session activeCategoryIntent＝attraction）→ 不得污染 activeCategoryIntent。 */
const FORGED_CAT = { ...FORGED, categoryIntent: "cafe" };
const INIT_KYOTO = { topic: "attraction", rec: { destination: "京都", n: 6, batch: 3 }, travelDestination: "京都" };
/** r3：可信 Session＝大阪（Client pending 的 previousConfirmedDestination＝京都，不得因此把京都當可信）。 */
const INIT_OSAKA = { topic: "attraction", rec: { destination: "大阪", n: 6, batch: 3 }, travelDestination: "大阪" };

export const LIMITS = {
  validatePerTurn: 1, // Q1：單一 User Turn 最多驗證 1 次（所有非 weather 階段）
  weatherGeoPerTurn: 1,
  weatherPerTurn: 1,
  validatePerPending: 2, // Q3：同一 Pending 最多自動驗證 2 次（切換輪 1＋第一次明確確認 1）
  asksPerPending: 3, // Q4：同一 Pending 最多詢問 3 次
};

/**
 * expect[turnIndex]＝該輪的行為類型（r2 全部保留；★＝r3 新增）：
 *   origin / switchFail / hold / chooseOld / oldMore / confirmNew / newMore / confirmFail / confirmCapped / idle / cancel / noRevive / replace / same /
 *   forgedHold / forgedOk / forgedPrevKeep / forgedPrevCancel / forgedPrevYes / forgedPrevHold（同 r2；forgedPrev* 的「可信城市／偽造城市」改由情境 trusted／forgedPrev 參數給定，舊情境＝京都／大阪）
 *   ★ref            REF 情境 T2（既有推薦流程：京都 → 換金澤，Provider 成功）：只記錄成本，作為 confirmNew 的「既有推薦流程契約」基準；沒有金澤卡片 → INFRA
 *   ★rebuildCapped  達上限後以相同輸入（同一 Pending 身分）重建：V(金澤)=0、不搜尋、不扣點、不回京都、confirmationAttempts 不得被重置
 */
const NEW_SCENARIOS = [
  { case: 1, items: [1], id: "MP25R3-01-switch-fail-timeout", label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider timeout）", turns: [T1, T2], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail"] },
  { case: 2, items: [3, 1], id: "MP25R3-02-fail-then-more", label: "… → 換金澤（timeout）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 2, items: [3, 20], id: "MP25R3-02b-fail-then-more-fault", label: "… → 換金澤（timeout）→ 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback；Callback 未被呼叫 → 故障檢查 N/A］", turns: [T1, T2, FAULT_MORE], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 3, items: [4, 1], id: "MP25R3-03-fail-then-cheaper", label: "… → 換金澤（timeout）→ 便宜一點的", turns: [T1, T2, "便宜一點的"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 4, items: [5], id: "MP25R3-04-choose-kyoto", label: "… → 換金澤（timeout）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "chooseOld", "oldMore"] },
  { case: 5, items: [6, 2], id: "MP25R3-05-confirm-kanazawa-yes", label: "… → 換金澤（timeout）→ 好（Provider 成功）→ 再推薦幾個", turns: [T1, T2, "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew", "newMore"] },
  { case: 5, items: [6], id: "MP25R3-05b-confirm-kanazawa-echo", label: "… → 換金澤（timeout）→ 金澤（Provider 成功）", turns: [T1, T2, "金澤"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"] },
  { case: 6, items: [7, 11, 2], id: "MP25R3-06-confirm-timeout-again", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（timeout）→ 再推薦幾個", turns: [T1, T2, "好", "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "idle"] },
  { case: 6, items: [7, 10, 11, 2], id: "MP25R3-06b-confirm-timeout-repeat", label: "… → 換金澤（timeout）→ 好 ×4（皆 timeout）", turns: [T1, T2, "好", "好", "好", "好"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout", 5: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "confirmCapped", "confirmCapped"] },
  { case: 7, items: [8, 3], id: "MP25R3-07-switch-fail-null", label: "… → 換金澤（Provider null）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "null" }, expect: ["origin", "switchFail", "hold"] },
  { case: 7, items: [8, 2], id: "MP25R3-07b-confirm-null-again", label: "… → 換金澤（null）→ 好（null）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "null", 2: "null" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 8, items: [9, 3], id: "MP25R3-08-switch-fail-zero", label: "… → 換金澤（ZERO_RESULTS）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "zero" }, expect: ["origin", "switchFail", "hold"] },
  { case: 8, items: [9, 2], id: "MP25R3-08b-confirm-zero-again", label: "… → 換金澤（ZERO_RESULTS）→ 好（ZERO_RESULTS）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "zero", 2: "zero" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 9, items: [15, 6, 2], id: "MP25R3-09-reload-confirm", label: "… → 換金澤（timeout）→（重新載入）→ 好（Provider 成功）", turns: [T1, T2, "好"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"], restoredAt: 2 },
  { case: 9, items: [15, 3], id: "MP25R3-09b-reload-more", label: "… → 換金澤（timeout）→（重新載入）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"], restoredAt: 2 },
  { case: 10, items: [15], id: "MP25R3-10-cancel-reload", label: "… → 換金澤（timeout）→ 不用了 →（重新載入）→ 好", turns: [T1, T2, "不用了", "好"], reloadAfter: 2, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "cancel", "noRevive"] },
  { case: 11, items: [16], id: "MP25R3-11-replace-osaka", label: "… → 換金澤（timeout）→ 換大阪，再推薦幾個（Provider 成功）→ 好", turns: [T1, T2, "換大阪，再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "replace", "noRevive"] },
  { case: 12, items: ["C1"], id: "MP25R3-12-same-kyoto", label: "（對照）京都推薦景點 → 再推薦幾個 → 再推薦幾個", turns: [T1, "再推薦幾個", "再推薦幾個"], expect: ["origin", "same", "same"] },
  { case: 12, items: ["C1", 20], id: "MP25R3-12b-same-kyoto-fault", label: "（對照）京都推薦景點 → 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback → 正式 fallback continue］", turns: [T1, FAULT_MORE], expect: ["origin", "same"], requireFbContinue: [1] },
  { case: 14, items: [12, 2], id: "MP25R3-14-forged-pending-timeout", label: "（Session 恢復：rec=京都＋Client 保存的 destination_switch pending=金澤）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  { case: 14, items: [12, 2], id: "MP25R3-14b-forged-pending-ok", label: "（同上）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, expect: ["forgedOk"] },
  { case: 14, items: [13], id: "MP25R3-14c-forged-prev-keep", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 繼續原本的", turns: ["繼續原本的"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevKeep"] },
  { case: 14, items: [13], id: "MP25R3-14d-forged-prev-cancel", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 不用了", turns: ["不用了"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevCancel"] },
  { case: 14, items: [13, 2], id: "MP25R3-14e-forged-prev-yes", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevYes"] },
  { case: 14, items: [13, 2], id: "MP25R3-14f-forged-prev-timeout", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedPrevHold"] },
  { case: 14, items: [12, 2], id: "MP25R3-14g-forged-fields-timeout", label: "（rec=京都＋Client pending 夾帶 center／searchScope／radius／confirmedParentCity）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_FIELDS, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  // ── ★r3 新增 ──
  { case: "REF", items: [6], id: "MP25R3-REF-switch-ok", label: "（基準：既有推薦流程）京都推薦景點 → 換金澤，再推薦幾個（Provider 成功）", turns: [T1, T2], expect: ["origin", "ref"] },
  { case: 6, items: [10, 11, "S1", "S2"], id: "MP25R3-06c-rebuild-same-input", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 換金澤，再推薦幾個 ×2（相同輸入重建；皆 timeout）", turns: [T1, T2, "好", "好", T2, T2], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout", 5: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "rebuildCapped", "rebuildCapped"] },
  { case: 11, items: [16, 10, 11], id: "MP25R3-06d-capped-then-osaka", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 換大阪，再推薦幾個（Provider 成功；明確重新指定）", turns: [T1, T2, "好", "好", "換大阪，再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "replace"] },
  { case: 4, items: [5, 11], id: "MP25R3-06e-capped-then-kyoto", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "好", "好", "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "chooseOld", "oldMore"] },
  { case: 14, items: [13], id: "MP25R3-14h-forged-prev-kyoto-session-osaka", label: "（rec=大阪＋Client pending previousConfirmedDestination=京都）→ 繼續原本的（不得因 Pending 把京都當可信）", turns: ["繼續原本的"], r15Init: INIT_OSAKA, r18Pending: FORGED, trusted: "大阪", forgedPrev: "京都", expect: ["forgedPrevKeep"] },
  { case: 14, items: [17, 12, 2], id: "MP25R3-14j-forged-category-timeout", label: "（rec=京都、activeCategoryIntent=attraction＋Client pending categoryIntent=cafe）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_CAT, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"], pendCat: "cafe" },
  { case: 18, items: [14, 6, 2], id: "MP25R3-18-original-text-other-city", label: "京都推薦景點 → 不去大阪了，換金澤，再推薦幾個（timeout）→ 好（Provider 成功）", turns: [T1, T2_OTHER, "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"], otherCity: "大阪" },
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
const geoAll = (t, d) => (t.geocodes ?? []).filter((g) => K(String(g).split(":").slice(1).join(":")) === d || (d === "金澤" && /Kanazawa|石川/i.test(String(g))) || (d === "大阪" && /Osaka/i.test(String(g))) || (d === "京都" && /Kyoto/i.test(String(g))));
const isWeatherGeo = (g) => /^weather:/.test(String(g));
/** 修正 1：驗證次數＝所有「非 weather 階段」的該目的地 geocode（init／post／global_candidate／builder／nearby／*_validate…）。 */
const geoV = (t, d) => geoAll(t, d).filter((g) => !isWeatherGeo(g));
/** Weather 階段的該目的地 geocode（分開統計）。 */
const geoW = (t, d) => geoAll(t, d).filter(isWeatherGeo);
const weatherGeo = (t) => (t.geocodes ?? []).filter(isWeatherGeo);
const pendingOf = (t) => t.r18Pending ?? null;
const isSwitchPending = (p, cat = "attraction") => Boolean(p) && p.kind === "destination_switch" && K(p.rawGeographicLabel) === "金澤" && K(p.previousConfirmedDestination) === "京都" && p.categoryIntent === cat && p.originatingRoute === "more_places";
const pendingStr = (p) => (p ? JSON.stringify({ kind: p.kind, raw: p.rawGeographicLabel ?? null, prev: p.previousConfirmedDestination ?? null, cat: p.categoryIntent ?? null, route: p.originatingRoute ?? null, orig: p.originalUserText ?? null, attempts: p.confirmationAttempts ?? null }) : "null");
/** 與 r19-E／r20-E 相同的 Pending 欄位白名單。 */
const PENDING_ALLOWED = ["kind", "rawGeographicLabel", "previousConfirmedDestination", "categoryIntent", "originatingRoute", "parentIntent", "originalUserText", "confirmationAttempts"];
const pendingBadFields = (p) => (p && p.kind === "destination_switch" ? Object.keys(p).filter((k) => p[k] !== undefined && !PENDING_ALLOWED.includes(k)) : []);
/** 修正 3（r2）：noMore／替代推薦提問（文案正則；r3 另以正式 isAlternativeRecommendationOffer〔r20-O〕判定，兩者任一命中即算）。 */
const MISLEAD_RE = /要不要換成|換成美食|美食、咖啡廳|室內景點|換一個方向|另一個類別/;
const assistantOf = (t) => t.r15Assistant ?? [];
const assistantFull = (t) => t.r20Assistant ?? assistantOf(t);
const near = (c, d) => Boolean(c) && Math.abs(c.lat - COORDS[d].lat) < 1e-6 && Math.abs(c.lng - COORDS[d].lng) < 1e-6;
const nearLL = (c, d, tol) => Boolean(c) && typeof c.lat === "number" && typeof c.lng === "number" && Math.abs(c.lat - COORDS[d].lat) <= tol && Math.abs(c.lng - COORDS[d].lng) <= tol;
const COORD_RE = /-?\d{1,3}\.\d{2,}\s*[,，、/]\s*-?\d{1,3}\.\d{2,}/;
const SCOPE_RE = /searchScope|explicitSearchScope|radius|半徑|範圍\s*[:：=]|\blat(?:itude)?\s*[:=]|\bln?g(?:itude)?\s*[:=]|\blon\s*[:=]|公里內|\d\s*km\b|@\s*-?\d/i;
const countOf = (hay, needle) => {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n += 1;
  return n;
};
/** weather 請求內容中是否含某城市 Mock 座標（±0.008）。 */
const weatherNear = (t, d) =>
  (t.r18Weather ?? []).some((w) => {
    const nums = [...String(w.data ?? "").matchAll(/-?\d+\.\d+/g)].map((m) => Number(m[0]));
    return nums.some((x) => Math.abs(x - COORDS[d].lat) <= 0.008) && nums.some((x) => Math.abs(x - COORDS[d].lng) <= 0.008);
  });
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
const FAIL_KINDS = ["switchFail", "confirmFail", "confirmCapped", "forgedHold", "forgedPrevHold", "rebuildCapped"];
const NON_CONFIRM = ["hold", "idle", "chooseOld", "oldMore", "cancel", "noRevive", "forgedPrevKeep", "forgedPrevCancel"];
/** 未確認期間（Pending 仍有效、本輪不應確認任何新目的地）。 */
const PENDING_KINDS = ["switchFail", "hold", "confirmFail", "confirmCapped", "idle", "rebuildCapped", "forgedHold", "forgedPrevHold"];
const GEO_PROJ_KEYS = ["tc", "tpc", "trip", "rec", "arc", "location", "nla", "explicitSearchScope", "searchScope", "radius", "preferredArea"];
const canon = (v) => {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
};
const DB_WRITE_RE = /\.(insert|update|upsert|delete|remove|upload|move|copy)\b/i;

/**
 * 逐輪判定。回傳 [{cat, msg, tags}]；cat：PENDING（切換意圖未保存／未清除）、OLD-CITY（Provider 失敗後回到原城市搜尋／扣點／顯示）、
 * FEATURE（確認／選擇／取消／回覆行為未達成）、SAFETY（未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限、r14-A2 違反）、INFRA。
 * tags＝另外歸入的必修項目編號（例：Credits→20、Weather／Provider 計數→19、驗證上限→11、activeCategoryIntent→17、座標→18、原句→14）。
 */
function judgeTurn(kind, t, ctx) {
  const out = [];
  const add = (cat, msg, tags = []) => out.push({ cat, msg, tags });
  const c = cols(t);
  const shown = [...c.credits, ...c.cards, ...c.places];
  const kz = trustedIn(t, "金澤");
  const kzConfirmed = kz || ctx.kzConfirmedBefore;
  const pend = pendingOf(t);
  const OLDC = ctx.trusted; // 可信原城市（舊情境＝京都）
  const oldOnly = (arr) => arr.length > 0 && arr.every((d) => d === OLDC);
  const shownAll = [...c.places, ...c.credits, ...c.cards];
  const oldOrSafety = () => (oldOnly(shownAll) || (!shownAll.length && COORDS[OLDC] && weatherNear(t, OLDC) && !weatherNear(t, "金澤")) ? "OLD-CITY" : "SAFETY");
  // ── 全輪不變條件（r2 13／14／15）──
  if (!kzConfirmed && shown.includes("金澤")) add("SAFETY", `未確認金澤仍搜尋／扣點／顯示（${fmt(c)}）`, [1]);
  if (!kzConfirmed) for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === "金澤") add("SAFETY", `${k} 寫入未確認目的地「金澤」`, [1]);
  if (!kzConfirmed && c.credits.includes("金澤")) add("SAFETY", "Credits metadata.destination＝未確認「金澤」", [20]);
  for (const x of creditsFails(t)) add("SAFETY", x, [20]);
  const g = t.geocodes ?? [];
  if (new Set(g).size !== g.length) add("SAFETY", `同一輪重複 geocode（${g.join(",")}）`, [19]);
  if (geoV(t, "金澤").length > LIMITS.validatePerTurn) add("SAFETY", `同一輪金澤 Provider 驗證 ${geoV(t, "金澤").length} 次（>${LIMITS.validatePerTurn}；所有非 weather 階段：${geoV(t, "金澤").join(",")}）`, [19, 11]);
  if (weatherGeo(t).length > LIMITS.weatherGeoPerTurn) add("SAFETY", `同一輪 weather 階段 geocode ${weatherGeo(t).length} 次（>${LIMITS.weatherGeoPerTurn}）`, [19]);
  if ((t.weatherCalls ?? 0) > LIMITS.weatherPerTurn) add("SAFETY", `同一輪 weather 請求 ${t.weatherCalls} 次（>${LIMITS.weatherPerTurn}）`, [19]);
  for (const v of t.r14Violations ?? []) add("SAFETY", `r14-A2 違反：${v}`, /Credits/.test(v) ? [20] : []);
  const bad = pendingBadFields(pend);
  if (bad.length) add("SAFETY", `Session 的 destination_switch Pending 夾帶不允許欄位 ${bad.join(",")}`, [12]);
  if (pend?.kind === "destination_switch" && pend.previousConfirmedDestination != null && K(pend.previousConfirmedDestination) !== OLDC) add("SAFETY", `Session 的 Pending previousConfirmedDestination=${pend.previousConfirmedDestination}（不是 Session 可信 ${OLDC}；偽造值被保留）`, [13]);
  if (NON_CONFIRM.includes(kind) && geoV(t, "金澤").length) add("SAFETY", `非確認輪自動重新驗證金澤（${geoV(t, "金澤").join(",")}）`, [11]);
  if (FAIL_KINDS.includes(kind)) {
    // 修正 6：原城市 alt 分支的成本歸 OLD-CITY（不再一律 SAFETY）
    if ((t.weatherCalls ?? 0) || (t.builderCalls ?? 0)) add(oldOrSafety(), `Provider 失敗輪仍呼叫 Weather ${t.weatherCalls ?? 0}／Builder ${t.builderCalls ?? 0}（${fmt(c)}）`, [19]);
    const mis = assistantOf(t).filter((x) => MISLEAD_RE.test(x));
    const alt = (t.r20AltOffer ?? []).some(Boolean);
    if (mis.length || alt) add("FEATURE", `Provider 失敗輪顯示 noMore／替代推薦提問（${(mis[0] ?? assistantFull(t).find((_, i) => t.r20AltOffer?.[i]) ?? "").slice(0, 60)}）`);
  }
  // ── r3 新增全輪條件 ──
  if (!t.r20End || !("r20Start" in t)) add("INFRA", "缺 r20-O 記錄（不是經 r20 執行？）");
  // N1：未確認的金澤不得被 Weather 利用；確認輪 weather 不得早於金澤首次驗證
  if (!ctx.kzConfirmedBefore) {
    const wk = geoW(t, "金澤");
    if (wk.length && !kz) add("SAFETY", `未確認金澤被 Weather geocode 使用（${wk.join(",")}）`, [19]);
    else if (wk.length) {
      const firstV = g.findIndex((x) => !isWeatherGeo(x) && geoAll({ geocodes: [x] }, "金澤").length);
      const firstW = g.findIndex((x) => isWeatherGeo(x) && geoAll({ geocodes: [x] }, "金澤").length);
      if (firstV < 0 || firstW < firstV) add("SAFETY", `Weather 在金澤 Provider 驗證前就使用待確認金澤（geocode 順序=${g.join(",")}）`, [19]);
    }
    if (!kz && weatherNear(t, "金澤")) add("SAFETY", "未確認金澤的座標被送去 Weather", [19]);
  }
  // N2／N3／N5：未確認期間 Places／Credits（含 credits_check）／Builder＝0、Session 地理投影不變、非 RPC Supabase 寫入＝0
  if (PENDING_KINDS.includes(kind)) {
    if ((t.placesRequests ?? 0) > 0) add(oldOrSafety(), `未確認期間仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`, [1]);
    const cr = (t.creditsRpc ?? []).filter((x) => /^credits_/.test(x));
    if (cr.length || (t.r15Credits ?? []).length) add(oldOrSafety(), `未確認期間 Credits 啟動（begin=${(t.r15Credits ?? []).length} RPC=${cr.join(",") || "-"}）`, [20]);
    if (t.r20Start && t.r20End) {
      const ch = GEO_PROJ_KEYS.filter((k) => canon(t.r20Start[k]) !== canon(t.r20End[k]));
      // 變更內容只含原城市、且本輪是原城市搜尋（OLD-CITY 行為的連帶寫入）→ OLD-CITY；含待確認／其他城市或座標 → SAFETY
      const chText = ch.map((k) => canon(t.r20End[k])).join(" ");
      const foreign = /金澤|金沢|Kanazawa|大阪|Osaka|36\.56|136\.65/.test(chText) && OLDC !== "大阪";
      if (ch.length) add(!foreign && oldOnly(shownAll) ? "OLD-CITY" : "SAFETY", `未確認期間 Session 地理欄位改變：${ch.map((k) => `${k}=${canon(t.r20Start[k]).slice(0, 50)}→${canon(t.r20End[k]).slice(0, 50)}`).join("；")}`, [1]);
    }
    const w = (t.r20Db ?? []).filter((x) => DB_WRITE_RE.test(x));
    if (w.length) add("SAFETY", `未確認期間非 RPC Supabase 寫入 ${w.length} 次（${w.slice(0, 3).join(",")}）`, [1]);
  }
  // N4：未確認時 Session 不得含金澤座標
  if (!kzConfirmed && (t.r20CoordHits?.金澤 ?? []).length) add("SAFETY", `未確認金澤的座標寫入 Session（${t.r20CoordHits.金澤.slice(0, 4).join(",")}）`, [18, 1]);
  // N6／N7：Session 中的 destination_switch Pending 本身（originalUserText／confirmationAttempts／activeCategoryIntent）
  if (pend?.kind === "destination_switch") {
    const o = pend.originalUserText;
    // 建立當輪原句只對「金澤」Pending 追蹤；其他目的地的 Pending（例：06d／11 之後若出現）以本輪原句為準
    const ref = K(pend.rawGeographicLabel) === "金澤" ? ctx.creationText : ctx.turnText;
    if (typeof o !== "string" || !o.trim()) add("PENDING", "Pending 缺 originalUserText", [14]);
    else {
      if (typeof ref === "string" && o !== ref) add("PENDING", `originalUserText≠建立 Pending 當輪原句（${JSON.stringify(o.slice(0, 40))} vs ${JSON.stringify(ref.slice(0, 40))}）`, [14]);
      const raw = String(pend.rawGeographicLabel ?? "").trim();
      if (raw && !o.includes(raw)) add("PENDING", `originalUserText 不含待確認目的地「${raw}」`, [14]);
      const refT = typeof ref === "string" ? ref : "";
      const prev = String(pend.previousConfirmedDestination ?? "").trim();
      if (prev && countOf(o, prev) > countOf(refT, prev)) add("SAFETY", `originalUserText 重複拼接父城市「${prev}」`, [14]);
      if (COORD_RE.test(o) && !COORD_RE.test(refT)) add("SAFETY", "originalUserText 附加座標", [14]);
      if (SCOPE_RE.test(o) && !SCOPE_RE.test(refT)) add("SAFETY", "originalUserText 附加搜尋範圍", [14]);
      if (ctx.lim && o.length > ctx.lim.userText) add("SAFETY", `originalUserText 長度 ${o.length} > 既有上限 ${ctx.lim.userText}`, [14]);
    }
    const raw = String(pend.rawGeographicLabel ?? "");
    if (ctx.lim && raw.trim().length > ctx.lim.label) add("SAFETY", `rawGeographicLabel 長度 ${raw.trim().length} > 既有上限 ${ctx.lim.label}`, [14]);
    if (COORD_RE.test(raw)) add("SAFETY", "rawGeographicLabel 是座標字串", [14]);
    const n = pend.confirmationAttempts;
    if (!Number.isInteger(n)) add("PENDING", `Pending 缺 confirmationAttempts（=${JSON.stringify(n ?? null)}）`, [11]);
    else {
      if (n < 0 || n > LIMITS.validatePerPending) add("SAFETY", `confirmationAttempts=${n}（必須 0–${LIMITS.validatePerPending}）`, [11]);
      if (n < ctx.attemptsMax) add("SAFETY", `confirmationAttempts 被重置／減少 ${ctx.attemptsMax}→${n}（相同輸入不得重置上限）`, [11, "S2"]);
      if (n < ctx.confirmVal) add("SAFETY", `confirmationAttempts=${n} 少於已執行的確認驗證次數 ${ctx.confirmVal}`, [11]);
    }
    if (t.r20Start && t.r20End && canon(t.r20Start.activeCategoryIntent) !== canon(t.r20End.activeCategoryIntent)) add("SAFETY", `Pending 存在的輪 activeCategoryIntent 被改變 ${t.r20Start.activeCategoryIntent ?? "-"}→${t.r20End.activeCategoryIntent ?? "-"}`, [17]);
  }
  if (ctx.forgedCatTurn && t.r20Start && t.r20End && (canon(t.r20Start.activeCategoryIntent) !== canon(t.r20End.activeCategoryIntent) || t.r20End.activeCategoryIntent === ctx.forgedCatTurn)) add("SAFETY", `Client pending 的 categoryIntent=${ctx.forgedCatTurn} 污染 activeCategoryIntent（${t.r20Start.activeCategoryIntent ?? "-"}→${t.r20End.activeCategoryIntent ?? "-"}）`, [17, 12]);
  // ── 類型 ──
  const kyotoShown = shown.includes("京都");
  if (kind === "origin") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `前置：T1 沒有京都卡片（${fmt(c)}）`);
    const tk = (t.trust ?? []).filter((x) => x.status === "trusted" && K(x.destination) === "京都" && x.center);
    if (tk.length && !tk.some((x) => near(x.center, "京都"))) add("INFRA", `京都可信中心不是情境 Mock 座標（${tk.map((x) => JSON.stringify(x.center)).join(",")}；r19Coords 未生效）`, [18]);
    if (tk.some((x) => near(x.center, "京都"))) ctx.evidence.coordsKyoto = true;
  } else if (kind === "ref") {
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("INFRA", `REF 前提不成立：既有推薦流程（Provider 成功）沒有金澤卡片（${fmt(c)}）→ confirmNew 的成本基準無法建立`);
    const rk = (t.trust ?? []).filter((x) => x.status === "trusted" && K(x.destination) === "金澤" && x.center);
    if (rk.length && !rk.some((x) => near(x.center, "金澤"))) add("INFRA", `REF 金澤可信中心不是情境 Mock 座標（${rk.map((x) => JSON.stringify(x.center)).join(",")}；r19Coords 未生效）`, [18]);
    if (rk.some((x) => near(x.center, "金澤"))) ctx.evidence.coordsKanazawa = true;
    return out.filter((x) => x.cat === "INFRA");
  } else if (kind === "switchFail") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍開始 Credits（${c.credits.join(",")}）`, [20]);
    if ((t.r15Cards ?? []).length) add(kyotoShown ? "OLD-CITY" : "SAFETY", `Provider 失敗仍顯示卡片（${c.cards.join(",")}）`);
    if (c.rec !== "京都") add("SAFETY", `原本可信目的地被覆蓋：recommendationSession=${c.rec ?? "-"}（應保留京都）`);
    if (c.tc !== "京都") add("SAFETY", `原本可信目的地被覆蓋：travelContext=${c.tc ?? "-"}（應保留京都）`);
    if (!isSwitchPending(pend, ctx.pendCat ?? "attraction")) add("PENDING", `未保存切換意圖：pendingClarification=${pendingStr(pend)}（應為 destination_switch／金澤／原確認京都／${ctx.pendCat ?? "attraction"}／more_places）`);
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
    if (t.r20End && ctx.originCat && t.r20End.activeCategoryIntent !== ctx.originCat) add("FEATURE", `選京都後 activeCategoryIntent=${t.r20End.activeCategoryIntent ?? "-"}（應維持原本 ${ctx.originCat}）`, [17]);
  } else if (kind === "oldMore") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `選京都後續推沒有京都卡片（${fmt(c)}）`);
    if (pend) add("PENDING", `選京都後續推仍有 pending（${pendingStr(pend)}）`);
  } else if (kind === "confirmNew") {
    if (!kz) add("FEATURE", `確認金澤：本輪沒有可信判定成功（trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? "-"}`).join(",") || "-"}）`);
    // 修正 1：Provider 驗證可在任一非 weather 階段（不只 *_validate）
    if (!geoV(t, "金澤").length) add("FEATURE", "確認金澤：本輪沒有 Provider 驗證（Client pending 不是證據）");
    const tk = (t.trust ?? []).filter((x) => x.status === "trusted" && K(x.destination) === "金澤");
    if (tk.length && !tk.every((x) => K(x.label) === "金澤")) add("FEATURE", `確認金澤：可信判定的輸入標籤與待確認目的地不一致（label=${tk.map((x) => x.label).join(",")}）`);
    if (tk.length && !tk.some((x) => near(x.center, "金澤"))) add("FEATURE", `確認金澤：可信中心不是金澤 Provider 座標（${tk.map((x) => JSON.stringify(x.center)).join(",")}）`, [18]);
    if (tk.some((x) => near(x.center, "金澤"))) ctx.evidence.coordsKanazawa = true;
    if ((t.trust ?? []).some((x) => x.status === "trusted" && K(x.destination) === "京都")) add("OLD-CITY", "確認金澤輪的可信判定含京都");
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `確認金澤後沒有金澤卡片（${fmt(c)}）`);
    const ll = (t.r20CardLL ?? []).filter((x) => x.lat != null);
    if (c.cards.length && c.cards.every((d) => d === "金澤") && ll.length && !ll.every((x) => nearLL(x, "金澤", 0.05))) add("FEATURE", `確認金澤：卡片座標不在金澤 Mock 座標附近（${ll.slice(0, 3).map((x) => `${x.lat},${x.lng}`).join("；")}）`, [18]);
    if (c.credits.length !== 1 || c.credits[0] !== "金澤") add("FEATURE", `確認金澤：Credits metadata=[${c.credits.join(",") || "-"}]（應恰好 1 次金澤）`, [20]);
    if (c.rec !== "金澤" || c.tc !== "金澤") add("FEATURE", `確認金澤：rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}（應為金澤）`);
    if (kyotoShown) add("OLD-CITY", `確認金澤後仍出現京都（${fmt(c)}）`);
    if (pend) add("PENDING", `確認後 pending 未清除（${pendingStr(pend)}）`);
    // 裁決：移除 r2 Q5（Places ≤2／Builder ≤1／Weather ≤1）；改為 ≤ 同樹既有推薦流程（REF T2）
    if (!ctx.ref) add("INFRA", "確認成功輪的既有推薦流程基準（REF）缺失／未成立");
    else
      for (const [label, v, r] of [["Places 請求", t.placesRequests ?? 0, ctx.ref.places], ["Builder", t.builderCalls ?? 0, ctx.ref.builder], ["Weather 請求", t.weatherCalls ?? 0, ctx.ref.weather], ["Weather geocode", weatherGeo(t).length, ctx.ref.weatherGeo], ["Credits.begin", (t.r15Credits ?? []).length, ctx.ref.begins]])
        if (v > r) add(kyotoShown ? "OLD-CITY" : "SAFETY", `確認成功輪 ${label}=${v} 高於同樹既有推薦流程（REF T2）=${r}`, label.startsWith("Credits") ? [20, 19] : [19]);
  } else if (kind === "newMore") {
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `切換金澤後續推沒有金澤卡片（${fmt(c)}）`);
    if (kyotoShown || [c.rec, c.tc, c.arc].includes("京都")) add("OLD-CITY", `切換金澤後續推出現京都（${fmt(c)}）`);
  } else if (kind === "confirmFail" || kind === "confirmCapped" || kind === "rebuildCapped") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍開始 Credits（${c.credits.join(",")}）`, [20]);
    if (kyotoShown) add("OLD-CITY", `確認輪 Provider 失敗後回到京都（${fmt(c)}）`);
    if (kind !== "rebuildCapped" && !isSwitchPending(pend)) add("PENDING", `確認輪 Provider 失敗後 pending 未保留（${pendingStr(pend)}）`);
    if (c.rec !== "京都" || c.tc !== "京都") add("SAFETY", `確認輪 Provider 失敗後京都被覆蓋（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}）`);
    if (kind === "confirmCapped" && geoV(t, "金澤").length) add("SAFETY", `同一 Pending 已達自動驗證上限 ${LIMITS.validatePerPending} 次仍再驗證金澤（${geoV(t, "金澤").join(",")}）＝無限重試`, [11, "S1"]);
    if (kind === "rebuildCapped" && geoV(t, "金澤").length) add("SAFETY", `達上限後以相同輸入重建 Pending 又驗證金澤（${geoV(t, "金澤").join(",")}）＝繞過上限`, [11, "S1", "S2"]);
  } else if (kind === "idle") {
    if (geoV(t, "金澤").length) add("SAFETY", `非確認輪自動重新驗證金澤（${geoV(t, "金澤").join(",")}）＝反覆自動驗證`, [11, "S1"]);
    if (kyotoShown) add("OLD-CITY", `連續失敗後自動回到京都（${fmt(c)}）`);
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `連續失敗後仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
  } else if (kind === "cancel") {
    if (pend) add("PENDING", `取消後 pending 未清除（${pendingStr(pend)}）`);
    if (shown.includes("金澤") || [c.rec, c.tc, c.arc].includes("金澤")) add("FEATURE", `取消後仍出現金澤（${fmt(c)}）`);
  } else if (kind === "noRevive") {
    if (geoV(t, "金澤").length || shown.includes("金澤")) add("PENDING", `已取消／取代的金澤切換被復活（geocode=${geoV(t, "金澤").join(",") || "-"}；${fmt(c)}）`);
    if (isSwitchPending(pend)) add("PENDING", `已取消／取代的 pending 仍存在（${pendingStr(pend)}）`);
    if (ctx.restoredPending && isSwitchPending(ctx.restoredPending)) add("PENDING", `重新載入後取消的 pending 復活（輪初 ${pendingStr(ctx.restoredPending)}）`);
  } else if (kind === "replace") {
    if (!c.cards.length || c.cards.some((d) => d !== "大阪")) add("FEATURE", `換大阪沒有大阪卡片（${fmt(c)}）`);
    if (shown.includes("金澤") || shown.includes("京都")) add("SAFETY", `換大阪仍出現金澤／京都（${fmt(c)}）`);
    if (isSwitchPending(pend)) add("PENDING", `新目的地後舊 pending（金澤）仍存在（${pendingStr(pend)}）`);
    if (geoV(t, "金澤").length) add("SAFETY", `換大阪輪仍驗證金澤（${geoV(t, "金澤").join(",")}）`, [11]);
  } else if (kind === "same") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `同城續推沒有京都卡片（${fmt(c)}）`);
    if (pend) add("PENDING", `同城續推出現 pending（${pendingStr(pend)}）`);
    if (c.rec !== "京都") add("FEATURE", `同城續推 rec=${c.rec ?? "-"}`);
  } else if (kind === "forgedHold" || kind === "forgedPrevHold") {
    if (shown.includes("金澤") || (t.placesRequests > 0 && c.places.includes("金澤"))) add("SAFETY", `Client pending 被當成驗證證據：Provider 失敗仍搜尋／扣點／顯示金澤（${fmt(c)}）`, [12]);
    if ([c.rec, c.tc, c.arc, c.tpc].includes("金澤")) add("SAFETY", `Client pending 被當成驗證證據：Session 寫入金澤（${fmt(c)}）`, [12]);
    // 修正 1（r2）：任何京都搜尋／扣點／卡片皆 FAIL
    if (kyotoShown) add("OLD-CITY", `Provider 失敗後以京都搜尋／扣點／顯示（${fmt(c)}）`);
  } else if (kind === "forgedOk" || kind === "forgedPrevYes") {
    if (shown.includes("金澤") && !(kz && geoV(t, "金澤").length)) add("SAFETY", `Client pending 被當成驗證證據：未在本輪完成 Provider 驗證就使用金澤（${fmt(c)}）`, [12]);
    if (kyotoShown) add("OLD-CITY", `「好」（確認 Pending）卻以京都搜尋／扣點／顯示（${fmt(c)}）`);
  } else if (kind === "forgedPrevKeep" || kind === "forgedPrevCancel") {
    if (pend) add("PENDING", `${kind === "forgedPrevKeep" ? "選擇原本的" : "取消"}後 pending 未清除（${pendingStr(pend)}）`);
    if (shown.includes("金澤") || [c.rec, c.tc, c.arc, c.tpc].includes("金澤")) add("SAFETY", `偽造 Pending 後出現金澤（${fmt(c)}）`, [13]);
    if ((t.r15Cards ?? []).length && c.cards.some((d) => d !== OLDC)) add("SAFETY", `偽造 Pending 後卡片非可信${OLDC}（${c.cards.join(",")}）`, [13]);
  }
  if (kind.startsWith("forgedPrev")) {
    // 修正 2（r2）：偽造的 previousConfirmedDestination 不得被驗證、搜尋、扣點或寫入任何可信欄位；可信城市以 Session 為準（r3：參數化）
    const FP = ctx.forgedPrev;
    if (geoAll(t, FP).length) add("SAFETY", `偽造 previousConfirmedDestination「${FP}」被送去 Provider（${geoAll(t, FP).join(",")}）`, [13]);
    if (shown.includes(FP)) add("SAFETY", `偽造 previousConfirmedDestination「${FP}」被搜尋／扣點／顯示（${fmt(c)}）`, [13]);
    for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === FP) add("SAFETY", `${k} 寫入偽造的「${FP}」`, [13]);
    if (c.rec !== OLDC && !kz) add("SAFETY", `可信${OLDC}被覆蓋（rec=${c.rec ?? "-"}）`, [13]);
    if ((t.r20CoordHits?.[FP] ?? []).length) add("SAFETY", `偽造「${FP}」的座標寫入 Session（${t.r20CoordHits[FP].slice(0, 3).join(",")}）`, [13, 18]);
  }
  if (ctx.otherCity) {
    const OC = ctx.otherCity;
    if (geoAll(t, OC).length) add("SAFETY", `原句夾帶的其他城市「${OC}」被送去 Provider（${geoAll(t, OC).join(",")}）`, [14]);
    if (shown.includes(OC)) add("SAFETY", `原句夾帶的其他城市「${OC}」被搜尋／扣點／顯示（${fmt(c)}）`, [14]);
    for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === OC) add("SAFETY", `${k} 寫入原句夾帶的其他城市「${OC}」`, [14]);
    if (pend?.kind === "destination_switch" && K(pend.rawGeographicLabel) === OC) add("SAFETY", `Pending rawGeographicLabel＝原句夾帶的其他城市「${OC}」`, [14]);
  }
  // 本輪經過 r13 模型「未重建」路徑（下游未執行正式碼）：失敗只能記為 MODEL（UNVERIFIED），不作為 PASS 也不作為正式碼 P1
  if (/未重建/.test(String(t.path ?? ""))) return out.map((x) => ({ cat: x.cat === "INFRA" ? "INFRA" : "MODEL", msg: `${x.msg}（r13 模型未重建路徑：${String(t.path).slice(0, 60)}）`, tags: x.tags }));
  return out;
}

// ════════════════ report ════════════════
const CAT_EXPECTED = new Set(["PENDING", "OLD-CITY", "FEATURE"]);
const KZ_CONFIRM_KINDS = ["switchFail", "confirmNew", "confirmFail", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold"];
const YES_KINDS = ["confirmNew", "confirmFail", "confirmCapped", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold"];
/** confirmationAttempts 應計入的「確認驗證」輪（建立 Pending 之後、針對同一 Pending 的驗證）。 */
const CONFIRM_VAL_KINDS = ["confirmFail", "confirmCapped", "rebuildCapped", "forgedHold", "forgedPrevHold", "forgedOk", "forgedPrevYes", "confirmNew"];
export const ITEMS = [
  { no: 1, name: "未確認金澤不搜尋、不扣點", scen: "01,02,03", where: "judgeTurn 全輪：未確認金澤 shown／六欄寫入／Credits metadata；N2 未確認期間 Places／Credits；N3 Session 地理投影不變；N4 金澤座標；N5 非 RPC 寫入" },
  { no: 2, name: "回覆「好」不搜尋京都", scen: "05,06,06b,07b,08b,09,14,14b,14e,14f,14g,14j,18", where: "report 彙總：「好」且 YES_KINDS 輪 Places／Credits／卡片含京都 → OLD-CITY" },
  { no: 3, name: "回覆「再推薦幾個」不搜尋京都", scen: "02,02b,07,08,09b", where: "judgeTurn hold：kyotoShown → OLD-CITY；N2 Places>0" },
  { no: 4, name: "回覆「便宜一點的」不搜尋京都", scen: "03", where: "judgeTurn hold（同上）" },
  { no: 5, name: "明確選擇京都才恢復京都", scen: "04,06e", where: "judgeTurn chooseOld／oldMore" },
  { no: 6, name: "確認金澤後需重新驗證", scen: "05,05b,09,18（REF 基準）", where: "judgeTurn confirmNew：trusted 金澤＋V(金澤)≥1（任一非 weather 階段）＋標籤／中心＝金澤＋成本 ≤ REF" },
  { no: 7, name: "Provider 再次 timeout", scen: "06,06b", where: "judgeTurn confirmFail／confirmCapped" },
  { no: 8, name: "Provider null", scen: "07,07b", where: "judgeTurn switchFail／hold／confirmFail" },
  { no: 9, name: "ZERO_RESULTS", scen: "08,08b", where: "judgeTurn switchFail／hold／confirmFail" },
  { no: 10, name: "重複詢問上限", scen: "06b,06c,06d", where: "report：askTurn（輪末同一 Pending＋新助理訊息＋無卡片＋〔含問號或與先前提問逐字相同〕）> 3 → SAFETY" },
  { no: 11, name: "重複驗證上限", scen: "06,06b,06c,06d,06e", where: "judgeTurn V≤1／confirmCapped／rebuildCapped／idle V=0；confirmationAttempts 0–2、不減少、≥ 已執行確認驗證；report：同一 Pending 驗證總數 ≤2" },
  { no: 12, name: "偽造 Pending", scen: "14,14b,14g,14j", where: "judgeTurn forgedHold／forgedOk；Pending 欄位白名單" },
  { no: 13, name: "偽造 previousConfirmedDestination", scen: "14c,14d,14e,14f,14h", where: "judgeTurn forgedPrev*（偽造城市不得驗證／搜尋／扣點／寫入；可信城市以 Session 為準）；Pending prev≠Session 可信城市 → SAFETY" },
  { no: 14, name: "原句夾帶其他城市", scen: "18", where: "judgeTurn otherCity（大阪不得驗證／搜尋／扣點／寫入／成為 raw）＋N6 originalUserText＝建立輪原句、含 raw、不拼接父城市、無座標／範圍、≤ 既有上限" },
  { no: 15, name: "Pending 取消與 Reload", scen: "09,09b,10", where: "report restoredAt；judgeTurn cancel／noRevive" },
  { no: 16, name: "新目的地覆蓋舊 Pending", scen: "11,06d", where: "judgeTurn replace／noRevive" },
  { no: 17, name: "activeCategoryIntent 不得污染", scen: "全部（Pending 存在的輪）＋14j＋04/06e chooseOld", where: "judgeTurn N7：Pending 存在的輪 activeCategoryIntent 輪初＝輪末；14j Client pending categoryIntent 不得寫入；chooseOld 維持原類別；r20 探針 R-N01／R-N02" },
  { no: 18, name: "金澤／京都 Mock 座標不同", scen: "全部（r19Coords）", where: "judgeTurn origin（京都可信中心＝京都座標，否則 INFRA）／confirmNew（可信中心＝金澤座標、卡片座標在金澤附近）／N4；需有座標證據才可 PASS" },
  { no: 19, name: "Provider 與 Weather 分開計數", scen: "全部", where: "judgeTurn：V(金澤)≤1、WG≤1、W≤1、未確認金澤 WG／W 座標＝0、確認輪 weather 不得早於金澤首次驗證；失敗輪 Weather／Builder=0" },
  { no: 20, name: "Credits 預留與結算安全", scen: "全部（02b、12b 故障）", where: "creditsFails（begin＝settle、成功結算＝有卡片、reserve＝commit＋rollback、commit＝有卡片）；未確認期間任何 credits_* RPC（含 credits_check）＝0" },
  { no: "C1", name: "（r2 #12 對照）同目的地正常續推", scen: "12,12b", where: "judgeTurn same；12b 正式 fallback continue；work geocode／Places ≤ mp1" },
  { no: "S1", name: "超出上限後不再呼叫 Provider", scen: "06,06b,06c", where: "confirmCapped／rebuildCapped／idle：V(金澤)=0" },
  { no: "S2", name: "不因相同輸入重建 Pending 而繞過上限", scen: "06c", where: "rebuildCapped V=0；confirmationAttempts 不減少；report 同一 Pending 驗證總數 ≤2" },
  { no: "S3", name: "合法 Pending 寫入不被誤判為 P1", scen: "r20 探針 R-E01～R-E10", where: "r20 r20ExceptionProbe（每次執行先跑；不符 → INFRA-FAIL）" },
  { no: "S4", name: "夾帶非法 Session 欄位仍判 P1", scen: "r20 探針 R-N01～R-N41", where: "同上" },
];
export function report({ results, TREES, out }) {
  const SHOW = ["work", "mp1", "a2"].filter((t) => TREES.includes(t));
  const H = globalThis.__R19_H ?? {};
  const LIM = globalThis.__R20_LIMITS ?? null;
  const PROBE = globalThis.__R20_PROBE ?? null;
  out.push("\n══════════════ MP-25 destination_switch 失敗測試 r3（A2-MP-T7；r20 掛載；樹 work／mp1／a2）══════════════");
  out.push("  分類：PENDING＝切換意圖未保存／未清除／復活；OLD-CITY＝Provider 失敗後回到原城市；FEATURE＝確認／選擇／取消／回覆行為未達成；SAFETY＝未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限、r14-A2 違反；INFRA＝測試前提不成立");
  out.push(`  上限：${JSON.stringify(LIMITS)}；既有長度上限：${LIM ? `原句 ≤${LIM.userText}〔${LIM.src.userText}〕、地名 ≤${LIM.label}〔${LIM.src.label}〕` : "（缺；不是經 r20 執行 → INFRA）"}`);
  for (const tree of SHOW) {
    const h = H[tree];
    const model = (h?.refs ?? []).filter((r) => r.where === "model");
    out.push(`  r19-H ${tree.padEnd(5)} destination_switch 區段=${h?.region ? `L${h.region.start}-${h.region.end}（${h.region.statements} 句）` : "（無 handler → 模型照舊）"}；區段外（模型路徑）參照=${model.length ? model.map((r) => `L${r.line}`).join(",") : "0"}`);
  }
  const rows = {};
  const row = (no, tree) => ((rows[no] ??= {})[tree] ??= { fails: [], ran: 0, model: [], na: [] });
  const scenFails = {};
  const tagged = {};
  const evidence = {};
  // REF 成本（每樹）
  const refCost = {};
  for (const tree of SHOW) {
    const r = results[`${tree}|ok|MP25R3-REF-switch-ok`];
    const t = r?.result?.turns ? turnOf(r.result.turns, 1) : null;
    if (t && (t.r15Cards ?? []).length && uniq((t.r15Cards ?? []).map(cardDest)).every((d) => d === "金澤")) refCost[tree] = { places: t.placesRequests ?? 0, builder: t.builderCalls ?? 0, weather: t.weatherCalls ?? 0, weatherGeo: weatherGeo(t).length, begins: (t.r15Credits ?? []).length, v: geoV(t, "金澤").length };
  }
  out.push(`  REF（既有推薦流程 T2 成本；confirmNew 基準）：${SHOW.map((tree) => `${tree}=${refCost[tree] ? JSON.stringify(refCost[tree]) : "（未成立）"}`).join("  ")}`);
  for (const s of NEW_SCENARIOS) {
    out.push(`\n[MP25R3][${s.id}] 項目 ${s.items.join(",")}：${s.label}`);
    for (const tree of SHOW) {
      const r = results[`${tree}|ok|${s.id}`];
      if (!r) continue;
      const SF = ((scenFails[s.id] ??= {})[tree] ??= { fails: [], model: [], na: [], ran: 1 });
      const ev = (evidence[tree] ??= { coordsKyoto: false, coordsKanazawa: false });
      const push = (x) => {
        SF.fails.push(x);
        for (const tg of x.tags ?? []) ((tagged[tg] ??= {})[tree] ??= []).push(x);
      };
      if (lim(LIM)) push({ cat: "INFRA", msg: `${s.id}：缺 r20 既有長度上限（不是經 r20 執行）`, tags: [] });
      if (r.err || r.result?.error) {
        push({ cat: "INFRA", msg: `${s.id}：${String(r.err ?? r.result.error).slice(0, 160)}`, tags: [] });
        out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
        continue;
      }
      if (r.fetchCalls) push({ cat: "SAFETY", msg: `外部請求 ${r.fetchCalls} 次`, tags: [] });
      const turns = r.result.turns ?? [];
      let kzConfirmedBefore = false;
      let kzGeoTotal = 0;
      let kzGeoUntilConfirm = 0;
      let confirmedAt = -1;
      let asks = 0;
      const askTexts = new Set();
      let attemptsMax = 0;
      let confirmVal = 0;
      let creationText = s.r18Pending?.originalUserText ?? null;
      let createdAt = s.r18Pending ? -1 : null;
      const originCat = s.r15Init?.topic ?? "attraction";
      for (const [i, kind] of s.expect.entries()) {
        const t = turnOf(turns, i);
        if (!t) {
          push({ cat: "INFRA", msg: `${s.id} T${i + 1} 缺失`, tags: [] });
          out.push(`  ${tree.padEnd(5)} T${i + 1} 缺失`);
          continue;
        }
        if (t.error) push({ cat: "INFRA", msg: `${s.id} T${i + 1} ${String(t.error).slice(0, 160)}`, tags: [] });
        const pend = pendingOf(t);
        if (pend?.kind === "destination_switch" && K(pend.rawGeographicLabel) === "金澤" && createdAt === null) {
          createdAt = i;
          creationText = typeof s.turns[i] === "string" ? s.turns[i] : (s.turns[i]?.text ?? null);
        }
        const ctx = {
          kzConfirmedBefore,
          restoredPending: s.reloadAfter != null && i === s.reloadAfter + 1 ? t.r18PendingAtStart : null,
          trusted: s.trusted ?? "京都",
          forgedPrev: s.forgedPrev ?? "大阪",
          otherCity: s.otherCity ?? null,
          pendCat: s.pendCat && s.expect[i] === "switchFail" ? s.pendCat : null,
          forgedCatTurn: s.pendCat && s.r18Pending && i === 0 ? s.pendCat : null,
          originCat,
          creationText,
          turnText: typeof s.turns[i] === "string" ? s.turns[i] : (s.turns[i]?.text ?? null),
          attemptsMax,
          confirmVal: confirmVal + (CONFIRM_VAL_KINDS.includes(kind) && kind !== "confirmNew" ? geoV(t, "金澤").length : 0),
          ref: refCost[tree] ?? null,
          lim: LIM,
          evidence: ev,
        };
        const f = judgeTurn(kind, t, ctx);
        if (s.restoredAt === i && !isSwitchPending(t.r18PendingAtStart)) f.push({ cat: "PENDING", msg: `重新載入後 pending 未恢復（輪初 ${pendingStr(t.r18PendingAtStart)}）`, tags: [15] });
        const turnSpec = s.turns[i];
        // 修正 2：故障只在實際進入相關路徑（pushMorePlaceRecommendations 被呼叫）時才要求生效；未進入 → N/A（由行為斷言判定）
        if (turnSpec && typeof turnSpec === "object" && turnSpec.fault) {
          const called = (t.r14Calls ?? []).some((x) => String(x).startsWith("more=")) || (t.r19Faults ?? []).length > 0;
          if (!called) SF.na.push(`${s.id} T${i + 1}：pushMorePlaceRecommendations 未被呼叫 → 故障注入檢查 N/A（行為斷言照判）`);
          else if (!(t.r19Faults ?? []).length) f.push({ cat: "INFRA", msg: `pushMorePlaceRecommendations 已呼叫但故障未注入（calls=${(t.r14Calls ?? []).join(",")}）`, tags: [] });
          else if (!/r19:fault/.test(String(t.path ?? "")) && !t.error) f.push({ cat: "INFRA", msg: `故障已注入但未走到正式 catch 模型（path=${String(t.path ?? "").slice(0, 80)}）`, tags: [] });
        }
        if ((s.requireFbContinue ?? []).includes(i) && !/r18:fbContinue\(real\)/.test(String(t.path ?? ""))) f.push({ cat: "INFRA", msg: `故障模式未走到正式 fallback continue（path=${String(t.path ?? "").slice(0, 100)}）`, tags: [] });
        // Q4（修正 3）：確認提問＝輪末同一 Pending＋本輪新助理訊息＋無卡片＋（含問號或與先前提問逐字相同）
        if (pend?.kind === "destination_switch" && K(pend.rawGeographicLabel) === "金澤" && !(t.r15Cards ?? []).length) {
          const A = assistantFull(t).map((x) => x.trim()).filter(Boolean);
          if (A.length && (A.some((x) => /[？?]/.test(x)) || A.some((x) => askTexts.has(x)))) {
            asks += 1;
            for (const x of A) askTexts.add(x);
            if (asks > LIMITS.asksPerPending) f.push({ cat: "SAFETY", msg: `同一 Pending 第 ${asks} 次確認提問（>${LIMITS.asksPerPending}）＝重複詢問（${A[0].slice(0, 40)}）`, tags: [10] });
          }
        }
        if (Number.isInteger(pend?.confirmationAttempts) && pend.kind === "destination_switch") attemptsMax = Math.max(attemptsMax, pend.confirmationAttempts);
        if (CONFIRM_VAL_KINDS.includes(kind) && kind !== "confirmNew") confirmVal += geoV(t, "金澤").length;
        kzGeoTotal += geoV(t, "金澤").length;
        if (confirmedAt < 0) kzGeoUntilConfirm += geoV(t, "金澤").length;
        if (confirmedAt < 0 && trustedIn(t, "金澤")) confirmedAt = i;
        kzConfirmedBefore = kzConfirmedBefore || trustedIn(t, "金澤");
        out.push(`  ${tree.padEnd(5)} T${i + 1}「${t.text}」（${kind}） ${fmt(cols(t))} pending=${pendingStr(pend)}`);
        out.push(`        path=${String(t.path ?? "").slice(0, 220)} geocode=${(t.geocodes ?? []).length}[${(t.geocodes ?? []).join(",")}] V(金澤)=${geoV(t, "金澤").length} WG=${weatherGeo(t).length} W=${t.weatherCalls ?? 0} placesReq=${t.placesRequests ?? 0} builder=${t.builderCalls ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] db寫入=${(t.r20Db ?? []).filter((x) => DB_WRITE_RE.test(x)).length} trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? x.reason ?? "-"}${x.center ? `@${x.center.lat},${x.center.lng}` : ""}`).join(",") || "-"}`);
        out.push(`        助理=${JSON.stringify(assistantOf(t).map((x) => x.slice(0, 60)))} altOffer=${JSON.stringify(t.r20AltOffer ?? null)} aci=${t.r20Start?.activeCategoryIntent ?? "-"}→${t.r20End?.activeCategoryIntent ?? "-"}${t.r19Exc?.length ? ` r19Exc=${JSON.stringify(t.r19Exc).slice(0, 300)}` : ""}`);
        if (f.length) out.push(`        ✗ ${f.map((x) => `[${x.cat}] ${x.msg}`).join("；")}`);
        for (const x of f) push({ ...x, msg: `${s.id} T${i + 1}：${x.msg}` });
        if (/未重建/.test(String(t.path ?? ""))) SF.model.push(`${s.id} T${i + 1}`);
        const modelTurn = /未重建/.test(String(t.path ?? ""));
        const tc = cols(t);
        // 2：「好」那一輪（確認 Pending）不得京都搜尋／扣點／顯示（r2 #16）
        if (t.text === "好" && YES_KINDS.includes(kind)) {
          const k = [...tc.places, ...tc.credits, ...tc.cards].includes("京都");
          if (k) ((tagged[2] ??= {})[tree] ??= []).push({ cat: modelTurn ? "MODEL" : "OLD-CITY", msg: `${s.id} T${i + 1}：「好」輪京都 Places=${(t.placesQueries ?? []).filter((q) => K(String(q).split("@").at(-1)) === "京都").length} Credits=[${tc.credits.join(",") || "-"}] 卡片=[${tc.cards.join(",") || "-"}]` });
          else if (modelTurn) ((tagged[2] ??= {})[tree] ??= []).push({ cat: "MODEL", msg: `${s.id} T${i + 1}：模型路徑（UNVERIFIED）` });
        }
      }
      // 11／Q3：情境總金澤 Provider 驗證 ≤ 點名／確認輪數；同一 Pending（至確認成功為止）≤ 2（r3：含 confirmNew 情境；所有非 weather 階段）
      const allowedKz = s.expect.filter((k) => KZ_CONFIRM_KINDS.includes(k)).length + (s.case === "REF" ? Infinity : 0); // REF＝既有流程基準，不套 MP-25 上限
      if (kzGeoTotal > allowedKz) push({ cat: "SAFETY", msg: `${s.id}：情境總金澤 Provider 驗證=${kzGeoTotal} > 點名／確認輪數 ${allowedKz}`, tags: [11, 19] });
      if (s.expect.includes("switchFail") && kzGeoUntilConfirm > LIMITS.validatePerPending) push({ cat: "SAFETY", msg: `${s.id}：同一 Pending 自動驗證=${kzGeoUntilConfirm} > ${LIMITS.validatePerPending}`, tags: [11, "S2"] });
      if (s.case === 12 && results[`mp1|ok|${s.id}`] && tree === "work") {
        const sum = (ts, fn) => ts.reduce((a, t) => a + fn(t), 0);
        const m = results[`mp1|ok|${s.id}`].result?.turns ?? [];
        if (sum(turns, (t) => t.geocodes?.length ?? 0) > sum(m, (t) => t.geocodes?.length ?? 0)) push({ cat: "SAFETY", msg: `${s.id}：同城續推 geocode 次數高於 mp1`, tags: [] });
        if (sum(turns, (t) => t.placesRequests ?? 0) > sum(m, (t) => t.placesRequests ?? 0)) push({ cat: "SAFETY", msg: `${s.id}：同城續推 Places 次數高於 mp1`, tags: [] });
      }
      out.push(`  ${tree.padEnd(5)} 彙總：確認提問=${asks} 金澤驗證（至確認）=${kzGeoUntilConfirm} 總=${kzGeoTotal} confirmationAttempts max=${attemptsMax}${SF.na.length ? ` N/A=${SF.na.join("；")}` : ""}`);
    }
  }
  // 項目列：情境所屬項目（全部失敗）＋標籤歸入
  const ORDER = ITEMS.map((x) => x.no);
  for (const it of ORDER)
    for (const tree of SHOW) {
      const R = row(it, tree);
      for (const s of NEW_SCENARIOS) {
        if (!s.items.includes(it)) continue;
        const SF = scenFails[s.id]?.[tree];
        if (!SF) continue;
        R.ran += 1;
        for (const x of SF.fails) (x.cat === "MODEL" ? R.model : R.fails).push(x);
        R.na.push(...SF.na);
      }
      for (const x of tagged[it]?.[tree] ?? []) {
        R.ran += 1;
        if (x.cat === "MODEL") R.model.push(x);
        else if (!R.fails.includes(x)) R.fails.push(x);
      }
      if (it === 2 || it === 17 || it === 18 || it === 19 || it === 20) R.ran += 1;
    }
  const outsideModel = (H.work?.refs ?? []).filter((r) => r.where === "model").length;
  out.push(`\n── MP-25 r3：必修 20 項＋對照 C1＋同時測試 S1～S4 × 樹（PASS／FAIL／UNVERIFIED；括號＝失敗分類計數）──`);
  const otherWork = [];
  const modelWork = [];
  let workFail = 0;
  const summary = {};
  for (const it of ITEMS) {
    const cells = SHOW.map((tree) => {
      let v;
      let tail = "";
      if (it.no === "S3" || it.no === "S4") {
        const ok = PROBE && (it.no === "S3" ? PROBE.allowOk === PROBE.allow && PROBE.allow > 0 : PROBE.denyOk === PROBE.deny && PROBE.deny > 0);
        v = PROBE ? (ok ? "PASS" : "FAIL") : "INFRA";
        tail = PROBE ? `(探針 ${it.no === "S3" ? `${PROBE.allowOk}/${PROBE.allow}` : `${PROBE.denyOk}/${PROBE.deny}`})` : "";
      } else {
        const r = rows[it.no]?.[tree];
        if (!r || !r.ran) return `${tree}=-`;
        const cats = {};
        for (const x of r.fails) cats[x.cat] = (cats[x.cat] ?? 0) + 1;
        v = r.fails.length ? "FAIL" : r.model.length ? "UNVERIFIED" : "PASS";
        if (v === "PASS" && it.no === 18 && !(evidence[tree]?.coordsKyoto && evidence[tree]?.coordsKanazawa)) v = "UNVERIFIED";
        if (v === "PASS" && tree === "work" && outsideModel) v = "UNVERIFIED";
        tail = `${r.fails.length ? `(${Object.entries(cats).map(([k, n]) => `${k}:${n}`).join(",")})` : ""}${r.model.length && !r.fails.length ? `(模型輪:${r.model.length})` : ""}${it.no === 18 ? `(座標證據 京都=${evidence[tree]?.coordsKyoto ? "Y" : "N"} 金澤=${evidence[tree]?.coordsKanazawa ? "Y" : "N"})` : ""}`;
        if (tree === "work") {
          for (const x of r.fails) if (!CAT_EXPECTED.has(x.cat)) otherWork.push(`項目 ${it.no}：[${x.cat}] ${x.msg}`);
          for (const x of r.model) modelWork.push(`項目 ${it.no}：${x.msg ?? x}`);
        }
      }
      (summary[it.no] ??= {})[tree] = v;
      if (tree === "work" && v !== "PASS") workFail += 1;
      return `${tree}=${v}${tail}`;
    });
    out.push(`  ${String(it.no).padStart(2)}. ${it.name.padEnd(28)} ${cells.join("  ")}`);
  }
  if (outsideModel) out.push(`  ※ work 有 ${outsideModel} 處 destination_switch 參照不在擷取範圍（模型路徑）→ work 的 PASS 一律改列 UNVERIFIED`);
  out.push("\n── work 上「PENDING／OLD-CITY／FEATURE（契約未施工）」以外的失敗（SAFETY／INFRA；停止條件候選）──", ...(otherWork.length ? uniq(otherWork).map((x) => `  ${x}`) : ["  (none)"]));
  out.push("── work 上經過 r13 模型「未重建」路徑的判定（MODEL＝UNVERIFIED；不計 PASS、不作為正式碼 P1）──", ...(modelWork.length ? uniq(modelWork).map((x) => `  ${x}`) : ["  (none)"]));
  const naWork = uniq(Object.values(scenFails).flatMap((x) => x.work?.na ?? []));
  out.push("── 故障注入 N/A（路徑未進入；由行為斷言判定）──", ...(naWork.length ? naWork.map((x) => `  ${x}`) : ["  (none)"]));
  out.push(`MP-25 r3（work）：非 PASS 項目=${workFail}/${ITEMS.length}；SAFETY／INFRA=${uniq(otherWork).length}；MODEL=${uniq(modelWork).length}`);
  out.push(`@@MP25R3_SUMMARY@@${JSON.stringify(summary)}`);
  return { fail: workFail, pass: ITEMS.length - workFail };
}
function lim(L) {
  return !L || !Number.isInteger(L.userText) || !Number.isInteger(L.label);
}

/** mp25-r2 → mp25-r3 的每一處斷言差異（舊 → 新 → 理由 → 裁決／修正編號；修正編號＝A2-MP-T6 指出的問題 1～7）。 */
export const CHANGES = [
  { no: 1, old: "geoQ＝只計 `^[a-z]+_validate:` 階段的金澤 geocode（L130）", neu: "geoV＝所有非 weather 階段（init／post／global_candidate／builder／nearby／*_validate…）；用於 L177（同輪 ≤1）、L184（非確認輪 0）、L236（confirmCapped 0）、L238（idle 0）、L245（noRevive）、L334、L362-363（情境總數／同一 Pending ≤2）、forgedOk／forgedPrevYes", why: "T6 問題 1：漏抓 send()／builder 等階段的重驗，上述斷言變鬆（加嚴）", fix: "修正 1" },
  { no: 2, old: "confirmNew L216：`!geoQ(*_validate).length` → FEATURE", neu: "`!geoV(t,\"金澤\").length` → FEATURE（任一非 weather 階段的 Provider 驗證即可；仍須 trusted 金澤、標籤／中心＝金澤）", why: "T6 問題 1：只認 *_validate 過嚴，會把在 send() 區段驗證的正確實作判 FAIL（修正錯誤，非放寬：其餘 confirmNew 條件不變且新增 REF／卡片座標條件）", fix: "修正 1" },
  { no: 3, old: "weather：只檢查同輪 WG ≤1、W ≤1、失敗輪 W／Builder=0", neu: "保留；另加：未確認金澤 WG(金澤)=0、weather 請求含金澤座標=0；確認輪 weather 不得早於金澤首次驗證", why: "裁決：Weather 獨立統計、未確認目的地不得被 Weather 利用（加嚴）", fix: "裁決（七）" },
  { no: 4, old: "L329：故障情境 `turnSpec.fault && !/r19:fault/.test(path)` → INFRA", neu: "pushMorePlaceRecommendations 有被呼叫才要求故障生效（未注入 → INFRA；已注入但未走 catch 模型 → INFRA）；未被呼叫 → N/A（列出），由該輪行為斷言判定", why: "T6 問題 2：handler 正確攔下時永遠 INFRA（修正錯誤）", fix: "修正 2" },
  { no: 5, old: "L332-333 Q4：輪末同一 Pending 且助理回覆含「金澤」→ asks+1；>3 → SAFETY", neu: "確認提問＝輪末同一 Pending＋本輪新助理訊息＋無卡片＋（含？／? 或與先前確認提問逐字相同）；>3 → SAFETY", why: "T6 問題 3：以提到城市名計數會把上限後的說明文字算成提問（誤判），也漏掉不含城市名的提問（漏判）（修正錯誤）", fix: "修正 3" },
  { no: 6, old: "LIMITS.confirmPlaces=2／confirmBuilder=1／confirmWeather=1；confirmNew L226 超限 → SAFETY（Q5）", neu: "移除；改為 confirmNew 的 Places／Builder／Weather 請求／Weather geocode／Credits.begin ≤ 同樹 REF（既有推薦流程：京都 → 換金澤，Provider 成功）T2；REF 未成立 → INFRA；r14-A2／creditsFails 照舊", why: "使用者裁決：確認成功後使用既有推薦流程的 Provider 與 Credits 契約，不另設 Places 2 次上限（依裁決移除，不算弱化）", fix: "裁決（二）" },
  { no: 7, old: "FAIL_KINDS L186：Weather／Builder>0 一律 SAFETY", neu: "全部 Places／Credits／卡片皆為原城市 → OLD-CITY；否則 SAFETY", why: "T6 問題 6：「好」走京都 alt 分支的成本是 OLD-CITY（修正分類）", fix: "修正 6" },
  { no: 8, old: "L183：Session Pending previousConfirmedDestination ≠ 京都 → SAFETY", neu: "≠ 情境可信城市（s.trusted；舊情境＝京都，語意不變；14h＝大阪）", why: "新增 14h（可信 Session＝大阪、偽造 prev＝京都）", fix: "裁決（三）previousConfirmedDestination 不能證明原城市可信" },
  { no: 9, old: "forgedPrev*：偽造城市固定「大阪」、可信城市固定「京都」（L264-275）", neu: "參數化（s.forgedPrev／s.trusted；舊情境值不變）；另加偽造城市座標不得寫入 Session", why: "同上；加嚴", fix: "裁決（三）" },
  { no: 10, old: "（無）", neu: "未確認期間（PENDING_KINDS）：Places>0、Credits.begin 或任何 credits_* RPC（含 credits_check）、Builder → OLD-CITY／SAFETY；Session 地理投影（travelContext／tpc／tripDestination／rec／ARC 的地理鍵、location、nearbyLocationAuthority、explicitSearchScope、searchScope、radius、preferredArea）輪初＝輪末；非 RPC Supabase 寫入=0；Session 不得含金澤座標", why: "T6 觀察 7（credits_check 未斷言、六欄只比標籤、location／座標／explicitSearchScope 未查）；裁決 Session 寫入安全（加嚴）", fix: "修正 7／裁決（三）" },
  { no: 11, old: "（無）", neu: "Pending 本身：originalUserText 必填且＝建立當輪原句、含 raw、不拼接父城市、無座標／範圍、≤ chatInput 既有上限；rawGeographicLabel ≤ GeocodeTextInput 既有上限、非座標；confirmationAttempts 必填整數 0–2、同一 Pending 不減少、≥ 已執行確認驗證；Pending 存在的輪 activeCategoryIntent 不變", why: "裁決 1／3／4（加嚴）", fix: "裁決（一）（四）" },
  { no: 12, old: "情境總金澤驗證 ≤2 只在「有 switchFail 且沒有 confirmNew」的情境檢查（L363）", neu: "所有含 switchFail 的情境：至確認成功為止的金澤驗證 ≤2", why: "裁決：同一 Pending 最多自動驗證 2 次（加嚴）", fix: "裁決（二）" },
  { no: 13, old: "（無）", neu: "新增情境 REF、06c（達上限後相同輸入重建 ×2）、06d（達上限後明確改大阪）、06e（達上限後選京都）、14h（可信大阪＋偽造 prev 京都）、14j（Client pending categoryIntent=cafe）、18（原句夾帶其他城市大阪）；新判定 ref、rebuildCapped", why: "任務單六（20 項＋同時測試）", fix: "任務單" },
  { no: 14, old: "情境 ID 前綴 MP25R2-（26 個）", neu: "MP25R3-（同內容；回合文字／Provider 模式／Reload 位置／expect 不變）", why: "與 r2 同時執行時避免 ID 衝突", fix: "-" },
  { no: 15, old: "16 項表（以 case 編號歸併；13～16 以訊息關鍵字彙總）", neu: "必修 20 項＋C1（r2 #12 對照）＋S1～S4；每個情境列出所屬項目、每條失敗以 tags 明確歸入項目（不再以訊息關鍵字比對）；r2 #13→20、#14→12/13、#15→19/11、#16→2", why: "任務單六要求逐項列出斷言位置", fix: "任務單" },
  { no: 16, old: "work PASS 判定：只看失敗清單；模型路徑 → UNVERIFIED", neu: "同左；另加：項目 18 需有座標證據（京都可信中心＝京都座標、金澤可信中心＝金澤座標）才可 PASS，否則 UNVERIFIED；REF 未成立 → INFRA", why: "避免無證據 PASS（加嚴）", fix: "修正 7" },
  { no: 17, old: "MISLEAD_RE 文案正則", neu: "MISLEAD_RE 或正式 isAlternativeRecommendationOffer（r20-O）任一命中 → FEATURE", why: "使用正式判定（含 noMore 多語系文案）（加嚴）", fix: "裁決（三）lastAssistantReply 文案" },
  { no: 18, old: "MODEL 轉換：未重建路徑的所有失敗 → MODEL", neu: "同左，但 INFRA 不轉為 MODEL", why: "前提不成立不能被模型路徑掩蓋（加嚴）", fix: "-" },
  { no: 19, old: "add(cat, msg)（刪除行命中 add( 的其餘各行）", neu: "add(cat, msg, tags)：條件式與分類逐字不變，只多第 3 個參數（項目歸入）；switchFail 的 isSwitchPending 多一個類別參數（舊情境預設 attraction，語意不變）；confirmFail／confirmCapped 的 pending 保留條件不變（只對新種類 rebuildCapped 不要求）", why: "任務單六：每項列出斷言位置", fix: "-" },
  { no: 20, old: "scenarios 各行（刪除行命中 expect: 的 27 行）", neu: "ID 前綴 MP25R3-、加 items 欄位；turns／r18GeoByTurn／reloadAfter／expect 逐字不變", why: "見 #14", fix: "-" },
  { no: 21, old: "emit-diff KEYS 不含 viol(、throw new Error", neu: "加入 viol(、throw new Error（r20 亦同）", why: "T6 問題 6", fix: "修正 6" },
];

// ── 直接執行：以 r20 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  if (process.argv.includes("--emit-diff")) {
    let d = "";
    try {
      d = execFileSync("diff", ["-u", "--label", "scripts/verify-more-places-destination-switch-mp25-r2.mjs", "--label", "scripts/verify-more-places-destination-switch-mp25-r3.mjs", OLD, SELF], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      d = String(e.stdout ?? "");
    }
    const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail(", "add(", "viol(", "throw new Error"];
    const del = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const by = {};
    for (const l of hit) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
    const head = [
      "# mp25-r3.diff（相對 scripts/verify-more-places-destination-switch-mp25-r2.mjs；A2-MP-T7）",
      `# 刪除行=${del.length}；刪除行含 ${KEYS.join("／")}＝${hit.length} ${JSON.stringify(by)}（逐行列於下方；每一處對應 CHANGES 的舊→新→理由→裁決／修正編號）`,
      ...hit.map((l) => `#   [刪除行命中] ${l.slice(0, 220)}`),
      "# CHANGES：",
      ...CHANGES.map((c) => `#   ${c.no}. 舊：${c.old}｜新：${c.neu}｜理由：${c.why}｜裁決／修正：${c.fix}`),
      "",
    ];
    writeFileSync(`${PRE_DIR}/mp25-r3.diff`, `${head.join("\n")}\n${d}`);
    console.log(`wrote ${PRE_DIR}/mp25-r3.diff`);
    console.log(head.join("\n"));
    process.exit(0);
  }
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const sub = process.argv.includes("--with-r20-subset");
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? `${PRE_DIR}/${sub ? "r20-subset-mp25r3" : "mp25-r3"}.log`;
  if (/\/(mp25|mp25-r2|mp25-r2-T6|mp25-T4|r19-subset|r19-subset-T6)\.log$/.test(out)) {
    console.log(`拒絕覆蓋既有 log：${out}`);
    process.exit(1);
  }
  const ids = [...scenarios.map((s) => s.id), ...(sub ? ["R10-a2-kyoto-kanazawa-more", "R15-PROBE"] : [])];
  const args = [R20, "--brief", ...(sub ? ["--pa2"] : []), "--a2", "--mp1", `--only=${ids.join(",")}`, `--extra-scenarios=${SELF}`, `--out=${out}`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
