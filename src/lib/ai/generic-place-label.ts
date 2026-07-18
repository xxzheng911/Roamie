import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { isBurialOrFuneralPlace } from "@/lib/burial-place-filter";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { isLikelyPlaceName } from "@/lib/ai/place-name-likelihood";

/** Category suffixes wrongly concatenated with destination names (not Places). */
export const GENERIC_DESTINATION_CATEGORY_SUFFIXES = [
  "人氣景點",
  "必去地標",
  "特色商圈",
  "夜市或市集",
  "公園綠地",
  "博物館",
  "在地美食",
  "文創景點",
  "經典景點",
  "經典地標",
  "熱門景點",
  "觀光景點",
  "在地市集或商圈",
  "夜景或特色街區",
  "近郊半日遊",
  "文化或自然景點",
] as const;

/** 分類／方向用語 — 不可作為 itinerary stop 或地點卡名稱 */
const GENERIC_PLACE_LABEL_RE =
  /(經典地標|在地市集|商圈|美食街|熱門景點|特色街區|文化景點|室內景點|夜景地點|經典區|市區散策|在地小吃|近郊一日遊|自由安排|輕鬆收尾|夜景或按摩|市集或商圈|文化或自然|人氣景點|必去地標|特色商圈|夜市或市集|公園綠地|文創景點|經典景點)/;

const GENERIC_PLACE_EXACT = new Set([
  "在地小吃",
  "市區散策",
  "自由安排",
  "輕鬆收尾",
  "近郊一日遊",
  "夜景或按摩",
  "市集或商圈",
]);

/**
 * True when name is destination + a generic category word
 * (e.g. 「新竹人氣景點」) — never a searchable Place.
 */
export function isGenericDestinationPlaceholder(
  name: string,
  destination: string,
): boolean {
  const n = name.trim().replace(/\s+/g, "");
  const label = normalizeDestinationLabel(destination).replace(/\s+/g, "");
  if (!n || !label) return false;

  for (const suffix of GENERIC_DESTINATION_CATEGORY_SUFFIXES) {
    if (n === `${label}${suffix}` || n === `${label}的${suffix}`) {
      logAiPipeline("[GENERIC_PLACEHOLDER_BLOCKED]", `name=${name}`);
      return true;
    }
  }

  if (n.startsWith(label) && GENERIC_PLACE_LABEL_RE.test(n.slice(label.length))) {
    logAiPipeline("[GENERIC_PLACEHOLDER_BLOCKED]", `name=${name}`);
    return true;
  }

  return false;
}

export function isGenericPlaceLabel(name: string, destination?: string): boolean {
  const n = name.trim();
  if (!n || n.length < 2) return true;
  if (GENERIC_PLACE_EXACT.has(n)) return true;
  if (GENERIC_PLACE_LABEL_RE.test(n)) return true;

  const label = destination ? normalizeDestinationLabel(destination) : "";
  if (label && isGenericDestinationPlaceholder(n, label)) return true;

  if (label) {
    if (n === `${label}地標` || n === `${label}經典區`) return true;
    if (/經典地標$/.test(n) && n.startsWith(label)) return true;
    if (/在地市集/.test(n) && n.includes(label)) return true;
  }

  return /經典地標$|熱門景點$|特色街區$|美食街$|文化景點$|室內景點$|夜景地點$|人氣景點$|必去地標$|特色商圈$|公園綠地$|文創景點$|經典景點$/.test(
    n,
  );
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
    primaryType?: string | null;
    types?: string[] | null;
  },
  destination?: string,
): boolean {
  const name = (place.placeName ?? place.name ?? "").trim();
  if (!name || isGenericPlaceLabel(name, destination)) return false;
  if (!isLikelyPlaceName(name).ok) return false;
  if (isBurialOrFuneralPlace(place)) return false;

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
