import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { WeatherSummary } from "@/lib/weather-types";
import type { WeatherScene } from "@/lib/weather-scene";
import { resolveWeatherScene } from "@/lib/ai/weather-place-search";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { buildDestinationDayPlanSuggestions } from "@/lib/ai/must-visit-places";
import {
  buildDestinationCombinationSuggestionsReply,
  hasDestinationCombinations,
} from "@/lib/ai/destination-combination-suggestions";
import type { PendingQuestion } from "@/lib/ai/destination-pending-question";
import { pendingQuestionForPlanningNextStep } from "@/lib/ai/destination-pending-question";
import { pendingQuestionForCityPreference } from "@/lib/ai/city-days-planning";

function formatTempLabel(temp?: number | null): string | null {
  if (temp == null || Number.isNaN(temp)) return null;
  return `${Math.round(temp)}°C`;
}

function hasAvoidHot(context?: CanonicalTravelContext): boolean {
  return Boolean(
    context?.excludedCategories?.some((c) => /曝曬|中午|高溫/.test(c)) ||
      context?.setting === "室內" && /避暑|怕熱/.test(context.vibe ?? ""),
  );
}

function buildScenePlanningBody(
  label: string,
  days: number,
  scene: WeatherScene,
  weather?: WeatherSummary | null,
  context?: CanonicalTravelContext,
): string[] {
  const weatherAvailable = weather?.available !== false;
  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTempLabel(temp);
  const avoidHot = hasAvoidHot(context);
  const rainy =
    scene === "rainy" ||
    (weather?.precipProbability ?? 0) >= 40 ||
    /雨/.test(weather?.condition ?? "");

  if (rainy) {
    return [
      weatherAvailable
        ? `這幾天${label}預計會下雨☔`
        : `${label}這段時間降雨機率偏高，我會優先挑室內路線。`,
      "",
      "我可以優先安排：",
      "• 室內美術館",
      "• 展覽",
      "• 百貨",
      "• 咖啡廳",
      "",
      "比較不容易受到天氣影響。",
      "",
      "你要我直接這樣安排嗎？",
    ];
  }

  if (scene === "hot" || avoidHot || (temp != null && temp >= 32)) {
    const tempLine = tempLabel
      ? `這幾天${label}白天約 ${tempLabel}。`
      : `這幾天${label}可能偏熱。`;
    return [
      avoidHot && tempLabel ? `最近有點熱，白天約 ${tempLabel}。` : tempLine,
      "",
      "我建議：",
      "• 上午排戶外景點",
      "• 下午安排百貨或展覽避暑",
      "• 晚上再安排夜景或夜市",
      "",
      "這樣走起來會舒服很多。",
      "",
      "要我直接幫你安排嗎？",
    ];
  }

  if (scene === "cold" || (temp != null && temp <= 14)) {
    return [
      tempLabel ? `最近${label}約 ${tempLabel}，有點冷。` : `最近${label}天氣偏冷。`,
      "",
      "我會把戶外景點集中在白天，",
      "晚上安排室內美食與商圈，",
      "這樣比較舒服。",
      "",
      "你想直接排完整行程，還是先推薦必去景點？",
    ];
  }

  if (scene === "sunny" || scene === "fair") {
    const dayPlan = buildDestinationDayPlanSuggestions(label, days);
    return [
      weatherAvailable && tempLabel
        ? `這幾天${label}約 ${tempLabel}，很適合步行。`
        : `這幾天${label}天氣很適合散步。`,
      "",
      "可以安排：",
      ...dayPlan,
      "",
      "你想直接排完整行程，還是先推薦必去景點？",
    ];
  }

  return [
    `我會依${label}這幾天的天氣，幫你挑走起來舒服的節奏。`,
    "",
    "你想直接排完整行程，還是先推薦必去景點？",
  ];
}

export function buildWeatherAwarePlanningReply(params: {
  destination: string;
  days: number;
  weather?: WeatherSummary | null;
  context?: CanonicalTravelContext;
  destinationCountry?: string;
  preferNextStepQuestion?: boolean;
}): { reply: string; pendingQuestion: PendingQuestion } {
  const label = normalizeDestinationLabel(params.destination);
  const days = params.days;
  const pendingQuestion = params.preferNextStepQuestion
    ? pendingQuestionForPlanningNextStep(label, params.destinationCountry)
    : pendingQuestionForCityPreference(label, params.destinationCountry);

  if (hasDestinationCombinations(label)) {
    const scene = resolveWeatherScene(params.weather ?? null, label);
    const temp = params.weather?.feelsLikeC ?? params.weather?.tempC;
    const tempLabel = formatTempLabel(temp);
    const weatherAvailable = params.weather?.available !== false;
    const weatherLine =
      scene === "sunny" || scene === "fair"
        ? weatherAvailable && tempLabel
          ? `這幾天${label}約 ${tempLabel}，很適合步行。`
          : `這幾天${label}天氣很適合散步。`
        : null;
    const comboReply = buildDestinationCombinationSuggestionsReply(label, days, {
      weatherLine,
      startDate: params.context?.startDate,
    });
    if (comboReply) {
      return { reply: comboReply, pendingQuestion };
    }
  }

  const scene = resolveWeatherScene(params.weather ?? null, label);
  const body = buildScenePlanningBody(label, days, scene, params.weather, params.context);

  const summary = [
    "好，我先記下：",
    "",
    `目的地：${label}`,
    `天數：${days}天`,
    ...(params.context?.startDate ? [`出發：${params.context.startDate}`] : []),
    "",
    ...body,
  ].join("\n");

  return { reply: summary, pendingQuestion };
}

export function buildWeatherConstraintAcknowledgement(
  context: CanonicalTravelContext,
  weather?: WeatherSummary | null,
): string | null {
  const dest = context.destination?.trim();
  if (!dest) return null;

  const avoidHot = hasAvoidHot(context);
  if (!avoidHot) return null;

  const temp = weather?.feelsLikeC ?? weather?.tempC;
  const tempLabel = formatTempLabel(temp);
  const label = normalizeDestinationLabel(dest);

  return [
    tempLabel ? `最近${label}白天約 ${tempLabel}，確實偏熱。` : `我會避開讓你太曬的行程。`,
    "我幫你穿插室內景點，避免中午長時間曝曬。",
    "",
    "接下來我可以先推薦幾個適合的地點，或直接排完整行程。",
  ].join("\n");
}
