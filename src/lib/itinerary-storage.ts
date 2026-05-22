import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { isMissingTableError } from "@/lib/supabase-errors";
import type { Itinerary } from "./itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";

const GUEST_KEY = "roamie:itineraries";

export type StoredItinerary = {
  id: string;
  title: string;
  mood: string | null;
  cover_image: string | null;
  created_at: string;
  payload: Itinerary | RoamiePayloadV2;
};

function readGuest(): StoredItinerary[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeGuest(list: StoredItinerary[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

export async function saveItinerary(
  itinerary: Itinerary | RoamiePayloadV2,
): Promise<StoredItinerary> {
  const userId = await getAuthenticatedUserId();
  const mood = isRoamiePayloadV2(itinerary)
    ? itinerary.moodTag
    : (itinerary as Itinerary).mood;

  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .insert({
        user_id: userId,
        title: itinerary.title,
        mood: mood ?? null,
        payload: itinerary as never,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload: itinerary,
    };
  }

  const record: StoredItinerary = {
    id: crypto.randomUUID(),
    title: itinerary.title,
    mood: mood ?? null,
    cover_image: null,
    created_at: new Date().toISOString(),
    payload: itinerary,
  };
  const list = readGuest();
  list.unshift(record);
  writeGuest(list.slice(0, 50));
  return record;
}

export async function listItineraries(): Promise<StoredItinerary[]> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .select("id, title, mood, cover_image, created_at, payload")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTableError(error)) return [];
      throw new Error(error.message);
    }
    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      mood: row.mood,
      cover_image: row.cover_image,
      created_at: row.created_at,
      payload: row.payload as unknown as Itinerary | RoamiePayloadV2,
    }));
  }
  return readGuest();
}

export async function getItinerary(id: string): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .select("id, title, mood, cover_image, created_at, payload")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload: data.payload as unknown as Itinerary | RoamiePayloadV2,
    };
  }
  return readGuest().find((it) => it.id === id) ?? null;
}

export async function updateItinerary(
  id: string,
  payload: Itinerary | RoamiePayloadV2,
  title?: string,
): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  const mood = isRoamiePayloadV2(payload) ? payload.moodTag : (payload as Itinerary).mood;

  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .update({
        title: title ?? (isRoamiePayloadV2(payload) ? payload.title : (payload as Itinerary).title),
        mood: mood ?? null,
        payload: payload as never,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload,
    };
  }

  const list = readGuest();
  const idx = list.findIndex((it) => it.id === id);
  if (idx < 0) return null;
  list[idx] = {
    ...list[idx],
    title: title ?? list[idx].title,
    mood: mood ?? list[idx].mood,
    payload,
  };
  writeGuest(list);
  return list[idx];
}

export async function deleteItinerary(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { error } = await supabase.from("saved_trips").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return;
  }
  writeGuest(readGuest().filter((it) => it.id !== id));
}
