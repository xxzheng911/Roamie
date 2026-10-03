import { newGuardObservation } from "@/lib/abuse-guard-telemetry.server";
import { billingFamilyFromUrl } from "@/lib/abuse-guard-policy";
import { readGoogleRequestJson } from "@/lib/google-request-body.server";
import { createClient } from "@supabase/supabase-js";
import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { authorizeGoogleSpec, authorizeGuestGoogleSpec, googleOperationId } from "@/lib/abuse-guard.server";
import { fetchGoogleRestProvider } from "@/lib/google-rest-provider.server";
import { googleRestRequest } from "@/lib/google-rest-contract";
import { consumeGoogleBurst, consumeGuestGoogleBurst } from "@/lib/google-burst.server";
import { fixedStatusResponse, isKillSwitchOn } from "@/lib/kill-switch.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import {
  bindIncomingRequest,
  markPublicReadAuthorized,
  resolveTrustedIp,
  runWithVerifiedPrincipal,
  withGoogleOperation,
} from "@/lib/worker-request-scope";

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

type GoogleProxyDeps = {
  authenticate: typeof authenticateGoogleRequest;
  provider: typeof fetchGoogleRestProvider;
};

function handleLegacyGoogleProxy(
  request: Request,
  env: CloudflareRuntimeEnv,
  deps: GoogleProxyDeps,
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
  if (request.method !== "POST") return Promise.resolve(error("method_not_allowed", 405));
  const origin = request.headers.get("origin");
  if (origin && origin !== "capacitor://localhost" && origin !== new URL(request.url).origin)
    return Promise.resolve(error("origin_forbidden", 403));
  const legacyAuth = request.headers.get("authorization");
  if (legacyAuth && !legacyAuth.startsWith("Bearer "))
    return Promise.resolve(error("unauthorized", 401));
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Promise.resolve(error("invalid_content_type", 415));
  const limiter = env.GOOGLE_API_RATE_LIMITER as
    | { limit(input: { key: string }): Promise<{ success: boolean }> }
    | undefined;
  return (async () => {
    try {
      if (!limiter?.limit) return error("google_rate_limit_unavailable", 503);
      if (
        !(
          await limiter.limit({
            key: `google:ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`,
          })
        ).success
      )
        return error("rate_limited", 429);
      const presentedAuth = Boolean(request.headers.get("authorization"));
      const userId = presentedAuth ? await deps.authenticate(request, env) : null;
      if (presentedAuth && !userId) return error("unauthorized", 401);
      let guestIp: string | null = null;
      if (!userId) {
        guestIp = resolveTrustedIp(request);
        if (!guestIp) return error("unauthorized", 401);
        markPublicReadAuthorized(guestIp);
        if (!(await limiter.limit({ key: `google:guest:${guestIp}` })).success)
          return error("rate_limited", 429);
      } else if (!(await limiter.limit({ key: `google:user:${userId}` })).success) {
        return error("rate_limited", 429);
      }
      let input;
      let spec: ReturnType<typeof googleRestRequest>;
      try {
        input = await readGoogleRequestJson(request);
        spec = googleRestRequest(input);
      } catch (failure) {
        return error("invalid_google_request", failure instanceof RangeError ? 413 : 400);
      }
      if (guestIp) {
        const operationId = await googleOperationId(spec, request);
        return withGoogleOperation(operationId, async () => {
          markPublicReadAuthorized(guestIp);
          const denied = await authorizeGuestGoogleSpec(spec, env, request);
          if (denied) return denied;
          return deps.provider(input, env);
        });
      }
      return await deps.provider(input, env);
    } catch {
      return error("google_proxy_unavailable", 503);
    }
  })();
}

export async function handleGoogleProxy(
  request: Request,
  env: CloudflareRuntimeEnv,
  deps = { authenticate: authenticateGoogleRequest, provider: fetchGoogleRestProvider },
): Promise<Response> {
  if (!isAbuseGuardEnforcementOn(env)) return handleLegacyGoogleProxy(request, env, deps);
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
  const presentedAuth = request.headers.get("authorization");
  if (presentedAuth && !presentedAuth.startsWith("Bearer ")) return error("unauthorized", 401);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return error("invalid_content_type", 415);
  try {
    const userId = presentedAuth ? await deps.authenticate(request, env) : null;
    if (presentedAuth && !userId) return error("unauthorized", 401);
    if (!userId) {
      const ip = resolveTrustedIp(request);
      if (!ip) return error("unauthorized", 401);
      markPublicReadAuthorized(ip);
      bindIncomingRequest(request);
      if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) return fixedStatusResponse("google_unavailable");
      let input: unknown;
      let spec: ReturnType<typeof googleRestRequest>;
      try {
        input = await readGoogleRequestJson(request);
        spec = googleRestRequest(input);
      } catch (failure) {
        return error("invalid_google_request", failure instanceof RangeError ? 413 : 400);
      }
      const burst = await consumeGuestGoogleBurst(env, request);
      if (burst) return burst;
      const observation = newGuardObservation("google", billingFamilyFromUrl(spec.url));
      const operationId = await googleOperationId(spec, request);
      return withGoogleOperation(operationId, async () => {
        const denied = await authorizeGuestGoogleSpec(spec, env, request, observation);
        if (denied) return denied;
        return deps.provider(input, env, undefined, observation);
      });
    }
    return await runWithVerifiedPrincipal(userId, async () => {
      bindIncomingRequest(request);
      if (isKillSwitchOn(env, "DISABLE_GOOGLE_PROXY")) return fixedStatusResponse("google_unavailable");
      let input: unknown;
      let spec: ReturnType<typeof googleRestRequest>;
      try {
        input = await readGoogleRequestJson(request);
        spec = googleRestRequest(input);
      } catch (failure) {
        return error("invalid_google_request", failure instanceof RangeError ? 413 : 400);
      }
      const burst = await consumeGoogleBurst(env, userId, request);
      if (burst) return burst;
      const observation = newGuardObservation("google", billingFamilyFromUrl(spec.url));
      const operationId = await googleOperationId(spec, request);
      return withGoogleOperation(operationId, async () => {
        const denied = await authorizeGoogleSpec(spec, env, request, observation);
        if (denied) return denied;
        return deps.provider(input, env, undefined, observation);
      });
    });
  } catch {
    return fixedStatusResponse("google_unavailable");
  }
}
