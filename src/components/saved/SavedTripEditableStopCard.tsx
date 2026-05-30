import { ChevronDown, ChevronUp, Clock, MapPin, Route as RouteIcon, Trash2 } from "lucide-react";
import { PlaceAffiliateLinks } from "@/components/affiliate/PlaceAffiliateLinks";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { RoamieDurationPicker, RoamieTimePicker } from "@/components/pickers";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { SAVED_TRIP_TRANSPORT_OPTIONS } from "@/lib/saved-trip/editor-constants";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";
import { cn } from "@/lib/utils";

type Props = {
  item: RoamieItineraryItem;
  indexInDay: number;
  dayCount: number;
  settings: TripPlanSettings;
  /** 與上一站的點到點耗時（Google Routes） */
  travelTimeLabel?: string;
  travelTimeLoading?: boolean;
  onSetArrivalTime: (time: string) => void;
  onSetDurationMinutes: (minutes: number) => void;
  onSetTransport: (label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
};

export function SavedTripEditableStopCard({
  item,
  indexInDay,
  dayCount,
  settings,
  travelTimeLabel,
  travelTimeLoading,
  onSetArrivalTime,
  onSetDurationMinutes,
  onSetTransport,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Props) {
  const legKey = legKeyForItem(item);
  const durationMins = settings.legMinutes?.[legKey] ?? 60;
  const transport =
    settings.legTransport?.[legKey] ??
    (settings.transport === "walk"
      ? "步行"
      : settings.transport === "drive"
        ? "開車"
        : settings.transport === "transit"
          ? "大眾運輸"
          : settings.transport === "scooter"
            ? "機車"
            : "步行");
  const customTransport = !SAVED_TRIP_TRANSPORT_OPTIONS.includes(
    transport as (typeof SAVED_TRIP_TRANSPORT_OPTIONS)[number],
  );
  const placeName = item.placeName || item.title;
  const address = item.address?.trim();

  return (
    <article className="relative rounded-3xl border border-border bg-card p-4 shadow-soft">
      {indexInDay > 0 && travelTimeLabel ? (
        <p className="mb-3 text-xs text-muted-foreground">
          {travelTimeLoading ? "計算路程中…" : travelTimeLabel}
        </p>
      ) : null}

      <div className="mb-2 flex items-center justify-end gap-1">
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

      <h3 className="text-[16px] font-medium leading-snug">{placeName}</h3>
      {address ? (
        <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {address}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">抵達</span>
          <RoamieTimePicker
            compact
            title="抵達時間"
            value={item.time?.slice(0, 5) || "10:00"}
            onChange={onSetArrivalTime}
          />
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span>停留</span>
          <RoamieDurationPicker
            valueMinutes={durationMins}
            onChangeMinutes={onSetDurationMinutes}
          />
        </div>

        <label className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1.5 text-xs">
          <RouteIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">交通</span>
          <select
            value={customTransport ? "__custom__" : transport}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") onSetTransport("");
              else onSetTransport(v);
            }}
            className="bg-transparent text-sm font-medium focus:outline-none"
          >
            {SAVED_TRIP_TRANSPORT_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            <option value="__custom__">自訂…</option>
          </select>
        </label>
      </div>

      {customTransport || transport === "" ? (
        <input
          type="text"
          value={transport}
          onChange={(e) => onSetTransport(e.target.value)}
          placeholder="輸入交通方式"
          className={cn(
            "mt-2 w-full rounded-xl border border-border bg-background/60 px-3 py-2 text-sm",
            "focus:outline-none focus:ring-2 focus:ring-primary/20",
          )}
        />
      ) : null}

      <PlaceAffiliateLinks
        placeName={placeName}
        source="trip_detail"
        placeTypeHints={{
          typeLabel: item.placeType,
          placeName: item.title,
        }}
        compact
        className="mt-3"
      />
      <PlaceNavButtons
        lat={item.lat}
        lng={item.lng}
        address={item.address}
        placeName={item.placeName}
        compact
        className="mt-2"
      />
    </article>
  );
}
