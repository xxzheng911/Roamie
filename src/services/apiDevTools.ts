/**
 * Developer page / console 用的 API 連線測試（需先 runApiBootstrap）。
 */
import { testRoutesApiConnection } from "@/services/routesService";
import { testWeatherApiConnection } from "@/services/weatherService";

export type ApiDevTestResult =
  | { ok: true; label: string; detail: string }
  | { ok: false; label: string; statusCode?: number; message: string; hint?: string };

export async function runOpenWeatherDevTest(): Promise<ApiDevTestResult> {
  const result = await testWeatherApiConnection({ silent: true });
  if (result.ok) {
    const rain =
      result.rainProbability != null ? `${Math.round(result.rainProbability)}%` : "—";
    return {
      ok: true,
      label: "OpenWeather",
      detail: `${result.city ?? "高雄"} · ${result.temperature ?? "—"}°C · ${result.description ?? "—"} · 降雨機率 ${rain}`,
    };
  }
  return {
    ok: false,
    label: "OpenWeather",
    statusCode: result.statusCode,
    message: result.message,
  };
}

export async function runRoutesDevTest(): Promise<ApiDevTestResult> {
  const result = await testRoutesApiConnection({ silent: true });
  if (result.ok) {
    return {
      ok: true,
      label: "Routes API",
      detail: `高雄車站 → 駁二 · 步行 ${result.durationMinutes} 分 · ${result.distanceMeters} m`,
    };
  }
  return {
    ok: false,
    label: "Routes API",
    statusCode: result.statusCode,
    message: result.message,
    hint: result.hint,
  };
}
