#!/usr/bin/env node
/**
 * R14 — Destination Authority 全量回歸（A2-T4，tester；使用者授權 2026-10-21）。
 *
 * 建立方式：r12／r13 保留不改。r14 在執行期讀入 r13 原文（sha 必須 = scratchpad/pre-r14-test-sha.txt 記錄的
 * 8debfb44…），套用下方 R14_PATCHES（每個 patch 的錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），
 * 再以 AsyncFunction 執行（主程序與 collect 子程序都是同一份 patched 原文）。
 * 因此 r13 的情境、Fixture、Assertion、expect、Provider／Credits 條件、P1 分類全部逐字沿用（patch 不觸及 judge 內既有判定）。
 * `--emit-diff` 會把 r13 → patched 的精準 diff 寫到 scratchpad/r14.diff（只寫 scratchpad）。
 *
 *  r14-Δ0 自身路徑 r14（子程序也跑 r14）；`await import(` 改由 r14 模組代為 import（12 處，數量檢查）。
 *  r14-Δ1 擷取：以 TypeScript AST 從各樹的 _app.chat.tsx 擷取 6 個 useCallback 本體
 *         （pushDestinationCategoryPlaceRecommendation／pushMorePlaceRecommendations／pushRecommendationRefinement／
 *          pushAlternativeDestinationPlaceRecommendation／pushDestinationPlaceRecommendation／pushNearbyPlaceRecommendation）
 *         與 send() 的 2 個區塊（alt 分支、refetch／continuation 分支），轉 JS、靜態計算自由識別字：
 *         import → 依該檔檔頭 import 載入「該樹」真實模組；元件閉包 → 只能是 R14_CLOSURE_DEPS 已審查清單；其餘 → INFRA-FAIL。
 *         執行期以 Proxy scope 再擋一次：未注入名稱一律丟 ReferenceError 並記錄（主程序判 INFRA-FAIL）。
 *  r14-Δ2 樹：work（A2 後）、pa2（--pa2：A2 前＝ctd／dpr 以 *.pre-A2 備份、cdcr＝HEAD，_app 擷取 _app.chat.pre-A2.tsx）、
 *         f10（--f10：r13 定義＋dpr／cdcr 改 A2 前；_app 擷取 A2 前備份＝post-F10 sha）、pre（r13 定義＋dpr／cdcr 改 A2 前；
 *         _app 擷取 _app.chat.pre-G2S1.tsx）、base（aa2db59；_app 擷取 git show）。樹判別新增 a2 probe。
 *  r14-Δ3 子程序注入 r14ChildHarness：真實 @/lib/credits（supabase client 以 stub 取代，RPC 逐筆記錄、不連網），
 *         Builder／Credits／可信判定 import 包記錄器（呼叫真實函式）；閉包依賴注入記錄器（setMsgs／persistSession／Credits 不是 noop）。
 *  r14-Δ4 send() 的 alt 分支與 refetch／continuation 分支改為執行擷取的正式原始碼。
 *  r14-Δ5 r13 的 pushDC 副本、recordContinuation 鏡像移除；所有呼叫點改呼叫正式 Callback；
 *         destination_places、refinement（MORE＋L10148 refinement）、applyLocalFallback（continue／destination places）改呼叫正式 Callback。
 *  r14-Δ6 anchors：A2 改寫的 2 條 work anchor（r13 INFRA-FAIL 原因）改查 A2 anchors；pa2＝A2 前備份必須含舊片段、work 不得含；
 *         F10 anchor 改對 A2 前備份檢查；F7 後變動檔白名單加入 r14 與 insufficient-credits-r2。
 *  r14-Δ7 新增 Assertion（只新增）：r14-A2（正式 Callback 執行了可信判定時：未通過 → 不得 Credits／Places／Weather／Session；
 *         通過 → Credits metadata.destination／Builder destination／trustedCenter 必須等於可信結果；每個 reserve 必須在同一次呼叫內結算一次）。
 *  r14-Δ8 輸出：擷取表、模型／正式原始碼對照、UNVERIFIED、各樹 P1／P2、work 相對 pa2 新增／既有／消除 P1、CONTRACT-CONFLICT 候選與證據、
 *         Provider 成本、Credits 結算與退還。`--out=<scratchpad 路徑>` 時完整輸出寫檔、stdout 只印 r14 摘要。
 *  Places Mock：place id 由 `mock-pid-` 改為 `ChIJmock-pid-`（正式 Builder 以 ^ChIJ 判定 hard Google place id；其餘欄位不變）。
 *
 * 安全（同 r13）：子程序 configFile:false / envDir:false、白名單 env + Mock Key、攔截 fetch / http(s) / net / tls / undici；
 * 任何外部請求計數並判 FAIL。不讀真實 Key、不寫專案檔案。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r14.mjs --brief --f10 --pa2 [--only=ID,…] [--out=<scratchpad>/x.log]
 *       node scripts/verify-destination-authority-phase2-r14.mjs --extract-report   （只做擷取與閉包依賴報告）
 *       node scripts/verify-destination-authority-phase2-r14.mjs --emit-diff        （寫 scratchpad/r14.diff）
 */
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const BASE_REF = "aa2db59";
const R13_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r13.mjs`;
const R13_SHA = "8debfb44dc1263762a4e10a3accfcc26e322d8f8"; // scratchpad/pre-r14-test-sha.txt
const sha1 = (buf) => createHash("sha1").update(buf).digest("hex");
const gitShowR14 = (rel) => execFileSync("git", ["show", `${BASE_REF}:${rel}`], { cwd: WORK_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const R14_T0 = Date.now();

// ════════════════════════ r14-Δ1 擷取（TypeScript AST）════════════════════════
const R14_CALLBACKS = [
  "pushDestinationCategoryPlaceRecommendation",
  "pushMorePlaceRecommendations",
  "pushRecommendationRefinement",
  "pushAlternativeDestinationPlaceRecommendation",
  "pushDestinationPlaceRecommendation",
  "pushNearbyPlaceRecommendation",
];
const R14_BLOCKS = ["altBranch", "refetchBranch"];
const R14_A2_CALLBACKS = R14_CALLBACKS.filter((n) => n !== "pushNearbyPlaceRecommendation");
const R14_ALLOWED_GLOBALS = new Set([
  "Object", "Array", "JSON", "Math", "Date", "Promise", "Set", "Map", "WeakMap", "WeakSet", "String", "Number", "Boolean",
  "Error", "TypeError", "RangeError", "RegExp", "Symbol", "Intl", "console", "setTimeout", "clearTimeout", "undefined", "NaN",
  "Infinity", "parseInt", "parseFloat", "isFinite", "isNaN", "encodeURIComponent", "decodeURIComponent", "structuredClone",
  "Reflect", "BigInt", "arguments",
]);
/**
 * 元件閉包依賴（已審查）。key＝名稱；value＝注入內容。擷取到不在此清單的閉包名稱 → INFRA-FAIL（不默默補 stub）。
 * 實作見 r14ChildHarness 的 R14_closure（同名 key）。
 */
const R14_CLOSURE_DEPS = {
  locale: "常數 \"zh-TW\"（r13 LOCALE）",
  hasPlusAccess: "常數 false（免費方案 → 走 Credits check／reserve／commit／rollback）",
  geocodeLocationFn: "r13 geocodeFn Mock（逐筆計數＋phase 標記；GEO_MODE ok／timeout／null／zero／neterr）",
  fetchWeather: "r13 fetchWeather Mock（逐筆計數；回 null）",
  searchNearbyPlaces: "r13 searchPlaces Mock（逐筆計數；SEARCH_MODE ok／empty；r14：id 改 ChIJ 前綴）",
  fetchPlaceDetailsForFocus: "記錄器（Places Details 計數；回 null）",
  fetchPlaceDetailsFn: "記錄器（Places Details 計數；回 { place: null, error: \"r14_mock_details\" }）",
  ensureSubscriptionHydratedForCredits: "記錄器（計數；回 true＝訂閱狀態已載入）",
  persistSession: "r13 persistSession 記錄器（persisted＝Session、messages→msgs）＋逐次記錄（Session 寫入檢查）",
  setMsgs: "記錄器（更新 Harness msgs；支援函式形式）",
  setPartial: "記錄器（計數）",
  setStreaming: "記錄器（逐次記錄 true／false）",
  setText: "記錄器（計數）",
  sessionRef: "{ current }＝r13 persisted（getter；與 r13 sessionRef.current＝persisted 相同；寫入計數）",
  uiT: "記錄器（回 `[uiT:<key>]`；計數）",
  logRtNearbyPush: "記錄器（保留最近 2000 筆）",
  logRtNoMoreReason: "記錄器（保留最近 2000 筆）",
  explicitCreateLoading: "記錄器 { begin() → finish() }（計數）",
  pauseForTripDates: "記錄器（計數；回 false）",
  persistGeneratedPlanRef: "{ current: 丟錯記錄器 }（行程生成路徑未重建；被呼叫即記錄並丟錯）",
  runDirectItineraryRef: "{ current: 丟錯記錄器 }（行程生成路徑未重建；被呼叫即記錄並丟錯）",
  scrollToPlaceCardsStart: "記錄器（UI 捲動；計數）",
  requestAnimationFrame: "記錄器（UI；計數，不執行 callback）",
};
/** send() 區塊的區域變數（由 r13 的 send() 模型在呼叫點傳入當下值）。 */
const R14_BLOCK_LOCALS = ["msgs", "trimmed", "displayMessage", "nextSession", "merged"];
const R14_PHASE = {
  pushDestinationCategoryPlaceRecommendation: "dc_validate",
  pushMorePlaceRecommendations: "more_validate",
  pushRecommendationRefinement: "refine_validate",
  pushAlternativeDestinationPlaceRecommendation: "alt_validate",
  pushDestinationPlaceRecommendation: "dp_validate",
  pushNearbyPlaceRecommendation: "nearby",
};
const R14_SHORT = {
  pushDestinationCategoryPlaceRecommendation: "dc",
  pushMorePlaceRecommendations: "more",
  pushRecommendationRefinement: "refine",
  pushAlternativeDestinationPlaceRecommendation: "alt",
  pushDestinationPlaceRecommendation: "dp",
  pushNearbyPlaceRecommendation: "nearby",
};
const R14_BUILDERS = [
  "buildDestinationCategoryRecommendations",
  "buildMoreDestinationRecommendations",
  "buildRecommendationRefinementResults",
  "buildAlternativeDestinationRecommendations",
  "buildDestinationMustVisitRecommendation",
  "buildNearbyPlaceRecommendation",
];

/** 以 TypeScript 的 JS parser 計算一段程式碼的自由識別字（未在程式碼內宣告的參照）。 */
function r14FreeIdentifiers(ts, js) {
  const sf = ts.createSourceFile("unit.js", js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const free = new Set();
  const scopes = [];
  const bindNames = (n, out = []) => {
    if (!n) return out;
    if (ts.isIdentifier(n)) out.push(n.text);
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const el of n.elements) if (!ts.isOmittedExpression(el)) bindNames(el.name, out);
    return out;
  };
  const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n);
  const varDeclsIn = (body, out) => {
    const v = (n) => {
      if (isFn(n)) return;
      if (ts.isVariableDeclarationList(n) && !(n.flags & ts.NodeFlags.Let) && !(n.flags & ts.NodeFlags.Const)) for (const d of n.declarations) bindNames(d.name, out);
      ts.forEachChild(n, v);
    };
    if (body) ts.forEachChild(body, v);
    return out;
  };
  const blockDecls = (stmts) => {
    const out = [];
    for (const st of stmts ?? []) {
      if (ts.isVariableStatement(st) && st.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) for (const d of st.declarationList.declarations) bindNames(d.name, out);
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) out.push(st.name.text);
    }
    return new Set(out);
  };
  const isRef = (id) => {
    const p = id.parent;
    if (!p) return false;
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
    if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name === id) return false;
    if (ts.isBindingElement(p) && (p.propertyName === id || p.name === id)) return false;
    if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) && p.name === id) return false;
    if ((ts.isLabeledStatement(p) || ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === id) return false;
    return true;
  };
  const walk = (n) => {
    let pushed = 0;
    if (isFn(n)) {
      const s = new Set();
      for (const prm of n.parameters ?? []) for (const x of bindNames(prm.name)) s.add(x);
      if (ts.isFunctionExpression(n) && n.name) s.add(n.name.text);
      for (const x of varDeclsIn(n.body, [])) s.add(x);
      scopes.push(s);
      pushed += 1;
    }
    if (ts.isBlock(n) || ts.isSourceFile(n)) {
      scopes.push(blockDecls(n.statements));
      pushed += 1;
    } else if (ts.isCaseBlock(n)) {
      scopes.push(blockDecls(n.clauses.flatMap((c) => [...c.statements])));
      pushed += 1;
    } else if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer && ts.isVariableDeclarationList(n.initializer)) {
      scopes.push(new Set(n.initializer.declarations.flatMap((d) => bindNames(d.name))));
      pushed += 1;
    } else if (ts.isCatchClause(n) && n.variableDeclaration) {
      scopes.push(new Set(bindNames(n.variableDeclaration.name)));
      pushed += 1;
    }
    if (ts.isIdentifier(n) && isRef(n) && !scopes.some((s) => s.has(n.text))) free.add(n.text);
    ts.forEachChild(n, walk);
    for (let i = 0; i < pushed; i += 1) scopes.pop();
  };
  walk(sf);
  return [...free].sort();
}

/** 由 _app.chat.tsx（任一版本）擷取 6 個 Callback 與 send() 的 2 個區塊，轉成 JS 並列出自由識別字。 */
async function r14ExtractChat(label, file, srcText) {
  const ts = (await import("typescript")).default;
  const sf = ts.createSourceFile(file, srcText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = {};
  let sendFn = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      if (R14_CALLBACKS.includes(name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(sf) === "useCallback") {
        if (found[name]) throw new Error(`[r14-extract] ${label} ${name} 出現兩次`);
        found[name] = { kind: "callback", node: node.initializer.arguments[0], text: node.initializer.arguments[0].getText(sf) };
      }
      if (name === "send" && node.initializer && ts.isArrowFunction(node.initializer)) sendFn = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!sendFn) throw new Error(`[r14-extract] ${label} 找不到 send()`);
  const inSend = (n) => n.getStart(sf) > sendFn.getStart(sf) && n.getEnd() < sendFn.getEnd();
  const visitSend = (node) => {
    if (ts.isIfStatement(node) && node.expression.getText(sf) === "shouldAcceptAlternativeRecommendations(msgs, trimmed)") {
      if (found.altBranch) throw new Error(`[r14-extract] ${label} altBranch 出現兩次`);
      found.altBranch = { kind: "block", node, text: node.getText(sf) };
    }
    if (ts.isBlock(node)) {
      const st = node.statements;
      for (let i = 0; i < st.length - 1; i += 1) {
        const a = st[i];
        const b = st[i + 1];
        if (
          ts.isVariableStatement(a) &&
          a.declarationList.declarations.length === 1 &&
          a.declarationList.declarations[0].name.getText(sf) === "structuredShortcutNegativeFeedback" &&
          ts.isIfStatement(b) &&
          b.expression.getText(sf).includes("shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)")
        ) {
          if (found.refetchBranch) throw new Error(`[r14-extract] ${label} refetchBranch 出現兩次`);
          found.refetchBranch = { kind: "block", node: a, endNode: b, text: `${a.getText(sf)}\n${b.getText(sf)}` };
        }
      }
    }
    ts.forEachChild(node, visitSend);
  };
  visitSend(sendFn.body);
  for (const n of [...R14_CALLBACKS, ...R14_BLOCKS]) if (!found[n]) throw new Error(`[r14-extract] ${label} 找不到 ${n}`);
  for (const n of R14_BLOCKS) if (!inSend(found[n].node)) throw new Error(`[r14-extract] ${label} ${n} 不在 send() 內`);
  const imports = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause || st.importClause.isTypeOnly) continue;
    const spec = st.moduleSpecifier.text;
    const cl = st.importClause;
    if (cl.name) imports.push([cl.name.text, spec, "default"]);
    if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) imports.push([cl.namedBindings.name.text, spec, "*"]);
    if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const el of cl.namedBindings.elements) if (!el.isTypeOnly) imports.push([el.name.text, spec, (el.propertyName ?? el.name).text]);
  }
  const importNames = new Set(imports.map((x) => x[0]));
  const toJs = (code) =>
    ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.Preserve, removeComments: true } }).outputText.trim().replace(/;$/, "");
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const units = {};
  for (const [name, f] of Object.entries(found)) {
    const js = f.kind === "callback" ? toJs(`(${f.text})`) : toJs(`(async () => {\n${f.text}\n return "__r14_branch_not_taken"; })`);
    const free = r14FreeIdentifiers(ts, js);
    units[name] = {
      kind: f.kind,
      js,
      start: lineOf(f.node.getStart(sf)),
      end: lineOf((f.endNode ?? f.node).getEnd()),
      sha: sha1(f.text),
      free,
      imports: free.filter((x) => importNames.has(x)),
      units: free.filter((x) => R14_CALLBACKS.includes(x)),
      globals: free.filter((x) => !importNames.has(x) && !R14_CALLBACKS.includes(x) && R14_ALLOWED_GLOBALS.has(x)),
      closure: free.filter((x) => !importNames.has(x) && !R14_CALLBACKS.includes(x) && !R14_ALLOWED_GLOBALS.has(x)),
    };
  }
  return { label, file, sha: sha1(srcText), imports, units };
}

// ════════════════════════ r14-Δ2 樹的檔案來源 ════════════════════════
const R14_PRE_A2 = {
  ctd: ["src/lib/ai/chat-turn-destination.ts", () => readFileSync(`${PRE_DIR}/chat-turn-destination.pre-A2.ts`, "utf8")],
  dpr: ["src/lib/ai/destination-place-recommendation.ts", () => readFileSync(`${PRE_DIR}/destination-place-recommendation.pre-A2.ts`, "utf8")],
  // A2 前的 chat-destination-category-recommendation.ts 未被 A2 之前的施工修改（pre-A2-all-sha.txt 未列）＝ HEAD 內容
  cdcr: ["src/lib/ai/chat-destination-category-recommendation.ts", () => gitShowR14("src/lib/ai/chat-destination-category-recommendation.ts")],
};
const r14PreA2Overlay = (keys) => Object.fromEntries(keys.map((k) => [R14_PRE_A2[k][0], R14_PRE_A2[k][1]()]));
const R14_APP_PRE_A2 = `${PRE_DIR}/_app.chat.pre-A2.tsx`;
let r14AppPreA2Cache = null;
const r14AppPreA2 = () => (r14AppPreA2Cache ??= readFileSync(R14_APP_PRE_A2, "utf8"));
const R14_APP_SOURCES = {
  work: () => ({ file: `${WORK_ROOT}/src/routes/_app.chat.tsx`, text: readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8") }),
  pa2: () => ({ file: R14_APP_PRE_A2, text: r14AppPreA2() }),
  f10: () => ({ file: R14_APP_PRE_A2, text: r14AppPreA2() }),
  pre: () => ({ file: `${PRE_DIR}/_app.chat.pre-G2S1.tsx`, text: readFileSync(`${PRE_DIR}/_app.chat.pre-G2S1.tsx`, "utf8") }),
  base: () => ({ file: `${BASE_REF}:src/routes/_app.chat.tsx`, text: gitShowR14("src/routes/_app.chat.tsx") }),
};
/** A2 的 _app 指紋（取代 r13 的 2 條 work anchor；pa2 必須不含）。 */
const R14_A2_WORK_ANCHORS = [
  "const requestedDestination = await resolveMorePlacesTurnDestination({\n        ctx: placeCtx,\n        session: merged.session,\n        userText,\n        locale,\n        geocodeFn: geocodeLocationFn,\n      });",
  "const trustedScope = await resolveTrustedRecommendationSearchScope({\n        label: requestedDestination,\n        ctx: placeCtx,\n        session: merged.session,",
  'if (trustedScope.status !== "trusted") {\n        if (!legacyLabel) return false;',
  "const turnSearchDestination =\n        turnDestination.destination ??\n        (await resolveTrustedContextTurnDestination({",
  "const destination = trustedScope.destination;",
  "session: stripClientSearchScope(activeSession),",
  "trustedCenter: trustedScope.center,",
  'metadata: { path: "refinement", destination: trustedScope.destination },',
  '): Promise<"applied" | "untrusted" | "empty"> => {',
  'console.warn("[CHAT_ALTERNATIVE_SAFE_STOP]", `result=${altResult}`);',
];

/**
 * 診斷用（--evidence-mock，非正式判定）：r13 的 geocode Mock 是 A1 之前的形狀（providerResult 沒有 placeId／types／countryCode），
 * 正式 geocodeTripLocationFromText 會帶出這三項（location.functions.ts L1210-1218 → tripLocationToProviderResult＋
 * providerEvidenceForGeocodeLocation），A2 的 trustedProviderEvidence 以它們為身分證據。本函式依同一個 realisticLocation 結果補上：
 * 行政區（formattedName＝city／region／district／sublocality 或 region＋district）→ 對應 geographic types；其餘（景點名）→ POI types。
 */
const R14_EVIDENCE_MOCK = process.argv.includes("--evidence-mock");
const R14_COUNTRY_CODE = { 日本: "JP", 台灣: "TW", 香港: "HK", 葡萄牙: "PT" };
function r14GeocodeEvidence(loc) {
  const name = loc?.formattedName ?? "";
  let types;
  if (loc?.sublocality && name === loc.sublocality) types = ["sublocality", "sublocality_level_1", "political"];
  else if (loc?.district && (name === loc.district || name === `${loc.region ?? ""}${loc.district}`)) types = ["administrative_area_level_2", "political"];
  else if (loc?.city && name === loc.city) types = ["locality", "political"];
  else if (loc?.region && name === loc.region) types = ["administrative_area_level_1", "political"];
  else types = ["tourist_attraction", "point_of_interest", "establishment"];
  return { placeId: loc?.placeId, types, countryCode: R14_COUNTRY_CODE[loc?.country] };
}

// ════════════════════════ r14-Δ1 主程序：擷取＋閉包依賴驗證 ════════════════════════
const R14_EXTRACT = {};
const R14_PAYLOAD = {};
async function r14PrepareExtraction(trees) {
  const need = [...new Set([...trees, "base"])];
  const fail = [];
  const shaLine = (file, rel) => readFileSync(file, "utf8").split("\n").find((l) => l.endsWith(`  ${rel}`))?.slice(0, 40);
  const wantApp = { work: shaLine(`${PRE_DIR}/post-A2-sha.txt`, "src/routes/_app.chat.tsx"), pa2: shaLine(`${PRE_DIR}/pre-A2-sha.txt`, "src/routes/_app.chat.tsx"), f10: shaLine(`${PRE_DIR}/pre-A2-sha.txt`, "src/routes/_app.chat.tsx") };
  for (const tree of need) {
    const src = R14_APP_SOURCES[tree];
    if (!src) {
      fail.push(`沒有 ${tree} 樹的 _app.chat.tsx 來源`);
      continue;
    }
    const { file, text } = src();
    let ex;
    try {
      ex = await r14ExtractChat(tree, file, text);
    } catch (e) {
      fail.push(String(e?.message ?? e));
      continue;
    }
    if (wantApp[tree] && wantApp[tree] !== ex.sha) fail.push(`${tree} 擷取來源 ${file} sha=${ex.sha} ≠ 快照 ${wantApp[tree]}`);
    for (const [name, u] of Object.entries(ex.units)) {
      const allowed = new Set([...Object.keys(R14_CLOSURE_DEPS), ...(u.kind === "block" ? R14_BLOCK_LOCALS : [])]);
      for (const c of u.closure) if (!allowed.has(c)) fail.push(`${tree} ${name} 未知閉包依賴：${c}（未審查 → FAIL）`);
      for (const n of u.imports) {
        const spec = ex.imports.find((x) => x[0] === n)[1];
        if (!spec.startsWith("@/")) fail.push(`${tree} ${name} 非 @/ import：${n} <- ${spec}（未審查 → FAIL）`);
      }
    }
    // 版本指紋（反向）：work 的 5 個 Callback 都有 A2 可信判定、alt 分支有 SAFE_STOP；A2 前的樹都沒有
    for (const n of R14_A2_CALLBACKS) {
      const has = /\bresolveTrustedRecommendationSearchScope\b/.test(ex.units[n].js);
      if (tree === "work" && !has) fail.push(`work ${n} 缺少 A2 resolveTrustedRecommendationSearchScope`);
      if (tree !== "work" && has) fail.push(`${tree} ${n} 已含 A2 resolveTrustedRecommendationSearchScope（備份錯誤？）`);
    }
    const safeStop = /CHAT_ALTERNATIVE_SAFE_STOP/.test(ex.units.altBranch.js);
    if (tree === "work" && !safeStop) fail.push("work altBranch 缺少 A2 CHAT_ALTERNATIVE_SAFE_STOP");
    if (tree !== "work" && safeStop) fail.push(`${tree} altBranch 已含 A2 CHAT_ALTERNATIVE_SAFE_STOP`);
    R14_EXTRACT[tree] = ex;
    R14_PAYLOAD[tree] = JSON.stringify({
      tree,
      evidenceMock: R14_EVIDENCE_MOCK,
      file,
      sha: ex.sha,
      imports: ex.imports,
      units: Object.fromEntries(Object.entries(ex.units).map(([n, u]) => [n, { kind: u.kind, js: u.js, closure: u.closure, imports: u.imports, start: u.start, end: u.end, sha: u.sha }])),
    });
  }
  if (fail.length) {
    console.log(["INFRA-FAIL r14 extraction", ...fail].join("\n"));
    process.exit(1);
  }
}
const r14PayloadFor = (tree) => {
  const p = R14_PAYLOAD[tree];
  if (!p) throw new Error(`[r14] ${tree} 沒有擷取 payload`);
  return p;
};

// ════════════════════════ r14-Δ3 子程序 API ════════════════════════
async function r14ReadPayload() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function r14ResolveSpec(spec) {
  if (!spec.startsWith("@/")) return null;
  const base = `${WORK_ROOT}/src/${spec.slice(2)}`;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext) && statSync(base + ext).isFile()) return base + ext;
  return null;
}
// supabase client stub：Credits RPC → globalThis.__R14_RPC（逐筆記錄、不連網）；其他 DB／auth 存取逐筆記錄並回 error（不連網）
const R14_SUPABASE_FILE = `${WORK_ROOT}/src/integrations/supabase/client.ts`;
const R14_SUPABASE_STUB = `
  const chain = (path) => new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (resolve) => { globalThis.__R14_DB?.(path); resolve({ data: null, error: { message: "[r14] mock supabase " + path } }); } : chain(path + "." + String(p))),
    apply: () => chain(path + "()"),
  });
  export const supabase = new Proxy({}, { get(_t, p) {
    if (p === "rpc") return async (name, args) => globalThis.__R14_RPC(name, args);
    if (p === "auth") return {
      getSession: async () => { globalThis.__R14_DB?.("auth.getSession"); return { data: { session: null }, error: null }; },
      getUser: async () => { globalThis.__R14_DB?.("auth.getUser"); return { data: { user: null }, error: null }; },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    };
    return chain(String(p));
  } });
  export default supabase;
`;
const r14StubPlugin = {
  name: "r14-supabase-stub",
  enforce: "pre",
  load(id) {
    return id.split("?")[0] === R14_SUPABASE_FILE ? R14_SUPABASE_STUB : null;
  },
};

/**
 * 注入 r13 collect 區塊（取代 r13 的 pushDC 副本位置）。本函式從不直接呼叫：r14 以 toString() 取出本體插入 patched r13，
 * 與 r13 child 的 M／runner／persisted／msgs／phase／geocodeFn／searchPlaces／fetchWeather／creditsBegin… 同一 lexical scope。
 */
async function r14ChildHarness() {
  // ════ r14-Δ3：正式 _app.chat.tsx Callback／send() 區塊執行環境（取代 r13 的 F10 Chat 流程副本）════
  const R14X = await __r14.readPayload();
  if (!R14X || R14X.tree !== TREE) throw new Error(`[r14] 擷取 payload 樹別不符：${R14X?.tree} ≠ ${TREE}`);
  globalThis.__R14_EVIDENCE_MOCK = R14X.evidenceMock === true; // 診斷旗標（--evidence-mock）；正式執行 = false
  const R14_rpc = [];
  const R14_db = [];
  let R14_ledgerSeq = 0;
  globalThis.__R14_DB = (path) => R14_db.push({ path, phase });
  globalThis.__R14_RPC = async (name, args) => {
    R14_rpc.push({ name, args: args ?? null, phase });
    if (name === "credits_check") return { data: { ok: true, usable_credits: 1000 }, error: null };
    if (name === "credits_reserve") return { data: { ok: true, ledger_id: `r14-ledger-${++R14_ledgerSeq}`, status: "reserved" }, error: null };
    if (name === "credits_commit") return { data: { ok: true, status: "committed" }, error: null };
    if (name === "credits_rollback") return { data: { ok: true, status: "rolled_back" }, error: null };
    return { data: null, error: { message: `[r14] 未審查的 RPC ${name}` } };
  };
  (await imp("lib/credits/feature-flag.ts")).setCreditsFeatureEnabledOverride(true);
  // import：只載入擷取碼實際引用的名稱；一律依「該樹」_app.chat.tsx 檔頭 import 對應到該樹的真實模組（overlay plugin 生效）
  const R14_env = {};
  {
    const needed = new Set(Object.values(R14X.units).flatMap((u) => u.imports));
    for (const [local, spec, imported] of R14X.imports) {
      if (!needed.has(local)) continue;
      const file = __r14.resolveSpec(spec);
      if (!file) throw new Error(`[r14] 未審查的 import：${local} <- ${spec}`);
      const mod = await runner.executeFile(file);
      if (imported !== "*" && !(imported in mod)) throw new Error(`[r14] ${TREE} ${spec} 沒有匯出 ${imported}`);
      R14_env[local] = imported === "*" ? mod : mod[imported];
    }
  }
  const R14_CUR = { obs: null, stack: [] };
  const R14_top = () => R14_CUR.stack[R14_CUR.stack.length - 1] ?? null;
  const R14_log = { setMsgs: 0, setStreaming: [], setPartial: 0, setText: 0, uiT: 0, notes: [], details: [], rAF: 0, scroll: 0, pause: 0, loadingBegin: 0, loadingDone: 0, ensureHydrated: 0, sessionRefSet: 0, persist: 0, genRefs: 0 };
  const R14_note = (k, p) => {
    R14_log.notes.push(k);
    if (R14_log.notes.length > 2000) R14_log.notes.shift();
  };
  const R14_wrap = (name, make) => {
    if (typeof R14_env[name] === "function") R14_env[name] = make(R14_env[name]);
  };
  // ── Credits（真實 @/lib/credits，RPC 經 stub 記錄）──
  R14_wrap("beginPlaceRecommendationCredits", (real) => async (opts) => {
    const f = R14_top();
    const o = R14_CUR.obs;
    const md = opts?.metadata ?? {};
    creditsBegin.push({ destination: md.destination ?? null, path: md.path ?? null, by: f?.name ?? null });
    const rpc0 = R14_rpc.length;
    const res = await real(opts);
    f?.begins.push({ path: md.path ?? null, destination: md.destination ?? null, blocked: Boolean(res?.blocked), inactive: Boolean(res?.handle?.inactive), rpc: R14_rpc.slice(rpc0).map((x) => x.name) });
    if (o) {
      o.creditsPaths.push(`${md.path ?? "-"}:${md.destination ?? "-"}`);
      if (f?.name === "pushMorePlaceRecommendations") o.moreCreditsDest = md.destination ?? null;
      else o.creditsDest = md.destination ?? null;
    }
    return res;
  });
  R14_wrap("settleCreditsOperation", (real) => async (handle, ok) => {
    if (handle && !handle.inactive) creditsSettle.push(Boolean(ok));
    R14_top()?.settles.push({ ok: Boolean(ok), active: Boolean(handle && !handle.inactive) });
    return real(handle, ok);
  });
  // ── Builder（真實函式；記錄 destination／userText／trustedCenter，phase=builder）──
  for (const b of __r14.BUILDERS) {
    R14_wrap(b, (real) => async (params) => {
      const f = R14_top();
      const o = R14_CUR.obs;
      const nearby = b === "buildNearbyPlaceRecommendation";
      const dest = nearby ? null : (params?.destination ?? params?.travelContext?.destination ?? params?.context?.destinationName ?? null);
      const p0 = placesReqs.length;
      builderCalls.push({ builder: b, by: f?.name ?? null, destination: dest, intents: params?.intents ?? null, userText: params?.userText ?? null, ctxDestination: params?.context?.destination ?? null });
      if (o && !nearby) {
        o.searchDest = dest;
        o.builderUserText = params?.userText ?? null;
        o.builderIntent = params?.intents?.[0] ?? null;
        o.builderMeal = mealOf(params?.userText);
      }
      const rec = {
        builder: b,
        destination: dest,
        trustedCenter: params?.trustedCenter ? { lat: params.trustedCenter.lat, lng: params.trustedCenter.lng } : null,
        ctxCenter: params?.context?.latitude != null ? { lat: params.context.latitude, lng: params.context.longitude } : null,
        places: 0,
      };
      const prev = phase;
      phase = nearby ? "nearby_builder" : "builder";
      try {
        return await real(params);
      } catch (e) {
        if (o) o.builderError = String(e?.message ?? e).slice(0, 160);
        throw e;
      } finally {
        phase = prev;
        rec.places = placesReqs.length - p0;
        f?.builders.push(rec);
      }
    });
  }
  // ── 可信判定／Turn Destination（真實函式；記錄結果與其 geocode）──
  R14_wrap("resolveTrustedRecommendationSearchScope", (real) => async (p) => {
    const f = R14_top();
    const o = R14_CUR.obs;
    const g0 = geocodes.length;
    const r = await real(p);
    const rec = { by: f?.name ?? null, label: p?.label ?? null, status: r?.status ?? null, reason: r?.reason ?? null, destination: r?.destination ?? null, center: r?.center ? { lat: r.center.lat, lng: r.center.lng } : null, area: r?.area ?? null, geocodes: geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`) };
    f?.trust.push(rec);
    if (o) {
      o.trust.push(rec);
      o.r14TrustGeo.push(...rec.geocodes);
    }
    return r;
  });
  R14_wrap("validateCategoryTurnDestination", (real) => async (td, opts) => {
    const r = await real(td, opts);
    const o = R14_CUR.obs;
    if (o && r) o.turnResolution = `${r.confidence}/${r.source}${r.providerValidation ? `/${r.providerValidation}` : ""}`;
    return r;
  });
  for (const n of ["resolveMorePlacesTurnDestination", "resolveTrustedContextTurnDestination"]) {
    R14_wrap(n, (real) => async (p) => {
      const f = R14_top();
      const o = R14_CUR.obs;
      const g0 = geocodes.length;
      const r = await real(p);
      const geo = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);
      f?.resolved.push({ fn: n, result: r ?? null, geocodes: geo });
      // A2 新增的 context 可信判定（resolveTrustedContextTurnDestination）只作為證據列出，不參與 r14-A2 斷言
      if (o && n === "resolveTrustedContextTurnDestination") {
        o.trust.push({ by: f?.name ?? null, label: "(context)", status: r ? "trusted" : "unavailable", reason: "trusted_context_destination", destination: r ?? null, center: null, area: null, geocodes: geo });
        o.r14TrustGeo.push(...geo);
      }
      return r;
    });
  }
  // ── 元件閉包（R14_CLOSURE_DEPS 已審查清單；逐一實作，不是 noop）──
  const R14_closure = {
    locale: LOCALE,
    hasPlusAccess: false,
    geocodeLocationFn: geocodeFn,
    fetchWeather,
    searchNearbyPlaces: searchPlaces,
    fetchPlaceDetailsForFocus: async (placeId) => {
      R14_log.details.push({ phase, placeId: String(placeId ?? "") });
      return null;
    },
    fetchPlaceDetailsFn: async (req) => {
      R14_log.details.push({ phase, placeId: String(req?.data?.placeId ?? "") });
      return { place: null, error: "r14_mock_details" };
    },
    ensureSubscriptionHydratedForCredits: () => {
      R14_log.ensureHydrated += 1;
      return true;
    },
    persistSession: (s, m) => {
      R14_log.persist += 1;
      R14_top()?.persists.push(s);
      persistSession(s, m);
    },
    setMsgs: (v) => {
      R14_log.setMsgs += 1;
      msgs = typeof v === "function" ? v(msgs) : v;
    },
    setPartial: () => {
      R14_log.setPartial += 1;
    },
    setStreaming: (v) => {
      R14_log.setStreaming.push(Boolean(v));
      if (R14_log.setStreaming.length > 2000) R14_log.setStreaming.shift();
    },
    setText: () => {
      R14_log.setText += 1;
    },
    sessionRef: {
      get current() {
        return persisted;
      },
      set current(v) {
        R14_log.sessionRefSet += 1;
        persisted = v;
      },
    },
    uiT: (key) => {
      R14_log.uiT += 1;
      return `[uiT:${key}]`;
    },
    logRtNearbyPush: (p) => R14_note("logRtNearbyPush", p),
    logRtNoMoreReason: (p) => R14_note("logRtNoMoreReason", p),
    explicitCreateLoading: {
      begin: () => {
        R14_log.loadingBegin += 1;
        return () => {
          R14_log.loadingDone += 1;
        };
      },
    },
    pauseForTripDates: () => {
      R14_log.pause += 1;
      return false;
    },
    persistGeneratedPlanRef: {
      current: async () => {
        R14_log.genRefs += 1;
        throw new Error("[r14-unverified] persistGeneratedPlanRef（行程生成）未重建");
      },
    },
    runDirectItineraryRef: {
      current: async () => {
        R14_log.genRefs += 1;
        throw new Error("[r14-unverified] runDirectItineraryRef（行程生成）未重建");
      },
    },
    scrollToPlaceCardsStart: () => {
      R14_log.scroll += 1;
    },
    requestAnimationFrame: () => {
      R14_log.rAF += 1;
      return 0;
    },
  };
  for (const k of Object.keys(__r14.CLOSURE_DEPS)) if (!Object.hasOwn(R14_closure, k)) throw new Error(`[r14] 已審查閉包 ${k} 沒有實作`);
  const R14_missing = new Set();
  const R14_scope = (locals) =>
    new Proxy(locals, {
      has: () => true,
      get(t, k) {
        if (k === Symbol.unscopables) return undefined;
        if (Object.hasOwn(t, k)) return t[k];
        if (Object.hasOwn(R14_env, k)) return R14_env[k];
        if (typeof k === "string" && __r14.ALLOWED_GLOBALS.has(k)) return globalThis[k];
        R14_missing.add(String(k));
        throw new ReferenceError(`[r14] ${String(k)} 未注入（未知依賴 → FAIL）`);
      },
      set(t, k, v) {
        t[k] = v;
        return true;
      },
    });
  const R14_compile = (js, scope) => new Function("__scope", `with (__scope) { return ${js}; }`)(scope);
  const R14_cbs = {};
  const R14_sameLL = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;
  const R14_kyotoOf = (x) =>
    x
      ? [
          ["preferredArea", x.preferredArea],
          ["tpc", x.tripPlanningContext?.destination],
          ["trip", x.tripDestination?.city],
          ["ctxCity", x.travelContext?.destinationCity],
          ["currentLocation", x.travelContext?.currentLocation],
          ["location.city", x.location?.city],
        ]
          .filter(([, v]) => String(v ?? "").includes("京都"))
          .map(([k]) => k)
      : null;
  function R14_onDone(o, name, frame, args) {
    const ret = frame.ret;
    const short = __r14.SHORT[name];
    const rs = typeof ret === "string" ? ret : ret === true ? "T" : ret === false ? "F" : String(ret);
    o.r14Calls.push(`${short}=${rs}`);
    o.path += `|real:${short}=${rs}`;
    const viol = (m) => o.r14Violations.push(`${short}：${m}`);
    if (name === "pushDestinationCategoryPlaceRecommendation") {
      const pc = frame.persists.map((s) => s?.pendingClarification).find(Boolean);
      if (pc && ret === true) {
        o.clarified = true;
        o.copyKind = pc.kind === "parent_city_scope" ? "parentScopeConfirm" : "whichRegion";
        o.clarificationLabel = pc.kind === "parent_city_scope" ? pc.confirmedParentCity : pc.rawGeographicLabel;
        o.copy = copyOf(o.copyKind, { destination: o.clarificationLabel });
        // r4／r5 review probe（不計 P1；同 r13 L1084-1112，以真實模組重算）
        if (M.ctd && F4) {
          const [activeSession, userText, , opts] = args;
          const merged0 = safe(() => M.tc.mergeTravelContext(activeSession, userText), null);
          if (merged0) {
            const clarBefore = F5 ? (opts?.turnStartSession ?? frame.persistedAtEntry) : frame.persistedAtEntry;
            const pick = (x) => (x ? { pref: x.preferredArea ?? null, tpc: x.tripPlanningContext?.destination ?? null, trip: x.tripDestination?.city ?? null } : null);
            o.altLater = pick(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged0.session, activeSession), null));
            o.mainClar = pick(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged0.session, clarBefore), null));
            o.mergedClar = pick(merged0.session);
            const ts = opts?.turnStartSession;
            o.beforeProbe = {
              midTurnPersisted: ts ? JSON.stringify({ ...frame.persistedAtEntry, pendingClarification: undefined }) !== JSON.stringify(ts) : null,
              viaRef: R14_kyotoOf(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged0.session, frame.persistedAtEntry), null)),
              viaStart: ts ? R14_kyotoOf(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged0.session, ts), null)) : null,
            };
          }
        }
      } else if (ret === false && !frame.builders.length) {
        const t = frame.trust.at(-1);
        o.path += t ? `|dc_no_search(trust=${t.status}:${t.reason ?? "-"})` : "|dc_no_search";
      }
    }
    if (name === "pushMorePlaceRecommendations") {
      const mb = frame.begins.find((b) => b.path === "more_places");
      if (mb) {
        o.continuationDest = mb.destination;
        if (!frame.builders.length) o.searchDest = mb.destination;
      } else if (ret === false) {
        const s = args[0] ?? {};
        const m0 = safe(() => M.tc.mergeTravelContext(s, args[1] ?? ""), null);
        const pctx = m0 ? safe(() => M.mvp.mergeContextForPlaceFetch(m0.context, s), {}) : {};
        const legacy = pctx?.destination?.trim() || s.tripPlanningContext?.destination?.trim() || s.tripDestination?.city?.trim();
        o.continuationBlocked = legacy || s.travelContext?.destination || null;
        o.path += legacy ? "|more_blocked_unconfirmed→noMore" : "|more_no_label";
      }
    }
    if (name === "pushNearbyPlaceRecommendation") o.nearbyCalls += 1;
    // r14-Δ7：A2 安全契約（只在本次呼叫實際執行了可信判定時檢查）
    if (frame.trust.length) {
      const trusted = frame.trust.filter((t) => t.status === "trusted");
      const places = placesReqs.length - frame.p0;
      const weather = weatherCalls.length - frame.w0;
      if (!trusted.length) {
        if (frame.begins.length) viol(`可信判定未通過（${frame.trust.map((t) => `${t.label}:${t.status}/${t.reason}`).join(",")}）仍呼叫 Credits.begin ${frame.begins.length} 次`);
        if (frame.builders.length || places) viol(`可信判定未通過仍呼叫 Places（builder=${frame.builders.length} requests=${places}）`);
        if (weather) viol(`可信判定未通過仍呼叫 Weather ${weather} 次`);
        if (frame.persists.length) viol(`可信判定未通過仍寫入 Session ${frame.persists.length} 次`);
      } else {
        const t = trusted.at(-1);
        for (const b of frame.begins) if (b.destination !== t.destination) viol(`Credits metadata.destination=${b.destination} ≠ 可信目的地 ${t.destination}`);
        for (const b of frame.builders) {
          if (b.builder === "buildNearbyPlaceRecommendation") continue;
          if (b.destination && b.destination !== t.destination) viol(`${b.builder} destination=${b.destination} ≠ 可信目的地 ${t.destination}`);
          const center = b.builder === "buildRecommendationRefinementResults" ? b.ctxCenter : b.trustedCenter;
          if (!R14_sameLL(center, t.center)) viol(`${b.builder} 搜尋中心=${JSON.stringify(center)} ≠ 可信中心 ${JSON.stringify(t.center)}`);
        }
      }
    }
    // Credits：本次呼叫內每個 reserve 恰好結算一次（commit 或 rollback）
    {
      const rpcs = R14_rpc.slice(frame.rpc0).map((x) => x.name);
      const reserves = rpcs.filter((x) => x === "credits_reserve").length;
      const settled = rpcs.filter((x) => x === "credits_commit" || x === "credits_rollback").length;
      if (reserves !== settled) viol(`Credits reserve=${reserves} 結算=${settled}（${rpcs.join(",")}）`);
    }
  }
  function R14_wrapCallback(name, real) {
    return async (...args) => {
      const o = R14_CUR.obs;
      const frame = { name, trust: [], begins: [], settles: [], builders: [], persists: [], resolved: [], p0: placesReqs.length, w0: weatherCalls.length, rpc0: R14_rpc.length, persistedAtEntry: persisted };
      R14_CUR.stack.push(frame);
      const prevPhase = phase;
      phase = __r14.PHASE[name];
      let ret;
      let err = null;
      try {
        ret = await real(...args);
      } catch (e) {
        err = e;
      } finally {
        R14_CUR.stack.pop();
        phase = prevPhase;
      }
      frame.ret = err ? `THROW:${String(err?.message ?? err).slice(0, 120)}` : ret;
      if (o) R14_onDone(o, name, frame, args);
      if (err) throw err;
      return ret;
    };
  }
  {
    const cbScope = R14_scope(R14_closure);
    for (const name of __r14.CALLBACKS) {
      const u = R14X.units[name];
      if (!u) throw new Error(`[r14] payload 缺少 ${name}`);
      for (const c of u.closure) if (!Object.hasOwn(R14_closure, c)) throw new Error(`[r14] ${name} 未知閉包依賴：${c}`);
      R14_cbs[name] = R14_wrapCallback(name, R14_compile(u.js, cbScope));
    }
    // send() 區塊與 Callback 之間的互相呼叫一律經記錄器
    for (const name of __r14.CALLBACKS) R14_closure[name] = R14_cbs[name];
  }
  async function R14_runBlock(name, locals) {
    const u = R14X.units[name];
    for (const c of u.closure) if (!Object.hasOwn(R14_closure, c) && !Object.hasOwn(locals, c)) throw new Error(`[r14] ${name} 未知依賴：${c}`);
    const v = await R14_compile(u.js, R14_scope({ ...R14_closure, ...locals }))();
    return v !== "__r14_branch_not_taken";
  }
  function R14_turnEnd(o, r0) {
    o.creditsRpc = R14_rpc.slice(r0).map((x) => x.name);
    if (R14_CUR.stack.length) o.r14Violations.push(`Callback 堆疊未清空：${R14_CUR.stack.map((f) => f.name).join(",")}`);
    R14_CUR.stack.length = 0;
    R14_CUR.obs = null;
  }
  function R14_resultInfo() {
    const rpc = {};
    for (const x of R14_rpc) rpc[x.name] = (rpc[x.name] ?? 0) + 1;
    return {
      payloadSha: R14X.sha,
      units: Object.fromEntries(Object.entries(R14X.units).map(([n, u]) => [n, u.sha])),
      envLoaded: Object.keys(R14_env).length,
      missing: [...R14_missing],
      rpc,
      db: R14_db.map((d) => d.path),
      details: R14_log.details.length,
      log: { ...R14_log, notes: R14_log.notes.length, setStreaming: R14_log.setStreaming.length, details: R14_log.details.length },
    };
  }
}
const r14Inject = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}"));
};

// ════════════════════════ r14-Δ2 主程序：樹判別（新增）════════════════════════
function r14InfraTree(k, tree, r, oc, infra) {
  const hits = oc.hits ?? [];
  const has = (f) => hits.includes(f);
  if (tree === "work" && oc.a2 !== true) infra.push(`INFRA-FAIL ${k} work 不是 A2 版（a2=${oc.a2}）`);
  if (["pa2", "f10", "pre"].includes(tree) && oc.a2 !== false) infra.push(`INFRA-FAIL ${k} ${tree} 含 A2（a2=${oc.a2}）`);
  if (tree === "pa2" && (oc.cb !== true || oc.f10 !== true || oc.r9Probes?.legitSnapCtx !== null || oc.ctdArity !== 2)) infra.push(`INFRA-FAIL ${k} pa2 不是 CC 版（cb=${oc.cb} f10=${oc.f10} legitSnapCtx=${JSON.stringify(oc.r9Probes?.legitSnapCtx)}）`);
  if (tree === "pa2" && !["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/destination-place-recommendation.ts", "src/lib/ai/chat-destination-category-recommendation.ts"].every(has)) infra.push(`INFRA-FAIL ${k} pa2 未載入 A2 前 overlay（hits=${hits.join(",")}）`);
  if ((tree === "f10" || tree === "pre") && !["src/lib/ai/destination-place-recommendation.ts", "src/lib/ai/chat-destination-category-recommendation.ts"].every(has)) infra.push(`INFRA-FAIL ${k} ${tree} 未載入 A2 前 dpr／cdcr overlay（hits=${hits.join(",")}）`);
  const x = r.result.r14;
  if (!x) infra.push(`INFRA-FAIL ${k} 子程序沒有 r14 資訊`);
  else {
    if (x.payloadSha !== R14_EXTRACT[tree]?.sha) infra.push(`INFRA-FAIL ${k} 擷取 payload sha=${x.payloadSha} ≠ ${R14_EXTRACT[tree]?.sha}`);
    if (x.missing.length) infra.push(`INFRA-FAIL ${k} 未知依賴（執行期）：${x.missing.join(",")}`);
  }
  for (const t of r.result.turns ?? []) if (/\[r14\]/.test(String(t.error ?? ""))) infra.push(`INFRA-FAIL ${k} T${t.turnIndex + 1} ${t.error}`);
}

// ════════════════════════ r14-Δ8 主程序：輸出 ════════════════════════
const R14_MODEL_TABLE = [
  ["正式原始碼", "pushDestinationCategoryPlaceRecommendation（全部呼叫點：parent scope 確認、destination_area 還原、early destination_category、refinement NEW、faithful late L10690／L10831、applyLocalFallback retry）"],
  ["正式原始碼", "pushMorePlaceRecommendations（send refetch 分支內、refinement MORE、applyLocalFallback continue）"],
  ["正式原始碼", "pushRecommendationRefinement（send refetch 分支內、refinement 區塊 L10148、applyLocalFallback continue）"],
  ["正式原始碼", "pushAlternativeDestinationPlaceRecommendation（send alt 分支內）"],
  ["正式原始碼", "pushDestinationPlaceRecommendation（send destination_places 分支、applyLocalFallback destination places）"],
  ["正式原始碼", "pushNearbyPlaceRecommendation（send alt 分支 GPS、refetch 分支 nearby continuation）"],
  ["正式原始碼", "send() alt 分支整段（if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {…}）"],
  ["正式原始碼", "send() refetch／continuation 分支整段（structuredShortcutNegativeFeedback ＋ if (shouldRefetchPlaces(…) || …) {…}）"],
  ["正式原始碼", "純函式模組（ctd／travel-context／mvp／placeIntent／chatIntent／refine／crs…）與擷取碼引用的全部 @/ import、@/lib/credits（RPC 為 Mock）"],
  ["模型（r13）", "send() 路由：noop／登入／早期 pending 消費／turnStartSession／數字選擇／refresh／place detail／sessionForTurn／structured shortcut（下游未重建）／arbitration／pending handler／merge／global candidate／planning constraint／weather prefetch"],
  ["模型（r13）", "send() destination_category 分派與 noResults 文案；refinement 路由（NEW／MORE／firstTurn noResults；faithful nearby shortcut 模型）；destination_places 分派（呼叫正式 Callback）"],
  ["模型（r13）", "send() faithful late 路徑（planning gate／intent／resolveChatLocation mock／resolveChatRoute／persist／故障注入／itinerary・advice・clarify 未重建）與 later tail"],
  ["模型（r13）", "applyLocalFallback 路由（continue／destination places 分支已改呼叫正式 Callback；trip add place、planning／offline tail 未重建）"],
  ["模型（r13）", "persistSession（persisted＝Session、messages→msgs；正式的 workspace／saveChatSession／restorePendingPlanAiOwner 未執行）、Provider Mock（geocode／Places／Weather 於 server fn 層；createUnifiedSearchPlacesFn 未執行）"],
];
const R14_UNVERIFIED = [
  "完整 send() 路由（上表「模型」各項）— UNVERIFIED，不宣稱完整 E2E PASS",
  "React State／Effect 時序（useState／useRef／useCallback 依賴、render）— UNVERIFIED",
  "Reload Persistence（真實 saveChatSession／loadChatSession／workspace upsert；Harness 以 r13 persisted JSON 重新注入）— UNVERIFIED",
  "連按（in-flight／streaming lock 只以 r13 的 ui 旗標模型；setStreaming 只記錄）— UNVERIFIED",
  "畫面呈現（ChatMessageList、卡片 render、捲動）— UNVERIFIED",
  "Credits Server 端（credits_check／reserve／commit／rollback 為 RPC Mock，不驗證 DB 扣點）— UNVERIFIED",
  "真實 Google Provider、createUnifiedSearchPlacesFn、Places Details（皆 Mock 計數）— UNVERIFIED",
  "行程生成（runDirectItineraryRef／persistGeneratedPlanRef；被呼叫即記錄並丟錯）— UNVERIFIED",
];
function r14MainReport(ctx) {
  const { out, J, JB, results, TREES, scenarios, MODES, extHits, PROV_TREES, extTotals } = ctx;
  const uniq = (a) => [...new Set(a)];
  const L = [];
  L.push("\n══════════════════════ r14 ══════════════════════");
  if (R14_EVIDENCE_MOCK) L.push("［診斷模式 --evidence-mock］geocode Mock 在 ok 回應加上 placeId／types／countryCode（A1／A2 身分證據）。本次結果只用於 CONTRACT-CONFLICT 分類，不是正式判定。");
  L.push("══ r14：Callback／區塊擷取表（TypeScript AST；各樹 _app.chat.tsx 行號、sha）══");
  for (const [tree, ex] of Object.entries(R14_EXTRACT)) {
    L.push(`${tree.padEnd(5)} ${ex.file} sha=${ex.sha}`);
    for (const [n, u] of Object.entries(ex.units)) L.push(`  ${n.padEnd(46)} L${u.start}-${u.end} sha=${u.sha.slice(0, 12)} import=${u.imports.length} 閉包=[${u.closure.join(",")}] 呼叫=[${u.units.join(",")}]`);
  }
  L.push("── 閉包依賴 → 注入內容（未列者一律 INFRA-FAIL；執行期 Proxy 未注入名稱 → ReferenceError＋INFRA-FAIL）──");
  for (const [k, v] of Object.entries(R14_CLOSURE_DEPS)) L.push(`  ${k.padEnd(38)} ${v}`);
  L.push(`  （send() 區塊區域變數，由模型傳入當下值）${R14_BLOCK_LOCALS.join("、")}`);
  L.push("── import 記錄器（包住真實函式）：beginPlaceRecommendationCredits、settleCreditsOperation、" + R14_BUILDERS.join("、") + "、resolveTrustedRecommendationSearchScope、validateCategoryTurnDestination、resolveMorePlacesTurnDestination、resolveTrustedContextTurnDestination");
  L.push("\n══ r14：模型 vs 正式原始碼 ══", ...R14_MODEL_TABLE.map(([a, b]) => `  [${a}] ${b}`));
  L.push("\n══ r14：UNVERIFIED ══", ...R14_UNVERIFIED.map((x) => `  - ${x}`));
  const JT = { ...J, base: JB };
  const P1 = Object.fromEntries(Object.entries(JT).map(([t, j]) => [t, new Set(uniq(j.p1))]));
  L.push("\n══ r14：各樹 P1／P2（P2＝UX 風險 uniq；另列 COST-NOTE／DIFF-expected）══");
  for (const t of ["work", "pa2", "f10", "pre", "base"]) {
    if (!JT[t]) continue;
    const j = JT[t];
    const r14a2 = [...P1[t]].filter((x) => / r14-A2：/.test(x)).length;
    L.push(`${t.padEnd(5)} P1=${P1[t].size}（其中 r14-A2 新增斷言=${r14a2}） P2(UX)=${uniq(j.ux).length} COST-NOTE=${uniq(j.costNotes).length} DIFF-expected=${uniq(j.diffExpected).length}`);
  }
  const turnOf = (msg) => {
    const m = String(msg).match(/^\[([^\]]+)\]\[([^\]]+)\]/);
    if (!m) return null;
    const t = String(msg).match(/ T(\d+) /);
    const r = results[`work|${m[2]}|${m[1]}`];
    const turns = r?.result?.turns ?? [];
    return { sid: m[1], mid: m[2], turn: t ? Number(t[1]) - 1 : null, turns };
  };
  const classify = (msg) => {
    const ref = turnOf(msg);
    const tg = ref ? (ref.turn != null ? ref.turns.filter((x) => x.turnIndex === ref.turn) : ref.turns) : [];
    const trustGeo = tg.flatMap((x) => x.r14TrustGeo ?? []);
    const trust = tg.flatMap((x) => (x.trust ?? []).map((y) => `${y.by?.replace(/^push|Recommendation$/g, "")}:${y.label}→${y.status}${y.reason ? `/${y.reason}` : ""}${y.geocodes.length ? `[geo:${y.geocodes.join(",")}]` : ""}`));
    let tag = "A2-REGRESSION?";
    if (/(geocode 次數 work=\d+ > base=\d+|情境總 geocode|r10-validate)/.test(msg) && trustGeo.length) tag = "CONTRACT-CONFLICT?（A2 可信判定的 Provider 驗證）";
    else if (/未確認.*進入 geocode/.test(msg) && trustGeo.some((g) => msg.includes(g.slice(g.indexOf(":") + 1)))) tag = "CONTRACT-CONFLICT?（A2 可信判定以原字串驗證）";
    return { tag, evidence: `trust=[${trust.join(" ; ")}] creditsRpc=[${tg.flatMap((x) => x.creditsRpc ?? []).join(",")}] calls=[${tg.flatMap((x) => x.r14Calls ?? []).join(",")}]` };
  };
  if (P1.pa2) {
    const newP1 = [...P1.work].filter((x) => !P1.pa2.has(x));
    const existing = [...P1.work].filter((x) => P1.pa2.has(x));
    const fixed = [...P1.pa2].filter((x) => !P1.work.has(x));
    L.push(`\n══ r14：work 相對 pa2（A2 前）新增 P1=${newP1.length} ══`);
    for (const x of newP1) {
      const c = classify(x);
      L.push(`  [${c.tag}] ${x}`, `      證據：${c.evidence}`);
    }
    if (!newP1.length) L.push("  (none)");
    L.push(`\n══ r14：既有 P1（work 與 pa2 皆有）=${existing.length} ══`, ...(existing.length ? existing.map((x) => `  ${x}`) : ["  (none)"]));
    L.push(`\n══ r14：A2 消除的 P1（pa2 有、work 無）=${fixed.length} ══`, ...(fixed.length ? fixed.map((x) => `  ${x}`) : ["  (none)"]));
  }
  if (P1.f10) {
    const nf = [...P1.work].filter((x) => !P1.f10.has(x));
    L.push(`\n══ r14：work 相對 f10 新增 P1=${nf.length}；f10 有、work 無=${[...P1.f10].filter((x) => !P1.work.has(x)).length} ══`);
  }
  L.push("\n══ r14：Provider 成本（各樹總數；geocode／weather／builder／placesReq／credits.begin＋details／RPC）══");
  for (const tree of TREES) {
    const t = PROV_TREES[tree] ?? {};
    let details = 0;
    const rpc = {};
    let db = 0;
    for (const s of scenarios) for (const m of MODES) {
      const r = results[`${tree}|${m.id}|${s.id}`]?.result;
      const x = r?.r14;
      if (!x) continue;
      // details／db 取自子程序統計（重新載入情境只含第二段）；RPC 以逐輪 creditsRpc 加總（含兩段）
      details += x.details ?? 0;
      db += x.db?.length ?? 0;
      for (const t2 of r.turns ?? []) for (const k of t2.creditsRpc ?? []) rpc[k] = (rpc[k] ?? 0) + 1;
    }
    L.push(`${tree.padEnd(5)} geocode=${t.g} weather=${t.w} builder=${t.b} placesReq=${t.p} credits.begin=${t.c} details=${details}（重新載入情境只計第二段） RPC=${JSON.stringify(rpc)} supabase 非 RPC 存取=${db}（同上）`);
  }
  L.push("\n══ r14：Credits 結算與退還（各樹；逐輪 RPC）══");
  for (const tree of TREES) {
    let reserve = 0;
    let commit = 0;
    let rollback = 0;
    let check = 0;
    let unsettledTurns = 0;
    const byPath = {};
    for (const s of scenarios) for (const m of MODES) for (const t of results[`${tree}|${m.id}|${s.id}`]?.result?.turns ?? []) {
      const r = t.creditsRpc ?? [];
      const rs = r.filter((x) => x === "credits_reserve").length;
      const st = r.filter((x) => x === "credits_commit" || x === "credits_rollback").length;
      reserve += rs;
      commit += r.filter((x) => x === "credits_commit").length;
      rollback += r.filter((x) => x === "credits_rollback").length;
      check += r.filter((x) => x === "credits_check").length;
      if (rs !== st) unsettledTurns += 1;
      for (const p of t.creditsPaths ?? []) {
        const k = p.split(":")[0];
        byPath[k] = (byPath[k] ?? 0) + 1;
      }
    }
    L.push(`${tree.padEnd(5)} check=${check} reserve=${reserve} commit=${commit} rollback(退還)=${rollback} 未結算的輪=${unsettledTurns} begin 依 path=${JSON.stringify(byPath)}`);
  }
  L.push(`\n══ r14：外部請求 ══\nfetch=${extTotals.fetch} http=${extTotals.http} https=${extTotals.https} net=${extTotals.net} tls=${extTotals.tls} undici=${extTotals.undici} EXTERNAL-REQUEST 筆數=${extHits.length}`);
  const sz = (t) => (P1[t] ? P1[t].size : "-");
  const newVsPa2 = P1.pa2 ? [...P1.work].filter((x) => !P1.pa2.has(x)).length : "-";
  const existing = P1.pa2 ? [...P1.work].filter((x) => P1.pa2.has(x)).length : "-";
  L.push(`\n情境=${scenarios.length} 模式=${MODES.length} 樹=${TREES.join("/")} 耗時=${Math.round((Date.now() - R14_T0) / 1000)}s cpus=${ctx.cpus ?? "-"}`);
  L.push(`verify-destination-authority-phase2-r14: work P1=${sz("work")} pa2 P1=${sz("pa2")} f10 P1=${sz("f10")} pre P1=${sz("pre")} base P1=${sz("base")} 新增P1(vs pa2)=${newVsPa2} 既有P1=${existing} external=${extHits.length} → ${P1.work.size ? "FAIL" : "PASS"}`);
  const outArg = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
  if (outArg) {
    if (!outArg.startsWith(`${PRE_DIR}/`)) throw new Error(`--out 只能寫 scratchpad（${PRE_DIR}）`);
    writeFileSync(outArg, `${[...out, ...L].join("\n")}\n`);
    out.length = 0;
    out.push(`（完整輸出已寫入 ${outArg}）`);
  }
  out.push(...L);
}

// ════════════════════════ r14 patch（套用到 r13 原文）════════════════════════
const L = (...lines) => lines.join("\n");
const R14_PATCHES = [];
/** exact：old 必須恰好出現一次。region：from（含）到 to（不含）各自恰好出現一次，且 from 在 to 之前。 */
const PX = (id, old, neu) => R14_PATCHES.push({ id, kind: "exact", old, neu });
const PR = (id, from, to, neu) => R14_PATCHES.push({ id, kind: "region", from, to, neu });

PX(
  "r14-Δ0 header",
  " * R13 — r12 的副本（A2 回歸，使用者授權），只調整版本識別：work 由 post-CC 改為 post-A2（A1＋A2 限定施工）。",
  L(
    " * R14 — r13 的執行期 patch 版（A2-T4，使用者授權）：改為擷取正式 _app.chat.tsx 的 Callback 執行；說明見 scripts/verify-destination-authority-phase2-r14.mjs 檔頭（r14-Δ0〜Δ8）。",
    " * 執行：node scripts/verify-destination-authority-phase2-r14.mjs --brief --f10 --pa2",
    " *",
    " * ── 以下為 r13 原始說明 ──",
    " * R13 — r12 的副本（A2 回歸，使用者授權），只調整版本識別：work 由 post-CC 改為 post-A2（A1＋A2 限定施工）。",
  ),
);
PX(
  "r14-Δ0 script",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r13.mjs`; // r13-Δ1",
  "const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r14.mjs`; // r14-Δ0（子程序同樣執行 r14＝patched r13）",
);
PX(
  "r14-Δ2 pa2 flag",
  'const WITH_F10 = process.argv.includes("--f10");',
  L('const WITH_F10 = process.argv.includes("--f10");', 'const WITH_PA2 = process.argv.includes("--pa2"); // r14-Δ2：pa2 = A2 前（_app／ctd／dpr／cdcr 以 A2 前內容）'),
);
for (const [name, rhs] of [
  ["F4", 'TREE === "work" || TREE === "pre" || TREE === "pre5" || TREE === "f9" || TREE === "f10"'],
  ["F5", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"'],
  ["F6", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"'],
  ["F8", 'TREE === "work" || TREE === "pre" || TREE === "f9" || TREE === "f10"'],
  ["F10", 'TREE === "work" || TREE === "f10"'],
  ["G2S1", 'TREE === "work" || TREE === "f9" || TREE === "f10"'],
]) {
  PX(`r14-Δ2 flag ${name}`, `  const ${name} = ${rhs};`, `  const ${name} = ${rhs} || TREE === "pa2"; // r14-Δ2`);
}
PX(
  "r14-Δ2 pre overlay",
  '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
  L(
    '    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));',
    '    for (const [rel, content] of Object.entries(__r14.preA2Overlay(["dpr", "cdcr"]))) baseContent.set(`${WORK_ROOT}/${rel}`, content); // r14-Δ2：A2 前 dpr／cdcr',
  ),
);
PX(
  "r14-Δ2 pa2 overlay",
  '  } else if (TREE === "f9") {',
  L(
    '  } else if (TREE === "pa2") {',
    "    // r14-Δ2：pa2 = 工作區 + A2 前的 chat-turn-destination.ts / destination-place-recommendation.ts / chat-destination-category-recommendation.ts",
    '    for (const [rel, content] of Object.entries(__r14.preA2Overlay(["ctd", "dpr", "cdcr"]))) baseContent.set(`${WORK_ROOT}/${rel}`, content);',
    '  } else if (TREE === "f9") {',
  ),
);
PX(
  "r14-Δ2 f10 overlay",
  "    for (const [rel, file] of Object.entries(F10_FILES)) baseContent.set(`${WORK_ROOT}/${rel}`, readFileSyncC(file, \"utf8\"));",
  L(
    "    for (const [rel, file] of Object.entries(F10_FILES)) baseContent.set(`${WORK_ROOT}/${rel}`, readFileSyncC(file, \"utf8\"));",
    '    for (const [rel, content] of Object.entries(__r14.preA2Overlay(["dpr", "cdcr"]))) baseContent.set(`${WORK_ROOT}/${rel}`, content); // r14-Δ2：A2 前 dpr／cdcr',
  ),
);
PX("r14-Δ3 stub plugin", "    plugins: [baseOverlayPlugin, tsconfigPaths()],", "    plugins: [__r14.stubPlugin, baseOverlayPlugin, tsconfigPaths()], // r14-Δ3：supabase client stub（Credits RPC 記錄）");
PX(
  "r14-Δ5 rss always",
  '    rss: FAITHFUL ? await imp("lib/ai/recommendation-search-scope.ts") : null,',
  '    rss: await imp("lib/ai/recommendation-search-scope.ts"), // r14-Δ5：applyLocalFallback 由 destination_places 分支呼叫（非 faithful 也需要）',
);
PX(
  "r14-Δ2 a2 probe",
  '  overlayCheck.cb = M.crg ? typeof M.crg.analyzeContinueRecommendationStructure === "function" : null; // r11-Δ2',
  L(
    '  overlayCheck.cb = M.crg ? typeof M.crg.analyzeContinueRecommendationStructure === "function" : null; // r11-Δ2',
    '  overlayCheck.a2 = M.ctd ? typeof M.ctd.resolveTrustedRecommendationSearchScope === "function" : null; // r14-Δ2',
  ),
);
PX(
  "r14 evidence mock (diagnostic, opt-in)",
  '    return { location, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: location.lat, longitude: location.lng, query: q } };',
  L(
    "    // r14：只有診斷旗標 --evidence-mock 時才加上 A1／A2 身分證據（placeId／types／countryCode）；正式執行與 r13 逐字相同",
    '    return { location, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: location.lat, longitude: location.lng, query: q, ...(globalThis.__R14_EVIDENCE_MOCK ? __r14.geocodeEvidence(location) : {}) } };',
  ),
);
PX(
  "r14 places mock id",
  L("    id: `mock-pid-${data.destinationName ?? \"x\"}-${data.query}-${i}`,", "    googlePlaceId: `mock-pid-${data.destinationName ?? \"x\"}-${data.query}-${i}`,"),
  L(
    "    id: `ChIJmock-pid-${data.destinationName ?? \"x\"}-${data.query}-${i}`, // r14：正式 Builder 以 ^ChIJ 判定 hard Google place id",
    "    googlePlaceId: `ChIJmock-pid-${data.destinationName ?? \"x\"}-${data.query}-${i}`,",
  ),
);
PX(
  "r14-Δ3 obs fields",
  L("      // r9-Δ2", "      moreCreditsDest: null,", "    };"),
  L("      // r9-Δ2", "      moreCreditsDest: null,", "      // r14-Δ3", "      r14Violations: [],", "      r14Calls: [],", "      trust: [],", "      r14TrustGeo: [],", "      creditsRpc: [],", "      creditsPaths: [],", "      nearbyCalls: 0,", "    };"),
);
PR(
  "r14-Δ3/Δ5 harness + pushDC",
  "  // ── pushDestinationCategoryPlaceRecommendation（work L5650-6160）──\n",
  "  async function recordContinuation(",
  L(
    r14Inject(r14ChildHarness),
    "  // ── r14-Δ5 pushDestinationCategoryPlaceRecommendation：r13 的 F10 版副本已移除，改呼叫擷取的正式原始碼（各樹自己的 _app.chat.tsx）──",
    "  async function pushDC(obs, activeSession, userText, conversation, opts) {",
    "    obs.dcCalled = true;",
    "    return R14_cbs.pushDestinationCategoryPlaceRecommendation(activeSession, userText, conversation, opts);",
    "  }",
    "",
    "",
  ),
);
PR(
  "r14-Δ5 recordContinuation removed",
  "  async function recordContinuation(",
  "  // ── r6-Δ2：applyLocalFallback（work L6529-6732）",
  L(
    "  // r14-Δ5：r13 的 recordContinuation（more_places 鏡像）已由正式 pushMorePlaceRecommendations 取代；殘留呼叫一律丟錯（不默默略過）",
    "  async function recordContinuation() {",
    '    throw new Error("[r14] recordContinuation 已移除（應呼叫正式 pushMorePlaceRecommendations）");',
    "  }",
    "",
    "",
  ),
);
PR(
  "r14-Δ5 fallback continue",
  "    // L6588-6648 continue（pushRecommendationRefinement / pushMorePlaceRecommendations 未重建）\n",
  "    // L6650-6668 trip add place",
  L(
    "    // L6735-6795 continue → r14-Δ5：正式 pushRecommendationRefinement／pushMorePlaceRecommendations（r13 未重建）",
    "    if (",
    "      (scopedSession.activeRecommendationContext || scopedSession.recommendationSession || M.crs.resolveActiveCategoryIntent(scopedSession)) &&",
    "      (M.crg.matchesContinueRecommendationGrammar(activeUserText) || M.refresh.isMorePlaceRecommendationsIntent(activeUserText) || M.refresh.isRefreshRecommendationsRequest(activeUserText)) &&",
    "      !M.rss.isExplicitDeviceNearbyRequest(activeUserText)",
    "    ) {",
    "      const dest =",
    "        scopedSession.activeRecommendationContext?.destinationName ||",
    "        scopedSession.recommendationSession?.destination ||",
    "        scopedSession.travelContext?.destination ||",
    "        scopedSession.tripPlanningContext?.destination;",
    '      if (dest?.trim() && (!explicitScope || !M.fbScope.shouldBlockCrossScopeRecommendationFallback({ explicit: explicitScope, sourcePath: "recommendation-refinement-fallback", fallbackDestination: dest }))) {',
    '        obs.path += "|fb_continue(real)";',
    "        const arbitration = M.refine.resolveChatIntentArbitration(activeUserText, scopedSession);",
    '        if (arbitration.route === "MORE_RECOMMENDATIONS" || arbitration.route === "RECOMMENDATION_REFINEMENT") {',
    "          if (await R14_cbs.pushRecommendationRefinement(scopedSession, activeUserText, conversation)) return true;",
    "        }",
    "        const more = await R14_cbs.pushMorePlaceRecommendations(",
    '          { ...scopedSession, travelContext: { ...(scopedSession.travelContext ?? { interests: [] }), destination: dest, tripPurpose: "more_place_recommendations" } },',
    "          activeUserText,",
    "          conversation,",
    "        );",
    "        return Boolean(more);",
    "      }",
    "    }",
    "",
  ),
);
PR(
  "r14-Δ5 fallback destination places",
  "    // L6672-6698 pushDestinationPlaceRecommendation（未重建，停止）\n",
  "    // L6700-6732 destination-category-retry\n",
  L(
    "    // L6819-6845 → r14-Δ5：正式 pushDestinationPlaceRecommendation（r13 未重建）",
    "    if (M.mvp.shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {",
    "      const destForPlaces = mergedForAdvice.context.destination || scopedSession.travelContext?.destination;",
    '      if (explicitScope && M.fbScope.shouldBlockCrossScopeRecommendationFallback({ explicit: explicitScope, sourcePath: "generic-chat-fallback", fallbackDestination: destForPlaces })) {',
    '        obs.path += "|fb_destination_places_blocked(cross_scope)";',
    "      } else {",
    '        obs.path += "|fb_destination_places(real)";',
    "        if (await R14_cbs.pushDestinationPlaceRecommendation(scopedSession, activeUserText, conversation)) return true;",
    "      }",
    "    }",
    "",
  ),
);
PX(
  "r14-Δ3 send obs",
  L("  async function send(obs, text, t = {}) {", "    const trimmed = text.trim();"),
  L("  async function send(obs, text, t = {}) {", "    R14_CUR.obs = obs; // r14-Δ3：正式 Callback 的記錄器寫入本輪 obs", "    const trimmed = text.trim();"),
);
PR(
  "r14-Δ4 alt branch",
  "    if (M.refresh.shouldAcceptAlternativeRecommendations(msgs, trimmed)) {\n",
  "    if (M.refresh.shouldRefetchPlaces(",
  L(
    "    // r14-Δ4：send() alt 分支 → 執行擷取的正式原始碼（if (shouldAcceptAlternativeRecommendations(msgs, trimmed)) {…} 整段），",
    "    //         分支內呼叫正式 pushAlternativeDestinationPlaceRecommendation／pushNearbyPlaceRecommendation（皆經記錄器）。",
    '    if (await R14_runBlock("altBranch", { msgs, trimmed, displayMessage: trimmed, nextSession, merged })) {',
    '      obs.path += "alternative_recommendations(real)";',
    "      return;",
    "    }",
    "",
  ),
);
PR(
  "r14-Δ4 refetch branch",
  "    if (M.refresh.shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)) {\n",
  "    const placeFetchContext = M.mvp.mergeContextForPlaceFetch(merged.context, nextSession);\n",
  L(
    "    // r14-Δ4：send() refetch／continuation 分支 → 執行擷取的正式原始碼（structuredShortcutNegativeFeedback ＋ if (shouldRefetchPlaces(…) || …) {…} 整段），",
    "    //         分支內呼叫正式 pushRecommendationRefinement／pushMorePlaceRecommendations／pushNearbyPlaceRecommendation（皆經記錄器）。",
    "    {",
    "      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);",
    '      if (await R14_runBlock("refetchBranch", { msgs, trimmed, displayMessage: trimmed, nextSession, merged })) {',
    "        obs.path += `continuation:${arbitration.route}(real)`;",
    "        return;",
    "      }",
    "    }",
    "",
  ),
);
PR(
  "r14-Δ5 destination places",
  "    if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {\n",
  "    const earlyCategoryPlaceQuery = ",
  L(
    "    // r14-Δ5：destination_places（L9896-9915）→ 正式 pushDestinationPlaceRecommendation；失敗 → applyLocalFallback（r13 模型，內部分支呼叫正式 Callback）",
    "    if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {",
    '      obs.path += "destination_places(real)";',
    '      const next = [...msgs, { role: "user", content: trimmed }];',
    "      const applied = await R14_cbs.pushDestinationPlaceRecommendation({ ...nextSession, travelContext: refreshedPlaceCtx }, trimmed, next);",
    "      if (applied) return;",
    '      await applyLocalFallback(obs, nextSession, trimmed, next, "destination_places_failed", turnStartSession);',
    "      return;",
    "    }",
    "",
  ),
);
PR(
  "r14-Δ5 refinement more",
  '      if (arbitration.route === "MORE_RECOMMENDATIONS") {\n',
  "      const firstTurn =\n",
  L(
    '      if (arbitration.route === "MORE_RECOMMENDATIONS") {',
    "        const destForMore =",
    "          nextSession.activeRecommendationContext?.destinationName ||",
    "          nextSession.recommendationSession?.destination ||",
    "          nextSession.travelContext?.destination ||",
    "          nextSession.tripPlanningContext?.destination ||",
    "          nextSession.tripDestination?.city;",
    "        // r14-Δ5：L10125-10146 正式 pushMorePlaceRecommendations（取代 r13 recordContinuation 鏡像）",
    "        if (destForMore?.trim()) {",
    "          const appliedMore = await R14_cbs.pushMorePlaceRecommendations(",
    '            { ...nextSession, travelContext: { ...refreshedPlaceCtx, destination: destForMore, tripPurpose: "more_place_recommendations" } },',
    "            trimmed,",
    "            next,",
    "          );",
    "          if (appliedMore) return;",
    "        }",
    "      }",
    "      // r14-Δ5：L10148 正式 pushRecommendationRefinement（r13 未重建）",
    "      if (await R14_cbs.pushRecommendationRefinement(nextSession, trimmed, next)) return;",
    "",
  ),
);
PX("r14-Δ3 turn rpc start", "      const d0 = r7DeviceCalls; // r7-Δ6\n", "      const d0 = r7DeviceCalls; // r7-Δ6\n      const r14r0 = R14_rpc.length; // r14-Δ3\n");
PX("r14-Δ3 turn end", "      obs.deviceCalls = r7DeviceCalls - d0;\n", "      obs.deviceCalls = r7DeviceCalls - d0;\n      R14_turnEnd(obs, r14r0); // r14-Δ3\n");
PX("r14-Δ3 result info", "  overlayCheck.hits = [...overlayHits].sort();\n", "  result.r14 = R14_resultInfo(); // r14-Δ3\n  overlayCheck.hits = [...overlayHits].sort();\n");
// ── main ──
PX(
  "r14-Δ6 allow insufficient-r2",
  'f === "scripts/verify-continuation-boundary-cct2.mjs" || f === "scripts/verify-r12-vs-r11-output-compare.mjs") CB_ALLOWED.add(f);',
  'f === "scripts/verify-continuation-boundary-cct2.mjs" || f === "scripts/verify-r12-vs-r11-output-compare.mjs" || f === "scripts/verify-itinerary-insufficient-credits-r2.mjs") CB_ALLOWED.add(f); // r14-Δ6：+insufficient-credits-r2',
);
PX(
  "r14-Δ6 allow r14",
  "!/^scripts\\/verify-destination-authority-phase2-(r[789]|r1[0-3])/.test(f)) unexpected.push(f); // r13-Δ1",
  "!/^scripts\\/verify-destination-authority-phase2-(r[789]|r1[0-4])/.test(f)) unexpected.push(f); // r14-Δ6：r1[0-4]",
);
PX("r14-Δ6 SRC pa2", "const SRC = {\n", "const SRC = {\n  pa2: __r14.appPreA2(), // r14-Δ6：A2 前備份（_app.chat.pre-A2.tsx）\n");
PX(
  "r14-Δ6 F10 anchor vs pre-A2",
  '    if (!appNow.includes(a)) G2S1_ANCHOR_FAIL.push(`work _app 缺少 F10 anchor：${a.split("\\n")[0]}`);',
  L(
    "    // r14-Δ6：F10 anchor 改對 A2 前備份（_app.chat.pre-A2.tsx＝post-F10 sha）檢查；work（A2 後）不得再含",
    '    if (!__r14.appPreA2().includes(a)) G2S1_ANCHOR_FAIL.push(`F10 版（A2 前備份）_app 缺少 F10 anchor：${a.split("\\n")[0]}`);',
    '    if (appNow.includes(a)) G2S1_ANCHOR_FAIL.push(`work _app 仍含 A2 前 more_places anchor：${a.split("\\n")[0]}`);',
  ),
);
PX(
  "r14-Δ6 A2 anchors",
  "ANCHORS.work = [...ANCHORS.work.filter((a) => !F10_REPLACED.includes(a)), ...F10_WORK_ANCHORS];\n",
  L(
    "ANCHORS.work = [...ANCHORS.work.filter((a) => !F10_REPLACED.includes(a)), ...F10_WORK_ANCHORS];",
    "// r14-Δ6：A2 改寫的 2 條 work anchor（r13 INFRA-FAIL 原因）。pa2（A2 前備份）沿用 r13 的 work anchors（反向：必須含舊片段）；",
    "//         work 改查 A2 anchors，且不得再含舊片段；A2 前備份不得含 A2 片段。",
    "ANCHORS.pa2 = [...ANCHORS.work];",
    "{",
    '  const A2_REPLACED = ["const destination = turnDestination.destination;", F10_WORK_ANCHORS[0]];',
    "  ANCHORS.work = [...ANCHORS.work.filter((a) => !A2_REPLACED.includes(a)), ...__r14.A2_WORK_ANCHORS];",
    '  for (const a of A2_REPLACED) if (SRC.work.includes(a)) G2S1_ANCHOR_FAIL.push(`work _app 仍含 A2 前片段：${a.split("\\n")[0]}`);',
    '  for (const a of __r14.A2_WORK_ANCHORS) if (SRC.pa2.includes(a)) G2S1_ANCHOR_FAIL.push(`A2 前備份 _app 已含 A2 片段：${a.split("\\n")[0]}`);',
    "}",
    "",
  ),
);
PX(
  "r14-Δ6 anchor loop pa2",
  'for (const tree of ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) {\n  const src = SRC[tree];',
  'for (const tree of ["work", "pa2", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) { // r14-Δ6：+pa2\n  const src = SRC[tree];',
);
PX(
  "r14-Δ2 TREES",
  '...(WITH_F10 ? ["f10"] : [])]; // r11-Δ1 // r10-Δ1',
  '...(WITH_F10 ? ["f10"] : []), ...(WITH_PA2 ? ["pa2"] : [])]; // r14-Δ2 // r11-Δ1 // r10-Δ1',
);
PX("r14 conc", "const CONC = 8;\n", 'const CONC = Number(process.argv.find((a) => a.startsWith("--conc="))?.slice("--conc=".length) ?? 8); // r14：預設同 r13＝8\n');
PX("r14-Δ1 extraction", "const jobs = [];\n", "await __r14.prepareExtraction(TREES); // r14-Δ1：各樹 _app.chat.tsx 擷取＋閉包依賴驗證（未知依賴 → INFRA-FAIL）\nconst jobs = [];\n");
PX(
  "r14-Δ1 child stdin",
  L('    let out = "";', '    let err = "";', '    child.stdout.on("data", (d) => (out += d));'),
  L('    child.stdin.on("error", () => {});', "    child.stdin.end(__r14.payloadFor(tree)); // r14-Δ1：擷取 payload 經 stdin 傳給子程序", '    let out = "";', '    let err = "";', '    child.stdout.on("data", (d) => (out += d));'),
);
PX(
  "r14-Δ2 overlayHitsAll",
  "const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set(), f9: new Set(), f10: new Set() };",
  "const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set(), f9: new Set(), f10: new Set(), pa2: new Set() }; // r14-Δ2",
);
PX(
  "r14-Δ2 infra",
  '  if (tree === "f10" && !["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/continue-recommendation-intent.ts"].every(',
  L("  __r14.infraTree(k, tree, r, oc, infra); // r14-Δ2／Δ1：a2 probe、pa2 overlay、擷取 payload sha、執行期未知依賴", '  if (tree === "f10" && !["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/continue-recommendation-intent.ts"].every('),
);
PX(
  "r14-Δ8 rows pa2/f10",
  '        if (WT === "work") rows.push(`    pre:  ${fmt(P[i])}`);\n',
  L(
    '        if (WT === "work") rows.push(`    pre:  ${fmt(P[i])}`);',
    '        if (WT === "work") for (const xt of ["pa2", "f10"]) if (results[`${xt}|${m.id}|${s.id}`]) rows.push(`    ${xt}:  ${fmt(align(results[`${xt}|${m.id}|${s.id}`].result.turns)[i])}`); // r14-Δ8：逐輪對照加列 pa2／f10',
    "",
  ),
);
PX(
  "r14-Δ7 judge",
  "        // r5 review probe（不計 P1）：pushDC 前本輪已 persist 的路徑（before 污染）實際發生\n",
  L(
    "        // r14-Δ7：A2 安全契約／Credits 結算（正式 Callback 內逐次檢查；見 r14ChildHarness R14_onDone）— 只新增，不取代既有判定",
    "        for (const v of w.r14Violations ?? []) p1.push(`${tag} T${i + 1} r14-A2：${v}`);",
    "        // r5 review probe（不計 P1）：pushDC 前本輪已 persist 的路徑（before 污染）實際發生",
    "",
  ),
);
PX(
  "r14-Δ8 J",
  'const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE5 ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}) };',
  'const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE5 ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}), ...(WITH_F10 ? { f10: judge("f10") } : {}), ...(WITH_PA2 ? { pa2: judge("pa2") } : {}) }; // r14-Δ8：+f10／pa2（同一套 judge）',
);
PX("r14-Δ8 extHits pa2", "  if (J.pre5) J.pre5.p1.push(h);\n}", "  if (J.pre5) J.pre5.p1.push(h);\n  if (J.pa2) J.pa2.p1.push(h); // r14-Δ8\n}");
PX("r14-Δ8 JF10", 'const JF10 = WITH_F10 ? judge("f10") : null; // r11-Δ5', "const JF10 = WITH_F10 ? J.f10 : null; // r14-Δ8：與 J.f10 同一份判定");
PX("r14-Δ8 label", "out.push(`\\nverify-destination-authority-phase2-r13: work P1=", "out.push(`\\nverify-destination-authority-phase2-r13(r14 沿用): work P1=");
PX(
  "r14-Δ8 report",
  "await new Promise((resolve) => process.stdout.write(`${out.join(\"\\n\")}\\n`, resolve));\nprocess.exit(p1W.size ? 1 : 0);",
  L(
    '__r14.mainReport({ out, J, JB, results, TREES, scenarios, MODES, extHits, PROV_TREES, extTotals, cpus: (await __r14.imp("node:os")).cpus().length }); // r14-Δ8',
    "await new Promise((resolve) => process.stdout.write(`${out.join(\"\\n\")}\\n`, resolve));",
    "process.exit(p1W.size ? 1 : 0);",
  ),
);

function r14ApplyPatches(src) {
  let text = src;
  const log = [];
  const count = (hay, needle) => {
    let n = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n += 1;
    return n;
  };
  const shebang = text.match(/^#!.*\n/);
  if (!shebang) throw new Error("r13 缺少 shebang");
  text = text.slice(shebang[0].length);
  const importCount = count(text, "await import(");
  if (importCount !== 12) throw new Error(`r13 的 await import( 數量=${importCount}（預期 12）`);
  text = text.split("await import(").join("await __r14.imp(");
  log.push("r14-Δ0 await import( → await __r14.imp(（12 處）");
  for (const p of R14_PATCHES) {
    if (p.kind === "exact") {
      const n = count(text, p.old);
      if (n !== 1) throw new Error(`patch ${p.id}：錨點出現 ${n} 次（必須 1 次）`);
      text = text.replace(p.old, () => p.neu);
    } else {
      const nf = count(text, p.from);
      const nt = count(text, p.to);
      if (nf !== 1 || nt !== 1) throw new Error(`patch ${p.id}：from 出現 ${nf} 次、to 出現 ${nt} 次（必須各 1 次）`);
      const a = text.indexOf(p.from);
      const b = text.indexOf(p.to);
      if (!(a < b)) throw new Error(`patch ${p.id}：from 不在 to 之前`);
      text = text.slice(0, a) + p.neu + text.slice(b);
    }
    log.push(p.id);
  }
  return { text: `${shebang[0]}${text}`, body: text, log };
}

// ════════════════════════ 執行 ════════════════════════
if (process.argv.includes("--extract-report")) {
  const all = {};
  for (const [tree, get] of Object.entries(R14_APP_SOURCES)) {
    const { file, text } = get();
    all[tree] = await r14ExtractChat(tree, file, text);
  }
  for (const [tree, ex] of Object.entries(all)) {
    console.log(`\n══ ${tree}  ${ex.file}  sha=${ex.sha} ══`);
    for (const [name, u] of Object.entries(ex.units)) {
      console.log(`  ${name.padEnd(46)} L${u.start}-${u.end} js=${u.js.length}B imports=${u.imports.length} units=[${u.units.join(",")}] globals=[${u.globals.join(",")}]`);
      console.log(`      closure=[${u.closure.join(",")}]${u.closure.filter((c) => !Object.hasOwn(R14_CLOSURE_DEPS, c) && !R14_BLOCK_LOCALS.includes(c)).map((c) => ` 未審查:${c}`).join("")}`);
      if (process.argv.includes("--verbose") && tree === "work") console.log(`      imports=[${u.imports.map((n) => `${n}<-${ex.imports.find((x) => x[0] === n)[1]}`).join(", ")}]`);
    }
  }
  process.exit(0);
}
const r13Text = readFileSync(R13_FILE, "utf8");
if (sha1(r13Text) !== R13_SHA) {
  console.log(`INFRA-FAIL r13 sha=${sha1(r13Text)} ≠ ${R13_SHA}（r13 被修改？r14 不執行）`);
  process.exit(1);
}
let r14Patched;
try {
  r14Patched = r14ApplyPatches(r13Text);
} catch (e) {
  console.log(`INFRA-FAIL r14 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (process.argv.includes("--emit-diff")) {
  const tmp = `${PRE_DIR}/r14.patched-r13.mjs`;
  writeFileSync(tmp, r14Patched.text);
  let diff = "";
  try {
    diff = execFileSync("diff", ["-u", "--label", "scripts/verify-destination-authority-phase2-r13.mjs", "--label", "r14（r13＋R14_PATCHES，執行期內容）", R13_FILE, tmp], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    diff = String(e.stdout ?? "");
  }
  writeFileSync(`${PRE_DIR}/r14.diff`, `# r14 patches applied (${r14Patched.log.length}):\n${r14Patched.log.map((x) => `#   ${x}`).join("\n")}\n${diff}`);
  console.log(`wrote ${PRE_DIR}/r14.diff (${diff.split("\n").length} lines); patched text ${tmp}`);
  process.exit(0);
}
const __r14 = {
  imp: (s) => import(s),
  readPayload: r14ReadPayload,
  resolveSpec: r14ResolveSpec,
  stubPlugin: r14StubPlugin,
  preA2Overlay: r14PreA2Overlay,
  appPreA2: r14AppPreA2,
  A2_WORK_ANCHORS: R14_A2_WORK_ANCHORS,
  CALLBACKS: R14_CALLBACKS,
  BUILDERS: R14_BUILDERS,
  PHASE: R14_PHASE,
  SHORT: R14_SHORT,
  ALLOWED_GLOBALS: R14_ALLOWED_GLOBALS,
  CLOSURE_DEPS: R14_CLOSURE_DEPS,
  prepareExtraction: r14PrepareExtraction,
  payloadFor: r14PayloadFor,
  infraTree: r14InfraTree,
  mainReport: r14MainReport,
  geocodeEvidence: r14GeocodeEvidence,
};
const AsyncFunction = (async () => {}).constructor;
await new AsyncFunction("__r14", `"use strict";\n${r14Patched.body}`)(__r14);
