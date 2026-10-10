import { climateUnavailable, type ClimateFailure } from "./climate-diagnostics";
import { tripCalendarDates, tripWeatherMode } from "../outfit/trip-weather-policy";
import { CLIMATE_TTL_MS, CLIMATE_FAILURE_TTL_MS, climateCacheKey, validateClimateStats, validClimateInput,
  type ClimateInput, type ClimateSummary } from "./visual-crossing-contract";

export const VC_GUARD_VERSION = "visual-crossing-guard-v1";
export const VC_RECORD_LIMIT = 900;
export const VC_DEADLINE_MS = 12_000;
const PROVIDER_TIMEOUT_MS = 6_000;
const WINDOW_MS = 24 * 60 * 60_000;
type State = {
  charges: { at: number; records: number }[];
  leaseUntil: number;
  blocked: boolean;
  cache: Record<string, { until: number; value: ClimateSummary | null }>;
};
export type ClimateStorage = { get<T>(key: string): Promise<T | undefined>; put(key: string, value: unknown): Promise<void> };

/** Exactly ONE named DO owns the upstream, ledger, queue and cache globally.
 * Reservations are durably written before dispatch; never refunded after failure/timeout.
 * The persisted lease prevents a restarted object from overlapping an uncertain request.
 */
export class VisualCrossingGuard {
  private pending = new Map<string, Promise<ClimateSummary | null>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: ClimateStorage, private key: string,
    private upstream: typeof fetch = (url, init) => fetch(url, init), private now: () => number = Date.now) {}

  request(input: ClimateInput, deadline = this.now() + VC_DEADLINE_MS): Promise<ClimateSummary | null> {
    if (!this.key || !validClimateInput(input) || tripWeatherMode(input, this.now()) !== "climate") return Promise.resolve(climateUnavailable('source_unavailable'));
    const cacheKey = climateCacheKey(input);
    const existing = this.pending.get(cacheKey);
    if (existing) return existing;
    // One active + at most four queued distinct queries. No unbounded waiting.
    if (this.pending.size >= 5 || deadline <= this.now()) return Promise.resolve(climateUnavailable('queue_rejected'));
    const work = this.tail.then(() => this.run(input, cacheKey, deadline)).catch(() => climateUnavailable('guard_unavailable'));
    this.tail = work;
    const result = work.finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, result);
    return result;
  }

  private async run(input: ClimateInput, cacheKey: string, deadline: number): Promise<ClimateSummary | null> {
    if (this.now() >= deadline) return climateUnavailable('queue_rejected');
    const state = await this.store.get<State>("state") ?? { charges: [], leaseUntil: 0, blocked: false, cache: {} };
    const now = this.now();
    if (now >= deadline) return climateUnavailable('queue_rejected');
    const hit = state.cache[cacheKey];
    if (hit && hit.until > now) return hit.value ?? climateUnavailable('cached_unavailable');
    state.charges = state.charges.filter(c => c.at > now - WINDOW_MS);
    const records = tripCalendarDates(input.startDate, input.endDate).length;
    if (state.blocked) return climateUnavailable('guard_blocked');
    if (state.leaseUntil > now) return climateUnavailable('queue_rejected');
    if (state.charges.reduce((sum, c) => sum + c.records, 0) + records > VC_RECORD_LIMIT)
      return climateUnavailable('budget_exhausted');
    // Bound the single persisted value as well as the in-memory queue.
    state.cache = Object.fromEntries(Object.entries(state.cache).filter(([, v]) => v.until > now).slice(-47));
    state.charges.push({ at: now, records });
    state.leaseUntil = now + VC_DEADLINE_MS;
    // Fail closed on storage errors. This is awaited before any paid request.
    await this.store.put("state", state);
    if (this.now() >= deadline) return climateUnavailable('queue_rejected');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let value: ClimateSummary | null = null;
    let complete = false;
    let failure: ClimateFailure = 'unknown_provider_failure';
    let httpStatus: number | undefined;
    try {
      const url = new URL(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${input.lat},${input.lng}/${input.startDate}/${input.endDate}`);
      url.search = new URLSearchParams({ key: this.key, include: "stats", unitGroup: "metric", contentType: "json" }).toString();
      const response = await Promise.race([
        (async () => {
          const r = await this.upstream(url, { signal: controller.signal, redirect: "manual" });
          if (!r.ok) { failure = 'provider_http_error'; httpStatus = r.status; throw new Error('unavailable'); }
          try { return await r.json() as Record<string, unknown>; }
          catch { if (!controller.signal.aborted) failure = 'provider_invalid_json'; throw new Error('unavailable'); }
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          failure = 'provider_timeout'; controller.abort(); reject(new Error('unavailable'));
        }, Math.min(PROVIDER_TIMEOUT_MS, deadline - this.now())); }),
      ]);
      complete = true;
      if (!response || typeof response !== 'object') { failure = 'incomplete_stats'; throw new Error('unavailable'); }
      const cost = response.queryCost;
      if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 0 || cost > records) {
        // Unexpected billing: persist a circuit break instead of repeating an under-reserved query.
        failure = 'unexpected_query_cost';
        state.blocked = true;
        if (typeof cost === "number" && Number.isFinite(cost) && cost > records) state.charges[state.charges.length - 1].records = cost;
      } else {
        const parsed = validateClimateStats(response, input, this.now());
        value = parsed.value;
        if (!value) failure = parsed.failure!;
      }
    } catch {
      // No provider errors/URLs/payloads are logged; query string contains a secret.
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
    // A completed response can release the lease; failures retain it conservatively.
    if (complete) state.leaseUntil = 0;
    state.cache[cacheKey] = { value, until: this.now() + (value ? CLIMATE_TTL_MS : CLIMATE_FAILURE_TTL_MS) };
    await this.store.put("state", state);
    return value ?? climateUnavailable(failure, httpStatus);
  }
}
