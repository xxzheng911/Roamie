import { useEffect } from "react";
import roamieMapMascot from "@/assets/roamie-mascot-map-cutout.png";
import { logMapFallback } from "@/lib/map-boot-log";

type Props = {
  title: string;
  subtitle: string;
  onRetry?: () => void;
  retryLabel?: string;
  variant?: "placeholder" | "loading";
  fallbackReason?: string;
};

/**
 * 探索頁地圖不可用時的柔和背景（非錯誤頁樣式）。
 * 下方推薦列表照常運作。
 */
export function MapExploreMapFallback({
  title,
  subtitle,
  onRetry,
  retryLabel,
  variant = "placeholder",
  fallbackReason,
}: Props) {
  const loading = variant === "loading";

  useEffect(() => {
    if (fallbackReason) {
      logMapFallback(fallbackReason);
    }
  }, [fallbackReason]);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-gradient-to-b from-[#fdf8f0] via-cream to-[#f3ebe2]"
      aria-hidden={loading}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(42 37 32 / 0.07) 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="pointer-events-none absolute -right-8 top-24 h-40 w-40 rounded-full bg-clay/10 blur-2xl" />
      <div className="pointer-events-none absolute -left-6 bottom-40 h-36 w-36 rounded-full bg-primary/5 blur-2xl" />

      {loading ? (
        <div className="absolute inset-x-8 top-[38%] space-y-3">
          <div className="h-3 w-2/5 animate-pulse rounded-full bg-foreground/10" />
          <div className="h-3 w-3/5 animate-pulse rounded-full bg-foreground/8" />
          <div className="h-3 w-1/3 animate-pulse rounded-full bg-foreground/6" />
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center px-8 pb-[42vh] pt-16 text-center">
          <div className="relative mb-5 flex h-32 w-32 items-center justify-center">
            <div className="absolute inset-2 rounded-full bg-clay/10 blur-md" />
            <img
              src={roamieMapMascot}
              alt=""
              className="relative h-28 w-28 object-contain drop-shadow-sm"
              draggable={false}
            />
          </div>
          <p className="font-display text-lg leading-snug text-foreground">{title}</p>
          <p className="mt-2 max-w-[17rem] text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
          {onRetry && retryLabel ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {retryLabel}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
