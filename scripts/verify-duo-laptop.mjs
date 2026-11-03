// verify-duo-laptop.mjs — iPhone Duo「筆電半開」姿勢判斷（任務單 #H2a-2）
//
// 受測模組：
//   src/lib/layout/duo-laptop.ts   resolveDuoLaptop / sameDuoLaptop（純函式）
//   src/hooks/use-duo-laptop.ts    module-level store（150ms 穩定延遲、訂閱生命週期）
//
// 載入方式：esbuild bundle（write:false）→ data: URL 動態 import。
//   - use-duo-laptop 的 "react" 換成 stub：useSyncExternalStore 記錄 subscribe／getSnapshot／getServerSnapshot，
//     直接驅動 store（React 的 useSyncExternalStore 只是呼叫這三個函式；此處驗證 store 本身的行為）。
//   - "@/lib/layout/duo-hinge" 換成可控制的 stub（快照與 listener 由測試控制）。
//   - "@/lib/layout/duo-laptop" 使用真實檔案。
//   - 假時鐘：替換 globalThis.setTimeout／clearTimeout，手動推進時間。
//
// 執行：node scripts/verify-duo-laptop.mjs（不讀 .env、不連網、不寫檔）

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
      .slice(0, 12)
      .join("\n     ");
    console.log(`FAIL ${name}\n     ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// bundle

const REACT_STUB = `
export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  globalThis.__uses = { subscribe, getSnapshot, getServerSnapshot };
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
  name: "laptop-stubs",
  setup(b) {
    b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "stub" }));
    b.onResolve({ filter: /^@\/lib\/layout\/duo-hinge$/ }, () => ({ path: "hinge", namespace: "stub" }));
    b.onResolve({ filter: /^@\/lib\/layout\/duo-laptop$/ }, () => ({
      path: path.join(SRC, "lib/layout/duo-laptop.ts"),
    }));
    b.onResolve({ filter: /^@\/hooks\/use-duo-laptop$/ }, () => ({
      path: path.join(SRC, "hooks/use-duo-laptop.ts"),
    }));
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
  const src = `${code}\n//# instance=${instance}`;
  return import(`data:text/javascript;base64,${Buffer.from(src).toString("base64")}`);
}

// ---------------------------------------------------------------------------
// fixtures（使用者實測 log）

const LAPTOP_VP = { width: 669, height: 951 };
const BOOK_VP = { width: 951, height: 669 };
const H_DIV = { x: 0, y: 455.5, width: 669, height: 40, active: true };
const V_DIV = { x: 455.5, y: 0, width: 40, height: 669, active: true };
const hinge = (over = {}) => ({
  supported: true,
  status: "partiallyOpen",
  angle: 150,
  divisions: [H_DIV],
  occlusions: [],
  ...over,
});
const LAPTOP_HINGE = hinge();
const BOOK_HINGE = hinge({ divisions: [V_DIV], angle: 120 });
const UNSUPPORTED = {
  supported: false,
  status: "unknown",
  angle: null,
  divisions: [],
  occlusions: [],
};

const pure = await freshImport(pureCode);
const { resolveDuoLaptop: resolve, sameDuoLaptop: same, NOT_DUO_LAPTOP: NOT } = pure;

const isNot = (r, msg) => {
  assert.equal(r, NOT, msg ?? "應回傳 NOT_DUO_LAPTOP 常數");
  assert.deepEqual(r, { laptop: false });
};

// ---------------------------------------------------------------------------
// resolveDuoLaptop：實測 log

await test("實測筆電：viewport 669×951、division (0,455.5,669×40)、partiallyOpen → laptop，摺痕 455.5／495.5", () => {
  for (const angle of [127, 150, 174, null]) {
    const r = resolve(hinge({ angle }), LAPTOP_VP);
    assert.deepEqual(r, { laptop: true, foldTop: 455.5, foldBottom: 495.5 }, `angle=${angle}`);
  }
});

await test("實測書本：viewport 951×669、division (455.5,0,40×669) → 非筆電", () => {
  isNot(resolve(BOOK_HINGE, BOOK_VP));
});

await test("旋轉過渡：division 橫向但 viewport 951×669 → 非筆電", () => {
  isNot(resolve(LAPTOP_HINGE, BOOK_VP));
  // 即使摺痕上下都夠高（自訂 viewport），寬度不足 80% 仍不算
  isNot(resolve(LAPTOP_HINGE, { width: 951, height: 1200 }));
});

await test("旋轉過渡：division 直向但 viewport 669×951 → 非筆電", () => {
  isNot(resolve(BOOK_HINGE, LAPTOP_VP));
});

await test("旋轉過渡：division 超出 viewport（x 範圍／y＋height 超出）→ 非筆電", () => {
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, x: 100 }] }), LAPTOP_VP), "x+width 超出右緣");
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, x: -50, width: 700 }] }), LAPTOP_VP), "x 為負");
  isNot(
    resolve(hinge({ divisions: [{ ...H_DIV, y: 940, height: 40 }] }), LAPTOP_VP),
    "y+height 超出底部",
  );
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, y: -1 }] }), LAPTOP_VP), "y 為負");
  // 原生四捨五入 1px 容許
  assert.equal(resolve(hinge({ divisions: [{ ...H_DIV, x: -0.5, width: 670 }] }), LAPTOP_VP).laptop, true);
});

await test("division 寬度門檻：恰好 80% 為筆電、低於 80% 不算", () => {
  const w = 669 * 0.8;
  assert.equal(resolve(hinge({ divisions: [{ ...H_DIV, width: w }] }), LAPTOP_VP).laptop, true);
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, width: w - 0.01 }] }), LAPTOP_VP));
});

// ---------------------------------------------------------------------------
// resolveDuoLaptop：狀態

await test("fullyOpen／closed／unknown／未知 status 皆非筆電（division 與 viewport 都符合時）", () => {
  for (const status of ["fullyOpen", "closed", "unknown", "open", "", null, undefined, 1]) {
    isNot(resolve(hinge({ status }), LAPTOP_VP), `status=${String(status)}`);
  }
});

await test("unsupported（含 supported 非 true 的 truthy 值）→ 非筆電", () => {
  isNot(resolve(UNSUPPORTED, LAPTOP_VP));
  for (const supported of [false, 1, "true", null, undefined]) {
    isNot(resolve(hinge({ supported }), LAPTOP_VP), `supported=${String(supported)}`);
  }
});

await test("division inactive（false、缺省、truthy 非 true）→ 非筆電", () => {
  for (const active of [false, undefined, 1, "true", null]) {
    const d = { ...H_DIV, active };
    if (active === undefined) delete d.active;
    isNot(resolve(hinge({ divisions: [d] }), LAPTOP_VP), `active=${String(active)}`);
  }
});

await test("divisions 空陣列／非陣列 → 非筆電；多個 division 時採用第一個合格者", () => {
  isNot(resolve(hinge({ divisions: [] }), LAPTOP_VP));
  for (const divisions of [null, undefined, H_DIV, "x", { 0: H_DIV, length: 1 }]) {
    isNot(resolve(hinge({ divisions }), LAPTOP_VP), `divisions=${JSON.stringify(divisions)}`);
  }
  const r = resolve(
    hinge({ divisions: [{ ...H_DIV, active: false }, V_DIV, null, { ...H_DIV, y: 400 }, H_DIV] }),
    LAPTOP_VP,
  );
  assert.deepEqual(r, { laptop: true, foldTop: 400, foldBottom: 440 });
});

await test("occlusions 不影響判斷", () => {
  const r = resolve(hinge({ occlusions: [V_DIV, { x: 0, y: 0, width: 669, height: 951, active: true }] }), LAPTOP_VP);
  assert.equal(r.laptop, true);
});

// ---------------------------------------------------------------------------
// resolveDuoLaptop：上下高度

await test("摺痕上方或下方不足 200px → 非筆電；恰好 200px 為筆電", () => {
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, y: 199.9 }] }), LAPTOP_VP), "上方 199.9");
  assert.equal(resolve(hinge({ divisions: [{ ...H_DIV, y: 200 }] }), LAPTOP_VP).laptop, true, "上方 200");
  // 下方：951 - (y + 40)
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, y: 711.1 }] }), LAPTOP_VP), "下方 199.9");
  assert.equal(resolve(hinge({ divisions: [{ ...H_DIV, y: 711 }] }), LAPTOP_VP).laptop, true, "下方 200");
  isNot(resolve(LAPTOP_HINGE, { width: 669, height: 600 }), "viewport 太矮");
});

await test("division 高度 0（細線摺痕）可接受；正方形／直向（width <= height）不算", () => {
  assert.deepEqual(resolve(hinge({ divisions: [{ ...H_DIV, height: 0 }] }), LAPTOP_VP), {
    laptop: true,
    foldTop: 455.5,
    foldBottom: 455.5,
  });
  isNot(resolve(hinge({ divisions: [{ x: 0, y: 300, width: 669, height: 669, active: true }] }), { width: 669, height: 1400 }));
});

// ---------------------------------------------------------------------------
// resolveDuoLaptop：不合法輸入

await test("NaN／Infinity／負數／非 number 的 division 欄位 → 非筆電", () => {
  const bad = [NaN, Infinity, -Infinity, "455.5", null, undefined, {}, [455.5]];
  for (const key of ["x", "y", "width", "height"]) {
    for (const v of bad) {
      isNot(resolve(hinge({ divisions: [{ ...H_DIV, [key]: v }] }), LAPTOP_VP), `${key}=${String(v)}`);
    }
  }
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, width: -669 }] }), LAPTOP_VP), "width 負數");
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, height: -40 }] }), LAPTOP_VP), "height 負數");
  isNot(resolve(hinge({ divisions: [{ ...H_DIV, y: -455.5 }] }), LAPTOP_VP), "y 負數");
});

await test("NaN／負數／0／非 number 的 viewport → 非筆電", () => {
  const bad = [NaN, Infinity, -669, 0, "669", null, undefined];
  for (const v of bad) {
    isNot(resolve(LAPTOP_HINGE, { width: v, height: 951 }), `width=${String(v)}`);
    isNot(resolve(LAPTOP_HINGE, { width: 669, height: v }), `height=${String(v)}`);
  }
});

await test("非物件輸入（hinge／viewport／division 元素）→ 非筆電且不 throw", () => {
  const junk = [null, undefined, 0, 1, NaN, "", "x", true, Symbol("s"), () => 1, []];
  for (const j of junk) {
    assert.doesNotThrow(() => resolve(j, LAPTOP_VP));
    isNot(resolve(j, LAPTOP_VP), `hinge=${String(j)}`);
    if (!Array.isArray(j)) isNot(resolve(LAPTOP_HINGE, j), `viewport=${String(j)}`);
    isNot(resolve(hinge({ divisions: [j] }), LAPTOP_VP), `division=${String(j)}`);
  }
  assert.doesNotThrow(() => resolve(Object.create(null), Object.create(null)));
});

// ---------------------------------------------------------------------------
// frozen / same

await test("回傳物件 frozen（NOT 常數與 laptop 結果）", () => {
  assert.equal(Object.isFrozen(NOT), true, "NOT_DUO_LAPTOP 必須 frozen");
  assert.equal(resolve(null, null), NOT);
  const r = resolve(LAPTOP_HINGE, LAPTOP_VP);
  assert.equal(r.laptop, true);
  assert.equal(Object.isFrozen(r), true, "laptop 結果必須 frozen");
  assert.throws(() => {
    r.foldTop = 0;
  }, TypeError);
});

await test("sameDuoLaptop：同內容不同物件 true；laptop 不同或摺痕任一值不同 false", () => {
  const a = resolve(LAPTOP_HINGE, LAPTOP_VP);
  const b = resolve(structuredClone(LAPTOP_HINGE), { ...LAPTOP_VP });
  assert.notEqual(a, b);
  assert.equal(same(a, b), true);
  assert.equal(same(NOT, resolve(BOOK_HINGE, BOOK_VP)), true);
  assert.equal(same(NOT, { laptop: false }), true);
  assert.equal(same(a, NOT), false);
  assert.equal(same(NOT, a), false);
  const c = resolve(hinge({ divisions: [{ ...H_DIV, y: 456 }] }), LAPTOP_VP);
  const d = resolve(hinge({ divisions: [{ ...H_DIV, height: 41 }] }), LAPTOP_VP);
  assert.equal(same(a, c), false);
  assert.equal(same(a, d), false);
  assert.equal(same(c, a), false);
});

// ---------------------------------------------------------------------------
// store（use-duo-laptop）：假時鐘

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
          if (t.at <= end && (next == null || t.at < next[1].at || (t.at === next[1].at && id < next[0]))) {
            next = [id, t];
          }
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
  globalThis.clearTimeout = (id) => {
    clock.timers.delete(id);
  };
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

async function setup({ vp = LAPTOP_VP, state = UNSUPPORTED } = {}) {
  const clock = installClock();
  const win = installWindow(vp);
  const h = installHinge(state);
  const m = await freshImport(hookCode);
  m.useDuoLaptop();
  const { subscribe, getSnapshot, getServerSnapshot } = globalThis.__uses;
  return { clock, win, h, m, subscribe, getSnapshot, getServerSnapshot };
}

async function storeTest(name, fn) {
  let env;
  await test(name, async () => {
    env = await setup();
    try {
      await fn(env);
    } finally {
      env.clock.restore();
      delete globalThis.window;
    }
  });
}

const FOLD = { laptop: true, foldTop: 455.5, foldBottom: 495.5 };

await storeTest("store：未訂閱時 snapshot 為 NOT；server snapshot 恆為 NOT", async ({ getSnapshot, getServerSnapshot, m }) => {
  assert.equal(getSnapshot(), m.useDuoLaptop());
  assert.deepEqual(getSnapshot(), { laptop: false });
  assert.deepEqual(getServerSnapshot(), { laptop: false });
});

await storeTest("store：第一次訂閱時直接採用當下結果（不等 150ms）", async ({ h, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  assert.deepEqual(getSnapshot(), FOLD);
  assert.equal(clock.timers.size, 0, "首次訂閱不應排程計時器");
  unsub();
});

await storeTest("store：進入筆電需連續穩定 150ms（149ms 不切換、150ms 切換、只通知一次）", async ({ h, subscribe, getSnapshot, clock }) => {
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  const before = getSnapshot();
  assert.equal(before.laptop, false);
  h.set(LAPTOP_HINGE);
  clock.advance(149);
  assert.equal(getSnapshot(), before, "149ms 時尚未切換");
  assert.equal(n, 0);
  clock.advance(1);
  assert.deepEqual(getSnapshot(), FOLD, "150ms 時切換");
  assert.equal(n, 1);
  const snap = getSnapshot();
  clock.advance(1000);
  assert.equal(getSnapshot(), snap, "穩定後 snapshot 同一物件");
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：離開筆電同樣需穩定 150ms", async ({ h, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  assert.equal(getSnapshot().laptop, true);
  h.set(hinge({ status: "fullyOpen" }));
  clock.advance(149);
  assert.equal(getSnapshot().laptop, true);
  clock.advance(1);
  assert.equal(getSnapshot().laptop, false);
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：抖動（筆電↔非筆電來回）期間不切換；最後一次變化後穩定 150ms 才切換", async ({ h, subscribe, getSnapshot, clock }) => {
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  for (let i = 0; i < 6; i += 1) {
    h.set(LAPTOP_HINGE);
    clock.advance(100);
    h.set(BOOK_HINGE);
    clock.advance(40);
  }
  assert.equal(getSnapshot().laptop, false);
  assert.equal(n, 0, "抖動期間不得通知");
  h.set(LAPTOP_HINGE);
  clock.advance(149);
  assert.equal(getSnapshot().laptop, false);
  clock.advance(1);
  assert.equal(getSnapshot().laptop, true);
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：變回原值即取消（之後不切換、無殘留計時器）", async ({ h, subscribe, getSnapshot, clock }) => {
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  h.set(LAPTOP_HINGE);
  clock.advance(100);
  h.set(UNSUPPORTED);
  assert.equal(clock.timers.size, 0, "變回原值應清掉計時器");
  clock.advance(1000);
  assert.equal(getSnapshot().laptop, false);
  assert.equal(n, 0);
  unsub();
});

await storeTest("store：結果相同的連續事件（angle 變化）不重新計時，150ms 後切換", async ({ h, subscribe, getSnapshot, clock }) => {
  const unsub = subscribe(() => {});
  h.set(hinge({ angle: 127 }));
  clock.advance(80);
  h.set(hinge({ angle: 140 }));
  clock.advance(70);
  assert.equal(getSnapshot().laptop, true, "結果一直是同一個筆電值，自第一次起 150ms 即切換");
  unsub();
});

await storeTest("store：摺痕位置改變（仍是筆電）也需穩定 150ms，且中途改回原位置取消", async ({ h, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  const s0 = getSnapshot();
  h.set(hinge({ divisions: [{ ...H_DIV, y: 460 }] }));
  clock.advance(100);
  h.set(LAPTOP_HINGE);
  clock.advance(500);
  assert.equal(getSnapshot(), s0);
  assert.equal(n, 0);
  h.set(hinge({ divisions: [{ ...H_DIV, y: 460 }] }));
  clock.advance(150);
  assert.deepEqual(getSnapshot(), { laptop: true, foldTop: 460, foldBottom: 500 });
  assert.equal(n, 1);
  unsub();
});

await storeTest("store：旋轉過渡（實測 log 順序）筆電→矛盾→書本，過渡期間不閃爍，穩定後離開筆電", async ({ h, win, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  const seen = [];
  const unsub = subscribe(() => seen.push(getSnapshot().laptop));
  seen.length = 0; // 同上：首次訂閱的立即 commit 不計入
  // 1. 原生先送出直向 division，但 viewport 還是 669×951
  h.set(BOOK_HINGE);
  clock.advance(30);
  // 2. viewport 轉成 951×669，但 division 仍是舊的橫向
  h.state = LAPTOP_HINGE;
  win.setViewport(BOOK_VP);
  win.dispatch("resize");
  clock.advance(30);
  // 3. 最終書本
  h.set(BOOK_HINGE);
  // #H3-3：步驟 1、2（division 與 viewport 方向矛盾）為「不確定」，不計入穩定期；
  // 150ms 自第一個明確結果（步驟 3 書本）起算。過渡期間（含 60ms 矛盾＋149ms 書本）維持筆電。
  clock.advance(149);
  assert.deepEqual(seen, [], "明確結果穩定未滿 150ms 不得切換（矛盾過渡不計入）");
  assert.equal(getSnapshot().laptop, true);
  clock.advance(1);
  assert.deepEqual(seen, [false]);
  // 過渡中途短暫回到筆電結果，則從最後一次變化重新起算
  h.set(LAPTOP_HINGE);
  win.setViewport(LAPTOP_VP);
  win.dispatch("resize");
  clock.advance(100);
  h.set(BOOK_HINGE);
  clock.advance(60);
  assert.deepEqual(seen, [false], "100ms 內又變回，不得切換");
  h.set(LAPTOP_HINGE);
  clock.advance(150);
  assert.deepEqual(seen, [false, true]);
  unsub();
});

await storeTest("store：resize／orientationchange 也會觸發重新計算（viewport 改變）", async ({ h, win, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  win.setViewport(BOOK_VP);
  const unsub = subscribe(() => {});
  assert.equal(getSnapshot().laptop, false);
  win.setViewport(LAPTOP_VP);
  win.dispatch("orientationchange");
  clock.advance(150);
  assert.equal(getSnapshot().laptop, true);
  win.setViewport({ width: 669, height: 600 });
  win.dispatch("resize");
  clock.advance(150);
  assert.equal(getSnapshot().laptop, false);
  unsub();
});

await storeTest("store：計時器到期時結果已改變（無事件）→ 不套用舊 pending，改為重新計時", async ({ h, subscribe, getSnapshot, clock }) => {
  const unsub = subscribe(() => {});
  h.set(LAPTOP_HINGE);
  clock.advance(100);
  // 不發事件直接改快照（模擬 resize 事件漏送）
  h.state = hinge({ divisions: [{ ...H_DIV, y: 460 }] });
  clock.advance(50);
  assert.equal(getSnapshot().laptop, false, "到期時結果與 pending 不同，不得套用");
  clock.advance(150);
  assert.deepEqual(getSnapshot(), { laptop: true, foldTop: 460, foldBottom: 500 });
  unsub();
});

await storeTest("store：多個訂閱者共用一組 hinge／window 監聽，同時通知", async ({ h, win, subscribe, clock }) => {
  let a = 0;
  let b = 0;
  const ua = subscribe(() => (a += 1));
  const ub = subscribe(() => (b += 1));
  assert.equal(h.subscribeCalls, 1);
  assert.equal(win.count("resize"), 1);
  assert.equal(win.count("orientationchange"), 1);
  h.set(LAPTOP_HINGE);
  clock.advance(150);
  assert.equal(a, 1);
  assert.equal(b, 1);
  ua();
  assert.equal(h.unsubscribeCalls, 0, "還有訂閱者不得取消 hinge 訂閱");
  assert.equal(win.count("resize"), 1);
  ub();
});

await storeTest("store：最後一個訂閱者離開 → 清計時器、移除監聽、取消 hinge 訂閱、重設為 NOT", async ({ h, win, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  let n = 0;
  const unsub = subscribe(() => (n += 1));
  n = 0; // 首次訂閱的立即 commit 可能同步通知（useSyncExternalStore 允許），不計入延遲行為
  assert.equal(getSnapshot().laptop, true);
  h.set(UNSUPPORTED);
  assert.equal(clock.timers.size, 1, "離開前有 pending 計時器");
  unsub();
  assert.equal(clock.timers.size, 0, "計時器必須清掉");
  assert.equal(win.count("resize"), 0);
  assert.equal(win.count("orientationchange"), 0);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.unsubscribeCalls, 1);
  assert.deepEqual(getSnapshot(), { laptop: false }, "重設為 NOT");
  clock.advance(1000);
  assert.equal(n, 0, "離開後不得再通知");
});

await storeTest("store：sub→unsub→sub（StrictMode 雙掛載）重新訂閱並立即採用當下結果", async ({ h, win, subscribe, getSnapshot, clock }) => {
  h.state = LAPTOP_HINGE;
  const u1 = subscribe(() => {});
  h.set(BOOK_HINGE);
  u1();
  const u2 = subscribe(() => {});
  assert.equal(getSnapshot().laptop, false, "當下為書本，立即採用");
  assert.equal(clock.timers.size, 0);
  assert.equal(h.subscribeCalls, 2);
  assert.equal(win.count("resize"), 1, "不得重複註冊 resize");
  h.set(LAPTOP_HINGE);
  clock.advance(150);
  assert.equal(getSnapshot().laptop, true);
  u2();
});

delete globalThis.window;
delete globalThis.__hinge;
delete globalThis.__uses;
console.log(`\n總結：${passed} 通過 / ${failed} 失敗`);
process.exit(failed ? 1 : 0);
