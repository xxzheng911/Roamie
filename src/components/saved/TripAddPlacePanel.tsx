import { Sparkles } from "lucide-react";
import { TripStopSearchField } from "@/components/TripStopSearchField";
import type { TripPlaceInput } from "@/lib/trip/trip-place-input";
import { cn } from "@/lib/utils";

export type TripAddPlaceMode = "menu" | "manual";

type Props = {
  mode: TripAddPlaceMode;
  onSelectMode: (mode: "favorites" | "manual" | "roamie") => void;
  onPickPlace: (place: TripPlaceInput) => void;
  onCollapse: () => void;
};

export function TripAddPlacePanel({ mode, onSelectMode, onPickPlace, onCollapse }: Props) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/80 p-3">
      {mode === "menu" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSelectMode("favorites")}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-left text-sm font-medium"
          >
            從收藏新增
          </button>
          <button
            type="button"
            onClick={() => onSelectMode("manual")}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-left text-sm font-medium"
          >
            自行輸入地點
          </button>
          <button
            type="button"
            onClick={() => onSelectMode("roamie")}
            className={cn(
              "inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-3 text-sm font-medium",
            )}
          >
            <Sparkles className="h-4 w-4" />
            請 Roamie 幫我安排
          </button>
        </div>
      ) : (
        <TripStopSearchField variant="inline" onPick={onPickPlace} />
      )}
      <button
        type="button"
        onClick={onCollapse}
        className="w-full text-center text-xs text-muted-foreground"
      >
        收合
      </button>
    </div>
  );
}
