import { useI18n } from "@/hooks/use-i18n";
import { Route } from "lucide-react";
import { formatTimeDisplay } from "@/lib/picker-utils";
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
  const { t: uiT } = useI18n();

  // Display only: retain the picker’s existing minute arithmetic (no rounding).
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const durationLabel = hours <= 0
    ? uiT("nativeQa.stayMinutesCompact", { minutes })
    : minutes === 0
      ? uiT("nativeQa.stayHoursCompact", { hours })
      : uiT("nativeQa.stayHoursMinutesCompact", { hours, minutes });

  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng);
  const label = placeName ?? address ?? "目的地";
  const navUrl = hasCoords
    ? buildDirectionsUrl({ lat: lat!, lng: lng! })
    : address || label
      ? buildDirectionsUrlFromQuery(address || label)
      : null;

  return (
    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
      <div role="group" aria-label={uiT("nativeQa.arriveCompact")} className="relative inline-flex min-w-0 max-w-full items-center rounded-full bg-secondary/70 px-2.5 text-sm">
        <span aria-hidden="true" className="pointer-events-none py-3">
          {uiT("nativeQa.arriveCompact")} {formatTimeDisplay(arrivalTime)}
        </span>
        <RoamieTimePicker
          compact
          inline
          title={uiT("productionUi.p6081a12224")}
          value={arrivalTime}
          onChange={onSetArrivalTime}
          className="absolute inset-0 min-h-11 w-full rounded-full !text-transparent"
        />
      </div>

      <div className="relative inline-flex min-w-0 max-w-full items-center rounded-full bg-secondary/70 px-2.5 text-sm">
        <span aria-hidden="true" className="pointer-events-none py-3">{durationLabel}</span>
        <RoamieDurationPicker
          inline
          valueMinutes={durationMinutes}
          onChangeMinutes={onSetDurationMinutes}
          className="absolute inset-0 min-h-11 w-full rounded-full [&>span]:sr-only"
        />
      </div>

      {navUrl ? (
        <button
          type="button"
          className="inline-flex max-w-full flex-wrap items-center justify-center gap-1 rounded-full border border-border bg-card min-h-11 px-2.5 py-2 text-sm font-medium text-foreground transition active:opacity-70"
          onClick={() => openExternal(navUrl)}
        >
          <Route className="h-3.5 w-3.5 shrink-0" />
          {uiT("nativeQa.directionsCompact")}
        </button>
      ) : null}
    </div>
  );
}
