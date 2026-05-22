import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatDurationMinutes,
  parseDurationToMinutes,
  splitDurationMinutes,
} from "@/lib/picker-utils";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import { RoamieWheelColumn } from "@/components/pickers/RoamieWheelColumn";

const HOUR_OPTIONS = Array.from({ length: 9 }, (_, i) => ({
  value: String(i),
  label: `${i} 小時`,
}));

const MINUTE_OPTIONS = [
  { value: "0", label: "00 分" },
  { value: "15", label: "15 分" },
  { value: "30", label: "30 分" },
  { value: "45", label: "45 分" },
];

type Props = {
  /** 總分鐘數 */
  valueMinutes: number;
  onChangeMinutes: (minutes: number) => void;
  disabled?: boolean;
  className?: string;
};

/** 滾輪式停留時間（15 分鐘刻度） */
export function RoamieDurationPicker({
  valueMinutes,
  onChangeMinutes,
  disabled,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const split = splitDurationMinutes(valueMinutes);
  const [draftH, setDraftH] = useState(String(split.hours));
  const [draftM, setDraftM] = useState(String(split.minutes));

  useEffect(() => {
    if (!open) return;
    const s = splitDurationMinutes(valueMinutes);
    setDraftH(String(s.hours));
    setDraftM(String(s.minutes));
  }, [open, valueMinutes]);

  const handleConfirm = () => {
    onChangeMinutes(parseDurationToMinutes(Number(draftH), Number(draftM)));
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50",
          className,
        )}
      >
        <span className="text-muted-foreground">停留</span>
        <span>{formatDurationMinutes(valueMinutes)}</span>
      </button>

      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        title="預計停留時間"
        onConfirm={handleConfirm}
        onCancel={() => {
          const s = splitDurationMinutes(valueMinutes);
          setDraftH(String(s.hours));
          setDraftM(String(s.minutes));
        }}
      >
        <div className="flex gap-1">
          <RoamieWheelColumn
            options={HOUR_OPTIONS}
            value={draftH}
            onChange={setDraftH}
            resetKey={open}
          />
          <RoamieWheelColumn
            options={MINUTE_OPTIONS}
            value={draftM}
            onChange={setDraftM}
            resetKey={open}
          />
        </div>
      </RoamiePickerSheet>
    </>
  );
}
