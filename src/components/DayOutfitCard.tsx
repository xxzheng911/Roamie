import { Shirt, CloudSun } from "lucide-react";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
import { TRIP_ACTIVITY_LABELS } from "@/lib/outfit/types";
import { formatTempRange, weatherDisplayEmoji } from "@/lib/outfit/weather-icons";

function formatPackingLine(item: string): string {
  if (/^[☀️🌧️👕👟🧥☔⛱️🎒]/.test(item)) return item;
  if (/雨|傘/.test(item)) return `☔ ${item}`;
  if (/鞋|走|步/.test(item)) return `👟 ${item}`;
  if (/衣|穿|外套|褲/.test(item)) return `👕 ${item}`;
  return `🎒 ${item}`;
}

type Props = {
  advice: DailyOutfitAdvice;
  className?: string;
  compact?: boolean;
};

export function DayOutfitCard({ advice, className = "", compact }: Props) {
  const emoji = weatherDisplayEmoji(advice.weather);
  const temp = formatTempRange(advice.weather);
  const diff = advice.weather.diurnalRangeC;

  return (
    <div
      className={`rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4 ${className}`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <CloudSun className="h-3.5 w-3.5 text-clay" />
        今日穿搭建議
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 shadow-soft">
          <span aria-hidden>{emoji}</span>
          <span className="font-medium">{temp}</span>
          <span className="text-muted-foreground">{advice.weather.condition}</span>
        </span>
        {diff != null && diff >= 6 && (
          <span className="text-xs text-muted-foreground">溫差約 {Math.round(diff)}°C</span>
        )}
      </div>

      <div className="mt-3 flex items-start gap-2">
        <Shirt className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
        <p className="text-[15px] font-medium leading-snug">{advice.outfitSummary}</p>
      </div>

      <p
        className={`mt-2.5 leading-relaxed text-foreground/85 ${compact ? "text-[13px]" : "text-sm"}`}
      >
        {advice.narrative}
      </p>

      {advice.packingReminders.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {advice.packingReminders.map((item, i) => (
            <li key={i} className="text-sm text-foreground/80">
              {formatPackingLine(item)}
            </li>
          ))}
        </ul>
      )}

      {advice.activityTypes.length > 0 && (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          今日行程：
          {advice.activityTypes.map((t) => TRIP_ACTIVITY_LABELS[t]).join(" · ")}
        </p>
      )}
    </div>
  );
}
