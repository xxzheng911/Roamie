import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";

/** 分類／方向用語 — 不可作為 itinerary stop 或地點卡名稱 */
const GENERIC_PLACE_LABEL_RE =
  /(經典地標|在地市集|商圈|美食街|熱門景點|特色街區|文化景點|室內景點|夜景地點|經典區|市區散策|在地小吃|近郊一日遊|自由安排|輕鬆收尾|夜景或按摩|市集或商圈|文化或自然)/;

const GENERIC_PLACE_EXACT = new Set([
  "在地小吃",
  "市區散策",
  "自由安排",
  "輕鬆收尾",
  "近郊一日遊",
  "夜景或按摩",
  "市集或商圈",
]);

export function isGenericPlaceLabel(name: string, destination?: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return true;
  if (GENERIC_PLACE_EXACT.has(n)) return true;
  if (GENERIC_PLACE_LABEL_RE.test(n)) return true;

  const label = destination ? normalizeDestinationLabel(destination) : "";
  if (label) {
    if (n === `${label}地標` || n === `${label}經典區`) return true;
    if (/經典地標$/.test(n) && n.startsWith(label)) return true;
    if (n === `${label}經典地標`) return true;
    if (n === `${label}在地市集或商圈`) return true;
    if (n === `${label}夜景或特色街區`) return true;
    if (n === `${label}近郊半日遊`) return true;
    if (n === `${label}文化或自然景點`) return true;
    if (/在地市集/.test(n) && n.includes(label)) return true;
  }

  return /經典地標$|熱門景點$|特色街區$|美食街$|文化景點$|室內景點$|夜景地點$/.test(n);
}

export function isValidItineraryStopPlace(
  place: {
    name?: string;
    placeName?: string;
    placeId?: string;
    googlePlaceId?: string;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    id?: string;
  },
  destination?: string,
): boolean {
  const name = (place.placeName ?? place.name ?? "").trim();
  if (!name || isGenericPlaceLabel(name, destination)) return false;

  const placeId = (place.placeId ?? place.googlePlaceId ?? place.id ?? "").trim();
  const lat = place.lat;
  const lng = place.lng;
  const hasCoords =
    lat != null &&
    lng != null &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001);

  // 必填：名稱 + (placeId 或有效座標)。address / rating / photo 皆可 fallback。
  return Boolean(placeId) || hasCoords;
}

export const INSUFFICIENT_ITINERARY_PLACES_MESSAGE =
  "目前還沒找到足夠的實際地點，我再幫你換一批。";
