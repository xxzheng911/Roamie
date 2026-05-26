import { Heart, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isSaved: boolean;
  isBusy: boolean;
  onToggleSave: () => void;
  onAddToTrip: () => void;
  saveLabel?: string;
  addLabel?: string;
  className?: string;
  compact?: boolean;
};

export function PlaceActionRow({
  isSaved,
  isBusy,
  onToggleSave,
  onAddToTrip,
  saveLabel = "收藏",
  addLabel = "加入行程",
  className,
  compact,
}: Props) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <button
        type="button"
        onClick={onToggleSave}
        disabled={isBusy}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-card font-medium transition active:scale-[0.98] disabled:opacity-50",
          compact ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-sm",
        )}
        aria-label={isSaved ? "已收藏" : saveLabel}
      >
        {isBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Heart className={cn("h-3.5 w-3.5", isSaved && "fill-clay text-clay")} />
        )}
        {saveLabel}
      </button>
      <button
        type="button"
        onClick={onAddToTrip}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground font-medium text-background transition active:scale-[0.98]",
          compact ? "px-3 py-1.5 text-[11px]" : "px-4 py-2 text-sm",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}
