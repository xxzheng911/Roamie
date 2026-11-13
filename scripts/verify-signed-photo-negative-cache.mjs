#!/usr/bin/env node
import "./verify-netguard-full.mjs";
/**
 * signed-place-photo 負向快取回歸（P1-T / P1-T2）。
 * 執行：node scripts/verify-signed-photo-negative-cache.mjs [--baseline]
 * --baseline：以 HEAD 版 signed-place-photo.ts 執行，預期失敗（無負向快取 → 重複 fetch）。
 *
 * fetch / supabase 全 mock；Date.now 以虛擬時鐘控制 TTL；8s 逾時僅在 timeout 情境縮短。
 * 規格：一般 TTL 45s；429 讀 Retry-After 數字取 min(max(值,1),120) 秒，缺少或非數字（含 HTTP-date）60s；
 * 401/403、auth_timeout、未逾時 abort、成功 → 不寫入；以最後一次嘗試為準。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = process.cwd();
const baseline = process.argv.includes("--baseline");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-photo-negative-"));
const outfile = path.join(dir, baseline ? "old.mjs" : "new.mjs");
await build({
  entryPoints: ["src/services/signed-place-photo.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".svg": "dataurl", ".webp": "dataurl" },
  define: {
    "import.meta.env.VITE_APP_ORIGIN": '"https://roamie.tw"',
    "import.meta.env.DEV": "false",
    "import.meta.env.VITE_VERBOSE_LOG": '"1"',
    "import.meta.env.VITE_DEBUG_DIAGNOSTICS": '"0"',
  },
  plugins: [
    {
      name: "controlled-auth",
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: "auth", namespace: "mock" }));
        // getSession：globalThis.sessionBehavior 為 "ok" | "hang" | 陣列（逐次呼叫）；"hang" 模擬 session 永不就緒。
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: `export const supabase={auth:{getSession:()=>{
            const i=globalThis.sessionCalls++;
            const sb=globalThis.sessionBehavior;
            const m=Array.isArray(sb)?sb[Math.min(i,sb.length-1)]:sb;
            if(m==="hang")return new Promise(()=>{});
            return Promise.resolve({data:{session:globalThis.photoSession}});
          }}};`,
          loader: "js",
        }));
        if (baseline)
          b.onLoad({ filter: /[/\\]signed-place-photo\.ts$/ }, () => ({
            contents: execFileSync("git", ["show", "HEAD:src/services/signed-place-photo.ts"], { encoding: "utf8" }),
            loader: "ts",
            resolveDir: path.join(root, "src/services"),
          }));
      },
    },
  ],
});
const mod = await import(pathToFileURL(outfile).href);
const { getSignedPlacePhotoUrl } = mod;

globalThis.window = { location: { origin: "null", href: "capacitor://localhost/index.html" }, Capacitor: { isNativePlatform: () => true } };
globalThis.photoSession = { access_token: "fixture-auth-token" };
globalThis.sessionCalls = 0;
globalThis.sessionBehavior = "ok";

// ---- 虛擬 Date.now ----
const realNow = Date.now;
let clock = realNow.call(Date);
Date.now = () => clock;

// ---- 縮短 8s 逾時（僅 timeout 情境）：true = 全部縮短；數字 = 只縮短接下來 N 次 ----
const realSetTimeout = globalThis.setTimeout;
let shrinkTimeout = false;
globalThis.setTimeout = (fn, ms, ...rest) => {
  let shrink = false;
  if (ms === 8000) {
    if (shrinkTimeout === true) shrink = true;
    else if (typeof shrinkTimeout === "number" && shrinkTimeout > 0) { shrinkTimeout--; shrink = true; }
  }
  return realSetTimeout(fn, shrink ? 5 : ms, ...rest);
};
const tick = (ms) => new Promise((r) => realSetTimeout(r, ms));

const allLogs = [];
const logs = [];
const origInfo = console.info;
console.info = (tag, record) => {
  if (tag === "[PLACE_PHOTO_SIGNING]") {
    logs.push(record);
    allLogs.push(record);
  }
};

const nativeFetch = globalThis.fetch;
let fetches = 0;
/** behavior: number(status) | {status, retryAfter} | 'ok' | 'network' | 'timeout' | 'abort' | 'json' | 'shape' | 'hold' | array(per attempt) */
let behavior = "ok";
let held = [];
const okResponse = (p, w = 480) => {
  const params = new URLSearchParams({ photo: p, w: String(w), expires: "9999999999", signature: "fixture-signature" });
  return Response.json({ url: "/api/place-photo?" + params });
};
globalThis.fetch = async (url, init) => {
  fetches++;
  const body = JSON.parse(init.body);
  const b = Array.isArray(behavior) ? behavior[Math.min(fetches - 1, behavior.length - 1)] : behavior;
  if (b === "network") throw new TypeError("fixture network");
  if (b === "abort") throw new DOMException("aborted", "AbortError");
  if (b === "timeout")
    return new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
    );
  // hold：刻意不理會 abort，模擬舊請求在逾時後才回應
  if (b === "hold") return new Promise((resolve) => held.push(resolve));
  if (typeof b === "number") return new Response("{}", { status: b });
  if (b && typeof b === "object")
    return new Response("{}", { status: b.status, headers: b.retryAfter == null ? {} : { "Retry-After": b.retryAfter } });
  if (b === "json") return new Response("{bad", { status: 200 });
  if (b === "shape") return Response.json({ unexpected: true });
  return okResponse(body.photo, body.width);
};

const results = [];
let n = 0;
const photo = (tag) => `places/fixture${++n}/photos/${tag}`;
async function test(name, fn) {
  fetches = 0;
  logs.length = 0;
  behavior = "ok";
  shrinkTimeout = false;
  held = [];
  globalThis.sessionCalls = 0;
  globalThis.sessionBehavior = "ok";
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (e) {
    results.push(`  FAIL ${name}`);
    console.info = origInfo;
    origInfo(results.join("\n"));
    throw e;
  }
}

/** 已觸發首次失敗後（fetches = firstFetches）：驗證 TTL 邊界 ttl-100ms 不 fetch、ttl+100ms 重新請求且成功。 */
async function expectTtlBoundary(p, mode, ttlMs, firstFetches) {
  logs.length = 0;
  assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
  assert.equal(fetches, firstFetches, `${mode}: 負向快取期間不得再 fetch`);
  assert.equal(logs.at(-1)?.fallbackReason, "negative_cache", `${mode}: report fallbackReason=negative_cache`);
  clock += ttlMs - 100;
  assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
  assert.equal(fetches, firstFetches, `${mode}: ${(ttlMs - 100) / 1000}s 仍在負向快取內`);
  clock += 200;
  behavior = "ok";
  const r3 = await getSignedPlacePhotoUrl(p, 480);
  assert.ok(r3?.startsWith("https://roamie.tw/api/place-photo?"), `${mode}: ${(ttlMs + 100) / 1000}s 過期後應重新請求並成功`);
  assert.equal(fetches, firstFetches + 1);
  // 成功後走正向快取
  await getSignedPlacePhotoUrl(p, 480);
  assert.equal(fetches, firstFetches + 1, `${mode}: 正向快取不變`);
}

async function expectNegativeCached(p, mode, ttlMs = 45_000) {
  const r1 = await getSignedPlacePhotoUrl(p, 480);
  assert.equal(r1, null);
  assert.equal(fetches, 2, `${mode}: 首次失敗應發 2 次（含 1 次重試）`);
  await expectTtlBoundary(p, mode, ttlMs, 2);
}

async function expectNotCached(p, mode) {
  assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
  assert.equal(fetches, 2);
  logs.length = 0;
  assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
  assert.equal(fetches, 4, `${mode}: 不得寫入負向快取，下一次應立即重試`);
  assert.notEqual(logs.at(-1)?.fallbackReason, "negative_cache");
}

try {
  // ---- 一般 http 失敗：45s ----
  for (const status of [404, 500, 503]) {
    await test(`http_${status} → 寫入負向快取 45s；過期後重新請求；成功後正向快取`, async () => {
      behavior = status;
      await expectNegativeCached(photo(String(status)), `http_${status}`);
    });
  }

  // ---- 429：Retry-After ----
  const rateLimitCases = [
    ["無 Retry-After", undefined, 60_000],
    ["Retry-After 空字串", "", 60_000],
    ["Retry-After 30", "30", 30_000],
    ["Retry-After 500 → 上限 120", "500", 120_000],
    ["Retry-After 0 → 下限 1", "0", 1_000],
    ["Retry-After -5 → 下限 1", "-5", 1_000],
    ["Retry-After HTTP-date → 60", "Wed, 21 Oct 2015 07:28:00 GMT", 60_000],
    ["Retry-After 非數字 → 60", "soon", 60_000],
  ];
  for (const [label, retryAfter, ttl] of rateLimitCases) {
    await test(`http_429（${label}）→ 負向快取 ${ttl / 1000}s；${(ttl - 100) / 1000}s 不 fetch、${(ttl + 100) / 1000}s 重新請求`, async () => {
      behavior = { status: 429, retryAfter };
      await expectNegativeCached(photo(`429-${label}`), `http_429 ${label}`, ttl);
    });
  }
  await test("http_429 最後一次嘗試的 Retry-After 為準：首次 120 → 末次無 → 60s", async () => {
    behavior = [{ status: 429, retryAfter: "120" }, { status: 429 }];
    await expectNegativeCached(photo("429-last"), "http_429 last", 60_000);
  });

  await test("invalid_signed_response → 寫入負向快取", async () => {
    behavior = "shape";
    await expectNegativeCached(photo("shape"), "invalid_signed_response");
  });
  await test("網路拒絕（TypeError）→ 寫入負向快取", async () => {
    behavior = "network";
    await expectNegativeCached(photo("network"), "fetch_network_rejected");
  });
  await test("逾時（fetch_timeout）→ 寫入負向快取 45s", async () => {
    behavior = "timeout";
    shrinkTimeout = true;
    const p = photo("timeout");
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    assert.equal(logs.at(-1).timeout, true);
    assert.equal(logs.at(-1).fallbackReason, "fetch_timeout");
    shrinkTimeout = false;
    await expectTtlBoundary(p, "fetch_timeout", 45_000, 2);
  });
  await test("auth_timeout（getSession 超過 8 秒）→ 不寫入，下一次立即重試", async () => {
    globalThis.sessionBehavior = "hang";
    shrinkTimeout = true;
    const p = photo("auth-timeout");
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    assert.equal(logs.at(-1).timeout, true);
    assert.equal(logs.at(-1).fallbackReason, "auth_timeout");
    assert.equal(fetches, 0, "auth 階段逾時不應發 fetch");
    assert.equal(globalThis.sessionCalls, 2);
    logs.length = 0;
    globalThis.sessionBehavior = "ok";
    shrinkTimeout = false;
    const r = await getSignedPlacePhotoUrl(p, 480);
    assert.ok(r, "auth_timeout 不寫入，session 就緒後應立即成功");
    assert.equal(fetches, 1);
    assert.equal(globalThis.sessionCalls, 3);
    assert.ok(!logs.some((l) => l.fallbackReason === "negative_cache"));
  });
  await test("最後一次嘗試決定：auth_timeout 後 fetch_timeout → 寫入；fetch_timeout 後 auth_timeout → 不寫入", async () => {
    shrinkTimeout = true;
    behavior = "timeout";
    globalThis.sessionBehavior = ["hang", "ok"];
    const a = photo("auth-then-fetch");
    assert.equal(await getSignedPlacePhotoUrl(a, 480), null);
    assert.equal(logs.at(-1).fallbackReason, "fetch_timeout");
    assert.equal(fetches, 1);
    assert.equal(await getSignedPlacePhotoUrl(a, 480), null);
    assert.equal(fetches, 1, "末次 fetch_timeout 應寫入");
    assert.equal(logs.at(-1).fallbackReason, "negative_cache");

    fetches = 0;
    globalThis.sessionCalls = 0;
    globalThis.sessionBehavior = ["ok", "hang", "ok"];
    const b = photo("fetch-then-auth");
    assert.equal(await getSignedPlacePhotoUrl(b, 480), null);
    assert.equal(logs.at(-1).fallbackReason, "auth_timeout");
    assert.equal(fetches, 1);
    shrinkTimeout = false;
    behavior = "ok";
    assert.ok(await getSignedPlacePhotoUrl(b, 480), "末次 auth_timeout 不寫入，應可立即重試成功");
    assert.equal(fetches, 2);
  });
  for (const status of [401, 403]) {
    await test(`http_${status} → 不寫入（session 未就緒可立即重試）`, async () => {
      behavior = status;
      await expectNotCached(photo(String(status)), `http_${status}`);
    });
  }
  await test("abort（未逾時，AbortError）→ 不寫入", async () => {
    behavior = "abort";
    await expectNotCached(photo("abort"), "abort");
  });
  await test("response_parse_exception（非任務單列舉的確定失敗）→ 不寫入", async () => {
    behavior = "json";
    await expectNotCached(photo("json"), "json");
  });
  await test("最後一次嘗試決定：503 後 401 → 不寫入；401 後 503 → 寫入", async () => {
    behavior = [503, 401];
    const a = photo("mixA");
    assert.equal(await getSignedPlacePhotoUrl(a, 480), null);
    behavior = "ok";
    assert.ok(await getSignedPlacePhotoUrl(a, 480), "末次 401 不寫入，應可立即重試成功");
    fetches = 0;
    behavior = [401, 503];
    const b = photo("mixB");
    assert.equal(await getSignedPlacePhotoUrl(b, 480), null);
    behavior = "ok";
    assert.equal(await getSignedPlacePhotoUrl(b, 480), null);
    assert.equal(fetches, 2);
  });
  await test("首次失敗後第二次嘗試成功 → 不寫入負向快取", async () => {
    behavior = ["network", "ok"];
    const p = photo("retry");
    assert.ok(await getSignedPlacePhotoUrl(p, 480));
    assert.equal(fetches, 2);
  });
  await test("成功清除既有負向快取 key（過期後成功 → 再失敗應重新計算，不殘留舊 entry）", async () => {
    behavior = 503;
    const p = photo("clear");
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    clock += 45_100;
    behavior = "ok";
    assert.ok(await getSignedPlacePhotoUrl(p, 480));
    assert.equal(fetches, 3);
  });
  await test("舊請求（第 1 次逾時）在第 2 次嘗試期間才成功回應 → 不得改到 state／正向快取；末次 503 → 寫入", async () => {
    behavior = ["hold", "hold"];
    shrinkTimeout = 1; // 只縮短第 1 次嘗試
    const p = photo("stale-during");
    const call = getSignedPlacePhotoUrl(p, 480);
    await tick(400);
    assert.equal(fetches, 2, "第 1 次逾時後應已發出第 2 次");
    assert.equal(held.length, 2);
    held[0](okResponse(p)); // 舊請求遲到的成功
    await tick(20);
    held[1](new Response("{}", { status: 503 }));
    assert.equal(await call, null);
    logs.length = 0;
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null, "遲到的舊成功不得寫入正向快取");
    assert.equal(fetches, 2, "末次 503 應寫入負向快取");
    assert.equal(logs.at(-1)?.fallbackReason, "negative_cache");
  });
  await test("最後一次逾時，兩個舊請求在 finish 之後才成功 → 負向快取維持、不寫正向快取", async () => {
    behavior = ["hold", "hold"];
    shrinkTimeout = true;
    const p = photo("stale-after");
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    assert.equal(logs.at(-1).fallbackReason, "fetch_timeout");
    assert.equal(held.length, 2);
    held[0](okResponse(p));
    held[1](okResponse(p));
    await tick(20);
    shrinkTimeout = false;
    logs.length = 0;
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    assert.equal(fetches, 2);
    assert.equal(logs.at(-1)?.fallbackReason, "negative_cache");
  });
  await test("key 含寬度：同 photo 不同 width 不互相影響", async () => {
    behavior = 503;
    const p = photo("width");
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    behavior = "ok";
    assert.ok(await getSignedPlacePhotoUrl(p, 960), "width 960 不受 width 480 的負向快取影響");
    assert.equal(fetches, 3);
  });
  await test("inflight 合併：同 key 併發 3 呼叫只發 1 個請求；失敗後負向快取接手", async () => {
    behavior = "hold";
    held = [];
    const p = photo("inflight");
    const calls = [getSignedPlacePhotoUrl(p, 480), getSignedPlacePhotoUrl(p, 480), getSignedPlacePhotoUrl(p, 480)];
    await tick(10);
    assert.equal(fetches, 1, "併發只發 1 個請求");
    held.shift()(new Response("{}", { status: 503 }));
    await tick(350);
    assert.equal(fetches, 2);
    held.shift()(new Response("{}", { status: 503 }));
    const out = await Promise.all(calls);
    assert.deepEqual(out, [null, null, null]);
    assert.equal(fetches, 2);
    assert.equal(await getSignedPlacePhotoUrl(p, 480), null);
    assert.equal(fetches, 2, "inflight 結束後負向快取已生效");
  });
  await test("inflight 合併：成功時三個呼叫拿到同一 URL", async () => {
    behavior = "hold";
    held = [];
    const p = photo("inflight-ok");
    const calls = [getSignedPlacePhotoUrl(p, 480), getSignedPlacePhotoUrl(p, 480), getSignedPlacePhotoUrl(p, 480)];
    await tick(10);
    held.shift()(okResponse(p));
    const [a, b, c] = await Promise.all(calls);
    assert.ok(a);
    assert.equal(a, b);
    assert.equal(a, c);
    assert.equal(fetches, 1);
  });
  await test("日誌不含 URL、token、簽章、request body、Retry-After", async () => {
    for (const row of allLogs) {
      const text = JSON.stringify(row);
      assert.ok(!text.includes("fixture-auth-token"), "token");
      assert.ok(!text.includes("fixture-signature"), "signature");
      assert.ok(!text.includes("/api/place-photo"), "signed url / endpoint path");
      assert.ok(!text.includes("\"photo\":"), "request body");
      assert.ok(!text.includes("Oct 2015"), "Retry-After header");
    }
    assert.ok(allLogs.some((r) => r.fallbackReason === "negative_cache"));
  });
} finally {
  globalThis.fetch = nativeFetch;
  globalThis.setTimeout = realSetTimeout;
  Date.now = realNow;
  console.info = origInfo;
  delete globalThis.window;
  delete globalThis.photoSession;
  delete globalThis.sessionCalls;
  delete globalThis.sessionBehavior;
}
console.log(results.join("\n"));
console.log(`PASS signed-place-photo negative cache (${results.length} cases)`);
