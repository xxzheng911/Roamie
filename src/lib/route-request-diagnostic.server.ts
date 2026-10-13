import type { GoogleBillingFamily } from "@/lib/abuse-guard-policy";
import type { GuardTelemetryReason } from "@/lib/abuse-guard-telemetry.server";

export type RouteFailureSource = "roamie_guard" | "google_upstream" | "worker_rate_limiter" | "unknown";
export type RouteFailureStage =
  | "daily_budget"
  | "weighted_budget"
  | "minute_limiter"
  | "provider_request"
  | "unknown";

export type RouteRequestDiagnostic = {
  timestamp: string;
  requestId: string;
  routeFamily: "routes" | "directions";
  httpStatus: number;
  failureSource: RouteFailureSource;
  failureStage: RouteFailureStage;
  normalizedReason: string;
  providerAttempted: boolean;
};

const GOOGLE_BODY_STATUSES = new Set([
  "NOT_FOUND",
  "INVALID_REQUEST",
  "OVER_DAILY_LIMIT",
  "OVER_QUERY_LIMIT",
  "REQUEST_DENIED",
  "MAX_WAYPOINTS_EXCEEDED",
  "MAX_ROUTE_LENGTH_EXCEEDED",
  "UNKNOWN_ERROR",
]);

/** Bounded, allowlisted reason for a Google body status; never echoes arbitrary upstream text. */
export function upstreamBodyReason(status: unknown): string {
  return typeof status === "string" && GOOGLE_BODY_STATUSES.has(status)
    ? `body_status_${status}`
    : "body_error";
}

/** Classifies only from the guard's own recorded reason; null stays unknown. */
export function guardDenialClassification(
  reason: GuardTelemetryReason | null,
): Pick<RouteRequestDiagnostic, "failureSource" | "failureStage" | "normalizedReason"> {
  if (reason === "family")
    return { failureSource: "roamie_guard", failureStage: "daily_budget", normalizedReason: "family_daily_limit" };
  if (reason === "user_weight" || reason === "ip_weight" || reason === "global_weight")
    return { failureSource: "roamie_guard", failureStage: "weighted_budget", normalizedReason: reason };
  if (reason === "kill_switch" || reason === "guard_unavailable" || reason === "missing_principal")
    return { failureSource: "roamie_guard", failureStage: "unknown", normalizedReason: reason };
  return { failureSource: "unknown", failureStage: "unknown", normalizedReason: "unknown" };
}

/**
 * One line per failed Routes/Directions proxy request, emitted at the rejecting call site.
 * Safe fields only: no key, token, user, IP, coordinates, place, body or budget values.
 */
export function logRouteRequestDiagnostic(
  family: GoogleBillingFamily,
  entry: Omit<RouteRequestDiagnostic, "timestamp" | "requestId" | "routeFamily">,
): void {
  if (family !== "routes" && family !== "directions") return;
  const record: RouteRequestDiagnostic = {
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID(),
    routeFamily: family,
    ...entry,
  };
  try {
    console.warn("[ROUTE_REQUEST_DIAGNOSTIC]", JSON.stringify(record));
  } catch {
    /* diagnostics never affect the response */
  }
}
