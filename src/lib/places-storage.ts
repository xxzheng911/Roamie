import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { normalizeSavedPlaceImageFields } from "@/lib/saved-places-image";
import { isMissingTableError } from "@/lib/supabase-errors";

const GUEST_KEY = "roamie:places";

export const SAVED_PLACES_CHANGED_EVENT = "roamie:saved-places-changed";

function emitSavedPlacesChanged(): void {
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
    return raw ? (JSON.parse(raw) as SavedPlace[]) : [];
  } catch {
    return [];
  }
}

function writeLocalCache(userId: string | null, list: SavedPlace[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(localCacheKey(userId), JSON.stringify(list));
}

function placeStableKey(p: SavedPlace): string {
  const pid = p.metadata?.placeId;
  if (typeof pid === "string" && pid.trim()) return `pid:${pid.trim()}`;
  const nameKey = p.name.trim().toLowerCase();
  if (p.lat != null && p.lng != null) {
    return `geo:${nameKey}:${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
  }
  return `id:${p.id || nameKey}`;
}

function mergePlacesByIdOrName(...groups: SavedPlace[][]): SavedPlace[] {
  const map = new Map<string, SavedPlace>();
  for (const g of groups) {
    for (const p of g) {
      const key = placeStableKey(p);
      if (!map.has(key)) map.set(key, p);
    }
  }
  return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

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

export async function listPlaces(): Promise<SavedPlace[]> {
  const userId = await resolveStableUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_places")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      const local = mergePlacesByIdOrName(readLocalCache(userId), readLocalCache(null));
      console.warn("[SAVED_PLACES] remote failed, using local cache", error.message);
      console.info("[SAVED_PLACES] loaded count=", local.length);
      return local;
    }
    const rows = (data ?? []) as SavedPlace[];
    const merged = mergePlacesByIdOrName(rows, readLocalCache(userId), readLocalCache(null));
    writeLocalCache(userId, merged);
    writeLocalCache(null, merged);
    console.info("[SAVED_PLACES] loaded count=", merged.length);
    return merged;
  }
  const local = readLocalCache(null);
  console.info("[SAVED_PLACES] loaded count=", local.length);
  return local;
}

export async function savePlace(input: NewPlace): Promise<SavedPlace> {
  const userId = await resolveStableUserId();
  const imageFields = normalizeSavedPlaceImageFields(input);
  if (userId) {
    console.info("[FAVORITE_PLACE] added placeId=", input.metadata?.placeId ?? input.name);
    const { data, error } = await supabase
      .from("saved_places")
      .insert({
        ...input,
        ...imageFields,
        user_id: userId,
        metadata: (input.metadata ?? {}) as never,
      })
      .select()
      .single();
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("收藏功能尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
      }
      throw new Error(error.message);
    }
    const remotePlace = data as SavedPlace;
    const merged = mergePlacesByIdOrName([remotePlace], readLocalCache(userId), readLocalCache(null));
    writeLocalCache(userId, merged);
    writeLocalCache(null, merged);
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
    ...normalizeSavedPlaceImageFields(input),
    metadata: input.metadata ?? {},
    created_at: new Date().toISOString(),
  };
  const local = readLocalCache(null);
  writeLocalCache(null, [place, ...local.filter((p) => p.name !== place.name)]);
  console.info("[FAVORITE_PLACE] saved to store");
  emitSavedPlacesChanged();
  return place;
}

export async function deletePlace(id: string): Promise<void> {
  console.info("[FAVORITE_PLACE_DELETE] start placeId=", id);
  const userId = await resolveStableUserId();
  const local = mergePlacesByIdOrName(readLocalCache(userId), readLocalCache(null));
  const target = local.find((p) => p.id === id);

  const filtered = local.filter((p) => p.id !== id);
  writeLocalCache(userId, filtered);
  writeLocalCache(null, filtered);
  console.info("[FAVORITE_PLACE_DELETE] local removed");

  if (userId && target && !id.startsWith("guest-")) {
    const { error } = await supabase.from("saved_places").delete().eq("id", id);
    if (error) {
      if (isMissingTableError(error)) {
        emitSavedPlacesChanged();
        console.info("[FAVORITE_PLACE_DELETE] completed");
        return;
      }
      writeLocalCache(userId, local);
      writeLocalCache(null, local);
      throw new Error(error.message);
    }
    console.info("[FAVORITE_PLACE_DELETE] remote removed");
  } else if (userId && target?.name) {
    const { error } = await supabase.from("saved_places").delete().eq("user_id", userId).eq("name", target.name);
    if (!error) console.info("[FAVORITE_PLACE_DELETE] remote removed");
  }

  emitSavedPlacesChanged();
  console.info("[FAVORITE_PLACE_DELETE] completed");
}

export async function isPlaceSavedByName(name: string): Promise<string | null> {
  const list = await listPlaces();
  return list.find((p) => p.name === name)?.id ?? null;
}

export async function deletePlaceByName(name: string): Promise<boolean> {
  const id = await isPlaceSavedByName(name);
  if (!id) return false;
  await deletePlace(id);
  return true;
}

/** 再次點擊可取消收藏 */
export async function toggleSavePlace(
  input: NewPlace,
): Promise<{ saved: boolean; place: SavedPlace | null }> {
  const existingId = await isPlaceSavedByName(input.name);
  if (existingId) {
    await deletePlace(existingId);
    return { saved: false, place: null };
  }
  const place = await savePlace(input);
  return { saved: true, place };
}

export function buildSavedPlacesIndex(places: SavedPlace[]): Map<string, string> {
  return new Map(places.map((p) => [p.name, p.id]));
}
