import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const WHEEL_SIZES = {
  default: { itemH: 44, height: 220, padRows: 2 },
  compact: { itemH: 40, height: 200, padRows: 2 },
} as const;

export type WheelOption = { value: string; label: string };

type Props = {
  options: WheelOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** 重新開啟選擇器時捲到目前值 */
  resetKey?: number | string;
  /** 月曆標題用較矮滾輪；預設不影響時間選擇器 */
  size?: keyof typeof WHEEL_SIZES;
};

/** 滾輪欄：中央高亮、snap 對齊 */
export function RoamieWheelColumn({
  options,
  value,
  onChange,
  className,
  resetKey,
  size = "default",
}: Props) {
  const { itemH: ITEM_H, height: WHEEL_HEIGHT, padRows: PAD_ROWS } = WHEEL_SIZES[size];
  const ref = useRef<HTMLDivElement>(null);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToValue = useCallback(
    (v: string, smooth = false) => {
      const el = ref.current;
      if (!el) return;
      const idx = options.findIndex((o) => o.value === v);
      if (idx < 0) return;
      el.scrollTo({ top: idx * ITEM_H, behavior: smooth ? "smooth" : "auto" });
    },
    [options, ITEM_H],
  );

  useEffect(() => {
    scrollToValue(value, false);
  }, [resetKey, value, scrollToValue]);

  const handleScroll = () => {
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el || options.length === 0) return;
      const idx = Math.round(el.scrollTop / ITEM_H);
      const clamped = Math.max(0, Math.min(options.length - 1, idx));
      const next = options[clamped]!.value;
      if (next !== value) onChange(next);
      el.scrollTo({ top: clamped * ITEM_H, behavior: "smooth" });
    }, 80);
  };

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <div
        className="pointer-events-none absolute inset-x-1 top-1/2 z-10 h-11 -translate-y-1/2 rounded-xl border border-primary/15 bg-primary/[0.06]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-16 bg-gradient-to-b from-cream to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] h-16 bg-gradient-to-t from-cream to-transparent" />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="roamie-wheel-scroll overflow-y-auto overscroll-contain"
        style={{
          height: WHEEL_HEIGHT,
          paddingTop: ITEM_H * PAD_ROWS,
          paddingBottom: ITEM_H * PAD_ROWS,
          scrollSnapType: "y mandatory",
        }}
      >
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                scrollToValue(o.value, true);
              }}
              className={cn(
                "flex w-full shrink-0 items-center justify-center font-medium transition-colors",
                selected ? "text-[20px] text-foreground" : "text-[17px] text-muted-foreground/70",
              )}
              style={{ height: ITEM_H, scrollSnapAlign: "center" }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
