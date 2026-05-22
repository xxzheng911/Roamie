import type { DayWeatherSnapshot } from "@/lib/outfit/types";

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
