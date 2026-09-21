import { useI18n } from "@/hooks/use-i18n";
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
  const { t: uiT } = useI18n();

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
          <span className="shrink-0 text-muted-foreground">{uiT("productionUi.p7b80d07823")}</span>
          <RoamieTimePicker
            compact
            inline
            title={uiT("productionUi.p6081a12224")}
            value={arrivalTime}
            onChange={onSetArrivalTime}
            className="font-medium text-foreground"
          />
        </div>

        <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary/70 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">{uiT("productionUi.pf317313492")}</span>
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
          {uiT("productionUi.p4e6e23af51")}
        </button>
      ) : null}
    </div>
  );
}
