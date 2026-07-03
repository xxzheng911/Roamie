import type { TripPlanSettings, TripTransportMode } from "@/lib/ai/types";
import { legKeyForItem } from "@/lib/trip/trip-stop-mutations";
import type { RoamieItineraryItem } from "@/lib/ai/types";
import { isTransitRequested } from "@/lib/saved-trip/travel-time";

/** 行程交通選項（整趟預設 / 地點間） */
export const TRIP_TRANSPORT_OPTIONS = [
  { label: "步行", mode: "walk" as TripTransportMode },
  { label: "大眾運輸", mode: "transit" as TripTransportMode },
  { label: "租車自駕", mode: "drive" as TripTransportMode },
  { label: "計程車/共乘", mode: "drive" as TripTransportMode },
  { label: "單車", mode: "walk" as TripTransportMode },
] as const;

export type TripTransportOptionLabel = (typeof TRIP_TRANSPORT_OPTIONS)[number]["label"];

export function resolveGlobalTransportLabel(settings: TripPlanSettings): string {
  if (settings.defaultTransportLabel?.trim()) {
    return settings.defaultTransportLabel.trim();
  }
  const mode = settings.transport ?? "walk";
  if (mode === "transit") return "大眾運輸";
  if (mode === "drive") return "租車自駕";
  if (mode === "scooter") return "機車";
  return "步行";
}

export function resolveDayTransportLabel(
  settings: TripPlanSettings,
  dateKey: string,
): string {
  const dayLabel = settings.dayTransportLabels?.[dateKey]?.trim();
  if (dayLabel) return dayLabel;
  return resolveGlobalTransportLabel(settings);
}

/** 該日是否以大眾運輸為預設交通（含整趟預設） */
export function isDayTransitTransport(settings: TripPlanSettings, dateKey: string): boolean {
  return isTransitRequested(resolveDayTransportLabel(settings, dateKey));
}

export function resolveLegTransportLabel(
  settings: TripPlanSettings,
  legDestKey: string,
  dateKey?: string,
): string {
  const override = settings.legTransport?.[legDestKey]?.trim();
  if (override) return override;
  if (dateKey) return resolveDayTransportLabel(settings, dateKey);
  return resolveGlobalTransportLabel(settings);
}

export function logLegEffectiveTransport(
  dateKey: string,
  dayIndex: number,
  legIndex: number,
  settings: TripPlanSettings,
  legDestKey: string,
): void {
  const defaultMode = resolveDayTransportLabel(settings, dateKey);
  const overrideMode = settings.legTransport?.[legDestKey]?.trim() || null;
  const effectiveMode = resolveLegTransportLabel(settings, legDestKey, dateKey);
  console.info(
    `[TRIP_LEG_EFFECTIVE_TRANSPORT] dayIndex=${dayIndex} legIndex=${legIndex} defaultMode=${defaultMode} overrideMode=${overrideMode ?? "none"} effectiveMode=${effectiveMode}`,
  );
}

export function legDestKeysForDay(items: RoamieItineraryItem[]): string[] {
  return items.map((item) => legKeyForItem(item));
}

export function tripTransportOptionForLabel(
  label: string,
): (typeof TRIP_TRANSPORT_OPTIONS)[number] {
  return (
    TRIP_TRANSPORT_OPTIONS.find((o) => o.label === label) ?? TRIP_TRANSPORT_OPTIONS[0]
  );
}

export function applyGlobalTransportLabel(label: string): Pick<
  TripPlanSettings,
  "transport" | "defaultTransportLabel"
> {
  const opt = tripTransportOptionForLabel(label);
  return {
    transport: opt.mode,
    defaultTransportLabel: opt.label,
  };
}

export function applyDayTransportLabel(
  label: string,
): Pick<TripPlanSettings, "transport" | "defaultTransportLabel"> {
  return applyGlobalTransportLabel(label);
}
