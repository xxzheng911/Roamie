// 我的行李（Trip Workspace V1 第 5 階段）資料存取：每人私人清單。
// - RLS 只回呼叫者自己的資料：不篩選、不傳入任何 user_id。
// - 一律軟刪除（update deleted_at）；authenticated 沒有 DELETE 權限，不得使用 .delete()。
// - 不新增 Realtime channel：頁面在進入、回到前景（30 秒節流）時重新讀取。

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  packingErrorCodeFromText,
  packingErrorText,
  type PackingErrorCode,
} from "@/components/trip/packing/packing-model";

export type PackingCategory = Database["public"]["Tables"]["packing_categories"]["Row"];
export type PackingItem = Database["public"]["Tables"]["packing_items"]["Row"];

export type PackingData = { categories: PackingCategory[]; items: PackingItem[] };

export type { PackingErrorCode };

export class TripPackingError extends Error {
  readonly code: PackingErrorCode;
  constructor(code: PackingErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TripPackingError";
    this.code = code;
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function tripPackingErrorCode(error: unknown): PackingErrorCode {
  if (error instanceof TripPackingError) return error.code;
  return packingErrorCodeFromText(packingErrorText(error), isOffline());
}

function toError(error: unknown): TripPackingError {
  if (error instanceof TripPackingError) return error;
  return new TripPackingError(tripPackingErrorCode(error), packingErrorText(error) || undefined);
}

/** .single() 在 0 筆時回 PGRST116：版本條件不符（或已被刪除）→ 衝突。 */
function isNoRowError(error: unknown): boolean {
  const text = packingErrorText(error);
  return /PGRST116|no rows|0 rows|JSON object requested/i.test(text);
}

// ── 記憶體快取（每個行程最近一次讀取結果；供總覽卡與行李頁共用） ──────────────
type CacheEntry = { ownerId: string | null; data: PackingData };
const cache = new Map<string, CacheEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** 快取屬於其他帳號（切換帳號後）時視為沒有快取。 */
export function peekTripPacking(tripId: string): PackingData | null {
  const entry = cache.get(tripId);
  if (!entry) return null;
  const uid = readCachedAuthenticatedUserIdSync();
  if (entry.ownerId && uid && entry.ownerId !== uid) return null;
  return entry.data;
}

export function subscribeTripPackingCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 本地更新快取（樂觀更新、寫入成功後套用伺服器回傳的列）。視為一次寫入：較早發出的讀取不得覆蓋。 */
export function updateTripPackingCache(
  tripId: string,
  updater: (prev: PackingData) => PackingData,
): void {
  const entry = cache.get(tripId);
  const prev = entry?.data ?? { categories: [], items: [] };
  const next = updater(prev);
  if (next === prev) return;
  writeGen.set(tripId, (writeGen.get(tripId) ?? 0) + 1);
  cache.set(tripId, {
    ownerId: entry?.ownerId ?? readCachedAuthenticatedUserIdSync(),
    data: next,
  });
  notify();
}

// 讀取序號：較早發出的讀取晚回來時不覆蓋較新的結果；讀取期間發生過本地寫入時也不覆蓋（寫入已套用伺服器回傳的列）。
const issuedSeq = new Map<string, number>();
const appliedSeq = new Map<string, number>();
const loadedAt = new Map<string, number>();
const writeGen = new Map<string, number>();

/** 此行程最近一次成功讀取的時間；沒有則為 null。 */
export function tripPackingLoadedAt(tripId: string): number | null {
  return loadedAt.get(tripId) ?? null;
}

function sortCategories(rows: PackingCategory[]): PackingCategory[] {
  return [...rows].sort(
    (a, b) =>
      a.sort_index - b.sort_index ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * 讀取自己的清單：先 ensure_my_packing_categories（只在完全沒有分類紀錄時建立 6 個預設分類），再讀物品。
 * 回傳 { data, applied }：applied＝false 表示結果較舊、未寫入快取。
 */
export async function loadTripPacking(
  tripId: string,
): Promise<{ data: PackingData; applied: boolean }> {
  const seq = (issuedSeq.get(tripId) ?? 0) + 1;
  issuedSeq.set(tripId, seq);
  const genAtIssue = writeGen.get(tripId) ?? 0;
  const ownerId = readCachedAuthenticatedUserIdSync();

  let categories: PackingCategory[];
  try {
    const res = await supabase.rpc("ensure_my_packing_categories", { p_trip_id: tripId });
    if (res.error) throw res.error;
    const raw = res.data as PackingCategory[] | PackingCategory | null;
    categories = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((c) => !c.deleted_at);
  } catch (e) {
    throw toError(e);
  }

  let items: PackingItem[];
  try {
    const res = await supabase
      .from("packing_items")
      .select("*")
      .eq("trip_id", tripId)
      .is("deleted_at", null)
      .order("sort_index");
    if (res.error) throw res.error;
    items = ((res.data ?? []) as PackingItem[]).filter((i) => !i.deleted_at);
  } catch (e) {
    throw toError(e);
  }

  const data: PackingData = { categories: sortCategories(categories), items };
  const fresh = seq > (appliedSeq.get(tripId) ?? 0) && (writeGen.get(tripId) ?? 0) === genAtIssue;
  if (fresh) {
    appliedSeq.set(tripId, seq);
    loadedAt.set(tripId, Date.now());
    cache.set(tripId, { ownerId, data });
    notify();
  } else if (seq > (appliedSeq.get(tripId) ?? 0)) {
    // 讀取期間有本地寫入：不覆蓋快取，但仍視為已讀取（供 30 秒節流）
    loadedAt.set(tripId, Date.now());
  }
  return { data, applied: fresh };
}

// ── 分類 ────────────────────────────────────────────────────────────────

export async function createPackingCategory(
  tripId: string,
  input: { name: string; icon_key: string; sort_index: number },
): Promise<PackingCategory> {
  try {
    const res = await supabase
      .from("packing_categories")
      .insert({
        trip_id: tripId,
        name: input.name,
        icon_key: input.icon_key,
        sort_index: input.sort_index,
      })
      .select()
      .single();
    if (res.error) throw res.error;
    return res.data as PackingCategory;
  } catch (e) {
    throw toError(e);
  }
}

/** 改名、換圖示、排序（分類沒有 version 欄位）。 */
export async function updatePackingCategory(
  categoryId: string,
  patch: { name?: string; icon_key?: string; sort_index?: number },
): Promise<PackingCategory> {
  try {
    const res = await supabase
      .from("packing_categories")
      .update(patch)
      .eq("id", categoryId)
      .select()
      .single();
    if (res.error) {
      if (isNoRowError(res.error)) throw new TripPackingError("packing_category_not_found");
      throw res.error;
    }
    return res.data as PackingCategory;
  } catch (e) {
    throw toError(e);
  }
}

/** 軟刪除分類（伺服器會把其底下未刪除的物品一起軟刪除）。 */
export async function softDeletePackingCategory(categoryId: string): Promise<PackingCategory> {
  return setCategoryDeleted(categoryId, new Date().toISOString());
}

/** 復原分類（一併恢復當時被連帶刪除的物品；可能回上限錯誤）。 */
export async function restorePackingCategory(categoryId: string): Promise<PackingCategory> {
  return setCategoryDeleted(categoryId, null);
}

async function setCategoryDeleted(
  categoryId: string,
  deletedAt: string | null,
): Promise<PackingCategory> {
  try {
    const res = await supabase
      .from("packing_categories")
      .update({ deleted_at: deletedAt })
      .eq("id", categoryId)
      .select()
      .single();
    if (res.error) {
      if (isNoRowError(res.error)) throw new TripPackingError("packing_category_not_found");
      throw res.error;
    }
    return res.data as PackingCategory;
  } catch (e) {
    throw toError(e);
  }
}

/** 已無任何分類時新增物品前呼叫：復原或新建「其他」（名稱與圖示重設為預設、舊物品不回來）。 */
export async function ensurePackingOtherCategory(tripId: string): Promise<PackingCategory> {
  try {
    const res = await supabase.rpc("ensure_my_packing_other_category", { p_trip_id: tripId });
    if (res.error) throw res.error;
    const raw = res.data as PackingCategory | PackingCategory[] | null;
    const row = Array.isArray(raw) ? raw[0] : raw;
    if (!row) {
      throw new TripPackingError("unknown", "ensure_my_packing_other_category returned no row");
    }
    return row;
  } catch (e) {
    throw toError(e);
  }
}

// ── 物品 ────────────────────────────────────────────────────────────────

export type PackingItemInput = {
  category_id: string;
  name: string;
  quantity: number;
  note: string | null;
  sort_index: number;
  /** 重試沿用同一個 id（防重送） */
  client_request_id: string;
};

async function findItemByRequestId(tripId: string, requestId: string): Promise<PackingItem | null> {
  const res = await supabase
    .from("packing_items")
    .select("*")
    .eq("trip_id", tripId)
    .eq("client_request_id", requestId)
    .maybeSingle();
  if (res.error) throw res.error;
  return (res.data as PackingItem | null) ?? null;
}

/** 新增物品；回 23505（同一 client_request_id 已建立）時查回該筆。 */
export async function createPackingItem(
  tripId: string,
  input: PackingItemInput,
): Promise<PackingItem> {
  try {
    const res = await supabase
      .from("packing_items")
      .insert({
        trip_id: tripId,
        category_id: input.category_id,
        name: input.name,
        quantity: input.quantity,
        note: input.note,
        sort_index: input.sort_index,
        client_request_id: input.client_request_id,
      })
      .select()
      .single();
    if (res.error) {
      if (packingErrorCodeFromText(packingErrorText(res.error)) === "packing_duplicate") {
        const existing = await findItemByRequestId(tripId, input.client_request_id);
        if (existing && !existing.deleted_at) return existing;
      }
      throw res.error;
    }
    return res.data as PackingItem;
  } catch (e) {
    throw toError(e);
  }
}

export type PackingItemPatch = {
  name?: string;
  quantity?: number;
  note?: string | null;
  is_checked?: boolean;
  category_id?: string;
  sort_index?: number;
};

/** 更新物品（樂觀鎖）：0 筆＝衝突（packing_conflict），呼叫端重新讀取。不送 checked_at／version／updated_at。 */
export async function updatePackingItem(
  itemId: string,
  version: number,
  patch: PackingItemPatch,
): Promise<PackingItem> {
  try {
    const res = await supabase
      .from("packing_items")
      .update(patch)
      .eq("id", itemId)
      .eq("version", version)
      .select()
      .single();
    if (res.error) {
      if (isNoRowError(res.error)) throw new TripPackingError("packing_conflict");
      throw res.error;
    }
    if (!res.data) throw new TripPackingError("packing_conflict");
    return res.data as PackingItem;
  } catch (e) {
    throw toError(e);
  }
}

export async function softDeletePackingItem(itemId: string): Promise<PackingItem> {
  return setItemDeleted(itemId, new Date().toISOString());
}

/** 復原物品；所在分類已刪除時回 packing_category_deleted。 */
export async function restorePackingItem(itemId: string): Promise<PackingItem> {
  return setItemDeleted(itemId, null);
}

async function setItemDeleted(itemId: string, deletedAt: string | null): Promise<PackingItem> {
  try {
    const res = await supabase
      .from("packing_items")
      .update({ deleted_at: deletedAt })
      .eq("id", itemId)
      .select()
      .single();
    if (res.error) {
      if (isNoRowError(res.error)) throw new TripPackingError("packing_conflict");
      throw res.error;
    }
    return res.data as PackingItem;
  } catch (e) {
    throw toError(e);
  }
}

/** client_request_id（uuid v4）。 */
export function newPackingRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
