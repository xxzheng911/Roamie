// 我的行李（Trip Workspace V1 第 5 階段）純邏輯：進度計算、預設分類名稱解析、icon 白名單、
// 刪除分類時的移動目標、排序、錯誤碼解析。不 import "@/..."、不碰 React／supabase，可被 Node 直接 import 測試。

export const PACKING_ICON_KEYS = [
  "Shirt",
  "Footprints",
  "ShowerHead",
  "Sparkles",
  "Smartphone",
  "Plug",
  "Camera",
  "IdCard",
  "Wallet",
  "Pill",
  "HeartPulse",
  "Umbrella",
  "Sun",
  "Baby",
  "Gift",
  "Package",
] as const;

export type PackingIconKey = (typeof PACKING_ICON_KEYS)[number];

export const PACKING_DEFAULT_ICON: PackingIconKey = "Package";

export function isPackingIconKey(value: unknown): value is PackingIconKey {
  return typeof value === "string" && (PACKING_ICON_KEYS as readonly string[]).includes(value);
}

/** 白名單外（理論上不會發生）一律以 Package 顯示。 */
export function normalizePackingIconKey(value: unknown): PackingIconKey {
  return isPackingIconKey(value) ? value : PACKING_DEFAULT_ICON;
}

export const PACKING_DEFAULT_KEYS = [
  "clothing",
  "toiletries",
  "electronics",
  "documents",
  "medicine",
  "other",
] as const;

export type PackingDefaultKey = (typeof PACKING_DEFAULT_KEYS)[number];

export type PackingDefaultNames = Record<PackingDefaultKey, string>;

/** 與後端欄位一致（限制） */
export const PACKING_CATEGORY_NAME_MAX = 40;
export const PACKING_ITEM_NAME_MAX = 80;
export const PACKING_ITEM_NOTE_MAX = 200;
export const PACKING_QUANTITY_MIN = 1;
export const PACKING_QUANTITY_MAX = 99;
export const PACKING_CATEGORY_LIMIT = 30;
export const PACKING_ITEM_LIMIT = 500;

/** 純邏輯所需的最小欄位（與 supabase Row 結構相容） */
export type PackingCategoryLike = {
  id: string;
  default_key: string | null;
  name: string | null;
  icon_key: string;
  sort_index: number;
};

export type PackingItemLike = {
  id: string;
  category_id: string;
  is_checked: boolean;
  quantity: number;
  sort_index: number;
};

export function isPackingDefaultKey(value: unknown): value is PackingDefaultKey {
  return typeof value === "string" && (PACKING_DEFAULT_KEYS as readonly string[]).includes(value);
}

/**
 * 分類顯示名稱：有自訂名稱（改名後寫入 name）用 name；未改名的預設分類（name＝null）依 default_key 顯示目前語系。
 */
export function packingCategoryLabel(
  category: Pick<PackingCategoryLike, "default_key" | "name">,
  defaults: PackingDefaultNames,
): string {
  const name = category.name?.trim();
  if (name) return category.name as string;
  if (isPackingDefaultKey(category.default_key)) return defaults[category.default_key];
  return "";
}

export type PackingProgress = { checked: number; total: number };

/** 打包進度：以物品件數計（不乘 quantity）。 */
export function computePackingProgress(
  items: ReadonlyArray<Pick<PackingItemLike, "is_checked">>,
): PackingProgress {
  let checked = 0;
  for (const item of items) if (item.is_checked) checked += 1;
  return { checked, total: items.length };
}

/** 0–100（四捨五入）；沒有物品為 0。 */
export function packingProgressPercent(progress: PackingProgress): number {
  if (progress.total <= 0) return 0;
  return Math.round((progress.checked / progress.total) * 100);
}

/** 整體進度只計入「所屬分類仍存在」的物品（避免顯示已刪除分類殘留的物品）。 */
export function visiblePackingItems<T extends Pick<PackingItemLike, "category_id">>(
  items: ReadonlyArray<T>,
  categories: ReadonlyArray<Pick<PackingCategoryLike, "id">>,
): T[] {
  const ids = new Set(categories.map((c) => c.id));
  return items.filter((i) => ids.has(i.category_id));
}

function bySort<T extends { sort_index: number }>(a: T, b: T): number {
  return a.sort_index - b.sort_index;
}

/** 依分類分組（分類依 sort_index，組內物品依 sort_index；同 sort_index 保持原順序）。 */
export function groupPackingItems<
  C extends Pick<PackingCategoryLike, "id" | "sort_index">,
  I extends Pick<PackingItemLike, "category_id" | "sort_index">,
>(categories: ReadonlyArray<C>, items: ReadonlyArray<I>): Array<{ category: C; items: I[] }> {
  const map = new Map<string, I[]>();
  for (const item of items) {
    const list = map.get(item.category_id);
    if (list) list.push(item);
    else map.set(item.category_id, [item]);
  }
  return [...categories]
    .sort(bySort)
    .map((category) => ({ category, items: [...(map.get(category.id) ?? [])].sort(bySort) }));
}

/** 下一個 sort_index（目前最大值＋1；沒有則 0）。 */
export function nextPackingSortIndex(list: ReadonlyArray<{ sort_index: number }>): number {
  let max = -1;
  for (const x of list) if (Number.isFinite(x.sort_index) && x.sort_index > max) max = x.sort_index;
  return max + 1;
}

/**
 * 刪除分類並「移到其他分類」時的預設目標：
 * 「其他」（default_key＝other）；刪除的就是「其他」（或沒有「其他」）時用排序第一個其餘分類；沒有其餘分類回 null。
 */
export function defaultPackingMoveTarget<
  C extends Pick<PackingCategoryLike, "id" | "default_key" | "sort_index">,
>(categories: ReadonlyArray<C>, deletingId: string): C | null {
  const rest = [...categories].filter((c) => c.id !== deletingId).sort(bySort);
  return rest.find((c) => c.default_key === "other") ?? rest[0] ?? null;
}

/** 陣列內移動一個元素（from → to），回傳新陣列。 */
export function movePackingEntry<T>(list: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 依新順序重新編號：回傳 sort_index 需要變更的 { id, sort_index }（一列一個 update）。 */
export function packingSortChanges(
  ordered: ReadonlyArray<{ id: string; sort_index: number }>,
): Array<{ id: string; sort_index: number }> {
  const out: Array<{ id: string; sort_index: number }> = [];
  ordered.forEach((x, i) => {
    if (x.sort_index !== i) out.push({ id: x.id, sort_index: i });
  });
  return out;
}

/** 數量輸入 → 1–99 整數（無效回 null）。 */
export function parsePackingQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= PACKING_QUANTITY_MIN && n <= PACKING_QUANTITY_MAX ? n : null;
}

export function charLength(text: string): number {
  return Array.from(text).length;
}

/** 名稱：去頭尾空白後 1..max 字（以 code point 計，與 char_length 一致）。 */
export function isValidPackingName(text: string, max: number): boolean {
  const t = text.trim();
  return t.length > 0 && charLength(t) <= max;
}

// ── 錯誤碼 ─────────────────────────────────────────────────────────────

export const PACKING_SERVER_ERROR_CODES = [
  "not_authenticated",
  "not_trip_member",
  "packing_immutable_field",
  "packing_invalid_icon",
  "packing_invalid_default_key",
  "packing_category_deleted",
  "packing_category_not_found",
  "packing_category_limit_reached",
  "packing_item_limit_reached",
] as const;

export type PackingServerErrorCode = (typeof PACKING_SERVER_ERROR_CODES)[number];

/** CHECK 違反（23514）依 constraint 名稱對應的前端錯誤碼 */
export type PackingCheckErrorCode =
  | "packing_item_name_invalid"
  | "packing_item_quantity_invalid"
  | "packing_item_note_invalid"
  | "packing_category_name_invalid";

export type PackingErrorCode =
  | PackingServerErrorCode
  | PackingCheckErrorCode
  | "packing_conflict"
  | "packing_duplicate"
  | "network"
  | "unknown";

const SERVER_CODES_BY_LENGTH = [...PACKING_SERVER_ERROR_CODES].sort((a, b) => b.length - a.length);

const CHECK_CONSTRAINTS: Array<[string, PackingErrorCode]> = [
  ["packing_items_name_check", "packing_item_name_invalid"],
  ["packing_items_quantity_check", "packing_item_quantity_invalid"],
  ["packing_items_note_check", "packing_item_note_invalid"],
  ["packing_categories_custom_name_check", "packing_category_name_invalid"],
  ["packing_categories_name_check", "packing_category_name_invalid"],
  ["packing_categories_icon_key_check", "packing_invalid_icon"],
  ["packing_categories_default_key_check", "packing_invalid_default_key"],
];

export function packingErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [e.message, e.details, e.hint, e.code].filter((x) => typeof x === "string");
    if (parts.length > 0) return parts.join(" ");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 任意錯誤 → 錯誤碼。一律看 message／code 字串，不依賴 SQLSTATE 類別。 */
export function packingErrorCodeFromText(text: string, offline = false): PackingErrorCode {
  for (const code of SERVER_CODES_BY_LENGTH) if (text.includes(code)) return code;
  for (const [constraint, code] of CHECK_CONSTRAINTS) if (text.includes(constraint)) return code;
  if (/\b23505\b|duplicate key|packing_items_user_client_request_key/i.test(text)) {
    return "packing_duplicate";
  }
  if (/failed to fetch|network|load failed|fetch failed|timed? ?out|offline/i.test(text)) {
    return "network";
  }
  if (offline) return "network";
  return "unknown";
}
