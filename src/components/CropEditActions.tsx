import { Loader2 } from "lucide-react";

type Props = {
  onCancel: () => void;
  onApply: () => void;
  applying?: boolean;
  cancelLabel?: string;
  applyLabel?: string;
  className?: string;
  /** 按鈕列對齊（預設靠右） */
  align?: "start" | "end";
};

/** 小巧膠囊工具列 — 需由父層 absolute 定位，不佔排版空間 */
export function CropEditActions({
  onCancel,
  onApply,
  applying = false,
  cancelLabel = "取消",
  applyLabel = "套用",
  className = "",
  align = "end",
}: Props) {
  return (
    <div
      className={`flex items-center gap-1.5 ${align === "start" ? "justify-start" : "justify-end"} ${className}`}
    >
      <button
        type="button"
        onClick={onCancel}
        disabled={applying}
        className="h-7 shrink-0 rounded-full border border-border bg-card px-3 text-[11px] font-medium text-foreground shadow-soft disabled:opacity-50"
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        aria-label={applying ? "處理中" : applyLabel}
        className="flex h-7 min-w-[3.25rem] shrink-0 items-center justify-center rounded-full bg-foreground px-3 text-[11px] font-medium text-background shadow-soft disabled:opacity-50"
      >
        {applying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          applyLabel
        )}
      </button>
    </div>
  );
}
