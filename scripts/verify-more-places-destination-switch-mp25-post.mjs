#!/usr/bin/env node
/**
 * A2-MP-T12（tester）— MP-25 施工後「純函式」探針（不是 Harness、不 render、不跑 send()）。
 * 只以 vite-node 載入正式模組（同 mp25-r4 standaloneCanon 的載入方式；fetch 全部攔截並計數，任何外部請求 → FAIL），
 * 驗證：情境 18 解析與保護清單、destination_switch 回答分類、Pending 建立／上限函式。
 * 不涵蓋：send() 分支順序、Provider／Places／Credits 次數（需 r21 Harness）。
 * A2-MP-T17：advanceDestinationSwitchPending 依 R2 正式簽名傳第二參數（C-4／C-5 明確傳 provider_attempted_failure、仍要求 +1）；
 *   新增 C-4a～C-4f 對照（cooldown／cached_miss／無 outcome／verified 不 +1、不改其他欄位、不原地修改）；
 *   新增 D-* 診斷（[INFO]，不計 PASS／FAIL）：情境 18 類似語句、「稍後再說」分類、詢問上限，以及 send() 前段正式 Session 轉換鏈重現
 *   （geocodeFn 一律丟錯並計數，不經 fetch；Session 為最小近似，非 send() 實際值）。
 *   node scripts/verify-more-places-destination-switch-mp25-post.mjs --out=<scratchpad>/x.log
 */
import { writeFileSync } from "node:fs";

const WORK_ROOT = "/Users/shuo/Roamie-clean";
const out = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);

async function load(rels) {
  const { createServer } = await import("vite");
  const { ViteNodeServer } = await import("vite-node/server");
  const { ViteNodeRunner } = await import("vite-node/client");
  const tsconfigPaths = (await import("vite-tsconfig-paths")).default;
  const realFetch = globalThis.fetch;
  let ext = 0;
  globalThis.fetch = async () => {
    ext += 1;
    throw new Error("[mp25-post] 禁止外部請求");
  };
  const server = await createServer({ root: WORK_ROOT, configFile: false, envDir: false, logLevel: "silent", clearScreen: false, plugins: [tsconfigPaths()], server: { middlewareMode: true, hmr: false, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  const mods = {};
  try {
    await server.environments.client.pluginContainer.buildStart({});
    const vn = new ViteNodeServer(server);
    const runner = new ViteNodeRunner({ root: server.config.root, base: server.config.base, fetchModule: (id) => vn.fetchModule(id), resolveId: (id, importer) => vn.resolveId(id, importer) });
    await runner.executeId("/@vite/env");
    for (const rel of rels) mods[rel] = await runner.executeFile(`${WORK_ROOT}/${rel}`);
  } finally {
    await server.close();
  }
  return { mods, ext: () => ext, restore: () => (globalThis.fetch = realFetch) };
}

const { mods, ext, restore } = await load(["src/lib/ai/continue-recommendation-intent.ts", "src/lib/ai/destination-geographic-clarification.ts", "src/lib/ai/travel-context.ts", "src/lib/ai/must-visit-places.ts", "src/lib/ai/chat-turn-destination.ts", "src/lib/chat-session.ts", "src/lib/chat-planning-flow.ts", "src/lib/recommendation/trip-intent.ts", "src/lib/ai/trip-planning-context.ts", "src/lib/ai/chat-dining-flow.ts", "src/lib/ai/chat-intent.ts", "src/lib/ai/recommendation-refinement/arbitrate.ts", "src/lib/ai/chat-conversation-state.ts", "src/lib/ai/conversation-recommendation-session.ts", "src/lib/ai/chat-recommendation-refresh.ts", "src/lib/ai/trip-planning-session-reset.ts"]);
const cri = mods["src/lib/ai/continue-recommendation-intent.ts"];
const geo = mods["src/lib/ai/destination-geographic-clarification.ts"];
const tc = mods["src/lib/ai/travel-context.ts"];
const mvp = mods["src/lib/ai/must-visit-places.ts"];
const ctd = mods["src/lib/ai/chat-turn-destination.ts"];

const lines = [];
let pass = 0;
let fail = 0;
const check = (id, desc, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? pass++ : fail++;
  lines.push(`[${ok ? "OK" : "NG"}] ${id} ${desc}｜期望=${JSON.stringify(expected)} 實際=${JSON.stringify(actual)}`);
};
const info = (id, desc, actual) => lines.push(`[INFO] ${id} ${desc}｜實際=${JSON.stringify(actual)}`);
const st = (t) => {
  const s = cri.analyzeContinueRecommendationStructure(t);
  return { isContinue: s.isContinue, candidate: s.candidateText, has: s.hasPendingPlaceCandidate };
};

// ── 情境 18 與保護清單（analyzeContinueRecommendationStructure）──
check("P18-1", "「不去大阪了，換金澤，再推薦幾個」候選＝金澤（不得為「大阪了換金澤」）", st("不去大阪了，換金澤，再推薦幾個"), { isContinue: true, candidate: "金澤", has: true });
check("P18-2", "「不去大阪了換金澤，再推薦幾個」（無逗號）", st("不去大阪了換金澤，再推薦幾個").candidate, "金澤");
check("P18-3", "「不要去大阪，換金澤，再推薦幾個」", st("不要去大阪，換金澤，再推薦幾個").candidate, "金澤");
check("G-1", "保護：正常「換金澤，再推薦幾個」", st("換金澤，再推薦幾個"), { isContinue: true, candidate: "金澤", has: true });
info("G-2", "保護：「改去大阪，再推薦幾個」（施工未改此路徑，僅記錄）", st("改去大阪，再推薦幾個"));
check("G-3", "保護：純「再推薦幾個」無候選", st("再推薦幾個"), { isContinue: true, candidate: "", has: false });
info("G-4", "保護：合法地名含「換」字（換乘？無既有合法例；記錄「不去大阪了，換」邊界）", st("不去大阪了，換，再推薦幾個"));
info("G-5", "保護：同城市行政區切換「換東山區，再推薦幾個」", st("換東山區，再推薦幾個"));
check("G-6", "保護：別名「換金沢，再推薦幾個」", st("換金沢，再推薦幾個").candidate, "金沢");
info("G-7", "「不去大阪了，再推薦幾個」（無換字：不得被負向規則吃掉後變成大阪）", st("不去大阪了，再推薦幾個"));

// ── destination_switch 回答分類（京都→金澤）──
const cls = (t) => geo.classifyDestinationSwitchAnswer(t, "金澤", "京都");
check("A-1", "「好」→ confirm", cls("好"), "confirm");
check("A-2", "「再推薦幾個」→ hold（不得恢復京都）", cls("再推薦幾個"), "hold");
info("A-3", "「便宜一點的」（hold 或 replace；replace 會落入既有流程，需 Harness 確認不恢復京都）", cls("便宜一點的"));
check("A-4", "「京都」→ keep_previous", cls("京都"), "keep_previous");
check("A-5", "「繼續京都」→ keep_previous", cls("繼續京都"), "keep_previous");
check("A-6", "「金沢」別名 → confirm", cls("金沢"), "confirm");
check("A-7", "「不要」→ cancel", cls("不要"), "cancel");
check("A-8", "「換大阪，再推薦幾個」→ replace", cls("換大阪，再推薦幾個"), "replace");
check("A-9", "「換金沢，再推薦幾個」（同一 Pending 別名重說）→ confirm（不得 replace 重建）", cls("換金沢，再推薦幾個"), "confirm");
check("A-10", "「不去大阪了，換金澤，再推薦幾個」→ confirm（同一 Pending）", cls("不去大阪了，換金澤，再推薦幾個"), "confirm");
info("A-11", "「維持原本的」", cls("維持原本的"));
info("A-12", "「回京都」（R4：有限清單外）", cls("回京都"));
info("A-13", "「yes please」", cls("yes please"));
info("A-14", "「はい」／「네」／「keep Kyoto」", [cls("はい"), cls("네"), geo.classifyDestinationSwitchAnswer("keep Kyoto", "金澤", "Kyoto")]);

// ── Pending 建立／上限 ──
const sess = { recommendationSession: { destination: "京都" }, travelContext: { destination: "京都" } };
const p = geo.planDestinationSwitchPending({ userText: "換金澤，再推薦幾個", requestedDestination: "金澤", turnStartSession: sess, categoryIntent: "attraction" });
check("C-1", "建立：八欄位、attempts=1", p && Object.keys(p).sort(), ["categoryIntent", "confirmationAttempts", "kind", "originalUserText", "originatingRoute", "parentIntent", "previousConfirmedDestination", "rawGeographicLabel"]);
check("C-1b", "建立：kind/route/parent/attempts", p && [p.kind, p.originatingRoute, p.parentIntent, p.confirmationAttempts, p.previousConfirmedDestination], ["destination_switch", "more_places", "place_recommendation", 1, "京都"]);
const p18 = geo.planDestinationSwitchPending({ userText: "不去大阪了，換金澤，再推薦幾個", requestedDestination: "金澤", turnStartSession: sess, categoryIntent: "attraction" });
check("C-2", "情境 18 建立 Pending 的 raw＝金澤", p18?.rawGeographicLabel, "金澤");
check("C-3", "建立後未封頂", p && geo.isDestinationSwitchCapped(p), false);
// A2-MP-T17：R2 起 advanceDestinationSwitchPending(pending, validation) 需第二參數；
// 原探針「推進一次 +1」明確傳入真正 Provider 失敗（provider_attempted_failure），仍要求 +1。
const FAIL_RUN = { providerOutcome: "provider_attempted_failure" };
const p2 = p && geo.advanceDestinationSwitchPending(p, FAIL_RUN);
check("C-4", "推進一次（provider_attempted_failure）→ attempts=2、封頂", p2 && [p2.confirmationAttempts, geo.isDestinationSwitchCapped(p2)], [2, true]);
check("C-5", "封頂後再推進（provider_attempted_failure）不超過 2", p2 && geo.advanceDestinationSwitchPending(p2, FAIL_RUN).confirmationAttempts, 2);
// 對照（新增，不取代 C-4／C-5）：沒有真正送出 Provider 請求的結果不得 +1。
for (const [id, outcome] of [["C-4a", "provider_cooldown"], ["C-4b", "provider_cached_miss"], ["C-4c", undefined], ["C-4d", "provider_verified"]]) {
  const adv = p && geo.advanceDestinationSwitchPending(p, outcome === undefined ? {} : { providerOutcome: outcome });
  check(id, `推進（${outcome ?? "無 providerOutcome／hold"}）→ attempts 維持 1`, adv && adv.confirmationAttempts, 1);
}
check("C-4e", "推進（provider_attempted_failure）不得改動其他七欄位", p2 && Object.fromEntries(Object.entries(p2).filter(([k]) => k !== "confirmationAttempts")), p && Object.fromEntries(Object.entries(p).filter(([k]) => k !== "confirmationAttempts")));
check("C-4f", "推進不得原地修改輸入 Pending（attempts 仍為 1）", p && p.confirmationAttempts, 1);
check("C-6", "Client 夾帶多餘欄位 → sanitize 只留八欄位", Object.keys(geo.sanitizeDestinationSwitchPending({ ...p, lat: 36.5, searchScope: "x" }, "京都") ?? {}).length, 8);
check("C-7", "previous 與本輪可信目的地不同 → sanitize=null", geo.sanitizeDestinationSwitchPending(p, "大阪"), null);
check("C-8", "attempts=3 → sanitize=null", geo.sanitizeDestinationSwitchPending({ ...p, confirmationAttempts: 3 }, "京都"), null);
check("C-9", "原句含座標 → 不建立", geo.planDestinationSwitchPending({ userText: "換金澤 36.56,136.65，再推薦幾個", requestedDestination: "金澤", turnStartSession: sess, categoryIntent: "attraction" }), null);
check("C-10", "換回京都（＝previous）→ 不建立", geo.planDestinationSwitchPending({ userText: "換京都，再推薦幾個", requestedDestination: "京都", turnStartSession: sess, categoryIntent: "attraction" }), null);
info("C-11", "取消後以不同原句重建（R3／J-2）：新 Pending attempts", geo.planDestinationSwitchPending({ userText: "換金沢，再推薦幾個", requestedDestination: "金沢", turnStartSession: sess, categoryIntent: "attraction" })?.confirmationAttempts);

// ── A2-MP-T17 診斷（INFO；不影響 PASS／FAIL）：情境 18 類似語句、「稍後再說」、詢問上限 ──
for (const t of [
  "不去大阪了，換金澤，再推薦幾個",
  "不要去大阪，改金澤，再推薦幾個",
  "大阪不去了，換金澤，再推薦幾個",
  "不想去大阪了，換成金澤，再推薦幾個",
  "換金澤，再推薦幾個",
]) {
  info("D-st", `structure「${t}」`, st(t));
  info("D-plan", `plan「${t}」requested=金澤`, geo.planDestinationSwitchPending({ userText: t, requestedDestination: "金澤", turnStartSession: sess, categoryIntent: "attraction" })?.rawGeographicLabel ?? null);
}
for (const t of ["稍後再說", "稍後再說吧", "等一下", "晚點再說", "先不要"]) info("D-cls", `classify「${t}」`, cls(t));
if (p && p2) {
  const Q = "Q?";
  const F = ["STOP", "CAP"];
  const conv = (n, tail = []) => [{ role: "user", content: "x" }, ...Array.from({ length: n }, () => ({ role: "assistant", content: Q })), ...tail.map((c) => ({ role: "assistant", content: c }))];
  info("D-ask", "canAskAgain：未封頂、已問 1／2／3 次、問 2 次＋1 則 STOP", [1, 2, 3].map((n) => geo.canAskDestinationSwitchAgain(p, conv(n), Q, F)).concat([geo.canAskDestinationSwitchAgain(p, conv(2, ["STOP"]), Q, F)]));
  info("D-ask-cap", "canAskAgain：封頂（attempts=2）已問 1 次", geo.canAskDestinationSwitchAgain(p2, conv(1), Q, F));
  info("D-cap-san", "封頂 Pending 經 sanitize 後仍保留 attempts=2", geo.sanitizeDestinationSwitchPending(p2, "京都")?.confirmationAttempts ?? null);
}

// ── A2-MP-T17 診斷（INFO）：pushMorePlaceRecommendations 不可信分支前段的正式函式鏈重現 ──
// （mergeTravelContext → mergeContextForPlaceFetch → resolveMorePlacesTurnDestination → planDestinationSwitchPending）
// geocodeFn 一律丟錯（＝timeout）並計數；不經 fetch。Session 為「京都推薦景點」後的最小近似，非 send() 實際值。
{
  let geoCalls = [];
  const geocodeFn = async (arg) => {
    geoCalls.push(arg?.data?.query ?? arg?.data?.destinationName ?? "?");
    throw new Error("[mp25-post] mock timeout");
  };
  const S = { recommendationSession: { destination: "京都", topic: "attraction" }, travelContext: { destination: "京都", interests: [] }, activeCategoryIntent: "attraction", recommendedPlaces: [], selectedPlaces: [] };
  for (const t of ["換金澤，再推薦幾個", "不去大阪了，換金澤，再推薦幾個", "不要去大阪，改金澤，再推薦幾個", "大阪不去了，換金澤，再推薦幾個", "不想去大阪了，換成金澤，再推薦幾個"]) {
    geoCalls = [];
    try {
      const active = { ...S, travelContext: { ...S.travelContext, tripPurpose: "more_place_recommendations" } };
      const merged = tc.mergeTravelContext(active, t);
      const placeCtx = mvp.mergeContextForPlaceFetch(merged.context, active);
      const requested = await ctd.resolveMorePlacesTurnDestination({ ctx: placeCtx, session: merged.session, userText: t, locale: "zh-TW", geocodeFn });
      const plan = geo.planDestinationSwitchPending({ userText: t, requestedDestination: requested, turnStartSession: S, categoryIntent: "attraction" });
      info("D-chain", `「${t}」`, { mergedDest: merged.context.destination ?? null, placeCtxDest: placeCtx.destination ?? null, requested: requested ?? null, geocode: geoCalls, plan: plan?.rawGeographicLabel ?? null });
    } catch (e) {
      info("D-chain", `「${t}」例外`, String(e?.message ?? e).slice(0, 160));
    }
  }
}

// ── A2-MP-T17 診斷（INFO）：send() 前段（同 r13 模型順序）的正式 Session 轉換，觀察 pushMore 的 categoryIntent 來源 ──
{
  const M = (rel) => mods[rel];
  const crs = M("src/lib/ai/conversation-recommendation-session.ts");
  const S0 = {
    recommendationSession: { destination: "京都", topic: "attraction" },
    activeRecommendationContext: { destinationName: "京都", intent: "attraction" },
    travelContext: { destination: "京都", interests: [] },
    activeCategoryIntent: "attraction",
    recommendedPlaces: [],
    selectedPlaces: [],
  };
  const lastReply = "在京都，這些地方值得先看看：";
  const view = (s) => ({ topic: s?.recommendationSession?.topic ?? null, aci: s?.activeCategoryIntent ?? null, cat: safeCall(() => crs.resolveActiveCategoryIntent(s)) ?? null, rec: s?.recommendationSession?.destination ?? null, tc: s?.travelContext?.destination ?? null });
  function safeCall(f) { try { return f(); } catch (e) { return `throw:${String(e?.message ?? e).slice(0, 80)}`; } }
  for (const t of ["換金澤，再推薦幾個", "不去大阪了，換金澤，再推薦幾個", "不要去大阪，改金澤，再推薦幾個", "大阪不去了，換金澤，再推薦幾個", "不想去大阪了，換成金澤，再推薦幾個", "換大阪，再推薦幾個"]) {
    const steps = [];
    let ns = S0;
    const step = (name, f) => { const r = safeCall(() => f(ns)); if (r && typeof r === "object") ns = r; steps.push([name, typeof r === "string" ? r : view(ns)]); };
    step("applyTripIntentToSession", (s) => M("src/lib/recommendation/trip-intent.ts").applyTripIntentToSession(t, s));
    step("applyQuickChipContext", (s) => M("src/lib/ai/chat-intent.ts").applyQuickChipContext(t, s));
    step("applyDiningContextFromText", (s) => M("src/lib/ai/chat-dining-flow.ts").applyDiningContextFromText(t, s));
    step("prepareSessionForUserTurn", (s) => M("src/lib/ai/chat-conversation-state.ts").prepareSessionForUserTurn(s, lastReply));
    let mergedCtx = null;
    step("mergeTravelContext", (s) => { const m = tc.mergeTravelContext(s, t, lastReply); mergedCtx = m.context; return m.session; });
    step("mergeTripPlanningContext", (s) => M("src/lib/ai/trip-planning-context.ts").mergeTripPlanningContext(t, s, mergedCtx ?? s.travelContext).session);
    step("extractPlanningHintsFromText", (s) => M("src/lib/chat-session.ts").extractPlanningHintsFromText(t, s));
    step("extractDiscoveryFromText", (s) => M("src/lib/chat-session.ts").extractDiscoveryFromText(t, s));
    step("extractChatPlanningContextFromText", (s) => M("src/lib/chat-planning-flow.ts").extractChatPlanningContextFromText(t, s));
    const arb = safeCall(() => M("src/lib/ai/recommendation-refinement/arbitrate.ts").resolveChatIntentArbitration(t, ns));
    info("D-send", `「${t}」mergedCtx.destination=${JSON.stringify(mergedCtx?.destination ?? null)} route=${arb?.route ?? arb}`, steps);
    const active = { ...ns, travelContext: { ...(ns.travelContext ?? {}), destination: "京都", tripPurpose: "more_place_recommendations" } };
    const cat = safeCall(() => crs.resolveActiveCategoryIntent(active)) ?? active.activeCategoryIntent;
    info("D-send-plan", `「${t}」pushMore 的 categoryIntent／plan（turnStart=S0、requested=金澤）`, { cat: cat ?? null, plan: geo.planDestinationSwitchPending({ userText: t, requestedDestination: "金澤", turnStartSession: S0, categoryIntent: cat })?.rawGeographicLabel ?? null });
    const rr = M("src/lib/ai/chat-recommendation-refresh.ts");
    const reset = safeCall(() => M("src/lib/ai/trip-planning-session-reset.ts").isNewTripPlanning(S0, t));
    const L9847 = Boolean(ns.activeRecommendationContext || ns.recommendationSession || safeCall(() => crs.resolveActiveCategoryIntent(ns)));
    const refreshed = safeCall(() => rr.applyRefreshRecommendationSession(t, ns));
    const refreshedCat = typeof refreshed === "object" ? (safeCall(() => crs.resolveActiveCategoryIntent(refreshed)) ?? refreshed.activeCategoryIntent ?? null) : refreshed;
    info("D-send-branch", `「${t}」isNewTripPlanning／refetch 分支／L9943 後 categoryIntent`, {
      isNewTripPlanning: reset,
      arc: ns.activeRecommendationContext?.destinationName ?? null,
      shouldRefetch: safeCall(() => rr.shouldRefetchPlaces(t, ns, ns.travelContext ?? {}, [])),
      takesL9847: L9847,
      afterRefreshCat: refreshedCat,
      afterRefreshRec: typeof refreshed === "object" ? (refreshed.recommendationSession?.destination ?? null) : null,
      planAtL9977: geo.planDestinationSwitchPending({ userText: t, requestedDestination: "金澤", turnStartSession: S0, categoryIntent: typeof refreshedCat === "string" ? refreshedCat : undefined })?.rawGeographicLabel ?? null,
    });
  }
}

restore();
check("X-1", "外部請求次數", ext(), 0);
const text = [...lines, `mp25-post（A2-MP-T12 純函式探針）：${fail === 0 ? "PASS" : "FAIL"} ${pass}/${pass + fail}`].join("\n");
console.log(text);
if (out) writeFileSync(out, `${text}\n`);
process.exit(fail === 0 ? 0 : 1);
