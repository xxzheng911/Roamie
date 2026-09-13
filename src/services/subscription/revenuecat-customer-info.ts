import { SUBSCRIPTION_PRODUCT_IDS } from "@/constants/subscription";
import type { SubscriptionStatus } from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = nonEmptyString(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

const supportedProducts = new Set<string>(Object.values(SUBSCRIPTION_PRODUCT_IDS));

/**
 * RevenueCat's native bridge can omit entitlement metadata even when `premium` is active.
 * Resolve only from product-keyed CustomerInfo evidence; never infer a product from entitlement alone.
 */
export function statusFromRevenueCatCustomerInfo(info: unknown): SubscriptionStatus {
  const customer = record(info);
  const entitlements = record(customer.entitlements);
  const premium = record(record(entitlements.active).premium);
  if (!Object.keys(premium).length) {
    return {
      tier: "free",
      isActive: false,
      expiresAt: null,
      productId: null,
      willRenew: false,
      source: "revenuecat",
    };
  }

  const subscriptions = record(customer.subscriptionsByProductIdentifier);
  const activeSubscriptions = Array.isArray(customer.activeSubscriptions)
    ? customer.activeSubscriptions.filter(
        (value): value is string => typeof value === "string" && supportedProducts.has(value),
      )
    : [];
  const purchased = Array.isArray(customer.allPurchasedProductIdentifiers)
    ? customer.allPurchasedProductIdentifiers.filter(
        (value): value is string => typeof value === "string" && supportedProducts.has(value),
      )
    : [];
  const expirationMillis = record(customer.allExpirationDatesMillis);
  const expirationDates = record(customer.allExpirationDates);

  const entitlementProduct =
    nonEmptyString(premium.productIdentifier) ?? nonEmptyString(premium.productId);
  const subscriptionActive = Object.entries(subscriptions)
    .filter(
      ([productId, value]) => supportedProducts.has(productId) && record(value).isActive === true,
    )
    .map(([productId]) => productId);
  const futurePurchased = purchased.filter((productId) => {
    const expiry = isoDate(expirationMillis[productId]) ?? isoDate(expirationDates[productId]);
    return expiry != null && Date.parse(expiry) > Date.now();
  });
  const productId =
    entitlementProduct && supportedProducts.has(entitlementProduct)
      ? entitlementProduct
      : activeSubscriptions.length === 1
        ? activeSubscriptions[0]!
        : subscriptionActive.length === 1
          ? subscriptionActive[0]!
          : futurePurchased.length === 1
            ? futurePurchased[0]!
            : null;
  const subscription = productId ? record(subscriptions[productId]) : {};
  const expiresAt =
    isoDate(premium.expirationDate) ??
    isoDate(premium.expirationDateMillis) ??
    isoDate(subscription.expiresDate) ??
    (productId
      ? (isoDate(expirationMillis[productId]) ?? isoDate(expirationDates[productId]))
      : null);

  return {
    tier: "plus",
    isActive: true,
    expiresAt,
    productId,
    willRenew:
      typeof premium.willRenew === "boolean"
        ? premium.willRenew
        : typeof subscription.willRenew === "boolean"
          ? subscription.willRenew
          : false,
    source: "revenuecat",
  };
}
