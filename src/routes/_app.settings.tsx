import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/hooks/use-i18n";
import type { AuthProviderKind } from "@/lib/auth-provider";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@/lib/i18n/types";
import { getUserProfile, saveProfileNotifications } from "@/lib/profile-storage";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});

function providerLabel(
  provider: AuthProviderKind | null,
  isGuest: boolean,
  t: (key: string) => string,
): string {
  if (provider === "google") return t("settings.providerGoogle");
  if (provider === "apple") return t("settings.providerApple");
  if (provider === "email") return t("settings.providerEmail");
  if (!isGuest) return t("settings.signedIn");
  return t("settings.notSignedIn");
}

function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { isGuest, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authProvider, setAuthProvider] = useState<AuthProviderKind | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getUserProfile(locale);
        if (cancelled) return;
        setAuthProvider(profile.authProvider);
        setNotificationsEnabled(profile.notificationsEnabled);
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
  }, [locale, t]);

  const handleNotifications = async (checked: boolean) => {
    setNotificationsEnabled(checked);
    setSavingNotif(true);
    try {
      await saveProfileNotifications(checked);
      toast.success(t("settings.saved"));
    } catch (e) {
      setNotificationsEnabled(!checked);
      toast.error(e instanceof Error ? e.message : t("settings.saveFailed"));
    } finally {
      setSavingNotif(false);
    }
  };

  const handleLanguageCycle = async () => {
    const idx = SUPPORTED_LOCALES.indexOf(locale);
    const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length] as Locale;
    await setLocale(next);
    toast.success(t("settings.languageSaved"));
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
        <p className="border-b border-border px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("settings.account")}
        </p>
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
          <p className="text-[15px]">{t("settings.loginMethod")}</p>
          <p className="text-sm text-muted-foreground">
            {loading ? t("common.dash") : providerLabel(authProvider, isGuest, t)}
          </p>
        </div>
      </section>

      <section className="mt-5 overflow-hidden rounded-3xl border border-border bg-card">
        <p className="border-b border-border px-4 py-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          {t("settings.notifications")}
        </p>
        <div className="flex items-center justify-between gap-3 px-4 py-3.5">
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
          onClick={() => void handleLanguageCycle()}
          className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
        >
          <p className="text-[15px]">{t("settings.languageLabel")}</p>
          <p className="text-sm text-muted-foreground">{LOCALE_LABELS[locale]}</p>
        </button>
      </section>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut || isGuest}
        className="mt-8 w-full rounded-full border border-border bg-card py-3.5 text-[15px] text-foreground disabled:opacity-50"
      >
        {signingOut ? t("profile.saving") : t("settings.signOutAccount")}
      </button>
    </div>
  );
}
