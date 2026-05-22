import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimeDisplay, normalizeTime } from "@/lib/picker-utils";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import { RoamieWheelColumn } from "@/components/pickers/RoamieWheelColumn";

export type TimePickerTitle = "出發時間" | "抵達時間" | "時間";

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});

const MINUTES = Array.from({ length: 60 }, (_, i) => {
  const v = String(i).padStart(2, "0");
  return { value: v, label: v };
});

type Props = {
  value: string;
  onChange: (value: string) => void;
  title?: TimePickerTitle;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** 緊湊觸發（用於行程卡內） */
  compact?: boolean;
};

/** 滾輪式 24 小時制時間選擇 */
export function RoamieTimePicker({
  value,
  onChange,
  title = "時間",
  label,
  placeholder = "選擇時間",
  disabled,
  className,
  compact,
}: Props) {
  const [open, setOpen] = useState(false);
  const normalized = normalizeTime(value || "10:00");
  const [draftHour, setDraftHour] = useState(normalized.slice(0, 2));
  const [draftMin, setDraftMin] = useState(normalized.slice(3, 5));

  useEffect(() => {
    if (!open) return;
    const n = normalizeTime(value || "10:00");
    setDraftHour(n.slice(0, 2));
    setDraftMin(n.slice(3, 5));
  }, [open, value]);

  const display = useMemo(() => formatTimeDisplay(value || ""), [value]);

  const handleConfirm = () => {
    onChange(`${draftHour}:${draftMin}`);
  };

  if (compact) {
    return (
      <>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            "rounded-lg border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50",
            className,
          )}
        >
          {display || placeholder}
        </button>
        <RoamiePickerSheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          onConfirm={handleConfirm}
          onCancel={() => {
            const n = normalizeTime(value || "10:00");
            setDraftHour(n.slice(0, 2));
            setDraftMin(n.slice(3, 5));
          }}
        >
          <div className="flex gap-1">
            <RoamieWheelColumn
              options={HOURS}
              value={draftHour}
              onChange={setDraftHour}
              resetKey={open ? draftHour : undefined}
            />
            <span className="flex items-center text-xl font-medium text-muted-foreground">:</span>
            <RoamieWheelColumn
              options={MINUTES}
              value={draftMin}
              onChange={setDraftMin}
              resetKey={open ? draftMin : undefined}
            />
          </div>
        </RoamiePickerSheet>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-left transition active:scale-[0.99] disabled:opacity-50",
          className,
        )}
      >
        <span className="min-w-0 flex-1">
          {label && (
            <span className="block text-[11px] text-muted-foreground">{label}</span>
          )}
          <span
            className={cn(
              "block text-[15px] font-medium",
              display ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {display || placeholder}
          </span>
        </span>
        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        onConfirm={handleConfirm}
        onCancel={() => {
          const n = normalizeTime(value || "10:00");
          setDraftHour(n.slice(0, 2));
          setDraftMin(n.slice(3, 5));
        }}
      >
        <div className="flex gap-1">
          <RoamieWheelColumn
            options={HOURS}
            value={draftHour}
            onChange={setDraftHour}
            resetKey={open}
          />
          <span className="flex items-center pb-2 text-2xl font-medium text-muted-foreground">:</span>
          <RoamieWheelColumn
            options={MINUTES}
            value={draftMin}
            onChange={setDraftMin}
            resetKey={open}
          />
        </div>
      </RoamiePickerSheet>
    </>
  );
}
