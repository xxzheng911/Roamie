// verify-duo-hinge-state.mjs — iPhone Duo 原生摺疊狀態 JS 端（任務單 #H1-2）
//
// 受測模組：
//   src/lib/layout/duo-hinge.ts   normalizeDuoHingeState / sameDuoHingeState / store
//   src/hooks/use-duo-hinge.ts    useDuoHinge（SSR render）
//   src/services/platform         detectPlatform（使用真實實作，只 stub 其無關依賴）
//
// 載入方式：esbuild bundle（write:false）→ data: URL 動態 import。
//   - "@capacitor/core" 換成可控制的 stub（registerPlugin 回傳假外掛，計算呼叫次數）
//   - "@/services/platform" 使用真實檔案；它依賴的 boot-splash 等模組換成 no-op stub
//   - 每個情境重新 import 一份新的 module instance（module-level store 互不干擾）
//
// 執行：node scripts/verify-duo-hinge-state.mjs（不讀 .env、不連網、不寫檔）

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    const detail = String(error?.message ?? error)
      .split("\n")
      .join("\n     ");
    console.log(`FAIL ${name}\n     ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// bundle

const CAP_STUB = `
export function registerPlugin(name) {
  const s = globalThis.__duoStub;
  s.registerCalls.push(name);
  if (s.registerThrows) throw new Error("registerPlugin boom");
  return s.plugin;
}
`;
const NOOP_STUB = `
export const waitForCapacitorBridge = async () => false;
export const hasExternalBootSplash = () => false;
export const rootHasRealAppContent = () => false;
export const normalizeCapacitorEntryPath = () => {};
export const hideNativeSplashScreen = async () => {};
export const isAppReady = () => false;
export const logAppError = () => {};
`;

const stubPlugin = {
  name: "duo-stubs",
  setup(b) {
    b.onResolve({ filter: /^@capacitor\/core$/ }, () => ({ path: "cap", namespace: "stub" }));
    b.onResolve({ filter: /^@\/services\/platform$/ }, () => ({
      path: path.join(SRC, "services/platform/index.ts"),
    }));
    b.onResolve({ filter: /^@\/lib\/layout\/duo-hinge$/ }, () => ({
      path: path.join(SRC, "lib/layout/duo-hinge.ts"),
    }));
    b.onResolve({ filter: /^@\/hooks\/use-duo-hinge$/ }, () => ({
      path: path.join(SRC, "hooks/use-duo-hinge.ts"),
    }));
    b.onResolve({ filter: /^@\// }, () => ({ path: "noop", namespace: "stub" }));
    b.onResolve({ filter: /^@capacitor\// }, () => ({ path: "noop", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: args.path === "cap" ? CAP_STUB : NOOP_STUB,
      loader: "js",
    }));
  },
};

async function bundle(entrySource) {
  const out = await build({
    stdin: { contents: entrySource, resolveDir: ROOT, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    plugins: [stubPlugin],
    logLevel: "silent",
    // react-dom/server（node 版）內部有 require("util") 等 builtin；data: URL 模組沒有 require
    banner: {
      js: `import { createRequire as __cr } from "node:module"; const require = __cr(${JSON.stringify(path.join(ROOT, "package.json"))});`,
    },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return out.outputFiles[0].text;
}

const storeCode = await bundle(`export * from "@/lib/layout/duo-hinge";`);
const hookCode = await bundle(`
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useDuoHinge } from "@/hooks/use-duo-hinge";
function Probe() { const s = useDuoHinge(); return createElement("pre", null, JSON.stringify(s)); }
export function render() { return renderToString(createElement(Probe)); }
`);

let instance = 0;
async function freshImport(code) {
  instance += 1;
  const src = `${code}\n//# instance=${instance}`;
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// fakes

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFakePlugin() {
  const fake = {
    getStateCalls: 0,
    addListenerCalls: 0,
    removeCalls: 0,
    eventListeners: [],
    getStateDeferreds: [],
    addListenerDeferreds: [],
    autoResolve: true,
    getStateValue: undefined,
    getStateRejects: false,
    addListenerRejects: false,
    getState() {
      fake.getStateCalls += 1;
      if (fake.getStateRejects) return Promise.reject(new Error("UNIMPLEMENTED"));
      if (fake.autoResolve) return Promise.resolve(fake.getStateValue);
      const d = deferred();
      fake.getStateDeferreds.push(d);
      return d.promise;
    },
    addListener(eventName, listener) {
      fake.addListenerCalls += 1;
      assert.equal(eventName, "hingeChange");
      if (fake.addListenerRejects) return Promise.reject(new Error("UNIMPLEMENTED"));
      const entry = { listener, removed: false };
      fake.eventListeners.push(entry);
      const handle = {
        remove: async () => {
          fake.removeCalls += 1;
          entry.removed = true;
        },
      };
      if (fake.autoResolve) return Promise.resolve(handle);
      const d = deferred();
      fake.addListenerDeferreds.push({ d, handle });
      return d.promise;
    },
    emit(data) {
      // 模擬原生：即使 JS 已 remove，也可能有排在佇列裡的事件；送給所有曾註冊的 listener
      for (const e of fake.eventListeners) e.listener(data);
    },
  };
  return fake;
}

function setPlatform(kind) {
  if (kind === "ssr") {
    delete globalThis.window;
    return;
  }
  globalThis.window = {
    Capacitor: {
      getPlatform: () => kind,
      isNativePlatform: () => kind !== "web",
    },
  };
}

function setStub({ registerThrows = false } = {}) {
  const plugin = makeFakePlugin();
  globalThis.__duoStub = { registerCalls: [], registerThrows, plugin };
  return globalThis.__duoStub;
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

const VALID = {
  supported: true,
  status: "partiallyOpen",
  angle: 92.5,
  divisions: [{ x: 463.5, y: 0, width: 24, height: 800, active: true }],
  occlusions: [{ x: 10, y: 20, width: 30, height: 40, active: false }],
};

// ---------------------------------------------------------------------------
// normalize / same

const pure = await freshImport(storeCode);
const norm = pure.normalizeDuoHingeState;
const same = pure.sameDuoHingeState;
const UNSUP = pure.UNSUPPORTED_DUO_HINGE_STATE;

await test("normalize：非物件輸入一律回傳 UNSUPPORTED 常數（同一物件）", () => {
  for (const raw of [null, undefined, 0, 1, NaN, "", "x", true, false, Symbol("s"), () => 1]) {
    assert.equal(norm(raw), UNSUP, `raw=${String(raw)}`);
  }
  assert.deepEqual(UNSUP, {
    supported: false,
    status: "unknown",
    angle: null,
    divisions: [],
    occlusions: [],
  });
});

await test("normalize：陣列、supported 非 true 皆為 unsupported", () => {
  assert.equal(norm([]), UNSUP);
  assert.equal(norm([VALID]), UNSUP);
  for (const s of [false, "true", 1, null, undefined]) {
    assert.equal(norm({ ...VALID, supported: s }), UNSUP, `supported=${String(s)}`);
  }
});

await test("normalize：合法輸入完整保留", () => {
  assert.deepEqual(norm(VALID), VALID);
  assert.notEqual(norm(VALID), VALID, "應回傳新物件，不直接沿用原生物件");
});

await test("normalize：四種合法 status 保留；未知／非字串 status → unknown", () => {
  for (const s of ["unknown", "closed", "partiallyOpen", "fullyOpen"]) {
    assert.equal(norm({ ...VALID, status: s }).status, s);
  }
  for (const s of ["open", "FullyOpen", "", 2, null, undefined, {}, "__proto__", "toString"]) {
    const n = norm({ ...VALID, status: s });
    assert.equal(n.status, "unknown", `status=${String(s)}`);
    assert.equal(n.supported, true);
  }
});

await test("normalize：angle 非有限數字 → null；有限數字保留（含 0、負數）", () => {
  for (const a of [NaN, Infinity, -Infinity, "90", null, undefined, {}, [90], true]) {
    assert.equal(norm({ ...VALID, angle: a }).angle, null, `angle=${String(a)}`);
  }
  assert.equal(norm({ ...VALID, angle: 0 }).angle, 0);
  assert.equal(norm({ ...VALID, angle: 180 }).angle, 180);
  assert.equal(norm({ ...VALID, angle: -1.5 }).angle, -1.5);
});

await test("normalize：divisions/occlusions 非陣列 → []", () => {
  for (const v of [null, undefined, {}, "[]", 3, { 0: VALID.divisions[0], length: 1 }]) {
    const n = norm({ ...VALID, divisions: v, occlusions: v });
    assert.deepEqual(n.divisions, []);
    assert.deepEqual(n.occlusions, []);
  }
});

await test("normalize：陣列內垃圾值逐筆丟棄，保留合法者且順序不變", () => {
  const good1 = { x: 1, y: 2, width: 3, height: 4, active: true };
  const good2 = { x: -5, y: 0, width: 0, height: 0, active: false };
  const garbage = [
    null,
    undefined,
    0,
    "rect",
    [],
    [1, 2, 3, 4],
    {},
    { x: NaN, y: 0, width: 1, height: 1 },
    { x: 0, y: Infinity, width: 1, height: 1 },
    { x: 0, y: 0, width: -Infinity, height: 1 },
    { x: 0, y: 0, width: 1, height: NaN },
    { x: 0, y: 0, width: -1, height: 1 },
    { x: 0, y: 0, width: 1, height: -0.01 },
    { x: "0", y: 0, width: 1, height: 1 },
    { y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1 },
  ];
  const n = norm({
    ...VALID,
    divisions: [garbage[0], good1, ...garbage, good2],
    occlusions: garbage,
  });
  assert.deepEqual(n.divisions, [good1, good2]);
  assert.deepEqual(n.occlusions, []);
});

await test("normalize：rect 多餘欄位被移除；active 只有 === true 才為 true（缺省／truthy 非 true 皆為 false）", () => {
  const n = norm({
    ...VALID,
    divisions: [
      { x: 1, y: 2, width: 3, height: 4, extra: "drop", active: false },
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 1, y: 2, width: 3, height: 4, active: true },
      { x: 1, y: 2, width: 3, height: 4, active: 1 },
      { x: 1, y: 2, width: 3, height: 4, active: "true" },
      { x: 1, y: 2, width: 3, height: 4, active: null },
    ],
  });
  assert.deepEqual(n.divisions, [
    { x: 1, y: 2, width: 3, height: 4, active: false },
    { x: 1, y: 2, width: 3, height: 4, active: false },
    { x: 1, y: 2, width: 3, height: 4, active: true },
    { x: 1, y: 2, width: 3, height: 4, active: false },
    { x: 1, y: 2, width: 3, height: 4, active: false },
    { x: 1, y: 2, width: 3, height: 4, active: false },
  ]);
});

await test("UNSUPPORTED 常數深層 frozen（本體與 divisions／occlusions 陣列）", () => {
  assert.equal(Object.isFrozen(UNSUP), true);
  assert.equal(Object.isFrozen(UNSUP.divisions), true);
  assert.equal(Object.isFrozen(UNSUP.occlusions), true);
  assert.throws(() => {
    "use strict";
    UNSUP.divisions.push({ x: 0, y: 0, width: 1, height: 1, active: true });
  }, TypeError);
  assert.equal(UNSUP.divisions.length, 0);
});

await test("normalize：supported:true 但其餘欄位全缺 → supported/unknown/null/[]/[]", () => {
  assert.deepEqual(norm({ supported: true }), {
    supported: true,
    status: "unknown",
    angle: null,
    divisions: [],
    occlusions: [],
  });
});

await test("normalize：不會 throw（getter 例外以外的各種怪物件）", () => {
  const proto = Object.create({ supported: true, status: "closed" });
  assert.doesNotThrow(() => norm(proto));
  assert.doesNotThrow(() => norm(Object.create(null)));
  assert.equal(norm(Object.create(null)), UNSUP);
});

await test("same：內容相同（不同物件）→ true；各欄位任一不同 → false", () => {
  const a = norm(VALID);
  const b = norm(structuredClone(VALID));
  assert.equal(same(a, b), true);
  assert.equal(same(UNSUP, norm(null)), true);
  const variants = [
    { ...VALID, status: "closed" },
    { ...VALID, angle: 92.6 },
    { ...VALID, angle: null },
    { ...VALID, divisions: [] },
    { ...VALID, divisions: [{ ...VALID.divisions[0], x: 463.4 }] },
    { ...VALID, divisions: [{ ...VALID.divisions[0], y: 1 }] },
    { ...VALID, divisions: [{ ...VALID.divisions[0], width: 25 }] },
    { ...VALID, divisions: [{ ...VALID.divisions[0], height: 799 }] },
    { ...VALID, divisions: [{ ...VALID.divisions[0], active: false }] },
    { ...VALID, divisions: [...VALID.divisions, ...VALID.divisions] },
    { ...VALID, occlusions: [] },
    { ...VALID, occlusions: [{ ...VALID.occlusions[0], active: true }] },
  ];
  for (const v of variants) {
    assert.equal(same(a, norm(v)), false, JSON.stringify(v));
    assert.equal(same(norm(v), a), false, `反向 ${JSON.stringify(v)}`);
  }
  assert.equal(same(a, UNSUP), false);
});

await test("same：divisions 與 occlusions 互換不視為相同", () => {
  const r = { x: 1, y: 1, width: 1, height: 1, active: true };
  assert.equal(
    same(norm({ supported: true, divisions: [r] }), norm({ supported: true, occlusions: [r] })),
    false,
  );
});

// ---------------------------------------------------------------------------
// store：平台判斷

for (const kind of ["web", "android", "ssr"]) {
  await test(`store（${kind}）：subscribe 不註冊、不呼叫外掛；snapshot 為 unsupported`, async () => {
    setPlatform(kind);
    const stub = setStub();
    const m = await freshImport(storeCode);
    let notified = 0;
    const unsub = m.subscribeDuoHinge(() => (notified += 1));
    await flush();
    assert.deepEqual(stub.registerCalls, [], "registerPlugin 不應被呼叫");
    assert.equal(stub.plugin.getStateCalls, 0);
    assert.equal(stub.plugin.addListenerCalls, 0);
    assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
    assert.equal(m.getDuoHingeServerSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
    unsub();
    await flush();
    assert.equal(notified, 0);
    assert.equal(stub.plugin.removeCalls, 0);
  });
}

await test("store（ios 但 isNativePlatform=false，例如 iOS Safari 帶 Capacitor web runtime）：不呼叫外掛", async () => {
  globalThis.window = { Capacitor: { getPlatform: () => "web", isNativePlatform: () => false } };
  const stub = setStub();
  const m = await freshImport(storeCode);
  const unsub = m.subscribeDuoHinge(() => {});
  await flush();
  unsub();
  assert.deepEqual(stub.registerCalls, []);
  assert.equal(stub.plugin.getStateCalls, 0);
});

await test("store（window.Capacitor.getPlatform 丟例外）：安靜退回 unsupported", async () => {
  globalThis.window = {
    Capacitor: {
      getPlatform: () => {
        throw new Error("boom");
      },
    },
  };
  const stub = setStub();
  const m = await freshImport(storeCode);
  assert.doesNotThrow(() => m.subscribeDuoHinge(() => {})());
  await flush();
  assert.deepEqual(stub.registerCalls, []);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
});

// ---------------------------------------------------------------------------
// store：原生 iOS

await test("store（ios）：首次 subscribe 註冊 DuoHinge、addListener 1 次、getState 1 次並套用", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.getStateValue = VALID;
  const m = await freshImport(storeCode);
  let n1 = 0;
  let n2 = 0;
  const u1 = m.subscribeDuoHinge(() => (n1 += 1));
  const u2 = m.subscribeDuoHinge(() => (n2 += 1));
  await flush();
  assert.deepEqual(stub.registerCalls, ["DuoHinge"]);
  assert.equal(stub.plugin.addListenerCalls, 1, "第二個 subscriber 不得重複 addListener");
  assert.equal(stub.plugin.getStateCalls, 1);
  assert.deepEqual(m.getDuoHingeSnapshot(), VALID);
  assert.equal(n1, 1);
  assert.equal(n2, 1);
  u1();
  await flush();
  assert.equal(stub.plugin.removeCalls, 0, "還有 subscriber 時不得 remove");
  u2();
  await flush();
  assert.equal(stub.plugin.removeCalls, 1, "最後一個 subscriber 離開時 remove 原生 listener");
});

await test("store（ios）：相同內容的事件不通知且 snapshot 保持同一物件；不同內容才通知", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.getStateValue = VALID;
  const m = await freshImport(storeCode);
  let n = 0;
  const unsub = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  const snap1 = m.getDuoHingeSnapshot();
  assert.equal(n, 1);
  stub.plugin.emit(structuredClone(VALID));
  stub.plugin.emit({ ...structuredClone(VALID), extra: "ignored" });
  assert.equal(n, 1, "內容相同不應通知");
  assert.equal(m.getDuoHingeSnapshot(), snap1, "內容相同 snapshot 必須是同一物件");
  assert.equal(m.getDuoHingeSnapshot(), m.getDuoHingeSnapshot());
  stub.plugin.emit({ ...VALID, angle: 120 });
  assert.equal(n, 2);
  assert.equal(m.getDuoHingeSnapshot().angle, 120);
  stub.plugin.emit("garbage");
  assert.equal(n, 3);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
  stub.plugin.emit(null);
  assert.equal(n, 3, "unsupported → unsupported 不通知");
  unsub();
});

await test("store（ios）：unsubscribe 後晚到的事件不套用、不通知", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.getStateValue = VALID;
  const m = await freshImport(storeCode);
  let n = 0;
  const unsub = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  unsub();
  await flush();
  const before = m.getDuoHingeSnapshot();
  stub.plugin.emit({ ...VALID, status: "closed" });
  assert.equal(n, 1);
  assert.equal(m.getDuoHingeSnapshot(), before);
});

await test("store（ios）：最後一個訂閱者離開時 snapshot 重設為 UNSUPPORTED；再訂閱重新向原生取值", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.getStateValue = VALID;
  const m = await freshImport(storeCode);
  const u1 = m.subscribeDuoHinge(() => {});
  const u2 = m.subscribeDuoHinge(() => {});
  await flush();
  assert.deepEqual(m.getDuoHingeSnapshot(), VALID);
  u1();
  assert.deepEqual(m.getDuoHingeSnapshot(), VALID, "仍有訂閱者時不得重設");
  u2();
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE, "最後一個訂閱者離開應重設");
  stub.plugin.getStateValue = { ...VALID, status: "closed" };
  let n = 0;
  const u3 = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  assert.equal(stub.plugin.getStateCalls, 2);
  assert.equal(m.getDuoHingeSnapshot().status, "closed");
  assert.equal(n, 1);
  u3();
});

await test("store（ios）：addListener 尚未 resolve 就 unsubscribe → 晚到 handle 被 remove，getState 不呼叫／不套用", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.autoResolve = false;
  const m = await freshImport(storeCode);
  let n = 0;
  const unsub = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  assert.equal(stub.plugin.addListenerCalls, 1);
  unsub();
  await flush();
  const { d, handle } = stub.plugin.addListenerDeferreds[0];
  d.resolve(handle);
  await flush();
  assert.equal(stub.plugin.removeCalls, 1, "過期 session 的 handle 必須 remove");
  assert.equal(stub.plugin.getStateCalls, 0, "過期 session 不應再呼叫 getState");
  assert.equal(n, 0);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
});

await test("store（ios）：getState 尚未 resolve 就 unsubscribe → 晚到結果不套用", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.autoResolve = false;
  const m = await freshImport(storeCode);
  let n = 0;
  const unsub = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  const { d, handle } = stub.plugin.addListenerDeferreds[0];
  d.resolve(handle);
  await flush();
  assert.equal(stub.plugin.getStateCalls, 1);
  unsub();
  await flush();
  assert.equal(stub.plugin.removeCalls, 1);
  stub.plugin.getStateDeferreds[0].resolve(VALID);
  await flush();
  assert.equal(n, 0);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
});

await test("store（ios）：sub→unsub→sub 競態（StrictMode 雙掛載）只有最新 session 生效，舊 handle 被 remove", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.autoResolve = false;
  const m = await freshImport(storeCode);
  let n = 0;
  const l = () => (n += 1);
  const u1 = m.subscribeDuoHinge(l);
  u1();
  const u2 = m.subscribeDuoHinge(l);
  await flush();
  assert.equal(stub.plugin.addListenerCalls, 2);
  const [first, second] = stub.plugin.addListenerDeferreds;
  // 新 session 先 resolve，舊 session 晚到
  second.d.resolve(second.handle);
  await flush();
  first.d.resolve(first.handle);
  await flush();
  assert.equal(stub.plugin.removeCalls, 1, "只有舊 session 的 handle 被 remove");
  assert.equal(stub.plugin.eventListeners[0].removed, true);
  assert.equal(stub.plugin.eventListeners[1].removed, false);
  assert.equal(stub.plugin.getStateCalls, 1, "只有新 session 呼叫 getState");
  stub.plugin.getStateDeferreds[0].resolve(VALID);
  await flush();
  assert.equal(n, 1);
  assert.deepEqual(m.getDuoHingeSnapshot(), VALID);
  // 舊 listener 收到的事件（原生佇列殘留）不得套用
  stub.plugin.eventListeners[0].listener({ ...VALID, status: "closed" });
  assert.equal(m.getDuoHingeSnapshot().status, "partiallyOpen");
  stub.plugin.eventListeners[1].listener({ ...VALID, status: "closed" });
  assert.equal(m.getDuoHingeSnapshot().status, "closed");
  u2();
  await flush();
  assert.equal(stub.plugin.removeCalls, 2);
});

await test("store（ios）：addListener／getState 皆 reject（舊版原生殼無外掛）→ 不 throw、無 unhandled rejection、維持 unsupported", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.addListenerRejects = true;
  stub.plugin.getStateRejects = true;
  const m = await freshImport(storeCode);
  const before = unhandled.length;
  let n = 0;
  const unsub = m.subscribeDuoHinge(() => (n += 1));
  await flush();
  assert.equal(stub.plugin.getStateCalls, 1, "addListener 失敗仍嘗試 getState");
  assert.equal(n, 0);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
  assert.doesNotThrow(unsub);
  await flush();
  const leaked = unhandled.slice(before).map(String).join(", ");
  assert.equal(unhandled.length, before, `unhandled: ${leaked}`);
});

await test("store（ios）：handle.remove reject 不產生 unhandled rejection", async () => {
  setPlatform("ios");
  const stub = setStub();
  stub.plugin.getStateValue = VALID;
  const origAdd = stub.plugin.addListener;
  stub.plugin.addListener = (e, l) =>
    origAdd(e, l).then(() => ({ remove: () => Promise.reject(new Error("remove boom")) }));
  const m = await freshImport(storeCode);
  const before = unhandled.length;
  const unsub = m.subscribeDuoHinge(() => {});
  await flush();
  unsub();
  await flush();
  assert.equal(unhandled.length, before);
});

await test("store（ios）：registerPlugin 丟例外 → 安靜退回 unsupported", async () => {
  setPlatform("ios");
  const stub = setStub({ registerThrows: true });
  const m = await freshImport(storeCode);
  let unsub;
  assert.doesNotThrow(() => {
    unsub = m.subscribeDuoHinge(() => {});
  });
  await flush();
  assert.equal(stub.plugin.getStateCalls, 0);
  assert.equal(m.getDuoHingeSnapshot(), m.UNSUPPORTED_DUO_HINGE_STATE);
  unsub();
});

// ---------------------------------------------------------------------------
// hook：SSR

await test("useDuoHinge：SSR renderToString 使用 server snapshot（unsupported），不呼叫外掛", async () => {
  setPlatform("ssr");
  const stub = setStub();
  const m = await freshImport(hookCode);
  const html = m.render();
  assert.match(html, /&quot;supported&quot;:false/);
  assert.deepEqual(stub.registerCalls, []);
  assert.equal(stub.plugin.getStateCalls, 0);
});

// ---------------------------------------------------------------------------
// 本輪不得在頁面使用

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const HINGE_REF_RE = /useDuoHinge|duo-hinge|DuoHinge/g;

await test("duo-hinge 引用只限允許清單：hook／store 本身、use-duo-laptop、_app（只允許 --duo-hinge-* 變數名）", () => {
  const owners = new Set([
    path.join(SRC, "lib/layout/duo-hinge.ts"),
    path.join(SRC, "hooks/use-duo-hinge.ts"),
  ]);
  const laptopHook = path.join(SRC, "hooks/use-duo-laptop.ts");
  const appRoute = path.join(SRC, "routes/_app.tsx");
  const offenders = [];
  for (const f of walk(SRC)) {
    if (owners.has(f) || /\.test\.tsx?$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    const hits = text.match(HINGE_REF_RE) ?? [];
    if (hits.length === 0) continue;
    if (f === laptopHook) continue;
    if (f === appRoute) {
      // _app 只能出現 CSS 變數名 --duo-hinge-top／--duo-hinge-bottom；不得直接 import duo-hinge 或 useDuoHinge
      const stripped = text.replace(/--duo-hinge-(top|bottom)\b/g, "");
      if (/useDuoHinge|duo-hinge|DuoHinge/.test(stripped)) {
        offenders.push(`${path.relative(ROOT, f)}（非 --duo-hinge-* 的引用）`);
      }
      continue;
    }
    offenders.push(path.relative(ROOT, f));
  }
  assert.deepEqual(offenders, []);
});

await test("_app 透過 use-duo-laptop 取得筆電狀態（不直接 import duo-hinge）", () => {
  const app = readFileSync(path.join(SRC, "routes/_app.tsx"), "utf8");
  assert.match(app, /from "@\/hooks\/use-duo-laptop"/);
  assert.doesNotMatch(app, /from "@\/lib\/layout\/duo-hinge"|from "@\/hooks\/use-duo-hinge"/);
});

delete globalThis.window;
console.log(`\n總結：${passed} 通過 / ${failed} 失敗`);
process.exit(failed ? 1 : 0);
