/**
 * Server-side rate limit helper (Cloudflare Workers / edge compatible stub).
 * Wire to KV / Durable Objects in production.
 */

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSec: number };

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
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

/** AI chat — align with FREE_TIER_LIMITS on client; enforce server-side in /api/roamie */
export const AI_RATE_LIMITS = {
  chatPerMinute: 8,
  chatPerDay: 120,
  itineraryPerDay: 10,
} as const;
