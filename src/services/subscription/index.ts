import { Capacitor } from "@capacitor/core";
import type { CustomerInfo, PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { clientEnv } from "@/constants/env";
import { defaultFreeStatus, readLocalUsage } from "@/services/subscription/tiers";
import { createSubscriptionConfigurationAuthority } from "./configuration-authority";
import { statusFromRevenueCatCustomerInfo } from "./revenuecat-customer-info";
import type {
  SubscriptionActionResult,
  SubscriptionAdapter,
  SubscriptionPackage,
  SubscriptionStatus,
} from "./types";

type PurchasesError = Error & { userCancelled?: boolean; code?: string | number };

export function statusFromCustomerInfo(info: CustomerInfo): SubscriptionStatus {
  return statusFromRevenueCatCustomerInfo(info);
}

function mapPackage(pkg: PurchasesPackage): SubscriptionPackage {
  return {
    identifier: pkg.identifier,
    productId: pkg.product.identifier,
    title: pkg.product.title,
    description: pkg.product.description,
    priceString: pkg.product.priceString,
    period:
      pkg.identifier === "$rc_monthly"
        ? "monthly"
        : pkg.identifier === "$rc_annual"
          ? "yearly"
          : "other",
  };
}

let configured = false;
let configuredUserId: string | null = null;
let packages = new Map<string, PurchasesPackage>();
let storePurchasesReconciledUserId: string | null = null;
function purchasesModule() {
  return import("@revenuecat/purchases-capacitor");
}

export async function reconcileStorePurchasesForIdentity(
  userId: string,
  syncPurchases: () => Promise<void>,
): Promise<boolean> {
  if (Capacitor.getPlatform() !== "ios" || storePurchasesReconciledUserId === userId) return false;
  await syncPurchases();
  storePurchasesReconciledUserId = userId;
  return true;
}

const configurationAuthority = createSubscriptionConfigurationAuthority(async (userId) => {
  const apiKey =
    Capacitor.getPlatform() === "ios"
      ? clientEnv.revenueCatAppleKey
      : clientEnv.revenueCatGoogleKey;
  if (!apiKey) throw new Error("revenuecat_public_sdk_key_missing");

  const { Purchases } = await purchasesModule();
  if (!configured) {
    await Purchases.configure({ apiKey, appUserID: userId });
    configured = true;
  } else if (configuredUserId !== userId) {
    if (configuredUserId) await Purchases.logOut();
    await Purchases.logIn({ appUserID: userId });
  }
  configuredUserId = userId;
  try {
    await reconcileStorePurchasesForIdentity(userId, () => Purchases.syncPurchases());
  } catch {
    // Keep RevenueCat usable and leave the explicit Restore Purchases action available.
    console.warn("[REVENUECAT_STATE]", { event: "store_reconciliation_failed" });
  }
  console.info("[REVENUECAT_STATE]", { event: "configured", appUserIdBound: true });
});

export const localSubscriptionAdapter: SubscriptionAdapter = {
  id: "local",
  async configure() {},
  async logOut() {},
  async getStatus() {
    return defaultFreeStatus();
  },
  async getPackages() {
    return [];
  },
  async getUsage() {
    return readLocalUsage();
  },
  async purchase() {
    return { outcome: "success", status: defaultFreeStatus() };
  },
  async restore() {
    return { outcome: "success", status: defaultFreeStatus() };
  },
  async addStatusListener() {
    return () => {};
  },
  async sync() {},
};

export const revenueCatAdapter: SubscriptionAdapter = {
  id: "revenuecat",
  async configure(userId) {
    await configurationAuthority.ensureConfigured(userId);
  },
  async logOut() {
    await configurationAuthority.clearConfiguredIdentity(async () => {
      if (!configured || !configuredUserId) return;
      const { Purchases } = await purchasesModule();
      await Purchases.logOut();
      configuredUserId = null;
    });
    packages.clear();
  },
  async getStatus(userId) {
    await configurationAuthority.ensureConfigured(userId);
    const { Purchases } = await purchasesModule();
    return statusFromCustomerInfo((await Purchases.getCustomerInfo()).customerInfo);
  },
  async getPackages(userId) {
    await configurationAuthority.ensureConfigured(userId);
    const { Purchases } = await purchasesModule();
    const offerings = await Purchases.getOfferings();
    const available = offerings.current?.availablePackages ?? [];
    packages = new Map(available.map((pkg) => [pkg.identifier, pkg]));
    console.info("[REVENUECAT_STATE]", {
      event: "offering_loaded",
      packageCount: available.length,
    });
    return available.map(mapPackage);
  },
  async getUsage() {
    return readLocalUsage();
  },
  async purchase(packageId, userId): Promise<SubscriptionActionResult> {
    await configurationAuthority.ensureConfigured(userId);
    const pkg = packages.get(packageId);
    if (!pkg) throw new Error("revenuecat_package_not_loaded");
    try {
      const { Purchases } = await purchasesModule();
      const result = await Purchases.purchasePackage({ aPackage: pkg });
      return { outcome: "success", status: statusFromCustomerInfo(result.customerInfo) };
    } catch (error) {
      const purchaseError = error as PurchasesError;
      if (purchaseError.userCancelled)
        return { outcome: "cancelled", status: await revenueCatAdapter.getStatus(userId) };
      if (String(purchaseError.code).toLowerCase().includes("payment_pending"))
        return { outcome: "pending", status: await revenueCatAdapter.getStatus(userId) };
      throw error;
    }
  },
  async restore(userId) {
    await configurationAuthority.ensureConfigured(userId);
    const { Purchases } = await purchasesModule();
    const result = await Purchases.restorePurchases();
    const status = statusFromCustomerInfo(result.customerInfo);
    if (status.isActive) await Purchases.syncPurchases();
    const currentIdentity = await Purchases.getAppUserID();
    console.info("[REVENUECAT_RESTORE_AUTHORITY]", {
      activePremium: status.isActive,
      hasProduct: Boolean(status.productId),
      hasExpiration: Boolean(status.expiresAt),
      currentIdentityMatchesSupabase: currentIdentity.appUserID === userId,
      originalIdentityMatchesCurrent: result.customerInfo.originalAppUserId === userId,
    });
    return { outcome: "success", status };
  },
  async addStatusListener(listener, userId) {
    await configurationAuthority.ensureConfigured(userId);
    const { Purchases } = await purchasesModule();
    const listenerId = await Purchases.addCustomerInfoUpdateListener((info) =>
      listener(statusFromCustomerInfo(info)),
    );
    return () => {
      void Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: listenerId });
    };
  },
  async sync() {},
};

export function createSubscriptionAdapter(): SubscriptionAdapter {
  return Capacitor.isNativePlatform() &&
    clientEnv.billingEnabled &&
    (clientEnv.revenueCatAppleKey || clientEnv.revenueCatGoogleKey)
    ? revenueCatAdapter
    : localSubscriptionAdapter;
}

/** Called only after the server confirms that the Roamie account was deleted. */
export async function clearRevenueCatIdentityAfterAccountDeletion(): Promise<void> {
  await revenueCatAdapter.logOut();
}
