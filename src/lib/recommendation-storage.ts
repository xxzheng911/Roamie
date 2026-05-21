import { supabase } from "@/integrations/supabase/client";
import type { RoamiePayloadV2, RoamieResponse } from "@/lib/ai/types";

const GUEST_KEY = "roamie:recommendations";

export type StoredRecommendation = {
  id: string;
  title: string;
  mood: string | null;
  cover_image: string | null;
  created_at: string;
  payload: RoamiePayloadV2;
};

function readGuest(): StoredRecommendation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeGuest(list: StoredRecommendation[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(GUEST_KEY, JSON.stringify(list));
}

export function toPayloadV2(
  data: RoamieResponse,
  extra?: { destination?: string; days?: number },
): RoamiePayloadV2 {
  return {
    ...data,
    version: 2,
    generatedAt: new Date().toISOString(),
    ...extra,
  };
}

export async function saveRecommendation(
  data: RoamieResponse,
  extra?: { destination?: string; days?: number; mood?: string },
): Promise<StoredRecommendation> {
  const payload = toPayloadV2(data, extra);
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;

  if (userId) {
    const { data: row, error } = await supabase
      .from("saved_trips")
      .insert({
        user_id: userId,
        title: data.title,
        mood: extra?.mood ?? data.moodTag ?? null,
        payload: payload as never,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return {
      id: row.id,
      title: row.title,
      mood: row.mood,
      cover_image: row.cover_image,
      created_at: row.created_at,
      payload,
    };
  }

  const record: StoredRecommendation = {
    id: crypto.randomUUID(),
    title: data.title,
    mood: extra?.mood ?? data.moodTag ?? null,
    cover_image: null,
    created_at: new Date().toISOString(),
    payload,
  };
  const list = readGuest();
  list.unshift(record);
  writeGuest(list.slice(0, 50));
  return record;
}

export async function getRecommendation(id: string): Promise<StoredRecommendation | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;

  if (userId) {
    const { data, error } = await supabase
      .from("saved_trips")
      .select("id, title, mood, cover_image, created_at, payload")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const payload = data.payload as unknown;
    if (!payload || typeof payload !== "object") return null;
    return {
      id: data.id,
      title: data.title,
      mood: data.mood,
      cover_image: data.cover_image,
      created_at: data.created_at,
      payload: payload as RoamiePayloadV2,
    };
  }

  return readGuest().find((r) => r.id === id) ?? null;
}
