#!/usr/bin/env node
/**
 * verify-more-places-destination-switch-mp25（A2-MP-T3，tester）：MP-25「換目的地驗證失敗」的失敗測試（施工前預期 work FAIL）。
 *
 * 契約（使用者原文）：京都 → 換金澤 → Provider 失敗時必須：保存尚未完成的切換意圖、不搜尋 Places、不開始 Credits、不覆蓋原本可信目的地、
 *   不自動回到京都續推。下一輪「再推薦幾個」「便宜一點的」不得觸發京都搜尋。
 * 資料契約（使用者裁決 6：擴充既有 pendingClarification，不建立第二套 Pending）：Session.pendingClarification＝
 *   { kind: "destination_switch", rawGeographicLabel: 待確認目的地（不可當搜尋輸入）, previousConfirmedDestination: 原確認目的地,
 *     categoryIntent, originatingRoute: "more_places" }。本檔只以「行為」斷言（Session 中存在上述 pending、Provider／Credits 次數、
 *   六欄目的地），不檢查實作細節。
 *
 * 機制：不自建 Harness；以 r18（--extra-scenarios=本檔）執行：正式 Callback／send() 區塊擷取、Mock Provider（逐輪模式 r18GeoByTurn）、
 *   Credits RPC Mock、外部網路攔截。send() 的 destination_switch handler：只在該樹 send() 有「單一」if 條件含
 *   pendingGeographic?.kind === "destination_switch" 時以正式碼執行（r18-H）；目前所有樹皆無 → 走 r13 模型（現行行為）。
 *   Reload＝r13 Harness 以 persisted JSON 開新程序（真實 saveChatSession／loadChatSession 未執行 → 另列 UNVERIFIED）。
 *
 * 執行：node scripts/verify-more-places-destination-switch-mp25.mjs [--conc=N]
 *       （＝ node scripts/verify-destination-authority-phase2-r18.mjs --brief --a2 --mp1 --only=<ids>
 *          --extra-scenarios=scripts/verify-more-places-destination-switch-mp25.mjs --out=<scratchpad>/mp25.log）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R18 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r18.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const T1 = "京都推薦景點";
const T2 = "換金澤，再推薦幾個";
const FORGED = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: T2 };

/**
 * expect[turnIndex]＝該輪的行為類型：
 *   origin      京都已確認（T1）
 *   switchFail  換金澤、Provider 失敗：Places=0、Credits=0、無卡、不覆蓋京都、保存 destination_switch pending
 *   hold        Pending 期間的一般續推／Refinement：不得以京都搜尋／扣點／顯示；未確認金澤不得搜尋／扣點；pending 保留；不自動重新驗證（geocode=0）
 *   chooseOld   明確選京都：pending 清除、不得出現金澤；有卡片時全為京都
 *   oldMore     選京都後的續推：京都卡片、無 pending
 *   confirmNew  明確確認金澤：本輪 Provider 驗證（金澤 geocode ≤1、去重）成功才切換；卡片／Credits／rec／travelContext＝金澤；pending 清除
 *   newMore     切換金澤後的續推：金澤卡片、不得出現京都
 *   confirmFail 確認金澤但 Provider 再次失敗：安全停止、pending 保留、本輪金澤 geocode ≤1、Places=0、Credits=0
 *   idle        非確認輪（不得自動驗證金澤：geocode=0）、不得京都／金澤搜尋
 *   cancel      取消：pending 清除、不得出現金澤
 *   noRevive    取消／取代後的「好」：不得復活金澤（金澤 geocode／Places／Credits／卡片＝0）、pending 不得為金澤
 *   replace     換大阪（Provider 成功）：大阪卡片、不得出現金澤／京都、pending 不得仍為金澤
 *   same        同城續推（京都）：京都卡片、無 pending
 *   forgedHold  Client 保存的 pending（未經驗證）＋「好」＋Provider 失敗：不得搜尋／扣點／寫入金澤
 *   forgedOk    Client 保存的 pending ＋「好」＋Provider 成功：金澤卡片前必須在本輪完成 Provider 驗證（pending 不是證據）
 */
const NEW_SCENARIOS = [
  { case: 1, id: "MP25-01-switch-fail-timeout", label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider timeout）", turns: [T1, T2], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail"] },
  { case: 2, id: "MP25-02-fail-then-more", label: "… → 換金澤（timeout）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 3, id: "MP25-03-fail-then-cheaper", label: "… → 換金澤（timeout）→ 便宜一點的", turns: [T1, T2, "便宜一點的"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 4, id: "MP25-04-choose-kyoto", label: "… → 換金澤（timeout）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "chooseOld", "oldMore"] },
  { case: 5, id: "MP25-05-confirm-kanazawa-yes", label: "… → 換金澤（timeout）→ 好（Provider 成功）→ 再推薦幾個", turns: [T1, T2, "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew", "newMore"] },
  { case: 5, id: "MP25-05b-confirm-kanazawa-echo", label: "… → 換金澤（timeout）→ 金澤（Provider 成功）", turns: [T1, T2, "金澤"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"] },
  { case: 6, id: "MP25-06-confirm-timeout-again", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（timeout）→ 再推薦幾個", turns: [T1, T2, "好", "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmFail", "idle"] },
  { case: 7, id: "MP25-07-switch-fail-null", label: "… → 換金澤（Provider null）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "null" }, expect: ["origin", "switchFail", "hold"] },
  { case: 8, id: "MP25-08-switch-fail-zero", label: "… → 換金澤（ZERO_RESULTS）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "zero" }, expect: ["origin", "switchFail", "hold"] },
  { case: 9, id: "MP25-09-reload-confirm", label: "… → 換金澤（timeout）→（重新載入）→ 好（Provider 成功）", turns: [T1, T2, "好"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "confirmNew"], restoredAt: 2 },
  { case: 9, id: "MP25-09b-reload-more", label: "… → 換金澤（timeout）→（重新載入）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"], restoredAt: 2 },
  { case: 10, id: "MP25-10-cancel-reload", label: "… → 換金澤（timeout）→ 不用了 →（重新載入）→ 好", turns: [T1, T2, "不用了", "好"], reloadAfter: 2, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "cancel", "noRevive"] },
  { case: 11, id: "MP25-11-replace-osaka", label: "… → 換金澤（timeout）→ 換大阪，再推薦幾個（Provider 成功）→ 好", turns: [T1, T2, "換大阪，再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "replace", "noRevive"] },
  { case: 12, id: "MP25-12-same-kyoto", label: "（對照）京都推薦景點 → 再推薦幾個 → 再推薦幾個", turns: [T1, "再推薦幾個", "再推薦幾個"], expect: ["origin", "same", "same"] },
  { case: 14, id: "MP25-14-forged-pending-timeout", label: "（Session 恢復：rec=京都＋Client 保存的 destination_switch pending=金澤）→ 好（Provider timeout）", turns: ["好"], r15Init: { topic: "attraction", rec: { destination: "京都", n: 6, batch: 3 }, travelDestination: "京都" }, r18Pending: FORGED, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  { case: 14, id: "MP25-14b-forged-pending-ok", label: "（Session 恢復：rec=京都＋Client 保存的 destination_switch pending=金澤）→ 好（Provider 成功）", turns: ["好"], r15Init: { topic: "attraction", rec: { destination: "京都", n: 6, batch: 3 }, travelDestination: "京都" }, r18Pending: FORGED, expect: ["forgedOk"] },
].map((s) => ({ ...s, r15Modes: [OK], r18GeoByTurn: s.r18GeoByTurn ? Object.fromEntries(Object.entries(s.r18GeoByTurn).map(([k, v]) => [String(k), v])) : undefined }));

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
const geoQ = (t, d) => (t.geocodes ?? []).filter((g) => K(String(g).split(":").slice(1).join(":")) === d || (d === "金澤" && /Kanazawa|石川/i.test(String(g))));
const pendingOf = (t) => t.r18Pending ?? null;
const isSwitchPending = (p) => Boolean(p) && p.kind === "destination_switch" && K(p.rawGeographicLabel) === "金澤" && K(p.previousConfirmedDestination) === "京都" && p.categoryIntent === "attraction" && p.originatingRoute === "more_places";
const pendingStr = (p) => (p ? JSON.stringify({ kind: p.kind, raw: p.rawGeographicLabel ?? null, prev: p.previousConfirmedDestination ?? null, cat: p.categoryIntent ?? null, route: p.originatingRoute ?? null }) : "null");
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

/**
 * 逐輪判定。回傳 [{cat, msg}]；cat：PENDING（切換意圖未保存／未清除）、OLD-CITY（Provider 失敗後回到京都搜尋／扣點／顯示）、
 * FEATURE（確認／選擇／取消行為未達成）、SAFETY（未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限）。
 */
function judgeTurn(kind, t, ctx) {
  const out = [];
  const add = (cat, msg) => out.push({ cat, msg });
  const c = cols(t);
  const shown = [...c.credits, ...c.cards, ...c.places];
  const kz = trustedIn(t, "金澤");
  const kzConfirmed = kz || ctx.kzConfirmedBefore;
  // ── 全輪不變條件（13／14／15）──
  if (!kzConfirmed && shown.includes("金澤")) add("SAFETY", `未確認金澤仍搜尋／扣點／顯示（${fmt(c)}）`);
  if (!kzConfirmed) for (const [k, v] of [["travelContext", c.tc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip], ["recommendationSession", c.rec], ["activeRecommendationContext", c.arc]]) if (v === "金澤") add("SAFETY", `${k} 寫入未確認目的地「金澤」`);
  if (!kzConfirmed && c.credits.includes("金澤")) add("SAFETY", "Credits metadata.destination＝未確認「金澤」");
  for (const x of creditsFails(t)) add("SAFETY", x);
  const g = t.geocodes ?? [];
  if (new Set(g).size !== g.length) add("SAFETY", `同一輪重複 geocode（${g.join(",")}）`);
  if (geoQ(t, "金澤").length > 1) add("SAFETY", `同一輪金澤 geocode ${geoQ(t, "金澤").length} 次（>1）`);
  // ── 類型 ──
  const kyotoShown = shown.includes("京都");
  const pend = pendingOf(t);
  if (kind === "origin") {
    if (!c.cards.length || c.cards.some((d) => d !== "京都")) add("FEATURE", `前置：T1 沒有京都卡片（${fmt(c)}）`);
  } else if (kind === "switchFail") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `Provider 失敗仍開始 Credits（${c.credits.join(",")}）`);
    if ((t.r15Cards ?? []).length) add(kyotoShown ? "OLD-CITY" : "SAFETY", `Provider 失敗仍顯示卡片（${c.cards.join(",")}）`);
    if (c.rec !== "京都") add("SAFETY", `原本可信目的地被覆蓋：recommendationSession=${c.rec ?? "-"}（應保留京都）`);
    if (c.tc !== "京都") add("SAFETY", `原本可信目的地被覆蓋：travelContext=${c.tc ?? "-"}（應保留京都）`);
    if (!isSwitchPending(pend)) add("PENDING", `未保存切換意圖：pendingClarification=${pendingStr(pend)}（應為 destination_switch／金澤／原確認京都／attraction／more_places）`);
  } else if (kind === "hold") {
    if (kyotoShown) add("OLD-CITY", `Pending 期間自動回到京都（${fmt(c)}）`);
    if (!kz && geoQ(t, "金澤").length) add("SAFETY", `非確認輪自動重新驗證金澤（${geoQ(t, "金澤").join(",")}）`);
    if (!isSwitchPending(pend)) add("PENDING", `切換意圖未保留：pendingClarification=${pendingStr(pend)}`);
    if (c.rec !== "京都" && !kz) add("SAFETY", `recommendationSession=${c.rec ?? "-"}（未確認前應保留京都）`);
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
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `確認金澤後沒有金澤卡片（${fmt(c)}）`);
    if (c.credits.length !== 1 || c.credits[0] !== "金澤") add("FEATURE", `確認金澤：Credits metadata=[${c.credits.join(",") || "-"}]（應恰好 1 次金澤）`);
    if (c.rec !== "金澤" || c.tc !== "金澤") add("FEATURE", `確認金澤：rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}（應為金澤）`);
    if (kyotoShown) add("OLD-CITY", `確認金澤後仍出現京都（${fmt(c)}）`);
    if (pend) add("PENDING", `確認後 pending 未清除（${pendingStr(pend)}）`);
  } else if (kind === "newMore") {
    if (!c.cards.length || c.cards.some((d) => d !== "金澤")) add("FEATURE", `切換金澤後續推沒有金澤卡片（${fmt(c)}）`);
    if (kyotoShown || [c.rec, c.tc, c.arc].includes("京都")) add("OLD-CITY", `切換金澤後續推出現京都（${fmt(c)}）`);
  } else if (kind === "confirmFail") {
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `確認輪 Provider 失敗仍開始 Credits（${c.credits.join(",")}）`);
    if (kyotoShown) add("OLD-CITY", `確認輪 Provider 失敗後回到京都（${fmt(c)}）`);
    if (!isSwitchPending(pend)) add("PENDING", `確認輪 Provider 失敗後 pending 未保留（${pendingStr(pend)}）`);
    if (c.rec !== "京都" || c.tc !== "京都") add("SAFETY", `確認輪 Provider 失敗後京都被覆蓋（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}）`);
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
  } else if (kind === "forgedHold") {
    if (shown.includes("金澤") || t.placesRequests > 0 && c.places.includes("金澤")) add("SAFETY", `Client pending 被當成驗證證據：Provider 失敗仍搜尋／扣點／顯示金澤（${fmt(c)}）`);
    if ([c.rec, c.tc, c.arc, c.tpc].includes("金澤")) add("SAFETY", `Client pending 被當成驗證證據：Session 寫入金澤（${fmt(c)}）`);
    if (kyotoShown && !(t.r15Cards ?? []).length) add("OLD-CITY", `Provider 失敗後以京都搜尋／扣點（${fmt(c)}）`);
  } else if (kind === "forgedOk") {
    if (shown.includes("金澤") && !(kz && geoQ(t, "金澤").length)) add("SAFETY", `Client pending 被當成驗證證據：未在本輪完成 Provider 驗證就使用金澤（${fmt(c)}）`);
  }
  // 本輪經過 r13 模型「未重建」路徑（下游未執行正式碼）：失敗只能記為 MODEL（UNVERIFIED），不作為 PASS 也不作為正式碼 P1
  if (/未重建/.test(String(t.path ?? ""))) return out.map((x) => ({ cat: "MODEL", msg: `${x.msg}（r13 模型未重建路徑：${String(t.path).slice(0, 60)}）` }));
  return out;
}

// ════════════════ report ════════════════
const CAT_EXPECTED = new Set(["PENDING", "OLD-CITY", "FEATURE"]);
export function report({ results, TREES, out }) {
  const SHOW = ["work", "mp1", "a2"].filter((t) => TREES.includes(t));
  out.push("\n══════════════ MP-25 destination_switch 失敗測試（A2-MP-T3；r18 掛載；樹 work／mp1／a2）══════════════");
  out.push("  分類：PENDING＝切換意圖未保存／未清除／復活；OLD-CITY＝Provider 失敗後回到京都；FEATURE＝確認／選擇／取消行為未達成；SAFETY＝未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限");
  out.push("  r18-H：send() destination_switch handler（正式碼擷取）在各樹皆不存在時，Pending 之後的輪次走 r13 send() 模型（＝現行行為）。");
  const table = {}; // case → tree → {fails, cats}
  const caseRow = (no, tree) => ((table[no] ??= {})[tree] ??= { fails: [], ran: 0, model: [] });
  const agg = { 13: {}, 14: {}, 15: {} };
  for (const s of NEW_SCENARIOS) {
    out.push(`\n[MP25][${s.id}] 案例 ${s.case}：${s.label}`);
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
      for (const [i, kind] of s.expect.entries()) {
        const t = turnOf(turns, i);
        if (!t) {
          row.fails.push({ cat: "INFRA", msg: `${s.id} T${i + 1} 缺失` });
          out.push(`  ${tree.padEnd(5)} T${i + 1} 缺失`);
          continue;
        }
        const ctx = { kzConfirmedBefore, restoredPending: s.reloadAfter != null && i === s.reloadAfter + 1 ? t.r18PendingAtStart : null };
        const f = judgeTurn(kind, t, ctx);
        // 9：Reload 後 pending 正確恢復（輪初 pending）
        if (s.restoredAt === i && !isSwitchPending(t.r18PendingAtStart)) f.push({ cat: "PENDING", msg: `重新載入後 pending 未恢復（輪初 ${pendingStr(t.r18PendingAtStart)}）` });
        kzGeoTotal += geoQ(t, "金澤").length;
        kzConfirmedBefore = kzConfirmedBefore || trustedIn(t, "金澤");
        out.push(`  ${tree.padEnd(5)} T${i + 1}「${t.text}」（${kind}） ${fmt(cols(t))} pending=${pendingStr(pendingOf(t))}`);
        out.push(`        path=${String(t.path ?? "").slice(0, 200)} geocode=${(t.geocodes ?? []).length}[${(t.geocodes ?? []).join(",")}] placesReq=${t.placesRequests ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? x.reason ?? "-"}`).join(",") || "-"}`);
        if (f.length) out.push(`        ✗ ${f.map((x) => `[${x.cat}] ${x.msg}`).join("；")}`);
        row.fails.push(...f.map((x) => ({ ...x, msg: `${s.id} T${i + 1}：${x.msg}` })));
        if (/未重建/.test(String(t.path ?? ""))) row.model.push(`${s.id} T${i + 1}`);
        // 13／14／15 彙總（只收正式碼路徑上的 SAFETY 與失敗輪的 Credits／Places 次數；OLD-CITY 已列於 1～11）
        const A = (no, cat, msg) => (agg[no][tree] ??= []).push({ cat, msg: `${s.id} T${i + 1}：${msg}` });
        for (const x of f) {
          if (x.cat !== "SAFETY") continue;
          if (/Credits/.test(x.msg)) A(13, "SAFETY", x.msg);
          if (/寫入|Client pending|覆蓋/.test(x.msg)) A(14, "SAFETY", x.msg);
          if (/geocode|Places|重新驗證/.test(x.msg)) A(15, "SAFETY", x.msg);
        }
        const modelTurn = /未重建/.test(String(t.path ?? ""));
        const tc = cols(t);
        if (!modelTurn && (kind === "switchFail" || kind === "confirmFail") && (t.r15Credits ?? []).length) A(13, tc.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `失敗輪開始 Credits（${tc.credits.join(",")}）`);
        if (!modelTurn && (kind === "switchFail" || kind === "confirmFail") && t.placesRequests > 0) A(15, tc.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `失敗輪 Places=${t.placesRequests}（${tc.places.join(",")}）`);
      }
      // 15：情境總金澤 geocode ≤ 本情境中「點名／確認金澤」的輪數（無無限重試）
      const allowedKz = s.expect.filter((k) => ["switchFail", "confirmNew", "confirmFail", "forgedOk", "forgedHold"].includes(k)).length;
      if (kzGeoTotal > allowedKz) (agg[15][tree] ??= []).push({ cat: "SAFETY", msg: `${s.id}：情境總金澤 geocode=${kzGeoTotal} > 點名／確認輪數 ${allowedKz}` });
      if (s.case === 12 && results[`mp1|ok|${s.id}`] && tree === "work") {
        const sum = (ts, f) => ts.reduce((a, t) => a + f(t), 0);
        const m = results[`mp1|ok|${s.id}`].result?.turns ?? [];
        if (sum(turns, (t) => t.geocodes?.length ?? 0) > sum(m, (t) => t.geocodes?.length ?? 0)) row.fails.push({ cat: "SAFETY", msg: "同城續推 geocode 次數高於 mp1" });
        if (sum(turns, (t) => t.placesRequests ?? 0) > sum(m, (t) => t.placesRequests ?? 0)) row.fails.push({ cat: "SAFETY", msg: "同城續推 Places 次數高於 mp1" });
      }
    }
  }
  // 13／14／15 彙總列
  for (const no of [13, 14, 15]) for (const tree of SHOW) {
    const row = caseRow(no, tree);
    row.ran += 1;
    for (const x of agg[no][tree] ?? []) row.fails.push(x);
  }
  const NAMES = {
    1: "京都→金澤驗證失敗（timeout）",
    2: "下一輪「再推薦幾個」",
    3: "下一輪「便宜一點的」",
    4: "明確選擇京都",
    5: "明確確認金澤（Provider 成功才切換）",
    6: "Provider 再次 timeout",
    7: "Provider null",
    8: "ZERO_RESULTS",
    9: "Reload Restore",
    10: "Pending 取消（含 Reload）",
    11: "新目的地取代舊 Pending",
    12: "同目的地正常續推（京都）",
    13: "Credits Metadata（彙總）",
    14: "Session 污染／Client pending 非證據（彙總＋MP25-14）",
    15: "Provider 成本與去重（彙總）",
  };
  out.push("\n── MP-25：15 項 × 樹（PASS／FAIL；括號＝失敗分類計數）──");
  const otherWork = [];
  const modelWork = [];
  let workFail = 0;
  for (let no = 1; no <= 15; no += 1) {
    const cells = SHOW.map((tree) => {
      const r = table[no]?.[tree];
      if (!r || !r.ran) return `${tree}=-`;
      const cats = {};
      for (const x of r.fails) cats[x.cat] = (cats[x.cat] ?? 0) + 1;
      const real = r.fails.filter((x) => x.cat !== "MODEL");
      const v = real.length ? "FAIL" : r.fails.length || r.model.length ? "UNVERIFIED" : "PASS";
      if (tree === "work") {
        if (v !== "PASS") workFail += 1;
        for (const x of r.fails) if (!CAT_EXPECTED.has(x.cat) && x.cat !== "MODEL") otherWork.push(`案例 ${no}：[${x.cat}] ${x.msg}`);
        for (const x of r.fails) if (x.cat === "MODEL") modelWork.push(`案例 ${no}：${x.msg}`);
      }
      return `${tree}=${v}${r.fails.length ? `(${Object.entries(cats).map(([k, n]) => `${k}:${n}`).join(",")})` : ""}${r.model.length && !r.fails.length ? `(模型輪:${r.model.length})` : ""}`;
    });
    out.push(`  ${String(no).padStart(2)}. ${NAMES[no].padEnd(28)} ${cells.join("  ")}`);
  }
  out.push("\n── work 上「PENDING／OLD-CITY／FEATURE（契約未施工）」以外的失敗（SAFETY／INFRA；停止條件候選）──", ...(otherWork.length ? otherWork.map((x) => `  ${x}`) : ["  (none)"]));
  out.push("── work 上經過 r13 模型「未重建」路徑的判定（MODEL＝UNVERIFIED；不計 PASS、不作為正式碼 P1）──", ...(modelWork.length ? modelWork.map((x) => `  ${x}`) : ["  (none)"]));
  out.push(`MP-25（work）：非 PASS 項目=${workFail}/15；SAFETY／INFRA=${otherWork.length}；MODEL=${modelWork.length}`);
  return { fail: workFail, pass: 15 - workFail };
}

// ── 直接執行：以 r18 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [R18, "--brief", "--a2", "--mp1", `--only=${scenarios.map((s) => s.id).join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/mp25.log`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
