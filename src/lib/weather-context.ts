import type { WeatherSummary } from "@/lib/weather-types";
import { classifyWeatherScene, type WeatherScene } from "@/lib/weather-scene";

export type DayPeriod = "morning" | "afternoon" | "evening" | "night";

export type TemporalWeatherContext = {
  localTimeLabel: string;
  hour: number;
  period: DayPeriod;
  periodLabel: string;
  scene: WeatherScene;
  isNight: boolean;
  isRainy: boolean;
  isSunny: boolean;
  isCloudy: boolean;
  isHot: boolean;
  isCold: boolean;
  tempC: number | null;
  rulesForAI: string;
};

function periodFromHour(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const PERIOD_LABELS: Record<DayPeriod, string> = {
  morning: "早晨",
  afternoon: "下午",
  evening: "傍晚",
  night: "夜晚",
};

export function buildTemporalWeatherContext(
  weather?: WeatherSummary | null,
  timeIso?: string,
  timeZone?: string,
): TemporalWeatherContext {
  const d = timeIso ? new Date(timeIso) : new Date();
  const tz = timeZone ?? "Asia/Taipei";
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(d),
  );
  const period = periodFromHour(hour);
  const tempC = weather?.tempC ?? null;
  const scene = classifyWeatherScene({
    tempC,
    precipProbability: weather?.precipProbability,
    condition: weather?.condition,
    isDaytime: weather?.isDaytime,
  });

  const isRainy = scene === "rainy";
  const isSunny = scene === "sunny";
  const isCloudy = scene === "cloudy";
  const isHot = scene === "hot";
  const isCold = scene === "cold";
  const isNight = scene === "night" || period === "night" || period === "evening";

  const rules: string[] = [];
  rules.push(
    `現在是${PERIOD_LABELS[period]}（${d.toLocaleString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: tz })}），推薦必須符合此時段與當地營業時間。`,
  );

  if (period === "night" || period === "evening") {
    rules.push(
      "夜晚／傍晚：勿推薦已打烊或僅白天營業的景點；可增加夜景、酒吧、夜市、適合散步的河岸／巷弄。",
    );
  }
  if (period === "morning") {
    rules.push("早晨：可推薦早午餐、咖啡、公園晨間散步；避免只推薦晚餐類型。");
  }
  if (isRainy) {
    rules.push(
      "下雨／高降雨：降低戶外、海邊、登山；優先咖啡廳、書店、美術館、室內市集等可久待的室內點。",
    );
  }
  if (isSunny) {
    rules.push("晴天：可推薦公園、河堤、戶外散步景點、露天市集；戶外停留時間可稍長。");
  }
  if (isCloudy) {
    rules.push("陰天／多雲：適合巷弄散步、展覽、書店；戶外可短停，不必刻意躲雨。");
  }
  if (isHot) {
    rules.push(
      "炎熱：優先冷氣室內、冰品、百貨；避免長時間戶外步行；紫外線強時注意防曬與補水。",
    );
  }
  if ((weather?.uvi ?? 0) >= 7) {
    rules.push("紫外線偏強：戶外停留縮短，推薦有遮蔭或室內景點。");
  }
  if (isCold) {
    rules.push("偏冷：優先室內溫暖場所、熱食小店。");
  }
  if (isNight) {
    rules.push("夜晚：優先夜景、酒吧、深夜咖啡、適合夜間散步的河岸或巷弄。");
  }
  if (!isRainy && !isHot && period === "afternoon") {
    rules.push("天氣尚可的下午：可混合戶外巷弄與短停咖啡。");
  }

  return {
    localTimeLabel: d.toLocaleString("zh-TW", {
      weekday: "long",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Taipei",
    }),
    hour,
    period,
    periodLabel: PERIOD_LABELS[period],
    scene,
    isNight,
    isRainy,
    isSunny,
    isCloudy,
    isHot,
    isCold,
    tempC,
    rulesForAI: rules.join("\n"),
  };
}

export function formatTemporalWeatherBlock(
  weather?: WeatherSummary | null,
  timeIso?: string,
): string {
  const t = buildTemporalWeatherContext(weather, timeIso);
  const temp =
    t.tempC !== null ? `${Math.round(t.tempC)}°C` : weather?.tempC != null ? `${Math.round(weather.tempC)}°C` : "未知";
  const precip =
    weather?.precipProbability != null ? `降雨機率 ${weather.precipProbability}%` : "";
  const clouds =
    weather?.cloudCoverPercent != null ? `雲量 ${weather.cloudCoverPercent}%` : "";
  const uvi = weather?.uvi != null ? `UV ${Math.round(weather.uvi)}` : "";
  const sunset = weather?.sunset ? `日落 ${weather.sunset}` : "";
  const lines = [
    `【當地時間】${t.localTimeLabel}（${t.periodLabel}）`,
    `【當地天氣】${weather?.available === false ? weather.recommendationText : `${weather?.city ?? "目前位置"} · ${weather?.condition ?? "—"} · 氣溫 ${temp}${precip ? ` · ${precip}` : ""}${clouds ? ` · ${clouds}` : ""}${uvi ? ` · ${uvi}` : ""}${sunset ? ` · ${sunset}` : ""}`}`,
    `【時段情境】${t.isNight ? "夜晚" : "白天"}${t.isRainy ? " · 可能下雨" : ""}${t.isSunny ? " · 晴朗" : ""}${t.isCloudy ? " · 陰天" : ""}${t.isHot ? " · 炎熱" : ""}${t.isCold ? " · 偏冷" : ""}`,
    `【推薦原則】\n${t.rulesForAI}`,
  ];
  if (weather?.recommendationText) {
    lines.push(`【天氣建議】${weather.recommendationText}`);
  }
  return lines.join("\n");
}
