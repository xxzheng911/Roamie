#!/usr/bin/env node
/**
 * 任務單 #39（tester）— S1～S4「否定舊目的地＋切換」Session 污染的函式層失敗測試。
 *
 * 執行方式（由使用者以已審查 Runner 執行；tester 不執行）：
 *   vite-node --config scratchpad/planner-reset-vite.config.mjs scripts/verify-negated-switch-s1s4.mjs
 * 只 import 正式 src 模組（同 diag-e2h-work.mjs 的絕對路徑載入），不 import 網路／Provider／Supabase／Credits 模組，
 * 不讀 .env／process.env。fetch 一律攔截並計數（任何外部請求 → FAIL）。
 *
 * Fixture 與解析順序：逐字沿用 scratchpad/probes/diag-e2h-work.mjs 第 11–31 行
 *   mk(city,country) 京都／日本；順序 parseDestinationFromText → applyTripIntentToSession → mergeTravelContext
 *   → mergeTripPlanningContext → extractPlanningHintsFromText → extractDiscoveryFromText → extractChatPlanningContextFromText。
 *
 * ── 契約（使用者逐條）→ 斷言對應 ──
 *   C0 使用原本六句相同 Fixture（S1～S6，京都／日本）。
 *   C1 否定舊目的地大阪            → #1 neg     ：parseNegatedDestinationSwitch(t)?.negatedText === "大阪"
 *   C2 切換候選金澤                → #2 switch  ：parseNegatedDestinationSwitch(t)?.switchedText === "金澤"
 *   C3 未確認金澤時不得將大阪寫成可信目的地；且不得將金澤直接標記 trusted
 *        → #3 location.city、#4 travelContext.currentLocation、#5 tripPlanningContext.destination、
 *          #6 preferredArea、#7 travelContext.destination、#8 tripDestination.city 全部 === "京都"
 *          （本輪未經 Provider 確認：既不得變成大阪／殘破字串，也不得被直接改寫成金澤；與 S5／S6 現行行為一致）
 *   C4 未確認金澤時不得清除京都可信推薦池
 *        → #9 recommendationSession.destination === "京都"（不得為 null／大阪／金澤）
 *          ※ A2-MP-T42：#9 只是推薦池的「代理」欄位（destination 字串）；推薦池實際內容（地點清單、已顯示數、batch、
 *            activeRecommendationContext）不在此函式鏈 → UNVERIFIED（輸出另列一行）。
 *        → #10 planningSessionId === "plan-京都"（不得重建 Planning Session）
 *   C5 保護正常句型及合法地名（含「去」「換」「改」的名稱）→ 保護組 PG-*（見下方各案註解）。
 *
 * 現行預期：S1～S4 FAIL（#1／#2 解析為 null，#3～#10 被寫成大阪／「大阪了…」／null／新 sid）；S5～S6 PASS；保護組 PASS（讀碼推論）。
 * 任何斷言 FAIL → exit 1（S1～S4 被抓出時亦然；這是預期中的失敗測試）。
 *
 * UNVERIFIED（函式層無可觀察狀態）：「金澤被標記 trusted」— Session 無 trusted 旗標；Provider 驗證
 * （validationStatus／destination_switch Pending／placeId）發生在 send() 之後的 chat-turn-destination，不在此鏈。
 * 本測試只以 #3～#8 不得寫入金澤作為函式層代理，真正 trusted 狀態需 Harness 驗證。
 * 合法地名（含去／換／改）：repo 內 src／scripts 找不到真實存在的此類地名 → 本檔不收錄，交接報告說明。
 *
 * 修改紀錄（CHANGES；施工前副本 scratchpad/pre-T42-copies/scripts/verify-negated-switch-s1s4.mjs sha256 eae8a639…）
 *   fix:"A2-MP-T42" #1（M1；加嚴）刪除行 L36 `const realFetch = globalThis.fetch;` → 改名 priorFetch＋記錄 guardActive（__OFFLINE_GUARD__）。
 *   fix:"A2-MP-T42" #2（M1；加嚴）刪除行 L38 `globalThis.fetch = async () => { externalCalls += 1; throw …禁止外部請求 }` →
 *        計數後：offline-guard 存在 → 轉呼叫覆寫前的 fetch（guard 寫 network-attempts.log 並丟錯）；不存在 → 直接丟錯，絕不轉呼叫真實 fetch。
 *        理由：原寫法取代了 guard 的 fetch，Runner 的 network-attempts>0 → FAIL 對 fetch 失效（獨立審查 T41 M1）。external fetch 計數與 FAIL 條件不變。
 *   fix:"A2-MP-T42" #3（M1；中性）刪除行 L180 `globalThis.fetch = realFetch;` → `globalThis.fetch = priorFetch;`（同一值，改名）。輸出另列 offline-guard present／absent。
 *   fix:"A2-MP-T42" #4（建議；加嚴）刪除行 L78 BROKEN_RE `/[了，,、。！？!?\s]|再$|^(?:換|换|改|去|不)|推薦|推荐/` →
 *        ＋`玩$`、`^成`（抓「金澤玩」「成金澤」切換殘留）；新增 BROKEN_SELF 自我檢查（殘破 7／乾淨 5，不符 → FAIL）。S1～S6 十項斷言未改。
 *   fix:"A2-MP-T42" #5（建議；中性／揭露）檔頭 C4 與輸出註明 #9 recommendationSession.destination 只是推薦池代理（推薦池實際內容 UNVERIFIED）。
 *   （施工前副本 scratchpad/pre-T46-copies/scripts/verify-negated-switch-s1s4.mjs sha256 0b5aa478…）
 *   fix:"A2-MP-T46" #6（使用者裁決 (一)；中性／揭露）刪除行 L196 `const failed = evalCase(p.id, p.t, p.checks, { expectNow: "PASS(推論)" });` →
 *        同一呼叫，extra 另展開 KNOWN_BASELINE[p.id]（只對 PG-switch-qu-wan 多一個輸出欄位 known／knownDetail）。checks、failed、protectPass、
 *        anyFail 的計算逐字不變；PROTECT 陣列（10 句與其斷言）逐字未改；`protect pass=` 分母仍為 PROTECT.length（10）。
 *   fix:"A2-MP-T46" #7（使用者裁決 (一)；中性／揭露，新增行）KNOWN_BASELINE 常數、knownSeen 紀錄、摘要 `known-baseline:` 行
 *        （「去金澤玩」preferredArea=金澤玩、travelContext.destination=金澤玩＝BASELINE-KNOWN／P2／UNRESOLVED；仍計入 protect FAIL，不從分母剔除，
 *        RESULT 仍 FAIL）。
 *   fix:"A2-MP-T46" #8（使用者裁決 (二)；加嚴，新增行）合法地名保護獨立群組 PLACE_PROTECT（place-protect pass=n/m；不併入 protect、不改其分母）：
 *        名稱只取 repo 內既有 Fixture／地理資料（每案附出處 檔:行）；期望＝不判為否定切換、Session 欄位與 parseDestinationFromText 只能是
 *        null／京都／該案合法完整名稱（城市層欄位另可為出處所列上層城市）→ 抓殘破字串與切斷地名；任一 FAIL → anyFail。
 *        另加 PP_SELF Fixture 自我檢查（合法名稱不得被 BROKEN_RE 判為殘破、名稱須出現在句中；不符 → FAIL）。
 *   fix:"A2-MP-T46" #9（使用者裁決 (二)；揭露，新增行）名稱含「改」「換」「去」三類各輸出一行 UNVERIFIED（repo 內無可靠出處，未收錄、不編造）。
 *   ※ 本輪刪除行只有 #6 的 L196 一行；S1～S6 十項斷言、tenChecks／keepKyotoNoNeg／noPollution、BROKEN_RE、PROTECT 均未改。
 *
 * ── A2-MP-T53（使用者裁決；只加嚴；施工前副本 scratchpad/pre-T52-copies/scripts/verify-negated-switch-s1s4.mjs sha256 1b94b01d…）──
 *   背景：T48 審查 placeChecks（T46 版）太鬆（全部 null／京都也 PASS）且 parentOk 只認 loc／td。
 *   fix:"A2-MP-T53" #10（裁決 2；加嚴，新增行）placeChecksT53(p)：先「逐字」呼叫 T46 placeChecks(allowed,parentOk)（原檢查鍵與判定不變），
 *        再加「T53.recognized」：tripPlanningContext／preferredArea／travelContext.destination／tripDestination／recommendationSession／
 *        travelContext.destinationCity 至少一欄，或 parseDestinationFromText，必須等於該案合法名稱或上層城市（不含京都；
 *        location.city／currentLocation 不計入辨識）。全部 null／京都 → FAIL。六案全部套用。
 *   fix:"A2-MP-T53" #11（裁決 1；加嚴，新增行）行政區案（p.area）加「T53.district」：preferredArea／travelContext.destination／
 *        tripPlanningContext／travelContext.destinationRegion 至少一欄必須「等於」含該行政區的合法名稱（台南中西區／中西區；東京新宿／新宿／新宿區）。
 *        上層城市不得滿足此條（不得以父城市掩蓋行政區遺失）。
 *        travelContext.destination＝上層城市：src 沒有適用於 curated 行政區的放行契約 → 不放行（仍只認合法完整名稱）。
 *          （A2-MP-T56 #18 更正：原寫「在 src 找不到 Authority 契約」不精確——src/lib/ai/chat-turn-destination.ts:1222-1230
 *          resolveConfirmedParentScopeTurnDestination 是父城市相關契約，但只適用於未驗證的「父城市＋尾端」待確認流程
 *          〔planCategoryTurnClarification parent_city_scope，:1210-1220〕，不適用於 curated 行政區，所以結論仍是不放行。）其餘查到的契約皆相反：
 *          src/lib/ai/destination-resolution.ts:215-226（curated 行政區 → destination＝displayLabel「台南中西區」，非父城市）、
 *          :245-255（父＋未驗證尾 → destination undefined）、:564-583（destination＝父城市只限 rejected＋activity_evidence_split，不是行政區）、
 *          src/lib/ai/planning-context-authority.ts:49-68（destination 直接讀 travelContext.destination，無父城市規則）。
 *        找到的父城市契約只針對 travelContext.destinationCity：src/lib/ai/destination-scope.ts:131-139（district → destinationCity＝parentCity、
 *          destinationRegion＝area）→ 只在新增的 destinationCity 欄位放行 parentOk。
 *        Search Scope：DestinationAreaScope.searchScope（src/lib/ai/destination-travel-profile.ts:57-62、:270-277）只存在於
 *          mergeTravelContext 內部 resolveDestinationAreaScope 的回傳（src/lib/ai/travel-context.ts:542、:970-978），未寫入 Session
 *          → 本檔現有分析結果拿不到 → UNVERIFIED（輸出另列一行），未另建 Parser／Harness。
 *          （A2-MP-T56 #19 補充：「未寫入 Session」只指 travelContext；Session 的 recommendationSession 另有 searchScope／area／parentCity，見 T56 段。）
 *   fix:"A2-MP-T53" #12（裁決 1；中性，刪除／改寫行）run() 刪除行 `return {` … `};`（原 L99-104 回傳物件）→ 同一物件存成 base；
 *        只有第 4 參數 ext=true（僅 place-protect 傳入）時另回 travelContext.destinationCity／destinationRegion／destinationType
 *        （同一 Session，未呼叫任何新 Source 函式）。S1～S6、PROTECT、INFO 不傳 ext → actual 輸出與判定逐字不變。
 *        evalCase 刪除行 `actual = run(CITY, COUNTRY, t);` → `actual = run(CITY, COUNTRY, t, ext);`（第 5 參數 ext 預設 false）。
 *        新增 destinationCity（null／京都／合法名稱／上層城市 destination-scope.ts:137）與 destinationRegion（null／合法名稱）欄位檢查。
 *   fix:"A2-MP-T53" #13（裁決 3；加嚴）PP-new-trip-fukuoka-two-days 期望不變（福岡／福岡市），另加 forbidden「福岡玩兩天」明確檢查；
 *        不加入 KNOWN_BASELINE、不標 BASELINE-KNOWN（自我檢查：PLACE_PROTECT id 不得出現在 KNOWN_BASELINE）。
 *   fix:"A2-MP-T53" #14（裁決 4；未動）KNOWN_BASELINE、PROTECT、MAIN、tenChecks／keepKyotoNoNeg／noPollution、BROKEN_RE、BROKEN_SELF 逐字未改。
 *   fix:"A2-MP-T53" #15（自我檢查；加嚴，新增行）PP_T53_SELF_BAD：每案 recog 非空且不含京都；allowed／parentOk 不被 BROKEN_RE 判殘破（沿用 PP_SELF）；
 *        行政區案 area 在句中、至少一個 allowed 含 area、parentOk 不含 area；forbidden 不得在 allowed／parentOk；
 *        合成 actual 控制組（純資料、不呼叫 src）：理想值必須全 PASS；全京都／全 null 必須 recognized FAIL；行政區案 dest＝父城市＋其餘京都
 *        必須 district FAIL；理想值但 dest＝父城市必須 FAIL（固定「不放行」決定）；forbidden 寫入 preferredArea 必須 FAIL。任一不符 → FAIL。
 *   fix:"A2-MP-T53" #16（揭露）L272 刪除行 `placeChecks(p.allowed, p.parentOk ?? [])` → `placeChecksT53(p)`（含原檢查的超集合）；
 *        inferNow 依讀碼重新推論（全部「推論、待執行確認」；本輪 tester 不執行本檔）。
 *
 * ── A2-MP-T56（任務單 #56；T55 審查 REQUEST CHANGES；只加嚴或更正說明；施工前副本 scratchpad/pre-T56-copies/scripts/verify-negated-switch-s1s4.mjs sha256 9bdce0b9…）──
 *   fix:"A2-MP-T56" #17（指派者裁決；加嚴，新增行）T53.recognized 加嚴：非行政區四案（換成福岡、改去名古屋、我想去福岡玩兩天、我想去台南）
 *        另加「T53.recognized.session」：parseDest 以外，RECOG_KEYS（tripPlanningContext／preferredArea／travelContext.destination／
 *        tripDestination／recommendationSession／travelContext.destinationCity）至少一欄＝合法完整名稱（p.allowed，不含京都）。
 *        只有 parseDest、Session 全京都 → FAIL。原 T53.recognized 鍵與判定不變。行政區兩案不套用（T53.district 本來就要求 Session 欄位，不變）。
 *        自我檢查新增：每個非行政區案「只有 parseDest＝合法名稱、Session 全京都」控制組必須 FAIL；指派者指定控制組
 *        {neg:null, parseDest:"台南", 其他欄位全京都}（PP-new-trip-tainan）必須 FAIL 且由 T53.recognized.session 判出。
 *   fix:"A2-MP-T56" #18（更正說明）檔頭 #11、L255 註解、PP_T53_UNVERIFIED：補 src/lib/ai/chat-turn-destination.ts:1222-1230
 *        resolveConfirmedParentScopeTurnDestination（只適用未驗證「父城市＋尾端」待確認流程，不適用 curated 行政區 → 結論仍不放行）；
 *        「src 找不到」改為「src 沒有適用於 curated 行政區的放行契約」。DEST_PARENT_CONTRACT 仍為 null（判定不變）。
 *   fix:"A2-MP-T56" #19（加嚴＋揭露）run() ext=true（僅 place-protect）另讀同一 Session 的 recommendationSession.searchScope／area／parentCity
 *        （src/lib/ai/conversation-recommendation-session.ts:96-98；一致性契約 src/lib/ai/chat-turn-destination.ts:979-1011）；未呼叫新 Source 函式、
 *        未另建 Parser。行政區案：三欄任一非 null → 新檢查「T53.searchScope」不得只剩父城市（searchScope=area／district 且 area 含行政區）；
 *        三欄皆 null → 不加檢查鍵、輸出「Search Scope 未由此流程寫入（UNVERIFIED）」（null 不當 PASS 依據）。每案輸出 place-protect search-scope 行。
 *        自我檢查新增：三欄皆 null 不得產生檢查鍵；只剩父城市／area＝父城市必須 FAIL；area＝行政區必須 PASS。
 *        讀碼推論（待使用者執行確認）：此函式鏈（applyTripIntentToSession／mergeTravelContext／mergeTripPlanningContext／extract*）不寫
 *        recommendationSession 的這三欄（Fixture mk() 也沒有）→ 六案預期皆三欄 null → 行政區兩案輸出 UNVERIFIED。
 *   fix:"A2-MP-T56" #20（未動）「去金澤玩」BASELINE-KNOWN／P2／UNRESOLVED、protect 9/10 證據、KNOWN_BASELINE、PROTECT、S1～S6 tenChecks、BROKEN_RE
 *        逐字未改；福岡玩兩天不列入 KNOWN_BASELINE（既有自我檢查保留）。evalCase 只新增一行 lastActual 記錄（不影響判定）。
 *
 * ── 任務單 #61（T57 四項測試品質修正；只加嚴或更正說明；施工前副本 scratchpad/pre-T61-copies/scripts/verify-negated-switch-s1s4.mjs sha256 d0a248bd…）──
 *   fix:"T61" #21（更正說明）PLACE_PROTECT 兩個行政區案 parentBasis：「未找到 Authority 契約」→ 依 #18 補 chat-turn-destination.ts:1222-1230
 *        （只適用未驗證「父城市＋尾端」待確認流程，不適用 curated 行政區 → 不放行）。判定不變。
 *   fix:"T61" #22（加嚴；改寫 #19 的 T53.searchScope 判定）依 chat-turn-destination.ts:994-1003：searchScope 必須＝"area"（刪除 district 放行）、
 *        area／parentCity 皆非空、area＝行政區（p.area 或 allowed 中不含上層城市的行政區寫法；原「含」改為相等）、parentCity ∈ parentOk。
 *        三欄皆 null → 仍不產生檢查鍵（UNVERIFIED）。自我檢查新增：T57 反例 {district, 中西區, 高雄} 必須 FAIL；district／parent 錯／parent null／
 *        area null／area 夾帶上層城市各一反例；每個 parentOk 寫法一正例；{area, 中西區, 台南} 正例；三欄明確 null 不產生鍵。
 *   fix:"T61" #23（加嚴，新增鍵）非行政區案另加 T53.recognized.session.authority：依 planning-context-authority.ts:49-68，
 *        travelContext.destination→tripPlanningContext→tripDestination.city 第一個有值欄位必須＝合法完整名稱。原 T53.recognized.session 鍵不變。
 *        自我檢查：「只有 preferredArea＝新城市、tpc／dest／td／rs 全京都」必須由新鍵判 FAIL（並確認原鍵 PASS＝漏洞記錄）；
 *        dest＝京都＋tpc＝新城市 必須 FAIL；權威欄位已更新、dest＝null＋tpc＝新城市 兩正例 0 失敗。
 *   fix:"T61" #24（未動）「去金澤玩」BASELINE-KNOWN、protect 9/10、KNOWN_BASELINE、PROTECT、S1～S6 tenChecks、BROKEN_RE、inferNow 字串逐字未改
 *        （inferNow 為 T53／T56 讀碼推論；#23 新鍵可能使「改去名古屋」等案的實際結果與 inferNow 不同，待使用者執行確認）。
 *
 * ── 任務單 #64（T63 審查 REQUEST CHANGES；只加嚴或更正說明；施工前副本 scratchpad/pre-T64-copies/scripts/verify-negated-switch-s1s4.mjs）──
 *   fix:"T64" #25（加嚴；更正 #22）T53.searchScope 的 area 只接受 compact(rec.area)＝compact(p.area)（chat-turn-destination.ts:1001；compactLabel :63-65 →
 *        normalizeDestinationLabel trip-planning-context.ts:108-114 → normalizeCityLabel :467-474 不去「區」）。刪除 #22 的「allowed 中行政區寫法」放行
 *        （東京新宿案原會放行「新宿區」）。parentCity 改為 compact 後＝parentOk[0]（CURATED_PROFILES 鍵；台南市／東京都 經 normalizeCityLabel 與契約同樣相等）。
 *        別名表（DESTINATION_ALIASES／applyCityLocaleAlias）不重現 → 別名寫法不接受（較嚴）。自我檢查新增 {area, 新宿區, 東京} 必須 FAIL；{area, 新宿, 東京／東京都} 必須 PASS。
 *   fix:"T64" #26（加嚴；自我檢查精確化）onlyParse 控制組與 PP-new-trip-tainan 指定控制組的 startsWith("T53.recognized.session") →
 *        startsWith("T53.recognized.session:")（不再被 #23 新鍵 .authority 命中；比照 paOnly 控制組）。
 *   fix:"T64" #27（未動）「去金澤玩」BASELINE-KNOWN、protect 9/10、KNOWN_BASELINE、PROTECT、S1～S6 tenChecks、BROKEN_RE、inferNow 逐字未改。
 */
const oi = console.info, ow = console.warn; console.info = () => {}; console.warn = () => {};
// A2-MP-T42（M1）：不再以自訂 fetch「取代」offline-guard 的 fetch（原寫法使 Runner 的 network-attempts.log 收不到 fetch 紀錄，
// network-attempts>0 → FAIL 對 fetch 失效）。改為：計數後轉呼叫覆寫前的 fetch，讓 guard 照常記錄並擋下；
// guard 不存在（globalThis.__OFFLINE_GUARD__ !== true）時絕不轉呼叫真實 fetch，直接丟錯（不得產生真實網路請求）。
const priorFetch = globalThis.fetch;
const guardActive = globalThis.__OFFLINE_GUARD__ === true;
let externalCalls = 0;
globalThis.fetch = async (...args) => {
  externalCalls += 1;
  if (guardActive && typeof priorFetch === "function") return priorFetch(...args); // offline-guard：寫 network-attempts.log 後丟錯
  throw new Error("[negated-switch-s1s4] 禁止外部請求（offline-guard 未預載，不轉呼叫真實 fetch）");
};

const R = "/Users/shuo/Roamie-clean/src";
const { createEmptySession, extractPlanningHintsFromText, extractDiscoveryFromText } = await import(R + "/lib/chat-session.ts");
const { mergeTravelContext } = await import(R + "/lib/ai/travel-context.ts");
const { mergeTripPlanningContext, parseDestinationFromText } = await import(R + "/lib/ai/trip-planning-context.ts");
const { applyTripIntentToSession } = await import(R + "/lib/recommendation/trip-intent.ts");
const { extractChatPlanningContextFromText } = await import(R + "/lib/chat-planning-flow.ts");
const cri = await import(R + "/lib/ai/continue-recommendation-intent.ts");
const negFn = typeof cri.parseNegatedDestinationSwitch === "function" ? cri.parseNegatedDestinationSwitch : null;

// ── Fixture：逐字沿用 diag-e2h-work.mjs mk() ──
const mk = (city, country) => !city ? createEmptySession() : ({ ...createEmptySession(), planningSessionId: "plan-" + city,
  location: { city, lat: 0, lng: 0 }, preferredArea: city,
  tripDestination: { placeId: "", country, city, lat: 1, lng: 1, formattedName: city, displayLabel: city },
  tripPlanningContext: { destination: city, selectedPlaces: [], intent: "general" },
  recommendationSession: { destination: city },
  travelContext: { destination: city, destinationCity: city, currentLocation: city, destinationCountry: country, destinationType: "city", interests: [] } });

// ── 解析順序：逐字沿用 diag-e2h-work.mjs 第 23–27 行 ──
function run(city, country, t, ext = false) {
  let s = mk(city, country); const pd = parseDestinationFromText(t);
  s = applyTripIntentToSession(t, s);
  const m = mergeTravelContext(s, t); s = m.session;
  const pm = mergeTripPlanningContext(t, s, m.context); s = pm.session;
  s = extractPlanningHintsFromText(t, s); s = extractDiscoveryFromText(t, s); s = extractChatPlanningContextFromText(t, s);
  let neg;
  try { neg = negFn ? (negFn(t) ?? null) : "N/A(no export)"; } catch (e) { neg = `throw:${String(e?.message ?? e).slice(0, 80)}`; }
  const base = {
    neg, parseDest: pd ?? null,
    loc: s.location?.city ?? null, cur: s.travelContext?.currentLocation ?? null, tpc: s.tripPlanningContext?.destination ?? null,
    pa: s.preferredArea ?? null, dest: s.travelContext?.destination ?? null, td: s.tripDestination?.city ?? null,
    rs: s.recommendationSession?.destination ?? null, sid: s.planningSessionId ?? null,
  };
  if (!ext) return base; // A2-MP-T53 #12：非 place-protect 呼叫回傳物件與 T46 逐字相同
  // A2-MP-T53 #12：同一 Session 的既有欄位（未呼叫新 Source 函式）；寫入點 src/lib/ai/travel-context.ts:545-644（mergeDestinationFields）
  return { ...base,
    dcity: s.travelContext?.destinationCity ?? null, dreg: s.travelContext?.destinationRegion ?? null,
    dtype: s.travelContext?.destinationType ?? null,
    // A2-MP-T56 #19：同一 Session 的既有欄位 recommendationSession.searchScope／area／parentCity（src/lib/ai/conversation-recommendation-session.ts:96-98；未呼叫新 Source 函式）
    rsScope: s.recommendationSession?.searchScope ?? null, rsArea: s.recommendationSession?.area ?? null,
    rsParent: s.recommendationSession?.parentCity ?? null };
}

const CITY = "京都", COUNTRY = "日本", SID = "plan-京都";
const SESSION_KEYS = ["loc", "cur", "tpc", "pa", "dest", "td", "rs"];
const FIELD_NAME = { loc: "location.city", cur: "currentLocation", tpc: "tripPlanningContext", pa: "preferredArea", dest: "travelContext.destination", td: "tripDestination", rs: "recommendationSession", sid: "planningSessionId" };
// 殘破字串：S1～S4 實際出現「大阪了」「大阪了換金澤」「大阪了換金澤再」這類把語法片段寫進地名的值。
// A2-MP-T42：另抓切換殘留「金澤玩」（去金澤玩 → 尾端「玩」）與「成金澤」（換成金澤 → 開頭「成」）。
//   「^成」只用在本檔 Fixture（京都／金澤／大阪）的 Session 值；本檔沒有以「成」開頭的合法地名 Fixture（未經確認的地名不得加入）。
const BROKEN_RE = /[了，,、。！？!?\s]|再$|玩$|^(?:換|换|改|去|不|成)|推薦|推荐/;
// A2-MP-T42：BROKEN_RE 自我檢查（純字串；不呼叫 src）。任一不符 → FAIL。
const BROKEN_SELF = [
  ...["大阪了", "大阪了換金澤", "大阪了換金澤再", "金澤玩", "成金澤", "換金澤", "去金澤"].map((v) => ({ v, want: true })),
  ...["京都", "金澤", "金沢", "金澤市", "大阪"].map((v) => ({ v, want: false })),
];
const brokenSelfBad = BROKEN_SELF.filter(({ v, want }) => BROKEN_RE.test(v) !== want);

// 十項斷言（S1～S6 與完整保護案共用）
const tenChecks = (a) => ({
  "1.neg=大阪": a.neg?.negatedText === "大阪",
  "2.switch=金澤": a.neg?.switchedText === "金澤",
  "3.location.city=京都": a.loc === CITY,
  "4.currentLocation=京都": a.cur === CITY,
  "5.tripPlanningContext=京都": a.tpc === CITY,
  "6.preferredArea=京都": a.pa === CITY,
  "7.travelContext.destination=京都": a.dest === CITY,
  "8.tripDestination=京都": a.td === CITY,
  "9.recommendationSession=京都": a.rs === CITY,
  "10.planningSessionId=plan-京都": a.sid === SID,
});
// 非否定切換句：#1／#2 改為「不得被誤判為否定切換」，#3～#10 維持京都
const keepKyotoNoNeg = (a) => {
  const c = tenChecks(a);
  delete c["1.neg=大阪"]; delete c["2.switch=金澤"];
  return { "1.neg=null": a.neg === null, ...c };
};
// 正常切換句（金澤未經 Provider 確認的現行函式層行為不在本契約範圍）：只守不誤判否定、不寫入大阪、不寫入殘破字串
const noPollution = (a) => {
  const c = { "1.neg=null": a.neg === null };
  for (const k of SESSION_KEYS) {
    const v = a[k];
    c[`${FIELD_NAME[k]}:無大阪且非殘破`] = v === null || (!String(v).includes("大阪") && !BROKEN_RE.test(String(v)));
  }
  return c;
};

const MAIN = [
  { id: "S1", t: "我不想去大阪了，換金澤", expect: "FAIL" },
  { id: "S2", t: "那就不去大阪了，換金澤", expect: "FAIL" },
  { id: "S3", t: "不去大阪了，去金澤", expect: "FAIL" },
  { id: "S4", t: "我不想去大阪了，換金澤，再推薦幾個", expect: "FAIL" },
  { id: "S5", t: "大阪不去了，換金澤", expect: "PASS" },
  { id: "S6", t: "不想去大阪了，換成金澤", expect: "PASS" },
];

// 保護組（現行行為為讀碼推論、待執行確認）
const PROTECT = [
  // 既有可解析的否定切換句型（mp25-post P18-1／P18-3 用過）：完整十項，期望同 S5／S6
  { id: "PG-neg-kai", t: "不要去大阪，改金澤", checks: tenChecks },
  { id: "PG-neg-more", t: "不去大阪了，換金澤，再推薦幾個", checks: tenChecks },
  // 純延續推薦：不得動目的地與 Session
  { id: "PG-more", t: "再推薦幾個", checks: keepKyotoNoNeg },
  // 否定非地名（無「去」）：不得被當成目的地否定，不得動 Session
  { id: "PG-neg-walk", t: "我不想走太多路", checks: keepKyotoNoNeg },
  { id: "PG-neg-food", t: "不想吃拉麵了，換咖啡廳", checks: (a) => ({
    "1.neg=null": a.neg === null,
    "3.location.city=京都": a.loc === CITY,
    "8.tripDestination=京都": a.td === CITY,
    "9.recommendationSession=京都": a.rs === CITY,
    "10.planningSessionId=plan-京都": a.sid === SID,
    ...Object.fromEntries(Object.entries(noPollution(a)).filter(([k]) => k !== "1.neg=null")),
  }) },
  // 正常（無否定）目的地切換句：不得被誤判為否定切換、不得寫入殘破字串
  { id: "PG-switch-huan", t: "換金澤", checks: noPollution },
  { id: "PG-switch-huancheng", t: "換成金澤", checks: noPollution },
  { id: "PG-switch-gaiqu", t: "改去金澤", checks: noPollution },
  { id: "PG-switch-qu-wan", t: "去金澤玩", checks: noPollution },
  { id: "PG-switch-huan-more", t: "換金澤，再推薦幾個", checks: noPollution },
];

// A2-MP-T46（使用者裁決 (一)）：已知基線失敗只做輸出標註；斷言、protect pass 計算與分母不變（不得刪除斷言、不得改成 10/10）。
const KNOWN_BASELINE = {
  "PG-switch-qu-wan": {
    known: "BASELINE-KNOWN/P2/UNRESOLVED",
    knownDetail: "「去金澤玩」preferredArea=金澤玩、travelContext.destination=金澤玩（planner-reset-s1s4-T43 log L15）；根因 src/lib/ai/destination-travel-profile.ts:438-463、src/lib/chat-planning-flow.ts:82-86（E2 前既有）；仍計入 protect FAIL",
  },
};
const knownSeen = [];

// ── A2-MP-T46（使用者裁決 (二)）：合法地名保護（獨立群組 place-protect；不併入 PROTECT、不改 protect pass 分母）──
// 名稱只取 repo 內既有 Fixture／地理資料（src 是 Roamie-clean/src，scripts 是 Roamie-clean/scripts）；句子取既有 Fixture 原句，
// 或沿用本檔既有句型（註明）。期望值依正確行為設定；現行結果為讀碼推論、待執行確認（本輪 tester 不執行本檔）。
//   allowed：任何 Session 欄位／parseDestinationFromText 可接受的完整名稱；parentOk：只在城市層欄位（location.city、tripDestination.city）可接受的上層城市。
const CITY_LEVEL_KEYS = ["loc", "td"];
const placeChecks = (allowed, parentOk = []) => (a) => {
  const c = {
    "1.neg=null": a.neg === null,
    "parseDest:null／合法完整名稱／上層城市": a.parseDest === null || allowed.includes(a.parseDest) || parentOk.includes(a.parseDest),
  };
  for (const k of SESSION_KEYS) {
    const v = a[k];
    const ok = v === null || v === CITY || allowed.includes(v) || (CITY_LEVEL_KEYS.includes(k) && parentOk.includes(v));
    c[`${FIELD_NAME[k]}:null／京都／合法完整名稱${CITY_LEVEL_KEYS.includes(k) && parentOk.length ? "／上層城市" : ""}`] = ok;
  }
  return c;
};
// ── A2-MP-T53（使用者裁決 1／2／3；只加嚴）：placeChecks（上方 T46 版）逐字保留並先執行，再加必要條件 ──
// 辨識欄位：目的地欄位（不含 location.city／currentLocation）＋ parseDestinationFromText。
const RECOG_KEYS = ["tpc", "pa", "dest", "td", "rs", "dcity"];
// 行政區承載欄位：preferredArea、travelContext.destination（curated 行政區＝displayLabel，destination-resolution.ts:215-226）、
// tripPlanningContext、travelContext.destinationRegion（district → area，destination-scope.ts:131-139）。
const AREA_KEYS = ["pa", "dest", "tpc", "dreg"];
const T53_FIELD_NAME = { ...FIELD_NAME, dcity: "travelContext.destinationCity", dreg: "travelContext.destinationRegion" };
// travelContext.destination＝上層城市：src 沒有適用於 curated 行政區的放行契約（chat-turn-destination.ts:1222-1230 只適用未驗證「父城市＋尾端」待確認流程）→ 不放行（null＝無適用契約；見檔頭 #11、A2-MP-T56 #18）。
const DEST_PARENT_CONTRACT = null;
const placeChecksT53 = (p) => (a) => {
  const parentOk = p.parentOk ?? [];
  const c = placeChecks(p.allowed, parentOk)(a); // T46 原檢查：鍵名與判定逐字不變
  const dc = a.dcity ?? null, dr = a.dreg ?? null;
  c[`T53.travelContext.destinationCity:null／京都／合法完整名稱${parentOk.length ? "／上層城市(destination-scope.ts:137)" : ""}`] =
    dc === null || dc === CITY || p.allowed.includes(dc) || parentOk.includes(dc);
  c["T53.travelContext.destinationRegion:null／合法完整名稱"] = dr === null || p.allowed.includes(dr);
  const recog = [...p.allowed, ...parentOk].filter((v) => v !== CITY);
  const hits = [a.parseDest, ...RECOG_KEYS.map((k) => a[k] ?? null)].filter((v) => v !== null && recog.includes(v));
  c[`T53.recognized:目的地欄位或 parseDest 至少一個＝${recog.join("／")}`] = hits.length > 0;
  // A2-MP-T56 #17（指派者裁決；加嚴）：非行政區案（正常切換城市／正常新行程規劃）另要求 parseDest 以外至少一個 Session 目的地欄位＝合法完整名稱
  //   （p.allowed，不含京都；欄位＝RECOG_KEYS）。只有 parseDest 命中、Session 全京都 → FAIL。行政區案由 T53.district 要求 Session 欄位（不變）。
  if (!p.area) {
    const fullNames = p.allowed.filter((v) => v !== CITY);
    c[`T53.recognized.session:parseDest 以外 ${RECOG_KEYS.map((k) => T53_FIELD_NAME[k]).join("／")} 至少一欄＝${fullNames.join("／")}`] =
      RECOG_KEYS.some((k) => fullNames.includes(a[k] ?? null));
    // 任務單 #61（T57 第 4 項；加嚴，新增鍵，上一鍵不變）：正式 Authority＝src/lib/ai/planning-context-authority.ts:49-68 readPlanningContextAuthority
    //   destination 依序取 travelContext.destination（:59-61）→ tripPlanningContext.destination（:62-64）→ tripDestination.city（:65-67）第一個有效值；
    //   preferredArea／recommendationSession／destinationCity 不是 Authority 來源（檔頭 :9-11 另明列 tripPlanningContext 為 derived mirror，但讀取時仍是第二順位）。
    //   → 只有 preferredArea＝新城市、dest／tpc／td 仍是京都時，Authority 讀到的仍是京都 → 必須 FAIL（上一鍵會因 pa 命中而 PASS）。
    const authorityDest = [a.dest, a.tpc, a.td].find((v) => v !== null && v !== undefined && String(v).trim() !== "") ?? null;
    c[`T53.recognized.session.authority:planning-context-authority.ts:49-68 順序（travelContext.destination→tripPlanningContext→tripDestination）第一個有值欄位＝${fullNames.join("／")}`] =
      fullNames.includes(authorityDest);
  }
  // A2-MP-T56 #19：行政區案的 recommendationSession Search Scope。三欄皆 null → 不加檢查鍵（不得當 PASS 依據；輸出 UNVERIFIED）。
  // 任務單 #61（T57 第 3 項；加嚴）：依正式 Authority src/lib/ai/chat-turn-destination.ts:979-1011 recommendationSessionMatchesTrustedScope 的 area 分支（:994-1003）：
  //   rec.searchScope 必須 === "area"（:995；"district" 不再接受——:1005 對 city scope 也把 district 視為不可重用）、
  //   recArea／recParent 皆非空（:999-1000）、compact(rec.area) === compact(trustedArea.area)（:1001）、compact(rec.parentCity) === compact(trustedArea.parentCity)（:1002）。
  //   trusted area.area＝curated district（destination-travel-profile.ts:293-300：area＝normalizedArea、parentCity＝CURATED_PROFILES 鍵；東京 districts 含「新宿」:177）。
  //   任務單 #64（T63 第 1 項；加嚴）：area 只接受「compact 後等於 p.area」（原 T61 版另接受 allowed 中的行政區寫法 → 東京新宿案會放行「新宿區」，與 :1001 不符）。
  //   compactLabel（chat-turn-destination.ts:63-65）＝normalizeDestinationLabel（trip-planning-context.ts:108-114）後去除 [\s,，、/／-]；
  //   normalizeDestinationLabel＝normalizeDestinationAndDuration（parse-chinese-duration.ts:93-108，只去天數尾綴）→ normalizeCityLabel（trip-planning-context.ts:467-474：
  //   京都不變、東京都→東京、其餘只去尾端 市／縣／都／府，不去「區」）→ DESTINATION_ALIASES／applyCityLocaleAlias（別名表）。
  //   本檔 cmp 重現「去分隔字元＋normalizeCityLabel」兩步；別名表與天數尾綴不重現（別名寫法一律不接受＝較嚴；別名等價 UNVERIFIED）。
  //   parentCity：cmp 後必須等於 parentOk[0]（＝CURATED_PROFILES 鍵 台南／東京）；台南市 經 normalizeCityLabel 去「市」後等於台南，與契約一致。
  if (p.area && [a.rsScope, a.rsArea, a.rsParent].some((v) => v !== null && v !== undefined)) {
    const ncl = (t) => (t === "京都" ? "京都" : t === "東京都" || t === "东京都" ? "東京" : t.replace(/(市|縣|都|府)$/, "")); // trip-planning-context.ts:467-474
    const cmp = (v) => (typeof v === "string" ? ncl(v.trim()).replace(/[\s,，、/／-]+/g, "") : "");
    const parentKey = cmp((p.parentOk ?? [])[0] ?? "");
    const recArea = cmp(a.rsArea), recParent = cmp(a.rsParent);
    c[`T53.searchScope:recommendationSession 須符合 chat-turn-destination.ts:994-1003（searchScope=area、compact(area)＝${p.area}、compact(parentCity)＝${(p.parentOk ?? [])[0] ?? "-"}）`] =
      a.rsScope === "area" && Boolean(recArea) && Boolean(recParent) && Boolean(parentKey) && recArea === cmp(p.area) && recParent === parentKey;
  }
  if (p.area) {
    const areaVals = p.allowed.filter((v) => v.includes(p.area));
    c[`T53.district:${p.area} 保留於 ${AREA_KEYS.map((k) => T53_FIELD_NAME[k]).join("／")} 至少一欄（上層城市不算）`] =
      AREA_KEYS.some((k) => areaVals.includes(a[k] ?? null));
  }
  for (const bad of p.forbidden ?? []) {
    const vals = [a.parseDest, ...SESSION_KEYS.map((k) => a[k]), a.dcity, a.dreg].filter((v) => v !== null && v !== undefined);
    c[`T53.forbidden:任何欄位不得含「${bad}」`] = !vals.some((v) => String(v).includes(bad));
  }
  return c;
};
const PLACE_PROTECT = [
  // 正常行政區
  { id: "PP-district-tainan-zhongxi", cat: "正常行政區", name: "中西區", t: "台南中西區有什麼咖啡廳推薦",
    src: "scripts/verify-recommendation-search-center.mjs:304（原句）、:308 destinationName=台南中西區、:310 destinationArea=中西區；src/lib/ai/destination-travel-profile.ts:97 台南 districts 含中西區；上層 台南 src/lib/ai/country-city-options.ts:116、台南市 src/lib/ai/region-adjacency/graph.ts:409",
    allowed: ["台南中西區", "中西區"], parentOk: ["台南", "台南市"],
    // A2-MP-T53 #11：行政區必要條件與父城市放行依據
    area: "中西區",
    parentBasis: "上層城市只放行於 location.city／tripDestination.city（T46 原規則，trip-intent.ts:18-19、:432-447 destinationCity→location.city）與 travelContext.destinationCity（destination-scope.ts:131-139）；travelContext.destination＝台南：src 沒有適用於 curated 行政區的放行契約 → 不放行。父城市相關的既有契約 src/lib/ai/chat-turn-destination.ts:1222-1230 resolveConfirmedParentScopeTurnDestination 只適用於未驗證的「父城市＋尾端」待確認流程（planCategoryTurnClarification parent_city_scope，:1210-1220），不適用於 curated 行政區，所以不放行；curated 行政區 destination＝displayLabel（destination-resolution.ts:215-226）（任務單 #61 依 #18 更正）",
    inferNow: "FAIL（推論、待執行確認：T46 原檢查 currentLocation／tripPlanningContext／preferredArea＝台南 不在允許值 → FAIL。根因推論：parseDestinationFromText 無 去/想去 → 走嵌入標籤只回「台南」trip-planning-context.ts:812-813→:677-682（:606）；applyTripIntentToSession trip-intent.ts:79-80、:442-447、:474-476 寫 location.city／preferredArea＝台南 → travel-context.ts:1026 currentLocation＝台南；mergeTripPlanningContext trip-planning-context.ts:980-987、:1039 寫 tripPlanningContext／preferredArea＝台南（覆蓋 planning-context-authority.ts:201 寫入的台南中西區）。T53 新檢查推論 PASS：travelContext.destination＝台南中西區（travel-context.ts:542 → destination-travel-profile.ts:291-302 curated）、destinationRegion＝中西區、destinationCity＝台南（travel-context.ts:625-644 → destination-scope.ts:131-139；destination-entity.ts:821 district）→ recognized／district PASS）" },
  { id: "PP-district-tokyo-shinjuku", cat: "正常行政區", name: "新宿", t: "東京新宿天氣怎麼樣",
    src: "scripts/verify-destination-area-tail-authority.mjs:10（原句與期望 東京新宿）；新宿 src/lib/ai/destination-area-aliases.ts:55；新宿區 scripts/verify-home-outfit-location.mjs:40；上層 東京 src/lib/ai/country-city-options.ts:83",
    allowed: ["東京新宿", "新宿", "新宿區"], parentOk: ["東京"],
    area: "新宿",
    parentBasis: "同 PP-district-tainan-zhongxi（destinationCity 放行依據 destination-scope.ts:131-139；travelContext.destination＝東京：src 沒有適用於 curated 行政區的放行契約——chat-turn-destination.ts:1222-1230 resolveConfirmedParentScopeTurnDestination 只適用於未驗證「父城市＋尾端」待確認流程（:1210-1220），不適用於 curated 行政區 → 不放行）（任務單 #61 依 #18 更正）",
    inferNow: "FAIL（推論、待執行確認：同中西區案根因 → parseDestinationFromText 嵌入標籤只回「東京」trip-planning-context.ts:812-813→:677-682（:621）；currentLocation（travel-context.ts:1026）／tripPlanningContext／preferredArea（trip-planning-context.ts:980-987、:1039）＝東京 → T46 原檢查 FAIL；location.city＝東京 屬 parentOk。T53 新檢查推論 PASS：travelContext.destination＝東京新宿（destination-travel-profile.ts:175-177 東京 districts 含新宿 → :291-302）、destinationRegion＝新宿、destinationCity＝東京）" },
  // 正常切換城市（句型沿用本檔 PG-switch-huancheng／PG-switch-gaiqu，只換成出處所列城市）
  { id: "PP-switch-city-huancheng-fukuoka", cat: "正常切換城市", name: "福岡", t: "換成福岡",
    src: "福岡 src/lib/ai/country-city-options.ts:87、src/lib/ai/destination-geocode.ts:251；福岡市 src/lib/ai/destination-geocode.ts:304；句型＝本檔 PG-switch-huancheng",
    allowed: ["福岡", "福岡市"],
    inferNow: "PASS（推論、待執行確認；修正 T46 推論：福岡在嵌入標籤 trip-planning-context.ts:626（金澤不在），parseDestinationFromText→:812-813 回福岡；trip-intent.ts:79-80、:442-447 寫 location.city／preferredArea＝福岡；travel-context.ts:542 resolveDestinationAreaScope 無尾 → resolveDestinationFromText＝福岡 → travelContext.destination＝福岡、destinationCity＝福岡（destination-scope.ts:142-147）；recognized PASS）" },
  { id: "PP-switch-city-gaiqu-nagoya", cat: "正常切換城市", name: "名古屋", t: "改去名古屋",
    src: "名古屋 src/lib/ai/country-city-options.ts:86、src/lib/ai/destination-geocode.ts:252；名古屋市 src/lib/ai/destination-geocode.ts:301；句型＝本檔 PG-switch-gaiqu",
    allowed: ["名古屋", "名古屋市"],
    inferNow: "PASS（推論、待執行確認：parseDestinationFromText wantGo trip-planning-context.ts:775-779 回名古屋；chat-planning-flow.ts:82-86「去名古屋$」→ preferredArea＝名古屋；recognized PASS）" },
  // 正常新行程規劃
  { id: "PP-new-trip-fukuoka-two-days", cat: "正常新行程規劃", name: "福岡", t: "我想去福岡玩兩天",
    src: "scripts/verify-recommendation-intent-activity-final.mjs:271（PLAN-C-gen 原句）；福岡 src/lib/ai/country-city-options.ts:87；福岡市 src/lib/ai/destination-geocode.ts:304",
    allowed: ["福岡", "福岡市"],
    // A2-MP-T53 #13：期望不變（福岡／福岡市）；不加入 KNOWN_BASELINE、不標 BASELINE-KNOWN
    forbidden: ["福岡玩兩天"],
    inferNow: "FAIL（推論、待執行確認：preferredArea＝福岡玩兩天 — chat-planning-flow.ts:82-86 lazy 正則（.{2,24}?）停止詞無「玩」／天數，在 $ 才停；這是鏈中最後一步，必定覆蓋。travelContext.destination 可能也是福岡玩兩天：travel-context.ts:542 → destination-travel-profile.ts:438-467 extractCityTailAreaCandidate 以福岡為父、尾「玩兩天」（AREA_QUERY_STOP :344-345 無「玩」）→ displayLabel 福岡玩兩天，destinationRegion＝玩兩天（destination-scope.ts:131-139）；若 currentIntent＝create_itinerary 則 travel-context.ts:965-968 可能改為福岡（待執行確認）。recognized 推論 PASS（parseDest＝福岡 travel-language-signals.ts:22、:41 → trip-planning-context.ts:735-737）；forbidden FAIL）" },
  { id: "PP-new-trip-tainan", cat: "正常新行程規劃", name: "台南", t: "我想去台南",
    src: "scripts/verify-itinerary-regression.mjs:145（原句）；台南 src/lib/ai/country-city-options.ts:116；台南市 src/lib/ai/region-adjacency/graph.ts:409",
    allowed: ["台南", "台南市"],
    inferNow: "PASS（推論、待執行確認：parseDest＝台南 travel-language-signals.ts:22、:41 → trip-planning-context.ts:735-737；travelContext.destination＝台南（travel-context.ts:542）；mode＝destination_planning → tripDestination＝undefined（trip-planning-context.ts:1042-1052、:950-952）；chat-planning-flow.ts:82-86「去台南$」→ preferredArea＝台南；recognized PASS）" },
];
// Fixture 自我檢查（純字串；不呼叫 src）：合法名稱不得被 BROKEN_RE 判為殘破；name 必須出現在句中。
const PP_SELF_BAD = PLACE_PROTECT.flatMap((p) => [
  ...[...p.allowed, ...(p.parentOk ?? [])].filter((v) => BROKEN_RE.test(v)).map((v) => `${p.id}:${v} 被 BROKEN_RE 判為殘破`),
  ...(p.t.includes(p.name) ? [] : [`${p.id}:句中沒有 ${p.name}`]),
]);
// A2-MP-T53 #15：新放行與必要條件的自我檢查（純資料；合成 actual 不呼叫 src）。任一不符 → FAIL。
const t53Fails = (p, a) => Object.entries(placeChecksT53(p)(a)).filter(([, ok]) => !ok).map(([k]) => k);
const PP_T53_SELF_BAD = PLACE_PROTECT.flatMap((p) => {
  const bad = [];
  const parentOk = p.parentOk ?? [];
  const recog = [...p.allowed, ...parentOk];
  if (!recog.length) bad.push(`${p.id}:recog 為空`);
  if (recog.includes(CITY)) bad.push(`${p.id}:allowed／parentOk 含 Fixture 京都（辨識條件會被 Fixture 自動滿足）`);
  if (KNOWN_BASELINE[p.id]) bad.push(`${p.id}:不得列入 KNOWN_BASELINE`);
  for (const f of p.forbidden ?? []) if (recog.includes(f)) bad.push(`${p.id}:forbidden ${f} 出現在 allowed／parentOk`);
  if (p.area) {
    if (!p.t.includes(p.area)) bad.push(`${p.id}:句中沒有行政區 ${p.area}`);
    if (!p.allowed.some((v) => v.includes(p.area))) bad.push(`${p.id}:allowed 無含 ${p.area} 的名稱`);
    if (parentOk.some((v) => v.includes(p.area))) bad.push(`${p.id}:parentOk 含行政區 ${p.area}（父城市不得滿足行政區條件）`);
  }
  // 合成控制組
  const kyoto = { neg: null, parseDest: null, loc: CITY, cur: CITY, tpc: CITY, pa: CITY, dest: CITY, td: CITY, rs: CITY, sid: SID, dcity: CITY, dreg: null };
  const allNull = { neg: null, parseDest: null, loc: null, cur: null, tpc: null, pa: null, dest: null, td: null, rs: null, sid: SID, dcity: null, dreg: null };
  const full = p.allowed[0];
  const ideal = { ...kyoto, parseDest: full, loc: parentOk[0] ?? full, tpc: full, pa: full, dest: full,
    dcity: parentOk[0] ?? full, dreg: p.area ? (p.allowed.find((v) => v === p.area) ?? null) : null };
  const idealFails = t53Fails(p, ideal);
  if (idealFails.length) bad.push(`${p.id}:理想值控制組應 PASS 卻 FAIL（${idealFails.join("、")}）`);
  for (const [label, a] of [["全京都", kyoto], ["全 null", allNull]]) {
    if (!t53Fails(p, a).some((k) => k.startsWith("T53.recognized"))) bad.push(`${p.id}:${label}控制組 recognized 應 FAIL 卻 PASS`);
  }
  if (p.area) {
    const masked = { ...kyoto, parseDest: parentOk[0], dest: parentOk[0], dcity: parentOk[0] };
    if (!t53Fails(p, masked).some((k) => k.startsWith("T53.district"))) bad.push(`${p.id}:父城市掩蓋控制組 district 應 FAIL 卻 PASS`);
  }
  if (!DEST_PARENT_CONTRACT && parentOk.length) {
    if (!t53Fails(p, { ...ideal, dest: parentOk[0] }).length) bad.push(`${p.id}:travelContext.destination＝上層城市應 FAIL（無契約不放行）卻 PASS`);
  }
  for (const f of p.forbidden ?? []) {
    if (!t53Fails(p, { ...ideal, pa: f }).length) bad.push(`${p.id}:preferredArea＝${f} 控制組應 FAIL 卻 PASS`);
  }
  // A2-MP-T56 #17：只有 parseDest 命中、Session 全京都 → recognized 必須 FAIL（非行政區案）
  if (!p.area) {
    const onlyParse = { ...kyoto, parseDest: full };
    if (!t53Fails(p, onlyParse).some((k) => k.startsWith("T53.recognized.session:"))) bad.push(`${p.id}:只有 parseDest＝${full}、Session 全京都控制組 recognized 應 FAIL 卻 PASS`);
    // 任務單 #61（T57 第 4 項）：正反對照（依 planning-context-authority.ts:49-68）
    const AK = "T53.recognized.session.authority";
    //   反例：只有 preferredArea＝新城市，tpc／dest／td／rs（及 destinationCity）仍是京都 → Authority＝京都 → 必須 FAIL，且由 authority 鍵判出（上一鍵 PASS＝記錄原本的漏洞）
    const paOnly = { ...kyoto, pa: full };
    const paOnlyFails = t53Fails(p, paOnly);
    if (!paOnlyFails.some((k) => k.startsWith(AK))) bad.push(`${p.id}:只有 preferredArea＝${full}、tpc／dest／td／rs 全京都控制組應由 ${AK} 判 FAIL 卻 PASS`);
    if (paOnlyFails.some((k) => k.startsWith("T53.recognized.session:"))) bad.push(`${p.id}:只有 preferredArea＝${full} 控制組：原 T53.recognized.session 鍵預期 PASS（漏洞記錄）卻 FAIL（控制組前提改變，需檢查）`);
    //   反例（順序）：travelContext.destination＝京都、tripPlanningContext＝新城市 → Authority 先讀 travelContext（:59-61）→ 必須 FAIL
    if (!t53Fails(p, { ...kyoto, tpc: full }).some((k) => k.startsWith(AK))) bad.push(`${p.id}:travelContext.destination＝京都、tripPlanningContext＝${full} 控制組應 FAIL（Authority 先讀 travelContext）卻 PASS`);
    //   正例：權威欄位已更新（dest／tpc／td／rs／destinationCity＝新城市）→ 0 失敗
    const authUpd = t53Fails(p, { ...kyoto, dest: full, tpc: full, td: full, rs: full, dcity: full });
    if (authUpd.length) bad.push(`${p.id}:權威欄位已更新控制組應 PASS 卻 FAIL（${authUpd.join("、")}）`);
    //   正例（順序）：travelContext.destination 無值、tripPlanningContext＝新城市 → Authority 第二順位（:62-64）→ 0 失敗
    const authTpc = t53Fails(p, { ...kyoto, dest: null, tpc: full });
    if (authTpc.length) bad.push(`${p.id}:travelContext.destination＝null、tripPlanningContext＝${full} 控制組應 PASS 卻 FAIL（${authTpc.join("、")}）`);
  }
  // A2-MP-T56 #19：Search Scope 控制組（行政區案）
  if (p.area) {
    const SK = "T53.searchScope";
    if (Object.keys(placeChecksT53(p)(ideal)).some((k) => k.startsWith(SK))) bad.push(`${p.id}:Search Scope 三欄皆 null 卻產生檢查鍵（null 不得當 PASS 依據）`);
    if (!t53Fails(p, { ...ideal, rsScope: "city", rsArea: null, rsParent: parentOk[0] ?? null }).some((k) => k.startsWith(SK))) bad.push(`${p.id}:recommendationSession 只剩父城市控制組 searchScope 應 FAIL 卻 PASS`);
    if (!t53Fails(p, { ...ideal, rsScope: "area", rsArea: parentOk[0] ?? null, rsParent: parentOk[0] ?? null }).some((k) => k.startsWith(SK))) bad.push(`${p.id}:recommendationSession area＝父城市控制組 searchScope 應 FAIL 卻 PASS`);
    const okScope = t53Fails(p, { ...ideal, rsScope: "area", rsArea: p.area, rsParent: parentOk[0] ?? null });
    if (okScope.length) bad.push(`${p.id}:recommendationSession area＝${p.area} 控制組應 PASS 卻 FAIL（${okScope.join("、")}）`);
    // 任務單 #61（T57 第 3 項；chat-turn-destination.ts:994-1003）
    if (Object.keys(placeChecksT53(p)({ ...ideal, rsScope: null, rsArea: null, rsParent: null })).some((k) => k.startsWith(SK))) bad.push(`${p.id}:Search Scope 三欄明確 null 卻產生檢查鍵（應維持 UNVERIFIED）`);
    const scopeBad = [
      ["T57 反例 searchScope=district、area＝行政區、parentCity＝高雄", { rsScope: "district", rsArea: p.area, rsParent: "高雄" }],
      ["searchScope=district（其餘相符）", { rsScope: "district", rsArea: p.area, rsParent: parentOk[0] ?? null }],
      ["parentCity＝高雄（非父城市）", { rsScope: "area", rsArea: p.area, rsParent: "高雄" }],
      ["parentCity＝null", { rsScope: "area", rsArea: p.area, rsParent: null }],
      ["area＝null", { rsScope: "area", rsArea: null, rsParent: parentOk[0] ?? null }],
      ["area 含行政區但多出上層城市（非 :1001 相等）", { rsScope: "area", rsArea: `${parentOk[0] ?? ""}${p.area}`, rsParent: parentOk[0] ?? null }],
    ];
    for (const [label, sc] of scopeBad) {
      if (!t53Fails(p, { ...ideal, ...sc }).some((k) => k.startsWith(SK))) bad.push(`${p.id}:Search Scope ${label} 控制組應 FAIL 卻 PASS`);
    }
    for (const pc of parentOk) {
      const ok = t53Fails(p, { ...ideal, rsScope: "area", rsArea: p.area, rsParent: pc });
      if (ok.length) bad.push(`${p.id}:Search Scope 正例 area=${p.area}／parentCity=${pc} 應 PASS 卻 FAIL（${ok.join("、")}）`);
    }
  }
  // 任務單 #61：T57 指定反例逐字 {rsScope:"district", rsArea:"中西區", rsParent:"高雄"}（PP-district-tainan-zhongxi）必須 FAIL
  if (p.id === "PP-district-tainan-zhongxi") {
    const lit = t53Fails(p, { ...ideal, rsScope: "district", rsArea: "中西區", rsParent: "高雄" });
    if (!lit.some((k) => k.startsWith("T53.searchScope"))) bad.push(`${p.id}:T57 反例 {rsScope:"district", rsArea:"中西區", rsParent:"高雄"} 應 FAIL 卻 PASS`);
    const pos = t53Fails(p, { ...ideal, rsScope: "area", rsArea: "中西區", rsParent: "台南" });
    if (pos.length) bad.push(`${p.id}:正例 {rsScope:"area", rsArea:"中西區", rsParent:"台南"} 應 PASS 卻 FAIL（${pos.join("、")}）`);
  }
  // 任務單 #64（T63 第 1 項）：東京新宿案 {rsScope:"area", rsArea:"新宿區", rsParent:"東京"} 必須 FAIL（compactLabel 不去「區」：新宿區 ≠ curated area 新宿，:1001）；
  //   對照 {area, 新宿, 東京} 必須 PASS、{area, 新宿, 東京都} 必須 PASS（normalizeCityLabel 東京都→東京）
  if (p.id === "PP-district-tokyo-shinjuku") {
    const ku = t53Fails(p, { ...ideal, rsScope: "area", rsArea: "新宿區", rsParent: "東京" });
    if (!ku.some((k) => k.startsWith("T53.searchScope"))) bad.push(`${p.id}:T63 反例 {rsScope:"area", rsArea:"新宿區", rsParent:"東京"} 應 FAIL 卻 PASS`);
    for (const parent of ["東京", "東京都"]) {
      const ok = t53Fails(p, { ...ideal, rsScope: "area", rsArea: "新宿", rsParent: parent });
      if (ok.length) bad.push(`${p.id}:正例 {rsScope:"area", rsArea:"新宿", rsParent:"${parent}"} 應 PASS 卻 FAIL（${ok.join("、")}）`);
    }
  }
  return bad;
});
// A2-MP-T56 #17：指派者指定控制組 {neg:null, parseDest:"台南", 其他欄位全京都} → 必須 FAIL（PP-new-trip-tainan）
{
  const p = PLACE_PROTECT.find((x) => x.id === "PP-new-trip-tainan");
  const a = { neg: null, parseDest: "台南", loc: CITY, cur: CITY, tpc: CITY, pa: CITY, dest: CITY, td: CITY, rs: CITY, sid: SID, dcity: CITY, dreg: CITY };
  if (!p) PP_T53_SELF_BAD.push("PP-new-trip-tainan:找不到案例");
  else if (!t53Fails(p, a).length) PP_T53_SELF_BAD.push("PP-new-trip-tainan:{neg:null, parseDest:台南, 其他欄位全京都} 控制組應 FAIL 卻 PASS");
  else if (!t53Fails(p, a).some((k) => k.startsWith("T53.recognized.session:"))) PP_T53_SELF_BAD.push("PP-new-trip-tainan:{parseDest:台南, 其他全京都} 未由 T53.recognized.session 判 FAIL");
}
const PP_T53_UNVERIFIED = [
  // A2-MP-T56 #18／#19：更正（T53 版寫「未寫入 Session／本檔無此欄位」不完整；Session 的 recommendationSession 有 searchScope／area／parentCity）
  "UNVERIFIED(place-protect/T53): Search Scope — DestinationAreaScope.searchScope（src/lib/ai/destination-travel-profile.ts:57-62、:270-277）只存在於 mergeTravelContext 內 resolveDestinationAreaScope 的回傳（src/lib/ai/travel-context.ts:542、:970-978），不由此函式鏈寫入 travelContext；Session 的 ConversationRecommendationSession 另有 searchScope／area／parentCity（src/lib/ai/conversation-recommendation-session.ts:96-98），一致性契約＝src/lib/ai/chat-turn-destination.ts:979-1011 recommendationSessionMatchesTrustedScope。本檔 place-protect（ext=true）讀出並輸出這三欄（見 place-protect search-scope 行）：非 null → T53.searchScope 依 :994-1003 檢查（任務單 #61：searchScope 必須＝area〔不再接受 district〕、area＝行政區、parentCity＝父城市）；null → Search Scope 未由此流程寫入（UNVERIFIED，不當 PASS 依據）。未呼叫新 Source 函式、未另建 Parser／Harness",
  "NOT-ALLOWED(place-protect/T53): travelContext.destination＝上層城市 — src 中與「父城市」相關的既有契約 resolveConfirmedParentScopeTurnDestination（src/lib/ai/chat-turn-destination.ts:1222-1230）只用於未驗證的「父城市＋尾端」待確認流程（planCategoryTurnClarification parent_city_scope，:1210-1220；使用者確認父城市範圍後才以父城市解析），不適用於 curated 行政區（反例 src/lib/ai/destination-resolution.ts:215-226 curated 行政區 destination＝displayLabel、:245-255、:564-583；src/lib/ai/planning-context-authority.ts:49-68）→ 沒有放行 curated 行政區 destination＝父城市的契約，結論仍為不放行；上層城市只在 location.city／tripDestination.city（T46）與 travelContext.destinationCity（src/lib/ai/destination-scope.ts:131-139）放行",
];
const PP_UNVERIFIED = ["改", "換", "去"].map((ch) => `UNVERIFIED(place-protect): 名稱含「${ch}」的合法地名 — 已搜尋 src／scripts／supabase 的地名表與 Fixture（country-city-options.ts、destination-geocode.ts、region-adjacency/graph.ts、destination-area-aliases.ts、destination-localization-data.ts、trip-planning-context.ts 城市表等）無可靠出處，未收錄（不編造）`);

const lines = [];
let lastActual = null; // A2-MP-T56 #19
const ppScopeLines = []; // A2-MP-T56 #19：place-protect recommendationSession Search Scope（只輸出）
const evalCase =(id, t, checksFn, extra = {}, ext = false) => {
  let actual, checks;
  try {
    actual = run(CITY, COUNTRY, t, ext); // A2-MP-T53 #12：ext 只由 place-protect 傳 true
    checks = checksFn(actual);
  } catch (e) {
    actual = { error: String(e?.message ?? e).slice(0, 200) };
    checks = { "run:no-throw": false };
  }
  const result = Object.fromEntries(Object.entries(checks).map(([k, ok]) => [k, ok ? "PASS" : "FAIL"]));
  const failed = Object.values(checks).filter((ok) => !ok).length;
  lines.push(JSON.stringify({ id, t, ...extra, actual, checks: result, failed }));
  lastActual = actual; // A2-MP-T56 #19：只記錄（place-protect Search Scope 輸出用；不影響判定）
  return failed;
};

let anyFail = false;
let caught = 0, s56pass = 0, protectPass = 0;
for (const c of MAIN) {
  const failed = evalCase(c.id, c.t, tenChecks, { expectNow: c.expect });
  if (failed > 0) anyFail = true;
  if (["S1", "S2", "S3", "S4"].includes(c.id) && failed > 0) caught += 1;
  if (["S5", "S6"].includes(c.id) && failed === 0) s56pass += 1;
}
for (const p of PROTECT) {
  const failed = evalCase(p.id, p.t, p.checks, { expectNow: "PASS(推論)", ...(KNOWN_BASELINE[p.id] ?? {}) }); // A2-MP-T46 #6：只多輸出欄位
  if (failed > 0) anyFail = true; else protectPass += 1;
  if (KNOWN_BASELINE[p.id]) knownSeen.push({ id: p.id, failed }); // A2-MP-T46 #7：只記錄，不影響計算
}
// A2-MP-T46 #8：合法地名保護（獨立群組；不影響 caught／s56pass／protectPass）
let placePass = 0;
for (const p of PLACE_PROTECT) {
  // A2-MP-T53 #16：placeChecksT53＝T46 placeChecks 原檢查＋必要條件（超集合）
  const failed = evalCase(p.id, p.t, placeChecksT53(p), { group: "place-protect", cat: p.cat, name: p.name, src: p.src,
    ...(p.area ? { area: p.area } : {}), ...(p.parentBasis ? { parentBasis: p.parentBasis } : {}),
    ...(p.forbidden ? { forbidden: p.forbidden } : {}), expectNow: p.inferNow }, true);
  if (failed > 0) anyFail = true; else placePass += 1;
  // A2-MP-T56 #19：印出 recommendationSession searchScope／area／parentCity；行政區案三欄皆 null → UNVERIFIED（不當 PASS 依據）
  {
    const a = lastActual ?? {};
    const sc = `searchScope=${a.rsScope ?? "null"} area=${a.rsArea ?? "null"} parentCity=${a.rsParent ?? "null"}`;
    const allNull = [a.rsScope, a.rsArea, a.rsParent].every((v) => v === null || v === undefined);
    ppScopeLines.push(`place-protect search-scope: ${p.id} recommendationSession ${sc}${p.area ? (allNull ? " → Search Scope 未由此流程寫入（UNVERIFIED）" : "（已檢查 T53.searchScope：chat-turn-destination.ts:994-1003 searchScope=area、area＝行政區、parentCity＝父城市）") : "（非行政區案：只輸出）"}`);
  }
}
if (PP_SELF_BAD.length) anyFail = true;
if (PP_T53_SELF_BAD.length) anyFail = true; // A2-MP-T53 #15

// INFO（不計 PASS／FAIL）：否定非地名但含「去」— 讀碼推論現行 travelDestinationCandidates 可能把「人多的地方」當目的地（既有問題，非本案範圍）
try {
  const a = run(CITY, COUNTRY, "我不想去人多的地方");
  lines.push(JSON.stringify({ id: "INFO-neg-crowd", t: "我不想去人多的地方", info: true, actual: a }));
} catch (e) {
  lines.push(JSON.stringify({ id: "INFO-neg-crowd", info: true, error: String(e?.message ?? e).slice(0, 200) }));
}

globalThis.fetch = priorFetch; // A2-MP-T42（M1）：還原為覆寫前的 fetch（Runner 下＝offline-guard 的 fetch）
const extOk = externalCalls === 0;
if (!extOk) anyFail = true;
if (brokenSelfBad.length) anyFail = true; // A2-MP-T42
console.info = oi; console.warn = ow;

lines.push(`BROKEN_RE self-check ${BROKEN_SELF.length - brokenSelfBad.length}/${BROKEN_SELF.length} ${brokenSelfBad.length ? `FAIL（${brokenSelfBad.map((x) => `${x.v}:期望${x.want ? "殘破" : "乾淨"}`).join("、")}）` : "PASS"}`); // A2-MP-T42
lines.push(`UNVERIFIED: 金澤「trusted」狀態（Provider 驗證／Pending／placeId）不在函式層；本檔以 #3～#8 不得寫入金澤為代理`);
lines.push(`UNVERIFIED: #9 recommendationSession.destination 只是「京都可信推薦池」的代理欄位；推薦池實際內容（已顯示／未顯示地點、batch、activeRecommendationContext）不在此函式鏈，未驗證`); // A2-MP-T42
lines.push(`offline-guard=${guardActive ? "present（fetch 轉呼叫 guard，由 guard 記錄並擋下）" : "absent（fetch 一律丟錯，不轉呼叫真實 fetch）"}`); // A2-MP-T42（M1）
lines.push(`UNVERIFIED: 含「去」「換」「改」的合法地名 — repo 內無真實出處，未收錄`);
lines.push(`external fetch=${externalCalls} ${extOk ? "PASS" : "FAIL"}`);
lines.push(`S1-S4 caught=${caught}/4`);
lines.push(`S5-S6 pass=${s56pass}/2`);
lines.push(`protect pass=${protectPass}/${PROTECT.length}`);
// A2-MP-T46 #7：已知基線（標註；不從分母剔除、不改 protect pass）
for (const k of knownSeen) lines.push(`known-baseline: ${k.id}（${KNOWN_BASELINE[k.id].known}；本次 failed=${k.failed}；仍計入 protect pass 分母與 RESULT=FAIL）`);
// A2-MP-T46 #8／#9：合法地名保護（獨立群組）
lines.push(`place-protect fixture self-check ${PP_SELF_BAD.length ? `FAIL（${PP_SELF_BAD.join("、")}）` : "PASS"}`);
for (const u of PP_UNVERIFIED) lines.push(u);
// A2-MP-T53 #15／#11
lines.push(`place-protect T53 self-check ${PP_T53_SELF_BAD.length ? `FAIL（${PP_T53_SELF_BAD.join("、")}）` : "PASS"}`);
for (const u of PP_T53_UNVERIFIED) lines.push(u);
for (const u of ppScopeLines) lines.push(u); // A2-MP-T56 #19
lines.push(`place-protect pass=${placePass}/${PLACE_PROTECT.length}（獨立群組；不併入 protect）`);
lines.push(`RESULT=${anyFail ? "FAIL" : "PASS"}${caught > 0 ? "（S1-S4 Session 污染被抓出：預期中的失敗測試）" : ""}`);
console.log(lines.join("\n"));
process.exit(anyFail ? 1 : 0);
