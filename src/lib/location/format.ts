import type { TripLocation } from "@/lib/location/types";

export function formatTripLocationLabel(
  loc: Pick<TripLocation, "formattedName" | "displayLabel" | "country" | "city">,
): string {
  if (loc.formattedName?.trim()) return loc.formattedName.trim();
  if (loc.displayLabel?.trim()) return loc.displayLabel.trim();
  const country = loc.country?.trim();
  const city = loc.city?.trim();
  if (country && city) {
    if (city === country || city.startsWith(country)) return city;
    return `${country}・${city}`;
  }
  return city || country || "";
}

export function timezoneLabelFromOffset(utcOffsetMinutes: number | null | undefined): string | undefined {
  if (utcOffsetMinutes == null || Number.isNaN(utcOffsetMinutes)) return undefined;
  const hours = utcOffsetMinutes / 60;
  const sign = hours >= 0 ? "+" : "";
  return `UTC${sign}${Number.isInteger(hours) ? hours : hours.toFixed(1)}`;
}
