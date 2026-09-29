import { createMiddleware } from "@tanstack/react-start";
import {
  checkGoogleProviderRate,
  resolveGoogleRuntimeEnv,
} from "@/lib/google-burst.server";
import { isKillSwitchOn } from "@/lib/kill-switch.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { getWorkerScope } from "@/lib/worker-request-scope";

export { checkGoogleProviderRate, consumeGoogleBurst, resolveGoogleRuntimeEnv } from "@/lib/google-burst.server";

/** Applied after Supabase auth to existing Google server functions, before any provider call. */
export const requireGoogleProviderRate = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const auth = context as unknown as { userId?: string; cloudflareEnv?: CloudflareRuntimeEnv };
    if (!auth.userId) throw new Error("Unauthorized");
    const env = resolveGoogleRuntimeEnv(auth.cloudflareEnv);
    if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) throw new Error("google_unavailable");
    try {
      if (!(await checkGoogleProviderRate(env, `google:user:${auth.userId}`))) {
        throw new Error("Too Many Requests");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "Too Many Requests") throw error;
      throw new Error("google_unavailable");
    }
    const store = getWorkerScope();
    if (store) store.userBurstDone = true;
    return next();
  },
);
