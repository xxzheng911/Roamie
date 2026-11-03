// verify-chat-generation-lock-authorized-diff.mjs — 任務單 #L1-T2：行程生成全域鎖的「授權變更」精確比對
//
// 背景：#L1 授權修改 src/routes/_app.chat.tsx（sha256 前 16 碼 95e7866a0e96f036 → bb3a7f395ea8d58e；
//   #L1-T3 第 2 輪 → 1f9f6c91787031f6，只新增：清除聊聊上鎖、離開原對話時的失敗提示、提示改用 notify* 於顯示當下取語系；
//   #L1-T4 第 3 輪 → 8e2dd996d9c89771，只新增：入口 entry_blocked 通知、detachedFailureReasonKey（capacity）、apiEmpty／offerMustVisit
//   既有 toast 只在原對話、保存後 ownership 失效發完成提示、finally 通知 try／catch）與
//   src/components/chat/ChatComposer.tsx。多個 Duo 腳本原本以 sha／「相對 HEAD 無變更」斷言「聊聊頁未被改動
//   （Duo 段落、React 樹不變）」。本模組把 #L1 新增的段落逐字移除，移除後必須：
//   - _app.chat.tsx 與 #L1 改動前版本（sha256 95e7866a0e96f036540d1e6402534f02ac436ce9f0a431bc48f6f6de5790a5f4）逐字相同
//   - ChatComposer.tsx 與 HEAD 逐字相同
//   每一段都必須「恰好出現一次」（或列明的次數），任何多出、少掉、改寫的段落都會失敗，
//   因此「聊聊頁除了生成鎖以外沒有其他變更」的語意被完整保留。
//
// 供其他 verify 腳本 import；直接執行時自行檢查並印出結果：
//   node scripts/verify-chat-generation-lock-authorized-diff.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export const CHAT_TSX_PRE_LOCK_SHA256 = "95e7866a0e96f036540d1e6402534f02ac436ce9f0a431bc48f6f6de5790a5f4";
// #L1-T3：第 2 輪（清除聊聊上鎖、離開原對話時的失敗提示、提示文案改在顯示當下取目前語系）授權變更：
//   bb3a7f395ea8d58e 作廢 → 1f9f6c91787031f6。
// #L1-T4：第 3 輪（不在原對話時一次失敗只一則提示、具體原因 capacity、入口 entry_blocked 通知、
//   保存後 ownership 失效改發完成提示、finally 通知 try／catch 後一定 settle）授權變更：1f9f6c91787031f6 作廢 → 8e2dd996d9c89771。
// #PL-FIX：Planner 選擇入口 A2 信任閘門（使用者授權）：8e2dd996d9c89771 作廢 → dbbc53b4ed12c5c7。
//   只新增／改寫 PL_HUNKS 列出的段落（E1 初始推薦閘門、E2 補充推薦閘門與換城市詢問、E4 卡片範圍檢查、
//   相關 import／型別／state／chips）。移除 PL_HUNKS 與 CHAT_HUNKS 後仍必須逐字等於 95e7866a…。
// #PL-FIX-T2：第 2 輪（使用者授權）dbbc53b4ed12c5c7 作廢 → ac179ee36a0e55b8。新增內容全部落在既有 4 個範圍段落內：
//   型別 PlanningSelectionSwitchPending 加 center（約 L887-892）、E1 不帶國家前綴＋上一層退回一次（約 L3478-3500）、
//   確認換城市以閘門結果 leavePlanningSelection(…, { destination, center })（約 L8633-8646）、
//   E2 resolvePlanningSelectionTurnDestination＋同目的地上一層退回（約 L9471-9490）與 pending.center（約 L9520）。
//   字面段落與起訖標記不變，只更新這 4 段的 sha16。
// #PL-FIX-T3：第 3 輪（使用者授權）ac179ee36a0e55b8 作廢 → 1e6ef32c0ca3cc30。新增：dropStalePlanningSelection 的 import（約 L247）、
//   persistSession 開頭清除過期 selection（約 L2097-2104，參數改名 nextInput）、place-detail（約 L10284）、
//   一般路徑 mergeTripPlanningContext 之後（約 L10980-10983）四組字面段落；E1（約 L3483-3500）與 E2（約 L9471-9537）
//   範圍段落改寫，sha16 分別為 ce46119371c60f90、ab6254f1e5717a6c。
// #PL-FIX-T4：第 4 輪（使用者裁定「先查再決定」）1e6ef32c0ca3cc30 作廢 → ce9c70275a3767cb。新增：
//   import consumeStalePlanningSelectionDrop／keepPlanningSelectionDestination（約 L247、L253）、planningSelectionTurnNamesPlace（約 L414）、
//   型別 PlanningSelectionSwitchPending.entry（約 L897-899，範圍段落）、確認後重跑原句的 ref／effect（約 L1755-1766）、
//   persistSession 的「已離開…的選點」提示（約 L2122-2132）與依賴 [hasPlusAccess, locale]（約 L2224）、
//   trip-add-place 兩處 setSession 改用 persistSession 回傳值（約 L3844-3845、L3903-3904）、
//   確認換城市 entry === "general" 時改為重跑原句（約 L8684-8690，範圍段落）、一般／place-detail 路徑 A2 閘門（約 L10204-10334，新範圍段落）、
//   place-detail 與一般路徑 keepPlanningSelectionDestination（約 L10452-10458、L11158-11164）。
//   有改變的範圍段落以 round4Delta 逐字移除第 4 輪新增行後，必須等於第 3 輪 sha16（證明範圍內沒有其他改寫）。
// #PL-FIX-T5：第 5 輪（使用者裁定「縮小攔截範圍」）ce9c70275a3767cb 作廢 → 2bc817610e013c60。新增／改寫：
//   import planningSelectionTurnWrittenDestination（約 L256）、planningSelectionTurnRequestsSwitch（約 L416）、
//   重跑 effect 帶 selectionSwitchResend 並新增「被 streaming／generating 擋下時等待後重跑」effect（約 L1765-1773）、
//   send() opts 型別 selectionSwitchResend（約 L8600）、重跑攔截（約 L8615-8639，新範圍段落）、
//   回合開始清除殘留的過期清除紀錄（約 L8662-8663）、一般／place-detail A2 閘門改為只看本回合實際寫入的名稱（約 L10243-L10399，範圍段落新 sha16）、
//   place-detail keep 改為 keepSelectionTurnDestination（約 L10515-10516）、merge 後還原 selection 目的地（約 L11033-L11068，新範圍段落）、
//   advice 分支 keep（約 L11226-11237）、結尾 keep 改在 dropStale 之前且不限閘門焦點（約 L11262-11264）。
// #PL-FIX-T6：第 6 輪（使用者裁定 R1-R5）2bc817610e013c60 作廢 → 7ff4df2cd156c85b。新增／改寫：
//   import planningSelectionTurnSwitchTarget／planningSelectionWrittenLeadingCity（約 L417-418）、
//   一般／place-detail A2 閘門（約 L10245-L10432，範圍段落新 sha16 0419a284c4a2f8ac；閘門抽成 runSelectionTurnGate）、
//   pending parent_city_scope 回答閘門（約 L10899-10907）、pending destination_area 回答閘門（約 L10962-10970）、
//   advice 分支 keepSelectionAdvicePatch（約 L11286-11311）。其餘範圍段落 sha16 不變。
// #PL-FIX-T7：第 7 輪（使用者裁定 1-8）7ff4df2cd156c85b 作廢 → d12bf2eab910534c。新增／改寫（皆以 // #PL-FIX-T7 標記；
//   例外：import 清單內的行、label 區塊內未重新縮排的既有程式碼、兩個 pending 閘門 label 獨立一行）：
//   import clear／peek／setPlanningSelectionTurnNotice（約 L260-262）、isGeocodeZeroResultsEnvelope／
//   planningSelectionTurnMentionsPlaceIncidentally（約 L420-421）、「找不到」提示 effect（約 L1781-1795）、
//   回合開始清除提示（約 L8686-8687）、selectionSwitchDeferred 宣告（約 L9024-9025）、A2 區塊內 selection 先問／交給 G1
//   （約 L9172-9233 範圍段落、L9481 結尾標記、L9484-9489 閘門條件）、G1 範圍段落新 sha16、pending parent／area 的 label 與
//   unverified break（約 L11048-11067、L11122-11138）、advice 分支 keepSelectionAdviceTurn／keepSelectionAdviceContext
//   （約 L11455-11464）、style planning（約 L11760-11767）、early planning（約 L12855-12864）。
//   T7 段落一律以「第 7 輪 → 第 6 輪」字面還原（T7_LITERAL_HUNKS，先於第 6 輪以前的段落處理），證明 T7 只動了這些行。
// #PL-FIX-T8：第 8 輪（使用者裁定 1-4）d12bf2eab910534c 作廢 → e411fd18b90daa44。新增／改寫（皆以 // #PL-FIX-T8 標記）：
//   import remember／clear／takeConfirmedPlanningSelectionSwitch（L264）、planningSelectionTurnNearbyAnchor（L438）、
//   回合開始清除確認記錄（L8688）、確認時記錄（L8754-8758，位於「確認／取消回答」範圍段落內）、A2 取用記錄並拿掉
//   tripDestination（L9295-9308）、包住 E3（L9493-9494、L9504；內層既有程式碼未重新縮排）、G1 範圍段落內：附近錨點
//   （L10429-10440）、提示條件（L10605）、附近句恢復原處理（L10619-10625）。
//   T8 段落一律以「第 8 輪 → 第 7 輪」字面還原（T8_LITERAL_HUNKS，最先處理）；G1 範圍段落另以 t8Delta 證明：
//   目前內容 sha16 fdcdd84ab7b643ba（實作者回報 5c02fe052abb4e6f，與實算不符），逐字還原 T8 行後等於第 7 輪 c353d510f37f10ac；
//   「確認／取消回答」範圍目前 c25bc01cc6f51895，還原後等於 569087c0f5b15a47。
export const CHAT_TSX_LOCK_SHA16 = "e411fd18b90daa44";

const NOTICE = 'blockIfChatGenerationLocked(t("uiCoverage.chatGenerationLockedNotice"))) return;\n';

// [目前內容, 改動前內容, 預期出現次數]
const CHAT_HUNKS = [
  [
    'import { useI18n } from "@/hooks/use-i18n";\nimport {\n  beginChatGenerationLock,\n  blockIfChatGenerationLocked,\n  endChatGenerationLock,\n  isChatGenerationLocked,\n  isChatPageMounted,\n  markChatPageMounted,\n  notifyChatGenerationDone,\n  notifyChatGenerationFailed,\n  useChatGenerationLock,\n} from "@/lib/ai/chat-generation-lock";\n',
    'import { useI18n } from "@/hooks/use-i18n";\n',
  ],
  ["  const generationLock = useChatGenerationLock();\n", ""],
  ["    const releaseChatPageMount = markChatPageMounted();\n", ""],
  ["      releaseChatPageMount();\n", ""],
  [
    "  /**\n   * L1: 生成完成時是否仍在「原對話」。本實例仍掛載＝原對話（現行行為）；已卸載時，\n   * 只有聊聊頁仍掛載且目前 Session 的 planningSessionId 相同（例如 Plus 從草稿回到同一對話）才算。\n   */\n  const isOriginalConversation = useCallback((planningSessionId: string | undefined) => {\n    if (!chatUnmountedRef.current) return true;\n    return isChatPageMounted() && loadChatSession().planningSessionId === planningSessionId;\n  }, []);\n",
    "",
  ],
  [
    '      // L1: 已卸載的實例（例如舊生成完成）不得把自己的 Session 寫進另一個對話。\n      if (\n        chatUnmountedRef.current &&\n        loadChatSession().planningSessionId !== next.planningSessionId\n      ) {\n        console.info("[STALE_SESSION_RESULT_DISCARDED]", {\n          stage: "persist_after_unmount",\n          unmounted: true,\n          sessionChanged: true,\n          versionChanged: false,\n        });\n        return next;\n      }\n',
    "",
  ],
  ["        // L1: 生成鎖住時不自動執行任何帶入（不送出 AI／Places／Credits 請求）。\n        const generationLocked = isChatGenerationLocked();\n", ""],
  ["if (shouldRunHandoff && handoffKey && !generationLocked) {", "if (shouldRunHandoff && handoffKey) {"],
  ["if (shouldRunTripAddPlaceHandoff && !generationLocked) {", "if (shouldRunTripAddPlaceHandoff) {"],
  ["            !planHandoffStartedRef.current &&\n            !generationLocked\n", "            !planHandoffStartedRef.current\n"],
  ["    // L1: 只靠 UI disabled 不夠；生成鎖住時一律不送出新請求。\n    if (isChatGenerationLocked()) return;\n", ""],
  // #L1-T3：清除聊聊（confirmClearChat）
  [
    "    if (streaming || generating || clearing) return;\n    if (isChatGenerationLocked()) return;\n",
    "    if (streaming || generating || clearing) return;\n",
  ],
  ["disabled={streaming || generating || clearing || generationLock.locked}", "disabled={streaming || generating || clearing}"],
  // 自動 prompt、ai_chat／ai_shortcut 登入後續傳各一處
  ["    if (isChatGenerationLocked()) return;\n", "", 3],
  [
    "    // L1: 全域生成鎖（與 runDirectItinerary／persistGeneratedPlan 同 owner 時只計數）。\n    const generationLockOwner = ownership?.generationId || `generate:${crypto.randomUUID()}`;\n    const generationOriginSessionId = activeSession.planningSessionId;\n",
    "",
  ],
  ["    beginChatGenerationLock(generationLockOwner);\n", ""],
  [
    '      if (isOriginalConversation(generationOriginSessionId)) {\n        logTripLifecycle("navigation_started");\n        const navigation = navigate(tripDetailNavigateOptions(saved.id));\n        await Promise.resolve(navigation);\n        logTripLifecycle("navigation_completed", { success: true });\n      } else {\n        // L1: 使用者已不在原對話（別頁或新對話）：不自動導向，改顯示「行程已完成」提示。\n        console.info("[CHAT_GENERATION_DONE_DETACHED]", { generationId, tripId: saved.id });\n        notifyChatGenerationDone(() => {\n          void navigate(tripDetailNavigateOptions(saved.id));\n        });\n      }\n',
    '      logTripLifecycle("navigation_started");\n      const navigation = navigate(tripDetailNavigateOptions(saved.id));\n      await Promise.resolve(navigation);\n      logTripLifecycle("navigation_completed", { success: true });\n',
  ],
  // #L1-T4（第 3 輪）：finally 的失敗通知改帶具體原因 key，且以 try／catch 包住（通知例外不得阻斷 Credits settle）
  [
    '      endChatGenerationLock(generationLockOwner);\n      // L1: 使用者已不在原對話時，失敗改以頂部提示通知（仍在原對話則沿用聊天卡片，不重複）。\n      // 通知例外不得阻斷下方 Credits settle。\n      try {\n        if (!itinerarySucceeded && !isOriginalConversation(generationOriginSessionId)) {\n          notifyChatGenerationFailed(generationLockOwner, detachedFailureReasonKey);\n        }\n      } catch (notifyError) {\n        console.warn("[CHAT_GENERATION_NOTIFY_FAILED]", notifyError);\n      }\n',
    "",
  ],
  // #L1-T4（第 3 輪）1：handleGenerateItinerary 入口 entry_blocked（有 ownership＝呼叫端已上鎖）且不在原對話時通知失敗
  [
    "      // L1: 呼叫端（runDirect／persist）已上鎖；使用者已不在原對話時不得靜默解鎖，改發失敗提示。\n      if (ownership && !isOriginalConversation(activeSession.planningSessionId)) {\n        notifyChatGenerationFailed(ownership.generationId);\n      }\n",
    "",
  ],
  // #L1-T4 2：不在原對話時失敗提示的具體原因 key
  [
    "    // L1: 不在原對話時失敗提示的具體原因（完整 i18n key）；未設定則用通用文案。\n    let detachedFailureReasonKey: string | undefined;\n",
    "",
  ],
  // #L1-T4 3：apiEmpty 的既有 toast 只在原對話顯示（縮排 10）
  [
    "          // L1: 不在原對話時只留 finally 的單一失敗提示（此訊息無 i18n key，用通用文案）。\n          if (prepared.apiEmpty && isOriginalConversation(generationOriginSessionId)) {",
    "          if (prepared.apiEmpty) {",
  ],
  // #L1-T4 4：容量超過時的具體原因
  ['          detachedFailureReasonKey = "chatRuntime.capacity";\n', ""],
  // #L1-T4 5：offerMustVisit 的既有 toast 只在原對話顯示（縮排 8）
  [
    "        // L1: 不在原對話時只留 finally 的單一失敗提示（此訊息無 i18n key，用通用文案）。\n        if (createResult.offerMustVisit && isOriginalConversation(generationOriginSessionId)) {",
    "        if (createResult.offerMustVisit) {",
  ],
  // #L1-T4 6：已保存後 ownership 失效（entry_blocked）且不在原對話時發完成提示
  [
    "        // L1: 行程已保存成功；使用者已不在原對話時改發完成提示（不導向、不發失敗提示）。\n        if (!isOriginalConversation(generationOriginSessionId)) {\n          notifyChatGenerationDone(() => {\n            void navigate(tripDetailNavigateOptions(saved.id));\n          });\n        }\n",
    "",
  ],
  // #L1-T3：runDirectItinerary 的 prepare 失敗（縮排 8）與 catch（縮排 6）各一處；先移除縮排 8（後者是其子字串）
  ["        if (!isOriginalConversation(activeSession.planningSessionId)) notifyChatGenerationFailed(generationRequestId);\n", ""],
  ["\n      if (!isOriginalConversation(activeSession.planningSessionId)) notifyChatGenerationFailed(generationRequestId);\n", "\n"],
  ["      beginChatGenerationLock(generationId);\n", ""],
  ["        endChatGenerationLock(generationId);\n", ""],
  ["    beginChatGenerationLock(generationRequestId);\n", ""],
  ["      endChatGenerationLock(generationRequestId);\n", ""],
  // 先移除推薦卡兩處（縮排 14），再移除 retry 一處（縮排 4；前者是後者的超集合字串）
  ["              if (" + NOTICE, "", 2],
  ["\n    if (" + NOTICE, "\n"],
  ["disabled={streaming || generating || generationLock.locked}", "disabled={streaming || generating}"],
  [
    '            generating={generating || generationLock.locked}\n            lockedPlaceholder={\n              generationLock.locked ? t("uiCoverage.chatGenerationLockedPlaceholder") : undefined\n            }\n            lockedHint={\n              generationLock.locked && generationLock.slow\n                ? t("uiCoverage.chatGenerationSlowHint")\n                : undefined\n            }\n',
    "            generating={generating}\n",
  ],
];

// #PL-FIX：Planner 選擇入口段落。字面段落用 [目前, 改動前]；長段落以起訖標記界定，目前內容以 sha256 前 16 碼釘死
// （任何改寫都會使 sha 不符而失敗），再換回改動前內容。
//   { start, end, endInclusive, sha16, orig, label }：從 start 第一次出現處到其後第一個 end（含 end 與否由 endInclusive 決定）。
// #PL-FIX-T8（第 8 輪）：最先把第 8 輪的行逐字還原成第 7 輪的樣子（[第 8 輪, 第 7 輪]，各恰好一次）。
//   還原後「確認／取消回答」範圍段落回到 569087c0f5b15a47、G1 範圍段落回到 c353d510f37f10ac（第 7 輪授權值），
//   證明 T8 在這兩個範圍內只動了下列行。
const T8_LITERAL_HUNKS = [
  // import（planning-selection；L264）
  [
    'import { rememberConfirmedPlanningSelectionSwitch, clearConfirmedPlanningSelectionSwitch, takeConfirmedPlanningSelectionSwitch } from "@/lib/planning-selection"; // #PL-FIX-T8\n',
    "",
  ],
  // import（chat-turn-destination；L438）
  ['import { planningSelectionTurnNearbyAnchor } from "@/lib/ai/chat-turn-destination"; // #PL-FIX-T8\n', ""],
  // 回合開始清除確認記錄（L8688）
  ["    clearConfirmedPlanningSelectionSwitch(trimmed); // #PL-FIX-T8: only its own sentence keeps it\n", ""],
  // 確認時記錄（L8754-8758；「確認／取消回答」範圍段落內）
  [
    "          // #PL-FIX-T8: the re-sent switch sentence applies this confirmed switch (A2 wrapper).\n          rememberConfirmedPlanningSelectionSwitch({\n            destination: selectionSwitchAsked.destination,\n            originalUserText: selectionSwitchAsked.originalUserText,\n          });\n",
    "",
  ],
  // A2 取用記錄，必要時拿掉 tripDestination（L9295-9308）
  [
    `      // #PL-FIX-T8: the re-sent sentence of a confirmed Planner selection switch: the trip
      // destination already names the confirmed target (written when the user confirmed), so the
      // wrapper reads the previous destination without that placeholder (never a no-op switch).
      const confirmedSelectionSwitch = takeConfirmedPlanningSelectionSwitch(trimmed);
      const confirmedSelectionSwitchTarget =
        Boolean(confirmedSelectionSwitch) &&
        isEquivalentSwitchDestination({
          label: confirmedSelectionSwitch?.destination,
          trusted: trustedDestination,
          ctx: p1Ctx,
          session: switchBase,
          locale,
        });
      if (confirmedSelectionSwitchTarget) switchBase.tripDestination = undefined; // #PL-FIX-T8
`,
    "",
  ],
  // 包住 E3（L9493-9494 開頭、L9504 結尾；內層既有程式碼未重新縮排）
  [
    "        // #PL-FIX-T8: a confirmed selection switch goes on to this turn's recommendations.\n        if (!confirmedSelectionSwitchTarget) { // #PL-FIX-T8\n",
    "",
  ],
  ["        } // #PL-FIX-T8\n", ""],
  // G1 範圍段落內：附近錨點（L10429-10440）
  [
    `    // #PL-FIX-T8: an explicit nearby turn is gated when the written name is the nearby anchor itself
    // (「大阪附近」「京都車站附近」: another trusted city is asked first); a landmark anchor
    // (「大阪道頓堀附近」), a same-city / unnamed anchor goes on as before.
    const selectionTurnWrittenRaw = selectionTurnKeep
      ? planningSelectionTurnWrittenDestination(
          session,
          mergeTravelContext(applyTripIntentToSession(trimmed, session), trimmed).session,
        )
      : undefined;
    const selectionTurnWrittenName = explicitNearbyAuthority
      ? planningSelectionTurnNearbyAnchor(trimmed, selectionTurnWrittenRaw)
      : selectionTurnWrittenRaw;
`,
    `    const selectionTurnWrittenName =
      selectionTurnKeep && !explicitNearbyAuthority
        ? planningSelectionTurnWrittenDestination(
            session,
            mergeTravelContext(applyTripIntentToSession(trimmed, session), trimmed).session,
          )
        : undefined;
`,
  ],
  // G1 範圍段落內：「找不到」提示只在明確換城市措辭（L10605）
  ["          selectionTurnSwitchTarget && // #PL-FIX-T8: only explicit switch wording names a place\n", ""],
  // G1 範圍段落內：附近句沒問時恢復原本的處理（L10619-10625）
  [
    `    // #PL-FIX-T8: an explicit nearby turn that was not asked keeps its earlier selection handling
    // (the anchor only decided whether to ask; no focus / cleanup from it).
    if (selectionTurnKeep && explicitNearbyAuthority && !selectionTurnSwitchTarget) {
      selectionTurnFocus = undefined;
      selectionTurnFocusInside = false;
      selectionTurnUnverifiedName = undefined;
    }
`,
    "",
  ],
];
// #PL-FIX-T7（第 7 輪）：先把第 7 輪的行逐字還原成第 6 輪的樣子（[第 7 輪, 第 6 輪]），之後的段落與第 6 輪相同。
const T7_LITERAL_HUNKS = [
  // import（planning-selection；約 L260-262）
  [
    "  togglePlanningSelectionPlace,\n  clearPlanningSelectionTurnNotice,\n  peekPlanningSelectionTurnNotice,\n  setPlanningSelectionTurnNotice,\n} from \"@/lib/planning-selection\";\n",
    "  togglePlanningSelectionPlace,\n} from \"@/lib/planning-selection\";\n",
  ],
  // import（chat-turn-destination；約 L420-421）
  [
    "  planningSelectionTurnRequestsSwitch,\n  isGeocodeZeroResultsEnvelope,\n  planningSelectionTurnMentionsPlaceIncidentally,\n  planningSelectionTurnSwitchTarget,\n",
    "  planningSelectionTurnRequestsSwitch,\n  planningSelectionTurnSwitchTarget,\n",
  ],
  // 「找不到」提示 effect（約 L1781-1795）
  [
    `  // #PL-FIX-T7: Planner selection turn notice (the written place had no geocoding result): one line
  // after that turn's reply, never before it and never blocking it. Only for the turn that set it
  // (its user message is still at the same position) once its reply has arrived.
  useEffect(() => {
    if (streaming || generating) return;
    const notice = peekPlanningSelectionTurnNotice();
    if (!notice) return;
    const turnUserMsg = msgs[notice.conversationLength];
    if (turnUserMsg?.role !== "user" || turnUserMsg.content !== notice.userText) return;
    if (msgs.length < notice.conversationLength + 2 || msgs[msgs.length - 1]?.role !== "assistant") {
      return;
    }
    clearPlanningSelectionTurnNotice();
    setMsgs((prev) => [...prev, { role: "assistant", content: notice.message }]);
  }, [msgs, streaming, generating]);
`,
    "",
  ],
  // 回合開始清除提示（約 L8686-8687）
  ["    // #PL-FIX-T7: a selection turn notice an earlier turn left unshown never reaches this turn.\n    clearPlanningSelectionTurnNotice();\n", ""],
  // selectionSwitchDeferred 宣告（約 L9024-9025）
  ["    // #PL-FIX-T7: a Planner selection confirmed-switch sentence handed to the selection general path.\n    let selectionSwitchDeferred = false;\n", ""],
  // A2 label 區塊結尾（約 L9481）
  ["      } // #PL-FIX-T7: end selectionConfirmedSwitch\n", ""],
  // A2 單一閘門條件（約 L9484-9489；第 6 輪為單行）
  [
    "    // #PL-FIX-T7: or a Planner selection sentence deferred to the selection general path above.\n    if (\n      (switchFromPendingConfirm || turnSwitch.state !== \"NO_SWITCH\") &&\n      !turnSwitchVerified &&\n      !selectionSwitchDeferred\n    ) {\n",
    "    if ((switchFromPendingConfirm || turnSwitch.state !== \"NO_SWITCH\") && !turnSwitchVerified) {\n",
  ],
  // pending parent_city_scope：label（獨立一行）與 unverified break（約 L11048-11049、L11065-11067）
  ["      // #PL-FIX-T7: label for leaving this answer to the general flow (Planner selection only).\n      selectionPendingParentAnswer:\n", ""],
  [
    "          // #PL-FIX-T7: unconfirmed (Google transient failure included): never isolate / drop the\n          // selection / recommend there; the general flow answers with the selection's destination.\n          if (gate.kind === \"unverified\") break selectionPendingParentAnswer;\n",
    "",
  ],
  // pending destination_area：label（獨立一行）、上一層城市也送閘門、unverified break（約 L11122-11138）
  ["      // #PL-FIX-T7: label for leaving this answer to the general flow (Planner selection only).\n      selectionPendingAreaAnswer:\n", ""],
  [
    "        // #PL-FIX-T7: or the restored parent city itself (「雲場池」＋「輕井澤」), same single gate.\n        const restoredOtherCity = selectionTurnKeep\n          ? planningSelectionWrittenLeadingCity(restored.destinationLabel) ||\n            restored.parentCity?.trim() ||\n            undefined\n          : undefined;\n",
    "        const restoredOtherCity = selectionTurnKeep\n          ? planningSelectionWrittenLeadingCity(restored.destinationLabel)\n          : undefined;\n",
  ],
  [
    "          // #PL-FIX-T7: unconfirmed (Google transient failure included): never isolate / drop the\n          // selection / recommend there; the general flow answers with the selection's destination.\n          if (gate.kind === \"unverified\") break selectionPendingAreaAnswer;\n",
    "",
  ],
  // advice 分支（約 L11455-11464）：第 6 輪的 keepSelectionAdvicePatch 改為共用 keepSelectionAdviceTurn（定義在 G1 範圍段落）
  [
    `      // #PL-FIX-T6: the advice contextPatch (re-applied when the turn persists) keeps the
      // selection's destination too: never another city / an unverified name.
      // #PL-FIX-T7: shared with the other completeAdviceTurn callers (keepSelectionAdviceTurn).
      const turn = selectionTurnKeep
        ? keepSelectionAdviceTurn({ ...adviceTurn, session: keepSelectionTurnDestination(adviceTurn.session) })
        : adviceTurn;
`,
    `      // #PL-FIX-T6: the advice contextPatch (re-applied when the turn persists) keeps the
      // selection's destination too: never another city / an unverified name.
      const keepSelectionAdvicePatch = (kept: typeof adviceTurn): typeof adviceTurn => {
        const patch = kept.advice.contextPatch;
        if (!patch) return kept;
        const keptContext = kept.session.travelContext;
        return {
          ...kept,
          advice: {
            ...kept.advice,
            contextPatch: {
              ...patch,
              ...("destination" in patch ? { destination: keptContext?.destination } : {}),
              ...("destinationCandidate" in patch
                ? { destinationCandidate: keptContext?.destinationCandidate }
                : {}),
              ...("destinationInputNames" in patch
                ? { destinationInputNames: keptContext?.destinationInputNames }
                : {}),
            },
          },
        };
      };
      const turn = selectionTurnKeep
        ? keepSelectionAdvicePatch({ ...adviceTurn, session: keepSelectionTurnDestination(adviceTurn.session) })
        : adviceTurn;
`,
  ],
  [
    "      // #PL-FIX-T7: selection turns pass the kept destination labels (never another city).\n      await completeAdviceTurn(turn,nextSession,keepSelectionAdviceContext(merged.context, turn.session),next);\n",
    "      await completeAdviceTurn(turn,nextSession,merged.context,next);\n",
  ],
  // style planning（約 L11760-11767）
  [
    `      // #PL-FIX-T7: Planner selection — same cleanup as the advice branch (no other city).
      const keptPlanningTurn = selectionTurnKeep ? keepSelectionAdviceTurn(planningTurn) : planningTurn;
      await completeAdviceTurn(
        keptPlanningTurn,
        nextSession,
        keepSelectionAdviceContext(merged.context, keptPlanningTurn.session),
        next,
      );
`,
    "      await completeAdviceTurn(planningTurn, nextSession, merged.context, next);\n",
  ],
  // early planning（約 L12855-12864）
  [
    `              // #PL-FIX-T7: Planner selection — same cleanup as the advice branch (no other city).
              const keptEarlyTurn = selectionTurnKeep
                ? keepSelectionAdviceTurn(earlyPlanningTurn)
                : earlyPlanningTurn;
              await completeAdviceTurn(
                keptEarlyTurn,
                nextSession,
                keepSelectionAdviceContext(merged.context, keptEarlyTurn.session),
                next,
              );
`,
    "              await completeAdviceTurn(earlyPlanningTurn, nextSession, merged.context, next);\n",
  ],
];
// #PL-FIX-T8：第 8 輪目前內容的範圍 sha16（起訖標記同 PL_RANGE_HUNKS 對應段落）
const T8_RANGE_PINS = [
  {
    label: "send()：換城市詢問的確認／取消回答（含 T8 記錄）",
    start: "    // Answer to a Planner selection destination-switch question (asked by the selection\n",
    end: "      // Any other answer: the question is dropped; this turn continues on the existing flow.\n    }\n",
    endInclusive: true,
    sha16: "c25bc01cc6f51895",
  },
  {
    label: "send() 一般／place-detail 路徑 G1（含 T8 附近錨點／提示條件／恢復）",
    start: "    // Planner selection, general / place-detail turn naming a place: the same A2 gate as the\n",
    end: "    if (!turnSwitchVerified && isPlaceDetailChatActive(session)) {\n",
    endInclusive: false,
    // 實作者回報 5c02fe052abb4e6f；以本段起訖標記（與 PL_RANGE_HUNKS G1 相同，不含結尾）實算為 fdcdd84ab7b643ba。
    //   還原 T8 行後等於第 7 輪 c353d510f37f10ac（下方 PL_RANGE_HUNKS 檢查），故以實算值釘死。
    sha16: "fdcdd84ab7b643ba",
  },
];
// #PL-FIX-T7：A2 區塊內 selection 先問／交給 G1 的 label 區塊（約 L9172-9233；全新段落，第 6 輪不存在）
const T7_RANGE_HUNKS = [
  {
    label: "#PL-FIX-T7 A2 區塊：selection 的 CONFIRMED_SWITCH 句先問他城／其餘交給 selection 一般路徑",
    start: "      // #PL-FIX-T7: Planner selection — a confirmed switch sentence (「不去台南了，改去京都」) never\n",
    end: "        selectionSwitchDeferred = true;\n        break selectionConfirmedSwitch;\n      }\n",
    endInclusive: true,
    sha16: "662d8a4174f216e3", // #PL-FIX-T7 L9172-L9234
    orig: "",
  },
];
const PL_LITERAL_HUNKS = [
  [
    // #PL-FIX-T4：加 keepPlanningSelectionDestination（約 L253）
    // #PL-FIX-T5：加 planningSelectionTurnWrittenDestination（約 L256）
    "  isPlanningSelectionMode,\n  isPlanningSelectionPlaceInScope,\n  keepPlanningSelectionDestination,\n  leavePlanningSelection,\n  planningSelectionDestinationLabel,\n  planningSelectionTurnWrittenDestination,\n  preparePlanningSelectionForGenerate,\n",
    "  isPlanningSelectionMode,\n  preparePlanningSelectionForGenerate,\n",
  ],
  ["  resolveParentScopeSearchUserText,\n  resolvePlanningSelectionTurnDestination,\n", "  resolveParentScopeSearchUserText,\n"],
  // #PL-FIX-T4：planningSelectionTurnNamesPlace（約 L414）
  // #PL-FIX-T5：planningSelectionTurnRequestsSwitch（約 L416）
  // #PL-FIX-T6：planningSelectionTurnSwitchTarget／planningSelectionWrittenLeadingCity（約 L417-418）
  [
    "  planCategoryTurnClarification,\n  planningSelectionTurnNamesPlace,\n  planningSelectionTurnRequestsSwitch,\n  planningSelectionTurnSwitchTarget,\n  planningSelectionWrittenLeadingCity,\n",
    "  planCategoryTurnClarification,\n",
  ],
  // #PL-FIX-T3（第 3 輪）：過期 selection 一律清除（import 約 L247、persistSession 開頭約 L2097-2104、
  //   place-detail 約 L10284、一般路徑 mergeTripPlanningContext 之後約 L10980-10983）
  // #PL-FIX-T4：import 加 consumeStalePlanningSelectionDrop（約 L247）
  ["  consumeStalePlanningSelectionDrop,\n  dropStalePlanningSelection,\n  fetchPlanningSelectionRecommendations,\n", "  fetchPlanningSelectionRecommendations,\n"],
  ["      nextInput: ChatPlanningSession,\n      messagesForWorkspace?: ChatMsg[],\n", "      next: ChatPlanningSession,\n      messagesForWorkspace?: ChatMsg[],\n"],
  [
    "      // Every persisted destination write: a Planner selection never stays with another city.\n      const next = dropStalePlanningSelection(nextInput);\n",
    "",
  ],
  // #PL-FIX-T4：persistSession 本機證明他城而清除時的一次性提示（約 L2122-2132）與 useCallback 依賴（約 L2224）
  [
    '      // A stale drop (another city proven locally) is never silent: one notice for the live selection.\n      const staleDrop = consumeStalePlanningSelectionDrop();\n      if (\n        staleDrop &&\n        !isPlanningSelectionMode(next) &&\n        sessionRef.current.planningSelection?.id === staleDrop.selectionId\n      ) {\n        toast.message(\n          chatRuntimeCopy("planningSelectionLeftNotice", locale, { previous: staleDrop.previous }),\n        );\n      }\n',
    "",
  ],
  [
    "        throw error;\n      }\n    },\n    [hasPlusAccess, locale],\n  );\n\n  const persistPlanningAdviceTurn = useCallback(\n",
    "        throw error;\n      }\n    },\n    [hasPlusAccess],\n  );\n\n  const persistPlanningAdviceTurn = useCallback(\n",
  ],
  // #PL-FIX-T4：trip-add-place 兩處 setSession 改用 persistSession 處理後的結果（縮排 8 約 L3844、縮排 6 約 L3903）
  [
    "\n        const persistedSession = persistSession(nextSession);\n        setSession(reinforceTripAddPlaceSession(persistedSession));\n",
    "\n        persistSession(nextSession);\n        setSession(reinforceTripAddPlaceSession(nextSession));\n",
  ],
  [
    "\n      const persistedSession = persistSession(nextSession);\n      setSession(reinforceTripAddPlaceSession(persistedSession));\n",
    "\n      persistSession(nextSession);\n      setSession(reinforceTripAddPlaceSession(nextSession));\n",
  ],
  // #PL-FIX-T4：一般路徑換城市確認後，在下一次 render 重跑原句（約 L1755-1766）
  // #PL-FIX-T5：重跑帶 selectionSwitchResend；被 streaming／generating 擋下時等兩者結束後重跑一次（約 L1765-1773）
  [
    "  // Planner selection switch confirmed from the general path: re-send that sentence once, from the\n  // render that already shows the confirm turn (send reads this render's conversation).\n  const selectionSwitchResendRef = useRef<string | null>(null);\n  const [selectionSwitchResendTick, setSelectionSwitchResendTick] = useState(0);\n  useEffect(() => {\n    const resendText = selectionSwitchResendRef.current;\n    if (!resendText) return;\n    selectionSwitchResendRef.current = null;\n    void send(resendText, { source: \"user\", selectionSwitchResend: true });\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [selectionSwitchResendTick]);\n  // A re-send that was blocked by streaming / generating waits here: once both end, it runs once.\n  const selectionSwitchResendDeferredRef = useRef<string | null>(null);\n  useEffect(() => {\n    if (streaming || generating || !selectionSwitchResendRef.current) return;\n    setSelectionSwitchResendTick((tick) => tick + 1);\n  }, [streaming, generating]);\n\n",
    "",
  ],
  // #PL-FIX-T5：send() opts 型別加 selectionSwitchResend（約 L8597-8601；原為單行，加欄位後改為多行）
  [
    '    opts?: {\n      source?: "user" | "auto" | "chat_shortcut" | "home_mood";\n      actionDiagnostic?: TripActionDiagnostic;\n      selectionSwitchResend?: boolean;\n    },\n',
    '    opts?: { source?: "user" | "auto" | "chat_shortcut" | "home_mood"; actionDiagnostic?: TripActionDiagnostic },\n',
  ],
  // #PL-FIX-T5：回合開始清除前一回合未 persist 而殘留的過期清除紀錄（約 L8662-8663）
  ["    // A stale-drop record an earlier turn left unpersisted never reaches this turn's notice.\n    consumeStalePlanningSelectionDrop();\n", ""],
  // #PL-FIX-T4／T5：place-detail 路徑保留 selection 目的地（約 L10515-10516）
  [
    "      // Planner selection: the selection keeps its destination before the stale check.\n      nextSession = dropStalePlanningSelection(keepSelectionTurnDestination(merged.session));\n      persistSession(nextSession);\n",
    "      nextSession = merged.session;\n      persistSession(nextSession);\n",
  ],
  // #PL-FIX-T5：advice 分支也保留 selection 目的地（約 L11226-11237）
  // #PL-FIX-T6：advice contextPatch 也保留 selection 目的地（keepSelectionAdvicePatch，約 L11277-11311）
  [
    "      // Planner selection: this branch persists too; the selection keeps its destination.\n      nextSession = keepSelectionTurnDestination(nextSession);\n      const adviceTurn = processAdviceTurn(\n        trimmed,\n        nextSession,\n        merged.context,\n        undefined,\n        locale,\n      );\n      // #PL-FIX-T6: the advice contextPatch (re-applied when the turn persists) keeps the\n      // selection's destination too: never another city / an unverified name.\n      const keepSelectionAdvicePatch = (kept: typeof adviceTurn): typeof adviceTurn => {\n        const patch = kept.advice.contextPatch;\n        if (!patch) return kept;\n        const keptContext = kept.session.travelContext;\n        return {\n          ...kept,\n          advice: {\n            ...kept.advice,\n            contextPatch: {\n              ...patch,\n              ...(\"destination\" in patch ? { destination: keptContext?.destination } : {}),\n              ...(\"destinationCandidate\" in patch\n                ? { destinationCandidate: keptContext?.destinationCandidate }\n                : {}),\n              ...(\"destinationInputNames\" in patch\n                ? { destinationInputNames: keptContext?.destinationInputNames }\n                : {}),\n            },\n          },\n        };\n      };\n      const turn = selectionTurnKeep\n        ? keepSelectionAdvicePatch({ ...adviceTurn, session: keepSelectionTurnDestination(adviceTurn.session) })\n        : adviceTurn;\n",
    "      const turn = processAdviceTurn(trimmed,nextSession,merged.context,undefined,locale);\n",
  ],
  // #PL-FIX-T6：pending parent_city_scope 回答的換城市閘門（約 L10899-10907）
  [
    "        // #PL-FIX-T6: Planner selection — an answer that moves the turn to another trusted city is\n        // asked first (no Credits, no search); same-city answers go on unchanged.\n        if (selectionTurnKeep && !matchesSelectionGate(confirmedParentCity)) {\n          const gate = await runSelectionTurnGate(\n            confirmedParentCity,\n            pendingGeographic.originalUserText?.trim() || trimmed,\n          );\n          if (gate.kind === \"asked\" || gate.kind === \"stale\") return;\n        }\n",
    "",
  ],
  // #PL-FIX-T6：pending destination_area 回答的換城市閘門（約 L10962-10970）
  [
    "        // #PL-FIX-T6: Planner selection — an answer naming another known city is asked first\n        // (no Credits, no search); same-city / sub-area answers go on unchanged (no extra lookup).\n        const restoredOtherCity = selectionTurnKeep\n          ? planningSelectionWrittenLeadingCity(restored.destinationLabel)\n          : undefined;\n        if (restoredOtherCity && !matchesSelectionGate(restoredOtherCity)) {\n          const gate = await runSelectionTurnGate(restoredOtherCity, restored.restoredUserText);\n          if (gate.kind === \"asked\" || gate.kind === \"stale\") return;\n        }\n",
    "",
  ],
  // #PL-FIX-T4／T5：一般路徑結尾 keep（在 dropStale 之前，約 L11259-11264）
  [
    "    nextSession = planningMerge.session;\n    // After this turn's destination writes (trip intent, travel / planning context, global\n    // candidate): a selection of another city ends here, before any later step reads it.\n    // Planner selection (not a confirmed switch): the selection keeps its destination first.\n    nextSession = keepSelectionTurnDestination(nextSession);\n    nextSession = dropStalePlanningSelection(nextSession);\n",
    "    nextSession = planningMerge.session;\n",
  ],
  [
    "    selectionMode,\n    selectionSwitchPending,\n    session.planningSelection?.id,\n    locale,\n    session.pendingQuestion?.options,\n",
    "    selectionMode,\n    session.pendingQuestion?.options,\n",
  ],
  ["              searchPlaces: searchNearbyPlaces,\n              locale,\n              trustedScope: selectionScope,\n", "              searchPlaces: searchNearbyPlaces,\n              locale,\n"],
  ["          searchPlaces: searchNearbyPlaces,\n          locale,\n          trustedScope: turnScope,\n", "          searchPlaces: searchNearbyPlaces,\n          locale,\n"],
  [
    "      hasPlusAccess,\n      ensureSubscriptionHydratedForCredits,\n      geocodeLocationFn,\n    ],\n",
    "      hasPlusAccess,\n      ensureSubscriptionHydratedForCredits,\n    ],\n",
  ],
  [
    "              if (selectionMode) {\n                const selectionItem = roamieRecToChatItem(rec);\n                // Only cards this selection session recommended (or already selected) may join it.\n                if (!isPlanningSelectionPlaceInScope(sessionRef.current, selectionItem)) {\n                  toast.info(chatRuntimeCopy(\"planningSelectionPlaceOutOfScope\", locale));\n                  return;\n                }\n                persistSession(togglePlanningSelectionPlace(sessionRef.current, selectionItem));\n",
    "              if (selectionMode) {\n                persistSession(\n                  togglePlanningSelectionPlace(sessionRef.current, roamieRecToChatItem(rec)),\n                );\n",
  ],
];
const PL_RANGE_HUNKS = [
  {
    label: "型別 PlanningSelectionSwitchPending",
    start: "/** Planner selection destination-switch question (asked before any Credits / Places call). */\n",
    end: "function sameNormalizedSwitchDestination(",
    endInclusive: false,
    sha16: "a56db15f02de2963", // #PL-FIX-T4（第 3 輪 fa73d03f376a0047、第 1 輪 6d6f57832cc5d4a5）：加 entry
    orig: "",
    round4Delta: {
      prevSha16: "fa73d03f376a0047",
      added: ['  /** Asked by the general / place-detail path (confirm re-runs that sentence on the general path). */\n  entry?: "general";\n'],
    },
  },
  {
    label: "元件 state：selectionSwitchPending（只在記憶體）",
    start: "  // Planner selection: a continuation turn whose trusted destination differs from the selection\n",
    end: "  }, []);\n",
    endInclusive: true,
    sha16: "e82f1b3373303ea1",
    orig: "",
  },
  {
    label: "actionChips：換城市詢問的確認／取消 chips",
    start: "    if (selectionMode) {\n      if (\n        selectionSwitchPending &&\n",
    end: "        return chips;\n      }\n",
    endInclusive: true,
    sha16: "428078d9215cfc96",
    orig: "    if (selectionMode) {\n",
  },
  {
    label: "E1 runPlanFormHandoff：A2 閘門（Credits 前）＋ metadata.destination",
    start: "          // A2 gate before Credits / Places: the Plan form destination (localStorage snapshot) is\n",
    end: "              destination: selectionScope.destination,\n            },\n          });\n",
    endInclusive: true,
    sha16: "ce46119371c60f90", // #PL-FIX-T3（第 2 輪 a061e06f7abab72a、第 1 輪 242809058aa3406b）：qualified→名稱→上一層，最多 3 次
    orig: '          const creditsGate = await beginPlaceRecommendationCredits({\n            hasPlusAccess,\n            metadata: { path: "planning_selection_initial" },\n          });\n',
  },
  {
    label: "send()：換城市詢問的確認／取消回答",
    start: "    // Answer to a Planner selection destination-switch question (asked by the selection\n",
    end: "      // Any other answer: the question is dropped; this turn continues on the existing flow.\n    }\n",
    endInclusive: true,
    sha16: "569087c0f5b15a47", // #PL-FIX-T4（第 3 輪 be33ee8b6616cae2、第 1 輪 1da67409a74218a5）：一般路徑詢問的確認改為重跑原句
    orig: "",
    round4Delta: {
      prevSha16: "be33ee8b6616cae2",
      added: [
        '        if (selectionSwitchAsked.entry === "general") {\n          // Asked by the general path: its sentence now runs there, after this render (fresh\n          // conversation), on the left-selection session with the trusted destination.\n          selectionSwitchResendRef.current = selectionSwitchAsked.originalUserText;\n          setSelectionSwitchResendTick((tick) => tick + 1);\n          return;\n        }\n',
      ],
    },
  },
  {
    label: "E2 send() selection 補充推薦：A2 閘門＋換城市詢問（Credits 前）＋ metadata.destination",
    start: "        // A2 gate before Credits / Places: this sentence's destination (a named city wins, never\n",
    end: "            destination: turnScope.destination,\n          },\n        });\n",
    endInclusive: true,
    sha16: "ab6254f1e5717a6c", // #PL-FIX-T3（第 2 輪 48f4f5722bbec0e0、第 1 輪 5fea4ca09978a4ac）：E2 子區域＝同目的地（insideSelection）＋閘門標籤順序
    orig: '        const creditsGate = await beginPlaceRecommendationCredits({\n          hasPlusAccess,\n          metadata: { path: "planning_selection_continuation" },\n        });\n',
  },
  {
    // #PL-FIX-T4（第 4 輪）：一般／place-detail 路徑在寫入目的地前的 A2 閘門（全新段落，改動前不存在）
    label: "send() 一般／place-detail 路徑：selection 模式帶地名句的 A2 閘門＋換城市詢問（寫入前）",
    start: "    // Planner selection, general / place-detail turn naming a place: the same A2 gate as the\n",
    end: "    if (!turnSwitchVerified && isPlaceDetailChatActive(session)) {\n",
    endInclusive: false,
    // #PL-FIX-T6 L10245-L10432（第 5 輪 20f20176d6024266、第 4 輪 aca678cd10c7f76e）：閘門抽成 runSelectionTurnGate（供 pending 回答共用）、
    //   明確換城市措辭目標 planningSelectionTurnSwitchTarget、寫入名稱以可信他城開頭（含 nearby）planningSelectionWrittenLeadingCity
    // #PL-FIX-T7 L10338-L10588（第 6 輪 0419a284c4a2f8ac）：focusInsideSelection／unverifiedName、keepSelectionAdviceTurn／
    //   keepSelectionAdviceContext、附帶提及排除、閘門 geocode 信封保留供「找不到」提示、unverified 照常走（不停下）
    sha16: "c353d510f37f10ac",
    orig: "",
  },
  {
    // #PL-FIX-T5（第 5 輪）：確認換城市後的重跑被 streaming／generating／生成鎖擋下時不靜默丟失（全新段落）
    label: "send()：換城市確認後重跑原句的攔截（保留／提示重新送出）",
    start: "    // Planner selection switch confirmed: its original sentence is never dropped silently. Blocked\n",
    end: "    if (!trimmed || streaming || generating) return;\n",
    endInclusive: false,
    sha16: "cc3cfe5495585ab6", // #PL-FIX-T5 L8615-L8639
    orig: "",
  },
  {
    // #PL-FIX-T5（第 5 輪）：merge 產生新的全域候選／釐清時，selection 回合還原 selection 的目的地 context（全新段落）
    label: "send() 一般路徑：merge 後還原 selection 目的地 context（不再對已過閘門的名稱 geocode／釐清）",
    start: "    const selectionTurnBeforeContext = selectionTurnBefore.travelContext;\n",
    end: "    const globalResolutionEpoch = ++globalResolutionEpochRef.current;\n",
    endInclusive: false,
    sha16: "dce73aad124f5ee5", // #PL-FIX-T5 L11033-L11068
    orig: "",
  },
];

const lineAt = (src, idx) => src.slice(0, idx).split("\n").length;

/** 移除 #PL-FIX 段落；回傳 { stripped, ranges }（ranges＝目前檔案中的行號範圍，供報告）。 */
export function stripPlannerSelectionHunks(src) {
  let s = src;
  const ranges = [];
  const shaMismatches = [];
  // #PL-FIX-T8：目前（第 8 輪）兩個含 T8 行的範圍段落 sha16 釘死（實作者回報值），之後逐字還原 T8 行。
  for (const pin of T8_RANGE_PINS) {
    const a = src.indexOf(pin.start);
    const e0 = a >= 0 ? src.indexOf(pin.end, a + pin.start.length) : -1;
    if (a < 0 || e0 < 0) {
      shaMismatches.push(`${pin.label}：找不到範圍`);
      continue;
    }
    const b = pin.endInclusive ? e0 + pin.end.length : e0;
    const got = sha(src.slice(a, b)).slice(0, 16);
    ranges.push({ label: `T8 範圍（目前）${pin.label}`, from: lineAt(src, a), to: lineAt(src, b - 1), sha16: got });
    if (got !== pin.sha16) shaMismatches.push(`${pin.label}（第 8 輪目前內容）：sha16 ${got} ≠ ${pin.sha16}`);
  }
  for (const [cur, orig] of T8_LITERAL_HUNKS) {
    const n = s.split(cur).length - 1;
    assert.equal(n, 1, `_app.chat.tsx：#PL-FIX-T8 段落出現 ${n} 次（預期 1）：${JSON.stringify(cur.slice(0, 90))}`);
    const idx = src.indexOf(cur);
    ranges.push({ label: `T8 ${JSON.stringify(cur.trim().split("\n")[0].slice(0, 60))}`, from: lineAt(src, idx), to: lineAt(src, idx + cur.length - 1) });
    s = s.split(cur).join(orig);
  }
  assert(!/#PL-FIX-T8/.test(s), "_app.chat.tsx：還原 T8 段落後仍有 #PL-FIX-T8 標記（有未列入授權清單的 T8 行）");
  // #PL-FIX-T7：第 7 輪 → 第 6 輪（字面段落各恰好一次；範圍段落以 sha16 釘死）
  for (const [cur, orig] of T7_LITERAL_HUNKS) {
    const n = s.split(cur).length - 1;
    assert.equal(n, 1, `_app.chat.tsx：#PL-FIX-T7 段落出現 ${n} 次（預期 1）：${JSON.stringify(cur.slice(0, 90))}`);
    const idx = src.indexOf(cur);
    ranges.push({ label: `T7 ${JSON.stringify(cur.trim().split("\n")[0].slice(0, 60))}`, from: lineAt(src, idx), to: lineAt(src, idx + cur.length - 1) });
    s = s.split(cur).join(orig);
  }
  for (const h of T7_RANGE_HUNKS) {
    const n = s.split(h.start).length - 1;
    assert.equal(n, 1, `_app.chat.tsx：#PL-FIX-T7 段落起點出現 ${n} 次（預期 1）：${h.label}`);
    const a = s.indexOf(h.start);
    const e0 = s.indexOf(h.end, a + h.start.length);
    assert(e0 > a, `_app.chat.tsx：#PL-FIX-T7 段落找不到結尾：${h.label}`);
    const b = h.endInclusive ? e0 + h.end.length : e0;
    const segment = s.slice(a, b);
    const got = sha(segment).slice(0, 16);
    const idxInSrc = src.indexOf(segment);
    ranges.push({ label: h.label, from: lineAt(src, idxInSrc), to: lineAt(src, idxInSrc + segment.length - 1), sha16: got });
    if (got !== h.sha16) shaMismatches.push(`${h.label}：sha16 ${got} ≠ ${h.sha16}`);
    s = s.slice(0, a) + h.orig + s.slice(b);
  }
  for (const [cur, orig] of PL_LITERAL_HUNKS) {
    const n = s.split(cur).length - 1;
    assert.equal(n, 1, `_app.chat.tsx：#PL-FIX 段落出現 ${n} 次（預期 1）：${JSON.stringify(cur.slice(0, 90))}`);
    const idx = src.indexOf(cur);
    ranges.push({ label: JSON.stringify(cur.trim().split("\n")[0].slice(0, 60)), from: lineAt(src, idx), to: lineAt(src, idx + cur.length - 1) });
    s = s.split(cur).join(orig);
  }
  for (const h of PL_RANGE_HUNKS) {
    const n = s.split(h.start).length - 1;
    assert.equal(n, 1, `_app.chat.tsx：#PL-FIX 段落起點出現 ${n} 次（預期 1）：${h.label}`);
    const a = s.indexOf(h.start);
    const e0 = s.indexOf(h.end, a + h.start.length);
    assert(e0 > a, `_app.chat.tsx：#PL-FIX 段落找不到結尾：${h.label}`);
    const b = h.endInclusive ? e0 + h.end.length : e0;
    const segment = s.slice(a, b);
    const got = sha(segment).slice(0, 16);
    const idxInSrc = src.indexOf(segment);
    ranges.push({ label: h.label, from: lineAt(src, idxInSrc), to: lineAt(src, idxInSrc + segment.length - 1), sha16: got });
    if (got !== h.sha16) shaMismatches.push(`${h.label}：sha16 ${got} ≠ ${h.sha16}`);
    if (h.round4Delta) {
      // 第 4 輪新增行逐字移除（各恰好一次）後必須等於第 3 輪的 sha16：範圍內除了這幾行沒有其他改寫。
      let prev = segment;
      for (const add of h.round4Delta.added) {
        const n = prev.split(add).length - 1;
        if (n !== 1) shaMismatches.push(`${h.label}：第 4 輪新增行出現 ${n} 次（預期 1）：${JSON.stringify(add.slice(0, 70))}`);
        prev = prev.split(add).join("");
      }
      const prevGot = sha(prev).slice(0, 16);
      if (prevGot !== h.round4Delta.prevSha16) shaMismatches.push(`${h.label}：移除第 4 輪新增行後 sha16 ${prevGot} ≠ 第 3 輪 ${h.round4Delta.prevSha16}`);
    }
    s = s.slice(0, a) + h.orig + s.slice(b);
  }
  // 先完成所有段落再一次列出全部不符（方便審查每一段），任何一段不符即失敗。
  assert.equal(shaMismatches.length, 0, `_app.chat.tsx：#PL-FIX 段落內容與授權版本不同：\n${shaMismatches.join("\n")}\n${JSON.stringify(ranges.map((r) => `L${r.from}-L${r.to} ${r.label}${r.sha16 ? ` ${r.sha16}` : ""}`))}`);
  return { stripped: s, ranges };
}

const COMPOSER_HUNKS = [
  [
    "  /** 行程生成全域鎖住時的 placeholder（未鎖時不傳，沿用一般文案）。 */\n  lockedPlaceholder?: string;\n  /** 行程生成超過 90 秒的提示（未鎖或未逾時不傳）。 */\n  lockedHint?: string;\n",
    "",
  ],
  ["  inputRef,\n  lockedPlaceholder,\n}: Pick<", "  inputRef,\n}: Pick<"],
  ['  | "inputRef"\n  | "lockedPlaceholder"\n>) {', '  | "inputRef"\n>) {'],
  ['placeholder={lockedPlaceholder ?? t("uiCoverage.chatPlaceholder")}', 'placeholder={t("uiCoverage.chatPlaceholder")}'],
  [
    '      <InputRow {...props} />\n      {props.lockedHint ? (\n        <p className="px-3 pb-1 pt-1 text-[11px] text-muted-foreground">{props.lockedHint}</p>\n      ) : null}\n',
    "      <InputRow {...props} />\n",
  ],
];

function strip(src, hunks, label) {
  let s = src;
  for (const [cur, orig, times = 1] of hunks) {
    const n = s.split(cur).length - 1;
    assert.equal(n, times, `${label}：授權段落出現 ${n} 次（預期 ${times}）：${JSON.stringify(cur.slice(0, 90))}`);
    s = s.split(cur).join(orig);
  }
  return s;
}

/** _app.chat.tsx 移除 #L1 段落後必須等於改動前版本（95e7866a…）。回傳目前 sha256。 */
export function assertChatTsxOnlyLockChanges() {
  const cur = read("src/routes/_app.chat.tsx");
  const { stripped: withoutPl } = stripPlannerSelectionHunks(cur);
  const stripped = strip(withoutPl, CHAT_HUNKS, "_app.chat.tsx");
  assert.equal(sha(stripped), CHAT_TSX_PRE_LOCK_SHA256, "_app.chat.tsx 移除生成鎖與 #PL-FIX 段落後與改動前版本不同（有授權範圍以外的變更）");
  return sha(cur);
}

/** ChatComposer.tsx 移除 #L1 段落後必須與 HEAD 逐字相同。 */
export function assertComposerOnlyLockChanges() {
  const cur = read("src/components/chat/ChatComposer.tsx");
  const head = execFileSync("git", ["show", "HEAD:src/components/chat/ChatComposer.tsx"], { cwd: root, encoding: "utf8" });
  assert.equal(strip(cur, COMPOSER_HUNKS, "ChatComposer.tsx"), head, "ChatComposer.tsx 移除生成鎖段落後與 HEAD 不同");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let fail = 0;
  try {
    const cur = read("src/routes/_app.chat.tsx");
    console.log(`INFO _app.chat.tsx sha256 前 16 碼=${sha(cur).slice(0, 16)}`);
    const { ranges } = stripPlannerSelectionHunks(cur);
    for (const r of ranges) console.log(`INFO #PL-FIX hunk L${r.from}-L${r.to} ${r.label}${r.sha16 ? ` sha16=${r.sha16}` : ""}`);
  } catch (e) {
    console.log("INFO #PL-FIX hunk 列表失敗：" + String(e?.message ?? e).split("\n")[0]);
  }
  for (const [name, fn] of [
    ["_app.chat.tsx 只有 #L1 生成鎖＋#PL-FIX Planner 選擇入口段落（移除後＝95e7866a0e96f036）", () => {
      const h = assertChatTsxOnlyLockChanges();
      assert.equal(h.slice(0, 16), CHAT_TSX_LOCK_SHA16, "目前 sha256 前 16 碼");
    }],
    ["ChatComposer.tsx 只有 #L1 生成鎖段落（移除後＝HEAD）", assertComposerOnlyLockChanges],
  ]) {
    try {
      fn();
      console.log("PASS " + name);
    } catch (e) {
      fail++;
      console.log("FAIL " + name + "\n     " + String(e?.message ?? e).split("\n").slice(0, 6).join("\n     "));
    }
  }
  if (process.argv.includes("--debug")) {
    // 除錯：移除後的內容與 HEAD 版本（若 HEAD 即基準 95e7866a）逐行比對，列出不同的行（不寫檔）。
    // --base <改動前副本路徑>（verify-chat-generation-lock.mjs 的 scratchpad baseline）；未給則用 HEAD。
    const baseArg = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : null;
    const head = baseArg
      ? fs.readFileSync(baseArg, "utf8")
      : execFileSync("git", ["show", "HEAD:src/routes/_app.chat.tsx"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    console.log(`DEBUG 比對對象 ${baseArg ?? "HEAD"} sha16=${sha(head).slice(0, 16)}（基準 ${CHAT_TSX_PRE_LOCK_SHA256.slice(0, 16)}）`);
    try {
      const { stripped: withoutPl } = stripPlannerSelectionHunks(read("src/routes/_app.chat.tsx"));
      const stripped = strip(withoutPl, CHAT_HUNKS, "_app.chat.tsx");
      const a = stripped.split("\n");
      const b = head.split("\n");
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      let j = 0;
      while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
      console.log(`DEBUG 第一個不同行 stripped L${i + 1} / 對象 L${i + 1}；尾端相同 ${j} 行；stripped 中段 ${a.length - i - j} 行、對象中段 ${b.length - i - j} 行`);
      if (a.length - i - j < 60 && b.length - i - j < 60) {
        console.log("DEBUG stripped 中段：\n" + a.slice(i, a.length - j).map((l, k) => `L${i + k + 1}: ${l}`).join("\n"));
        console.log("DEBUG 對象中段：\n" + b.slice(i, b.length - j).map((l, k) => `L${i + k + 1}: ${l}`).join("\n"));
      }
      const headLines = new Set(b);
      const pattern = new RegExp(process.argv[process.argv.indexOf("--debug") + 1] ?? "[Ss]election", "");
      const lo = Number(process.argv[process.argv.indexOf("--debug") + 2] ?? 0);
      const hi = Number(process.argv[process.argv.indexOf("--debug") + 3] ?? Infinity);
      const extra = a.map((line, k) => [k + 1, line]).filter(([k, line]) => k >= lo && k <= hi && !headLines.has(line) && pattern.test(line));
      console.log(`DEBUG stripped 中不在 HEAD、且符合 ${pattern} 的行（${extra.length}）：\n` + extra.slice(0, 80).map(([k, l]) => `L${k}: ${l}`).join("\n"));
    } catch (e) {
      console.log("DEBUG 失敗：" + String(e?.message ?? e).split("\n")[0]);
    }
  }
  console.log(`${2 - fail} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}
