import type { RoamieItineraryItem, TripTransportMode } from "@/lib/ai/types";
import type { TripLocation } from "@/lib/location/types";
import { inferActivityTypesFromDayItems } from "@/lib/outfit/infer-activities";

export function buildTripItemsFingerprint(items: { date?: string; placeName?: string; title?: string }[]): string {
  return items
    .slice(0, 24)
    .map((i) => `${i.date ?? ""}:${i.placeName ?? i.title ?? ""}`)
    .join(";")
    .slice(0, 280);
}

export function buildOutfitInputKey(params: {
  destination: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  itemsFingerprint?: string;
  weatherSignature?: string;
  weatherRefreshTick?: number;
}): string {
  return [
    params.destination.trim().toLowerCase(),
    params.startDate.trim(),
    params.endDate.trim(),
    String(params.dayCount),
    params.itemsFingerprint?.trim() || "",
    params.weatherSignature?.trim() || "",
    params.weatherRefreshTick != null ? `w${params.weatherRefreshTick}` : "",
  ].join("|");
}

/** 從 trip 欄位與行程地點推斷顯示用目的地 */
export function resolveTripDestination(trip: {
  destination?: string;
  destinationLocation?: TripLocation | null;
  itinerary?: RoamieItineraryItem[];
}): string {
  const direct =
    trip.destination?.trim() ||
    trip.destinationLocation?.formattedName?.trim() ||
    trip.destinationLocation?.displayLabel?.trim() ||
    trip.destinationLocation?.city?.trim() ||
    trip.destinationLocation?.country?.trim();
  if (direct) return direct;

  const fromPlaces = extractPlaceRegions(trip.itinerary ?? []);
  return fromPlaces.length > 0 ? fromPlaces.join("、") : "你的目的地";
}

function extractPlaceRegions(items: RoamieItineraryItem[]): string[] {
  const seen = new Set<string>();
  const regions: string[] = [];
  for (const item of items) {
    const blob = `${item.placeName} ${item.address ?? ""} ${item.title}`;
    const countryMatch = blob.match(
      /(日本|韓國|泰國|台灣|香港|新加坡|越南|馬來西亞|印尼|菲律賓|中國|美國|英國|法國|義大利|西班牙|澳洲|紐西蘭|冰島|瑞士|德國|加拿大)/,
    );
    if (countryMatch && !seen.has(countryMatch[1]!)) {
      seen.add(countryMatch[1]!);
      regions.push(countryMatch[1]!);
    }
  }
  return regions;
}

export function inferHasNightActivities(items: RoamieItineraryItem[]): boolean {
  for (const item of items) {
    const text = `${item.title} ${item.description} ${item.placeName}`;
    if (/夜景|夜市|酒吧|居酒屋|夜間|深夜|night|bar|club/i.test(text)) return true;
    const m = item.time?.trim().match(/(\d{1,2}):(\d{2})/);
    if (m) {
      const hour = Number.parseInt(m[1]!, 10);
      if (hour >= 18) return true;
    }
  }
  return false;
}

export function inferHeavyOutdoorWalking(
  items: RoamieItineraryItem[],
  transport?: TripTransportMode | string | null,
): boolean {
  if (transport === "walk") return true;
  const activities = inferActivityTypesFromDayItems(items);
  return (
    activities.includes("hiking") ||
    activities.includes("outdoor") ||
    activities.includes("city") ||
    activities.includes("mixed")
  );
}

export function transportLabelForPrompt(transport?: TripTransportMode | string | null): string {
  switch (transport) {
    case "walk":
      return "步行";
    case "scooter":
      return "機車";
    case "drive":
      return "開車";
    case "transit":
      return "大眾運輸";
    default:
      return transport?.trim() || "尚未設定";
  }
}

export function formatTripDateRangeLabel(start: string, end: string): string {
  if (!start) return "日期待定";
  if (!end || end === start) return start;
  return `${start} ～ ${end}`;
}
