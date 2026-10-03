import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { admitAuthenticatedServerFunction } from "@/lib/abuse-guard.server";
import { checkRateLimit } from "@/lib/rate-limit.server";
import { bindVerifiedUserId, isProductionGuardRuntime, markPublicReadAuthorized, resolveTrustedIp } from "@/lib/worker-request-scope";

const GUEST_PUBLIC_READ_PER_MINUTE = 30;

export type PublicReadPrincipal =
  | { kind: "user"; userId: string; token: string; claims: Record<string, unknown> }
  | { kind: "guest"; rateKey: string };

function supabaseEnv(): { url: string; key: string } {
  const rawUrl = process.env.SUPABASE_URL;
  const url = rawUrl?.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "") ?? "";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) throw new Error("Unauthorized: auth unavailable");
  return { url, key };
}

function guestRateKey(request?: Request): string | null {
  const ip = resolveTrustedIp(request);
  if (ip) return ip;
  if (!isProductionGuardRuntime()) return "loopback";
  return null;
}

function admitGuestRate(rateKey: string): void {
  const slot = checkRateLimit(`public-read:${rateKey}`, GUEST_PUBLIC_READ_PER_MINUTE, 60_000);
  if (!slot.allowed) throw new Error("Too Many Requests");
  markPublicReadAuthorized(rateKey);
}

/**
 * Bearer present: verify the Supabase user and keep the existing user rate identity.
 * Bearer absent: anonymous public read keyed only by the trusted IP.
 * Invalid bearer is rejected. It is never downgraded to a guest.
 */
export async function resolvePublicReadPrincipal(request: Request): Promise<PublicReadPrincipal> {
  const authHeader = request.headers?.get("authorization") ?? "";
  if (authHeader) {
    if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: Only Bearer tokens are supported");
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new Error("Unauthorized: No token provided");
    const { url, key } = supabaseEnv();
    const supabase = createClient<Database>(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) throw new Error("Unauthorized: Invalid token");
    return {
      kind: "user",
      userId: data.claims.sub,
      token,
      claims: data.claims as Record<string, unknown>,
    };
  }
  const rateKey = guestRateKey(request);
  if (!rateKey) throw new Error("Unauthorized: public read unavailable");
  return { kind: "guest", rateKey };
}

type GuestPublicReadContext = {
  supabase: ReturnType<typeof createClient<Database>> | null;
  userId: string | null;
  claims: Record<string, unknown> | null;
  publicRead: boolean;
  publicReadRateKey: string | null;
};

/**
 * Read-only public capability. Does not grant AI, credits, or a user-scoped Supabase client.
 * Apply only to Places, weather, transit, route, and navigation reads.
 */
export const allowGuestPublicRead = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  if (!request) throw new Error("Unauthorized: No request headers available");
  const principal = await resolvePublicReadPrincipal(request);
  const context: GuestPublicReadContext =
    principal.kind === "user"
      ? await (async () => {
          const { url, key } = supabaseEnv();
          const supabase = createClient<Database>(url, key, {
            global: { headers: { Authorization: `Bearer ${principal.token}` } },
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          });
          bindVerifiedUserId(principal.userId);
          await admitAuthenticatedServerFunction(principal.userId);
          return {
            supabase,
            userId: principal.userId,
            claims: principal.claims,
            publicRead: false,
            publicReadRateKey: null,
          };
        })()
      : (() => {
          admitGuestRate(principal.rateKey);
          return {
            supabase: null,
            userId: null,
            claims: null,
            publicRead: true,
            publicReadRateKey: principal.rateKey,
          };
        })();
  return next({ context });
});
