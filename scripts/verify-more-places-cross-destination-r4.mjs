#!/usr/bin/env node
/**
 * verify-more-places-cross-destination-r4（A2-MP-T3，tester）：more_places r3 的新版副本（r2／r3／初版保留不改）。
 *
 * 機制：同 r3，不自建 Harness，改經 r18 執行（r18 → r17 → … → r13；r18-P 把兩條過時模擬路徑換成擷取的正式原始碼）。
 * 情境：r3 全部情境（import r3 scenarios，逐字沿用；r3 再 import r2 → 初版）＋ 本檔新增 PATH-*（只增不減）。
 * 判定：
 *   (1) r3 全部情境：直接呼叫 r3 report()（同一組斷言，逐字沿用；r3 再呼叫 r2／初版 report）。輸出原樣保留。
 *   (2) r4 只做兩件事（使用者裁決 2／3）：
 *       a. MP-24：r2 成本對照中的「T3 卡片與 a2 相同」被裁決為 CONTRACT-CONFLICT（a2 本身顯示京都卡＝已知錯誤）→ SUPERSEDED-IN-r4，
 *          以「地理範圍一致性」取代：T2／T3 的卡片、Places 搜尋、recommendationSession、Credits metadata、travelContext、
 *          activeRecommendationContext 皆屬已確認目的地金澤、不得出現京都；Credits 結算規則同 r3。r2 的其餘成本對照（geocode／Places
 *          次數不高於 a2、a2 舊池未搜尋時 work 不得重新搜尋）逐字保留。r2 原斷言仍原樣執行並輸出（不刪除）。
 *       b. MODEL-PATH：r3 以 path 標記把 refinement:MORE_RECOMMENDATIONS／fb_continue 判為「只存在於模型」。r18 已改為正式碼；
 *          若 r3 判 UNVERIFIED 且每個 MODEL-PATH 輪都有 r18 正式碼標記（|r18:refineMore(real)／|r18:fbContinue(real)），改回 r3 的原判定（PASS）。
 *   (3) PATH-*（新增）：讓兩條路徑在 work 上實際被執行；過期 activeRecommendationContext 不得決定本輪目的地（六欄不得出現過期 Context 城市）。
 *   (4) 與 scratchpad/mp-cross-r3.log 的逐案總表比較：只允許被裁決的條目變化，其餘變化一律列出（REGRESSION?）。
 *
 * 執行：node scripts/verify-more-places-cross-destination-r4.mjs [--conc=N]
 *       （＝ node scripts/verify-destination-authority-phase2-r18.mjs --brief --f10 --pa2 --a2 --mp1 --only=<ids>
 *          --extra-scenarios=scripts/verify-more-places-cross-destination-r4.mjs --out=<scratchpad>/mp-cross-r4.log）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { scenarios as R3_SCENARIOS, report as r3Report } from "./verify-more-places-cross-destination-r3.mjs";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R18 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r18.mjs`;
const R3_LOG = `${PRE_DIR}/mp-cross-r3.log`;

// r2／r3／初版必須與 A2-MP-T3 開始前快照相同（sha256；scratchpad/pre-MP3T-test-sha.txt）
const SNAP = `${PRE_DIR}/pre-MP3T-test-sha.txt`;
const SHA_FAIL = [];
{
  const want = new Map();
  if (existsSync(SNAP)) for (const l of readFileSync(SNAP, "utf8").split("\n")) if (/^[0-9a-f]{64}  /.test(l)) want.set(l.slice(66), l.slice(0, 64));
  for (const f of ["verify-more-places-cross-destination.mjs", "verify-more-places-cross-destination-r2.mjs", "verify-more-places-cross-destination-r3.mjs"]) {
    const rel = `scripts/${f}`;
    const got = createHash("sha256").update(readFileSync(`${WORK_ROOT}/${rel}`)).digest("hex");
    if (want.get(rel) !== got) SHA_FAIL.push(`${rel} sha256=${got} ≠ 快照 ${want.get(rel) ?? "(無)"}`);
  }
}

const OK = { id: "ok", geo: "ok", search: "ok" };
const TIMEOUT = { id: "timeout", geo: "timeout", search: "ok" };

/** PATH-*：讓 r18-P 的兩條正式路徑在 work 上被執行。kind=path：block＝預期進入的 r18 區塊；forbid＝過期 Context 的城市（不得決定目的地）。 */
const NEW_SCENARIOS = [
  // refinement 區塊 MORE（work L10191-10217）：rec＝金澤（無 travelContext 目的地 → refetch 不接）＋過期 Context＝京都
  { id: "PATH-01-refine-more-stale", no: "P1", label: "（路徑）Session：rec=金澤（6 筆、已展示 3；無 travelContext 目的地）＋Context=京都（過期）→ 再推薦幾個", turns: ["再推薦幾個"], r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 } }, r17Arc: { destination: "京都", intent: "restaurant" }, r15Modes: [OK], path: { block: "r18RefineMore", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-01b-refine-more-stale-haiyouma", no: "P1b", label: "（路徑）同上 → 還有嗎", turns: ["還有嗎"], r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 } }, r17Arc: { destination: "京都", intent: "restaurant" }, r15Modes: [OK], path: { block: "r18RefineMore", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-01c-refine-more-fresh", no: "P1c", label: "（路徑對照）Session：rec=金澤（無 travelContext 目的地）＋Context=金澤（未過期）→ 再推薦幾個", turns: ["再推薦幾個"], r15Init: { topic: "restaurant", rec: { destination: "金澤", n: 6, batch: 3 } }, r17Arc: { destination: "金澤", intent: "restaurant" }, r15Modes: [OK], path: { block: "r18RefineMore", turn: 0, to: "金澤", forbid: "京都" } },
  // applyLocalFallback continue（work L6795-6857）：destination_places 失敗 → fallback；Session 只有 Context（無 rec／無已推薦 → refetch 不接）
  { id: "PATH-02-fb-continue-stale", no: "P2", label: "（路徑）Session：Context=京都（過期）＋travelContext=金澤（無 rec）→ 還有哪些必去的地方（金澤 Places 回空 → destination_places 失敗 → fallback）", turns: ["還有哪些必去的地方"], r18Init: { arc: { destination: "京都", intent: "attraction" }, travelDestination: "金澤" }, r15EmptyDest: ["金澤"], r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02b-fb-continue-stale-timeout", no: "P2b", label: "（路徑）同上（Provider timeout → destination_places 失敗 → fallback）", turns: ["還有哪些必去的地方"], r18Init: { arc: { destination: "京都", intent: "attraction" }, travelDestination: "金澤" }, r15Modes: [TIMEOUT], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02c-fb-continue-named-stale", no: "P2c", label: "（路徑）Session：Context=京都（過期）＋travelContext=金澤 → 金澤還有哪些必去的地方（金澤 Places 回空）", turns: ["金澤還有哪些必去的地方"], r18Init: { arc: { destination: "京都", intent: "attraction" }, travelDestination: "金澤" }, r15EmptyDest: ["金澤"], r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02e-fb-continue-fault-fresh", no: "P2e", label: "（路徑；faithful＋L10471 後例外 → state_machine_error fallback）Session：Context=金澤＋travelContext=金澤 → 換金澤，再推薦幾個", faithful: true, turns: [{ text: "換金澤，再推薦幾個", fault: "throwAfterPersist" }], r18Init: { arc: { destination: "金澤", intent: "attraction" }, travelDestination: "金澤" }, r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02f-fb-continue-fault-stale", no: "P2f", label: "（路徑；faithful＋L10471 後例外）Session：Context=京都（過期；無其他目的地）→ 換金澤，再推薦幾個（金澤 Places 回空）", faithful: true, turns: [{ text: "換金澤，再推薦幾個", fault: "throwAfterPersist" }], r18Init: { arc: { destination: "京都", intent: "attraction" } }, r15EmptyDest: ["金澤"], r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02g-fb-continue-timeout-fault", no: "P2g", label: "（路徑；faithful＋streamChat AbortError → ai_timeout fallback）Session：Context=金澤＋travelContext=金澤 → 換金澤，再推薦幾個", faithful: true, turns: [{ text: "換金澤，再推薦幾個", fault: "streamTimeout" }], r18Init: { arc: { destination: "金澤", intent: "attraction" }, travelDestination: "金澤" }, r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "金澤", forbid: "京都" } },
  { id: "PATH-02d-fb-continue-fresh", no: "P2d", label: "（路徑對照）Session：Context=京都＋travelContext=京都 → 還有哪些必去的地方（京都 Places 回空）", turns: ["還有哪些必去的地方"], r18Init: { arc: { destination: "京都", intent: "attraction" }, travelDestination: "京都" }, r15EmptyDest: ["京都"], r15Modes: [OK], path: { block: "r18FbContinue", turn: 0, to: "京都", forbid: null } },
];

export const scenarios = [...R3_SCENARIOS, ...NEW_SCENARIOS];

// ════════════════ 共用（與 r3 相同的六欄定義；只讀 obs）════════════════
const PLACE_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中", "里斯本"];
const K = (v) => {
  if (v == null || v === "") return null;
  const k = PLACE_KEYS.find((x) => String(v).includes(x)) ?? "?";
  return k === "金沢" ? "金澤" : k;
};
const cardDest = (c) => K(`${c?.name ?? ""}|${c?.id ?? ""}`);
const uniq = (a) => [...new Set(a)];
const turnOf = (turns, i) => turns.find((x) => x.turnIndex === i);
const sixCols = (t) => ({
  credits: (t.r15Credits ?? []).map((c) => c.destination),
  cards: uniq((t.r15Cards ?? []).map(cardDest)),
  places: uniq((t.placesQueries ?? []).map((x) => String(x).split("@").at(-1))),
  rec: t.r15Rec?.destination ?? null,
  arc: t.r17Arc?.destinationName ?? null,
  tc: t.sessionDest ?? null,
});
const fmt = (c) => `Credits=[${c.credits.join(",") || "-"}] 卡片=[${c.cards.join(",") || "-"}] Places=[${c.places.join(",") || "-"}] rec=${c.rec ?? "-"} Context=${c.arc ?? "-"} travelContext=${c.tc ?? "-"}`;
function creditsCheck(t) {
  const fails = [];
  const cards = t.r15Cards ?? [];
  const credits = t.r15Credits ?? [];
  const settle = t.creditsSettle ?? [];
  const rpc = t.creditsRpc ?? [];
  if (settle.length !== credits.length) fails.push(`Credits begin=${credits.length} settle=${settle.length}`);
  if (settle.filter((x) => x === true).length !== (cards.length ? 1 : 0)) fails.push(`Credits 成功結算=${settle.filter((x) => x === true).length}（卡片=${cards.length}）`);
  const reserves = rpc.filter((x) => x === "credits_reserve").length;
  if (reserves !== rpc.filter((x) => x === "credits_commit" || x === "credits_rollback").length) fails.push(`reserve=${reserves} 與 commit＋rollback 不一致（${rpc.join(",")}）`);
  if (rpc.filter((x) => x === "credits_commit").length !== (cards.length ? 1 : 0)) fails.push(`credits_commit=${rpc.filter((x) => x === "credits_commit").length}（卡片=${cards.length}）`);
  return fails;
}
/** MP-24 新契約：地理範圍一致性（本輪已確認目的地 to；不得出現 forbid）。 */
function geoScope(t, to, forbid) {
  const f = [];
  const c = sixCols(t);
  if (!(t.r15Cards ?? []).length) f.push("沒有顯示任何卡片");
  if (c.cards.some((d) => d !== to)) f.push(`卡片目的地=${c.cards.join(",")} ≠ ${to}`);
  if (c.places.some((d) => K(d) !== to)) f.push(`Places 搜尋目的地=${c.places.join(",")} ≠ ${to}`);
  if (K(c.rec) !== to) f.push(`recommendationSession.destination=${c.rec ?? "-"} ≠ ${to}`);
  if (!c.credits.length || c.credits.some((d) => K(d) !== to)) f.push(`Credits metadata.destination=[${c.credits.join(",") || "-"}] ≠ ${to}`);
  if (K(c.tc) !== to) f.push(`travelContext.destination=${c.tc ?? "-"} ≠ ${to}`);
  if (c.arc != null && K(c.arc) !== to) f.push(`activeRecommendationContext.destinationName=${c.arc} ≠ ${to}`);
  const all = [...c.credits, ...c.cards, ...c.places, c.rec, c.arc, c.tc].filter(Boolean);
  if (all.some((d) => K(d) === forbid)) f.push(`六欄出現「${forbid}」`);
  f.push(...creditsCheck(t));
  return { f, c };
}
const R18_REAL_RE = /\|r18:(refineMore|fbContinue)\(real\)/;

/** r3 逐案總表（「── more_places r3：逐案總表」之後、「more_places r3（work」之前）。 */
function parseR3Rows(lines) {
  const m = new Map();
  let on = false;
  for (const l of lines) {
    if (l.startsWith("── more_places r3：逐案總表")) {
      on = true;
      continue;
    }
    if (on && l.startsWith("more_places r3（work")) break;
    if (!on) continue;
    const x = l.match(/^ {2}(\S+?\[\w+\]) work=(\S+?)(?:（|\s|$)/);
    if (x) m.set(x[1], { v: x[2], line: l.trim() });
  }
  return m;
}

// ════════════════ report ════════════════
export function report({ results, TREES, out }) {
  const o0 = out.length;
  const r3 = r3Report({ results, TREES, out });
  const mine = out.slice(o0).flatMap((x) => String(x).split("\n")); // out 元素可能以換行開頭／含多行
  const now = parseR3Rows(mine);
  out.push("\n══════════════ more_places r4（A2-MP-T3；r18 掛載；r3 判定原樣保留於上方）══════════════");
  if (SHA_FAIL.length) out.push("  INFRA-FAIL：r2／r3／初版與 A2-MP-T3 前快照不同", ...SHA_FAIL.map((x) => `    ${x}`));
  const changes = new Map(); // key → { from, to, why }

  // (2a) MP-24：CONTRACT-CONFLICT（SUPERSEDED-IN-r4）＋地理範圍一致性
  {
    const key = "MP-24-kanazawa-then-more[ok]";
    out.push(`\n[r4][MP-24-kanazawa-then-more][ok] 京都推薦景點 → 換金澤，再推薦幾個 → 再推薦幾個`);
    out.push("  舊契約（r2 成本對照）：「T3 卡片與 a2 相同」→ CONTRACT-CONFLICT（SUPERSEDED-IN-r4；使用者裁決 3：a2 T3 顯示京都卡＝已知錯誤）。r2 原斷言仍原樣執行，結果見上方 r2 段落。");
    out.push("  新契約：T2／T3 卡片、Places 搜尋、recommendationSession、Credits metadata、travelContext、activeRecommendationContext 皆＝金澤，不得出現京都；Credits 結算同 r3；r2 其餘成本對照逐字保留。");
    const sec = (() => {
      const i = mine.findIndex((l) => l.startsWith("[MP-24-kanazawa-then-more][ok] 案例 24"));
      if (i < 0) return [];
      const j = mine.findIndex((l, k) => k > i && /^\n?\[/.test(l) && !l.startsWith("[MP-24"));
      return mine.slice(i, j < 0 ? undefined : j);
    })();
    const r2WorkLine = sec.find((l) => l.startsWith("        判定（work）：")) ?? null;
    const r2CoreExtraPass = Boolean(r2WorkLine && / → PASS$/.test(r2WorkLine));
    const perTree = {};
    for (const tree of ["work", "mp1", "a2", "pa2", "base"].filter((t) => TREES.includes(t))) {
      const r = results[`${tree}|ok|MP-24-kanazawa-then-more`];
      if (!r) continue;
      if (r.err || r.result?.error) {
        perTree[tree] = { infra: true };
        out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
        continue;
      }
      const turns = r.result.turns ?? [];
      const fails = [];
      for (const ti of [1, 2]) {
        const t = turnOf(turns, ti);
        if (!t) {
          fails.push(`T${ti + 1} 缺失`);
          continue;
        }
        const g = geoScope(t, "金澤", "京都");
        fails.push(...g.f.map((x) => `T${ti + 1}:${x}`));
        out.push(`  ${tree.padEnd(5)} T${ti + 1}「${t.text}」 ${fmt(g.c)}${g.f.length ? ` ← ${g.f.join("；")}` : ""}`);
      }
      perTree[tree] = { turns, fails };
    }
    // r2 其餘成本對照（逐字保留；只移除「卡片與 a2 不同」一項）
    const kept = [];
    if (perTree.work?.turns && perTree.a2?.turns) {
      const W = perTree.work.turns;
      const A = perTree.a2.turns;
      const sumG = (turns) => turns.reduce((a, t) => a + (t.geocodes?.length ?? 0), 0);
      if (sumG(W) > sumG(A)) kept.push(`情境總 geocode work=${sumG(W)} > a2=${sumG(A)}`);
      for (const ti of [2]) {
        const w = turnOf(W, ti);
        const a = turnOf(A, ti);
        if (!w || !a) continue;
        if ((w.geocodes?.length ?? 0) > (a.geocodes?.length ?? 0)) kept.push(`T${ti + 1} geocode work=${w.geocodes.length} > a2=${a.geocodes.length}（${w.geocodes.join(",")}）`);
        if ((w.placesRequests ?? 0) > (a.placesRequests ?? 0)) kept.push(`T${ti + 1} placesReq work=${w.placesRequests} > a2=${a.placesRequests}`);
        if ((a.r15Cards ?? []).length && !(a.placesRequests > 0) && w.placesRequests > 0) kept.push(`T${ti + 1} a2 以舊池續推（未搜尋），work 改為重新搜尋（續推退步）`);
      }
    } else kept.push("缺少 work 或 a2 結果（無法對照）");
    const r3Row = now.get(key);
    const sixOk = Boolean(r3Row && /六欄 work=PASS/.test(r3Row.line));
    const model = Boolean(r3Row && /MODEL-PATH=/.test(r3Row.line));
    const wf = perTree.work?.fails ?? ["work 無結果"];
    const v = perTree.work?.infra ? "INFRA" : r2CoreExtraPass && sixOk && !model && !kept.length && !wf.length ? "PASS" : "FAIL";
    out.push(`  r2 原檔斷言＋r2 追加（work）：${r2WorkLine ? r2WorkLine.trim() : "（找不到）"}`);
    out.push(`  r2 其餘成本對照（保留）：${kept.length ? `FAIL ← ${kept.join("；")}` : "PASS"}｜r3 六欄=${sixOk ? "PASS" : "FAIL"}｜MODEL-PATH=${model ? "有" : "無"}｜新契約（地理範圍一致性）work=${wf.length ? `FAIL ← ${wf.join("；")}` : "PASS"}`);
    for (const t of ["mp1", "a2", "pa2", "base"]) if (perTree[t] && !perTree[t].infra) out.push(`  新契約 ${t}=${perTree[t].fails.length ? "FAIL" : "PASS"}${perTree[t].fails.length ? `（${perTree[t].fails.slice(0, 4).join("；")}${perTree[t].fails.length > 4 ? "…" : ""}）` : ""}`);
    out.push(`  判定（work，r4）：${v}（r3＝${r3Row?.v ?? "-"}）`);
    if (r3Row && r3Row.v !== v) changes.set(key, { from: r3Row.v, to: v, why: "裁決 3：MP-24「T3 卡片與 a2 相同」CONTRACT-CONFLICT → 地理範圍一致性" });
  }

  // (2b) MODEL-PATH → r18 正式碼
  {
    const keyOfRow = (k) => k.match(/^(\S+)\[(\w+)\]$/);
    for (const [key, row] of now) {
      if (row.v !== "UNVERIFIED") continue;
      const m = keyOfRow(key);
      const s = scenarios.find((x) => x.id === m?.[1]);
      const r = results[`work|${m?.[2]}|${m?.[1]}`];
      const mts = (row.line.match(/MODEL-PATH=([T\d,]+)/)?.[1] ?? "").split(",").filter(Boolean).map((x) => Number(x.slice(1)) - 1);
      const turns = r?.result?.turns ?? [];
      const real = mts.length && mts.every((ti) => R18_REAL_RE.test(String(turnOf(turns, ti)?.path ?? "")));
      out.push(`  [r4 MODEL-PATH] ${key}：MODEL-PATH 輪=${mts.map((x) => `T${x + 1}`).join(",") || "-"} r18 正式碼標記=${real ? "全部有" : "缺"}${s ? "" : "（找不到情境）"}`);
      if (real) changes.set(key, { from: "UNVERIFIED", to: "PASS", why: "裁決 2：MODEL-PATH 輪已由 r18 以正式碼執行" });
    }
  }

  // (3) PATH-*
  const pathRows = [];
  for (const s of NEW_SCENARIOS) {
    for (const m of s.r15Modes) {
      const p = s.path;
      out.push(`\n[r4][${s.id}][${m.id}] ${s.no}：${s.label}`);
      const per = {};
      for (const tree of ["work", "mp1", "a2"].filter((t) => TREES.includes(t))) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        if (r.err || r.result?.error) {
          per[tree] = "INFRA";
          out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 200)}`);
          continue;
        }
        const t = turnOf(r.result.turns ?? [], p.turn);
        if (!t) {
          per[tree] = "INFRA";
          out.push(`  ${tree.padEnd(5)} T${p.turn + 1} 缺失`);
          continue;
        }
        const blk = (t.r18Blocks ?? []).filter((b) => b.name === p.block);
        const entered = blk.some((b) => b.ret !== "not_taken" || (b.calls ?? []).length);
        const c = sixCols(t);
        const f = [];
        const all = [...c.credits, ...c.cards, ...c.places, c.rec, c.arc, c.tc].filter(Boolean);
        if (p.forbid && [...c.credits, ...c.cards, ...c.places].some((d) => K(d) === p.forbid)) f.push(`過期 Context「${p.forbid}」決定了本輪目的地（Credits／卡片／Places）`);
        if (p.forbid && (K(c.rec) === p.forbid || K(c.tc) === p.forbid)) f.push(`rec／travelContext 被改寫為「${p.forbid}」`);
        if ((t.r15Cards ?? []).length && c.cards.some((d) => d !== p.to)) f.push(`卡片目的地=${c.cards.join(",")} ≠ ${p.to}`);
        f.push(...creditsCheck(t));
        void all;
        const v = !entered ? "PRECOND" : f.length ? "FAIL" : "PASS";
        per[tree] = v;
        out.push(`  ${tree.padEnd(5)} T${p.turn + 1}「${t.text}」 ${fmt(c)}`);
        out.push(`        path=${String(t.path ?? "").slice(0, 220)} ${p.block}=${JSON.stringify(blk)} isStale=${JSON.stringify(t.r17StaleCalls ?? null)} geocode=${t.geocodes?.length ?? 0}[${(t.geocodes ?? []).join(",")}] placesReq=${t.placesRequests ?? 0}`);
        out.push(`        → ${v}${!entered ? "（未走到該路徑＝未測到）" : ""}${f.length ? ` ← ${f.join("；")}` : ""}`);
      }
      pathRows.push(`${s.id}[${m.id}] work=${per.work ?? "-"} mp1=${per.mp1 ?? "-"} a2=${per.a2 ?? "-"}`);
    }
  }

  // (4) 與 r3 log 比較
  const before = existsSync(R3_LOG) ? parseR3Rows(readFileSync(R3_LOG, "utf8").split("\n")) : null;
  out.push("\n── more_places r4：逐案總表（work；r3 判定 → r4 判定）──");
  let pass = 0;
  let fail = 0;
  let other = 0;
  for (const [key, row] of now) {
    const ch = changes.get(key);
    const v = ch ? ch.to : row.v;
    if (v === "PASS") pass += 1;
    else if (v === "FAIL") fail += 1;
    else other += 1;
    out.push(`  ${key} r3=${row.v} r4=${v}${ch ? `（${ch.why}）` : ""}`);
  }
  out.push("── PATH-*（新增）──", ...pathRows.map((x) => `  ${x}`));
  out.push("\n── r4 vs scratchpad/mp-cross-r3.log（上一棒 r3 執行結果）──");
  const unexpected = [];
  if (!before) out.push("  （缺少 mp-cross-r3.log，無法比較）");
  else {
    for (const [key, row] of now) {
      const b = before.get(key);
      const ch = changes.get(key);
      const v = ch ? ch.to : row.v;
      if (!b) {
        out.push(`  [新] ${key} r4=${v}`);
        continue;
      }
      if (b.v !== row.v) unexpected.push(`${key}：r3 log=${b.v} → 本次 r3 判定=${row.v}（Harness 變更造成？）`);
      if (b.v !== v) out.push(`  [變化] ${key}：r3 log=${b.v} → r4=${v}${ch ? `（${ch.why}）` : "（未經裁決 → REGRESSION?）"}`);
    }
    for (const key of before.keys()) if (!now.has(key)) unexpected.push(`${key}：r3 log 有、本次沒有`);
    out.push(`  本次 r3 判定與 r3 log 不同（非裁決造成）=${unexpected.length}`, ...unexpected.map((x) => `    ${x}`));
  }
  const pathFail = pathRows.filter((x) => / work=(FAIL|INFRA)/.test(x)).length;
  out.push(`more_places r4（work，r3 情境 ${now.size} 列）：PASS=${pass} FAIL=${fail} 其他=${other}；裁決變更=${changes.size}；非裁決變化=${unexpected.length}；PATH work FAIL/INFRA=${pathFail}／PRECOND=${pathRows.filter((x) => / work=PRECOND/.test(x)).length}；sha 前提=${SHA_FAIL.length ? "FAIL" : "OK"}；r3 report fail 計數=${r3.fail}`);
  return { fail: fail + pathFail + unexpected.length + SHA_FAIL.length, pass };
}

// ── --emit-diff：scratchpad/mp-r4.diff（相對 r3；r3 以 import 原樣執行，不是被改寫）──
if (process.argv[1] && resolve(process.argv[1]) === SELF && process.argv.includes("--emit-diff")) {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync } = await import("node:fs");
  const R3F = `${WORK_ROOT}/scripts/verify-more-places-cross-destination-r3.mjs`;
  let d = "";
  try {
    d = execFileSync("diff", ["-u", "--label", "scripts/verify-more-places-cross-destination-r3.mjs", "--label", "scripts/verify-more-places-cross-destination-r4.mjs", R3F, SELF], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    d = String(e.stdout ?? "");
  }
  const KEYS = ["p1.push", "notes.push", "costNotes", "diffExpected", "expect:", "MODES", "ux.push", "fail("];
  const del = d.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const by = {};
  for (const l of del) for (const k of KEYS) if (l.includes(k)) by[k] = (by[k] ?? 0) + 1;
  const head = [
    "# mp-r4.diff（A2-MP-T3）：scripts/verify-more-places-cross-destination-r4.mjs 相對 r3",
    `# r2／r3／初版 sha256 前提：${SHA_FAIL.length ? `FAIL（${SHA_FAIL.join("；")}）` : "OK（與 scratchpad/pre-MP3T-test-sha.txt 相同）"}`,
    "# 注意：r4 以 import 執行 r3 的 scenarios 與 report()（r3 再 import r2 → 初版），r3 的全部情境與斷言原樣執行、輸出原樣保留；",
    "#       下方 diff 的「-」行是 r3 檔案中未被複製到 r4 的原始碼文字（仍經 import 執行），不是被刪除的斷言。",
    "# r4 對判定的變更（只有兩類，皆以「新增輸出＋r4 判定」呈現，不改 r3 判定字串）：",
    "#   (1) MP-24：r2 成本對照「T3 卡片與 a2 相同」→ CONTRACT-CONFLICT（SUPERSEDED-IN-r4），以地理範圍一致性取代；r2 其餘成本對照逐字保留。",
    "#   (2) MODEL-PATH：r3 UNVERIFIED 且每個 MODEL-PATH 輪皆有 r18 正式碼標記 → 回到 r3 原判定。",
    "#   新增情境 PATH-*（只增不減）。",
    `# 刪除行（相對 r3 文字）=${del.length}；其中含 ${KEYS.join("／")} = ${Object.values(by).reduce((a, b) => a + b, 0)} ${JSON.stringify(by)}（皆為 r3 原文，仍經 import 執行）`,
    "",
  ];
  writeFileSync(`${PRE_DIR}/mp-r4.diff`, `${head.join("\n")}\n${d}`);
  console.log(head.join("\n"));
  process.exit(0);
}

// ── 直接執行：以 r18 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length);
  const ids = only ? only.split(",") : scenarios.map((s) => s.id);
  const outName = only ? "mp-cross-r4-partial.log" : "mp-cross-r4.log";
  const args = [R18, "--brief", "--f10", "--pa2", "--a2", "--mp1", `--only=${ids.join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/${outName}`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
