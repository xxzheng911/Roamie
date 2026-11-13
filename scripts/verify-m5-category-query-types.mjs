/**
 * M5 (tester, independent) — category recommendation queries sent to Google Places (spec B).
 *   - 博物館／景點／購物：查詢用對應類型（museum / tourist_attraction / store 類），任何一筆都不得帶 restaurant。
 *   - 餐廳／咖啡廳／菜系：與 HEAD 完全相同（query、mode、includedTypes、順序）。
 *   - attempt 數不得比 HEAD 多（每則文字、每個目的地）。
 * The route's path: parseChatPlaceIntents(text) → buildChatPlaceSearchAttempts(intent, destination, text)
 * (primary + fallback); plus buildPlaceRecommendationQueries direct inputs.
 * HEAD: `-- --head-dir=<snapshot>` re-runs the collection in the snapshot (--child) and compares.
 * Run: node scripts/verify-d4-watchdog.mjs --timeout=300 scripts/verify-m5-category-query-types.mjs -- --head-dir=<snapshot>
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);
const CHILD = argv.includes("--child");
const headDir = argv.find((a) => a.startsWith("--head-dir="))?.slice(11);
const out = console.log.bind(console);
for (const k of ["log", "info", "warn", "debug"]) console[k] = () => {};
setTimeout(() => { out("FAIL watchdog"); process.exit(3); }, 250_000).unref();
let fetchCalls = 0;
globalThis.fetch = async (...a) => { fetchCalls++; throw new Error("NO_NETWORK " + String(a[0])); };
const load = (p) => import(/* @vite-ignore */ `/${p}`);
const cpi = await load("src/lib/ai/chat-place-intent.ts");
const q = await load("src/lib/ai/place-recommendation-intent/queries.ts");

const TEXTS = {
  restaurant: ["推薦餐廳", "推薦雪梨的餐廳", "想吃拉麵", "推薦燒肉", "便宜的拉麵", "晚餐想吃壽司", "推薦居酒屋", "ramen please", "おすすめのラーメン", "맛집 추천", "推薦義大利麵", "推薦火鍋", "推薦平價燒肉晚餐", "restaurant recommendations", "レストランおすすめ", "식당 추천"],
  cafe: ["推薦咖啡廳", "有插座的咖啡廳", "安靜的咖啡廳", "有沙發的咖啡廳", "cafe recommendation", "カフェおすすめ", "카페 추천", "有甜點的咖啡廳"],
  museum: ["推薦博物館", "推薦美術館", "推薦雪梨的博物館", "museum recommendation", "museums", "博物館おすすめ", "美術館おすすめ", "박물관 추천", "미술관 추천", "不去海邊了，改去博物館", "改去博物館"],
  attraction: ["推薦景點", "必去景點", "文化景點", "夜景推薦", "親子景點", "attractions", "観光スポットおすすめ", "관광지 추천", "室內景點", "下雨天去哪", "雨天景點"],
  shopping: ["推薦百貨公司", "推薦購物", "outlet", "推薦藥妝店", "推薦 outlet 和百貨公司", "想買衣服", "推薦商場", "推薦伴手禮", "電器行推薦", "推薦唐吉訶德", "shopping", "ショッピングおすすめ", "쇼핑 추천", "不去海邊了，改去購物"],
};
const DIRECT = [
  { primaryType: "restaurant", subtypes: ["ramen"] }, { primaryType: "restaurant", subtypes: [] }, { primaryType: "general_place", subtypes: ["bbq"] },
  { primaryType: "cafe", subtypes: [], preferredFeatures: ["power_outlet"] }, { primaryType: "restaurant", subtypes: ["sushi"], budget: "cheap", mealSlot: "dinner" },
  { primaryType: "attraction", subtypes: ["culture"] }, { primaryType: "attraction", subtypes: ["culture", "ramen"] }, { primaryType: "indoor", subtypes: ["rainy_day"], indoorOnly: true },
  { primaryType: "shopping", subtypes: ["department_store"] }, { primaryType: "shopping", subtypes: ["department_store", "outlet"] }, { primaryType: "shopping", subtypes: ["department_store", "outlet", "drugstore", "souvenir"] },
  { primaryType: "shopping", subtypes: [] }, { primaryType: "shopping", subtypes: ["ramen"] }, { primaryType: "attraction", subtypes: [] }, { primaryType: "nightlife", subtypes: [] },
];
const DESTS = ["雪梨", "東京", "札幌", "Sydney", "シドニー", "시드니"];

function collect() {
  const R = {};
  for (const [family, list] of Object.entries(TEXTS)) for (const t of list) for (const dest of DESTS) {
    const intents = cpi.parseChatPlaceIntents(t);
    for (const intent of intents.length ? intents : ["(none)"]) {
      if (intent === "(none)") { R[`${family}|${dest}|${t}|(none)`] = { intent, attempts: [] }; continue; }
      const r = cpi.buildChatPlaceSearchAttempts(intent, dest, t);
      R[`${family}|${dest}|${t}|${intent}`] = { intent, attempts: [...(r.primary ?? []), ...(r.fallback ?? [])].map((a) => ({ query: a.query, mode: a.mode, includedTypes: a.includedTypes ?? [] })) };
    }
  }
  for (const d of DIRECT) R[`direct|${JSON.stringify(d)}`] = { intent: d.primaryType, attempts: q.buildPlaceRecommendationQueries({ destination: "雪梨", ...d }).map((a) => ({ query: a.query, mode: a.mode, includedTypes: a.includedTypes ?? [] })) };
  return R;
}

if (CHILD) {
  process.stdout.write(`@@M5Q@@${JSON.stringify(collect())}@@END@@\n`, () => process.exit(0));
  await new Promise(() => {});
}

const W = collect();
let H = null;
if (headDir) {
  const self = "scripts/verify-m5-category-query-types.mjs";
  if (!existsSync(join(headDir, self)) || readFileSync(join(headDir, self), "utf8") !== readFileSync(self, "utf8")) copyFileSync(self, join(headDir, self));
  const r = spawnSync("npx", ["vite-node", self, "--config", "scripts/vite.verify.config.mjs", "--", "--child"], { cwd: headDir, encoding: "utf8", timeout: 200_000, maxBuffer: 64 << 20 });
  const m = (r.stdout ?? "").match(/@@M5Q@@([\s\S]*?)@@END@@/);
  if (m) H = JSON.parse(m[1]); else out(`NOTE HEAD child produced no JSON (status ${r.status}) ${(r.stderr ?? "").slice(-500)}`);
}
const failures = [];
const check = (name, fn) => { try { fn(); out(`PASS ${name}`); } catch (e) { failures.push(name); out(`FAIL ${name}\n  ${String(e?.message ?? e).split("\n").slice(0, 8).join("\n  ")}`); } };
const flat = (v) => (v?.attempts ?? []).map((a) => `${a.query} [${a.includedTypes.join(",")}]`).join(" | ");
const ATTRACTION_TYPES = /tourist_attraction|museum|art_gallery/;
const STORE_TYPES = /shopping_mall|department_store|clothing_store|store/;
check("HEAD comparison available", () => assert.ok(H, "run with -- --head-dir=<snap-HEAD>"));
let same = 0; const changed = [];
for (const key of Object.keys(W)) {
  const w = W[key]; const h = H?.[key];
  const [family] = key.split("|");
  const isDirect = family === "direct";
  const directType = isDirect ? JSON.parse(key.slice(7)).primaryType : null;
  const unchangedFamily = isDirect ? ["restaurant", "cafe", "general_place", "nightlife"].includes(directType) || /"ramen"|"sushi"|"bbq"/.test(key) : ["restaurant", "cafe"].includes(family);
  const routedFamily = isDirect ? ["attraction", "indoor", "shopping"].includes(directType) && !/"ramen"/.test(key) : ["museum", "attraction", "shopping"].includes(family);
  if (h && JSON.stringify(w) === JSON.stringify(h)) same++; else if (h) changed.push(key);
  if (unchangedFamily && h) check(`unchanged ${key}`, () => assert.deepEqual(w, h, `WORK ${flat(w)}\n  HEAD ${flat(h)}`));
  if (routedFamily && w.intent !== "(none)" && ["attraction", "shopping", "indoor", "night_market"].includes(w.intent) || (isDirect && routedFamily)) {
    check(`types ${key}`, () => {
      for (const a of w.attempts) assert.ok(!a.includedTypes.includes("restaurant"), `restaurant in includedTypes: ${a.query} [${a.includedTypes}]\n  WORK ${flat(w)}`);
      const wantStore = (isDirect ? directType : w.intent) === "shopping";
      if (w.attempts.length) assert.ok(w.attempts.some((a) => (wantStore ? STORE_TYPES : ATTRACTION_TYPES).test(a.includedTypes.join(","))), `no ${wantStore ? "store" : "attraction/museum"} type\n  WORK ${flat(w)}`);
      if (h) assert.ok(w.attempts.length <= h.attempts.length, `attempts ${w.attempts.length} > HEAD ${h.attempts.length}\n  WORK ${flat(w)}\n  HEAD ${flat(h)}`);
    });
  }
}
// The museum family must be routed as attraction / museum in all four locales (not left to the restaurant branch).
for (const t of TEXTS.museum) check(`museum 「${t}」 resolves to a non-restaurant category on 雪梨`, () => {
  const rows = Object.entries(W).filter(([k]) => k.startsWith(`museum|雪梨|${t}|`));
  assert.ok(rows.length, "no rows");
  for (const [k, v] of rows) for (const a of v.attempts) assert.ok(!a.includedTypes.includes("restaurant"), `${k}: ${a.query} [${a.includedTypes}]`);
});
out(`INFO same as HEAD: ${same}, changed: ${changed.length}`);
for (const k of changed) out(`CHANGED ${k}\n  WORK ${flat(W[k])}\n  HEAD ${flat(H[k])}`);
check("no network: fetch=0", () => assert.equal(fetchCalls, 0));
out(failures.length ? `\nFAIL ${failures.length} check(s): ${failures.join(" | ")}` : "\nPASS all");
process.exit(failures.length ? 1 : 0);
