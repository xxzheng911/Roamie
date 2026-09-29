import {
  GOOGLE_FAMILY_LIMITS,
  AI_FAIR_USE,
  type GoogleBillingFamily,
  type AiSurface,
} from "@/lib/abuse-guard-policy";
import { getWorkerScope } from "@/lib/worker-request-scope";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";

type Provider = "google" | "ai";
type Family = GoogleBillingFamily | AiSurface;
type Metric =
  | "guard_decision"
  | "provider_attempt"
  | "provider_success"
  | "provider_failure"
  | "provider_attempt_without_guard"
  | "plus_credit_skipped"
  | "free_credit_reserve_succeeded"
  | "plus_credit_reserve_violation";
type Decision = "allow" | "deny" | "unavailable";
export type GuardTelemetryReason =
  | "allowed"
  | "family"
  | "user_weight"
  | "ip_weight"
  | "global_weight"
  | "ai_window"
  | "kill_switch"
  | "guard_unavailable"
  | "missing_principal";
const reasons: Record<Decision, readonly GuardTelemetryReason[]> = {
  allow: ["allowed"],
  deny: ["family", "user_weight", "ip_weight", "global_weight", "ai_window", "kill_switch"],
  unavailable: ["guard_unavailable", "missing_principal"],
};
const metrics: readonly Metric[] = [
  "guard_decision",
  "provider_attempt",
  "provider_success",
  "provider_failure",
  "provider_attempt_without_guard",
  "plus_credit_skipped",
  "free_credit_reserve_succeeded",
  "plus_credit_reserve_violation",
];
declare const observationBrand: unique symbol;
export type GuardObservation = { readonly [observationBrand]: true };
type State = {
  provider: Provider;
  family: Family;
  admitted: boolean;
  seen: Set<string>;
  env: Readonly<Record<string, unknown>> | undefined;
  complete: boolean;
};
const observations = new WeakMap<GuardObservation, State>();
const aiScopes = new WeakMap<object, Map<AiSurface, GuardObservation>>();

/** Opaque, in-memory only. Never keyed by identity, request ID or billing operation ID. */
export function newGuardObservation(
  provider: "google",
  family: GoogleBillingFamily,
): GuardObservation;
export function newGuardObservation(provider: "ai", family: AiSurface): GuardObservation;
export function newGuardObservation(provider: Provider, family: Family): GuardObservation {
  const observation = Object.freeze({}) as GuardObservation;
  observations.set(observation, {
    provider,
    family,
    admitted: false,
    seen: new Set(),
    env: getWorkerScope()?.env,
    complete: true,
  });
  return observation;
}

export function googleObservation(family: GoogleBillingFamily): GuardObservation {
  return newGuardObservation("google", family);
}

export function aiObservation(family: AiSurface): GuardObservation {
  const scope = getWorkerScope();
  if (!scope) return newGuardObservation("ai", family);
  let operations = aiScopes.get(scope);
  if (!operations) {
    operations = new Map();
    aiScopes.set(scope, operations);
  }
  let observation = operations.get(family);
  if (!observation) {
    observation = newGuardObservation("ai", family);
    operations.set(family, observation);
  }
  return observation;
}

/** Best effort observation, NOT an exactly-once billing ledger. No retry, network or raw logs. */
function emit(
  observation: GuardObservation,
  metric: Metric,
  decision: Decision | "" = "",
  reason: GuardTelemetryReason | "" = "",
): boolean {
  const state = observations.get(observation);
  if (!state) return false;
  try {
    const env = state.env;
    // No process-env fallback: these events require an actual Enforcement Worker binding.
    if (
      !env ||
      !Object.prototype.hasOwnProperty.call(env, "ABUSE_GUARD_ENFORCEMENT") ||
      !isAbuseGuardEnforcementOn(env)
    )
      return false;
    if (!metrics.includes(metric) || !validFamily(state.provider, state.family)) throw new Error();
    if (metric === "guard_decision") {
      if (!decision || !reasons[decision]?.includes(reason as GuardTelemetryReason))
        throw new Error();
      if (
        state.provider === "ai" &&
        ["family", "user_weight", "ip_weight", "global_weight"].includes(reason)
      )
        throw new Error();
      if (state.provider === "google" && reason === "ai_window") throw new Error();
    } else if (decision !== "" || reason !== "") throw new Error();
    if (metric.includes("credit") && state.provider !== "ai") throw new Error();
    const version = (env.WORKER_VERSION_METADATA as { id?: unknown } | undefined)?.id;
    if (
      typeof version !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version)
    )
      throw new Error();
    const binding = env.ABUSE_GUARD_ANALYTICS as
      | {
          writeDataPoint?: (point: {
            blobs: string[];
            doubles: number[];
            indexes: string[];
          }) => void;
        }
      | undefined;
    if (typeof binding?.writeDataPoint !== "function") throw new Error();
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    binding.writeDataPoint({
      blobs: [metric, state.provider, state.family, decision, reason, "enforcement", version, hour],
      doubles: [1],
      indexes: [version],
    });
    return true;
  } catch {
    state.complete = false;
    return false;
  }
}

function validFamily(provider: Provider, family: Family): boolean {
  if (typeof family !== "string") return false;
  return (
    (provider === "google" && Object.hasOwn(GOOGLE_FAMILY_LIMITS, family)) ||
    (provider === "ai" && Object.hasOwn(AI_FAIR_USE, family))
  );
}

export function observeGuardDecision(
  observation: GuardObservation,
  decision: Decision,
  reason: GuardTelemetryReason,
): boolean {
  const state = observations.get(observation);
  if (!state) return false;
  if (
    typeof decision !== "string" ||
    typeof reason !== "string" ||
    !Object.hasOwn(reasons, decision) ||
    !reasons[decision]?.includes(reason) ||
    !validFamily(state.provider, state.family)
  ) {
    state.complete = false;
    return false;
  }
  state.admitted = decision === "allow";
  const key = decision + ":" + reason;
  if (state.seen.has(key)) return false;
  state.seen.add(key);
  return emit(observation, "guard_decision", decision, reason);
}

/** Accept only a known primitive reason; never accept a DO result object. */
export function observeGuardRejection(observation: GuardObservation, reason: string): void {
  if (reasons.unavailable.includes(reason as GuardTelemetryReason))
    observeGuardDecision(observation, "unavailable", reason as GuardTelemetryReason);
  else if (reasons.deny.includes(reason as GuardTelemetryReason))
    observeGuardDecision(observation, "deny", reason as GuardTelemetryReason);
  else {
    const state = observations.get(observation);
    if (state) {
      state.admitted = false;
      state.complete = false;
    }
  }
}

/** Capture at the real fetch boundary; terminal callback remains safe after request scope ends. */
export function observeProviderAttempt(observation: GuardObservation): (success: boolean) => void {
  const state = observations.get(observation);
  if (state && !state.admitted) emit(observation, "provider_attempt_without_guard");
  emit(observation, "provider_attempt");
  let finished = false;
  return (success) => {
    if (finished) return;
    finished = true;
    emit(observation, success === true ? "provider_success" : "provider_failure");
  };
}

export function observeCredit(
  observation: GuardObservation,
  metric: "plus_credit_skipped" | "free_credit_reserve_succeeded" | "plus_credit_reserve_violation",
): void {
  const state = observations.get(observation);
  if (!state) return;
  if (
    ![
      "plus_credit_skipped",
      "free_credit_reserve_succeeded",
      "plus_credit_reserve_violation",
    ].includes(metric)
  ) {
    state.complete = false;
    return;
  }
  if (state.seen.has(metric)) return;
  state.seen.add(metric);
  emit(observation, metric);
}

/** Called at every instrumented reserve RPC boundary, using only the server entitlement boolean. */
export function observeCreditReserveAttempt(
  observation: GuardObservation,
  hasPlusAccess: boolean,
): void {
  if (hasPlusAccess === true) observeCredit(observation, "plus_credit_reserve_violation");
}

/** Local coverage only; true is not an acknowledgement of Analytics Engine delivery. */
export function telemetryCoverageComplete(observation: GuardObservation): boolean {
  return observations.get(observation)?.complete === true;
}
