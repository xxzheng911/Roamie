import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { distanceMeters } from "@/lib/map-explore";

type PlaceBucket = "attraction" | "restaurant" | "cafe" | "shopping" | "museum" | "park" | "other";

const BUCKET_TIME: Record<PlaceBucket, string> = {
  park: "09:00",
  attraction: "09:30",
  museum: "10:30",
  restaurant: "12:00",
  cafe: "15:00",
  shopping: "16:30",
  other: "14:00",
};

const DAY_BUCKET_ORDER: PlaceBucket[][] = [
  ["attraction", "restaurant", "cafe", "shopping"],
  ["museum", "restaurant", "park", "cafe"],
  ["attraction", "restaurant", "shopping", "museum"],
  ["park", "restaurant", "cafe", "attraction"],
  ["museum", "restaurant", "shopping", "park"],
  ["attraction", "cafe", "restaurant", "museum"],
  ["park", "restaurant", "shopping", "cafe"],
];

function classifyPlaceBucket(place: RoamieRecommendationItem): PlaceBucket {
  const blob = `${place.type ?? ""} ${place.name ?? ""} ${place.placeName ?? ""}`.toLowerCase();
  if (/(restaurant|餐廳|美食|燒肉|火鍋|料理|restaurant)/i.test(blob)) return "restaurant";
  if (/(cafe|coffee|咖啡|甜點|bakery)/i.test(blob)) return "cafe";
  if (/(shopping_mall|mall|商圈|百貨|outlet|market)/i.test(blob)) return "shopping";
  if (/(museum|美術館|gallery|博物館|art_gallery)/i.test(blob)) return "museum";
  if (/(park|garden|公園|綠地|national_park)/i.test(blob)) return "park";
  if (
    /(tourist_attraction|attraction|landmark|景點|寺|廟|海灘|beach|viewpoint|historic)/i.test(blob)
  ) {
    return "attraction";
  }
  return "other";
}

function placeCoords(place: RoamieRecommendationItem): { lat: number; lng: number } | null {
  if (place.lat == null || place.lng == null) return null;
  if (Math.abs(place.lat) < 0.001 && Math.abs(place.lng) < 0.001) return null;
  return { lat: place.lat, lng: place.lng };
}

function pickClosestUnused(
  candidates: RoamieRecommendationItem[],
  anchor: { lat: number; lng: number } | null,
  used: Set<string>,
): RoamieRecommendationItem | null {
  let best: RoamieRecommendationItem | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const place of candidates) {
    const key = placeKey(place);
    if (used.has(key)) continue;
    const coords = placeCoords(place);
    const quality =
      (place.rating ?? 0) * Math.log10((place.userRatingCount ?? 0) + 10) +
      (place.photoName ? 0.3 : 0);
    const distance =
      anchor && coords ? distanceMeters(anchor, coords) : coords ? 0 : 50_000;
    const score = distance - quality * 120;
    if (score < bestScore) {
      bestScore = score;
      best = place;
    }
  }
  return best;
}

function placeKey(place: RoamieRecommendationItem): string {
  return (
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim() ||
    `${place.placeName ?? place.name}@${place.address ?? ""}`
  );
}

function makeStop(
  place: RoamieRecommendationItem,
  date: string,
  bucket: PlaceBucket,
): RoamieItineraryItem {
  const placeId =
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim();
  return normalizeItineraryItem({
    date,
    time: BUCKET_TIME[bucket],
    title: place.name,
    placeName: place.placeName ?? place.name,
    description: place.description || place.reason || "",
    lat: place.lat,
    lng: place.lng,
    address: place.address?.trim() || place.name,
    googlePlaceId: placeId || undefined,
    placeType: place.type || bucket,
  });
}

/** 依類型混合、距離鄰近分配到每天 — 取代單純 round-robin */
export function buildMixedItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
): RoamieItineraryItem[] {
  const dayCount = Math.max(days, 1);
  const dates = listTripDates([], startDate, dayCount);
  const destLabel = destination?.trim() ? normalizeDestinationLabel(destination) : "";
  const center = destLabel ? resolveDestinationApproxCenter(destLabel) : null;

  const seen = new Set<string>();
  const unique: RoamieRecommendationItem[] = [];
  for (const place of selectedPlaces) {
    const key = placeKey(place);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }

  const buckets = new Map<PlaceBucket, RoamieRecommendationItem[]>();
  for (const place of unique) {
    const bucket = classifyPlaceBucket(place);
    const list = buckets.get(bucket) ?? [];
    list.push(place);
    buckets.set(bucket, list);
  }

  const used = new Set<string>();
  const stops: RoamieItineraryItem[] = [];

  for (let dayIdx = 0; dayIdx < dayCount; dayIdx += 1) {
    const date = dates[dayIdx] ?? startDate;
    const order = DAY_BUCKET_ORDER[dayIdx % DAY_BUCKET_ORDER.length] ?? DAY_BUCKET_ORDER[0]!;
    let anchor = center;

    for (const bucket of order) {
      const candidates = buckets.get(bucket) ?? [];
      const picked = pickClosestUnused(candidates, anchor, used);
      if (!picked) continue;
      used.add(placeKey(picked));
      stops.push(makeStop(picked, date, bucket));
      anchor = placeCoords(picked) ?? anchor;
    }
  }

  const leftovers = unique.filter((p) => !used.has(placeKey(p)));
  for (let i = 0; i < leftovers.length; i += 1) {
    const place = leftovers[i]!;
    const dayIdx = i % dayCount;
    const date = dates[dayIdx] ?? startDate;
    const bucket = classifyPlaceBucket(place);
    stops.push(makeStop(place, date, bucket));
  }

  return stops.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}
