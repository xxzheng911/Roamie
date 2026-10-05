import { setGenerationPhase, generationSettlement, generationSettlementResponse, captureGenerationException, emitGenerationDiagnostic } from "@/lib/itinerary-diagnostics.server";
import { aiObservation, observeCredit, observeCreditReserveAttempt } from "@/lib/abuse-guard-telemetry.server";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parsePlusEntitlementSnapshot } from "@/lib/plan-tier/entitlement";
import { CREDITS_COSTS } from "@/lib/credits/constants";
import { InsufficientCreditsError } from "@/lib/credits/errors";
import { authorizeAiUse } from "@/lib/abuse-guard.server";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";

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
    if (isAbuseGuardEnforcementOn()) {
      let material: string | undefined;
      try {
        material = await request.clone().text();
      } catch {
        material = undefined;
      }
      const fairUse = await authorizeAiUse("itinerary", request, material);
      if (fairUse) {
        throw new Error(fairUse.status === 429 ? "rate_limited" : "ai_unavailable");
      }
    }
    setGenerationPhase("credits_reserve");
    const { data: entitlement, error: entitlementError } = await context.supabase.rpc(
      "resolve_user_plus_entitlement",
      { p_user_id: context.userId },
    );
    const hasPlusAccess = !entitlementError && parsePlusEntitlementSnapshot(entitlement).hasPlus;
    const observation = aiObservation("itinerary");
    if (hasPlusAccess) {
      generationSettlement("reserve", "plus_bypass");
      generationSettlement("commit", "plus_bypass");
      observeCredit(observation, "plus_credit_skipped");
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
    observeCreditReserveAttempt(observation, hasPlusAccess);
    generationSettlement("reserve", "pending");
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
      generationSettlement("reserve", "failed");
      throw new Error("Credit reservation unavailable", { cause: reservationError });
    }
    if (!reservation?.ok) {
      throw new InsufficientCreditsError();
    }
    if (reservation.idempotent) {
      throw new Error("Conflict: request already processed");
    }

    generationSettlement("reserve", "succeeded");
    observeCredit(observation, "free_credit_reserve_succeeded");
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
      captureGenerationException(error);
      setGenerationPhase("credits_rollback");
      generationSettlement("rollback", "pending");
      try {
        const { data: rollbackData, error: rollbackError } = await context.supabase.rpc("credits_rollback", {
          p_ledger_id: reservation.ledger_id ?? null,
          p_idempotency_key: reservation.ledger_id ? null : idempotencyKey,
        });
        generationSettlementResponse("rollback", rollbackData, rollbackError);
        if (rollbackError) captureGenerationException(rollbackError, "cleanup");
        else emitGenerationDiagnostic("settled");
      } catch (rollbackError) {
        generationSettlement("rollback", "failed");
        captureGenerationException(rollbackError, "cleanup");
      }
      throw error;
    }
  });
