#!/usr/bin/env node
// Builds scripts/verify-destination-authority-phase2-r7.mjs from r6 (r6 is NOT modified).
// Every patch's `old` text must occur exactly once in the current text; otherwise abort without writing.
// Run: node scripts/verify-destination-authority-phase2-r7-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r6.mjs";
const OUT = "/Users/shuo/Roamie-clean/scripts/verify-destination-authority-phase2-r7.mjs";
const L = (...lines) => lines.join("\n");

const patches = [];
const P = (id, old, neu) => patches.push({ id, old, neu });

// ── header ──
P(
  "header",
  L("/**", " * R4 — Phase 2 Recovery 第一組限定安全修正 F6 獨立驗收（第 3 輪＝最後一輪）。"),
  L(
    "/**",
    " * R7 — Location Authority 方案 A（F8：R-1 / J1 / nearbyLocationAuthority）獨立驗收。",
    " * 由 scripts/verify-destination-authority-phase2-r7-build.mjs 以 r6（保留不改）逐字複製並套用 exact-once patch 產生（r7-Δ）：",
    " *",
    " *  r7-Δ1 樹：work（F8 後）、pre（F6＝F7 前備份：chat-turn-destination.ts / resolve-chat-location.ts / _app.chat.tsx 以",
    " *         scratchpad 的 *.pre-F7.* overlay；harness inline 邏輯走 F4+F5+F6 分支、不走 F8 分支）、base（aa2db59，不變）。",
    " *         sha 快照改為 pre-F7-sha.txt；resolve-chat-location.ts 在 F7 前未修改（不在快照）→ 改以「pre 備份 = HEAD」驗證。",
    " *  r7-Δ2 F8 鏡像（只在 work）：send() turnStartSession 位置欄位取本輪 base session（L7728-7733）；",
    " *         L10900 catch：turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession)（內層 try 之外），",
    " *         applyLocalFallback({ ...session, location, nearbyLocationAuthority }, …)。withoutUnconfirmedSessionDestinations 一律真實模組。",
    " *  r7-Δ3 realRcl 情境：resolveChatLocation 以各樹原始碼載入，只把平台依賴 import 換成 globalThis.__R7_LOC__ mock",
    " *         （snapshot / bootstrap = null、app active、device = scenario.device；device 呼叫數計入 obs.deviceCalls）；",
    " *         非 realRcl 情境沿用 r5 mock（行為不變）。L10423 requireNearbyAuthority 參數依原始碼條件傳入。",
    " *  r7-Δ4 anchors：pre = r6 work anchors（F6）；work = r6 work anchors − 2 條 F8 改寫文字 + F8 anchors；",
    " *         applyLocalFallback 呼叫點 turnStartSession 鄰近視窗 7→12 行（F8 的 catch 呼叫物件字面量多 5 行；仍要求 6/6）；",
    " *         pre 的 F6 次數檢查改為 F6 預期（3 次、含 opts?.turnStartSession 轉傳），並檢查 pre 不含 F8 文字。",
    " *  r7-Δ5 infra 樹判別新增 r7_tripAddPlace probe（work 退回輪前 GPS、pre 保留目的地座標）。",
    " *  r7-Δ6 R7 情境（GPS late device 無 city、人在京都、Nearby 指定中心、device authority、pending、more_places、R-1 邊界）、",
    " *         expect r7Loc、obs.sessionAuthority / deviceCalls / retryLoc、throw vs 正常 Provider 配對比較、work 相對 base 的新增 P1（judge(base)）。",
    " *  r6 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。",
    " *",
    " * 執行：node scripts/verify-destination-authority-phase2-r7.mjs --brief [--only=ID,…]",
    " *",
    " * ── 以下為 r6 原始說明 ──",
    " * R4 — Phase 2 Recovery 第一組限定安全修正 F6 獨立驗收（第 3 輪＝最後一輪）。",
  ),
);
P(
  "script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r6.mjs`;",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r7.mjs`;",
);
P(
  "pre-files",
  L(
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F6.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F6.tsx`,',
    "};",
  ),
  L(
    "// r7-Δ1：pre = F7 前備份（= F6）",
    "const PRE_FILES = {",
    '  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F7.ts`,',
    '  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F7.tsx`,',
    '  "src/lib/ai/resolve-chat-location.ts": `${PRE_DIR}/resolve-chat-location.pre-F7.ts`,',
    "};",
  ),
);
P(
  "pre-sha",
  "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-F6-sha.txt`; // r6-Δ1：F6 開始前（12:17）src 檔案 sha1",
  "const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-F7-sha.txt`; // r7-Δ1：F7 開始前 sha1 快照",
);
P(
  "flags",
  '  const F6 = TREE === "work"; // r6-Δ2：只有 work 走 F6 inline 邏輯（applyLocalFallback retry 傳 turnStartSession）',
  L(
    '  const F6 = TREE === "work" || TREE === "pre"; // r7-Δ1：pre = F6（已含 F6 retry 傳 turnStartSession）',
    '  const F8 = TREE === "work"; // r7-Δ2：只有 work 走 F8 inline 邏輯（turnStartSession 位置欄位、catch turnLocation）',
  ),
);
P(
  "overlay-pre",
  L(
    '  } else if (TREE === "pre") {',
    "    // r6-Δ1：pre = 工作區 + F6 前的 chat-turn-destination.ts",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
  ),
  L(
    '  } else if (TREE === "pre") {',
    "    // r7-Δ1：pre = 工作區 + F7 前（F6）的 chat-turn-destination.ts / resolve-chat-location.ts",
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/resolve-chat-location.ts`, readFileSyncC(PRE_FILES["src/lib/ai/resolve-chat-location.ts"], "utf8"));',
  ),
);
P(
  "plugin-rcl",
  L("    load(id) {", '      if (TREE === "work") return null;', '      const file = id.split("?")[0];'),
  L(
    "    load(id) {",
    "      // r7-Δ3：resolve-chat-location.ts（各樹內容）只替換平台依賴 import → globalThis.__R7_LOC__",
    '      const rclFile = id.split("?")[0];',
    "      if (rclFile === `${WORK_ROOT}/src/lib/ai/resolve-chat-location.ts`) {",
    '        let src = baseContent.get(rclFile) ?? readFileSyncC(rclFile, "utf8");',
    "        const reps = [",
    '          [/import\\s*\\{\\s*devVerboseInfo\\s*\\}\\s*from\\s*"@\\/lib\\/dev-verbose-log";/, "const devVerboseInfo = () => {};"],',
    '          [/import\\s*\\{\\s*ensureEffectiveLocationBootstrap,\\s*getEffectiveLocationSnapshot,?\\s*\\}\\s*from\\s*"@\\/lib\\/effective-location";/, "const ensureEffectiveLocationBootstrap = (...a) => globalThis.__R7_LOC__.bootstrap(...a);\\nconst getEffectiveLocationSnapshot = (...a) => globalThis.__R7_LOC__.snapshot(...a);"],',
    '          [/import\\s*\\{\\s*requestDeviceLocation\\s*\\}\\s*from\\s*"@\\/lib\\/device-location";/, "const requestDeviceLocation = (...a) => globalThis.__R7_LOC__.device(...a);"],',
    '          [/import\\s*\\{\\s*isAppActiveForLocation\\s*\\}\\s*from\\s*"@\\/lib\\/location-app-gate";/, "const isAppActiveForLocation = (...a) => globalThis.__R7_LOC__.active(...a);"],',
    "        ];",
    "        r7RclMiss = [];",
    "        for (const [re, rep] of reps) {",
    "          if (!re.test(src)) r7RclMiss.push(String(re));",
    "          src = src.replace(re, rep);",
    "        }",
    '        if (/@\\/lib\\/(effective-location|device-location|location-app-gate|dev-verbose-log)/.test(src)) r7RclMiss.push("殘留平台 import");',
    '        if (TREE !== "work") overlayHits.add("src/lib/ai/resolve-chat-location.ts");',
    "        return src;",
    "      }",
    '      if (TREE === "work") return null;',
    '      const file = id.split("?")[0];',
  ),
);
P("rcl-miss-var", "  const overlayHits = new Set();", "  const overlayHits = new Set();\n  let r7RclMiss = null; // r7-Δ3");
P(
  "modules",
  '    rss: FAITHFUL ? await imp("lib/ai/recommendation-search-scope.ts") : null,\n  };',
  L(
    '    rss: FAITHFUL ? await imp("lib/ai/recommendation-search-scope.ts") : null,',
    "    // r7-Δ3：realRcl 情境載入各樹真實 resolveChatLocation（平台依賴 mock）",
    '    rcl: SCENARIO.realRcl ? await imp("lib/ai/resolve-chat-location.ts") : null,',
    "  };",
    "  if (SCENARIO.realRcl && (!r7RclMiss || r7RclMiss.length)) throw new Error(`[r7] resolve-chat-location mock 未生效 miss=${JSON.stringify(r7RclMiss)}`);",
  ),
);
P(
  "probes-r7",
  '        r6_nearZeroCoords: run({ ...B0, location: { lat: 0.0005, lng: 0.0005, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),',
  L(
    '        r6_nearZeroCoords: run({ ...B0, location: { lat: 0.0005, lng: 0.0005, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),',
    "        // r7-Δ5：F8 判別 probe（Trip Add Place 旗標＋context：目的地座標不得當成本輪 GPS）",
    "        r7_tripAddPlace: run(",
    '          { ...beforeGps, fromTripAddPlace: true, tripAddPlaceContext: { destination: "京都" }, location: { lat: 35.0116, lng: 135.7681, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "京都" } },',
    '          { ...beforeGps, fromTripAddPlace: true, tripAddPlaceContext: { destination: "京都" } },',
    "        ),",
    "        r7_clarCenterPrevGps: run(",
    '          { ...beforeGps, location: { lat: 25.042, lng: 121.507, city: "西門町" }, nearbyLocationAuthority: { displayLabel: "西門町", lat: 25.042, lng: 121.507, source: "clarification" }, travelContext: { interests: [], currentLocation: "京都" } },',
    '          { ...beforeGps, nearbyLocationAuthority: { displayLabel: "西門町", lat: 25.042, lng: 121.507, source: "clarification" } },',
    "        ),",
  ),
);
P(
  "obs-fields",
  L("      viaRetry: false,", "      fallbackReason: null,", "    };"),
  L("      viaRetry: false,", "      fallbackReason: null,", "      // r7-Δ6", "      sessionAuthority: null,", "      deviceCalls: 0,", "      retryLoc: null,", "    };"),
);
P(
  "initKinds",
  '    } else if (SCENARIO.initKind === "stickyPending") {',
  L(
    "      // r7-Δ6：新增 initKind",
    '    } else if (SCENARIO.initKind === "stickyKyotoGps") {',
    '      persisted = { ...baseSession(), normalizedShortcutRequest: sticky(), location: { lat: 35.0116, lng: 135.7681, city: "京都" }, nearbyLocationAuthority: { displayLabel: "京都", lat: 35.0116, lng: 135.7681, source: "device" }, travelContext: { interests: [], currentLocation: "京都" } };',
    '    } else if (SCENARIO.initKind === "gpsKyoto") {',
    '      persisted = { ...baseSession(), location: { lat: 35.0116, lng: 135.7681, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } };',
    '    } else if (SCENARIO.initKind === "stickyClarAuthGps") {',
    '      persisted = { ...baseSession(), normalizedShortcutRequest: sticky(), location: { ...GPS_TC }, nearbyLocationAuthority: { displayLabel: "西門町", lat: 25.042, lng: 121.507, source: "clarification" }, travelContext: { interests: [], currentLocation: "台中市" } };',
    '    } else if (SCENARIO.initKind === "stickyTaichungAuthGps") {',
    '      persisted = { ...baseSession(), normalizedShortcutRequest: sticky(), location: { ...GPS_TC }, nearbyLocationAuthority: { displayLabel: "台中市", lat: 24.18, lng: 120.62, source: "device" }, travelContext: { interests: [], currentLocation: "台中市" } };',
    '    } else if (SCENARIO.initKind === "stickyPending") {',
  ),
);
P(
  "locResolve",
  L(
    "    if (SCENARIO.gps) return { ...s, location: { lat: SCENARIO.gps.lat, lng: SCENARIO.gps.lng, city: SCENARIO.gps.city } };",
    "    return s;",
    "  };",
  ),
  L(
    "    if (SCENARIO.gps) return { ...s, location: { lat: SCENARIO.gps.lat, lng: SCENARIO.gps.lng, city: SCENARIO.gps.city } };",
    "    return s;",
    "  };",
    "  // r7-Δ3：realRcl 情境改呼叫各樹真實 resolveChatLocation（平台依賴 mock）；其餘情境沿用上方 mock（行為不變）",
    "  let r7DeviceCalls = 0;",
    "  globalThis.__R7_LOC__ = {",
    "    snapshot: () => SCENARIO.snapshot ?? null,",
    "    bootstrap: async () => SCENARIO.bootstrap ?? null,",
    "    active: () => true,",
    "    device: async () => {",
    "      r7DeviceCalls += 1;",
    '      return SCENARIO.device ?? { lat: null, lng: null, city: "", usedFallback: true };',
    "    },",
    "  };",
    "  const locResolve = async (s, opts) => (SCENARIO.realRcl ? M.rcl.resolveChatLocation(s, opts) : mockResolveChatLocation(s));",
  ),
);
P(
  "call-early",
  "    if (FAITHFUL && nearbyShortcutTurn) nextSession = mockResolveChatLocation(nextSession);",
  "    if (FAITHFUL && nearbyShortcutTurn) nextSession = await locResolve(nextSession); // r7-Δ3",
);
P(
  "call-structured",
  "          nextSession = mockResolveChatLocation(nextSession);\n          persistSession(nextSession);",
  "          nextSession = await locResolve(nextSession); // r7-Δ3\n          persistSession(nextSession);",
);
P(
  "call-late",
  "        nextSession = mockResolveChatLocation(nextSession);\n      }\n      if (inferred && !nextSession.activeChatIntent)",
  L(
    "        // r7-Δ3：L10423-10426 requireNearbyAuthority = selectedRouteAuthority === \"nearby\" && userExplicitlyWantsNearbyPlaces(trimmed)",
    '        nextSession = await locResolve(nextSession, { requireNearbyAuthority: lateAuthority === "nearby" && M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed) });',
    "      }",
    "      if (inferred && !nextSession.activeChatIntent)",
  ),
);
P(
  "turnStartSession",
  "    const turnStartSession = F5 ? { ...persisted, pendingClarification: undefined } : undefined;",
  L(
    "    // r7-Δ2：F8 L7728-7733 位置欄位取本輪 base session（harness 無 restorePendingPlanAiOwner 切換，session 位置 = persisted 位置）",
    "    const turnStartSession = F5",
    "      ? F8",
    "        ? { ...persisted, location: session.location, nearbyLocationAuthority: session.nearbyLocationAuthority, pendingClarification: undefined }",
    "        : { ...persisted, pendingClarification: undefined }",
    "      : undefined;",
  ),
);
P(
  "catch-F8",
  L(
    '        const errorConversation = [...msgs, { role: "user", content: trimmed }];',
    '        const fb = await applyLocalFallback(obs, session, trimmed, errorConversation, "state_machine_error", turnStartSession);',
  ),
  L(
    '        const errorConversation = [...msgs, { role: "user", content: trimmed }];',
    "        // r7-Δ2：F8 L10898-10912（turnLocation 在內層 try 之外計算；F6 前 = applyLocalFallback(session, …)）",
    "        let retrySession = session;",
    "        if (F8) {",
    "          const turnLocation = M.ctd.withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);",
    "          retrySession = { ...session, location: turnLocation.location, nearbyLocationAuthority: turnLocation.nearbyLocationAuthority };",
    "        }",
    "        obs.retryLoc = { location: retrySession.location ?? null, authority: retrySession.nearbyLocationAuthority ?? null };",
    '        const fb = await applyLocalFallback(obs, retrySession, trimmed, errorConversation, "state_machine_error", turnStartSession);',
  ),
);
P("d0", "      const s0 = creditsSettle.length;", "      const s0 = creditsSettle.length;\n      const d0 = r7DeviceCalls; // r7-Δ6");
P(
  "obs-record",
  L(
    "      obs.sessionLocation = persisted.location",
    "        ? { lat: persisted.location.lat ?? null, lng: persisted.location.lng ?? null, city: persisted.location.city ?? null }",
    "        : null;",
  ),
  L(
    "      obs.sessionLocation = persisted.location",
    "        ? { lat: persisted.location.lat ?? null, lng: persisted.location.lng ?? null, city: persisted.location.city ?? null }",
    "        : null;",
    "      // r7-Δ6",
    "      const au = persisted.nearbyLocationAuthority;",
    "      obs.sessionAuthority = au ? { source: au.source ?? null, lat: au.lat ?? null, lng: au.lng ?? null, displayLabel: au.displayLabel ?? null } : null;",
    "      obs.deviceCalls = r7DeviceCalls - d0;",
  ),
);
P("rcl-miss-out", "  overlayCheck.hits = [...overlayHits].sort();", "  overlayCheck.hits = [...overlayHits].sort();\n  overlayCheck.r7RclMiss = r7RclMiss; // r7-Δ3");
// ── sha 快照（F7 前）──
P(
  "sha-check",
  L(
    "    const expected = new Set(Object.keys(PRE_FILES));",
    "    const unexpected = shaDiff.filter((f) => !expected.has(f));",
    "    if (unexpected.length) preInfra.push(`F5 開始後除 2 檔外還有 src 變動：${unexpected.join(\", \")}`);",
    "    for (const f of expected) if (!shaDiff.includes(f)) preInfra.push(`sha 快照顯示 ${f} 未被 F5 修改`);",
  ),
  L(
    "    const expected = new Set(Object.keys(PRE_FILES));",
    "    const unexpected = shaDiff.filter((f) => !expected.has(f));",
    "    // r7-Δ1：快照外（F7 前未修改）的檔案若現在有變動，也算 F7/F8 期間的變動（r7 驗收腳本本身除外）",
    "    const inSnap = new Set(snapLines.map((l) => l.slice(42)));",
    '    const nowChanged = [...git(["diff", "--name-only", "HEAD"]).split("\\n"), ...git(["ls-files", "--others", "--exclude-standard"]).split("\\n")].filter(Boolean);',
    "    for (const f of nowChanged) if (!inSnap.has(f) && !expected.has(f) && !/^scripts\\/verify-destination-authority-phase2-r7/.test(f)) unexpected.push(f);",
    "    if (unexpected.length) preInfra.push(`F7 開始後除 3 檔外還有變動：${unexpected.join(\", \")}`);",
    "    for (const f of expected) {",
    "      if (inSnap.has(f)) {",
    "        if (!shaDiff.includes(f)) preInfra.push(`sha 快照顯示 ${f} 未被 F7/F8 修改`);",
    '      } else if (readFileSync(PRE_FILES[f], "utf8") !== git(["show", `HEAD:${f}`])) {',
    "        preInfra.push(`${f} 不在 F7 前快照（F7 前未修改），但 pre 備份 ≠ HEAD`);",
    "      }",
    "    }",
  ),
);
P("pre-infra-label", 'for (const [label, files] of [["pre(F6 前)", PRE_FILES],', 'for (const [label, files] of [["pre(F7 前＝F6)", PRE_FILES],');
// ── anchors ──
P(
  "anchors-r7",
  L("ANCHORS.pre5 = ANCHORS.pre;", "ANCHORS.pre = ANCHORS.work;", "ANCHORS.work = [...ANCHORS.work, ...F6_WORK_ANCHORS];"),
  L(
    "ANCHORS.pre5 = ANCHORS.pre;",
    "// r7-Δ4：pre = F6（= r6 work anchors）；work = r6 work anchors − F8 改寫的 2 條 + F8 anchors",
    "ANCHORS.pre = [...ANCHORS.work, ...F6_WORK_ANCHORS];",
    "const F8_REPLACED = [F5_WORK_ANCHORS[3], F6_WORK_ANCHORS[F6_WORK_ANCHORS.length - 1]];",
    "const F8_WORK_ANCHORS = [",
    '  "const turnStartSession: ChatPlanningSession = {\\n      ...sessionRef.current,\\n      location: session.location,\\n      nearbyLocationAuthority: session.nearbyLocationAuthority,\\n      pendingClarification: undefined,\\n    };",',
    '  "const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);\\n      try {\\n        const fallbackApplied = await applyLocalFallback(\\n          {\\n            ...session,\\n            location: turnLocation.location,\\n            nearbyLocationAuthority: turnLocation.nearbyLocationAuthority,\\n          },\\n          trimmed,\\n          errorConversation,\\n          \\"state_machine_error\\",\\n          turnStartSession,",',
    "];",
    "if (F8_REPLACED.some((a) => typeof a !== \"string\")) throw new Error(\"r7 anchor 取代目標不存在\");",
    "ANCHORS.work = [...ANCHORS.pre.filter((a) => !F8_REPLACED.includes(a)), ...F8_WORK_ANCHORS];",
  ),
);
P(
  "anchor-fb-window",
  "  const fbWith = fb.filter((l) => /turnStartSession/.test(near(l, 7)));",
  "  const fbWith = fb.filter((l) => /turnStartSession/.test(near(l, 12))); // r7-Δ4：F8 catch 呼叫多 5 行物件字面量",
);
P(
  "anchor-pre-count",
  '  if (cpre("{ turnStartSession },") !== 2) anchorFail.push(`pre(F6 前): "{ turnStartSession }," 次數=${cpre("{ turnStartSession },")}（預期 2，同 r5 work）`);',
  '  if (cpre("{ turnStartSession },") !== 3) anchorFail.push(`pre(F6): "{ turnStartSession }," 次數=${cpre("{ turnStartSession },")}（預期 3，同 r6 work）`);',
);
P(
  "anchor-pre-f6",
  '  if (SRC.pre.includes("opts?.turnStartSession,\\n")) anchorFail.push("pre(F6 前) 已含 F6 的 opts?.turnStartSession 轉傳（備份錯誤？）");',
  L(
    '  if (!SRC.pre.includes("opts?.turnStartSession,\\n")) anchorFail.push("pre(F6) 缺少 F6 的 opts?.turnStartSession 轉傳（備份錯誤？）");',
    "  // r7-Δ4：pre 不得含 F8 文字；work / pre 的 resolve-chat-location.ts 裝置 city 來源",
    '  for (const a of ["location: session.location,\\n      nearbyLocationAuthority: session.nearbyLocationAuthority,", "const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);"]) {',
    "    if (SRC.pre.includes(a)) anchorFail.push(`pre(F6) 已含 F8 文字：${a.split(\"\\n\")[0]}`);",
    "    if (!src.includes(a)) anchorFail.push(`work 缺少 F8 文字：${a.split(\"\\n\")[0]}`);",
    "  }",
    '  const rclWork = readFileSync(`${WORK_ROOT}/src/lib/ai/resolve-chat-location.ts`, "utf8");',
    '  const rclPre = readFileSync(PRE_FILES["src/lib/ai/resolve-chat-location.ts"], "utf8");',
    '  for (const a of ["city: device.city ?? \\"\\",", "displayLabel: device.city ?? \\"\\","]) {',
    "    if (!rclWork.includes(a)) anchorFail.push(`work resolve-chat-location 缺少 F8 文字：${a}`);",
    "    if (rclPre.includes(a)) anchorFail.push(`pre resolve-chat-location 已含 F8 文字：${a}`);",
    "  }",
    '  if (!rclPre.includes("device.city ?? session.location?.city ?? \\"\\"")) anchorFail.push("pre resolve-chat-location 缺少 F7 前 city 補值文字");',
    "  anchorLines.push(`work turnLocation 位於 L${lineOf(src, \"const turnLocation = withoutUnconfirmedSessionDestinations(\").join(\",\")}；catch 內層 try 位於 L${lineOf(src, \"const turnLocation = withoutUnconfirmedSessionDestinations(nextSession, turnStartSession);\\n      try {\").map((l) => l + 1).join(\",\")}`);",
  ),
);
// ── infra 樹判別 ──
P(
  "infra-trees",
  L(
    '  if (tree === "work" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc)) infra.push(`INFRA-FAIL ${k} work 的 withoutUnconfirmedSessionDestinations 不是 F6 版（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);',
    '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || a1Loc)) infra.push(`INFRA-FAIL ${k} pre overlay（F6 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);',
  ),
  L(
    "  // r7-Δ5：work = F8（r7_tripAddPlace 退回輪前 GPS 24.18）、pre = F6（a1 保留、r7_tripAddPlace 保留目的地座標 35.0116）",
    "  const r7Trip = oc.modProbes?.r7_tripAddPlace?.location ?? null;",
    '  if (tree === "work" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc || r7Trip?.lat !== 24.18)) infra.push(`INFRA-FAIL ${k} work 的 withoutUnconfirmedSessionDestinations 不是 F8 版（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)} r7Trip=${JSON.stringify(r7Trip)}）`);',
    '  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc || r7Trip?.lat !== 35.0116)) infra.push(`INFRA-FAIL ${k} pre overlay（F7 前＝F6）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)} r7Trip=${JSON.stringify(r7Trip)}）`);',
  ),
);
// ── 情境 ──
P(
  "r7-scenarios",
  "const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS];",
  L(
    "// ── r7-Δ6：R7 新增情境 ──",
    'const TEXT_K = "改去京都看楓葉推薦景點";',
    "const DEV0 = { lat: 24.18, lng: 120.62, city: \"\", usedFallback: false }; // 真實 GPS fix（device-location 回傳 city \"\"）",
    "const DEVU = { lat: 24.18, lng: 120.62, usedFallback: false }; // city 缺失（persisted 舊資料）",
    "const LL_TC = { lat: 24.18, lng: 120.62 };",
    "const LL_KY = { lat: 35.0116, lng: 135.7681 };",
    "const LL_XM = { lat: 25.042, lng: 121.507 };",
    "const LOC_NOKYOTO = (turns) => [{ turns, ll: LL_TC, cityNot: \"京都\", curNot: \"京都\", authLabelNot: \"京都\" }];",
    "const R7F = { faithful: true, realRcl: true };",
    "const R7_SCENARIOS = [",
    '  { id: "R7-RT-gpslate-dev0", label: "（sticky、本輪前無位置；本輪 device GPS city=\\"\\"，realRcl）改去京都看楓葉推薦景點［L10471 後例外→catch retry］", initKind: "stickyNearbyShortcutNoLoc", device: DEV0, ...R7F, turns: [FAULT_THROW(TEXT_K)], expect: { ...KR, viaRetry: { turns: [0] }, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0]) } },',
    '  { id: "R7-NM-gpslate-dev0", label: "（同上，無例外：正常路徑對照）", initKind: "stickyNearbyShortcutNoLoc", device: DEV0, ...R7F, turns: [TEXT_K], expect: { ...KR, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0]) } },',
    '  { id: "R7-RT-gpslate-devU", label: "（sticky、本輪前無位置；本輪 device GPS city 缺失，realRcl）改去京都看楓葉推薦景點［例外→catch retry］", initKind: "stickyNearbyShortcutNoLoc", device: DEVU, ...R7F, turns: [FAULT_THROW(TEXT_K)], expect: { ...KR, viaRetry: { turns: [0] }, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0]) } },',
    '  { id: "R7-NM-gpslate-devU", label: "（同上，無例外：正常路徑對照）", initKind: "stickyNearbyShortcutNoLoc", device: DEVU, ...R7F, turns: [TEXT_K], expect: { ...KR, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0]) } },',
    '  { id: "R7-GPSLATE-devU-reject", label: "（device GPS city 缺失）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（京都不得由 location.city 復活）", initKind: "stickyNearbyShortcutNoLoc", device: DEVU, ...R7F, turns: [TEXT_K, "不用", "推薦咖啡廳"], expect: { ...KR, gpsKept: { turns: [0, 1, 2] }, notDerived: { turns: [0, 1, 2], dest: "京都" }, notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), kyotoFree: { turns: [1, 2] }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0, 1, 2]) } },',
    '  { id: "R7-RT-gpslate-devU-reject", label: "（device GPS city 缺失）改去京都看楓葉推薦景點［例外→retry］→ 不用 → 推薦咖啡廳", initKind: "stickyNearbyShortcutNoLoc", device: DEVU, ...R7F, turns: [FAULT_THROW(TEXT_K), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, gpsKept: { turns: [0, 1, 2] }, notDerived: { turns: [0, 1, 2], dest: "京都" }, notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), kyotoFree: { turns: [1, 2] }, noUnconfirmed: true, r7Loc: LOC_NOKYOTO([0, 1, 2]) } },',
    '  { id: "R7-KYOTO-RT", label: "（人在京都：GPS＋device authority 京都，sticky）改去京都看楓葉推薦景點［例外→retry］→ 不用 → 推薦咖啡廳（city 不得誤清）", initKind: "stickyKyotoGps", ...R7F, turns: [FAULT_THROW(TEXT_K), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_KY, cityEq: "京都", curEq: "京都", authSrc: "device", authLabelEq: "京都" }] } },',
    '  { id: "R7-KYOTO-NM", label: "（人在京都，sticky）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（city 不得誤清）", initKind: "stickyKyotoGps", ...R7F, turns: [TEXT_K, "不用", "推薦咖啡廳"], expect: { ...KR, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_KY, cityEq: "京都", curEq: "京都", authSrc: "device", authLabelEq: "京都" }] } },',
    '  { id: "R7-KYOTO-nf", label: "（人在京都 GPS）京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（非 faithful；city 不得誤清）", initKind: "gpsKyoto", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_KY, cityEq: "京都", curEq: "京都" }] } },',
    '  { id: "R7-AUTHCLAR-RT", label: "（GPS 台中＋Nearby 指定中心 西門町，sticky）改去京都看楓葉推薦景點［例外→retry］→ 不用 → 推薦咖啡廳", initKind: "stickyClarAuthGps", ...R7F, turns: [FAULT_THROW(TEXT_K), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, kyotoFree: { turns: [1, 2] }, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_TC, cityEq: "台中市", curEq: "台中市", authSrc: "clarification", authLL: LL_XM, authLabelEq: "西門町" }] } },',
    '  { id: "R7-AUTHCLAR-NM", label: "（GPS 台中＋Nearby 指定中心 西門町，sticky）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳", initKind: "stickyClarAuthGps", ...R7F, turns: [TEXT_K, "不用", "推薦咖啡廳"], expect: { ...KR, kyotoFree: { turns: [1, 2] }, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_TC, cityEq: "台中市", curEq: "台中市", authSrc: "clarification", authLL: LL_XM, authLabelEq: "西門町" }] } },',
    '  { id: "R7-AUTHDEV-RT", label: "（GPS 台中＋device authority 台中市，sticky）改去京都看楓葉推薦景點［例外→retry］→ 不用 → 推薦咖啡廳", initKind: "stickyTaichungAuthGps", ...R7F, turns: [FAULT_THROW(TEXT_K), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, kyotoFree: { turns: [1, 2] }, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2], ll: LL_TC, cityEq: "台中市", curEq: "台中市", authSrc: "device", authLabelEq: "台中市" }] } },',
    '  { id: "R7-PEND-RT", label: "（sticky＋GPS＋殘留京都 parent pending）改去大阪推薦景點［例外→retry］→ 好（pending 不得復活）", initKind: "stickyPending", ...R7F, turns: [FAULT_THROW("改去大阪推薦景點"), "好"], expect: { ...KR, pendingEmpty: [0, 1], notSearch: NOKYOTO([0, 1]), noCreditsDest: NOKYOTO([0, 1]), noUnconfirmed: true, r7Loc: [{ turns: [0, 1], ll: LL_TC, cityNot: "京都", curNot: "京都" }] } },',
    '  { id: "R7-MORE-RT", label: "（sticky＋GPS）大阪推薦景點 → 改去京都看楓葉推薦景點［例外→retry］→ 不用 → 再推薦幾個（more_places／Credits 不得用京都）", initKind: "stickyNearbyShortcutGps", ...R7F, turns: ["大阪推薦景點", FAULT_THROW(TEXT_K), "不用", "再推薦幾個"], expect: { ...KR, viaRetry: { turns: [1] }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([1, 2, 3]), kyotoFree: { turns: [2, 3] }, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2, 3], ll: LL_TC, cityNot: "京都", curNot: "京都" }] } },',
    '  { id: "R7-LOC-A-city", label: "（GPS 台中）京都推薦景點 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（R-1 邊界：已確認京都成功輪後 location.city）", initKind: "gpsTaichung", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, noUnconfirmed: true, r7Loc: [{ turns: [0, 1, 2, 3], ll: LL_TC, cityEq: "台中市" }] } },',
    "];",
    "// throw vs 正常路徑 Provider 配對（同一樹、同一 mode）",
    "const R7_PAIRS = [",
    '  ["R7-RT-gpslate-dev0", "R7-NM-gpslate-dev0"],',
    '  ["R7-RT-gpslate-devU", "R7-NM-gpslate-devU"],',
    '  ["R7-RT-gpslate-devU-reject", "R7-GPSLATE-devU-reject"],',
    '  ["R7-KYOTO-RT", "R7-KYOTO-NM"],',
    '  ["R7-AUTHCLAR-RT", "R7-AUTHCLAR-NM"],',
    '  ["R6-RT-throw-B", "R5-BP-B"],',
    '  ["R6-RT-throw-gps-late", "R5-LOC-gps-late"],',
    '  ["R6-RT-throw-B2", "R5-BP-B2"],',
    '  ["R6-RT-throw-A", "R5-BP-A"],',
    "];",
    "const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS, ...R7_SCENARIOS];",
  ),
);
P(
  "r7-ids",
  "const R6_IDS = new Set(R6_SCENARIOS.map((s) => s.id));",
  "const R6_IDS = new Set(R6_SCENARIOS.map((s) => s.id));\nconst R7_IDS = new Set(R7_SCENARIOS.map((s) => s.id));",
);
P(
  "fmt-r7",
  '${t.viaRetry ? ` | viaRetry(${t.fallbackReason})` : ""}',
  '${t.viaRetry ? ` | viaRetry(${t.fallbackReason})` : ""}${t.sessionAuthority ? ` | auth=${t.sessionAuthority.source}:${t.sessionAuthority.lat},${t.sessionAuthority.lng},${t.sessionAuthority.displayLabel ?? "-"}` : ""}${t.deviceCalls ? ` | device=${t.deviceCalls}` : ""}${t.retryLoc ? ` | retryLoc=${JSON.stringify(t.retryLoc.location)}` : ""}',
);
P(
  "expect-r7",
  L("        if (e.areaKeep) {", "          const from = W[e.areaKeep.from];"),
  L(
    "        // ── r7 新增 expect ──",
    "        for (const spec of e.r7Loc ?? []) {",
    "          for (const ti of spec.turns) {",
    "            const w = W[ti];",
    "            if (!w) continue;",
    "            const loc = w.sessionLocation;",
    "            const au = w.sessionAuthority;",
    "            const bad = [];",
    "            if (spec.ll && (!loc || loc.lat !== spec.ll.lat || loc.lng !== spec.ll.lng)) bad.push(`location 座標=${JSON.stringify(loc)}（應 ${spec.ll.lat},${spec.ll.lng}）`);",
    "            if (spec.cityEq !== undefined && (loc?.city ?? null) !== spec.cityEq) bad.push(`location.city=${loc?.city ?? \"-\"}（應 ${spec.cityEq}）`);",
    "            if (spec.cityNot && String(loc?.city ?? \"\").includes(spec.cityNot)) bad.push(`location.city 含「${spec.cityNot}」`);",
    "            if (spec.curEq !== undefined && (w.sessionCurrentLocation ?? null) !== spec.curEq) bad.push(`currentLocation=${w.sessionCurrentLocation ?? \"-\"}（應 ${spec.curEq}）`);",
    "            if (spec.curNot && String(w.sessionCurrentLocation ?? \"\").includes(spec.curNot)) bad.push(`currentLocation 含「${spec.curNot}」`);",
    "            if (spec.authSrc !== undefined && (au?.source ?? null) !== spec.authSrc) bad.push(`authority.source=${au?.source ?? \"-\"}（應 ${spec.authSrc}）`);",
    "            if (spec.authLL && (!au || au.lat !== spec.authLL.lat || au.lng !== spec.authLL.lng)) bad.push(`authority 座標=${JSON.stringify(au)}（應 ${spec.authLL.lat},${spec.authLL.lng}）`);",
    "            if (spec.authLabelNot && String(au?.displayLabel ?? \"\").includes(spec.authLabelNot)) bad.push(`authority.displayLabel 含「${spec.authLabelNot}」`);",
    "            if (spec.authLabelEq !== undefined && (au?.displayLabel ?? null) !== spec.authLabelEq) bad.push(`authority.displayLabel=${au?.displayLabel ?? \"-\"}（應 ${spec.authLabelEq}）`);",
    "            if (bad.length) p1.push(`${tag} T${ti + 1} r7-LOC：${bad.join(\"；\")}`);",
    "          }",
    "        }",
    "        if (e.areaKeep) {",
    "          const from = W[e.areaKeep.from];",
  ),
);
P(
  "group",
  'const group = isT27 ? "T27" : R3_IDS.has(s.id) ? "R3" : R4_IDS.has(s.id) ? "R4" : R5_IDS.has(s.id) ? "R5" : R6_IDS.has(s.id) ? "R6" : "T28";',
  'const group = isT27 ? "T27" : R3_IDS.has(s.id) ? "R3" : R4_IDS.has(s.id) ? "R4" : R5_IDS.has(s.id) ? "R5" : R6_IDS.has(s.id) ? "R6" : R7_IDS.has(s.id) ? "R7" : "T28";',
);
P(
  "modeStats",
  "modeStats[m.id] ??= { T27: [0, 0], T28: [0, 0], R3: [0, 0], R4: [0, 0], R5: [0, 0], R6: [0, 0] };",
  "modeStats[m.id] ??= { T27: [0, 0], T28: [0, 0], R3: [0, 0], R4: [0, 0], R5: [0, 0], R6: [0, 0], R7: [0, 0] };",
);
P(
  "J-base",
  'if (!mockKeyOk) J.work.p1.push("子程序 Mock Key 未生效");',
  L(
    'if (!mockKeyOk) J.work.p1.push("子程序 Mock Key 未生效");',
    "// r7-Δ6：同一套 assertion 對 base（aa2db59）本身判定，用於「work 相對 aa2db59 新增 P1」",
    'const JB = judge("base");',
  ),
);
P(
  "groupOf",
  'const groupOf = (id) => (T27_IDS.has(id) ? "T27" : R3_IDS.has(id) ? "R3" : R4_IDS.has(id) ? "R4" : R5_IDS.has(id) ? "R5" : R6_IDS.has(id) ? "R6" : "T28");',
  'const groupOf = (id) => (T27_IDS.has(id) ? "T27" : R3_IDS.has(id) ? "R3" : R4_IDS.has(id) ? "R4" : R5_IDS.has(id) ? "R5" : R6_IDS.has(id) ? "R6" : R7_IDS.has(id) ? "R7" : "T28");',
);
P("isR7", "const isR6Msg = (x) => /\\[R6-/.test(x);", "const isR6Msg = (x) => /\\[R6-/.test(x);\nconst isR7Msg = (x) => /\\[R7-/.test(x);");
P(
  "out-banner",
  'const out = ["［r6］本輸出沿用 r5 標籤：凡標示「F5 後」= work（F6 後）、「F5 前」/ pre = F6 前備份；pre5 = F5 前、pre4 = F4 前（可選）"];',
  'const out = ["［r7］本輸出沿用 r5/r6 標籤：凡標示「F5 後」= work（F8 後）、「F5 前」/「F6 前」/ pre = F7 前備份（= F6）"];',
);
P(
  "out-modestats",
  "| R6 PASS=${st.R6[0]} FAIL=${st.R6[1]}`);",
  "| R6 PASS=${st.R6[0]} FAIL=${st.R6[1]} | R7 PASS=${st.R7[0]} FAIL=${st.R7[1]}`);",
);
P("out-p1count", "；R6 情境/probe=${countBy(set, isR6Msg)}）`);", "；R6 情境/probe=${countBy(set, isR6Msg)}；R7 情境=${countBy(set, isR7Msg)}）`);");
P(
  "out-r7-sections",
  "out.push(`Provider 新增（work > pre 的情境×mode）=${newProviderCalls.length}  其中 geocode=${newGeocode.length}  credits=${newCredits.length}`);",
  L(
    "out.push(`Provider 新增（work > pre 的情境×mode）=${newProviderCalls.length}  其中 geocode=${newGeocode.length}  credits=${newCredits.length}`);",
    "// r7-Δ6：work 相對 aa2db59（judge(base)）的新增 P1",
    "const p1B = new Set(uniq(JB.p1));",
    "const newVsBase = [...p1W].filter((x) => !p1B.has(x));",
    "const newVsBaseAssert = newVsBase.filter((x) => !/次數 work=\\d+ > base=\\d+/.test(x) && !/^循環 import|^chat-intent-router/.test(x));",
    "out.push(`\\n══ r7：work 相對 aa2db59 新增 P1（同一套 assertion 判 base；base P1=${p1B.size}）：全部=${newVsBase.length}，其中 Provider 次數比較類=${newVsBase.length - newVsBaseAssert.length}、其餘=${newVsBaseAssert.length} ══`, ...(newVsBaseAssert.length ? newVsBaseAssert : [\"(none)\"]));",
    "out.push(\"\\n══ r7：work 新增 P1（相對 pre＝F6）中的 R7/R6 情境 ══\", ...(newInWork.filter((x) => isR7Msg(x) || isR6Msg(x)).length ? newInWork.filter((x) => isR7Msg(x) || isR6Msg(x)) : [\"(none)\"]));",
    "// r7-Δ6：throw vs 正常路徑 Provider 配對",
    'out.push("\\n══ r7：throw（catch retry）vs 正常路徑 Provider／device 呼叫（各樹各 mode；g/w/b/p/c/dev）══");',
    "{",
    "  const tot2 = (tr, sid, mid) => {",
    "    const r = results[`${tr}|${mid}|${sid}`];",
    "    if (!r) return null;",
    "    return r.result.turns.reduce((a, t) => ({ g: a.g + t.geocodes.length, w: a.w + t.weatherCalls, b: a.b + t.builderCalls, p: a.p + t.placesRequests, c: a.c + t.creditsBegin, d: a.d + (t.deviceCalls ?? 0) }), { g: 0, w: 0, b: 0, p: 0, c: 0, d: 0 });",
    "  };",
    "  let exceed = 0;",
    "  for (const [a, b] of R7_PAIRS) {",
    "    for (const tree of TREES) {",
    "      const cells = [];",
    "      for (const m of MODES) {",
    "        const x = tot2(tree, a, m.id);",
    "        const y = tot2(tree, b, m.id);",
    "        if (!x || !y) continue;",
    "        const more = [\"g\", \"b\", \"p\", \"c\", \"d\"].filter((k) => x[k] > y[k]);",
    '        if (more.length && tree === "work") exceed += 1;',
    "        cells.push(`${m.id}=${x.g}/${x.w}/${x.b}/${x.p}/${x.c}/${x.d} vs ${y.g}/${y.w}/${y.b}/${y.p}/${y.c}/${y.d}${more.length ? `(throw 多:${more.join(\"\")})` : \"\"}`);",
    "      }",
    "      if (cells.length) out.push(`${tree.padEnd(5)} ${a} vs ${b}: ${cells.join(\" | \")}`);",
    "    }",
    "  }",
    "  out.push(`work 中 throw 路徑多於正常路徑（geocode/builder/placesReq/credits/device 任一）的配對×mode=${exceed}`);",
    "}",
    "// r7-Δ6：R7 情境逐輪 location / authority 明細（mode=ok、neterr）",
    'out.push("\\n══ r7：R7 情境逐輪 location／authority（mode ok、neterr；各樹）══");',
    "for (const s of scenarios.filter((x) => R7_IDS.has(x.id))) {",
    '  for (const mid of ["ok", "neterr"]) {',
    "    for (const tree of TREES) {",
    "      const r = results[`${tree}|${mid}|${s.id}`];",
    "      if (!r) continue;",
    "      const cells = r.result.turns.map((t) => `T${t.turnIndex + 1}:loc=${t.sessionLocation ? `${t.sessionLocation.lat},${t.sessionLocation.lng},${t.sessionLocation.city ?? \"-\"}` : \"-\"} cur=${t.sessionCurrentLocation ?? \"-\"} auth=${t.sessionAuthority ? `${t.sessionAuthority.source}:${t.sessionAuthority.displayLabel ?? \"-\"}` : \"-\"} dev=${t.deviceCalls ?? 0}${t.retryLoc ? ` retryLoc=${JSON.stringify(t.retryLoc.location)}` : \"\"} pend=${t.sessionPendingKind ?? \"-\"} credits=${t.creditsDest ?? \"-\"} search=${t.searchDest ?? \"-\"}${t.error ? ` ERR=${t.error}` : \"\"} path=${t.path}`);",
    "      out.push(`[${s.id}][${mid}] ${tree.padEnd(5)} ${cells.join(\" || \")}`);",
    "    }",
    "  }",
    "}",
  ),
);
P(
  "out-count",
  "R6=${scenarios.filter((s) => R6_IDS.has(s.id)).length}） 模式=",
  "R6=${scenarios.filter((s) => R6_IDS.has(s.id)).length} R7=${scenarios.filter((s) => R7_IDS.has(s.id)).length}） 模式=",
);
P(
  "out-final",
  "out.push(`verify-destination-authority-phase2-r6: work P1=${p1W.size} pre P1=${p1P.size} 新增P1=${newInWork.length}",
  "out.push(`verify-destination-authority-phase2-r7: work P1=${p1W.size} pre P1=${p1P.size} base P1=${p1B.size} 新增P1(vs pre)=${newInWork.length} 新增P1(vs base，非 Provider 類)=${newVsBaseAssert.length}",
);

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
