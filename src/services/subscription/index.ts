import { Capacitor } from "@capacitor/core";
import type { CustomerInfo, PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { clientEnv } from "@/constants/env";
import { REVENUECAT_ENTITLEMENT_ID } from "@/constants/subscription";
import { defaultFreeStatus, readLocalUsage } from "@/services/subscription/tiers";
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
async function purchasesPlugin() {
  return (await import("@revenuecat/purchases-capacitor")).Purchases;
}

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
    const apiKey =
      Capacitor.getPlatform() === "ios"
        ? clientEnv.revenueCatAppleKey
        : clientEnv.revenueCatGoogleKey;
    if (!apiKey) throw new Error("revenuecat_public_sdk_key_missing");
    const Purchases = await purchasesPlugin();
    if (!configured) {
      await Purchases.configure({ apiKey, appUserID: userId });
      configured = true;
    } else if (configuredUserId !== userId) {
      if (configuredUserId) await Purchases.logOut();
      await Purchases.logIn({ appUserID: userId });
    }
    configuredUserId = userId;
    console.info("[REVENUECAT_STATE]", { event: "configured", appUserIdBound: true });
  },
  async logOut() {
    if (!configured || !configuredUserId) return;
    await (await purchasesPlugin()).logOut();
    configuredUserId = null;
    packages.clear();
  },
  async getStatus() {
    return statusFromCustomerInfo((await (await purchasesPlugin()).getCustomerInfo()).customerInfo);
  },
  async getPackages() {
    const offerings = await (await purchasesPlugin()).getOfferings();
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
  async purchase(packageId): Promise<SubscriptionActionResult> {
    const pkg = packages.get(packageId);
    if (!pkg) throw new Error("revenuecat_package_not_loaded");
    try {
      const result = await (await purchasesPlugin()).purchasePackage({ aPackage: pkg });
      return { outcome: "success", status: statusFromCustomerInfo(result.customerInfo) };
    } catch (error) {
      const purchaseError = error as PurchasesError;
      if (purchaseError.userCancelled)
        return { outcome: "cancelled", status: await revenueCatAdapter.getStatus() };
      if (String(purchaseError.code).toLowerCase().includes("payment_pending"))
        return { outcome: "pending", status: await revenueCatAdapter.getStatus() };
      throw error;
    }
  },
  async restore() {
    const result = await (await purchasesPlugin()).restorePurchases();
    return { outcome: "success", status: statusFromCustomerInfo(result.customerInfo) };
  },
  async addStatusListener(listener) {
    const Purchases = await purchasesPlugin();
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
