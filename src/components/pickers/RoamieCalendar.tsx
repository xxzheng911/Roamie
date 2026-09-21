import { useI18n } from "@/hooks/use-i18n";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calendarCells,
  isInRange,
  isSameISO,
  normalizeRange,
  parseISODate,
  toISODate,
  todayISO,
  WEEKDAY_LABELS,
  type DateRangeValue,
} from "@/lib/picker-utils";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import { RoamieWheelColumn } from "@/components/pickers/RoamieWheelColumn";

type Props = {
  mode: "single" | "range";
  value: string | DateRangeValue;
  onChange: (value: string | DateRangeValue) => void;
};

const BASE_YEAR = new Date().getFullYear();

const YEAR_OPTIONS = Array.from({ length: 8 }, (_, i) => {
  const y = BASE_YEAR - 1 + i;
  return { value: String(y), label: String(y) };
});

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i),
  label: `${i + 1}月`,
}));

function resolveViewDate(mode: Props["mode"], value: string | DateRangeValue): Date {
  if (mode === "single" && typeof value === "string" && value) {
    return parseISODate(value) ?? new Date();
  }
  if (mode === "range" && typeof value === "object") {
    const iso = value.start || value.end;
    if (iso) return parseISODate(iso) ?? new Date();
  }
  return new Date();
}

export function RoamieCalendar({ mode, value, onChange }: Props) {
  const { t: uiT, locale } = useI18n();
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2024, 0, 7 + i)),
  );
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({
    value: String(i),
    label: new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2024, i, 1)),
  }));

  const today = todayISO();
  const initial = useMemo(() => resolveViewDate(mode, value), [mode, value]);

  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());
  const [rangeAnchor, setRangeAnchor] = useState<string | null>(null);

  const [monthYearOpen, setMonthYearOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(viewYear);
  const [draftMonth, setDraftMonth] = useState(viewMonth);

  useEffect(() => {
    const d = resolveViewDate(mode, value);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [mode, value]);

  const cells = useMemo(() => calendarCells(viewYear, viewMonth), [viewYear, viewMonth]);

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const openMonthYearPicker = () => {
    setDraftYear(viewYear);
    setDraftMonth(viewMonth);
    setMonthYearOpen(true);
  };

  const handleDay = (iso: string) => {
    if (mode === "single") {
      onChange(iso);
      return;
    }

    const current = typeof value === "object" ? value : { start: "", end: "" };

    if (!rangeAnchor) {
      setRangeAnchor(iso);
      onChange({ start: iso, end: iso });
      return;
    }

    const { start, end } = normalizeRange(rangeAnchor, iso);
    setRangeAnchor(null);
    onChange({ start, end });
  };

  const rangeStart = mode === "range" && typeof value === "object" ? value.start : "";
  const rangeEnd = mode === "range" && typeof value === "object" ? value.end : "";
  const singleVal = mode === "single" && typeof value === "string" ? value : "";

  const headerLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
    new Date(viewYear, viewMonth, 1),
  );

  return (
    <div className="select-none">
      <div className="mb-4 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground shadow-soft transition active:scale-95"
          aria-label={uiT("productionUi.pd84db2ffe8")}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          dir="ltr"
          onClick={openMonthYearPicker}
          className="min-w-0 rounded-xl px-2 py-1 font-display text-[17px] font-medium text-foreground transition active:bg-secondary/80"
          aria-label={uiT("productionUi.p02a757d113")}
        >
          {headerLabel}
        </button>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-foreground shadow-soft transition active:scale-95"
          aria-label={uiT("productionUi.p5dcf045a24")}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
        {weekdays.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="aspect-square" />;
          }
          const iso = toISODate(date);
          const isToday = iso === today;
          const selected =
            mode === "single"
              ? isSameISO(iso, singleVal)
              : isInRange(iso, rangeStart, rangeEnd) ||
                isSameISO(iso, rangeStart) ||
                isSameISO(iso, rangeEnd);
          const rangeEdge =
            mode === "range" && (isSameISO(iso, rangeStart) || isSameISO(iso, rangeEnd));

          return (
            <button
              key={iso}
              type="button"
              onClick={() => handleDay(iso)}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-xl text-[15px] transition",
                selected && "bg-primary font-medium text-primary-foreground shadow-soft",
                !selected && "text-foreground hover:bg-secondary/80",
                isToday && !selected && "ring-1 ring-primary/35 ring-offset-1 ring-offset-cream",
                rangeEdge && selected && "z-[1]",
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {mode === "range" && (
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          {uiT("productionUi.p530737dccf")}
        </p>
      )}

      <RoamiePickerSheet
        open={monthYearOpen}
        onOpenChange={setMonthYearOpen}
        title={uiT("productionUi.p02a757d113")}
        className="z-[70]"
        onConfirm={() => {
          setViewYear(draftYear);
          setViewMonth(draftMonth);
        }}
        onCancel={() => {
          setDraftYear(viewYear);
          setDraftMonth(viewMonth);
        }}
      >
        <div dir="ltr" className="flex flex-row items-center gap-1">
          <RoamieWheelColumn
            options={YEAR_OPTIONS}
            value={String(draftYear)}
            onChange={(v) => setDraftYear(Number(v))}
            resetKey={monthYearOpen ? draftYear : undefined}
            className="min-w-0 flex-1"
          />
          <span
            className="shrink-0 px-0.5 font-display text-lg text-muted-foreground/50"
            aria-hidden
          >
            ｜
          </span>
          <RoamieWheelColumn
            options={monthOptions}
            value={String(draftMonth)}
            onChange={(v) => setDraftMonth(Number(v))}
            resetKey={monthYearOpen ? draftMonth : undefined}
            className="min-w-0 flex-1"
          />
        </div>
      </RoamiePickerSheet>
    </div>
  );
}
