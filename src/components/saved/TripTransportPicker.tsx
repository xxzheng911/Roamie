import { ChevronDown, Route as RouteIcon } from "lucide-react";
import { useState } from "react";
import { RoamiePickerSheet } from "@/components/pickers/RoamiePickerSheet";
import {
  TRIP_TRANSPORT_OPTIONS,
  type TripTransportOptionLabel,
} from "@/lib/saved-trip/transport-options";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (label: TripTransportOptionLabel) => void;
  /** global：地點區左上方；leg：地點間連接線 */
  variant?: "global" | "leg";
  className?: string;
};

export function TripTransportPicker({
  value,
  onChange,
  variant = "global",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const display = value.trim() || "步行";

  if (variant === "leg") {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-foreground shadow-soft transition active:scale-[0.98]",
            className,
          )}
        >
          <RouteIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{display}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
        <RoamiePickerSheet
          open={open}
          onOpenChange={setOpen}
          title="選擇交通方式"
          description="選擇此段行程的交通方式"
          onConfirm={() => setOpen(false)}
          hideFooter
        >
          <TransportOptionList
            value={display}
            onPick={(label) => {
              onChange(label);
              setOpen(false);
            }}
          />
        </RoamiePickerSheet>
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-2 text-xs text-foreground shadow-soft transition active:scale-[0.98]",
          className,
        )}
      >
        <RouteIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">交通方式</span>
        <span className="font-medium">{display}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <RoamiePickerSheet
        open={open}
        onOpenChange={setOpen}
        title="選擇交通方式"
        description="選擇整趟行程的預設交通方式"
        onConfirm={() => setOpen(false)}
        hideFooter
      >
        <TransportOptionList
          value={display}
          onPick={(label) => {
            onChange(label);
            setOpen(false);
          }}
        />
      </RoamiePickerSheet>
    </>
  );
}

function TransportOptionList({
  value,
  onPick,
}: {
  value: string;
  onPick: (label: TripTransportOptionLabel) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {TRIP_TRANSPORT_OPTIONS.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() => onPick(opt.label)}
          className={cn(
            "rounded-2xl px-4 py-3 text-left text-sm transition active:scale-[0.99]",
            value === opt.label
              ? "bg-foreground text-background font-medium"
              : "bg-secondary/60 text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
