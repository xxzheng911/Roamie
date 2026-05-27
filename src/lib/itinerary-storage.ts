import { supabase } from "@/integrations/supabase/client";
import { getAuthenticatedUserId } from "@/lib/auth-session";
import { isMissingTableError } from "@/lib/supabase-errors";
import type { Itinerary } from "./itinerary.functions";
import { isRoamiePayloadV2, type RoamiePayloadV2 } from "@/lib/ai/types";
import { isSavedCollectionTrip, tagUserSavedTrip } from "@/lib/saved-collection";

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

async function persistItinerary(
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
    if (error) {
      if (isMissingTableError(error)) {
        throw new Error("行程收藏尚未就緒，請稍後再試或聯絡管理員套用資料庫 migration。");
      }
      throw new Error(error.message);
    }
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload: itinerary,
    };
  }

  throw new Error("請先登入");
}

/** 使用者確認「儲存行程」後才寫入收藏（saved_trips） */
export async function confirmSaveTrip(
  itinerary: Itinerary | RoamiePayloadV2,
  source: "chat" | "plan" = "chat",
): Promise<StoredItinerary> {
  return persistItinerary(tagUserSavedTrip(itinerary, source));
}

/** @deprecated 請改用 confirmSaveTrip；保留給內部相容 */
export async function saveItinerary(
  itinerary: Itinerary | RoamiePayloadV2,
): Promise<StoredItinerary> {
  return confirmSaveTrip(itinerary, "plan");
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
    return (data ?? [])
      .map((row) => ({
        id: row.id,
        title: row.title,
        mood: row.mood,
        cover_image: row.cover_image,
        created_at: row.created_at,
        payload: row.payload as unknown as Itinerary | RoamiePayloadV2,
      }))
      .filter((row) => isSavedCollectionTrip(row.payload));
  }
  return [];
}

export async function getItinerary(id: string): Promise<StoredItinerary | null> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .select("id, title, mood, cover_image, created_at, payload")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      throw new Error(error.message);
    }
    if (!data) return null;
    const payload = data.payload as unknown as Itinerary | RoamiePayloadV2;
    if (!isSavedCollectionTrip(payload)) return null;
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload,
    };
  }
  return null;
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
    if (error) {
      if (isMissingTableError(error)) return null;
      throw new Error(error.message);
    }
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload,
    };
  }

  throw new Error("請先登入");
}

export async function deleteItinerary(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { error } = await supabase.from("saved_trips").delete().eq("id", id);
    if (error) {
      if (isMissingTableError(error)) return;
      throw new Error(error.message);
    }
    return;
  }
  throw new Error("請先登入");
}
