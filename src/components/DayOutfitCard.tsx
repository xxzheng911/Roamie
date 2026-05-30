import { Loader2, Shirt, CloudSun } from "lucide-react";
import type { DailyOutfitAdvice, OutfitCategoryAdvice } from "@/lib/outfit/types";
import { TRIP_ACTIVITY_LABELS } from "@/lib/outfit/types";
import { formatTempRange, weatherDisplayEmoji } from "@/lib/outfit/weather-icons";
import { ROAMIE_WEATHER_UNAVAILABLE_OUTFIT } from "@/lib/weather/constants";

const CATEGORY_LABELS: { key: keyof OutfitCategoryAdvice; label: string }[] = [
  { key: "top", label: "上衣建議" },
  { key: "outerwear", label: "外套建議" },
  { key: "bottom", label: "褲裝建議" },
  { key: "footwear", label: "鞋款建議" },
];

type Props = {
  advice?: DailyOutfitAdvice;
  destination?: string;
  loading?: boolean;
  unavailable?: boolean;
  unavailableMessage?: string;
  className?: string;
  compact?: boolean;
};

function CategoryGrid({ categories, compact }: { categories: OutfitCategoryAdvice; compact?: boolean }) {
  return (
    <div className={`mt-3 grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
      {CATEGORY_LABELS.map(({ key, label }) => {
        const value = categories[key];
        if (typeof value !== "string" || !value.trim() || /可不穿/.test(value)) return null;
        return (
          <div
            key={key}
            className="rounded-xl border border-border/70 bg-card/80 px-3 py-2.5"
          >
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm font-medium leading-snug text-foreground">{value}</p>
          </div>
        );
      })}
      {categories.accessories.length > 0 ? (
        <div className="rounded-xl border border-border/70 bg-card/80 px-3 py-2.5 sm:col-span-2">
          <p className="text-[11px] font-medium text-muted-foreground">其他配件</p>
          <p className="mt-0.5 text-sm leading-snug text-foreground">
            {categories.accessories.join("、")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function DayOutfitCard({
  advice,
  destination,
  loading,
  unavailable,
  unavailableMessage = ROAMIE_WEATHER_UNAVAILABLE_OUTFIT,
  className = "",
  compact,
}: Props) {
  if (loading) {
    return (
      <div
        className={`rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4 ${className}`}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span aria-hidden>👕</span>
          今日穿搭建議
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          依天氣產生穿搭建議中…
        </div>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div
        className={`rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4 ${className}`}
      >
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span aria-hidden>👕</span>
          今日穿搭建議
        </div>
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{unavailableMessage}</p>
      </div>
    );
  }

  if (!advice) {
    return null;
  }

  const emoji = weatherDisplayEmoji(advice.weather);
  const temp = formatTempRange(advice.weather);
  const diff = advice.weather.diurnalRangeC;
  const destLabel = destination?.trim();

  return (
    <div
      className={`rounded-2xl border border-border/80 bg-gradient-to-br from-secondary/60 to-card p-4 ${className}`}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <span aria-hidden>👕</span>
        今日穿搭建議
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {destLabel ? (
          <span className="font-medium text-foreground">{destLabel}</span>
        ) : null}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 shadow-soft">
          <span aria-hidden>{emoji}</span>
          <span className="font-medium">{temp}</span>
          <span className="text-muted-foreground">{advice.weather.condition}</span>
        </span>
        {advice.weather.precipProbability != null ? (
          <span className="text-xs text-muted-foreground">
            降雨 {Math.round(advice.weather.precipProbability)}%
          </span>
        ) : null}
        {diff != null && diff >= 6 && (
          <span className="text-xs text-muted-foreground">溫差約 {Math.round(diff)}°C</span>
        )}
      </div>

      {advice.categories ? (
        <CategoryGrid categories={advice.categories} compact={compact} />
      ) : (
        <div className="mt-3 flex items-start gap-2">
          <Shirt className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
          <p className="text-[15px] font-medium leading-snug">{advice.outfitSummary}</p>
        </div>
      )}

      {!advice.categories && advice.packingReminders.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
          {advice.packingReminders.map((item, i) => (
            <li key={i} className="text-sm text-foreground/80">
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      <p
        className={`mt-2.5 leading-relaxed text-foreground/75 ${compact ? "text-[13px]" : "text-sm"}`}
      >
        {advice.narrative}
      </p>

      {advice.activityTypes.length > 0 ? (
        <p className="mt-2.5 text-[11px] text-muted-foreground">
          今日行程：
          {advice.activityTypes.map((t) => TRIP_ACTIVITY_LABELS[t]).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
