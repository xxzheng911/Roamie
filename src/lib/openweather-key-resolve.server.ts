import { isPlaceholderSecret, resolveServerEnv } from "@/lib/load-env.server";

/** Server 優先 EXPO_PUBLIC（與 Capacitor / Expo 一致） */
const SERVER_KEY_ENV = [
  "EXPO_PUBLIC_OPENWEATHER_API_KEY",
  "OPENWEATHER_API_KEY",
  "VITE_OPENWEATHER_API_KEY",
] as const;

let serverKeyLogged = false;

export function readOpenWeatherKeyFromServerEnv(): string | null {
  for (const name of SERVER_KEY_ENV) {
    const resolved = resolveServerEnv(name);
    const trimmed = resolved?.value?.trim();
    if (!trimmed || isPlaceholderSecret(trimmed)) continue;
    if (trimmed.length < 16) continue;
    return trimmed;
  }
  return null;
}

export function requireOpenWeatherApiKey(): string {
  const key = readOpenWeatherKeyFromServerEnv();
  if (!key) {
    throw new Error(
      "OpenWeather API key 尚未設定。請在 .env 加入 EXPO_PUBLIC_OPENWEATHER_API_KEY，執行 npm run sync:env 後重啟 dev server。",
    );
  }
  if (!serverKeyLogged) {
    serverKeyLogged = true;
    console.info("✅ OpenWeather key loaded");
  }
  return key;
}

export function hasOpenWeatherApiKey(): boolean {
  return Boolean(readOpenWeatherKeyFromServerEnv());
}
