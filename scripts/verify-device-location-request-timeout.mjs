#!/usr/bin/env node
/**
 * requestDeviceLocation JS 端逾時回歸（P1-T）。
 * 執行：node scripts/verify-device-location-request-timeout.mjs [--baseline]
 * --baseline：以 HEAD 版 device-location.ts 執行，預期失敗（證明測試能抓到卡住的 requestInFlight）。
 *
 * 全部外部依賴（Capacitor Geolocation、權限管理、app gate、location coordinator）皆 mock；
 * 計時器為虛擬時鐘，可精準推進 119s / 120s / 30s / 65s。
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roamie-device-location-timeout-"));

const mocks = {
  "@/lib/location-permission-manager": `export const ensureLocationPermission=(...a)=>{globalThis.__loc.ensureCalls++;return globalThis.__loc.ensure(...a)};`,
  "@/lib/capacitor-geolocation": `export const getCapacitorGeolocation=()=>({getCurrentPosition:(o)=>{globalThis.__loc.posCalls++;return globalThis.__loc.getPos(o)}});`,
  "@/lib/capacitor-native-shell": `export const isCapacitorNativeShell=()=>globalThis.__loc.native;`,
  "@/lib/location-coordinator": `export const isHomeLocationMode=()=>globalThis.__loc.homeMode;export const isHomeLocationBootstrapped=()=>globalThis.__loc.bootstrapped;export const markHomeLocationBootstrapped=()=>{globalThis.__loc.markCalls++;globalThis.__loc.bootstrapped=true};`,
  "@/lib/location-app-gate": `export const isAppActiveForLocation=()=>globalThis.__loc.appActive;export const registerLocationAppGate=()=>{globalThis.__loc.register()};export const waitForAppActiveForLocation=(ms)=>{globalThis.__loc.waitCalls++;return globalThis.__loc.waitApp(ms)};`,
  "@/lib/last-search-location": `export const readLastSearchLocation=()=>null;`,
};

const outfile = path.join(dir, baseline ? "old.mjs" : "new.mjs");
await build({
  entryPoints: ["src/lib/device-location.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  define: {
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.VITE_CAPACITOR_DEV_LOCATION_LAT": "undefined",
    "import.meta.env.VITE_CAPACITOR_DEV_LOCATION_LNG": "undefined",
    "import.meta.env.VITE_LOCATION_USE_SIMULATOR_GPS": "undefined",
  },
  plugins: [
    {
      name: "controlled-location",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (a) => (a.path in mocks ? { path: a.path, namespace: "mock" } : null));
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "js" }));
        if (baseline)
          b.onLoad({ filter: /[/\\]device-location\.ts$/ }, () => ({
            contents: execFileSync("git", ["show", "HEAD:src/lib/device-location.ts"], { encoding: "utf8" }),
            loader: "ts",
            resolveDir: path.join(root, "src/lib"),
          }));
      },
    },
  ],
});

// ---- storage polyfills（home-persistent-cache / last good coords 使用真實模組） ----
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// ---- 虛擬時鐘 ----
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let now = 0;
let seq = 0;
const timers = new Map();
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
};
function installFakeTimers() {
  globalThis.setTimeout = (fn, ms = 0) => {
    const id = ++seq;
    timers.set(id, { fn, at: now + ms, ms });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
}
function restoreTimers() {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}
async function advance(ms) {
  await flush();
  const end = now + ms;
  for (;;) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at;
    timers.delete(due[0]);
    due[1].fn();
    await flush();
  }
  now = end;
  await flush();
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const track = (p) => {
  const s = { settled: false, value: undefined, error: undefined };
  p.then(
    (v) => {
      s.settled = true;
      s.value = v;
    },
    (e) => {
      s.settled = true;
      s.error = e;
    },
  );
  return s;
};
const TAIPEI = { coords: { latitude: 25.0339, longitude: 121.5645, accuracy: 12 } };
const LATE = { coords: { latitude: 22.6273, longitude: 120.3014 + 0.05, accuracy: 9 } };

const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(e));

let instance = 0;
async function fresh(overrides = {}) {
  timers.clear();
  now = 0;
  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
  globalThis.__loc = {
    native: true,
    appActive: true,
    homeMode: false,
    bootstrapped: false,
    ensureCalls: 0,
    posCalls: 0,
    markCalls: 0,
    waitCalls: 0,
    register: () => {},
    waitApp: async () => true,
    ensure: async () => "granted",
    getPos: async () => TAIPEI,
    ...overrides,
  };
  return import(pathToFileURL(outfile).href + "?i=" + ++instance);
}

const logs = [];
const origInfo = console.info;
const origWarn = console.warn;
console.info = (...a) => logs.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));
console.warn = console.info;

const results = [];
async function test(name, fn) {
  logs.length = 0;
  installFakeTimers();
  try {
    await fn();
    results.push(`  ok  ${name}`);
  } catch (e) {
    results.push(`  FAIL ${name}`);
    restoreTimers();
    console.info = origInfo;
    console.warn = origWarn;
    origInfo(results.join("\n"));
    throw e;
  } finally {
    restoreTimers();
  }
}

// ---------------- native ----------------
for (const dialogSec of [31, 60, 119]) {
  await test(`native：權限對話框停留 ${dialogSec}s 後 granted，GPS 正常 → 成功不被截斷`, async () => {
    const perm = deferred();
    const m = await fresh({ ensure: () => perm.promise });
    const s = track(m.requestDeviceLocation());
    await advance(dialogSec * 1000);
    assert.equal(s.settled, false, "權限對話框期間不得逾時");
    perm.resolve("granted");
    await flush();
    assert.equal(s.settled, true);
    assert.equal(s.value.usedFallback, false);
    assert.equal(s.value.source, "capacitor");
    assert.equal(m.getSessionDeviceLocation()?.usedFallback, false);
    assert.equal(globalThis.__loc.markCalls, 1);
    assert.equal(timers.size, 0, "成功後不得殘留計時器");
  });
}

await test("native：granted 後重新計時 30s（119s 對話框 + 29.9s GPS 仍等待；30s → js_timeout）", async () => {
  const perm = deferred();
  const pos = deferred();
  const m = await fresh({ ensure: () => perm.promise, getPos: () => pos.promise });
  const s = track(m.requestDeviceLocation());
  await advance(119_000);
  perm.resolve("granted");
  await flush();
  assert.equal(globalThis.__loc.posCalls, 1);
  await advance(29_900);
  assert.equal(s.settled, false, "granted 後 30s 內不得逾時（不可沿用 120s 計時剩餘的 1s）");
  await advance(100);
  assert.equal(s.settled, true);
  assert.equal(s.value.usedFallback, true);
  assert.equal(s.value.source, "fallback");
  assert.ok(logs.some((l) => l.includes("reason=js_timeout")), "log reason=js_timeout");
  assert.ok(!logs.some((l) => l.includes("js_permission_timeout")));
  assert.equal(timers.size, 0);
  // 晚到的原生結果：不得寫 sessionLocation、不得 mark bootstrapped
  pos.resolve(LATE);
  await flush();
  assert.equal(m.getSessionDeviceLocation(), null, "晚到結果不得寫入 sessionLocation");
  assert.equal(globalThis.__loc.markCalls, 0, "晚到結果不得 markHomeLocationBootstrapped");
});

await test("native：權限階段 120s 上限 → js_permission_timeout；requestInFlight 清除、可重新請求", async () => {
  const perm1 = deferred();
  const perms = [perm1];
  const m = await fresh({
    ensure: () => {
      const d = perms.length === 1 && globalThis.__loc.ensureCalls === 1 ? perm1 : deferred();
      if (d !== perm1) perms.push(d);
      return d.promise;
    },
  });
  const s = track(m.requestDeviceLocation());
  await advance(119_999);
  assert.equal(s.settled, false);
  await advance(1);
  assert.equal(s.settled, true, "120s 必須逾時");
  assert.equal(s.value.usedFallback, true);
  assert.equal(typeof s.value.lat, "number");
  assert.equal(typeof s.value.lng, "number");
  assert.equal(typeof s.value.city, "string");
  assert.ok(["capacitor", "browser", "fallback"].includes(s.value.source));
  assert.ok(logs.some((l) => l.includes("reason=js_permission_timeout")));
  assert.equal(timers.size, 0, "逾時後不得殘留計時器");

  // 重新請求：不得 join 舊的卡住 promise，必須真的再問一次權限
  const s2 = track(m.requestDeviceLocation({ force: true }));
  await flush();
  assert.equal(globalThis.__loc.ensureCalls, 2, "逾時後應重新發出請求");
  assert.equal(s2.settled, false);
  perms[1].resolve("granted");
  await flush();
  assert.equal(s2.settled, true);
  assert.equal(s2.value.usedFallback, false);
  assert.equal(globalThis.__loc.markCalls, 1);

  // 舊請求晚到 granted：不得重新 arm 計時器，也不得覆寫 session
  const sessionBefore = m.getSessionDeviceLocation();
  globalThis.__loc.getPos = async () => LATE;
  perm1.resolve("granted");
  await flush();
  assert.equal(timers.size, 0, "逾時後晚到的 granted 不得重新 arm 計時器");
  assert.equal(m.getSessionDeviceLocation(), sessionBefore, "晚到結果不得覆寫 sessionLocation");
  assert.equal(globalThis.__loc.markCalls, 1);
});

await test("native：app gate 等待（requestDeviceLocationInternal 8s + readCapacitorPosition 8s）計入權限階段 120s", async () => {
  const gate = deferred();
  const m = await fresh({ appActive: false, waitApp: () => gate.promise });
  const s = track(m.requestDeviceLocation());
  await advance(120_000);
  assert.equal(s.settled, true);
  assert.ok(logs.some((l) => l.includes("reason=js_permission_timeout")));
  assert.equal(globalThis.__loc.ensureCalls, 0);
  gate.resolve(true);
  await flush();
  assert.equal(m.getSessionDeviceLocation(), null);
  assert.equal(globalThis.__loc.markCalls, 0);
  assert.equal(timers.size, 0);
});

await test("native：權限 denied → 既有 fallback，計時器清除", async () => {
  const m = await fresh({ ensure: async () => "denied" });
  const r = await m.requestDeviceLocation();
  assert.equal(r.usedFallback, true);
  assert.equal(r.permission, "denied");
  assert.equal(timers.size, 0);
  assert.equal(globalThis.__loc.markCalls, 0);
  assert.ok(!logs.some((l) => l.includes("js_timeout") || l.includes("js_permission_timeout")));
});

await test("native：ensureLocationPermission 丟例外 → 既有 fallback，計時器清除", async () => {
  const m = await fresh({ ensure: async () => {
    throw new Error("plugin missing");
  } });
  const r = await m.requestDeviceLocation();
  assert.equal(r.usedFallback, true);
  assert.equal(r.permission, "unavailable");
  assert.equal(timers.size, 0);
});

await test("native：GPS 兩次嘗試皆失敗 → 既有 fallback（非 js_timeout），計時器清除", async () => {
  const m = await fresh({ getPos: async () => {
    throw new Error("kCLErrorLocationUnknown");
  } });
  const r = await m.requestDeviceLocation();
  assert.equal(r.usedFallback, true);
  assert.equal(globalThis.__loc.posCalls, 2);
  assert.equal(timers.size, 0);
});

await test("native：internal 同步路徑丟例外 → reject 照舊，計時器與 requestInFlight 皆清除", async () => {
  let throwOnce = true;
  const m = await fresh({
    register: () => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("gate boom");
      }
    },
  });
  await assert.rejects(() => m.requestDeviceLocation(), /gate boom/);
  assert.equal(timers.size, 0);
  const r = await m.requestDeviceLocation();
  assert.equal(r.usedFallback, false, "前一次 reject 後 requestInFlight 必須已清除");
});

await test("native：join in-flight（同時兩呼叫共用一個請求）", async () => {
  const perm = deferred();
  const m = await fresh({ ensure: () => perm.promise });
  const a = m.requestDeviceLocation();
  const b = m.requestDeviceLocation();
  await flush();
  assert.equal(globalThis.__loc.ensureCalls, 1);
  perm.resolve("granted");
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb);
  assert.equal(timers.size, 0);
});

await test("native：成功後 session 快取命中，不再發請求", async () => {
  const m = await fresh();
  await m.requestDeviceLocation();
  const before = globalThis.__loc.ensureCalls;
  const r = await m.requestDeviceLocation();
  assert.equal(globalThis.__loc.ensureCalls, before);
  assert.equal(r.usedFallback, false);
  assert.equal(timers.size, 0);
});

await test("native：home force-block 照舊（不發請求、不 arm 計時器）", async () => {
  const m = await fresh({ homeMode: true });
  await m.requestDeviceLocation();
  const before = globalThis.__loc.ensureCalls;
  const r = await m.requestDeviceLocation({ force: true });
  assert.equal(globalThis.__loc.ensureCalls, before);
  assert.equal(r.usedFallback, false);
  assert.equal(timers.size, 0);
});

// 觀察（不 assert，交由指派者裁定）：逾時後晚到的 GPS 仍經 parseGpsPosition → rememberGoodCoords
// 寫入 localStorage 的 home 位置快取；下一次非 force 呼叫會經 persisted 分支採用並 markHomeLocationBootstrapped。
const observations = [];
await test("observation：逾時後晚到結果經 persisted 快取間接生效", async () => {
  const pos = deferred();
  const m = await fresh({ getPos: () => pos.promise });
  const s = track(m.requestDeviceLocation());
  await advance(30_000);
  assert.equal(s.settled, true);
  pos.resolve(LATE);
  await flush();
  const persistedWritten = Boolean(globalThis.localStorage.getItem("roamie:home-location-cache"));
  const next = await m.requestDeviceLocation();
  observations.push(
    `late-result persisted=${persistedWritten} nextCall.lat=${next.lat} nextCall.usedFallback=${next.usedFallback} markCalls=${globalThis.__loc.markCalls} ensureCallsAfter=${globalThis.__loc.ensureCalls}`,
  );
});

// ---------------- browser ----------------
function installBrowserGeo(impl) {
  globalThis.__geoCalls = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      geolocation: {
        getCurrentPosition: (ok, err, opts) => {
          globalThis.__geoCalls++;
          impl(ok, err, opts);
        },
      },
    },
  });
}

await test("browser：geolocation 永不回應 → 65s js_timeout（64.999s 仍等待）", async () => {
  let lateOk;
  installBrowserGeo((ok) => {
    lateOk = ok;
  });
  const m = await fresh({ native: false });
  const s = track(m.requestDeviceLocation());
  await advance(64_999);
  assert.equal(s.settled, false);
  await advance(1);
  assert.equal(s.settled, true);
  assert.equal(s.value.usedFallback, true);
  assert.ok(logs.some((l) => l.includes("reason=js_timeout")));
  assert.equal(timers.size, 0);
  lateOk(TAIPEI);
  await flush();
  assert.equal(m.getSessionDeviceLocation(), null, "晚到 browser 結果不得寫 sessionLocation");
  assert.equal(globalThis.__loc.markCalls, 0);
  // 可重新請求
  installBrowserGeo((ok) => ok(TAIPEI));
  const r = await m.requestDeviceLocation({ force: true });
  assert.equal(r.usedFallback, false);
  assert.equal(globalThis.__geoCalls, 1);
});

await test("browser：正常成功，計時器清除", async () => {
  installBrowserGeo((ok) => ok(TAIPEI));
  const m = await fresh({ native: false });
  const r = await m.requestDeviceLocation();
  assert.equal(r.source, "browser");
  assert.equal(r.usedFallback, false);
  assert.equal(globalThis.__loc.markCalls, 1);
  assert.equal(timers.size, 0);
});

await flush();
assert.deepEqual(unhandled, [], "不得有 unhandled rejection");

console.info = origInfo;
console.warn = origWarn;
console.log(results.join("\n"));
for (const o of observations) console.log("  observation:", o);
console.log(`PASS device-location request timeout (${results.length} cases)${baseline ? " [baseline?! expected failure]" : ""}`);
