import { devVerboseInfo } from "@/lib/dev-verbose-log";

/** Places API 快取 TTL 與節流常數（全 app 共用） */
export const PLACES_SEARCH_CACHE_TTL_MS = 20 * 60 * 1000;
export const PLACES_NEARBY_CACHE_TTL_MS = 30 * 60 * 1000;
export const PLACES_FAILED_CACHE_TTL_MS = 10 * 60 * 1000;
export const PLACES_RAW_POOL_TTL_MS = 30 * 60 * 1000;
export const PLACES_HOME_LOAD_TTL_MS = 10 * 60 * 1000;
/** 首頁附近地點顯示快取 TTL（localStorage） */
export const PLACES_HOME_DISPLAY_TTL_MS = 10 * 60 * 1000;
/** 同城市小位移內不強制重載（公尺） */
export const PLACES_HOME_REFRESH_MOVE_M = 2000;
export const PLACES_MIN_LOCATION_MOVE_M = 500;

const RATE_WINDOW_MS = 60_000;
/** Soft client budget — wait for window, never hard-fail mid-generation. */
const RATE_MAX_CALLS = 20;
const MAX_RETRIES = 2;
const MAX_CONCURRENT = 2;
const BACKOFF_MS = [1000, 2000] as const;

const pending = new Map<string, Promise<unknown>>();
/** Per-requestKey cooldown — identical blocked requests must not re-hit the API. */
const blockedUntilByKey = new Map<string, number>();
const recentCallAt: number[] = [];
const retryCount = new Map<string, number>();

let activeCount = 0;
const concurrencyWaiters: Array<() => void> = [];

/** Pause new Places requests until this timestamp (rate-limit cooldown). */
let generationCooldownUntil = 0;
let activeGenerationRequestId: string | null = null;

/** Log dedupe: only print blocked once per key+blockedUntil window. */
let lastLoggedBlocked: { key: string; until: number } | null = null;
let lastLoggedSkipped: { key: string; until: number } | null = null;

const callStats = {
  text: 0,
  nearby: 0,
  details: 0,
  photo: 0,
  other: 0,
  blocked: 0,
  retried: 0,
  textRequests: 0,
  textSuccess: 0,
  textRateLimited: 0,
  detailRequests: 0,
  detailSuccess: 0,
  detailFailed: 0,
  retryCount: 0,
  searchRetryCount: 0,
  detailRetryCount: 0,
  cacheHits: 0,
  resolvedPlaces: 0,
  unresolvedPlaces: 0,
};

const loggedKeys = new Set<string>();

function logOnce(key: string, line: string): void {
  if (loggedKeys.has(key)) return;
  loggedKeys.add(key);
  devVerboseInfo(line);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number): number {
  return ms + Math.floor(Math.random() * 250);
}

export function logPlacesApiCall(type: string, key: string): void {
  devVerboseInfo(`[PLACES_API_CALL] type=${type} key=${key}`);
}

export function logPlacesCacheHit(key: string): void {
  callStats.cacheHits += 1;
  logOnce(`hit:${key}`, `[PLACES_CACHE_HIT] key=${key}`);
}

export function logPlacesCacheMiss(key: string): void {
  logOnce(`miss:${key}`, `[PLACES_CACHE_MISS] key=${key}`);
}

export function logPlacesDedupePending(key: string): void {
  logOnce(`pending:${key}`, `[PLACES_DEDUPE_PENDING] key=${key}`);
  logOnce(
    `deduped:${key}:${activeGenerationRequestId ?? ""}`,
    `[PLACES_REQUEST_DEDUPED] requestKey=${key}` +
      (activeGenerationRequestId ? ` generationRequestId=${activeGenerationRequestId}` : ""),
  );
}

export function logPlacesRateLimitBlocked(key: string, blockedUntil?: number): void {
  const until = blockedUntil ?? generationCooldownUntil;
  if (lastLoggedBlocked?.key === key && lastLoggedBlocked.until === until && until > 0) {
    return;
  }
  lastLoggedBlocked = { key, until };
  callStats.blocked += 1;
  callStats.textRateLimited += 1;
  devVerboseInfo(
    `[PLACES_RATE_LIMIT_BLOCKED] requestKey=${key}` +
      ` blockedUntil=${until}` +
      (activeGenerationRequestId ? ` generationRequestId=${activeGenerationRequestId}` : ""),
  );
}

function logPlacesRequestSkipped(key: string, blockedUntil: number): void {
  if (lastLoggedSkipped?.key === key && lastLoggedSkipped.until === blockedUntil) {
    return;
  }
  lastLoggedSkipped = { key, until: blockedUntil };
  devVerboseInfo(`[PLACES_REQUEST_SKIPPED] reason=active_cooldown requestKey=${key}`);
}

export function logPlacesSkipSmallLocationChange(distanceM: number): void {
  logOnce(`loc:${distanceM}`, `[PLACES_SKIP_SMALL_LOCATION_CHANGE] distance=${distanceM}`);
}

function pruneRateWindow(now: number): void {
  while (recentCallAt.length > 0 && recentCallAt[0]! < now - RATE_WINDOW_MS) {
    recentCallAt.shift();
  }
}

export function isPlacesRateLimited(now = Date.now()): boolean {
  if (now < generationCooldownUntil) return true;
  pruneRateWindow(now);
  return recentCallAt.length >= RATE_MAX_CALLS;
}

/**
 * When Google (or our budget) rate-limits, pause the whole generation queue.
 * Prefer Retry-After when provided; otherwise ~1s then ~2s with jitter.
 */
export function notePlacesRateLimited(opts?: {
  retryAfterMs?: number;
  attemptIndex?: number;
  generationRequestId?: string;
  requestKey?: string;
}): void {
  const attempt = opts?.attemptIndex ?? 0;
  const fallback = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 2000;
  const wait = withJitter(
    opts?.retryAfterMs != null && opts.retryAfterMs > 0 ? opts.retryAfterMs : fallback,
  );
  const until = Date.now() + wait;
  generationCooldownUntil = Math.max(generationCooldownUntil, until);
  callStats.textRateLimited += 1;
  if (opts?.generationRequestId) {
    activeGenerationRequestId = opts.generationRequestId;
  }
  if (opts?.requestKey) {
    blockedUntilByKey.set(
      opts.requestKey,
      Math.max(blockedUntilByKey.get(opts.requestKey) ?? 0, until),
    );
  }
  devVerboseInfo(
    `[PLACES_COOLDOWN_STARTED] blockedUntil=${generationCooldownUntil} waitMs=${wait}` +
      (activeGenerationRequestId ? ` generationRequestId=${activeGenerationRequestId}` : ""),
  );
  // Keep legacy alias for older log greps
  logOnce(
    `cooldown:${generationCooldownUntil}`,
    `[PLACES_GENERATION_COOLDOWN] waitMs=${wait} until=${generationCooldownUntil}` +
      (activeGenerationRequestId ? ` generationRequestId=${activeGenerationRequestId}` : ""),
  );
  // Cost protection: stop new Places + no retry — force Candidate Pool / caches
  void import("@/lib/ai/places-cost-cache/rate-protection").then((m) => {
    m.activatePlacesRateProtection({
      reason: "PLACES_RATE_LIMIT_BLOCKED",
      ttlMs: Math.max(wait, 30_000),
    });
  });
}

export async function waitForPlacesGenerationCooldown(): Promise<void> {
  while (Date.now() < generationCooldownUntil) {
    await sleep(Math.min(generationCooldownUntil - Date.now(), 2000));
  }
}

export function beginPlacesGenerationSession(generationRequestId: string): void {
  activeGenerationRequestId = generationRequestId;
  generationCooldownUntil = 0;
  blockedUntilByKey.clear();
  lastLoggedBlocked = null;
  lastLoggedSkipped = null;
  resetPlacesApiCallStats();
  retryCount.clear();
  loggedKeys.clear();
  // New user submission must not inherit prior sticky rate-limit skips.
  void import("@/lib/places-classic-landmark-cache").then((m) => {
    m.resetPlacesRateLimitEncountered();
  });
  void import("@/lib/ai/places-cost-cache/rate-protection").then((m) => {
    m.clearPlacesRateProtection();
  });
}

export function getActivePlacesGenerationRequestId(): string | null {
  return activeGenerationRequestId;
}

function recordPlacesApiCall(now = Date.now()): void {
  pruneRateWindow(now);
  recentCallAt.push(now);
}

export function canRetryPlacesRequest(key: string): boolean {
  // Rate protection / active cooldown: never retry — callers must use cache.
  if (isPlacesRateLimited()) return false;
  const n = retryCount.get(key) ?? 0;
  return n < MAX_RETRIES;
}

export function markPlacesRequestRetried(
  key: string,
  kind: "search" | "detail" | "throw" = "throw",
): void {
  callStats.retried += 1;
  callStats.retryCount += 1;
  if (kind === "search") callStats.searchRetryCount += 1;
  else if (kind === "detail") callStats.detailRetryCount += 1;
  retryCount.set(key, (retryCount.get(key) ?? 0) + 1);
}

export function markPlacesResolved(resolved: boolean): void {
  if (resolved) callStats.resolvedPlaces += 1;
  else callStats.unresolvedPlaces += 1;
}

function bumpCallStat(type: string): void {
  const t = type.toLowerCase();
  if (t.includes("text") || t === "searchtext") {
    callStats.text += 1;
    callStats.textRequests += 1;
  } else if (t.includes("nearby")) {
    callStats.nearby += 1;
  } else if (t.includes("detail")) {
    callStats.details += 1;
    callStats.detailRequests += 1;
  } else if (t.includes("photo")) {
    callStats.photo += 1;
  } else {
    callStats.other += 1;
  }
}

export function markPlacesTextSuccess(): void {
  callStats.textSuccess += 1;
}

export function markPlacesDetailOutcome(ok: boolean): void {
  if (ok) callStats.detailSuccess += 1;
  else callStats.detailFailed += 1;
}

export function getPlacesApiCallStats(): Readonly<typeof callStats> {
  return { ...callStats };
}

export function resetPlacesApiCallStats(): void {
  callStats.text = 0;
  callStats.nearby = 0;
  callStats.details = 0;
  callStats.photo = 0;
  callStats.other = 0;
  callStats.blocked = 0;
  callStats.retried = 0;
  callStats.textRequests = 0;
  callStats.textSuccess = 0;
  callStats.textRateLimited = 0;
  callStats.detailRequests = 0;
  callStats.detailSuccess = 0;
  callStats.detailFailed = 0;
  callStats.retryCount = 0;
  callStats.searchRetryCount = 0;
  callStats.detailRetryCount = 0;
  callStats.cacheHits = 0;
  callStats.resolvedPlaces = 0;
  callStats.unresolvedPlaces = 0;
}

export function logPlacesApiCallStats(label = "generation"): void {
  devVerboseInfo(
    `[PLACES_API_STATS] label=${label}` +
      ` text=${callStats.text}` +
      ` textRequests=${callStats.textRequests}` +
      ` textSuccess=${callStats.textSuccess}` +
      ` textRateLimited=${callStats.textRateLimited}` +
      ` nearby=${callStats.nearby}` +
      ` details=${callStats.details}` +
      ` detailRequests=${callStats.detailRequests}` +
      ` detailSuccess=${callStats.detailSuccess}` +
      ` detailFailed=${callStats.detailFailed}` +
      ` photo=${callStats.photo}` +
      ` other=${callStats.other}` +
      ` blocked=${callStats.blocked}` +
      ` retried=${callStats.retried}` +
      ` retryCount=${callStats.retryCount}` +
      ` searchRetry=${callStats.searchRetryCount}` +
      ` detailRetry=${callStats.detailRetryCount}` +
      ` cacheHits=${callStats.cacheHits}` +
      ` resolvedPlaces=${callStats.resolvedPlaces}` +
      ` unresolvedPlaces=${callStats.unresolvedPlaces}`,
  );
}

async function acquireConcurrencySlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    concurrencyWaiters.push(resolve);
  });
  activeCount += 1;
}

function releaseConcurrencySlot(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = concurrencyWaiters.shift();
  if (next) next();
}

/** Wait until under rate window / generation cooldown — log blocked at most once. */
async function waitForRateWindow(key: string): Promise<"ready" | "cooldown"> {
  let rounds = 0;
  let logged = false;
  while (isPlacesRateLimited()) {
    if (!logged) {
      logPlacesRateLimitBlocked(key, generationCooldownUntil || Date.now() + 1000);
      logged = true;
    }
    await waitForPlacesGenerationCooldown();
    pruneRateWindow(Date.now());
    if (!isPlacesRateLimited()) break;

    const oldest = recentCallAt[0];
    const untilClear = oldest
      ? Math.max(200, oldest + RATE_WINDOW_MS - Date.now())
      : BACKOFF_MS[Math.min(rounds, BACKOFF_MS.length - 1)]!;
    await sleep(withJitter(Math.min(untilClear, 5000)));
    rounds += 1;
    // Cap total wait ~45s then give up for this key.
    if (rounds > 12) {
      const until = Date.now() + withJitter(BACKOFF_MS[1]!);
      blockedUntilByKey.set(key, until);
      logPlacesRateLimitBlocked(key, until);
      return "cooldown";
    }
  }
  return "ready";
}

/**
 * Same requestKey shares in-flight Promise.
 * Concurrency capped at 2; rate window waited (with exponential backoff), not hard-failed immediately.
 * Max throw-retries per key: 2 (attempts = 1 + MAX_RETRIES).
 */
export async function runPlacesApiDeduped<T>(
  key: string,
  type: string,
  runner: () => Promise<T>,
): Promise<T | null> {
  const now = Date.now();

  // Rate protection → stop new Places (force cache)
  try {
    const { shouldBlockNewPlacesCalls } = await import("@/lib/ai/places-cost-cache");
    if (shouldBlockNewPlacesCalls({ query: key, logSkip: true })) {
      return null;
    }
  } catch {
    /* ignore */
  }

  const keyBlockedUntil = blockedUntilByKey.get(key) ?? 0;
  if (now < keyBlockedUntil) {
    logPlacesRequestSkipped(key, keyBlockedUntil);
    return null;
  }

  const inflight = pending.get(key);
  if (inflight) {
    logPlacesDedupePending(key);
    return inflight as Promise<T>;
  }

  // 5s same-query cooldown (after in-flight share so concurrent callers still join)
  try {
    const {
      isPlacesQueryOnCooldown,
      logPlacesSearchSkipped,
      PLACES_QUERY_COOLDOWN_MS,
    } = await import("@/lib/ai/places-cost-cache");
    if (isPlacesQueryOnCooldown(key)) {
      logPlacesSearchSkipped({
        reason: "query_cooldown",
        query: key,
        cooldownMs: PLACES_QUERY_COOLDOWN_MS,
      });
      return null;
    }
  } catch {
    /* ignore */
  }

  const promise = (async () => {
    const waitResult = await waitForRateWindow(key);
    if (waitResult === "cooldown" || isPlacesRateLimited()) {
      const until = Math.max(generationCooldownUntil, Date.now() + BACKOFF_MS[0]!);
      blockedUntilByKey.set(key, until);
      logPlacesRateLimitBlocked(key, until);
      notePlacesRateLimited({ attemptIndex: 0, requestKey: key });
      return null;
    }

    await acquireConcurrencySlot();
    try {
      logPlacesApiCall(type, key);
      bumpCallStat(type);
      recordPlacesApiCall();
      void import("@/lib/ai/places-cost-cache").then((m) => {
        m.notePlacesQueryCooldown(key);
      });

      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          const result = await runner();
          const t = type.toLowerCase();
          if (t.includes("text") || t === "searchtext") markPlacesTextSuccess();
          if (t.includes("detail")) markPlacesDetailOutcome(result != null);
          return result;
        } catch (error) {
          lastError = error;
          const msg = error instanceof Error ? error.message : String(error);
          const isRate =
            /429|503|places_http_429|places_http_503|places_details_http_429|rate.?limit/i.test(
              msg,
            );
          if (isRate) {
            const retryAfterMatch = msg.match(/retry[_-]?after[=:\s]+(\d+)/i);
            const retryAfterMs = retryAfterMatch
              ? Number(retryAfterMatch[1]) * (Number(retryAfterMatch[1]) < 100 ? 1000 : 1)
              : undefined;
            notePlacesRateLimited({
              retryAfterMs,
              attemptIndex: attempt,
              requestKey: key,
            });
            // No retry under rate protection — stop immediately
            break;
          }
          if (attempt >= MAX_RETRIES || !canRetryPlacesRequest(`${key}:throw`)) {
            if (isRate) {
              logOnce(
                `retry_limit:${key}`,
                `[PLACES_RETRY_LIMIT_REACHED] requestKey=${key}`,
              );
            }
            break;
          }
          markPlacesRequestRetried(
            `${key}:throw`,
            type.toLowerCase().includes("detail") ? "detail" : "search",
          );
          const delay = withJitter(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!);
          await sleep(delay);
          await waitForPlacesGenerationCooldown();
        }
      }
      if (type.toLowerCase().includes("detail")) markPlacesDetailOutcome(false);
      if (lastError) throw lastError;
      return null;
    } finally {
      releaseConcurrencySlot();
    }
  })().finally(() => {
    pending.delete(key);
  });

  pending.set(key, promise);
  return promise;
}

export function buildPlacesHttpKey(
  type: string,
  parts: Record<string, string | number | undefined>,
): string {
  return `${type}:${Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;
}

export { MAX_CONCURRENT as PLACES_API_MAX_CONCURRENT, MAX_RETRIES as PLACES_API_MAX_RETRIES };
