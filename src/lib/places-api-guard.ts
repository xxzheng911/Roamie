import {
  exploreSessionCanRequest,
  type ExploreRequestSession,
} from "@/lib/explore-request-session";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { shouldRetryPlacesFailure } from "@/lib/network-connectivity";

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
/**
 * One new foreground user action may finish while the shared window is already hot.
 * This does not raise the global threshold. A third hot-window grant is runaway.
 */
export const FOREGROUND_REQUEST_PROVIDER_BUDGET = 4;
export const MAX_FOREGROUND_GRANTS_WHILE_HOT = 2;
const MAX_RETRIES = 2;
const MAX_CONCURRENT = 2;
const BACKGROUND_WINDOW_BUDGET = RATE_MAX_CALLS - FOREGROUND_REQUEST_PROVIDER_BUDGET;
const pendingSignals = new Map<string, AbortSignal | undefined>();
const BACKOFF_MS = [1000, 2000] as const;

const pending = new Map<string, Promise<unknown>>();
/** Per-requestKey cooldown — identical blocked requests must not re-hit the API. */
const blockedUntilByKey = new Map<string, number>();
const recentCallAt: number[] = [];
const retryCount = new Map<string, number>();

let activeCount = 0;
let activeBackgroundCount = 0;
const concurrencyWaiters: Array<{
  owner?: PlacesRequestOwner;
  resolve: (acquired: boolean) => void;
}> = [];

/** Pause new Places requests until this timestamp (rate-limit cooldown). */
let generationCooldownUntil = 0;
let activeGenerationRequestId: string | null = null;
/** Extra admitted calls for the active foreground request while the shared window is hot. */
let foregroundAllowanceRemaining = 0;
let foregroundGrantsWhileHot = 0;
let runawayProtectionActive = false;

export type PlacesCallLedgerEntry = {
  requestId: string;
  recommendationRequestId: string;
  surface: string;
  intent: string;
  lane: string;
  requestType: string;
  queryFamily: string;
  attempt: number;
  deduped: boolean;
  blocked: boolean;
  counted: boolean;
  callWindowCount: number;
  blockedReason: string;
};

const callLedger: PlacesCallLedgerEntry[] = [];
const CALL_LEDGER_LIMIT = 40;

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

export type PlacesRequestOwner = {
  requestId: string;
  surface:
    | "chat"
    | "chat_place_focus"
    | "home_nearby"
    | "home_shortcut"
    | "explore"
    | "selection"
    | "planner"
    | "other";
  priority: "foreground" | "background";
  requestType: "searchNearby" | "searchText" | "details" | "autocomplete";
  lane?: string;
  generationRequestId?: string;
  intent?: string;
  queryFamily?: string;
  attempt?: number;
  exploreSession?: ExploreRequestSession;
  category?: string;
};

function pushPlacesCallLedger(
  owner: PlacesRequestOwner | undefined,
  state: {
    deduped: boolean;
    blocked: boolean;
    blockedReason?: string;
    counted: boolean;
  },
): void {
  pruneRateWindow(Date.now());
  const entry: PlacesCallLedgerEntry = {
    requestId: owner?.requestId ?? "",
    recommendationRequestId: owner?.generationRequestId ?? "",
    surface: owner?.surface ?? "",
    intent: owner?.intent ?? "",
    lane: owner?.lane ?? "",
    requestType: owner?.requestType ?? "",
    queryFamily: (owner?.queryFamily ?? "").slice(0, 80),
    attempt: owner?.attempt ?? 0,
    deduped: state.deduped,
    blocked: state.blocked,
    counted: state.counted,
    callWindowCount: recentCallAt.length,
    blockedReason: state.blockedReason ?? "",
  };
  callLedger.push(entry);
  if (callLedger.length > CALL_LEDGER_LIMIT) callLedger.shift();
  devVerboseInfo("[PLACES_CALL_LEDGER]", entry);
}

function logPlacesRequestOwner(
  owner: PlacesRequestOwner | undefined,
  state: {
    deduped: boolean;
    blocked: boolean;
    blockedReason?: string;
    providerProtectionActive?: boolean;
    counted?: boolean;
  },
): void {
  pushPlacesCallLedger(owner, {
    deduped: state.deduped,
    blocked: state.blocked,
    blockedReason: state.blockedReason,
    counted: state.counted ?? false,
  });
  if (!owner) return;
  const session = owner.exploreSession;
  if (session) {
    if (state.deduped) session.dedupedRequests += 1;
    if (state.counted) {
      if (owner.priority === "foreground") session.foregroundRequests += 1;
      else session.backgroundRequests += 1;
      const category = owner.category ?? "all";
      session.categoryRequests.set(category, (session.categoryRequests.get(category) ?? 0) + 1);
    }
    if (state.blocked) {
      if (state.blockedReason !== "aborted") session.blockedRequests += 1;
    }
  }
  const { exploreSession: _session, ...diagnosticOwner } = owner;
  devVerboseInfo("[PLACES_REQUEST_OWNER]", { ...diagnosticOwner, ...state });
  devVerboseInfo("[PLACES_RATE_LIMIT_STATE]", {
    callsInWindow: recentCallAt.length,
    inflightCount: activeCount,
    cooldownActive: generationCooldownUntil > Date.now(),
    providerProtectionActive: state.providerProtectionActive ?? runawayProtectionActive,
    triggeringSurface: owner.surface,
  });
  devVerboseInfo("[PLACES_REQUEST_WINDOW_CONTEXT]", {
    requestId: owner.requestId,
    surface: owner.surface,
    requestType: owner.requestType,
    lane: owner.lane ?? "",
    priority: owner.priority,
    callsInWindow: recentCallAt.length,
  });
}

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

export function isPlacesRateWindowFull(now = Date.now()): boolean {
  pruneRateWindow(now);
  return recentCallAt.length >= RATE_MAX_CALLS;
}

export function getPlacesRateWindowCount(now = Date.now()): number {
  pruneRateWindow(now);
  return recentCallAt.length;
}

export function isPlacesRateLimited(now = Date.now()): boolean {
  if (now < generationCooldownUntil) return true;
  return isPlacesRateWindowFull(now);
}

export function isPlacesRunawayProtectionActive(): boolean {
  return runawayProtectionActive;
}

export function isStalePlacesGeneration(generationRequestId: string | undefined): boolean {
  if (!generationRequestId || !activeGenerationRequestId) return false;
  return generationRequestId !== activeGenerationRequestId;
}

export type PlacesProviderAdmission = {
  admit: boolean;
  bypassWindow: boolean;
  blockedReason?:
    | "provider_protection"
    | "request_budget"
    | "runaway"
    | "stale_generation"
    | "background_reservation"
    | "aborted"
    | "explore_budget";
  providerProtectionActive: boolean;
};

/**
 * Shared 60s window stays the runaway detector.
 * A matching foreground grant may admit a bounded continuation while that window is hot.
 * Explicit provider cooldown and runaway grants are not bypassed.
 */
export function evaluatePlacesProviderAdmission(
  owner?: Pick<
    PlacesRequestOwner,
    "generationRequestId" | "priority" | "exploreSession" | "category"
  >,
  now = Date.now(),
): PlacesProviderAdmission {
  if (owner?.exploreSession) {
    const aborted = owner.exploreSession.controller.signal.aborted;
    if (aborted || !exploreSessionCanRequest(owner.exploreSession, owner.category)) {
      return {
        admit: false,
        bypassWindow: false,
        blockedReason: aborted ? "aborted" : "explore_budget",
        providerProtectionActive: false,
      };
    }
  }
  if (isStalePlacesGeneration(owner?.generationRequestId)) {
    return {
      admit: false,
      bypassWindow: false,
      blockedReason: "stale_generation",
      providerProtectionActive: runawayProtectionActive,
    };
  }
  if (now < generationCooldownUntil) {
    return {
      admit: false,
      bypassWindow: false,
      blockedReason: "provider_protection",
      providerProtectionActive: true,
    };
  }
  pruneRateWindow(now);
  if (owner?.priority === "background" && recentCallAt.length >= BACKGROUND_WINDOW_BUDGET) {
    return {
      admit: false,
      bypassWindow: false,
      blockedReason: "background_reservation",
      providerProtectionActive: false,
    };
  }
  if (!isPlacesRateWindowFull(now)) {
    return { admit: true, bypassWindow: false, providerProtectionActive: runawayProtectionActive };
  }
  const granted =
    owner?.priority === "foreground" &&
    Boolean(owner.generationRequestId) &&
    owner.generationRequestId === activeGenerationRequestId &&
    foregroundAllowanceRemaining > 0 &&
    !runawayProtectionActive;
  if (granted) {
    return { admit: true, bypassWindow: true, providerProtectionActive: false };
  }
  if (runawayProtectionActive || foregroundGrantsWhileHot >= MAX_FOREGROUND_GRANTS_WHILE_HOT) {
    return {
      admit: false,
      bypassWindow: false,
      blockedReason: "runaway",
      providerProtectionActive: true,
    };
  }
  return {
    admit: false,
    bypassWindow: false,
    blockedReason: owner?.priority === "foreground" ? "request_budget" : "provider_protection",
    providerProtectionActive: true,
  };
}

export function beginForegroundPlacesRequest(
  requestId: string,
  budget = FOREGROUND_REQUEST_PROVIDER_BUDGET,
): {
  grantedBudget: number;
  windowHot: boolean;
  blocked: boolean;
  blockedReason?: "provider_quota" | "runaway";
} {
  const now = Date.now();
  pruneRateWindow(now);
  activeGenerationRequestId = requestId;
  if (now < generationCooldownUntil) {
    foregroundAllowanceRemaining = 0;
    return { grantedBudget: 0, windowHot: true, blocked: true, blockedReason: "provider_quota" };
  }
  if (recentCallAt.length < RATE_MAX_CALLS) {
    foregroundGrantsWhileHot = 0;
    runawayProtectionActive = false;
    foregroundAllowanceRemaining = budget;
    return { grantedBudget: budget, windowHot: false, blocked: false };
  }
  if (runawayProtectionActive || foregroundGrantsWhileHot >= MAX_FOREGROUND_GRANTS_WHILE_HOT) {
    runawayProtectionActive = true;
    foregroundAllowanceRemaining = 0;
    return { grantedBudget: 0, windowHot: true, blocked: true, blockedReason: "runaway" };
  }
  foregroundGrantsWhileHot += 1;
  foregroundAllowanceRemaining = budget;
  return { grantedBudget: budget, windowHot: true, blocked: false };
}

/** Test-only window fill. Production call accounting stays in runPlacesApiDeduped. */
export function notePlacesWindowCallForTests(now = Date.now()): void {
  recordPlacesApiCall(now);
}

export function resetPlacesProviderLimiterForTests(): void {
  recentCallAt.length = 0;
  foregroundAllowanceRemaining = 0;
  foregroundGrantsWhileHot = 0;
  runawayProtectionActive = false;
  activeGenerationRequestId = null;
  generationCooldownUntil = 0;
  pending.clear();
  pendingSignals.clear();
  activeBackgroundCount = 0;
  blockedUntilByKey.clear();
  callLedger.length = 0;
  activeCount = 0;
  concurrencyWaiters.length = 0;
}

export function getPlacesCallLedger(): readonly PlacesCallLedgerEntry[] {
  return callLedger;
}

export function bucketPlacesCoordinate(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(3);
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
  void import("@/lib/ai/places-cost-cache/rate-protection")
    .then((m) => {
      m.activatePlacesRateProtection({
        reason: "PLACES_RATE_LIMIT_BLOCKED",
        ttlMs: Math.max(wait, 30_000),
      });
    })
    .catch(() => {});
}

export async function waitForPlacesGenerationCooldown(): Promise<void> {
  while (Date.now() < generationCooldownUntil) {
    await sleep(Math.min(generationCooldownUntil - Date.now(), 2000));
  }
}

export function beginPlacesGenerationSession(generationRequestId: string): void {
  activeGenerationRequestId = generationRequestId;
  foregroundAllowanceRemaining = 0;
  generationCooldownUntil = 0;
  blockedUntilByKey.clear();
  lastLoggedBlocked = null;
  lastLoggedSkipped = null;
  resetPlacesApiCallStats();
  retryCount.clear();
  loggedKeys.clear();
  // New user submission must not inherit prior sticky rate-limit skips.
  void import("@/lib/places-classic-landmark-cache")
    .then((m) => {
      m.resetPlacesRateLimitEncountered();
    })
    .catch(() => {});
  void import("@/lib/ai/places-cost-cache/rate-protection")
    .then((m) => {
      m.clearPlacesRateProtection();
    })
    .catch(() => {});
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

function drainConcurrencyQueue(): void {
  concurrencyWaiters.sort(
    (a, b) =>
      Number(b.owner?.priority === "foreground") - Number(a.owner?.priority === "foreground"),
  );
  for (let i = 0; i < concurrencyWaiters.length; ) {
    const waiter = concurrencyWaiters[i]!;
    if (waiter.owner?.exploreSession?.controller.signal.aborted) {
      concurrencyWaiters.splice(i, 1);
      waiter.resolve(false);
      continue;
    }
    const background = waiter.owner?.priority === "background";
    if (activeCount >= MAX_CONCURRENT || (background && activeBackgroundCount >= 1)) {
      i++;
      continue;
    }
    concurrencyWaiters.splice(i, 1);
    // Transfer the slot before resolving: new arrivals cannot steal it.
    activeCount += 1;
    if (background) activeBackgroundCount += 1;
    waiter.resolve(true);
  }
}
async function acquireConcurrencySlot(owner?: PlacesRequestOwner): Promise<boolean> {
  return new Promise((resolve) => {
    const signal = owner?.exploreSession?.controller.signal;
    const onAbort = () => drainConcurrencyQueue();
    signal?.addEventListener("abort", onAbort, { once: true });
    concurrencyWaiters.push({
      owner,
      resolve: (acquired) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(acquired);
      },
    });
    drainConcurrencyQueue();
  });
}
function releaseConcurrencySlot(owner?: PlacesRequestOwner): void {
  activeCount = Math.max(0, activeCount - 1);
  if (owner?.priority === "background")
    activeBackgroundCount = Math.max(0, activeBackgroundCount - 1);
  drainConcurrencyQueue();
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
  runner: (signal?: AbortSignal) => Promise<T>,
  owner?: PlacesRequestOwner,
): Promise<T | null> {
  const now = Date.now();
  const signal = owner?.exploreSession?.controller.signal;
  if (signal?.aborted) {
    logPlacesRequestOwner(owner, { deduped: false, blocked: true, blockedReason: "aborted" });
    return null;
  }
  if (owner?.exploreSession?.mode === "search" && !owner.exploreSession.grantStarted) {
    owner.exploreSession.grantStarted = true;
    beginForegroundPlacesRequest(owner.exploreSession.id);
  }

  if (isStalePlacesGeneration(owner?.generationRequestId)) {
    logPlacesRequestOwner(owner, {
      deduped: false,
      blocked: true,
      blockedReason: "stale_generation",
      providerProtectionActive: runawayProtectionActive,
    });
    return null;
  }

  const keyBlockedUntil = blockedUntilByKey.get(key) ?? 0;
  if (now < keyBlockedUntil) {
    logPlacesRequestSkipped(key, keyBlockedUntil);
    logPlacesRequestOwner(owner, {
      deduped: false,
      blocked: true,
      blockedReason: "request_cooldown",
    });
    return null;
  }

  const inflight = pending.get(key);
  if (inflight && !pendingSignals.get(key)?.aborted) {
    logPlacesDedupePending(key);
    logPlacesRequestOwner(owner, { deduped: true, blocked: false, counted: false });
    return inflight as Promise<T>;
  }

  const admission = evaluatePlacesProviderAdmission(owner, now);
  if (!admission.admit) {
    logPlacesRequestOwner(owner, {
      deduped: false,
      blocked: true,
      blockedReason: admission.blockedReason ?? "provider_protection",
      providerProtectionActive: admission.providerProtectionActive,
    });
    return null;
  }

  const onAbort = () => {
    if (owner?.exploreSession) owner.exploreSession.abortedRequests += 1;
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  const promise = (async () => {
    try {
      const { shouldBlockNewPlacesCalls } = await import("@/lib/ai/places-cost-cache");
      if (shouldBlockNewPlacesCalls({ query: key, logSkip: true })) {
        logPlacesRequestOwner(owner, {
          deduped: false,
          blocked: true,
          blockedReason: "provider_protection",
          providerProtectionActive: true,
        });
        return null;
      }
    } catch {
      /* ignore */
    }

    try {
      const { isPlacesQueryOnCooldown, logPlacesSearchSkipped, PLACES_QUERY_COOLDOWN_MS } =
        await import("@/lib/ai/places-cost-cache");
      if (!owner?.exploreSession && isPlacesQueryOnCooldown(key)) {
        logPlacesSearchSkipped({
          reason: "query_cooldown",
          query: key,
          cooldownMs: PLACES_QUERY_COOLDOWN_MS,
        });
        logPlacesRequestOwner(owner, {
          deduped: false,
          blocked: true,
          blockedReason: "query_cooldown",
        });
        return null;
      }
    } catch {
      /* ignore */
    }

    if (isStalePlacesGeneration(owner?.generationRequestId)) {
      logPlacesRequestOwner(owner, {
        deduped: false,
        blocked: true,
        blockedReason: "stale_generation",
      });
      return null;
    }
    if (!owner?.exploreSession && owner?.priority !== "background" && !admission.bypassWindow) {
      const waitResult = await waitForRateWindow(key);
      if (waitResult === "cooldown" || isPlacesRateLimited()) {
        const until = Math.max(generationCooldownUntil, Date.now() + BACKOFF_MS[0]!);
        blockedUntilByKey.set(key, until);
        logPlacesRateLimitBlocked(key, until);
        notePlacesRateLimited({ attemptIndex: 0, requestKey: key });
        logPlacesRequestOwner(owner, {
          deduped: false,
          blocked: true,
          blockedReason: "rate_window",
        });
        return null;
      }
    }

    const acquired = await acquireConcurrencySlot(owner);
    if (!acquired) {
      logPlacesRequestOwner(owner, { deduped: false, blocked: true, blockedReason: "aborted" });
      return null;
    }
    try {
      if (isStalePlacesGeneration(owner?.generationRequestId)) {
        logPlacesRequestOwner(owner, {
          deduped: false,
          blocked: true,
          blockedReason: "stale_generation",
        });
        return null;
      }
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
          // Atomic admission at dispatch (and every retry), not before waiting in the queue.
          const dispatch = evaluatePlacesProviderAdmission(owner);
          if (!dispatch.admit) {
            logPlacesRequestOwner(owner, {
              deduped: false,
              blocked: true,
              blockedReason: dispatch.blockedReason,
              providerProtectionActive: dispatch.providerProtectionActive,
            });
            return null;
          }
          if (dispatch.bypassWindow)
            foregroundAllowanceRemaining = Math.max(0, foregroundAllowanceRemaining - 1);
          recordPlacesApiCall();
          logPlacesRequestOwner(owner, { deduped: false, blocked: false, counted: true });
          logPlacesApiCall(type, key);
          bumpCallStat(type);
          void import("@/lib/ai/places-cost-cache")
            .then((m) => {
              m.notePlacesQueryCooldown(key);
            })
            .catch(() => {});

          const result = await runner(signal);
          // Transport abort is best-effort; completion must still retain publication authority.
          if (
            signal?.aborted ||
            (!owner?.exploreSession && isStalePlacesGeneration(owner?.generationRequestId))
          )
            return null;
          const t = type.toLowerCase();
          if (t.includes("text") || t === "searchtext") markPlacesTextSuccess();
          if (t.includes("detail")) markPlacesDetailOutcome(result != null);
          return result;
        } catch (error) {
          lastError = error;
          if (signal?.aborted) {
            logPlacesRequestOwner(owner, {
              deduped: false,
              blocked: true,
              blockedReason: "aborted",
            });
            return null;
          }
          if (!shouldRetryPlacesFailure(error)) break;
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
              logOnce(`retry_limit:${key}`, `[PLACES_RETRY_LIMIT_REACHED] requestKey=${key}`);
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
      releaseConcurrencySlot(owner);
    }
  })().finally(() => {
    signal?.removeEventListener("abort", onAbort);
    if (pending.get(key) === promise) {
      pending.delete(key);
      pendingSignals.delete(key);
    }
  });

  pendingSignals.set(key, signal);
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
