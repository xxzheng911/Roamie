import { readGoogleRequestJson } from "@/lib/google-request-body.server";
import { createClient } from "@supabase/supabase-js";
import { fetchGoogleRestProvider } from "@/lib/google-rest-provider.server";
import { googleRestRequest } from "@/lib/google-rest-contract";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
export async function authenticateGoogleRequest(
  request: Request,
  env: CloudflareRuntimeEnv,
): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length > 8192) return null;
  const url = env.SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== "string" || typeof key !== "string") throw new Error("auth_unavailable");
  const client = createClient(url.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, ""), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.getUser(auth.slice(7));
  return result.error ? null : (result.data.user?.id ?? null);
}
export async function handleGoogleProxy(
  request: Request,
  env: CloudflareRuntimeEnv,
  deps = { authenticate: authenticateGoogleRequest, provider: fetchGoogleRestProvider },
): Promise<Response> {
  const error = (code: string, status: number) =>
    Response.json(
      { error: code },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 429 ? { "Retry-After": "60" } : {}),
        },
      },
    );
  if (request.method !== "POST") return error("method_not_allowed", 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== "capacitor://localhost" && origin !== new URL(request.url).origin)
    return error("origin_forbidden", 403);
  if (!request.headers.get("authorization")?.startsWith("Bearer "))
    return error("unauthorized", 401);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return error("invalid_content_type", 415);
  try {
    const limiter = env.GOOGLE_API_RATE_LIMITER as Limiter | undefined;
    if (!limiter?.limit) return error("google_rate_limit_unavailable", 503);
    if (
      !(
        await limiter.limit({
          key: `google:ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`,
        })
      ).success
    )
      return error("rate_limited", 429);
    const userId = await deps.authenticate(request, env);
    if (!userId) return error("unauthorized", 401);
    if (!(await limiter.limit({ key: `google:user:${userId}` })).success)
      return error("rate_limited", 429);
    let input;
    try {
      input = await readGoogleRequestJson(request);
      googleRestRequest(input);
    } catch (failure) {
      return error("invalid_google_request", failure instanceof RangeError ? 413 : 400);
    }
    return await deps.provider(input, env);
  } catch {
    return error("google_proxy_unavailable", 503);
  }
}
