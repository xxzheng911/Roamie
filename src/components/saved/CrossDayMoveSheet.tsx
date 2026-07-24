import { useEffect, useMemo, useState } from "react";
import { Calendar } from "lucide-react";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import type { CrossDayMovePosition } from "@/lib/trip/trip-stop-mutations";
import { cn } from "@/lib/utils";

export type CrossDayMoveTarget = {
  dayNumber: number;
  dateKey: string;
  dayIndex: number;
  items: RoamieItineraryItem[];
};

type ConfirmPayload = {
  targetDateKey: string;
  targetDayIndex: number;
  targetDayNumber: number;
  position: CrossDayMovePosition;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeName: string;
  sourceDayNumber: number;
  sourceDateKey: string;
  dayOptions: CrossDayMoveTarget[];
  onConfirm: (opts: ConfirmPayload) => void;
};

type PositionValue = "start" | "end" | `after:${number}`;

function positionFromValue(value: PositionValue): CrossDayMovePosition {
  if (value === "start") return { kind: "start" };
  if (value === "end") return { kind: "end" };
  return { kind: "afterIndex", afterIndex: Number.parseInt(value.slice(6), 10) };
}

export function CrossDayMoveSheet({
  open,
  onOpenChange,
  placeName,
  sourceDayNumber,
  sourceDateKey,
  dayOptions,
  onConfirm,
}: Props) {
  const selectableDays = useMemo(
    () => dayOptions.filter((d) => d.dateKey !== sourceDateKey),
    [dayOptions, sourceDateKey],
  );

  const [targetDateKey, setTargetDateKey] = useState("");
  const [positionValue, setPositionValue] = useState<PositionValue>("end");

  const targetDay = useMemo(
    () => selectableDays.find((d) => d.dateKey === targetDateKey) ?? selectableDays[0] ?? null,
    [selectableDays, targetDateKey],
  );

  const targetStops = targetDay?.items ?? [];

  useEffect(() => {
    if (!open) return;
    const first = selectableDays[0];
    setTargetDateKey(first?.dateKey ?? "");
    setPositionValue("end");
  }, [open, selectableDays]);

  useEffect(() => {
    if (!targetDay) return;
    if (targetStops.length === 0) {
      setPositionValue("start");
      return;
    }
    if (positionValue === "start" || positionValue === "end") return;
    const idx = Number.parseInt(positionValue.slice(6), 10);
    if (idx < 0 || idx >= targetStops.length) {
      setPositionValue("end");
    }
  }, [targetDay, targetStops.length, positionValue]);

  const handleConfirm = () => {
    if (!targetDay) return;
    onConfirm({
      targetDateKey: targetDay.dateKey,
      targetDayIndex: targetDay.dayIndex,
      targetDayNumber: targetDay.dayNumber,
      position: positionFromValue(positionValue),
    });
  };

  return (
    <RoamiePickerSheet
      open={open}
      onOpenChange={onOpenChange}
      title="跨天移動"
      description={`將「${placeName}」從第 ${sourceDayNumber} 天移至其他天`}
      onConfirm={handleConfirm}
      confirmLabel="確認移動"
    >
      <div className="space-y-5 pb-2">
        <p className="text-center text-sm text-muted-foreground">
          將「<span className="font-medium text-foreground">{placeName}</span>」從第{" "}
          {sourceDayNumber} 天移至：
        </p>

        <section>
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Calendar className="h-3.5 w-3.5" />
            目標天數
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectableDays.map((d) => (
              <button
                key={d.dateKey}
                type="button"
                onClick={() => setTargetDateKey(d.dateKey)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition",
                  targetDateKey === d.dateKey
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-card",
                )}
              >
                第 {d.dayNumber} 天
              </button>
            ))}
          </div>
        </section>

        <section>
          <span className="text-xs font-medium text-muted-foreground">插入順序</span>
          <select
            value={positionValue}
            onChange={(e) => setPositionValue(e.target.value as PositionValue)}
            disabled={!targetDay}
            className="mt-1.5 w-full rounded-2xl border border-border bg-card px-3 py-2.5 text-sm disabled:opacity-50"
          >
            <option value="start">該天最前面</option>
            <option value="end">該天最後面</option>
            {targetStops.map((stop, idx) => {
              const name = stop.localizedDisplayName ?? "";
              return (
                <option key={`${stop.placeName}-${idx}`} value={`after:${idx}`}>
                  第 {idx + 1} 個地點（{name}）後
                </option>
              );
            })}
          </select>
        </section>
      </div>
    </RoamiePickerSheet>
  );
}
