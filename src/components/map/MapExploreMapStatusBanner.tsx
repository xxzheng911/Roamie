import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
};

/** 地圖載入失敗時的輕量提示（非全屏 fallback） */
export function MapExploreMapStatusBanner({
  message,
  detail,
  onRetry,
  retryLabel = "重試",
  retrying = false,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto absolute inset-x-4 top-[calc(var(--safe-area-top)+4.25rem)] z-30",
        className,
      )}
      role="status"
    >
      <div className="flex items-start gap-2.5 rounded-2xl border border-border/80 bg-card/95 px-3.5 py-2.5 shadow-soft backdrop-blur-sm">
        {retrying ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-clay" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug text-foreground">{message}</p>
          {detail ? (
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
          ) : null}
        </div>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground touch-manipulation active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
