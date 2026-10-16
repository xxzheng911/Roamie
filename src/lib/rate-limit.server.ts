/**
 * Server-side rate limit helper.
 *
 * Production（Cloudflare Workers）：使用 wrangler.jsonc 的 `ratelimits` binding，
 * 計數在同一 Cloudflare 機房內共用（不再是每個 isolate 各自一份 Map）。
 * Dev / 無 binding：fallback 到記憶體計數。
 */

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

/** wrangler.jsonc `ratelimits[].name` — limit / period 需與 wrangler.jsonc 一致 */
export type RateLimitBindingName =
  | "AI_CHAT_RATE_LIMITER"
  | "PLACE_IMAGE_RATE_LIMITER"
  | "DESTINATION_COVER_RATE_LIMITER";

type RateLimitBinding = { limit: (options: { key: string }) => Promise<{ success: boolean }> };

const buckets = new Map<string, { count: number; resetAt: number }>();

let workerEnvPromise: Promise<Record<string, unknown> | null> | undefined;

function getWorkerEnv(): Promise<Record<string, unknown> | null> {
  if (!workerEnvPromise) {
    const moduleId = "cloudflare:workers";
    workerEnvPromise = import(/* @vite-ignore */ moduleId)
      .then((m: { env?: Record<string, unknown> }) => m.env ?? null)
      .catch(() => null);
  }
  return workerEnvPromise;
}

function checkMemoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true };
}

export async function checkRateLimit(
  binding: RateLimitBindingName,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const env = await getWorkerEnv();
  const limiter = env?.[binding] as RateLimitBinding | undefined;
  if (limiter && typeof limiter.limit === "function") {
    try {
      const { success } = await limiter.limit({ key });
      return success
        ? { allowed: true }
        : { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000) };
    } catch (e) {
      console.warn("[rate-limit] binding failed, falling back to memory", binding, e);
    }
  }
  return checkMemoryRateLimit(`${binding}:${key}`, limit, windowMs);
}

/** Abuse prevention only — not product tier limits. @see docs/PRODUCT_ARCHITECTURE.md */
export const AI_RATE_LIMITS = {
  chatPerMinute: 8,
  chatPerDay: 120,
  itineraryPerDay: 10,
} as const;
