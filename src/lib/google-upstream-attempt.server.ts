import { authorizeGoogleBilling, runtimeGuardEnv } from "@/lib/abuse-guard.server";
import { utcDay } from "@/lib/abuse-guard-clock";
import type { GoogleBillingFamily } from "@/lib/abuse-guard-policy";
import { googleObservation, configureGoogleObservation, observeProviderAttempt } from "@/lib/abuse-guard-telemetry.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { resolveTrustedIp, resolveTrustedUserId } from "@/lib/worker-request-scope";

export type GoogleAttemptKind = "initial" | "retry" | "fallback" | "unknown";

/**
 * The only Google cost admission boundary. One invocation owns exactly one dispatch.
 * No admission token escapes this closure, and no client/logical request ID is consulted.
 * DO replay is for transporting this admission, never permission for another fetch.
 * Failures after dispatch retain their charge: an attempted provider call is not free.
 */
export async function runGoogleUpstreamAttempt(
  input: {
    family: GoogleBillingFamily;
    env?: CloudflareRuntimeEnv;
    request?: Request;
    kind?: GoogleAttemptKind;
    /** Only a verified, server-signed photo capability may supply this identity. */
    photoPrincipal?: { userId: string | null; audience: "guest" | "authenticated" | "legacy_capability" };
  },
  dispatch: () => Promise<Response>,
): Promise<{ denied: Response } | { response: Response }> {
  const env = runtimeGuardEnv(input.env);
  const userId = input.photoPrincipal ? input.photoPrincipal.userId : resolveTrustedUserId();
  const audience = input.photoPrincipal?.audience ?? (userId ? "authenticated" : "guest");
  const observation = googleObservation(input.family);
  configureGoogleObservation(observation, env, audience, input.kind ?? "unknown");
  // Allocated here, never at an endpoint, retry loop, logical operation or client boundary.
  const attemptId = `google-attempt:${utcDay()}:${crypto.randomUUID()}`;
  const denied = await authorizeGoogleBilling({
    env,
    family: input.family,
    operationId: attemptId,
    freshAttempt: true,
    chargeUser: Boolean(userId),
    chargeIp: true,
    includeGlobalBudget: true,
    userId,
    ip: resolveTrustedIp(input.request),
    observation,
  });
  if (denied) return { denied };
  const finish = observeProviderAttempt(observation);
  let success = false;
  try {
    const response = await dispatch();
    success = response.ok;
    return { response };
  } finally {
    finish(success);
  }
}
