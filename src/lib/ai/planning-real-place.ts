import type { PlaceResult } from "@/lib/place-result";
import { normalizeGooglePlaceId } from "@/lib/ai/normalize-google-place";
import { isHardGooglePlaceId } from "@/lib/ai/planning-place-id";

export const ALLOWED_ITINERARY_SLOT_LABELS = [
  "早餐",
  "景點",
  "午餐",
  "咖啡",
  "晚餐",
  "酒吧",
] as const;

export type AllowedItinerarySlotLabel = (typeof ALLOWED_ITINERARY_SLOT_LABELS)[number];

export type ItinerarySlotTemplate = {
  time: string;
  kind: string;
  label: string;
};

const SYNTHETIC_PLACE_ID_PREFIXES = [
  "synthetic:",
  "landmark-cache:",
  "core:",
  "name:",
  "dayplan:",
  "local-life-fallback:",
  "slow-nature-fallback:",
  "classic-fallback:",
  "mixed-fallback:",
  "session:",
  "trip:",
  "memory:",
] as const;

export const PLANNING_PLACEHOLDER_NAME_RE =
  /在地午餐|在地晚餐|在地小吃|在地咖啡|在地早餐|推薦景點|placeholder|fallback/i;

/** 標準每日 slot 模板（僅六類標題） */
export const STANDARD_ITINERARY_DAY_SLOTS: ItinerarySlotTemplate[] = [
  { time: "08:30", kind: "restaurant", label: "早餐" },
  { time: "10:00", kind: "attraction", label: "景點" },
  { time: "12:00", kind: "restaurant", label: "午餐" },
  { time: "14:00", kind: "attraction", label: "景點" },
  { time: "16:00", kind: "cafe", label: "咖啡" },
  { time: "18:00", kind: "restaurant", label: "晚餐" },
  { time: "20:00", kind: "night_market", label: "酒吧" },
];

/** 轉成 DayPlanSlot（供 planner / slot rules 共用） */
export function standardItineraryDayPlanSlots(): {
  time: string;
  kind: string;
  label: string;
}[] {
  return STANDARD_ITINERARY_DAY_SLOTS.map((s) => ({
    time: s.time,
    kind: s.kind,
    label: s.label,
  }));
}

function placeTypes(place: PlaceResult): Set<string> {
  const out = new Set<string>();
  for (const t of place.types ?? []) {
    const n = t.trim().toLowerCase();
    if (n) out.add(n);
  }
  const primary = (place.primaryType ?? "").trim().toLowerCase();
  if (primary) out.add(primary);
  return out;
}

function placeBlob(place: PlaceResult): string {
  return [place.name, place.address, ...(place.types ?? []), place.primaryType]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isBarPlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.has("bar") || types.has("night_club")) return true;
  return /bar|bistro|pub|酒吧|夜店|居酒/i.test(placeBlob(place));
}

function isNightMarketPlace(place: PlaceResult): boolean {
  return /夜市|night\s*market/i.test(placeBlob(place));
}

function isCafePlace(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.has("cafe") || types.has("coffee_shop") || types.has("bakery")) return true;
  return /咖啡廳|咖啡店|\bcafe\b|coffee_shop/i.test(place.name ?? "");
}

function isMuseumOrCulture(place: PlaceResult): boolean {
  const types = placeTypes(place);
  if (types.has("museum") || types.has("art_gallery")) return true;
  return /博物館|美術館|museum|gallery/i.test(placeBlob(place));
}

function isCreativePark(place: PlaceResult): boolean {
  return /文創園區|文創園|產業園區|文化創意|creative\s*park/i.test(placeBlob(place));
}

function isRestaurantPlace(place: PlaceResult): boolean {
  if (isCreativePark(place) || isMuseumOrCulture(place)) return false;
  const types = placeTypes(place);
  if (types.has("restaurant") || types.has("food") || types.has("meal_takeaway")) return true;
  return /餐|食|小吃|料理|麵|飯/i.test(placeBlob(place));
}

function parseTimeMinutes(time: string): number {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 12 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function resolvePlanningPlaceId(place: PlaceResult): string {
  const raw =
    place.id ??
    (place as PlaceResult & { placeId?: string }).placeId ??
    (place as PlaceResult & { googlePlaceId?: string }).googlePlaceId ??
    "";
  return normalizeGooglePlaceId(raw);
}

export function isSyntheticPlanningPlaceId(placeId: string): boolean {
  const id = placeId.trim();
  if (!id) return true;
  return SYNTHETIC_PLACE_ID_PREFIXES.some((p) => id.startsWith(p));
}

export function isPlaceholderPlanningPlaceName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (PLANNING_PLACEHOLDER_NAME_RE.test(trimmed)) return true;
  if (/^[\u4e00-\u9fff]{2,6}(在地|推薦)/.test(trimmed) && /\d+$/.test(trimmed)) return true;
  return false;
}

export function isRealGooglePlanningPlace(place: PlaceResult): boolean {
  const id = normalizeGooglePlaceId(resolvePlanningPlaceId(place));
  if (!isHardGooglePlaceId(id) || isSyntheticPlanningPlaceId(id)) return false;
  if (!/^ChIJ[\w-]+$/i.test(id)) return false;
  const name = (place.name ?? "").trim();
  if (!name || isPlaceholderPlanningPlaceName(name)) return false;
  if (place.lat == null || place.lng == null) return false;
  return true;
}

/**
 * Core place required to enter an itinerary:
 * real Google Place ID + name + coords + address (+ destinationMatch !== false).
 * Photo / hours / rating are optional enrichment.
 */
export function isResolvedCorePlace(
  place: Partial<PlaceResult> & {
    googlePlaceId?: string | null;
    destinationMatch?: boolean;
    formattedAddress?: string | null;
  },
): boolean {
  const googlePlaceId = normalizeGooglePlaceId(
    place.googlePlaceId ?? resolvePlanningPlaceId(place as PlaceResult),
  );
  if (
    typeof googlePlaceId !== "string" ||
    !googlePlaceId ||
    googlePlaceId.startsWith("session:") ||
    googlePlaceId.startsWith("trip:") ||
    googlePlaceId.startsWith("memory:") ||
    isSyntheticPlanningPlaceId(googlePlaceId) ||
    !/^ChIJ[\w-]+$/i.test(googlePlaceId)
  ) {
    return false;
  }
  if (place.lat == null || place.lng == null) return false;
  const name = (place.name ?? "").trim();
  if (!name || isPlaceholderPlanningPlaceName(name)) return false;
  if (place.destinationMatch === false) return false;
  const address = (place.address ?? place.formattedAddress ?? "").trim();
  if (!address) return false;
  return true;
}

/**
 * Required before writing a TripPlace.
 * Rejects session:/trip:/memory: ids, missing coords, and placeholder names.
 * Prefer {@link isResolvedCorePlace} when address is available.
 */
export function isResolvedGooglePlace(
  place: Partial<PlaceResult> & {
    googlePlaceId?: string | null;
    destinationMatch?: boolean;
  },
): boolean {
  const googlePlaceId = normalizeGooglePlaceId(
    place.googlePlaceId ?? resolvePlanningPlaceId(place as PlaceResult),
  );
  if (
    typeof googlePlaceId !== "string" ||
    !googlePlaceId ||
    googlePlaceId.startsWith("session:") ||
    googlePlaceId.startsWith("trip:") ||
    googlePlaceId.startsWith("memory:") ||
    isSyntheticPlanningPlaceId(googlePlaceId) ||
    !/^ChIJ[\w-]+$/i.test(googlePlaceId)
  ) {
    return false;
  }
  if (place.lat == null || place.lng == null) return false;
  const name = (place.name ?? "").trim();
  if (!name || isPlaceholderPlanningPlaceName(name)) return false;
  if (place.destinationMatch === false) return false;
  return true;
}

export function filterRealPlanningPlaces(places: PlaceResult[]): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const place of places) {
    if (!isRealGooglePlanningPlace(place)) continue;
    const id = normalizeGooglePlaceId(resolvePlanningPlaceId(place));
    out.push(id && id !== place.id ? { ...place, id } : place);
  }
  return out;
}

/** 候選池擴充 / gate 一律以真實 Google 地點計數 */
export function countRealPlanningPool(places: PlaceResult[]): number {
  return filterRealPlanningPlaces(places).length;
}

export function isAllowedItinerarySlotLabel(label: string): label is AllowedItinerarySlotLabel {
  return (ALLOWED_ITINERARY_SLOT_LABELS as readonly string[]).includes(label);
}

export function normalizeItineraryEntryLabel(
  slot: ItinerarySlotTemplate,
  place: PlaceResult,
): AllowedItinerarySlotLabel {
  const minutes = parseTimeMinutes(slot.time);

  if (isBarPlace(place)) return minutes >= 19 * 60 ? "酒吧" : "景點";
  if (isNightMarketPlace(place)) return minutes >= 17 * 60 + 30 ? "晚餐" : "景點";

  if (/早餐/.test(slot.label)) {
    if ((isRestaurantPlace(place) || isCafePlace(place)) && !isMuseumOrCulture(place)) return "早餐";
    return "景點";
  }
  if (/午餐/.test(slot.label)) {
    if (isRestaurantPlace(place) && !isBarPlace(place)) return "午餐";
    return "景點";
  }
  if (/晚餐/.test(slot.label)) {
    if (isRestaurantPlace(place) && !isMuseumOrCulture(place)) return "晚餐";
    if (isNightMarketPlace(place)) return "晚餐";
    return "景點";
  }
  if (/咖啡/.test(slot.label)) {
    if (isCafePlace(place) && !isCreativePark(place)) return "咖啡";
    return "景點";
  }
  if (/酒吧/.test(slot.label) || minutes >= 19 * 60 + 30) {
    if (isBarPlace(place)) return "酒吧";
    return "景點";
  }
  return "景點";
}

export function entryLabelMatchesPlace(
  label: string,
  place: PlaceResult,
  time: string,
): boolean {
  const minutes = parseTimeMinutes(time);
  if (!isAllowedItinerarySlotLabel(label)) return false;

  if (label === "早餐") {
    return (
      (isRestaurantPlace(place) || isCafePlace(place)) &&
      !isMuseumOrCulture(place) &&
      !isCreativePark(place) &&
      !isBarPlace(place)
    );
  }
  if (label === "午餐") {
    return (
      isRestaurantPlace(place) &&
      !isBarPlace(place) &&
      !isMuseumOrCulture(place) &&
      !isCreativePark(place) &&
      minutes >= 11 * 60 + 30 &&
      minutes < 14 * 60
    );
  }
  if (label === "晚餐") {
    return (
      (isRestaurantPlace(place) || isNightMarketPlace(place)) &&
      !isMuseumOrCulture(place) &&
      !isCreativePark(place) &&
      minutes >= 17 * 60 + 30
    );
  }
  if (label === "咖啡") {
    return isCafePlace(place) && !isCreativePark(place);
  }
  if (label === "酒吧") {
    return isBarPlace(place) && minutes >= 19 * 60;
  }
  if (label === "景點") {
    if (isRestaurantPlace(place) && !isCafePlace(place)) return false;
    if (isBarPlace(place)) return false;
    if (isNightMarketPlace(place) && minutes < 17 * 60 + 30) return false;
    return true;
  }
  return false;
}
