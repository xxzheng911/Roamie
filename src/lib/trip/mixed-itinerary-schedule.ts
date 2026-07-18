import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import {
  annotatePlaceWithCombinationMetadata,
  redistributeToFillEmptyDays,
  selectPlacesWithCombinationQuota,
} from "@/lib/ai/combination-itinerary-integrity";
import { clusterAndDedupeLandmarks } from "@/lib/ai/landmark-cluster";
import {
  clusterItemsByGeography,
  type GeoAccessor,
} from "@/lib/ai/geographic-clustering";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { combinationIdsFromPlace } from "@/lib/ai/combination-provenance";

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

function placeKey(place: RoamieRecommendationItem): string {
  return (
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim() ||
    `${place.placeName ?? place.name}@${place.lat ?? ""},${place.lng ?? ""}`
  );
}

function combinationIdsOf(place: RoamieRecommendationItem): number[] {
  return combinationIdsFromPlace(place);
}

function makeStop(
  place: RoamieRecommendationItem,
  date: string,
  bucket: PlaceBucket,
  timeOverride?: string,
): RoamieItineraryItem {
  const placeId =
    place.googlePlaceId?.trim() ||
    (place as RoamieRecommendationItem & { placeId?: string }).placeId?.trim();
  return normalizeItineraryItem({
    date,
    time: timeOverride ?? BUCKET_TIME[bucket],
    title: place.name,
    placeName: place.placeName ?? place.name,
    description: place.description || place.reason || "",
    lat: place.lat,
    lng: place.lng,
    address: place.address?.trim() || place.name,
    googlePlaceId: placeId || undefined,
    placeType: place.type || bucket,
    sourceCombinationId: place.sourceCombinationId,
    sourceCombinationIds: place.sourceCombinationIds,
    matchedCombinationIds: place.matchedCombinationIds,
    matchedSelectedCombinationIds: place.matchedSelectedCombinationIds,
    sourceRegionCandidate: place.sourceRegionCandidate,
    photoName: place.photoName,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    businessStatus: place.businessStatus,
    openStatusLabel: place.openStatusLabel,
    todayHoursLabel: place.todayHoursLabel,
    types: place.type ? [place.type] : undefined,
    placeSnapshotSource: "selected_place",
  });
}

/** Map a recommendation item to a PlaceResult-lite for landmark clustering. */
function recToLandmarkPlace(
  item: RoamieRecommendationItem,
): PlaceResult & { __rec: RoamieRecommendationItem } {
  const id =
    item.googlePlaceId?.trim() ||
    (item as RoamieRecommendationItem & { placeId?: string }).placeId?.trim() ||
    (item.placeName ?? item.name ?? "");
  return {
    id,
    name: item.placeName ?? item.name ?? "",
    address: item.address ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.type ?? null,
    types: item.type ? [item.type] : null,
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: item.closingSoonNote ?? "",
    nextOpenHint: item.nextOpenHint ?? "",
    __rec: item,
  } as unknown as PlaceResult & { __rec: RoamieRecommendationItem };
}

/** Remove附屬地標 (main/sub landmark) duplicates from a recommendation pool. */
function dedupeLandmarksForRecs(
  items: RoamieRecommendationItem[],
): RoamieRecommendationItem[] {
  const lite = items.map(recToLandmarkPlace);
  const { places } = clusterAndDedupeLandmarks(lite);
  return places.map(
    (p) => (p as PlaceResult & { __rec: RoamieRecommendationItem }).__rec,
  );
}

const GEO_ACCESSOR: GeoAccessor<RoamieRecommendationItem> = {
  coords: (p) => placeCoords(p),
  id: (p) => placeKey(p),
  name: (p) => p.placeName ?? p.name,
  address: (p) => p.address ?? "",
  weight: (p) => p.userRatingCount ?? 0,
};

const DAY_TIME_SLOTS = ["09:30", "11:00", "12:30", "14:00", "15:30", "17:00", "19:00", "20:30"];

/** Order a day's places by time-of-day intent then assign non-colliding clock times. */
function scheduleDayPlaces(
  places: RoamieRecommendationItem[],
): { place: RoamieRecommendationItem; bucket: PlaceBucket; time: string }[] {
  const ranked = places
    .map((place) => ({ place, bucket: classifyPlaceBucket(place) }))
    .sort((a, b) => BUCKET_TIME[a.bucket].localeCompare(BUCKET_TIME[b.bucket]));

  return ranked.map((entry, index) => {
    let time = DAY_TIME_SLOTS[Math.min(index, DAY_TIME_SLOTS.length - 1)]!;
    // Keep nightlife in the evening even if it sorts early.
    if ((entry.bucket === "night_market" || entry.place.type === "bar") && time < "18:00") {
      time = "19:00";
    }
    return { place: entry.place, bucket: entry.bucket, time };
  });
}

/**
 * Allocate places across days using GEOGRAPHY-FIRST clustering: nearby places are
 * grouped into the same day, then each geographic cluster maps to a day. Selected
 * combinations only influence which places are kept (via quota selection), not the
 * per-day boundaries. Empty days are back-filled by redistribute.
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

  // Global main/sub landmark de-duplication before day assignment.
  const beforeDedupe = unique.length;
  const landmarkKept = dedupeLandmarksForRecs(unique);
  logAiPipeline(
    "[GLOBAL_LANDMARK_DEDUPE_STATS]",
    `before=${beforeDedupe}`,
    `after=${landmarkKept.length}`,
    `merged=${beforeDedupe - landmarkKept.length}`,
  );

  // Geography-first: cluster nearby places, then map each cluster to a day.
  const { clusters, unlocated } = clusterItemsByGeography(
    landmarkKept,
    dayCount,
    GEO_ACCESSOR,
  );
  logAiPipeline(
    "[GEOGRAPHIC_CLUSTER_STATS]",
    `clusterCount=${clusters.length}`,
    `unlocated=${unlocated.length}`,
    `clusters=[${clusters.map((c) => `${c.areaName}:${c.items.length}`).join("|")}]`,
  );

  logAiPipeline(
    "[DAILY_ALLOCATION_INPUT]",
    `tripDays=${dayCount}`,
    `placeCount=${landmarkKept.length}`,
    `clusterCount=${clusters.length}`,
  );

  const dayByKey = new Map<string, number>();
  const dayLoad = new Array<number>(dayCount).fill(0);
  for (const cluster of clusters) {
    const dayIdx = Math.min(dayCount - 1, Math.max(0, (cluster.candidateDay ?? 1) - 1));
    logAiPipeline(
      "[DAY_AREA_ASSIGNMENT]",
      `day=${dayIdx + 1}`,
      `primaryArea=${cluster.areaName}`,
      `clusterIds=[${cluster.clusterId}]`,
    );
    for (const item of cluster.items) {
      dayByKey.set(placeKey(item), dayIdx);
      dayLoad[dayIdx] += 1;
    }
  }
  // Places without usable coordinates → least-loaded day.
  for (const item of unlocated) {
    let best = 0;
    for (let i = 1; i < dayCount; i += 1) if (dayLoad[i]! < dayLoad[best]!) best = i;
    dayByKey.set(placeKey(item), best);
    dayLoad[best] += 1;
  }

  const stops: RoamieItineraryItem[] = [];
  for (let dayIdx = 0; dayIdx < dayCount; dayIdx += 1) {
    const date = dates[dayIdx] ?? startDate;
    const dayPlaces = landmarkKept.filter((p) => dayByKey.get(placeKey(p)) === dayIdx);
    for (const scheduled of scheduleDayPlaces(dayPlaces)) {
      stops.push(makeStop(scheduled.place, date, scheduled.bucket, scheduled.time));
    }
  }

  const filled = redistributeToFillEmptyDays({
    stops,
    days: dayCount,
    startDate,
    sparePlaces: landmarkKept,
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

  logAiPipeline(
    "[DAILY_ALLOCATION_OUTPUT]",
    ...Array.from({ length: dayCount }, (_, i) => {
      const date = dates[i] ?? startDate;
      const count = filled.filter((s) => s.date === date).length;
      return `day${i + 1}Count=${count}`;
    }),
  );

  return filled.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });
}
