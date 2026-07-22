/**
 * Region / city candidates inside a combination (e.g. 鎌倉・箱根・橫濱)
 * must expand to real landmark Places — never treat the region name as a stop.
 */
import { logAiPipeline } from "@/lib/ai/ai-pipeline-log";
import {
  isKnownTouristCityLabel,
  normalizeDestinationLabel,
} from "@/lib/ai/trip-planning-context";
import { resolveDestinationEntity } from "@/lib/ai/destination-entity";
import type { PlaceSearchFn } from "@/lib/ai/chat-place-recommendation";
import type { PlaceResult } from "@/lib/place-result";
import type { Locale } from "@/lib/i18n/types";
import { isResolvedCorePlace } from "@/lib/ai/planning-real-place";
import { isMappableGooglePlaceId } from "@/lib/ai/map-named-places-to-google";
import { detectSubPlaceType } from "@/lib/ai/landmark-keywords";
import {
  validateCandidateIntent,
  logRejectedCandidate,
} from "@/lib/ai/combination-candidate-quality";
import { mergeCombinationProvenance } from "@/lib/ai/combination-provenance";
import { mapPlaceResultToChatItem, type ChatPlaceItem } from "@/lib/chat-session";
import {
  resolveDestinationApproxCenter,
  type GeocodeDestinationFn,
} from "@/lib/ai/destination-geocode";

/** Landmark-ish suffixes — if present, treat as a concrete place, not a bare region. */
const PLACE_SUFFIX_RE =
  /(寺|神社|宮|塔|城|公園|美術館|博物館|市場|商店街|駅|站|通|橋|園|館|堂|殿|碼頭|海滩|海灘|夜市|溫泉鄉)/;

const REGION_TYPE_HINT =
  /^(locality|administrative_area|political|colloquial_area|neighborhood)$/i;

export type RegionCandidateKind = "place" | "city_or_region";

export function classifyCombinationCandidate(
  name: string,
  destination: string,
  opts?: { types?: string[] | null; primaryType?: string | null },
): RegionCandidateKind {
  const label = name.trim();
  if (!label) return "place";
  const dest = normalizeDestinationLabel(destination);
  const normalized = normalizeDestinationLabel(label);

  if (normalized === dest) return "place";

  const types = [...(opts?.types ?? []), opts?.primaryType ?? ""].filter(Boolean);
  if (types.some((t) => REGION_TYPE_HINT.test(t))) {
    return "city_or_region";
  }

  // Known tourist city/region distinct from trip destination → expand.
  if (isKnownTouristCityLabel(normalized) && normalized !== dest) {
    if (!PLACE_SUFFIX_RE.test(label)) return "city_or_region";
  }

  const entity = resolveDestinationEntity(label);
  if (
    (entity.type === "city" || entity.type === "region") &&
    normalizeDestinationLabel(entity.name) !== dest &&
    !PLACE_SUFFIX_RE.test(label)
  ) {
    return "city_or_region";
  }

  // Short bare toponym without landmark suffix (generic heuristic, not city hardcode).
  if (
    label.length >= 2 &&
    label.length <= 4 &&
    !PLACE_SUFFIX_RE.test(label) &&
    !/[0-9]/.test(label) &&
    isKnownTouristCityLabel(normalized)
  ) {
    return "city_or_region";
  }

  return "place";
}

export type RegionExpansionResult = {
  regionName: string;
  combinationId: number;
  places: ChatPlaceItem[];
  failed: boolean;
};

const REGION_EXPAND_QUERIES = [
  (region: string, dest: string) => `${region} 景點 ${dest}`,
  (region: string) => `${region} 観光名所`,
  (region: string) => `${region} tourist attractions`,
  (region: string) => `${region} 神社 寺`,
];

/**
 * Geocode region → text-search real landmarks within that area.
 * Every expanded place keeps sourceCombinationIds = [combinationId].
 */
export async function resolveRegionCandidate(params: {
  regionName: string;
  combinationId: number;
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn?: GeocodeDestinationFn;
  generationRequestId?: string;
  theme?: string;
  title?: string;
  mood?: string;
  weather?: unknown;
  maxPlaces?: number;
}): Promise<RegionExpansionResult> {
  const region = params.regionName.trim();
  const maxPlaces = params.maxPlaces ?? 3;
  const places: ChatPlaceItem[] = [];

  logAiPipeline(
    "[COMBINATION_REGION_EXPANSION_STARTED]",
    `combinationId=${params.combinationId}`,
    `region=${region}`,
    `destination=${params.destination}`,
  );

  // Prefer the region’s own centroid — never silently search from primary-city lat/lng
  // (東京 center would reject 箱根 via outside_destination_radius ~55km).
  const approx = resolveDestinationApproxCenter(region);
  let searchLat = approx?.lat ?? params.lat;
  let searchLng = approx?.lng ?? params.lng;
  if (params.geocodeFn) {
    try {
      const geoQuery =
        normalizeDestinationLabel(region) ===
        normalizeDestinationLabel(params.destination)
          ? region
          : `${region} ${params.destination}`;
      const geo = await params.geocodeFn({
        data: { query: geoQuery, locale: params.locale },
      });
      if (geo.location?.lat != null && geo.location?.lng != null) {
        searchLat = geo.location.lat;
        searchLng = geo.location.lng;
      }
    } catch {
      /* keep approx / fallback center */
    }
  }
  logAiPipeline(
    "[COMBINATION_REGION_SEARCH_CENTER]",
    `region=${region}`,
    `lat=${searchLat}`,
    `lng=${searchLng}`,
    `approxFallback=${Boolean(approx)}`,
  );

  const seen = new Set<string>();
  for (const buildQuery of REGION_EXPAND_QUERIES) {
    if (places.length >= maxPlaces) break;
    const query = buildQuery(region, params.destination);
    try {
      const result = await params.searchPlaces({
        data: {
          query,
          lat: searchLat,
          lng: searchLng,
          radius: 25_000,
          mode: "text",
          placesScreen: "chat",
          placesCaller: "combination_region_expand",
          destinationName: region,
          searchMode: "destination",
          includedTypes: [
            "tourist_attraction",
            "museum",
            "hindu_temple",
            "place_of_worship",
            "park",
            "historical_landmark",
            "cultural_landmark",
            "shopping_mall",
            "market",
          ],
        },
      });
      for (const place of result.places ?? []) {
        if (places.length >= maxPlaces) break;
        if (!isMappableGooglePlaceId(place.id)) continue;
        if (!isResolvedCorePlace({ ...place, destinationMatch: true })) continue;
        if (detectSubPlaceType(place.name ?? "")) continue;
        const key = place.id.trim();
        if (!key || seen.has(key)) continue;

        const quality = validateCandidateIntent(
          {
            name: place.name ?? "",
            types: place.types ?? undefined,
            primaryType: place.primaryType,
            address: place.address,
            lat: place.lat,
            lng: place.lng,
            googlePlaceId: place.id,
          },
          { theme: params.theme, title: params.title },
          params.destination,
          { center: { lat: searchLat, lng: searchLng }, requireTourismType: true },
        );
        if (!quality.ok) {
          logRejectedCandidate(
            { name: place.name ?? "", types: place.types ?? undefined },
            params.combinationId,
            quality.reason ?? "quality",
          );
          continue;
        }

        seen.add(key);
        const item = mergeCombinationProvenance(
          mapPlaceResultToChatItem(place as PlaceResult, {
            mood: params.mood,
            weather: params.weather as never,
            locale: params.locale,
          }),
          [params.combinationId],
        );
        places.push({
          ...item,
          // Keep region origin for coverage / regenerate.
          ...( { sourceRegionCandidate: region } as { sourceRegionCandidate?: string }),
        });
      }
    } catch (e) {
      console.warn("[region_candidate_expand] search failed", region, e);
    }
  }

  logAiPipeline(
    "[COMBINATION_REGION_EXPANSION_STATS]",
    `combinationId=${params.combinationId}`,
    `region=${region}`,
    `expandedPlaces=${places.length}`,
    `failed=${places.length === 0}`,
  );

  return {
    regionName: region,
    combinationId: params.combinationId,
    places,
    failed: places.length === 0,
  };
}

export async function expandRegionCandidatesForCombination(params: {
  combinationId: number;
  regionNames: string[];
  destination: string;
  lat: number;
  lng: number;
  locale: Locale;
  searchPlaces: PlaceSearchFn;
  geocodeFn?: GeocodeDestinationFn;
  generationRequestId?: string;
  theme?: string;
  title?: string;
  mood?: string;
  weather?: unknown;
}): Promise<{
  expandedPlaces: ChatPlaceItem[];
  regions: string[];
  failedRegions: string[];
}> {
  const expandedPlaces: ChatPlaceItem[] = [];
  const failedRegions: string[] = [];

  for (const region of params.regionNames) {
    const result = await resolveRegionCandidate({
      ...params,
      regionName: region,
      maxPlaces: 3,
    });
    if (result.failed) failedRegions.push(region);
    else expandedPlaces.push(...result.places);
  }

  logAiPipeline(
    "[COMBINATION_REGION_EXPANSION_STATS]",
    `combinationId=${params.combinationId}`,
    `regions=${params.regionNames.join("|")}`,
    `expandedPlaces=${expandedPlaces.length}`,
    `failedRegions=${failedRegions.join("|") || "none"}`,
  );

  return {
    expandedPlaces,
    regions: params.regionNames,
    failedRegions,
  };
}
