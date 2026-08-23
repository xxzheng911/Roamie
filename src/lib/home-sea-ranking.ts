import type { PlaceResult } from "@/lib/place-result";
import { distanceMeters } from "@/lib/geo-distance";
import { resolveResidentialPlace } from "@/lib/ai/residential-place";

const SEA_HARD_BLOCK_TYPES = new Set([
  "lodging",
  "hotel",
  "motel",
  "hostel",
  "resort_hotel",
  "restaurant",
  "cafe",
  "shopping_mall",
  "department_store",
  "train_station",
  "transit_station",
  "bus_station",
]);

const SEA_STRONG_TYPES = new Set(["beach", "marina"]);
const SEA_COMPATIBLE_TYPES = new Set([
  "tourist_attraction",
  "scenic_spot",
  "park",
  "national_park",
  "historical_landmark",
  "monument",
  "point_of_interest",
]);

const SEA_STRONG_SEMANTIC_RE =
  /海灘|沙灘|海水浴場|海岸|濱海|海濱|海邊|海景|海灣|海洋|港灣|海港|漁港|碼頭|防波堤|[\p{Script=Han}]{1,10}灣(?:風景區|景區|公園|海灘|沙灘|$)|seaside|waterfront|ocean\s*view|coastal|coastline|beach|bay|marina|harbou?r|pier/iu;
const SEA_SCENIC_RE = /觀景|展望|景觀|步道|公園|promenade|scenic|viewpoint|lookout/i;

function normalizedTypes(place: PlaceResult): string[] {
  return [place.primaryType, ...(place.types ?? [])]
    .filter(Boolean)
    .map((type) => String(type).trim().toLowerCase());
}

export function homeSeaCandidateScore(place: PlaceResult): number {
  const types = normalizedTypes(place);
  const name = place.name ?? "";
  const address = place.address ?? "";
  const text = `${name} ${address}`;
  if (resolveResidentialPlace(place).residential) return Number.NEGATIVE_INFINITY;
  if (types.some((type) => SEA_HARD_BLOCK_TYPES.has(type))) return Number.NEGATIVE_INFINITY;

  const strongType = types.some((type) => SEA_STRONG_TYPES.has(type));
  const compatibleType = types.some((type) => SEA_COMPATIBLE_TYPES.has(type));
  const strongSemantic = SEA_STRONG_SEMANTIC_RE.test(text);
  if (!strongType && !(compatibleType && strongSemantic)) return Number.NEGATIVE_INFINITY;

  let score = strongType ? 120 : 80;
  if (strongSemantic) score += 35;
  if (SEA_SCENIC_RE.test(text)) score += 20;
  if (/海灘|沙灘|海水浴場|beach/i.test(text)) score += 25;
  if (/waterfront|海濱|濱海|海岸|coastal/i.test(text)) score += 20;
  if (/港灣|海港|漁港|碼頭|marina|harbou?r|pier/i.test(text)) score += 15;
  return score;
}

export function filterHomeSeaCandidates(places: PlaceResult[]): PlaceResult[] {
  return places.filter((place) => Number.isFinite(homeSeaCandidateScore(place)));
}

export type HomeSeaRankingBreakdown = {
  seaScore: number;
  qualityScore: number;
  distanceMeters: number;
  distanceScore: number;
  finalScore: number;
  dropReason: string;
};

export function buildHomeSeaRankingBreakdown(
  place: PlaceResult,
  origin: { lat: number; lng: number },
): HomeSeaRankingBreakdown {
  const seaScore = homeSeaCandidateScore(place);
  const distance =
    place.lat != null && place.lng != null
      ? distanceMeters(origin, { lat: place.lat, lng: place.lng })
      : Number.POSITIVE_INFINITY;
  const distanceScore = Number.isFinite(distance) ? 100 / (1 + distance / 1_000) : 0;
  const qualityScore = (place.rating ?? 0) * Math.log10((place.userRatingCount ?? 0) + 10);
  const accepted = Number.isFinite(seaScore);
  return {
    seaScore,
    qualityScore,
    distanceMeters: distance,
    distanceScore,
    // Diagnostic composite only. The comparator below remains lexicographic so
    // distance can never let a weak/non-Sea POI beat a genuine coastal place.
    finalScore: accepted ? seaScore * 1_000_000 + distanceScore * 1_000 + qualityScore : -Infinity,
    dropReason: accepted ? "" : "sea_fidelity_rejected",
  };
}

export function rankHomeSeaCandidates(
  places: PlaceResult[],
  origin: { lat: number; lng: number },
): PlaceResult[] {
  return [...places].sort((a, b) => {
    const rankA = buildHomeSeaRankingBreakdown(a, origin);
    const rankB = buildHomeSeaRankingBreakdown(b, origin);
    const semantic = rankB.seaScore - rankA.seaScore;
    if (semantic !== 0) return semantic;
    if (rankA.distanceMeters !== rankB.distanceMeters) {
      return rankA.distanceMeters - rankB.distanceMeters;
    }
    return rankB.qualityScore - rankA.qualityScore;
  });
}

export const HOME_SEA_SEARCH_ATTEMPTS = [
  { query: "海景 海岸 海邊 海灘 濱海", mode: "text" as const },
  { query: "waterfront seaside promenade ocean view coastal scenic", mode: "text" as const },
  { query: "港灣 碼頭 海濱公園 觀景台", mode: "text" as const },
];

/** Text Search uses this circle as locationBias, not a Nearby locationRestriction. */
export const HOME_SEA_LOCATION_BIAS_RADIUS_M = 50_000;
