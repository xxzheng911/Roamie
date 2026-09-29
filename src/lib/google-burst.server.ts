import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { fixedStatusResponse } from "@/lib/kill-switch.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { getWorkerScope, resolveTrustedIp } from "@/lib/worker-request-scope";

type RateBinding = { limit(input: { key: string }): Promise<{ success: boolean }> };

export async function checkGoogleProviderRate(
  env: CloudflareRuntimeEnv | undefined,
  key: string,
): Promise<boolean> {
  const binding = env?.GOOGLE_API_RATE_LIMITER as RateBinding | undefined;
  if (!binding?.limit) throw new Error("google_rate_limit_unavailable");
  try {
    return (await binding.limit({ key })).success;
  } catch {
    throw new Error("google_rate_limit_unavailable");
  }
}

export function resolveGoogleRuntimeEnv(
  contextEnv?: CloudflareRuntimeEnv,
): CloudflareRuntimeEnv | undefined {
  return getWorkerScope()?.env ?? contextEnv;
}

/** Burst layer. Daily authority is the AbuseGuard, and a completed burst is not charged again. */
export async function consumeGoogleBurst(
  env: CloudflareRuntimeEnv | undefined,
  userId: string,
  request?: Request,
): Promise<Response | null> {
  if (!isAbuseGuardEnforcementOn(env)) return null;
  const store = getWorkerScope();
  const ip = resolveTrustedIp(request);
  if (!userId || !ip) return fixedStatusResponse("google_unavailable");
  try {
    if (!store?.ipBurstDone) {
      if (!(await checkGoogleProviderRate(env, `google:ip:${ip}`))) return fixedStatusResponse("rate_limited", 60);
      if (store) store.ipBurstDone = true;
    }
    if (!store?.userBurstDone) {
      if (!(await checkGoogleProviderRate(env, `google:user:${userId}`))) {
        return fixedStatusResponse("rate_limited", 60);
      }
      if (store) store.userBurstDone = true;
    }
    return null;
  } catch {
    return fixedStatusResponse("google_unavailable");
  }
}
