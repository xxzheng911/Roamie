import { LOCALIZED_ACTION_BUTTON } from "@/lib/localized-action-layout";
import { TripTransportPicker } from "@/components/saved/TripTransportPicker";
import { useI18n } from "@/hooks/use-i18n";
import type { TripTransportOptionLabel } from "@/lib/saved-trip/transport-options";

const mapsBtnClass = LOCALIZED_ACTION_BUTTON;

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
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center py-1">
      <div className="h-4 w-px bg-border/80" aria-hidden />
      <div className="flex w-full min-w-0 flex-col items-center gap-1 py-2">
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
            {t("nativeQa.route")}
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
