#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r6.mjs from r5 (r5 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// Run: node scripts/verify-destination-authority-phase2-r6-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r5.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r6.mjs";
const L = (...lines) => lines.join("\n");

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

// ── header ──
P(
  "header",
  L("/**", " * R3 — Phase 2 Recovery 第一組限定安全修正 F5 獨立驗收（第 2 輪）。"),
  L(
    "/**",
    " * R4 — Phase 2 Recovery 第一組限定安全修正 F6 獨立驗收（第 3 輪＝最後一輪）。",
    " * 由 scripts/verify-destination-authority-phase2-r6-build.mjs 以 r5（保留不改）逐字複製並套用 exact-once patch 產生，最小調整（r6-Δ）：",
    " *",
    " *  r6-Δ1 樹：work（F6 後）、pre（F6 前：chat-turn-destination.ts 以 scratchpad 的 chat-turn-destination.pre-F6.ts overlay；",
    " *         harness inline 邏輯走 F4+F5 分支、不走 F6 分支）、base（aa2db59）、pre5（可選 --pre5；F5 前＝r5 的 pre）、",
    " *         pre4（可選 --pre4；F4 前）。F6 前 sha 快照改為 pre-F6-sha.txt。",
    " *  r6-Δ2 F6 鏡像（只在 work）：applyLocalFallback（L6529-6732）destination-category-retry 分支以 { turnStartSession } 呼叫 pushDC；",
    " *         pre / pre5 / pre4 該呼叫不帶 opts（澄清 before = sessionRef.current）。applyLocalFallback 以真實模組重建 gating",
    " *         （place detail、explicit scope、continue、destination places、category retry；trip add place / planning tail 未重建）。",
    " *         故障注入（只在 R6 情境）：throwAfterPersist＝L10471 persist 後拋例外 → L10883-10901 catch → applyLocalFallback(session, …,",
    " *         \"state_machine_error\", turnStartSession)；streamTimeout＝L10877 streamChat AbortError → applyLocalFallback(nextSession, …, \"ai_timeout\", …)。",
    " *         withoutUnconfirmedSessionDestinations 一律呼叫真實模組（work=F6 版、pre=F6 前備份 overlay）。",
    " *  r6-Δ4 anchors：work = r5 work anchors + F6 anchors，\"{ turnStartSession },\" 次數 2→3（F6 新增 L6728 retry）；",
    " *         pre（F6 前備份）沿用 r5 work anchors 與 r5 次數（2）；pre5 沿用 r5 pre anchors；另列 applyLocalFallback / streamChat 呼叫點。",
    " *  r6-Δ5 真實模組 probe：A/B/C GPS 判定（計入各樹 P1，[R6-PROBE]），以及 L12224 / L8533 未傳 turnStartSession 的論證 probe。",
    " *  r6-Δ6 R6 情境（retry 澄清、GPS-late 拒絕）、expect viaRetry（不計 P1，只回報是否到達）／kyotoFree，與各樹 Provider 總數。",
    " *  r5 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）；只調整 infra 樹判別（tree→版本）與輸出標籤。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r6.mjs --brief [--pre4] [--pre5] [--only=ID,…]",
    " *",
    " * ── 以下為 r5 原始說明 ──",
    " * R3 — Phase 2 Recovery 第一組限定安全修正 F5 獨立驗收（第 2 輪）。",
  ),
);
P(
  "script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r5.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r6.mjs`;",
);
P(
  "pre-files",
  L(
    "// r5-Δ1：pre = F5 前備份；pre4 = F4 前備份（可選）",
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F5.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F5.tsx`,',
    "};",
  ),
  L(
    "// r6-Δ1：pre = F6 前備份；pre5 = F5 前備份（可選 --pre5）；pre4 = F4 前備份（可選 --pre4）",
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F6.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F6.tsx`,',
    "};",
    "const PRE5_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F5.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F5.tsx`,',
    "};",
  ),
);
P(
  "pre-sha",
  L(
    "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/post-R2-sha.txt`; // F5 開始前（04:35）src 檔案 sha1",
    'const WITH_PRE4 = process.argv.includes("--pre4");',
  ),
  L(
    "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-F6-sha.txt`; // r6-Δ1：F6 開始前（12:17）src 檔案 sha1",
    'const WITH_PRE4 = process.argv.includes("--pre4");',
    'const WITH_PRE5 = process.argv.includes("--pre5");',
  ),
);
P(
  "flags",
  L(
    '  const F4 = TREE === "work" || TREE === "pre"; // r5-Δ1：pre = F5 前（已含 F4）',
    '  const F5 = TREE === "work"; // r5-Δ2：只有 work 走 F5 inline 邏輯',
  ),
  L(
    '  const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5"; // r6-Δ1：pre = F6 前、pre5 = F5 前（皆已含 F4）',
    '  const F5 = TREE === "work" || TREE === "pre"; // r6-Δ1：pre = F6 前（已含 F5）',
    '  const F6 = TREE === "work"; // r6-Δ2：只有 work 走 F6 inline 邏輯（applyLocalFallback retry 傳 turnStartSession）',
  ),
);
P(
  "overlay-pre5",
  L(
    '  } else if (TREE === "pre") {',
    "    // r5-Δ1：pre = 工作區 + F5 前的 chat-turn-destination.ts",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '  } else if (TREE === "pre4") {',
  ),
  L(
    '  } else if (TREE === "pre") {',
    "    // r6-Δ1：pre = 工作區 + F6 前的 chat-turn-destination.ts",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '  } else if (TREE === "pre5") {',
    "    // r6-Δ1：pre5 = 工作區 + F5 前的 chat-turn-destination.ts（= r5 的 pre）",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE5_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '  } else if (TREE === "pre4") {',
  ),
);
P(
  "modules",
  L('    cte: FAITHFUL ? await imp("lib/ai/chat-turn-engine.ts") : null,', "  };"),
  L(
    '    cte: FAITHFUL ? await imp("lib/ai/chat-turn-engine.ts") : null,',
    "    // r6-Δ2：applyLocalFallback 重建所需（isExplicitDeviceNearbyRequest）",
    '    rss: FAITHFUL ? await imp("lib/ai/recommendation-search-scope.ts") : null,',
    "  };",
  ),
);
P(
  "probes",
  L(
    '        c_newRealLocation: run({ ...B0, location: { lat: 34.69, lng: 135.5, city: "大阪" }, travelContext: { interests: [], currentLocation: "大阪" } }, beforeGps),',
    "      };",
  ),
  L(
    '        c_newRealLocation: run({ ...B0, location: { lat: 34.69, lng: 135.5, city: "大阪" }, travelContext: { interests: [], currentLocation: "大阪" } }, beforeGps),',
    "        // r6-Δ5：F6 A/B/C 判定 probe",
    "        r6_B_gpsCityRewrite: run(sessKyoto, beforeGps),",
    '        r6_C_placeholderPrevGps: run({ ...beforeGps, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, beforeGps),',
    "        r6_C_confirmedPlaceholderNoPrev: run(",
    '          { ...B0, location: { lat: 0, lng: 0, city: "京都" }, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都", currentLocation: "京都" } },',
    '          { ...B0, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都" } },',
    "        ),",
    "        r6_C_prevPlaceholderKept: run(",
    '          { ...B0, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "京都" } },',
    '          { ...B0, location: { lat: 0, lng: 0, city: "大阪" }, travelContext: { interests: [], destination: "大阪", currentLocation: "大阪" } },',
    "        ),",
    "        r6_tripAnchorSame: run(",
    '          { ...B0, location: { lat: 34.9949, lng: 135.785, city: "京都看楓葉" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },',
    '          { ...B0, location: { lat: 34.9949, lng: 135.785, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },',
    "        ),",
    "        r6_tripAnchorFirstTurnPrevGps: run(",
    '          { ...beforeGps, location: { lat: 34.9949, lng: 135.785, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },',
    "          beforeGps,",
    "        ),",
    '        r6_destCoordsNoPrev: run({ ...B0, location: { lat: 35.0116, lng: 135.7681, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),',
    '        r6_nearZeroCoords: run({ ...B0, location: { lat: 0.0005, lng: 0.0005, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),',
    "      };",
    "      // r6-Δ5：L12224 重試按鈕（streamChat(lastFailed) → userText=\"\"）與 L8533 place detail streamChat 未傳 turnStartSession 的論證 probe",
    "      const sf = (fn, fb) => {",
    "        try {",
    "          return fn();",
    "        } catch (e) {",
    "          return `${fb}:${e?.message ?? e}`;",
    "        }",
    "      };",
    '      const pdItem = { id: "pd-1", name: "清水寺", placeId: "pd-1", googlePlaceId: "pd-1", lat: 34.9949, lng: 135.785, address: "京都市東山區" };',
    '      const pdBase = { ...B0, travelContext: { interests: [], destination: "京都" } };',
    "      const pdSession = sf(() => M.pdc.enterPlaceDetailChat(pdBase, pdItem), \"ERR\");",
    "      const pdTurn = (text) =>",
    "        typeof pdSession === \"string\"",
    "          ? pdSession",
    "          : sf(() => M.pdc.isPlaceDetailChatActive(M.tc.mergeTravelContext(M.pdc.enterPlaceDetailChat(pdSession, pdSession.placeDetailFocus), text).session), \"ERR\");",
    "      overlayCheck.modProbes.r6_review = {",
    '        retryButton_emptyText_shouldFetchCategory: sf(() => M.placeIntent.shouldFetchDestinationCategoryPlaces("", { interests: [], destination: "京都" }, pdBase), "ERR"),',
    '        retryButton_emptyText_intents: sf(() => M.placeIntent.parseChatPlaceIntents("").length, "ERR"),',
    '        retryButton_emptyText_userWantsNearby: sf(() => M.chatIntent.userExplicitlyWantsNearbyPlaces(""), "ERR"),',
    "        placeDetail_sessionActive: typeof pdSession === \"string\" ? pdSession : sf(() => M.pdc.isPlaceDetailChatActive(pdSession), \"ERR\"),",
    '        placeDetail_activeAfterMerge_photo: pdTurn("這裡適合拍照嗎"),',
    '        placeDetail_activeAfterMerge_category: pdTurn("京都看楓葉推薦景點"),',
    '        placeDetail_activeAfterMerge_cafe: pdTurn("推薦咖啡廳"),',
    "      };",
  ),
);
P(
  "obs-fields",
  L("      f5NearbyStrip: false,", "    };"),
  L("      f5NearbyStrip: false,", "      // r6-Δ2", "      viaRetry: false,", "      fallbackReason: null,", "    };"),
);
P(
  "applyLocalFallback",
  L("    return destForMore ?? null;", "  }"),
  L(
    "    return destForMore ?? null;",
    "  }",
    "",
    "  // ── r6-Δ2：applyLocalFallback（work L6529-6732）。F6 起 destination-category-retry 以 { turnStartSession } 呼叫 pushDC；",
    "  //    F6 前（pre / pre5 / pre4）不帶 opts → pushDC 澄清 before = sessionRef.current（harness = persisted）。",
    "  async function applyLocalFallback(obs, activeSession, activeUserText, conversation, reason, turnStartSession) {",
    "    obs.fallbackReason = reason;",
    "    obs.path += `|fallback(${reason})`;",
    "    // L6540",
    "    if (M.pdc.isPlaceDetailChatActive(activeSession)) {",
    '      obs.path += "|fb_place_detail(return false)";',
    "      return false;",
    "    }",
    "    // L6544-6563",
    "    const mergedForScope = M.tc.mergeTravelContext(activeSession, activeUserText);",
    "    const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: activeUserText, session: activeSession, context: mergedForScope.context });",
    "    const scopedSession = explicitScope ? M.fbScope.isolateSessionToExplicitDestination(activeSession, explicitScope) : activeSession;",
    '    if (explicitScope && reason === "destination_category_places_failed") {',
    '      obs.path += "|fb_explicit_builder_empty(return false)";',
    "      return false;",
    "    }",
    "    // L6588-6648 continue（pushRecommendationRefinement / pushMorePlaceRecommendations 未重建）",
    "    if (",
    "      (scopedSession.activeRecommendationContext || scopedSession.recommendationSession || M.crs.resolveActiveCategoryIntent(scopedSession)) &&",
    "      (M.crg.matchesContinueRecommendationGrammar(activeUserText) || M.refresh.isMorePlaceRecommendationsIntent(activeUserText) || M.refresh.isRefreshRecommendationsRequest(activeUserText)) &&",
    "      !M.rss.isExplicitDeviceNearbyRequest(activeUserText)",
    "    ) {",
    '      obs.path += "|fb_continue(未重建)";',
    "      return false;",
    "    }",
    "    // L6650-6668 trip add place（resolveTripAddPlaceChatSession 未重建；R6 情境不含 trip add place）",
    "    const mergedForAdvice = M.tc.mergeTravelContext(scopedSession, activeUserText);",
    "    // L6672-6698 pushDestinationPlaceRecommendation（未重建，停止）",
    "    if (M.mvp.shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {",
    '      obs.path += "|fb_destination_places(未重建)";',
    "      return false;",
    "    }",
    "    // L6700-6732 destination-category-retry",
    "    if (M.placeIntent.shouldFetchDestinationCategoryPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {",
    "      const destForCategory = M.catDest.resolveDestinationForCategorySearch(mergedForAdvice.context, scopedSession, activeUserText);",
    "      if (",
    "        explicitScope &&",
    '        M.fbScope.shouldBlockCrossScopeRecommendationFallback({ explicit: explicitScope, sourcePath: "destination-category-retry", fallbackDestination: destForCategory })',
    "      ) {",
    '        obs.path += "|fb_retry_blocked(cross_scope)";',
    "      } else {",
    '        obs.path += "|fb_destination_category_retry";',
    "        obs.viaRetry = true;",
    "        const applied = await pushDC(obs, scopedSession, activeUserText, conversation, F6 ? { turnStartSession } : undefined);",
    "        if (applied) return true;",
    "      }",
    "    }",
    '    obs.path += "|fb_tail(planning/offline 未重建)";',
    "    return false;",
    "  }",
  ),
);
P(
  "fault-throw",
  L(
    "      // L10463",
    "      persistSession(nextSession);",
    "      obs.path += `|late:${lateAuthority}/route=${route.mode}→persist(nextSession)`;",
  ),
  L(
    "      // L10463",
    "      persistSession(nextSession);",
    "      obs.path += `|late:${lateAuthority}/route=${route.mode}→persist(nextSession)`;",
    "      // r6-Δ2 故障注入：L10471 persist 後拋例外 → L10883-10901 catch：applyLocalFallback(session, trimmed, errorConversation, \"state_machine_error\", turnStartSession)",
    '      if (t.fault === "throwAfterPersist") {',
    '        obs.path += "|fault:throwAfterPersist";',
    '        const errorConversation = [...msgs, { role: "user", content: trimmed }];',
    '        const fb = await applyLocalFallback(obs, session, trimmed, errorConversation, "state_machine_error", turnStartSession);',
    '        if (!fb) obs.path += "|recovery_copy";',
    "        return;",
    "      }",
  ),
);
P(
  "fault-timeout",
  L('      obs.path += "|late_tail(nearby/streamChat 未重建)";', "      return;"),
  L(
    '      if (t.fault === "streamTimeout") {',
    "        // r6-Δ2 故障注入：L10877 streamChat(next, { …, turnStartSession }, nextSession) → AbortError → L7383-7391",
    "        // applyLocalFallback(nextSession, trimmed, next, \"ai_timeout\", opts.turnStartSession)。前提：nearby（L10713）／planning（L10852）未接走（近似）",
    "        if (resolvedNearbyAuth || inferred || M.cte.isPlanningTurnActive(nextSession, merged.context)) {",
    '          obs.path += "|fault:streamTimeout(前提不成立：nearby/planning 分支)";',
    "        } else {",
    '          obs.path += "|fault:streamTimeout";',
    '          const fb = await applyLocalFallback(obs, nextSession, trimmed, next, "ai_timeout", turnStartSession);',
    '          if (!fb) obs.path += "|timeout_copy";',
    "          return;",
    "        }",
    "      }",
    '      obs.path += "|late_tail(nearby/streamChat 未重建)";',
    "      return;",
  ),
);
P(
  "pre-infra-labels",
  'for (const [label, files] of [["pre(F5 前)", PRE_FILES], ...(WITH_PRE4 ? [["pre4(F4 前)", PRE4_FILES]] : [])]) {',
  'for (const [label, files] of [["pre(F6 前)", PRE_FILES], ...(WITH_PRE5 ? [["pre5(F5 前)", PRE5_FILES]] : []), ...(WITH_PRE4 ? [["pre4(F4 前)", PRE4_FILES]] : [])]) {',
);
P(
  "anchors-f6",
  L(
    "const SRC = {",
    '  work: readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8"),',
    '  pre: readFileSync(PRE_FILES["src/routes/_app.chat.tsx"], "utf8"),',
  ),
  L(
    "// r6-Δ4：F6 anchors（work）；pre（F6 前）= r5 work anchors；pre5（F5 前）= r5 pre anchors",
    "const F6_WORK_ANCHORS = [",
    '  "/** send()\'s turnStartSession: the clarification cleanup base (never a mid-turn persist). */\\n      turnStartSession?: ChatPlanningSession,",',
    '  "if (isPlaceDetailChatActive(activeSession)) {\\n        return false;\\n      }",',
    '  "sourcePath: \\"destination-category-retry\\",",',
    '  "const applied = await pushDestinationCategoryPlaceRecommendation(\\n            scopedSession,\\n            activeUserText,\\n            conversation,\\n            { turnStartSession },\\n          );",',
    '  "/** send()\'s turnStartSession, forwarded to applyLocalFallback. */\\n        turnStartSession?: ChatPlanningSession;",',
    '  "\\"ai_timeout\\",\\n            opts?.turnStartSession,",',
    '  "\\"ai_reply_failed\\",\\n          opts?.turnStartSession,",',
    '  "\\"destination_places_failed\\",\\n          turnStartSession,",',
    '  "\\"places_empty\\",\\n            turnStartSession,",',
    '  "\\"planning_no_reply\\",\\n          turnStartSession,",',
    '  "{ phase: route.chatPhase, userText: trimmed, turnStartSession },",',
    '  "const fallbackApplied = await applyLocalFallback(\\n          session,\\n          trimmed,\\n          errorConversation,\\n          \\"state_machine_error\\",\\n          turnStartSession,",',
    "];",
    "ANCHORS.pre5 = ANCHORS.pre;",
    "ANCHORS.pre = ANCHORS.work;",
    "ANCHORS.work = [...ANCHORS.work, ...F6_WORK_ANCHORS];",
    "const SRC = {",
    '  work: readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8"),',
    '  pre: readFileSync(PRE_FILES["src/routes/_app.chat.tsx"], "utf8"),',
    '  ...(WITH_PRE5 ? { pre5: readFileSync(PRE5_FILES["src/routes/_app.chat.tsx"], "utf8") } : {}),',
  ),
);
P(
  "anchor-trees",
  'for (const tree of ["work", "pre", "base", ...(WITH_PRE4 ? ["pre4"] : [])]) {\n  const src = SRC[tree];',
  'for (const tree of ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) {\n  const src = SRC[tree];',
);
P(
  "anchor-count",
  'if (count("{ turnStartSession },") !== 2) anchorFail.push(`work: "{ turnStartSession }," 次數=${count("{ turnStartSession },")}（預期 2）`);',
  'if (count("{ turnStartSession },") !== 3) anchorFail.push(`work: "{ turnStartSession }," 次數=${count("{ turnStartSession },")}（預期 3；r6：F6 新增 L6728 retry）`);',
);
P(
  "anchor-f6-block",
  L("if (anchorFail.length) {", '  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\\n"));'),
  L(
    "// r6-Δ4：F6 呼叫點（applyLocalFallback / streamChat 是否傳 turnStartSession）、retry 位置、pre（F6 前）沿用 r5 次數",
    "{",
    "  const src = SRC.work;",
    '  const lines = src.split("\\n");',
    '  const near = (l, n) => lines.slice(l - 1, l + n).join("\\n");',
    '  const fb = lineOf(src, "await applyLocalFallback(");',
    "  const fbWith = fb.filter((l) => /turnStartSession/.test(near(l, 7)));",
    '  anchorLines.push(`work applyLocalFallback 呼叫點：L${fb.join(",")}；傳 turnStartSession：L${fbWith.join(",")}；未傳：L${fb.filter((l) => !fbWith.includes(l)).join(",") || "(none)"}`);',
    '  if (fb.length !== 6 || fbWith.length !== 6) anchorFail.push(`work: applyLocalFallback 呼叫點=${fb.length} 傳 turnStartSession=${fbWith.length}（預期 6/6）`);',
    '  const sc = lineOf(src, "await streamChat(");',
    "  const scWith = sc.filter((l) => /turnStartSession/.test(near(l, 6)));",
    '  anchorLines.push(`work streamChat 呼叫點：L${sc.join(",")}；傳 turnStartSession：L${scWith.join(",")}；未傳：L${sc.filter((l) => !scWith.includes(l)).join(",") || "(none)"}`);',
    '  if (sc.length !== 3 || scWith.length !== 1) anchorFail.push(`work: streamChat 呼叫點=${sc.length} 傳 turnStartSession=${scWith.length}（預期 3/1）`);',
    '  const retryAt = src.indexOf(\'sourcePath: "destination-category-retry",\');',
    '  const firstTs = src.indexOf("{ turnStartSession },");',
    '  const sendAt = src.indexOf("const send = async (");',
    "  if (!(retryAt > 0 && retryAt < firstTs && firstTs < sendAt)) anchorFail.push(`work: F6 retry 的 { turnStartSession } 不在 applyLocalFallback 內（retry=${retryAt} first=${firstTs} send=${sendAt}）`);",
    '  anchorLines.push(`work 第一個 "{ turnStartSession }," 位於 L${src.slice(0, firstTs).split("\\n").length}（applyLocalFallback destination-category-retry）`);',
    "  const cpre = (a) => SRC.pre.split(a).length - 1;",
    '  if (cpre("{ turnStartSession },") !== 2) anchorFail.push(`pre(F6 前): "{ turnStartSession }," 次數=${cpre("{ turnStartSession },")}（預期 2，同 r5 work）`);',
    '  if (cpre("{ turnDestination, turnStartSession },") !== 2) anchorFail.push(`pre(F6 前): "{ turnDestination, turnStartSession }," 次數=${cpre("{ turnDestination, turnStartSession },")}（預期 2）`);',
    '  if (SRC.pre.includes("opts?.turnStartSession,\\n")) anchorFail.push("pre(F6 前) 已含 F6 的 opts?.turnStartSession 轉傳（備份錯誤？）");',
    "}",
    "if (anchorFail.length) {",
    '  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\\n"));',
  ),
);
P(
  "r6-scenarios",
  "const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS];",
  L(
    "// ── r6-Δ6：R6 新增情境（retry 澄清；GPS-late 後拒絕）──",
    "const FAULT_THROW = (text) => ({ text, fault: \"throwAfterPersist\" });",
    "const FAULT_TIMEOUT = (text) => ({ text, fault: \"streamTimeout\" });",
    'const GPS_LATE = { lat: 24.18, lng: 120.62, city: "台中市" };',
    "const R6_SCENARIOS = [",
    '  { id: "R6-RT-throw-B", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點［L10471 後例外→state_machine_error retry 澄清］→ 不用 → 推薦咖啡廳（B）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: [FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都", cityEq: "台中市", curEq: "台中市" }, kyotoFree: { turns: [1, 2] }, noUnconfirmed: true } },',
    '  { id: "R6-RT-throw-B2", label: "（sticky＋GPS，faithful）大阪推薦景點 → 改去京都看楓葉推薦景點［retry 澄清］→ 不用 → 推薦咖啡廳（B\'：恢復大阪）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["大阪推薦景點", FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [1] }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([1, 2, 3]), searchIn: [{ turn: 3, dests: ["大阪", null] }], notSessionDest: { turns: [1, 2, 3], dest: "京都" }, notDerived: { turns: [1, 2, 3], dest: "京都" }, keepSessionDest: { turns: [1, 2], dest: "大阪" }, kyotoFree: { turns: [2, 3] }, noUnconfirmed: true } },',
    '  { id: "R6-RT-throw-A", label: "（sticky＋GPS，faithful）京都推薦景點 → 改去京都看楓葉推薦景點［retry 澄清］→ 不用 → 推薦咖啡廳（A：保留京都）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["京都推薦景點", FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [1] }, keepSessionDest: { turns: [1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2, 3], latlng: true }, noUnconfirmed: true } },',
    '  { id: "R6-RT-throw-gps-late", label: "（sticky、本輪前無位置；本輪取得 GPS，faithful）改去京都看楓葉推薦景點［retry 澄清；catch 以 send 開頭 session 重跑］", initKind: "stickyNearbyShortcutNoLoc", gps: GPS_LATE, faithful: true, turns: [FAULT_THROW("改去京都看楓葉推薦景點")], expect: { ...KR, viaRetry: { turns: [0] }, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true } },',
    '  { id: "R6-RT-timeout-B", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點［streamChat ai_timeout → retry（若可到達）］→ 不用 → 推薦咖啡廳", initKind: "stickyNearbyShortcutGps", faithful: true, turns: [FAULT_TIMEOUT("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都", cityEq: "台中市", curEq: "台中市" }, noUnconfirmed: true } },',
    '  { id: "R6-GPS-late-reject", label: "（sticky、本輪前無位置；本輪取得 GPS，faithful）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（GPS 保留、京都不沿用）", initKind: "stickyNearbyShortcutNoLoc", gps: GPS_LATE, faithful: true, turns: ["改去京都看楓葉推薦景點", "不用", "推薦咖啡廳"], expect: { ...KR, gpsKept: { turns: [0, 1, 2] }, notDerived: { turns: [0, 1, 2], dest: "京都" }, notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), kyotoFree: { turns: [1, 2] }, noUnconfirmed: true } },',
    "];",
    "const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS];",
  ),
);
P(
  "r6-ids",
  "const R5_IDS = new Set(R5_SCENARIOS.map((s) => s.id));",
  "const R5_IDS = new Set(R5_SCENARIOS.map((s) => s.id));\nconst R6_IDS = new Set(R6_SCENARIOS.map((s) => s.id));",
);
P(
  "trees",
  'const TREES = ["work", "pre", "base", ...(WITH_PRE4 ? ["pre4"] : [])];',
  'const TREES = ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])];',
);
P(
  "overlay-hits-all",
  "const overlayHitsAll = { pre: new Set(), pre4: new Set(), base: new Set() };",
  "const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set() };",
);
P(
  "infra-trees",
  L(
    "  // r5-Δ1：work = F5（f5Probe 位置還原為台中市）、pre = F5 前（arity 2、位置仍為京都）、pre4 = F4 前（arity 1）",
    '  if (tree === "work" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市")) infra.push(`INFRA-FAIL ${k} work 的 withoutUnconfirmedSessionDestinations 不是 F5 版（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)}）`);',
    '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "京都")) infra.push(`INFRA-FAIL ${k} pre overlay（F5 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)}）`);',
  ),
  L(
    "  // r6-Δ1：work = F6（a1 本輪 GPS 保留）、pre = F6 前（f5Probe 台中市、a1 location=null）、pre5 = F5 前（f5Probe 京都）、pre4 = F4 前（arity 1）",
    "  const a1Loc = oc.modProbes?.a1_gpsAcquiredThisTurn?.location ?? null;",
    '  if (tree === "work" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc)) infra.push(`INFRA-FAIL ${k} work 的 withoutUnconfirmedSessionDestinations 不是 F6 版（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);',
    '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || a1Loc)) infra.push(`INFRA-FAIL ${k} pre overlay（F6 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);',
    '  if (tree === "pre5" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "京都")) infra.push(`INFRA-FAIL ${k} pre5 overlay（F5 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)}）`);',
  ),
);
P(
  "infra-hits",
  '  if ((tree === "pre" || tree === "pre4") && !(oc.hits ?? []).includes(',
  '  if ((tree === "pre" || tree === "pre5" || tree === "pre4") && !(oc.hits ?? []).includes(',
);
P(
  "judge-r6-globals",
  L("function judge(WT) {", '  const p1 = WT === "work" ? [...graphP1] : [];'),
  L(
    "// r6-Δ6：retry 到達紀錄（各樹）",
    "const R6_RETRY = [];",
    "function judge(WT) {",
    '  const p1 = WT === "work" ? [...graphP1] : [];',
  ),
);
P(
  "fmt-viaRetry",
  '${t.f5NearbyStrip ? " | f5NearbyStrip" : ""}',
  '${t.f5NearbyStrip ? " | f5NearbyStrip" : ""}${t.viaRetry ? ` | viaRetry(${t.fallbackReason})` : ""}',
);
P(
  "expect-r6",
  L("        if (e.areaKeep) {", "          const from = W[e.areaKeep.from];"),
  L(
    "        // ── r6 新增 expect ──",
    "        if (e.viaRetry) {",
    "          for (const ti of e.viaRetry.turns) {",
    "            const w = W[ti];",
    '            const how = w?.viaRetry',
    '              ? `經 retry（reason=${w.fallbackReason}）clar=${w.clarified ? `Y(${w.copyKind}:${w.clarificationLabel})` : "N"} beforeProbe=${JSON.stringify(w.beforeProbe)} kyotoFields=[${(w.kyotoFields ?? []).join("; ")}] loc=${JSON.stringify(w.sessionLocation)} cur=${w.sessionCurrentLocation ?? "-"} path=${w.path}`',
    '              : `未經 retry（前提不成立）path=${w?.path ?? "(skipped)"}`;',
    "            R6_RETRY.push(`${WT.padEnd(5)} ${tag} T${ti + 1} ${how}`);",
    '            if (!w?.viaRetry) notes.push(`${tag} T${ti + 1} r6-retry：前提不成立（path=${w?.path ?? "(skipped)"}）`);',
    "          }",
    "        }",
    "        for (const ti of e.kyotoFree?.turns ?? []) {",
    "          const w = W[ti];",
    "          if (!w) continue;",
    "          const hits = (w.kyotoFields ?? []).filter((f) => !/^pendingClarification=/.test(f));",
    '          if (hits.length) p1.push(`${tag} T${ti + 1} r6-KYOTO：拒絕後 Session 仍含「京都」欄位 [${hits.join("; ")}]（path=${w.path}）`);',
    "        }",
    "        if (e.areaKeep) {",
    "          const from = W[e.areaKeep.from];",
  ),
);
P(
  "group",
  'const group = isT27 ? "T27" : R3_IDS.has(s.id) ? "R3" : R4_IDS.has(s.id) ? "R4" : R5_IDS.has(s.id) ? "R5" : "T28";',
  'const group = isT27 ? "T27" : R3_IDS.has(s.id) ? "R3" : R4_IDS.has(s.id) ? "R4" : R5_IDS.has(s.id) ? "R5" : R6_IDS.has(s.id) ? "R6" : "T28";',
);
P(
  "modeStats",
  "modeStats[m.id] ??= { T27: [0, 0], T28: [0, 0], R3: [0, 0], R4: [0, 0], R5: [0, 0] };",
  "modeStats[m.id] ??= { T27: [0, 0], T28: [0, 0], R3: [0, 0], R4: [0, 0], R5: [0, 0], R6: [0, 0] };",
);
P(
  "J",
  'const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}) };',
  'const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE5 ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}) };',
);
P("extHits-pre5", "  if (J.pre4) J.pre4.p1.push(h);", "  if (J.pre4) J.pre4.p1.push(h);\n  if (J.pre5) J.pre5.p1.push(h);");
P(
  "r6-probe-assert",
  'if (!mockKeyOk) J.work.p1.push("子程序 Mock Key 未生效");',
  L(
    'if (!mockKeyOk) J.work.p1.push("子程序 Mock Key 未生效");',
    "// r6-Δ5：真實模組 probe 的 GPS A/B/C 判定（各樹各自判定，計入該樹 P1；訊息不含數值以便 work/pre 對照，數值見 R6_PROBE_DETAIL）",
    "const R6_PROBE_DETAIL = [];",
    "{",
    "  const GPSP = { lat: 24.18, lng: 120.62 };",
    "  const valid = (l) => Boolean(l) && l.lat != null && l.lng != null && !(l.lat === 0 && l.lng === 0);",
    "  const sameLL = (l, p) => Boolean(l) && l.lat === p.lat && l.lng === p.lng;",
    '  const obj = (v) => v && typeof v === "object";',
    "  for (const WT of Object.keys(J)) {",
    "    const pr = modProbesByTree[WT];",
    "    if (!pr) {",
    '      J[WT].p1.push("[R6-PROBE] modProbes 缺失");',
    "      continue;",
    "    }",
    "    const chk = (ok, msg, v) => {",
    '      R6_PROBE_DETAIL.push(`${WT.padEnd(5)} ${ok ? "PASS" : "FAIL"} ${msg} → ${JSON.stringify(v)}`);',
    "      if (!ok) J[WT].p1.push(`[R6-PROBE] ${msg}`);",
    "    };",
    "    const a1 = pr.a1_gpsAcquiredThisTurn;",
    '    chk(obj(a1) && sameLL(a1.location, GPSP) && a1.currentLocation === "台中市", "A：本輪前無位置、本輪取得 GPS（台中市）→ location 與 currentLocation 必須保留", a1);',
    "    const a2 = pr.a2_gpsAcquiredNoCity;",
    '    chk(obj(a2) && sameLL(a2.location, GPSP), "A：本輪取得 GPS（無 city）→ 座標必須保留", a2);',
    "    const a3 = pr.a3_prevNoCoordsThenGps;",
    '    chk(obj(a3) && sameLL(a3.location, GPSP), "A：本輪前為 {0,0,大阪} 佔位、本輪取得 GPS → 座標必須保留", a3);',
    "    const a4 = pr.a4_tripIntentKyotoNoPrev;",
    '    chk(obj(a4) && !valid(a4.location) && a4.location?.city !== "京都" && a4.currentLocation !== "京都", "C：{0,0,京都} 佔位（本輪前無位置）不得留下 location／currentLocation=京都", a4);',
    "    const b = pr.r6_B_gpsCityRewrite;",
    '    chk(obj(b) && sameLL(b.location, GPSP) && b.location.city === "台中市" && b.currentLocation === "台中市", "B：本輪前 GPS 台中、applyTripIntent 改寫 city=京都 → city／currentLocation 必須退回台中市", b);',
    "    const cp = pr.r6_C_placeholderPrevGps;",
    '    chk(obj(cp) && sameLL(cp.location, GPSP) && cp.location.city === "台中市" && cp.currentLocation === "台中市", "C：本輪前 GPS 台中、本輪 location 變 {0,0,京都} → 必須退回本輪前 GPS", cp);',
    "    const c = pr.c_newRealLocation;",
    '    chk(obj(c) && Boolean(c.location) && c.location.lat === 34.69 && c.location.lng === 135.5, "A：本輪前 GPS 台中、本輪新真實位置（座標不同）→ 新座標保留", c);',
    "  }",
    "}",
  ),
);
P(
  "groupOf",
  'const groupOf = (id) => (T27_IDS.has(id) ? "T27" : R3_IDS.has(id) ? "R3" : R4_IDS.has(id) ? "R4" : R5_IDS.has(id) ? "R5" : "T28");',
  'const groupOf = (id) => (T27_IDS.has(id) ? "T27" : R3_IDS.has(id) ? "R3" : R4_IDS.has(id) ? "R4" : R5_IDS.has(id) ? "R5" : R6_IDS.has(id) ? "R6" : "T28");',
);
P("isR6", "const isR5Msg = (x) => /\\[R5-/.test(x);", "const isR5Msg = (x) => /\\[R5-/.test(x);\nconst isR6Msg = (x) => /\\[R6-/.test(x);");
P(
  "p1P5",
  "const p1P4 = J.pre4 ? new Set(uniq(J.pre4.p1)) : null;",
  "const p1P4 = J.pre4 ? new Set(uniq(J.pre4.p1)) : null;\nconst p1P5 = J.pre5 ? new Set(uniq(J.pre5.p1)) : null;",
);
P(
  "out-banner",
  "\nconst out = [];",
  L(
    "",
    "// r6-Δ6：各樹 Provider 總數與 work 對各樹的新增（情境×mode 有 work > 該樹）",
    "const PROV_TREES = {};",
    "const provNew = {};",
    "{",
    "  const tot = (tr, s, m) =>",
    "    results[`${tr}|${m.id}|${s.id}`].result.turns.reduce(",
    "      (a, t) => ({ g: a.g + t.geocodes.length, w: a.w + t.weatherCalls, b: a.b + t.builderCalls, p: a.p + t.placesRequests, c: a.c + t.creditsBegin }),",
    "      { g: 0, w: 0, b: 0, p: 0, c: 0 },",
    "    );",
    "  for (const tree of TREES) {",
    "    PROV_TREES[tree] = { g: 0, w: 0, b: 0, p: 0, c: 0 };",
    "    provNew[tree] = { any: 0, geocode: 0, credits: 0 };",
    "    for (const s of scenarios) {",
    "      for (const m of MODES) {",
    "        const t = tot(tree, s, m);",
    "        for (const k of Object.keys(t)) PROV_TREES[tree][k] += t[k];",
    '        if (tree === "work") continue;',
    '        const w = tot("work", s, m);',
    "        if (w.g > t.g || w.w > t.w || w.b > t.b || w.p > t.p) provNew[tree].any += 1;",
    "        if (w.g > t.g) provNew[tree].geocode += 1;",
    "        if (w.c > t.c) provNew[tree].credits += 1;",
    "      }",
    "    }",
    "  }",
    "}",
    'const out = ["［r6］本輸出沿用 r5 標籤：凡標示「F5 後」= work（F6 後）、「F5 前」/ pre = F6 前備份；pre5 = F5 前、pre4 = F4 前（可選）"];',
  ),
);
P(
  "out-pre-list",
  'out.push("\\n══ P1（pre = F5 前，僅 R4/R5 情境；其餘見計數）══", ...([...p1P].filter((x) => isR4Msg(x) || isR5Msg(x)).length ? [...p1P].filter((x) => isR4Msg(x) || isR5Msg(x)) : ["(none)"]));',
  'out.push("\\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══", ...([...p1P].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)).length ? [...p1P].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)) : ["(none)"]));',
);
P(
  "out-pre4-list",
  "if (p1P4) out.push(`\\n══ pre4（F4 前）P1=${p1P4.size}（僅列 R4/R5 情境）══`, ...[...p1P4].filter((x) => isR4Msg(x) || isR5Msg(x)));",
  L(
    "if (p1P4) out.push(`\\n══ pre4（F4 前）P1=${p1P4.size}（僅列 R4/R5 情境）══`, ...[...p1P4].filter((x) => isR4Msg(x) || isR5Msg(x)));",
    "if (p1P5) out.push(`\\n══ pre5（F5 前）P1=${p1P5.size}（僅列 R4/R5/R6 情境）══`, ...[...p1P5].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)));",
  ),
);
P(
  "out-modestats",
  "| R5 PASS=${st.R5[0]} FAIL=${st.R5[1]}`);",
  "| R5 PASS=${st.R5[0]} FAIL=${st.R5[1]} | R6 PASS=${st.R6[0]} FAIL=${st.R6[1]}`);",
);
P(
  "out-p1count",
  L(
    'for (const [WT, set] of [["work", p1W], ["pre", p1P], ...(p1P4 ? [["pre4", p1P4]] : [])]) {',
    "  out.push(`${WT}: P1=${set.size}（r3 情境=${countBy(set, (x) => !isR4Msg(x) && !isR5Msg(x))}，其中 r3-C2+=${countBy(set, (x) => isC2plus(x) && !isR4Msg(x) && !isR5Msg(x))}；R4 情境=${countBy(set, isR4Msg)}；R5 情境=${countBy(set, isR5Msg)}）`);",
  ),
  L(
    'for (const [WT, set] of [["work", p1W], ["pre", p1P], ...(p1P5 ? [["pre5", p1P5]] : []), ...(p1P4 ? [["pre4", p1P4]] : [])]) {',
    "  out.push(`${WT}: P1=${set.size}（r3 情境=${countBy(set, (x) => !isR4Msg(x) && !isR5Msg(x) && !isR6Msg(x))}，其中 r3-C2+=${countBy(set, (x) => isC2plus(x) && !isR4Msg(x) && !isR5Msg(x) && !isR6Msg(x))}；R4 情境=${countBy(set, isR4Msg)}；R5 情境=${countBy(set, isR5Msg)}；R6 情境/probe=${countBy(set, isR6Msg)}）`);",
  ),
);
P(
  "out-r6-sections",
  "out.push(`新增 P1（work 有、pre 無）=${newInWork.length}  F5 消除=${fixedByF5.length}`);",
  L(
    "out.push(`新增 P1（work 有、pre 無）=${newInWork.length}  F5 消除=${fixedByF5.length}`);",
    'out.push("\\n══ r6：真實模組 GPS A/B/C probe 判定（各樹）══", ...R6_PROBE_DETAIL);',
    'out.push("\\n══ r6：retry（applyLocalFallback destination-category-retry）到達紀錄 ══", ...(R6_RETRY.length ? R6_RETRY : ["(none)"]));',
    'out.push("\\n══ r6：各樹 Provider 總數（geocode / weather / builder / placesReq / credits）══");',
    'for (const [tree, t] of Object.entries(PROV_TREES)) out.push(`${tree.padEnd(5)} geocode=${t.g} weather=${t.w} builder=${t.b} placesReq=${t.p} credits=${t.c}${tree === "work" ? "" : `  | work>${tree} 的情境×mode：provider=${provNew[tree].any} geocode=${provNew[tree].geocode} credits=${provNew[tree].credits}`}`);',
  ),
);
P(
  "out-count",
  "R5=${scenarios.filter((s) => R5_IDS.has(s.id)).length}） 模式=",
  "R5=${scenarios.filter((s) => R5_IDS.has(s.id)).length} R6=${scenarios.filter((s) => R6_IDS.has(s.id)).length}） 模式=",
);
P("out-final", "out.push(`verify-destination-authority-phase2-r5: work P1=", "out.push(`verify-destination-authority-phase2-r6: work P1=");

// ── apply ──
let text = readFileSync(SRC, "utf8");
const errors = [];
for (const p of patches) {
  const n = text.split(p.old).length - 1;
  if (n !== 1) {
    errors.push(`${p.id}: old 出現 ${n} 次（需 1 次）`);
    continue;
  }
  text = text.replace(p.old, () => p.neu);
}
if (errors.length) {
  console.log(["BUILD-FAIL（未寫檔）", ...errors].join("\n"));
  process.exit(1);
}
writeFileSync(OUT, text);
console.log(`BUILD-OK patches=${patches.length} → ${OUT}（${text.split("\n").length} 行）`);
