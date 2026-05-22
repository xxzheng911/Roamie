import { supabase } from "@/lib/supabase";
import { isDataUrl, isHttpUrl } from "@/lib/auth-session";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { clearGuestLocalCaches, GUEST_STORAGE_KEYS } from "@/lib/guest-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import { uploadProfileMedia } from "@/lib/profile-media-storage";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { broadcastCoverUpdate } from "@/lib/cover-events";
import type { ChatMsg } from "@/lib/chat-history";

type GuestProfile = {
  displayName?: string;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  bio?: string;
  travelStyle?: string;
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function mergeGuestProfile(userId: string): Promise<void> {
  let raw: GuestProfile = {};
  try {
    raw = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEYS.profile) || "{}") as GuestProfile;
  } catch {
    return;
  }

  let avatarUrl: string | null = raw.avatarUrl ?? null;
  let coverImageUrl: string | null = raw.coverImageUrl ?? null;

  if (avatarUrl && isDataUrl(avatarUrl)) {
    try {
      avatarUrl = await uploadProfileMedia(userId, "avatar", await dataUrlToBlob(avatarUrl));
    } catch (e) {
      console.warn("[guest-merge] avatar upload failed", e);
      avatarUrl = null;
    }
  }

  if (coverImageUrl && isDataUrl(coverImageUrl)) {
    try {
      coverImageUrl = await uploadProfileMedia(
        userId,
        "cover",
        await dataUrlToBlob(coverImageUrl),
      );
    } catch (e) {
      console.warn("[guest-merge] cover upload failed", e);
      coverImageUrl = null;
    }
  }

  if (avatarUrl && !isHttpUrl(avatarUrl)) avatarUrl = null;
  if (coverImageUrl && !isHttpUrl(coverImageUrl)) coverImageUrl = null;

  const prefsRaw = localStorage.getItem(GUEST_STORAGE_KEYS.preferences);
  let travelPersonality: TravelPreferences = {};
  try {
    if (prefsRaw) travelPersonality = JSON.parse(prefsRaw) as TravelPreferences;
  } catch {
    /* ignore */
  }

  const extras = {
    travelStyle: raw.travelStyle?.trim() ?? "",
    personalityType: travelPersonality.personalityType,
    personalitySummary: travelPersonality.personalitySummary,
  };

  const { data: existing } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, cover_image_url, bio, ai_preferences, travel_personality")
    .eq("id", userId)
    .maybeSingle();

  const mergedPrefs = {
    ...((existing?.travel_personality ?? {}) as TravelPreferences),
    ...travelPersonality,
  };

  const mergedExtras = {
    ...((existing?.ai_preferences ?? {}) as Record<string, unknown>),
    ...extras,
  };

  const mergedBio =
    existing?.bio?.trim() ||
    raw.bio?.trim() ||
    undefined;

  await supabase.from("profiles").upsert(
    {
      id: userId,
      display_name:
        existing?.display_name?.trim() ||
        raw.displayName?.trim() ||
        undefined,
      bio: mergedBio,
      avatar_url: avatarUrl ?? existing?.avatar_url ?? null,
      cover_image_url: coverImageUrl ?? existing?.cover_image_url ?? null,
      travel_personality: mergedPrefs as never,
      ai_preferences: mergedExtras as never,
    },
    { onConflict: "id" },
  );

  if (avatarUrl) broadcastAvatarUpdate(avatarUrl);
  if (coverImageUrl) broadcastCoverUpdate(coverImageUrl);
}

async function mergeGuestTrips(userId: string, key: string): Promise<void> {
  try {
    const list = JSON.parse(localStorage.getItem(key) || "[]") as Array<{
      title: string;
      mood?: string | null;
      payload: unknown;
    }>;
    for (const item of list) {
      await supabase.from("saved_trips").insert({
        user_id: userId,
        title: item.title,
        mood: item.mood ?? null,
        payload: item.payload as never,
      });
    }
  } catch (e) {
    console.warn("[guest-merge] trips failed", key, e);
  }
}

async function mergeGuestPlaces(userId: string): Promise<void> {
  try {
    const list = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEYS.places) || "[]") as Array<{
      name: string;
      category?: string | null;
      address?: string | null;
      city?: string | null;
      lat?: number | null;
      lng?: number | null;
      notes?: string | null;
      mood_tag?: string | null;
      cover_image?: string | null;
    }>;
    for (const p of list) {
      const { data: dup } = await supabase
        .from("saved_places")
        .select("id")
        .eq("user_id", userId)
        .eq("name", p.name)
        .maybeSingle();
      if (dup) continue;
      await supabase.from("saved_places").insert({
        user_id: userId,
        name: p.name,
        category: p.category ?? null,
        address: p.address ?? null,
        city: p.city ?? null,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        notes: p.notes ?? null,
        mood_tag: p.mood_tag ?? null,
        cover_image: p.cover_image ?? null,
        metadata: {} as never,
      });
    }
  } catch (e) {
    console.warn("[guest-merge] places failed", e);
  }
}

async function mergeGuestChat(userId: string): Promise<void> {
  try {
    const msgs = JSON.parse(localStorage.getItem(GUEST_STORAGE_KEYS.chat) || "[]") as ChatMsg[];
    for (const m of msgs) {
      if (!m.content?.trim()) continue;
      const content =
        m.role === "assistant" && m.roamie ? JSON.stringify(m.roamie) : m.content.trim();
      await supabase.from("chat_messages").insert({
        user_id: userId,
        role: m.role,
        content,
      });
    }
  } catch (e) {
    console.warn("[guest-merge] chat failed", e);
  }
}

/** 登入成功後將訪客暫存 merge 至 Supabase，並清除訪客快取 */
export async function mergeGuestDataAfterLogin(userId: string): Promise<void> {
  try {
    await ensureUserProfile(userId);
  } catch (e) {
    console.warn("[guest-merge] ensure profile failed", e);
  }

  const hadGuestData =
    !!localStorage.getItem(GUEST_STORAGE_KEYS.profile) ||
    !!localStorage.getItem(GUEST_STORAGE_KEYS.itineraries) ||
    !!localStorage.getItem(GUEST_STORAGE_KEYS.places) ||
    !!localStorage.getItem(GUEST_STORAGE_KEYS.chat);

  if (!hadGuestData) return;

  await mergeGuestProfile(userId);
  await mergeGuestTrips(userId, GUEST_STORAGE_KEYS.itineraries);
  await mergeGuestPlaces(userId);
  await mergeGuestChat(userId);
  clearGuestLocalCaches();
}
