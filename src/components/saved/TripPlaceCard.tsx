import { ArrowRightLeft, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { TripLocationCard } from "@/components/saved/TripLocationCard";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";

type Props = {
  item: RoamieItineraryItem;
  indexInDay: number;
  dayCount: number;
  settings: TripPlanSettings;
  onSetArrivalTime: (time: string) => void;
  onSetDurationMinutes: (minutes: number) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onCrossDayMove?: () => void;
  crossDayMoveDisabled?: boolean;
  onDelete: () => void;
  onOpenPlaceDetail?: () => void;
};

/** 行程內頁地點卡 — 獨立於聊天／探索／首頁推薦卡片，請勿共用其排版 */
export function TripPlaceCard({
  item,
  indexInDay,
  dayCount,
  settings,
  onSetArrivalTime,
  onSetDurationMinutes,
  onMoveUp,
  onMoveDown,
  onCrossDayMove,
  crossDayMoveDisabled = false,
  onDelete,
  onOpenPlaceDetail,
}: Props) {
  const legKey = legKeyForItem(item);
  const durationMins = settings.legMinutes?.[legKey] ?? 60;
  const placeName = item.placeName || item.title;

  return (
    <article className="relative rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        {onOpenPlaceDetail ? (
          <button
            type="button"
            onClick={onOpenPlaceDetail}
            className="min-w-0 flex-1 text-left font-display text-lg font-bold leading-snug text-foreground underline-offset-2 hover:underline"
          >
            {placeName}
          </button>
        ) : (
          <h3 className="min-w-0 flex-1 font-display text-lg font-bold leading-snug text-foreground">
            {placeName}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="上移"
            disabled={indexInDay === 0}
            onClick={onMoveUp}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 disabled:opacity-40"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="下移"
            disabled={indexInDay >= dayCount - 1}
            onClick={onMoveDown}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 disabled:opacity-40"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          {onCrossDayMove ? (
            <button
              type="button"
              aria-label="跨天移動"
              disabled={crossDayMoveDisabled}
              onClick={onCrossDayMove}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground disabled:opacity-40"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="刪除地點"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <TripLocationCard
        arrivalTime={item.time?.slice(0, 5) || "10:00"}
        durationMinutes={durationMins}
        lat={item.lat}
        lng={item.lng}
        address={item.address}
        placeName={item.placeName}
        onSetArrivalTime={onSetArrivalTime}
        onSetDurationMinutes={onSetDurationMinutes}
      />
    </article>
  );
}
