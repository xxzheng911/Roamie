#!/usr/bin/env node
/**
 * T27 輔助探針（唯讀）：列出各輸入在 work（或 VERIFY_ROOT 指定樹）的 lib 判定，不呼叫任何 provider。
 * 執行：npx vite-node scripts/verify-destination-authority-phase2-probe.mjs --config scripts/vite.verify.config.mjs
 */
globalThis.fetch = async (u) => {
  throw new Error(`[fetch-trap] ${String(u).slice(0, 80)}`);
};
const ROOT = process.env.VERIFY_ROOT || "/Users/shuo/Roamie-clean";
const orig = console.log;
for (const k of ["info", "warn", "debug", "log", "error"]) console[k] = () => {};
const dtp = await import(`${ROOT}/src/lib/ai/destination-travel-profile.ts`);
const tpc = await import(`${ROOT}/src/lib/ai/trip-planning-context.ts`);
const tc = await import(`${ROOT}/src/lib/ai/travel-context.ts`);
const cat = await import(`${ROOT}/src/lib/ai/chat-category-destination.ts`);
let dr = null;
try {
  dr = await import(`${ROOT}/src/lib/ai/destination-resolution.ts`);
} catch {
  dr = null;
}
const texts = [
  "京都看楓葉", "北海道滑雪", "沖繩潛水", "奈良看鹿", "金澤看兼六園", "花蓮泛舟", "香港跑馬地",
  "台南看西街教會", "新竹潛園", "千葉釣崎海岸", "東京玩具美術館", "台北士林夜市", "京都推薦景點",
  "京都三天行程", "大阪推薦景點", "再推薦幾個", "京都冷門景點", "埔里咖啡廳", "台中西屯美食",
  "里斯本推薦景點", "京都看楓葉推薦景點", "奈良看鹿景點推薦", "香港跑馬地美食", "台中西屯推薦景點",
];
const s = { recommendedPlaces: [], selectedPlaces: [], phase: "discover", discovery: {}, updatedAt: "2026-01-01T00:00:00.000Z" };
for (const t of texts) {
  const m = tc.mergeTravelContext(s, t);
  const row = {
    t,
    ctxDest: m.context.destination ?? null,
    cand: m.context.destinationCandidate?.status ?? null,
    clar: Boolean(m.context.destinationClarification),
    prov: dtp.extractProvisionalDestinationAreaCandidate(t)?.areaCandidate ?? null,
    generic: dtp.extractGenericDestinationAreaCandidate?.(t)?.displayLabel ?? null,
    scope: dtp.resolveDestinationAreaScope(t)?.displayLabel ?? null,
    fromText: tpc.resolveDestinationFromText(t) ?? null,
    catSearch: cat.resolveDestinationForCategorySearch(m.context, m.session, t) ?? null,
  };
  if (dr) {
    const r = dr.resolveDestination({ text: t });
    row.res = `${r.confidence}/${r.source}/dest=${r.destination ?? ""}/raw=${r.rawLabel ?? ""}/area=${r.areaCandidate?.area ?? ""}/parent=${r.areaCandidate?.parentCity ?? ""}`;
  }
  orig(JSON.stringify(row));
}
process.exit(0);
