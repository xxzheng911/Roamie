import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId, readCachedAuthenticatedUserIdSync } from "@/lib/auth-session";
import {
  readOwnedPersonalizedCache,
  wrapPersonalizedCache,
} from "@/lib/personalized-cache-envelope";
import { isMissingTableError } from "@/lib/supabase-errors";

const GUEST_KEY = "roamie:places";

export const SAVED_PLACES_CHANGED_EVENT = "roamie:saved-places-changed";

function invalidateListPlacesCache(): void {
  listPlacesCache = null;
}

function emitSavedPlacesChanged(): void {
  invalidateListPlacesCache();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SAVED_PLACES_CHANGED_EVENT));
}

export type SavedPlace = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
  mood_tag: string | null;
  cover_image: string | null;
  image_url: string | null;
  image_source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NewPlace = Omit<SavedPlace, "id" | "created_at" | "metadata"> & {
  metadata?: Record<string, unknown>;
};

function localCacheKey(userId: string | null): string {
  return userId ? `${GUEST_KEY}:${userId}` : GUEST_KEY;
}

function readLocalCache(userId: string | null): SavedPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(localCacheKey(userId));
    return readOwnedPersonalizedCache<SavedPlace[]>(raw, userId) ?? [];
  } catch {
    return [];
  }
}

/** 同步讀取本地收藏快取（啟動／返回收藏頁時先顯示） */
export function readPlacesLocalCacheSync(): SavedPlace[] {
  return mergePlacesByIdOrName(readLocalCache(readCachedAuthenticatedUserIdSync()));
}

function writeLocalCache(userId: string | null, list: SavedPlace[]): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    localStorage.setItem(localCacheKey(userId), JSON.stringify(wrapPersonalizedCache(userId, list)));
  } catch (error) {
    console.warn("[PLACES_CACHE_WRITE_FAILED]", {
      reason: error instanceof Error ? error.name : "storage_error",
      fallback: "remote_authority",
    });
  }
}

function mergePlacesByIdOrName(...groups: SavedPlace[][]): SavedPlace[] {
  const map = new Map<string, SavedPlace>();
  for (const g of groups) {
    for (const p of g) {
      const key = p.id || `name:${p.name}`;
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const LIST_PLACES_CACHE_TTL_MS = 30_000;
let listPlacesInflight: Promise<SavedPlace[]> | null = null;
let listPlacesCache: { at: number; data: SavedPlace[] } | null = null;

async function resolveStableUserId(): Promise<string | null> {
  const fromSession = await getAuthenticatedUserId();
  if (fromSession) return fromSession;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user?.id) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

async function listPlacesInternal(): Promise<SavedPlace[]> {
  const userId = await resolveStableUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_places")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      const local = mergePlacesByIdOrName(readLocalCache(userId));
      console.warn("[SAVED_PLACES] remote failed, using local cache", error.message);
      console.info("[SAVED_PLACES] loaded count=", local.length);
      return local;
    }
    const rows = (data ?? []) as SavedPlace[];
    writeLocalCache(userId, rows);
    console.info("[SAVED_PLACES] loaded count=", rows.length);
    return rows;
  }
  const local: SavedPlace[] = [];
  console.info("[SAVED_PLACES] loaded count=", local.length);
  return local;
}

export async function listPlaces(): Promise<SavedPlace[]> {
  const now = Date.now();
  if (listPlacesCache && now - listPlacesCache.at < LIST_PLACES_CACHE_TTL_MS) {
    return listPlacesCache.data;
  }
  if (listPlacesInflight) return listPlacesInflight;

  listPlacesInflight = listPlacesInternal()
    .then((data) => {
      listPlacesCache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      listPlacesInflight = null;
    });

  return listPlacesInflight;
}

/** 同步讀取記憶體中的收藏列表（首頁附近可先用，不阻塞 Places） */
export function peekListPlacesCache(): SavedPlace[] {
  return listPlacesCache?.data ?? [];
}

export async function savePlace(input: NewPlace): Promise<SavedPlace> {
  const userId = await resolveStableUserId();
  if (userId) {
    console.info("[FAVORITE_PLACE] added placeId=", input.metadata?.placeId ?? input.name);
    const { data, error } = await supabase
      .from("saved_places")
      .insert({ ...input, user_id: userId, metadata: (input.metadata ?? {}) as never })
      .select()
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("收藏功能尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
      }
      throw new Error(error.message);
    }
    const remotePlace = data as SavedPlace;
    const merged = mergePlacesByIdOrName([remotePlace], readLocalCache(userId));
    writeLocalCache(userId, merged);
    console.info("[FAVORITE_PLACE] saved to remote");
    console.info("[FAVORITE_PLACE] saved to store");
    emitSavedPlacesChanged();
    return remotePlace;
  }
  const place: SavedPlace = {
    id: `guest-${Date.now()}`,
    name: input.name,
    category: input.category,
    address: input.address,
    city: input.city,
    lat: input.lat,
    lng: input.lng,
    notes: input.notes,
    mood_tag: input.mood_tag,
    cover_image: input.cover_image,
    image_url: null,
    image_source: null,
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  };
  const local: SavedPlace[] = [];
  writeLocalCache(userId, [place, ...local.filter((p) => p.name !== place.name)]);
  console.info("[FAVORITE_PLACE] saved to store");
  emitSavedPlacesChanged();
  return place;
}

function removePlaceFromLocalCaches(id: string, name?: string): void {
  const filter = (list: SavedPlace[]) =>
    list.filter((p) => p.id !== id && (!name || p.name !== name));

  void resolveStableUserId().then((userId) => {
    if (!userId) return;
    writeLocalCache(userId, filter(readLocalCache(userId)));
  });
}

export async function deletePlace(id: string, name?: string): Promise<void> {
  const userId = await resolveStableUserId();
  if (userId) {
    const { error } = await supabase.from("saved_places").delete().eq("id", id);
    if (error && !isMissingTableError(error)) {
      throw new Error(error.message);
    }
    if (name) {
      const { error: byNameError } = await supabase
        .from("saved_places")
        .delete()
        .eq("user_id", userId)
        .eq("name", name);
      if (byNameError && !isMissingTableError(byNameError)) {
        console.warn("[SAVED_PLACES] delete by name failed", byNameError.message);
      }
    }
  }

  removePlaceFromLocalCaches(id, name);
  emitSavedPlacesChanged();
}

export async function isPlaceSavedByName(name: string): Promise<string | null> {
  const list = await listPlaces();
  return list.find((p) => p.name === name)?.id ?? null;
}

export async function deletePlaceByName(name: string): Promise<boolean> {
  const list = await listPlaces();
  const match = list.find((p) => p.name === name);
  if (!match) return false;
  await deletePlace(match.id, match.name);
  return true;
}

/** 再次點擊可取消收藏 */
export async function toggleSavePlace(
  input: NewPlace,
): Promise<{ saved: boolean; place: SavedPlace | null }> {
  const existingId = await isPlaceSavedByName(input.name);
  if (existingId) {
    await deletePlace(existingId, input.name);
    return { saved: false, place: null };
  }
  const place = await savePlace(input);
  return { saved: true, place };
}

export function buildSavedPlacesIndex(places: SavedPlace[]): Map<string, string> {
  return new Map(places.map((p) => [p.name, p.id]));
}
