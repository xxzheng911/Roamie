import { readOpenWeatherKeyFromClientEnv } from "@/lib/openweather-key-resolve";
import { detectPlatform } from "@/services/platform";

export type WeatherRuntime = "capacitor-ios" | "capacitor-android" | "web" | "ssr";

export function weatherRuntimeContext(): {
  runtime: WeatherRuntime;
  platform: string;
  isCapacitor: boolean;
  isIOS: boolean;
  hasClientOpenWeatherKey: boolean;
} {
  const p = detectPlatform();
  const runtime: WeatherRuntime =
    p.isIOS && p.isCapacitor
      ? "capacitor-ios"
      : p.isAndroid && p.isCapacitor
        ? "capacitor-android"
        : typeof window === "undefined"
          ? "ssr"
          : "web";
  return {
    runtime,
    platform: p.kind,
    isCapacitor: p.isCapacitor,
    isIOS: p.isIOS,
    hasClientOpenWeatherKey: Boolean(readOpenWeatherKeyFromClientEnv()),
  };
}

function withRuntime(extra?: Record<string, unknown>) {
  return { ...weatherRuntimeContext(), ...extra };
}

export function logHomeWeather(event: string, extra?: Record<string, unknown>): void {
  console.info("[HOME_WEATHER]", event, withRuntime(extra));
}

export function logWeatherFetch(event: string, extra?: Record<string, unknown>): void {
  console.info("[WEATHER_FETCH]", event, withRuntime(extra));
}

export function logOpenWeatherRequest(extra: Record<string, unknown>): void {
  console.info("[OPENWEATHER_REQUEST]", withRuntime(extra));
}

export function logOpenWeatherResponse(extra: Record<string, unknown>): void {
  console.info("[OPENWEATHER_RESPONSE]", withRuntime(extra));
}

/** 遮罩 API key，僅保留前 4 碼供 Xcode log 比對 */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const trimmed = key.trim();
  if (trimmed.length < 8) return "***";
  return `${trimmed.slice(0, 4)}***`;
}
