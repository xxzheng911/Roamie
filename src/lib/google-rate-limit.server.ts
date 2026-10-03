import { createMiddleware } from "@tanstack/react-start";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import {
  checkGoogleProviderRate,
  resolveGoogleRuntimeEnv,
} from "@/lib/google-burst.server";
import { isKillSwitchOn } from "@/lib/kill-switch.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { getWorkerScope } from "@/lib/worker-request-scope";

export { checkGoogleProviderRate, consumeGoogleBurst, consumeGuestGoogleBurst, resolveGoogleRuntimeEnv } from "@/lib/google-burst.server";

/** Applied after Supabase auth to existing Google server functions, before any provider call. */
export const requireGoogleProviderRate = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const auth = context as unknown as {
      userId?: string;
      publicReadRateKey?: string;
      cloudflareEnv?: CloudflareRuntimeEnv;
    };
    const rateIdentity = auth.userId
      ? `google:user:${auth.userId}`
      : auth.publicReadRateKey
        ? `google:guest:${auth.publicReadRateKey}`
        : "";
    if (!rateIdentity) throw new Error("Unauthorized");
    const env = resolveGoogleRuntimeEnv(auth.cloudflareEnv);
    if (!isAbuseGuardEnforcementOn(env)) {
      if (!(await checkGoogleProviderRate(auth.cloudflareEnv, rateIdentity))) {
        throw new Error("Too Many Requests");
      }
      return next();
    }
    if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) throw new Error("google_unavailable");
    try {
      if (!(await checkGoogleProviderRate(env, rateIdentity))) {
        throw new Error("Too Many Requests");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Too Many Requests") throw error;
      throw new Error("google_unavailable");
    }
    const store = getWorkerScope();
    if (store && auth.userId) store.userBurstDone = true;
    if (store && !auth.userId) {
      store.ipBurstDone = true;
      store.guestBurstDone = true;
    }
    return next();
  },
);
