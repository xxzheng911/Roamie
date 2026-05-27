import { cn } from "@/lib/utils";

type Props = {
  variant?: "loading" | "retrying" | "idle";
  className?: string;
};

/** 探索頁地圖區底色：不佔滿屏 mascot，避免把推薦卡片擠下去 */
export function MapExploreMapSkeleton({ variant = "loading", className }: Props) {
  const retrying = variant === "retrying";

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden bg-gradient-to-b from-[#faf6f0] via-cream to-[#efe6dc]",
        className,
      )}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(42 37 32 / 0.06) 1px, transparent 0)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="pointer-events-none absolute inset-x-[12%] top-[22%] space-y-3">
        <div
          className={cn(
            "h-2.5 rounded-full bg-foreground/10",
            retrying ? "w-[45%] animate-pulse" : "w-[38%] animate-pulse",
          )}
        />
        <div className="h-2.5 w-[58%] animate-pulse rounded-full bg-foreground/8" />
        <div className="h-2.5 w-[32%] animate-pulse rounded-full bg-foreground/6" />
      </div>
      {retrying ? (
        <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-xs text-muted-foreground">
          正在重新載入地圖…
        </p>
      ) : null}
    </div>
  );
}
