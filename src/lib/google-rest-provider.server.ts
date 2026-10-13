import { runGoogleUpstreamAttempt } from "@/lib/google-upstream-attempt.server";
import { billingFamilyFromUrl, type GoogleBillingFamily } from "@/lib/abuse-guard-policy";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { runtimeGuardEnv } from "@/lib/abuse-guard.server";
import { googleRestRequest } from "@/lib/google-rest-contract";
import { consumeGoogleBurst, consumeGuestGoogleBurst } from "@/lib/google-burst.server";
import { fixedStatusResponse } from "@/lib/kill-switch.server";
import { requireGoogleServerKey } from "@/lib/google-maps-key-resolve.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { isPublicReadAuthorized, resolveTrustedUserId } from "@/lib/worker-request-scope";
import {
  guardDenialClassification,
  logRouteRequestDiagnostic,
  upstreamBodyReason,
} from "@/lib/route-request-diagnostic.server";

function diagnosticFamily(url: string): GoogleBillingFamily | null {
  try {
    return billingFamilyFromUrl(url);
  } catch {
    return null;
  }
}

/** The burst layer's own response: 429 is its minute limiter, anything else is its fail-closed path. */
function logBurstRejection(family: GoogleBillingFamily | null, burst: Response): Response {
  if (family)
    logRouteRequestDiagnostic(family, {
      httpStatus: burst.status,
      failureSource: "worker_rate_limiter",
      failureStage: burst.status === 429 ? "minute_limiter" : "unknown",
      normalizedReason: burst.status === 429 ? "burst_limited" : "burst_unavailable",
      providerAttempted: false,
    });
  return burst;
}

/** All upstream failures are opaque; no Google error body/URL/credential reaches logs or clients. */
export async function fetchGoogleRestProvider(
  input: unknown,
  env?: CloudflareRuntimeEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let spec;
  try {
    spec = googleRestRequest(input);
  } catch {
    return Response.json({ error: "invalid_google_request" }, { status: 400 });
  }
  const envForGuard = runtimeGuardEnv(env);
  const family = diagnosticFamily(spec.url);
  const unattempted = (httpStatus: number, normalizedReason: string) => {
    if (family)
      logRouteRequestDiagnostic(family, {
        httpStatus,
        failureSource: normalizedReason === "missing_principal" ? "roamie_guard" : "unknown",
        failureStage: "unknown",
        normalizedReason,
        providerAttempted: false,
      });
  };
  if (isAbuseGuardEnforcementOn(envForGuard)) {
    const userId = resolveTrustedUserId();
    if (userId) {
      const burst = await consumeGoogleBurst(envForGuard, userId);
      if (burst) return logBurstRejection(family, burst);
    } else if (isPublicReadAuthorized()) {
      const burst = await consumeGuestGoogleBurst(envForGuard);
      if (burst) return logBurstRejection(family, burst);
    } else {
      const response = fixedStatusResponse("google_unavailable");
      unattempted(response.status, "missing_principal");
      return response;
    }
  }
  if (!resolveTrustedUserId() && !isPublicReadAuthorized()) {
    const response = fixedStatusResponse("google_unavailable");
    unattempted(response.status, "missing_principal");
    return response;
  }
  let key;
  try {
    key = requireGoogleServerKey(spec.family, envForGuard);
  } catch {
    unattempted(503, "credential_unavailable");
    return Response.json({ error: "google_credential_unavailable" }, { status: 503 });
  }
  const url = new URL(spec.url);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (spec.family === "geocoding" || url.pathname.includes("/directions/json"))
    url.searchParams.set("key", key);
  else headers["X-Goog-Api-Key"] = key;
  if (spec.fields) headers["X-Goog-FieldMask"] = spec.fields;
  // Set only immediately before the real provider fetch; never inferred from a status code.
  let providerAttempted = false;
  const upstreamFailure = (httpStatus: number, normalizedReason: string) => {
    if (family)
      logRouteRequestDiagnostic(family, {
        httpStatus,
        failureSource: "google_upstream",
        failureStage: "provider_request",
        normalizedReason,
        providerAttempted: true,
      });
  };
  try {
    const attempt = await runGoogleUpstreamAttempt({
      family: billingFamilyFromUrl(spec.url), env: envForGuard, kind: spec.attemptKind,
    }, async () => {
      providerAttempted = true;
      const response = await fetcher(url.toString(), {
        method: spec.method,
        headers,
        body: spec.body == null ? undefined : JSON.stringify(spec.body),
        signal: AbortSignal.timeout(15000),
        redirect: "manual",
      });
      if (!response.ok) {
        const status = response.status === 400 ? 400 : response.status === 429 ? 429 : 502;
        upstreamFailure(status, `upstream_http_${response.status}`);
        return Response.json(
          {
            error: {
              status:
                status === 400
                  ? "INVALID_ARGUMENT"
                  : status === 429
                    ? "RESOURCE_EXHAUSTED"
                    : "UPSTREAM_UNAVAILABLE",
              message: "google_upstream_unavailable",
            },
          },
          { status },
        );
      }
      const json = await response.json();
      if (json?.error || (json?.status && !["OK", "ZERO_RESULTS"].includes(json.status))) {
        upstreamFailure(502, upstreamBodyReason(json?.status));
        return Response.json({ error: "google_upstream_unavailable" }, { status: 502 });
      }
      const safe = JSON.stringify(json)
        .split(key)
        .join("<REDACTED>")
        .replace(/AIza[\w-]{20,}/g, "<REDACTED>");
      const safeResponse = new Response(safe, {
        headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
      });
      return safeResponse;
    });
    if ("denied" in attempt) {
      if (family)
        logRouteRequestDiagnostic(family, {
          httpStatus: attempt.denied.status,
          ...guardDenialClassification(attempt.denialReason),
          providerAttempted: false,
        });
      return attempt.denied;
    }
    return attempt.response;
  } catch {
    // A thrown fetch/timeout/parse cannot prove Google's own status, so the source stays unknown.
    if (family)
      logRouteRequestDiagnostic(family, {
        httpStatus: 502,
        failureSource: "unknown",
        failureStage: providerAttempted ? "provider_request" : "unknown",
        normalizedReason: providerAttempted ? "provider_exception" : "attempt_exception",
        providerAttempted,
      });
    return Response.json({ error: "google_upstream_unavailable" }, { status: 502 });
  }
}
