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
  destination?: string | null;
  searchCenter?: { lat: number; lng: number } | null;
};

const menuBtnClass =
  "flex w-full min-h-[3rem] items-center justify-center rounded-xl border border-border bg-background px-4 py-3 text-center text-sm font-medium";

export function TripAddPlacePanel({
  mode,
  onSelectMode,
  onPickPlace,
  onCollapse,
  destination,
  searchCenter,
}: Props) {
  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/80 p-3">
      {mode === "menu" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSelectMode("favorites")}
            className={menuBtnClass}
          >
            <span className="w-full text-center">從收藏新增</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectMode("manual")}
            className={menuBtnClass}
          >
            <span className="w-full text-center">自行輸入地點</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectMode("roamie")}
            className={cn(menuBtnClass, "gap-1.5 text-primary")}
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-center">讓 Roamie 幫我安排</span>
          </button>
        </div>
      ) : (
        <TripStopSearchField
          variant="inline"
          destination={destination}
          center={searchCenter}
          onPick={onPickPlace}
        />
      )}
      <button
        type="button"
        onClick={onCollapse}
        className="flex w-full items-center justify-center py-1 text-center text-xs text-muted-foreground"
      >
        收合
      </button>
    </div>
  );
}
