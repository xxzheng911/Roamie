import { createFileRoute, getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  LogOut,
  Route as RouteIcon,
  Pencil,
  Loader2,
  UserRound,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useAvatar } from "@/hooks/use-avatar";
import { useCover } from "@/hooks/use-cover";
import { useI18n } from "@/hooks/use-i18n";
import { ROAMIE_BUILD_DEBUG } from "@/lib/app-bundle-version";
import { getClientAuthSession, isAuthSessionMissingError } from "@/lib/auth-session";
import { ImageSourceSheet } from "@/components/ImageSourceSheet";
import { ProfileCover } from "@/components/ProfileCover";
import { AvatarCropSheet } from "@/components/profile/AvatarCropSheet";
import { ProfileImageCropSheet } from "@/components/profile/ProfileImageCropSheet";
import { COVER_UPDATED_EVENT, broadcastCoverUpdate } from "@/lib/cover-events";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { BUDGET_MODE_LABELS, readCachedPreferencesSync, resolveBudgetMode } from "@/lib/preferences-storage";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { logAvatarFileReadSuccess } from "@/lib/avatar-upload-log";
import {
  applyProfileAvatar,
  applyProfileCover,
  removeProfileCover,
} from "@/lib/profile-media-storage";
import {
  getUserProfile,
  saveUserProfile,
  syncTravelPreferenceProfileFields,
  type UserProfile,
} from "@/lib/profile-storage";
import { buildCompanionSummary } from "@/lib/personality";
import {
  gatePlusPersonaFields,
  shouldExposePlusPersona,
} from "@/lib/profile-persona";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { useAppMainScroll } from "@/hooks/use-app-main-scroll";
import { useAccess } from "@/hooks/use-access";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { loadDraftTrip } from "@/lib/trip-draft-storage";
import { PlusUpgradeDialog } from "@/components/PlusUpgradeDialog";
import {
  readProfileSessionCache,
  shouldSkipProfileNetworkLoad,
} from "@/lib/profile-session-cache";
import { readPersistedAvatarUrl, readPersistedCoverUrl } from "@/lib/profile-persisted-cache";
import {
  buildUserProfileFromTravelPrefCache,
  buildTravelPrefResultSnapshot,
  getTravelPrefResultSnapshot,
} from "@/lib/travel-pref-result-cache";
import { getTravelPrefStatusSync } from "@/lib/travel-pref-status";
import { logAuthRedirectLogin, logProfileLoad, logProfileLoadFail } from "@/lib/auth-boot-log";
import { shouldRefreshProfileOnMount, shouldHydrateProfileUi } from "@/lib/app-boot-cache";
import { logPerfProfileLoadSkip } from "@/lib/app-perf";
import { useTravelPrefStatus } from "@/hooks/use-preference-quiz-status";
import { isPreferencesRemoteHydrated } from "@/lib/preferences-storage";

type ProfileSearch = { quiz?: string };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const Route = createFileRoute("/_app/profile")({
  validateSearch: (s: Record<string, unknown>): ProfileSearch => ({
    quiz: typeof s.quiz === "string" ? s.quiz : undefined,
  }),
  component: Profile,
});

const profileRouteApi = getRouteApi("/_app/profile");

function validateImageFile(file: File): boolean {
  if (!file.type.startsWith("image/")) {
    toast.error("請選擇圖片檔案");
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("圖片請小於 8MB");
    return false;
  }
  return true;
}

function Profile() {
  const search = profileRouteApi.useSearch();
  const navigate = useNavigate();
  const { user, session, loading: authLoading, signOut } = useAuth();
  const userId = user?.id;
  const userEmail = user?.email;
  const { t, locale } = useI18n();
  const {
    avatarDisplaySrc,
    avatarPending,
    setPreview: setAvatarPreview,
    syncFromProfile: syncAvatarFromProfile,
  } = useAvatar();
  const {
    coverUrl,
    coverDisplaySrc,
    coverPending,
    setPreview: setCoverPreview,
    syncFromProfile: syncCoverFromProfile,
  } = useCover();
  const { hasPlusAccess } = useAccess();
  const [hasDraft, setHasDraft] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  /** Local blob preview after pick — never write unstable ?t= URLs into profile state */
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const coverPreviewRef = useRef<string | null>(null);
  const [coverSourceOpen, setCoverSourceOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [coverApplying, setCoverApplying] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);

  const [avatarSourceOpen, setAvatarSourceOpen] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [avatarApplying, setAvatarApplying] = useState(false);
  const initialCachedProfile = readProfileSessionCache(userId);
  const initialTravelPref = getTravelPrefResultSnapshot(userId);
  const initialProfileFromTravelPref = initialTravelPref
    ? buildUserProfileFromTravelPrefCache(initialTravelPref, locale)
    : null;
  const initialProfile = initialCachedProfile ?? initialProfileFromTravelPref;
  const hasPersistedMedia = Boolean(
    readPersistedAvatarUrl(userId) || readPersistedCoverUrl(userId),
  );
  const [loading, setLoading] = useState(() => !initialProfile && !hasPersistedMedia);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState(() => initialProfile?.displayName ?? "");
  const [draftName, setDraftName] = useState("");
  const [travelStyle, setTravelStyle] = useState(() => initialProfile?.travelStyle ?? "");
  const [personalityType, setPersonalityType] = useState(
    () => initialProfile?.personalityType ?? "",
  );
  const [personalitySummary, setPersonalitySummary] = useState(
    () => initialProfile?.personalitySummary ?? "",
  );
  const [personalityImpression, setPersonalityImpression] = useState(
    () => initialProfile?.personalityImpression ?? "",
  );
  const [companionSummary, setCompanionSummary] = useState("");
  const [onboarded, setOnboarded] = useState(() => !!initialProfile?.prefs.onboarded);
  const [quizSyncing, setQuizSyncing] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [pace, setPace] = useState("");
  const [vibe, setVibe] = useState("");
  const [budgetLabel, setBudgetLabel] = useState("—");
  const [avoidKey, setAvoidKey] = useState<string | null>(null);
  const [travelTags, setTravelTags] = useState<string[]>(() => initialTravelPref?.tags ?? []);

  const quizDoneToastShown = useRef(false);
  const profileSnapshotRef = useRef<UserProfile | null>(initialProfile);
  const profileApplyFingerprintRef = useRef("");

  const revokeCoverPreview = useCallback(() => {
    if (coverPreviewRef.current) {
      try {
        URL.revokeObjectURL(coverPreviewRef.current);
      } catch {
        /* noop */
      }
      coverPreviewRef.current = null;
    }
    setCoverPreviewUrl(null);
  }, []);

  useEffect(() => {
    return () => {
      const u = coverPreviewRef.current;
      if (u) {
        try {
          URL.revokeObjectURL(u);
        } catch {
          /* noop */
        }
        coverPreviewRef.current = null;
      }
      setAvatarPreview(null);
      setCoverPreview(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, []);

  useAppMainScroll();

  const travelPrefStatus = useTravelPrefStatus();
  const quizCompleted =
    travelPrefStatus?.preferenceQuizCompleted ?? onboarded;
  const travelStyleLabel =
    travelPrefStatus?.travelStyleName?.trim() ||
    (quizCompleted && travelStyle.trim() ? travelStyle.trim() : "") ||
    (hasPlusAccess ? t("profile.travelStyleEmpty") : "") ||
    "";
  const resolvedDisplayName = displayName.trim() || t("profile.defaultName");

  useEffect(() => {
    setHasDraft(Boolean(loadDraftTrip()));
  }, []);

  useEffect(() => {
    const onCover = () => {
      revokeCoverPreview();
    };
    window.addEventListener(COVER_UPDATED_EVENT, onCover);
    return () => window.removeEventListener(COVER_UPDATED_EVENT, onCover);
  }, [revokeCoverPreview]);

  const loadProfile = useCallback(async (options?: { force?: boolean }) => {
    if (userId && !options?.force) {
      const skip = shouldSkipProfileNetworkLoad(userId, false);
      if (skip.skip) {
        const cached = readProfileSessionCache(userId);
        if (cached) return cached;
      }
    }
    const hadCache = Boolean(userId && readProfileSessionCache(userId));
    try {
      const profile = await getUserProfile(undefined, { force: options?.force });
      if (!hadCache || options?.force) {
        logProfileLoad({ userId });
      }
      return profile;
    } catch (firstErr) {
      if (!userId) throw firstErr;
      logProfileLoadFail({
        userId,
        message: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });
      console.warn("[profile] fetch failed, ensuring profile row", firstErr);
      await ensureUserProfile();
      const profile = await getUserProfile(undefined, { force: true });
      logProfileLoad({ userId, recovered: true });
      return profile;
    }
  }, [userId]);

  const applyProfileToState = useCallback(
    (profile: UserProfile, options?: { source?: string }) => {
      const status = getTravelPrefStatusSync(userId);
      const cachedTravelPref = status.snapshot ?? getTravelPrefResultSnapshot(userId);
      const mergedPrefs = status.preferenceQuizCompleted
        ? status.prefs
        : profile.prefs;
      const mergedProfile: UserProfile = {
        ...profile,
        prefs: mergedPrefs,
        travelStyle:
          status.travelStyleName ||
          profile.travelStyle ||
          cachedTravelPref?.travelStyle ||
          mergedPrefs.personalityType ||
          "",
        personalityType:
          status.travelStyleName ||
          profile.personalityType ||
          mergedPrefs.personalityType ||
          "",
        personalitySummary:
          status.personalitySummary ||
          profile.personalitySummary ||
          mergedPrefs.personalitySummary ||
          "",
      };
      const fingerprint = [
        mergedProfile.displayName,
        mergedProfile.travelStyle,
        mergedProfile.personalityType,
        status.preferenceQuizCompleted,
        mergedProfile.prefs.pace,
        mergedProfile.prefs.vibe,
        mergedProfile.prefs.budgetMode,
        mergedProfile.avatarUrl,
        mergedProfile.coverImageUrl,
      ].join("|");
      if (fingerprint === profileApplyFingerprintRef.current) {
        return;
      }
      profileApplyFingerprintRef.current = fingerprint;
      profileSnapshotRef.current = mergedProfile;
      const showPlusPersona = shouldExposePlusPersona(hasPlusAccess, mergedProfile.prefs);
      const gated = gatePlusPersonaFields(mergedProfile, hasPlusAccess);
      const nextCompanion = showPlusPersona ? buildCompanionSummary(mergedProfile.prefs) : "";
      setDisplayName((prev) => (prev === gated.displayName ? prev : gated.displayName));
      syncCoverFromProfile(gated.coverImageUrl);
      syncAvatarFromProfile(gated.avatarUrl);
      const nextTravelStyle =
        status.travelStyleName || (showPlusPersona ? gated.travelStyle : "");
      setTravelStyle((prev) => (prev === nextTravelStyle ? prev : nextTravelStyle));
      const nextPersonalityType = showPlusPersona ? gated.personalityType : "";
      setPersonalityType((prev) => (prev === nextPersonalityType ? prev : nextPersonalityType));
      const nextPersonalitySummary = showPlusPersona ? gated.personalitySummary : "";
      setPersonalitySummary((prev) =>
        prev === nextPersonalitySummary ? prev : nextPersonalitySummary,
      );
      const nextPersonalityImpression = showPlusPersona ? gated.personalityImpression : "";
      setPersonalityImpression((prev) =>
        prev === nextPersonalityImpression ? prev : nextPersonalityImpression,
      );
      setCompanionSummary((prev) => (prev === nextCompanion ? prev : nextCompanion));
      const nextOnboarded = status.preferenceQuizCompleted;
      setOnboarded((prev) => (prev === nextOnboarded ? prev : nextOnboarded));
      const paceMap = {
        slow: t("profile.paceSlow"),
        medium: t("profile.paceMedium"),
        active: t("profile.paceActive"),
      } as const;
      const vibeMap = {
        quiet: t("profile.vibeQuiet"),
        either: t("profile.vibeEither"),
        lively: t("profile.vibeLively"),
      } as const;
      const resolvedPace = status.pace ?? mergedProfile.prefs.pace;
      const resolvedVibe = status.vibe ?? mergedProfile.prefs.vibe;
      const nextPace = resolvedPace ? paceMap[resolvedPace] : t("common.dash");
      setPace((prev) => (prev === nextPace ? prev : nextPace));
      const nextVibe = resolvedVibe ? vibeMap[resolvedVibe] : t("common.dash");
      setVibe((prev) => (prev === nextVibe ? prev : nextVibe));
      const nextBudgetLabel = mergedProfile.prefs.onboarded
        ? BUDGET_MODE_LABELS[resolveBudgetMode(mergedProfile.prefs)]
        : t("common.dash");
      setBudgetLabel((prev) => (prev === nextBudgetLabel ? prev : nextBudgetLabel));
      const nextAvoidKey = mergedProfile.prefs.avoid?.[0] ?? null;
      setAvoidKey((prev) => (prev === nextAvoidKey ? prev : nextAvoidKey));
      const tags =
        cachedTravelPref?.tags?.length && mergedProfile.prefs.onboarded
          ? cachedTravelPref.tags
          : Array.from(
        new Set(
          [
            ...(mergedProfile.prefs.interests ?? []),
            mergedProfile.prefs.pace === "slow"
              ? "慢行"
              : mergedProfile.prefs.pace === "active"
                ? "探索"
                : null,
            mergedProfile.prefs.vibe === "quiet"
              ? "安靜"
              : mergedProfile.prefs.vibe === "lively"
                ? "熱鬧"
                : "平衡",
            BUDGET_MODE_LABELS[resolveBudgetMode(mergedProfile.prefs)],
          ].filter((v): v is string => Boolean(v)),
        ),
      ).slice(0, 5);
      setTravelTags((prev) =>
        prev.length === tags.length && prev.every((tag, index) => tag === tags[index]) ? prev : tags,
      );
      if (mergedProfile.prefs.onboarded && options?.source === "boot") {
        console.info("[TRAVEL_PREF_RESULT] loaded", {
          travelStyle: mergedProfile.travelStyle || mergedProfile.personalityType || "未命名",
          tagsCount: tags.length,
        });
      }
    },
    [t, hasPlusAccess, locale, syncCoverFromProfile, syncAvatarFromProfile, userId],
  );

  useEffect(() => {
    const profile = profileSnapshotRef.current;
    if (profile?.prefs.onboarded) {
      applyProfileToState(profile);
      return;
    }
    const cachedTravelPref = getTravelPrefResultSnapshot(userId);
    const localPrefs = readCachedPreferencesSync();
    const travelPrefSnapshot =
      cachedTravelPref ??
      (localPrefs.onboarded
        ? buildTravelPrefResultSnapshot(localPrefs, { userId: userId ?? undefined })
        : null);
    if (travelPrefSnapshot?.quizCompleted || localPrefs.onboarded) {
      console.info("[TRAVEL_PREF_RESULT] skipped clearing because cache exists");
      const restored = buildUserProfileFromTravelPrefCache(travelPrefSnapshot!, locale);
      profileSnapshotRef.current = restored;
      applyProfileToState(restored);
      return;
    }
    if (!hasPlusAccess) {
      setTravelStyle("");
      setPersonalityType("");
      setPersonalitySummary("");
      setPersonalityImpression("");
      setCompanionSummary("");
    }
  }, [hasPlusAccess, applyProfileToState, userId, locale]);

  useEffect(() => {
    if (search.quiz !== "done" || quizDoneToastShown.current) return;
    quizDoneToastShown.current = true;
    setQuizSyncing(true);
    toast.success(t("profile.quizDone"));
    navigate({ to: "/profile", search: {}, replace: true });

    const cachedTravelPref = getTravelPrefResultSnapshot(userId);
    if (cachedTravelPref?.quizCompleted) {
      const restored = buildUserProfileFromTravelPrefCache(cachedTravelPref, locale);
      profileSnapshotRef.current = restored;
      applyProfileToState(restored);
    }

    void (async () => {
      try {
        const profile = await loadProfile({ force: true });
        applyProfileToState(profile);
      } catch (e) {
        console.warn("[TRAVEL_PREF_TEST] profile background refresh after quiz failed", {
          message: e instanceof Error ? e.message : String(e),
          hasLocalCache: Boolean(cachedTravelPref?.quizCompleted),
        });
      } finally {
        setQuizSyncing(false);
      }
    })();
  }, [search.quiz, t, navigate, loadProfile, applyProfileToState, userId, locale]);

  useEffect(() => {
    const onPrefs = () => {
      const travelPref = getTravelPrefResultSnapshot(userId);
      if (travelPref?.quizCompleted) {
        const restored = buildUserProfileFromTravelPrefCache(travelPref, locale);
        profileSnapshotRef.current = restored;
        applyProfileToState(restored);
      }
    };
    window.addEventListener(PREFS_UPDATED_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, onPrefs);
  }, [applyProfileToState, userId, locale]);

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const hadCache = Boolean(readProfileSessionCache(userId));
    if (!options?.force && userId) {
      const skip = shouldSkipProfileNetworkLoad(userId, false);
      if (skip.skip && hadCache) {
        applyProfileToState(readProfileSessionCache(userId)!);
        setLoading(false);
        return;
      }
      if (!options?.force && isPreferencesRemoteHydrated(userId) && hadCache) {
        applyProfileToState(readProfileSessionCache(userId)!);
        setLoading(false);
        return;
      }
    }
    if (!hadCache) setLoading(true);
    console.info("[profile] loading", { userId, force: options?.force ?? false });
    try {
      if (userId) await ensureUserProfile();
      const profile = await loadProfile({ force: options?.force });
      applyProfileToState(profile);
      if (profile.prefs.onboarded && hasPlusAccess) {
        void syncTravelPreferenceProfileFields({
          travelStyle: profile.travelStyle || profile.personalityType || "",
          prefs: profile.prefs,
        }).catch((e) => {
          console.warn("[TRAVEL_PREF_TEST] profile fields background sync failed", {
            message: e instanceof Error ? e.message : String(e),
          });
        });
      }
      console.info("[PROFILE] loaded");
    } catch (e) {
      if (e instanceof Error && isAuthSessionMissingError(e.message)) return;
      console.error("[profile] refresh failed", e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("請先登入")) return;
      if (getTravelPrefResultSnapshot(userId)?.quizCompleted) {
        console.info("[TRAVEL_PREF_RESULT] skipped clearing because cache exists");
        return;
      }
      applyProfileToState({
        displayName: userEmail?.split("@")[0] || t("profile.defaultName"),
        bio: "",
        avatarUrl: null,
        coverImageUrl: null,
        travelStyle: "",
        language: locale,
        notificationsEnabled: true,
        authProvider: null,
        prefs: { onboarded: false },
        personalityType: "",
        personalitySummary: "",
        personalityImpression: "",
      } as UserProfile);
      toast.error(msg || t("profile.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [userId, userEmail, locale, t, loadProfile, applyProfileToState, hasPlusAccess]);

  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      if (!session) {
        logAuthRedirectLogin("profile:no-user-after-auth-ready");
        navigate({ to: "/login", replace: true });
      }
      return;
    }
    if (!shouldHydrateProfileUi(userId)) {
      logPerfProfileLoadSkip("same_user");
      setLoading(false);
      return;
    }
    const cached = readProfileSessionCache(userId);
    const travelPref = getTravelPrefResultSnapshot(userId);
    if (cached) {
      applyProfileToState(cached, { source: "boot" });
      setLoading(false);
      if (shouldRefreshProfileOnMount(userId)) {
        void refresh();
      } else {
        logPerfProfileLoadSkip("same_user");
      }
      return;
    }
    if (travelPref) {
      const restored = buildUserProfileFromTravelPrefCache(travelPref, locale);
      profileSnapshotRef.current = restored;
      applyProfileToState(restored, { source: "boot" });
      console.info("[TRAVEL_PREF_RESULT] restored to profile state");
      setLoading(false);
    }
    if (readPersistedAvatarUrl(userId) || readPersistedCoverUrl(userId)) {
      setLoading(false);
    }
    if (shouldRefreshProfileOnMount(userId)) {
      void refresh();
    } else {
      logPerfProfileLoadSkip("same_user");
    }
  }, [authLoading, userId, session, navigate, refresh, applyProfileToState, locale]);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (userId && loading && !profileSnapshotRef.current) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const devMode = isDeveloperBuildEnabled();
  const showPlusPersona = hasPlusAccess && onboarded;
  const displayCompanionSummary = showPlusPersona ? companionSummary : "";

  const handleSaveProfile = async () => {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
      toast.error(t("profile.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await saveUserProfile({
        displayName: trimmedName,
      });
      setDisplayName(trimmedName);
      setEditing(false);
      toast.success(t("profile.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const beginProfileEditing = () => {
    setDraftName(resolvedDisplayName);
    setEditing(true);
  };

  const cancelProfileEditing = () => {
    setDraftName(resolvedDisplayName);
    setEditing(false);
  };

  const handleCoverPick = (file: File) => {
    if (!validateImageFile(file)) return;
    console.info("[IMAGE_PICK]", "cover", `bytes=${file.size}`, `type=${file.type}`);
    revokeCoverPreview();
    const u = URL.createObjectURL(file);
    coverPreviewRef.current = u;
    setCoverPreviewUrl(u);
    setCoverCropFile(file);
  };

  const handleCoverCancel = () => {
    revokeCoverPreview();
    setCoverCropFile(null);
  };

  const handleCoverApply = async (blob: Blob) => {
    setCoverApplying(true);
    try {
      console.info("[IMAGE_UPLOAD]", "cover", `bytes=${blob.size}`);
      const finalUrl = await applyProfileCover(blob);
      const revision = Date.now();
      broadcastCoverUpdate(finalUrl, revision);
      revokeCoverPreview();
      setCoverCropFile(null);
      toast.success("封面已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "儲存失敗";
      if (!isAuthSessionMissingError(msg)) toast.error(msg);
    } finally {
      setCoverApplying(false);
    }
  };

  const handleCoverRemove = async () => {
    setCoverRemoving(true);
    try {
      await removeProfileCover();
      broadcastCoverUpdate(null);
      revokeCoverPreview();
      setCoverCropFile(null);
      toast.success("已移除封面，可繼續選擇新圖片");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "刪除失敗";
      if (!isAuthSessionMissingError(msg)) toast.error(msg);
    } finally {
      setCoverRemoving(false);
    }
  };

  const handleAvatarPick = (file: File) => {
    if (!validateImageFile(file)) return;
    console.info("[IMAGE_PICK]", "avatar", `bytes=${file.size}`, `type=${file.type}`);
    const u = URL.createObjectURL(file);
    setAvatarPreview(u);
    setAvatarCropFile(file);
  };

  const handleAvatarCancel = () => {
    setAvatarPreview(null);
    setAvatarCropFile(null);
  };

  const handleAvatarConfirm = async (blob: Blob) => {
    setAvatarApplying(true);
    try {
      const session = await getClientAuthSession();
      if (!session?.user) {
        toast.error("請重新登入後再試");
        return;
      }
      logAvatarFileReadSuccess({
        bytes: blob.size,
        type: blob.type || "image/jpeg",
        userId: session.user.id,
      });
      console.info("[IMAGE_UPLOAD]", "avatar", `bytes=${blob.size}`);
      const finalUrl = await applyProfileAvatar(blob);
      const revision = Date.now();
      broadcastAvatarUpdate(finalUrl, revision);
      setAvatarPreview(null);
      setAvatarCropFile(null);
      toast.success("頭像已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "儲存失敗";
      if (isAuthSessionMissingError(msg)) {
        toast.error("請重新登入後再試");
      } else {
        toast.error(msg);
      }
    } finally {
      setAvatarApplying(false);
    }
  };

  const items = [
    {
      icon: UserRound,
      label: t("settings.account"),
      to: "/settings" as const,
    },
    {
      icon: RouteIcon,
      label: "行程草稿",
      value: hasDraft ? "1 份" : "尚無",
      to: hasDraft ? "/trip" : "/chat",
      search: hasDraft ? { draft: "1" } : undefined,
    },
  ];

  const cancelLabel = t("profile.cancel");
  const applyLabel = t("profile.apply");

  return (
    <div className="profile-page flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-3 no-scrollbar">
      <div className="overflow-visible rounded-[2rem] border border-border bg-card shadow-soft">
        <ProfileCover
          displaySrc={coverPreviewUrl ?? coverDisplaySrc}
          pending={coverPending && !coverPreviewUrl}
          busy={coverApplying || coverRemoving}
          onPress={() => {
            if (!coverApplying && !coverRemoving) {
              setCoverSourceOpen(true);
            }
          }}
        />
        <ImageSourceSheet
          open={coverSourceOpen}
          onOpenChange={setCoverSourceOpen}
          title="更換封面"
          onPickFile={handleCoverPick}
          showRemove={!!coverUrl}
          onRemove={() => void handleCoverRemove()}
          removing={coverRemoving}
          cameraFacing="environment"
        />
        <ProfileImageCropSheet
          open={!!coverCropFile}
          file={coverCropFile}
          variant="cover"
          onOpenChange={(open) => {
            if (!open) handleCoverCancel();
          }}
          onConfirm={handleCoverApply}
          applying={coverApplying}
          cancelLabel={cancelLabel}
          doneLabel={applyLabel}
        />

        <div className="relative overflow-visible px-5 pb-5 pt-2">
          <div className="absolute -top-14 left-0 z-20 h-[6.75rem] w-[6.75rem]">
            <button
              type="button"
              onClick={() => !avatarApplying && setAvatarSourceOpen(true)}
              disabled={avatarApplying}
              className="group relative block h-full w-full shrink-0 overflow-hidden rounded-full border-[3px] border-card bg-secondary shadow-soft disabled:opacity-90"
              aria-label={t("profile.editAvatar")}
            >
              {avatarPending ? (
                <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
              ) : avatarDisplaySrc ? (
                <img
                  src={avatarDisplaySrc}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />
              ) : (
                <div className="absolute inset-0 animate-pulse bg-muted" aria-hidden />
              )}
              <div
                className={`pointer-events-none absolute inset-0 rounded-full transition duration-200 ${
                  avatarApplying
                    ? "bg-card/45"
                    : "bg-foreground/0 group-hover:bg-foreground/10 group-active:bg-foreground/15"
                }`}
              />
              {avatarApplying && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-card/95 shadow-soft backdrop-blur-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-clay" aria-hidden />
                  </span>
                </span>
              )}
            </button>
          </div>

          <ImageSourceSheet
            open={avatarSourceOpen}
            onOpenChange={setAvatarSourceOpen}
            title="更換頭像"
            onPickFile={handleAvatarPick}
            cameraFacing="user"
          />

          <AvatarCropSheet
            open={!!avatarCropFile}
            file={avatarCropFile}
            onOpenChange={(open) => {
              if (!open) handleAvatarCancel();
            }}
            onConfirm={handleAvatarConfirm}
            applying={avatarApplying}
            cancelLabel={cancelLabel}
            doneLabel={applyLabel}
          />

          <div className="pt-[4.25rem]">
            {editing ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t("profile.name")}</span>
                  <input
                    value={draftName ?? ""}
                    onChange={(e) => setDraftName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                  />
                </label>
                {hasPlusAccess ? (
                  <div className="block">
                    <span className="text-[11px] text-muted-foreground">
                      {t("profile.travelStyle")}
                    </span>
                    <p className="mt-1 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                      {travelStyleLabel}
                    </p>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={cancelProfileEditing}
                    className="flex-1 rounded-full border border-border py-2.5 text-sm"
                  >
                    {cancelLabel}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveProfile}
                    disabled={saving}
                    className="flex-1 rounded-full bg-primary py-2.5 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    {saving ? t("profile.saving") : t("profile.save")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-xl leading-tight">{resolvedDisplayName}</p>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {hasPlusAccess ? "Plus" : "Free"}
                      </span>
                      {devMode ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                          DEV
                        </span>
                      ) : null}
                    </div>
                    {hasPlusAccess ? (
                      <p className="mt-3 text-sm leading-relaxed">
                        <span className="text-muted-foreground">{t("profile.travelStyle")}：</span>
                        <span className="text-foreground/85">{travelStyleLabel}</span>
                      </p>
                    ) : null}
                    {displayCompanionSummary ? (
                      <p className="mt-2 text-sm leading-relaxed text-foreground/75">
                        {displayCompanionSummary}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={beginProfileEditing}
                    className="rounded-full bg-secondary p-2 text-muted-foreground"
                    aria-label={t("profile.editProfile")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
                {hasPlusAccess && onboarded && (
                  <div className="mt-4 flex gap-2">
                    {[
                      { k: t("profile.pace"), v: pace },
                      { k: t("profile.vibe"), v: vibe },
                      { k: t("profile.budget"), v: budgetLabel },
                    ].map((p) => (
                      <div
                        key={p.k}
                        className="flex-1 rounded-2xl bg-secondary px-3 py-2.5 text-center"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {p.k}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">{p.v}</p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <section className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-clay" />
          Plus 旅行偏好測驗
        </div>
        <p className="mt-2 font-display text-[18px] leading-snug">讓 Roamie 更懂你的旅行偏好</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          完成幾個小問題，之後推薦地點與行程時會更貼近你。
        </p>
        {hasPlusAccess ? (
          <button
            type="button"
            onClick={() => {
              console.info("[TRAVEL_PREF_TEST] start");
              void navigate({ to: "/travel-preference-test", search: { from: "profile" } });
            }}
            className="mt-4 w-full rounded-full bg-primary py-3 text-sm text-primary-foreground"
          >
            {quizCompleted ? "重新測驗" : "開始測驗"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              console.info("[TRAVEL_PREF_TEST] start");
              setUpgradeOpen(true);
            }}
            className="mt-4 w-full rounded-full bg-primary py-3 text-sm text-primary-foreground"
          >
            升級 Plus 解鎖
          </button>
        )}
      </section>

      {showPlusPersona ? (
        <section className="mt-4 rounded-3xl bg-secondary p-5">
          <p className="font-display text-[18px]">
            {travelStyleLabel || personalityType || "慢步放鬆型"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            標籤：{travelTags.length > 0 ? travelTags.join("、") : "安靜、散步、咖啡、自然、慢行"}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-foreground/85">
            {quizSyncing ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("profile.quizSyncing")}
              </span>
            ) : (
              personalityImpression ||
              "你適合慢慢走、留一點空白的旅行。Roamie 會優先幫你找安靜、有氛圍、適合散步的地方。"
            )}
          </p>
        </section>
      ) : null}

      <section className="relative z-10 mt-6">
        <ul className="overflow-hidden rounded-3xl border border-border bg-card shadow-soft">
          {items.map((it, i) => {
            const Icon = it.icon;
            const cls = `flex w-full items-center gap-3 px-4 py-3.5 text-left ${i !== items.length - 1 ? "border-b border-border" : ""}`;
            return (
              <li key={it.label} className={i !== items.length - 1 ? "border-b border-border" : ""}>
                <Link to={it.to} search={it.search} className={cls}>
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="flex-1 text-[15px]">{it.label}</p>
                  {"value" in it && it.value ? (
                    <p className="text-sm text-muted-foreground">{it.value}</p>
                  ) : null}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t("profile.footer")}
      </p>
      <p className="mt-2 text-center font-mono text-[10px] text-muted-foreground/70">
        {ROAMIE_BUILD_DEBUG}
      </p>

      {user ? (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
            console.info("[LOGOUT] clicked");
            setSigningOut(true);
            void signOut()
              .then(async () => {
                toast.success(t("profile.signedOut"));
                const { resetToLoginScreen } = await import("@/lib/clear-auth-state");
                await resetToLoginScreen("profile-sign-out");
              })
              .catch((e) => {
                toast.error(e instanceof Error ? e.message : t("profile.saveFailed"));
              })
              .finally(() => setSigningOut(false));
          }}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card py-3.5 text-[15px] text-muted-foreground disabled:opacity-50"
        >
          {signingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          {t("settings.signOutAccount")}
        </button>
      ) : null}
      <PlusUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} feature="quiz" />

      <div aria-hidden className="h-6 shrink-0" />
    </div>
  );
}
