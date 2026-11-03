#!/usr/bin/env node
/**
 * verify-a2-source-scenarios（任務單 #95 建立；#97 第 2 輪修正；#99 第 3 輪修正，tester）：A2 方案 A——唯一施工規格（A2-SOURCE-IMPLEMENTATION-SPEC.md）
 * 9.1、9.1a、9.1b、9.1c、9.1c-1、9.1c-2，以及（#97 新增）9.2 R-S1～S6、9.3 R-NU-*／R-E0-1～3／R-PEND-4／R-9919 的整合情境檔。
 *
 * 機制：不自建 Harness、不建立新的 Mock、不重寫 send 層。只匯出 { scenarios, report }，由既有 r21（→ r20 → … → r15 → r13）
 *   以 --extra-scenarios=本檔 載入（r15 L1122-1142：只接受 scripts/verify-*.mjs、需匯出 scenarios 陣列與 report 函式）。
 *   情境只使用既有欄位：turns（字串或 { text, onlyIfClarified }，r13 L2010-2015）、r15Modes、r15Real（r15-X 情境 Fixture，
 *   同 mp25-r4 GP_FUKUOKA 手法）、r19Coords（r20 只記錄）；#97 另有兩案使用既有注入欄位（標 INJECTED_STATE）：
 *   initKind "legacyNearby"（r13 L906-915 既有 Fixture）、r15Init＋r15EmptyDest（r15 L198-199、L244-280；值同 mp25-r4 INIT_KYOTO_EXHAUSTED）。
 *
 * 證據分類（使用者裁決 #97-1；每案每回合必標其一）：
 *   ACTUAL_APP_CALLBACK     ＝ 該回合確實執行了 r14 擷取的正式 _app 原始碼（r14:12-25）：path 含「|real:<dc|more|refine|alt|dp|nearby>=」
 *                             （r14 R14_onDone L689，正式 6 個 useCallback 之一執行完成），或「alternative_recommendations(real)」／
 *                             「continuation:<route>(real)」（r14-Δ4 L1184-1203，send() 的 alt／refetch 兩個正式區塊實際取用分支）。
 *                             注意：即使如此，該回合「進入 Callback 之前」的 send 路由仍是 r13 鏡像。
 *                             （#99-4）另含 r18 正式區塊記號 |r18:destSwitch(real)（r18:273）、|r18:fbContinue(real)=<值>（r18:319）、
 *                             |r18:refineMore(real)=T（r18:350）；「=fallthrough」（r18:322／:350）不計，另註明。
 *   MIRRORED_SEND+REAL_LIB  ＝ r13 send() 重建鏡像驅動、lib 模組為該樹真實 import，但本回合未執行任何正式 _app Callback／區塊。
 *   MODEL                   ＝ path 含「未重建」（r13 模型未重建路徑；正式碼未執行）→ 該回合所有欄位一律 UNVERIFIED，不得 PASS。
 *   INJECTED_STATE          ＝ 情境以 r15Init／initKind／r18Init／r18Pending 注入 Session（優先於上兩類標示）；規格類型為 CB 者不得計 PASS。
 *   NOT-REACHED             ＝ 該回合未執行（含 onlyIfClarified 未送出），或指定入口未觀測到。
 *   UNVERIFIED              ＝ 回合有例外／path 為空；或規格要求的欄位 Harness 未記錄（逐案列出）；或內部分支前提無 spy。
 *   BASELINE ＝ 規格要求「與 r5 逐字相同」的欄位：本次只記錄（@@A2SRC@@ JSON 行），施工後再逐字比對；本身不計 PASS。
 *   RECORD／STOP ＝ 9.1c-2 記錄型：不設「已修正」期望；停止條件 (1)～(4) 任一成立 → STOP；外部請求 → FAIL（STOP）。
 *
 * 判定輸出（#97-3）：每案分開輸出「可觀測欄位判定」（只依 Harness 已記錄欄位）與「最終判定」（另計前提、未記錄之必要欄位、證據類型）。
 *   最終判定：任一 FAIL → FAIL；否則前提／欄位 NOT-REACHED → NOT-REACHED；否則任何 UNVERIFIED 來源 → UNVERIFIED；否則有 BASELINE → BASELINE；否則 PASS。
 *   （#99-5；#101-2 加嚴）UNVERIFIED 來源另含：案例每個必要依據回合（檢查項／入口前提之回合）任一不是 ACTUAL_APP_CALLBACK。
 *   （#99-2）report 末尾另輸出「可觀測欄位判定分佈」（施工前後比較主指標）與「最終 PASS 不可達」原因行。
 *   （#99-3）report 回傳 fail＝FAIL＋STOP＋INFRA＋(harness integrity NG ? 1 : 0)；UNVERIFIED／BASELINE／RECORD／NOT-REACHED／NOT-RUN 不計。
 *   （#101-5）report 分區：A Runner／Harness 完整性、B 功能案例結果、C SAFETY／P1、D INFRA、E external、F Source／Git SHA（由外部記錄）、G MISSING／UNVERIFIED；
 *     分區只重新彙整既有判定結果，不改判定邏輯。
 * Weather（#97-3）：weather prefetch 的 geocode 一律計入 Geocoding Provider；規格原文「任何 query」「geocode＝0」「0 geocode」「0 付費」→ 含 weather；
 *   規格原文只寫「0 Provider（本地）」→ 未明示是否含 weather prefetch：兩版都印，判定只採「含 weather 版」，不含 weather 版只供指派者裁決、不計入。
 *
 * ★ Harness 限制（必須揭露）：r13 send() 是 _app.chat.tsx send 的「重建鏡像」，不是 _app 原文。施工規格 2.1(11) 的 _app send 層新分支
 *   （:8009 E0／N4／E1 關卡、:8837 pin、:9387 cpf 呼叫點、C3、9262 callback）不會因修改 _app 而自動出現在 Harness 中；依賴這些分支的期望
 *   （例 R-NEG-1 的 E1 提問、R-NU-*／R-E0-*、reset 次數）在施工後若 FAIL，需先確認 r21 r6（8.2）鏡像是否已同步，不得直接歸因於 Source。
 *
 * 本檔副作用：無。不讀寫檔案、不讀 .env、不連網、不改 globalThis／process。只在 report() 內 push 文字到 r15 傳入的 out 陣列。
 *
 * 執行（由另一位 tester 在 r21 加入精確 sha 白名單後才執行；本步不執行）：
 *   node scripts/verify-destination-authority-phase2-r21.mjs --brief --a2 --mp1 --only=<A2S_ONLY> \
 *        --extra-scenarios=scripts/verify-a2-source-scenarios.mjs --out=<scratchpad>/a2-src-r5.log
 *   （A2S_ONLY＝本檔匯出的 ONLY_IDS；未帶 --only 時 r13 全部情境也會執行。）
 */

const OK = { id: "ok", geo: "ok", search: "ok" };
const P = "PASS";
const FAIL = "FAIL";
const NR = "NOT-REACHED";
const UNV = "UNVERIFIED";
const BL = "BASELINE";
const EV = { CB: "ACTUAL_APP_CALLBACK", MS: "MIRRORED_SEND+REAL_LIB", MODEL: "MODEL", INJ: "INJECTED_STATE", NR: "NOT-REACHED", UNV: "UNVERIFIED" };

// ════════════════ 情境 Fixture（r15-X r15Real；只在本檔情境子程序有效；不改 r13 REAL／PARENTS）════════════════
const LOCF = (o) => ({ placeId: `mock-${o.formattedName}`, country: o.country ?? "日本", city: o.city, region: o.region, ...(o.district ? { district: o.district } : {}), ...(o.sublocality ? { sublocality: o.sublocality } : {}), lat: o.lat, lng: o.lng, formattedName: o.formattedName, displayLabel: o.displayLabel ?? o.formattedName });
const FUKUOKA = LOCF({ city: "福岡市", region: "福岡縣", lat: 33.5902, lng: 130.4017, formattedName: "福岡市" }); // 同 mp25-r4 GP_FUKUOKA_LOC
const FURANO = LOCF({ city: "富良野市", region: "北海道", lat: 43.3421, lng: 142.3832, formattedName: "富良野市" });
const JIUFEN = LOCF({ country: "台灣", city: "新北市", region: "新北市", district: "瑞芳區", sublocality: "九份", lat: 25.1092, lng: 121.8452, formattedName: "九份", displayLabel: "新北市瑞芳區九份" });
const TOKAMACHI = LOCF({ city: "十日町市", region: "新潟縣", lat: 37.1276, lng: 138.7559, formattedName: "十日町市" });
const YOKKAICHI = LOCF({ city: "四日市市", region: "三重縣", lat: 34.965, lng: 136.6245, formattedName: "四日市市" });
const FUTSUKAICHI = LOCF({ city: "筑紫野市", region: "福岡縣", sublocality: "二日市", lat: 33.4987, lng: 130.5197, formattedName: "二日市" });
const FX = { 福岡: FUKUOKA, 福岡市: FUKUOKA, 富良野: FURANO, 九份: JIUFEN, 十日町: TOKAMACHI, 新潟十日町: TOKAMACHI, 四日市: YOKKAICHI, 三重四日市: YOKKAICHI, 二日市: FUTSUKAICHI, 福岡二日市: FUTSUKAICHI };
/** r20 coordHits 只記錄用（不參與判定）。 */
const COORDS = { 金澤: { lat: 36.5613, lng: 136.6562 }, 京都: { lat: 35.0116, lng: 135.7681 }, 大阪: { lat: 34.6937, lng: 135.5023 }, 福岡: { lat: 33.5902, lng: 130.4017 }, 富良野: { lat: 43.3421, lng: 142.3832 }, 九份: { lat: 25.1092, lng: 121.8452 } };
/** R-9919 注入（INJECTED_STATE）：值同 mp25-r4 INIT_KYOTO_EXHAUSTED（L145）；京都 Places 回空（r15EmptyDest，r15 L198-199）→ 更多推薦無結果。 */
const INIT_KYOTO_EXHAUSTED = { topic: "attraction", rec: { destination: "京都", n: 3, batch: 3 }, travelDestination: "京都" };

// ════════════════ 情境（同一 Session 依序；除 INJECTED_STATE 兩案外，脈絡一律以正式對話回合建立）════════════════
const ANS_FURANO = { text: "富良野", onlyIfClarified: true }; // 「依提示回答」：只在上一輪實際進入澄清時送出（r13 既有 onlyIfClarified）
const RAW = [
  // ── 9.1／9.1b／9.1c 共用 ──
  ["A2S-P1-01", "去金澤玩，推薦咖啡廳 → 再推薦幾個（＝GP-01 句）", ["去金澤玩，推薦咖啡廳", "再推薦幾個"]],
  ["A2S-P1-05", "京都推薦景點 → 去金澤玩，再推薦幾個 → 再推薦幾個（＝GP-05 句＋第 3 輪供 (g) 延續）", ["京都推薦景點", "去金澤玩，再推薦幾個", "再推薦幾個"]],
  ["A2S-P1-02", "我想去福岡玩兩天 → 推薦咖啡廳 → 再推薦幾個", ["我想去福岡玩兩天", "推薦咖啡廳", "再推薦幾個"]],
  ["A2S-P1-03", "大阪推薦景點 → 不去大阪了，去京都玩 → 再推薦幾個", ["大阪推薦景點", "不去大阪了，去京都玩", "再推薦幾個"]],
  ["A2S-P1-NC", "去金澤玩推薦咖啡廳（無逗號）→ 再推薦幾個", ["去金澤玩推薦咖啡廳", "再推薦幾個"]],
  ["A2S-P1-KE", "去富良野玩推薦咖啡廳（無逗號，非本地）→ 依提示回答（富良野；onlyIfClarified）→ 再推薦幾個", ["去富良野玩推薦咖啡廳", ANS_FURANO, "再推薦幾個"]],
  ["A2S-FRN2-a", "富良野玩推薦咖啡廳 → 依提示回答 → 再推薦幾個", ["富良野玩推薦咖啡廳", ANS_FURANO, "再推薦幾個"]],
  ["A2S-FRN2-b", "去富良野玩兩天推薦咖啡廳 → 依提示回答 → 再推薦幾個", ["去富良野玩兩天推薦咖啡廳", ANS_FURANO, "再推薦幾個"]],
  ["A2S-B5-FRN", "去富良野玩，推薦咖啡廳 → 依提示回答 → 再推薦幾個", ["去富良野玩，推薦咖啡廳", ANS_FURANO, "再推薦幾個"]],
  ["A2S-NEG1-osaka", "大阪推薦景點 → 不想去金澤玩推薦別的", ["大阪推薦景點", "不想去金澤玩推薦別的"]],
  ["A2S-NEG1-kanazawa", "金澤推薦景點 → 不想去金澤玩推薦別的", ["金澤推薦景點", "不想去金澤玩推薦別的"]],
  ["A2S-NEG2", "我不想去東京玩，推薦其他城市", ["我不想去東京玩，推薦其他城市"]],
  ["A2S-NEG3", "別去大阪玩了，推薦別的地方", ["別去大阪玩了，推薦別的地方"]],
  ["A2S-NEG-NP", "不要去人多的地方推薦咖啡廳", ["不要去人多的地方推薦咖啡廳"]],
  ["A2S-GO-a", "京都推薦景點 → 去玩推薦咖啡廳", ["京都推薦景點", "去玩推薦咖啡廳"]],
  ["A2S-GO-b", "京都推薦景點 → 去玩，推薦咖啡廳", ["京都推薦景點", "去玩，推薦咖啡廳"]],
  ["A2S-TNM", "台南推薦景點 → 不想去台南夜市，推薦別的 → 再推薦幾個", ["台南推薦景點", "不想去台南夜市，推薦別的", "再推薦幾個"]],
  ["A2S-NEG-JF", "台南推薦景點 → 不想去九份，推薦別的（#99-8：9.1b R-T88-JF 附帶句；期望見 3.1 步驟 5／4.3 句表；前置脈絡為本檔選定，規格未指定）", ["台南推薦景點", "不想去九份，推薦別的"]],
  ["A2S-QC", "不想去人多的地方，推薦安靜咖啡廳", ["不想去人多的地方，推薦安靜咖啡廳"]],
  ["A2S-FAR", "不想去太遠的地方，推薦近一點的", ["不想去太遠的地方，推薦近一點的"]],
  ["A2S-OFF", "不去公司了，去咖啡廳", ["不去公司了，去咖啡廳"]],
  ["A2S-SWK", "大阪推薦景點 → 不想去大阪了，換金澤 → 再推薦幾個", ["大阪推薦景點", "不想去大阪了，換金澤", "再推薦幾個"]],
  ["A2S-TO1", "到金澤玩，推薦咖啡廳 → 再推薦幾個", ["到金澤玩，推薦咖啡廳", "再推薦幾個"]],
  ["A2S-TO2", "在金澤玩，推薦咖啡廳 → 再推薦幾個", ["在金澤玩，推薦咖啡廳", "再推薦幾個"]],
  ["A2S-TO3", "（獨立 Session）到金澤玩兩天 → 推薦咖啡廳 → 再推薦幾個", ["到金澤玩兩天", "推薦咖啡廳", "再推薦幾個"]],
  ["A2S-AROUND", "（獨立 Session，無 GPS、無前值目的地）到處玩，推薦咖啡廳 → 再推薦幾個（第 2 輪只供 I 欄下一輪起點）", ["到處玩，推薦咖啡廳", "再推薦幾個"]],
  ["A2S-2DS", "（獨立 Session）到二日市，推薦咖啡廳 → 再推薦幾個", ["到二日市，推薦咖啡廳", "再推薦幾個"]],
  ["A2S-JF", "去九份玩，推薦咖啡廳 → 再推薦幾個", ["去九份玩，推薦咖啡廳", "再推薦幾個"]],
  // ── 保護名單（各為獨立 Session 首句）──
  ["A2S-PROT-01", "台南小吃推薦", ["台南小吃推薦"]],
  ["A2S-PROT-02", "台南中西區", ["台南中西區"]],
  ["A2S-PROT-03", "東京新宿", ["東京新宿"]],
  ["A2S-PROT-04", "新潟十日町", ["新潟十日町"]],
  ["A2S-PROT-05", "三重四日市", ["三重四日市"]],
  ["A2S-PROT-06", "福岡二日市", ["福岡二日市"]],
  ["A2S-PROT-07", "去台南玩具博物館", ["去台南玩具博物館"]],
  ["A2S-PROT-08", "台中好吃的（9.1a 另附）", ["台中好吃的"]],
  ["A2S-PROT-09", "去十日町玩（9.1a／9.1b 另附）", ["去十日町玩"]],
  ["A2S-PROT-10", "去玩具博物館（9.1b 另附）", ["去玩具博物館"]],
  ["A2S-PROT-11", "到十日町，推薦咖啡廳（9.1c 另附）", ["到十日町，推薦咖啡廳"]],
  ["A2S-PROT-12", "到四日市，推薦咖啡廳（9.1c 另附）", ["到四日市，推薦咖啡廳"]],
  // ── 9.1c-2 記錄型（獨立 Session；第 2 輪「再推薦幾個」只供 I 欄）──
  ["A2S-REC-O13", "在金澤玩附近推薦咖啡廳 → 再推薦幾個", ["在金澤玩附近推薦咖啡廳", "再推薦幾個"]],
  ["A2S-REC-CHAIN", "到金澤玩逛逛 → 再推薦幾個", ["到金澤玩逛逛", "再推薦幾個"]],
  ["A2S-REC-TAILX", "金澤玩一下 → 再推薦幾個", ["金澤玩一下", "再推薦幾個"]],
  ["A2S-REC-TAILX-zai", "在金澤玩一下 → 再推薦幾個", ["在金澤玩一下", "再推薦幾個"]],
  // ── #97 新增：9.2 R-S1～S6 整合（句子＝scripts/verify-negated-switch-s1s4.mjs L239-244；脈絡以正式回合「大阪推薦景點」建立）──
  ["A2S-S1", "大阪推薦景點 → 我不想去大阪了，換金澤（＝s1s4 S1）", ["大阪推薦景點", "我不想去大阪了，換金澤"]],
  ["A2S-S2", "大阪推薦景點 → 那就不去大阪了，換金澤（＝s1s4 S2）", ["大阪推薦景點", "那就不去大阪了，換金澤"]],
  ["A2S-S3", "大阪推薦景點 → 不去大阪了，去金澤（＝s1s4 S3）", ["大阪推薦景點", "不去大阪了，去金澤"]],
  ["A2S-S4", "大阪推薦景點 → 我不想去大阪了，換金澤，再推薦幾個（＝s1s4 S4）", ["大阪推薦景點", "我不想去大阪了，換金澤，再推薦幾個"]],
  ["A2S-S5", "大阪推薦景點 → 大阪不去了，換金澤（＝s1s4 S5）", ["大阪推薦景點", "大阪不去了，換金澤"]],
  ["A2S-S6", "大阪推薦景點 → 不想去大阪了，換成金澤（＝s1s4 S6）", ["大阪推薦景點", "不想去大阪了，換成金澤"]],
  // ── #97 新增：9.3 NEGATED_UNCERTAIN／E0／Pending ──
  ["A2S-NU1", "大阪推薦景點 → 大阪不去了改天再說（R-NU-1）", ["大阪推薦景點", "大阪不去了改天再說"]],
  ["A2S-NU2", "大阪推薦景點 → 我不去了換金澤（R-NU-2）", ["大阪推薦景點", "我不去了換金澤"]],
  ["A2S-NU3", "大阪推薦景點 → 大阪不去了改天再說，再推薦幾個（R-NU-3：NEGATED_UNCERTAIN＋續推尾；句同 9.2 R-CTD1144）", ["大阪推薦景點", "大阪不去了改天再說，再推薦幾個"]],
  ["A2S-E0-yes", "大阪推薦景點 → 我不去了換金澤 → 對（R-E0-1）", ["大阪推薦景點", "我不去了換金澤", "對"]],
  ["A2S-E0-cancel", "大阪推薦景點 → 我不去了換金澤 → 取消（R-E0-2）", ["大阪推薦景點", "我不去了換金澤", "取消"]],
  ["A2S-E0-replace", "大阪推薦景點 → 我不去了換金澤 → 換富良野（R-E0-3）", ["大阪推薦景點", "我不去了換金澤", "換富良野"]],
  ["A2S-PEND4", "（INJECTED_STATE：r13 initKind legacyNearby＝legacy nearby destination_area pending）不去大阪了，換金澤（R-PEND-4）", ["不去大阪了，換金澤"], { initKind: "legacyNearby" }],
  ["A2S-9919", "（INJECTED_STATE：rec＝京都 3 筆已全顯示；京都 Places 回空）不去公司了，換咖啡廳（R-9919）", ["不去公司了，換咖啡廳"], { r15Init: INIT_KYOTO_EXHAUSTED, r15EmptyDest: ["京都"] }],
];
export const scenarios = RAW.map(([id, label, turns, extra]) => ({ id, label: `（A2 Source 情境）${label}`, turns, r15Modes: [OK], r15Real: FX, r19Coords: COORDS, ...(extra ?? {}) }));
export const ONLY_IDS = scenarios.map((s) => s.id).join(",");

// ════════════════ 欄位擷取（只讀 r13／r14／r15／r18／r20 既有 obs 欄位）════════════════
const pathOf = (t) => String(t?.path ?? "");
const isModel = (t) => /未重建/.test(pathOf(t));
/**
 * #99-4：r18 正式區塊記號（r18 R18_runBlock L401-411 執行擷取的 _app 正式原始碼後才附加；非執行不會出現）：
 *   |r18:destSwitch(real)        r18:273（destination_switch handler 正式區塊執行且取用分支 → return）
 *   |r18:fbContinue(real)=<值>   r18:319（applyLocalFallback continue if 正式區塊取用分支並回傳）
 *   |r18:refineMore(real)=T      r18:350（send() refinement MORE 正式區塊取用分支 → return）
 * 「=fallthrough」類（r18:322 fbContinue＝區塊回傳 not_taken 但其內有 Callback 呼叫；r18:350 refineMore＝route MORE 但區塊未取用）
 *   不計 ACTUAL_APP_CALLBACK（本回合結果非由正式區塊產生）；另以 R18_FALLTHRU_RE 判讀並註明。若 fallthrough 內確有正式 Callback 完成，
 *   r14 R14_onDone L689 會另附「|real:<x>=」→ 仍由該記號計 ACTUAL_APP_CALLBACK。
 * 注意：即使命中 r18 記號，該回合「進入正式區塊之前」的 send 路由仍為 r13 鏡像。
 */
const ACTUAL_RE = /\|real:(?:dc|more|refine|alt|dp|nearby)=|alternative_recommendations\(real\)|continuation:[^|]*\(real\)|\|r18:destSwitch\(real\)|\|r18:fbContinue\(real\)=(?!fallthrough)|\|r18:refineMore\(real\)=T/;
const R18_RE = /\|r18:(?:destSwitch\(real\)|fbContinue\(real\)=(?!fallthrough)|refineMore\(real\)=T)/;
const R18_FALLTHRU_RE = /\|r18:(?:fbContinue|refineMore)\(real\)=fallthrough/;
/** #99-4：回合證據附註（r18 正式區塊／fallthrough；send 路由仍為鏡像）。 */
const evNote = (t) => {
  const p = pathOf(t);
  const n = [];
  if (R18_RE.test(p)) n.push("含 r18 正式區塊記號；進入正式區塊前的 send 路由仍為 r13 鏡像");
  if (R18_FALLTHRU_RE.test(p)) n.push("r18 正式區塊 =fallthrough（未取用分支／結果非由該區塊產生；不計 ACTUAL_APP_CALLBACK）");
  return n.length ? `（${n.join("；")}）` : "";
};
const isInjected = (s) => Boolean(s?.r15Init || s?.initKind || s?.r18Init || s?.r18Pending);
/** 每回合證據分類（#97-1）。 */
const evOf = (t, s) => {
  if (!t) return EV.NR;
  if (t.error || pathOf(t) === "") return EV.UNV;
  if (isModel(t)) return EV.MODEL;
  if (isInjected(s)) return EV.INJ;
  return ACTUAL_RE.test(pathOf(t)) ? EV.CB : EV.MS;
};
const turnOf = (turns, i) => turns.find((x) => x.turnIndex === i) ?? null;
/** #99-7：「weather:」前綴＝r13 send 層 weather prefetch 的 geocode；正式 Callback 內的 weather geocode 不帶此前綴 → 計入其他 phase（非 weather 分項）。
 *  嚴格判定（geoZero／geoZeroAmb strict／geoNoBroken／geoOnlyAll）一律用全部 query，不受此分項影響。 */
const W_GEO = (g) => /^weather:/.test(String(g));
const qOf = (g) => String(g).split(":").slice(1).join(":");
const seg0 = (g) => qOf(g).split(",")[0].trim();
const ALIAS = { 金澤: ["金沢", "Kanazawa"], 京都: ["Kyoto"], 大阪: ["Osaka"], 福岡: ["Fukuoka"], 台南: ["臺南", "Tainan"], 富良野: ["Furano"], 九份: ["Jiufen"] };
const sameDest = (v, d) => v != null && (String(v).includes(d) || (ALIAS[d] ?? []).some((a) => String(v).includes(a)));
const J = (v) => JSON.stringify(v ?? null);
/** 回合完成後持久化 Session（r13 L2062-2092：harness persisted＝persistSession 寫入值）。 */
const F = {
  "location.city": (t) => t.sessionLocation?.city ?? null,
  preferredArea: (t) => t.sessionPreferredArea ?? null,
  "travelContext.destination": (t) => t.sessionDest ?? null,
  "tripPlanningContext.destination": (t) => t.sessionTripPlanningDest ?? null,
  tripDestination: (t) => t.sessionTripDestCity ?? t.sessionTripDestLabel ?? null,
  "pendingClarification.rawGeographicLabel": (t) => t.r18Pending?.rawGeographicLabel ?? t.sessionPendingLabel ?? null,
  "pendingClarification.kind": (t) => t.r18Pending?.kind ?? t.sessionPendingKind ?? null,
  "recommendationSession.destination": (t) => t.r15Rec?.destination ?? null,
};
/** 回合起點 Session（r20 obs.r20Start＝r20Proj(輪初 Session)；pendingClarification 不在投影內 → undefined）。 */
const FS = {
  "location.city": (s) => s?.location?.city ?? null,
  preferredArea: (s) => s?.preferredArea ?? null,
  "travelContext.destination": (s) => s?.tc?.destination ?? null,
  "tripPlanningContext.destination": (s) => s?.tpc?.destination ?? null,
  tripDestination: (s) => s?.trip?.city ?? s?.trip?.displayLabel ?? null,
  "recommendationSession.destination": (s) => s?.rec?.destination ?? null,
};
const SESSION_FIELDS = ["location.city", "preferredArea", "travelContext.destination", "tripPlanningContext.destination", "tripDestination", "pendingClarification.rawGeographicLabel"];
const TRUST_FIELDS = ["travelContext.destination", "tripPlanningContext.destination", "recommendationSession.destination"];
const geoAll = (t) => t.geocodes ?? [];
// #99-7：geoW＝send 層 weather prefetch；geoNonW＝其他 phase（含正式 Callback 內的 weather geocode）
const geoNonW = (t) => geoAll(t).filter((g) => !W_GEO(g));
const geoW = (t) => geoAll(t).filter(W_GEO);
const topFlows = (t) => (t.r15Flows ?? []).filter((f) => !f.nested);
const cards = (t) => t.r15Cards ?? [];
const cr = (t) => {
  const rpc = t.creditsRpc ?? [];
  const n = (k) => rpc.filter((x) => x === k).length;
  return { reserve: n("credits_reserve"), commit: n("credits_commit"), rollback: n("credits_rollback"), check: n("credits_check"), begin: (t.r15Credits ?? []).map((c) => c.destination ?? null), settle: t.creditsSettle ?? [], rpc };
};
const fmtCr = (c) => `begin=${J(c.begin)} rpc=[${c.rpc.join(",")}] reserve=${c.reserve} commit=${c.commit} rollback=${c.rollback} settle=${J(c.settle)}`;
/** Provider 分項（#97-3）：weather prefetch 的 geocode 計入 Geocoding；Weather＝fetchWeather 呼叫數（r13 obs.weatherCalls）。 */
const prov = (t) => {
  const c = cr(t);
  return { geo: geoAll(t).length, geoNonW: geoNonW(t).length, geoW: geoW(t).length, weather: t.weatherCalls ?? 0, places: t.placesRequests ?? 0, begin: c.begin.length, check: c.check, reserve: c.reserve, commit: c.commit, rollback: c.rollback };
};
const fmtProv = (p) => `Geocoding=${p.geo}（其中 send 層 weather prefetch ${p.geoW}、其他 phase ${p.geoNonW}［含正式 Callback 內 weather geocode］） Weather=${p.weather} Places=${p.places} Credits[begin=${p.begin} check=${p.check} reserve=${p.reserve} commit=${p.commit} rollback=${p.rollback}]`;
const PROV0 = { geo: 0, geoNonW: 0, geoW: 0, weather: 0, places: 0, begin: 0, check: 0, reserve: 0, commit: 0, rollback: 0 };
const sumProv = (turns) => turns.map(prov).reduce((a, b) => Object.fromEntries(Object.keys(PROV0).map((k) => [k, a[k] + b[k]])), PROV0);
const ENTRY = {
  dc: (t) => /\|real:dc=/.test(pathOf(t)),
  more: (t) => /\|real:more=/.test(pathOf(t)),
  moreF: (t) => /\|real:more=F/.test(pathOf(t)),
  clarify: (t) => Boolean(t.clarified) || F["pendingClarification.kind"](t) === "destination_area",
  real: (t) => !isModel(t) && ACTUAL_RE.test(pathOf(t)), // #97（T96-4）：必須有正式 Callback／區塊執行記號，否則不得印入口 PASS
  send: (t) => !isModel(t) && pathOf(t) !== "" && !t.error, // r13 鏡像 send 已執行（MIRRORED_SEND；不代表正式 Callback）
  e1pend: (t) => F["pendingClarification.kind"](t) === "destination_switch" && F["pendingClarification.rawGeographicLabel"](t) === "金澤",
  legacyPend: (t) => t.pendingAtStartLegacy === true,
};
const ENTRY_TAG_KEYS = ["dc", "more", "clarify", "real", "send", "e1pend", "legacyPend"];
const entryTags = (t) => [...ENTRY_TAG_KEYS.filter((k) => ENTRY[k](t)), ...(isModel(t) ? ["MODEL"] : [])].join("+") || "-";
const prevVal = (turns, i, field) => {
  const p = turns.filter((x) => x.turnIndex < i).sort((a, b) => b.turnIndex - a.turnIndex)[0];
  if (p) return F[field](p);
  const t = turnOf(turns, i);
  if (!t?.r20Start || !FS[field]) return undefined;
  return FS[field](t.r20Start);
};
const provenBy = (turns, i, d) =>
  turns.filter((x) => x.turnIndex <= i).some((x) => (x.r15Geo ?? []).some((g) => seg0(`x:${g.q}`) === d && g.outcome === "ok"));

// ════════════════ 檢查構件（每個回傳 [判定, 實際值]）════════════════
/** turn：回合 index（0 起）；"*"＝整個情境；opt＝回合因 onlyIfClarified 未送出時記 N/A（不是 NOT-REACHED）。amb：weather 待裁決雙版本（strict 計入、loose 只對照）。 */
const ck = (turn, label, fn, opt = false, amb = null) => ({ turn, label, fn, opt, amb });
const eqF = (i, f, want, opt = false) => ck(i, `${f} ＝ ${J(want)}`, (t) => [F[f](t) === want ? P : FAIL, J(F[f](t))], opt);
const notHasF = (i, fields, subs, { bad = [], noEmpty = false } = {}, opt = false) =>
  ck(
    i,
    `${fields.join("／")} 不含 ${subs.map((x) => `「${x}」`).join("")}${bad.length ? `、不得等於 ${bad.map((x) => `「${x}」`).join("")}` : ""}${noEmpty ? "、不得為空字串" : ""}`,
    (t) => {
      const hit = [];
      for (const f of fields) {
        const v = F[f](t);
        if (v == null) continue;
        const s = String(v);
        if (subs.some((x) => s.includes(x)) || bad.includes(s) || (noEmpty && s === "")) hit.push(`${f}=${J(v)}`);
      }
      return [hit.length ? FAIL : P, hit.join(",") || "乾淨"];
    },
    opt,
  );
const inPrevOr = (i, f, allowed, forbid = [], opt = false) =>
  ck(
    i,
    `${f} ∈ {回合起點值, ${allowed.join(", ")}}，不得為 ${[...forbid, ""].map((x) => `「${x}」`).join("")}`,
    (t, c) => {
      const v = F[f](t);
      const pv = prevVal(c.turns, i, f);
      if (v === "" || forbid.includes(v)) return [FAIL, `${J(v)}（起點 ${J(pv)}）`];
      if (allowed.includes(v)) return [P, J(v)];
      if (pv === undefined) return [UNV, `${J(v)}（回合起點值無記錄）`];
      return [v === pv ? P : FAIL, `${J(v)}（起點 ${J(pv)}）`];
    },
    opt,
  );
const unchangedF = (i, f) =>
  ck(i, `${f} 與回合起點相同（Session 目的地不變）`, (t, c) => {
    const pv = prevVal(c.turns, i, f);
    const v = F[f](t);
    if (pv === undefined) return [UNV, `${J(v)}（回合起點值無記錄）`];
    return [v === pv ? P : FAIL, `${J(pv)} → ${J(v)}`];
  });
const blF = (i, f) => ck(i, `${f}（與 r5 逐字比對：本次記錄）`, (t) => [BL, J(F[f](t))]);
/** 規格原文明示「任何 query／geocode＝0／0 geocode／0 付費」→ 含 weather 階段（#97-3；T96-2）。 */
const geoZero = (i, why, opt = false) =>
  ck(i, `Geocoding 全部 query 0 次（含 send 層 weather prefetch 與正式 Callback 內 weather；規格原文「${why}」→ 含 weather）`, (t) => [geoAll(t).length ? FAIL : P, `全部=${J(geoAll(t))}（send 層 weather prefetch ${geoW(t).length}）`], opt);
/** 規格原文只寫「0 Provider（本地）」→ 是否含 weather prefetch 未明：兩版都印；判定只採含 weather 版（不自行選寬鬆版）。 */
const geoZeroAmb = (i, why, opt = false) => [
  ck(i, `［weather 待裁決｜含 weather 版：計入判定］Geocoding 全部 query 0 次（規格原文「${why}」未明示是否含 weather prefetch）`, (t) => [geoAll(t).length ? FAIL : P, `全部=${J(geoAll(t))}`], opt, "strict"),
  ck(i, `［weather 待裁決｜不含 send 層 weather prefetch 版：只供指派者裁決，不計入］Geocoding 其他 phase（含正式 Callback 內 weather geocode）0 次`, (t) => [geoNonW(t).length ? FAIL : P, `其他 phase=${J(geoNonW(t))}；send 層 weather prefetch=${J(geoW(t))}`], opt, "loose"),
];
/** 已執行的所有 geocode query（含 weather 階段）不得含殘破字串；命中一律 FAIL（不得 UNVERIFIED）。 */
const geoNoBroken = (i, subs, exact = [], opt = false) =>
  ck(
    i,
    `Geocoding 全部 query（含 send 層 weather prefetch；逗號前地名段）不含 ${subs.map((x) => `「${x}」`).join("")}${exact.length ? `、不得等於 ${exact.map((x) => `「${x}」`).join("")}` : ""}`,
    (t) => {
      const bad = geoAll(t).filter((g) => subs.some((x) => seg0(g).includes(x)) || exact.includes(seg0(g)));
      return [bad.length ? FAIL : P, `${bad.length ? `殘破=${J(bad)}；` : ""}全部=${J(geoAll(t))}`];
    },
    opt,
  );
/** 整個情境 Geocoding（全部 query，含 weather 階段；weather 另列）只可能為 allowed 且合計 ≤max（T96-1）。 */
const geoOnlyAll = (allowed, max) =>
  ck("*", `整個情境 Geocoding 全部 query（含 send 層 weather prefetch）只可能為 ${allowed.map((x) => `「${x}」`).join("")}，合計 ≤${max}`, (_t, c) => {
    const all = c.turns.flatMap((t) => geoAll(t).map((g) => `T${t.turnIndex + 1}:${g}`));
    const raw = (g) => g.replace(/^T\d+:/, "");
    const bad = all.filter((g) => !allowed.includes(seg0(raw(g))));
    const w = all.filter((g) => W_GEO(raw(g)));
    return [bad.length || all.length > max ? FAIL : P, `合計=${all.length} 全部=${J(all)}；其中 send 層 weather prefetch=${J(w)}`];
  });
const placesZero = (i, opt = false) => ck(i, "Places 0 次", (t) => [(t.placesRequests ?? 0) === 0 ? P : FAIL, `${t.placesRequests ?? 0} ${J(t.placesQueries ?? [])}`], opt);
const placesDest = (i, d, opt = false) =>
  ck(
    i,
    `Places 呼叫目的地＝${d}（Harness 只有 query@destinationName；center 見「未記錄必要欄位」）`,
    (t) => {
      const q = t.placesQueries ?? [];
      const bad = q.filter((x) => !sameDest(String(x).split("@").at(-1), d));
      return [bad.length ? FAIL : P, `${q.length} 次 ${J(q.slice(0, 6))}`];
    },
    opt,
  );
const reserveZero = (i, opt = false) => ck(i, "Credits reserve 0（begin 0 且 credits_reserve 0）", (t) => [cr(t).reserve === 0 && cr(t).begin.length === 0 ? P : FAIL, fmtCr(cr(t))], opt);
const oneSettle = (i, d, opt = false) =>
  ck(
    i,
    `Credits 一次結算（credits_reserve 1、credits_commit 1、rollback 0、begin 1 且 metadata.destination＝${d}；requestId 見「未記錄必要欄位」）`,
    (t) => {
      const c = cr(t);
      const hasRpc = c.rpc.some((x) => /^credits_/.test(x));
      if (!hasRpc && c.begin.length === 1 && c.settle.length === 1 && c.settle[0] === true && sameDest(c.begin[0], d)) return [UNV, `${fmtCr(c)}（無 credits_* RPC 記錄，只有 begin／settle）`];
      const ok = c.reserve === 1 && c.commit === 1 && c.rollback === 0 && c.begin.length === 1 && sameDest(c.begin[0], d);
      return [ok ? P : FAIL, fmtCr(c)];
    },
    opt,
  );
const creditsNoCity = (i, city) => ck(i, `Credits 無舊城市「${city}」扣點`, (t) => [cr(t).begin.some((x) => sameDest(x, city)) ? FAIL : P, fmtCr(cr(t))]);
const cardsAny = (i) => ck(i, "有推薦卡片（推薦流程照舊）", (t) => [cards(t).length ? P : FAIL, `${cards(t).length} 張`]);
const cardsNone = (i) => ck(i, "無推薦卡片", (t) => [cards(t).length ? FAIL : P, `${cards(t).length} 張`]);
const pushZero = (i) => ck(i, "push* spy＝0（本回合無正式 Callback 執行；obs.r14Calls 為空，r14 L688）", (t) => [(t.r14Calls ?? []).length ? FAIL : P, J(t.r14Calls ?? [])]);
const pendNot = (i, kind, raw) =>
  ck(i, `pendingClarification 不是 ${kind}${raw ? `:${raw}` : ""}（已消費／已清除、不恢復）`, (t) => {
    const k = F["pendingClarification.kind"](t);
    const r = F["pendingClarification.rawGeographicLabel"](t);
    return [k === kind && (raw == null || r === raw) ? FAIL : P, `${J(k)}:${J(r)}`];
  });
const scopeCk = (i, d, src, opt = false) =>
  ck(
    i,
    `Search Scope＝${d}（可信判定 destination／recommendationSession.destination）${src ? `、centerSource＝${src}` : ""}`,
    (t) => {
      const rec = t.r15Rec;
      const fl = topFlows(t).filter((f) => f.status === "trusted");
      const got = `rec=${J(rec ? { destination: rec.destination, searchScope: rec.searchScope, parentCity: rec.parentCity, area: rec.area } : null)} trusted=${J(fl.map((f) => `${f.fn}:${f.label}→${f.destination}/${f.centerSource ?? "-"}`))}`;
      if (fl.some((f) => !sameDest(f.destination, d))) return [FAIL, got];
      if (rec?.destination != null && !sameDest(rec.destination, d)) return [FAIL, got];
      if (!fl.length) return [(t.placesRequests ?? 0) > 0 ? FAIL : UNV, `${got}${(t.placesRequests ?? 0) > 0 ? "（Places>0 但本輪無可信判定記錄）" : "（本輪無可信判定記錄）"}`];
      if (src && !fl.some((f) => f.centerSource === src)) return [fl.some((f) => f.centerSource) ? FAIL : UNV, got];
      return [P, got];
    },
    opt,
  );
const trustedBeforePlaces = (i, d, opt = false) =>
  ck(
    i,
    `Places 只在可信「${d}」之後（本輪 Places>0 → 本輪必有 trusted ${d}）`,
    (t) => {
      if ((t.placesRequests ?? 0) === 0) return [P, "0 Places"];
      const fl = topFlows(t).filter((f) => f.status === "trusted" && sameDest(f.destination, d));
      return [fl.length ? P : FAIL, `places=${t.placesRequests} trusted=${J(fl.map((f) => `${f.fn}→${f.destination}`))}`];
    },
    opt,
  );
const clarifyCost = (i, opt = false) =>
  ck(
    i,
    "若本回合為澄清回合（destination_area pending／clarified）→ Places 0、reserve 0",
    (t) => {
      if (!ENTRY.clarify(t)) return [P, "非澄清回合（N/A）"];
      const c = cr(t);
      return [(t.placesRequests ?? 0) === 0 && c.reserve === 0 && c.begin.length === 0 ? P : FAIL, `places=${t.placesRequests ?? 0} ${fmtCr(c)}`];
    },
    opt,
  );
/** 9.1 (a)／9.1b ①（T96-1）：destination_area 澄清且標籤＝d，或經 Provider 身分證據後 trusted d。 */
const clarOrTrusted = (i, d) =>
  ck(i, `(a)／① 本回合進 destination_area 澄清且標籤＝${d}，或經 Provider 證據（r15Geo「${d}」outcome=ok）後 trusted ${d}`, (t, c) => {
    const kind = F["pendingClarification.kind"](t);
    const raw = F["pendingClarification.rawGeographicLabel"](t);
    const clar = (kind === "destination_area" && raw === d) || (Boolean(t.clarified) && t.clarificationLabel === d);
    const tr = topFlows(t).some((f) => f.status === "trusted" && sameDest(f.destination, d));
    const pv = provenBy(c.turns, i, d);
    return [clar || (tr && pv) ? P : FAIL, `clarified=${Boolean(t.clarified)} clarificationLabel=${J(t.clarificationLabel)} pending=${J(kind)}:${J(raw)} trusted=${tr} provider=${pv}`];
  });
/** 9.1 (c)（T96-1：pending 為空不得逕判 PASS）：有 pending → 須＝want；無 pending → 只在 (a) 的 trusted＋Provider 分支成立時 PASS（(c) 不適用），否則 FAIL。 */
const pendRawFirst = (i, want) =>
  ck(i, `(c) pendingClarification.rawGeographicLabel＝${J(want)}（澄清分支）；pending 為空時必須是 Provider 證據後 trusted ${want}（否則 FAIL）`, (t, c) => {
    const v = F["pendingClarification.rawGeographicLabel"](t);
    if (v != null) return [v === want ? P : FAIL, `${J(F["pendingClarification.kind"](t))}:${J(v)}`];
    const tr = topFlows(t).some((f) => f.status === "trusted" && sameDest(f.destination, want));
    const pv = provenBy(c.turns, i, want);
    return [tr && pv ? P : FAIL, `pending 為空；trusted=${tr} provider=${pv}${tr && pv ? "（trusted 分支，(c) 不適用）" : "（既無澄清亦無可信判定）"}`];
  });
/** 回答回合：pending 若存在須＝want；為空只在前一回合確有 want 澄清（已消費）時成立。 */
const pendRawAnswer = (i, want) =>
  ck(
    i,
    `回答回合 pendingClarification.rawGeographicLabel：若存在須＝${J(want)}；為空只在前一回合 pending＝${J(want)}（已消費）時成立`,
    (t, c) => {
      const v = F["pendingClarification.rawGeographicLabel"](t);
      if (v != null) return [v === want ? P : FAIL, `${J(F["pendingClarification.kind"](t))}:${J(v)}`];
      const p = turnOf(c.turns, i - 1);
      const pv = p ? F["pendingClarification.rawGeographicLabel"](p) : null;
      return [pv === want ? P : FAIL, `本回合 pending 為空；前一回合 pending=${J(pv)}`];
    },
    true,
  );
const cont = (i, d) =>
  ck(i, `下一輪延續：「再推薦幾個」走正式 more／dc（|real:）、有卡片、recommendationSession.destination＝${d}`, (t) => {
    const ok = !isModel(t) && (ENTRY.more(t) || ENTRY.dc(t)) && cards(t).length > 0 && sameDest(F["recommendationSession.destination"](t), d);
    return [ok ? P : FAIL, `入口=${entryTags(t)} cards=${cards(t).length} rec=${J(F["recommendationSession.destination"](t))}`];
  });
const startClean = (i, subs) =>
  ck(i, `下一輪起點 Session（r20Start）不含 ${subs.map((x) => `「${x}」`).join("")}`, (t) => {
    const s = t.r20Start;
    if (!s) return [UNV, "無 r20Start"];
    const str = J({ ...s, lastAssistantReply: undefined });
    const hit = subs.filter((x) => str.includes(x));
    return [hit.length ? FAIL : P, hit.length ? `命中 ${hit.join(",")}` : "乾淨"];
  });
/** 寫入「X」時須已有 Provider 驗證（r15Geo outcome=ok 的同名 query 或 trusted flow），否則未經 Provider 不成可信（ctd:211-217）。 */
const trustedOnlyAfterProvider = (d) =>
  ck("*", `可信欄位（${TRUST_FIELDS.join("／")}）出現「${d}」之前必須已有 Provider 成功驗證或 trusted 判定`, (_t, c) => {
    let proven = false;
    const bad = [];
    for (const t of [...c.turns].sort((a, b) => a.turnIndex - b.turnIndex)) {
      if ((t.r15Geo ?? []).some((g) => seg0(`x:${g.q}`) === d && g.outcome === "ok") || topFlows(t).some((f) => f.status === "trusted" && sameDest(f.destination, d))) proven = true;
      for (const f of TRUST_FIELDS) if (F[f](t) === d && !proven) bad.push(`T${t.turnIndex + 1} ${f}`);
    }
    return [bad.length ? FAIL : P, bad.join(",") || (proven ? "已驗證" : "未寫入")];
  });
/** R-B5-TO3 H（T96-8）：第一句「若未進推薦流程」才要求 0 Places／0 reserve；已進推薦流程（有卡片）→ 實際流程逐字記錄（BASELINE）。 */
const firstTurnNoRec = (i) =>
  ck(i, "H 第一句：若未進推薦流程（無卡片）→ Places 0、reserve 0；若已進推薦流程 → 實際流程逐字記錄（BASELINE，規格未設期望）", (t) => {
    const c = cr(t);
    if (cards(t).length > 0) return [BL, `已進推薦流程：入口=${entryTags(t)} cards=${cards(t).length} places=${t.placesRequests ?? 0} ${fmtCr(c)}`];
    return [(t.placesRequests ?? 0) === 0 && c.reserve === 0 && c.begin.length === 0 ? P : FAIL, `未進推薦流程：places=${t.placesRequests ?? 0} ${fmtCr(c)}`];
  });
const unv = (label, why) => ck("-", label, () => [UNV, why]);

/** 規格要求、但 Harness 未記錄的觀測欄位（#97-6；r13／r14 受 sha 綁定不得修改 → UNVERIFIED，不得偽造）。 */
const NEED = {
  requestId: unv("Credits requestId 一致（9.1 (f)／9.1b ⑥／9.1c H／9.1c-1 #7）", "r14:441 R14_rpc 保存 {name,args}，但 r14:806 obs.creditsRpc 只輸出 RPC 名稱；r15／r20 未再輸出 args → 未記錄"),
  scopeId: unv("Search Scope destinationScopeId（9.1 (d)／9.1c-1 #4）", "r13～r21 任何 obs 欄位皆未記錄 destinationScopeId／scopeId（r13 L2062-2096 只取 travelContext.destination／City／Region／Country）"),
  scopeCountry: unv("Search Scope country＝JP（9.1c-1 #4）", "r14:535 trust 記錄只有 destination／center／area／status／reason；r15:431-440 flow 只有 centerSource；Scope 國家未記錄（Session travelContext.destinationCountry 另列，非 Scope 國家）"),
  placesCenter: unv("Places 呼叫 center／city 來自 trusted scope（9.1 (e)／9.1b ⑤／9.1c H／9.1c-1 #6）", "r13:760 placesReqs 只記 query／destinationName／cacheCity／mode，obs.placesQueries（r13:2056）只輸出 query@destinationName；無 lat／lng。間接：r14:752-753 Builder 中心≠可信中心會列入 r14Violations（逐回合另印）"),
};
const N91 = ["scopeId", "placesCenter", "requestId"];
const N91B = ["placesCenter", "requestId"];
const N91C1 = ["scopeId", "scopeCountry", "placesCenter", "requestId"];

// 共用組合
const recSet = (i, d, broken, local) => [
  eqF(i, "travelContext.destination", d),
  notHasF(i, SESSION_FIELDS, broken),
  ...(local ? geoZeroAmb(i, "本地 → 0 Provider") : []),
  geoNoBroken(i, broken),
  scopeCk(i, d, local ? "authority" : null),
  placesDest(i, d),
  cardsAny(i),
  oneSettle(i, d),
];
const contSet = (i, d, broken, local) => [cont(i, d), notHasF(i, SESSION_FIELDS, broken), startClean(i, broken), ...(local ? geoZeroAmb(i, "本地 → 0 Provider") : []), geoNoBroken(i, broken), placesDest(i, d), oneSettle(i, d)];
const KZ_B = ["金澤玩", "去金澤", "到金澤", "在金澤"];
const FK_B = ["福岡玩", "玩兩天"];
const KY_B = ["京都玩", "大阪了", "不去大阪"];
const FR_B = ["富良野玩", "去富良野"];
const JF_B = ["九份玩", "去九份"];
const SW_B = ["大阪了", "不去", "不想", "那就", "換金澤", "換成", "去金澤", "金澤，", "再推薦"];
const premiseFRN = { entries: [{ turn: 0, kind: "clarify|dc" }], internal: "dtp:398-399 拆解；destination-resolution.ts:274 provisional_fragment；若可達之 :9387 cpf（皆無 spy）" };
const frnSet = (broken) => [
  clarOrTrusted(0, "富良野"),
  pendRawFirst(0, "富良野"),
  pendRawAnswer(1, "富良野"),
  ...[0, 1, 2].map((i) => inPrevOr(i, "preferredArea", ["富良野"], ["富良野玩", "去富良野玩", "富良野玩兩天", "去富良野玩兩天"], i === 1)),
  ...[0, 1, 2].map((i) => notHasF(i, SESSION_FIELDS, broken, {}, i === 1)),
  ...[0, 1, 2].map((i) => geoNoBroken(i, broken, [], i === 1)),
  geoOnlyAll(["富良野"], 1),
  ...[0, 1, 2].map((i) => trustedBeforePlaces(i, "富良野", i === 1)),
  clarifyCost(0),
  clarifyCost(1, true),
  trustedOnlyAfterProvider("富良野"),
  startClean(2, broken),
];
const to9 = () => [
  ...[0, 1].flatMap((i) => [
    eqF(i, "location.city", "金澤"),
    eqF(i, "preferredArea", "金澤"),
    eqF(i, "travelContext.destination", "金澤"),
    ck(i, "#3 travelContext.destinationCountry（Authority 國家 JP；Harness obs.sessionCtxCountry＝Session 欄位）", (t) => [t.sessionCtxCountry == null ? UNV : /^(日本|JP)$/.test(String(t.sessionCtxCountry)) ? P : FAIL, J(t.sessionCtxCountry)]),
    scopeCk(i, "金澤", "authority"),
    geoZero(i, i === 0 ? "9.1c-1 #5：任何 query → FAIL" : "9.1c-1 #5 任何 query／#9 不重新 geocode"),
    geoNoBroken(i, ["金澤玩", "到金澤", "在金澤"]),
    placesDest(i, "金澤"),
    oneSettle(i, "金澤"),
    notHasF(i, ["location.city", "preferredArea", "travelContext.destination", "tripPlanningContext.destination", "tripDestination"], KZ_B),
    ck(i, "#8 tripPlanningContext.destination ∈ {null, 金澤}、tripDestination ∈ {null, 含金澤}（彼此不矛盾）", (t) => {
      const a = F["tripPlanningContext.destination"](t);
      const b = F.tripDestination(t);
      return [(a == null || a === "金澤") && (b == null || sameDest(b, "金澤")) ? P : FAIL, `tpc=${J(a)} trip=${J(b)}`];
    }),
  ]),
  cont(1, "金澤"),
  startClean(1, KZ_B),
];

// ════════════════ 案例（規格 ID → 情境；同一情境可承載多個規格 ID：規格 9.1b「重疊者共用同一次執行」）════════════════
const C = [];
const add = (o) => C.push({ unv: [], need: [], ...o });
// ── 9.1 ──
add({ id: "R-P1-01", g: "9.1", sid: "A2S-P1-01", spec: "CB＋MOCK", need: N91, expect: "(a) 金澤 (b) 無「金澤玩」query、本地 0 Provider (c)～(g) 共同欄", r5: "r5 FAIL → 須轉 PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "dtp:421-431 尾字判定被呼叫（無 spy）" }, checks: [...recSet(0, "金澤", KZ_B, true), ...contSet(1, "金澤", KZ_B, true)] });
add({ id: "R-P1-05", g: "9.1", sid: "A2S-P1-05", spec: "CB＋MOCK", need: N91, expect: "(a) 金澤、不落回京都 (b) 無「金澤玩」 (f) 一次結算；(g) 第 3 輪延續", r5: "r5 FAIL → 須轉 PASS", premise: { entries: [{ turn: 1, kind: "more" }], internal: null }, checks: [...recSet(1, "金澤", KZ_B, true), notHasF(1, ["preferredArea", "travelContext.destination", "location.city"], ["京都"]), ...contSet(2, "金澤", KZ_B, true)] });
add({ id: "R-P1-02", g: "9.1", sid: "A2S-P1-02", spec: "CB＋MOCK", need: N91, expect: "(a) 福岡 (b)(c) 無「福岡玩」「福岡玩兩天」「玩兩天」（天數 2 保留）", r5: "r5 FAIL → 須轉 PASS", premise: { entries: [{ turn: 1, kind: "dc" }], internal: "tpc:756 withDays；tpc:146-153 split 被呼叫（無 spy）" }, checks: [notHasF(0, SESSION_FIELDS, FK_B), geoNoBroken(0, FK_B), ...recSet(1, "福岡", FK_B, false), ...contSet(2, "福岡", FK_B, false)], unv: [unv("天數 2 保留", "obs 無 tripPlanningContext 天數欄（r20Proj 只投影地理鍵）")] });
add({ id: "R-P1-03", g: "9.1", sid: "A2S-P1-03", spec: "CB＋MOCK", need: N91, expect: "(a) 京都 (b)(c) 無「京都玩」「大阪了」、大阪不回寫 (f) reset 1 次、無舊城市扣點", r5: "r5 FAIL → 須轉 PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: "turnSwitch＝CONFIRMED(local)、form＝extended（無 spy）" }, checks: [eqF(1, "travelContext.destination", "京都"), notHasF(1, SESSION_FIELDS, [...KY_B, "大阪"]), geoNoBroken(1, KY_B), creditsNoCity(1, "大阪"), ...contSet(2, "京都", [...KY_B, "大阪"], false), creditsNoCity(2, "大阪")], unv: [unv("reset 1 次", "trip-planning-session-reset 無 spy")] });
add({ id: "R-P1-NC", g: "9.1", sid: "A2S-P1-NC", spec: "CB＋MOCK（另附 MODEL；MODEL 不收）", need: N91, expect: "(a) 金澤 (b) 無「金澤玩」「去金澤玩」、0 Provider (c) 無殘破 pending", r5: "r5 FAIL → 須轉 PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "tpc fallback 觸發（3.5 步驟 4.3；無 spy）" }, checks: [...recSet(0, "金澤", KZ_B, true), ...contSet(1, "金澤", KZ_B, true)] }); // (c) 殘破 pending：recSet 的 SESSION_FIELDS 已含 pendingClarification.rawGeographicLabel
add({ id: "R-P1-KE", g: "9.1", sid: "A2S-P1-KE", spec: "CB＋MOCK（另附 MODEL；MODEL 不收）", need: N91, expect: "(a) destination_area 澄清（標籤富良野）或 Provider 證據後 trusted 富良野 (b) query 只可能「富良野」≤1（含 weather） (c) pending raw＝富良野 (e) trusted 後才 Places (f) 澄清回合 0 reserve；(g) 第 3 輪延續富良野", r5: "r5 FAIL → 須轉 PASS", premise: premiseFRN, checks: [...frnSet(FR_B), cont(2, "富良野")] });
// ── 9.1a ──
for (const [sid, ctxNote] of [["A2S-NEG1-osaka", "大阪脈絡"], ["A2S-NEG1-kanazawa", "金澤脈絡"]]) {
  add({ id: `R-NEG-1（${ctxNote}）`, g: "9.1a", sid, spec: "CB＋MOCK", expect: "不得視為已確認前往金澤；E1 提問；geocode／Places／reserve＝0；Session 目的地不變", r5: "r5 記錄（推定 FAIL）→ 須 PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: "matchLeadingNegatedClause form＝negated_only；turnSwitch＝NEGATED_UNCERTAIN（無 spy；:8009 關卡在 _app send 層，Harness 為鏡像）" }, checks: [geoZero(1, "geocode／Places／reserve＝0"), placesZero(1), reserveZero(1), cardsNone(1), unchangedF(1, "travelContext.destination"), unchangedF(1, "recommendationSession.destination"), ...(sid.endsWith("osaka") ? [notHasF(1, SESSION_FIELDS, ["金澤"])] : [])], unv: [unv("E1 提問文案", "無既有 E1 文案鍵可比對；助理訊息逐字記錄於回合列")] });
}
add({ id: "R-NEG-2", g: "9.1a", sid: "A2S-NEG2", spec: "CB＋MOCK", expect: "同 R-NEG-1（東京）", r5: "r5 記錄 → 須 PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal: "negated_only；NEGATED_UNCERTAIN（無 spy）" }, checks: [geoZero(0, "geocode／Places／reserve＝0"), placesZero(0), reserveZero(0), unchangedF(0, "travelContext.destination"), notHasF(0, SESSION_FIELDS, ["東京"])], unv: [unv("E1 提問文案", "同 R-NEG-1")] });
add({ id: "R-NEG-3", g: "9.1a", sid: "A2S-NEG3", spec: "CB＋MOCK", expect: "同 R-NEG-1（大阪）", r5: "r5 記錄 → 須 PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal: "negated_only；NEGATED_UNCERTAIN（無 spy）" }, checks: [geoZero(0, "geocode／Places／reserve＝0"), placesZero(0), reserveZero(0), unchangedF(0, "travelContext.destination"), notHasF(0, SESSION_FIELDS, ["大阪"])], unv: [unv("E1 提問文案", "同 R-NEG-1")] });
add({ id: "R-NEG-SW", g: "9.1a", sid: "A2S-P1-03", spec: "同 R-P1-03（共用執行）", expect: "仍為 CONFIRMED 京都（不得被 negated_only 誤擋）", r5: "同 R-P1-03", premise: { entries: [{ turn: 1, kind: "send" }], internal: "form＝extended（無 spy）" }, checks: [eqF(1, "travelContext.destination", "京都"), notHasF(1, SESSION_FIELDS, ["大阪"])] });
add({ id: "R-NEG-NP", g: "9.1a", sid: "A2S-NEG-NP", spec: "CB", expect: "NO_SWITCH 原流程（W13），不退步", r5: "不退步（r5 記錄）", premise: { entries: [{ turn: 0, kind: "send" }], internal: "negated_only、X 非地名（無 spy）" }, checks: [notHasF(0, SESSION_FIELDS, ["人多的地方", "人多"]), blF(0, "travelContext.destination"), ck(0, "原流程（path／卡片／Credits；與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} ${fmtCr(cr(t))}`])] });
// ── 9.1b ──
add({ id: "R-T88-GP01", g: "9.1b", sid: "A2S-P1-01", spec: "CB＋MOCK", need: N91B, expect: "① 金澤 ② preferredArea＝金澤（非「金澤玩」）④ 0 Provider", r5: "r5 預期 ② FAIL → PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "_app:9387 cpf 執行；dtp:421-431（無 spy）" }, checks: [eqF(0, "travelContext.destination", "金澤"), eqF(0, "preferredArea", "金澤"), eqF(1, "preferredArea", "金澤"), notHasF(0, SESSION_FIELDS, KZ_B), ...geoZeroAmb(0, "④ 0 Provider（本地）"), ...geoZeroAmb(1, "④ 0 Provider（本地）"), cont(1, "金澤")] });
add({ id: "R-T88-GP05", g: "9.1b", sid: "A2S-P1-05", spec: "CB＋MOCK", need: N91B, expect: "① 金澤、不落回京都 ② 金澤 ③ 無京都殘留於 preferredArea", r5: "r5 FAIL → PASS", premise: { entries: [{ turn: 1, kind: "more" }], internal: "_app:9387 cpf（無 spy）" }, checks: [eqF(1, "travelContext.destination", "金澤"), eqF(1, "preferredArea", "金澤"), notHasF(1, ["preferredArea"], ["京都"]), notHasF(1, SESSION_FIELDS, KZ_B), cont(2, "金澤")] });
add({
  id: "R-T88-FK2",
  g: "9.1b",
  sid: "A2S-P1-02",
  spec: "CB＋MOCK",
  need: N91B,
  expect: "① 福岡、天數 2 ② 福岡（非「福岡玩兩天」）",
  r5: "r5 FAIL → PASS",
  premise: { entries: [{ turn: 1, kind: "dc" }], internal: "tpc:756；cpf（無 spy）" },
  checks: [inPrevOr(0, "preferredArea", ["福岡"], ["福岡玩兩天", "福岡玩", "玩兩天"]), eqF(1, "preferredArea", "福岡"), eqF(2, "preferredArea", "福岡"), eqF(1, "travelContext.destination", "福岡"), ...[0, 1, 2].map((i) => notHasF(i, SESSION_FIELDS, FK_B, { noEmpty: true }))],
  unv: [unv("天數 2", "同 R-P1-02")],
});
add({ id: "R-T88-FRN", g: "9.1b", sid: "A2S-P1-KE", spec: "CB＋MOCK", need: N91B, expect: "① 澄清標籤／trusted＝富良野 ② 每回合持久化 preferredArea ∈ {前值, 富良野} ④ ≤1「富良野」（含 weather）⑤ trusted 後才 Places ⑥ 澄清回合 0 reserve", r5: "r5 FAIL → PASS", premise: premiseFRN, checks: frnSet(FR_B), unv: [unv("② :8837／:9387 中間寫入值", "無 spy；只以回合後持久化值判定（規格 T90 亦以持久化值為準）")] });
add({ id: "R-T88-FRN2（富良野玩推薦咖啡廳）", g: "9.1b", sid: "A2S-FRN2-a", spec: "CB＋MOCK", need: N91B, expect: "同 R-T88-FRN", r5: "同上", premise: premiseFRN, checks: [...frnSet(["富良野玩"]), cont(2, "富良野")] });
add({ id: "R-T88-FRN2（去富良野玩兩天推薦咖啡廳）", g: "9.1b", sid: "A2S-FRN2-b", spec: "CB＋MOCK", need: N91B, expect: "同 R-T88-FRN（另不得含「玩兩天」）", r5: "同上", premise: premiseFRN, checks: [...frnSet([...FR_B, "玩兩天"]), cont(2, "富良野")] });
add({ id: "R-T88-KYO", g: "9.1b", sid: "A2S-P1-03", spec: "CB＋MOCK", need: N91B, expect: "① 京都 ② 不含「大阪了」「京都玩」③ 大阪不回寫 ⑥ reset 1 次、無舊城市扣點", r5: "r5 FAIL → PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: "turnSwitch＝CONFIRMED(local)、extended；cpf areaSource undefined（無 spy）" }, checks: [eqF(1, "travelContext.destination", "京都"), notHasF(1, ["preferredArea"], ["大阪了", "京都玩"]), notHasF(2, ["preferredArea"], ["大阪了", "京都玩"]), notHasF(1, SESSION_FIELDS, ["大阪"]), notHasF(2, SESSION_FIELDS, ["大阪"]), creditsNoCity(1, "大阪"), creditsNoCity(2, "大阪")], unv: [unv("② 值由 pin 決定（:8837）", "無 spy"), unv("⑥ reset 1 次", "無 spy")] });
add({ id: "R-T88-NC", g: "9.1b", sid: "A2S-P1-NC", spec: "CB＋MOCK", need: N91B, expect: "① 金澤 ② 金澤 ④ 0 Provider", r5: "r5 FAIL → PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "tpc fallback；cpf（無 spy）" }, checks: [eqF(0, "travelContext.destination", "金澤"), eqF(0, "preferredArea", "金澤"), eqF(1, "preferredArea", "金澤"), ...geoZeroAmb(0, "④ 0 Provider（本地）"), ...geoZeroAmb(1, "④ 0 Provider（本地）")] });
for (const [sid, sent] of [["A2S-GO-a", "去玩推薦咖啡廳"], ["A2S-GO-b", "去玩，推薦咖啡廳"]]) {
  add({ id: `R-T88-GO（${sent}）`, g: "9.1b", sid, spec: "CB＋MOCK", need: N91B, expect: "① 不產生新地名 ② preferredArea 維持前值（不得「玩推薦咖啡廳」「玩，」）④ 不送「去玩」「玩」", r5: "r5 記錄（推定 ② FAIL）→ PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: "dtp 拆解回 null；cpf 前綴守門（無 spy）" }, checks: [inPrevOr(1, "preferredArea", [], ["玩推薦咖啡廳", "玩，推薦咖啡廳", "玩，", "玩"]), notHasF(1, ["preferredArea"], ["玩推薦", "玩，"]), unchangedF(1, "travelContext.destination"), notHasF(1, ["travelContext.destination", "location.city", "tripPlanningContext.destination", "pendingClarification.rawGeographicLabel"], ["玩"]), geoNoBroken(1, ["去玩"], ["玩"])] });
}
add({
  id: "R-T88-TNM",
  g: "9.1b",
  sid: "A2S-TNM",
  spec: "CB＋MOCK",
  need: N91B,
  expect: "② 不寫「台南夜市」③ 目的地＝台南不變（若 r5 已被 tpc:775 改寫為「台南夜市」→ O10 既有缺陷，不得宣稱修正、不得變差）⑦ 排除生效、續推可用",
  r5: "r5 記錄 → ②⑦ PASS",
  premise: { entries: [{ turn: 1, kind: "send" }], internal: "matchLeadingNegatedClause＝negated_only；turnSwitch＝NO_SWITCH（不得 NEGATED_UNCERTAIN；無 spy）" },
  checks: [
    notHasF(1, ["preferredArea"], ["台南夜市"]),
    notHasF(2, ["preferredArea"], ["台南夜市"]),
    ...[1, 2].map((i) =>
      ck(i, "③ travelContext.destination＝台南（「台南夜市」→ O10 既有缺陷：記 BASELINE，與 r5 逐字比對）", (t) => {
        const v = F["travelContext.destination"](t);
        return [v === "台南" ? P : v === "台南夜市" ? BL : FAIL, J(v)];
      }),
    ),
    cont(2, "台南"),
  ],
  unv: [unv("⑦ 排除生效（夜市被排除）", "Places Mock 卡片名稱為「<目的地>-地點N」，無類別內容可判定排除")],
});
// #99-8：規格 9.1b R-T88-JF 附帶句「不想去九份，推薦別的 → 見 9.1a 句表」；3.1 步驟 5 句表＝negated_only、X「九份」、NO_SWITCH（景點，非城市）、跳過、原流程；
//   4.3 句表＝NO_SWITCH＋clause（景點）、negated_only。句表 MODEL 期望（form／state）無 spy → 內部分支前提 UNVERIFIED，不放寬、不以整合結果代替。
add({
  id: "R-NEG-JF（不想去九份，推薦別的）",
  g: "9.1a／9.1b",
  sid: "A2S-NEG-JF",
  spec: "CB",
  expect: "NO_SWITCH（景點，非城市）→ 不當成城市切換：travelContext.destination 維持台南（台南或 ALIAS 等價值逐字相同 → PASS；含九份 → FAIL；以台南開頭但無法證明等價 → UNVERIFIED；空值 → UNVERIFIED；其他目的地 → FAIL；不用 includes 判等價）；location.city／tripDestination／tripPlanningContext.destination 只記錄（#101-1，O10 基準）；不建 destination_switch pending、不走 r18 destSwitch 正式切換區塊、不以九份扣點；Places／Search Scope 必須留在台南（destinationName／trusted flow／recommendationSession.destination 不得為九份或離開台南）；Places 搜尋中心未記錄 → UNVERIFIED；原流程（與 r5 逐字比對：本次記錄）",
  r5: "r5 記錄 → 須 PASS（不退步；T87 UX 疑慮解除）",
  premise: { entries: [{ turn: 1, kind: "send" }], internal: "matchLeadingNegatedClause＝negated_only、X「九份」；turnSwitch＝NO_SWITCH＋clause（V21 窄判定不中；不得 NEGATED_UNCERTAIN／E1／N4；無 spy）" },
  need: ["placesCenter"], // #101-1：Harness 無 Places lat/lng（r13:760）→ 無法區分「旅行目的地」與「景點搜尋中心」→ 該項 UNVERIFIED，不得 PASS
  checks: [
    // A2-AUDIT（T102 問題 1 裁決）：九份不得成為旅行目的地 → FAIL；等價只認逐字相同（台南／ALIAS），不用 includes；證據不足 → UNVERIFIED（不得 PASS）
    ck(1, "travelContext.destination 維持台南（台南／ALIAS 逐字 → PASS；含九份 → FAIL；台南開頭但無法證明等價 → UNVERIFIED；空值 → UNVERIFIED；其他目的地 → FAIL）", (t) => {
      const v = F["travelContext.destination"](t);
      if (v == null || String(v).trim() === "") return [UNV, `${J(v)}（無目的地值：證據不足）`];
      const s = String(v).trim();
      if (s === "台南" || (ALIAS["台南"] ?? []).includes(s)) return [P, J(v)];
      if (s.includes("九份") || (ALIAS["九份"] ?? []).some((a) => s.includes(a))) return [FAIL, `${J(v)}（景點排除被當成旅行目的地）`];
      if (s.startsWith("台南") || s.startsWith("臺南")) return [UNV, `${J(v)}（台南開頭但無法以 Authority 證據證明等價）`];
      return [FAIL, J(v)];
    }),
    blF(1, "location.city"),
    blF(1, "tripDestination"),
    blF(1, "tripPlanningContext.destination"),
    notHasF(1, ["recommendationSession.destination"], ["九份"]),
    pendNot(1, "destination_switch", null),
    ck(1, "不走正式切換流程（path 不含 |r18:destSwitch(real)）", (t) => [/\|r18:destSwitch\(real\)/.test(pathOf(t)) ? FAIL : P, pathOf(t).slice(0, 160)]),
    creditsNoCity(1, "九份"),
    ck(1, "Places 呼叫目的地不得為九份（不切換到九份）", (t) => {
      const q = t.placesQueries ?? [];
      const bad = q.filter((x) => sameDest(String(x).split("@").at(-1), "九份"));
      return [bad.length ? FAIL : P, `${q.length} 次 ${J(q.slice(0, 6))}`];
    }),
    placesDest(1, "台南"), // 離開台南範圍（destinationName 非台南）→ FAIL
    scopeCk(1, "台南"), // trusted flow／rec.destination 為九份或非台南 → FAIL；Places>0 但無可信判定 → FAIL；0 Places 且無判定 → UNVERIFIED
    trustedBeforePlaces(1, "台南"),
    ck(1, "trust 記錄（r14:535）無以九份為中心之 trusted 判定", (t) => {
      const bad = (t.trust ?? []).filter((x) => x.status === "trusted" && sameDest(x.destination ?? x.label, "九份"));
      return [bad.length ? FAIL : P, J((t.trust ?? []).map((x) => `${x.status}:${x.label}→${x.destination ?? x.reason}`))];
    }),
    blF(1, "preferredArea"),
    ck(1, "原流程（path／卡片／Geocoding／Credits；與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} geo=${J(geoAll(t))} ${fmtCr(cr(t))}`]),
  ],
  unv: [unv("NO_SWITCH 非 NEGATED_UNCERTAIN（未走 :8009 E1／N4）", "turnSwitch 無 spy；:8009 關卡在 _app send 層（Harness 為 r13 鏡像）；E1（target_not_place）不建 pending → pending 缺席不能證明 NO_SWITCH"), unv("無 trip-planning 重置（#101-1：重置 → FAIL）", "trip-planning-session-reset 無 spy → 無法觀測，不得 PASS")],
});
add({ id: "R-T88-QC", g: "9.1b", sid: "A2S-QC", spec: "CB＋MOCK", need: N91B, expect: "② 不寫「人多的地方」⑦ mood 含「安靜」、avoidTypes 含「人多吵雜」、咖啡廳推薦照舊", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal: "NO_SWITCH（negated_only；無 spy）" }, checks: [notHasF(0, SESSION_FIELDS, ["人多的地方"]), ck(0, "⑦ 咖啡廳推薦照舊（與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} builderIntent=${J(t.builderIntent)} activityPreference=${J(t.activityPreference)}`])], unv: [unv("⑦ mood／avoidTypes", "obs 無 mood／avoidTypes 欄（只有 activityPreference、builderUserText／builderIntent）")] });
add({ id: "R-T88-FAR", g: "9.1b", sid: "A2S-FAR", spec: "CB＋MOCK", need: N91B, expect: "② 不寫「太遠的地方」⑦ 原流程", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal: "NO_SWITCH（無 spy）" }, checks: [notHasF(0, SESSION_FIELDS, ["太遠的地方"]), ck(0, "⑦ 原流程（與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} ${fmtCr(cr(t))}`])] });
add({ id: "R-T88-OFF", g: "9.1b", sid: "A2S-OFF", spec: "CB＋MOCK", need: N91B, expect: "② 不寫「公司了」⑦ 原流程（W13）", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal: "extended、NO_SWITCH（無 spy）" }, checks: [notHasF(0, SESSION_FIELDS, ["公司了"]), ck(0, "⑦ 原流程（與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} tc=${J(F["travelContext.destination"](t))}`])] });
for (const [sid, ctxNote] of [["A2S-NEG1-osaka", "大阪脈絡"], ["A2S-NEG1-kanazawa", "金澤脈絡"]]) {
  // T96-7：規格「金澤或大阪脈絡」→ 兩個脈絡都掛
  add({ id: `R-T88-NEGK（${ctxNote}）`, g: "9.1b", sid, spec: "CB＋MOCK", expect: "8009 return（E1／N4）；④⑤⑥ 皆 0；③ Session 不變；cpf 不可達", r5: "同 R-NEG-1", premise: { entries: [{ turn: 1, kind: "send" }], internal: "negated_only；NEGATED_UNCERTAIN；:8009 return（無 spy；_app send 層鏡像）" }, checks: [geoZero(1, "④ 皆 0（Geocoding 不送任何 query）"), placesZero(1), reserveZero(1), pushZero(1), ...["travelContext.destination", "recommendationSession.destination", "location.city", "preferredArea", "tripPlanningContext.destination"].map((f) => unchangedF(1, f))], unv: [unv("cpf 不可達", "無 spy")] });
}
add({ id: "R-T88-SWK", g: "9.1b", sid: "A2S-SWK", spec: "CB＋MOCK", need: N91B, expect: "① 金澤 ③ 無大阪殘留 ⑥ reset 1 次", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: "legacy；CONFIRMED(local)（無 spy）" }, checks: [eqF(1, "travelContext.destination", "金澤"), notHasF(1, SESSION_FIELDS, ["大阪"]), creditsNoCity(1, "大阪"), cont(2, "金澤"), notHasF(2, SESSION_FIELDS, ["大阪"]), creditsNoCity(2, "大阪")], unv: [unv("⑥ reset 1 次", "無 spy")] });
for (const sid of ["A2S-TO1", "A2S-TO2"]) {
  add({ id: `R-T88-TO（${sid === "A2S-TO1" ? "到" : "在"}金澤玩）`, g: "9.1b", sid, spec: "CB＋MOCK", need: N91B, expect: "② preferredArea＝金澤；location.city＝金澤（必要 Assertion）；其餘依 9.1c-1", r5: "r5 預期 location.city「金澤玩」FAIL → PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "trip-intent:93-99 cityMatch 實際被執行、parseDestinationFromText 回 undefined（無 spy）" }, checks: [eqF(0, "preferredArea", "金澤"), eqF(0, "location.city", "金澤"), eqF(1, "location.city", "金澤")] });
}
add({ id: "R-T88-JF", g: "9.1b", sid: "A2S-JF", spec: "CB＋MOCK", need: N91B, expect: "① 九份（或 r5 逐字之景點層級，不含「玩」）② preferredArea＝九份 ③ location.city 不含「玩」④ 不送「九份玩」「去九份玩」⑦ 續推", r5: "r5 記錄 → PASS（r5 ② 推定 FAIL）", premise: { entries: [{ turn: 0, kind: "real" }], internal: "tpc:738 回「九份」；dtp:394；cpf c＝「九份玩」（無 spy）" }, checks: [notHasF(0, ["travelContext.destination", "location.city"], ["玩"]), blF(0, "travelContext.destination"), eqF(0, "preferredArea", "九份"), geoNoBroken(0, JF_B), geoNoBroken(1, JF_B), cont(1, "九份"), notHasF(1, SESSION_FIELDS, JF_B)] });
// ── 9.1c ──
add({ id: "R-B5-TO1", g: "9.1c／9.1c-1", sid: "A2S-TO1", spec: "CB＋MOCK", need: N91C1, expect: "9.1c-1 九欄（C location.city＝金澤 必要；E／F 依正式 Authority，不放寬；#5 任何 query 含 weather → FAIL）", r5: "r5 C「金澤玩」FAIL → PASS", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "A 欄：trip-intent:93-131 實際執行（parseDestinationFromText 回值、cityMatch raw）／B 欄：tpc:738、:741 回值（皆無 spy）" }, checks: to9(), unv: [unv("#3 travelContext.destination 寫入來源", "Session 寫入點無 spy（只有回合後持久化值）"), unv("A 欄（trip-intent:93-131 是否執行）", "無 spy；不得以 3.1.9(1) 推演代替 → B5 關閉條件無法由本檔滿足"), unv("B 欄（tpc:738／:741 實際回傳）", "無 spy")] });
add({ id: "R-B5-TO2", g: "9.1c／9.1c-1", sid: "A2S-TO2", spec: "CB＋MOCK", need: N91C1, expect: "同 R-B5-TO1", r5: "同上", premise: { entries: [{ turn: 0, kind: "dc" }], internal: "A／B 欄同 R-B5-TO1（無 spy）" }, checks: to9(), unv: [unv("#3 travelContext.destination 寫入來源", "同 R-B5-TO1"), unv("A 欄", "同 R-B5-TO1"), unv("B 欄", "同 R-B5-TO1")] });
add({
  id: "R-B5-FK2",
  g: "9.1c",
  sid: "A2S-P1-02",
  spec: "CB＋MOCK",
  need: N91B,
  expect: "C 福岡（不得「福岡玩兩天」「福岡玩」「玩兩天」）；D 福岡；天數 2；G 無殘破",
  r5: "r5 記錄 → PASS",
  premise: { entries: [{ turn: 1, kind: "dc" }], internal: "A 欄推定不執行（tpc 先回福岡；無 spy）" },
  // T96-6：T2（推薦回合）也必須 C／D＝福岡
  checks: [...[0, 1, 2].map((i) => notHasF(i, ["location.city"], [], { bad: ["福岡玩兩天", "福岡玩", "玩兩天"] })), eqF(1, "location.city", "福岡"), eqF(1, "preferredArea", "福岡"), eqF(2, "location.city", "福岡"), eqF(2, "preferredArea", "福岡"), ...[0, 1, 2].map((i) => geoNoBroken(i, FK_B))],
  unv: [unv("天數 2", "同 R-P1-02"), unv("A 欄", "無 spy")],
});
add({
  id: "R-B5-FRN",
  g: "9.1c",
  sid: "A2S-B5-FRN",
  spec: "CB＋MOCK",
  need: N91B,
  expect: "C ∉ {富良野玩, 去富良野玩}；D ∈ {前值, 富良野}；E 澄清或 trusted 富良野；G 只可能「富良野」≤1（含 weather）；H trusted 後才 Places、澄清回合 0 reserve；I 乾淨",
  r5: "r5 記錄 → PASS",
  premise: premiseFRN,
  checks: [
    ...[0, 1, 2].map((i) => notHasF(i, ["location.city"], [], { bad: ["富良野玩", "去富良野玩"] }, i === 1)),
    ck(0, "E travelContext.destination：pending raw＝富良野（澄清）或 tc＝富良野且本輪 trusted", (t) => {
      const raw = F["pendingClarification.rawGeographicLabel"](t);
      const tc = F["travelContext.destination"](t);
      const tr = topFlows(t).some((f) => f.status === "trusted" && sameDest(f.destination, "富良野"));
      return [raw === "富良野" || (tc === "富良野" && tr) ? P : FAIL, `pending=${J(raw)} tc=${J(tc)} trusted=${tr}`];
    }),
    ...frnSet(FR_B),
    cont(2, "富良野"),
  ],
  unv: [unv("A 欄", "推定不執行（tpc:775 先回富良野；無 spy）")],
});
add({ id: "R-B5-JF", g: "9.1c", sid: "A2S-JF", spec: "CB＋MOCK", need: N91B, expect: "C 不含「玩」（與 r5 比對）；D 九份；G 無「九份玩」", r5: "r5 記錄 → PASS（保護）", premise: { entries: [{ turn: 0, kind: "real" }], internal: "A 欄推定不執行（tpc:738 先回九份；無 spy）" }, checks: [notHasF(0, ["location.city"], ["玩"]), blF(0, "location.city"), eqF(0, "preferredArea", "九份"), notHasF(1, ["location.city"], ["玩"]), geoNoBroken(0, JF_B), geoNoBroken(1, JF_B)] });
add({
  id: "R-B5-TO3",
  g: "9.1c",
  sid: "A2S-TO3",
  spec: "CB＋MOCK",
  need: N91B,
  expect: "C 金澤（不得「金澤玩兩天」「金澤玩」「玩兩天」）；D ∈ {前值, 金澤}；E＝金澤；F 本地金澤；G 0 Provider；H 第一句若未進推薦流程 0 Places／0 reserve（已進 → 記錄；規格 9.1c 條件式保留）＋第一句 Credits reserve＝0（W-N1，無條件）、推薦回合一次結算；I 乾淨",
  r5: "r5 記錄（施工前 :434 濾除 → location.city 未寫／前值；行為改變，非失敗轉通過證據）→ 施工後 PASS",
  premise: { entries: [{ turn: 1, kind: "dc" }], internal: "A 欄 cityMatch raw「金澤玩兩天」→ helper split（無 spy）" },
  checks: [
    ...[0, 1, 2].flatMap((i) => [eqF(i, "location.city", "金澤"), inPrevOr(i, "preferredArea", ["金澤"], ["金澤玩兩天", "金澤玩", "玩兩天"]), eqF(i, "travelContext.destination", "金澤"), notHasF(i, SESSION_FIELDS, [...KZ_B, "玩兩天"]), ...geoZeroAmb(i, "G 0 Provider"), geoNoBroken(i, [...KZ_B, "玩兩天"])]),
    firstTurnNoRec(0), // 規格 9.1c 表 R-B5-TO3 H（L897）條件式：保留
    { ...reserveZero(0), label: "W-N1（A2-SPEC-WORK 附註，無條件）第一句「到金澤玩兩天」Credits reserve 0（begin 0 且 credits_reserve 0；不論是否進推薦流程）" }, // #99-1
    scopeCk(1, "金澤", "authority"),
    placesDest(1, "金澤"),
    cardsAny(1),
    oneSettle(1, "金澤"),
    cont(2, "金澤"),
    oneSettle(2, "金澤"),
    startClean(2, [...KZ_B, "玩兩天"]),
  ],
  unv: [unv("天數＝2 逐字", "同 R-P1-02"), unv("A 欄", "無 spy")],
});
add({
  id: "R-B5-AROUND",
  g: "9.1c",
  sid: "A2S-AROUND",
  spec: "CB＋MOCK",
  expect: "C 不寫（未設定）；D 不寫；E 不出現本句產生之目的地；F 不建立 Search Scope；G 0 geocode（含「處」→ FAIL）；H Places 0、reserve 0；I 下一回合起點無「處玩」「到處玩」「處」「到處」",
  r5: "r5 記錄（施工前 MODEL：location.city「處玩」）→ PASS（行為改變）",
  premise: { entries: [{ turn: 0, kind: "send" }], internal: "A 欄 cityMatch raw「處玩」→ invalid_head（無 spy）" },
  checks: [
    ...["location.city", "preferredArea", "travelContext.destination", "tripPlanningContext.destination"].map((f) => unchangedF(0, f)),
    notHasF(0, SESSION_FIELDS, ["處玩", "到處", "處"]),
    ck(0, "F 不建立 Search Scope（recommendationSession 無目的地、無 trusted 判定）", (t) => [F["recommendationSession.destination"](t) == null && !topFlows(t).some((f) => f.status === "trusted") ? P : FAIL, `rec=${J(F["recommendationSession.destination"](t))} trusted=${J(topFlows(t).filter((f) => f.status === "trusted").map((f) => f.destination))}`]),
    geoZero(0, "G 0 geocode"),
    geoNoBroken(0, ["處"]),
    placesZero(0),
    reserveZero(0),
    startClean(1, ["處玩", "到處玩", "到處", "處"]), // T96-8：I 欄依規格「上述字串」含「處」
  ],
  unv: [unv("A 欄", "無 spy")],
});
add({
  id: "R-B5-2DS",
  g: "9.1c",
  sid: "A2S-2DS",
  spec: "CB＋MOCK",
  expect: "C 與 r5 逐字相同（推定「二日市」；不得截為「二日」「二」）；D／E／F／G／H／I 與 r5 相同",
  r5: "r5 PASS → 維持 PASS（保護）",
  premise: { entries: [{ turn: 0, kind: "real" }], internal: "A 欄 cityMatch raw「二日市」→ helper none（無 spy）" },
  checks: [
    ...[0, 1].map((i) => notHasF(i, SESSION_FIELDS, ["到二日市"], { bad: ["二日", "二"] })),
    ...["location.city", "preferredArea", "travelContext.destination"].flatMap((f) => [blF(0, f), blF(1, f)]),
    ck(0, "G／H 與 r5 逐字比對（本次記錄）", (t) => [BL, `geo=${J(geoAll(t))} ${fmtProv(prov(t))} ${fmtCr(cr(t))}`]),
    ck(1, "G／H／I 與 r5 逐字比對（本次記錄）", (t) => [BL, `geo=${J(geoAll(t))} ${fmtProv(prov(t))} ${fmtCr(cr(t))} rec=${J(F["recommendationSession.destination"](t))}`]),
  ],
  unv: [unv("A 欄", "無 spy")],
});
// ── 保護名單（9.1a R-P1-PROT／9.1b R-T88-PROT／9.1c R-B5-PROT；共用同一次執行）──
const PROT_SID = { 台南小吃推薦: "A2S-PROT-01", 台南中西區: "A2S-PROT-02", 東京新宿: "A2S-PROT-03", 新潟十日町: "A2S-PROT-04", 三重四日市: "A2S-PROT-05", 福岡二日市: "A2S-PROT-06", 去台南玩具博物館: "A2S-PROT-07", 台中好吃的: "A2S-PROT-08", 去十日町玩: "A2S-PROT-09", 去玩具博物館: "A2S-PROT-10", "到十日町，推薦咖啡廳": "A2S-PROT-11", "到四日市，推薦咖啡廳": "A2S-PROT-12" };
const PROT7 = ["台南小吃推薦", "台南中西區", "東京新宿", "新潟十日町", "三重四日市", "福岡二日市", "去台南玩具博物館"];
const TRUNC = { 新潟十日町: ["十日", "新潟十日"], 三重四日市: ["四日", "三重四日"], 福岡二日市: ["二日", "福岡二日"], 去十日町玩: ["十日"], "到十日町，推薦咖啡廳": ["十日"], "到四日市，推薦咖啡廳": ["四日"] };
const protChecks = (sent) => [
  ...(sent === "台南小吃推薦" ? [notHasF(0, SESSION_FIELDS, ["小吃", "推薦"])] : []),
  ...(TRUNC[sent] ? [notHasF(0, SESSION_FIELDS, [], { bad: TRUNC[sent] })] : []),
  ...(sent === "去十日町玩" ? [notHasF(0, ["preferredArea", "location.city"], ["十日町玩"])] : []),
  ...(sent.includes("玩具") ? [notHasF(0, ["preferredArea", "location.city", "travelContext.destination"], [], { bad: ["台南玩", "玩具", "去台南", "去玩具博物館"] })] : []),
  blF(0, "travelContext.destination"),
  blF(0, "preferredArea"),
  blF(0, "location.city"),
  ck(0, "④ Geocoding query 與次數（含 weather；與 r5 逐字比對、次數不增：本次記錄）", (t) => [BL, `${geoAll(t).length} 次 ${J(geoAll(t))}`]),
  ck(0, "⑦ 原流程（與 r5 逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} cards=${cards(t).length} ${fmtCr(cr(t))}`]),
];
for (const [grp, g, extra, internal] of [
  ["R-P1-PROT", "9.1a", ["台中好吃的", "去十日町玩"], null],
  ["R-T88-PROT", "9.1b", ["去十日町玩", "去玩具博物館"], null],
  ["R-B5-PROT", "9.1c", ["到十日町，推薦咖啡廳", "到四日市，推薦咖啡廳"], "A 欄：前七句推定不執行、另附兩句推定執行（raw 逐字；無 spy）"],
]) {
  for (const sent of [...PROT7, ...extra]) {
    add({ id: `${grp}／${sent}`, g, sid: PROT_SID[sent], spec: "CB", expect: sent === "去十日町玩" ? "與 r5 逐字相同（例外：preferredArea r5「十日町玩」→ 施工後「十日町」，記為修正）" : "目的地／preferredArea／query 與 r5 逐字相同、次數不增；不得截斷", r5: "r5 PASS → 維持 PASS", premise: { entries: [{ turn: 0, kind: "send" }], internal }, checks: protChecks(sent) });
  }
}
// ── 9.1c-2 記錄型 ──
for (const [id, sid, open, broken] of [
  ["R-REC-O13", "A2S-REC-O13", "O13", ["金澤玩附近", "金澤玩", "玩附近"]],
  ["R-REC-CHAIN", "A2S-REC-CHAIN", "O14", ["金澤玩逛逛", "金澤玩", "玩逛逛", "逛逛"]],
  ["R-REC-TAILX（金澤玩一下）", "A2S-REC-TAILX", "O15", ["金澤玩一下", "金澤玩", "玩一下"]],
  ["R-REC-TAILX（在金澤玩一下）", "A2S-REC-TAILX-zai", "O15", ["金澤玩一下", "金澤玩", "玩一下"]],
]) {
  add({ id, g: "9.1c-2", sid, spec: "CB＋MOCK（記錄型）", record: { open, broken }, expect: `記錄 A～I；停止條件 (1)～(4)；location.city／preferredArea 殘破值記為 OPEN（${open}）`, r5: "不設已修正期望；不列入 B5 關閉條件", premise: { entries: [{ turn: 0, kind: "send" }], internal: "A 欄（含 areaMatch 是否命中與值；無 spy）" }, checks: [] });
}
// ── #97 新增：9.2 R-S1～S6（規格類型 MODEL＋CB；本檔只提供整合部分，MODEL 部分在 s1s4，不重複）──
for (const n of [1, 2, 3, 4, 5, 6]) {
  const legacy = n >= 5;
  add({
    id: `R-S${n}`,
    g: "9.2",
    sid: `A2S-S${n}`,
    spec: "MODEL＋CB（本檔＝整合部分）",
    expect: legacy ? "維持 PASS（legacy 逐字相同）：金澤；不寫大阪／殘破" : `金澤；不寫大阪／殘破${n === 4 ? "；S4 推薦在金澤驗證後" : ""}（s1s4 斷言不改；expect 由 FAIL 變 PASS 記為失敗轉通過證據）`,
    r5: legacy ? "r5 PASS → 維持（legacy 逐字比對：本次記錄）" : "r5 推定 FAIL → PASS",
    premise: { entries: [{ turn: 1, kind: "send" }], internal: "matchLeadingNegatedClause form／turnSwitch 分類（無 spy）" },
    checks: [
      eqF(1, "travelContext.destination", "金澤"),
      notHasF(1, SESSION_FIELDS, ["大阪", ...SW_B]),
      geoNoBroken(1, ["大阪", ...SW_B]),
      creditsNoCity(1, "大阪"),
      trustedBeforePlaces(1, "金澤"),
      ...(n === 4 ? [placesDest(1, "金澤"), cardsAny(1)] : []),
      ...(legacy ? ["location.city", "preferredArea", "travelContext.destination", "tripPlanningContext.destination", "recommendationSession.destination"].map((f) => blF(1, f)) : []),
    ],
  });
}
// ── #97 新增：9.3 NEGATED_UNCERTAIN／E0／Pending ──
const NU_INT = "turnSwitch＝NEGATED_UNCERTAIN；E1 在 _app send :8009 後（r13 鏡像，施工後須 r21 r6 鏡像同步；無 spy）";
add({ id: "R-NU-1", g: "9.3", sid: "A2S-NU1", spec: "CB＋MOCK", expect: "E1 return；push* spy=0、geocode=0、Places=0、reserve=0；Session 目的地=大阪不變", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: NU_INT }, checks: [pushZero(1), geoZero(1, "geocode=0"), placesZero(1), reserveZero(1), cardsNone(1), eqF(1, "travelContext.destination", "大阪"), unchangedF(1, "travelContext.destination"), unchangedF(1, "recommendationSession.destination")], unv: [unv("E1 return／提問文案", "無 E1 文案鍵可比對；助理訊息逐字記錄於回合列")] });
add({ id: "R-NU-2", g: "9.3", sid: "A2S-NU2", spec: "CB", expect: "E1 pending（label 金澤、previous 大阪）；persist 一次；G1/G4 通過（6.3.1：不呼叫 push*／reserve）", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: NU_INT }, checks: [eqF(1, "pendingClarification.kind", "destination_switch"), eqF(1, "pendingClarification.rawGeographicLabel", "金澤"), unchangedF(1, "travelContext.destination"), pushZero(1), placesZero(1), reserveZero(1)], unv: [unv("pending.previousConfirmedDestination＝大阪", "r13 只記 rawGeographicLabel／kind／confirmedParentCity／originalUserText（L2068-2071），previousConfirmedDestination 未記錄"), unv("persist 一次", "r14 R14_log.persist 為全程累計（只在 result.r14.log），無逐回合值"), unv("G1／G4（planningSessionId／planVersion）", "obs 未記錄")] });
add({ id: "R-NU-3", g: "9.3", sid: "A2S-NU3", spec: "CB＋MOCK", expect: "同 R-NU-1；不落回大阪", r5: "r5 記錄 → PASS", premise: { entries: [{ turn: 1, kind: "send" }], internal: NU_INT }, checks: [pushZero(1), geoZero(1, "geocode=0"), placesZero(1), reserveZero(1), cardsNone(1), creditsNoCity(1, "大阪"), eqF(1, "travelContext.destination", "大阪"), unchangedF(1, "recommendationSession.destination")], unv: [unv("E1 return／提問文案", "同 R-NU-1")] });
const E0_PREM = (int) => ({ entries: [{ turn: 1, kind: "e1pend" }, { turn: 2, kind: "send" }], internal: `R-NU-2 之 E1 pending 須實際建立（T2 e1pend 入口）；${int}（無 spy）` });
add({ id: "R-E0-1", g: "9.3", sid: "A2S-E0-yes", spec: "CB＋MOCK", expect: "Authority 一次→E3 Applied；不自動推薦；0 reserve", r5: "r5 記錄 → PASS", premise: E0_PREM("classifyDestinationUpdateAnswer＝confirm"), checks: [eqF(2, "travelContext.destination", "金澤"), pendNot(2, "destination_switch", null), pushZero(2), placesZero(2), reserveZero(2), cardsNone(2)], unv: [unv("Authority 一次", "resolveDestination 無 spy（Geocoding 次數另列於回合列）"), unv("E3 Applied 文案", "無文案鍵可比對")] });
add({ id: "R-E0-2", g: "9.3", sid: "A2S-E0-cancel", spec: "CB", expect: "維持大阪；0 付費；pending 清除不恢復", r5: "r5 記錄 → PASS", premise: E0_PREM("classifyDestinationUpdateAnswer＝cancel"), checks: [eqF(2, "travelContext.destination", "大阪"), unchangedF(2, "recommendationSession.destination"), pendNot(2, "destination_switch", null), geoZero(2, "0 付費"), placesZero(2), reserveZero(2), pushZero(2)], unv: [unv("「維持 {previous}」文案", "無文案鍵可比對")] });
add({ id: "R-E0-3", g: "9.3", sid: "A2S-E0-replace", spec: "CB＋MOCK", expect: "pending 消費；本回合依其分類", r5: "r5 記錄 → PASS", premise: E0_PREM("classifyDestinationUpdateAnswer＝replace"), checks: [pendNot(2, "destination_switch", "金澤"), notHasF(2, SESSION_FIELDS, ["換富良野"]), geoNoBroken(2, ["換富良野", "換"]), creditsNoCity(2, "大阪"), blF(2, "travelContext.destination"), ck(2, "本回合分類結果（與施工後逐字比對：本次記錄）", (t) => [BL, `入口=${entryTags(t)} pending=${J(F["pendingClarification.kind"](t))}:${J(F["pendingClarification.rawGeographicLabel"](t))} ${fmtProv(prov(t))}`])], unv: [unv("「本回合依其分類」之 turnSwitch 值", "無 spy")] });
add({ id: "R-PEND-4", g: "9.3", sid: "A2S-PEND4", spec: "CB", expect: "nearby pending＋切換句（N8／B3）：只清 legacy nearby destination_area", r5: "r5 記錄", premise: { entries: [{ turn: 0, kind: "legacyPend" }], internal: "N8／B3 分支（無 spy）" }, checks: [ck(0, "legacy nearby destination_area pending（附近）已清除", (t) => { const k = F["pendingClarification.kind"](t); const r = F["pendingClarification.rawGeographicLabel"](t); return [k === "destination_area" && r === "附近" ? FAIL : P, `${J(k)}:${J(r)}`]; }), ck(0, "回合後其他 Session 狀態（與施工後逐字比對：本次記錄）", (t) => [BL, `tc=${J(F["travelContext.destination"](t))} pa=${J(F.preferredArea(t))} ${fmtProv(prov(t))}`])], unv: [unv("「只清」（其他 pending／parent_city_scope 未被清）", "Harness 只記單一 pendingClarification，無其他 pending 欄位"), unv("R-PEND-4 本案整體（#99-6）", "注入 legacyNearby 後 r13:1452-1457 必走 obs.path＝legacy_nearby_pending(未重建) 並 return（不 persist）→ 回合必為 MODEL；N8／B3 正式分支在現行 Harness 無任何證據 → 列入 UNVERIFIED 清單")] });
add({ id: "R-9919", g: "9.3", sid: "A2S-9919", spec: "CB", expect: "既有停止文案；persist 為 negatedSwitchStopSession（不含本回合目的地衍生）", r5: "r5 記錄", premise: { entries: [{ turn: 0, kind: "moreF" }], internal: ":9919 讀 turnSwitch（NO_SWITCH＋hasNegatedClause＋switchedText）（無 spy）" }, checks: [eqF(0, "travelContext.destination", "京都"), notHasF(0, SESSION_FIELDS, ["公司"], { bad: ["咖啡廳"] }), ck(0, "停止文案（與施工後逐字比對：本次記錄）", (t) => [BL, J((t.r20Assistant ?? t.r15Assistant ?? []).map((x) => String(x).slice(0, 160)))]), ck(0, "付費行為（既有流程，不擴大；本次記錄）", (t) => [BL, fmtProv(prov(t))])], unv: [unv("persist 值＝negatedSwitchStopSession 逐欄", "只有回合後持久化地理欄位，tripPurpose／pendingQuestion 未記錄")] });
export const CASES = C;

// ════════════════ 判定 ════════════════
function stopConditions(turns, broken) {
  const has = (v) => v != null && broken.some((b) => String(v).includes(b));
  const s = { 1: [], 2: [], 3: [], 4: [], open: [] };
  for (const t of turns) {
    const T = `T${t.turnIndex + 1}`;
    for (const g of geoAll(t)) if (has(seg0(g))) s[1].push(`${T} geocode ${g}`);
    for (const q of t.placesQueries ?? []) if (has(q)) s[1].push(`${T} Places ${q}`);
    for (const f of TRUST_FIELDS) if (has(F[f](t))) s[2].push(`${T} ${f}=${J(F[f](t))}`);
    for (const f of topFlows(t)) if (f.status === "trusted" && has(f.destination)) s[2].push(`${T} trusted ${f.fn}→${f.destination}`);
    const rd = F["recommendationSession.destination"](t);
    if (rd != null && !sameDest(rd, "金澤")) s[3].push(`${T} rec.destination=${J(rd)}`);
    for (const d of cr(t).begin) if (has(d) || (d != null && !sameDest(d, "金澤"))) s[4].push(`${T} Credits metadata.destination=${J(d)}`);
    for (const f of ["location.city", "preferredArea"]) if (has(F[f](t))) s.open.push(`${T} ${f}=${J(F[f](t))}`);
  }
  return s;
}
const agg = (vs) => {
  const v = vs.filter((x) => x !== "N/A");
  if (v.includes(FAIL)) return FAIL;
  if (v.includes(NR)) return NR;
  if (v.includes(UNV)) return UNV;
  if (v.includes(BL)) return BL;
  return v.length ? P : "-";
};
/** 每回合證據（含未執行回合：onlyIfClarified 未送出 → NOT-REACHED）。 */
function evidenceLine(s, turns) {
  const n = s?.turns?.length ?? 0;
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const t = turnOf(turns, i);
    const spec = s.turns[i];
    parts.push(`T${i + 1}=${t ? `${evOf(t, s)}${evNote(t)}` : `${EV.NR}${typeof spec === "object" && spec?.onlyIfClarified ? "（onlyIfClarified 未送出）" : "（未執行）"}`}`);
  }
  return parts.join(" ");
}
function evalCase(c, r, s) {
  if (!r) return { verdict: "NOT-RUN", obs: "-", loose: null, evs: [], lines: ["    （本次未執行；--only 未包含或樹不存在）"] };
  if (r.err || r.result?.error) return { verdict: "INFRA", obs: "-", loose: null, evs: [], lines: [`    INFRA ${String(r.err ?? r.result.error).slice(0, 240)}`] };
  const turns = [...(r.result?.turns ?? [])].sort((a, b) => a.turnIndex - b.turnIndex);
  const ctx = { turns };
  const lines = [];
  const evs = turns.map((t) => evOf(t, s));
  lines.push(`    證據分類：${evidenceLine(s, turns)}`);
  const fetchFail = Boolean(r.fetchCalls);
  if (fetchFail) lines.push(`    [FAIL] 外部請求 fetchCalls=${r.fetchCalls}（離線契約）`);
  // 分支前提（入口）
  let premise = P;
  for (const e of c.premise.entries) {
    const t = turnOf(turns, e.turn);
    let v;
    let why;
    if (!t) [v, why] = [NR, "回合未執行"];
    else if (isModel(t)) [v, why] = [UNV, `MODEL（r13 未重建路徑）path=${pathOf(t).slice(0, 120)}`];
    else if (e.kind.split("|").some((k) => ENTRY[k](t))) [v, why] = [P, `觀測入口=${entryTags(t)}；證據=${evOf(t, s)}`];
    else [v, why] = [NR, `期望入口 ${e.kind}，實際=${entryTags(t)}；證據=${evOf(t, s)}；path=${pathOf(t).slice(0, 120)}`];
    lines.push(`    前提（入口）T${e.turn + 1} ${e.kind}：${v}（${why}）`);
    if (v !== P) premise = premise === NR || v === NR ? NR : UNV;
  }
  lines.push(`    前提（內部分支）：${c.premise.internal ? `UNVERIFIED（${c.premise.internal}）` : "無（入口即前提）"}`);
  // 記錄型（T96-5：外部請求 → FAIL／STOP，不得忽略）
  if (c.record) {
    const st = stopConditions(turns, c.record.broken);
    const names = { 1: "(1) 不可信目的地進入付費 Provider", 2: "(2) 可信 Session 被殘破地名污染", 3: "(3) Search Scope 使用錯誤城市", 4: "(4) Credits 錯誤扣點" };
    for (const k of [1, 2, 3, 4]) lines.push(`    停止條件 ${names[k]}：${st[k].length ? `成立 ${J(st[k])}` : "未成立"}`);
    lines.push(`    OPEN 現況（${c.record.open}；非可信欄位殘破值，只記錄）：${st.open.length ? J(st.open) : "無"}`);
    lines.push(`    Provider 合計：${fmtProv(sumProv(turns))}`);
    const stop = [1, 2, 3, 4].some((k) => st[k].length);
    const verdict = fetchFail ? FAIL : stop ? "STOP" : turns.some(isModel) ? "RECORD（含 MODEL 回合）" : "RECORD";
    if (fetchFail) lines.push("    → 外部請求：FAIL 並 STOP（立即回報指派者）");
    return { verdict, obs: "-", loose: null, evs, lines };
  }
  const res = [];
  for (const k of c.checks) {
    let v;
    let got;
    let where;
    if (k.turn === "-") {
      [v, got] = k.fn();
      where = "  ";
    } else if (k.turn === "*") {
      try {
        [v, got] = k.fn(null, ctx);
      } catch (e) {
        [v, got] = [FAIL, `判定例外 ${String(e?.message ?? e).slice(0, 120)}`];
      }
      if (turns.some(isModel) && v !== UNV) [v, got] = [UNV, `${got}（情境含 MODEL 回合 → 不計）`];
      where = "全";
    } else {
      const t = turnOf(turns, k.turn);
      where = `T${k.turn + 1}`;
      if (!t) [v, got] = k.opt ? ["N/A", "onlyIfClarified 未送出"] : [NR, "回合未執行"];
      else {
        try {
          [v, got] = k.fn(t, ctx);
        } catch (e) {
          [v, got] = [FAIL, `判定例外 ${String(e?.message ?? e).slice(0, 120)}`];
        }
        if (isModel(t) && v !== "N/A") [v, got] = [UNV, `MODEL（r13 未重建路徑）；原判 ${v}：${got}`];
        where = `${where}[${evOf(t, s)}]`;
      }
    }
    res.push({ v, amb: k.amb });
    lines.push(`    [${v}] ${where} ${k.label}｜${String(got).slice(0, 400)}`);
  }
  // 規格要求、Harness 未記錄的欄位與案例專屬 UNVERIFIED（與可觀測判定分開）
  const unvItems = [...(c.need ?? []).map((k) => NEED[k]), ...(c.unv ?? [])];
  for (const k of unvItems) lines.push(`    [UNVERIFIED] 未記錄必要欄位／前提：${k.label}｜${k.fn()[1]}`);
  const obs = agg(res.filter((x) => x.amb !== "loose").map((x) => x.v));
  const hasAmb = res.some((x) => x.amb);
  const obsLoose = hasAmb ? agg(res.filter((x) => x.amb !== "strict").map((x) => x.v)) : null;
  const injCB = isInjected(s) && /CB/.test(c.spec) && !/MODEL/.test(c.spec);
  // #101-2（取代 #99-5「任一回合」）：每個必要檢查回合（入口前提回合＋有非 opt 檢查之回合；opt 檢查之回合已執行者亦計；含「*」整情境檢查 → 另加全部已執行回合）
  //   都必須是 ACTUAL_APP_CALLBACK；任一不是（含必要回合未執行）→ 最終上限 UNVERIFIED
  const relIdx = [
    ...new Set([
      ...c.premise.entries.map((e) => e.turn),
      ...c.checks.filter((k) => typeof k.turn === "number" && (!k.opt || turnOf(turns, k.turn))).map((k) => k.turn),
      ...(c.checks.some((k) => k.turn === "*") ? turns.map((t) => t.turnIndex) : []),
    ]),
  ].sort((a, b) => a - b);
  const relEvs = relIdx.map((i) => (turnOf(turns, i) ? evOf(turnOf(turns, i), s) : EV.NR));
  const hasCB = relEvs.length > 0 && relEvs.every((x) => x === EV.CB);
  lines.push(`    案例依據回合證據（#101-2：每個必要回合皆須 ACTUAL_APP_CALLBACK）：${relIdx.map((i) => `T${i + 1}=${turnOf(turns, i) ? evOf(turnOf(turns, i), s) + evNote(turnOf(turns, i)) : EV.NR}`).join(" ") || "-"} → ${hasCB ? "全部為 ACTUAL_APP_CALLBACK" : `非全部為 ACTUAL_APP_CALLBACK（不符：${relIdx.filter((_, j) => relEvs[j] !== EV.CB).map((i) => `T${i + 1}`).join(",") || "無依據回合"}）：最終上限 UNVERIFIED`}`);
  const finalOf = (o) => {
    const why = [];
    if (fetchFail) return { v: FAIL, why: ["外部請求"] };
    if (o === FAIL) return { v: FAIL, why: ["可觀測欄位 FAIL"] };
    if (premise === NR || o === NR) return { v: NR, why: [premise === NR ? "入口前提未觀測" : "回合未執行"] };
    if (premise === UNV) why.push("入口前提 MODEL");
    if (o === UNV) why.push("可觀測欄位含 UNVERIFIED");
    if (c.premise.internal) why.push("內部分支前提無 spy");
    if (unvItems.length) why.push(`未記錄必要欄位 ${unvItems.length} 項`);
    if (injCB) why.push("規格類型 CB，本案以 INJECTED_STATE 驅動");
    if (!hasCB) why.push("必要依據回合非全部為 ACTUAL_APP_CALLBACK（含 MIRRORED_SEND+REAL_LIB／MODEL／INJECTED_STATE／未執行；鏡像 send 不算完整正式 Callback，#101-2）");
    if (why.length) return { v: UNV, why };
    if (o === BL) return { v: BL, why: ["含 BASELINE 欄位（待與 r5 逐字比對）"] };
    if (o === "-") return { v: UNV, why: ["無可觀測檢查"] };
    return { v: P, why: [] };
  };
  const fin = finalOf(obs);
  lines.push(`    可觀測欄位判定：${obs}（只依 Harness 已記錄欄位${hasAmb ? "；weather 待裁決項採含 weather 版" : ""}）`);
  let loose = null;
  if (hasAmb) {
    loose = finalOf(obsLoose).v;
    lines.push(`    ［weather 待裁決］若採「不含 weather prefetch」版：可觀測=${obsLoose}、最終=${loose}（只供指派者裁決；不計入統計）`);
  }
  lines.push(`    Provider 合計：${fmtProv(sumProv(turns))}`);
  return { verdict: fin.v, why: fin.why, obs, loose, evs, lines };
}

// ════════════════ 報告 ════════════════
function obsFieldLine(t) {
  const trustC = (t.trust ?? []).filter((x) => x.center).map((x) => `${x.status}:${x.destination ?? x.label}@${x.center.lat},${x.center.lng}`);
  const srcs = topFlows(t).filter((f) => f.centerSource).map((f) => `${f.fn}:${f.centerSource}`);
  return `     觀測欄位（#97-6）：requestId=UNVERIFIED（r14:441 有 args、r14:806 只輸出名稱）｜destinationScopeId=UNVERIFIED（未記錄）｜Scope 國家=UNVERIFIED（未記錄；Session travelContext.destinationCountry=${J(t.sessionCtxCountry)} 僅供參考）｜Places center=UNVERIFIED（r13:760 無 lat/lng）｜已記錄替代：Scope center（r14:535 trust）=${J(trustC)} centerSource（r15:436）=${J(srcs)} r14Violations=${J(t.r14Violations ?? [])}`;
}
function turnLines(t, s) {
  const c = cr(t);
  const fl = topFlows(t);
  return [
    `  T${t.turnIndex + 1}「${t.text}」 證據=${evOf(t, s)}${evNote(t)} 入口=${entryTags(t)} path=${pathOf(t).slice(0, 220)}`,
    `     目的地解析：turnResolution=${J(t.turnResolution)} dispatchDest=${J(t.dispatchDest)} searchDest=${J(t.searchDest)} creditsDest=${J(t.creditsDest)} continuationDest=${J(t.continuationDest)} clarified=${Boolean(t.clarified)} clarificationLabel=${J(t.clarificationLabel)}`,
    `     持久化 Session：location.city=${J(F["location.city"](t))} preferredArea=${J(F.preferredArea(t))} travelContext.destination=${J(F["travelContext.destination"](t))} tripPlanningContext.destination=${J(F["tripPlanningContext.destination"](t))} tripDestination=${J(F.tripDestination(t))} pendingClarification=${J(F["pendingClarification.kind"](t))}:${J(F["pendingClarification.rawGeographicLabel"](t))} pendingAtStart=${J(t.pendingAtStart)} destinationCountry=${J(t.sessionCtxCountry)} activeCategoryIntent=${J(t.r20End?.activeCategoryIntent)}`,
    `     Search Scope：rec=${J(t.r15Rec ? { destination: t.r15Rec.destination, searchScope: t.r15Rec.searchScope, parentCity: t.r15Rec.parentCity, area: t.r15Rec.area, pool: t.r15Rec.pool } : null)} flows=${J(fl.map((f) => `${f.fn}(${f.label})→${f.status}${f.reason ? `/${f.reason}` : ""}${f.centerSource ? `/${f.centerSource}` : ""}:${f.destination}`))} trust=${J((t.trust ?? []).map((x) => `${x.status}:${x.label}→${x.destination ?? x.reason}@${x.center ? `${x.center.lat},${x.center.lng}` : "-"}`))}`,
    `     Provider（#97-3 分項）：${fmtProv(prov(t))}`,
    `     Geocoding 逐字：全部=${J(geoAll(t))} send 層 weather prefetch=${J(geoW(t))} Mock=${J((t.r15Geo ?? []).map((g) => `${g.q}/${g.outcome}/${g.validity?.cls ?? "-"}${g.flow ? `@${g.flow}` : ""}`))}`,
    `     Places：${t.placesRequests ?? 0} 次 參數(query@destinationName)=${J(t.placesQueries ?? [])} 卡片=${cards(t).length} ${J(cards(t).slice(0, 4).map((x) => x.name))}`,
    `     Credits：${fmtCr(c)}`,
    obsFieldLine(t),
    `     正式 Callback 呼叫（r14Calls）：${J(t.r14Calls ?? [])}`,
    `     回合起點 Session（r20Start）：${J(t.r20Start ? { location: t.r20Start.location, preferredArea: t.r20Start.preferredArea, tc: t.r20Start.tc?.destination, tpc: t.r20Start.tpc?.destination, rec: t.r20Start.rec?.destination } : null)}`,
    `     助理：${J((t.r20Assistant ?? t.r15Assistant ?? []).map((x) => String(x).slice(0, 120)))}${t.error ? ` ERROR=${t.error}` : ""}`,
  ];
}
function compactTurn(t, s) {
  const c = cr(t);
  return { i: t.turnIndex, text: t.text, ev: evOf(t, s), entry: entryTags(t), lc: F["location.city"](t), pa: F.preferredArea(t), tc: F["travelContext.destination"](t), tpc: F["tripPlanningContext.destination"](t), trip: F.tripDestination(t), pend: [F["pendingClarification.kind"](t), F["pendingClarification.rawGeographicLabel"](t)], rec: F["recommendationSession.destination"](t), geo: geoAll(t), places: t.placesQueries ?? [], cards: cards(t).length, prov: prov(t), credits: { begin: c.begin, rpc: c.rpc, settle: c.settle }, calls: t.r14Calls ?? [] };
}
const CROSS = [
  "  s1s4（scripts/verify-negated-switch-s1s4.mjs）S1～S6＝規格 9.2 R-S1～S6 的 MODEL 部分（s1s4 只呼叫純函式，類型 MODEL；不含正式 Callback）。",
  "  本檔 #97 新增 R-S1～S6 的整合部分（A2S-S1～S6；同句、前接正式回合「大阪推薦景點」）：證據逐回合標示，多為 MIRRORED_SEND+REAL_LIB，不是 ACTUAL_APP_CALLBACK；只有 path 含「|real:」或 r18 正式區塊記號（|r18:destSwitch(real)、|r18:fbContinue(real)=<值>、|r18:refineMore(real)=T；=fallthrough 不計）的回合（例 S4 若進 more／dc）才標 ACTUAL_APP_CALLBACK。",
  "  ★ 前置脈絡差異（#99-9）：本檔 A2S-S1～S6 前置脈絡為正式回合「大阪推薦景點」（Session 目的地＝大阪）；s1s4 Fixture 為京都（s1s4 L195 CITY＝京都、mk(京都,日本)，否定句中的「大阪」並非 Fixture 目的地）。切換句逐字相同；本檔期望依規格 9.2（金澤；不寫大阪／殘破），不沿用 s1s4 的「#3～#10＝京都」斷言，兩者結果不可直接互換。",
  "  本檔 R-T88-SWK「不想去大阪了，換金澤」與 S6「不想去大阪了，換成金澤」、S1「我不想去大阪了，換金澤」相近但句子不同；R-P1-03「不去大阪了，去京都玩」與 S3「不去大阪了，去金澤」同形（城市與活動尾不同）。",
  "  s1s4 PG-switch-qu-wan「去金澤玩」（MODEL 純函式 noPollution）≠ 本檔 R-P1-01（推薦回合整合）。",
  "  mp25-r4 GP-01「去金澤玩，推薦咖啡廳 → 再推薦幾個」＝本檔 A2S-P1-01 同句：GP 只記原始值（A～F、不判定）；本檔加 9.1 (a)～(g)、9.1b ①～⑦ 判定。",
  "  mp25-r4 GP-02「我想去福岡玩兩天 → 推薦咖啡廳」＝本檔 A2S-P1-02 前兩輪（本檔加第 3 輪「再推薦幾個」；Fixture 福岡同 GP_FUKUOKA）。",
  "  mp25-r4 GP-03（r15Init 注入大阪池＝INJECTED_STATE）↔ 本檔 A2S-P1-03（以正式回合「大阪推薦景點」建立脈絡）：同句、不同前提。",
  "  mp25-r4 GP-04／GP-06（INJECTED_STATE 金澤玩）＝規格 R-GP04／R-GP06；GP-07＝R-GP07（前提 UNVERIFIED）：本檔不重複收錄（原始 GP 情境保留於 mp25-r4，本檔未改）。",
  "  mp25-r4 GP-05「京都推薦景點 → 去金澤玩，再推薦幾個」＝本檔 A2S-P1-05 前兩輪（本檔加第 3 輪供 (g)）。GP-C1～C4 對照：本檔不重複。",
];
const NOT_INCLUDED = [
  "  R-P1-TAIL／R-P1-SPLIT／R-CPF-MODEL／R-ATS-MODEL／R-TI-MODEL：規格類型 MODEL（純函式），不屬整合情境；本檔不收（MODEL 不得當 PASS）。",
  "  R-GP04／R-GP06（INJECTED_STATE）、R-GP07（前提 UNVERIFIED）：已在 mp25-r4，不重複。",
];
/** #97-4：9.2～9.6 未收錄者一律 UNVERIFIED（不得為此重建 Harness）。 */
const UNV_92_96 = [
  "  9.2 R-PG（MODEL，s1s4 PROTECT 組）、R-TRI（4.3 句表，MODEL）、R-CRI270（3.3 表，MODEL）：MODEL 類型，本檔不收 → UNVERIFIED（以 s1s4／純函式腳本為準）。",
  "  9.2 R-CTD1144（MOCK：resolveMorePlacesTurnDestination spy）：A2S-S4／A2S-NU3 回合列會印 r15Flows，但未設專屬判定 → UNVERIFIED。",
  "  9.2 R-DGC300（INJECTED_STATE：destination_switch pending 建立）、R-Q1-1／R-Q1-2（需逐回合切換 Authority trusted／unavailable）、R-Q1-3（MODEL＋CB；「換一下」未收）→ UNVERIFIED。",
  "  9.3 R-PEND-4（#99-6；本檔已收 A2S-PEND4 但無證據）：initKind legacyNearby 注入後 r13:1452-1457 必走 legacy_nearby_pending(未重建) 並 return → 回合必為 MODEL；N8／B3 正式分支在現行 Harness 無證據 → UNVERIFIED。",
  "  9.3 R-E0-4（previous 不符）、R-E0-5（chat_shortcut 回合）、R-N4（chat_shortcut／home_mood／trip-add-place）：INJECTED_STATE／shortcut 來源，本檔未收 → UNVERIFIED。",
  "  9.4 R-RESET-1～4、R-DATE-1～4、R-Kb-1、R-Kb-2、R-Kc：reset 次數／planVersion／date_confirmation 無 spy 或需注入 → UNVERIFIED。",
  "  9.5 R-CH-1～4、R-LOCAL-9262、R-SAME、R-XCTRY、R-SCOPE-1／2、R-CTRY-1／2、R-EPOCH-1～3、R-GEO1、R-GEO-FAIL、R-PR、R-LOCALE、R-MULTI：9262／C3／countryHint／epoch 為 _app send 層（鏡像未同步）或需專用 Mock → UNVERIFIED。",
  "  9.6 R-EQ-1／2、R-DAYS-1／2、R-G3-1、R-REST、R-ID-*、R-OWNER、R-PD、R-CRED-1～4、R-LEG、R-NORM、R-X、R-S243、R-R21、R-R6：本檔未收 → UNVERIFIED（R-R21／R-R6 屬 r21 腳本本身）。",
];
export function report({ results, TREES, out }) {
  const trees = (TREES ?? ["work"]).filter((x) => Object.keys(results ?? {}).some((k) => k.startsWith(`${x}|`)));
  out.push("", "══════════════ A2 Source 情境（任務單 #95／#97；規格 9.1／9.1a／9.1b／9.1c／9.1c-1／9.1c-2／9.2 R-S*／9.3；verdict 以 work 樹為準）══════════════");
  out.push("  ★ 證據分類：ACTUAL_APP_CALLBACK＝path 含 |real:（r14 擷取正式 _app Callback／區塊實際執行）或 r18 正式區塊記號（|r18:destSwitch(real)、|r18:fbContinue(real)=<值>、|r18:refineMore(real)=T；=fallthrough 不計）；MIRRORED_SEND+REAL_LIB＝r13 鏡像 send＋真實 lib；MODEL／INJECTED_STATE／NOT-REACHED／UNVERIFIED 見檔頭。");
  out.push("  ★ r13 send() 為 _app send 重建鏡像；_app send 層新分支（:8009／:8837／:9387／C3／9262）須待 r21 r6 鏡像同步後才會被驅動。");
  out.push("  ★ 每案分開輸出「可觀測欄位判定」與「最終判定」；內部分支前提無 spy、規格必要欄位未記錄 → 最終 UNVERIFIED。weather 待裁決項：判定採含 weather 版，不含 weather 版另列。");
  out.push("  ★ #99-4：ACTUAL_APP_CALLBACK 另含 r18 正式區塊記號（|r18:destSwitch(real)、|r18:fbContinue(real)=<值>、|r18:refineMore(real)=T）；「=fallthrough」不計，另註明。命中 r18 記號之回合，進入正式區塊前的 send 路由仍為 r13 鏡像。");
  out.push("  ★ #101-2（加嚴 #99-5）：案例每個必要依據回合（含入口前提回合）任一不是 ACTUAL_APP_CALLBACK → 最終判定上限 UNVERIFIED，不得 PASS。");
  // ── harness integrity（#97-5；與功能判定分開）──
  let integrityOk = false;
  let integInfra = [];
  let integFc = 0;
  out.push("", "══ A Runner／Harness 完整性 ══");
  {
    const missing = [];
    const infra = [];
    const turnErr = [];
    const miss = new Set();
    const gaps = [];
    let ran = 0;
    let fc = 0;
    for (const s of scenarios) {
      const r = results?.[`work|ok|${s.id}`];
      if (!r) {
        missing.push(s.id);
        continue;
      }
      if (r.err || r.result?.error) {
        infra.push(`${s.id}:${String(r.err ?? r.result.error).slice(0, 80)}`);
        continue;
      }
      ran += 1;
      fc += Number(r.fetchCalls ?? 0);
      for (const m of r.result?.r14?.missing ?? []) miss.add(m);
      const turns = r.result?.turns ?? [];
      for (const t of turns) if (t.error) turnErr.push(`${s.id}/T${t.turnIndex + 1}:${String(t.error).slice(0, 60)}`);
      s.turns.forEach((spec, i) => {
        if (!turnOf(turns, i) && !(typeof spec === "object" && spec?.onlyIfClarified)) gaps.push(`${s.id}/T${i + 1}`);
      });
    }
    const ok = ran === scenarios.length && !infra.length && fc === 0 && !miss.size && !gaps.length;
    integrityOk = ok;
    integInfra = infra;
    integFc = fc;
    out.push(`  harness integrity（work；與功能判定分開，功能 FAIL 不計入此行）：情境 ${ran}/${scenarios.length} 已執行；未執行=${J(missing)}；INFRA／載入錯誤=${J(infra)}；fetchCalls 合計=${fc}；r14 未注入依賴=${J([...miss])}；非 onlyIfClarified 回合缺漏=${J(gaps)} → ${ok ? "OK" : "NG"}｜回合例外（需人工判讀是否屬 Harness）=${J(turnErr)}`);
  }
  const tally = {};
  const obsTally = {};
  const passEv = {};
  let pass = 0;
  let nonPass = 0;
  let looseDiff = 0;
  const caseRows = [];
  // #101-5：C／D／E／G 分區彙整（只收集已產生之判定與輸出行，不改判定邏輯）
  const safetyRows = [];
  const p1Rows = [];
  const infraRows = [];
  const extRows = [];
  const missRows = [];
  out.push("", "══ B 功能案例結果（逐情境／逐案；判定見各案「最終判定」）══");
  for (const s of scenarios) {
    const r = results?.[`work|ok|${s.id}`];
    out.push("", `[A2S][${s.id}] ${s.label}`);
    if (r && Number(r.fetchCalls ?? 0) > 0) extRows.push(`${s.id}:fetchCalls=${r.fetchCalls}`);
    if (!r) out.push("  work：本次未執行");
    else if (r.err || r.result?.error) out.push(`  work：INFRA ${String(r.err ?? r.result.error).slice(0, 240)}`);
    else {
      out.push(`  work fetchCalls(外部請求)=${r.fetchCalls ?? 0}`);
      const turns = [...(r.result?.turns ?? [])].sort((a, b) => a.turnIndex - b.turnIndex);
      for (const t of turns) out.push(...turnLines(t, s));
      out.push(`  情境 Provider 合計：${fmtProv(sumProv(turns))}`);
      out.push(`@@A2SRC@@${JSON.stringify({ tree: "work", sid: s.id, turns: turns.map((t) => compactTurn(t, s)) })}`);
    }
    for (const c of C.filter((x) => x.sid === s.id)) {
      const e = evalCase(c, r, s);
      out.push(`  ── ${c.id}（${c.g}；規格類型 ${c.spec}）期望：${c.expect}；r5 基準：${c.r5}`);
      out.push(...e.lines);
      out.push(`    最終判定（work）：${e.verdict}${e.why?.length ? `（${e.why.join("；")}）` : ""}`);
      for (const tree of trees.filter((x) => x !== "work")) out.push(`    對照 ${tree.padEnd(5)}：${evalCase(c, results?.[`${tree}|ok|${s.id}`], s).verdict}`);
      tally[e.verdict] = (tally[e.verdict] ?? 0) + 1;
      const ok2 = c.record ? "（記錄型，無可觀測判定）" : e.obs === "-" ? "（未執行／INFRA／無檢查）" : e.obs;
      obsTally[ok2] = (obsTally[ok2] ?? 0) + 1;
      if (e.loose && e.loose !== e.verdict) looseDiff += 1;
      if (e.verdict === P) {
        pass += 1;
        const key = [...new Set(e.evs)].sort().join("+") || "-";
        passEv[key] = (passEv[key] ?? 0) + 1;
      } else nonPass += 1;
      caseRows.push(`${c.id}=${e.verdict}／可觀測 ${e.obs}`);
      if (e.verdict === FAIL || e.verdict === "STOP") safetyRows.push(`  ${c.id}=${e.verdict}${e.why?.length ? `（${e.why.join("；")}）` : ""}`, ...e.lines.filter((x) => /^\s*\[FAIL\]|停止條件 .*：成立/.test(x)).map((x) => `    ${x.trim().slice(0, 300)}`));
      if (/^R-P1-/.test(c.id)) p1Rows.push(`${c.id}=${e.verdict}／可觀測 ${e.obs}`);
      if (e.verdict === "INFRA") infraRows.push(`${c.id}（${s.id}）`);
      if (e.verdict === UNV || e.verdict === NR || e.verdict === "NOT-RUN") missRows.push(`${c.id}=${e.verdict}${e.why?.length ? `（${e.why.join("；")}）` : ""}`);
    }
  }
  out.push("", "══ C SAFETY／P1（FAIL／STOP 案例與其 [FAIL] 檢查項；R-P1-* 結果）══");
  out.push(...(safetyRows.length ? safetyRows : ["  無 FAIL／STOP 案例"]));
  out.push(`  P1（R-P1-*）：${p1Rows.join("｜") || "-"}`);
  out.push("══ D INFRA ══", `  INFRA／載入錯誤（harness integrity）=${J(integInfra)}；INFRA 案例=${J(infraRows)}`);
  out.push("══ E external（外部請求；離線契約）══", `  fetchCalls 合計=${integFc}；有外部請求之情境=${J(extRows)}${extRows.length ? "（→ 對應案例 FAIL／STOP，立即回報指派者）" : ""}`);
  out.push("══ F Source／Git SHA ══", "  由外部記錄（runner 外部記錄 Source／Git SHA；本檔不讀取）");
  out.push("══ G MISSING／UNVERIFIED ══", `  UNVERIFIED／NOT-REACHED／NOT-RUN 案例（${missRows.length}）：${missRows.join("｜") || "-"}`);
  out.push("", "── G-1 A2 Source：規格必要、Harness 未記錄之觀測欄位（#97-6；r13／r14 受 sha 綁定不得修改 → UNVERIFIED）──");
  for (const k of Object.values(NEED)) out.push(`  ${k.label}：${k.fn()[1]}`);
  out.push("  分支前提 spy（dtp:398-399／:421-431、tpc:146-153／:738／:741／:756、trip-intent:93-131、matchLeadingNegatedClause form、turnSwitch、:8837／:9387 中間值、reset 次數）：無");
  out.push("── G-2 A2 Source：9.2～9.6 未收錄 → UNVERIFIED（#97-4）──", ...UNV_92_96);
  out.push("", "══ 附錄（說明）與總計 ══");
  out.push("── A2 Source：Provider 期望與 weather prefetch（#97-3）──");
  out.push("  含 weather（規格原文明示）：9.1c-1 #5「任何 query」／#9「不重新 geocode」、9.1a R-NEG-*「geocode＝0」、R-T88-NEGK「④ 皆 0」、R-B5-AROUND「0 geocode」、9.3 R-NU-1／3「geocode=0」、R-E0-2「0 付費」；「只可能『富良野』≤1」依 (b)「geocode spy 全部 query」計全部。");
  out.push(`  待指派者裁決（規格只寫「0 Provider（本地）」）：R-P1-01／R-P1-05／R-P1-NC (b)、R-T88-GP01／R-T88-NC ④、R-B5-TO3 G → 判定採含 weather 版；不含 weather 版另列；兩版最終判定不同的案例數=${looseDiff}。`);
  out.push("── A2 Source：未收錄（規格類型非整合情境或已在他檔）──", ...NOT_INCLUDED);
  out.push("── A2 Source：與 s1s4／mp25-r4 交叉對照 ──", ...CROSS);
  out.push(`── A2 Source：逐案（最終／可觀測）──`, `  ${caseRows.join("｜")}`);
  const cnt = (k) => tally[k] ?? 0;
  out.push(`A2 Source（work）：案例=${C.length}；PASS=${cnt(P)} FAIL=${cnt(FAIL)} NOT-REACHED=${cnt(NR)} UNVERIFIED=${cnt(UNV)} BASELINE=${cnt(BL)} RECORD=${(tally.RECORD ?? 0) + (tally["RECORD（含 MODEL 回合）"] ?? 0)} STOP=${cnt("STOP")} INFRA=${cnt("INFRA")} NOT-RUN=${cnt("NOT-RUN")}；判定分佈=${J(tally)}；PASS 之證據組成=${J(passEv)}；非 PASS=${nonPass}（r5 基準預期有 FAIL；BASELINE／UNVERIFIED／NOT-REACHED／RECORD 皆不計 PASS）`);
  // ── #99-2：可觀測欄位判定分佈（施工前後比較之主指標；只依 Harness 已記錄欄位，不含前提／未記錄欄位／證據類型上限）──
  const ocnt = (k) => obsTally[k] ?? 0;
  out.push(`A2 Source（work）可觀測欄位判定分佈（主指標）：PASS=${ocnt(P)} FAIL=${ocnt(FAIL)} NOT-REACHED=${ocnt(NR)} UNVERIFIED=${ocnt(UNV)}｜另列：BASELINE=${ocnt(BL)} 記錄型=${ocnt("（記錄型，無可觀測判定）")} 未執行／INFRA／無檢查=${ocnt("（未執行／INFRA／無檢查）")}；完整=${J(obsTally)}`);
  // 最終 PASS 靜態不可達原因（逐案；判定邏輯不變，只揭露）
  const blockOf = (c) => {
    const b = [];
    if (c.record) b.push("記錄型");
    if (c.premise.internal) b.push("內部分支前提無 spy");
    if ((c.need ?? []).length || (c.unv ?? []).length) b.push("規格必要欄位未記錄");
    const sc = scenarios.find((x) => x.id === c.sid);
    if (isInjected(sc) && /CB/.test(c.spec) && !/MODEL/.test(c.spec)) b.push("CB 以 INJECTED_STATE 驅動");
    if (c.checks.some((k) => /本次記錄/.test(k.label))) b.push("含恆為 BASELINE 之欄位");
    return b;
  };
  const why = {};
  const free = [];
  for (const c of C) {
    const b = blockOf(c);
    if (!b.length) free.push(c.id);
    for (const x of b) why[x] = (why[x] ?? 0) + 1;
  }
  out.push(
    free.length
      ? `本 Harness 最終 PASS 未能靜態證明不可達：${free.length} 案無靜態阻擋（${J(free)}），只受執行期「每個必要依據回合皆須 ACTUAL_APP_CALLBACK」上限把關；其餘 ${C.length - free.length} 案靜態不可達（原因次數=${J(why)}）`
      : `本 Harness 最終 PASS 不可達：原因＝全部 ${C.length} 案皆至少有一項靜態阻擋（原因次數，一案可多項=${J(why)}；另：任一必要依據回合非 ACTUAL_APP_CALLBACK 時上限 UNVERIFIED）。最終判定不作施工前後比較主指標，請改用上一行「可觀測欄位判定分佈」。`,
  );
  // ── #99-3：fail 只計 FAIL／STOP／INFRA 與 harness integrity NG；UNVERIFIED／BASELINE／RECORD／NOT-REACHED／NOT-RUN 不計 ──
  const failN = cnt(FAIL) + cnt("STOP") + cnt("INFRA") + (integrityOk ? 0 : 1);
  out.push(`A2 Source（work）回傳 fail=${failN}（FAIL=${cnt(FAIL)} STOP=${cnt("STOP")} INFRA=${cnt("INFRA")} harness integrity=${integrityOk ? "OK(0)" : "NG(+1)"}）｜不計入 fail：UNVERIFIED=${cnt(UNV)} BASELINE=${cnt(BL)} RECORD=${(tally.RECORD ?? 0) + (tally["RECORD（含 MODEL 回合）"] ?? 0)} NOT-REACHED=${cnt(NR)} NOT-RUN=${cnt("NOT-RUN")}`);
  return { fail: failN, pass };
}
