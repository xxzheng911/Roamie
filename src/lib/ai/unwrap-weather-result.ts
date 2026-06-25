import type { WeatherSummary } from "@/lib/weather-types";

type WeatherFetchPayload =
  | WeatherSummary
  | { weather: WeatherSummary | null; error?: string | null }
  | null
  | undefined;

/** Normalize serverFn / bridge payloads — never propagate undefined to callers. */
export function unwrapWeatherResult(result: WeatherFetchPayload): WeatherSummary | null {
  if (result == null) return null;
  if (typeof result === "object" && "weather" in result) {
    return result.weather ?? null;
  }
  return result as WeatherSummary;
}
