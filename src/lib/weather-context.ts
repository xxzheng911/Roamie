import type { WeatherSummary } from "@/lib/weather.functions";

export type DayPeriod = "morning" | "afternoon" | "evening" | "night";

export type TemporalWeatherContext = {
  localTimeLabel: string;
  hour: number;
  period: DayPeriod;
  periodLabel: string;
  isNight: boolean;
  isRainy: boolean;
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
  const cond = (weather?.condition ?? "").toLowerCase();
  const precip = weather?.precipProbability ?? 0;
  const tempC = weather?.tempC ?? null;

  const isRainy =
    precip >= 40 ||
    cond.includes("雨") ||
    cond.includes("雷") ||
    weather?.recommendation === "indoor";
  const isHot = tempC !== null && tempC >= 30;
  const isCold = tempC !== null && tempC <= 14;
  const isNight = period === "night" || period === "evening";

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
  if (isHot) {
    rules.push("炎熱：優先冷氣室內、樹蔭少的戶外排後；傍晚再安排戶外較舒適。");
  }
  if (isCold) {
    rules.push("偏冷：優先室內溫暖場所、熱食小店。");
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
    isNight,
    isRainy,
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
  const lines = [
    `【當地時間】${t.localTimeLabel}（${t.periodLabel}）`,
    `【當地天氣】${weather?.city ?? "目前位置"} · ${weather?.condition ?? "—"} · 氣溫 ${temp}${precip ? ` · ${precip}` : ""}`,
    `【時段情境】${t.isNight ? "夜晚" : "白天"}${t.isRainy ? " · 可能下雨" : ""}${t.isHot ? " · 炎熱" : ""}${t.isCold ? " · 偏冷" : ""}`,
    `【推薦原則】\n${t.rulesForAI}`,
  ];
  if (weather?.recommendationText) {
    lines.push(`【天氣建議】${weather.recommendationText}`);
  }
  return lines.join("\n");
}
