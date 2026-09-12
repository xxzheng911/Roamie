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
import {
  resolveAuthProvider,
  resolveAuthProviderForDisplay,
  type AuthProviderKind,
} from "@/lib/auth-provider";
import { LOCALE_LABELS } from "@/lib/i18n/types";
import { openSubscriptionManagement } from "@/lib/open-subscription-settings";
import { tryNativeSubscriptionManagement } from "@/lib/subscription/subscription-management-native";
import { deleteCurrentAccount } from "@/lib/account-deletion/account-deletion";
import { clearDeletedAccountLocalData } from "@/lib/clear-auth-state";
import { clearRevenueCatIdentityAfterAccountDeletion } from "@/services/subscription";
import {
  isNotificationApiAvailable,
  isNotificationGrantedAsync,
  requestNotificationPermission,
} from "@/lib/notification-permission";
import { getProfileNotificationsEnabled, saveProfileNotifications } from "@/lib/profile-storage";
import { isDeveloperBuildEnabled, unlockDeveloperMode } from "@/lib/access/developer";
import { ACCESS_CHANGED_EVENT } from "@/lib/access/events";
import {
  cancelAllTripReminders,
  scheduleTripReminders,
  syncTripReminderNotifications,
} from "@/lib/trip-reminder-notifications";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function providerLabel(provider: AuthProviderKind | null, t: (key: string) => string): string {
  if (provider === "google") return t("settings.providerGoogle");
  if (provider === "apple") return t("settings.providerApple");
  if (provider === "email") return t("settings.providerEmail");
  return t("settings.signedIn");
}

function SettingsPage() {
  const { t, locale } = useI18n();
  const { user, signOut, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const {
    effectiveTier,
    hasPlusAccess,
    plusEntitlementActiveSources,
    canShowDeveloperTools,
    refresh: refreshAccess,
  } = useAccess();
  const [devTapCount, setDevTapCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [notifDialogOpen, setNotifDialogOpen] = useState(false);
  const [cancelSubscriptionDialogOpen, setCancelSubscriptionDialogOpen] = useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletionRequestId, setDeletionRequestId] = useState<string | null>(null);
  const devMode = isDeveloperBuildEnabled();

  useEffect(() => {
    if (import.meta.env.VITE_DEPLOY_ENV === "staging") {
      console.info("ACCOUNT_DELETION_RUNTIME_VERSION", {
        version: "20260913-google-amr-preflight-v1",
      });
    }
  }, []);

  const loadSettings = useCallback(async () => {
    const notifPref = await getProfileNotificationsEnabled();
    setNotificationsEnabled(notifPref);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadSettings();
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
  }, [loadSettings, t]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadSettings().then(() => syncTripReminderNotifications(locale));
      }
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [loadSettings, locale]);

  const handleNotifications = async (checked: boolean) => {
    if (savingNotif || loading) return;

    if (!checked) {
      setSavingNotif(true);
      try {
        setNotificationsEnabled(false);
        await saveProfileNotifications(false);
        await cancelAllTripReminders();
        toast.success(t("settings.saved"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
      } finally {
        setSavingNotif(false);
      }
      return;
    }

    if (!isNotificationApiAvailable()) {
      toast.error(t("settings.notificationPermissionDenied"));
      return;
    }

    if (await isNotificationGrantedAsync()) {
      setSavingNotif(true);
      try {
        setNotificationsEnabled(true);
        await saveProfileNotifications(true);
        await scheduleTripReminders(locale);
        toast.success(t("settings.saved"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
      } finally {
        setSavingNotif(false);
      }
      return;
    }

    setNotifDialogOpen(true);
  };

  const confirmNotificationPermission = async () => {
    setNotifDialogOpen(false);
    setSavingNotif(true);
    try {
      const result = await requestNotificationPermission();
      const granted = result === "granted";
      if (!granted) {
        setNotificationsEnabled(false);
        await saveProfileNotifications(false);
        await cancelAllTripReminders();
        toast.error(t("settings.notificationPermissionDenied"));
        return;
      }
      setNotificationsEnabled(true);
      await saveProfileNotifications(true);
      await scheduleTripReminders(locale);
      toast.success(t("settings.saved"));
    } catch (e) {
      setNotificationsEnabled(false);
      await saveProfileNotifications(false).catch(() => {});
      await cancelAllTripReminders();
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
      const { resetToLoginScreen } = await import("@/lib/clear-auth-state");
      await resetToLoginScreen("settings-sign-out");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
    } finally {
      setSigningOut(false);
    }
  };

  const handleManageSubscription = async () => {
    if (await tryNativeSubscriptionManagement()) return;
    await openSubscriptionManagement();
  };

  const canManageAppleSubscription =
    hasPlusAccess && plusEntitlementActiveSources.includes("app_store");
  const displayAuthProvider = user ? resolveAuthProviderForDisplay(user) : null;

  const handleDeleteAccount = async () => {
    const deletionProvider = user ? resolveAuthProvider(user) : null;
    console.info("ACCOUNT_DELETION_UI_ACTION", {
      stage: "clicked",
      provider: deletionProvider ?? "unknown",
      hasSession: Boolean(user?.id),
      isDeleting: deletingAccount,
    });
    if (!user?.id || !deletionProvider) {
      console.info("ACCOUNT_DELETION_UI_ACTION", {
        stage: "blocked",
        reason: "authenticated_session_missing",
        provider: deletionProvider ?? "unknown",
        hasSession: false,
        isDeleting: deletingAccount,
      });
      toast.error("登入狀態已失效，請重新登入後再刪除帳號。");
      return;
    }
    if (deletingAccount) {
      console.info("ACCOUNT_DELETION_UI_ACTION", {
        stage: "blocked",
        reason: "deletion_in_progress",
        provider: deletionProvider,
        hasSession: true,
        isDeleting: true,
      });
      return;
    }
    setDeletingAccount(true);
    const requestId = deletionRequestId ?? crypto.randomUUID();
    setDeletionRequestId(requestId);
    try {
      const result = await deleteCurrentAccount(deletionProvider, requestId);
      if (!result.ok) {
        console.info("ACCOUNT_DELETION_UI_ACTION", {
          stage: "blocked",
          reason: result.code,
          provider: deletionProvider,
          hasSession: result.code !== "account_deletion_unauthorized",
          isDeleting: true,
        });
        if (result.cancelled) return;
        if (result.code === "recent_auth_required") {
          toast.error("為了保護帳號，請先登出並重新登入，再立即刪除帳號。");
          return;
        }
        toast.error(
          result.code.includes("storage")
            ? "媒體資料刪除失敗，請重試。帳號尚未刪除。"
            : "帳號刪除失敗，請稍後重試。",
        );
        return;
      }
      setDeleteAccountDialogOpen(false);
      await clearRevenueCatIdentityAfterAccountDeletion().catch(() => undefined);
      await clearDeletedAccountLocalData(user.id);
      toast.success("Roamie 帳號已永久刪除");
      await navigate({ to: "/login", replace: true });
    } catch {
      toast.error("帳號刪除失敗，請確認網路後重試。帳號尚未刪除。");
    } finally {
      setDeletingAccount(false);
    }
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
        <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-6 py-3.5">
          <p className="text-[15px] leading-5">{t("settings.loginMethod")}</p>
          <p className="justify-self-end text-[15px] leading-5 text-muted-foreground">
            {loading ? t("common.dash") : providerLabel(displayAuthProvider, t)}
          </p>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-card">
        <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-6 py-3.5">
          <p className="text-[15px] leading-5">{t("settings.notificationsLabel")}</p>
          <div className="justify-self-end">
            <Switch
              checked={notificationsEnabled}
              disabled={savingNotif || loading}
              onCheckedChange={(checked) => void handleNotifications(checked)}
              aria-label={t("settings.notificationsLabel")}
            />
          </div>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-card">
        <button
          type="button"
          onClick={() => toast.message(t("settings.languageDeviceHint"))}
          className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 px-6 py-3.5 text-left"
        >
          <p className="text-[15px] leading-5">{t("settings.languageLabel")}</p>
          <p className="justify-self-end text-[15px] leading-5 text-muted-foreground">
            {LOCALE_LABELS[locale]}
          </p>
        </button>
      </section>

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

      <div className="mt-8 flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="w-full rounded-full border border-border bg-card py-3.5 text-[15px] text-foreground disabled:opacity-50"
        >
          {signingOut ? t("profile.saving") : t("settings.signOutAccount")}
        </button>

        {canManageAppleSubscription ? (
          <button
            type="button"
            onClick={() => setCancelSubscriptionDialogOpen(true)}
            className="px-2 py-1 text-center text-sm leading-5 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            取消訂閱
          </button>
        ) : null}

        {user ? (
          <button
            type="button"
            onClick={() => setDeleteAccountDialogOpen(true)}
            className="px-2 py-1 text-center text-sm leading-5 text-destructive underline-offset-4 hover:underline"
          >
            刪除帳號
          </button>
        ) : null}
      </div>

      <AlertDialog
        open={cancelSubscriptionDialogOpen}
        onOpenChange={setCancelSubscriptionDialogOpen}
      >
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>確定要取消 Roamie Plus 嗎？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left leading-relaxed">
              <span className="block">
                取消後，Plus 功能仍可使用至目前訂閱期限結束。之後將自動回到 Free 方案。
              </span>
              <span className="block">
                你的旅行偏好、收藏與既有資料不會被刪除，之後也可以隨時重新訂閱。
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel className="mt-0 w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground">
              繼續使用 Plus
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full rounded-full border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground"
              onClick={() => void handleManageSubscription()}
            >
              前往取消訂閱
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAccountDialogOpen} onOpenChange={setDeleteAccountDialogOpen}>
        <AlertDialogContent className="mx-auto max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除帳號嗎？</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-left leading-relaxed">
              <span className="block">
                此操作無法復原。刪除後，你的已儲存行程、收藏、聊天紀錄、旅行偏好與帳號資料將被永久刪除。
              </span>
              {canManageAppleSubscription ? (
                <span className="block">
                  刪除 Roamie 帳號不會自動取消你的 App Store 訂閱。若不希望後續續訂，請先前往 Apple
                  管理訂閱。
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {canManageAppleSubscription ? (
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline"
              onClick={() => void handleManageSubscription()}
            >
              管理訂閱
            </button>
          ) : null}
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <AlertDialogCancel className="mt-0 w-full rounded-full" disabled={deletingAccount}>
              保留我的帳號
            </AlertDialogCancel>
            <AlertDialogAction
              className="w-full rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingAccount}
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteAccount();
              }}
            >
              {deletingAccount ? "正在永久刪除…" : "永久刪除帳號"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
