import { Loader2 } from "lucide-react";

type Props = {
  onCancel: () => void;
  onApply: () => void;
  applying?: boolean;
  cancelLabel?: string;
  applyLabel?: string;
  /** overlay 浮在右上角；below 在區塊下方 */
  placement?: "overlay" | "below";
  className?: string;
};

export function CropEditActions({
  onCancel,
  onApply,
  applying = false,
  cancelLabel = "取消",
  applyLabel = "套用",
  placement = "overlay",
  className = "",
}: Props) {
  const btn =
    "rounded-full px-3.5 py-1.5 text-xs font-medium shadow-soft backdrop-blur-sm disabled:opacity-50";

  if (placement === "below") {
    return (
      <div className={`flex gap-1.5 ${className}`}>
        <button
          type="button"
          onClick={onCancel}
          disabled={applying}
          className="flex-1 rounded-full border border-border bg-card py-2 text-xs font-medium"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="flex-1 rounded-full bg-primary py-2 text-xs font-medium text-primary-foreground"
        >
          {applying ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Loader2 className="h-4 w-4 animate-spin" />
              處理中…
            </span>
          ) : (
            applyLabel
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      <button
        type="button"
        onClick={onCancel}
        disabled={applying}
        className={`${btn} border border-border/80 bg-card/95 text-foreground`}
      >
        {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        className={`${btn} bg-primary text-primary-foreground`}
      >
        {applying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          applyLabel
        )}
      </button>
    </div>
  );
}
