import { useI18n } from "@/hooks/use-i18n";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatDurationMinutes,
  parseDurationToMinutes,
  splitDurationMinutes,
} from "@/lib/picker-utils";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import { RoamieWheelColumn } from "@/components/pickers/RoamieWheelColumn";

type Props = {
  /** 總分鐘數 */
  valueMinutes: number;
  onChangeMinutes: (minutes: number) => void;
  disabled?: boolean;
  className?: string;
  /** 隱藏按鈕內「停留」前綴（外層已顯示時使用） */
  hideLabel?: boolean;
  /** 無邊框膠囊，與外層文字同一行 */
  inline?: boolean;
};

/** 滾輪式停留時間（15 分鐘刻度） */
export function RoamieDurationPicker({
  valueMinutes,
  onChangeMinutes,
  disabled,
  className,
  hideLabel = false,
  inline = false,
}: Props) {
  const { t: uiT, locale } = useI18n();
  const HOUR_OPTIONS = Array.from({ length: 9 }, (_, i) => ({
    value: String(i),
    label: uiT("productionUi.hours", { count: i }),
  }));
  const MINUTE_OPTIONS = [0, 15, 30, 45].map((value) => ({
    value: String(value),
    label: uiT("productionUi.minutes", { count: value }),
  }));

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
          inline
            ? "inline-flex items-center gap-0 border-0 bg-transparent p-0 text-sm font-medium text-foreground shadow-none transition active:opacity-70 disabled:opacity-50"
            : "inline-flex items-center gap-1 rounded-lg border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground transition active:scale-[0.98] disabled:opacity-50",
          className,
        )}
      >
        {!hideLabel ? (
          <span className="text-muted-foreground">{uiT("productionUi.pf317313492")}</span>
        ) : null}
        <span>{formatDurationMinutes(valueMinutes, locale)}</span>
      </button>

      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        title={uiT("productionUi.p6a265bddbb")}
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
