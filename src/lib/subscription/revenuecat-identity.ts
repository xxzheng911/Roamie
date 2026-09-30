/**
 * RevenueCat identity for Roamie's single-account ownership contract.
 *
 * Dashboard policy is Keep with original App User ID. The Apple subscription
 * stays with the Supabase user id that originally purchased it.
 * `original_app_user_id` is the first id RevenueCat recorded for that customer.
 * Aliases share the customer; they do not create a second Roamie owner.
 * A missing alias list is not an empty list.
 */

const CANONICAL_SUPABASE_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCanonicalSupabaseUserId(value: string): boolean {
  return CANONICAL_SUPABASE_USER_ID.test(value);
}

export function isRevenueCatAnonymousAppUserId(value: string): boolean {
  return value.startsWith("$RCAnonymousID:");
}

export type RevenueCatOwnershipOutcome = "owned" | "mismatch" | "ambiguous" | "anonymous";

export type RevenueCatOwnership = {
  outcome: RevenueCatOwnershipOutcome;
  ownerId: string | null;
};

export type RevenueCatIdentityInput = {
  appUserId?: string | null;
  originalAppUserId?: string | null;
  /** `null` or omitted means RevenueCat did not send the alias list. */
  aliases?: readonly string[] | null;
};

export type SubscriptionOwnershipErrorCode =
  | "subscription_ownership_mismatch"
  | "subscription_ownership_ambiguous"
  | "subscription_ownership_anonymous";

export class SubscriptionOwnershipError extends Error {
  readonly code: SubscriptionOwnershipErrorCode;

  constructor(outcome: Exclude<RevenueCatOwnershipOutcome, "owned">) {
    const code = subscriptionOwnershipErrorCode(outcome);
    super(code);
    this.name = "SubscriptionOwnershipError";
    this.code = code;
  }
}

export function subscriptionOwnershipErrorCode(
  outcome: Exclude<RevenueCatOwnershipOutcome, "owned">,
): SubscriptionOwnershipErrorCode {
  if (outcome === "mismatch") return "subscription_ownership_mismatch";
  if (outcome === "anonymous") return "subscription_ownership_anonymous";
  return "subscription_ownership_ambiguous";
}

export function isSubscriptionOwnershipErrorCode(
  code: string | undefined,
): code is SubscriptionOwnershipErrorCode {
  return (
    code === "subscription_ownership_mismatch" ||
    code === "subscription_ownership_ambiguous" ||
    code === "subscription_ownership_anonymous"
  );
}

function canonicalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isCanonicalSupabaseUserId(trimmed) ? trimmed.toLowerCase() : null;
}

function uniqueCanonical(values: readonly (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const id = canonicalId(value);
        return id ? [id] : [];
      }),
    ),
  ];
}

function nonCanonicalOriginal(value: string | null): "anonymous" | "unknown" | null {
  if (!value) return null;
  if (canonicalId(value)) return null;
  return isRevenueCatAnonymousAppUserId(value) ? "anonymous" : "unknown";
}

/**
 * The requested or event app user id never becomes an owner by itself.
 * It can only confirm, or conflict with, an owner already present in
 * `original_app_user_id` or `aliases`.
 */
function resolveCustomerOwner(input: RevenueCatIdentityInput): RevenueCatOwnership {
  const originalRaw = input.originalAppUserId?.trim() || null;
  const original = canonicalId(originalRaw);
  const aliasesKnown = Array.isArray(input.aliases);
  const aliasIds = aliasesKnown ? uniqueCanonical(input.aliases ?? []) : [];
  const appUser = canonicalId(input.appUserId);

  if (original) {
    // Aliases share the customer. They do not move ownership off the original
    // Roamie account, and they do not block renewal or expiration for that account.
    if (appUser && appUser !== original) return { outcome: "ambiguous", ownerId: null };
    return { outcome: "owned", ownerId: original };
  }

  const originalKind = nonCanonicalOriginal(originalRaw);
  if (!aliasesKnown || originalKind === "unknown") return { outcome: "ambiguous", ownerId: null };
  if (aliasIds.length === 0) return { outcome: "anonymous", ownerId: null };
  if (aliasIds.length > 1) return { outcome: "ambiguous", ownerId: null };
  const ownerId = aliasIds[0] ?? null;
  if (!ownerId) return { outcome: "anonymous", ownerId: null };
  if (appUser && appUser !== ownerId) return { outcome: "ambiguous", ownerId: null };
  return { outcome: "owned", ownerId };
}

/**
 * Decide whether the authenticated Supabase user owns this RevenueCat customer.
 * Fail closed: mismatch, anonymous, and ambiguous results never grant Plus.
 */
export function evaluateRevenueCatOwnership(
  input: RevenueCatIdentityInput,
  currentUserId: string,
): RevenueCatOwnership {
  const current = canonicalId(currentUserId);
  if (!current) return { outcome: "anonymous", ownerId: null };
  const owner = resolveCustomerOwner(input);
  if (owner.outcome === "owned" && owner.ownerId !== current) {
    return { outcome: "mismatch", ownerId: owner.ownerId };
  }
  return owner;
}

/**
 * Webhook events have no session user. Apply a lifecycle change only when the
 * event proves exactly one Roamie owner. `app_user_id` alone is not proof.
 */
export function resolveRevenueCatEventOwner(input: RevenueCatIdentityInput): RevenueCatOwnership {
  return resolveCustomerOwner(input);
}
