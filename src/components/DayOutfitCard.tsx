import { dailyOutfitDisplay } from "@/lib/outfit/localized-outfit-copy";
import { useI18n } from "@/hooks/use-i18n";
import { Shirt, CloudSun } from "lucide-react";
import type { DailyOutfitAdvice } from "@/lib/outfit/types";
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

export function DayOutfitCard({ advice: storedAdvice, className = "", compact }: Props) {
  const { t: uiT, locale } = useI18n();
  const advice = dailyOutfitDisplay(storedAdvice, locale);

  const emoji = weatherDisplayEmoji(advice.weather);
  const temp = formatTempRange(advice.weather);
  const diff = advice.weather.diurnalRangeC;

  return (
    <div
      className={`rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4 ${className}`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <CloudSun className="h-3.5 w-3.5 text-clay" />
        {uiT("productionUi.pa6ab935b12")}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 shadow-soft">
          <span aria-hidden>{emoji}</span>
          <span className="font-medium">{temp}</span>
          <span className="text-muted-foreground">{advice.weather.condition}</span>
        </span>
        {diff != null && diff >= 6 && (
          <span className="text-xs text-muted-foreground">
            {uiT("productionUi.p54b075bdd3", { v0: Math.round(diff) })}
          </span>
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
          {uiT("productionUi.pbc1c91e808", {
            v0: advice.activityTypes.map((t) => uiT(`destinationEditorial.activity_${t}`)).join(" · "),
          })}
        </p>
      )}
    </div>
  );
}
