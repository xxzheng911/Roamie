import { supabase } from "@/lib/supabase";
import { getPreferences, savePreferences, type TravelPreferences } from "@/lib/preferences-storage";
import { derivePersonality } from "@/lib/personality";
import {
  gatePlusPersonaFields,
  resolveProfileHasPlusAccess,
  sanitizeBioForTier,
  shouldExposePlusPersona,
} from "@/lib/profile-persona";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { broadcastCoverUpdate } from "@/lib/cover-events";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { getDefaultBio, getDefaultDisplayName } from "@/lib/i18n/default-profile";
import { detectDeviceLocale } from "@/lib/i18n/detect-locale";
import type { Locale, LocalePreference } from "@/lib/i18n/types";
import {
  getAuthenticatedUserId,
  isDataUrl,
  isHttpUrl,
} from "@/lib/auth-session";
import type { AuthProviderKind } from "@/lib/auth-provider";
import {
  clearProfileSessionCache,
  readInflightProfileFetch,
  readProfileSessionCache,
  trackInflightProfileFetch,
  writeProfileSessionCache,
} from "@/lib/profile-session-cache";

const GUEST_PROFILE_KEY = "roamie:user-profile";
const GUEST_SETTINGS_KEY = "roamie:profile-settings";

export type ProfileExtras = {
  travelStyle?: string;
  travelPreferences?: string[];
  pacePreference?: string;
  transportPreference?: string;
  vibePreference?: string;
  budgetPreference?: string;
  updatedAt?: string;
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
  aiPreferences?: Record<string, unknown>;
};

type GuestSettings = {
  language?: Locale | "system";
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

export async function getProfileLocalePreference(): Promise<LocalePreference | null> {
  return detectDeviceLocale();
}

/** @deprecated 使用 getProfileLocalePreference */
export async function getProfileLanguage(): Promise<Locale | null> {
  const pref = await getProfileLocalePreference();
  if (!pref || pref === "system") return null;
  return pref;
}

export async function saveProfileLocalePreference(_preference: LocalePreference): Promise<void> {
  /* App UI 語言跟隨裝置，不再寫入 profile / localStorage */
}

/** @deprecated 使用 saveProfileLocalePreference */
export async function saveProfileLanguage(locale: Locale): Promise<void> {
  return saveProfileLocalePreference(locale);
}

export async function getProfileNotificationsEnabled(): Promise<boolean> {
  const guest = readGuestSettings().notificationsEnabled;
  if (guest !== undefined) return guest;

  const userId = await getAuthenticatedUserId();
  if (!userId) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("notifications_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) return false;
  return data?.notifications_enabled ?? false;
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

export type GetUserProfileOptions = {
  /** 略過 session 快取，強制從後端重新讀取 */
  force?: boolean;
};

export async function getUserProfile(
  localeOverride?: Locale,
  options?: GetUserProfileOptions,
): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    throw new Error("請先登入");
  }

  if (!options?.force) {
    const cached = readProfileSessionCache(userId);
    if (cached) return cached;
    const inflight = readInflightProfileFetch(userId);
    if (inflight) return inflight;
  }

  const fetchPromise = (async () => {
  const guestSettings = readGuestSettings();

  const prefs = await getPreferences();
  const hasPlusAccess = await resolveProfileHasPlusAccess();
  const showPersona = shouldExposePlusPersona(hasPlusAccess, prefs);
  const personality = showPersona ? derivePersonality(prefs) : { type: "", summary: "", impression: "" };

  let data = await fetchProfileRow(userId);
  if (!data) {
    await ensureUserProfile(userId);
    data = await fetchProfileRow(userId);
  }

  const localePref = localeOverride ?? detectDeviceLocale();
  const locale = localePref;
  const extras = (data?.ai_preferences ?? {}) as ProfileExtras;

  let avatarUrl = sanitizeAvatarUrl(data?.avatar_url ?? null);
  let coverImageUrl = data?.cover_image_url ?? null;
  if (avatarUrl && isDataUrl(avatarUrl)) avatarUrl = null;
  if (coverImageUrl && isDataUrl(coverImageUrl)) coverImageUrl = null;

  const storedName = data?.display_name?.trim();
  const storedBio = data?.bio?.trim();
  const defaultBio = getDefaultBio(locale);
  const resolvedBio = storedBio || defaultBio;

  const raw: UserProfile = {
    displayName: storedName || getDefaultDisplayName(locale),
    avatarUrl,
    coverImageUrl,
    bio: sanitizeBioForTier(resolvedBio, hasPlusAccess, prefs, defaultBio),
    travelStyle: showPersona ? (extras.travelStyle ?? "") : "",
    language: locale,
    notificationsEnabled:
      guestSettings.notificationsEnabled ?? data?.notifications_enabled ?? false,
    authProvider: (data?.auth_provider as AuthProviderKind) ?? null,
    prefs,
    personalityType: showPersona
      ? (prefs.personalityType ?? extras.personalityType ?? personality.type)
      : "",
    personalitySummary: showPersona
      ? (prefs.personalitySummary ?? extras.personalitySummary ?? personality.summary)
      : "",
    personalityImpression: showPersona ? personality.impression : "",
    aiPreferences: extras,
  };

  const profile = gatePlusPersonaFields(raw, hasPlusAccess);
  writeProfileSessionCache(profile, userId);
  return profile;
  })();

  if (!options?.force) {
    return trackInflightProfileFetch(userId, fetchPromise);
  }
  return fetchPromise;
}

export { clearProfileSessionCache };

export async function saveUserProfile(input: {
  displayName?: string;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  bio?: string;
  travelStyle?: string;
}): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId();
  const current = await getUserProfile();
  const hasPlusAccess = await resolveProfileHasPlusAccess();
  const showPersona = shouldExposePlusPersona(hasPlusAccess, current.prefs);

  const next = {
    displayName: input.displayName?.trim() ?? current.displayName,
    avatarUrl: input.avatarUrl !== undefined ? input.avatarUrl : current.avatarUrl,
    coverImageUrl:
      input.coverImageUrl !== undefined ? input.coverImageUrl : current.coverImageUrl,
    bio: input.bio !== undefined ? input.bio.trim() : current.bio,
    travelStyle:
      showPersona && input.travelStyle !== undefined
        ? input.travelStyle.trim()
        : showPersona
          ? current.travelStyle
          : "",
  };

  if (userId) {
    await ensureUserProfile(userId);

    const avatarUrl = assertPersistableMediaUrl(next.avatarUrl, "頭像");
    const coverImageUrl = assertPersistableMediaUrl(next.coverImageUrl, "封面");

    const extras: ProfileExtras = showPersona
      ? {
          travelStyle: next.travelStyle,
          personalityType: current.personalityType,
          personalitySummary: current.personalitySummary,
        }
      : {
          travelStyle: "",
          personalityType: "",
          personalitySummary: "",
        };

    const patch = {
      display_name: next.displayName,
      bio: next.bio,
      avatar_url: avatarUrl,
      cover_image_url: coverImageUrl,
      ai_preferences: extras as never,
    };

    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    const { error } = existing?.id
      ? await supabase.from("profiles").update(patch).eq("id", userId)
      : await supabase.from("profiles").insert({
          id: userId,
          ...patch,
        });
    if (error) throw new Error(error.message);
  } else {
    throw new Error("請先登入");
  }

  if (input.avatarUrl !== undefined) {
    broadcastAvatarUpdate(next.avatarUrl);
  }
  if (input.coverImageUrl !== undefined) {
    broadcastCoverUpdate(next.coverImageUrl);
  }

  return getUserProfile(current.language, { force: true });
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
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: userId, ai_preferences: extras as never }, { onConflict: "id" });
    if (error) {
      const msg = error.message ?? "";
      if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
        console.warn("[profile] Supabase profile schema mismatch, skipped ai_preferences sync", msg);
        return;
      }
      throw new Error(error.message);
    }
  }
}

export async function syncTravelPreferenceProfileFields(input: {
  travelStyle?: string;
  prefs: TravelPreferences;
}): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
  const payload: ProfileExtras = {
    travelStyle: input.travelStyle?.trim() || "",
    travelPreferences: input.prefs.interests ?? [],
    pacePreference: input.prefs.pace ?? "",
    transportPreference:
      ((input.prefs as TravelPreferences & { transportPreference?: string }).transportPreference ??
        "") || "",
    vibePreference: input.prefs.vibe ?? "",
    budgetPreference: resolveBudgetMode(input.prefs),
    updatedAt: new Date().toISOString(),
    personalityType: input.prefs.personalityType,
    personalitySummary: input.prefs.personalitySummary,
  };
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ai_preferences: payload as never }, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
