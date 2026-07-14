import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import { resolveDestinationApproxCenter } from "@/lib/ai/destination-geocode";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import { distanceMeters } from "@/lib/map-explore";
import {
  annotatePlaceWithCombinationMetadata,
  redistributeToFillEmptyDays,
  selectPlacesWithCombinationQuota,
} from "@/lib/ai/combination-itinerary-integrity";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";

type PlaceBucket =
  | "attraction"
  | "restaurant"
  | "cafe"
  | "shopping"
  | "museum"
  | "park"
  | "night_market"
  | "creative"
  | "other";

const BUCKET_TIME: Record<PlaceBucket, string> = {
  park: "09:00",
  attraction: "09:30",
  museum: "10:30",
  restaurant: "12:00",
  cafe: "15:00",
  shopping: "16:30",
  creative: "14:00",
  night_market: "19:00",
  other: "14:00",
};

const DAY_BUCKET_ORDER: PlaceBucket[][] = [
  ["attraction", "creative", "restaurant", "shopping"],
  ["museum", "creative", "restaurant", "cafe"],
  ["attraction", "shopping", "restaurant", "night_market"],
  ["park", "creative", "cafe", "night_market"],
  ["museum", "shopping", "restaurant", "other"],
  ["attraction", "cafe", "restaurant", "other"],
  ["park", "shopping", "creative", "night_market"],
];

function classifyPlaceBucket(place: RoamieRecommendationItem): PlaceBucket {
  const blob = `${place.type ?? ""} ${place.name ?? ""} ${place.placeName ?? ""}`.toLowerCase();
  if (/(夜市|night\s*market)/i.test(blob)) return "night_market";
  if (/(restaurant|餐廳|美食|燒肉|火鍋|料理)/i.test(blob)) return "restaurant";
  if (/(cafe|coffee|咖啡|甜點|bakery)/i.test(blob)) return "cafe";
  if (/(文創|華山|松山文創|創意園區|creative)/i.test(blob)) return "creative";
  if (/(shopping_mall|mall|商圈|百貨|outlet|market|老街)/i.test(blob)) return "shopping";
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
    `${place.placeName ?? place.name}@${place.lat ?? ""},${place.lng ?? ""}`
  );
}

function combinationIdsOf(place: RoamieRecommendationItem): number[] {
  if (place.matchedSelectedCombinationIds?.length) {
    return place.matchedSelectedCombinationIds;
  }
  if (place.sourceCombinationId != null) return [place.sourceCombinationId];
  return [];
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
    sourceCombinationId: place.sourceCombinationId,
    matchedCombinationIds: place.matchedCombinationIds,
    matchedSelectedCombinationIds: place.matchedSelectedCombinationIds,
  });
}

/**
 * Allocate places across days with combination quotas.
 * Never lets the first selected combination fill all days before others are scheduled.
 */
export function buildMixedItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  opts?: { selectedCombinationIds?: number[] },
): RoamieItineraryItem[] {
  const dayCount = Math.max(days, 1);
  const dates = listTripDates([], startDate, dayCount);
  const destLabel = destination?.trim() ? normalizeDestinationLabel(destination) : "";
  const center = destLabel ? resolveDestinationApproxCenter(destLabel) : null;

  const selectedCombinationIds =
    opts?.selectedCombinationIds?.length
      ? opts.selectedCombinationIds
      : [
          ...new Set(
            selectedPlaces
              .flatMap((p) => combinationIdsOf(p))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        ].sort((a, b) => a - b);

  const annotated = selectedPlaces.map((p) =>
    destLabel && selectedCombinationIds.length
      ? annotatePlaceWithCombinationMetadata(p, destLabel, selectedCombinationIds)
      : p,
  );

  const quotaPicked = selectedCombinationIds.length
    ? selectPlacesWithCombinationQuota({
        places: annotated,
        selectedCombinationIds,
        targetPlaceCount: Math.max(dayCount * 2, annotated.length),
        destination: destLabel || destination || "",
      })
    : annotated;

  const seen = new Set<string>();
  const unique: RoamieRecommendationItem[] = [];
  for (const place of quotaPicked) {
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
  const comboCoverageByDay = new Map<number, Set<number>>();

  // Phase 1: seed one place per selected combination across different days first.
  if (selectedCombinationIds.length > 0) {
    selectedCombinationIds.forEach((comboId, comboOffset) => {
      const pool = unique.filter((p) => combinationIdsOf(p).includes(comboId));
      const dayIdx = comboOffset % dayCount;
      const date = dates[dayIdx] ?? startDate;
      const picked = pickClosestUnused(pool, center, used);
      if (!picked) return;
      used.add(placeKey(picked));
      const bucket = classifyPlaceBucket(picked);
      stops.push(makeStop(picked, date, bucket));
      const covered = comboCoverageByDay.get(dayIdx) ?? new Set<number>();
      covered.add(comboId);
      comboCoverageByDay.set(dayIdx, covered);
    });
  }

  // Phase 2: bucket-based fill (includes creative / night_market / other).
  for (let dayIdx = 0; dayIdx < dayCount; dayIdx += 1) {
    const date = dates[dayIdx] ?? startDate;
    const order = DAY_BUCKET_ORDER[dayIdx % DAY_BUCKET_ORDER.length] ?? DAY_BUCKET_ORDER[0]!;
    let anchor = center;
    const existing = stops.filter((s) => s.date === date);
    if (existing.length) {
      const last = existing[existing.length - 1]!;
      if (last.lat != null && last.lng != null) {
        anchor = { lat: last.lat, lng: last.lng };
      }
    }

    for (const bucket of order) {
      const candidates = buckets.get(bucket) ?? [];
      const picked = pickClosestUnused(candidates, anchor, used);
      if (!picked) continue;
      used.add(placeKey(picked));
      stops.push(makeStop(picked, date, bucket));
      anchor = placeCoords(picked) ?? anchor;
    }
  }

  // Phase 3: leftovers — prefer under-filled days and under-covered combinations.
  const leftovers = unique.filter((p) => !used.has(placeKey(p)));
  for (const place of leftovers) {
    let bestDay = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let dayIdx = 0; dayIdx < dayCount; dayIdx += 1) {
      const date = dates[dayIdx] ?? startDate;
      const count = stops.filter((s) => s.date === date).length;
      const comboIds = combinationIdsOf(place);
      const covered = comboCoverageByDay.get(dayIdx) ?? new Set();
      const comboBonus = comboIds.some((id) => !covered.has(id)) ? -2 : 0;
      const score = count + comboBonus;
      if (score < bestScore) {
        bestScore = score;
        bestDay = dayIdx;
      }
    }
    const date = dates[bestDay] ?? startDate;
    const bucket = classifyPlaceBucket(place);
    used.add(placeKey(place));
    stops.push(makeStop(place, date, bucket));
    const covered = comboCoverageByDay.get(bestDay) ?? new Set<number>();
    for (const id of combinationIdsOf(place)) covered.add(id);
    comboCoverageByDay.set(bestDay, covered);
  }

  const filled = redistributeToFillEmptyDays({
    stops,
    days: dayCount,
    startDate,
    sparePlaces: unique,
    makeStop: (place, date) => makeStop(place, date, classifyPlaceBucket(place)),
  });

  for (let dayIdx = 0; dayIdx < dayCount; dayIdx += 1) {
    const date = dates[dayIdx] ?? startDate;
    const dayStops = filled.filter((s) => s.date === date);
    logAiPipeline(
      "[COMBINATION_DAY_ALLOCATION]",
      `day=${dayIdx + 1}`,
      `date=${date}`,
      `places=${dayStops.map((s) => s.placeName).join("|")}`,
      `sources=${dayStops
        .map(
          (s) =>
            `${s.placeName}:${(s.matchedSelectedCombinationIds ?? (s.sourceCombinationId != null ? [s.sourceCombinationId] : [])).join(",")}`,
        )
        .join(";")}`,
    );
  }

  return filled.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}
