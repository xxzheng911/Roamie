#!/usr/bin/env node
import "./verify-netguard-full.mjs";
/**
 * #TS-PE 回歸：未簽名照片網址（A）與探索「全部」0 件（B）。
 * 執行：node scripts/verify-unsigned-photo-and-explore-all.mjs
 *
 * B（node）：同一個 esbuild bundle 內同時載入「工作區版」與「修正前版（6436781^，下文舊稱 HEAD 版）」explore-category-search（以 git show 讀取，
 *   不 checkout／不 stash；共用同一份 explore-request-session 等相依模組；import.meta.env 定義為正式版），
 *   以 map.tsx scopedSearchPlacesFn 同樣的 assertExploreSessionActive + 模擬 places-api-guard 計數驅動。
 *   不打任何真實 Google／Supabase。
 * A（headless Chrome）：實際 render SavedPlaceCoverThumb／PlaceImage／FadeInImage，攔截 fetch 與 <img> src，
 *   本機 server 記錄所有 /api/place-photo GET，證明 0 個未簽名 GET。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL " + name + "\n     " + (e?.stack || e).toString().split("\n").slice(0, 4).join("\n     "));
  }
};

// ---------------------------------------------------------------- B. Explore「全部」
// 以 esbuild 打包成 node ESM，define 正式版 import.meta.env（DEV=false／PROD=true）：
// DEV 時 allowDemoPlaceFallback() 會塞入示範地點而掩蓋「0 件」，正式版不會。
// HEAD 版以 git show 讀出、作為虛擬模組放在 src/lib 的 resolveDir，與工作區版共用同一份相依模組。
const { build } = await import("esbuild");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-ts-pe-"));
// 基準改用 explore 修正 commit 的前一版（6436781^）：該修正已 commit 進 HEAD，以 HEAD 為基準無法再重現錯誤。
// 6436781 只改了 explore-category-search.ts 一個檔，因此舊版與工作區其他相依模組相容。
const EXPLORE_BASE_REV = "6436781^";
const oldSrc = execFileSync("git", ["show", `${EXPLORE_BASE_REV}:src/lib/explore-category-search.ts`], { cwd: root, encoding: "utf8" });
const currentSrc = fs.readFileSync(path.join(root, "src/lib/explore-category-search.ts"), "utf8");
if (oldSrc === currentSrc) throw new Error(`基準 ${EXPLORE_BASE_REV} 與工作區 explore-category-search.ts 相同，B 區對照失效`);
const aliasPlugin = {
  name: "alias-and-head",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => b.resolve("./src/" + a.path.slice(2), { resolveDir: root, kind: a.kind }));
    b.onResolve({ filter: /^virtual:head-explore$/ }, () => ({ path: "head-explore", namespace: "head" }));
    b.onLoad({ filter: /.*/, namespace: "head" }, () => ({ contents: oldSrc, loader: "ts", resolveDir: path.join(root, "src/lib") }));
  },
};
await build({
  stdin: {
    contents: `export { searchExploreCategoryPlaces as searchNew } from './src/lib/explore-category-search.ts';
export { searchExploreCategoryPlaces as searchOld } from 'virtual:head-explore';
export * from './src/lib/explore-request-session.ts';
export { normalizeGooglePlace } from './src/lib/ai/normalize-google-place.ts';
export { getExploreCategoryById } from './src/lib/places-search-config.ts';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join(tmp, "explore.mjs"),
  logLevel: "error",
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".jpeg": "dataurl", ".webp": "dataurl", ".svg": "dataurl" },
  // TanStack Start 虛擬入口只在 server function 動態 import 中出現，本測試不會執行
  external: ["#tanstack-router-entry", "#tanstack-start-entry", "tanstack-start-manifest:v"],
  banner: { js: "import {createRequire as __cr} from 'node:module';const require=__cr(import.meta.url);" },
  define: {
    "import.meta.env": JSON.stringify({ DEV: false, PROD: true, SSR: false, MODE: "production", BASE_URL: "/" }),
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [aliasPlugin],
});
const {
  searchNew,
  searchOld,
  beginExploreRequestSession,
  assertExploreSessionActive,
  EXPLORE_BROWSE_PROVIDER_BUDGET,
  EXPLORE_CATEGORY_PROVIDER_BUDGET,
  normalizeGooglePlace,
  getExploreCategoryById,
} = await import(path.join(tmp, "explore.mjs"));

const ALL = getExploreCategoryById("all");
const COFFEE = getExploreCategoryById("coffee");
let seq = 0;
const rawPlace = (center, type, i, extra = {}) => ({
  id: `ChIJ_tspe_${type}_${i}_${++seq}`,
  displayName: { text: `Fixture ${type} ${i}`, languageCode: "en" },
  location: { latitude: center.lat + 0.001 * (i + 1), longitude: center.lng + 0.001 },
  formattedAddress: "Fixture address",
  types: [type, "point_of_interest", "establishment"],
  primaryType: type,
  rating: 4.6,
  userRatingCount: 800,
  businessStatus: "OPERATIONAL",
  regularOpeningHours: { weekdayDescriptions: ["Monday: 00:00–24:00"] },
  ...extra,
});
const places = (center, types) => types.map((t, i) => normalizeGooglePlace(rawPlace(center, t, i), { locale: "en" }));
const GOOD = {
  sight: ["museum", "art_gallery", "tourist_attraction"],
  district: ["shopping_mall", "department_store"],
  food: ["restaurant", "ramen_restaurant"],
  night: ["bar", "night_club"],
};
// coffee 主查詢只回不屬 coffee 的類型 → 過濾後 0。
// 註：本 fixture 的 cake_shop／bakery 會被 normalize 成 bakery 並通過 coffee 篩選（見 [TS-PE] 診斷行），
// 故以 gift_shop（非 coffee）＋ corporate_office／parking_lot（non_visitor_type）重現「coffee 過濾為 0」。
const COFFEE_JUNK = ["gift_shop", "corporate_office", "parking_lot"];
const COFFEE_BAKERY = ["cake_shop", "bakery", "gift_shop"];

/**
 * 與 _app.map.tsx scopedSearchPlacesFn 相同：每次 provider 前 assertExploreSessionActive；
 * 呼叫通過後模擬 places-api-guard 的 session 計數（backgroundRequests／categoryRequests）。
 */
function scopedFn(session, center, opts = {}) {
  const calls = [];
  const fn = async (args) => {
    const cat = args.data.categoryId ?? "all";
    assertExploreSessionActive(session, cat);
    session.backgroundRequests += 1;
    session.categoryRequests.set(cat, (session.categoryRequests.get(cat) ?? 0) + 1);
    calls.push(cat);
    if (opts.onCall) {
      const r = await opts.onCall(cat, calls.length, session);
      if (r !== undefined) return r;
    }
    if (cat === "coffee") return { places: places(center, COFFEE_JUNK), error: null };
    return { places: places(center, GOOD[cat] ?? []), error: null };
  };
  return { fn, calls };
}
const baseCtx = (center, session, searchPlacesFn) => ({
  userLocation: center,
  weather: null,
  locale: "en",
  reasonProfile: null,
  saved: [],
  recommendMode: "nearby",
  requestSession: session,
  searchPlacesFn,
});
let centerSeq = 0;
const nextCenter = () => ({ lat: 35.6 + 0.05 * ++centerSeq, lng: 139.6 + 0.05 * centerSeq });

const logs = [];
const logLevels = new Map();
const origConsole = {};
for (const level of ["log", "info", "debug", "warn", "error"]) {
  origConsole[level] = console[level];
  console[level] = (...a) => {
    if (typeof a[0] === "string" && /^\[EXPLORE_(ALL_SUBCATEGORY_FAILED|EMPTY_RESULT)\]/.test(a[0])) {
      logs.push(a);
      logLevels.set(a[0], level);
    }
    return origConsole[level].apply(console, a);
  };
}
const run = async (search, cat, center, opts) => {
  const session = beginExploreRequestSession("browse");
  const { fn, calls } = scopedFn(session, center, opts);
  const before = logs.length;
  try {
    const out = await search(cat, baseCtx(center, session, fn));
    return { ok: true, out, calls, session, logs: logs.slice(before) };
  } catch (error) {
    return { ok: false, error, calls, session, logs: logs.slice(before) };
  }
};
const families = (cards) => [...new Set(cards.map((c) => c.categoryId ?? c.exploreCategoryId ?? c.primaryType))];

const allNew = await run(searchNew, ALL, nextCenter());
const allOld = await run(searchOld, ALL, nextCenter());
const coffeeNew = await run(searchNew, COFFEE, nextCenter());
const coffeeOld = await run(searchOld, COFFEE, nextCenter());
console.info("[TS-PE] all new:", JSON.stringify({ ok: allNew.ok, count: allNew.out?.length, err: allNew.error?.name, calls: allNew.calls }));
console.info("[TS-PE] all HEAD:", JSON.stringify({ ok: allOld.ok, count: allOld.out?.length, err: allOld.error?.name, calls: allOld.calls }));
console.info("[TS-PE] coffee new:", JSON.stringify({ ok: coffeeNew.ok, count: coffeeNew.out?.length, err: coffeeNew.error?.name, calls: coffeeNew.calls }));
console.info("[TS-PE] coffee HEAD:", JSON.stringify({ ok: coffeeOld.ok, count: coffeeOld.out?.length, err: coffeeOld.error?.name, calls: coffeeOld.calls }));

{
  for (const junk of [COFFEE_JUNK, COFFEE_BAKERY]) {
    const c = nextCenter();
    const out = await searchNew(COFFEE, { ...baseCtx(c, undefined, async () => ({ places: places(c, junk), error: null })) }).catch((e) => e);
    console.info(`[TS-PE] coffee（無 session、${junk.join("/")}）篩選後：`, Array.isArray(out) ? JSON.stringify(out.map((p) => [p.primaryType, p.name, p.types?.join("/")])) : String(out));
  }
  console.info("[TS-PE] all new types:", JSON.stringify(allNew.out?.map((p) => p.primaryType)));
}
await check("B1 修正前版（6436781^）：coffee 額度用完的 AbortError 讓「全部」整個丟出 AbortError（修正前重現）", () => {
  assert.equal(allOld.ok, false, "HEAD 版應丟錯");
  assert.equal(allOld.error?.name, "AbortError");
  assert.deepEqual(allOld.calls, ["coffee", "coffee"], "HEAD 版在 coffee 第 3 次（超過每分類 2 次）即中止");
});
await check("B2 修正後：「全部」略過 coffee，仍回傳其他子分類結果（>0）", () => {
  assert.equal(allNew.ok, true, "不得丟錯：" + allNew.error);
  assert.ok(allNew.out.length > 0, "結果應 > 0");
  assert.ok(allNew.out.every((c) => !COFFEE_JUNK.includes(c.primaryType)), "非訪客型不得回填");
  const types = new Set(allNew.out.map((c) => c.primaryType));
  assert.ok(GOOD.sight.some((t) => types.has(t)), "含 sight 結果：" + [...types]);
  assert.ok(GOOD.food.some((t) => types.has(t)), "含 food 結果：" + [...types]);
});
await check("B3 修正後 log：[EXPLORE_ALL_SUBCATEGORY_FAILED] {category:'coffee', code:'explore_budget'}", () => {
  const failed = allNew.logs.filter((l) => l[0] === "[EXPLORE_ALL_SUBCATEGORY_FAILED]").map((l) => l[1]);
  assert.deepEqual(failed.find((p) => p.category === "coffee"), { category: "coffee", code: "explore_budget" });
});
await check("B4 修正後 Google 呼叫：總數 ≤ 10、每分類 ≤ 2，session 上限常數不變（10／2）", () => {
  assert.equal(EXPLORE_BROWSE_PROVIDER_BUDGET, 10);
  assert.equal(EXPLORE_CATEGORY_PROVIDER_BUDGET, 2);
  assert.ok(allNew.calls.length <= 10, "calls=" + allNew.calls.length);
  const per = {};
  for (const c of allNew.calls) per[c] = (per[c] ?? 0) + 1;
  for (const [c, n] of Object.entries(per)) assert.ok(n <= 2, `${c}=${n}`);
  assert.deepEqual(Object.keys(per), ["coffee", "sight", "district", "food", "night"].filter((c) => per[c]), "依序 coffee→sight→district→food→night");
});
await check("B5 單一分類 coffee 同條件：新舊版行為與呼叫次數完全相同（皆丟 AbortError、2 次）", () => {
  assert.equal(coffeeNew.ok, false);
  assert.equal(coffeeOld.ok, false);
  assert.equal(coffeeNew.error?.name, "AbortError");
  assert.equal(coffeeOld.error?.name, "AbortError");
  assert.deepEqual(coffeeNew.calls, coffeeOld.calls);
  assert.equal(coffeeNew.calls.length, 2);
});

// 補查遇額度用完保留已得結果：sight 主查詢 1 筆、補查 1 筆，第 3 次（補查）被額度擋下 → 保留 2 筆
await check("B6 補查遇額度用完保留已得結果（sight 2 筆在第 3 次補查被擋後仍出現在「全部」）", async () => {
  const center = nextCenter();
  const r = await run(searchNew, ALL, center, {
    onCall: (cat, _n, session) => {
      if (cat !== "sight") return undefined;
      const k = session.categoryRequests.get("sight");
      return { places: places(center, [k === 1 ? "museum" : "art_gallery"]), error: null };
    },
  });
  assert.equal(r.ok, true, String(r.error));
  const sightCards = r.out.filter((c) => ["museum", "art_gallery"].includes(c.primaryType));
  assert.equal(sightCards.length, 2, "sight 已得 2 筆需保留：" + r.out.map((c) => c.primaryType));
  assert.ok(!r.logs.some((l) => l[0] === "[EXPLORE_ALL_SUBCATEGORY_FAILED]" && l[1].category === "sight"), "sight 不應記為失敗");
});

await check("B6b coffee 只有 bakery 部分結果、補查被額度擋下：「全部」保留 coffee 已得結果（修正前版 6436781^ 整個 AbortError）", async () => {
  const onCall = (cat) => (cat === "coffee" ? { places: places(center6b, COFFEE_BAKERY), error: null } : undefined);
  const center6b = nextCenter();
  const a = await run(searchNew, ALL, center6b, { onCall });
  assert.equal(a.ok, true, String(a.error));
  assert.ok(a.out.some((c) => c.primaryType === "bakery"), "coffee 已得 bakery 需保留");
  const b = await run(searchOld, ALL, nextCenter(), { onCall: (cat) => (cat === "coffee" ? { places: places(center6b, COFFEE_BAKERY), error: null } : undefined) });
  assert.equal(b.error?.name, "AbortError", "HEAD 版重現");
});

await check("B7 真正取消：session 中途 abort → 新舊版「全部」皆丟 AbortError、呼叫序列相同（不變）", async () => {
  for (const at of ["coffee", "sight"]) {
    const center = nextCenter();
    const onCall = (cat, _n, session) => {
      if (cat === at) {
        session.controller.abort();
        throw new DOMException("Search superseded", "AbortError");
      }
      return cat === "coffee" ? { places: places(center, COFFEE_BAKERY), error: null } : undefined;
    };
    const a = await run(searchNew, ALL, center, { onCall });
    assert.equal(a.ok, false, at);
    assert.equal(a.error?.name, "AbortError", at);
    assert.ok(!a.logs.some((l) => l[1]?.code === "explore_budget"), "取消不得記為 explore_budget");
    if (at === "coffee") {
      const b = await run(searchOld, ALL, nextCenter(), { onCall });
      assert.equal(b.error?.name, "AbortError", "HEAD");
      assert.deepEqual(a.calls, b.calls, "取消前呼叫序列相同");
    }
    assert.ok(!a.calls.slice(a.calls.indexOf(at) + 1).length, "取消後不得再呼叫：" + a.calls);
  }
});

await check("B8 逾時：places_search_attempt_timeout 新舊版皆中止「全部」；places_timeout 修正後同樣中止", async () => {
  const mk = (code) => (cat) => {
    if (cat === "coffee") throw new Error(code);
    return undefined;
  };
  const n1 = await run(searchNew, ALL, nextCenter(), { onCall: mk("places_search_attempt_timeout") });
  const o1 = await run(searchOld, ALL, nextCenter(), { onCall: mk("places_search_attempt_timeout") });
  assert.equal(n1.error?.message, "places_search_attempt_timeout");
  assert.equal(o1.error?.message, "places_search_attempt_timeout");
  assert.deepEqual(n1.calls, o1.calls);
  const n2 = await run(searchNew, ALL, nextCenter(), { onCall: mk("places_timeout") });
  const o2 = await run(searchOld, ALL, nextCenter(), { onCall: mk("places_timeout") });
  assert.equal(n2.error?.message, "places_timeout", "修正後 places_timeout 視為逾時");
  console.info("     （資訊）HEAD 版 places_timeout：", o2.ok ? `略過 sight、回傳 ${o2.out.length} 筆` : `丟出 ${o2.error?.message}`);
});

await check("B9 診斷 log 不含座標、URL、token", () => {
  const all = logs.map((l) => JSON.stringify(l[1] ?? {}));
  assert.ok(all.length > 0);
  for (const s of all) {
    assert.doesNotMatch(s, /lat|lng|http|token|key|\d+\.\d{3,}/i, s);
  }
  const empties = logs.filter((l) => l[0] === "[EXPLORE_EMPTY_RESULT]").map((l) => Object.keys(l[1]).sort().join(","));
  console.info("     （資訊）EXPLORE_EMPTY_RESULT 欄位：", [...new Set(empties)].join(" | ") || "（本輪未觸發）");
});

await check("B10 全部子分類 0 件且 coffee 額度用完：「全部」不得以 AbortError（取消）收場，並印 [EXPLORE_EMPTY_RESULT]", async () => {
  const r = await run(searchNew, ALL, nextCenter(), {
    onCall: (cat, _n, _s) => (cat === "coffee" ? undefined : { places: [], error: null }),
  });
  const empty = r.logs.find((l) => l[0] === "[EXPLORE_EMPTY_RESULT]" && l[1].category === "all");
  assert.ok(empty, "應印 [EXPLORE_EMPTY_RESULT] category=all");
  assert.ok(r.ok, `「全部」丟出 ${r.error?.name}：${r.error?.message}（map.tsx L1289 會把 AbortError 當取消靜默）`);
  assert.deepEqual(r.out, []);
});

// B13 真的 provider 錯誤與額度用完混合、「全部」最終 0 件：
//   HEAD 語意（無額度用完時）是「0 件＋provider 錯誤 → 丟 provider 錯誤（錯誤畫面）」；額度用完不應把它蓋成空結果。
//   兩種順序都測：(a) 額度先用完（coffee）、provider 錯誤在後（sight）；(b) provider 錯誤在前（sight）、額度用完在後（night）。
await check("B13 provider 錯誤＋額度用完混合且 0 件：不論先後，「全部」都應丟出 provider 錯誤（不得被額度用完蓋成空結果）", async () => {
  const outcome = async (budgetLast) => {
    const r = await run(searchNew, ALL, nextCenter(), {
      onCall: (cat, _n, session) => {
        if (cat === "coffee") return budgetLast ? { places: [], error: null } : undefined; // undefined → COFFEE_JUNK，第 3 次被額度擋
        if (cat === "sight") return { places: [], error: "places_http_500" };
        if (cat === "food" && budgetLast) session.categoryRequests.set("night", EXPLORE_CATEGORY_PROVIDER_BUDGET);
        return { places: [], error: null };
      },
    });
    const codes = r.logs.filter((l) => l[0] === "[EXPLORE_ALL_SUBCATEGORY_FAILED]").map((l) => `${l[1].category}:${l[1].code}`);
    return { r, codes, desc: r.ok ? `回傳 ${r.out.length} 筆` : `丟出 ${r.error?.name}:${r.error?.message}` };
  };
  // (c) 對照：provider 以「丟出」網路錯誤（非 result.error）全面失敗 → 應丟出網路錯誤（map.tsx 顯示離線）
  const c = await run(searchNew, ALL, nextCenter(), { onCall: () => { throw new TypeError("Failed to fetch"); } });
  console.info("     （資訊）(c) 全面丟出網路錯誤：", c.ok ? `回傳 ${c.out.length} 筆` : `丟出 ${c.error?.name}:${c.error?.message}`, "calls=" + c.calls.join(","));
  assert.equal(c.error?.message, "Failed to fetch", "(c) 網路錯誤不得被吞成空結果");
  const a = await outcome(false);
  const b = await outcome(true);
  console.info("     （資訊）(a) 額度先、錯誤後：", a.desc, a.codes.join(","), "calls=" + a.r.calls.join(","));
  console.info("     （資訊）(b) 錯誤先、額度後：", b.desc, b.codes.join(","), "calls=" + b.r.calls.join(","));
  assert.ok(a.codes.some((c) => c.endsWith(":explore_budget")), "(a) 前提：確實有子分類額度用完");
  assert.ok(b.codes.some((c) => c === "night:explore_budget"), "(b) 前提：night 額度用完");
  assert.equal(a.r.error?.message, "places_http_500", "(a) " + a.desc);
  assert.equal(b.r.error?.message, "places_http_500", "(b) " + b.desc + "（providerFailure 只記最後一個錯誤，最後是額度 AbortError → 回空結果）");
});

await check("B12 單一分類 district（無 session，verify-explore-semantic-eligibility 同型態）新舊版皆在 20 秒內完成且結果相同", async () => {
  const DISTRICT = getExploreCategoryById("district");
  const runOne = async (search) => {
    const center = nextCenter();
    let calls = 0;
    const p = search(DISTRICT, {
      ...baseCtx(center, undefined, async () => {
        calls++;
        return { places: places(center, ["corporate_office"]), error: null };
      }),
    });
    const r = await Promise.race([p.then((v) => ({ v }), (e) => ({ e })), new Promise((r) => setTimeout(() => r({ hang: true }), 20000).unref())]);
    return { ...r, calls };
  };
  const n = await runOne(searchNew);
  const o = await runOne(searchOld);
  assert.ok(!n.hang, "工作區版卡住");
  assert.ok(!o.hang, "HEAD 版卡住");
  assert.equal(n.calls, o.calls);
  assert.deepEqual(n.v?.length, o.v?.length);
});

await check("B11 正式版 log 層級：src/lib/production-logging.ts 在 PROD 把 console.log/info/debug 設為 noop，新 log 必須用 warn/error 才看得到", () => {
  const silencer = fs.readFileSync(path.join(root, "src/lib/production-logging.ts"), "utf8");
  const silenced = ["log", "info", "debug"].filter((l) => new RegExp(`console\\.${l}\\s*=\\s*noop`).test(silencer));
  assert.ok(silenced.length > 0, "production-logging 已不再靜音（此斷言前提失效）");
  for (const tag of ["[EXPLORE_ALL_SUBCATEGORY_FAILED]", "[EXPLORE_EMPTY_RESULT]"]) {
    const level = logLevels.get(tag);
    assert.ok(level, tag + " 本輪未觸發");
    assert.ok(!silenced.includes(level), `${tag} 以 console.${level} 輸出，正式版（PROD WebView）會被 production-logging.ts 靜音`);
  }
});

for (const level of Object.keys(origConsole)) console[level] = origConsole[level];

// ---------------------------------------------------------------- C. image-url-failure-cache（工作區版 vs HEAD 版）
{
  const oldCache = execFileSync("git", ["show", "HEAD:src/lib/image-url-failure-cache.ts"], { cwd: root, encoding: "utf8" });
  await build({
    stdin: {
      contents: `export * as cacheNew from './src/lib/image-url-failure-cache.ts';
export * as cacheOld from 'virtual:head-cache';`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(tmp, "cache.mjs"),
    logLevel: "error",
    plugins: [{
      name: "head-cache",
      setup(b) {
        b.onResolve({ filter: /^virtual:head-cache$/ }, () => ({ path: "head-cache", namespace: "headc" }));
        b.onLoad({ filter: /.*/, namespace: "headc" }, () => ({ contents: oldCache, loader: "ts", resolveDir: path.join(root, "src/lib") }));
      },
    }],
  });
  const { cacheNew, cacheOld } = await import(path.join(tmp, "cache.mjs"));
  const signed = (id, w = 600, sig = "s1", exp = "9999999999", origin = "") =>
    `${origin}/api/place-photo?photo=${encodeURIComponent(`places/ChIJ_c_${id}/photos/p1`)}&w=${w}&expires=${exp}&signature=${sig}`;
  await check("C1 HEAD 版重現：一張 proxy 照片失敗 → 另一張不同照片也被判失敗（修正前）", () => {
    cacheOld.markImageLoadFailed(signed("a"));
    assert.equal(cacheOld.isImageLoadFailed(signed("b")), true);
  });
  await check("C2 修正後：不同照片互不影響；同照片換 signature／expires／origin 仍視為同一失敗", () => {
    cacheNew.markImageLoadFailed(signed("a"));
    assert.equal(cacheNew.isImageLoadFailed(signed("b")), false, "不同 photo 不得被污染");
    assert.equal(cacheNew.isImageLoadFailed(signed("a", 600, "s2", "1111111111")), true, "換簽名仍同一失敗");
    assert.equal(cacheNew.isImageLoadFailed(signed("a", 600, "s1", "9999999999", "https://roamie.tw")), true, "絕對／相對 URL 同一失敗");
    assert.equal(cacheNew.isImageLoadFailed(`/api/place-photo?photo=${encodeURIComponent("places/ChIJ_c_a/photos/p1")}&w=600`), true, "未簽名同照片同寬度亦同 key");
  });
  await check("C3 修正後：同照片不同寬度各自獨立（w=600 失敗不影響 w=256）", () => {
    cacheNew.markImageLoadFailed(signed("w", 600));
    assert.equal(cacheNew.isImageLoadFailed(signed("w", 256)), false);
    assert.equal(cacheNew.isImageLoadFailed(signed("w", 600, "other")), true);
  });
  await check("C4 clearImageLoadFailure 對應：以同一 URL 清除 → 同照片任何簽名皆解除；不影響其他照片的失敗", () => {
    cacheNew.markImageLoadFailed(signed("c1"));
    cacheNew.markImageLoadFailed(signed("c2"));
    cacheNew.clearImageLoadFailure(signed("c1"));
    assert.equal(cacheNew.isImageLoadFailed(signed("c1")), false);
    assert.equal(cacheNew.isImageLoadFailed(signed("c1", 600, "fresh", "2222222222")), false, "新簽名也應解除");
    assert.equal(cacheNew.isImageLoadFailed(signed("c2")), true, "其他照片失敗應保留");
    // 已知（與 HEAD 非 proxy 網址相同的既有語意）：mark 時也存原字串，若以「另一組簽名」clear，原字串仍在 → 原 URL 仍判失敗。
    cacheNew.markImageLoadFailed(signed("c3"));
    cacheNew.clearImageLoadFailure(signed("c3", 600, "fresh", "2222222222"));
    console.info("     （資訊）以不同簽名 clear 後原 URL 仍失敗：", cacheNew.isImageLoadFailed(signed("c3")), "／新簽名：", cacheNew.isImageLoadFailed(signed("c3", 600, "fresh", "2222222222")));
  });
  await check("C5 非 proxy 網址行為與 HEAD 相同（去 query、不分大小寫）", () => {
    const urls = ["https://x.supabase.co/storage/v1/object/public/c/Trip.JPG?token=abc", "/fixture-cover.png?v=3"];
    const probes = [
      "https://x.supabase.co/storage/v1/object/public/c/trip.jpg?token=zzz",
      "https://x.supabase.co/storage/v1/object/public/c/other.jpg",
      "/fixture-cover.png",
      "/fixture-cover.png?v=9",
      "/fixture-other.png",
    ];
    for (const u of urls) {
      cacheNew.markImageLoadFailed(u);
      cacheOld.markImageLoadFailed(u);
    }
    for (const p of probes) assert.equal(cacheNew.isImageLoadFailed(p), cacheOld.isImageLoadFailed(p), p);
    cacheNew.clearImageLoadFailure("/fixture-cover.png?v=1");
    cacheOld.clearImageLoadFailure("/fixture-cover.png?v=1");
    for (const p of probes) assert.equal(cacheNew.isImageLoadFailed(p), cacheOld.isImageLoadFailed(p), "clear 後 " + p);
  });
  await check("C6 photo 參數缺漏的 proxy 網址以整串 URL 為 key（不會讓所有缺 photo 的網址互相污染）", () => {
    cacheNew.markImageLoadFailed("/api/place-photo?w=600&x=1");
    assert.equal(cacheNew.isImageLoadFailed("/api/place-photo?w=600&x=2"), false);
    assert.equal(cacheNew.isImageLoadFailed(signed("unrelated")), false);
  });
}

// ---------------------------------------------------------------- A. 照片（headless Chrome）
const photo = (id) => `places/ChIJ_tspe_${id}/photos/first`;
const unsignedUrl = (id, w = 600) => `/api/place-photo?photo=${encodeURIComponent(photo(id))}&w=${w}`;
const mocks = {
  "@/integrations/supabase/client": `export const supabase={auth:{getSession:async()=>({data:{session:null}})}};export const isSupabaseConfigured=()=>false;`,
  "@/lib/api-url": `export const resolveApiUrl=url=>new URL(url,window.location.origin).href;`,
  "@/lib/pie/places-gateway": `export const getPlaceDetailsServerFnViaGateway=async()=>{window.discoveryCalls++;throw Error('unexpected discovery')};`,
  "@/services/unsplashService": `export const searchUnsplashImage=async()=>null;export const searchUnsplashWithQueries=async()=>null;export const searchUnsplashCoverQueries=async()=>null;`,
  "@/lib/google-maps-client": `export const buildPlacePhotoUrl=(photo,w)=>'/api/place-photo?photo='+encodeURIComponent(photo)+'&w='+w;`,
  "@/lib/app-perf": `export const logPerfImageLoad=()=>{};export const logPerfProfileLoadSkip=()=>{};export const logPerfTravelPrefLoadSkip=()=>{};`,
  "@/hooks/use-in-viewport": `export const useInViewport=()=>true;`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {SavedPlaceCoverThumb} from './src/components/saved/SavedPlaceCoverThumb';
import {PlaceImage} from './src/components/media/PlaceImage';
import {PlaceCoverImage} from './src/components/media/PlaceCoverImage';
import {FadeInImage} from './src/components/media/FadeInImage';
import {writePlaceRuntimeCache} from './src/lib/place-runtime-cache';
import {prefetchPlaceCoverUrls} from './src/services/image-cache';
const photo=${photo.toString()};const unsigned=${unsignedUrl.toString()};
window.mountSeq=0;window.discoveryCalls=0;window.signCalls=[];window.imgSrcs=[];window.newImages=[];const errors=[];
window.addEventListener('unhandledrejection',e=>{errors.push(String(e.reason));e.preventDefault()});
// 記錄每一次 <img>/Image() 的 src 指派（含尚未送出就被換掉的）
const desc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,get(){return desc.get.call(this)},set(v){window.imgSrcs.push(String(v));return desc.set.call(this,v)}});
const origSetAttr=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){if(this instanceof HTMLImageElement&&n==='src')window.imgSrcs.push(String(v));return origSetAttr.call(this,n,v)};
const OrigImage=window.Image;window.Image=function(...a){const i=new OrigImage(...a);window.newImages.push(i);return i};
let failPhotos=new Set();const pending=new Map();let manual=false;
window.fetch=async(url,init)=>{url=String(url);if(!url.includes('/api/place-photo/sign'))throw Error('Unexpected request '+url);
 const body=JSON.parse(init.body);window.signCalls.push(body.photo+'@'+body.width);
 const respond=()=>failPhotos.has(body.photo)?{ok:false,status:503,headers:new Headers(),json:async()=>({})}:{ok:true,status:200,headers:new Headers(),json:async()=>({url:'/api/place-photo?photo='+encodeURIComponent(body.photo)+'&w='+body.width+'&expires=9999999999&signature=fixture'})};
 if(!manual)return respond();return new Promise(r=>pending.set(body.photo,()=>r(respond())));};
const root=createRoot(document.getElementById('root'));
const tick=()=>new Promise(r=>setTimeout(r,20));
const until=async(fn,msg)=>{for(let i=0;i<200;i++){if(fn())return;await tick();}throw Error('timeout: '+msg);};
const unsignedAssigned=()=>window.imgSrcs.filter(s=>s.includes('/api/place-photo?')&&!/[?&]signature=/.test(s));
const reset=()=>{window.imgSrcs.length=0;window.signCalls.length=0;window.newImages.length=0;};
const imgIn=sel=>document.querySelector(sel+' img');
window.run=async()=>{const out={};
 // A1 收藏：cover_image 為未簽名 w=600，無 metadata.photoName
 reset();root.render(<div key={'k'+(++window.mountSeq)} data-c="a1" style={{width:64,height:64}}><SavedPlaceCoverThumb place={{id:'s1',name:'s1',category:'cafe',metadata:{},cover_image:unsigned('cover'),image_url:null}}/></div>);
 await until(()=>imgIn('[data-c=a1]')?.src.includes('signature='),'A1 signed');
 out.a1={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A2 runtime cache 只有 coverImageUrl（未簽名）
 reset();writePlaceRuntimeCache('ChIJ_rt',{coverImageUrl:unsigned('runtime')});
 root.render(<div key={'k'+(++window.mountSeq)} data-c="a2" style={{width:64,height:64}}><SavedPlaceCoverThumb place={{id:'s2',name:'s2',category:'cafe',metadata:{googlePlaceId:'ChIJ_rt'}}}/></div>);
 await until(()=>imgIn('[data-c=a2]')?.src.includes('signature='),'A2 signed');
 out.a2={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A3 localStorage 舊結果（roamie:image-cache 的 home-place-cover:<placeId> 為未簽名 w=600，頁面載入前注入）→ PlaceCoverImage
 reset();
 root.render(<div key={'k'+(++window.mountSeq)} data-c="a3" style={{width:64,height:64}}><PlaceCoverImage placeId="ChIJ_ls" name="ls" category="cafe" maxWidth={600} lazy={false}/></div>);
 await until(()=>imgIn('[data-c=a3]')?.src.includes('signature='),'A3 signed');
 out.a3={sign:[...window.signCalls],unsigned:unsignedAssigned().length,discovery:window.discoveryCalls};
 // A3b runtime cache 只有 coverImageUrl、無 initialUrl：PlaceImage → getPlaceImage → 簽名
 reset();writePlaceRuntimeCache('ChIJ_rt2',{coverImageUrl:unsigned('runtime2')});
 root.render(<div key={'k'+(++window.mountSeq)} data-c="a3b" style={{width:64,height:64}}><PlaceImage placeId="ChIJ_rt2" name="rt2" category="cafe" photoWidth={256} lazy={false}/></div>);
 await until(()=>imgIn('[data-c=a3b]')?.src.includes('signature='),'A3b signed');
 out.a3b={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A9 對照：一般圖片（Supabase／行程封面）初次 render 即直接顯示，行為不變
 reset();flushSync(()=>root.render(<div key={'k'+(++window.mountSeq)} data-c="a9"><FadeInImage src="/fixture-cover.png" fallbackSrc="/fixture-default.png"/></div>));
 out.a9={img:imgIn('[data-c=a9]')?.getAttribute('src')??null,sign:[...window.signCalls]}; // A4 FadeInImage 直接拿未簽名 src（邀請頁封面／行程封面路徑）：初次 render 不得指派未簽名 src
 reset();manual=true;
 flushSync(()=>root.render(<div key={'k'+(++window.mountSeq)} data-c="a4" style={{width:160,height:90}}><FadeInImage src={unsigned('invite')} alt="" className="block aspect-[16/9] w-full bg-secondary" imgClassName="h-full w-full object-cover"/></div>));
 out.a4initial={img:imgIn('[data-c=a4]')?.getAttribute('src')??null,unsigned:unsignedAssigned().length,pulse:Boolean(document.querySelector('[data-c=a4] .animate-pulse'))};
 await until(()=>pending.has(photo('invite')),'A4 sign pending');pending.get(photo('invite'))();manual=false;
 await until(()=>imgIn('[data-c=a4]')?.src.includes('signature='),'A4 signed');
 out.a4={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A5 同一張圖 remount／兩個元件：不重複簽名
 reset();root.render(<><div key={'k'+(++window.mountSeq)} data-c="a5a"><FadeInImage src={unsigned('invite')}/></div><div key={'k'+(++window.mountSeq)} data-c="a5b"><FadeInImage src={unsigned('invite')}/></div></>);
 await until(()=>imgIn('[data-c=a5a]')?.src.includes('signature=')&&imgIn('[data-c=a5b]')?.src.includes('signature='),'A5 cached');
 out.a5={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 reset();manual=true;root.render(<><div key={'k'+(++window.mountSeq)} data-c="a5c"><FadeInImage src={unsigned('dup')}/></div><div key={'k'+(++window.mountSeq)} data-c="a5d"><FadeInImage src={unsigned('dup')}/></div></>);
 await until(()=>pending.has(photo('dup')),'A5 inflight');pending.get(photo('dup'))();manual=false;
 await until(()=>imgIn('[data-c=a5c]')?.src.includes('signature=')&&imgIn('[data-c=a5d]')?.src.includes('signature='),'A5 inflight merged');
 out.a5inflight={sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A6 簽名失敗 → 預設圖（FadeInImage 有／無 fallbackSrc；SavedPlaceCoverThumb）
 reset();failPhotos.add(photo('fail'));failPhotos.add(photo('fail2'));
 root.render(<><div key={'k'+(++window.mountSeq)} data-c="a6a"><FadeInImage src={unsigned('fail')} fallbackSrc="/fixture-default.png"/></div><div key={'k'+(++window.mountSeq)} data-c="a6b"><FadeInImage src={unsigned('fail2')}/></div><div key={'k'+(++window.mountSeq)} data-c="a6c" style={{width:64,height:64}}><SavedPlaceCoverThumb place={{id:'s6',name:'s6',category:'cafe',metadata:{},cover_image:unsigned('fail2'),image_url:null}}/></div></>);
 await until(()=>imgIn('[data-c=a6a]')&&imgIn('[data-c=a6b]')&&imgIn('[data-c=a6c]'),'A6 fallback imgs');await tick();await tick();
 out.a6={a:imgIn('[data-c=a6a]').getAttribute('src'),b:imgIn('[data-c=a6b]').getAttribute('src'),c:imgIn('[data-c=a6c]').getAttribute('src'),sign:[...window.signCalls],unsigned:unsignedAssigned().length};
 // A7 首頁預載：未簽名 URL 不得直接 new Image()，改簽名 480 再預載
 reset();prefetchPlaceCoverUrls([{placeId:'ChIJ_home',url:unsigned('home')}]);
 await until(()=>window.signCalls.length>0&&window.newImages.some(i=>/signature=/.test(i.src)),'A7 sign+prefetch');
 out.a7={sign:[...window.signCalls],imageSrcs:window.newImages.map(i=>i.src),unsigned:unsignedAssigned().length};
 // A11 失敗快取污染：image-url-failure-cache 的 failureKey 去掉 query → 一張「已簽名」照片 GET 失敗（server 回 502）後，
 //   其他照片（不同 photo、可正常簽名）是否也被判定失敗而顯示預設圖？
 const soft=async fn=>{for(let i=0;i<100&&!fn();i++)await tick();};
 reset();root.render(<div key={'k'+(++window.mountSeq)} data-c="a11pre"><FadeInImage src={unsigned('broken')} fallbackSrc="/fixture-default.png"/></div>);
 await soft(()=>imgIn('[data-c=a11pre]')?.getAttribute('src')==='/fixture-default.png');await tick();
 out.a11pre={img:imgIn('[data-c=a11pre]')?.getAttribute('src')??null,assigned:[...window.imgSrcs]};
 reset();root.render(<div key={'k'+(++window.mountSeq)} data-c="a11a"><FadeInImage src={unsigned('after-fail')} fallbackSrc="/fixture-default.png"/></div>);
 await soft(()=>imgIn('[data-c=a11a]')?.src.includes('signature='));await tick();
 out.a11a={img:imgIn('[data-c=a11a]')?.getAttribute('src')??null,html:document.querySelector('[data-c=a11a]')?.innerHTML.slice(0,200),sign:[...window.signCalls]};
 reset();root.render(<div key={'k'+(++window.mountSeq)} data-c="a11b" style={{width:64,height:64}}><PlaceImage photoName={photo('after-fail-2')} name="x" category="cafe" photoWidth={256} lazy={false}/></div>);
 await soft(()=>imgIn('[data-c=a11b]')?.src.includes('signature='));await tick();
 out.a11b={img:imgIn('[data-c=a11b]')?.getAttribute('src')??null,html:document.querySelector('[data-c=a11b]')?.innerHTML.slice(0,200),sign:[...window.signCalls]};
 // A10 邊界：未簽名 proxy 但 photo 參數不是合法 places/…/photos/… （舊資料損毀）→ 不得直接指派為 <img src>
 reset();flushSync(()=>root.render(<div key={'k'+(++window.mountSeq)} data-c="a10"><FadeInImage src="/api/place-photo?photo=not-a-resource&w=600" fallbackSrc="/fixture-default.png"/></div>));
 await tick();await tick();
 out.a10={img:imgIn('[data-c=a10]')?.getAttribute('src')??null,assigned:[...window.imgSrcs],sign:[...window.signCalls]};
 root.render(<></>);await tick();out.errors=errors;out.discovery=window.discoveryCalls;return out;};`;
await check("A0 bundle 建置", async () => {
  await build({
    stdin: { contents: entry, resolveDir: root, loader: "tsx" },
    bundle: true,
    outfile: path.join(tmp, "app.js"),
    format: "iife",
    logLevel: "error",
    loader: { ".png": "dataurl", ".jpg": "dataurl" },
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "controlled-network",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: root }));
      },
    }],
  });
});
const getRequests = [];
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/place-photo")) getRequests.push(req.url);
  const isImg = req.url.startsWith("/api/place-photo?") || req.url.startsWith("/fixture-") || /\.(png|jpe?g|svg|webp)(\?|$)/.test(req.url);
  if (req.url.startsWith("/api/place-photo?") && !/[?&]signature=/.test(req.url)) {
    res.writeHead(401);
    res.end("unsigned");
    return;
  }
  if (req.url.includes("tspe_broken")) {
    res.writeHead(502);
    res.end("fixture upstream failure");
    return;
  }
  res.setHeader("Content-Type", req.url === "/app.js" ? "application/javascript" : isImg ? "image/svg+xml" : "text/html");
  res.end(
    req.url === "/app.js"
      ? fs.readFileSync(path.join(tmp, "app.js"))
      : isImg
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
        : '<div id="root"></div><script src="/app.js"></script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
// localStorage 舊結果（A3）：image-cache 的持久化格式（LS_KEY roamie:image-cache；cacheKey 會轉小寫）
const lsSeed = `localStorage.setItem("roamie:image-cache", ${JSON.stringify(
  JSON.stringify({ "home-place-cover:chij_ls": { url: unsignedUrl("ls"), at: Date.now() } }),
)});`;
const chrome = spawn(
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", "--user-data-dir=" + path.join(tmp, "chrome"), "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let ws;
let result = null;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    chrome.stderr.on("data", (b) => {
      output += b;
      const m = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on("error", reject);
    setTimeout(() => reject(Error("Chrome startup timeout")), 15000).unref();
  });
  ws = new WebSocket(endpoint);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const r = JSON.parse(e.data);
    if (r.id && pend.has(r.id)) {
      const p = pend.get(r.id);
      pend.delete(r.id);
      r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const next = ++id;
      pend.set(next, { resolve, reject });
      ws.send(JSON.stringify({ id: next, method, params, sessionId }));
    });
  const { targetInfos } = await send("Target.getTargets");
  const { sessionId } = await send("Target.attachToTarget", { targetId: targetInfos.find((t) => t.type === "page").targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Page.addScriptToEvaluateOnNewDocument", { source: lsSeed }, sessionId);
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/welcome` }, sessionId);
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    const r = await send("Runtime.evaluate", { expression: 'typeof window.run === "function"', returnByValue: true }, sessionId);
    ready = Boolean(r.result.value);
    if (!ready) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(ready, "browser harness loaded");
  const r = await send("Runtime.evaluate", { expression: "window.run()", awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  result = r.result.value;
} catch (e) {
  failures.push("A harness");
  console.log("FAIL A harness\n     " + String(e?.stack || e).split("\n").slice(0, 5).join("\n     "));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
if (result) {
  console.info("[TS-PE] photo:", JSON.stringify(result).replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "data:image/…"));
  const unsignedGets = getRequests.filter((u) => u.startsWith("/api/place-photo?") && !/[?&]signature=/.test(u));
  const signedGets = getRequests.filter((u) => /[?&]signature=/.test(u));
  console.info("[TS-PE] server GET：signed=" + signedGets.length + " unsigned=" + unsignedGets.length, unsignedGets);
  await check("A1 收藏 cover_image 未簽名 w=600 → 只發 sign、0 個未簽名 GET", () => {
    assert.deepEqual(result.a1.sign, [photo("cover") + "@256"]);
    assert.equal(result.a1.unsigned, 0);
  });
  await check("A2 runtime cache 只有 coverImageUrl（未簽名）→ 先簽名、0 個未簽名 src", () => {
    assert.equal(result.a2.sign.length, 1, JSON.stringify(result.a2.sign));
    assert.match(result.a2.sign[0], /^places\/ChIJ_tspe_runtime\/photos\/first@/);
    assert.equal(result.a2.unsigned, 0);
  });
  await check("A4 FadeInImage 初次 render 不使用未簽名 src（顯示 skeleton），簽名後才顯示", () => {
    assert.equal(result.a4initial.img, null, "初次 render img=" + result.a4initial.img);
    assert.equal(result.a4initial.unsigned, 0);
    assert.equal(result.a4initial.pulse, true);
    assert.deepEqual(result.a4.sign, [photo("invite") + "@600"]);
    assert.equal(result.a4.unsigned, 0);
  });
  await check("A5 同一張圖不重複簽名（快取命中 0 次；同時兩個元件 inflight 合併 1 次）", () => {
    assert.deepEqual(result.a5.sign, []);
    assert.deepEqual(result.a5inflight.sign, [photo("dup") + "@600"]);
    assert.equal(result.a5.unsigned + result.a5inflight.unsigned, 0);
  });
  await check("A6 簽名失敗 → 預設圖（有 fallbackSrc 用之；無則本地預設圖），不嘗試未簽名 GET", () => {
    assert.match(result.a6.a, /fixture-default\.png/);
    assert.ok(result.a6.b && !result.a6.b.includes("/api/place-photo"), "b=" + result.a6.b);
    assert.ok(result.a6.c && !result.a6.c.includes("/api/place-photo"), "c=" + result.a6.c);
    assert.equal(result.a6.unsigned, 0);
  });
  await check("A7 首頁預載遇未簽名網址不直接 new Image()，改簽名 480 後預載", () => {
    assert.deepEqual(result.a7.sign, [photo("home") + "@480"]);
    assert.ok(result.a7.imageSrcs.every((s) => /signature=/.test(s)), JSON.stringify(result.a7.imageSrcs));
    assert.equal(result.a7.unsigned, 0);
  });
  await check("A10 邊界：photo 參數非法的未簽名 proxy（FadeInImage）不得當 <img src>（應直接預設圖）", () => {
    assert.ok(
      !result.a10.assigned.some((s) => s.includes("/api/place-photo?") && !/[?&]signature=/.test(s)),
      "指派了未簽名 src：" + JSON.stringify(result.a10.assigned),
    );
    assert.equal(result.a10.img, "/fixture-default.png", "應直接顯示 fallbackSrc：" + result.a10.img);
    assert.deepEqual(result.a10.sign, [], "解析不出 photo name 不得送簽名");
  });
  await check("A11pre 已簽名照片 GET 502 → FadeInImage 改顯示預設圖（前置條件）", () => {
    assert.equal(result.a11pre.img, "/fixture-default.png", JSON.stringify(result.a11pre));
    assert.ok(result.a11pre.assigned.some((s) => /tspe_broken.*signature=/.test(s)), "確實嘗試了簽名 URL");
  });
  await check("A11a 一張 proxy 圖載入失敗後，另一張（不同 photo）未簽名→簽名成功的 FadeInImage 仍顯示簽名圖（新路徑）", () => {
    assert.match(result.a11a.img ?? "", /signature=/, "顯示的是 " + result.a11a.img + "；sign=" + JSON.stringify(result.a11a.sign));
  });
  await check("A11b 對照（既有路徑）：同條件下 PlaceImage（photoName→簽名）仍顯示簽名圖", () => {
    assert.match(result.a11b.img ?? "", /signature=/, "顯示的是 " + String(result.a11b.img).slice(0, 40) + "…（本地預設圖）");
  });
  await check("A8 全程（不含 A10 邊界）server 收到 0 個未簽名 /api/place-photo GET、無 discovery、無 unhandled rejection", () => {
    const unsignedValid = unsignedGets.filter((u) => !u.includes("not-a-resource"));
    assert.equal(unsignedValid.length, 0, JSON.stringify(unsignedValid));
    assert.ok(signedGets.length > 0);
    assert.equal(result.discovery, 0);
    assert.deepEqual(result.errors, []);
  });
  await check("A3 localStorage 舊結果（未簽名 w=600）→ PlaceCoverImage 只發 sign、0 個未簽名 src", () => {
    assert.deepEqual(result.a3.sign, [photo("ls") + "@600"]);
    assert.equal(result.a3.unsigned, 0, JSON.stringify(result.a3));
  });
  await check("A3b runtime cache 只有 coverImageUrl、無 initialUrl → PlaceImage（getPlaceImage）簽名後顯示", () => {
    assert.deepEqual(result.a3b.sign, [photo("runtime2") + "@256"]);
    assert.equal(result.a3b.unsigned, 0);
  });
  await check("A9 對照：一般圖片 FadeInImage 初次 render 即使用原 src、不簽名（既有行為不變）", () => {
    assert.match(result.a9.img ?? "", /fixture-cover\.png/);
    assert.deepEqual(result.a9.sign, []);
  });
}

console.log(failures.length ? `\nverify-unsigned-photo-and-explore-all: FAIL (${failures.length})\n  - ${failures.join("\n  - ")}` : "\nverify-unsigned-photo-and-explore-all: PASS");
process.exitCode = failures.length ? 1 : 0;
