import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import {
  parseMonthNumber,
  resolveTravelMonthLabel,
  stripUnrelatedSeasonInfo,
} from "@/lib/ai/season-response-guardrail";

function formatTemp(temp?: number | null): string | null {
  if (temp == null || Number.isNaN(temp)) return null;
  return `${Math.round(temp)}°C`;
}

function alishanMonthClimateLines(
  monthNum: number | undefined,
  monthLabel: string,
  weather?: WeatherSummary | null,
): string[] {
  const weatherOk = weather?.available !== false;
  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTemp(temp);
  const rainy =
    (weather?.precipProbability ?? 0) >= 40 || /雨/.test(weather?.condition ?? "");

  if (weatherOk && tempLabel) {
    return [
      rainy
        ? `${monthLabel}阿里山白天約 ${tempLabel}，可能有降雨，建議帶可收納雨具。`
        : `${monthLabel}阿里山白天約 ${tempLabel}，晚上會再涼一些，建議洋蔥式穿搭。`,
      "可以安排森林步道、車站、咖啡廳等節奏，不會太趕。",
    ];
  }

  if (!monthNum) {
    return [
      "目前還查不到下個月完整預報，我先用阿里山該月份常見氣候幫你抓方向。",
      "阿里山早晚通常偏涼，山區也容易有霧或午後雨。",
      "建議帶薄外套、好走的鞋，以及可收納雨具。",
    ];
  }

  if (monthNum === 3 || monthNum === 4) {
    return [
      `${monthNum}月阿里山早晚偏涼，櫻花季可能在這段時間，建議帶薄外套與雨具。`,
    ];
  }
  if (monthNum === 10 || monthNum === 11) {
    return [
      `${monthNum}月阿里山早晚涼，楓紅通常較明顯，山區容易起霧，建議帶外套。`,
    ];
  }
  if (monthNum >= 6 && monthNum <= 8) {
    return [
      `${monthNum}月阿里山較溫暖，但午後仍可能有雷雨，早晚偏涼。`,
      "建議薄外套、好走的鞋、可收納雨具。",
    ];
  }
  if (monthNum === 12 || monthNum <= 2) {
    return [
      `${monthNum}月阿里山偏冷，清晨容易起霧，務必帶保暖外套與防滑鞋。`,
    ];
  }

  return [
    "阿里山早晚通常偏涼，山區也容易有霧或午後雨。",
    "建議帶薄外套、好走的鞋、可收納雨具。",
  ];
}

function countyMonthClimateLines(
  label: string,
  monthNum: number | undefined,
  monthLabel: string,
  weather?: WeatherSummary | null,
): string[] | null {
  if (label !== "苗栗") return null;

  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTemp(temp);
  const weatherOk = weather?.available !== false;
  const rainy =
    (weather?.precipProbability ?? 0) >= 40 || /雨/.test(weather?.condition ?? "");

  if (weatherOk && tempLabel) {
    return [
      rainy
        ? `${monthLabel}苗栗白天約 ${tempLabel}，可能有午後雷陣雨，我會建議白天穿插室內或樹蔭景點，帶薄外套、好走的鞋和雨具。`
        : `${monthLabel}苗栗白天約 ${tempLabel}，建議穿插室內或樹蔭景點，帶薄外套、好走的鞋和雨具。`,
    ];
  }

  if (monthNum != null && monthNum >= 6 && monthNum <= 9) {
    return [
      "苗栗夏天通常偏熱，也可能有午後雷陣雨，我會建議白天穿插室內或樹蔭景點，帶薄外套、好走的鞋和雨具。",
    ];
  }

  return [
    "苗栗那段時間可能偏熱，也可能有午後雷陣雨，我會建議白天穿插室內或樹蔭景點，帶薄外套、好走的鞋和雨具。",
  ];
}

function genericScenicMonthClimateLines(
  label: string,
  monthLabel: string,
  monthNum: number | undefined,
  weather?: WeatherSummary | null,
): string[] {
  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTemp(temp);
  const weatherOk = weather?.available !== false;

  if (weatherOk && tempLabel) {
    const rainy =
      (weather?.precipProbability ?? 0) >= 40 || /雨/.test(weather?.condition ?? "");
    return [
      rainy
        ? `${monthLabel}${label}白天約 ${tempLabel}，可能有雨，我會優先挑室內或短停留路線。`
        : `${monthLabel}${label}白天約 ${tempLabel}，適合安排輕鬆步行節奏。`,
    ];
  }

  if (monthNum) {
    return [
      `目前還查不到${monthLabel}完整預報，我先用${label}${monthNum}月常見氣候幫你抓方向。`,
    ];
  }

  return [`我會先看${monthLabel}${label}那段時間的天氣，再幫你抓適合的路線。`];
}

export function buildScenicMonthPlanningReply(params: {
  destination: string;
  context: CanonicalTravelContext;
  userText: string;
  weather?: WeatherSummary | null;
}): string {
  const label = normalizeDestinationLabel(params.destination);
  const monthLabel = resolveTravelMonthLabel(params.context, params.userText);
  const monthNum = parseMonthNumber(params.context.travelMonth);
  const weather = params.weather ?? params.context.weather ?? null;

  const climateLines =
    label === "阿里山"
      ? alishanMonthClimateLines(monthNum, monthLabel, weather)
      : countyMonthClimateLines(label, monthNum, monthLabel, weather) ??
        genericScenicMonthClimateLines(label, monthLabel, monthNum, weather);

  const body = [
    `好呀，${monthLabel}去${label}，我先幫你看那段時間的天氣和適合安排的節奏。`,
    "",
    ...climateLines,
    "",
    "你想先看必去景點，還是直接排 1～2 天行程？",
  ].join("\n");

  return stripUnrelatedSeasonInfo(body, monthNum, false);
}
