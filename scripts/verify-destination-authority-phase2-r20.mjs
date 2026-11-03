#!/usr/bin/env node
/**
 * R20 — Destination Authority 全量回歸（A2-MP-T7，tester）。使用者裁決（A2-MP-T6 後）：
 *   confirmationAttempts 定案；同一 Pending 重試／詢問有上限；Pending 寫入不得修改 activeCategoryIntent；
 *   originalUserText 必須是建立 Pending 當輪的原始使用者文字；授權 r20、mp25-r3；本輪不改正式 Source；A2 維持 BLOCKED。
 *
 * 建立方式（同 r14～r19 模式）：r12–r19 保留不改。r20 在執行期讀入 r19 原文（sha256 必須 = scratchpad/pre-MP7T-test-sha.txt 所記），
 * 套用 R20_R19_PATCHES（r19 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），再以 AsyncFunction 執行。
 * patched r19 照常讀入 r18 → r17 → … → r13（各層 sha 檢查不變）。R20_R13／R14_PATCHES 附加到 R19_R13／R14_PATCHES 之後。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r20）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r20.diff；契約差異見 scratchpad/r20-contract-diff.md）：
 *  r20-V  版本識別：子程序路徑 r20、摘要行、F7 後變動檔白名單＋r20＋mp25-r3（精確路徑）；AsyncFunction 執行需要的 import 轉換、
 *         r19 自身旗標（--probe／--emit-diff／--check-test-sha）停用（改由 r20 處理）。
 *  r20-E  r19-E（destination_switch Pending 例外）收緊：例外成立＝r19-E 全部條件 ∧ r20PendingExtra 全部條件（只加條件，不移除 r19 條件；
 *         r19 L128「activeCategoryIntent＝Pending 類別」的放行因 r20 要求 activeCategoryIntent 與輪初相同而失效＝裁決 3）。
 *         任一條件不成立 → 原 r14-Δ7 P1 照判（訊息逐字不變）。條件見 r20PendingExtra；單元探針 R20_EXC_PROBE（每次執行先跑；不符 → INFRA-FAIL）。
 *  r20-O  只記錄：obs.r20Db（本輪非 RPC Supabase 存取）、obs.r20Start／r20End（輪初／輪末 Session 地理投影）、obs.r20AltOffer
 *         （本輪助理訊息是否為正式 isAlternativeRecommendationOffer）、obs.r20Assistant（本輪助理全文，≤400 字）、obs.r20CoordHits
 *         （輪末 Session 中與情境 r19Coords 城市座標相符的數值路徑）、obs.r20CardLL（本輪卡片座標）。
 *  長度上限：只引用專案既有限制（執行期從原始碼讀出；找不到 → INFRA-FAIL，不自創數字）：
 *         使用者原句＝src/lib/ai/service.server.ts ChatRequest `chatInput: z.string().max(N)`（_app.chat.tsx 以 chatInput: userText 送出）；
 *         地名＝src/lib/location.functions.ts GeocodeTextInput `query`／`destinationName` `.max(N)`（Destination Authority geocode 的既有入口）。
 *  不變：r13～r19 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類。外部請求攔截同 r13。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r20.mjs --brief --pa2 --a2 --mp1 [--only=ID,…] [--extra-scenarios=…] [--out=<scratchpad>/x.log]
 *       node scripts/verify-destination-authority-phase2-r20.mjs --probe           （r20-E 單元探針＋長度上限來源＋r19 錨點乾跑）
 *       node scripts/verify-destination-authority-phase2-r20.mjs --emit-diff       （寫 scratchpad/r20.diff、r20.* 執行內容、r20-contract-diff.md）
 *       node scripts/verify-destination-authority-phase2-r20.mjs --check-test-sha  （scripts/verify-*.mjs 對照 pre-MP7T-test-sha.txt）
 *       node scripts/verify-destination-authority-phase2-r20.mjs --cross-r4 [--out=…]      （以 r20 掛載 more-places-r4；預設輸出 scratchpad/mp-cross-r4-r20.log；
 *                                                                                           結束後與 scratchpad/mp-cross-r4-T6-full.log 的 r4 區段比對）
 *       node scripts/verify-destination-authority-phase2-r20.mjs --r19-parity [--out=…]    （以 r20 執行與 r19-subset-T6 相同的情境集合〔mp25-r2＋R10＋R15-PROBE〕；
 *                                                                                           預設輸出 scratchpad/r20-parity-r19subset.log；結束後比對 P1／NECESSARY-SEARCH／mp25-r2 表）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R19_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r19.mjs`;
const SELF = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r20.mjs`;
const TEST_SHA_FILE = `${PRE_DIR}/pre-MP7T-test-sha.txt`; // A2-MP-T7 開始前的 scripts sha256 快照（572 支）
const SELF_REL = "scripts/verify-destination-authority-phase2-r20.mjs";
const MP25_R3 = "scripts/verify-more-places-destination-switch-mp25-r3.mjs";
const MP25_R2 = "scripts/verify-more-places-destination-switch-mp25-r2.mjs";
const CROSS_R4 = "scripts/verify-more-places-cross-destination-r4.mjs";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");
const IS_CHILD = process.env.VERIFY_P2R3_ROLE === "collect";
const argOut = () => process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length) ?? null;

// ════════════════════════ 長度上限（只引用既有限制；找不到 → INFRA-FAIL）════════════════════════
function r20Limits() {
  const fail = [];
  const svcRel = "src/lib/ai/service.server.ts";
  const locRel = "src/lib/location.functions.ts";
  const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;
  const svc = readFileSync(`${WORK_ROOT}/${svcRel}`, "utf8");
  const a = [...svc.matchAll(/\bchatInput: z\.string\(\)\.max\((\d+)\)/g)];
  if (a.length !== 1) fail.push(`${svcRel} chatInput: z.string().max(N) 出現 ${a.length} 次（必須 1 次）`);
  const loc = readFileSync(`${WORK_ROOT}/${locRel}`, "utf8");
  const b = [...loc.matchAll(/const GeocodeTextInput = z\s*\.object\(\{\s*query: z\.string\(\)\.min\(1\)\.max\((\d+)\),[\s\S]*?destinationName: z\.string\(\)\.min\(1\)\.max\((\d+)\)/g)];
  if (b.length !== 1) fail.push(`${locRel} GeocodeTextInput query／destinationName .max(N) 出現 ${b.length} 次（必須 1 次）`);
  if (fail.length) return { fail };
  const userText = Number(a[0][1]);
  const q = Number(b[0][1]);
  const dn = Number(b[0][2]);
  return {
    fail,
    userText,
    label: Math.min(q, dn),
    src: {
      userText: `${svcRel} L${lineOf(svc, a[0].index)}（ChatRequest.chatInput max ${userText}；_app.chat.tsx 以 chatInput: userText 送出）`,
      label: `${locRel} L${lineOf(loc, b[0].index)}（GeocodeTextInput.query max ${q}、destinationName max ${dn}；Destination Authority geocode 入口）`,
    },
  };
}

// ════════════════════════ r20-E：Pending 例外收緊（純函式；主程序探針與子程序共用）════════════════════════
/** 座標字串（「36.5613,136.6562」「36.56，136.65」等）。 */
const R20_COORD_RE = /-?\d{1,3}\.\d{2,}\s*[,，、/]\s*-?\d{1,3}\.\d{2,}/;
/** 搜尋範圍／座標鍵值（原句本身沒有時不得出現）。 */
const R20_SCOPE_RE = /searchScope|explicitSearchScope|radius|半徑|範圍\s*[:：=]|\blat(?:itude)?\s*[:=]|\bln?g(?:itude)?\s*[:=]|\blon\s*[:=]|公里內|\d\s*km\b|@\s*-?\d/i;
/** 只由數字／座標符號組成（地名不得是座標）。 */
const R20_NUMERIC_RE = /^[-+\d.,，\s°NSEWnsew]+$/;
const R20_SESSION_GEO_KEY = /lat|lng|lon|coord|center|radius|scope|location|area|destination|city|region|bounds|viewport/i;
const r20Count = (hay, needle) => {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n += 1;
  return n;
};
function r20Canon(v) {
  if (v === undefined) return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => r20Canon(x) ?? "null").join(",")}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${r20Canon(v[k])}`).join(",")}}`;
}
/** 輪初 Session 的可信目的地（more_places：recommendationSession.destination 優先，其次 travelContext.destination；ARC／tripPlanningContext 不採用）。 */
function r20Primary(atStart) {
  const r = atStart?.recommendationSession?.destination;
  const t = atStart?.travelContext?.destination;
  if (typeof r === "string" && r.trim()) return r.trim();
  if (typeof t === "string" && t.trim()) return t.trim();
  return null;
}
/** 同一 Pending（＝「相同輸入」）：kind＝destination_switch、rawGeographicLabel、previousConfirmedDestination、categoryIntent、originatingRoute 皆相同。 */
const r20SameIdentity = (a, b) =>
  Boolean(a && b) &&
  a.kind === "destination_switch" &&
  b.kind === "destination_switch" &&
  String(a.rawGeographicLabel ?? "").trim() === String(b.rawGeographicLabel ?? "").trim() &&
  String(a.previousConfirmedDestination ?? "").trim() === String(b.previousConfirmedDestination ?? "").trim() &&
  a.categoryIntent === b.categoryIntent &&
  a.originatingRoute === b.originatingRoute;
const R20_DB_WRITE_RE = /\.(insert|update|upsert|delete|remove|upload|move|copy)\b/i;
/**
 * r19-E 之外再加的條件（全部成立才放行；回傳 why 以「r20:」開頭）。
 *   persists／atStart       同 r19-E
 *   userText                本輪使用者原句（send() 的 trimmed）
 *   db                      本 Callback 內非 RPC Supabase 存取（"phase:path"）；寫入（insert／update／upsert／delete／storage）→ 不成立
 *   frameGeo                本 Callback 內 geocode（"phase:q"）；weather 階段 → 不成立
 *   altOffer                正式 isAlternativeRecommendationOffer（子程序）；lastAssistantReply 改成 noMore／替代推薦提問 → 不成立
 *   limits                  { userText, label }（既有限制）
 */
function r20PendingExtra({ persists, atStart, userText, db = [], frameGeo = [], altOffer, limits }) {
  const why = [];
  const W = (m) => why.push(`r20:${m}`);
  if (!limits || !Number.isInteger(limits.userText) || !Number.isInteger(limits.label)) W("缺既有長度上限（無法檢查）");
  if (typeof userText !== "string") W("缺本輪使用者原句（無法比對 originalUserText）");
  const writes = (db ?? []).filter((p) => R20_DB_WRITE_RE.test(String(p)));
  if (writes.length) W(`非 RPC Supabase 寫入 ${writes.length} 次（${writes.slice(0, 3).join(",")}）`);
  const wg = (frameGeo ?? []).filter((g) => /^weather:/.test(String(g)));
  if (wg.length) W(`weather 階段 geocode ${wg.length} 次（${wg.slice(0, 2).join(",")}）`);
  const primary = r20Primary(atStart);
  const startP = atStart?.pendingClarification?.kind === "destination_switch" ? atStart.pendingClarification : null;
  (persists ?? []).forEach((s, i) => {
    const tag = `寫入#${i + 1}`;
    const p = s?.pendingClarification;
    if (!p || typeof p !== "object" || p.kind !== "destination_switch") return; // r19-E 已判不成立
    // 裁決 3：activeCategoryIntent 不得改變（r19 L128 的放行移除）
    if (atStart && typeof atStart === "object" && r20Canon(atStart.activeCategoryIntent) !== r20Canon(s?.activeCategoryIntent)) W(`${tag} activeCategoryIntent ${JSON.stringify(atStart.activeCategoryIntent ?? null)}→${JSON.stringify(s?.activeCategoryIntent ?? null)}（Pending 寫入不得修改）`);
    // lastAssistantReply 若改變：不得是 noMore／替代推薦提問
    if (atStart && s && typeof s.lastAssistantReply === "string" && s.lastAssistantReply !== atStart.lastAssistantReply) {
      if (typeof altOffer !== "function") W(`${tag} 缺 isAlternativeRecommendationOffer（無法檢查 lastAssistantReply）`);
      else if (altOffer(s.lastAssistantReply)) W(`${tag} lastAssistantReply 為 noMore／替代推薦提問（${s.lastAssistantReply.slice(0, 40)}）`);
    }
    // 必填：originalUserText、confirmationAttempts
    if (typeof p.originalUserText !== "string" || !p.originalUserText.trim()) W(`${tag} 缺 originalUserText`);
    if (!Number.isInteger(p.confirmationAttempts)) W(`${tag} 缺 confirmationAttempts（必須是整數）`);
    const same = r20SameIdentity(startP, p);
    const ref = same && typeof startP.originalUserText === "string" ? startP.originalUserText : userText;
    const raw = typeof p.rawGeographicLabel === "string" ? p.rawGeographicLabel.trim() : "";
    const prev = typeof p.previousConfirmedDestination === "string" ? p.previousConfirmedDestination.trim() : "";
    if (typeof p.originalUserText === "string" && typeof ref === "string") {
      const o = p.originalUserText;
      if (o !== ref) W(`${tag} originalUserText ${same ? "與同一 Pending 建立輪原句不同" : "≠ 本輪使用者原句"}（${JSON.stringify(o.slice(0, 40))} vs ${JSON.stringify(ref.slice(0, 40))}）`);
      if (limits && o.length > limits.userText) W(`${tag} originalUserText 長度 ${o.length} > 既有上限 ${limits.userText}`);
      if (raw && !o.includes(raw)) W(`${tag} originalUserText 不含待確認目的地「${raw}」`);
      if (prev && r20Count(o, prev) > r20Count(ref, prev)) W(`${tag} originalUserText 重複拼接父城市「${prev}」`);
      if (raw && r20Count(o, raw) > r20Count(ref, raw)) W(`${tag} originalUserText 重複拼接待確認目的地「${raw}」`);
      if (R20_COORD_RE.test(o) && !R20_COORD_RE.test(ref)) W(`${tag} originalUserText 附加座標`);
      if (R20_SCOPE_RE.test(o) && !R20_SCOPE_RE.test(ref)) W(`${tag} originalUserText 附加搜尋範圍`);
    }
    // 相同輸入不得重置計數
    if (same && Number.isInteger(startP.confirmationAttempts) && Number.isInteger(p.confirmationAttempts) && p.confirmationAttempts < startP.confirmationAttempts) W(`${tag} confirmationAttempts 被重置 ${startP.confirmationAttempts}→${p.confirmationAttempts}`);
    // rawGeographicLabel：既有 geocode 入口上限、不得是座標
    if (typeof p.rawGeographicLabel === "string") {
      if (limits && raw.length > limits.label) W(`${tag} rawGeographicLabel 長度 ${raw.length} > 既有上限 ${limits.label}`);
      if (R20_COORD_RE.test(raw) || R20_NUMERIC_RE.test(raw)) W(`${tag} rawGeographicLabel 是座標字串`);
    }
    // previousConfirmedDestination：只能等於輪初 Session 的可信目的地（rec 優先，其次 travelContext；ARC／tpc 不採用）
    if (prev) {
      if (!primary) W(`${tag} 輪初 Session 沒有 recommendationSession／travelContext 目的地（previousConfirmedDestination=${prev} 無可信來源）`);
      else if (prev !== primary) W(`${tag} previousConfirmedDestination=${prev} ≠ 輪初可信目的地 ${primary}（ARC／tripPlanningContext 不能作為依據）`);
    }
  });
  return { ok: !why.length, why: why.join("；") };
}
const r20Combine = (a, b) => ({ ok: Boolean(a?.ok) && Boolean(b?.ok), why: [a?.why, b?.why].filter(Boolean).join("；"), r19ok: Boolean(a?.ok), r20ok: Boolean(b?.ok) });

// ════════════════════════ r20-O：只記錄（子程序）════════════════════════
function r20Proj(s) {
  if (!s || typeof s !== "object") return null;
  const geo = (o) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o ?? null;
    const r = {};
    for (const k of Object.keys(o).sort()) if (R20_SESSION_GEO_KEY.test(k) && o[k] !== undefined && !Array.isArray(o[k])) r[k] = o[k];
    return r;
  };
  return {
    tc: geo(s.travelContext),
    tpc: geo(s.tripPlanningContext),
    trip: geo(s.tripDestination),
    rec: geo(s.recommendationSession),
    arc: geo(s.activeRecommendationContext),
    location: s.location ?? null,
    nla: s.nearbyLocationAuthority ?? null,
    explicitSearchScope: s.explicitSearchScope ?? null,
    searchScope: s.searchScope ?? null,
    radius: s.radius ?? null,
    preferredArea: s.preferredArea ?? null,
    activeCategoryIntent: s.activeCategoryIntent ?? null,
    pendingQuestion: s.pendingQuestion?.type ?? (s.pendingQuestion ? "?" : null),
    lastAssistantReply: typeof s.lastAssistantReply === "string" ? s.lastAssistantReply.slice(0, 400) : null,
  };
}
/** 輪末 Session 中與情境城市座標（r19Coords）相符的數值路徑（±0.008；Mock 地點偏移 ≤0.006）。 */
function r20CoordHits(s, table) {
  const out = {};
  if (!s || !table) return out;
  const near = (x, y) => typeof x === "number" && Math.abs(x - y) <= 0.008;
  const walk = (v, path, d) => {
    if (d > 7 || v == null) return;
    if (typeof v === "number") {
      for (const [city, c] of Object.entries(table)) if (near(v, c.lat) || near(v, c.lng)) (out[city] ??= []).length < 12 && out[city].push(path);
      return;
    }
    if (typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, d + 1);
  };
  walk(s, "session", 0);
  return out;
}
function r20CardLL(msgs) {
  const lastUser = msgs.map((x) => x?.role).lastIndexOf("user");
  return msgs
    .slice(lastUser + 1)
    .filter((x) => x?.role === "assistant")
    .flatMap((x) => x?.roamie?.recommendations ?? [])
    .map((p) => ({ lat: typeof p?.lat === "number" ? p.lat : null, lng: typeof p?.lng === "number" ? p.lng : null }));
}

// ════════════════════════ 探針（主程序）：r19-E 原函式（從 r19 原文擷取）∧ r20PendingExtra ════════════════════════
/** 從「r20 實際執行的 r19」擷取 r19-E 原函式（含 r20#L1 上限替換），與子程序執行的是同一份程式碼。 */
function r19ExcFromText(text, limits) {
  const a = text.indexOf("const R19_PENDING_ALLOWED");
  const b = text.indexOf("/** r19-E 單元探針");
  if (a < 0 || b < a) throw new Error("r19 原文找不到 r19-E 函式區段");
  return new Function("__r20", `${text.slice(a, b)}\nreturn { r19PendingException, r19Canon };`)({ limits });
}
function r20AltOfferFromSource() {
  const src = readFileSync(`${WORK_ROOT}/src/lib/ai/chat-recommendation-refresh.ts`, "utf8");
  const m = src.match(/const ALTERNATIVE_RECOMMENDATION_OFFER_RE =\s*\/((?:[^/\\\n]|\\.)+)\/([a-z]*);/);
  const rules = readFileSync(`${WORK_ROOT}/src/lib/ai/place-recommendation-rules.ts`, "utf8");
  const n = rules.match(/export const NO_MORE_RECOMMENDATIONS_MESSAGE =\s*"([^"]+)";/);
  if (!m || !n) throw new Error("找不到 ALTERNATIVE_RECOMMENDATION_OFFER_RE／NO_MORE_RECOMMENDATIONS_MESSAGE");
  const re = new RegExp(m[1], m[2]);
  const noMore = n[1];
  return { fn: (t) => { const s = String(t ?? "").trim(); return Boolean(s) && (s === noMore || re.test(s)); }, re: String(re), noMore };
}
function r20ExceptionProbe({ r19PendingException, limits, alt }) {
  const T2 = "換金澤，再推薦幾個";
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
  const P = { kind: "destination_switch", rawGeographicLabel: "金澤", previousConfirmedDestination: "京都", categoryIntent: "attraction", originatingRoute: "more_places", parentIntent: "place_recommendation", originalUserText: T2, confirmationAttempts: 1 };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const NONE = Symbol("no-pending");
  const S = (patch = {}, pend = P, base = atStart) => ({ ...clone(base), ...patch, pendingClarification: pend === NONE ? undefined : pend });
  const longRaw = `金${"沢".repeat(limits.label - 2)}澤`; // 長度＝上限
  const tooLongRaw = `金${"沢".repeat(limits.label - 1)}澤`; // 上限＋1
  const fill = (n, core) => `${core}${"。".repeat(Math.max(0, n - core.length))}`;
  const atStartSame = (pend) => ({ ...clone(atStart), pendingClarification: pend });
  const atStartArcOnly = { ...clone(atStart), recommendationSession: undefined, travelContext: { interests: [] } };
  const atStartStaleArc = { ...clone(atStart), activeRecommendationContext: { destinationName: "大阪", intent: "attraction", searchScope: "city" } };
  const atStartTpc = { ...clone(atStart), tripPlanningContext: { destination: "奈良", selectedPlaces: [] } };
  const atStartTcOnly = { ...clone(atStart), recommendationSession: undefined };
  const atStartRecTcDiff = { ...clone(atStart), travelContext: { interests: [], destination: "大阪" } };
  const atStartCat = { ...clone(atStart), activeCategoryIntent: "restaurant" };
  const base = { atStart, places: 0, weather: 0, builders: 0, begins: 0, rpcs: [], userText: T2, db: [], frameGeo: [], altOffer: alt.fn, limits };
  const cases = [
    // ── 放行（合法 Pending 寫入不得誤判 P1）──
    ["R-E01 合法（全部允許欄位）", { persists: [S()] }, true],
    ["R-E02 合法（不含 parentIntent）", { persists: [S({}, (({ parentIntent, ...x }) => x)(P))] }, true],
    ["R-E03 合法＋lastAssistantReply 改為確認問句", { persists: [S({ lastAssistantReply: "目前無法確認金澤，要改成金澤嗎？還是繼續京都？" })] }, true],
    ["R-E04 合法＋pendingQuestion 移除", { persists: [S({ pendingQuestion: undefined })] }, true],
    ["R-E05 合法 confirmationAttempts=0", { persists: [S({}, { ...P, confirmationAttempts: 0 })] }, true],
    ["R-E06 合法：確認失敗輪重寫同一 Pending（原句＝建立輪；attempts 1→2）", { persists: [S({}, { ...P, confirmationAttempts: 2 }, atStartSame({ ...P, confirmationAttempts: 1 }))], atStart: atStartSame({ ...P, confirmationAttempts: 1 }), userText: "好" }, true],
    ["R-E07 合法：rawGeographicLabel 長度＝既有上限", { persists: [S({}, { ...P, rawGeographicLabel: longRaw, originalUserText: `換${longRaw}，再推薦幾個` })], userText: `換${longRaw}，再推薦幾個` }, true],
    ["R-E08 合法：originalUserText 長度＝既有上限", { persists: [S({}, { ...P, originalUserText: fill(limits.userText, T2) })], userText: fill(limits.userText, T2) }, true],
    ["R-E09 合法：輪初只有 travelContext＝京都（無 rec）", { persists: [S({}, P, atStartTcOnly)], atStart: atStartTcOnly }, true],
    ["R-E10 合法：Callback 內非 RPC Supabase 只讀（auth.getSession）", { persists: [S()], db: ["more_validate:auth.getSession"] }, true],
    // ── P1（夾帶非法 Session 欄位／違反裁決）──
    ["R-N01 activeCategoryIntent 改成 Pending 類別（r19 L128 放行 → r20 移除）", { persists: [S({ activeCategoryIntent: "attraction" }, P, atStartCat)], atStart: atStartCat }, false],
    ["R-N02 activeCategoryIntent 移除", { persists: [S({ activeCategoryIntent: undefined })] }, false],
    ["R-N03 originalUserText ≠ 本輪原句（截短）", { persists: [S({}, { ...P, originalUserText: "換金澤" })] }, false],
    ["R-N04 originalUserText 夾帶其他城市（本輪原句沒有）", { persists: [S({}, { ...P, originalUserText: `${T2}，順便大阪` })] }, false],
    ["R-N05 originalUserText 重複拼接父城市（京都＋原句）", { persists: [S({}, { ...P, originalUserText: `京都${T2}` })] }, false],
    ["R-N06 originalUserText 重複拼接待確認目的地（金澤＋原句）", { persists: [S({}, { ...P, originalUserText: `金澤${T2}` })] }, false],
    ["R-N07 originalUserText 附加座標", { persists: [S({}, { ...P, originalUserText: `${T2} (36.5613,136.6562)` })] }, false],
    ["R-N08 originalUserText 附加搜尋範圍", { persists: [S({}, { ...P, originalUserText: `${T2} radius=3000` })] }, false],
    ["R-N09 originalUserText 超過既有上限（本輪原句同樣超長）", { persists: [S({}, { ...P, originalUserText: fill(limits.userText + 1, T2) })], userText: fill(limits.userText + 1, T2) }, false],
    ["R-N10 originalUserText 不含 rawGeographicLabel（金沢 vs 金澤）", { persists: [S({}, { ...P, rawGeographicLabel: "金沢" })] }, false],
    ["R-N11 缺 originalUserText", { persists: [S({}, (({ originalUserText, ...x }) => x)(P))] }, false],
    ["R-N12 缺 confirmationAttempts", { persists: [S({}, (({ confirmationAttempts, ...x }) => x)(P))] }, false],
    ["R-N13 rawGeographicLabel 超過既有上限", { persists: [S({}, { ...P, rawGeographicLabel: tooLongRaw, originalUserText: `換${tooLongRaw}，再推薦幾個` })], userText: `換${tooLongRaw}，再推薦幾個` }, false],
    ["R-N14 rawGeographicLabel 是座標字串", { persists: [S({}, { ...P, rawGeographicLabel: "36.5613,136.6562", originalUserText: "換36.5613,136.6562，再推薦幾個" })], userText: "換36.5613,136.6562，再推薦幾個" }, false],
    ["R-N15 previousConfirmedDestination 只符合過期 ARC（大阪）", { persists: [S({}, { ...P, previousConfirmedDestination: "大阪" }, atStartStaleArc)], atStart: atStartStaleArc }, false],
    ["R-N16 previousConfirmedDestination 只符合 tripPlanningContext（奈良）", { persists: [S({}, { ...P, previousConfirmedDestination: "奈良" }, atStartTpc)], atStart: atStartTpc }, false],
    ["R-N17 輪初只有 ARC＝京都（無 rec／travelContext 目的地）", { persists: [S({}, P, atStartArcOnly)], atStart: atStartArcOnly }, false],
    ["R-N18 previousConfirmedDestination＝travelContext 但 ≠ rec（rec 優先）", { persists: [S({}, { ...P, previousConfirmedDestination: "大阪" }, atStartRecTcDiff)], atStart: atStartRecTcDiff }, false],
    ["R-N19 nearbyLocationAuthority 改變", { persists: [S({ nearbyLocationAuthority: { displayLabel: "金澤", lat: 36.5613, lng: 136.6562, source: "clarification" } })] }, false],
    ["R-N20 nearbyLocationAuthority 移除", { persists: [S({ nearbyLocationAuthority: undefined })] }, false],
    ["R-N21 location 改變", { persists: [S({ location: { lat: 36.5613, lng: 136.6562, city: "金澤" } })] }, false],
    ["R-N22 explicitSearchScope 新增", { persists: [S({ explicitSearchScope: { destination: "金澤", radius: 3000 } })] }, false],
    ["R-N23 travelContext 加座標", { persists: [S({ travelContext: { ...atStart.travelContext, latitude: 36.5613, longitude: 136.6562 } })] }, false],
    ["R-N24 頂層 radius 新增", { persists: [S({ radius: 3000 })] }, false],
    ["R-N25 非 RPC Supabase 寫入（upsert）", { persists: [S()], db: ["more_validate:from.chat_sessions.upsert()"] }, false],
    ["R-N26 weather 階段 geocode（待確認金澤）", { persists: [S()], frameGeo: ["weather:金沢市, 石川県, 日本"] }, false],
    ["R-N27 lastAssistantReply 改為替代推薦提問", { persists: [S({ lastAssistantReply: "要不要換成美食、咖啡廳或室內景點？" })] }, false],
    ["R-N28 lastAssistantReply 改為 noMore 文案", { persists: [S({ lastAssistantReply: alt.noMore })] }, false],
    ["R-N29 confirmationAttempts 被重置（同一 Pending 2→0）", { persists: [S({}, { ...P, confirmationAttempts: 0 }, atStartSame({ ...P, confirmationAttempts: 2 }))], atStart: atStartSame({ ...P, confirmationAttempts: 2 }) }, false],
    ["R-N30 同一 Pending 重寫時 originalUserText 換成本輪「好」", { persists: [S({}, { ...P, originalUserText: "好", confirmationAttempts: 2 }, atStartSame({ ...P }))], atStart: atStartSame({ ...P }), userText: "好" }, false],
    ["R-N31 confirmationAttempts=3（r19）", { persists: [S({}, { ...P, confirmationAttempts: 3 })] }, false],
    ["R-N32 Pending 夾帶 center（r19）", { persists: [S({}, { ...P, center: { lat: 36.56, lng: 136.66 } })] }, false],
    ["R-N33 tripPlanningContext.destination＝金澤", { persists: [S({ tripPlanningContext: { destination: "金澤", selectedPlaces: [] } })] }, false],
    ["R-N34 recommendationSession 換成金澤", { persists: [S({ recommendationSession: { destination: "金澤", searchScope: "city", pool: [], shown: [] } })] }, false],
    ["R-N35 activeRecommendationContext＝金澤", { persists: [S({ activeRecommendationContext: { destinationName: "金澤", intent: "attraction", searchScope: "city" } })] }, false],
    ["R-N36 travelContext.destination＝金澤", { persists: [S({ travelContext: { ...atStart.travelContext, destination: "金澤" } })] }, false],
    ["R-N37 Places 1 次", { persists: [S()], places: 1 }, false],
    ["R-N38 Credits RPC credits_check", { persists: [S()], rpcs: ["credits_check"] }, false],
    ["R-N39 缺本輪使用者原句", { persists: [S()], userText: null }, false],
    ["R-N40 rawGeographicLabel＝previousConfirmedDestination", { persists: [S({}, { ...P, rawGeographicLabel: "京都", originalUserText: "換京都，再推薦幾個" })], userText: "換京都，再推薦幾個" }, false],
    ["R-N41 缺 isAlternativeRecommendationOffer 且 lastAssistantReply 改變", { persists: [S({ lastAssistantReply: "要改成金澤嗎？" })], altOffer: null }, false],
  ];
  const rows = cases.map(([label, over, want]) => {
    const args = { ...base, ...over };
    const a = r19PendingException(args);
    const b = r20PendingExtra(args);
    const c = r20Combine(a, b);
    return { label, want, got: c.ok, r19: a.ok, why: c.why, pass: c.ok === want };
  });
  return { rows, pass: rows.filter((x) => x.pass).length, n: rows.length, allow: rows.filter((x) => x.want).length, deny: rows.filter((x) => !x.want).length, tightened: rows.filter((x) => !x.want && x.r19).length };
}

// ════════════════════════ R20 patch（各層）════════════════════════
const R20_R13_PATCHES = [
  {
    id: "r20-O turn start db",
    kind: "exact",
    old: "      const r14r0 = R14_rpc.length; // r14-Δ3\n",
    neu: "      const r14r0 = R14_rpc.length; // r14-Δ3\n      const r20db0 = R14_db.length; // r20#O1：本輪非 RPC Supabase 存取起點（只記錄）\n",
  },
  {
    id: "r20-E turn text",
    kind: "exact",
    old: "      globalThis.__R19_TURN_START = persisted ? JSON.parse(JSON.stringify(persisted)) : null; // r19-E：輪初 Session（Pending 例外的比對基準；只在子程序記憶體，不輸出）\n",
    neu: L(
      "      globalThis.__R19_TURN_START = persisted ? JSON.parse(JSON.stringify(persisted)) : null; // r19-E：輪初 Session（Pending 例外的比對基準；只在子程序記憶體，不輸出）",
      '      globalThis.__R20_TURN_TEXT = typeof t.text === "string" ? t.text.trim() : null; // r20#E1：本輪使用者原句（＝send() 的 trimmed；originalUserText 比對基準）',
      "",
    ),
  },
  {
    id: "r20-O turn end",
    kind: "exact",
    old: "      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);\n",
    neu: L(
      "      obs.geocodes = geocodes.slice(g0).map((g) => `${g.phase}:${g.q}`);",
      "      { // r20#O2：只記錄（mp25-r3 判定用；r13～r19 judge 不讀）",
      "        const r20A = msgs.slice(r15m0).filter((x) => x?.role === \"assistant\").map((x) => String(x.content ?? \"\"));",
      "        obs.r20Db = R14_db.slice(r20db0).map((d) => `${d.phase}:${d.path}`);",
      "        obs.r20Start = __r14.r15.r16.r17.r18.r19.r20.proj(globalThis.__R19_TURN_START);",
      "        obs.r20End = __r14.r15.r16.r17.r18.r19.r20.proj(persisted);",
      "        obs.r20Assistant = r20A.map((x) => x.slice(0, 400));",
      "        obs.r20AltOffer = typeof M.refresh?.isAlternativeRecommendationOffer === \"function\" ? r20A.map((x) => Boolean(M.refresh.isAlternativeRecommendationOffer(x))) : null;",
      "        obs.r20CoordHits = __r14.r15.r16.r17.r18.r19.r20.coordHits(persisted, SCENARIO.r19Coords);",
      "        obs.r20CardLL = __r14.r15.r16.r17.r18.r19.r20.cardLL(msgs);",
      "      }",
      "",
    ),
  },
];
const R20_R14_PATCHES = [
  {
    id: "r20-E frame start",
    kind: "exact",
    old: "rpc0: R14_rpc.length, persistedAtEntry: persisted };\n",
    neu: "rpc0: R14_rpc.length, r20db0: R14_db.length, r20g0: geocodes.length, persistedAtEntry: persisted }; // r20#E2：Callback 內非 RPC Supabase／geocode 起點\n",
  },
  {
    id: "r20-E exception tighten",
    kind: "exact",
    old: "          const r19x = __r14.r15.r16.r17.r18.r19.pendingException({ persists: frame.persists, atStart: globalThis.__R19_TURN_START ?? null, places, weather, builders: frame.builders.length, begins: frame.begins.length, rpcs: R14_rpc.slice(frame.rpc0).map((x) => x.name) });\n",
    neu: L(
      "          const r20args = { persists: frame.persists, atStart: globalThis.__R19_TURN_START ?? null, places, weather, builders: frame.builders.length, begins: frame.begins.length, rpcs: R14_rpc.slice(frame.rpc0).map((x) => x.name), userText: globalThis.__R20_TURN_TEXT ?? null, db: R14_db.slice(frame.r20db0 ?? 0).map((d) => `${d.phase}:${d.path}`), frameGeo: geocodes.slice(frame.r20g0 ?? 0).map((g) => `${g.phase}:${g.q}`), altOffer: typeof M.refresh?.isAlternativeRecommendationOffer === \"function\" ? (x) => M.refresh.isAlternativeRecommendationOffer(x) : null, limits: __r14.r15.r16.r17.r18.r19.r20.limits }; // r20#E3",
      "          const r19x = __r14.r15.r16.r17.r18.r19.r20.combine(__r14.r15.r16.r17.r18.r19.pendingException(r20args), __r14.r15.r16.r17.r18.r19.r20.pendingExtra(r20args)); // r20#E3：r19-E 條件 ∧ r20 收緊條件（任一不成立 → 原 r14-Δ7 P1）",
      "",
    ),
  },
];
const R20_R18_PATCHES = [];

/** r19 原文層：執行需要（基準＝r19 原文＋本組）。 */
const R20_R19_INFRA = [
  {
    id: "r20-V static imports → __r20.imp",
    old: L('import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync, readdirSync } = await __r20.imp("node:fs"); // r20#V0：同 r19 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r20.imp("node:crypto");',
      'const { execFileSync } = await __r20.imp("node:child_process");',
    ),
  },
  { id: "r20-V makeR19 imp", old: "const makeR19 = (extra) => ({\n  imp: (s) => import(s),\n", neu: "const makeR19 = (extra) => ({\n  imp: __r20.imp, // r20#V0\n" },
  { id: "r20-V r19 --check-test-sha off", old: 'if (process.argv.includes("--check-test-sha")) {\n', neu: 'if (__r20.r19Flags === true && process.argv.includes("--check-test-sha")) { // r20#V0：r19 自身旗標停用（由 r20 處理）\n' },
  { id: "r20-V r19 --probe off", old: 'if (process.argv.includes("--probe")) {\n', neu: 'if (__r20.r19Flags === true && process.argv.includes("--probe")) { // r20#V0\n' },
  { id: "r20-V r19 --emit-diff off", old: 'if (process.argv.includes("--emit-diff")) {\n  const CAP = Symbol("r19-capture");', neu: 'if (__r20.r19Flags === true && process.argv.includes("--emit-diff")) { // r20#V0\n  const CAP = Symbol("r19-capture");' },
  {
    id: "r20 patch hooks r13/r14/r18",
    old: "function r19Apply(src, patches, what) {\n",
    neu: L(
      "for (const p of __r20.r13Patches) R19_R13_PATCHES.push(p); // r20#V0：R20_R13_PATCHES 套在 R19_R13_PATCHES 之後",
      "for (const p of __r20.r14Patches) R19_R14_PATCHES.push(p); // r20#V0：R20_R14_PATCHES 套在 R19_R14_PATCHES 之後",
      "for (const p of __r20.r18Patches) R19_R18_PATCHES.push(p); // r20#V0：R20_R18_PATCHES 套在 R19_R18_PATCHES 之後",
      "function r19Apply(src, patches, what) {",
      "",
    ),
  },
  { id: "r20 emit capture r18", old: '  r19Body = r19Apply(r18Src, R19_R18_PATCHES, "r18");\n', neu: '  r19Body = r19Apply(r18Src, R19_R18_PATCHES, "r18");\n  if (__r20.onR19Body) __r20.onR19Body(r19Body); // r20#V0：--emit-diff 擷取實際執行的 r18\n' },
  { id: "r20 run extra", old: ")(makeR19({}));", neu: ")(makeR19(__r20.r19Extra ?? {})); // r20#V0" },
];
const R20_R19_PATCHES = [
  ...R20_R19_INFRA,
  {
    id: "r20-V child script",
    old: "phase2-r19.mjs`; // r19：子程序執行 r19（＝r18＋R19 patch）；",
    neu: "phase2-r20.mjs`; // r20#V1：子程序執行 r20（＝r19＋R20 patch）；r19：子程序執行 r19（＝r18＋R19 patch）；",
  },
  {
    id: "r20-V whitelist",
    old: "/* r19-V：r1[0-9]＋mp25-r2 */ && f !== ",
    neu: String.raw`/* r19-V：r1[0-9]＋mp25-r2 */ && f !== \\"scripts/verify-destination-authority-phase2-r20.mjs\\" && f !== \\"scripts/verify-more-places-destination-switch-mp25-r3.mjs\\" /* r20#V2：＋r20＋mp25-r3（精確路徑） */ && f !== `,
  },
  { id: "r20-V summary", old: "phase2-r19: work P1=", neu: "phase2-r20: work P1=" },
  {
    id: "r20-L r19-E originalUserText 上限改用既有限制",
    old: "p.originalUserText.length > 500) why.push(",
    neu: "p.originalUserText.length > __r20.limits.userText /* r20#L1：r19 自創 500 → 既有 ChatRequest.chatInput 上限（裁決 4：遵守既有限制、不自創數字） */) why.push(",
  },
  { id: "r20 makeR19 r20 handle", old: "  pendingException: r19PendingException,\n", neu: "  pendingException: r19PendingException,\n  r20: __r20, // r20#V4：r20-E／O 函式（子程序經 __r14.r15.r16.r17.r18.r19.r20 存取）\n" },
  {
    id: "r20 report／summary",
    old: "  report: r19Report,\n  summaryFields: r19SummaryFields,\n",
    neu: "  report: (a) => { r19Report(a); __r20.report({ ...a, r19State: R19_STATE }); }, // r20#R1：r20 報告（只新增輸出）\n  summaryFields: () => `${r19SummaryFields()} ${__r20.summaryFields(R19_STATE)}`, // r20#R1：摘要（只新增欄位）\n",
  },
];

function r20Apply(src, patches, what) {
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
/** 乾跑：r20 的 r13／r14 層錨點對照 r19 --emit-diff 產物（scratchpad/r19.r19-exec.mjs、r19.patched-r14.mjs；只作 --probe 預檢，實際執行時由各層 r19Apply 再驗一次）。 */
function r20LayerDryRun() {
  const res = [];
  for (const [file, ps] of [[`${PRE_DIR}/r19.r19-exec.mjs`, R20_R13_PATCHES], [`${PRE_DIR}/r19.patched-r14.mjs`, R20_R14_PATCHES]]) {
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
const R20_STATE = { probe: null, limits: null };
function r20Report({ out, results, r19State }) {
  out.push("\n══════════════════════ r20（A2-MP-T7）══════════════════════");
  const lm = R20_STATE.limits;
  out.push(`══ r20 長度上限（既有限制）：使用者原句 ≤${lm.userText}〔${lm.src.userText}〕；地名 ≤${lm.label}〔${lm.src.label}〕 ══`);
  const p = R20_STATE.probe;
  out.push(`══ r20-E：Pending 例外單元探針 ${p.pass}/${p.n}（放行 ${p.allow}、P1 ${p.deny}；其中 r19-E 單獨會放行、r20 收緊後 P1＝${p.tightened}）══`);
  for (const r of p.rows) out.push(`  [${r.pass ? "OK" : "NG"}] ${r.label} 期望=${r.want ? "放行" : "P1"} 實際=${r.got ? "放行" : "P1"}（r19 單獨=${r.r19 ? "放行" : "P1"}）${r.why ? `（${r.why.slice(0, 160)}）` : ""}`);
  const ex = {};
  const dbw = {};
  for (const [key, r] of Object.entries(results)) {
    const [tree, , sid] = key.split("|");
    for (const t of r?.result?.turns ?? []) {
      for (const x of t.r19Exc ?? []) {
        const e = (ex[tree] ??= { hit: 0, r19only: 0, ng: 0 });
        if (x.ok) e.hit += 1;
        else if (/r20:/.test(String(x.why ?? "")) && !String(x.why ?? "").split("；").some((w) => w && !w.startsWith("r20:"))) e.r19only += 1;
        else e.ng += 1;
      }
      const w = (t.r20Db ?? []).filter((d) => R20_DB_WRITE_RE.test(d));
      if (w.length) (dbw[tree] ??= []).push(`[${sid}] T${t.turnIndex + 1} ${w.slice(0, 3).join(",")}`);
    }
  }
  R20_STATE.exc = ex;
  out.push("══ r20-E：實際執行中的例外評估（r19-E ∧ r20 條件）══");
  for (const [tree, e] of Object.entries(ex)) out.push(`  ${tree.padEnd(5)} 例外命中=${e.hit} 只因 r20 收緊而 P1=${e.r19only} 其他 P1 照判=${e.ng}`);
  if (!Object.keys(ex).length) out.push("  （本次沒有任何「可信判定未通過仍寫入 Session」的 Callback；例外命中 0）");
  out.push("══ r20-O：本輪非 RPC Supabase 寫入（只記錄；mp25-r3 在未確認期間判 SAFETY）══");
  for (const [tree, v] of Object.entries(dbw)) for (const x of v.slice(0, 20)) out.push(`  ${tree.padEnd(5)} ${x}`);
  if (!Object.keys(dbw).length) out.push("  （無）");
  void r19State;
}
function r20SummaryFields() {
  const w = R20_STATE.exc?.work ?? { hit: 0, r19only: 0, ng: 0 };
  return `r20[探針=${R20_STATE.probe?.pass}/${R20_STATE.probe?.n} 上限 原句=${R20_STATE.limits?.userText} 地名=${R20_STATE.limits?.label} work 例外命中=${w.hit} r20收緊P1=${w.r19only}]`;
}

// ════════════════════════ 契約差異 ════════════════════════
const R20_CONTRACT = [
  ["r19-E L128 activeCategoryIntent", "可不變或＝Pending.categoryIntent", "必須與輪初完全相同（含不得移除）", "Pending 寫入不得修改 activeCategoryIntent", "使用者裁決 3"],
  ["r19-E L126 lastAssistantReply", "可改為任意字串", "仍可改為字串（確認問句需要；既有 Clarification 寫入同形）；但不得是正式 isAlternativeRecommendationOffer（ALTERNATIVE_RECOMMENDATION_OFFER_RE／noMore／NO_MORE_RECOMMENDATIONS_MESSAGE）", "下一輪「好」會被 shouldAcceptAlternativeRecommendations 接走（京都 alt 分支）", "使用者裁決（例外收緊）"],
  ["r19-E L127 pendingQuestion", "只能移除", "不變（保留理由：舊的 pendingQuestion 若留著，下一輪「好」會被當成回答舊問題）", "-", "-"],
  ["r19-E L116 originalUserText", "可選；字串 ≤500", "必填；＝本輪使用者原句（同一 Pending 重寫時＝建立輪原句）；含 rawGeographicLabel；不得重複拼接父城市／待確認目的地；不得附加座標／範圍；≤ chatInput 既有上限", "原句只用於交回既有 Destination Authority 重新驗證", "使用者裁決 4"],
  ["r19-E L116 originalUserText 長度數字（r20#L1）", "> 500 → 不成立（r19 自創數字；專案內 _app.chat.tsx L7851 slice(0, 500) 只是登入草稿截斷，不是輸入限制）", "> 既有 ChatRequest.chatInput 上限（service.server.ts，執行期讀出＝4000）→ 不成立", "裁決 4「遵守既有輸入長度限制」＋「不自創數字」。注意：此處數字由 500 變為 4000（單看數字較寬），但同時新增「originalUserText 必須逐字等於本輪原句」，任何偽造／拼接／附加皆不成立；請指派者確認此調整", "使用者裁決 4（需指派者確認）"],
  ["r19-E confirmationAttempts", "可選；整數 0–2", "必填；整數 0–2（r19）；同一 Pending（相同輸入）不得變小", "不得以相同輸入重建 Pending 規避上限", "使用者裁決 1／2"],
  ["r19-E rawGeographicLabel", "必填字串（無長度限制）", "另加：≤ GeocodeTextInput 既有上限；不得是座標字串", "地名須能交回既有 geocode 入口", "使用者裁決 4（既有限制）"],
  ["r19-E L95-99 previousConfirmedDestination", "符合輪初 rec／travelContext／ARC／tripPlanningContext 任一", "另加：必須＝輪初 recommendationSession.destination（無則 travelContext.destination）；只符合 ARC／tpc 不成立", "previousConfirmedDestination 只是上下文參考，不能用過期欄位證明原城市可信", "使用者裁決（Session 寫入安全）"],
  ["r19-E Callback 成本", "Places／Weather 請求／Builder／Credits.begin／credits_* RPC 皆 0", "另加：非 RPC Supabase 寫入 0、weather 階段 geocode 0", "T6 觀察 7", "使用者裁決（Session 寫入安全）"],
  ["r19-E 合法探針 E02「只有必填」", "放行", "r20 探針不再有此案例（originalUserText／confirmationAttempts 已改必填；r19 原探針 44 條照跑且不改）", "裁決 1／4 使必填欄位增加", "使用者裁決 1／4"],
  ["r19.diff 第 3 部分 @@-571 歸類", "r19-E", "應為「r19 report（只新增輸出）」——該行註解含「r19-E／H／C／F」字樣，r19 以字面標籤先比到 r19-E", "T6 指出歸類標錯；r20.diff 改以每個 patch 的唯一標記 r20#… 歸類", "修正 6"],
  ["KEYS（刪除行統計）", "p1.push／notes.push／costNotes／diffExpected／expect:／MODES／ux.push／fail(", "另加 viol(、throw new Error", "T6 指出漏列", "修正 6"],
  ["more-places-r4 掛載", "r18（原生執行會因 r18 白名單不含 r19／mp25-r2 而 INFRA-FAIL）", "r20 --cross-r4（不改 r4；以 r20 掛載，白名單含 r20／mp25-r3）", "T6 指出", "修正 5"],
];

// ════════════════════════ 執行 ════════════════════════
function r20TestShaCheck() {
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
  const r = r20TestShaCheck();
  console.log(`scripts/verify-*.mjs：基準 ${r.base} 支、現在 ${r.now} 支；修改=${r.changed.length} [${r.changed.join(",")}]；新增=${r.added.length} [${r.added.join(",")}]；缺少=${r.missing.length} [${r.missing.join(",")}]`);
  const okAdded = r.added.every((x) => x === SELF_REL || x === MP25_R3);
  process.exit(!r.changed.length && !r.missing.length && okAdded ? 0 : 1);
}

const r19Text = readFileSync(R19_FILE, "utf8");
const r19Want = existsSync(TEST_SHA_FILE) ? readFileSync(TEST_SHA_FILE, "utf8").split("\n").find((l) => l.endsWith("  scripts/verify-destination-authority-phase2-r19.mjs"))?.slice(0, 64) : null;
if (!r19Want || sha256(r19Text) !== r19Want) {
  console.log(`INFRA-FAIL r19 sha256=${sha256(r19Text)} ≠ ${r19Want ?? "(缺 scratchpad/pre-MP7T-test-sha.txt)"}（r19 被修改？r20 不執行）`);
  process.exit(1);
}
const limits = r20Limits();
if (limits.fail.length) {
  console.log(["INFRA-FAIL r20 找不到可復用的既有長度限制（不自創數字）", ...limits.fail].join("\n"));
  process.exit(1);
}
R20_STATE.limits = limits;
globalThis.__R20_LIMITS = { userText: limits.userText, label: limits.label, src: limits.src }; // mp25-r3 report 讀取（同一主程序）
const shebang = r19Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r19 缺少 shebang");
  process.exit(1);
}
const r19Src = r19Text.slice(shebang[0].length);
let r20Body;
try {
  r20Body = r20Apply(r19Src, R20_R19_PATCHES, "r19");
} catch (e) {
  console.log(`INFRA-FAIL r20 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r20Body) || /^\s*imp: \(s\) => import\(s\)/m.test(r20Body)) {
  console.log("INFRA-FAIL r20：patched r19 仍有 import 陳述式／import()");
  process.exit(1);
}
if (!IS_CHILD) {
  let probe;
  try {
    probe = r20ExceptionProbe({ r19PendingException: r19ExcFromText(r20Body, { userText: limits.userText, label: limits.label }).r19PendingException, limits, alt: r20AltOfferFromSource() });
  } catch (e) {
    console.log(`INFRA-FAIL r20-E 探針無法建立：${e?.message ?? e}`);
    process.exit(1);
  }
  R20_STATE.probe = probe;
  globalThis.__R20_PROBE = { pass: probe.pass, n: probe.n, allow: probe.allow, deny: probe.deny, allowOk: probe.rows.filter((x) => x.want && x.pass).length, denyOk: probe.rows.filter((x) => !x.want && x.pass).length }; // mp25-r3 S3／S4 讀取
  if (probe.pass !== probe.n) {
    console.log(["INFRA-FAIL r20-E 單元探針不符", ...probe.rows.filter((x) => !x.pass).map((x) => `  ${x.label} 期望=${x.want} 實際=${x.got} ${x.why}`)].join("\n"));
    process.exit(1);
  }
}
const AsyncFunction = (async () => {}).constructor;
const makeR20 = (extra) => ({
  imp: (s) => import(s),
  r13Patches: R20_R13_PATCHES,
  r14Patches: R20_R14_PATCHES,
  r18Patches: R20_R18_PATCHES,
  r19Flags: false,
  pendingExtra: r20PendingExtra,
  combine: r20Combine,
  proj: r20Proj,
  coordHits: r20CoordHits,
  cardLL: r20CardLL,
  limits: { userText: limits.userText, label: limits.label },
  report: r20Report,
  summaryFields: r20SummaryFields,
  state: R20_STATE,
  r19Extra: null,
  onR19Body: null,
  ...extra,
});

if (!IS_CHILD && process.argv.includes("--probe")) {
  const p = R20_STATE.probe;
  console.log(`r20 長度上限：使用者原句 ≤${limits.userText}〔${limits.src.userText}〕；地名 ≤${limits.label}〔${limits.src.label}〕`);
  const alt = r20AltOfferFromSource();
  console.log(`r20 探針用 noMore／替代推薦判定（主程序以原始碼常數重建；子程序用正式 isAlternativeRecommendationOffer）：RE=${alt.re} NO_MORE=${JSON.stringify(alt.noMore)}`);
  console.log(`r20-E 單元探針 ${p.pass}/${p.n}（放行 ${p.allow}／P1 ${p.deny}；r19-E 單獨會放行、r20 收緊後 P1＝${p.tightened}）`);
  for (const r of p.rows) console.log(`  [${r.pass ? "OK" : "NG"}] ${r.label} 期望=${r.want ? "放行" : "P1"} 實際=${r.got ? "放行" : "P1"}（r19 單獨=${r.r19 ? "放行" : "P1"}）${r.why ? `（${r.why.slice(0, 200)}）` : ""}`);
  console.log(`r20 r19 原文層 patch：${R20_R19_PATCHES.length} 個錨點皆恰好 1 次 → OK`);
  const d = r20LayerDryRun();
  console.log(`r20 r13／r14 層錨點乾跑（對照 r19 --emit-diff 產物）：${d.map((x) => `${x.id}@${x.file}=${x.n}`).join("；")} → ${d.every((x) => x.n === 1) ? "OK" : "NG"}`);
  process.exit(p.pass === p.n && d.every((x) => x.n === 1) ? 0 : 1);
}

/** 以 r20 掛載 r4／r19 子集：spawn 自己（同一套 argv 慣例），結束後比對既有 log。 */
async function r20Mount({ extra, ids, flags, outDefault, compare }) {
  const out = argOut() ?? `${PRE_DIR}/${outDefault}`;
  if ([`${PRE_DIR}/mp-cross-r4-T6-full.log`, `${PRE_DIR}/r19-subset-T6.log`, `${PRE_DIR}/r19-subset.log`, `${PRE_DIR}/mp-cross-r4.log`].includes(out)) {
    console.log(`拒絕覆蓋既有 log：${out}`);
    process.exit(1);
  }
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [SELF, "--brief", ...flags, `--only=${ids.join(",")}`, `--extra-scenarios=${WORK_ROOT}/${extra}`, `--out=${out}`, ...pass];
  const code = await new Promise((res) => spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" }).on("close", (c) => res(c ?? 1)));
  if (existsSync(out)) compare(out);
  process.exit(code);
}
const sectionFrom = (text, start) => {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.includes(start));
  if (i < 0) return [];
  const j = lines.findIndex((l, k) => k > i && /^情境=\d+ 模式=/.test(l));
  return lines.slice(i, j > i ? j : undefined).filter((l) => !/耗時=/.test(l));
};
if (!IS_CHILD && process.argv.includes("--cross-r4")) {
  const m = await import(`${WORK_ROOT}/${CROSS_R4}`);
  const ids = (m.scenarios ?? []).map((s) => s.id);
  await r20Mount({
    extra: CROSS_R4,
    ids,
    flags: ["--f10", "--pa2", "--a2", "--mp1"],
    outDefault: "mp-cross-r4-r20.log",
    compare: (out) => {
      const ref = `${PRE_DIR}/mp-cross-r4-T6-full.log`;
      const A = sectionFrom(readFileSync(ref, "utf8"), "══════════════ more_places 跨目的地續推");
      const B = sectionFrom(readFileSync(out, "utf8"), "══════════════ more_places 跨目的地續推");
      const sa = new Set(A);
      const sb = new Set(B);
      const onlyA = A.filter((l) => !sb.has(l));
      const onlyB = B.filter((l) => !sa.has(l));
      const sum = (t) => t.split("\n").filter((l) => /^more_places .*PASS=\d+/.test(l) || /^more_places r\d/.test(l));
      console.log(`\n── r20 --cross-r4 比對（extra-scenario 報告區段，略過耗時行）：T6 行數=${A.length} r20 行數=${B.length} 只在 T6=${onlyA.length} 只在 r20=${onlyB.length}；逐行順序相同=${JSON.stringify(A) === JSON.stringify(B)}`);
      for (const l of onlyA.slice(0, 15)) console.log(`  [只在 T6 ] ${l.slice(0, 220)}`);
      for (const l of onlyB.slice(0, 15)) console.log(`  [只在 r20] ${l.slice(0, 220)}`);
      console.log(`  T6 摘要：${sum(readFileSync(ref, "utf8")).join("｜")}`);
      console.log(`  r20摘要：${sum(readFileSync(out, "utf8")).join("｜")}`);
    },
  });
}
if (!IS_CHILD && process.argv.includes("--r19-parity")) {
  const m = await import(`${WORK_ROOT}/${MP25_R2}`);
  const ids = [...(m.scenarios ?? []).map((s) => s.id), "R10-a2-kyoto-kanazawa-more", "R15-PROBE"];
  await r20Mount({
    extra: MP25_R2,
    ids,
    flags: ["--pa2", "--a2", "--mp1"],
    outDefault: "r20-parity-r19subset.log",
    compare: (out) => {
      const ref = `${PRE_DIR}/r19-subset-T6.log`;
      const pick = (t) => {
        const lines = t.split("\n");
        const sum = lines.filter((l) => /^verify-destination-authority-phase2-r(19|20): /.test(l)).at(-1) ?? "";
        const p1 = sum.match(/work P1=.*? external=\d+/)?.[0] ?? "-";
        const ns = lines.filter((l) => l.includes("[NECESSARY-SEARCH]"));
        const tbl = lines.filter((l) => /^ {2,3}\d{1,2}\. /.test(l) && /work=/.test(l));
        const mp = lines.filter((l) => /^MP-25 r2（work）/.test(l));
        const r15 = sum.match(/r15\[[^\]]*\]/)?.[0] ?? "-";
        const r18 = sum.match(/r18\[[^\]]*\]/)?.[0] ?? "-";
        const r19 = sum.match(/r19\[[^\]]*\]/)?.[0] ?? "-";
        return { p1, ns, tbl, mp, r15, r18, r19, r20: sum.match(/r20\[[^\]]*\]/)?.[0] ?? "-" };
      };
      const a = pick(readFileSync(ref, "utf8"));
      const b = pick(readFileSync(out, "utf8"));
      const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      console.log("\n── r20 --r19-parity 比對（vs scratchpad/r19-subset-T6.log）──");
      console.log(`  P1／external：${eq(a.p1, b.p1) ? "相同" : "不同"}｜T6：${a.p1}｜r20：${b.p1}`);
      console.log(`  NECESSARY-SEARCH 行：${eq(a.ns, b.ns) ? "相同" : "不同"}（T6=${a.ns.length} r20=${b.ns.length}）`);
      console.log(`  mp25-r2 16 項表：${eq(a.tbl, b.tbl) ? "相同" : "不同"}（T6=${a.tbl.length} r20=${b.tbl.length}）`);
      console.log(`  mp25-r2 work 摘要：${eq(a.mp, b.mp) ? "相同" : "不同"}｜${b.mp.join("")}`);
      console.log(`  r15 欄：${eq(a.r15, b.r15) ? "相同" : "不同"}｜r18 欄：${eq(a.r18, b.r18) ? "相同" : "不同"}｜r19 欄：${eq(a.r19, b.r19) ? "相同" : "不同"}（${b.r19}）`);
      console.log(`  r20 欄：${b.r20}`);
      if (!eq(a.tbl, b.tbl)) for (const [i, l] of b.tbl.entries()) if (l !== a.tbl[i]) console.log(`    [差異] T6：${String(a.tbl[i]).slice(0, 200)}\n           r20：${l.slice(0, 200)}`);
    },
  });
}

if (!IS_CHILD && process.argv.includes("--emit-diff")) {
  const CAP = Symbol("r20-capture");
  const runCapture = async (body, r20extra) => {
    let got = null;
    let r19Body = null;
    let r18Body = null;
    let r17Body = null;
    let r16Body = null;
    const r20 = makeR20({
      ...r20extra,
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
    });
    try {
      await new AsyncFunction("__r20", `"use strict";\n${body}`)(r20);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got || !r19Body || !r18Body || !r17Body || !r16Body) throw new Error("emit capture 未取得執行內容");
    return { ...got, r19Body, r18Body, r17Body, r16Body };
  };
  const baseBody = r20Apply(r19Src, R20_R19_INFRA, "r19(基準)");
  const base = await runCapture(baseBody, { r13Patches: [], r14Patches: [], r18Patches: [] });
  const mine = await runCapture(r20Body, {});
  const F = (n) => `${PRE_DIR}/${n}`;
  const files = {
    r19: R19_FILE,
    r20r19: F("r20.patched-r19.mjs"),
    baseR18: F("r20base.r19-patched-r18.mjs"),
    r20R18: F("r20.patched-r18.mjs"),
    baseR17: F("r20base.r19-patched-r17.mjs"),
    r20R17: F("r20.patched-r17.mjs"),
    baseR16: F("r20base.r19-patched-r16.mjs"),
    r20R16: F("r20.patched-r16.mjs"),
    baseR15: F("r20base.r19-patched-r15.mjs"),
    r20R15: F("r20.patched-r15.mjs"),
    baseR14: F("r20base.r19-patched-r14.mjs"),
    r20R14: F("r20.patched-r14.mjs"),
    baseExec: F("r20base.r19-exec.mjs"),
    r20Exec: F("r20.r20-exec.mjs"),
  };
  writeFileSync(files.r20r19, `${shebang[0]}${r20Body}`);
  writeFileSync(files.baseR18, `${shebang[0]}${base.r19Body}`);
  writeFileSync(files.r20R18, `${shebang[0]}${mine.r19Body}`);
  writeFileSync(files.baseR17, `#!/usr/bin/env node\n${base.r18Body}`);
  writeFileSync(files.r20R17, `#!/usr/bin/env node\n${mine.r18Body}`);
  writeFileSync(files.baseR16, base.r17Body);
  writeFileSync(files.r20R16, mine.r17Body);
  writeFileSync(files.baseR15, base.r16Body);
  writeFileSync(files.r20R15, mine.r16Body);
  writeFileSync(files.baseR14, base.patchedR14);
  writeFileSync(files.r20R14, mine.patchedR14);
  writeFileSync(files.baseExec, base.r15Exec);
  writeFileSync(files.r20Exec, mine.r15Exec);
  const same = (a, b) => (existsSync(b) ? (readFileSync(b, "utf8") === a ? "相同" : "不同") : "（缺檔）");
  const diffText = (a, b, la, lb) => {
    try {
      return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail(", "viol(", "throw new Error"];
  const ALL = [...R20_R19_PATCHES, ...R20_R13_PATCHES, ...R20_R14_PATCHES];
  const MARK = { L1: "r20-L r19-E originalUserText 上限改用既有限制（裁決 4）", V0: "r20-V（執行需要／掛載點）", V1: "r20-V child script（版本識別）", V2: "r20-V whitelist（版本識別）", V4: "r20 makeR19 r20 handle（掛載點）", R1: "r20 report／summary（只新增輸出）", E1: "r20-E turn text（例外比對基準）", E2: "r20-E frame start（例外比對基準）", E3: "r20-E exception tighten（斷言收緊）", O1: "r20-O turn start db（只記錄）", O2: "r20-O turn end（只記錄）" };
  const classify = (h) => {
    const marks = new Set();
    for (const l of h.add) for (const m of l.matchAll(/r20#([A-Z]\d)/g)) marks.add(m[1]);
    if (h.add.some((l) => l.includes("phase2-r20.mjs`"))) marks.add("V1"); // child script（反引號結尾）；白名單行含 phase2-r20.mjs\" 但有 r20#V2 標記
    if (h.add.some((l) => l.includes("phase2-r20: work P1="))) marks.add("V3");
    const lab = [...marks].map((m) => (m === "V3" ? "r20-V summary（版本識別）" : MARK[m] ?? m));
    return lab.length ? lab.join("＋") : "未標記（需人工核對）";
  };
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
    const cls = hunks.map((h) => `${h.head} → ${classify(h)}（-${h.del.length} +${h.add.length}）`);
    return { deleted: del.length, added: add.length, hit, by, hunks: hunks.length, cls };
  };
  const parts = [
    diffText(files.r19, files.r20r19, "scripts/verify-destination-authority-phase2-r19.mjs", "r20 實際執行的 r19（r19＋R20_R19_PATCHES）"),
    diffText(files.baseR18, files.r20R18, "r19 實際執行的 r18", "r20 實際執行的 r18（R20_R18_PATCHES＝空；差異只來自 r19 原文層 patch 的字串）"),
    diffText(files.baseR17, files.r20R17, "r19 實際執行的 r17", "r20 實際執行的 r17"),
    diffText(files.baseR16, files.r20R16, "r19 實際執行的 r16", "r20 實際執行的 r16"),
    diffText(files.baseR15, files.r20R15, "r19 實際執行的 r15", "r20 實際執行的 r15"),
    diffText(files.baseR14, files.r20R14, "r19 實際執行的 r14", "r20 實際執行的 r14（再加 R20_R14_PATCHES）"),
    diffText(files.baseExec, files.r20Exec, "r19 實際執行內容（r13＋R14～R19_R13_PATCHES）", "r20 實際執行內容（再加 R20_R13_PATCHES）"),
  ];
  const s = parts.map(stats);
  const ids = (a) => a.map((p) => p.id).join("｜");
  const head = [
    "# r20.diff（A2-MP-T7）",
    `# r19 sha256=${r19Want}（已驗證，scratchpad/pre-MP7T-test-sha.txt）；r18～r13 由 r19～r14 驗證 sha`,
    `# 基準一致性（r20 基準＝r19 原文＋R20_R19_INFRA、R20 各層陣列皆空）：r18 層 vs scratchpad/r19.patched-r18.mjs＝${same(`${shebang[0]}${base.r19Body}`, F("r19.patched-r18.mjs"))}；r17 層 vs r19.patched-r17.mjs＝${same(`#!/usr/bin/env node\n${base.r18Body}`, F("r19.patched-r17.mjs"))}；r16 層 vs r19.patched-r16.mjs＝${same(base.r17Body, F("r19.patched-r16.mjs"))}；r15 層 vs r19.patched-r15.mjs＝${same(base.r16Body, F("r19.patched-r15.mjs"))}；r14 層 vs r19.patched-r14.mjs＝${same(base.patchedR14, F("r19.patched-r14.mjs"))}；執行內容 vs r19.r19-exec.mjs＝${same(base.r15Exec, F("r19.r19-exec.mjs"))}`,
    `# 長度上限（既有）：使用者原句 ≤${limits.userText}〔${limits.src.userText}〕；地名 ≤${limits.label}〔${limits.src.label}〕`,
    `# 第 0 部分：r19 原文 → r20 實際執行的 r19（R20_R19_PATCHES ${R20_R19_PATCHES.length} 個）：${ids(R20_R19_PATCHES)}`,
    "# 第 1～4 部分：r18／r17／r16／r15 層（R20 沒有該層 patch；差異只來自第 0 部分 child script／whitelist／summary 字串向下傳遞）",
    `# 第 5 部分：r14 層（R20_R14_PATCHES ${R20_R14_PATCHES.length} 個）：${ids(R20_R14_PATCHES)}`,
    `# 第 6 部分：r13 執行內容（R20_R13_PATCHES ${R20_R13_PATCHES.length} 個）：${ids(R20_R13_PATCHES)}`,
    ...s.map((x, i) => `#   第${i}部分 hunk=${x.hunks} 刪除行=${x.deleted} 新增行=${x.added}；刪除行含 ${KEYS.join("／")} = ${x.hit.length} ${JSON.stringify(x.by)}`),
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l.slice(0, 240)}`)),
    "# 逐 hunk 歸類（依 patch 唯一標記 r20#…；不再以字面標籤比對）：",
    ...s.flatMap((x, i) => x.cls.map((c) => `#   [第${i}部分] ${c}`)),
    `# patch 總數 ${ALL.length}`,
    "",
  ];
  writeFileSync(F("r20.diff"), `${head.join("\n")}\n${parts.map((d, i) => `######## 第 ${i} 部分 ########\n${d}`).join("\n")}`);
  let mp = { CHANGES: [], ITEMS: [] };
  try {
    mp = await import(`${WORK_ROOT}/${MP25_R3}`);
  } catch (e) {
    mp = { CHANGES: [{ no: "-", old: `（無法載入 mp25-r3：${String(e?.message ?? e).slice(0, 80)}）`, neu: "", why: "", fix: "" }], ITEMS: [] };
  }
  const esc = (x) => String(x ?? "").replace(/\|/g, "／").replace(/\n/g, " ");
  const md = [
    "# r20 契約差異（A2-MP-T7；由 r20 --emit-diff 產生）",
    "",
    `長度上限（既有限制，執行期從原始碼讀出）：使用者原句 ≤${limits.userText}〔${limits.src.userText}〕；地名 ≤${limits.label}〔${limits.src.label}〕`,
    "",
    "## r20（相對 r19）：舊 → 新 → 理由 → 裁決",
    "",
    "| 項目 | 舊 | 新 | 理由 | 裁決／修正 |",
    "|---|---|---|---|---|",
    ...R20_CONTRACT.map((r) => `| ${r.map(esc).join(" | ")} |`),
    "",
    `r20.diff 刪除行含 ${KEYS.join("／")}：${s.map((x, i) => `第${i}部分=${x.hit.length}`).join("、")}`,
    ...s.flatMap((x, i) => x.hit.map((l) => `- 第${i}部分：\`${esc(l).slice(0, 200)}\``)),
    "",
    "## mp25-r3（相對 mp25-r2）：舊 → 新 → 理由 → 裁決／修正編號",
    "",
    "| # | 舊 | 新 | 理由 | 裁決／修正 |",
    "|---|---|---|---|---|",
    ...(mp.CHANGES ?? []).map((c) => `| ${[c.no, c.old, c.neu, c.why, c.fix].map(esc).join(" | ")} |`),
    "",
    "## mp25-r3 必修 20 項＋同時測試：斷言位置",
    "",
    "| 項目 | 情境 | 斷言 |",
    "|---|---|---|",
    ...(mp.ITEMS ?? []).map((c) => `| ${[c.no, c.scen, c.where].map(esc).join(" | ")} |`),
    "",
  ];
  writeFileSync(F("r20-contract-diff.md"), md.join("\n"));
  console.log(`wrote ${F("r20.diff")}、${F("r20-contract-diff.md")}`);
  console.log(head.join("\n"));
  process.exit(0);
}

await new AsyncFunction("__r20", `"use strict";\n${r20Body}`)(makeR20({}));
