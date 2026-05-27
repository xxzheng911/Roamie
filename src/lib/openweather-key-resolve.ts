const CLIENT_KEY_ENV = ["EXPO_PUBLIC_OPENWEATHER_API_KEY", "VITE_OPENWEATHER_API_KEY"] as const;

let clientKeyLogged = false;

export function readOpenWeatherKeyFromClientEnv(): string | null {
  if (typeof import.meta === "undefined" || !import.meta.env) return null;
  for (const name of CLIENT_KEY_ENV) {
    const raw = import.meta.env[name];
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    if (trimmed.length >= 16) return trimmed;
  }
  return null;
}

/** 僅在成功載入時 log 一次，不印出完整 key */
export function logOpenWeatherKeyLoadedOnce(): void {
  if (clientKeyLogged) return;
  if (!readOpenWeatherKeyFromClientEnv()) return;
  clientKeyLogged = true;
  console.info("✅ OpenWeather key loaded");
}
