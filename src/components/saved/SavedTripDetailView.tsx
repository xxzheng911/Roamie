import { useMemo, useState } from "react";
import { Bookmark, Calendar, MapPin, Users, Route as RouteIcon } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { SavedTripStopCard } from "@/components/saved/SavedTripStopCard";
import { formatSavedTripDateRange, formatSavedTripDayLabel } from "@/lib/saved-trip/normalize";
import type { SavedTripView } from "@/lib/saved-trip/types";
import { cn } from "@/lib/utils";

type Props = {
  trip: SavedTripView;
  headerRight?: React.ReactNode;
};

export function SavedTripDetailView({ trip, headerRight }: Props) {
  const dayNumbers = useMemo(
    () => (trip.days.length > 0 ? trip.days.map((d) => d.dayNumber) : [1]),
    [trip.days],
  );
  const [activeDay, setActiveDay] = useState(dayNumbers[0] ?? 1);

  const active = trip.days.find((d) => d.dayNumber === activeDay) ?? trip.days[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-background/95 px-5 pb-4 pt-3 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <BackButton
            fallback={{ to: "/saved", search: { tab: "trips" } }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary"
          />
          {headerRight ?? <span className="w-9" />}
        </div>

        <p className="mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">收藏行程</p>
        <h1 className="mt-1 font-display text-[22px] leading-snug">{trip.displayTitle}</h1>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <Calendar className="h-3 w-3" />
            {formatSavedTripDateRange(trip)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <MapPin className="h-3 w-3" />
            {trip.destination}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <Users className="h-3 w-3" />
            {trip.companionCount}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary/80 px-2.5 py-1">
            <RouteIcon className="h-3 w-3" />
            {trip.transportMode}
          </span>
          {trip.isSaved ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-clay/10 px-2.5 py-1 text-clay">
              <Bookmark className="h-3 w-3 fill-current" />
              已收藏
            </span>
          ) : null}
        </div>

        {trip.summary ? (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{trip.summary}</p>
        ) : null}
      </header>

      <div className="shrink-0 border-b border-border bg-background/90 px-5 py-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {dayNumbers.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setActiveDay(n)}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-sm transition",
                activeDay === n
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-muted-foreground",
              )}
            >
              第 {n} 天
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-5 no-scrollbar">
        {active ? (
          <>
            <h2 className="text-sm font-medium text-foreground/90">
              {formatSavedTripDayLabel(active)}
            </h2>
            {active.items.length === 0 ? (
              <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 px-4 py-8 text-center text-sm text-muted-foreground">
                這一天還沒有安排地點，可以回到聊天請 Roamie 幫你補上。
              </p>
            ) : (
              <div className="relative mt-4 border-l border-dashed border-border pl-5">
                {active.items.map((item, i) => (
                  <SavedTripStopCard
                    key={item.id}
                    item={item}
                    isLast={i === active.items.length - 1}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">尚無每日行程內容</p>
        )}
      </div>
    </div>
  );
}
