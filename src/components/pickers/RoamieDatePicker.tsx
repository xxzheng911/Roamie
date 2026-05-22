import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDateRangeLabel,
  formatDateShort,
  formatDateWithWeekday,
  type DateRangeValue,
} from "@/lib/picker-utils";
import { RoamieCalendar } from "@/components/pickers/RoamieCalendar";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";

type SingleProps = {
  mode: "single";
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
  variant?: "field" | "inline";
};

type RangeProps = {
  mode: "range";
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  label?: string;
  placeholder?: string;
  title?: string;
  /** 欄位顯示含年份，例如 2026年5月9日 – 2026年5月12日 */
  displayWithYear?: boolean;
  disabled?: boolean;
  className?: string;
  variant?: "field" | "inline";
};

export type RoamieDatePickerProps = SingleProps | RangeProps;

function displayLabel(props: RoamieDatePickerProps): string {
  if (props.mode === "single") {
    return props.value ? formatDateShort(props.value) : "";
  }
  return formatDateRangeLabel(props.value.start, props.value.end, {
    withYear: props.displayWithYear,
  });
}

/** 月曆式日期選擇（單日或區間） */
export function RoamieDatePicker(props: RoamieDatePickerProps) {
  const {
    label,
    placeholder = "選擇日期",
    title,
    disabled,
    className,
    variant = "field",
  } = props;

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | DateRangeValue>(
    props.mode === "single" ? props.value : { ...props.value },
  );

  useEffect(() => {
    if (!open) return;
    if (props.mode === "single") {
      setDraft(props.value);
    } else {
      setDraft({ start: props.value.start, end: props.value.end });
    }
  }, [open, props.mode, props.mode === "single" ? props.value : props.value.start, props.mode === "single" ? "" : props.value.end]);

  const sheetTitle = title ?? (props.mode === "range" ? undefined : "選擇日期");

  const handleConfirm = () => {
    if (props.mode === "single") {
      props.onChange(draft as string);
    } else {
      props.onChange(draft as DateRangeValue);
    }
  };

  const shown = displayLabel(props);
  const inlineLabel =
    props.mode === "single" && props.value
      ? formatDateWithWeekday(props.value)
      : shown || placeholder;

  return (
    <>
      {variant === "inline" ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            "font-display text-lg font-medium text-foreground underline decoration-border decoration-dashed underline-offset-4 transition active:opacity-70 disabled:opacity-50",
            className,
          )}
        >
          {inlineLabel}
        </button>
      ) : (
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
                shown ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {shown || placeholder}
            </span>
          </span>
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        title={sheetTitle}
        onConfirm={handleConfirm}
        onCancel={() =>
          setDraft(props.mode === "single" ? props.value : { ...props.value })
        }
      >
        {props.mode === "single" ? (
          <RoamieCalendar
            mode="single"
            value={draft as string}
            onChange={(v) => setDraft(v as string)}
          />
        ) : (
          <RoamieCalendar
            mode="range"
            value={draft as DateRangeValue}
            onChange={(v) => setDraft(v as DateRangeValue)}
          />
        )}
      </RoamiePickerSheet>
    </>
  );
}
