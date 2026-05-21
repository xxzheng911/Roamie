import { supabase } from "@/integrations/supabase/client";
import { getPreferences, savePreferences, type TravelPreferences } from "@/lib/preferences-storage";
import { derivePersonality } from "@/lib/personality";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";

const GUEST_PROFILE_KEY = "roamie:user-profile";

export type ProfileExtras = {
  bio?: string;
  travelStyle?: string;
  personalityType?: string;
  personalitySummary?: string;
};

export type UserProfile = {
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  travelStyle: string;
  prefs: TravelPreferences;
  personalityType: string;
  personalitySummary: string;
  personalityImpression: string;
};

function readGuestProfile(): Partial<UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeGuestProfile(partial: Partial<UserProfile>) {
  if (typeof window === "undefined") return;
  const prev = readGuestProfile();
  localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify({ ...prev, ...partial }));
}

async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function getUserProfile(): Promise<UserProfile> {
  const prefs = await getPreferences();
  const personality = derivePersonality(prefs);

  const userId = await getUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name, avatar_url, ai_preferences")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const meta = (await supabase.auth.getUser()).data.user?.user_metadata as {
      full_name?: string;
      name?: string;
      avatar_url?: string;
    };
    const extras = (data?.ai_preferences ?? {}) as ProfileExtras;

    return {
      displayName:
        data?.display_name?.trim() ||
        meta?.full_name ||
        meta?.name ||
        "旅人",
      avatarUrl: data?.avatar_url || meta?.avatar_url || null,
      bio: extras.bio ?? "",
      travelStyle: extras.travelStyle ?? "",
      prefs,
      personalityType: prefs.personalityType ?? extras.personalityType ?? personality.type,
      personalitySummary:
        prefs.personalitySummary ?? extras.personalitySummary ?? personality.summary,
      personalityImpression: personality.impression,
    };
  }

  const guest = readGuestProfile();
  return {
    displayName: guest.displayName ?? "旅人",
    avatarUrl: guest.avatarUrl ?? null,
    bio: guest.bio ?? "",
    travelStyle: guest.travelStyle ?? "",
    prefs,
    personalityType: prefs.personalityType ?? personality.type,
    personalitySummary: prefs.personalitySummary ?? personality.summary,
    personalityImpression: personality.impression,
  };
}

export async function saveUserProfile(input: {
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string;
  travelStyle?: string;
}): Promise<UserProfile> {
  const userId = await getUserId();
  const current = await getUserProfile();

  const next = {
    displayName: input.displayName?.trim() ?? current.displayName,
    avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl,
    bio: input.bio !== undefined ? input.bio.trim() : current.bio,
    travelStyle: input.travelStyle !== undefined ? input.travelStyle.trim() : current.travelStyle,
  };

  if (userId) {
    const extras: ProfileExtras = {
      bio: next.bio,
      travelStyle: next.travelStyle,
      personalityType: current.personalityType,
      personalitySummary: current.personalitySummary,
    };
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          display_name: next.displayName,
          avatar_url: next.avatarUrl,
          ai_preferences: extras as never,
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);

    await supabase.auth.updateUser({
      data: {
        full_name: next.displayName,
        avatar_url: next.avatarUrl ?? undefined,
      },
    });
  } else {
    writeGuestProfile(next);
  }

  if (input.avatarUrl !== undefined) {
    broadcastAvatarUpdate(next.avatarUrl);
  }

  return getUserProfile();
}

export async function savePersonalityToProfile(prefs: TravelPreferences): Promise<void> {
  const p = derivePersonality(prefs);
  const merged: TravelPreferences = {
    ...prefs,
    personalityType: p.type,
    personalitySummary: p.summary,
  };
  await savePreferences(merged);

  const userId = await getUserId();
  if (userId) {
    const extras: ProfileExtras = {
      personalityType: p.type,
      personalitySummary: p.summary,
    };
    await supabase
      .from("profiles")
      .upsert({ id: userId, ai_preferences: extras as never }, { onConflict: "id" });
  }
}
