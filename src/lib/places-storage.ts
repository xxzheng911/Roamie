import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { isMissingTableError } from "@/lib/supabase-errors";

const GUEST_KEY = "roamie:places";

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
  metadata: Record<string, unknown>;
  created_at: string;
};

export type NewPlace = Omit<SavedPlace, "id" | "created_at" | "metadata"> & {
  metadata?: Record<string, unknown>;
};

function readGuest(): SavedPlace[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeGuest(list: SavedPlace[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

export async function listPlaces(): Promise<SavedPlace[]> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_places")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []) as SavedPlace[];
  }
  return readGuest();
}

export async function savePlace(input: NewPlace): Promise<SavedPlace> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_places")
      .insert({ ...input, user_id: userId, metadata: (input.metadata ?? {}) as never })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as SavedPlace;
  }
  const record: SavedPlace = {
    ...input,
    metadata: input.metadata ?? {},
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  const list = readGuest();
  // de-dupe by name
  if (!list.find((p) => p.name === record.name)) {
    list.unshift(record);
    writeGuest(list.slice(0, 100));
  }
  return record;
}

export async function deletePlace(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { error } = await supabase.from("saved_places").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  writeGuest(readGuest().filter((p) => p.id !== id));
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
