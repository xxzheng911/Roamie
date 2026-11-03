#!/usr/bin/env node
/**
 * R19 — Destination Authority 全量回歸（A2-MP-T5，tester）。使用者裁決（A2-MP-T4 後）：
 *   pendingClarification 擴充 destination_switch；欄位名 previousConfirmedDestination 定案；確認時以原始使用者請求交回既有
 *   Destination Authority 重新驗證；r14-Δ7「可信判定未通過不得寫入 Session」原則不變，只新增一項明確例外（保存 destination_switch Pending）。
 *
 * 建立方式（同 r14～r18 模式）：r12–r18 保留不改。r19 在執行期讀入 r18 原文（sha256 必須 = scratchpad/pre-MP5T-test-sha.txt 所記），
 * 套用 R19_R18_PATCHES（r18 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），再以 AsyncFunction 執行。
 * patched r18 照常讀入 r17 → r16 → r15 → r14 → r13（各層 sha 檢查不變）。R19_R13／R14／R15／R17_PATCHES 附加到 r18 的
 * R18_R13／R14／R15／R17_PATCHES 之後。主程序與 collect 子程序都是同一份內容（子程序路徑改為 r19）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r19.diff；契約差異見 scratchpad/r19-contract-diff.md）：
 *  r19-V  版本識別：子程序路徑 r19、摘要行、F7 後變動檔白名單 r1[0-8] → r1[0-9]＋mp25-r2（精確路徑）；AsyncFunction 執行需要的 import 轉換。
 *         post-MP25 快照預留：scratchpad/post-MP25-sha.txt「存在且與工作區 18 檔逐一吻合、與 post-MP-r2 的差異只在
 *         _app.chat.tsx（必須）＋chat-runtime.ts／destination-geographic-clarification.ts（可選）」時，work 的 6 處 sha 對照
 *         （r16 precheck、r13 四處、r14 wantApp.work）改讀 post-MP25，r16 precheck 的 post-A2 差異檔清單同步放寬為上述集合；
 *         存在但不吻合 → INFRA-FAIL（不默默退回 post-MP-r2）；不存在 → 照舊 post-MP-r2（本輪狀態；不建立快照）。
 *  r19-H  （審查 2）send() destination_switch handler 改為「依位置」擷取：send() 內 const pendingGeographic = nextSession.pendingClarification
 *         所在的語句串中，const nearbyShortcutTurn（及其後 F5 的 nearby pending 清除 if，若有）之後、
 *         if (pendingGeographic?.kind === "parent_city_scope" …) 之前的「所有語句」（不限 if／switch／helper 名稱）。
 *         0 句＝該樹沒有 handler（模型照舊，如實回報）；閉包審查：已審查閉包＋明列區域變數（R18_LOCALS.r18DestSwitch，r19 擴充），
 *         未知依賴 → INFRA-FAIL；區段對 nextSession 以外的區域變數重新指派 → INFRA-FAIL（模型只寫回 nextSession）。
 *         另列全檔 "destination_switch" 字面所在位置（擷取單位內＝正式碼；其他＝模型路徑 → mp25-r2 不得判 PASS）。
 *  r19-C  （同 r17-C）Callback／區塊引用的 _app.chat.tsx 頂層 function 宣告（不在已審查閉包清單）→ AST 擷取該樹正式實作注入；
 *         依賴只能是該樹 @/ import、允許的全域或同檔其他已擷取的頂層 function；其餘 → INFRA-FAIL。現行各樹 0 個（行為不變）。
 *  r19-E  （使用者裁決的唯一斷言例外）r14-Δ7「可信判定未通過仍寫入 Session」：只有同時符合 r19PendingException 全部條件時不列 P1；
 *         任一條件不成立 → 原 P1 照判（訊息逐字不變）。條件見 r19PendingException；單元探針 R19_EXC_PROBE（每次執行先跑；不符 → INFRA-FAIL）。
 *  r19-F  （審查 7）fallback continue 故障模式：外掛情境的 turn.fault === "r19ThrowMoreOnce" 時，該輪第一次呼叫正式
 *         pushMorePlaceRecommendations 即拋錯 → send() 正式 catch（work L11140-11169）模型 → applyLocalFallback(…,
 *         "state_machine_error", turnStartSession) → r18-P 擷取的正式 fallback continue（work L6795-6857）。r13 情境沒有此欄位 → 不執行。
 *  r19-K  （審查 5）外掛情境 SCENARIO.r19Coords（例：{ 金澤: {lat,lng} }）只改 geocode Mock 回應的座標（名稱以 金澤／金沢／京都／大阪 等比對）；
 *         r13 情境沒有此欄位 → realisticLocation 原樣。
 *  r19-O  只記錄：obs.r19Exc（例外評估結果）、obs.r19Faults（故障注入）；子程序 globalThis.__R19_TURN_START（輪初 Session；不輸出）。
 *  不變：r13 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類、r14～r18 的全部斷言與對照
 *        （r18-N 的 11 條件、r17-V G2S1 放寬原樣沿用）。外部請求攔截同 r13。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r19.mjs --brief --pa2 --a2 --mp1 [--only=ID,…] [--extra-scenarios=…] [--out=<scratchpad>/x.log]
 *       node scripts/verify-destination-authority-phase2-r19.mjs --emit-diff       （寫 scratchpad/r19.diff、r19.* 執行內容、r19-contract-diff.md）
 *       node scripts/verify-destination-authority-phase2-r19.mjs --probe           （只跑 r19-E 單元探針、r19-H 擷取、post-MP25 預留 patch 乾跑）
 *       node scripts/verify-destination-authority-phase2-r19.mjs --check-test-sha  （scripts/verify-*.mjs 對照 pre-MP5T-test-sha.txt）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R18_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r18.mjs`;
const R16_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r16.mjs`;
const R17_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r17.mjs`;
const TEST_SHA_FILE = `${PRE_DIR}/pre-MP5T-test-sha.txt`; // A2-MP-T5 開始前的 scripts sha256 快照（570 支）
const MP25_R2 = "scripts/verify-more-places-destination-switch-mp25-r2.mjs";
const SELF_REL = "scripts/verify-destination-authority-phase2-r19.mjs";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");
const IS_CHILD = process.env.VERIFY_P2R3_ROLE === "collect";

// ════════════════════════ r19-E：destination_switch Pending 安全例外（純函式；主程序探針與子程序共用）════════════════════════
/**
 * 允許的 Pending 欄位（逐一；其餘任何欄位 → 例外不成立）：
 *   kind                          "destination_switch"（裁決 2；型別判別）
 *   rawGeographicLabel            待確認目的地原文（裁決；只供文案／比對，不是搜尋輸入）
 *   previousConfirmedDestination  原可信目的地（裁決 3；必須等於輪初 Session 既有目的地欄位之一，且 ≠ rawGeographicLabel）
 *   categoryIntent                類別（裁決；必須是 ChatPlaceCategoryIntent 七值之一）
 *   originatingRoute              "more_places"（裁決）
 *   parentIntent                  可選；既有 PendingGeographicClarification 必填的中性欄位，只能是 "place_recommendation"
 *   originalUserText              可選；裁決 4「以原始使用者請求交回既有 Destination Authority 重新驗證」所需的原句（字串 ≤ 500）
 *   confirmationAttempts          可選；整數 0–2。mp25-r2「同一 Pending 自動驗證 ≤ 2 次」上限在保留 Pending（舊 mp25 斷言）的前提下需要的計數。
 *                                 欄位名待指派者／使用者裁決（見交接報告）。
 * 不允許：confirmedParentCity（既有型別中「唯一可搜尋標籤」）、任何座標／半徑／範圍／中心／Place ID／Pool／Context、建立時間（既有型別沒有；上限不需要）。
 */
const R19_PENDING_ALLOWED = ["kind", "rawGeographicLabel", "previousConfirmedDestination", "categoryIntent", "originatingRoute", "parentIntent", "originalUserText", "confirmationAttempts"];
const R19_PENDING_REQUIRED = ["kind", "rawGeographicLabel", "previousConfirmedDestination", "categoryIntent", "originatingRoute"];
const R19_CATEGORY = ["cafe", "restaurant", "shopping", "attraction", "night_market", "bar", "indoor"];
/** 非地理、非範圍的對話欄位（同既有 Clarification 寫入 L5841-5866 的形狀）：lastAssistantReply 可改為任意字串；pendingQuestion 只能移除；activeCategoryIntent 只能不變或＝Pending.categoryIntent。 */
const R19_SESSION_CONVERSATIONAL = ["lastAssistantReply", "pendingQuestion", "activeCategoryIntent"];
function r19Canon(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => r19Canon(x) ?? "null").join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${r19Canon(v[k])}`).join(",")}}`;
}
function r19PendingException({ persists, atStart, places = 0, weather = 0, builders = 0, begins = 0, rpcs = [] }) {
  const why = [];
  if (!atStart || typeof atStart !== "object") why.push("缺輪初 Session（無法比對）");
  if (begins) why.push(`Credits.begin=${begins}`);
  if (builders) why.push(`Builder=${builders}`);
  if (places) why.push(`Places=${places}`);
  if (weather) why.push(`Weather=${weather}`);
  const cr = (rpcs ?? []).filter((x) => /^credits_/.test(String(x)));
  if (cr.length) why.push(`Credits RPC=${cr.join(",")}`);
  if (!persists?.length) why.push("沒有寫入（例外只適用於寫入 destination_switch Pending）");
  const trustedAtStart = atStart
    ? [atStart.recommendationSession?.destination, atStart.travelContext?.destination, atStart.activeRecommendationContext?.destinationName, atStart.tripPlanningContext?.destination]
        .filter((x) => typeof x === "string" && x.trim())
        .map((x) => x.trim())
    : [];
  (persists ?? []).forEach((s, i) => {
    const tag = `寫入#${i + 1}`;
    const p = s?.pendingClarification;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      why.push(`${tag} 沒有 pendingClarification`);
      return;
    }
    if (p.kind !== "destination_switch") why.push(`${tag} kind=${JSON.stringify(p.kind)}`);
    const extra = Object.keys(p).filter((k) => p[k] !== undefined && !R19_PENDING_ALLOWED.includes(k));
    if (extra.length) why.push(`${tag} 不允許的欄位 ${extra.join(",")}`);
    for (const k of R19_PENDING_REQUIRED) if (typeof p[k] !== "string" || !p[k].trim()) why.push(`${tag} 缺 ${k}`);
    for (const k of R19_PENDING_ALLOWED) if (k !== "confirmationAttempts" && p[k] !== undefined && typeof p[k] !== "string") why.push(`${tag} ${k} 不是字串`);
    if (p.confirmationAttempts !== undefined && !(Number.isInteger(p.confirmationAttempts) && p.confirmationAttempts >= 0 && p.confirmationAttempts <= 2)) why.push(`${tag} confirmationAttempts=${JSON.stringify(p.confirmationAttempts)}（必須是整數 0–2）`);
    if (p.originatingRoute !== undefined && p.originatingRoute !== "more_places") why.push(`${tag} originatingRoute=${JSON.stringify(p.originatingRoute)}`);
    if (p.parentIntent !== undefined && p.parentIntent !== "place_recommendation") why.push(`${tag} parentIntent=${JSON.stringify(p.parentIntent)}`);
    if (typeof p.categoryIntent === "string" && !R19_CATEGORY.includes(p.categoryIntent)) why.push(`${tag} categoryIntent=${p.categoryIntent}`);
    if (typeof p.originalUserText === "string" && p.originalUserText.length > 500) why.push(`${tag} originalUserText 過長`);
    if (typeof p.previousConfirmedDestination === "string" && !trustedAtStart.includes(p.previousConfirmedDestination.trim())) why.push(`${tag} previousConfirmedDestination=${p.previousConfirmedDestination} 不是輪初 Session 既有目的地（${trustedAtStart.join("/") || "-"}）`);
    if (typeof p.rawGeographicLabel === "string" && typeof p.previousConfirmedDestination === "string" && p.rawGeographicLabel.trim() === p.previousConfirmedDestination.trim()) why.push(`${tag} rawGeographicLabel＝previousConfirmedDestination`);
    if (atStart && typeof atStart === "object") {
      const keys = [...new Set([...Object.keys(atStart), ...Object.keys(s)])].filter((k) => k !== "pendingClarification");
      const bad = [];
      for (const k of keys) {
        const a = r19Canon(atStart[k]);
        const b = r19Canon(s[k]);
        if (a === b) continue;
        if (k === "lastAssistantReply" && (s[k] === undefined || typeof s[k] === "string")) continue;
        if (k === "pendingQuestion" && s[k] === undefined) continue;
        if (k === "activeCategoryIntent" && s[k] === p.categoryIntent) continue;
        bad.push(k === "travelContext" && atStart[k] && s[k] ? `travelContext.{${[...new Set([...Object.keys(atStart[k]), ...Object.keys(s[k])])].filter((x) => r19Canon(atStart[k][x]) !== r19Canon(s[k][x])).join(",")}}` : k);
      }
      if (bad.length) why.push(`${tag} Session 其他欄位與輪初不同：${bad.join(",")}`);
    }
  });
  return { ok: !why.length, why: why.join("；") };
}

/** r19-E 單元探針：合法 Pending 寫入 → 放行；夾帶任一禁止欄位、改動 Session、啟動 Places／Weather／Credits → 仍 P1。 */
function r19ExceptionProbe() {
  const atStart = {
    travelContext: { interests: [], destination: "京都", tripPurpose: "more_place_recommendations" },
    recommendationSession: { destination: "京都", searchScope: "city", pool: [{ id: "ChIJ-k1" }], shown: ["ChIJ-k1"] },
    activeRecommendationContext: { destinationName: "京都", intent: "attraction", searchScope: "city" },
    tripPlanningContext: { destination: "京都", selectedPlaces: [] },
    location: { lat: 24.18, lng: 120.62, city: "台中市" },
    activeCategoryIntent: "attraction",
    lastAssistantReply: "在京都，這些地方值得先看看：",
    pendingQuestion: { type: "x" },
    recommendedPlaces: [{ id: "ChIJ-k1" }],
  };
  const P = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: "換金澤，再推薦幾個" };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const NONE = Symbol("no-pending");
  const S = (patch = {}, pend = P) => ({ ...clone(atStart), ...patch, pendingClarification: pend === NONE ? undefined : pend });
  const base = { atStart, places: 0, weather: 0, builders: 0, begins: 0, rpcs: [] };
  const cases = [
    ["E01 合法（全部允許欄位）", { persists: [S()] }, true],
    ["E02 合法（只有必填）", { persists: [S({}, { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places" })] }, true],
    ["E03 合法＋lastAssistantReply 改為詢問文案", { persists: [S({ lastAssistantReply: "要改成金澤嗎？" })] }, true],
    ["E04 合法＋pendingQuestion 移除", { persists: [S({ pendingQuestion: undefined })] }, true],
    ["E05 合法＋confirmationAttempts=1", { persists: [S({}, { ...P, confirmationAttempts: 1 })] }, true],
    ["E06 合法（輪初另有舊 Pending，比對時略過）", { persists: [S()], atStart: { ...clone(atStart), pendingClarification: { ...P } } }, true],
    ["N01 Pending 夾帶 center", { persists: [S({}, { ...P, center: { lat: 36.56, lng: 136.66 } })] }, false],
    ["N02 Pending 夾帶 radius", { persists: [S({}, { ...P, radius: 3000 })] }, false],
    ["N03 Pending 夾帶 searchScope", { persists: [S({}, { ...P, searchScope: "city" })] }, false],
    ["N04 Pending 夾帶 confirmedParentCity", { persists: [S({}, { ...P, confirmedParentCity: "金澤" })] }, false],
    ["N05 Pending 夾帶 trustedDestination", { persists: [S({}, { ...P, trustedDestination: "金澤" })] }, false],
    ["N06 Pending 夾帶 coordinates 物件", { persists: [S({}, { ...P, coordinates: { lat: 1, lng: 2 } })] }, false],
    ["N07 Pending 夾帶 placeIds", { persists: [S({}, { ...P, placeIds: ["ChIJ-x"] })] }, false],
    ["N08 Pending 夾帶 createdAt", { persists: [S({}, { ...P, createdAt: 1 })] }, false],
    ["N09 kind=parent_city_scope", { persists: [S({}, { ...P, kind: "parent_city_scope" })] }, false],
    ["N10 originatingRoute=destination_category", { persists: [S({}, { ...P, originatingRoute: "destination_category" })] }, false],
    ["N11 previousConfirmedDestination＝raw（金澤）", { persists: [S({}, { ...P, previousConfirmedDestination: "金澤" })] }, false],
    ["N12 previousConfirmedDestination＝Session 沒有的城市（大阪）", { persists: [S({}, { ...P, previousConfirmedDestination: "大阪" })] }, false],
    ["N13 缺 rawGeographicLabel", { persists: [S({}, { ...P, rawGeographicLabel: "" })] }, false],
    ["N14 categoryIntent 非法", { persists: [S({}, { ...P, categoryIntent: "spa" })] }, false],
    ["N15 originalUserText 非字串", { persists: [S({}, { ...P, originalUserText: { t: 1 } })] }, false],
    ["N16 confirmationAttempts=3", { persists: [S({}, { ...P, confirmationAttempts: 3 })] }, false],
    ["N17 travelContext.destination＝金澤", { persists: [S({ travelContext: { ...atStart.travelContext, destination: "金澤" } })] }, false],
    ["N18 travelContext 加座標", { persists: [S({ travelContext: { ...atStart.travelContext, latitude: 36.56, longitude: 136.66 } })] }, false],
    ["N19 tripPlanningContext.destination＝金澤", { persists: [S({ tripPlanningContext: { destination: "金澤", selectedPlaces: [] } })] }, false],
    ["N20 recommendationSession 換成金澤 Pool", { persists: [S({ recommendationSession: { destination: "金澤", searchScope: "city", pool: [{ id: "ChIJ-z" }], shown: [] } })] }, false],
    ["N21 activeRecommendationContext＝金澤", { persists: [S({ activeRecommendationContext: { destinationName: "金澤", intent: "attraction", searchScope: "city" } })] }, false],
    ["N22 activeRecommendationContext 移除（方向性變化亦不允許）", { persists: [S({ activeRecommendationContext: undefined })] }, false],
    ["N23 location 改變", { persists: [S({ location: { lat: 36.56, lng: 136.66, city: "金澤" } })] }, false],
    ["N24 新增 tripDestination", { persists: [S({ tripDestination: { city: "金澤" } })] }, false],
    ["N25 新增搜尋範圍欄位（explicitSearchScope）", { persists: [S({ explicitSearchScope: { destination: "金澤", radius: 3000 } })] }, false],
    ["N26 recommendedPlaces 改變", { persists: [S({ recommendedPlaces: [{ id: "ChIJ-z" }] })] }, false],
    ["N27 pendingQuestion 改成新問題", { persists: [S({ pendingQuestion: { type: "y" } })] }, false],
    ["N28 activeCategoryIntent 改成其他類別", { persists: [S({ activeCategoryIntent: "cafe" })] }, false],
    ["N29 Places 請求 1 次", { persists: [S()], places: 1 }, false],
    ["N30 Builder 1 次", { persists: [S()], builders: 1 }, false],
    ["N31 Weather 1 次", { persists: [S()], weather: 1 }, false],
    ["N32 Credits.begin 1 次", { persists: [S()], begins: 1 }, false],
    ["N33 Credits RPC reserve", { persists: [S()], rpcs: ["credits_reserve"] }, false],
    ["N34 Credits RPC commit", { persists: [S()], rpcs: ["credits_commit"] }, false],
    ["N35 Credits RPC check", { persists: [S()], rpcs: ["credits_check"] }, false],
    ["N36 兩次寫入：合法＋只清 Pending", { persists: [S(), S({}, NONE)] }, false],
    ["N37 寫入沒有 Pending", { persists: [S({}, NONE)] }, false],
    ["N38 缺輪初 Session", { persists: [S()], atStart: null }, false],
  ];
  const rows = cases.map(([label, over, want]) => {
    const r = r19PendingException({ ...base, ...over });
    return { label, want, got: r.ok, why: r.why, pass: r.ok === want };
  });
  return { rows, pass: rows.filter((x) => x.pass).length, n: rows.length };
}

/** r19-K：外掛情境 SCENARIO.r19Coords 只改 geocode Mock 回應座標（名稱比對；r13 情境沒有此欄位 → 原樣）。 */
const R19_COORD_KEYS = [["金澤", /金澤|金沢|Kanazawa/i], ["京都", /京都|Kyoto/i], ["大阪", /大阪|Osaka/i]];
function r19Coords(scenario, loc) {
  const table = scenario?.r19Coords;
  if (!table || !loc) return loc;
  const name = `${loc.city ?? ""}|${loc.formattedName ?? ""}|${loc.displayLabel ?? ""}`;
  for (const [k, re] of R19_COORD_KEYS) if (table[k] && re.test(name)) return { ...loc, lat: table[k].lat, lng: table[k].lng };
  return loc;
}

// ════════════════════════ r19-V：post-MP25 快照預留（存在且吻合才接受）════════════════════════
const R19_SNAP_EXTRA_OK = ["src/lib/i18n/chat-runtime.ts", "src/lib/ai/destination-geographic-clarification.ts"];
const R19_SNAP_PATCHES_R17 = [
  ['"  const postMP = snap(`${PRE_DIR}/post-MP-r2-sha.txt`);', '"  const postMP = snap(`${PRE_DIR}/post-MP25-sha.txt`); /* r19-V：post-MP25 */'],
  ['"const postCbSha = readFileSync(`${PRE_DIR}/post-MP-r2-sha.txt`', '"const postCbSha = readFileSync(`${PRE_DIR}/post-MP25-sha.txt`'],
  ['"const postA2Lines = readFileSync(`${PRE_DIR}/post-MP-r2-sha.txt`', '"const postA2Lines = readFileSync(`${PRE_DIR}/post-MP25-sha.txt`'],
  ['"if (snapSha(`${PRE_DIR}/post-MP-r2-sha.txt`, relCri)', '"if (snapSha(`${PRE_DIR}/post-MP25-sha.txt`, relCri)'],
  ['"const postCB = snapSha(`${PRE_DIR}/post-MP-r2-sha.txt`, rel);', '"const postCB = snapSha(`${PRE_DIR}/post-MP25-sha.txt`, rel);'],
  ["'  const wantApp = { work: shaLine(`${PRE_DIR}/post-MP-r2-sha.txt`", "'  const wantApp = { work: shaLine(`${PRE_DIR}/post-MP25-sha.txt`"],
].map(([old, neu], i) => ({ id: `r19-V post-MP25 r17#${i + 1}`, old, neu }));
const R19_SNAP_PATCHES_R16 = [
  {
    id: "r19-V post-MP25 r16 precheck 差異檔",
    old: "if (JSON.stringify(diffRels) !== JSON.stringify([REL_CTD, REL_APP].sort())) fail.push(",
    neu: "if (!__r17.r18.r19.mp25DiffOk(diffRels, [REL_CTD, REL_APP])) /* r19-V：post-MP25（ctd＋_app 必須；chat-runtime／geo-clarification 可選） */ fail.push(",
  },
];
function r19Snap() {
  const f = `${PRE_DIR}/post-MP25-sha.txt`;
  const snap = (file) => {
    const m = new Map();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (x) m.set(x[2], x[1]);
    }
    return m;
  };
  if (!existsSync(f)) return { mode: "post-MP-r2", fail: [], r17: [], r16: [] };
  const fail = [];
  const s25 = snap(f);
  const s2 = snap(`${PRE_DIR}/post-MP-r2-sha.txt`);
  if (s25.size !== 18 || JSON.stringify([...s25.keys()].sort()) !== JSON.stringify([...s2.keys()].sort())) fail.push(`post-MP25-sha.txt 的檔案清單必須與 post-MP-r2 相同（18 檔；實際 ${s25.size}）`);
  for (const [rel, want] of s25) {
    const p = `${WORK_ROOT}/${rel}`;
    const got = existsSync(p) ? sha1(readFileSync(p)) : "(missing)";
    if (got !== want) fail.push(`work ${rel} sha=${got} ≠ post-MP25 ${want}`);
  }
  const diff = [...s25.keys()].filter((rel) => s25.get(rel) !== s2.get(rel)).sort();
  if (!diff.includes("src/routes/_app.chat.tsx") || diff.some((rel) => rel !== "src/routes/_app.chat.tsx" && !R19_SNAP_EXTRA_OK.includes(rel))) fail.push(`post-MP25 相對 post-MP-r2 的差異檔必須含 _app.chat.tsx、其餘只能是 ${R19_SNAP_EXTRA_OK.join("／")}（實際=${diff.join(",") || "-"}）`);
  return { mode: "post-MP25", fail, r17: R19_SNAP_PATCHES_R17, r16: R19_SNAP_PATCHES_R16, diff };
}
const r19Mp25DiffOk = (diffRels, required) => required.every((r) => diffRels.includes(r)) && diffRels.every((r) => required.includes(r) || R19_SNAP_EXTRA_OK.includes(r));

// ════════════════════════ r19-H：send() destination_switch 區段（位置擷取；注入 r18ExtractInject，取代 r18 的「單一 if」）════════════════════════
const R19_H_LOCALS = ["msgs", "trimmed", "displayMessage", "nextSession", "pendingGeographic", "nearbyShortcutTurn", "turnPendingGeographic", "turnStartSession", "session", "sessionForTurn", "lastAssistantReply", "normalizedShortcutFromTurn", "opts"];
/** 本函式從不直接呼叫：toString() 取本體插入 r18ExtractInject（與 ts／sf／sendFn／found／label 同一 scope）。 */
function r19ExtractInject() {
  // ── r19-H：位置擷取（const nearbyShortcutTurn〔＋F5 nearby pending 清除 if〕之後、parent_city_scope if 之前的所有語句）──
  {
    const R19_H_LOCALS = "__R19_H_LOCALS__";
    const lnH = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const info = { anchors: null, region: null, refs: [] };
    const declHits = [];
    const vd = (node) => {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1 && node.declarationList.declarations[0].name.getText(sf) === "pendingGeographic" && node.declarationList.declarations[0].initializer?.getText(sf) === "nextSession.pendingClarification") declHits.push(node);
      ts.forEachChild(node, vd);
    };
    vd(sendFn.body);
    if (declHits.length > 1) throw new Error(`[r19-extract] ${label} send() const pendingGeographic = nextSession.pendingClarification 出現 ${declHits.length} 次（必須 ≤1 次）`);
    let region = [];
    if (declHits.length === 1 && ts.isBlock(declHits[0].parent)) {
      const st = [...declHits[0].parent.statements];
      const i0 = st.indexOf(declHits[0]);
      const iN = st.findIndex((s, i) => i > i0 && ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => d.name.getText(sf) === "nearbyShortcutTurn"));
      const iP = st.findIndex((s, i) => i > i0 && ts.isIfStatement(s) && /^pendingGeographic\?\.kind === "parent_city_scope"/.test(s.expression.getText(sf)));
      if (iN > i0 && iP > iN) {
        let iS = iN;
        const nx = st[iN + 1];
        if (nx && ts.isIfStatement(nx) && /\bnearbyShortcutTurn\b/.test(nx.expression.getText(sf)) && /\bturnPendingGeographic\b/.test(nx.expression.getText(sf))) iS = iN + 1;
        region = st.slice(iS + 1, iP);
        info.anchors = { decl: lnH(declHits[0].getStart(sf)), nearby: lnH(st[iN].getStart(sf)), strip: iS > iN ? lnH(st[iS].getStart(sf)) : null, parent: lnH(st[iP].getStart(sf)) };
      } else info.anchors = { missing: `nearbyShortcutTurn=${iN > i0} parent_city_scope if=${iP > i0}` };
    } else info.anchors = { missing: declHits.length ? "pendingGeographic 宣告不在 Block" : "pendingGeographic 宣告" };
    if (region.length) {
      const assigns = [];
      const va = (node) => {
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(node.left) && R19_H_LOCALS.includes(node.left.text) && node.left.text !== "nextSession") assigns.push(node.left.text);
        ts.forEachChild(node, va);
      };
      for (const s of region) va(s);
      if (assigns.length) throw new Error(`[r19-extract] ${label} destination_switch 區段重新指派區域變數 ${[...new Set(assigns)].join(",")}（模型只寫回 nextSession → INFRA-FAIL）`);
      found.r18DestSwitch = { kind: "r18block", node: region[0], endNode: region.at(-1), text: region.map((s) => s.getText(sf)).join("\n") };
      info.region = { start: lnH(region[0].getStart(sf)), end: lnH(region.at(-1).getEnd()), statements: region.length };
    }
    const ranges = Object.entries(found).map(([n, f]) => [n, f.node.getStart(sf), (f.endNode ?? f.node).getEnd()]);
    const vs = (node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === "destination_switch") {
        const pos = node.getStart(sf);
        const unit = ranges.find(([, a, b]) => pos >= a && pos < b);
        let p = node.parent;
        let typeOnly = false;
        let topFn = null;
        while (p) {
          if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) typeOnly = true;
          if (p.parent === sf && ts.isFunctionDeclaration(p)) topFn = p.name?.text ?? "(anonymous)";
          p = p.parent;
        }
        info.refs.push({ line: lnH(pos), where: typeOnly ? "type" : unit ? `unit:${unit[0]}` : topFn ? `fn:${topFn}` : "model" });
      }
      ts.forEachChild(node, vs);
    };
    vs(sf);
    if (!info.anchors.parent && info.refs.some((r) => r.where !== "type")) throw new Error(`[r19-extract] ${label} 有 destination_switch 參照但找不到 send() 擷取錨點（${info.anchors.missing}）→ INFRA-FAIL`);
    globalThis.__R19_H = globalThis.__R19_H ?? {};
    globalThis.__R19_H[label] = info;
  }
}
const inj = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}"));
};

// ════════════════════════ R19_R13_PATCHES（r13 執行內容層；套在 R18_R13_PATCHES 之後）════════════════════════
const R19_R13_PATCHES = [
  {
    id: "r19-E turn start snapshot",
    kind: "exact",
    old: "      obs.r18PendingAtStart = persisted.pendingClarification ? JSON.parse(JSON.stringify(persisted.pendingClarification)) : null;\n",
    neu: L(
      "      obs.r18PendingAtStart = persisted.pendingClarification ? JSON.parse(JSON.stringify(persisted.pendingClarification)) : null;",
      "      globalThis.__R19_TURN_START = persisted ? JSON.parse(JSON.stringify(persisted)) : null; // r19-E：輪初 Session（Pending 例外的比對基準；只在子程序記憶體，不輸出）",
      "",
    ),
  },
  {
    id: "r19-F send start",
    kind: "exact",
    old: "    const trimmed = text.trim();\n    obs.textMeal = mealOf(trimmed);\n",
    neu: L(
      "    const trimmed = text.trim();",
      "    obs.textMeal = mealOf(trimmed);",
      "    const r19MsgsAtSend = msgs; // r19-F：send() 開始時的 msgs（正式 catch 的 errorConversation 基底）",
      '    if (t.fault === "r19ThrowMoreOnce") obs.r19ThrowMore = 1; // r19-F：外掛情境故障注入（r13 情境沒有此值）',
      "",
    ),
  },
  {
    id: "r19-F refetch catch",
    kind: "exact",
    old: '      if (await R14_runBlock("refetchBranch", { msgs, trimmed, displayMessage: trimmed, nextSession, merged })) {\n',
    neu: L(
      "      let r19Refetch;",
      "      try {",
      '        r19Refetch = await R14_runBlock("refetchBranch", { msgs, trimmed, displayMessage: trimmed, nextSession, merged });',
      "      } catch (e) {",
      '        if (!String(e?.message ?? e).includes("[r19-fault]")) throw e;',
      "        // r19-F：send() 正式 catch（work L11140-11169）模型：applyLocalFallback({ ...session, location／authority＝withoutUnconfirmedSessionDestinations(nextSession, turnStartSession) }, …, \"state_machine_error\", turnStartSession)",
      '        obs.path += "|r19:fault→catch(state_machine_error)";',
      '        const errorConversation = [...r19MsgsAtSend, { role: "user", content: trimmed }];',
      "        const turnLocation = M.ctd?.withoutUnconfirmedSessionDestinations ? M.ctd.withoutUnconfirmedSessionDestinations(nextSession, turnStartSession) : { location: session.location, nearbyLocationAuthority: session.nearbyLocationAuthority };",
      '        const fb = await applyLocalFallback(obs, { ...session, location: turnLocation.location, nearbyLocationAuthority: turnLocation.nearbyLocationAuthority }, trimmed, errorConversation, "state_machine_error", turnStartSession);',
      '        if (!fb) obs.path += "|recovery_copy";',
      "        return;",
      "      }",
      "      if (r19Refetch) {",
      "",
    ),
  },
  {
    id: "r19-K coords",
    kind: "exact",
    old: "    const location = realisticLocation(q);\n",
    neu: "    const location = __r14.r15.r16.r17.r18.r19.coords(SCENARIO, realisticLocation(q)); // r19-K：只在外掛情境 SCENARIO.r19Coords 時改座標\n",
  },
];

// ════════════════════════ R19_R14_PATCHES（r14 原文層；套在 R18_R14_PATCHES 之後）════════════════════════
const R19_R14_PATCHES = [
  {
    id: "r19-E r14-Δ7 persist 例外",
    kind: "exact",
    old: "        if (frame.persists.length) viol(`可信判定未通過仍寫入 Session ${frame.persists.length} 次`);\n",
    neu: L(
      "        if (frame.persists.length) {",
      "          // r19-E：使用者裁決的唯一例外（destination_switch Pending）；任一條件不成立 → 原 r14-Δ7 P1 照判（訊息逐字不變）",
      "          const r19x = __r14.r15.r16.r17.r18.r19.pendingException({ persists: frame.persists, atStart: globalThis.__R19_TURN_START ?? null, places, weather, builders: frame.builders.length, begins: frame.begins.length, rpcs: R14_rpc.slice(frame.rpc0).map((x) => x.name) });",
      "          (o.r19Exc ??= []).push({ cb: short, ok: r19x.ok, why: r19x.why, n: frame.persists.length });",
      "          if (!r19x.ok) viol(`可信判定未通過仍寫入 Session ${frame.persists.length} 次`);",
      "        }",
      "",
    ),
  },
  {
    id: "r19-F callback fault",
    kind: "exact",
    old: "        ret = await real(...args);\n",
    neu: L(
      "        // r19-F：故障注入（只在外掛情境 turn.fault === \"r19ThrowMoreOnce\"）：該輪第一次呼叫正式 pushMorePlaceRecommendations 即拋錯",
      '        if (o && name === "pushMorePlaceRecommendations" && o.r19ThrowMore > 0) {',
      "          o.r19ThrowMore -= 1;",
      "          (o.r19Faults ??= []).push(name);",
      '          throw new Error("[r19-fault] pushMorePlaceRecommendations 內拋錯（故障注入）");',
      "        }",
      "        ret = await real(...args);",
      "",
    ),
  },
  {
    id: "r19-C extract helpers",
    kind: "exact",
    old: "  return { label, file, sha: sha1(srcText), imports, units, moduleFns };\n",
    neu: L(
      "  // r19-C：Callback／區塊引用、但不在已審查閉包清單的 _app.chat.tsx 頂層 function 宣告 → 擷取該樹正式實作（遞移；依賴只能是 @/ import／允許的全域／同檔已擷取 function）",
      "  {",
      "    const topFns = new Map();",
      "    for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.body) topFns.set(st.name.text, st);",
      "    const queue = [];",
      "    for (const u of Object.values(units)) for (const c of u.closure) if (!Object.hasOwn(R14_CLOSURE_DEPS, c) && topFns.has(c)) queue.push(c);",
      "    while (queue.length) {",
      "      const n = queue.shift();",
      "      if (moduleFns[n]) continue;",
      "      const st = topFns.get(n);",
      "      const text = st.getText(sf);",
      "      const js = toJs(`(${text})`);",
      "      const free = r14FreeIdentifiers(ts, js);",
      "      for (const x of free) if (x !== n && topFns.has(x) && !moduleFns[x] && !Object.hasOwn(R14_CLOSURE_DEPS, x)) queue.push(x);",
      "      moduleFns[n] = { js, start: lineOf(st.getStart(sf)), end: lineOf(st.getEnd()), sha: sha1(text), free, imports: free.filter((x) => importNames.has(x)), closure: free.filter((x) => !importNames.has(x) && !R14_ALLOWED_GLOBALS.has(x) && !topFns.has(x)), r19: true };",
      "    }",
      "  }",
      "  return { label, file, sha: sha1(srcText), imports, units, moduleFns };",
      "",
    ),
  },
  {
    id: "r19-C prepare allowed",
    kind: "exact",
    old: "[name] ?? [] : [])]); // r18-P：區塊區域變數（明列）",
    neu: "[name] ?? [] : []), ...Object.keys(ex.moduleFns ?? {}).filter((m) => ex.moduleFns[m].r19)]); // r18-P：區塊區域變數（明列） // r19-C：＋該樹已擷取的頂層 helper",
  },
  {
    id: "r19-C child closure",
    kind: "exact",
    old: "  for (const k of Object.keys(__r14.CLOSURE_DEPS)) if (!Object.hasOwn(R14_closure, k)) throw new Error(`[r14] 已審查閉包 ${k} 沒有實作`);\n",
    neu: L(
      "  for (const n of Object.keys(R14X.moduleFns ?? {})) if (!Object.hasOwn(R14_closure, n)) R14_closure[n] = (...a) => R17_moduleFn(n)(...a); // r19-C：頂層 helper＝該樹正式實作",
      "  for (const k of Object.keys(__r14.CLOSURE_DEPS)) if (!Object.hasOwn(R14_closure, k)) throw new Error(`[r14] 已審查閉包 ${k} 沒有實作`);",
      "",
    ),
  },
];

// ════════════════════════ R19_R15_PATCHES（r15 原文層；套在 R18_R15_PATCHES 之後）════════════════════════
const R19_R15_PATCHES = [
  {
    id: "r19 report",
    kind: "exact",
    old: "  __r16.r17.r18.report({ P1, out, results, TREES }); // r18：r18-P 擷取／執行次數、r18-N 條件（只新增輸出）\n",
    neu: "  __r16.r17.r18.report({ P1, out, results, TREES }); // r18：r18-P 擷取／執行次數、r18-N 條件（只新增輸出）\n  __r16.r17.r18.r19.report({ P1, out, results, TREES }); // r19：r19-E／H／C／F（只新增輸出）\n",
  },
];

// ════════════════════════ R19_R17_PATCHES（r17 原文層；套在 R18_R17_PATCHES 之後）════════════════════════
const R19_R17_PATCHES = [{ id: "r19 r16 patch hook", old: "function r17Apply(src, patches, what) {\n", neu: "for (const p of __r18.r19.r16Patches) R17_R16_PATCHES.push(p); // r19：R19_R16_PATCHES（只在接受 post-MP25 時非空）\nfunction r17Apply(src, patches, what) {\n" }];

// ════════════════════════ R19_R18_PATCHES（r18 原文層）════════════════════════
const R19_R18_INFRA = [
  {
    id: "r19-V static imports → __r19.imp（AsyncFunction 執行需要）",
    old: L('import { readFileSync, writeFileSync, existsSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync } = await __r19.imp("node:fs"); // r19：同 r18 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r19.imp("node:crypto");',
      'const { execFileSync } = await __r19.imp("node:child_process");',
    ),
  },
  { id: "r19-V __r18.imp", old: "const makeR18 = (extra) => ({\n  imp: (s) => import(s),\n", neu: "const makeR18 = (extra) => ({\n  imp: __r19.imp, // r19\n  r19: __r19, // r19\n" },
  {
    id: "r19 patch hooks r13/r14/r15/r17",
    old: "function r18Apply(src, patches, what) {\n",
    neu: L(
      "for (const p of __r19.r13Patches) R18_R13_PATCHES.push(p); // r19：R19_R13_PATCHES 套在 R18_R13_PATCHES 之後",
      "for (const p of __r19.r14Patches) R18_R14_PATCHES.push(p); // r19：R19_R14_PATCHES 套在 R18_R14_PATCHES 之後",
      "for (const p of __r19.r15Patches) R18_R15_PATCHES.push(p); // r19：R19_R15_PATCHES 套在 R18_R15_PATCHES 之後",
      "for (const p of __r19.r17Patches) R18_R17_PATCHES.push(p); // r19：R19_R17_PATCHES 套在 R18_R17_PATCHES 之後",
      "function r18Apply(src, patches, what) {",
      "",
    ),
  },
  { id: "r19 r18 emit-diff off", old: 'if (process.argv.includes("--emit-diff")) {\n  const CAP = Symbol("r18-capture");', neu: 'if (__r19.r18EmitDiff === true) { // r19：r18 自身的 --emit-diff 不執行（改由 r19 產生 scratchpad/r19.diff）\n  const CAP = Symbol("r18-capture");' },
  { id: "r19 emit capture r17", old: '  r18Body = r18Apply(r17Src, R18_R17_PATCHES, "r17");\n', neu: '  r18Body = r18Apply(r17Src, R18_R17_PATCHES, "r17");\n  if (__r19.onR18Body) __r19.onR18Body(r18Body); // r19：--emit-diff 擷取實際執行的 r17\n' },
  { id: "r19 run extra", old: ")(makeR18({}));\n", neu: ")(makeR18(__r19.r18Extra ?? {})); // r19\n" },
];
const R19_R18_PATCHES = [
  ...R19_R18_INFRA,
  // r19-V：子程序、白名單、摘要
  {
    id: "r19-V child script",
    old: "neu: 'neu: \"phase2-r18.mjs`; // r18：子程序執行 r18（＝r17＋R18 patch）；",
    neu: "neu: 'neu: \"phase2-r19.mjs`; // r19：子程序執行 r19（＝r18＋R19 patch）；r18：子程序執行 r18（＝r17＋R18 patch）；",
  },
  {
    id: "r19-V whitelist",
    old: String.raw`'r1[0-8])/.test(f) && f !== `,
    neu: String.raw`'r1[0-9])/.test(f) && f !== \\"scripts/verify-more-places-destination-switch-mp25-r2.mjs\\" /* r19-V：r1[0-9]＋mp25-r2 */ && f !== `,
  },
  { id: "r19-V summary", old: "neu: \"neu: 'verify-destination-authority-phase2-r18: work P1=\" },", neu: "neu: \"neu: 'verify-destination-authority-phase2-r19: work P1=\" }, /* r19-V */" },
  { id: "r19-V summary fields", old: '${__r15.r16.r17.r18.summaryFields()} → " },\'', neu: '${__r15.r16.r17.r18.summaryFields()} ${__r15.r16.r17.r18.r19.summaryFields()} → " },\' /* r19-V */' },
  // r19-H：位置擷取＋區域變數擴充（明列）
  {
    id: "r19-H locals",
    old: '  r18DestSwitch: ["msgs", "trimmed", "displayMessage", "nextSession", "pendingGeographic", "nearbyShortcutTurn", "turnPendingGeographic", "turnStartSession"],\n',
    neu: `  r18DestSwitch: ${JSON.stringify(R19_H_LOCALS)}, // r19-H：位置擷取區段可用的區域變數（明列；r13 模型在呼叫點傳入當下值）\n`,
  },
  {
    id: "r19-H model locals",
    old: '      "      const r18L = { msgs, trimmed, displayMessage: trimmed, nextSession, pendingGeographic, nearbyShortcutTurn, turnPendingGeographic, turnStartSession };",\n',
    neu: '      "      const r18L = { msgs, trimmed, displayMessage: trimmed, nextSession, pendingGeographic, nearbyShortcutTurn, turnPendingGeographic, turnStartSession, session, sessionForTurn, lastAssistantReply, normalizedShortcutFromTurn, opts: t.source === undefined ? undefined : { source: t.source } }; // r19-H：位置擷取區段的區域變數（明列）",\n',
  },
  {
    id: "r19-H positional extraction",
    old: L(
      "    if (swHits.length > 1) throw new Error(`[r18-extract] ${label} send() destination_switch handler 出現 ${swHits.length} 次（必須 0 或 1 次）`);",
      "    if (swHits.length === 1) found.r18DestSwitch = { kind: \"r18block\", node: swHits[0], text: swHits[0].getText(sf) };",
      "",
    ),
    neu: `    void swHits; // r19-H：r18 的「單一 if」擷取停用，改為位置擷取（下方）\n${inj(r19ExtractInject).replace('"__R19_H_LOCALS__"', JSON.stringify(R19_H_LOCALS))}\n`,
  },
];

function r19Apply(src, patches, what) {
  let text = src;
  const count = (hay, needle) => {
    let n = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n += 1;
    return n;
  };
  for (const p of patches) {
    const n = count(text, p.old);
    if (n !== 1) throw new Error(`${what} patch ${p.id}：錨點出現 ${n} 次（必須 1 次）`);
    text = text.replace(p.old, () => p.neu);
  }
  return text;
}

// ════════════════════════ 報告（主程序）════════════════════════
const R19_STATE = { probe: null, snap: null, exc: null, faults: null };
function r19Report({ out, results }) {
  out.push("\n══════════════════════ r19（A2-MP-T5）══════════════════════");
  out.push(`══ r19-V：work sha 快照＝${R19_STATE.snap?.mode ?? "-"}${R19_STATE.snap?.diff ? `（post-MP25 差異檔=${R19_STATE.snap.diff.join(",")}）` : ""} ══`);
  const p = R19_STATE.probe;
  out.push(`══ r19-E：Pending 例外單元探針 ${p.pass}/${p.n}（合法寫入→放行；夾帶禁止欄位／改 Session／Places／Weather／Credits→仍 P1）══`);
  for (const r of p.rows) out.push(`  [${r.pass ? "OK" : "NG"}] ${r.label} 期望=${r.want ? "放行" : "P1"} 實際=${r.got ? "放行" : "P1"}${r.why ? `（${r.why.slice(0, 140)}）` : ""}`);
  const exc = {};
  const faults = {};
  for (const [key, r] of Object.entries(results)) {
    const [tree, mode, sid] = key.split("|");
    for (const t of r?.result?.turns ?? []) {
      for (const x of t.r19Exc ?? []) ((exc[tree] ??= { ok: [], ng: [] })[x.ok ? "ok" : "ng"]).push(`[${sid}][${mode}] T${t.turnIndex + 1} ${x.cb} 寫入=${x.n}${x.why ? `：${x.why.slice(0, 160)}` : ""}`);
      if (t.r19Faults?.length || /r19:fault/.test(String(t.path ?? ""))) (faults[tree] ??= []).push(`[${sid}] T${t.turnIndex + 1} faults=${(t.r19Faults ?? []).join(",") || "-"} path=${String(t.path ?? "").slice(0, 160)}`);
    }
  }
  R19_STATE.exc = exc;
  R19_STATE.faults = faults;
  out.push("══ r19-E：實際執行中的例外評估（只在「可信判定未通過且 Callback 內寫入 Session」時評估；放行＝例外命中；P1＝原 r14-Δ7 照判）══");
  for (const [tree, v] of Object.entries(exc)) {
    out.push(`  ${tree.padEnd(5)} 例外命中=${v.ok.length} 原 P1 照判=${v.ng.length}`);
    for (const x of v.ok) out.push(`    [例外命中] ${x}`);
    for (const x of v.ng.slice(0, 40)) out.push(`    [P1 照判] ${x}`);
  }
  if (!Object.keys(exc).length) out.push("  （本次沒有任何「可信判定未通過仍寫入 Session」的 Callback；例外命中 0）");
  out.push("══ r19-H：send() destination_switch 區段（位置擷取）＋全檔 \"destination_switch\" 字面位置 ══");
  for (const [tree, h] of Object.entries(globalThis.__R19_H ?? {})) {
    const a = h.anchors ?? {};
    out.push(`  ${tree.padEnd(5)} 錨點：${a.missing ? `缺（${a.missing}）` : `pendingGeographic L${a.decl}、nearbyShortcutTurn L${a.nearby}${a.strip ? `、F5 清除 if L${a.strip}` : ""}、parent_city_scope if L${a.parent}`}；區段＝${h.region ? `L${h.region.start}-${h.region.end}（${h.region.statements} 句）` : "（無 handler）"}`);
    out.push(`        destination_switch 字面：${h.refs.length ? h.refs.map((r) => `L${r.line}@${r.where}`).join("、") : "（無）"}`);
  }
  out.push("══ r19-F：故障注入（續推 Callback 拋錯 → 正式 catch 模型 → applyLocalFallback → fallback continue）══");
  for (const [tree, v] of Object.entries(faults)) for (const x of v) out.push(`  ${tree.padEnd(5)} ${x}`);
  if (!Object.keys(faults).length) out.push("  （本次沒有故障注入情境）");
}
function r19SummaryFields() {
  const w = R19_STATE.exc?.work ?? { ok: [], ng: [] };
  const h = globalThis.__R19_H?.work;
  const model = (h?.refs ?? []).filter((r) => r.where === "model").length;
  return `r19[snap=${R19_STATE.snap?.mode ?? "-"} 例外探針=${R19_STATE.probe?.pass}/${R19_STATE.probe?.n} work 例外命中=${w.ok.length} P1照判=${w.ng.length} destSwitch 區段 work=${h?.region ? `L${h.region.start}-${h.region.end}` : "無"} 區段外參照=${model}]`;
}

// ════════════════════════ 契約差異（--emit-diff 寫 scratchpad/r19-contract-diff.md）════════════════════════
const R19_CONTRACT = [
  ["r14-Δ7（r14 L745）「可信判定未通過仍寫入 Session」", "Callback 內可信判定未通過時任何 persistSession → P1", "同左；唯一例外：寫入的每一筆 Session 都只是在輪初 Session 上加 destination_switch Pending（欄位白名單＋型別＋previousConfirmedDestination 必須是輪初既有目的地），其餘欄位逐一相等（只允許 lastAssistantReply 字串、pendingQuestion 移除、activeCategoryIntent＝Pending 類別），且該 Callback 內 Places=0、Builder=0、Weather=0、Credits.begin=0、credits_* RPC=0；不成立 → 原 P1（訊息不變）", "MP-25 需在 Provider 失敗輪保存切換意圖；不允許任何可信目的地／範圍／座標／半徑／Pool／Context 隨之寫入", "使用者裁決（Pending 安全例外）"],
  ["r18-H send() handler 擷取", "單一 if、條件字面含 pendingGeographic?.kind === \"destination_switch\"、區域變數 8 個", "依位置擷取：nearbyShortcutTurn（＋F5 清除 if）之後、parent_city_scope if 之前所有語句；區域變數擴為 13 個（明列）；未知依賴、重新指派非 nextSession 區域變數、錨點缺失但有 destination_switch 參照 → INFRA-FAIL；全檔字面位置列出", "審查 2：不限定 if／switch／helper 名稱，只依行為", "任務單授權（測試執行模型）"],
  ["Callback 閉包中的 _app 頂層 helper", "不在 R14_CLOSURE_DEPS → INFRA-FAIL（r17-C 只認 2 個名稱）", "引用到的 _app 頂層 function 宣告以 AST 擷取正式實作（遞移），依賴只能是 @/ import／允許全域／同檔已擷取 function；其餘仍 INFRA-FAIL", "任務單：比照 r17-C", "任務單授權"],
  ["fallback continue（work L6795-6857）實測", "invoked=0（UNVERIFIED）", "新增外掛情境故障模式 r19ThrowMoreOnce：續推 Callback 拋錯 → send() 正式 catch 模型（L11140-11169）→ applyLocalFallback → 正式 fallback continue", "審查 7", "任務單授權（不需大型 Harness）"],
  ["Mock 座標", "金澤／京都皆為 Mock 預設 (35,135)", "只在外掛情境 SCENARIO.r19Coords 時改 geocode Mock 座標；r13 情境不受影響", "審查 5", "任務單授權（只對外掛情境生效）"],
  ["work sha 快照", "只接受 post-MP-r2", "預留 post-MP25：存在且 18 檔吻合、差異檔限 _app（必須）＋chat-runtime／geo-clarification（可選）才接受；存在但不吻合 → INFRA-FAIL；本輪未建立", "審查 6", "任務單授權（版本識別）"],
];

// ════════════════════════ 執行 ════════════════════════
function r19TestShaCheck() {
  const want = new Map();
  for (const line of readFileSync(TEST_SHA_FILE, "utf8").split("\n")) {
    const x = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
    if (x) want.set(x[2], x[1]);
  }
  const now = readdirSync(`${WORK_ROOT}/scripts`).filter((f) => /^verify-.*\.mjs$/.test(f)).map((f) => `scripts/${f}`);
  const changed = [];
  const added = [];
  for (const rel of now) {
    const got = sha256(readFileSync(`${WORK_ROOT}/${rel}`));
    if (!want.has(rel)) added.push(rel);
    else if (want.get(rel) !== got) changed.push(rel);
  }
  const missing = [...want.keys()].filter((rel) => !now.includes(rel));
  return { base: want.size, now: now.length, changed, added, missing };
}
if (process.argv.includes("--check-test-sha")) {
  const r = r19TestShaCheck();
  console.log(`scripts/verify-*.mjs：基準 ${r.base} 支、現在 ${r.now} 支；修改=${r.changed.length} [${r.changed.join(",")}]；新增=${r.added.length} [${r.added.join(",")}]；缺少=${r.missing.length} [${r.missing.join(",")}]`);
  const okAdded = r.added.every((x) => x === SELF_REL || x === MP25_R2);
  process.exit(!r.changed.length && !r.missing.length && okAdded ? 0 : 1);
}

const r18Text = readFileSync(R18_FILE, "utf8");
const r18Want = existsSync(TEST_SHA_FILE) ? readFileSync(TEST_SHA_FILE, "utf8").split("\n").find((l) => l.endsWith("  scripts/verify-destination-authority-phase2-r18.mjs"))?.slice(0, 64) : null;
if (!r18Want || sha256(r18Text) !== r18Want) {
  console.log(`INFRA-FAIL r18 sha256=${sha256(r18Text)} ≠ ${r18Want ?? "(缺 scratchpad/pre-MP5T-test-sha.txt)"}（r18 被修改？r19 不執行）`);
  process.exit(1);
}
R19_STATE.probe = r19ExceptionProbe();
if (R19_STATE.probe.pass !== R19_STATE.probe.n) {
  console.log(["INFRA-FAIL r19-E 單元探針不符", ...R19_STATE.probe.rows.filter((x) => !x.pass).map((x) => `  ${x.label} 期望=${x.want} 實際=${x.got} ${x.why}`)].join("\n"));
  process.exit(1);
}
const snap = r19Snap();
R19_STATE.snap = snap;
if (snap.fail.length) {
  console.log(["INFRA-FAIL r19-V post-MP25 快照存在但不吻合（不退回 post-MP-r2）", ...snap.fail].join("\n"));
  process.exit(1);
}
const shebang = r18Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r18 缺少 shebang");
  process.exit(1);
}
const r18Src = r18Text.slice(shebang[0].length);
let r19Body;
try {
  r19Body = r19Apply(r18Src, R19_R18_PATCHES, "r18");
} catch (e) {
  console.log(`INFRA-FAIL r19 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r19Body) || /^\s*imp: \(s\) => import\(s\)/m.test(r19Body)) {
  console.log("INFRA-FAIL r19：patched r18 仍有 import 陳述式／import()");
  process.exit(1);
}
/** post-MP25 預留 patch 乾跑：每個錨點在目標原文恰好一次（不啟用時也檢查，確保日後建立快照後可套用）。 */
function r19SnapDryRun() {
  const r17 = readFileSync(R17_FILE, "utf8");
  const r16 = readFileSync(R16_FILE, "utf8");
  const res = [];
  for (const [src, ps] of [[r17, R19_SNAP_PATCHES_R17], [r16, R19_SNAP_PATCHES_R16]]) {
    for (const p of ps) {
      let n = 0;
      for (let i = src.indexOf(p.old); i >= 0; i = src.indexOf(p.old, i + 1)) n += 1;
      res.push({ id: p.id, n });
    }
  }
  return res;
}
const AsyncFunction = (async () => {}).constructor;
const makeR19 = (extra) => ({
  imp: (s) => import(s),
  r13Patches: R19_R13_PATCHES,
  r14Patches: R19_R14_PATCHES,
  r15Patches: R19_R15_PATCHES,
  r17Patches: [...R19_R17_PATCHES, ...snap.r17],
  r16Patches: [...snap.r16],
  pendingException: r19PendingException,
  coords: r19Coords,
  mp25DiffOk: r19Mp25DiffOk,
  report: r19Report,
  summaryFields: r19SummaryFields,
  state: R19_STATE,
  r18EmitDiff: false,
  r18Extra: null,
  onR18Body: null,
  ...extra,
});

if (process.argv.includes("--probe")) {
  const p = R19_STATE.probe;
  console.log(`r19-E 單元探針 ${p.pass}/${p.n}`);
  for (const r of p.rows) console.log(`  [${r.pass ? "OK" : "NG"}] ${r.label} 期望=${r.want ? "放行" : "P1"} 實際=${r.got ? "放行" : "P1"}${r.why ? `（${r.why.slice(0, 160)}）` : ""}`);
  const d = r19SnapDryRun();
  console.log(`r19-V post-MP25 預留 patch 乾跑（目前 ${snap.mode}；未啟用）：${d.map((x) => `${x.id}=${x.n}`).join("；")} → ${d.every((x) => x.n === 1) ? "OK" : "NG"}`);
  process.exit(p.pass === p.n && d.every((x) => x.n === 1) ? 0 : 1);
}

if (process.argv.includes("--emit-diff")) {
  const CAP = Symbol("r19-capture");
  const runCapture = async (body, extra) => {
    let got = null;
    let r18Body = null;
    let r17Body = null;
    let r16Body = null;
    const r19 = makeR19({
      ...extra,
      onR18Body: (b) => {
        r18Body = b;
      },
      r18Extra: {
        onR17Body: (b) => {
          r17Body = b;
        },
        r17Extra: {
          emitMode: true,
          onR16Body: (b) => {
            r16Body = b;
          },
          r16Extra: {
            capture: (x) => {
              got = { r15Exec: x.r15Exec.text, patchedR14: x.patchedR14.full };
              throw CAP;
            },
          },
        },
      },
    });
    try {
      await new AsyncFunction("__r19", `"use strict";\n${body}`)(r19);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got || !r18Body || !r17Body || !r16Body) throw new Error("emit capture 未取得執行內容");
    return { ...got, r18Body, r17Body, r16Body };
  };
  const baseBody = r19Apply(r18Src, R19_R18_INFRA, "r18(基準)");
  const base = await runCapture(baseBody, { r13Patches: [], r14Patches: [], r15Patches: [], r17Patches: [], r16Patches: [] });
  const mine = await runCapture(r19Body, {});
  const files = {
    r18: R18_FILE,
    r19r18: `${PRE_DIR}/r19.patched-r18.mjs`,
    baseR17: `${PRE_DIR}/r19base.r18-patched-r17.mjs`,
    r19R17: `${PRE_DIR}/r19.patched-r17.mjs`,
    baseR16: `${PRE_DIR}/r19base.r18-patched-r16.mjs`,
    r19R16: `${PRE_DIR}/r19.patched-r16.mjs`,
    baseR15: `${PRE_DIR}/r19base.r18-patched-r15.mjs`,
    r19R15: `${PRE_DIR}/r19.patched-r15.mjs`,
    baseR14: `${PRE_DIR}/r19base.r18-patched-r14.mjs`,
    r19R14: `${PRE_DIR}/r19.patched-r14.mjs`,
    baseExec: `${PRE_DIR}/r19base.r18-exec.mjs`,
    r19Exec: `${PRE_DIR}/r19.r19-exec.mjs`,
  };
  writeFileSync(files.r19r18, `${shebang[0]}${r19Body}`);
  writeFileSync(files.baseR17, `#!/usr/bin/env node\n${base.r18Body}`);
  writeFileSync(files.r19R17, `#!/usr/bin/env node\n${mine.r18Body}`);
  writeFileSync(files.baseR16, base.r17Body);
  writeFileSync(files.r19R16, mine.r17Body);
  writeFileSync(files.baseR15, base.r16Body);
  writeFileSync(files.r19R15, mine.r16Body);
  writeFileSync(files.baseR14, base.patchedR14);
  writeFileSync(files.r19R14, mine.patchedR14);
  writeFileSync(files.baseExec, base.r15Exec);
  writeFileSync(files.r19Exec, mine.r15Exec);
  const same = (a, b) => (existsSync(b) ? (readFileSync(b, "utf8") === a ? "相同" : "不同") : "（缺檔）");
  const diffText = (a, b, la, lb) => {
    try {
      return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail("];
  const TAGS = ["r19-E", "r19-H", "r19-C", "r19-F", "r19-K", "r19-V", "r19 report", "r19：", "phase2-r19", "__r19", "// r19", "r19["];
  const TAG_LABEL = { "r19 report": "r19 報告輸出（只新增輸出）", "r19：": "r19-V（執行需要／掛載點）", "phase2-r19": "r19-V（版本識別）", __r19: "r19-V（執行需要）", "// r19": "r19-V（執行需要）", "r19[": "r19-V（摘要）" };
  const stats = (d) => {
    const lines = d.split("\n");
    const del = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const add = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const by = {};
    for (const l of hit) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
    const hunks = [];
    let cur = null;
    for (const l of lines) {
      if (l.startsWith("@@")) {
        cur = { head: l, add: [], del: [] };
        hunks.push(cur);
      } else if (cur && l.startsWith("+") && !l.startsWith("+++")) cur.add.push(l);
      else if (cur && l.startsWith("-") && !l.startsWith("---")) cur.del.push(l);
    }
    const cls = hunks.map((h) => {
      const tag = TAGS.find((t) => h.add.some((l) => l.includes(t)));
      return `${h.head} → ${tag ? (TAG_LABEL[tag] ?? tag) : "未標記（需人工核對）"}（-${h.del.length} +${h.add.length}）`;
    });
    return { deleted: del.length, added: add.length, hit, by, hunks: hunks.length, cls };
  };
  const d0 = diffText(files.r18, files.r19r18, "scripts/verify-destination-authority-phase2-r18.mjs", "r19 實際執行的 r18（r18＋R19_R18_PATCHES）");
  const d1 = diffText(files.baseR17, files.r19R17, "r18 實際執行的 r17", "r19 實際執行的 r17（再加 R19_R17_PATCHES）");
  const d2 = diffText(files.baseR16, files.r19R16, "r18 實際執行的 r16", "r19 實際執行的 r16（R19_R16_PATCHES；本輪未接受 post-MP25 → 空）");
  const d3 = diffText(files.baseR15, files.r19R15, "r18 實際執行的 r15", "r19 實際執行的 r15（再加 R19_R15_PATCHES）");
  const d4 = diffText(files.baseR14, files.r19R14, "r18 實際執行的 r14", "r19 實際執行的 r14（再加 R19_R14_PATCHES）");
  const d5 = diffText(files.baseExec, files.r19Exec, "r18 實際執行內容（r13＋R14～R18_R13_PATCHES）", "r19 實際執行內容（再加 R19_R13_PATCHES）");
  const parts = [d0, d1, d2, d3, d4, d5];
  const s = parts.map(stats);
  const ids = (a) => a.map((p) => p.id).join("｜");
  const dry = r19SnapDryRun();
  const head = [
    "# r19.diff（A2-MP-T5）",
    `# r18 sha256=${r18Want}（已驗證，scratchpad/pre-MP5T-test-sha.txt）；r17／r16／r15／r14／r13 由 r18／r17／r16／r15／r14 驗證 sha`,
    `# 基準一致性（r19 基準＝r18 原文＋R19_R18_INFRA、R19 patch 陣列皆空）：r17 層 vs scratchpad/r18.patched-r17.mjs＝${same(`${shebang[0]}${base.r18Body}`, `${PRE_DIR}/r18.patched-r17.mjs`)}；r16 層 vs r18.patched-r16.mjs＝${same(base.r17Body, `${PRE_DIR}/r18.patched-r16.mjs`)}；r15 層 vs r18.patched-r15.mjs＝${same(base.r16Body, `${PRE_DIR}/r18.patched-r15.mjs`)}；r14 層 vs r18.patched-r14.mjs＝${same(base.patchedR14, `${PRE_DIR}/r18.patched-r14.mjs`)}；執行內容 vs r18.r18-exec.mjs＝${same(base.r15Exec, `${PRE_DIR}/r18.r18-exec.mjs`)}`,
    `# work sha 快照：${snap.mode}；post-MP25 預留 patch 乾跑：${dry.map((x) => `${x.id}=${x.n}`).join("；")}`,
    `# 第 0 部分：r18 原文 → r19 實際執行的 r18（R19_R18_PATCHES ${R19_R18_PATCHES.length} 個）：${ids(R19_R18_PATCHES)}`,
    `# 第 1 部分：r17 層（R19_R17_PATCHES ${R19_R17_PATCHES.length + snap.r17.length} 個）：${ids([...R19_R17_PATCHES, ...snap.r17])}`,
    `# 第 2 部分：r16 層（R19_R16_PATCHES ${snap.r16.length} 個）`,
    `# 第 3 部分：r15 層（R19_R15_PATCHES ${R19_R15_PATCHES.length} 個）：${ids(R19_R15_PATCHES)}`,
    `# 第 4 部分：r14 層（R19_R14_PATCHES ${R19_R14_PATCHES.length} 個）：${ids(R19_R14_PATCHES)}`,
    `# 第 5 部分：r13 執行內容（R19_R13_PATCHES ${R19_R13_PATCHES.length} 個）：${ids(R19_R13_PATCHES)}`,
    ...s.map((x, i) => `#   第${i}部分 hunk=${x.hunks} 刪除行=${x.deleted} 新增行=${x.added}；刪除行含 ${KEYS.join("／")} = ${x.hit.length} ${JSON.stringify(x.by)}`),
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l}`)),
    "# 逐 hunk 歸類：",
    ...s.flatMap((x, i) => x.cls.map((c) => `#   [第${i}部分] ${c}`)),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r19.diff`, `${head.join("\n")}\n${parts.map((d, i) => `######## 第 ${i} 部分 ########\n${d}`).join("\n")}`);
  // 契約差異（r19＋mp25-r2）
  let mp25Changes = [];
  try {
    const m = await import(`${WORK_ROOT}/${MP25_R2}`);
    mp25Changes = m.CHANGES ?? [];
  } catch (e) {
    mp25Changes = [{ no: "-", old: `（無法載入 mp25-r2：${String(e?.message ?? e).slice(0, 80)}）`, neu: "", why: "", fix: "" }];
  }
  const md = [
    "# r19 契約差異（A2-MP-T5；由 r19 --emit-diff 產生）",
    "",
    "## r19（相對 r18）",
    "",
    "| 項目 | 舊 | 新 | 理由 | 裁決 |",
    "|---|---|---|---|---|",
    ...R19_CONTRACT.map((r) => `| ${r.map((x) => String(x).replace(/\|/g, "／")).join(" | ")} |`),
    "",
    `r19.diff 刪除行含 ${KEYS.join("／")}：${s.map((x, i) => `第${i}部分=${x.hit.length}`).join("、")}`,
    "",
    "## Pending 例外允許欄位",
    "",
    ...R19_PENDING_ALLOWED.map((k) => `- ${k}${R19_PENDING_REQUIRED.includes(k) ? "（必填）" : "（可選）"}`),
    "",
    "## mp25-r2（相對 mp25）：舊 → 新 → 理由 → 修正編號",
    "",
    "| # | 舊 | 新 | 理由 | 修正編號 |",
    "|---|---|---|---|---|",
    ...mp25Changes.map((c) => `| ${[c.no, c.old, c.neu, c.why, c.fix].map((x) => String(x ?? "").replace(/\|/g, "／")).join(" | ")} |`),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r19-contract-diff.md`, md.join("\n"));
  console.log(`wrote ${PRE_DIR}/r19.diff、${PRE_DIR}/r19-contract-diff.md`);
  console.log(head.join("\n"));
  process.exit(0);
}

if (!IS_CHILD) {
  const d = r19SnapDryRun();
  if (!d.every((x) => x.n === 1)) {
    console.log(`INFRA-FAIL r19-V post-MP25 預留 patch 錨點：${d.map((x) => `${x.id}=${x.n}`).join("；")}`);
    process.exit(1);
  }
}
await new AsyncFunction("__r19", `"use strict";\n${r19Body}`)(makeR19({}));
