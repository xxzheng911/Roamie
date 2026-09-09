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
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { user, loading: authLoading } = useAuth();
  const { restore } = useSubscription();
  const { enablePlusTestMode } = useAccess();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const onCloseRef = useRef<(() => void) | undefined>(undefined);
  const canInstantUpgrade = canBypassSubscriptionBilling(user?.email ?? null);

  const openAuthenticatedPaywall = useCallback((options?: { onClose?: () => void }) => {
    onCloseRef.current = options?.onClose;
    setPaywallOpen(true);
  }, []);

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
      toast.success("已啟用 Roamie Plus");
      return "upgraded";
    },
    [canInstantUpgrade, enablePlusTestMode, navigate, openAuthenticatedPaywall, user?.id],
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
      void restore().catch(() => undefined);
    }
  }, [authLoading, openAuthenticatedPaywall, pathname, restore, user?.id]);

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
      <PlusComingSoonDialog open={paywallOpen} onOpenChange={handleOpenChange} />
    </PlusPurchaseContext.Provider>
  );
}

export function usePlusPurchase(): PlusPurchaseContextValue {
  const value = useContext(PlusPurchaseContext);
  if (!value) throw new Error("usePlusPurchase must be used within PlusPurchaseProvider");
  return value;
}
