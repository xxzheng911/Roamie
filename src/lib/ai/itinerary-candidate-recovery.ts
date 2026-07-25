import type { PlaceResult } from "@/lib/place-result";
import type { CanonicalTravelContext } from "@/lib/ai/travel-context";
import type { ComposedDayPlan } from "@/lib/ai/ai-day-plan-source";
import { classifyPlanPlaceKind } from "@/lib/ai/ai-day-plan-source";
import { dedupeCandidatePlaces } from "@/lib/ai/ai-multi-day-planner";
import { filterRealPlanningPlaces } from "@/lib/ai/planning-real-place";
import { resolveTripPlaceId } from "@/lib/ai/ai-trip-place-allocator";

export type CandidateRecoverySource =
  | "selected_places"
  | "combination_pool"
  | "scenic_pool"
  | "planner_unused"
  | "existing_places";

export type CandidateRecoveryResult = {
  places: PlaceResult[];
  candidateRecovered: number;
  recoveredBySource: Record<CandidateRecoverySource, number>;
};

const EMPTY_SOURCE_COUNTS: Record<CandidateRecoverySource, number> = {
  selected_places: 0,
  combination_pool: 0,
  scenic_pool: 0,
  planner_unused: 0,
  existing_places: 0,
};

function recommendationToPlace(item: NonNullable<CanonicalTravelContext["partiallyResolvedPlaces"]>[number]): PlaceResult | null {
  const id = (item.googlePlaceId ?? item.placeId ?? "").trim();
  const name = (item.displayName ?? item.placeName ?? item.name ?? "").trim();
  if (!id || !name || item.lat == null || item.lng == null) return null;
  return {
    id,
    name,
    originalName: item.name,
    localizedDisplayName: item.displayName ?? item.name,
    address: item.address || null,
    lat: item.lat,
    lng: item.lng,
    rating: item.rating ?? null,
    userRatingCount: item.userRatingCount ?? null,
    photoName: item.photoName ?? null,
    primaryType: item.primaryType ?? item.type ?? null,
    types: item.types ?? (item.type ? [item.type] : []),
    businessStatus: item.businessStatus ?? null,
    openStatus: "unknown",
    openStatusLabel: item.openStatusLabel ?? "",
    todayHoursLabel: item.todayHoursLabel ?? "",
    closingSoonNote: item.closingSoonNote ?? "",
    nextOpenHint: item.nextOpenHint ?? "",
    coordinateSource: "google_places",
  };
}

function offeredCombinationPlaces(context: CanonicalTravelContext): PlaceResult[] {
  const selected = new Set(context.selectedCombinationIds ?? []);
  return (context.offeredCombinations ?? []).flatMap((combination) => {
    if (selected.size && !selected.has(combination.id)) return [];
    return combination.places.flatMap((item): PlaceResult[] => {
      if (
        item.resolutionStatus !== "resolved" ||
        !item.googlePlaceId ||
        item.latitude == null ||
        item.longitude == null
      ) return [];
      return [{
        id: item.googlePlaceId,
        name: item.localizedDisplayName ?? item.name,
        originalName: item.originalName ?? item.name,
        localizedDisplayName: item.localizedDisplayName ?? item.name,
        address: item.address ?? null,
        lat: item.latitude,
        lng: item.longitude,
        rating: item.rating ?? null,
        userRatingCount: null,
        photoName: null,
        primaryType: item.primaryType ?? null,
        types: item.types ?? [],
        businessStatus: null,
        openStatus: "unknown",
        openStatusLabel: "",
        todayHoursLabel: "",
        closingSoonNote: "",
        nextOpenHint: "",
        coordinateSource: "google_places",
      }];
    });
  });
}

export function recoverInMemoryCandidatePool(params: {
  context: CanonicalTravelContext;
  selectedPlaces?: PlaceResult[];
  combinationPlaces?: PlaceResult[];
  scenicPlaces?: PlaceResult[];
  plannerPlaces?: PlaceResult[];
  existingPlaces?: PlaceResult[];
}): CandidateRecoveryResult {
  const sources: Array<[CandidateRecoverySource, PlaceResult[]]> = [
    ["selected_places", [
      ...(params.selectedPlaces ?? []),
      ...(params.context.partiallyResolvedPlaces ?? []).flatMap((item) => {
        const place = recommendationToPlace(item);
        return place ? [place] : [];
      }),
    ]],
    ["combination_pool", [...offeredCombinationPlaces(params.context), ...(params.combinationPlaces ?? [])]],
    ["scenic_pool", params.scenicPlaces ?? []],
    ["planner_unused", params.plannerPlaces ?? []],
    ["existing_places", params.existingPlaces ?? []],
  ];

  const recoveredBySource = { ...EMPTY_SOURCE_COUNTS };
  const accumulated: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const [source, candidates] of sources) {
    for (const place of dedupeCandidatePlaces(filterRealPlanningPlaces(candidates))) {
      const id = resolveTripPlaceId(place);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      accumulated.push(place);
      recoveredBySource[source] += 1;
    }
  }

  return {
    places: dedupeCandidatePlaces(accumulated),
    candidateRecovered: accumulated.length,
    recoveredBySource,
  };
}

export type PayloadDegradationDecision = {
  requiredSlots: string[];
  optionalSlots: string[];
  missingRequired: string[];
  missingOptional: string[];
  degraded: boolean;
  deliveryAllowed: boolean;
};

export function evaluateIncompletePayloadDegradation(params: {
  plans: ComposedDayPlan[];
  days: number;
  requiredPlaceIds?: string[];
}): PayloadDegradationDecision {
  const requiredSlots = ["scenic", "meal"];
  const optionalSlots = ["breakfast", "cafe", "evening", "attraction_2"];
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const globallyUsed = new Set<string>();
  const requiredIds = new Set(params.requiredPlaceIds ?? []);
  const presentRequired = new Set<string>();
  const byDay = new Map(params.plans.map((plan) => [plan.day, plan]));

  for (let day = 1; day <= params.days; day += 1) {
    const entries = byDay.get(day)?.entries ?? [];
    if (entries.length < 3) missingRequired.push(`day${day}:minimum_stops`);
    let scenic = 0;
    let meals = 0;
    for (const entry of entries) {
      const id = resolveTripPlaceId(entry.place);
      if (!id || !filterRealPlanningPlaces([entry.place]).length) {
        missingRequired.push(`day${day}:real_place`);
        continue;
      }
      if (globallyUsed.has(id)) missingRequired.push(`day${day}:duplicate_place`);
      globallyUsed.add(id);
      if (requiredIds.has(id)) presentRequired.add(id);
      if (requiredIds.has(entry.place.id)) presentRequired.add(entry.place.id);
      const kind = classifyPlanPlaceKind(entry.place);
      if (kind === "restaurant" || kind === "cafe" || kind === "night_market") meals += 1;
      else scenic += 1;
    }
    if (scenic === 0) missingRequired.push(`day${day}:scenic`);
    if (meals === 0) missingRequired.push(`day${day}:meal`);
    for (const optional of optionalSlots) {
      const present = entries.some((entry) => {
        const label = entry.label.toLowerCase();
        if (optional === "breakfast") return /早餐|breakfast/.test(label);
        if (optional === "cafe") return /咖啡|cafe/.test(label);
        if (optional === "evening") return /晚間|夜間|evening/.test(label);
        return /景點二|attraction_2/.test(label);
      });
      if (!present) missingOptional.push(`day${day}:${optional}`);
    }
  }
  for (const id of requiredIds) {
    if (!presentRequired.has(id)) missingRequired.push(`required_place:${id}`);
  }

  const deliveryAllowed = missingRequired.length === 0;
  return {
    requiredSlots,
    optionalSlots,
    missingRequired: [...new Set(missingRequired)],
    missingOptional,
    degraded: deliveryAllowed && missingOptional.length > 0,
    deliveryAllowed,
  };
}
