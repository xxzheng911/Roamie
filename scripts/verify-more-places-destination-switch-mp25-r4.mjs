#!/usr/bin/env node
/**
 * verify-more-places-destination-switch-mp25-r4（A2-MP-T9，tester）：MP-25「換目的地驗證失敗」失敗測試第 4 版（施工前預期 work FAIL）。
 * 舊版 mp25、mp25-r2、mp25-r3 保留不改；本檔以 mp25-r3 為基礎，只修正 A2-MP-T8 獨立驗收指出的測試問題（逐條見 CHANGES／--emit-diff），
 * 並依 A2-MP-T8 後使用者正式裁決調整；另補偵測器自我測試（--self-test，亦在每次報告前自動執行）與負向探針。
 *
 * 契約（使用者原文＋A2-MP-T4／T6／T8 後裁決）：同 mp25-r3，另：
 *   裁決 1  Pending 必須恰為 kind="destination_switch"、rawGeographicLabel、previousConfirmedDestination、categoryIntent、
 *           originatingRoute="more_places"、originalUserText、confirmationAttempts、parentIntent="place_recommendation"（缺少／其他值 → 不 PASS）。
 *   裁決 2  originalUserText 上限 4000（既有 ChatRequest.chatInput；service.server.ts L67）。★ 相對原版 r19（500 字）的測試契約放寬（唯一授權）。
 *   裁決 3  同一 Pending 最多驗證 2 次，含切換當輪初次驗證（切換 1＋明確確認 1）。
 *   裁決 4  達上限後可顯示說明文字（可含問號），但不得重複確認請求、不得重新驗證、不得扣點 → 詢問次數依「確認行為」計算，不依問號／文案。
 *   裁決 5  情境 18 不降級。
 *
 * 判定定義（r4；皆依 Session／Provider／Credits 行為，可機器檢查）：
 *   地名比對  Ks(s)＝字串中「所有」候選地名（PLACE_KEYS＋既有別名表 DESTINATION_ALIAS_RECORDS 詞彙），每個命中經既有 canonical identity
 *            （src/lib/ai/destination-alias-resolver.ts resolveDestinationAlias(x).normalizedName；金沢＝金澤）。K(s)＝Ks(s)[0]（r3 單值欄位相容）。
 *            V(d)／geoAll(d)：geocode 查詢字串的「所有」候選含 d 即計入（「大阪了換金澤」同時計入大阪與金澤）。
 *   identity  [kind, canonical(rawGeographicLabel), previousConfirmedDestination, categoryIntent, originatingRoute]。
 *   驗證歸屬  本輪 V(金澤) 歸屬：輪末 Pending 是本輪新寫入（identity ≠ 輪初）且 raw＝金澤 → 輪末 identity；否則輪初 Pending（raw＝金澤）→ 輪初 identity；
 *            否則輪末 Pending（raw＝金澤）；都沒有（無 Pending 的樹）→ 以輪初情境推得的 identity（destination_switch／金澤／輪初 rec 或 travelContext 目的地／
 *            輪初 activeCategoryIntent／more_places）。同一 identity 至確認成功為止驗證 ≤2；不同 identity 分開計算。
 *   確認請求  輪末 Session 持有 destination_switch Pending（identity X）＋本輪有新助理訊息＋本輪無卡片，且
 *            （X 驗證次數〔本輪前〕< 上限 2）→ X 的確認請求 +1；> 3 → SAFETY。
 *            X 驗證次數已達上限時：若本輪「再次推進確認流程」（本輪又驗證 X、confirmationAttempts 增加、或 Pending 被新寫入／改寫）→ SAFETY（重複確認）；
 *            只是原樣保留 Pending（不驗證、不推進、不改寫）＋說明文字（可含問號）→ 不算確認請求（列 INFO：達上限後保留輪數）。
 *   attempts  同一 identity：不得小於歷史最大值（重建不得歸零）、不得少於已執行的確認輪驗證數、一輪最多 +1；新 identity 建立輪 ≤1。
 *   原句      輪初同一 Pending：與建立輪原句比對（情境內可知）；建立輪未知（Client 注入的 Pending）→ fail-closed 絕對檢查（座標／範圍字樣／
 *            raw、previousConfirmedDestination 以外的城市／長度）；本輪新寫入：＝本輪原句。
 *
 * A2-MP-T18（施工前失敗測試；使用者正式授權；逐條見 CHANGES #16～#24）：
 *   M1 嚴格上限（06 系列；使用者裁決）：同一 identity 在「本輪開始時」已達任一上限（驗證 ≥2、confirmationAttempts ≥2、確認詢問 ≥3）→
 *           本輪不得自動驗證（含進入該 identity 的 trust／驗證入口＝嚴格選項）、不得再次要求確認（不計確認請求）、不得增加 confirmationAttempts、
 *           不得改寫 Pending、不得呼叫 Places／Builder／Weather、不得開始 Credits；可以原樣保留 Pending＋非詢問式說明（INFO：達上限後保留輪數）。
 *           明確重新指定（繼續京都／取消／換大阪…）不套用（M1_EXEMPT_KINDS）。確認請求計數只在三個上限皆未達時 +1（原 L589 只看驗證次數）。
 *           自我測試 D1（hold ×3）依裁決改判「不觸發」；新增 D1c～D1h 負向探針（達詢問上限後回「好」再呼叫 Provider → SAFETY 等）。
 *   類似語句（S8）：「大阪不去了，換金澤」「不要去大阪，改金澤」「不想去大阪了，換成金澤」「…，再推薦幾個」：被否定的大阪不得送 Provider／寫 Session、
 *           不得重置京都推薦池與類別（keepPool）、Pending raw 與驗證查詢字串必須是乾淨地名（exactRaw）；對照：正常換城市、新行程、同城行政區（C2）。
 *   時間與快取（S9）：情境欄位 r21ClockByTurn（r21-C；鍵＝turnIndex，0 起算，同 r18GeoByTurn；值＝毫秒；該輪開始前累加到子程序 Date.now，不實際等待）；
 *           turnExpect：本輪 V(金澤) 次數與 attempts 增量依正式 chat-turn-destination.ts 契約（TRANSIENT_RETRY_MS＝15000；ZERO_RESULTS＝providerResult.ok=false
 *           → transientCityFailures（transient，不進 clean-miss 快取）；Provider 正常回答但行政區不符 → unavailableCityKeys（cached miss，之後不再送出））。
 *
 * A2-MP-T24（使用者裁決 3；CHANGES #25）：18b～18d（沒有「再推薦幾個」續推尾巴）不強制走 more_places，依既有一般目的地切換流程：
 *           expect＝[origin, negSwitch, negSwitchYes]；有 destination_switch Pending 時照舊以 switchFail／confirmNew 嚴格判定（resolveKind）。
 *           只驗證正確目的地、無錯誤 Reset、無錯誤 Provider 查詢、無未確認扣點；otherCity／exactRaw／keepPool／S8 與全輪條件不變。18、18e、06／T／C2 系列不變。
 *
 * A2-MP-T25（使用者裁決 1；CHANGES #26）：「冷卻後確認成功」情境 05、09（reloadAfter）、18、18e 在確認輪（index 2）前以 r21ClockByTurn 前進 16 秒
 *           （TRANSIENT_RETRY_MS＝15000；不實際等待、不改正式常數）。18b～18d 於新 Source 探測 work T2 無 destination_switch Pending → 不套用。
 *           cooldown 內立即確認、T1、Provider timeout、ZERO_RESULTS、cached miss、達上限（06 系列、T7／T7b）不套用。確認成功安全斷言與 keepPool 不變。
 *
 * A2-MP-T40（使用者契約 (一)(二)；CHANGES #28～#33）：
 *   (一) 新增 MP25R4-NM-nomore-yes-alt（正常 noMore → 好 → 替代推薦；r15Init 京都池已用完＋r15EmptyDest 只清空景點類查詢）：noMoreOffer／altYes；
 *        「好」必須進入正式 Callback（r14-Δ4 alternative_recommendations(real)），否則 MODEL＝UNVERIFIED（不得 PASS）。ITEMS ＋NM。
 *   (二) negSwitchYes 無卡片且金澤未確認分支：刪除「既未切換、也未保留金澤切換意圖 → FEATURE」（與「沒有明確續推要求時不強制建立 Pending」直接衝突），
 *        保留「有 Pending 但不是金澤 → FEATURE」；另加不得替代推薦提問／京都以外 Places／Builder；模型路徑明確記 MODEL。其他 SAFETY／P1 斷言不變。
 *
 * A2-MP-T42（獨立審查 T41 必改 M2／M3、建議 S1；CHANGES #34～#38）：
 *   M2 report 項目列把 SF.model（模型「未重建」路徑輪）計入 UNVERIFIED（原本 0 失敗的模型輪被列 PASS）；★ 項目 15、16 work 由 PASS 變 UNVERIFIED（加嚴）。FAIL 判定不變。
 *   M3 negSwitchYes 無卡片＋金澤未確認：補 Session 地理投影／activeCategoryIntent／京都推薦 Context／非 RPC 寫入／Weather／助理回覆檢查（分類比照 N2／N3／N5）。
 *   S1 altYes：path 含「未重建」也記 MODEL（混合 path）。
 *
 * A2-MP-T46（使用者裁決 (三)；CHANGES #39～#42）：noMore Credits 契約（noMoreOffer／altYes）：
 *   無有效新卡片 → 允許 reserve → rollback，條件＝沒有 commit、rollback 恰好一次、未結算 reserve＝0（另：reserve 至多 1、無孤立結算）；
 *   有有效卡片 → 依既有 Credits 契約 commit（reserve 1 → commit 1、rollback 0）。reserve 本身不得視為已完成的扣點。違反 → SAFETY（同 creditsFails）。
 *   creditsFails 與其他既有斷言不變（只新增）。自我測試 NM9～NM9i。
 *
 * A2-MP-T52（任務單 #52；CHANGES #43～#45）：Credits Reservation 時序斷言 creditsOrderFails（所有輪；只新增）：
 *   結算早於 reserve、同一筆 reservation 結算 2 次、重複 commit、重複 rollback、沒有 reservation 的結算、reserve 前沒有尚未使用的 credits_check → SAFETY [20]。
 *   ledger_id 一致＝UNVERIFIED（creditsRpc 只有 name）。自我測試 CO-L1～CO-L5（合法）、CO-R2～CO-R7c（違規）。
 *
 * A2-MP-T56（任務單 #56；T55 審查 REQUEST CHANGES；CHANGES #46～#50；只加嚴或更正說明）：
 *   規則 7 加嚴：同一輪 credits_reserve 次數 > 本輪 begin 次數（t.r15Credits.length；r15 L844）→ SAFETY [20]「Credits 時序：」；check 配對規則保留。
 *           CO-R7d（C,C,R,R,RB,CM）／CO-R7e（C,R,RB,C,R,CM）於 begin 1、settle [true]、1 張卡片：creditsFails＝0、新規則觸發、SAFETY。CO-L4／CO-L5（begin 2）仍 0 失敗。
 *   規則 2／3 歸類：結算時已有已結算 reservation、但之後仍有 reserve（例 C,R,CM,C,CM,R）→ 訊息並列「同一筆結算 2 次，或結算早於後續 reserve」；仍 SAFETY，觸發不減。
 *   規則 1（R1 ledger_id 一致）＝UNVERIFIED：r14 L441 有記錄 args（含 p_ledger_id），L443 Mock 發出不重複 ledger_id，但每輪只輸出 RPC name；
 *           要驗證需修改 Harness，不在授權範圍內。名稱層級盲點：C,R,C,R,RB,RB（begin 2、settle [false,false]、無卡片）可能是同一筆被 rollback 兩次、
 *           另一筆從未結算，一般輪現行所有斷言都判 PASS（noMore 輪僅因 reserve≤1 間接擋下；自我測試 CO-U1 記錄此盲點；--self-test 與 report 輸出 UNVERIFIED 行）。本檔沒有抓到這種情況。
 *
 * 機制：不自建 Harness；以 r21（--extra-scenarios=本檔）執行（r21 → r20 → r19 → … → r13）。canonical 由 r21 主程序以 vite-node 載入正式模組後提供
 *   （globalThis.__R21_CANON_INFO）；--self-test 單獨執行時本檔以同一方式自行載入。
 *
 * 執行（每次只跑一份）：
 *   node scripts/verify-more-places-destination-switch-mp25-r4.mjs [--conc=N] [--out=<scratchpad>/x.log] [--with-r21-subset]
 *       （＝ node scripts/verify-destination-authority-phase2-r21.mjs --brief --a2 --mp1 --only=<ids> --extra-scenarios=本檔 --out=<scratchpad>/mp25-r4.log）
 *   node scripts/verify-more-places-destination-switch-mp25-r4.mjs --self-test [--out=…]   （偵測器自我測試；預設 scratchpad/mp25-r4-selftest.log）
 *   node scripts/verify-more-places-destination-switch-mp25-r4.mjs --emit-diff              （寫 scratchpad/mp25-r4.diff）
 * 所有輸出模式：只能寫 scratchpad，拒絕覆蓋任何既有檔案（明列舊 log＋啟動時所有 *.log／*.stdout＋已存在的目標檔）。
 */
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R21 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r21.mjs`;
const OLD = `${WORK_ROOT}/scripts/verify-more-places-destination-switch-mp25-r3.mjs`;

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
  validatePerPending: 2, // Q3：同一 Pending（identity）最多驗證 2 次（切換輪 1＋明確確認 1；裁決 3）
  asksPerPending: 3, // Q4：同一 Pending（identity）最多確認請求 3 次（依確認行為計算；裁決 4）
  attemptsCap: 2, // A2-MP-T18（M1）：confirmationAttempts ≥2 即達上限（與驗證 ≥2、詢問 ≥3 任一成立）
};
/** A2-MP-T18（M1）：明確重新指定／對照類輪次（使用者可明確重新指定；不套用「達上限後不得搜尋」的 M1 成本檢查）。 */
const M1_EXEMPT_KINDS = ["origin", "ref", "same", "chooseOld", "oldMore", "cancel", "noRevive", "replace", "forgedPrevKeep", "forgedPrevCancel", "newTrip", "sameCityArea"];
/** A2-MP-T18（S8 exactRaw）：Pending rawGeographicLabel／驗證查詢字串允許的乾淨寫法（金澤 record 的地名寫法；不得是「成金澤」「大阪了換金澤再」之類片段）。 */
const KZ_RAW_OK = ["金澤", "金沢", "金泽", "Kanazawa", "金澤市", "金沢市"];
const T2_NEG_B = "大阪不去了，換金澤";
const T2_NEG_C = "不要去大阪，改金澤";
const T2_NEG_D = "不想去大阪了，換成金澤";
const T2_NEG_E = "不想去大阪了，換成金澤，再推薦幾個";
/** 情境 Fixture：京都東山（與 verify-more-places-cross-destination.mjs HIGASHIYAMA 相同；只在本檔情境子程序有效）。 */
const HIGASHIYAMA = { 京都東山: { placeId: "mock-京都市東山區", country: "日本", city: "京都市", region: "京都市", district: "東山區", lat: 34.99, lng: 135.78, formattedName: "京都市東山區", displayLabel: "京都市東山區" } };
/** 情境 Fixture（cached miss）：查詢「金澤」時 Provider 正常回答（OK、locality、JP），但行政區是富山市 → providerAdministrativeMatch 不符 → unavailableCityKeys。 */
const KZ_ADMIN_MISMATCH = { 金澤: { placeId: "mock-富山市", country: "日本", city: "富山市", region: "富山縣", lat: 36.6953, lng: 137.2113, formattedName: "富山市", displayLabel: "富山市" } };
const CT = "chat-turn-destination.ts validateCityCandidateCenter";
/**
 * A2-MP-T40（使用者契約 (一)）：正常 noMore → 好 → 替代推薦。初始 Session＝京都推薦池 3 筆、已全部顯示（r15Init；同情境 14 的 r15 buildInit 機制）。
 * r15EmptyDest（既有 r15-X 欄位：searchPlaces 的 destinationName 或 query 含任一字串 → 回空）只列「景點類」查詢關鍵字 →
 * 續推（attraction：src/lib/ai/destination-place-recommendation.ts buildMorePlacesFallbackQueries L1540-1549 景點／室內景點／attractions／hidden gems）全部回空 → noMore；
 * 替代推薦（同檔 L690-700：美食 餐廳／咖啡廳／餐廳／咖啡／博物館；「室內景點」含「景點」同樣回空）仍有結果。不含「京都」→ 京都目的地本身不被清空。
 */
const INIT_KYOTO_EXHAUSTED = { topic: "attraction", rec: { destination: "京都", n: 3, batch: 3 }, travelDestination: "京都" };
const NM_EMPTY_Q = ["景點", "attractions", "sightseeing", "hidden gems", "landmarks", "地標", "必去", "must visit", "scenic", "古蹟", "觀光"];
/** A2-MP-T40：E2f 的 destinationSwitchStopped 文案（src/lib/i18n/chat-runtime.ts L35-36 zh；固定片段）。 */
const STOPPED_RE = /這次先停在這裡，不會搜尋也不會扣點|this time I'll stop here|I(?:'|’)ll stop here/i;

/**
 * expect[turnIndex]＝該輪的行為類型（r3 全部保留）：
 *   origin / switchFail / hold / chooseOld / oldMore / confirmNew / newMore / confirmFail / confirmCapped / idle / cancel / noRevive / replace / same /
 *   forgedHold / forgedOk / forgedPrevKeep / forgedPrevCancel / forgedPrevYes / forgedPrevHold / ref / rebuildCapped
 *   negSwitch / negSwitchYes（A2-MP-T24；18b～18d；resolveKind 依 Pending 有無改判 switchFail／confirmNew 或一般流程）
 */
const NEW_SCENARIOS = [
  { case: 1, items: [1], id: "MP25R4-01-switch-fail-timeout", label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider timeout）", turns: [T1, T2], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail"] },
  { case: 2, items: [3, 1], id: "MP25R4-02-fail-then-more", label: "… → 換金澤（timeout）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 2, items: [3, 20], id: "MP25R4-02b-fail-then-more-fault", label: "… → 換金澤（timeout）→ 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback；Callback 未被呼叫 → 故障檢查 N/A］", turns: [T1, T2, FAULT_MORE], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 3, items: [4, 1], id: "MP25R4-03-fail-then-cheaper", label: "… → 換金澤（timeout）→ 便宜一點的", turns: [T1, T2, "便宜一點的"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"] },
  { case: 4, items: [5], id: "MP25R4-04-choose-kyoto", label: "… → 換金澤（timeout）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "chooseOld", "oldMore"] },
  { case: 5, items: [6, 2], id: "MP25R4-05-confirm-kanazawa-yes", label: "… → 換金澤（timeout）→（+16 秒）好（Provider 成功）→ 再推薦幾個", turns: [T1, T2, "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew", "newMore"] }, // A2-MP-T25：可控時間：冷卻後確認（使用者裁決 1）
  { case: 5, items: [6], id: "MP25R4-05b-confirm-kanazawa-echo", label: "… → 換金澤（timeout）→（+16 秒）金澤（Provider 成功）", turns: [T1, T2, "金澤"], r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew"] }, // A2-MP-T26：可控時間：冷卻後確認（使用者裁決 4）
  { case: 6, items: [7, 11, 2], id: "MP25R4-06-confirm-timeout-again", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（timeout）→ 再推薦幾個", turns: [T1, T2, "好", "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "idle"] },
  { case: 6, items: [7, 10, 11, 2], id: "MP25R4-06b-confirm-timeout-repeat", label: "… → 換金澤（timeout）→ 好 ×4（皆 timeout）", turns: [T1, T2, "好", "好", "好", "好"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout", 5: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "confirmCapped", "confirmCapped"] },
  { case: 7, items: [8, 3], id: "MP25R4-07-switch-fail-null", label: "… → 換金澤（Provider null）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "null" }, expect: ["origin", "switchFail", "hold"] },
  { case: 7, items: [8, 2], id: "MP25R4-07b-confirm-null-again", label: "… → 換金澤（null）→ 好（null）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "null", 2: "null" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 8, items: [9, 3], id: "MP25R4-08-switch-fail-zero", label: "… → 換金澤（ZERO_RESULTS）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], r18GeoByTurn: { 1: "zero" }, expect: ["origin", "switchFail", "hold"] },
  { case: 8, items: [9, 2], id: "MP25R4-08b-confirm-zero-again", label: "… → 換金澤（ZERO_RESULTS）→ 好（ZERO_RESULTS）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "zero", 2: "zero" }, expect: ["origin", "switchFail", "confirmFail"] },
  { case: 9, items: [15, 6, 2], id: "MP25R4-09-reload-confirm", label: "… → 換金澤（timeout）→（重新載入）→（+16 秒）好（Provider 成功）", turns: [T1, T2, "好"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew"], restoredAt: 2 }, // A2-MP-T25：可控時間：冷卻後確認（使用者裁決 1）
  { case: 9, items: [15, 3], id: "MP25R4-09b-reload-more", label: "… → 換金澤（timeout）→（重新載入）→ 再推薦幾個", turns: [T1, T2, "再推薦幾個"], reloadAfter: 1, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "hold"], restoredAt: 2 },
  { case: 10, items: [15], id: "MP25R4-10-cancel-reload", label: "… → 換金澤（timeout）→ 不用了 →（重新載入）→ 好", turns: [T1, T2, "不用了", "好"], reloadAfter: 2, r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "cancel", "noRevive"] },
  { case: 11, items: [16], id: "MP25R4-11-replace-osaka", label: "… → 換金澤（timeout）→ 換大阪，再推薦幾個（Provider 成功）→ 好", turns: [T1, T2, "換大阪，再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "switchFail", "replace", "noRevive"] },
  { case: 12, items: ["C1"], id: "MP25R4-12-same-kyoto", label: "（對照）京都推薦景點 → 再推薦幾個 → 再推薦幾個", turns: [T1, "再推薦幾個", "再推薦幾個"], expect: ["origin", "same", "same"] },
  { case: 12, items: ["C1", 20], id: "MP25R4-12b-same-kyoto-fault", label: "（對照）京都推薦景點 → 再推薦幾個［續推 Callback 拋錯 → catch → applyLocalFallback → 正式 fallback continue］", turns: [T1, FAULT_MORE], expect: ["origin", "same"], requireFbContinue: [1] },
  { case: 14, items: [12, 2], id: "MP25R4-14-forged-pending-timeout", label: "（Session 恢復：rec=京都＋Client 保存的 destination_switch pending=金澤）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  { case: 14, items: [12, 2], id: "MP25R4-14b-forged-pending-ok", label: "（同上）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED, expect: ["forgedOk"] },
  { case: 14, items: [13], id: "MP25R4-14c-forged-prev-keep", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 繼續原本的", turns: ["繼續原本的"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevKeep"] },
  { case: 14, items: [13], id: "MP25R4-14d-forged-prev-cancel", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 不用了", turns: ["不用了"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevCancel"] },
  { case: 14, items: [13, 2], id: "MP25R4-14e-forged-prev-yes", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider 成功）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, expect: ["forgedPrevYes"] },
  { case: 14, items: [13, 2], id: "MP25R4-14f-forged-prev-timeout", label: "（rec=京都＋Client pending previousConfirmedDestination=大阪）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_PREV, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedPrevHold"] },
  { case: 14, items: [12, 2], id: "MP25R4-14g-forged-fields-timeout", label: "（rec=京都＋Client pending 夾帶 center／searchScope／radius／confirmedParentCity）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_FIELDS, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"] },
  { case: "REF", items: [6], id: "MP25R4-REF-switch-ok", label: "（基準：既有推薦流程）京都推薦景點 → 換金澤，再推薦幾個（Provider 成功）", turns: [T1, T2], expect: ["origin", "ref"] },
  { case: 6, items: [10, 11, "S1", "S2"], id: "MP25R4-06c-rebuild-same-input", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 換金澤，再推薦幾個 ×2（相同輸入重建；皆 timeout）", turns: [T1, T2, "好", "好", T2, T2], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout", 4: "timeout", 5: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "rebuildCapped", "rebuildCapped"] },
  { case: 11, items: [16, 10, 11], id: "MP25R4-06d-capped-then-osaka", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 換大阪，再推薦幾個（Provider 成功；明確重新指定）", turns: [T1, T2, "好", "好", "換大阪，再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "replace"] },
  { case: 4, items: [5, 11], id: "MP25R4-06e-capped-then-kyoto", label: "… → 換金澤（timeout）→ 好（timeout）→ 好（達上限）→ 繼續京都 → 再推薦幾個", turns: [T1, T2, "好", "好", "繼續京都", "再推薦幾個"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "timeout" }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped", "chooseOld", "oldMore"] },
  { case: 14, items: [13], id: "MP25R4-14h-forged-prev-kyoto-session-osaka", label: "（rec=大阪＋Client pending previousConfirmedDestination=京都）→ 繼續原本的（不得因 Pending 把京都當可信）", turns: ["繼續原本的"], r15Init: INIT_OSAKA, r18Pending: FORGED, trusted: "大阪", forgedPrev: "京都", expect: ["forgedPrevKeep"] },
  { case: 14, items: [17, 12, 2], id: "MP25R4-14j-forged-category-timeout", label: "（rec=京都、activeCategoryIntent=attraction＋Client pending categoryIntent=cafe）→ 好（Provider timeout）", turns: ["好"], r15Init: INIT_KYOTO, r18Pending: FORGED_CAT, r18GeoByTurn: { 0: "timeout" }, expect: ["forgedHold"], pendCat: "cafe" },
  { case: 18, items: [14, 6, 2], id: "MP25R4-18-original-text-other-city", label: "京都推薦景點 → 不去大阪了，換金澤，再推薦幾個（timeout）→（+16 秒）好（Provider 成功）［不降級：查詢字串所有候選地名皆檢查］", turns: [T1, T2_OTHER, "好"], r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew"], otherCity: "大阪" }, // A2-MP-T25：可控時間：冷卻後確認（使用者裁決 1）
  // ── A2-MP-T18：類似語句（S8；被否定的大阪；Kyoto＝輪初可信城市；金澤 T2 timeout → T3「好」Provider 成功）──
  { case: 18, items: [14, 6, 2, "S8"], id: "MP25R4-18b-neg-osaka-bukyo", label: "京都推薦景點 → 大阪不去了，換金澤（timeout）→ 好（Provider 成功）［A2-MP-T18 類似語句］", turns: [T1, T2_NEG_B, "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "negSwitch", "negSwitchYes"], otherCity: "大阪", exactRaw: true, keepPool: [1] }, // A2-MP-T24：路由期望調整（使用者裁決 3；不強制 more_places）
  { case: 18, items: [14, 6, 2, "S8"], id: "MP25R4-18c-neg-osaka-buyao", label: "京都推薦景點 → 不要去大阪，改金澤（timeout）→ 好（Provider 成功）［A2-MP-T18 類似語句］", turns: [T1, T2_NEG_C, "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "negSwitch", "negSwitchYes"], otherCity: "大阪", exactRaw: true, keepPool: [1] }, // A2-MP-T24：路由期望調整（使用者裁決 3；不強制 more_places）
  { case: 18, items: [14, 6, 2, "S8"], id: "MP25R4-18d-neg-osaka-huancheng", label: "京都推薦景點 → 不想去大阪了，換成金澤（timeout）→ 好（Provider 成功）［A2-MP-T18 類似語句；「換成」不得切出「成金澤」］", turns: [T1, T2_NEG_D, "好"], r18GeoByTurn: { 1: "timeout" }, expect: ["origin", "negSwitch", "negSwitchYes"], otherCity: "大阪", exactRaw: true, keepPool: [1] }, // A2-MP-T24：路由期望調整（使用者裁決 3；不強制 more_places）
  { case: 18, items: [14, 6, 2, "S8"], id: "MP25R4-18e-neg-osaka-huancheng-more", label: "京都推薦景點 → 不想去大阪了，換成金澤，再推薦幾個（timeout）→（+16 秒）好（Provider 成功）［A2-MP-T18 類似語句＋續推語］", turns: [T1, T2_NEG_E, "好"], r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew"], otherCity: "大阪", exactRaw: true, keepPool: [1] }, // A2-MP-T25：可控時間：冷卻後確認（使用者裁決 1）
  // ── A2-MP-T18：對照（C2；既有行為必須保留）──
  { case: "C2", items: ["C2"], id: "MP25R4-C2a-replace-osaka-direct", label: "（對照）京都推薦景點 → 改去大阪推薦景點（Provider 成功；正常換城市，大阪未被否定）", turns: [T1, "改去大阪推薦景點"], expect: ["origin", "replace"] },
  { case: "C2", items: ["C2"], id: "MP25R4-C2b-new-trip-osaka", label: "（對照）京都推薦景點 → 幫我規劃大阪三天（新行程；既有 city_changed 重置保留）", turns: [T1, "幫我規劃大阪三天"], expect: ["origin", "newTrip"] },
  { case: "C2", items: ["C2"], id: "MP25R4-C2c-same-city-area", label: "（對照）京都推薦景點 → 換京都東山，再推薦幾個（同城市行政區；既有行為＝cross-destination MP-05g：不沿用京都城市池；施工前實測為 Fail Closed＋Pending）", turns: [T1, "換京都東山，再推薦幾個"], r15Real: HIGASHIYAMA, expect: ["origin", "sameCityArea"] },
  // ── A2-MP-T18：時間與快取（S9；r21ClockByTurn＝子程序 Date.now 偏移，不實際等待）──
  { case: "T", items: ["S9", 7], id: "MP25R4-T1-cooldown-within", label: "… → 換金澤（timeout）→ 好（不前進時間：15 秒冷卻內；本輪 Provider 若被呼叫會成功）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "timeout", 2: "ok" }, expect: ["origin", "switchFail", "confirmFail"], turnExpect: { 2: { v: 0, attemptsDelta: 0, why: `${CT}：transientCityFailures 15 秒內＝provider_cooldown（不送出；attempts 不增加）` } } },
  { case: "T", items: ["S9", 6], id: "MP25R4-T2-cooldown-elapsed-ok", label: "… → 換金澤（timeout）→（+16 秒）好（Provider 成功）→ 再推薦幾個", turns: [T1, T2, "好", "再推薦幾個"], r18GeoByTurn: { 1: "timeout" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmNew", "newMore"], turnExpect: { 2: { v: 1, why: `${CT}：冷卻結束後重試 1 次` } } },
  { case: "T", items: ["S9", 7, "S7"], id: "MP25R4-T3-cooldown-elapsed-fail-then-cap", label: "… → 換金澤（timeout）→（+16 秒）好（timeout：Provider 真正失敗）→（+16 秒）好（達上限；本輪 Provider 若被呼叫會成功）", turns: [T1, T2, "好", "好"], r18GeoByTurn: { 1: "timeout", 2: "timeout", 3: "ok" }, r21ClockByTurn: { 2: 16000, 3: 16000 }, expect: ["origin", "switchFail", "confirmFail", "confirmCapped"], turnExpect: { 2: { v: 1, attemptsDelta: 1, why: `${CT}：冷卻後重試＝provider_attempted_failure → attempts +1` }, 3: { v: 0, attemptsDelta: 0, why: "M1：驗證 2／attempts 2 已達上限 → 不得再驗證" } } },
  { case: "T", items: ["S9", 9], id: "MP25R4-T4-zero-within", label: "… → 換金澤（ZERO_RESULTS）→ 好（不前進時間；本輪 Provider 若被呼叫會成功）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "zero", 2: "ok" }, expect: ["origin", "switchFail", "confirmFail"], turnExpect: { 2: { v: 0, attemptsDelta: 0, why: `${CT}：ZERO_RESULTS 的 providerResult.ok=false → transientCityFailures（transient，不進 unavailableCityKeys）→ 15 秒內 provider_cooldown` } } },
  { case: "T", items: ["S9", 9], id: "MP25R4-T5-zero-elapsed", label: "… → 換金澤（ZERO_RESULTS）→（+16 秒）好（ZERO_RESULTS）", turns: [T1, T2, "好"], r18GeoByTurn: { 1: "zero", 2: "zero" }, r21ClockByTurn: { 2: 16000 }, expect: ["origin", "switchFail", "confirmFail"], turnExpect: { 2: { v: 1, attemptsDelta: 1, why: `${CT}：ZERO_RESULTS 為 transient → 冷卻後重試 1 次＝provider_attempted_failure → attempts +1` } } },
  { case: "T", items: ["S9"], id: "MP25R4-T6-cached-miss", label: "… → 換金澤（Provider 正常回答但行政區＝富山市）→ 好 →（+16 秒）好", turns: [T1, T2, "好", "好"], r15Real: KZ_ADMIN_MISMATCH, r21ClockByTurn: { 3: 16000 }, expect: ["origin", "switchFail", "confirmFail", "confirmFail"], turnExpect: { 2: { v: 0, attemptsDelta: 0, why: `${CT}：unavailableCityKeys（clean miss）＝provider_cached_miss（不送出；attempts 不增加）` }, 3: { v: 0, attemptsDelta: 0, why: `${CT}：clean-miss 快取不隨時間失效` } } },
  { case: "T", items: ["S7", 10, "S1"], id: "MP25R4-T7-asks-cap-then-yes", label: "… → 換金澤（timeout）→ 再推薦幾個 → 再推薦幾個（詢問達上限 3；驗證 1、attempts 1）→ 好（不前進時間）", turns: [T1, T2, "再推薦幾個", "再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout", 4: "ok" }, expect: ["origin", "switchFail", "hold", "hold", "confirmCapped"], turnExpect: { 4: { v: 0, attemptsDelta: 0, why: "M1（裁決 5）：詢問已達上限 3 → 不得再驗證、不得增加 attempts" } } },
  { case: "T", items: ["S7", 10, "S1"], id: "MP25R4-T7b-asks-cap-then-yes-elapsed", label: "… → 換金澤（timeout）→ 再推薦幾個 ×2（詢問達上限 3）→（+16 秒）好（本輪 Provider 若被呼叫會成功；冷卻不得掩蓋）", turns: [T1, T2, "再推薦幾個", "再推薦幾個", "好"], r18GeoByTurn: { 1: "timeout", 4: "ok" }, r21ClockByTurn: { 4: 16000 }, expect: ["origin", "switchFail", "hold", "hold", "confirmCapped"], turnExpect: { 4: { v: 0, attemptsDelta: 0, why: "M1（裁決 5）：詢問已達上限 3 → 不得再驗證、不得增加 attempts" } } },
  // ── A2-MP-T40：正常 noMore → 好 → 替代推薦（使用者契約 (一)；不得被 E2f 擋住；必須進入正式 Callback，否則 UNVERIFIED）──
  { case: "NM", items: ["NM"], id: "MP25R4-NM-nomore-yes-alt", label: "（正常 noMore；A2-MP-T40）Session＝京都推薦池 3 筆已全顯示 → 再推薦幾個（京都景點類 Places 回空 → noMore＋替代推薦提問）→ 好（正式替代推薦：京都美食／咖啡廳／室內）", turns: ["再推薦幾個", "好"], r15Init: INIT_KYOTO_EXHAUSTED, r15EmptyDest: NM_EMPTY_Q, expect: ["noMoreOffer", "altYes"] },
].map((s) => ({ ...s, r15Modes: [OK], r19Coords: COORDS, r18GeoByTurn: s.r18GeoByTurn ? Object.fromEntries(Object.entries(s.r18GeoByTurn).map(([k, v]) => [String(k), v])) : undefined, ...(s.r21ClockByTurn ? { r21ClockByTurn: Object.fromEntries(Object.entries(s.r21ClockByTurn).map(([k, v]) => [String(k), v])) } : {}) }));

/**
 * 任務單 #60（A2-AUDIT-9；tester）：GP 探針（Geocoding 殘破地名；只做原始值觀察）。
 *   不加入 NEW_SCENARIOS：report() 的既有 49 個情境判定／項目列／SAFETY／P1 計數、自我測試 D9c 結構檢查、預設執行 ids 皆不受影響。
 *   只在 --only 明列 GP id 時執行；結果另輸出「GP 探針」一節（逐輪 A～F 原始值），殘破 query 只標「P1 候選（GP）」，不併入既有計數。
 *   GP_FUKUOKA＝情境 Fixture（同 HIGASHIYAMA 機制，r15Real 精確鍵；只在本探針子程序有效）：福岡不在 r13 Fixture，不加則正常對照句也會 ZERO_RESULTS。
 *   「福岡玩兩天」「福岡玩」不在任何 Fixture 鍵 → r15-F unknown → ZERO_RESULTS；「金澤玩」「京都玩」以 r13 PARENTS 前綴 → parent 成功（Mock 分類，見每輪 r15Geo）。
 *   任務單 #61（A2-AUDIT-10）：追加 GP-04～GP-07＋GP-C3／GP-C4（入口補驗：more_places／destination_places）；同一 GP 區塊輸出，
 *   另加「入口[分類] 目標／到達／標記」與 r15Flows 原始值兩行（只在有 gpEntry 的情境輸出；GP-01～GP-C2 輸出格式不變）。不併入既有計數。
 *   任務單 #64：GP-07 入口行加註前提 UNVERIFIED（gpPremise）；F 行在殘破欄位來自 r13 模型未重建路徑（或延續自該輪）時加註 MODEL 來源。只改輸出（CHANGES #51～#55）。
 */
const GP_FUKUOKA_LOC = { placeId: "mock-福岡市", country: "日本", city: "福岡市", region: "福岡縣", lat: 33.5902, lng: 130.4017, formattedName: "福岡市", displayLabel: "福岡市" };
const GP_FUKUOKA = { 福岡: GP_FUKUOKA_LOC, 福岡市: GP_FUKUOKA_LOC };
const GP_SCENARIOS = [
  { id: "GP-01-kanazawa-play-cafe", label: "（GP 探針）去金澤玩，推薦咖啡廳 → 再推薦幾個", turns: ["去金澤玩，推薦咖啡廳", "再推薦幾個"], gpBroken: ["金澤玩"] },
  { id: "GP-02-fukuoka-play-2days", label: "（GP 探針）我想去福岡玩兩天 → 推薦咖啡廳", turns: ["我想去福岡玩兩天", "推薦咖啡廳"], r15Real: GP_FUKUOKA, gpBroken: ["福岡玩兩天", "福岡玩", "玩兩天"] },
  { id: "GP-03-neg-osaka-kyoto-play", label: "（GP 探針；Session＝大阪推薦池）不去大阪了，去京都玩 → 再推薦幾個", turns: ["不去大阪了，去京都玩", "再推薦幾個"], r15Init: INIT_OSAKA, gpBroken: ["京都玩", "大阪了", "不去大阪"] },
  { id: "GP-C1-kanazawa-cafe", label: "（GP 對照）去金澤，推薦咖啡廳 → 再推薦幾個", turns: ["去金澤，推薦咖啡廳", "再推薦幾個"], gpBroken: [], gpControl: true },
  { id: "GP-C2-fukuoka", label: "（GP 對照）我想去福岡 → 推薦咖啡廳", turns: ["我想去福岡", "推薦咖啡廳"], r15Real: GP_FUKUOKA, gpBroken: [], gpControl: true },
  // ── 任務單 #61（A2-AUDIT-10）入口補驗：more_places（_app.chat.tsx L5184-5200）／destination_places（L4656-4671）──
  //   gpEntry＝目標入口；gpClass＝REALISTIC_FLOW（正常對話可到達）／INJECTED_STATE（r15Init／r18Init 人工建立的殘破 Session）。
  //   INJECTED_STATE 失敗不代表正常使用者一定能觸發。只用既有機制（r15 buildInit、r18Init），不改 Harness。
  { id: "GP-04-inj-more-kanazawa-play", label: "（GP 入口補驗；INJECTED_STATE；Session rec／travelContext＝金澤玩）再推薦幾個 → 再推薦幾個", turns: ["再推薦幾個", "再推薦幾個"], r15Init: { topic: "attraction", rec: { destination: "金澤玩", n: 6, batch: 3 }, travelDestination: "金澤玩" }, gpBroken: ["金澤玩"], gpEntry: "more_places", gpClass: "INJECTED_STATE" },
  { id: "GP-05-real-more-kanazawa-play", label: "（GP 入口補驗；REALISTIC_FLOW）京都推薦景點 → 去金澤玩，再推薦幾個", turns: ["京都推薦景點", "去金澤玩，再推薦幾個"], gpBroken: ["金澤玩"], gpEntry: "more_places", gpClass: "REALISTIC_FLOW" },
  { id: "GP-06-inj-dp-kanazawa-play", label: "（GP 入口補驗；INJECTED_STATE；Session travelContext＝金澤玩、無 rec）有哪些地方值得去 → 再推薦幾個", turns: ["有哪些地方值得去", "再推薦幾個"], r18Init: { travelDestination: "金澤玩" }, gpBroken: ["金澤玩"], gpEntry: "destination_places", gpClass: "INJECTED_STATE" },
  { id: "GP-07-real-dp-fukuoka-play", label: "（GP 入口補驗；REALISTIC_FLOW 候選：T1 若走 r13 模型未重建路徑，前提＝UNVERIFIED）我想去福岡玩兩天 → 有哪些地方值得去", turns: ["我想去福岡玩兩天", "有哪些地方值得去"], r15Real: GP_FUKUOKA, gpBroken: ["福岡玩兩天", "福岡玩", "玩兩天"], gpEntry: "destination_places", gpClass: "REALISTIC_FLOW", gpPremise: "前提 UNVERIFIED：T1 走 r13 模型未重建路徑（later:other），殘破 Session 來源未經正式碼證明" }, // 任務單 #64：只加輸出標示
  { id: "GP-C3-clean-more-kyoto", label: "（GP 入口對照；乾淨 Session rec／travelContext＝京都）再推薦幾個", turns: ["再推薦幾個"], r15Init: INIT_KYOTO, gpBroken: [], gpControl: true, gpEntry: "more_places", gpClass: "CONTROL" },
  { id: "GP-C4-clean-dp-kanazawa", label: "（GP 入口對照；乾淨 Session travelContext＝金澤、無 rec）有哪些地方值得去", turns: ["有哪些地方值得去"], r18Init: { travelDestination: "金澤" }, gpBroken: [], gpControl: true, gpEntry: "destination_places", gpClass: "CONTROL" },
].map((s) => ({ ...s, r15Modes: [OK], r19Coords: COORDS }));
/** 所有 GP 情境共用的殘破片段（對照句也用同一份檢查，證明對照不誤判）。 */
const GP_BROKEN_ALL = ["金澤玩", "金沢玩", "福岡玩", "玩兩天", "京都玩", "大阪了", "不去大阪", "去金澤", "去福岡", "去京都"];

export const scenarios = [...NEW_SCENARIOS, ...GP_SCENARIOS];
/** A2-MP-T25（使用者裁決 1）：確認輪（index 2）前 +16 秒的「冷卻後確認成功」情境（18b～18d 探測 work T2 無 Pending → 不列入）。 */
const T25_CLOCK_IDS = ["MP25R4-05-confirm-kanazawa-yes", "MP25R4-05b-confirm-kanazawa-echo", "MP25R4-09-reload-confirm", "MP25R4-18-original-text-other-city", "MP25R4-18e-neg-osaka-huancheng-more"];

// ════════════════ 共用 ════════════════
const PLACE_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
const uniq = (a) => [...new Set(a)];
/** r4（修正 1／4）：既有 canonical identity（r21 主程序提供；缺 → 丟錯＝INFRA）。 */
const CANON = () => globalThis.__R21_CANON_INFO ?? null;
const canonKey = (x) => {
  const c = CANON();
  if (!c) throw new Error("[mp25-r4] 缺既有 canonical identity（不是經 r21 執行？）");
  return c.canonKey(x);
};
/** r4（修正 1）：字串中「所有」候選地名（PLACE_KEYS＋既有別名表詞彙），每個經 canonical identity；不只取第一個。 */
const Ks = (v) => {
  if (v == null || v === "") return [];
  const s = String(v);
  const out = [];
  for (const x of PLACE_KEYS) if (s.includes(x)) out.push(canonKey(x));
  const c = CANON();
  if (c) for (const x of c.mentions(s)) out.push(x);
  return uniq(out.filter(Boolean));
};
/** 單值欄位（r3 相容）：第一個候選（PLACE_KEYS 順序優先）；金沢／金澤經 canonical identity 合一（取代 r3 的手寫對照）。 */
const K = (v) => {
  if (v == null || v === "") return null;
  return Ks(v)[0] ?? "?";
};
const cardDest = (c) => K(`${c?.name ?? ""}|${c?.id ?? ""}`);
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
/** r4（修正 1）：所有候選（多值）；用於原句夾帶其他城市的檢查。 */
const colsAll = (t) => ({
  credits: uniq((t.r15Credits ?? []).flatMap((c) => Ks(c.destination))),
  cards: uniq((t.r15Cards ?? []).flatMap((c) => Ks(`${c?.name ?? ""}|${c?.id ?? ""}`))),
  places: uniq((t.placesQueries ?? []).flatMap((x) => Ks(String(x).split("@").at(-1)))),
});
const fmt = (c) => `Credits=[${c.credits.join(",") || "-"}] 卡片=[${c.cards.join(",") || "-"}] Places=[${c.places.join(",") || "-"}] rec=${c.rec ?? "-"} Context=${c.arc ?? "-"} travelContext=${c.tc ?? "-"} tpc=${c.tpc ?? "-"}`;
const trustedIn = (t, d) => (t.trust ?? []).some((x) => x.status === "trusted" && K(x.destination) === d);
/** r4（修正 1）：查詢字串的「所有」候選地名含 d 即計入（r3：K 只取第一個 → 「大阪了換金澤」漏算大阪）。英文別名正則（r3）保留。 */
const geoAll = (t, d) => (t.geocodes ?? []).filter((g) => Ks(String(g).split(":").slice(1).join(":")).includes(d) || (d === "金澤" && /Kanazawa|石川/i.test(String(g))) || (d === "大阪" && /Osaka/i.test(String(g))) || (d === "京都" && /Kyoto/i.test(String(g))));
const isWeatherGeo = (g) => /^weather:/.test(String(g));
/** 修正 1（r3）：驗證次數＝所有「非 weather 階段」的該目的地 geocode。 */
const geoV = (t, d) => geoAll(t, d).filter((g) => !isWeatherGeo(g));
/** Weather 階段的該目的地 geocode（分開統計）。 */
const geoW = (t, d) => geoAll(t, d).filter(isWeatherGeo);
const weatherGeo = (t) => (t.geocodes ?? []).filter(isWeatherGeo);
const pendingOf = (t) => t.r18Pending ?? null;
const dsOf = (p) => (p && typeof p === "object" && !Array.isArray(p) && p.kind === "destination_switch" ? p : null);
const isSwitchPending = (p, cat = "attraction") => Boolean(p) && p.kind === "destination_switch" && K(p.rawGeographicLabel) === "金澤" && K(p.previousConfirmedDestination) === "京都" && p.categoryIntent === cat && p.originatingRoute === "more_places";
const pendingStr = (p) => (p ? JSON.stringify({ kind: p.kind, raw: p.rawGeographicLabel ?? null, prev: p.previousConfirmedDestination ?? null, cat: p.categoryIntent ?? null, route: p.originatingRoute ?? null, orig: p.originalUserText ?? null, attempts: p.confirmationAttempts ?? null, parent: p.parentIntent ?? null }) : "null");
/** r4（修正 3）：Pending identity（kind、canonical raw、previousConfirmedDestination、categoryIntent、originatingRoute）。 */
const idKey = (p) => JSON.stringify([p?.kind ?? null, canonKey(p?.rawGeographicLabel), String(p?.previousConfirmedDestination ?? "").trim(), p?.categoryIntent ?? null, p?.originatingRoute ?? null]);
const idLabel = (k) => {
  try {
    const a = JSON.parse(k);
    return `${a[1]}／prev=${a[2] || "-"}／${a[3] ?? "-"}／${a[4] ?? "-"}`;
  } catch {
    return k;
  }
};
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
/** r4（同 r21-E c）：地名／未知建立輪原句的範圍字樣與距離單位。 */
const LABEL_SCOPE_RE = /searchScope|explicitSearchScope|radius|半徑|範圍|公里內|\d\s*km\b/i;
const DIST_RE = /\d+(?:\.\d+)?\s*(?:公里|公尺|千米|英里|米|km|mi|m)(?![a-z])/i;
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
/**
 * A2-MP-T46（使用者裁決 (三)；CHANGES #39）：noMore Credits 契約（只用於 noMoreOffer／altYes；creditsFails 照舊對所有輪執行，不取代）。
 *   依 creditsRpc 時序記帳：credits_reserve 開啟 1 筆；credits_commit／credits_rollback 結算 1 筆（之前沒有開啟中的 reserve＝孤立結算）；輪末仍開啟＝未結算 reserve。
 *   無有效新卡片：允許 reserve → rollback，條件＝沒有 commit、reserve 至多 1、（有 reserve 或 rollback 時）rollback 恰好 1 次、未結算 reserve＝0、無孤立結算。
 *   有有效新卡片：依既有 Credits 契約 commit（reserve 恰 1 → commit 恰 1、rollback 0、未結算 reserve＝0）。reserve 本身不得視為已完成的扣點。
 *   違反 → SAFETY（與 creditsFails 同一 Credits 類別；標籤 NM、20）。
 */
const creditsLedger = (t) => {
  let reserve = 0, commit = 0, rollback = 0, open = 0, orphan = 0;
  for (const x of t.creditsRpc ?? []) {
    if (x === "credits_reserve") {
      reserve += 1;
      open += 1;
    } else if (x === "credits_commit" || x === "credits_rollback") {
      if (x === "credits_commit") commit += 1;
      else rollback += 1;
      if (open > 0) open -= 1;
      else orphan += 1;
    }
  }
  return { reserve, commit, rollback, open, orphan };
};
function noMoreCreditsFails(t) {
  const f = [];
  const L = creditsLedger(t);
  const cards = (t.r15Cards ?? []).length;
  const seq = (t.creditsRpc ?? []).join(",") || "-";
  if (L.open) f.push(`noMore Credits：未結算 reserve=${L.open}（reserve 不得視為已完成的扣點；RPC=${seq}）`);
  if (L.orphan) f.push(`noMore Credits：commit／rollback 前沒有對應 reserve ${L.orphan} 次（RPC=${seq}）`);
  if (!cards) {
    if (L.commit) f.push(`noMore Credits：無有效新卡片卻 credits_commit=${L.commit}（只允許 reserve→rollback；RPC=${seq}）`);
    if (L.reserve > 1) f.push(`noMore Credits：無有效新卡片 credits_reserve=${L.reserve}（至多 1 次 reserve→rollback；RPC=${seq}）`);
    if ((L.reserve || L.rollback) && L.rollback !== 1) f.push(`noMore Credits：無有效新卡片 credits_rollback=${L.rollback}（有 reserve 時應恰好 1 次；RPC=${seq}）`);
  } else {
    if (L.rollback) f.push(`noMore Credits：有有效新卡片卻 credits_rollback=${L.rollback}（應依既有 Credits 契約 commit；RPC=${seq}）`);
    if (L.reserve !== 1 || L.commit !== 1) f.push(`noMore Credits：有有效新卡片 reserve=${L.reserve} commit=${L.commit}（應恰好 reserve 1→commit 1；RPC=${seq}）`);
  }
  return f;
}
/**
 * A2-MP-T52（任務單 #52；CHANGES #43～#45）：Credits Reservation 時序斷言（所有輪；creditsFails／noMoreCreditsFails 不變，只新增）。
 * 契約（只讀）：src/lib/credits/runtime.ts
 *   L175→L196  每次 beginCreditsOperation 先 credits_check、通過才 credits_reserve，且只 reserve 一次（runtime 內沒有重試迴圈）；
 *   L176-194   check 失敗 → blocked（只有 check，無 reserve）；L207-219 reserve 失敗 → blocked（check→reserve，無結算）；
 *   L222-227   reserve 回 skipped → inactive handle（check→reserve，無結算 RPC）；L247-248 無 ledger_id 且 status=committed → commit 不送 RPC；
 *   L149-173／L25-41  flag off／Plus → inactive handle，完全沒有 RPC；src/lib/credits/operations.ts L47-62 settle：每個 handle 只呼叫 commit 或 rollback 其中一次，inactive 直接 return。
 *   合法重試＝呼叫端重新 begin（新的 check→reserve）；並行兩個 begin 可交錯（check,check,reserve,reserve,…）。
 * 本檢查只依 creditsRpc 名稱時序（scripts/verify-destination-authority-phase2-r14.mjs L806 只輸出 name；args／ledger_id 不在每輪記錄）：
 *   R2 結算早於 reserve（結算時沒有開啟中的 reservation，之後才 reserve）；R3 同一筆 reservation 結算 2 次（開啟中為 0、之前已有已結算的 reservation）；
 *   R4 重複 commit（R3 且前次與本次皆 commit）；R5 重複 rollback（R3 且前次與本次皆 rollback）；R6 沒有 reservation 的結算（整輪沒有可對應的 reserve）；
 *   R7 未經授權的重複 reserve（reserve 前沒有尚未使用的 credits_check）。R1 ledger_id 一致：拿不到 args → UNVERIFIED（不在此實作）。
 *   輪末未結算 reserve 不在此判定（契約允許 L207-227／L247-248 分支；數量面由既有 creditsFails 判定）。違反 → SAFETY（標籤 20）。
 */
function creditsOrderFails(t) {
  const f = [];
  const rpc = t.creditsRpc ?? [];
  const seq = rpc.join(",") || "-";
  let checks = 0;
  const open = [];
  const settled = [];
  rpc.forEach((x, i) => {
    if (x === "credits_check") checks += 1;
    else if (x === "credits_reserve") {
      if (checks > 0) checks -= 1;
      else f.push(`Credits 時序：第 ${i + 1} 個 RPC credits_reserve 前沒有尚未使用的 credits_check（未經授權的重複 reserve；runtime.ts L175→L196 每次 begin 至多 check 一次、通過後至多 reserve 一次；L149-173 flag off／Plus 不 check；RPC=${seq}）`);
      open.push(i);
    } else if (x === "credits_commit" || x === "credits_rollback") {
      const by = x === "credits_commit" ? "commit" : "rollback";
      if (open.length) {
        settled.push({ r: open.shift(), by });
        return;
      }
      const prev = settled.at(-1);
      // A2-MP-T56（CHANGES #47）：之後仍有 credits_reserve → 名稱時序無法區分「同一筆結算 2 次」與「結算早於後續 reserve」（例 C,R,CM,C,CM,R）；兩種可能並列，觸發條件與 SAFETY 不變
      const later = rpc.slice(i + 1).indexOf("credits_reserve");
      const alt = later >= 0 ? `；之後第 ${i + 2 + later} 個 RPC 才 credits_reserve → 兩種可能：同一筆 reservation 結算 2 次，或結算早於後續 credits_reserve（名稱時序無法區分）` : "";
      if (prev) {
        f.push(`Credits 時序：第 ${i + 1} 個 RPC ${x} 沒有開啟中的 reservation，前一筆 reservation（第 ${prev.r + 1} 個 RPC）已 ${prev.by}${alt ? alt : "＝同一筆 reservation 結算 2 次"}（RPC=${seq}）`);
        if (prev.by === "commit" && by === "commit") f.push(`Credits 時序：重複 commit（第 ${prev.r + 1} 個 RPC 的 reservation commit 2 次${alt ? "；或結算早於後續 credits_reserve" : ""}；RPC=${seq}）`);
        if (prev.by === "rollback" && by === "rollback") f.push(`Credits 時序：重複 rollback（第 ${prev.r + 1} 個 RPC 的 reservation rollback 2 次${alt ? "；或結算早於後續 credits_reserve" : ""}；RPC=${seq}）`);
      } else if (rpc.slice(i + 1).includes("credits_reserve")) f.push(`Credits 時序：第 ${i + 1} 個 RPC ${x} 早於 credits_reserve（reserve 必須在 commit／rollback 之前；RPC=${seq}）`);
      else f.push(`Credits 時序：第 ${i + 1} 個 RPC ${x} 沒有任何 reservation（沒有 reservation 的結算；RPC=${seq}）`);
    }
  });
  // A2-MP-T56（CHANGES #46）：規則 7 加嚴——同一輪 credits_reserve 次數不得多於本輪 begin 次數（t.r15Credits；r15 L844 creditsBegin.slice(c0)；r14 L477 每次 begin 推 1 筆）。
  // runtime.ts 每次 begin 至多 reserve 一次 → reserve>begin＝未經授權的重複 reserve（即使每次 reserve 前都有 credits_check，例 C,C,R,R,RB,CM／C,R,RB,C,R,CM 於 begin 1）。上方 check 配對規則保留。
  const reservesN = rpc.filter((x) => x === "credits_reserve").length;
  const beginsN = (t.r15Credits ?? []).length;
  if (reservesN > beginsN) f.push(`Credits 時序：本輪 credits_reserve=${reservesN} 多於 begin=${beginsN}（未經授權的重複 reserve；每次 beginCreditsOperation 至多 reserve 一次；RPC=${seq}）`);
  return f;
}
/** A2-MP-T56（CHANGES #48）：R1 ledger_id 一致性與名稱層級盲點（輸出於 --self-test 與 report；不假裝已抓到）。 */
const CREDITS_R1_UNVERIFIED = "UNVERIFIED Credits R1 ledger_id 一致性：r14 L441 R14_rpc 有記錄 args（含 p_ledger_id），L443 Mock 發出不重複的 ledger_id（r14-ledger-N），但每輪只輸出 RPC name；要驗證需修改 Harness（r13～r21），不在授權範圍內。名稱層級盲點：C,R,C,R,RB,RB（begin 2、settle [false,false]、無卡片）可能是同一筆被 rollback 兩次、另一筆從未結算，一般輪現行所有斷言（creditsFails／creditsOrderFails）皆判 PASS，本檔抓不到（只有 noMoreOffer／altYes 輪會因 noMoreCreditsFails 的 reserve≤1 間接擋下）。";
const FAIL_KINDS = ["switchFail", "confirmFail", "confirmCapped", "forgedHold", "forgedPrevHold", "rebuildCapped", "negSwitch"]; // A2-MP-T24：＋negSwitch（18b～18d 一般流程的金澤 Provider 失敗輪；同 switchFail 的 Weather／Builder／noMore 檢查）
const NON_CONFIRM = ["hold", "idle", "chooseOld", "oldMore", "cancel", "noRevive", "forgedPrevKeep", "forgedPrevCancel", "newTrip", "sameCityArea", "noMoreOffer", "altYes"]; // A2-MP-T18：＋newTrip／sameCityArea（對照輪不得驗證金澤）；A2-MP-T40：＋noMoreOffer／altYes（正常 noMore 情境不得驗證金澤）
/** 未確認期間（Pending 仍有效、本輪不應確認任何新目的地）。 */
const PENDING_KINDS = ["switchFail", "hold", "confirmFail", "confirmCapped", "idle", "rebuildCapped", "forgedHold", "forgedPrevHold", "negSwitch"]; // A2-MP-T24：＋negSwitch（金澤未確認期間；Places／Credits／Builder／Session 地理投影／非 RPC 寫入同 switchFail）
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
  for (const x of creditsOrderFails(t)) add("SAFETY", x, [20]); // A2-MP-T52：Credits Reservation 時序（所有輪；只新增）
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
  if (!("r21Writes" in t)) add("INFRA", "缺 r21-O 記錄（不是經 r21 執行？）");
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
    // r4（修正 2）：等待輪／閒置輪 Builder＝0（FAIL_KINDS 已在上方檢查 Builder，不重複）
    if (!FAIL_KINDS.includes(kind) && (t.builderCalls ?? 0) > 0) add(oldOrSafety(), `未確認期間仍呼叫 Builder ${t.builderCalls} 次（${fmt(c)}）`, [1, 19]);
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
  // r4（e(4)）：同一 User Turn 寫入內容不同的 destination_switch Pending
  {
    const wr = uniq((t.r21Writes ?? []).map((w) => canon(w?.p ?? null)));
    if (wr.length > 1) add("SAFETY", `同一輪寫入 ${wr.length} 個內容不同的 destination_switch Pending（${wr.map((x) => x.slice(0, 60)).join(" | ")}）`, [11, 12]);
  }
  // N6／N7：Session 中的 destination_switch Pending 本身（originalUserText／confirmationAttempts／activeCategoryIntent／parentIntent）
  if (pend?.kind === "destination_switch") {
    const o = pend.originalUserText;
    // r4（e(1)）：ref＝同一 Pending 的建立輪原句（情境內可知）；建立輪未知（Client 注入）→ null（fail-closed 絕對檢查，不得自己比自己）；本輪新寫入 → 本輪原句
    const ref = ctx.pendRef;
    const refKnown = typeof ref === "string";
    // r4（裁決 1）：parentIntent 固定 place_recommendation
    if (pend.parentIntent === undefined || pend.parentIntent === null) add("PENDING", "Pending 缺 parentIntent（必須為 place_recommendation；裁決 1）", [14]);
    else if (pend.parentIntent !== "place_recommendation") add("SAFETY", `Pending parentIntent=${JSON.stringify(pend.parentIntent)}（必須為 place_recommendation；裁決 1）`, [12]);
    if (typeof o !== "string" || !o.trim()) add("PENDING", "Pending 缺 originalUserText", [14]);
    else {
      if (refKnown && o !== ref) add("PENDING", `originalUserText≠建立 Pending 當輪原句（${JSON.stringify(o.slice(0, 40))} vs ${JSON.stringify(ref.slice(0, 40))}）`, [14]);
      const raw = String(pend.rawGeographicLabel ?? "").trim();
      if (raw && !o.includes(raw)) add("PENDING", `originalUserText 不含待確認目的地「${raw}」`, [14]);
      const refT = refKnown ? ref : "";
      const prev = String(pend.previousConfirmedDestination ?? "").trim();
      if (prev && countOf(o, prev) > countOf(refT, prev)) add("SAFETY", `originalUserText 重複拼接父城市「${prev}」${refKnown ? "" : "（建立輪原句未知）"}`, [14]);
      if (COORD_RE.test(o) && !COORD_RE.test(refT)) add("SAFETY", `originalUserText 附加座標${refKnown ? "" : "（建立輪原句未知）"}`, [14]);
      if (SCOPE_RE.test(o) && !SCOPE_RE.test(refT)) add("SAFETY", `originalUserText 附加搜尋範圍${refKnown ? "" : "（建立輪原句未知）"}`, [14]);
      if (!refKnown) {
        if (!SCOPE_RE.test(o) && (LABEL_SCOPE_RE.test(o) || DIST_RE.test(o))) add("SAFETY", "originalUserText 含範圍字樣（建立輪原句未知）", [14]);
        const keep = new Set([canonKey(raw), canonKey(prev)].filter(Boolean));
        const other = Ks(o).filter((k) => k !== "?" && !keep.has(k));
        if (other.length) add("SAFETY", `originalUserText 夾帶其他城市 ${other.join("、")}（建立輪原句未知；Client 注入的 Pending 不得自己比自己）`, [14, 12]);
      }
      if (ctx.lim && o.length > ctx.lim.userText) add("SAFETY", `originalUserText 長度 ${o.length} > 既有上限 ${ctx.lim.userText}`, [14]);
    }
    const raw = String(pend.rawGeographicLabel ?? "");
    if (ctx.lim && raw.trim().length > ctx.lim.label) add("SAFETY", `rawGeographicLabel 長度 ${raw.trim().length} > 既有上限 ${ctx.lim.label}`, [14]);
    if (COORD_RE.test(raw)) add("SAFETY", "rawGeographicLabel 是座標字串", [14]);
    // r4（e(3)）：地名不得夾帶範圍字樣
    if (LABEL_SCOPE_RE.test(raw) || DIST_RE.test(raw)) add("SAFETY", `rawGeographicLabel 夾帶範圍字樣（${JSON.stringify(raw.slice(0, 40))}）`, [14]);
    const n = pend.confirmationAttempts;
    if (!Number.isInteger(n)) add("PENDING", `Pending 缺 confirmationAttempts（=${JSON.stringify(n ?? null)}）`, [11]);
    else {
      if (n < 0 || n > LIMITS.validatePerPending) add("SAFETY", `confirmationAttempts=${n}（必須 0–${LIMITS.validatePerPending}）`, [11]);
      // r4（修正 3）：attemptsMax／confirmVal 依 Pending identity 分開（r3＝整個情境合計）
      if (n < ctx.attemptsMax) add("SAFETY", `confirmationAttempts 被重置／減少 ${ctx.attemptsMax}→${n}（相同 identity 不得重置上限）`, [11, "S2"]);
      if (n < ctx.confirmVal) add("SAFETY", `confirmationAttempts=${n} 少於已執行的確認驗證次數 ${ctx.confirmVal}`, [11]);
      // r4（裁決 3）：同一 User Turn 驗證 ≤1 → 建立輪 ≤1、同一 Pending 一輪最多 +1
      if (ctx.pendCreated && n > LIMITS.validatePerTurn) add("SAFETY", `建立輪 confirmationAttempts=${n}（同一 User Turn 驗證 ≤${LIMITS.validatePerTurn}）`, [11]);
      if (Number.isInteger(ctx.attemptsStart) && n - ctx.attemptsStart > LIMITS.validatePerTurn) add("SAFETY", `confirmationAttempts 一輪推進 ${ctx.attemptsStart}→${n}（同一 User Turn 驗證 ≤${LIMITS.validatePerTurn}）`, [11]);
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
  } else if (kind === "negSwitch") {
    // A2-MP-T24（使用者裁決 3）：18b～18d 依既有一般目的地切換流程（輪末沒有 destination_switch Pending；有 → evalScenario 改以 switchFail 嚴格判定）。
    // 本輪金澤 Provider timeout → 金澤未確認：不得以京都／金澤／大阪搜尋扣點顯示、不得覆蓋京都（錯誤 Reset）；不要求保存 more_places Pending（不強制路由）。
    if (t.placesRequests > 0) add(c.places.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `否定語句切換輪（金澤 Provider 失敗）仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",")}）`);
    if ((t.r15Credits ?? []).length) add(c.credits.every((d) => d === "京都") ? "OLD-CITY" : "SAFETY", `否定語句切換輪（金澤 Provider 失敗）仍開始 Credits（${c.credits.join(",")}）`, [20]);
    if ((t.r15Cards ?? []).length) add(kyotoShown ? "OLD-CITY" : "SAFETY", `否定語句切換輪（金澤 Provider 失敗）仍顯示卡片（${c.cards.join(",")}）`);
    if (c.rec !== "京都") add("SAFETY", `否定語句切換輪金澤未確認卻覆蓋原本可信目的地：recommendationSession=${c.rec ?? "-"}（應保留京都；錯誤 Reset）`);
    if (c.tc !== "京都") add("SAFETY", `否定語句切換輪金澤未確認卻覆蓋原本可信目的地：travelContext=${c.tc ?? "-"}（應保留京都；錯誤 Reset）`);
    if (!assistantOf(t).length) add("FEATURE", "否定語句切換輪沒有任何助理回覆");
  } else if (kind === "negSwitchYes") {
    // A2-MP-T24（使用者裁決 3）：一般流程的「好」（輪初沒有 destination_switch Pending；有 → evalScenario 改以 confirmNew 嚴格判定）。
    // 驗證：正確目的地（不得京都／大阪；有卡片只能是已確認金澤）、無錯誤 Reset、無錯誤 Provider 查詢（otherCity／exactRaw／每輪上限，見上方共用檢查）、無未確認扣點。
    if (kyotoShown) add("OLD-CITY", `否定語句切換後「好」仍以京都搜尋／扣點／顯示（${fmt(c)}）`);
    const tk = (t.trust ?? []).filter((x) => x.status === "trusted" && K(x.destination) === "金澤");
    if (c.cards.length) {
      if (c.cards.some((d) => d !== "金澤")) add("FEATURE", `否定語句切換後卡片不是金澤（${fmt(c)}）`);
      if (!geoV(t, "金澤").length) add("FEATURE", "否定語句切換後顯示金澤卡片：本輪沒有 Provider 驗證");
      if (tk.length && !tk.some((x) => near(x.center, "金澤"))) add("FEATURE", `否定語句切換：可信中心不是金澤 Provider 座標（${tk.map((x) => JSON.stringify(x.center)).join(",")}）`, [18]);
      if (tk.some((x) => near(x.center, "金澤"))) ctx.evidence.coordsKanazawa = true;
      if (c.credits.length !== 1 || c.credits[0] !== "金澤") add("FEATURE", `否定語句切換：Credits metadata=[${c.credits.join(",") || "-"}]（應恰好 1 次金澤）`, [20]);
      if (c.rec !== "金澤" || c.tc !== "金澤") add("FEATURE", `否定語句切換：rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}（應為金澤）`);
      if (!ctx.ref) add("INFRA", "否定語句切換輪的既有推薦流程基準（REF）缺失／未成立");
      else
        for (const [label, v, r] of [["Places 請求", t.placesRequests ?? 0, ctx.ref.places], ["Builder", t.builderCalls ?? 0, ctx.ref.builder], ["Weather 請求", t.weatherCalls ?? 0, ctx.ref.weather], ["Weather geocode", weatherGeo(t).length, ctx.ref.weatherGeo], ["Credits.begin", (t.r15Credits ?? []).length, ctx.ref.begins]])
          if (v > r) add(kyotoShown ? "OLD-CITY" : "SAFETY", `否定語句切換輪 ${label}=${v} 高於同樹既有推薦流程（REF T2）=${r}`, label.startsWith("Credits") ? [20, 19] : [19]);
    } else if (kz) {
      if (c.rec !== "金澤" && c.tc !== "金澤") add("FEATURE", `否定語句切換：金澤已確認但目的地未切換（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}）`);
    } else {
      // A2-MP-T40（使用者契約 (二)：沒有明確續推要求時不強制建立 Pending）：原「!dsOf(pend) || raw≠金澤 → FEATURE（既未切換、也未保留金澤切換意圖）」
      // 與契約直接衝突（E2f 後 T2 pending=null 為契約允許的行為，T3「好」無 Pending 可確認 → 舊條件必判 FEATURE）→ 只保留「有 Pending 但不是金澤」＝目的地不正確。
      if (dsOf(pend) && K(pend.rawGeographicLabel) !== "金澤") add("FEATURE", `否定語句切換後保留的切換意圖不是金澤（${fmt(c)} pending=${pendingStr(pend)}）＝目的地不正確`);
      if (c.rec !== "京都" || c.tc !== "京都") add("SAFETY", `否定語句切換後金澤未確認卻改寫京都（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}；錯誤 Reset）`);
      const cr = (t.creditsRpc ?? []).filter((x) => /^credits_/.test(x));
      if (cr.length || (t.r15Credits ?? []).length) add("SAFETY", `否定語句切換後金澤未確認仍啟動 Credits（begin=${(t.r15Credits ?? []).length} RPC=${cr.join(",") || "-"}）`, [20]);
      // A2-MP-T40：取代被刪條件原本兼顧的負向案例（加嚴；只在無卡片且金澤未確認時）：不得提出（舊京都）替代推薦提問、不得搜尋 Places／呼叫 Builder
      const mis = assistantOf(t).filter((x) => MISLEAD_RE.test(x));
      if (mis.length || (t.r20AltOffer ?? []).some(Boolean)) add("FEATURE", `否定語句切換後「好」提出 noMore／替代推薦提問（${(mis[0] ?? assistantFull(t).find((_, i) => t.r20AltOffer?.[i]) ?? "").slice(0, 60)}）＝下一輪「好」會以舊京都搜尋扣點`);
      // 只限京都以外／無法辨識的搜尋（京都搜尋已由上方 kyotoShown → OLD-CITY 判定，分類不變）
      if ((t.placesRequests ?? 0) > 0 && !(c.places.length && c.places.every((d) => d === "京都"))) add("SAFETY", `否定語句切換後金澤未確認仍搜尋 Places ${t.placesRequests} 次（${c.places.join(",") || "-"}）`, [1]);
      if ((t.builderCalls ?? 0) > 0 && !kyotoShown) add("SAFETY", `否定語句切換後金澤未確認仍呼叫 Builder ${t.builderCalls} 次`, [19]);
      // A2-MP-T42（M3）：補齊被刪 FEATURE 原本順帶抓到的負向案例；比照 PENDING_KINDS 的 N2／N3／N5（分類照原碼，不降級）
      // N3：Session 地理投影（GEO_PROJ_KEYS）不得被改寫（分類＝原 N3：只含原城市且本輪只搜原城市 → OLD-CITY，否則 SAFETY）
      if (t.r20Start && t.r20End) {
        const ch = GEO_PROJ_KEYS.filter((k) => canon(t.r20Start[k]) !== canon(t.r20End[k]));
        const chText = ch.map((k) => canon(t.r20End[k])).join(" ");
        const foreign = /金澤|金沢|Kanazawa|大阪|Osaka|36\.56|136\.65/.test(chText) && OLDC !== "大阪";
        if (ch.length) add(!foreign && oldOnly(shownAll) ? "OLD-CITY" : "SAFETY", `否定語句切換後金澤未確認 Session 地理欄位改變：${ch.map((k) => `${k}=${canon(t.r20Start[k]).slice(0, 50)}→${canon(t.r20End[k]).slice(0, 50)}`).join("；")}`, [1]);
        // activeCategoryIntent 不得被清除（分類＝原 keepPool／Pending 存在輪的 SAFETY [17]）
        if (canon(t.r20Start.activeCategoryIntent) !== canon(t.r20End.activeCategoryIntent)) add("SAFETY", `否定語句切換後金澤未確認 activeCategoryIntent 被清除／改變 ${t.r20Start.activeCategoryIntent ?? "-"}→${t.r20End.activeCategoryIntent ?? "-"}（不得觸發重置）`, [17]);
      }
      // 京都推薦 Context（arc）不得被清除（分類＝原 keepPool SAFETY）
      if (K(t.r18ArcAtStart) === OLDC && c.arc !== OLDC) add("SAFETY", `否定語句切換後金澤未確認清掉${OLDC}推薦 Context（activeRecommendationContext=${c.arc ?? "-"}；不得觸發重置）`, [1]);
      // N5：非 RPC Supabase 寫入＝0（分類＝原 N5 SAFETY）
      const dbw = (t.r20Db ?? []).filter((x) => DB_WRITE_RE.test(x));
      if (dbw.length) add("SAFETY", `否定語句切換後金澤未確認仍有非 RPC Supabase 寫入 ${dbw.length} 次（${dbw.slice(0, 3).join(",")}）`, [1]);
      // Weather＝0（分類＝原 FAIL_KINDS 失敗輪 Weather 檢查 oldOrSafety()）
      if ((t.weatherCalls ?? 0) > 0) add(oldOrSafety(), `否定語句切換後金澤未確認仍呼叫 Weather ${t.weatherCalls} 次（${fmt(c)}）`, [19]);
      // 必須有助理回覆（分類＝原 switchFail／negSwitch 的 FEATURE）
      if (!assistantOf(t).length) add("FEATURE", "否定語句切換後「好」沒有任何助理回覆（使用者看不到目前狀態）");
    }
    // A2-MP-T40：刪除上方 FEATURE 後，模型路徑（未重建）的「好」輪可能 0 失敗 → 報告會誤列 PASS；改為明確記 MODEL（UNVERIFIED，與刪除前的呈現相同）
    if (/未重建/.test(String(t.path ?? ""))) add("MODEL", "否定語句切換後「好」輪走 r13 模型未重建路徑（正式碼未執行；UNVERIFIED，不計 PASS）");
  } else if (kind === "noMoreOffer") {
    // A2-MP-T40（使用者契約 (一)）：京都推薦用完 → 提出正常替代推薦（noMore＋替代推薦提問）；不被 E2f 擋住；Session 保留京都；不扣點（creditsFails：無卡片 → commit 0）
    const path = String(t.path ?? "");
    const offer = (t.r20AltOffer ?? []).some(Boolean) || assistantOf(t).some((x) => MISLEAD_RE.test(x));
    if (c.cards.length) add("INFRA", `正常 noMore 前提不成立：京都推薦池未用完（本輪仍有卡片；r15Init／r15EmptyDest Fixture 未生效？${fmt(c)}）`);
    else if (assistantFull(t).some((x) => STOPPED_RE.test(String(x)))) add("FEATURE", `正常 noMore 被 E2f destinationSwitchStopped 擋住（${String(assistantFull(t).find((x) => STOPPED_RE.test(String(x)))).slice(0, 60)}）`, ["NM"]);
    else if (!offer) add("FEATURE", `京都推薦用完後沒有提出正常替代推薦（noMore／替代推薦提問；助理=${JSON.stringify(assistantOf(t).map((x) => String(x).slice(0, 40)))}）`, ["NM"]);
    if (c.tc !== "京都") add(c.tc && c.tc !== "?" ? "SAFETY" : "FEATURE", `正常 noMore 輪 travelContext=${c.tc ?? "-"}（應保留京都；下一輪替代推薦以 travelContext.destination 搜尋）`, ["NM"]);
    if (dsOf(pend)) add("FEATURE", `正常 noMore 輪出現 destination_switch Pending（${pendingStr(pend)}）`, ["NM"]);
    const foreign = uniq([...colsAll(t).places, ...colsAll(t).credits]).filter((d) => d !== "京都" && d !== "?");
    if (foreign.length) add("SAFETY", `正常 noMore 輪以京都以外的城市搜尋／扣點（${foreign.join("、")}；${fmt(c)}）`, ["NM", 20]);
    if (!/\(real\)/.test(path) || /未重建/.test(path)) add("MODEL", `正常 noMore 輪未進入正式 Callback（path=${path.slice(0, 80)}）→ UNVERIFIED`);
    for (const x of noMoreCreditsFails(t)) add("SAFETY", x, ["NM", 20]); // A2-MP-T46（裁決 (三)）：無卡片只允許 reserve→rollback 恰一次
  } else if (kind === "altYes") {
    // A2-MP-T40（使用者契約 (一)）：回答「好」→ 正式替代推薦（_app L9655-9686 → pushAlternativeDestinationPlaceRecommendation）；必須走正式 Callback（r14-Δ4 alternative_recommendations(real)），否則 MODEL＝UNVERIFIED
    const path = String(t.path ?? "");
    if (!/alternative_recommendations\(real\)/.test(path) || /未重建/.test(path)) add("MODEL", `替代推薦「好」未進入正式 Callback（path=${path.slice(0, 80)}；只走 Harness 模型）→ UNVERIFIED`);
    if (assistantFull(t).some((x) => STOPPED_RE.test(String(x)))) add("FEATURE", "正常替代推薦被 E2f destinationSwitchStopped 擋住", ["NM"]);
    if (!c.cards.length) add("FEATURE", `「好」後沒有替代推薦卡片（${fmt(c)}）`, ["NM"]);
    else if (c.cards.some((d) => d !== "京都")) add("SAFETY", `替代推薦卡片不是京都（${fmt(c)}）`, ["NM"]);
    const ca = colsAll(t);
    const foreign = uniq([...ca.credits, ...ca.cards, ...ca.places]).filter((d) => d !== "京都" && d !== "?");
    if (foreign.length) add("SAFETY", `替代推薦出現京都以外的城市 ${foreign.join("、")}（${fmt(c)}）`, ["NM", 20]);
    const badP = c.places.filter((d) => d !== "京都");
    if (badP.some((d) => d !== "?")) add("SAFETY", `替代推薦 Places 搜尋範圍不是京都（Places=[${c.places.join(",")}]）`, ["NM"]);
    else if (!(t.placesRequests ?? 0) || !c.places.length || badP.length) add("FEATURE", `替代推薦 Places 搜尋範圍無法確認為京都（placesReq=${t.placesRequests ?? 0} Places=[${c.places.join(",") || "-"}]）`, ["NM"]);
    if ((t.r15Credits ?? []).length !== 1 || c.credits[0] !== "京都") add("FEATURE", `替代推薦 Credits.begin=${(t.r15Credits ?? []).length} metadata=[${c.credits.join(",") || "-"}]（應恰好 1 次京都；一次結算）`, ["NM", 20]);
    const ll = (t.r20CardLL ?? []).filter((x) => x.lat != null);
    if (c.cards.length && ll.length && !ll.every((x) => nearLL(x, "京都", 0.05))) add("FEATURE", `替代推薦卡片座標不在京都 Mock 座標附近（${ll.slice(0, 3).map((x) => `${x.lat},${x.lng}`).join("；")}）`, ["NM", 18]);
    const tr = (t.trust ?? []).filter((x) => x.status === "trusted");
    if (tr.some((x) => K(x.destination) !== "京都")) add("SAFETY", `替代推薦可信判定含京都以外（${tr.map((x) => x.destination).join(",")}）`, ["NM"]);
    if (c.tc !== "京都") add(c.tc && c.tc !== "?" ? "SAFETY" : "FEATURE", `替代推薦後 travelContext=${c.tc ?? "-"}（Session 與京都卡片不一致）`, ["NM"]);
    for (const [k, v] of [["recommendationSession", c.rec], ["activeRecommendationContext", c.arc], ["tripPlanningContext", c.tpc], ["tripDestination", c.trip]]) if (v && v !== "京都") add("SAFETY", `替代推薦後 ${k}=${v}（Session 與京都卡片不一致）`, ["NM"]);
    if (dsOf(pend)) add("FEATURE", `替代推薦後出現 destination_switch Pending（${pendingStr(pend)}）`, ["NM"]);
    if (t.r20End) for (const d of ["金澤", "大阪"]) for (const k of GEO_PROJ_KEYS) if (Ks(canon(t.r20End[k])).includes(d)) add("SAFETY", `替代推薦後 Session ${k} 含 ${d}（${canon(t.r20End[k]).slice(0, 60)}）`, ["NM"]);
    for (const x of noMoreCreditsFails(t)) add("SAFETY", x, ["NM", 20]); // A2-MP-T46（裁決 (三)）：有卡片依既有契約 reserve 1→commit 1；無卡片只允許 reserve→rollback 恰一次
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
  } else if (kind === "newTrip") {
    // A2-MP-T18（C2）：正常新行程（大阪未被否定）→ 既有 city_changed 重置保留（京都推薦池／Context 不再沿用、不以京都搜尋扣點）
    if (dsOf(pend)) add("FEATURE", `新行程後出現 destination_switch Pending（${pendingStr(pend)}）`, ["C2"]);
    if (kyotoShown) add("OLD-CITY", `新行程（大阪）仍以京都搜尋／扣點／顯示（${fmt(c)}）`, ["C2"]);
    if (c.rec === "京都" || c.arc === "京都") add("FEATURE", `既有新行程重置行為未保留：京都推薦池／Context 仍在（rec=${c.rec ?? "-"} Context=${c.arc ?? "-"}）`, ["C2"]);
    if (![c.tc, c.tpc, c.trip].includes("大阪")) add("FEATURE", `新行程目的地未成為大阪（travelContext=${c.tc ?? "-"} tpc=${c.tpc ?? "-"} trip=${c.trip ?? "-"}）`, ["C2"]);
  } else if (kind === "sameCityArea") {
    // A2-MP-T18（C2）：同城市行政區切換＝既有行為（cross-destination MP-05g；post-MP25 施工前實測〔mp-cross-r4-r21-T16.log〕：京都東山驗證不成立 → Fail Closed＋
    // destination_switch Pending〔raw 京都東山〕、不沿用京都城市池、不搜尋不扣點；驗證成立時卡片／Credits 只能是東山）。E2 不得讓此句觸發重置。
    const dsp = dsOf(pend);
    if (dsp && (K(dsp.rawGeographicLabel) !== "東山" || K(dsp.previousConfirmedDestination) !== "京都")) add("FEATURE", `同城行政區切換的 destination_switch Pending 不是 京都東山／prev 京都（${pendingStr(pend)}）`, ["C2"]);
    if (c.cards.some((d) => d !== "東山") || c.places.some((d) => d !== "東山")) add("OLD-CITY", `同城行政區切換沿用京都城市池或非東山卡片／搜尋（${fmt(c)}）`, ["C2"]);
    if (c.credits.length && c.credits.some((d) => d !== "東山")) add("OLD-CITY", `同城行政區切換 Credits metadata 不是東山（${c.credits.join(",")}）`, ["C2", 20]);
    if (!c.cards.length && !dsp) add("FEATURE", `同城行政區切換既沒有東山卡片也沒有保存切換意圖（${fmt(c)} pending=${pendingStr(pend)}）`, ["C2"]);
    if (!c.cards.length && (c.rec !== "京都" || c.tc !== "京都")) add("FEATURE", `同城行政區切換未成立卻改寫京都推薦池／travelContext（rec=${c.rec ?? "-"} travelContext=${c.tc ?? "-"}；不得觸發重置）`, ["C2"]);
    if (shown.includes("金澤") || shown.includes("大阪")) add("SAFETY", `同城行政區切換出現其他城市（${fmt(c)}）`, ["C2"]);
    if (t.r20Start && t.r20End && canon(t.r20Start.activeCategoryIntent) !== canon(t.r20End.activeCategoryIntent)) add("FEATURE", `同城行政區切換改變 activeCategoryIntent ${t.r20Start.activeCategoryIntent ?? "-"}→${t.r20End.activeCategoryIntent ?? "-"}`, [17, "C2"]);
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
    // r4（修正 1）：所有候選地名皆檢查（含「大阪了換金澤」這類同時含兩個城市的查詢字串／欄位）
    const OC = ctx.otherCity;
    if (geoAll(t, OC).length) add("SAFETY", `原句夾帶的其他城市「${OC}」被送去 Provider（${geoAll(t, OC).join(",")}）`, [14]);
    const ca = colsAll(t);
    if ([...ca.credits, ...ca.cards, ...ca.places].includes(OC)) add("SAFETY", `原句夾帶的其他城市「${OC}」被搜尋／扣點／顯示（${fmt(c)}）`, [14]);
    for (const [k, v] of [["travelContext", t.sessionDest], ["tripPlanningContext", t.r18Tpc], ["tripDestination", t.r18TripDest], ["recommendationSession", t.r15Rec?.destination], ["activeRecommendationContext", t.r17Arc?.destinationName]]) if (Ks(v).includes(OC)) add("SAFETY", `${k} 寫入原句夾帶的其他城市「${OC}」（${v}）`, [14]);
    if (pend?.kind === "destination_switch" && Ks(pend.rawGeographicLabel).includes(OC)) add("SAFETY", `Pending rawGeographicLabel 含原句夾帶的其他城市「${OC}」（${pend.rawGeographicLabel}）`, [14]);
    // A2-MP-T18（S8）：Session 地理投影（含 location／nearbyLocationAuthority／searchScope／preferredArea 等）本輪新出現被否定的城市 → SAFETY
    if (t.r20End) for (const k of GEO_PROJ_KEYS) if (Ks(canon(t.r20End[k])).includes(OC) && !Ks(canon(t.r20Start?.[k])).includes(OC)) add("SAFETY", `Session ${k} 寫入原句夾帶（被否定）的其他城市「${OC}」（${canon(t.r20End[k]).slice(0, 80)}）`, [14, "S8"]);
  }
  // A2-MP-T18（S8 exactRaw）：Pending raw 與送 Provider 的金澤驗證查詢字串必須是乾淨地名（不得是「成金澤」「大阪了換金澤再」之類片段）
  if (ctx.exactRaw) {
    if (pend?.kind === "destination_switch" && !KZ_RAW_OK.includes(String(pend.rawGeographicLabel ?? "").trim())) add("SAFETY", `Pending rawGeographicLabel=${JSON.stringify(String(pend.rawGeographicLabel ?? "").slice(0, 40))} 不是乾淨的目的地名稱（只允許 ${KZ_RAW_OK.join("／")}）`, [14, "S8"]);
    for (const gq of (t.geocodes ?? []).filter((x) => !isWeatherGeo(x))) {
      const q = String(gq).split(":").slice(1).join(":").trim();
      // 正式查詢變體表的「金沢市, 石川県, 日本」形式（含逗號）不在此列；只抓整段原句片段
      if (Ks(q).includes("金澤") && !q.includes(",") && !KZ_RAW_OK.includes(q)) add("SAFETY", `送 Provider 的金澤驗證查詢字串不乾淨（${JSON.stringify(q.slice(0, 40))}）`, [14, "S8"]);
    }
  }
  // A2-MP-T18（S8 keepPool）：否定語句輪不得觸發重置（不得清空京都推薦池／Context／類別）
  if (ctx.keepPool && t.r20Start && t.r20End) {
    if (canon(t.r20Start.activeCategoryIntent) !== canon(t.r20End.activeCategoryIntent)) add("SAFETY", `否定語句輪 activeCategoryIntent 被清除／改變 ${t.r20Start.activeCategoryIntent ?? "-"}→${t.r20End.activeCategoryIntent ?? "-"}（不得觸發重置）`, [17, "S8"]);
    if (K(t.r18RecAtStart) === OLDC && c.rec !== OLDC) add("SAFETY", `否定語句輪清掉${OLDC}推薦池（recommendationSession=${c.rec ?? "-"}；不得觸發重置）`, ["S8"]);
    if (K(t.r18ArcAtStart) === OLDC && c.arc !== OLDC) add("SAFETY", `否定語句輪清掉${OLDC}推薦 Context（activeRecommendationContext=${c.arc ?? "-"}；不得觸發重置）`, ["S8"]);
  }
  // 本輪經過 r13 模型「未重建」路徑（下游未執行正式碼）：失敗只能記為 MODEL（UNVERIFIED），不作為 PASS 也不作為正式碼 P1
  if (/未重建/.test(String(t.path ?? ""))) return out.map((x) => ({ cat: x.cat === "INFRA" ? "INFRA" : "MODEL", msg: `${x.msg}（r13 模型未重建路徑：${String(t.path).slice(0, 60)}）`, tags: x.tags }));
  return out;
}

// ════════════════ 單一情境評估（report 與 --self-test 共用）════════════════
const CAT_EXPECTED = new Set(["PENDING", "OLD-CITY", "FEATURE"]);
const KZ_CONFIRM_KINDS = ["switchFail", "confirmNew", "confirmFail", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold", "negSwitch", "negSwitchYes"]; // A2-MP-T24：＋negSwitch／negSwitchYes（取代 18b～18d 的 switchFail／confirmNew；點名輪數不變＝2）
const YES_KINDS = ["confirmNew", "confirmFail", "confirmCapped", "forgedOk", "forgedHold", "forgedPrevYes", "forgedPrevHold", "negSwitchYes"]; // A2-MP-T24：＋negSwitchYes（「好」輪京都檢查照舊歸入項目 2）
/**
 * A2-MP-T24（使用者裁決 3）：18b～18d 路由彈性。negSwitch → 輪末有 destination_switch Pending 時以 switchFail 嚴格判定（MP-25 路徑），否則一般流程 negSwitch；
 * negSwitchYes → 輪初有 destination_switch Pending 時以 confirmNew 嚴格判定，否則一般流程 negSwitchYes。其他 kind 原樣。
 */
const resolveKind = (kind, t) => (!t ? kind : kind === "negSwitch" ? (dsOf(pendingOf(t)) ? "switchFail" : "negSwitch") : kind === "negSwitchYes" ? (dsOf(t?.r18PendingAtStart) ? "confirmNew" : "negSwitchYes") : kind);
/** confirmationAttempts 應計入的「確認驗證」輪（建立 Pending 之後、針對同一 Pending 的驗證）。 */
const CONFIRM_VAL_KINDS = ["confirmFail", "confirmCapped", "rebuildCapped", "forgedHold", "forgedPrevHold", "forgedOk", "forgedPrevYes", "confirmNew"];
/**
 * 一個情境 × 一棵樹。turns＝子程序輪次記錄（或自我測試的合成資料）。回傳 { fails, lines, na, model, tagged, ids }。
 * identity 狀態（r4 修正 3）：Map<idKey, { v, confirmed, attemptsMax, confirmVal, asks, heldAfterCap, creation, synthetic }>。
 */
function evalScenario({ s, turns, refCost, LIM, ev, tree = "work", mp1Turns = null }) {
  const SF = { fails: [], model: [], na: [], ran: 1 };
  const lines = [];
  const tagged = {};
  const push = (x) => {
    SF.fails.push(x);
    for (const tg of x.tags ?? []) (tagged[tg] ??= []).push(x);
  };
  const ids = new Map();
  const st = (k, init = {}) => {
    if (!ids.has(k)) ids.set(k, { v: 0, confirmed: false, attemptsMax: 0, confirmVal: 0, asks: 0, heldAfterCap: 0, creation: undefined, synthetic: false, flaggedV: false, ...init });
    return ids.get(k);
  };
  let kzConfirmedBefore = false;
  let kzGeoTotal = 0;
  const originCat = s.r15Init?.topic ?? "attraction";
  const isRef = s.case === "REF";
  for (const [i, kindSpec] of s.expect.entries()) {
    const t = turnOf(turns, i);
    const kind = resolveKind(kindSpec, t); // A2-MP-T24：只對 negSwitch／negSwitchYes 有作用（其他 kind 原樣）
    if (!t) {
      push({ cat: "INFRA", msg: `${s.id} T${i + 1} 缺失`, tags: [] });
      lines.push(`  ${tree.padEnd(5)} T${i + 1} 缺失`);
      continue;
    }
    if (t.error) push({ cat: "INFRA", msg: `${s.id} T${i + 1} ${String(t.error).slice(0, 160)}`, tags: [] });
    const pend = pendingOf(t);
    const turnText = typeof s.turns[i] === "string" ? s.turns[i] : (s.turns[i]?.text ?? null);
    const startP = dsOf(t.r18PendingAtStart);
    const endP = dsOf(pend);
    const startK = startP ? idKey(startP) : null;
    const endK = endP ? idKey(endP) : null;
    const sameAsStart = Boolean(startK && endK && startK === endK);
    // 建立輪原句：輪初第一次看到、且情境內沒有建立紀錄（Client 注入／r18Pending）→ 未知（null）；本輪新寫入（identity ≠ 輪初）→ 本輪原句
    if (startK && st(startK).creation === undefined) st(startK).creation = null;
    if (endK && !sameAsStart) st(endK).creation = turnText;
    // 本輪 V(金澤) 歸屬（見檔頭「驗證歸屬」）
    const vK = geoV(t, "金澤").length;
    let attrK = null;
    if (endP && !sameAsStart && K(endP.rawGeographicLabel) === "金澤") attrK = endK;
    else if (startP && K(startP.rawGeographicLabel) === "金澤") attrK = startK;
    else if (endP && K(endP.rawGeographicLabel) === "金澤") attrK = endK;
    else if (vK) {
      attrK = JSON.stringify(["destination_switch", "金澤", String(t.r20Start?.rec?.destination ?? t.r20Start?.tc?.destination ?? "").trim(), t.r20Start?.activeCategoryIntent ?? null, "more_places"]);
      st(attrK).synthetic = true;
    }
    const valThis = CONFIRM_VAL_KINDS.includes(kind) && kind !== "confirmNew" ? vK : 0;
    const ctx = {
      kzConfirmedBefore,
      restoredPending: s.reloadAfter != null && i === s.reloadAfter + 1 ? t.r18PendingAtStart : null,
      trusted: s.trusted ?? "京都",
      forgedPrev: s.forgedPrev ?? "大阪",
      otherCity: s.otherCity ?? null,
      pendCat: s.pendCat && s.expect[i] === "switchFail" ? s.pendCat : null,
      forgedCatTurn: s.pendCat && s.r18Pending && i === 0 ? s.pendCat : null,
      originCat,
      pendRef: endK ? (sameAsStart ? st(endK).creation ?? null : turnText) : null,
      pendCreated: Boolean(endK && !sameAsStart),
      attemptsStart: sameAsStart && Number.isInteger(startP.confirmationAttempts) ? startP.confirmationAttempts : null,
      turnText,
      attemptsMax: endK ? st(endK).attemptsMax : 0,
      confirmVal: endK ? st(endK).confirmVal + (attrK === endK ? valThis : 0) : 0,
      ref: refCost ?? null,
      lim: LIM,
      evidence: ev,
      exactRaw: Boolean(s.exactRaw), // A2-MP-T18（S8）
      keepPool: (s.keepPool ?? []).includes(i), // A2-MP-T18（S8）
    };
    const f = judgeTurn(kind, t, ctx);
    if (s.restoredAt === i && !isSwitchPending(t.r18PendingAtStart)) f.push({ cat: "PENDING", msg: `重新載入後 pending 未恢復（輪初 ${pendingStr(t.r18PendingAtStart)}）`, tags: [15] });
    const turnSpec = s.turns[i];
    // 修正 2（r3）：故障只在實際進入相關路徑（pushMorePlaceRecommendations 被呼叫）時才要求生效；未進入 → N/A（由行為斷言判定）
    if (turnSpec && typeof turnSpec === "object" && turnSpec.fault) {
      const called = (t.r14Calls ?? []).some((x) => String(x).startsWith("more=")) || (t.r19Faults ?? []).length > 0;
      if (!called) SF.na.push(`${s.id} T${i + 1}：pushMorePlaceRecommendations 未被呼叫 → 故障注入檢查 N/A（行為斷言照判）`);
      else if (!(t.r19Faults ?? []).length) f.push({ cat: "INFRA", msg: `pushMorePlaceRecommendations 已呼叫但故障未注入（calls=${(t.r14Calls ?? []).join(",")}）`, tags: [] });
      else if (!/r19:fault/.test(String(t.path ?? "")) && !t.error) f.push({ cat: "INFRA", msg: `故障已注入但未走到正式 catch 模型（path=${String(t.path ?? "").slice(0, 80)}）`, tags: [] });
    }
    if ((s.requireFbContinue ?? []).includes(i) && !/r18:fbContinue\(real\)/.test(String(t.path ?? ""))) f.push({ cat: "INFRA", msg: `故障模式未走到正式 fallback continue（path=${String(t.path ?? "").slice(0, 100)}）`, tags: [] });
    // ── A2-MP-T18（M1 嚴格上限；使用者裁決）：本輪「開始時」該 identity 是否已達任一上限（驗證 ≥2、confirmationAttempts ≥2、確認詢問 ≥3）──
    const capK = attrK ?? startK ?? endK;
    const capS = capK ? st(capK) : null;
    const capBy = [];
    if (!isRef && capS && !capS.confirmed) {
      if (capS.v >= LIMITS.validatePerPending) capBy.push(`驗證=${capS.v}≥${LIMITS.validatePerPending}`);
      const attNow = Math.max(capS.attemptsMax, capK === startK && Number.isInteger(startP?.confirmationAttempts) ? startP.confirmationAttempts : 0);
      if (attNow >= LIMITS.attemptsCap) capBy.push(`confirmationAttempts=${attNow}≥${LIMITS.attemptsCap}`);
      if (capS.asks >= LIMITS.asksPerPending) capBy.push(`確認詢問=${capS.asks}≥${LIMITS.asksPerPending}`);
    }
    let m1Flagged = false;
    if (capBy.length && !M1_EXEMPT_KINDS.includes(kind)) {
      let raw = null;
      try {
        raw = JSON.parse(capK)[1] || null;
      } catch {
        raw = null;
      }
      const vCap = raw ? geoV(t, raw) : [];
      const trustCap = raw ? (t.trust ?? []).filter((x) => Ks(x.label).includes(raw)) : [];
      const sameCap = Boolean(endK && endK === capK);
      const rewrittenCap = sameCap && (!sameAsStart || canon(endP) !== canon(startP));
      const advancedCap = sameCap && sameAsStart && Number.isInteger(endP.confirmationAttempts) && Number.isInteger(startP.confirmationAttempts) && endP.confirmationAttempts > startP.confirmationAttempts;
      const crCap = (t.creditsRpc ?? []).filter((x) => /^credits_/.test(x));
      const why = [
        vCap.length ? `Provider 驗證 ${vCap.length} 次（${vCap.join(",")}）` : "",
        !vCap.length && trustCap.length ? `進入該 identity 的可信判定／驗證入口 ${trustCap.length} 次（嚴格選項；${trustCap.map((x) => `${x.status}:${x.reason ?? x.destination ?? "-"}`).join(",")}）` : "",
        advancedCap ? `confirmationAttempts 增加 ${startP.confirmationAttempts}→${endP.confirmationAttempts}` : "",
        rewrittenCap ? "Pending 被新寫入／改寫" : "",
        (t.placesRequests ?? 0) ? `Places ${t.placesRequests} 次` : "",
        (t.builderCalls ?? 0) ? `Builder ${t.builderCalls} 次` : "",
        (t.weatherCalls ?? 0) ? `Weather ${t.weatherCalls} 次` : "",
        crCap.length || (t.r15Credits ?? []).length ? `Credits（begin=${(t.r15Credits ?? []).length} RPC=${crCap.join(",") || "-"}）` : "",
      ].filter(Boolean);
      if (why.length) {
        m1Flagged = true;
        f.push({ cat: "SAFETY", msg: `同一 Pending（identity ${idLabel(capK)}）本輪開始時已達上限（${capBy.join("、")}）後仍${why.join("、")}＝M1 嚴格上限違反（不得自動驗證／再次要求確認／增加 attempts／改寫 Pending／呼叫 Places・Builder・Weather／開始 Credits）`, tags: [10, 11, "S1", "S7"] });
      }
    }
    // ── A2-MP-T18（S9 r21-C）：r21ClockByTurn 必須確實生效（子程序 obs.r21Clock＝本輪累計偏移）；沒有此欄位的情境不得出現 r21Clock ──
    {
      const wantClock = s.r21ClockByTurn ? Object.entries(s.r21ClockByTurn).filter(([k]) => Number(k) <= t.turnIndex).reduce((a, [, v]) => a + Number(v), 0) : undefined;
      if (s.r21ClockByTurn ? t.r21Clock !== wantClock : t.r21Clock !== undefined) f.push({ cat: "INFRA", msg: `r21-C 時間偏移未生效／不應出現（期望 r21Clock=${wantClock ?? "（無欄位）"}，實際=${JSON.stringify(t.r21Clock ?? null)}）`, tags: [] });
    }
    // ── A2-MP-T18（S9 turnExpect）：本輪 V(金澤) 次數與 attempts 增量依正式契約 ──
    {
      const te = s.turnExpect?.[i];
      if (te) {
        if (te.v !== undefined && vK !== te.v) f.push({ cat: vK > te.v ? "SAFETY" : "FEATURE", msg: `本輪金澤 Provider 驗證=${vK}（${(t.geocodes ?? []).join(",") || "-"}），依正式契約應=${te.v}〔${te.why ?? "-"}〕`, tags: vK > te.v ? [19, "S9"] : ["S9"] });
        if (te.attemptsDelta !== undefined) {
          const a0 = startP?.confirmationAttempts;
          const a1 = endP?.confirmationAttempts;
          if (!sameAsStart || !Number.isInteger(a0) || !Number.isInteger(a1)) f.push({ cat: "PENDING", msg: `無法比對 confirmationAttempts 增量（輪初 ${pendingStr(startP)}／輪末 ${pendingStr(endP)}；應為同一 Pending，增量 ${te.attemptsDelta}）〔${te.why ?? "-"}〕`, tags: ["S9"] });
          else if (a1 - a0 !== te.attemptsDelta) f.push({ cat: "FEATURE", msg: `confirmationAttempts ${a0}→${a1}（增量 ${a1 - a0}），依正式契約增量應=${te.attemptsDelta}〔${te.why ?? "-"}〕`, tags: [11, "S9"] });
        }
      }
    }
    // ── r4（修正 3／5）：依 identity 統計驗證／確認請求（依確認行為，不依問號或文案）──
    if (!isRef && attrK) {
      const S = st(attrK);
      const before = S.v;
      if (!S.confirmed) S.v += vK;
      if (S.v > LIMITS.validatePerPending && !S.flaggedV) {
        S.flaggedV = true;
        f.push({ cat: "SAFETY", msg: `同一 Pending（identity ${idLabel(attrK)}${S.synthetic ? "；無 Pending，以輪初情境推得" : ""}）驗證=${S.v} > ${LIMITS.validatePerPending}（本輪前 ${before}）`, tags: [11, "S2"] });
      }
      S.confirmVal += valThis;
      if (trustedIn(t, "金澤")) S.confirmed = true;
    }
    if (!isRef && endP && !(t.r15Cards ?? []).length && assistantFull(t).map((x) => String(x).trim()).filter(Boolean).length) {
      const S = st(endK);
      const vThis = attrK === endK ? vK : 0;
      const vBefore = S.v - vThis;
      const rewritten = !sameAsStart || canon(endP) !== canon(startP);
      const advanced = vThis > 0 || (sameAsStart && Number.isInteger(endP.confirmationAttempts) && Number.isInteger(startP.confirmationAttempts) && endP.confirmationAttempts > startP.confirmationAttempts);
      // A2-MP-T18（M1）：原條件只看驗證次數；另加「確認詢問未達 3」「confirmationAttempts 未達 2」（任一達上限 → 不計確認請求）
      const endCapBy = endK === capK ? capBy : [...(vBefore >= LIMITS.validatePerPending ? [`驗證=${vBefore}≥${LIMITS.validatePerPending}`] : []), ...(S.attemptsMax >= LIMITS.attemptsCap ? [`confirmationAttempts=${S.attemptsMax}≥${LIMITS.attemptsCap}`] : []), ...(S.asks >= LIMITS.asksPerPending ? [`確認詢問=${S.asks}≥${LIMITS.asksPerPending}`] : [])];
      if (vBefore < LIMITS.validatePerPending && !endCapBy.length) {
        S.asks += 1;
        if (S.asks > LIMITS.asksPerPending) f.push({ cat: "SAFETY", msg: `同一 Pending（identity ${idLabel(endK)}）第 ${S.asks} 次確認請求（>${LIMITS.asksPerPending}）＝重複詢問（依確認行為：輪末持有 Pending＋新助理訊息＋無卡片）`, tags: [10] });
      } else if (rewritten || advanced) f.push({ cat: "SAFETY", msg: `同一 Pending（identity ${idLabel(endK)}）已達上限（${endCapBy.join("、") || `驗證=${vBefore}≥${LIMITS.validatePerPending}`}）後再次推進確認流程（${[vThis ? `本輪驗證 ${vThis}` : "", advanced && !vThis ? "confirmationAttempts 增加" : "", rewritten ? "Pending 被新寫入／改寫" : ""].filter(Boolean).join("、")}）＝重複確認`, tags: [10, "S1"] });
      else if (!m1Flagged) S.heldAfterCap += 1;
    }
    if (endK && Number.isInteger(endP.confirmationAttempts)) st(endK).attemptsMax = Math.max(st(endK).attemptsMax, endP.confirmationAttempts);
    kzGeoTotal += vK;
    kzConfirmedBefore = kzConfirmedBefore || trustedIn(t, "金澤");
    lines.push(`  ${tree.padEnd(5)} T${i + 1}「${t.text}」（${kind}${kind !== kindSpec ? `←${kindSpec}` : ""}） ${fmt(cols(t))} pending=${pendingStr(pend)}`); // A2-MP-T24：只加註路由解析
    lines.push(`        path=${String(t.path ?? "").slice(0, 220)} geocode=${(t.geocodes ?? []).length}[${(t.geocodes ?? []).join(",")}] V(金澤)=${vK} WG=${weatherGeo(t).length} W=${t.weatherCalls ?? 0} placesReq=${t.placesRequests ?? 0} builder=${t.builderCalls ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] db寫入=${(t.r20Db ?? []).filter((x) => DB_WRITE_RE.test(x)).length} r21寫入=${(t.r21Writes ?? []).length}${t.r21SendExc ? `（send層 ${t.r21SendExc.ok ? "OK" : "P1"}）` : ""} trust=${(t.trust ?? []).map((x) => `${x.status}:${x.destination ?? x.reason ?? "-"}${x.center ? `@${x.center.lat},${x.center.lng}` : ""}`).join(",") || "-"}`);
    lines.push(`        助理=${JSON.stringify(assistantOf(t).map((x) => x.slice(0, 60)))} altOffer=${JSON.stringify(t.r20AltOffer ?? null)} aci=${t.r20Start?.activeCategoryIntent ?? "-"}→${t.r20End?.activeCategoryIntent ?? "-"}${t.r19Exc?.length ? ` r19Exc=${JSON.stringify(t.r19Exc).slice(0, 300)}` : ""}`);
    if (f.length) lines.push(`        ✗ ${f.map((x) => `[${x.cat}] ${x.msg}`).join("；")}`);
    for (const x of f) push({ ...x, msg: `${s.id} T${i + 1}：${x.msg}` });
    if (/未重建/.test(String(t.path ?? ""))) SF.model.push(`${s.id} T${i + 1}`);
    const modelTurn = /未重建/.test(String(t.path ?? ""));
    const tc = cols(t);
    // 2：「好」那一輪（確認 Pending）不得京都搜尋／扣點／顯示（r2 #16）
    if (t.text === "好" && YES_KINDS.includes(kind)) {
      const k = [...tc.places, ...tc.credits, ...tc.cards].includes("京都");
      if (k) (tagged[2] ??= []).push({ cat: modelTurn ? "MODEL" : "OLD-CITY", msg: `${s.id} T${i + 1}：「好」輪京都 Places=${(t.placesQueries ?? []).filter((q) => K(String(q).split("@").at(-1)) === "京都").length} Credits=[${tc.credits.join(",") || "-"}] 卡片=[${tc.cards.join(",") || "-"}]` });
      else if (modelTurn) (tagged[2] ??= []).push({ cat: "MODEL", msg: `${s.id} T${i + 1}：模型路徑（UNVERIFIED）` });
    }
  }
  // 11：情境總金澤 Provider 驗證 ≤ 點名／確認輪數（r2／r3 保留）；r3 的「整個情境合計 ≤2」改為上方依 identity 分開（修正 3）
  const allowedKz = s.expect.filter((k) => KZ_CONFIRM_KINDS.includes(k)).length + (isRef ? Infinity : 0); // REF＝既有流程基準，不套 MP-25 上限
  if (kzGeoTotal > allowedKz) push({ cat: "SAFETY", msg: `${s.id}：情境總金澤 Provider 驗證=${kzGeoTotal} > 點名／確認輪數 ${allowedKz}`, tags: [11, 19] });
  if (s.case === 12 && mp1Turns && tree === "work") {
    const sum = (ts, fn) => ts.reduce((a, t) => a + fn(t), 0);
    if (sum(turns, (t) => t.geocodes?.length ?? 0) > sum(mp1Turns, (t) => t.geocodes?.length ?? 0)) push({ cat: "SAFETY", msg: `${s.id}：同城續推 geocode 次數高於 mp1`, tags: [] });
    if (sum(turns, (t) => t.placesRequests ?? 0) > sum(mp1Turns, (t) => t.placesRequests ?? 0)) push({ cat: "SAFETY", msg: `${s.id}：同城續推 Places 次數高於 mp1`, tags: [] });
  }
  const idSum = [...ids.entries()].map(([k, x]) => `[${idLabel(k)}${x.synthetic ? "（推得）" : ""}] 驗證=${x.v} 確認請求=${x.asks} 達上限後保留=${x.heldAfterCap} attempts max=${x.attemptsMax} 建立輪原句=${x.creation === undefined ? "-" : x.creation === null ? "未知" : JSON.stringify(x.creation.slice(0, 20))}`);
  lines.push(`  ${tree.padEnd(5)} 彙總：金澤驗證總=${kzGeoTotal}；identity：${idSum.join("；") || "-"}${SF.na.length ? ` N/A=${SF.na.join("；")}` : ""}`);
  return { SF, lines, tagged, ids };
}

/**
 * A2-MP-T42（M2）：情境結果併入項目列（report 與自我測試共用）。原 report L1252-1254 的三行原樣保留；
 * 另把 SF.model（evalScenario 記下的 r13 模型「未重建」路徑輪 `${id} T${n}`）計入 R.model —— 原本只有 cat=MODEL 的失敗才計入，
 * 模型路徑 0 失敗的輪次因此被列成 PASS（mp25-r4-full-T35.log 項目 15、16）。已有同輪 MODEL 失敗者不重複加入。不改變 R.fails（FAIL 判定不變）。
 */
function addScenToRow(R, SF) {
  R.ran += 1;
  for (const x of SF.fails) (x.cat === "MODEL" ? R.model : R.fails).push(x);
  for (const m of SF.model ?? []) if (!R.model.some((x) => String(x?.msg ?? x).startsWith(`${m}：`))) R.model.push({ cat: "MODEL", msg: `${m}：經過 r13 模型「未重建」路徑（正式碼未執行；0 失敗也不得列 PASS → UNVERIFIED）`, tags: [] });
  R.na.push(...SF.na);
}
/** A2-MP-T42（M2）：項目列判定（＝原 report L1290 式子，未改）。 */
const rowVerdict = (r) => (r.fails.length ? "FAIL" : r.model.length ? "UNVERIFIED" : "PASS");
/** A2-MP-T42（M2）：項目列判定自我測試（合成 SF；證明模型路徑 0 失敗 → UNVERIFIED，且 FAIL 不受影響）。 */
function rowVerdictCases() {
  const SFx = (fails = [], model = []) => ({ fails, model, na: [], ran: 1 });
  const mk = (...sfs) => {
    const R = { fails: [], ran: 0, model: [], na: [] };
    for (const sf of sfs) addScenToRow(R, sf);
    return R;
  };
  return [
    { name: "M2a 模型路徑輪 0 失敗（SF.model=[X T4]、fails=[]；＝T35 項目 15／16 的形狀）→ UNVERIFIED（不得 PASS）", R: mk(SFx([], ["MP25R4-10-cancel-reload T4"])), want: "UNVERIFIED" },
    { name: "M2a 對照：無模型輪、0 失敗 → PASS", R: mk(SFx([], [])), want: "PASS" },
    { name: "M2b 模型路徑輪＋另一情境有 FEATURE 失敗 → 仍 FAIL（M2 不改變 FAIL 判定）", R: mk(SFx([], ["X T4"]), SFx([{ cat: "FEATURE", msg: "Y T2：x", tags: [] }], [])), want: "FAIL" },
    { name: "M2c 同輪已有 MODEL 失敗 → 不重複計入（模型輪數＝1）", R: mk(SFx([{ cat: "MODEL", msg: "X T4：m", tags: [] }], ["X T4"])), want: "UNVERIFIED", n: 1 },
  ];
}

// ════════════════ 偵測器自我測試（合成資料；每次 report 前執行，也可 --self-test 單獨執行）════════════════
const SYN_P = (o = {}) => ({ kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: T2, confirmationAttempts: 1, ...o });
const SYN_PROJ = (o = {}) => ({ tc: { destination: "京都" }, tpc: null, trip: null, rec: { destination: "京都", searchScope: "city" }, arc: null, location: null, nla: null, explicitSearchScope: null, searchScope: null, radius: null, preferredArea: null, activeCategoryIntent: "attraction", pendingQuestion: null, lastAssistantReply: null, ...o });
const SYN_ASK = "目前無法確認金澤，要改成金澤嗎？還是繼續京都？";
function synTurn(i, text, o = {}) {
  return { turnIndex: i, text, geocodes: [], placesRequests: 0, builderCalls: 0, weatherCalls: 0, r15Cards: [], r15Credits: [], creditsSettle: [], creditsRpc: [], r18Pending: null, r18PendingAtStart: null, r20Start: SYN_PROJ(), r20End: SYN_PROJ(), r20Assistant: [SYN_ASK], r15Assistant: [SYN_ASK], r20AltOffer: [false], r20Db: [], r20CoordHits: {}, r20CardLL: [], trust: [], path: "|real:more=F", r14Violations: [], r18Weather: [], placesQueries: [], r15Rec: { destination: "京都" }, r17Arc: null, sessionDest: "京都", r18Tpc: null, r18TripDest: null, r21Writes: [], ...o };
}
const SYN = {
  origin: (i = 0) => synTurn(i, T1, { r15Cards: [{ name: "京都地點1", id: "ChIJ-k1" }], r15Credits: [{ destination: "京都" }], creditsSettle: [true], creditsRpc: ["credits_check", "credits_reserve", "credits_commit"], placesRequests: 1, builderCalls: 1, placesQueries: ["景點@京都"], trust: [{ status: "trusted", destination: "京都", label: "京都", center: COORDS.京都 }], r20Assistant: ["在京都，這些地方值得先看看："], r15Assistant: ["在京都，這些地方值得先看看："], r20Start: SYN_PROJ({ tc: null, rec: null, activeCategoryIntent: null }) }),
  /** 切換失敗輪：寫入 Pending（attempts=1，含切換輪驗證）。 */
  switchFail: (i, p = SYN_P(), text = T2, o = {}) => synTurn(i, text, { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", destination: null, reason: "timeout" }], r18Pending: p, r21Writes: [{ p, inFrame: false }], ...o }),
  confirmFail: (i, start, end, o = {}) => synTurn(i, "好", { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", destination: null, reason: "timeout" }], r18PendingAtStart: start, r18Pending: end, r21Writes: [{ p: end, inFrame: true }], ...o }),
  /** 原樣保留（不驗證、不推進）＋說明文字（含問號）。 */
  keep: (i, text, p, o = {}) => synTurn(i, text, { r18PendingAtStart: p, r18Pending: p, r20Assistant: ["目前仍無法確認金澤。你可以重新指定目的地，或說「繼續京都」？"], r15Assistant: ["目前仍無法確認金澤。你可以重新指定目的地，或說「繼續京都」？"], ...o }),
  confirmNew: (i, start, o = {}) => synTurn(i, "好", { geocodes: ["more_validate:金澤", "weather:金沢市, 石川県, 日本"], trust: [{ status: "trusted", destination: "金澤", label: "金澤", center: COORDS.金澤 }], placesRequests: 1, builderCalls: 1, weatherCalls: 1, r15Cards: [{ name: "金澤地點1", id: "ChIJ-z1" }], r20CardLL: [{ lat: 36.562, lng: 136.657 }], r15Credits: [{ destination: "金澤" }], creditsSettle: [true], creditsRpc: ["credits_check", "credits_reserve", "credits_commit"], placesQueries: ["景點@金澤"], r15Rec: { destination: "金澤" }, sessionDest: "金澤", r18PendingAtStart: start, r18Pending: null, r18Weather: [{ phase: "weather", data: "[36.5613,136.6562]" }], r20End: SYN_PROJ({ tc: { destination: "金澤" }, rec: { destination: "金澤", searchScope: "city" } }), r20Assistant: ["在金澤，這些地方值得先看看："], r15Assistant: ["在金澤，這些地方值得先看看："], ...o }),
};
const SYN_REF = { places: 1, builder: 1, weather: 1, weatherGeo: 1, begins: 1, v: 1 };
const SYN_LIM = () => globalThis.__R20_LIMITS ?? null;
/**
 * A2-MP-T24（使用者裁決 3）：18b～18d 路由期望（negSwitch／negSwitchYes）自我測試。情境欄位與 18b 相同（otherCity／exactRaw／keepPool [1]）。
 * 正確行為兩種路由都不得誤判（E0 一般流程、E0b MP-25 Pending 路徑）；MP-25 路徑仍以 switchFail／confirmNew 嚴格判定（E0c）；負向探針 E1～E10。
 */
function negSwitchCases() {
  const sNeg = (id) => ({ id: `SELF-neg-${id}`, case: 0, items: [], expect: ["origin", "negSwitch", "negSwitchYes"], turns: [T1, T2_NEG_B, "好"], otherCity: "大阪", exactRaw: true, keepPool: [1] });
  const genT2 = (o = {}) => synTurn(1, T2_NEG_B, { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", destination: null, reason: "timeout" }], ...o });
  const PN = SYN_P({ originalUserText: T2_NEG_B });
  const KY_COST = { placesRequests: 1, placesQueries: ["景點@京都"], r15Cards: [{ name: "京都地點1", id: "ChIJ-k1" }], r15Credits: [{ destination: "京都" }], creditsSettle: [true], creditsRpc: ["credits_check", "credits_reserve", "credits_commit"], builderCalls: 1 };
  const NOMORE = "我目前找不到更多符合條件的地點，要不要換成美食、咖啡廳或室內景點？";
  const STOPPED_ZH = "還是無法確認「金澤」，這次先停在這裡，不會搜尋也不會扣點。你可以換個寫法重新告訴我目的地，或說「繼續京都」。"; // A2-MP-T40：E2f 實際文案（chat-runtime.ts L36）
  const hasLine = (r, s) => (r?.lines ?? []).some((l) => l.includes(s));
  return [
    { name: "E0 一般流程正確：T2 無 Pending、京都保留、金澤 timeout；T3「好」金澤已確認卡片（negSwitch／negSwitchYes）→ 無任何失敗", s: sNeg("gen"), turns: [SYN.origin(0), genT2(), SYN.confirmNew(2, null)], re: /./, trigger: false, check: (r) => hasLine(r, "（negSwitch）") && hasLine(r, "（negSwitchYes）") },
    { name: "E0b MP-25 路徑正確：T2 寫入 Pending → 以 switchFail 判定；T3 → 以 confirmNew 判定 → 無任何失敗", s: sNeg("mp"), turns: [SYN.origin(0), SYN.switchFail(1, PN, T2_NEG_B), SYN.confirmNew(2, PN)], re: /./, trigger: false, check: (r) => hasLine(r, "（switchFail←negSwitch）") && hasLine(r, "（confirmNew←negSwitchYes）") },
    { name: "E0c MP-25 路徑仍嚴格：T2 Pending originatingRoute≠more_places → switchFail 觸發「未保存切換意圖」", s: sNeg("mpr"), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_NEG_B, originatingRoute: "trip_planning" }), T2_NEG_B), SYN.confirmNew(2, SYN_P({ originalUserText: T2_NEG_B, originatingRoute: "trip_planning" }))], re: /未保存切換意圖/, trigger: true },
    { name: "E1 一般流程 T2 送 Provider「大阪不去了換金澤」→ 觸發大阪被送去 Provider＋查詢字串不乾淨", s: sNeg("q"), turns: [SYN.origin(0), genT2({ geocodes: ["more_validate:大阪不去了換金澤"] }), SYN.confirmNew(2, null)], re: /原句夾帶的其他城市「大阪」被送去 Provider/, trigger: true, needAll: [/送 Provider 的金澤驗證查詢字串不乾淨（"大阪不去了換金澤"）/] },
    { name: "E2 一般流程 T2 清掉京都推薦池（keepPool）→ 觸發錯誤 Reset", s: sNeg("kp"), turns: [SYN.origin(0), genT2({ r18RecAtStart: "京都", r15Rec: null }), SYN.confirmNew(2, null)], re: /否定語句輪清掉京都推薦池/, trigger: true, needAll: [/否定語句切換輪金澤未確認卻覆蓋原本可信目的地：recommendationSession=-/] },
    { name: "E2b 一般流程 T2 activeCategoryIntent 被清除（keepPool）→ 觸發", s: sNeg("aci"), turns: [SYN.origin(0), genT2({ r20End: SYN_PROJ({ activeCategoryIntent: null }) }), SYN.confirmNew(2, null)], re: /否定語句輪 activeCategoryIntent 被清除／改變/, trigger: true },
    { name: "E3 一般流程 T2 travelContext 寫入大阪 → 觸發", s: sNeg("tc"), turns: [SYN.origin(0), genT2({ sessionDest: "大阪", r20End: SYN_PROJ({ tc: { destination: "大阪" } }) }), SYN.confirmNew(2, null)], re: /travelContext 寫入原句夾帶的其他城市「大阪」/, trigger: true, needAll: [/Session tc 寫入原句夾帶（被否定）的其他城市「大阪」/] },
    { name: "E4 一般流程 T2 以京都搜尋／扣點 → 觸發", s: sNeg("ky2"), turns: [SYN.origin(0), genT2(KY_COST), SYN.confirmNew(2, null)], re: /否定語句切換輪（金澤 Provider 失敗）仍搜尋 Places 1 次/, trigger: true, needAll: [/否定語句切換輪（金澤 Provider 失敗）仍開始 Credits/] },
    { name: "E5 一般流程 T2 noMore／替代推薦提問 → 觸發", s: sNeg("alt"), turns: [SYN.origin(0), genT2({ r15Assistant: [NOMORE], r20Assistant: [NOMORE], r20AltOffer: [true] }), SYN.confirmNew(2, null)], re: /Provider 失敗輪顯示 noMore／替代推薦提問/, trigger: true },
    { name: "E6 一般流程 T3「好」以京都搜尋／扣點／顯示 → 觸發", s: sNeg("ky3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { ...KY_COST, trust: [{ status: "trusted", destination: "京都", label: "京都", center: COORDS.京都 }] })], re: /否定語句切換後「好」仍以京都搜尋／扣點／顯示/, trigger: true },
    { name: "E7 一般流程 T3 金澤未確認即啟動 Credits → 觸發", s: sNeg("cr"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Credits: [{ destination: "金澤" }], creditsSettle: [false], creditsRpc: ["credits_check", "credits_reserve", "credits_rollback"] })], re: /否定語句切換後金澤未確認仍啟動 Credits/, trigger: true, needAll: [/Credits metadata\.destination＝未確認「金澤」/] },
    // A2-MP-T40（使用者契約 (二)）：E8 改判——沒有明確續推要求時不強制建立 Pending；T3 無 Pending、京都不變、不搜尋不扣點＝契約允許（原「觸發」與契約直接衝突）
    { name: "E8（A2-MP-T40 改判）一般流程 T3 無 Pending、京都不變、無卡片、不搜尋不扣點（E2f 後的實際形狀）→ 不觸發任何失敗", s: sNeg("lost"), turns: [SYN.origin(0), genT2({ r15Assistant: [STOPPED_ZH], r20Assistant: [STOPPED_ZH] }), synTurn(2, "好", { path: "|real:refine=F" })], re: /./, trigger: false },
    { name: "E8 對照：T3 金澤未確認但保留金澤 Pending、京都不變 → 不觸發「目的地不正確」", s: sNeg("keep"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r18Pending: PN })], re: /目的地不正確|錯誤 Reset|未確認仍啟動 Credits/, trigger: false },
    { name: "E8b（A2-MP-T40）T3 保留的切換意圖不是金澤（Pending raw＝京都東山）→ 觸發「目的地不正確」", s: sNeg("wrongp"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r18Pending: SYN_P({ rawGeographicLabel: "京都東山", originalUserText: T2_NEG_B }) })], re: /保留的切換意圖不是金澤/, trigger: true },
    { name: "E8c（A2-MP-T40）T3 走模型未重建路徑且 0 成本 → 記 MODEL（UNVERIFIED，不得 PASS）", s: sNeg("model"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { path: "later:other(未重建；planner/advice" })], re: /模型未重建路徑/, trigger: true, check: (r) => r.SF.fails.length > 0 && r.SF.fails.every((x) => x.cat === "MODEL") },
    { name: "E12（A2-MP-T40）T3 無 Pending 但提出 noMore／替代推薦提問（舊京都替代推薦）→ 觸發", s: sNeg("alt3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Assistant: [NOMORE], r20Assistant: [NOMORE], r20AltOffer: [true] })], re: /否定語句切換後「好」提出 noMore／替代推薦提問/, trigger: true },
    { name: "E13（A2-MP-T40）T3 無 Pending、金澤未確認仍搜尋 Places（目的地不明）→ 觸發 SAFETY", s: sNeg("pl3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { placesRequests: 1, placesQueries: ["景點@-"] })], re: /否定語句切換後金澤未確認仍搜尋 Places 1 次/, trigger: true },
    { name: "E13 對照：T3 以京都搜尋 → 仍為 OLD-CITY（分類不變，不重複判 SAFETY Places）", s: sNeg("pl3k"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { placesRequests: 1, placesQueries: ["景點@京都"] })], re: /金澤未確認仍搜尋 Places/, trigger: false, check: (r) => r.SF.fails.some((x) => x.cat === "OLD-CITY" && /否定語句切換後「好」仍以京都搜尋／扣點／顯示/.test(x.msg)) },
    { name: "E14（A2-MP-T40）T3 以被否定的大阪扣點（Credits metadata＝大阪）→ 觸發", s: sNeg("os3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Credits: [{ destination: "大阪" }], creditsSettle: [false], creditsRpc: ["credits_check", "credits_reserve", "credits_rollback"] })], re: /原句夾帶的其他城市「大阪」被搜尋／扣點／顯示/, trigger: true, needAll: [/否定語句切換後金澤未確認仍啟動 Credits/] },
    { name: "E15（A2-MP-T40）T3 Session 被大阪污染（travelContext＝大阪）→ 觸發", s: sNeg("ses3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { sessionDest: "大阪", r20End: SYN_PROJ({ tc: { destination: "大阪" } }) })], re: /travelContext 寫入原句夾帶的其他城市「大阪」/, trigger: true, needAll: [/否定語句切換後金澤未確認卻改寫京都/, /Session tc 寫入原句夾帶（被否定）的其他城市「大阪」/] },
    { name: "E16（A2-MP-T40）T3 未確認金澤被當成可信（rec／travelContext 寫入金澤，trust 非 trusted）→ 觸發 SAFETY", s: sNeg("kz3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Rec: { destination: "金澤" }, sessionDest: "金澤", trust: [{ status: "unavailable", destination: null, reason: "timeout" }] })], re: /travelContext 寫入未確認目的地「金澤」/, trigger: true, needAll: [/recommendationSession 寫入未確認目的地「金澤」/, /否定語句切換後金澤未確認卻改寫京都/] },
    { name: "E17（A2-MP-T40）T3 下一輪「好」恢復京都扣點（無卡片但 Credits metadata＝京都）→ 觸發", s: sNeg("ky3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Credits: [{ destination: "京都" }], creditsSettle: [false], creditsRpc: ["credits_check", "credits_reserve", "credits_rollback"] })], re: /否定語句切換後「好」仍以京都搜尋／扣點／顯示/, trigger: true, needAll: [/否定語句切換後金澤未確認仍啟動 Credits/] },
    // ── A2-MP-T42（M3）：negSwitchYes 無卡片、金澤未確認分支補 N2／N3／N5 等同檢查（各一案觸發＋對照不觸發）──
    { name: "E18（A2-MP-T42 M3）T3 Session 地理投影被改寫（preferredArea＝金澤）→ 觸發 SAFETY", s: sNeg("geo3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20End: SYN_PROJ({ preferredArea: "金澤" }) })], re: /否定語句切換後金澤未確認 Session 地理欄位改變/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && /否定語句切換後金澤未確認 Session 地理欄位改變：preferredArea/.test(x.msg)) },
    { name: "E18 對照：T3 只改非地理欄位（lastAssistantReply）→ 不觸發", s: sNeg("geo3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20End: SYN_PROJ({ lastAssistantReply: "目前仍是京都" }) })], re: /否定語句切換後金澤未確認 Session 地理欄位改變/, trigger: false },
    { name: "E19（A2-MP-T42 M3）T3 清掉京都推薦 Context（輪初 arc＝京都、輪末 null）→ 觸發 SAFETY", s: sNeg("arc3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r18ArcAtStart: "京都", r17Arc: null })], re: /否定語句切換後金澤未確認清掉京都推薦 Context/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && /清掉京都推薦 Context/.test(x.msg)) },
    { name: "E19 對照：T3 京都推薦 Context 保留 → 不觸發", s: sNeg("arc3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r18ArcAtStart: "京都", r17Arc: { destinationName: "京都" } })], re: /清掉京都推薦 Context/, trigger: false },
    { name: "E19b（A2-MP-T42 M3）T3 activeCategoryIntent 被清除（attraction→null）→ 觸發 SAFETY", s: sNeg("aci3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20End: SYN_PROJ({ activeCategoryIntent: null }) })], re: /否定語句切換後金澤未確認 activeCategoryIntent 被清除／改變/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && /activeCategoryIntent 被清除／改變 attraction→-/.test(x.msg)) },
    { name: "E19b 對照：T3 activeCategoryIntent 不變 → 不觸發", s: sNeg("aci3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20End: SYN_PROJ({ activeCategoryIntent: "attraction" }) })], re: /activeCategoryIntent 被清除／改變/, trigger: false },
    { name: "E20（A2-MP-T42 M3）T3 非 RPC Supabase 寫入 1 次 → 觸發 SAFETY", s: sNeg("db3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20Db: ["from(trips).insert"] })], re: /否定語句切換後金澤未確認仍有非 RPC Supabase 寫入 1 次/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && /非 RPC Supabase 寫入/.test(x.msg)) },
    { name: "E20 對照：T3 只有讀取（select）→ 不觸發", s: sNeg("db3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r20Db: ["from(trips).select"] })], re: /非 RPC Supabase 寫入/, trigger: false },
    { name: "E21（A2-MP-T42 M3）T3 呼叫 Weather（京都座標、無其他成本）→ 觸發（分類同原 FAIL_KINDS：OLD-CITY）", s: sNeg("w3k"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { weatherCalls: 1, r18Weather: [{ phase: "weather", data: "[35.0116,135.7681]" }] })], re: /否定語句切換後金澤未確認仍呼叫 Weather 1 次/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "OLD-CITY" && /仍呼叫 Weather/.test(x.msg)) },
    { name: "E21b（A2-MP-T42 M3）T3 呼叫 Weather（座標不明）→ 觸發 SAFETY", s: sNeg("w3s"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { weatherCalls: 1 })], re: /否定語句切換後金澤未確認仍呼叫 Weather 1 次/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && /仍呼叫 Weather/.test(x.msg)) },
    { name: "E21 對照：T3 Weather=0 → 不觸發", s: sNeg("w3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { weatherCalls: 0 })], re: /仍呼叫 Weather/, trigger: false },
    { name: "E22（A2-MP-T42 M3）T3 沒有任何助理回覆 → 觸發 FEATURE", s: sNeg("na3"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Assistant: [], r20Assistant: [] })], re: /否定語句切換後「好」沒有任何助理回覆/, trigger: true, check: (r) => r.SF.fails.some((x) => x.cat === "FEATURE" && /沒有任何助理回覆/.test(x.msg)) },
    { name: "E22 對照：T3 有助理回覆 → 不觸發", s: sNeg("na3c"), turns: [SYN.origin(0), genT2(), synTurn(2, "好", { r15Assistant: ["目前還無法確認金澤，要繼續京都嗎？"], r20Assistant: ["目前還無法確認金澤，要繼續京都嗎？"] })], re: /沒有任何助理回覆/, trigger: false },
    { name: "E9 一般流程 T3 金澤卡片但 rec／travelContext 仍京都 → 觸發", s: sNeg("rec"), turns: [SYN.origin(0), genT2(), SYN.confirmNew(2, null, { r15Rec: { destination: "京都" }, sessionDest: "京都" })], re: /否定語句切換：rec=京都 travelContext=京都（應為金澤）/, trigger: true },
    { name: "E10 一般流程 T3 Places 高於 REF → 觸發", s: sNeg("cost"), turns: [SYN.origin(0), genT2(), SYN.confirmNew(2, null, { placesRequests: 3 })], re: /否定語句切換輪 Places 請求=3 高於同樹既有推薦流程/, trigger: true },
  ];
}
/**
 * A2-MP-T40（使用者契約 (一)）：正常 noMore → 好 → 替代推薦（noMoreOffer／altYes）偵測器自我測試。正確形狀＝mp1／a2 樹實際觀察到的正式 alt 分支
 * （mp25-r4-full-T35.log L14278：path=|real:alt=appliedalternative_recommendations(real)、placesReq=4、builder=1、credits_check→reserve→commit、trust=trusted:京都）。
 */
function noMoreAltCases() {
  const sNM = (id) => ({ id: `SELF-nm-${id}`, case: 0, items: [], expect: ["noMoreOffer", "altYes"], turns: ["再推薦幾個", "好"], r15Init: INIT_KYOTO_EXHAUSTED, r15EmptyDest: NM_EMPTY_Q });
  const NOMORE = "我目前找不到更多符合條件的地點，要不要換成美食、咖啡廳或室內景點？";
  const STOPPED_ZH = "還是無法確認「大阪」，這次先停在這裡，不會搜尋也不會扣點。你可以換個寫法重新告訴我目的地，或說「繼續京都」。";
  const nmT = (o = {}) => synTurn(0, "再推薦幾個", { path: "|real:refine=F|real:more=Fcontinuation:MORE_RECOMMENDATIONS(real)", placesRequests: 4, placesQueries: ["景點@京都", "室內景點@京都", "attractions@京都", "hidden gems@京都"], r15Assistant: [NOMORE], r20Assistant: [NOMORE], r20AltOffer: [true], ...o });
  const ALT = "好的，我幫你找美食、咖啡廳和室內景點：\n\n1. 京都地點1\n2. 京都地點2";
  const altT = (o = {}) => synTurn(1, "好", { path: "|real:alt=appliedalternative_recommendations(real)", placesRequests: 4, builderCalls: 1, placesQueries: ["美食 餐廳@京都", "咖啡廳@京都", "餐廳@京都", "博物館@京都"], r15Cards: [{ name: "京都地點1", id: "ChIJ-k1" }, { name: "京都地點2", id: "ChIJ-k2" }], r20CardLL: [{ lat: 35.012, lng: 135.769 }, { lat: 35.013, lng: 135.77 }], r15Credits: [{ destination: "京都" }], creditsSettle: [true], creditsRpc: ["credits_check", "credits_reserve", "credits_commit"], trust: [{ status: "trusted", destination: "京都", label: "京都", center: COORDS.京都 }], r15Assistant: [ALT], r20Assistant: [ALT], ...o });
  return [
    { name: "NM0 正確流程：noMore（正式路徑、替代推薦提問、不扣點）→ 好（正式 alt Callback、京都卡片、Places＝京都、Credits 恰 1 次京都並結算、Session 京都）→ 無任何失敗（含 MODEL）", s: sNM("ok"), turns: [nmT(), altT()], re: /./, trigger: false, check: (r) => r.lines.some((l) => l.includes("（noMoreOffer）")) && r.lines.some((l) => l.includes("（altYes）")) },
    { name: "NM1 「好」只走 Harness 模型（未重建）→ MODEL＝UNVERIFIED（不得 PASS；所有失敗皆 MODEL）", s: sNM("model"), turns: [nmT(), altT({ path: "alternative_recommendations(未重建)" })], re: /未進入正式 Callback|模型未重建路徑/, trigger: true, check: (r) => r.SF.fails.every((x) => x.cat === "MODEL") },
    { name: "NM1b 「好」路徑沒有 alternative_recommendations(real)（其他正式分支）→ MODEL「未進入正式 Callback」", s: sNM("nreal"), turns: [nmT(), altT({ path: "|real:more=Tcontinuation:MORE_RECOMMENDATIONS(real)" })], re: /替代推薦「好」未進入正式 Callback/, trigger: true },
    // A2-MP-T42（S1）：混合 path（含 alternative_recommendations(real) 又經過未重建路徑）→ 仍 MODEL；對照＝NM0（只有 real 路徑 → 無失敗）
    { name: "NM1d（A2-MP-T42 S1）「好」混合 path（alternative_recommendations(real)＋later:other(未重建…)）→ MODEL＝UNVERIFIED（所有失敗皆 MODEL）", s: sNM("mixed"), turns: [nmT(), altT({ path: "|real:alt=appliedalternative_recommendations(real)|later:other(未重建；planner/advice/nearby 下游)" })], re: /替代推薦「好」未進入正式 Callback/, trigger: true, check: (r) => r.SF.fails.length > 0 && r.SF.fails.every((x) => x.cat === "MODEL") },
    { name: "NM1c noMore 輪不是正式路徑（未重建）→ MODEL", s: sNM("nmodel"), turns: [nmT({ path: "refetch(未重建)" }), altT()], re: /正常 noMore 輪未進入正式 Callback/, trigger: true },
    { name: "NM2 noMore 輪被 E2f destinationSwitchStopped 擋住（無替代推薦提問）→ 觸發", s: sNM("stop1"), turns: [nmT({ r15Assistant: [STOPPED_ZH], r20Assistant: [STOPPED_ZH], r20AltOffer: [false] }), altT()], re: /正常 noMore 被 E2f destinationSwitchStopped 擋住/, trigger: true },
    { name: "NM2b noMore 輪沒有提出替代推薦（一般說明）→ 觸發", s: sNM("nooffer"), turns: [nmT({ r15Assistant: ["目前沒有更多地點了。"], r20Assistant: ["目前沒有更多地點了。"], r20AltOffer: [false] }), altT()], re: /京都推薦用完後沒有提出正常替代推薦/, trigger: true },
    { name: "NM2c 「好」後被 E2f 擋住（無卡片、無 Credits）→ 觸發", s: sNM("stop2"), turns: [nmT(), synTurn(1, "好", { path: "|real:alt=appliedalternative_recommendations(real)", r15Assistant: [STOPPED_ZH], r20Assistant: [STOPPED_ZH] })], re: /正常替代推薦被 E2f destinationSwitchStopped 擋住/, trigger: true, needAll: [/「好」後沒有替代推薦卡片/, /Credits\.begin=0/] },
    { name: "NM3 前提不成立：noMore 輪仍有京都卡片（推薦池未用完）→ INFRA", s: sNM("pre"), turns: [nmT({ r15Cards: [{ name: "京都-舊地點4", id: "old-京都-4" }] }), altT()], re: /正常 noMore 前提不成立/, trigger: true },
    { name: "NM4 Credits 兩次（begin=2）→ 觸發（一次結算）", s: sNM("cr2"), turns: [nmT(), altT({ r15Credits: [{ destination: "京都" }, { destination: "京都" }], creditsSettle: [true, false], creditsRpc: ["credits_check", "credits_reserve", "credits_commit", "credits_reserve", "credits_rollback"] })], re: /替代推薦 Credits\.begin=2/, trigger: true },
    { name: "NM4b 「好」卡片京都但 Credits metadata＝大阪 → 觸發 SAFETY（京都以外城市扣點）", s: sNM("crO"), turns: [nmT(), altT({ r15Credits: [{ destination: "大阪" }] })], re: /替代推薦出現京都以外的城市 大阪/, trigger: true, needAll: [/metadata=\[大阪\]/] },
    { name: "NM4c noMore 輪扣點（commit 1、無卡片）→ 觸發 SAFETY（Credits 結算錯誤）", s: sNM("crN"), turns: [nmT({ r15Credits: [{ destination: "京都" }], creditsSettle: [true], creditsRpc: ["credits_check", "credits_reserve", "credits_commit"] }), altT()], re: /Credits 成功結算=1（卡片=0）/, trigger: true },
    { name: "NM5 「好」Places 以金澤搜尋（範圍錯誤）→ 觸發 SAFETY", s: sNM("scope"), turns: [nmT(), altT({ placesQueries: ["美食 餐廳@金澤", "咖啡廳@京都"] })], re: /替代推薦 Places 搜尋範圍不是京都/, trigger: true, needAll: [/未確認金澤仍搜尋／扣點／顯示/] },
    { name: "NM5b 「好」卡片座標不在京都（金澤座標）→ 觸發", s: sNM("ll"), turns: [nmT(), altT({ r20CardLL: [{ lat: 36.5613, lng: 136.6562 }] })], re: /替代推薦卡片座標不在京都 Mock 座標附近/, trigger: true },
    { name: "NM6 Session 與卡片不一致（卡片京都、travelContext＝大阪）→ 觸發 SAFETY", s: sNM("ses"), turns: [nmT(), altT({ sessionDest: "大阪", r20End: SYN_PROJ({ tc: { destination: "大阪" } }) })], re: /替代推薦後 travelContext=大阪（Session 與京都卡片不一致）/, trigger: true, needAll: [/替代推薦後 Session tc 含 大阪/] },
    { name: "NM6b noMore 輪 travelContext 被改寫為金澤 → 觸發", s: sNM("ses0"), turns: [nmT({ sessionDest: "金澤" }), altT()], re: /正常 noMore 輪 travelContext=金澤/, trigger: true },
    { name: "NM7 「好」後出現 destination_switch Pending → 觸發", s: sNM("pend"), turns: [nmT(), altT({ r18Pending: SYN_P() })], re: /替代推薦後出現 destination_switch Pending/, trigger: true },
    { name: "NM8 「好」沒有卡片（替代推薦失效）→ 觸發", s: sNM("nocard"), turns: [nmT(), altT({ r15Cards: [], r20CardLL: [], r15Credits: [], creditsSettle: [], creditsRpc: [] })], re: /「好」後沒有替代推薦卡片/, trigger: true },
    // ── A2-MP-T46（使用者裁決 (三)；CHANGES #41）：noMore Credits reserve → rollback 契約 ──
    ...(() => {
      const RB = (rpc, o = {}) => ({ r15Credits: [{ destination: "京都" }], creditsSettle: [false], creditsRpc: ["credits_check", ...rpc], ...o });
      const nmSafety = (re) => (r) => r.SF.fails.some((x) => x.cat === "SAFETY" && re.test(x.msg));
      /** 有卡片＋reserve→rollback→reserve→commit（begin 1、settle [true]）：既有 creditsFails 4 條全過（reserve 2＝commit 1＋rollback 1）→ 修正前漏抓。 */
      const gapAlt = altT({ creditsRpc: ["credits_check", "credits_reserve", "credits_rollback", "credits_reserve", "credits_commit"] });
      return [
        { name: "NM9（A2-MP-T46）合法：noMore 輪無卡片 reserve→rollback 恰 1 次（commit 0、未結算 0）→ 不觸發（整個情境 0 失敗，含 MODEL）", s: sNM("rb-ok"), turns: [nmT(RB(["credits_reserve", "credits_rollback"])), altT()], re: /noMore Credits|Credits/, trigger: false, check: (r) => r.SF.fails.length === 0 },
        { name: "NM9a（A2-MP-T46）noMore 輪 reserve 1、rollback 0（殘留未結算 reserve）→ 觸發 SAFETY", s: sNM("rb0"), turns: [nmT(RB(["credits_reserve"], { creditsSettle: [] })), altT()], re: /noMore Credits：無有效新卡片 credits_rollback=0（有 reserve 時應恰好 1 次/, trigger: true, needAll: [/noMore Credits：未結算 reserve=1/], check: nmSafety(/credits_rollback=0/) },
        { name: "NM9b（A2-MP-T46）noMore 輪 reserve 1、rollback 2 → 觸發 SAFETY", s: sNM("rb2"), turns: [nmT(RB(["credits_reserve", "credits_rollback", "credits_rollback"])), altT()], re: /noMore Credits：無有效新卡片 credits_rollback=2/, trigger: true, needAll: [/noMore Credits：commit／rollback 前沒有對應 reserve 1 次/], check: nmSafety(/credits_rollback=2/) },
        { name: "NM9c（A2-MP-T46）noMore 輪無卡片卻 commit（reserve→commit，settle 記 false）→ 觸發 SAFETY", s: sNM("rbc"), turns: [nmT(RB(["credits_reserve", "credits_commit"])), altT()], re: /noMore Credits：無有效新卡片卻 credits_commit=1/, trigger: true, check: nmSafety(/無有效新卡片卻 credits_commit=1/) },
        { name: "NM9d（A2-MP-T46）noMore 輪 reserve→rollback→reserve（第二筆 reserve 未結算）→ 觸發 SAFETY", s: sNM("rbopen"), turns: [nmT(RB(["credits_reserve", "credits_rollback", "credits_reserve"])), altT()], re: /noMore Credits：未結算 reserve=1/, trigger: true, needAll: [/noMore Credits：無有效新卡片 credits_reserve=2/], check: nmSafety(/未結算 reserve=1/) },
        { name: "NM9e（A2-MP-T46）noMore 輪無 reserve 卻 rollback 1 → 觸發 SAFETY（孤立結算）", s: sNM("rborph"), turns: [nmT(RB(["credits_rollback"], { r15Credits: [], creditsSettle: [] })), altT()], re: /noMore Credits：commit／rollback 前沒有對應 reserve 1 次/, trigger: true, check: nmSafety(/沒有對應 reserve/) },
        { name: "NM9f（A2-MP-T46）「好」有卡片卻 reserve→rollback（未 commit）→ 觸發 SAFETY", s: sNM("altrb"), turns: [nmT(), altT({ creditsSettle: [false], creditsRpc: ["credits_check", "credits_reserve", "credits_rollback"] })], re: /noMore Credits：有有效新卡片卻 credits_rollback=1/, trigger: true, needAll: [/noMore Credits：有有效新卡片 reserve=1 commit=0/], check: nmSafety(/有有效新卡片卻 credits_rollback=1/) },
        { name: "NM9g（A2-MP-T46）「好」有卡片、reserve→rollback→reserve→commit（既有 creditsFails 全過＝修正前漏抓）→ 觸發 SAFETY", s: sNM("altgap"), turns: [nmT(), gapAlt], re: /noMore Credits：有有效新卡片卻 credits_rollback=1/, trigger: true, needAll: [/noMore Credits：有有效新卡片 reserve=2 commit=1/], check: (r) => creditsFails(gapAlt).length === 0 && nmSafety(/有有效新卡片卻 credits_rollback=1/)(r) },
        { name: "NM9h（A2-MP-T46）「好」有卡片只有 reserve（reserve 不得視為已完成扣點）→ 觸發 SAFETY", s: sNM("altres"), turns: [nmT(), altT({ creditsRpc: ["credits_check", "credits_reserve"] })], re: /noMore Credits：未結算 reserve=1/, trigger: true, needAll: [/noMore Credits：有有效新卡片 reserve=1 commit=0/], check: nmSafety(/未結算 reserve=1/) },
        { name: "NM9i（A2-MP-T46）對照：「好」有卡片 reserve→commit 恰 1 次（NM0 形狀）、noMore 輪無 Credits → 不觸發 noMore Credits", s: sNM("altok"), turns: [nmT(), altT()], re: /noMore Credits/, trigger: false, check: (r) => r.SF.fails.length === 0 },
      ];
    })(),
    // ── A2-MP-T52（任務單 #52；CHANGES #44）：Credits Reservation 時序（creditsOrderFails；所有輪）──
    ...(() => {
      const ORD = /Credits 時序/;
      const sO = (id) => ({ id: `SELF-ord-${id}`, case: 0, items: [], expect: ["origin"], turns: [T1] });
      const oT = (rpc, o = {}) => ({ ...SYN.origin(0), creditsRpc: rpc, ...o });
      const C = "credits_check", R = "credits_reserve", CM = "credits_commit", RB = "credits_rollback";
      const ordHits = (r) => r.SF.fails.filter((x) => ORD.test(x.msg));
      /** 觸發案：新規則命中、全部 cat＝SAFETY 且標籤含 20、至少一筆符合 re；not＝不得同時命中的其他規則（證明規則可區分）。 */
      const ordSafety = (re, not = null) => (r) => {
        const h = ordHits(r);
        return h.length > 0 && h.every((x) => x.cat === "SAFETY" && (x.tags ?? []).includes(20)) && h.some((x) => re.test(x.msg)) && !(not && h.some((x) => not.test(x.msg)));
      };
      // A2-MP-T56（CHANGES #49）：函式層合法對照的 begin 數＝credits_check 數。依據 runtime.ts：每次 begin「至多」一次 check——
      //   L139-147（request_id 缺失）、L149-160（flag off）、L162-173（Plus）提早 return，不 check；只有走到 L175 的 begin 恰一次 check，通過後 L196 至多一次 reserve。
      //   因此「begin 數＝check 數」只對有 RPC 的 begin 成立；無 RPC 的 begin 在此記為 0（低估 begin 只會讓規則 7 更嚴，不會放寬）。
      //   原 synTurn 預設 r15Credits=[]（begin 0）不是有 RPC 合法輪的形狀，會被規則 7 加嚴命中。（任務單 #61：只更正說明，判定不變）
      const fnZero = (...rpcs) => rpcs.every((rpc) => creditsOrderFails(synTurn(0, "x", { creditsRpc: rpc, r15Credits: rpc.filter((x) => x === "credits_check").map(() => ({ destination: "京都" })) })).length === 0);
      const gapOrigin = oT([C, R, RB, R, CM]);
      const earlyCommit = oT([C, CM, R]);
      const retry = oT([C, R, RB, C, R, CM], { r15Credits: [{ destination: "京都" }, { destination: "京都" }], creditsSettle: [false, true] });
      const conc = oT([C, C, R, R, RB, CM], { r15Credits: [{ destination: "京都" }, { destination: "京都" }], creditsSettle: [false, true] });
      // A2-MP-T56：begin 1（SYN.origin：r15Credits 1、settle [true]、1 張卡片）的違規序列
      const r7d = oT([C, C, R, R, RB, CM]);
      const r7e = oT([C, R, RB, C, R, CM]);
      const r3b = oT([C, R, CM, C, CM, R]);
      const blind = synTurn(0, "x", { creditsRpc: [C, R, C, R, RB, RB], r15Credits: [{ destination: "京都" }, { destination: "京都" }], creditsSettle: [false, false], r15Cards: [] });
      return [
        // 合法對照（新規則 0 命中；能構成完整合法輪者另要求整個情境 0 失敗）
        { name: "CO-L1（A2-MP-T52）合法：check→reserve→commit（有卡片）→ 不觸發（整個情境 0 失敗）", s: sO("l1"), turns: [oT([C, R, CM])], re: ORD, trigger: false, check: (r) => r.SF.fails.length === 0 },
        { name: "CO-L2（A2-MP-T52）合法：noMore 輪 check→reserve→rollback 恰 1 次（無卡片）→ 不觸發（整個情境 0 失敗）；另一般輪函式層 check→reserve→rollback＝0", s: sNM("ord-rb"), turns: [nmT({ r15Credits: [{ destination: "京都" }], creditsSettle: [false], creditsRpc: [C, R, RB] }), altT()], re: ORD, trigger: false, check: (r) => r.SF.fails.length === 0 && fnZero([C, R, RB]) },
        { name: "CO-L3（A2-MP-T52）合法：inactive／flag off／Plus（runtime.ts L25-41、L149-173；無 RPC）、check 失敗 blocked（L176-194；只有 check）、reserve 失敗／skipped／committed 冪等（L207-227、L247-248；check→reserve 無結算 RPC）→ 新規則 0 命中（數量面由既有 creditsFails 判定，不在此改變）", s: sO("l3"), turns: [oT([], { creditsSettle: [] })], re: ORD, trigger: false, check: () => fnZero([], [C], [C, R], [C, C]) },
        { name: "CO-L4（A2-MP-T52）合法重試：呼叫端重新 begin（begin 2、check→reserve→rollback→check→reserve→commit；settle [false,true]）→ 不觸發（整個情境 0 失敗）", s: sO("l4"), turns: [retry], re: ORD, trigger: false, check: (r) => r.SF.fails.length === 0 && creditsFails(retry).length === 0 },
        { name: "CO-L5（A2-MP-T52）合法並行：兩個 begin 交錯（check,check,reserve,reserve,rollback,commit）→ 不觸發（整個情境 0 失敗）", s: sO("l5"), turns: [conc], re: ORD, trigger: false, check: (r) => r.SF.fails.length === 0 },
        // 違規（每條至少一案；全部 SAFETY＋標籤 20）
        { name: "CO-R2（A2-MP-T52）結算早於 reserve：check→commit→reserve（既有 creditsFails 全過）→ 觸發 SAFETY", s: sO("r2"), turns: [earlyCommit], re: /早於 credits_reserve/, trigger: true, check: (r) => creditsFails(earlyCommit).length === 0 && ordSafety(/早於 credits_reserve/, /沒有任何 reservation|結算 2 次/)(r) },
        { name: "CO-R3（A2-MP-T52）同一筆 reservation 結算 2 次：check→reserve→commit→rollback → 觸發 SAFETY（不得誤標重複 commit／rollback）", s: sO("r3"), turns: [oT([C, R, CM, RB])], re: /結算 2 次/, trigger: true, check: ordSafety(/前一筆 reservation（第 2 個 RPC）已 commit＝同一筆 reservation 結算 2 次/, /重複 commit|重複 rollback/) },
        { name: "CO-R4（A2-MP-T52）重複 commit：check→reserve→commit→commit → 觸發 SAFETY", s: sO("r4"), turns: [oT([C, R, CM, CM])], re: /重複 commit/, trigger: true, needAll: [/結算 2 次/], check: ordSafety(/重複 commit/, /重複 rollback/) },
        { name: "CO-R5（A2-MP-T52）重複 rollback：noMore 輪 check→reserve→rollback→rollback → 觸發 SAFETY", s: sNM("ord-rb2"), turns: [nmT({ r15Credits: [{ destination: "京都" }], creditsSettle: [false], creditsRpc: [C, R, RB, RB] }), altT()], re: /重複 rollback/, trigger: true, needAll: [/結算 2 次/], check: ordSafety(/重複 rollback/, /重複 commit/) },
        { name: "CO-R6（A2-MP-T52）沒有 reservation 的結算：check→commit → 觸發 SAFETY", s: sO("r6"), turns: [oT([C, CM])], re: /沒有任何 reservation/, trigger: true, check: ordSafety(/沒有任何 reservation/, /早於 credits_reserve|結算 2 次/) },
        { name: "CO-R7（A2-MP-T52）一般輪（origin，非 noMore）未經授權的重複 reserve：check→reserve→rollback→reserve→commit（＝NM9g 序列；既有 creditsFails 全過、其他既有斷言 0 失敗＝修正前漏抓）→ 觸發 SAFETY", s: sO("r7"), turns: [gapOrigin], re: /未經授權的重複 reserve/, trigger: true, check: (r) => creditsFails(gapOrigin).length === 0 && r.SF.fails.filter((x) => !ORD.test(x.msg)).length === 0 && ordSafety(/第 4 個 RPC credits_reserve 前沒有尚未使用的 credits_check/)(r) },
        { name: "CO-R7b（A2-MP-T52）reserve 前完全沒有 check：reserve→commit → 觸發 SAFETY", s: sO("r7b"), turns: [oT([R, CM])], re: /未經授權的重複 reserve/, trigger: true, check: ordSafety(/第 1 個 RPC credits_reserve 前沒有尚未使用的 credits_check/) },
        { name: "CO-R7c（A2-MP-T52）altYes 輪 NM9g 序列：新規則同樣觸發（與 noMoreCreditsFails 並存）", s: sNM("ord-gap"), turns: [nmT(), altT({ creditsRpc: [C, R, RB, R, CM] })], re: /未經授權的重複 reserve/, trigger: true, needAll: [/noMore Credits：有有效新卡片卻 credits_rollback=1/], check: ordSafety(/未經授權的重複 reserve/) },
        // ── A2-MP-T56（CHANGES #46／#47／#49）──
        { name: "CO-R7d（A2-MP-T56）begin 1、settle [true]、1 張卡片、C,C,R,R,RB,CM（每次 reserve 前都有 check）：既有 creditsFails＝0、check 配對規則不命中 → 規則 7 加嚴（reserve 2 > begin 1）觸發 SAFETY", s: sO("r7d"), turns: [r7d], re: /本輪 credits_reserve=2 多於 begin=1/, trigger: true, check: (r) => creditsFails(r7d).length === 0 && ordHits(r).length === 1 && ordSafety(/本輪 credits_reserve=2 多於 begin=1/, /前沒有尚未使用的 credits_check|結算 2 次|早於|沒有任何 reservation/)(r) && r.SF.fails.filter((x) => !ORD.test(x.msg)).length === 0 },
        { name: "CO-R7e（A2-MP-T56）begin 1、settle [true]、1 張卡片、C,R,RB,C,R,CM（＝CO-L4 序列但 begin 1）：既有 creditsFails＝0 → 規則 7 加嚴觸發 SAFETY", s: sO("r7e"), turns: [r7e], re: /本輪 credits_reserve=2 多於 begin=1/, trigger: true, check: (r) => creditsFails(r7e).length === 0 && ordHits(r).length === 1 && ordSafety(/本輪 credits_reserve=2 多於 begin=1/, /前沒有尚未使用的 credits_check|結算 2 次|早於|沒有任何 reservation/)(r) && r.SF.fails.filter((x) => !ORD.test(x.msg)).length === 0 },
        { name: "CO-L4b（A2-MP-T56）對照：CO-L4（begin 2 合法重試）與 CO-L5（begin 2 並行）規則 7 加嚴 0 命中；函式層（begin 數以 credits_check 數計：有 RPC 的 begin 恰 1 次 check、至多 1 次 reserve；runtime.ts L149-173 flag off／Plus 的 begin 不 check）的 [C,R,CM]／[C,R,RB] 等也 0 命中", s: sO("l4b"), turns: [retry], re: /多於 begin/, trigger: false, check: (r) => r.SF.fails.length === 0 && creditsOrderFails(conc).length === 0 && fnZero([C, R, CM], [C, R, RB], [C, R, RB, C, R, CM], [C, C, R, R, RB, CM]) },
        { name: "CO-R3b（A2-MP-T56）C,R,CM,C,CM,R：第 5 個 RPC 結算時已有已結算 reservation、之後才 reserve → 仍觸發 SAFETY，訊息並列兩種可能（同一筆結算 2 次／結算早於後續 reserve）；重複 commit 仍觸發並加註", s: sO("r3b"), turns: [r3b], re: /兩種可能：同一筆 reservation 結算 2 次，或結算早於後續 credits_reserve/, trigger: true, needAll: [/重複 commit（第 2 個 RPC 的 reservation commit 2 次；或結算早於後續 credits_reserve/, /本輪 credits_reserve=2 多於 begin=1/], check: ordSafety(/第 5 個 RPC credits_commit 沒有開啟中的 reservation，前一筆 reservation（第 2 個 RPC）已 commit；之後第 6 個 RPC 才 credits_reserve/) },
        // 盲點記錄（不是 PASS 證據）：此列「通過」＝證明現行斷言確實抓不到；R1 ledger_id 仍為 UNVERIFIED（CREDITS_R1_UNVERIFIED）
        { name: "CO-U1（A2-MP-T56）已知盲點記錄（UNVERIFIED，非 PASS 證據）：C,R,C,R,RB,RB（begin 2、settle [false,false]、無卡片）可能是同一筆 rollback 兩次、另一筆從未結算 → 現行 creditsFails／creditsOrderFails 皆 0 命中（名稱層級無法區分；需 ledger_id）", s: sO("u1"), turns: [oT([C, R, CM])], re: /(?!)/, trigger: false, check: () => creditsFails(blind).length === 0 && creditsOrderFails(blind).length === 0 },
      ];
    })(),
  ];
}
/** 每一案：scenario（expect／turns／其他欄位）、合成輪次、偵測器訊息正則、是否應觸發；clean＝整個情境不得出現 SAFETY／INFRA。 */
function selfTestCases() {
  const P1 = SYN_P({ confirmationAttempts: 1 });
  const P2 = SYN_P({ confirmationAttempts: 2 });
  const scen = (id, expect, turnTexts, extra = {}) => ({ id: `SELF-${id}`, case: 0, items: [], expect, turns: turnTexts, ...extra });
  const base06 = (t4 = null, t5 = null) => [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2), t4 ?? SYN.keep(3, "好", P2), t5 ?? SYN.keep(4, "再推薦幾個", P2)];
  const s06 = scen("06", ["origin", "switchFail", "confirmFail", "confirmCapped", "idle"], [T1, T2, "好", "好", "再推薦幾個"]);
  const holds = (n, noQ = false) => [SYN.origin(0), SYN.switchFail(1), ...Array.from({ length: n }, (_, k) => SYN.keep(2 + k, "再推薦幾個", P1, noQ ? { r20Assistant: ["已記下，等你確認金澤"], r15Assistant: ["已記下，等你確認金澤"] } : { r20Assistant: [SYN_ASK], r15Assistant: [SYN_ASK] }))];
  const sHold = (n) => scen(`hold${n}`, ["origin", "switchFail", ...Array(n).fill("hold")], [T1, T2, ...Array(n).fill("再推薦幾個")]);
  /** A2-MP-T18：switchFail＋hold ×2（詢問 3）→ 第 5 輪「好」（confirmCapped）。 */
  const sHold4Yes = () => scen("hold2yes", ["origin", "switchFail", "hold", "hold", "confirmCapped"], [T1, T2, "再推薦幾個", "再推薦幾個", "好"]);
  const coordT = `${T2} (36.5613,136.6562)`;
  const fill = (n) => `${T2}${"。".repeat(Math.max(0, n - T2.length))}`;
  return [
    // ── 正確行為（不得誤判）──
    { name: "C-OK 06 正確流程：切換失敗→確認失敗→達上限後原樣保留＋含問號說明→閒置（不得有任何 SAFETY／INFRA）", s: s06, turns: base06(), re: /SAFETY|INFRA/, cat: true, trigger: false, clean: true },
    { name: "C-OK 05 正確流程：切換失敗→確認成功（驗證先於 Weather）", s: scen("05", ["origin", "switchFail", "confirmNew"], [T1, T2, "好"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmNew(2, P1)], re: /SAFETY|INFRA/, cat: true, trigger: false, clean: true },
    // ── 1. 超過詢問上限 ──
    // A2-MP-T18：D1 依使用者裁決 M1 改判——詢問達 3 次後第 4 輪原樣保留＋說明（含問號）＝達上限後保留（INFO），不是第 4 次確認請求
    { name: "D1 詢問上限（M1 改判）：詢問 3 次後第 4 輪原樣保留（hold ×3）→ 不觸發「第 4 次確認請求」，記為達上限後保留 1", s: sHold(3), turns: holds(3), re: /次確認請求|M1 嚴格上限違反|再次推進確認流程/, trigger: false, check: (r) => [...r.ids.values()].some((x) => x.asks === 3 && x.heldAfterCap === 1) },
    { name: "D1 對照：上限前 3 次確認請求（hold ×2）→ 不觸發", s: sHold(2), turns: holds(2), re: /次確認請求/, trigger: false, check: (r) => [...r.ids.values()].some((x) => x.asks === 3 && x.heldAfterCap === 0) },
    { name: "D1 依行為非文案（M1 改寫）：不含問號的回覆仍計入詢問（switchFail＋hold ×2＝3）→ 第 4 輪「好」再驗證 → 觸發 M1", s: scen("noQ", ["origin", "switchFail", "hold", "hold", "confirmCapped"], [T1, T2, "再推薦幾個", "再推薦幾個", "好"]), turns: [...holds(2, true), SYN.keep(4, "好", P1, { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", label: "金澤", destination: null, reason: "destination_center_unverified" }] })], re: /確認詢問=3≥3）後仍Provider 驗證 1 次/, trigger: true },
    { name: "D1 依行為非文案：達上限後原樣保留＋含問號說明 → 不算確認請求", s: s06, turns: base06(), re: /確認請求|重複確認/, trigger: false },
    { name: "D1b 達上限後再次推進（Pending 被改寫：attempts 2→2 但 originalUserText 換成「好」）→ 觸發重複確認", s: s06, turns: base06(SYN.keep(3, "好", P2, { r18Pending: SYN_P({ confirmationAttempts: 2, originalUserText: "好" }) })), re: /已達上限（[^）]*驗證=2≥2[^）]*）後再次推進確認流程/, trigger: true },
    // ── A2-MP-T18：M1 負向探針（達任一上限後）──
    { name: "D1c 達詢問上限（3）、驗證 1／attempts 1 → 回「好」再呼叫 Provider → 觸發 M1（裁決 5）", s: sHold4Yes(), turns: [...holds(2), SYN.keep(4, "好", P1, { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", label: "金澤", destination: null, reason: "destination_center_unverified" }] })], re: /M1 嚴格上限違反/, trigger: true },
    { name: "D1c 對照：達詢問上限後回「好」不驗證、不進入可信判定、原樣保留＋說明 → 不觸發，記為達上限後保留", s: sHold4Yes(), turns: [...holds(2), SYN.keep(4, "好", P1)], re: /M1 嚴格上限違反|次確認請求|再次推進確認流程/, trigger: false, check: (r) => [...r.ids.values()].some((x) => x.asks === 3 && x.heldAfterCap === 1) },
    { name: "D1d 達詢問上限後回「好」：無 geocode（冷卻）但進入該 identity 的可信判定入口 → 觸發（嚴格選項）", s: sHold4Yes(), turns: [...holds(2), SYN.keep(4, "好", P1, { trust: [{ status: "unavailable", label: "金澤", destination: null, reason: "destination_center_unverified" }] })], re: /進入該 identity 的可信判定／驗證入口 1 次/, trigger: true },
    { name: "D1e 達詢問上限後回「好」：Places 1＋credits_check → 觸發", s: sHold4Yes(), turns: [...holds(2), SYN.keep(4, "好", P1, { placesRequests: 1, placesQueries: ["景點@京都"], creditsRpc: ["credits_check"] })], re: /M1 嚴格上限違反/, trigger: true },
    { name: "D1f attempts 上限（Client 注入 attempts=2；驗證 0、詢問 0）→ 回「好」再驗證 → 觸發", s: scen("att2", ["forgedHold"], ["好"]), turns: [synTurn(0, "好", { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", label: "金澤", destination: null }], r18PendingAtStart: P2, r18Pending: P2 })], re: /confirmationAttempts=2≥2）後仍Provider 驗證 1 次/, trigger: true },
    { name: "D1f 對照：attempts=1（未達上限）→ 回「好」驗證 1 次 → 不觸發 M1", s: scen("att1", ["forgedHold"], ["好"]), turns: [synTurn(0, "好", { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", label: "金澤", destination: null }], r18PendingAtStart: SYN_P({ confirmationAttempts: 0 }), r18Pending: P1 })], re: /M1 嚴格上限違反/, trigger: false },
    { name: "D1g 達詢問上限後回「好」attempts 1→2（無 geocode）→ 觸發", s: sHold4Yes(), turns: [...holds(2), SYN.keep(4, "好", P1, { r18Pending: P2 })], re: /confirmationAttempts 增加 1→2/, trigger: true },
    { name: "D1h 對照：達詢問上限後明確「繼續京都」並以京都搜尋（明確重新指定）→ 不觸發 M1", s: scen("capKyoto", ["origin", "switchFail", "hold", "hold", "chooseOld"], [T1, T2, "再推薦幾個", "再推薦幾個", "繼續京都"]), turns: [...holds(2), SYN.origin(4)].map((t, k) => (k === 4 ? { ...t, text: "繼續京都", r18PendingAtStart: P1, r18Pending: null, r20Start: SYN_PROJ() } : t)), re: /M1 嚴格上限違反/, trigger: false },
    // ── A2-MP-T18：r21-C／turnExpect／exactRaw／keepPool／otherCity Session 投影 偵測器 ──
    { name: "D9 r21ClockByTurn 有欄位但子程序沒有 r21Clock → INFRA", s: scen("clk", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"], { r21ClockByTurn: { 2: 16000 } }), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2)], re: /r21-C 時間偏移未生效/, trigger: true },
    { name: "D9 對照：r21Clock 與累計偏移相符（T1／T2=0、T3=16000）→ 不觸發", s: scen("clkc", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"], { r21ClockByTurn: { 2: 16000 } }), turns: [{ ...SYN.origin(0), r21Clock: 0 }, { ...SYN.switchFail(1), r21Clock: 0 }, { ...SYN.confirmFail(2, P1, P2), r21Clock: 16000 }], re: /r21-C/, trigger: false },
    { name: "D9b 沒有 r21ClockByTurn 的情境出現 r21Clock（欄位外洩）→ INFRA", s: s06, turns: base06().map((t, k) => (k === 2 ? { ...t, r21Clock: 0 } : t)), re: /r21-C 時間偏移未生效／不應出現/, trigger: true },
    // ── A2-MP-T25（使用者裁決 1）：冷卻後確認成功情境的 r21ClockByTurn（以實際情境定義 NEW_SCENARIOS 驗證）──
    ...T25_CLOCK_IDS.flatMap((id) => {
      const s = NEW_SCENARIOS.find((x) => x.id === id);
      const syn = (clk) => (s?.turns ?? []).map((x, k) => synTurn(k, typeof x === "string" ? x : x?.text, clk ? { r21Clock: k >= 2 ? 16000 : 0 } : {}));
      return [
        { name: `D9c ${id}（+16 秒）子程序沒有 r21Clock → INFRA`, s: s ?? scen(`missing-${id}`, [], []), turns: syn(false), re: /r21-C 時間偏移未生效/, trigger: true },
        { name: `D9c 對照：${id} r21Clock＝T1／T2=0、確認輪起=16000 → 不觸發`, s: s ?? scen(`missing-${id}`, [], []), turns: syn(true), re: /r21-C/, trigger: false, check: () => Boolean(s) },
      ];
    }),
    {
      name: "D9c 結構：有 r21ClockByTurn 的情境＝既有 T2／T3／T5／T6／T7b＋A2-MP-T25／T26 套用清單（05／05b／09／18／18e，皆 {2:16000}）；cooldown 內／T1／T4／T7／06 系列／18b～18d 不得有",
      s: scen("t25struct", [], []),
      turns: [],
      re: /$^/,
      trigger: false,
      check: () => {
        const have = NEW_SCENARIOS.filter((x) => x.r21ClockByTurn).map((x) => x.id).sort();
        const want = [...T25_CLOCK_IDS, "MP25R4-T2-cooldown-elapsed-ok", "MP25R4-T3-cooldown-elapsed-fail-then-cap", "MP25R4-T5-zero-elapsed", "MP25R4-T6-cached-miss", "MP25R4-T7b-asks-cap-then-yes-elapsed"].sort();
        const exact = T25_CLOCK_IDS.every((id) => canon(NEW_SCENARIOS.find((x) => x.id === id)?.r21ClockByTurn) === canon({ 2: 16000 }));
        return JSON.stringify(have) === JSON.stringify(want) && exact;
      },
    },
    { name: "D10 turnExpect v=0（冷卻內）但本輪送出 1 次 → SAFETY", s: scen("te", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"], { turnExpect: { 2: { v: 0, attemptsDelta: 0, why: "cooldown" } } }), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P1)], re: /本輪金澤 Provider 驗證=1.*應=0/, trigger: true },
    { name: "D10 對照：turnExpect v=0、attempts 增量 0 且相符 → 不觸發", s: scen("tec", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"], { turnExpect: { 2: { v: 0, attemptsDelta: 0, why: "cooldown" } } }), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "好", P1)], re: /依正式契約/, trigger: false },
    { name: "D10b turnExpect attemptsDelta=0 但 1→2 → 觸發", s: scen("tea", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"], { turnExpect: { 2: { attemptsDelta: 0, why: "cooldown" } } }), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "好", P1, { r18Pending: P2 })], re: /confirmationAttempts 1→2（增量 1），依正式契約增量應=0/, trigger: true },
    { name: "D11 exactRaw：Pending raw「成金澤」→ 觸發", s: scen("raw2", ["origin", "switchFail"], [T1, T2_NEG_D], { exactRaw: true }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ rawGeographicLabel: "成金澤", originalUserText: T2_NEG_D }), T2_NEG_D, { geocodes: ["more_validate:成金澤"] })], re: /rawGeographicLabel="成金澤" 不是乾淨的目的地名稱|查詢字串不乾淨（"成金澤"）/, trigger: true, needAll: [/rawGeographicLabel="成金澤"/, /查詢字串不乾淨（"成金澤"）/] },
    { name: "D11 對照：exactRaw raw「金澤」、查詢「金澤」→ 不觸發", s: scen("raw2c", ["origin", "switchFail"], [T1, T2_NEG_D], { exactRaw: true }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_NEG_D }), T2_NEG_D)], re: /不是乾淨|不乾淨/, trigger: false },
    { name: "D12 keepPool：否定語句輪 activeCategoryIntent 被清除 → 觸發", s: scen("kp", ["origin", "switchFail"], [T1, T2_NEG_B], { keepPool: [1] }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_NEG_B }), T2_NEG_B, { r20End: SYN_PROJ({ activeCategoryIntent: null }) })], re: /否定語句輪 activeCategoryIntent 被清除／改變/, trigger: true },
    { name: "D12b keepPool：否定語句輪清掉京都推薦池（輪初 rec=京都、輪末 rec=-）→ 觸發", s: scen("kp2", ["origin", "switchFail"], [T1, T2_NEG_B], { keepPool: [1] }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_NEG_B }), T2_NEG_B, { r18RecAtStart: "京都", r15Rec: null })], re: /否定語句輪清掉京都推薦池/, trigger: true },
    { name: "D12 對照：keepPool 京都推薦池與類別不變 → 不觸發", s: scen("kpc", ["origin", "switchFail"], [T1, T2_NEG_B], { keepPool: [1] }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_NEG_B }), T2_NEG_B, { r18RecAtStart: "京都", r18ArcAtStart: "京都", r17Arc: { destinationName: "京都" } })], re: /否定語句輪/, trigger: false },
    { name: "D13 otherCity：Session preferredArea 新寫入「大阪了換金澤再」→ 觸發", s: scen("oc", ["origin", "switchFail"], [T1, T2_OTHER], { otherCity: "大阪" }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_OTHER }), T2_OTHER, { r20End: SYN_PROJ({ preferredArea: "大阪了換金澤再" }) })], re: /Session preferredArea 寫入原句夾帶（被否定）的其他城市「大阪」/, trigger: true },
    // ── A2-MP-T25（使用者裁決 5）：keepPool 依「未確認／成功確認」兩種狀態（keepPool [1]＝只限金澤未確認的 T2）──
    ...(() => {
      const sE = (id, kp) => scen(id, ["origin", "switchFail", "confirmNew"], [T1, T2_NEG_E, "好"], { otherCity: "大阪", exactRaw: true, keepPool: kp });
      const PE = SYN_P({ originalUserText: T2_NEG_E });
      const turns = [SYN.origin(0), SYN.switchFail(1, PE, T2_NEG_E, { r18RecAtStart: "京都", r18ArcAtStart: "京都", r17Arc: { destinationName: "京都" } }), SYN.confirmNew(2, PE, { r18RecAtStart: "京都", r18ArcAtStart: "京都", r17Arc: null })];
      return [
        { name: "E11 keepPool 成功確認：T2 未確認保留京都池、T3 金澤驗證成功後取代京都推薦池／Context（18e 欄位）→ 不判 SAFETY／INFRA", s: sE("kpok", [1]), turns, re: /SAFETY|INFRA/, cat: true, trigger: false, clean: true },
        { name: "E11 對照：同資料若把成功確認輪也列入 keepPool → 觸發（證明成功輪不誤判僅因狀態分類）", s: sE("kpall", [1, 2]), turns, re: /否定語句輪清掉京都推薦池/, trigger: true },
      ];
    })(),
    // ── A2-MP-T24：18b～18d 路由期望調整（使用者裁決 3；negSwitch／negSwitchYes）──
    ...negSwitchCases(),
    // ── A2-MP-T40：正常 noMore → 好 → 替代推薦（使用者契約 (一)）──
    ...noMoreAltCases(),
    // ── 2. 超過驗證上限 ──
    { name: "D2 每輪 >1：確認輪同時有 more_validate:金澤 與 post:金沢市 → 觸發", s: s06, turns: base06(null, null).map((t, i) => (i === 2 ? { ...t, geocodes: ["more_validate:金澤", "post:金沢市, 石川県, 日本"] } : t)), re: /同一輪金澤 Provider 驗證 2 次/, trigger: true },
    { name: "D2 對照：每輪 1 次 → 不觸發", s: s06, turns: base06(), re: /同一輪金澤 Provider 驗證/, trigger: false },
    { name: "D3 同 Pending >2：切換＋確認＋第二次確認（同 identity）→ 觸發", s: scen("v3", ["origin", "switchFail", "confirmFail", "confirmFail"], [T1, T2, "好", "好"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2), SYN.confirmFail(3, P2, P2)], re: /同一 Pending（identity 金澤／prev=京都／attraction／more_places）驗證=3 > 2/, trigger: true },
    { name: "D3 對照：第三次驗證屬於不同 identity（cafe 新 Pending）→ 不觸發", s: scen("v3c", ["origin", "switchFail", "confirmFail", "switchFail"], [T1, T2, "好", "換金澤，推薦咖啡廳"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2), SYN.switchFail(3, SYN_P({ categoryIntent: "cafe", originalUserText: "換金澤，推薦咖啡廳", confirmationAttempts: 1 }), "換金澤，推薦咖啡廳", { r18PendingAtStart: P2 })], re: /同一 Pending（identity[^）]*）驗證=\d+ > 2|confirmationAttempts 被重置/, trigger: false },
    // ── 3. confirmationAttempts 倒退 ──
    { name: "D4 attempts 倒退：同 identity 2→0 → 觸發", s: s06, turns: base06(SYN.keep(3, "好", P2, { r18Pending: SYN_P({ confirmationAttempts: 0 }) })), re: /confirmationAttempts 被重置／減少 2→0/, trigger: true },
    { name: "D4 對照：不同 identity（cafe）attempts=0 → 不觸發", s: s06, turns: base06(SYN.keep(3, "換金澤，推薦咖啡廳", P2, { r18Pending: SYN_P({ categoryIntent: "cafe", confirmationAttempts: 0, originalUserText: "換金澤，推薦咖啡廳" }) })), re: /confirmationAttempts 被重置/, trigger: false },
    { name: "D4b 一輪推進 0→2 → 觸發", s: scen("adv", ["origin", "switchFail", "confirmFail"], [T1, T2, "好"]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ confirmationAttempts: 0 })), SYN.confirmFail(2, SYN_P({ confirmationAttempts: 0 }), P2)], re: /一輪推進 0→2/, trigger: true },
    { name: "D4c 建立輪 attempts=2 → 觸發", s: scen("cre2", ["origin", "switchFail"], [T1, T2]), turns: [SYN.origin(0), SYN.switchFail(1, P2)], re: /建立輪 confirmationAttempts=2/, trigger: true },
    // ── 4. 以相同 identity 重建規避上限 ──
    { name: "D5 重建規避：達上限後清除、以相同 identity（raw 金沢）重建 attempts=0 並再驗證 → 觸發（canonical 合一）", s: scen("rebuild", ["origin", "switchFail", "confirmFail", "confirmCapped", "rebuildCapped"], [T1, T2, "好", "好", "換金沢，再推薦幾個"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2), SYN.keep(3, "好", P2, { r18Pending: null }), SYN.switchFail(4, SYN_P({ rawGeographicLabel: "金沢", originalUserText: "換金沢，再推薦幾個", confirmationAttempts: 0 }), "換金沢，再推薦幾個", { geocodes: ["more_validate:金沢"] })], re: /confirmationAttempts 被重置／減少 2→0|驗證=3 > 2|已達上限（[^）]*驗證=2≥2[^）]*）後再次推進確認流程/, trigger: true, needAll: [/confirmationAttempts 被重置／減少 2→0/, /驗證=3 > 2/, /已達上限（[^）]*驗證=2≥2[^）]*）後再次推進確認流程/, /M1 嚴格上限違反/] }, // A2-MP-T18：訊息改列達到的上限；另要求 M1 也觸發
    { name: "D5 對照：達上限後以不同類別合法建立新 Pending（不驗證以外的上限檢查不觸發）", s: scen("rebuildc", ["origin", "switchFail", "confirmFail", "confirmCapped", "switchFail"], [T1, T2, "好", "好", "換金澤，推薦咖啡廳"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmFail(2, P1, P2), SYN.keep(3, "好", P2, { r18Pending: null }), SYN.switchFail(4, SYN_P({ categoryIntent: "cafe", originalUserText: "換金澤，推薦咖啡廳", confirmationAttempts: 1 }), "換金澤，推薦咖啡廳")], re: /confirmationAttempts 被重置|驗證=\d+ > 2|後再次推進確認流程|M1 嚴格上限違反/, trigger: false }, // A2-MP-T18：同步新訊息格式＋M1
    // ── 5. 確認輪天氣時序 ──
    { name: "D6 Weather 早於第一次金澤驗證 → 觸發", s: scen("w1", ["origin", "switchFail", "confirmNew"], [T1, T2, "好"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmNew(2, P1, { geocodes: ["weather:金沢市, 石川県, 日本", "more_validate:金澤"] })], re: /Weather 在金澤 Provider 驗證前就使用待確認金澤/, trigger: true },
    { name: "D6 對照：先驗證後 Weather → 不觸發", s: scen("w1c", ["origin", "switchFail", "confirmNew"], [T1, T2, "好"]), turns: [SYN.origin(0), SYN.switchFail(1), SYN.confirmNew(2, P1)], re: /Weather 在金澤 Provider 驗證前/, trigger: false },
    { name: "D6b 未確認期間 Weather 使用金澤座標 → 觸發", s: sHold(1), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "再推薦幾個", P1, { weatherCalls: 1, r18Weather: [{ phase: "weather", data: "[36.5613,136.6562]" }] })], re: /未確認金澤的座標被送去 Weather/, trigger: true },
    { name: "D6b 對照：未確認期間 Weather 用京都座標 → 不觸發", s: sHold(1), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "再推薦幾個", P1, { weatherCalls: 1, r18Weather: [{ phase: "weather", data: "[35.0116,135.7681]" }] })], re: /未確認金澤的座標被送去 Weather/, trigger: false },
    { name: "D6c 未確認期間 weather geocode 金澤 → 觸發", s: sHold(1), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "再推薦幾個", P1, { geocodes: ["weather:金沢市, 石川県, 日本"] })], re: /未確認金澤被 Weather geocode 使用/, trigger: true },
    // ── 修正 1：情境 18 所有候選地名 ──
    { name: "D7 情境 18：查詢「大阪了換金澤」（r3 K() 只取第一個＝金澤 → 漏抓）→ 觸發大阪被送去 Provider", s: scen("18", ["origin", "switchFail"], [T1, T2_OTHER], { otherCity: "大阪" }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_OTHER }), T2_OTHER, { geocodes: ["more_validate:大阪了換金澤"] })], re: /原句夾帶的其他城市「大阪」被送去 Provider/, trigger: true },
    { name: "D7 對照：查詢「金澤」→ 不觸發", s: scen("18c", ["origin", "switchFail"], [T1, T2_OTHER], { otherCity: "大阪" }), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: T2_OTHER }), T2_OTHER)], re: /原句夾帶的其他城市/, trigger: false },
    // ── 修正 2：等待輪 Builder ──
    { name: "D8 等待輪 Builder=1 → 觸發", s: sHold(1), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "再推薦幾個", P1, { builderCalls: 1 })], re: /未確認期間仍呼叫 Builder 1 次/, trigger: true },
    { name: "D8 對照：等待輪 Builder=0 → 不觸發", s: sHold(1), turns: [SYN.origin(0), SYN.switchFail(1), SYN.keep(2, "再推薦幾個", P1)], re: /未確認期間仍呼叫 Builder/, trigger: false },
    // ── 負向探針（Session 中的 Pending）──
    { name: "N1 輪初偽造 Pending（建立輪未知）原句夾帶座標（r3：自己比自己 → 漏抓）→ 觸發", s: scen("f1", ["forgedHold"], ["好"], { r18Pending: SYN_P({ originalUserText: coordT, confirmationAttempts: 0 }) }), turns: [synTurn(0, "好", { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", destination: null }], r18PendingAtStart: SYN_P({ originalUserText: coordT, confirmationAttempts: 0 }), r18Pending: SYN_P({ originalUserText: coordT, confirmationAttempts: 1 }) })], re: /originalUserText 附加座標（建立輪原句未知）/, trigger: true },
    { name: "N1 對照：輪初偽造 Pending 原句乾淨 → 不觸發", s: scen("f1c", ["forgedHold"], ["好"], { r18Pending: SYN_P({ confirmationAttempts: 0 }) }), turns: [synTurn(0, "好", { geocodes: ["more_validate:金澤"], trust: [{ status: "unavailable", destination: null }], r18PendingAtStart: SYN_P({ confirmationAttempts: 0 }), r18Pending: SYN_P({ confirmationAttempts: 1 }) })], re: /建立輪原句未知/, trigger: false },
    { name: "N2 輪初偽造 Pending 原句夾帶其他城市（大阪）→ 觸發", s: scen("f2", ["forgedHold"], ["好"]), turns: [synTurn(0, "好", { r18PendingAtStart: SYN_P({ originalUserText: "換金澤，順便大阪，再推薦幾個", confirmationAttempts: 0 }), r18Pending: SYN_P({ originalUserText: "換金澤，順便大阪，再推薦幾個", confirmationAttempts: 0 }) })], re: /夾帶其他城市 大阪/, trigger: true },
    { name: "N3 輪初偽造 Pending 原句夾帶半徑 → 觸發", s: scen("f3", ["forgedHold"], ["好"]), turns: [synTurn(0, "好", { r18PendingAtStart: SYN_P({ originalUserText: "換金澤 半徑3公里，再推薦幾個", confirmationAttempts: 0 }), r18Pending: SYN_P({ originalUserText: "換金澤 半徑3公里，再推薦幾個", confirmationAttempts: 0 }) })], re: /附加搜尋範圍（建立輪原句未知）|含範圍字樣（建立輪原句未知）/, trigger: true },
    { name: "N4 rawGeographicLabel「金澤 半徑3公里」→ 觸發", s: scen("raw", ["origin", "switchFail"], [T1, "換金澤 半徑3公里，再推薦幾個"]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ rawGeographicLabel: "金澤 半徑3公里", originalUserText: "換金澤 半徑3公里，再推薦幾個" }), "換金澤 半徑3公里，再推薦幾個")], re: /rawGeographicLabel 夾帶範圍字樣/, trigger: true },
    { name: "N5 同一流程重複寫入不同 Pending → 觸發", s: scen("mw", ["origin", "switchFail"], [T1, T2]), turns: [SYN.origin(0), SYN.switchFail(1, P1, T2, { r21Writes: [{ p: SYN_P({ confirmationAttempts: 0 }), inFrame: true }, { p: P1, inFrame: false }] })], re: /同一輪寫入 2 個內容不同/, trigger: true },
    { name: "N5 對照：同一流程寫入一次 → 不觸發", s: scen("mwc", ["origin", "switchFail"], [T1, T2]), turns: [SYN.origin(0), SYN.switchFail(1)], re: /同一輪寫入/, trigger: false },
    { name: "N6 parentIntent 缺少 → 觸發", s: scen("pi", ["origin", "switchFail"], [T1, T2]), turns: [SYN.origin(0), SYN.switchFail(1, (({ parentIntent, ...x }) => x)(P1))], re: /缺 parentIntent/, trigger: true },
    { name: "N6b parentIntent=trip_planning → 觸發", s: scen("pi2", ["origin", "switchFail"], [T1, T2]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ parentIntent: "trip_planning" }))], re: /parentIntent="trip_planning"/, trigger: true },
    { name: "N7 長度 501 字（放寬範圍內）→ 不觸發長度", s: scen("l501", ["origin", "switchFail"], [T1, fill(501)]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: fill(501) }), fill(501))], re: /originalUserText 長度/, trigger: false },
    { name: "N7 長度 4000 字（＝既有上限）→ 不觸發長度", s: scen("l4000", ["origin", "switchFail"], [T1, fill(4000)]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: fill(4000) }), fill(4000))], re: /originalUserText 長度/, trigger: false },
    { name: "N7 長度 4001 字 → 觸發", s: scen("l4001", ["origin", "switchFail"], [T1, fill(4001)]), turns: [SYN.origin(0), SYN.switchFail(1, SYN_P({ originalUserText: fill(4001) }), fill(4001))], re: /originalUserText 長度 4001 > 既有上限 4000/, trigger: true },
  ];
}
export function runSelfTest() {
  const LIM = SYN_LIM() ?? { userText: 4000, label: 120 };
  const rows = [];
  for (const c of selfTestCases()) {
    let fails = [];
    let err = "";
    let res = null;
    try {
      const r = evalScenario({ s: { ...c.s, r15Modes: [OK], r19Coords: COORDS }, turns: c.turns, refCost: SYN_REF, LIM, ev: { coordsKyoto: false, coordsKanazawa: false }, tree: "self" });
      fails = r.SF.fails;
      res = r;
    } catch (e) {
      err = String(e?.message ?? e);
    }
    const hit = c.cat ? fails.filter((x) => x.cat === "SAFETY" || x.cat === "INFRA") : fails.filter((x) => c.re.test(x.msg));
    let pass = !err && (hit.length > 0) === c.trigger;
    if (pass && c.needAll) pass = c.needAll.every((re) => fails.some((x) => re.test(x.msg)));
    if (pass && c.check) pass = Boolean(res && c.check(res)); // A2-MP-T18：另驗 identity 統計（例：達上限後保留輪數）
    rows.push({ name: c.name, trigger: c.trigger, got: hit.length > 0, pass, err, evidence: (hit[0]?.msg ?? (c.trigger ? "" : fails.filter((x) => x.cat === "SAFETY")[0]?.msg ?? "")).slice(0, 180) });
  }
  // A2-MP-T42（M2）：項目列判定（觸發＝判定不是 PASS）
  for (const c of rowVerdictCases()) {
    let v = "";
    let err = "";
    try {
      v = rowVerdict(c.R);
    } catch (e) {
      err = String(e?.message ?? e);
    }
    const pass = !err && v === c.want && (c.n === undefined || c.R.model.length === c.n);
    rows.push({ name: c.name, trigger: c.want !== "PASS", got: v !== "PASS", pass, err, evidence: `判定=${v || "-"} 期望=${c.want} 模型輪=${c.R.model.length} 失敗=${c.R.fails.length}` });
  }
  // mp25-r3 對照（證明修正前的判定會漏抓；以 mp25-r3 L123-128 K()、L144 geoAll、L276／L508 ref 的原寫法逐字重算）
  const R3_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
  const r3K = (v) => {
    if (v == null || v === "") return null;
    const k = R3_KEYS.find((x) => String(v).includes(x)) ?? "?";
    return k === "金沢" ? "金澤" : k;
  };
  const r3Geo = (geocodes, d) => geocodes.filter((g) => r3K(String(g).split(":").slice(1).join(":")) === d || (d === "大阪" && /Osaka/i.test(String(g))));
  const forgedCoord = `${T2} (36.5613,136.6562)`;
  const r3 = [
    { name: "r3 對照 D7：mp25-r3 geoAll(大阪) 對「more_validate:大阪了換金澤」", missed: r3Geo(["more_validate:大阪了換金澤"], "大阪").length === 0, note: `r3 K()=${r3K("大阪了換金澤")}` },
    { name: "r3 對照 N1：mp25-r3 ref＝Client 注入 Pending 自己的 originalUserText → 座標檢查", missed: !(COORD_RE.test(forgedCoord) && !COORD_RE.test(forgedCoord)), note: "COORD_RE.test(o) && !COORD_RE.test(ref) 恆為 false" },
    { name: "r3 對照 D3 對照組：mp25-r3 情境合計 kzGeoUntilConfirm（不同 identity 合計 3 > 2）", missed: false, note: "r3 會把不同類別的第 3 次驗證合計成 3 → 誤判；r4 依 identity 分開（見 D3 對照）", misjudge: 1 + 1 + 1 > LIMITS.validatePerPending },
  ];
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length, lim: LIM, r3 };
}
const selfTestLines = (st) => [
  `── 偵測器自我測試 ${st.pass}/${st.n}（合成資料注入；觸發＝該偵測器訊息出現；對照＝正確行為不得誤判）──`,
  ...st.rows.map((r) => `  [${r.pass ? "OK" : "NG"}] ${r.name}｜期望=${r.trigger ? "觸發" : "不觸發"} 實際=${r.got ? "觸發" : "不觸發"}${r.err ? `（例外：${r.err}）` : ""}${r.evidence ? `（${r.evidence}）` : ""}`),
  ...(st.r3 ?? []).map((x) => `  [r3] ${x.name}：${x.misjudge !== undefined ? (x.misjudge ? "r3 誤判" : "r3 不誤判") : x.missed ? "r3 漏抓（修正前會失敗）" : "r3 會抓到"}（${x.note}）`),
  `  ${CREDITS_R1_UNVERIFIED}`, // A2-MP-T56（CHANGES #48）
];

// ════════════════ report ════════════════
export const ITEMS = [
  { no: 1, name: "未確認金澤不搜尋、不扣點", scen: "01,02,03", where: "judgeTurn 全輪：未確認金澤 shown／六欄寫入／Credits metadata；N2 未確認期間 Places／Builder（r4：hold／idle 補 Builder）／Credits；N3 Session 地理投影不變；N4 金澤座標；N5 非 RPC 寫入" },
  { no: 2, name: "回覆「好」不搜尋京都", scen: "05,06,06b,07b,08b,09,14,14b,14e,14f,14g,14j,18", where: "evalScenario：「好」且 YES_KINDS 輪 Places／Credits／卡片含京都 → OLD-CITY" },
  { no: 3, name: "回覆「再推薦幾個」不搜尋京都", scen: "02,02b,07,08,09b", where: "judgeTurn hold：kyotoShown → OLD-CITY；N2 Places>0、Builder>0" },
  { no: 4, name: "回覆「便宜一點的」不搜尋京都", scen: "03", where: "judgeTurn hold（同上）" },
  { no: 5, name: "明確選擇京都才恢復京都", scen: "04,06e", where: "judgeTurn chooseOld／oldMore" },
  { no: 6, name: "確認金澤後需重新驗證", scen: "05,05b,09,18（REF 基準）", where: "judgeTurn confirmNew：trusted 金澤＋V(金澤)≥1＋標籤／中心＝金澤＋成本 ≤ REF" },
  { no: 7, name: "Provider 再次 timeout", scen: "06,06b", where: "judgeTurn confirmFail／confirmCapped" },
  { no: 8, name: "Provider null", scen: "07,07b", where: "judgeTurn switchFail／hold／confirmFail" },
  { no: 9, name: "ZERO_RESULTS", scen: "08,08b", where: "judgeTurn switchFail／hold／confirmFail" },
  { no: 10, name: "重複詢問上限", scen: "06b,06c,06d", where: "evalScenario：同一 identity 確認請求（依確認行為）> 3 → SAFETY；達上限後再次推進確認流程 → SAFETY；自我測試 D1／D1b" },
  { no: 11, name: "重複驗證上限", scen: "06,06b,06c,06d,06e", where: "judgeTurn V≤1／confirmCapped／rebuildCapped／idle V=0；confirmationAttempts 0–2、同 identity 不減少、一輪 ≤+1、建立輪 ≤1、≥ 已執行確認驗證；evalScenario：同一 identity 驗證 ≤2；自我測試 D2～D5" },
  { no: 12, name: "偽造 Pending", scen: "14,14b,14g,14j", where: "judgeTurn forgedHold／forgedOk；Pending 欄位白名單；parentIntent 其他值；未知建立輪原句 fail-closed（座標／範圍／其他城市）" },
  { no: 13, name: "偽造 previousConfirmedDestination", scen: "14c,14d,14e,14f,14h", where: "judgeTurn forgedPrev*；Pending prev≠Session 可信城市 → SAFETY" },
  { no: 14, name: "原句夾帶其他城市", scen: "18", where: "judgeTurn otherCity（r4：查詢字串／欄位的所有候選地名；大阪不得驗證／搜尋／扣點／寫入／成為 raw）＋N6 originalUserText＝建立輪原句、含 raw、不拼接父城市、無座標／範圍、≤ 既有上限；parentIntent 缺少；自我測試 D7" },
  { no: 15, name: "Pending 取消與 Reload", scen: "09,09b,10", where: "evalScenario restoredAt；judgeTurn cancel／noRevive" },
  { no: 16, name: "新目的地覆蓋舊 Pending", scen: "11,06d", where: "judgeTurn replace／noRevive" },
  { no: 17, name: "activeCategoryIntent 不得污染", scen: "全部（Pending 存在的輪）＋14j＋04/06e chooseOld", where: "judgeTurn N7；14j；chooseOld；r20 探針 R-N01／R-N02" },
  { no: 18, name: "金澤／京都 Mock 座標不同", scen: "全部（r19Coords）", where: "judgeTurn origin／confirmNew／N4；需有座標證據才可 PASS" },
  { no: 19, name: "Provider 與 Weather 分開計數", scen: "全部", where: "judgeTurn：V(金澤)≤1、WG≤1、W≤1、未確認金澤 WG／W 座標＝0、確認輪 weather 不得早於金澤首次驗證；失敗輪 Weather／Builder=0；自我測試 D6" },
  { no: 20, name: "Credits 預留與結算安全", scen: "全部（02b、12b 故障）", where: "creditsFails；未確認期間任何 credits_* RPC（含 credits_check）＝0" },
  { no: "C1", name: "（r2 #12 對照）同目的地正常續推", scen: "12,12b", where: "judgeTurn same；12b 正式 fallback continue；work geocode／Places ≤ mp1" },
  { no: "S1", name: "超出上限後不再呼叫 Provider", scen: "06,06b,06c", where: "confirmCapped／rebuildCapped／idle：V(金澤)=0；達上限後再次推進 → SAFETY" },
  { no: "S2", name: "不因相同輸入重建 Pending 而繞過上限", scen: "06c", where: "rebuildCapped V=0；同 identity confirmationAttempts 不減少；同 identity 驗證 ≤2（canonical：金沢＝金澤）；自我測試 D5" },
  { no: "S3", name: "合法 Pending 寫入不被誤判為 P1", scen: "r20 探針 R-E01～R-E10", where: "r20 r20ExceptionProbe（每次執行先跑；不符 → INFRA-FAIL）" },
  { no: "S4", name: "夾帶非法 Session 欄位仍判 P1", scen: "r20 探針 R-N01～R-N41", where: "同上" },
  { no: "S5", name: "r21 負向探針（輪初偽造／夾帶城市／座標半徑／同一流程重複寫入／501～4000 字／send() 層）", scen: "r21 探針 R21-*／S-*", where: "r21 r21Probe（每次執行先跑；不符 → INFRA-FAIL）；本檔讀 globalThis.__R21_PROBE" },
  { no: "S6", name: "偵測器自我測試（合成資料）", scen: "SELF-*", where: "runSelfTest（每次 report 前執行）：詢問上限、驗證上限（每輪／同 identity）、attempts 倒退／推進、相同 identity 重建、Weather 時序、情境 18 多候選、等待輪 Builder、Pending 負向探針" },
  // ── A2-MP-T18 ──
  { no: "S7", name: "M1 嚴格上限（達任一上限後不驗證不詢問）", scen: "06,06b,06c,T3,T7,T7b（＋標籤）", where: "evalScenario：本輪開始時 identity 驗證≥2／attempts≥2／詢問≥3 任一 → 本輪 Provider 驗證、進入該 identity 可信判定、attempts 增加、Pending 改寫、Places／Builder／Weather／Credits → SAFETY；否則 INFO 達上限後保留；確認請求只在三上限皆未達時 +1；自我測試 D1、D1c～D1h" },
  { no: "S8", name: "否定語句不得重置／送 Provider", scen: "18b,18c,18d,18e", where: "judgeTurn otherCity（Provider／Credits／卡片／六欄／Session 地理投影／Pending raw）＋exactRaw（Pending raw 與驗證查詢字串須為乾淨地名）＋keepPool（不得清掉京都推薦池／Context／activeCategoryIntent）＋switchFail／confirmNew（18e）；18b～18d 改 negSwitch／negSwitchYes（A2-MP-T24 使用者裁決 3；有 Pending 時照舊 switchFail／confirmNew）；自我測試 D11～D13、E0～E10" },
  { no: "S9", name: "冷卻／ZERO_RESULTS／cached miss", scen: "T1,T2,T3,T4,T5,T6", where: "turnExpect：本輪 V(金澤) 與 attempts 增量依 chat-turn-destination.ts（TRANSIENT_RETRY_MS 15000；ZERO_RESULTS＝transient；行政區不符＝unavailableCityKeys）；r21ClockByTurn（r21-C）控制子程序 Date.now；未生效 → INFRA；A2-MP-T25：05／09／18／18e 確認輪前 +16 秒（冷卻後確認；使用者裁決 1；只用於時間前提，判定歸原項目 6／2／14／15／S8）；自我測試 D9／D9b／D9c／D10" },
  { no: "C2", name: "（對照）正常換城市／新行程／同城行政區", scen: "C2a,C2b,C2c", where: "judgeTurn replace／newTrip（既有 city_changed 重置保留）／sameCityArea（cross-destination MP-05g 既有行為）" },
  // ── A2-MP-T40 ──
  { no: "NM", name: "正常 noMore → 好 → 替代推薦", scen: "NM", where: "judgeTurn noMoreOffer（京都推薦用完 → 正常替代推薦提問、不被 E2f 擋住、travelContext 保留京都、不扣點）／altYes（必須 alternative_recommendations(real)＝正式 Callback，否則 MODEL＝UNVERIFIED；京都卡片、Places＝京都、Credits 恰 1 次京都且結算、卡片座標近京都、Session 與卡片一致、無 Pending、無金澤／大阪）；自我測試 NM0～NM8" },
];
export const DEFINITIONS = [
  "地名比對：Ks(s)＝字串中所有候選地名（PLACE_KEYS＋既有別名表詞彙），每個經 resolveDestinationAlias(x).normalizedName；K(s)＝第一個（單值欄位）；V(d)／geoAll(d)：查詢字串的所有候選含 d 即計入。",
  "identity＝[kind, canonical(rawGeographicLabel), previousConfirmedDestination, categoryIntent, originatingRoute]。",
  "驗證歸屬：輪末 Pending 為本輪新寫入（identity≠輪初）且 raw＝金澤 → 輪末 identity；否則輪初 Pending（raw＝金澤）；否則輪末 Pending；皆無（無 Pending 的樹）→ 由輪初情境推得（destination_switch／金澤／輪初 rec 或 travelContext 目的地／輪初 activeCategoryIntent／more_places）。同一 identity 至確認成功為止 ≤2。",
  "確認請求（依確認行為，不依問號／文案）：輪末持有 identity X 的 Pending＋本輪新助理訊息＋無卡片，且 X 驗證次數（本輪前）< 2 → X 的確認請求 +1，>3 → SAFETY。",
  "達上限後（X 驗證次數 ≥2）：本輪再驗證 X、confirmationAttempts 增加、或 Pending 被新寫入／改寫 → SAFETY（重複確認）；只是原樣保留 Pending＋說明文字（可含問號）→ 不算確認請求（INFO：達上限後保留輪數）。",
  "attempts：同一 identity 不得小於歷史最大值、不得少於已執行確認輪驗證數、一輪最多 +1；新 identity 建立輪 ≤1；0–2。",
  "M1（A2-MP-T18 使用者裁決，嚴格）：本輪開始時 identity 已達任一上限（驗證≥2、confirmationAttempts≥2、確認詢問≥3）→ 不計確認請求；本輪 Provider 驗證（含進入該 identity 的 trust／驗證入口）、attempts 增加、Pending 改寫、Places／Builder／Weather／Credits 任一 → SAFETY；否則 INFO（達上限後保留）。明確重新指定（M1_EXEMPT_KINDS）不套用。",
  "r21ClockByTurn（A2-MP-T18；r21-C）：鍵＝turnIndex（0 起算，同 r18GeoByTurn），值＝毫秒；該輪開始前累加到子程序 Date.now（不實際等待）；obs.r21Clock 必須＝累計值，否則 INFRA。",
  "originalUserText：輪初同一 Pending → 建立輪原句（情境內可知者逐字相等；Client 注入者未知 → fail-closed：不得含座標／範圍字樣／raw、prev 以外城市）；本輪新寫入 → 本輪原句；≤ 4000（★ 相對原版 r19 500 的放寬）。",
];
export function report({ results, TREES, out }) {
  const SHOW = ["work", "mp1", "a2"].filter((t) => TREES.includes(t));
  const H = globalThis.__R19_H ?? {};
  const LIM = globalThis.__R20_LIMITS ?? null;
  const PROBE = globalThis.__R20_PROBE ?? null;
  const PROBE21 = globalThis.__R21_PROBE ?? null;
  out.push("\n══════════════ MP-25 destination_switch 失敗測試 r4（A2-MP-T9；r21 掛載；樹 work／mp1／a2）══════════════");
  out.push("  分類：PENDING＝切換意圖未保存／未清除／復活；OLD-CITY＝Provider 失敗後回到原城市；FEATURE＝確認／選擇／取消／回覆行為未達成；SAFETY＝未確認目的地被搜尋／扣點／寫入、Credits 結算錯誤、Provider 次數超限、r14-A2 違反；INFRA＝測試前提不成立");
  out.push(`  上限：${JSON.stringify(LIMITS)}；既有長度上限：${LIM ? `原句 ≤${LIM.userText}〔${LIM.src.userText}〕（★ 相對原版 r19 500 字的測試契約放寬）、地名 ≤${LIM.label}〔${LIM.src.label}〕` : "（缺；不是經 r21 執行 → INFRA）"}`);
  out.push(`  canonical identity：${CANON()?.src ?? "（缺；不是經 r21 執行 → INFRA）"}`);
  for (const d of DEFINITIONS) out.push(`  定義：${d}`);
  for (const tree of SHOW) {
    const h = H[tree];
    const model = (h?.refs ?? []).filter((r) => r.where === "model");
    out.push(`  r19-H ${tree.padEnd(5)} destination_switch 區段=${h?.region ? `L${h.region.start}-${h.region.end}（${h.region.statements} 句）` : "（無 handler → 模型照舊）"}；區段外（模型路徑）參照=${model.length ? model.map((r) => `L${r.line}`).join(",") : "0"}`);
  }
  // S6：偵測器自我測試（先跑；不符 → 項目 S6 FAIL，且列為 INFRA）
  let ST = null;
  try {
    ST = CANON() ? runSelfTest() : null;
  } catch (e) {
    ST = { rows: [], pass: 0, n: 1, err: String(e?.message ?? e) };
  }
  out.push(...(ST ? selfTestLines(ST) : ["── 偵測器自我測試：未執行（缺 canonical identity）──"]));
  const rows = {};
  const row = (no, tree) => ((rows[no] ??= {})[tree] ??= { fails: [], ran: 0, model: [], na: [] });
  const scenFails = {};
  const tagged = {};
  const evidence = {};
  // REF 成本（每樹）
  const refCost = {};
  for (const tree of SHOW) {
    const r = results[`${tree}|ok|MP25R4-REF-switch-ok`];
    const t = r?.result?.turns ? turnOf(r.result.turns, 1) : null;
    if (t && (t.r15Cards ?? []).length && uniq((t.r15Cards ?? []).map(cardDest)).every((d) => d === "金澤")) refCost[tree] = { places: t.placesRequests ?? 0, builder: t.builderCalls ?? 0, weather: t.weatherCalls ?? 0, weatherGeo: weatherGeo(t).length, begins: (t.r15Credits ?? []).length, v: geoV(t, "金澤").length };
  }
  out.push(`  REF（既有推薦流程 T2 成本；confirmNew 基準）：${SHOW.map((tree) => `${tree}=${refCost[tree] ? JSON.stringify(refCost[tree]) : "（未成立）"}`).join("  ")}`);
  for (const s of NEW_SCENARIOS) {
    out.push(`\n[MP25R4][${s.id}] 項目 ${s.items.join(",")}：${s.label}`);
    for (const tree of SHOW) {
      const r = results[`${tree}|ok|${s.id}`];
      if (!r) continue;
      const ev = (evidence[tree] ??= { coordsKyoto: false, coordsKanazawa: false });
      let SF;
      if (lim(LIM) || !CANON()) {
        SF = { fails: [{ cat: "INFRA", msg: `${s.id}：缺 r20 既有長度上限或 r21 canonical identity（不是經 r21 執行）`, tags: [] }], model: [], na: [], ran: 1 };
      } else if (r.err || r.result?.error) {
        SF = { fails: [{ cat: "INFRA", msg: `${s.id}：${String(r.err ?? r.result.error).slice(0, 160)}`, tags: [] }], model: [], na: [], ran: 1 };
        out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
      } else {
        let e;
        try {
          e = evalScenario({ s, turns: r.result.turns ?? [], refCost: refCost[tree] ?? null, LIM, ev, tree, mp1Turns: results[`mp1|ok|${s.id}`]?.result?.turns ?? null });
        } catch (err) {
          e = { SF: { fails: [{ cat: "INFRA", msg: `${s.id}：判定例外 ${String(err?.message ?? err).slice(0, 160)}`, tags: [] }], model: [], na: [], ran: 1 }, lines: [], tagged: {} };
        }
        SF = e.SF;
        out.push(...e.lines);
        for (const [tg, xs] of Object.entries(e.tagged)) for (const x of xs) if (!SF.fails.includes(x)) ((tagged[tg] ??= {})[tree] ??= []).push(x);
        for (const x of SF.fails) for (const tg of x.tags ?? []) ((tagged[tg] ??= {})[tree] ??= []).push(x);
      }
      if (r.fetchCalls) SF.fails.push({ cat: "SAFETY", msg: `外部請求 ${r.fetchCalls} 次`, tags: [] });
      (scenFails[s.id] ??= {})[tree] = SF;
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
        addScenToRow(R, SF); // A2-MP-T42（M2）：原 4 行抽成共用函式；另把 SF.model（模型路徑輪）計入 R.model
      }
      for (const x of tagged[it]?.[tree] ?? []) {
        R.ran += 1;
        if (x.cat === "MODEL") R.model.push(x);
        else if (!R.fails.includes(x)) R.fails.push(x);
      }
      if (it === 2 || it === 17 || it === 18 || it === 19 || it === 20) R.ran += 1;
    }
  const outsideModel = (H.work?.refs ?? []).filter((r) => r.where === "model").length;
  out.push(`\n── MP-25 r4：必修 20 項＋對照 C1＋同時測試 S1～S6 × 樹（PASS／FAIL／UNVERIFIED；括號＝失敗分類計數）──`);
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
      } else if (it.no === "S5") {
        const g = PROBE21?.groups;
        const ok = g && ["canonical", "r20-51", "r21-new", "send"].every((k) => g[k] && g[k].n > 0 && g[k].pass === g[k].n);
        v = PROBE21 ? (ok ? "PASS" : "FAIL") : "INFRA";
        tail = PROBE21 ? `(r21 探針 ${PROBE21.pass}/${PROBE21.n})` : "";
      } else if (it.no === "S6") {
        v = ST && !ST.err ? (ST.pass === ST.n ? "PASS" : "FAIL") : "INFRA";
        tail = ST ? `(自我測試 ${ST.pass}/${ST.n})` : "";
      } else {
        const r = rows[it.no]?.[tree];
        if (!r || !r.ran) return `${tree}=-`;
        const cats = {};
        for (const x of r.fails) cats[x.cat] = (cats[x.cat] ?? 0) + 1;
        v = rowVerdict(r); // A2-MP-T42（M2）：同原式（fails → FAIL；model → UNVERIFIED；否則 PASS），抽成共用函式供自我測試
        if (v === "PASS" && it.no === 18 && !(evidence[tree]?.coordsKyoto && evidence[tree]?.coordsKanazawa)) v = "UNVERIFIED";
        if (v === "PASS" && tree === "work" && outsideModel) v = "UNVERIFIED";
        tail = `${r.fails.length ? `(${Object.entries(cats).map(([k, n]) => `${k}:${n}`).join(",")})` : ""}${r.model.length && !r.fails.length ? `(模型輪:${r.model.length})` : ""}${it.no === 18 ? `(座標證據 京都=${evidence[tree]?.coordsKyoto ? "Y" : "N"} 金澤=${evidence[tree]?.coordsKanazawa ? "Y" : "N"})` : ""}`;
        if (tree === "work") {
          for (const x of r.fails) if (!CAT_EXPECTED.has(x.cat)) otherWork.push(`項目 ${it.no}：[${x.cat}] ${x.msg}`);
          for (const x of r.model) modelWork.push(`項目 ${it.no}：${x.msg ?? x}`);
        }
      }
      if ((it.no === "S5" || it.no === "S6") && tree === "work" && v !== "PASS") otherWork.push(`項目 ${it.no}：[INFRA] ${it.name} ${v}`);
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
  out.push(`── Credits 未驗證範圍（A2-MP-T56）──\n  ${CREDITS_R1_UNVERIFIED}`);
  out.push(`MP-25 r4（work）：非 PASS 項目=${workFail}/${ITEMS.length}；SAFETY／INFRA=${uniq(otherWork).length}；MODEL=${uniq(modelWork).length}；自我測試=${ST ? `${ST.pass}/${ST.n}` : "-"}；r21 探針=${PROBE21 ? `${PROBE21.pass}/${PROBE21.n}` : "-"}`);
  out.push(`@@MP25R4_SUMMARY@@${JSON.stringify(summary)}`);
  // 任務單 #60：GP 探針（只在本次結果含 GP 情境時輸出；只新增輸出，不影響上方任何判定、計數與回傳值）
  if (GP_SCENARIOS.some((s) => SHOW.some((tree) => results[`${tree}|ok|${s.id}`]))) {
    try {
      out.push(...gpProbeLines(results, SHOW));
    } catch (e) {
      out.push(`\n══ GP 探針：輸出例外（不影響既有判定）${String(e?.message ?? e).slice(0, 200)} ══`);
    }
  }
  return { fail: workFail, pass: ITEMS.length - workFail };
}
/**
 * 任務單 #60：GP 探針逐輪原始值（A～F）。不 push 進任何 SF／tagged／rows；殘破 query 只標「P1 候選（GP）」。
 *   A geocode query 原字串（obs.geocodes＝phase:q；r15Geo 附 Mock 分類／結果）  B geocode 次數
 *   C 殘破地名：query 的地名段（phase 後、第一個逗號前）含 GP_BROKEN_ALL 任一片段
 *   D placesRequests／placesQueries  E creditsRpc（＋creditsBegin／settle）
 *   F Session：輪末 travelContext.destination／rec／tpc／preferredArea／tripDestination／Pending raw 是否含殘破片段；後續輪是否再送殘破 query
 */
function gpProbeLines(results, SHOW) {
  const L = ["", "══════════════ GP 探針（任務單 #60；Geocoding 殘破地名；只記原始值，不計入既有 SAFETY／P1／項目列）══════════════"];
  const hits = (v) => {
    const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return GP_BROKEN_ALL.filter((b) => s.includes(b));
  };
  const qOf = (g) => String(g).split(":").slice(1).join(":");
  let cand = 0;
  let ctrlBad = 0;
  for (const s of GP_SCENARIOS) {
    L.push(`\n[GP][${s.id}] ${s.label}${s.r15Init ? `；r15Init=${JSON.stringify(s.r15Init)}` : ""}${s.r18Init ? `；r18Init=${JSON.stringify(s.r18Init)}` : ""}${s.r15Real ? `；r15Real 鍵=${Object.keys(s.r15Real).join(",")}` : ""}`);
    for (const tree of SHOW) {
      const r = results[`${tree}|ok|${s.id}`];
      if (!r) continue;
      if (r.err || r.result?.error) {
        L.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
        continue;
      }
      L.push(`  ${tree.padEnd(5)} fetchCalls(外部請求)=${r.fetchCalls ?? 0}`);
      let prevBroken = [];
      let prevModelBroken = false; // 任務單 #64
      for (const t of [...(r.result?.turns ?? [])].sort((a, b) => a.turnIndex - b.turnIndex)) {
        const geos = t.geocodes ?? [];
        const brokenQ = geos.filter((g) => hits(qOf(g).split(",")[0]).length);
        const sess = { travelContext: t.sessionDest ?? null, rec: t.r15Rec?.destination ?? null, recArea: t.r15Rec?.area ?? null, tpc: t.r18Tpc ?? null, preferredArea: t.r20End?.preferredArea ?? null, tripDest: t.r18TripDest ?? null, pendingRaw: t.r18Pending?.rawGeographicLabel ?? null, pendingKind: t.r18Pending?.kind ?? null, arc: t.r17Arc?.destinationName ?? null, aci: t.r20End?.activeCategoryIntent ?? null };
        const sessBroken = Object.entries(sess).filter(([, v]) => hits(v).length).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
        const endBroken = t.r20End ? hits({ ...t.r20End, lastAssistantReply: undefined }) : []; // 助理回覆文字不算 Session 地理欄位
        const carried = t.turnIndex > 0 && prevBroken.length ? `前輪殘破 Session 欄位=[${prevBroken.join(",")}]；本輪殘破 query=${brokenQ.length}` : "";
        L.push(`  ${tree.padEnd(5)} T${t.turnIndex + 1}「${t.text}」 path=${String(t.path ?? "").slice(0, 200)}`);
        L.push(`        A geocode=[${geos.map((g) => JSON.stringify(g)).join(",") || "-"}] r15Geo=${JSON.stringify((t.r15Geo ?? []).map((x) => ({ phase: x.phase, q: x.q, flow: x.flow, outcome: x.outcome, cls: x.validity?.cls ?? null, ref: x.validity?.ref ?? null })))}`);
        L.push(`        B geocode 次數=${geos.length}`);
        L.push(`        C 殘破 query=${brokenQ.length ? `Y [${brokenQ.map((g) => JSON.stringify(g)).join(",")}]（命中 ${uniq(brokenQ.flatMap((g) => hits(qOf(g).split(",")[0]))).join(",")}）` : "N"}`);
        L.push(`        D placesRequests=${t.placesRequests ?? 0} placesQueries=${JSON.stringify(t.placesQueries ?? [])} cards=${(t.r15Cards ?? []).length}`);
        L.push(`        E creditsRpc=[${(t.creditsRpc ?? []).join(",")}] creditsBegin=${JSON.stringify(t.r15Credits ?? [])} settle=${JSON.stringify(t.creditsSettle ?? [])}`);
        // 任務單 #64：只加輸出標示（判定不變）——殘破 Session 欄位出現在 r13 模型「未重建」路徑輪，或延續自這種輪 → 標示污染來自 MODEL 路徑（不作為正式碼證據）
        const modelTurn = String(t.path ?? "").includes("未重建");
        const anyBroken = sessBroken.length > 0 || endBroken.length > 0;
        const modelTag = anyBroken && modelTurn ? " ［Session 污染來自 MODEL 路徑（本輪 r13 模型未重建）；不作為正式碼證據］" : anyBroken && prevModelBroken ? " ［Session 污染延續自前輪 MODEL 路徑（r13 模型未重建）；不作為正式碼證據］" : "";
        L.push(`        F Session=${JSON.stringify(sess)} 殘破欄位=[${sessBroken.join(",") || "-"}] r20End 含殘破片段=[${endBroken.join(",") || "-"}]${carried ? ` 延續：${carried}` : ""}${modelTag}`);
        L.push(`        trust=${(t.trust ?? []).map((x) => `${x.status}:${x.label ?? "-"}→${x.destination ?? x.reason ?? "-"}`).join(",") || "-"} 助理=${JSON.stringify(assistantOf(t).map((x) => x.slice(0, 80)))}`);
        if (s.gpEntry) {
          // 任務單 #61：入口證據（只輸出原始值）。more＝pushMorePlaceRecommendations（r14 R14_SHORT "more"）；dp＝pushDestinationPlaceRecommendation（"dp"）。
          const p = String(t.path ?? "");
          const ent = { more: /\|real:more=/.test(p), dp: /\|real:dp=/.test(p), destination_places_real: p.includes("destination_places(real)"), fb_destination_places_real: p.includes("fb_destination_places(real)"), continuation_real: /continuation:[A-Z_]+\(real\)/.test(p) };
          const reached = s.gpEntry === "more_places" ? ent.more : ent.dp;
          L.push(`        入口[${s.gpClass}${s.gpPremise ? `；${s.gpPremise}` : ""}] 目標=${s.gpEntry} 到達=${reached ? "Y" : "N"} 標記=${JSON.stringify(ent)}`);
          L.push(`        flows=${JSON.stringify((t.r15Flows ?? []).map((f) => ({ fn: f.fn, nested: f.nested, label: f.label, status: f.status, reason: f.reason, centerSource: f.centerSource, destination: f.destination, geo: f.geo })))}`);
        }
        if (brokenQ.length) {
          if (s.gpControl) {
            ctrlBad += 1;
            L.push(`        ※ 對照句出現殘破 query（探針假設不成立，需檢查）`);
          } else {
            cand += 1;
            L.push(`        ★ P1 候選（GP；不計入既有 SAFETY／P1）：${tree} T${t.turnIndex + 1} 以殘破地名送出 Geocoding ${brokenQ.length} 次`);
          }
        }
        prevBroken = [...sessBroken, ...endBroken.map((x) => `r20End:${x}`)];
        prevModelBroken = anyBroken && (modelTurn || prevModelBroken); // 任務單 #64：只供輸出標示
      }
    }
  }
  L.push(`\nGP 探針：P1 候選（殘破 query 輪數，含所有樹）=${cand}；對照句殘破 query=${ctrlBad}（只記錄，不影響 MP-25 r4 判定與結束碼）`);
  return L;
}
function lim(L) {
  return !L || !Number.isInteger(L.userText) || !Number.isInteger(L.label);
}

/** mp25-r3 → mp25-r4 的每一處斷言差異（舊 → 新 → 理由 → 修正項 → 放寬／加嚴）。 */
export const CHANGES = [
  { no: 1, old: "K(v)：PLACE_KEYS 第一個命中、手寫 金沢→金澤（r3 L124-128）；geoAll 以 K(查詢字串) 單值比對（r3 L144）", neu: "Ks(v)＝所有候選地名（PLACE_KEYS＋既有別名表詞彙），每個經既有 canonical identity（resolveDestinationAlias().normalizedName）；K＝Ks[0]（單值欄位相容）；geoAll：查詢字串所有候選含 d 即計入（英文正則保留）", why: "T8：「more_validate:大阪了換金澤」被 K() 判成金澤 → 情境 18 漏抓大阪；裁決 d：不自創地名規則", fix: "mp25 修正 1、4", kind: "加嚴（多候選）；金沢／金澤由手寫改為既有機制（結果相同）" },
  { no: 2, old: "otherCity：geoAll(OC)、shown（單值 K）、六欄（單值 K）、Pending raw K===OC（r3 L410-416）", neu: "同條件，全部改為多候選：geoAll（同 #1）、colsAll（Credits／卡片／Places 所有候選）、六欄原始字串 Ks、Pending raw Ks 含 OC", why: "同 #1；情境 18 不降級（裁決 5）", fix: "mp25 修正 1", kind: "加嚴" },
  { no: 3, old: "PENDING_KINDS（r3 L256-269）：Places／Credits／地理投影／非 RPC 寫入；CHANGES #10 宣稱 Builder 但程式未檢查", neu: "另加：非 FAIL_KINDS 的未確認輪（hold／idle）Builder>0 → OLD-CITY／SAFETY（FAIL_KINDS 原本已檢查 Builder）", why: "T8：CHANGES 說明與程式不一致", fix: "mp25 修正 2", kind: "加嚴" },
  { no: 4, old: "attemptsMax、confirmVal、kzGeoUntilConfirm 為整個情境合計（r3 L506-507、561-564、585）", neu: "依 Pending identity 分開（kind、canonical raw、previousConfirmedDestination、categoryIntent、originatingRoute）；同一 identity：驗證 ≤2（擴及所有非 REF 情境）、attempts 不得小於歷史最大值、不得少於已執行確認驗證；不同 identity 不合計", why: "T8：合法以不同類別重建會被誤判、相同 identity 重建須抓到", fix: "mp25 修正 3", kind: "修正誤判（不同 identity 不再合計）＋加嚴（擴及全部情境、canonical 合一）" },
  { no: 5, old: "Q4（r3 L552-560）：輪末同一 Pending＋新助理訊息＋無卡片＋（含？／? 或與先前提問逐字相同）→ asks+1；>3 → SAFETY", neu: "依確認行為：輪末持有 identity X 的 Pending＋新助理訊息＋無卡片，X 驗證（本輪前）<2 → 確認請求 +1（不看問號／文案）；>3 → SAFETY；達上限後再驗證／attempts 增加／Pending 被新寫入或改寫 → SAFETY（重複確認）；達上限後原樣保留＋說明（可含問號）不算", why: "裁決 4；T8 修正 5", fix: "mp25 修正 5", kind: "加嚴（不含問號的請求也算；達上限後推進即 SAFETY）；改判（達上限後含問號說明不算詢問＝依裁決 4）" },
  { no: 6, old: "creationText＝s.r18Pending.originalUserText（Client 注入的 Pending 自己比自己；r3 L508）；ref＝K(raw)===金澤 ? creationText : turnText（r3 L276）", neu: "ctx.pendRef：輪初同一 Pending → 該 identity 建立輪原句（情境內可知；Client 注入 → 未知 null）；本輪新寫入 → 本輪原句。未知 → fail-closed 絕對檢查（座標、範圍字樣／距離單位、raw／prev 以外城市、長度）", why: "T8 修正 e(1)／mp25 修正 7", fix: "mp25 修正 7", kind: "加嚴" },
  { no: 7, old: "Pending parentIntent：只在白名單內（可缺）", neu: "缺少 → PENDING；非 place_recommendation → SAFETY", why: "使用者裁決 1", fix: "裁決 1", kind: "加嚴" },
  { no: 8, old: "rawGeographicLabel：長度、座標字串", neu: "另加：範圍字樣／距離單位（「金澤 半徑3公里」）→ SAFETY", why: "T8 修正 e(3)", fix: "mp25 修正 7", kind: "加嚴" },
  { no: 9, old: "confirmationAttempts：0–2、不減少（整個情境）、≥ confirmVal（整個情境）", neu: "同（改依 identity）；另加：建立輪 ≤1、同一 Pending 一輪最多 +1", why: "使用者裁決 3（同一 User Turn 驗證 ≤1）", fix: "裁決 3", kind: "加嚴" },
  { no: 10, old: "（無）", neu: "同一輪 r21Writes（r21-O）內容不同的 destination_switch Pending ＞1 → SAFETY；缺 r21-O 記錄 → INFRA", why: "T8 修正 e(4)", fix: "mp25 修正 7", kind: "加嚴" },
  { no: 11, old: "（無）", neu: "偵測器自我測試 runSelfTest（合成資料 38 案：觸發／對照；另列 mp25-r3 寫法對照 3 條）；ITEMS 新增 S5（r21 探針）、S6（自我測試）", why: "T8：偵測器無自我測試", fix: "mp25 修正 6、7", kind: "加嚴" },
  { no: 12, old: "拒絕覆蓋：只擋 mp25／mp25-r2／mp25-r2-T6／mp25-T4／r19-subset／r19-subset-T6.log（r3 L717）", neu: "只能寫 scratchpad；明列舊 log（含 mp25-r3、mp25-r3-T8、r20-parity-r19subset(-T8)、mp-cross-r4-r20(-T8)…）＋啟動時所有 *.log／*.stdout＋任何已存在檔案", why: "T8 修正 8", fix: "mp25 修正 8", kind: "-" },
  { no: 13, old: "report 內逐情境迴圈（r3 L481-594）", neu: "抽成 evalScenario（report 與自我測試共用；條件式與分類照 r3，只改上列各點）", why: "讓自我測試跑的是同一份判定碼", fix: "mp25 修正 6", kind: "-（結構）" },
  { no: 14, old: "情境 ID 前綴 MP25R3-（33 個）；r20 掛載", neu: "MP25R4-（turns／r18GeoByTurn／reloadAfter／expect 不變）；r21 掛載", why: "與 r3 同時執行時避免 ID 衝突；r21 提供 canonical／r21-O", fix: "-", kind: "-" },
  { no: 15, old: "既有長度上限顯示", neu: "報告標示「★ 相對原版 r19 500 字的測試契約放寬」", why: "使用者裁決 2（揭露）", fix: "裁決 2", kind: "放寬揭露（數值不變）" },
  // ── A2-MP-T18（相對 A2-MP-T9 版 r4；副本 scratchpad/pre-MP25R3-copies/verify-more-places-destination-switch-mp25-r4.mjs）──
  { no: 16, old: "evalScenario L589：確認請求 +1 的條件只有「X 驗證次數（本輪前）< 2」；達上限後只抓「再驗證／attempts 增加／Pending 改寫」（且只在輪末持有 Pending＋新助理訊息＋無卡片時）", neu: "M1：本輪開始時 identity 已達任一上限（驗證≥2、confirmationAttempts≥2〔LIMITS.attemptsCap〕、確認詢問≥3）→ 不計確認請求；另在 Pending 有無、助理訊息有無都檢查：本輪 Provider 驗證、進入該 identity 的 trust／驗證入口（嚴格選項）、attempts 增加、Pending 改寫、Places／Builder／Weather／Credits（begin 或 credits_* RPC）→ SAFETY（標籤 10／11／S1／S7）；明確重新指定（M1_EXEMPT_KINDS）不套用；原「>3 → SAFETY」保留（M1 下不可達，未移除）", why: "使用者裁決 M1（嚴格）：06 系列「說明」不得被算成第 4 次確認請求；達上限後不得自動驗證／再次要求確認／增加 attempts／呼叫 Places・Builder／開始 Credits", fix: "A2-MP-T18 一", kind: "改判（達詢問上限後的原樣保留＋說明不再算第 4 次確認請求）＋加嚴（詢問／attempts 上限也禁止再驗證；trust 入口；成本）" },
  { no: 17, old: "達上限後再次推進訊息「驗證已達上限 2 後再次推進確認流程」", neu: "「已達上限（列出達到的上限）後再次推進確認流程」；條件式不變（rewritten || advanced）；heldAfterCap 只在 M1 未觸發時累加", why: "上限不再只有驗證次數", fix: "A2-MP-T18 一", kind: "-（訊息）；自我測試 D1b／D5 regex 同步（D5 另要求 M1 觸發＝加嚴）" },
  { no: 18, old: "自我測試 D1「hold ×3 → 第 4 次確認請求 觸發」、D1「不含問號第 4 次 → 觸發」", neu: "D1 依裁決 M1 改判「不觸發」並要求 asks=3、heldAfterCap=1；「依行為非文案」改為不含問號的回覆仍計入詢問 → 第 4 輪「好」再驗證觸發 M1；新增 D1c（達詢問上限後回「好」再呼叫 Provider → SAFETY）、D1c 對照、D1d（trust 入口）、D1e（Places／Credits）、D1f（attempts 上限）＋對照、D1g（attempts 增加）、D1h 對照（明確繼續京都）", why: "使用者裁決 M1；任務單要求負向探針", fix: "A2-MP-T18 一", kind: "改判（依裁決）＋加嚴" },
  { no: 19, old: "（無）", neu: "類似語句情境 18b／18c／18d／18e（大阪不去了，換金澤／不要去大阪，改金澤／不想去大阪了，換成金澤／…，再推薦幾個）：otherCity＋exactRaw＋keepPool＋switchFail→confirmNew", why: "情境 18 根因（trip-planning-session-reset.ts 取到被否定的大阪）；使用者授權新增最小類似語句", fix: "A2-MP-T18 二", kind: "加嚴（新情境）" },
  { no: 20, old: "otherCity：Provider／Credits／卡片／Places／六欄／Pending raw", neu: "另加：Session 地理投影（GEO_PROJ_KEYS：tc／tpc／trip／rec／arc／location／nla／searchScope／radius／preferredArea…）本輪新出現被否定城市 → SAFETY；exactRaw（Pending raw、非 weather 且不含逗號的金澤查詢字串必須是 KZ_RAW_OK）；keepPool（activeCategoryIntent 不變、輪初京都 rec／Context 不被清掉）", why: "任務單：不得把「大阪了換金澤再」之類字串寫入 Session、不得觸發重置清空京都推薦池與類別", fix: "A2-MP-T18 二", kind: "加嚴（只在新情境旗標 exactRaw／keepPool 時；otherCity 投影檢查對情境 18 也生效）" },
  { no: 21, old: "（無）", neu: "對照 C2a（改去大阪推薦景點 → replace）、C2b（幫我規劃大阪三天 → newTrip：無 destination_switch Pending、不以京都搜尋、京都 rec／Context 不再沿用、目的地成為大阪）、C2c（換京都東山，再推薦幾個 → sameCityArea：同 cross-destination MP-05g 既有行為＝不沿用京都城市池；驗證不成立時 Fail Closed＋destination_switch Pending〔京都東山／prev 京都〕且不得改寫京都 rec／travelContext，成立時卡片／Credits 只能是東山）；NON_CONFIRM ＋newTrip／sameCityArea", why: "E2 不得破壞正常換城市／新行程重置／同城行政區", fix: "A2-MP-T18 二", kind: "加嚴（新對照）" },
  { no: 22, old: "（無）", neu: "時間與快取情境 T1～T7b：r21ClockByTurn（r21-C）＋turnExpect（本輪 V(金澤) 次數〔多於契約 → SAFETY、少於 → FEATURE〕、attempts 增量〔不符 → FEATURE；無法比對 → PENDING〕）；r21Clock 未生效／外洩 → INFRA", why: "任務單四；ZERO_RESULTS 依正式碼為 transient（T16）、cached miss＝unavailableCityKeys", fix: "A2-MP-T18 四", kind: "加嚴（新情境）" },
  { no: 23, old: "ITEMS 27 項", neu: "＋S7（M1）、S8（否定語句）、S9（冷卻／ZERO_RESULTS／cached miss）、C2（對照）＝31 項；DEFINITIONS ＋M1、r21ClockByTurn", why: "報告分列", fix: "A2-MP-T18", kind: "-" },
  { no: 24, old: "runSelfTest：trigger／needAll", neu: "另支援 check(r)（以 identity 統計驗證，例：達上限後保留輪數）；新增 D9～D13（r21-C／turnExpect／exactRaw／keepPool／otherCity Session 投影）", why: "偵測器自我測試涵蓋新判定", fix: "A2-MP-T18", kind: "加嚴" },
  // ── A2-MP-T24（相對 A2-MP-T18 版 r4；副本 scratchpad/pre-T24-copies/verify-more-places-destination-switch-mp25-r4.mjs）──
  { no: 25, old: "18b／18c／18d expect=[origin, switchFail, confirmNew]（強制走 more_places：T2 必須保存 destination_switch／金澤／京都／attraction／more_places Pending，T3 必須確認金澤並出金澤卡片）", neu: "expect=[origin, negSwitch, negSwitchYes]；evalScenario resolveKind：T2 輪末有 destination_switch Pending → 照舊以 switchFail 嚴格判定、否則一般流程 negSwitch（＝switchFail 去掉「必須保存 more_places Pending」：FAIL_KINDS／PENDING_KINDS 檢查、Places／Credits／卡片＝0、rec／travelContext 保留京都、須有助理回覆）；T3 輪初有 destination_switch Pending → 照舊以 confirmNew 嚴格判定、否則一般流程 negSwitchYes（不得京都搜尋扣點顯示；有卡片 → 只能金澤、本輪 Provider 驗證、可信中心、Credits 恰 1 次金澤、rec／travelContext＝金澤、成本 ≤ REF；無卡片且金澤已確認 → 目的地須切換；無卡片且未確認 → 須保留金澤 Pending、京都不被改寫、不得啟動 Credits）。otherCity／exactRaw／keepPool [1]／S8 與所有全輪不變條件不變；KZ_CONFIRM_KINDS／YES_KINDS 加入兩新 kind（點名輪數仍 2）", why: "使用者裁決 3：沒有「再推薦幾個」續推尾巴的 18b～18d 不強制走 more_places，依既有一般目的地切換流程；只驗證正確目的地、無錯誤 Reset、無錯誤 Provider 查詢、無未確認扣點", fix: "A2-MP-T24", kind: "路由期望調整（使用者裁決 3）：不再強制 more_places Pending 與第 3 輪必出卡片（一般流程保留金澤 Pending 即可）；安全／負向斷言全部保留；自我測試 ＋E0～E10（15 案）" },
  { no: 26, old: "05／09／18／18e 確認輪「好」無時間偏移（T2 切換 timeout 後立即確認＝落在正式 TRANSIENT_RETRY_MS 15 秒冷卻內 → 正式碼不送 Provider，與 confirmNew 期望衝突）", neu: "05、09（reloadAfter：第二段子程序 turnIndex＝2）、18、18e 加 r21ClockByTurn: { 2: 16000 }，label 加註「（+16 秒）」；18b～18d 新 Source 探測 work T2 無 destination_switch Pending → 不套用；confirmNew／negSwitchYes 斷言、keepPool [1]（只限未確認的 T2）、06／T／C2 系列不變；自我測試 ＋D9c（套用情境 r21Clock 未生效 → INFRA／相符 → 不觸發／套用清單與不套用清單的結構檢查）＋E11（keepPool 只限未確認輪：成功確認輪取代京都推薦池不判 SAFETY）", why: "使用者裁決 1：只對「冷卻後確認成功」情境模擬時間前進 16 秒（不真實等待、不改正式 Cooldown 常數）；裁決 5：keepPool 依未確認／成功確認兩種狀態判定", fix: "A2-MP-T25", kind: "可控時間：冷卻後確認（使用者裁決 1）；斷言不變" },
  // ── A2-MP-T26（相對 A2-MP-T25 版 r4）──
  { no: 27, old: "05b（換金澤 timeout → 回覆「金澤」確認，expect confirmNew，label「Provider 成功」）確認輪無時間偏移（T2 切換 timeout 後立即確認＝落在正式 TRANSIENT_RETRY_MS 15 秒冷卻內 → 正式碼 provider_cooldown 不送 Provider；mp25-r4-T18b.log L1539-1542：T3 geocode=0、V(金澤)=0、attempts 仍 1 → confirmNew FEATURE 失敗，與 05 在 T25 前同因）", neu: "05b 加 r21ClockByTurn: { 2: 16000 }，label 加註「（+16 秒）」；T25_CLOCK_IDS ＋05b（D9c 三案自動涵蓋：未生效 → INFRA／相符 → 不觸發／結構清單）；confirmNew 斷言、cooldown 內保護（T1：「好」不前進時間，v=0、attempts +0）、06／T／C2／18b～18d 不變", why: "05b 原始意圖（mp25 r1 L59 起即為 05 的「回覆城市名」變體，同屬 items [6]「確認金澤後需重新驗證」：V(金澤)≥1＋金澤卡片）＝冷卻結束後確認成功，不是冷卻內確認保護（該保護由 T1 覆蓋）", fix: "A2-MP-T26", kind: "可控時間：冷卻後確認（使用者裁決 4）" },
  // ── A2-MP-T40（相對 A2-MP-T26 版 r4；施工前副本 scratchpad/pre-T39-copies/scripts/verify-more-places-destination-switch-mp25-r4.mjs sha256 2023962f…）──
  { no: 28, old: "（無）work 樹沒有「正常 noMore → 好 → 替代推薦」情境（A2-MP-T32／T35：UNVERIFIED，只有讀碼）", neu: "新情境 MP25R4-NM-nomore-yes-alt（附加在 NEW_SCENARIOS 最後，既有情境順序不變）：turns＝[再推薦幾個, 好]；r15Init＝INIT_KYOTO_EXHAUSTED（京都池 3 筆、batch 3＝已全顯示；既有 r15 buildInit）；r15EmptyDest＝NM_EMPTY_Q（既有 r15-X 欄位，只列景點類查詢關鍵字：續推 attraction 查詢全部回空 → noMore；替代推薦的美食／咖啡廳／餐廳／咖啡／博物館查詢仍有結果；不含「京都」）；expect＝[noMoreOffer, altYes]；新常數 STOPPED_RE（E2f destinationSwitchStopped 文案片段，chat-runtime.ts L36）", why: "使用者契約 (一)：京都推薦用完 → 提出正常替代推薦 → 回答「好」必須維持正常替代推薦、Credits 一次結算、京都搜尋範圍、Session／卡片一致、不被 E2f 擋住；必須進入正式 Callback", fix: "A2-MP-T40", kind: "加嚴（新情境；不改既有情境與 Fixture）" },
  { no: 29, old: "（無）", neu: "judgeTurn 新 kind：noMoreOffer（本輪有卡片 → INFRA 前提不成立；destinationSwitchStopped → FEATURE；無 noMore／替代推薦提問 → FEATURE；travelContext≠京都 → FEATURE／其他城市 SAFETY；destination_switch Pending → FEATURE；京都以外 Places／Credits → SAFETY；非正式路徑或未重建 → MODEL）／altYes（path 無 alternative_recommendations(real) → MODEL＝UNVERIFIED；被 E2f 擋住／無卡片／Places 無法確認京都／Credits.begin≠1 或 metadata≠京都／卡片座標不在京都 ±0.05／Pending → FEATURE；非京都卡片、京都以外城市（Credits／卡片／Places）、Places 範圍非京都、trusted 非京都、Session（travelContext／rec／Context／tpc／trip）非京都、Session 地理投影含金澤／大阪 → SAFETY）；NON_CONFIRM ＋noMoreOffer／altYes（金澤 Provider 驗證 → SAFETY）；KZ_CONFIRM_KINDS 不加（情境金澤驗證上限＝0）；YES_KINDS 不加（京都卡片是期望行為）", why: "使用者契約 (一)；只有 Harness MODEL 路徑必須標 UNVERIFIED，不得當 PASS", fix: "A2-MP-T40", kind: "加嚴（新判定）" },
  { no: 30, old: "negSwitchYes（無卡片且金澤未確認）L467：if (!dsOf(pend) || K(pend.rawGeographicLabel) !== \"金澤\") add(\"FEATURE\", \"否定語句切換後既未切換到金澤、也未保留金澤切換意圖…＝目的地不正確\")（刪除行）", neu: "if (dsOf(pend) && K(pend.rawGeographicLabel) !== \"金澤\") add(\"FEATURE\", \"否定語句切換後保留的切換意圖不是金澤…＝目的地不正確\")：只刪掉「無 Pending → FEATURE」這一半；「有 Pending 但不是金澤」照舊 FEATURE", why: "使用者契約 (二)「沒有明確續推要求時，不強制建立 more_places Pending」：E2f 後 18b 實際 T2 pending=null（mp25-r4-full-T35.log 18b T2 destinationSwitchStopped、Session 全京都、pending=null），T3「好」沒有 Pending 可確認 → 舊條件在正式路徑必判 FEATURE（與契約直接衝突；T32／T35 因 T3 走 later:other 模型路徑才只呈現為 MODEL）", fix: "A2-MP-T40", kind: "放寬（唯一一處；只限與契約直接衝突的「必須保留金澤 Pending」）" },
  { no: 31, old: "（無）negSwitchYes 無卡片且金澤未確認分支只檢查：京都不被改寫（SAFETY）、不啟動 Credits（SAFETY）、＋被刪的 FEATURE（任何無 Pending 的 T3 皆觸發，因此兼顧了替代推薦提問／其他搜尋）", neu: "另加（取代被刪條件原本兼顧的負向案例）：noMore／替代推薦提問（r20AltOffer 或 MISLEAD_RE）→ FEATURE（下一輪「好」會以舊京都扣點）；Places>0 且不是只搜京都 → SAFETY（京都搜尋照舊 kyotoShown → OLD-CITY，分類不變）；Builder>0 且非京都顯示 → SAFETY；並在 negSwitchYes 輪 path 含「未重建」時明確記 MODEL（刪除 FEATURE 後模型路徑 0 失敗會被報告列 PASS；改記 MODEL 使呈現與刪除前同為 UNVERIFIED）", why: "使用者契約 (二)：安全保護不變（不提出舊京都替代推薦、下一輪「好」不恢復京都扣點、不出錯誤 Places）；不得把 UNVERIFIED 呈現成 PASS", fix: "A2-MP-T40", kind: "加嚴" },
  { no: 32, old: "自我測試 E8「一般流程 T3 既未切換也未保留意圖（京都不變、無 Pending、無卡片）→ 觸發」（刪除行）；E8 對照 re＝/既未切換到金澤|錯誤 Reset|未確認仍啟動 Credits/（刪除行；訊息已改寫）", neu: "E8 改判「不觸發任何失敗」（以 E2f 實際形狀：T2 destinationSwitchStopped 文案、T3 無 Pending／無成本；re=/./）；E8 對照 re 改為 /目的地不正確|錯誤 Reset|未確認仍啟動 Credits/（同義，對應新訊息）；新增 E8b（Pending raw≠金澤 → 觸發）、E8c（模型路徑 0 成本 → 全部 MODEL）、E12（替代推薦提問）、E13（京都以外 Places → SAFETY）＋對照（京都 Places 仍 OLD-CITY）、E14（大阪扣點）、E15（Session 大阪污染）、E16（未確認金澤被當 trusted 寫入）、E17（下一輪「好」恢復京都扣點）；新增 noMoreAltCases NM0～NM8（17 案：正確流程、MODEL／非正式路徑、E2f 擋住、無提問、前提不成立、Credits 兩次／大阪／noMore 輪扣點、金澤範圍、座標、Session 不一致、Pending、無卡片）", why: "任務單 #40 第 3 點；E8 原判定與契約 (二) 直接衝突（同 #30）", fix: "A2-MP-T40", kind: "改判（E8，依契約）＋加嚴（新負向探針）" },
  { no: 33, old: "ITEMS 31 項", neu: "＋NM（正常 noMore → 好 → 替代推薦）＝32 項；檔頭說明 A2-MP-T40", why: "報告分列", fix: "A2-MP-T40", kind: "-" },
  // ── A2-MP-T42（相對 A2-MP-T40 版 r4；施工前副本 scratchpad/pre-T42-copies/scripts/verify-more-places-destination-switch-mp25-r4.mjs sha256 211a4ef7…；獨立審查 T41 必改 M2／M3、建議 S1）──
  { no: 34, old: "report 項目列彙整（T40 版 L1252-1254，刪除 3 行）：`R.ran += 1;`／`for (const x of SF.fails) (x.cat === \"MODEL\" ? R.model : R.fails).push(x);`／`R.na.push(...SF.na);`", neu: "改呼叫 addScenToRow(R, SF)：上述 3 行原樣搬入；另把 SF.model（evalScenario L854 記下的模型「未重建」路徑輪）計入 R.model（同輪已有 MODEL 失敗者不重複）；R.fails 不變", why: "M2：原彙整只把 cat=MODEL 的失敗計入 R.model，模型路徑 0 失敗的輪次被列成 PASS（mp25-r4-full-T35.log L15961-15962 項目 15、16 work=PASS；來源 MP25R4-10-cancel-reload／MP25R4-11-replace-osaka T4 noRevive 走 later:other(未重建…)〔同 log L14740／L14783〕）。★ 本修改會使項目 15、16（work）由 PASS 變為 UNVERIFIED——這是加嚴（模型路徑本來就沒有執行正式碼），不是退步。依 T35 log 推算，其他經過模型路徑的情境（18b～18d→項目 14／6／2／S8；C2b→C2）在 T35 已是 UNVERIFIED，不變；未實跑完整 mp25-r4 確認（任務單禁止）", fix: "A2-MP-T42", kind: "加嚴（只改呈現；FAIL 判定不變）" },
  { no: 35, old: "report L1290（刪除行）：`v = r.fails.length ? \"FAIL\" : r.model.length ? \"UNVERIFIED\" : \"PASS\";`", neu: "`v = rowVerdict(r);`（rowVerdict＝同一式子，逐字未改，抽成函式供自我測試）；自我測試新增 M2a／M2a 對照／M2b／M2c（rowVerdictCases：模型路徑 0 失敗 → UNVERIFIED；無模型 → PASS；有 FEATURE → 仍 FAIL；同輪不重複計入）", why: "M2：讓判定式可被自我測試驗證", fix: "A2-MP-T42", kind: "中性（式子不變）＋加嚴（新自我測試）" },
  { no: 36, old: "（無）negSwitchYes 無卡片且金澤未確認分支（T40 版 L484-497）沒有 Session 地理投影／activeCategoryIntent／京都推薦 Context／非 RPC 寫入／Weather／助理回覆檢查（negSwitchYes 不在 PENDING_KINDS；T40 刪除「須保留金澤 Pending」FEATURE 後，原本順帶抓到的這些負向案例失去覆蓋）", neu: "另加（比照 PENDING_KINDS N2／N3／N5，分類照原碼）：GEO_PROJ_KEYS 任一改變 → 原 N3 分類（只含原城市且本輪只搜原城市 → OLD-CITY，否則 SAFETY）[1]；activeCategoryIntent 改變 → SAFETY [17]（同 keepPool／Pending 存在輪）；輪初京都推薦 Context 被清除 → SAFETY（同 keepPool）；非 RPC Supabase 寫入 >0 → SAFETY（同 N5）；Weather>0 → oldOrSafety()（同 FAIL_KINDS 失敗輪）[19]；無助理回覆 → FEATURE（同 switchFail／negSwitch）。自我測試 E18／E19／E19b／E20／E21／E21b／E22 各觸發＋對照不觸發", why: "M3：補齊被刪條件原本兼顧的負向案例；使用者契約 18b～18d「不污染 Session、不提出舊京都替代推薦…安全保護不變」", fix: "A2-MP-T42", kind: "加嚴" },
  { no: 37, old: "altYes L515（刪除行）：`if (!/alternative_recommendations\\(real\\)/.test(path)) add(\"MODEL\", …)`", neu: "`if (!/alternative_recommendations\\(real\\)/.test(path) || /未重建/.test(path)) add(\"MODEL\", …)`（訊息不變）；自我測試新增 NM1d（混合 path：alternative_recommendations(real)＋later:other(未重建…) → 觸發且全部 MODEL；對照＝NM0）", why: "S1：混合 path 經過模型未重建路徑時，修正前 altYes 0 失敗 → 不會產生 MODEL 失敗（L665 只轉換既有失敗），會被列 PASS", fix: "A2-MP-T42", kind: "加嚴" },
  { no: 38, old: "（無）", neu: "檔頭新增 A2-MP-T42 段落；DEL_RULES 新增 #34／#35／#37 刪除行歸類", why: "文件", fix: "A2-MP-T42", kind: "-" },
  // ── A2-MP-T46（相對 A2-MP-T42 版 r4；施工前副本 scratchpad/pre-T46-copies/scripts/verify-more-places-destination-switch-mp25-r4.mjs sha256 12a9ea38…；本輪無刪除行）──
  { no: 39, old: "（無）creditsFails 只檢查 begin／settle 數量、成功結算數＝(卡片?1:0)、reserve 數＝commit＋rollback 數、commit 數＝(卡片?1:0)（不看時序，reserve→rollback 次數無上限）", neu: "新增 creditsLedger（依 creditsRpc 時序記帳：reserve 開啟、commit／rollback 結算、孤立結算、輪末未結算）與 noMoreCreditsFails：無有效新卡片 → 未結算 reserve≠0、孤立結算、commit>0、reserve>1、（有 reserve 或 rollback 時）rollback≠1 → SAFETY；有有效卡片 → rollback>0、reserve≠1 或 commit≠1、未結算 reserve≠0 → SAFETY。noMoreOffer 輪末尾新增一行呼叫（標籤 NM、20）", why: "使用者裁決 (三)：noMore 允許 reserve→rollback，條件＝沒有有效新卡片、沒有 commit、rollback 恰好一次、未結算 reserve 為 0；不得把 reserve 本身視為已完成的扣點", fix: "A2-MP-T46", kind: "加嚴（新斷言；creditsFails 不變；分類 SAFETY＝原碼 Credits 類別）" },
  { no: 40, old: "（無）altYes 的 Credits 只有 creditsFails（全輪）與 L549 begin≠1／metadata≠京都 → FEATURE", neu: "altYes 輪末尾新增一行呼叫 noMoreCreditsFails（有卡片 → reserve 1→commit 1、rollback 0、未結算 0；無卡片 → 同 noMore 規則）→ SAFETY [NM, 20]；L549 FEATURE 不變", why: "使用者裁決 (三)「有有效卡片時：依既有 Credits 契約 commit」；既有 creditsFails 對「有卡片＋reserve→rollback→reserve→commit（begin 1）」4 條全過（自我測試 NM9g 以 creditsFails(gapAlt).length===0 證明修正前漏抓）", fix: "A2-MP-T46", kind: "加嚴" },
  { no: 41, old: "（無）", neu: "noMoreAltCases 新增 NM9（合法 reserve→rollback 一次 → 整個情境 0 失敗）、NM9a（rollback 0／殘留未結算）、NM9b（rollback 2）、NM9c（無卡片 commit）、NM9d（第二筆 reserve 未結算）、NM9e（無 reserve 卻 rollback）、NM9f（有卡片卻 rollback）、NM9g（有卡片 reserve→rollback→reserve→commit；既有 creditsFails 漏抓）、NM9h（有卡片只有 reserve）、NM9i 對照（reserve→commit 一次 → 0 失敗）；觸發案另以 check 要求 cat＝SAFETY", why: "任務單 #46 (三) 自我測試清單", fix: "A2-MP-T46", kind: "加嚴（新負向探針＋對照）" },
  { no: 42, old: "（無）", neu: "檔頭新增 A2-MP-T46 段落；CHANGES #39～#42。本輪沒有刪除行 → DEL_RULES 不需新增", why: "文件", fix: "A2-MP-T46", kind: "-" },
  // ── A2-MP-T52（相對 A2-MP-T46 版 r4；施工前副本 scratchpad/pre-T52-copies/scripts/verify-more-places-destination-switch-mp25-r4.mjs sha256 53086531…；本輪無刪除行）──
  { no: 43, old: "（無）creditsFails 只比較數量（begin＝settle、reserve＝commit＋rollback、commit＝(卡片?1:0)），不看時序；creditsLedger／noMoreCreditsFails 只用於 noMoreOffer／altYes", neu: "新增 creditsOrderFails（依 creditsRpc 名稱時序；契約 runtime.ts L175→L196、L207-227、L247-248、operations.ts L47-62）：R2 結算早於 reserve、R3 同一筆 reservation 結算 2 次、R4 重複 commit、R5 重複 rollback、R6 沒有 reservation 的結算、R7 reserve 前沒有尚未使用的 credits_check（未經授權的重複 reserve）→ SAFETY [20]；judgeTurn 在既有 creditsFails 呼叫下一行新增一行呼叫（所有輪；REF 輪照既有 L497 只回傳 INFRA，不改）。R1 ledger_id 一致＝UNVERIFIED（r14 L806 creditsRpc 只輸出 name，args 不在每輪記錄；不改 Harness）。合法分支（inactive 無 RPC、check 失敗、reserve 失敗／skipped／committed 冪等的 check→reserve 無結算、呼叫端重新 begin、並行 begin 交錯）不觸發；輪末未結算 reserve 不在此判定（數量面仍由 creditsFails）", why: "任務單 #52：既有 creditsFails 漏抓 reserve→rollback→reserve→commit（NM9g）等時序違規；使用者授權於 T50 全量回歸後加嚴", fix: "A2-MP-T52", kind: "加嚴（新斷言；creditsFails／noMoreCreditsFails 不變；分類 SAFETY＝原碼 Credits 類別、標籤 20）" },
  { no: 44, old: "（無）", neu: "noMoreAltCases 末端新增 CO-L1～CO-L5（合法對照：check→reserve→commit、noMore check→reserve→rollback 一次、inactive／blocked／skipped／冪等、重新 begin 重試、並行 begin；能構成完整合法輪者要求整個情境 0 失敗）與 CO-R2～CO-R7c（每條規則至少一案觸發，check 要求新規則命中皆 SAFETY＋標籤 20，並排除不該同時命中的規則）；CO-R2／CO-R7 另以 creditsFails(...)＝0（CO-R7 另要求其他既有斷言 0 失敗）證明修正前漏抓", why: "任務單 #52 第三步", fix: "A2-MP-T52", kind: "加嚴（新負向探針＋對照）" },
  { no: 45, old: "（無）", neu: "檔頭新增 A2-MP-T52 段落；CHANGES #43～#45。本輪沒有刪除行 → DEL_RULES 不需新增", why: "文件", fix: "A2-MP-T52", kind: "-" },
  // ── A2-MP-T56（相對 A2-MP-T52 版 r4；施工前副本 scratchpad/pre-T56-copies/scripts/verify-more-places-destination-switch-mp25-r4.mjs sha256 8b921dcd…）──
  { no: 46, old: "R7 只檢查「reserve 前有尚未使用的 credits_check」（check 配對；C,C,R,R,RB,CM 與 C,R,RB,C,R,CM 於 begin 1 時每次 reserve 前都有 check → 不命中；creditsFails 數量面也全過）", neu: "R7 另加：同一輪 credits_reserve 次數 > 本輪 begin 次數（t.r15Credits.length；r15 L844 creditsBegin.slice(c0)、r14 L477 每次 begin 推 1 筆）→ SAFETY [20]，訊息「Credits 時序：本輪 credits_reserve=N 多於 begin=M（未經授權的重複 reserve…）」。既有 check 配對規則原樣保留", why: "T55 審查［中］：check 配對可被多送 check 繞過", fix: "A2-MP-T56", kind: "加嚴（新條件；既有規則不刪、分類不變）" },
  { no: 47, old: "R3 訊息：結算時沒有開啟中的 reservation 且之前已有已結算的 reservation → 一律寫「同一筆 reservation 結算 2 次」（重複 commit／rollback 同）", neu: "觸發條件不變（仍 SAFETY [20]）；若之後仍有 credits_reserve（例 C,R,CM,C,CM,R）→ 訊息並列兩種可能「同一筆 reservation 結算 2 次，或結算早於後續 credits_reserve（名稱時序無法區分）」，重複 commit／rollback 訊息加註「或結算早於後續 credits_reserve」；之後沒有 reserve 時訊息與原本逐字相同", why: "T55 審查［低］：R2／R3 歸類不精確", fix: "A2-MP-T56", kind: "更正說明文字（觸發數不變）" },
  { no: 48, old: "R1 ledger_id 一致＝UNVERIFIED（只寫在檔頭／CHANGES #43，輸出沒有對應行；理由寫成「args 不在每輪記錄」）", neu: "新增常數 CREDITS_R1_UNVERIFIED，輸出於 --self-test（selfTestLines 末行）與 report（「Credits 未驗證範圍」節）：r14 L441 有記錄 args（含 p_ledger_id；runtime.ts L93／L113），L443 Mock 發出不重複 ledger_id，但每輪只輸出 name；要驗證需改 Harness（不在授權範圍）。名稱層級盲點 C,R,C,R,RB,RB（begin 2、settle [false,false]、無卡片）現行所有斷言判 PASS", why: "T55 審查：UNVERIFIED 說明不完整", fix: "A2-MP-T56", kind: "說明（不改判定）" },
  { no: 49, old: "（無）；fnZero 以 synTurn 預設 r15Credits=[]（begin 0）建合法對照", neu: "自我測試新增 CO-R7d（C,C,R,R,RB,CM）、CO-R7e（C,R,RB,C,R,CM）：begin 1、settle [true]、1 張卡片，check 要求 creditsFails＝0、新規則恰 1 筆且 SAFETY＋20、其他既有斷言 0 失敗；CO-L4b 對照（CO-L4／CO-L5 begin 2 仍 0 失敗）；CO-R3b（C,R,CM,C,CM,R 並列兩種可能、仍觸發）；CO-U1 盲點記錄（現行 0 命中＝UNVERIFIED，非 PASS 證據）。fnZero 的 begin 數改為 credits_check 數（runtime.ts：每次 begin 至多一次 check；L149-173 flag off／Plus 不 check，走到 L175 者恰一次；原 begin 0 不是有 RPC 合法輪的形狀；任務單 #61 更正說明）", why: "任務單 #56 一-2／一-3／一-4／一-5", fix: "A2-MP-T56", kind: "加嚴（新負向探針＋對照；fnZero 為對照輸入更正）" },
  { no: 50, old: "（無）", neu: "檔頭新增 A2-MP-T56 段落；CHANGES #46～#50。相對 r3 的 emit-diff 沒有新增刪除行（修改行皆為 T52 新增行）→ DEL_RULES 不需新增", why: "文件", fix: "A2-MP-T56", kind: "-" },
  // ── 任務單 #60／#61／#64（補列；T63 審查第 4 項）──
  { no: 51, old: "（無）", neu: "GP 探針：新增 GP_FUKUOKA Fixture（r15Real 精確鍵，只在探針子程序有效）、GP_SCENARIOS（GP-01～GP-03、GP-C1／GP-C2）、GP_BROKEN_ALL、gpProbeLines（report() 末尾在結果含 GP 情境時另輸出「GP 探針」一節：逐輪 A～F 原始值、殘破 query 標「P1 候選（GP）」）；scenarios＝[...NEW_SCENARIOS, ...GP_SCENARIOS]。GP 情境不在 NEW_SCENARIOS → 既有 49 情境判定／項目列／SAFETY／P1 計數／D9c／預設執行 ids 不受影響；只在 --only 明列 GP id 時執行", why: "任務單 #60（A2-AUDIT-9）：Geocoding 殘破地名原始值觀察", fix: "任務單 #60", kind: "只新增輸出（不影響既有判定與結束碼）" },
  { no: 52, old: "（無）", neu: "GP_SCENARIOS 追加 GP-04～GP-07、GP-C3／GP-C4（入口補驗：more_places／destination_places；gpEntry、gpClass＝REALISTIC_FLOW／INJECTED_STATE／CONTROL；殘破 Session 只用既有 r15Init／r18Init）；gpProbeLines 標頭加印 r18Init，有 gpEntry 的情境另印「入口[分類] 目標／到達／標記」與 r15Flows 原始值兩行（GP-01～GP-C2 輸出格式不變）", why: "任務單 #61（A2-AUDIT-10）入口補驗", fix: "任務單 #61", kind: "只新增輸出（不併入既有計數）" },
  { no: 53, old: "L416 creditsOrderFails 規則 7 訊息「runtime.ts L175→L196 每次 begin 恰 check→reserve 一次」；fnZero 上方註解「runtime.ts L175：每次 begin 恰一次 check」；CO-L4b 名稱「函式層 begin＝reserve 的 [C,R,CM]／[C,R,RB]」", neu: "訊息改「每次 begin 至多 check 一次、通過後至多 reserve 一次；L149-173 flag off／Plus 不 check」；註解改為「至多一次」並列出 runtime.ts L139-147／L149-160／L162-173 提早 return；CO-L4b 名稱改為「begin 數以 credits_check 數計：有 RPC 的 begin 恰 1 次 check、至多 1 次 reserve；L149-173 flag off／Plus 的 begin 不 check」。regex、fnZero、check 函式與觸發條件逐字不變（沒有 regex 依賴被改字句）", why: "T57 第 1 項：措辭不精確（runtime.ts:149-173 flag off／Plus 的 begin 不 check）", fix: "任務單 #61", kind: "更正說明文字（判定不變）" },
  { no: 54, old: "CHANGES #49 neu 末句（T56 原文）：「fnZero 的 begin 數改為 credits_check 數（runtime.ts L175 每次 begin 恰一次 check；原 begin 0 不是合法輪形狀）」", neu: "T61 原地改寫為「（runtime.ts：每次 begin 至多一次 check；L149-173 flag off／Plus 不 check，走到 L175 者恰一次；原 begin 0 不是有 RPC 合法輪的形狀；任務單 #61 更正說明）」。本列記錄該原地改寫（#49 其餘文字、fix／kind 不變）", why: "T63 審查第 4 項：歷史 CHANGES 列原地改寫須另列說明", fix: "任務單 #64", kind: "文件（原地改寫揭露）" },
  { no: 55, old: "GP-07 輸出行「入口[REALISTIC_FLOW]」未標前提；GP-02／GP-03（及其他 GP 情境）的 F 行未標示 Session 污染來源；CHANGES 缺 T60／T61 列", neu: "GP-07 加 gpPremise（前提 UNVERIFIED：T1 走 r13 模型未重建路徑），入口行改為「入口[REALISTIC_FLOW；前提 UNVERIFIED…]」；gpProbeLines F 行：有殘破欄位且本輪 path 含「未重建」→ 加註「Session 污染來自 MODEL 路徑」，延續自這種輪 → 加註「延續自前輪 MODEL 路徑」（prevModelBroken 只供輸出）；補 CHANGES #51～#55。判定、計數、結束碼不變", why: "T63 審查第 3、4 項", fix: "任務單 #64", kind: "只改輸出文字／文件" },
];
/** emit-diff：刪除行（KEYS 命中）去處歸類（依刪除行內容；未歸類 → 需人工核對）。 */
const DEL_RULES = [
  [/^-\s*\{ no: [\w"]+, old: /, "r3 的 CHANGES 說明列（r3 相對 r2 的文件，非斷言）；由 r4 CHANGES 取代"],
  [/MP25R3-/,"#14 情境 ID 前綴 MP25R3- → MP25R4-（內容不變，見同 hunk 新增行）"],
  [/const K = \(v\)|PLACE_KEYS\.find|k === "金沢"/, "#1 K() → Ks()／K()（canonical、多候選）"],
  [/const geoAll =/, "#1 geoAll 多候選"],
  [/const OC = ctx\.otherCity|geoAll\(t, OC\)|shown\.includes\(OC\)|v === OC|K\(pend\.rawGeographicLabel\) === OC/, "#2 otherCity 多候選（同條件，改用 Ks／colsAll）"],
  [/const ref = K\(pend\.rawGeographicLabel\)|o !== ref|countOf\(refT|COORD_RE\.test\(refT\)|SCOPE_RE\.test\(refT\)|typeof ref === "string"|const refT/, "#6 原句參照改為 identity 建立輪原句（未知 → fail-closed）；條件式保留於新增行"],
  [/n < ctx\.attemptsMax|n < ctx\.confirmVal/, "#4／#9 attempts 依 identity（訊息加註 identity；條件式同）"],
  [/asks|askTexts|確認提問/, "#5 詢問次數改依確認行為（evalScenario 內）"],
  [/attemptsMax|confirmVal|kzGeoUntilConfirm|creationText|createdAt|confirmedAt/, "#4／#6 情境合計 → identity 分開（evalScenario 內）"],
  [/kzGeoTotal|allowedKz/, "#13 搬入 evalScenario（條件式不變）"],
  [/SF\.na\.push|f\.push\(\{ cat: "INFRA"|requireFbContinue|restoredAt|turnSpec/, "#13 搬入 evalScenario（條件式不變）"],
  [/push\(\{ cat: "INFRA"|push\(\{ cat: "SAFETY", msg: `\$\{s\.id\}：同城續推|results\[`mp1\|ok/, "#13 搬入 evalScenario／report（條件式不變）"],
  [/tagged\[2\]|YES_KINDS\.includes\(kind\)|const k = \[\.\.\.tc/, "#13 搬入 evalScenario（tagged 改為情境內；report 依樹彙整）"],
  [/for \(const x of f\) push|out\.push\(`  \$\{tree\.padEnd\(5\)\} T\$\{i \+ 1\}|if \(f\.length\) out\.push|const f = judgeTurn|out\.push\(`  \$\{tree\.padEnd\(5\)\} 彙總/, "#13 輸出改由 evalScenario 回傳 lines（內容同，另加 identity 彙總）"],
  [/const push = \(x\)|SF\.fails\.push\(x\)|for \(const tg of x\.tags/, "#13 push 搬入 evalScenario"],
  [/if \(lim\(LIM\)\) push|if \(r\.err \|\| r\.result\?\.error\)|if \(r\.fetchCalls\) push/, "#13 report 前置檢查（條件不變；另加 canonical 缺 → INFRA）"],
  [/MP25R3_SUMMARY|MP-25 r3（work）|MP-25 r3：必修/, "#14 版本識別（r3 → r4）"],
  [/r20-subset-mp25r3|拒絕覆蓋既有 log|mp25-r2-T6\|mp25-T4/, "#12 輸出保護"],
  [/KEYS = \[/, "emit-diff KEYS 擴充（T8 修正 c）"],
  [/R20, "--brief"|const R20 =|--with-r20-subset/, "#14 改由 r21 掛載"],
  // A2-MP-T18（相對 T9 版 r4 的修改行；相對 r3 的 emit-diff 若出現同樣內容也依此歸類）
  [/^-const NON_CONFIRM = /, "#21 NON_CONFIRM ＋newTrip／sameCityArea（原 8 種保留於新增行）"],
  [/if \(vBefore < LIMITS\.validatePerPending\) \{|驗證已達上限 \$\{LIMITS\.validatePerPending\} 後再次推進確認流程|else S\.heldAfterCap \+= 1;/, "#16／#17 M1：確認請求條件另加詢問／attempts 上限；訊息列出達到的上限（條件式 rewritten || advanced 不變）"],
  [/D1 詢問上限：上限前第 4 次確認請求|D1 依行為非文案：第 4 次請求回覆不含問號|D1 對照：上限前 3 次確認請求|D1b 達上限後再次推進/, "#18 D1 依裁決 M1 改判／改寫（見新增行）"],
  [/達上限 2 後再次推進\//, "#17 D5 regex 同步新訊息格式（另要求 M1）"],
  // A2-MP-T42（相對 A2-MP-T40 版 r4 的刪除行）
  [/^-\s*R\.ran \+= 1;$|^-\s*for \(const x of SF\.fails\) \(x\.cat === "MODEL" \? R\.model : R\.fails\)\.push\(x\);$|^-\s*R\.na\.push\(\.\.\.SF\.na\);$/, "#34 M2：搬入 addScenToRow（原樣），另計入 SF.model"],
  [/^-\s*v = r\.fails\.length \? "FAIL" : r\.model\.length \? "UNVERIFIED" : "PASS";$/, "#35 M2：同式子抽成 rowVerdict"],
  [/^-.*if \(!\/alternative_recommendations\\\(real\\\)\/\.test\(path\)\) add\("MODEL"/, "#37 S1：altYes MODEL 加 || /未重建/ 守衛"],
];
const delFate = (l) => DEL_RULES.find(([re]) => re.test(l))?.[1] ?? "未歸類（需人工核對）";

// ── 輸出保護（同 r21；T8 修正 8）──
const PROTECTED = ["mp25.log", "mp25-T4.log", "mp25-r2-T6.log", "mp25-r3.log", "mp25-r3-T8.log", "r19-subset.log", "r19-subset-T6.log", "r20-parity-r19subset.log", "r20-parity-r19subset-T8.log", "mp-cross-r4.log", "mp-cross-r4-T4.log", "mp-cross-r4-T6.log", "mp-cross-r4-T6-full.log", "mp-cross-r4-r20.log", "mp-cross-r4-r20-T8.log"];
function refuseOut(path, existingAtStart) {
  if (typeof path !== "string" || !path.startsWith(`${PRE_DIR}/`) || path.slice(PRE_DIR.length + 1).includes("/")) return `輸出只能寫在 scratchpad 根目錄（${path}）`;
  const base = path.slice(PRE_DIR.length + 1);
  if (PROTECTED.includes(base)) return `拒絕覆蓋既有 log（明列保護）：${path}`;
  if (existingAtStart.includes(base)) return `拒絕覆蓋既有 log（啟動時已存在）：${path}`;
  if (existsSync(path)) return `拒絕覆蓋既有檔案：${path}`;
  return null;
}

/** --self-test 單獨執行：以 vite-node 載入正式 destination-alias-resolver.ts（同 r21 r21LoadAlias／r21Mentions 邏輯）。 */
async function standaloneCanon() {
  const rel = "src/lib/ai/destination-alias-resolver.ts";
  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
  const realFetch = globalThis.fetch;
  let ext = 0;
  globalThis.fetch = async () => {
    ext += 1;
    throw new Error("[mp25-r4] 禁止外部請求");
  };
  const server = await createServer({ root: WORK_ROOT, configFile: false, envDir: false, logLevel: "silent", clearScreen: false, plugins: [tsconfigPaths()], server: { middlewareMode: true, hmr: false, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  let mod;
  try {
    await server.environments.client.pluginContainer.buildStart({});
    const vn = new ViteNodeServer(server);
    const runner = new ViteNodeRunner({ root: server.config.root, base: server.config.base, fetchModule: (id) => vn.fetchModule(id), resolveId: (id, importer) => vn.resolveId(id, importer) });
    await runner.executeId("/@vite/env");
    mod = await runner.executeFile(`${WORK_ROOT}/${rel}`);
  } finally {
    await server.close();
    globalThis.fetch = realFetch;
  }
  if (ext) throw new Error(`載入期間外部請求 ${ext} 次`);
  const src = readFileSync(`${WORK_ROOT}/${rel}`, "utf8");
  const i = src.indexOf("const DESTINATION_ALIAS_RECORDS");
  const body = src.slice(i, src.indexOf("\n];", i));
  const vocab = new Set();
  for (const m of body.matchAll(/canonicalName:\s*"([^"]+)"/g)) vocab.add(m[1]);
  for (const m of body.matchAll(/aliases:\s*\[([^\]]*)\]/g)) for (const s of m[1].matchAll(/"([^"]+)"/g)) vocab.add(s[1]);
  const cache = new Map();
  const ck = (x) => {
    const s = String(x ?? "").trim();
    if (!s) return "";
    if (!cache.has(s)) cache.set(s, String(mod.resolveDestinationAlias(s)?.normalizedName ?? "").trim());
    return cache.get(s);
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentions = (text) => {
    const t = String(text ?? "");
    const out = new Set();
    for (const a of vocab) {
      if (!a || a.length < 2) continue;
      if (/^[\x20-\x7e]+$/.test(a)) {
        if (a.length < 4 || !new RegExp(`(^|[^A-Za-z])${esc(a)}([^A-Za-z]|$)`, "i").test(t)) continue;
      } else if (!t.includes(a)) continue;
      const k = ck(a);
      if (k) out.add(k);
    }
    return out;
  };
  return { src: `${rel} resolveDestinationAlias(x).normalizedName（--self-test 單獨載入）`, canonKey: ck, mentions };
}
function standaloneLimits() {
  const svc = readFileSync(`${WORK_ROOT}/src/lib/ai/service.server.ts`, "utf8");
  const a = [...svc.matchAll(/\bchatInput: z\.string\(\)\.max\((\d+)\)/g)];
  const loc = readFileSync(`${WORK_ROOT}/src/lib/location.functions.ts`, "utf8");
  const b = [...loc.matchAll(/query: z\.string\(\)\.min\(1\)\.max\((\d+)\)/g)];
  if (a.length !== 1 || b.length < 1) return null;
  return { userText: Number(a[0][1]), label: Number(b[0][1]), src: { userText: "src/lib/ai/service.server.ts chatInput", label: "src/lib/location.functions.ts GeocodeTextInput.query" } };
}

// ── 直接執行：以 r21 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const existingAtStart = readdirSync(PRE_DIR).filter((f) => /\.(log|stdout)$/.test(f));
  if (process.argv.includes("--emit-diff")) {
    const target = `${PRE_DIR}/mp25-r4.diff`;
    let d = "";
    try {
      d = execFileSync("diff", ["-u", "--label", "scripts/verify-more-places-destination-switch-mp25-r3.mjs", "--label", "scripts/verify-more-places-destination-switch-mp25-r4.mjs", OLD, SELF], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    } catch (e) {
      d = String(e.stdout ?? "");
    }
    const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail(", "viol(", "throw new Error", "why.push(", "A(", "f.push(", "fails.push(", "add("];
    const del = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const by = {};
    for (const l of hit) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
    const unc = hit.filter((l) => delFate(l).startsWith("未歸類"));
    const head = [
      "# mp25-r4.diff（相對 scripts/verify-more-places-destination-switch-mp25-r3.mjs；A2-MP-T9）",
      `# 刪除行=${del.length}；刪除行含 ${KEYS.join("／")}＝${hit.length} ${JSON.stringify(by)}；未歸類=${unc.length}`,
      ...hit.map((l) => `#   [刪除行命中 ${KEYS.filter((k) => l.includes(k)).join(",")}] ${l.slice(0, 200)} → 去處：${delFate(l)}`),
      "# CHANGES：",
      ...CHANGES.map((c) => `#   ${c.no}. 舊：${c.old}｜新：${c.neu}｜理由：${c.why}｜修正項：${c.fix}｜${c.kind}`),
      "",
    ];
    if (existsSync(target) && !readFileSync(target, "utf8").startsWith("# mp25-r4.diff")) {
      console.log(`拒絕覆蓋非本檔產生的檔案：${target}`);
      process.exit(1);
    }
    writeFileSync(target, `${head.join("\n")}\n${d}`);
    console.log(`wrote ${target}`);
    console.log(head.filter((l) => !l.startsWith("#   ") || /未歸類/.test(l)).join("\n"));
    process.exit(unc.length ? 1 : 0);
  }
  if (process.argv.includes("--self-test")) {
    const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? `${PRE_DIR}/mp25-r4-selftest.log`;
    const why = refuseOut(out, existingAtStart);
    if (why) {
      console.log(why);
      process.exit(1);
    }
    try {
      globalThis.__R21_CANON_INFO = await standaloneCanon();
    } catch (e) {
      console.log(`INFRA-FAIL 無法載入既有 canonical identity：${e?.message ?? e}（UNVERIFIED）`);
      process.exit(1);
    }
    globalThis.__R20_LIMITS = standaloneLimits();
    if (!globalThis.__R20_LIMITS) {
      console.log("INFRA-FAIL 找不到既有長度上限");
      process.exit(1);
    }
    const st = runSelfTest();
    const lines = [`mp25-r4 --self-test（A2-MP-T9）canonical：${globalThis.__R21_CANON_INFO.src}；長度上限 原句 ≤${st.lim.userText}（★ 相對原版 r19 500 放寬）地名 ≤${st.lim.label}`, ...selfTestLines(st), `mp25-r4 --self-test：${st.pass === st.n ? "PASS" : "FAIL"} ${st.pass}/${st.n}`];
    console.log(lines.join("\n"));
    writeFileSync(out, `${lines.join("\n")}\n`);
    console.log(`wrote ${out}`);
    process.exit(st.pass === st.n ? 0 : 1);
  }
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const sub = process.argv.includes("--with-r21-subset");
  const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? `${PRE_DIR}/${sub ? "r21-subset-mp25r4" : "mp25-r4"}.log`;
  const why = refuseOut(out, existingAtStart);
  if (why) {
    console.log(why);
    process.exit(1);
  }
  const ids = [...NEW_SCENARIOS.map((s) => s.id) /* 任務單 #60：原 scenarios＝NEW_SCENARIOS；GP 探針不進預設執行 */, ...(sub ? ["R10-a2-kyoto-kanazawa-more", "R15-PROBE"] : [])];
  const args = [R21, "--brief", ...(sub ? ["--pa2"] : []), "--a2", "--mp1", `--only=${ids.join(",")}`, `--extra-scenarios=${SELF}`, `--out=${out}`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
