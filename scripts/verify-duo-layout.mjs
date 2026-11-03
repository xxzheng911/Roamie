// verify-duo-layout.mjs — iPhone Duo 版型判斷純邏輯（T164 / D1）
//
// 受測模組：src/lib/layout/duo-layout.ts（由 frontend 實作）
//
// 介面：
//   resolveDuoLayout({ viewportWidth, viewportHeight, safeTop, safeRight, safeBottom, safeLeft }) → {
//     navPlacement: "bottom" | "right-rail",
//     tripLayout: "single" | "two-pane",
//     usableWidth: number,
//     pane?: { leftWidth: number, rightWidth: number, gutter: 24, foldX: number } // 只在 two-pane 時存在
//   }
//   匯出常數：RIGHT_RAIL_MIN_INSET = 40、TOP_INSET_MAX_FOR_RAIL = 20、
//             TWO_PANE_MIN_WIDTH = 720、FOLD_GUTTER = 24
//
// 採用的定義（frontend 必須照做）：
//   0. 輸入正規化：任何欄位為 NaN、負數、undefined、非有限數（Infinity）或非 number
//      一律視為 0，不得拋例外。
//   1. navPlacement：
//        safeRight >= RIGHT_RAIL_MIN_INSET(40)
//        且 safeTop  <  TOP_INSET_MAX_FOR_RAIL(20)
//        且 safeLeft <  TOP_INSET_MAX_FOR_RAIL(20)
//      → "right-rail"；否則 "bottom"。
//      （safeLeft 門檻沿用同一常數 20，用來排除一般 iPhone 橫向左右皆有 inset 的情況。）
//   2. usableWidth = max(0, viewportWidth − safeLeft − safeRight)。
//   3. tripLayout：usableWidth >= TWO_PANE_MIN_WIDTH(720) → "two-pane"；否則 "single"。
//      注意：規則本身不限 Duo；iPad 等寬螢幕依同一規則照算也會得到 two-pane，
//      是否只在 Duo 啟用由指派者決定（本測試照規則斷言 iPad 為 two-pane）。
//   4. pane（僅 two-pane 時存在；single 時 pane 必須為 undefined）：
//        gutter     = FOLD_GUTTER = 24
//        foldX      = viewportWidth / 2      （整個螢幕寬度中線，實體摺痕位置，不是可用區中線）
//        leftWidth  = foldX − gutter / 2 − safeLeft
//        rightWidth = usableWidth − leftWidth − gutter
//      因此左右欄可能不對稱；leftWidth + rightWidth + gutter === usableWidth 恆成立。
//      不做四捨五入（Duo 展開時 foldX = 475.5，leftWidth = 463.5）。
//
// 執行：node scripts/verify-duo-layout.mjs（不讀 .env、不連網）

import assert from "node:assert/strict";

const MODULE_PATH = "../src/lib/layout/duo-layout.ts";

let mod;
try {
  mod = await import(MODULE_PATH);
} catch (error) {
  console.log(`FAIL 載入模組 ${MODULE_PATH}：${error?.code ?? ""} ${error?.message ?? error}`);
  console.log("總結：0 通過 / 1 失敗（模組不存在或無法載入）");
  process.exit(1);
}

const {
  resolveDuoLayout,
  RIGHT_RAIL_MIN_INSET,
  TOP_INSET_MAX_FOR_RAIL,
  TWO_PANE_MIN_WIDTH,
  FOLD_GUTTER,
} = mod;

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    const message = String(error?.message ?? error);
    console.log(`     ${message.split("\n").join("\n     ")}`);
  }
}

function input(viewportWidth, viewportHeight, safe = {}) {
  return {
    viewportWidth,
    viewportHeight,
    safeTop: safe.top ?? 0,
    safeRight: safe.right ?? 0,
    safeBottom: safe.bottom ?? 0,
    safeLeft: safe.left ?? 0,
  };
}

function assertSingle(result, usableWidth) {
  assert.equal(result.tripLayout, "single");
  assert.equal(result.usableWidth, usableWidth);
  assert.equal(result.pane, undefined, "single 版型不應有 pane");
}

function assertTwoPane(result, { usableWidth, foldX, leftWidth, rightWidth }) {
  assert.equal(result.tripLayout, "two-pane");
  assert.equal(result.usableWidth, usableWidth);
  assert.ok(result.pane, "two-pane 版型必須有 pane");
  assert.equal(result.pane.gutter, 24);
  assert.equal(result.pane.foldX, foldX);
  assert.equal(result.pane.leftWidth, leftWidth);
  assert.equal(result.pane.rightWidth, rightWidth);
  assert.ok(result.pane.leftWidth > 0, "leftWidth 必須 > 0");
  assert.ok(result.pane.rightWidth > 0, "rightWidth 必須 > 0");
  assert.equal(
    result.pane.leftWidth + result.pane.rightWidth + result.pane.gutter,
    result.usableWidth,
    "leftWidth + rightWidth + gutter 必須等於 usableWidth",
  );
}

// ---- 常數 ----
check("匯出常數值", () => {
  assert.equal(typeof resolveDuoLayout, "function");
  assert.equal(RIGHT_RAIL_MIN_INSET, 40);
  assert.equal(TOP_INSET_MAX_FOR_RAIL, 20);
  assert.equal(TWO_PANE_MIN_WIDTH, 720);
  assert.equal(FOLD_GUTTER, 24);
});

// ---- 主要裝置 ----
check("Duo 外螢幕 466×678 safe{0,84,0,0} → right-rail、single", () => {
  const r = resolveDuoLayout(input(466, 678, { top: 0, right: 84, bottom: 0, left: 0 }));
  assert.equal(r.navPlacement, "right-rail");
  assertSingle(r, 382);
});

check("Duo 外螢幕 466×678 safe{0,84,20,0} → right-rail、single", () => {
  const r = resolveDuoLayout(input(466, 678, { top: 0, right: 84, bottom: 20, left: 0 }));
  assert.equal(r.navPlacement, "right-rail");
  assertSingle(r, 382);
});

check("Duo 展開 951×669 safe{0,84,0,0} → right-rail、two-pane、foldX=475.5", () => {
  const r = resolveDuoLayout(input(951, 669, { top: 0, right: 84, bottom: 0, left: 0 }));
  assert.equal(r.navPlacement, "right-rail");
  // usable = 951 − 84 = 867；left = 475.5 − 12 − 0 = 463.5；right = 867 − 463.5 − 24 = 379.5
  assertTwoPane(r, { usableWidth: 867, foldX: 475.5, leftWidth: 463.5, rightWidth: 379.5 });
});

check("Duo 展開 951×669 safe{0,84,20,0} → 底部 inset 不影響結果", () => {
  const r = resolveDuoLayout(input(951, 669, { top: 0, right: 84, bottom: 20, left: 0 }));
  assert.equal(r.navPlacement, "right-rail");
  assertTwoPane(r, { usableWidth: 867, foldX: 475.5, leftWidth: 463.5, rightWidth: 379.5 });
});

check("一般 iPhone 直向 393×852 safe{59,0,34,0} → bottom、single", () => {
  const r = resolveDuoLayout(input(393, 852, { top: 59, right: 0, bottom: 34, left: 0 }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 393);
});

check("一般 iPhone 橫向 852×393 safe{0,59,21,59} → bottom（非 Duo）", () => {
  const r = resolveDuoLayout(input(852, 393, { top: 0, right: 59, bottom: 21, left: 59 }));
  assert.equal(r.navPlacement, "bottom");
  // usable = 852 − 59 − 59 = 734 ≥ 720 → two-pane（規則不限 Duo）
  // left = 426 − 12 − 59 = 355；right = 734 − 355 − 24 = 355
  assertTwoPane(r, { usableWidth: 734, foldX: 426, leftWidth: 355, rightWidth: 355 });
});

check("iPad 1024×1366 safe{24,0,20,0} → bottom、two-pane（規則本身不限 Duo）", () => {
  const r = resolveDuoLayout(input(1024, 1366, { top: 24, right: 0, bottom: 20, left: 0 }));
  assert.equal(r.navPlacement, "bottom");
  assertTwoPane(r, { usableWidth: 1024, foldX: 512, leftWidth: 500, rightWidth: 500 });
});

// ---- 邊界：雙欄寬度 ----
check("邊界 usableWidth=719（無 inset）→ single", () => {
  const r = resolveDuoLayout(input(719, 800));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 719);
});

check("邊界 usableWidth=720（無 inset）→ two-pane", () => {
  const r = resolveDuoLayout(input(720, 800));
  // left = 360 − 12 = 348；right = 720 − 348 − 24 = 348
  assertTwoPane(r, { usableWidth: 720, foldX: 360, leftWidth: 348, rightWidth: 348 });
});

check("邊界 viewport 803、safeRight 84 → usableWidth=719 → single", () => {
  const r = resolveDuoLayout(input(803, 669, { right: 84 }));
  assert.equal(r.navPlacement, "right-rail");
  assertSingle(r, 719);
});

check("邊界 viewport 804、safeRight 84 → usableWidth=720 → two-pane", () => {
  const r = resolveDuoLayout(input(804, 669, { right: 84 }));
  assert.equal(r.navPlacement, "right-rail");
  // left = 402 − 12 = 390；right = 720 − 390 − 24 = 306
  assertTwoPane(r, { usableWidth: 720, foldX: 402, leftWidth: 390, rightWidth: 306 });
});

check("邊界 safeLeft 影響 usableWidth 與 leftWidth（foldX 仍為螢幕中線）", () => {
  const r = resolveDuoLayout(input(1000, 700, { left: 10, right: 50 }));
  assert.equal(r.navPlacement, "right-rail");
  // usable = 940；foldX = 500；left = 500 − 12 − 10 = 478；right = 940 − 478 − 24 = 438
  assertTwoPane(r, { usableWidth: 940, foldX: 500, leftWidth: 478, rightWidth: 438 });
});

// ---- 邊界：導覽位置 ----
check("邊界 safeRight=39 → bottom", () => {
  const r = resolveDuoLayout(input(466, 678, { right: 39 }));
  assert.equal(r.navPlacement, "bottom");
});

check("邊界 safeRight=40 → right-rail", () => {
  const r = resolveDuoLayout(input(466, 678, { right: 40 }));
  assert.equal(r.navPlacement, "right-rail");
});

check("邊界 safeTop=19（safeRight 84）→ right-rail", () => {
  const r = resolveDuoLayout(input(466, 678, { top: 19, right: 84 }));
  assert.equal(r.navPlacement, "right-rail");
});

check("邊界 safeTop=20（safeRight 84）→ bottom", () => {
  const r = resolveDuoLayout(input(466, 678, { top: 20, right: 84 }));
  assert.equal(r.navPlacement, "bottom");
});

check("邊界 safeLeft=19（safeRight 84）→ right-rail", () => {
  const r = resolveDuoLayout(input(466, 678, { left: 19, right: 84 }));
  assert.equal(r.navPlacement, "right-rail");
});

check("邊界 safeLeft=20（safeRight 84）→ bottom", () => {
  const r = resolveDuoLayout(input(466, 678, { left: 20, right: 84 }));
  assert.equal(r.navPlacement, "bottom");
});

// ---- 非法輸入一律當 0 ----
check("非法輸入：safeTop NaN、safeLeft 負數、safeBottom undefined → 視為 0", () => {
  const r = resolveDuoLayout({
    viewportWidth: 466,
    viewportHeight: 678,
    safeTop: Number.NaN,
    safeRight: 84,
    safeBottom: undefined,
    safeLeft: -30,
  });
  assert.equal(r.navPlacement, "right-rail");
  assertSingle(r, 382);
});

check("非法輸入：safeRight NaN → 視為 0 → bottom", () => {
  const r = resolveDuoLayout(input(466, 678, { right: Number.NaN }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 466);
});

check("非法輸入：safeRight 負數 → 視為 0，不得放大 usableWidth", () => {
  const r = resolveDuoLayout(input(700, 678, { right: -100 }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 700);
});

check("非法輸入：負的 safeLeft 不得使 two-pane 的 leftWidth 變大", () => {
  const r = resolveDuoLayout(input(951, 669, { right: 84, left: -50 }));
  assert.equal(r.navPlacement, "right-rail");
  assertTwoPane(r, { usableWidth: 867, foldX: 475.5, leftWidth: 463.5, rightWidth: 379.5 });
});

check("非法輸入：viewportWidth NaN → usableWidth 0、single、bottom", () => {
  const r = resolveDuoLayout(input(Number.NaN, 678, { right: 0 }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 0);
});

check("非法輸入：viewportWidth 負數 → usableWidth 0、single", () => {
  const r = resolveDuoLayout(input(-951, 669));
  assertSingle(r, 0);
});

check("非法輸入：viewportWidth undefined、viewportHeight NaN → 不拋例外、usableWidth 0", () => {
  const r = resolveDuoLayout({
    viewportWidth: undefined,
    viewportHeight: Number.NaN,
    safeTop: 0,
    safeRight: 0,
    safeBottom: 0,
    safeLeft: 0,
  });
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 0);
});

check("非法輸入：所有欄位缺省（空物件）→ 不拋例外、bottom、single、usableWidth 0", () => {
  const r = resolveDuoLayout({});
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 0);
});

check("非法輸入：safeRight Infinity → 視為 0 → bottom、usableWidth 不受影響", () => {
  const r = resolveDuoLayout(input(466, 678, { right: Number.POSITIVE_INFINITY }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 466);
});

check("非法輸入：inset 大於 viewport → usableWidth 不得為負", () => {
  const r = resolveDuoLayout(input(100, 678, { right: 84, left: 50 }));
  assert.equal(r.navPlacement, "bottom");
  assertSingle(r, 0);
});

console.log(`總結：${passed} 通過 / ${failed} 失敗（共 ${passed + failed} 案）`);
if (failed > 0) {
  process.exit(1);
}
