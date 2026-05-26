import { Cloud, MapPin, RefreshCw } from "lucide-react";
import type { HomeWeatherStatus } from "@/hooks/use-home-weather";
import type { WeatherSummary } from "@/lib/weather-types";
import { formatWeatherTemp, weatherSummaryEmoji } from "@/lib/weather-display";

type HomeWeatherCardProps = {
  weather: WeatherSummary | null;
  status: HomeWeatherStatus;
  error: string | null;
  usedFallbackLocation: boolean;
  showOpenLocationSettings?: boolean;
  onRetry: () => void;
  onOpenLocationSettings?: () => void;
  labels: {
    title: string;
    loading: string;
    errorTitle: string;
    errorHint: string;
    retry: string;
    placeholderTitle: string;
    placeholderHint: string;
    fallbackLocationHint: string;
    openLocationSettings: string;
    todayLabel: string;
    moodHint: string;
  };
};

function WeatherSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="loading">
      <div className="h-3 w-28 animate-pulse rounded-full bg-muted/60" />
      <div className="h-7 w-3/4 max-w-[240px] animate-pulse rounded-xl bg-muted/50" />
      <div className="h-4 w-full max-w-[280px] animate-pulse rounded-full bg-muted/40" />
    </div>
  );
}

export function HomeWeatherCard({
  weather,
  status,
  error,
  usedFallbackLocation,
  showOpenLocationSettings = false,
  onRetry,
  onOpenLocationSettings,
  labels,
}: HomeWeatherCardProps) {
  if (status === "loading") {
    return (
      <div className="mt-8 rounded-3xl bg-secondary p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Cloud className="h-4 w-4 opacity-60" />
          <span>{labels.loading}</span>
        </div>
        <div className="mt-3">
          <WeatherSkeleton />
        </div>
      </div>
    );
  }

  if (status === "ready" && weather) {
    const temp = formatWeatherTemp(weather);
    const emoji = weatherSummaryEmoji(weather);
    return (
      <div className="mt-8 rounded-3xl bg-secondary p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden>{emoji}</span>
          <span>
            {labels.todayLabel} · {weather.city}
            {temp ? ` · ${weather.condition} ${temp}` : ` · ${weather.condition}`}
          </span>
        </div>
        <h3 className="mt-2 font-display text-xl leading-snug">{weather.recommendationText}</h3>
        {usedFallbackLocation && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <p className="flex items-center gap-1 text-xs text-muted-foreground/90">
              <MapPin className="h-3 w-3 shrink-0" />
              {labels.fallbackLocationHint}
            </p>
            {showOpenLocationSettings && onOpenLocationSettings ? (
              <button
                type="button"
                onClick={onOpenLocationSettings}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground"
              >
                {labels.openLocationSettings}
              </button>
            ) : null}
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">{labels.moodHint}</p>
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-3xl border border-dashed border-border/80 bg-secondary/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Cloud className="h-4 w-4 opacity-70" />
            <span>{labels.title}</span>
          </div>
          <h3 className="mt-2 font-display text-xl leading-snug text-foreground/90">
            {error ? labels.errorTitle : labels.placeholderTitle}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {labels.placeholderHint}
          </p>
          {usedFallbackLocation && (
            <div className="mt-2 space-y-2">
              <p className="flex items-center gap-1 text-xs text-muted-foreground/90">
                <MapPin className="h-3 w-3 shrink-0" />
                {labels.fallbackLocationHint}
              </p>
              {showOpenLocationSettings && onOpenLocationSettings ? (
                <button
                  type="button"
                  onClick={onOpenLocationSettings}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  {labels.openLocationSettings}
                </button>
              ) : null}
            </div>
          )}
          {error && (
            <p className="mt-2 rounded-xl bg-background/80 px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive/90">
              {error}
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-muted-foreground/70">{labels.errorHint}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-2 text-xs font-medium text-foreground shadow-soft"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {labels.retry}
        </button>
      </div>
    </div>
  );
}
