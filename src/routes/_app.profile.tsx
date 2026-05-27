import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bell,
  ChevronRight,
  Globe,
  LogOut,
  Route as RouteIcon,
  Settings,
  SlidersHorizontal,
  Pencil,
  Loader2,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useAvatar } from "@/hooks/use-avatar";
import { useI18n } from "@/hooks/use-i18n";
import { getClientAuthSession, isAuthSessionMissingError } from "@/lib/auth-session";
import { supabase } from "@/lib/supabase";
import { ImageSourceSheet } from "@/components/ImageSourceSheet";
import { ProfileCover } from "@/components/ProfileCover";
import { AvatarCropSheet } from "@/components/profile/AvatarCropSheet";
import { ProfileImageCropSheet } from "@/components/profile/ProfileImageCropSheet";
import { COVER_UPDATED_EVENT, broadcastCoverUpdate } from "@/lib/cover-events";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
} from "@/lib/preferences-storage";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import { logAvatarFileReadSuccess } from "@/lib/avatar-upload-log";
import {
  applyProfileAvatar,
  applyProfileCover,
  removeProfileCover,
} from "@/lib/profile-media-storage";
import { getUserProfile, saveUserProfile, type UserProfile } from "@/lib/profile-storage";
import { buildCompanionSummary } from "@/lib/personality";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";
import { useAppMainScroll } from "@/hooks/use-app-main-scroll";
import { useAccess } from "@/hooks/use-access";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { ProfilePlanSwitcher } from "@/components/profile/ProfilePlanSwitcher";
import { loadDraftTrip } from "@/lib/trip-draft-storage";

type ProfileSearch = { quiz?: string };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const Route = createFileRoute("/_app/profile")({
  validateSearch: (s: Record<string, unknown>): ProfileSearch => ({
    quiz: typeof s.quiz === "string" ? s.quiz : undefined,
  }),
  component: Profile,
});

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
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { t, locale } = useI18n();
  const { avatarSrc, refresh: refreshAvatar } = useAvatar();
  const { hasPlusAccess } = useAccess();
  const [hasDraft, setHasDraft] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverSourceOpen, setCoverSourceOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [coverApplying, setCoverApplying] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);

  const [avatarSourceOpen, setAvatarSourceOpen] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [avatarApplying, setAvatarApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [travelStyle, setTravelStyle] = useState("");
  const [personalityType, setPersonalityType] = useState("");
  const [personalitySummary, setPersonalitySummary] = useState("");
  const [personalityImpression, setPersonalityImpression] = useState("");
  const [companionSummary, setCompanionSummary] = useState("");
  const [onboarded, setOnboarded] = useState(false);
  const [quizSyncing, setQuizSyncing] = useState(false);
  const [pace, setPace] = useState("");
  const [vibe, setVibe] = useState("");
  const [budgetLabel, setBudgetLabel] = useState("—");
  const [avoidKey, setAvoidKey] = useState<string | null>(null);

  useAppMainScroll();

  useEffect(() => {
    setHasDraft(Boolean(loadDraftTrip()));
  }, []);

  useEffect(() => {
    const onCover = (e: Event) => {
      const url = (e as CustomEvent<string | null>).detail ?? null;
      setCoverUrl(url);
      setCoverCropFile(null);
    };
    window.addEventListener(COVER_UPDATED_EVENT, onCover);
    return () => window.removeEventListener(COVER_UPDATED_EVENT, onCover);
  }, []);

  const quizDoneToastShown = useRef(false);

  const loadProfile = async () => {
    try {
      return await getUserProfile();
    } catch (firstErr) {
      if (!user) throw firstErr;
      console.warn("[profile] fetch failed, ensuring profile row", firstErr);
      await ensureUserProfile();
      return getUserProfile();
    }
  };

  const applyProfileToState = (profile: UserProfile) => {
    setDisplayName(profile.displayName);
    setBio(profile.bio);
    setCoverUrl(profile.coverImageUrl);
    setTravelStyle(profile.travelStyle);
    setPersonalityType(profile.personalityType);
    setPersonalitySummary(profile.personalitySummary);
    setPersonalityImpression(profile.personalityImpression);
    setCompanionSummary(buildCompanionSummary(profile.prefs));
    setOnboarded(!!profile.prefs.onboarded);
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
    setPace(profile.prefs.pace ? paceMap[profile.prefs.pace] : t("common.dash"));
    setVibe(profile.prefs.vibe ? vibeMap[profile.prefs.vibe] : t("common.dash"));
    setBudgetLabel(
      profile.prefs.onboarded
        ? BUDGET_MODE_LABELS[resolveBudgetMode(profile.prefs)]
        : t("common.dash"),
    );
    setAvoidKey(profile.prefs.avoid?.[0] ?? null);
  };

  useEffect(() => {
    if (search.quiz !== "done" || quizDoneToastShown.current) return;
    quizDoneToastShown.current = true;
    setQuizSyncing(true);
    toast.success(t("profile.quizDone"));
    navigate({ to: "/profile", search: {}, replace: true });
    void (async () => {
      try {
        const profile = await loadProfile();
        applyProfileToState(profile);
      } catch (e) {
        console.error("[profile] quiz sync failed", e);
      } finally {
        setQuizSyncing(false);
      }
    })();
  }, [search.quiz, t, navigate]);

  useEffect(() => {
    const onPrefs = () => {
      void (async () => {
        try {
          const profile = await loadProfile();
          applyProfileToState(profile);
        } catch (e) {
          console.error("[profile] prefs sync failed", e);
        }
      })();
    };
    window.addEventListener(PREFS_UPDATED_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_UPDATED_EVENT, onPrefs);
  }, [t]);

  const refresh = async () => {
    setLoading(true);
    console.info("[profile] loading", { hasUser: !!user });
    try {
      if (user) await ensureUserProfile();
      const profile = await loadProfile();
      applyProfileToState(profile);
      await refreshAvatar();
    } catch (e) {
      if (e instanceof Error && isAuthSessionMissingError(e.message)) return;
      console.error("[profile] refresh failed", e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("請先登入")) return;
      applyProfileToState({
        displayName: user?.email?.split("@")[0] || t("profile.defaultName"),
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
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/login", replace: true });
      return;
    }
    void refresh();
  }, [authLoading, user, locale, t, navigate]);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const devMode = isDeveloperBuildEnabled();

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await saveUserProfile({ displayName, bio, travelStyle });
      setEditing(false);
      toast.success(t("profile.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("profile.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleCoverPick = (file: File) => {
    if (!validateImageFile(file)) return;
    setCoverCropFile(file);
  };

  const handleCoverCancel = () => {
    setCoverCropFile(null);
  };

  const handleCoverApply = async (blob: Blob) => {
    setCoverApplying(true);
    try {
      const finalUrl = await applyProfileCover(blob);
      broadcastCoverUpdate(finalUrl);
      setCoverUrl(finalUrl);
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
      setCoverUrl(null);
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
    setAvatarCropFile(file);
  };

  const handleAvatarCancel = () => {
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
      const finalUrl = await applyProfileAvatar(blob);
      broadcastAvatarUpdate(finalUrl);
      setAvatarCropFile(null);
      await refreshAvatar();
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
      icon: SlidersHorizontal,
      label: "偏好設定",
      to: "/settings" as const,
    },
    {
      icon: RouteIcon,
      label: "行程草稿",
      value: hasDraft ? "1 份" : "尚無",
      to: hasDraft ? "/trip" : "/chat",
      search: hasDraft ? { draft: "1" } : undefined,
    },
    {
      icon: UserRound,
      label: t("settings.account"),
      to: "/settings" as const,
    },
    {
      icon: Bell,
      label: t("settings.notificationsLabel"),
      to: "/settings" as const,
    },
    {
      icon: Globe,
      label: t("settings.languageLabel"),
      to: "/settings" as const,
    },
    {
      icon: Settings,
      label: t("profile.otherSettings"),
      to: "/settings" as const,
    },
  ];

  const cancelLabel = t("profile.cancel");
  const applyLabel = t("profile.apply");

  return (
    <div className="profile-page flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain px-5 pb-[max(2.5rem,env(safe-area-inset-bottom,0px))] pt-3 no-scrollbar">
      <div className="overflow-visible rounded-[2rem] border border-border bg-card shadow-soft">
        <ProfileCover
          coverUrl={coverUrl}
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
              <img
                src={avatarSrc}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center"
              />
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
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t("profile.bio")}</span>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                    placeholder={t("profile.bioPlaceholder")}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-foreground">{t("profile.travelStyle")}</span>
                  <textarea
                    value={travelStyle}
                    onChange={(e) => setTravelStyle(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-border bg-secondary px-3 py-2 text-sm"
                    placeholder={t("profile.travelStylePlaceholder")}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
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
                      <p className="font-display text-xl leading-tight">{displayName}</p>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {hasPlusAccess ? "Plus" : "Free"}
                      </span>
                      {devMode ? (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                          DEV
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{bio}</p>
                    {hasPlusAccess && onboarded && companionSummary ? (
                      <p className="mt-2 text-sm leading-relaxed text-foreground/75">{companionSummary}</p>
                    ) : null}
                    {travelStyle ? (
                      <p className="mt-2 text-sm leading-relaxed text-foreground/80">{travelStyle}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
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
                      <div key={p.k} className="flex-1 rounded-2xl bg-secondary px-3 py-2.5 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.k}</p>
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

      <ProfilePlanSwitcher className="mt-5" />

      {hasPlusAccess && onboarded && (
        <div className="mt-5 rounded-3xl bg-secondary p-5">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t("profile.roamieImpression")}
          </p>
          <p className="mt-2 font-display text-[17px] leading-snug">
            {quizSyncing ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("profile.quizSyncing")}
              </span>
            ) : (
              personalityImpression
            )}
          </p>
        </div>
      )}

      <section className="relative z-10 mt-6">
        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">
          {t("profile.otherSettings")}
        </p>
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

      {/* Preference quiz flow removed in production; keep profile simple. */}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t("profile.footer")}
      </p>

      {user ? (
        <button
          type="button"
          disabled={signingOut}
          onClick={() => {
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

      <div aria-hidden className="h-6 shrink-0" />
    </div>
  );
}
