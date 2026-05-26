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
import { useAccess } from "@/hooks/use-access";
import { useI18n } from "@/hooks/use-i18n";
import type { AuthProviderKind } from "@/lib/auth-provider";
import { LOCALE_LABELS } from "@/lib/i18n/types";
import {
  isNotificationApiAvailable,
  isNotificationGranted,
  requestNotificationPermission,
} from "@/lib/notification-permission";
import { getUserProfile, saveProfileNotifications } from "@/lib/profile-storage";
import { isDeveloperBuildEnabled, unlockDeveloperMode } from "@/lib/access/developer";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import { openAppSettings } from "@/lib/open-app-settings";

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
  const { signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const {
    effectiveTier,
    subscriptionState,
    hasPlusAccess,
    canShowDeveloperTools,
    refresh: refreshAccess,
  } = useAccess();
  const [devTapCount, setDevTapCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [authProvider, setAuthProvider] = useState<AuthProviderKind | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
  const [notifDialogOpen, setNotifDialogOpen] = useState(false);
  const devMode = isDeveloperBuildEnabled();

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
    if (checked) {
      if (!isNotificationApiAvailable()) {
        setSavingNotif(true);
        try {
          await syncNotificationsFromDevice();
        } finally {
          setSavingNotif(false);
        }
        return;
      }
      if (isNotificationGranted()) {
        setSavingNotif(true);
        try {
          setNotificationsEnabled(true);
          await saveProfileNotifications(true);
          toast.success(t("settings.saved"));
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
        } finally {
          setSavingNotif(false);
        }
        return;
      }
      setNotifDialogOpen(true);
      return;
    }
    await syncNotificationsFromDevice();
  };

  const confirmNotificationPermission = async () => {
    setNotifDialogOpen(false);
    setSavingNotif(true);
    try {
      await requestNotificationPermission();
      const granted = isNotificationGranted();
      setNotificationsEnabled(granted);
      await saveProfileNotifications(granted);
      if (granted) toast.success(t("settings.saved"));
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
      toast.success(t("profile.signedOut"));
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

      <AlertDialog open={notifDialogOpen} onOpenChange={setNotifDialogOpen}>
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.notificationPermissionTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="text-left leading-relaxed">
              {t("settings.notificationPermissionBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:justify-end">
            <AlertDialogCancel className="mt-0 flex-1 sm:flex-none">
              {t("settings.notificationPermissionCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="flex-1 sm:flex-none"
              onClick={(e) => {
                e.preventDefault();
                void confirmNotificationPermission();
              }}
            >
              {t("settings.notificationPermissionAllow")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {devMode ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Free / Roamie Plus 測試請至「我」個人頁。
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => {
          const next = devTapCount + 1;
          setDevTapCount(next);
          if (next >= 7 && import.meta.env.DEV) {
            unlockDeveloperMode();
            window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT));
            refreshAccess();
            toast.success("Developer Mode 已解鎖");
            setDevTapCount(0);
          }
        }}
        className="mt-6 w-full py-1 text-center text-[10px] text-muted-foreground/30"
      >
        Roamie · {effectiveTier}
      </button>

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
