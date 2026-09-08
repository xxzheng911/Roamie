import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parsePlusEntitlementSnapshot } from "@/lib/plan-tier/entitlement";
import { CREDITS_COSTS } from "@/lib/credits/constants";
import { InsufficientCreditsError } from "@/lib/credits/errors";

/** Server-function boundary for Plus-only capabilities. Client tier flags are ignored. */
export const requireSupabasePlus = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("resolve_user_plus_entitlement", {
      p_user_id: context.userId,
    });
    if (error || !parsePlusEntitlementSnapshot(data).hasPlus) {
      throw new Error("Forbidden: Plus entitlement required");
    }
    return next({ context });
  });

/** Single billing boundary for every itinerary server-function transport. */
export const requireItineraryCredits = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const request = getRequest();
    const { data: entitlement, error: entitlementError } = await context.supabase.rpc(
      "resolve_user_plus_entitlement",
      { p_user_id: context.userId },
    );
    if (!entitlementError && parsePlusEntitlementSnapshot(entitlement).hasPlus) {
      return next({
        context: {
          ...context,
          itineraryCreditReservation: {
            ledgerId: null as string | null,
            idempotencyKey: null as string | null,
            plusBypass: true,
          },
        },
      });
    }

    const requestId = request.headers.get("x-roamie-request-id")?.trim() || crypto.randomUUID();
    const idempotencyKey = `server:${context.userId}:ITINERARY_GENERATION:${requestId}`;
    const { data: reservationData, error: reservationError } = await context.supabase.rpc(
      "credits_reserve",
      {
        p_feature_type: "ITINERARY_GENERATION",
        p_request_id: requestId,
        p_idempotency_key: idempotencyKey,
        p_amount: CREDITS_COSTS.ITINERARY_GENERATION,
        p_metadata: { authority: "server_function" },
      },
    );
    const reservation = reservationData as {
      ok?: boolean;
      idempotent?: boolean;
      ledger_id?: string;
    } | null;
    if (reservationError) {
      throw new Error("Credit reservation unavailable");
    }
    if (!reservation?.ok) {
      throw new InsufficientCreditsError();
    }
    if (reservation.idempotent) {
      throw new Error("Conflict: request already processed");
    }

    try {
      const result = await next({
        context: {
          ...context,
          itineraryCreditReservation: {
            ledgerId: reservation.ledger_id ?? null,
            idempotencyKey: reservation.ledger_id ? null : idempotencyKey,
            plusBypass: false,
          },
        },
      });
      return result;
    } catch (error) {
      try {
        await context.supabase.rpc("credits_rollback", {
          p_ledger_id: reservation.ledger_id ?? null,
          p_idempotency_key: reservation.ledger_id ? null : idempotencyKey,
        });
      } catch {
        // Preserve the original handler error; stale cleanup remains the final safety net.
      }
      throw error;
    }
  });
