import { getWorkerScope } from "@/lib/worker-request-scope";

const ENFORCEMENT = "ABUSE_GUARD_ENFORCEMENT";
const ENABLED = new Set(["1", "true"]);

function readFlag(source: object | null | undefined): { present: boolean; value: unknown } {
  if (!source || !Object.prototype.hasOwnProperty.call(source, ENFORCEMENT)) {
    return { present: false, value: undefined };
  }
  return { present: true, value: (source as Record<string, unknown>)[ENFORCEMENT] };
}

function enabled(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return typeof value === "string" && ENABLED.has(value);
}

/**
 * Worker env only. Unset, "0", and "false" keep the pre-migration request path.
 * "1" and "true" enable the full AbuseGuard fail-closed path.
 * Request headers and client bundles are not a source for this flag.
 */
export function isAbuseGuardEnforcementOn(
  explicit?: Readonly<Record<string, unknown>> | null,
): boolean {
  const fromExplicit = readFlag(explicit);
  if (fromExplicit.present) return enabled(fromExplicit.value);
  const fromScope = readFlag(getWorkerScope()?.env);
  if (fromScope.present) return enabled(fromScope.value);
  const fromProcess = readFlag(process.env);
  if (fromProcess.present) return enabled(fromProcess.value);
  return false;
}
