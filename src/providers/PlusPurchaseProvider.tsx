import { useSubscriptionOperation } from "@/hooks/use-subscription-operation";
import { resolveRestoreOutcome } from "@/services/subscription/purchase-outcome";
import { useI18n } from "@/hooks/use-i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import { useAccess } from "@/hooks/use-access";
import { useAuth } from "@/hooks/use-auth";
import { canBypassSubscriptionBilling } from "@/lib/access/subscription-dev-mode";
import {
  clearPlusPurchaseContinuation,
  consumePlusPurchaseContinuation,
  savePlusPurchaseContinuation,
} from "@/lib/subscription/purchase-continuation";
import { useSubscription } from "@/providers/SubscriptionProvider";

export type PlusUpgradeResult = "upgraded" | "coming_soon" | "auth_required";

type PlusPurchaseContextValue = {
  openRevenueCatPaywall: (options?: { onClose?: () => void }) => PlusUpgradeResult;
};

const PlusPurchaseContext = createContext<PlusPurchaseContextValue | null>(null);

/** Single rendering and state authority for every formal Plus purchase entry. */
export function PlusPurchaseProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user, loading: authLoading } = useAuth();
  const beginOperation = useSubscriptionOperation(user?.id);
  const { restore } = useSubscription();
  const { enablePlusTestMode } = useAccess();
  const [paywallOwner, setPaywallOwner] = useState<string | undefined>();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);
  const canInstantUpgrade = canBypassSubscriptionBilling(user?.email ?? null);

  const openAuthenticatedPaywall = useCallback(
    (options?: { onClose?: () => void }) => {
      onCloseRef.current = options?.onClose;
      setPaywallOwner(user?.id);
      setPaywallOpen(true);
    },
    [user?.id],
  );

  const openRevenueCatPaywall = useCallback(
    (options?: { onClose?: () => void }): PlusUpgradeResult => {
      console.info("[PLUS_UPGRADE_TAP]", { canInstantUpgrade });
      if (!user?.id) {
        savePlusPurchaseContinuation("open_paywall");
        setPaywallOpen(false);
        void navigate({ to: "/login" });
        return "auth_required";
      }
      if (!canInstantUpgrade) {
        openAuthenticatedPaywall(options);
        return "coming_soon";
      }
      enablePlusTestMode();
      toast.success(t("plusPurchase.active"));
      return "upgraded";
    },
    [t, canInstantUpgrade, enablePlusTestMode, navigate, openAuthenticatedPaywall, user?.id],
  );

  useEffect(() => {
    if (authLoading) return;
    const onAuthRoute = pathname === "/login" || pathname.startsWith("/auth/");
    if (!user?.id) {
      // Returning to Welcome after cancelling login makes cancellation explicit
      // and prevents a later unrelated login from replaying an old purchase intent.
      if (pathname === "/welcome") clearPlusPurchaseContinuation();
      return;
    }
    if (onAuthRoute) return;

    const continuation = consumePlusPurchaseContinuation();
    if (continuation === "open_paywall") {
      openAuthenticatedPaywall();
    } else if (continuation === "restore_purchases") {
      openAuthenticatedPaywall();
      const isCurrent = beginOperation();
      void restore()
        .then((result) => {
          if (!isCurrent()) return;
          const outcome = resolveRestoreOutcome(result);
          if (outcome === "ignored") return;
          if (outcome === "restoreSyncPending") toast.message(t("plusPurchase.restoreSyncPending"));
          else if (outcome === "restored") toast.success(t("plusPurchase.restored"));
          else toast.message(t("plusPurchase.nothingToRestore"));
        })
        .catch(() => {
          if (isCurrent()) toast.error(t("plusPurchase.restoreFailed"));
        });
    }
  }, [t, authLoading, beginOperation, openAuthenticatedPaywall, pathname, restore, user?.id]);

  const value = useMemo(() => ({ openRevenueCatPaywall }), [openRevenueCatPaywall]);
  const handleOpenChange = useCallback((open: boolean) => {
    setPaywallOpen(open);
    if (!open) {
      const onClose = onCloseRef.current;
      onCloseRef.current = undefined;
      onClose?.();
    }
  }, []);
  return (
    <PlusPurchaseContext.Provider value={value}>
      {children}
      <PlusComingSoonDialog
        open={paywallOpen && paywallOwner === user?.id}
        onOpenChange={handleOpenChange}
      />
    </PlusPurchaseContext.Provider>
  );
}

export function usePlusPurchase(): PlusPurchaseContextValue {
  const value = useContext(PlusPurchaseContext);
  if (!value) throw new Error("usePlusPurchase must be used within PlusPurchaseProvider");
  return value;
}
