import type { CloudflareRuntimeEnv } from "@/lib/server-request-context";

const ACCESS_KEY_ENV = "UNSPLASH_ACCESS_KEY";

/**
 * Server runtime authority for Unsplash.
 * Dynamic lookup only: do not read public client env and do not inline a build-time value.
 */
export function resolveUnsplashAccessKey(runtimeEnv?: CloudflareRuntimeEnv): string | null {
  const raw = runtimeEnv?.[ACCESS_KEY_ENV] ?? process.env[ACCESS_KEY_ENV];
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}
