import { Lock, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useAccess } from "@/hooks/use-access";
import { usePlusUpgrade } from "@/hooks/use-plus-upgrade";
import { PlusComingSoonDialog } from "@/components/PlusComingSoonDialog";
import type { HomeNearbyPick } from "@/lib/explore-category-search";
import type { SavedPlace } from "@/lib/places-storage";
import type { TravelPreferences } from "@/lib/preferences-storage";
import type { WeatherSummary } from "@/lib/weather-types";
import { getExploreCategoryDisplayLabel } from "@/lib/place-category";

type Props = {
  prefs?: TravelPreferences | null;
  savedPlaces: SavedPlace[];
  weather?: WeatherSummary | null;
  nearbyPicks?: HomeNearbyPick[];
  selectedMood?: string | null;
  className?: string;
};

function inferMoodLine(
  weather: WeatherSummary | null | undefined,
  selectedMood: string | null | undefined,
  prefs: TravelPreferences | null | undefined,
): string {
  if (selectedMood) return `你選了「${selectedMood}」`;
  if (prefs?.vibe) return `偏好：${prefs.vibe}`;
  if (weather?.condition?.includes("雨")) return "雨天適合室內與巷弄";
  const hour = new Date().getHours();
  if (hour >= 18) return "夜晚適合夜景與小酌";
  if (hour >= 11 && hour < 14) return "中午適合午餐與咖啡";
  return "適合慢慢走、留一點空白";
}

function buildDirectionLine(
  weather: WeatherSummary | null | undefined,
  nearby: HomeNearbyPick[],
): string {
  if (weather?.condition?.includes("雨")) {
    return "推薦方向：室內咖啡、展覽、有屋簷的巷弄";
  }
  const types = nearby
    .slice(0, 6)
    .map((p) => getExploreCategoryDisplayLabel(p))
    .filter(Boolean);
  const uniq = [...new Set(types)].slice(0, 2);
  if (uniq.length) return `推薦方向：${uniq.join("、")}與順路小店`;
  return "推薦方向：咖啡、散步、在地小吃";
}

function buildSuggestions(
  nearby: HomeNearbyPick[],
  saved: SavedPlace[],
): { label: string; detail: string }[] {
  const fromNearby = nearby.slice(0, 3).map((p) => ({
    label: p.name,
    detail: p.reason?.trim() || getExploreCategoryDisplayLabel(p) || "附近走走",
  }));
  if (fromNearby.length >= 3) return fromNearby;

  const fromSaved = saved.slice(0, 3 - fromNearby.length).map((p) => ({
    label: p.name,
    detail: p.category?.trim() || "你收藏過的類型",
  }));
  return [...fromNearby, ...fromSaved];
}

export function HomePlusPersonalization({
  prefs,
  savedPlaces,
  weather,
  nearbyPicks = [],
  selectedMood,
  className,
}: Props) {
  const { hasPlusAccess } = useAccess();
  const { upgradeToPlus, comingSoonOpen, setComingSoonOpen } = usePlusUpgrade();

  const moodLine = useMemo(
    () => inferMoodLine(weather, selectedMood, prefs),
    [weather, selectedMood, prefs],
  );
  const directionLine = useMemo(
    () => buildDirectionLine(weather, nearbyPicks),
    [weather, nearbyPicks],
  );
  const suggestions = useMemo(
    () => buildSuggestions(nearbyPicks, savedPlaces),
    [nearbyPicks, savedPlaces],
  );

  if (!hasPlusAccess) {
    return (
      <section className={className}>
        <button
          type="button"
          onClick={() => upgradeToPlus()}
          className="flex w-full items-start gap-3 rounded-3xl border border-dashed border-border bg-card/50 p-5 text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-secondary">
            <Lock className="h-4 w-4 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <p className="font-display text-[17px]">讓 Roamie 更懂你</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Plus 會記住旅行風格、收藏與互動，提供更深入的個人化推薦。
            </p>
            <span className="mt-2 inline-block text-xs font-medium text-clay">
              立即升級 Plus
            </span>
          </span>
        </button>
        <PlusComingSoonDialog open={comingSoonOpen} onOpenChange={setComingSoonOpen} />
      </section>
    );
  }

  return (
    <section className={className}>
      <div className="rounded-3xl border border-clay/25 bg-gradient-to-br from-accent/50 via-card to-secondary/40 p-5 shadow-soft">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-clay" />
          <h2 className="font-display text-[17px]">Roamie 已更懂你</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{moodLine}</p>
        <p className="mt-1 text-sm font-medium text-foreground/90">{directionLine}</p>
        <ul className="mt-4 space-y-2.5">
          {suggestions.map((s) => (
            <li
              key={s.label}
              className="rounded-2xl border border-border/70 bg-background/70 px-3.5 py-2.5"
            >
              <p className="text-sm font-medium leading-snug">{s.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.detail}</p>
            </li>
          ))}
        </ul>
        {suggestions.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">先選心情或稍後，我會依附近地點給你建議。</p>
        ) : null}
      </div>
    </section>
  );
}
