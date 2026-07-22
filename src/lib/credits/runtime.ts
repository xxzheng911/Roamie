import { supabase } from "@/integrations/supabase/client";
import { fetchCreditAccount, setCachedCreditAccount } from "./account";
import {
  CREDITS_COSTS,
  FREE_MONTHLY_CREDITS,
  type CreditsFeatureType,
} from "./constants";
import { isCreditsFeatureEnabled } from "./feature-flag";
import type {
  BeginCreditsOptions,
  BeginCreditsResult,
  CreditsCheckResult,
  CreditsCommitResult,
  CreditsOperationHandle,
  CreditsReserveResult,
  CreditsRollbackResult,
} from "./types";

function costFor(featureType: CreditsFeatureType, amount?: number): number {
  return amount ?? CREDITS_COSTS[featureType];
}

function inactiveHandle(
  featureType: CreditsFeatureType,
  requestId: string,
  idempotencyKey: string,
  amount: number,
): CreditsOperationHandle {
  return {
    featureType,
    requestId,
    idempotencyKey,
    ledgerId: null,
    amount,
    skipped: true,
    inactive: true,
    commit: async () => ({ ok: true, skipped: true, status: "skipped" }),
    rollback: async () => ({ ok: true, skipped: true, status: "skipped", noop: true }),
  };
}

async function rpcCheck(
  featureType: CreditsFeatureType,
  amount: number,
): Promise<CreditsCheckResult> {
  const { data, error } = await supabase.rpc("credits_check", {
    p_feature_type: featureType,
    p_amount: amount,
  });
  if (error) {
    console.warn("[CREDITS_CHECK]", error.message);
    return { ok: false, reason: "error" };
  }
  return (data ?? { ok: false, reason: "empty" }) as CreditsCheckResult;
}

async function rpcReserve(
  featureType: CreditsFeatureType,
  requestId: string,
  idempotencyKey: string,
  amount: number,
  metadata?: Record<string, unknown>,
): Promise<CreditsReserveResult> {
  const { data, error } = await supabase.rpc("credits_reserve", {
    p_feature_type: featureType,
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_amount: amount,
    p_metadata: metadata ?? {},
  });
  if (error) {
    console.warn("[CREDITS_RESERVE]", error.message);
    return { ok: false, reason: "error" };
  }
  return (data ?? { ok: false, reason: "empty" }) as CreditsReserveResult;
}

async function rpcCommit(
  ledgerId: string | null,
  idempotencyKey: string,
): Promise<CreditsCommitResult> {
  const { data, error } = await supabase.rpc("credits_commit", {
    p_ledger_id: ledgerId,
    p_idempotency_key: ledgerId ? null : idempotencyKey,
  });
  if (error) {
    console.warn("[CREDITS_COMMIT]", error.message);
    return { ok: false, reason: "error" };
  }
  const result = (data ?? { ok: false, reason: "empty" }) as CreditsCommitResult;
  if (typeof result.available_credits === "number") {
    const account = await fetchCreditAccount();
    if (account) setCachedCreditAccount(account);
  }
  return result;
}

async function rpcRollback(
  ledgerId: string | null,
  idempotencyKey: string,
): Promise<CreditsRollbackResult> {
  const { data, error } = await supabase.rpc("credits_rollback", {
    p_ledger_id: ledgerId,
    p_idempotency_key: ledgerId ? null : idempotencyKey,
  });
  if (error) {
    console.warn("[CREDITS_ROLLBACK]", error.message);
    return { ok: false, reason: "error" };
  }
  const result = (data ?? { ok: false, reason: "empty" }) as CreditsRollbackResult;
  if (typeof result.available_credits === "number") {
    const account = await fetchCreditAccount();
    if (account) setCachedCreditAccount(account);
  }
  return result;
}

/**
 * Check → Reserve. Plus / flag-off → inactive handle (no ledger).
 * Insufficient → blocked before expensive AI / Places work.
 */
export async function beginCreditsOperation(
  opts: BeginCreditsOptions,
): Promise<BeginCreditsResult> {
  const amount = costFor(opts.featureType, opts.amount);
  const requestId = opts.requestId.trim();
  const idempotencyKey = (opts.idempotencyKey ?? requestId).trim();

  if (!requestId) {
    return {
      blocked: true,
      reason: "error",
      required: amount,
      available: 0,
      message: "credits request_id missing",
    };
  }

  // Feature flag OFF: pass-through — no deduct, no block, no ledger.
  if (!isCreditsFeatureEnabled()) {
    console.info(
      "[CREDITS_RUNTIME] skipped reason=flag_off",
      `feature=${opts.featureType}`,
      `requestId=${requestId}`,
    );
    return {
      blocked: false,
      handle: inactiveHandle(opts.featureType, requestId, idempotencyKey, amount),
    };
  }

  // Plus: skip Check / Reserve / Commit (Fair Use / rate limit remain elsewhere).
  if (opts.hasPlusAccess) {
    console.info(
      "[CREDITS_RUNTIME] skipped reason=plus",
      `feature=${opts.featureType}`,
      `requestId=${requestId}`,
    );
    return {
      blocked: false,
      handle: inactiveHandle(opts.featureType, requestId, idempotencyKey, amount),
    };
  }

  const check = await rpcCheck(opts.featureType, amount);
  if (!check.ok) {
    const available = check.usable_credits ?? check.available_credits ?? 0;
    console.info(
      "[CREDITS_GATE] blocked",
      `feature=${opts.featureType}`,
      `required=${amount}`,
      `available=${available}`,
    );
    return {
      blocked: true,
      reason: check.reason === "insufficient" ? "insufficient" : "error",
      required: amount,
      available,
      message:
        check.reason === "insufficient"
          ? "insufficient_credits"
          : "credits_check_failed",
    };
  }

  const reserved = await rpcReserve(
    opts.featureType,
    requestId,
    idempotencyKey,
    amount,
    {
      ...opts.metadata,
      feature_type: opts.featureType,
    },
  );

  if (!reserved.ok) {
    const available = reserved.usable_credits ?? reserved.available_credits ?? 0;
    return {
      blocked: true,
      reason: reserved.reason === "insufficient" ? "insufficient" : "error",
      required: amount,
      available,
      message:
        reserved.reason === "insufficient"
          ? "insufficient_credits"
          : "credits_reserve_failed",
    };
  }

  // Should not happen for Free path; keep as safety.
  if (reserved.skipped) {
    return {
      blocked: false,
      handle: inactiveHandle(opts.featureType, requestId, idempotencyKey, amount),
    };
  }

  const ledgerId = reserved.ledger_id ?? null;
  console.info(
    "[CREDITS_RESERVE]",
    `feature=${opts.featureType}`,
    `amount=${amount}`,
    `ledger=${ledgerId}`,
    `requestId=${requestId}`,
  );

  const handle: CreditsOperationHandle = {
    featureType: opts.featureType,
    requestId,
    idempotencyKey,
    ledgerId,
    amount,
    skipped: false,
    inactive: false,
    commit: async () => {
      if (!ledgerId && reserved.status === "committed") {
        return { ok: true, idempotent: true, status: "committed" };
      }
      const result = await rpcCommit(ledgerId, idempotencyKey);
      console.info(
        "[CREDITS_COMMIT]",
        `feature=${opts.featureType}`,
        `ok=${result.ok}`,
        `available=${result.available_credits ?? "?"}`,
      );
      return result;
    },
    rollback: async () => {
      const result = await rpcRollback(ledgerId, idempotencyKey);
      console.info(
        "[CREDITS_ROLLBACK]",
        `feature=${opts.featureType}`,
        `ok=${result.ok}`,
        `available=${result.available_credits ?? "?"}`,
      );
      return result;
    },
  };

  return { blocked: false, handle };
}

/** Pre-flight only (no reserve). Used for UI messaging. */
export async function checkCreditsAvailability(
  featureType: CreditsFeatureType,
  hasPlusAccess: boolean,
  amount?: number,
): Promise<CreditsCheckResult> {
  if (!isCreditsFeatureEnabled() || hasPlusAccess) {
    return { ok: true, skipped: true, reason: hasPlusAccess ? "plus" : "flag_off" };
  }
  return rpcCheck(featureType, costFor(featureType, amount));
}

export function newCreditsRequestId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export { FREE_MONTHLY_CREDITS, CREDITS_COSTS };
