import type { RoamieItineraryItem, RoamieRecommendationItem } from "@/lib/ai/types";
import { normalizeItineraryItem } from "@/lib/ai/types";
import type { PlaceResult } from "@/lib/place-result";
import { normalizeDestinationLabel } from "@/lib/ai/trip-planning-context";
import { listTripDates } from "@/lib/outfit/group-by-date";
import {
  annotatePlaceWithCombinationMetadata,
  selectPlacesWithCombinationQuota,
} from "@/lib/ai/combination-itinerary-integrity";
import { clusterAndDedupeLandmarks } from "@/lib/ai/landmark-cluster";
import {
  dedupeByCanonicalLandmark,
  requiredCanonicalCandidatesForTrip,
  resolveCanonicalLandmarkKey,
} from "@/lib/ai/canonical-landmark";
import { clusterItemsByGeography, type GeoAccessor } from "@/lib/ai/geographic-clustering";
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import { combinationIdsFromPlace } from "@/lib/ai/combination-provenance";
import {
  applyPlannerRouteAndCapacityAssembly,
  maxEffectivePlacesPerDay,
  minEffectivePlacesPerDay,
  type AssemblyDayPlan,
  type PlannerPaceHint,
} from "@/lib/ai/planner-day-route-assembly";
import { computeMinimumPerSelectedCombination } from "@/lib/ai/combination-itinerary-integrity";
import { enforceGlobalFamilyFeasibility } from "@/lib/ai/global-family-feasibility";

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
  const blob =
    `${place.primaryType ?? ""} ${place.type ?? ""} ${(place.types ?? []).join(" ")} ${place.name ?? ""} ${place.placeName ?? ""}`.toLowerCase();
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

const DINING_TYPES = new Set(["restaurant", "food", "meal_takeaway"]);

export function isMixedItineraryDiningCandidate(place: RoamieRecommendationItem): boolean {
  const types = [place.primaryType, place.type, ...(place.types ?? [])]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase());
  return types.some((type) => DINING_TYPES.has(type));
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
    placeType: place.primaryType || place.type || bucket,
    coordinateSource:
      placeId && place.lat != null && place.lng != null ? "google_places" : undefined,
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
    types: place.types?.length
      ? place.types
      : place.primaryType || place.type
        ? [place.primaryType || place.type]
        : undefined,
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
    primaryType: item.primaryType ?? item.type ?? null,
    types: item.types?.length ? item.types : item.type ? [item.type] : null,
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: item.closingSoonNote ?? "",
    nextOpenHint: item.nextOpenHint ?? "",
    __rec: item,
  } as unknown as PlaceResult & { __rec: RoamieRecommendationItem };
}

/** Remove附屬地標 + canonical landmark duplicates from a recommendation pool. */
function dedupeLandmarksForRecs(items: RoamieRecommendationItem[]): RoamieRecommendationItem[] {
  const lite = items.map(recToLandmarkPlace);
  const clustered = clusterAndDedupeLandmarks(lite).places;
  const canonical = dedupeByCanonicalLandmark(clustered).places;
  return canonical.map((p) => (p as PlaceResult & { __rec: RoamieRecommendationItem }).__rec);
}

function recFromPlace(place: PlaceResult): RoamieRecommendationItem | null {
  const tagged = place as PlaceResult & { __rec?: RoamieRecommendationItem };
  if (tagged.__rec) return tagged.__rec;
  return null;
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

export type MixedItineraryBuildResult = {
  stops: RoamieItineraryItem[];
  candidateInsufficient: boolean;
  requiredCount: number;
  availableCount: number;
  missingCount: number;
  affectedDays: number[];
  replanReasons: string[];
  dayCounts: number[];
};

/**
 * Allocate places across days using GEOGRAPHY-FIRST clustering, then
 * Planner Route + Capacity Assembly（與 Style 路徑同一套約束）。
 *
 * Selected combinations only influence which places are kept (quota), not
 * per-day boundaries. nearbyExtensions 集中於單一天。
 */
export function buildMixedItineraryWithDiagnostics(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  opts?: {
    selectedCombinationIds?: number[];
    nearbyExtensions?: string[];
    pace?: PlannerPaceHint;
  },
): MixedItineraryBuildResult {
  const dayCount = Math.max(days, 1);
  const dates = listTripDates([], startDate, dayCount);
  const destLabel = destination?.trim() ? normalizeDestinationLabel(destination) : "";
  const pace: PlannerPaceHint = opts?.pace ?? "medium";
  const minPerDay = minEffectivePlacesPerDay(pace);
  const requiredCanonical = requiredCanonicalCandidatesForTrip(dayCount, pace);
  const nearbyExtensions = (opts?.nearbyExtensions ?? [])
    .map((e) => normalizeDestinationLabel(e))
    .filter(Boolean);

  const selectedCombinationIds = opts?.selectedCombinationIds?.length
    ? opts.selectedCombinationIds
    : [
        ...new Set(
          selectedPlaces
            .flatMap((p) => combinationIdsOf(p))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ].sort((a, b) => a - b);
  const mealContractEnabled = selectedCombinationIds.length > 0;
  if (mealContractEnabled) {
    for (let day = 1; day <= dayCount; day += 1) {
      logAiPipeline(
        "[MEAL_SLOT_REQUIREMENTS]",
        `day=${day}`,
        "lunchRequired=true",
        "dinnerRequired=true",
        "reason=selected_combination_full_day_default",
        "dayAvailableStart=unknown",
        "dayAvailableEnd=unknown",
      );
    }
  }

  const annotated = selectedPlaces.map((p) =>
    destLabel && selectedCombinationIds.length
      ? annotatePlaceWithCombinationMetadata(p, destLabel, selectedCombinationIds)
      : p,
  );

  const diningCandidates = mealContractEnabled
    ? annotated.filter(isMixedItineraryDiningCandidate)
    : [];
  const scenicCandidates = mealContractEnabled
    ? annotated.filter((place) => !isMixedItineraryDiningCandidate(place))
    : annotated;
  const seen = new Set<string>();
  const unique: RoamieRecommendationItem[] = [];
  for (const place of scenicCandidates) {
    const key = placeKey(place);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(place);
  }

  // Global main/sub + canonical landmark de-duplication BEFORE day assignment.
  const beforeDedupe = unique.length;
  const dedupedScenic = dedupeLandmarksForRecs(unique);
  const mealSlotsPerFullDay = mealContractEnabled ? 2 : 0;
  const dailyScenicCapacity = Math.max(
    minPerDay,
    maxEffectivePlacesPerDay(pace) - mealSlotsPerFullDay,
  );
  const dailyScenicTarget = Math.min(minPerDay, dailyScenicCapacity);
  const baseScenicTarget = dayCount * dailyScenicTarget;
  const requiredScenicCount = dedupedScenic.filter((place) => place.isRequiredBySelection).length;
  const minimumPerCombination = computeMinimumPerSelectedCombination(
    baseScenicTarget,
    selectedCombinationIds.length,
  );
  const boundedScenicTarget = Math.min(
    dedupedScenic.length,
    Math.max(
      baseScenicTarget,
      requiredScenicCount,
      selectedCombinationIds.length * minimumPerCombination,
    ),
  );
  const quotaPriority = selectedCombinationIds.length
    ? selectPlacesWithCombinationQuota({
        places: dedupedScenic,
        selectedCombinationIds,
        targetPlaceCount: boundedScenicTarget,
        destination: destLabel || destination || "",
      })
    : dedupedScenic.slice(0, boundedScenicTarget);
  const quotaPriorityIds = new Set(quotaPriority.map(placeKey));
  const quotaOrdered = [
    ...quotaPriority,
    ...dedupedScenic.filter((place) => !quotaPriorityIds.has(placeKey(place))),
  ];
  const feasibleSelection = enforceGlobalFamilyFeasibility({
    candidates: quotaOrdered,
    dayCount,
    targetCount: boundedScenicTarget,
    selectedCombinationIds,
    minimumPerCombination,
    style: "mixed",
  });
  const landmarkKept = feasibleSelection.selected;
  const uniquePlaceIds = new Set(landmarkKept.map((p) => p.googlePlaceId?.trim()).filter(Boolean));
  const canonicalKeys = new Set(
    landmarkKept.map((p) => resolveCanonicalLandmarkKey(recToLandmarkPlace(p))),
  );
  logAiPipeline(
    "[GLOBAL_LANDMARK_DEDUPE_STATS]",
    `before=${beforeDedupe}`,
    `after=${dedupedScenic.length}`,
    `merged=${beforeDedupe - dedupedScenic.length}`,
    `uniquePlaceIds=${uniquePlaceIds.size}`,
    `canonicalCount=${canonicalKeys.size}`,
  );
  logAiPipeline(
    "[PLANNER_POOL_DIAG_A]",
    `totalCandidateCount=${beforeDedupe}`,
    `uniquePlaceIdCount=${uniquePlaceIds.size}`,
    `canonicalPlaceCount=${canonicalKeys.size}`,
    `requiredCanonical=${requiredCanonical}`,
  );

  const poolPlaces = landmarkKept.map(recToLandmarkPlace);
  let candidateInsufficient = canonicalKeys.size < requiredCanonical;
  if (candidateInsufficient) {
    logAiPipeline(
      "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
      `available=${canonicalKeys.size}`,
      `required=${requiredCanonical}`,
      `days=${dayCount}`,
      `pace=${pace}`,
      "stage=pre_allocation",
    );
  }

  // Geography-first seed → Assembly 補位／近郊集中／Route
  const { clusters, unlocated } = clusterItemsByGeography(landmarkKept, dayCount, GEO_ACCESSOR);
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
    `requiredMinPerDay=${minPerDay}`,
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
  for (const item of unlocated) {
    let best = 0;
    for (let i = 1; i < dayCount; i += 1) if (dayLoad[i]! < dayLoad[best]!) best = i;
    dayByKey.set(placeKey(item), best);
    dayLoad[best] += 1;
  }

  const seedPlans: AssemblyDayPlan[] = Array.from({ length: dayCount }, (_, i) => {
    const dayPlaces = landmarkKept.filter((p) => dayByKey.get(placeKey(p)) === i);
    const entries = scheduleDayPlaces(dayPlaces).map((s) => ({
      time: s.time,
      label: s.bucket === "restaurant" || s.bucket === "cafe" ? "餐食" : "景點",
      name: s.place.placeName ?? s.place.name,
      place: recToLandmarkPlace(s.place),
    }));
    return { day: i + 1, entries };
  });

  logAiPipeline(
    "[PLANNER_POOL_DIAG_C]",
    `availableCandidateCount=${poolPlaces.length}`,
    `requestedDays=${dayCount}`,
    `requiredMinimumCount=${dayCount * minPerDay}`,
    `enough=${poolPlaces.length >= dayCount * minPerDay}`,
  );

  const assembled = applyPlannerRouteAndCapacityAssembly({
    plans: seedPlans,
    pool: poolPlaces,
    days: dayCount,
    style: "mixed",
    nearbyExtensions,
    pace,
  });
  candidateInsufficient = candidateInsufficient || assembled.candidateInsufficient;

  logAiPipeline(
    "[PLANNER_POOL_DIAG_D]",
    `dayCounts=${assembled.diagnostics.map((d) => d.finalPlaceCount).join(",")}`,
    `capacityFallback=${assembled.capacityFallbackTriggered}`,
    `candidateInsufficient=${candidateInsufficient}`,
    `dayPlaceIds=${assembled.plans
      .map((p) => `${p.day}:[${p.entries.map((e) => e.place.id ?? e.name).join("|")}]`)
      .join(";")}`,
  );

  const resolveRec = (entry: { name: string; place: PlaceResult }): RoamieRecommendationItem => {
    const fromTag = recFromPlace(entry.place);
    if (fromTag) return fromTag;
    const matched = landmarkKept.find(
      (r) =>
        (r.googlePlaceId?.trim() && r.googlePlaceId.trim() === (entry.place.id ?? "").trim()) ||
        (r.placeName ?? r.name) === entry.name,
    );
    if (matched) return matched;
    return {
      name: entry.name,
      placeName: entry.name,
      type: entry.place.primaryType ?? "tourist_attraction",
      primaryType: entry.place.primaryType,
      types: entry.place.types ?? undefined,
      description: entry.place.address ?? entry.name,
      reason: "",
      estimatedTime: "1-2 小時",
      address: entry.place.address ?? entry.name,
      lat: entry.place.lat,
      lng: entry.place.lng,
      googleMapsUrl: "",
      reasonSource: "template",
      googlePlaceId: entry.place.id || undefined,
      photoName: entry.place.photoName,
      rating: entry.place.rating,
      userRatingCount: entry.place.userRatingCount ?? undefined,
    } as RoamieRecommendationItem;
  };

  // Assembly → itinerary stops（單點日交給後續 merge，勿在此丟棄地點）
  // Prefer day→date Map over dates[day-1] so remapped / out-of-range days never crash.
  const dateByDay = new Map<number, string>();
  for (let day = 1; day <= dayCount; day += 1) {
    dateByDay.set(day, dates[day - 1] ?? startDate);
  }
  const stops: RoamieItineraryItem[] = [];
  for (const plan of assembled.plans) {
    const safeDay =
      Number.isFinite(plan.day) && plan.day >= 1 && plan.day <= dayCount
        ? plan.day
        : Math.min(dayCount, Math.max(1, Math.floor(plan.day) || 1));
    const date = dateByDay.get(safeDay) ?? startDate;
    if (plan.entries.length === 1) {
      candidateInsufficient = true;
    }
    plan.entries.forEach((entry, index) => {
      const rec = resolveRec(entry);
      const bucket = classifyPlaceBucket(rec);
      const time = entry.time || DAY_TIME_SLOTS[Math.min(index, DAY_TIME_SLOTS.length - 1)]!;
      stops.push(makeStop(rec, date, bucket, time));
    });
  }

  // 禁止 redistribute 從已達容量的天拆 1 點去填空日——會製造單點日，
  // 接著再被 drop，反而讓原本完整天掉成 1～2 點（實機回歸根因之一）。
  const finalByDate = new Map<string, RoamieItineraryItem[]>();
  for (const date of dates) finalByDate.set(date, []);
  for (const stop of stops) {
    const date = stop.date?.trim() || dates[0]!;
    const list = finalByDate.get(date) ?? [];
    list.push(stop);
    finalByDate.set(date, list);
  }

  // 僅當 spare 足以一次補滿 minPerDay 時才填空日；否則標記 insufficient、保持空日
  const usedKeys = new Set(
    stops.map(
      (s) =>
        s.googlePlaceId?.trim() || `${(s.placeName ?? s.title).replace(/\s+/g, "").toLowerCase()}`,
    ),
  );

  const mergeSingletonIntoNeighbor = (dayIdx: number): void => {
    const date = dates[dayIdx]!;
    const lone = finalByDate.get(date) ?? [];
    if (lone.length !== 1) return;
    candidateInsufficient = true;
    const candidates = [
      dayIdx - 1,
      dayIdx + 1,
      ...Array.from({ length: dayCount }, (_, i) => i),
    ].filter((i) => i >= 0 && i < dayCount && i !== dayIdx);
    let merged = false;
    for (const targetIdx of candidates) {
      const targetDate = dates[targetIdx]!;
      const target = finalByDate.get(targetDate) ?? [];
      if (target.length === 0) continue;
      finalByDate.set(targetDate, [...target, ...lone.map((s) => ({ ...s, date: targetDate }))]);
      finalByDate.set(date, []);
      merged = true;
      logAiPipeline(
        "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
        `day=${dayIdx + 1}`,
        "action=merge_singleton_into_neighbor",
        `toDay=${targetIdx + 1}`,
        `place=${lone[0]?.placeName ?? ""}`,
      );
      break;
    }
    if (!merged) {
      finalByDate.set(date, []);
      logAiPipeline(
        "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
        `day=${dayIdx + 1}`,
        "action=clear_singleton_no_neighbor",
        `place=${lone[0]?.placeName ?? ""}`,
      );
    }
  };

  for (let i = 0; mealContractEnabled && i < dayCount; i += 1) {
    const date = dates[i]!;
    const dayStops = finalByDate.get(date) ?? [];
    if (dayStops.length >= minPerDay) continue;
    if (dayStops.length === 1 && dayStops.length < minPerDay) {
      // 單點日：併入鄰近日（保留地點），勿靜默保留 1 點日、也勿直接丟棄
      mergeSingletonIntoNeighbor(i);
      continue;
    }
    if (dayStops.length === 0) {
      const spares = landmarkKept.filter((p) => {
        const key =
          p.googlePlaceId?.trim() || `${(p.placeName ?? p.name).replace(/\s+/g, "").toLowerCase()}`;
        return key && !usedKeys.has(key);
      });
      if (spares.length >= minPerDay) {
        const filledDay: RoamieItineraryItem[] = [];
        for (let n = 0; n < minPerDay; n += 1) {
          const spare = spares[n]!;
          const key =
            spare.googlePlaceId?.trim() ||
            `${(spare.placeName ?? spare.name).replace(/\s+/g, "").toLowerCase()}`;
          usedKeys.add(key);
          filledDay.push(
            makeStop(
              spare,
              date,
              classifyPlaceBucket(spare),
              DAY_TIME_SLOTS[Math.min(n, DAY_TIME_SLOTS.length - 1)]!,
            ),
          );
        }
        finalByDate.set(date, filledDay);
      } else {
        candidateInsufficient = true;
        logAiPipeline(
          "[AI_PLANNER_CANDIDATE_INSUFFICIENT]",
          `day=${i + 1}`,
          "action=leave_empty_no_singleton_fill",
          `spare=${spares.length}`,
          `need=${minPerDay}`,
        );
      }
    }
  }

  const unusedDining = [...diningCandidates];
  const usedDiningIds = new Set<string>();
  const distanceToDay = (
    place: RoamieRecommendationItem,
    dayStops: RoamieItineraryItem[],
  ): number => {
    if (place.lat == null || place.lng == null) return Number.POSITIVE_INFINITY;
    const located = dayStops.filter((stop) => stop.lat != null && stop.lng != null);
    if (!located.length) return 0;
    const centerLat = located.reduce((sum, stop) => sum + (stop.lat ?? 0), 0) / located.length;
    const centerLng = located.reduce((sum, stop) => sum + (stop.lng ?? 0), 0) / located.length;
    return Math.hypot(place.lat - centerLat, place.lng - centerLng);
  };

  for (let i = 0; i < dayCount; i += 1) {
    const date = dates[i]!;
    const dayStops = finalByDate.get(date) ?? [];
    for (const slot of ["lunch", "dinner"] as const) {
      const candidate = unusedDining
        .filter((place) => {
          const key = placeKey(place);
          return Boolean(key) && !usedDiningIds.has(key);
        })
        .sort((a, b) => distanceToDay(a, dayStops) - distanceToDay(b, dayStops))[0];
      if (!candidate) {
        logAiPipeline(
          "[MEAL_SLOT_ALLOCATION]",
          `day=${i + 1}`,
          `slot=${slot}`,
          "selectedPlace=",
          "placeId=",
          "primaryType=",
          "normalizedTypes=[]",
          "selectionMode=nearest_day_area",
          "success=false",
          "failureReason=insufficient_verified_candidates",
        );
        continue;
      }
      const key = placeKey(candidate);
      usedDiningIds.add(key);
      const mealStop = makeStop(
        candidate,
        date,
        "restaurant",
        slot === "lunch" ? "12:00" : "18:30",
      );
      dayStops.push(mealStop);
      logAiPipeline(
        "[MEAL_SLOT_ALLOCATION]",
        `day=${i + 1}`,
        `slot=${slot}`,
        `selectedPlace=${candidate.placeName ?? candidate.name}`,
        `placeId=${candidate.googlePlaceId ?? ""}`,
        `primaryType=${candidate.primaryType ?? candidate.type ?? ""}`,
        `normalizedTypes=[${(candidate.types ?? []).join(",")}]`,
        "selectionMode=nearest_day_area",
        "success=true",
        "failureReason=",
      );
    }
    finalByDate.set(date, dayStops);
  }

  const output: RoamieItineraryItem[] = [];
  for (let i = 0; i < dayCount; i += 1) {
    const date = dates[i]!;
    const dayStops = finalByDate.get(date) ?? [];
    const lunchCount = dayStops.filter(
      (stop) =>
        stop.time >= "11:30" &&
        stop.time <= "14:00" &&
        (stop.types ?? []).some((type) => DINING_TYPES.has(type)),
    ).length;
    const dinnerCount = dayStops.filter(
      (stop) =>
        stop.time >= "17:30" &&
        stop.time <= "20:30" &&
        (stop.types ?? []).some((type) => DINING_TYPES.has(type)),
    ).length;
    if (mealContractEnabled) {
      logAiPipeline(
        "[MEAL_COVERAGE_SUMMARY]",
        `day=${i + 1}`,
        "lunchRequired=true",
        "dinnerRequired=true",
        `lunchCount=${lunchCount}`,
        `dinnerCount=${dinnerCount}`,
        `foodStopCount=${lunchCount + dinnerCount}`,
        `missingSlots=${[...(lunchCount ? [] : ["lunch"]), ...(dinnerCount ? [] : ["dinner"])].join(
          ",",
        )}`,
      );
    }
    output.push(...dayStops);
    logAiPipeline(
      "[COMBINATION_DAY_ALLOCATION]",
      `day=${i + 1}`,
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
    "[PLANNER_POOL_DIAG_E]",
    `finalDayCounts=${dates
      .map((d, i) => `${i + 1}:${output.filter((s) => s.date === d).length}`)
      .join(",")}`,
    `candidateInsufficient=${candidateInsufficient}`,
    `uiStopCount=${output.length}`,
  );

  logAiPipeline(
    "[DAILY_ALLOCATION_OUTPUT]",
    ...Array.from({ length: dayCount }, (_, i) => {
      const date = dates[i] ?? startDate;
      const count = output.filter((s) => s.date === date).length;
      return `day${i + 1}Count=${count}`;
    }),
    `candidateInsufficient=${candidateInsufficient}`,
  );

  const sortedStops = output.sort((a, b) => {
    const dateCmp = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCmp !== 0) return dateCmp;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });

  const dayCounts = dates.map(
    (d) => sortedStops.filter((s) => (s.date?.trim() || dates[0]) === d).length,
  );
  const requiredCount = dayCount * minPerDay;
  const availableCount = canonicalKeys.size;
  const affectedDays = dayCounts
    .map((count, idx) => (count < minPerDay ? idx + 1 : -1))
    .filter((d) => d > 0);
  const insufficient =
    candidateInsufficient || availableCount < requiredCount || affectedDays.length > 0;
  const missingCount = Math.max(0, requiredCount - availableCount);
  const replanReasons = insufficient ? ["insufficient_candidates"] : [];

  if (insufficient) {
    logAiPipeline(
      "[CANDIDATE_INSUFFICIENT_RESULT]",
      `candidateInsufficient=true`,
      `requiredCount=${requiredCount}`,
      `availableCount=${availableCount}`,
      `missingCount=${missingCount}`,
      `affectedDays=[${affectedDays.join(",")}]`,
      `replanReasons=${replanReasons.join("|")}`,
      `dayCounts=${dayCounts.join(",")}`,
    );
  }

  return {
    stops: sortedStops,
    candidateInsufficient: insufficient,
    requiredCount,
    availableCount,
    missingCount,
    affectedDays,
    replanReasons,
    dayCounts,
  };
}

/** Compatibility wrapper — returns stops only. Prefer {@link buildMixedItineraryWithDiagnostics}. */
export function buildMixedItineraryFromPlaces(
  selectedPlaces: RoamieRecommendationItem[],
  days: number,
  startDate: string,
  destination?: string,
  opts?: {
    selectedCombinationIds?: number[];
    nearbyExtensions?: string[];
    pace?: PlannerPaceHint;
  },
): RoamieItineraryItem[] {
  return buildMixedItineraryWithDiagnostics(selectedPlaces, days, startDate, destination, opts)
    .stops;
}
