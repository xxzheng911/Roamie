#!/usr/bin/env node
/**
 * verify-more-places-cross-destination-r2（A2-MP-T1，tester）：more_places 跨目的地推薦池修正（A2-MP-F1）的獨立驗收。
 *
 * 機制：與原檔（scripts/verify-more-places-cross-destination.mjs，sha 176b3548，不修改）相同，不自建 Harness，改經 r16 執行
 *   （r16 → r15 → r14 → r13 的正式 Callback 擷取、閉包依賴逐一實作、Provider／Places／Credits 計數、Mock Key、外部網路攔截、
 *    r15-F Fixture 有效性分類）。r16 以 --extra-scenarios=<本檔> 載入（r15-X 掛載點），樹＝work（A2-MP 後）／a2（post-A2＝修正前）／
 *    pa2（A2 前）／base（aa2db59）＋ f10／pre。
 *
 * 情境：原檔 17 案（import 原檔 scenarios，逐字沿用）＋ 本檔新增（只增不減）。
 * 判定：
 *   (1) 原檔 17 案：直接呼叫原檔 report()（同一組斷言，逐字沿用；輸出原檔逐案表）。
 *   (2) 本檔：同一判定函式（judgeCore＝原檔 judgeTurn 逐字複製；以原檔輸出交叉核對 work 判定一致）＋ r2 追加斷言
 *       （跨目的地：新池不得含舊池地點／範圍需與本輪一致；Credits：begin 與 settle 次數一致、成功恰好一次 commit、無卡退還；
 *        同範圍續推：去重、geocode／Places 次數不得高於 a2、a2 用舊池續推時 work 也不得重新搜尋；
 *        新目的地無結果後再續推：不得復活舊池）。
 *
 * 執行：node scripts/verify-more-places-cross-destination-r2.mjs [--conc=N]
 *       （＝ node scripts/verify-destination-authority-phase2-r16.mjs --brief --f10 --pa2 --a2 --only=<MP ids>
 *          --extra-scenarios=scripts/verify-more-places-cross-destination-r2.mjs --out=<scratchpad>/mp-cross-r2.log）
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { scenarios as BASE_SCENARIOS, report as baseReport } from "./verify-more-places-cross-destination.mjs";

const SELF = fileURLToPath(import.meta.url);
const WORK_ROOT = "/Users/shuo/Roamie-clean";
const PRE_DIR = "/private/tmp/claude-501/-Users-shuo-Roamie-clean/d9b631dd-21d6-4a75-977d-bd61a9060b39/scratchpad";
const R16 = `${WORK_ROOT}/scripts/verify-destination-authority-phase2-r16.mjs`;

const OK = { id: "ok", geo: "ok", search: "ok" };
const ZERO = { id: "zero", geo: "zero", search: "ok" };
const NULLM = { id: "null", geo: "null", search: "ok" };
const TIMEOUT = { id: "timeout", geo: "timeout", search: "ok" };

/** 情境 Fixture（同原檔形狀）。 */
const BEITUN = {
  台中北屯: { placeId: "mock-台中市北屯區", country: "台灣", city: "台中市", region: "台中市", district: "北屯區", lat: 24.18, lng: 120.7, formattedName: "台中市北屯區", displayLabel: "台中市北屯區" },
};

/**
 * 新增情境（r2）。kind 同原檔（cross／same／failclosed／info）＋ noRevive（新目的地無結果後再續推：不得復活 originTurn 的舊池）。
 * alsoSame：另一個同城對照輪（同原檔）；alsoCross：另一個跨目的地輪（kind=cross，同 from／to）。
 */
const NEW_SCENARIOS = [
  // 同城市不同行政區（反方向）
  { id: "MP-11-beitun-xitun", no: 11, label: "台中北屯美食 → 換台中西屯，再推薦幾個（同城市、不同行政區，反方向）", turns: ["台中北屯美食", "換台中西屯，再推薦幾個"], r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "北屯", to: "西屯" } },
  // 新目的地 Provider ZERO_RESULTS／null（驗證失敗 → 安全結束、不用舊池）
  { id: "MP-12-kanazawa-provider-zero-null", no: 12, label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Provider：ZERO_RESULTS／null）", turns: ["京都推薦景點", "換金澤，再推薦幾個"], r15Modes: [ZERO, NULLM], mp: { kind: "failclosed", turn: 1, from: "京都", to: "金澤" } },
  // 新目的地 Places 無結果 → 再推薦幾個：不得復活京都池
  {
    id: "MP-13-empty-then-more",
    no: 13,
    label: "京都推薦景點 → 換金澤，再推薦幾個（金澤 Places 回空）→ 再推薦幾個（不得復活京都池）",
    turns: ["京都推薦景點", "換金澤，再推薦幾個", "再推薦幾個"],
    r15EmptyDest: ["金澤"],
    r15Modes: [OK],
    mp: { kind: "noRevive", turn: 2, originTurn: 0, from: "京都", to: "金澤", alsoCross: 1, alsoCrossEmpty: true },
  },
  // Session 恢復：舊池（京都，6 筆、已展示 3）仍有未展示地點 → 換金澤
  {
    id: "MP-14-restore-kyoto-undisplayed-kanazawa",
    no: 14,
    label: "（Session 恢復）recommendationSession=京都（city，6 筆、已展示 3）＋travelContext=京都 → 換金澤，再推薦幾個",
    turns: ["換金澤，再推薦幾個"],
    r15Init: { topic: "attraction", rec: { destination: "京都", n: 6, batch: 3 }, travelDestination: "京都" },
    r15Modes: [OK],
    mp: { kind: "cross", turn: 0, from: "京都", to: "金澤", needUndisplayed: true },
  },
  // Session 恢復：行政區池（台中西屯）→ 換台中北屯
  {
    id: "MP-15-restore-xitun-beitun",
    no: 15,
    label: "（Session 恢復）recommendationSession=台中西屯（area：台中／西屯，6 筆、已展示 3）＋travelContext=台中西屯 → 換台中北屯，再推薦幾個",
    turns: ["換台中北屯，再推薦幾個"],
    r15Init: { topic: "restaurant", rec: { destination: "台中西屯", parentCity: "台中", area: "西屯", n: 6, batch: 3 }, travelDestination: "台中西屯" },
    r15Real: BEITUN,
    r15Modes: [OK],
    mp: { kind: "cross", turn: 0, from: "西屯", to: "北屯", needUndisplayed: true },
  },
  // Reload 後換目的地（行政區）
  { id: "MP-16-reload-xitun-beitun", no: 16, label: "台中西屯美食 →（重新載入）→ 換台中北屯，再推薦幾個", turns: ["台中西屯美食", "換台中北屯，再推薦幾個"], reloadAfter: 0, r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "西屯", to: "北屯", reload: true } },
  // Shopping：跨目的地／同目的地
  { id: "MP-17-shopping-kyoto-kanazawa", no: 17, label: "京都購物 → 換金澤，再推薦幾個（Shopping 跨目的地）", turns: ["京都購物", "換金澤，再推薦幾個"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤" } },
  { id: "MP-17b-shopping-kyoto-kanazawa-haiyouma", no: "17b", label: "京都購物 → 金澤還有嗎（Shopping 跨目的地，另一種說法）", turns: ["京都購物", "金澤還有嗎"], r15Modes: [OK], mp: { kind: "cross", turn: 1, from: "京都", to: "金澤" } },
  { id: "MP-18-shopping-kyoto-same", no: 18, label: "（對照）京都購物 → 還有嗎（Shopping 同目的地：reserve 續推）", turns: ["京都購物", "還有嗎"], r15Modes: [OK], mp: { kind: "same", turn: 1, from: "京都", to: "京都" } },
  { id: "MP-18b-shopping-kyoto-same-more", no: "18b", label: "（對照）京都購物 → 再推薦幾個（Shopping 同目的地）", turns: ["京都購物", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 1, from: "京都", to: "京都" } },
  // 同範圍續推不得退步（去重、geocode／Places 不高於 a2）
  { id: "MP-19-xitun-same", no: 19, label: "（對照）台中西屯美食 → 再推薦幾個", turns: ["台中西屯美食", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 1, from: "西屯", to: "西屯" } },
  { id: "MP-20-hv-same", no: 20, label: "（對照）香港跑馬地美食 → 再推薦幾個", turns: ["香港跑馬地美食", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 1, from: "跑馬地", to: "跑馬地" } },
  { id: "MP-21-lisbon-same", no: 21, label: "（對照）我想去里斯本 → 推薦景點 → 再推薦幾個", turns: ["我想去里斯本", "推薦景點", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 2, from: "里斯本", to: "里斯本" } },
  { id: "MP-22-kyoto-same-x2", no: 22, label: "（對照）京都推薦景點 → 再推薦幾個 → 再推薦幾個（池用完後補搜：extendRecommendationPool）", turns: ["京都推薦景點", "再推薦幾個", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 2, from: "京都", to: "京都", alsoSame: 1 } },
  { id: "MP-22b-xitun-same-x2", no: "22b", label: "（對照）台中西屯美食 → 再推薦幾個 → 再推薦幾個", turns: ["台中西屯美食", "再推薦幾個", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 2, from: "西屯", to: "西屯", alsoSame: 1 } },
  // Credits metadata（行政區）
  { id: "MP-23-xitun-more-beitun", no: 23, label: "台中西屯美食 → 再推薦幾個 → 換台中北屯，再推薦幾個（Credits metadata）", turns: ["台中西屯美食", "再推薦幾個", "換台中北屯，再推薦幾個"], r15Real: BEITUN, r15Modes: [OK], mp: { kind: "cross", turn: 2, from: "西屯", to: "北屯", alsoSame: 1 } },
  // 換到新目的地後的續推必須用新目的地的池
  { id: "MP-24-kanazawa-then-more", no: 24, label: "京都推薦景點 → 換金澤，再推薦幾個 → 再推薦幾個（續推必須是金澤池）", turns: ["京都推薦景點", "換金澤，再推薦幾個", "再推薦幾個"], r15Modes: [OK], mp: { kind: "same", turn: 2, from: "金澤", to: "金澤", alsoCross: 1, crossFrom: "京都" } },
  // Provider timeout 後恢復：同程序 15s 內再試不得改用舊池
  { id: "MP-25-kanazawa-timeout-retry", no: 25, label: "京都推薦景點 → 換金澤，再推薦幾個 → 再推薦幾個（金澤 Provider timeout：兩輪皆不得用京都池）", turns: ["京都推薦景點", "換金澤，再推薦幾個", "再推薦幾個"], r15Modes: [TIMEOUT], mp: { kind: "failclosed", turn: 1, from: "京都", to: "金澤", noReviveTurn: 2, originTurn: 0 } },
];

export const scenarios = [...BASE_SCENARIOS, ...NEW_SCENARIOS];
const BASE_IDS = new Set(BASE_SCENARIOS.map((s) => s.id));
const ORIGINAL_FAILS = ["MP-01-kyoto-kanazawa", "MP-07-undisplayed-pool", "MP-08-new-dest-empty", "MP-09-credits-metadata", "MP-10-reload-kanazawa"];

// ════════════════ judgeCore：原檔 judgeTurn 逐字複製（含 PLACE_KEYS 等輔助）；只在 PLACE_KEYS 後補「里斯本」供新增情境使用 ════════════════
const PLACE_KEYS_BASE = ["西屯", "北屯", "跑馬地", "東山", "香港", "金澤", "金沢", "大阪", "京都", "台中"];
const makeKeys = (extra) => {
  const PLACE_KEYS = [...PLACE_KEYS_BASE, ...extra];
  const keyOf = (v) => PLACE_KEYS.find((k) => String(v ?? "").includes(k)) ?? (v == null ? null : "?");
  return { keyOf, cardDest: (c) => keyOf(`${c?.name ?? ""}|${c?.id ?? ""}`), hasKey: (v, k) => keyOf(v) === k };
};
const KEYS_ORIG = makeKeys([]);
const KEYS_R2 = makeKeys(["里斯本"]);
const uniq = (a) => [...new Set(a)];

function confirmedOf(t, tree) {
  const flows = (t.r15Flows ?? []).filter((f) => !f.nested);
  const scope = flows.filter((f) => f.fn === "resolveTrustedRecommendationSearchScope");
  const lastScope = scope.at(-1);
  if (lastScope) return lastScope.status === "trusted" ? lastScope.destination : `未確認(${lastScope.reason ?? lastScope.status})`;
  const more = flows.filter((f) => f.fn === "resolveMorePlacesTurnDestination").at(-1);
  if (more) return more.status === "trusted" ? more.destination : "未確認(more_places)";
  return tree === "base" ? `（base 無驗證流程；cont=${t.continuationDest ?? "-"}）` : "-";
}
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

/** 原檔 judgeTurn（逐字；keys 參數化：原檔情境用 KEYS_ORIG，新增情境用 KEYS_R2）。 */
function judgeCore(s, t, prev, tree, K) {
  const { cardDest, hasKey } = K;
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

// ════════════════ r2 追加斷言 ════════════════
const AREA_KEYS = new Set(["西屯", "北屯", "跑馬地", "東山"]);
/** 跨目的地／續推的追加斷言（只用本輪 obs＋前一輪／起點輪 obs；不需其他樹）。 */
function judgeExtra(kind, mp, t, prev, origin, K) {
  const { cardDest, hasKey, keyOf } = K;
  const fails = [];
  const ck = (cond, msg) => {
    if (!cond) fails.push(msg);
  };
  const cards = t.r15Cards ?? [];
  const credits = t.r15Credits ?? [];
  const settle = t.creditsSettle ?? [];
  const rec = t.r15Rec;
  const rpc = t.creditsRpc ?? [];
  // Credits：begin 與 active settle 次數一致；有新卡 → 恰好 1 次 commit；無新卡 → 不得 commit；每個 reserve 恰好一次結算
  ck(settle.length === credits.length, `Credits begin=${credits.length} 但 settle=${settle.length}（${JSON.stringify(settle)}）`);
  ck(settle.filter((x) => x === true).length === (cards.length ? 1 : 0), `Credits 成功結算次數=${settle.filter((x) => x === true).length}（卡片=${cards.length}；預期 ${cards.length ? 1 : 0}）`);
  const reserves = rpc.filter((x) => x === "credits_reserve").length;
  ck(reserves === rpc.filter((x) => x === "credits_commit").length + rpc.filter((x) => x === "credits_rollback").length, `Credits RPC reserve=${reserves} 與 commit＋rollback 不一致（${rpc.join(",")}）`);
  ck(rpc.filter((x) => x === "credits_commit").length === (cards.length ? 1 : 0), `credits_commit=${rpc.filter((x) => x === "credits_commit").length}（卡片=${cards.length}）`);
  if (kind === "cross") {
    const prevIds = new Set(prev?.r15Rec?.poolIds ?? []);
    if (rec && !hasKey(rec.destination, mp.from)) {
      const mixed = (rec.poolIds ?? []).filter((id) => prevIds.has(id));
      ck(!mixed.length, `新推薦池（${rec.destination}）含舊池「${mp.from}」地點 ${mixed.length} 筆（舊池被接續／extend）`);
      ck((rec.poolIds ?? []).every((id) => keyOf(id) !== mp.from), `新推薦池（${rec.destination}）含「${mp.from}」地點 id`);
      if (hasKey(rec.destination, mp.to)) {
        if (AREA_KEYS.has(mp.to)) ck(rec.searchScope === "area" && hasKey(rec.area, mp.to), `新推薦池範圍應為行政區「${mp.to}」：${recStr(rec)}`);
        else ck(rec.searchScope !== "area" && rec.searchScope !== "district", `新推薦池範圍應為城市「${mp.to}」：${recStr(rec)}`);
      }
    }
    if (rec && hasKey(rec.destination, mp.from) && cards.length) ck(false, `交付卡片後 Session 推薦池仍是舊目的地「${rec.destination}」`);
    for (const c of credits) if (cards.length) ck(hasKey(c.destination, mp.to), `Credits metadata.destination=${c.destination} ≠ 本輪目的地「${mp.to}」`);
  }
  if (kind === "noRevive" || kind === "failclosedRevive") {
    const originIds = new Set(origin?.r15Rec?.poolIds ?? []);
    if (!originIds.size) fails.push(`PRECOND：起點輪沒有「${mp.from}」推薦池`);
    const oldCards = cards.filter((c) => originIds.has(c.id) || cardDest(c) === mp.from);
    ck(!oldCards.length, `復活舊池「${mp.from}」：顯示 ${oldCards.length} 張（${oldCards.map((c) => c.name).join("、")}）`);
    const searchDests = uniq((t.placesQueries ?? []).map((x) => String(x).split("@").at(-1)));
    ck(searchDests.every((d) => !hasKey(d, mp.from)), `以舊目的地「${mp.from}」搜尋 Places：${searchDests.join(",")}`);
    ck(!(rec && hasKey(rec.destination, mp.from)), `Session 推薦池復活為舊目的地「${rec?.destination}」`);
    ck(!(rec?.poolIds ?? []).some((id) => originIds.has(id)), "Session 推薦池含舊池地點");
    for (const c of credits) ck(!hasKey(c.destination, mp.from), `Credits metadata.destination=舊目的地「${c.destination}」`);
  }
  if (kind === "same") {
    // 去重：本輪卡片不得與先前各輪卡片重複
    const seen = new Set((t.__prevCards ?? []).map((c) => c.id).filter(Boolean));
    const dup = cards.filter((c) => c.id && seen.has(c.id));
    ck(!dup.length, `續推卡片與先前輪次重複 ${dup.length} 張（${dup.map((c) => c.name).join("、")}）`);
    ck(uniq(cards.map((c) => c.id)).length === cards.length, "同一輪卡片重複");
  }
  return fails;
}

function turnOf(turns, i) {
  return turns.find((x) => x.turnIndex === i);
}

/** r16 r15Report 結尾呼叫（r15-X）。 */
export function report({ results, TREES, out }) {
  // (1) 原檔 17 案：原檔 report（同一組斷言）
  const outStart = out.length;
  const base = baseReport({ results, TREES, out });
  const baseByCase = new Map();
  for (const line of out.slice(outStart)) {
    const m = line.match(/^ {2}(\S+)\[(\w+)\] work=(\S+) pa2=(\S+) base=(\S+) →/);
    if (m) baseByCase.set(`${m[1]}|${m[2]}`, { work: m[3], pa2: m[4], base: m[5] });
  }
  // (2) r2：全部情境 × work／a2／pa2／base
  out.push("\n══════════════ more_places 跨目的地 r2（A2-MP-T1；r16 掛載；樹 work／a2／pa2／base）══════════════");
  out.push("  欄位同原檔；判定＝原檔斷言（judgeCore）＋ r2 追加斷言（Credits 次數、新池不得含舊池、去重、成本不高於 a2、無結果後不得復活舊池）");
  const SHOW = ["work", "a2", "pa2", "base"].filter((t) => TREES.includes(t));
  const state = { pass: 0, fail: 0, precond: 0, info: 0, infra: 0, consistency: [], rows: [] };
  for (const s of scenarios) {
    const isBase = BASE_IDS.has(s.id);
    const K = isBase ? KEYS_ORIG : KEYS_R2;
    for (const m of s.r15Modes) {
      out.push(`\n[${s.id}][${m.id}] 案例 ${s.no}：${s.label}${isBase ? "（原檔情境）" : "（r2 新增）"}`);
      const verdict = {};
      const coreVerdict = {};
      const perTree = {};
      for (const tree of SHOW) {
        const r = results[`${tree}|${m.id}|${s.id}`];
        if (!r) continue;
        if (r.err || r.result?.error) {
          out.push(`  ${tree.padEnd(5)} INFRA-FAIL ${String(r.err ?? r.result.error).slice(0, 300)}`);
          verdict[tree] = coreVerdict[tree] = "INFRA";
          continue;
        }
        const turns = r.result.turns ?? [];
        perTree[tree] = turns;
        const mp = s.mp;
        const targets = [
          { ti: mp.turn, kind: mp.kind, sub: s },
          ...(mp.alsoSame != null ? [{ ti: mp.alsoSame, kind: "same", sub: { ...s, mp: { kind: "same", turn: mp.alsoSame, from: mp.from, to: mp.from } } }] : []),
          ...(mp.alsoCross != null ? [{ ti: mp.alsoCross, kind: "cross", sub: { ...s, mp: { kind: "cross", turn: mp.alsoCross, from: mp.crossFrom ?? mp.from, to: mp.to, empty: Boolean(mp.alsoCrossEmpty) } } }] : []),
          ...(mp.noReviveTurn != null ? [{ ti: mp.noReviveTurn, kind: "failclosedRevive", sub: { ...s, mp: { kind: "failclosed", turn: mp.noReviveTurn, from: mp.from, to: mp.to } } }] : []),
        ];
        const coreFails = [];
        const extraFails = [];
        for (const tg of targets) {
          const t = turnOf(turns, tg.ti);
          const prev = turnOf(turns, tg.ti - 1) ?? (s.r15Init ? { r15Rec: initRecScope(s.r15Init) } : undefined);
          const origin = mp.originTurn != null ? turnOf(turns, mp.originTurn) : null;
          if (!t) {
            coreFails.push(`T${tg.ti + 1} 缺失`);
            continue;
          }
          t.__prevCards = turns.filter((x) => x.turnIndex < tg.ti).flatMap((x) => x.r15Cards ?? []);
          const coreKind = tg.kind === "failclosedRevive" ? "failclosed" : tg.kind;
          const { fails, row } = coreKind === "noRevive" ? { fails: [], row: judgeCore({ ...s, mp: { ...mp, kind: "info" } }, t, prev, tree, K).row } : judgeCore({ ...tg.sub, mp: { ...tg.sub.mp, kind: coreKind } }, t, prev, tree, K);
          const ext = judgeExtra(tg.kind, tg.sub.mp, t, prev, origin, K);
          coreFails.push(...fails.map((f) => `T${tg.ti + 1}:${f}`));
          extraFails.push(...ext.map((f) => `T${tg.ti + 1}:[r2] ${f}`));
          out.push(`  ${tree.padEnd(5)} T${tg.ti + 1}「${t.text}」（${tg.kind}）`);
          for (const [k, v] of Object.entries(row)) out.push(`        ${k}：${v}`);
          out.push(`        geocode=${t.geocodes?.length ?? 0}[${(t.geocodes ?? []).join(",")}] placesReq=${t.placesRequests ?? 0} creditsRpc=[${(t.creditsRpc ?? []).join(",")}] rec.poolIds=${JSON.stringify((t.r15Rec?.poolIds ?? []).slice(0, 12))}`);
          delete t.__prevCards;
        }
        if (r.fetchCalls) coreFails.push(`外部請求 ${r.fetchCalls} 次`);
        const precond = [...coreFails, ...extraFails].some((f) => f.includes("PRECOND："));
        const cv = s.mp.kind === "info" ? "INFO" : precond ? "PRECOND" : coreFails.length ? "FAIL" : "PASS";
        const v = s.mp.kind === "info" ? "INFO" : precond ? "PRECOND" : coreFails.length || extraFails.length ? "FAIL" : "PASS";
        coreVerdict[tree] = cv;
        verdict[tree] = v;
        out.push(`        判定（${tree}）：原檔斷言=${cv}${coreFails.length && cv !== "INFO" ? ` ← ${coreFails.join("；")}` : ""}｜r2 追加=${extraFails.length ? `FAIL ← ${extraFails.join("；")}` : "PASS"} → ${v}`);
      }
      // 同範圍續推：成本不得高於 a2；a2 以舊池續推（未搜尋）時 work 也不得重新搜尋
      const costFails = [];
      if (s.mp.kind === "same" && perTree.work && perTree.a2) {
        const sumG = (turns) => turns.reduce((a, t) => a + (t.geocodes?.length ?? 0), 0);
        if (sumG(perTree.work) > sumG(perTree.a2)) costFails.push(`情境總 geocode work=${sumG(perTree.work)} > a2=${sumG(perTree.a2)}`);
        for (const ti of [s.mp.turn, ...(s.mp.alsoSame != null ? [s.mp.alsoSame] : [])]) {
          const w = turnOf(perTree.work, ti);
          const a = turnOf(perTree.a2, ti);
          if (!w || !a) continue;
          if ((w.geocodes?.length ?? 0) > (a.geocodes?.length ?? 0)) costFails.push(`T${ti + 1} geocode work=${w.geocodes.length} > a2=${a.geocodes.length}（${w.geocodes.join(",")}）`);
          if ((w.placesRequests ?? 0) > (a.placesRequests ?? 0)) costFails.push(`T${ti + 1} placesReq work=${w.placesRequests} > a2=${a.placesRequests}`);
          if ((a.r15Cards ?? []).length && !(a.placesRequests > 0) && w.placesRequests > 0) costFails.push(`T${ti + 1} a2 以舊池續推（未搜尋），work 改為重新搜尋（續推退步）`);
          const ids = (t) => JSON.stringify((t.r15Cards ?? []).map((c) => c.id));
          if (ids(w) !== ids(a)) costFails.push(`T${ti + 1} 卡片與 a2 不同：work=${ids(w)} a2=${ids(a)}`);
        }
        out.push(`  成本／續推對照（work vs a2）：${costFails.length ? `FAIL ← ${costFails.join("；")}` : "PASS（geocode／Places 不高於 a2、卡片相同）"}`);
        if (costFails.length && verdict.work === "PASS") verdict.work = "FAIL";
      }
      // 原檔情境：work 原檔斷言判定必須與原檔 report 一致（同一組斷言的交叉核對）
      if (isBase) {
        const b = baseByCase.get(`${s.id}|${m.id}`);
        for (const tree of ["work", "pa2", "base"]) if (b && coreVerdict[tree] && b[tree] !== coreVerdict[tree]) state.consistency.push(`${s.id}[${m.id}] ${tree}：原檔 report=${b[tree]} r2 judgeCore=${coreVerdict[tree]}`);
        if (!b) state.consistency.push(`${s.id}[${m.id}]：原檔 report 沒有逐案列`);
      }
      const w = verdict.work ?? "-";
      if (w === "PASS") state.pass += 1;
      else if (w === "FAIL") state.fail += 1;
      else if (w === "PRECOND") state.precond += 1;
      else if (w === "INFRA") state.infra += 1;
      else state.info += 1;
      const was = ORIGINAL_FAILS.includes(s.id) ? "（原 FAIL 5 案之一）" : "";
      state.rows.push(`${s.id}[${m.id}]${was} work=${w}（原檔斷言=${coreVerdict.work ?? "-"}） a2=${verdict.a2 ?? "-"}（原檔斷言=${coreVerdict.a2 ?? "-"}） pa2=${verdict.pa2 ?? "-"} base=${verdict.base ?? "-"}${costFails.length ? " 成本對照=FAIL" : ""}`);
    }
  }
  out.push("\n── more_places r2：逐案總表（work／a2／pa2／base；括號＝只用原檔斷言）──", ...state.rows.map((x) => `  ${x}`));
  const origNow = ORIGINAL_FAILS.map((id) => `${id}=${state.rows.find((x) => x.startsWith(`${id}[`))?.match(/ work=(\S+)/)?.[1] ?? "-"}`);
  out.push(`  原 FAIL 5 案（work）：${origNow.join("、")}`);
  out.push(`  原檔 report（17 案）work：PASS=${base.pass} FAIL（含 PRECOND／INFRA）=${base.fail}`);
  out.push(`  原檔斷言交叉核對（r2 judgeCore vs 原檔 report）：${state.consistency.length ? `不一致 ${state.consistency.length} 件` : "一致"}`, ...state.consistency.map((x) => `    ${x}`));
  out.push(`more_places r2（work，全部 ${scenarios.length} 情境×mode）：PASS=${state.pass} FAIL=${state.fail} PRECOND=${state.precond} INFO=${state.info} INFRA=${state.infra}`);
  return { fail: base.fail + state.fail + state.precond + state.infra + state.consistency.length, pass: state.pass };
}

// ── 直接執行：以 r16 掛載本檔 ──
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const pass = process.argv.slice(2).filter((a) => /^--conc=\d+$/.test(a));
  const args = [R16, "--brief", "--f10", "--pa2", "--a2", `--only=${scenarios.map((s) => s.id).join(",")}`, `--extra-scenarios=${SELF}`, `--out=${PRE_DIR}/mp-cross-r2.log`, ...pass];
  const child = spawn(process.execPath, args, { cwd: WORK_ROOT, stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
