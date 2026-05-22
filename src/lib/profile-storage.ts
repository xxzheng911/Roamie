import { supabase } from "@/lib/supabase";
import { getPreferences, savePreferences, type TravelPreferences } from "@/lib/preferences-storage";
import { derivePersonality } from "@/lib/personality";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { broadcastCoverUpdate } from "@/lib/cover-events";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { getDefaultBio, getDefaultDisplayName } from "@/lib/i18n/default-profile";
import { normalizeLocale } from "@/lib/i18n/detect-locale";
import type { Locale } from "@/lib/i18n/types";
import {
  getAuthenticatedUserId,
  isDataUrl,
  isHttpUrl,
} from "@/lib/auth-session";
import type { AuthProviderKind } from "@/lib/auth-provider";

const GUEST_PROFILE_KEY = "roamie:user-profile";
const GUEST_SETTINGS_KEY = "roamie:profile-settings";

export type ProfileExtras = {
  travelStyle?: string;
  personalityType?: string;
  personalitySummary?: string;
};

export type UserProfile = {
  displayName: string;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  bio: string;
  travelStyle: string;
  language: Locale;
  notificationsEnabled: boolean;
  authProvider: AuthProviderKind | null;
  prefs: TravelPreferences;
  personalityType: string;
  personalitySummary: string;
  personalityImpression: string;
};

type GuestSettings = {
  language?: Locale;
  notificationsEnabled?: boolean;
};

/** OAuth profile photos must not be shown; only user-uploaded Supabase media or null. */
function sanitizeAvatarUrl(url: string | null): string | null {
  if (!url || isDataUrl(url)) return null;
  try {
    const host = new URL(url).hostname;
    if (
      host.includes("googleusercontent.com") ||
      host.includes("ggpht.com") ||
      host.includes("appleid.apple.com")
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return url;
}

function readGuestProfile(): Partial<UserProfile> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || "{}");
  } catch {
    return {};
  }
}

function readGuestSettings(): GuestSettings {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GUEST_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeGuestProfile(partial: Partial<UserProfile>): void {
  if (typeof window === "undefined") return;
  const prev = readGuestProfile();
  const next = { ...prev, ...partial, updatedAt: new Date().toISOString() };
  sessionStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(next));
  localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(next));
}

function writeGuestSettings(partial: GuestSettings): void {
  if (typeof window === "undefined") return;
  const prev = readGuestSettings();
  localStorage.setItem(
    GUEST_SETTINGS_KEY,
    JSON.stringify({ ...prev, ...partial }),
  );
}

function assertPersistableMediaUrl(url: string | null, label: string): string | null {
  if (url == null) return null;
  if (isDataUrl(url)) {
    throw new Error(`${label}請上傳圖片檔案，登入後會同步至雲端`);
  }
  if (!isHttpUrl(url)) {
    throw new Error(`${label}網址格式不正確`);
  }
  return url;
}

const PROFILE_SELECT =
  "display_name, avatar_url, cover_image_url, bio, language, notifications_enabled, auth_provider, ai_preferences";

async function fetchProfileRow(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function mapLocale(value: string | null | undefined, fallback: Locale): Locale {
  return normalizeLocale(value) ?? fallback;
}

export async function getProfileLanguage(): Promise<Locale | null> {
  const userId = await getAuthenticatedUserId();
  if (userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return normalizeLocale(data?.language);
  }
  return readGuestSettings().language ?? null;
}

export async function saveProfileLanguage(locale: Locale): Promise<void> {
  writeGuestSettings({ language: locale });
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
  await ensureUserProfile(userId);
  const { error } = await supabase
    .from("profiles")
    .update({ language: locale })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function saveProfileNotifications(enabled: boolean): Promise<void> {
  writeGuestSettings({ notificationsEnabled: enabled });
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
  await ensureUserProfile(userId);
  const { error } = await supabase
    .from("profiles")
    .update({ notifications_enabled: enabled })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function getUserProfile(localeOverride?: Locale): Promise<UserProfile> {
  const guestSettings = readGuestSettings();
  const guest = readGuestProfile();
  const guestLocale = guestSettings.language ?? localeOverride ?? "zh-TW";

  const prefs = await getPreferences();
  const personality = derivePersonality(prefs);

  const userId = await getAuthenticatedUserId();
  if (userId) {
    let data = await fetchProfileRow(userId);
    if (!data) {
      await ensureUserProfile(userId);
      data = await fetchProfileRow(userId);
    }

    const locale = mapLocale(data?.language, guestLocale);
    const extras = (data?.ai_preferences ?? {}) as ProfileExtras;

    let avatarUrl = sanitizeAvatarUrl(data?.avatar_url ?? null);
    let coverImageUrl = data?.cover_image_url ?? null;
    if (avatarUrl && isDataUrl(avatarUrl)) avatarUrl = null;
    if (coverImageUrl && isDataUrl(coverImageUrl)) coverImageUrl = null;

    const storedName = data?.display_name?.trim();
    const storedBio = data?.bio?.trim();

    return {
      displayName: storedName || getDefaultDisplayName(locale),
      avatarUrl,
      coverImageUrl,
      bio: storedBio || getDefaultBio(locale),
      travelStyle: extras.travelStyle ?? "",
      language: locale,
      notificationsEnabled: data?.notifications_enabled ?? false,
      authProvider: (data?.auth_provider as AuthProviderKind) ?? null,
      prefs,
      personalityType: prefs.personalityType ?? extras.personalityType ?? personality.type,
      personalitySummary:
        prefs.personalitySummary ?? extras.personalitySummary ?? personality.summary,
      personalityImpression: personality.impression,
    };
  }

  return {
    displayName: guest.displayName ?? getDefaultDisplayName(guestLocale),
    avatarUrl: sanitizeAvatarUrl(guest.avatarUrl ?? null),
    coverImageUrl: guest.coverImageUrl ?? null,
    bio: guest.bio ?? getDefaultBio(guestLocale),
    travelStyle: guest.travelStyle ?? "",
    language: guestLocale,
    notificationsEnabled: guestSettings.notificationsEnabled ?? false,
    authProvider: null,
    prefs,
    personalityType: prefs.personalityType ?? personality.type,
    personalitySummary: prefs.personalitySummary ?? personality.summary,
    personalityImpression: personality.impression,
  };
}

export async function saveUserProfile(input: {
  displayName?: string;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  bio?: string;
  travelStyle?: string;
}): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId();
  const current = await getUserProfile();

  const next = {
    displayName: input.displayName?.trim() ?? current.displayName,
    avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl,
    coverImageUrl:
      input.coverImageUrl !== undefined ? input.coverImageUrl : current.coverImageUrl,
    bio: input.bio !== undefined ? input.bio.trim() : current.bio,
    travelStyle: input.travelStyle !== undefined ? input.travelStyle.trim() : current.travelStyle,
  };

  if (userId) {
    await ensureUserProfile(userId);

    const avatarUrl = assertPersistableMediaUrl(next.avatarUrl, "頭像");
    const coverImageUrl = assertPersistableMediaUrl(next.coverImageUrl, "封面");

    const extras: ProfileExtras = {
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
          bio: next.bio,
          avatar_url: avatarUrl,
          cover_image_url: coverImageUrl,
          ai_preferences: extras as never,
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);
  } else {
    writeGuestProfile(next);
  }

  if (input.avatarUrl !== undefined) {
    broadcastAvatarUpdate(next.avatarUrl);
  }
  if (input.coverImageUrl !== undefined) {
    broadcastCoverUpdate(next.coverImageUrl);
  }

  return getUserProfile(current.language);
}

export async function savePersonalityToProfile(prefs: TravelPreferences): Promise<void> {
  const p = derivePersonality(prefs);
  const merged: TravelPreferences = {
    ...prefs,
    personalityType: p.type,
    personalitySummary: p.summary,
  };
  await savePreferences(merged);

  const userId = await getAuthenticatedUserId();
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
