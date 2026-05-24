import { clientEnv } from "@/constants/env";
import {
  defaultFreeStatus,
  defaultUsage,
  readLocalUsage,
} from "@/services/subscription/tiers";
import type { SubscriptionAdapter, SubscriptionStatus, UsageCounters } from "./types";

/** Local/dev adapter — free tier with client-side usage counters. */
export const localSubscriptionAdapter: SubscriptionAdapter = {
  id: "local",
  async getStatus() {
    return defaultFreeStatus();
  },
  async getUsage() {
    return readLocalUsage();
  },
  async purchase() {
    if (clientEnv.isDev) {
      console.warn("[subscription] purchase() — wire RevenueCat adapter for production");
    }
    return defaultFreeStatus();
  },
  async restore() {
    return defaultFreeStatus();
  },
  async sync() {},
};

/**
 * RevenueCat adapter stub — implement when SDK keys are configured.
 * @see https://www.revenuecat.com/docs/getting-started
 */
export const revenueCatAdapter: SubscriptionAdapter = {
  id: "revenuecat",
  async getStatus(): Promise<SubscriptionStatus> {
    // TODO: Purchases.getCustomerInfo() → map entitlements
    return defaultFreeStatus();
  },
  async getUsage(): Promise<UsageCounters> {
    return readLocalUsage();
  },
  async purchase(_productId: string) {
    throw new Error("RevenueCat not configured. Set VITE_REVENUECAT_APPLE_KEY.");
  },
  async restore() {
    throw new Error("RevenueCat not configured.");
  },
  async sync() {
    // TODO: Purchases.syncPurchases()
  },
};

export function createSubscriptionAdapter(): SubscriptionAdapter {
  if (clientEnv.revenueCatAppleKey || clientEnv.revenueCatGoogleKey) {
    return revenueCatAdapter;
  }
  return localSubscriptionAdapter;
}

export function getDefaultUsage(): UsageCounters {
  return defaultUsage();
}
