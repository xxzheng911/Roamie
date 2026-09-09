import { Capacitor } from "@capacitor/core";
import type { CustomerInfo, PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { clientEnv } from "@/constants/env";
import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import { defaultFreeStatus, readLocalUsage } from "@/services/subscription/tiers";
import { createSubscriptionConfigurationAuthority } from "./configuration-authority";
import type {
  SubscriptionActionResult,
  SubscriptionAdapter,
  SubscriptionPackage,
  SubscriptionStatus,
} from "./types";

type PurchasesError = Error & { userCancelled?: boolean; code?: string | number };

export function statusFromCustomerInfo(info: CustomerInfo): SubscriptionStatus {
  const entitlement = info.entitlements.active[REVENUECAT_ENTITLEMENT_ID];
  return entitlement
    ? {
        tier: "plus",
        isActive: true,
        expiresAt: entitlement.expirationDate ?? null,
        productId: entitlement.productIdentifier ?? null,
        willRenew: entitlement.willRenew,
        source: "revenuecat",
      }
    : { ...defaultFreeStatus(), source: "revenuecat" };
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
function purchasesModule() {
  return import("@revenuecat/purchases-capacitor");
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
    return { outcome: "success", status: statusFromCustomerInfo(result.customerInfo) };
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
