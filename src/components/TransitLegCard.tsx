import {
  Bus,
  Car,
  Footprints,
  TrainFront,
  Navigation,
} from "lucide-react";
import type { TransitLegAdvice, TransitMode } from "@/lib/transit/types";
import { getTransitModeLabel } from "@/lib/transit/recommend-leg";

function ModeIcon({ mode }: { mode: TransitMode }) {
  const cls = "h-4 w-4 shrink-0 text-foreground/80";
  switch (mode) {
    case "walk":
      return <Footprints className={cls} />;
    case "bus":
      return <Bus className={cls} />;
    case "subway":
    case "transit":
    case "hsr":
    case "train":
      return <TrainFront className={cls} />;
    case "taxi":
    case "uber":
    case "drive":
    case "scooter":
      return <Car className={cls} />;
    default:
      return <Navigation className={cls} />;
  }
}

type Props = {
  leg: TransitLegAdvice;
  className?: string;
};

/** 地點之間的智慧交通建議 */
export function TransitLegCard({ leg, className = "" }: Props) {
  return (
    <div
      className={`rounded-2xl border border-border/80 bg-secondary/50 px-3 py-2.5 ${className}`}
    >
      <div className="flex items-start gap-2">
        <ModeIcon mode={leg.recommendedMode} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug text-foreground">{leg.headline}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{leg.reason}</p>
          {leg.alternatives && leg.alternatives.length > 0 && (
            <p className="mt-1.5 text-[10px] text-muted-foreground/80">
              也可考慮：
              {leg.alternatives
                .map((a) => `${getTransitModeLabel(a.mode)} 約 ${a.durationMinutes} 分`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
