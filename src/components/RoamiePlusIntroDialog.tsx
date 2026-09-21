import { useSubscriptionOperation } from "@/hooks/use-subscription-operation";
import { resolveRestoreOutcome } from "@/services/subscription/purchase-outcome";
import { Link } from "@tanstack/react-router";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { LegalDocumentSheet } from "@/components/LegalDocumentSheet";
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
import { useAccess } from "@/hooks/use-access";
import { useI18n } from "@/hooks/use-i18n";
import { isDeveloperBuildEnabled } from "@/lib/access/developer";
import { useSubscription } from "@/providers/SubscriptionProvider";
import { openSubscriptionManagement } from "@/lib/open-subscription-settings";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature?: "quiz" | "memory" | "personalized" | "general";
  onUpgraded?: () => void;
};

/** One localized paywall for all Plus entry points. Prices belong to StoreKit. */
export function RoamiePlusIntroDialog({ open, onOpenChange, onUpgraded }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const beginOperation = useSubscriptionOperation(user?.id);
  const {
    isPlusUser,
    devPlusMode,
    canShowDeveloperTools,
    enablePlusTestMode,
    disablePlusTestMode,
  } = useAccess();
  const {
    packages,
    offeringsLoading,
    offeringsState,
    offeringsPhase,
    initializationError,
    offeringsError,
    canonicalSyncError,
    canonicalSyncLoading,
    loadOfferings,
    purchase,
    restore,
    refresh,
  } = useSubscription();
  const [busyPackage, setBusyPackage] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<
    "purchaseSyncPending" | "restoreSyncPending" | "entitlementPending" | null
  >(null);
  const [legalDoc, setLegalDoc] = useState<"privacy" | "terms" | null>(null);
  const busy = useRef(false);
  const showTestControls =
    import.meta.env.DEV && (isDeveloperBuildEnabled() || canShowDeveloperTools);

  useEffect(() => {
    setRecovery(null);
    setBusyPackage(null);
    busy.current = false;
  }, [user?.id]);
  useEffect(() => {
    if (open && !isPlusUser) void loadOfferings();
  }, [open, isPlusUser, loadOfferings]);

  const handlePurchase = async (packageId: string) => {
    if (busy.current) return;
    busy.current = true;
    const isCurrent = beginOperation();
    setBusyPackage(packageId);
    setRecovery(null);
    try {
      const result = await purchase(packageId);
      if (!isCurrent() || result.outcome === "cancelled") return;
      if (result.outcome === "pending") {
        toast.message(t("plusPurchase.pending"));
        return;
      }
      if (!result.status.isActive || !result.canonicalSynced) {
        const message = result.status.isActive ? "purchaseSyncPending" : "entitlementPending";
        setRecovery(message);
        toast.message(t(`plusPurchase.${message}`));
        return;
      }
      toast.success(t("plusPurchase.active"));
      onUpgraded?.();
      onOpenChange(false);
    } catch {
      if (isCurrent()) toast.error(t("plusPurchase.purchaseFailed"));
    } finally {
      if (isCurrent()) {
        setBusyPackage(null);
        busy.current = false;
      }
    }
  };
  const handleRestore = async () => {
    if (busy.current) return;
    busy.current = true;
    const isCurrent = beginOperation();
    setBusyPackage("restore");
    setRecovery(null);
    try {
      const result = await restore();
      if (!isCurrent()) return;
      const outcome = resolveRestoreOutcome(result);
      if (outcome === "ignored") return;
      if (outcome === "restoreSyncPending") {
        setRecovery("restoreSyncPending");
        toast.message(t("plusPurchase.restoreSyncPending"));
      } else if (outcome === "restored") {
        toast.success(t("plusPurchase.restored"));
        onUpgraded?.();
        onOpenChange(false);
      } else toast.message(t("plusPurchase.nothingToRestore"));
    } catch {
      if (isCurrent()) toast.error(t("plusPurchase.restoreFailed"));
    } finally {
      if (isCurrent()) {
        setBusyPackage(null);
        busy.current = false;
      }
    }
  };
  const handleSync = async () => {
    if (busy.current) return;
    busy.current = true;
    const isCurrent = beginOperation();
    setBusyPackage("sync");
    try {
      const confirmed = await refresh();
      if (isCurrent() && confirmed) {
        setRecovery(null);
        toast.success(t("plusPurchase.synced"));
      }
    } finally {
      if (isCurrent()) {
        setBusyPackage(null);
        busy.current = false;
      }
    }
  };
  const buttonClass =
    "h-auto min-h-11 w-full whitespace-normal break-words rounded-full px-4 py-3 text-sm leading-relaxed";
  const offeringMessage =
    offeringsState === "timeout"
      ? "timeout"
      : offeringsState === "empty"
        ? "empty"
        : offeringsError
          ? "unavailable"
          : offeringsState === "idle" && initializationError
            ? "initializationFailed"
            : null;
  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto overscroll-contain break-words rounded-3xl border-border">
          <AlertDialogCancel
            aria-label={t("plusPurchase.close")}
            className="absolute right-3 top-3 mt-0 h-11 w-11 rounded-full border-0 bg-transparent p-0 shadow-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t("plusPurchase.close")}</span>
          </AlertDialogCancel>
          <AlertDialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent">
              <Sparkles className="h-6 w-6 text-clay" />
            </div>
            <AlertDialogTitle className="px-4 text-center font-display text-xl leading-snug">
              {t(isPlusUser ? "plusPurchase.active" : "plusPurchase.heading")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-left text-sm leading-relaxed text-muted-foreground">
                <p>
                  {t(
                    isPlusUser
                      ? devPlusMode
                        ? "plusPurchase.testDescription"
                        : "plusPurchase.activeDescription"
                      : "plusPurchase.description",
                  )}
                </p>
                {isPlusUser && (
                  <>
                    <Link
                      to="/travel-preference-test"
                      search={{ from: "home" }}
                      onClick={() => onOpenChange(false)}
                      className={`block bg-primary text-center text-primary-foreground ${buttonClass}`}
                    >
                      {t("plusPurchase.managePreferences")}
                    </Link>
                    <button
                      type="button"
                      className={`${buttonClass} underline`}
                      onClick={() => void openSubscriptionManagement()}
                    >
                      {t("plusPurchase.manageSubscription")}
                    </button>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            {(canonicalSyncError ||
              recovery ||
              busyPackage === "sync" ||
              (canonicalSyncLoading && busyPackage !== null)) && (
              <div className="space-y-2 text-center text-sm" role="status" aria-live="polite">
                <p>
                  {t(
                    `plusPurchase.${busyPackage === "sync" || (canonicalSyncLoading && busyPackage !== null) ? "syncing" : (recovery ?? "syncPending")}`,
                  )}
                </p>
                <button
                  type="button"
                  className={`${buttonClass} underline`}
                  disabled={busyPackage !== null || canonicalSyncLoading}
                  onClick={() => void handleSync()}
                >
                  {t("plusPurchase.syncRetry")}
                </button>
              </div>
            )}
            {isPlusUser ? (
              <>
                {showTestControls && (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      disablePlusTestMode();
                      toast.message(t("plusPurchase.switchedFree"));
                      onOpenChange(false);
                    }}
                  >
                    {t(devPlusMode ? "plusPurchase.testDisable" : "plusPurchase.switchFree")}
                  </button>
                )}
                {showTestControls && !devPlusMode && (
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      enablePlusTestMode();
                      toast.success(t("plusPurchase.testEnabled"));
                      onUpgraded?.();
                      onOpenChange(false);
                    }}
                  >
                    {t("plusPurchase.testEnable")}
                  </button>
                )}
                <AlertDialogCancel className={`mt-0 ${buttonClass}`}>
                  {t("plusPurchase.close")}
                </AlertDialogCancel>
              </>
            ) : (
              <>
                <div
                  className="min-h-6 text-center text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  {offeringsLoading
                    ? t(
                        offeringsPhase === "initializing"
                          ? "plusPurchase.initializing"
                          : offeringsState === "retrying"
                            ? "plusPurchase.retrying"
                            : "plusPurchase.loading",
                      )
                    : null}
                </div>
                {packages.map((pkg) => (
                  <AlertDialogAction
                    key={pkg.identifier}
                    className={`${buttonClass} bg-primary font-medium`}
                    disabled={busyPackage !== null || Boolean(recovery) || offeringsLoading}
                    onClick={(event) => {
                      event.preventDefault();
                      void handlePurchase(pkg.identifier);
                    }}
                  >
                    {busyPackage === pkg.identifier
                      ? t("plusPurchase.purchasing")
                      : `${pkg.period === "yearly" ? t("plusPurchase.yearly") : pkg.period === "monthly" ? t("plusPurchase.monthly") : pkg.title} · ${pkg.priceString}`}
                  </AlertDialogAction>
                ))}
                {offeringMessage && (
                  <div className="space-y-2 text-center" role="status">
                    <p className="text-sm text-destructive">
                      {t(`plusPurchase.${offeringMessage}`)}
                    </p>
                    <button
                      type="button"
                      className={`${buttonClass} underline`}
                      disabled={offeringsLoading || busyPackage !== null}
                      onClick={() => void loadOfferings()}
                    >
                      {t("plusPurchase.retry")}
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className={`${buttonClass} underline`}
                  disabled={busyPackage !== null}
                  onClick={() => void handleRestore()}
                >
                  {t(busyPackage === "restore" ? "plusPurchase.restoring" : "plusPurchase.restore")}
                </button>
                <div className="space-y-1 px-1 pt-1 text-center text-xs leading-relaxed text-muted-foreground">
                  <p>{t("plusPurchase.disclosure")}</p>
                  <p>
                    <button
                      type="button"
                      className="min-h-11 underline underline-offset-2"
                      onClick={() => {
                        onOpenChange(false);
                        setLegalDoc("privacy");
                      }}
                    >
                      {t("plusPurchase.privacy")}
                    </button>
                    <span aria-hidden> · </span>
                    <button
                      type="button"
                      className="min-h-11 underline underline-offset-2"
                      onClick={() => {
                        onOpenChange(false);
                        setLegalDoc("terms");
                      }}
                    >
                      {t("plusPurchase.terms")}
                    </button>
                  </p>
                </div>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LegalDocumentSheet
        open={legalDoc !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setLegalDoc(null);
        }}
        title={t(legalDoc === "privacy" ? "plusPurchase.privacyTitle" : "plusPurchase.termsTitle")}
        content={t(
          legalDoc === "privacy" ? "plusPurchase.privacyContent" : "plusPurchase.termsContent",
        )}
        closeLabel={t("plusPurchase.close")}
      />
    </>
  );
}
