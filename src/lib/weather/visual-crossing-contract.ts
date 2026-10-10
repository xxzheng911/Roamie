import type { ClimateFailure } from "./climate-diagnostics";
import { canonicalWeatherTimezone } from "../outfit/weather-source-availability";
import { destinationDate, tripCalendarDates, validWeatherCoords } from "../outfit/trip-weather-policy";

export const CLIMATE_VERSION = "vc-stats-v1";
export const CLIMATE_TTL_MS = 6 * 60 * 60_000;
export const CLIMATE_FAILURE_TTL_MS = 15 * 60_000;
export type ClimateInput = {
  destination: string; lat: number; lng: number; startDate: string; endDate: string;
  timezone?: string; utcOffsetMinutes?: number | null;
};
export type ClimateSummary = {
  low: number; high: number; timezone: string; dates: string[]; fetchedAt: number;
};

export function validClimateInput(input: ClimateInput): boolean {
  return Boolean(input && typeof input.destination === "string" && input.destination.trim() &&
    input.destination.length <= 200 && validWeatherCoords(input.lat, input.lng) &&
    typeof input.startDate === "string" && typeof input.endDate === "string" &&
    tripCalendarDates(input.startDate, input.endDate).length);
}

export function climateCacheKey(input: ClimateInput): string {
  return JSON.stringify([CLIMATE_VERSION, input.destination.trim().toLowerCase(), input.lat, input.lng,
    input.startDate, input.endDate, input.timezone ?? "provider", input.utcOffsetMinutes ?? null, "metric"]);
}

// The real Tokyo probe (2026-11-25..30) confirmed normal[element] = [min, mean, max].
// Read ONLY the mean. Never treat historical extremes or statistical rain as a forecast.
type ClimateValidation = { value: ClimateSummary; failure?: never } | { value: null; failure: ClimateFailure };
export function validateClimateStats(raw: unknown, input: ClimateInput, now = Date.now()): ClimateValidation {
  if (!input || !validWeatherCoords(input.lat, input.lng)) return { value: null, failure: 'invalid_coordinates' };
  if (!validClimateInput(input)) return { value: null, failure: 'incomplete_dates' };
  if (!raw || typeof raw !== "object") return { value: null, failure: 'incomplete_stats' };
  const data = raw as Record<string, unknown>;
  const dates = tripCalendarDates(input.startDate, input.endDate);
  const timezone = typeof data.timezone === "string" ? canonicalWeatherTimezone(data.timezone) : undefined;
  const callerTimezone = canonicalWeatherTimezone(input.timezone);
  if (!validWeatherCoords(data.latitude, data.longitude) ||
    Math.abs((data.latitude as number) - input.lat) > 0.01 || Math.abs((data.longitude as number) - input.lng) > 0.01)
    return { value: null, failure: 'invalid_coordinates' };
  if (!timezone || !destinationDate(now, timezone) || (callerTimezone && callerTimezone !== timezone))
    return { value: null, failure: 'invalid_timezone' };
  if (!Array.isArray(data.days) || data.days.length !== dates.length)
    return { value: null, failure: 'incomplete_dates' };
  let low = 0, high = 0;
  const mean = (value: unknown): number | null => {
    if (!Array.isArray(value) || value.length !== 3 ||
      !value.every(v => typeof v === "number" && Number.isFinite(v) && v > -90 && v < 65) ||
      value[0] > value[1] || value[1] > value[2]) return null;
    return value[1];
  };
  for (const date of dates) {
    const matches = data.days.filter(row => row && row.datetime === date);
    if (matches.length !== 1) return { value: null, failure: 'incomplete_dates' };
    if (matches[0].source !== 'stats' || !matches[0].normal) return { value: null, failure: 'incomplete_stats' };
    const row = matches[0];
    const lo = mean(row.normal?.tempmin), hi = mean(row.normal?.tempmax);
    if (lo == null || hi == null || lo > hi) return { value: null, failure: 'invalid_normal_values' };
    // Fail closed if the provider changes the verified daily/normal contract.
    if (typeof row.tempmin !== "number" || typeof row.tempmax !== "number" || !Number.isFinite(row.tempmin) || !Number.isFinite(row.tempmax) ||
      Math.abs(row.tempmin - lo) > 0.11 || Math.abs(row.tempmax - hi) > 0.11) return { value: null, failure: 'invalid_normal_values' };
    low += lo; high += hi;
  }
  return { value: { low: low / dates.length, high: high / dates.length, timezone, dates, fetchedAt: now } };
}

export function parseClimateStats(raw: unknown, input: ClimateInput, now = Date.now()): ClimateSummary | null {
  return validateClimateStats(raw, input, now).value;
}
