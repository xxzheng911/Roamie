#!/usr/bin/env node
/**
 * R18 — Destination Authority 全量回歸（A2-MP-T3，tester）。使用者裁決 2／3／4／5（本輪）：
 *   2. 允許新版測試更新兩條過時模擬路徑；4. 五項成本 OTHER 有條件接受為必要搜尋差異；5. G2S1 錨點調整有條件接受（沿用 r17-V）。
 *
 * 建立方式（同 r14～r17 模式）：r12–r17 保留不改。r18 在執行期讀入 r17 原文（sha1 必須 = R17_SHA），套用 R18_R17_PATCHES
 * （r17 原文層；每個錨點必須「恰好出現一次」，否則 INFRA-FAIL、不執行），再以 AsyncFunction 執行。patched r17 照常讀入
 * r16 → r15 → r14 → r13（各層 sha 檢查不變）。R18_R13／R14／R15_PATCHES 附加到 r17 的 R17_R13／R14／R15_PATCHES 之後。
 * 主程序與 collect 子程序都是同一份內容（子程序路徑改為 r18）。
 *
 * 只允許的變更（逐 hunk 見 --emit-diff 產生的 scratchpad/r18.diff）：
 *  r18-V  版本識別：子程序路徑 r18、摘要行、F7 後變動檔白名單 r1[0-7] → r1[0-8]＋more-places-r4＋mp25（精確路徑）；
 *         AsyncFunction 執行需要：r17 的 import 陳述式／import() 改由 __r18.imp 代為 import。
 *  r18-P  （裁決 2）兩條過時模擬路徑改為「擷取該樹正式 _app.chat.tsx 原始碼」執行（TypeScript AST，同 r14 方法）：
 *           r18FbContinue＝applyLocalFallback（useCallback）內「continue if」整段（條件含 matchesContinueRecommendationGrammar(activeUserText)
 *                         與 isExplicitDeviceNearbyRequest(activeUserText)；work L6795-6857），取代「r14-Δ5 fallback continue」模型；
 *           r18RefineMore＝send() 內 if (arbitration.route === "MORE_RECOMMENDATIONS") { const destForMore … pushMorePlaceRecommendations … }
 *                         （work L10191-10217），取代「r14-Δ5 refinement more」模型中 MORE 區塊（其後 pushRecommendationRefinement 一行不變＝正式碼 L10218）。
 *         擷取：每樹恰好 1 處（0 或 ≥2 → INFRA-FAIL）；閉包依賴＝R14_CLOSURE_DEPS（已審查）＋該區塊的模型區域變數（明列，見 R18_LOCALS）；
 *         其餘未知依賴 → INFRA-FAIL；不是 noop。
 *  r18-H  （MP-25 驗收用；目前所有樹皆無）send() 內若有「單一」if 條件含 pendingGeographic?.kind === "destination_switch"（且不含
 *         parent_city_scope／destination_area），擷取為 r18DestSwitch，於模型 pending handler 之前（＝正式碼 L8922 前）執行。
 *         0 處＝該樹沒有 handler（模型照舊）；≥2 處 → INFRA-FAIL。
 *  r18-N  （裁決 4）R10-a2-kyoto-kanazawa-more[ok] 的五項成本 P1（T2 weather／Places(builder)／Places(requests) 次數、情境總 Places(builder)／
 *         Places(requests)）只在 r18NecessaryCheck 全部條件成立時改列 NECESSARY-SEARCH；任一條件不成立 → 維持 P1。其他 P1 一律不動。
 *  r18-G／I／O  外掛情境專用（r13 情境沒有這些欄位 → 不執行）：逐輪 Provider 模式（SCENARIO.r18GeoByTurn）、初始 Session
 *         （SCENARIO.r18Init：只有 activeRecommendationContext／travelContext）、Client 保存的 pendingClarification 原樣注入
 *         （SCENARIO.r18Pending）、每輪記錄完整 pendingClarification／輪初 Context／rec（只記錄，不進 r13 judge）。
 *  不變：r13 的情境／Fixture／Assertion／expect／MODES／Credits 結算條件／Provider 請求限制／P1／P2 分類、r14～r17 的全部斷言與對照；
 *        r17-V 的 G2S1 條件式放寬（work 段落逐字扣除 F2 區塊後須與 mp1 段落完全相同才加上該區塊長度）原樣沿用。外部請求攔截同 r13。
 *
 * 執行：node scripts/verify-destination-authority-phase2-r18.mjs --brief --f10 --pa2 --a2 --mp1 [--only=ID,…] [--out=<scratchpad>/x.log] [--conc=N]
 *       node scripts/verify-destination-authority-phase2-r18.mjs --emit-diff     （寫 scratchpad/r18.diff 與 r18.* 執行內容）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R17_FILE = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r17.mjs`;
const R17_SHA_FILE = `${PRE_DIR}/pre-MP3T-test-sha.txt`; // A2-MP-T3 開始前的 scripts sha256 快照
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const L = (...lines) => lines.join("\n");
const NT = "__r14_branch_not_taken";

/** 區塊 → 模型在呼叫點傳入的區域變數（已審查；其餘閉包名稱必須在 R14_CLOSURE_DEPS）。 */
const R18_LOCALS = {
  r18FbContinue: ["scopedSession", "activeUserText", "conversation", "explicitScope"],
  r18RefineMore: ["arbitration", "nextSession", "refreshedPlaceCtx", "trimmed", "next"],
  r18DestSwitch: ["msgs", "trimmed", "displayMessage", "nextSession", "pendingGeographic", "nearbyShortcutTurn", "turnPendingGeographic", "turnStartSession"],
};

// ════════════════════════ 狀態／報告（主程序）════════════════════════
const R18_STATE = { extract: {}, necessary: {}, kept: {}, cond: {}, runs: null };
const PK = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
const K = (v) => {
  if (v == null || v === "") return null;
  const k = PK.find((x) => String(v).includes(x)) ?? "?";
  return k === "金沢" ? "金澤" : k;
};

function r18NoteExtract(tree, ex) {
  const pick = (n) => (ex.units[n] ? { start: ex.units[n].start, end: ex.units[n].end, sha: ex.units[n].sha, closure: ex.units[n].closure, imports: ex.units[n].imports.length } : null);
  R18_STATE.extract[tree] = { r18FbContinue: pick("r18FbContinue"), r18RefineMore: pick("r18RefineMore"), r18DestSwitch: pick("r18DestSwitch") };
}

/**
 * r18-N（裁決 4）：R10-a2-kyoto-kanazawa-more[ok] 的 5 項成本 P1 → NECESSARY-SEARCH 的精確條件（全部成立才改列；否則維持 P1）。
 * 只看該樹與 base 的同一情境／同一 mode 的逐輪 obs（機器可檢查）。
 */
const R18_N_SID = "R10-a2-kyoto-kanazawa-more";
const R18_N_RE = new RegExp(String.raw`^\[R10-a2-kyoto-kanazawa-more\]\[ok\] .+ (T2 (weather|Places\(builder\)|Places\(requests\)) 次數 work=(\d+) > base=(\d+)|情境總 (Places\(builder\)|Places\(requests\)) work=(\d+) > base=(\d+))$`);
function r18NecessaryCheck(tree, results) {
  const c = [];
  const ck = (ok, msg) => c.push({ ok: Boolean(ok), msg });
  const W = results[`${tree}|ok|${R18_N_SID}`]?.result?.turns ?? [];
  const B = results[`base|ok|${R18_N_SID}`]?.result?.turns ?? [];
  ck(W.length === 2 && B.length === 2, `C1 兩樹皆 2 輪（${tree}=${W.length} base=${B.length}）`);
  if (W.length !== 2 || B.length !== 2) return c;
  const [w1, w2] = W;
  const [b1, b2] = B;
  const n = (t, f) => (f === "geocode" ? t.geocodes.length : f === "weather" ? t.weatherCalls : f === "builder" ? t.builderCalls : t.placesRequests);
  ck(["geocode", "weather", "builder", "places"].every((f) => n(w1, f) === n(b1, f)), `C2 T1 Provider 次數與 base 相同（geocode/weather/builder/places ${tree}=${["geocode", "weather", "builder", "places"].map((f) => n(w1, f)).join("/")} base=${["geocode", "weather", "builder", "places"].map((f) => n(b1, f)).join("/")}）`);
  const trusted = (w2.trust ?? []).filter((t) => t.status === "trusted");
  const untrusted = (w2.trust ?? []).filter((t) => t.status !== "trusted");
  ck(trusted.length >= 1 && trusted.every((t) => K(t.destination) === "金澤") && !untrusted.length, `C3 T2 可信判定＝已確認新目的地金澤（trust=${(w2.trust ?? []).map((t) => `${t.status}:${t.destination ?? "-"}`).join(",") || "-"}）`);
  const pDest = (w2.placesQueries ?? []).map((q) => String(q).split("@").at(-1));
  ck(pDest.length >= 1 && pDest.every((d) => K(d) === "金澤"), `C4 T2 Places 搜尋目的地全部＝金澤（${pDest.join(",") || "-"}）`);
  ck(w2.placesRequests <= 1 && w2.builderCalls <= 1 && w2.weatherCalls <= 1, `C5 T2 次數上限 Places(requests)≤1／builder≤1／weather≤1（${w2.placesRequests}/${w2.builderCalls}/${w2.weatherCalls}）`);
  {
    const ctr = trusted.at(-1)?.center ?? null;
    const near = (d) => {
      const lat = Number(String(d).match(/"lat(?:itude)?":(-?[\d.]+)/)?.[1]);
      const lng = Number(String(d).match(/"(?:lng|lon|longitude)":(-?[\d.]+)/)?.[1]);
      return Boolean(ctr) && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat - ctr.lat) < 1e-6 && Math.abs(lng - ctr.lng) < 1e-6;
    };
    const ws = w2.r18Weather ?? [];
    // weather 請求不帶城市名稱：以「在本輪唯一的金澤 Builder 內發出（phase=builder；C4／C5）且座標＝可信判定中心」判定。
    // 注意：Fixture 的金澤／京都中心皆為 Mock 預設座標時，座標本身無法區分城市，故必須同時滿足 phase=builder。
    ck(ws.length === w2.weatherCalls && ws.every((w) => w.phase === "builder" && (/金澤|金沢|Kanazawa/i.test(w.data) || near(w.data))), `C6 T2 weather 請求在金澤 Builder 內、座標＝可信中心（${ctr ? `${ctr.lat},${ctr.lng}` : "-"}；${ws.map((w) => `${w.phase}:${w.data.slice(0, 80)}`).join(" | ") || "-"}）`);
  }
  const g = w2.geocodes ?? [];
  ck(new Set(g).size === g.length && g.length <= 1 && (w2.r15Geo ?? []).every((x) => x.outcome === "ok"), `C7 T2 geocode 無重複／無重試／無失敗（${g.join(",") || "-"}；outcome=${(w2.r15Geo ?? []).map((x) => x.outcome).join(",") || "-"}）`);
  const cr = w2.r15Credits ?? [];
  const rpc = w2.creditsRpc ?? [];
  ck(cr.length === 1 && K(cr[0].destination) === "金澤" && cr[0].path === "more_places", `C8 T2 Credits metadata＝more_places:金澤 恰好 1 次（${cr.map((x) => `${x.path}:${x.destination}`).join(",") || "-"}）`);
  ck(JSON.stringify(w2.creditsSettle ?? []) === "[true]" && rpc.filter((x) => x === "credits_reserve").length === 1 && rpc.filter((x) => x === "credits_commit").length === 1 && !rpc.includes("credits_rollback"), `C9 T2 Credits 正確結算（settle=${JSON.stringify(w2.creditsSettle ?? [])} rpc=${rpc.join(",") || "-"}）`);
  const cards = w2.r15Cards ?? [];
  ck(cards.length > 0 && cards.every((x) => K(`${x.name}|${x.id}`) === "金澤"), `C10 T2 卡片全部＝金澤（${cards.length} 張）`);
  const bc = b2.r15Cards ?? [];
  ck(b2.placesRequests === 0 && b2.builderCalls === 0 && b2.weatherCalls === 0 && bc.length > 0 && bc.every((x) => K(`${x.name}|${x.id}`) === "京都"), `C11 base T2 錯誤沿用舊城市（京都）池、0 次搜尋（places=${b2.placesRequests} builder=${b2.builderCalls} weather=${b2.weatherCalls} 卡片=${[...new Set(bc.map((x) => K(`${x.name}|${x.id}`)))].join(",") || "-"}）`);
  return c;
}
function r18Necessary({ J, results }) {
  for (const tree of Object.keys(J)) {
    const p1 = J[tree]?.p1;
    if (!Array.isArray(p1)) continue;
    const hit = p1.filter((x) => R18_N_RE.test(x));
    if (!hit.length) continue;
    const cond = r18NecessaryCheck(tree, results);
    R18_STATE.cond[tree] = cond;
    const ok = cond.length === 11 && cond.every((x) => x.ok);
    if (!ok) {
      R18_STATE.kept[tree] = [...new Set(hit)];
      continue;
    }
    R18_STATE.necessary[tree] = [...new Set(hit)];
    for (let i = p1.length - 1; i >= 0; i -= 1) if (R18_N_RE.test(p1[i])) p1.splice(i, 1);
  }
}

function r18Runs(results) {
  const rows = [];
  const cnt = {};
  for (const [key, r] of Object.entries(results)) {
    const [tree, mode, sid] = key.split("|");
    let prevTc = null;
    for (const t of r?.result?.turns ?? []) {
      for (const b of t.r18Blocks ?? []) {
        const c = (cnt[tree] ??= {});
        const x = (c[b.name] ??= { invoked: 0, entered: 0, taken: 0 });
        x.invoked += 1;
        const entered = b.ret !== "not_taken" || (b.calls ?? []).length > 0;
        if (entered) x.entered += 1;
        if (b.ret !== "not_taken") x.taken += 1;
        if (entered && (tree === "work" || tree === "mp1" || tree === "a2")) {
          const arc0 = t.r18ArcAtStart ?? null;
          const ref0 = t.r18RecAtStart ?? prevTc ?? null;
          const stale0 = Boolean(arc0 && ref0 && K(arc0) !== K(ref0));
          const dests = [...(t.r15Credits ?? []).map((x) => x.destination), ...(t.placesQueries ?? []).map((q) => String(q).split("@").at(-1)), ...(t.r15Cards ?? []).map((x) => `${x.name}|${x.id}`)];
          const byStale = stale0 && dests.some((d) => K(d) === K(arc0));
          rows.push({ tree, mode, sid, turn: t.turnIndex + 1, name: b.name, ret: b.ret, calls: (b.calls ?? []).join(","), arc0, ref0, stale0, staleCalls: JSON.stringify(t.r17StaleCalls ?? null), byStale, dests: [...new Set(dests.map(K))].join(",") });
        }
      }
      prevTc = t.sessionDest ?? prevTc;
    }
  }
  return { rows, cnt };
}

function r18Report({ P1, out, results }) {
  out.push("\n══════════════════════ r18（A2-MP-T3）══════════════════════");
  out.push("══ r18-P：兩條續推路徑改為擷取正式原始碼（TypeScript AST；該樹 _app.chat.tsx 行號、閉包）══");
  for (const [tree, ex] of Object.entries(R18_STATE.extract)) {
    const f = (u) => (u ? `L${u.start}-${u.end} sha=${u.sha.slice(0, 12)} import=${u.imports} 閉包=[${u.closure.join(",")}]` : "（無）");
    out.push(`  ${tree.padEnd(5)} r18FbContinue ${f(ex.r18FbContinue)}`);
    out.push(`        r18RefineMore ${f(ex.r18RefineMore)}`);
    out.push(`        r18DestSwitch ${ex.r18DestSwitch ? f(ex.r18DestSwitch) : "（該樹 send() 沒有 destination_switch handler → 模型照舊）"}`);
  }
  out.push(`  區域變數（模型在呼叫點傳入當下值）：${Object.entries(R18_LOCALS).map(([n, v]) => `${n}=${v.join("、")}`).join("；")}`);
  const runs = r18Runs(results);
  R18_STATE.runs = runs;
  out.push("\n══ r18-P：路徑實際執行次數（各樹；invoked＝區塊被呼叫、entered＝進入條件內（有回傳或呼叫了 Callback）、taken＝區塊 return）══");
  for (const [tree, c] of Object.entries(runs.cnt)) out.push(`  ${tree.padEnd(5)} ${Object.entries(c).map(([n, x]) => `${n} invoked=${x.invoked} entered=${x.entered} taken=${x.taken}`).join("；")}`);
  if (!Object.keys(runs.cnt).length) out.push("  （本次沒有任何輪次呼叫 r18 區塊）");
  out.push("── 進入條件內的輪次（work／mp1／a2）：過期 Context（輪初 Context≠輪初 rec／travelContext）是否決定了本輪目的地 ──");
  for (const r of runs.rows) out.push(`  ${r.tree.padEnd(5)} [${r.sid}][${r.mode}] T${r.turn} ${r.name} ret=${r.ret} calls=[${r.calls}] 輪初 Context=${r.arc0 ?? "-"} 輪初 rec/tc=${r.ref0 ?? "-"} 過期=${r.stale0} isStale=${r.staleCalls} 本輪目的地=[${r.dests || "-"}] → ${r.byStale ? "FAIL（過期 Context 決定目的地）" : "OK"}`);
  if (!runs.rows.length) out.push("  (none)");
  out.push("\n══ r18-N（裁決 4）：R10-a2-kyoto-kanazawa-more[ok] 成本差異 → NECESSARY-SEARCH 條件（全部成立才改列；否則維持 P1）══");
  for (const [tree, cond] of Object.entries(R18_STATE.cond)) {
    out.push(`  ${tree}：${cond.every((x) => x.ok) && cond.length === 11 ? "條件全部成立" : "條件不成立 → 維持 P1"}`);
    for (const x of cond) out.push(`    [${x.ok ? "OK" : "NG"}] ${x.msg}`);
  }
  for (const [tree, v] of Object.entries(R18_STATE.necessary)) out.push(`  ── ${tree} NECESSARY-SEARCH=${v.length} ──`, ...v.map((x) => `    [NECESSARY-SEARCH] ${x}`));
  for (const [tree, v] of Object.entries(R18_STATE.kept)) out.push(`  ── ${tree} 條件不成立、維持 P1=${v.length} ──`, ...v.map((x) => `    [P1] ${x}`));
  if (!Object.keys(R18_STATE.cond).length) out.push("  （本次沒有任何樹出現這 5 項成本 P1）");
  out.push("\n══ r18：G2S1 錨點（沿用 r17-V，裁決 5）══");
  out.push("  條件：r13 G2S1 anchor「moreAt→credits metadata 3000 字元視窗」只在 work 的 pushMorePlaceRecommendations 段落（const pushMorePlaceRecommendations = useCallback( 至");
  out.push('        metadata: { path: "more_places", destination },）恰好含 1 個 F2 scopedRecContext 區塊（逐字）、且刪除該區塊後與 mp1 段落逐字相同時，視窗加上該區塊長度；否則加 0（＝原條件）。');
  void P1;
}
function r18SummaryFields() {
  const c = R18_STATE.runs?.cnt?.work ?? {};
  const e = (n) => c[n]?.entered ?? 0;
  const nec = Object.entries(R18_STATE.necessary).map(([t, v]) => `${t}=${v.length}`).join(",") || "0";
  const bad = (R18_STATE.runs?.rows ?? []).filter((r) => r.byStale && r.tree === "work").length;
  return `r18[路徑 work：fbContinue entered=${e("r18FbContinue")} refineMore entered=${e("r18RefineMore")} 過期 Context 決定目的地=${bad}；NECESSARY-SEARCH ${nec}；destSwitch handler work=${R18_STATE.extract.work?.r18DestSwitch ? "有" : "無"}]`;
}

// ════════════════════════ R18_R13_PATCHES（r13 原文層；套在 R17_R13_PATCHES 之後）════════════════════════
const R18_R13_PATCHES = [
  {
    id: "r18-G geo outer",
    kind: "exact",
    old: '  const GEO_MODE = process.env.VERIFY_P2_GEO ?? "ok";\n',
    neu: '  const GEO_MODE = process.env.VERIFY_P2_GEO ?? "ok";\n  const R18_GEO_OUTER = GEO_MODE; // r18-G\n  let R18_TURN_I = -1; // r18-G：目前輪次（只在 SCENARIO.r18GeoByTurn 情境改變 geocode 模式）\n',
  },
  {
    id: "r18-G geocodeFn per-turn mode",
    kind: "exact",
    old: "  const geocodeFn = async (req) => {\n",
    neu: "  const geocodeFn = async (req) => {\n    const GEO_MODE = SCENARIO.r18GeoByTurn && Object.prototype.hasOwnProperty.call(SCENARIO.r18GeoByTurn, String(R18_TURN_I)) ? SCENARIO.r18GeoByTurn[String(R18_TURN_I)] : R18_GEO_OUTER; // r18-G\n",
  },
  { id: "r18-G turn index", kind: "exact", old: "      obs.turnIndex = turnIndex + TURN_OFFSET;\n", neu: "      obs.turnIndex = turnIndex + TURN_OFFSET;\n      R18_TURN_I = obs.turnIndex; // r18-G\n" },
  {
    id: "r18-O turn start",
    kind: "exact",
    old: "      obs.pendingAtStart = pendingKey(persisted.pendingClarification);\n",
    neu: L(
      "      obs.pendingAtStart = pendingKey(persisted.pendingClarification);",
      "      // r18-O：輪初 Context／rec／pendingClarification（只記錄）",
      "      obs.r18ArcAtStart = persisted.activeRecommendationContext?.destinationName ?? null;",
      "      obs.r18RecAtStart = persisted.recommendationSession?.destination ?? null;",
      "      obs.r18PendingAtStart = persisted.pendingClarification ? JSON.parse(JSON.stringify(persisted.pendingClarification)) : null;",
      "",
    ),
  },
  {
    id: "r18-O turn end",
    kind: "exact",
    old: "      obs.r17Pending = persisted.pendingClarification ? { kind: persisted.pendingClarification.kind ?? null, raw: persisted.pendingClarification.rawGeographicLabel ?? null, parent: persisted.pendingClarification.confirmedParentCity ?? null } : null;\n",
    neu: L(
      "      obs.r17Pending = persisted.pendingClarification ? { kind: persisted.pendingClarification.kind ?? null, raw: persisted.pendingClarification.rawGeographicLabel ?? null, parent: persisted.pendingClarification.confirmedParentCity ?? null } : null;",
      "      obs.r18Pending = persisted.pendingClarification ? JSON.parse(JSON.stringify(persisted.pendingClarification)) : null; // r18-O",
      "      obs.r18Tpc = persisted.tripPlanningContext?.destination ?? null; // r18-O",
      "      obs.r18TripDest = persisted.tripDestination?.city ?? persisted.tripDestination?.displayLabel ?? null; // r18-O",
      "      obs.r18Weather = weatherCalls.slice(w0).map((w) => ({ phase: w.phase, data: JSON.stringify(w.data ?? null).slice(0, 300) })); // r18-O：本輪 weather 請求內容（只記錄）",
      "",
    ),
  },
  {
    id: "r18-I init",
    kind: "exact",
    old: "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init && SCENARIO.r17Arc) persisted = ",
    neu: L(
      "  // r18-I：外掛情境的初始 Session（r18Init：只有 activeRecommendationContext＋travelContext；r18Pending：Client 保存的 pendingClarification 原樣注入）",
      '  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && !SCENARIO.r15Init && SCENARIO.r18Init) persisted = { ...baseSession(), ...(SCENARIO.r18Init.arc ? { activeRecommendationContext: M.refine.createActiveRecommendationContext({ destinationName: SCENARIO.r18Init.arc.destination, destinationDisplayName: SCENARIO.r18Init.arc.destination, intent: SCENARIO.r18Init.arc.intent ?? "restaurant", searchScope: "city", placeIds: [], canonicalKeys: [], usedQueries: [] }) } : {}), ...(SCENARIO.r18Init.activeCategoryIntent ? { activeCategoryIntent: SCENARIO.r18Init.activeCategoryIntent } : {}), travelContext: { interests: [], destination: SCENARIO.r18Init.travelDestination } };',
      "  if (!process.env.VERIFY_P2_INIT && !SCENARIO.initKind && SCENARIO.r15Init && SCENARIO.r17Arc) persisted = ",
    ),
  },
  {
    id: "r18-I pending inject",
    kind: "exact",
    old: "  const pendingKey = (p) => (p ? `${p.kind}:${p.confirmedParentCity ?? \"\"}:${p.rawGeographicLabel}` : null);\n",
    neu: L(
      "  const pendingKey = (p) => (p ? `${p.kind}:${p.confirmedParentCity ?? \"\"}:${p.rawGeographicLabel}` : null);",
      "  if (!process.env.VERIFY_P2_INIT && SCENARIO.r18Pending) persisted = { ...persisted, pendingClarification: JSON.parse(JSON.stringify(SCENARIO.r18Pending)) }; // r18-I：Client 保存的 pending（未經 Provider 驗證）",
      "",
    ),
  },
  {
    id: "r18-H destination_switch handler",
    kind: "exact",
    old: '    if (IS_WORK) {\n      if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {\n',
    neu: L(
      "    // r18-H：MP-25 destination_switch handler（正式碼；該樹 send() 有單一 if 條件含 pendingGeographic?.kind === \"destination_switch\" 時才執行；位置＝正式碼 parent_city_scope handler 之前）",
      "    if (R14X.units.r18DestSwitch) {",
      "      const r18L = { msgs, trimmed, displayMessage: trimmed, nextSession, pendingGeographic, nearbyShortcutTurn, turnPendingGeographic, turnStartSession };",
      '      const r18v = await R18_runBlock("r18DestSwitch", r18L);',
      "      nextSession = r18L.nextSession;",
      `      if (r18v !== "${NT}") {`,
      '        obs.path += "|r18:destSwitch(real)";',
      "        return;",
      "      }",
      "    }",
      "    if (IS_WORK) {",
      '      if (pendingGeographic?.kind === "parent_city_scope" && !nearbyShortcutTurn) {',
      "",
    ),
  },
  { id: "r18-N necessary-search", kind: "exact", old: 'const JB = judge("base");\n', neu: 'const JB = judge("base");\n__r14.r15.r16.r17.r18.necessary({ J, results }); // r18-N：裁決 4（精確條件；不成立維持 P1）\n' },
];

// ════════════════════════ R18_R14_PATCHES（r14 原文層；套在 R17_R14_PATCHES 之後）════════════════════════
const R18_FB_MODEL_OLD = L(
  '    "    // L6735-6795 continue → r14-Δ5：正式 pushRecommendationRefinement／pushMorePlaceRecommendations（r13 未重建）",',
  '    "    if (",',
  '    "      (scopedSession.activeRecommendationContext || scopedSession.recommendationSession || M.crs.resolveActiveCategoryIntent(scopedSession)) &&",',
  '    "      (M.crg.matchesContinueRecommendationGrammar(activeUserText) || M.refresh.isMorePlaceRecommendationsIntent(activeUserText) || M.refresh.isRefreshRecommendationsRequest(activeUserText)) &&",',
  '    "      !M.rss.isExplicitDeviceNearbyRequest(activeUserText)",',
  '    "    ) {",',
  '    "      const dest =",',
  '    "        scopedSession.activeRecommendationContext?.destinationName ||",',
  '    "        scopedSession.recommendationSession?.destination ||",',
  '    "        scopedSession.travelContext?.destination ||",',
  '    "        scopedSession.tripPlanningContext?.destination;",',
  "    '      if (dest?.trim() && (!explicitScope || !M.fbScope.shouldBlockCrossScopeRecommendationFallback({ explicit: explicitScope, sourcePath: \"recommendation-refinement-fallback\", fallbackDestination: dest }))) {',",
  "    '        obs.path += \"|fb_continue(real)\";',",
  '    "        const arbitration = M.refine.resolveChatIntentArbitration(activeUserText, scopedSession);",',
  "    '        if (arbitration.route === \"MORE_RECOMMENDATIONS\" || arbitration.route === \"RECOMMENDATION_REFINEMENT\") {',",
  '    "          if (await R14_cbs.pushRecommendationRefinement(scopedSession, activeUserText, conversation)) return true;",',
  '    "        }",',
  '    "        const more = await R14_cbs.pushMorePlaceRecommendations(",',
  "    '          { ...scopedSession, travelContext: { ...(scopedSession.travelContext ?? { interests: [] }), destination: dest, tripPurpose: \"more_place_recommendations\" } },',",
  '    "          activeUserText,",',
  '    "          conversation,",',
  '    "        );",',
  '    "        return Boolean(more);",',
  '    "      }",',
  '    "    }",',
  "",
);
const R18_FB_MODEL_NEU = L(
  '    "    // r18-P（裁決 2）：applyLocalFallback continue（work L6795-6857）→ 執行擷取的正式原始碼（continue if 整段；取代 r14-Δ5 模型）",',
  '    "    {",',
  "    '      const r18v = await R18_runBlock(\"r18FbContinue\", { scopedSession, activeUserText, conversation, explicitScope });',",
  `    '      if (r18v !== "${NT}") {',`,
  "    '        obs.path += \"|r18:fbContinue(real)=\" + String(r18v);',",
  '    "        return r18v;",',
  '    "      }",',
  "    '      if ((obs.r18Blocks ?? []).at(-1)?.calls?.length) obs.path += \"|r18:fbContinue(real)=fallthrough\";',",
  '    "    }",',
  "",
);
const R18_MORE_MODEL_OLD = L(
  "    '      if (arbitration.route === \"MORE_RECOMMENDATIONS\") {',",
  '    "        const destForMore =",',
  '    "          nextSession.activeRecommendationContext?.destinationName ||",',
  '    "          nextSession.recommendationSession?.destination ||",',
  '    "          nextSession.travelContext?.destination ||",',
  '    "          nextSession.tripPlanningContext?.destination ||",',
  '    "          nextSession.tripDestination?.city;",',
  '    "        // r14-Δ5：L10125-10146 正式 pushMorePlaceRecommendations（取代 r13 recordContinuation 鏡像）",',
  '    "        if (destForMore?.trim()) {",',
  '    "          const appliedMore = await R14_cbs.pushMorePlaceRecommendations(",',
  "    '            { ...nextSession, travelContext: { ...refreshedPlaceCtx, destination: destForMore, tripPurpose: \"more_place_recommendations\" } },',",
  '    "            trimmed,",',
  '    "            next,",',
  '    "          );",',
  '    "          if (appliedMore) return;",',
  '    "        }",',
  '    "      }",',
  "",
);
const R18_MORE_MODEL_NEU = L(
  '    "      // r18-P（裁決 2）：refinement 區塊 MORE_RECOMMENDATIONS（work L10191-10217）→ 執行擷取的正式原始碼（取代 r14-Δ5 模型）",',
  '    "      {",',
  "    '        const r18v = await R18_runBlock(\"r18RefineMore\", { arbitration, nextSession, refreshedPlaceCtx, trimmed, next });',",
  `    '        if (arbitration.route === "MORE_RECOMMENDATIONS") obs.path += r18v !== "${NT}" ? "|r18:refineMore(real)=T" : "|r18:refineMore(real)=fallthrough";',`,
  `    '        if (r18v !== "${NT}") return;',`,
  '    "      }",',
  "",
);
/** r18-P 擷取（插入 r14ExtractChat；本函式從不直接呼叫，toString() 取本體插入）。 */
function r18ExtractInject() {
  // ── r18-P：applyLocalFallback continue if／send() refinement MORE 區塊／（MP-25）destination_switch handler ──
  {
    let fbFn = null;
    const v1 = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "applyLocalFallback" && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(sf) === "useCallback") {
        if (fbFn) throw new Error(`[r18-extract] ${label} applyLocalFallback 出現兩次`);
        fbFn = node.initializer.arguments[0];
      }
      ts.forEachChild(node, v1);
    };
    v1(sf);
    if (!fbFn) throw new Error(`[r18-extract] ${label} 找不到 applyLocalFallback`);
    const fbHits = [];
    const v2 = (node) => {
      if (ts.isIfStatement(node)) {
        const c = node.expression.getText(sf);
        if (/\bmatchesContinueRecommendationGrammar\(activeUserText\)/.test(c) && /\bisExplicitDeviceNearbyRequest\(activeUserText\)/.test(c)) fbHits.push(node);
      }
      ts.forEachChild(node, v2);
    };
    v2(fbFn.body);
    if (fbHits.length !== 1) throw new Error(`[r18-extract] ${label} applyLocalFallback continue if 出現 ${fbHits.length} 次（必須 1 次）`);
    found.r18FbContinue = { kind: "r18block", node: fbHits[0], text: fbHits[0].getText(sf) };
    const mHits = [];
    const swHits = [];
    const v3 = (node) => {
      if (ts.isIfStatement(node)) {
        const c = node.expression.getText(sf);
        const body = node.thenStatement.getText(sf);
        if (c === 'arbitration.route === "MORE_RECOMMENDATIONS"' && /\bconst destForMore\b/.test(body) && /\bpushMorePlaceRecommendations\(/.test(body)) mHits.push(node);
        if (/pendingGeographic\?\.kind === "destination_switch"/.test(c) && !/parent_city_scope|destination_area/.test(c)) swHits.push(node);
      }
      ts.forEachChild(node, v3);
    };
    v3(sendFn.body);
    if (mHits.length !== 1) throw new Error(`[r18-extract] ${label} send() refinement MORE 區塊出現 ${mHits.length} 次（必須 1 次）`);
    found.r18RefineMore = { kind: "r18block", node: mHits[0], text: mHits[0].getText(sf) };
    if (swHits.length > 1) throw new Error(`[r18-extract] ${label} send() destination_switch handler 出現 ${swHits.length} 次（必須 0 或 1 次）`);
    if (swHits.length === 1) found.r18DestSwitch = { kind: "r18block", node: swHits[0], text: swHits[0].getText(sf) };
  }
}
/** r18-P 子程序執行器（插入 r14ChildHarness；本函式從不直接呼叫）。回傳區塊原始回傳值；記錄於本輪 obs.r18Blocks。 */
function r18RunInject() {
  // ── r18-P：正式區塊（回傳原始值；未知依賴 → 丟錯＝INFRA-FAIL）──
  async function R18_runBlock(name, locals) {
    const u = R14X.units[name];
    if (!u) throw new Error(`[r14] r18 payload 缺少 ${name}`);
    for (const c of u.closure) if (!Object.hasOwn(R14_closure, c) && !Object.hasOwn(locals, c)) throw new Error(`[r14] ${name} 未知依賴：${c}`);
    const o = R14_CUR.obs;
    const c0 = o ? o.r14Calls.length : 0;
    // scope 物件＝locals 本身（區塊內對區域變數的重新指派會寫回 locals，例如 nextSession），閉包依賴補在其後（locals 優先）
    const v = await R14_compile(u.js, R14_scope(Object.assign(locals, { ...R14_closure, ...locals })))();
    if (o) (o.r18Blocks ??= []).push({ name, ret: v === "__r14_branch_not_taken" ? "not_taken" : String(v), calls: o.r14Calls.slice(c0) });
    return v;
  }
}
const inj = (fn) => {
  const s = fn.toString();
  return s.slice(s.indexOf("{") + 1, s.lastIndexOf("}"));
};
const R18_R14_PATCHES = [
  {
    id: "r18-P extract",
    kind: "exact",
    old: "  for (const n of [...R14_CALLBACKS, ...R14_BLOCKS]) if (!found[n]) throw new Error(",
    neu: `${inj(r18ExtractInject)}\n  for (const n of [...R14_CALLBACKS, ...R14_BLOCKS]) if (!found[n]) throw new Error(`,
  },
  {
    id: "r18-P closure locals",
    kind: "exact",
    old: '      const allowed = new Set([...Object.keys(R14_CLOSURE_DEPS), ...(u.kind === "block" ? R14_BLOCK_LOCALS : [])]);',
    neu: `      const allowed = new Set([...Object.keys(R14_CLOSURE_DEPS), ...(u.kind === "block" ? R14_BLOCK_LOCALS : u.kind === "r18block" ? (${JSON.stringify(R18_LOCALS)})[name] ?? [] : [])]); // r18-P：區塊區域變數（明列）`,
  },
  { id: "r18-P note extract", kind: "exact", old: "      __r15.r16.r17.noteExtract(tree, ex);\n", neu: "      __r15.r16.r17.noteExtract(tree, ex);\n      __r15.r16.r17.r18.noteExtract(tree, ex); // r18-P\n" },
  { id: "r18-P child runner", kind: "exact", old: "  function R14_turnEnd(o, r0) {\n", neu: `${inj(r18RunInject)}\n  function R14_turnEnd(o, r0) {\n` },
  { id: "r18-P fallback continue model → 正式碼", kind: "exact", old: R18_FB_MODEL_OLD, neu: R18_FB_MODEL_NEU },
  { id: "r18-P refinement more model → 正式碼", kind: "exact", old: R18_MORE_MODEL_OLD, neu: R18_MORE_MODEL_NEU },
];

// ════════════════════════ R18_R15_PATCHES（r15 原文層；套在 R17_R15_PATCHES 之後）════════════════════════
const R18_R15_PATCHES = [
  {
    id: "r18 report",
    kind: "exact",
    old: "  __r16.r17.reportMp1({ P1, out }); // r17-M：work 相對 mp1、r17-C 擷取表（只新增輸出）\n",
    neu: "  __r16.r17.reportMp1({ P1, out }); // r17-M：work 相對 mp1、r17-C 擷取表（只新增輸出）\n  __r16.r17.r18.report({ P1, out, results, TREES }); // r18：r18-P 擷取／執行次數、r18-N 條件（只新增輸出）\n",
  },
];

// ════════════════════════ R18_R17_PATCHES（r17 原文層）════════════════════════
const R18_R17_INFRA = [
  {
    id: "r18-V static imports → __r18.imp（AsyncFunction 執行需要）",
    old: L('import { readFileSync, writeFileSync, existsSync } from "node:fs";', 'import { createHash } from "node:crypto";', 'import { execFileSync } from "node:child_process";'),
    neu: L(
      'const { readFileSync, writeFileSync, existsSync } = await __r18.imp("node:fs"); // r18：同 r17 的 import（AsyncFunction 內不能用 import 陳述式）',
      'const { createHash } = await __r18.imp("node:crypto");',
      'const { execFileSync } = await __r18.imp("node:child_process");',
    ),
  },
  { id: "r18-V __r17.imp", old: "const makeR17 = (extra) => ({\n  imp: (s) => import(s),\n", neu: "const makeR17 = (extra) => ({\n  imp: __r18.imp, // r18\n" },
  { id: "r18 __r17.r18", old: "  emitMode: false,\n  r16Extra: null,\n", neu: "  r18: __r18, // r18\n  emitMode: false,\n  r16Extra: null,\n" },
  {
    id: "r18 patch hooks r13/r14/r15",
    old: "const R17_R15_PATCHES = [];\n",
    neu: "const R17_R15_PATCHES = [];\nfor (const p of __r18.r13Patches) R17_R13_PATCHES.push(p); // r18：R18_R13_PATCHES 套在 R17_R13_PATCHES 之後\nfor (const p of __r18.r14Patches) R17_R14_PATCHES.push(p); // r18：R18_R14_PATCHES 套在 R17_R14_PATCHES 之後\nfor (const p of __r18.r15Patches) R17_R15_PATCHES.push(p); // r18：R18_R15_PATCHES 套在 R17_R15_PATCHES 之後\n",
  },
  { id: "r18 r17 model-check off", old: 'if (process.argv.includes("--model-check")) {\n', neu: "if (__r18.r17ModelCheck === true) { // r18：r17 自身的 --model-check 不執行\n" },
  { id: "r18 r17 emit-diff off", old: 'if (process.argv.includes("--emit-diff")) {\n  const CAP = Symbol("r17-capture");', neu: 'if (__r18.r17EmitDiff === true) { // r18：r17 自身的 --emit-diff 不執行（改由 r18 產生 scratchpad/r18.diff）\n  const CAP = Symbol("r17-capture");' },
  { id: "r18 emit capture r16", old: '  r17Body = r17Apply(r16Src, R17_R16_PATCHES, "r16");\n', neu: '  r17Body = r17Apply(r16Src, R17_R16_PATCHES, "r16");\n  if (__r18.onR17Body) __r18.onR17Body(r17Body); // r18：--emit-diff 擷取實際執行的 r16\n' },
  { id: "r18 run extra", old: '(makeR17({}));\n', neu: "(makeR17(__r18.r17Extra ?? {})); // r18\n" },
];
const R18_R17_PATCHES = [
  ...R18_R17_INFRA,
  // r18-V：子程序、白名單、摘要
  {
    id: "r18-V child script",
    old: 'neu: "phase2-r17.mjs`; // r17：子程序執行 r17（＝r16＋R17 patch）；原 r16：子程序執行 r16" },',
    neu: 'neu: "phase2-r18.mjs`; // r18：子程序執行 r18（＝r17＋R18 patch）；r17：子程序執行 r17（＝r16＋R17 patch）；原 r16：子程序執行 r16" },',
  },
  {
    id: "r18-V whitelist",
    old: String.raw`'r1[0-7])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination-r2.mjs\\" && f !== \\"scripts/verify-more-places-cross-destination-r3.mjs\\" /* r16-V`,
    neu: String.raw`'r1[0-8])/.test(f) && f !== \\"scripts/verify-more-places-cross-destination-r2.mjs\\" && f !== \\"scripts/verify-more-places-cross-destination-r3.mjs\\" && f !== \\"scripts/verify-more-places-cross-destination-r4.mjs\\" && f !== \\"scripts/verify-more-places-destination-switch-mp25.mjs\\" /* r18-V：r1[0-8]＋more-places-r4＋mp25 */ /* r16-V`,
  },
  { id: "r18-V summary", old: "neu: 'verify-destination-authority-phase2-r17: work P1=", neu: "neu: 'verify-destination-authority-phase2-r18: work P1=" },
  { id: "r18-V summary fields", old: 'neu: "${__r15.r16.summaryFields()} ${__r15.r16.r17.summaryFields()} → " },', neu: 'neu: "${__r15.r16.summaryFields()} ${__r15.r16.r17.summaryFields()} ${__r15.r16.r17.r18.summaryFields()} → " },' },
];

function r18Apply(src, patches, what) {
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

// ════════════════════════ 執行 ════════════════════════
const r17Text = readFileSync(R17_FILE, "utf8");
const r17Want = existsSync(R17_SHA_FILE) ? readFileSync(R17_SHA_FILE, "utf8").split("\n").find((l) => l.endsWith("  scripts/verify-destination-authority-phase2-r17.mjs"))?.slice(0, 64) : null;
if (!r17Want || sha256(r17Text) !== r17Want) {
  console.log(`INFRA-FAIL r17 sha256=${sha256(r17Text)} ≠ ${r17Want ?? "(缺 scratchpad/pre-MP3T-test-sha.txt)"}（r17 被修改？r18 不執行）`);
  process.exit(1);
}
const shebang = r17Text.match(/^#!.*\n/);
if (!shebang) {
  console.log("INFRA-FAIL r17 缺少 shebang");
  process.exit(1);
}
const r17Src = r17Text.slice(shebang[0].length);
let r18Body;
try {
  r18Body = r18Apply(r17Src, R18_R17_PATCHES, "r17");
} catch (e) {
  console.log(`INFRA-FAIL r18 patch：${e?.message ?? e}`);
  process.exit(1);
}
if (/^\s*import\s/m.test(r18Body) || /^\s*imp: \(s\) => import\(s\)/m.test(r18Body)) {
  console.log("INFRA-FAIL r18：patched r17 仍有 import 陳述式／import()");
  process.exit(1);
}
const AsyncFunction = (async () => {}).constructor;
const makeR18 = (extra) => ({
  imp: (s) => import(s),
  r13Patches: R18_R13_PATCHES,
  r14Patches: R18_R14_PATCHES,
  r15Patches: R18_R15_PATCHES,
  noteExtract: r18NoteExtract,
  necessary: r18Necessary,
  report: r18Report,
  summaryFields: r18SummaryFields,
  r17EmitDiff: false,
  r17ModelCheck: false,
  r17Extra: null,
  onR17Body: null,
  ...extra,
});

if (process.argv.includes("--emit-diff")) {
  const CAP = Symbol("r18-capture");
  const runCapture = async (body, extra) => {
    let got = null;
    let r17Body = null;
    let r16Body = null;
    const r18 = makeR18({
      ...extra,
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
    });
    try {
      await new AsyncFunction("__r18", `"use strict";\n${body}`)(r18);
    } catch (e) {
      if (e !== CAP) throw e;
    }
    if (!got || !r17Body || !r16Body) throw new Error("emit capture 未取得執行內容");
    return { ...got, r17Body, r16Body };
  };
  const baseBody = r18Apply(r17Src, R18_R17_INFRA, "r17(基準)");
  const base = await runCapture(baseBody, { r13Patches: [], r14Patches: [], r15Patches: [] });
  const mine = await runCapture(r18Body, {});
  const files = {
    r17: R17_FILE,
    r18r17: `${PRE_DIR}/r18.patched-r17.mjs`,
    baseR16: `${PRE_DIR}/r18base.r17-patched-r16.mjs`,
    r18R16: `${PRE_DIR}/r18.patched-r16.mjs`,
    baseR15: `${PRE_DIR}/r18base.r17-patched-r15.mjs`,
    r18R15: `${PRE_DIR}/r18.patched-r15.mjs`,
    baseR14: `${PRE_DIR}/r18base.r17-patched-r14.mjs`,
    r18R14: `${PRE_DIR}/r18.patched-r14.mjs`,
    baseExec: `${PRE_DIR}/r18base.r17-exec.mjs`,
    r18Exec: `${PRE_DIR}/r18.r18-exec.mjs`,
  };
  writeFileSync(files.r18r17, `${shebang[0]}${r18Body}`);
  writeFileSync(files.baseR16, base.r17Body);
  writeFileSync(files.r18R16, mine.r17Body);
  writeFileSync(files.baseR15, base.r16Body);
  writeFileSync(files.r18R15, mine.r16Body);
  writeFileSync(files.baseR14, base.patchedR14);
  writeFileSync(files.r18R14, mine.patchedR14);
  writeFileSync(files.baseExec, base.r15Exec);
  writeFileSync(files.r18Exec, mine.r15Exec);
  const same = (a, b) => (existsSync(b) ? (readFileSync(b, "utf8") === a ? "相同" : "不同") : "（缺檔）");
  const diffText = (a, b, la, lb) => {
    try {
      return execFileSync("diff", ["-u", "--label", la, "--label", lb, a, b], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      return String(e.stdout ?? "");
    }
  };
  const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail("];
  const TAGS = ["r18-P", "r18-H", "r18-N", "r18-G", "r18-I", "r18-O", "r18 report", "r18-V", "r18：", "phase2-r18", "__r18", "// r18"];
  const TAG_LABEL = { "r18 report": "r18-P／N 報告輸出（只新增輸出）", "r18：": "r18-V（執行需要／掛載點）", "phase2-r18": "r18-V（版本識別）", __r18: "r18-V（執行需要）", "// r18": "r18-V（執行需要）" };
  const stats = (d) => {
    const lines = d.split("\n");
    const del = lines.filter((l) => l.startsWith("-") && !l.startsWith("---"));
    const add = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const hit = del.filter((l) => KEYS.some((k) => l.includes(k)));
    const by = {};
    for (const l of hit) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
    // 逐 hunk 歸類：以 hunk 新增行中的 r18 標籤分類（無標籤 → 「未標記」需人工核對）
    const hunks = [];
    let cur = null;
    for (const l of lines) {
      if (l.startsWith("@@")) {
        cur = { head: l, add: [], del: [] };
        hunks.push(cur);
      } else if (cur && l.startsWith("+") && !l.startsWith("+++")) cur.add.push(l);
      else if (cur && l.startsWith("-") && !l.startsWith("---")) cur.del.push(l);
    }
    const cls = hunks.map((h) => {
      const tag = TAGS.find((t) => h.add.some((l) => l.includes(t)));
      return `${h.head} → ${tag ? (TAG_LABEL[tag] ?? tag) : "未標記（需人工核對）"}（-${h.del.length} +${h.add.length}）`;
    });
    return { deleted: del.length, added: add.length, hit, by, hunks: hunks.length, cls };
  };
  const d0 = diffText(files.r17, files.r18r17, "scripts/verify-destination-authority-phase2-r17.mjs", "r18 實際執行的 r17（r17＋R18_R17_PATCHES）");
  const d1 = diffText(files.baseR16, files.r18R16, "r17 實際執行的 r16（r16＋R17_R16_PATCHES）", "r18 實際執行的 r16（R17_R16_PATCHES 字串經 r18-V 改寫）");
  const d2 = diffText(files.baseR15, files.r18R15, "r17 實際執行的 r15", "r18 實際執行的 r15（再加 R18_R15_PATCHES）");
  const d3 = diffText(files.baseR14, files.r18R14, "r17 實際執行的 r14", "r18 實際執行的 r14（再加 R18_R14_PATCHES）");
  const d4 = diffText(files.baseExec, files.r18Exec, "r17 實際執行內容（r13＋R14～R17_R13_PATCHES）", "r18 實際執行內容（再加 R18_R13_PATCHES）");
  const s = [d0, d1, d2, d3, d4].map(stats);
  const ids = (a) => a.map((p) => p.id).join("｜");
  const head = [
    "# r18.diff（A2-MP-T3）",
    `# r17 sha256=${r17Want}（已驗證，scratchpad/pre-MP3T-test-sha.txt）；r16／r15／r14／r13 由 r17／r16／r15／r14 驗證 sha`,
    `# 基準一致性：r18 基準 r14 vs scratchpad/r17.patched-r14.mjs＝${same(base.patchedR14, `${PRE_DIR}/r17.patched-r14.mjs`)}；r18 基準執行內容 vs scratchpad/r17.r17-exec.mjs＝${same(base.r15Exec, `${PRE_DIR}/r17.r17-exec.mjs`)}；r18 基準 r15 vs scratchpad/r17.patched-r15.mjs＝${same(base.r16Body, `${PRE_DIR}/r17.patched-r15.mjs`)}`,
    `# 第 0 部分：r17 原文 → r18 實際執行的 r17（R18_R17_PATCHES ${R18_R17_PATCHES.length} 個）：${ids(R18_R17_PATCHES)}`,
    `# 第 1 部分：r16 層（R17_R16_PATCHES 字串經 r18-V 改寫）`,
    `# 第 2 部分：r15 層（R18_R15_PATCHES ${R18_R15_PATCHES.length} 個）：${ids(R18_R15_PATCHES)}`,
    `# 第 3 部分：r14 層（R18_R14_PATCHES ${R18_R14_PATCHES.length} 個）：${ids(R18_R14_PATCHES)}`,
    `# 第 4 部分：r13 執行內容（R18_R13_PATCHES ${R18_R13_PATCHES.length} 個）：${ids(R18_R13_PATCHES)}`,
    ...s.map((x, i) => `#   第${i}部分 hunk=${x.hunks} 刪除行=${x.deleted} 新增行=${x.added}；刪除行含 ${KEYS.join("／")} = ${x.hit.length} ${JSON.stringify(x.by)}`),
    ...s.flatMap((x, i) => x.hit.map((l) => `#   [第${i}部分 刪除行命中] ${l}`)),
    "# 逐 hunk 歸類：",
    ...s.flatMap((x, i) => x.cls.map((c) => `#   [第${i}部分] ${c}`)),
    "",
  ];
  writeFileSync(`${PRE_DIR}/r18.diff`, `${head.join("\n")}\n######## 第 0 部分 ########\n${d0}\n######## 第 1 部分 ########\n${d1}\n######## 第 2 部分 ########\n${d2}\n######## 第 3 部分 ########\n${d3}\n######## 第 4 部分 ########\n${d4}`);
  console.log(`wrote ${PRE_DIR}/r18.diff`);
  console.log(head.join("\n"));
  process.exit(0);
}

await new AsyncFunction("__r18", `"use strict";\n${r18Body}`)(makeR18({}));
