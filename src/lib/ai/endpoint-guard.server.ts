import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { CreditsFeatureType } from "@/lib/credits/constants";
import { CREDITS_COSTS } from "@/lib/credits/constants";

type AuthenticatedAiRequest = {
  userId: string;
  email: string | null;
  client: SupabaseClient;
  hasPlusAccess: boolean;
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
  const { data: profile } = await client
    .from("profiles")
    .select("plan_tier, subscription_status")
    .eq("id", data.user.id)
    .maybeSingle();
  const row = profile as { plan_tier?: string; subscription_status?: string } | null;
  const hasPlusAccess =
    row?.plan_tier === "plus" &&
    (row.subscription_status === "active" || row.subscription_status === "trialing");
  return { userId: data.user.id, email: data.user.email ?? null, client, hasPlusAccess };
}

export async function reserveServerCredits(
  auth: AuthenticatedAiRequest,
  featureType: CreditsFeatureType,
  request: Request,
): Promise<{ reservation: ServerCreditReservation | null; response: Response | null }> {
  if (auth.hasPlusAccess)
    return {
      reservation: { ledgerId: null, idempotencyKey: "plus", skipped: true },
      response: null,
    };
  const supplied = request.headers.get("x-roamie-request-id")?.trim();
  const requestId = supplied || crypto.randomUUID();
  const idempotencyKey = `server:${auth.userId}:${featureType}:${requestId}`;
  const amount = CREDITS_COSTS[featureType];
  const { data, error } = await auth.client.rpc("credits_reserve", {
    p_feature_type: featureType,
    p_request_id: requestId,
    p_idempotency_key: idempotencyKey,
    p_amount: amount,
    p_metadata: { authority: "server_endpoint" },
  });
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
  return {
    reservation: { ledgerId: result.ledger_id ?? null, idempotencyKey, skipped: false },
    response: null,
  };
}

export async function settleServerCredits(
  auth: AuthenticatedAiRequest,
  reservation: ServerCreditReservation,
  success: boolean,
): Promise<void> {
  if (reservation.skipped) return;
  const fn = success ? "credits_commit" : "credits_rollback";
  const { error } = await auth.client.rpc(fn, {
    p_ledger_id: reservation.ledgerId,
    p_idempotency_key: reservation.ledgerId ? null : reservation.idempotencyKey,
  });
  if (error) console.error("[AI_CREDITS_SETTLE]", fn, error.message);
}
