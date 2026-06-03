import type { ClientContextBundle } from "@/lib/fetch-context";
import { withTimeout } from "@/lib/async/with-timeout";
import type { PlanTripFormInput } from "@/lib/plan-trip-handoff";
import type { TripLocation } from "@/lib/location/types";
import type { TravelPreferences } from "@/lib/preferences-storage";
import { buildPlanContextBundleOptionalWeather } from "@/lib/plan/plan-context-bundle";
import {
  logPlanAiAfterWeather,
  logPlanAiBlocked,
} from "@/lib/plan/plan-ai-generation-log";
import {
  PLAN_AI_FULL_PIPELINE_TIMEOUT_MS,
  PLAN_PRE_OPENAI_TIMEOUT_MS,
  PLAN_WEATHER_TIMEOUT_MS,
} from "@/lib/plan/plan-flow-timeouts";
import {
  generateAndSaveItineraryFromPlan,
  type GenerateItineraryFromPlanDeps,
  type GenerateItineraryFromPlanOptions,
} from "@/lib/trip/generate-itinerary-from-plan";
import type { StoredItinerary } from "@/lib/itinerary-storage";
import type { Locale } from "@/lib/i18n/types";

type WeatherFetchInput = { lat: number; lng: number; locale?: Locale };

export type PlanAiWeatherFetchFn = (args: {
  data: WeatherFetchInput;
}) => Promise<{
  weather: import("@/lib/weather-types").WeatherSummary | null;
  error: string | null;
}>;

export type PlanAiFlowParams = {
  destination: TripLocation;
  form: PlanTripFormInput;
  prefs: TravelPreferences;
  fetchWeather: PlanAiWeatherFetchFn;
  deps: GenerateItineraryFromPlanDeps;
  generationOptions?: GenerateItineraryFromPlanOptions;
};

export type PlanAiBlockedContext = {
  hasDestination: boolean;
  hasDate: boolean;
  hasStyles: boolean;
  hasWeather: boolean;
};

/** 天氣成功或失敗都回傳 bundle，並打 [PLAN_AI_AFTER_WEATHER] */
export async function fetchPlanAiBundleWithOptionalWeather(
  destination: TripLocation,
  fetchWeather: PlanAiWeatherFetchFn,
  prefs: TravelPreferences,
): Promise<ClientContextBundle> {
  const bundle = await buildPlanContextBundleOptionalWeather(
    destination,
    fetchWeather,
    PLAN_WEATHER_TIMEOUT_MS,
    prefs,
  );
  logPlanAiAfterWeather({
    hasWeather: Boolean(bundle.weather?.available),
    weatherSource: bundle.weather?.source ?? null,
  });
  return bundle;
}

/**
 * 在 weather 之後執行 AI 生成；20s 內若未送出 OpenAI 則 reject 並可 log BLOCKED。
 */
export async function executePlanAiGeneration(
  params: PlanAiFlowParams,
  bundle: ClientContextBundle,
): Promise<StoredItinerary> {
  let openAiRequestStarted = false;
  const markOpenAiStarted = () => {
    openAiRequestStarted = true;
    params.generationOptions?.onOpenAiRequestStart?.();
  };

  const runGeneration = generateAndSaveItineraryFromPlan(
    params.form,
    bundle,
    params.prefs,
    params.deps,
    undefined,
    undefined,
    {
      ...params.generationOptions,
      onOpenAiRequestStart: markOpenAiStarted,
    },
  );

  const preOpenAiGuard = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (!openAiRequestStarted) {
        reject(
          new Error(
            "pre_openai_deadline: 20 秒內未送出 OpenAI 請求（可能卡在 profile / memory / auth）",
          ),
        );
      }
    }, PLAN_PRE_OPENAI_TIMEOUT_MS);
  });

  try {
    return await withTimeout(
      Promise.race([runGeneration, preOpenAiGuard]),
      PLAN_AI_FULL_PIPELINE_TIMEOUT_MS,
      "plan_ai_full_pipeline",
    );
  } catch (e) {
    if (!openAiRequestStarted) {
      logPlanAiBlocked({
        reason: "submit_failed_before_openai",
        hasDestination: true,
        hasDate: Boolean(params.form.startDate && params.form.endDate),
        hasStyles: params.form.styles.length > 0,
        hasWeather: Boolean(bundle.weather?.available),
        extra: e instanceof Error ? e.message : String(e),
      });
    }
    throw e;
  }
}

export function logPlanAiPreOpenAiWatchdog(
  ctx: PlanAiBlockedContext,
  form: PlanTripFormInput | null,
): void {
  logPlanAiBlocked({
    reason: "pre_openai_watchdog_20s",
    ...ctx,
    extra: "no PLAN_AI_OPENAI_REQUEST_START within 20s",
  });
}
