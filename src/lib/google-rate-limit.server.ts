import { createMiddleware } from "@tanstack/react-start";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

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
/** Applied after Supabase auth to existing Google server functions, before any provider call. */
export const requireGoogleProviderRate = createMiddleware({ type: "function" }).server(
  async ({ next, context }) => {
    const auth = context as unknown as { userId?: string; cloudflareEnv?: CloudflareRuntimeEnv };
    if (!auth.userId) throw new Error("Unauthorized");
    if (!(await checkGoogleProviderRate(auth.cloudflareEnv, `google:user:${auth.userId}`)))
      throw new Error("Too Many Requests");
    return next();
  },
);
