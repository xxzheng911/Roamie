import { supabase } from "@/lib/supabase";
import {
  BUDGET_MODE_LABELS,
  getPreferences,
  isPreferencesRemoteHydrated,
  logPreferencesSyncFailure,
  readCachedPreferencesSync,
  resolveBudgetMode,
  savePreferences,
  type TravelPreferences,
} from "@/lib/preferences-storage";
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
  markProfileNetworkLoaded,
  readInflightProfileFetch,
  readProfileSessionCache,
  trackInflightProfileFetch,
  writeProfileSessionCache,
} from "@/lib/profile-session-cache";
import {
  buildTravelPrefResultSnapshot,
  getTravelPrefResultSnapshot,
  readTravelPrefResultCache,
  writeTravelPrefResultCache,
  normalizeTravelPrefSnapshot,
} from "@/lib/travel-pref-result-cache";
import { mergeTravelPrefFields } from "@/lib/travel-pref-compact";
import { sanitizeForJsonStorage } from "@/lib/travel-pref-cache-write";
import {
  upsertTravelPersonalityToSupabase,
  TRAVEL_PREF_UPSERT_TIMEOUT_MS,
} from "@/lib/travel-pref-supabase-upsert";
import { markTravelPrefPendingSync } from "@/lib/travel-pref-sync-state";

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
  quizCompleted?: boolean;
  plusQuizCompleted?: boolean;
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
  profileUpdatedAt?: string | null;
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

function mergeProfileWithTravelPrefCache(
  profile: UserProfile,
  userId: string,
): UserProfile {
  const rawCached = getTravelPrefResultSnapshot(userId);
  const cached = rawCached ? normalizeTravelPrefSnapshot(rawCached) : null;
  if (!cached?.quizCompleted && !cached?.prefs.onboarded) return profile;

  const prefs = mergeTravelPrefFields(cached.prefs, profile.prefs);
  prefs.onboarded = true;
  const personality = derivePersonality(prefs);
  return {
    ...profile,
    prefs,
    travelStyle:
      profile.travelStyle ||
      cached.travelStyleName ||
      cached.travelStyle ||
      prefs.personalityType ||
      personality.type,
    personalityType:
      profile.personalityType ||
      cached.travelStyleId ||
      prefs.personalityType ||
      personality.type,
    personalitySummary:
      profile.personalitySummary || prefs.personalitySummary || personality.summary,
    personalityImpression: profile.personalityImpression || personality.impression,
    aiPreferences: {
      ...(profile.aiPreferences ?? {}),
      travelStyle: cached.travelStyleName || cached.travelStyle,
      travelPreferences: cached.tags,
      pacePreference: cached.pace ?? prefs.pace ?? "",
      vibePreference: cached.vibe ?? prefs.vibe ?? "",
      budgetPreference: cached.budget ?? resolveBudgetMode(prefs),
      quizCompleted: true,
      plusQuizCompleted: true,
      updatedAt: cached.updatedAt,
    },
  };
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
  "display_name, avatar_url, cover_image_url, bio, language, notifications_enabled, auth_provider, ai_preferences, updated_at";

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

  const prefs =
    !options?.force && isPreferencesRemoteHydrated(userId)
      ? readCachedPreferencesSync()
      : await getPreferences(options?.force ? { force: true } : undefined);
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
    profileUpdatedAt: data?.updated_at ?? null,
  };

  const profile = gatePlusPersonaFields(raw, hasPlusAccess);
  const hydrated = mergeProfileWithTravelPrefCache(profile, userId);
  if (hydrated.prefs.onboarded) {
    writeTravelPrefResultCache(
      buildTravelPrefResultSnapshot(hydrated.prefs, {
        travelStyle: hydrated.travelStyle || hydrated.personalityType,
        userId,
      }),
      userId,
    );
    console.info("[TRAVEL_PREF_RESULT] restored to profile state", {
      travelStyle: hydrated.travelStyle || hydrated.personalityType,
      tagsCount: buildTravelPrefTags(hydrated.prefs).length,
    });
  }
  writeProfileSessionCache(hydrated, userId);
  markProfileNetworkLoaded(userId);
  return hydrated;
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

async function readProfileExtras(userId: string): Promise<ProfileExtras> {
  const { data, error } = await supabase
    .from("profiles")
    .select("ai_preferences")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.ai_preferences || typeof data.ai_preferences !== "object") return {};
  return data.ai_preferences as ProfileExtras;
}

function buildTravelPrefTags(prefs: TravelPreferences): string[] {
  return Array.from(
    new Set(
      [
        ...(prefs.interests ?? []),
        prefs.pace === "slow" ? "慢行" : prefs.pace === "active" ? "探索" : null,
        prefs.vibe === "quiet" ? "安靜" : prefs.vibe === "lively" ? "熱鬧" : "平衡",
        BUDGET_MODE_LABELS[resolveBudgetMode(prefs)],
      ].filter((v): v is string => Boolean(v)),
    ),
  ).slice(0, 5);
}

async function upsertProfileExtras(
  userId: string,
  patch: ProfileExtras,
  options?: { background?: boolean },
): Promise<void> {
  await ensureUserProfile(userId);
  const prev = await readProfileExtras(userId);
  const merged: ProfileExtras = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ai_preferences: merged as never }, { onConflict: "id" });
  if (error) {
    const msg = error.message ?? "";
    console.warn("[TRAVEL_PREF_TEST] profile extras sync error", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
      patchKeys: Object.keys(patch),
    });
    if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
      console.warn("[profile] Supabase profile schema mismatch, skipped ai_preferences sync", msg);
      return;
    }
    if (options?.background) {
      logPreferencesSyncFailure("profile fields sync", error, { patchKeys: Object.keys(patch) });
      return;
    }
    throw new Error(error.message);
  }
}

const TRAVEL_QUIZ_REMOTE_TIMEOUT_MS = TRAVEL_PREF_UPSERT_TIMEOUT_MS;

/** 第一次測驗新增、重新測驗覆蓋：upsert travel_personality + ai_preferences */
export async function syncTravelQuizResultToSupabase(
  input: {
    travelStyle: string;
    prefs: TravelPreferences;
  },
  options?: { background?: boolean; timeoutMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? TRAVEL_QUIZ_REMOTE_TIMEOUT_MS;
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    console.warn("[TRAVEL_QUIZ_SAVE_ERROR]", {
      code: "NO_USER",
      message: "no authenticated user",
      details: "",
      hint: "",
    });
    return;
  }

  markTravelPrefPendingSync(userId, input.travelStyle);

  const prev = await readProfileExtras(userId).catch(() => ({} as ProfileExtras));
  const tags = buildTravelPrefTags(input.prefs);
  const aiPreferences: ProfileExtras = {
    ...prev,
    travelStyle: input.travelStyle.trim(),
    travelPreferences: tags,
    pacePreference: input.prefs.pace ?? "",
    vibePreference: input.prefs.vibe ?? "",
    budgetPreference: resolveBudgetMode(input.prefs),
    personalityType: input.prefs.personalityType,
    personalitySummary: input.prefs.personalitySummary,
    quizCompleted: true,
    plusQuizCompleted: true,
    updatedAt: new Date().toISOString(),
  };

  try {
    await upsertTravelPersonalityToSupabase(
      {
        userId,
        prefs: input.prefs,
        travelStyle: input.travelStyle,
        aiPreferences: aiPreferences as Record<string, unknown>,
        source: "travel-quiz-save",
      },
      { timeoutMs },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (/record\s+\"new\"\s+has\s+no\s+field\s+\"updated_at\"/i.test(msg)) {
      console.warn("[profile] Supabase profile schema mismatch, skipped travel quiz upsert", msg);
      return;
    }
    if (options?.background) {
      logPreferencesSyncFailure("travel quiz upsert", error, { userId });
      return;
    }
    throw error;
  }

  const sanitizedPrefs = sanitizeForJsonStorage(input.prefs);
  if (!sanitizedPrefs) return;

  writeTravelPrefResultCache(
    buildTravelPrefResultSnapshot(sanitizedPrefs, {
      travelStyle: input.travelStyle,
      userId,
    }),
    userId,
  );
  console.info("[TRAVEL_QUIZ_SAVE_SUCCESS]", {
    resultName: input.travelStyle,
    phase: "remote",
  });
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
  if (!userId) return;
  await upsertProfileExtras(userId, {
    personalityType: p.type,
    personalitySummary: p.summary,
  });
}

export async function syncQuizCompletionToProfile(
  input: {
    travelStyle: string;
    prefs: TravelPreferences;
  },
  options?: { background?: boolean; timeoutMs?: number },
): Promise<void> {
  await syncTravelQuizResultToSupabase(input, options);
}

export async function syncTravelPreferenceProfileFields(input: {
  travelStyle?: string;
  prefs: TravelPreferences;
}): Promise<void> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return;
  const tags = buildTravelPrefTags(input.prefs);
  await upsertProfileExtras(userId, {
    travelStyle: input.travelStyle?.trim() || "",
    travelPreferences: tags,
    pacePreference: input.prefs.pace ?? "",
    transportPreference:
      ((input.prefs as TravelPreferences & { transportPreference?: string }).transportPreference ??
        "") || "",
    vibePreference: input.prefs.vibe ?? "",
    budgetPreference: resolveBudgetMode(input.prefs),
    personalityType: input.prefs.personalityType,
    personalitySummary: input.prefs.personalitySummary,
    quizCompleted: Boolean(input.prefs.onboarded),
    plusQuizCompleted: Boolean(input.prefs.onboarded),
  });
}
