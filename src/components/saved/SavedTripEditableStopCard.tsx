import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  MapPin,
  Route as RouteIcon,
  Trash2,
} from "lucide-react";
import { PlaceNavButtons } from "@/components/PlaceNavButtons";
import { RoamieDurationPicker, RoamieTimePicker } from "@/components/pickers";
import type { RoamieItineraryItem, TripPlanSettings } from "@/lib/ai/types";
import { formatDurationMinutes } from "@/lib/picker-utils";
import { navigateToTripPlaceDetail } from "@/lib/navigate-trip-place-detail";
import { SAVED_TRIP_TRANSPORT_OPTIONS } from "@/lib/saved-trip/editor-constants";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";
import { logTripPlaceCardRendered } from "@/lib/trip-place-card-log";
import { cn } from "@/lib/utils";

type Props = {
  tripId: string;
  tripDestination?: string;
  dayNumber?: number;
  sameDayStopNames?: string[];
  item: RoamieItineraryItem;
  indexInDay: number;
  dayCount: number;
  settings: TripPlanSettings;
  /** 與上一站的點到點耗時（Google Routes）；空字串則不顯示 */
  travelTimeLabel?: string;
  /** 同日上一站（地點詳情交通用 trip_sequence） */
  prevStopItem?: RoamieItineraryItem | null;
  onSetArrivalTime: (time: string) => void;
  onSetDurationMinutes: (minutes: number) => void;
  onSetTransport: (label: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
};

export function SavedTripEditableStopCard({
  tripId,
  tripDestination,
  dayNumber,
  sameDayStopNames,
  item,
  indexInDay,
  dayCount,
  settings,
  travelTimeLabel,
  prevStopItem,
  onSetArrivalTime,
  onSetDurationMinutes,
  onSetTransport,
  onMoveUp,
  onMoveDown,
  onDelete,
}: Props) {
  const navigate = useNavigate();
  const legKey = legKeyForItem(item);
  const durationMins = settings.legMinutes?.[legKey] ?? 60;
  const stayDurationLabel = `停留 ${formatDurationMinutes(durationMins)}`;
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
  const renderLoggedRef = useRef(false);
  useEffect(() => {
    if (renderLoggedRef.current) return;
    renderLoggedRef.current = true;
    logTripPlaceCardRendered({
      placeName,
      stayDurationLabel,
      buttons: ["查看地點詳情", "查看路線"],
    });
  }, [placeName, stayDurationLabel]);

  const openPlaceDetail = () => {
    void navigateToTripPlaceDetail(item, tripId, navigate, {
      destination: tripDestination,
      city: tripDestination,
      dayNumber,
      nearbyStops: sameDayStopNames,
      prevItem: prevStopItem,
    });
  };

  return (
    <article className="relative rounded-3xl border border-border bg-card p-3 pt-3 shadow-soft sm:p-4">
      {indexInDay > 0 && travelTimeLabel?.trim() ? (
        <p className="mb-2 text-xs text-muted-foreground">{travelTimeLabel}</p>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 flex-1 text-[16px] font-medium leading-snug">{placeName}</h3>
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

      {address ? (
        <p className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
          {address}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
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

        <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs">
          <Clock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">停留</span>
          <RoamieDurationPicker
            compact
            showPrefixLabel={false}
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

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openPlaceDetail}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-foreground/90 active:scale-[0.98]"
        >
          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
          查看地點詳情
        </button>
        <PlaceNavButtons
          lat={item.lat}
          lng={item.lng}
          address={item.address}
          placeName={item.placeName}
          compact
          className="mt-0"
        />
      </div>
    </article>
  );
}
