import {
  Cloud,
  CloudRain,
  CloudSun,
  Loader2,
  Moon,
  Shirt,
  Sun,
  Umbrella,
} from "lucide-react";
import { ROAMIE_WEATHER_UNAVAILABLE_MESSAGE } from "@/lib/weather/constants";
import { formatTripDateRangeLabel } from "@/lib/outfit/trip-outfit-context";
import {
  simplifyWeatherIconType,
  weatherKindFromCondition,
} from "@/lib/outfit/weather-icons";
import type { TripWeatherSource } from "@/lib/outfit/types";
import { cn } from "@/lib/utils";

type Props = {
  destination: string;
  dateRange: { start: string; end: string };
  weatherSummary?: string;
  weatherSource?: TripWeatherSource;
  suggestion?: string;
  loading?: boolean;
  errorMessage?: string | null;
  outfitTags?: string[];
  weatherTempC?: number | null;
  weatherFeelsLikeC?: number | null;
  weatherCondition?: string;
  weatherIconType?: string;
  weatherIsDaytime?: boolean;
  weatherPrecipPercent?: number | null;
  outfitTier?: "free" | "plus";
  className?: string;
};

function WeatherGlyph({
  iconType,
  condition,
  isDaytime,
}: {
  iconType?: string;
  condition?: string;
  isDaytime?: boolean;
}) {
  const kind =
    simplifyWeatherIconType(iconType) !== "cloud"
      ? simplifyWeatherIconType(iconType)
      : weatherKindFromCondition(condition ?? "");
  if (kind === "rain") return <CloudRain className="h-5 w-5 text-sky-600" aria-hidden />;
  if (kind === "snow") return <Cloud className="h-5 w-5 text-sky-400" aria-hidden />;
  if (kind === "fog") return <Cloud className="h-5 w-5 text-muted-foreground" aria-hidden />;
  if (kind === "clear" && !isDaytime) {
    return <Moon className="h-5 w-5 text-indigo-500" aria-hidden />;
  }
  if (kind === "clear") return <Sun className="h-5 w-5 text-amber-500" aria-hidden />;
  return <CloudSun className="h-5 w-5 text-sky-500" aria-hidden />;
}

export function TripOutfitCard({
  destination,
  dateRange,
  weatherSummary,
  weatherSource,
  suggestion,
  loading,
  errorMessage,
  outfitTags = [],
  weatherTempC,
  weatherFeelsLikeC,
  weatherCondition,
  weatherIconType,
  weatherIsDaytime = true,
  weatherPrecipPercent,
  outfitTier,
  className,
}: Props) {
  const dateLabel = formatTripDateRangeLabel(dateRange.start, dateRange.end);
  const unavailable = weatherSource === "unavailable";
  const showWeatherStats =
    !unavailable && (weatherTempC != null || weatherCondition || weatherSummary);

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <Shirt className="h-3.5 w-3.5 text-clay" />
          這趟旅程怎麼穿？
        </div>
        {outfitTier === "plus" ? (
          <span className="rounded-full bg-clay/15 px-2 py-0.5 text-[10px] font-medium text-clay">
            Plus 細緻版
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 shadow-soft">
          <span>{destination}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1">
          {dateLabel}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-clay" />
          <p className="leading-relaxed">正在依目的地天氣與行程幫你想穿搭建議…</p>
        </div>
      ) : (
        <>
          {showWeatherStats ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-card/70 px-3 py-2.5">
              <WeatherGlyph
                iconType={weatherIconType}
                condition={weatherCondition}
                isDaytime={weatherIsDaytime}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {weatherCondition || "目前天氣"}
                  {weatherTempC != null ? (
                    <span className="ml-1.5 tabular-nums">{Math.round(weatherTempC)}°C</span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {weatherFeelsLikeC != null ? (
                    <span>體感 {Math.round(weatherFeelsLikeC)}°C</span>
                  ) : null}
                  {weatherFeelsLikeC != null && weatherPrecipPercent != null ? (
                    <span className="mx-1">·</span>
                  ) : null}
                  {weatherPrecipPercent != null ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Umbrella className="h-3 w-3" aria-hidden />
                      降雨 {Math.round(weatherPrecipPercent)}%
                    </span>
                  ) : null}
                  {!weatherIsDaytime ? <span className="ml-1">· 夜晚</span> : null}
                </p>
              </div>
            </div>
          ) : unavailable ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {ROAMIE_WEATHER_UNAVAILABLE_MESSAGE}
            </p>
          ) : null}

          {outfitTags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {outfitTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border/60 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-foreground/85"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}

          {weatherSummary && !unavailable ? (
            <p className="mt-2 text-xs text-foreground/70">{weatherSummary}</p>
          ) : null}

          {suggestion ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">{suggestion}</p>
          ) : errorMessage ? (
            <p className="mt-3 text-sm text-muted-foreground">{errorMessage}</p>
          ) : !unavailable && !weatherSummary ? (
            <p className="mt-3 text-sm text-muted-foreground">
              暫時無法取得穿搭建議，請稍後再試或確認行程目的地。
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
