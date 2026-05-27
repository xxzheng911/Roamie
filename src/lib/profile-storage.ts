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
import type { SurveyResultProfile } from "@/lib/travel-preference-survey-types";
import { resolveBudgetMode } from "@/lib/preferences-storage";
import { loadTravelPreferenceSurveyForUser } from "@/lib/travel-preference-survey-save";

const GUEST_PROFILE_KEY = "roamie:user-profile";
const GUEST_SETTINGS_KEY = "roamie:profile-settings";

export type ProfileExtras = {
  travelStyle?: string;
  travelPreferences?: string[];
  travelPersonality?: {
    type?: string;
    summary?: string;
    impression?: string;
  };
  travelTags?: string[];
  surveyCompleted?: boolean;
  surveyCompletedAt?: string;
  companionshipPreference?: string;
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
  surveyCompleted: boolean;
  surveyCompletedAt: string | null;
  travelTags: string[];
  surveyResult: SurveyResultProfile | null;
  aiPreferences?: Record<string, unknown>;
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
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    throw new Error("請先登入");
  }

  const guestSettings = readGuestSettings();
  const guestLocale = guestSettings.language ?? localeOverride ?? "zh-TW";

  const [prefs, surveySnapshot] = await Promise.all([
    getPreferences(),
    loadTravelPreferenceSurveyForUser(userId).catch((e) => {
      console.error("[PROFILE_SURVEY] load failed", e);
      return null;
    }),
  ]);

  const mergedPrefs = surveySnapshot?.prefs ?? prefs;
  const surveyCompleted = Boolean(
    surveySnapshot?.surveyCompleted ?? mergedPrefs.surveyCompleted ?? mergedPrefs.onboarded,
  );
  if (surveyCompleted) {
    console.info("[PROFILE] surveyLoaded=", mergedPrefs.personalityType ?? "unknown");
  }
  const personality = derivePersonality(mergedPrefs);
  const surveyResult = surveySnapshot?.resultProfile ?? mergedPrefs.resultProfile ?? null;

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
    travelStyle:
      surveySnapshot?.travelStyle ??
      extras.travelStyle ??
      mergedPrefs.personalityType ??
      "",
    language: locale,
    notificationsEnabled: data?.notifications_enabled ?? false,
    authProvider: (data?.auth_provider as AuthProviderKind) ?? null,
    prefs: {
      ...mergedPrefs,
      surveyCompleted,
      onboarded: surveyCompleted || mergedPrefs.onboarded,
      resultProfile: surveyResult ?? mergedPrefs.resultProfile,
    },
    personalityType:
      surveyResult?.personalityType ??
      mergedPrefs.personalityType ??
      extras.personalityType ??
      personality.type,
    personalitySummary:
      surveyResult?.aiRecommendationSummary ??
      mergedPrefs.personalitySummary ??
      extras.personalitySummary ??
      personality.summary,
    personalityImpression:
      surveyResult?.personalityImpression ?? personality.impression,
    surveyCompleted,
    surveyCompletedAt:
      surveySnapshot?.surveyCompletedAt ?? mergedPrefs.surveyCompletedAt ?? null,
    travelTags:
      surveySnapshot?.travelTags ??
      (Array.isArray(extras.travelTags) ? extras.travelTags : []) ??
      surveyResult?.travelTags ??
      [],
    surveyResult,
    aiPreferences: extras,
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

export async function syncTravelPreferenceSurveyFields(
  prefs: TravelPreferences,
  result: SurveyResultProfile,
): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return;

  const payload: ProfileExtras = {
    travelStyle: result.travelStyle,
    travelPreferences: prefs.interests ?? [],
    travelPersonality: {
      type: result.personalityType,
      summary: result.personalitySummary,
      impression: result.personalityImpression,
    },
    travelTags: result.travelTags,
    surveyCompleted: true,
    surveyCompletedAt: prefs.surveyCompletedAt ?? new Date().toISOString(),
    companionshipPreference: prefs.companionship ?? "",
    pacePreference: prefs.pace ?? "",
    vibePreference: prefs.vibe ?? "",
    budgetPreference: resolveBudgetMode(prefs),
    personalityType: result.personalityType,
    personalitySummary: result.aiRecommendationSummary,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ai_preferences: payload as never }, { onConflict: "id" });
  if (error) {
    const msg = error.message ?? "";
    if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
      console.warn("[profile] survey ai_preferences sync skipped (schema)", msg);
      return;
    }
    throw new Error(error.message);
  }
}

export async function syncTravelPreferenceProfileFields(input: {
  travelStyle?: string;
  prefs: TravelPreferences;
}): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
  const result = input.prefs.resultProfile;
  const payload: ProfileExtras = {
    travelStyle: input.travelStyle?.trim() || result?.travelStyle || input.prefs.personalityType || "",
    travelPreferences: input.prefs.interests ?? [],
    travelPersonality: result
      ? {
          type: result.personalityType,
          summary: result.personalitySummary,
          impression: result.personalityImpression,
        }
      : {
          type: input.prefs.personalityType,
          summary: input.prefs.personalitySummary,
        },
    travelTags: result?.travelTags ?? input.prefs.interests ?? [],
    surveyCompleted: Boolean(input.prefs.surveyCompleted ?? input.prefs.onboarded),
    surveyCompletedAt: input.prefs.surveyCompletedAt,
    companionshipPreference: input.prefs.companionship ?? "",
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
