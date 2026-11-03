#!/usr/bin/env node
/**
 * verify-more-places-cross-destination（A2-T6，tester）：more_places 跨目的地續推的獨立離線失敗案例。
 *
 * 機制：不自建 Harness，整套重用 r15（scripts/verify-destination-authority-phase2-r15.mjs）：
 *   - r15 → r14（sha c60827a3）→ r13（sha 8debfb44）的正式 Callback 擷取（AST 擷取 _app.chat.tsx 的 pushMorePlaceRecommendations
 *     等正式原始碼）、閉包依賴逐一實作（未知依賴 INFRA-FAIL）、Provider／Places／Credits 計數、Mock Key、外部網路攔截
 *     （fetch／http／https／net／tls／undici；任何外部請求 → FAIL）、r15-F Fixture 有效性分類 Mock。
 *   - 本檔只提供「情境」與「判定」：r15 以 --extra-scenarios=<本檔> 載入（r15-X 掛載點），情境照 r13 子程序的同一路徑執行，
 *     每輪多記錄 r15Rec（recommendationSession 的 destination／parentCity／area／searchScope／pool／cursor）、
 *     r15Cards（本輪畫面卡片）、r15Credits（本輪 Credits metadata）。
 *   - 不修改 r12–r14；不修改任何 src。
 *
 * 執行：node scripts/verify-more-places-cross-destination.mjs [--conc=N]
 *       （＝ node scripts/verify-destination-authority-phase2-r15.mjs --brief --f10 --pa2 --only=<MP ids>
 *          --extra-scenarios=scripts/verify-more-places-cross-destination.mjs --out=<scratchpad>/mp-cross.log）
 * 期望：地理範圍不一致時不得沿用舊推薦池、不得顯示舊目的地卡片、Credits／Session 必須跟著本輪已確認目的地；
 *       不得只比城市名稱（行政區範圍要保護）；同城同範圍續推（MP-03）應正常。目前正式碼預期 FAIL（失敗案例）。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R15 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r15.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const TIMEOUT = { id: "timeout", geo: "timeout", search: "ok" };
const NETERR = { id: "neterr", geo: "neterr", search: "ok" };

/** 情境 Fixture：台中北屯（同 REAL 表的形狀；只在本檔情境的子程序有效）。 */
const BEITUN = {
  台中北屯: { placeId: "mock-台中市北屯區", country: "台灣", city: "台中市", region: "台中市", district: "北屯區", lat: 24.18, lng: 120.7, formattedName: "台中市北屯區", displayLabel: "台中市北屯區" },
};

/** 情境 Fixture：京都東山（京都市東山區）。 */
const HIGASHIYAMA = {
  京都東山: { placeId: "mock-京都市東山區", country: "日本", city: "京都市", region: "京都市", district: "東山區", lat: 34.99, lng: 135.78, formattedName: "京都市東山區", displayLabel: "京都市東山區" },
};

/**
 * kind：cross＝換目的地（期望不沿用舊池、不顯示舊卡、Credits／Session 跟新目的地）；same＝同城同範圍（期望正常續推）；
 *       failclosed＝新目的地 Provider 失敗（期望不搜尋、不扣點、不顯示任何卡）；info＝只列資訊不判定。
 * from／to：卡片歸屬判定用的地名鍵（Mock 卡片名稱＝`${Places destinationName}地點N`、id 含 destinationName）。
 */
export const scenarios = [
  { id: "MP-01-kyoto-kanazawa", no: 1, label: "京都推薦景點 → 換金澤，再推薦幾個", turns: ["京都推薦景點", "換金澤，再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤" } },
  { id: "MP-02-kyoto-osaka", no: 2, label: "京都推薦景點 → 換大阪，再推薦幾個", turns: ["京都推薦景點", "換大阪，再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "大阪" } },
  { id: "MP-03-kyoto-same", no: 3, label: "（對照）京都推薦景點 → 再推薦幾個", turns: ["京都推薦景點", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 1, from: "京都", to: "京都" } },
  { id: "MP-04-xitun-hv", no: 4, label: "台中西屯美食 → 換香港跑馬地，再推薦幾個", turns: ["台中西屯美食", "換香港跑馬地，再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "跑馬地" } },
  { id: "MP-05-xitun-beitun", no: 5, label: "台中西屯美食 → 換台中北屯，再推薦幾個（同城市、不同行政區）", turns: ["台中西屯美食", "換台中北屯，再推薦幾個"], r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "北屯" } },
  { id: "MP-04b-xitun-hv-more", no: "4b", label: "台中西屯美食 → 香港跑馬地再推薦幾個（同案例 4，另一種說法）", turns: ["台中西屯美食", "香港跑馬地再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "跑馬地" } },
  { id: "MP-05c-xitun-beitun-more", no: "5c", label: "台中西屯美食 → 台中北屯再推薦幾個（同案例 5，另一種說法）", turns: ["台中西屯美食", "台中北屯再推薦幾個"], r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "北屯" } },
  { id: "MP-05d-xitun-beitun-haiyouma", no: "5d", label: "台中西屯美食 → 換到台中北屯還有嗎（同案例 5，另一種說法）", turns: ["台中西屯美食", "換到台中北屯還有嗎"], r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "北屯" } },
  {
    id: "MP-05e-restore-area-pool-city-scope",
    no: "5e",
    label: "（Session 恢復）recommendationSession=台中西屯（area：台中／西屯，6 筆、已展示 3）＋travelContext=台中 → 再推薦幾個（同城市名、範圍不同：不得只比城市名稱）",
    turns: ["再推薦幾個"],
    r15Init: { topic: "restaurant", rec: { destination: "台中西屯", parentCity: "台中", area: "西屯", n: 6, batch: 3 }, travelDestination: "台中" },
    r15Modes: [OK],
    // 資訊：send() L9653-9658 讓 recommendationSession.destination 優先於 travelContext.destination → 本輪確認目的地＝台中西屯（＝池範圍），不構成範圍不一致
    mp: { kind: "info", turn: 0, from: "西屯", to: "台中" },
  },
  {
    id: "MP-05g-kyoto-city-to-area",
    no: "5g",
    label: "京都推薦景點 → 換京都東山，再推薦幾個（同城市名、城市池 → 行政區範圍：不得只比城市名稱）",
    turns: ["京都推薦景點", "換京都東山，再推薦幾個"],
    r15Real: HIGASHIYAMA,
    r15Modes: [OK],
    mp: { kind: "cross", turn: 1, from: "京都", to: "東山" },
  },
  {
    id: "MP-05h-kyoto-city-to-area-more",
    no: "5h",
    label: "京都推薦景點 → 京都東山再推薦幾個（同 5g，另一種說法）",
    turns: ["京都推薦景點", "京都東山再推薦幾個"],
    r15Real: HIGASHIYAMA,
    r15Modes: [OK],
    mp: { kind: "cross", turn: 1, from: "京都", to: "東山" },
  },
  {
    id: "MP-05f-restore-area-pool-same-area",
    no: "5f",
    label: "（對照；Session 恢復）recommendationSession=台中西屯（area）＋travelContext=台中西屯 → 再推薦幾個（同城同範圍：應正常續推）",
    turns: ["再推薦幾個"],
    r15Init: { topic: "restaurant", rec: { destination: "台中西屯", parentCity: "台中", area: "西屯", n: 6, batch: 3 }, travelDestination: "台中西屯" },
    r15Modes: [OK],
    mp: { kind: "same", turn: 0, from: "西屯", to: "西屯" },
  },
  { id: "MP-05b-xitun-city", no: "5b", label: "（資訊）台中西屯美食 → 換台中，再推薦幾個（行政區 → 父城市；不判定）", turns: ["台中西屯美食", "換台中，再推薦幾個"], r15Modes: [OK], mp: { kind: "info", turn: 1, from: "西屯", to: "台中" } },
  { id: "MP-06-kanazawa-provider-fail", no: 6, label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider 驗證失敗：timeout／neterr；京都為 Authority 不需 geocode）", turns: ["京都推薦景點", "換金澤，再推薦幾個"], r15Modes: [TIMEOUT, NETERR], mp: { kind: "failclosed", turn: 1, from: "京都", to: "金澤" } },
  { id: "MP-07-undisplayed-pool", no: 7, label: "京都推薦景點（池內有未展示地點）→ 金澤再推薦幾個", turns: ["京都推薦景點", "金澤再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤", needUndisplayed: true } },
  { id: "MP-08-new-dest-empty", no: 8, label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Places 回空）", turns: ["京都推薦景點", "換金澤，再推薦幾個"], r15EmptyDest: ["金澤"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤", empty: true } },
  { id: "MP-09-credits-metadata", no: 9, label: "京都推薦景點 → 再推薦幾個 → 換金澤，再推薦幾個（Credits metadata）", turns: ["京都推薦景點", "再推薦幾個", "換金澤，再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 2, from: "京都", to: "金澤", alsoSame: 1 } },
  { id: "MP-10-reload-kanazawa", no: 10, label: "京都推薦景點 →（重新載入）→ 換金澤，再推薦幾個（Session 推薦池保存與恢復）", turns: ["京都推薦景點", "換金澤，再推薦幾個"], reloadAfter: 0, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤", reload: true } },
];

/** 地名鍵（越具體越前面）：「台中西屯」→西屯、「台中」→台中、「金澤東山」→東山、「金澤」→金澤。比較一律用鍵相等，不用子字串。 */
const PLACE_KEYS = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中"];
const keyOf = (v) => PLACE_KEYS.find((k) => String(v ?? "").includes(k)) ?? (v == null ? null : "?");
const cardDest = (c) => keyOf(`${c?.name ?? ""}|${c?.id ?? ""}`);
const uniq = (a) => [...new Set(a)];
const hasKey = (v, k) => keyOf(v) === k;

/** 本輪已確認目的地（work／pa2：驗證流程；base 沒有 A2 驗證流程 → 以本輪續推目的地代表）。 */
function confirmedOf(t, tree) {
  const flows = (t.r15Flows ?? []).filter((f) => !f.nested);
  const scope = flows.filter((f) => f.fn === "resolveTrustedRecommendationSearchScope");
  const lastScope = scope.at(-1);
  if (lastScope) return lastScope.status === "trusted" ? lastScope.destination : `未確認(${lastScope.reason ?? lastScope.status})`;
  const more = flows.filter((f) => f.fn === "resolveMorePlacesTurnDestination").at(-1);
  if (more) return more.status === "trusted" ? more.destination : "未確認(more_places)";
  return tree === "base" ? `（base 無驗證流程；cont=${t.continuationDest ?? "-"}）` : "-";
}
/** r15Init 的初始 recommendationSession 範圍（與 r15 r15BuildInit 同一組欄位；初始輪沒有「上一輪」obs）。 */
const initRecScope = (spec) => ({
  destination: spec.rec.destination,
  parentCity: spec.rec.parentCity ?? null,
  area: spec.rec.area ?? null,
  searchScope: spec.rec.area ? "area" : "city",
  topic: spec.topic ?? "restaurant",
  pool: spec.rec.n ?? 6,
  cursor: spec.rec.batch ?? 3,
  poolIds: Array.from({ length: spec.rec.n ?? 6 }, (_, j) => `old-${spec.rec.destination}-${j + 1}`),
});
const recStr = (r) => (r ? `${r.destination ?? "-"}｜parent=${r.parentCity ?? "-"}｜area=${r.area ?? "-"}｜scope=${r.searchScope ?? "-"}｜topic=${r.topic ?? "-"}｜pool=${r.pool}｜cursor=${r.cursor}` : "（無 recommendationSession）");

function judgeTurn(s, t, prev, tree) {
  const mp = s.mp;
  const cards = t.r15Cards ?? [];
  const dests = cards.map(cardDest);
  const prevPoolIds = new Set(prev?.r15Rec?.poolIds ?? []);
  const prevUndisplayed = new Set((prev?.r15Rec?.poolIds ?? []).slice(prev?.r15Rec?.cursor ?? 0));
  const searchDests = uniq((t.placesQueries ?? []).map((x) => String(x).split("@").at(-1)));
  const credits = t.r15Credits ?? [];
  const settle = t.creditsSettle ?? [];
  const rec = t.r15Rec;
  const fails = [];
  const notes = [];
  const ck = (cond, msg) => {
    if (!cond) fails.push(msg);
  };
  if (mp.kind === "same") {
    ck(cards.length > 0, "同城續推沒有顯示任何卡片");
    ck(dests.every((d) => d === mp.from), `同城續推卡片出現其他目的地：${uniq(dests).join(",")}`);
    ck(credits.every((c) => hasKey(c.destination, mp.from)), `Credits metadata.destination=${credits.map((c) => c.destination).join(",")}`);
    ck(hasKey(rec?.destination, mp.from), `Session recommendationSession.destination=${rec?.destination ?? "-"}`);
  } else if (mp.kind === "failclosed") {
    ck(!(t.placesRequests > 0), `Provider 驗證失敗仍搜尋 Places（${t.placesRequests} 次：${searchDests.join(",")}）`);
    ck(!credits.length, `Provider 驗證失敗仍開始 Credits（${credits.map((c) => `${c.path}:${c.destination}`).join(",")}）`);
    ck(!cards.length, `Provider 驗證失敗仍顯示卡片（${uniq(dests).join(",")}）`);
    ck(!hasKey(rec?.destination, mp.to), `Session recommendationSession.destination 寫入未確認「${rec?.destination}」`);
  } else if (mp.kind === "cross") {
    // 前置條件：上一輪必須真的留下舊目的地的推薦池，否則本案沒有測到「沿用舊池」（記為 PRECOND，不算 PASS）
    if (!prev?.r15Rec?.pool || !hasKey(prev.r15Rec.destination, mp.from)) fails.push(`PRECOND：上一輪沒有「${mp.from}」推薦池（${recStr(prev?.r15Rec)}）`);
    if (mp.needUndisplayed) ck((prev?.r15Rec?.pool ?? 0) > (prev?.r15Rec?.cursor ?? 0), `前置條件：舊推薦池沒有未展示地點（${recStr(prev?.r15Rec)}）`);
    const old = cards.filter((c) => cardDest(c) === mp.from);
    ck(!old.length, `顯示舊目的地「${mp.from}」卡片 ${old.length} 張：${old.map((c) => c.name).join("、")}`);
    const reused = cards.filter((c) => prevPoolIds.has(c.id));
    ck(!reused.length, `沿用舊推薦池（卡片 id ∈ 上一輪 recommendationSession.pool）${reused.length} 張${reused.some((c) => prevUndisplayed.has(c.id)) ? "（含舊池未展示地點）" : ""}`);
    ck(searchDests.every((d) => !hasKey(d, mp.from)), `Places 以舊目的地搜尋：${searchDests.join(",")}`);
    const cardSet = uniq(dests);
    for (const c of credits) {
      ck(!hasKey(c.destination, mp.from), `Credits metadata.destination=舊目的地「${c.destination}」`);
      if (cards.length) ck(cardSet.every((d) => hasKey(c.destination, d)), `Credits metadata.destination=${c.destination} 與畫面卡片所屬目的地（${cardSet.join(",")}）不一致`);
    }
    if (mp.empty) {
      ck(!cards.length || cards.every((c) => cardDest(c) === mp.to), "新目的地無結果時改顯示其他目的地卡片");
      ck(settle.every((x) => x === false), `新目的地無結果仍結算 Credits 成功（settle=${JSON.stringify(settle)}）`);
    }
    const confirmed = confirmedOf(t, tree);
    const failClosed = /^(未確認|-$)/.test(confirmed) && !cards.length && !credits.length && !(t.placesRequests > 0);
    if (failClosed) notes.push(`本輪 Fail Closed（${confirmed}）；Session travelContext.destination=${t.sessionDest ?? "-"}${hasKey(t.sessionDest, mp.to) ? "（寫入未確認的新目的地字串；非沿用舊池，另列）" : ""}`);
    if (rec && !failClosed) {
      ck(!(hasKey(t.sessionDest, mp.to) && hasKey(rec.destination, mp.from)), `Session 不一致：travelContext.destination=${t.sessionDest}、recommendationSession.destination=${rec.destination}（舊池掛在新目的地下）`);
      if (cards.length && !cards.some((c) => cardDest(c) === mp.from)) ck(hasKey(rec.destination, mp.to), `交付新目的地卡片後 Session recommendationSession.destination=${rec.destination}`);
    }
  }
  return {
    fails,
    row: {
      上一輪: prev?.text != null ? `「${prev.text}」path=${String(prev.path ?? "").slice(0, 90)} 卡片=${(prev.r15Cards ?? []).length} rec=${recStr(prev.r15Rec)}` : "（初始 Session：r15Init）",
      本輪已確認目的地: confirmedOf(t, tree),
      推薦池原始地理範圍: recStr(prev?.r15Rec),
      Places搜尋目的地: t.placesRequests ? `${searchDests.join(",")}（${t.placesRequests} 次）` : "（未搜尋）",
      畫面卡片: cards.length ? `${cards.length} 張［${cards.map((c) => `${c.name}→${cardDest(c)}`).join("、")}］` : "（無卡片）",
      Credits: credits.length ? `${credits.map((c) => `${c.path}:${c.destination}`).join(",")} settle=${JSON.stringify(settle)}` : "（未開始）",
      Session最終: `travelContext=${t.sessionDest ?? "-"}｜rec=${recStr(rec)}`,
      ...(notes.length ? { 備註: notes.join("；") } : {}),
      訊息: JSON.stringify((t.r15Assistant ?? []).at(-1) ?? null).slice(0, 140),
      path: String(t.path ?? "").slice(0, 120),
    },
  };
}

/** r15 r15Report 結尾呼叫：逐案逐樹輸出比對表；work 的 FAIL 計入 r15 結束碼。 */
export function report({ results, TREES, out }) {
  const state = { pass: 0, fail: 0, info: 0, infra: 0, precond: 0, byCase: [] };
  out.push("\n══════════════ more_places 跨目的地續推（verify-more-places-cross-destination；r15-X 掛載）══════════════");
  out.push("  欄位：本輪已確認目的地｜推薦池原始地理範圍（上一輪 recommendationSession）｜Places 搜尋目的地｜畫面卡片（→所屬目的地）｜Credits metadata｜Session 最終");
  const show = ["work", "pa2", "base", ...TREES.filter((x) => !["work", "pa2", "base"].includes(x))];
  for (const s of scenarios) {
    for (const m of s.r15Modes) {
      out.push(`\n[${s.id}][${m.id}] 案例 ${s.no}：${s.label}`);
      const verdict = {};
      for (const tree of show) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        if (r.err || r.result?.error) {
          out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${r.err ?? r.result.error}`);
          if (tree === "work") state.infra += 1;
          verdict[tree] = "INFRA";
          continue;
        }
        const turns = r.result.turns ?? [];
        const targets = [s.mp.turn, ...(s.mp.alsoSame != null ? [s.mp.alsoSame] : [])];
        const allFails = [];
        for (const ti of targets) {
          const t = turns.find((x) => x.turnIndex === ti);
          const prev = turns.find((x) => x.turnIndex === ti - 1) ?? (s.r15Init ? { r15Rec: initRecScope(s.r15Init) } : undefined);
          if (!t) {
            allFails.push(`T${ti + 1} 缺失`);
            continue;
          }
          const sub = ti === s.mp.turn ? s : { ...s, mp: { kind: "same", turn: ti, from: s.mp.from, to: s.mp.from } };
          const { fails, row } = judgeTurn(sub, t, prev, tree);
          allFails.push(...fails.map((f) => `T${ti + 1}:${f}`));
          out.push(`  ${tree.padEnd(5)} T${ti + 1}「${t.text}」${sub.mp.kind === "same" && ti !== s.mp.turn ? "（同城對照輪）" : ""}`);
          for (const [k, v] of Object.entries(row)) out.push(`        ${k}：${v}`);
        }
        const ext = r.fetchCalls ? `；外部請求=${r.fetchCalls}` : "";
        if (ext) allFails.push(`外部請求 ${r.fetchCalls} 次`);
        const precond = allFails.some((f) => f.includes("PRECOND："));
        const v = s.mp.kind === "info" ? "INFO" : precond ? "PRECOND" : allFails.length ? "FAIL" : "PASS";
        verdict[tree] = v;
        out.push(`        判定（${tree}）：${v}${allFails.length && v !== "INFO" ? ` ← ${allFails.join("；")}` : ""}`);
        if (tree === "work") {
          if (v === "PASS") state.pass += 1;
          else if (v === "FAIL") state.fail += 1;
          else if (v === "PRECOND") state.precond += 1;
          else state.info += 1;
        }
      }
      const existing = verdict.work === "FAIL" ? (verdict.pa2 === "FAIL" ? (verdict.base === "FAIL" ? "既有（base 即 FAIL）" : "既有（A2 前 pa2 即 FAIL；base 不同）") : "A2 後新出現（pa2 PASS）") : "-";
      state.byCase.push(`${s.id}[${m.id}] work=${verdict.work ?? "-"} pa2=${verdict.pa2 ?? "-"} base=${verdict.base ?? "-"} → ${existing}`);
    }
  }
  out.push("\n── more_places 跨目的地：逐案總表 ──");
  for (const x of state.byCase) out.push(`  ${x}`);
  out.push(`more_places 跨目的地（work）：PASS=${state.pass} FAIL=${state.fail} PRECOND（前置條件未成立＝未測到）=${state.precond} INFO=${state.info} INFRA=${state.infra}`);
  return { fail: state.fail + state.infra + state.precond, pass: state.pass };
}

// ── 直接執行：以 r15 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [R15, "--brief", "--f10", "--pa2", `--only=${scenarios.map((s) => s.id).join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/mp-cross.log`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
