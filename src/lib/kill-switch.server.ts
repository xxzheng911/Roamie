const ENABLED = new Set(["1", "true"]);

export type KillSwitchName =
  | "DISABLE_GOOGLE_PROXY"
  | "DISABLE_AI"
  | "DISABLE_UNSPLASH_PROXY"
  | "DISABLE_SUBSCRIPTION_SYNC";

/** Worker env only. Request headers are not consulted. */
export function isKillSwitchOn(
  env: Readonly<Record<string, unknown>> | undefined,
  name: KillSwitchName,
): boolean {
  const raw = env?.[name] ?? process.env[name];
  if (raw === true || raw === 1) return true;
  return typeof raw === "string" && ENABLED.has(raw);
}

export function fixedStatusResponse(
  code: "google_unavailable" | "ai_unavailable" | "sync_unavailable" | "rate_limited",
  retryAfterSec?: number,
): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (code === "rate_limited") headers.set("Retry-After", String(Math.max(1, retryAfterSec ?? 60)));
  return Response.json({ error: code }, { status: code === "rate_limited" ? 429 : 503, headers });
}

/**
 * Server authority for a future Unsplash proxy.
 * Published clients still call api.unsplash.com directly; this does not stop them.
 */
export function unsplashProxyDisabledResponse(
  env: Readonly<Record<string, unknown>> | undefined,
): Response | null {
  if (!isKillSwitchOn(env, "DISABLE_UNSPLASH_PROXY")) return null;
  return Response.json(
    { error: "service_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
