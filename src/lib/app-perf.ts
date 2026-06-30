type PerfDetail = Record<string, unknown>;

const routeChangeStartedAt = new Map<string, number>();

export function logPerfRouteChange(from: string, to: string): void {
  if (from === to) return;
  const now = performance.now();
  routeChangeStartedAt.set(to, now);
  console.info("[PERF_ROUTE_CHANGE]", { from, to });
}

export function logPerfRouteDuration(from: string, to: string): void {
  if (from === to) return;
  const started = routeChangeStartedAt.get(to);
  const durationMs =
    started != null ? Math.round(performance.now() - started) : undefined;
  console.info("[PERF_ROUTE_DURATION]", { from, to, durationMs });
  routeChangeStartedAt.delete(to);
}

export function logPerfProfileLoadSkip(reason: "already_loaded" | "inflight" | "same_user"): void {
  console.info("[PERF_PROFILE_LOAD_SKIP]", { reason });
}

export function logPerfTravelPrefLoadSkip(reason: "already_loaded_on_boot" | "session_cached"): void {
  console.info("[PERF_TRAVEL_PREF_LOAD_SKIP]", { reason });
}

export function logPerfKeyboardListener(
  action: "add" | "remove",
  detail?: PerfDetail,
): void {
  console.info("[PERF_KEYBOARD_LISTENER]", { action, ...detail });
}

export function logPerfEffectRun(
  effect: string,
  detail?: PerfDetail & { route?: string; reason?: string },
): void {
  console.info("[PERF_EFFECT_RUN]", { effect, ...detail });
}

export function logPerfRender(
  component: string,
  detail?: PerfDetail & { reason?: string; durationMs?: number },
): void {
  console.info("[PERF_RENDER]", { component, ...detail });
}

export function measurePerfRender(component: string, reason: string, run: () => void): void {
  const start = performance.now();
  run();
  const durationMs = Math.round(performance.now() - start);
  if (durationMs >= 8) {
    logPerfRender(component, { reason, durationMs });
  }
}
