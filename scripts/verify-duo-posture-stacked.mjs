// verify-duo-posture-stacked.mjs — iPhone Duo「上下版型」（筆電／直向攤平）合一判斷與遲滯 store（任務單 #H3-3-T）
//
// 受測模組：
//   src/lib/layout/duo-laptop.ts   classifyDuoPosture / sameDuoPosture（純函式，表格測試）
//   src/hooks/use-duo-laptop.ts    單一遲滯 store（useDuoLaptop／useDuoFlatPortrait 共用）
//
// 載入方式：esbuild bundle（write:false）→ data: URL 動態 import（同 verify-duo-laptop.mjs）。
//   - "react" 換成 stub：useSyncExternalStore 依呼叫順序記錄 subscribe／getSnapshot，直接驅動 store。
//   - "@/lib/layout/duo-hinge" 換成可控制的 stub。
//   - 假時鐘：替換 globalThis.setTimeout／clearTimeout。
//
// 執行：node scripts/verify-duo-posture-stacked.mjs（不讀 .env、不連網、不寫檔）

import assert from "node:assert/strict";
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
    const detail = String(error?.stack ?? error?.message ?? error)
      .split("\n")
      .slice(0, 14)
      .join("\n     ");
    console.log(`FAIL ${name}\n     ${detail}`);
  }
}
const info = (s) => console.log(`INFO ${s}`);

const REACT_STUB = `
export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  (globalThis.__uses ||= []).push({ subscribe, getSnapshot, getServerSnapshot });
  return getSnapshot();
}
`;
const HINGE_STUB = `
export function getDuoHingeSnapshot() { return globalThis.__hinge.state; }
export function subscribeDuoHinge(listener) {
  const h = globalThis.__hinge;
  h.listeners.add(listener);
  h.subscribeCalls += 1;
  return () => { h.listeners.delete(listener); h.unsubscribeCalls += 1; };
}
`;
const stubPlugin = {
  name: "posture-stubs",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "stub" }));
    b.onResolve({ filter: /^@\/lib\/layout\/duo-hinge$/ }, () => ({ path: "hinge", namespace: "stub" }));
    b.onResolve({ filter: /^@\/lib\/layout\/duo-laptop$/ }, () => ({ path: path.join(SRC, "lib/layout/duo-laptop.ts") }));
    b.onResolve({ filter: /^@\/hooks\/use-duo-laptop$/ }, () => ({ path: path.join(SRC, "hooks/use-duo-laptop.ts") }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: args.path === "react" ? REACT_STUB : HINGE_STUB,
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
  });
  return out.outputFiles[0].text;
}
const pureCode = await bundle(`export * from "@/lib/layout/duo-laptop";`);
const hookCode = await bundle(`export * from "@/hooks/use-duo-laptop";`);
let instance = 0;
async function freshImport(code) {
  instance += 1;
  return import(`data:text/javascript;base64,${Buffer.from(`${code}\n//# instance=${instance}`).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// fixtures

const VP = { width: 669, height: 951 }; // 直向（筆電／直向攤平）
const LAND = { width: 951, height: 669 }; // 橫向（書本／雙欄）
const H_DIV = { x: 0, y: 455.5, width: 669, height: 40, active: true };
const V_DIV = { x: 455.5, y: 0, width: 40, height: 669, active: true };
const hinge = (over = {}) => ({ supported: true, status: "partiallyOpen", angle: 150, divisions: [H_DIV], occlusions: [], ...over });
const LAPTOP = hinge();
const FLAT_DIV = hinge({ status: "fullyOpen", angle: 180 });
const FLAT_MID = hinge({ status: "fullyOpen", angle: 180, divisions: [] });
const CLOSED = hinge({ status: "closed", angle: 0, divisions: [] });
const UNKNOWN = hinge({ status: "unknown", angle: null });
const UNSUPPORTED = { supported: false, status: "unknown", angle: null, divisions: [], occlusions: [] };

const pure = await freshImport(pureCode);
const { classifyDuoPosture: classify, sameDuoPosture: same, DUO_POSTURE_NONE: NONE } = pure;

const L = (t = 455.5, b = 495.5) => ({ posture: "laptop", foldTop: t, foldBottom: b });
const F = (t = 455.5, b = 495.5) => ({ posture: "flat-portrait", foldTop: t, foldBottom: b });
const N = { posture: "none" };
const U = null;
const show = (v) => (v === null ? "null" : JSON.stringify(v));

// ---------------------------------------------------------------------------
// classifyDuoPosture：表格

const TABLE = [
  // ── 明確：none（unsupported／closed）──
  ["hinge null", null, VP, N],
  ["hinge 非物件（字串）", "x", VP, N],
  ["supported false", UNSUPPORTED, VP, N],
  ["supported 1（truthy 非 true）", hinge({ supported: 1 }), VP, N],
  ["supported 'true'", hinge({ supported: "true" }), VP, N],
  ["closed（division 仍合格）", hinge({ status: "closed" }), VP, N],
  ["closed（viewport 不合法也算明確）", CLOSED, { width: 0, height: 0 }, N],
  ["closed（divisions 非陣列）", hinge({ status: "closed", divisions: null }), VP, N],
  // ── 不確定：status ──
  ["status unknown", UNKNOWN, VP, U],
  ["status ''", hinge({ status: "" }), VP, U],
  ["status 'open'", hinge({ status: "open" }), VP, U],
  ["status null", hinge({ status: null }), VP, U],
  ["status unknown＋橫向 viewport", hinge({ status: "unknown", divisions: [V_DIV] }), LAND, U],
  // ── 不確定：viewport／divisions ──
  ["viewport width 0", LAPTOP, { width: 0, height: 951 }, U],
  ["viewport height NaN", LAPTOP, { width: 669, height: NaN }, U],
  ["viewport 負數", LAPTOP, { width: -669, height: 951 }, U],
  ["viewport 字串", LAPTOP, { width: "669", height: 951 }, U],
  ["viewport null", LAPTOP, null, U],
  ["divisions null", hinge({ divisions: null }), VP, U],
  ["divisions 物件", hinge({ divisions: H_DIV }), VP, U],
  // ── 明確：筆電 ──
  ["筆電實測", LAPTOP, VP, L()],
  ["筆電（angle null）", hinge({ angle: null }), VP, L()],
  ["筆電（多個 division，跳過 inactive／直向，取第一個合格）", hinge({ divisions: [{ ...H_DIV, active: false }, V_DIV, null, { ...H_DIV, y: 400 }, H_DIV] }), VP, L(400, 440)],
  ["筆電優先（partiallyOpen＋同 division 不會變直向攤平）", LAPTOP, VP, L()],
  // ── 明確：直向攤平 ──
  ["直向攤平（division）", FLAT_DIV, VP, F()],
  ["直向攤平（無 division→中線）", FLAT_MID, VP, F(475.5, 475.5)],
  ["直向攤平（只有 inactive division→中線）", hinge({ status: "fullyOpen", divisions: [{ ...H_DIV, active: false }] }), VP, F(475.5, 475.5)],
  // ── 明確：none（方向一致但非上下）──
  ["書本（partiallyOpen、橫向 viewport、直向摺痕）", hinge({ divisions: [V_DIV] }), LAND, N],
  ["攤平橫向（fullyOpen、直向摺痕）", hinge({ status: "fullyOpen", divisions: [V_DIV] }), LAND, N],
  ["攤平橫向（fullyOpen、無 division）", FLAT_MID, LAND, N],
  ["半開橫向（partiallyOpen、無 division）", hinge({ divisions: [] }), LAND, N],
  // ── 不確定：方向矛盾（旋轉過渡）／division 暫時消失 ──
  ["直向 viewport＋直向摺痕（partiallyOpen）", hinge({ divisions: [V_DIV] }), VP, U],
  ["直向 viewport＋直向摺痕（fullyOpen）", hinge({ status: "fullyOpen", divisions: [V_DIV] }), VP, U],
  ["橫向 viewport＋舊的橫向摺痕（669 < 951×80%）", LAPTOP, LAND, U],
  ["partiallyOpen＋直向 viewport＋division 暫時消失", hinge({ divisions: [] }), VP, U],
  ["partiallyOpen＋直向 viewport＋只有 inactive division", hinge({ divisions: [{ ...H_DIV, active: false }] }), VP, U],
  ["division 超出右緣（x 100）", hinge({ divisions: [{ ...H_DIV, x: 100 }] }), VP, U],
  ["division NaN 欄位", hinge({ divisions: [{ ...H_DIV, y: NaN }] }), VP, U],
  ["division 正方形", hinge({ divisions: [{ x: 0, y: 300, width: 669, height: 669, active: true }] }), { width: 669, height: 1400 }, U],
  // ── 邊界：上下各 200px ──
  ["上方恰好 200 → 筆電", hinge({ divisions: [{ ...H_DIV, y: 200 }] }), VP, L(200, 240)],
  ["上方 199.9 → none（方向一致、不構成上下）", hinge({ divisions: [{ ...H_DIV, y: 199.9 }] }), VP, N],
  ["下方恰好 200（y 711）→ 筆電", hinge({ divisions: [{ ...H_DIV, y: 711 }] }), VP, L(711, 751)],
  ["下方 199.9（y 711.1）→ none", hinge({ divisions: [{ ...H_DIV, y: 711.1 }] }), VP, N],
  ["直向攤平 division 上方 199.9 → none", hinge({ status: "fullyOpen", divisions: [{ ...H_DIV, y: 199.9 }] }), VP, N],
  ["直向攤平中線：高 400（半 200）→ 中線", FLAT_MID, { width: 300, height: 400 }, F(200, 200)],
  ["直向攤平中線：高 399.8（半 199.9）→ 不構成；無 active division→不確定", FLAT_MID, { width: 300, height: 399.8 }, U],
  ["viewport 太矮（669×600，下方不足）→ none", LAPTOP, { width: 669, height: 600 }, N],
  // ── 邊界：80% 寬度 ──
  ["寬度恰好 80%（535.2）→ 筆電", hinge({ divisions: [{ ...H_DIV, width: 669 * 0.8 }] }), VP, L()],
  ["寬度 80% − 0.01 → 不確定（範圍不一致）", hinge({ divisions: [{ ...H_DIV, width: 669 * 0.8 - 0.01 }] }), VP, U],
  ["書本直向摺痕高度恰好 80%（535.2）→ none", hinge({ divisions: [{ ...V_DIV, height: 669 * 0.8 }] }), LAND, N],
  ["書本直向摺痕高度 80% − 0.01 → 不確定", hinge({ divisions: [{ ...V_DIV, height: 669 * 0.8 - 0.01 }] }), LAND, U],
  // ── 邊界：EDGE_TOLERANCE（1px）──
  ["x −1（容許）→ 筆電", hinge({ divisions: [{ ...H_DIV, x: -1, width: 670 }] }), VP, L()],
  ["x −1.01 → 不確定", hinge({ divisions: [{ ...H_DIV, x: -1.01, width: 670 }] }), VP, U],
  ["x＋width＝vw＋1（容許）→ 筆電", hinge({ divisions: [{ ...H_DIV, width: 670 }] }), VP, L()],
  ["x＋width＝vw＋1.01 → 不確定", hinge({ divisions: [{ ...H_DIV, width: 670.01 }] }), VP, U],
  ["書本 y＋height＝vh＋1（容許）→ none", hinge({ divisions: [{ ...V_DIV, height: 670 }] }), LAND, N],
  ["書本 y＋height＝vh＋1.01 → 不確定", hinge({ divisions: [{ ...V_DIV, height: 670.01 }] }), LAND, U],
  ["書本 y −1（容許）→ none", hinge({ divisions: [{ ...V_DIV, y: -1 }] }), LAND, N],
  ["書本 y −1.01 → 不確定", hinge({ divisions: [{ ...V_DIV, y: -1.01 }] }), LAND, U],
];

await test(`classifyDuoPosture 表格（${TABLE.length} 列）`, () => {
  const bad = [];
  for (const [name, h, vp, want] of TABLE) {
    let got;
    try {
      got = classify(h, vp);
    } catch (e) {
      bad.push(`${name}：throw ${e.message}`);
      continue;
    }
    const ok = want === null ? got === null : got !== null && JSON.stringify({ ...got }) === JSON.stringify(want);
    if (!ok) bad.push(`${name}：預期 ${show(want)}，實際 ${show(got)}`);
  }
  assert.deepEqual(bad, []);
});

await test("classifyDuoPosture：none 回傳 frozen 常數；明確結果 frozen；不 throw", () => {
  assert.equal(classify(null, VP), NONE);
  assert.equal(classify(CLOSED, VP), NONE);
  assert.equal(classify(hinge({ divisions: [V_DIV] }), LAND), NONE);
  assert.equal(Object.isFrozen(NONE), true);
  assert.equal(Object.isFrozen(classify(LAPTOP, VP)), true);
  assert.equal(Object.isFrozen(classify(FLAT_MID, VP)), true);
  for (const j of [undefined, 0, 1, NaN, true, Symbol("s"), () => 1, [], Object.create(null)]) {
    assert.doesNotThrow(() => classify(j, VP));
    assert.doesNotThrow(() => classify(LAPTOP, j));
    assert.doesNotThrow(() => classify(hinge({ divisions: [j] }), VP));
  }
});

await test("sameDuoPosture：同內容 true；姿勢或摺痕不同 false；none 與 none true", () => {
  assert.equal(same(classify(LAPTOP, VP), classify(structuredClone(LAPTOP), { ...VP })), true);
  assert.equal(same(NONE, { posture: "none" }), true);
  assert.equal(same(classify(LAPTOP, VP), classify(FLAT_DIV, VP)), false, "同摺痕不同姿勢");
  assert.equal(same(classify(FLAT_DIV, VP), classify(FLAT_MID, VP)), false);
  assert.equal(same(NONE, classify(LAPTOP, VP)), false);
  assert.equal(same(classify(LAPTOP, VP), NONE), false);
});

// ---------------------------------------------------------------------------
// store：假時鐘

function installClock() {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const clock = {
    now: 0,
    seq: 0,
    timers: new Map(),
    advance(ms) {
      const end = clock.now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of clock.timers) {
          if (t.at <= end && (next == null || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) next = [id, t];
        }
        if (!next) break;
        clock.timers.delete(next[0]);
        clock.now = next[1].at;
        next[1].fn();
      }
      clock.now = end;
    },
    restore() {
      globalThis.setTimeout = realSet;
      globalThis.clearTimeout = realClear;
    },
  };
  globalThis.setTimeout = (fn, ms = 0) => {
    clock.seq += 1;
    clock.timers.set(clock.seq, { fn, at: clock.now + ms });
    return clock.seq;
  };
  globalThis.clearTimeout = (id) => clock.timers.delete(id);
  return clock;
}
function installWindow(vp) {
  const handlers = new Map();
  const win = {
    innerWidth: vp.width,
    innerHeight: vp.height,
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    dispatch(type) {
      for (const fn of [...(handlers.get(type) ?? [])]) fn();
    },
    count(type) {
      return handlers.get(type)?.size ?? 0;
    },
    setViewport(next) {
      win.innerWidth = next.width;
      win.innerHeight = next.height;
    },
  };
  globalThis.window = win;
  return win;
}
function installHinge(state) {
  const h = {
    state,
    listeners: new Set(),
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    set(next) {
      h.state = next;
      for (const l of [...h.listeners]) l();
    },
  };
  globalThis.__hinge = h;
  return h;
}

async function setup(code = hookCode) {
  const clock = installClock();
  const win = installWindow(VP);
  const h = installHinge(UNSUPPORTED);
  const m = await freshImport(code);
  globalThis.__uses = [];
  m.useDuoLaptop();
  m.useDuoFlatPortrait();
  const [lap, flat] = globalThis.__uses;
  assert.equal(lap.subscribe, flat.subscribe, "useDuoLaptop 與 useDuoFlatPortrait 應共用同一個 subscribe（單一 store）");
  const pair = () => {
    const a = lap.getSnapshot();
    const b = flat.getSnapshot();
    return a.laptop ? `laptop@${a.foldTop}/${a.foldBottom}` + (b.flat ? "+FLAT" : "") : b.flat ? `flat@${b.foldTop}/${b.foldBottom}` : "none";
  };
  return { clock, win, h, m, subscribe: lap.subscribe, getLaptop: lap.getSnapshot, getFlat: flat.getSnapshot, lapServer: lap.getServerSnapshot, flatServer: flat.getServerSnapshot, pair };
}
const STORE_TESTS = [];
async function runStore(fn, code) {
  const env = await setup(code);
  try {
    await fn(env);
  } finally {
    env.clock.restore();
    delete globalThis.window;
  }
}
async function storeTest(name, fn) {
  STORE_TESTS.push({ name, fn });
  await test(name, () => runStore(fn));
}

await storeTest("store：server snapshot 恆為非上下；未訂閱時兩者皆否", async ({ pair, lapServer, flatServer }) => {
  assert.equal(pair(), "none");
  assert.deepEqual(lapServer(), { laptop: false });
  assert.deepEqual(flatServer(), { flat: false });
});

await storeTest("store：筆電 → 不確定×6（unknown／方向矛盾／division 消失／viewport 0／橫向舊摺痕）→ 直向攤平：中途無 none、無兩者並存，只通知一次", async ({ h, win, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const seen = [];
  const unsub = subscribe(() => seen.push(pair()));
  seen.length = 0;
  assert.equal(pair(), "laptop@455.5/495.5");
  const timeline = [];
  const step = (label, fn, ms) => {
    fn();
    clock.advance(ms);
    timeline.push(`${label}→${pair()}`);
  };
  step("unknown", () => h.set(UNKNOWN), 40);
  step("矛盾 V_DIV", () => h.set(hinge({ divisions: [V_DIV] })), 40);
  step("division 消失", () => h.set(hinge({ divisions: [] })), 40);
  step("viewport 0", () => {
    h.state = LAPTOP;
    win.setViewport({ width: 0, height: 0 });
    win.dispatch("resize");
  }, 40);
  step("橫向舊摺痕", () => {
    win.setViewport(LAND);
    win.dispatch("orientationchange");
  }, 40);
  step("fullyOpen 矛盾", () => {
    win.setViewport(VP);
    h.set(hinge({ status: "fullyOpen", divisions: [V_DIV] }));
  }, 300);
  assert.deepEqual(seen, [], "不確定期間不得通知：" + timeline.join(" | "));
  assert.ok(timeline.every((t) => t.endsWith("laptop@455.5/495.5")), "過渡中應維持筆電：" + timeline.join(" | "));
  h.set(FLAT_MID);
  clock.advance(149);
  assert.equal(pair(), "laptop@455.5/495.5", "明確直向攤平未滿 150ms");
  clock.advance(1);
  assert.equal(pair(), "flat@475.5/475.5");
  assert.deepEqual(seen, ["flat@475.5/475.5"], "只通知一次，且通知當下兩個 hook 已同時改變");
  assert.ok(![...seen, ...timeline].some((s) => s === "none" || s.includes("+FLAT")));
  // 反向：直向攤平 → 不確定 → 筆電
  seen.length = 0;
  h.set(UNKNOWN);
  clock.advance(500);
  h.set(hinge({ divisions: [] }));
  clock.advance(500);
  assert.equal(pair(), "flat@475.5/475.5");
  h.set(LAPTOP);
  clock.advance(150);
  assert.deepEqual(seen, ["laptop@455.5/495.5"]);
  unsub();
});

await storeTest("store：筆電 → unknown 持續 10 秒（含 resize）→ 維持筆電、無計時器、無通知", async ({ h, win, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0;
  const snap = pair();
  h.set(UNKNOWN);
  for (let i = 0; i < 20; i += 1) {
    clock.advance(500);
    win.dispatch("resize");
  }
  assert.equal(pair(), snap);
  assert.equal(n, 0);
  assert.equal(clock.timers.size, 0, "不確定不得排程計時器");
  unsub();
});

await storeTest("store：筆電 → closed：149ms 維持、150ms 變 none；只通知一次", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0;
  h.set(CLOSED);
  clock.advance(149);
  assert.equal(pair(), "laptop@455.5/495.5");
  clock.advance(1);
  assert.equal(pair(), "none");
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：筆電 → unknown → closed（原生先送 unknown 再送 closed）→ closed 後 150ms 一定回到 none", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const unsub = subscribe(() => {});
  h.set(UNKNOWN);
  clock.advance(3000);
  assert.equal(pair(), "laptop@455.5/495.5");
  h.set(CLOSED);
  clock.advance(149);
  assert.equal(pair(), "laptop@455.5/495.5");
  clock.advance(1);
  assert.equal(pair(), "none");
  unsub();
});

await storeTest("store：筆電 → closed／雙欄 → unsupported 也是明確（150ms 回到 none）", async ({ h, win, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const unsub = subscribe(() => {});
  h.set(UNSUPPORTED);
  clock.advance(150);
  assert.equal(pair(), "none", "unsupported");
  h.set(LAPTOP);
  clock.advance(150);
  win.setViewport(LAND);
  h.set(hinge({ divisions: [V_DIV] }));
  clock.advance(150);
  assert.equal(pair(), "none", "書本／雙欄姿勢（橫向 viewport＋直向摺痕）");
  unsub();
});

// #H3-3-T2：計時器到期點（相對目前時間），用來區分 150ms 穩定計時與 1000ms fallback
const dueIn = (clock) => [...clock.timers.values()].map((t) => t.at - clock.now).sort((a, b) => a - b);

// #H3-3-T2 改寫：新規格下「有 pending 時不確定」會排程 1000ms fallback（舊斷言 timers.size === 0 已不成立）
await storeTest("store：明確切換進行中插入不確定 → 150ms 計時取消、改排 1000ms fallback；回到明確後重新計時 150ms（不確定不計入）", async ({ h, subscribe, pair, clock }) => {
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0;
  h.set(LAPTOP);
  assert.deepEqual(dueIn(clock), [150], "明確新結果：只有 150ms 穩定計時");
  clock.advance(100);
  h.set(UNKNOWN);
  assert.deepEqual(dueIn(clock), [1000], "不確定：150ms 計時取消，只剩 1000ms fallback");
  clock.advance(20);
  assert.equal(pair(), "none");
  h.set(LAPTOP);
  assert.deepEqual(dueIn(clock), [150], "回到明確：fallback 取消、重新計時 150ms");
  clock.advance(149);
  assert.equal(pair(), "none", "自最後一次明確結果起未滿 150ms");
  clock.advance(1);
  assert.equal(pair(), "laptop@455.5/495.5");
  assert.equal(n, 1);
  assert.equal(clock.timers.size, 0, "提交後無殘留計時器");
  // 原本預定的 fallback 時點（t=1100）之後也不得再有任何通知
  clock.advance(5000);
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：pending＋連續不確定：999ms 不提交、1000ms 提交（自進入不確定起算；期間 resize／不同種不確定不重設）", async ({ h, win, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const seen = [];
  const unsub = subscribe(() => seen.push(pair()));
  seen.length = 0;
  h.set(CLOSED); // t=0 pending none
  clock.advance(100);
  h.set(UNKNOWN); // t=100 進入不確定
  const kinds = [hinge({ divisions: [V_DIV] }), hinge({ divisions: [] }), UNKNOWN];
  for (let i = 0; i < 9; i += 1) {
    clock.advance(100);
    if (i % 2) win.dispatch("resize");
    else h.set(kinds[i % kinds.length]);
  }
  clock.advance(99); // t=1099：不確定已連續 999ms
  assert.equal(pair(), "laptop@455.5/495.5", "不確定 999ms 不得提交");
  assert.deepEqual(seen, []);
  clock.advance(1); // t=1100
  assert.equal(pair(), "none", "不確定滿 1000ms 提交 pending");
  assert.deepEqual(seen, ["none"]);
  assert.equal(clock.timers.size, 0, "提交後無殘留計時器");
  clock.advance(10_000);
  assert.deepEqual(seen, ["none"]);
  unsub();
});

await storeTest("store：pending＋不確定期間回到 current → 清空 pending，之後再不確定（含 10 秒）不再提交、不排程", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0;
  h.set(CLOSED);
  clock.advance(50);
  h.set(UNKNOWN);
  clock.advance(500);
  h.set(LAPTOP); // 回到 current
  assert.equal(clock.timers.size, 0, "回到 current：fallback 與穩定計時都取消");
  h.set(UNKNOWN);
  assert.equal(clock.timers.size, 0, "pending 已清空：不確定不得排程 fallback");
  clock.advance(10_000);
  assert.equal(pair(), "laptop@455.5/495.5");
  assert.equal(n, 0, "不得提交舊的 pending（none）");
  unsub();
});

await storeTest("store：pending＋不確定期間換成另一明確結果 → 重新計時 150ms（跨過原 fallback 時點也不提交舊 pending）", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const seen = [];
  const unsub = subscribe(() => seen.push(pair()));
  seen.length = 0;
  h.set(CLOSED); // pending none
  clock.advance(50);
  h.set(UNKNOWN); // fallback 原定 t=1050
  clock.advance(950); // t=1000
  h.set(FLAT_MID);
  assert.deepEqual(dueIn(clock), [150], "換成新結果：只剩新的 150ms 計時");
  clock.advance(149); // t=1149（已過 1050）
  assert.equal(pair(), "laptop@455.5/495.5", "不得提交舊 pending none、新結果未滿 150ms");
  clock.advance(1);
  assert.equal(pair(), "flat@475.5/475.5");
  assert.deepEqual(seen, ["flat@475.5/475.5"], "不得經過 none");
  // 新 pending 在不確定期間也走 fallback：直向攤平 → 筆電（pending）→ 不確定 1000ms → 提交筆電
  h.set(LAPTOP);
  clock.advance(60);
  h.set(hinge({ divisions: [V_DIV] }));
  clock.advance(999);
  assert.equal(pair(), "flat@475.5/475.5");
  clock.advance(1);
  assert.equal(pair(), "laptop@455.5/495.5");
  assert.deepEqual(seen, ["flat@475.5/475.5", "laptop@455.5/495.5"]);
  unsub();
});

// 旋轉抖動：明確結果 100ms／矛盾（不確定）40–60ms 反覆，總時長遠超 1000ms
for (const [label, from, to] of [
  ["直向攤平 → 筆電", FLAT_MID, LAPTOP],
  ["筆電 → 直向攤平", LAPTOP, FLAT_DIV],
  ["筆電 → 筆電（current 本身抖動）", LAPTOP, LAPTOP],
]) {
  await storeTest(`store：旋轉抖動 ${label}（明確 100ms／矛盾 40–60ms ×30）：期間不切換、不出現 none；穩定後 150ms 切換`, async ({ h, subscribe, pair, clock }) => {
    h.state = from;
    const seen = [];
    const trace = [];
    const unsub = subscribe(() => seen.push(pair()));
    seen.length = 0;
    const start = pair();
    assert.notEqual(start, "none", "起始應為上下版型");
    const contra = [hinge({ divisions: [V_DIV] }), hinge({ status: "fullyOpen", divisions: [V_DIV] }), hinge({ divisions: [] }), UNKNOWN];
    for (let i = 0; i < 30; i += 1) {
      h.set(to);
      clock.advance(100);
      trace.push(pair());
      h.set(contra[i % contra.length]);
      clock.advance(40 + ((i * 7) % 21));
      trace.push(pair());
    }
    assert.ok(trace.every((s) => s === start), "抖動期間版型改變：" + [...new Set(trace)].join(","));
    assert.deepEqual(seen, [], "抖動期間不得通知");
    h.set(to);
    clock.advance(149);
    assert.equal(pair(), start);
    clock.advance(1);
    const end = pair();
    assert.notEqual(end, "none");
    assert.deepEqual(seen, end === start ? [] : [end], "穩定後只通知一次");
    clock.advance(5000);
    assert.equal(clock.timers.size, 0);
    unsub();
  });
}

await storeTest("store：首次訂閱時不確定 → 當作 none（不排程），之後明確筆電需 150ms", async ({ h, subscribe, pair, clock }) => {
  h.state = UNKNOWN;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0;
  assert.equal(pair(), "none");
  assert.equal(clock.timers.size, 0);
  h.set(hinge({ divisions: [V_DIV] })); // 仍不確定
  clock.advance(500);
  assert.equal(pair(), "none");
  h.set(LAPTOP);
  clock.advance(149);
  assert.equal(pair(), "none");
  clock.advance(1);
  assert.equal(pair(), "laptop@455.5/495.5");
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：首次訂閱時直接採用明確結果（直向攤平）", async ({ h, subscribe, pair, clock }) => {
  h.state = FLAT_DIV;
  const unsub = subscribe(() => {});
  assert.equal(pair(), "flat@455.5/495.5");
  assert.equal(clock.timers.size, 0);
  unsub();
});

await storeTest("store：筆電↔直向攤平（同摺痕）明確互換：150ms、單次通知，snapshot 物件在無變化時不變", async ({ h, subscribe, getLaptop, getFlat, pair, clock }) => {
  h.state = LAPTOP;
  const seen = [];
  const unsub = subscribe(() => seen.push(pair()));
  seen.length = 0;
  const l0 = getLaptop();
  const f0 = getFlat();
  h.set(hinge({ angle: 160 }));
  clock.advance(1000);
  assert.equal(getLaptop(), l0, "angle 變化不換物件");
  assert.equal(getFlat(), f0);
  h.set(FLAT_DIV);
  clock.advance(150);
  assert.deepEqual(seen, ["flat@455.5/495.5"]);
  assert.notEqual(getFlat(), f0);
  assert.deepEqual(getLaptop(), { laptop: false });
  unsub();
});

await storeTest("store：StrictMode sub→unsub→sub：只有一組 hinge／window 監聽、立即採用當下結果、無殘留計時器", async ({ h, win, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  const u1 = subscribe(() => {});
  u1();
  const u2 = subscribe(() => {});
  assert.equal(pair(), "laptop@455.5/495.5");
  assert.equal(h.listeners.size, 1);
  assert.equal(win.count("resize"), 1);
  assert.equal(win.count("orientationchange"), 1);
  assert.equal(clock.timers.size, 0);
  // 兩個 hook（同一 store）各自訂閱：只註冊一次
  const u3 = subscribe(() => {});
  assert.equal(h.subscribeCalls, 2, "第二個訂閱者不得再訂閱 hinge");
  u3();
  u2();
  assert.equal(h.listeners.size, 0);
  assert.equal(win.count("resize"), 0);
});

await storeTest("store：退訂時有 pending 計時 → 清除並重設；重訂時當下不確定 → none", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  let n = 0;
  const u1 = subscribe(() => (n += 1));
  h.set(CLOSED);
  assert.equal(clock.timers.size, 1);
  u1();
  assert.equal(clock.timers.size, 0, "退訂必須清計時器");
  assert.equal(pair(), "none", "退訂後重設");
  n = 0;
  clock.advance(1000);
  assert.equal(n, 0);
  h.state = UNKNOWN;
  const u2 = subscribe(() => {});
  assert.equal(pair(), "none", "重訂當下不確定 → none（不沿用退訂前的筆電）");
  h.state = FLAT_MID;
  u2();
  const u3 = subscribe(() => {});
  assert.equal(pair(), "flat@475.5/475.5", "重訂當下明確 → 直接採用");
  u3();
});

// #H3-3-T2：原 INFO 改為正式斷言。fallback 自進入不確定（t=50）起算 1000ms → t=1050 提交 none
await storeTest("store：筆電 → closed(t=0) → unknown(t=50) 之後不再送明確狀態（含 resize 到 400×870）→ t=1049 仍筆電、t=1050 回到 none、只通知一次", async ({ h, win, subscribe, pair, getLaptop, getFlat, clock }) => {
  h.state = LAPTOP;
  const seen = [];
  const unsub = subscribe(() => seen.push(pair()));
  seen.length = 0;
  h.set(CLOSED);
  clock.advance(50);
  h.set(hinge({ status: "unknown", divisions: [] }));
  win.setViewport({ width: 400, height: 870 });
  win.dispatch("resize");
  clock.advance(998); // t=1048
  win.dispatch("resize");
  clock.advance(1); // t=1049
  assert.equal(pair(), "laptop@455.5/495.5", "fallback 前維持筆電");
  clock.advance(1); // t=1050
  assert.equal(pair(), "none", "約 1 秒內必須回到 none");
  assert.deepEqual(getLaptop(), { laptop: false }, "筆電 snapshot 清除（_app 依此移除 --duo-hinge-*）");
  assert.deepEqual(getFlat(), { flat: false });
  assert.deepEqual(seen, ["none"]);
  clock.advance(60_000);
  assert.deepEqual(seen, ["none"]);
  assert.equal(clock.timers.size, 0);
  unsub();
});

await storeTest("store：退訂時 fallback 計時中 → 清除，之後不提交；StrictMode 再訂閱以當下結果（不確定→none）", async ({ h, subscribe, pair, clock }) => {
  h.state = LAPTOP;
  let n = 0;
  const u1 = subscribe(() => (n += 1));
  h.set(CLOSED);
  clock.advance(50);
  h.set(UNKNOWN);
  assert.deepEqual(dueIn(clock), [1000]);
  u1();
  assert.equal(clock.timers.size, 0, "退訂必須清 fallback");
  const u2 = subscribe(() => (n += 1));
  assert.equal(pair(), "none", "再訂閱當下不確定 → none");
  assert.equal(clock.timers.size, 0, "再訂閱當下不確定不得排程（無 pending）");
  n = 0;
  clock.advance(5000);
  assert.equal(n, 0);
  u2();
});

// ---------------------------------------------------------------------------
// #H3-3-T2 mutation 自我檢查：在記憶體中把 use-duo-laptop.ts 改成常見錯誤寫法（不寫檔），
//   上方 store 測試必須至少讓指定的測試失敗，證明斷言確實覆蓋到規格（而非恆真）。
const HOOK_PATH = path.join(SRC, "hooks/use-duo-laptop.ts");
const hookSrc = (await import("node:fs")).readFileSync(HOOK_PATH, "utf8");
const MUTANTS = [
  {
    name: "不確定不排程 fallback（舊版行為）",
    from: "  if (pending == null || fallbackTimer != null) return;\n  fallbackTimer = setTimeout(onUncertainFallback, UNCERTAIN_FALLBACK_MS);",
    to: "  return;",
    kills: ["999ms 不提交、1000ms 提交", "t=1050 回到 none"],
  },
  {
    name: "每次不確定事件都重設 fallback（非連續起算）",
    from: "if (pending == null || fallbackTimer != null) return;",
    to: "if (pending == null) return; clearFallback();",
    kills: ["999ms 不提交、1000ms 提交", "t=1050 回到 none"],
  },
  {
    // handleChange 的 clearFallback() 單獨移除是等價變異（schedule／clearPending 也會清），故同時讓 clearPending 不清 fallback
    name: "收到明確結果不取消 fallback",
    from: ["  clearFallback();\n  if (sameDuoPosture(current.posture, next)) {\n    clearPending();", "function clearPending() {\n  clearStableTimer();\n  clearFallback();"],
    to: ["  if (sameDuoPosture(current.posture, next)) {\n    clearPending();", "function clearPending() {\n  clearStableTimer();"],
    kills: ["換成另一明確結果", "回到 current → 清空 pending"],
  },
  {
    name: "不確定時丟棄 pending",
    from: "function enterUncertain() {\n  clearStableTimer();",
    to: "function enterUncertain() {\n  clearStableTimer(); pending = null;",
    kills: ["999ms 不提交、1000ms 提交", "t=1050 回到 none"],
  },
  {
    name: "沒有 pending 也排程 fallback（退回 none）",
    from: "if (pending == null || fallbackTimer != null) return;",
    to: 'if (fallbackTimer != null) return; if (pending == null) pending = { posture: "none" };',
    kills: ["unknown 持續 10 秒", "回到 current → 清空 pending"],
  },
  {
    name: "不確定不重設 150ms 穩定計時",
    from: "function enterUncertain() {\n  clearStableTimer();",
    to: "function enterUncertain() {",
    kills: ["回到明確後重新計時 150ms", "旋轉抖動"],
  },
];
async function bundleHookFrom(source) {
  const out = await build({
    stdin: { contents: `export * from "@/hooks/use-duo-laptop";`, resolveDir: ROOT, loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    plugins: [
      {
        name: "mutant",
        setup(b) {
          b.onLoad({ filter: /use-duo-laptop\.ts$/ }, () => ({ contents: source, loader: "ts", resolveDir: path.dirname(HOOK_PATH) }));
        },
      },
      stubPlugin,
    ],
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}
for (const M of MUTANTS) {
  await test(`mutation：${M.name} → 被測試抓到（${M.kills.join("／")}）`, async () => {
    const froms = [M.from].flat();
    const tos = [M.to].flat();
    let mutated = hookSrc;
    froms.forEach((f, i) => {
      assert.ok(mutated.includes(f), "mutation 錨點不存在（實作已改寫，請更新 mutation）：" + f.slice(0, 60));
      mutated = mutated.replace(f, tos[i]);
    });
    const code = await bundleHookFrom(mutated);
    const failedNames = [];
    for (const t of STORE_TESTS) {
      try {
        await runStore(t.fn, code);
      } catch {
        failedNames.push(t.name);
      }
    }
    for (const k of M.kills) assert.ok(failedNames.some((n) => n.includes(k)), `「${k}」未抓到此 mutation；失敗的測試：${JSON.stringify(failedNames)}`);
  });
}

delete globalThis.window;
delete globalThis.__hinge;
delete globalThis.__uses;
console.log(`\n總結：${passed} 通過 / ${failed} 失敗`);
process.exit(failed ? 1 : 0);
