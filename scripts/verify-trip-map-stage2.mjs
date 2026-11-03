/**
 * T156 — Trip Workspace V1 第 2 階段（地圖分頁）：先寫會失敗的測試
 *
 * 執行：node scripts/verify-trip-map-stage2.mjs
 *
 * 受測模組（frontend 實作；兩檔皆不得有 "@/..." 的值 import——直接或間接皆不可——
 * 以便 node 直接載入。型別請用 `import type`（會被剝除）；需要共用邏輯時以相對路徑
 * 加 .ts 副檔名 import 純模組，例如 "./trip-overview-stats.ts"、"../ai/itinerary-days.ts"）：
 *   src/lib/trip/trip-day-groups.ts
 *   src/lib/trip/trip-map-markers.ts
 *
 * ── 函式介面（frontend 請照做） ──────────────────────────────────────────────
 *
 * trip-day-groups.ts
 *   export type TripDayGroup = {
 *     dateKey: string;
 *     dayNumber: number;            // 已排日 1 起算；未安排組為 0
 *     items: RoamieItineraryItem[]; // 與輸入為同一物件參照，順序＝輸入中的出現順序
 *     isUnassigned?: boolean;       // 只有未安排組才有此欄位（=true）；已排日不得帶此 key
 *   };
 *   export function buildTripDayGroups(
 *     items: RoamieItineraryItem[],
 *     settings: TripPlanSettings,
 *   ): TripDayGroup[];
 *   行為必須與 HEAD(aa2db59) SavedTripItineraryEditor.tsx buildDayGroups 完全相同
 *   （下方 reference 為原樣複製），編輯器改為呼叫 buildTripDayGroups。
 *
 * trip-map-markers.ts
 *   export const TRIP_DAY_COLORS: readonly string[]; // 6 色，順序見案例
 *   export function dayColor(dayIndex: number): string;
 *     // = TRIP_DAY_COLORS[dayColorIndex(dayIndex)]（dayColorIndex 來自 trip-overview-stats.ts）
 *     // dayIndex 為 0-based 天序（第 1 天＝0），空白天也佔一個色位。
 *
 *   export type TripMapMode =
 *     | { kind: "all" }
 *     | { kind: "day"; dayIndex: number };   // dayIndex 0-based，對應 dayNumber === dayIndex + 1 的已排日
 *
 *   export type TripMapMarker = {
 *     id: string;            // 整個結果內唯一；需包含 placeKey（例如 `${placeKey}#d${dayIndex}-${itemIndexInDay}`）
 *     placeKey: string;      // googlePlaceId.trim()；沒有則 item.id（字串且非空白）；
 *                            // 再沒有則用可重現的後備值（例如 `${dateKey}:${itemIndexInDay}`），不可為空字串
 *     lat: number;
 *     lng: number;
 *     title: string;         // 顯示用，建議 localizedDisplayName || placeName || title（本測試不檢查內容）
 *     dayIndex: number;      // 0-based（= dayNumber - 1）
 *     dayNumber: number;     // 1 起算
 *     itemIndexInDay: number;// 該項目在 dayGroups[x].items 中的 0-based 位置（含無座標項目）
 *     label: string;         // all 模式：String(dayNumber)；day 模式：String(itemIndexInDay + 1)
 *                            //   → 與行程卡片編號一致，無座標的項目仍佔號（例：第 2 站無座標，Pin 為 "1"、"3"）
 *     color: string;         // dayColor(dayIndex)
 *     variant: "solid" | "outline";
 *                            // day 模式：itemIndexInDay === 0 為 "solid"，其餘 "outline"
 *                            //   （第 1 站無座標時，該天沒有 solid pin）；all 模式本測試不檢查
 *   };
 *   export type TripMapPolyline = {
 *     dayIndex: number;
 *     color: string;                         // dayColor(dayIndex)
 *     path: Array<{ lat: number; lng: number }>; // 該天有座標的點，依當天順序；直線連接
 *   };
 *     // 只有「有座標點 >= 2」的天才產生 polyline；all 模式每天各一條（依天序），day 模式最多一條。
 *   export type TripMapFit =
 *     | null                                                    // 沒有任何有座標的點
 *     | { type: "point"; center: { lat: number; lng: number }; zoom: 15 } // 恰好 1 個點
 *     | { type: "bounds"; bounds: { north: number; south: number; east: number; west: number } };
 *     // all 模式＝全部 marker；day 模式＝當天 marker。bounds 為各點 lat/lng 的極值（不加 padding）。
 *   export function buildTripMapMarkers(
 *     dayGroups: ReadonlyArray<TripDayGroup>,
 *     mode: TripMapMode,
 *   ): {
 *     markers: TripMapMarker[];     // 依天序、再依當天順序
 *     polylines: TripMapPolyline[];
 *     fit: TripMapFit;
 *     unlocatedCount: number;       // 範圍內（all＝所有已排日；day＝當天）無有效座標的項目數
 *   };
 *   規則：
 *   - isUnassigned === true 的組完全不參與（不上 marker／polyline／fit，也不計入 unlocatedCount）。
 *   - 座標有效性與 src/lib/ai/destination-provider-result.ts isValidAnchorCoordinate 相同：
 *     lat/lng 皆為 number、皆有限、-90<=lat<=90、-180<=lng<=180（邊界值有效）。
 *     使用 item.lat / item.lng（不用 navigationLatitude）。
 *   - day 模式的 dayIndex 找不到對應已排日（含負數、超出範圍）：markers=[]、polylines=[]、fit=null、unlocatedCount=0。
 *   - 不得修改輸入；相同輸入兩次呼叫結果 deepEqual。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

// ─────────────────────────────────────────────────────────────────────────────
// Reference：HEAD(aa2db59) 原樣複製（僅移除型別標註），作為 buildTripDayGroups 的比對基準
// ─────────────────────────────────────────────────────────────────────────────

// src/lib/saved-trip/apply-trip-date-range.ts:12
const TRIP_UNASSIGNED_DATE = "未安排";

// src/lib/ai/itinerary-days.ts:5
const MIN_ITINERARY_DAYS = 1;

// src/lib/ai/itinerary-days.ts:25-42
function computeInclusiveItineraryDays(startIso, endIso) {
  const start = startIso?.trim();
  const end = endIso?.trim();
  if (!start || !end) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return undefined;
  }
  const startMs = Date.parse(`${start}T00:00:00`);
  const endMs = Date.parse(`${end}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round((endMs - startMs) / dayMs) + 1;
  if (days < MIN_ITINERARY_DAYS) return undefined;
  return days;
}

// src/lib/fetch-context.ts:166-168
function daysBetweenDates(startDate, endDate) {
  return computeInclusiveItineraryDays(startDate, endDate) ?? 1;
}

// src/lib/saved-trip/apply-trip-date-range.ts:139-143
function addDaysIso(iso, daysToAdd) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + daysToAdd);
  return d.toISOString().slice(0, 10);
}

// src/lib/saved-trip/apply-trip-date-range.ts:146-154
function scheduledDateKeysFromSettings(settings) {
  const start = settings?.tripStartDate?.trim();
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const end = settings?.tripEndDate?.trim() || start;
  const dayCount = Math.max(1, daysBetweenDates(start, end));
  return Array.from({ length: dayCount }, (_, i) => addDaysIso(start, i));
}

// src/lib/outfit/group-by-date.ts:14-29
function listTripDates(items, startDate, days) {
  const fromItems = [...new Set(items.map((i) => i.date?.trim()).filter(Boolean))];
  if (fromItems.length >= days) {
    return fromItems.sort().slice(0, days);
  }
  const base = startDate.trim() || localIsoToday();
  const out = [];
  for (let i = 0; i < days; i++) {
    out.push(addCalendarDaysIso(base, i));
  }
  return out;
}

// src/lib/outfit/group-by-date.ts:31-34
function localIsoToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// src/lib/outfit/group-by-date.ts:37-46
function addCalendarDaysIso(iso, offset) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// src/lib/trip/trip-stop-mutations.ts:4-13
function groupStopsByDate(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.date?.trim() || "未指定日期";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

// src/lib/trip/trip-stop-mutations.ts:46-51
function listTripDateKeys(items, fallbackStart) {
  const keys = [...new Set(items.map((i) => i.date?.trim() || "未指定日期"))];
  if (keys.length > 0) return keys.sort();
  if (fallbackStart) return [fallbackStart];
  return [new Date().toISOString().slice(0, 10)];
}

// src/components/saved/SavedTripItineraryEditor.tsx:152-168
function inferTripDates(items, settings) {
  const fromSettings = settings.tripStartDate;
  const toSettings = settings.tripEndDate;
  if (fromSettings) {
    return { start: fromSettings, end: toSettings || fromSettings };
  }
  const isoDates = [
    ...new Set(items.map((i) => i.date?.trim()).filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(d))),
  ].sort();
  if (isoDates.length > 0) {
    return { start: isoDates[0], end: isoDates[isoDates.length - 1] };
  }
  return { start: "", end: "" };
}

// src/components/saved/SavedTripItineraryEditor.tsx:264-291（DayGroup 型別 257-262）
function referenceBuildDayGroups(items, settings) {
  const { start } = inferTripDates(items, settings);
  const settingsDateKeys = scheduledDateKeysFromSettings(settings);
  const dayCount = Math.max(
    1,
    settingsDateKeys.length ||
      daysBetweenDates(settings.tripStartDate ?? start, settings.tripEndDate ?? start),
    listTripDateKeys(items, start).filter((k) => k !== TRIP_UNASSIGNED_DATE).length,
  );
  const dateKeys =
    settingsDateKeys.length > 0 ? settingsDateKeys : listTripDates(items, start, dayCount);
  const groups = groupStopsByDate(items);
  const scheduled = dateKeys.map((dateKey, i) => ({
    dateKey,
    dayNumber: i + 1,
    items: groups.get(dateKey) ?? [],
  }));
  const unassigned = groups.get(TRIP_UNASSIGNED_DATE) ?? [];
  if (unassigned.length > 0) {
    scheduled.push({
      dateKey: TRIP_UNASSIGNED_DATE,
      dayNumber: 0,
      items: unassigned,
      isUnassigned: true,
    });
  }
  return scheduled;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
function mk(title, date, extra = {}) {
  return {
    date,
    time: "",
    title,
    description: "",
    placeName: title,
    lat: null,
    lng: null,
    ...extra,
  };
}

const groupFixtures = [
  {
    name: "有日期區間＋同日多項目＋未安排＋區間外日期＋空白 date",
    items: [
      mk("A1", "2026-11-01", { time: "15:00" }),
      mk("B1", "2026-11-02"),
      mk("A2", "2026-11-01", { time: "09:00" }),
      mk("U1", TRIP_UNASSIGNED_DATE),
      mk("X1", "2026-11-10"),
      mk("A3", "2026-11-01", { time: "12:00" }),
      mk("E1", ""),
      mk("E2", "   "),
      mk("U2", TRIP_UNASSIGNED_DATE),
    ],
    settings: { tripStartDate: "2026-11-01", tripEndDate: "2026-11-03" },
  },
  {
    name: "無日期區間：依項目日期推斷（含間隔日、未安排）",
    items: [
      mk("C1", "2026-11-05"),
      mk("A1", "2026-11-02"),
      mk("A2", "2026-11-02"),
      mk("U1", TRIP_UNASSIGNED_DATE),
    ],
    settings: {},
  },
  {
    name: "無日期區間＋空白 date＋未安排（未指定日期會進入天數計算）",
    items: [mk("A1", "2026-12-24"), mk("E1", ""), mk("U1", TRIP_UNASSIGNED_DATE)],
    settings: {},
  },
  {
    name: "無日期區間、只有未安排項目（基準日為今天）",
    items: [mk("U1", TRIP_UNASSIGNED_DATE), mk("U2", TRIP_UNASSIGNED_DATE)],
    settings: {},
  },
  { name: "空項目、空設定", items: [], settings: {} },
  {
    name: "只有 tripStartDate（無 tripEndDate）",
    items: [mk("A1", "2026-11-01"), mk("B1", "2026-11-02")],
    settings: { tripStartDate: "2026-11-01" },
  },
  {
    name: "tripStartDate 非 ISO 格式（scheduledDateKeys 為空、改用 listTripDates）",
    items: [mk("A1", "2026-11-01"), mk("B1", "2026-11-03")],
    settings: { tripStartDate: "2026/11/01", tripEndDate: "2026/11/03" },
  },
  {
    name: "tripEndDate 早於 tripStartDate",
    items: [mk("A1", "2026-11-05")],
    settings: { tripStartDate: "2026-11-05", tripEndDate: "2026-11-01" },
  },
  {
    name: "跨月區間＋空白天＋前後空白的 date",
    items: [mk("A1", " 2026-10-31 "), mk("B1", "2026-11-02"), mk("B2", "2026-11-02")],
    settings: { tripStartDate: "2026-10-30", tripEndDate: "2026-11-02" },
  },
  {
    name: "區間日期全在項目日期之外（項目全部區間外）",
    items: [mk("X1", "2027-01-01"), mk("X2", "2027-01-02"), mk("U1", TRIP_UNASSIGNED_DATE)],
    settings: { tripStartDate: "2026-11-01", tripEndDate: "2026-11-02" },
  },
  {
    name: "無日期區間、非 ISO date 字串與 ISO 混合",
    items: [mk("A1", "Day 1"), mk("B1", "2026-11-02"), mk("A2", "Day 1")],
    settings: {},
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. trip-day-groups
// ─────────────────────────────────────────────────────────────────────────────
const groupsMod = await loadModule("../src/lib/trip/trip-day-groups.ts");
suite("trip-day-groups：buildTripDayGroups 與 HEAD buildDayGroups 一致", groupsMod, [
  ...groupFixtures.map((fx) => [
    `deepEqual reference — ${fx.name}`,
    (m) => {
      const expected = referenceBuildDayGroups(fx.items, fx.settings);
      const actual = m.buildTripDayGroups(fx.items, fx.settings);
      assert.deepStrictEqual(actual, expected);
    },
  ]),
  [
    "group.items 為輸入項目的同一物件參照（不複製）",
    (m) => {
      const fx = groupFixtures[0];
      const input = new Set(fx.items);
      for (const g of m.buildTripDayGroups(fx.items, fx.settings)) {
        for (const it of g.items) assert.ok(input.has(it), `項目 ${it.title} 不是原物件`);
      }
    },
  ],
  [
    "不修改輸入 items 與 settings",
    (m) => {
      for (const fx of groupFixtures) {
        const before = JSON.stringify([fx.items, fx.settings]);
        m.buildTripDayGroups(fx.items, fx.settings);
        assert.equal(JSON.stringify([fx.items, fx.settings]), before, fx.name);
      }
    },
  ],
]);

console.log("\n== 編輯器改用 buildTripDayGroups（靜態檢查） ==");
record("SavedTripItineraryEditor.tsx 不再自帶 buildDayGroups，改 import buildTripDayGroups", () => {
  const src = readFileSync(
    new URL("../src/components/saved/SavedTripItineraryEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!/function\s+buildDayGroups\s*\(/.test(src), "仍定義 function buildDayGroups");
  assert.ok(
    /import\s*\{[^}]*\bbuildTripDayGroups\b[^}]*\}\s*from\s*["'][^"']*trip-day-groups(\.ts)?["']/.test(
      src,
    ),
    "未從 trip-day-groups import buildTripDayGroups",
  );
  assert.ok(
    /buildTripDayGroups\s*\(\s*items\s*,\s*settings\s*\)/.test(src),
    "未呼叫 buildTripDayGroups(items, settings)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. trip-map-markers
// ─────────────────────────────────────────────────────────────────────────────
const statsMod = await loadModule("../src/lib/trip/trip-overview-stats.ts");
const markersMod = await loadModule("../src/lib/trip/trip-map-markers.ts");

const EXPECTED_COLORS = [
  "oklch(0.6 0.11 45)",
  "oklch(0.55 0.07 150)",
  "oklch(0.55 0.07 240)",
  "oklch(0.62 0.11 80)",
  "oklch(0.5 0.08 340)",
  "oklch(0.52 0.06 195)",
];

const at = (title, lat, lng, extra = {}) => mk(title, "", { lat, lng, ...extra });
function day(dayNumber, items) {
  return { dateKey: `2026-11-${String(dayNumber).padStart(2, "0")}`, dayNumber, items };
}
function unassignedGroup(items) {
  return { dateKey: TRIP_UNASSIGNED_DATE, dayNumber: 0, items, isUnassigned: true };
}

// 標準 fixture：第 1 天 3 點（第 2 站無座標）、第 2 天空白、第 3 天 1 點、第 4 天 2 點、未安排 2 點（有座標）
function standardGroups() {
  return [
    day(1, [
      at("D1-1", 35.0, 135.0, { googlePlaceId: "gp-a" }),
      at("D1-2", null, null),
      at("D1-3", 35.2, 135.4, { googlePlaceId: "gp-c" }),
    ]),
    day(2, []),
    day(3, [at("D3-1", 34.5, 135.5, { googlePlaceId: "gp-d" })]),
    day(4, [at("D4-1", 34.0, 136.0), at("D4-2", 34.1, 136.2, { googlePlaceId: "gp-f" })]),
    unassignedGroup([at("U-1", 10, 10, { googlePlaceId: "gp-u" }), at("U-2", 11, 11)]),
  ];
}

const ALL = { kind: "all" };
const dayMode = (dayIndex) => ({ kind: "day", dayIndex });
const pick = (markers, k) => markers.map((x) => x[k]);

function assertUniqueIds(markers) {
  const ids = markers.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, `id 重複：${JSON.stringify(ids)}`);
  for (const id of ids) assert.ok(typeof id === "string" && id.length > 0, "id 須為非空字串");
}

suite("trip-map-markers", markersMod, [
  [
    "TRIP_DAY_COLORS 6 色且順序正確",
    (m) => assert.deepEqual([...m.TRIP_DAY_COLORS], EXPECTED_COLORS),
  ],
  [
    "dayColor 6 色循環且與 trip-overview-stats dayColorIndex 一致（0..13、-1）",
    (m) => {
      assert.ok(statsMod.mod, `trip-overview-stats 無法載入：${statsMod.error}`);
      for (let i = -1; i <= 13; i++) {
        assert.equal(m.dayColor(i), EXPECTED_COLORS[statsMod.mod.dayColorIndex(i)], `i=${i}`);
      }
      assert.equal(m.dayColor(6), EXPECTED_COLORS[0]);
      assert.equal(m.dayColor(7), EXPECTED_COLORS[1]);
    },
  ],
  [
    "all：Pin 數字＝天數（1 起算），依天序再依當天順序",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), ALL);
      assert.deepEqual(pick(r.markers, "label"), ["1", "1", "3", "4", "4"]);
      assert.deepEqual(pick(r.markers, "dayNumber"), [1, 1, 3, 4, 4]);
      assert.deepEqual(pick(r.markers, "dayIndex"), [0, 0, 2, 3, 3]);
      assert.deepEqual(pick(r.markers, "itemIndexInDay"), [0, 2, 0, 0, 1]);
      assert.deepEqual(
        r.markers.map((x) => [x.lat, x.lng]),
        [
          [35.0, 135.0],
          [35.2, 135.4],
          [34.5, 135.5],
          [34.0, 136.0],
          [34.1, 136.2],
        ],
      );
    },
  ],
  [
    "all：顏色依天數，空白天（第 2 天）仍佔色位",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), ALL);
      assert.deepEqual(pick(r.markers, "color"), [
        EXPECTED_COLORS[0],
        EXPECTED_COLORS[0],
        EXPECTED_COLORS[2],
        EXPECTED_COLORS[3],
        EXPECTED_COLORS[3],
      ]);
    },
  ],
  [
    "all：第 7 天顏色循環回第 1 色",
    (m) => {
      const groups = [1, 2, 3, 4, 5, 6, 7].map((n) => day(n, [at(`P${n}`, 30 + n * 0.1, 130)]));
      const r = m.buildTripMapMarkers(groups, ALL);
      assert.equal(r.markers.length, 7);
      assert.equal(r.markers[6].label, "7");
      assert.equal(r.markers[6].color, EXPECTED_COLORS[0]);
      assert.equal(r.markers[5].color, EXPECTED_COLORS[5]);
    },
  ],
  [
    "all：每天一條依序折線（>=2 個有座標點才產生），跳過無座標項目，顏色依天",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), ALL);
      assert.deepEqual(r.polylines, [
        {
          dayIndex: 0,
          color: EXPECTED_COLORS[0],
          path: [
            { lat: 35.0, lng: 135.0 },
            { lat: 35.2, lng: 135.4 },
          ],
        },
        {
          dayIndex: 3,
          color: EXPECTED_COLORS[3],
          path: [
            { lat: 34.0, lng: 136.0 },
            { lat: 34.1, lng: 136.2 },
          ],
        },
      ]);
    },
  ],
  [
    "all：fit 為全部有座標點的 bounds（不含未安排）",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), ALL);
      assert.deepEqual(r.fit, {
        type: "bounds",
        bounds: { north: 35.2, south: 34.0, east: 136.2, west: 135.0 },
      });
    },
  ],
  [
    "all：未安排組不上 marker／polyline，也不計入 unlocatedCount",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), ALL);
      assert.ok(!r.markers.some((x) => x.placeKey === "gp-u" || x.lat === 10 || x.lat === 11));
      assert.ok(!r.polylines.some((p) => p.path.some((q) => q.lat === 10 || q.lat === 11)));
      assert.equal(r.unlocatedCount, 1);
      const onlyUnassigned = m.buildTripMapMarkers(
        [unassignedGroup([at("U", 10, 10), at("V", null, null)])],
        ALL,
      );
      assert.deepEqual(onlyUnassigned.markers, []);
      assert.deepEqual(onlyUnassigned.polylines, []);
      assert.equal(onlyUnassigned.fit, null);
      assert.equal(onlyUnassigned.unlocatedCount, 0);
    },
  ],
  [
    "day：Pin 數字＝當天順序且與卡片一致（無座標站仍佔號 → 1、3）",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), dayMode(0));
      assert.deepEqual(pick(r.markers, "label"), ["1", "3"]);
      assert.deepEqual(pick(r.markers, "itemIndexInDay"), [0, 2]);
      assert.ok(r.markers.every((x) => x.dayIndex === 0 && x.color === EXPECTED_COLORS[0]));
      assert.equal(r.unlocatedCount, 1);
    },
  ],
  [
    "day：順序依 dayGroups 項目順序（不依 time 重排）",
    (m) => {
      const groups = [
        day(1, [
          at("Late", 35.0, 135.0, { time: "18:00" }),
          at("Early", 35.1, 135.1, { time: "08:00" }),
          at("Mid", 35.2, 135.2, { time: "12:00" }),
        ]),
      ];
      const r = m.buildTripMapMarkers(groups, dayMode(0));
      assert.deepEqual(
        r.markers.map((x) => [x.label, x.lat]),
        [
          ["1", 35.0],
          ["2", 35.1],
          ["3", 35.2],
        ],
      );
      assert.deepEqual(
        r.polylines[0].path.map((q) => q.lat),
        [35.0, 35.1, 35.2],
      );
    },
  ],
  [
    "day：第 1 站 solid、其餘 outline",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), dayMode(3));
      assert.deepEqual(pick(r.markers, "variant"), ["solid", "outline"]);
      assert.deepEqual(pick(r.markers, "label"), ["1", "2"]);
    },
  ],
  [
    "day：第 1 站無座標時，沒有 solid pin（與卡片第 1 站對應）",
    (m) => {
      const groups = [day(1, [at("NoCoord", null, null), at("B", 35, 135), at("C", 35.1, 135.1)])];
      const r = m.buildTripMapMarkers(groups, dayMode(0));
      assert.deepEqual(pick(r.markers, "label"), ["2", "3"]);
      assert.deepEqual(pick(r.markers, "variant"), ["outline", "outline"]);
    },
  ],
  [
    "day：只有當天 marker 與折線，fit 為當天 bounds",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), dayMode(3));
      assert.deepEqual(pick(r.markers, "dayIndex"), [3, 3]);
      assert.equal(r.polylines.length, 1);
      assert.equal(r.polylines[0].dayIndex, 3);
      assert.deepEqual(r.fit, {
        type: "bounds",
        bounds: { north: 34.1, south: 34.0, east: 136.2, west: 136.0 },
      });
      assert.equal(r.unlocatedCount, 0);
    },
  ],
  [
    "day：只有 1 點 → fit 為 point＋zoom 15，無折線",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), dayMode(2));
      assert.equal(r.markers.length, 1);
      assert.equal(r.markers[0].label, "1");
      assert.equal(r.markers[0].variant, "solid");
      assert.equal(r.markers[0].color, EXPECTED_COLORS[2]);
      assert.deepEqual(r.fit, { type: "point", center: { lat: 34.5, lng: 135.5 }, zoom: 15 });
      assert.deepEqual(r.polylines, []);
    },
  ],
  [
    "day：空白天 → markers=[]、fit=null、unlocatedCount=0",
    (m) => {
      const r = m.buildTripMapMarkers(standardGroups(), dayMode(1));
      assert.deepEqual(r.markers, []);
      assert.deepEqual(r.polylines, []);
      assert.equal(r.fit, null);
      assert.equal(r.unlocatedCount, 0);
    },
  ],
  [
    "day：當天全部無座標 → markers=[]、fit=null、unlocatedCount=N",
    (m) => {
      const groups = [day(1, [at("A", null, null), at("B", undefined, undefined)])];
      const r = m.buildTripMapMarkers(groups, dayMode(0));
      assert.deepEqual(r.markers, []);
      assert.equal(r.fit, null);
      assert.equal(r.unlocatedCount, 2);
    },
  ],
  [
    "day：dayIndex 不存在（-1、99）→ 空結果；不會選到未安排組",
    (m) => {
      for (const idx of [-1, 4, 99]) {
        const r = m.buildTripMapMarkers(standardGroups(), dayMode(idx));
        assert.deepEqual(r.markers, [], `dayIndex=${idx}`);
        assert.deepEqual(r.polylines, [], `dayIndex=${idx}`);
        assert.equal(r.fit, null, `dayIndex=${idx}`);
        assert.equal(r.unlocatedCount, 0, `dayIndex=${idx}`);
      }
    },
  ],
  [
    "無效座標不上地圖並計入 unlocatedCount（null/undefined/NaN/Infinity/超出範圍/字串）",
    (m) => {
      const bad = [
        at("null", null, null),
        at("undef", undefined, undefined),
        at("nan", Number.NaN, 135),
        at("inf", 35, Number.POSITIVE_INFINITY),
        at("lat91", 91, 135),
        at("latNeg", -90.5, 135),
        at("lng181", 35, 181),
        at("lngNeg", 35, -180.01),
        at("str", "35", "135"),
        at("halfNull", 35, null),
      ];
      const r = m.buildTripMapMarkers([day(1, bad)], ALL);
      assert.deepEqual(r.markers, []);
      assert.deepEqual(r.polylines, []);
      assert.equal(r.fit, null);
      assert.equal(r.unlocatedCount, bad.length);
    },
  ],
  [
    "邊界座標有效（lat ±90、lng ±180）",
    (m) => {
      const r = m.buildTripMapMarkers([day(1, [at("N", 90, 180), at("S", -90, -180)])], ALL);
      assert.equal(r.markers.length, 2);
      assert.equal(r.unlocatedCount, 0);
    },
  ],
  [
    "marker placeKey：googlePlaceId 優先，其次 item.id，再次為非空後備值；id 含 placeKey 且唯一",
    (m) => {
      const groups = [
        day(1, [
          at("G", 35, 135, { googlePlaceId: " gp-x ", id: "item-x" }),
          at("I", 35.1, 135.1, { id: "item-y" }),
          at("N", 35.2, 135.2),
          at("Blank", 35.3, 135.3, { googlePlaceId: "  " }),
        ]),
      ];
      const r = m.buildTripMapMarkers(groups, ALL);
      assert.equal(r.markers[0].placeKey, "gp-x");
      assert.equal(r.markers[1].placeKey, "item-y");
      for (const x of r.markers.slice(2)) {
        assert.ok(
          typeof x.placeKey === "string" && x.placeKey.trim().length > 0,
          "後備 placeKey 為空",
        );
      }
      for (const x of r.markers)
        assert.ok(x.id.includes(x.placeKey), `id=${x.id} placeKey=${x.placeKey}`);
      assertUniqueIds(r.markers);
    },
  ],
  [
    "同一地點同一天出現兩次 → 兩個 marker、id 不重複",
    (m) => {
      const groups = [
        day(1, [
          at("Shrine", 35, 135, { googlePlaceId: "gp-same" }),
          at("Cafe", 35.1, 135.1, { googlePlaceId: "gp-cafe" }),
          at("Shrine", 35, 135, { googlePlaceId: "gp-same" }),
        ]),
      ];
      for (const mode of [ALL, dayMode(0)]) {
        const r = m.buildTripMapMarkers(groups, mode);
        assert.equal(r.markers.length, 3);
        assert.deepEqual(pick(r.markers, "placeKey"), ["gp-same", "gp-cafe", "gp-same"]);
        assertUniqueIds(r.markers);
      }
      const noPid = [day(1, [at("Same", 35, 135), at("Same", 35, 135)])];
      const r2 = m.buildTripMapMarkers(noPid, dayMode(0));
      assert.equal(r2.markers.length, 2);
      assertUniqueIds(r2.markers);
    },
  ],
  [
    "同一地點跨天出現（all 模式）→ id 不重複",
    (m) => {
      const groups = [
        day(1, [at("S", 35, 135, { googlePlaceId: "gp-s" })]),
        day(2, [at("S", 35, 135, { googlePlaceId: "gp-s" })]),
      ];
      const r = m.buildTripMapMarkers(groups, ALL);
      assert.equal(r.markers.length, 2);
      assertUniqueIds(r.markers);
    },
  ],
  [
    "標準 fixture 全部 marker id 唯一（all 與各 day 模式）",
    (m) => {
      assertUniqueIds(m.buildTripMapMarkers(standardGroups(), ALL).markers);
      for (let i = 0; i < 4; i++) {
        assertUniqueIds(m.buildTripMapMarkers(standardGroups(), dayMode(i)).markers);
      }
    },
  ],
  [
    "不修改輸入；兩次呼叫結果 deepEqual（id 可重現）",
    (m) => {
      const groups = standardGroups();
      const before = JSON.stringify(groups);
      const a = m.buildTripMapMarkers(groups, ALL);
      const b = m.buildTripMapMarkers(groups, ALL);
      assert.equal(JSON.stringify(groups), before);
      assert.deepStrictEqual(a, b);
      const c = m.buildTripMapMarkers(groups, dayMode(0));
      const d = m.buildTripMapMarkers(groups, dayMode(0));
      assert.deepStrictEqual(c, d);
    },
  ],
  [
    "與 buildTripDayGroups 串接：未安排組不上地圖、空白天佔色位",
    (m) => {
      assert.ok(groupsMod.mod, `trip-day-groups 無法載入：${groupsMod.error}`);
      const items = [
        mk("A", "2026-11-01", { lat: 35, lng: 135 }),
        mk("C", "2026-11-03", { lat: 34, lng: 136 }),
        mk("U", TRIP_UNASSIGNED_DATE, { lat: 10, lng: 10 }),
      ];
      const groups = groupsMod.mod.buildTripDayGroups(items, {
        tripStartDate: "2026-11-01",
        tripEndDate: "2026-11-03",
      });
      const r = m.buildTripMapMarkers(groups, ALL);
      assert.deepEqual(pick(r.markers, "label"), ["1", "3"]);
      assert.deepEqual(pick(r.markers, "color"), [EXPECTED_COLORS[0], EXPECTED_COLORS[2]]);
    },
  ],
]);

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n總結：${passed} PASS / ${failed} FAIL（共 ${passed + failed}）`);
if (failed > 0) {
  console.log("失敗清單：");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
