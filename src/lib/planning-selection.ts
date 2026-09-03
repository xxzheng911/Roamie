import type { Locale } from "@/lib/i18n/types";
import type { PlaceResult } from "@/lib/place-result";
import type { SearchPlacesFn } from "@/lib/explore-category-search";
import type { ChatPlaceItem, ChatPlanningSession } from "@/lib/chat-session";
import { mapPlaceResultsToChatItems } from "@/lib/chat-session";
import { placeIdentityKey } from "@/lib/place-planning-memory";
import type { PlanTravelStyleZh } from "@/lib/plan-travel-style";
import type { UserProfileForReason } from "@/lib/build-place-recommendation-reason";
import { collectPlaceTypes } from "@/lib/place-identity";
import { devVerboseInfo } from "@/lib/dev-verbose-log";
import { isExplicitCampingPlace } from "@/lib/camping-place-classification";
import { classifyFamilyPlace } from "@/lib/family-place-classification";
import { matchDestinationAdministrativeScope } from "@/lib/destination-administrative-scope";

export type RecommendationFamily =
  | "food"
  | "cafe"
  | "nature"
  | "city"
  | "art"
  | "culture"
  | "family"
  | "camping";

export type PlanningSelectionLane = {
  style: PlanTravelStyleZh;
  family: RecommendationFamily;
  queryCursor: number;
  exhausted?: boolean;
  searchedQueryIndexes?: number[];
  candidatePool?: PlaceResult[];
};

export type PlanningSelectionSession = {
  id: string;
  mode: "planning_selection";
  styles: PlanTravelStyleZh[];
  selectedPlaceIds: string[];
  selectedPlaces: ChatPlaceItem[];
  shownPlaceIds: string[];
  shownFamilyCounts: Partial<Record<RecommendationFamily, number>>;
  lanes: PlanningSelectionLane[];
  dateAuthority?: {
    startDate: string;
    endDate: string;
    tripDays: number;
  };
  destinationScope: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
    administrativeNames?: string[];
  };
  createdAt: string;
};

type FamilyContract = {
  family: RecommendationFamily;
  queries: string[];
  types: string[];
};

export const STYLE_RECOMMENDATION_FAMILIES: Record<PlanTravelStyleZh, FamilyContract> = {
  美食探索: {
    family: "food",
    queries: ["在地料理 特色餐廳", "小吃 甜點"],
    types: ["restaurant", "food", "bakery"],
  },
  文青咖啡: {
    family: "cafe",
    queries: ["特色咖啡廳 茶館", "老宅咖啡"],
    types: ["cafe", "coffee_shop", "tea_house"],
  },
  自然戶外: {
    family: "nature",
    queries: ["自然景點 公園 步道", "山景 海景 戶外景點"],
    types: ["park", "hiking_area", "national_park"],
  },
  城市漫遊: {
    family: "city",
    queries: ["歷史街區 城市散步", "城市地標 街區"],
    types: ["tourist_attraction", "historical_landmark", "plaza"],
  },
  藝術展覽: {
    family: "art",
    queries: ["美術館 博物館", "藝廊 展覽空間"],
    types: ["art_gallery", "museum", "cultural_center"],
  },
  文化體驗: {
    family: "culture",
    queries: ["古蹟 寺廟 文化景點", "歷史文化場館"],
    types: ["historical_landmark", "place_of_worship", "museum"],
  },
  親子同遊: {
    family: "family",
    queries: [
      "動物園 水族館",
      "親子樂園 遊樂園",
      "兒童樂園 室內遊樂",
      "親子農場 動物互動",
      "親子 科學館 兒童博物館",
      "親子 生態園區 體驗",
    ],
    types: [
      "zoo",
      "aquarium",
      "amusement_park",
      "amusement_center",
      "playground",
      "indoor_playground",
    ],
  },
  露營野遊: {
    family: "camping",
    queries: ["露營區", "露營地", "campground", "campsite", "RV park", "森林露營區"],
    types: ["campground", "rv_park"],
  },
};

export function createPlanningSelectionSession(params: {
  styles: PlanTravelStyleZh[];
  destination: { name: string; lat: number; lng: number; administrativeNames?: string[] };
  dateAuthority?: { startDate: string; endDate: string; tripDays: number };
}): PlanningSelectionSession {
  const styles = [...new Set(params.styles)];
  return {
    id: `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: "planning_selection",
    styles,
    selectedPlaceIds: [],
    selectedPlaces: [],
    shownPlaceIds: [],
    shownFamilyCounts: {},
    lanes: styles.map((style) => ({
      style,
      family: STYLE_RECOMMENDATION_FAMILIES[style].family,
      queryCursor: 0,
    })),
    dateAuthority: params.dateAuthority,
    destinationScope: { ...params.destination, radius: 50_000 },
    createdAt: new Date().toISOString(),
  };
}

export function isPlanningSelectionMode(session: ChatPlanningSession): boolean {
  return session.planningSelection?.mode === "planning_selection";
}

function placeId(place: {
  id?: string;
  canonicalPlaceId?: string;
  googlePlaceId?: string;
  placeId?: string;
  name: string;
}): string {
  return (
    place.canonicalPlaceId?.trim() ||
    place.googlePlaceId?.trim() ||
    place.placeId?.trim() ||
    place.id?.trim() ||
    placeIdentityKey(place)
  );
}

export function togglePlanningSelectionPlace(
  session: ChatPlanningSession,
  place: ChatPlaceItem,
): ChatPlanningSession {
  const selection = session.planningSelection;
  if (!selection) return session;
  const id = placeId(place);
  const selected = selection.selectedPlaceIds.includes(id);
  const authoritativePlaces = resolvePlanningSelectionPlaces(session);
  const selectedPlaces = selected
    ? authoritativePlaces.filter((candidate) => placeId(candidate) !== id)
    : [...authoritativePlaces, place];
  devVerboseInfo("[PLANNING_SELECTION_TOGGLE]", {
    placeId: id,
    selected: !selected,
    selectedCount: selectedPlaces.length,
  });
  return {
    ...session,
    selectedPlaces,
    selectedPlaceIds: selectedPlaces.map(placeId),
    plannedStops: selectedPlaces,
    phase: selectedPlaces.length ? "followup" : "collect",
    planningSelection: {
      ...selection,
      selectedPlaceIds: selectedPlaces.map(placeId),
      selectedPlaces,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** Nested Selection payload is authoritative; top-level fields remain compatibility mirrors. */
export function resolvePlanningSelectionPlaces(session: ChatPlanningSession): ChatPlaceItem[] {
  const selection = session.planningSelection;
  if (!selection) return session.selectedPlaces;
  if (selection.selectedPlaces?.length) return selection.selectedPlaces;
  const ids = new Set(selection.selectedPlaceIds);
  return session.selectedPlaces.filter((candidate) => ids.has(placeId(candidate)));
}

export function preparePlanningSelectionForGenerate(session: ChatPlanningSession): {
  session: ChatPlanningSession;
  requiredPlaces: ChatPlaceItem[];
  blockedReason?: "no_selected_payload";
} {
  const requiredPlaces = resolvePlanningSelectionPlaces(session);
  if (!requiredPlaces.length)
    return { session, requiredPlaces, blockedReason: "no_selected_payload" };
  const selection = session.planningSelection;
  return {
    requiredPlaces,
    session: {
      ...session,
      selectedPlaces: requiredPlaces,
      selectedPlaceIds: requiredPlaces.map(placeId),
      plannedStops: requiredPlaces,
      phase: "ready",
      planningSelection: selection ? { ...selection, selectedPlaces: requiredPlaces } : selection,
    },
  };
}

function coverageAwareMerge(
  lanes: Array<{ lane: PlanningSelectionLane; places: PlaceResult[] }>,
  limit: number,
  historicalCounts: Partial<Record<RecommendationFamily, number>>,
): PlaceResult[] {
  const output: PlaceResult[] = [];
  const seen = new Set<string>();
  const offsets = new Map(lanes.map((entry) => [entry.lane.style, 0]));
  const batchCounts: Partial<Record<RecommendationFamily, number>> = {};
  while (output.length < limit) {
    const available = lanes.filter(
      (entry) => (offsets.get(entry.lane.style) ?? 0) < entry.places.length,
    );
    if (!available.length) break;
    available.sort((a, b) => {
      const aCount = (historicalCounts[a.lane.family] ?? 0) + (batchCounts[a.lane.family] ?? 0);
      const bCount = (historicalCounts[b.lane.family] ?? 0) + (batchCounts[b.lane.family] ?? 0);
      return aCount - bCount;
    });
    const entry = available[0];
    const offset = offsets.get(entry.lane.style) ?? 0;
    const place = entry.places[offset];
    offsets.set(entry.lane.style, offset + 1);
    if (seen.has(place.id)) continue;
    seen.add(place.id);
    output.push(place);
    batchCounts[entry.lane.family] = (batchCounts[entry.lane.family] ?? 0) + 1;
  }
  return output;
}

const CAFE_NAME_RE = /(?:咖啡|珈琲|coffee|cafe|café|茶館|茶屋|tea\s*(?:house|room))/i;

export function isPlaceEligibleForSelectionFamily(
  place: PlaceResult,
  family: RecommendationFamily,
): boolean {
  const types = collectPlaceTypes(place);
  const name = `${place.name} ${place.address ?? ""}`;
  if (family === "camping") {
    return isExplicitCampingPlace(place);
  }
  if (family === "family") {
    return classifyFamilyPlace(place).eligible;
  }
  if (family === "cafe") {
    return (
      types.some((type) => ["cafe", "coffee_shop", "tea_house"].includes(type)) ||
      CAFE_NAME_RE.test(name)
    );
  }
  return true;
}

export async function fetchPlanningSelectionRecommendations(params: {
  session: ChatPlanningSession;
  searchPlaces: SearchPlacesFn;
  locale: Locale;
  limit?: number;
  userProfile?: UserProfileForReason | null;
}): Promise<{ session: ChatPlanningSession; places: ChatPlaceItem[] }> {
  const selection = params.session.planningSelection;
  if (!selection) return { session: params.session, places: [] };
  const excluded = new Set([...selection.shownPlaceIds, ...selection.selectedPlaceIds]);
  devVerboseInfo("[PLANNING_SELECTION_START]", {
    styles: selection.styles,
    selectedPlaceIdsCount: selection.selectedPlaceIds.length,
    shownPlaceIdsCount: selection.shownPlaceIds.length,
  });
  const recommendationLimit = params.limit ?? Math.max(4, selection.styles.length * 2);
  const targetPerLane = Math.max(1, Math.ceil(recommendationLimit / selection.styles.length));
  const highestShownFamilyCount = Math.max(0, ...Object.values(selection.shownFamilyCounts ?? {}));
  const results = await Promise.all(
    selection.lanes.map(async (lane) => {
      const contract = STYLE_RECOMMENDATION_FAMILIES[lane.style];
      const maxAttempts = contract.family === "camping" ? 3 : 1;
      const laneTarget =
        (selection.shownFamilyCounts?.[lane.family] ?? 0) < highestShownFamilyCount
          ? recommendationLimit
          : targetPerLane;
      let rawCount = 0;
      let eligibleCount = 0;
      const deduped = new Map<string, PlaceResult>();
      for (const place of lane.candidatePool ?? []) {
        if (!excluded.has(place.id)) deduped.set(place.id, place);
      }
      const searched = new Set(lane.searchedQueryIndexes ?? []);
      const attempted: number[] = [];
      for (let attempt = 0; attempt < maxAttempts && deduped.size < laneTarget; attempt += 1) {
        const queryIndex = contract.queries.findIndex((_, index) => !searched.has(index));
        if (queryIndex < 0) break;
        searched.add(queryIndex);
        attempted.push(queryIndex);
        const query = contract.queries[queryIndex];
        try {
          const result = await params.searchPlaces({
            data: {
              query: `${selection.destinationScope.name} ${query}`,
              lat: selection.destinationScope.lat,
              lng: selection.destinationScope.lng,
              radius: selection.destinationScope.radius,
              mode: "text",
              includedTypes: contract.types,
              locale: params.locale,
              categoryId: contract.family,
              placesCaller: "planning_selection_lane",
              placesScreen: "chat",
              destinationName: selection.destinationScope.name,
              searchMode: "destination",
              intentCategory: contract.family,
              planningSelectionStyle: lane.style,
              cacheDestination: selection.destinationScope.name,
            },
          });
          rawCount += result.places.length;
          const exclusionCounts = {
            wrong_type: 0,
            exclusion: 0,
            geographic_scope: 0,
            duplicate: 0,
            lodging: 0,
            missing_metadata: 0,
            other: 0,
          };
          const eligible = result.places.filter((place) => {
            if (!place.id || !place.name || place.lat == null || place.lng == null) {
              exclusionCounts.missing_metadata += 1;
              return false;
            }
            const familyClassification =
              contract.family === "family" ? classifyFamilyPlace(place) : null;
            if (!isPlaceEligibleForSelectionFamily(place, contract.family)) {
              exclusionCounts.wrong_type += 1;
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? collectPlaceTypes(place),
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: null,
                decision: "reject",
                rejectionReason: "wrong_type_or_missing_family_evidence",
              });
              return false;
            }
            const requiresAdministrativeScope =
              contract.family === "camping" || contract.family === "family";
            const adminMatch = requiresAdministrativeScope
              ? matchDestinationAdministrativeScope(place, selection.destinationScope)
              : { match: true as const, reason: "matched_alias" as const };
            if (!adminMatch.match) {
              exclusionCounts.geographic_scope += 1;
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? collectPlaceTypes(place),
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: false,
                decision: "reject",
                rejectionReason: adminMatch.reason,
              });
              return false;
            }
            if (contract.family === "family") {
              devVerboseInfo("[PLANNING_SELECTION_FAMILY_CANDIDATE]", {
                style: lane.style,
                family: lane.family,
                query,
                placeId: place.id,
                name: place.name,
                rawTypes: [place.primaryType, ...(place.types ?? [])].filter(Boolean),
                normalizedTypes: familyClassification?.normalizedTypes ?? [],
                explicitFamilyIdentity: familyClassification?.explicitFamilyIdentity ?? false,
                familyEvidence: familyClassification?.familyEvidence ?? [],
                geographicAdminMatch: true,
                decision: "allow",
                rejectionReason: "",
              });
            }
            return true;
          });
          eligibleCount += eligible.length;
          for (const place of eligible) {
            if (excluded.has(place.id) || deduped.has(place.id)) {
              exclusionCounts.duplicate += 1;
            }
            if (!excluded.has(place.id)) deduped.set(place.id, place);
          }
          const exhausted = searched.size >= contract.queries.length && deduped.size === 0;
          devVerboseInfo("[PLANNING_SELECTION_FAMILY_AUDIT]", {
            stage: "selection_after_places_wrapper",
            style: lane.style,
            family: lane.family,
            query,
            rawCount: result.places.length,
            rawCountSource: "places_wrapper_output_google_raw_in_PLANNING_SELECTION_PLACES_RAW",
            eligibleCount: eligible.length,
            scopeCount: eligible.length,
            dedupeCount: deduped.size,
            shownCount: selection.shownPlaceIds.length,
            searchedQueryIndexes: [...searched],
            exhausted,
          });
          devVerboseInfo("[PLANNING_SELECTION_EXCLUSION_SUMMARY]", {
            stage: "selection_after_places_wrapper",
            style: lane.style,
            family: lane.family,
            query,
            ...exclusionCounts,
          });
          devVerboseInfo("[PLANNING_SELECTION_LANE_QUERY]", {
            style: lane.style,
            family: lane.family,
            query,
            candidateCountBeforeEligibility: result.places.length,
            candidateCountAfterEligibility: eligible.length,
            candidateCountAfterDedupe: deduped.size,
          });
        } catch (error) {
          devVerboseInfo("[PLANNING_SELECTION_LANE_QUERY_FAILED]", {
            style: lane.style,
            family: lane.family,
            query,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      devVerboseInfo("[PLANNING_SELECTION_LANE_RESULT]", {
        style: lane.style,
        family: lane.family,
        candidateCountBeforeEligibility: rawCount,
        candidateCountAfterEligibility: eligibleCount,
        candidateCountAfterDedupe: deduped.size,
        attemptedQueryIndexes: attempted,
        searchedQueryCount: searched.size,
        exhausted: searched.size >= contract.queries.length && deduped.size === 0,
      });
      return { lane, places: [...deduped.values()], searchedQueryIndexes: [...searched] };
    }),
  );
  const picked = coverageAwareMerge(
    results,
    recommendationLimit,
    selection.shownFamilyCounts ?? {},
  );
  const familyByPlaceId = new Map(
    results.flatMap(({ lane, places }) => places.map((place) => [place.id, lane.family] as const)),
  );
  const places = mapPlaceResultsToChatItems(
    picked.map((place) => ({
      place,
      ctx: {
        locale: params.locale,
        mood: params.session.mood,
        weather: params.session.weather,
        userProfile: params.userProfile,
        categoryLabel: selection.styles.join("、"),
        categoryIntent: familyByPlaceId.get(place.id),
      },
    })),
  );
  devVerboseInfo("[PLANNING_SELECTION_MERGED]", {
    distribution: picked.reduce<Record<string, number>>((counts, place) => {
      const family = familyByPlaceId.get(place.id) ?? "unknown";
      counts[family] = (counts[family] ?? 0) + 1;
      return counts;
    }, {}),
    selectedPlaceIdsCount: selection.selectedPlaceIds.length,
    shownPlaceIdsCount: selection.shownPlaceIds.length + picked.length,
    reasonRenderer: "mapPlaceResultsToChatItems/buildDiversePlaceRecommendationReasons",
  });
  const nextSelection: PlanningSelectionSession = {
    ...selection,
    shownPlaceIds: [...new Set([...selection.shownPlaceIds, ...picked.map((p) => p.id)])],
    shownFamilyCounts: picked.reduce<Partial<Record<RecommendationFamily, number>>>(
      (counts, place) => {
        const family = familyByPlaceId.get(place.id);
        if (family) counts[family] = (counts[family] ?? 0) + 1;
        return counts;
      },
      { ...(selection.shownFamilyCounts ?? {}) },
    ),
    lanes: selection.lanes.map((lane) => {
      const result = results.find((entry) => entry.lane.style === lane.style);
      const remaining = (result?.places ?? []).filter(
        (place) => !picked.some((item) => item.id === place.id),
      );
      const contract = STYLE_RECOMMENDATION_FAMILIES[lane.style];
      const searchedQueryIndexes = result?.searchedQueryIndexes ?? lane.searchedQueryIndexes ?? [];
      return {
        ...lane,
        queryCursor: searchedQueryIndexes.length,
        searchedQueryIndexes,
        candidatePool: remaining,
        exhausted: searchedQueryIndexes.length >= contract.queries.length && remaining.length === 0,
      };
    }),
  };
  return {
    places,
    session: {
      ...params.session,
      planningSelection: nextSelection,
      recommendedPlaces: [...params.session.recommendedPlaces, ...places],
      recommendedPlaceIds: nextSelection.shownPlaceIds,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function isPlanningSelectionContinuation(text: string): boolean {
  return /(?:還有嗎|还有吗|再推薦|再推荐|其他的|更多推薦|more)/i.test(text.trim());
}
