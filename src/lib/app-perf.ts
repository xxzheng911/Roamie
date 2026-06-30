type PerfDetail = Record<string, unknown>;

const routeChangeStartedAt = new Map<string, number>();
const perfImageLoadCounts = new Map<string, { count: number; sources: Set<string> }>();
let perfImageFlushTimer: ReturnType<typeof setTimeout> | null = null;

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

export function logPerfScroll(
  page: string,
  detail: PerfDetail & { fpsDrop?: number; longTaskMs?: number },
): void {
  console.info("[PERF_SCROLL]", { page, ...detail });
}

export function logPerfImageLoad(page: string, count: number, source: string): void {
  const key = page || "unknown";
  const bucket = perfImageLoadCounts.get(key) ?? { count: 0, sources: new Set<string>() };
  bucket.count += count;
  if (source) bucket.sources.add(source);
  perfImageLoadCounts.set(key, bucket);

  if (perfImageFlushTimer) clearTimeout(perfImageFlushTimer);
  perfImageFlushTimer = setTimeout(() => {
    perfImageFlushTimer = null;
    for (const [p, stats] of perfImageLoadCounts) {
      console.info("[PERF_IMAGE_LOAD]", {
        page: p,
        count: stats.count,
        source: [...stats.sources].slice(0, 5).join(","),
      });
    }
    perfImageLoadCounts.clear();
  }, 800);
}
