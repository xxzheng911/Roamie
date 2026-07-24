import { TripTransportPicker } from "@/components/saved/TripTransportPicker";
import { JAPAN_TRANSIT_MAPS_BUTTON_LABEL } from "@/lib/saved-trip/japan-transit-maps";
import type { TripTransportOptionLabel } from "@/lib/saved-trip/transport-options";

const mapsBtnClass =
  "inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[10px]";

type Props = {
  /** Displayed mode — must be resolvedMode (SoT), not stale preference. */
  transport: string;
  travelTimeLabel?: string;
  walkFallbackHint?: string | null;
  onTransportChange: (label: TripTransportOptionLabel) => void;
  onOpenTransitMaps?: (() => void) | null;
};

/** 兩張地點卡片之間：交通方式 + 路程時間（兩者皆依 resolvedMode） */
export function TripLegTransportConnector({
  transport,
  travelTimeLabel,
  walkFallbackHint,
  onTransportChange,
  onOpenTransitMaps,
}: Props) {
  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-4 w-px bg-border/80" aria-hidden />
      <div className="flex flex-col items-center gap-1 py-2">
        <TripTransportPicker
          variant="leg"
          value={transport}
          onChange={onTransportChange}
        />
        {travelTimeLabel ? (
          <p className="text-center text-[11px] text-muted-foreground">{travelTimeLabel}</p>
        ) : null}
        {onOpenTransitMaps ? (
          <button type="button" className={mapsBtnClass} onClick={onOpenTransitMaps}>
            {JAPAN_TRANSIT_MAPS_BUTTON_LABEL}
          </button>
        ) : null}
        {walkFallbackHint ? (
          <p className="text-center text-[10px] text-muted-foreground/80">{walkFallbackHint}</p>
        ) : null}
      </div>
      <div className="h-4 w-px bg-border/80" aria-hidden />
    </div>
  );
}
