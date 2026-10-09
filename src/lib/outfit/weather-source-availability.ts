/** Public, non-secret capability revision; never contains credentials or budget state. */
export const CLIMATE_AVAILABLE = "climate-source-v2:on";
export const CLIMATE_UNAVAILABLE = "climate-source-v2:off";
export type WeatherSourceAvailability = typeof CLIMATE_AVAILABLE | typeof CLIMATE_UNAVAILABLE;

let pending: Promise<WeatherSourceAvailability> | undefined;
/** Deduplicate concurrent mounts, but recheck on reopening (no stale capability TTL). */
export function readWeatherSourceAvailability(read: () => Promise<WeatherSourceAvailability>) {
  if (!pending) {
    let timer: ReturnType<typeof setTimeout>;
    pending = Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("source_availability_timeout")), 8000); }),
    ]).finally(() => { clearTimeout(timer); pending = undefined; });
  }
  return pending;
}

/** Offset display labels are not geographic timezone authority. No inferred zone from offset/name. */
export function canonicalWeatherTimezone(...candidates: (string | null | undefined)[]): string | undefined {
  for (const value of candidates) {
    if (!value || !/^[A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/.test(value) || value.startsWith("Etc/")) continue;
    try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
    catch { /* Unknown zone: retain seasonal fallback. */ }
  }
  return undefined;
}
