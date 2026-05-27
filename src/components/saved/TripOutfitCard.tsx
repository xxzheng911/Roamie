import { CloudSun, Loader2, Moon, Shirt, Sun, Umbrella } from "lucide-react";
import { ROAMIE_WEATHER_UNAVAILABLE_MESSAGE } from "@/lib/weather/constants";
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
  const dateLabel = formatTripDateRangeLabel(dateRange.start, dateRange.end);
  const unavailable = weatherSource === "unavailable";

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Shirt className="h-3.5 w-3.5 text-clay" />
        這趟旅程怎麼穿？
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 shadow-soft">
          {weatherIcon(weatherSummary, weatherSource)}
          <span>{destination}</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-card/80 px-2.5 py-1">
          {dateLabel}
        </span>
      </div>

      {loading ? (
        <div className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-clay" />
          <p className="leading-relaxed">正在幫你看看這趟旅程適合怎麼穿…</p>
        </div>
      ) : (
        <>
          {unavailable && !weatherSummary ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {ROAMIE_WEATHER_UNAVAILABLE_MESSAGE}
            </p>
          ) : null}

          {weatherSummary ? (
            <p className={cn("text-sm text-foreground/75", unavailable ? "mt-2" : "mt-3")}>
              {weatherSummary}
            </p>
          ) : null}

          {suggestion ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">{suggestion}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
