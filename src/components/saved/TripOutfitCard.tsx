import { useI18n } from "@/hooks/use-i18n";
import { CloudSun, Loader2, Moon, Shirt, Sun, Umbrella } from "lucide-react";
import { unavailableTripWeatherCopy } from "@/lib/outfit/trip-weather-policy";
import { climateCopy } from "@/lib/outfit/local-trip-outfit-fallback";
import { formatTripDateRangeLabel } from "@/lib/outfit/trip-outfit-context";
import type { TripWeatherSource } from "@/lib/outfit/types";
import { cn } from "@/lib/utils";

type Props = {
  destination: string;
  dateRange: { start: string; end: string };
  weatherSummary?: string;
  weatherSource?: TripWeatherSource;
  suggestion?: string;
  loading?: boolean;
  className?: string;
};

function isRedundantWeatherSummary(summary?: string, weatherSource?: TripWeatherSource): boolean {
  if (!summary?.trim()) return true;
  if (weatherSource === "fallback") return true;
  return /依出發月份整理的穿著參考/.test(summary);
}

function weatherIcon(summary?: string, weatherSource?: TripWeatherSource) {
  if (weatherSource === "unavailable") {
    return <CloudSun className="h-3.5 w-3.5 text-clay" aria-hidden />;
  }
  const text = summary ?? "";
  if (/雨|雷|陣雨/.test(text)) {
    return <Umbrella className="h-3.5 w-3.5 text-clay" aria-hidden />;
  }
  if (/炎熱|溫暖|晴|3[0-9]°C|紫外線/.test(text)) {
    return <Sun className="h-3.5 w-3.5 text-clay" aria-hidden />;
  }
  if (/偏冷|寒冷|雪/.test(text)) {
    return <Moon className="h-3.5 w-3.5 text-clay" aria-hidden />;
  }
  return <CloudSun className="h-3.5 w-3.5 text-clay" aria-hidden />;
}

export function TripOutfitCard({
  destination,
  dateRange,
  weatherSummary,
  weatherSource,
  suggestion,
  loading,
  className,
}: Props) {
  const { t: uiT, locale } = useI18n();

  const dateLabel = formatTripDateRangeLabel(dateRange.start, dateRange.end);
  const unavailable = weatherSource === "unavailable";
  const historical = weatherSource === "visual-crossing-stats";
  // Display-only normalization also covers summaries already saved before this UI change.
  const displaySummary = historical
    ? weatherSummary?.replace(` · ${climateCopy[locale].meaning}`, "")
    : weatherSummary;
  const disclaimer = climateCopy[locale].disclaimer;
  const displaySuggestion = historical && suggestion?.trimEnd().endsWith(disclaimer)
    ? suggestion.trimEnd().slice(0, -disclaimer.length).trimEnd()
    : suggestion;
  const showWeatherSummary = !isRedundantWeatherSummary(weatherSummary, weatherSource);
  const iconHint = showWeatherSummary ? weatherSummary : suggestion;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Shirt className="h-3.5 w-3.5 text-clay" />
        {uiT("productionUi.pcde45d51ba")}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 shadow-soft">
          {weatherIcon(iconHint, weatherSource)}
          <span>{destination}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1">
          {dateLabel}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-clay" />
          <p className="leading-relaxed">{uiT("productionUi.p7ec3554264")}</p>
        </div>
      ) : (
        <>
          {unavailable && !weatherSummary && !suggestion ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {unavailableTripWeatherCopy(locale)}
            </p>
          ) : null}

          {showWeatherSummary ? (
            <p className={cn("text-sm text-foreground/75", unavailable ? "mt-2" : "mt-3")}>
              {displaySummary}
            </p>
          ) : null}

          {suggestion ? (
            <p
              className={cn(
                "text-sm leading-relaxed text-foreground/90",
                (unavailable || weatherSource === "visual-crossing-stats") && "whitespace-pre-line",
                showWeatherSummary ? "mt-3" : "mt-4",
              )}
            >
              {displaySuggestion}
            </p>
          ) : (
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {uiT("productionUi.p7ec3554264")}
            </p>
          )}
          {weatherSource === "visual-crossing-stats" ? (
            <>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{disclaimer}</p>
              <a className="mt-4 block w-fit text-[11px] leading-relaxed text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href="https://www.visualcrossing.com/" target="_blank" rel="noopener noreferrer">
                {climateCopy[locale].source}
              </a>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
