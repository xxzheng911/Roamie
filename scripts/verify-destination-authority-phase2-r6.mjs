#!/usr/bin/env node
/**
 * R4 — Phase 2 Recovery 第一組限定安全修正 F6 獨立驗收（第 3 輪＝最後一輪）。
 * 由 scripts/verify-destination-authority-phase2-r6-build.mjs 以 r5（保留不改）逐字複製並套用 exact-once patch 產生，最小調整（r6-Δ）：
 *
 *  r6-Δ1 樹：work（F6 後）、pre（F6 前：chat-turn-destination.ts 以 scratchpad 的 chat-turn-destination.pre-F6.ts overlay；
 *         harness inline 邏輯走 F4+F5 分支、不走 F6 分支）、base（aa2db59）、pre5（可選 --pre5；F5 前＝r5 的 pre）、
 *         pre4（可選 --pre4；F4 前）。F6 前 sha 快照改為 pre-F6-sha.txt。
 *  r6-Δ2 F6 鏡像（只在 work）：applyLocalFallback（L6529-6732）destination-category-retry 分支以 { turnStartSession } 呼叫 pushDC；
 *         pre / pre5 / pre4 該呼叫不帶 opts（澄清 before = sessionRef.current）。applyLocalFallback 以真實模組重建 gating
 *         （place detail、explicit scope、continue、destination places、category retry；trip add place / planning tail 未重建）。
 *         故障注入（只在 R6 情境）：throwAfterPersist＝L10471 persist 後拋例外 → L10883-10901 catch → applyLocalFallback(session, …,
 *         "state_machine_error", turnStartSession)；streamTimeout＝L10877 streamChat AbortError → applyLocalFallback(nextSession, …, "ai_timeout", …)。
 *         withoutUnconfirmedSessionDestinations 一律呼叫真實模組（work=F6 版、pre=F6 前備份 overlay）。
 *  r6-Δ4 anchors：work = r5 work anchors + F6 anchors，"{ turnStartSession }," 次數 2→3（F6 新增 L6728 retry）；
 *         pre（F6 前備份）沿用 r5 work anchors 與 r5 次數（2）；pre5 沿用 r5 pre anchors；另列 applyLocalFallback / streamChat 呼叫點。
 *  r6-Δ5 真實模組 probe：A/B/C GPS 判定（計入各樹 P1，[R6-PROBE]），以及 L12224 / L8533 未傳 turnStartSession 的論證 probe。
 *  r6-Δ6 R6 情境（retry 澄清、GPS-late 拒絕）、expect viaRetry（不計 P1，只回報是否到達）／kyotoFree，與各樹 Provider 總數。
 *  r5 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）；只調整 infra 樹判別（tree→版本）與輸出標籤。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r6.mjs --brief [--pre4] [--pre5] [--only=ID,…]
 *
 * ── 以下為 r5 原始說明 ──
 * R3 — Phase 2 Recovery 第一組限定安全修正 F5 獨立驗收（第 2 輪）。
 * 以 scripts/verify-destination-authority-phase2-r4.mjs（保留不改）為底本複製，最小調整（r5-Δ）：
 *
 *  r5-Δ1 樹：work（F5 後）、pre（F5 前：chat-turn-destination.ts 以 scratchpad 的 chat-turn-destination.pre-F5.ts overlay；
 *         harness inline 邏輯走 F4 分支、不走 F5 分支）、base（aa2db59）、pre4（可選 --pre4；F4 前，等同 r4 的 pre）。
 *         另以 F5 開始前的 sha 快照（post-R2-sha.txt）確認 F5 只改了 2 檔（pre overlay 成立的前提）。
 *  r5-Δ2 F5 鏡像（只在 work）：
 *         a) send() 早期消費後擷取 turnStartSession = { ...sessionRef.current, pendingClarification: undefined }（L7719-7722），
 *            經 opts 傳入 pushDC 的 4 個呼叫點（early destination_category / refinement NEW_RECOMMENDATION / late L10690 / L10831）。
 *         b) 澄清輪 withoutUnconfirmedSessionDestinations(merged.session, opts?.turnStartSession ?? sessionRef.current)（L5743-5746）。
 *         c) 澄清輪 persist 的 travelContext 以 sessionWithoutUnconfirmed.travelContext 為底（L5750-5755）。
 *         d) nearbyShortcutTurn && turnPendingGeographic 時移除 nextSession.pendingClarification（L8697-8701）。
 *         withoutUnconfirmedSessionDestinations 一律直接呼叫真實模組（work=F5 版、pre=F5 前備份 overlay），不在 harness 重寫。
 *  r5-Δ3 faithful 模式（只對 scenario.faithful=true 的 R5 情境生效；r4 情境的流程完全不變）：
 *         early route 的 structuredShortcut = nearbyShortcutTurn（L9733-9735）；L8925-8930 rtStructuredNearby → resolveChatLocation（mock）；
 *         refinement NEW_RECOMMENDATION + structured nearby shortcut → persistSession(nextSession)（L9813-9920，pushNearby 未重建）；
 *         late 路徑：intent / late route authority（L10314-10381）、resolveChatLocation（L10402-10415，mock）、resolveChatRoute、
 *         L10463 persistSession(nextSession)、itinerary/advice/clarify gate、L10688 categoryPlaceQuery → pushDC、L10825 → pushDC。
 *         mock resolveChatLocation：session.location 有效座標 → 不變；否則 scenario.gps → 設 location（effective-location 路徑）；否則不變。
 *  r5-Δ4 anchors：work 移除 F5 改了文字的 2 條（"{ turnDestination }," 與 F4 的 sessionRef.current 版），新增 F5 / faithful anchors 與次數、順序檢查；
 *         pre 用 r4 的 work anchors（+faithful）對 pre-F5 備份；pre4 用 r4 的 pre anchors 對 pre-F4 備份；base 同 r4。
 *  r5-Δ5 新增 obs（travelContext.destinationCity/Region/Country/currentLocation、location）、R5 情境與 expect
 *         （notDerived / locKeep / gpsKept / areaKeep / searchPrefix），以及真實模組的直接 probe（overlayCheck.f5Probe / modProbes）。
 *  r4 全部 assertion 原樣保留（未放寬、未刪除、未改 expect；R4-P5-A keepSessionDest 的前提檢查沿用 r4 前任的修正）。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r5.mjs --brief [--pre4]
 *
 * ── 以下為 r4 原始說明 ──
 * R2 — Phase 2 Recovery 第一組限定安全修正 F4 獨立驗收（第 1 輪）。
 * 以 scripts/verify-destination-authority-phase2-r3.mjs（保留不改）為底本複製，最小調整（r4-Δ）：
 *
 *  r4-Δ1 三棵樹：work（F4 後，現行工作區）、pre（F4 前：chat-turn-destination.ts 以 scratchpad 的
 *         chat-turn-destination.pre-F4.ts 內容 overlay；harness inline 邏輯走 pre-F4 分支）、base（aa2db59，同 r3）。
 *         P1 判定以同一套 assertion 分別對 work 與 pre 執行（皆與 base 對照），再比較 work vs pre 的 P1 集合
 *         與 Provider 呼叫數。
 *  r4-Δ2 F4 鏡像（只在 work 樹）：
 *         a) 澄清輪 persist：withoutUnconfirmedSessionDestinations(merged.session, sessionRef.current)
 *            （_app.chat.tsx L5741-5744；harness 的 sessionRef.current = persisted）。
 *         b) 成功分支 fromClarification 時 preferredArea =
 *            confirmedDestinationLabelOrUndefined(merged.session.preferredArea, merged.session) ?? destination（L6030-6038）。
 *         c) send() 開頭早期 pending 消費（L7699-7714）與 sessionForTurn 接回（L8531-8542）。
 *         以上兩個 ctd 函式直接呼叫真實模組，不在 harness 重寫。
 *  r4-Δ3 send() 前段 early return 重建（三棵樹皆有，文字以 anchors 綁定）：
 *         空字串／in-flight（L7624）、要求登入（L7631-7638）、rejectNumericSelection（L7715-7722）、
 *         重新整理推薦（L8203-8291；prepareDestinationCombinations / advice 下游未重建）、
 *         place detail（L8401-8528；streamChat / pushNearby 下游未重建）、
 *         UI handleDiscussPlace（L7550-7565，不經 send）、
 *         structured shortcut 正規化（L8547-8650，只重建 pendingClarification 清除，下游未重建）、
 *         nearbyShortcutTurn 對 pending handler 的 gating（L8686-8689 / L8810-8813）、
 *         createArbitration 的 source gating（L8661）。
 *         未重建：isRepeatedTripDateConfirmation / date_confirmation（L7639-7693）、planning selection（L7755-7871）、
 *         legacy nearby pending 回答（L7873-8154，只標記並 return）、regenerate（L8294-8372）、trip add place（L8374-8399）。
 *  r4-Δ4 turn 規格可帶 source（user/auto/chat_shortcut/home_mood）與 ui（inflight/authBlocked/placeDetail）；
 *         情境可帶 initKind（legacyNearby / kyotoDays）。
 *  r4-Δ5 anchors：work 只替換 F4 改了文字的 1 條，新增 F4 與 early return anchors；pre 以 r3 work anchors
 *         對 pre-F4 備份檔；base 沿用 r3 + early return anchors；另檢查 work 中區塊順序。
 *  r4-Δ6 新增 R4 情境與 assertion（r4-EP / r4-UI / r4-SRC / r4-C3 / 情境級 pendingEmpty 等）。
 *  r3 全部 assertion 原樣保留（未放寬、未刪除、未改 expect）。
 *
 * 安全（同 r3）：子程序 configFile:false / envDir:false、白名單 env + Mock Key、攔截 fetch / http(s) / net / tls / undici，
 * 任何外部請求 → 計數並判 FAIL；geocode / weather / Places / Credits 全部 mock + 計數。
 */
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const BASE_REF = "aa2db59";
const ROLE = process.env.VERIFY_P2R3_ROLE ?? "main";
const SCRIPT = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r6.mjs`;
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
// r6-Δ1：pre = F6 前備份；pre5 = F5 前備份（可選 --pre5）；pre4 = F4 前備份（可選 --pre4）
const PRE_FILES = {
  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F6.ts`,
  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F6.tsx`,
};
const PRE5_FILES = {
  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F5.ts`,
  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F5.tsx`,
};
const PRE4_FILES = {
  "src/lib/ai/chat-turn-destination.ts": `${PRE_DIR}/chat-turn-destination.pre-F4.ts`,
  "src/routes/_app.chat.tsx": `${PRE_DIR}/_app.chat.pre-F4.tsx`,
};
const PRE_SHA_SNAPSHOT = `${PRE_DIR}/pre-F6-sha.txt`; // r6-Δ1：F6 開始前（12:17）src 檔案 sha1
const WITH_PRE4 = process.argv.includes("--pre4");
const WITH_PRE5 = process.argv.includes("--pre5");
const LOCALE = "zh-TW";
const MOCK_ENV = {
  GOOGLE_MAPS_API_KEY: "mock-key",
  VITE_GOOGLE_MAPS_API_KEY: "mock-key",
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: "mock-key",
  OPENWEATHER_API_KEY: "mock-key",
  EXPO_PUBLIC_OPENWEATHER_API_KEY: "mock-key",
  OPENAI_API_KEY: "mock-key",
  VITE_SUPABASE_URL: "http://mock-supabase.invalid",
  VITE_SUPABASE_PUBLISHABLE_KEY: "mock-key",
  SUPABASE_URL: "http://mock-supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "mock-key",
};
const SECRET_RE = /KEY|SECRET|TOKEN|PRIVATE|PASSWORD|SUPABASE|OPENAI|GOOGLE|WEATHER|APPLE|CAPACITOR|ROAMIE_ADMIN/i;

const { execFileSync } = await import("node:child_process");
const git = (args) => execFileSync("git", args, { cwd: WORK_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const gitShow = (rel) => git(["show", `${BASE_REF}:${rel}`]);

// ════════════════════════ provider mock（同 r3）════════════════════════
const LOC = (o) => ({
  placeId: `mock-${o.formattedName ?? o.city ?? o.region}`,
  country: o.country ?? "日本",
  city: o.city ?? "",
  region: o.region,
  district: o.district,
  sublocality: o.sublocality,
  lat: o.lat ?? 35,
  lng: o.lng ?? 135,
  formattedName: o.formattedName ?? o.city ?? o.region,
  displayLabel: o.formattedName ?? o.city ?? o.region,
  address: o.address,
});
const REAL = {
  香港跑馬地: LOC({ country: "香港", city: "香港", region: "香港島", district: "灣仔區", sublocality: "跑馬地", formattedName: "跑馬地", lat: 22.27, lng: 114.18 }),
  台中西屯: LOC({ country: "台灣", city: "台中市", region: "台中市", district: "西屯區", formattedName: "台中市西屯區", lat: 24.18, lng: 120.62 }),
  埔里: LOC({ country: "台灣", city: "埔里鎮", region: "南投縣", district: "埔里鎮", formattedName: "南投縣埔里鎮", lat: 23.96, lng: 120.96 }),
  南投埔里: LOC({ country: "台灣", city: "埔里鎮", region: "南投縣", district: "埔里鎮", formattedName: "南投縣埔里鎮", lat: 23.96, lng: 120.96 }),
  金澤看兼六園: LOC({ city: "金澤市", region: "石川縣", sublocality: "兼六町", formattedName: "兼六園", lat: 36.56, lng: 136.66 }),
  台南看西街教會: LOC({ country: "台灣", city: "台南市", region: "台南市", district: "中西區", formattedName: "西街教會", lat: 22.99, lng: 120.2 }),
  新竹潛園: LOC({ country: "台灣", city: "新竹市", region: "新竹市", district: "北區", formattedName: "潛園", lat: 24.8, lng: 120.97 }),
  台北士林夜: LOC({ country: "台灣", city: "台北市", region: "台北市", district: "士林區", formattedName: "士林夜市", lat: 25.09, lng: 121.52 }),
  東京玩具美術館: LOC({ city: "東京", region: "東京都", district: "新宿區", sublocality: "四谷", formattedName: "東京玩具美術館", lat: 35.69, lng: 139.72 }),
  千葉釣崎海岸: LOC({ city: "一宮町", region: "千葉縣", formattedName: "釣崎海岸", lat: 35.37, lng: 140.39 }),
  千葉: LOC({ city: "千葉市", region: "千葉縣", formattedName: "千葉市", lat: 35.6, lng: 140.1 }),
  奈良看鹿: LOC({ city: "奈良市", region: "奈良縣", formattedName: "奈良公園", lat: 34.68, lng: 135.84 }),
  北海道滑雪: LOC({ city: "", region: "北海道", formattedName: "北海道", lat: 43.06, lng: 141.35 }),
  沖繩潛水: LOC({ city: "", region: "沖繩縣", formattedName: "沖繩縣", lat: 26.21, lng: 127.68 }),
  花蓮泛舟: LOC({ country: "台灣", city: "", region: "花蓮縣", formattedName: "花蓮縣", lat: 23.98, lng: 121.6 }),
  里斯本: LOC({ country: "葡萄牙", city: "里斯本", region: "里斯本", formattedName: "里斯本", lat: 38.72, lng: -9.14 }),
  波爾圖: LOC({ country: "葡萄牙", city: "波爾圖", region: "波爾圖", formattedName: "波爾圖", lat: 41.15, lng: -8.61 }),
};
const PARENTS = ["北海道", "沖繩", "京都", "大阪", "東京", "奈良", "金澤", "花蓮", "香港", "台南", "新竹", "千葉", "台北", "台中", "南投", "里斯本", "埔里"];
function realisticLocation(rawQuery) {
  const q = String(rawQuery).split(",")[0].trim();
  if (REAL[q]) return REAL[q];
  const parent = PARENTS.filter((p) => q.startsWith(p)).sort((a, b) => b.length - a.length)[0];
  const label = parent ?? q;
  return LOC({ country: /台|花蓮|新竹|南投|埔里/.test(label) ? "台灣" : label === "香港" ? "香港" : "日本", city: label, region: label, formattedName: label });
}

// ════════════════════════ collect（子程序）════════════════════════
if (ROLE === "collect") {
  const envScrubbed = [];
  for (const k of Object.keys(process.env)) {
    if (SECRET_RE.test(k) && !(k in MOCK_ENV)) {
      envScrubbed.push(k);
      delete process.env[k];
    }
  }
  Object.assign(process.env, MOCK_ENV);

  const { createRequire } = await import("node:module");
  const require = createRequire(`${WORK_ROOT}/package.json`);
  const ext = { fetch: 0, http: 0, https: 0, net: 0, tls: 0, undici: 0 };
  const extLog = [];
  const describe = (a) => {
    try {
      if (typeof a === "string") return a;
      if (a instanceof URL) return a.href;
      if (a && typeof a === "object") return a.url ?? a.href ?? `${a.protocol ?? ""}//${a.hostname ?? a.host ?? ""}${a.path ?? ""}${a.port ? `:${a.port}` : ""}`;
    } catch {
      /* ignore */
    }
    return String(a);
  };
  const trap = (kind, detail) => {
    ext[kind] += 1;
    extLog.push(`${kind}:${String(detail).slice(0, 160)}`);
    const e = new Error(`[ext-trap] ${kind} blocked: ${String(detail).slice(0, 120)}`);
    e.code = "EXT_TRAP";
    throw e;
  };
  globalThis.fetch = async (input) => trap("fetch", describe(input));
  const http = require("node:http");
  const https = require("node:https");
  http.request = (...a) => trap("http", describe(a[0]));
  http.get = (...a) => trap("http", describe(a[0]));
  https.request = (...a) => trap("https", describe(a[0]));
  https.get = (...a) => trap("https", describe(a[0]));
  const net = require("node:net");
  const tls = require("node:tls");
  net.connect = (...a) => trap("net", describe(a[0]));
  net.createConnection = (...a) => trap("net", describe(a[0]));
  tls.connect = (...a) => trap("tls", describe(a[0]));
  let undiciLoaded = false;
  try {
    const undici = require("undici");
    undiciLoaded = true;
    for (const fn of ["request", "fetch", "stream", "pipeline", "connect", "upgrade"]) {
      if (typeof undici[fn] === "function") undici[fn] = (...a) => trap("undici", `${fn}:${describe(a[0])}`);
    }
    if (typeof undici.Dispatcher === "function" && typeof undici.setGlobalDispatcher === "function") {
      class TrapDispatcher extends undici.Dispatcher {
        dispatch(opts) {
          return trap("undici", `dispatch:${opts?.origin ?? ""}${opts?.path ?? ""}`);
        }
      }
      undici.setGlobalDispatcher(new TrapDispatcher());
    }
  } catch {
    undiciLoaded = false;
  }

  const orig = { info: console.info, log: console.log, warn: console.warn, debug: console.debug, error: console.error };
  for (const k of Object.keys(orig)) console[k] = () => {};

  const { readFileSync: readFileSyncC } = await import("node:fs");
  const ROOT = WORK_ROOT;
  const TREE = process.env.VERIFY_P2R3_TREE ?? "work"; // work | pre | base | pre4
  const IS_WORK = TREE !== "base"; // work / pre / pre4 都有 F3 程式碼
  const F4 = TREE === "work" || TREE === "pre" || TREE === "pre5"; // r6-Δ1：pre = F6 前、pre5 = F5 前（皆已含 F4）
  const F5 = TREE === "work" || TREE === "pre"; // r6-Δ1：pre = F6 前（已含 F5）
  const F6 = TREE === "work"; // r6-Δ2：只有 work 走 F6 inline 邏輯（applyLocalFallback retry 傳 turnStartSession）
  const GEO_MODE = process.env.VERIFY_P2_GEO ?? "ok";
  const SEARCH_MODE = process.env.VERIFY_P2_SEARCH ?? "ok";
  const SCENARIO = JSON.parse(process.env.VERIFY_P2_SCENARIO ?? "{}");
  const FAITHFUL = SCENARIO.faithful === true; // r5-Δ3

  const overlay = JSON.parse(process.env.VERIFY_P2R3_OVERLAY ?? '{"modified":[],"hidden":[]}');
  const baseContent = new Map();
  const hidden = new Set();
  if (TREE === "base") {
    for (const rel of overlay.modified) {
      if (!/\.(ts|tsx)$/.test(rel)) continue;
      try {
        baseContent.set(`${WORK_ROOT}/${rel}`, gitShow(rel));
      } catch {
        hidden.add(`${WORK_ROOT}/${rel}`);
      }
    }
    for (const rel of overlay.hidden) hidden.add(`${WORK_ROOT}/${rel}`);
  } else if (TREE === "pre") {
    // r6-Δ1：pre = 工作區 + F6 前的 chat-turn-destination.ts
    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));
  } else if (TREE === "pre5") {
    // r6-Δ1：pre5 = 工作區 + F5 前的 chat-turn-destination.ts（= r5 的 pre）
    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE5_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));
  } else if (TREE === "pre4") {
    // r5-Δ1：pre4 = 工作區 + F4 前的 chat-turn-destination.ts（= r4 的 pre）
    baseContent.set(`${WORK_ROOT}/src/lib/ai/chat-turn-destination.ts`, readFileSyncC(PRE4_FILES["src/lib/ai/chat-turn-destination.ts"], "utf8"));
  }
  const overlayHits = new Set();
  const baseOverlayPlugin = {
    name: "verify-base-overlay",
    enforce: "pre",
    load(id) {
      if (TREE === "work") return null;
      const file = id.split("?")[0];
      if (hidden.has(file)) throw new Error(`[base-overlay] ${file} 不存在於 ${BASE_REF}`);
      if (baseContent.has(file)) {
        overlayHits.add(file.slice(WORK_ROOT.length + 1));
        return baseContent.get(file);
      }
      return null;
    },
  };

  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
  const server = await createServer({
    root: ROOT,
    configFile: false,
    envDir: false,
    logLevel: "silent",
    clearScreen: false,
    plugins: [baseOverlayPlugin, tsconfigPaths()],
    server: { middlewareMode: true, hmr: false, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.environments.client.pluginContainer.buildStart({});
  const vnServer = new ViteNodeServer(server);
  const runner = new ViteNodeRunner({
    root: server.config.root,
    base: server.config.base,
    fetchModule: (id) => vnServer.fetchModule(id),
    resolveId: (id, importer) => vnServer.resolveId(id, importer),
  });
  await runner.executeId("/@vite/env");
  const imp = (p) => runner.executeFile(`${ROOT}/src/${p}`);
  const M = {
    tc: await imp("lib/ai/travel-context.ts"),
    gpc: await imp("lib/ai/global-planning-context.ts"),
    tpc: await imp("lib/ai/trip-planning-context.ts"),
    mvp: await imp("lib/ai/must-visit-places.ts"),
    weather: await imp("lib/ai/destination-weather-prefetch.ts"),
    geo: await imp("lib/ai/destination-geocode.ts"),
    placeIntent: await imp("lib/ai/chat-place-intent.ts"),
    catDest: await imp("lib/ai/chat-category-destination.ts"),
    dtp: await imp("lib/ai/destination-travel-profile.ts"),
    chatIntent: await imp("lib/ai/chat-intent.ts"),
    nearbyClar: await imp("lib/ai/nearby-location-clarification.ts"),
    convState: await imp("lib/ai/chat-conversation-state.ts"),
    chatSession: await imp("lib/chat-session.ts"),
    planFlow: await imp("lib/chat-planning-flow.ts"),
    tripIntent: await imp("lib/recommendation/trip-intent.ts"),
    dining: await imp("lib/ai/chat-dining-flow.ts"),
    refine: await imp("lib/ai/recommendation-refinement/index.ts"),
    cca: await imp("lib/ai/chat-create-authority.ts"),
    gph: await imp("lib/ai/generated-plan-handoff.ts"),
    geoClar: await imp("lib/ai/destination-geographic-clarification.ts"),
    fbScope: await imp("lib/ai/destination-recommendation-fallback-scope.ts"),
    aps: await imp("lib/ai/ai-planning-session.ts"),
    cps: await imp("lib/ai/chat-planning-state.ts"),
    tripStyle: await imp("lib/ai/ai-trip-style.ts"),
    numSel: await imp("lib/ai/numeric-selection-authority.ts"),
    refresh: await imp("lib/ai/chat-recommendation-refresh.ts"),
    addAll: await imp("lib/ai/parse-add-all-to-trip-intent.ts"),
    budget: await imp("lib/ai/budget-refinement.ts"),
    pcc: await imp("lib/ai/planning-conversation-constraints.ts"),
    crs: await imp("lib/ai/conversation-recommendation-session.ts"),
    ppm: await imp("lib/place-planning-memory.ts"),
    rds: await imp("lib/ai/resolved-destination-scope.ts"),
    copy: await imp("lib/chat-runtime-copy.ts"),
    builder: await imp("lib/ai/chat-destination-category-recommendation.ts"),
    meal: await imp("lib/ai/meal-intent-parser.ts"),
    // r4-Δ3：early return 重建所需的真實模組
    pdc: await imp("lib/ai/place-detail-chat.ts"),
    dcd: await imp("lib/ai/destination-combination-discovery.ts"),
    crg: await imp("lib/ai/continue-recommendation-intent.ts"),
    ctd: IS_WORK ? await imp("lib/ai/chat-turn-destination.ts") : null,
    // r5-Δ3：faithful late 路徑所需（只在 faithful 情境載入）
    router: FAITHFUL ? await imp("lib/ai/chat-router.ts") : null,
    cte: FAITHFUL ? await imp("lib/ai/chat-turn-engine.ts") : null,
    // r6-Δ2：applyLocalFallback 重建所需（isExplicitDeviceNearbyRequest）
    rss: FAITHFUL ? await imp("lib/ai/recommendation-search-scope.ts") : null,
  };
  const overlayCheck = {
    echo: typeof M.geoClar.isParentScopeCityEchoAnswer === "function",
    parentPending: typeof M.geoClar.buildPendingParentScopeClarification === "function",
    // r4-Δ1：F4 新增 before 參數 → F4/F5 的 Function.length = 2，F4 前 = 1
    ctdArity: M.ctd ? M.ctd.withoutUnconfirmedSessionDestinations.length : null,
    hits: [],
    // r5-Δ5：真實模組 probe（區分 F5 / F5 前；並量測程式碼審查 (a)(b)(c) 的實際輸出）
    f5Probe: null,
    modProbes: null,
  };
  {
    const B0 = { recommendedPlaces: [], selectedPlaces: [], phase: "discover", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
    const GPS = { lat: 24.18, lng: 120.62, city: "台中市" };
    const run = (session, before) => {
      try {
        const r = M.ctd.withoutUnconfirmedSessionDestinations(session, before);
        return {
          location: r.location ? { lat: r.location.lat ?? null, lng: r.location.lng ?? null, city: r.location.city ?? null } : null,
          currentLocation: r.travelContext?.currentLocation ?? null,
          destination: r.travelContext?.destination ?? null,
          destinationCity: r.travelContext?.destinationCity ?? null,
          destinationRegion: r.travelContext?.destinationRegion ?? null,
          destinationType: r.travelContext?.destinationType ?? null,
          preferredArea: r.preferredArea ?? null,
        };
      } catch (e) {
        return `ERR:${e?.message ?? e}`;
      }
    };
    if (M.ctd) {
      const beforeGps = { ...B0, location: { ...GPS }, travelContext: { interests: [], currentLocation: "台中市" } };
      const sessKyoto = { ...beforeGps, location: { ...GPS, city: "京都" }, travelContext: { interests: [], destinationCity: "京都", currentLocation: "京都" }, preferredArea: "京都" };
      const p = run(sessKyoto, beforeGps);
      overlayCheck.f5Probe = typeof p === "string" ? p : { locCity: p.location?.city ?? null, cur: p.currentLocation, ctxCity: p.destinationCity };
      overlayCheck.modProbes = {
        // (a1) 本輪前沒有 location，本輪 resolveChatLocation 取得 GPS（city=台中市）後在澄清輪 persist
        a1_gpsAcquiredThisTurn: run({ ...B0, location: { ...GPS }, travelContext: { interests: [], currentLocation: "台中市" } }, { ...B0 }),
        // (a2) 同上但 GPS 沒有 city
        a2_gpsAcquiredNoCity: run({ ...B0, location: { lat: GPS.lat, lng: GPS.lng, city: "" }, travelContext: { interests: [] } }, { ...B0 }),
        // (a3) 本輪前 location = applyTripIntent 的 {0,0,大阪}（無座標），本輪取得 GPS
        a3_prevNoCoordsThenGps: run(
          { ...B0, location: { ...GPS }, travelContext: { interests: [], currentLocation: "台中市" } },
          { ...B0, location: { lat: 0, lng: 0, city: "大阪" }, travelContext: { interests: [], destination: "大阪", currentLocation: "大阪" }, preferredArea: "大阪" },
        ),
        // (a4) applyTripIntent 把 {0,0,京都} 寫入（本輪前沒有 location）
        a4_tripIntentKyotoNoPrev: run({ ...B0, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),
        // (b) 台中西屯已驗證（destinationCity=台中市 / region=台中市）→ 本輪 merge 寫入京都 scope
        b_adminArea: run(
          { ...B0, preferredArea: "京都", travelContext: { interests: [], destination: "台中西屯", destinationCity: "京都", destinationRegion: "京都府", destinationCountry: "日本", destinationType: "city" } },
          { ...B0, preferredArea: "台中西屯", travelContext: { interests: [], destination: "台中西屯", destinationCity: "台中市", destinationRegion: "台中市", destinationCountry: "台灣", destinationType: "district" } },
        ),
        // (b2) 本輪前已確認城市 = 京都（A）→ 本輪 scope 仍為京都
        b2_trustedKyoto: run(
          { ...B0, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都" } },
          { ...B0, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都" } },
        ),
        // (c) 本輪前 currentLocation=台中市；本輪 location 更新為使用者真實新位置（大阪，座標也不同）
        c_newRealLocation: run({ ...B0, location: { lat: 34.69, lng: 135.5, city: "大阪" }, travelContext: { interests: [], currentLocation: "大阪" } }, beforeGps),
        // r6-Δ5：F6 A/B/C 判定 probe
        r6_B_gpsCityRewrite: run(sessKyoto, beforeGps),
        r6_C_placeholderPrevGps: run({ ...beforeGps, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, beforeGps),
        r6_C_confirmedPlaceholderNoPrev: run(
          { ...B0, location: { lat: 0, lng: 0, city: "京都" }, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都", currentLocation: "京都" } },
          { ...B0, preferredArea: "京都", travelContext: { interests: [], destination: "京都", destinationCity: "京都" } },
        ),
        r6_C_prevPlaceholderKept: run(
          { ...B0, location: { lat: 0, lng: 0, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "京都" } },
          { ...B0, location: { lat: 0, lng: 0, city: "大阪" }, travelContext: { interests: [], destination: "大阪", currentLocation: "大阪" } },
        ),
        r6_tripAnchorSame: run(
          { ...B0, location: { lat: 34.9949, lng: 135.785, city: "京都看楓葉" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },
          { ...B0, location: { lat: 34.9949, lng: 135.785, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },
        ),
        r6_tripAnchorFirstTurnPrevGps: run(
          { ...beforeGps, location: { lat: 34.9949, lng: 135.785, city: "京都" }, travelContext: { interests: [], destination: "京都", currentLocation: "清水寺" } },
          beforeGps,
        ),
        r6_destCoordsNoPrev: run({ ...B0, location: { lat: 35.0116, lng: 135.7681, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),
        r6_nearZeroCoords: run({ ...B0, location: { lat: 0.0005, lng: 0.0005, city: "京都" }, travelContext: { interests: [], currentLocation: "京都" } }, { ...B0 }),
      };
      // r6-Δ5：L12224 重試按鈕（streamChat(lastFailed) → userText=""）與 L8533 place detail streamChat 未傳 turnStartSession 的論證 probe
      const sf = (fn, fb) => {
        try {
          return fn();
        } catch (e) {
          return `${fb}:${e?.message ?? e}`;
        }
      };
      const pdItem = { id: "pd-1", name: "清水寺", placeId: "pd-1", googlePlaceId: "pd-1", lat: 34.9949, lng: 135.785, address: "京都市東山區" };
      const pdBase = { ...B0, travelContext: { interests: [], destination: "京都" } };
      const pdSession = sf(() => M.pdc.enterPlaceDetailChat(pdBase, pdItem), "ERR");
      const pdTurn = (text) =>
        typeof pdSession === "string"
          ? pdSession
          : sf(() => M.pdc.isPlaceDetailChatActive(M.tc.mergeTravelContext(M.pdc.enterPlaceDetailChat(pdSession, pdSession.placeDetailFocus), text).session), "ERR");
      overlayCheck.modProbes.r6_review = {
        retryButton_emptyText_shouldFetchCategory: sf(() => M.placeIntent.shouldFetchDestinationCategoryPlaces("", { interests: [], destination: "京都" }, pdBase), "ERR"),
        retryButton_emptyText_intents: sf(() => M.placeIntent.parseChatPlaceIntents("").length, "ERR"),
        retryButton_emptyText_userWantsNearby: sf(() => M.chatIntent.userExplicitlyWantsNearbyPlaces(""), "ERR"),
        placeDetail_sessionActive: typeof pdSession === "string" ? pdSession : sf(() => M.pdc.isPlaceDetailChatActive(pdSession), "ERR"),
        placeDetail_activeAfterMerge_photo: pdTurn("這裡適合拍照嗎"),
        placeDetail_activeAfterMerge_category: pdTurn("京都看楓葉推薦景點"),
        placeDetail_activeAfterMerge_cafe: pdTurn("推薦咖啡廳"),
      };
    }
  }
  const copyOf = (key, vars) => M.copy.chatRuntimeCopy(key, LOCALE, vars);
  const mealOf = (text) => {
    try {
      const m = M.meal.resolveExplicitMealIntent(String(text ?? ""));
      return m ? { slot: m.slot ?? null, city: m.city ?? null } : null;
    } catch {
      return null;
    }
  };

  let phase = "init";
  const geocodes = [];
  const weatherCalls = [];
  const builderCalls = [];
  const placesReqs = [];
  const creditsBegin = [];
  const creditsSettle = [];
  const geocodeFn = async (req) => {
    const q = String(req?.data?.query ?? req?.data?.destinationName ?? "");
    geocodes.push({ phase, q });
    if (GEO_MODE === "timeout") {
      await new Promise((r) => setTimeout(r, 3));
      throw new Error("provider timeout");
    }
    if (GEO_MODE === "null") return null;
    if (GEO_MODE === "zero") {
      return { location: null, error: null, providerResult: { ok: false, status: "ZERO_RESULTS", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_zero_results", query: q } };
    }
    if (GEO_MODE === "neterr") {
      return { location: null, error: "geocode_network_error", providerResult: { ok: false, status: "geocode_network_error", provider: "geocode", rawResultCount: 0, parsedResultCount: 0, failureReason: "geocode_network_error", query: q } };
    }
    const location = realisticLocation(q);
    return { location, error: null, providerResult: { ok: true, status: "OK", provider: "geocode", rawResultCount: 1, parsedResultCount: 1, latitude: location.lat, longitude: location.lng, query: q } };
  };
  const fetchWeather = async (req) => {
    weatherCalls.push({ phase, data: req?.data ?? null });
    return null;
  };
  const mockPlace = (data, i) => ({
    id: `mock-pid-${data.destinationName ?? "x"}-${data.query}-${i}`,
    googlePlaceId: `mock-pid-${data.destinationName ?? "x"}-${data.query}-${i}`,
    name: `${data.destinationName ?? ""}地點${i}`,
    address: `${data.destinationName ?? ""}某路${i}號`,
    lat: (data.lat || 35) + i / 1000,
    lng: (data.lng || 135) + i / 1000,
    rating: 4.4,
    userRatingCount: 500,
    photoName: null,
    primaryType: data.intentCategory === "restaurant" ? "restaurant" : data.intentCategory === "cafe" ? "cafe" : "tourist_attraction",
    types: [data.intentCategory === "restaurant" ? "restaurant" : data.intentCategory === "cafe" ? "cafe" : "tourist_attraction"],
    businessStatus: "OPERATIONAL",
    openStatus: "unknown",
    openStatusLabel: "",
    todayHoursLabel: "",
    closingSoonNote: "",
    nextOpenHint: "",
  });
  const searchPlaces = async ({ data }) => {
    placesReqs.push({ phase, q: String(data?.query ?? ""), dest: data?.destinationName ?? null, city: data?.cacheCity ?? null, mode: data?.mode ?? null });
    if (SEARCH_MODE !== "ok") return { places: [], error: null, rawCount: 0 };
    const places = [1, 2, 3, 4, 5, 6].map((i) => mockPlace(data ?? {}, i));
    return { places, error: null, rawCount: places.length };
  };
  const buildDestinationCategoryRecommendationsSpy = async ({ destination, intents, userText, context, session }) => {
    builderCalls.push({ destination, intents, userText, ctxDestination: context?.destination ?? null });
    const prev = phase;
    phase = "builder";
    let builderError = null;
    try {
      await M.builder.buildDestinationCategoryRecommendations({
        destination,
        intents,
        userText,
        context,
        locale: LOCALE,
        searchPlaces,
        geocodeFn,
        excludePlaceIds: [],
        rejectedPlaceNames: [],
        session,
        userProfile: null,
      });
    } catch (e) {
      builderError = String(e?.message ?? e).slice(0, 160);
    }
    phase = prev;
    const recommendations =
      SEARCH_MODE === "ok"
        ? [1, 2, 3, 4].map((i) => ({
            name: `${destination}-地點${i}`,
            placeName: `${destination}-地點${i}`,
            placeId: `pid-${destination}-${i}`,
            googlePlaceId: `pid-${destination}-${i}`,
            lat: 35 + i / 100,
            lng: 135 + i / 100,
            rating: 4.5,
            reason: "mock",
            category: intents?.[0] ?? "attraction",
          }))
        : [];
    return { summary: "mock", recommendations, payload: { title: "t", summary: "mock", recommendations, itinerary: [] }, contextPatch: {}, searchCentroid: undefined, usedQueries: [], builderError };
  };
  const beginPlaceRecommendationCredits = async ({ metadata }) => {
    creditsBegin.push({ destination: metadata?.destination ?? null, path: metadata?.path ?? null });
    return { blocked: false, handle: { id: creditsBegin.length } };
  };
  const settleCreditsOperation = async (handle, delivered) => {
    if (handle) creditsSettle.push(Boolean(delivered));
  };

  const safe = (fn, fallback = null) => {
    try {
      const v = fn();
      return v === undefined ? fallback : v;
    } catch {
      return fallback;
    }
  };
  const baseSession = () => ({
    recommendedPlaces: [],
    selectedPlaces: [],
    phase: "discover",
    discovery: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  function newTurnObs(text) {
    return {
      text,
      path: "",
      route: null,
      dcCalled: false,
      dispatchDest: null,
      turnResolution: null,
      searchDest: null,
      weatherDest: null,
      creditsDest: null,
      clarified: false,
      clarificationLabel: null,
      copyKind: null,
      copy: null,
      answerKind: null,
      noResultsLabel: null,
      continuationDest: null,
      continuationBlocked: null,
      sessionDest: null,
      sessionRecDest: null,
      sessionPendingLabel: null,
      sessionPendingKind: null,
      sessionPendingParent: null,
      sessionPendingOriginal: null,
      sessionPreferredArea: null,
      sessionTripDestCity: null,
      sessionTripDestLabel: null,
      pendingBefore: null,
      memPendingAfter: null,
      pendingClearedByConsume: false,
      activityPreference: null,
      builderUserText: null,
      builderIntent: null,
      builderMeal: null,
      textMeal: null,
      builderError: null,
      geocodes: [],
      placesQueries: [],
      weatherCalls: 0,
      builderCalls: 0,
      placesRequests: 0,
      creditsBegin: 0,
      creditsSettle: [],
      error: null,
      // r4-Δ6
      pendingAtStart: null,
      pendingAtStartLegacy: false,
      earlyConsumed: false,
      altLater: null,
      mainClar: null,
      sessionMealSlot: null,
      // r5-Δ5
      sessionCtxCity: null,
      sessionCtxRegion: null,
      sessionCtxCountry: null,
      sessionCurrentLocation: null,
      sessionLocation: null,
      beforeProbe: null,
      f5NearbyStrip: false,
      // r6-Δ2
      viaRetry: false,
      fallbackReason: null,
    };
  }

  let persisted = baseSession();
  let msgs = [];
  if (process.env.VERIFY_P2_INIT) {
    const init = JSON.parse(process.env.VERIFY_P2_INIT);
    persisted = init.persisted;
    msgs = init.msgs;
  } else if (SCENARIO.initKind === "legacyNearby") {
    // r4-Δ4：legacy nearby pending（destination_area，原句為明確附近需求）
    persisted = {
      ...baseSession(),
      pendingClarification: M.geoClar.buildPendingGeographicClarification({
        rawGeographicLabel: "附近",
        categoryIntent: "cafe",
        originalUserText: "附近咖啡廳",
      }),
    };
  } else if (SCENARIO.initKind === "stickyNearbyShortcut") {
    // r4-Δ4：先前用過 structured shortcut（normalizedShortcutRequest 不會被一般輸入清除）
    persisted = { ...baseSession(), normalizedShortcutRequest: M.chatIntent.buildNormalizedShortcutRequest("coffee", "chat_shortcut", "想找安靜的咖啡廳") };
  } else if (SCENARIO.initKind === "kyotoDays") {
    // r4-Δ4：已確認京都 + 天數（讓「重新整理推薦」走到 persistSession(refreshedSession)）
    persisted = { ...baseSession(), travelContext: { destination: "京都", days: 3, interests: [] }, tripDays: 3, tripDestination: { city: "京都", displayLabel: "京都", country: "日本" } };
  }
  // r5-Δ5：新增 initKind
  const GPS_TC = { lat: 24.18, lng: 120.62, city: "台中市" };
  if (!process.env.VERIFY_P2_INIT) {
    const sticky = () => M.chatIntent.buildNormalizedShortcutRequest("coffee", "chat_shortcut", "想找安靜的咖啡廳");
    if (SCENARIO.initKind === "gpsTaichung") {
      persisted = { ...baseSession(), location: { ...GPS_TC }, travelContext: { interests: [], currentLocation: "台中市" } };
    } else if (SCENARIO.initKind === "stickyNearbyShortcutGps") {
      persisted = { ...baseSession(), normalizedShortcutRequest: sticky(), location: { ...GPS_TC }, travelContext: { interests: [], currentLocation: "台中市" } };
    } else if (SCENARIO.initKind === "stickyNearbyShortcutNoLoc") {
      persisted = { ...baseSession(), normalizedShortcutRequest: sticky() };
    } else if (SCENARIO.initKind === "stickyPending") {
      persisted = {
        ...baseSession(),
        normalizedShortcutRequest: sticky(),
        location: { ...GPS_TC },
        travelContext: { interests: [], currentLocation: "台中市" },
        // base（aa2db59）沒有 parent_city_scope：以當時的 destination_area pending（同一原句）作為對照
        pendingClarification:
          typeof M.geoClar.buildPendingParentScopeClarification === "function"
            ? M.geoClar.buildPendingParentScopeClarification({
                confirmedParentCity: "京都",
                rawGeographicLabel: "京都看楓葉",
                categoryIntent: "attraction",
                originalUserText: "京都看楓葉推薦景點",
              })
            : M.geoClar.buildPendingGeographicClarification({
                rawGeographicLabel: "京都看楓葉",
                categoryIntent: "attraction",
                originalUserText: "京都看楓葉推薦景點",
              }),
      };
    }
  }
  // r5-Δ3：resolveChatLocation（src/lib/ai/resolve-chat-location.ts）mock：有效座標 → 不變；否則 scenario.gps（effective-location）；否則不變
  const mockResolveChatLocation = (s) => {
    const l = s.location;
    if (l?.lat != null && l?.lng != null && (Math.abs(l.lat) > 0.001 || Math.abs(l.lng) > 0.001)) return s;
    if (SCENARIO.gps) return { ...s, location: { lat: SCENARIO.gps.lat, lng: SCENARIO.gps.lng, city: SCENARIO.gps.city } };
    return s;
  };
  const TURN_OFFSET = Number(process.env.VERIFY_P2_TURN_OFFSET ?? 0);
  function persistSession(s, nextMsgs) {
    persisted = s;
    if (nextMsgs) msgs = nextMsgs;
  }

  // ── pushDestinationCategoryPlaceRecommendation（work L5650-6160）──
  async function pushDC(obs, activeSession, userText, conversation, opts) {
    obs.dcCalled = true;
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(userText)) return false;
    const merged = M.tc.mergeTravelContext(activeSession, userText);
    const placeCtx = M.mvp.mergeContextForPlaceFetch(merged.context, activeSession);
    const intents = M.placeIntent.parseChatPlaceIntents(userText);
    if (!intents.length) {
      obs.path += "|dc_no_intents";
      return false;
    }
    let destination;
    let persistedAreaScope;
    phase = "dc_validate";
    if (IS_WORK) {
      const turnDestination = await M.ctd.validateCategoryTurnDestination(
        opts?.turnDestination ??
          M.ctd.resolveCategoryTurnDestination({ ctx: placeCtx, session: merged.session, userText, locale: LOCALE }),
        { locale: LOCALE, geocodeFn },
      );
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}${turnDestination.providerValidation ? `/${turnDestination.providerValidation}` : ""}`;
      const clarificationPlan = M.ctd.planCategoryTurnClarification(turnDestination);
      if (clarificationPlan && opts?.fromClarification) {
        phase = "post";
        obs.path += "|dc_clarification_already_asked";
        return false;
      }
      if (clarificationPlan) {
        const clarificationLabel =
          clarificationPlan.kind === "parent_city_scope" ? clarificationPlan.confirmedParentCity : clarificationPlan.clarificationLabel;
        const copyKind = clarificationPlan.kind === "parent_city_scope" ? "parentScopeConfirm" : "whichRegion";
        const copy = copyOf(copyKind, { destination: clarificationLabel });
        obs.clarified = true;
        obs.clarificationLabel = clarificationLabel;
        obs.copyKind = copyKind;
        obs.copy = copy;
        const clarificationMsgs = [...conversation, { role: "assistant", content: copy }];
        const sessionDestinationForClarification = M.ctd.confirmedContextDestination(
          activeSession.travelContext ?? { interests: [] },
          activeSession,
        )?.destination;
        // r5-Δ2b：work L5743-5746 `opts?.turnStartSession ?? sessionRef.current`；pre（F5 前）= sessionRef.current（harness = persisted）；pre4 無 before
        const clarBefore = F5 ? (opts?.turnStartSession ?? persisted) : persisted;
        const sessionWithoutUnconfirmed = F4
          ? M.ctd.withoutUnconfirmedSessionDestinations(merged.session, clarBefore)
          : M.ctd.withoutUnconfirmedSessionDestinations(merged.session);
        if (F4) {
          // r4 review probe：L10450 persistSession(nextSession) 之後 L10677 / L10817 呼叫 pushDC(nextSession) 的路徑，
          // sessionRef.current 已是本輪 nextSession（= activeSession）。只記錄，不影響流程。
          const alt = safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged.session, activeSession), null);
          const pick = (x) => (x ? { pref: x.preferredArea ?? null, tpc: x.tripPlanningContext?.destination ?? null, trip: x.tripDestination?.city ?? null } : null);
          obs.altLater = pick(alt);
          obs.mainClar = pick(sessionWithoutUnconfirmed);
          obs.mergedClar = pick(merged.session);
          // r5 probe：本輪是否已在 pushDC 前 persist（sessionRef.current ≠ turnStartSession），及兩種 before 會留下的「京都」欄位
          const kyotoOf = (x) =>
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
          const ts = opts?.turnStartSession;
          obs.beforeProbe = {
            midTurnPersisted: ts ? JSON.stringify({ ...persisted, pendingClarification: undefined }) !== JSON.stringify(ts) : null,
            viaRef: kyotoOf(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged.session, persisted), null)),
            viaStart: ts ? kyotoOf(safe(() => M.ctd.withoutUnconfirmedSessionDestinations(merged.session, ts), null)) : null,
          };
        }
        // r5-Δ2c：work 以 sessionWithoutUnconfirmed.travelContext 為底（L5750-5755）；pre / pre4 以 merged.session.travelContext
        const clarCtxBase = F5 ? sessionWithoutUnconfirmed.travelContext : merged.session.travelContext;
        persistSession(
          {
            ...sessionWithoutUnconfirmed,
            travelContext: clarCtxBase
              ? { ...clarCtxBase, destination: sessionDestinationForClarification }
              : clarCtxBase,
            pendingClarification:
              clarificationPlan.kind === "parent_city_scope"
                ? M.geoClar.buildPendingParentScopeClarification({
                    confirmedParentCity: clarificationPlan.confirmedParentCity,
                    rawGeographicLabel: turnDestination.rawLabel ?? clarificationLabel,
                    categoryIntent: intents[0],
                    originalUserText: userText,
                  })
                : M.geoClar.buildPendingGeographicClarification({
                    rawGeographicLabel: clarificationLabel,
                    categoryIntent: intents[0],
                    originalUserText: userText,
                  }),
            activeCategoryIntent: intents[0],
            pendingQuestion: undefined,
            lastAssistantReply: copy,
          },
          clarificationMsgs,
        );
        phase = "post";
        return true;
      }
      destination = turnDestination.destination;
      if (!destination) {
        phase = "post";
        obs.path += "|dc_no_destination";
        return false;
      }
      persistedAreaScope = turnDestination.geographicScope?.searchScope === "area" ? turnDestination.geographicScope : null;
    } else {
      const provisionalArea = M.dtp.extractProvisionalDestinationAreaCandidate(userText);
      const validatedAreaScope = await M.dtp.resolveValidatedDestinationAreaScope({ input: userText, locale: LOCALE, geocodeFn });
      if (provisionalArea && !validatedAreaScope) {
        const copy = copyOf("whichRegion", { destination: provisionalArea.areaCandidate });
        obs.clarified = true;
        obs.clarificationLabel = provisionalArea.areaCandidate;
        obs.copyKind = "whichRegion";
        obs.copy = copy;
        const clarificationMsgs = [...conversation, { role: "assistant", content: copy }];
        persistSession(
          {
            ...merged.session,
            pendingClarification: M.geoClar.buildPendingGeographicClarification({
              rawGeographicLabel: provisionalArea.areaCandidate,
              categoryIntent: intents[0],
              originalUserText: userText,
            }),
            activeCategoryIntent: intents[0],
            pendingQuestion: undefined,
            lastAssistantReply: copy,
          },
          clarificationMsgs,
        );
        phase = "post";
        return true;
      }
      const baseDestination = M.catDest.resolveDestinationForCategorySearch(placeCtx, merged.session, userText);
      if (!baseDestination && !validatedAreaScope) {
        phase = "post";
        obs.path += "|dc_no_destination";
        return false;
      }
      destination = validatedAreaScope?.displayLabel ?? baseDestination;
      persistedAreaScope =
        validatedAreaScope ??
        (destination ? M.dtp.resolveDestinationAreaScope(destination) : null) ??
        M.dtp.resolveDestinationAreaScope(userText);
    }
    phase = "post";
    const gate = await beginPlaceRecommendationCredits({ hasPlusAccess: false, metadata: { path: "destination_category", destination, intents } });
    obs.creditsDest = destination;
    let handle = gate.handle;
    try {
      obs.searchDest = destination;
      obs.builderUserText = userText;
      obs.builderIntent = intents[0] ?? null;
      obs.builderMeal = mealOf(userText);
      const { recommendations, contextPatch, builderError } = await buildDestinationCategoryRecommendationsSpy({
        destination,
        intents,
        userText,
        context: { ...placeCtx, destination },
        session: activeSession,
      });
      if (builderError) obs.builderError = builderError;
      if (!recommendations.length) {
        await settleCreditsOperation(handle, false);
        handle = null;
        return false;
      }
      const categoryIntent = intents[0];
      const displayBatchSize = M.crs.DESTINATION_CATEGORY_DISPLAY_BATCH_SIZE ?? 3;
      const { session: recSession, batch } = M.crs.createRecommendationSession({
        destination,
        topic: categoryIntent,
        pool: recommendations,
        batchSize: displayBatchSize,
        usedQueries: [],
        recommendationPage: 0,
        parentCity: persistedAreaScope?.parentCity,
        area: persistedAreaScope?.area,
        searchScope: persistedAreaScope ? "area" : "city",
        searchRegionLabel: destination,
      });
      const activeRecContext = M.refine.ensureActiveRecommendationContext(
        { ...merged.session, recommendationSession: recSession, activeCategoryIntent: categoryIntent },
        {
          destination,
          intent: categoryIntent,
          places: batch.length ? batch : recommendations.slice(0, displayBatchSize),
          usedQueries: recSession.usedQueries,
          resolvedSearchCity: persistedAreaScope?.parentCity ?? destination,
          parentCity: persistedAreaScope?.parentCity,
          area: persistedAreaScope?.area,
          searchScope: persistedAreaScope ? "area" : "city",
        },
      );
      const sessionWithRecs = {
        ...merged.session,
        activeCategoryIntent: categoryIntent,
        recommendationSession: recSession,
        activeRecommendationContext: activeRecContext,
        conversationMode: "destination_planning",
        phase: "recommend",
        // r4-Δ2b：work L6030-6038（pre 無此段）
        ...(F4 && opts?.fromClarification && merged.session.preferredArea
          ? { preferredArea: M.ctd.confirmedDestinationLabelOrUndefined(merged.session.preferredArea, merged.session) ?? destination }
          : {}),
        pendingClarification: undefined,
        pendingQuestion: undefined,
        tripPlanningContext: activeSession.tripPlanningContext
          ? { ...activeSession.tripPlanningContext, destination, intent: "destination_planning" }
          : { selectedPlaces: [], destination, intent: "destination_planning" },
        tripDays: activeSession.tripDays,
        travelContext: { ...placeCtx, ...contextPatch, destination, tripPurpose: "recommend_places" },
      };
      const recs = batch.length ? batch : recommendations.slice(0, displayBatchSize);
      const nextMsgs = [...conversation, { role: "assistant", content: `${destination}推薦`, roamie: { summary: "mock", recommendations: recs } }];
      persistSession(
        safe(() => M.ppm.syncSessionPlaceMemory({ ...sessionWithRecs, recommendedPlaces: recs, pendingClarification: undefined }), {
          ...sessionWithRecs,
          recommendedPlaces: recs,
        }),
        nextMsgs,
      );
      await settleCreditsOperation(handle, true);
      handle = null;
      return true;
    } catch (error) {
      await settleCreditsOperation(handle, false);
      obs.error = `dc_throw:${error?.message ?? error}`;
      return false;
    }
  }

  function recordContinuation(obs, session, destForMore) {
    if (IS_WORK && destForMore && M.ctd.isUnconfirmedSearchDestination(destForMore, session)) {
      obs.continuationBlocked = destForMore;
      obs.path += "|more_blocked_unconfirmed→noMore";
      return null;
    }
    return destForMore ?? null;
  }

  // ── r6-Δ2：applyLocalFallback（work L6529-6732）。F6 起 destination-category-retry 以 { turnStartSession } 呼叫 pushDC；
  //    F6 前（pre / pre5 / pre4）不帶 opts → pushDC 澄清 before = sessionRef.current（harness = persisted）。
  async function applyLocalFallback(obs, activeSession, activeUserText, conversation, reason, turnStartSession) {
    obs.fallbackReason = reason;
    obs.path += `|fallback(${reason})`;
    // L6540
    if (M.pdc.isPlaceDetailChatActive(activeSession)) {
      obs.path += "|fb_place_detail(return false)";
      return false;
    }
    // L6544-6563
    const mergedForScope = M.tc.mergeTravelContext(activeSession, activeUserText);
    const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: activeUserText, session: activeSession, context: mergedForScope.context });
    const scopedSession = explicitScope ? M.fbScope.isolateSessionToExplicitDestination(activeSession, explicitScope) : activeSession;
    if (explicitScope && reason === "destination_category_places_failed") {
      obs.path += "|fb_explicit_builder_empty(return false)";
      return false;
    }
    // L6588-6648 continue（pushRecommendationRefinement / pushMorePlaceRecommendations 未重建）
    if (
      (scopedSession.activeRecommendationContext || scopedSession.recommendationSession || M.crs.resolveActiveCategoryIntent(scopedSession)) &&
      (M.crg.matchesContinueRecommendationGrammar(activeUserText) || M.refresh.isMorePlaceRecommendationsIntent(activeUserText) || M.refresh.isRefreshRecommendationsRequest(activeUserText)) &&
      !M.rss.isExplicitDeviceNearbyRequest(activeUserText)
    ) {
      obs.path += "|fb_continue(未重建)";
      return false;
    }
    // L6650-6668 trip add place（resolveTripAddPlaceChatSession 未重建；R6 情境不含 trip add place）
    const mergedForAdvice = M.tc.mergeTravelContext(scopedSession, activeUserText);
    // L6672-6698 pushDestinationPlaceRecommendation（未重建，停止）
    if (M.mvp.shouldFetchDestinationPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {
      obs.path += "|fb_destination_places(未重建)";
      return false;
    }
    // L6700-6732 destination-category-retry
    if (M.placeIntent.shouldFetchDestinationCategoryPlaces(activeUserText, mergedForAdvice.context, scopedSession)) {
      const destForCategory = M.catDest.resolveDestinationForCategorySearch(mergedForAdvice.context, scopedSession, activeUserText);
      if (
        explicitScope &&
        M.fbScope.shouldBlockCrossScopeRecommendationFallback({ explicit: explicitScope, sourcePath: "destination-category-retry", fallbackDestination: destForCategory })
      ) {
        obs.path += "|fb_retry_blocked(cross_scope)";
      } else {
        obs.path += "|fb_destination_category_retry";
        obs.viaRetry = true;
        const applied = await pushDC(obs, scopedSession, activeUserText, conversation, F6 ? { turnStartSession } : undefined);
        if (applied) return true;
      }
    }
    obs.path += "|fb_tail(planning/offline 未重建)";
    return false;
  }

  // ── send（work L7608-）──
  async function send(obs, text, t = {}) {
    const trimmed = text.trim();
    obs.textMeal = mealOf(trimmed);
    let session = persisted;
    // r4-Δ3：L7624 `if (!trimmed || streaming || generating) return;`
    if (!trimmed || t.ui === "inflight") {
      obs.path = `noop(${!trimmed ? "empty" : "in-flight"})`;
      return;
    }
    // r4-Δ3：L7631-7638 requireAuthForAction → false 時 return
    if (t.ui === "authBlocked") {
      obs.path = "auth_required(return)";
      return;
    }
    // （L7639-7693 isRepeatedTripDateConfirmation / date_confirmation：未重建）
    // r4-Δ2c：L7699-7714 早期 pending 消費（F4 起；work 與 pre）
    let turnPendingGeographic;
    if (F4) {
      turnPendingGeographic =
        (t.source === undefined || t.source === "user") &&
        session.pendingClarification &&
        !(
          session.pendingClarification.kind === "destination_area" &&
          M.chatIntent.userExplicitlyWantsNearbyPlaces(session.pendingClarification.originalUserText ?? "")
        )
          ? session.pendingClarification
          : undefined;
      if (turnPendingGeographic) {
        session = { ...session, pendingClarification: undefined };
        const storedSession = persisted;
        if (storedSession.pendingClarification) {
          persistSession({ ...storedSession, pendingClarification: undefined });
          obs.earlyConsumed = true;
        }
      }
    }
    // r5-Δ2a：L7719-7722 turnStartSession（只有 work）
    const turnStartSession = F5 ? { ...persisted, pendingClarification: undefined } : undefined;
    // r4-Δ3：L7715-7722 rejectNumericSelection
    if (M.numSel.rejectNumericSelection(session, trimmed)) {
      const conversation = [...msgs, { role: "user", content: trimmed }, { role: "assistant", content: copyOf("numericSelectionUnavailable") }];
      persistSession(M.numSel.discardExpiredSelection(session), conversation);
      obs.path = "numeric_selection_rejected(return)";
      return;
    }
    // L7724-7727（r3 原本放在 send 開頭；r4 依原始碼順序移到 rejectNumericSelection 之後）
    if (M.gph.isExplicitTripCreationTurn(trimmed) || M.chatSession.isUserConfirmingItinerary(trimmed)) {
      session = M.gph.beginTripCreation(session, M.chatSession.isUserConfirmingItinerary(trimmed) ? "confirmed_create" : "direct_itinerary_create");
    }
    // r4-Δ3：L7873-8154 legacy nearby pending（未重建，標記後 return，不 persist）
    if (
      session.pendingClarification?.kind === "destination_area" &&
      M.chatIntent.userExplicitlyWantsNearbyPlaces(session.pendingClarification.originalUserText ?? "")
    ) {
      obs.path = "legacy_nearby_pending(未重建)";
      return;
    }
    if (M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed)) {
      obs.path = "explicit_nearby(未重建)";
      return;
    }
    // r4-Δ3：L8203-8291 重新整理推薦
    const REFRESH_OPTION = M.dcd.REFRESH_DESTINATION_RECOMMENDATIONS_OPTION;
    const wantsRefreshRecommendations =
      trimmed === REFRESH_OPTION ||
      /^(重新整理推薦|重新整理)$/.test(trimmed) ||
      (session.pendingQuestion?.options?.includes(REFRESH_OPTION) === true && /重新整理/.test(trimmed));
    if (wantsRefreshRecommendations) {
      const ctx = session.travelContext ?? { interests: [] };
      const destination = ctx.destination?.trim() || session.tripDestination?.displayLabel?.trim() || session.tripDestination?.city?.trim();
      const days = ctx.days ?? session.tripDays;
      if (!destination || !days) {
        obs.path = "refresh_toast(no destination/days; return)";
        return;
      }
      const label = M.tpc.normalizeDestinationLabel(destination);
      msgs = [...msgs, { role: "user", content: trimmed }];
      // prepareDestinationCombinations（L8231）未重建
      const refreshedSession = {
        ...session,
        pendingQuestion: undefined,
        travelContext: {
          ...ctx,
          destination: label,
          days,
          startDate: ctx.startDate ?? session.tripStartDate,
          endDate: ctx.endDate ?? session.tripEndDate,
          generationRequestId: "refresh_mock",
          tripPurpose: "region_selected",
        },
      };
      persistSession(refreshedSession);
      obs.path = "refresh→persist(refreshedSession)→advice(未重建)";
      return;
    }
    // （L8294-8399 regenerate / trip add place：未重建）
    // r4-Δ3：L8401-8528 place detail
    if (M.pdc.isPlaceDetailChatActive(session)) {
      const followUp = M.pdc.parsePlaceDetailFollowUp(trimmed);
      const baseConversation = [...msgs, { role: "user", content: trimmed }];
      msgs = baseConversation;
      if (followUp === "add_to_trip" && session.placeDetailFocus) {
        persistSession(M.pdc.enterPlaceDetailChat(session, session.placeDetailFocus)); // addSelectedPlace 未重建
        obs.path = "place_detail_add_to_trip";
        return;
      }
      if (followUp === "view_route" && session.placeDetailFocus) {
        obs.path = "place_detail_view_route(no persist)";
        return;
      }
      const continuedCategory = M.crg.matchesContinueRecommendationGrammar(trimmed)
        ? session.placeFocusRecommendationScope?.requestedCategory
        : undefined;
      const nearbyIntent = M.pdc.resolvePlaceDetailNearbyIntent(trimmed) ?? continuedCategory;
      if (nearbyIntent) {
        persistSession(session); // ≈ preparePlaceDetailNearbySession(centered, …)（pending 欄位同 session）；push 未重建
        obs.path = "place_detail_nearby(push 未重建)";
        return;
      }
      let detailSession = M.pdc.enterPlaceDetailChat(session, session.placeDetailFocus);
      const detailMerged = M.tc.mergeTravelContext(detailSession, trimmed);
      detailSession = detailMerged.session;
      persistSession(detailSession);
      obs.path = "place_detail_followup(streamChat 未重建)";
      return;
    }
    // r4-Δ2c：L8531-8542 sessionForTurn
    const sessionForTurn = turnPendingGeographic ? { ...session, pendingClarification: turnPendingGeographic } : session;
    let nextSession = M.tripIntent.applyTripIntentToSession(trimmed, sessionForTurn);
    // r4-Δ3：L8547-8650 structured shortcut 正規化（只重建 pending / snapshot 清除；下游未重建）
    const normalizedShortcutFromTurn =
      t.source === "chat_shortcut"
        ? M.chatIntent.resolveNormalizedShortcutRequestFromText(trimmed, "chat_shortcut")
        : t.source === "home_mood"
          ? (session.normalizedShortcutRequest ?? M.chatIntent.resolveNormalizedShortcutRequestFromText(trimmed, "home_mood"))
          : null;
    nextSession = M.chatIntent.applyQuickChipContext(trimmed, nextSession);
    nextSession = M.dining.applyDiningContextFromText(trimmed, nextSession);
    if (normalizedShortcutFromTurn) {
      nextSession = {
        ...nextSession,
        normalizedShortcutRequest: normalizedShortcutFromTurn,
        recommendationSession: undefined,
        activeRecommendationContext: undefined,
        pendingQuestion: undefined,
        pendingClarification: undefined,
        conversationMode: undefined,
        chatPlanningState: "idle",
      };
      obs.path = `structured_shortcut(${t.source}:${normalizedShortcutFromTurn.mode}；下游未重建，未 persist)`;
      return;
    }
    // r4-Δ3：L8661 createArbitration 只對 user / chat_shortcut
    if (t.source === undefined || t.source === "user" || t.source === "chat_shortcut") {
      const createArbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      obs.route = createArbitration.route;
      nextSession = M.cca.applyChatCreateAuthority(nextSession, createArbitration, /(?:預覽|预览|preview|プレビュー|미리보기)/i.test(trimmed));
    }
    const lastAssistantReply = [...msgs].reverse().find((m) => m.role === "assistant" && m.content?.trim())?.content;
    nextSession = M.convState.prepareSessionForUserTurn(nextSession, lastAssistantReply);

    const pendingGeographic = nextSession.pendingClarification;
    obs.pendingBefore = pendingGeographic ? `${pendingGeographic.kind}:${pendingGeographic.confirmedParentCity ?? ""}:${pendingGeographic.rawGeographicLabel}` : null;
    // r4-Δ3：L8686-8688 nearbyShortcutTurn
    const nearbyShortcutTurn =
      nextSession.normalizedShortcutRequest?.structured === true && nextSession.normalizedShortcutRequest.intent === "nearby_recommendation";
    // r5-Δ2d：L8697-8701（只有 work）
    if (F5 && nearbyShortcutTurn && turnPendingGeographic && nextSession.pendingClarification) {
      nextSession = { ...nextSession, pendingClarification: undefined };
      obs.f5NearbyStrip = true;
    }
    if (IS_WORK) {
      if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {
        nextSession = { ...nextSession, pendingClarification: undefined };
        const confirmedParentCity = pendingGeographic.confirmedParentCity?.trim();
        const answer = M.geoClar.parseParentScopeConfirmationAnswer(trimmed);
        const echo = M.geoClar.isParentScopeCityEchoAnswer(trimmed, confirmedParentCity);
        const affirmative = M.convState.isAffirmativeReply(trimmed);
        const override = M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed);
        obs.answerKind = echo ? "echo" : affirmative ? "affirmative" : answer;
        if (confirmedParentCity && (echo || (!override && (affirmative || answer === "confirm")))) {
          const next = [...msgs, { role: "user", content: trimmed }];
          obs.path = `parent_scope_confirm(${confirmedParentCity})`;
          obs.memPendingAfter = nextSession.pendingClarification?.kind ?? null;
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, activeCategoryIntent: pendingGeographic.categoryIntent },
            { destination: confirmedParentCity, parentCity: confirmedParentCity, area: confirmedParentCity, searchScope: "city" },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(
            obs,
            sessionForRec,
            M.ctd.resolveParentScopeSearchUserText(pendingGeographic, confirmedParentCity),
            next,
            { turnDestination: M.ctd.resolveConfirmedParentScopeTurnDestination(confirmedParentCity), fromClarification: true },
          );
          if (applied) return;
          obs.noResultsLabel = confirmedParentCity;
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: confirmedParentCity }) }]);
          return;
        }
        obs.path = `parent_scope_${obs.answerKind}${override ? "+override" : ""}→general|`;
      }
      if (pendingGeographic?.kind === "destination_area" && !nearbyShortcutTurn) {
        const restored = M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed)
          ? null
          : M.geoClar.restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        nextSession = { ...nextSession, pendingClarification: undefined };
        if (restored) {
          const next = [...msgs, { role: "user", content: trimmed }];
          obs.path = `clarification_answer(restored=${restored.restoredUserText})`;
          obs.answerKind = "restored";
          obs.memPendingAfter = nextSession.pendingClarification?.kind ?? null;
          const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: restored.restoredUserText, session: nextSession, restored });
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, pendingClarification: undefined, activeCategoryIntent: restored.categoryIntent },
            explicitScope ?? { destination: restored.destinationLabel, parentCity: restored.parentCity, area: restored.area, searchScope: restored.searchScope },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(obs, sessionForRec, restored.restoredUserText, next, { fromClarification: true });
          if (applied) return;
          obs.noResultsLabel = restored.destinationLabel;
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: restored.destinationLabel }) }]);
          return;
        }
        obs.answerKind = "unresolved";
        obs.path = "destination_area_unresolved→general|";
      }
      // L8810-8823（F3 消費後寫回）
      if (!nearbyShortcutTurn && (pendingGeographic?.kind === "parent_city_scope" || pendingGeographic?.kind === "destination_area")) {
        obs.memPendingAfter = nextSession.pendingClarification?.kind ?? null;
        const storedSession = persisted;
        if (storedSession.pendingClarification) {
          persistSession({ ...storedSession, pendingClarification: undefined });
          obs.pendingClearedByConsume = true;
        }
      }
    } else if (pendingGeographic?.kind === "destination_area") {
      if (M.geoClar.isPlaceClarificationTripPlanningOverride(trimmed)) {
        nextSession = { ...nextSession, pendingClarification: undefined };
      } else {
        const restored = M.geoClar.restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);
        const next = [...msgs, { role: "user", content: trimmed }];
        if (restored) {
          obs.path = `clarification_answer(restored=${restored.restoredUserText})`;
          obs.answerKind = "restored";
          const explicitScope = M.fbScope.resolveExplicitDestinationFallbackScope({ userText: restored.restoredUserText, session: nextSession, restored });
          const sessionForRec = M.fbScope.isolateSessionToExplicitDestination(
            { ...nextSession, pendingClarification: undefined, activeCategoryIntent: restored.categoryIntent },
            explicitScope ?? { destination: restored.destinationLabel, parentCity: restored.parentCity, area: restored.area, searchScope: restored.searchScope },
          );
          persistSession(sessionForRec, next);
          const applied = await pushDC(obs, sessionForRec, restored.restoredUserText, next);
          if (applied) return;
          obs.noResultsLabel = restored.destinationLabel;
          persistSession(sessionForRec, [...next, { role: "assistant", content: copyOf("noResults", { destination: restored.destinationLabel }) }]);
          return;
        }
        obs.path = "clarification_reask";
        obs.answerKind = "reask";
        obs.clarified = true;
        obs.clarificationLabel = pendingGeographic.rawGeographicLabel;
        obs.copyKind = "whichRegion";
        obs.copy = copyOf("whichRegion", { destination: pendingGeographic.rawGeographicLabel });
        persistSession(nextSession, [...next, { role: "assistant", content: obs.copy }]);
        return;
      }
    }
    if (M.cps.isReplanIntent(trimmed)) nextSession = M.cps.resetChatPlanningForReplan(nextSession, "user_replan_intent");
    // r4 probe（不影響流程）：本輪 merge 的目的地是否來自 lastAssistantReply（例如父城市確認文案）
    obs.mergeProbe = safe(
      () => ({
        before: nextSession.travelContext?.destination ?? null,
        withReply: M.tc.mergeTravelContext(nextSession, trimmed, lastAssistantReply).context.destination ?? null,
        withoutReply: M.tc.mergeTravelContext(nextSession, trimmed).context.destination ?? null,
        withoutAnyReply: M.tc.mergeTravelContext({ ...nextSession, lastAssistantReply: undefined, pendingQuestion: undefined }, trimmed).context.destination ?? null,
        pendingQuestionType: nextSession.pendingQuestion?.type ?? null,
        reply: String(lastAssistantReply ?? "").slice(0, 40),
      }),
      null,
    );
    const merged = M.tc.mergeTravelContext(nextSession, trimmed, lastAssistantReply);
    nextSession = merged.session;
    // r5-Δ3（faithful）：L8925-8930 rtStructuredNearby → resolveChatLocation（mock）
    if (FAITHFUL && nearbyShortcutTurn) nextSession = mockResolveChatLocation(nextSession);
    let providerResolvedTurnDestination;
    if (merged.context.destinationCandidate?.status === "pending") {
      phase = "global_candidate";
      nextSession = await M.gpc.resolveGlobalPlanningCandidate(nextSession, LOCALE, async (query) => {
        const response = await geocodeFn({ data: { query, destinationName: query, locale: LOCALE, disableLocaleRegionBias: true, placesFallback: false } });
        return { location: response.location, rawResultCount: response.providerResult.rawResultCount };
      });
      phase = "post";
      merged.session = nextSession;
      merged.context = nextSession.travelContext ?? merged.context;
      if (IS_WORK && merged.context.destinationCandidate?.status === "resolved") {
        providerResolvedTurnDestination = merged.context.destination;
      }
    }
    if (merged.context.destinationClarification || (merged.context.destinationCandidate && merged.context.destinationCandidate.status !== "resolved")) {
      obs.path += "advice_clarification(destinationCandidate)";
      obs.clarified = true;
      obs.copyKind = "advice";
      persistSession(nextSession, [...msgs, { role: "user", content: trimmed }, { role: "assistant", content: "advice" }]);
      return;
    }
    if (M.budget.isBudgetRefinementText(trimmed)) {
      nextSession = M.budget.applyBudgetRefinementToSession(trimmed, { ...nextSession, travelContext: merged.context });
    }
    nextSession = M.tpc.mergeTripPlanningContext(trimmed, nextSession, merged.context).session;
    const destCandidate =
      merged.context.destination?.trim() || nextSession.tripDestination?.displayLabel?.trim() || nextSession.tripDestination?.city?.trim();
    const isTripStyleSelection =
      nextSession.pendingQuestion?.type === "ask_trip_style" ||
      (M.tripStyle.parseAskTripStyleSelection(trimmed) != null && !M.numSel.rejectNumericSelection(nextSession, trimmed));
    if (!isTripStyleSelection) {
      if (nextSession.phase === "done") nextSession = M.aps.startNewPlanningSession(nextSession, "phase_done");
      else if (M.aps.shouldStartNewPlanningSession(nextSession, destCandidate)) nextSession = M.aps.startNewPlanningSession(nextSession, "destination_change");
    }
    nextSession = M.chatSession.extractPlanningHintsFromText(trimmed, nextSession);
    nextSession = M.chatSession.extractDiscoveryFromText(trimmed, nextSession);
    nextSession = M.planFlow.extractChatPlanningContextFromText(trimmed, nextSession);
    let unresolvedPlanningCandidateContext = false;
    try {
      const renderedCandidates = M.refresh.extractLatestShownCandidatesFromMsgs(msgs);
      const candidateContext = M.pcc.resolvePlanningCandidateContext(nextSession, renderedCandidates);
      const shownCandidates = candidateContext.candidates;
      let delta = M.pcc.parsePlanningConstraintDelta({
        text: trimmed,
        shownCandidates,
        authoritativeDestination: nextSession.travelContext?.destination ?? merged.context.destination ?? destCandidate,
        activePlace: nextSession.placeDetailFocus ?? (shownCandidates.length === 1 ? shownCandidates[0] : undefined),
        onStage: () => {},
      });
      delta = M.pcc.disambiguatePlanningDestinationEntity({ delta, destination: destCandidate });
      const req = M.pcc.resolvePlanningContextRequirement({
        text: trimmed,
        delta,
        candidateCount: shownCandidates.length,
        destinationDetected: Boolean(destCandidate),
        durationOrDateDetected: Boolean(merged.context.days || merged.context.startDate || merged.context.endDate),
      });
      unresolvedPlanningCandidateContext = req.requiresCandidateContext && shownCandidates.length === 0;
      if (!unresolvedPlanningCandidateContext) nextSession = M.pcc.applyPlanningConstraintDelta(nextSession, delta, shownCandidates);
      if (unresolvedPlanningCandidateContext) {
        obs.path += "planning_candidate_context_clarification";
        return;
      }
      if (delta?.acceptRemainingCandidates === true) {
        obs.path += "accept_remaining(未重建)";
        return;
      }
    } catch (e) {
      obs.path += `planning_constraint_throw:${e?.message ?? e}`;
      return;
    }
    if (M.cps.isStyleReselectTurn(trimmed, nextSession, merged.context)) {
      obs.path += "style_reselect(未重建)";
      return;
    }
    const stylePlanTurn = M.cps.shouldTriggerTripStylePlanning(trimmed, nextSession, merged.context);
    if (stylePlanTurn && (nextSession.pendingQuestion?.type === "ask_trip_style" || nextSession.chatPlanningState === "waitingStyleSelection")) {
      obs.path += "trip_style_advice(未重建)";
      return;
    }
    if (M.addAll.isAddAllToTripIntent(trimmed)) {
      obs.path += "add_all_to_trip(未重建)";
      return;
    }
    if (M.refresh.shouldAcceptAlternativeRecommendations(msgs, trimmed)) {
      obs.path += "alternative_recommendations(未重建)";
      return;
    }
    if (M.refresh.shouldRefetchPlaces(trimmed, nextSession, merged.context, msgs)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      const destForMore =
        nextSession.activeRecommendationContext?.destinationName ||
        nextSession.recommendationSession?.destination ||
        nextSession.travelContext?.destination ||
        nextSession.tripPlanningContext?.destination ||
        nextSession.tripDestination?.city;
      obs.path += `continuation:${arbitration.route}`;
      const effective = recordContinuation(obs, nextSession, destForMore);
      obs.continuationDest = effective;
      obs.searchDest = effective;
      return;
    }
    const placeFetchContext = M.mvp.mergeContextForPlaceFetch(merged.context, nextSession);
    let turnDestination;
    if (IS_WORK) {
      turnDestination = M.ctd.resolveCategoryTurnDestination({
        ctx: placeFetchContext,
        session: nextSession,
        userText: trimmed,
        locale: LOCALE,
        providerResolvedTurnDestination,
      });
      obs.turnResolution = `${turnDestination.confidence}/${turnDestination.source}`;
    }
    const weatherDest = IS_WORK
      ? placeFetchContext.destination?.trim() && !placeFetchContext.weather && turnDestination.destination
        ? turnDestination.destination
        : null
      : placeFetchContext.destination?.trim() && !placeFetchContext.weather
        ? placeFetchContext.destination
        : null;
    if (weatherDest) {
      obs.weatherDest = weatherDest;
      phase = "weather";
      const weather = await M.weather.prefetchDestinationWeather({ destination: weatherDest, locale: LOCALE, geocodeFn, fetchWeatherFn: fetchWeather });
      phase = "post";
      if (weather) nextSession = { ...nextSession, weather, travelContext: { ...(nextSession.travelContext ?? placeFetchContext), weather } };
    }
    const refreshedPlaceCtx = M.mvp.mergeContextForPlaceFetch(nextSession.travelContext ?? merged.context, nextSession);
    if (M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession)) {
      obs.path += "destination_places(未改，未重建 push)";
      obs.searchDest = refreshedPlaceCtx.destination ?? null;
      return;
    }
    const earlyCategoryPlaceQuery = M.placeIntent.shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession);
    const earlyNearbyIntent = M.chatIntent.inferNearbyIntentFromContext(refreshedPlaceCtx, trimmed, nextSession);
    const earlyRouteAuthority = M.nearbyClar.resolveChatRouteAuthority({
      // r5-Δ3：faithful 情境依 L9733-9735 使用 nearbyShortcutTurn；r4 情境維持 false（流程不變）
      structuredShortcut: FAITHFUL ? nearbyShortcutTurn : false,
      explicitNearbyRequest: M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed),
      pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
      resolvedNearbyIntent: earlyNearbyIntent,
      categoryPlaceQuery: earlyCategoryPlaceQuery,
    });
    const next = [...msgs, { role: "user", content: trimmed }];
    if (earlyRouteAuthority === "destination_category") {
      obs.path += "destination_category";
      const dest = IS_WORK
        ? (turnDestination.destination ?? "")
        : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "");
      obs.dispatchDest = dest;
      const applied = await pushDC(obs, { ...nextSession, travelContext: refreshedPlaceCtx }, trimmed, next, IS_WORK ? { turnDestination, turnStartSession } : undefined);
      if (applied) return;
      const destLabel = IS_WORK
        ? dest
        : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? dest ?? "這個目的地");
      obs.noResultsLabel = destLabel;
      msgs = [...next, { role: "assistant", content: copyOf("noResults", { destination: destLabel }) }];
      return;
    }
    if (M.refine.shouldSkipTripPlanningForRefinement(trimmed, nextSession)) {
      const arbitration = M.refine.resolveChatIntentArbitration(trimmed, nextSession);
      obs.path += `refinement:${arbitration.route}`;
      if (arbitration.route === "NEW_RECOMMENDATION") {
        if (FAITHFUL && nearbyShortcutTurn) {
          // r5-Δ3（faithful）：L9813-9920 structured nearby shortcut → resolveChatLocation + persistSession(nextSession)（pushNearby 未重建）
          nextSession = mockResolveChatLocation(nextSession);
          persistSession(nextSession);
          obs.path += "|nearby_shortcut→persist(nextSession)(pushNearby 未重建)";
          return;
        }
        const appliedNew = await pushDC(obs, { ...nextSession, travelContext: refreshedPlaceCtx }, trimmed, next, IS_WORK ? { turnDestination, turnStartSession } : undefined);
        if (appliedNew) return;
      }
      if (arbitration.route === "MORE_RECOMMENDATIONS") {
        const destForMore =
          nextSession.activeRecommendationContext?.destinationName ||
          nextSession.recommendationSession?.destination ||
          nextSession.travelContext?.destination ||
          nextSession.tripPlanningContext?.destination ||
          nextSession.tripDestination?.city;
        obs.continuationDest = recordContinuation(obs, nextSession, destForMore);
      }
      const firstTurn =
        arbitration.route === "NEW_RECOMMENDATION" && !nextSession.activeRecommendationContext && !nextSession.recommendationSession;
      if (firstTurn) {
        const destLabel = IS_WORK
          ? (turnDestination.destination ?? refreshedPlaceCtx.destination?.trim() ?? "")
          : (M.catDest.resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? refreshedPlaceCtx.destination?.trim() ?? "");
        if (destLabel) obs.noResultsLabel = destLabel;
      }
      return;
    }
    if (FAITHFUL) {
      // r5-Δ3（faithful）：L10051-10070 planning gate（下游未重建，不 persist）
      const rawCat = M.placeIntent.shouldFetchDestinationCategoryPlaces(trimmed, refreshedPlaceCtx, nextSession);
      if (
        (M.cte.isPlanningTurnActive(nextSession, merged.context) || M.convState.isDestinationPlanningSession(nextSession, merged.context)) &&
        !M.mvp.shouldFetchDestinationPlaces(trimmed, refreshedPlaceCtx, nextSession) &&
        !rawCat
      ) {
        obs.path += "|late_planning_gate(未重建)";
        return;
      }
      // L10314-10339
      const intent = M.dining.resolveChatIntent(trimmed, nextSession);
      if (intent === "destination_advice" || intent === "best_travel_time" || intent === "trip_planning") {
        nextSession = {
          ...nextSession,
          activeChatIntent: intent === "trip_planning" ? nextSession.activeChatIntent : "destination_advice",
          conversationMode: "destination_planning",
        };
      } else if (intent === "create_itinerary" && !nextSession.fromMoodFlow && !nextSession.fromMoodCard && !nextSession.homeMoodShortcutEntry) {
        nextSession = { ...nextSession, conversationMode: "destination_planning" };
      }
      const effMode = nextSession.conversationMode;
      // L10348-10381
      const inferred = rawCat
        ? M.chatIntent.inferNearbyIntentFromContext(merged.context, trimmed, nextSession)
        : (effMode === "destination_planning" ||
              effMode === "place_focus" ||
              ["destination_advice", "create_itinerary", "best_travel_time", "trip_planning"].includes(intent)) &&
            !nextSession.fromMoodFlow &&
            !nextSession.fromMoodCard &&
            !nextSession.homeMoodShortcutEntry
          ? null
          : M.chatIntent.inferNearbyIntentFromContext(merged.context, trimmed, nextSession);
      const resolvedNearbyAuth =
        (M.chatIntent.isNearbyPlaceIntent(intent) ? intent : null) ??
        (nextSession.activeChatIntent && M.chatIntent.isNearbyPlaceIntent(nextSession.activeChatIntent) ? nextSession.activeChatIntent : null) ??
        inferred;
      const lateAuthority = M.nearbyClar.resolveChatRouteAuthority({
        structuredShortcut: false, // L10375 只看本輪 normalizedShortcutFromTurn；有值時上方已 return
        explicitNearbyRequest: M.chatIntent.userExplicitlyWantsNearbyPlaces(trimmed),
        pendingNearbyLocationRequest: Boolean(nextSession.pendingNearbyLocationRequest),
        resolvedNearbyIntent: resolvedNearbyAuth,
        categoryPlaceQuery: rawCat,
      });
      const categoryPlaceQuery = lateAuthority === "destination_category";
      // L10402-10419
      if (
        M.chatIntent.isNearbyPlaceIntent(intent) ||
        nextSession.activeChatIntent === "restaurant" ||
        (nextSession.fromMoodFlow && effMode !== "destination_planning" && intent !== "destination_advice" && intent !== "trip_planning") ||
        inferred
      ) {
        nextSession = mockResolveChatLocation(nextSession);
      }
      if (inferred && !nextSession.activeChatIntent) nextSession = { ...nextSession, activeChatIntent: inferred };
      const route = safe(() => M.router.resolveChatRoute(trimmed, merged.context, nextSession, LOCALE, intent), { mode: "unknown" });
      // L10463
      persistSession(nextSession);
      obs.path += `|late:${lateAuthority}/route=${route.mode}→persist(nextSession)`;
      // r6-Δ2 故障注入：L10471 persist 後拋例外 → L10883-10901 catch：applyLocalFallback(session, trimmed, errorConversation, "state_machine_error", turnStartSession)
      if (t.fault === "throwAfterPersist") {
        obs.path += "|fault:throwAfterPersist";
        const errorConversation = [...msgs, { role: "user", content: trimmed }];
        const fb = await applyLocalFallback(obs, session, trimmed, errorConversation, "state_machine_error", turnStartSession);
        if (!fb) obs.path += "|recovery_copy";
        return;
      }
      if (route.mode === "itinerary" || M.chatSession.isUserConfirmingItinerary(trimmed)) {
        obs.path += "|itinerary(未重建)";
        return;
      }
      if (route.mode === "advice" && route.question) {
        obs.path += "|advice(未重建)";
        return;
      }
      if (route.mode === "clarify" && route.question && route.missingKey) {
        persistSession({ ...M.router.markAskedClarifyKey(nextSession, route.missingKey), pendingQuestion: route.pendingQuestion });
        obs.path += `|route_clarify(${route.missingKey})`;
        return;
      }
      // L10688-10697
      if (categoryPlaceQuery) {
        obs.path += "|late_destination_category(L10690)";
        const applied = await pushDC(obs, nextSession, trimmed, next, IS_WORK ? { turnStartSession } : undefined);
        if (applied) return;
      }
      // L10825-10837
      if (M.placeIntent.shouldBlockPlanningFallbackForCategoryQuery(trimmed, merged.context, nextSession)) {
        obs.path += "|late_block_planning(L10831)";
        const applied = await pushDC(obs, nextSession, trimmed, next, IS_WORK ? { turnStartSession } : undefined);
        if (applied) return;
      }
      if (t.fault === "streamTimeout") {
        // r6-Δ2 故障注入：L10877 streamChat(next, { …, turnStartSession }, nextSession) → AbortError → L7383-7391
        // applyLocalFallback(nextSession, trimmed, next, "ai_timeout", opts.turnStartSession)。前提：nearby（L10713）／planning（L10852）未接走（近似）
        if (resolvedNearbyAuth || inferred || M.cte.isPlanningTurnActive(nextSession, merged.context)) {
          obs.path += "|fault:streamTimeout(前提不成立：nearby/planning 分支)";
        } else {
          obs.path += "|fault:streamTimeout";
          const fb = await applyLocalFallback(obs, nextSession, trimmed, next, "ai_timeout", turnStartSession);
          if (!fb) obs.path += "|timeout_copy";
          return;
        }
      }
      obs.path += "|late_tail(nearby/streamChat 未重建)";
      return;
    }
    obs.path += `later:${earlyRouteAuthority}(未重建；planner/advice/nearby 下游)`;
    persistSession(nextSession, [...next, { role: "assistant", content: "later" }]);
  }

  const pendingKey = (p) => (p ? `${p.kind}:${p.confirmedParentCity ?? ""}:${p.rawGeographicLabel}` : null);
  const result = { tree: TREE, isWork: IS_WORK, turns: [], envScrubbed, undiciLoaded, mockKey: process.env.GOOGLE_MAPS_API_KEY, viteMockKey: process.env.VITE_GOOGLE_MAPS_API_KEY, overlayCheck };
  try {
    for (const [turnIndex, turn] of (SCENARIO.turns ?? []).entries()) {
      const t = typeof turn === "string" ? { text: turn } : turn;
      if (t.onlyIfClarified) {
        const last = result.turns.at(-1);
        if (!last || !last.clarified) continue;
      }
      const obs = newTurnObs(t.text ?? `[ui:${t.ui}]`);
      obs.turnIndex = turnIndex + TURN_OFFSET;
      obs.source = t.source ?? null;
      obs.ui = t.ui ?? null;
      obs.pendingAtStart = pendingKey(persisted.pendingClarification);
      obs.pendingAtStartLegacy = Boolean(
        persisted.pendingClarification?.kind === "destination_area" &&
          M.chatIntent.userExplicitlyWantsNearbyPlaces(persisted.pendingClarification.originalUserText ?? ""),
      );
      const g0 = geocodes.length;
      const w0 = weatherCalls.length;
      const b0 = builderCalls.length;
      const p0 = placesReqs.length;
      const c0 = creditsBegin.length;
      const s0 = creditsSettle.length;
      msgs = [...msgs];
      try {
        if (t.ui === "placeDetail") {
          // r4-Δ3：handleDiscussPlace L7550-7565（UI 操作，不經 send）
          const rec =
            persisted.recommendedPlaces?.[0] ??
            [...msgs].reverse().find((m) => m.roamie?.recommendations?.length)?.roamie?.recommendations?.[0];
          if (rec) {
            const item = { ...rec, name: rec.name ?? rec.placeName };
            const nextSession = M.pdc.enterPlaceDetailChat(persisted, item);
            persistSession(nextSession);
            msgs = [...msgs, { role: "user", content: `想聊聊 ${item.name}` }, { role: "assistant", content: safe(() => M.pdc.buildPlaceDetailReply(item, nextSession), "detail") }];
            obs.path = "ui_discuss_place";
          } else {
            obs.path = "ui_discuss_place(no rec)";
          }
        } else {
          await send(obs, t.text ?? "", t);
        }
      } catch (e) {
        obs.error = `THROW:${e?.message ?? e}`;
      }
      phase = "post";
      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);
      obs.placesQueries = placesReqs.slice(p0).map((p) => `${p.q}@${p.dest ?? "-"}`);
      obs.weatherCalls = weatherCalls.length - w0;
      obs.builderCalls = builderCalls.length - b0;
      obs.placesRequests = placesReqs.length - p0;
      obs.creditsBegin = creditsBegin.length - c0;
      obs.creditsSettle = creditsSettle.slice(s0);
      obs.sessionDest = persisted.travelContext?.destination ?? null;
      obs.sessionRecDest = persisted.recommendationSession?.destination ?? persisted.activeRecommendationContext?.destinationName ?? null;
      obs.sessionTripPlanningDest = persisted.tripPlanningContext?.destination ?? null;
      obs.sessionPreferredArea = persisted.preferredArea ?? null;
      obs.sessionTripDestCity = persisted.tripDestination?.city ?? null;
      obs.sessionTripDestLabel = persisted.tripDestination?.displayLabel ?? null;
      obs.sessionPendingLabel = persisted.pendingClarification?.rawGeographicLabel ?? null;
      obs.sessionPendingKind = persisted.pendingClarification?.kind ?? null;
      obs.sessionPendingParent = persisted.pendingClarification?.confirmedParentCity ?? null;
      obs.sessionPendingOriginal = persisted.pendingClarification?.originalUserText ?? null;
      const ap = JSON.stringify(persisted).match(/"activityPreference":"([^"]*)"/);
      obs.activityPreference = ap ? ap[1] : null;
      // r4 probe：persisted Session 中仍含「京都」字樣的欄位（找出拒絕後京都的來源）
      obs.kyotoFields = Object.entries(persisted)
        .flatMap(([k, v]) =>
          k === "travelContext" && v && typeof v === "object"
            ? Object.entries(v).map(([k2, v2]) => [`travelContext.${k2}`, v2])
            : [[k, v]],
        )
        .filter(([k, v]) => !/^(recommendedPlaces|activeShownCandidates|lastAssistantReply)$/.test(k) && JSON.stringify(v ?? null).includes("京都"))
        .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`);
      const ms = JSON.stringify(persisted).match(/"(?:mealSlot|meal|requestedMeal)":"([^"]*)"/);
      obs.sessionMealSlot = ms ? ms[1] : null;
      // r5-Δ5
      obs.sessionCtxCity = persisted.travelContext?.destinationCity ?? null;
      obs.sessionCtxRegion = persisted.travelContext?.destinationRegion ?? null;
      obs.sessionCtxCountry = persisted.travelContext?.destinationCountry ?? null;
      obs.sessionCurrentLocation = persisted.travelContext?.currentLocation ?? null;
      obs.sessionLocation = persisted.location
        ? { lat: persisted.location.lat ?? null, lng: persisted.location.lng ?? null, city: persisted.location.city ?? null }
        : null;
      result.turns.push(obs);
    }
  } catch (e) {
    result.error = `THROW:${e?.message ?? e}`;
  }
  overlayCheck.hits = [...overlayHits].sort();
  for (const k of Object.keys(orig)) console[k] = orig[k];
  result.final = { persisted, msgs };
  const fetchCalls = Object.values(ext).reduce((a, b) => a + b, 0);
  await new Promise((resolve) =>
    process.stdout.write(`\n@@P2R3_JSON@@${JSON.stringify({ result, fetchCalls, ext, fetchLog: extLog })}\n`, resolve),
  );
  process.exit(0);
}

// ════════════════════════ main ════════════════════════
const fs = await import("node:fs");
const path = await import("node:path");
const { existsSync, readFileSync } = fs;
const { spawn } = await import("node:child_process");

const head = git(["rev-parse", "HEAD"]).trim();
if (!head.startsWith(BASE_REF)) {
  console.log(`INFRA-FAIL HEAD=${head} 不是 ${BASE_REF}，overlay 方式不成立`);
  process.exit(1);
}
const OVERLAY = {
  modified: git(["diff", "--name-only", BASE_REF, "--", "src"]).split("\n").filter(Boolean),
  hidden: git(["ls-files", "--others", "--exclude-standard", "--", "src"]).split("\n").filter(Boolean),
};
// r5-Δ1：pre 樹前提檢查
const preInfra = [];
for (const [label, files] of [["pre(F6 前)", PRE_FILES], ...(WITH_PRE5 ? [["pre5(F5 前)", PRE5_FILES]] : []), ...(WITH_PRE4 ? [["pre4(F4 前)", PRE4_FILES]] : [])]) {
  for (const [rel, file] of Object.entries(files)) {
    if (!existsSync(file)) preInfra.push(`${label} 備份不存在：${file}`);
    else if (readFileSync(file, "utf8") === readFileSync(`${WORK_ROOT}/${rel}`, "utf8")) preInfra.push(`${label} 備份與現行 ${rel} 相同（修改未生效？）`);
  }
}
const geoPre = `${PRE_DIR}/destination-geographic-clarification.pre-F4.ts`;
if (existsSync(geoPre) && readFileSync(geoPre, "utf8") !== readFileSync(`${WORK_ROOT}/src/lib/ai/destination-geographic-clarification.ts`, "utf8")) {
  preInfra.push("destination-geographic-clarification.ts 在 F4 前後不同（pre overlay 需補上）");
}
// r5-Δ1：F5 開始前的 sha 快照 → F5 只改了 2 檔（其餘 src 與 pre 樹相同，pre overlay 才成立）
const shaDiff = [];
{
  const { createHash } = await import("node:crypto");
  if (!existsSync(PRE_SHA_SNAPSHOT)) preInfra.push(`pre sha 快照不存在：${PRE_SHA_SNAPSHOT}`);
  else {
    const snapLines = readFileSync(PRE_SHA_SNAPSHOT, "utf8").split("\n").filter(Boolean);
    for (const line of snapLines) {
      const m = line.match(/^([0-9a-f]{40})\s+(.+)$/);
      if (!m) continue;
      const f = `${WORK_ROOT}/${m[2]}`;
      const now = existsSync(f) ? createHash("sha1").update(readFileSync(f)).digest("hex") : "(missing)";
      if (now !== m[1]) shaDiff.push(m[2]);
    }
    const expected = new Set(Object.keys(PRE_FILES));
    const unexpected = shaDiff.filter((f) => !expected.has(f));
    if (unexpected.length) preInfra.push(`F5 開始後除 2 檔外還有 src 變動：${unexpected.join(", ")}`);
    for (const f of expected) if (!shaDiff.includes(f)) preInfra.push(`sha 快照顯示 ${f} 未被 F5 修改`);
    for (const [rel, file] of Object.entries(PRE_FILES)) {
      const want = snapLines.find((l) => l.endsWith(`  ${rel}`))?.slice(0, 40);
      const got = createHash("sha1").update(readFileSync(file)).digest("hex");
      if (want && want !== got) preInfra.push(`pre 備份 ${file} 與 sha 快照不符（want=${want} got=${got}）`);
    }
  }
}
if (preInfra.length) {
  console.log(["INFRA-FAIL pre tree", ...preInfra].join("\n"));
  process.exit(1);
}

// ── source anchors（r4-Δ5 / r5-Δ4）──
const R3_WORK_ANCHORS = [
  '} from "@/lib/ai/chat-turn-destination";',
  "const turnDestination = await validateCategoryTurnDestination(",
  "opts?.turnDestination ??",
  "const clarificationPlan = planCategoryTurnClarification(turnDestination);",
  "if (clarificationPlan && opts?.fromClarification) {",
  '? chatRuntimeCopy("parentScopeConfirm", locale, { destination: clarificationLabel })',
  ': chatRuntimeCopy("whichRegion", locale, { destination: clarificationLabel });',
  "const sessionDestinationForClarification = confirmedContextDestination(",
  "? buildPendingParentScopeClarification({",
  "rawGeographicLabel: turnDestination.rawLabel ?? clarificationLabel,",
  "const destination = turnDestination.destination;",
  'metadata: { path: "destination_category", destination, intents },',
  'if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {',
  'parseParentScopeConfirmationAnswer(trimmed) === "confirm"',
  "resolveParentScopeSearchUserText(pendingGeographic, confirmedParentCity),",
  "turnDestination: resolveConfirmedParentScopeTurnDestination(confirmedParentCity),",
  'if (pendingGeographic?.kind === "destination_area" && !nearbyShortcutTurn) {',
  ": restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
  "{ fromClarification: true },",
  "providerResolvedTurnDestination = merged.context.destination;",
  "const turnDestination = resolveCategoryTurnDestination({",
  "destination: turnDestination.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
  'const dest = turnDestination.destination ?? "";',
  "{ turnDestination },",
  "const destLabel = dest;\n        setMsgs((prev) => [",
  'turnDestination.destination ?? refreshedPlaceCtx.destination?.trim() ?? "";',
  "const sessionWithoutUnconfirmed = withoutUnconfirmedSessionDestinations(merged.session);",
  "...sessionWithoutUnconfirmed,",
  "(isParentScopeCityEchoAnswer(trimmed, confirmedParentCity) ||",
  "(!isPlaceClarificationTripPlanningOverride(trimmed) &&\n            (isAffirmativeReply(trimmed) ||\n              parseParentScopeConfirmationAnswer(trimmed) === \"confirm\")))",
  "const storedSession = sessionRef.current;\n      if (storedSession.pendingClarification) {\n        persistSession({ ...storedSession, pendingClarification: undefined });",
  "if (isUnconfirmedSearchDestination(destination, activeSession)) {",
  "if (!dest || !topic || isUnconfirmedSearchDestination(dest, sessionForSearch)) return false;",
];
const R4_EARLY_ANCHORS = [
  "if (!trimmed || streaming || generating) return;",
  "if (rejectNumericSelection(session, trimmed)) {",
  "persistSession(discardExpiredSelection(session), conversation);",
  "/^(重新整理推薦|重新整理)$/.test(trimmed) ||",
  "persistSession(refreshedSession);",
  "if (isPlaceDetailChatActive(session)) {",
  "let nextSession = enterPlaceDetailChat(session, session.placeDetailFocus!);",
  "const nextSession = enterPlaceDetailChat(session, item);",
  "const pendingGeographic = nextSession.pendingClarification;",
];
const R4_EARLY_ANCHORS_F3 = [
  'if (!destination || !days) {\n        toast.message(uiT("productionUi.p9d3f69840f"));\n        return;',
  "nearbyShortcutTurn =\n      nextSession.normalizedShortcutRequest?.structured === true &&",
  "pendingClarification: undefined,\n        conversationMode: undefined,",
  'if (opts?.source === undefined || opts.source === "user" || opts.source === "chat_shortcut") {',
];
const F4_WORK_ANCHORS = [
  "  confirmedDestinationLabelOrUndefined,\n  isUnconfirmedSearchDestination,",
  "const sessionWithoutUnconfirmed = withoutUnconfirmedSessionDestinations(\n          merged.session,\n          sessionRef.current,\n        );",
  "...(opts?.fromClarification && merged.session.preferredArea",
  "confirmedDestinationLabelOrUndefined(\n                    merged.session.preferredArea,\n                    merged.session,\n                  ) ?? destination,",
  'const turnPendingGeographic =\n      (opts?.source === undefined || opts.source === "user") &&\n      session.pendingClarification &&',
  'session.pendingClarification.kind === "destination_area" &&\n        userExplicitlyWantsNearbyPlaces(session.pendingClarification.originalUserText ?? "")',
  "if (turnPendingGeographic) {\n      session = { ...session, pendingClarification: undefined };\n      const storedSession = sessionRef.current;",
  "const sessionForTurn: ChatPlanningSession = turnPendingGeographic\n      ? { ...session, pendingClarification: turnPendingGeographic }\n      : session;",
  "...sessionForTurn,\n          explicitNearbyKeyword",
  ": applyTripIntentToSession(trimmed, sessionForTurn);",
];
// r5-Δ4：F5 anchors（work）與 faithful 模式所重建的原始碼（work / pre）
const F5_WORK_ANCHORS = [
  "/** The persisted session at send() start (pending consumed), before any mid-turn persist. */\n        turnStartSession?: ChatPlanningSession;",
  "const sessionWithoutUnconfirmed = withoutUnconfirmedSessionDestinations(\n          merged.session,\n          opts?.turnStartSession ?? sessionRef.current,\n        );",
  "travelContext: sessionWithoutUnconfirmed.travelContext\n              ? {\n                  ...sessionWithoutUnconfirmed.travelContext,\n                  destination: sessionDestinationForClarification,\n                }\n              : sessionWithoutUnconfirmed.travelContext,",
  "const turnStartSession: ChatPlanningSession = {\n      ...sessionRef.current,\n      pendingClarification: undefined,\n    };",
  "if (nearbyShortcutTurn && turnPendingGeographic && nextSession.pendingClarification) {\n      // The handlers below are skipped: the pending consumed at turn start must not ride on\n      // nextSession into a later persistSession(nextSession) and be revived from storage.\n      nextSession = { ...nextSession, pendingClarification: undefined };\n    }",
  "{ turnDestination, turnStartSession },",
  "next,\n          { turnStartSession },\n        );",
];
const FAITHFUL_ANCHORS = [
  'structuredShortcut:\n          nextSession.normalizedShortcutRequest?.structured === true &&\n          nextSession.normalizedShortcutRequest.intent === "nearby_recommendation",',
  "if (rtStructuredNearby) {\n      nextSession = await resolveChatLocation(nextSession);\n    }",
  "if (structuredNearbyShortcut) {\n            nextSession = await resolveChatLocation(nextSession);\n            persistSession(nextSession);",
  "structuredShortcut: Boolean(normalizedShortcutFromTurn?.structured),",
  'const categoryPlaceQuery = selectedRouteAuthority === "destination_category";',
  'persistSession(nextSession);\n\n      const next: ChatMsg[] = [...msgs, { role: "user", content: displayMessage }];',
  'if (categoryPlaceQuery) {\n        logNearbyDispatchSkip("destination_category_selected", "destination_category_dispatch");\n        const applied = await pushDestinationCategoryPlaceRecommendation(',
  "if (shouldBlockPlanningFallbackForCategoryQuery(trimmed, merged.context, nextSession)) {",
  'if (route.mode === "clarify" && route.question && route.missingKey) {',
];
const R4_WORK_ANCHORS = [
  ...R3_WORK_ANCHORS.filter((a) => a !== "const sessionWithoutUnconfirmed = withoutUnconfirmedSessionDestinations(merged.session);"),
  ...F4_WORK_ANCHORS,
  ...R4_EARLY_ANCHORS,
  ...R4_EARLY_ANCHORS_F3,
];
const ANCHORS = {
  // r5-Δ4：F5 改了文字的 2 條（"{ turnDestination }," 與 F4 的 sessionRef.current 版）自 work 移除，由 F5_WORK_ANCHORS 取代
  work: [...R4_WORK_ANCHORS.filter((a) => a !== "{ turnDestination }," && a !== F4_WORK_ANCHORS[1]), ...F5_WORK_ANCHORS, ...FAITHFUL_ANCHORS],
  // r5-Δ4：pre = F5 前備份，沿用 r4 的 work anchors
  pre: [...R4_WORK_ANCHORS, ...FAITHFUL_ANCHORS],
  // pre4 = F4 前備份，沿用 r4 的 pre anchors
  pre4: [...R3_WORK_ANCHORS, ...R4_EARLY_ANCHORS, ...R4_EARLY_ANCHORS_F3],
  base: [
    "const provisionalArea = extractProvisionalDestinationAreaCandidate(userText);",
    "const validatedAreaScope = await resolveValidatedDestinationAreaScope({",
    "const destination = validatedAreaScope?.displayLabel ?? baseDestination;",
    "destination: placeFetchContext.destination,\n          locale,\n          geocodeFn: geocodeLocationFn,\n          fetchWeatherFn: fetchWeather,",
    'resolveDestinationForCategorySearch(refreshedPlaceCtx, nextSession, trimmed) ?? "";',
    "const restored = restorePlaceIntentAfterGeographicClarification(pendingGeographic, trimmed);",
    'metadata: { path: "destination_category", destination, intents },',
    ...R4_EARLY_ANCHORS,
  ],
};
// r6-Δ4：F6 anchors（work）；pre（F6 前）= r5 work anchors；pre5（F5 前）= r5 pre anchors
const F6_WORK_ANCHORS = [
  "/** send()'s turnStartSession: the clarification cleanup base (never a mid-turn persist). */\n      turnStartSession?: ChatPlanningSession,",
  "if (isPlaceDetailChatActive(activeSession)) {\n        return false;\n      }",
  "sourcePath: \"destination-category-retry\",",
  "const applied = await pushDestinationCategoryPlaceRecommendation(\n            scopedSession,\n            activeUserText,\n            conversation,\n            { turnStartSession },\n          );",
  "/** send()'s turnStartSession, forwarded to applyLocalFallback. */\n        turnStartSession?: ChatPlanningSession;",
  "\"ai_timeout\",\n            opts?.turnStartSession,",
  "\"ai_reply_failed\",\n          opts?.turnStartSession,",
  "\"destination_places_failed\",\n          turnStartSession,",
  "\"places_empty\",\n            turnStartSession,",
  "\"planning_no_reply\",\n          turnStartSession,",
  "{ phase: route.chatPhase, userText: trimmed, turnStartSession },",
  "const fallbackApplied = await applyLocalFallback(\n          session,\n          trimmed,\n          errorConversation,\n          \"state_machine_error\",\n          turnStartSession,",
];
ANCHORS.pre5 = ANCHORS.pre;
ANCHORS.pre = ANCHORS.work;
ANCHORS.work = [...ANCHORS.work, ...F6_WORK_ANCHORS];
const SRC = {
  work: readFileSync(`${WORK_ROOT}/src/routes/_app.chat.tsx`, "utf8"),
  pre: readFileSync(PRE_FILES["src/routes/_app.chat.tsx"], "utf8"),
  ...(WITH_PRE5 ? { pre5: readFileSync(PRE5_FILES["src/routes/_app.chat.tsx"], "utf8") } : {}),
  base: gitShow("src/routes/_app.chat.tsx"),
  ...(WITH_PRE4 ? { pre4: readFileSync(PRE4_FILES["src/routes/_app.chat.tsx"], "utf8") } : {}),
};
const anchorFail = [];
const anchorLines = [];
const lineOf = (src, a) => {
  const lines = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf(a, from);
    if (i < 0) break;
    lines.push(src.slice(0, i).split("\n").length);
    from = i + 1;
  }
  return lines;
};
for (const tree of ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])]) {
  const src = SRC[tree];
  for (const a of ANCHORS[tree]) {
    if (!src.includes(a)) {
      anchorFail.push(`${tree}: anchor missing → ${a.split("\n")[0]}`);
      continue;
    }
    anchorLines.push(`${tree} L${lineOf(src, a).join(",")} :: ${a.split("\n")[0].slice(0, 100)}`);
  }
}
// r4-Δ5：work 中 F4 區塊順序（早期消費 → 所有 early return → sessionForTurn → pending handler）
{
  const src = SRC.work;
  const seq = [
    ["sendStart", "const send = async ("],
    ["noop", "if (!trimmed || streaming || generating) return;"],
    ["earlyConsume", "const turnPendingGeographic ="],
    ["rejectNumeric", "if (rejectNumericSelection(session, trimmed)) {"],
    ["refresh", "/^(重新整理推薦|重新整理)$/.test(trimmed) ||"],
    ["placeDetail", "if (isPlaceDetailChatActive(session)) {"],
    ["sessionForTurn", "const sessionForTurn: ChatPlanningSession = turnPendingGeographic"],
    ["pendingGeographic", "const pendingGeographic = nextSession.pendingClarification;"],
  ];
  const pos = seq.map(([k, a]) => [k, src.indexOf(a)]);
  for (let i = 1; i < pos.length; i += 1) {
    if (pos[i][1] < 0 || pos[i][1] < pos[i - 1][1]) anchorFail.push(`work: 區塊順序錯誤 ${pos[i - 1][0]} → ${pos[i][0]}`);
  }
  const consumeAt = src.indexOf("const turnPendingGeographic =");
  const sendAt = src.indexOf("const send = async (");
  const between = src.slice(sendAt, consumeAt);
  anchorLines.push(`work send() 開頭到早期消費點之間的 return 數：${(between.match(/\breturn\b/g) ?? []).length}（L${src.slice(0, sendAt).split("\n").length}-L${src.slice(0, consumeAt).split("\n").length}）`);
}
// r5-Δ4：F5 呼叫點次數 / 位置 / 順序
{
  const src = SRC.work;
  const count = (a) => src.split(a).length - 1;
  const calls = lineOf(src, "pushDestinationCategoryPlaceRecommendation(").filter((l) => l > 5700);
  anchorLines.push(`work pushDestinationCategoryPlaceRecommendation 呼叫點：L${calls.join(",")}`);
  if (count("{ turnDestination, turnStartSession },") !== 2) anchorFail.push(`work: "{ turnDestination, turnStartSession }," 次數=${count("{ turnDestination, turnStartSession },")}（預期 2）`);
  if (count("{ turnStartSession },") !== 3) anchorFail.push(`work: "{ turnStartSession }," 次數=${count("{ turnStartSession },")}（預期 3；r6：F6 新增 L6728 retry）`);
  if (count("{ turnDestination },") !== 0) anchorFail.push(`work: "{ turnDestination }," 仍有 ${count("{ turnDestination },")} 處`);
  const lines = src.split("\n");
  const withStart = calls.filter((l) => lines.slice(l - 1, l + 5).join("\n").includes("turnStartSession"));
  const without = calls.filter((l) => !lines.slice(l - 1, l + 5).join("\n").includes("turnStartSession"));
  anchorLines.push(`work 傳入 turnStartSession 的呼叫點：L${withStart.join(",")}；未傳入：L${without.join(",")}`);
  const seq = [
    ["earlyConsume", "const turnPendingGeographic ="],
    ["turnStartSession", "const turnStartSession: ChatPlanningSession = {"],
    ["rejectNumeric", "if (rejectNumericSelection(session, trimmed)) {"],
    ["sessionForTurn", "const sessionForTurn: ChatPlanningSession = turnPendingGeographic"],
    ["nearbyShortcutTurn", "const nearbyShortcutTurn ="],
    ["f5Strip", "if (nearbyShortcutTurn && turnPendingGeographic && nextSession.pendingClarification) {"],
    ["parentHandler", 'if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {'],
    ["L10463", 'persistSession(nextSession);\n\n      const next: ChatMsg[] = [...msgs, { role: "user", content: displayMessage }];'],
    ["L10690", 'logNearbyDispatchSkip("destination_category_selected", "destination_category_dispatch");'],
  ];
  const pos = seq.map(([k, a]) => [k, src.indexOf(a)]);
  for (let i = 1; i < pos.length; i += 1) {
    if (pos[i][1] < 0 || pos[i][1] < pos[i - 1][1]) anchorFail.push(`work: F5 區塊順序錯誤 ${pos[i - 1][0]} → ${pos[i][0]}`);
  }
}
// r6-Δ4：F6 呼叫點（applyLocalFallback / streamChat 是否傳 turnStartSession）、retry 位置、pre（F6 前）沿用 r5 次數
{
  const src = SRC.work;
  const lines = src.split("\n");
  const near = (l, n) => lines.slice(l - 1, l + n).join("\n");
  const fb = lineOf(src, "await applyLocalFallback(");
  const fbWith = fb.filter((l) => /turnStartSession/.test(near(l, 7)));
  anchorLines.push(`work applyLocalFallback 呼叫點：L${fb.join(",")}；傳 turnStartSession：L${fbWith.join(",")}；未傳：L${fb.filter((l) => !fbWith.includes(l)).join(",") || "(none)"}`);
  if (fb.length !== 6 || fbWith.length !== 6) anchorFail.push(`work: applyLocalFallback 呼叫點=${fb.length} 傳 turnStartSession=${fbWith.length}（預期 6/6）`);
  const sc = lineOf(src, "await streamChat(");
  const scWith = sc.filter((l) => /turnStartSession/.test(near(l, 6)));
  anchorLines.push(`work streamChat 呼叫點：L${sc.join(",")}；傳 turnStartSession：L${scWith.join(",")}；未傳：L${sc.filter((l) => !scWith.includes(l)).join(",") || "(none)"}`);
  if (sc.length !== 3 || scWith.length !== 1) anchorFail.push(`work: streamChat 呼叫點=${sc.length} 傳 turnStartSession=${scWith.length}（預期 3/1）`);
  const retryAt = src.indexOf('sourcePath: "destination-category-retry",');
  const firstTs = src.indexOf("{ turnStartSession },");
  const sendAt = src.indexOf("const send = async (");
  if (!(retryAt > 0 && retryAt < firstTs && firstTs < sendAt)) anchorFail.push(`work: F6 retry 的 { turnStartSession } 不在 applyLocalFallback 內（retry=${retryAt} first=${firstTs} send=${sendAt}）`);
  anchorLines.push(`work 第一個 "{ turnStartSession }," 位於 L${src.slice(0, firstTs).split("\n").length}（applyLocalFallback destination-category-retry）`);
  const cpre = (a) => SRC.pre.split(a).length - 1;
  if (cpre("{ turnStartSession },") !== 2) anchorFail.push(`pre(F6 前): "{ turnStartSession }," 次數=${cpre("{ turnStartSession },")}（預期 2，同 r5 work）`);
  if (cpre("{ turnDestination, turnStartSession },") !== 2) anchorFail.push(`pre(F6 前): "{ turnDestination, turnStartSession }," 次數=${cpre("{ turnDestination, turnStartSession },")}（預期 2）`);
  if (SRC.pre.includes("opts?.turnStartSession,\n")) anchorFail.push("pre(F6 前) 已含 F6 的 opts?.turnStartSession 轉傳（備份錯誤？）");
}
if (anchorFail.length) {
  console.log(["INFRA-FAIL source anchors", ...anchorFail].join("\n"));
  process.exit(1);
}

// ── 模組依賴圖（同 r3）──
function diskFiles() {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) files.push(f);
    }
  };
  walk(path.join(WORK_ROOT, "src"));
  return files;
}
const workFiles = diskFiles();
const WORK_VIEW = {
  files: workFiles,
  exists: (f) => existsSync(f) && fs.statSync(f).isFile(),
  read: (f) => readFileSync(f, "utf8"),
};
const hiddenAbs = new Set(OVERLAY.hidden.map((r) => path.join(WORK_ROOT, r)));
const baseModified = new Map();
for (const rel of OVERLAY.modified) {
  try {
    baseModified.set(path.join(WORK_ROOT, rel), gitShow(rel));
  } catch {
    hiddenAbs.add(path.join(WORK_ROOT, rel));
  }
}
const baseFileSet = new Set([...workFiles.filter((f) => !hiddenAbs.has(f)), ...[...baseModified.keys()].filter((f) => /\.(ts|tsx)$/.test(f) && !/\.d\.ts$/.test(f))]);
const BASE_VIEW = {
  files: [...baseFileSet],
  exists: (f) => baseFileSet.has(f) || (!hiddenAbs.has(f) && existsSync(f) && fs.statSync(f).isFile()),
  read: (f) => baseModified.get(f) ?? readFileSync(f, "utf8"),
};
function buildGraph(view, { runtimeOnly }) {
  const resolveImport = (spec, from) => {
    let b;
    if (spec.startsWith("@/")) b = path.join(WORK_ROOT, "src", spec.slice(2));
    else if (spec.startsWith(".")) b = path.resolve(path.dirname(from), spec);
    else return null;
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const f = b + ext;
      if (view.exists(f)) return f;
    }
    return null;
  };
  const graph = new Map();
  for (const f of view.files) {
    const s = view.read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const deps = new Set();
    const re = /(import|export)\s+(type\s+)?([^"';]*?)from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
    for (const m of s.matchAll(re)) {
      const spec = m[4] ?? m[5] ?? m[6];
      if (runtimeOnly && m[2]) continue;
      if (runtimeOnly && m[3] && /^\{\s*(?:type\s+[\w$]+\s*(?:as\s+[\w$]+\s*)?,?\s*)+\}\s*$/.test(m[3].trim())) continue;
      const r = resolveImport(spec, f);
      if (r) deps.add(r);
    }
    graph.set(f, deps);
  }
  return graph;
}
function sccs(graph) {
  let index = 0;
  const idx = new Map();
  const low = new Map();
  const stack = [];
  const on = new Set();
  const out = [];
  const strong = (v) => {
    const work = [[v, [...(graph.get(v) ?? [])], 0]];
    idx.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    on.add(v);
    while (work.length) {
      const top = work[work.length - 1];
      const [node, deps] = top;
      if (top[2] < deps.length) {
        const w = deps[top[2]++];
        if (!graph.has(w)) continue;
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index);
          index += 1;
          stack.push(w);
          on.add(w);
          work.push([w, [...(graph.get(w) ?? [])], 0]);
        } else if (on.has(w)) low.set(node, Math.min(low.get(node), idx.get(w)));
      } else {
        work.pop();
        if (work.length) {
          const parent = work[work.length - 1][0];
          low.set(parent, Math.min(low.get(parent), low.get(node)));
        }
        if (low.get(node) === idx.get(node)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            on.delete(w);
            comp.push(w);
          } while (w !== node);
          if (comp.length > 1 || (graph.get(node) ?? new Set()).has(node)) out.push(comp);
        }
      }
    }
  };
  for (const v of graph.keys()) if (!idx.has(v)) strong(v);
  return out;
}
function closure(graph, start) {
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const f = q.shift();
    for (const d of graph.get(f) ?? []) if (!seen.has(d)) (seen.add(d), q.push(d));
  }
  return seen;
}
const graphReport = [];
const graphP1 = [];
const WATCH = [
  "src/lib/ai/chat-turn-destination.ts",
  "src/lib/ai/destination-resolution.ts",
  "src/lib/ai/destination-geographic-clarification.ts",
  "src/lib/i18n/chat-runtime.ts",
  "src/lib/ai/chat-category-destination.ts",
  "src/routes/_app.chat.tsx",
];
graphReport.push(`base overlay：modified=${OVERLAY.modified.length}（${OVERLAY.modified.join(", ")}） hidden(untracked src)=${OVERLAY.hidden.length}（${OVERLAY.hidden.join(", ")}）`);
for (const runtimeOnly of [true, false]) {
  const label = runtimeOnly ? "runtime（排除 import type）" : "all（含 import type）";
  const wg = buildGraph(WORK_VIEW, { runtimeOnly });
  const bg = buildGraph(BASE_VIEW, { runtimeOnly });
  const key = (comp) => comp.map((f) => path.relative(WORK_ROOT, f)).sort().join("|");
  const ws = sccs(wg).map((c) => key(c));
  const bs = new Set(sccs(bg).map((c) => key(c)));
  const added = ws.filter((k) => !bs.has(k));
  const touching = ws.filter((k) => WATCH.some((w) => k.split("|").includes(w)));
  graphReport.push(`${label}: work SCC(循環)=${ws.length} base=${bs.size} 新增=${added.length} 含本次相關模組=${touching.length}`);
  for (const k of added) {
    graphReport.push(`  + 新增循環: ${k.split("|").slice(0, 8).join(" ↔ ")}${k.split("|").length > 8 ? ` …(${k.split("|").length})` : ""}`);
    if (runtimeOnly || touching.includes(k)) graphP1.push(`循環 import（${label}）: ${k.split("|").slice(0, 8).join(" ↔ ")}`);
  }
  for (const k of touching) if (!added.includes(k)) graphReport.push(`  ! 既有循環含相關模組: ${k.slice(0, 200)}`);
  const router = path.join(WORK_ROOT, "src/lib/ai/chat-intent-router.ts");
  const cl = closure(wg, router);
  for (const mod of ["src/lib/ai/chat-turn-destination.ts", "src/lib/ai/destination-resolution.ts"]) {
    const inChain = cl.has(path.join(WORK_ROOT, mod));
    graphReport.push(`  chat-intent-router 依賴鏈（${label}，${cl.size} 檔）含 ${mod}: ${inChain ? "是" : "否"}`);
    if (inChain && mod.endsWith("chat-turn-destination.ts")) graphP1.push(`chat-intent-router 依賴鏈 import 了 ${mod}（${label}）`);
  }
  const importers = [...wg.entries()].filter(([, d]) => d.has(path.join(WORK_ROOT, "src/lib/ai/chat-turn-destination.ts"))).map(([f]) => path.relative(WORK_ROOT, f));
  graphReport.push(`  chat-turn-destination.ts 的 importer（${label}）: ${importers.join(", ") || "(none)"}`);
}

// ── 情境（r3 / r4 原樣）──
const ANS = (text) => ({ text, onlyIfClarified: true });
const T27_SCENARIOS = [
  { id: "01a", label: "京都看楓葉", turns: ["京都看楓葉", ANS("京都")] },
  { id: "01b", label: "京都看楓葉推薦景點", turns: ["京都看楓葉推薦景點", ANS("京都")] },
  { id: "02a", label: "北海道滑雪", turns: ["北海道滑雪", ANS("北海道")] },
  { id: "02b", label: "北海道滑雪推薦景點", turns: ["北海道滑雪推薦景點", ANS("北海道")] },
  { id: "03a", label: "沖繩潛水", turns: ["沖繩潛水", ANS("沖繩")] },
  { id: "03b", label: "沖繩潛水推薦景點", turns: ["沖繩潛水推薦景點", ANS("沖繩")] },
  { id: "04a", label: "奈良看鹿", turns: ["奈良看鹿", ANS("奈良")] },
  { id: "04b", label: "奈良看鹿景點推薦", turns: ["奈良看鹿景點推薦", ANS("奈良")] },
  { id: "05a", label: "金澤看兼六園", turns: ["金澤看兼六園", ANS("金澤")] },
  { id: "05b", label: "金澤看兼六園推薦景點", turns: ["金澤看兼六園推薦景點", ANS("金澤")] },
  { id: "06a", label: "花蓮泛舟", turns: ["花蓮泛舟", ANS("花蓮")] },
  { id: "06b", label: "花蓮泛舟推薦景點", turns: ["花蓮泛舟推薦景點", ANS("花蓮")] },
  { id: "07a", label: "香港跑馬地", turns: ["香港跑馬地", ANS("香港")] },
  { id: "07b", label: "香港跑馬地美食", turns: ["香港跑馬地美食", ANS("香港")] },
  { id: "08a", label: "台南看西街教會", turns: ["台南看西街教會", ANS("台南")] },
  { id: "08b", label: "台南看西街教會推薦景點", turns: ["台南看西街教會推薦景點", ANS("台南")] },
  { id: "09a", label: "新竹潛園", turns: ["新竹潛園", ANS("新竹")] },
  { id: "09b", label: "新竹潛園推薦景點", turns: ["新竹潛園推薦景點", ANS("新竹")] },
  { id: "10a", label: "千葉釣崎海岸", turns: ["千葉釣崎海岸", ANS("千葉")] },
  { id: "10b", label: "千葉釣崎海岸推薦景點", turns: ["千葉釣崎海岸推薦景點", ANS("千葉")] },
  { id: "11a", label: "東京玩具美術館", turns: ["東京玩具美術館", ANS("東京")] },
  { id: "11b", label: "東京玩具美術館推薦景點", turns: ["東京玩具美術館推薦景點", ANS("東京")] },
  { id: "12a", label: "台北士林夜市", turns: ["台北士林夜市", ANS("台北")] },
  { id: "12b", label: "台北士林夜市美食", turns: ["台北士林夜市美食", ANS("台北")] },
  { id: "13", label: "京都推薦景點", turns: ["京都推薦景點"] },
  { id: "14", label: "京都三天行程（Planner）", turns: ["京都三天行程"] },
  { id: "15a", label: "跨城市 京都→大阪", turns: ["京都推薦景點", "大阪推薦景點"] },
  { id: "15b", label: "跨城市 京都→大阪美食", turns: ["京都推薦景點", "大阪美食"] },
  { id: "15c", label: "Session 京都→新指定 台中西屯美食", turns: ["京都推薦景點", "台中西屯美食"] },
  { id: "15d", label: "Session 京都→未確認 奈良看鹿景點推薦", turns: ["京都推薦景點", "奈良看鹿景點推薦", ANS("奈良")] },
  { id: "16a", label: "Continuation 京都→再推薦幾個", turns: ["京都推薦景點", "再推薦幾個"] },
  { id: "16b", label: "Continuation 京都→再推薦幾個→還有嗎", turns: ["京都推薦景點", "再推薦幾個", "還有嗎"] },
  { id: "20a", label: "Session 保存 台中西屯美食→再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"] },
  { id: "20b", label: "Session 保存 台中西屯推薦景點→再推薦幾個", turns: ["台中西屯推薦景點", "再推薦幾個"] },
  { id: "X1", label: "京都冷門景點", turns: ["京都冷門景點", ANS("京都")] },
  { id: "X2", label: "埔里咖啡廳（無父城市）", turns: ["埔里咖啡廳", ANS("南投")] },
  { id: "X3", label: "全球城市（global candidate）我想去里斯本→推薦景點", turns: ["我想去里斯本", "推薦景點"] },
  { id: "X4", label: "里斯本推薦景點（未列表城市）", turns: ["里斯本推薦景點", ANS("葡萄牙")] },
  { id: "X5", label: "京都推薦景點→京都看楓葉推薦景點（Session 內）", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("京都")] },
  { id: "X6", label: "Session 沿用 京都→推薦咖啡廳", turns: ["京都推薦景點", "推薦咖啡廳"] },
  { id: "X7", label: "Session 沿用 京都→那咖啡廳呢", turns: ["京都推薦景點", "那咖啡廳呢"] },
  { id: "X8", label: "Session 沿用 京都→再推薦幾個咖啡廳", turns: ["京都推薦景點", "再推薦幾個咖啡廳"] },
  { id: "X9", label: "Session 沿用（已驗證區）台中西屯美食→推薦咖啡廳", turns: ["台中西屯美食", "推薦咖啡廳"] },
  { id: "X10", label: "Session 沿用（已驗證區）香港跑馬地美食→推薦景點", turns: ["香港跑馬地美食", "推薦景點"] },
  { id: "R1", label: "重新載入後 台中西屯美食→推薦咖啡廳", turns: ["台中西屯美食", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R2", label: "重新載入後 香港跑馬地美食→推薦景點", turns: ["香港跑馬地美食", "推薦景點"], reloadAfter: 0 },
  { id: "R3", label: "重新載入後 京都推薦景點→推薦咖啡廳（對照）", turns: ["京都推薦景點", "推薦咖啡廳"], reloadAfter: 0 },
  { id: "R4", label: "重新載入後 台中西屯美食→再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"], reloadAfter: 0 },
  { id: "R5", label: "重新載入後 我想去里斯本→推薦景點（global candidate）", turns: ["我想去里斯本", "推薦景點"], reloadAfter: 0 },
  { id: "G1", label: "全球城市同輪 我想去里斯本，推薦景點", turns: ["我想去里斯本，推薦景點"] },
  { id: "G2", label: "全球城市同輪 里斯本有什麼景點推薦", turns: ["里斯本有什麼景點推薦"] },
  { id: "G3", label: "全球城市同輪 想去波爾圖，有推薦的咖啡廳嗎", turns: ["想去波爾圖，有推薦的咖啡廳嗎"] },
];
const T27_IDS = new Set(T27_SCENARIOS.map((s) => s.id));
const GIB = "嗯嗯哈哈";
const NEW_SCENARIOS = [];
for (const [code, parent, raw] of [["K", "京都", "京都看楓葉"], ["H", "北海道", "北海道滑雪"], ["N", "奈良", "奈良看鹿"], ["F", "花蓮", "花蓮泛舟"]]) {
  for (const [a, ans] of [["ok", "好"], ["yes", "是"], ["no", "不用"], ["gib", GIB]]) {
    const confirm = a === "ok" || a === "yes";
    NEW_SCENARIOS.push({
      id: `N-${code}-${a}`,
      label: `${raw}推薦景點 → 「${ans}」`,
      turns: [`${raw}推薦景點`, ANS(ans)],
      expect: { parent, raw, parentAsk: { turn: 0, parent }, ...(confirm ? { confirm: { turn: 1, parent } } : { cleared: { turn: 1, parent } }) },
    });
  }
}
NEW_SCENARIOS.push(
  { id: "N-meal-ok", label: "京都看楓葉晚餐推薦 → 好（Places query 不得含京都看楓葉）", turns: ["京都看楓葉晚餐推薦", ANS("好")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, meal: { turn: 1, slot: "dinner" } } },
  { id: "N-meal-yes", label: "京都看楓葉晚餐推薦 → 是", turns: ["京都看楓葉晚餐推薦", ANS("是")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, meal: { turn: 1, slot: "dinner" } } },
  { id: "N-meal-H", label: "北海道滑雪午餐推薦 → 好", turns: ["北海道滑雪午餐推薦", ANS("好")], expect: { parent: "北海道", raw: "北海道滑雪", parentAsk: { turn: 0, parent: "北海道" }, confirm: { turn: 1, parent: "北海道" }, meal: { turn: 1, slot: "lunch" } } },
  { id: "N-xitun", label: "西屯咖啡廳 → 台中", turns: ["西屯咖啡廳", ANS("台中")], expect: { area: { turn: 1, dest: "台中西屯" } } },
  { id: "N-puli", label: "埔里咖啡廳 → 南投", turns: ["埔里咖啡廳", ANS("南投")], expect: { area: { turn: 1, dest: "南投埔里" } } },
  { id: "N-xitun-gib", label: "西屯咖啡廳 → 不知道（無法解析）", turns: ["西屯咖啡廳", ANS("不知道")], expect: { cleared: { turn: 1 } } },
  { id: "N-puli-gib", label: `埔里咖啡廳 → ${GIB}（無法解析）`, turns: ["埔里咖啡廳", ANS(GIB)], expect: { cleared: { turn: 1 } } },
  { id: "N-xitun-cont", label: "西屯咖啡廳 → 台中 → 再推薦幾個", turns: ["西屯咖啡廳", ANS("台中"), "再推薦幾個"], expect: { area: { turn: 1, dest: "台中西屯" } } },
  { id: "N-K-cont", label: "京都看楓葉推薦景點 → 好 → 再推薦幾個 → 還有嗎", turns: ["京都看楓葉推薦景點", ANS("好"), "再推薦幾個", "還有嗎"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, cont: [{ turn: 2, dest: "京都" }, { turn: 3, dest: "京都" }] } },
  { id: "N-K-osaka", label: "京都看楓葉推薦景點（待確認）→ 大阪推薦景點", turns: ["京都看楓葉推薦景點", "大阪推薦景點"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, search: [{ turn: 1, dest: "大阪" }] } },
  { id: "N-K-osaka-ok", label: "京都看楓葉推薦景點（待確認）→ 大阪推薦景點 → 好（舊 pending 不得復活）", turns: ["京都看楓葉推薦景點", "大阪推薦景點", "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, search: [{ turn: 1, dest: "大阪" }], notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-no-ok", label: "京都看楓葉推薦景點 → 不用 → 好（舊 pending 不得復活）", turns: ["京都看楓葉推薦景點", ANS("不用"), "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-gib-ok", label: `京都看楓葉推薦景點 → ${GIB} → 好（舊 pending 不得復活）`, turns: ["京都看楓葉推薦景點", ANS(GIB), "好"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }] } },
  { id: "N-K-ok-osaka", label: "京都看楓葉推薦景點 → 好 → 大阪推薦景點（確認後換城市）", turns: ["京都看楓葉推薦景點", ANS("好"), "大阪推薦景點"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" }, search: [{ turn: 2, dest: "大阪" }] } },
  { id: "N-K-city", label: "京都看楓葉推薦景點 → 京都（以城市名回答）", turns: ["京都看楓葉推薦景點", ANS("京都")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" } } },
  { id: "N-K-sess", label: "京都推薦景點 → 京都看楓葉推薦景點 → 好", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("好")], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 1, parent: "京都" }, confirm: { turn: 2, parent: "京都" } } },
  { id: "N-K-more", label: "京都看楓葉推薦景點（待確認）→ 再推薦幾個", turns: ["京都看楓葉推薦景點", "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-no-more", label: "京都看楓葉推薦景點 → 不用 → 再推薦幾個", turns: ["京都看楓葉推薦景點", ANS("不用"), "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-gib-more", label: `京都看楓葉推薦景點 → ${GIB} → 再推薦幾個`, turns: ["京都看楓葉推薦景點", ANS(GIB), "再推薦幾個"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-no-cafe", label: "京都看楓葉推薦景點 → 不用 → 推薦咖啡廳", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, cleared: { turn: 1, parent: "京都" }, noUnconfirmed: true } },
  { id: "N-K-reload", label: "京都看楓葉推薦景點 →（重新載入）→ 好", turns: ["京都看楓葉推薦景點", ANS("好")], reloadAfter: 0, expect: { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" }, confirm: { turn: 1, parent: "京都" } } },
);
const K = { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 0, parent: "京都" } };
const R3_SCENARIOS = [
  { id: "R3-K-thanks", label: "京都看楓葉推薦景點 → 好的，謝謝（不得視為確認）", turns: ["京都看楓葉推薦景點", ANS("好的，謝謝")], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 1, dest: "京都" }], noSearch: [1], noUnconfirmed: true } },
  { id: "R3-K-thanks-ok", label: "京都看楓葉推薦景點 → 好的，謝謝 → 好（舊 pending 不得復活）", turns: ["京都看楓葉推薦景點", ANS("好的，謝謝"), "好"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 1, dest: "京都" }, { turn: 2, dest: "京都" }], noSearch: [1, 2], noUnconfirmed: true } },
  { id: "R3-K-xiexie", label: "京都看楓葉推薦景點 → 謝謝", turns: ["京都看楓葉推薦景點", ANS("謝謝")], expect: { ...K, cleared: { turn: 1, parent: "京都" }, noSearch: [1], noUnconfirmed: true } },
  { id: "R3-K-okthanks2", label: "京都看楓葉推薦景點 → 好，謝謝你", turns: ["京都看楓葉推薦景點", ANS("好，謝謝你")], expect: { ...K, cleared: { turn: 1, parent: "京都" }, noSearch: [1], noUnconfirmed: true } },
  { id: "R3-K-hao-de", label: "京都看楓葉推薦景點 → 好的（正向對照）", turns: ["京都看楓葉推薦景點", ANS("好的")], expect: { ...K, confirm: { turn: 1, parent: "京都" } } },
  { id: "R3-K-shi-de", label: "京都看楓葉推薦景點 → 是的（正向對照）", turns: ["京都看楓葉推薦景點", ANS("是的")], expect: { ...K, confirm: { turn: 1, parent: "京都" } } },
  { id: "R3-K-hao-bang", label: "京都看楓葉推薦景點 → 好！（正向對照，尾端標點）", turns: ["京都看楓葉推薦景點", ANS("好！")], expect: { ...K, confirm: { turn: 1, parent: "京都" } } },
  { id: "R3-K-city", label: "京都看楓葉推薦景點 → 京都（父城市名稱確認）", turns: ["京都看楓葉推薦景點", ANS("京都")], expect: { ...K, confirm: { turn: 1, parent: "京都" } } },
  { id: "R3-K-city-punct", label: "京都看楓葉推薦景點 → 京都。", turns: ["京都看楓葉推薦景點", ANS("京都。")], expect: { ...K, confirm: { turn: 1, parent: "京都" } } },
  { id: "R3-K-city-more", label: "京都看楓葉推薦景點 → 京都 → 再推薦幾個", turns: ["京都看楓葉推薦景點", ANS("京都"), "再推薦幾個"], expect: { ...K, confirm: { turn: 1, parent: "京都" }, cont: [{ turn: 2, dest: "京都" }] } },
  { id: "R3-K-other-city", label: "京都看楓葉推薦景點 → 大阪（其他城市名不是確認）", turns: ["京都看楓葉推薦景點", ANS("大阪")], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 1, dest: "京都" }], noUnconfirmed: true } },
  { id: "R3-K-no-reload", label: "京都看楓葉推薦景點 → 不用 →（重新載入）→ 好", turns: ["京都看楓葉推薦景點", ANS("不用"), "好"], reloadAfter: 1, expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }], noSearch: [2], noUnconfirmed: true } },
  { id: "R3-K-osaka-empty-ok", label: "京都看楓葉推薦景點 → 大阪推薦景點 →（重新載入）→ 好", turns: ["京都看楓葉推薦景點", "大阪推薦景點", "好"], reloadAfter: 1, expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: [{ turn: 2, dest: "京都" }], noUnconfirmed: true } },
  { id: "R3-xitun-gib-reload", label: "西屯咖啡廳 → 不知道 →（重新載入）→ 台中", turns: ["西屯咖啡廳", ANS("不知道"), "台中"], reloadAfter: 1, expect: { cleared: { turn: 1 } } },
];
// ── r4-Δ6：R4 新增情境 ──
const K1 = { parent: "京都", raw: "京都看楓葉", parentAsk: { turn: 1, parent: "京都" } };
const NOKYOTO = (turns) => turns.map((turn) => ({ turn, dest: "京都" }));
const R4_SCENARIOS = [
  // Early Return Pending（P2-2）
  { id: "R4-E-num", label: "京都看楓葉推薦景點 → 1（數字回覆）→ 好", turns: ["京都看楓葉推薦景點", ANS("1"), "好"], expect: { ...K, notSearch: NOKYOTO([1, 2]), noSearch: [1, 2], pendingEmpty: [1, 2], noUnconfirmed: true } },
  { id: "R4-E-num-reload", label: "京都看楓葉推薦景點 → 1 →（重新載入）→ 好", turns: ["京都看楓葉推薦景點", ANS("1"), "好"], reloadAfter: 1, expect: { ...K, notSearch: NOKYOTO([1, 2]), noSearch: [1, 2], pendingEmpty: [1, 2], noUnconfirmed: true } },
  { id: "R4-E-refresh", label: "京都看楓葉推薦景點 → 重新整理推薦 → 好", turns: ["京都看楓葉推薦景點", ANS("重新整理推薦"), "好"], expect: { ...K, notSearch: NOKYOTO([1, 2]), noSearch: [1, 2], pendingEmpty: [1, 2], noUnconfirmed: true } },
  { id: "R4-E-refresh-days", label: "（已確認京都＋3天）京都看楓葉推薦景點 → 重新整理推薦 → 好", initKind: "kyotoDays", turns: ["京都看楓葉推薦景點", ANS("重新整理推薦"), "好"], expect: { ...K, noSearch: [1, 2], pendingEmpty: [1, 2], noUnconfirmed: true } },
  { id: "R4-E-detail", label: "京都推薦景點 → 京都看楓葉推薦景點 →（UI 聊聊地點）→ 這裡適合拍照嗎 → 好", turns: ["京都推薦景點", "京都看楓葉推薦景點", { ui: "placeDetail" }, "這裡適合拍照嗎", "好"], expect: { ...K1, pendingKept: [2], pendingEmpty: [3, 4], noSearch: [3, 4], noUnconfirmed: true } },
  { id: "R4-E-detail-ok", label: "京都推薦景點 → 京都看楓葉推薦景點 →（UI 聊聊地點）→ 好", turns: ["京都推薦景點", "京都看楓葉推薦景點", { ui: "placeDetail" }, "好"], expect: { ...K1, pendingKept: [2], pendingEmpty: [3], noSearch: [3], noUnconfirmed: true } },
  { id: "R4-E-no-refresh", label: "京都看楓葉推薦景點 → 不用 → 重新整理推薦 → 好", turns: ["京都看楓葉推薦景點", ANS("不用"), "重新整理推薦", "好"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: NOKYOTO([2, 3]), noSearch: [2, 3], pendingEmpty: [1, 2, 3], noUnconfirmed: true } },
  { id: "R4-E-osaka-refresh", label: "京都看楓葉推薦景點 → 大阪推薦景點 → 重新整理推薦 → 好", turns: ["京都看楓葉推薦景點", "大阪推薦景點", "重新整理推薦", "好"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, search: [{ turn: 1, dest: "大阪" }], notSearch: NOKYOTO([2, 3]), noSearch: [2, 3], pendingEmpty: [1, 2, 3], noUnconfirmed: true } },
  // 無關 UI 操作不得清除 pending
  { id: "R4-U-empty", label: "京都看楓葉推薦景點 →（空字串送出）→ 好", turns: ["京都看楓葉推薦景點", { text: "" }, "好"], expect: { ...K, pendingKept: [1], confirm: { turn: 2, parent: "京都" } } },
  { id: "R4-U-auth", label: "京都看楓葉推薦景點 →（要求登入，未送出）→ 好", turns: ["京都看楓葉推薦景點", { text: "好", ui: "authBlocked" }, "好"], expect: { ...K, pendingKept: [1], confirm: { turn: 2, parent: "京都" } } },
  { id: "R4-U-inflight", label: "京都看楓葉推薦景點 →（in-flight 防連點）→ 好", turns: ["京都看楓葉推薦景點", { text: "好", ui: "inflight" }, "好"], expect: { ...K, pendingKept: [1], confirm: { turn: 2, parent: "京都" } } },
  { id: "R4-U-auto", label: "京都看楓葉推薦景點 →（source=auto）推薦咖啡廳 → 好", turns: ["京都看楓葉推薦景點", { text: "推薦咖啡廳", source: "auto" }, "好"], expect: { ...K, noUnconfirmed: true } },
  { id: "R4-U-shortcut", label: "京都看楓葉推薦景點 →（chat_shortcut）想找安靜的咖啡廳 → 好", turns: ["京都看楓葉推薦景點", { text: "想找安靜的咖啡廳", source: "chat_shortcut" }, "好"], expect: { ...K, noUnconfirmed: true } },
  { id: "R4-U-homemood", label: "京都看楓葉推薦景點 →（home_mood）下雨天可以去哪 → 好", turns: ["京都看楓葉推薦景點", { text: "下雨天可以去哪", source: "home_mood" }, "好"], expect: { ...K, noUnconfirmed: true } },
  { id: "R4-E-sticky", label: "（先前用過 structured shortcut）京都看楓葉推薦景點 → 好 → 好", initKind: "stickyNearbyShortcut", turns: ["京都看楓葉推薦景點", ANS("好"), "好"], expect: { ...K, pendingEmpty: [1, 2], noUnconfirmed: true } },
  { id: "R4-L-legacy", label: "legacy nearby pending（附近咖啡廳）→ 台北車站（F4 不得早期消費）", initKind: "legacyNearby", turns: ["台北車站"], expect: { pendingKept: [0] } },
  // P2-5 A / B / B'
  { id: "R4-P5-A", label: "A：京都推薦景點 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（可用京都）", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, search: [{ turn: 3, dest: "京都" }], keepSessionDest: { turns: [1, 2], dest: "京都" }, noUnconfirmed: true } },
  { id: "R4-P5-B", label: "B：京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（不得用京都）", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, noUnconfirmed: true } },
  { id: "R4-P5-B2", label: "B'：大阪推薦景點 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（大阪或不搜尋）", turns: ["大阪推薦景點", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([2, 3]), searchIn: [{ turn: 3, dests: ["大阪", null] }], notSessionDest: { turns: [1, 2, 3], dest: "京都" }, noUnconfirmed: true } },
  // P2-1：確認輪 preferredArea / 餐別 / 已確認行政區
  { id: "R4-P1-meal-city", label: "京都看楓葉晚餐推薦 → 京都（以城市名確認）", turns: ["京都看楓葉晚餐推薦", ANS("京都")], expect: { ...K, confirm: { turn: 1, parent: "京都" }, meal: { turn: 1, slot: "dinner" } } },
  { id: "R4-P1-meal-sess", label: "京都推薦景點 → 京都看楓葉晚餐推薦 → 好", turns: ["京都推薦景點", "京都看楓葉晚餐推薦", ANS("好")], expect: { ...K1, confirm: { turn: 2, parent: "京都" }, meal: { turn: 2, slot: "dinner" } } },
  { id: "R4-P1-area-keep", label: "台中西屯美食 → 京都看楓葉推薦景點 → 不用（已確認行政區不得清除）", turns: ["台中西屯美食", "京都看楓葉推薦景點", ANS("不用")], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, notSessionDest: { turns: [1, 2], dest: "京都" }, noUnconfirmed: true } },
  { id: "R4-P1-area-confirm", label: "台中西屯美食 → 京都看楓葉推薦景點 → 好", turns: ["台中西屯美食", "京都看楓葉推薦景點", ANS("好")], expect: { ...K1, confirm: { turn: 2, parent: "京都" } } },
];
// ── r5-Δ5：R5 新增情境 ──
const KR = { parent: "京都", raw: "京都看楓葉" }; // 不含 parentAsk（faithful sticky 路徑的首輪澄清位置不同）
const R5_SCENARIOS = [
  // nearbyShortcutTurn 下 pending 復活（P2-2）
  // 註：sticky nearby shortcut 下「京都看楓葉推薦景點」會被 L9807 refinement（NEW_RECOMMENDATION）接走並走 nearby shortcut persist，
  // 不會建立 pending；L10690 late 澄清只有 isExplicitDestinationChangeText（「改去…」）的輪次到得了，故 faithful 情境用「改去京都看楓葉推薦景點」。
  { id: "R5-NS-revive", label: "（sticky nearby shortcut＋GPS，faithful）改去京都看楓葉推薦景點 → 好 → 好", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["改去京都看楓葉推薦景點", "好", "好"], expect: { ...KR, pendingEmpty: [1, 2], notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, noUnconfirmed: true } },
  { id: "R5-NS-revive-reload", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點 → 好 →（重新載入）→ 好", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["改去京都看楓葉推薦景點", "好", "好"], reloadAfter: 1, expect: { ...KR, pendingEmpty: [1, 2], notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), noUnconfirmed: true } },
  { id: "R5-NS-nofaith", label: "（sticky＋GPS，faithful）京都看楓葉推薦景點 → 好（對照：refinement 接走，不建立 pending）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["京都看楓葉推薦景點", "好"], expect: { ...KR, pendingEmpty: [0, 1], notSearch: NOKYOTO([1]), noCreditsDest: NOKYOTO([1]), noUnconfirmed: true } },
  { id: "R5-NS-seed", label: "（sticky＋GPS＋殘留京都 parent pending，faithful）好 → 好", initKind: "stickyPending", faithful: true, turns: ["好", "好"], expect: { ...KR, pendingEmpty: [0, 1], notSearch: NOKYOTO([0, 1]), noCreditsDest: NOKYOTO([0, 1]), noUnconfirmed: true } },
  { id: "R5-NS-seed-cafe", label: "（sticky＋GPS＋殘留京都 parent pending，faithful）推薦咖啡廳 → 好", initKind: "stickyPending", faithful: true, turns: ["推薦咖啡廳", "好"], expect: { ...KR, pendingEmpty: [0, 1], notSearch: NOKYOTO([0, 1]), noCreditsDest: NOKYOTO([0, 1]), noUnconfirmed: true } },
  { id: "R5-NS-seed-kyoto", label: "（sticky＋GPS＋殘留京都 parent pending，faithful）京都看楓葉推薦景點 → 好", initKind: "stickyPending", faithful: true, turns: ["京都看楓葉推薦景點", "好"], expect: { ...KR, pendingEmpty: [1], notSearch: NOKYOTO([1]), noCreditsDest: NOKYOTO([1]), noUnconfirmed: true } },
  // before 污染（L10463 persist 後於 L10690 / L10831 澄清）
  { id: "R5-BP-B", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（late 澄清，B）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["改去京都看楓葉推薦景點", "不用", "推薦咖啡廳"], expect: { ...KR, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都" }, noUnconfirmed: true } },
  { id: "R5-BP-B2", label: "（sticky＋GPS，faithful）大阪推薦景點 → 改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（B'）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["大阪推薦景點", "改去京都看楓葉推薦景點", "不用", "推薦咖啡廳"], expect: { ...KR, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([2, 3]), searchIn: [{ turn: 3, dests: ["大阪", null] }], notSessionDest: { turns: [1, 2, 3], dest: "京都" }, notDerived: { turns: [1, 2, 3], dest: "京都" }, noUnconfirmed: true } },
  { id: "R5-BP-A", label: "（sticky＋GPS，faithful）京都推薦景點 → 改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（A）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["京都推薦景點", "改去京都看楓葉推薦景點", "不用", "推薦咖啡廳"], expect: { ...KR, keepSessionDest: { turns: [1, 2], dest: "京都" }, noUnconfirmed: true } },
  // currentLocation / location 保留
  { id: "R5-LOC-B", label: "（GPS 台中）京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（B；位置不得清除／改京都）", initKind: "gpsTaichung", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都", cityEq: "台中市", curEq: "台中市" }, noUnconfirmed: true } },
  { id: "R5-LOC-A", label: "（GPS 台中）京都推薦景點 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（A；座標不得清除）", initKind: "gpsTaichung", turns: ["京都推薦景點", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, keepSessionDest: { turns: [1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2, 3], latlng: true }, noUnconfirmed: true } },
  { id: "R5-LOC-gps-late", label: "（sticky、本輪前無位置；本輪取得 GPS，faithful）改去京都看楓葉推薦景點（late 澄清；本輪 GPS 不得清除）", initKind: "stickyNearbyShortcutNoLoc", gps: { lat: 24.18, lng: 120.62, city: "台中市" }, faithful: true, turns: ["改去京都看楓葉推薦景點"], expect: { ...KR, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true } },
  // 合法行政區保留
  { id: "R5-AREA-keep", label: "台中西屯美食 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（西屯欄位不得清除）", turns: ["台中西屯美食", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([2, 3]), notSessionDest: { turns: [1, 2, 3], dest: "京都" }, notDerived: { turns: [1, 2, 3], dest: "京都" }, areaKeep: { from: 0, turns: [1, 2], match: "台中|西屯" }, searchPrefix: [{ turn: 3, prefixes: ["台中"] }], noUnconfirmed: true } },
  // P2-5 B / B' 的衍生欄位（r4 失敗原因）
  { id: "R5-P5-B-derived", label: "B：京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（衍生欄位不得殘留京都）", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, noUnconfirmed: true } },
  { id: "R5-P5-B2-derived", label: "B'：大阪推薦景點 → 京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（衍生欄位不得殘留京都）", turns: ["大阪推薦景點", "京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], expect: { ...K1, cleared: { turn: 2, parent: "京都" }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([2, 3]), searchIn: [{ turn: 3, dests: ["大阪", null] }], notSessionDest: { turns: [1, 2, 3], dest: "京都" }, notDerived: { turns: [1, 2, 3], dest: "京都" }, noUnconfirmed: true } },
  { id: "R5-P5-B-reload", label: "B：京都看楓葉推薦景點 → 不用 →（重新載入）→ 推薦咖啡廳", turns: ["京都看楓葉推薦景點", ANS("不用"), "推薦咖啡廳"], reloadAfter: 1, expect: { ...K, cleared: { turn: 1, parent: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([1, 2]), notDerived: { turns: [0, 1, 2], dest: "京都" }, noUnconfirmed: true } },
];
// ── r6-Δ6：R6 新增情境（retry 澄清；GPS-late 後拒絕）──
const FAULT_THROW = (text) => ({ text, fault: "throwAfterPersist" });
const FAULT_TIMEOUT = (text) => ({ text, fault: "streamTimeout" });
const GPS_LATE = { lat: 24.18, lng: 120.62, city: "台中市" };
const R6_SCENARIOS = [
  { id: "R6-RT-throw-B", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點［L10471 後例外→state_machine_error retry 澄清］→ 不用 → 推薦咖啡廳（B）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: [FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都", cityEq: "台中市", curEq: "台中市" }, kyotoFree: { turns: [1, 2] }, noUnconfirmed: true } },
  { id: "R6-RT-throw-B2", label: "（sticky＋GPS，faithful）大阪推薦景點 → 改去京都看楓葉推薦景點［retry 澄清］→ 不用 → 推薦咖啡廳（B'：恢復大阪）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["大阪推薦景點", FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [1] }, notSearch: NOKYOTO([2, 3]), noCreditsDest: NOKYOTO([1, 2, 3]), searchIn: [{ turn: 3, dests: ["大阪", null] }], notSessionDest: { turns: [1, 2, 3], dest: "京都" }, notDerived: { turns: [1, 2, 3], dest: "京都" }, keepSessionDest: { turns: [1, 2], dest: "大阪" }, kyotoFree: { turns: [2, 3] }, noUnconfirmed: true } },
  { id: "R6-RT-throw-A", label: "（sticky＋GPS，faithful）京都推薦景點 → 改去京都看楓葉推薦景點［retry 澄清］→ 不用 → 推薦咖啡廳（A：保留京都）", initKind: "stickyNearbyShortcutGps", faithful: true, turns: ["京都推薦景點", FAULT_THROW("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [1] }, keepSessionDest: { turns: [1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2, 3], latlng: true }, noUnconfirmed: true } },
  { id: "R6-RT-throw-gps-late", label: "（sticky、本輪前無位置；本輪取得 GPS，faithful）改去京都看楓葉推薦景點［retry 澄清；catch 以 send 開頭 session 重跑］", initKind: "stickyNearbyShortcutNoLoc", gps: GPS_LATE, faithful: true, turns: [FAULT_THROW("改去京都看楓葉推薦景點")], expect: { ...KR, viaRetry: { turns: [0] }, gpsKept: { turns: [0] }, notDerived: { turns: [0], dest: "京都" }, noUnconfirmed: true } },
  { id: "R6-RT-timeout-B", label: "（sticky＋GPS，faithful）改去京都看楓葉推薦景點［streamChat ai_timeout → retry（若可到達）］→ 不用 → 推薦咖啡廳", initKind: "stickyNearbyShortcutGps", faithful: true, turns: [FAULT_TIMEOUT("改去京都看楓葉推薦景點"), "不用", "推薦咖啡廳"], expect: { ...KR, viaRetry: { turns: [0] }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notDerived: { turns: [0, 1, 2], dest: "京都" }, locKeep: { turns: [0, 1, 2], latlng: true, notCity: "京都", cityEq: "台中市", curEq: "台中市" }, noUnconfirmed: true } },
  { id: "R6-GPS-late-reject", label: "（sticky、本輪前無位置；本輪取得 GPS，faithful）改去京都看楓葉推薦景點 → 不用 → 推薦咖啡廳（GPS 保留、京都不沿用）", initKind: "stickyNearbyShortcutNoLoc", gps: GPS_LATE, faithful: true, turns: ["改去京都看楓葉推薦景點", "不用", "推薦咖啡廳"], expect: { ...KR, gpsKept: { turns: [0, 1, 2] }, notDerived: { turns: [0, 1, 2], dest: "京都" }, notSessionDest: { turns: [0, 1, 2], dest: "京都" }, notSearch: NOKYOTO([1, 2]), noCreditsDest: NOKYOTO([0, 1, 2]), kyotoFree: { turns: [1, 2] }, noUnconfirmed: true } },
];
const SCENARIOS = [...T27_SCENARIOS, ...NEW_SCENARIOS, ...R3_SCENARIOS, ...R4_SCENARIOS, ...R5_SCENARIOS, ...R6_SCENARIOS];
const R3_IDS = new Set(R3_SCENARIOS.map((s) => s.id));
const R4_IDS = new Set(R4_SCENARIOS.map((s) => s.id));
const R5_IDS = new Set(R5_SCENARIOS.map((s) => s.id));
const R6_IDS = new Set(R6_SCENARIOS.map((s) => s.id));
const MODES = [
  { id: "ok", geo: "ok", search: "ok" },
  { id: "ok-empty", geo: "ok", search: "empty" },
  { id: "timeout", geo: "timeout", search: "ok" },
  { id: "null", geo: "null", search: "ok" },
  { id: "zero", geo: "zero", search: "ok" },
  { id: "neterr", geo: "neterr", search: "ok" },
];
const onlyArg = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const ONLY = onlyArg ? new Set(onlyArg.split(",")) : null;
const scenarios = ONLY ? SCENARIOS.filter((s) => ONLY.has(s.id)) : SCENARIOS;
const rowsArg = process.argv.find((a) => a.startsWith("--rows="))?.slice("--rows=".length);
const ROWS_ALL = rowsArg === "all";
const ROWS = rowsArg && !ROWS_ALL ? new Set(rowsArg.split(",")) : null;
const NO_ROWS = process.argv.includes("--no-rows");
const TREES = ["work", "pre", "base", ...(WITH_PRE5 ? ["pre5"] : []), ...(WITH_PRE4 ? ["pre4"] : [])];

const ENV_ALLOW = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL", "TERM", "TZ"];
function childEnv(extra) {
  const env = {};
  for (const k of ENV_ALLOW) if (process.env[k] != null) env[k] = process.env[k];
  return { ...env, NODE_ENV: "development", ...MOCK_ENV, ...extra };
}

async function collect(tree, mode, scenario) {
  if (scenario.reloadAfter == null) return collectOnce(tree, mode, scenario, {});
  const k = scenario.reloadAfter;
  const a = await collectOnce(tree, mode, { ...scenario, turns: scenario.turns.slice(0, k + 1) }, {});
  if (a.err || a.result.error) return a;
  const b = await collectOnce(tree, mode, { ...scenario, turns: scenario.turns.slice(k + 1) }, {
    VERIFY_P2_INIT: JSON.stringify(a.result.final),
    VERIFY_P2_TURN_OFFSET: String(k + 1),
  });
  if (b.err) return b;
  return {
    result: { ...b.result, turns: [...a.result.turns, ...b.result.turns], error: a.result.error ?? b.result.error },
    fetchCalls: a.fetchCalls + b.fetchCalls,
    ext: Object.fromEntries(Object.keys(a.ext).map((x) => [x, a.ext[x] + b.ext[x]])),
    fetchLog: [...a.fetchLog, ...b.fetchLog],
  };
}

function collectOnce(tree, mode, scenario, extraEnv) {
  // r4：重新載入後的第一輪只去掉 onlyIfClarified，保留 source / ui（r3 的 turn 只有 text / onlyIfClarified，行為相同）
  const sc = extraEnv.VERIFY_P2_INIT
    ? { ...scenario, turns: scenario.turns.map((t, i) => (i === 0 && typeof t === "object" ? { ...t, onlyIfClarified: undefined } : t)) }
    : scenario;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: WORK_ROOT,
      env: childEnv({
        ...extraEnv,
        VERIFY_P2R3_ROLE: "collect",
        VERIFY_P2R3_TREE: tree,
        VERIFY_P2R3_OVERLAY: JSON.stringify(OVERLAY),
        VERIFY_P2_GEO: mode.geo,
        VERIFY_P2_SEARCH: mode.search,
        VERIFY_P2_SCENARIO: JSON.stringify(sc),
      }),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 300000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("@@P2R3_JSON@@"));
      if (!line) return resolve({ err: `status=${code} signal=${signal} stderr=${err.slice(-900)} stdout=${out.slice(-300)}` });
      resolve(JSON.parse(line.slice("@@P2R3_JSON@@".length)));
    });
  });
}

const jobs = [];
for (const s of scenarios) for (const m of MODES) for (const tree of TREES) jobs.push({ s, m, tree });
const results = {};
const CONC = 8;
let idx = 0;
let done = 0;
async function worker() {
  while (idx < jobs.length) {
    const j = jobs[idx++];
    results[`${j.tree}|${j.m.id}|${j.s.id}`] = await collect(j.tree, j.m, j.s);
    done += 1;
    if (done % 100 === 0) process.stderr.write(`[p2r5] ${done}/${jobs.length}\n`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const infra = [];
const extTotals = { fetch: 0, http: 0, https: 0, net: 0, tls: 0, undici: 0 };
const extHits = [];
let undiciLoadedAll = true;
let envScrubbedAny = new Set();
let mockKeyOk = true;
const overlayHitsAll = { pre: new Set(), pre5: new Set(), pre4: new Set(), base: new Set() };
const modProbesByTree = {};
for (const [k, r] of Object.entries(results)) {
  if (r.err) {
    infra.push(`INFRA-FAIL ${k} ${r.err}`);
    continue;
  }
  const tree = k.split("|")[0];
  for (const x of Object.keys(extTotals)) extTotals[x] += r.ext?.[x] ?? 0;
  if (r.fetchCalls !== 0) extHits.push(`EXTERNAL-REQUEST ${k} count=${r.fetchCalls} ${r.fetchLog.join(";")}`);
  if (r.result.error) infra.push(`INFRA-FAIL ${k} ${r.result.error}`);
  else if (r.result.tree !== tree || (tree !== "base") !== r.result.isWork) infra.push(`INFRA-FAIL ${k} tree mismatch tree=${r.result.tree} isWork=${r.result.isWork}`);
  const oc = r.result.overlayCheck ?? {};
  if (tree === "base" && (oc.echo || oc.parentPending)) infra.push(`INFRA-FAIL ${k} base overlay 未生效`);
  if (tree !== "base" && !(oc.echo && oc.parentPending)) infra.push(`INFRA-FAIL ${k} ${tree} 缺少 F3 函式`);
  // r6-Δ1：work = F6（a1 本輪 GPS 保留）、pre = F6 前（f5Probe 台中市、a1 location=null）、pre5 = F5 前（f5Probe 京都）、pre4 = F4 前（arity 1）
  const a1Loc = oc.modProbes?.a1_gpsAcquiredThisTurn?.location ?? null;
  if (tree === "work" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || !a1Loc)) infra.push(`INFRA-FAIL ${k} work 的 withoutUnconfirmedSessionDestinations 不是 F6 版（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);
  if (tree === "pre" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "台中市" || a1Loc)) infra.push(`INFRA-FAIL ${k} pre overlay（F6 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)} a1=${JSON.stringify(a1Loc)}）`);
  if (tree === "pre5" && (oc.ctdArity !== 2 || oc.f5Probe?.locCity !== "京都")) infra.push(`INFRA-FAIL ${k} pre5 overlay（F5 前）未生效（arity=${oc.ctdArity} probe=${JSON.stringify(oc.f5Probe)}）`);
  if (tree === "pre4" && oc.ctdArity !== 1) infra.push(`INFRA-FAIL ${k} pre4 overlay（F4 前）未生效（arity=${oc.ctdArity}）`);
  if (tree !== "work") for (const h of oc.hits ?? []) overlayHitsAll[tree].add(h);
  if (oc.modProbes && !modProbesByTree[tree]) modProbesByTree[tree] = oc.modProbes;
  if ((tree === "pre" || tree === "pre5" || tree === "pre4") && !(oc.hits ?? []).includes("src/lib/ai/chat-turn-destination.ts")) infra.push(`INFRA-FAIL ${k} ${tree} 未載入 overlay 的 chat-turn-destination.ts`);
  if (!r.result.undiciLoaded) undiciLoadedAll = false;
  for (const e of r.result.envScrubbed ?? []) envScrubbedAny.add(e);
  if (r.result.mockKey !== "mock-key" || r.result.viteMockKey !== "mock-key") mockKeyOk = false;
}
if (infra.length) {
  console.log(infra.slice(0, 40).join("\n"));
  console.log(`INFRA-FAIL count=${infra.length}`);
  process.exit(1);
}

// ── 判定（r3 原樣，包成 judge(WT)；WT = work / pre / pre4，皆與 base 對照）──
const KNOWN = new Set(["京都", "大阪", "北海道", "沖繩", "奈良", "金澤", "花蓮", "香港", "台南", "新竹", "千葉", "東京", "台北", "台中", "南投"]);
const ADMIN_OK = new Set(["香港跑馬地", "台中西屯", "南投埔里", "里斯本", "波爾圖"]);
const confirmedDest = (d, mode) => !d || KNOWN.has(d) || (mode.geo === "ok" && ADMIN_OK.has(d));
const turnSpec = (s, i) => {
  const t = s.turns[i];
  return typeof t === "string" ? { text: t } : (t ?? {});
};
// r6-Δ6：retry 到達紀錄（各樹）
const R6_RETRY = [];
function judge(WT) {
  const p1 = WT === "work" ? [...graphP1] : [];
  const p1ByScenario = new Map();
  const diffExpected = [];
  const ux = [];
  const notes = [];
  const costNotes = [];
  const rows = [];
  const providerDiff = [];
  const reviewProbe = [];
  const fmt = (t) =>
    t
      ? `path=${t.path} | ans=${t.answerKind ?? "-"} | pendStart=${t.pendingAtStart ?? "-"} | pendBefore=${t.pendingBefore ?? "-"} | memPendAfter=${t.memPendingAfter ?? "-"} | early=${t.earlyConsumed ? "Y" : "N"} | dispatch=${t.dispatchDest ?? "-"} | res=${t.turnResolution ?? "-"} | search=${t.searchDest ?? "-"} | weather=${t.weatherDest ?? "-"} | credits=${t.creditsDest ?? "-"}(settle=${JSON.stringify(t.creditsSettle)}) | session=${t.sessionDest ?? "-"}/rec=${t.sessionRecDest ?? "-"}/tpc=${t.sessionTripPlanningDest ?? "-"}/pref=${t.sessionPreferredArea ?? "-"}/trip=${t.sessionTripDestCity ?? "-"}/pending=${t.sessionPendingKind ?? "-"}:${t.sessionPendingParent ?? ""}:${t.sessionPendingLabel ?? "-"} | clar=${t.clarified ? `Y(${t.copyKind}:${t.clarificationLabel ?? ""})` : "N"} | noResults=${t.noResultsLabel ?? "-"} | cont=${t.continuationDest ?? "-"}${t.continuationBlocked ? `(blocked:${t.continuationBlocked})` : ""} | builderText=${t.builderUserText ?? "-"}/${t.builderIntent ?? "-"}/meal=${t.builderMeal ? `${t.builderMeal.slot}@${t.builderMeal.city ?? "-"}` : "-"} | geocode=${t.geocodes.length}[${t.geocodes.join(",")}] | places=${t.placesRequests}[${t.placesQueries.slice(0, 6).join(",")}${t.placesQueries.length > 6 ? ",…" : ""}] | weatherCalls=${t.weatherCalls} builder=${t.builderCalls} credits=${t.creditsBegin} | actPref=${t.activityPreference ?? "-"}${t.mergeProbe ? ` | mergeDest(before/withReply/noReply/noSessionReply+noPendingQ)=${t.mergeProbe.before ?? "-"}/${t.mergeProbe.withReply ?? "-"}/${t.mergeProbe.withoutReply ?? "-"}/${t.mergeProbe.withoutAnyReply ?? "-"} pendingQ=${t.mergeProbe.pendingQuestionType ?? "-"}` : ""}${t.kyotoFields?.length ? ` | kyotoFields=[${t.kyotoFields.join("; ")}]` : ""} | ctxCity=${t.sessionCtxCity ?? "-"} cur=${t.sessionCurrentLocation ?? "-"} loc=${t.sessionLocation ? `${t.sessionLocation.lat},${t.sessionLocation.lng},${t.sessionLocation.city ?? "-"}` : "-"}${t.beforeProbe ? ` | beforeProbe=${JSON.stringify(t.beforeProbe)}` : ""}${t.f5NearbyStrip ? " | f5NearbyStrip" : ""}${t.viaRetry ? ` | viaRetry(${t.fallbackReason})` : ""}${t.builderError ? ` | builderErr=${t.builderError}` : ""}${t.error ? ` | ERR=${t.error}` : ""}`
      : "(turn skipped)";
  const totals = {};
  const summary = [];
  const modeStats = {};
  const countOcc = (s, sub) => (sub ? String(s ?? "").split(sub).length - 1 : 0);
  for (const s of scenarios) {
    const isT27 = T27_IDS.has(s.id);
    for (const m of MODES) {
      const align = (arr) => {
        const o = [];
        for (const t of arr) o[t.turnIndex] = t;
        return o;
      };
      const Wraw = results[`${WT}|${m.id}|${s.id}`].result.turns;
      const Braw = results[`base|${m.id}|${s.id}`].result.turns;
      const W = align(Wraw);
      const B = align(Braw);
      const P = WT === "work" ? align(results[`pre|${m.id}|${s.id}`].result.turns) : [];
      const tag = `[${s.id}][${m.id}] ${s.label}`;
      totals[m.id] ??= { wg: 0, bg: 0, ww: 0, bw: 0, wb: 0, bb: 0, wp: 0, bp: 0, wc: 0, bc: 0 };
      const tt = totals[m.id];
      const n = Math.max(W.length, B.length);
      const sum = (arr, f) => arr.reduce((a, t) => a + (t ? f(t) : 0), 0);
      const sc = {
        wg: sum(Wraw, (t) => t.geocodes.length),
        bg: sum(Braw, (t) => t.geocodes.length),
        ww: sum(Wraw, (t) => t.weatherCalls),
        bw: sum(Braw, (t) => t.weatherCalls),
        wb: sum(Wraw, (t) => t.builderCalls),
        bb: sum(Braw, (t) => t.builderCalls),
        wp: sum(Wraw, (t) => t.placesRequests),
        bp: sum(Braw, (t) => t.placesRequests),
        wc: sum(Wraw, (t) => t.creditsBegin),
        bc: sum(Braw, (t) => t.creditsBegin),
      };
      for (const k of Object.keys(sc)) tt[k] += sc[k];
      if (sc.wg !== sc.bg || sc.wp !== sc.bp || sc.ww !== sc.bw || sc.wc !== sc.bc || sc.wb !== sc.bb) {
        providerDiff.push(`${tag.padEnd(46)} geocode ${sc.wg}/${sc.bg} Places(builder) ${sc.wb}/${sc.bb} placesReq ${sc.wp}/${sc.bp} weather ${sc.ww}/${sc.bw} credits ${sc.wc}/${sc.bc}`);
      }
      const baseLooped = Braw.some((t, i) => t.clarified && i > 0 && t.path === "clarification_reask");
      const rowStart = rows.length;
      const p1Start = p1.length;
      rows.push(`\n${tag}  [geocode ${sc.wg}/${sc.bg} weather ${sc.ww}/${sc.bw} builder ${sc.wb}/${sc.bb} placesReq ${sc.wp}/${sc.bp} credits ${sc.wc}/${sc.bc}]`);
      for (let i = 0; i < n; i += 1) {
        const w = W[i];
        const b = B[i];
        if (!w && !b) continue;
        rows.push(`  T${i + 1} 「${(w ?? b).text}」`);
        if (w && b) {
          const costExempt = !isT27 && b.clarified && sc.bb === 0;
          for (const [label, wv, bv] of [["geocode", w.geocodes.length, b.geocodes.length], ["weather", w.weatherCalls, b.weatherCalls], ["Places(builder)", w.builderCalls, b.builderCalls], ["Places(requests)", w.placesRequests, b.placesRequests]]) {
            if (wv > bv) {
              (costExempt ? costNotes : p1).push(`${tag} T${i + 1} ${label} 次數 work=${wv} > base=${bv}${costExempt ? "（base 本輪澄清迴圈、整個情境從未搜尋）" : ""}`);
            }
          }
        } else if (w && !b && w.geocodes.length) {
          notes.push(`${tag} T${i + 1} work 多出的回答輪 geocode=${w.geocodes.length}（${w.geocodes.join(",")}）`);
        }
        rows.push(`    ${WT}: ${fmt(w)}`);
        if (WT === "work") rows.push(`    pre:  ${fmt(P[i])}`);
        rows.push(`    base: ${fmt(b)}`);
        if (!w) {
          notes.push(`${tag} T${i + 1} base 有此輪、work 跳過（work 前一輪未澄清）`);
          continue;
        }
        const sameAsBase = (field) => Boolean(b) && (b[field] ?? null) === (w[field] ?? null);
        const flag = (field, msg) => (sameAsBase(field) ? notes.push(`${msg}（與 base 相同，既有行為）`) : p1.push(msg));
        for (const [field, key] of [["search", "searchDest"], ["weather", "weatherDest"], ["credits", "creditsDest"]]) {
          if (!confirmedDest(w[key], m)) flag(key, `${tag} T${i + 1} work ${field} 使用未確認目的地「${w[key]}」`);
        }
        const prevW = W[i - 1];
        if (w.sessionDest !== (prevW?.sessionDest ?? null) && !confirmedDest(w.sessionDest, m)) {
          flag("sessionDest", `${tag} T${i + 1} work Session travelContext.destination 寫入未確認「${w.sessionDest}」`);
        }
        if (w.sessionRecDest !== (prevW?.sessionRecDest ?? null) && !confirmedDest(w.sessionRecDest, m)) {
          flag("sessionRecDest", `${tag} T${i + 1} work Session recommendationSession.destination 寫入未確認「${w.sessionRecDest}」`);
        }
        for (const g of w.geocodes) {
          const [ph, q] = [g.slice(0, g.indexOf(":")), g.slice(g.indexOf(":") + 1)];
          if ((ph === "weather" || ph === "builder") && !confirmedDest(q.split(",")[0].replace(/市$/, ""), m)) {
            const inBase = b?.geocodes.includes(g);
            (inBase ? notes : p1).push(`${tag} T${i + 1} work ${ph} 以未確認字串 geocode「${q}」${inBase ? "（與 base 相同）" : ""}`);
          }
        }
        if (w.continuationDest && prevW) {
          const prevConfirmed = prevW.sessionRecDest ?? prevW.sessionDest;
          if (prevConfirmed && w.continuationDest !== prevConfirmed) p1.push(`${tag} T${i + 1} work Continuation 換城市 ${prevConfirmed} → ${w.continuationDest}`);
        }
        const isAnswer = typeof s.turns[i] === "object" && s.turns[i].onlyIfClarified;
        if (isAnswer && w.clarified) {
          if (b && b.clarified) notes.push(`${tag} T${i + 1} work 與 base 皆澄清迴圈（既有行為；work label=${w.clarificationLabel} base label=${b.clarificationLabel}）`);
          else p1.push(`${tag} T${i + 1} work 澄清迴圈：回答「${w.text}」後再次要求澄清（label=${w.clarificationLabel}）${b ? "" : "；base 首輪未澄清"}`);
        }
        if (w.activityPreference) p1.push(`${tag} T${i + 1} work Session 出現 activityPreference=${w.activityPreference}`);
        if (b) {
          const baseGood = b.searchDest && confirmedDest(b.searchDest, m) && b.builderCalls > 0;
          const workSearched = w.searchDest && w.builderCalls > 0;
          if (baseGood && !workSearched && !w.continuationDest) {
            p1.push(`${tag} T${i + 1} 退步：base 以「${b.searchDest}」搜尋，work ${w.clarified ? `改為澄清(${w.copyKind}:${w.clarificationLabel})` : `未搜尋(path=${w.path})`}`);
          }
          if (baseGood && workSearched && w.searchDest !== b.searchDest) {
            p1.push(`${tag} T${i + 1} 退步/換目的地：base「${b.searchDest}」→ work「${w.searchDest}」`);
          }
          for (const [field, bv, wv] of [["search", b.searchDest, w.searchDest], ["weather", b.weatherDest, w.weatherDest], ["credits", b.creditsDest, w.creditsDest]]) {
            if (bv && !confirmedDest(bv, m) && bv !== wv) {
              diffExpected.push(`${tag} T${i + 1} ${field}: base「${bv}」(未確認) → work「${wv ?? "-"}」${w.clarified ? `（work 澄清：${w.copyKind}:${w.clarificationLabel}）` : ""}`);
            }
          }
          if (w.path.split("|")[0] !== b.path.split("|")[0]) notes.push(`${tag} T${i + 1} path base=${b.path} work=${w.path}`);
          if (b.weatherDest && !w.weatherDest && KNOWN.has(b.weatherDest)) {
            p1.push(`${tag} T${i + 1} Weather 退步：base 以已確認「${b.weatherDest}」取天氣，work 不取`);
          } else if (b.weatherDest && !w.weatherDest && confirmedDest(b.weatherDest, m)) {
            diffExpected.push(`${tag} T${i + 1} weather: base 以 prefetch 當下未驗證的「${b.weatherDest}」取天氣（稍後驗證成功）→ work 不取`);
            ux.push(`${tag} T${i + 1} [第二組] 已驗證行政區首輪沒有天氣（work Weather 在 provider 驗證前執行）`);
          }
          if (w.noResultsLabel === "" && b.noResultsLabel !== "") {
            ux.push(`${tag} T${i + 1} [第二組] work noResults 文案目的地為空字串（base=${b.noResultsLabel ?? "-"}）`);
          }
        }
        if (w.clarified && w.clarificationLabel && /[看玩泛滑潛冷]/.test(w.clarificationLabel)) {
          ux.push(`${tag} T${i + 1} work 澄清文案「${w.copy}」`);
        }

        // ── T28 assertion（r2 原樣）──
        if (w.clarified && w.copyKind === "whichRegion") {
          const label = w.clarificationLabel ?? "";
          const parent = [...KNOWN].find((p) => label.startsWith(p) && label !== p);
          const sameClar = b && b.clarified && b.copyKind === "whichRegion" && b.clarificationLabel === label;
          if (parent) (sameClar ? notes : p1).push(`${tag} T${i + 1} 需求1：已知父城市「${parent}」仍以「哪個地區的${label}」澄清${sameClar ? "（與 base 相同；Authority 未將其視為可信父城市）" : ""}`);
        }
        if (w.sessionPendingKind === "destination_area" && w.sessionPendingLabel) {
          const parent = [...KNOWN].find((p) => w.sessionPendingLabel.startsWith(p) && w.sessionPendingLabel !== p);
          const samePending = b && b.sessionPendingKind === "destination_area" && b.sessionPendingLabel === w.sessionPendingLabel;
          if (parent) (samePending ? notes : p1).push(`${tag} T${i + 1} 需求2：已知父城市「${parent}」的尾段被存成 destination_area pending（${w.sessionPendingLabel}）${samePending ? "（與 base 相同）" : ""}`);
        }
        if (w.clarified && w.copyKind === "parentScopeConfirm") {
          if (w.sessionPendingKind !== "parent_city_scope" || !w.sessionPendingParent || w.sessionPendingParent !== w.clarificationLabel) {
            p1.push(`${tag} T${i + 1} 需求2：父城市確認的 pending 不一致 kind=${w.sessionPendingKind} parent=${w.sessionPendingParent} label=${w.clarificationLabel}`);
          }
          if (!KNOWN.has(w.clarificationLabel)) p1.push(`${tag} T${i + 1} 需求1：父城市確認的城市「${w.clarificationLabel}」不是已知城市`);
        }
        if (/rejected/.test(w.turnResolution ?? "")) p1.push(`${tag} T${i + 1} 需求6：turn resolution 出現 rejected（${w.turnResolution}）`);
        if (w.pendingBefore && w.sessionPendingKind) {
          const after = `${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}`;
          if (after === w.pendingBefore) {
            p1.push(`${tag} T${i + 1} 需求5：回答「${w.text}」後 Session 仍保留同一個 pending（${after}；${w.clarified ? "本輪重新建立" : "未清除"}）`);
          }
        }
        for (const p of KNOWN) {
          const fields = [
            w.searchDest,
            w.weatherDest,
            w.creditsDest,
            w.sessionDest,
            w.sessionRecDest,
            w.noResultsLabel,
            w.builderUserText,
            ...w.geocodes.map((g) => g.slice(g.indexOf(":") + 1)),
            ...w.placesQueries.flatMap((q) => [q.slice(0, q.lastIndexOf("@")), q.slice(q.lastIndexOf("@") + 1)]),
          ];
          const dup = new RegExp(`${p}[\\s,，、]*${p}(?![市県縣都府])`);
          const hit = fields.find((f) => countOcc(f, p) >= 2 && dup.test(String(f ?? "")) && !/東京都/.test(String(f)));
          if (hit) p1.push(`${tag} T${i + 1} 父城市重複串接「${p}」：${String(hit).slice(0, 80)}`);
        }

        // ── r3 新增（每輪，work；不以 base 相同豁免）──
        if (w.pendingBefore) {
          if (w.memPendingAfter) p1.push(`${tag} T${i + 1} r3-C1：回答「${w.text}」後記憶體 nextSession.pendingClarification 未清除（${w.memPendingAfter}）`);
          if (!w.clarified && w.sessionPendingKind) p1.push(`${tag} T${i + 1} r3-C1：回答「${w.text}」後已 persist 的 pending 未清除（${w.sessionPendingKind}:${w.sessionPendingLabel}；path=${w.path}）`);
        }
        if (w.clarified && (w.copyKind === "parentScopeConfirm" || w.copyKind === "whichRegion")) {
          const rawLabel = w.sessionPendingLabel;
          for (const [field, v, prev] of [
            ["travelContext.destination", w.sessionDest, prevW?.sessionDest],
            ["tripPlanningContext.destination", w.sessionTripPlanningDest, prevW?.sessionTripPlanningDest],
            ["preferredArea", w.sessionPreferredArea, prevW?.sessionPreferredArea],
            ["tripDestination.city", w.sessionTripDestCity, prevW?.sessionTripDestCity],
            ["tripDestination.displayLabel", w.sessionTripDestLabel, prevW?.sessionTripDestLabel],
          ]) {
            if (!v) continue;
            const containsRaw =
              rawLabel && !KNOWN.has(rawLabel) && (w.sessionPendingKind === "parent_city_scope" ? String(v).includes(rawLabel) : v === rawLabel);
            const newUnconfirmed = v !== (prev ?? null) && !confirmedDest(v, m);
            if (containsRaw || newUnconfirmed) p1.push(`${tag} T${i + 1} r3-C2：澄清輪 Session ${field} 寫入未確認「${v}」（pending raw=${rawLabel ?? "-"}；前一輪=${prev ?? "-"}）`);
          }
        }
        if (w.continuationDest && !confirmedDest(w.continuationDest, m)) {
          p1.push(`${tag} T${i + 1} r3-C4：more_places 使用未確認目的地「${w.continuationDest}」（path=${w.path}）`);
        }

        // ── r4 新增（每輪，work 與 pre 同一套）──
        const spec = turnSpec(s, i);
        const realUserTurn = !spec.ui && (spec.source === undefined || spec.source === "user") && String(spec.text ?? "").trim() !== "";
        const afterKey = w.sessionPendingKind ? `${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}` : null;
        // r4-EP：使用者自由輸入的一輪（含所有 early return）結束後，開始時已存在的地理 pending 必須已消費（本輪重新澄清除外）
        if (realUserTurn && w.pendingAtStart && !w.pendingAtStartLegacy && !w.clarified && afterKey) {
          p1.push(`${tag} T${i + 1} r4-EP：「${w.text}」結束後 persisted pending 未消費（start=${w.pendingAtStart} after=${afterKey}；path=${w.path}）→ 下一輪「好」可復活`);
        }
        // r4-UI：不成輪次的操作（空字串／要求登入／in-flight）與 UI 聊聊地點，不得改變 pending
        const nonTurn = spec.ui === "inflight" || spec.ui === "authBlocked" || spec.ui === "placeDetail" || (!spec.ui && String(spec.text ?? "").trim() === "");
        if (nonTurn && (w.pendingAtStart ?? null) !== afterKey) {
          p1.push(`${tag} T${i + 1} r4-UI：無關 UI 操作改變了 pending（start=${w.pendingAtStart ?? "-"} after=${afterKey ?? "-"}；path=${w.path}）`);
        }
        // r4-SRC：source 非 user 的輪次，F4 不得改變行為（與 pre 比較）
        if (WT === "work" && spec.source && spec.source !== "user") {
          const pr = P[i];
          const sig = (t) => (t ? JSON.stringify([t.sessionPendingKind, t.sessionPendingParent, t.searchDest, t.creditsDest, t.creditsBegin, t.path]) : "skipped");
          if (sig(w) !== sig(pr)) p1.push(`${tag} T${i + 1} r4-SRC：F4 改變 source=${spec.source} 輪次行為 work=${sig(w)} pre=${sig(pr)}`);
        }
        // r4-C3：澄清輪不得清除／改寫前一輪已確認的 tripPlanningContext / preferredArea / tripDestination.city（P2-1 #3、P2-5 A）
        if (w.clarified && (w.copyKind === "parentScopeConfirm" || w.copyKind === "whichRegion") && prevW) {
          for (const [field, v, prev] of [
            ["tripPlanningContext.destination", w.sessionTripPlanningDest, prevW.sessionTripPlanningDest],
            ["preferredArea", w.sessionPreferredArea, prevW.sessionPreferredArea],
            ["tripDestination.city", w.sessionTripDestCity, prevW.sessionTripDestCity],
          ]) {
            if (prev && confirmedDest(prev, m) && v !== prev) {
              p1.push(`${tag} T${i + 1} r4-C3：澄清輪把已確認的 ${field}「${prev}」改為「${v ?? "-"}」`);
            }
          }
        }
        // r5 review probe（不計 P1）：pushDC 前本輪已 persist 的路徑（before 污染）實際發生
        if (WT === "work" && w.beforeProbe && w.beforeProbe.midTurnPersisted) {
          reviewProbe.push(`${tag} T${i + 1} [r5 before 污染路徑實際發生] path=${w.path} 以 sessionRef.current（F5 前）會留下京都欄位=[${(w.beforeProbe.viaRef ?? []).join(",")}]；以 turnStartSession（F5）=[${(w.beforeProbe.viaStart ?? []).join(",")}]`);
        }
        // review probe（不計 P1）：L10450 → L10677 / L10817 路徑（sessionRef.current 已含本輪 nextSession）
        if (WT === "work" && w.altLater && w.mainClar && JSON.stringify(w.altLater) !== JSON.stringify(w.mainClar)) {
          reviewProbe.push(`${tag} T${i + 1} 主路徑=${JSON.stringify(w.mainClar)} L10450 路徑=${JSON.stringify(w.altLater)} merged=${JSON.stringify(w.mergedClar)} 前一輪 tpc/pref/trip=${prevW?.sessionTripPlanningDest ?? "-"}/${prevW?.sessionPreferredArea ?? "-"}/${prevW?.sessionTripDestCity ?? "-"}`);
        }
      }

      // ── 情境級 expect（r2 / r3 原樣）──
      const e = s.expect;
      if (e) {
        const raw = e.raw;
        const parent = e.parent;
        const tail = raw && parent && raw.startsWith(parent) ? raw.slice(parent.length) : null;
        if (e.parentAsk) {
          const w = W[e.parentAsk.turn];
          if (w?.clarified) {
            if (w.copyKind !== "parentScopeConfirm" || w.clarificationLabel !== e.parentAsk.parent || w.sessionPendingKind !== "parent_city_scope") {
              p1.push(`${tag} T${e.parentAsk.turn + 1} 需求1/2：應為父城市範圍確認(${e.parentAsk.parent})，實際 ${w.copyKind}:${w.clarificationLabel} pending=${w.sessionPendingKind}`);
            }
          } else if (w) {
            const searchedParent = w.searchDest === e.parentAsk.parent;
            (searchedParent ? notes : p1).push(`${tag} T${e.parentAsk.turn + 1} 需求1：未詢問父城市範圍確認（search=${w.searchDest ?? "-"} path=${w.path}）${searchedParent ? "；直接以已確認父城市搜尋" : ""}`);
          }
          if (w?.searchDest && raw && w.searchDest.includes(raw)) p1.push(`${tag} T${e.parentAsk.turn + 1} 需求6：未確認整串「${raw}」被當成搜尋目的地`);
        }
        if (e.confirm) {
          const i = e.confirm.turn;
          const w = W[i];
          const askTurn = W[e.parentAsk?.turn ?? i - 1];
          if (!w) {
            if (askTurn?.clarified) p1.push(`${tag} T${i + 1} 回答輪缺失`);
          } else {
            if (w.clarified) p1.push(`${tag} T${i + 1} 需求5：確認後再次澄清（${w.copyKind}:${w.clarificationLabel}）`);
            if (w.searchDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：確認後沒有用父城市「${e.confirm.parent}」搜尋（search=${w.searchDest ?? "-"} path=${w.path}）`);
            if (w.builderCalls < 1) p1.push(`${tag} T${i + 1} 需求3：確認後沒有呼叫 Places builder（path=${w.path}）`);
            if (w.creditsDest && w.creditsDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Credits metadata.destination=${w.creditsDest}`);
            if (w.weatherDest && w.weatherDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Weather=${w.weatherDest}`);
            if (m.search === "ok" && w.sessionDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Session destination=${w.sessionDest ?? "-"}（應為 ${e.confirm.parent}）`);
            if (m.search === "ok" && w.sessionRecDest !== e.confirm.parent) p1.push(`${tag} T${i + 1} 需求3：Session recommendation destination=${w.sessionRecDest ?? "-"}`);
            if (w.sessionPendingKind) p1.push(`${tag} T${i + 1} 需求5：確認後 pending 未清除（${w.sessionPendingKind}）`);
            if (w.noResultsLabel && w.noResultsLabel !== e.confirm.parent) p1.push(`${tag} T${i + 1} noResults 目的地=${w.noResultsLabel}`);
            for (const q of [...w.placesQueries, ...w.geocodes]) {
              if (raw && q.includes(raw)) p1.push(`${tag} T${i + 1} 需求3：未確認整串「${raw}」進入 Google：${q}`);
              else if (tail && q.includes(tail)) p1.push(`${tag} T${i + 1} 需求3：未確認尾段「${tail}」進入 Google：${q}`);
            }
            const confirmRawLabels = [raw, askTurn?.sessionPendingLabel].filter((x) => x && !KNOWN.has(x));
            for (const [field, v] of [
              ["travelContext.destination", w.sessionDest],
              ["tripPlanningContext.destination", w.sessionTripPlanningDest],
              ["preferredArea", w.sessionPreferredArea],
              ["tripDestination.city", w.sessionTripDestCity],
              ["tripDestination.displayLabel", w.sessionTripDestLabel],
            ]) {
              const hit = v && confirmRawLabels.find((u) => String(v).includes(u));
              const tailHit = v && tail && String(v).includes(tail);
              if (hit || tailHit) p1.push(`${tag} T${i + 1} r3-C2+：確認後 Session ${field} 殘留未確認標籤「${v}」（raw=${confirmRawLabels.join("/")}）`);
            }
            const original = askTurn?.sessionPendingOriginal ?? null;
            if (askTurn?.sessionPendingKind === "parent_city_scope") {
              if (w.builderIntent == null) p1.push(`${tag} T${i + 1} 需求4：確認後 builder 沒有收到意圖`);
              if (w.builderUserText !== original && !(w.builderUserText ?? "").startsWith(e.confirm.parent)) {
                p1.push(`${tag} T${i + 1} 需求4：確認後 userText「${w.builderUserText}」既不是原句「${original}」也不是父城市需求句`);
              }
              if (w.builderUserText !== original) notes.push(`${tag} T${i + 1} 需求4：確認後 userText 改為「${w.builderUserText}」（原句「${original}」）`);
            }
          }
        }
        if (e.cleared) {
          const i = e.cleared.turn;
          const w = W[i];
          if (w) {
            if (w.sessionPendingKind && `${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}` === w.pendingBefore) {
              p1.push(`${tag} T${i + 1} 需求5：否定／無法解析後 Session 仍保留原 pending（${w.pendingBefore}）`);
            }
            if (w.clarified && w.sessionPendingKind && (w.sessionPendingLabel === raw || w.sessionPendingParent === e.cleared.parent) && !/大阪/.test(w.text)) {
              p1.push(`${tag} T${i + 1} 需求5：同一回合重新建立澄清（${w.copyKind}:${w.clarificationLabel}）`);
            }
            if (e.cleared.parent && w.searchDest === e.cleared.parent && !w.text.includes(e.cleared.parent)) {
              p1.push(`${tag} T${i + 1} 需求5：否定／無法解析仍以「${e.cleared.parent}」搜尋`);
            }
            if (w.searchDest && raw && w.searchDest.includes(raw)) p1.push(`${tag} T${i + 1} 需求6：未確認整串被搜尋`);
          } else if (R3_IDS.has(s.id) && W[i - 1]?.clarified) {
            p1.push(`${tag} T${i + 1} r3：回答輪缺失`);
          }
        }
        if (e.area) {
          const w = W[e.area.turn];
          if (!w) p1.push(`${tag} T${e.area.turn + 1} 需求9：沒有出現回答輪（首輪未澄清）`);
          else {
            if (w.clarified) p1.push(`${tag} T${e.area.turn + 1} 需求9：回答後再次澄清（${w.copyKind}:${w.clarificationLabel}）`);
            if (w.sessionPendingKind) p1.push(`${tag} T${e.area.turn + 1} 需求9：回答後 pending 未清除`);
            if (m.geo === "ok" && (w.searchDest !== e.area.dest || w.builderCalls < 1)) {
              p1.push(`${tag} T${e.area.turn + 1} 需求9：ok 模式未以「${e.area.dest}」推薦（search=${w.searchDest ?? "-"} path=${w.path}）`);
            }
            if (m.geo !== "ok" && !w.searchDest) notes.push(`${tag} T${e.area.turn + 1} 需求9：provider 失敗模式回答後未搜尋（noResults=${w.noResultsLabel ?? "-"}；base search=${B[e.area.turn]?.searchDest ?? "-"}）`);
          }
        }
        for (const c of e.search ?? []) {
          const w = W[c.turn];
          if (!w || w.searchDest !== c.dest) p1.push(`${tag} T${c.turn + 1} 應搜尋「${c.dest}」，實際 search=${w?.searchDest ?? "-"} path=${w?.path ?? "(skipped)"}`);
          if (w && m.search === "ok" && w.sessionDest !== c.dest) p1.push(`${tag} T${c.turn + 1} Session 跨城市：session=${w.sessionDest ?? "-"}（應為 ${c.dest}）`);
          if (w) {
            for (const f of [w.weatherDest, w.creditsDest, w.sessionRecDest, ...w.placesQueries]) {
              if (f && parent && parent !== c.dest && String(f).includes(parent) && m.search === "ok") p1.push(`${tag} T${c.turn + 1} Session 跨城市污染：「${parent}」出現在 ${String(f).slice(0, 60)}`);
            }
          }
        }
        for (const c of e.notSearch ?? []) {
          const w = W[c.turn];
          if (w && (w.searchDest === c.dest || w.continuationDest === c.dest)) {
            p1.push(`${tag} T${c.turn + 1} 需求5/跨城市：舊 pending／舊城市復活，以「${c.dest}」搜尋（path=${w.path} pendBefore=${w.pendingBefore ?? "-"}）`);
          }
        }
        for (const c of e.cont ?? []) {
          const w = W[c.turn];
          if (!w || w.continuationDest !== c.dest) p1.push(`${tag} T${c.turn + 1} Continuation 目的地應為「${c.dest}」，實際 ${w?.continuationDest ?? "-"}（path=${w?.path ?? "(skipped)"}）`);
        }
        if (e.noUnconfirmed && raw) {
          W.forEach((w, i) => {
            if (!w) return;
            const fields = [
              ["search", w.searchDest],
              ["continuation", w.continuationDest],
              ["weather", w.weatherDest],
              ["credits", w.creditsDest],
              ...w.geocodes.filter((g) => !g.startsWith("dc_validate:")).map((g) => ["geocode", g]),
              ...w.placesQueries.map((q) => ["places", q]),
            ];
            for (const [k, v] of fields) {
              if (v && String(v).includes(raw)) p1.push(`${tag} T${i + 1} 需求3/6：未確認整串「${raw}」進入 ${k}：${String(v).slice(0, 80)}（path=${w.path}）`);
            }
          });
        }
        for (const [label, wv, bv] of [["geocode", sc.wg, sc.bg], ["Places(builder)", sc.wb, sc.bb], ["Places(requests)", sc.wp, sc.bp]]) {
          if (wv > bv) (sc.bb === 0 ? costNotes : p1).push(`${tag} 情境總 ${label} work=${wv} > base=${bv}${sc.bb === 0 ? `（base 整個情境從未呼叫 Places${baseLooped ? "，且澄清迴圈" : ""}）` : ""}`);
        }
        for (const ti of e.noSearch ?? []) {
          const w = W[ti];
          if (!w) {
            if (W[ti - 1]?.clarified || ti > 1) p1.push(`${tag} T${ti + 1} r3-C8：預期送出的輪次缺失`);
            continue;
          }
          if (w.searchDest || w.builderCalls || w.placesRequests || w.creditsBegin || w.continuationDest) {
            p1.push(`${tag} T${ti + 1} r3-C8：「${w.text}」不得觸發搜尋，實際 search=${w.searchDest ?? "-"} cont=${w.continuationDest ?? "-"} builder=${w.builderCalls} places=${w.placesRequests} credits=${w.creditsBegin}（path=${w.path} ans=${w.answerKind ?? "-"}）`);
          }
        }
        if (e.meal) {
          const w = W[e.meal.turn];
          if (w) {
            const firstMeal = W[0]?.textMeal;
            if (firstMeal?.slot !== e.meal.slot) notes.push(`${tag} r3-C6：原句 meal slot=${firstMeal?.slot ?? "-"}（預期 ${e.meal.slot}）`);
            if (w.builderCalls > 0) {
              if (w.builderMeal?.slot !== e.meal.slot) p1.push(`${tag} T${e.meal.turn + 1} r3-C6：確認後餐別未保留（builderText=${w.builderUserText} meal=${JSON.stringify(w.builderMeal)}，預期 ${e.meal.slot}）`);
              if (w.builderMeal?.city && w.builderMeal.city !== parent) p1.push(`${tag} T${e.meal.turn + 1} r3-C6：meal parser city=${w.builderMeal.city}（應為 ${parent}）`);
              if (raw && String(w.builderUserText ?? "").includes(raw)) notes.push(`${tag} T${e.meal.turn + 1} r3-C6：builder userText 仍含「${raw}」：${w.builderUserText}`);
            }
          }
        }
        // ── r4 新增 expect ──
        for (const ti of e.pendingEmpty ?? []) {
          const w = W[ti];
          if (!w) {
            p1.push(`${tag} T${ti + 1} r4：預期送出的輪次缺失（前一輪未澄清？）`);
            continue;
          }
          if (w.sessionPendingKind) p1.push(`${tag} T${ti + 1} r4-pendingEmpty：「${w.text}」後 persisted pending 仍在（${w.sessionPendingKind}:${w.sessionPendingParent ?? ""}:${w.sessionPendingLabel}；path=${w.path}）`);
        }
        for (const ti of e.pendingKept ?? []) {
          const w = W[ti];
          if (!w) continue;
          if (!w.sessionPendingKind || w.pendingAtStart == null) p1.push(`${tag} T${ti + 1} r4-pendingKept：「${w.text}」後 pending 被清除（start=${w.pendingAtStart ?? "-"}；path=${w.path}）`);
        }
        for (const c of e.noCreditsDest ?? []) {
          const w = W[c.turn];
          if (w && w.creditsDest === c.dest) p1.push(`${tag} T${c.turn + 1} r4：以「${c.dest}」扣 Credits（path=${w.path}）`);
        }
        for (const c of e.searchIn ?? []) {
          const w = W[c.turn];
          if (w && !c.dests.includes(w.searchDest ?? null)) p1.push(`${tag} T${c.turn + 1} r4-searchIn：search=${w.searchDest}（允許 ${c.dests.map((d) => d ?? "不搜尋").join("/")}；path=${w.path}）`);
        }
        if (e.notSessionDest) {
          for (const ti of e.notSessionDest.turns) {
            const w = W[ti];
            if (!w) continue;
            for (const [field, v] of [
              ["travelContext.destination", w.sessionDest],
              ["recommendation", w.sessionRecDest],
              ["tripPlanningContext.destination", w.sessionTripPlanningDest],
              ["preferredArea", w.sessionPreferredArea],
              ["tripDestination.city", w.sessionTripDestCity],
              ["tripDestination.displayLabel", w.sessionTripDestLabel],
            ]) {
              if (v && v === e.notSessionDest.dest) p1.push(`${tag} T${ti + 1} r4-P2-5：Session ${field}=「${v}」（「${e.notSessionDest.dest}」只存在於被拒絕的 pending）`);
            }
          }
        }
        if (e.keepSessionDest) {
          for (const ti of e.keepSessionDest.turns) {
            const w = W[ti];
            if (!w) continue;
            // 前提：前一輪 Session 正式欄位確實已有該可信目的地（ok-empty 等模式首輪沒有 persist，A 的前提不成立）
            const pw = W[ti - 1];
            const prevVals = pw ? [pw.sessionDest, pw.sessionRecDest, pw.sessionTripPlanningDest, pw.sessionPreferredArea, pw.sessionTripDestCity] : [];
            if (!prevVals.includes(e.keepSessionDest.dest)) continue;
            const vals = [w.sessionDest, w.sessionRecDest, w.sessionTripPlanningDest, w.sessionPreferredArea, w.sessionTripDestCity];
            if (!vals.includes(e.keepSessionDest.dest)) p1.push(`${tag} T${ti + 1} r4-P2-5A：可信的「${e.keepSessionDest.dest}」從 Session 正式欄位消失（${vals.map((v) => v ?? "-").join("/")}）`);
          }
        }
        // ── r5 新增 expect ──
        if (e.notDerived) {
          for (const ti of e.notDerived.turns) {
            const w = W[ti];
            if (!w) continue;
            for (const [field, v] of [
              ["travelContext.destinationCity", w.sessionCtxCity],
              ["travelContext.destinationRegion", w.sessionCtxRegion],
              ["travelContext.currentLocation", w.sessionCurrentLocation],
              ["location.city", w.sessionLocation?.city],
            ]) {
              if (v && String(v).includes(e.notDerived.dest)) p1.push(`${tag} T${ti + 1} r5-P2-5B：Session 衍生欄位 ${field}=「${v}」（「${e.notDerived.dest}」只存在於被拒絕的 pending）`);
            }
          }
        }
        if (e.locKeep) {
          const GPS_LAT = 24.18;
          const GPS_LNG = 120.62;
          for (const ti of e.locKeep.turns) {
            const w = W[ti];
            if (!w) continue;
            const loc = w.sessionLocation;
            if (e.locKeep.latlng && (!loc || loc.lat !== GPS_LAT || loc.lng !== GPS_LNG)) p1.push(`${tag} T${ti + 1} r5-LOC：使用者真實位置座標被清除／改寫（location=${JSON.stringify(loc)}）`);
            if (e.locKeep.notCity && (loc?.city === e.locKeep.notCity || w.sessionCurrentLocation === e.locKeep.notCity)) p1.push(`${tag} T${ti + 1} r5-LOC：位置被改成「${e.locKeep.notCity}」（location.city=${loc?.city ?? "-"} currentLocation=${w.sessionCurrentLocation ?? "-"}）`);
            if (e.locKeep.cityEq && loc?.city !== e.locKeep.cityEq) p1.push(`${tag} T${ti + 1} r5-LOC：location.city=${loc?.city ?? "-"}（應保留 ${e.locKeep.cityEq}）`);
            if (e.locKeep.curEq && w.sessionCurrentLocation !== e.locKeep.curEq) p1.push(`${tag} T${ti + 1} r5-LOC：travelContext.currentLocation=${w.sessionCurrentLocation ?? "-"}（應保留 ${e.locKeep.curEq}）`);
          }
        }
        if (e.gpsKept) {
          for (const ti of e.gpsKept.turns) {
            const w = W[ti];
            if (!w) continue;
            const loc = w.sessionLocation;
            const valid = loc && loc.lat != null && loc.lng != null && (Math.abs(loc.lat) > 0.001 || Math.abs(loc.lng) > 0.001);
            if (!valid) p1.push(`${tag} T${ti + 1} r5-LOC：本輪取得的 GPS 位置未保存（location=${JSON.stringify(loc)}；path=${w.path}）`);
          }
        }
        // ── r6 新增 expect ──
        if (e.viaRetry) {
          for (const ti of e.viaRetry.turns) {
            const w = W[ti];
            const how = w?.viaRetry
              ? `經 retry（reason=${w.fallbackReason}）clar=${w.clarified ? `Y(${w.copyKind}:${w.clarificationLabel})` : "N"} beforeProbe=${JSON.stringify(w.beforeProbe)} kyotoFields=[${(w.kyotoFields ?? []).join("; ")}] loc=${JSON.stringify(w.sessionLocation)} cur=${w.sessionCurrentLocation ?? "-"} path=${w.path}`
              : `未經 retry（前提不成立）path=${w?.path ?? "(skipped)"}`;
            R6_RETRY.push(`${WT.padEnd(5)} ${tag} T${ti + 1} ${how}`);
            if (!w?.viaRetry) notes.push(`${tag} T${ti + 1} r6-retry：前提不成立（path=${w?.path ?? "(skipped)"}）`);
          }
        }
        for (const ti of e.kyotoFree?.turns ?? []) {
          const w = W[ti];
          if (!w) continue;
          const hits = (w.kyotoFields ?? []).filter((f) => !/^pendingClarification=/.test(f));
          if (hits.length) p1.push(`${tag} T${ti + 1} r6-KYOTO：拒絕後 Session 仍含「京都」欄位 [${hits.join("; ")}]（path=${w.path}）`);
        }
        if (e.areaKeep) {
          const from = W[e.areaKeep.from];
          const re = new RegExp(e.areaKeep.match);
          if (from) {
            for (const ti of e.areaKeep.turns) {
              const w = W[ti];
              if (!w) continue;
              for (const field of ["sessionDest", "sessionRecDest", "sessionTripPlanningDest", "sessionPreferredArea", "sessionTripDestCity", "sessionCtxCity", "sessionCtxRegion"]) {
                const v0 = from[field];
                if (v0 && re.test(String(v0)) && w[field] !== v0) p1.push(`${tag} T${ti + 1} r5-AREA：合法行政區欄位 ${field}「${v0}」被改為「${w[field] ?? "-"}」`);
              }
            }
          }
        }
        for (const c of e.searchPrefix ?? []) {
          const w = W[c.turn];
          if (w && w.searchDest && !c.prefixes.some((p) => w.searchDest.startsWith(p))) p1.push(`${tag} T${c.turn + 1} r5-AREA：search=${w.searchDest}（應為 ${c.prefixes.join("/")} 開頭或不搜尋；path=${w.path}）`);
        }
      }
      {
        const parentRaw = new Set();
        const areaRaw = new Set();
        if (s.expect?.raw) parentRaw.add(s.expect.raw);
        W.forEach((w) => {
          if (!w || !w.sessionPendingLabel || KNOWN.has(w.sessionPendingLabel)) return;
          if (w.sessionPendingKind === "parent_city_scope") parentRaw.add(w.sessionPendingLabel);
          if (w.sessionPendingKind === "destination_area") areaRaw.add(w.sessionPendingLabel);
        });
        W.forEach((w, i) => {
          if (!w) return;
          const fields = [
            ["search", w.searchDest],
            ["credits", w.creditsDest],
            ["weather", w.weatherDest],
            ["continuation", w.continuationDest],
            ...w.placesQueries.map((q) => ["places", q]),
            ...w.geocodes.filter((g) => /^(weather|builder):/.test(g)).map((g) => ["geocode(weather/builder)", g]),
          ];
          for (const [k, v] of fields) {
            if (!v) continue;
            for (const u of parentRaw) if (String(v).includes(u)) p1.push(`${tag} T${i + 1} r3-C3/C5：未確認「${u}」進入 ${k}：${String(v).slice(0, 80)}（path=${w.path}）`);
            for (const u of areaRaw) if (["search", "credits", "weather", "continuation"].includes(k) && v === u) p1.push(`${tag} T${i + 1} r3-C3/C5：未確認地區「${u}」進入 ${k}（path=${w.path}）`);
          }
        });
      }
      if (s.id === "14") {
        const w = W[0];
        const b = B[0];
        if (w.path !== b.path) p1.push(`${tag} Planner path 改變 base=${b.path} work=${w.path}`);
        if ((w.weatherDest ?? null) !== (b.weatherDest ?? null)) notes.push(`${tag} Planner weather base=${b.weatherDest ?? "-"} work=${w.weatherDest ?? "-"}`);
      }
      const group = isT27 ? "T27" : R3_IDS.has(s.id) ? "R3" : R4_IDS.has(s.id) ? "R4" : R5_IDS.has(s.id) ? "R5" : R6_IDS.has(s.id) ? "R6" : "T28";
      modeStats[m.id] ??= { T27: [0, 0], T28: [0, 0], R3: [0, 0], R4: [0, 0], R5: [0, 0], R6: [0, 0] };
      const scenP1 = [...new Set(p1.slice(p1Start))];
      p1ByScenario.set(`${s.id}|${m.id}`, scenP1);
      modeStats[m.id][group][scenP1.length ? 1 : 0] += 1;
      if (NO_ROWS || (p1.length === p1Start && !(ROWS_ALL || ROWS?.has(s.id)))) rows.length = rowStart;
      const short = (t) => (t ? `${t.clarified ? `澄清(${t.copyKind}:${t.clarificationLabel})` : t.searchDest ? `搜尋${t.searchDest}` : t.continuationDest ? `續推${t.continuationDest}` : t.noResultsLabel != null ? `noResults(${t.noResultsLabel})` : t.path.slice(0, 30)}${t.sessionPendingKind ? "[P]" : ""}` : "—");
      summary.push(`${tag.padEnd(40)} ${WT === "work" ? "W" : "PRE"}: ${W.map(short).join(" → ")}${WT === "work" ? ` || PRE: ${P.map(short).join(" → ")}` : ""} || B: ${B.map(short).join(" → ")}`);
    }
  }
  return { p1, p1ByScenario, diffExpected, ux, notes, costNotes, rows, providerDiff, reviewProbe, totals, summary, modeStats };
}

const J = { work: judge("work"), pre: judge("pre"), ...(WITH_PRE5 ? { pre5: judge("pre5") } : {}), ...(WITH_PRE4 ? { pre4: judge("pre4") } : {}) };
for (const h of extHits) {
  J.work.p1.push(h);
  J.pre.p1.push(h);
  if (J.pre4) J.pre4.p1.push(h);
  if (J.pre5) J.pre5.p1.push(h);
}
if (!mockKeyOk) J.work.p1.push("子程序 Mock Key 未生效");
// r6-Δ5：真實模組 probe 的 GPS A/B/C 判定（各樹各自判定，計入該樹 P1；訊息不含數值以便 work/pre 對照，數值見 R6_PROBE_DETAIL）
const R6_PROBE_DETAIL = [];
{
  const GPSP = { lat: 24.18, lng: 120.62 };
  const valid = (l) => Boolean(l) && l.lat != null && l.lng != null && !(l.lat === 0 && l.lng === 0);
  const sameLL = (l, p) => Boolean(l) && l.lat === p.lat && l.lng === p.lng;
  const obj = (v) => v && typeof v === "object";
  for (const WT of Object.keys(J)) {
    const pr = modProbesByTree[WT];
    if (!pr) {
      J[WT].p1.push("[R6-PROBE] modProbes 缺失");
      continue;
    }
    const chk = (ok, msg, v) => {
      R6_PROBE_DETAIL.push(`${WT.padEnd(5)} ${ok ? "PASS" : "FAIL"} ${msg} → ${JSON.stringify(v)}`);
      if (!ok) J[WT].p1.push(`[R6-PROBE] ${msg}`);
    };
    const a1 = pr.a1_gpsAcquiredThisTurn;
    chk(obj(a1) && sameLL(a1.location, GPSP) && a1.currentLocation === "台中市", "A：本輪前無位置、本輪取得 GPS（台中市）→ location 與 currentLocation 必須保留", a1);
    const a2 = pr.a2_gpsAcquiredNoCity;
    chk(obj(a2) && sameLL(a2.location, GPSP), "A：本輪取得 GPS（無 city）→ 座標必須保留", a2);
    const a3 = pr.a3_prevNoCoordsThenGps;
    chk(obj(a3) && sameLL(a3.location, GPSP), "A：本輪前為 {0,0,大阪} 佔位、本輪取得 GPS → 座標必須保留", a3);
    const a4 = pr.a4_tripIntentKyotoNoPrev;
    chk(obj(a4) && !valid(a4.location) && a4.location?.city !== "京都" && a4.currentLocation !== "京都", "C：{0,0,京都} 佔位（本輪前無位置）不得留下 location／currentLocation=京都", a4);
    const b = pr.r6_B_gpsCityRewrite;
    chk(obj(b) && sameLL(b.location, GPSP) && b.location.city === "台中市" && b.currentLocation === "台中市", "B：本輪前 GPS 台中、applyTripIntent 改寫 city=京都 → city／currentLocation 必須退回台中市", b);
    const cp = pr.r6_C_placeholderPrevGps;
    chk(obj(cp) && sameLL(cp.location, GPSP) && cp.location.city === "台中市" && cp.currentLocation === "台中市", "C：本輪前 GPS 台中、本輪 location 變 {0,0,京都} → 必須退回本輪前 GPS", cp);
    const c = pr.c_newRealLocation;
    chk(obj(c) && Boolean(c.location) && c.location.lat === 34.69 && c.location.lng === 135.5, "A：本輪前 GPS 台中、本輪新真實位置（座標不同）→ 新座標保留", c);
  }
}
const uniq = (a) => [...new Set(a)];
const BRIEF = process.argv.includes("--brief");

// work vs pre（F5 前後）P1 與 Provider 對照
const groupOf = (id) => (T27_IDS.has(id) ? "T27" : R3_IDS.has(id) ? "R3" : R4_IDS.has(id) ? "R4" : R5_IDS.has(id) ? "R5" : R6_IDS.has(id) ? "R6" : "T28");
const p1W = new Set(uniq(J.work.p1));
const p1P = new Set(uniq(J.pre.p1));
const newInWork = [...p1W].filter((x) => !p1P.has(x));
const fixedByF5 = [...p1P].filter((x) => !p1W.has(x));
const countBy = (set, pred) => [...set].filter(pred).length;
const isR4Msg = (x) => /\[R4-/.test(x);
const isR5Msg = (x) => /\[R5-/.test(x);
const isR6Msg = (x) => /\[R6-/.test(x);
const isC2plus = (x) => /r3-C2\+/.test(x);
const p1P4 = J.pre4 ? new Set(uniq(J.pre4.p1)) : null;
const p1P5 = J.pre5 ? new Set(uniq(J.pre5.p1)) : null;
const providerWP = [];
const provTot = { work: { g: 0, w: 0, b: 0, p: 0, c: 0 }, pre: { g: 0, w: 0, b: 0, p: 0, c: 0 } };
for (const s of scenarios) {
  for (const m of MODES) {
    const tot = (tree) => {
      const turns = results[`${tree}|${m.id}|${s.id}`].result.turns;
      return turns.reduce((a, t) => ({ g: a.g + t.geocodes.length, w: a.w + t.weatherCalls, b: a.b + t.builderCalls, p: a.p + t.placesRequests, c: a.c + t.creditsBegin }), { g: 0, w: 0, b: 0, p: 0, c: 0 });
    };
    const w = tot("work");
    const p = tot("pre");
    for (const k of Object.keys(w)) {
      provTot.work[k] += w[k];
      provTot.pre[k] += p[k];
    }
    if (JSON.stringify(w) !== JSON.stringify(p)) providerWP.push(`[${s.id}][${m.id}] ${s.label}  geocode ${w.g}/${p.g} weather ${w.w}/${p.w} builder ${w.b}/${p.b} placesReq ${w.p}/${p.p} credits ${w.c}/${p.c}`);
  }
}
const newProviderCalls = providerWP.filter((l) => {
  const nums = [...l.matchAll(/(\d+)\/(\d+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
  return nums.slice(0, 4).some(([a, b]) => a > b);
});
const newGeocode = providerWP.filter((l) => {
  const m = l.match(/geocode (\d+)\/(\d+)/);
  return m && Number(m[1]) > Number(m[2]);
});
const newCredits = providerWP.filter((l) => {
  const m = l.match(/credits (\d+)\/(\d+)/);
  return m && Number(m[1]) > Number(m[2]);
});

// r6-Δ6：各樹 Provider 總數與 work 對各樹的新增（情境×mode 有 work > 該樹）
const PROV_TREES = {};
const provNew = {};
{
  const tot = (tr, s, m) =>
    results[`${tr}|${m.id}|${s.id}`].result.turns.reduce(
      (a, t) => ({ g: a.g + t.geocodes.length, w: a.w + t.weatherCalls, b: a.b + t.builderCalls, p: a.p + t.placesRequests, c: a.c + t.creditsBegin }),
      { g: 0, w: 0, b: 0, p: 0, c: 0 },
    );
  for (const tree of TREES) {
    PROV_TREES[tree] = { g: 0, w: 0, b: 0, p: 0, c: 0 };
    provNew[tree] = { any: 0, geocode: 0, credits: 0 };
    for (const s of scenarios) {
      for (const m of MODES) {
        const t = tot(tree, s, m);
        for (const k of Object.keys(t)) PROV_TREES[tree][k] += t[k];
        if (tree === "work") continue;
        const w = tot("work", s, m);
        if (w.g > t.g || w.w > t.w || w.b > t.b || w.p > t.p) provNew[tree].any += 1;
        if (w.g > t.g) provNew[tree].geocode += 1;
        if (w.c > t.c) provNew[tree].credits += 1;
      }
    }
  }
}
const out = ["［r6］本輸出沿用 r5 標籤：凡標示「F5 後」= work（F6 後）、「F5 前」/ pre = F6 前備份；pre5 = F5 前、pre4 = F4 前（可選）"];
out.push(`══ source anchors（重建對照行號；work=F5 後 / pre=F5 前備份 / base=aa2db59${WITH_PRE4 ? " / pre4=F4 前備份" : ""}）══`, ...anchorLines);
out.push("\n══ F5 前 sha 快照比對（與快照不同的 src 檔）══", ...(shaDiff.length ? shaDiff : ["(none)"]));
out.push("\n══ 真實模組 probe：withoutUnconfirmedSessionDestinations（程式碼審查 (a)(b)(c)）══");
for (const [tree, probes] of Object.entries(modProbesByTree)) for (const [k, v] of Object.entries(probes)) out.push(`${tree.padEnd(5)} ${k}: ${JSON.stringify(v)}`);
out.push("\n══ 模組依賴圖 ══", ...graphReport);
out.push(`\n══ overlay 實際生效的檔案 ══`, `pre: ${[...overlayHitsAll.pre].sort().join(", ") || "(none)"}`, ...(WITH_PRE4 ? [`pre4: ${[...overlayHitsAll.pre4].sort().join(", ") || "(none)"}`] : []), `base: ${[...overlayHitsAll.base].sort().join(", ") || "(none)"}`);
out.push("\n══ work/pre/base 逐情境逐輪對照（只列 work 有 P1 的情境，或 --rows 指定）══", ...J.work.rows);
out.push("\n══ 情境摘要（W=work=F5 後 / PRE=F5 前 / B=base；[P]=persisted pending 仍在）══", ...J.work.summary);
out.push("\n══ Provider 呼叫總數（work / base）══");
for (const [mid, t] of Object.entries(J.work.totals)) {
  out.push(`${mid.padEnd(9)} geocode ${t.wg}/${t.bg}  weather ${t.ww}/${t.bw}  builder(Places) ${t.wb}/${t.bb}  placesRequests ${t.wp}/${t.bp}  credits.begin ${t.wc}/${t.bc}`);
}
out.push("\n══ Provider 呼叫有差異的情境（work/base）══", ...(J.work.providerDiff.length ? (BRIEF ? [`(brief) ${J.work.providerDiff.length} 條`] : J.work.providerDiff) : ["(none)"]));
out.push("\n══ Provider 呼叫 work(F5 後) / pre(F5 前) ══");
out.push(`總計 geocode ${provTot.work.g}/${provTot.pre.g} weather ${provTot.work.w}/${provTot.pre.w} builder(Places) ${provTot.work.b}/${provTot.pre.b} placesRequests ${provTot.work.p}/${provTot.pre.p} credits.begin ${provTot.work.c}/${provTot.pre.c}`);
out.push(...(providerWP.length ? providerWP : ["(work 與 pre 每個情境每個 mode 的 Provider 呼叫數完全相同)"]));
out.push("\n══ 外部請求攔截 ══");
out.push(`fetch=${extTotals.fetch} http=${extTotals.http} https=${extTotals.https} net=${extTotals.net} tls=${extTotals.tls} undici=${extTotals.undici}  undici 可載入=${undiciLoadedAll}  mockKey=${mockKeyOk ? "OK" : "FAIL"}  子程序清除的金鑰類變數=${envScrubbedAny.size ? [...envScrubbedAny].join(",") : "(none)"}`);
out.push(...(extHits.length ? extHits.slice(0, 40) : ["(no external request)"]));
out.push("\n══ P1（work = F5 後）══", ...(p1W.size ? [...p1W] : ["(none)"]));
out.push("\n══ work 新增 P1（pre 沒有）══", ...(newInWork.length ? newInWork : ["(none)"]));
out.push("\n══ F5 消除的 P1（pre 有、work 沒有）══", ...(fixedByF5.length ? fixedByF5 : ["(none)"]));
out.push("\n══ P1（pre = F6 前，僅 R4/R5/R6 情境；其餘見計數）══", ...([...p1P].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)).length ? [...p1P].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)) : ["(none)"]));
if (p1P4) out.push(`\n══ pre4（F4 前）P1=${p1P4.size}（僅列 R4/R5 情境）══`, ...[...p1P4].filter((x) => isR4Msg(x) || isR5Msg(x)));
if (p1P5) out.push(`\n══ pre5（F5 前）P1=${p1P5.size}（僅列 R4/R5/R6 情境）══`, ...[...p1P5].filter((x) => isR4Msg(x) || isR5Msg(x) || isR6Msg(x)));
out.push("\n══ REVIEW-PROBE：pushDC 前本輪已 persist 的路徑（before 污染），與 L10450 路徑 probe（不計 P1）══", ...(uniq(J.work.reviewProbe).length ? uniq(J.work.reviewProbe) : ["(none)"]));
out.push("\n══ COST-NOTE ══", ...(uniq(J.work.costNotes).length ? uniq(J.work.costNotes) : ["(none)"]));
out.push("\n══ DIFF-expected（base 使用未確認目的地，work 不再使用）══", ...(BRIEF ? [`(brief) ${uniq(J.work.diffExpected).length} 條`] : uniq(J.work.diffExpected).length ? uniq(J.work.diffExpected) : ["(none)"]));
out.push("\n══ UX 風險 ══", ...(uniq(J.work.ux).length ? (BRIEF ? [`(brief) ${uniq(J.work.ux).length} 條`] : uniq(J.work.ux)) : ["(none)"]));
out.push("\n══ 其他差異／備註 ══", ...(BRIEF ? uniq(J.work.notes).filter((x) => /需求|base 有此輪|迴圈|r3|r4/.test(x)).filter((x) => /\[R[45]-/.test(x) || !/與 base 相同/.test(x)) : uniq(J.work.notes).length ? uniq(J.work.notes) : ["(none)"]));
for (const WT of Object.keys(J)) {
  out.push(`\n══ 每 mode PASS/FAIL（${WT}；情境數；FAIL＝該情境該 mode 有 P1）══`);
  for (const [mid, st] of Object.entries(J[WT].modeStats)) {
    out.push(`${mid.padEnd(9)} T27 PASS=${st.T27[0]} FAIL=${st.T27[1]} | T28 PASS=${st.T28[0]} FAIL=${st.T28[1]} | R3 PASS=${st.R3[0]} FAIL=${st.R3[1]} | R4 PASS=${st.R4[0]} FAIL=${st.R4[1]} | R5 PASS=${st.R5[0]} FAIL=${st.R5[1]} | R6 PASS=${st.R6[0]} FAIL=${st.R6[1]}`);
  }
}
// r5：每情境 × mode 的 P1 數（work / pre）
out.push("\n══ 情境 × mode P1 數（work/pre；只列任一方 > 0）══");
for (const s of scenarios) {
  const cells = MODES.map((m) => `${m.id}=${(J.work.p1ByScenario.get(`${s.id}|${m.id}`) ?? []).length}/${(J.pre.p1ByScenario.get(`${s.id}|${m.id}`) ?? []).length}`);
  if (cells.some((c) => !/=0\/0$/.test(c))) out.push(`[${s.id}] ${cells.join(" ")}`);
}
out.push("\n══ P1 計數 ══");
for (const [WT, set] of [["work", p1W], ["pre", p1P], ...(p1P5 ? [["pre5", p1P5]] : []), ...(p1P4 ? [["pre4", p1P4]] : [])]) {
  out.push(`${WT}: P1=${set.size}（r3 情境=${countBy(set, (x) => !isR4Msg(x) && !isR5Msg(x) && !isR6Msg(x))}，其中 r3-C2+=${countBy(set, (x) => isC2plus(x) && !isR4Msg(x) && !isR5Msg(x) && !isR6Msg(x))}；R4 情境=${countBy(set, isR4Msg)}；R5 情境=${countBy(set, isR5Msg)}；R6 情境/probe=${countBy(set, isR6Msg)}）`);
}
out.push(`新增 P1（work 有、pre 無）=${newInWork.length}  F5 消除=${fixedByF5.length}`);
out.push("\n══ r6：真實模組 GPS A/B/C probe 判定（各樹）══", ...R6_PROBE_DETAIL);
out.push("\n══ r6：retry（applyLocalFallback destination-category-retry）到達紀錄 ══", ...(R6_RETRY.length ? R6_RETRY : ["(none)"]));
out.push("\n══ r6：各樹 Provider 總數（geocode / weather / builder / placesReq / credits）══");
for (const [tree, t] of Object.entries(PROV_TREES)) out.push(`${tree.padEnd(5)} geocode=${t.g} weather=${t.w} builder=${t.b} placesReq=${t.p} credits=${t.c}${tree === "work" ? "" : `  | work>${tree} 的情境×mode：provider=${provNew[tree].any} geocode=${provNew[tree].geocode} credits=${provNew[tree].credits}`}`);
out.push(`Provider 新增（work > pre 的情境×mode）=${newProviderCalls.length}  其中 geocode=${newGeocode.length}  credits=${newCredits.length}`);
out.push(`\n情境=${scenarios.length}（T27=${scenarios.filter((s) => T27_IDS.has(s.id)).length} T28=${scenarios.filter((s) => groupOf(s.id) === "T28").length} R3=${scenarios.filter((s) => R3_IDS.has(s.id)).length} R4=${scenarios.filter((s) => R4_IDS.has(s.id)).length} R5=${scenarios.filter((s) => R5_IDS.has(s.id)).length} R6=${scenarios.filter((s) => R6_IDS.has(s.id)).length}） 模式=${MODES.length} 樹=${TREES.length} 工作=${jobs.length}`);
out.push(`verify-destination-authority-phase2-r6: work P1=${p1W.size} pre P1=${p1P.size} 新增P1=${newInWork.length} COST-NOTE=${uniq(J.work.costNotes).length} DIFF-expected=${uniq(J.work.diffExpected).length} UX=${uniq(J.work.ux).length} external=${extHits.length} → ${p1W.size ? "FAIL" : "PASS"}`);
await new Promise((resolve) => process.stdout.write(`${out.join("\n")}\n`, resolve));
process.exit(p1W.size ? 1 : 0);
