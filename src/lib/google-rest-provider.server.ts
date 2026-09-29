import { isAbuseGuardEnforcementOn } from "@/lib/abuse-guard-enforcement.server";
import { authorizeGoogleSpec, runtimeGuardEnv } from "@/lib/abuse-guard.server";
import { googleRestRequest } from "@/lib/google-rest-contract";
import { consumeGoogleBurst } from "@/lib/google-burst.server";
import { requireGoogleServerKey } from "@/lib/google-maps-key-resolve.server";
import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";
import { resolveTrustedUserId } from "@/lib/worker-request-scope";

/** All upstream failures are opaque; no Google error body/URL/credential reaches logs or clients. */
export async function fetchGoogleRestProvider(
  input: unknown,
  env?: CloudflareRuntimeEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let spec;
  try {
    spec = googleRestRequest(input);
  } catch {
    return Response.json({ error: "invalid_google_request" }, { status: 400 });
  }
  const envForGuard = runtimeGuardEnv(env);
  if (isAbuseGuardEnforcementOn(envForGuard)) {
    const burst = await consumeGoogleBurst(envForGuard, resolveTrustedUserId() ?? "");
    if (burst) return burst;
    const denied = await authorizeGoogleSpec(spec, envForGuard);
    if (denied) return denied;
  }
  let key;
  try {
    key = requireGoogleServerKey(spec.family, envForGuard);
  } catch {
    return Response.json({ error: "google_credential_unavailable" }, { status: 503 });
  }
  const url = new URL(spec.url);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (spec.family === "geocoding" || url.pathname.includes("/directions/json"))
    url.searchParams.set("key", key);
  else headers["X-Goog-Api-Key"] = key;
  if (spec.fields) headers["X-Goog-FieldMask"] = spec.fields;
  try {
    const response = await fetcher(url.toString(), {
      method: spec.method,
      headers,
      body: spec.body == null ? undefined : JSON.stringify(spec.body),
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    if (!response.ok) {
      const status = response.status === 400 ? 400 : response.status === 429 ? 429 : 502;
      return Response.json(
        {
          error: {
            status:
              status === 400
                ? "INVALID_ARGUMENT"
                : status === 429
                  ? "RESOURCE_EXHAUSTED"
                  : "UPSTREAM_UNAVAILABLE",
            message: "google_upstream_unavailable",
          },
        },
        { status },
      );
    }
    const json = await response.json();
    if (json?.error || (json?.status && !["OK", "ZERO_RESULTS"].includes(json.status)))
      return Response.json({ error: "google_upstream_unavailable" }, { status: 502 });
    const safe = JSON.stringify(json)
      .split(key)
      .join("<REDACTED>")
      .replace(/AIza[\w-]{20,}/g, "<REDACTED>");
    return new Response(safe, {
      headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "google_upstream_unavailable" }, { status: 502 });
  }
}
