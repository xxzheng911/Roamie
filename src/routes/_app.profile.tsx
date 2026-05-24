import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronRight,
  Settings,
  Sparkles,
  BookMarked,
  HeartHandshake,
  Pencil,
  Loader2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { GuestSignInPrompt } from "@/components/GuestSignInPrompt";
import { useAvatar } from "@/hooks/use-avatar";
import { useI18n } from "@/hooks/use-i18n";
import { isAuthSessionMissingError } from "@/lib/auth-session";
import { supabase } from "@/lib/supabase";
import { CropEditActions } from "@/components/CropEditActions";
import { ImageSourceSheet } from "@/components/ImageSourceSheet";
import { ProfileCover } from "@/components/ProfileCover";
import {
  InlineImageCropViewport,
  type InlineImageCropHandle,
} from "@/components/InlineImageCropViewport";
import { COVER_UPDATED_EVENT, broadcastCoverUpdate } from "@/lib/cover-events";
import { broadcastAvatarUpdate } from "@/lib/avatar-events";
import { listItineraries } from "@/lib/itinerary-storage";
import { listPlaces } from "@/lib/places-storage";
import {
  BUDGET_MODE_LABELS,
  resolveBudgetMode,
} from "@/lib/preferences-storage";
import { ensureUserProfile } from "@/lib/ensure-user-profile";
import {
  applyProfileAvatar,
  applyProfileCover,
  removeProfileCover,
} from "@/lib/profile-media-storage";
import { getUserProfile, saveUserProfile, type UserProfile } from "@/lib/profile-storage";
import { buildCompanionSummary } from "@/lib/personality";
import { PREFS_UPDATED_EVENT } from "@/lib/preference-events";

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
  const { user, loading: authLoading, isGuest } = useAuth();
  const { t, locale } = useI18n();
  const { avatarSrc, refresh: refreshAvatar } = useAvatar();

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [coverSourceOpen, setCoverSourceOpen] = useState(false);
  const [coverCropFile, setCoverCropFile] = useState<File | null>(null);
  const [coverApplying, setCoverApplying] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const coverCropRef = useRef<InlineImageCropHandle>(null);

  const [avatarSourceOpen, setAvatarSourceOpen] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [avatarApplying, setAvatarApplying] = useState(false);
  const avatarCropRef = useRef<InlineImageCropHandle>(null);

  const [tripCount, setTripCount] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showQuizResult, setShowQuizResult] = useState(false);

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

  const coverEditing = !!coverCropFile;
  const avatarEditing = !!avatarCropFile;

  const goLoginIfNeeded = (): boolean => {
    if (user) return true;
    navigate({ to: "/login", replace: true });
    return false;
  };

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
    setShowQuizResult(true);
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
    if (!user) return;
    setLoading(true);
    try {
      if (user) await ensureUserProfile();
      const [itineraries, places, profile] = await Promise.all([
        listItineraries().catch(() => []),
        listPlaces().catch(() => []),
        loadProfile(),
      ]);
      setTripCount(itineraries.length);
      setPlaceCount(places.length);
      applyProfileToState(profile);
      await refreshAvatar();
    } catch (e) {
      if (e instanceof Error && isAuthSessionMissingError(e.message)) return;
      console.error("[profile] refresh failed", e);
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("請先登入")) return;
      toast.error(msg || t("profile.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!user && !isGuest) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (isGuest || !user) return;
    void refresh();
  }, [authLoading, user, isGuest, locale, t, navigate]);

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center px-5 py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isGuest || !user) {
    return (
      <GuestSignInPrompt
        title="登入後，建立你的 Roamie 檔案"
        description="個人檔案、頭像與雲端同步需要登入帳號。訪客模式仍可瀏覽首頁、地圖與聊天。"
      />
    );
  }

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

  const handleCoverApply = async () => {
    if (!goLoginIfNeeded()) return;
    const result = await coverCropRef.current?.exportCrop();
    if (!result) {
      toast.error("請稍候，圖片載入中");
      return;
    }
    setCoverApplying(true);
    try {
      const finalUrl = await applyProfileCover(result.blob);
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
    if (!goLoginIfNeeded()) return;
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

  const handleAvatarApply = async () => {
    if (!goLoginIfNeeded()) return;
    const result = await avatarCropRef.current?.exportCrop();
    if (!result) {
      toast.error("請稍候，圖片載入中");
      return;
    }
    setAvatarApplying(true);
    try {
      const finalUrl = await applyProfileAvatar(result.blob);
      broadcastAvatarUpdate(finalUrl);
      setAvatarCropFile(null);
      await refreshAvatar();
      toast.success("頭像已更新");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "儲存失敗";
      if (!isAuthSessionMissingError(msg)) toast.error(msg);
    } finally {
      setAvatarApplying(false);
    }
  };

  const countSuffix = t("profile.countUnit");
  const tripValue = countSuffix ? `${tripCount} ${countSuffix}` : `${tripCount}`;
  const placeValue = countSuffix ? `${placeCount} ${countSuffix}` : `${placeCount}`;

  const items = [
    {
      icon: BookMarked,
      label: t("profile.savedTrips"),
      value: tripValue,
      to: "/saved" as const,
    },
    {
      icon: HeartHandshake,
      label: t("profile.savedPlaces"),
      value: placeValue,
      to: "/saved" as const,
      search: { tab: "places" },
    },
    {
      icon: Settings,
      label: t("profile.otherSettings"),
      value: "",
      to: "/settings" as const,
    },
  ];

  const cancelLabel = t("profile.cancel");
  const applyLabel = t("profile.apply");

  return (
    <div className="px-5 pb-8 pt-3">
      <div className="overflow-visible rounded-[2rem] border border-border bg-card shadow-soft">
        <ProfileCover
          coverUrl={coverUrl}
          cropFile={coverCropFile}
          cropRef={coverCropRef}
          editing={coverEditing}
          busy={coverApplying || coverRemoving}
          applying={coverApplying}
          onPress={() => {
            if (!coverEditing && !coverApplying && !coverRemoving) {
              setCoverSourceOpen(true);
            }
          }}
          onCancelEdit={handleCoverCancel}
          onApplyEdit={() => void handleCoverApply()}
          cancelLabel={cancelLabel}
          applyLabel={applyLabel}
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

        <div className="relative overflow-visible px-5 pb-5 pt-2">
          <div className="absolute -top-10 left-0 z-20 h-[5.25rem] w-[5.25rem]">
            {avatarEditing ? (
              <div className="relative h-[5.25rem] w-[5.25rem]">
                <div className="relative h-full w-full overflow-hidden rounded-full border-[3px] border-card bg-black shadow-soft">
                  <InlineImageCropViewport
                    ref={avatarCropRef}
                    file={avatarCropFile!}
                    aspectWidth={1}
                    aspectHeight={1}
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
                <div className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 w-max max-w-[calc(100vw-2.5rem)]">
                  <div className="pointer-events-auto">
                    <CropEditActions
                      align="start"
                      onCancel={handleAvatarCancel}
                      onApply={() => void handleAvatarApply()}
                      applying={avatarApplying}
                      cancelLabel={cancelLabel}
                      applyLabel={applyLabel}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => !avatarApplying && setAvatarSourceOpen(true)}
                disabled={avatarApplying}
                className="group relative h-full w-full overflow-hidden rounded-full border-[3px] border-card bg-secondary shadow-soft disabled:opacity-90"
                aria-label={t("profile.editAvatar")}
              >
                <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
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
            )}
          </div>

          <ImageSourceSheet
            open={avatarSourceOpen}
            onOpenChange={setAvatarSourceOpen}
            title="更換頭像"
            onPickFile={handleAvatarPick}
            cameraFacing="user"
          />

          <div className="pt-12">
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
                    <p className="font-display text-xl leading-tight">{displayName}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{bio}</p>
                    {onboarded && companionSummary ? (
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
                {onboarded && (
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

      {showQuizResult && onboarded && !loading ? (
        <div className="mt-5 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-clay" />
            {t("profile.personalityTitle")}
          </div>
          <p className="mt-2 font-display text-xl">{personalityType}</p>
          <p className="mt-2 text-sm text-muted-foreground">{personalitySummary}</p>
          {avoidKey && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("profile.avoidPrefix")}
              {t(`profile.avoid.${avoidKey}`) !== `profile.avoid.${avoidKey}`
                ? t(`profile.avoid.${avoidKey}`)
                : avoidKey}
            </p>
          )}
          <div className="mt-4 rounded-2xl bg-secondary p-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              {t("profile.roamieImpression")}
            </p>
            <p className="mt-2 font-display text-[17px] leading-snug">{personalityImpression}</p>
          </div>
          <div className="mt-4 flex gap-2">
            <Link
              to="/onboarding"
              search={{ from: "profile" }}
              className="flex-1 rounded-full border border-border py-3 text-center text-sm"
            >
              {t("profile.retakeQuiz")}
            </Link>
            <button
              type="button"
              onClick={() => setShowQuizResult(false)}
              className="flex-1 rounded-full bg-primary py-3 text-center text-sm text-primary-foreground"
            >
              {t("profile.back")}
            </button>
          </div>
        </div>
      ) : (
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
            ) : onboarded ? (
              personalityImpression
            ) : (
              t("profile.quizPrompt")
            )}
          </p>
          {!onboarded && (
            <Link
              to="/onboarding"
              search={{ from: "profile" }}
              className="mt-4 block rounded-full bg-primary py-3 text-center text-sm text-primary-foreground"
            >
              {t("profile.startQuiz")}
            </Link>
          )}
        </div>
      )}

      <ul className="mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        {onboarded && (
          <li className="border-b border-border">
            <button
              type="button"
              onClick={() => setShowQuizResult(true)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="flex-1 text-[15px]">{t("profile.personalityView")}</p>
              <p className="text-sm text-muted-foreground">{t("profile.quizStatusCompleted")}</p>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          </li>
        )}
        {items.map((it, i) => {
          const Icon = it.icon;
          const inner = (
            <>
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-secondary">
                <Icon className="h-4 w-4" />
              </div>
              <p className="flex-1 text-[15px]">{it.label}</p>
              {it.value && <p className="text-sm text-muted-foreground">{it.value}</p>}
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </>
          );
          const cls = `flex w-full items-center gap-3 px-4 py-3.5 text-left ${i !== items.length - 1 ? "border-b border-border" : ""}`;
          if ("to" in it && it.to) {
            const itemSearch = "search" in it ? it.search : undefined;
            return (
              <li key={it.label}>
                <Link to={it.to} search={itemSearch} className={cls}>
                  {inner}
                </Link>
              </li>
            );
          }
          return (
            <li key={it.label}>
              <button onClick={"action" in it ? it.action : undefined} className={cls}>
                {inner}
              </button>
            </li>
          );
        })}
      </ul>

      {onboarded && !showQuizResult && (
        <Link
          to="/onboarding"
          search={{ from: "profile" }}
          className="mt-6 block rounded-full border border-border bg-card py-3.5 text-center text-sm"
        >
          {t("profile.retakeQuizLink")}
        </Link>
      )}

      <p className="mt-8 text-center text-[11px] leading-relaxed text-muted-foreground">
        {t("profile.footer")}
      </p>
    </div>
  );
}
