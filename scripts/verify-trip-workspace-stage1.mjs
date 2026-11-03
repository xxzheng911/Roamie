/**
 * T150 — Trip Workspace V1 第 1 階段：純邏輯模組行為鎖定測試
 *
 * 執行：
 *   npx vite-node --config scripts/vite.verify.config.mjs scripts/verify-trip-workspace-stage1.mjs
 *   node --experimental-strip-types --no-warnings scripts/verify-trip-workspace-stage1.mjs
 *
 * 受測模組（frontend 實作，皆不得 import "@/..."，以便 node --experimental-strip-types 直接載入）：
 *   src/lib/trip/workspace-view.ts
 *   src/lib/trip/workspace-swipe.ts
 *   src/lib/trip/trip-overview-stats.ts
 *
 * ── 假設的函式介面（frontend 請照做） ──────────────────────────────────────────
 *
 * workspace-view.ts
 *   export type WorkspaceView = "trip" | "overview" | "map";
 *   export const WORKSPACE_VIEWS: readonly WorkspaceView[];        // ["trip","overview","map"]
 *   export function parseWorkspaceView(raw: unknown): WorkspaceView;
 *   export function adjacentWorkspaceView(view: WorkspaceView, dir: "next" | "prev"): WorkspaceView | null;
 *
 * workspace-swipe.ts
 *   export const EDGE_GUARD_PX = 24, AXIS_LOCK_PX = 12, AXIS_RATIO = 1.5,
 *                COMMIT_DISTANCE_PX = 64, COMMIT_VELOCITY = 0.4, MAX_DRAG_RATIO = 0.3;
 *   export function shouldTrackSwipeStart(input: {
 *     startX: number;                    // 觸控起點 clientX（距畫面左緣 px）
 *     insideHorizontalScroller: boolean; // 起點位於可水平捲動元素內
 *     insideNoSwipe: boolean;            // 起點位於 [data-no-page-swipe] 內
 *     overlayOpen: boolean;              // Sheet／對話框／日期選擇器開啟中
 *     inputFocused: boolean;             // 輸入框（input/textarea/contenteditable）聚焦中
 *   }): boolean;
 *     規則：startX < 24 → false；startX >= 24 且其餘布林皆 false → true；任一布林為 true → false。
 *   export function classifySwipeAxis(dx: number, dy: number): "pending" | "horizontal" | "vertical";
 *     規則：|dx| <= 12 且 |dy| <= 12 → "pending"；
 *           |dx| > 12 且 |dx| > |dy| * 1.5 → "horizontal"；其餘 → "vertical"。
 *   export function resolveSwipeEnd(input: {
 *     dx: number;        // 放開時累計水平位移 px；負值＝手指往左＝前往下一頁
 *     velocity: number;  // 放開時水平速度 px/ms，符號約定與 dx 相同（往左為負）
 *   }): "next" | "prev" | null;
 *     規則：|dx| > 64 或 |velocity| > 0.4 才切換；方向由 dx 決定：dx < 0 → "next"、dx > 0 → "prev"。
 *     （若實作額外接受 canGoNext/canGoPrev 等欄位亦可，但本測試不傳，未傳時不得因此回 null。）
 *   export function dampedOffset(dx: number, width: number,
 *     opts: { canGoNext: boolean; canGoPrev: boolean }): number;
 *     dx < 0 代表朝 next 拖、dx > 0 代表朝 prev 拖。
 *     有可去的分頁：|dx| <= width*0.3 時跟手（回傳 dx），超過則夾在 ±width*0.3。
 *     無可去的分頁：有阻尼，|結果| 明顯小於 |dx|（本測試要求 < |dx|*0.6），仍 <= width*0.3，且與 dx 同號。
 *     dx = 0 → 0。
 *
 * trip-overview-stats.ts
 *   export function computeTripOverviewStats(
 *     items: ReadonlyArray<{ date?: string }>,     // RoamieItineraryItem 的 date 欄位
 *     opts: { unassignedDateKey: string },
 *   ): { dayCount: number; scheduledPlaceCount: number; ... };
 *   export function projectPointsToBox(
 *     points: ReadonlyArray<{ lat: number; lng: number }>,
 *     box: { width: number; height: number; padding: number },
 *   ): Array<{ x: number; y: number }>;
 *     x 與 y 使用同一縮放比例（不失真），內容置中於 box。
 *
 * TRIP_UNASSIGNED_DATE：src/lib/saved-trip/apply-trip-date-range.ts 第 12 行
 *   `export const TRIP_UNASSIGNED_DATE = "未安排";`
 *   該檔 import "@/lib/ai/types" 等路徑別名，node --experimental-strip-types 無法載入，故在此寫同值常數。
 * items 欄位：SavedTripItineraryEditor.tsx buildDayGroups（264–291 行）經 groupStopsByDate
 *   以 item.date 分組，故欄位名稱為 `date`。
 */
import assert from "node:assert/strict";

const TRIP_UNASSIGNED_DATE = "未安排"; // 來源：src/lib/saved-trip/apply-trip-date-range.ts:12

let passed = 0;
let failed = 0;
const failures = [];

function record(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    failures.push(`${name}: ${msg}`);
    console.log(`FAIL  ${name}\n      ${msg}`);
  }
}

async function loadModule(relPath) {
  try {
    return { mod: await import(relPath), error: null };
  } catch (err) {
    return { mod: null, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

/** 模組載入失敗時，該模組所有案例一律記為 FAIL */
function suite(label, loaded, cases) {
  console.log(`\n== ${label} ==`);
  for (const [name, fn] of cases) {
    if (!loaded.mod) {
      record(name, () => {
        throw new Error(`無法載入模組：${loaded.error}`);
      });
    } else {
      record(name, () => fn(loaded.mod));
    }
  }
}

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ─────────────────────────────────────────────────────────────────────────────
// 1. workspace-view
// ─────────────────────────────────────────────────────────────────────────────
const viewMod = await loadModule("../src/lib/trip/workspace-view.ts");
suite("workspace-view", viewMod, [
  [
    "WORKSPACE_VIEWS 依序為 trip, overview, map",
    (m) => assert.deepEqual([...m.WORKSPACE_VIEWS], ["trip", "overview", "map"]),
  ],
  [
    "parseWorkspaceView 合法值原樣回傳",
    (m) => {
      assert.equal(m.parseWorkspaceView("trip"), "trip");
      assert.equal(m.parseWorkspaceView("overview"), "overview");
      assert.equal(m.parseWorkspaceView("map"), "map");
    },
  ],
  [
    "parseWorkspaceView 非法值一律 trip（undefined/null/''/Map/foo/數字/陣列/物件）",
    (m) => {
      for (const raw of [
        undefined,
        null,
        "",
        "Map",
        "MAP",
        " map",
        "foo",
        0,
        1,
        NaN,
        ["map"],
        [],
        {},
        true,
      ]) {
        assert.equal(m.parseWorkspaceView(raw), "trip", `raw=${JSON.stringify(raw)}`);
      }
    },
  ],
  [
    "adjacentWorkspaceView next：trip→overview→map→null",
    (m) => {
      assert.equal(m.adjacentWorkspaceView("trip", "next"), "overview");
      assert.equal(m.adjacentWorkspaceView("overview", "next"), "map");
      assert.equal(m.adjacentWorkspaceView("map", "next"), null);
    },
  ],
  [
    "adjacentWorkspaceView prev：map→overview→trip→null",
    (m) => {
      assert.equal(m.adjacentWorkspaceView("map", "prev"), "overview");
      assert.equal(m.adjacentWorkspaceView("overview", "prev"), "trip");
      assert.equal(m.adjacentWorkspaceView("trip", "prev"), null);
    },
  ],
]);

// ─────────────────────────────────────────────────────────────────────────────
// 2. workspace-swipe
// ─────────────────────────────────────────────────────────────────────────────
const swipeMod = await loadModule("../src/lib/trip/workspace-swipe.ts");
const startBase = {
  startX: 200,
  insideHorizontalScroller: false,
  insideNoSwipe: false,
  overlayOpen: false,
  inputFocused: false,
};
suite("workspace-swipe", swipeMod, [
  [
    "常數值",
    (m) => {
      assert.equal(m.EDGE_GUARD_PX, 24);
      assert.equal(m.AXIS_LOCK_PX, 12);
      assert.equal(m.AXIS_RATIO, 1.5);
      assert.equal(m.COMMIT_DISTANCE_PX, 64);
      assert.equal(m.COMMIT_VELOCITY, 0.4);
      assert.equal(m.MAX_DRAG_RATIO, 0.3);
    },
  ],
  [
    "shouldTrackSwipeStart 一般起點追蹤",
    (m) => assert.equal(m.shouldTrackSwipeStart({ ...startBase }), true),
  ],
  [
    "shouldTrackSwipeStart 左緣邊界：x=0/23 不追蹤、x=24/25 追蹤",
    (m) => {
      assert.equal(m.shouldTrackSwipeStart({ ...startBase, startX: 0 }), false);
      assert.equal(m.shouldTrackSwipeStart({ ...startBase, startX: 23 }), false);
      assert.equal(m.shouldTrackSwipeStart({ ...startBase, startX: 23.9 }), false);
      assert.equal(m.shouldTrackSwipeStart({ ...startBase, startX: 24 }), true);
      assert.equal(m.shouldTrackSwipeStart({ ...startBase, startX: 25 }), true);
    },
  ],
  [
    "shouldTrackSwipeStart 起點在可水平捲動元素內不追蹤",
    (m) =>
      assert.equal(
        m.shouldTrackSwipeStart({ ...startBase, insideHorizontalScroller: true }),
        false,
      ),
  ],
  [
    "shouldTrackSwipeStart 起點在 data-no-page-swipe 內不追蹤",
    (m) => assert.equal(m.shouldTrackSwipeStart({ ...startBase, insideNoSwipe: true }), false),
  ],
  [
    "shouldTrackSwipeStart Sheet／對話框／日期選擇器開啟時不追蹤",
    (m) => assert.equal(m.shouldTrackSwipeStart({ ...startBase, overlayOpen: true }), false),
  ],
  [
    "shouldTrackSwipeStart 輸入框聚焦時不追蹤",
    (m) => assert.equal(m.shouldTrackSwipeStart({ ...startBase, inputFocused: true }), false),
  ],
  [
    "classifySwipeAxis 未超過 12px → pending（含 dx=12、dy=12、0/0）",
    (m) => {
      assert.equal(m.classifySwipeAxis(0, 0), "pending");
      assert.equal(m.classifySwipeAxis(12, 0), "pending");
      assert.equal(m.classifySwipeAxis(-12, 0), "pending");
      assert.equal(m.classifySwipeAxis(0, 12), "pending");
      assert.equal(m.classifySwipeAxis(12, 12), "pending");
      assert.equal(m.classifySwipeAxis(-12, -12), "pending");
    },
  ],
  [
    "classifySwipeAxis dx=13 dy=8 → horizontal（13 > 8×1.5=12）",
    (m) => assert.equal(m.classifySwipeAxis(13, 8), "horizontal"),
  ],
  [
    "classifySwipeAxis dx=13 dy=9 → vertical（13 < 13.5）",
    (m) => assert.equal(m.classifySwipeAxis(13, 9), "vertical"),
  ],
  [
    "classifySwipeAxis 負值 dx 與負值 dy 同樣以絕對值判斷",
    (m) => {
      assert.equal(m.classifySwipeAxis(-13, 8), "horizontal");
      assert.equal(m.classifySwipeAxis(-13, -8), "horizontal");
      assert.equal(m.classifySwipeAxis(-13, 9), "vertical");
      assert.equal(m.classifySwipeAxis(-40, 0), "horizontal");
    },
  ],
  [
    "classifySwipeAxis 垂直超過門檻 → vertical",
    (m) => {
      assert.equal(m.classifySwipeAxis(0, 13), "vertical");
      assert.equal(m.classifySwipeAxis(5, -30), "vertical");
      assert.equal(m.classifySwipeAxis(12, 13), "vertical");
    },
  ],
  [
    "classifySwipeAxis dx=12 dy=0 未過門檻、dx=13 dy=0 → horizontal",
    (m) => {
      assert.equal(m.classifySwipeAxis(12, 0), "pending");
      assert.equal(m.classifySwipeAxis(13, 0), "horizontal");
    },
  ],
  [
    "resolveSwipeEnd 距離邊界：dx=-64 不切、dx=-65 → next",
    (m) => {
      assert.equal(m.resolveSwipeEnd({ dx: -64, velocity: 0 }), null);
      assert.equal(m.resolveSwipeEnd({ dx: -65, velocity: 0 }), "next");
    },
  ],
  [
    "resolveSwipeEnd 距離邊界：dx=64 不切、dx=65 → prev",
    (m) => {
      assert.equal(m.resolveSwipeEnd({ dx: 64, velocity: 0 }), null);
      assert.equal(m.resolveSwipeEnd({ dx: 65, velocity: 0 }), "prev");
    },
  ],
  [
    "resolveSwipeEnd 速度：dx=-10 velocity=-0.41 → next；dx=10 velocity=0.41 → prev",
    (m) => {
      assert.equal(m.resolveSwipeEnd({ dx: -10, velocity: -0.41 }), "next");
      assert.equal(m.resolveSwipeEnd({ dx: 10, velocity: 0.41 }), "prev");
    },
  ],
  [
    "resolveSwipeEnd 速度邊界：|velocity|=0.4 不切",
    (m) => {
      assert.equal(m.resolveSwipeEnd({ dx: 10, velocity: 0.4 }), null);
      assert.equal(m.resolveSwipeEnd({ dx: -10, velocity: -0.4 }), null);
    },
  ],
  [
    "resolveSwipeEnd 未達門檻 → null（含 dx=0 velocity=0）",
    (m) => {
      assert.equal(m.resolveSwipeEnd({ dx: 0, velocity: 0 }), null);
      assert.equal(m.resolveSwipeEnd({ dx: -30, velocity: -0.1 }), null);
    },
  ],
  [
    "dampedOffset dx=0 → 0（不論邊界與否）",
    (m) => {
      for (const opts of [
        { canGoNext: true, canGoPrev: true },
        { canGoNext: false, canGoPrev: false },
      ]) {
        const r = m.dampedOffset(0, 400, opts);
        assert.ok(Object.is(r, 0) || r === 0, `got ${r}`);
      }
    },
  ],
  [
    "dampedOffset 可前往時小位移跟手（回傳 dx）",
    (m) => {
      const opts = { canGoNext: true, canGoPrev: true };
      assert.ok(near(m.dampedOffset(-40, 400, opts), -40));
      assert.ok(near(m.dampedOffset(40, 400, opts), 40));
    },
  ],
  [
    "dampedOffset 可前往時上限為寬度 30%，且與 dx 同號",
    (m) => {
      const opts = { canGoNext: true, canGoPrev: true };
      for (const dx of [-121, -300, -10000, 121, 300, 10000]) {
        const r = m.dampedOffset(dx, 400, opts);
        assert.ok(Math.abs(r) <= 400 * 0.3 + 1e-9, `dx=${dx} r=${r} 超過 120`);
        assert.equal(Math.sign(r), Math.sign(dx), `dx=${dx} r=${r} 方向錯誤`);
      }
      assert.ok(near(Math.abs(m.dampedOffset(-300, 400, opts)), 120), "大位移應夾在 120");
    },
  ],
  [
    "dampedOffset 第一頁往 prev 拖（canGoPrev=false, dx>0）有阻尼",
    (m) => {
      const opts = { canGoNext: true, canGoPrev: false };
      for (const dx of [40, 100, 300]) {
        const r = m.dampedOffset(dx, 400, opts);
        assert.ok(r > 0, `dx=${dx} r=${r} 應同號且非 0`);
        assert.ok(Math.abs(r) < Math.abs(dx) * 0.6, `dx=${dx} r=${r} 阻尼不足`);
        assert.ok(Math.abs(r) <= 120 + 1e-9, `dx=${dx} r=${r} 超過 30%`);
      }
    },
  ],
  [
    "dampedOffset 最後一頁往 next 拖（canGoNext=false, dx<0）有阻尼",
    (m) => {
      const opts = { canGoNext: false, canGoPrev: true };
      for (const dx of [-40, -100, -300, -5000]) {
        const r = m.dampedOffset(dx, 400, opts);
        assert.ok(r < 0, `dx=${dx} r=${r} 應同號且非 0`);
        assert.ok(Math.abs(r) < Math.abs(dx) * 0.6, `dx=${dx} r=${r} 阻尼不足`);
        assert.ok(Math.abs(r) <= 120 + 1e-9, `dx=${dx} r=${r} 超過 30%`);
      }
    },
  ],
  [
    "dampedOffset 阻尼只作用在無目標的方向（最後一頁往 prev 拖仍跟手）",
    (m) => {
      const opts = { canGoNext: false, canGoPrev: true };
      assert.ok(near(m.dampedOffset(40, 400, opts), 40));
    },
  ],
]);

// ─────────────────────────────────────────────────────────────────────────────
// 3. trip-overview-stats
// ─────────────────────────────────────────────────────────────────────────────
const statsMod = await loadModule("../src/lib/trip/trip-overview-stats.ts");
const statOpts = { unassignedDateKey: TRIP_UNASSIGNED_DATE };
const box = { width: 300, height: 200, padding: 16 };
function assertInBox(pts, b) {
  for (const p of pts) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `非有限值 ${JSON.stringify(p)}`);
    assert.ok(p.x >= b.padding - 1e-9 && p.x <= b.width - b.padding + 1e-9, `x 超界 ${p.x}`);
    assert.ok(p.y >= b.padding - 1e-9 && p.y <= b.height - b.padding + 1e-9, `y 超界 ${p.y}`);
  }
}
suite("trip-overview-stats", statsMod, [
  [
    "computeTripOverviewStats 空陣列 → 0／0",
    (m) => {
      const s = m.computeTripOverviewStats([], statOpts);
      assert.equal(s.dayCount, 0);
      assert.equal(s.scheduledPlaceCount, 0);
    },
  ],
  [
    "computeTripOverviewStats 排除未安排項目，dayCount 為不同已排日期數",
    (m) => {
      const items = [
        { title: "A", date: "2026-11-01" },
        { title: "B", date: "2026-11-01" },
        { title: "C", date: "2026-11-02" },
        { title: "D", date: TRIP_UNASSIGNED_DATE },
        { title: "E", date: "2026-11-04" },
        { title: "F", date: TRIP_UNASSIGNED_DATE },
      ];
      const s = m.computeTripOverviewStats(items, statOpts);
      assert.equal(s.scheduledPlaceCount, 4);
      assert.equal(s.dayCount, 3);
    },
  ],
  [
    "computeTripOverviewStats 全部未安排 → 0／0",
    (m) => {
      const items = [
        { title: "A", date: TRIP_UNASSIGNED_DATE },
        { title: "B", date: TRIP_UNASSIGNED_DATE },
      ];
      const s = m.computeTripOverviewStats(items, statOpts);
      assert.equal(s.scheduledPlaceCount, 0);
      assert.equal(s.dayCount, 0);
    },
  ],
  [
    "computeTripOverviewStats 使用傳入的 unassignedDateKey（非寫死）",
    (m) => {
      const items = [
        { title: "A", date: "2026-11-01" },
        { title: "B", date: "X" },
      ];
      const s = m.computeTripOverviewStats(items, { unassignedDateKey: "X" });
      assert.equal(s.scheduledPlaceCount, 1);
      assert.equal(s.dayCount, 1);
    },
  ],
  [
    "computeTripOverviewStats 不修改輸入陣列",
    (m) => {
      const items = [
        { title: "B", date: "2026-11-02" },
        { title: "A", date: "2026-11-01" },
      ];
      const snapshot = JSON.stringify(items);
      m.computeTripOverviewStats(items, statOpts);
      assert.equal(JSON.stringify(items), snapshot);
    },
  ],
  ["projectPointsToBox 空陣列 → []", (m) => assert.deepEqual(m.projectPointsToBox([], box), [])],
  [
    "projectPointsToBox 單點置中",
    (m) => {
      const r = m.projectPointsToBox([{ lat: 25.03, lng: 121.56 }], box);
      assert.equal(r.length, 1);
      assert.ok(near(r[0].x, 150), `x=${r[0].x}`);
      assert.ok(near(r[0].y, 100), `y=${r[0].y}`);
    },
  ],
  [
    "projectPointsToBox 全部重疊的多點置中且無 NaN",
    (m) => {
      const p = { lat: 35.68, lng: 139.76 };
      const r = m.projectPointsToBox([p, { ...p }, { ...p }], box);
      assert.equal(r.length, 3);
      for (const q of r) {
        assert.ok(near(q.x, 150) && near(q.y, 100), JSON.stringify(q));
      }
    },
  ],
  [
    "projectPointsToBox 多點皆落在 padding 內框",
    (m) => {
      const pts = [
        { lat: 25.03, lng: 121.56 },
        { lat: 22.62, lng: 120.3 },
        { lat: 24.15, lng: 120.67 },
        { lat: 23.0, lng: 121.15 },
      ];
      const r = m.projectPointsToBox(pts, box);
      assert.equal(r.length, pts.length);
      assertInBox(r, box);
    },
  ],
  [
    "projectPointsToBox 北方 y 較小、東方 x 較大",
    (m) => {
      const north = { lat: 1, lng: 0 };
      const south = { lat: -1, lng: 0 };
      const east = { lat: 0, lng: 1 };
      const west = { lat: 0, lng: -1 };
      const [n, s, e, w] = m.projectPointsToBox([north, south, east, west], box);
      assert.ok(n.y < s.y, `north.y=${n.y} south.y=${s.y}`);
      assert.ok(e.x > w.x, `east.x=${e.x} west.x=${w.x}`);
    },
  ],
  [
    "projectPointsToBox 保持輸入順序",
    (m) => {
      const pts = [
        { lat: 0, lng: 2 },
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
      ];
      const r = m.projectPointsToBox(pts, box);
      assert.ok(r[0].x > r[2].x && r[2].x > r[1].x, JSON.stringify(r));
    },
  ],
  [
    "projectPointsToBox 兩點同一縮放比例（赤道附近，長寬比不失真）",
    (m) => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 0.5, lng: 1 };
      const [pa, pb] = m.projectPointsToBox([a, b], box);
      assertInBox([pa, pb], box);
      const sx = Math.abs(pb.x - pa.x) / 1;
      const sy = Math.abs(pb.y - pa.y) / 0.5;
      assert.ok(sx > 0 && sy > 0, `sx=${sx} sy=${sy}`);
      assert.ok(Math.abs(sx / sy - 1) < 0.01, `x/y 比例不同 sx=${sx} sy=${sy}`);
    },
  ],
  [
    "projectPointsToBox 只有經度差（緯度相同）時無 NaN 且 y 置中",
    (m) => {
      const r = m.projectPointsToBox(
        [
          { lat: 10, lng: 100 },
          { lat: 10, lng: 101 },
        ],
        box,
      );
      assertInBox(r, box);
      assert.ok(near(r[0].y, 100) && near(r[1].y, 100), JSON.stringify(r));
      assert.ok(r[1].x > r[0].x);
    },
  ],
  [
    "projectPointsToBox 只有緯度差（經度相同）時無 NaN 且 x 置中",
    (m) => {
      const r = m.projectPointsToBox(
        [
          { lat: 10, lng: 100 },
          { lat: 11, lng: 100 },
        ],
        box,
      );
      assertInBox(r, box);
      assert.ok(near(r[0].x, 150) && near(r[1].x, 150), JSON.stringify(r));
      assert.ok(r[1].y < r[0].y);
    },
  ],
  // T156：第 1 階段小修新增的天數色票索引
  ["TRIP_DAY_PALETTE_SIZE === 6", (m) => assert.equal(m.TRIP_DAY_PALETTE_SIZE, 6)],
  [
    "dayColorIndex 6 色循環：0→0、5→5、6→0、7→1、-1→5、2.7→2、NaN→0、paletteSize=0→0",
    (m) => {
      assert.equal(m.dayColorIndex(0), 0);
      assert.equal(m.dayColorIndex(5), 5);
      assert.equal(m.dayColorIndex(6), 0);
      assert.equal(m.dayColorIndex(7), 1);
      assert.equal(m.dayColorIndex(-1), 5);
      assert.equal(m.dayColorIndex(2.7), 2);
      assert.equal(m.dayColorIndex(NaN), 0);
      assert.equal(m.dayColorIndex(3, 0), 0);
      assert.equal(m.dayColorIndex(7, 6), 1);
    },
  ],
]);
// 註：formatTripWorkspaceCount（src/lib/i18n/trip-workspace-copy.ts）第 1 行即
// import "@/lib/i18n/effective-app-locale"，`node scripts/verify-*.mjs` 無法解析路徑別名，
// 依任務單 T156 只測 dayColorIndex；formatTripWorkspaceCount 未在此覆蓋。

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n總結：${passed} PASS / ${failed} FAIL（共 ${passed + failed}）`);
if (failed > 0) {
  console.log("失敗清單：");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
