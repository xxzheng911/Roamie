import type { DayWeatherSnapshot } from "@/lib/outfit/types";

/** OpenWeather icon id 首碼 → 簡化類型 */
export function simplifyWeatherIconType(iconType: string | undefined): "clear" | "cloud" | "rain" | "snow" | "fog" {
  const id = iconType?.trim() ?? "";
  if (id.startsWith("09") || id.startsWith("10") || id.startsWith("11")) return "rain";
  if (id.startsWith("13")) return "snow";
  if (id.startsWith("50")) return "fog";
  if (id.startsWith("01") || id.startsWith("02")) return "clear";
  return "cloud";
}

export function weatherKindFromCondition(condition: string): "clear" | "cloud" | "rain" | "snow" | "fog" {
  const c = condition.toLowerCase();
  if (/雨|雷|陣雨/.test(c)) return "rain";
  if (/雪/.test(c)) return "snow";
  if (/霧/.test(c)) return "fog";
  if (/晴/.test(c)) return "clear";
  return "cloud";
}

/** 依天氣狀況回傳情境 emoji（非嚴謹 WMO 對照，重視旅伴感） */
export function weatherDisplayEmoji(weather: DayWeatherSnapshot): string {
  const cond = weather.condition.toLowerCase();
  const precip = weather.precipProbability ?? 0;
  if (precip >= 50 || cond.includes("雨") || cond.includes("雷")) return "🌧️";
  if (cond.includes("雪")) return "❄️";
  if (cond.includes("霧")) return "🌫️";
  if (cond.includes("陰") || cond.includes("多雲")) return "⛅";
  if ((weather.tempHighC ?? 20) >= 30) return "☀️";
  if ((weather.tempLowC ?? 15) <= 10) return "🧥";
  return "☀️";
}

export function formatTempRange(weather: DayWeatherSnapshot): string {
  const hi = weather.tempHighC;
  const lo = weather.tempLowC;
  if (hi != null && lo != null) return `${Math.round(lo)}–${Math.round(hi)}°C`;
  if (hi != null) return `${Math.round(hi)}°C`;
  if (lo != null) return `${Math.round(lo)}°C`;
  return "—";
}
