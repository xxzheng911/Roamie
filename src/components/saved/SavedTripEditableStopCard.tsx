import { ChevronDown, ChevronUp, Clock, MapPin, Trash2 } from "lucide-react";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { RoamieDurationPicker, RoamieTimePicker } from "@/components/pickers";
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
  onDelete: () => void;
};

/** 行程內頁地點卡 — 獨立於聊天／探索／首頁推薦卡片，請勿共用其排版 */
export function SavedTripEditableStopCard({
  item,
  indexInDay,
  dayCount,
  settings,
  onSetArrivalTime,
  onSetDurationMinutes,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Props) {
  const legKey = legKeyForItem(item);
  const durationMins = settings.legMinutes?.[legKey] ?? 60;
  const placeName = item.placeName || item.title;
  const address = item.address?.trim();

  return (
    <article className="relative rounded-3xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] font-medium leading-snug">{placeName}</h3>
          {address ? (
            <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              {address}
            </p>
          ) : null}
        </div>
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

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">抵達</span>
          <RoamieTimePicker
            compact
            title="抵達時間"
            value={item.time?.slice(0, 5) || "10:00"}
            onChange={onSetArrivalTime}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">停留</span>
          <RoamieDurationPicker
            valueMinutes={durationMins}
            onChangeMinutes={onSetDurationMinutes}
          />
        </div>
      </div>

      <PlaceNavButtons
        lat={item.lat}
        lng={item.lng}
        address={item.address}
        placeName={item.placeName}
        compact
        className="mt-3"
      />
    </article>
  );
}
