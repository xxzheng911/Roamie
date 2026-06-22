import { Clock, Route } from "lucide-react";
import { RoamieDurationPicker, RoamieTimePicker } from "@/components/pickers";
import {
  buildDirectionsUrl,
  buildDirectionsUrlFromQuery,
  openExternal,
} from "@/lib/maps-navigation";

type Props = {
  arrivalTime: string;
  durationMinutes: number;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  placeName?: string;
  onSetArrivalTime: (time: string) => void;
  onSetDurationMinutes: (minutes: number) => void;
};

/** 行程內頁地點卡第二列：抵達／停留膠囊（左）＋ 查看路線按鈕（右） */
export function TripLocationCard({
  arrivalTime,
  durationMinutes,
  lat,
  lng,
  address,
  placeName,
  onSetArrivalTime,
  onSetDurationMinutes,
}: Props) {
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const label = placeName ?? address ?? "目的地";
  const navUrl = hasCoords
    ? buildDirectionsUrl({ lat: lat!, lng: lng! })
    : address || label
      ? buildDirectionsUrlFromQuery(address || label)
      : null;

  return (
    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">抵達</span>
          <RoamieTimePicker
            compact
            inline
            title="抵達時間"
            value={arrivalTime}
            onChange={onSetArrivalTime}
            className="font-medium text-foreground"
          />
        </div>

        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">停留</span>
          <RoamieDurationPicker
            inline
            hideLabel
            valueMinutes={durationMinutes}
            onChangeMinutes={onSetDurationMinutes}
            className="font-medium text-foreground"
          />
        </div>
      </div>

      {navUrl ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-foreground transition active:opacity-70"
          onClick={() => openExternal(navUrl)}
        >
          <Route className="h-3.5 w-3.5" />
          查看路線
        </button>
      ) : null}
    </div>
  );
}
