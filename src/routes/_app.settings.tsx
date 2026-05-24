import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { GuestSignInPrompt } from "@/components/GuestSignInPrompt";
import { useI18n } from "@/hooks/use-i18n";
import type { AuthProviderKind } from "@/lib/auth-provider";
import { LOCALE_LABELS } from "@/lib/i18n/types";
import { openAppSettings } from "@/lib/open-app-settings";
import {
  isNotificationApiAvailable,
  isNotificationGranted,
  requestNotificationPermission,
} from "@/lib/notification-permission";
import { getUserProfile, saveProfileNotifications } from "@/lib/profile-storage";
import { readDebugAiMode, writeDebugAiMode, type PlanTier } from "@/lib/plan-tier";
import { resetFirstRunForDev } from "@/lib/dev-first-run-reset";
import { clearBootstrapSplashForDev } from "@/lib/bootstrap-splash";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function providerLabel(
  provider: AuthProviderKind | null,
  t: (key: string) => string,
): string {
  if (provider === "google") return t("settings.providerGoogle");
  if (provider === "apple") return t("settings.providerApple");
  if (provider === "email") return t("settings.providerEmail");
  return t("settings.signedIn");
}

function SettingsPage() {
  const { t, locale } = useI18n();
  const { signOut, isGuest, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [debugAiMode, setDebugAiMode] = useState<PlanTier | null>(() => readDebugAiMode());
  const [loading, setLoading] = useState(true);
  const [authProvider, setAuthProvider] = useState<AuthProviderKind | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);

  const syncNotificationsFromDevice = useCallback(async () => {
    const granted = isNotificationGranted();
    setNotificationsEnabled(granted);
    try {
      await saveProfileNotifications(granted);
    } catch (e) {
      console.warn("[Roamie settings] sync notifications preference failed", e);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getUserProfile(locale);
        if (cancelled) return;
        setAuthProvider(profile.authProvider);
        await syncNotificationsFromDevice();
      } catch (e) {
        if (!cancelled) {
          toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locale, t, syncNotificationsFromDevice]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void syncNotificationsFromDevice();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [syncNotificationsFromDevice]);

  const handleNotifications = async (checked: boolean) => {
    if (savingNotif || loading) return;
    setSavingNotif(true);
    try {
      if (checked) {
        if (!isNotificationApiAvailable()) {
          await syncNotificationsFromDevice();
          return;
        }
        await requestNotificationPermission();
        const granted = isNotificationGranted();
        setNotificationsEnabled(granted);
        await saveProfileNotifications(granted);
        if (granted) toast.success(t("settings.saved"));
      } else {
        await syncNotificationsFromDevice();
      }
    } catch (e) {
      await syncNotificationsFromDevice();
      toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
    } finally {
      setSavingNotif(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.success(isGuest ? "已離開訪客模式" : t("profile.signedOut"));
      navigate({ to: "/login" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
    } finally {
      setSigningOut(false);
    }
  };

  const notifLabel = notificationsEnabled
    ? t("settings.notificationsOn")
    : t("settings.notificationsOff");

  const handleLanguageContinue = () => {
    setLanguageDialogOpen(false);
    void openAppSettings();
  };

  if (authLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </div>
    );
  }

  if (isGuest) {
    return (
      <div className="px-5 pt-3">
        <div className="flex items-center gap-2">
          <Link
            to="/profile"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
            aria-label={t("profile.back")}
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-xl">{t("settings.title")}</h1>
        </div>
        <GuestSignInPrompt
          className="py-8"
          title="登入以管理帳號設定"
          description="語言、通知與帳號資訊需登入後才能同步至雲端。"
        />
      </div>
    );
  }

  return (
    <div className="px-5 pb-8 pt-3">
      <div className="flex items-center gap-2">
        <Link
          to="/profile"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground"
          aria-label={t("profile.back")}
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-xl">{t("settings.title")}</h1>
      </div>

      <section className="mt-6 overflow-hidden rounded-3xl border border-border bg-card">
        <p className="border-b border-border px-6 py-2.5 text-[15px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("settings.account")}
        </p>
        <div className="flex items-center justify-between gap-3 px-8 py-3">
          <p className="text-[15px]">{t("settings.loginMethod")}</p>
          <p className="text-sm text-muted-foreground">
            {loading ? t("common.dash") : providerLabel(authProvider, t)}
          </p>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-card">
        <p className="border-b border-border px-6 py-2.5 text-[15px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {t("settings.notifications")}
        </p>
        <div className="flex items-center justify-between gap-3 px-8 py-3">
          <div>
            <p className="text-[15px]">{t("settings.notificationsLabel")}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{notifLabel}</p>
          </div>
          <Switch
            checked={notificationsEnabled}
            disabled={savingNotif || loading}
            onCheckedChange={handleNotifications}
            aria-label={t("settings.notificationsLabel")}
          />
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-card">
        <button
          type="button"
          onClick={() => setLanguageDialogOpen(true)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <p className="text-[15px]">{t("settings.languageLabel")}</p>
          <p className="text-sm text-muted-foreground">{LOCALE_LABELS[locale]}</p>
        </button>
      </section>

      <AlertDialog open={languageDialogOpen} onOpenChange={setLanguageDialogOpen}>
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.language")}</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-relaxed">
              {t("settings.languageHintBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-end">
            <AlertDialogCancel className="mt-0 flex-1 sm:flex-none">
              {t("settings.languageHintCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="flex-1 sm:flex-none"
              onClick={(e) => {
                e.preventDefault();
                handleLanguageContinue();
              }}
            >
              {t("settings.languageHintOk")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="mt-5 overflow-hidden rounded-3xl border border-dashed border-border bg-card/60">
        <p className="border-b border-border px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          開發測試
        </p>
        <div className="px-6 py-4">
          <p className="text-[15px]">AI Mode</p>
          <p className="mt-1 text-xs text-muted-foreground">
            切換 Free / Plus 回覆深度，測試同一句話的 AI 差異
          </p>
          <div className="mt-3 flex gap-2">
            {(["free", "plus"] as const).map((mode) => {
              const active = debugAiMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    const next = active ? null : mode;
                    writeDebugAiMode(next);
                    setDebugAiMode(next);
                    toast.message(next ? `AI Mode：${mode === "plus" ? "Plus" : "Free"}` : "AI Mode：依帳號設定");
                  }}
                  className={`flex-1 rounded-full border py-2.5 text-sm capitalize transition ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {mode === "plus" ? "Plus" : "Free"}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            未選取時依帳號 plan tier（目前皆為 Free）
          </p>
        </div>
        {import.meta.env.DEV ? (
        <div className="border-t border-border px-6 py-4">
          <p className="text-[15px]">重置首次使用流程</p>
          <p className="mt-1 text-xs text-muted-foreground">
            清除 onboarding 與偏好測驗完成狀態，下次啟動會重新顯示教學
          </p>
          <button
            type="button"
            onClick={() => {
              void resetFirstRunForDev().then(() => {
                clearBootstrapSplashForDev();
                toast.success("已重置，重新導向…");
                navigate({ to: "/loading", search: { to: "/intro" }, replace: true });
              });
            }}
            className="mt-3 w-full rounded-full border border-border bg-background py-2.5 text-sm text-foreground"
          >
            重置 Onboarding（Dev）
          </button>
        </div>
        ) : null}
      </section>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className="mt-8 w-full rounded-full border border-border bg-card py-3.5 text-[15px] text-foreground disabled:opacity-50"
      >
        {signingOut ? t("profile.saving") : t("settings.signOutAccount")}
      </button>
    </div>
  );
}
