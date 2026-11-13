import { aiObservation, observeCredit, observeCreditReserveAttempt } from "@/lib/abuse-guard-telemetry.server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authorizeAiUse } from "@/lib/abuse-guard.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import type { AiSurface } from "@/lib/abuse-guard-policy";
import type { CreditsFeatureType } from "@/lib/credits/constants";
import { CREDITS_COSTS } from "@/lib/credits/constants";
import { parsePlusEntitlementSnapshot } from "@/lib/plan-tier/entitlement";
import { bindVerifiedUserId } from "@/lib/worker-request-scope";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server reservations ('server:' keys) are reserved and settled with the
 * service role, bound to the verified user id via p_user_id. Settlement never
 * depends on the user's JWT still being valid, and clients cannot touch these
 * ledger rows (enforced in SQL).
 *
 * The service-role client is always passed explicitly: endpoints take it from
 * requireAuthenticatedAiRequest (auth.creditsClient); a missing client fails
 * closed without any network call.
 */
export async function serverCreditsRpc(
  fn: "credits_reserve" | "credits_commit" | "credits_rollback",
  args: Record<string, unknown>,
  client: SupabaseClient | null | undefined,
): Promise<{
  data: unknown;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
}> {
  if (!client) return { data: null, error: { message: "credits_client_missing" } };
  try {
    const { data, error } = await client.rpc(fn, args);
    // Keep PostgREST code/details/hint: itinerary diagnostics read cause.code.
    return {
      data,
      error: error
        ? {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
          }
        : null,
    };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : "rpc_unavailable" } };
  }
}

/** Service-role client for server credit RPCs (lazy; no network until used). */
export function serverCreditsClient(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

type AuthenticatedAiRequest = {
  userId: string;
  email: string | null;
  client: SupabaseClient;
  hasPlusAccess: boolean;
  /** Service-role client for credits_reserve / commit / rollback. */
  creditsClient?: SupabaseClient;
};

export type ServerCreditReservation = {
  ledgerId: string | null;
  idempotencyKey: string;
  skipped: boolean;
};

export async function requireAuthenticatedAiRequest(
  request: Request,
): Promise<AuthenticatedAiRequest | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const url = process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("server_auth_configuration_missing");
  const client = createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const { data: entitlementData, error: entitlementError } = await client.rpc(
    "resolve_user_plus_entitlement",
    { p_user_id: data.user.id },
  );
  const hasPlusAccess = entitlementError
    ? false
    : parsePlusEntitlementSnapshot(entitlementData).hasPlus;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    client,
    hasPlusAccess,
    creditsClient: serverCreditsClient(),
  };
}

/** Fair-use runs before any credit reservation. A rejection does not reserve. */
export async function beginAiRequest(
  auth: AuthenticatedAiRequest,
  featureType: CreditsFeatureType,
  surface: AiSurface,
  request: Request,
  material?: string,
): Promise<{ reservation: ServerCreditReservation | null; response: Response | null }> {
  bindVerifiedUserId(auth.userId);
  if (isAbuseGuardEnforcementOn()) {
    const denied = await authorizeAiUse(surface, request, material);
    if (denied) return { reservation: null, response: denied };
  }
  return reserveServerCredits(auth, featureType, request, surface);
}

export async function reserveServerCredits(
  auth: AuthenticatedAiRequest,
  featureType: CreditsFeatureType,
  request: Request,
  surface: AiSurface = featureType === "ITINERARY_GENERATION" ? "itinerary" : "recommendations",
): Promise<{ reservation: ServerCreditReservation | null; response: Response | null }> {
  const observation = aiObservation(surface);
  if (auth.hasPlusAccess) {
    observeCredit(observation, "plus_credit_skipped");
    return {
      reservation: { ledgerId: null, idempotencyKey: "plus", skipped: true },
      response: null,
    };
  }
  const supplied = request.headers.get("x-roamie-request-id")?.trim();
  const requestId = supplied || crypto.randomUUID();
  const idempotencyKey = `server:${auth.userId}:${featureType}:${requestId}`;
  const amount = CREDITS_COSTS[featureType];
  observeCreditReserveAttempt(observation, auth.hasPlusAccess);
  const { data, error } = await serverCreditsRpc("credits_reserve", {
    p_feature_type: featureType,
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_amount: amount,
    p_metadata: { authority: "server_endpoint" },
    p_user_id: auth.userId,
  }, auth.creditsClient);
  if (error) console.error("[AI_CREDITS_RESERVE]", error.message);
  const result = data as {
    ok?: boolean;
    idempotent?: boolean;
    reason?: string;
    ledger_id?: string;
    status?: string;
  } | null;
  if (error || !result?.ok) {
    const status = result?.reason === "insufficient" ? 402 : 503;
    return {
      reservation: null,
      response: Response.json(
        {
          error: result?.reason === "insufficient" ? "insufficient_credits" : "credits_unavailable",
        },
        { status },
      ),
    };
  }
  if (result.idempotent) {
    return {
      reservation: null,
      response: Response.json(
        {
          error: result.status === "reserved" ? "request_in_progress" : "request_already_processed",
        },
        { status: 409 },
      ),
    };
  }
  observeCredit(observation, "free_credit_reserve_succeeded");
  return {
    reservation: { ledgerId: result.ledger_id ?? null, idempotencyKey, skipped: false },
    response: null,
  };
}

export async function settleServerCredits(
  auth: AuthenticatedAiRequest,
  reservation: ServerCreditReservation,
  success: boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (reservation.skipped) return { ok: true };
  const fn = success ? "credits_commit" : "credits_rollback";
  const { data, error } = await serverCreditsRpc(fn, {
    p_ledger_id: reservation.ledgerId,
    p_idempotency_key: reservation.ledgerId ? null : reservation.idempotencyKey,
    p_user_id: auth.userId,
  }, auth.creditsClient);
  if (error) {
    console.error("[AI_CREDITS_SETTLE]", fn, error.message);
    return { ok: false, reason: "rpc_error" };
  }
  const result = data as { ok?: boolean; reason?: string } | null;
  if (!result?.ok) {
    // ok:false (e.g. not_found) is a settlement failure, not a silent success.
    const reason = result?.reason ?? "empty";
    console.error("[AI_CREDITS_SETTLE]", fn, "rejected", reason);
    return { ok: false, reason };
  }
  return { ok: true };
}

/**
 * One settlement per request (same rules as /api/roamie):
 * - first settlement wins; a commit requested after a rollback resolves false
 *   (the result must not be delivered or persisted);
 * - commit retries once on rpc_error (idempotent), then releases the hold
 *   (rollback never refunds a committed row);
 * - a disconnect after the provider finished, or after the first content delta
 *   reached the client (rule A'), commits instead of refunding;
 * - later calls reuse (and wait for) the first settlement; every settlement RPC
 *   is handed to `waitUntil` so a disconnect cannot drop it.
 */
export function createServerCreditSettlement(
  auth: AuthenticatedAiRequest,
  reservation: ServerCreditReservation,
  waitUntil?: (promise: Promise<unknown>) => void,
) {
  let settlement: { success: boolean; result: Promise<boolean> } | null = null;
  let providerFinished = false;
  let contentDelivered = false;
  const runCommit = async (): Promise<boolean> => {
    let settled = await settleServerCredits(auth, reservation, true);
    if (!settled.ok && settled.reason === "rpc_error") {
      settled = await settleServerCredits(auth, reservation, true);
    }
    if (!settled.ok && settled.reason === "rpc_error") {
      await settleServerCredits(auth, reservation, false);
    }
    return settled.ok;
  };
  const settle = (success: boolean): Promise<boolean> => {
    if (settlement) {
      // Wait for the in-flight settlement instead of resolving early.
      if (!success) return settlement.result.then(() => true);
      return settlement.success ? settlement.result : Promise.resolve(false);
    }
    settlement = {
      success,
      result: success
        ? runCommit()
        : settleServerCredits(auth, reservation, false).then(() => true),
    };
    waitUntil?.(settlement.result);
    return settlement.result;
  };
  return {
    settle,
    markProviderFinished: () => {
      providerFinished = true;
    },
    markContentDelivered: () => {
      contentDelivered = true;
    },
    hasDeliveredContent: () => contentDelivered,
    onClientAbort: () => void settle(providerFinished || contentDelivered),
  };
}

export async function rollbackServerCreditsByRequest(
  auth: AuthenticatedAiRequest,
  featureType: CreditsFeatureType,
  requestId: string,
): Promise<boolean> {
  if (auth.hasPlusAccess) return true;
  const idempotencyKey = `server:${auth.userId}:${featureType}:${requestId}`;
  const { data, error } = await serverCreditsRpc("credits_rollback", {
    p_ledger_id: null,
    p_idempotency_key: idempotencyKey,
    p_user_id: auth.userId,
  }, auth.creditsClient);
  if (error) {
    console.error("[AI_CREDITS_CANCEL]", error.message);
    return false;
  }
  return Boolean((data as { ok?: boolean } | null)?.ok);
}
