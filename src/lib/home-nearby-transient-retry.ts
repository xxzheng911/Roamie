/**
 * Home Nearby recovery from a transient Worker guard failure.
 * Only `HTTP 503 {"error":"google_unavailable"}` (Abuse Guard could not authorize; the
 * provider was never called) is retried, once per Home load cycle, after the existing
 * client cooldown. Budget, credential, upstream and timeout failures are never retried.
 */

export type HomeNearbyFailureClass = {
  originalHttpStatus: number | null;
  originalErrorCode: string;
  retryEligible: boolean;
};

const TRANSIENT_GUARD_FAILURE = /^places_http_503:\{"error":"google_unavailable"\}$/;

export function classifyHomeNearbyFailure(message: string): HomeNearbyFailureClass {
  const text = message.trim();
  const http = text.match(/^places_http_(\d{3}):(.*)$/s);
  if (http) {
    const body = http[2]!.trim();
    let code = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown; reason?: unknown };
      code = String(parsed.reason ?? parsed.error ?? body);
    } catch {
      /* fixed reason text such as user_rate_limited */
    }
    return {
      originalHttpStatus: Number(http[1]),
      originalErrorCode: code.slice(0, 64),
      retryEligible: TRANSIENT_GUARD_FAILURE.test(text),
    };
  }
  const upstream = text.match(/^Google Places API (\d{3})/);
  if (upstream) {
    return { originalHttpStatus: Number(upstream[1]), originalErrorCode: "provider_http_error", retryEligible: false };
  }
  if (/places_(?:search_attempt_)?timeout/.test(text)) {
    return { originalHttpStatus: null, originalErrorCode: "timeout", retryEligible: false };
  }
  return { originalHttpStatus: null, originalErrorCode: text.slice(0, 64) || "unknown", retryEligible: false };
}

/** Cycles that already used their one automatic retry. Survives remounts and effect reruns. */
const claimedCycles = new Set<string>();

/** A successful load closes the cycle, so a later failure may recover once again. */
export function completeHomeNearbyRetryCycle(cycleKey: string): void {
  claimedCycles.delete(cycleKey);
}

export function resetHomeNearbyRetryCyclesForTest(): void {
  claimedCycles.clear();
}

export type HomeNearbyRetryOutcome =
  | "attempted"
  | "skipped_background"
  | "skipped_guard_active"
  | "skipped_has_picks"
  | "skipped_in_flight"
  | "skipped_stale"
  | "cancelled";

export type HomeNearbyRetryDeps = {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  now: () => number;
  /** Existing client protection: rate protection / generation cooldown still active. */
  isGuardActive: () => boolean;
  /** When the existing client protection ends (epoch ms), 0 when inactive. */
  guardUntil: () => number;
  isVisible: () => boolean;
  onOutcome?: (outcome: HomeNearbyRetryOutcome, cycleKey: string) => void;
};

const RETRY_SLACK_MS = 1_000;

export function createHomeNearbyAutoRetry(deps: HomeNearbyRetryDeps) {
  let pending: { handle: unknown; cycleKey: string } | null = null;

  const cancel = () => {
    if (!pending) return;
    deps.clearTimer(pending.handle);
    deps.onOutcome?.("cancelled", pending.cycleKey);
    pending = null;
  };

  return {
    /**
     * Called on a failed Home load. Schedules at most one retry for this cycle;
     * `run` must reuse the same request (same key, radius and candidate count).
     */
    onFailure(params: {
      cycleKey: string;
      message: string;
      hasPicks: boolean;
      isCurrentCycle: () => boolean;
      hasPicksNow: () => boolean;
      inFlight: () => boolean;
      run: () => void;
    }): HomeNearbyFailureClass & { cooldownRemainingMs: number; retryScheduled: boolean } {
      const failure = classifyHomeNearbyFailure(params.message);
      const cooldownRemainingMs = Math.max(0, deps.guardUntil() - deps.now());
      const eligible =
        failure.retryEligible && !params.hasPicks && !pending && !claimedCycles.has(params.cycleKey);
      if (!eligible) return { ...failure, cooldownRemainingMs, retryScheduled: false };

      claimedCycles.add(params.cycleKey);
      const cycleKey = params.cycleKey;
      const handle = deps.setTimer(() => {
        pending = null;
        const outcome: HomeNearbyRetryOutcome = !params.isCurrentCycle()
          ? "skipped_stale"
          : !deps.isVisible()
            ? "skipped_background"
            : params.hasPicksNow()
              ? "skipped_has_picks"
              : params.inFlight()
                ? "skipped_in_flight"
                : deps.isGuardActive()
                  ? "skipped_guard_active"
                  : "attempted";
        deps.onOutcome?.(outcome, cycleKey);
        if (outcome === "attempted") params.run();
      }, cooldownRemainingMs + RETRY_SLACK_MS);
      pending = { handle, cycleKey };
      return { ...failure, cooldownRemainingMs, retryScheduled: true };
    },
    /** New Home request, manual retry, location change or unmount. */
    cancel,
    hasPending: () => pending != null,
  };
}
