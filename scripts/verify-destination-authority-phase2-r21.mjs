#!/usr/bin/env node
/**
 * R21 — Destination Authority 全量回歸（A2-MP-T9，tester）。只修正 A2-MP-T8 獨立驗收指出的測試問題（r21 部分：a～e），不重建 Harness。
 *
 * 建立方式（同 r14～r20 模式）：r12–r20 保留不改。r21 在執行期讀入 r20 原文（sha256 必須 = scratchpad/pre-MP9T-test-sha.txt 所記），
 * 套用 R21_R20_PATCHES（r20 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），再以 AsyncFunction 執行。
 * patched r20 照常讀入 r19 → r18 → … → r13（各層 sha 檢查不變）。R21_R13／R14_PATCHES 附加到 R20_R13／R14_PATCHES 之後。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r21）。
 *
 * ★ 測試契約放寬揭露（唯一授權的放寬）：originalUserText 長度上限＝既有 ChatRequest.chatInput max(4000)
 *   （src/lib/ai/service.server.ts；執行期讀出）。這是「相對原版 r19（自創 500 字）的測試契約放寬」：501～4000 字的原句，
 *   原版 r19 判 P1，r20／r21 放行。r20#L1 已做此替換但未揭露；r21 在檔頭、--probe、報告、契約差異中逐處揭露，
 *   並在探針表把「原版 r19（500）單獨」與「r20 實際執行（4000）」分欄列出（不再以 4000 版冒充原版）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r21.diff；契約差異見 scratchpad/r21-mp25r4-contract-diff.md）：
 *  r21-V  版本識別：子程序路徑 r21、摘要行、F7 後變動檔白名單＋r21＋mp25-r4（精確路徑）；AsyncFunction 執行需要的 import 轉換、
 *         r20 自身旗標（--probe／--emit-diff／--check-test-sha／--cross-r4／--r19-parity）停用（改由 r21 處理）。
 *  r21-D  r20SameIdentity（r20 L110-117）的 rawGeographicLabel 改採專案既有 canonical identity：
 *         src/lib/ai/destination-alias-resolver.ts resolveDestinationAlias(x).normalizedName（金澤 record：aliases 金澤／金沢／金泽／Kanazawa）。
 *         主程序以 vite-node 載入正式模組；子程序經 r13 M 物件（同一 vite-node runner）載入。找不到 → INFRA-FAIL（不自創地名規則）。
 *  r21-E  Pending 例外再收緊（只加條件；r19-E ∧ r20-E ∧ r21-E 全部成立才放行；任一不成立 → 原 r14-Δ7 P1，訊息逐字不變）：
 *         E-a parentIntent 必須恰為 "place_recommendation"（缺少或其他值 → 不成立；使用者裁決 1）。
 *         E-b 輪初已存在的同一 Pending：originalUserText 只能與「本程序內實際建立該 Pending 的那一輪原句」比對；
 *             建立輪原句未知（Client 注入／Reload 新程序）→ 不得拿 Pending 自己比自己，改為 fail-closed 絕對檢查：
 *             不得含座標、範圍字樣、既有別名表中 raw／previousConfirmedDestination 以外的城市、不得超過既有上限。
 *         E-c rawGeographicLabel 不得夾帶範圍字樣（半徑／範圍／radius／公里內／距離單位，例：「金澤 半徑3公里」）。
 *         E-d 同一流程（同一 Callback）／同一 User Turn 多次寫入不同內容的 destination_switch Pending → 不成立；
 *             建立輪 confirmationAttempts ≤1、同一 Pending 一輪最多推進 1（同一 User Turn 驗證 ≤1；裁決 3）。
 *         E-e send() 層（Callback 外）或「可信判定未執行／未在 Callback 內評估」的 Pending 寫入，輪末以整輪成本
 *             （Places／Weather／Builder／Credits.begin／credits_* RPC／非 RPC 寫入／weather geocode）跑同一套 r19-E ∧ r20-E ∧ r21-E；
 *             不成立 → r14-A2 P1（「send()：可信目的地未確認仍寫入 Session（r21-E …）」）。
 *  r21-O  只記錄：obs.r21Writes（本輪 destination_switch Pending 寫入，含是否在 Callback 內）、obs.r21SendExc（輪末檢查結果）。
 *  長度／地名上限：同 r20（只引用既有限制；執行期讀出；找不到 → INFRA-FAIL）。
 *  r21-S  （A2-MP-T11）post-MP25 快照允許差異清單擴充：r19 R19_SNAP_EXTRA_OK 加 src/lib/ai/continue-recommendation-intent.ts（理由：使用者授權 MP-25 第四個施工檔案〔情境 18〕；性質：快照允許清單擴充，不涉及任何行為斷言；經 r20 原文層插入 R20_R19_PATCHES 項目，r19 檔案不改）。
 *  r21-F  （A2-MP-T13）F7 預檢施工後版本識別（R21_R13_PATCHES「r21-F」；理由：使用者授權 F7 施工後版本識別；性質：版本識別，不涉及行為斷言）：destination-geographic-clarification.ts／chat-runtime.ts 只在目前 sha1 ＝ post-MP25-sha.txt 該檔 sha1 時不列 unexpected；mp25-post 探針精確檔名；其他 Source 不變。
 *  r21-G  （A2-MP-T14）兩處過時位置比對改為結構檢查（R21_R13_PATCHES「r21-G1」「r21-G2」；只在 work _app.chat.tsx sha1 ＝ post-MP25-sha.txt 時啟用，
 *         其他 sha／其他樹〔mp1／a2／pa2／f10／pre／base〕原檢查逐字不變）：
 *         G1 r13 L2360-2363 G2S1「credits−more < 3000（r17-V F2 扣除）」字元距離 → TypeScript AST 安全契約（順序條件 moreAt<legacyAt<creditsAt 保留）；
 *         G2 r14 L299 R14_A2_WORK_ANCHORS[2]（work 文字 anchor）→ 同一契約。契約 (a)～(f) 見 r21MoreContractCheck；偵測器 12 個變異自檢（記憶體內，不寫檔）。
 *         契約不成立 → 照舊 INFRA-FAIL source anchors（原檢查性質）；啟用且自檢不符 → INFRA-FAIL（偵測器失效）。性質：版本識別＋檢查方式改為結構，不放寬安全斷言。
 *  r21-W  （A2-MP-T15）施工後快照版本識別（性質：版本識別，不涉及行為斷言；理由：使用者授權 MP-25 第 2 輪 R2＋R1 施工，要求建立新快照、不得覆蓋 post-MP25）：
 *         快照檔 R21_P25＝scratchpad/post-MP25-r2-sha.txt（存在時優先；否則 post-MP25-sha.txt）。post-MP25-sha.txt 只讀、不改寫。
 *         W0 採用前提（主程序）：post-MP25-r2 與 post-MP25 同 18 檔清單、差異只在 _app.chat.tsx／destination-geographic-clarification.ts／chat-turn-destination.ts；不符 → INFRA-FAIL（不退回）。
 *         W1 r19 L236 r19Snap 讀 R21_P25（18 檔逐一吻合、清單＝post-MP-r2 等原檢查不變）。
 *         W2 r19 L221-226 R19_SNAP_PATCHES_R17 六個 neu 的檔名 → R21_P25（r16 precheck postMP、r13 postCbSha／postA2Lines／cri anchor／F9 postCB、r14 wantApp.work）。
 *         W3 r19 L256 差異檔：chat-turn-destination.ts 只在「快照＝post-MP25-r2 且 work 該檔 sha1 ＝ 該快照值」時允許（比照 r21-F；R19_SNAP_EXTRA_OK 不變）。
 *         W4 r21-F（F7）與 r21-G（AST 契約啟用條件：work _app sha1 ＝ R21_P25 該檔）改讀 R21_P25；契約 (a)～(f) 與 12 個變異自檢不變。
 *  r21-F2 （A2-MP-T18）F7 施工後版本識別（性質：版本識別，不涉及行為斷言；理由：使用者裁決 E2 授權修改 src/lib/ai/trip-planning-session-reset.ts）：
 *         r21-F 區塊內加一行：只有 scratchpad/post-MP25-E2-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）、且該檔目前 sha1 ＝ 該列時才移出 unexpected；
 *         不存在／缺列／多列／格式不符／sha 不符 → 照舊 INFRA-FAIL。只針對該檔名，其他檔案不放寬（判定 r21E2Decide；--probe 9 個變體自檢）。
 *  r21-C  （A2-MP-T18）離線可控時間（性質：測試基礎設施，不涉及行為斷言）：外掛情境欄位 r21ClockByTurn＝{ turnIndex: 毫秒 }（鍵 0 起算，同 r18GeoByTurn）；
 *         r13 輪次迴圈（r18-G turn index 輸出行之後）加一行守衛插入：只在情境有此欄位時，該輪開始前把子程序 Date.now 設為「原始＋鍵 ≤ 本輪的值總和」，
 *         並記 obs.r21Clock；不實際等待。沒有此欄位的情境不執行該行（Date.now 與 obs 逐字不變）。--probe 乾跑／自檢（無欄位不變、有欄位前進、不等待、累計、不合法丟錯、r13～r20 無此欄位）。
 *         不修改任何安全 Assertion、Fixture、P1 分類、成本上限。
 *  r21-X  （A2-MP-T24）E2 四檔施工後版本識別（性質：版本識別，不涉及行為斷言；理由：使用者授權 E2 四檔施工＋施工後快照 post-MP25-E2-r3-sha.txt＋r21 版本識別）：
 *         X0 R21_P25：post-MP25-E2-r3-sha.txt 存在時優先（其次 r2、再其次 post-MP25；三檔只讀、不改寫）。採用前提（主程序 r21P25R3Decide）：r2 必須存在、
 *            每列「sha1＋兩空白＋相對路徑」且不重複、r3 18 檔且清單＝r2＝post-MP25、r3 相對 r2 差異 ⊆ continue-recommendation-intent.ts／destination-travel-profile.ts／_app.chat.tsx、
 *            相對 post-MP25 差異 ⊆ W0 三檔＋上述兩檔；不符 → INFRA-FAIL（不退回）。r2 的原 W0 前提照跑（對 r2 檔）。--probe 9 個變體自檢。
 *         X2a r19Snap 差異檔：W3 的 ctd 條件「快照＝post-MP25-r2」另接受「快照＝post-MP25-E2-r3」（work sha1 ＝ 快照值的條件不變）。
 *         X2b／X3 destination-travel-profile.ts（r19Snap 差異檔／r16 precheck r19Mp25DiffOk）：只在快照＝post-MP25-E2-r3、恰好一列且 work sha1 相符時允許（r21X3Ok；原條件保留，只加分支）。
 *         X4 F7（r21-F 區塊內加一行，比照 r21-F2）：destination-travel-profile.ts 只在快照＝post-MP25-E2-r3、恰好一列且目前 sha1 相符時移出 unexpected（r21X4Decide；--probe 10 個變體自檢）。
 *         continue-recommendation-intent.ts 沿用既有 postCbSha（W2 → R21_P25）與 r21-S；_app.chat.tsx 沿用 PRE_FILES／wantApp（W2）／r21-G 啟用條件（W4 → R21_P25）；trip-planning-session-reset.ts 沿用 r21-F2。
 *         不修改 P1 分類、Credits 契約、AST 契約 (a)～(f)、任何安全 Assertion 或其訊息。
 *  r21-Z  （A2-MP-T27）E2c 第五、第六個 Source 施工後版本識別（性質：版本識別，不涉及行為斷言；理由：使用者授權第五、第六個 Source（E2c）＋施工後快照＋r21 版本識別）：
 *         Z0 R21_P25：post-MP25-E2-r4-sha.txt 存在時優先（其次 r3、r2、post-MP25；四檔只讀、不改寫）。採用前提（主程序 r21P25R4Decide）：r3 必須存在且通過既有 X0 前提
 *            （r21P25R3Decide 原樣呼叫）、r4 每列「sha1＋兩空白＋相對路徑」且不重複、18 檔且清單＝r3、r4 相對 r3 差異 ⊆ chat-turn-destination.ts；不符 → INFRA-FAIL（不退回）。
 *            r2 的原 W0 前提照跑（對 r2 檔）。--probe 變體自檢。
 *         Z2 r19Snap 差異檔：W3／X2a 的 ctd 條件「快照＝post-MP25-r2／E2-r3」另接受「快照＝post-MP25-E2-r4」（work sha1 ＝ 該快照〔r4〕ctd 列的條件不變 → sha1 綁定改為 r4 值）。
 *         Z3 r21X3Ok（X3／X2b 共用）：destination-travel-profile.ts 的「快照＝post-MP25-E2-r3」另接受「快照＝post-MP25-E2-r4」（讀該快照 dtp 列＝r3 列，由 Z0 保證；恰好一列、sha1 相符條件不變）。
 *         Z4 F7 X4：R21_P25＝r4 時以 r21Z4Decide 判定（r4 dtp 列；r21X4Decide 本身與其 10 個自檢不變）。
 *         Z5 F7（r21-F 區塊內加一行，比照 r21-F2）：src/lib/ai/travel-context.ts（不在 pre-G2S1 快照；E2c 修改後出現在 nowChanged → unexpected）只在
 *            scratchpad/post-MP25-E2c-sha.txt 存在、含該檔恰好一列、且目前 sha1 相符時移出 unexpected（r21Z5Decide；--probe 變體自檢）。
 *         Z6 （指派者核准；先例 r12-Δ3）r13 L2396 CB_CTD_ANCHORS[0]（work ctd 逐字 import anchor）：只在 R21_P25＝r4、含 ctd 恰好一列且 work ctd sha1 ＝ 該列（f0c62632…）時，
 *            改用「matchesContinueRecommendationGrammar,\n 之後多一行 '  parseNegatedDestinationSwitch,\n'」的逐字 anchor；其他 sha1 一律原 anchor。
 *            「pre-CB 備份 ctd 已含 CB 文字」原檢查行不改；Z6 啟用時另以原 anchor 對 pre-CB 備份做同一反向檢查（Z6b）。錨點缺失／原文不符 → INFRA-FAIL。--probe 變體自檢。
 *         chat-turn-destination.ts 其餘 sha 檢查（r16 precheck postMP、r13 F9 postCB）沿用 W2 → R21_P25（＝r4）。不修改 P1 分類、Credits 契約、AST 契約 (a)～(f)、任何安全 Assertion 或其訊息。
 *  r21-Y  （A2-MP-T31）E2d／E2e／E2f 施工後版本識別（性質：版本識別，不涉及行為斷言；理由：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別）：
 *         Y0 R21_P25：post-MP25-E2-r5-sha.txt 存在時優先（r5>r4>r3>r2>r1；五檔只讀、不改寫；選擇式抽成 r21P25Pick，r5 不存在 → 與原式相同）。採用前提（主程序 r21P25R5Decide）：
 *            r4 必須存在且通過既有 Z0 前提（r21P25R4Decide 原樣呼叫，含 X0）、r5 每列「sha1＋兩空白＋相對路徑」且不重複、18 檔且清單＝r4、r5 相對 r4 差異 ⊆ _app.chat.tsx；
 *            不符 → INFRA-FAIL（不退回）。r2 的原 W0 前提照跑（對 r2 檔）。--probe 變體自檢。
 *         Y2 r19Snap 差異檔：Z2 的 ctd 條件另接受「快照＝post-MP25-E2-r5」（work sha1 ＝ s25.get(ctd) 不變；s25＝r5，r5 ctd 列＝r4 由 Y0 保證）。
 *         Y3 r21X3Ok：dtp 的「快照＝r3／r4」另接受「快照＝r5」（r5 dtp 列＝r4＝r3 由 Y0 保證；恰好一列、sha1 相符條件不變）。
 *         Y4 F7 X4：R21_P25＝r5 時以 r21Y4Decide 判定（r5 dtp 列；非 r5 → 原樣轉呼叫 r21Z4Decide，Z4／X4 不變）。
 *         Y5 F7（r21-F 區塊內加一行，比照 r21-Z5）：src/lib/ai/trip-planning-context.ts／src/lib/chat-planning-flow.ts／src/lib/recommendation/trip-intent.ts（皆不在 pre-G2S1 快照；
 *            E2d／E2e 修改後出現在 nowChanged → unexpected）只在 scratchpad/post-MP25-E2f-sha.txt 存在、含該檔恰好一列、且目前 sha1 相符時移出 unexpected（逐檔判定 r21Y5Decide；
 *            只針對這三個檔名，其他檔案不放寬；--probe 變體自檢）。
 *         Y6 r13 L2396 CB_CTD_ANCHORS[0]（Z6）：R21_P25＝r5 時以 r21Y6Decide 判定（r5 ctd 列＝r4 列 f0c62632…，同一 E2c 版逐字 anchor；sha1 不符 → 原 anchor）；非 r5 → 原樣轉呼叫 r21Z6Decide。
 *            Z6b 反向檢查不變。Z6 --probe「實際 work」列改經 r21Y6Decide（r5 以外與原式相同）。
 *         _app.chat.tsx：W2（r16 precheck／r14 wantApp.work）與 r21-G 啟用條件（W4）讀 R21_P25＝r5 → 綁定 r5 _app sha1（802eed63…）；AST 契約 (a)～(f) 與 12 個變異自檢不變。
 *         不修改 P1 分類、Credits 契約、AST 契約 (a)～(f) 的判定邏輯、任何安全 Assertion 或其訊息；不放寬既有比對條件（只加「快照＝r5」分支）。
 *  r21-T34（A2-MP-T34）歷史快照遺失 → 舊樹 MISSING／UNVERIFIED（性質：測試基礎設施；不冒充、不放寬、不以其他樹頂替）：
 *         T0 群組判定 r21T34Decide：pre／pre5／pre4／f9／f10（各樹 overlay 與其 sha 快照）及歷史 anchor 輔助檔（F7hist／L1hist）。群組內檔案「全部不存在」→ MISSING；
 *            「部分存在」→ INFRA-FAIL（不降級）；「全部存在」→ 原檢查逐字執行（sha 不符照舊 INFRA-FAIL）。work／base／a2／mp1／pa2 不屬任何群組（所需檔缺失照舊 INFRA-FAIL）。
 *         T1～T6 r13 執行內容：凡讀取 MISSING 群組檔案的檢查改為「miss(樹) → 記 UNVERIFIED、不執行；否則原敘述逐字執行」（原敘述逐字保留於新增行，--probe 結構自檢）；
 *            MISSING 樹自 TREES 移除（不建樹、不跑情境）；judge 的 r4-SRC（work 與 pre 比對的 P1 斷言）在 pre MISSING 時逐輪記 UNVERIFIED（不計 PASS、也不自創 P1）。
 *         T2／T3 範圍守門（r13 L2144-2171，基準＝pre-G2S1-sha.txt）：pre MISSING 時 shaDiff／inSnap 為空（不讀、不冒充快照），nowChanged 每一檔都必須被既有允許清單
 *            或「T34 後備」放行，否則照舊 INFRA-FAIL。T34 後備只做嚴格 sha 綁定：src＝R21_P25 該列 sha1 相符；scripts/verify-*.mjs＝pre-MP9T-test-sha.txt 該列 sha256 相符；
 *            快照不存在 → INFRA-FAIL。G2S1 起算的來源鏈（R21_P25／pre-MP9T 內容 ⊆ G2S1 後授權變更）無法重新證明 → UNVERIFIED（報告逐項列出）。
 *         T7 報告：舊樹 MISSING 表（需要的快照 → 現狀 → 失去的比較能力）、UNVERIFIED 檢查逐項（實際跳過次數）、pre 相依輸出區段改標 UNVERIFIED（規則必須恰好命中 1 次，否則 INFRA-FAIL）；
 *            摘要行 → 「非全量（舊樹 MISSING → 非全量）」，不得顯示 PASS。T8 結束碼：P1／失敗 → 1（不變）；否則舊樹 MISSING → 2（非全量）；完整 → 0。
 *         不修改 P1／SAFETY 分類、Credits 契約、Provider 成本限制、Destination Authority、負向證據 Assertion、既有 Fixture 的測試意圖；不建立假檔、不寫任何快照。
 *  不變：r13～r20 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類。外部請求攔截同 r13。
 *
 * 執行（每次只跑一份）：
 *   node scripts/verify-destination-authority-phase2-r21.mjs --brief --pa2 --a2 --mp1 [--only=ID,…] [--extra-scenarios=…] --out=<scratchpad>/x.log
 *   node scripts/verify-destination-authority-phase2-r21.mjs --probe [--out=…]        （預設 scratchpad/r21-probe.log）
 *   node scripts/verify-destination-authority-phase2-r21.mjs --r19-parity [--out=…]   （預設 scratchpad/r21-parity.log；比對原版 r19 r19-subset-T6.log 與 r20-parity-r19subset.log）
 *   node scripts/verify-destination-authority-phase2-r21.mjs --cross-r4 [--out=…]     （預設 scratchpad/mp-cross-r4-r21.log；比對 mp-cross-r4-r20.log）
 *   node scripts/verify-destination-authority-phase2-r21.mjs --emit-diff              （寫 scratchpad/r21.diff、r21.* 執行內容、r21-mp25r4-contract-diff.md）
 *   node scripts/verify-destination-authority-phase2-r21.mjs --check-test-sha         （scripts/verify-*.mjs 對照 pre-MP9T-test-sha.txt）
 * 結束碼（r21-T34）：1＝P1／失敗／INFRA；2＝無 P1 但舊樹 MISSING（非全量，不得視為 PASS）；0＝完整且無 P1。
 *  r21-T40（A2-MP-T40）只調整報告呈現（判定、結束碼、P1、Credits、Provider、安全 Assertion、Destination Authority、負向證據、Fixture 不變）：
 *         本次要求且 MISSING 的 pre／pre5／pre4／f9／f10，其 r13／r14 區段在原位置補「標題 =MISSING【UNVERIFIED】」（錨點恰好 1 次，否則 INFRA-FAIL）；
 *         R9／R10 pre 標題 =N → =MISSING；未要求的樹（例：未帶 --f10）不顯示為 MISSING（r14 摘要 f10 P1=-；逐項表列「未要求」），
 *         但其快照相依檢查若本次實際被跳過（B1～B11 等）仍列 UNVERIFIED。逐項見 R21_CONTRACT r21-T40a～i；--probe T40 自檢。
 *  r21-T42（A2-MP-T42）只調整報告呈現：「本次未要求該樹、但相依檢查已跳過」由「舊樹 MISSING：」之後移到獨立欄位「相依檢查 UNVERIFIED：f9,f10」
 *         （標頭／verdictTag／總判定／summary 皆接在「→ 非全量」之後）；註解行號更正為 r14 L933-936。逐項見 R21_CONTRACT r21-T42a～d；--probe T42 自檢。
 *  r21-T47（A2-MP-T47）範圍守門版本識別（性質：版本識別，不涉及行為斷言；理由：使用者裁決「僅允許 scripts/verify-negated-switch-s1s4.mjs；以已審查的精確 SHA-256 作為版本識別；
 *         不得使用 scripts/** 通配放行；SHA 不符：INFRA-FAIL」）：r21-F 區塊（r13 L2158 nowChanged／L2170 unexpected 之後）加一行 r21#N1：只有 nowChanged 含逐字相同的
 *         scripts/verify-negated-switch-s1s4.mjs 時判定；目前 sha256 ＝ 常數 R21_T47_SHA256 ＝ scratchpad/R21_T47_SNAP（r21-T64 起＝T64-new-sha.txt）該路徑恰好一列（sha256＋兩空白＋相對路徑）才移出 unexpected；
 *         清單不存在／缺列／多列／格式不符／常數與清單不一致／檔案不存在／sha 不符 → preInfra（INFRA-FAIL）；不在 nowChanged → 不處理（判定 r21T47Decide；--probe 變體自檢）。
 *         只比對精確字串；scopeFallback、pre-MP9T、R21_P25、其他白名單不變。逐項見 R21_CONTRACT r21-T47a～e。
 *  r21-T54（A2-AUDIT-8）重新綁定 r21-T47：s1s4 於 T53 改版 → 常數 R21_T47_SHA256 改為 9bdce0b9…80c79b、清單改為 scratchpad/T53-new-sha.txt
 *         （T54 版：判定 r21T47F7 不再讀取 T46-new-sha.txt；只有 --probe T47 自檢唯讀讀取 T46-new-sha.txt 作為過時清單代入、證明判 INFRA；任何模式都不修改）；
 *         判定邏輯不變；舊 sha 1b94b01d…afb090 一律 INFRA-FAIL（--probe T47 自檢）。逐項見 R21_CONTRACT r21-T54。
 *  r21-T56（任務單 #56 後續）重新綁定 r21-T47：s1s4 於 T56 改版 → 常數 R21_T47_SHA256 改為 d0a248bd…e12a758、清單改為 scratchpad/T56-new-sha.txt；
 *         判定 r21T47F7 只讀 T56-new-sha.txt；--probe T47 自檢唯讀讀取 T53-new-sha.txt 作為過時清單代入（判 INFRA），不再讀取 T46-new-sha.txt；T46／T53 清單皆不修改。
 *         上一版 9bdce0b9…80c79b（R21_T47_OLD_SHA256）與最舊 1b94b01d…afb090（R21_T47_OLDEST_SHA256）皆只供 --probe 自檢、一律 INFRA-FAIL；r21T47Decide 逐字不變。逐項見 R21_CONTRACT r21-T56。
 *         （r21-T56／r21-T61 段描述的是各自當時的狀態；目前綁定見 r21-T64。）
 *  r21-T61（任務單 #61 後續）重新綁定 r21-T47：s1s4 於 T61 改版 → 常數 R21_T47_SHA256 改為 64b78544…0aed225、清單改為 scratchpad/T61-new-sha.txt；
 *         判定 r21T47F7 只讀 T61-new-sha.txt；--probe T47 自檢唯讀讀取 T56-new-sha.txt 作為過時清單代入（判 INFRA），不再讀取 T46／T53-new-sha.txt；T46／T53／T56 清單皆不修改。
 *         上一版 d0a248bd…e12a758（R21_T47_OLD_SHA256）、上上版 9bdce0b9…80c79b（新增 R21_T47_OLDER_SHA256）、最舊 1b94b01d…afb090（R21_T47_OLDEST_SHA256）
 *         皆只供 --probe 自檢、一律 INFRA-FAIL；r21T47Decide 逐字不變；無新增白名單、無萬用字元。逐項見 R21_CONTRACT r21-T61。
 *  r21-T64（任務單 #64 後續）重新綁定 r21-T47：s1s4 於 T64 改版 → 常數 R21_T47_SHA256 改為 d20c0014…e10f4fb、清單改為 scratchpad/T64-new-sha.txt；
 *         判定 r21T47F7 只讀 T64-new-sha.txt；--probe T47 自檢唯讀讀取 T61-new-sha.txt 作為過時清單代入（判 INFRA）；T46／T53／T56／T61 清單皆不修改。
 *         舊 sha：上一版 64b78544…0aed225（R21_T47_OLD_SHA256）、上上版 d0a248bd…e12a758（R21_T47_OLDER_SHA256）、第三舊 9bdce0b9…80c79b（新增 R21_T47_OLDER2_SHA256）、
 *         最舊 1b94b01d…afb090（R21_T47_OLDEST_SHA256），皆只供 --probe 自檢；四者套用同一組檢查（目前檔案／清單列／注入常數／全為舊，後三者皆要求「常數與清單不一致」原因正則；T63 第 3 項）。
 *         r21T47Decide 逐字不變；無新增白名單、無萬用字元。逐項見 R21_CONTRACT r21-T64。
 *  r21-A2SRC（任務單 #104，A2 方案 A）範圍守門版本識別（性質：版本識別，不涉及行為斷言；理由：任務單 #104「只新增一項精確白名單，放行 scripts/verify-a2-source-scenarios.mjs
 *         （定版 sha256 bb33aa71…57d83677）；不得使用 glob／regex 擴大放行」）：完全比照 r21-T47。r21-F 區塊（r13 L2158 nowChanged／L2170 unexpected 之後）在 r21#N1 行之後加一行 r21#N2：
 *         只有 nowChanged 含逐字相同的 scripts/verify-a2-source-scenarios.mjs 時判定；常數 R21_A2SRC_SHA256 為 64 位小寫十六進位、scratchpad/A2SRC-new-sha.txt（R21_A2SRC_SNAP）存在、
 *         該路徑恰好一列且逐字為「sha256＋兩空白＋相對路徑」、該列＝常數、目前檔案存在且 sha256＝常數，才移出 unexpected；
 *         清單不存在／缺列／多列／格式不符／常數格式錯／常數與清單不一致（舊版冒充）／檔案不存在／sha 不符 → preInfra（INFRA-FAIL）；其他檔名（大小寫、副檔名、前後綴不同）不觸發、照舊 INFRA-FAIL；
 *         不在 nowChanged → 不處理（判定 r21A2SrcDecide；--probe r21-A2SRC 變體自檢，純函式注入、不建立或修改任何檔案）。
 *         只比對精確字串；不利用 r13 L2169 既有 regex；scopeFallback、pre-MP9T、R21_P25、r21-T47 與其他白名單不變。逐項見 R21_CONTRACT r21-A2SRC。
 * 所有輸出模式：輸出只能在 scratchpad，且拒絕覆蓋任何既有檔案（啟動時 scratchpad 內的所有 *.log／*.stdout 以及任何已存在的目標檔）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R20_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r20.mjs`;
const R19_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r19.mjs`;
const SELF = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r21.mjs`;
const SELF_REL = "scripts/verify-destination-authority-phase2-r21.mjs";
const MP25_R4 = "scripts/verify-more-places-destination-switch-mp25-r4.mjs";
const MP25_R2 = "scripts/verify-more-places-destination-switch-mp25-r2.mjs";
const CROSS_R4 = "scripts/verify-more-places-cross-destination-r4.mjs";
const TEST_SHA_FILE = `${PRE_DIR}/pre-MP9T-test-sha.txt`; // A2-MP-T9 開始前的 scripts sha256 快照（574 支）
const ALIAS_REL = "src/lib/ai/destination-alias-resolver.ts";
// r21-W（A2-MP-T15）：施工後快照版本識別。post-MP25-r2-sha.txt（MP-25 第 2 輪施工後）存在時優先；post-MP25-sha.txt 本身只讀、不改寫。
const R21_P25_R1 = "post-MP25-sha.txt";
const R21_P25_R2 = "post-MP25-r2-sha.txt";
// r21-X0（A2-MP-T24）：E2 四檔施工後快照 post-MP25-E2-r3-sha.txt（與 post-MP25-r2 同 18 檔清單）存在時再優先；r2／r1 只讀、不改寫。性質：版本識別，不涉及行為斷言。
const R21_P25_R3 = "post-MP25-E2-r3-sha.txt";
// r21-Z0（A2-MP-T27）：E2c 施工後快照 post-MP25-E2-r4-sha.txt（與 r3 同 18 檔清單、只允許 chat-turn-destination.ts 一列不同）存在時再優先；r3／r2／r1 只讀、不改寫。性質：版本識別，不涉及行為斷言。
const R21_P25_R4 = "post-MP25-E2-r4-sha.txt";
// r21-Y0（A2-MP-T31）：E2f 施工後快照 post-MP25-E2-r5-sha.txt（與 r4 同 18 檔清單、只允許 _app.chat.tsx 一列不同）存在時再優先；r4／r3／r2／r1 只讀、不改寫。性質：版本識別，不涉及行為斷言。
const R21_P25_R5 = "post-MP25-E2-r5-sha.txt";
/** r21-Y0：施工後快照選擇（純函式；has(name)＝該快照檔是否存在）。r5 不存在 → 與原式「r4 存在 ? r4 : r3 存在 ? r3 : r2 存在 ? r2 : r1」相同。 */
function r21P25Pick(has) {
  return has(R21_P25_R5) ? R21_P25_R5 : has(R21_P25_R4) ? R21_P25_R4 : has(R21_P25_R3) ? R21_P25_R3 : has(R21_P25_R2) ? R21_P25_R2 : R21_P25_R1;
}
const R21_P25 = r21P25Pick((n) => existsSync(`${PRE_DIR}/${n}`)); // r21#Y0：原式（r21#Z0／X0 的 r4>r3>r2>r1 巢狀三元式）移入 r21P25Pick 並在最前加 r5 判斷
const R21_P25_FILE = `${PRE_DIR}/${R21_P25}`;
const R21_CTD_REL = "src/lib/ai/chat-turn-destination.ts";
/** post-MP25-r2 相對 post-MP25 只允許差異的三檔（MP25-R2-construction.diff）；其他檔不同 → INFRA-FAIL（不採用 r2 快照）。 */
const R21_P25_R2_DIFF_OK = ["src/routes/_app.chat.tsx", "src/lib/ai/destination-geographic-clarification.ts", R21_CTD_REL];
const R21_DTP_REL = "src/lib/ai/destination-travel-profile.ts"; // r21-X（A2-MP-T24）
/** r21-X0：post-MP25-E2-r3 相對 post-MP25-r2 只允許差異的三檔（E2-construction.diff 四檔中在 18 檔清單內者；trip-planning-session-reset.ts 不在清單內，由 r21-F2 處理）。 */
const R21_P25_R3_DIFF_OK = ["src/lib/ai/continue-recommendation-intent.ts", R21_DTP_REL, "src/routes/_app.chat.tsx"];
/** r21-X0：post-MP25-E2-r3 相對 post-MP25 的允許差異＝R21_P25_R2_DIFF_OK ＋continue-recommendation-intent.ts＋destination-travel-profile.ts（W0 允許清單相應擴充）。 */
const R21_P25_R3_VS_R1_OK = [...R21_P25_R2_DIFF_OK, "src/lib/ai/continue-recommendation-intent.ts", R21_DTP_REL];
/** r21-Z0（A2-MP-T27）：post-MP25-E2-r4 相對 post-MP25-E2-r3 只允許差異的一檔（E2c-construction.diff 兩檔中在 18 檔清單內者；travel-context.ts 不在清單內，由 r21-Z5 處理）。 */
const R21_P25_R4_DIFF_OK = [R21_CTD_REL];
const R21_TC_REL = "src/lib/ai/travel-context.ts"; // r21-Z5（A2-MP-T27）
const R21_E2C_SNAP = "post-MP25-E2c-sha.txt"; // r21-Z5（A2-MP-T27）：只讀
/** r21-Y0（A2-MP-T31）：post-MP25-E2-r5 相對 post-MP25-E2-r4 只允許差異的一檔（E2f-construction.diff；E2d／E2e 三檔不在 18 檔清單內，由 r21-Y5 處理）。 */
const R21_P25_R5_DIFF_OK = ["src/routes/_app.chat.tsx"];
const R21_E2F_SNAP = "post-MP25-E2f-sha.txt"; // r21-Y5（A2-MP-T31）：只讀
/** r21-Y5（A2-MP-T31）：E2d／E2e 授權的三個 Source（皆不在 pre-G2S1 快照）；只針對這三個檔名。 */
const R21_E2F_RELS = ["src/lib/ai/trip-planning-context.ts", "src/lib/chat-planning-flow.ts", "src/lib/recommendation/trip-intent.ts"];
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");
const IS_CHILD = process.env.VERIFY_P2R3_ROLE === "collect";
const argOut = () => process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;
const uniq = (a) => [...new Set(a)];

// ════════════════════════ r21-T34（A2-MP-T34）：歷史快照遺失 → 舊樹 MISSING／UNVERIFIED ════════════════════════
/**
 * 性質：測試基礎設施（不涉及行為斷言；不冒充、不放寬）。群組＝某棵舊樹（或歷史 anchor 檢查）所需的 scratchpad 快照檔。
 * 判定（純函式 r21T34Decide；exists＝路徑注入，--probe 以記憶體內變體自檢）：全部不存在 → MISSING；部分存在 → PARTIAL（INFRA-FAIL，不降級）；全部存在 → PRESENT（原檢查逐字執行）。
 * work／base／a2／mp1／pa2 不屬任何群組：miss() 恆為 false，所需檔缺失照舊 INFRA-FAIL。
 */
const R21_T34_GROUPS = [
  { tree: "pre", label: "pre(F7 前＝F6)", flag: null, files: ["chat-turn-destination.pre-G2S1.ts", "_app.chat.pre-G2S1.tsx", "pre-G2S1-sha.txt"], lost: "pre（G2S1 前＝L-1）樹全部情境×mode 執行與 P1（含舊樹應出現 P1 的負向證據）；work 相對 pre 新增／消除 P1；Provider work/pre；R9／R10 pre P1；r4-SRC（source≠user 輪次 work＝pre）；pre 樹 source anchors；G2S1 前後 ctd／_app 反向 anchor；範圍守門的 G2S1 基準（shaDiff／inSnap）" },
  { tree: "pre5", label: "pre5(F5 前)", flag: "--pre5", files: ["chat-turn-destination.pre-F5.ts", "_app.chat.pre-F5.tsx"], lost: "pre5（F5 前）樹執行與 P1、pre5 source anchors（僅 --pre5）" },
  { tree: "pre4", label: "pre4(F4 前)", flag: "--pre4", files: ["chat-turn-destination.pre-F4.ts", "_app.chat.pre-F4.tsx"], lost: "pre4（F4 前）樹執行與 P1、pre4 source anchors（僅 --pre4）" },
  { tree: "f9", label: "f9(F10 前)", flag: "--f9", files: ["chat-turn-destination.pre-F10.ts", "_app.chat.pre-F10.tsx", "pre-F10-sha.txt"], lost: "f9（F10 前＝G2S1）樹執行與 P1、work 相對 f9；F9 備份 G2S1 ctd anchors；F10 前備份不含 F10 文字／含 G2S1 anchor；F10 前備份＝pre-F10 sha" },
  { tree: "f10", label: "f10(CB 前)", flag: "--f10", files: ["chat-turn-destination.pre-CB.ts", "continue-recommendation-intent.pre-CB.ts", "pre-CB-sha.txt", "post-F10-sha.txt"], lost: "f10（CB 前＝F10）樹執行與 P1、work 相對 f10（r11／r14）；pre-CB 備份反向 CB anchors（含 r21-Z6b）；work cri 舊文法凍結比對；pre-CB cri＝pre-CB sha＝HEAD；F10 版（pre-CB ctd、_app.chat.pre-A2.tsx）＝post-F10 sha" },
];
const R21_T34_AUX = [
  { tree: "F7hist", label: "F7 前 rcl 備份", flag: null, files: ["resolve-chat-location.pre-F7.ts"], lost: "r13 L2553-2559：F7 前 resolve-chat-location 備份不含 F8 文字／含 F7 前 city 補值（work 自身的 F8 文字檢查保留）" },
  { tree: "L1hist", label: "pre-L1 _app 備份", flag: null, files: ["_app.chat.pre-L1.tsx"], lost: "r13 L2564-2567：pre-L1 備份含 F8 catch anchor／F8 anchors（work「不得再含 F8 catch anchor」檢查保留）" },
];
const R21_T34_GEO_F4 = "destination-geographic-clarification.pre-F4.ts"; // r13 L2136-2139 原本即「不存在 → 不檢查」（行為不變；只揭露現狀）
/** 依 r13 行號列出：每一項因群組 MISSING 而不執行的檢查（patch 以 unv(id) 記實際跳過次數）。 */
const R21_T34_LOST = [
  { id: "S1", trees: ["pre", "pre5", "pre4"], where: "r13 L2130-2135", what: "pre／pre5／pre4 備份存在且與現行檔不同（樹前提）" },
  { id: "S2", trees: ["pre"], where: "r13 L2144-2153", what: "pre-G2S1 sha 快照比對（shaDiff；報告「F5 前 sha 快照比對」）" },
  { id: "S3", trees: ["pre"], where: "r13 L2154-2171", what: "範圍守門以 pre-G2S1 快照為基準（inSnap 豁免）→ 改由 T34 後備嚴格 sha 綁定；G2S1 起算來源鏈無法重新證明" },
  { id: "S4", trees: ["pre"], where: "r13 L2172-2178", what: "PRE_FILES 在快照內必須已被修改／不在快照則 pre 備份＝HEAD" },
  { id: "S5", trees: ["pre"], where: "r13 L2179-2183", what: "pre 備份 sha1＝pre-G2S1 快照" },
  { id: "A1", trees: ["f9"], where: "r13 L2353", what: "F10 前備份 ctd 含 G2S1 ctd anchors（訊息字樣「work ctd」）" },
  { id: "A2", trees: ["pre"], where: "r13 L2354、L2356", what: "pre ctd 不得含 G2S1 文字／snapshotAreaScope（反向）" },
  { id: "A3", trees: ["pre"], where: "r13 L2357-2358", what: "pre _app 不得含 G2S1 legacyLabel／必須含 G2S1 前 isUnconfirmed anchor" },
  { id: "A4", trees: ["pre"], where: "r13 L2463-2471", what: "pre 樹 source anchors（ANCHORS.pre）" },
  { id: "A5", trees: ["pre5", "pre4"], where: "r13 L2463-2471", what: "pre5／pre4 樹 source anchors（僅 --pre5／--pre4）" },
  { id: "B1", trees: ["f10"], where: "r13 L2402＋r21-Z6b", what: "pre-CB 備份 ctd 不得含 CB anchors（反向）" },
  { id: "B2", trees: ["f10"], where: "r13 L2406", what: "pre-CB 備份 cri 不得含 analyzeContinueRecommendationStructure" },
  { id: "B3", trees: ["f10"], where: "r13 L2407-2411", what: "work cri 去掉 CB 區塊後＝pre-CB 備份（舊文法凍結；只保留 work 自身可判定的起訖標記檢查）" },
  { id: "B4", trees: ["f10"], where: "r13 L2416", what: "pre-CB 備份 ctd 含 F10 ctd anchors（訊息字樣「work ctd」）" },
  { id: "B5", trees: ["f9"], where: "r13 L2417", what: "F10 前備份 ctd 不得含 F10 文字" },
  { id: "B6", trees: ["f10"], where: "r13 L2419", what: "pre-CB 備份 ctd 不得含 snapshotAreaScope（訊息字樣「work ctd」）" },
  { id: "B7", trees: ["f9"], where: "r13 L2422（r14-Δ6 版）", what: "F10 前備份 _app 不得含 F10 文字" },
  { id: "B8", trees: ["f9"], where: "r13 L2425", what: "F10 前備份 _app 必須含 G2S1 anchor" },
  { id: "B9", trees: ["f10"], where: "r13 L2436", what: "pre-CB 備份 cri sha1＝pre-CB 快照" },
  { id: "B10", trees: ["f10"], where: "r13 L2437", what: "pre-CB 備份 cri＝HEAD" },
  { id: "B11", trees: ["f10"], where: "r13 L2446", what: "F10 版（pre-CB ctd；_app.chat.pre-A2.tsx）sha1＝post-F10 快照（pa2 _app 仍以 r14 wantApp.pa2＝pre-A2-sha 綁定）" },
  { id: "B12", trees: ["f9"], where: "r13 L2447", what: "F10 前備份 sha1＝pre-F10 快照" },
  { id: "C1", trees: ["pre"], where: "r13 L2543-2545", what: "pre(F6) turnStartSession 呼叫次數" },
  { id: "C2", trees: ["pre"], where: "r13 L2548", what: "pre(L-1) 必須含 F8 文字" },
  { id: "C3", trees: ["F7hist"], where: "r13 L2557、L2559", what: "F7 前 rcl 備份不得含 F8 文字／必須含 F7 前 city 補值" },
  { id: "C4", trees: ["L1hist"], where: "r13 L2565、L2567", what: "pre-L1 備份含 F8 catch anchor／F8 anchors" },
  { id: "J1", trees: ["pre"], where: "r13 L3407-3411 judge(work)", what: "r4-SRC P1 斷言：source≠user 輪次 work 行為＝pre（逐輪記 UNVERIFIED；不計 PASS、不自創 P1）" },
  { id: "R1", trees: ["pre"], where: "r13 L3899-4166 報告", what: "work vs pre：新增／消除 P1、Provider work/pre、情境×mode work/pre、P1 計數 pre、R9／R10 pre P1、r9 G2S1 probe pre、r10／r9 總表 pre 欄" },
  { id: "R2", trees: ["f10"], where: "r13 L4133-4141、r14 L933-936、r16／r17 P1 表", what: "work 相對 f10（CB 前）新增／消除 P1（僅 --f10）" },
  { id: "R3", trees: ["f9"], where: "r13 L4125-4132", what: "work 相對 f9（F10 前）新增／消除 P1（僅 --f9）" },
  { id: "R4", trees: ["pre5", "pre4"], where: "r13 L3992-3993、L4012", what: "pre5／pre4 P1（僅 --pre5／--pre4）" },
  { id: "E1", trees: ["pre", "pre5", "pre4", "f9", "f10"], where: "r13 L3053 TREES／L3114 jobs／L3150-3169 overlay 生效檢查", what: "舊樹本身的建樹、情境×mode 執行與 overlay 生效檢查（不建樹、不跑）" },
];
function r21T34Decide(exists) {
  const st = {};
  const infra = [];
  for (const g of [...R21_T34_GROUPS, ...R21_T34_AUX]) {
    const paths = g.files.map((f) => `${PRE_DIR}/${f}`);
    const present = paths.filter((p) => exists(p) === true);
    const absent = paths.filter((p) => exists(p) !== true);
    const status = absent.length === 0 ? "PRESENT" : present.length === 0 ? "MISSING" : "PARTIAL";
    st[g.tree] = { status, present, absent };
    if (status === "PARTIAL") infra.push(`INFRA-FAIL r21-T34 ${g.tree} 快照不完整（存在 ${present.map((p) => p.split("/").pop()).join("、")}；不存在 ${absent.map((p) => p.split("/").pop()).join("、")}）：部分存在不得降級為 MISSING`);
  }
  return { st, infra };
}
const r21T34Rows = (text, re) => {
  const m = new Map();
  const dup = new Set();
  for (const line of String(text).split("\n")) {
    const x = line.match(re);
    if (!x) continue;
    if (m.has(x[2])) dup.add(x[2]);
    m.set(x[2], x[1]);
  }
  for (const d of dup) m.delete(d); // 重複列 → 不放行（fail-closed）
  return m;
};
/** T34 狀態物件（dec＝r21T34Decide 結果；io＝路徑注入，--probe 以記憶體內變體自檢）。 */
function r21T34Make(dec, io) {
  const T = {
    dec,
    hits: new Map(),
    ranTrees: null,
    dropped: [],
    scope: null,
    annotated: null,
    miss(tree) {
      const s = T.dec.st[tree];
      return Boolean(s) && s.status === "MISSING";
    },
    missLabel(label) {
      const g = R21_T34_GROUPS.find((x) => x.label === label);
      if (!g) throw new Error(`INFRA-FAIL r21-T34：未知的群組標籤 ${label}`);
      return T.miss(g.tree);
    },
    unv(ids, detail) {
      for (const id of [].concat(ids)) {
        const h = T.hits.get(id) ?? { n: 0, details: [] };
        h.n += 1;
        if (detail != null && h.details.length < 200) h.details.push(String(detail));
        T.hits.set(id, h);
      }
    },
    missingTrees: () => [...R21_T34_GROUPS, ...R21_T34_AUX].filter((g) => T.miss(g.tree)).map((g) => g.tree),
    nonFull: () => T.missingTrees().length > 0,
    /** r21#T40（A2-MP-T40；只調整報告呈現）：本次是否要求該樹（flag＝null → 固定要求；否則 argv 含該旗標）。io.argv＝--probe 注入；未注入 → process.argv。不影響 miss()／nonFull()／結束碼。 */
    requested(tree) {
      const g = [...R21_T34_GROUPS, ...R21_T34_AUX].find((x) => x.tree === tree);
      return !g || !g.flag || (io.argv ? io.argv() : process.argv).includes(g.flag);
    },
    /** r21#T40：呈現用。req＝本次要求且 MISSING 的樹；dep＝本次未要求、但其快照相依檢查本次實際被跳過（UNVERIFIED 次數 >0）的樹；其餘未要求的 MISSING 樹不顯示為 MISSING（只在 r21-T34 區段狀態表列「否（旗標未指定）」）。 */
    shownMissing() {
      const req = T.missingTrees().filter((t) => T.requested(t));
      const dep = T.missingTrees().filter((t) => !T.requested(t) && R21_T34_LOST.some((x) => x.trees.includes(t) && (T.hits.get(x.id)?.n ?? 0) > 0));
      return { req, dep };
    },
    /** r21#T42（A2-MP-T42；只調整呈現）：只列「本次要求且 MISSING」的樹；「未要求但相依檢查已跳過」移到獨立欄位 depText()（原接在「舊樹 MISSING：」之後）。 */
    missText() {
      const { req } = T.shownMissing();
      return req.join(",") || "-";
    },
    /** r21#T42：獨立欄位「相依檢查 UNVERIFIED：f9,f10」（本次未要求該樹、但其歷史快照相依檢查本次實際被跳過）；沒有 → ""。 */
    depText() {
      const { dep } = T.shownMissing();
      return dep.length ? `相依檢查 UNVERIFIED：${dep.join(",")}` : "";
    },
    /** r21#T42：depText 的前綴版（「；相依檢查 UNVERIFIED：…」或 ""），供各輸出位置接在「→ 非全量」之後。 */
    depSuffix: () => (T.depText() ? `；${T.depText()}` : ""),
    verdictTag: () => `非全量（舊樹 MISSING：${T.missText()} → 非全量${T.depSuffix()}；不得視為全量 PASS）`, // r21#T40（A2-MP-T40）：原 T.missingTrees().join(",")（會把未要求的 f10 等列為 MISSING）；r21#T42：相依檢查改獨立欄位
    trees(list) {
      T.ranTrees = [...list];
    },
    drop(tree) {
      T.dropped.push(tree);
    },
    /** r21#T3：範圍守門後備（只在 pre MISSING 時啟用）。只做嚴格 sha 綁定；快照不存在 → fail（INFRA-FAIL）。 */
    scopeFallback(nowChanged) {
      if (!T.miss("pre")) return (T.scope = { active: false, ok: [], fail: [], detail: [], left: [] });
      const fail = [];
      const p25Text = io.p25();
      const mp9Text = io.mp9();
      if (typeof p25Text !== "string") fail.push(`r21-T34 範圍守門後備：${R21_P25} 不存在（work 必需快照；不降級）`);
      if (typeof mp9Text !== "string") fail.push("r21-T34 範圍守門後備：pre-MP9T-test-sha.txt 不存在（work 必需快照；不降級）");
      const ok = [];
      const detail = [];
      const left = [];
      if (!fail.length) {
        const p25 = r21T34Rows(p25Text, /^([0-9a-f]{40}) {2}(.+)$/);
        const mp9 = r21T34Rows(mp9Text, /^([0-9a-f]{64}) {2}(.+)$/);
        for (const rel of uniq(nowChanged ?? [])) {
          if (p25.has(rel)) {
            const now = io.exists(rel) ? io.sha1(rel) : null;
            if (now === p25.get(rel)) {
              ok.push(rel);
              detail.push(`${rel} sha1＝${R21_P25}`);
            } else left.push(`${rel}（sha1=${now ?? "(不存在)"} ≠ ${R21_P25} ${p25.get(rel)}）`);
          } else if (/^scripts\/verify-[^/]+\.mjs$/.test(rel) && mp9.has(rel)) {
            const now = io.exists(rel) ? io.sha256(rel) : null;
            if (now === mp9.get(rel)) {
              ok.push(rel);
              detail.push(`${rel} sha256＝pre-MP9T-test-sha.txt`);
            } else left.push(`${rel}（sha256 ≠ pre-MP9T-test-sha.txt）`);
          } else left.push(`${rel}（不在 ${R21_P25}／pre-MP9T-test-sha.txt）`);
        }
      }
      return (T.scope = { active: true, ok, fail, detail, left });
    },
    annotate: (out) => r21T34Annotate(T, out),
  };
  return T;
}
const R21_T34_IO = {
  p25: () => (existsSync(R21_P25_FILE) ? readFileSync(R21_P25_FILE, "utf8") : null),
  mp9: () => (existsSync(TEST_SHA_FILE) ? readFileSync(TEST_SHA_FILE, "utf8") : null),
  exists: (rel) => existsSync(`${WORK_ROOT}/${rel}`),
  sha1: (rel) => createHash("sha1").update(readFileSync(`${WORK_ROOT}/${rel}`)).digest("hex"),
  sha256: (rel) => sha256(readFileSync(`${WORK_ROOT}/${rel}`)),
};
const R21_T34 = r21T34Make(r21T34Decide((p) => existsSync(p)), R21_T34_IO);
globalThis.__R21_T34 = R21_T34; // r13／r14 執行內容（主程序）經 globalThis.__R21_T34 存取；未設定 → TypeError（fail-closed）
/**
 * r21#T7：r13 報告中與 pre 相依的輸出改標 UNVERIFIED（只在 pre MISSING 時；每條規則必須恰好命中 1 次，否則丟錯 → INFRA-FAIL，不留下會被誤讀為 PASS 的「(none)」）。
 */
const R21_T34_TAG = "【UNVERIFIED：pre 樹 MISSING（r21-T34）】";
function r21T34Annotate(T, out) {
  if (!T.nonFull()) return (T.annotated = { rules: 0 });
  out.splice(1, 0, `［r21-T34］舊樹 MISSING：${T.missText()} → 非全量。${T.depText() ? `［${T.depText()}（本次未要求該樹，但其歷史快照相依檢查已跳過）］` : ""}以下與 pre／f9／f10／pre4／pre5 相依的比較一律 UNVERIFIED（不得視為 PASS）；詳見「r21-T34」區段。`); // r21#T40（A2-MP-T40）：原 T.missingTrees().join(",")（未要求的 f10 等也列為 MISSING）
  const isHead = (s) => /^\n?(══|verify-|情境=)/.test(String(s));
  const one = (label, pred) => {
    const idx = [];
    out.forEach((s, i) => {
      if (pred(String(s))) idx.push(i);
    });
    if (idx.length !== 1) throw new Error(`INFRA-FAIL r21-T34 annotate：${label} 命中 ${idx.length} 次（必須 1 次）`);
    return idx[0];
  };
  // r21#T40（A2-MP-T40；只調整報告呈現）：本次要求但 MISSING 的樹，其 r13 區段原本因樹不 judge 而整段消失 → 在原位置補「標題＋UNVERIFIED」（錨點必須恰好命中 1 次，否則 INFRA-FAIL）。
  // 不產生任何數字（標題一律 =MISSING／不附計數）、不寫 PASS；未要求的樹不補（不誤顯示 MISSING）。
  const blockEnd = (i) => {
    let j = i + 1;
    while (j < out.length && !isHead(out[j])) j += 1;
    return j;
  };
  const need = (t) => T.miss(t) && T.requested(t);
  const ph = (t, head) => [`\n══ ${head} ══【UNVERIFIED：${t} 樹 MISSING（r21-T34）】`, `UNVERIFIED（${t} 樹 MISSING，r21-T34：此區段原由 ${t} 樹產生；樹未執行 → 原地標示，不得視為 PASS 或 =0）`];
  const placed = [];
  const put = (idx, items) => {
    out.splice(idx, 0, ...items.flatMap(([t, head]) => ph(t, head)));
    for (const [t, head] of items) placed.push(`${t}:${head}`);
  };
  {
    const ts = ["pre", "pre5", "pre4", "f10"].filter(need); // r13 L3853 J 的順序（work → pre → pre5 → pre4 → f10）
    if (ts.length) put(blockEnd(one("每 mode PASS/FAIL（work）", (s) => s === "\n══ 每 mode PASS/FAIL（work；情境數；FAIL＝該情境該 mode 有 P1）══")), ts.map((t) => [t, `每 mode PASS/FAIL（${t}；情境數；FAIL＝該情境該 mode 有 P1）`]));
  }
  {
    const ts = [["pre4", "pre4（F4 前）P1=MISSING（僅列 R4/R5 情境）"], ["pre5", "pre5（F5 前）P1=MISSING（僅列 R4/R5/R6 情境）"]].filter(([t]) => need(t)); // r13 L3992-3993
    if (ts.length) put(blockEnd(one("P1（pre）位置", (s) => s === "\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══")), ts);
  }
  {
    const ts = ["pre5", "pre4"].filter(need); // r13 L4012 P1 計數（work → pre → pre5 → pre4）
    if (ts.length) {
      out.splice(one("P1 計數 pre 位置", (s) => s.startsWith("pre: P1=")) + 1, 0, ...ts.map((t) => `${t}: P1=MISSING（UNVERIFIED：${t} 樹快照遺失、未執行；r21-T34）`));
      for (const t of ts) placed.push(`${t}:P1 計數`);
    }
  }
  {
    const base = () => one("r10 R10 情境 P1（base）位置", (s) => s.startsWith("\n══ r10：R10 情境 P1（base）="));
    if (need("f9")) put(base(), [["f9", "r10：R10 情境 P1（f9＝F10 前）=MISSING"]]); // r13 L4125（base 之前）
    if (need("f9")) put(blockEnd(base()), [["f9", "r10：work 相對 f9（F10 前）新增 P1=MISSING"], ["f9", "r10：F10 消除的 P1（f9 有、work 無）=MISSING"]]); // r13 L4130-4131
    if (need("f10")) {
      const f9Last = out.findIndex((s) => String(s).startsWith("\n══ r10：F10 消除的 P1（f9 有、work 無）="));
      put(blockEnd(f9Last >= 0 ? f9Last : base()), [["f10", "r11：R10 情境 P1（f10＝CB 前）=MISSING"], ["f10", "r11：work 相對 f10（CB 前）新增 P1=MISSING"], ["f10", "r11：CB 消除的 P1（f10 有、work 無）=MISSING"]]); // r13 L4137-4139（f9 區段之後）
    }
  }
  if (!T.miss("pre")) return (T.annotated = { rules: 0, placed }); // r21#T40：原位置在 isHead 之前（pre 存在時不做 pre 規則；f9／f10／pre4／pre5 原地標示照做）
  const section = (label, pred, line, transform = null, head = null) => {
    const i = one(label, pred);
    let j = i + 1;
    while (j < out.length && !isHead(out[j])) j += 1;
    out[i] = `${head ? head(String(out[i])) : out[i]}${R21_T34_TAG}`; // r21#T40（A2-MP-T40）：head＝標題改寫（R9／R10 pre 標題的 =N → =MISSING）；原 `${out[i]}${R21_T34_TAG}`
    if (transform) for (let k = i + 1; k < j; k += 1) out[k] = transform(String(out[k]));
    else out.splice(i + 1, j - i - 1, line);
  };
  const lineRule = (label, pred, fn) => {
    const i = one(label, pred);
    out[i] = fn(String(out[i]));
  };
  const U = "UNVERIFIED（pre 樹 MISSING，r21-T34；此比較無法執行，不得視為 PASS）";
  section("F5 前 sha 快照比對", (s) => s === "\n══ F5 前 sha 快照比對（與快照不同的 src 檔）══", "UNVERIFIED（pre-G2S1-sha.txt MISSING：G2S1 前快照比對無法執行；範圍守門改由 T34 後備，見 r21-T34 區段）");
  section("Provider work/pre", (s) => s === "\n══ Provider 呼叫 work(F5 後) / pre(F5 前) ══", U);
  section("work 新增 P1（pre 沒有）", (s) => s === "\n══ work 新增 P1（pre 沒有）══", U);
  section("F5 消除的 P1", (s) => s === "\n══ F5 消除的 P1（pre 有、work 沒有）══", U);
  section("P1（pre）", (s) => s === "\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══", U);
  section("情境 × mode P1 數", (s) => s === "\n══ 情境 × mode P1 數（work/pre；只列任一方 > 0）══", "", (x) => x.replace(/=(\d+)\/\d+/g, "=$1/MISSING"));
  section("r7 work 新增 P1（相對 pre）", (s) => s === "\n══ r7：work 新增 P1（相對 pre＝F6）中的 R7/R6 情境 ══", U);
  const eqMissing = (h) => h.replace(/=\d+ ══$/, "=MISSING ══"); // r21#T40（A2-MP-T40）：pre 樹未執行時 r13 標題的計數恆為 0（空集合）→ 不得呈現為 =0
  section("r9 R9 情境 P1（pre）", (s) => s.startsWith("\n══ r9：R9 情境 P1（pre＝G2S1 前）="), U, null, eqMissing); // r21#T40：原 section(…, U)（標題保留 =0）
  section("r10 R10 情境 P1（pre）", (s) => s.startsWith("\n══ r10：R10 情境 P1（pre＝G2S1 前）="), U, null, eqMissing); // r21#T40：原 section(…, U)（標題保留 =0）
  lineRule("overlay pre", (s) => s === "pre: (none)", () => "pre: MISSING（UNVERIFIED：pre 樹未執行）");
  lineRule("P1 計數 pre", (s) => s.startsWith("pre: P1="), () => "pre: P1=MISSING（UNVERIFIED：pre 樹未執行）");
  lineRule("新增 P1（work 有、pre 無）", (s) => s.startsWith("新增 P1（work 有、pre 無）="), () => "新增 P1（work 有、pre 無）=UNVERIFIED  F5 消除=UNVERIFIED（pre 樹 MISSING）");
  lineRule("Provider 新增（work > pre）", (s) => s.startsWith("Provider 新增（work > pre 的情境×mode）="), () => "Provider 新增（work > pre 的情境×mode）=UNVERIFIED（pre 樹 MISSING）");
  lineRule("r9 G2S1 probe pre", (s) => s === "pre   (none)", () => "pre   MISSING（UNVERIFIED：pre 樹未執行）");
  const sum = (s) => s.replace(/ pre P1=\d+/, " pre P1=MISSING").replace(/新增P1\(vs pre\)=\d+/, "新增P1(vs pre)=UNVERIFIED").replace(/ → PASS$/, ` → ${T.verdictTag()}`);
  lineRule("r10 摘要行", (s) => s.startsWith("\nverify-destination-authority-phase2-r10: "), sum);
  lineRule("r9 總表行", (s) => s.startsWith("verify-destination-authority-phase2-r10(r9 總表): "), sum);
  T.unv("R1");
  return (T.annotated = { rules: 16, placed }); // r21#T40：另回傳 placed（原地標示清單）；原 { rules: 16 }
}

// ════════════════════════ 輸出保護（T8 修正 8）════════════════════════
/** 明列的既有 log（不論是否存在都拒絕）＋啟動時 scratchpad 內所有 *.log／*.stdout＋任何已存在的目標檔。 */
const R21_PROTECTED = [
  "mp25.log", "mp25-T4.log", "mp25-r2-T6.log", "mp25-r3.log", "mp25-r3-T8.log",
  "r19-subset.log", "r19-subset-T6.log", "r20-parity-r19subset.log", "r20-parity-r19subset-T8.log",
  "mp-cross.log", "mp-cross-dispatcher.log", "mp-cross-r2.log", "mp-cross-r3.log", "mp-cross-r4.log", "mp-cross-r4-T4.log", "mp-cross-r4-T6.log", "mp-cross-r4-T6-full.log", "mp-cross-r4-partial.log", "mp-cross-r4-r20.log", "mp-cross-r4-r20-T8.log",
  "r18-subset.log", "r18-subset-T4.log", "r18-smoke.log", "r17-subset.log", "r17-smoke.log",
];
const R21_EXISTING_AT_START = IS_CHILD ? [] : readdirSync(PRE_DIR).filter((f) => /\.(log|stdout)$/.test(f));
function r21RefuseOut(path) {
  if (typeof path !== "string" || !path.startsWith(`${PRE_DIR}/`)) return `輸出只能寫在 scratchpad（${path}）`;
  const base = path.slice(PRE_DIR.length + 1);
  if (base.includes("/")) return `輸出只能寫在 scratchpad 根目錄（${path}）`;
  if (R21_PROTECTED.includes(base)) return `拒絕覆蓋既有 log（明列保護）：${path}`;
  if (R21_EXISTING_AT_START.includes(base)) return `拒絕覆蓋既有 log（啟動時已存在）：${path}`;
  if (existsSync(path)) return `拒絕覆蓋既有檔案：${path}`;
  return null;
}
/** emit-diff 產物：只能寫 r21 自己命名的檔（r21.* ／r21base.* ／r21-mp25r4-contract-diff.md），且不得是 log。 */
function r21RefuseArtifact(path) {
  const base = path.slice(PRE_DIR.length + 1);
  if (!path.startsWith(`${PRE_DIR}/`) || base.includes("/")) return `產物只能寫在 scratchpad 根目錄（${path}）`;
  if (/\.(log|stdout)$/.test(base)) return `產物不得是 log：${path}`;
  if (!/^(r21\.|r21base\.|r21-mp25r4-contract-diff\.md$)/.test(base)) return `產物檔名必須以 r21. ／r21base. 開頭（${path}）`;
  return null;
}

// ════════════════════════ r21-D：既有 canonical identity（不自創地名規則）════════════════════════
const R21_CANON = { alias: null, vocab: [], src: null, cache: new Map() };
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
/** 既有別名表（DESTINATION_ALIAS_RECORDS）中的所有 canonicalName／aliases 字串（執行期從原始碼讀出，只作「文字中提到哪些城市」的詞彙）。 */
function r21AliasVocab() {
  const src = readFileSync(`${WORK_ROOT}/${ALIAS_REL}`, "utf8");
  const i = src.indexOf("const DESTINATION_ALIAS_RECORDS");
  const j = src.indexOf("\n];", i);
  if (i < 0 || j < i) return { fail: `${ALIAS_REL} 找不到 DESTINATION_ALIAS_RECORDS` };
  const body = src.slice(i, j);
  const set = new Set();
  let records = 0;
  for (const m of body.matchAll(/canonicalName:\s*"([^"]+)"/g)) {
    set.add(m[1]);
    records += 1;
  }
  for (const m of body.matchAll(/aliases:\s*\[([^\]]*)\]/g)) for (const s of m[1].matchAll(/"([^"]+)"/g)) set.add(s[1]);
  const fnAt = src.indexOf("export function resolveDestinationAlias(");
  const kzAt = src.indexOf('canonicalName: "金澤"');
  return {
    fail: fnAt < 0 || kzAt < 0 ? `${ALIAS_REL} 找不到 resolveDestinationAlias／金澤 record` : null,
    vocab: [...set],
    src: `${ALIAS_REL} L${lineOf(src, fnAt)} resolveDestinationAlias(x).normalizedName（別名表 DESTINATION_ALIAS_RECORDS L${lineOf(src, i)}，${records} 筆；金澤 record L${lineOf(src, kzAt)}）`,
  };
}
{
  const v = r21AliasVocab();
  R21_CANON.vocab = v.vocab ?? [];
  R21_CANON.src = v.src ?? null;
  R21_CANON.vocabFail = v.fail ?? null;
}
function r21CanonKey(x) {
  const s = String(x ?? "").trim();
  if (!s) return "";
  if (R21_CANON.cache.has(s)) return R21_CANON.cache.get(s);
  const A = globalThis.__R21_ALIAS;
  if (!A || typeof A.resolveDestinationAlias !== "function") throw new Error(`[r21] 缺既有 canonical identity（${ALIAS_REL} resolveDestinationAlias；未載入）`);
  const k = String(A.resolveDestinationAlias(s)?.normalizedName ?? "").trim();
  R21_CANON.cache.set(s, k);
  return k;
}
const r21Esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 文字中提到的城市（既有別名表詞彙；每個命中都經 canonical identity）。檢查「所有」候選，不只第一個。 */
function r21Mentions(text) {
  const t = String(text ?? "");
  const out = new Set();
  for (const a of R21_CANON.vocab) {
    if (!a || a.length < 2) continue;
    if (/^[\x20-\x7e]+$/.test(a)) {
      if (a.length < 4) continue; // 短拉丁別名（例：縮寫）易誤中，略過
      if (!new RegExp(`(^|[^A-Za-z])${r21Esc(a)}([^A-Za-z]|$)`, "i").test(t)) continue;
    } else if (!t.includes(a)) continue;
    const k = r21CanonKey(a);
    if (k) out.add(k);
  }
  return out;
}
/** vite-node 載入正式 destination-alias-resolver.ts（主程序；與 r13 子程序同一套 vite／vite-node／tsconfig-paths；外部請求一律拒絕並計數）。 */
async function r21LoadAlias() {
  const realFetch = globalThis.fetch;
  let ext = 0;
  globalThis.fetch = async () => {
    ext += 1;
    throw new Error("[r21] 載入 canonical 模組期間禁止外部請求");
  };
  try {
    const { createServer } = await import("vite");
    const { ViteNodeServer } = await import("vite-node/server");
    const { ViteNodeRunner } = await import("vite-node/client");
    const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
    const server = await createServer({ root: WORK_ROOT, configFile: false, envDir: false, logLevel: "silent", clearScreen: false, plugins: [tsconfigPaths()], server: { middlewareMode: true, hmr: false, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
    try {
      await server.environments.client.pluginContainer.buildStart({});
      const vn = new ViteNodeServer(server);
      const runner = new ViteNodeRunner({ root: server.config.root, base: server.config.base, fetchModule: (id) => vn.fetchModule(id), resolveId: (id, importer) => vn.resolveId(id, importer) });
      await runner.executeId("/@vite/env");
      const mod = await runner.executeFile(`${WORK_ROOT}/${ALIAS_REL}`);
      return { mod, ext };
    } finally {
      await server.close();
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ════════════════════════ r21-E：Pending 例外再收緊（純函式；主程序探針與子程序共用）════════════════════════
const R21_COORD_RE = /-?\d{1,3}\.\d{2,}\s*[,，、/]\s*-?\d{1,3}\.\d{2,}/; // 同 r20 R20_COORD_RE
const R21_SCOPE_RE = /searchScope|explicitSearchScope|radius|半徑|範圍|\blat(?:itude)?\s*[:=]|\bln?g(?:itude)?\s*[:=]|\blon\s*[:=]|公里內|\d\s*km\b|@\s*-?\d/i; // r20 R20_SCOPE_RE＋「範圍」不要求冒號
const R21_DIST_RE = /\d+(?:\.\d+)?\s*(?:公里|公尺|千米|英里|米|km|mi|m)(?![a-z])/i; // 距離單位（「3公里」「500m」）
function r21CanonObj(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => r21CanonObj(x) ?? "null").join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${r21CanonObj(v[k])}`).join(",")}}`;
}
const r21Ds = (p) => (p && typeof p === "object" && !Array.isArray(p) && p.kind === "destination_switch" ? p : null);
/** Pending identity（使用者裁決）：kind、rawGeographicLabel（既有 canonical）、previousConfirmedDestination、categoryIntent、originatingRoute。 */
const r21IdKey = (p) => JSON.stringify([p?.kind ?? null, r21CanonKey(p?.rawGeographicLabel), String(p?.previousConfirmedDestination ?? "").trim(), p?.categoryIntent ?? null, p?.originatingRoute ?? null]);
const r21SameIdentity = (a, b) => Boolean(r21Ds(a) && r21Ds(b)) && r21IdKey(a) === r21IdKey(b);
/**
 * r19-E ∧ r20-E 之外再加的條件（全部成立才放行；回傳 why 以「r21:」開頭）。
 *   persists／atStart／userText／limits  同 r20
 *   created     Map<identityKey, 建立輪原句>（本程序內實際建立 Pending 的輪；Reload＝新程序 → 空）
 *   turnWrites  本輪（含其他 Callback／send() 層）已寫入的 destination_switch Pending [{p, inFrame}]
 */
function r21PendingExtra({ persists, atStart, userText, limits, created = null, turnWrites = [] }) {
  const why = [];
  const W = (m) => why.push(`r21:${m}`);
  const startP = r21Ds(atStart?.pendingClarification);
  const ds = (persists ?? []).map((s) => r21Ds(s?.pendingClarification)).filter(Boolean);
  const all = uniq([...(turnWrites ?? []).map((w) => r21CanonObj(w?.p ?? w)), ...ds.map((p) => r21CanonObj(p))]);
  if (all.length > 1) W(`同一流程／同一 User Turn 寫入 ${all.length} 個內容不同的 destination_switch Pending（${all.map((x) => x.slice(0, 60)).join(" | ")}）`);
  (persists ?? []).forEach((s, i) => {
    const p = r21Ds(s?.pendingClarification);
    if (!p) return; // r19-E 已判不成立
    const tag = `寫入#${i + 1}`;
    // E-a：parentIntent 固定（裁決 1）
    if (p.parentIntent !== "place_recommendation") W(`${tag} parentIntent=${JSON.stringify(p.parentIntent ?? null)}（必須恰為 "place_recommendation"；缺少或其他值皆不成立）`);
    const raw = typeof p.rawGeographicLabel === "string" ? p.rawGeographicLabel.trim() : "";
    const prev = typeof p.previousConfirmedDestination === "string" ? p.previousConfirmedDestination.trim() : "";
    // E-c：地名不得夾帶範圍
    if (raw && (R21_SCOPE_RE.test(raw) || R21_DIST_RE.test(raw))) W(`${tag} rawGeographicLabel 夾帶範圍字樣（${JSON.stringify(raw.slice(0, 40))}）`);
    const same = r21SameIdentity(startP, p);
    // E-d：同一 User Turn 驗證 ≤1 → 建立輪 attempts ≤1、同一 Pending 一輪最多推進 1
    const n = p.confirmationAttempts;
    if (Number.isInteger(n)) {
      if (!same && n > 1) W(`${tag} 建立輪 confirmationAttempts=${n}（同一 User Turn 驗證 ≤1）`);
      if (same && Number.isInteger(startP.confirmationAttempts) && n - startP.confirmationAttempts > 1) W(`${tag} confirmationAttempts 一輪推進 ${startP.confirmationAttempts}→${n}（同一 User Turn 驗證 ≤1）`);
    }
    // E-b：輪初同一 Pending 的原句只能與建立輪原句比對；未知 → fail-closed 絕對檢查（不得自己比自己）
    if (same && typeof p.originalUserText === "string") {
      const o = p.originalUserText;
      const known = created && typeof created.get === "function" ? created.get(r21IdKey(p)) : undefined;
      if (typeof known === "string") {
        if (o !== known) W(`${tag} originalUserText ≠ 建立該 Pending 當輪原句（${JSON.stringify(o.slice(0, 40))} vs ${JSON.stringify(known.slice(0, 40))}）`);
      } else {
        if (R21_COORD_RE.test(o)) W(`${tag} 輪初 Pending（建立輪原句未知）originalUserText 含座標`);
        if (R21_SCOPE_RE.test(o) || R21_DIST_RE.test(o)) W(`${tag} 輪初 Pending（建立輪原句未知）originalUserText 含範圍字樣`);
        const keep = new Set([r21CanonKey(raw), r21CanonKey(prev)].filter(Boolean));
        const other = [...r21Mentions(o)].filter((k) => !keep.has(k));
        if (other.length) W(`${tag} 輪初 Pending（建立輪原句未知）originalUserText 夾帶其他城市 ${other.join("、")}`);
        if (limits && Number.isInteger(limits.userText) && o.length > limits.userText) W(`${tag} 輪初 Pending（建立輪原句未知）originalUserText 長度 ${o.length} > 既有上限 ${limits.userText}`);
      }
    }
  });
  void userText;
  return { ok: !why.length, why: why.join("；") };
}
const r21Combine = (a, b) => ({ ok: Boolean(a?.ok) && Boolean(b?.ok), why: [a?.why, b?.why].filter(Boolean).join("；") });
/** 子程序：persistSession 包裝內記錄「Pending 被改成 destination_switch」的寫入（未改變＝沿用，不算寫入）。 */
function r21RecordWrite(s, prev, inFrame) {
  const p = r21Ds(s?.pendingClarification);
  if (!p) return;
  if (r21CanonObj(p) === r21CanonObj(prev?.pendingClarification)) return;
  (globalThis.__R21_TURN_WRITES ??= []).push({ p: JSON.parse(JSON.stringify(p)), inFrame: Boolean(inFrame) });
}
function r21MarkEvaluated(persists) {
  for (const s of persists ?? []) {
    const p = r21Ds(s?.pendingClarification);
    if (p) (globalThis.__R21_EVALUATED ??= []).push(r21CanonObj(p));
  }
}
/**
 * 輪末（send() 層／整輪）檢查。writes＝本輪 Pending 寫入；evaluated＝已在 Callback 內（可信判定未通過）評估過的 Pending。
 * 適用：輪末 Session 有 destination_switch Pending，且本輪至少一筆寫入未在 Callback 內評估（含 r13 模型直接寫回、輪末 Pending 與輪初不同但未經包裝記錄）。
 * 判定：r19-E ∧ r20-E ∧ r21-E（persists＝[輪末 Session]，成本＝整輪）；另：本輪寫入內容不同的 Pending ＞1 → 不成立。
 */
function r21TurnEnd({ atStart, end, writes = [], evaluated = [], userText, places = 0, weather = 0, builders = 0, begins = 0, rpcs = [], db = [], frameGeo = [], altOffer = null, limits, created = null, r19PE, r20PE }) {
  const startP = r21Ds(atStart?.pendingClarification);
  const endP = r21Ds(end?.pendingClarification);
  const list = (writes ?? []).map((w) => ({ p: w.p, inFrame: Boolean(w.inFrame), local: false }));
  if (endP && r21CanonObj(endP) !== r21CanonObj(startP) && !list.some((w) => r21CanonObj(w.p) === r21CanonObj(endP))) list.push({ p: endP, inFrame: false, local: true });
  const res = { writes: list.map((w) => ({ p: w.p, inFrame: w.inFrame, local: w.local })), exc: null };
  if (!list.length) return res;
  const why = [];
  const distinct = uniq(list.map((w) => r21CanonObj(w.p)));
  if (distinct.length > 1) why.push(`r21:同一 User Turn 寫入 ${distinct.length} 個內容不同的 destination_switch Pending`);
  const ev = new Set(evaluated ?? []);
  const unevaluated = list.filter((w) => !ev.has(r21CanonObj(w.p)));
  let applies = distinct.length > 1;
  if (endP && unevaluated.length) {
    applies = true;
    const args = { persists: [end], atStart, places, weather, builders, begins, rpcs, userText, db, frameGeo, altOffer, limits, created, turnWrites: [] };
    const a = r19PE(args);
    const b = r20PE(args);
    const c = r21PendingExtra(args);
    for (const x of [a, b, c]) if (!x.ok && x.why) why.push(x.why);
  }
  if (applies) res.exc = { ok: !why.length, why: why.join("；"), unevaluated: unevaluated.length, local: list.some((w) => w.local), outside: list.some((w) => !w.inFrame) };
  // 建立輪登記（本程序內；首次寫入的那一輪原句）
  if (created && typeof created.set === "function" && typeof userText === "string")
    for (const w of list) if (!r21SameIdentity(startP, w.p) && !created.has(r21IdKey(w.p))) created.set(r21IdKey(w.p), userText);
  return res;
}

// ════════════════════════ r20 原文：函式區段擷取（探針用；與子程序執行的是同一份 patched 文字）════════════════════════
function r21FnsFromR20Text(text, canonKey) {
  const a = text.indexOf("// ════════════════════════ 長度上限");
  const b = text.indexOf("// ════════════════════════ r20-O：只記錄");
  const c = text.indexOf("// ════════════════════════ 探針（主程序）");
  const d = text.indexOf("// ════════════════════════ R20 patch（各層）");
  if (a < 0 || b < a || c < b || d < c) throw new Error("r20 原文找不到函式區段（長度上限／r20-E／探針）");
  const body = `${text.slice(a, b)}\n${text.slice(c, d)}\nreturn { r20Limits, r20PendingExtra, r20Combine, r20SameIdentity, r19ExcFromText, r20AltOfferFromSource, r20ExceptionProbe };`;
  return new Function("readFileSync", "WORK_ROOT", "__r21", body)(readFileSync, WORK_ROOT, { canonKey });
}
/** 原版 r19-E（未套用 4000；字面 500）與 r20 實際執行的 r19-E（r20#L1：500 → 既有上限）。 */
function r21R19Variants(r19Text, r20Text, fns, limits) {
  const old = "p.originalUserText.length > 500) why.push(";
  if (!r20Text.includes(`old: "${old}",`)) throw new Error("r20 原文找不到 r20#L1（500 → 既有上限）patch 定義");
  const orig = fns.r19ExcFromText(r19Text, limits).r19PendingException;
  const at4000Text = r19Text.replace(old, "p.originalUserText.length > __r20.limits.userText) why.push(");
  const at4000 = fns.r19ExcFromText(at4000Text, limits).r19PendingException;
  return { orig, at4000 };
}

// ════════════════════════ r21 探針（主程序）════════════════════════
const R21_T2 = "換金澤，再推薦幾個";
const R21_T2_OTHER = "不去大阪了，換金澤，再推薦幾個";
/** r20 探針 51 條在 r21 契約下的期望改判（只有使用者裁決要求者；其餘期望不變）。 */
const R21_R20_ROW_OVERRIDE = { "R-E02 合法（不含 parentIntent）": { want: false, why: "使用者裁決 1：parentIntent 必填且固定 place_recommendation（加嚴）" } };
function r21Probe({ fnsOrig, fnsR21, r19, limits, alt }) {
  const rows = [];
  // ── 1. canonical identity（既有機制）自檢 ──
  const ck = [
    ["C01 canonical(金沢)＝canonical(金澤)＝金澤", () => r21CanonKey("金沢") === "金澤" && r21CanonKey("金澤") === "金澤"],
    ["C02 canonical(京都)＝京都、canonical(大阪)＝大阪", () => r21CanonKey("京都") === "京都" && r21CanonKey("大阪") === "大阪"],
    ["C03 提到的城市（所有候選）：「不去大阪了，換金澤，再推薦幾個」⊇ {大阪,金澤}", () => { const m = r21Mentions(R21_T2_OTHER); return m.has("大阪") && m.has("金澤"); }],
    ["C04 提到的城市：「換金澤，再推薦幾個」＝{金澤}", () => { const m = [...r21Mentions(R21_T2)]; return m.length === 1 && m[0] === "金澤"; }],
    ["C05 提到的城市：geocode 查詢「大阪了換金澤」⊇ {大阪,金澤}", () => { const m = r21Mentions("大阪了換金澤"); return m.has("大阪") && m.has("金澤"); }],
    ["C06 提到的城市：「金沢市, 石川県, 日本」∋ 金澤", () => r21Mentions("金沢市, 石川県, 日本").has("金澤")],
  ];
  for (const [label, fn] of ck) {
    let got = false;
    let err = "";
    try {
      got = Boolean(fn());
    } catch (e) {
      err = String(e?.message ?? e);
    }
    rows.push({ group: "canonical", label, want: true, got, pass: got === true, cols: null, why: err });
  }
  // ── 2. r20 探針 51 條：三欄（原版 r19 500／r20 實際 4000＋逐字 identity／r21）──
  const evalR21 = (args) => r21Combine(r21Combine(r19.at4000(args), fnsR21.r20PendingExtra(args)), r21PendingExtra(args));
  const capture = (r19fn, fns) => fns.r20ExceptionProbe({ r19PendingException: r19fn, limits, alt });
  const pOrig500 = capture(r19.orig, fnsOrig); // .r19 欄＝原版 r19 單獨
  const pR20 = capture(r19.at4000, fnsOrig); // .got＝r20 實際（r19@4000 ∧ r20 逐字 identity）
  const pR21 = capture((args) => r21Combine(r19.at4000(args), r21PendingExtra(args)), fnsR21); // .got＝r21（r19@4000 ∧ r21 ∧ r20 canonical identity）
  pR20.rows.forEach((r, i) => {
    const o = R21_R20_ROW_OVERRIDE[r.label];
    const want = o ? o.want : r.want;
    const got = pR21.rows[i].got;
    rows.push({ group: "r20-51", label: r.label, want, got, pass: got === want, cols: { o19: pOrig500.rows[i].r19, r19at: r.r19, r20: r.got, r21: got }, why: [o ? `［期望改判：${o.why}］` : "", pR21.rows[i].why].filter(Boolean).join(" ") });
  });
  // ── 3. r21 新增探針（e(1)～(5)＋裁決 1／3）──
  const atStart = {
    travelContext: { interests: [], destination: "京都", tripPurpose: "more_place_recommendations" },
    recommendationSession: { destination: "京都", searchScope: "city", pool: [{ id: "ChIJ-k1" }], shown: ["ChIJ-k1"] },
    activeRecommendationContext: { destinationName: "京都", intent: "attraction", searchScope: "city" },
    tripPlanningContext: { destination: "京都", selectedPlaces: [] },
    location: { lat: 24.18, lng: 120.62, city: "台中市" },
    nearbyLocationAuthority: { displayLabel: "台中市", lat: 24.18, lng: 120.62, source: "device" },
    activeCategoryIntent: "attraction",
    lastAssistantReply: "在京都，這些地方值得先看看：",
    pendingQuestion: { type: "x" },
    recommendedPlaces: [{ id: "ChIJ-k1" }],
  };
  const P = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: R21_T2, confirmationAttempts: 1 };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const S = (patch = {}, pend = P, base = atStart) => ({ ...clone(base), ...patch, pendingClarification: pend });
  const startWith = (pend) => ({ ...clone(atStart), pendingClarification: clone(pend) });
  const fill = (n, core) => `${core}${"。".repeat(Math.max(0, n - core.length))}`;
  const known = (pend, text) => new Map([[r21IdKey(pend), text]]);
  const base = { atStart, places: 0, weather: 0, builders: 0, begins: 0, rpcs: [], userText: R21_T2, db: [], frameGeo: [], altOffer: alt.fn, limits, created: new Map(), turnWrites: [] };
  const coordT = `${R21_T2} (36.5613,136.6562)`;
  const otherT = "換金澤，順便大阪，再推薦幾個";
  const radiusT = "換金澤 半徑3公里，再推薦幾個";
  const FP = (o) => ({ ...P, originalUserText: o, confirmationAttempts: 0 });
  const cases = [
    // 放行
    ["R21-E01 合法：八欄齊全（parentIntent=place_recommendation）", {}, true],
    ["R21-E02 合法：originalUserText 501 字（原版 r19＝P1；500→4000 放寬）", { persists: [S({}, { ...P, originalUserText: fill(501, R21_T2) })], userText: fill(501, R21_T2) }, true],
    ["R21-E03 合法：originalUserText 2000 字（放寬）", { persists: [S({}, { ...P, originalUserText: fill(2000, R21_T2) })], userText: fill(2000, R21_T2) }, true],
    ["R21-E04 合法：originalUserText 3999 字（放寬）", { persists: [S({}, { ...P, originalUserText: fill(3999, R21_T2) })], userText: fill(3999, R21_T2) }, true],
    ["R21-E05 合法：originalUserText 4000 字（＝既有上限；放寬）", { persists: [S({}, { ...P, originalUserText: fill(4000, R21_T2) })], userText: fill(4000, R21_T2) }, true],
    ["R21-E06 合法：輪初同一 Pending（建立輪原句已知＝T2）確認失敗重寫 attempts 1→2，本輪「好」", { atStart: startWith(P), persists: [S({}, { ...P, confirmationAttempts: 2 }, startWith(P))], userText: "好", created: known(P, R21_T2) }, true],
    ["R21-E07 合法：輪初 Pending 建立輪原句未知（Reload／Client 注入）、原句乾淨", { atStart: startWith(P), persists: [S({}, { ...P, confirmationAttempts: 2 }, startWith(P))], userText: "好" }, true],
    ["R21-E08 合法：達上限後以不同類別（cafe）建立新 Pending（不同 identity，不算重置）", { atStart: startWith({ ...P, confirmationAttempts: 2 }), persists: [S({}, { ...P, categoryIntent: "cafe", originalUserText: "換金澤，推薦咖啡廳", confirmationAttempts: 1 }, startWith({ ...P, confirmationAttempts: 2 }))], userText: "換金澤，推薦咖啡廳", created: known(P, R21_T2) }, true],
    ["R21-E09 合法：原句夾帶其他城市但為本輪真實原句（情境 18：不去大阪了，換金澤）", { persists: [S({}, { ...P, originalUserText: R21_T2_OTHER })], userText: R21_T2_OTHER }, true],
    ["R21-E10 合法：同一 Callback 兩次寫入完全相同的 Pending（冪等）", { persists: [S(), S()] }, true],
    // P1
    ["R21-N01 缺 parentIntent（r19／r20 放行 → r21 P1；裁決 1）", { persists: [S({}, (({ parentIntent, ...x }) => x)(P))] }, false],
    ["R21-N02 parentIntent=trip_planning", { persists: [S({}, { ...P, parentIntent: "trip_planning" })] }, false],
    ["R21-N03 e(1) 輪初偽造 Pending（建立輪未知）原句夾帶座標；本輪「好」原樣重寫（r20 自己比自己 → 放行）", { atStart: startWith(FP(coordT)), persists: [S({}, { ...FP(coordT), confirmationAttempts: 1 }, startWith(FP(coordT)))], userText: "好" }, false],
    ["R21-N04 e(1) 輪初偽造 Pending（建立輪未知）原句夾帶其他城市（大阪）", { atStart: startWith(FP(otherT)), persists: [S({}, { ...FP(otherT), confirmationAttempts: 1 }, startWith(FP(otherT)))], userText: "好" }, false],
    ["R21-N05 e(1) 輪初偽造 Pending（建立輪未知）原句夾帶半徑", { atStart: startWith(FP(radiusT)), persists: [S({}, { ...FP(radiusT), confirmationAttempts: 1 }, startWith(FP(radiusT)))], userText: "好" }, false],
    ["R21-N06 e(1) 輪初 Pending 已知建立輪原句 T2，但輪初內容被換成其他原句（Client 竄改）", { atStart: startWith(FP(otherT)), persists: [S({}, { ...FP(otherT), confirmationAttempts: 1 }, startWith(FP(otherT)))], userText: "好", created: known(P, R21_T2) }, false],
    ["R21-N07 e(1) 輪初偽造 Pending（建立輪未知）原句 4001 字", { atStart: startWith(FP(fill(4001, R21_T2))), persists: [S({}, { ...FP(fill(4001, R21_T2)), confirmationAttempts: 1 }, startWith(FP(fill(4001, R21_T2))))], userText: "好" }, false],
    ["R21-N08 e(3) rawGeographicLabel「金澤 半徑3公里」（原句同）", { persists: [S({}, { ...P, rawGeographicLabel: "金澤 半徑3公里", originalUserText: radiusT })], userText: radiusT }, false],
    ["R21-N09 e(3) rawGeographicLabel「金澤3km」", { persists: [S({}, { ...P, rawGeographicLabel: "金澤3km", originalUserText: "換金澤3km，再推薦幾個" })], userText: "換金澤3km，再推薦幾個" }, false],
    ["R21-N10 e(3) rawGeographicLabel「金澤 5公里」", { persists: [S({}, { ...P, rawGeographicLabel: "金澤 5公里", originalUserText: "換金澤 5公里，再推薦幾個" })], userText: "換金澤 5公里，再推薦幾個" }, false],
    ["R21-N11 e(3) rawGeographicLabel「金澤範圍內」", { persists: [S({}, { ...P, rawGeographicLabel: "金澤範圍內", originalUserText: "換金澤範圍內，再推薦幾個" })], userText: "換金澤範圍內，再推薦幾個" }, false],
    ["R21-N12 e(4) 同一 Callback 兩次寫入同一 Pending 但 attempts 0→1（一輪驗證兩次）", { persists: [S({}, { ...P, confirmationAttempts: 0 }), S({}, { ...P, confirmationAttempts: 1 })] }, false],
    ["R21-N13 e(4) 同一 Callback 先寫金澤 Pending、再寫另一內容（categoryIntent cafe）", { persists: [S(), S({}, { ...P, categoryIntent: "cafe" })] }, false],
    ["R21-N14 e(4) 本輪其他層已寫入不同 Pending（turnWrites），本 Callback 再寫另一個", { persists: [S()], turnWrites: [{ p: { ...P, confirmationAttempts: 0 }, inFrame: false }] }, false],
    ["R21-N15 建立輪 confirmationAttempts=2（r19 0–2 放行 → 同一 User Turn 驗證 ≤1）", { persists: [S({}, { ...P, confirmationAttempts: 2 })] }, false],
    ["R21-N16 同一 Pending 一輪推進 0→2", { atStart: startWith({ ...P, confirmationAttempts: 0 }), persists: [S({}, { ...P, confirmationAttempts: 2 }, startWith({ ...P, confirmationAttempts: 0 }))], userText: "好", created: known(P, R21_T2) }, false],
    ["R21-N17 e(5) originalUserText 4001 字（本輪原句同樣 4001 字）", { persists: [S({}, { ...P, originalUserText: fill(4001, R21_T2) })], userText: fill(4001, R21_T2) }, false],
    ["R21-N18 canonical：輪初 raw「金澤」attempts=2、重寫 raw「金沢」attempts=0（逐字比對當不同 Pending → 漏抓重置）", { atStart: startWith({ ...P, confirmationAttempts: 2 }), persists: [S({}, { ...P, rawGeographicLabel: "金沢", originalUserText: "換金沢，再推薦幾個", confirmationAttempts: 0 }, startWith({ ...P, confirmationAttempts: 2 }))], userText: "換金沢，再推薦幾個" }, false],
  ];
  for (const [label, over, want] of cases) {
    const args = { ...base, persists: [S()], ...over };
    const o19 = r19.orig(args).ok;
    const r19at = r19.at4000(args).ok;
    const r20 = fnsOrig.r20Combine(r19.at4000(args), fnsOrig.r20PendingExtra(args)).ok;
    const c = evalR21(args);
    rows.push({ group: "r21-new", label, want, got: c.ok, pass: c.ok === want, cols: { o19, r19at, r20, r21: c.ok }, why: c.why });
  }
  // ── 4. e(2) send() 層／整輪寫入（r21TurnEnd）──
  const r20PE = (args) => fnsR21.r20PendingExtra(args);
  const TE = (over) => r21TurnEnd({ atStart, end: S(), writes: [{ p: clone(P), inFrame: false }], evaluated: [], userText: R21_T2, places: 0, weather: 0, builders: 0, begins: 0, rpcs: [], db: [], frameGeo: ["more_validate:金澤"], altOffer: alt.fn, limits, created: new Map(), r19PE: r19.at4000, r20PE, ...over });
  const sendCases = [
    ["S-E01 合法：send() 層（Callback 外）寫入 Pending", {}, true, true],
    ["S-E02 合法：r13 模型直接寫回（未經包裝；輪末 Pending ≠ 輪初）", { writes: [] }, true, true],
    ["S-E03 不適用：Callback 內已評估且通過、輪末相同", { writes: [{ p: clone(P), inFrame: true }], evaluated: [r21CanonObj(P)] }, true, false],
    ["S-E04 不適用：輪初 Pending 原樣保留（沒有寫入）", { atStart: startWith(P), writes: [] }, true, false],
    ["S-N01 send() 層寫入＋activeCategoryIntent 改變", { end: S({ activeCategoryIntent: "cafe" }) }, false, true],
    ["S-N02 send() 層寫入＋整輪 Places 1", { places: 1 }, false, true],
    ["S-N03 send() 層寫入＋整輪 credits_check", { rpcs: ["credits_check"] }, false, true],
    ["S-N04 send() 層寫入＋nearbyLocationAuthority 改成金澤座標", { end: S({ nearbyLocationAuthority: { displayLabel: "金澤", lat: 36.5613, lng: 136.6562, source: "clarification" } }) }, false, true],
    ["S-N05 send() 層寫入＋weather 階段 geocode 金澤", { frameGeo: ["more_validate:金澤", "weather:金沢市, 石川県, 日本"] }, false, true],
    ["S-N06 send() 層寫入缺 parentIntent", { end: S({}, (({ parentIntent, ...x }) => x)(P)), writes: [{ p: (({ parentIntent, ...x }) => x)(P), inFrame: false }] }, false, true],
    ["S-N07 e(4) 同一 turn：Callback 寫入 A(attempts0)＋send() 層寫入 A(attempts1)", { writes: [{ p: { ...P, confirmationAttempts: 0 }, inFrame: true }, { p: clone(P), inFrame: false }], evaluated: [r21CanonObj({ ...P, confirmationAttempts: 0 })] }, false, true],
    ["S-N08 e(1) send() 層原樣重寫輪初偽造 Pending（建立輪未知、原句含座標）", { atStart: startWith(FP(coordT)), end: S({}, { ...FP(coordT), confirmationAttempts: 1 }, startWith(FP(coordT))), writes: [{ p: { ...FP(coordT), confirmationAttempts: 1 }, inFrame: false }], userText: "好" }, false, true],
    ["S-N09 send() 層寫入 originalUserText ≠ 本輪原句", { end: S({}, { ...P, originalUserText: "換金澤" }), writes: [{ p: { ...P, originalUserText: "換金澤" }, inFrame: false }] }, false, true],
  ];
  for (const [label, over, want, wantApplies] of sendCases) {
    const r = TE(over);
    const applies = Boolean(r.exc);
    const got = r.exc ? r.exc.ok : true;
    rows.push({ group: "send", label, want, got, pass: got === want && applies === wantApplies, cols: { applies, wantApplies }, why: r.exc?.why ?? "" });
  }
  const g = (name) => rows.filter((r) => r.group === name);
  const relax = rows.filter((r) => r.cols && r.cols.o19 === false && r.cols.r21 === true).map((r) => r.label);
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length, groups: Object.fromEntries(["canonical", "r20-51", "r21-new", "send"].map((k) => [k, { pass: g(k).filter((r) => r.pass).length, n: g(k).length }])), relax, tightened: rows.filter((r) => r.cols && r.cols.r20 === true && r.cols.r21 === false).map((r) => r.label) };
}
function r21ProbeLines(p) {
  const yn = (v) => (v === true ? "放行" : v === false ? "P1" : "-");
  const out = [];
  out.push(`r21 探針 ${p.pass}/${p.n}（canonical ${p.groups.canonical.pass}/${p.groups.canonical.n}；r20 原 51 條 ${p.groups["r20-51"].pass}/${p.groups["r20-51"].n}；r21 新增 ${p.groups["r21-new"].pass}/${p.groups["r21-new"].n}；send() 層 ${p.groups.send.pass}/${p.groups.send.n}）`);
  out.push("  欄位：期望（r21 契約）｜原版 r19 單獨（500，未套用 4000）｜r19@4000（r20#L1 實際執行）｜r20 實際（r19@4000 ∧ r20 逐字 identity）｜r21（r19@4000 ∧ r20 canonical identity ∧ r21）");
  for (const r of p.rows) {
    const c = r.cols;
    const colTxt = !c ? "" : r.group === "send" ? `（適用=${c.applies ? "是" : "否"}／期望適用=${c.wantApplies ? "是" : "否"}）` : `｜原版r19=${yn(c.o19)}｜r19@4000=${yn(c.r19at)}｜r20=${yn(c.r20)}｜r21=${yn(c.r21)}${c.o19 === false && c.r21 === true ? "  ★放寬（500→4000）" : ""}${c.r20 === true && c.r21 === false ? "  ▲r21 加嚴" : ""}`;
    out.push(`  [${r.pass ? "OK" : "NG"}][${r.group}] ${r.label} 期望=${yn(r.want)} 實際=${yn(r.got)}${colTxt}${r.why ? `（${String(r.why).slice(0, 200)}）` : ""}`);
  }
  out.push(`  ★ 相對原版 r19 的放寬（原版 r19 單獨 P1、r21 放行）：${p.relax.length} 條 → ${p.relax.join("；") || "-"}`);
  out.push(`  ▲ r21 相對 r20 的加嚴（r20 放行、r21 P1）：${p.tightened.length} 條 → ${p.tightened.join("；") || "-"}`);
  return out;
}

// ════════════════════════ r21-G（A2-MP-T14）：pushMorePlaceRecommendations 安全契約（TypeScript AST；取代兩處過時的位置比對）════════════════════════
/**
 * 只在「work _app.chat.tsx sha1 ＝ scratchpad/post-MP25-sha.txt 該檔 sha1」時啟用（其他 sha／其他樹 → 原檢查逐字不變）。
 * A2-MP-T15（r21-W4）：上述快照檔改為 R21_P25（post-MP25-r2-sha.txt 存在時優先）；性質：版本識別，契約 (a)～(f) 與變異自檢不變。
 * 取代：r13 L2363 G2S1「credits−more < 3000（＋r17-V F2 扣除）」字元距離；r14 L299 R14_A2_WORK_ANCHORS[2]（只對 work）。
 * 契約（任一不成立 → 照舊 INFRA-FAIL source anchors；原檢查即為 INFRA）：
 *   (a) trustedScope＝函式本體頂層 const，初始值為 await resolveTrustedRecommendationSearchScope(…)，全函式恰 1 個、不被重新指派；
 *       在它與不可信分支結束之前，函式內沒有任何 Credits／Places／Builder／Weather 參照。
 *   (b) 不可信分支＝函式本體頂層 if (trustedScope.status !== "trusted")，恰 1 個（全函式）、無 else；分支內沒有 Credits 參照
 *       （識別字含 credit、字串 credits_*），分支最後一句是 return（不得落到扣點程式碼）。
 *   (c) Pending 安全分支：分支內至少 1 個 persistSession({ …, pendingClarification }) 寫入；每個 persistSession 都位於分支內某個 if 的 then 區塊，
 *       該區塊以 return 結束、且 return 在寫入之後（扣點前結束）。
 *   (d) 未確認目的地不得進 Places：分支內沒有 Places／Builder／Weather／其他推薦 Callback 參照。
 *   (e) Credits metadata { path: "more_places", destination } 全函式恰 1 個，是 Credits 呼叫的參數；destination 解析到唯一的頂層
 *       const destination = trustedScope.destination（位於不可信分支之後、Credits 呼叫之前；Credits 呼叫亦為頂層語句）。
 *   (f) 原 anchor 的其餘內容：legacyLabel 宣告與 more_places metadata 皆在 pushMorePlaceRecommendations 範圍內（取代 3000 字元）；
 *       不可信分支直接含 if (!legacyLabel) return false;。
 * 偵測器自檢：以 AST 位置對 work 原始碼做記憶體內變異（不寫檔），每個變異都必須被對應項目抓到；不符 → INFRA-FAIL（偵測器失效）。
 */
const R21_G_REL = "src/routes/_app.chat.tsx";
const R21_G_A2_ANCHOR = 'if (trustedScope.status !== "trusted") {\n        if (!legacyLabel) return false;'; // ＝ r14 L299 R14_A2_WORK_ANCHORS[2]
const R21_G_CREDIT_RE = /credit/i;
const R21_G_CREDIT_STR_RE = /credits?_/i;
const R21_G_PLACES = new Set([
  "searchNearbyPlaces", "fetchPlaceDetailsForFocus", "fetchPlaceDetailsFn", "fetchWeather", // r14 R14_CLOSURE_DEPS 的 Places／Weather Mock
  "buildDestinationCategoryRecommendations", "buildMoreDestinationRecommendations", "buildRecommendationRefinementResults", "buildAlternativeDestinationRecommendations", "buildDestinationMustVisitRecommendation", "buildNearbyPlaceRecommendation", // r14 R14_BUILDERS
  "pushDestinationCategoryPlaceRecommendation", "pushMorePlaceRecommendations", "pushRecommendationRefinement", "pushAlternativeDestinationPlaceRecommendation", "pushDestinationPlaceRecommendation", "pushNearbyPlaceRecommendation", // r14 R14_CALLBACKS
]);
const R21_G_PLACES_RE = /^(build\w*Recommendations?|(search|fetch)\w*(Place|Places|Weather)\w*)$/;
const r21GNorm = (s) => String(s).replace(/\s+/g, " ").trim();
/** 純 AST 檢查（不讀檔）。回傳 { fail: ["(x) …"], detail, nodes }；nodes 供自檢變異使用。 */
function r21MoreContractCheck(ts, text) {
  const fail = [];
  const F = (tag, m) => fail.push(`(${tag}) ${m}`);
  const sf = ts.createSourceFile("_app.chat.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ln = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const fns = [];
  const vf = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "pushMorePlaceRecommendations" && n.initializer && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(sf) === "useCallback") fns.push(n.initializer.arguments[0]);
    ts.forEachChild(n, vf);
  };
  vf(sf);
  if (fns.length !== 1) return { fail: [`(f) pushMorePlaceRecommendations = useCallback( 出現 ${fns.length} 次（必須 1 次）`], detail: null, nodes: null };
  const fn = fns[0];
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !fn.body || !ts.isBlock(fn.body)) return { fail: ["(f) pushMorePlaceRecommendations 的 useCallback 第 1 參數不是區塊本體函式"], detail: null, nodes: null };
  const body = [...fn.body.statements];
  const walk = (node, cb) => {
    const w = (n) => {
      cb(n);
      ts.forEachChild(n, w);
    };
    w(node);
  };
  const forbidden = (node) => {
    const hits = [];
    walk(node, (n) => {
      if (ts.isIdentifier(n)) {
        if (R21_G_CREDIT_RE.test(n.text)) hits.push({ kind: "Credits", name: n.text, pos: n.getStart(sf) });
        else if (R21_G_PLACES.has(n.text) || R21_G_PLACES_RE.test(n.text)) hits.push({ kind: "Places／Builder／Weather", name: n.text, pos: n.getStart(sf) });
      } else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && R21_G_CREDIT_STR_RE.test(n.text)) hits.push({ kind: "Credits", name: JSON.stringify(n.text), pos: n.getStart(sf) });
    });
    return hits;
  };
  const topIndexOf = (node) => body.findIndex((s) => node.getStart(sf) >= s.getStart(sf) && node.getEnd() <= s.getEnd());
  const fnStart = fn.getStart(sf);
  const fnEnd = fn.getEnd();
  // (f) legacyLabel／metadata 在函式範圍內（取代 r13 的 3000 字元視窗；indexOf 與 r13 L2361-2362 相同）
  const legacyAt = text.indexOf("const legacyLabel =");
  const creditsAt = text.indexOf('metadata: { path: "more_places", destination },');
  if (!(legacyAt > fnStart && legacyAt < fnEnd)) F("f", `const legacyLabel = 不在 pushMorePlaceRecommendations 範圍內（legacy=${legacyAt} fn=${fnStart}-${fnEnd}）`);
  if (!(creditsAt > fnStart && creditsAt < fnEnd)) F("f", `metadata: { path: "more_places", destination } 不在 pushMorePlaceRecommendations 範圍內（credits=${creditsAt} fn=${fnStart}-${fnEnd}）`);
  // (a) trustedScope
  const tsDecls = [];
  const tsAssign = [];
  walk(fn.body, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "trustedScope") tsDecls.push(n);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && n.left.text === "trustedScope") tsAssign.push(n);
  });
  const iT = body.findIndex((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => tsDecls.includes(d)));
  const tDecl = tsDecls[0];
  if (tsDecls.length !== 1) F("a", `trustedScope 宣告 ${tsDecls.length} 個（必須 1 個）`);
  if (iT < 0) F("a", "trustedScope 不是函式本體頂層宣告");
  else if (!(body[iT].declarationList.flags & ts.NodeFlags.Const)) F("a", "trustedScope 不是 const");
  if (tsAssign.length) F("a", `trustedScope 被重新指派 ${tsAssign.length} 次`);
  const tInit = tDecl?.initializer;
  const awaited = tInit && ts.isAwaitExpression(tInit) ? tInit.expression : null;
  if (!awaited || !ts.isCallExpression(awaited) || !ts.isIdentifier(awaited.expression) || awaited.expression.text !== "resolveTrustedRecommendationSearchScope") F("a", `trustedScope 初始值不是 await resolveTrustedRecommendationSearchScope(…)（實際：${tInit ? r21GNorm(tInit.getText(sf)).slice(0, 80) : "-"}）`);
  // (b) 不可信分支
  const COND = 'trustedScope.status !== "trusted"';
  const allU = [];
  walk(fn.body, (n) => {
    if (ts.isIfStatement(n) && r21GNorm(n.expression.getText(sf)) === COND) allU.push(n);
  });
  const iU = body.findIndex((s) => allU.includes(s));
  const u = iU >= 0 ? body[iU] : null;
  if (allU.length !== 1) F("b", `if (${COND}) 在函式內出現 ${allU.length} 次（必須 1 次）`);
  if (!u) F("b", `if (${COND}) 不是函式本體頂層語句`);
  if (iT >= 0 && iU >= 0 && !(iT < iU)) F("a", `trustedScope 宣告（頂層第 ${iT + 1} 句）不在不可信分支（第 ${iU + 1} 句）之前`);
  let pendingBranches = [];
  let thenStmts = [];
  if (u) {
    if (u.elseStatement) F("b", "不可信分支有 else（其他路徑可能落到扣點程式碼）");
    if (!ts.isBlock(u.thenStatement)) F("b", "不可信分支不是區塊");
    thenStmts = ts.isBlock(u.thenStatement) ? [...u.thenStatement.statements] : [u.thenStatement];
    if (!thenStmts.length || !ts.isReturnStatement(thenStmts.at(-1))) F("b", `不可信分支最後一句不是 return（L${ln(u.getStart(sf))}-${ln(u.getEnd())}；可能落到 Credits／Places）`);
    for (const h of forbidden(u.thenStatement)) F(h.kind === "Credits" ? "b" : "d", `不可信分支內有 ${h.kind} 參照 ${h.name}（L${ln(h.pos)}）`);
    // (c) Pending 安全分支
    const persists = [];
    walk(u.thenStatement, (n) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "persistSession") persists.push(n);
    });
    let pendingWrites = 0;
    for (const call of persists) {
      const a0 = call.arguments[0];
      const hasPending = Boolean(a0 && ts.isObjectLiteralExpression(a0) && a0.properties.some((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "pendingClarification"));
      if (hasPending) pendingWrites += 1;
      const es = call.parent && ts.isExpressionStatement(call.parent) ? call.parent : null;
      const blk = es?.parent && ts.isBlock(es.parent) ? es.parent : null;
      const ifs = blk?.parent && ts.isIfStatement(blk.parent) && blk.parent.thenStatement === blk ? blk.parent : null;
      if (!es || !blk || !ifs || ifs === u || !(ifs.getStart(sf) > u.getStart(sf) && ifs.getEnd() <= u.getEnd())) {
        F("c", `不可信分支內的 persistSession（L${ln(call.getStart(sf))}）不是位於分支內 if 的 then 區塊的獨立語句`);
        continue;
      }
      const st = [...blk.statements];
      const last = st.at(-1);
      if (!last || !ts.isReturnStatement(last) || st.indexOf(es) >= st.length - 1) F("c", `Pending 寫入（L${ln(call.getStart(sf))}）所在分支沒有在寫入之後以 return 結束（扣點前結束不成立）`);
      else if (hasPending) pendingBranches.push({ cond: r21GNorm(ifs.expression.getText(sf)), start: ln(ifs.getStart(sf)), end: ln(ifs.getEnd()), ret: r21GNorm(last.getText(sf)), node: ifs, retNode: last });
    }
    if (!pendingWrites) F("c", "不可信分支內沒有 persistSession({ …, pendingClarification }) 的 Pending 寫入（post-MP25 版必須有 Pending 安全分支）");
    // (f) 原 anchor 的 legacy 退出
    if (!thenStmts.some((s) => r21GNorm(s.getText(sf)) === "if (!legacyLabel) return false;")) F("f", "不可信分支沒有直接語句 if (!legacyLabel) return false;");
  }
  // (a) 不可信分支結束之前（含 trustedScope 之前）沒有 Credits／Places
  const uEnd = u ? u.getEnd() : Infinity;
  for (const h of forbidden(fn.body)) if (h.pos < uEnd && !(u && h.pos >= u.getStart(sf))) F("a", `不可信分支結束前（分支外）有 ${h.kind} 參照 ${h.name}（L${ln(h.pos)}）`);
  // (e) Credits metadata
  const metas = [];
  walk(fn.body, (n) => {
    if (ts.isObjectLiteralExpression(n) && n.properties.some((p) => ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.text === "path" && ts.isStringLiteral(p.initializer) && p.initializer.text === "more_places")) metas.push(n);
  });
  let detailE = null;
  if (metas.length !== 1) F("e", `{ path: "more_places", … } 在函式內出現 ${metas.length} 次（必須 1 次）`);
  else {
    const m = metas[0];
    const mp = m.parent;
    const holder = mp && ts.isPropertyAssignment(mp) && ts.isIdentifier(mp.name) && mp.name.text === "metadata" ? mp.parent : null;
    const call = holder && ts.isObjectLiteralExpression(holder) && holder.parent && ts.isCallExpression(holder.parent) ? holder.parent : null;
    const callee = call ? r21GNorm(call.expression.getText(sf)) : "";
    if (!call || !R21_G_CREDIT_RE.test(callee)) F("e", `more_places metadata 不是 Credits 呼叫的 metadata 參數（呼叫=${callee || "-"}）`);
    const dp = m.properties.find((p) => p.name && ts.isIdentifier(p.name) && p.name.text === "destination");
    const dRef = !dp ? null : ts.isShorthandPropertyAssignment(dp) ? "destination" : ts.isPropertyAssignment(dp) ? r21GNorm(dp.initializer.getText(sf)) : null;
    const iC = topIndexOf(m);
    if (iC < 0) F("e", "Credits metadata 所在語句不是函式本體頂層語句");
    if (iU >= 0 && iC >= 0 && !(iC > iU)) F("e", `Credits 呼叫（頂層第 ${iC + 1} 句）不在不可信分支（第 ${iU + 1} 句）之後`);
    if (dRef === "trustedScope.destination") detailE = { via: "trustedScope.destination（直接）", line: ln(m.getStart(sf)) };
    else if (dRef === "destination") {
      const dDecls = [];
      for (const p of fn.parameters) walk(p.name, (n) => {
        if (ts.isIdentifier(n) && n.text === "destination") dDecls.push({ top: -2, n });
      });
      // 只有函式本體頂層語句的宣告能遮蔽頂層 metadata；頂層解構（const { destination } = …）也算宣告（且不合格 → top=-1）
      body.forEach((s, i) => {
        if (!ts.isVariableStatement(s)) return;
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) {
            if (d.name.text === "destination") dDecls.push({ top: i, n: d });
          } else
            walk(d.name, (n) => {
              if (ts.isBindingElement(n) && ts.isIdentifier(n.name) && n.name.text === "destination") dDecls.push({ top: -1, n, at: i });
            });
        }
      });
      const before = dDecls.filter((d) => d.top === -2 || (d.top === -1 && (iC < 0 || d.at < iC)) || (d.top >= 0 && (iC < 0 || d.top < iC)));
      if (before.length !== 1 || before[0].top < 0) F("e", `metadata destination 的頂層宣告 ${before.length} 個（必須恰 1 個、且為函式本體頂層 const；參數／解構不可）`);
      else {
        const d = before[0];
        const decl = d.n;
        const isConst = Boolean(body[d.top].declarationList.flags & ts.NodeFlags.Const);
        const init = decl.initializer ? r21GNorm(decl.initializer.getText(sf)) : "";
        if (!isConst) F("e", "metadata destination 的宣告不是 const");
        if (init !== "trustedScope.destination") F("e", `metadata destination 不是來自可信目的地（const destination = ${init.slice(0, 60) || "-"}；必須 = trustedScope.destination）`);
        if (iU >= 0 && !(d.top > iU)) F("e", `const destination（頂層第 ${d.top + 1} 句）不在不可信分支之後`);
        detailE = { via: `const destination = ${init}（L${ln(decl.getStart(sf))}）`, line: ln(m.getStart(sf)), declTop: d.top, declNode: decl };
      }
    } else F("e", `metadata destination 不是 destination／trustedScope.destination（實際：${dRef ?? "缺少"}）`);
    detailE = { ...(detailE ?? {}), metaNode: m, dProp: dp ?? null };
  }
  const detail = {
    fn: `L${ln(fnStart)}-${ln(fnEnd)}`,
    trustedScope: iT >= 0 ? `頂層第 ${iT + 1} 句 L${ln(body[iT].getStart(sf))}` : "-",
    untrusted: u ? `頂層第 ${iU + 1} 句 L${ln(u.getStart(sf))}-${ln(u.getEnd())}` : "-",
    pending: pendingBranches.map((b) => `if (${b.cond.slice(0, 40)}) L${b.start}-${b.end} → ${b.ret}`),
    credits: detailE?.line ? `metadata L${detailE.line}；destination ← ${detailE.via ?? "-"}` : "-",
  };
  return { fail, detail, nodes: { sf, fn, body, tDecl, tInit, iT, u, thenStmts, pendingBranches, detailE } };
}
/** 偵測器自檢：以 AST 位置做記憶體內變異；每個變異都必須被「指定項目」抓到（不寫檔）。 */
function r21MoreContractSelfTest(ts, text) {
  const base = r21MoreContractCheck(ts, text);
  const rows = [{ label: "G00 work 原始碼（post-MP25）→ 契約成立", want: [], got: base.fail, pass: base.fail.length === 0 }];
  const N = base.nodes;
  if (!N || !N.u || !N.tDecl || !N.pendingBranches.length || !N.detailE?.metaNode) {
    rows.push({ label: "G-- 無法建立變異（work 契約結構不完整）", want: ["*"], got: base.fail, pass: false });
    return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
  }
  const sf = N.sf;
  const thenOpen = N.u.thenStatement.getStart(sf) + 1; // 「{」之後
  const pb = N.pendingBranches[0];
  const pbOpen = pb.node.thenStatement.getStart(sf) + 1;
  const ins = (pos, s) => text.slice(0, pos) + s + text.slice(pos);
  const rep = (a, b, s) => text.slice(0, a) + s + text.slice(b);
  const legacyStmt = N.thenStmts.find((s) => r21GNorm(s.getText(sf)) === "if (!legacyLabel) return false;");
  const dProp = N.detailE.dProp;
  const muts = [
    ["G01 (b) 不可信分支內加入 Credits 呼叫", "b", ins(thenOpen, "\n        await beginPlaceRecommendationCredits({ hasPlusAccess, metadata: { path: \"r21_mut\", destination: requestedDestination } });")],
    ["G02 (b) 不可信分支內加入 credits_* RPC 字串", "b", ins(thenOpen, '\n        await r21MutRpc("credits_check");')],
    ["G03 (d) 不可信分支內加入 Places 搜尋", "d", ins(thenOpen, "\n        await searchNearbyPlaces({ query: requestedDestination });")],
    ["G04 (d) Pending 分支內加入 Builder", "d", ins(pbOpen, "\n          buildMoreDestinationRecommendations();")],
    ["G05 (c) Pending 分支寫入後的 return 被移除", "c", rep(pb.retNode.getStart(sf), pb.retNode.getEnd(), "")],
    ["G06 (b) 不可信分支最後的 return 被移除（落到扣點）", "b", rep(N.thenStmts.at(-1).getStart(sf), N.thenStmts.at(-1).getEnd(), "")],
    ["G07 (b) 不可信條件被改寫（=== \"unavailable\"）", "b", rep(N.u.expression.getStart(sf), N.u.expression.getEnd(), 'trustedScope.status === "unavailable"')],
    ["G08 (a) trustedScope 之前加入 Credits（ensureSubscriptionHydratedForCredits）", "a", ins(N.fn.body.statements[N.iT].getStart(sf), "await ensureSubscriptionHydratedForCredits(conversation);\n      ")],
    ["G09 (a) trustedScope 未 await", "a", rep(N.tInit.getStart(sf), N.tInit.getEnd(), N.tInit.expression.getText(sf))],
    ["G10 (e) metadata destination 改用未確認的 requestedDestination", "e", rep(dProp.getStart(sf), dProp.getEnd(), "destination: requestedDestination")],
    ...(N.detailE.declNode?.initializer ? [["G11 (e) const destination 改為 requestedDestination", "e", rep(N.detailE.declNode.initializer.getStart(sf), N.detailE.declNode.initializer.getEnd(), "requestedDestination")]] : []),
    ...(legacyStmt ? [["G12 (f) 不可信分支的 if (!legacyLabel) return false; 被移除", "f", rep(legacyStmt.getStart(sf), legacyStmt.getEnd(), "")]] : []),
  ];
  for (const [label, tag, mutated] of muts) {
    let got;
    try {
      got = r21MoreContractCheck(ts, mutated).fail;
    } catch (e) {
      got = [`THROW:${String(e?.message ?? e).slice(0, 80)}`];
    }
    rows.push({ label, want: [tag], got, pass: got.some((m) => m.startsWith(`(${tag})`)) });
  }
  if (muts.length !== 12) rows.push({ label: `G-- 變異數 ${muts.length}（必須 12）`, want: ["*"], got: [], pass: false });
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
/** 啟用判定＋契約＋自檢（主程序；結果存 R21_STATE.mc，r13 G1／G2 patch 與報告讀取）。 */
async function r21MoreContract(appText) {
  const key = sha1Of(appText);
  if (R21_STATE.mc && R21_STATE.mc.sha === key) return R21_STATE.mc;
  const f = R21_P25_FILE; // r21-W4（A2-MP-T15）：施工後快照（post-MP25-r2 存在時優先）；契約 (a)～(f) 與自檢不變
  const want = existsSync(f) ? readFileSync(f, "utf8").split("\n").find((l) => l.endsWith(`  ${R21_G_REL}`))?.slice(0, 40) ?? null : null;
  const res = { sha: key, want, snapFile: R21_P25, active: Boolean(want) && want === key, ok: null, fail: [], detail: null, self: null };
  if (res.active) {
    try {
      const ts = (await import("typescript")).default;
      const c = r21MoreContractCheck(ts, appText);
      res.fail = c.fail;
      res.detail = c.detail;
      res.self = r21MoreContractSelfTest(ts, appText);
      if (res.self.pass !== res.self.n) res.fail.push(`(自檢) 偵測器變異自檢 ${res.self.pass}/${res.self.n}（偵測器失效）`);
    } catch (e) {
      res.fail.push(`(自檢) TypeScript AST 檢查無法執行：${String(e?.message ?? e).slice(0, 120)}`);
    }
    res.ok = res.fail.length === 0;
  }
  R21_STATE.mc = res;
  return res;
}
const sha1Of = (buf) => createHash("sha1").update(buf).digest("hex");
function r21MoreContractLines(mc) {
  if (!mc) return ["r21-G：未執行"];
  if (!mc.active) return [`r21-G（A2-MP-T14）pushMorePlaceRecommendations AST 安全契約：未啟用（work _app sha1=${mc.sha} ≠ ${mc.snapFile} ${mc.want ?? "(缺)"}）→ r13 G2S1 3000 字元視窗與 r14 A2 anchor#3 照原檢查`];
  const out = [`r21-G（A2-MP-T14）pushMorePlaceRecommendations AST 安全契約：啟用（work _app sha1=${mc.sha} ＝ ${mc.snapFile}）；契約=${mc.ok ? "成立" : "不成立 → INFRA-FAIL source anchors"}；變異自檢 ${mc.self?.pass ?? "-"}/${mc.self?.n ?? "-"}`];
  if (mc.detail) out.push(`  函式 ${mc.detail.fn}｜(a) trustedScope ${mc.detail.trustedScope}｜(b) 不可信分支 ${mc.detail.untrusted}｜(c) Pending 分支 ${mc.detail.pending.join("；") || "-"}｜(e) ${mc.detail.credits}`);
  for (const m of mc.fail) out.push(`  [NG] ${m}`);
  for (const r of mc.self?.rows ?? []) out.push(`  [${r.pass ? "OK" : "NG"}][r21-G 自檢] ${r.label}｜期望命中=${r.want.join(",") || "（無失敗）"}｜實際=${r.got.length ? r.got.map((x) => x.slice(0, 90)).join("；") : "（無失敗）"}`);
  return out;
}

// ════════════════════════ r21-F2（A2-MP-T18）：F7 施工後版本識別 trip-planning-session-reset.ts（E2）════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。使用者裁決 E2 授權修改 src/lib/ai/trip-planning-session-reset.ts；它不在 pre-G2S1 快照、也不在任何允許清單，
 * 修改後會出現在 r13 F7（L2141-2171）nowChanged → unexpected → INFRA-FAIL。比照 r21-F：只有「scratchpad/post-MP25-E2-sha.txt 存在、
 * 含該檔恰好一列（sha1＋兩空白＋相對路徑）、且該檔目前 sha1 ＝ 該列」時才移出 unexpected；不存在／缺列／多列／格式不符／sha 不符 → 照舊 INFRA-FAIL。
 * 只針對這一個檔名；其他檔案不放寬。快照檔由指派者在施工後建立（本檔只讀）。
 */
const R21_E2_REL = "src/lib/ai/trip-planning-session-reset.ts";
const R21_E2_SNAP = "post-MP25-E2-sha.txt";
/** 純判定（--probe 以記憶體內變體自檢）：snapText＝快照檔內容（null＝不存在）；nowSha＝該檔目前 sha1（null＝不存在）。 */
function r21E2Decide(snapText, nowSha, rel = R21_E2_REL) {
  if (typeof snapText !== "string") return { ok: false, reason: `${R21_E2_SNAP} 不存在 → 照舊`, want: null, now: nowSha };
  const rows = snapText.split("\n").filter((l) => l.endsWith(`  ${rel}`) || l.endsWith(` ${rel}`));
  if (rows.length !== 1) return { ok: false, reason: `${R21_E2_SNAP} 含 ${rel} ${rows.length} 列（必須恰好 1 列）→ 照舊`, want: null, now: nowSha };
  const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/);
  if (!m || m[2] !== rel) return { ok: false, reason: `${R21_E2_SNAP} 該列格式不符（必須「sha1＋兩空白＋相對路徑」）→ 照舊`, want: null, now: nowSha };
  if (typeof nowSha !== "string") return { ok: false, reason: `${rel} 不存在 → 照舊`, want: m[1], now: null };
  if (nowSha !== m[1]) return { ok: false, reason: `${rel} 目前 sha1 ≠ ${R21_E2_SNAP} → 照舊`, want: m[1], now: nowSha };
  return { ok: true, reason: `${rel} 目前 sha1 ＝ ${R21_E2_SNAP} → 移出 F7 unexpected（版本識別）`, want: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀快照與目前檔案後判定；結果記到 R21_STATE.e2（報告／--probe 顯示）。 */
function r21E2F7() {
  const f = `${PRE_DIR}/${R21_E2_SNAP}`;
  const snapText = existsSync(f) ? readFileSync(f, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_E2_REL}`;
  const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
  const r = { rel: R21_E2_REL, ...r21E2Decide(snapText, nowSha) };
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.e2 = r;
  return r;
}
function r21E2SelfTest() {
  const rel = R21_E2_REL;
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [
    ["快照不存在", null, A, false],
    ["快照沒有該檔列", `${A}  src/lib/ai/other.ts\n`, A, false],
    ["快照該列 sha 不符", `${B}  ${rel}\n`, A, false],
    ["快照該列只有一個空白", `${A} ${rel}\n`, A, false],
    ["快照該列重複兩列", `${A}  ${rel}\n${A}  ${rel}\n`, A, false],
    ["快照該列 sha 非 40 位十六進位", `${"g".repeat(40)}  ${rel}\n`, A, false],
    ["目前檔案不存在", `${A}  ${rel}\n`, null, false],
    ["快照存在、恰好一列、sha 相符", `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, true],
    ["只針對該檔：其他檔名即使 sha 相符也不放行", `${A}  src/lib/ai/other.ts\n`, A, false, "src/lib/ai/other.ts"],
  ];
  const out = rows.map(([label, text, now, want, other]) => {
    const got = other ? r21E2Decide(text, now, rel).ok : r21E2Decide(text, now).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-X4（A2-MP-T24）：F7 施工後版本識別 destination-travel-profile.ts（E2 第四檔）════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權 E2 四檔施工＋施工後快照（post-MP25-E2-r3-sha.txt）＋r21 版本識別。
 * destination-travel-profile.ts 在 pre-G2S1 快照（49 列）內、不在 PRE_FILES → E2 修改後 r13 F7 shaDiff → unexpected → INFRA-FAIL。
 * 比照 r21-F：只有「R21_P25＝post-MP25-E2-r3-sha.txt、該快照含該檔恰好一列（sha1＋兩空白＋相對路徑）、且目前 sha1 ＝ 該列」時才移出 unexpected；
 * 快照不是 r3／不存在／缺列／多列／格式不符／sha 不符／檔案不存在 → 照舊 INFRA-FAIL。只針對該檔名（判定 r21X4Decide；--probe 變體自檢）。
 */
function r21X4Decide(snapName, snapText, nowSha, rel = R21_DTP_REL) {
  if (snapName !== R21_P25_R3) return { ok: false, reason: `施工後快照＝${snapName}（不是 ${R21_P25_R3}）→ 照舊`, want: null, now: nowSha };
  if (typeof snapText !== "string") return { ok: false, reason: `${R21_P25_R3} 不存在 → 照舊`, want: null, now: nowSha };
  if (rel !== R21_DTP_REL) return { ok: false, reason: `${rel} 不是 ${R21_DTP_REL}（只針對該檔）→ 照舊`, want: null, now: nowSha };
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${rel}`));
  if (rows.length !== 1) return { ok: false, reason: `${R21_P25_R3} 含 ${rel} ${rows.length} 列（必須恰好 1 列）→ 照舊`, want: null, now: nowSha };
  const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/);
  if (!m || m[2] !== rel) return { ok: false, reason: `${R21_P25_R3} 該列格式不符（必須「sha1＋兩空白＋相對路徑」）→ 照舊`, want: null, now: nowSha };
  if (typeof nowSha !== "string") return { ok: false, reason: `${rel} 不存在 → 照舊`, want: m[1], now: null };
  if (nowSha !== m[1]) return { ok: false, reason: `${rel} 目前 sha1 ≠ ${R21_P25_R3} → 照舊`, want: m[1], now: nowSha };
  return { ok: true, reason: `${rel} 目前 sha1 ＝ ${R21_P25_R3} → 移出 F7 unexpected（版本識別）`, want: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀 R21_P25 快照與目前檔案後判定；結果記到 R21_STATE.x4。 */
function r21X4F7() {
  const snapText = existsSync(R21_P25_FILE) ? readFileSync(R21_P25_FILE, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_DTP_REL}`;
  const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
  const r = { rel: R21_DTP_REL, ...r21Y4Decide(R21_P25, snapText, nowSha) }; // r21#Y4（A2-MP-T31）：原 r21Z4Decide(R21_P25, …)；R21_P25 不是 r5 時 r21Y4Decide 原樣轉呼叫 r21Z4Decide // r21#Z4（A2-MP-T27）：原 r21X4Decide(R21_P25, …)；R21_P25 不是 r4 時 r21Z4Decide 原樣轉呼叫 r21X4Decide
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.x4 = r;
  return r;
}
function r21X4SelfTest() {
  const rel = R21_DTP_REL;
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [
    ["快照不是 post-MP25-E2-r3（r2）", R21_P25_R2, `${A}  ${rel}\n`, A, false],
    ["快照不存在", R21_P25_R3, null, A, false],
    ["快照沒有該檔列", R21_P25_R3, `${A}  src/lib/ai/other.ts\n`, A, false],
    ["快照該列 sha 不符", R21_P25_R3, `${B}  ${rel}\n`, A, false],
    ["快照該列只有一個空白", R21_P25_R3, `${A} ${rel}\n`, A, false],
    ["快照該列重複兩列", R21_P25_R3, `${A}  ${rel}\n${A}  ${rel}\n`, A, false],
    ["快照該列 sha 非 40 位十六進位", R21_P25_R3, `${"g".repeat(40)}  ${rel}\n`, A, false],
    ["目前檔案不存在", R21_P25_R3, `${A}  ${rel}\n`, null, false],
    ["快照＝r3、恰好一列、sha 相符", R21_P25_R3, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, true],
    ["只針對該檔：其他檔名即使 sha 相符也不放行", R21_P25_R3, `${A}  src/lib/ai/other.ts\n`, A, false, "src/lib/ai/other.ts"],
  ];
  const out = rows.map(([label, name, text, now, want, other]) => {
    const got = (other ? r21X4Decide(name, text, now, other) : r21X4Decide(name, text, now)).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-Z4（A2-MP-T27）：F7 destination-travel-profile.ts 在快照＝post-MP25-E2-r4 時的版本識別 ════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權第五、第六個 Source（E2c）＋施工後快照＋r21 版本識別。
 * R21_P25＝post-MP25-E2-r4 時，r4 的 dtp 列＝r3 的 dtp 列（Z0 前提保證：r4 相對 r3 只允許 ctd 不同）。以 r4 快照內容、照 r21X4Decide 的同一套條件
 * （恰好一列、格式、目前 sha1 相符、只針對 dtp）判定；快照名稱不是 r4 → 原樣轉呼叫 r21X4Decide（X4 行為逐字不變）。
 */
function r21Z4Decide(snapName, snapText, nowSha, rel = R21_DTP_REL) {
  if (snapName !== R21_P25_R4) return r21X4Decide(snapName, snapText, nowSha, rel);
  const r = r21X4Decide(R21_P25_R3, snapText, nowSha, rel);
  return { ...r, reason: `${r.reason}〔r21#Z4：快照＝${R21_P25_R4}；dtp 列取自 ${R21_P25_R4}（＝${R21_P25_R3}，Z0 保證）〕` };
}
function r21Z4SelfTest() {
  const rel = R21_DTP_REL;
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [
    ["快照＝r4、恰好一列、sha 相符", R21_P25_R4, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, true],
    ["快照＝r4、快照不存在", R21_P25_R4, null, A, false],
    ["快照＝r4、沒有該檔列", R21_P25_R4, `${A}  src/lib/ai/other.ts\n`, A, false],
    ["快照＝r4、該列 sha 不符", R21_P25_R4, `${B}  ${rel}\n`, A, false],
    ["快照＝r4、該列只有一個空白", R21_P25_R4, `${A} ${rel}\n`, A, false],
    ["快照＝r4、該列重複兩列", R21_P25_R4, `${A}  ${rel}\n${A}  ${rel}\n`, A, false],
    ["快照＝r4、目前檔案不存在", R21_P25_R4, `${A}  ${rel}\n`, null, false],
    ["快照＝r4、其他檔名即使 sha 相符也不放行", R21_P25_R4, `${A}  src/lib/ai/other.ts\n`, A, false, "src/lib/ai/other.ts"],
    ["快照＝r2：轉呼叫 r21X4Decide → 照舊", R21_P25_R2, `${A}  ${rel}\n`, A, false],
    ["快照＝r3：轉呼叫 r21X4Decide → 放行（X4 不變）", R21_P25_R3, `${A}  ${rel}\n`, A, true],
  ];
  const out = rows.map(([label, name, text, now, want, other]) => {
    const got = (other ? r21Z4Decide(name, text, now, other) : r21Z4Decide(name, text, now)).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-Y4（A2-MP-T31）：F7 destination-travel-profile.ts 在快照＝post-MP25-E2-r5 時的版本識別 ════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別。
 * R21_P25＝post-MP25-E2-r5 時，r5 的 dtp 列＝r4＝r3 的 dtp 列（Y0 前提保證：r5 相對 r4 只允許 _app 不同；Z0 保證 r4 相對 r3 只允許 ctd 不同）。
 * 以 r5 快照內容、照 r21X4Decide 的同一套條件（恰好一列、格式、目前 sha1 相符、只針對 dtp）判定；快照名稱不是 r5 → 原樣轉呼叫 r21Z4Decide（Z4／X4 行為逐字不變）。
 */
function r21Y4Decide(snapName, snapText, nowSha, rel = R21_DTP_REL) {
  if (snapName !== R21_P25_R5) return r21Z4Decide(snapName, snapText, nowSha, rel);
  const r = r21X4Decide(R21_P25_R3, snapText, nowSha, rel);
  return { ...r, reason: `${r.reason}〔r21#Y4：快照＝${R21_P25_R5}；dtp 列取自 ${R21_P25_R5}（＝${R21_P25_R4}＝${R21_P25_R3}，Y0／Z0 保證）〕` };
}
function r21Y4SelfTest() {
  const rel = R21_DTP_REL;
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [
    ["快照＝r5、恰好一列、sha 相符", R21_P25_R5, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, true],
    ["快照＝r5、快照不存在", R21_P25_R5, null, A, false],
    ["快照＝r5、沒有該檔列", R21_P25_R5, `${A}  src/lib/ai/other.ts\n`, A, false],
    ["快照＝r5、該列 sha 不符", R21_P25_R5, `${B}  ${rel}\n`, A, false],
    ["快照＝r5、該列只有一個空白", R21_P25_R5, `${A} ${rel}\n`, A, false],
    ["快照＝r5、該列重複兩列", R21_P25_R5, `${A}  ${rel}\n${A}  ${rel}\n`, A, false],
    ["快照＝r5、該列 sha 非 40 位十六進位", R21_P25_R5, `${"g".repeat(40)}  ${rel}\n`, A, false],
    ["快照＝r5、目前檔案不存在", R21_P25_R5, `${A}  ${rel}\n`, null, false],
    ["快照＝r5、其他檔名即使 sha 相符也不放行", R21_P25_R5, `${A}  src/lib/ai/other.ts\n`, A, false, "src/lib/ai/other.ts"],
    ["快照＝r4：轉呼叫 r21Z4Decide → 放行（Z4 不變）", R21_P25_R4, `${A}  ${rel}\n`, A, true],
    ["快照＝r3：轉呼叫 → r21X4Decide 放行（X4 不變）", R21_P25_R3, `${A}  ${rel}\n`, A, true],
    ["快照＝r2：轉呼叫 → 照舊", R21_P25_R2, `${A}  ${rel}\n`, A, false],
  ];
  const out = rows.map(([label, name, text, now, want, other]) => {
    const got = (other ? r21Y4Decide(name, text, now, other) : r21Y4Decide(name, text, now)).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-Y5（A2-MP-T31）：F7 施工後版本識別 trip-planning-context.ts／chat-planning-flow.ts／trip-intent.ts（E2d／E2e）════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照（post-MP25-E2f-sha.txt）＋r21 版本識別。
 * 三檔皆不在 pre-G2S1 快照（49 列）、不在任何允許清單；E2d／E2e 修改後出現在 r13 F7（L2141-2171）nowChanged → unexpected → INFRA-FAIL。
 * 比照 r21-Z5（逐檔判定）：只有「scratchpad/post-MP25-E2f-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）、且該檔目前 sha1 ＝ 該列」時才移出 unexpected；
 * 不存在／缺列／多列／格式不符／sha 不符／檔案不存在 → 照舊 INFRA-FAIL。只針對 R21_E2F_RELS 三個檔名；其他檔案不放寬。快照檔由指派者建立（本檔只讀）。
 */
function r21Y5Decide(snapText, nowSha, rel) {
  if (typeof snapText !== "string") return { ok: false, reason: `${R21_E2F_SNAP} 不存在 → 照舊`, want: null, now: nowSha };
  if (!R21_E2F_RELS.includes(rel)) return { ok: false, reason: `${rel} 不在 r21-Y5 三檔（只針對該三檔）→ 照舊`, want: null, now: nowSha };
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${rel}`));
  if (rows.length !== 1) return { ok: false, reason: `${R21_E2F_SNAP} 含 ${rel} ${rows.length} 列（必須恰好 1 列）→ 照舊`, want: null, now: nowSha };
  const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/);
  if (!m || m[2] !== rel) return { ok: false, reason: `${R21_E2F_SNAP} 該列格式不符（必須「sha1＋兩空白＋相對路徑」）→ 照舊`, want: null, now: nowSha };
  if (typeof nowSha !== "string") return { ok: false, reason: `${rel} 不存在 → 照舊`, want: m[1], now: null };
  if (nowSha !== m[1]) return { ok: false, reason: `${rel} 目前 sha1 ≠ ${R21_E2F_SNAP} → 照舊`, want: m[1], now: nowSha };
  return { ok: true, reason: `${rel} 目前 sha1 ＝ ${R21_E2F_SNAP} → 移出 F7 unexpected（版本識別）`, want: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀 post-MP25-E2f 快照與三檔目前內容後逐檔判定；結果記到 R21_STATE.y5（陣列）。 */
function r21Y5F7() {
  const f = `${PRE_DIR}/${R21_E2F_SNAP}`;
  const snapText = existsSync(f) ? readFileSync(f, "utf8") : null;
  const res = R21_E2F_RELS.map((rel) => {
    const p = `${WORK_ROOT}/${rel}`;
    const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
    return { rel, ...r21Y5Decide(snapText, nowSha, rel) };
  });
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.y5 = res;
  return res;
}
function r21Y5SelfTest() {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [];
  for (const rel of R21_E2F_RELS) {
    const sub = rel.replace(/\/([^/]+)$/, "/x/$1");
    rows.push(
      [`${rel}：快照不存在`, null, A, rel, false],
      [`${rel}：快照沒有該檔列`, `${A}  src/lib/ai/other.ts\n`, A, rel, false],
      [`${rel}：快照該列 sha 不符`, `${B}  ${rel}\n`, A, rel, false],
      [`${rel}：快照該列只有一個空白`, `${A} ${rel}\n`, A, rel, false],
      [`${rel}：快照該列重複兩列`, `${A}  ${rel}\n${A}  ${rel}\n`, A, rel, false],
      [`${rel}：快照該列 sha 非 40 位十六進位`, `${"g".repeat(40)}  ${rel}\n`, A, rel, false],
      [`${rel}：快照該列為子路徑同名檔（${sub}）`, `${A}  ${sub}\n`, A, rel, false],
      [`${rel}：目前檔案不存在`, `${A}  ${rel}\n`, null, rel, false],
      [`${rel}：快照存在、恰好一列、sha 相符`, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, rel, true],
    );
  }
  rows.push(
    ["只針對三檔：其他檔名（src/lib/ai/other.ts）即使 sha 相符也不放行", `${A}  src/lib/ai/other.ts\n`, A, "src/lib/ai/other.ts", false],
    ["只針對三檔：travel-context.ts（屬 r21-Z5）即使列於 E2f 快照且 sha 相符也不由 Y5 放行", `${A}  ${R21_TC_REL}\n`, A, R21_TC_REL, false],
    ["只針對三檔：_app.chat.tsx 即使列於 E2f 快照且 sha 相符也不由 Y5 放行", `${A}  src/routes/_app.chat.tsx\n`, A, "src/routes/_app.chat.tsx", false],
  );
  const out = rows.map(([label, text, now, rel, want]) => {
    const got = r21Y5Decide(text, now, rel).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-Z5（A2-MP-T27）：F7 施工後版本識別 travel-context.ts（E2c 第六檔）════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權第五、第六個 Source（E2c）＋施工後快照（post-MP25-E2c-sha.txt）＋r21 版本識別。
 * src/lib/ai/travel-context.ts 不在 pre-G2S1 快照（49 列）、不在任何允許清單；E2c 修改後出現在 r13 F7（L2141-2171）nowChanged → unexpected → INFRA-FAIL。
 * 比照 r21-F2：只有「scratchpad/post-MP25-E2c-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）、且該檔目前 sha1 ＝ 該列」時才移出 unexpected；
 * 不存在／缺列／多列／格式不符／sha 不符／檔案不存在 → 照舊 INFRA-FAIL。只針對這一個檔名；其他檔案不放寬。快照檔由指派者建立（本檔只讀）。
 */
function r21Z5Decide(snapText, nowSha, rel = R21_TC_REL) {
  if (typeof snapText !== "string") return { ok: false, reason: `${R21_E2C_SNAP} 不存在 → 照舊`, want: null, now: nowSha };
  if (rel !== R21_TC_REL) return { ok: false, reason: `${rel} 不是 ${R21_TC_REL}（只針對該檔）→ 照舊`, want: null, now: nowSha };
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${rel}`));
  if (rows.length !== 1) return { ok: false, reason: `${R21_E2C_SNAP} 含 ${rel} ${rows.length} 列（必須恰好 1 列）→ 照舊`, want: null, now: nowSha };
  const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/);
  if (!m || m[2] !== rel) return { ok: false, reason: `${R21_E2C_SNAP} 該列格式不符（必須「sha1＋兩空白＋相對路徑」）→ 照舊`, want: null, now: nowSha };
  if (typeof nowSha !== "string") return { ok: false, reason: `${rel} 不存在 → 照舊`, want: m[1], now: null };
  if (nowSha !== m[1]) return { ok: false, reason: `${rel} 目前 sha1 ≠ ${R21_E2C_SNAP} → 照舊`, want: m[1], now: nowSha };
  return { ok: true, reason: `${rel} 目前 sha1 ＝ ${R21_E2C_SNAP} → 移出 F7 unexpected（版本識別）`, want: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀 post-MP25-E2c 快照與目前檔案後判定；結果記到 R21_STATE.z5。 */
function r21Z5F7() {
  const f = `${PRE_DIR}/${R21_E2C_SNAP}`;
  const snapText = existsSync(f) ? readFileSync(f, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_TC_REL}`;
  const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
  const r = { rel: R21_TC_REL, ...r21Z5Decide(snapText, nowSha) };
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.z5 = r;
  return r;
}
function r21Z5SelfTest() {
  const rel = R21_TC_REL;
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rows = [
    ["快照不存在", null, A, false],
    ["快照沒有該檔列", `${A}  src/lib/ai/other.ts\n`, A, false],
    ["快照該列 sha 不符", `${B}  ${rel}\n`, A, false],
    ["快照該列只有一個空白", `${A} ${rel}\n`, A, false],
    ["快照該列重複兩列", `${A}  ${rel}\n${A}  ${rel}\n`, A, false],
    ["快照該列 sha 非 40 位十六進位", `${"g".repeat(40)}  ${rel}\n`, A, false],
    ["快照該列為子路徑同名檔（src/lib/ai/x/travel-context.ts）", `${A}  src/lib/ai/x/travel-context.ts\n`, A, false],
    ["目前檔案不存在", `${A}  ${rel}\n`, null, false],
    ["快照存在、恰好一列、sha 相符", `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, true],
    ["只針對該檔：其他檔名即使 sha 相符也不放行", `${A}  src/lib/ai/other.ts\n`, A, false, "src/lib/ai/other.ts"],
  ];
  const out = rows.map(([label, text, now, want, other]) => {
    const got = (other ? r21Z5Decide(text, now, other) : r21Z5Decide(text, now)).ok;
    return { label, want, got, pass: got === want };
  });
  return { rows: out, pass: out.filter((r) => r.pass).length, n: out.length };
}

// ════════════════════════ r21-T47（A2-MP-T47）：範圍守門 scripts/verify-negated-switch-s1s4.mjs 精確路徑＋精確 sha256 版本識別 ════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者裁決「僅允許 scripts/verify-negated-switch-s1s4.mjs；以已審查的精確 SHA-256 作為版本識別；不得使用 scripts/** 通配放行；SHA 不符：INFRA-FAIL」。
 * 該檔為未追蹤檔（git ls-files --others）、不在 pre-G2S1 快照與 pre-MP9T-test-sha.txt → r13 F7（L2158 nowChanged、L2170 unexpected）→ r21-F 區塊後仍殘留 → INFRA-FAIL（T40 Smoke）。
 * 判定（純函式 r21T47Decide；--probe 以記憶體內變體自檢，不建立任何檔案）：
 *   nowChanged 不含「與 R21_T47_REL 逐字相同」的元素 → 不處理（active=false；不放行、不寫 preInfra）。
 *   含 → 只有「常數 R21_T47_SHA256 為 64 位小寫十六進位」∧「scratchpad/T64-new-sha.txt（R21_T47_SNAP）存在」∧「該清單以『 ＋R21_T47_REL』結尾的列恰好 1 列」∧
 *        「該列逐字符合『sha256＋兩空白＋相對路徑』且路徑逐字＝R21_T47_REL」∧「該列 sha256 ＝ 常數」∧「目前檔案存在且 sha256 ＝ 常數」時才移出 unexpected；
 *        任一不成立 → infra 訊息（r21-F 區塊寫入 preInfra → INFRA-FAIL；該路徑同時留在 unexpected）。
 * 只比對這一個精確字串（Array.prototype.includes／===）；不用前綴、正則或萬用字元比對路徑。scopeFallback、pre-MP9T 清單、R21_P25 與其他白名單不變。
 */
const R21_T47_REL = "scripts/verify-negated-switch-s1s4.mjs";
const R21_T47_SHA256 = "d20c00146c16778fbe34359155a7f95f3f2f72ae15a7ecc2291b22544e10f4fb"; // 指派者計算（任務單 #64 後續，r21-T64 重新綁定 T64 版 s1s4；scratchpad/T64-new-sha.txt）
const R21_T47_SNAP = "T64-new-sha.txt"; // r21-T47／r21-T54／r21-T56／r21-T61／r21-T64：只讀
const R21_T47_OLD_SHA256 = "64b785440e79aa1966135928306f9121f7cf44442678079704f5b41990aed225"; // r21-T64：上一版（T61 版，過時）sha256，只供 --probe 自檢證明會被判為不符（不參與判定、不是白名單）
const R21_T47_OLDER_SHA256 = "d0a248bded898dc106f1b421db8e442529e10c782ecd89426c3ad5304e12a758"; // r21-T64：上上版（T56 版，過時）sha256，只供 --probe 自檢（不參與判定、不是白名單）
const R21_T47_OLDER2_SHA256 = "9bdce0b9229f50ffa87d465c9d355668103f6cc723180cb6330b518c3880c79b"; // r21-T64：第三舊（T53 版，過時）sha256，只供 --probe 自檢（不參與判定、不是白名單）
const R21_T47_OLDEST_SHA256 = "1b94b01d19eb9ef1caad993a07cd8f2c2b398799f1ee04875b558115d1afb090"; // r21-T56：最舊（T46 版，過時）sha256，只供 --probe 自檢（不參與判定、不是白名單）
/** 純判定：nowChanged＝r13 F7 nowChanged 陣列；snapText＝T64-new-sha.txt（R21_T47_SNAP）內容（null＝不存在）；nowSha＝該檔目前 sha256（null＝不存在）；constSha＝常數（--probe 注入變體）。 */
function r21T47Decide(nowChanged, snapText, nowSha, constSha = R21_T47_SHA256) {
  const rel = R21_T47_REL;
  if (!(Array.isArray(nowChanged) && nowChanged.includes(rel))) return { rel, active: false, ok: false, infra: null, reason: `${rel} 不在 nowChanged → 不處理`, want: constSha, list: null, now: nowSha };
  const bad = (why, list = null) => ({ rel, active: true, ok: false, infra: `r21-T47 範圍守門版本識別：${rel} ${why} → INFRA-FAIL（不放行）`, reason: `${why} → INFRA-FAIL`, want: constSha, list, now: nowSha });
  if (typeof constSha !== "string" || !/^[0-9a-f]{64}$/.test(constSha)) return bad("常數 R21_T47_SHA256 格式不符（必須 64 位小寫十六進位）");
  if (typeof snapText !== "string") return bad(`${R21_T47_SNAP} 不存在`);
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${rel}`));
  if (rows.length !== 1) return bad(`${R21_T47_SNAP} 含該路徑 ${rows.length} 列（必須恰好 1 列）`);
  const m = rows[0].match(/^([0-9a-f]{64}) {2}(.+)$/);
  if (!m || m[2] !== rel) return bad(`${R21_T47_SNAP} 該列格式不符（必須「sha256＋兩空白＋相對路徑」）`);
  if (m[1] !== constSha) return bad(`常數 ${constSha} ≠ ${R21_T47_SNAP} 該列 ${m[1]}（常數與清單不一致）`, m[1]);
  if (typeof nowSha !== "string") return bad("目前檔案不存在", m[1]);
  if (nowSha !== constSha) return bad(`目前 sha256 ${nowSha} ≠ 常數＝${R21_T47_SNAP} ${constSha}`, m[1]);
  return { rel, active: true, ok: true, infra: null, reason: `目前 sha256 ＝ 常數 ＝ ${R21_T47_SNAP} 該列 → 移出 F7 unexpected（版本識別）`, want: constSha, list: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀 T64-new-sha.txt（R21_T47_SNAP）與目前檔案 sha256 後判定；結果記到 R21_STATE.t47（報告／--probe 顯示）。 */
function r21T47F7(nowChanged) {
  const f = `${PRE_DIR}/${R21_T47_SNAP}`;
  const snapText = existsSync(f) ? readFileSync(f, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_T47_REL}`;
  const nowSha = existsSync(p) ? sha256(readFileSync(p)) : null;
  const r = r21T47Decide(nowChanged, snapText, nowSha);
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.t47 = r;
  return r;
}
/** --probe 自檢（記憶體內變體；不建立檔案）。neu＝r21-F patch neu（實際 patch 行以 new Function 執行，stub 注入判定）。 */
function r21T47SelfTest(neu) {
  const rel = R21_T47_REL;
  const K = R21_T47_SHA256;
  const X = "c".repeat(64);
  const row = (s, r = rel) => `${s}  ${r}\n`;
  const okList = `${"d".repeat(64)}  scripts/verify-more-places-destination-switch-mp25-r4.mjs\n${row(K)}`;
  const rows = [];
  const add = (label, pass, note) => rows.push({ label, pass: Boolean(pass), note });
  const D = (nc, text, now, c) => (c === undefined ? r21T47Decide(nc, text, now) : r21T47Decide(nc, text, now, c));
  const isOk = (r) => r.active && r.ok && r.infra === null;
  const isInfra = (r) => r.active && !r.ok && typeof r.infra === "string" && r.infra.includes("INFRA-FAIL");
  // (1) 純判定
  add("sha 相符（目前＝常數＝清單恰好一列）→ 放行", isOk(D([rel], okList, K)));
  add("目前檔案 sha256 ≠ 常數 → INFRA", isInfra(D([rel], okList, X)) && /目前 sha256/.test(D([rel], okList, X).infra));
  add("清單檔不存在 → INFRA", isInfra(D([rel], null, K)) && /不存在/.test(D([rel], null, K).infra));
  add("清單缺該路徑列 → INFRA", isInfra(D([rel], `${K}  scripts/other.mjs\n`, K)) && /0 列/.test(D([rel], `${K}  scripts/other.mjs\n`, K).infra));
  add("清單多列（同路徑兩列、同 sha）→ INFRA", isInfra(D([rel], `${row(K)}${row(K)}`, K)) && /2 列/.test(D([rel], `${row(K)}${row(K)}`, K).infra));
  add("清單多列（同路徑兩列、不同 sha）→ INFRA", isInfra(D([rel], `${row(K)}${row(X)}`, K)));
  add("清單該列只有一個空白 → INFRA（格式）", isInfra(D([rel], `${K} ${rel}\n`, K)) && /格式不符/.test(D([rel], `${K} ${rel}\n`, K).infra));
  add("清單該列 sha 為大寫十六進位 → INFRA（格式）", isInfra(D([rel], row(K.toUpperCase()), K)));
  add("清單該列 sha 為 40 位（sha1 長度）→ INFRA（格式）", isInfra(D([rel], row(K.slice(0, 40)), K)));
  add("清單該列行尾有 \\r → INFRA（0 列）", isInfra(D([rel], `${K}  ${rel}\r\n`, K)));
  add("清單該列路徑為 .bak（scripts/verify-negated-switch-s1s4.mjs.bak）→ INFRA（0 列）", isInfra(D([rel], row(K, `${rel}.bak`), K)));
  add("清單該列路徑為前綴變化（x/scripts/…）→ INFRA（0 列）", isInfra(D([rel], row(K, `x/${rel}`), K)));
  add("常數與清單不一致（目前＝清單 ≠ 常數）→ INFRA", isInfra(D([rel], row(X), X)) && /常數與清單不一致/.test(D([rel], row(X), X).infra));
  add("常數與清單不一致（目前＝常數 ≠ 清單）→ INFRA", isInfra(D([rel], row(X), K)) && /常數與清單不一致/.test(D([rel], row(X), K).infra));
  add("注入常數與清單不一致（常數＝X、清單＝目前＝K）→ INFRA", isInfra(D([rel], okList, K, X)));
  add("常數格式不符（空字串）→ INFRA", isInfra(D([rel], okList, K, "")));
  add("目前檔案不存在（路徑在 nowChanged）→ INFRA", isInfra(D([rel], okList, null)));
  const nn = D(["src/lib/ai/a.ts"], null, null);
  add("該路徑不在 nowChanged → 不處理（不放行、不 INFRA；即使清單不存在）", nn.active === false && nn.ok === false && nn.infra === null);
  add("nowChanged 非陣列 → 不處理（不放行）", D(null, okList, K).active === false && D(null, okList, K).ok === false);
  // (1b) r21-T54／r21-T56／r21-T61／r21-T64：重新綁定 T64 版 s1s4；所有舊 sha 必須被判為不符 → INFRA-FAIL
  // r21-T64（T63 第 3 項）：四個舊 sha（上一版 64b78544…／上上版 d0a248bd…／第三舊 9bdce0b9…／最舊 1b94b01d…）一律套用同一組檢查（T54／T56 版嚴格度）：
  //   目前檔案＝舊 → INFRA＋/目前 sha256/＋訊息含該舊 sha；清單列＝舊 → INFRA＋/常數與清單不一致/；注入常數＝舊 → INFRA＋/常數與清單不一致/；
  //   常數（預設）＋清單＝目前＝舊 → INFRA＋/常數與清單不一致/（補回原因正則；不得以過時 SHA 冒充新版）。
  const OLD = R21_T47_OLD_SHA256;
  const STALE = [
    ["上一版（T61 版）", "64b78544…0aed225", OLD, "64b785440e79aa1966135928306f9121f7cf44442678079704f5b41990aed225"],
    ["上上版（T56 版）", "d0a248bd…e12a758", R21_T47_OLDER_SHA256, "d0a248bded898dc106f1b421db8e442529e10c782ecd89426c3ad5304e12a758"],
    ["第三舊（T53 版）", "9bdce0b9…80c79b", R21_T47_OLDER2_SHA256, "9bdce0b9229f50ffa87d465c9d355668103f6cc723180cb6330b518c3880c79b"],
    ["最舊（T46 版）", "1b94b01d…afb090", R21_T47_OLDEST_SHA256, "1b94b01d19eb9ef1caad993a07cd8f2c2b398799f1ee04875b558115d1afb090"],
  ];
  add("r21-T64 綁定：常數 R21_T47_SHA256 ＝ T64 版 d20c0014…e10f4fb、清單＝T64-new-sha.txt", K === "d20c00146c16778fbe34359155a7f95f3f2f72ae15a7ecc2291b22544e10f4fb" && R21_T47_SNAP === "T64-new-sha.txt", `${K.slice(0, 8)}…／${R21_T47_SNAP}`);
  add("r21-T64：四個舊 sha 皆＝預期值、格式為 64 位小寫十六進位、彼此不同且皆 ≠ 新常數（自檢前提）", STALE.every(([, , s, want]) => s === want && /^[0-9a-f]{64}$/.test(s) && s !== K) && new Set(STALE.map(([, , s]) => s)).size === STALE.length);
  for (const [name, short, S] of STALE) {
    add(`r21-T64：${name} sha ${short}：目前檔案＝舊（常數＝清單＝新）→ INFRA（目前 sha256 不符）`, isInfra(D([rel], okList, S)) && /目前 sha256/.test(D([rel], okList, S).infra) && D([rel], okList, S).infra.includes(S));
    add(`r21-T64：${name} sha ${short}：清單該列＝舊（常數＝目前＝新）→ INFRA（常數與清單不一致）`, isInfra(D([rel], row(S), K)) && /常數與清單不一致/.test(D([rel], row(S), K).infra));
    add(`r21-T64：${name} sha ${short}：注入常數＝舊（清單＝目前＝新）→ INFRA（常數與清單不一致）`, isInfra(D([rel], okList, K, S)) && /常數與清單不一致/.test(D([rel], okList, K, S).infra));
    add(`r21-T64：${name} sha ${short}：常數（預設）＋清單＝目前＝舊 → INFRA（常數與清單不一致；不得以過時 SHA 冒充新版）`, isInfra(D([rel], row(S), S)) && /常數與清單不一致/.test(D([rel], row(S), S).infra));
  }
  // (2) 路徑只比對精確字串：變化形式不觸發 T47（不放行；由 (3) 證明照舊 INFRA）
  const VAR = [
    ["其他未追蹤 scripts/verify-*.mjs（同目錄假名稱 verify-negated-switch-s1s5.mjs，只在記憶體）", "scripts/verify-negated-switch-s1s5.mjs"],
    ["其他未追蹤 scripts/verify-*.mjs（假名稱 verify-zz-fake.mjs，只在記憶體）", "scripts/verify-zz-fake.mjs"],
    ["大小寫變化 scripts/Verify-Negated-Switch-S1S4.mjs", "scripts/Verify-Negated-Switch-S1S4.mjs"],
    ["大小寫變化 Scripts/verify-negated-switch-s1s4.mjs", `S${rel.slice(1)}`],
    ["後綴變化 scripts/verify-negated-switch-s1s4.mjs.bak", `${rel}.bak`],
    ["前綴變化 ./scripts/verify-negated-switch-s1s4.mjs", `./${rel}`],
    ["前綴變化 絕對路徑", `${WORK_ROOT}/${rel}`],
    ["前後空白變化", ` ${rel}`],
    ["子目錄同名 scripts/x/verify-negated-switch-s1s4.mjs", "scripts/x/verify-negated-switch-s1s4.mjs"],
  ];
  for (const [label, v] of VAR) {
    const r = D([v], `${row(K)}${row(K, v)}`, K);
    add(`${label}：T47 不觸發（不放行）`, r.active === false && r.ok === false);
  }
  // (3) 實際 r21-F patch 行（new Function 執行；stub 注入判定）＋其後原有 splice／unexpected 判定（照 r21-F neu 逐字邏輯）
  const lines = String(neu ?? "").split("\n").filter((l) => l.includes(".t47F7(nowChanged)"));
  add("r21-F neu 含 T47 行恰好 1 次；不含萬用字元／前綴比對", lines.length === 1 && !/startsWith|RegExp|\.test\(|\*\*/.test(lines[0] ?? ""), lines.length);
  if (lines.length === 1) {
    try {
      const run = (nowChanged, text, now, c) => {
        const r21F7Ok = new Set();
        const preInfra = [];
        const stub = { r15: { r16: { r17: { r18: { r19: { r20: { r21: { t47F7: (nc) => D(nc, text, now, c) } } } } } } } };
        new Function("__r14", "nowChanged", "r21F7Ok", "preInfra", lines[0])(stub, nowChanged, r21F7Ok, preInfra);
        const unexpected = [...nowChanged];
        for (let i = unexpected.length - 1; i >= 0; i -= 1) if (r21F7Ok.has(unexpected[i])) unexpected.splice(i, 1);
        if (unexpected.length) preInfra.push(`F7 開始後除 3 檔外還有變動：${unexpected.join(", ")}`);
        return { ok: [...r21F7Ok], preInfra };
      };
      const a = run([rel], okList, K);
      add("實際 patch 行：sha 相符 → 移出 unexpected、preInfra 空（放行）", a.preInfra.length === 0 && a.ok.length === 1 && a.ok[0] === rel);
      const b = run([rel], okList, X);
      add("實際 patch 行：sha 不符 → preInfra 有 r21-T47 INFRA ＋ 原 unexpected INFRA", b.ok.length === 0 && b.preInfra.length === 2 && /^r21-T47/.test(b.preInfra[0]) && b.preInfra[1].includes(rel));
      const c = run([rel], null, K);
      add("實際 patch 行：清單不存在 → INFRA", c.ok.length === 0 && c.preInfra.some((x) => /^r21-T47.*不存在/.test(x)));
      const d = run([rel], `${row(K)}${row(K)}`, K);
      add("實際 patch 行：清單多列 → INFRA", d.ok.length === 0 && d.preInfra.some((x) => /^r21-T47.*2 列/.test(x)));
      const e = run([rel], row(X), X);
      add("實際 patch 行：常數與清單不一致 → INFRA", e.ok.length === 0 && e.preInfra.some((x) => /^r21-T47.*常數與清單不一致/.test(x)));
      const o = run([rel], okList, OLD);
      add("實際 patch 行（r21-T54／r21-T56／r21-T61／r21-T64）：目前檔案＝上一版 sha 64b78544… → 不放行、preInfra 有 r21-T47 INFRA ＋ 原 unexpected INFRA", o.ok.length === 0 && o.preInfra.length === 2 && /^r21-T47.*目前 sha256/.test(o.preInfra[0]) && o.preInfra[1].includes(rel));
      const f = run(["src/lib/ai/a.ts"], null, null);
      add("實際 patch 行：該路徑不在 nowChanged → 不寫 T47 preInfra（其餘照舊）", f.ok.length === 0 && f.preInfra.length === 1 && !/r21-T47/.test(f.preInfra[0]));
      for (const [label, v] of VAR) {
        const g = run([rel, v], okList, K);
        add(`實際 patch 行：${label} 與本檔並存 → 只放行精確路徑，變化路徑仍 INFRA`, g.ok.length === 1 && g.ok[0] === rel && g.preInfra.length === 1 && g.preInfra[0] === `F7 開始後除 3 檔外還有變動：${v}`);
      }
    } catch (err) {
      add(`實際 patch 行執行失敗：${String(err?.message ?? err).slice(0, 160)}`, false);
    }
  }
  // (4) 實際狀態（只讀）：常數＝scratchpad/T64-new-sha.txt（R21_T47_SNAP）該列；目前檔案以「在 nowChanged」判定
  const snapF = `${PRE_DIR}/${R21_T47_SNAP}`;
  const snapText = existsSync(snapF) ? readFileSync(snapF, "utf8") : null;
  const listRows = typeof snapText === "string" ? snapText.split("\n").filter((l) => l.endsWith(` ${rel}`)) : [];
  add(`實際 ${R21_T47_SNAP} 含該路徑恰好 1 列且 sha256 ＝ 常數`, listRows.length === 1 && listRows[0] === `${K}  ${rel}`, listRows.length);
  const cur = r21T47Decide([rel], snapText, existsSync(`${WORK_ROOT}/${rel}`) ? sha256(readFileSync(`${WORK_ROOT}/${rel}`)) : null);
  add(`實際狀態（假設在 nowChanged）：${cur.reason}`, isOk(cur), `目前=${cur.now ?? "-"}`);
  // r21-T64：過時清單 T61-new-sha.txt（只讀；不修改；T46／T53／T56-new-sha.txt 不再讀取）若被當成清單 → 該列為上一版 sha → 常數與清單不一致 → INFRA
  // 說明：r21T47Decide（逐字不改）的訊息一律以常數 R21_T47_SNAP（＝T64-new-sha.txt）稱呼清單；此處代入的其實是 T61-new-sha.txt 內容，
  //   因此 note 只在顯示時把「T64-new-sha.txt 該列」改寫為「代入的過時清單 T61-new-sha.txt 該列」（判定結果與 isInfra 檢查使用原始回傳值，不受影響）。
  const oldF = `${PRE_DIR}/T61-new-sha.txt`;
  const oldText = existsSync(oldF) ? readFileSync(oldF, "utf8") : null;
  const oldCur = r21T47Decide([rel], oldText, cur.now);
  const oldNote = oldText === null ? "T61-new-sha.txt 不存在" : String(oldCur.reason ?? "").split(`${R21_T47_SNAP} 該列`).join("代入的過時清單 T61-new-sha.txt 該列");
  add("r21-T64 實際過時清單 T61-new-sha.txt（只讀）代入判定 → INFRA（常數與清單不一致；不得以過時 SHA 冒充新版；r21T47Decide 訊息中的清單名稱是常數 R21_T47_SNAP，顯示時已改寫為實際代入的 T61-new-sha.txt）", isInfra(oldCur) && /常數與清單不一致/.test(oldCur.infra ?? ""), oldNote);
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length, cur };
}

// ════════════════════════ r21-A2SRC（任務單 #104）：範圍守門 scripts/verify-a2-source-scenarios.mjs 精確路徑＋精確 sha256 版本識別 ════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：任務單 #104（A2 方案 A）「只新增一項精確白名單，放行 scripts/verify-a2-source-scenarios.mjs（定版 sha256 bb33aa71…57d83677）；
 * 不得使用 glob／regex 擴大放行；不得利用 r13 L2169 既有 regex」。完全比照 r21-T47（r21T47Decide 逐字不變、不共用常數）。
 * 該檔為未追蹤檔、不在 pre-G2S1 快照與 pre-MP9T-test-sha.txt → r13 F7（L2158 nowChanged、L2170 unexpected）→ r21-F 區塊（含 T34 後備）後仍殘留 → INFRA-FAIL pre tree。
 * 判定（純函式 r21A2SrcDecide；--probe 以記憶體內變體自檢，不建立、不修改任何檔案）：
 *   nowChanged 不含「與 R21_A2SRC_REL 逐字相同」的元素 → 不處理（active=false；不放行、不寫 preInfra）。
 *   含 → 只有「常數 R21_A2SRC_SHA256 為 64 位小寫十六進位」∧「scratchpad/A2SRC-new-sha.txt（R21_A2SRC_SNAP）存在」∧「該清單以『 ＋R21_A2SRC_REL』結尾的列恰好 1 列」∧
 *        「該列逐字符合『sha256＋兩空白＋相對路徑』且路徑逐字＝R21_A2SRC_REL」∧「該列 sha256 ＝ 常數」∧「目前檔案存在且 sha256 ＝ 常數」時才移出 unexpected；
 *        任一不成立 → infra 訊息（r21-F 區塊寫入 preInfra → INFRA-FAIL；該路徑同時留在 unexpected）。
 * 只比對這一個精確字串（Array.prototype.includes／===）；不用前綴、正則或萬用字元比對路徑。scopeFallback、pre-MP9T 清單、R21_P25、r21-T47 與其他白名單不變。
 */
const R21_A2SRC_REL = "scripts/verify-a2-source-scenarios.mjs";
const R21_A2SRC_SHA256 = "bb33aa711d6f21869ff11572b97649c16d87cc6ccbdd63e56337e89857d83677"; // 指派者定版（任務單 #104；scratchpad/A2SRC-new-sha.txt）
const R21_A2SRC_SNAP = "A2SRC-new-sha.txt"; // r21-A2SRC：只讀（指派者建立；r21 任何模式都不修改）
/** 純判定：nowChanged＝r13 F7 nowChanged 陣列；snapText＝A2SRC-new-sha.txt（R21_A2SRC_SNAP）內容（null＝不存在）；nowSha＝該檔目前 sha256（null＝不存在）；constSha＝常數（--probe 注入變體）。 */
function r21A2SrcDecide(nowChanged, snapText, nowSha, constSha = R21_A2SRC_SHA256) {
  const rel = R21_A2SRC_REL;
  if (!(Array.isArray(nowChanged) && nowChanged.includes(rel))) return { rel, active: false, ok: false, infra: null, reason: `${rel} 不在 nowChanged → 不處理`, want: constSha, list: null, now: nowSha };
  const bad = (why, list = null) => ({ rel, active: true, ok: false, infra: `r21-A2SRC 範圍守門版本識別：${rel} ${why} → INFRA-FAIL（不放行）`, reason: `${why} → INFRA-FAIL`, want: constSha, list, now: nowSha });
  if (typeof constSha !== "string" || !/^[0-9a-f]{64}$/.test(constSha)) return bad("常數 R21_A2SRC_SHA256 格式不符（必須 64 位小寫十六進位）");
  if (typeof snapText !== "string") return bad(`${R21_A2SRC_SNAP} 不存在`);
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${rel}`));
  if (rows.length !== 1) return bad(`${R21_A2SRC_SNAP} 含該路徑 ${rows.length} 列（必須恰好 1 列）`);
  const m = rows[0].match(/^([0-9a-f]{64}) {2}(.+)$/);
  if (!m || m[2] !== rel) return bad(`${R21_A2SRC_SNAP} 該列格式不符（必須「sha256＋兩空白＋相對路徑」）`);
  if (m[1] !== constSha) return bad(`常數 ${constSha} ≠ ${R21_A2SRC_SNAP} 該列 ${m[1]}（常數與清單不一致）`, m[1]);
  if (typeof nowSha !== "string") return bad("目前檔案不存在", m[1]);
  if (nowSha !== constSha) return bad(`目前 sha256 ${nowSha} ≠ 常數＝${R21_A2SRC_SNAP} ${constSha}`, m[1]);
  return { rel, active: true, ok: true, infra: null, reason: `目前 sha256 ＝ 常數 ＝ ${R21_A2SRC_SNAP} 該列 → 移出 F7 unexpected（版本識別）`, want: constSha, list: m[1], now: nowSha };
}
/** r13 F7 patch 呼叫（主程序）：讀 A2SRC-new-sha.txt（R21_A2SRC_SNAP）與目前檔案 sha256 後判定（只讀）；結果記到 R21_STATE.a2src（報告顯示）。 */
function r21A2SrcF7(nowChanged) {
  const f = `${PRE_DIR}/${R21_A2SRC_SNAP}`;
  const snapText = existsSync(f) ? readFileSync(f, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_A2SRC_REL}`;
  const nowSha = existsSync(p) ? sha256(readFileSync(p)) : null;
  const r = r21A2SrcDecide(nowChanged, snapText, nowSha);
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.a2src = r;
  return r;
}
/** --probe 自檢（記憶體內變體；不建立、不修改任何檔案）。neu＝r21-F patch neu（實際 patch 行以 new Function 執行，stub 注入判定）。 */
function r21A2SrcSelfTest(neu) {
  const rel = R21_A2SRC_REL;
  const K = R21_A2SRC_SHA256;
  const X = "c".repeat(64);
  const row = (s, r = rel) => `${s}  ${r}\n`;
  const okList = `${"d".repeat(64)}  scripts/verify-negated-switch-s1s4.mjs\n${row(K)}`;
  const rows = [];
  const add = (label, pass, note) => rows.push({ label, pass: Boolean(pass), note });
  const D = (nc, text, now, c) => (c === undefined ? r21A2SrcDecide(nc, text, now) : r21A2SrcDecide(nc, text, now, c));
  const isOk = (r) => r.active && r.ok && r.infra === null;
  const isInfra = (r) => r.active && !r.ok && typeof r.infra === "string" && r.infra.includes("INFRA-FAIL");
  const why = (r, re) => isInfra(r) && re.test(r.infra);
  // (0) 綁定前提
  add("r21-A2SRC 綁定：常數＝bb33aa71…57d83677（64 位小寫十六進位）、清單＝A2SRC-new-sha.txt、路徑＝scripts/verify-a2-source-scenarios.mjs", K === "bb33aa711d6f21869ff11572b97649c16d87cc6ccbdd63e56337e89857d83677" && /^[0-9a-f]{64}$/.test(K) && R21_A2SRC_SNAP === "A2SRC-new-sha.txt" && rel === "scripts/verify-a2-source-scenarios.mjs" && rel !== R21_T47_REL && K !== R21_T47_SHA256, `${K.slice(0, 8)}…／${R21_A2SRC_SNAP}`);
  // (1) 純判定
  add("正例：sha 相符（目前＝常數＝清單恰好一列）→ 放行", isOk(D([rel], okList, K)));
  add("負例 sha 不符：目前檔案 sha256 ≠ 常數 → INFRA（目前 sha256）", why(D([rel], okList, X), /目前 sha256/));
  add("負例 檔案缺：目前檔案不存在（路徑在 nowChanged）→ INFRA（目前檔案不存在）", why(D([rel], okList, null), /目前檔案不存在/));
  add("負例 清單缺：A2SRC-new-sha.txt 不存在 → INFRA（不存在）", why(D([rel], null, K), /A2SRC-new-sha\.txt 不存在/));
  add("負例 清單缺該路徑列 → INFRA（0 列）", why(D([rel], `${K}  scripts/other.mjs\n`, K), /0 列/));
  add("負例 清單空字串 → INFRA（0 列）", why(D([rel], "", K), /0 列/));
  add("負例 清單多列（同路徑兩列、同 sha）→ INFRA（2 列）", why(D([rel], `${row(K)}${row(K)}`, K), /2 列/));
  add("負例 清單多列（同路徑兩列、不同 sha）→ INFRA（2 列）", why(D([rel], `${row(K)}${row(X)}`, K), /2 列/));
  add("負例 清單多列（兩空白列＋單空白列同路徑）→ INFRA（2 列）", why(D([rel], `${row(K)}${K} ${rel}\n`, K), /2 列/));
  add("負例 清單格式：只有一個空白 → INFRA（格式不符）", why(D([rel], `${K} ${rel}\n`, K), /格式不符/));
  add("負例 清單格式：三個空白 → INFRA（格式不符）", why(D([rel], `${K}   ${rel}\n`, K), /格式不符/));
  add("負例 清單格式：Tab 分隔 → INFRA（0 列）", why(D([rel], `${K}\t${rel}\n`, K), /0 列/));
  add("負例 清單格式：sha 為大寫十六進位 → INFRA（格式不符）", why(D([rel], row(K.toUpperCase()), K), /格式不符/));
  add("負例 清單格式：sha 為 40 位（sha1 長度）→ INFRA（格式不符）", why(D([rel], row(K.slice(0, 40)), K), /格式不符/));
  add("負例 清單格式：行首多空白 → INFRA（格式不符）", why(D([rel], ` ${row(K)}`, K), /格式不符/));
  add("負例 清單格式：行尾有 \\r → INFRA（0 列）", why(D([rel], `${K}  ${rel}\r\n`, K), /0 列/));
  add("負例 清單該列路徑大小寫不同（Verify-A2-…）→ INFRA（0 列）", why(D([rel], row(K, "scripts/Verify-A2-Source-Scenarios.mjs"), K), /0 列/));
  add("負例 清單該列副檔名不同（.js）→ INFRA（0 列）", why(D([rel], row(K, "scripts/verify-a2-source-scenarios.js"), K), /0 列/));
  add("負例 清單該列後綴變化（.mjs.bak）→ INFRA（0 列）", why(D([rel], row(K, `${rel}.bak`), K), /0 列/));
  add("負例 清單該列前綴變化（x/scripts/…）→ INFRA（0 列）", why(D([rel], row(K, `x/${rel}`), K), /0 列/));
  add("負例 清單該列前綴變化（空白＋./scripts/… 不以「 ＋REL」結尾）→ INFRA（0 列）", why(D([rel], row(K, `./${rel}`), K), /0 列/));
  add("負例 常數與清單不一致（目前＝清單 ≠ 常數；舊版檔冒充）→ INFRA（常數與清單不一致）", why(D([rel], row(X), X), /常數與清單不一致/));
  add("負例 常數與清單不一致（目前＝常數 ≠ 清單）→ INFRA（常數與清單不一致）", why(D([rel], row(X), K), /常數與清單不一致/));
  add("負例 舊版檔冒充：目前檔案＝舊 sha（常數＝清單＝定版）→ INFRA（目前 sha256；訊息含舊 sha）", why(D([rel], okList, X), /目前 sha256/) && D([rel], okList, X).infra.includes(X));
  add("負例 注入常數＝舊 sha（清單＝目前＝定版）→ INFRA（常數與清單不一致）", why(D([rel], okList, K, X), /常數與清單不一致/));
  add("負例 常數格式錯：空字串 → INFRA（常數格式不符）", why(D([rel], okList, K, ""), /常數 R21_A2SRC_SHA256 格式不符/));
  add("負例 常數格式錯：大寫十六進位 → INFRA（常數格式不符）", why(D([rel], row(K.toUpperCase()), K.toUpperCase(), K.toUpperCase()), /常數 R21_A2SRC_SHA256 格式不符/));
  add("負例 常數格式錯：63 位 → INFRA（常數格式不符）", why(D([rel], okList, K, K.slice(1)), /常數 R21_A2SRC_SHA256 格式不符/));
  add("負例 常數格式錯：40 位（sha1）→ INFRA（常數格式不符）", why(D([rel], okList, K, K.slice(0, 40)), /常數 R21_A2SRC_SHA256 格式不符/));
  add("負例 常數格式錯：null → INFRA（常數格式不符）", why(D([rel], okList, K, null), /常數 R21_A2SRC_SHA256 格式不符/));
  add("負例 常數格式錯：含非十六進位字元 → INFRA（常數格式不符）", why(D([rel], okList, K, `g${K.slice(1)}`), /常數 R21_A2SRC_SHA256 格式不符/));
  const nn = D(["src/lib/ai/a.ts"], null, null);
  add("該路徑不在 nowChanged → 不處理（不放行、不 INFRA；即使清單不存在）", nn.active === false && nn.ok === false && nn.infra === null);
  add("nowChanged 非陣列（null／字串）→ 不處理（不放行）", [null, rel].every((nc) => D(nc, okList, K).active === false && D(nc, okList, K).ok === false));
  // (2) 路徑只比對精確字串：變化形式／其他檔名不觸發 A2SRC（不放行；由 (3) 證明照舊 INFRA）
  const VAR = [
    ["路徑大小寫不同 scripts/Verify-A2-Source-Scenarios.mjs", "scripts/Verify-A2-Source-Scenarios.mjs"],
    ["路徑大小寫不同 Scripts/verify-a2-source-scenarios.mjs", `S${rel.slice(1)}`],
    ["路徑大小寫不同 scripts/verify-A2-source-scenarios.mjs", "scripts/verify-A2-source-scenarios.mjs"],
    ["副檔名不同 .js", "scripts/verify-a2-source-scenarios.js"],
    ["副檔名不同 .cjs", "scripts/verify-a2-source-scenarios.cjs"],
    ["副檔名不同 .MJS", "scripts/verify-a2-source-scenarios.MJS"],
    ["後綴變化 .mjs.bak", `${rel}.bak`],
    ["前綴變化 ./scripts/…", `./${rel}`],
    ["前綴變化 絕對路徑", `${WORK_ROOT}/${rel}`],
    ["前後空白變化（前）", ` ${rel}`],
    ["前後空白變化（後）", `${rel} `],
    ["子目錄同名 scripts/x/verify-a2-source-scenarios.mjs", "scripts/x/verify-a2-source-scenarios.mjs"],
    ["其他檔名 scripts/verify-a2-source-scenario.mjs（少 s）", "scripts/verify-a2-source-scenario.mjs"],
    ["其他檔名 scripts/verify-a2-source-scenarios-v2.mjs", "scripts/verify-a2-source-scenarios-v2.mjs"],
    ["其他檔名 scripts/verify-a3-source-scenarios.mjs", "scripts/verify-a3-source-scenarios.mjs"],
    ["其他未授權 scripts/verify-zz-fake.mjs（只在記憶體）", "scripts/verify-zz-fake.mjs"],
    ["其他已白名單檔 scripts/verify-negated-switch-s1s4.mjs（A2SRC 不處理，由 r21-T47 判定）", R21_T47_REL],
  ];
  for (const [label, v] of VAR) {
    const r = D([v], `${row(K)}${row(K, v)}`, K);
    add(`${label}：A2SRC 不觸發（不放行）`, r.active === false && r.ok === false && r.infra === null);
  }
  // (3) 實際 r21-F patch 行（new Function 執行；stub 注入判定）＋其後原有 splice／unexpected 判定（照 r21-F neu 逐字邏輯）
  const lines = String(neu ?? "").split("\n").filter((l) => l.includes(".a2srcF7(nowChanged)"));
  add("r21-F neu 含 A2SRC 行恰好 1 次；不含萬用字元／前綴／正則比對", lines.length === 1 && !/startsWith|RegExp|\.test\(|\.match\(|\*\*|verify-\[/.test(lines[0] ?? ""), lines.length);
  const t47Lines = String(neu ?? "").split("\n").filter((l) => l.includes(".t47F7(nowChanged)"));
  add("r21-F neu 仍含 T47 行恰好 1 次（r21-T47 不變）", t47Lines.length === 1, t47Lines.length);
  if (lines.length === 1) {
    try {
      const run = (nowChanged, text, now, c, extraLines = []) => {
        const r21F7Ok = new Set();
        const preInfra = [];
        const t47List = `${R21_T47_SHA256}  ${R21_T47_REL}\n`;
        const stub = { r15: { r16: { r17: { r18: { r19: { r20: { r21: { a2srcF7: (nc) => D(nc, text, now, c), t47F7: (nc) => r21T47Decide(nc, t47List, R21_T47_SHA256) } } } } } } } };
        for (const l of [...extraLines, lines[0]]) new Function("__r14", "nowChanged", "r21F7Ok", "preInfra", l)(stub, nowChanged, r21F7Ok, preInfra);
        const unexpected = [...nowChanged];
        for (let i = unexpected.length - 1; i >= 0; i -= 1) if (r21F7Ok.has(unexpected[i])) unexpected.splice(i, 1);
        if (unexpected.length) preInfra.push(`F7 開始後除 3 檔外還有變動：${unexpected.join(", ")}`);
        return { ok: [...r21F7Ok], preInfra };
      };
      const a = run([rel], okList, K);
      add("實際 patch 行 正例：sha 相符 → 移出 unexpected、preInfra 空（放行）", a.preInfra.length === 0 && a.ok.length === 1 && a.ok[0] === rel);
      const b = run([rel], okList, X);
      add("實際 patch 行：sha 不符 → preInfra 有 r21-A2SRC INFRA ＋ 原 unexpected INFRA", b.ok.length === 0 && b.preInfra.length === 2 && /^r21-A2SRC.*目前 sha256/.test(b.preInfra[0]) && b.preInfra[1].includes(rel));
      const bn = run([rel], okList, null);
      add("實際 patch 行：檔案缺 → INFRA ＋ 原 unexpected INFRA", bn.ok.length === 0 && bn.preInfra.length === 2 && /^r21-A2SRC.*目前檔案不存在/.test(bn.preInfra[0]));
      const c = run([rel], null, K);
      add("實際 patch 行：清單缺 → INFRA ＋ 原 unexpected INFRA", c.ok.length === 0 && c.preInfra.length === 2 && /^r21-A2SRC.*不存在/.test(c.preInfra[0]));
      const d = run([rel], `${row(K)}${row(K)}`, K);
      add("實際 patch 行：清單多列 → INFRA ＋ 原 unexpected INFRA", d.ok.length === 0 && d.preInfra.length === 2 && /^r21-A2SRC.*2 列/.test(d.preInfra[0]));
      const e = run([rel], row(X), X);
      add("實際 patch 行：舊版檔冒充（目前＝清單＝舊 ≠ 常數）→ INFRA（常數與清單不一致）", e.ok.length === 0 && e.preInfra.length === 2 && /^r21-A2SRC.*常數與清單不一致/.test(e.preInfra[0]));
      const k = run([rel], okList, K, "");
      add("實際 patch 行：常數格式錯 → INFRA ＋ 原 unexpected INFRA", k.ok.length === 0 && k.preInfra.length === 2 && /^r21-A2SRC.*格式不符/.test(k.preInfra[0]));
      const f = run(["src/lib/ai/a.ts"], null, null);
      add("實際 patch 行：該路徑不在 nowChanged → 不寫 A2SRC preInfra（其餘照舊 INFRA）", f.ok.length === 0 && f.preInfra.length === 1 && !/r21-A2SRC/.test(f.preInfra[0]));
      for (const [label, v] of VAR.filter(([, x]) => x !== R21_T47_REL)) {
        const g = run([rel, v], okList, K);
        add(`實際 patch 行：${label} 與本檔並存 → 只放行精確路徑，其他路徑仍 INFRA`, g.ok.length === 1 && g.ok[0] === rel && g.preInfra.length === 1 && g.preInfra[0] === `F7 開始後除 3 檔外還有變動：${v}`);
      }
      const fake = run(["scripts/verify-zz-fake.mjs"], okList, K);
      add("實際 patch 行：只有其他未授權 scripts 檔（本檔不在 nowChanged）→ 不放行、照舊 INFRA", fake.ok.length === 0 && fake.preInfra.length === 1 && fake.preInfra[0] === "F7 開始後除 3 檔外還有變動：scripts/verify-zz-fake.mjs");
      if (t47Lines.length === 1) {
        const both = run([rel, R21_T47_REL, "scripts/verify-zz-fake.mjs"], okList, K, undefined, t47Lines);
        add("實際 patch 行（T47 行＋A2SRC 行依序執行）：本檔與 s1s4 各自放行、其他未授權 scripts 檔仍 INFRA", both.ok.length === 2 && both.ok.includes(rel) && both.ok.includes(R21_T47_REL) && both.preInfra.length === 1 && both.preInfra[0] === "F7 開始後除 3 檔外還有變動：scripts/verify-zz-fake.mjs");
        const bothBad = run([rel, R21_T47_REL], okList, X, undefined, t47Lines);
        add("實際 patch 行（T47 行＋A2SRC 行）：本檔 sha 不符 → 只有 s1s4 放行，本檔 INFRA（A2SRC 不影響 T47、T47 不放行本檔）", bothBad.ok.length === 1 && bothBad.ok[0] === R21_T47_REL && bothBad.preInfra.length === 2 && /^r21-A2SRC/.test(bothBad.preInfra[0]) && bothBad.preInfra[1] === `F7 開始後除 3 檔外還有變動：${rel}`);
      }
    } catch (err) {
      add(`實際 patch 行執行失敗：${String(err?.message ?? err).slice(0, 160)}`, false);
    }
  }
  // (4) 實際狀態（只讀）：常數＝scratchpad/A2SRC-new-sha.txt（R21_A2SRC_SNAP）該列；目前檔案以「在 nowChanged」判定
  const snapF = `${PRE_DIR}/${R21_A2SRC_SNAP}`;
  const snapText = existsSync(snapF) ? readFileSync(snapF, "utf8") : null;
  const listRows = typeof snapText === "string" ? snapText.split("\n").filter((l) => l.endsWith(` ${rel}`)) : [];
  add(`實際 ${R21_A2SRC_SNAP} 含該路徑恰好 1 列且逐字＝「常數＋兩空白＋相對路徑」`, listRows.length === 1 && listRows[0] === `${K}  ${rel}`, listRows.length);
  const cur = r21A2SrcDecide([rel], snapText, existsSync(`${WORK_ROOT}/${rel}`) ? sha256(readFileSync(`${WORK_ROOT}/${rel}`)) : null);
  add(`實際狀態（假設在 nowChanged）：${cur.reason}`, isOk(cur), `目前=${cur.now ?? "-"}`);
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length, cur };
}

// ════════════════════════ r21-Z6（A2-MP-T27）：r13 L2396 CB_CTD_ANCHORS[0]（work ctd 逐字 import anchor）版本識別 ════════════════════════
/**
 * 性質：版本識別（不涉及行為斷言）。理由：使用者授權第五、第六個 Source（E2c）＋r21 版本識別（指派者核准 r21-Z6）；先例 r12-Δ3（CC 於同一 import 加入 hasDanglingContinuationFragment 時更新同一 anchor）。
 * E2c 在 chat-turn-destination.ts 同一 import 區塊 matchesContinueRecommendationGrammar, 之後加入 parseNegatedDestinationSwitch, → 原逐字 anchor 不再命中 → INFRA-FAIL source anchors。
 * 只有「R21_P25＝post-MP25-E2-r4、該快照含 ctd 恰好一列（sha1＋兩空白＋相對路徑）、且 work ctd 目前 sha1 ＝ 該列」時，work 的逐字 anchor 才換成
 * 「原 anchor 在 '  matchesContinueRecommendationGrammar,\n' 之後多一行 '  parseNegatedDestinationSwitch,\n'」；其他情況一律原 anchor（逐字不變）。仍為逐字比對（includes）。
 * 「pre-CB 備份 ctd 已含 CB 文字」原檢查行不改；Z6 啟用時另加一行：對 pre-CB 備份再以原 anchor 做同一反向檢查（同訊息），原 anchor 的反向檢查不因換 anchor 而消失（不放寬）。
 * 傳入的原 anchor 與 r13 L2396 原文不符（錨點被改）→ INFRA-FAIL（丟錯）。
 */
const R21_Z6_ANCHOR_SRC = String.raw`'import {\n  analyzeContinueRecommendationStructure,\n  hasDanglingContinuationFragment,\n  matchesContinueRecommendationGrammar,\n} from "@/lib/ai/continue-recommendation-intent";'`; // r13 L2396 原始碼字面（逐字）
const R21_Z6_ORIG = 'import {\n  analyzeContinueRecommendationStructure,\n  hasDanglingContinuationFragment,\n  matchesContinueRecommendationGrammar,\n} from "@/lib/ai/continue-recommendation-intent";'; // 上式的執行期值
const R21_Z6_AFTER = "  matchesContinueRecommendationGrammar,\n";
const R21_Z6_ADD = "  parseNegatedDestinationSwitch,\n";
/** 純判定（--probe 以記憶體內變體自檢）：回傳 { active, anchor, reason, want, now, error }。error 非空 → 呼叫端 INFRA-FAIL。 */
function r21Z6Decide(snapName, snapText, nowSha, orig) {
  const base = { active: false, anchor: orig, want: null, now: nowSha, error: null };
  if (orig !== R21_Z6_ORIG) return { ...base, error: "CB_CTD_ANCHORS[0] 原文與 r13 L2396 不符（錨點已被改動）", reason: "錨點原文不符 → INFRA-FAIL" };
  if (orig.split(R21_Z6_AFTER).length - 1 !== 1) return { ...base, error: "原 anchor 不含恰好一次 matchesContinueRecommendationGrammar 行", reason: "錨點原文不符 → INFRA-FAIL" };
  if (snapName !== R21_P25_R4) return { ...base, reason: `施工後快照＝${snapName}（不是 ${R21_P25_R4}）→ 原 anchor` };
  if (typeof snapText !== "string") return { ...base, reason: `${R21_P25_R4} 不存在 → 原 anchor` };
  const rows = snapText.split("\n").filter((l) => l.endsWith(` ${R21_CTD_REL}`));
  if (rows.length !== 1) return { ...base, reason: `${R21_P25_R4} 含 ${R21_CTD_REL} ${rows.length} 列（必須恰好 1 列）→ 原 anchor` };
  const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/);
  if (!m || m[2] !== R21_CTD_REL) return { ...base, reason: `${R21_P25_R4} 該列格式不符 → 原 anchor` };
  if (typeof nowSha !== "string") return { ...base, want: m[1], reason: `${R21_CTD_REL} 不存在 → 原 anchor` };
  if (nowSha !== m[1]) return { ...base, want: m[1], reason: `work ${R21_CTD_REL} sha1 ≠ ${R21_P25_R4} → 原 anchor` };
  return { ...base, active: true, want: m[1], anchor: orig.replace(R21_Z6_AFTER, () => `${R21_Z6_AFTER}${R21_Z6_ADD}`), reason: `work ${R21_CTD_REL} sha1 ＝ ${R21_P25_R4} → E2c 版逐字 anchor（＋parseNegatedDestinationSwitch 一行）` };
}
/** r13 L2396 patch 呼叫（主程序）：讀 R21_P25 快照與 work ctd 後判定；結果記到 R21_STATE.z6；錨點原文不符 → 丟錯（INFRA-FAIL）。 */
function r21Z6CbAnchor(orig) {
  const snapText = existsSync(R21_P25_FILE) ? readFileSync(R21_P25_FILE, "utf8") : null;
  const p = `${WORK_ROOT}/${R21_CTD_REL}`;
  const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
  const r = r21Y6Decide(R21_P25, snapText, nowSha, orig); // r21#Y6（A2-MP-T31）：原 r21Z6Decide(R21_P25, …)；R21_P25 不是 r5 時 r21Y6Decide 原樣轉呼叫 r21Z6Decide
  if (typeof R21_STATE === "object" && R21_STATE) R21_STATE.z6 = r;
  if (r.error) throw new Error(`INFRA-FAIL r21-Z6：${r.error}`);
  return r.anchor;
}
function r21Z6SelfTest(applyFn) {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rel = R21_CTD_REL;
  const NEW = R21_Z6_ORIG.replace(R21_Z6_AFTER, () => `${R21_Z6_AFTER}${R21_Z6_ADD}`);
  const kindOf = (r) => (r.error ? "INFRA-FAIL" : r.anchor === NEW && r.active ? "新 anchor" : r.anchor === R21_Z6_ORIG && !r.active ? "原 anchor" : "其他");
  const rows = [];
  const cases = [
    ["快照＝r4、恰好一列、sha 相符 → 新 anchor", R21_P25_R4, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, R21_Z6_ORIG, "新 anchor"],
    ["快照＝r4、sha 不符 → 原 anchor", R21_P25_R4, `${B}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r3（sha 相符）→ 原 anchor", R21_P25_R3, `${A}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r4 但不存在 → 原 anchor", R21_P25_R4, null, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r4、沒有 ctd 列 → 原 anchor", R21_P25_R4, `${A}  src/lib/ai/other.ts\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r4、ctd 列重複 → 原 anchor", R21_P25_R4, `${A}  ${rel}\n${A}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r4、ctd 列只有一個空白 → 原 anchor", R21_P25_R4, `${A} ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["work ctd 不存在 → 原 anchor", R21_P25_R4, `${A}  ${rel}\n`, null, R21_Z6_ORIG, "原 anchor"],
    ["傳入的原 anchor 被改動 → INFRA-FAIL", R21_P25_R4, `${A}  ${rel}\n`, A, R21_Z6_ORIG.replace("hasDanglingContinuationFragment", "x"), "INFRA-FAIL"],
  ];
  for (const [label, name, text, now, orig, want] of cases) {
    const got = kindOf(r21Z6Decide(name, text, now, orig));
    rows.push({ label, want, got, pass: got === want });
  }
  // 新 anchor ＝ 原 anchor 恰好多一行（逐字；移除該行後與原 anchor 完全相同）
  const oneLine = NEW.split("\n").length === R21_Z6_ORIG.split("\n").length + 1 && NEW.replace(R21_Z6_ADD, "") === R21_Z6_ORIG;
  rows.push({ label: "新 anchor ＝ 原 anchor 恰好多一行 parseNegatedDestinationSwitch,（逐字）", want: "是", got: oneLine ? "是" : "否", pass: oneLine });
  // R21_Z6_ANCHOR_SRC（原始碼字面）的執行期值 ＝ R21_Z6_ORIG
  const srcOk = R21_Z6_ANCHOR_SRC === `'${R21_Z6_ORIG.split("\n").join("\\n")}'` && !/[\\']/.test(R21_Z6_ORIG); // 字面＝單引號包住、換行寫成 \n（原文不含反斜線／單引號）
  rows.push({ label: "原始碼字面 R21_Z6_ANCHOR_SRC 的值 ＝ R21_Z6_ORIG", want: "是", got: srcOk ? "是" : "否", pass: srcOk });
  // 錨點缺失 → INFRA-FAIL（以 r21Apply 對不含錨點的文字套用 Z6 patch）
  let missing = "未丟錯";
  try { applyFn("const CB_CTD_ANCHORS = [];\n", R21_R13_PATCHES.filter((p) => p.id.startsWith("r21-Z6")), "z6-selftest"); } catch { missing = "INFRA-FAIL"; }
  rows.push({ label: "錨點缺失（目標原文不含 L2396 錨點）→ INFRA-FAIL", want: "INFRA-FAIL", got: missing, pass: missing === "INFRA-FAIL" });
  // 實際 work（只讀）：目前判定、work ctd 含所選 anchor
  const p = `${WORK_ROOT}/${rel}`;
  const nowSha = existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : null;
  const cur = r21Y6Decide(R21_P25, existsSync(R21_P25_FILE) ? readFileSync(R21_P25_FILE, "utf8") : null, nowSha, R21_Z6_ORIG); // r21#Y6（A2-MP-T31）：原 r21Z6Decide(R21_P25, …)（與 r21Z6CbAnchor 實際使用的判定一致；R21_P25 不是 r5 時相同）
  const work = existsSync(p) ? readFileSync(p, "utf8") : "";
  const hit = !cur.error && work.includes(cur.anchor);
  rows.push({ label: `實際 work：${cur.reason}；work ctd 含所選 anchor`, want: "是", got: hit ? "是" : "否", pass: hit });
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length, cur };
}
/**
 * r21-Y6（A2-MP-T31）：Z6 在快照＝post-MP25-E2-r5 時的版本識別（性質：版本識別，不涉及行為斷言）。
 * r5 的 ctd 列＝r4 的 ctd 列（Y0 前提保證：r5 相對 r4 只允許 _app 不同）→ 以 r5 快照內容、照 r21Z6Decide 的同一套條件（恰好一列、格式、work ctd sha1 相符）判定，
 * 選出的仍是同一個 E2c 版逐字 anchor；sha1 不符／缺列等 → 原 anchor。快照名稱不是 r5 → 原樣轉呼叫 r21Z6Decide（Z6 行為逐字不變）。錨點原文不符 → INFRA-FAIL（同 Z6）。
 */
function r21Y6Decide(snapName, snapText, nowSha, orig) {
  if (snapName !== R21_P25_R5) return r21Z6Decide(snapName, snapText, nowSha, orig);
  const r = r21Z6Decide(R21_P25_R4, snapText, nowSha, orig);
  return { ...r, reason: `${r.reason}〔r21#Y6：快照＝${R21_P25_R5}；ctd 列取自 ${R21_P25_R5}（＝${R21_P25_R4}，Y0 保證）〕` };
}
function r21Y6SelfTest() {
  const A = "a".repeat(40);
  const B = "b".repeat(40);
  const rel = R21_CTD_REL;
  const NEW = R21_Z6_ORIG.replace(R21_Z6_AFTER, () => `${R21_Z6_AFTER}${R21_Z6_ADD}`);
  const kindOf = (r) => (r.error ? "INFRA-FAIL" : r.anchor === NEW && r.active ? "新 anchor" : r.anchor === R21_Z6_ORIG && !r.active ? "原 anchor" : "其他");
  const cases = [
    ["快照＝r5、恰好一列、sha 相符 → 新 anchor", R21_P25_R5, `${B}  src/lib/ai/other.ts\n${A}  ${rel}\n`, A, R21_Z6_ORIG, "新 anchor"],
    ["快照＝r5、sha 不符 → 原 anchor", R21_P25_R5, `${B}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5 但不存在 → 原 anchor", R21_P25_R5, null, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5、沒有 ctd 列 → 原 anchor", R21_P25_R5, `${A}  src/lib/ai/other.ts\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5、ctd 列重複 → 原 anchor", R21_P25_R5, `${A}  ${rel}\n${A}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5、ctd 列只有一個空白 → 原 anchor", R21_P25_R5, `${A} ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5、work ctd 不存在 → 原 anchor", R21_P25_R5, `${A}  ${rel}\n`, null, R21_Z6_ORIG, "原 anchor"],
    ["快照＝r5、傳入的原 anchor 被改動 → INFRA-FAIL", R21_P25_R5, `${A}  ${rel}\n`, A, R21_Z6_ORIG.replace("hasDanglingContinuationFragment", "x"), "INFRA-FAIL"],
    ["快照＝r4：轉呼叫 r21Z6Decide → 新 anchor（Z6 不變）", R21_P25_R4, `${A}  ${rel}\n`, A, R21_Z6_ORIG, "新 anchor"],
    ["快照＝r3：轉呼叫 r21Z6Decide → 原 anchor（Z6 不變）", R21_P25_R3, `${A}  ${rel}\n`, A, R21_Z6_ORIG, "原 anchor"],
  ];
  const rows = cases.map(([label, name, text, now, orig, want]) => {
    const got = kindOf(r21Y6Decide(name, text, now, orig));
    return { label, want, got, pass: got === want };
  });
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}

// ════════════════════════ r21-C（A2-MP-T18）：離線可控時間（外掛情境 SCENARIO.r21ClockByTurn）════════════════════════
/**
 * 性質：測試基礎設施（不涉及行為斷言）。情境欄位 r21ClockByTurn＝{ turnIndex: 毫秒 }（鍵＝turnIndex，0 起算，與 r18GeoByTurn 相同；TURN_OFFSET 後的全域輪次）：
 * 該輪開始前（obs.turnIndex 設定後、送出 send() 前），把子程序內的 Date.now 設為「原始 Date.now＋所有鍵 ≤ 本輪的值總和」，不實際等待（不 setTimeout）。
 * 只在情境有此欄位時呼叫（r13 patch 以 if (SCENARIO.r21ClockByTurn) 包住；沒有此欄位的情境完全不觸碰 Date.now，obs 也不新增 r21Clock）。
 * 不合法（鍵非整數、值非有限非負數）→ 丟錯（該輪 error → INFRA）。回傳本輪累計偏移（記到 obs.r21Clock）。
 */
const R21_CLOCK = { orig: null };
function r21ClockTurn(map, turnIndex) {
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error(`[r21-C] r21ClockByTurn 必須是物件（${JSON.stringify(map)}）`);
  let shift = 0;
  for (const [k, v] of Object.entries(map)) {
    const n = Number(k);
    const ms = Number(v);
    if (!Number.isInteger(n) || n < 0 || !Number.isFinite(ms) || ms < 0) throw new Error(`[r21-C] r21ClockByTurn 欄位不合法：${k}=${JSON.stringify(v)}`);
    if (n <= turnIndex) shift += ms;
  }
  if (!R21_CLOCK.orig) R21_CLOCK.orig = Date.now;
  const orig = R21_CLOCK.orig;
  Date.now = () => orig.call(Date) + shift;
  return shift;
}
function r21ClockRestore() {
  if (R21_CLOCK.orig) Date.now = R21_CLOCK.orig;
  R21_CLOCK.orig = null;
}
/** --probe 乾跑／自檢（主程序；記憶體內，不實際等待、不執行情境）。 */
function r21ClockSelfTest() {
  const rows = [];
  const add = (label, pass, note = "") => rows.push({ label, pass: Boolean(pass), note });
  const nowFn = Date.now;
  // (1) 無欄位：r13 patch 的守衛條件為 falsy → 不呼叫；Date.now 不變（同一函式參照）
  const S0 = {};
  if (S0.r21ClockByTurn) r21ClockTurn(S0.r21ClockByTurn, 3);
  add("無 r21ClockByTurn：守衛不成立、Date.now 仍是原函式（逐字不變）", Date.now === nowFn && R21_CLOCK.orig === null);
  // (2) 有欄位：第 3 輪（turnIndex 3）前進 16000 ms，不實際等待
  const p0 = performance.now();
  const t0 = nowFn.call(Date);
  const s3 = r21ClockTurn({ 3: 16000 }, 3);
  const t1 = Date.now();
  const p1 = performance.now();
  add("{3:16000} 第 turnIndex 3 輪：偏移 16000、Date.now 前進 ≥16000 ms、實際耗時 <1000 ms（不等待）", s3 === 16000 && t1 - t0 >= 16000 && t1 - t0 < 17000 && p1 - p0 < 1000, `Δ=${t1 - t0}ms 實耗=${(p1 - p0).toFixed(1)}ms`);
  const s2 = r21ClockTurn({ 3: 16000 }, 2);
  add("{3:16000} 第 turnIndex 2 輪：偏移 0（鍵 > 本輪不累加）", s2 === 0 && Math.abs(Date.now() - nowFn.call(Date)) < 1000);
  const s4 = r21ClockTurn({ 1: 5000, 3: 16000 }, 4);
  add("{1:5000,3:16000} 第 turnIndex 4 輪：累計 21000", s4 === 21000 && Date.now() - nowFn.call(Date) >= 21000 && Date.now() - nowFn.call(Date) < 22000);
  let threw = false;
  try {
    r21ClockTurn({ x: 1 }, 0);
  } catch {
    threw = true;
  }
  add("不合法鍵 → 丟錯（該輪 INFRA）", threw);
  r21ClockRestore();
  add("還原後 Date.now 為原函式", Date.now === nowFn);
  // (3) 既有情境沒有此欄位：r13～r20 原文不含 r21ClockByTurn（只有本檔 patch 與外掛情境會用）
  const used = ["r13", "r14", "r15", "r16", "r17", "r18", "r19", "r20"].filter((v) => readFileSync(`${WORK_ROOT}/scripts/verify-destination-authority-phase2-${v}.mjs`, "utf8").includes("r21ClockByTurn"));
  add("r13～r20 原文沒有任何 r21ClockByTurn（既有情境不受影響）", used.length === 0, used.join(",") || "-");
  // (4) r13 patch：neu 以 old 原樣開頭（無欄位路徑執行的仍是原兩行）、插入行以 if (SCENARIO.r21ClockByTurn) 守衛
  const p = R21_R13_PATCHES.find((x) => x.id === R21_C_PATCH_ID);
  add("r13 patch neu＝old 原樣＋1 行守衛插入", Boolean(p) && p.neu.startsWith(p.old) && p.neu.slice(p.old.length).split("\n").filter(Boolean).length === 1 && /^\s*if \(SCENARIO\.r21ClockByTurn\) /.test(p.neu.slice(p.old.length)));
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
const R21_C_PATCH_ID = "r21-C 每輪時間偏移（外掛情境 r21ClockByTurn）";

// ════════════════════════ R21 patch（各層）════════════════════════
const R21_R13_PATCHES = [
  {
    id: "r21-D alias module",
    kind: "exact",
    old: '    rss: await imp("lib/ai/recommendation-search-scope.ts"), // r14-Δ5：applyLocalFallback 由 destination_places 分支呼叫（非 faithful 也需要）\n',
    neu: L(
      '    rss: await imp("lib/ai/recommendation-search-scope.ts"), // r14-Δ5：applyLocalFallback 由 destination_places 分支呼叫（非 faithful 也需要）',
      '    r21alias: (globalThis.__R21_ALIAS = await imp("lib/ai/destination-alias-resolver.ts")), // r21#D1：既有 canonical identity（resolveDestinationAlias；r20SameIdentity／r21-E 使用）',
      "",
    ),
  },
  {
    id: "r21-E created registry",
    kind: "exact",
    old: "    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {\n",
    neu: L(
      "    globalThis.__R21_CREATED = new Map(); // r21#E1：本程序內實際建立的 destination_switch Pending → 建立輪原句（Reload＝新程序 → 未知）",
      "    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {",
      "",
    ),
  },
  {
    id: "r21-E turn writes",
    kind: "exact",
    old: '      globalThis.__R20_TURN_TEXT = typeof t.text === "string" ? t.text.trim() : null; // r20#E1：本輪使用者原句（＝send() 的 trimmed；originalUserText 比對基準）\n',
    neu: L(
      '      globalThis.__R20_TURN_TEXT = typeof t.text === "string" ? t.text.trim() : null; // r20#E1：本輪使用者原句（＝send() 的 trimmed；originalUserText 比對基準）',
      "      globalThis.__R21_TURN_WRITES = []; // r21#E1：本輪 destination_switch Pending 寫入（Callback 內外）",
      "      globalThis.__R21_EVALUATED = []; // r21#E1：本輪已在 Callback 內（可信判定未通過）評估過的 Pending",
      "",
    ),
  },
  {
    id: "r21-E turn end",
    kind: "exact",
    old: "      R14_turnEnd(obs, r14r0); // r14-Δ3\n",
    neu: L(
      "      { // r21#E5：send() 層／整輪 Pending 寫入檢查（r19-E ∧ r20-E ∧ r21-E；成本＝整輪）",
      "        const r21h = __r14.r15.r16.r17.r18.r19.r20.r21;",
      '        const r21t = r21h.turnEnd({ atStart: globalThis.__R19_TURN_START ?? null, end: persisted, writes: globalThis.__R21_TURN_WRITES ?? [], evaluated: globalThis.__R21_EVALUATED ?? [], userText: globalThis.__R20_TURN_TEXT ?? null, places: placesReqs.length - p0, weather: weatherCalls.length - w0, builders: builderCalls.length - b0, begins: creditsBegin.length - c0, rpcs: R14_rpc.slice(r14r0).map((x) => x.name), db: R14_db.slice(r20db0).map((d) => `${d.phase}:${d.path}`), frameGeo: geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`), altOffer: typeof M.refresh?.isAlternativeRecommendationOffer === "function" ? (x) => M.refresh.isAlternativeRecommendationOffer(x) : null, limits: __r14.r15.r16.r17.r18.r19.r20.limits, created: globalThis.__R21_CREATED ?? null, r19PE: __r14.r15.r16.r17.r18.r19.pendingException, r20PE: __r14.r15.r16.r17.r18.r19.r20.pendingExtra });',
      "        obs.r21Writes = r21t.writes; // r21#O1：只記錄",
      "        obs.r21SendExc = r21t.exc; // r21#O1：只記錄",
      "        if (r21t.exc && !r21t.exc.ok) obs.r14Violations.push(`send()：可信目的地未確認仍寫入 Session（r21-E send() 層／整輪 destination_switch Pending 例外不成立：${String(r21t.exc.why).slice(0, 240)}）`);",
      "      }",
      "      R14_turnEnd(obs, r14r0); // r14-Δ3",
      "",
    ),
  },
  {
    // A2-MP-T15：快照檔改為 R21_P25（post-MP25-r2-sha.txt 存在時優先；r21#W4）；放行條件（目前 sha1 ＝ 快照該檔 sha1）不變。
    // A2-MP-T13：F7 預檢（r13 L2141-2171）施工後版本識別。只把「MP-25 授權且目前 sha1 ＝ post-MP25-sha.txt 該檔 sha1」的兩檔，
    // 以及 mp25-post 探針（精確檔名、且不在 pre-G2S1 快照）移出 unexpected；其餘判定不變。快照缺檔／缺列／sha 不符 → 照舊 INFRA-FAIL。
    id: "r21-F F7 post-MP25 版本識別",
    kind: "exact",
    old: "    if (unexpected.length) preInfra.push(`F7 開始後除 3 檔外還有變動：${unexpected.join(\", \")}`);\n",
    neu: L(
      "    { // r21#F1（A2-MP-T13）：使用者授權 F7 施工後版本識別（不涉及行為斷言）；比照 r13-Δ1 CB_ALLOWED 的 post-A2 寫法（必須 = 快照 sha 才放行）",
      `      const r21P25File = \`\${PRE_DIR}/${R21_P25}\`; // r21#W4（A2-MP-T15）：施工後快照版本識別（post-MP25-r2 存在時優先；本行在 r21 載入時決定）`,
      "      const r21P25 = existsSync(r21P25File) ? readFileSync(r21P25File, \"utf8\").split(\"\\n\") : [];",
      "      const r21F7Ok = new Set();",
      "      for (const rel of [\"src/lib/ai/destination-geographic-clarification.ts\", \"src/lib/i18n/chat-runtime.ts\"]) { // MP-25 授權四檔中、在 pre-G2S1 快照內者（_app.chat.tsx 屬 PRE_FILES；continue-recommendation-intent.ts 由 postCbSha〔r19-V post-MP25〕處理）",
      "        const want = r21P25.find((l) => l.endsWith(`  ${rel}`))?.slice(0, 40);",
      "        if (want && existsSync(`${WORK_ROOT}/${rel}`) && want === createHash(\"sha1\").update(readFileSync(`${WORK_ROOT}/${rel}`)).digest(\"hex\")) r21F7Ok.add(rel);",
      "      }",
      "      const r21Mp25Post = \"scripts/verify-more-places-destination-switch-mp25-post.mjs\"; // A2-MP-T12 純函式探針（A2-MP-T13 審查：無外部 API、只寫 --out、不讀 .env）；精確檔名",
      "      if (nowChanged.includes(r21Mp25Post) && !inSnap.has(r21Mp25Post)) r21F7Ok.add(r21Mp25Post);",
      "      { const r21e2 = __r14.r15.r16.r17.r18.r19.r20.r21.e2F7(); if (r21e2.ok) r21F7Ok.add(r21e2.rel); } // r21#F2（A2-MP-T18）：E2 授權 trip-planning-session-reset.ts；只在 post-MP25-E2-sha.txt 存在、含該檔恰好一列且目前 sha1 相符時移出 unexpected（版本識別）",
      "      { const r21x4 = __r14.r15.r16.r17.r18.r19.r20.r21.x4F7(); if (r21x4.ok) r21F7Ok.add(r21x4.rel); } // r21#X4（A2-MP-T24）：E2 授權 destination-travel-profile.ts（在 pre-G2S1 快照內）；只在快照＝post-MP25-E2-r3-sha.txt、含該檔恰好一列且目前 sha1 相符時移出 unexpected（版本識別）",
      "      { const r21z5 = __r14.r15.r16.r17.r18.r19.r20.r21.z5F7(); if (r21z5.ok) r21F7Ok.add(r21z5.rel); } // r21#Z5（A2-MP-T27）：E2c 授權 travel-context.ts（不在 pre-G2S1 快照）；只在 post-MP25-E2c-sha.txt 存在、含該檔恰好一列且目前 sha1 相符時移出 unexpected（版本識別）",
      "      { for (const r21y5 of __r14.r15.r16.r17.r18.r19.r20.r21.y5F7()) if (r21y5.ok) r21F7Ok.add(r21y5.rel); } // r21#Y5（A2-MP-T31）：E2d／E2e 授權 trip-planning-context.ts／chat-planning-flow.ts／trip-intent.ts（不在 pre-G2S1 快照）；逐檔只在 post-MP25-E2f-sha.txt 存在、含該檔恰好一列且目前 sha1 相符時移出 unexpected（版本識別）",
      "      { const r21t34 = globalThis.__R21_T34.scopeFallback(nowChanged); for (const rel of r21t34.ok) r21F7Ok.add(rel); for (const f of r21t34.fail) preInfra.push(f); } // r21#T3（A2-MP-T34）：只在 pre 樹 MISSING（pre-G2S1 快照遺失，inSnap＝空）時啟用；src＝R21_P25 該列 sha1 相符、scripts/verify-*.mjs＝pre-MP9T sha256 相符才移出 unexpected；其餘照舊 INFRA-FAIL",
      "      { const r21n1 = __r14.r15.r16.r17.r18.r19.r20.r21.t47F7(nowChanged); if (r21n1.ok) r21F7Ok.add(r21n1.rel); if (r21n1.infra) preInfra.push(r21n1.infra); } // r21#N1（A2-MP-T47 r21-T47）：只針對精確路徑 scripts/verify-negated-switch-s1s4.mjs；在 nowChanged 時，目前 sha256 ＝ 常數 ＝ T64-new-sha.txt 該列（恰好一列；r21-T54／r21-T56／r21-T61／r21-T64 重新綁定）才移出 unexpected，任何不符 → preInfra（INFRA-FAIL）；不在 nowChanged → 不處理",
      "      { const r21n2 = __r14.r15.r16.r17.r18.r19.r20.r21.a2srcF7(nowChanged); if (r21n2.ok) r21F7Ok.add(r21n2.rel); if (r21n2.infra) preInfra.push(r21n2.infra); } // r21#N2（任務單 #104 r21-A2SRC）：只針對精確路徑 scripts/verify-a2-source-scenarios.mjs；在 nowChanged 時，目前 sha256 ＝ 常數 ＝ A2SRC-new-sha.txt 該列（恰好一列）才移出 unexpected，任何不符 → preInfra（INFRA-FAIL）；不在 nowChanged → 不處理",
      "      for (let i = unexpected.length - 1; i >= 0; i -= 1) if (r21F7Ok.has(unexpected[i])) unexpected.splice(i, 1);",
      "    }",
      "    if (unexpected.length) preInfra.push(`F7 開始後除 3 檔外還有變動：${unexpected.join(\", \")}`);",
      "",
    ),
  },
  {
    // A2-MP-T14：r13 L2363 G2S1 字元距離（r17-V 版：3000＋F2 區塊扣除）。只在 work _app sha1＝post-MP25 時改由 r21-G AST 安全契約判定；
    // 其他 sha → 原條件逐字不變。moreAt<legacyAt<creditsAt 順序條件兩種模式都保留；契約不成立 → 原訊息＋逐條原因（INFRA-FAIL source anchors）。
    id: "r21-G1 G2S1 window → AST 安全契約（post-MP25）",
    kind: "exact",
    old: "  if (!(moreAt > 0 && moreAt < legacyAt && legacyAt < creditsAt && creditsAt - moreAt < 3000 + __r14.r15.r16.r17.f2MoreDelta(appWork))) /* r17-V */ G2S1_ANCHOR_FAIL.push(",
    neu: L(
      "  const r21mc = await __r14.r15.r16.r17.r18.r19.r20.r21.moreContract(appWork); // r21#G1（A2-MP-T14）：work _app sha1＝post-MP25 → AST 安全契約 (a)～(f)；其他 sha → 原條件",
      "  if (r21mc.active) for (const m of r21mc.fail) G2S1_ANCHOR_FAIL.push(`work G2S1／A2 more_places 安全契約（r21-G AST）不成立：${m}`); // r21#G1",
      "  if (!(moreAt > 0 && moreAt < legacyAt && legacyAt < creditsAt && (r21mc.active ? r21mc.ok === true : creditsAt - moreAt < 3000 + __r14.r15.r16.r17.f2MoreDelta(appWork)))) /* r17-V */ /* r21#G1 */ G2S1_ANCHOR_FAIL.push(",
    ),
  },
  {
    // A2-MP-T14：r14 L299 R14_A2_WORK_ANCHORS[2]（work 樹的文字 anchor）。只在 r21-G 啟用時（work _app sha1＝post-MP25）改由 AST 契約 (b)(c)(f) 判定；
    // pa2 的反向檢查（不得含此片段）與其他樹、其他 anchor 不變。
    id: "r21-G2 A2 anchor#3 → AST 安全契約（post-MP25、只限 work）",
    kind: "exact",
    old: "  for (const a of ANCHORS[tree]) {\n",
    neu: L(
      "  for (const a of ANCHORS[tree]) {",
      "    if (tree === \"work\" && a === __r14.r15.r16.r17.r18.r19.r20.r21.gA2Anchor && a === __r14.A2_WORK_ANCHORS[2] && __r14.r15.r16.r17.r18.r19.r20.r21.state.mc?.active === true) { // r21#G2（A2-MP-T14）",
      "      anchorLines.push(`work r21-G :: A2 anchor#3「${a.split(\"\\n\")[0]}」改由 AST 安全契約判定（${__r14.r15.r16.r17.r18.r19.r20.r21.state.mc.ok ? \"成立\" : \"不成立 → 見 G2S1 INFRA\"}）`);",
      "      continue;",
      "    }",
      "",
    ),
  },
];
// A2-MP-T18（r21-C）：每輪時間偏移（只在外掛情境有 SCENARIO.r21ClockByTurn 時；錨點＝r18-G turn index patch 的輸出行，恰好 1 次）
R21_R13_PATCHES.push({
  id: R21_C_PATCH_ID,
  kind: "exact",
  old: "      R18_TURN_I = obs.turnIndex; // r18-G\n",
  neu: L(
    "      R18_TURN_I = obs.turnIndex; // r18-G",
    "      if (SCENARIO.r21ClockByTurn) obs.r21Clock = __r14.r15.r16.r17.r18.r19.r20.r21.clockTurn(SCENARIO.r21ClockByTurn, obs.turnIndex); // r21#C1（A2-MP-T18）：子程序 Date.now 偏移（不等待；無欄位 → 不執行）",
    "",
  ),
});
// A2-MP-T27（r21-Z6）：r13 L2396 CB_CTD_ANCHORS[0] 版本識別（work ctd sha1 ＝ R21_P25〔r4〕該列時才用 E2c 版逐字 anchor；其他 → 原 anchor）。錨點各恰好 1 次，否則 INFRA-FAIL。
R21_R13_PATCHES.push(
  {
    id: "r21-Z6a CB_CTD_ANCHORS[0] 逐字 import anchor 版本識別（post-MP25-E2-r4）",
    kind: "exact",
    old: `      ${R21_Z6_ANCHOR_SRC}, // r12-Δ3：CC 於同一 import 加入 hasDanglingContinuationFragment\n`,
    neu: L(
      `      __r14.r15.r16.r17.r18.r19.r20.r21.z6CbAnchor(${R21_Z6_ANCHOR_SRC}), // r21#Z6a（A2-MP-T27）：work ctd sha1 ＝ ${R21_P25_R4} 該列 → E2c 版逐字 anchor（＋parseNegatedDestinationSwitch 一行）；其他 → 原 anchor（逐字不變） // r12-Δ3：CC 於同一 import 加入 hasDanglingContinuationFragment`,
      "",
    ),
  },
  {
    id: "r21-Z6b Z6 啟用時保留原 anchor 對 pre-CB 備份的反向檢查",
    kind: "exact",
    old: '    const CB_CRI_ANCHOR = "export function analyzeContinueRecommendationStructure(";\n',
    neu: L(
      "    if (__r14.r15.r16.r17.r18.r19.r20.r21.state.z6?.active === true && (ctdNow === null ? (globalThis.__R21_T34.unv(\"B1\"), false) : ctdNow.includes(__r14.r15.r16.r17.r18.r19.r20.r21.z6Orig))) /* r21#T4（A2-MP-T34）：f10 MISSING（ctdNow＝null）→ 記 UNVERIFIED、不執行；否則原判定 */ G2S1_ANCHOR_FAIL.push(`pre-CB 備份 ctd 已含 CB 文字：${__r14.r15.r16.r17.r18.r19.r20.r21.z6Orig.split(\"\\n\")[0]}`); // r21#Z6b（A2-MP-T27）：換 anchor 後，原 anchor 的反向檢查照舊（不放寬；原檢查行不改）",
      '    const CB_CRI_ANCHOR = "export function analyzeContinueRecommendationStructure(";',
      "",
    ),
  },
);
// ════════════════════════ r21-T34（A2-MP-T34）：r13 執行內容 patch（舊樹 MISSING → 不讀取、記 UNVERIFIED；PRESENT → 原敘述逐字執行）════════════════════════
/**
 * old 以 r13 原文行號擷取（r13 sha256 由主程序對照 pre-MP9T-test-sha.txt 驗證；r14～r20 未改動這些行，--probe 乾跑對照 r20 --emit-diff 產物恰好 1 次）。
 * 建構規則（spec[行號]）：未列＝原行不變；["read", 樹, 後備值]：`const X = <rhs>;` → `const X = miss(樹) ? 後備值 : <rhs>;`（rhs 逐字）；
 * ["guard", 樹, id, 明細]：`<敘述>` → `if (miss(樹)) unv(id); else <敘述>`（敘述逐字）。t34.keep＝必須同時出現在 old 與 neu 的原文（--probe 結構自檢）。
 */
const R21_T34_G = "globalThis.__R21_T34";
const R21_T34_R13_TEXT = readFileSync(`${WORK_ROOT}/scripts/verify-destination-authority-phase2-r13.mjs`, "utf8");
const R21_T34_R13 = R21_T34_R13_TEXT.split("\n");
const r21T34Src = (a, b = a) => R21_T34_R13.slice(a - 1, b);
function r21T34Patch(id, a, b, spec = {}) {
  const lines = r21T34Src(a, b);
  const keep = [];
  const neu = lines.map((line, k) => {
    const n = a + k;
    const s = spec[n] ?? ["keep"];
    const ind = line.match(/^\s*/)[0];
    const body = line.slice(ind.length);
    if (s[0] === "keep") {
      if (body) keep.push(body);
      return line;
    }
    if (s[0] === "read") {
      const m = body.match(/^(const \w+ = )(.+;)$/);
      if (!m) throw new Error(`INFRA-FAIL r21-T34 patch ${id}：r13 L${n} 不是 const 宣告（${body.slice(0, 60)}）`);
      keep.push(m[2]);
      return `${ind}${m[1]}${R21_T34_G}.miss(${JSON.stringify(s[1])}) ? ${s[2] ?? "null"} : ${m[2]} // r21#T4`;
    }
    if (s[0] === "guard") {
      keep.push(body);
      return `${ind}if (${R21_T34_G}.miss(${JSON.stringify(s[1])})) ${R21_T34_G}.unv(${JSON.stringify(s[2])}${s[3] ? `, ${s[3]}` : ""}); /* r21#T4 */ else ${body}`;
    }
    throw new Error(`INFRA-FAIL r21-T34 patch ${id}：未知 spec ${s[0]}`);
  });
  for (const k of Object.keys(spec)) if (Number(k) < a || Number(k) > b) throw new Error(`INFRA-FAIL r21-T34 patch ${id}：spec 行號 ${k} 不在 L${a}-${b}`);
  return { id, kind: "exact", old: `${lines.join("\n")}\n`, neu: `${neu.join("\n")}\n`, t34: { keep, from: a, to: b } };
}
/** 包覆：miss(樹) → unv(ids)、整段不執行；否則原文逐字執行。 */
function r21T34Wrap(id, a, b, tree, ids, mark) {
  const lines = r21T34Src(a, b);
  const old = `${lines.join("\n")}\n`;
  const ind = lines[0].match(/^\s*/)[0];
  return { id, kind: "exact", old, neu: `${ind}if (${R21_T34_G}.miss(${JSON.stringify(tree)})) ${R21_T34_G}.unv(${JSON.stringify(ids)}); else { // r21#${mark}（A2-MP-T34）：${tree} MISSING → UNVERIFIED、不執行；否則以下原文逐字\n${old}${ind}} // r21#${mark}：包覆結束\n`, t34: { keep: lines.map((l) => l.trim()).filter(Boolean), from: a, to: b } };
}
/** 單行／片段替換：old 必須含 keep（原文），neu 必須仍含 keep。 */
const r21T34Sub = (id, old, neu, keep) => ({ id, kind: "exact", old, neu, t34: { keep } });
const r21T34Line = (n) => `${r21T34Src(n)[0]}\n`;
const r21T34Rep = (id, n, from, to) => {
  const old = r21T34Line(n);
  if (old.split(from).length - 1 !== 1) throw new Error(`INFRA-FAIL r21-T34 patch ${id}：r13 L${n} 不含恰好一次「${from}」`);
  const t = old.trim();
  return r21T34Sub(id, old, old.replace(from, () => to), [t.slice(0, t.indexOf(from)), t.slice(t.indexOf(from) + from.length)].filter(Boolean)); // keep＝替換點前後的原文（逐字）
};
const R21_T34_T4F = (() => {
  // r13 L2406-2411（T4f）：pre-CB 備份 MISSING 時只保留 work 自身可判定的「CB 區塊起訖標記存在且順序正確」（原條件的子集合；訊息另標 r21-T34）
  const L = r21T34Src(2406, 2411);
  const ind = L[0].match(/^\s*/)[0];
  const old = `${L.join("\n")}\n`;
  const guard0 = `${ind}if (${R21_T34_G}.miss("f10")) ${R21_T34_G}.unv("B2"); /* r21#T4 */ else ${L[0].trim()}`;
  const neu = [
    guard0,
    `${ind}if (${R21_T34_G}.miss("f10")) { // r21#T4（A2-MP-T34）：pre-CB 備份 MISSING → 舊文法凍結比對 UNVERIFIED；只保留 work 自身可判定的起訖標記檢查（原條件的子集合）`,
    `${ind}  ${R21_T34_G}.unv("B3");`,
    `${ind}  ${L[1].trim()}`,
    `${ind}  ${L[2].trim()}`,
    `${ind}  if (blockStart < 0 || blockEnd < blockStart) G2S1_ANCHOR_FAIL.push("work cri 找不到 CB 新增區塊起訖標記（r21-T34：pre-CB 備份 MISSING，凍結比對 UNVERIFIED）");`,
    `${ind}} else { // r21#T4：f10 PRESENT → 以下原文逐字`,
    ...L.slice(1),
    `${ind}} // r21#T4：包覆結束`,
    "",
  ].join("\n");
  return { id: "r21-T4f B2／B3 pre-CB cri（f10）", kind: "exact", old, neu, t34: { keep: L.map((l) => l.trim()).filter(Boolean) } };
})();
const R21_T34_R13_PATCHES = [
  // T1 r13 L2131-2132：pre／pre5／pre4 備份存在檢查 — 群組 MISSING → 記 UNVERIFIED、跳過該群組（部分存在已在主程序 INFRA-FAIL）
  (() => {
    const old = `${r21T34Src(2131, 2132).join("\n")}\n`;
    return r21T34Sub("r21-T1 pre 群組前提（S1）", old, `  if (${R21_T34_G}.missLabel(label)) { ${R21_T34_G}.unv("S1", label); continue; } // r21#T1（A2-MP-T34）：該群組快照全部不存在 → MISSING（不建樹）；否則以下原文逐字\n${old}`, r21T34Src(2131, 2132).map((l) => l.trim()));
  })(),
  // T2 r13 L2144-2146：pre-G2S1 sha 快照 — pre MISSING → 不讀、不 INFRA（shaDiff／inSnap 為空；範圍守門由 T3 後備嚴格綁定）
  (() => {
    const L = r21T34Src(2144, 2146);
    const a = "  if (!existsSync(PRE_SHA_SNAPSHOT)) ";
    const b = "    const snapLines = ";
    if (!L[0].startsWith(a) || !L[2].startsWith(b)) throw new Error("INFRA-FAIL r21-T34 patch T2：r13 L2144／L2146 原文不符");
    const neu = [`  if (!existsSync(PRE_SHA_SNAPSHOT) && !${R21_T34_G}.miss("pre")) ${L[0].slice(a.length)} // r21#T2（A2-MP-T34）：pre 樹 MISSING（快照遺失）→ 不 INFRA；其他情況原判定`, L[1], `${b}${R21_T34_G}.miss("pre") ? (${R21_T34_G}.unv(["S2", "S3"]), []) : ${L[2].slice(b.length)} // r21#T2：pre MISSING → 空（不讀、不冒充快照）`, ""].join("\n");
    return r21T34Sub("r21-T2 pre-G2S1 sha 快照（S2／S3）", `${L.join("\n")}\n`, neu, [L[0].slice(a.length), L[1].trim(), L[2].slice(b.length)]);
  })(),
  // T3 r13 L2172-2183：pre 樹前提（PRE_FILES 已被修改／pre 備份 sha＝快照）
  r21T34Wrap("r21-T3 pre 樹前提（S4／S5）", 2172, 2183, "pre", ["S4", "S5"], "T3"),
  // T4 source anchors（G2S1／F10／CB／F6／F8 歷史備份）
  r21T34Patch("r21-T4a G2S1 ctd／_app（f9／pre）", 2348, 2358, { 2348: ["read", "f9"], 2349: ["read", "pre"], 2350: ["read", "pre"], 2353: ["guard", "f9", "A1"], 2354: ["guard", "pre", "A2"], 2356: ["guard", "pre", "A2"], 2357: ["guard", "pre", "A3"], 2358: ["guard", "pre", "A3"] }),
  (() => {
    const L = r21T34Src(2367, 2370);
    const neu = [
      `  ...(${R21_T34_G}.miss("pre") ? {} : { ${L[0].trim().replace(/,$/, "")} }), // r21#T4（A2-MP-T34）：pre MISSING → 不讀`,
      L[1].replace("...(WITH_PRE5 ? ", `...(WITH_PRE5 && !${R21_T34_G}.miss("pre5") ? `),
      L[2],
      L[3].replace("...(WITH_PRE4 ? ", `...(WITH_PRE4 && !${R21_T34_G}.miss("pre4") ? `),
      "",
    ].join("\n");
    return r21T34Sub("r21-T4b SRC pre／pre5／pre4", `${L.join("\n")}\n`, neu, [L[0].trim().replace(/,$/, ""), L[1].trim().replace(/^\.\.\.\(WITH_PRE5 \? /, ""), L[2].trim(), L[3].trim().replace(/^\.\.\.\(WITH_PRE4 \? /, "")]);
  })(),
  r21T34Patch("r21-T4c ctdNow／ctdF9（f10／f9）", 2388, 2389, { 2388: ["read", "f10"], 2389: ["read", "f9"] }),
  r21T34Patch("r21-T4d criPre（f10）", 2393, 2393, { 2393: ["read", "f10"] }),
  r21T34Patch("r21-T4e B1 pre-CB ctd 反向 CB anchors（f10）", 2400, 2403, { 2402: ["guard", "f10", "B1"] }),
  R21_T34_T4F,
  r21T34Patch("r21-T4g appF9（f9）", 2414, 2414, { 2414: ["read", "f9"] }),
  r21T34Patch("r21-T4h B4／B5 F10 ctd anchors（f10／f9）", 2415, 2418, { 2416: ["guard", "f10", "B4"], 2417: ["guard", "f9", "B5"] }),
  r21T34Patch("r21-T4i B6 snapshotAreaScope（f10）", 2419, 2419, { 2419: ["guard", "f10", "B6"] }),
  r21T34Patch("r21-T4j B7 F10 前備份 _app（f9）", 2422, 2422, { 2422: ["guard", "f9", "B7"] }),
  r21T34Patch("r21-T4k B8 F10 前備份 _app G2S1 anchor（f9）", 2424, 2427, { 2425: ["guard", "f9", "B8"] }),
  r21T34Patch("r21-T4l B9／B10 pre-CB cri sha／HEAD（f10）", 2436, 2437, { 2436: ["guard", "f10", "B9"], 2437: ["guard", "f10", "B10"] }),
  r21T34Patch("r21-T4m post-F10／pre-F10 快照（f10／f9）", 2440, 2441, { 2440: ["read", "f10"], 2441: ["read", "f9"] }),
  r21T34Patch("r21-T4n B11／B12 post-F10／pre-F10 sha（f10／f9）", 2446, 2447, { 2446: ["guard", "f10", "B11"], 2447: ["guard", "f9", "B12"] }),
  r21T34Sub(
    "r21-T4o source anchors 迴圈：MISSING 樹（A4／A5）",
    'for (const tree of ["work", "pa2", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) { // r14-Δ6：+pa2\n  const src = SRC[tree];\n',
    `for (const tree of ["work", "pa2", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) { // r14-Δ6：+pa2\n  if (${R21_T34_G}.miss(tree)) { ${R21_T34_G}.unv(tree === "pre" ? "A4" : "A5", tree); anchorLines.push(\`\${tree} :: source anchors UNVERIFIED（r21-T34：快照 MISSING，未檢查）\`); continue; } // r21#T4（A2-MP-T34）\n  const src = SRC[tree];\n`,
    ['for (const tree of ["work", "pa2", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) { // r14-Δ6：+pa2', "const src = SRC[tree];"],
  ),
  r21T34Patch("r21-T4p C1 pre(F6) 次數（pre）", 2543, 2545, { 2543: ["guard", "pre", "C1"], 2544: ["guard", "pre", "C1"], 2545: ["guard", "pre", "C1"] }),
  r21T34Patch("r21-T4q C2 pre(L-1) F8 文字（pre）", 2548, 2548, { 2548: ["guard", "pre", "C2"] }),
  r21T34Patch("r21-T4r C3 F7 前 rcl 備份（F7hist）", 2553, 2559, { 2553: ["read", "F7hist"], 2557: ["guard", "F7hist", "C3"], 2559: ["guard", "F7hist", "C3"] }),
  r21T34Patch("r21-T4s C4 pre-L1 備份（L1hist）", 2564, 2567, { 2564: ["read", "L1hist"], 2565: ["guard", "L1hist", "C4"], 2567: ["guard", "L1hist", "C4"] }),
  // T5 r13 L3055（TREES 定義之後）：MISSING 樹自 TREES 移除（不建樹、不跑情境；本次要求的樹記入 dropped）
  r21T34Sub("r21-T5 TREES 移除 MISSING 樹（E1）", r21T34Line(3055), `for (let i = TREES.length - 1; i >= 0; i -= 1) if (${R21_T34_G}.miss(TREES[i])) { ${R21_T34_G}.drop(TREES[i]); ${R21_T34_G}.unv("E1", TREES[i]); TREES.splice(i, 1); } ${R21_T34_G}.trees(TREES); // r21#T5（A2-MP-T34）\n${r21T34Line(3055)}`, [r21T34Line(3055).trim()]),
  // T6 judge／P1 彙整
  r21T34Rep("r21-T6a judge P（pre）", 3220, 'const P = WT === "work" ? ', `const P = WT === "work" && !${R21_T34_G}.miss("pre") ? /* r21#T6 */ `),
  r21T34Sub("r21-T6b rows pre 列", r21T34Line(3262), `        if (WT === "work") rows.push(${R21_T34_G}.miss("pre") ? "    pre:  MISSING（UNVERIFIED：pre 樹快照遺失、未執行；r21-T34）" : \`    pre:  \${fmt(P[i])}\`); // r21#T6\n`, ["`    pre:  ${fmt(P[i])}`"]),
  r21T34Patch("r21-T6c r4-SRC（J1）", 3410, 3410, { 3410: ["guard", "pre", "J1", "`${tag} T${i + 1} source=${spec.source}`"] }),
  r21T34Sub("r21-T6d 情境摘要 PRE 欄", '${WT === "work" ? ` || PRE: ${P.map(short).join(" → ")}` : ""}', `\${WT === "work" ? (${R21_T34_G}.miss("pre") ? " || PRE: MISSING" : \` || PRE: \${P.map(short).join(" → ")}\`) : ""}`, ['` || PRE: ${P.map(short).join(" → ")}`']),
  r21T34Sub(
    "r21-T6e J：MISSING 樹不 judge",
    'const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE5 ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}), ...(WITH_F10 ? { f10: judge("f10") } : {}), ',
    `const J = { work: judge("work"), ...(${R21_T34_G}.miss("pre") ? {} : { pre: judge("pre") }), ...(WITH_PRE5 && !${R21_T34_G}.miss("pre5") ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 && !${R21_T34_G}.miss("pre4") ? { pre4: judge("pre4") } : {}), ...(WITH_F10 && !${R21_T34_G}.miss("f10") ? { f10: judge("f10") } : {}), /* r21#T6 */ `,
    ['work: judge("work")', 'pre: judge("pre")', '{ pre5: judge("pre5") }', '{ pre4: judge("pre4") }', '{ f10: judge("f10") }'],
  ),
  r21T34Sub("r21-T6f extHits pre", r21T34Line(3856), `  if (J.pre) J.pre.p1.push(h); // r21#T6\n`, ["J.pre.p1.push(h);"]),
  r21T34Sub("r21-T6g p1P", r21T34Line(3902), `const p1P = new Set(uniq(J.pre ? J.pre.p1 : [])); // r21#T6：pre MISSING → 空集合（相依輸出由 r21#T7 改標 UNVERIFIED）\n`, ["J.pre.p1"]),
  (() => {
    const L = r21T34Src(3922, 3927);
    const old = `${L.join("\n")}\n`;
    return r21T34Sub("r21-T6h Provider work/pre（R1）", old, `    if (${R21_T34_G}.miss("pre")) { for (const k of Object.keys(w)) provTot.work[k] += w[k]; ${R21_T34_G}.unv("R1"); } else { // r21#T6（A2-MP-T34）：pre MISSING → 只累計 work；否則以下原文逐字\n${old}    } // r21#T6：包覆結束\n`, L.map((l) => l.trim()));
  })(),
  r21T34Sub("r21-T6i 情境×mode pre 欄", "(J.pre.p1ByScenario.get(", "(J.pre?.p1ByScenario.get(", ["p1ByScenario.get("]),
  r21T34Rep("r21-T6j JF9（f9）", 4102, "WITH_F9 ? ", `WITH_F9 && !${R21_T34_G}.miss("f9") ? /* r21#T6 */ `),
  // T7 r13 報告：pre 相依輸出改標 UNVERIFIED（mainReport 之前）
  r21T34Sub(
    "r21-T7a r13 報告 annotate",
    "__r14.mainReport({ out, J, JB, results, TREES, scenarios, MODES, extHits, PROV_TREES, extTotals, cpus:",
    `${R21_T34_G}.annotate(out); // r21#T7（A2-MP-T34）：舊樹 MISSING → 相依輸出改標 UNVERIFIED（每條規則恰好命中 1 次，否則 INFRA-FAIL）\n__r14.mainReport({ out, J, JB, results, TREES, scenarios, MODES, extHits, PROV_TREES, extTotals, cpus:`,
    ["__r14.mainReport({ out, J, JB, results, TREES, scenarios, MODES, extHits, PROV_TREES, extTotals, cpus:"],
  ),
  // T8 結束碼：P1／失敗 → 1（不變）；否則舊樹 MISSING → 2（非全量）
  r21T34Sub("r21-T8 結束碼", "process.exit(p1W.size || __r14.r15.failed() ? 1 : 0);", `process.exit(p1W.size || __r14.r15.failed() ? 1 : ${R21_T34_G}.nonFull() ? 2 : 0); /* r21#T8（A2-MP-T34）：舊樹 MISSING（非全量）→ 2；P1／失敗仍為 1 */`, ["process.exit(p1W.size || __r14.r15.failed() ? 1 : "]),
];
for (const p of R21_T34_R13_PATCHES) R21_R13_PATCHES.push(p);
const R21_R14_PATCHES = [
  {
    id: "r21-E record write",
    kind: "exact",
    old: "      R14_top()?.persists.push(s);\n",
    neu: L(
      "      R14_top()?.persists.push(s);",
      "      __r14.r15.r16.r17.r18.r19.r20.r21.recordWrite(s, persisted, Boolean(R14_top())); // r21#E4：本輪 destination_switch Pending 寫入（Pending 未改變＝沿用，不記錄）",
      "",
    ),
  },
  {
    id: "r21-E exception tighten",
    kind: "exact",
    old: "pendingExtra(r20args)); // r20#E3：r19-E 條件 ∧ r20 收緊條件（任一不成立 → 原 r14-Δ7 P1）\n",
    neu: L(
      "pendingExtra(r20args)); // r20#E3：r19-E 條件 ∧ r20 收緊條件（任一不成立 → 原 r14-Δ7 P1）",
      "          { // r21#E3：r19-E ∧ r20-E ∧ r21-E（只加條件；任一不成立 → 原 r14-Δ7 P1，訊息不變）",
      "            const r21x = __r14.r15.r16.r17.r18.r19.r20.r21.pendingExtra({ ...r20args, created: globalThis.__R21_CREATED ?? null, turnWrites: globalThis.__R21_TURN_WRITES ?? [] });",
      "            __r14.r15.r16.r17.r18.r19.r20.r21.markEvaluated(frame.persists);",
      "            if (!r21x.ok) { r19x.ok = false; r19x.why = [r19x.why, r21x.why].filter(Boolean).join(\"；\"); }",
      "          }",
      "",
    ),
  },
];
// r21-T34（A2-MP-T34）r14 層：摘要行的 MISSING 樹顯示 MISSING（不再是「-」）；總判定 FAIL 不變，否則舊樹 MISSING → 非全量（不得顯示 PASS）
const R21_T34_R14_PATCHES = [
  r21T34Sub("r21-T7b r14 摘要 MISSING 樹", '  const sz = (t) => (P1[t] ? P1[t].size : "-");\n', `  const sz = (t) => (P1[t] ? P1[t].size : ${R21_T34_G}.miss(t) && ${R21_T34_G}.requested(t) ? "MISSING" : "-"); // r21#T7（A2-MP-T34）；r21#T40（A2-MP-T40）：只在本次要求該樹時顯示 MISSING（未帶 --f10 → f10 P1=-）\n`, ["(P1[t] ? P1[t].size : "]),
  // r21#T40（A2-MP-T40；只調整報告呈現）：r14 L933-936「work 相對 f10」在 f10 本次要求但 MISSING 時原地補標（A2-MP-T42：註解行號由 L1151-1154 更正為 L933-936）（原本 P1.f10 不存在 → 整段消失）；P1.f10 存在 → 原文逐字
  r21T34Sub(
    "r21-T40g r14 f10 區段原地標示",
    "    L.push(`\\n══ r14：work 相對 f10 新增 P1=${nf.length}；f10 有、work 無=${[...P1.f10].filter((x) => !P1.work.has(x)).length} ══`);\n  }\n",
    `    L.push(\`\\n══ r14：work 相對 f10 新增 P1=\${nf.length}；f10 有、work 無=\${[...P1.f10].filter((x) => !P1.work.has(x)).length} ══\`);\n  } else if (${R21_T34_G}.miss("f10") && ${R21_T34_G}.requested("f10")) L.push("\\n══ r14：work 相對 f10 新增 P1=MISSING；f10 有、work 無=MISSING ══【UNVERIFIED：f10 樹 MISSING（r21-T34）】", "  UNVERIFIED（f10 樹 MISSING，r21-T34：此區段原由 f10 樹產生；樹未執行 → 原地標示，不得視為 PASS 或 =0）"); // r21#T40（A2-MP-T40）\n`,
    ["L.push(`\\n══ r14：work 相對 f10 新增 P1=${nf.length}；f10 有、work 無=${[...P1.f10].filter((x) => !P1.work.has(x)).length} ══`);"],
  ),
  r21T34Sub("r21-T7c r14 總判定 非全量", '→ ${P1.work.size || __r15.failed() ? "FAIL" : "PASS"}', `→ \${P1.work.size || __r15.failed() ? "FAIL" : ${R21_T34_G}.nonFull() ? ${R21_T34_G}.verdictTag() : "PASS"}`, ['→ ${P1.work.size || __r15.failed() ? "FAIL" : ']),
];
for (const p of R21_T34_R14_PATCHES) R21_R14_PATCHES.push(p);

/** r20 原文層：執行需要（基準＝r20 原文＋本組）。 */
const R21_R20_INFRA = [
  {
    id: "r21-V static imports → __r21.imp",
    old: L('import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync, spawn } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync, readdirSync } = await __r21.imp("node:fs"); // r21#V0：同 r20 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r21.imp("node:crypto");',
      'const { execFileSync, spawn } = await __r21.imp("node:child_process");',
    ),
  },
  { id: "r21-V makeR20 imp", old: "const makeR20 = (extra) => ({\n  imp: (s) => import(s),\n", neu: "const makeR20 = (extra) => ({\n  imp: __r21.imp, // r21#V0\n" },
  { id: "r21-V r20 --check-test-sha off", old: 'if (!IS_CHILD && process.argv.includes("--check-test-sha")) {\n', neu: 'if (__r21.r20Flags === true && !IS_CHILD && process.argv.includes("--check-test-sha")) { // r21#V0：r20 自身旗標停用（由 r21 處理）\n' },
  { id: "r21-V r20 --probe off", old: 'if (!IS_CHILD && process.argv.includes("--probe")) {\n', neu: 'if (__r21.r20Flags === true && !IS_CHILD && process.argv.includes("--probe")) { // r21#V0\n' },
  { id: "r21-V r20 --cross-r4 off", old: 'if (!IS_CHILD && process.argv.includes("--cross-r4")) {\n', neu: 'if (__r21.r20Flags === true && !IS_CHILD && process.argv.includes("--cross-r4")) { // r21#V0\n' },
  { id: "r21-V r20 --r19-parity off", old: 'if (!IS_CHILD && process.argv.includes("--r19-parity")) {\n', neu: 'if (__r21.r20Flags === true && !IS_CHILD && process.argv.includes("--r19-parity")) { // r21#V0\n' },
  { id: "r21-V r20 --emit-diff off", old: 'if (!IS_CHILD && process.argv.includes("--emit-diff")) {\n  const CAP = Symbol("r20-capture");', neu: 'if (__r21.r20Flags === true && !IS_CHILD && process.argv.includes("--emit-diff")) { // r21#V0\n  const CAP = Symbol("r20-capture");' },
  {
    id: "r21 patch hooks r13/r14",
    old: "const R20_R18_PATCHES = [];\n",
    neu: L(
      "const R20_R18_PATCHES = [];",
      "for (const p of __r21.r13Patches) R20_R13_PATCHES.push(p); // r21#V0：R21_R13_PATCHES 套在 R20_R13_PATCHES 之後",
      "for (const p of __r21.r14Patches) R20_R14_PATCHES.push(p); // r21#V0：R21_R14_PATCHES 套在 R20_R14_PATCHES 之後",
      "",
    ),
  },
  { id: "r21 emit capture r19", old: '  r20Body = r20Apply(r19Src, R20_R19_PATCHES, "r19");\n', neu: '  r20Body = r20Apply(r19Src, R20_R19_PATCHES, "r19");\n  if (__r21.onR20Body) __r21.onR20Body(r20Body); // r21#V0：--emit-diff 擷取實際執行的 r19\n' },
  { id: "r21 run extra", old: ")(makeR20({}));", neu: ")(makeR20(__r21.r20Extra ?? {})); // r21#V0" },
];
/** r21-S（A2-MP-T11）r19 原文層錨點與替換（字串內不得含單引號／反斜線：以單引號字串嵌入 r20 原文）。 */
const R21_S_R19_OLD = 'const R19_SNAP_EXTRA_OK = ["src/lib/i18n/chat-runtime.ts", "src/lib/ai/destination-geographic-clarification.ts"];';
const R21_S_R19_NEU = 'const R19_SNAP_EXTRA_OK = ["src/lib/i18n/chat-runtime.ts", "src/lib/ai/destination-geographic-clarification.ts", "src/lib/ai/continue-recommendation-intent.ts"]; // r21#S1：A2-MP-T11 使用者授權 MP-25 第四個施工檔（情境 18）；只擴充 post-MP25 快照允許差異清單（r19Snap／r19Mp25DiffOk 共用），不涉及行為斷言';
/**
 * r21-W（A2-MP-T15）r19 原文層：施工後快照版本識別（性質：版本識別，不涉及行為斷言）。
 *   W1 r19Snap 讀取的快照檔：post-MP25-sha.txt → R21_P25（post-MP25-r2-sha.txt 存在時優先；18 檔逐一吻合、檔案清單＝post-MP-r2 等原檢查不變）。
 *   W2 R19_SNAP_PATCHES_R17 六個 neu（r16 precheck postMP、r13 postCbSha／postA2Lines／cri anchor／F9 postCB、r14 wantApp.work）
 *      內的檔名 post-MP25-sha.txt → R21_P25（只換檔名；old 錨點與其餘字串不變）。
 *   W3 r19Snap L256「相對 post-MP-r2 的差異檔」：chat-turn-destination.ts 只在「快照＝post-MP25-r2-sha.txt 且 work 該檔 sha1 ＝ 該快照的值」時不列為不允許差異；
 *      R19_SNAP_EXTRA_OK 本身不變（r16 precheck 的 mp25DiffOk 仍要求 ctd＋_app 必須）。
 * 以 JSON.stringify 嵌入 r20 原文（r20Apply 套到 r19 原文；錨點必須恰好 1 次，否則 r20 INFRA-FAIL）。
 */
const R21_W_R19 = [
  {
    id: "r21-W1 r19Snap 快照檔 → R21_P25",
    old: "function r19Snap() {\n  const f = `${PRE_DIR}/post-MP25-sha.txt`;\n",
    neu: `function r19Snap() {\n  const f = \`\${PRE_DIR}/${R21_P25}\`; /* r21#W1（A2-MP-T15）：施工後快照版本識別（post-MP25-r2 存在時優先；post-MP25-sha.txt 不改寫） */\n`,
  },
  {
    id: "r21-W2 R19_SNAP_PATCHES_R17 neu 檔名 → R21_P25",
    old: "].map(([old, neu], i) => ({ id: `r19-V post-MP25 r17#${i + 1}`, old, neu }));",
    neu: `].map(([old, neu], i) => ({ id: \`r19-V post-MP25 r17#\${i + 1}\`, old, neu: neu.split("${R21_P25_R1}").join("${R21_P25}") })); /* r21#W2（A2-MP-T15）：六處施工後 sha 檢查只換快照檔名 */`,
  },
  {
    id: "r21-W3 r19Snap 差異檔：chat-turn-destination.ts 綁定 post-MP25-r2 sha1",
    old: 'diff.some((rel) => rel !== "src/routes/_app.chat.tsx" && !R19_SNAP_EXTRA_OK.includes(rel))',
    neu: `diff.some((rel) => rel !== "src/routes/_app.chat.tsx" && !R19_SNAP_EXTRA_OK.includes(rel) && !(rel === "${R21_CTD_REL}" && f === \`\${PRE_DIR}/${R21_P25_R2}\` && typeof s25.get(rel) === "string" && existsSync(\`\${WORK_ROOT}/\${rel}\`) && sha1(readFileSync(\`\${WORK_ROOT}/\${rel}\`)) === s25.get(rel))) /* r21#W3（A2-MP-T15）：ctd 只在 sha1 ＝ post-MP25-r2 時允許 */`,
  },
];
const R21_W_R19_TEXT = R21_W_R19.map((p) => `  { id: ${JSON.stringify(p.id)}, old: ${JSON.stringify(p.old)}, neu: ${JSON.stringify(p.neu)} }, // r21#W0`).join("\n");
/**
 * r21-X（A2-MP-T24）r19 原文層（套在 r21-S／W1～W3 之後；性質：版本識別，不涉及行為斷言；理由：使用者授權 E2 四檔施工＋施工後快照＋r21 版本識別）。
 *   X3 r19 L259 r19Mp25DiffOk（r16 precheck「post-A2 與 post-MP25 的差異檔」）：另加 r21X3Ok(r, 快照檔)＝destination-travel-profile.ts 只在
 *      「快照＝post-MP25-E2-r3-sha.txt、含該檔恰好一列且 work 該檔 sha1 ＝ 該列」時允許；r21X3Ok 以 function 宣告（hoist）供 X2 共用。原條件保留（只加 || 分支）。
 *   X2 r19Snap 差異檔（W3 之後的同一行）：(a) chat-turn-destination.ts 的 W3 條件「快照＝post-MP25-r2」另接受「快照＝post-MP25-E2-r3」（work sha1 ＝ 該快照值的條件不變；
 *      r3 與 r2 的 ctd 列由 X0 保證相同）；(b) 另加 && !r21X3Ok(rel, f)（同 X3）。R19_SNAP_EXTRA_OK 本身不變。
 * 錨點：X3 為 r19 原文；X2 為 W3 套用後的文字（--probe 以「依序套用 S／W1～W3／X」乾跑，每個錨點恰好 1 次）。
 */
const R21_X3_FN = `function r21X3Ok(rel, file) { /* r21#X3（A2-MP-T24）：E2 授權 destination-travel-profile.ts；只在快照＝${R21_P25_R3}、恰好一列且 work sha1 相符時允許（版本識別） */ if (rel !== "${R21_DTP_REL}" || file !== \`\${PRE_DIR}/${R21_P25_R3}\` || !existsSync(file)) return false; const rows = readFileSync(file, "utf8").split("\\n").filter((l) => l.endsWith(" " + rel)); if (rows.length !== 1) return false; const m = rows[0].match(/^([0-9a-f]{40}) {2}(.+)$/); if (!m || m[2] !== rel) return false; const p = \`\${WORK_ROOT}/\${rel}\`; return existsSync(p) && sha1(readFileSync(p)) === m[1]; }`;
const R21_X_R19 = [
  {
    id: "r21-X3 r19Mp25DiffOk：destination-travel-profile.ts 綁定 post-MP25-E2-r3 sha1",
    old: "const r19Mp25DiffOk = (diffRels, required) => required.every((r) => diffRels.includes(r)) && diffRels.every((r) => required.includes(r) || R19_SNAP_EXTRA_OK.includes(r));",
    neu: `${R21_X3_FN}\nconst r19Mp25DiffOk = (diffRels, required) => required.every((r) => diffRels.includes(r)) && diffRels.every((r) => required.includes(r) || R19_SNAP_EXTRA_OK.includes(r) || r21X3Ok(r, \`\${PRE_DIR}/${R21_P25}\`)); /* r21#X3（A2-MP-T24）：原條件保留，只加 || r21X3Ok 分支 */`,
  },
  {
    id: "r21-X2a r19Snap 差異檔：ctd 的 W3 條件另接受 post-MP25-E2-r3",
    old: `f === \`\${PRE_DIR}/${R21_P25_R2}\` && typeof s25.get(rel) === "string"`,
    neu: `(f === \`\${PRE_DIR}/${R21_P25_R2}\` || f === \`\${PRE_DIR}/${R21_P25_R3}\` /* r21#X2a（A2-MP-T24）：r3 的 ctd 列＝r2（X0 保證）；sha1 綁定不變 */) && typeof s25.get(rel) === "string"`,
  },
  {
    id: "r21-X2b r19Snap 差異檔：destination-travel-profile.ts 綁定 post-MP25-E2-r3 sha1",
    old: "=== s25.get(rel))) /* r21#W3（A2-MP-T15）：ctd 只在 sha1 ＝ post-MP25-r2 時允許 */",
    neu: "=== s25.get(rel)) && !r21X3Ok(rel, f)) /* r21#W3（A2-MP-T15）：ctd 只在 sha1 ＝ post-MP25-r2 時允許 */ /* r21#X2b（A2-MP-T24）：dtp 只在快照＝post-MP25-E2-r3 且 sha1 相符時允許 */",
  },
];
const R21_X_R19_TEXT = R21_X_R19.map((p) => `  { id: ${JSON.stringify(p.id)}, old: ${JSON.stringify(p.old)}, neu: ${JSON.stringify(p.neu)} }, // r21#X1`).join("\n");
/**
 * r21-Z（A2-MP-T27）r19 原文層（套在 r21-S／W1～W3／X3／X2a／X2b 之後；性質：版本識別，不涉及行為斷言；理由：使用者授權第五、第六個 Source（E2c）＋施工後快照＋r21 版本識別）。
 *   Z2 r19Snap 差異檔（X2a 套用後的同一行）：ctd 條件「f＝post-MP25-r2 或 post-MP25-E2-r3」另接受「f＝post-MP25-E2-r4」；其後「work sha1 ＝ s25.get(ctd)」不變，
 *      s25 由 f 讀出 → 快照＝r4 時 ctd 綁定 r4 該列 sha1（f0c62632…）。
 *   Z3 r21X3Ok（X3 插入的函式；X3 r19Mp25DiffOk 與 X2b r19Snap 共用）：「file＝post-MP25-E2-r3」另接受「file＝post-MP25-E2-r4」；恰好一列、格式、work sha1 相符條件不變。
 * 錨點：X 套用後的文字（--probe 以「依序套用 S／W1～W3／X／Z」乾跑，每個錨點恰好 1 次）。原 X 條件保留（只加 || 分支）。
 */
const R21_Z_R19 = [
  {
    id: "r21-Z2 r19Snap 差異檔：ctd 的 W3／X2a 條件另接受 post-MP25-E2-r4",
    old: `|| f === \`\${PRE_DIR}/${R21_P25_R3}\` /* r21#X2a（A2-MP-T24）：r3 的 ctd 列＝r2（X0 保證）；sha1 綁定不變 */)`,
    neu: `|| f === \`\${PRE_DIR}/${R21_P25_R3}\` /* r21#X2a（A2-MP-T24）：r3 的 ctd 列＝r2（X0 保證）；sha1 綁定不變 */ || f === \`\${PRE_DIR}/${R21_P25_R4}\` /* r21#Z2（A2-MP-T27）：快照＝r4 時 ctd 綁定 r4 該列 sha1（s25＝r4） */)`,
  },
  {
    id: "r21-Z3 r21X3Ok：destination-travel-profile.ts 另接受快照＝post-MP25-E2-r4",
    old: `file !== \`\${PRE_DIR}/${R21_P25_R3}\` || !existsSync(file)) return false;`,
    neu: `(file !== \`\${PRE_DIR}/${R21_P25_R3}\` && file !== \`\${PRE_DIR}/${R21_P25_R4}\` /* r21#Z3（A2-MP-T27）：另接受 r4（dtp 列＝r3，Z0 保證） */) || !existsSync(file)) return false;`,
  },
];
const R21_Z_R19_TEXT = R21_Z_R19.map((p) => `  { id: ${JSON.stringify(p.id)}, old: ${JSON.stringify(p.old)}, neu: ${JSON.stringify(p.neu)} }, // r21#Z1`).join("\n");
/**
 * r21-Y（A2-MP-T31）r19 原文層（套在 r21-S／W1～W3／X／Z 之後；性質：版本識別，不涉及行為斷言；理由：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別）。
 *   Y2 r19Snap 差異檔（Z2 套用後的同一行）：ctd 條件「f＝post-MP25-r2／E2-r3／E2-r4」另接受「f＝post-MP25-E2-r5」；其後「work sha1 ＝ s25.get(ctd)」不變，s25 由 f 讀出 → 快照＝r5 時綁定 r5 ctd 列（＝r4，Y0 保證）。
 *   Y3 r21X3Ok（Z3 套用後）：「file＝post-MP25-E2-r3／E2-r4」另接受「file＝post-MP25-E2-r5」；恰好一列、格式、work sha1 相符條件不變。
 * 錨點：Z 套用後的文字（--probe 以「依序套用 S／W1～W3／X／Z／Y」乾跑，每個錨點恰好 1 次）。原 Z 條件保留（只加分支）。
 */
const R21_Y_R19 = [
  {
    id: "r21-Y2 r19Snap 差異檔：ctd 的 W3／X2a／Z2 條件另接受 post-MP25-E2-r5",
    old: " /* r21#Z2（A2-MP-T27）：快照＝r4 時 ctd 綁定 r4 該列 sha1（s25＝r4） */)",
    neu: ` /* r21#Z2（A2-MP-T27）：快照＝r4 時 ctd 綁定 r4 該列 sha1（s25＝r4） */ || f === \`\${PRE_DIR}/${R21_P25_R5}\` /* r21#Y2（A2-MP-T31）：快照＝r5 時 ctd 綁定 r5 該列 sha1（s25＝r5；r5 ctd 列＝r4，Y0 保證） */)`,
  },
  {
    id: "r21-Y3 r21X3Ok：destination-travel-profile.ts 另接受快照＝post-MP25-E2-r5",
    old: " /* r21#Z3（A2-MP-T27）：另接受 r4（dtp 列＝r3，Z0 保證） */)",
    neu: ` /* r21#Z3（A2-MP-T27）：另接受 r4（dtp 列＝r3，Z0 保證） */ && file !== \`\${PRE_DIR}/${R21_P25_R5}\` /* r21#Y3（A2-MP-T31）：另接受 r5（dtp 列＝r4＝r3，Y0／Z0 保證） */)`,
  },
];
const R21_Y_R19_TEXT = R21_Y_R19.map((p) => `  { id: ${JSON.stringify(p.id)}, old: ${JSON.stringify(p.old)}, neu: ${JSON.stringify(p.neu)} }, // r21#Y1`).join("\n");
const R21_R20_PATCHES = [
  ...R21_R20_INFRA,
  {
    id: "r21-V child script",
    old: 'neu: "phase2-r20.mjs`; // r20#V1：',
    neu: 'neu: "phase2-r21.mjs`; // r21#V1：子程序執行 r21（＝r20＋R21 patch）；r20#V1：',
  },
  {
    id: "r21-V whitelist",
    old: "/* r20#V2：＋r20＋mp25-r3（精確路徑） */ && f !== `",
    neu: `${String.raw`/* r20#V2：＋r20＋mp25-r3（精確路徑） */ && f !== \\"scripts/verify-destination-authority-phase2-r21.mjs\\" && f !== \\"scripts/verify-more-places-destination-switch-mp25-r4.mjs\\" /* r21#V2：＋r21＋mp25-r4（精確路徑） */ && f !== `}\``,
  },
  { id: "r21-V summary", old: 'neu: "phase2-r20: work P1=" }', neu: 'neu: "phase2-r21: work P1=" /* r21#V3 */ }' },
  {
    // A2-MP-T11：r20 原文層插入一個 R20_R19_PATCHES 項目，由 r20Apply 套到 r19 原文（r19 檔案本身不改；r19 層錨點同樣必須恰好 1 次，否則 r20 INFRA-FAIL）
    id: "r21-S post-MP25 允許差異檔＋continue-recommendation-intent.ts",
    old: "const R20_R19_PATCHES = [\n  ...R20_R19_INFRA,\n",
    neu: L(
      "const R20_R19_PATCHES = [",
      "  ...R20_R19_INFRA,",
      `  { id: "r21-S r19 R19_SNAP_EXTRA_OK ＋continue-recommendation-intent.ts", old: '${R21_S_R19_OLD}', neu: '${R21_S_R19_NEU}' }, // r21#S1`,
      "",
    ),
  },
  {
    // A2-MP-T15：r21-S 之後再插入 r21-W1～W3（r19 原文層；版本識別）
    id: "r21-W post-MP25-r2 版本識別（R20_R19_PATCHES ＋W1～W3）",
    old: "' }, // r21#S1\n",
    neu: L("' }, // r21#S1", R21_W_R19_TEXT, ""),
  },
  {
    // A2-MP-T24：r21-W3 之後再插入 r21-X3／X2a／X2b（r19 原文層；版本識別）；錨點＝上一個 patch 插入的 W3 行（恰好 1 次）
    id: "r21-X post-MP25-E2-r3 版本識別（R20_R19_PATCHES ＋X3／X2a／X2b）",
    old: `${R21_W_R19_TEXT.split("\n").at(-1)}\n`,
    neu: L(R21_W_R19_TEXT.split("\n").at(-1), R21_X_R19_TEXT, ""),
  },
  {
    // A2-MP-T27：r21-X2b 之後再插入 r21-Z2／Z3（r19 原文層；版本識別）；錨點＝上一個 patch 插入的 X 最後一行（恰好 1 次）
    id: "r21-Z post-MP25-E2-r4 版本識別（R20_R19_PATCHES ＋Z2／Z3）",
    old: `${R21_X_R19_TEXT.split("\n").at(-1)}\n`,
    neu: L(R21_X_R19_TEXT.split("\n").at(-1), R21_Z_R19_TEXT, ""),
  },
  {
    // A2-MP-T31：r21-Z3 之後再插入 r21-Y2／Y3（r19 原文層；版本識別）；錨點＝上一個 patch 插入的 Z 最後一行（恰好 1 次）
    id: "r21-Y post-MP25-E2-r5 版本識別（R20_R19_PATCHES ＋Y2／Y3）",
    old: `${R21_Z_R19_TEXT.split("\n").at(-1)}\n`,
    neu: L(R21_Z_R19_TEXT.split("\n").at(-1), R21_Y_R19_TEXT, ""),
  },
  {
    id: "r21-D r20SameIdentity canonical",
    old: L('  String(a.rawGeographicLabel ?? "").trim() === String(b.rawGeographicLabel ?? "").trim() &&', ""),
    neu: L('  __r21.canonKey(a.rawGeographicLabel) === __r21.canonKey(b.rawGeographicLabel) && // r21#D2：既有 canonical identity（resolveDestinationAlias().normalizedName；金沢＝金澤）取代逐字比對', ""),
  },
  {
    id: "r21 makeR20 r21 handle／report",
    old: "  report: r20Report,\n  summaryFields: r20SummaryFields,\n  state: R20_STATE,\n",
    neu: L(
      "  report: (a) => { r20Report(a); __r21.report(a); }, // r21#R1：r21 報告（只新增輸出）",
      "  summaryFields: (s) => `${r20SummaryFields(s)} ${__r21.summaryFields()}`, // r21#R1：摘要（只新增欄位）",
      "  state: R20_STATE,",
      "  r21: __r21, // r21#V4：r21-E／O 函式（子程序經 __r14.r15.r16.r17.r18.r19.r20.r21 存取）",
      "",
    ),
  },
];
function r21Apply(src, patches, what) {
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
/** 乾跑：R21 的 r13／r14 層錨點對照 r20 --emit-diff 產物（scratchpad/r20.r20-exec.mjs、r20.patched-r14.mjs）。 */
function r21LayerDryRun() {
  const res = [];
  for (const [file, ps] of [[`${PRE_DIR}/r20.r20-exec.mjs`, R21_R13_PATCHES], [`${PRE_DIR}/r20.patched-r14.mjs`, R21_R14_PATCHES]]) {
    const src = existsSync(file) ? readFileSync(file, "utf8") : "";
    for (const p of ps) {
      let n = 0;
      for (let i = src.indexOf(p.old); i >= 0; i = src.indexOf(p.old, i + 1)) n += 1;
      res.push({ id: p.id, n, file: file.split("/").pop() });
    }
  }
  return res;
}

// ════════════════════════ 報告（主程序）════════════════════════
const R21_STATE = { probe: null, limits: null, exc: null, mc: null };
function r21Report({ out, results }) {
  out.push("\n══════════════════════ r21（A2-MP-T9）══════════════════════");
  const lm = R21_STATE.limits;
  out.push(`══ r21 長度上限（既有限制）：使用者原句 ≤${lm.userText}〔${lm.src.userText}〕；地名 ≤${lm.label}〔${lm.src.label}〕 ══`);
  out.push(`══ ★ 測試契約放寬揭露：originalUserText 上限 500（原版 r19 自創）→ ${lm.userText}（既有 chatInput 上限；r20#L1 起）。501～${lm.userText} 字：原版 r19 P1、r20／r21 放行。 ══`);
  out.push(`══ r21-D canonical identity：${R21_CANON.src} ══`);
  for (const l of r21ProbeLines(R21_STATE.probe)) out.push(`  ${l}`);
  for (const l of r21P25Lines()) out.push(`  ${l}`); // r21-W（A2-MP-T15；只新增輸出）
  for (const l of r21MoreContractLines(R21_STATE.mc)) out.push(`  ${l}`); // r21-G（A2-MP-T14；只新增輸出）
  out.push(`  r21-F2（A2-MP-T18）F7 ${R21_E2_REL}：${R21_STATE.e2 ? `${R21_STATE.e2.reason}（快照=${R21_STATE.e2.want ?? "-"} 目前=${R21_STATE.e2.now ?? "-"}）` : "未呼叫"}`); // 只新增輸出
  out.push(`  r21-X4（A2-MP-T24）F7 ${R21_DTP_REL}：${R21_STATE.x4 ? `${R21_STATE.x4.reason}（快照=${R21_STATE.x4.want ?? "-"} 目前=${R21_STATE.x4.now ?? "-"}）` : "未呼叫"}`); // r21#X4：只新增輸出
  out.push(`  r21-Z5（A2-MP-T27）F7 ${R21_TC_REL}：${R21_STATE.z5 ? `${R21_STATE.z5.reason}（快照=${R21_STATE.z5.want ?? "-"} 目前=${R21_STATE.z5.now ?? "-"}）` : "未呼叫"}`); // r21#Z5：只新增輸出
  out.push(`  r21-Z6（A2-MP-T27）r13 L2396 CB_CTD_ANCHORS[0]：${R21_STATE.z6 ? `${R21_STATE.z6.reason}（快照=${R21_STATE.z6.want ?? "-"} 目前=${R21_STATE.z6.now ?? "-"}）` : "未呼叫"}`); // r21#Z6：只新增輸出
  for (const y of R21_STATE.y5 ?? [{ rel: R21_E2F_RELS.join("／"), reason: "未呼叫" }]) out.push(`  r21-Y5（A2-MP-T31）F7 ${y.rel}：${y.reason}${y.want !== undefined ? `（快照=${y.want ?? "-"} 目前=${y.now ?? "-"}）` : ""}`); // r21#Y5：只新增輸出
  out.push(`  r21-T47（A2-MP-T47）F7 ${R21_T47_REL}：${R21_STATE.t47 ? `${R21_STATE.t47.reason}（常數=${R21_STATE.t47.want ?? "-"} 清單=${R21_STATE.t47.list ?? "-"} 目前=${R21_STATE.t47.now ?? "-"}）` : "未呼叫"}`); // r21#N1：只新增輸出
  out.push(`  r21-A2SRC（任務單 #104）F7 ${R21_A2SRC_REL}：${R21_STATE.a2src ? `${R21_STATE.a2src.reason}（常數=${R21_STATE.a2src.want ?? "-"} 清單=${R21_STATE.a2src.list ?? "-"} 目前=${R21_STATE.a2src.now ?? "-"}）` : "未呼叫"}`); // r21#N2：只新增輸出
  const ex = {};
  for (const [key, r] of Object.entries(results)) {
    const [tree, mode, sid] = key.split("|");
    const e = (ex[tree] ??= { cbR21: 0, sendApplies: 0, sendNg: 0, writes: 0, outside: 0, lines: [] });
    for (const t of r?.result?.turns ?? []) {
      for (const x of t.r19Exc ?? []) if (/r21:/.test(String(x.why ?? ""))) e.cbR21 += 1;
      e.writes += (t.r21Writes ?? []).length;
      e.outside += (t.r21Writes ?? []).filter((w) => !w.inFrame).length;
      if (t.r21SendExc) {
        e.sendApplies += 1;
        if (!t.r21SendExc.ok) {
          e.sendNg += 1;
          e.lines.push(`[${sid}][${mode}] T${t.turnIndex + 1} ${String(t.r21SendExc.why).slice(0, 200)}`);
        }
      }
    }
  }
  R21_STATE.exc = ex;
  out.push("══ r21-E：實際執行（Callback 內 r21 條件不成立數／send() 層整輪檢查適用數・P1 數／本輪 Pending 寫入數・其中 Callback 外）══");
  for (const [tree, e] of Object.entries(ex)) {
    out.push(`  ${tree.padEnd(5)} Callback 內 r21 不成立=${e.cbR21} send層適用=${e.sendApplies} send層P1=${e.sendNg} Pending 寫入=${e.writes}（Callback 外 ${e.outside}）`);
    for (const l of e.lines.slice(0, 30)) out.push(`    [send層 P1] ${l}`);
  }
  for (const l of r21T34ReportLines(R21_T34)) out.push(l); // r21#T7（A2-MP-T34；只新增輸出）
}
/**
 * r21-T34 --probe 自檢（記憶體內；路徑注入＝exists／io 參數；不建立任何檔案、不改任何快照）：
 * (1) 群組判定：全部不存在 → MISSING；部分存在 → INFRA；全部存在 → PRESENT；work／base／a2／mp1／pa2 恆不 MISSING。
 * (2) 實際 patch 內容的行為：取 T34 patch 的 neu 實際字串，以 new Function 注入假資料執行 —— 「存在但 sha 不符」→ 仍 push（INFRA／P1）；「MISSING」→ 不 push、記 UNVERIFIED。
 * (3) 範圍守門後備：只有 sha 完全相符才放行；快照不存在 → fail；重複列／非 verify-*／已刪除 → 不放行。
 * (4) 結構：每個 T34 patch 的 keep（原文）同時出現在 old 與 neu；每個非靜態 UNVERIFIED id 都有 patch 記錄。
 * (5) annotate：每條規則恰好命中 1 次；缺一條 → INFRA；PASS → 非全量、FAIL 不變。
 */
function r21T34SelfTest() {
  const rows = [];
  const add = (label, pass, note = "") => rows.push({ label, pass: Boolean(pass), note });
  const A40 = "a".repeat(40);
  const B40 = "b".repeat(40);
  const A64 = "c".repeat(64);
  const B64 = "d".repeat(64);
  const allTrees = [...R21_T34_GROUPS, ...R21_T34_AUX].map((g) => g.tree);
  // (1) 群組判定
  const dAbs = r21T34Decide(() => false);
  add("全部歷史快照不存在 → pre／pre5／pre4／f9／f10／F7hist／L1hist 皆 MISSING、無 INFRA", allTrees.every((t) => dAbs.st[t].status === "MISSING") && dAbs.infra.length === 0);
  const dAll = r21T34Decide(() => true);
  add("全部存在 → PRESENT（原檢查逐字執行）、無 INFRA、非全量=否", allTrees.every((t) => dAll.st[t].status === "PRESENT") && dAll.infra.length === 0 && !r21T34Make(dAll, R21_T34_IO).nonFull());
  const dPreP = r21T34Decide((p) => p.endsWith("/chat-turn-destination.pre-G2S1.ts") || p.endsWith("/_app.chat.pre-G2S1.tsx"));
  add("pre 只缺 pre-G2S1-sha.txt（備份存在）→ PARTIAL → INFRA（不降級為 MISSING）", dPreP.st.pre.status === "PARTIAL" && dPreP.infra.some((x) => /r21-T34 pre 快照不完整/.test(x)));
  const dF10P = r21T34Decide((p) => p.endsWith("/post-F10-sha.txt"));
  add("f10 只剩 post-F10-sha.txt → PARTIAL → INFRA", dF10P.st.f10.status === "PARTIAL" && dF10P.infra.some((x) => /r21-T34 f10 快照不完整/.test(x)));
  const tAbs = r21T34Make(dAbs, R21_T34_IO);
  add("work／base／a2／mp1／pa2 不屬任何群組 → miss()=false（所需檔缺失照舊 INFRA-FAIL）", ["work", "base", "a2", "mp1", "pa2"].every((t) => tAbs.miss(t) === false));
  let thrown = false;
  try {
    tAbs.missLabel("pre9(未知)");
  } catch {
    thrown = true;
  }
  add("未知群組標籤 → 丟錯（INFRA）", thrown && tAbs.missLabel("pre(F7 前＝F6)") === true && tAbs.missLabel("pre4(F4 前)") === true);
  // (2) 實際 patch 內容的行為（存在但 sha 不符 → 仍 INFRA；MISSING → UNVERIFIED）
  const byId = (prefix) => R21_T34_R13_PATCHES.find((p) => p.id.startsWith(prefix));
  const lineWith = (p, needle) => p.neu.split("\n").find((l) => l.includes(needle));
  const saved = globalThis.__R21_T34;
  const run = (T, fn) => {
    globalThis.__R21_T34 = T;
    try {
      return fn();
    } finally {
      globalThis.__R21_T34 = saved;
    }
  };
  try {
    const b9 = lineWith(byId("r21-T4l"), 'unv("B9")');
    const f9 = new Function("snapSha", "shaOf", "PRE_DIR", "F10_FILES", "relCri", "G2S1_ANCHOR_FAIL", b9);
    const sinkP = [];
    const tP = r21T34Make(dAll, R21_T34_IO);
    run(tP, () => f9(() => A40, () => B40, "/x", { cri: "/x/cri" }, "cri", sinkP));
    add("B9 實際 neu：f10 PRESENT、pre-CB cri sha1 ≠ pre-CB 快照 → 照舊 push（INFRA-FAIL）", sinkP.length === 1 && /pre-CB 備份 cri 與 pre-CB sha 不符/.test(sinkP[0]) && !tP.hits.size);
    const sinkS = [];
    run(r21T34Make(dAll, R21_T34_IO), () => f9(() => A40, () => A40, "/x", { cri: "/x/cri" }, "cri", sinkS));
    add("B9 實際 neu：f10 PRESENT、sha1 相符 → 不 push（原判定）", sinkS.length === 0);
    const sinkM = [];
    const tM = r21T34Make(dAbs, R21_T34_IO);
    let calls = 0;
    run(tM, () => f9(() => (calls += 1, A40), () => (calls += 1, B40), "/x", {}, "cri", sinkM));
    add("B9 實際 neu：f10 MISSING → 不讀快照、不 push、記 UNVERIFIED B9（不視為 PASS）", sinkM.length === 0 && calls === 0 && tM.hits.get("B9")?.n === 1);
    const b12 = lineWith(byId("r21-T4n"), 'unv("B12")');
    const f12 = new Function("pre", "shaOf", "F9_FILES", "rel", "G2S1_ANCHOR_FAIL", b12);
    const s12 = [];
    run(r21T34Make(dAll, R21_T34_IO), () => f12(A40, () => B40, { r: "/x" }, "r", s12));
    add("B12 實際 neu：f9 PRESENT、F10 前備份 sha1 ≠ pre-F10 → 照舊 push（INFRA-FAIL）", s12.length === 1 && /與 pre-F10 sha 不符/.test(s12[0]));
    const t3 = byId("r21-T3");
    const f3 = new Function("expected", "inSnap", "shaDiff", "preInfra", "PRE_FILES", "readFileSync", "git", "snapLines", "createHash", t3.neu);
    const pi = [];
    run(r21T34Make(dAll, R21_T34_IO), () => f3(new Set(), new Set(), [], pi, { "src/a.ts": "/fake/a" }, () => Buffer.from("X"), () => "", [`${A40}  src/a.ts`], createHash));
    add("S5 實際 neu（T3 包覆）：pre PRESENT、pre 備份 sha1 ≠ 快照 → 照舊 push（INFRA-FAIL pre tree）", pi.length === 1 && /pre 備份 \/fake\/a 與 sha 快照不符/.test(pi[0]));
    const piM = [];
    const tM3 = r21T34Make(dAbs, R21_T34_IO);
    run(tM3, () => f3(new Set(["src/a.ts"]), new Set(), [], piM, { "src/a.ts": "/fake/a" }, () => {
      throw new Error("不得讀取");
    }, () => "", [], createHash));
    add("S4／S5 實際 neu（T3 包覆）：pre MISSING → 不讀備份、不 push、記 UNVERIFIED S4／S5", piM.length === 0 && tM3.hits.get("S4")?.n === 1 && tM3.hits.get("S5")?.n === 1);
    const j1 = lineWith(byId("r21-T6c"), 'unv("J1"');
    const fj = new Function("sig", "w", "pr", "p1", "tag", "i", "spec", j1);
    const p1P = [];
    run(r21T34Make(dAll, R21_T34_IO), () => fj((x) => JSON.stringify(x), { a: 1 }, { a: 2 }, p1P, "[S][ok] x", 0, { source: "chat_shortcut" }));
    add("r4-SRC 實際 neu：pre PRESENT、work≠pre → 照舊 P1（訊息逐字）", p1P.length === 1 && /r4-SRC：F4 改變 source=chat_shortcut 輪次行為/.test(p1P[0]));
    const p1M = [];
    const tMj = r21T34Make(dAbs, R21_T34_IO);
    run(tMj, () => fj((x) => JSON.stringify(x), { a: 1 }, undefined, p1M, "[S][ok] x", 0, { source: "chat_shortcut" }));
    add("r4-SRC 實際 neu：pre MISSING → 不計 P1、不計 PASS、逐輪記 UNVERIFIED J1（含情境／輪次）", p1M.length === 0 && tMj.hits.get("J1")?.n === 1 && /\[S\]\[ok\] x T1 source=chat_shortcut/.test(tMj.hits.get("J1").details[0]));
  } catch (e) {
    add(`實際 patch 行為測試執行失敗：${String(e?.message ?? e).slice(0, 160)}`, false);
  }
  // (3) 範圍守門後備
  const io = {
    p25: () => `${A40}  src/x.ts\n${A40}  src/m.ts\n${A40}  src/dup.ts\n${B40}  src/dup.ts\n${A40}  src/gone.ts\n`,
    mp9: () => `${A64}  scripts/verify-s.mjs\n${A64}  scripts/verify-t.mjs\n${A64}  scripts/notverify.mjs\n`,
    exists: (rel) => rel !== "src/gone.ts",
    sha1: (rel) => ({ "src/x.ts": A40, "src/m.ts": B40, "src/dup.ts": A40, "src/y.ts": A40 })[rel] ?? B40,
    sha256: (rel) => ({ "scripts/verify-s.mjs": A64, "scripts/verify-t.mjs": B64, "scripts/notverify.mjs": A64 })[rel] ?? B64,
  };
  const changed = ["src/x.ts", "src/m.ts", "src/y.ts", "src/dup.ts", "src/gone.ts", "scripts/verify-s.mjs", "scripts/verify-t.mjs", "scripts/verify-new.mjs", "scripts/notverify.mjs"];
  const scP = r21T34Make(dAll, io).scopeFallback(changed);
  add("範圍守門：pre-G2S1 快照存在（PRESENT）→ 後備不啟用、不放行任何檔（原檢查）", scP.active === false && scP.ok.length === 0);
  const scM = r21T34Make(dAbs, io).scopeFallback(changed);
  add("範圍守門後備：只放行 sha 完全相符者（src＝R21_P25 sha1、scripts/verify-*＝pre-MP9T sha256）", JSON.stringify(scM.ok) === JSON.stringify(["src/x.ts", "scripts/verify-s.mjs"]), scM.ok.join(","));
  add("範圍守門後備：sha 不符／不在快照／重複列／已刪除／非 verify-* → 不放行（照舊交由既有清單；否則 INFRA-FAIL）", ["src/m.ts", "src/y.ts", "src/dup.ts", "src/gone.ts", "scripts/verify-t.mjs", "scripts/verify-new.mjs", "scripts/notverify.mjs"].every((r) => !scM.ok.includes(r) && scM.left.some((l) => l.startsWith(r))));
  const scNo25 = r21T34Make(dAbs, { ...io, p25: () => null }).scopeFallback(changed);
  const scNo9 = r21T34Make(dAbs, { ...io, mp9: () => null }).scopeFallback(changed);
  add("範圍守門後備：R21_P25 或 pre-MP9T 快照不存在 → fail（INFRA-FAIL，不降級）、不放行", scNo25.fail.length === 1 && scNo25.ok.length === 0 && scNo9.fail.length === 1 && scNo9.ok.length === 0);
  // (4) 結構
  const all = [...R21_T34_R13_PATCHES, ...R21_T34_R14_PATCHES];
  const bad = all.filter((p) => !p.t34 || !p.t34.keep.length || p.neu === p.old || p.t34.keep.some((k) => !k || !p.old.includes(k) || !p.neu.includes(k)));
  add(`T34 patch ${all.length} 個：keep（原文）同時出現在 old 與 neu（PRESENT 時原敘述逐字執行）`, bad.length === 0, bad.map((p) => p.id).join(",") || "-");
  const built = all.filter((p) => typeof p.t34.from === "number");
  const cover = built.filter((p) => p.t34.keep.length !== p.old.split("\n").filter((l) => l.trim()).length);
  add(`r13 行號擷取的 patch ${built.length} 個：每一行原文都有對應 keep（沒有被刪掉的原敘述）`, cover.length === 0, cover.map((p) => p.id).join(",") || "-");
  const fP = R21_R13_PATCHES.find((p) => p.id === "r21-F F7 post-MP25 版本識別");
  const zP = R21_R13_PATCHES.find((p) => p.id.startsWith("r21-Z6b"));
  add("r21-F neu 含 T3 後備行恰好 1 次；r21-Z6b 原判定 ctdNow.includes(z6Orig) 保留（只加 null 守衛）", fP?.neu.split("scopeFallback(nowChanged)").length - 1 === 1 && zP?.neu.includes("ctdNow.includes(__r14.r15.r16.r17.r18.r19.r20.r21.z6Orig)") && zP?.neu.includes('unv("B1")'));
  const STATIC = new Set(["R2", "R3", "R4"]); // 原本即依 J.f10／JF9／p1P4／p1P5 是否存在輸出，樹不 judge 即不輸出（由本區段揭露）
  const allNeu = [...all.map((p) => p.neu), zP?.neu ?? "", fP?.neu ?? "", r21T34Annotate.toString()].join("\n");
  const unref = R21_T34_LOST.filter((x) => !STATIC.has(x.id) && !allNeu.includes(`"${x.id}"`));
  add(`UNVERIFIED 檢查 ${R21_T34_LOST.length} 項：非靜態項目皆有 patch 記錄實際跳過（靜態：${[...STATIC].join("／")}）`, unref.length === 0, unref.map((x) => x.id).join(",") || "-");
  // (5) annotate
  const mkOut = (verdict) => ["intro", "\n══ F5 前 sha 快照比對（與快照不同的 src 檔）══", "(none)", "\n══ 真實模組 probe：x ══", "\n══ overlay 實際生效的檔案 ══", "pre: (none)", "base: (none)", "\n══ Provider 呼叫 work(F5 後) / pre(F5 前) ══", "總計 geocode 1/0", "(work 與 pre 每個情境每個 mode 的 Provider 呼叫數完全相同)", "\n══ 外部請求攔截 ══", "\n══ work 新增 P1（pre 沒有）══", "x1", "\n══ F5 消除的 P1（pre 有、work 沒有）══", "(none)", "\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══", "(none)", "\n══ REVIEW ══", "\n══ 每 mode PASS/FAIL（work；情境數；FAIL＝該情境該 mode 有 P1）══", "ok        T27 PASS=1 FAIL=0", "\n══ 情境 × mode P1 數（work/pre；只列任一方 > 0）══", "[s1] ok=2/0 timeout=0/0", "\n══ P1 計數 ══", "work: P1=2（x）", "pre: P1=0（x）", "新增 P1（work 有、pre 無）=2  F5 消除=0", "Provider 新增（work > pre 的情境×mode）=0  其中 geocode=0  credits=0", "\n══ r7：work 新增 P1（相對 pre＝F6）中的 R7/R6 情境 ══", "(none)", "\n══ r7：throw ══", "\n══ r9：G2S1 真實模組 probe（work / pre；base 無 chat-turn-destination）══", "work  (none)", "pre   (none)", "\n══ r9：R9 情境 P1（pre＝G2S1 前）=0 ══", "(none)", "\n══ r9：R9 情境 P1（base＝aa2db59）=0 ══", "\n══ r10：R10 情境 P1（pre＝G2S1 前）=0 ══", "(none)", "\n══ r10：R10 情境 P1（base）=0（不列明細）══", "\nverify-destination-authority-phase2-r10: work P1=2 pre P1=0 base P1=1 新增P1(vs pre)=2 R10 P1(work)=0 external=0", "\n情境=0", `verify-destination-authority-phase2-r10(r9 總表): work P1=0 pre P1=0 base P1=0 新增P1(vs pre)=0 新增P1(vs base，非 Provider 類)=0 COST-NOTE=0 DIFF-expected=0 UX=0 external=0 → ${verdict}`];
  try {
    const o = mkOut("PASS");
    const tA = r21T34Make(dAbs, R21_T34_IO);
    tA.annotate(o);
    const txt = o.join("\n");
    const okA = /^［r21-T34］舊樹 MISSING/.test(o[1]) && o.includes("pre: MISSING（UNVERIFIED：pre 樹未執行）") && o.includes("pre: P1=MISSING（UNVERIFIED：pre 樹未執行）") && o.includes("pre   MISSING（UNVERIFIED：pre 樹未執行）") && o.includes("[s1] ok=2/MISSING timeout=0/MISSING") && !o.includes("(work 與 pre 每個情境每個 mode 的 Provider 呼叫數完全相同)") && !o.includes("x1") && /pre P1=MISSING .*新增P1\(vs pre\)=UNVERIFIED .* → 非全量（舊樹 MISSING：/.test(o.at(-1)) && !/→ PASS/.test(txt) && tA.annotated.rules === 16;
    add("annotate：16 條規則各命中 1 次；pre 相依區段改標 UNVERIFIED；r9 總表 PASS → 非全量（報告中不留 → PASS）", okA);
    const oF = mkOut("FAIL");
    r21T34Make(dAbs, R21_T34_IO).annotate(oF);
    add("annotate：總表 FAIL → 仍為 FAIL（只把 pre 欄改 MISSING／UNVERIFIED）", / → FAIL$/.test(oF.at(-1)) && /pre P1=MISSING/.test(oF.at(-1)));
    const oN = mkOut("PASS").filter((s) => s !== "\n══ work 新增 P1（pre 沒有）══");
    let inf = false;
    try {
      r21T34Make(dAbs, R21_T34_IO).annotate(oN);
    } catch (e) {
      inf = /INFRA-FAIL r21-T34 annotate/.test(String(e?.message));
    }
    add("annotate：規則命中 0 次（輸出格式被改）→ INFRA-FAIL（不靜默略過）", inf);
    const oP = mkOut("PASS");
    r21T34Make(dAll, R21_T34_IO).annotate(oP);
    add("annotate：全部 PRESENT → 不改任何輸出（原報告逐字）", JSON.stringify(oP) === JSON.stringify(mkOut("PASS")));
    // ── r21#T40（A2-MP-T40；只調整報告呈現）：原地標示 MISSING／R9・R10 標題不留 =0／未要求的樹不顯示 MISSING ──
    const ioArgv = (argv) => ({ ...R21_T34_IO, argv: () => ["node", "r21", ...argv] });
    const ALLF = ["--f10", "--f9", "--pre4", "--pre5"];
    const H = (t, head) => `\n══ ${head} ══【UNVERIFIED：${t} 樹 MISSING（r21-T34）】`;
    const MODEH = (t) => `\n══ 每 mode PASS/FAIL（${t}；情境數；FAIL＝該情境該 mode 有 P1）══`;
    const MH = (t) => H(t, MODEH(t).slice(4, -2)); // 原地標示的每 mode 標題（ph() 在 ══ 前多一空白）
    /** 原地標示區段（下一行含「此區段原由」）恰為 n 個；標題皆以 UNVERIFIED 標籤結尾、不含任何計數（=數字）、不含「→ PASS」。 */
    const phOk = (o, n) => {
      const idx = o.map((_, i) => i).filter((i) => String(o[i + 1] ?? "").startsWith("UNVERIFIED（") && String(o[i + 1]).includes("此區段原由"));
      return idx.length === n && idx.every((i) => /【UNVERIFIED：\w+ 樹 MISSING（r21-T34）】$/.test(o[i]) && !/=\d/.test(o[i]) && !/→ PASS/.test(o[i]));
    };
    const o0 = mkOut("PASS");
    const t0 = r21T34Make(dAbs, ioArgv([]));
    t0.annotate(o0);
    const head0 = /^［r21-T34］舊樹 MISSING：(.*?) → 非全量/.exec(o0[1])?.[1] ?? "(無)";
    add("T40 R9／R10 pre 標題：pre MISSING → 標題 =MISSING＋UNVERIFIED（不再保留 =0）", o0.includes(`\n══ r9：R9 情境 P1（pre＝G2S1 前）=MISSING ══${R21_T34_TAG}`) && o0.includes(`\n══ r10：R10 情境 P1（pre＝G2S1 前）=MISSING ══${R21_T34_TAG}`) && !o0.some((s) => /（pre＝G2S1 前）=\d+ ══/.test(s)));
    add("T40 對照：R9／R10 base 標題的實際計數不改（=0 照舊；只改 pre）", o0.includes("\n══ r9：R9 情境 P1（base＝aa2db59）=0 ══") && o0.includes("\n══ r10：R10 情境 P1（base）=0（不列明細）══"));
    add("T40 pre 每 mode 區段原地標示：緊接 work 每 mode 區段之後（標題＋UNVERIFIED、無計數）", o0.indexOf(MH("pre")) === o0.indexOf(MODEH("work")) + 2 && phOk(o0, 1) && t0.annotated.rules === 16 && t0.annotated.placed.length === 1, `placed=${t0.annotated.placed.join("、")}`);
    add("T40 未帶 --f10／--f9／--pre4／--pre5：不補這些樹的區段、標頭與總判定不列為 MISSING", !o0.some((s) => /【UNVERIFIED：(f10|f9|pre4|pre5) 樹 MISSING/.test(s)) && !/f10|f9|pre4|pre5/.test(head0) && !/f10|f9|pre4|pre5/.test(t0.verdictTag()), head0);
    const o1 = mkOut("PASS");
    const t1 = r21T34Make(dAbs, ioArgv(ALLF));
    t1.annotate(o1);
    const at = (s) => o1.indexOf(s);
    const wM = at(MODEH("work"));
    const seqMode = ["pre", "pre5", "pre4", "f10"].every((t, k) => at(MH(t)) === wM + 2 + 2 * k);
    const pP = at(`\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══${R21_T34_TAG}`);
    const seqP45 = at(H("pre4", "pre4（F4 前）P1=MISSING（僅列 R4/R5 情境）")) === pP + 2 && at(H("pre5", "pre5（F5 前）P1=MISSING（僅列 R4/R5/R6 情境）")) === pP + 4;
    const pc = at("pre: P1=MISSING（UNVERIFIED：pre 樹未執行）");
    const seqCnt = o1[pc + 1] === "pre5: P1=MISSING（UNVERIFIED：pre5 樹快照遺失、未執行；r21-T34）" && o1[pc + 2] === "pre4: P1=MISSING（UNVERIFIED：pre4 樹快照遺失、未執行；r21-T34）";
    const bI = o1.findIndex((s) => s.startsWith("\n══ r10：R10 情境 P1（base）="));
    const seqR10 = at(H("f9", "r10：R10 情境 P1（f9＝F10 前）=MISSING")) === bI - 2 && at(H("f9", "r10：work 相對 f9（F10 前）新增 P1=MISSING")) === bI + 1 && at(H("f9", "r10：F10 消除的 P1（f9 有、work 無）=MISSING")) === bI + 3 && at(H("f10", "r11：R10 情境 P1（f10＝CB 前）=MISSING")) === bI + 5 && at(H("f10", "r11：work 相對 f10（CB 前）新增 P1=MISSING")) === bI + 7 && at(H("f10", "r11：CB 消除的 P1（f10 有、work 無）=MISSING")) === bI + 9;
    add("T40 帶 --f10／--f9／--pre4／--pre5：各區段在 r13 原位置補標（每 mode pre→pre5→pre4→f10；pre4／pre5 P1；P1 計數；R10 f9 在 base 前、f9／r11 f10 在 base 後）", seqMode && seqP45 && seqCnt && seqR10 && phOk(o1, 12) && t1.annotated.placed.length === 14 && t1.annotated.rules === 16, `mode=${seqMode} p45=${seqP45} cnt=${seqCnt} r10=${seqR10} placed=${t1.annotated.placed.length}`);
    add("T40 帶旗標：標頭列出 f10／f9／pre4／pre5 為 MISSING；總表 PASS → 非全量（不留 → PASS）", /f10/.test(/^［r21-T34］舊樹 MISSING：(.*?) → 非全量/.exec(o1[1])?.[1] ?? "") && !/→ PASS$/.test(o1.at(-1)) && / → 非全量（舊樹 MISSING：/.test(o1.at(-1)));
    const f10Files = R21_T34_GROUPS.find((g) => g.tree === "f10").files;
    const dF10M = r21T34Decide((p) => !f10Files.some((f) => p.endsWith(`/${f}`)));
    const o2 = mkOut("PASS");
    const t2 = r21T34Make(dF10M, ioArgv(["--f10"]));
    t2.annotate(o2);
    add("T40 pre PRESENT、f10 MISSING（--f10）：只補 f10 區段（每 mode f10＋r11 三段）、pre 相依輸出原文不動", t2.annotated.rules === 0 && t2.annotated.placed.length === 4 && o2.includes("pre: (none)") && o2.includes("\n══ r9：R9 情境 P1（pre＝G2S1 前）=0 ══") && o2.indexOf(MH("f10")) === o2.indexOf(MODEH("work")) + 2 && phOk(o2, 4));
    const o3 = mkOut("PASS").filter((s) => s !== MODEH("work"));
    let inf3 = false;
    try {
      r21T34Make(dAbs, ioArgv([])).annotate(o3);
    } catch (e) {
      inf3 = /INFRA-FAIL r21-T34 annotate：每 mode PASS\/FAIL（work） 命中 0 次/.test(String(e?.message));
    }
    add("T40 原地標示錨點命中 0 次（輸出格式被改）→ INFRA-FAIL（不靜默略過）", inf3);
    // r14 層：摘要 sz／f10 區段（取實際 patch neu 執行）
    const szP = R21_T34_R14_PATCHES.find((p) => p.id.startsWith("r21-T7b"));
    const szOf = (T, P1) => run(T, () => {
      const sz = new Function("P1", `${szP.neu}return sz;`)(P1);
      return ["f10", "pre", "work"].map((t) => sz(t)).join("|");
    });
    const P1w = { work: new Set(["a", "b"]) };
    add("T40 r14 摘要 sz：未帶 --f10 → f10=-、pre=MISSING；帶 --f10 → f10=MISSING；f10 有執行 → 實際數字", szOf(r21T34Make(dAbs, ioArgv([])), P1w) === "-|MISSING|2" && szOf(r21T34Make(dAbs, ioArgv(["--f10"])), P1w) === "MISSING|MISSING|2" && szOf(r21T34Make(dAll, ioArgv(["--f10"])), { ...P1w, f10: new Set(["a"]) }) === "1|-|2", `${szOf(r21T34Make(dAbs, ioArgv([])), P1w)}`);
    const f40 = R21_T34_R14_PATCHES.find((p) => p.id.startsWith("r21-T40g"));
    const f40Run = (T, P1) => run(T, () => new Function("P1", `const L = [];\n  if (P1.f10) {\n    const nf = [...P1.work].filter((x) => !P1.f10.has(x));\n${f40.neu}return L;`)(P1));
    const L1 = f40Run(r21T34Make(dAbs, ioArgv(["--f10"])), P1w);
    const L0 = f40Run(r21T34Make(dAbs, ioArgv([])), P1w);
    const Lp = f40Run(r21T34Make(dAll, ioArgv(["--f10"])), { ...P1w, f10: new Set(["a", "c"]) });
    add("T40 r14 work 相對 f10：--f10 且 MISSING → 原地標示 =MISSING＋UNVERIFIED；未帶 --f10 → 不輸出；f10 有執行 → 原文逐字（實際數字）", L1.length === 2 && /=MISSING；f10 有、work 無=MISSING ══【UNVERIFIED：f10 樹 MISSING（r21-T34）】$/.test(L1[0]) && /^  UNVERIFIED（/.test(L1[1]) && L0.length === 0 && Lp.length === 1 && Lp[0] === "\n══ r14：work 相對 f10 新增 P1=1；f10 有、work 無=1 ══");
    // r21-T34 區段：未要求且未跳過 → [未要求]；未要求但實際跳過 >0 → 仍 UNVERIFIED；要求 → UNVERIFIED
    const tR0 = r21T34Make(dAbs, ioArgv([]));
    const tR1 = r21T34Make(dAbs, ioArgv([]));
    tR1.unv("B9");
    const tR2 = r21T34Make(dAbs, ioArgv(["--f10"]));
    const rl = (T, id) => r21T34ReportLines(T).find((l) => l.includes(`] ${id} `)) ?? "";
    add("T40 r21-T34 區段：R2（僅 --f10）未要求且跳過 0 次 → [未要求]（不列 MISSING）；帶 --f10 → [UNVERIFIED]…MISSING：f10", /^ {4}\[未要求\] R2 /.test(rl(tR0, "R2")) && !/MISSING：/.test(rl(tR0, "R2")) && /^ {4}\[UNVERIFIED\] R2 .*MISSING：f10/.test(rl(tR2, "R2")), rl(tR0, "R2").slice(0, 80));
    // r21#T42（A2-MP-T42；只調整呈現）：原斷言 `/未要求該樹、但其歷史快照相依檢查已跳過（UNVERIFIED）：f10/.test(tR1.missText()) && !/f10/.test(tR0.missText())`（刪除）
    //   → 相依檢查移到獨立欄位 depText()：tR1.depText()＝「相依檢查 UNVERIFIED：f10」、tR1.missText() 不含 f10（不接在「舊樹 MISSING：」之後）、tR0 兩者皆不含 f10（加嚴：多驗 missText 不混入）
    add("T40 r21-T34 區段：B9（f10 快照，未帶 --f10 也會檢查）實際跳過 1 次 → 仍 [UNVERIFIED]（不因未要求而隱藏）；相依檢查以獨立欄位「相依檢查 UNVERIFIED：f10」列出（A2-MP-T42）", /^ {4}\[UNVERIFIED\] B9 .*實際跳過 1 次/.test(rl(tR1, "B9")) && tR1.depText() === "相依檢查 UNVERIFIED：f10" && !/f10/.test(tR1.missText()) && !/f10/.test(tR0.missText()) && tR0.depText() === "", `miss=${tR1.missText()} dep=${tR1.depText()}`);
    // r21#T42：標頭／verdictTag／總判定的呈現位置——相依欄位不得接在「舊樹 MISSING：」之後（舊樹 MISSING 擷取段不含「相依」）；未跳過時不出現
    {
      const oD = mkOut("PASS");
      tR1.annotate(oD);
      const headD = /^［r21-T34］舊樹 MISSING：(.*?) → 非全量/.exec(oD[1])?.[1] ?? "(無)";
      const vt1 = tR1.verdictTag();
      const vt0 = tR0.verdictTag();
      const tot1 = r21T34ReportLines(tR1).find((l) => l.startsWith("  總判定（r21-T34）")) ?? "";
      add("T42 標頭／verdictTag／總判定：「相依檢查 UNVERIFIED：f10」為獨立欄位（位於「→ 非全量」之後），不接在「舊樹 MISSING：」之後；未跳過 → 不出現", !/相依|f10/.test(headD) && /→ 非全量。［相依檢查 UNVERIFIED：f10（/.test(oD[1]) && /^非全量（舊樹 MISSING：[^；（]* → 非全量；相依檢查 UNVERIFIED：f10；/.test(vt1) && !/相依/.test(vt0) && /→ 非全量；相依檢查 UNVERIFIED：f10；不可宣稱全量 PASS$/.test(tot1), `head=${headD}｜vt=${vt1}｜tot=${tot1.trim()}`);
    }
    add("T40 miss()／nonFull()／結束碼判定不受 requested 影響（只改呈現）", tR0.miss("f10") === true && tR0.nonFull() === true && r21T34Make(dF10M, ioArgv([])).nonFull() === true);
  } catch (e) {
    add(`annotate 自檢執行失敗：${String(e?.message ?? e).slice(0, 160)}`, false);
  }
  // 實際狀態（只讀）
  add(`實際狀態：${allTrees.map((t) => `${t}=${R21_T34.dec.st[t].status}`).join(" ")}；PARTIAL（INFRA）=${R21_T34.dec.infra.length}`, R21_T34.dec.infra.length === 0);
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
/** r21#T7（A2-MP-T34）：舊樹 MISSING 表＋UNVERIFIED 逐項＋範圍守門後備明細＋總判定。 */
function r21T34ReportLines(T) {
  const L = [];
  const has = (f) => process.argv.includes(f);
  L.push(`══ r21-T34（A2-MP-T34）：歷史快照狀態 → 舊樹 MISSING／UNVERIFIED ${T.nonFull() ? "（非全量）" : "（完整）"} ══`);
  L.push("  判定規則：群組內檔案全部不存在 → MISSING（不建樹、相依檢查記 UNVERIFIED）；部分存在 → INFRA-FAIL（不降級）；全部存在 → 原檢查逐字執行（sha 不符照舊 INFRA-FAIL）。不以 base／HEAD／其他快照頂替。");
  L.push("  樹／檢查｜原本需要的快照｜現狀｜本次是否要求｜失去的比較能力");
  for (const g of [...R21_T34_GROUPS, ...R21_T34_AUX]) {
    const s = T.dec.st[g.tree];
    const req = g.tree === "pre" ? "是（固定）" : g.flag ? (has(g.flag) ? `是（${g.flag}）` : `否（${g.flag} 未指定）`) : "是（固定的歷史 anchor 檢查）";
    L.push(`  ${g.tree.padEnd(6)}｜${g.files.join("、")}｜${s.status}${s.status === "PRESENT" ? "" : `（不存在：${s.absent.map((p) => p.split("/").pop()).join("、")}）`}｜${req}｜${s.status === "PRESENT" ? "無（原檢查執行）" : g.lost}`);
  }
  L.push(`  ${R21_T34_GEO_F4}：${existsSync(`${PRE_DIR}/${R21_T34_GEO_F4}`) ? "存在" : "不存在"}（r13 L2136-2139 原本即「不存在 → 不檢查」；行為不變，只揭露）`);
  L.push(`  本次實際執行的樹：${T.ranTrees ? T.ranTrees.join("／") : "(未到達 TREES)"}；本次要求但因 MISSING 未執行：${T.dropped.length ? T.dropped.join("／") : "-"}`);
  L.push(`  MISSING 檔案（${uniq([...R21_T34_GROUPS, ...R21_T34_AUX].flatMap((g) => T.dec.st[g.tree].absent)).length}）：${uniq([...R21_T34_GROUPS, ...R21_T34_AUX].flatMap((g) => T.dec.st[g.tree].absent.map((p) => p.split("/").pop()))).join("、") || "-"}`);
  L.push("  依賴舊樹的檢查／比對（新狀態）：");
  for (const x of R21_T34_LOST) {
    const lost = x.trees.filter((t) => T.miss(t));
    const h = T.hits.get(x.id);
    // r21#T40（A2-MP-T40；只調整報告呈現）：MISSING 的樹全部「本次未要求」且實際跳過 0 次 → 不影響本次結果，列「未要求」（不顯示為 MISSING／UNVERIFIED）；其餘（含未要求但實際跳過 >0）照原樣 UNVERIFIED
    if (lost.length && lost.every((t) => !T.requested(t)) && !(h?.n ?? 0)) {
      L.push(`    [未要求] ${x.id} ${x.where}｜需要：${x.trees.join("／")}｜${x.what}｜本次未要求（${uniq(lost.map((t) => [...R21_T34_GROUPS, ...R21_T34_AUX].find((g) => g.tree === t)?.flag ?? t)).join("／")} 未指定）→ 不執行、不影響本次結果（快照狀態見上表）`);
      continue;
    }
    L.push(`    [${lost.length ? "UNVERIFIED" : "原檢查"}] ${x.id} ${x.where}｜需要：${x.trees.join("／")}｜${x.what}${lost.length ? `｜MISSING：${lost.join("／")}｜實際跳過 ${h?.n ?? 0} 次` : ""}`);
    if (x.id === "J1" && h?.details.length) for (const d of h.details.slice(0, 30)) L.push(`        r4-SRC 未驗證：${d}`);
  }
  const sc = T.scope;
  if (sc && sc.active) {
    L.push(`  範圍守門 T34 後備（pre-G2S1 快照 MISSING）：嚴格 sha 綁定放行 ${sc.ok.length} 檔；未由後備放行 ${sc.left.length} 檔（交由既有允許清單；不在任何清單 → 照舊 INFRA-FAIL）；快照缺失=${sc.fail.length}`);
    for (const d of sc.detail) L.push(`    [後備放行] ${d}`);
    for (const d of sc.left.slice(0, 80)) L.push(`    [未由後備放行] ${d}`);
    L.push("    UNVERIFIED：R21_P25／pre-MP9T 快照內容相對 G2S1 起算的授權鏈（原由 pre-G2S1 快照逐檔證明）無法重新證明；被還原為 HEAD 的 G2S1 前修改檔亦無法偵測。");
  } else L.push(`  範圍守門：${sc ? "原檢查（pre-G2S1 快照存在）" : "未到達"}`);
  L.push(`  r21-T34 annotate：${T.annotated ? `${T.annotated.rules} 條規則；原地標示 ${(T.annotated.placed ?? []).length} 處${(T.annotated.placed ?? []).length ? `（${T.annotated.placed.join("、")}）` : ""}` : "未到達"}`); // r21#T40（A2-MP-T40）：另列原地標示；原只列規則數
  L.push(`  總判定（r21-T34）：${T.nonFull() ? `舊樹 MISSING（${T.missText()}）→ 非全量${T.depSuffix()}；不可宣稱全量 PASS` : "完整（無 MISSING）"}`); // r21#T40：原 T.missingTrees().join(",")；r21#T42：相依檢查改獨立欄位
  return L;
}
function r21SummaryFields() {
  const w = R21_STATE.exc?.work ?? { cbR21: 0, sendApplies: 0, sendNg: 0, writes: 0 };
  const t34 = R21_T34.nonFull() ? ` T34[舊樹 MISSING=${R21_T34.missText()} → 非全量${R21_T34.depSuffix()}；r4-SRC 未驗證=${R21_T34.hits.get("J1")?.n ?? 0}]` : " T34[完整]"; // r21#T7（A2-MP-T34）；r21#T40（A2-MP-T40）：原 missingTrees().join(",")
  return `r21[探針=${R21_STATE.probe?.pass}/${R21_STATE.probe?.n} 原句上限=${R21_STATE.limits?.userText}（相對原版 r19 500 放寬） canon=resolveDestinationAlias work Callback內r21P1=${w.cbR21} send層適用=${w.sendApplies} send層P1=${w.sendNg} Pending寫入=${w.writes}]${t34}`;
}

// ════════════════════════ 契約差異（r21 相對 r20）════════════════════════
export const R21_CONTRACT = [
  { item: "r20#L1 originalUserText 長度上限", old: "原版 r19 L116：> 500 → 不成立（r19 自創數字）；r20#L1 改為 > 4000，但 r20 未揭露、r20 探針「r19 單獨」欄用的是已套 4000 的 r19", neu: "上限仍為既有 chatInput max(4000)（不變）；r21 在檔頭／--probe／報告／契約差異逐處標示「相對原版 r19 的測試契約放寬」；探針表另列「原版 r19（500）單獨」欄（以原版 r19 原文擷取，未套用 4000）", why: "使用者裁決 2＋T8 修正 a／b", kind: "放寬（唯一授權；本輪揭露，數值不變）" },
  { item: "r20 L110-117 r20SameIdentity（同一 Pending）", old: "rawGeographicLabel 逐字 trim 比對（金沢≠金澤）", neu: `rawGeographicLabel 經既有 canonical identity：${ALIAS_REL} resolveDestinationAlias(x).normalizedName（金澤 record aliases 金澤／金沢／金泽／Kanazawa）；其餘欄位不變`, why: "T8 修正 d；使用者裁決（identity）", kind: "加嚴（以 金沢 重建可被偵測為同一 Pending → 重置計數會被抓）＋修正誤判（同一 Pending 換寫法時不再改拿本輪原句比對）" },
  { item: "parentIntent（r19 L67／L114）", old: "可選；若存在只能是 place_recommendation", neu: "必填，恰為 place_recommendation（缺少或其他值 → 例外不成立 → P1）；r20 探針 R-E02「不含 parentIntent → 放行」在 r21 改判 P1", why: "使用者裁決 1", kind: "加嚴" },
  { item: "輪初已存在的同一 Pending 的 originalUserText（r20 L153-154）", old: "ref＝輪初 Pending 自己的 originalUserText（偽造 Pending 自己比自己必然相等）", neu: "ref＝本程序內實際建立該 Pending 的那一輪原句（r21 登記）；未知（Client 注入／Reload）→ fail-closed 絕對檢查：不得含座標／範圍字樣／既有別名表中 raw、previousConfirmedDestination 以外的城市／不得超過既有上限", why: "T8 修正 e(1)", kind: "加嚴" },
  { item: "rawGeographicLabel 範圍字樣", old: "只檢查座標字串、純數字、長度", neu: "另加：不得含半徑／範圍／radius／公里內／距離單位（例「金澤 半徑3公里」「金澤3km」）", why: "T8 修正 e(3)", kind: "加嚴" },
  { item: "同一流程多次寫入", old: "r19-E：每筆寫入各自檢查（兩筆合法但內容不同 → 放行）", neu: "同一 Callback／同一 User Turn 寫入內容不同的 destination_switch Pending → 不成立；冪等（完全相同）寫入照放行", why: "T8 修正 e(4)", kind: "加嚴" },
  { item: "confirmationAttempts 每輪推進", old: "r19：0–2；r20：同一 Pending 不得變小", neu: "另加：建立輪 ≤1、同一 Pending 一輪最多 +1", why: "使用者裁決 3（同一 User Turn 驗證 ≤1）", kind: "加嚴" },
  { item: "send() 層寫入（r20 只在 Callback 內、可信判定未通過時評估）", old: "Callback 外（send() 區段／r13 模型寫回）寫入 Pending 不跑例外檢查", neu: "輪末：若 Session 有 destination_switch Pending 且本輪有未在 Callback 內評估的寫入 → 以整輪成本跑 r19-E ∧ r20-E ∧ r21-E；不成立 → r14-A2 P1", why: "T8 修正 e(2)", kind: "加嚴（新 P1 來源；現行三樹皆無 Pending 寫入 → 0 次觸發，見 parity）" },
  { item: "KEYS（刪除行統計）", old: "p1.push／notes.push／costNotes／diffExpected／expect:／MODES／ux.push／fail(／viol(／throw new Error", neu: "另加 why.push(／A(／f.push(／fails.push(／add(；r21.diff 以新 KEYS 統計，並以新 KEYS 重算 r20.diff、mp25-r3.diff", why: "T8 修正 c", kind: "-" },
  { item: "輸出保護", old: "r20Mount 只擋 4 個舊 log", neu: "所有輸出模式：只能寫 scratchpad；明列舊 log＋啟動時所有 *.log／*.stdout＋任何已存在檔案一律拒絕", why: "T8 修正 8", kind: "-" },
  { item: "post-MP25 快照允許差異檔（r19 L219 R19_SNAP_EXTRA_OK；r19Snap L256／r19Mp25DiffOk L259／r16 precheck 共用）", old: "_app.chat.tsx（必須）＋chat-runtime.ts／destination-geographic-clarification.ts（可選）", neu: "另加 src/lib/ai/continue-recommendation-intent.ts（可選）；其他檔案出現差異仍 INFRA-FAIL", why: "A2-MP-T11：使用者授權 MP-25 第四個施工檔案（情境 18 修正）", kind: "快照允許清單擴充（不涉及任何行為斷言）" },
  { item: "F7 預檢 unexpected（r13 L2141-2171；PRE_SHA_SNAPSHOT＝pre-G2S1）", old: "shaDiff 不在 PRE_FILES → unexpected（MP-25 施工後 destination-geographic-clarification.ts、chat-runtime.ts 與 pre-G2S1 不同 → INFRA-FAIL）；nowChanged 的 mp25-post 探針未列白名單", neu: "上述兩檔只在「目前 sha1 ＝ scratchpad/post-MP25-sha.txt 該檔 sha1」時移出 unexpected（比照 r13-Δ1 CB_ALLOWED post-A2 寫法；快照缺檔／缺列／不符 → 照舊 INFRA-FAIL）；scripts/verify-more-places-destination-switch-mp25-post.mjs 以精確檔名放行（且不得在 pre-G2S1 快照內）；_app.chat.tsx（PRE_FILES）與 continue-recommendation-intent.ts（postCbSha＝post-MP25）沿用既有機制，未重複放寬；其他 Source 不變", why: "A2-MP-T13：使用者授權 F7 施工後版本識別", kind: "版本識別（不涉及行為斷言）" },
  { item: "r13 L2360-2363 G2S1 位置門檻（r17-V：creditsAt−moreAt < 3000＋F2 區塊扣除）", old: "moreAt<legacyAt<creditsAt 且 credits metadata 距 pushMorePlaceRecommendations 起點 < 3000 字元（MP-25 在其間插入 Pending 分支後實際 4944 → INFRA-FAIL）", neu: "只在 work _app sha1＝post-MP25 時：順序條件保留，字元距離改為 TypeScript AST 安全契約 (a)～(f)（trustedScope 先於任何 Credits／Places；不可信分支無 Credits／Places、以 return 結束；Pending 分支寫入後 return；metadata.destination ← const destination = trustedScope.destination；legacyLabel 與 metadata 在函式範圍內），並跑 12 個變異自檢；其他 sha／其他樹 → 原條件逐字不變", why: "A2-MP-T14：位置比對過時（MP-25 授權施工）；使用者要求以正式結構取代字元距離、不得單純放大常數", kind: "版本識別＋檢查方式改為結構（同等或更嚴：原條件只看距離，新契約另驗 Credits／Places 不在不可信分支、metadata 來源）" },
  { item: "施工後快照檔（r19 L236 r19Snap；r19 L221-226 R19_SNAP_PATCHES_R17 六處：r16 precheck postMP、r13 postCbSha／postA2Lines／cri anchor／F9 postCB、r14 wantApp.work；r21-F；r21-G 啟用條件）", old: "固定讀 scratchpad/post-MP25-sha.txt（MP-25 第 2 輪施工後 _app／geo-clarification／chat-turn-destination 三檔 sha 不符 → INFRA-FAIL）", neu: "scratchpad/post-MP25-r2-sha.txt 存在時優先（post-MP25-sha.txt 只讀、不改寫）；採用前提：與 post-MP25 同 18 檔清單、差異只在 _app.chat.tsx／destination-geographic-clarification.ts／chat-turn-destination.ts（不符 → INFRA-FAIL，不退回）；18 檔逐一吻合等原檢查不變；r21-G 契約 (a)～(f) 與 12 個變異自檢不變", why: "A2-MP-T15：使用者授權 MP-25 第 2 輪（R2＋R1）施工後建立新快照、不得覆蓋 post-MP25", kind: "版本識別（不涉及行為斷言）" },
  { item: "r19 L256 post-MP25 相對 post-MP-r2 的差異檔", old: "_app.chat.tsx（必須）＋R19_SNAP_EXTRA_OK（chat-runtime／geo-clarification／continue-recommendation-intent）；chat-turn-destination.ts 出現 → INFRA-FAIL", neu: "另：chat-turn-destination.ts 只在「快照＝post-MP25-r2-sha.txt 且 work 該檔 sha1 ＝ 該快照的值」時允許（比照 r21-F）；R19_SNAP_EXTRA_OK 本身不變；r16 precheck（ctd＋_app 必須）不變", why: "A2-MP-T15：MP-25 第 2 輪授權施工檔 chat-turn-destination.ts", kind: "版本識別（不涉及行為斷言；綁定 sha1，非無條件放行）" },
  { item: "F7 預檢 unexpected：src/lib/ai/trip-planning-session-reset.ts（A2-MP-T18 r21-F2）", old: "不在 pre-G2S1 快照（49 列）與任何允許清單；E2 修改後出現在 nowChanged → unexpected → INFRA-FAIL", neu: "只有 scratchpad/post-MP25-E2-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）且目前 sha1 相符時移出 unexpected；否則照舊 INFRA-FAIL；其他檔案不放寬", why: "A2-MP-T18：使用者裁決 E2 授權修改 trip-planning-session-reset.ts", kind: "版本識別（不涉及行為斷言）" },
  { item: "施工後快照檔 R21_P25 與 W0 前提（A2-MP-T24 r21-X0）", old: "post-MP25-r2-sha.txt 存在時優先，否則 post-MP25-sha.txt；E2 施工後 continue-recommendation-intent.ts／destination-travel-profile.ts／_app.chat.tsx 與 r2 不符 → r19Snap／r16 precheck INFRA-FAIL、r21-G 未啟用", neu: "post-MP25-E2-r3-sha.txt 存在時再優先；前提：r2 存在、格式與不重複、18 檔清單＝r2＝post-MP25、相對 r2 差異 ⊆ cri／dtp／_app、相對 post-MP25 差異 ⊆ W0 三檔＋cri／dtp；r2 原 W0 前提照跑；不符 → INFRA-FAIL（不退回）", why: "A2-MP-T24：使用者授權 E2 四檔施工＋施工後快照＋r21 版本識別", kind: "版本識別（不涉及行為斷言）" },
  { item: "r19Snap 差異檔／r16 precheck r19Mp25DiffOk／F7 unexpected：destination-travel-profile.ts、chat-turn-destination.ts（A2-MP-T24 r21-X2a／X2b／X3／X4）", old: "dtp 在 post-MP-r2／post-A2／pre-G2S1 快照內，E2 修改後三處皆 INFRA-FAIL；ctd 的 W3 只接受快照＝post-MP25-r2", neu: "dtp 只在快照＝post-MP25-E2-r3、恰好一列且 work sha1 相符時允許（三處；只加分支，原條件保留）；ctd 的 W3 另接受快照＝post-MP25-E2-r3（sha1 綁定不變；r3 ctd 列＝r2 由 X0 保證）", why: "A2-MP-T24：同上", kind: "版本識別（不涉及行為斷言；綁定 sha1，非無條件放行）" },
  { item: "施工後快照檔 R21_P25 與前提（A2-MP-T27 r21-Z0）", old: "post-MP25-E2-r3-sha.txt 存在時優先；E2c 施工後 chat-turn-destination.ts 與 r3 不符 → r19Snap（18 檔逐一吻合）／r16 precheck postMP／r13 F9 postCB INFRA-FAIL", neu: "post-MP25-E2-r4-sha.txt 存在時再優先；前提：r3 存在且通過既有 X0（r21P25R3Decide 原樣）、r4 格式與不重複、18 檔清單＝r3、相對 r3 差異 ⊆ chat-turn-destination.ts；r2 原 W0 前提照跑；不符 → INFRA-FAIL（不退回）", why: "A2-MP-T27：使用者授權第五、第六個 Source（E2c）＋施工後快照＋r21 版本識別", kind: "版本識別（不涉及行為斷言）" },
  { item: "r19Snap 差異檔／r16 precheck r19Mp25DiffOk／F7 unexpected：chat-turn-destination.ts、destination-travel-profile.ts 在快照＝post-MP25-E2-r4 時（A2-MP-T27 r21-Z2／Z3／Z4）", old: "ctd 的 W3／X2a 只接受快照＝post-MP25-r2／E2-r3；dtp 的 r21X3Ok／r21X4Decide 只接受快照＝post-MP25-E2-r3", neu: "ctd 另接受快照＝post-MP25-E2-r4（work sha1 ＝ r4 該列，綁定不變）；dtp 另接受快照＝post-MP25-E2-r4（r4 dtp 列＝r3 由 Z0 保證；恰好一列、sha1 相符條件不變；只加分支，原條件保留）", why: "A2-MP-T27：同上", kind: "版本識別（不涉及行為斷言；綁定 sha1，非無條件放行）" },
  { item: "F7 預檢 unexpected：src/lib/ai/travel-context.ts（A2-MP-T27 r21-Z5）", old: "不在 pre-G2S1 快照（49 列）與任何允許清單；E2c 修改後出現在 nowChanged → unexpected → INFRA-FAIL", neu: "只有 scratchpad/post-MP25-E2c-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）且目前 sha1 相符時移出 unexpected；否則照舊 INFRA-FAIL；其他檔案不放寬（比照 r21-F2）", why: "A2-MP-T27：同上", kind: "版本識別（不涉及行為斷言）" },
  { item: "r13 L2396 CB_CTD_ANCHORS[0] work ctd 逐字 import anchor（A2-MP-T27 r21-Z6）", old: "work ctd 必須逐字含 import { analyzeContinueRecommendationStructure, hasDanglingContinuationFragment, matchesContinueRecommendationGrammar, } from …（E2c 在同一 import 加入 parseNegatedDestinationSwitch → anchor missing → INFRA-FAIL）", neu: "只在 R21_P25＝post-MP25-E2-r4、含 ctd 恰好一列且 work ctd sha1 ＝ 該列時：逐字 anchor 改為原 anchor 在 matchesContinueRecommendationGrammar, 之後多一行 parseNegatedDestinationSwitch,；其他 sha1 → 原 anchor。pre-CB 反向檢查原行不改，Z6 啟用時另以原 anchor 再查一次（同訊息）", why: "A2-MP-T27：使用者授權第五、第六個 Source（E2c）＋r21 版本識別（指派者核准 r21-Z6；先例 r12-Δ3）", kind: "版本識別（不涉及行為斷言；逐字比對、綁定 sha1，非放寬）" },
  { id: "r21-Y0", item: "施工後快照檔 R21_P25 與前提（A2-MP-T31 r21-Y0）", old: "post-MP25-E2-r4-sha.txt 存在時優先；E2f 施工後 _app.chat.tsx 與 r4 不符 → r19Snap（18 檔逐一吻合）／r16 precheck postMP／r14 wantApp.work INFRA-FAIL、r21-G 未啟用", neu: "post-MP25-E2-r5-sha.txt 存在時再優先（r5>r4>r3>r2>r1；選擇式抽成 r21P25Pick，r5 不存在 → 與原式相同）；前提：r4 存在且通過既有 Z0（r21P25R4Decide 原樣，含 X0）、r5 格式與不重複、18 檔清單＝r4、相對 r4 差異 ⊆ _app.chat.tsx；r2 原 W0 前提照跑；不符 → INFRA-FAIL（不退回）", why: "A2-MP-T31：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別", kind: "版本識別，不涉及行為斷言" },
  { id: "r21-Y2／Y3／Y4", item: "r19Snap 差異檔／r16 precheck r19Mp25DiffOk／F7 unexpected：chat-turn-destination.ts、destination-travel-profile.ts 在快照＝post-MP25-E2-r5 時（A2-MP-T31 r21-Y2／Y3／Y4）", old: "ctd 的 W3／X2a／Z2 只接受快照＝post-MP25-r2／E2-r3／E2-r4；dtp 的 r21X3Ok／r21Z4Decide 只接受快照＝post-MP25-E2-r3／E2-r4", neu: "ctd 另接受快照＝post-MP25-E2-r5（work sha1 ＝ r5 該列＝r4 該列，綁定不變）；dtp 另接受快照＝post-MP25-E2-r5（r5 dtp 列＝r4＝r3 由 Y0／Z0 保證；恰好一列、sha1 相符條件不變；只加分支，原條件保留）", why: "A2-MP-T31：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別", kind: "版本識別，不涉及行為斷言（綁定 sha1，非無條件放行）" },
  { id: "r21-Y5", item: "F7 預檢 unexpected：src/lib/ai/trip-planning-context.ts／src/lib/chat-planning-flow.ts／src/lib/recommendation/trip-intent.ts（A2-MP-T31 r21-Y5）", old: "三檔皆不在 pre-G2S1 快照（49 列）與任何允許清單；E2d／E2e 修改後出現在 nowChanged → unexpected → INFRA-FAIL", neu: "逐檔：只有 scratchpad/post-MP25-E2f-sha.txt 存在、含該檔恰好一列（sha1＋兩空白＋相對路徑）且目前 sha1 相符時移出 unexpected；否則照舊 INFRA-FAIL；只針對這三個檔名，其他檔案不放寬（比照 r21-Z5）", why: "A2-MP-T31：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別", kind: "版本識別，不涉及行為斷言" },
  { id: "r21-Y6", item: "r13 L2396 CB_CTD_ANCHORS[0] 在快照＝post-MP25-E2-r5 時（A2-MP-T31 r21-Y6）", old: "r21-Z6 只在 R21_P25＝post-MP25-E2-r4 時改用 E2c 版逐字 anchor；R21_P25＝r5 時會退回原 anchor → work ctd anchor missing → INFRA-FAIL", neu: "R21_P25＝post-MP25-E2-r5、含 ctd 恰好一列且 work ctd sha1 ＝ 該列（＝r4 列，Y0 保證）時，選同一個 E2c 版逐字 anchor；其他 → 原 anchor；非 r5 → r21Z6Decide 原樣；Z6b 反向檢查不變", why: "A2-MP-T31：使用者授權第七、第八、第九個 Source（E2d／E2e）及 _app.chat.tsx 第二階段（E2f）＋施工後快照＋r21 版本識別", kind: "版本識別，不涉及行為斷言（逐字比對、綁定 sha1，非放寬）" },
  { item: "離線可控時間（A2-MP-T18 r21-C）", old: "（無）子程序 Date.now 為真實時間；15 秒冷卻後的行為只能實際等待", neu: "外掛情境 r21ClockByTurn＝{ turnIndex: 毫秒 } 時，該輪開始前子程序 Date.now＝原始＋累計偏移（不等待），記 obs.r21Clock；無此欄位的情境不執行（逐字不變）", why: "A2-MP-T18：使用者授權可控時間測試（冷卻內／冷卻後）", kind: "測試基礎設施（不涉及行為斷言）" },
  { item: "r14 L299 R14_A2_WORK_ANCHORS[2]（work 文字 anchor：if (trustedScope.status !== \"trusted\") {＋緊接 if (!legacyLabel) return false;）", old: "work 必須逐字含此兩行相鄰片段（MP-25 在兩行之間插入 Pending 分支 → anchor missing → INFRA-FAIL）", neu: "只在 r21-G 啟用時（work _app sha1＝post-MP25）、只對 work：改由同一 AST 契約 (b)(c)(f) 判定（不可信分支唯一、無 else、無 Credits／Places、以 return 結束、直接含 if (!legacyLabel) return false;）；pa2 反向檢查與其他 anchor 不變", why: "A2-MP-T14：同上", kind: "版本識別＋檢查方式改為結構（不放寬：相鄰性換成結構條件）" },
  { id: "r21-T34", item: "歷史快照遺失（pre／pre5／pre4／f9／f10 與 F7hist／L1hist；A2-MP-T34）", old: "r13 無條件讀取 pre-G2S1／pre-F10／pre-CB／pre-F5／pre-F4 備份與 pre-G2S1／pre-F10／post-F10／pre-CB sha 快照、resolve-chat-location.pre-F7.ts、_app.chat.pre-L1.tsx → 任一遺失即 INFRA-FAIL（ENOENT），work／base／a2／mp1／pa2 也無法執行", neu: "群組全部不存在 → MISSING：不建樹、相依檢查逐項 UNVERIFIED（實際跳過次數）、報告標示、總判定「非全量」、結束碼 2；部分存在 → INFRA-FAIL；全部存在 → 原檢查逐字。範圍守門（pre-G2S1 基準）改為嚴格 sha 綁定後備（R21_P25 sha1／pre-MP9T sha256），G2S1 起算來源鏈 UNVERIFIED", why: "A2-MP-T34：16（實為 17）個歷史快照遺失、無法以原始 SHA 證實任何復原來源；使用者規則 1～9", kind: "測試基礎設施（不放寬：P1／SAFETY 分類、Credits、Provider 成本、Destination Authority、負向證據 Assertion、Fixture 不變；依賴舊樹者 UNVERIFIED，不計 PASS）" },
  // ── A2-MP-T40（只調整報告呈現；施工前副本 scratchpad/pre-T39-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 db13e073…）──
  { id: "r21-T40a", item: "r21T34Make：本次是否要求該樹（新增 requested／shownMissing／missText）＋verdictTag", old: "verdictTag：`非全量（舊樹 MISSING：${T.missingTrees().join(\",\")} → …）`（刪除行；未帶 --f10 也列 f10）", neu: "requested(tree)＝flag 為 null（pre／F7hist／L1hist）或 argv 含 flag（io.argv＝--probe 注入）；shownMissing＝{ req：要求且 MISSING、dep：未要求但其快照相依檢查本次實際跳過 >0 }；missText＝req 清單（＋dep 另列「本次未要求該樹、但其歷史快照相依檢查已跳過（UNVERIFIED）」）；verdictTag 改用 missText。miss()／missingTrees()／nonFull()／結束碼不變", why: "使用者契約 (三)：沒有要求 f10 的測試不得誤顯示 f10 MISSING（mp25-r4-full-T35.log L2、L16049）；但 f10 快照相依的 B1～B11 本次確實被跳過，不得隱藏", fix: "A2-MP-T40", kind: "報告呈現（不放寬；判定與結束碼不變）" },
  { id: "r21-T40b", item: "r21T34Annotate 標頭與 pre 存在時的提早返回", old: "標頭 `［r21-T34］舊樹 MISSING：${T.missingTrees().join(\",\")} → …`（刪除行）；`if (!T.miss(\"pre\")) return (T.annotated = { rules: 0 });` 位於 isHead 之前（刪除行）", neu: "標頭改用 T.missText()；提早返回移到原地標示之後並回傳 { rules: 0, placed }（pre 存在時照舊不做 pre 規則，但 f9／f10／pre4／pre5 原地標示照做）", why: "同 r21-T40a；pre 存在而 f10 MISSING（--f10）時，原地標示也必須執行", fix: "A2-MP-T40", kind: "報告呈現" },
  { id: "r21-T40c", item: "MISSING 樹的 r13 區段原地標示（r13 L3999-4004 每 mode、L3992-3993 pre4／pre5 P1、L4012 P1 計數、L4125-4139 R10 f9／r11 f10）", old: "（無）樹 MISSING → 不 judge → 這些區段整段消失（mp-cross-r4-r21-T35.log 對照 T16：每 mode pre／f10、r11 三段消失）", neu: "只對「本次要求且 MISSING」的樹，在原位置插入「══ 標題（計數一律 =MISSING 或不附計數）══【UNVERIFIED：樹 MISSING（r21-T34）】」＋「UNVERIFIED（…不得視為 PASS 或 =0）」；錨點（每 mode work、P1（pre）、pre: P1=、R10 base、F10 消除）必須恰好命中 1 次，否則 INFRA-FAIL；回傳 placed 清單並列於 r21-T34 區段", why: "使用者契約 (三)：缺少的 pre／f9／f10 明確原地標示 MISSING／UNVERIFIED；不偽造原始快照、不產生數字", fix: "A2-MP-T40", kind: "報告呈現（只新增 UNVERIFIED 標示；不產生任何計數或 PASS）" },
  { id: "r21-T40d", item: "R9／R10 pre 標題", old: "section(\"r9 R9 情境 P1（pre）\", …, U)／section(\"r10 R10 情境 P1（pre）\", …, U)（刪除行；標題保留 =0）；section 簽章 `const section = (label, pred, line, transform = null) =>`（刪除行）與 section 內 `out[i] = `${out[i]}${R21_T34_TAG}`;`（刪除行）", neu: "section 加第 5 參數 head（預設 null）（標題改寫）；兩條 pre 規則傳 eqMissing（標題結尾 =N ══ → =MISSING ══），其他規則 head＝null（原樣）", why: "使用者契約 (三)：R9／R10 不得把 UNVERIFIED 呈現成 PASS／=0（mp25-r4-full-T35.log L10294、L12529）", fix: "A2-MP-T40", kind: "報告呈現" },
  { id: "r21-T40e", item: "annotate 回傳值", old: "return (T.annotated = { rules: 16 });（刪除行）", neu: "return (T.annotated = { rules: 16, placed });（rules 數不變）", why: "r21-T34 區段列出原地標示清單", fix: "A2-MP-T40", kind: "-" },
  { id: "r21-T40f", item: "r14 摘要 sz（r21-T7b patch neu）", old: "P1[t] ? size : miss(t) ? \"MISSING\" : \"-\"（刪除行；未帶 --f10 → f10 P1=MISSING）", neu: "P1[t] ? size : miss(t) && requested(t) ? \"MISSING\" : \"-\"（pre 固定要求 → 仍 MISSING；未帶 --f10 → f10 P1=-；帶 --f10 → MISSING）；old 與 keep 不變", why: "使用者契約 (三)（mp25-r4-full-T35.log L16049「f10 P1=MISSING」而 mp25 未帶 --f10）", fix: "A2-MP-T40", kind: "報告呈現" },
  { id: "r21-T40g", item: "r14 L933-936「work 相對 f10」區段（A2-MP-T42：行號由 L1151-1154 更正）（新 r14 patch r21-T40a）", old: "if (P1.f10) {…} → f10 MISSING 時整段消失", neu: "原文逐字保留；之後加 else if (miss(\"f10\") && requested(\"f10\")) L.push(標題 =MISSING【UNVERIFIED】, UNVERIFIED 說明)", why: "使用者契約 (三)：f10 相依區段原地標示", fix: "A2-MP-T40", kind: "報告呈現（只新增輸出）" },
  { id: "r21-T40h", item: "r21-T34 區段逐項表／annotate 列／總判定／r21SummaryFields", old: "逐項：MISSING 即 [UNVERIFIED]…MISSING：f10（R2「僅 --f10」未帶旗標、跳過 0 次也列）；annotate 列只列規則數（刪除行）；總判定與 summary 用 missingTrees().join（刪除行×2）", neu: "逐項：MISSING 的樹全部本次未要求且實際跳過 0 次 → [未要求]（不列 MISSING）；其餘照原樣 [UNVERIFIED]（含未要求但實際跳過 >0，如 B1～B11）；annotate 列另列原地標示；總判定與 summary 用 missText", why: "使用者契約 (三)", fix: "A2-MP-T40", kind: "報告呈現" },
  { id: "r21-T40i", item: "--probe r21-T34 自檢 (5) annotate 合成輸出 mkOut", old: "合成 r13 輸出不含「每 mode PASS/FAIL（work；…）」區段（刪除行＝該陣列所在行）", neu: "在 REVIEW 與「情境 × mode P1 數」之間加入真實 r13 輸出也有的「每 mode PASS/FAIL（work；…）」標題＋1 行（原地標示的錨點）；其餘元素與既有 4 條 annotate 斷言不變；另加 T40 自檢 14 條：R9／R10 標題 =MISSING、base 標題計數不改、pre 每 mode 原地標示、未帶旗標不補／不列 MISSING、帶全部旗標的原地順序（14 處）、帶旗標標頭與總表非全量、pre 存在＋f10 MISSING 只補 f10、錨點 0 次 → INFRA、r14 sz 三態、r14 f10 區段三態、逐項 [未要求]／[UNVERIFIED]、B9 跳過 >0 仍 UNVERIFIED 且標頭另列、miss／nonFull 不受影響", why: "任務單 #40 第 3 點（MISSING 原地呈現、R9／R10 UNVERIFIED 不呈現為 =0／PASS、未帶 --f10 不顯示 f10 MISSING）", fix: "A2-MP-T40", kind: "加嚴（自檢）；Fixture 只補真實輸出存在的錨點，意圖不變" },
  // ── A2-MP-T42（只調整報告呈現；施工前副本 scratchpad/pre-T42-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 0970d9b2…；獨立審查 T41 建議項）──
  { id: "r21-T42a", item: "r21T34Make.missText／新增 depText／depSuffix", old: "missText()：`${req.join(\",\") || \"-\"}${dep.length ? `；本次未要求該樹、但其歷史快照相依檢查已跳過（UNVERIFIED）：${dep.join(\",\")}` : \"\"}`（刪除 2 行：`const { req, dep } = T.shownMissing();` 與 return 行）", neu: "missText()＝`req.join(\",\") || \"-\"`（只列本次要求且 MISSING）；depText()＝dep 有 → `相依檢查 UNVERIFIED：${dep.join(\",\")}`，否則 \"\"；depSuffix()＝`；${depText()}` 或 \"\"。shownMissing／requested／miss／nonFull 不變", why: "T41 建議：相依檢查跳過的措辭不得接在「舊樹 MISSING：」之後（易被讀成 f10 MISSING）", fix: "A2-MP-T42", kind: "報告呈現（中性）" },
  { id: "r21-T42b", item: "verdictTag／標頭／總判定／r21SummaryFields", old: "verdictTag `非全量（舊樹 MISSING：${missText} → 非全量；不得視為全量 PASS）`（刪除行）；標頭 `［r21-T34］舊樹 MISSING：${missText} → 非全量。以下與…`（刪除行）；總判定 `舊樹 MISSING（${missText}）→ 非全量；不可宣稱全量 PASS`（刪除行）；summary ` T34[舊樹 MISSING=${missText} → 非全量；r4-SRC…`（刪除行）", neu: "四處皆在「→ 非全量」之後接獨立欄位（verdictTag／總判定／summary：depSuffix()；標頭：`［相依檢查 UNVERIFIED：…（本次未要求該樹，但其歷史快照相依檢查已跳過）］`）；未跳過 → 不輸出。非全量／結束碼不變", why: "同 r21-T42a", fix: "A2-MP-T42", kind: "報告呈現（中性）" },
  { id: "r21-T42c", item: "--probe T40 自檢「B9 跳過 1 次 → 仍 UNVERIFIED；標頭另列」", old: "`/未要求該樹、但其歷史快照相依檢查已跳過（UNVERIFIED）：f10/.test(tR1.missText()) && !/f10/.test(tR0.missText())`（刪除行；測的是舊措辭位置）", neu: "`tR1.depText() === \"相依檢查 UNVERIFIED：f10\" && !/f10/.test(tR1.missText()) && !/f10/.test(tR0.missText()) && tR0.depText() === \"\"`（B9 [UNVERIFIED] 斷言不變）；另加 T42 自檢 1 條：標頭／verdictTag／總判定的相依欄位位於「→ 非全量」之後、不在「舊樹 MISSING：」擷取段內、未跳過時不出現", why: "同 r21-T42a；自檢須跟著呈現位置", fix: "A2-MP-T42", kind: "加嚴（自檢多驗 missText 不混入、位置）" },
  { id: "r21-T42d", item: "註解行號", old: "R21_T34_R14_PATCHES 註解與 r21-T40g item 寫「r14 L1151-1154」（刪除行×2；實際 r14 `if (P1.f10) {…}` 在 L933-936）", neu: "更正為 r14 L933-936（R2 where 欄原本即為 L933-936）", why: "T41 指出註解行號錯誤", fix: "A2-MP-T42", kind: "-（註解）" },
  // ── A2-MP-T47（範圍守門版本識別；施工前副本 scratchpad/pre-T46-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 4329cae0…）──
  { id: "r21-T47a", item: "F7 預檢 unexpected：scripts/verify-negated-switch-s1s4.mjs（r13 L2158 nowChanged／L2170 unexpected；r21-F 區塊）", old: "未追蹤檔、不在 pre-G2S1 快照／pre-MP9T-test-sha.txt／任何白名單 → scopeFallback 列 left（不放行）→ 殘留 unexpected → INFRA-FAIL pre tree（T40 Smoke）", neu: "r21-F 區塊在 T3 後備行之後新增一行（r21#N1）：只有 nowChanged 含逐字相同的 scripts/verify-negated-switch-s1s4.mjs 時判定；目前 sha256 ＝ 常數 R21_T47_SHA256 ＝ R21_T47_SNAP 清單該路徑恰好一列（T47 原綁 1b94b01d…afb090／T46-new-sha.txt，已過時；r21-T54 起改綁 9bdce0b9…80c79b／scratchpad/T53-new-sha.txt）（sha256＋兩空白＋相對路徑）才移出 unexpected；清單不存在／缺列／多列／格式不符／常數與清單不一致／檔案不存在／sha 不符 → preInfra（INFRA-FAIL，訊息指出原因）；不在 nowChanged → 不處理。只比對精確字串（includes／===），不用前綴、正則或萬用字元比對路徑；scopeFallback、pre-MP9T、R21_P25、其他白名單不變", why: "A2-MP-T47：使用者裁決「僅允許 scripts/verify-negated-switch-s1s4.mjs；以已審查的精確 SHA-256 作為版本識別；不得使用 scripts/** 通配放行；SHA 不符：INFRA-FAIL」", fix: "A2-MP-T47", kind: "版本識別（不涉及行為斷言；綁定 sha256，非無條件放行）" },
  { id: "r21-T47b", item: "新增常數／判定（R21_T47_REL／R21_T47_SHA256／R21_T47_SNAP、r21T47Decide、r21T47F7、r21T47SelfTest）與 makeR21.t47F7", old: "（無）", neu: "純判定 r21T47Decide＋主程序呼叫 r21T47F7（結果記 R21_STATE.t47）＋--probe 自檢（純判定變體、路徑變化、實際 r21-F patch 行 new Function 執行、實際清單＝常數、目前狀態）；只新增，無刪除行", why: "同 r21-T47a", fix: "A2-MP-T47", kind: "版本識別（只新增）" },
  { id: "r21-T47c", item: "--probe 總判定 ok 行", old: "const ok = … && yOk && t34Ok; // …r21#T：另加 T34 自檢（只加條件）（刪除行）", neu: "同一行末尾加 && t47Ok（只加條件；其他條件逐字不變）；註解另加 r21#N1 說明", why: "T47 自檢不符時 --probe 必須 FAIL", fix: "A2-MP-T47", kind: "加嚴（自檢）" },
  { id: "r21-T47d", item: "--emit-diff classify MARK 表", old: "const MARK = { V0: …, T8: \"r21-T34 結束碼 非全量＝2（A2-MP-T34）\" };（刪除行）", neu: "同一物件末尾加 N1 標籤（r21#N1；不用 r21#T47 字樣，避免被 /r21#([A-Z]\\d)/ 誤歸為 T4、被 fate 誤歸為 r21#T）；其他鍵值逐字不變", why: "r21.diff hunk 歸類正確", fix: "A2-MP-T47", kind: "-（報告歸類）" },
  { id: "r21-T47e", item: "r21Report 新增一行 r21-T47 狀態", old: "（無）", neu: "out.push(`  r21-T47（A2-MP-T47）F7 …：reason（常數／清單／目前）`)；只新增輸出", why: "Smoke／驗收可觀察判定結果", fix: "A2-MP-T47", kind: "報告（只新增輸出）" },
  // ── A2-AUDIT-8／任務單 #54（r21-T47 重新綁定；施工前副本 scratchpad/pre-T54-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 7c35fd2f…）──
  { id: "r21-T54", item: "r21-T47 版本識別重新綁定：scripts/verify-negated-switch-s1s4.mjs（T53 改版）", old: "R21_T47_SHA256 = \"1b94b01d…afb090\"；R21_T47_SNAP = \"T46-new-sha.txt\"（刪除行）；註解／r21-F patch 行註解／r21-T47a 敘述指 T46-new-sha.txt", neu: "R21_T47_SHA256 = \"9bdce0b9229f50ffa87d465c9d355668103f6cc723180cb6330b518c3880c79b\"（指派者計算）；R21_T47_SNAP = \"T53-new-sha.txt\"（指派者新建、該路徑恰好一列；T46-new-sha.txt 不讀取判定、不修改）；新增 R21_T47_OLD_SHA256（只供 --probe 自檢，不參與判定、非白名單）；--probe T47 自檢新增：綁定常數＝新 sha／清單＝T53-new-sha.txt、舊 sha 作為目前檔案／清單列／注入常數皆 INFRA-FAIL、實際 patch 行以舊 sha 執行 → INFRA、實際過時清單 T46-new-sha.txt 代入 → INFRA；判定邏輯 r21T47Decide（精確路徑、恰好一列、常數＝清單＝目前檔案，否則 INFRA-FAIL）逐字不變，無新增白名單、無前綴／正則／萬用字元", why: "A2-AUDIT-8：使用者裁決「重新綁定 r21 s1s4 SHA-256；不得使用過時 SHA 冒充新版結果」", fix: "A2-AUDIT-8", kind: "版本識別（重新綁定；不涉及行為斷言；自檢加嚴）" },
  // ── 任務單 #56 後續（r21-T47 重新綁定；施工前副本 scratchpad/pre-T56-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 6348f9fd…）──
  { id: "r21-T56", item: "r21-T47 版本識別重新綁定：scripts/verify-negated-switch-s1s4.mjs（T56 改版）", old: "R21_T47_SHA256 = \"9bdce0b9…80c79b\"；R21_T47_SNAP = \"T53-new-sha.txt\"；R21_T47_OLD_SHA256 = \"1b94b01d…afb090\"（刪除行）；--probe 過時清單代入 T46-new-sha.txt；檔頭 r21-T54「T46-new-sha.txt 不再讀取」與 --probe 實際唯讀讀取 T46-new-sha.txt 矛盾；過時清單代入案的 note 把代入內容標成目前 SNAP 名稱", neu: "R21_T47_SHA256 = \"d0a248bded898dc106f1b421db8e442529e10c782ecd89426c3ad5304e12a758\"（指派者計算）；R21_T47_SNAP = \"T56-new-sha.txt\"（指派者新建、s1s4 恰好一列）；R21_T47_OLD_SHA256＝上一版 9bdce0b9…80c79b、新增 R21_T47_OLDEST_SHA256＝最舊 1b94b01d…afb090（皆只供 --probe 自檢，不參與判定、非白名單）；--probe T47 自檢：綁定檢查改為新 sha／T56-new-sha.txt，上一版 sha 沿用 T54 寫法（目前檔案／清單列／注入常數／全為上一版）皆 INFRA，新增最舊 sha 仍 INFRA 一案；過時清單代入改為唯讀 T53-new-sha.txt（仍判 INFRA；不再讀取 T46-new-sha.txt；T46／T53 清單皆不修改）；檔頭 r21-T54 說明更正為「判定不讀、--probe 唯讀代入」；過時清單案 note 只在顯示時把「R21_T47_SNAP 該列」改寫為「代入的過時清單 T53-new-sha.txt 該列」（isInfra 用原始回傳值）；註解與 r21-F patch 行註解改指 T56-new-sha.txt。r21T47Decide 逐字不變；無新增白名單、無前綴／正則／萬用字元", why: "任務單 #56 後續：s1s4 於 T56 改版（指派者算出新 sha）；T55 審查低嚴重度說明問題", fix: "任務單 #56", kind: "版本識別（重新綁定；不涉及行為斷言；自檢加嚴）" },
  // ── 任務單 #61 後續（r21-T47 重新綁定；施工前副本 scratchpad/pre-T61-copies/scripts/verify-destination-authority-phase2-r21.mjs sha256 359d52ac…）──
  { id: "r21-T61", item: "r21-T47 版本識別重新綁定：scripts/verify-negated-switch-s1s4.mjs（T61 改版）", old: "R21_T47_SHA256 = \"d0a248bd…e12a758\"；R21_T47_SNAP = \"T56-new-sha.txt\"；R21_T47_OLD_SHA256 = \"9bdce0b9…80c79b\"（刪除行）；--probe 綁定檢查＝T56 版、上一版案＝9bdce0b9…；--probe 過時清單代入 T53-new-sha.txt；註解與 r21-F patch 行註解指 T56-new-sha.txt", neu: "R21_T47_SHA256 = \"64b785440e79aa1966135928306f9121f7cf44442678079704f5b41990aed225\"（指派者計算；scratchpad/T61-new-sha.txt s1s4 列）；R21_T47_SNAP = \"T61-new-sha.txt\"（指派者新建、s1s4 恰好一列）；R21_T47_OLD_SHA256＝上一版 d0a248bd…e12a758；新增 R21_T47_OLDER_SHA256＝上上版 9bdce0b9…80c79b；R21_T47_OLDEST_SHA256＝最舊 1b94b01d…afb090 不變（三者皆只供 --probe 自檢，不參與判定、非白名單）；--probe T47 自檢：綁定檢查改為新 sha／T61-new-sha.txt，上一版 d0a248bd… 沿用 T54 寫法（目前檔案／清單列／注入常數／全為上一版）皆 INFRA，新增上上版 9bdce0b9… 四種代入皆 INFRA 一案，最舊 1b94b01d… 仍 INFRA；過時清單代入改為唯讀 T56-new-sha.txt（仍判 INFRA；不再讀取 T46／T53-new-sha.txt；T46／T53／T56 清單皆不修改）；檔頭新增 r21-T61 段，註解與 r21-F patch 行註解改指 T61-new-sha.txt。r21T47Decide 函式本體逐字不變；無新增白名單、無前綴／正則／萬用字元", why: "任務單 #61 後續：s1s4 於 T61 改版（指派者算出新 sha）；不得以過時 SHA 冒充新版", fix: "任務單 #61", kind: "版本識別（重新綁定；不涉及行為斷言；自檢加嚴）" },
  // ── 任務單 #64 後續（r21-T47 重新綁定＋T63 第 3 項；施工前副本 scratchpad/pre-T64-copies/scripts/verify-destination-authority-phase2-r21.mjs）──
  { id: "r21-T64", item: "r21-T47 版本識別重新綁定：scripts/verify-negated-switch-s1s4.mjs（T64 改版）＋舊 sha 自檢統一（T63 第 3 項）", old: "R21_T47_SHA256 = \"64b78544…0aed225\"；R21_T47_SNAP = \"T61-new-sha.txt\"；R21_T47_OLD_SHA256 = \"d0a248bd…e12a758\"、R21_T47_OLDER_SHA256 = \"9bdce0b9…80c79b\"（刪除行）；--probe 上一版 4 列（T54 寫法）＋上上版合併列（注入常數＝舊 sha 案未檢查「常數與清單不一致」原因正則；常數＝清單＝目前＝舊 案亦無原因正則）＋最舊列（只 2 種代入）；過時清單代入 T56-new-sha.txt（只檢 isInfra）；註解與 r21-F patch 行註解指 T61-new-sha.txt", neu: "R21_T47_SHA256 = \"d20c00146c16778fbe34359155a7f95f3f2f72ae15a7ecc2291b22544e10f4fb\"（指派者計算；scratchpad/T64-new-sha.txt s1s4 列）；R21_T47_SNAP = \"T64-new-sha.txt\"；R21_T47_OLD_SHA256＝上一版 64b78544…0aed225、R21_T47_OLDER_SHA256＝上上版 d0a248bd…e12a758、新增 R21_T47_OLDER2_SHA256＝第三舊 9bdce0b9…80c79b、R21_T47_OLDEST_SHA256＝最舊 1b94b01d…afb090 不變（皆只供 --probe 自檢，不參與判定、非白名單）；--probe T47 自檢：綁定檢查改為新 sha／T64-new-sha.txt；四個舊 sha 以同一迴圈套用同一組 4 項檢查（目前檔案＝舊 → /目前 sha256/＋含舊 sha；清單列＝舊、注入常數＝舊、常數（預設）＋清單＝目前＝舊 → 皆要求 /常數與清單不一致/），另一列前提檢查（四值＝預期、64 位小寫十六進位、彼此不同、≠ 新常數）；過時清單代入改為唯讀 T61-new-sha.txt，並加 /常數與清單不一致/ 原因正則（T46／T53／T56／T61 清單皆不修改）；檔頭新增 r21-T64 段，註解與 r21-F patch 行註解改指 T64-new-sha.txt。r21T47Decide 函式本體逐字不變；無新增白名單、無前綴／正則／萬用字元路徑比對", why: "任務單 #64 後續：s1s4 於 T64 改版（指派者算出新 sha）；T63 第 3 項：上上版合併列漏了原因正則，所有舊 sha 須與 T56 版同等嚴格", fix: "任務單 #64", kind: "版本識別（重新綁定；不涉及行為斷言；自檢加嚴）" },
  // ── 任務單 #104（r21-A2SRC；施工前副本 scratchpad/A2-BUILD/r21-pre-whitelist.mjs sha256 b46c5f79…）──
  { id: "r21-A2SRC", item: "F7 預檢 unexpected：scripts/verify-a2-source-scenarios.mjs（r13 L2158 nowChanged／L2170 unexpected；r21-F 區塊）", old: "未追蹤檔、不在 pre-G2S1 快照／pre-MP9T-test-sha.txt／任何白名單 → scopeFallback 列 left（不放行）→ 殘留 unexpected → INFRA-FAIL pre tree", neu: "新增常數 R21_A2SRC_REL／R21_A2SRC_SHA256（bb33aa711d6f21869ff11572b97649c16d87cc6ccbdd63e56337e89857d83677）／R21_A2SRC_SNAP（A2SRC-new-sha.txt，指派者建立、只讀）、純判定 r21A2SrcDecide（比照 r21T47Decide）、主程序 r21A2SrcF7（結果記 R21_STATE.a2src）、makeR21.a2srcF7；r21-F 區塊在 r21#N1 行之後新增一行 r21#N2：只有 nowChanged 含逐字相同的 scripts/verify-a2-source-scenarios.mjs 時判定；常數 64 位小寫十六進位 ∧ 清單存在 ∧ 該路徑恰好一列 ∧ 該列逐字「sha256＋兩空白＋相對路徑」 ∧ 該列＝常數 ∧ 目前檔案存在且 sha256＝常數 才移出 unexpected；否則 preInfra（INFRA-FAIL）且留在 unexpected；不在 nowChanged → 不處理。只比對精確字串（includes／===），不用前綴、正則或萬用字元比對路徑、不利用 r13 L2169 既有 regex；--probe 新增 r21-A2SRC 自檢（ok 行只加 && a2Ok）；r21Report 新增一行輸出；--emit-diff MARK 加 N2 標籤。scopeFallback、pre-MP9T、R21_P25、r21-T47 與其他白名單、既有自檢列、任何 Assertion 不變", why: "任務單 #104（A2 方案 A）：只新增一項精確白名單放行 scripts/verify-a2-source-scenarios.mjs（定版 sha256）；sha 不符／檔案不存在／其他檔名／清單多列或格式不符／舊版冒充 → INFRA-FAIL", fix: "任務單 #104", kind: "版本識別（只新增；不涉及行為斷言；綁定 sha256，非無條件放行）" },
];
export const R21_KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail(", "viol(", "throw new Error", "why.push(", "A(", "f.push(", "fails.push(", "add("];

// ════════════════════════ 執行 ════════════════════════
function r21TestShaCheck() {
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
if (!IS_CHILD && process.argv.includes("--check-test-sha")) {
  const r = r21TestShaCheck();
  console.log(`scripts/verify-*.mjs：基準 ${r.base} 支、現在 ${r.now} 支；修改=${r.changed.length} [${r.changed.join(",")}]；新增=${r.added.length} [${r.added.join(",")}]；缺少=${r.missing.length} [${r.missing.join(",")}]`);
  const okAdded = r.added.every((x) => x === SELF_REL || x === MP25_R4);
  process.exit(!r.changed.length && !r.missing.length && okAdded ? 0 : 1);
}

const shaWant = (rel) => (existsSync(TEST_SHA_FILE) ? readFileSync(TEST_SHA_FILE, "utf8").split("\n").find((l) => l.endsWith(`  ${rel}`))?.slice(0, 64) : null);
const r20Text = readFileSync(R20_FILE, "utf8");
const r19Text = readFileSync(R19_FILE, "utf8");
for (const [rel, text] of [["scripts/verify-destination-authority-phase2-r20.mjs", r20Text], ["scripts/verify-destination-authority-phase2-r19.mjs", r19Text], ["scripts/verify-destination-authority-phase2-r13.mjs", R21_T34_R13_TEXT]]) { // r21#T0（A2-MP-T34）：另驗 r13（T34 patch 以 r13 原文行號擷取 old）
  const w = shaWant(rel);
  if (!w || sha256(text) !== w) {
    console.log(`INFRA-FAIL ${rel} sha256=${sha256(text)} ≠ ${w ?? "(缺 scratchpad/pre-MP9T-test-sha.txt)"}（被修改？r21 不執行）`);
    process.exit(1);
  }
}
// r21#T0（A2-MP-T34）：歷史快照「部分存在」→ INFRA-FAIL（不降級為 MISSING）；--probe 只回報（並判 FAIL）
if (!IS_CHILD && !process.argv.includes("--probe") && R21_T34.dec.infra.length) {
  console.log(["INFRA-FAIL r21-T34 歷史快照不完整", ...R21_T34.dec.infra].join("\n"));
  process.exit(1);
}
/**
 * r21-X0（A2-MP-T24）：採用 post-MP25-E2-r3 快照的前提（純判定；t1／t2／t3＝post-MP25／post-MP25-r2／post-MP25-E2-r3 內容，null＝不存在）。
 * 每個非空行必須是「40 位小寫十六進位 sha1＋兩空白＋相對路徑」、同一路徑不得重複；r3 必須 18 檔且清單＝r2＝r1；
 * r3 相對 r2 的差異檔 ⊆ R21_P25_R3_DIFF_OK；r3 相對 r1 的差異檔 ⊆ R21_P25_R3_VS_R1_OK。不符 → fail（主程序 INFRA-FAIL，不退回）。性質：版本識別。
 */
function r21P25R3Decide(t1, t2, t3) {
  const fail = [];
  const parse = (name, text) => {
    const m = new Map();
    if (typeof text !== "string") {
      fail.push(`${name} 不存在（${R21_P25_R3} 需要與其比對）`);
      return null;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (!x) fail.push(`${name} 有格式不符的列（必須「sha1＋兩空白＋相對路徑」）：${JSON.stringify(line.slice(0, 80))}`);
      else if (m.has(x[2])) fail.push(`${name} 重複列：${x[2]}`);
      else m.set(x[2], x[1]);
    }
    return m;
  };
  const a = parse(R21_P25_R1, t1);
  const b = parse(R21_P25_R2, t2);
  const c = parse(R21_P25_R3, t3);
  const diffOf = (x, y) => [...new Set([...x.keys(), ...y.keys()])].filter((rel) => x.get(rel) !== y.get(rel)).sort();
  const res = { fail, diff32: [], diff31: [] };
  if (!a || !b || !c) return res;
  const keys = (m) => JSON.stringify([...m.keys()].sort());
  if (c.size !== 18 || keys(c) !== keys(b) || keys(c) !== keys(a)) fail.push(`${R21_P25_R3} 檔案清單必須與 ${R21_P25_R2}／${R21_P25_R1} 相同（18 檔；實際 ${c.size}）`);
  res.diff32 = diffOf(b, c);
  res.diff31 = diffOf(a, c);
  const bad32 = res.diff32.filter((rel) => !R21_P25_R3_DIFF_OK.includes(rel));
  if (bad32.length) fail.push(`${R21_P25_R3} 相對 ${R21_P25_R2} 的差異檔只能是 ${R21_P25_R3_DIFF_OK.join("／")}（多出：${bad32.join(",")}）`);
  const bad31 = res.diff31.filter((rel) => !R21_P25_R3_VS_R1_OK.includes(rel));
  if (bad31.length) fail.push(`${R21_P25_R3} 相對 ${R21_P25_R1} 的差異檔只能是 ${R21_P25_R3_VS_R1_OK.join("／")}（多出：${bad31.join(",")}）`);
  return res;
}
/** r21-X0 --probe 變體自檢（記憶體內；以實際 r1／r2／r3 內容為基底變造；不寫檔）。 */
function r21P25R3SelfTest() {
  const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
  const t1 = rd(R21_P25_R1);
  const t2 = rd(R21_P25_R2);
  const t3 = rd(R21_P25_R3);
  const rows = [];
  if (typeof t1 !== "string" || typeof t2 !== "string" || typeof t3 !== "string") return { rows: [{ label: "基底快照不全（r1／r2／r3 任一不存在）", want: true, got: false, pass: false }], pass: 0, n: 1 };
  const L3 = t3.split("\n").filter((l) => l.trim());
  const swapSha = (line) => `${line[0] === "0" ? "1" : "0"}${line.slice(1)}`;
  const at = (rel) => L3.findIndex((l) => l.endsWith(`  ${rel}`));
  const join = (ls) => `${ls.join("\n")}\n`;
  const iRt = at("src/lib/i18n/chat-runtime.ts");
  const iCtd = at(R21_CTD_REL);
  const cases = [
    ["實際 r1／r2／r3（現行快照）", t1, t2, t3, true],
    ["r3 少一列（17 檔）", t1, t2, join(L3.slice(1)), false],
    ["r3 多一列（19 檔）", t1, t2, join([...L3, `${"c".repeat(40)}  src/lib/ai/extra-file.ts`]), false],
    ["r3 重複一列", t1, t2, join([...L3, L3[0]]), false],
    ["r3 非允許檔 sha 不同（chat-runtime.ts）", t1, t2, join(L3.map((l, k) => (k === iRt ? swapSha(l) : l))), false],
    ["r3 chat-turn-destination.ts sha 不同於 r2（ctd 不在 r3 允許清單）", t1, t2, join(L3.map((l, k) => (k === iCtd ? swapSha(l) : l))), false],
    ["r3 某列只有一個空白（格式不符）", t1, t2, join(L3.map((l, k) => (k === 0 ? l.replace("  ", " ") : l))), false],
    ["r2 不存在", t1, null, t3, false],
    ["r1 不存在", null, t2, t3, false],
  ];
  for (const [label, a, b, c, want] of cases) {
    const got = r21P25R3Decide(a, b, c).fail.length === 0;
    rows.push({ label, want, got, pass: got === want && (label.startsWith("實際") || iRt >= 0) && iCtd >= 0 });
  }
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
/**
 * r21-Z0（A2-MP-T27）：採用 post-MP25-E2-r4 快照的前提（純判定；t1～t4＝post-MP25／r2／E2-r3／E2-r4 內容，null＝不存在）。
 * 先原樣呼叫 r21P25R3Decide(t1, t2, t3)（r3 必須存在且通過既有 X0 前提；其 fail 全數保留），再檢查 r4：每個非空行「sha1＋兩空白＋相對路徑」、不重複、
 * 18 檔且清單＝r3、r4 相對 r3 的差異檔 ⊆ R21_P25_R4_DIFF_OK（chat-turn-destination.ts）。不符 → fail（主程序 INFRA-FAIL，不退回）。性質：版本識別。
 */
function r21P25R4Decide(t1, t2, t3, t4) {
  const r3 = r21P25R3Decide(t1, t2, t3);
  const fail = [...r3.fail];
  const res = { fail, r3, diff43: [] };
  if (typeof t3 !== "string") return res; // r3 不存在：r21P25R3Decide 已記 fail
  if (typeof t4 !== "string") {
    fail.push(`${R21_P25_R4} 不存在`);
    return res;
  }
  const parse = (name, text) => {
    const m = new Map();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (!x) fail.push(`${name} 有格式不符的列（必須「sha1＋兩空白＋相對路徑」）：${JSON.stringify(line.slice(0, 80))}`);
      else if (m.has(x[2])) fail.push(`${name} 重複列：${x[2]}`);
      else m.set(x[2], x[1]);
    }
    return m;
  };
  const c = new Map();
  for (const line of t3.split("\n")) {
    const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
    if (x) c.set(x[2], x[1]);
  }
  const d = parse(R21_P25_R4, t4);
  const keys = (m) => JSON.stringify([...m.keys()].sort());
  if (d.size !== 18 || keys(d) !== keys(c)) fail.push(`${R21_P25_R4} 檔案清單必須與 ${R21_P25_R3} 相同（18 檔；實際 ${d.size}）`);
  res.diff43 = [...new Set([...c.keys(), ...d.keys()])].filter((rel) => c.get(rel) !== d.get(rel)).sort();
  const bad43 = res.diff43.filter((rel) => !R21_P25_R4_DIFF_OK.includes(rel));
  if (bad43.length) fail.push(`${R21_P25_R4} 相對 ${R21_P25_R3} 的差異檔只能是 ${R21_P25_R4_DIFF_OK.join("／")}（多出：${bad43.join(",")}）`);
  return res;
}
/** r21-Z0 --probe 變體自檢（記憶體內；以實際 r1～r4 內容為基底變造；不寫檔）。 */
function r21P25R4SelfTest() {
  const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
  const t1 = rd(R21_P25_R1);
  const t2 = rd(R21_P25_R2);
  const t3 = rd(R21_P25_R3);
  const t4 = rd(R21_P25_R4);
  if ([t1, t2, t3, t4].some((t) => typeof t !== "string")) return { rows: [{ label: "基底快照不全（r1／r2／r3／r4 任一不存在）", want: true, got: false, pass: false }], pass: 0, n: 1 };
  const L3 = t3.split("\n").filter((l) => l.trim());
  const L4 = t4.split("\n").filter((l) => l.trim());
  const swapSha = (line) => `${line[0] === "0" ? "1" : "0"}${line.slice(1)}`;
  const join = (ls) => `${ls.join("\n")}\n`;
  const at4 = (rel) => L4.findIndex((l) => l.endsWith(`  ${rel}`));
  const at3 = (rel) => L3.findIndex((l) => l.endsWith(`  ${rel}`));
  const iRt = at4("src/lib/i18n/chat-runtime.ts");
  const iApp = at4("src/routes/_app.chat.tsx");
  const iDtp = at4(R21_DTP_REL);
  const iRt3 = at3("src/lib/i18n/chat-runtime.ts");
  const cases = [
    ["實際 r1／r2／r3／r4（現行快照）", t1, t2, t3, t4, true],
    ["r4 少一列（17 檔）", t1, t2, t3, join(L4.slice(1)), false],
    ["r4 多一列（19 檔）", t1, t2, t3, join([...L4, `${"c".repeat(40)}  src/lib/ai/extra-file.ts`]), false],
    ["r4 重複一列", t1, t2, t3, join([...L4, L4[0]]), false],
    ["r4 某列只有一個空白（格式不符）", t1, t2, t3, join(L4.map((l, k) => (k === 0 ? l.replace("  ", " ") : l))), false],
    ["r4 非允許檔 sha 不同（chat-runtime.ts）", t1, t2, t3, join(L4.map((l, k) => (k === iRt ? swapSha(l) : l))), false],
    ["r4 _app.chat.tsx sha 不同於 r3（_app 不在 r4 允許清單）", t1, t2, t3, join(L4.map((l, k) => (k === iApp ? swapSha(l) : l))), false],
    ["r4 destination-travel-profile.ts sha 不同於 r3（dtp 不在 r4 允許清單）", t1, t2, t3, join(L4.map((l, k) => (k === iDtp ? swapSha(l) : l))), false],
    ["r4 不存在", t1, t2, t3, null, false],
    ["r3 不存在", t1, t2, null, t4, false],
    ["r3 未通過 X0 前提（r3 chat-runtime.ts sha 不同於 r2）", t1, t2, join(L3.map((l, k) => (k === iRt3 ? swapSha(l) : l))), t4, false],
    ["r2 不存在（X0 前提不成立）", t1, null, t3, t4, false],
  ];
  const rows = [];
  for (const [label, a, b, c, d, want] of cases) {
    const got = r21P25R4Decide(a, b, c, d).fail.length === 0;
    rows.push({ label, want, got, pass: got === want && iRt >= 0 && iApp >= 0 && iDtp >= 0 && iRt3 >= 0 });
  }
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
/**
 * r21-Y0（A2-MP-T31）：採用 post-MP25-E2-r5 快照的前提（純判定；t1～t5＝post-MP25／r2／E2-r3／E2-r4／E2-r5 內容，null＝不存在）。
 * 先原樣呼叫 r21P25R4Decide(t1, t2, t3, t4)（r4 必須存在且通過既有 Z0 前提〔含 X0〕；其 fail 全數保留），再檢查 r5：每個非空行「sha1＋兩空白＋相對路徑」、不重複、
 * 18 檔且清單＝r4、r5 相對 r4 的差異檔 ⊆ R21_P25_R5_DIFF_OK（_app.chat.tsx）。不符 → fail（主程序 INFRA-FAIL，不退回）。性質：版本識別。
 */
function r21P25R5Decide(t1, t2, t3, t4, t5) {
  const r4 = r21P25R4Decide(t1, t2, t3, t4);
  const fail = [...r4.fail];
  const res = { fail, r4, diff54: [] };
  if (typeof t4 !== "string") {
    if (!fail.some((x) => x.startsWith(`${R21_P25_R4} 不存在`))) fail.push(`${R21_P25_R4} 不存在（${R21_P25_R5} 需要與其比對）`);
    return res;
  }
  if (typeof t5 !== "string") {
    fail.push(`${R21_P25_R5} 不存在`);
    return res;
  }
  const d = new Map();
  for (const line of t4.split("\n")) {
    const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
    if (x) d.set(x[2], x[1]);
  }
  const e = new Map();
  for (const line of t5.split("\n")) {
    if (!line.trim()) continue;
    const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
    if (!x) fail.push(`${R21_P25_R5} 有格式不符的列（必須「sha1＋兩空白＋相對路徑」）：${JSON.stringify(line.slice(0, 80))}`);
    else if (e.has(x[2])) fail.push(`${R21_P25_R5} 重複列：${x[2]}`);
    else e.set(x[2], x[1]);
  }
  const keys = (m) => JSON.stringify([...m.keys()].sort());
  if (e.size !== 18 || keys(e) !== keys(d)) fail.push(`${R21_P25_R5} 檔案清單必須與 ${R21_P25_R4} 相同（18 檔；實際 ${e.size}）`);
  res.diff54 = [...new Set([...d.keys(), ...e.keys()])].filter((rel) => d.get(rel) !== e.get(rel)).sort();
  const bad54 = res.diff54.filter((rel) => !R21_P25_R5_DIFF_OK.includes(rel));
  if (bad54.length) fail.push(`${R21_P25_R5} 相對 ${R21_P25_R4} 的差異檔只能是 ${R21_P25_R5_DIFF_OK.join("／")}（多出：${bad54.join(",")}）`);
  return res;
}
/** r21-Y0 --probe 變體自檢（記憶體內；以實際 r1～r5 內容為基底變造；不寫檔）＋快照選擇 r21P25Pick 自檢。 */
function r21P25R5SelfTest() {
  const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
  const t1 = rd(R21_P25_R1);
  const t2 = rd(R21_P25_R2);
  const t3 = rd(R21_P25_R3);
  const t4 = rd(R21_P25_R4);
  const t5 = rd(R21_P25_R5);
  const rows = [];
  const all = [R21_P25_R1, R21_P25_R2, R21_P25_R3, R21_P25_R4, R21_P25_R5];
  const pick = (have) => r21P25Pick((n) => have.includes(n));
  for (const [label, have, want] of [
    ["選擇：r1～r5 皆存在 → r5", all, R21_P25_R5],
    ["選擇：r5 不存在（r1～r4）→ r4（原行為）", all.slice(0, 4), R21_P25_R4],
    ["選擇：只有 r1～r3 → r3（原行為）", all.slice(0, 3), R21_P25_R3],
    ["選擇：只有 r1～r2 → r2（原行為）", all.slice(0, 2), R21_P25_R2],
    ["選擇：全部不存在 → r1（原行為）", [], R21_P25_R1],
    ["選擇：r5＋r1（r2～r4 不存在）→ r5（採用後由前提判 INFRA-FAIL，不退回）", [R21_P25_R1, R21_P25_R5], R21_P25_R5],
  ]) {
    const got = pick(have);
    rows.push({ label, want, got, pass: got === want, kind: "pick" });
  }
  if ([t1, t2, t3, t4, t5].some((t) => typeof t !== "string")) {
    rows.push({ label: "基底快照不全（r1／r2／r3／r4／r5 任一不存在）", want: true, got: false, pass: false });
    return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
  }
  const L4 = t4.split("\n").filter((l) => l.trim());
  const L5 = t5.split("\n").filter((l) => l.trim());
  const swapSha = (line) => `${line[0] === "0" ? "1" : "0"}${line.slice(1)}`;
  const join = (ls) => `${ls.join("\n")}\n`;
  const at5 = (rel) => L5.findIndex((l) => l.endsWith(`  ${rel}`));
  const at4 = (rel) => L4.findIndex((l) => l.endsWith(`  ${rel}`));
  const iRt = at5("src/lib/i18n/chat-runtime.ts");
  const iCtd = at5(R21_CTD_REL);
  const iDtp = at5(R21_DTP_REL);
  const iApp4 = at4("src/routes/_app.chat.tsx");
  const cases = [
    ["實際 r1／r2／r3／r4／r5（現行快照）", t1, t2, t3, t4, t5, true],
    ["r5 少一列（17 檔）", t1, t2, t3, t4, join(L5.slice(1)), false],
    ["r5 多一列（19 檔）", t1, t2, t3, t4, join([...L5, `${"c".repeat(40)}  src/lib/ai/extra-file.ts`]), false],
    ["r5 重複一列", t1, t2, t3, t4, join([...L5, L5[0]]), false],
    ["r5 某列只有一個空白（格式不符）", t1, t2, t3, t4, join(L5.map((l, k) => (k === 0 ? l.replace("  ", " ") : l))), false],
    ["r5 非允許檔 sha 不同（chat-runtime.ts）", t1, t2, t3, t4, join(L5.map((l, k) => (k === iRt ? swapSha(l) : l))), false],
    ["r5 chat-turn-destination.ts sha 不同於 r4（ctd 不在 r5 允許清單）", t1, t2, t3, t4, join(L5.map((l, k) => (k === iCtd ? swapSha(l) : l))), false],
    ["r5 destination-travel-profile.ts sha 不同於 r4（dtp 不在 r5 允許清單）", t1, t2, t3, t4, join(L5.map((l, k) => (k === iDtp ? swapSha(l) : l))), false],
    ["r5 不存在", t1, t2, t3, t4, null, false],
    ["r4 不存在", t1, t2, t3, null, t5, false],
    ["r4 未通過 Z0 前提（r4 _app.chat.tsx sha 不同於 r3）", t1, t2, t3, join(L4.map((l, k) => (k === iApp4 ? swapSha(l) : l))), t5, false],
    ["r3 不存在（Z0 前提不成立）", t1, t2, null, t4, t5, false],
    ["r2 不存在（X0 前提不成立）", t1, null, t3, t4, t5, false],
  ];
  for (const [label, a, b, c, d, e, want] of cases) {
    const got = r21P25R5Decide(a, b, c, d, e).fail.length === 0;
    rows.push({ label, want, got, pass: got === want && iRt >= 0 && iCtd >= 0 && iDtp >= 0 && iApp4 >= 0 });
  }
  return { rows, pass: rows.filter((r) => r.pass).length, n: rows.length };
}
/** r21-W0（A2-MP-T15）：採用 post-MP25-r2 快照的前提（只讀）：與 post-MP25 同 18 檔清單、差異只在 R21_P25_R2_DIFF_OK 三檔；不符 → INFRA-FAIL（不退回 post-MP25）。 */
function r21P25Check() {
  const snapOf = (file) => {
    const m = new Map();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const x = line.match(/^([0-9a-f]{40}) {2}(.+)$/);
      if (x) m.set(x[2], x[1]);
    }
    return m;
  };
  const res = { file: R21_P25, fail: [], diff: [], ctd: null, r3: null };
  if (R21_P25 !== R21_P25_R2 && R21_P25 !== R21_P25_R3 && R21_P25 !== R21_P25_R4 && R21_P25 !== R21_P25_R5) return res; // r21#Y0：r5 時同樣先跑 r2 前提（原：!== R2 && !== R3 && !== R4 → return）；r21#Z0：r4 時同樣先跑 r2 前提（原：!== R2 && !== R3 → return）；r21#X0：r3 時同樣先跑 r2 前提（原：!== R2 → return）
  if (!existsSync(`${PRE_DIR}/${R21_P25_R1}`)) {
    res.fail.push(`${R21_P25_R1} 不存在（無法比對 post-MP25-r2 差異）`);
    return res;
  }
  if (R21_P25 === R21_P25_R5) {
    // r21#Y0（A2-MP-T31）：r5 前提（r4 必須存在且通過 Z0〔r21P25R4Decide 原樣，含 X0〕；r5 與 r4 同 18 檔清單；r5 相對 r4 只允許 R21_P25_R5_DIFF_OK）；不符 → INFRA-FAIL（不退回）
    const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
    res.r5 = r21P25R5Decide(rd(R21_P25_R1), rd(R21_P25_R2), rd(R21_P25_R3), rd(R21_P25_R4), rd(R21_P25_R5));
    res.r4 = res.r5.r4;
    res.r3 = res.r4.r3;
    res.fail.push(...res.r5.fail);
    if (!existsSync(`${PRE_DIR}/${R21_P25_R2}`)) return res;
    const sha1Rel = (rel) => (existsSync(`${WORK_ROOT}/${rel}`) ? createHash("sha1").update(readFileSync(`${WORK_ROOT}/${rel}`)).digest("hex") : "(missing)");
    const row5 = (rel) => (rd(R21_P25_R5) ?? "").split("\n").find((l) => l.endsWith(`  ${rel}`))?.slice(0, 40) ?? null;
    res.ctd4 = { now: sha1Rel(R21_CTD_REL), want: row5(R21_CTD_REL) }; // 只供輸出（r5 ctd 列＝r4，Y0 保證）
    res.app5 = { now: sha1Rel("src/routes/_app.chat.tsx"), want: row5("src/routes/_app.chat.tsx") }; // 只供輸出
  }
  if (R21_P25 === R21_P25_R4) {
    // r21#Z0（A2-MP-T27）：r4 前提（r3 必須存在且通過 X0〔r21P25R3Decide 原樣〕；r4 與 r3 同 18 檔清單；r4 相對 r3 只允許 R21_P25_R4_DIFF_OK）；不符 → INFRA-FAIL（不退回）
    const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
    res.r4 = r21P25R4Decide(rd(R21_P25_R1), rd(R21_P25_R2), rd(R21_P25_R3), rd(R21_P25_R4));
    res.r3 = res.r4.r3;
    res.fail.push(...res.r4.fail);
    if (!existsSync(`${PRE_DIR}/${R21_P25_R2}`)) return res;
    const ctdNow4 = existsSync(`${WORK_ROOT}/${R21_CTD_REL}`) ? createHash("sha1").update(readFileSync(`${WORK_ROOT}/${R21_CTD_REL}`)).digest("hex") : "(missing)";
    res.ctd4 = { now: ctdNow4, want: (rd(R21_P25_R4) ?? "").split("\n").find((l) => l.endsWith(`  ${R21_CTD_REL}`))?.slice(0, 40) ?? null }; // 只供輸出
  }
  if (R21_P25 === R21_P25_R3) {
    // r21#X0（A2-MP-T24）：r3 前提（r2 必須存在；r3 與 r2／r1 同 18 檔清單；r3 相對 r2 只允許 R21_P25_R3_DIFF_OK；相對 r1 只允許 R21_P25_R3_VS_R1_OK）；不符 → INFRA-FAIL（不退回）
    const rd = (n) => (existsSync(`${PRE_DIR}/${n}`) ? readFileSync(`${PRE_DIR}/${n}`, "utf8") : null);
    res.r3 = r21P25R3Decide(rd(R21_P25_R1), rd(R21_P25_R2), rd(R21_P25_R3));
    res.fail.push(...res.r3.fail);
    if (!existsSync(`${PRE_DIR}/${R21_P25_R2}`)) return res;
  }
  const a = snapOf(`${PRE_DIR}/${R21_P25_R1}`);
  const b = snapOf(`${PRE_DIR}/${R21_P25_R2}`); // r21#X0：原 snapOf(R21_P25_FILE)；R21_P25＝r2 時相同，r3 時仍對 r2 跑原 W0 前提
  if (b.size !== 18 || JSON.stringify([...a.keys()].sort()) !== JSON.stringify([...b.keys()].sort())) res.fail.push(`${R21_P25_R2} 檔案清單必須與 ${R21_P25_R1} 相同（18 檔；實際 ${b.size}）`);
  res.diff = [...new Set([...a.keys(), ...b.keys()])].filter((rel) => a.get(rel) !== b.get(rel)).sort();
  const bad = res.diff.filter((rel) => !R21_P25_R2_DIFF_OK.includes(rel));
  if (bad.length) res.fail.push(`${R21_P25_R2} 相對 ${R21_P25_R1} 的差異檔只能是 ${R21_P25_R2_DIFF_OK.join("／")}（多出：${bad.join(",")}）`);
  const ctdNow = existsSync(`${WORK_ROOT}/${R21_CTD_REL}`) ? createHash("sha1").update(readFileSync(`${WORK_ROOT}/${R21_CTD_REL}`)).digest("hex") : "(missing)";
  res.ctd = { now: ctdNow, want: b.get(R21_CTD_REL) ?? null, r1: a.get(R21_CTD_REL) ?? null };
  return res;
}
const R21_P25_CHECK = IS_CHILD ? null : r21P25Check();
if (R21_P25_CHECK?.fail.length) {
  console.log(["INFRA-FAIL r21-W0 post-MP25-r2 快照前提不符（不退回 post-MP25）", ...R21_P25_CHECK.fail].join("\n"));
  process.exit(1);
}
const r21P25Lines = () => {
  const c = R21_P25_CHECK;
  if (!c) return ["r21-W：子程序（主程序已檢查）"];
  if (c.file !== R21_P25_R2 && c.file !== R21_P25_R3 && c.file !== R21_P25_R4 && c.file !== R21_P25_R5) return [`r21-W（A2-MP-T15）施工後快照：${c.file}（${R21_P25_R2} 不存在 → 原行為）`]; // r21#Y0：原條件另加 && !== R5 // r21#Z0：原條件另加 && !== R4
  const y0 = c.r5 ? [`r21-Y0（A2-MP-T31）施工後快照：${R21_P25_R5}（存在時優先；${R21_P25_R4}／${R21_P25_R3}／${R21_P25_R2}／${R21_P25_R1} 只讀、未改寫）；相對 ${R21_P25_R4} 差異檔=${c.r5.diff54.join(",") || "-"}（允許 ${R21_P25_R5_DIFF_OK.length} 檔）；${R21_P25_R4} 照 Z0 前提檢查（下行）`, `  Y2 chat-turn-destination.ts 放行條件（r19Snap 差異檔；快照＝${R21_P25_R5}）：work sha1=${c.ctd4?.now} ${c.ctd4 && c.ctd4.now === c.ctd4.want ? "＝" : "≠"} ${R21_P25_R5} ${c.ctd4?.want}→ ${c.ctd4 && c.ctd4.now === c.ctd4.want ? "允許（版本識別）" : "不允許（照舊 INFRA-FAIL）"}`, `  _app.chat.tsx（W2 r16 precheck／r14 wantApp.work／r21-G 啟用條件，讀 ${R21_P25_R5}）：work sha1=${c.app5?.now} ${c.app5 && c.app5.now === c.app5.want ? "＝" : "≠"} ${R21_P25_R5} ${c.app5?.want}`] : []; // r21#Y0：只新增輸出
  const z0 = c.r4 ? [`r21-Z0（A2-MP-T27）施工後快照：${R21_P25_R4}（${c.r5 ? `${R21_P25_R5} 的前提；` : ""}存在時優先；${R21_P25_R3}／${R21_P25_R2}／${R21_P25_R1} 只讀、未改寫）；相對 ${R21_P25_R3} 差異檔=${c.r4.diff43.join(",") || "-"}（允許 ${R21_P25_R4_DIFF_OK.length} 檔）；${R21_P25_R3} 照 X0 前提檢查（下行）`, ...(c.r5 ? [] : [`  Z2 chat-turn-destination.ts 放行條件（r19Snap 差異檔；快照＝${R21_P25_R4}）：work sha1=${c.ctd4?.now} ${c.ctd4 && c.ctd4.now === c.ctd4.want ? "＝" : "≠"} ${R21_P25_R4} ${c.ctd4?.want}→ ${c.ctd4 && c.ctd4.now === c.ctd4.want ? "允許（版本識別）" : "不允許（照舊 INFRA-FAIL）"}（下方 W3 行仍對 ${R21_P25_R2} 顯示原比對，僅供對照）`])] : []; // r21#Z0：只新增輸出 // r21#Y0：快照＝r5 時 Z2 行改由上方 Y2 行顯示（只影響輸出）
  const x0 = c.r3 ? [`r21-X0（A2-MP-T24）施工後快照：${R21_P25_R3}（存在時優先；${R21_P25_R2}／${R21_P25_R1} 只讀、未改寫）；相對 ${R21_P25_R2} 差異檔=${c.r3.diff32.join(",") || "-"}（允許 ${R21_P25_R3_DIFF_OK.length} 檔）；相對 ${R21_P25_R1} 差異檔=${c.r3.diff31.join(",") || "-"}（允許 ${R21_P25_R3_VS_R1_OK.length} 檔）；以下 W0／W3 對 ${R21_P25_R2} 照原檢查`] : []; // r21#X0：只新增輸出
  return [
    ...y0,
    ...z0,
    ...x0,
    `r21-W（A2-MP-T15）施工後快照：${c.file}（存在時優先；${R21_P25_R1} 只讀、未改寫）；相對 ${R21_P25_R1} 差異檔=${c.diff.join(",") || "-"}（允許 ${R21_P25_R2_DIFF_OK.length} 檔）`,
    `  W3 chat-turn-destination.ts 放行條件：work sha1=${c.ctd.now} ${c.ctd.now === c.ctd.want ? "＝" : "≠"} ${R21_P25_R2} ${c.ctd.want}（${R21_P25_R1}=${c.ctd.r1}）→ ${c.ctd.now === c.ctd.want ? "允許（版本識別）" : "不允許（照舊 INFRA-FAIL）"}`,
  ];
};
if (R21_CANON.vocabFail) {
  console.log(`INFRA-FAIL r21-D：${R21_CANON.vocabFail}（找不到既有 canonical 機制；不自創地名規則）`);
  process.exit(1);
}
const shebang = r20Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r20 缺少 shebang");
  process.exit(1);
}
const r20Src = r20Text.slice(shebang[0].length);
let r21Body;
try {
  r21Body = r21Apply(r20Src, R21_R20_PATCHES, "r20");
} catch (e) {
  console.log(`INFRA-FAIL r21 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r21Body) || /^\s*imp: \(s\) => import\(s\)/m.test(r21Body)) {
  console.log("INFRA-FAIL r21：patched r20 仍有 import 陳述式／import()");
  process.exit(1);
}

let limits = null;
if (!IS_CHILD) {
  // canonical：主程序以 vite-node 載入正式模組（子程序經 r13 M 物件載入）
  try {
    const { mod, ext } = await r21LoadAlias();
    if (ext) throw new Error(`載入期間外部請求 ${ext} 次`);
    if (typeof mod?.resolveDestinationAlias !== "function") throw new Error("模組沒有 resolveDestinationAlias");
    globalThis.__R21_ALIAS = mod;
  } catch (e) {
    console.log(`INFRA-FAIL r21-D 無法載入既有 canonical identity（${ALIAS_REL}）：${e?.message ?? e}（標 UNVERIFIED；不自創地名規則）`);
    process.exit(1);
  }
  let fnsOrig;
  let fnsR21;
  let r19v;
  let alt;
  try {
    fnsOrig = r21FnsFromR20Text(r20Src, null);
    fnsR21 = r21FnsFromR20Text(r21Body, r21CanonKey);
    const lm = fnsR21.r20Limits();
    if (lm.fail.length) throw new Error(`找不到可復用的既有長度限制：${lm.fail.join("；")}`);
    limits = lm;
    r19v = r21R19Variants(r19Text, r20Src, fnsR21, { userText: lm.userText, label: lm.label });
    alt = fnsR21.r20AltOfferFromSource();
  } catch (e) {
    console.log(`INFRA-FAIL r21 探針無法建立：${e?.message ?? e}`);
    process.exit(1);
  }
  R21_STATE.limits = limits;
  const probe = r21Probe({ fnsOrig, fnsR21, r19: r19v, limits: { userText: limits.userText, label: limits.label }, alt });
  R21_STATE.probe = probe;
  globalThis.__R21_PROBE = { pass: probe.pass, n: probe.n, groups: probe.groups, relax: probe.relax, rows: probe.rows.map((r) => ({ group: r.group, label: r.label, want: r.want, got: r.got, pass: r.pass })) }; // mp25-r4 S5 讀取
  globalThis.__R21_CANON_INFO = { src: R21_CANON.src, canonKey: r21CanonKey, mentions: r21Mentions, idKey: r21IdKey }; // mp25-r4 report 讀取（同一主程序）
  if (!process.argv.includes("--probe") && probe.pass !== probe.n) {
    console.log(["INFRA-FAIL r21 單元探針不符", ...r21ProbeLines(probe).filter((l) => /\[NG\]/.test(l))].join("\n"));
    process.exit(1);
  }
  // r21-G（A2-MP-T14）：啟用判定＋AST 契約＋偵測器自檢（主程序先跑；啟用且自檢不符 → 偵測器失效 → INFRA-FAIL；契約本身不成立交由 r13 source anchors 照舊 INFRA-FAIL）
  const mc = await r21MoreContract(readFileSync(`${WORK_ROOT}/${R21_G_REL}`, "utf8")); // 與 r13 appWork 相同讀法（utf8 字串）
  if (!process.argv.includes("--probe") && mc.active && mc.self && mc.self.pass !== mc.self.n) {
    console.log(["INFRA-FAIL r21-G 偵測器變異自檢不符（偵測器失效）", ...r21MoreContractLines(mc).filter((l) => /\[NG\]/.test(l))].join("\n"));
    process.exit(1);
  }
}

const AsyncFunction = (async () => {}).constructor;
const makeR21 = (extra) => ({
  imp: (s) => import(s),
  r13Patches: R21_R13_PATCHES,
  r14Patches: R21_R14_PATCHES,
  r20Flags: false,
  canonKey: r21CanonKey,
  pendingExtra: r21PendingExtra,
  turnEnd: r21TurnEnd,
  recordWrite: r21RecordWrite,
  markEvaluated: r21MarkEvaluated,
  report: r21Report,
  summaryFields: r21SummaryFields,
  state: R21_STATE,
  moreContract: r21MoreContract, // r21-G（A2-MP-T14）：r13 G1 patch 呼叫（主程序）
  gA2Anchor: R21_G_A2_ANCHOR, // r21-G：r13 G2 patch 比對（＝ r14 R14_A2_WORK_ANCHORS[2]）
  e2F7: r21E2F7, // r21-F2（A2-MP-T18）：r13 F7 patch 呼叫（主程序；版本識別）
  x4F7: r21X4F7, // r21-X4（A2-MP-T24）：r13 F7 patch 呼叫（主程序；版本識別）
  z5F7: r21Z5F7, // r21-Z5（A2-MP-T27）：r13 F7 patch 呼叫（主程序；版本識別）
  y5F7: r21Y5F7, // r21-Y5（A2-MP-T31）：r13 F7 patch 呼叫（主程序；版本識別）
  t47F7: r21T47F7, // r21-T47（A2-MP-T47）：r13 F7 patch 呼叫（主程序；版本識別，精確路徑＋精確 sha256）
  a2srcF7: r21A2SrcF7, // r21-A2SRC（任務單 #104）：r13 F7 patch 呼叫（主程序；版本識別，精確路徑＋精確 sha256）
  z6CbAnchor: r21Z6CbAnchor, // r21-Z6（A2-MP-T27）：r13 L2396 patch 呼叫（主程序；版本識別）
  z6Orig: R21_Z6_ORIG, // r21-Z6b：原 anchor（pre-CB 反向檢查用）
  clockTurn: r21ClockTurn, // r21-C（A2-MP-T18）：r13 turn loop patch 呼叫（子程序；只在 SCENARIO.r21ClockByTurn 時）
  r20Extra: null,
  onR20Body: null,
  ...extra,
});

if (!IS_CHILD && process.argv.includes("--probe")) {
  const out = argOut() ?? `${PRE_DIR}/r21-probe.log`;
  const why = r21RefuseOut(out);
  if (why) {
    console.log(why);
    process.exit(1);
  }
  const lines = [];
  const lm = R21_STATE.limits;
  lines.push(`r21 --probe（A2-MP-T9）`);
  lines.push(`r21 長度上限：使用者原句 ≤${lm.userText}〔${lm.src.userText}〕；地名 ≤${lm.label}〔${lm.src.label}〕`);
  lines.push(`★ 測試契約放寬揭露：originalUserText 上限 原版 r19＝500（自創）→ r20#L1／r21＝${lm.userText}（既有 chatInput 上限）。下表「原版r19」欄以原版 r19 原文（未套用 ${lm.userText}）判定。`);
  lines.push(`r21-D canonical identity：${R21_CANON.src}；別名詞彙 ${R21_CANON.vocab.length} 個`);
  lines.push(...r21ProbeLines(R21_STATE.probe));
  lines.push(`r21 r20 原文層 patch：${R21_R20_PATCHES.length} 個錨點皆恰好 1 次 → OK`);
  const d = r21LayerDryRun();
  lines.push(`r21 r13／r14 層錨點乾跑（對照 r20 --emit-diff 產物）：${d.map((x) => `${x.id}@${x.file}=${x.n}`).join("；")} → ${d.every((x) => x.n === 1) ? "OK" : "NG"}`);
  const sN = r19Text.split(R21_S_R19_OLD).length - 1; // r21-S（A2-MP-T11）：r19 原文層錨點乾跑（實際套用由 patched r20 的 r20Apply 再驗一次）
  const sIns = r21Body.split(R21_S_R19_NEU).length - 1;
  lines.push(`r21-S r19 原文層錨點乾跑（R19_SNAP_EXTRA_OK＋continue-recommendation-intent.ts）：r19 錨點=${sN}、patched r20 內插入=${sIns} → ${sN === 1 && sIns === 1 ? "OK" : "NG"}`);
  // r21-W（A2-MP-T15）：r19 原文層錨點乾跑＋patched r20 內插入次數（實際套用由 patched r20 的 r20Apply 再驗一次）
  const wD = R21_W_R19.map((p) => ({ id: p.id, n: r19Text.split(p.old).length - 1, ins: r21Body.split(JSON.stringify(p.neu)).length - 1 }));
  const wOk = wD.every((x) => x.n === 1 && x.ins === 1);
  lines.push(...r21P25Lines());
  lines.push(`r21-W r19 原文層錨點乾跑：${wD.map((x) => `${x.id}：r19 錨點=${x.n}、patched r20 內插入=${x.ins}`).join("；")} → ${wOk ? "OK" : "NG"}`);
  const mc = R21_STATE.mc; // r21-G（A2-MP-T14）：不進情境；只對 work 原始碼跑 AST 契約與變異自檢
  lines.push(...r21MoreContractLines(mc));
  const gOk = Boolean(mc) && (!mc.active || (mc.ok === true && mc.self?.pass === mc.self?.n));
  lines.push(`r21-G --probe：${!mc ? "未執行" : mc.active ? (gOk ? "OK" : "NG") : "未啟用（原檢查）"}`);
  // r21-F2（A2-MP-T18）：E2 版本識別判定自檢（記憶體內變體）＋目前狀態（只讀）
  const e2Self = r21E2SelfTest();
  lines.push(`r21-F2（A2-MP-T18）F7 ${R21_E2_REL} 版本識別判定自檢 ${e2Self.pass}/${e2Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of e2Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-F2 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  const e2Now = r21E2F7();
  lines.push(`  r21-F2 目前狀態：${e2Now.reason}（快照=${e2Now.want ?? "-"} 目前=${e2Now.now ?? "-"}）`);
  // r21-C（A2-MP-T18）：離線可控時間乾跑／自檢（主程序記憶體內；不實際等待、不執行情境）
  const clk = r21ClockSelfTest();
  lines.push(`r21-C（A2-MP-T18）每輪時間偏移 r21ClockByTurn 乾跑／自檢 ${clk.pass}/${clk.n}（性質：測試基礎設施，不涉及行為斷言）`);
  for (const r of clk.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-C 自檢] ${r.label}${r.note ? `（${r.note}）` : ""}`);
  // r21-X（A2-MP-T24）：E2 施工後版本識別。X0 前提變體自檢；X2／X3 r19 原文層「依序套用 S／W1～W3／X」乾跑＋patched r20 內插入次數；X4 判定變體自檢＋目前狀態（只讀）
  const x0Self = r21P25R3SelfTest();
  lines.push(`r21-X0（A2-MP-T24）post-MP25-E2-r3 快照前提變體自檢 ${x0Self.pass}/${x0Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of x0Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-X0 自檢] ${r.label}｜期望=${r.want ? "採用" : "INFRA-FAIL"} 實際=${r.got ? "採用" : "INFRA-FAIL"}`);
  let xSeq = r19Text;
  const xD = [];
  for (const p of [{ id: "r21-S", old: R21_S_R19_OLD, neu: R21_S_R19_NEU }, ...R21_W_R19, ...R21_X_R19]) {
    const n = xSeq.split(p.old).length - 1;
    if (n === 1) xSeq = xSeq.replace(p.old, () => p.neu);
    if (R21_X_R19.includes(p)) xD.push({ id: p.id, n, ins: r21Body.split(JSON.stringify(p.neu)).length - 1 });
  }
  const xOk = xD.every((x) => x.n === 1 && x.ins === 1) && xSeq.split("function r21X3Ok(").length - 1 === 1;
  lines.push(`r21-X r19 原文層錨點乾跑（依序套用 r21-S／W1～W3 後）：${xD.map((x) => `${x.id}：錨點=${x.n}、patched r20 內插入=${x.ins}`).join("；")} → ${xOk ? "OK" : "NG"}`);
  const x4Self = r21X4SelfTest();
  lines.push(`r21-X4（A2-MP-T24）F7 ${R21_DTP_REL} 版本識別判定自檢 ${x4Self.pass}/${x4Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of x4Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-X4 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  const x4Now = r21X4F7();
  lines.push(`  r21-X4 目前狀態：${x4Now.reason}（快照=${x4Now.want ?? "-"} 目前=${x4Now.now ?? "-"}）`);
  // r21-Z（A2-MP-T27）：E2c 施工後版本識別。Z0 前提變體自檢；Z2／Z3 r19 原文層「依序套用 S／W1～W3／X／Z」乾跑＋patched r20 內插入次數；Z4／Z5 判定變體自檢＋目前狀態（只讀）
  const z0Self = r21P25R4SelfTest();
  lines.push(`r21-Z0（A2-MP-T27）post-MP25-E2-r4 快照前提變體自檢 ${z0Self.pass}/${z0Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of z0Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Z0 自檢] ${r.label}｜期望=${r.want ? "採用" : "INFRA-FAIL"} 實際=${r.got ? "採用" : "INFRA-FAIL"}`);
  let zSeq = r19Text;
  const zD = [];
  for (const p of [{ id: "r21-S", old: R21_S_R19_OLD, neu: R21_S_R19_NEU }, ...R21_W_R19, ...R21_X_R19, ...R21_Z_R19]) {
    const n = zSeq.split(p.old).length - 1;
    if (n === 1) zSeq = zSeq.replace(p.old, () => p.neu);
    if (R21_Z_R19.includes(p)) zD.push({ id: p.id, n, ins: r21Body.split(JSON.stringify(p.neu)).length - 1 });
  }
  const zMarks = [zSeq.split("/* r21#Z2（A2-MP-T27）").length - 1, zSeq.split("/* r21#Z3（A2-MP-T27）").length - 1];
  const zOkD = zD.every((x) => x.n === 1 && x.ins === 1) && zMarks.every((n) => n === 1) && zSeq.split("function r21X3Ok(").length - 1 === 1;
  lines.push(`r21-Z r19 原文層錨點乾跑（依序套用 r21-S／W1～W3／X 後）：${zD.map((x) => `${x.id}：錨點=${x.n}、patched r20 內插入=${x.ins}`).join("；")}；套用後 Z2／Z3 標記=${zMarks.join("／")} → ${zOkD ? "OK" : "NG"}`);
  const z4Self = r21Z4SelfTest();
  lines.push(`r21-Z4（A2-MP-T27）F7 ${R21_DTP_REL}（快照＝${R21_P25_R4}）版本識別判定自檢 ${z4Self.pass}/${z4Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of z4Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Z4 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  const z5Self = r21Z5SelfTest();
  lines.push(`r21-Z5（A2-MP-T27）F7 ${R21_TC_REL} 版本識別判定自檢 ${z5Self.pass}/${z5Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of z5Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Z5 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  const z5Now = r21Z5F7();
  lines.push(`  r21-Z5 目前狀態：${z5Now.reason}（快照=${z5Now.want ?? "-"} 目前=${z5Now.now ?? "-"}）`);
  const z6Self = r21Z6SelfTest(r21Apply);
  lines.push(`r21-Z6（A2-MP-T27）r13 L2396 CB_CTD_ANCHORS[0] 版本識別判定自檢 ${z6Self.pass}/${z6Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of z6Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Z6 自檢] ${r.label}｜期望=${r.want} 實際=${r.got}`);
  lines.push(`  r21-Z6 目前狀態：${z6Self.cur.reason}（快照=${z6Self.cur.want ?? "-"} 目前=${z6Self.cur.now ?? "-"}）`);
  const zOk = z0Self.pass === z0Self.n && zOkD && z4Self.pass === z4Self.n && z5Self.pass === z5Self.n && z6Self.pass === z6Self.n;
  // r21-Y（A2-MP-T31）：E2d／E2e／E2f 施工後版本識別。Y0 前提＋快照選擇變體自檢；Y2／Y3 r19 原文層「依序套用 S／W1～W3／X／Z／Y」乾跑＋patched r20 內插入次數；Y4／Y5／Y6 判定變體自檢＋目前狀態（只讀）
  const y0Self = r21P25R5SelfTest();
  lines.push(`r21-Y0（A2-MP-T31）post-MP25-E2-r5 快照前提＋快照選擇變體自檢 ${y0Self.pass}/${y0Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of y0Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Y0 自檢] ${r.label}｜期望=${r.kind === "pick" ? r.want : r.want ? "採用" : "INFRA-FAIL"} 實際=${r.kind === "pick" ? r.got : r.got ? "採用" : "INFRA-FAIL"}`);
  let ySeq = r19Text;
  const yD = [];
  for (const p of [{ id: "r21-S", old: R21_S_R19_OLD, neu: R21_S_R19_NEU }, ...R21_W_R19, ...R21_X_R19, ...R21_Z_R19, ...R21_Y_R19]) {
    const n = ySeq.split(p.old).length - 1;
    if (n === 1) ySeq = ySeq.replace(p.old, () => p.neu);
    if (R21_Y_R19.includes(p)) yD.push({ id: p.id, n, ins: r21Body.split(JSON.stringify(p.neu)).length - 1 });
  }
  const yMarks = [ySeq.split("/* r21#Y2（A2-MP-T31）").length - 1, ySeq.split("/* r21#Y3（A2-MP-T31）").length - 1, ySeq.split("/* r21#Z2（A2-MP-T27）").length - 1, ySeq.split("/* r21#Z3（A2-MP-T27）").length - 1];
  const yOkD = yD.length === 2 && yD.every((x) => x.n === 1 && x.ins === 1) && yMarks.every((n) => n === 1) && ySeq.split("function r21X3Ok(").length - 1 === 1;
  lines.push(`r21-Y r19 原文層錨點乾跑（依序套用 r21-S／W1～W3／X／Z 後）：${yD.map((x) => `${x.id}：錨點=${x.n}、patched r20 內插入=${x.ins}`).join("；")}；套用後 Y2／Y3／Z2／Z3 標記=${yMarks.join("／")} → ${yOkD ? "OK" : "NG"}`);
  const y4Self = r21Y4SelfTest();
  lines.push(`r21-Y4（A2-MP-T31）F7 ${R21_DTP_REL}（快照＝${R21_P25_R5}）版本識別判定自檢 ${y4Self.pass}/${y4Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of y4Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Y4 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  const y5Self = r21Y5SelfTest();
  lines.push(`r21-Y5（A2-MP-T31）F7 ${R21_E2F_RELS.join("／")} 版本識別判定自檢 ${y5Self.pass}/${y5Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of y5Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Y5 自檢] ${r.label}｜期望=${r.want ? "放行" : "照舊"} 實際=${r.got ? "放行" : "照舊"}`);
  for (const y of r21Y5F7()) lines.push(`  r21-Y5 目前狀態：${y.reason}（快照=${y.want ?? "-"} 目前=${y.now ?? "-"}）`);
  const y6Self = r21Y6SelfTest();
  lines.push(`r21-Y6（A2-MP-T31）r13 L2396 CB_CTD_ANCHORS[0]（快照＝${R21_P25_R5}）版本識別判定自檢 ${y6Self.pass}/${y6Self.n}（性質：版本識別，不涉及行為斷言）`);
  for (const r of y6Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-Y6 自檢] ${r.label}｜期望=${r.want} 實際=${r.got}`);
  const yOk = y0Self.pass === y0Self.n && yOkD && y4Self.pass === y4Self.n && y5Self.pass === y5Self.n && y6Self.pass === y6Self.n;
  // r21-T34（A2-MP-T34）：歷史快照 MISSING 判定／實際 patch 行為／範圍守門後備／結構／annotate 自檢（記憶體內；不建立檔案）＋目前狀態（只讀）
  const t34Self = r21T34SelfTest();
  lines.push(`r21-T34（A2-MP-T34）歷史快照 MISSING／UNVERIFIED 自檢 ${t34Self.pass}/${t34Self.n}（性質：測試基礎設施，不涉及行為斷言）`);
  for (const r of t34Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-T34 自檢] ${r.label}${r.note ? `（${r.note}）` : ""}`);
  const t34D = d.filter((x) => [...R21_T34_R13_PATCHES, ...R21_T34_R14_PATCHES].some((p) => p.id === x.id));
  lines.push(`r21-T34 r13／r14 層錨點乾跑：${t34D.length} 個 patch（${t34D.filter((x) => x.n === 1).length} 個恰好 1 次）→ ${t34D.length === R21_T34_R13_PATCHES.length + R21_T34_R14_PATCHES.length && t34D.every((x) => x.n === 1) ? "OK" : "NG"}`);
  for (const l of r21T34ReportLines(R21_T34)) lines.push(l);
  const t34Ok = t34Self.pass === t34Self.n && t34D.length === R21_T34_R13_PATCHES.length + R21_T34_R14_PATCHES.length;
  // r21-T47（A2-MP-T47）：精確路徑＋精確 sha256 版本識別判定自檢（記憶體內變體；不建立檔案）＋實際 patch 行執行＋目前狀態（只讀）
  const t47Self = r21T47SelfTest(R21_R13_PATCHES.find((p) => p.id === "r21-F F7 post-MP25 版本識別")?.neu);
  lines.push(`r21-T47（A2-MP-T47）F7 ${R21_T47_REL} 精確路徑＋精確 sha256 版本識別判定自檢 ${t47Self.pass}/${t47Self.n}（性質：版本識別，不涉及行為斷言；常數 ${R21_T47_SHA256}）`);
  for (const r of t47Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-T47 自檢] ${r.label}${r.note !== undefined ? `（${r.note}）` : ""}`);
  const t47Ok = t47Self.pass === t47Self.n;
  // r21-A2SRC（任務單 #104）：精確路徑＋精確 sha256 版本識別判定自檢（記憶體內變體；不建立／不修改檔案）＋實際 patch 行執行＋目前狀態（只讀）
  const a2Self = r21A2SrcSelfTest(R21_R13_PATCHES.find((p) => p.id === "r21-F F7 post-MP25 版本識別")?.neu);
  lines.push(`r21-A2SRC（任務單 #104）F7 ${R21_A2SRC_REL} 精確路徑＋精確 sha256 版本識別判定自檢 ${a2Self.pass}/${a2Self.n}（性質：版本識別，不涉及行為斷言；常數 ${R21_A2SRC_SHA256}）`);
  for (const r of a2Self.rows) lines.push(`  [${r.pass ? "OK" : "NG"}][r21-A2SRC 自檢] ${r.label}${r.note !== undefined ? `（${r.note}）` : ""}`);
  const a2Ok = a2Self.pass === a2Self.n;
  const ok = R21_STATE.probe.pass === R21_STATE.probe.n && d.every((x) => x.n === 1) && sN === 1 && sIns === 1 && wOk && gOk && e2Self.pass === e2Self.n && clk.pass === clk.n && x0Self.pass === x0Self.n && xOk && x4Self.pass === x4Self.n && zOk && yOk && t34Ok && t47Ok && a2Ok; // r21#X：另加 X0／X／X4 自檢（只加條件）；r21#Z：另加 Z0／Z／Z4／Z5 自檢（只加條件）；r21#Y：另加 Y0／Y／Y4／Y5／Y6 自檢（只加條件）；r21#T：另加 T34 自檢（只加條件）；r21#N1（A2-MP-T47）：另加 T47 自檢（只加條件）；r21#N2（任務單 #104）：另加 A2SRC 自檢（只加條件）
  lines.push(`r21 --probe：${ok ? "PASS" : "FAIL"}`);
  console.log(lines.join("\n"));
  writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(`wrote ${out}`);
  process.exit(ok ? 0 : 1);
}

/** 以 r21 掛載 r4／r19 子集：spawn 自己（同一套 argv 慣例），結束後比對既有 log（比對結果另寫 <out>-compare.log）。 */
async function r21Mount({ extra, ids, flags, outDefault, compare }) {
  const out = argOut() ?? `${PRE_DIR}/${outDefault}`;
  const cmpOut = out.replace(/\.log$/, "") + "-compare.log";
  for (const p of [out, cmpOut]) {
    const why = r21RefuseOut(p);
    if (why) {
      console.log(why);
      process.exit(1);
    }
  }
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [SELF, "--brief", ...flags, `--only=${ids.join(",")}`, `--extra-scenarios=${WORK_ROOT}/${extra}`, `--out=${out}`, ...pass];
  const code = await new Promise((res) => spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" }).on("close", (c) => res(c ?? 1)));
  if (existsSync(out)) {
    const lines = compare(out);
    console.log(lines.join("\n"));
    writeFileSync(cmpOut, `${lines.join("\n")}\n`);
    console.log(`wrote ${cmpOut}`);
  }
  process.exit(code);
}
const sectionFrom = (text, start) => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(start));
  if (i < 0) return [];
  const j = lines.findIndex((l, k) => k > i && /^情境=\d+ 模式=/.test(l));
  return lines.slice(i, j > i ? j : undefined).filter((l) => !/耗時=/.test(l));
};
const blockAfter = (text, header) => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim() === header);
  if (i < 0) return null;
  const out = [];
  for (let k = i + 1; k < lines.length && lines[k].trim() !== ""; k += 1) out.push(lines[k]);
  return out;
};
if (!IS_CHILD && process.argv.includes("--cross-r4")) {
  const m = await import(`${WORK_ROOT}/${CROSS_R4}`);
  const ids = (m.scenarios ?? []).map((s) => s.id);
  await r21Mount({
    extra: CROSS_R4,
    ids,
    flags: ["--f10", "--pa2", "--a2", "--mp1"],
    outDefault: "mp-cross-r4-r21.log",
    compare: (out) => {
      const ref = `${PRE_DIR}/mp-cross-r4-r20.log`;
      const A = sectionFrom(readFileSync(ref, "utf8"), "══════════════ more_places 跨目的地續推");
      const B = sectionFrom(readFileSync(out, "utf8"), "══════════════ more_places 跨目的地續推");
      const sa = new Set(A);
      const sb = new Set(B);
      const onlyA = A.filter((l) => !sb.has(l));
      const onlyB = B.filter((l) => !sa.has(l));
      const sum = (t) => t.split("\n").filter((l) => /^more_places .*PASS=\d+/.test(l) || /^more_places r\d/.test(l));
      const p1 = (t) => t.split("\n").filter((l) => /^verify-destination-authority-phase2-r(20|21): /.test(l)).at(-1)?.match(/work P1=.*? external=\d+/)?.[0] ?? "-";
      const res = [`── r21 --cross-r4 比對（vs scratchpad/mp-cross-r4-r20.log；extra-scenario 報告區段，略過耗時行）：r20 行數=${A.length} r21 行數=${B.length} 只在 r20=${onlyA.length} 只在 r21=${onlyB.length}；逐行順序相同=${JSON.stringify(A) === JSON.stringify(B)}`];
      for (const l of onlyA.slice(0, 15)) res.push(`  [只在 r20] ${l.slice(0, 220)}`);
      for (const l of onlyB.slice(0, 15)) res.push(`  [只在 r21] ${l.slice(0, 220)}`);
      res.push(`  r20 摘要：${sum(readFileSync(ref, "utf8")).join("｜")}`);
      res.push(`  r21 摘要：${sum(readFileSync(out, "utf8")).join("｜")}`);
      res.push(`  P1／external：r20=${p1(readFileSync(ref, "utf8"))}｜r21=${p1(readFileSync(out, "utf8"))}`);
      return res;
    },
  });
}
if (!IS_CHILD && process.argv.includes("--r19-parity")) {
  const m = await import(`${WORK_ROOT}/${MP25_R2}`);
  const ids = [...(m.scenarios ?? []).map((s) => s.id), "R10-a2-kyoto-kanazawa-more", "R15-PROBE"];
  await r21Mount({
    extra: MP25_R2,
    ids,
    flags: ["--pa2", "--a2", "--mp1"],
    outDefault: "r21-parity.log",
    compare: (out) => {
      const refs = [["原版 r19（r19-subset-T6.log）", `${PRE_DIR}/r19-subset-T6.log`], ["r20（r20-parity-r19subset.log）", `${PRE_DIR}/r20-parity-r19subset.log`]];
      const pick = (t) => {
        const lines = t.split("\n");
        const sum = lines.filter((l) => /^verify-destination-authority-phase2-r(19|20|21): /.test(l)).at(-1) ?? "";
        const p1 = sum.match(/work P1=.*? external=\d+/)?.[0] ?? "-";
        const p1Work = blockAfter(t, "══ P1（work = F5 後）══") ?? [];
        const p1New = blockAfter(t, "══ work 新增 P1（pre 沒有）══") ?? [];
        const r14 = lines.filter((l) => /r14-A2：/.test(l));
        const ns = lines.filter((l) => l.includes("[NECESSARY-SEARCH]"));
        const nsCount = lines.filter((l) => /^ {2}── (work|mp1) NECESSARY-SEARCH=\d+ ──/.test(l));
        const tbl = lines.filter((l) => /^ {2,3}\d{1,2}\. /.test(l) && /work=/.test(l));
        const mp = lines.filter((l) => /^MP-25 r2（work）/.test(l));
        return { p1, p1Work, p1New, r14, ns, nsCount, tbl, mp, r19: sum.match(/r19\[[^\]]*\]/)?.[0] ?? "-", r20: sum.match(/r20\[[^\]]*\]/)?.[0] ?? "-", r21: sum.match(/r21\[[^\]]*\]/)?.[0] ?? "-" };
      };
      const b = pick(readFileSync(out, "utf8"));
      const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      const setEq = (x, y) => eq([...new Set(x)].sort(), [...new Set(y)].sort());
      const res = ["── r21 --r19-parity 比對 ──"];
      for (const [name, file] of refs) {
        const a = pick(readFileSync(file, "utf8"));
        res.push(`  vs ${name}`);
        res.push(`    P1／external 計數：${eq(a.p1, b.p1) ? "相同" : "不同"}｜ref：${a.p1}｜r21：${b.p1}`);
        res.push(`    work P1 集合（══ P1（work = F5 後）══）：${setEq(a.p1Work, b.p1Work) ? "相同" : "不同"}（ref=${a.p1Work.length} r21=${b.p1Work.length}）`);
        for (const l of b.p1Work.filter((x) => !a.p1Work.includes(x))) res.push(`      [只在 r21] ${l.slice(0, 200)}`);
        for (const l of a.p1Work.filter((x) => !b.p1Work.includes(x))) res.push(`      [只在 ref] ${l.slice(0, 200)}`);
        res.push(`    work 新增 P1 集合：${setEq(a.p1New, b.p1New) ? "相同" : "不同"}（ref=${a.p1New.length} r21=${b.p1New.length}）`);
        res.push(`    r14-A2 行：${setEq(a.r14, b.r14) ? "相同" : "不同"}（ref=${a.r14.length} r21=${b.r14.length}）`);
        res.push(`    NECESSARY-SEARCH 行：${eq(a.ns, b.ns) ? "相同" : "不同"}（ref=${a.ns.length} r21=${b.ns.length}）；計數行 r21=${b.nsCount.map((x) => x.trim()).join("、") || "-"}`);
        res.push(`    mp25-r2 16 項表：${eq(a.tbl, b.tbl) ? "相同" : "不同"}（ref=${a.tbl.length} r21=${b.tbl.length}）；work 摘要：${eq(a.mp, b.mp) ? "相同" : "不同"}`);
        res.push(`    r19 欄：${eq(a.r19, b.r19) ? "相同" : "不同"}｜r20 欄：${a.r20 === "-" ? "（ref 無）" : eq(a.r20, b.r20) ? "相同" : "不同"}`);
      }
      res.push(`  r21 欄：${b.r21}`);
      const nsOk = b.nsCount.length === 2 && b.nsCount.every((x) => /=5 ──/.test(x));
      res.push(`  NECESSARY-SEARCH 5/5（work、mp1）：${nsOk ? "OK" : "NG"}`);
      return res;
    },
  });
}

if (!IS_CHILD && process.argv.includes("--emit-diff")) {
  const CAP = Symbol("r21-capture");
  const runCapture = async (body, r21extra) => {
    let got = null;
    let r20Body = null;
    let r19Body = null;
    let r18Body = null;
    let r17Body = null;
    let r16Body = null;
    const r21 = makeR21({
      ...r21extra,
      onR20Body: (b) => {
        r20Body = b;
      },
      r20Extra: {
        onR19Body: (b) => {
          r19Body = b;
        },
        r19Extra: {
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
        },
      },
    });
    try {
      await new AsyncFunction("__r21", `"use strict";\n${body}`)(r21);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got || !r20Body || !r19Body || !r18Body || !r17Body || !r16Body) throw new Error("emit capture 未取得執行內容");
    return { ...got, r20Body, r19Body, r18Body, r17Body, r16Body };
  };
  const baseBody = r21Apply(r20Src, R21_R20_INFRA, "r20(基準)");
  const base = await runCapture(baseBody, { r13Patches: [], r14Patches: [] });
  const mine = await runCapture(r21Body, {});
  const F = (n) => `${PRE_DIR}/${n}`;
  const files = {
    r20: R20_FILE,
    r21r20: F("r21.patched-r20.mjs"),
    baseR19: F("r21base.r20-patched-r19.mjs"),
    r21R19: F("r21.patched-r19.mjs"),
    baseR18: F("r21base.r20-patched-r18.mjs"),
    r21R18: F("r21.patched-r18.mjs"),
    baseR17: F("r21base.r20-patched-r17.mjs"),
    r21R17: F("r21.patched-r17.mjs"),
    baseR16: F("r21base.r20-patched-r16.mjs"),
    r21R16: F("r21.patched-r16.mjs"),
    baseR15: F("r21base.r20-patched-r15.mjs"),
    r21R15: F("r21.patched-r15.mjs"),
    baseR14: F("r21base.r20-patched-r14.mjs"),
    r21R14: F("r21.patched-r14.mjs"),
    baseExec: F("r21base.r20-exec.mjs"),
    r21Exec: F("r21.r21-exec.mjs"),
  };
  const W = (path, text) => {
    const why = r21RefuseArtifact(path);
    if (why) throw new Error(why);
    writeFileSync(path, text);
  };
  W(files.r21r20, `${shebang[0]}${r21Body}`);
  W(files.baseR19, `#!/usr/bin/env node\n${base.r20Body}`);
  W(files.r21R19, `#!/usr/bin/env node\n${mine.r20Body}`);
  W(files.baseR18, `#!/usr/bin/env node\n${base.r19Body}`);
  W(files.r21R18, `#!/usr/bin/env node\n${mine.r19Body}`);
  W(files.baseR17, `#!/usr/bin/env node\n${base.r18Body}`);
  W(files.r21R17, `#!/usr/bin/env node\n${mine.r18Body}`);
  W(files.baseR16, base.r17Body);
  W(files.r21R16, mine.r17Body);
  W(files.baseR15, base.r16Body);
  W(files.r21R15, mine.r16Body);
  W(files.baseR14, base.patchedR14);
  W(files.r21R14, mine.patchedR14);
  W(files.baseExec, base.r15Exec);
  W(files.r21Exec, mine.r15Exec);
  const same = (a, b) => (existsSync(b) ? (readFileSync(b, "utf8") === a ? "相同" : "不同") : "（缺檔）");
  const diffText = (a, b, la, lb) => {
    try {
      return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const KEYS = R21_KEYS;
  const ALL = [...R21_R20_PATCHES, ...R21_R13_PATCHES, ...R21_R14_PATCHES];
  const MARK = { V0: "r21-V（執行需要／掛載點）", V1: "r21-V child script（版本識別）", V2: "r21-V whitelist（版本識別）", V3: "r21-V summary（版本識別）", V4: "r21 makeR20 r21 handle（掛載點）", R1: "r21 report／summary（只新增輸出）", D1: "r21-D alias module（既有 canonical 載入）", D2: "r21-D r20SameIdentity canonical（裁決 d）", E1: "r21-E 輪初登記（例外比對基準）", E3: "r21-E exception tighten（斷言收緊）", E4: "r21-E record write（只記錄寫入）", E5: "r21-E turn end（send() 層檢查；新 P1 來源）", O1: "r21-O（只記錄）", S1: "r21-S post-MP25 允許差異檔＋continue-recommendation-intent.ts（A2-MP-T11；快照允許清單擴充）", F1: "r21-F F7 post-MP25 版本識別（A2-MP-T13；不涉及行為斷言）", G1: "r21-G1 G2S1 字元距離 → AST 安全契約（A2-MP-T14；post-MP25 才啟用）", G2: "r21-G2 A2 anchor#3 → AST 安全契約（A2-MP-T14；post-MP25、只限 work）", W0: "r21-W post-MP25-r2 版本識別插入點（A2-MP-T15）", W1: "r21-W1 r19Snap 快照檔 → post-MP25-r2（A2-MP-T15；版本識別）", W2: "r21-W2 R19_SNAP_PATCHES_R17 檔名 → post-MP25-r2（A2-MP-T15；版本識別）", W3: "r21-W3 ctd 差異綁定 post-MP25-r2 sha1（A2-MP-T15；版本識別）", W4: "r21-W4 r21-F／r21-G 快照檔 → post-MP25-r2（A2-MP-T15；版本識別）", F2: "r21-F2 F7 trip-planning-session-reset.ts 版本識別（A2-MP-T18；E2；不涉及行為斷言）", C1: "r21-C 每輪時間偏移 r21ClockByTurn（A2-MP-T18；測試基礎設施）", T0: "r21-T34 r13 sha 驗證（A2-MP-T34）", T1: "r21-T34 pre 群組前提 MISSING → UNVERIFIED（A2-MP-T34）", T2: "r21-T34 pre-G2S1 快照 MISSING → 不讀（A2-MP-T34）", T3: "r21-T34 範圍守門後備（嚴格 sha 綁定）／pre 樹前提包覆（A2-MP-T34）", T4: "r21-T34 歷史 anchor／sha 檢查 MISSING → UNVERIFIED（原敘述逐字保留；A2-MP-T34）", T5: "r21-T34 TREES 移除 MISSING 樹（A2-MP-T34）", T6: "r21-T34 judge／P1 彙整 MISSING 守衛（A2-MP-T34）", T7: "r21-T34 報告 MISSING／UNVERIFIED 標示與非全量判定（A2-MP-T34）", T8: "r21-T34 結束碼 非全量＝2（A2-MP-T34）", N1: "r21-T47 F7 scripts/verify-negated-switch-s1s4.mjs 精確路徑＋精確 sha256 版本識別（A2-MP-T47；不涉及行為斷言）", N2: "r21-A2SRC F7 scripts/verify-a2-source-scenarios.mjs 精確路徑＋精確 sha256 版本識別（任務單 #104；不涉及行為斷言）" };
  const classify = (h) => {
    const marks = new Set();
    for (const l of h.add) for (const m of l.matchAll(/r21#([A-Z]\d)/g)) marks.add(m[1]);
    if (h.add.some((l) => l.includes("phase2-r21: work P1="))) marks.add("V3"); // 摘要字串向下層傳遞時不帶 r21# 標記
    const lab = [...marks].map((m) => MARK[m] ?? m);
    return lab.length ? lab.join("＋") : "未標記（需人工核對）";
  };
  /** 刪除行去處：每一條刪除行在同一 hunk 的新增行中逐字保留（只是被 patch 改寫位置），或說明被取代的內容。 */
  const fate = (h, l) => {
    const body = l.slice(1);
    if (h.add.some((a) => a.slice(1) === body)) return "原樣保留（同一 hunk 重新輸出）";
    if (/import \{/.test(body)) return "r21#V0：import 陳述式 → await __r21.imp（同模組同名稱）";
    if (/process\.argv\.includes\("--/.test(body)) return "r21#V0：r20 自身旗標加 __r21.r20Flags 條件停用（r21 自行處理同名旗標）";
    if (/imp: \(s\) => import\(s\)/.test(body)) return "r21#V0：imp 改由 __r21.imp 提供";
    if (/makeR20\(\{\}\)/.test(body)) return "r21#V0：makeR20({}) → makeR20(__r21.r20Extra ?? {})";
    if (/rawGeographicLabel \?\? ""\)\.trim\(\) ===/.test(body)) return "r21#D2：逐字比對 → 既有 canonical identity（裁決 d）";
    if (/phase2-r20\.mjs`; \/\/ r20#V1/.test(body)) return "r21#V1：子程序路徑 r20 → r21（r20#V1 註解保留）";
    if (/r20#V2/.test(body)) return "r21#V2：白名單加 r21＋mp25-r4（原內容保留於新增行）";
    if (/phase2-r20: work P1=/.test(body)) return "r21#V3：摘要識別 r20 → r21";
    if (/report: r20Report|summaryFields: r20SummaryFields|state: R20_STATE/.test(body)) return "r21#R1／V4：r20 報告／摘要包一層（r20 內容照輸出）＋r21 handle";
    if (/verify-destination-authority-phase2-r20/.test(body)) return "r21#V1／V2／V3：版本識別字串（r20 → r21）向下層傳遞";
    if (/^const R19_SNAP_EXTRA_OK = /.test(body)) return "r21#S1：R19_SNAP_EXTRA_OK 兩檔 → 三檔（＋continue-recommendation-intent.ts；A2-MP-T11）";
    if (/creditsAt - moreAt < 3000 \+ __r14\.r15\.r16\.r17\.f2MoreDelta\(appWork\)\)\) \/\* r17-V \*\/ G2S1_ANCHOR_FAIL\.push\(/.test(body)) return "r21#G1：非 post-MP25 時原條件逐字保留於新增行（三元式的 else 分支）；post-MP25 時改由 r21-G AST 契約（A2-MP-T14）";
    if (/^function r19Snap\(\) \{$|^ {2}const f = `\$\{PRE_DIR\}\/post-MP25-sha\.txt`;$/.test(body)) return "r21#W1：r19Snap 快照檔 → R21_P25（A2-MP-T15；版本識別）";
    if (/^\]\.map\(\(\[old, neu\], i\) => \(\{ id: `r19-V post-MP25 r17#/.test(body)) return "r21#W2：R19_SNAP_PATCHES_R17 neu 檔名 → R21_P25（A2-MP-T15；版本識別）";
    if (/R19_SNAP_EXTRA_OK\.includes\(rel\)\)\) fail\.push\(`post-MP25 相對 post-MP-r2/.test(body)) return "r21#W3：原條件保留於新增行，另加 ctd＝post-MP25-r2 sha1 才允許（A2-MP-T15；版本識別）";
    if (/const r21P25File = /.test(body)) return "r21#W4：r21-F 快照檔 → R21_P25（A2-MP-T15；版本識別）";
    if (/post-MP25-sha\.txt/.test(body)) return "r21#W2：施工後 sha 檢查檔名 post-MP25 → R21_P25 向下層傳遞（A2-MP-T15；版本識別）";
    if (h.add.some((a) => /r21#T\d|__R21_T34/.test(a))) return "r21#T（A2-MP-T34）：原敘述逐字保留於新增行（加上 MISSING 守衛；--probe 結構自檢 keep）";
    return "未歸類（需人工核對）";
  };
  const stats = (d) => {
    const lines = d.split("\n");
    const del = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const add = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const by = {};
    const hunks = [];
    let cur = null;
    for (const l of lines) {
      if (l.startsWith("@@")) {
        cur = { head: l, add: [], del: [] };
        hunks.push(cur);
      } else if (cur && l.startsWith("+") && !l.startsWith("+++")) cur.add.push(l);
      else if (cur && l.startsWith("-") && !l.startsWith("---")) cur.del.push(l);
    }
    const hit = [];
    for (const h of hunks) for (const l of h.del) if (KEYS.some((k) => l.includes(k))) hit.push({ l, fate: fate(h, l), keys: KEYS.filter((k) => l.includes(k)) });
    for (const x of hit) for (const k of x.keys) by[k] = (by[k] ?? 0) + 1;
    const cls = hunks.map((h) => `${h.head} → ${classify(h)}（-${h.del.length} +${h.add.length}）`);
    const allFate = hunks.flatMap((h) => h.del.map((l) => ({ l, fate: fate(h, l) })));
    return { deleted: del.length, added: add.length, hit, by, hunks: hunks.length, cls, allFate };
  };
  const parts = [
    diffText(files.r20, files.r21r20, "scripts/verify-destination-authority-phase2-r20.mjs", "r21 實際執行的 r20（r20＋R21_R20_PATCHES）"),
    diffText(files.baseR19, files.r21R19, "r20 實際執行的 r19", "r21 實際執行的 r19（差異只來自 r20 原文層 patch 的字串）"),
    diffText(files.baseR18, files.r21R18, "r20 實際執行的 r18", "r21 實際執行的 r18"),
    diffText(files.baseR17, files.r21R17, "r20 實際執行的 r17", "r21 實際執行的 r17"),
    diffText(files.baseR16, files.r21R16, "r20 實際執行的 r16", "r21 實際執行的 r16"),
    diffText(files.baseR15, files.r21R15, "r20 實際執行的 r15", "r21 實際執行的 r15"),
    diffText(files.baseR14, files.r21R14, "r20 實際執行的 r14", "r21 實際執行的 r14（再加 R21_R14_PATCHES）"),
    diffText(files.baseExec, files.r21Exec, "r20 實際執行內容（r13＋R14～R20_R13_PATCHES）", "r21 實際執行內容（再加 R21_R13_PATCHES）"),
  ];
  const s = parts.map(stats);
  const ids = (a) => a.map((p) => p.id).join("｜");
  const lm = R21_STATE.limits;
  const head = [
    "# r21.diff（A2-MP-T9；相對 r20 的邏輯差異）",
    `# r20 sha256=${shaWant("scripts/verify-destination-authority-phase2-r20.mjs")}、r19 sha256=${shaWant("scripts/verify-destination-authority-phase2-r19.mjs")}（已驗證，scratchpad/pre-MP9T-test-sha.txt）`,
    `# 基準一致性（r21 基準＝r20 原文＋R21_R20_INFRA、R21 各層陣列皆空）：r19 層 vs scratchpad/r20.patched-r19.mjs＝${same(`#!/usr/bin/env node\n${base.r20Body}`, F("r20.patched-r19.mjs"))}；r18 層 vs r20.patched-r18.mjs＝${same(`#!/usr/bin/env node\n${base.r19Body}`, F("r20.patched-r18.mjs"))}；r17 層 vs r20.patched-r17.mjs＝${same(`#!/usr/bin/env node\n${base.r18Body}`, F("r20.patched-r17.mjs"))}；r16 層 vs r20.patched-r16.mjs＝${same(base.r17Body, F("r20.patched-r16.mjs"))}；r15 層 vs r20.patched-r15.mjs＝${same(base.r16Body, F("r20.patched-r15.mjs"))}；r14 層 vs r20.patched-r14.mjs＝${same(base.patchedR14, F("r20.patched-r14.mjs"))}；執行內容 vs r20.r20-exec.mjs＝${same(base.r15Exec, F("r20.r20-exec.mjs"))}`,
    `# ★ 測試契約放寬揭露：originalUserText 上限 原版 r19＝500 → r20#L1／r21＝${lm.userText}（${lm.src.userText}）。r21 未改變此數值，只揭露。`,
    `# canonical identity（裁決 d）：${R21_CANON.src}`,
    `# 第 A 部分：r20 原文 → r21 實際執行的 r20（R21_R20_PATCHES ${R21_R20_PATCHES.length} 個）：${ids(R21_R20_PATCHES)}`,
    "# 第 0～4 部分：r19／r18／r17／r16／r15 層（R21 沒有該層 patch；差異只來自第 A 部分 child script／whitelist／summary 字串向下傳遞）",
    `# 第 5 部分：r14 層（R21_R14_PATCHES ${R21_R14_PATCHES.length} 個）：${ids(R21_R14_PATCHES)}`,
    `# 第 6 部分：r13 執行內容（R21_R13_PATCHES ${R21_R13_PATCHES.length} 個）：${ids(R21_R13_PATCHES)}`,
    `# KEYS（T8 修正 c；新增 why.push(／A(／f.push(／fails.push(／add(）：${KEYS.join("／")}`,
    ...s.map((x, i) => `#   第${i === 0 ? "A" : i - 1}部分 hunk=${x.hunks} 刪除行=${x.deleted} 新增行=${x.added}；刪除行含 KEYS = ${x.hit.length} ${JSON.stringify(x.by)}`),
    ...s.flatMap((x, i) => x.hit.map((h) => `#   [第${i === 0 ? "A" : i - 1}部分 刪除行命中 ${h.keys.join(",")}] ${h.l.slice(0, 200)} → 去處：${h.fate}`)),
    "# 全部刪除行去處：",
    ...s.flatMap((x, i) => x.allFate.map((h) => `#   [第${i === 0 ? "A" : i - 1}部分] ${h.l.slice(0, 160)} → ${h.fate}`)),
    "# 逐 hunk 歸類（依 patch 唯一標記 r21#…）：",
    ...s.flatMap((x, i) => x.cls.map((c) => `#   [第${i === 0 ? "A" : i - 1}部分] ${c}`)),
    `# patch 總數 ${ALL.length}`,
    "",
  ];
  W(F("r21.diff"), `${head.join("\n")}\n${parts.map((d, i) => `######## 第 ${i === 0 ? "A" : i - 1} 部分 ########\n${d}`).join("\n")}`);
  // T8 修正 c：以新 KEYS 重算 r20.diff、mp25-r3.diff 的刪除行
  const recount = (file) => {
    if (!existsSync(file)) return { file, missing: true, hits: [], deleted: 0 };
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#"));
    const del = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const hits = del.filter((l) => KEYS.some((k) => l.includes(k))).map((l) => ({ l, keys: KEYS.filter((k) => l.includes(k)) }));
    return { file, deleted: del.length, hits };
  };
  const rc = [recount(F("r20.diff")), recount(F("mp25-r3.diff"))];
  let mp = { CHANGES: [], ITEMS: [], DEL_NOTES: [] };
  try {
    mp = await import(`${WORK_ROOT}/${MP25_R4}`);
  } catch (e) {
    mp = { CHANGES: [{ no: "-", old: `（無法載入 mp25-r4：${String(e?.message ?? e).slice(0, 80)}）`, neu: "", why: "", fix: "", kind: "" }], ITEMS: [] };
  }
  const esc = (x) => String(x ?? "").replace(/\|/g, "／").replace(/\n/g, " ");
  const p = R21_STATE.probe;
  const md = [
    "# r21／mp25-r4 契約差異（A2-MP-T9；由 r21 --emit-diff 產生）",
    "",
    `長度上限（既有限制，執行期從原始碼讀出）：使用者原句 ≤${lm.userText}〔${lm.src.userText}〕；地名 ≤${lm.label}〔${lm.src.label}〕`,
    "",
    `**★ 測試契約放寬揭露（唯一授權的放寬）**：originalUserText 長度上限由原版 r19 的 500（r19 自創）改為既有 ChatRequest.chatInput max(${lm.userText})。此放寬自 r20#L1 起生效、r20 未揭露；r21 不改數值，只揭露。r21 探針中「原版 r19 單獨 P1、r21 放行」者共 ${p.relax.length} 條：${p.relax.join("；") || "-"}。`,
    "",
    `canonical identity（裁決 d）：${R21_CANON.src}`,
    "",
    "## r21（相對 r20）：舊斷言 → 新斷言 → 理由 → 放寬／加嚴",
    "",
    "| 項目 | 舊 | 新 | 理由 | 放寬／加嚴 |",
    "|---|---|---|---|---|",
    ...R21_CONTRACT.map((r) => `| ${[r.item, r.old, r.neu, r.why, r.kind].map(esc).join(" | ")} |`),
    "",
    `r21 探針：${p.pass}/${p.n}（canonical ${p.groups.canonical.pass}/${p.groups.canonical.n}；r20 原 51 條 ${p.groups["r20-51"].pass}/${p.groups["r20-51"].n}；r21 新增 ${p.groups["r21-new"].pass}/${p.groups["r21-new"].n}；send() 層 ${p.groups.send.pass}/${p.groups.send.n}）`,
    `r21 相對 r20 加嚴（r20 放行、r21 P1）：${p.tightened.join("；") || "-"}`,
    "",
    "### r21.diff 刪除行（KEYS 命中）逐行去處",
    "",
    ...s.flatMap((x, i) => x.hit.map((h) => `- 第${i === 0 ? "A" : i - 1}部分 \`${esc(h.l).slice(0, 160)}\`（${h.keys.join(",")}）→ ${h.fate}`)),
    ...(s.every((x) => !x.hit.length) ? ["- （無）"] : []),
    "",
    "### 以新 KEYS 重算既有 diff 的刪除行（T8 修正 c）",
    "",
    ...rc.flatMap((r) => [`- ${r.file.split("/").pop()}：刪除行=${r.deleted}；命中=${r.hits.length}${r.missing ? "（缺檔）" : ""}`, ...r.hits.map((h) => `  - \`${esc(h.l).slice(0, 160)}\`（${h.keys.join(",")}）`)]),
    "",
    "## mp25-r4（相對 mp25-r3）：舊斷言 → 新斷言 → 理由 → 放寬／加嚴",
    "",
    "| # | 舊 | 新 | 理由 | 修正項 | 放寬／加嚴 |",
    "|---|---|---|---|---|---|",
    ...(mp.CHANGES ?? []).map((c) => `| ${[c.no, c.old, c.neu, c.why, c.fix, c.kind].map(esc).join(" | ")} |`),
    "",
    "## mp25-r4 項目：斷言位置",
    "",
    "| 項目 | 情境 | 斷言 |",
    "|---|---|---|",
    ...(mp.ITEMS ?? []).map((c) => `| ${[c.no, c.scen, c.where].map(esc).join(" | ")} |`),
    "",
    "## mp25-r4 判定定義（詢問次數／驗證次數／identity）",
    "",
    ...(mp.DEFINITIONS ?? []).map((x) => `- ${x}`),
    "",
  ];
  W(F("r21-mp25r4-contract-diff.md"), md.join("\n"));
  console.log(`wrote ${F("r21.diff")}、${F("r21-mp25r4-contract-diff.md")}`);
  console.log(head.filter((l) => !/^# {3}\[第.部分\] /.test(l)).join("\n"));
  for (const r of rc) console.log(`以新 KEYS 重算 ${r.file.split("/").pop()}：刪除行=${r.deleted} 命中=${r.hits.length}`);
  process.exit(0);
}

if (!IS_CHILD) {
  const out = argOut();
  if (out) {
    const why = r21RefuseOut(out);
    if (why) {
      console.log(why);
      process.exit(1);
    }
  }
}
await new AsyncFunction("__r21", `"use strict";\n${r21Body}`)(makeR21({}));
